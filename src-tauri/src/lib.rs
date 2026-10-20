pub mod bundle;
pub mod commands;
pub mod comments;
pub mod compile;
pub mod diff;
mod e2e;
pub mod error;
pub mod history;
pub mod index;
pub mod lsp;
pub mod packages;
pub mod pandoc;
pub mod pdfnotes;
pub mod project;
pub mod review;
pub mod settings;
pub mod synctex;
pub mod templates;
pub mod watch;
pub mod zotero;

use commands::AppState;
use std::path::PathBuf;
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
            commands::project_set_spellcheck,
            commands::engines_available,
            commands::ui_state_save,
            commands::file_read,
            commands::file_write,
            commands::file_create,
            commands::file_rename,
            commands::file_delete,
            commands::file_import,
            commands::picture_add,
            commands::picture_import,
            commands::compile_run,
            commands::compile_cancel,
            commands::pdf_read,
            commands::pdf_save,
            commands::synctex_forward,
            commands::synctex_inverse,
            commands::synctex_page_starts,
            commands::synctex_block,
            commands::history_list,
            commands::history_snapshot,
            commands::history_keep_while_writing,
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
            commands::packages_info,
            commands::comments_list,
            commands::comment_add,
            commands::comment_reply,
            commands::comment_resolve,
            commands::comment_delete,
            commands::comments_reanchor,
            commands::dictionary_add,
            commands::dictionary_remove,
            commands::project_image,
            commands::window_new,
            commands::zotero_pick,
            commands::pandoc_available,
            commands::word_export,
            commands::word_import,
            commands::pdf_save_with_comments,
            commands::pdf_save_with_changes,
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
            // The window that was used last takes it, or the first there is.
            let windows = app.webview_windows();
            let window = windows
                .values()
                .find(|w| w.is_focused().unwrap_or(false))
                .or_else(|| windows.get("main"))
                .or_else(|| windows.values().next());
            if let Some(window) = window {
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(path) = argv
                    .iter()
                    .skip(1)
                    .find(|a| a.to_lowercase().ends_with(".emquad"))
                {
                    let _ = app.emit_to(window.label(), "app://open-bundle", path);
                }
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
            app.manage(AppState::new(config_dir, sidecar_dirs(app), startup_file));
            Ok(())
        })
        .on_window_event(|window, event| {
            // A closed window takes what it had open with it.
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<AppState>().end_session(window.label());
            }
        })
        .on_page_load(|webview, payload| {
            // A page that starts again (a reload) starts with nothing open, so nothing is left
            // running for it or holding its project.
            if payload.event() == tauri::webview::PageLoadEvent::Started
                && let Some(state) = webview.try_state::<AppState>()
            {
                state.end_session(webview.label());
            }
            e2e::on_page_load(webview, payload);
        });
    #[cfg(any(debug_assertions, feature = "e2e"))]
    let builder = builder.invoke_handler(handlers!(e2e::e2e_log, e2e::e2e_exit, e2e::e2e_focus));
    #[cfg(not(any(debug_assertions, feature = "e2e")))]
    let builder = builder.invoke_handler(handlers!());
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Stop the language server with the app rather than leaving it to notice.
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                let labels: Vec<String> = state
                    .sessions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .keys()
                    .cloned()
                    .collect();
                for label in labels {
                    state.end_session(&label);
                }
            }
        });
}
