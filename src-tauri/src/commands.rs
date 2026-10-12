//! The command surface the webview is allowed to call. Each command is a thin wrapper over a
//! module function; every file and process action in the app goes through here.

use crate::bundle::{self, Manifest};
use crate::compile::{self, BuildOutput};
use crate::error::{Error, Result};
use crate::history::{ChangedFile, FileDiff, History, HistoryList, WORKING};
use crate::index::{self, ProjectIndex};
use crate::project::{DATA_DIR, FileContent, Project, ProjectInfo, TreeNode, atomic_write};
use crate::review::{self, Decision, Review};
use crate::settings::Settings;
use crate::synctex::{PdfRect, SourcePos, SyncTex};
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use ts_rs::TS;

pub struct AppState {
    pub config_dir: PathBuf,
    pub sidecar_dirs: Vec<PathBuf>,
    pub project: Mutex<Option<Project>>,
    /// Process id of the compile in flight, if any.
    pub compile_pid: Arc<Mutex<Option<u32>>>,
    /// Held for the length of a compile so only one runs at a time.
    pub compile_lock: Mutex<()>,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// A `.emquad` file the app was started with.
    pub startup_file: Mutex<Option<String>>,
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

fn current(state: &AppState) -> Result<Project> {
    state
        .project
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| Error::app("no_project", "No project is open"))
}

fn activate(app: &AppHandle, state: &AppState, project: Project) -> Result<OpenedProject> {
    let mut settings = Settings::load(&state.config_dir);
    settings.remember(&project);
    settings.save(&state.config_dir)?;

    let root = project.root.clone();
    let handle = app.clone();
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
            let _ = handle.emit("project://changed", paths);
        }
    })
    .map_err(|e| Error::app("watch_failed", e.to_string()))?;
    watcher
        .watch(&project.root, RecursiveMode::Recursive)
        .map_err(|e| Error::app("watch_failed", e.to_string()))?;
    *state.watcher.lock().unwrap() = Some(watcher);

    let opened = OpenedProject {
        root: project.root.to_string_lossy().into_owned(),
        info: project.info.clone(),
        tree: project.tree()?,
        ui_state: fs::read_to_string(project.data_dir().join("state.json")).ok(),
    };
    *state.project.lock().unwrap() = Some(project);
    Ok(opened)
}

// ---------- settings ----------

#[tauri::command(async)]
pub fn settings_get(state: State<AppState>) -> Result<Settings> {
    let settings = Settings::load(&state.config_dir);
    settings.save(&state.config_dir)?;
    Ok(settings)
}

#[tauri::command(async)]
pub fn settings_update(
    state: State<AppState>,
    display_name: Option<String>,
    compile_on_save: Option<bool>,
    editor_font_size: Option<u32>,
) -> Result<Settings> {
    let mut s = Settings::load(&state.config_dir);
    if let Some(v) = display_name {
        s.display_name = v.trim().to_string();
    }
    if let Some(v) = compile_on_save {
        s.compile_on_save = v;
    }
    if let Some(v) = editor_font_size {
        s.editor_font_size = v.clamp(9, 28);
    }
    s.save(&state.config_dir)?;
    Ok(s)
}

#[tauri::command(async)]
pub fn startup_file(state: State<AppState>) -> Option<String> {
    state.startup_file.lock().unwrap().take()
}

// ---------- project ----------

#[tauri::command(async)]
pub fn project_create(
    app: AppHandle,
    state: State<AppState>,
    parent_dir: String,
    name: String,
    template: String,
) -> Result<OpenedProject> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err(Error::app("bad_name", "Choose a name without special characters"));
    }
    let project = Project::create(&Path::new(&parent_dir).join(name), name, &template)?;
    activate(&app, &state, project)
}

#[tauri::command(async)]
pub fn project_open(app: AppHandle, state: State<AppState>, dir: String) -> Result<OpenedProject> {
    activate(&app, &state, Project::open(Path::new(&dir))?)
}

#[tauri::command(async)]
pub fn project_close(state: State<AppState>) {
    *state.watcher.lock().unwrap() = None;
    *state.project.lock().unwrap() = None;
}

#[tauri::command(async)]
pub fn project_tree(state: State<AppState>) -> Result<Vec<TreeNode>> {
    current(&state)?.tree()
}

#[tauri::command(async)]
pub fn project_index(state: State<AppState>) -> Result<ProjectIndex> {
    index::build(&current(&state)?)
}

#[tauri::command(async)]
pub fn project_set_main(state: State<AppState>, path: String) -> Result<ProjectInfo> {
    let mut guard = state.project.lock().unwrap();
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
pub fn ui_state_save(state: State<AppState>, json: String) -> Result<()> {
    atomic_write(&current(&state)?.data_dir().join("state.json"), json.as_bytes())
}

#[tauri::command(async)]
pub fn file_read(state: State<AppState>, path: String) -> Result<FileContent> {
    current(&state)?.read_file(&path)
}

#[tauri::command(async)]
pub fn file_write(state: State<AppState>, path: String, text: String) -> Result<()> {
    current(&state)?.write_file(&path, &text)
}

#[tauri::command(async)]
pub fn file_create(state: State<AppState>, path: String, is_dir: bool) -> Result<Vec<TreeNode>> {
    let p = current(&state)?;
    p.create_entry(&path, is_dir)?;
    p.tree()
}

#[tauri::command(async)]
pub fn file_rename(state: State<AppState>, from: String, to: String) -> Result<Vec<TreeNode>> {
    let p = current(&state)?;
    p.rename(&from, &to)?;
    p.tree()
}

#[tauri::command(async)]
pub fn file_delete(state: State<AppState>, path: String) -> Result<Vec<TreeNode>> {
    let p = current(&state)?;
    p.delete(&path)?;
    p.tree()
}

#[tauri::command(async)]
pub fn file_import(
    state: State<AppState>,
    sources: Vec<String>,
    dest_dir: String,
) -> Result<Vec<TreeNode>> {
    let p = current(&state)?;
    let sources: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    p.import_files(&sources, &dest_dir)?;
    p.tree()
}

// ---------- compile ----------

#[tauri::command(async)]
pub fn compile_run(app: AppHandle, state: State<AppState>) -> Result<BuildOutput> {
    let project = current(&state)?;
    // A new request replaces a compile already in flight.
    compile_cancel(state.clone());
    let _one_at_a_time = state.compile_lock.lock().unwrap();
    let engine = compile::pick_engine(&project.info.engine, &state.sidecar_dirs)?;
    let _ = app.emit("compile://started", engine.name());
    let on_log = |line: &str| {
        let _ = app.emit("compile://log", line);
    };
    let output = compile::run(&project, engine.as_ref(), &state.compile_pid, &on_log)?;
    Ok(output)
}

#[tauri::command(async)]
pub fn compile_cancel(state: State<AppState>) {
    if let Some(pid) = state.compile_pid.lock().unwrap().take() {
        compile::kill_tree(pid);
    }
}

#[tauri::command(async)]
pub fn pdf_read(state: State<AppState>) -> Result<tauri::ipc::Response> {
    let bytes = fs::read(compile::pdf_path(&current(&state)?))
        .map_err(|_| Error::app("no_pdf", "There is no PDF yet. Compile the document first."))?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn synctex(project: &Project) -> Result<SyncTex> {
    let main = project.resolve(&project.info.main_file)?;
    let cwd = main.parent().unwrap_or(&project.root);
    let base = compile::pdf_path(project);
    let gz = base.with_extension("synctex.gz");
    let file = if gz.is_file() { gz } else { base.with_extension("synctex") };
    SyncTex::load(&file, cwd, &project.root)
}

#[tauri::command(async)]
pub fn synctex_forward(state: State<AppState>, file: String, line: u32) -> Result<Option<PdfRect>> {
    Ok(synctex(&current(&state)?)?.forward(&file, line))
}

#[tauri::command(async)]
pub fn synctex_inverse(
    state: State<AppState>,
    page: u32,
    x: f64,
    y: f64,
) -> Result<Option<SourcePos>> {
    Ok(synctex(&current(&state)?)?.inverse(page, x, y))
}

// ---------- history ----------

fn author(state: &AppState) -> crate::history::Author {
    Settings::load(&state.config_dir).author()
}

#[tauri::command(async)]
pub fn history_list(state: State<AppState>) -> Result<HistoryList> {
    let p = current(&state)?;
    History::open(&p)?.list(&p)
}

#[tauri::command(async)]
pub fn history_snapshot(state: State<AppState>, label: String) -> Result<String> {
    let p = current(&state)?;
    let label = label.trim();
    let label = if label.is_empty() { "Snapshot" } else { label };
    Ok(History::open(&p)?
        .snapshot(&p, &author(&state), "snapshot", label)?
        .to_string())
}

/// `against` of `None` means the version's natural comparison (see `History::natural_base`).
fn trees(p: &Project, h: &History, version: &str, against: Option<&str>) -> Result<(git2::Oid, git2::Oid)> {
    let new = h.tree_for(p, version)?;
    let old = match against {
        Some(a) => h.tree_for(p, a)?,
        None => h.natural_base(version)?,
    };
    Ok((old, new))
}

#[tauri::command(async)]
pub fn history_changed_files(
    state: State<AppState>,
    version: String,
    against: Option<String>,
) -> Result<Vec<ChangedFile>> {
    let p = current(&state)?;
    let h = History::open(&p)?;
    let (old, new) = trees(&p, &h, &version, against.as_deref())?;
    h.changed_files(old, new)
}

#[tauri::command(async)]
pub fn history_file_diff(
    state: State<AppState>,
    version: String,
    against: Option<String>,
    path: String,
) -> Result<FileDiff> {
    let p = current(&state)?;
    let h = History::open(&p)?;
    let (old, new) = trees(&p, &h, &version, against.as_deref())?;
    h.file_diff(old, new, &path)
}

#[tauri::command(async)]
pub fn history_restore(state: State<AppState>, version: String) -> Result<String> {
    if version == WORKING {
        return Err(Error::app("bad_version", "The working copy is already current"));
    }
    let p = current(&state)?;
    Ok(History::open(&p)?
        .restore(&p, &author(&state), &version)?
        .to_string())
}

// ---------- bundles and review ----------

#[tauri::command(async)]
pub fn bundle_export(
    state: State<AppState>,
    dest: String,
    note: String,
    include_pdf: bool,
) -> Result<Manifest> {
    let p = current(&state)?;
    bundle::export(
        &p,
        &History::open(&p)?,
        &author(&state),
        Path::new(&dest),
        &note,
        include_pdf,
    )
}

#[tauri::command(async)]
pub fn bundle_inspect(state: State<AppState>, path: String) -> Result<BundleInfo> {
    let manifest = bundle::read_manifest(Path::new(&path))?;
    let open = state.project.lock().unwrap().clone();
    let matches_open_project =
        open.is_some_and(|p| p.info.project_id == manifest.project.id);
    let known_path = Settings::load(&state.config_dir)
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
pub fn bundle_import(state: State<AppState>, path: String) -> Result<String> {
    let p = current(&state)?;
    Ok(bundle::import_into(&p, &History::open(&p)?, Path::new(&path))?.bundle_id)
}

#[tauri::command(async)]
pub fn bundle_import_new(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    parent_dir: String,
) -> Result<OpenedProject> {
    let project = bundle::import_new(Path::new(&path), Path::new(&parent_dir))?;
    activate(&app, &state, project)
}

#[tauri::command(async)]
pub fn review_get(state: State<AppState>, bundle_id: String) -> Result<Review> {
    let p = current(&state)?;
    review::get(&p, &History::open(&p)?, &author(&state), &bundle_id)
}

#[tauri::command(async)]
pub fn review_decide(
    state: State<AppState>,
    bundle_id: String,
    item_id: String,
    decision: Decision,
) -> Result<Review> {
    let p = current(&state)?;
    review::decide(&p, &bundle_id, &item_id, decision)?;
    review::get(&p, &History::open(&p)?, &author(&state), &bundle_id)
}

#[tauri::command(async)]
pub fn review_finish(state: State<AppState>, bundle_id: String) -> Result<String> {
    let p = current(&state)?;
    Ok(review::finish(&p, &History::open(&p)?, &author(&state), &bundle_id)?.to_string())
}

#[tauri::command(async)]
pub fn review_cancel(state: State<AppState>, bundle_id: String) -> Result<()> {
    review::cancel(&current(&state)?, &bundle_id)
}
