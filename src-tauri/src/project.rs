//! A project is an ordinary folder of the user's files plus a `.emquad/` directory for app data.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use ts_rs::TS;

pub const DATA_DIR: &str = ".emquad";
pub const FORMAT_VERSION: u32 = 1;
pub const ENGINES: [&str; 3] = ["auto", "tectonic", "latexmk"];

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectInfo {
    pub format_version: u32,
    pub project_id: String,
    pub name: String,
    pub main_file: String,
    pub engine: String,
    /// The language this project's spelling is checked in, or "" for the app's own choice.
    #[serde(default)]
    pub spellcheck: String,
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

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchHit {
    pub path: String,
    /// 1-based line and column of the match.
    pub line: u32,
    pub column: u32,
    /// The line the match is on, trimmed.
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// There were more matches than are returned.
    pub truncated: bool,
}

/// The 1-based column, in the line as written, of a match found at `byte` of the line as searched.
/// Lower-casing can lengthen a character (`İ` becomes two), so the two do not always line up.
fn original_column(line: &str, byte: usize, match_case: bool) -> u32 {
    if match_case {
        return line[..byte].chars().count() as u32 + 1;
    }
    let mut seen = 0;
    for (index, c) in line.chars().enumerate() {
        if seen >= byte {
            return index as u32 + 1;
        }
        seen += c.to_lowercase().map(char::len_utf8).sum::<usize>();
    }
    line.chars().count() as u32 + 1
}

/// The most matches a search returns; beyond this the user should narrow the query.
pub const MAX_SEARCH_HITS: usize = 500;
/// The largest file project search reads.
const MAX_SEARCHED: u64 = 16 << 20;
/// Kinds of file project search does not read, since they are not text.
const NOT_TEXT: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "eps", "ps", "svgz", "zip",
    "gz", "emquad", "docx", "xlsx", "pptx", "otf", "ttf", "woff", "woff2", "mp4", "mov",
];

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

/// The kinds of picture LaTeX shows, by extension.
pub const PICTURES: [&str; 4] = ["png", "jpg", "jpeg", "pdf"];
/// The most a picture added to a project may weigh.
pub const MAX_PICTURE: u64 = 64 << 20;

/// Copy a file to `dest` only if nothing is there, through a temporary file so that a failure
/// never leaves part of one.
fn copy_new(src: &Path, dest: &Path) -> Result<()> {
    let parent = dest
        .parent()
        .ok_or_else(|| Error::app("bad_path", "File has no parent directory"))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    std::io::copy(&mut fs::File::open(src)?, &mut tmp)?;
    tmp.flush()?;
    tmp.persist_noclobber(dest).map_err(|e| {
        if e.error.kind() == std::io::ErrorKind::AlreadyExists {
            Error::app(
                "exists",
                format!(
                    "The project has {} already.",
                    dest.file_name().unwrap_or_default().to_string_lossy()
                ),
            )
        } else {
            Error::Io(e.error)
        }
    })?;
    Ok(())
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

/// Check one path component: it must be a name that means the same thing on every supported
/// filesystem. Windows quietly maps several spellings onto one file (trailing dots and spaces,
/// "~1" short names, device names, "name:stream"), which would let a crafted name reach a folder
/// it does not appear to name, such as `.git` or the app's own data.
pub fn check_component(name: &str) -> Result<()> {
    let bad = |why: &str| {
        Err(Error::app(
            "bad_path",
            format!("{name:?} cannot be used as a file name: {why}"),
        ))
    };
    if name.is_empty() || name == "." || name == ".." {
        return bad("it is not a name");
    }
    if name
        .chars()
        .any(|c| c.is_control() || "<>:\"|?*/\\".contains(c))
    {
        return bad("it contains a character that is not allowed");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return bad("it ends with a dot or a space");
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let numbered = |prefix: &str| {
        stem.len() == 4 && stem.starts_with(prefix) && matches!(stem.as_bytes()[3], b'1'..=b'9')
    };
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || numbered("COM") || numbered("LPT")
    {
        return bad("it is a reserved device name");
    }
    if name
        .as_bytes()
        .windows(2)
        .any(|w| w[0] == b'~' && w[1].is_ascii_digit())
    {
        return bad("it looks like a Windows short name");
    }
    if name.eq_ignore_ascii_case(".git") {
        return bad("it is reserved for git");
    }
    Ok(())
}

/// Validate a project-relative path and split it into its components.
/// Rejects absolute paths, `..`, unsafe names (see `check_component`), and anything inside the
/// app's own data directory.
pub fn clean_rel(rel: &str) -> Result<Vec<String>> {
    let rel = rel.replace('\\', "/");
    if rel.starts_with('/') {
        return Err(Error::app(
            "bad_path",
            format!("{rel:?} is outside the project"),
        ));
    }
    let mut parts = Vec::new();
    for part in rel.split('/').filter(|p| !p.is_empty() && *p != ".") {
        check_component(part)?;
        parts.push(part.to_string());
    }
    if parts.first().map(|p| p.eq_ignore_ascii_case(DATA_DIR)) == Some(true) {
        return Err(Error::app(
            "bad_path",
            "That folder is reserved for Emquad's own data",
        ));
    }
    Ok(parts)
}

/// Whether the app deals with a directory entry at all. Entries it cannot name safely are
/// left completely alone: not listed, not stored in versions, and never deleted.
pub fn is_tracked(name: &str, at_root: bool) -> bool {
    check_component(name).is_ok() && !(at_root && name.eq_ignore_ascii_case(DATA_DIR))
}

/// Delete a file, riding out the brief sharing violations Windows produces.
pub fn remove_file_retry(path: &Path) -> Result<()> {
    let mut attempts = 0;
    loop {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) if attempts < 20 && e.kind() == std::io::ErrorKind::PermissionDenied => {
                attempts += 1;
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            Err(e) => return Err(Error::Io(e)),
        }
    }
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

    /// The picture file a document means by `name`: the file itself, or the first that exists
    /// with one of the extensions LaTeX would try. Pictures over 30 MB are not offered.
    pub fn find_image(&self, name: &str) -> Result<Option<PathBuf>> {
        const EXTENSIONS: [&str; 5] = ["", ".pdf", ".png", ".jpg", ".jpeg"];
        const SHOWN: [&str; 6] = ["pdf", "png", "jpg", "jpeg", "gif", "webp"];
        // Where LaTeX looks: as written, then in each folder named by \graphicspath. A folder
        // outside the project is not looked in.
        let mut folders = vec![String::new()];
        folders.extend(self.graphics_paths());
        for (folder, extension) in folders
            .iter()
            .flat_map(|f| EXTENSIONS.iter().map(move |e| (f, e)))
        {
            let Ok(path) = self.resolve(&format!("{folder}{}{extension}", name.trim())) else {
                continue;
            };
            let shown = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| SHOWN.contains(&e.to_ascii_lowercase().as_str()));
            if shown && fs::metadata(&path).is_ok_and(|m| m.is_file() && m.len() <= 30 << 20) {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }

    /// The folders named by `\graphicspath` in the project's `.tex` files, each ending in `/`.
    pub fn graphics_paths(&self) -> Vec<String> {
        let all = regex::Regex::new(r"\\graphicspath\s*\{((?:\s*\{[^{}]*\})+)\s*\}").unwrap();
        let one = regex::Regex::new(r"\{([^{}]*)\}").unwrap();
        let mut out = Vec::new();
        for (rel, path) in self.walk_files().unwrap_or_default() {
            if !rel.ends_with(".tex") {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else { continue };
            let Some(text) = as_text(&bytes) else {
                continue;
            };
            for line in text.lines().filter(|l| !l.trim_start().starts_with('%')) {
                for c in all.captures_iter(line) {
                    for d in one.captures_iter(&c[1]) {
                        let dir = d[1].trim().trim_start_matches("./").replace('\\', "/");
                        let dir = if dir.is_empty() || dir.ends_with('/') {
                            dir
                        } else {
                            format!("{dir}/")
                        };
                        if !out.contains(&dir) {
                            out.push(dir);
                        }
                    }
                }
            }
        }
        out
    }

    pub fn save_info(&self) -> Result<()> {
        let json = serde_json::to_vec_pretty(&self.info)?;
        atomic_write(&self.data_dir().join("project.json"), &json)
    }

    /// Choose which compiler this project uses: "auto", "tectonic" or "latexmk".
    pub fn set_engine(&mut self, engine: &str) -> Result<()> {
        if !ENGINES.contains(&engine) {
            return Err(Error::app(
                "bad_engine",
                format!("{engine:?} is not a compiler Emquad knows"),
            ));
        }
        self.info.engine = engine.to_string();
        self.save_info()
    }

    /// Check this project's spelling in `language`, or in the app's language when it is "".
    pub fn set_spellcheck(&mut self, language: &str) -> Result<()> {
        if !language.is_empty() && !crate::settings::SPELLCHECK.contains(&language) {
            return Err(Error::app(
                "bad_language",
                format!("{language:?} is not a language Emquad checks"),
            ));
        }
        self.info.spellcheck = language.to_string();
        self.save_info()
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
            let mut project = Project {
                root: dir.to_path_buf(),
                info,
            };
            // A main file named outside the project, as a folder someone sent could name one,
            // is never followed: looking up a network path can contact another computer.
            if clean_rel(&project.info.main_file).is_err() {
                project.info.main_file = project.guess_main()?;
            }
            return Ok(project);
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
                spellcheck: String::new(),
            }),
        };
        if project.info.main_file.is_empty()
            || !project
                .resolve(&project.info.main_file)
                .is_ok_and(|main| main.exists())
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
                if !is_tracked(&name, prefix.is_empty()) {
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

    /// What the user's files are now, by path, size and time of last change: two that differ
    /// mean that some file was written, added or removed in between.
    pub fn fingerprint(&self) -> Result<Vec<(String, u64, Option<std::time::SystemTime>)>> {
        self.walk_files()?
            .into_iter()
            .map(|(rel, abs)| {
                let meta = fs::metadata(&abs)?;
                Ok((rel, meta.len(), meta.modified().ok()))
            })
            .collect()
    }

    pub fn tree(&self) -> Result<Vec<TreeNode>> {
        fn walk(dir: &Path, prefix: &str) -> Result<Vec<TreeNode>> {
            let mut nodes = Vec::new();
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if !is_tracked(&name, prefix.is_empty()) {
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

    /// Find text in every text file of the project. The query is matched literally.
    pub fn search(&self, query: &str, match_case: bool) -> Result<SearchResult> {
        let mut result = SearchResult {
            hits: Vec::new(),
            truncated: false,
        };
        if query.is_empty() {
            return Ok(result);
        }
        let needle = if match_case {
            query.to_string()
        } else {
            query.to_lowercase()
        };
        for (rel, path) in self.walk_files()? {
            // Pictures, PDFs and anything very large are not text, and not worth reading to learn it.
            let extension = Path::new(&rel)
                .extension()
                .map(|e| e.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            if NOT_TEXT.contains(&extension.as_str())
                || fs::metadata(&path).is_ok_and(|m| m.len() > MAX_SEARCHED)
            {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else { continue };
            let Some(text) = as_text(&bytes) else {
                continue;
            };
            for (index, line) in text.lines().enumerate() {
                let haystack = if match_case {
                    std::borrow::Cow::Borrowed(line)
                } else {
                    std::borrow::Cow::Owned(line.to_lowercase())
                };
                let mut from = 0;
                while let Some(at) = haystack[from..].find(&needle) {
                    if result.hits.len() == MAX_SEARCH_HITS {
                        result.truncated = true;
                        return Ok(result);
                    }
                    let byte = from + at;
                    result.hits.push(SearchHit {
                        path: rel.clone(),
                        line: index as u32 + 1,
                        column: original_column(line, byte, match_case),
                        preview: line.trim().chars().take(200).collect(),
                    });
                    from = byte + needle.len();
                }
            }
        }
        Ok(result)
    }

    /// Copy files from elsewhere on disk into a project folder. A file of the project is never
    /// replaced: if any of the names is taken, nothing is copied and the user is told which.
    pub fn import_files(&self, sources: &[PathBuf], dest_dir: &str) -> Result<()> {
        let dest = self.resolve(dest_dir)?;
        let mut names = Vec::new();
        for src in sources {
            let name = src
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| Error::app("bad_path", "Source has no usable file name"))?;
            check_component(name)?;
            names.push(name);
        }
        let taken: Vec<&str> = names
            .iter()
            .copied()
            .filter(|name| dest.join(name).exists())
            .collect();
        if !taken.is_empty() {
            return Err(Error::app(
                "exists",
                format!(
                    "The project has {} already. Rename or delete it there first, so it is not replaced.",
                    taken.join(", ")
                ),
            ));
        }
        fs::create_dir_all(&dest)?;
        for (src, name) in sources.iter().zip(names) {
            copy_new(src, &dest.join(name))?;
        }
        Ok(())
    }

    /// Put a picture into the folder `dir` of the project (`""` for its own), under `name` made
    /// plain for LaTeX, or under a name like it when that one is taken by another file: never
    /// over a file. A picture that is there already, byte for byte, is not added twice. The
    /// project path it has.
    pub fn add_picture(&self, dir: &str, name: &str, bytes: &[u8]) -> Result<String> {
        let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
        let ext = ext.to_ascii_lowercase();
        if !PICTURES.contains(&ext.as_str()) {
            return Err(Error::app(
                "not_picture",
                format!("{name} is not a picture LaTeX can show. Use PNG, JPEG or PDF."),
            ));
        }
        if bytes.len() as u64 > MAX_PICTURE {
            return Err(Error::app(
                "too_large",
                format!("{name} is larger than 64 MB, too large for a picture in a document."),
            ));
        }
        // LaTeX reads a name with spaces, dots or accents in it badly, if at all.
        let plain: String = stem
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        let plain = plain.trim_matches('-');
        let plain = if plain.is_empty() { "picture" } else { plain };
        let dir = dir.trim_matches('/');
        let folder = if dir.is_empty() {
            self.root.clone()
        } else {
            self.resolve(dir)?
        };
        fs::create_dir_all(&folder)?;
        let mut tmp = tempfile::NamedTempFile::new_in(&folder)?;
        tmp.write_all(bytes)?;
        tmp.flush()?;
        for n in 1..1000 {
            let file = if n == 1 {
                format!("{plain}.{ext}")
            } else {
                format!("{plain}-{n}.{ext}")
            };
            check_component(&file)?;
            let rel = if dir.is_empty() {
                file
            } else {
                format!("{dir}/{file}")
            };
            let path = self.resolve(&rel)?;
            match fs::read(&path) {
                Ok(there) if there == bytes => return Ok(rel),
                Ok(_) => continue,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
            // Put in place only if nothing has the name, even a file made a moment ago.
            match tmp.persist_noclobber(&path) {
                Ok(_) => return Ok(rel),
                Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => tmp = e.file,
                Err(e) => return Err(Error::Io(e.error)),
            }
        }
        Err(Error::app(
            "exists",
            format!("Too many pictures are called {plain} already. Rename one, then try again."),
        ))
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
    fn rejects_names_windows_would_map_onto_something_else() {
        for bad in [
            ".git/config",
            ".GIT/hooks/pre-commit",
            "sub/.Git/config",
            "GIT~1/config",
            "EMQUAD~1/history.git/HEAD",
            ".emquad./project.json",
            ".emquad /x",
            "notes.tex.",
            "main.tex:stream",
            "con.tex",
            "sub/NUL",
            "lpt3.txt",
            "a<b.tex",
            "tab\t.tex",
        ] {
            assert!(clean_rel(bad).is_err(), "{bad} should be rejected");
        }
        for good in [
            "main.tex",
            "sections/intro é.tex",
            "a b/c-d_e.v2.tex",
            ".gitignore",
            "console.tex",
            "com.tex",
        ] {
            assert!(clean_rel(good).is_ok(), "{good} should be accepted");
        }
    }

    #[test]
    fn a_picture_is_added_under_a_plain_name_and_never_over_another_file() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        assert_eq!(
            p.add_picture("figures", "My plot (v2).PNG", b"one")
                .unwrap(),
            "figures/My-plot--v2.png"
        );
        // The same picture again is the one there; another under that name gets one of its own.
        assert_eq!(
            p.add_picture("figures/", "My plot (v2).png", b"one")
                .unwrap(),
            "figures/My-plot--v2.png"
        );
        assert_eq!(
            p.add_picture("figures", "My plot (v2).png", b"two")
                .unwrap(),
            "figures/My-plot--v2-2.png"
        );
        assert_eq!(
            fs::read(p.root.join("figures/My-plot--v2.png")).unwrap(),
            b"one"
        );
        assert_eq!(
            p.add_picture("", "ünïcode.jpg", b"x").unwrap(),
            "n-code.jpg"
        );
        assert_eq!(p.add_picture("", ".png", b"x").unwrap(), "picture.png");
        for refused in ["plot.gif", "plot", "notes.tex"] {
            assert_eq!(
                p.add_picture("", refused, b"x").unwrap_err().code(),
                "not_picture"
            );
        }
        assert!(p.add_picture("../out", "a.png", b"x").is_err());
        // Nothing but the pictures was left behind.
        let mut names: Vec<String> = fs::read_dir(p.root.join("figures"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["My-plot--v2-2.png", "My-plot--v2.png"]);
    }

    #[test]
    fn files_added_from_disk_never_replace_the_project_s_own() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("main.tex"), "theirs").unwrap();
        fs::write(outside.join("new.tex"), "new").unwrap();
        let before = fs::read_to_string(p.root.join("main.tex")).unwrap();
        let err = p
            .import_files(&[outside.join("new.tex"), outside.join("main.tex")], "")
            .unwrap_err();
        assert_eq!(err.code(), "exists");
        assert_eq!(fs::read_to_string(p.root.join("main.tex")).unwrap(), before);
        // Nothing at all was copied, not even the file whose name was free.
        assert!(!p.root.join("new.tex").exists());
        p.import_files(&[outside.join("new.tex")], "chapters")
            .unwrap();
        assert_eq!(
            fs::read_to_string(p.root.join("chapters/new.tex")).unwrap(),
            "new"
        );
    }

    #[test]
    fn entries_the_app_cannot_name_safely_are_invisible_to_it() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        fs::create_dir_all(p.root.join("vendor/.git")).unwrap();
        fs::write(p.root.join("vendor/.git/config"), "x").unwrap();
        fs::write(p.root.join("draft~1.tex"), "x").unwrap();
        let files: Vec<String> = p.walk_files().unwrap().into_iter().map(|f| f.0).collect();
        assert_eq!(files, ["main.tex"]);
        assert!(p.tree().unwrap().iter().all(|n| n.name != "draft~1.tex"));
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
    fn a_projects_own_spelling_language_is_validated_and_remembered() {
        let tmp = tempfile::tempdir().unwrap();
        let mut p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        assert_eq!(p.info.spellcheck, "");
        p.set_spellcheck("fr").unwrap();
        assert_eq!(Project::open(&p.root).unwrap().info.spellcheck, "fr");
        assert!(p.set_spellcheck("klingon").is_err());
        p.set_spellcheck("").unwrap();
        assert_eq!(Project::open(&p.root).unwrap().info.spellcheck, "");
        // A project.json from before has no language of its own.
        fs::write(p.data_dir().join("project.json"), r#"{"formatVersion":1,"projectId":"x","name":"p","mainFile":"main.tex","engine":"auto"}"#).unwrap();
        assert_eq!(Project::open(&p.root).unwrap().info.spellcheck, "");
    }

    #[test]
    fn the_compiler_choice_is_validated_and_remembered() {
        let tmp = tempfile::tempdir().unwrap();
        let mut p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        assert_eq!(p.info.engine, "auto");
        assert_eq!(
            p.set_engine("pdflatex --shell-escape").unwrap_err().code(),
            "bad_engine"
        );
        p.set_engine("latexmk").unwrap();
        assert_eq!(Project::open(&p.root).unwrap().info.engine, "latexmk");
    }

    #[test]
    fn search_finds_text_across_files_and_skips_binary_ones() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        p.write_file(
            "sections/a.tex",
            "The Gaussian integral.\nNo match here.\n  gaussian again, Gaussian twice\n",
        )
        .unwrap();
        fs::write(p.root.join("fig.bin"), b"Gaussian\0binary").unwrap();
        // A PDF is not read at all, even one whose bytes happen to look like text.
        fs::write(p.root.join("figure.pdf"), b"%PDF-1.5 Gaussian").unwrap();
        let found = p.search("gaussian", false).unwrap();
        let places: Vec<_> = found
            .hits
            .iter()
            .map(|h| (h.path.as_str(), h.line, h.column))
            .collect();
        assert_eq!(
            places,
            [
                ("sections/a.tex", 1, 5),
                ("sections/a.tex", 3, 3),
                ("sections/a.tex", 3, 19)
            ]
        );
        assert_eq!(found.hits[1].preview, "gaussian again, Gaussian twice");
        assert_eq!(p.search("gaussian", true).unwrap().hits.len(), 1);
        // A character that grows when lower-cased must not shift the column.
        p.write_file("turkish.tex", "İİ needle\n").unwrap();
        assert_eq!(p.search("NEEDLE", false).unwrap().hits[0].column, 4);
        assert!(p.search("", false).unwrap().hits.is_empty());

        p.write_file("many.tex", &"x ".repeat(MAX_SEARCH_HITS + 50))
            .unwrap();
        let many = p.search("x", true).unwrap();
        assert!(many.truncated && many.hits.len() == MAX_SEARCH_HITS);
    }

    #[test]
    fn pictures_are_found_in_the_folders_graphicspath_names_and_no_further() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        fs::create_dir_all(p.root.join("img")).unwrap();
        fs::write(p.root.join("img").join("plot.png"), b"png").unwrap();
        fs::write(tmp.path().join("outside.png"), b"png").unwrap();
        assert!(p.find_image("plot").unwrap().is_none());
        p.write_file(
            "main.tex",
            "\\graphicspath{{img/}{../}}\n\\begin{document}\n\\end{document}\n",
        )
        .unwrap();
        assert_eq!(
            p.find_image("plot").unwrap(),
            Some(p.root.join("img").join("plot.png"))
        );
        assert!(p.find_image("outside").unwrap().is_none());
    }

    #[test]
    fn the_fingerprint_changes_when_a_file_is_written_added_or_removed() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        let first = p.fingerprint().unwrap();
        assert_eq!(p.fingerprint().unwrap(), first);
        // App data is not the user's: writing it changes nothing.
        fs::write(p.data_dir().join("scratch.txt"), "x").unwrap();
        assert_eq!(p.fingerprint().unwrap(), first);
        p.write_file("main.tex", "changed\n").unwrap();
        let written = p.fingerprint().unwrap();
        assert_ne!(written, first);
        p.write_file("extra.tex", "x").unwrap();
        assert_ne!(p.fingerprint().unwrap(), written);
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
