//! LaTeX packages carried inside a bundle, so its recipient can compile with no internet.
//! See docs/03-bundles-and-history.md.
//!
//! Tectonic keeps every package file it has fetched in a store on disk. A bundle can carry a
//! copy of that store. The recipient's project then compiles from a store of its own, kept in
//! `.emquad/packages`, and never from the one their other projects share: package files that
//! arrive in a bundle are untrusted, and must not be able to reach any other project.
//!
//! The compiled "format" Tectonic keeps beside the store is never carried. It is a memory image
//! read back by the engine, and is rebuilt from the package files in a second or two.

use crate::error::{Error, Result};
use crate::project::{Project, check_component};
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use ts_rs::TS;

/// One file of a store. `name` is its place in the store, with forward slashes:
/// `hashes/<source>`, `data/<digest>.index` or `data/<digest>/<file>`.
#[derive(Debug, Clone)]
pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub size: u64,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PackagesInfo {
    /// Packages can be put in a bundle: the project compiles with Tectonic and has compiled.
    pub available: bool,
    pub files: u32,
    #[ts(type = "number")]
    pub bytes: u64,
}

fn invalid() -> Error {
    Error::app(
        "bundle_invalid",
        "The LaTeX packages in this bundle are not laid out as expected",
    )
}

fn is_digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The folder Tectonic is pointed at when this project compiles from its own store.
pub fn project_cache(project: &Project) -> PathBuf {
    project.data_dir().join("packages")
}

/// The project's own store, inside its cache folder.
fn project_store(project: &Project) -> PathBuf {
    project_cache(project).join("bundles")
}

/// The store shared by every project on this computer that has none of its own.
pub fn shared_store(tectonic: &Path) -> Option<PathBuf> {
    let mut command = Command::new(tectonic);
    command
        .args(["-X", "show", "user-cache-dir"])
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    let out = crate::compile::quiet(&mut command).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let dir = PathBuf::from(text.lines().rev().find(|l| !l.trim().is_empty())?.trim());
    dir.is_dir().then_some(dir)
}

/// The store this project compiles from: its own when it has one.
pub fn store_for(project: &Project, tectonic: &Path) -> Option<PathBuf> {
    let own = project_store(project);
    if own.is_dir() {
        Some(own)
    } else {
        shared_store(tectonic)
    }
}

/// The digest a source file in `hashes/` points at, when it holds one.
fn digest_in(path: &Path) -> Option<String> {
    if fs::metadata(path).ok()?.len() > 200 {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let digest = text.trim();
    is_digest(digest).then(|| digest.to_string())
}

/// The names of the plain files in a folder, sorted. Missing folders are empty.
fn files_in(dir: &Path) -> Result<Vec<(String, PathBuf, u64)>> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(out);
    };
    for entry in entries {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            out.push((name.to_string(), entry.path(), meta.len()));
        }
    }
    out.sort();
    Ok(out)
}

/// Everything in a store that a bundle carries. A file whose name could not be written safely
/// on every computer is left out.
pub fn list(store: &Path) -> Result<Vec<Entry>> {
    let mut out = Vec::new();
    let mut digests = BTreeSet::new();
    for (name, path, size) in files_in(&store.join("hashes"))? {
        if name.ends_with(".lock") || check_component(&name).is_err() {
            continue;
        }
        let Some(digest) = digest_in(&path) else {
            continue;
        };
        if !store.join("data").join(format!("{digest}.index")).is_file() {
            continue;
        }
        out.push(Entry {
            name: format!("hashes/{name}"),
            path,
            size,
        });
        digests.insert(digest);
    }
    for digest in digests {
        let index = store.join("data").join(format!("{digest}.index"));
        out.push(Entry {
            name: format!("data/{digest}.index"),
            size: fs::metadata(&index)?.len(),
            path: index,
        });
        for (name, path, size) in files_in(&store.join("data").join(&digest))? {
            if check_component(&name).is_ok() {
                out.push(Entry {
                    name: format!("data/{digest}/{name}"),
                    path,
                    size,
                });
            }
        }
    }
    Ok(out)
}

pub fn info(entries: &[Entry]) -> PackagesInfo {
    PackagesInfo {
        available: !entries.is_empty(),
        files: entries.len() as u32,
        bytes: entries.iter().map(|e| e.size).sum(),
    }
}

/// Copy a file to its place under a temporary name first, so a copy cut short never leaves
/// half a file where a whole one is expected.
fn copy_whole(from: &Path, to: &Path) -> Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    let partial = to.with_extension("emquad-partial");
    let copied = fs::copy(from, &partial).and_then(|_| fs::rename(&partial, to));
    if copied.is_err() {
        let _ = fs::remove_file(&partial);
    }
    Ok(copied?)
}

fn place_of(store: &Path, name: &str) -> PathBuf {
    name.split('/').fold(store.to_path_buf(), |p, c| p.join(c))
}

/// Copy one file into a store unless a file is already there. Nothing is ever replaced.
fn add(from: &Path, store: &Path, name: &str) -> Result<bool> {
    let to = place_of(store, name);
    if to.exists() {
        return Ok(false);
    }
    copy_whole(from, &to)?;
    Ok(true)
}

/// Package files that have been shown to be enough: the project compiled from exactly these,
/// with fetching off. Only [`verify`] makes one, and it holds its own copy of the files, so
/// what goes into a bundle is byte for byte what was checked.
pub struct Verified {
    entries: Vec<Entry>,
    _scratch: tempfile::TempDir,
}

impl Verified {
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// For tests of the bundle format, which have no compiler to check with.
    #[cfg(test)]
    pub(crate) fn unchecked(entries: Vec<Entry>) -> Verified {
        Verified {
            entries,
            _scratch: tempfile::tempdir().unwrap(),
        }
    }
}

/// Prove that the project compiles from exactly these files with no network, by doing it in a
/// scratch folder. A bundle must not promise offline compiling it cannot deliver.
pub fn verify(tectonic: &Path, project: &Project, entries: &[Entry]) -> Result<Verified> {
    let scratch = tempfile::tempdir()?;
    let cache = scratch.path().join("cache");
    let store = cache.join("bundles");
    let mut copies = Vec::new();
    for entry in entries {
        add(&entry.path, &store, &entry.name)?;
        copies.push(Entry {
            name: entry.name.clone(),
            path: place_of(&store, &entry.name),
            size: entry.size,
        });
    }
    let out = scratch.path().join("out");
    fs::create_dir_all(&out)?;
    let main = project.resolve(&project.info.main_file)?;
    let mut command = Command::new(tectonic);
    command
        .args(["-X", "compile", "--only-cached", "--outdir"])
        .arg(&out)
        .arg(main.file_name().unwrap_or_default())
        .current_dir(main.parent().unwrap_or(&project.root))
        .env("TECTONIC_CACHE_DIR", &cache)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let done = crate::compile::quiet(&mut command).status();
    if !copies.is_empty() && done.is_ok_and(|s| s.success()) {
        return Ok(Verified {
            entries: copies,
            _scratch: scratch,
        });
    }
    Err(Error::app(
        "packages_incomplete",
        "This project does not compile from the LaTeX packages stored on this computer alone. Compile it once while online, check it has no errors, then export again.",
    ))
}

/// The files of the packages folder of an extracted bundle, checked to be laid out exactly as
/// a store is. Anything else in there makes the bundle invalid.
fn checked(dir: &Path) -> Result<Vec<Entry>> {
    let mut out = Vec::new();
    let mut digests = BTreeSet::new();
    let plain = |entry: &fs::DirEntry| -> Result<(String, u64)> {
        let meta = fs::symlink_metadata(entry.path())?;
        let name = entry.file_name().to_str().map(str::to_string);
        match name {
            Some(name) if meta.is_file() && check_component(&name).is_ok() => {
                Ok((name, meta.len()))
            }
            _ => Err(invalid()),
        }
    };
    for top in fs::read_dir(dir)? {
        let top = top?;
        match top.file_name().to_str() {
            Some("hashes") | Some("data") if top.path().is_dir() => {}
            _ => return Err(invalid()),
        }
    }
    if let Ok(entries) = fs::read_dir(dir.join("hashes")) {
        for entry in entries {
            let entry = entry?;
            let (name, size) = plain(&entry)?;
            if name.ends_with(".lock") {
                return Err(invalid());
            }
            digests.insert(digest_in(&entry.path()).ok_or_else(invalid)?);
            out.push(Entry {
                name: format!("hashes/{name}"),
                path: entry.path(),
                size,
            });
        }
    }
    if let Ok(entries) = fs::read_dir(dir.join("data")) {
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name().to_str().map(str::to_string);
            let name = name.ok_or_else(invalid)?;
            if fs::symlink_metadata(entry.path())?.is_dir() {
                if !digests.contains(&name) {
                    return Err(invalid());
                }
                for file in fs::read_dir(entry.path())? {
                    let file = file?;
                    let (file_name, size) = plain(&file)?;
                    out.push(Entry {
                        name: format!("data/{name}/{file_name}"),
                        path: file.path(),
                        size,
                    });
                }
            } else {
                let (name, size) = plain(&entry)?;
                match name.strip_suffix(".index") {
                    Some(digest) if digests.contains(digest) => {}
                    _ => return Err(invalid()),
                }
                out.push(Entry {
                    name: format!("data/{name}"),
                    path: entry.path(),
                    size,
                });
            }
        }
    }
    // Every source must come with the list of what it holds, or the compiler cannot use it.
    for digest in &digests {
        if !dir.join("data").join(format!("{digest}.index")).is_file() {
            return Err(invalid());
        }
    }
    Ok(out)
}

/// Give a project the packages of an extracted bundle. They go into the project's own store,
/// adding to what is there; a file the store already has is kept as it is. Returns how many
/// files were added.
///
/// The package files go in first and the records that point at them last, so a store is never
/// left pointing at files that did not arrive. If this call was creating the store and fails,
/// the store is removed again and the project goes on compiling as it did before.
pub fn install(dir: &Path, project: &Project) -> Result<usize> {
    let entries = checked(dir)?;
    let cache = project_cache(project);
    let existed = cache.exists();
    let store = project_store(project);
    let put = || -> Result<usize> {
        let mut added = 0;
        let (records, files): (Vec<&Entry>, Vec<&Entry>) =
            entries.iter().partition(|e| e.name.starts_with("hashes/"));
        for entry in files {
            if add(&entry.path, &store, &entry.name)? {
                added += 1;
            }
        }
        // Which source a name stands for is the one thing the newest bundle decides, so the
        // project compiles with the packages that came with the work being opened.
        for entry in records {
            copy_whole(&entry.path, &place_of(&store, &entry.name))?;
            added += 1;
        }
        Ok(added)
    };
    let added = put();
    if added.is_err() && !existed {
        let _ = fs::remove_dir_all(&cache);
    }
    added
}

/// Fill a project's own store with what this computer already holds for the same sources, so
/// moving a project onto its own store never takes away a package it could use before.
pub fn top_up(project: &Project, shared: &Path) -> Result<usize> {
    let store = project_store(project);
    let mut added = 0;
    for (_, path, _) in files_in(&store.join("hashes"))? {
        let Some(digest) = digest_in(&path) else {
            continue;
        };
        for (name, from, _) in files_in(&shared.join("data").join(&digest))? {
            if check_component(&name).is_ok()
                && add(&from, &store, &format!("data/{digest}/{name}"))?
            {
                added += 1;
            }
        }
    }
    Ok(added)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub const DIGEST: &str = "6ffe055852f8faf66c0acbe1a7fb27f87b869a90bad1204f3bf4d9683f597c7c";

    /// A small store laid out the way Tectonic lays out its own.
    pub fn make_store(dir: &Path, files: &[(&str, &str)]) {
        fs::create_dir_all(dir.join("hashes")).unwrap();
        fs::create_dir_all(dir.join("data").join(DIGEST)).unwrap();
        fs::write(dir.join("hashes/source.tar"), format!("{DIGEST}\n")).unwrap();
        fs::write(dir.join("hashes/source.lock"), "").unwrap();
        fs::write(dir.join(format!("data/{DIGEST}.index")), "index").unwrap();
        for (name, text) in files {
            fs::write(dir.join("data").join(DIGEST).join(name), text).unwrap();
        }
    }

    fn project(dir: &Path) -> Project {
        Project::create(&dir.join("p"), "p", "article").unwrap()
    }

    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn a_store_lists_its_sources_indexes_and_files_but_no_locks() {
        let tmp = tempfile::tempdir().unwrap();
        make_store(tmp.path(), &[("article.cls", "class"), ("nul.sty", "x")]);
        fs::write(tmp.path().join("hashes/dangling.tar"), "f".repeat(64)).unwrap();
        fs::write(tmp.path().join("hashes/junk.tar"), "not a digest").unwrap();
        let entries = list(tmp.path()).unwrap();
        assert_eq!(
            names(&entries),
            [
                "hashes/source.tar".to_string(),
                format!("data/{DIGEST}.index"),
                format!("data/{DIGEST}/article.cls"),
            ]
        );
        let summary = info(&entries);
        assert!(summary.available);
        assert_eq!(summary.files, 3);
        assert!(!info(&[]).available);
    }

    #[test]
    fn installing_adds_to_the_projects_own_store_and_replaces_no_package_file() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let first = tmp.path().join("first");
        make_store(&first, &[("a.sty", "from the first bundle")]);
        fs::remove_file(first.join("hashes/source.lock")).unwrap();
        assert_eq!(install(&first, &p).unwrap(), 3);

        let second = tmp.path().join("second");
        make_store(&second, &[("a.sty", "changed"), ("b.sty", "new")]);
        fs::remove_file(second.join("hashes/source.lock")).unwrap();
        install(&second, &p).unwrap();
        let data = project_cache(&p).join("bundles/data").join(DIGEST);
        assert_eq!(
            fs::read_to_string(data.join("a.sty")).unwrap(),
            "from the first bundle"
        );
        assert_eq!(fs::read_to_string(data.join("b.sty")).unwrap(), "new");
        // The store is app data, never one of the project's files.
        assert!(p.tree().unwrap().iter().all(|n| n.name != ".emquad"));
    }

    #[test]
    fn packages_laid_out_any_other_way_are_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        type Spoil<'a> = &'a dyn Fn(&Path);
        let cases: [(&str, Spoil); 6] = [
            ("a stray top-level file", &|d| {
                fs::write(d.join("extra.txt"), "x").unwrap()
            }),
            ("a format image", &|d| {
                fs::create_dir_all(d.join("formats")).unwrap()
            }),
            ("a source that names no digest", &|d| {
                fs::write(d.join("hashes/other.tar"), "../../x").unwrap()
            }),
            ("a data folder no source points at", &|d| {
                fs::create_dir_all(d.join("data").join("f".repeat(64))).unwrap()
            }),
            ("a folder inside a data folder", &|d| {
                fs::create_dir_all(d.join("data").join(DIGEST).join("sub")).unwrap()
            }),
            ("a source without its index", &|d| {
                fs::remove_file(d.join(format!("data/{DIGEST}.index"))).unwrap()
            }),
        ];
        for (what, spoil) in cases {
            let dir = tmp.path().join(what.replace(' ', "-"));
            make_store(&dir, &[("a.sty", "x")]);
            fs::remove_file(dir.join("hashes/source.lock")).unwrap();
            spoil(&dir);
            let err = install(&dir, &p).unwrap_err();
            assert_eq!(err.code(), "bundle_invalid", "{what}");
        }
        assert!(
            !project_cache(&p).exists(),
            "a refused bundle leaves no store behind"
        );
    }

    #[cfg(windows)]
    #[test]
    fn an_install_that_fails_part_way_leaves_no_store_to_compile_from() {
        use std::os::windows::fs::OpenOptionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let dir = tmp.path().join("bundle");
        make_store(&dir, &[("a.sty", "x"), ("b.sty", "y")]);
        fs::remove_file(dir.join("hashes/source.lock")).unwrap();
        // Held open for this test alone, one package file cannot be copied.
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(dir.join("data").join(DIGEST).join("b.sty"))
            .unwrap();
        assert!(install(&dir, &p).is_err());
        assert!(
            !project_cache(&p).exists(),
            "the project still compiles from the shared store"
        );
        drop(held);
        assert_eq!(install(&dir, &p).unwrap(), 4);
        assert!(
            project_cache(&p)
                .join("bundles/hashes/source.tar")
                .is_file()
        );
    }

    #[test]
    fn topping_up_copies_only_what_is_missing_for_the_same_source() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let bundle = tmp.path().join("bundle");
        make_store(&bundle, &[("a.sty", "from the bundle")]);
        fs::remove_file(bundle.join("hashes/source.lock")).unwrap();
        install(&bundle, &p).unwrap();

        let shared = tmp.path().join("shared");
        make_store(&shared, &[("a.sty", "local"), ("c.sty", "local only")]);
        let other = shared.join("data").join("e".repeat(64));
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("d.sty"), "another source").unwrap();

        let snapshot = |dir: &Path| -> Vec<(PathBuf, Vec<u8>)> {
            let mut out = Vec::new();
            let mut todo = vec![dir.to_path_buf()];
            while let Some(d) = todo.pop() {
                for e in fs::read_dir(&d).unwrap() {
                    let path = e.unwrap().path();
                    if path.is_dir() {
                        todo.push(path);
                    } else {
                        out.push((path.clone(), fs::read(&path).unwrap()));
                    }
                }
            }
            out.sort();
            out
        };
        let other = Project::create(&tmp.path().join("other"), "other", "article").unwrap();
        let (shared_before, other_before) = (snapshot(&shared), snapshot(&other.root));

        assert_eq!(top_up(&p, &shared).unwrap(), 1);
        // Neither the store every project shares nor any other project is touched.
        assert_eq!(snapshot(&shared), shared_before);
        assert_eq!(snapshot(&other.root), other_before);
        assert_eq!(snapshot(&bundle).len(), 3, "nor the bundle's own files");
        let data = project_cache(&p).join("bundles/data");
        assert_eq!(
            fs::read_to_string(data.join(DIGEST).join("a.sty")).unwrap(),
            "from the bundle"
        );
        assert!(data.join(DIGEST).join("c.sty").is_file());
        assert!(!data.join("e".repeat(64)).exists());
    }
}
