//! The command surface the webview is allowed to call. Each command is a thin wrapper over a
//! module function; every file and process action in the app goes through here.

use crate::bundle::{self, Manifest};
use crate::comments::{self, Anchor, Comment, Moved};
use crate::compile::{self, BuildOutput};
use crate::error::{Error, Result};
use crate::history::{ChangedFile, FileDiff, History, HistoryList, WORKING};
use crate::index::{self, ProjectIndex};
use crate::packages::{self, PackagesInfo};
use crate::project::{DATA_DIR, FileContent, Project, ProjectInfo, TreeNode, atomic_write};
use crate::review::{self, Decision, Review};
use crate::settings::Settings;
use crate::synctex::{PdfRect, SourcePos, SyncTex};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

pub struct AppState {
    pub config_dir: PathBuf,
    pub sidecar_dirs: Vec<PathBuf>,
    /// A `.emquad` file the app was started with.
    pub startup_file: Mutex<Option<String>>,
    /// What each window has open, by the window's label.
    pub sessions: Mutex<HashMap<String, Arc<Session>>>,
    /// The folders each window has open, or is opening, with the window's label. Each is taken
    /// in one step with the check that no other window has it, so two windows can never both
    /// open one; a window opening another project holds its old one until the new one is open.
    claims: Mutex<Vec<(String, Claim)>>,
    /// Numbers the claims, so each can be let go of on its own.
    next_claim: std::sync::atomic::AtomicU64,
}

/// A window's hold on a folder.
#[derive(Debug, Clone, PartialEq)]
pub struct Claim {
    /// The folder, as the file system names it.
    pub root: PathBuf,
    /// The identity of the project in it; empty while it is still being made.
    pub project_id: String,
    ticket: u64,
}

/// What one window has open: its project, and what runs for it.
#[derive(Default)]
pub struct Session {
    pub project: Mutex<Option<Project>>,
    /// Process id of the compile in flight, if any.
    pub compile_pid: Arc<Mutex<Option<u32>>>,
    /// Held for the length of a compile so only one runs at a time.
    pub compile_lock: Mutex<()>,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// texlab, running for the open project, when it is installed.
    pub language_server: Mutex<Option<crate::lsp::Server>>,
    /// Held while a project is opened, created or imported in the window, so two at once
    /// cannot each let go of the other's claim and leave the window holding none.
    pub opening: Mutex<()>,
    /// The files the window has just saved, so the watcher does not report them back.
    pub own_writes: Arc<crate::watch::OwnWrites>,
    /// The source/PDF map of the last compile, read once rather than at every lookup, with the
    /// file it was read from, its size and its time of change.
    pub synctex: Mutex<Option<(SyncTexStamp, Arc<SyncTex>)>>,
}

type SyncTexStamp = (PathBuf, u64, Option<std::time::SystemTime>);

impl AppState {
    pub fn new(
        config_dir: PathBuf,
        sidecar_dirs: Vec<PathBuf>,
        startup_file: Option<String>,
    ) -> AppState {
        AppState {
            config_dir,
            sidecar_dirs,
            startup_file: Mutex::new(startup_file),
            sessions: Mutex::new(HashMap::new()),
            claims: Mutex::new(Vec::new()),
            next_claim: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// The session of the window with this label, begun when it is first asked for.
    pub fn session(&self, label: &str) -> Arc<Session> {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(label.to_string())
            .or_default()
            .clone()
    }

    /// The window is gone, or its page has started again: so is what it had open, its compile,
    /// language server and watcher with it.
    pub fn end_session(&self, label: &str) {
        self.release_all(label);
        let gone = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(label);
        if let Some(session) = gone {
            if let Some(pid) = session
                .compile_pid
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take()
            {
                compile::kill_tree(pid);
            }
            session
                .language_server
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
            session
                .watcher
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
        }
    }

    /// Claim the folder `root` for the window `label`, alongside what it holds already.
    /// Refused, with the label of the window that has it, when another window has the same
    /// folder, or one inside or around it, since the two would then write the same files.
    pub fn claim(
        &self,
        label: &str,
        root: &Path,
        project_id: &str,
    ) -> std::result::Result<Claim, String> {
        // Resolved before the lock is taken: a slow folder must not hold up other windows.
        let root = resolved(root);
        let mut claims = self.claims.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((other, _)) = claims.iter().find(|(other, held)| {
            other.as_str() != label
                && (held.root.starts_with(&root) || root.starts_with(&held.root))
        }) {
            return Err(other.clone());
        }
        let claim = Claim {
            root,
            project_id: project_id.to_string(),
            ticket: self
                .next_claim
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        };
        claims.push((label.to_string(), claim.clone()));
        Ok(claim)
    }

    /// The window has opened what `claim` holds: everything else it held is let go. Nothing is,
    /// when `claim` itself has gone meanwhile (its window closed or its page loaded again): what
    /// the window holds now is a newer open's.
    pub fn settle(&self, label: &str, claim: &Claim) {
        let mut claims = self.claims.lock().unwrap_or_else(|e| e.into_inner());
        if claims
            .iter()
            .any(|(other, held)| other == label && held == claim)
        {
            claims.retain(|(other, held)| other != label || held == claim);
        }
    }

    /// Let go of one claim, such as that of a project that failed to open.
    pub fn release(&self, label: &str, claim: &Claim) {
        self.claims
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|(other, held)| other != label || held != claim);
    }

    /// Let go of everything the window holds.
    pub fn release_all(&self, label: &str) {
        self.claims
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|(other, _)| other != label);
    }

    /// The label of a window other than `label` that has the project with this identity open.
    pub fn window_with(&self, label: &str, project_id: &str) -> Option<String> {
        self.claims
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|(other, held)| other.as_str() != label && held.project_id == project_id)
            .map(|(other, _)| other.clone())
    }

    /// Whether `session` is still the session of the window `label`: it is not once the
    /// window has closed or its page has loaded again.
    fn is_current(&self, label: &str, session: &Session) -> bool {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(label)
            .is_some_and(|s| std::ptr::eq(s.as_ref(), session))
    }
}

/// Claim a folder for the window, or bring forward the window that has it and say so.
fn claim_for(
    app: &AppHandle,
    state: &AppState,
    label: &str,
    root: &Path,
    project_id: &str,
) -> Result<Claim> {
    state.claim(label, root, project_id).map_err(|other| {
        show_window(app, &other);
        Error::app(
            "open_elsewhere",
            "This project, or a folder inside or around it, is open in another Emquad window, which is now in front.",
        )
    })
}

/// A folder as the file system names it, so that two ways of writing it compare equal. For one
/// that is not there yet, its nearest parent that is, followed by the rest.
fn resolved(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut at = path;
    loop {
        if let Ok(real) = fs::canonicalize(at) {
            return rest.iter().rev().fold(real, |p, part| p.join(part));
        }
        match (at.parent(), at.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                at = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// Bring another window of the app to the front.
fn show_window(app: &AppHandle, label: &str) {
    if let Some(there) = app.get_webview_window(label) {
        let _ = there.unminimize();
        let _ = there.set_focus();
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OpenedProject {
    pub root: String,
    pub info: ProjectInfo,
    pub tree: Vec<TreeNode>,
    /// Whatever the UI saved last time (open tabs and so on), as JSON text.
    pub ui_state: Option<String>,
    /// The language server is running for this project.
    pub language_server: bool,
    /// A PDF from an earlier compile is there to show.
    pub has_pdf: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BundleInfo {
    pub manifest: Manifest,
    /// The bundle belongs to the project that is open now.
    pub matches_open_project: bool,
    /// Folder of a known project with the same identity, if it still exists.
    pub known_path: Option<String>,
}

fn current(session: &Session) -> Result<Project> {
    session
        .project
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| Error::app("no_project", "No project is open"))
}

fn activate(
    app: &AppHandle,
    window: &tauri::Window,
    state: &AppState,
    session: &Session,
    project: Project,
) -> Result<OpenedProject> {
    // One project in one window: opening it in a second would let two windows write it.
    let label = window.label();
    let claim = claim_for(app, state, label, &project.root, &project.info.project_id)?;
    let opened = start_project(app, window, state, session, project);
    match opened {
        Ok(opened) if state.is_current(label, session) => {
            state.settle(label, &claim);
            Ok(opened)
        }
        Ok(_) => {
            state.release(label, &claim);
            Err(Error::app("window_gone", "The window has closed"))
        }
        Err(e) => {
            state.release(label, &claim);
            Err(e)
        }
    }
}

/// Everything that runs for an open project, started once the window has claimed it.
fn start_project(
    app: &AppHandle,
    window: &tauri::Window,
    state: &AppState,
    session: &Session,
    project: Project,
) -> Result<OpenedProject> {
    Settings::update(&state.config_dir, |s| s.remember(&project))?;

    let label = window.label().to_string();
    let handle = app.clone();
    let to = label.clone();
    let watcher = crate::watch::start(&project.root, session.own_writes.clone(), move |paths| {
        let _ = handle.emit_to(to.as_str(), "project://changed", paths);
    })?;

    // One language server per open project; the previous project's is stopped by replacing it,
    // once the new project is known to open.
    let server = crate::lsp::find(&state.sidecar_dirs).and_then(|exe| {
        let (messages, closed) = (app.clone(), app.clone());
        let (to_messages, to_closed) = (label.clone(), label.clone());
        crate::lsp::Server::start(
            &exe,
            &project.root,
            move |message| {
                let _ = messages.emit_to(to_messages.as_str(), "lsp://message", message);
            },
            move || {
                let _ = closed.emit_to(to_closed.as_str(), "lsp://closed", ());
            },
        )
        .ok()
    });
    let language_server = server.is_some();

    let opened = OpenedProject {
        root: project.root.to_string_lossy().into_owned(),
        info: project.info.clone(),
        tree: project.tree()?,
        ui_state: fs::read_to_string(project.data_dir().join("state.json")).ok(),
        language_server,
        has_pdf: compile::pdf_path(&project).is_file(),
    };
    // Nothing of the new project is put in place until all of it has been made: if any part
    // fails, the window keeps the project it had, with its watcher and language server.
    *session.watcher.lock().unwrap() = Some(watcher);
    *session.language_server.lock().unwrap() = server;
    *session.project.lock().unwrap() = Some(project);
    Ok(opened)
}

// ---------- references ----------

/// Let the user pick references in Zotero, on this computer, and give them with their BibTeX;
/// null when the picker was closed without a choice.
/// The picker can stay open for minutes, so the wait is on a thread of its own, never holding one
/// that other commands run on.
#[tauri::command]
pub async fn zotero_pick() -> Result<Option<crate::zotero::Picked>> {
    tauri::async_runtime::spawn_blocking(crate::zotero::pick)
        .await
        .map_err(|e| Error::app("zotero_failed", format!("Asking Zotero stopped: {e}")))?
}

// ---------- windows ----------

/// Open another window, at the start screen, for another project. Asynchronous: on Windows a
/// window built while the main thread waits for the command would never finish.
#[tauri::command(async)]
pub fn window_new(app: AppHandle) -> Result<()> {
    let label = format!("w-{}", uuid::Uuid::new_v4().simple());
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App("index.html".into()))
        .title("Emquad")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1180.0, 700.0)
        .build()
        .map_err(|e| Error::app("window_failed", e.to_string()))?;
    Ok(())
}

// ---------- settings ----------

#[tauri::command(async)]
pub fn settings_get(state: State<AppState>) -> Result<Settings> {
    Settings::load(&state.config_dir)
}

#[tauri::command(async)]
pub fn settings_update(
    state: State<AppState>,
    display_name: Option<String>,
    compile_on_save: Option<bool>,
    editor_font_size: Option<u32>,
    theme: Option<String>,
    spellcheck: Option<String>,
    recent_symbols: Option<Vec<String>>,
) -> Result<Settings> {
    Settings::update(&state.config_dir, |s| {
        if let Some(v) = display_name {
            s.display_name = v.trim().to_string();
        }
        if let Some(v) = compile_on_save {
            s.compile_on_save = v;
        }
        if let Some(v) = editor_font_size {
            s.editor_font_size = v.clamp(9, 28);
        }
        if let Some(v) = theme.filter(|t| crate::settings::THEMES.contains(&t.as_str())) {
            s.theme = v;
        }
        if let Some(v) = spellcheck.filter(|l| crate::settings::SPELLCHECK.contains(&l.as_str())) {
            s.spellcheck = v;
        }
        if let Some(v) = recent_symbols {
            s.recent_symbols = crate::settings::clean_recent_symbols(v);
        }
    })
}

/// Teach the spelling checker a word, for every project.
#[tauri::command(async)]
pub fn dictionary_add(state: State<AppState>, word: String) -> Result<Settings> {
    let word = word.trim().to_string();
    let is_word = !word.is_empty()
        && word.chars().count() <= 60
        && word
            .chars()
            .all(|c| c.is_alphabetic() || "'\u{2019}-".contains(c));
    if !is_word {
        return Err(Error::app("bad_word", "That is not a word"));
    }
    Settings::update(&state.config_dir, |s| {
        if !s.dictionary.contains(&word) && s.dictionary.len() < 20_000 {
            s.dictionary.push(word);
        }
    })
}

#[tauri::command(async)]
pub fn startup_file(state: State<AppState>) -> Option<String> {
    state.startup_file.lock().unwrap().take()
}

// ---------- project ----------

#[tauri::command(async)]
pub fn project_create(
    app: AppHandle,
    window: tauri::Window,
    state: State<AppState>,
    parent_dir: String,
    name: String,
    template: String,
) -> Result<OpenedProject> {
    let session = state.session(window.label());
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err(Error::app(
            "bad_name",
            "Choose a name without special characters",
        ));
    }
    // The new folder is claimed before anything is written, so it is never made inside a
    // project another window has open.
    let _one_at_a_time = session.opening.lock().unwrap_or_else(|e| e.into_inner());
    let dest = Path::new(&parent_dir).join(name);
    let held = claim_for(&app, &state, window.label(), &dest, "")?;
    let opened = Project::create(&dest, name, &template)
        .and_then(|project| activate(&app, &window, &state, &session, project));
    if opened.is_err() {
        state.release(window.label(), &held);
    }
    opened
}

#[tauri::command(async)]
pub fn project_open(
    app: AppHandle,
    window: tauri::Window,
    state: State<AppState>,
    dir: String,
) -> Result<OpenedProject> {
    let session = state.session(window.label());
    let _one_at_a_time = session.opening.lock().unwrap_or_else(|e| e.into_inner());
    activate(
        &app,
        &window,
        &state,
        &session,
        Project::open(Path::new(&dir))?,
    )
}

#[tauri::command(async)]
pub fn project_close(window: tauri::Window, state: State<AppState>) {
    let session = state.session(window.label());
    *session.watcher.lock().unwrap() = None;
    *session.language_server.lock().unwrap() = None;
    *session.project.lock().unwrap() = None;
    state.release_all(window.label());
}

#[tauri::command(async)]
pub fn project_tree(window: tauri::Window, state: State<AppState>) -> Result<Vec<TreeNode>> {
    let session = state.session(window.label());
    current(&session)?.tree()
}

#[tauri::command(async)]
pub fn project_search(
    window: tauri::Window,
    state: State<AppState>,
    query: String,
    match_case: bool,
) -> Result<crate::project::SearchResult> {
    let session = state.session(window.label());
    current(&session)?.search(&query, match_case)
}

#[tauri::command(async)]
pub fn project_index(window: tauri::Window, state: State<AppState>) -> Result<ProjectIndex> {
    let session = state.session(window.label());
    index::build(&current(&session)?)
}

#[tauri::command(async)]
pub fn project_set_main(
    window: tauri::Window,
    state: State<AppState>,
    path: String,
) -> Result<ProjectInfo> {
    let session = state.session(window.label());
    let mut guard = session.project.lock().unwrap();
    let project = guard
        .as_mut()
        .ok_or_else(|| Error::app("no_project", "No project is open"))?;
    if !project.resolve(&path)?.is_file() {
        return Err(Error::app("not_found", format!("{path} does not exist")));
    }
    project.info.main_file = path;
    project.save_info()?;
    Ok(project.info.clone())
}

#[tauri::command(async)]
pub fn project_set_engine(
    window: tauri::Window,
    state: State<AppState>,
    engine: String,
) -> Result<ProjectInfo> {
    let session = state.session(window.label());
    let mut guard = session.project.lock().unwrap();
    let project = guard
        .as_mut()
        .ok_or_else(|| Error::app("no_project", "No project is open"))?;
    project.set_engine(&engine)?;
    Ok(project.info.clone())
}

#[tauri::command(async)]
pub fn project_set_spellcheck(
    window: tauri::Window,
    state: State<AppState>,
    language: String,
) -> Result<ProjectInfo> {
    let session = state.session(window.label());
    let mut guard = session.project.lock().unwrap();
    let project = guard
        .as_mut()
        .ok_or_else(|| Error::app("no_project", "No project is open"))?;
    project.set_spellcheck(&language)?;
    Ok(project.info.clone())
}

/// Take a word out of the user's own dictionary.
#[tauri::command(async)]
pub fn dictionary_remove(state: State<AppState>, word: String) -> Result<Settings> {
    Settings::update(&state.config_dir, |s| s.dictionary.retain(|w| w != &word))
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Engines {
    /// Emquad's bundled compiler is present.
    pub tectonic: bool,
    /// A latexmk from a TeX distribution is on this computer.
    pub latexmk: bool,
}

#[tauri::command(async)]
pub fn engines_available(state: State<AppState>) -> Engines {
    let (tectonic, latexmk) = compile::available(&state.sidecar_dirs);
    Engines { tectonic, latexmk }
}

#[tauri::command(async)]
pub fn ui_state_save(window: tauri::Window, state: State<AppState>, json: String) -> Result<()> {
    let session = state.session(window.label());
    atomic_write(
        &current(&session)?.data_dir().join("state.json"),
        json.as_bytes(),
    )
}

#[tauri::command(async)]
pub fn file_read(
    window: tauri::Window,
    state: State<AppState>,
    path: String,
) -> Result<FileContent> {
    let session = state.session(window.label());
    current(&session)?.read_file(&path)
}

#[tauri::command(async)]
pub fn file_write(
    window: tauri::Window,
    state: State<AppState>,
    path: String,
    text: String,
) -> Result<()> {
    let session = state.session(window.label());
    let project = current(&session)?;
    project.write_file(&path, &text)?;
    session.own_writes.record(&path, &project.resolve(&path)?);
    Ok(())
}

#[tauri::command(async)]
pub fn file_create(
    window: tauri::Window,
    state: State<AppState>,
    path: String,
    is_dir: bool,
) -> Result<Vec<TreeNode>> {
    let session = state.session(window.label());
    let p = current(&session)?;
    p.create_entry(&path, is_dir)?;
    p.tree()
}

#[tauri::command(async)]
pub fn file_rename(
    window: tauri::Window,
    state: State<AppState>,
    from: String,
    to: String,
) -> Result<Vec<TreeNode>> {
    let session = state.session(window.label());
    let p = current(&session)?;
    p.rename(&from, &to)?;
    // Comments stay with the file they are about. Losing track of them is not worth failing
    // a rename that has already happened.
    let _ = comments::follow_rename(&p, &from, &to);
    p.tree()
}

#[tauri::command(async)]
pub fn file_delete(
    window: tauri::Window,
    state: State<AppState>,
    path: String,
) -> Result<Vec<TreeNode>> {
    let session = state.session(window.label());
    let p = current(&session)?;
    History::open(&p)?.delete_kept(&p, &author(&state)?, &path)?;
    p.tree()
}

#[tauri::command(async)]
pub fn file_import(
    window: tauri::Window,
    state: State<AppState>,
    sources: Vec<String>,
    dest_dir: String,
) -> Result<Vec<TreeNode>> {
    let session = state.session(window.label());
    let p = current(&session)?;
    let sources: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    p.import_files(&sources, &dest_dir)?;
    p.tree()
}

/// Text the page sent percent-encoded, as `encodeURIComponent` writes it, so that any name can
/// travel in a header.
fn percent_decoded(text: &str) -> Result<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or_else(|| Error::app("bad_path", "A name was not encoded properly"))?;
            out.push(hex);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| Error::app("bad_path", "A name was not encoded properly"))
}

/// Add a picture pasted from the clipboard to the project, under a name of its own: its bytes
/// are the body of the request, the folder and the name it is wanted under are in its headers.
/// The project path it was given.
#[tauri::command(async)]
pub fn picture_add(
    window: tauri::Window,
    state: State<AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(Error::app("bad_request", "The picture did not arrive"));
    };
    let header = |name: &str| -> Result<String> {
        percent_decoded(
            request
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .unwrap_or(""),
        )
    };
    let session = state.session(window.label());
    let project = current(&session)?;
    let path = project.add_picture(&header("x-dir")?, &header("x-name")?, bytes)?;
    session.own_writes.record(&path, &project.resolve(&path)?);
    Ok(path)
}

/// Copy a picture the user dropped on the window into the project, under a name of its own.
/// The project path it was given.
#[tauri::command(async)]
pub fn picture_import(
    window: tauri::Window,
    state: State<AppState>,
    source: String,
    dir: String,
) -> Result<String> {
    use std::io::Read;
    let source = PathBuf::from(source);
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    // Only a picture, and only a file, is read: never more than a picture may weigh.
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    if !ext.is_some_and(|e| crate::project::PICTURES.contains(&e.as_str()))
        || !fs::metadata(&source)?.is_file()
    {
        return Err(Error::app(
            "not_picture",
            format!("{name} is not a picture LaTeX can show. Use PNG, JPEG or PDF."),
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(&source)?
        .take(crate::project::MAX_PICTURE + 1)
        .read_to_end(&mut bytes)?;
    let session = state.session(window.label());
    let project = current(&session)?;
    let path = project.add_picture(&dir, &name, &bytes)?;
    session.own_writes.record(&path, &project.resolve(&path)?);
    Ok(path)
}

// ---------- compile ----------

#[tauri::command(async)]
pub fn compile_run(
    app: AppHandle,
    window: tauri::Window,
    state: State<AppState>,
) -> Result<BuildOutput> {
    let session = state.session(window.label());
    let project = current(&session)?;
    // A new request replaces a compile already in flight.
    compile_cancel(window.clone(), state.clone());
    let _one_at_a_time = session
        .compile_lock
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let engine = compile::pick_engine(&project.info.engine, &state.sidecar_dirs)?;
    let _ = app.emit_to(window.label(), "compile://started", engine.name());
    let on_log = |line: &str| {
        let _ = app.emit_to(window.label(), "compile://log", line);
    };
    let output = compile::run(&project, engine.as_ref(), &session.compile_pid, &on_log)?;
    Ok(output)
}

#[tauri::command(async)]
pub fn compile_cancel(window: tauri::Window, state: State<AppState>) {
    let session = state.session(window.label());
    if let Some(pid) = session.compile_pid.lock().unwrap().take() {
        compile::kill_tree(pid);
    }
}

/// A picture of the project, for drawing figures in visual mode. `path` is what the source
/// names, which may leave the extension out, as LaTeX allows.
#[tauri::command(async)]
pub fn project_image(
    window: tauri::Window,
    state: State<AppState>,
    path: String,
) -> Result<tauri::ipc::Response> {
    let session = state.session(window.label());
    let p = current(&session)?;
    let found = p
        .find_image(&path)?
        .ok_or_else(|| Error::app("no_image", format!("There is no picture called {path}")))?;
    Ok(tauri::ipc::Response::new(fs::read(found)?))
}

#[tauri::command(async)]
pub fn pdf_read(window: tauri::Window, state: State<AppState>) -> Result<tauri::ipc::Response> {
    let session = state.session(window.label());
    let bytes = fs::read(compile::pdf_path(&current(&session)?))
        .map_err(|_| Error::app("no_pdf", "There is no PDF yet. Compile the document first."))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Save a copy of the compiled PDF wherever the user chose.
#[tauri::command(async)]
pub fn pdf_save(window: tauri::Window, state: State<AppState>, dest: String) -> Result<()> {
    let session = state.session(window.label());
    fs::copy(compile::pdf_path(&current(&session)?), dest)
        .map_err(|_| Error::app("no_pdf", "There is no PDF yet. Compile the document first."))?;
    Ok(())
}

/// The source/PDF map of the last compile: the one already read, while its file is unchanged.
fn synctex(session: &Session, project: &Project) -> Result<Arc<SyncTex>> {
    let main = project.resolve(&project.info.main_file)?;
    let cwd = main.parent().unwrap_or(&project.root);
    let base = compile::pdf_path(project);
    let gz = base.with_extension("synctex.gz");
    let file = if gz.is_file() {
        gz
    } else {
        base.with_extension("synctex")
    };
    let stamp = fs::metadata(&file)
        .ok()
        .map(|m| (file.clone(), m.len(), m.modified().ok()));
    let mut cached = session.synctex.lock().unwrap_or_else(|e| e.into_inner());
    if let (Some(stamp), Some((was, map))) = (&stamp, cached.as_ref())
        && stamp == was
    {
        return Ok(map.clone());
    }
    let map = Arc::new(SyncTex::load(&file, cwd, &project.root)?);
    *cached = stamp.map(|stamp| (stamp, map.clone()));
    Ok(map)
}

#[tauri::command(async)]
pub fn synctex_forward(
    window: tauri::Window,
    state: State<AppState>,
    file: String,
    line: u32,
) -> Result<Option<PdfRect>> {
    let session = state.session(window.label());
    Ok(synctex(&session, &current(&session)?)?.forward(&file, line))
}

#[tauri::command(async)]
pub fn synctex_inverse(
    window: tauri::Window,
    state: State<AppState>,
    page: u32,
    x: f64,
    y: f64,
) -> Result<Option<SourcePos>> {
    let session = state.session(window.label());
    Ok(synctex(&session, &current(&session)?)?.inverse(page, x, y))
}

// ---------- history ----------

fn author(state: &AppState) -> Result<crate::history::Author> {
    Ok(Settings::load(&state.config_dir)?.author())
}

#[tauri::command(async)]
pub fn history_list(window: tauri::Window, state: State<AppState>) -> Result<HistoryList> {
    let session = state.session(window.label());
    let p = current(&session)?;
    History::open(&p)?.list(&p)
}

#[tauri::command(async)]
pub fn history_snapshot(
    window: tauri::Window,
    state: State<AppState>,
    label: String,
) -> Result<String> {
    let session = state.session(window.label());
    let p = current(&session)?;
    let label = label.trim();
    let label = if label.is_empty() { "Snapshot" } else { label };
    Ok(History::open(&p)?
        .snapshot(&p, &author(&state)?, "snapshot", label)?
        .to_string())
}

/// How often, at most, a version is kept of the work as it is saved.
const KEEP_WHILE_WRITING: i64 = 10 * 60;

/// Keep a version of the work after a save, when the latest is ten minutes old or more. Whether
/// one was kept.
#[tauri::command(async)]
pub fn history_keep_while_writing(window: tauri::Window, state: State<AppState>) -> Result<bool> {
    let session = state.session(window.label());
    let p = current(&session)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    Ok(History::open(&p)?
        .keep_while_writing(&p, &author(&state)?, now, KEEP_WHILE_WRITING)?
        .is_some())
}

/// `against` of `None` means the version's natural comparison (see `History::natural_base`).
fn trees(
    p: &Project,
    h: &History,
    version: &str,
    against: Option<&str>,
) -> Result<(git2::Oid, git2::Oid)> {
    let new = h.tree_for(p, version)?;
    let old = match against {
        Some(a) => h.tree_for(p, a)?,
        None => h.natural_base(version)?,
    };
    Ok((old, new))
}

#[tauri::command(async)]
pub fn history_changed_files(
    window: tauri::Window,
    state: State<AppState>,
    version: String,
    against: Option<String>,
) -> Result<Vec<ChangedFile>> {
    let session = state.session(window.label());
    let p = current(&session)?;
    let h = History::open(&p)?;
    let (old, new) = trees(&p, &h, &version, against.as_deref())?;
    h.changed_files(old, new)
}

#[tauri::command(async)]
pub fn history_file_diff(
    window: tauri::Window,
    state: State<AppState>,
    version: String,
    against: Option<String>,
    path: String,
) -> Result<FileDiff> {
    let session = state.session(window.label());
    let p = current(&session)?;
    let h = History::open(&p)?;
    let (old, new) = trees(&p, &h, &version, against.as_deref())?;
    h.file_diff(old, new, &path)
}

#[tauri::command(async)]
pub fn history_restore(
    window: tauri::Window,
    state: State<AppState>,
    version: String,
) -> Result<String> {
    let session = state.session(window.label());
    if version == WORKING {
        return Err(Error::app(
            "bad_version",
            "The working copy is already current",
        ));
    }
    let p = current(&session)?;
    Ok(History::open(&p)?
        .restore(&p, &author(&state)?, &version)?
        .to_string())
}

// ---------- bundles and review ----------

/// The Tectonic program and the package store the open project compiles from, when it
/// compiles with Tectonic and a store exists.
fn package_source(state: &AppState, project: &Project) -> Option<(PathBuf, PathBuf)> {
    if project.info.engine == "latexmk" {
        return None;
    }
    let tectonic = compile::find_exe("tectonic", &state.sidecar_dirs)?;
    let store = packages::store_for(project, &tectonic)?;
    Some((tectonic, store))
}

/// Whether this project's LaTeX packages can be put in a bundle, and how much they weigh.
#[tauri::command(async)]
pub fn packages_info(window: tauri::Window, state: State<AppState>) -> Result<PackagesInfo> {
    let session = state.session(window.label());
    let p = current(&session)?;
    Ok(match package_source(&state, &p) {
        Some((_, store)) => packages::info(&packages::list(&store)?),
        None => PackagesInfo::default(),
    })
}

#[tauri::command(async)]
pub fn bundle_export(
    window: tauri::Window,
    state: State<AppState>,
    dest: String,
    note: String,
    include_pdf: bool,
    include_packages: bool,
    include_comments: bool,
) -> Result<Manifest> {
    let session = state.session(window.label());
    let p = current(&session)?;
    // Held from the offline check until the bundle is written, so no compile runs between.
    let _one_at_a_time = session
        .compile_lock
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    // The offline check compiles the files as they are now. A file another program writes
    // before the bundle is made would travel unchecked, so the files are looked at again after.
    let checked = if include_packages {
        Some(p.fingerprint()?)
    } else {
        None
    };
    let mut carried = None;
    if include_packages {
        let (tectonic, store) = package_source(&state, &p).ok_or_else(|| {
            Error::app(
                "packages_unavailable",
                "LaTeX packages can be included only for a project that compiles with the built-in Tectonic and has been compiled once",
            )
        })?;
        // Only what this project reads, when that can be told and is shown to be enough;
        // otherwise everything the store holds.
        let all = packages::list(&store)?;
        let smaller =
            packages::used(&tectonic, &p, &all).map(|used| packages::verify(&tectonic, &p, &used));
        carried = Some(match smaller {
            Some(Ok(checked)) => checked,
            _ => packages::verify(&tectonic, &p, &all)?,
        });
    }
    // Looked at before the bundle takes its place, so a bundle refused here never replaces a
    // file that was there; files that cannot be looked at count as changed.
    let unchanged = || -> Result<()> {
        match &checked {
            Some(before) if p.fingerprint().ok().as_ref() != Some(before) => Err(Error::app(
                "changed_during_export",
                "A file in the project changed while the bundle was being checked, so the bundle was not kept. Export it again.",
            )),
            _ => Ok(()),
        }
    };
    let extras = bundle::Extras {
        pdf: include_pdf,
        packages: carried.as_ref(),
        comments: if include_comments {
            comments::for_bundle(&p)?
        } else {
            None
        },
        keep_if: Some(&unchanged),
    };
    bundle::export(
        &p,
        &History::open(&p)?,
        &author(&state)?,
        Path::new(&dest),
        &note,
        &extras,
    )
}

/// A project that has just been given packages by a bundle compiles from its own store from
/// now on; fill that store with what this computer already has, so nothing it could compile
/// before stops compiling offline.
fn top_up_packages(state: &AppState, project: &Project) {
    if !packages::project_cache(project).is_dir() {
        return;
    }
    if let Some(shared) = compile::find_exe("tectonic", &state.sidecar_dirs)
        .and_then(|exe| packages::shared_store(&exe))
    {
        let _ = packages::top_up(project, &shared);
    }
}

#[tauri::command(async)]
pub fn bundle_inspect(
    app: AppHandle,
    window: tauri::Window,
    state: State<AppState>,
    path: String,
) -> Result<BundleInfo> {
    let session = state.session(window.label());
    let manifest = bundle::read_manifest(Path::new(&path))?;
    let open = session.project.lock().unwrap().clone();
    let matches_open_project = open.is_some_and(|p| p.info.project_id == manifest.project.id);
    // A bundle for a project another window has open goes to that window.
    if !matches_open_project
        && let Some(other) = state.window_with(window.label(), &manifest.project.id)
    {
        show_window(&app, &other);
        let _ = app.emit_to(other.as_str(), "app://open-bundle", &path);
        return Err(Error::app(
            "open_elsewhere",
            "This bundle's project is open in another Emquad window, which now has the bundle.",
        ));
    }
    let known_path = Settings::load(&state.config_dir)?
        .recent
        .into_iter()
        .find(|r| r.id == manifest.project.id && Path::new(&r.path).join(DATA_DIR).is_dir())
        .map(|r| r.path);
    Ok(BundleInfo {
        manifest,
        matches_open_project,
        known_path,
    })
}

/// Bring a bundle into the open project for review. Returns the bundle id.
#[tauri::command(async)]
pub fn bundle_import(
    window: tauri::Window,
    state: State<AppState>,
    path: String,
) -> Result<String> {
    let session = state.session(window.label());
    let p = current(&session)?;
    let imported = bundle::import_into(&p, &History::open(&p)?, Path::new(&path));
    // Also when the import was refused: an earlier bundle may have given the project a store.
    top_up_packages(&state, &p);
    Ok(imported?.bundle_id)
}

#[tauri::command(async)]
pub fn bundle_import_new(
    app: AppHandle,
    window: tauri::Window,
    state: State<AppState>,
    path: String,
    parent_dir: String,
) -> Result<OpenedProject> {
    let session = state.session(window.label());
    let _one_at_a_time = session.opening.lock().unwrap_or_else(|e| e.into_inner());
    let dest = bundle::destination(Path::new(&path), Path::new(&parent_dir))?;
    let held = claim_for(&app, &state, window.label(), &dest, "")?;
    let opened = bundle::import_new(Path::new(&path), Path::new(&parent_dir)).and_then(|project| {
        top_up_packages(&state, &project);
        activate(&app, &window, &state, &session, project)
    });
    if opened.is_err() {
        state.release(window.label(), &held);
    }
    opened
}

#[tauri::command(async)]
pub fn review_get(
    window: tauri::Window,
    state: State<AppState>,
    bundle_id: String,
) -> Result<Review> {
    let session = state.session(window.label());
    let p = current(&session)?;
    review::get(&p, &History::open(&p)?, &author(&state)?, &bundle_id)
}

#[tauri::command(async)]
pub fn review_decide(
    window: tauri::Window,
    state: State<AppState>,
    bundle_id: String,
    item_id: String,
    decision: Decision,
) -> Result<Review> {
    let session = state.session(window.label());
    let p = current(&session)?;
    review::decide(&p, &bundle_id, &item_id, decision)?;
    review::get(&p, &History::open(&p)?, &author(&state)?, &bundle_id)
}

#[tauri::command(async)]
pub fn review_edit(
    window: tauri::Window,
    state: State<AppState>,
    bundle_id: String,
    item_id: String,
    text: String,
) -> Result<Review> {
    let session = state.session(window.label());
    let p = current(&session)?;
    let h = History::open(&p)?;
    review::edit(&p, &h, &bundle_id, &item_id, &text)?;
    review::get(&p, &h, &author(&state)?, &bundle_id)
}

#[tauri::command(async)]
pub fn review_finish(
    window: tauri::Window,
    state: State<AppState>,
    bundle_id: String,
) -> Result<String> {
    let session = state.session(window.label());
    let p = current(&session)?;
    Ok(review::finish(&p, &History::open(&p)?, &author(&state)?, &bundle_id)?.to_string())
}

#[tauri::command(async)]
pub fn review_cancel(
    window: tauri::Window,
    state: State<AppState>,
    bundle_id: String,
) -> Result<()> {
    let session = state.session(window.label());
    review::cancel(&current(&session)?, &bundle_id)
}

// ---------- language server ----------

/// Pass one JSON message from the editor to texlab.
// ---------- comments ----------

#[tauri::command(async)]
pub fn comments_list(window: tauri::Window, state: State<AppState>) -> Result<Vec<Comment>> {
    let session = state.session(window.label());
    Ok(comments::visible(comments::load(&current(&session)?)?))
}

#[tauri::command(async)]
pub fn comment_add(
    window: tauri::Window,
    state: State<AppState>,
    path: String,
    anchor: Anchor,
    text: String,
) -> Result<Vec<Comment>> {
    let session = state.session(window.label());
    let p = current(&session)?;
    comments::add(&p, &author(&state)?, &path, anchor, &text).map(comments::visible)
}

#[tauri::command(async)]
pub fn comment_reply(
    window: tauri::Window,
    state: State<AppState>,
    id: String,
    text: String,
) -> Result<Vec<Comment>> {
    let session = state.session(window.label());
    let p = current(&session)?;
    comments::reply(&p, &author(&state)?, &id, &text).map(comments::visible)
}

#[tauri::command(async)]
pub fn comment_resolve(
    window: tauri::Window,
    state: State<AppState>,
    id: String,
    resolved: bool,
) -> Result<Vec<Comment>> {
    let session = state.session(window.label());
    comments::set_resolved(&current(&session)?, &id, resolved).map(comments::visible)
}

#[tauri::command(async)]
pub fn comment_delete(
    window: tauri::Window,
    state: State<AppState>,
    id: String,
) -> Result<Vec<Comment>> {
    let session = state.session(window.label());
    comments::delete(&current(&session)?, &id).map(comments::visible)
}

#[tauri::command(async)]
pub fn comments_reanchor(
    window: tauri::Window,
    state: State<AppState>,
    moved: Vec<Moved>,
) -> Result<Vec<Comment>> {
    let session = state.session(window.label());
    comments::reanchor(&current(&session)?, moved).map(comments::visible)
}

#[tauri::command(async)]
pub fn lsp_send(window: tauri::Window, state: State<AppState>, message: String) -> Result<()> {
    let session = state.session(window.label());
    match session.language_server.lock().unwrap().as_ref() {
        Some(server) => server.send(&message),
        None => Err(Error::app(
            "lsp_missing",
            "The language server is not running",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_window_has_its_own_session_and_one_project_is_open_in_one_window() {
        let tmp = tempfile::tempdir().unwrap();
        let state = AppState::new(tmp.path().join("config"), Vec::new(), None);
        let a = Project::create(&tmp.path().join("a"), "a", "article").unwrap();
        let b = Project::create(&tmp.path().join("b"), "b", "article").unwrap();
        let id = |p: &Project| p.info.project_id.clone();
        *state.session("main").project.lock().unwrap() = Some(a.clone());
        *state.session("w-1").project.lock().unwrap() = Some(b.clone());
        let held_a = state.claim("main", &a.root, &id(&a)).unwrap();
        state.settle("main", &held_a);
        state.claim("w-1", &b.root, &id(&b)).unwrap();
        // Each window sees its own project.
        assert_eq!(current(&state.session("main")).unwrap().root, a.root);
        assert_eq!(current(&state.session("w-1")).unwrap().root, b.root);
        assert!(current(&state.session("w-2")).is_err());
        // A project open in one window is refused to any other, however its path is written,
        // and so is a folder inside or around it.
        assert_eq!(
            state.claim("w-2", &a.root, &id(&a)),
            Err("main".to_string())
        );
        let roundabout = tmp.path().join("b").join("..").join("a");
        assert_eq!(
            state.claim("w-2", &roundabout, "x"),
            Err("main".to_string())
        );
        assert_eq!(
            state.claim("w-2", &a.root.join("figures"), "x"),
            Err("main".to_string())
        );
        assert_eq!(state.claim("w-2", tmp.path(), "x"), Err("main".to_string()));
        assert_eq!(state.window_with("w-2", &id(&a)), Some("main".to_string()));
        assert_eq!(state.window_with("main", &id(&a)), None);
        // A window opening another project keeps the one it has until the new one is open: a
        // failed switch leaves it holding the old one, and no other window can take it meanwhile.
        let c = tmp.path().join("c");
        let opening = state.claim("main", &c, "c").unwrap();
        assert_eq!(
            state.claim("w-2", &a.root, &id(&a)),
            Err("main".to_string())
        );
        state.release("main", &opening);
        assert_eq!(state.claim("w-2", &c, "c").map(|_| ()), Ok(()));
        assert_eq!(
            state.claim("w-2", &a.root, &id(&a)),
            Err("main".to_string())
        );
        state.release_all("w-2");
        // A switch that succeeds lets the old one go.
        let opened = state.claim("main", &c, "c").unwrap();
        state.settle("main", &opened);
        assert_eq!(state.claim("w-2", &a.root, &id(&a)).map(|_| ()), Ok(()));
        state.release_all("w-2");
        // An open whose window's page loaded again meanwhile lets go of nothing a newer open holds.
        let stale = state.claim("main", &tmp.path().join("d"), "d").unwrap();
        state.release_all("main");
        let fresh = state.claim("main", &tmp.path().join("e"), "e").unwrap();
        state.settle("main", &stale);
        assert_eq!(
            state.claim("w-2", &tmp.path().join("e"), "e"),
            Err("main".to_string())
        );
        state.settle("main", &fresh);
        // A closed window takes its project with it.
        state.end_session("main");
        assert_eq!(state.claim("w-2", &c, "c").map(|_| ()), Ok(()));
        assert!(current(&state.session("main")).is_err());
    }

    #[test]
    fn two_windows_opening_one_project_at_once_cannot_both_have_it() {
        let tmp = tempfile::tempdir().unwrap();
        let state = Arc::new(AppState::new(tmp.path().join("config"), Vec::new(), None));
        let a = Project::create(&tmp.path().join("a"), "a", "article").unwrap();
        for _ in 0..50 {
            let winners: usize = (0..8)
                .map(|n| {
                    let (state, root, id) =
                        (state.clone(), a.root.clone(), a.info.project_id.clone());
                    std::thread::spawn(move || state.claim(&format!("w-{n}"), &root, &id).is_ok())
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|t| usize::from(t.join().unwrap()))
                .sum();
            assert_eq!(winners, 1);
            for n in 0..8 {
                state.end_session(&format!("w-{n}"));
            }
        }
    }
}
