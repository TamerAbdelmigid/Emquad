//! Telling a window which files of its project changed on disk: after the burst of events a
//! save, a sync or a checkout makes has settled, without the app's own writes or the temporary
//! files they pass through.

use crate::error::{Error, Result};
use crate::project::DATA_DIR;
use notify::{RecursiveMode, Watcher};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, SystemTime};

/// How long the files must be left alone before what changed is told.
const SETTLE: Duration = Duration::from_millis(200);

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

/// The project paths among `paths` worth telling the window about: inside the project, not the
/// app's own data, the history or a temporary file a save passes through, nor a write of the
/// app's own. Each named once, in order.
pub fn worth_telling(root: &Path, paths: &[PathBuf], own: &OwnWrites) -> Vec<String> {
    let mut out = BTreeSet::new();
    for path in paths {
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        let temporary = rel
            .rsplit('/')
            .next()
            .is_some_and(|name| name.starts_with(".tmp"));
        if rel.is_empty()
            || rel == DATA_DIR
            || rel.starts_with(&format!("{DATA_DIR}/"))
            || rel == ".git"
            || rel.starts_with(".git/")
            || temporary
            || own.is_echo(&rel, path)
        {
            continue;
        }
        out.insert(rel);
    }
    out.into_iter().collect()
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
        while let Ok(first) = events.recv() {
            let mut paths = first;
            while let Ok(more) = events.recv_timeout(SETTLE) {
                paths.extend(more);
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
        for name in ["main.tex", "chapters/one.tex", ".tmpAbC123"] {
            fs::write(root.join(name), "x").unwrap();
        }
        let own = OwnWrites::default();
        own.record("main.tex", &root.join("main.tex"));
        let paths: Vec<PathBuf> = [
            "main.tex",
            "chapters/one.tex",
            "chapters/one.tex",
            ".tmpAbC123",
            ".emquad/state.json",
            ".git/index",
        ]
        .iter()
        .map(|p| root.join(p))
        .chain([PathBuf::from("/elsewhere/x.tex")])
        .collect();
        assert_eq!(worth_telling(root, &paths, &own), ["chapters/one.tex"]);
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
}
