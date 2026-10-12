pub mod bundle;
pub mod commands;
pub mod compile;
pub mod diff;
mod e2e;
pub mod error;
pub mod history;
pub mod index;
pub mod lsp;
pub mod project;
pub mod review;
pub mod settings;
pub mod synctex;
pub mod templates;

use commands::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// The command list, with room for the development-only commands of the end-to-end harness.
macro_rules! handlers {
    ($($extra:path),*) => {
        tauri::generate_handler![
            commands::settings_get,
            commands::settings_update,
            commands::startup_file,
            commands::project_create,
            commands::project_open,
            commands::project_close,
            commands::project_tree,
            commands::project_index,
            commands::project_search,
            commands::project_set_main,
            commands::project_set_engine,
            commands::engines_available,
            commands::ui_state_save,
            commands::file_read,
            commands::file_write,
            commands::file_create,
            commands::file_rename,
            commands::file_delete,
            commands::file_import,
            commands::compile_run,
            commands::compile_cancel,
            commands::pdf_read,
            commands::pdf_save,
            commands::synctex_forward,
            commands::synctex_inverse,
            commands::history_list,
            commands::history_snapshot,
            commands::history_changed_files,
            commands::history_file_diff,
            commands::history_restore,
            commands::bundle_export,
            commands::bundle_inspect,
            commands::bundle_import,
            commands::bundle_import_new,
            commands::review_get,
            commands::review_decide,
            commands::review_edit,
            commands::review_finish,
            commands::review_cancel,
            commands::lsp_send,
            $($extra),*
        ]
    };
}

/// Folders where a bundled helper program may live, most specific first.
fn sidecar_dirs(app: &tauri::App) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        dirs.push(resources.join("sidecars"));
    }
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(PathBuf::from))
    {
        dirs.push(exe_dir.join("sidecars"));
        dirs.push(exe_dir);
    }
    if cfg!(debug_assertions) {
        dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecars"));
    }
    dirs
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // One window per user: starting Emquad again, for example by double-clicking a bundle,
    // hands the file to the window that is already open. Development and test runs are left
    // out so they never attach to an installed copy that happens to be running.
    let builder = if cfg!(debug_assertions) || std::env::var_os("EMQUAD_E2E").is_some() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if let Some(path) = argv
                .iter()
                .skip(1)
                .find(|a| a.to_lowercase().ends_with(".emquad"))
            {
                let _ = app.emit("app://open-bundle", path);
            }
        }))
    };
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = e2e::config_dir().unwrap_or(app.path().app_config_dir()?);
            std::fs::create_dir_all(&config_dir)?;
            // Double-clicking a bundle starts the app with its path as the first argument.
            let startup_file = std::env::args()
                .nth(1)
                .filter(|a| a.to_lowercase().ends_with(".emquad"));
            app.manage(AppState {
                config_dir,
                sidecar_dirs: sidecar_dirs(app),
                project: Mutex::new(None),
                compile_pid: Arc::new(Mutex::new(None)),
                compile_lock: Mutex::new(()),
                watcher: Mutex::new(None),
                startup_file: Mutex::new(startup_file),
                language_server: Mutex::new(None),
            });
            Ok(())
        })
        .on_page_load(e2e::on_page_load);
    #[cfg(any(debug_assertions, feature = "e2e"))]
    let builder = builder.invoke_handler(handlers!(e2e::e2e_log, e2e::e2e_exit));
    #[cfg(not(any(debug_assertions, feature = "e2e")))]
    let builder = builder.invoke_handler(handlers!());
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Stop the language server with the app rather than leaving it to notice.
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>()
                    .language_server
                    .lock()
                    .unwrap()
                    .take();
            }
        });
}
