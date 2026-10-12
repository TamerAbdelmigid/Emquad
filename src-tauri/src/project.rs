//! A project is an ordinary folder of the user's files plus a `.emquad/` directory for app data.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use ts_rs::TS;

pub const DATA_DIR: &str = ".emquad";
pub const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectInfo {
    pub format_version: u32,
    pub project_id: String,
    pub name: String,
    pub main_file: String,
    pub engine: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileContent {
    /// `None` when the file is not text.
    pub text: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Project {
    pub root: PathBuf,
    pub info: ProjectInfo,
}

/// Text means valid UTF-8 with no NUL byte.
pub fn as_text(bytes: &[u8]) -> Option<&str> {
    if bytes.contains(&0) {
        return None;
    }
    std::str::from_utf8(bytes).ok()
}

/// Write through a temporary file in the same directory so a failure never leaves a partial file.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::app("bad_path", "File has no parent directory"))?;
    fs::create_dir_all(parent)?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    tmp.write_all(bytes)?;
    tmp.flush()?;
    // On Windows the destination can be held open for a moment by another reader (a virus
    // scanner, a file watcher), which makes the replace fail. A short retry rides that out.
    let mut attempts = 0;
    loop {
        match tmp.persist(path) {
            Ok(_) => return Ok(()),
            Err(e) if attempts < 20 && e.error.kind() == std::io::ErrorKind::PermissionDenied => {
                attempts += 1;
                tmp = e.file;
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            Err(e) => return Err(Error::Io(e.error)),
        }
    }
}

/// Validate a project-relative path and split it into its components.
/// Rejects absolute paths, `..`, and anything inside the app's own data directory.
pub fn clean_rel(rel: &str) -> Result<Vec<String>> {
    let rel = rel.replace('\\', "/");
    let mut parts = Vec::new();
    for comp in Path::new(&rel).components() {
        match comp {
            Component::Normal(s) => {
                let s = s
                    .to_str()
                    .ok_or_else(|| Error::app("bad_path", "Path is not valid Unicode"))?;
                parts.push(s.to_string());
            }
            Component::CurDir => {}
            _ => {
                return Err(Error::app(
                    "bad_path",
                    format!("\"{rel}\" is outside the project"),
                ));
            }
        }
    }
    if parts.first().map(|p| p.eq_ignore_ascii_case(DATA_DIR)) == Some(true) {
        return Err(Error::app(
            "bad_path",
            "That folder is reserved for Emquad's own data",
        ));
    }
    Ok(parts)
}

fn skip_at_root(name: &str) -> bool {
    name.eq_ignore_ascii_case(DATA_DIR) || name == ".git"
}

impl Project {
    pub fn data_dir(&self) -> PathBuf {
        self.root.join(DATA_DIR)
    }
    pub fn build_dir(&self) -> PathBuf {
        self.data_dir().join("build")
    }
    pub fn history_dir(&self) -> PathBuf {
        self.data_dir().join("history.git")
    }
    pub fn incoming_dir(&self, bundle_id: &str) -> PathBuf {
        self.data_dir().join("incoming").join(bundle_id)
    }

    pub fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let parts = clean_rel(rel)?;
        Ok(parts.iter().fold(self.root.clone(), |p, c| p.join(c)))
    }

    pub fn save_info(&self) -> Result<()> {
        let json = serde_json::to_vec_pretty(&self.info)?;
        atomic_write(&self.data_dir().join("project.json"), &json)
    }

    /// Create a new project folder from a template. The folder must not already hold files.
    pub fn create(dir: &Path, name: &str, template: &str) -> Result<Project> {
        if dir.exists() && fs::read_dir(dir)?.next().is_some() {
            return Err(Error::app(
                "not_empty",
                format!("{} already contains files", dir.display()),
            ));
        }
        fs::create_dir_all(dir)?;
        for (path, content) in crate::templates::files(template, name) {
            atomic_write(&dir.join(path), content.as_bytes())?;
        }
        Self::adopt(dir, name, None)
    }

    /// Open a folder. A folder that has never been opened becomes a project on the spot.
    pub fn open(dir: &Path) -> Result<Project> {
        if !dir.is_dir() {
            return Err(Error::app(
                "not_found",
                format!("{} is not a folder", dir.display()),
            ));
        }
        let info_path = dir.join(DATA_DIR).join("project.json");
        if info_path.exists() {
            let info: ProjectInfo = serde_json::from_slice(&fs::read(&info_path)?)?;
            if info.format_version > FORMAT_VERSION {
                return Err(Error::app(
                    "newer_format",
                    "This project was made by a newer version of Emquad",
                ));
            }
            return Ok(Project {
                root: dir.to_path_buf(),
                info,
            });
        }
        let name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project")
            .to_string();
        Self::adopt(dir, &name, None)
    }

    /// Write `project.json` for a folder, reusing `info` when the identity comes from a bundle.
    pub fn adopt(dir: &Path, name: &str, info: Option<ProjectInfo>) -> Result<Project> {
        let mut project = Project {
            root: dir.to_path_buf(),
            info: info.unwrap_or_else(|| ProjectInfo {
                format_version: FORMAT_VERSION,
                project_id: uuid::Uuid::new_v4().to_string(),
                name: name.to_string(),
                main_file: String::new(),
                engine: "auto".into(),
            }),
        };
        if project.info.main_file.is_empty() || !project.root.join(&project.info.main_file).exists()
        {
            project.info.main_file = project.guess_main()?;
        }
        project.save_info()?;
        Ok(project)
    }

    fn guess_main(&self) -> Result<String> {
        let files = self.walk_files()?;
        let tex: Vec<&(String, PathBuf)> = files
            .iter()
            .filter(|(rel, _)| rel.ends_with(".tex"))
            .collect();
        if let Some((rel, _)) = tex.iter().find(|(rel, _)| rel == "main.tex") {
            return Ok(rel.clone());
        }
        for (rel, path) in &tex {
            if let Ok(bytes) = fs::read(path)
                && as_text(&bytes).is_some_and(|t| t.contains("\\documentclass"))
            {
                return Ok(rel.clone());
            }
        }
        Ok(tex.first().map(|(rel, _)| rel.clone()).unwrap_or_default())
    }

    /// Every user file, as (forward-slash relative path, absolute path), sorted by path.
    pub fn walk_files(&self) -> Result<Vec<(String, PathBuf)>> {
        fn walk(dir: &Path, prefix: &str, out: &mut Vec<(String, PathBuf)>) -> Result<()> {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if prefix.is_empty() && skip_at_root(&name) {
                    continue;
                }
                let rel = if prefix.is_empty() {
                    name
                } else {
                    format!("{prefix}/{name}")
                };
                let ty = entry.file_type()?;
                if ty.is_dir() {
                    walk(&entry.path(), &rel, out)?;
                } else if ty.is_file() {
                    out.push((rel, entry.path()));
                }
            }
            Ok(())
        }
        let mut out = Vec::new();
        walk(&self.root, "", &mut out)?;
        out.sort();
        Ok(out)
    }

    pub fn tree(&self) -> Result<Vec<TreeNode>> {
        fn walk(dir: &Path, prefix: &str) -> Result<Vec<TreeNode>> {
            let mut nodes = Vec::new();
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if prefix.is_empty() && skip_at_root(&name) {
                    continue;
                }
                let path = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                let is_dir = entry.file_type()?.is_dir();
                let children = if is_dir {
                    walk(&entry.path(), &path)?
                } else {
                    Vec::new()
                };
                nodes.push(TreeNode {
                    name,
                    path,
                    is_dir,
                    children,
                });
            }
            nodes.sort_by(|a, b| {
                b.is_dir
                    .cmp(&a.is_dir)
                    .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            });
            Ok(nodes)
        }
        walk(&self.root, "")
    }

    pub fn read_file(&self, rel: &str) -> Result<FileContent> {
        let bytes = fs::read(self.resolve(rel)?)?;
        Ok(FileContent {
            text: as_text(&bytes).map(str::to_string),
        })
    }

    pub fn write_file(&self, rel: &str, text: &str) -> Result<()> {
        atomic_write(&self.resolve(rel)?, text.as_bytes())
    }

    pub fn create_entry(&self, rel: &str, is_dir: bool) -> Result<()> {
        let path = self.resolve(rel)?;
        if path.exists() {
            return Err(Error::app("exists", format!("{rel} already exists")));
        }
        if is_dir {
            fs::create_dir_all(path)?;
        } else {
            atomic_write(&path, b"")?;
        }
        Ok(())
    }

    pub fn rename(&self, from: &str, to: &str) -> Result<()> {
        let (src, dst) = (self.resolve(from)?, self.resolve(to)?);
        if src == self.root {
            return Err(Error::app("bad_path", "Cannot rename the project folder"));
        }
        if dst.exists() {
            return Err(Error::app("exists", format!("{to} already exists")));
        }
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(src, dst)?;
        Ok(())
    }

    pub fn delete(&self, rel: &str) -> Result<()> {
        let path = self.resolve(rel)?;
        if path == self.root {
            return Err(Error::app("bad_path", "Cannot delete the project folder"));
        }
        if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    /// Copy files from elsewhere on disk into a project folder.
    pub fn import_files(&self, sources: &[PathBuf], dest_dir: &str) -> Result<()> {
        let dest = self.resolve(dest_dir)?;
        fs::create_dir_all(&dest)?;
        for src in sources {
            let name = src
                .file_name()
                .ok_or_else(|| Error::app("bad_path", "Source has no file name"))?;
            fs::copy(src, dest.join(name))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_outside_the_project() {
        for bad in [
            "../x.tex",
            "a/../../x",
            "/etc/passwd",
            "C:\\Windows\\x",
            ".emquad/project.json",
            ".EMQUAD/x",
            "..\\x",
        ] {
            assert!(clean_rel(bad).is_err(), "{bad} should be rejected");
        }
        assert_eq!(clean_rel("a\\b/./c.tex").unwrap(), ["a", "b", "c.tex"]);
    }

    #[test]
    fn create_edit_rename_delete_with_awkward_names() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("my paper");
        let p = Project::create(&dir, "my paper", "article").unwrap();
        assert_eq!(p.info.main_file, "main.tex");

        p.create_entry("sections", true).unwrap();
        p.write_file("sections/intro é ü.tex", "héllo\r\n").unwrap();
        assert_eq!(
            p.read_file("sections/intro é ü.tex").unwrap().text.unwrap(),
            "héllo\r\n"
        );
        p.rename("sections/intro é ü.tex", "sections/first part.tex")
            .unwrap();
        assert!(p.rename("main.tex", "sections/first part.tex").is_err());
        p.delete("sections").unwrap();

        let files: Vec<String> = p.walk_files().unwrap().into_iter().map(|f| f.0).collect();
        assert_eq!(files, ["main.tex"]);
        let reopened = Project::open(&dir).unwrap();
        assert_eq!(reopened.info.project_id, p.info.project_id);
    }

    #[test]
    fn opening_a_plain_folder_adopts_it_and_hides_app_data() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("notes.tex"), "plain").unwrap();
        fs::write(tmp.path().join("thesis.tex"), "\\documentclass{book}").unwrap();
        fs::write(tmp.path().join("fig.png"), [0u8, 159, 146, 150]).unwrap();
        let p = Project::open(tmp.path()).unwrap();
        assert_eq!(p.info.main_file, "thesis.tex");
        assert!(p.read_file("fig.png").unwrap().text.is_none());
        assert!(p.tree().unwrap().iter().all(|n| n.name != DATA_DIR));
    }
}
