//! Reading and writing `.emquad` files. See docs/03-bundles-and-history.md.
//!
//! A bundle is untrusted input: nothing from it reaches a project until it has been extracted
//! safely and its history has been checked against its manifest.

use crate::error::{Error, Result};
use crate::history::{Author, History, MAIN};
use crate::project::{FORMAT_VERSION, Project, ProjectInfo, check_component, clean_rel};
use git2::{Oid, Repository};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use ts_rs::TS;
use zip::write::SimpleFileOptions;

pub const BUNDLE_FORMAT: u32 = 1;
const PACK_ENTRY: &str = "history/objects.pack";
const COMMENTS_ENTRY: &str = "comments.json";
const PACKAGES_DIR: &str = "packages";
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
    #[serde(default)]
    pub comments: bool,
}

/// What a bundle carries beyond the project's files and history.
#[derive(Default)]
pub struct Extras<'a> {
    pub pdf: bool,
    /// The LaTeX package files to carry, so the recipient can compile with no internet. They
    /// can only be ones the project has just been shown to compile from.
    pub packages: Option<&'a crate::packages::Verified>,
    /// The project's comments, as stored.
    pub comments: Option<Vec<u8>>,
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
    extras: &Extras,
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

    let pdf = crate::compile::pdf_path(project);
    let has_pdf = extras.pdf && pdf.is_file();
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
            packages: extras.packages.is_some(),
            comments: extras.comments.is_some(),
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
        if let Some(comments) = &extras.comments {
            zip.start_file(COMMENTS_ENTRY, options)?;
            zip.write_all(comments)?;
        }
        for entry in extras.packages.map_or(&[][..], |p| p.entries()) {
            zip.start_file(format!("{PACKAGES_DIR}/{}", entry.name), options)?;
            std::io::copy(&mut fs::File::open(&entry.path)?, &mut zip)?;
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
    // The main file is later joined to paths inside the project; it must stay inside it.
    if clean_rel(&manifest.project.main_file).is_err() {
        return Err(invalid("The bundle names a main file outside the project"));
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
    let mut names = std::collections::HashSet::new();
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
            || parts.is_empty()
            || parts.iter().any(|p| check_component(p).is_err())
        {
            return Err(unsafe_path());
        }
        // Two entries that differ only in capitals would overwrite each other here.
        if !names.insert(parts.join("/").to_lowercase()) {
            return Err(invalid(
                "The bundle contains two files whose names differ only in capital letters",
            ));
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
    let scratch_history = History {
        repo: Repository::init_bare(scratch.path())?,
    };
    index_pack(&scratch_history.repo, &pack)
        .map_err(|_| invalid("The bundle's history is damaged"))?;
    let missing = || {
        Error::app(
            "bundle_head_missing",
            "The bundle's history does not contain the version it claims to hold",
        )
    };
    let head = Oid::from_str(&manifest.head).map_err(|_| missing())?;
    let expected = scratch_history
        .repo
        .find_commit(head)
        .map_err(|_| missing())?
        .tree_id();
    // Every version in the bundle can later be restored, so every one of them is checked, not
    // only the newest.
    scratch_history.check_history_paths(head).map_err(|e| {
        Error::app(
            "bundle_unsafe_path",
            format!("The bundle's history contains a file name that cannot be used safely: {e}"),
        )
    })?;
    let tree_dir = dir.join("tree");
    fs::create_dir_all(&tree_dir)?;
    let actual = scratch_history.tree_of_dir(&tree_dir)?;
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
    let result = take_in(project, history, path, &dir, &manifest);
    let _ = fs::remove_dir_all(&dir);
    result.map(|_| manifest)
}

fn take_in(
    project: &Project,
    history: &History,
    path: &Path,
    dir: &Path,
    manifest: &Manifest,
) -> Result<()> {
    extract(path, dir)?;
    let (head, pack) = validate(dir, manifest)?;
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
    take_extras(project, dir)?;
    history.repo.reference(
        &format!("refs/bundles/{}", manifest.bundle_id),
        head,
        true,
        "import bundle",
    )?;
    Ok(())
}

/// Take in what an extracted bundle carries beside its files: packages and comments. Both go
/// into the project's app data and neither touches a file of the project.
fn take_extras(project: &Project, dir: &Path) -> Result<()> {
    let packages = dir.join(PACKAGES_DIR);
    if packages.is_dir() {
        crate::packages::install(&packages, project)?;
    }
    let comments = dir.join(COMMENTS_ENTRY);
    if comments.is_file() && fs::metadata(&comments)?.len() <= crate::comments::MAX_BYTES {
        crate::comments::import(project, &fs::read(&comments)?)?;
    }
    Ok(())
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

    let existed = dest.exists();
    fs::create_dir_all(&dest)?;
    let build = || -> Result<Project> {
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
        take_extras(&project, scratch.path())?;
        Ok(project)
    };
    let project = build();
    if project.is_err() && !existed {
        let _ = fs::remove_dir_all(&dest);
    }
    project
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
        let manifest = export(
            &a,
            &ha,
            &me,
            &file,
            "Please check section 2\nthanks",
            &Extras::default(),
        )
        .unwrap();
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
    fn packages_and_comments_travel_with_a_bundle_and_stay_out_of_the_projects_files() {
        use crate::comments::{self, Anchor};
        use crate::packages::{self, tests::DIGEST, tests::make_store};
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let me = author("Tamer");
        let store = tmp.path().join("store");
        make_store(
            &store,
            &[("article.cls", "the class"), ("lmroman10.otf", "a font")],
        );
        let quote = |q: &str| Anchor {
            quote: q.into(),
            before: String::new(),
            after: String::new(),
            line: 1,
        };
        comments::add(&a, &me, "main.tex", quote("documentclass"), "Which class?").unwrap();

        let file = tmp.path().join("paper.emquad");
        let carried = packages::Verified::unchecked(packages::list(&store).unwrap());
        let extras = Extras {
            pdf: false,
            packages: Some(&carried),
            comments: comments::for_bundle(&a).unwrap(),
        };
        let manifest = export(&a, &ha, &me, &file, "", &extras).unwrap();
        assert!(manifest.includes.packages && manifest.includes.comments);
        let names: Vec<String> = entries_of(&file).into_iter().map(|(n, _)| n).collect();
        assert!(names.contains(&"comments.json".to_string()));
        assert!(names.contains(&format!("packages/data/{DIGEST}/article.cls")));
        assert!(names.contains(&"packages/hashes/source.tar".to_string()));
        assert!(!names.iter().any(|n| n.ends_with(".lock")));

        // A new project made from the bundle has both, and its files are only the project's.
        let b = import_new(&file, &tmp.path().join("elsewhere")).unwrap();
        assert_eq!(read_all(&b), read_all(&a));
        let data = packages::project_cache(&b)
            .join("bundles/data")
            .join(DIGEST);
        assert_eq!(
            fs::read_to_string(data.join("article.cls")).unwrap(),
            "the class"
        );
        let theirs = comments::load(&b).unwrap();
        assert_eq!(theirs.len(), 1);
        assert_eq!(theirs[0].text, "Which class?");

        // The reply brings back an answer and one more package file; both are taken in when
        // the bundle is imported, before any of its text is accepted.
        let hb = History::open(&b).unwrap();
        let lina = author("Lina");
        comments::reply(&b, &lina, &theirs[0].id, "The usual one.").unwrap();
        b.write_file("main.tex", "changed\n").unwrap();
        fs::write(data.join("extra.sty"), "one more").unwrap();
        let reply = tmp.path().join("reply.emquad");
        let carried = packages::Verified::unchecked(
            packages::list(&packages::project_cache(&b).join("bundles")).unwrap(),
        );
        let extras = Extras {
            pdf: false,
            packages: Some(&carried),
            comments: comments::for_bundle(&b).unwrap(),
        };
        export(&b, &hb, &lina, &reply, "", &extras).unwrap();
        let before = read_all(&a);
        import_into(&a, &ha, &reply).unwrap();
        assert_eq!(
            read_all(&a),
            before,
            "importing changes no file of the project"
        );
        let mine = comments::load(&a).unwrap();
        assert_eq!(mine[0].replies.len(), 1);
        let own = packages::project_cache(&a)
            .join("bundles/data")
            .join(DIGEST);
        assert!(own.join("extra.sty").is_file() && own.join("article.cls").is_file());
    }

    #[test]
    fn a_bundle_from_before_comments_existed_still_opens() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let file = tmp.path().join("new.emquad");
        export(&a, &ha, &author("Tamer"), &file, "", &Extras::default()).unwrap();
        let old = tmp.path().join("old.emquad");
        tamper(&file, &old, |entries| {
            let manifest = &mut entries
                .iter_mut()
                .find(|(n, _)| n == "manifest.json")
                .unwrap()
                .1;
            let mut json: serde_json::Value = serde_json::from_slice(manifest).unwrap();
            json["includes"].as_object_mut().unwrap().remove("comments");
            *manifest = serde_json::to_vec(&json).unwrap();
        });
        assert!(!read_manifest(&old).unwrap().includes.comments);
        assert!(import_new(&old, &tmp.path().join("b")).is_ok());
    }

    #[test]
    fn hostile_packages_and_comments_are_refused_or_dropped_and_install_nothing() {
        use crate::packages::tests::DIGEST;
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let me = author("Tamer");
        let good = tmp.path().join("good.emquad");
        export(&a, &ha, &me, &good, "", &Extras::default()).unwrap();
        let b = import_new(&good, &tmp.path().join("b")).unwrap();
        let hb = History::open(&b).unwrap();
        b.write_file("main.tex", "theirs\n").unwrap();
        let reply = tmp.path().join("reply.emquad");
        export(&b, &hb, &author("Lina"), &reply, "", &Extras::default()).unwrap();

        let digest_line = format!("{DIGEST}\n").into_bytes();
        let index = format!("packages/data/{DIGEST}.index");
        let sound = |extra: Vec<(String, Vec<u8>)>| -> Vec<(String, Vec<u8>)> {
            let mut all = vec![
                (
                    "packages/hashes/source.tar".to_string(),
                    digest_line.clone(),
                ),
                (index.clone(), b"index".to_vec()),
            ];
            all.extend(extra);
            all
        };
        type Added = Vec<(String, Vec<u8>)>;
        let cases: Vec<(&str, Added)> = vec![
            (
                "a format image for the engine to load",
                sound(vec![("packages/formats/latex.fmt".into(), vec![0; 8])]),
            ),
            (
                "a package file that climbs out of the store",
                sound(vec![(
                    format!("packages/data/{DIGEST}/../../../../main.tex"),
                    b"x".to_vec(),
                )]),
            ),
            (
                "a package file under a Windows device name",
                sound(vec![(
                    format!("packages/data/{DIGEST}/nul.sty"),
                    b"x".to_vec(),
                )]),
            ),
            (
                "a store nested inside a data folder",
                sound(vec![(
                    format!("packages/data/{DIGEST}/sub/a.sty"),
                    b"x".to_vec(),
                )]),
            ),
            (
                "a source that points somewhere else",
                vec![(
                    "packages/hashes/source.tar".into(),
                    b"..\\..\\..\\secrets".to_vec(),
                )],
            ),
            (
                "a data folder nothing points at",
                sound(vec![(
                    format!("packages/data/{}/a.sty", "e".repeat(64)),
                    b"x".to_vec(),
                )]),
            ),
            (
                "a stray file",
                sound(vec![("packages/readme.txt".into(), b"x".to_vec())]),
            ),
        ];
        for (n, (what, extra)) in cases.into_iter().enumerate() {
            let bad = tmp.path().join(format!("bad{n}.emquad"));
            tamper(&reply, &bad, |entries| entries.extend(extra.clone()));
            let before = read_all(&a);
            let err = import_into(&a, &ha, &bad).unwrap_err();
            assert!(
                matches!(err.code(), "bundle_invalid" | "bundle_unsafe_path"),
                "{what}: {}",
                err.code()
            );
            assert_eq!(read_all(&a), before, "{what}");
            assert!(!crate::packages::project_cache(&a).exists(), "{what}");
            assert!(ha.repo.find_reference("refs/bundles").is_err());
            let fresh = tmp.path().join(format!("new{n}"));
            assert!(import_new(&bad, &fresh).is_err(), "{what}");
            assert!(
                !fresh.join("paper").exists(),
                "{what}: no half-made project is left"
            );
        }

        // Comments that are not what they should be are dropped; the work still arrives.
        let odd = tmp.path().join("odd.emquad");
        let comment = serde_json::json!({
            "formatVersion": 1,
            "comments": [{
                "id": "../../evil", "path": "../outside.tex", "quote": "q", "authorId": "x",
                "authorName": "x", "createdAt": "t", "text": "<img src=x onerror=alert(1)>",
                "updatedAt": "t"
            }]
        });
        tamper(&reply, &odd, |entries| {
            entries.push((
                "comments.json".into(),
                serde_json::to_vec(&comment).unwrap(),
            ))
        });
        import_into(&a, &ha, &odd).unwrap();
        assert!(crate::comments::load(&a).unwrap().is_empty());
    }

    #[test]
    fn importing_twice_adds_nothing_and_already_merged_bundles_say_so() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let me = author("Tamer");
        let first = tmp.path().join("first.emquad");
        export(&a, &ha, &me, &first, "", &Extras::default()).unwrap();
        let err = import_into(&a, &ha, &first).unwrap_err();
        assert_eq!(err.code(), "already_merged");

        let b = import_new(&first, &tmp.path().join("b")).unwrap();
        let hb = History::open(&b).unwrap();
        b.write_file("main.tex", "from b\n").unwrap();
        let reply = tmp.path().join("reply.emquad");
        export(&b, &hb, &author("Lina"), &reply, "", &Extras::default()).unwrap();

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
    fn an_unsafe_name_anywhere_in_a_bundles_history_rejects_the_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let (c, hc) = new_project(&tmp.path().join("c"));
        let lina = author("Lina");
        // An older version holds a name that would alias another file on Windows; the newest
        // version is clean, so only a check of the whole history can catch it.
        let mut builder = hc.repo.treebuilder(None).unwrap();
        let blob = hc.repo.blob(b"alias").unwrap();
        builder.insert("draft~1.tex", blob, 0o100644).unwrap();
        let bad_tree = builder.write().unwrap();
        hc.commit(bad_tree, &[], &lina, "snapshot", "old", None)
            .unwrap();
        let file = tmp.path().join("c.emquad");
        export(&c, &hc, &lina, &file, "", &Extras::default()).unwrap();
        let err = import_new(&file, &tmp.path().join("elsewhere")).unwrap_err();
        assert_eq!(err.code(), "bundle_unsafe_path");
        assert!(!tmp.path().join("elsewhere").exists());
    }

    #[test]
    fn hostile_and_broken_bundles_are_rejected_and_leave_the_project_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let me = author("Tamer");
        let good = tmp.path().join("good.emquad");
        export(&a, &ha, &me, &good, "", &Extras::default()).unwrap();
        // Make the good bundle mergeable in principle: move A ahead of it on a different path.
        let b = import_new(&good, &tmp.path().join("b")).unwrap();
        let hb = History::open(&b).unwrap();
        b.write_file("main.tex", "from b\n").unwrap();
        let reply = tmp.path().join("reply.emquad");
        export(&b, &hb, &author("Lina"), &reply, "", &Extras::default()).unwrap();

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

        for outside in ["C:/Users/x/private.tex", "../../private.tex", ".git/config"] {
            tamper(&reply, &bad, |e| {
                let m = e.iter_mut().find(|(n, _)| n == "manifest.json").unwrap();
                let mut manifest: Manifest = serde_json::from_slice(&m.1).unwrap();
                manifest.project.main_file = outside.into();
                m.1 = serde_json::to_vec(&manifest).unwrap();
            });
            expect("bundle_invalid");
        }

        for alias in [
            "tree/.GIT/config",
            "tree/GIT~1/config",
            "tree/notes.tex.",
            "tree/aux.tex",
        ] {
            tamper(&reply, &bad, |e| e.push((alias.into(), b"x".to_vec())));
            expect("bundle_unsafe_path");
        }

        tamper(&reply, &bad, |e| {
            e.push(("tree/MAIN.TEX".into(), b"x".to_vec()))
        });
        expect("bundle_invalid");

        // A bundle from an unrelated project is refused for merging.
        let (c, hc) = new_project(&tmp.path().join("c"));
        let other = tmp.path().join("other.emquad");
        export(&c, &hc, &me, &other, "", &Extras::default()).unwrap();
        assert_eq!(
            import_into(&a, &ha, &other).unwrap_err().code(),
            "bundle_other_project"
        );
        assert_eq!(read_all(&a), before);
    }
}
