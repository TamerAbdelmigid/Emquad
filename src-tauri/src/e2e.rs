//! Development-only harness for end-to-end checks of the real window (see scripts/e2e.js).
//!
//! When `EMQUAD_E2E` names a script, a debug build runs it in the page once the page has
//! loaded. The script reports through `e2e_log` and ends the app with `e2e_exit`. None of this
//! exists in release builds.

use tauri::{Runtime, Webview, webview::PageLoadPayload};

#[cfg(debug_assertions)]
pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static STARTED: AtomicBool = AtomicBool::new(false);
    if payload.event() != tauri::webview::PageLoadEvent::Finished {
        return;
    }
    let Ok(script_path) = std::env::var("EMQUAD_E2E") else {
        return;
    };
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let Ok(script) = std::fs::read_to_string(&script_path) else {
        return;
    };
    let work = std::env::var("EMQUAD_E2E_WORK").unwrap_or_default();
    let _ = webview.eval(format!(
        "window.__E2E_WORK = {};\n{script}",
        serde_json::to_string(&work).unwrap_or_default()
    ));
}

#[cfg(not(debug_assertions))]
pub fn on_page_load<R: Runtime>(_: &Webview<R>, _: &PageLoadPayload<'_>) {}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn e2e_log(line: String) {
    use std::io::Write;
    println!("{line}");
    if let Ok(path) = std::env::var("EMQUAD_E2E_OUT")
        && let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
    {
        let _ = writeln!(file, "{line}");
    }
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn e2e_exit(app: tauri::AppHandle, code: i32) {
    app.exit(code);
}

/// During an end-to-end run, settings live in the run's own folder, not the user's.
pub fn config_dir() -> Option<std::path::PathBuf> {
    if !cfg!(debug_assertions) || std::env::var_os("EMQUAD_E2E").is_none() {
        return None;
    }
    std::env::var_os("EMQUAD_E2E_WORK").map(|work| std::path::PathBuf::from(work).join("config"))
}
