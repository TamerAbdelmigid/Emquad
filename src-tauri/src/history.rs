//! Versions are commits in a bare repository at `.emquad/history.git`.
//!
//! Trees are built from, and written back to, the project folder by this module rather than by
//! git's index and checkout. That keeps file bytes untouched (no line-ending conversion) and
//! leaves any git repository the user keeps in the same folder alone.

use crate::diff::{Block, diff_blocks};
use crate::error::{Error, Result};
use crate::project::{Project, as_text, atomic_write};
use git2::{ObjectType, Oid, Repository, Signature, Sort, Tree};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::Path;
use ts_rs::TS;

pub const MAIN: &str = "refs/heads/main";
pub const WORKING: &str = "working";

#[derive(Debug, Clone)]
pub struct Author {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Version {
    pub id: String,
    /// snapshot, export, automatic, merge, restore
    pub kind: String,
    pub label: String,
    pub author: String,
    pub author_id: String,
    /// Seconds since the Unix epoch.
    #[ts(type = "number")]
    pub time: i64,
    pub parents: Vec<String>,
    /// Set when this version is the head of an imported bundle.
    pub bundle_id: Option<String>,
    /// An imported bundle that has not been merged yet.
    pub pending: bool,
    /// Made by this project's own line of work rather than only present in a bundle.
    pub on_main: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HistoryList {
    pub versions: Vec<Version>,
    pub head: Option<String>,
    /// The working copy differs from the latest version.
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChangedFile {
    pub path: String,
    /// added, modified or deleted
    pub status: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileDiff {
    pub path: String,
    /// Empty when the file is not text.
    pub blocks: Vec<Block>,
    pub binary: bool,
}

pub struct History {
    pub repo: Repository,
}

fn trailer<'a>(message: &'a str, key: &str) -> Option<&'a str> {
    message
        .lines()
        .rev()
        .find_map(|l| l.strip_prefix(key)?.strip_prefix(": "))
}

impl History {
    pub fn open(project: &Project) -> Result<History> {
        let dir = project.history_dir();
        let repo = if dir.join("HEAD").exists() {
            Repository::open_bare(&dir)?
        } else {
            fs::create_dir_all(&dir)?;
            let repo = Repository::init_bare(&dir)?;
            repo.set_head(MAIN)?;
            repo
        };
        Ok(History { repo })
    }

    pub fn head(&self) -> Option<Oid> {
        self.repo.refname_to_id(MAIN).ok()
    }

    pub fn parse_id(&self, id: &str) -> Result<Oid> {
        let oid = Oid::from_str(id).map_err(|_| Error::app("not_found", "Unknown version"))?;
        self.repo
            .find_commit(oid)
            .map_err(|_| Error::app("not_found", "Unknown version"))?;
        Ok(oid)
    }

    fn tree_from_dir(&self, dir: &Path, root: bool) -> Result<Option<Oid>> {
        let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<std::io::Result<_>>()?;
        entries.sort_by_key(|e| e.file_name());
        let mut builder = self.repo.treebuilder(None)?;
        for entry in entries {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if root && (name.eq_ignore_ascii_case(crate::project::DATA_DIR) || name == ".git") {
                continue;
            }
            let ty = entry.file_type()?;
            if ty.is_dir() {
                if let Some(sub) = self.tree_from_dir(&entry.path(), false)? {
                    builder.insert(name, sub, 0o040000)?;
                }
            } else if ty.is_file() {
                let blob = self.repo.blob(&fs::read(entry.path())?)?;
                builder.insert(name, blob, 0o100644)?;
            }
        }
        if builder.is_empty() && !root {
            return Ok(None);
        }
        Ok(Some(builder.write()?))
    }

    /// Store the folder's current files and return the tree that describes them.
    pub fn tree_of_dir(&self, dir: &Path) -> Result<Oid> {
        Ok(self
            .tree_from_dir(dir, true)?
            .expect("root tree always exists"))
    }

    pub fn is_dirty(&self, project: &Project) -> Result<bool> {
        let work = self.tree_of_dir(&project.root)?;
        Ok(match self.head() {
            Some(head) => self.repo.find_commit(head)?.tree_id() != work,
            None => true,
        })
    }

    pub fn commit(
        &self,
        tree: Oid,
        parents: &[Oid],
        author: &Author,
        kind: &str,
        label: &str,
        bundle_id: Option<&str>,
    ) -> Result<Oid> {
        let sig = Signature::now(&author.name, &format!("{}@emquad.invalid", author.id))?;
        let mut message = format!("{label}\n\nEmquad-Kind: {kind}\n");
        if let Some(id) = bundle_id {
            message.push_str(&format!("Emquad-Bundle: {id}\n"));
        }
        let tree = self.repo.find_tree(tree)?;
        let parent_commits: Vec<_> = parents
            .iter()
            .map(|p| self.repo.find_commit(*p))
            .collect::<std::result::Result<_, _>>()?;
        let refs: Vec<&git2::Commit> = parent_commits.iter().collect();
        Ok(self
            .repo
            .commit(Some(MAIN), &sig, &sig, &message, &tree, &refs)?)
    }

    /// Record the working copy as a version. Automatic snapshots are skipped when nothing changed.
    pub fn snapshot(
        &self,
        project: &Project,
        author: &Author,
        kind: &str,
        label: &str,
    ) -> Result<Oid> {
        let tree = self.tree_of_dir(&project.root)?;
        let head = self.head();
        if let Some(head) = head
            && kind == "automatic"
            && self.repo.find_commit(head)?.tree_id() == tree
        {
            return Ok(head);
        }
        let parents: Vec<Oid> = head.into_iter().collect();
        self.commit(tree, &parents, author, kind, label, None)
    }

    fn bundle_refs(&self) -> Result<HashMap<Oid, String>> {
        let mut out = HashMap::new();
        for r in self.repo.references_glob("refs/bundles/*")? {
            let r = r?;
            if let (Ok(name), Some(target)) = (r.name(), r.target()) {
                out.insert(target, name.trim_start_matches("refs/bundles/").to_string());
            }
        }
        Ok(out)
    }

    pub fn bundle_head(&self, bundle_id: &str) -> Result<Oid> {
        self.repo
            .refname_to_id(&format!("refs/bundles/{bundle_id}"))
            .map_err(|_| Error::app("not_found", "That bundle has not been imported"))
    }

    pub fn is_ancestor(&self, ancestor: Oid, of: Oid) -> Result<bool> {
        Ok(ancestor == of || self.repo.graph_descendant_of(of, ancestor)?)
    }

    pub fn list(&self, project: &Project) -> Result<HistoryList> {
        let head = self.head();
        let bundles = self.bundle_refs()?;
        let mut on_main = HashSet::new();
        if let Some(head) = head {
            let mut walk = self.repo.revwalk()?;
            walk.push(head)?;
            for oid in walk {
                on_main.insert(oid?);
            }
        }
        let mut walk = self.repo.revwalk()?;
        walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
        if let Some(head) = head {
            walk.push(head)?;
        }
        for oid in bundles.keys() {
            walk.push(*oid)?;
        }
        let mut versions = Vec::new();
        for oid in walk {
            let oid = oid?;
            let commit = self.repo.find_commit(oid)?;
            let message = commit.message().unwrap_or_default();
            let author = commit.author();
            let bundle_id = bundles.get(&oid).cloned();
            versions.push(Version {
                id: oid.to_string(),
                kind: trailer(message, "Emquad-Kind").unwrap_or("snapshot").into(),
                label: commit.summary().ok().flatten().unwrap_or_default().into(),
                author: author.name().unwrap_or_default().into(),
                author_id: author
                    .email()
                    .unwrap_or_default()
                    .trim_end_matches("@emquad.invalid")
                    .into(),
                time: commit.time().seconds(),
                parents: commit.parent_ids().map(|p| p.to_string()).collect(),
                pending: bundle_id.is_some() && !on_main.contains(&oid),
                bundle_id,
                on_main: on_main.contains(&oid),
            });
        }
        Ok(HistoryList {
            versions,
            head: head.map(|h| h.to_string()),
            dirty: self.is_dirty(project)?,
        })
    }

    /// The tree for a version id, or for the working copy when `spec` is "working".
    pub fn tree_for(&self, project: &Project, spec: &str) -> Result<Oid> {
        if spec == WORKING {
            self.tree_of_dir(&project.root)
        } else {
            Ok(self.repo.find_commit(self.parse_id(spec)?)?.tree_id())
        }
    }

    fn empty_tree(&self) -> Result<Oid> {
        Ok(self.repo.treebuilder(None)?.write()?)
    }

    /// What a version is naturally compared with: the working copy against the latest version,
    /// a pending bundle against the common ancestor, anything else against its first parent.
    pub fn natural_base(&self, spec: &str) -> Result<Oid> {
        if spec == WORKING {
            return match self.head() {
                Some(h) => Ok(self.repo.find_commit(h)?.tree_id()),
                None => self.empty_tree(),
            };
        }
        let oid = self.parse_id(spec)?;
        if let Some(head) = self.head()
            && self.bundle_refs()?.contains_key(&oid)
            && !self.is_ancestor(oid, head)?
            && let Ok(base) = self.repo.merge_base(head, oid)
        {
            return Ok(self.repo.find_commit(base)?.tree_id());
        }
        match self.repo.find_commit(oid)?.parent(0) {
            Ok(parent) => Ok(parent.tree_id()),
            Err(_) => self.empty_tree(),
        }
    }

    /// Every file in a tree, by forward-slash path.
    pub fn files_in(&self, tree: Oid) -> Result<BTreeMap<String, Oid>> {
        fn walk(
            repo: &Repository,
            tree: &Tree,
            prefix: &str,
            out: &mut BTreeMap<String, Oid>,
        ) -> Result<()> {
            for entry in tree.iter() {
                let Ok(name) = entry.name() else { continue };
                let path = if prefix.is_empty() {
                    name.to_string()
                } else {
                    format!("{prefix}/{name}")
                };
                match entry.kind() {
                    Some(ObjectType::Tree) => walk(repo, &repo.find_tree(entry.id())?, &path, out)?,
                    Some(ObjectType::Blob) => {
                        out.insert(path, entry.id());
                    }
                    _ => {}
                }
            }
            Ok(())
        }
        let mut out = BTreeMap::new();
        walk(&self.repo, &self.repo.find_tree(tree)?, "", &mut out)?;
        Ok(out)
    }

    pub fn blob(&self, id: Oid) -> Result<Vec<u8>> {
        Ok(self.repo.find_blob(id)?.content().to_vec())
    }

    pub fn changed_files(&self, old: Oid, new: Oid) -> Result<Vec<ChangedFile>> {
        let (a, b) = (self.files_in(old)?, self.files_in(new)?);
        let mut out = Vec::new();
        for (path, id) in &b {
            match a.get(path) {
                None => out.push(ChangedFile {
                    path: path.clone(),
                    status: "added".into(),
                }),
                Some(old_id) if old_id != id => out.push(ChangedFile {
                    path: path.clone(),
                    status: "modified".into(),
                }),
                _ => {}
            }
        }
        for path in a.keys().filter(|p| !b.contains_key(*p)) {
            out.push(ChangedFile {
                path: path.clone(),
                status: "deleted".into(),
            });
        }
        out.sort_by(|x, y| x.path.cmp(&y.path));
        Ok(out)
    }

    pub fn file_diff(&self, old: Oid, new: Oid, path: &str) -> Result<FileDiff> {
        let read = |tree: Oid| -> Result<Vec<u8>> {
            match self.files_in(tree)?.get(path) {
                Some(id) => self.blob(*id),
                None => Ok(Vec::new()),
            }
        };
        let (a, b) = (read(old)?, read(new)?);
        match (as_text(&a), as_text(&b)) {
            (Some(a), Some(b)) => Ok(FileDiff {
                path: path.into(),
                blocks: diff_blocks(a, b),
                binary: false,
            }),
            _ => Ok(FileDiff {
                path: path.into(),
                blocks: Vec::new(),
                binary: true,
            }),
        }
    }

    /// Make the project folder's files identical to a tree: write what differs, remove the rest.
    pub fn checkout(&self, project: &Project, tree: Oid) -> Result<()> {
        let wanted = self.files_in(tree)?;
        for (rel, path) in project.walk_files()? {
            if !wanted.contains_key(&rel) {
                fs::remove_file(&path)?;
                let mut dir = path.parent();
                while let Some(d) = dir.filter(|d| *d != project.root) {
                    if fs::remove_dir(d).is_err() {
                        break;
                    }
                    dir = d.parent();
                }
            }
        }
        for (rel, id) in &wanted {
            let path = project.resolve(rel)?;
            let same = fs::read(&path)
                .ok()
                .and_then(|bytes| Oid::hash_object(ObjectType::Blob, &bytes).ok())
                == Some(*id);
            if !same {
                atomic_write(&path, &self.blob(*id)?)?;
            }
        }
        Ok(())
    }

    /// Go back to a version. Nothing is rewritten: the pre-restore state is snapshotted first and
    /// the restored state is recorded as a new version.
    pub fn restore(&self, project: &Project, author: &Author, version: &str) -> Result<Oid> {
        let target = self.repo.find_commit(self.parse_id(version)?)?;
        let label = target.summary().ok().flatten().unwrap_or("version").to_string();
        self.snapshot(
            project,
            author,
            "automatic",
            &format!("Before restoring {label}"),
        )?;
        self.checkout(project, target.tree_id())?;
        self.snapshot(project, author, "restore", &format!("Restored {label}"))
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub fn author(name: &str) -> Author {
        Author {
            id: format!("id-{name}"),
            name: name.into(),
        }
    }

    pub fn read_all(p: &Project) -> BTreeMap<String, Vec<u8>> {
        p.walk_files()
            .unwrap()
            .into_iter()
            .map(|(rel, path)| (rel, fs::read(path).unwrap()))
            .collect()
    }

    pub fn new_project(dir: &Path) -> (Project, History) {
        let p = Project::create(dir, "paper", "article").unwrap();
        let h = History::open(&p).unwrap();
        (p, h)
    }

    #[test]
    fn snapshots_persist_and_list_newest_first() {
        let tmp = tempfile::tempdir().unwrap();
        let (p, h) = new_project(&tmp.path().join("p"));
        let me = author("Tamer");
        let first = h.snapshot(&p, &me, "snapshot", "Draft 1").unwrap();
        // Unchanged: an automatic snapshot is skipped, a named one is not.
        assert_eq!(h.snapshot(&p, &me, "automatic", "auto").unwrap(), first);
        p.write_file("main.tex", "changed\n").unwrap();
        h.snapshot(&p, &me, "snapshot", "Draft 2").unwrap();

        let reopened = History::open(&p).unwrap();
        let list = reopened.list(&p).unwrap();
        let labels: Vec<_> = list.versions.iter().map(|v| v.label.as_str()).collect();
        assert_eq!(labels, ["Draft 2", "Draft 1"]);
        assert_eq!(list.versions[0].author, "Tamer");
        assert_eq!(list.versions[0].author_id, "id-Tamer");
        assert!(!list.dirty);
    }

    #[test]
    fn restore_is_byte_exact_removes_extra_files_and_keeps_the_prior_state() {
        let tmp = tempfile::tempdir().unwrap();
        let (p, h) = new_project(&tmp.path().join("p"));
        let me = author("Tamer");
        p.write_file("sections/a.tex", "crlf\r\nline\r\n").unwrap();
        fs::write(p.root.join("fig.bin"), [0u8, 1, 2, 255]).unwrap();
        let v1 = h.snapshot(&p, &me, "snapshot", "Draft 1").unwrap();
        let state1 = read_all(&p);

        p.write_file("sections/a.tex", "edited\n").unwrap();
        p.write_file("extra/new.tex", "new\n").unwrap();
        p.delete("fig.bin").unwrap();
        let state2 = read_all(&p);

        h.restore(&p, &me, &v1.to_string()).unwrap();
        assert_eq!(read_all(&p), state1);
        assert!(!p.root.join("extra").exists());

        // The unsaved state from before the restore is itself restorable.
        let list = h.list(&p).unwrap();
        let before = list
            .versions
            .iter()
            .find(|v| v.label.starts_with("Before restoring"))
            .unwrap();
        h.restore(&p, &me, &before.id).unwrap();
        assert_eq!(read_all(&p), state2);
    }

    #[test]
    fn diffs_cover_added_deleted_modified_and_binary_files() {
        let tmp = tempfile::tempdir().unwrap();
        let (p, h) = new_project(&tmp.path().join("p"));
        let me = author("Tamer");
        p.write_file("a.tex", "one\r\ntwo\r\n").unwrap();
        p.write_file("gone.tex", "x\n").unwrap();
        fs::write(p.root.join("fig.bin"), [0u8, 1]).unwrap();
        let v1 = h.snapshot(&p, &me, "snapshot", "Draft 1").unwrap();
        p.write_file("a.tex", "one\r\nTWO\r\n").unwrap();
        p.delete("gone.tex").unwrap();
        p.write_file("new.tex", "n\n").unwrap();
        fs::write(p.root.join("fig.bin"), [0u8, 2]).unwrap();

        let old = h.repo.find_commit(v1).unwrap().tree_id();
        let new = h.tree_for(&p, WORKING).unwrap();
        assert_eq!(h.natural_base(WORKING).unwrap(), old);
        let changed: Vec<_> = h
            .changed_files(old, new)
            .unwrap()
            .into_iter()
            .map(|c| (c.path, c.status))
            .collect();
        assert_eq!(
            changed,
            [
                ("a.tex".to_string(), "modified".to_string()),
                ("fig.bin".into(), "modified".into()),
                ("gone.tex".into(), "deleted".into()),
                ("new.tex".into(), "added".into()),
            ]
        );
        assert!(h.file_diff(old, new, "fig.bin").unwrap().binary);
        let d = h.file_diff(old, new, "a.tex").unwrap();
        assert!(matches!(&d.blocks[1], Block::Change { new_text, .. } if new_text == "TWO\r\n"));
    }

    #[test]
    fn the_users_own_git_repository_is_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("p");
        let (p, h) = new_project(&dir);
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".git/config"), "theirs").unwrap();
        let v = h.snapshot(&p, &author("Tamer"), "snapshot", "Draft 1").unwrap();
        let files = h.files_in(h.repo.find_commit(v).unwrap().tree_id()).unwrap();
        assert_eq!(files.keys().collect::<Vec<_>>(), ["main.tex"]);
        h.checkout(&p, h.repo.find_commit(v).unwrap().tree_id()).unwrap();
        assert_eq!(fs::read(dir.join(".git/config")).unwrap(), b"theirs");
    }
}
