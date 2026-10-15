//! Telling a window which files of its project changed on disk: after the burst of events a
//! save, a sync or a checkout makes has settled, without the app's own writes or the temporary
//! files they pass through.

use crate::error::{Error, Result};
use crate::project::DATA_DIR;
use notify::{RecursiveMode, Watcher};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant, SystemTime};

/// How long the files must be left alone before what changed is told.
const SETTLE: Duration = Duration::from_millis(200);
/// The longest a change waits to be told, however busy the files are.
const AT_MOST: Duration = Duration::from_secs(1);

/// The files the app has just written itself, with their size and time of change then: when the
/// watcher reports one still that way, the change is the app's own and nobody needs telling.
#[derive(Default)]
pub struct OwnWrites(Mutex<HashMap<String, (u64, Option<SystemTime>)>>);

fn stamp(path: &Path) -> Option<(u64, Option<SystemTime>)> {
    fs::metadata(path)
        .ok()
        .map(|m| (m.len(), m.modified().ok()))
}

impl OwnWrites {
    /// Note that the app has just written `rel`, which is at `path`.
    pub fn record(&self, rel: &str, path: &Path) {
        if let Some(now) = stamp(path) {
            self.0
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(rel.to_string(), now);
        }
    }

    /// Whether the change reported for `rel` is only the app's own write of it.
    fn is_echo(&self, rel: &str, path: &Path) -> bool {
        let mut own = self.0.lock().unwrap_or_else(|e| e.into_inner());
        match (own.get(rel), stamp(path)) {
            (Some(wrote), Some(now)) if *wrote == now => {
                own.remove(rel);
                true
            }
            _ => false,
        }
    }
}

/// Whether a file name is one the app's saves pass through: `.tmp` and six letters or digits,
/// as the temporary files a save is written to are named.
fn is_temporary(name: &str) -> bool {
    name.len() == 10
        && name.starts_with(".tmp")
        && name[4..].chars().all(|c| c.is_ascii_alphanumeric())
}

/// The project path of `path`, when a change to it is the user's business: inside the project,
/// and not the app's own data, the history, or a temporary file a save passes through.
fn project_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    let name = rel.rsplit('/').next().unwrap_or("");
    let ignored = rel.is_empty()
        || rel == DATA_DIR
        || rel.starts_with(&format!("{DATA_DIR}/"))
        || rel == ".git"
        || rel.starts_with(".git/")
        || is_temporary(name);
    (!ignored).then_some(rel)
}

/// The project paths among `paths` worth telling the window about (see `project_path`), less
/// the app's own writes. Each named once, in order.
pub fn worth_telling(root: &Path, paths: &[PathBuf], own: &OwnWrites) -> Vec<String> {
    // Each path once before anything else: one save is reported several times over, and only
    // one sighting of it can match the record of the save.
    let unique: BTreeMap<String, &PathBuf> = paths
        .iter()
        .filter_map(|path| project_path(root, path).map(|rel| (rel, path)))
        .collect();
    unique
        .into_iter()
        .filter(|(rel, path)| !own.is_echo(rel, path))
        .map(|(rel, _)| rel)
        .collect()
}

/// Watch the project in `root`, calling `tell` with what changed once each burst has settled.
pub fn start(
    root: &Path,
    own: Arc<OwnWrites>,
    tell: impl Fn(Vec<String>) + Send + 'static,
) -> Result<notify::RecommendedWatcher> {
    let (sender, events) = mpsc::channel::<Vec<PathBuf>>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            let _ = sender.send(event.paths);
        }
    })
    .map_err(|e| Error::app("watch_failed", e.to_string()))?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| Error::app("watch_failed", e.to_string()))?;
    let root = root.to_path_buf();
    // Ends when the watcher is dropped, which drops the sender.
    std::thread::spawn(move || {
        // Only changes worth telling count: the app's own data being written does not hold up
        // the telling of a change to the user's files.
        let relevant = |paths: Vec<PathBuf>| -> Vec<PathBuf> {
            paths
                .into_iter()
                .filter(|p| project_path(&root, p).is_some())
                .collect()
        };
        while let Ok(first) = events.recv() {
            let mut paths = relevant(first);
            if paths.is_empty() {
                continue;
            }
            let latest = Instant::now() + AT_MOST;
            let mut quiet = Instant::now() + SETTLE;
            loop {
                let until = quiet.min(latest);
                let Some(wait) = until.checked_duration_since(Instant::now()) else {
                    break;
                };
                match events.recv_timeout(wait) {
                    Ok(more) => {
                        let more = relevant(more);
                        if !more.is_empty() {
                            paths.extend(more);
                            quiet = Instant::now() + SETTLE;
                        }
                    }
                    Err(_) => break,
                }
            }
            let changed = worth_telling(&root, &paths, &own);
            if !changed.is_empty() {
                tell(changed);
            }
        }
    });
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_changes_from_outside_the_app_are_told() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("chapters")).unwrap();
        for name in [
            "main.tex",
            "chapters/one.tex",
            ".tmpAbC123",
            ".tmpnotes.tex",
        ] {
            fs::write(root.join(name), "x").unwrap();
        }
        let own = OwnWrites::default();
        own.record("main.tex", &root.join("main.tex"));
        // One save of main.tex is reported several times over, as Windows does.
        let paths: Vec<PathBuf> = [
            "main.tex",
            "main.tex",
            "chapters/one.tex",
            "main.tex",
            "chapters/one.tex",
            ".tmpAbC123",
            ".tmpnotes.tex",
            ".emquad/state.json",
            ".git/index",
            "main.tex",
        ]
        .iter()
        .map(|p| root.join(p))
        .chain([PathBuf::from("/elsewhere/x.tex")])
        .collect();
        // A user's own file whose name merely starts with .tmp is still told.
        assert_eq!(
            worth_telling(root, &paths, &own),
            [".tmpnotes.tex", "chapters/one.tex"]
        );
        // A later change to a file the app wrote, by another program, is told.
        fs::write(root.join("main.tex"), "changed by another program").unwrap();
        own.record("chapters/one.tex", &root.join("chapters/one.tex"));
        assert_eq!(
            worth_telling(root, &[root.join("main.tex")], &own),
            ["main.tex"]
        );
    }

    #[test]
    fn a_burst_of_changes_is_told_once_when_it_settles() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let told = Arc::new(Mutex::new(Vec::<Vec<String>>::new()));
        let heard = told.clone();
        let watcher = start(&root, Arc::default(), move |paths| {
            heard.lock().unwrap().push(paths)
        })
        .unwrap();
        for i in 0..20 {
            fs::write(root.join(format!("f{}.tex", i % 4)), format!("{i}")).unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while told.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(SETTLE * 3);
        drop(watcher);
        let told = told.lock().unwrap();
        assert_eq!(told.len(), 1, "{told:?}");
        assert_eq!(told[0], ["f0.tex", "f1.tex", "f2.tex", "f3.tex"]);
    }

    #[test]
    fn a_change_is_told_within_a_second_however_busy_the_app_data_is() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        fs::create_dir_all(root.join(DATA_DIR)).unwrap();
        let told = Arc::new(Mutex::new(Vec::<(Vec<String>, Instant)>::new()));
        let heard = told.clone();
        let watcher = start(&root, Arc::default(), move |paths| {
            heard.lock().unwrap().push((paths, Instant::now()))
        })
        .unwrap();
        let began = Instant::now();
        fs::write(root.join("main.tex"), "changed by another program").unwrap();
        // The app's own data written over and over, as a long compile writes its log.
        while began.elapsed() < Duration::from_millis(2500) {
            fs::write(
                root.join(DATA_DIR).join("log.txt"),
                format!("{:?}", began.elapsed()),
            )
            .unwrap();
            std::thread::sleep(Duration::from_millis(50));
        }
        drop(watcher);
        let told = told.lock().unwrap();
        let (paths, when) = told.first().expect("the change is told");
        assert_eq!(paths, &["main.tex"]);
        assert!(
            when.duration_since(began) < Duration::from_millis(1500),
            "{:?}",
            when.duration_since(began)
        );
    }
}
