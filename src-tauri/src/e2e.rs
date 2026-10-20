//! Test harness for checking the real window from the inside (see scripts/e2e.js and
//! scripts/smoke-release.js).
//!
//! When `EMQUAD_E2E` names a script, the app runs it in the page each time the page finishes
//! loading. The script reports through `e2e_log` and ends the app with `e2e_exit`.
//!
//! The harness exists in debug builds, and in release builds only when compiled with the `e2e`
//! feature, which is how the packaged frontend is smoke-tested. The installer is built without
//! that feature, so none of this is in what users install.

use tauri::{Runtime, Webview, webview::PageLoadPayload};

#[cfg(any(debug_assertions, feature = "e2e"))]
pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    // The script drives the first window; another window it opens is left to itself.
    if payload.event() != tauri::webview::PageLoadEvent::Finished || webview.label() != "main" {
        return;
    }
    let Ok(script_path) = std::env::var("EMQUAD_E2E") else {
        return;
    };
    let Ok(script) = std::fs::read_to_string(&script_path) else {
        return;
    };
    let work = std::env::var("EMQUAD_E2E_WORK").unwrap_or_default();
    let _ = webview.eval(format!(
        "window.__E2E_WORK = {};\n{script}",
        serde_json::to_string(&work).unwrap_or_default()
    ));
}

#[cfg(not(any(debug_assertions, feature = "e2e")))]
pub fn on_page_load<R: Runtime>(_: &Webview<R>, _: &PageLoadPayload<'_>) {}

#[cfg(any(debug_assertions, feature = "e2e"))]
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

/// Bring the window to the front: the page gets focus events only while its window has the focus.
#[cfg(any(debug_assertions, feature = "e2e"))]
#[tauri::command]
pub fn e2e_focus(window: tauri::Window) {
    let _ = window.set_focus();
}

#[cfg(any(debug_assertions, feature = "e2e"))]
#[tauri::command]
pub fn e2e_exit(app: tauri::AppHandle, code: i32) {
    app.exit(code);
}

/// During a harness run, settings live in the run's own folder, not the user's.
pub fn config_dir() -> Option<std::path::PathBuf> {
    if !cfg!(any(debug_assertions, feature = "e2e")) || std::env::var_os("EMQUAD_E2E").is_none() {
        return None;
    }
    std::env::var_os("EMQUAD_E2E_WORK").map(|work| std::path::PathBuf::from(work).join("config"))
}
