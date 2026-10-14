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
use notify::{RecursiveMode, Watcher};
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
}

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

    /// The window is gone: so is what it had open, its language server and watcher with it.
    pub fn end_session(&self, label: &str) {
        let gone = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(label);
        if let Some(session) = gone {
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

    /// The label of another window that has the project in `root` open, if one does.
    pub fn open_elsewhere(&self, label: &str, root: &Path) -> Option<String> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions
            .iter()
            .filter(|(other, _)| other.as_str() != label)
            .find(|(_, s)| {
                s.project
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_ref()
                    .is_some_and(|p| same_folder(&p.root, root))
            })
            .map(|(other, _)| other.clone())
    }
}

/// Whether two paths name the same folder, however they are written.
fn same_folder(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
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
    if let Some(other) = state.open_elsewhere(window.label(), &project.root) {
        if let Some(there) = app.get_webview_window(&other) {
            let _ = there.unminimize();
            let _ = there.set_focus();
        }
        return Err(Error::app(
            "open_elsewhere",
            "This project is open in another Emquad window, which is now in front.",
        ));
    }
    Settings::update(&state.config_dir, |s| s.remember(&project))?;

    let root = project.root.clone();
    let label = window.label().to_string();
    let handle = app.clone();
    let to = label.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter_map(|p| p.strip_prefix(&root).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .filter(|p| !p.starts_with(DATA_DIR) && !p.starts_with(".git/") && !p.is_empty())
            .collect();
        if !paths.is_empty() {
            let _ = handle.emit_to(to.as_str(), "project://changed", paths);
        }
    })
    .map_err(|e| Error::app("watch_failed", e.to_string()))?;
    watcher
        .watch(&project.root, RecursiveMode::Recursive)
        .map_err(|e| Error::app("watch_failed", e.to_string()))?;
    *session.watcher.lock().unwrap() = Some(watcher);

    // One language server per open project; the previous project's is stopped by replacing it.
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
    *session.language_server.lock().unwrap() = server;

    let opened = OpenedProject {
        root: project.root.to_string_lossy().into_owned(),
        info: project.info.clone(),
        tree: project.tree()?,
        ui_state: fs::read_to_string(project.data_dir().join("state.json")).ok(),
        language_server,
    };
    *session.project.lock().unwrap() = Some(project);
    Ok(opened)
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
    let project = Project::create(&Path::new(&parent_dir).join(name), name, &template)?;
    activate(&app, &window, &state, &session, project)
}

#[tauri::command(async)]
pub fn project_open(
    app: AppHandle,
    window: tauri::Window,
    state: State<AppState>,
    dir: String,
) -> Result<OpenedProject> {
    let session = state.session(window.label());
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
    current(&session)?.write_file(&path, &text)
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
    p.delete(&path)?;
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

fn synctex(project: &Project) -> Result<SyncTex> {
    let main = project.resolve(&project.info.main_file)?;
    let cwd = main.parent().unwrap_or(&project.root);
    let base = compile::pdf_path(project);
    let gz = base.with_extension("synctex.gz");
    let file = if gz.is_file() {
        gz
    } else {
        base.with_extension("synctex")
    };
    SyncTex::load(&file, cwd, &project.root)
}

#[tauri::command(async)]
pub fn synctex_forward(
    window: tauri::Window,
    state: State<AppState>,
    file: String,
    line: u32,
) -> Result<Option<PdfRect>> {
    let session = state.session(window.label());
    Ok(synctex(&current(&session)?)?.forward(&file, line))
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
    Ok(synctex(&current(&session)?)?.inverse(page, x, y))
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
    let extras = bundle::Extras {
        pdf: include_pdf,
        packages: carried.as_ref(),
        comments: if include_comments {
            comments::for_bundle(&p)?
        } else {
            None
        },
    };
    let manifest = bundle::export(
        &p,
        &History::open(&p)?,
        &author(&state)?,
        Path::new(&dest),
        &note,
        &extras,
    )?;
    if let Some(checked) = checked
        && p.fingerprint()? != checked
    {
        let _ = std::fs::remove_file(&dest);
        return Err(Error::app(
            "changed_during_export",
            "A file in the project changed while the bundle was being checked, so the bundle was not kept. Export it again.",
        ));
    }
    Ok(manifest)
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
    window: tauri::Window,
    state: State<AppState>,
    path: String,
) -> Result<BundleInfo> {
    let session = state.session(window.label());
    let manifest = bundle::read_manifest(Path::new(&path))?;
    let open = session.project.lock().unwrap().clone();
    let matches_open_project = open.is_some_and(|p| p.info.project_id == manifest.project.id);
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
    let project = bundle::import_new(Path::new(&path), Path::new(&parent_dir))?;
    top_up_packages(&state, &project);
    activate(&app, &window, &state, &session, project)
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
        *state.session("main").project.lock().unwrap() = Some(a.clone());
        *state.session("w-1").project.lock().unwrap() = Some(b.clone());
        // Each window sees its own project.
        assert_eq!(current(&state.session("main")).unwrap().root, a.root);
        assert_eq!(current(&state.session("w-1")).unwrap().root, b.root);
        assert!(current(&state.session("w-2")).is_err());
        // A project open in one window is found from any other, however its path is written.
        assert_eq!(
            state.open_elsewhere("w-2", &a.root),
            Some("main".to_string())
        );
        assert_eq!(state.open_elsewhere("main", &a.root), None);
        let roundabout = tmp.path().join("b").join("..").join("a");
        assert_eq!(
            state.open_elsewhere("w-1", &roundabout),
            Some("main".to_string())
        );
        // A closed window takes its project with it.
        state.end_session("main");
        assert_eq!(state.open_elsewhere("w-2", &a.root), None);
        assert!(current(&state.session("main")).is_err());
    }
}
