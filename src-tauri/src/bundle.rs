//! Reading and writing `.emquad` files. See docs/03-bundles-and-history.md.
//!
//! A bundle is untrusted input: nothing from it reaches a project until it has been extracted
//! safely and its history has been checked against its manifest.

use crate::error::{Error, Result};
use crate::history::{Author, History, MAIN};
use crate::project::{FORMAT_VERSION, Project, ProjectInfo};
use git2::{Oid, Repository};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use ts_rs::TS;
use zip::write::SimpleFileOptions;

pub const BUNDLE_FORMAT: u32 = 1;
const PACK_ENTRY: &str = "history/objects.pack";
/// Ceiling on the total uncompressed size of a bundle.
const MAX_BYTES: u64 = 1 << 30;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Manifest {
    pub format_version: u32,
    pub app: AppRef,
    pub bundle_id: String,
    pub created_at: String,
    pub project: ProjectRef,
    pub author: AuthorRef,
    pub head: String,
    pub note: String,
    pub includes: Includes,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppRef {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub id: String,
    pub name: String,
    pub main_file: String,
    pub engine: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuthorRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Includes {
    pub history: bool,
    pub pdf: bool,
    pub packages: bool,
}

fn invalid(message: impl Into<String>) -> Error {
    Error::app("bundle_invalid", message)
}

/// Write one `.emquad` file. Records an export snapshot first, so the bundle's head is a version
/// this project remembers and a later reply can be merged against it.
pub fn export(
    project: &Project,
    history: &History,
    author: &Author,
    dest: &Path,
    note: &str,
    include_pdf: bool,
) -> Result<Manifest> {
    let label = match note.lines().next().map(str::trim).filter(|l| !l.is_empty()) {
        Some(first) => format!("Exported: {first}"),
        None => "Exported".to_string(),
    };
    let head = history.snapshot(project, author, "export", &label)?;

    let mut pack = git2::Buf::new();
    {
        let mut builder = history.repo.packbuilder()?;
        let mut walk = history.repo.revwalk()?;
        walk.push(head)?;
        builder.insert_walk(&mut walk)?;
        builder.write_buf(&mut pack)?;
    }

    let pdf = project
        .build_dir()
        .join(Path::new(&project.info.main_file).with_extension("pdf"));
    let has_pdf = include_pdf && pdf.is_file();
    let manifest = Manifest {
        format_version: BUNDLE_FORMAT,
        app: AppRef {
            name: "Emquad".into(),
            version: env!("CARGO_PKG_VERSION").into(),
        },
        bundle_id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        project: ProjectRef {
            id: project.info.project_id.clone(),
            name: project.info.name.clone(),
            main_file: project.info.main_file.clone(),
            engine: project.info.engine.clone(),
        },
        author: AuthorRef {
            id: author.id.clone(),
            name: author.name.clone(),
        },
        head: head.to_string(),
        note: note.to_string(),
        includes: Includes {
            history: true,
            pdf: has_pdf,
            packages: false,
        },
    };

    let parent = dest
        .parent()
        .ok_or_else(|| Error::app("bad_path", "Destination has no parent folder"))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut zip = zip::ZipWriter::new(tmp.as_file_mut());
        let options = SimpleFileOptions::default();
        zip.start_file("manifest.json", options)?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
        zip.start_file(PACK_ENTRY, options)?;
        zip.write_all(&pack)?;
        let tree = history.repo.find_commit(head)?.tree_id();
        for (path, blob) in history.files_in(tree)? {
            zip.start_file(format!("tree/{path}"), options)?;
            zip.write_all(&history.blob(blob)?)?;
        }
        if has_pdf {
            let name = pdf
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("output.pdf");
            zip.start_file(format!("output/{name}"), options)?;
            zip.write_all(&fs::read(&pdf)?)?;
        }
        zip.finish()?;
    }
    tmp.persist(dest).map_err(|e| Error::Io(e.error))?;
    Ok(manifest)
}

fn open_zip(path: &Path) -> Result<zip::ZipArchive<fs::File>> {
    zip::ZipArchive::new(fs::File::open(path)?)
        .map_err(|_| invalid("This file is not a readable Emquad bundle"))
}

fn check_manifest(manifest: &Manifest) -> Result<()> {
    if manifest.format_version > BUNDLE_FORMAT {
        return Err(Error::app(
            "bundle_newer_format",
            "This bundle was made by a newer version of Emquad. Update the app to open it.",
        ));
    }
    let safe_id = |s: &str| {
        !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    };
    if !safe_id(&manifest.bundle_id) || !safe_id(&manifest.project.id) {
        return Err(invalid("The bundle's manifest is malformed"));
    }
    Ok(())
}

pub fn read_manifest(path: &Path) -> Result<Manifest> {
    let mut zip = open_zip(path)?;
    let mut text = String::new();
    zip.by_name("manifest.json")
        .map_err(|_| invalid("The bundle has no manifest"))?
        .take(1 << 20)
        .read_to_string(&mut text)
        .map_err(|_| invalid("The bundle's manifest is unreadable"))?;
    let manifest: Manifest =
        serde_json::from_str(&text).map_err(|_| invalid("The bundle's manifest is malformed"))?;
    check_manifest(&manifest)?;
    Ok(manifest)
}

/// Unpack into an empty directory, refusing anything that could land outside it.
fn extract(path: &Path, dest: &Path) -> Result<()> {
    let mut zip = open_zip(path)?;
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|_| invalid("The bundle is damaged"))?;
        let unsafe_path = || {
            Error::app(
                "bundle_unsafe_path",
                "The bundle contains a file path that points outside itself",
            )
        };
        if entry.is_symlink() {
            return Err(unsafe_path());
        }
        // Judge the raw name ourselves rather than trusting a sanitiser to drop the bad parts.
        let name = entry.name().map_err(|_| unsafe_path())?.into_owned();
        let parts: Vec<&str> = name
            .split('/')
            .filter(|p| !p.is_empty() && *p != ".")
            .collect();
        if name.starts_with('/')
            || name.contains(['\\', ':'])
            || parts.contains(&"..")
            || parts.is_empty()
        {
            return Err(unsafe_path());
        }
        let out = parts.iter().fold(dest.to_path_buf(), |p, c| p.join(c));
        if entry.is_dir() {
            fs::create_dir_all(&out)?;
            continue;
        }
        total += entry.size();
        if total > MAX_BYTES {
            return Err(invalid("The bundle is too large"));
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = fs::File::create(&out)?;
        let limit = MAX_BYTES;
        std::io::copy(&mut (&mut entry).take(limit), &mut file)
            .map_err(|_| invalid("The bundle is damaged"))?;
    }
    Ok(())
}

fn index_pack(repo: &Repository, pack: &[u8]) -> Result<()> {
    let odb = repo.odb()?;
    let mut writer = odb.packwriter()?;
    writer.write_all(pack)?;
    writer.commit()?;
    Ok(())
}

/// Check an extracted bundle in a throwaway repository: its head must exist in its history and
/// its plain files must be exactly that head's files. Returns the head and the pack bytes.
fn validate(dir: &Path, manifest: &Manifest) -> Result<(Oid, Vec<u8>)> {
    let pack = fs::read(dir.join(PACK_ENTRY)).map_err(|_| {
        Error::app(
            "bundle_no_history",
            "This bundle carries no history, so it cannot be merged",
        )
    })?;
    let scratch = tempfile::tempdir()?;
    let repo = Repository::init_bare(scratch.path())?;
    index_pack(&repo, &pack).map_err(|_| invalid("The bundle's history is damaged"))?;
    let missing = || {
        Error::app(
            "bundle_head_missing",
            "The bundle's history does not contain the version it claims to hold",
        )
    };
    let head = Oid::from_str(&manifest.head).map_err(|_| missing())?;
    let expected = repo.find_commit(head).map_err(|_| missing())?.tree_id();
    let tree_dir = dir.join("tree");
    fs::create_dir_all(&tree_dir)?;
    let actual = History { repo }.tree_of_dir(&tree_dir)?;
    if actual != expected {
        return Err(Error::app(
            "bundle_tree_mismatch",
            "The bundle's files do not match its history",
        ));
    }
    Ok((head, pack))
}

/// Bring a bundle into the project it belongs to, ready for review. Nothing in the working copy
/// changes. Importing the same bundle again is harmless.
pub fn import_into(project: &Project, history: &History, path: &Path) -> Result<Manifest> {
    let manifest = read_manifest(path)?;
    if manifest.project.id != project.info.project_id {
        return Err(Error::app(
            "bundle_other_project",
            "This bundle belongs to a different project",
        ));
    }
    let dir = project.incoming_dir(&manifest.bundle_id).join("bundle");
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    fs::create_dir_all(&dir)?;
    let checked = extract(path, &dir).and_then(|_| validate(&dir, &manifest));
    let _ = fs::remove_dir_all(&dir);
    let (head, pack) = checked?;

    // A bundle imported before has already delivered its objects.
    if history.repo.find_commit(head).is_err() {
        index_pack(&history.repo, &pack)?;
    }
    if let Some(main) = history.head() {
        if history.is_ancestor(head, main)? {
            return Err(Error::app(
                "already_merged",
                "Everything in this bundle is already part of your project",
            ));
        }
        if history.repo.merge_base(main, head).is_err() {
            return Err(Error::app(
                "no_common_history",
                "This bundle shares no history with your project, so it cannot be merged. Open it as a separate project instead.",
            ));
        }
    }
    history.repo.reference(
        &format!("refs/bundles/{}", manifest.bundle_id),
        head,
        true,
        "import bundle",
    )?;
    Ok(manifest)
}

/// Create a new project folder from a bundle, with the bundle's full history.
pub fn import_new(path: &Path, parent_dir: &Path) -> Result<Project> {
    let manifest = read_manifest(path)?;
    let folder: String = manifest
        .project
        .name
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let folder = folder.trim().trim_matches('.');
    let dest = parent_dir.join(if folder.is_empty() { "project" } else { folder });
    if dest.exists() && fs::read_dir(&dest)?.next().is_some() {
        return Err(Error::app(
            "not_empty",
            format!("{} already exists and is not empty", dest.display()),
        ));
    }
    let scratch = tempfile::tempdir()?;
    extract(path, scratch.path())?;
    let (head, pack) = validate(scratch.path(), &manifest)?;

    fs::create_dir_all(&dest)?;
    let project = Project {
        root: dest.clone(),
        info: ProjectInfo {
            format_version: FORMAT_VERSION,
            project_id: manifest.project.id.clone(),
            name: manifest.project.name.clone(),
            main_file: manifest.project.main_file.clone(),
            engine: manifest.project.engine.clone(),
        },
    };
    let history = History::open(&project)?;
    index_pack(&history.repo, &pack)?;
    history.repo.reference(MAIN, head, true, "import bundle")?;
    history.repo.reference(
        &format!("refs/bundles/{}", manifest.bundle_id),
        head,
        true,
        "import bundle",
    )?;
    history.checkout(&project, history.repo.find_commit(head)?.tree_id())?;
    project.save_info()?;
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::tests::{author, new_project, read_all};

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (name, bytes) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    fn entries_of(path: &Path) -> Vec<(String, Vec<u8>)> {
        let mut zip = open_zip(path).unwrap();
        (0..zip.len())
            .map(|i| {
                let mut e = zip.by_index(i).unwrap();
                let mut bytes = Vec::new();
                e.read_to_end(&mut bytes).unwrap();
                (e.name().unwrap().to_string(), bytes)
            })
            .collect()
    }

    /// Rebuild a bundle with some entries replaced, added or removed.
    fn tamper(src: &Path, dst: &Path, edit: impl Fn(&mut Vec<(String, Vec<u8>)>)) {
        let mut entries = entries_of(src);
        edit(&mut entries);
        let borrowed: Vec<(&str, &[u8])> = entries
            .iter()
            .map(|(n, b)| (n.as_str(), b.as_slice()))
            .collect();
        write_zip(dst, &borrowed);
    }

    #[test]
    fn round_trip_gives_identical_files_and_history() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let me = author("Tamer");
        a.write_file("sections/intro é.tex", "crlf\r\nline\r\n")
            .unwrap();
        a.write_file("empty.tex", "").unwrap();
        fs::write(a.root.join("fig.bin"), [0u8, 200, 13, 10]).unwrap();
        ha.snapshot(&a, &me, "snapshot", "Draft 1").unwrap();
        a.write_file("main.tex", "second\n").unwrap();

        let file = tmp.path().join("paper.emquad");
        let manifest =
            export(&a, &ha, &me, &file, "Please check section 2\nthanks", false).unwrap();
        assert_eq!(read_manifest(&file).unwrap().head, manifest.head);

        let b = import_new(&file, &tmp.path().join("elsewhere")).unwrap();
        assert_eq!(read_all(&b), read_all(&a));
        assert_eq!(b.info.project_id, a.info.project_id);
        let hb = History::open(&b).unwrap();
        let ids = |h: &History, p: &Project| -> Vec<String> {
            h.list(p)
                .unwrap()
                .versions
                .into_iter()
                .map(|v| v.id)
                .collect()
        };
        assert_eq!(ids(&hb, &b), ids(&ha, &a));
        assert_eq!(
            ha.list(&a).unwrap().versions[0].label,
            "Exported: Please check section 2"
        );
        // The sources are also readable without the app.
        assert!(entries_of(&file).iter().any(|(n, _)| n == "tree/main.tex"));
    }

    #[test]
    fn importing_twice_adds_nothing_and_already_merged_bundles_say_so() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let me = author("Tamer");
        let first = tmp.path().join("first.emquad");
        export(&a, &ha, &me, &first, "", false).unwrap();
        let err = import_into(&a, &ha, &first).unwrap_err();
        assert_eq!(err.code(), "already_merged");

        let b = import_new(&first, &tmp.path().join("b")).unwrap();
        let hb = History::open(&b).unwrap();
        b.write_file("main.tex", "from b\n").unwrap();
        let reply = tmp.path().join("reply.emquad");
        export(&b, &hb, &author("Lina"), &reply, "", false).unwrap();

        let before = read_all(&a);
        let m1 = import_into(&a, &ha, &reply).unwrap();
        let count = ha.list(&a).unwrap().versions.len();
        let m2 = import_into(&a, &ha, &reply).unwrap();
        assert_eq!(m1.bundle_id, m2.bundle_id);
        assert_eq!(ha.list(&a).unwrap().versions.len(), count);
        assert_eq!(
            read_all(&a),
            before,
            "import must not touch the working copy"
        );
        let pending: Vec<_> = ha
            .list(&a)
            .unwrap()
            .versions
            .into_iter()
            .filter(|v| v.pending)
            .collect();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].author, "Lina");
    }

    #[test]
    fn hostile_and_broken_bundles_are_rejected_and_leave_the_project_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let me = author("Tamer");
        let good = tmp.path().join("good.emquad");
        export(&a, &ha, &me, &good, "", false).unwrap();
        // Make the good bundle mergeable in principle: move A ahead of it on a different path.
        let b = import_new(&good, &tmp.path().join("b")).unwrap();
        let hb = History::open(&b).unwrap();
        b.write_file("main.tex", "from b\n").unwrap();
        let reply = tmp.path().join("reply.emquad");
        export(&b, &hb, &author("Lina"), &reply, "", false).unwrap();

        let before = read_all(&a);
        let versions = ha.list(&a).unwrap().versions.len();
        let bad = tmp.path().join("bad.emquad");
        let expect = |code: &str| {
            let err = import_into(&a, &ha, &bad).unwrap_err();
            assert_eq!(err.code(), code, "{err}");
            assert_eq!(read_all(&a), before);
            assert_eq!(ha.list(&a).unwrap().versions.len(), versions);
            assert!(import_new(&bad, &tmp.path().join("new")).is_err());
            assert!(!tmp.path().join("new").join(&a.info.name).exists());
        };

        tamper(&reply, &bad, |e| {
            e.push(("../escape.tex".into(), b"x".to_vec()))
        });
        expect("bundle_unsafe_path");
        assert!(!tmp.path().join("escape.tex").exists());

        tamper(&reply, &bad, |e| e.push(("/abs.tex".into(), b"x".to_vec())));
        expect("bundle_unsafe_path");

        tamper(&reply, &bad, |e| {
            let m = e.iter_mut().find(|(n, _)| n == "manifest.json").unwrap();
            let mut manifest: Manifest = serde_json::from_slice(&m.1).unwrap();
            manifest.head = "0123456789012345678901234567890123456789".into();
            m.1 = serde_json::to_vec(&manifest).unwrap();
        });
        expect("bundle_head_missing");

        tamper(&reply, &bad, |e| {
            e.iter_mut().find(|(n, _)| n == "tree/main.tex").unwrap().1 = b"swapped".to_vec();
        });
        expect("bundle_tree_mismatch");

        tamper(&reply, &bad, |e| {
            let m = e.iter_mut().find(|(n, _)| n == "manifest.json").unwrap();
            let mut manifest: Manifest = serde_json::from_slice(&m.1).unwrap();
            manifest.format_version = 99;
            m.1 = serde_json::to_vec(&manifest).unwrap();
        });
        expect("bundle_newer_format");

        tamper(&reply, &bad, |e| e.retain(|(n, _)| n != PACK_ENTRY));
        expect("bundle_no_history");

        let bytes = fs::read(&reply).unwrap();
        fs::write(&bad, &bytes[..bytes.len() / 2]).unwrap();
        expect("bundle_invalid");

        // A bundle from an unrelated project is refused for merging.
        let (c, hc) = new_project(&tmp.path().join("c"));
        let other = tmp.path().join("other.emquad");
        export(&c, &hc, &me, &other, "", false).unwrap();
        assert_eq!(
            import_into(&a, &ha, &other).unwrap_err().code(),
            "bundle_other_project"
        );
        assert_eq!(read_all(&a), before);
    }
}
