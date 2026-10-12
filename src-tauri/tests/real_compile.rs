//! Exercises compile, diagnostics and SyncTeX against a real TeX installation.
//! Skipped (with a note) on machines that have neither Tectonic nor latexmk.

use emquad_lib::compile::{self, pick_engine};
use emquad_lib::project::Project;
use emquad_lib::synctex::SyncTex;
use std::sync::{Arc, Mutex};

const MAIN: &str = r"\documentclass[11pt]{article}
\begin{document}
\section{First}
The first paragraph of the main file sits on page one.

\input{sections/proof}

\newpage
\section{Second}
A paragraph on the second page.
\end{document}
";

const PROOF: &str = r"\section{Included}
This sentence lives in an included file.

Another paragraph in the included file.
";

#[test]
fn compiles_reports_errors_and_maps_between_source_and_pdf() {
    let sidecars = [std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecars")];
    let Ok(engine) = pick_engine("auto", &sidecars) else {
        eprintln!("skipped: no LaTeX engine on this machine");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    let project = Project::create(&tmp.path().join("paper two"), "paper", "article").unwrap();
    project.write_file("main.tex", MAIN).unwrap();
    project.write_file("sections/proof.tex", PROOF).unwrap();
    let running = Arc::new(Mutex::new(None));
    let lines = Mutex::new(0usize);
    let on_log = |_: &str| *lines.lock().unwrap() += 1;

    let out = compile::run(&project, engine.as_ref(), &running, &on_log).unwrap();
    assert!(out.ok, "{out:?}");
    assert!(out.has_pdf && compile::pdf_path(&project).is_file());
    assert!(*lines.lock().unwrap() > 0, "log lines are streamed");

    // SyncTeX on real output.
    let base = compile::pdf_path(&project);
    let gz = base.with_extension("synctex.gz");
    let file = if gz.is_file() {
        gz
    } else {
        base.with_extension("synctex")
    };
    let sync = SyncTex::load(&file, &project.root, &project.root).unwrap();
    assert_eq!(sync.page_count(), 2);

    let in_main = sync.forward("main.tex", 4).unwrap();
    assert_eq!(in_main.page, 1);
    // US Letter or A4: the text block is well inside the page.
    assert!(in_main.x > 50.0 && in_main.x < 300.0, "{in_main:?}");
    assert!(in_main.y > 50.0 && in_main.y < 700.0, "{in_main:?}");
    assert!(
        in_main.width > 100.0 && in_main.width < 600.0,
        "{in_main:?}"
    );

    let included = sync.forward("sections/proof.tex", 2).unwrap();
    assert_eq!(included.page, 1);
    assert!(
        included.y > in_main.y,
        "the included text comes after the first paragraph"
    );
    let back = sync
        .inverse(
            included.page,
            included.x + 20.0,
            included.y + included.height / 2.0,
        )
        .unwrap();
    assert_eq!(back.file, "sections/proof.tex");
    assert!(back.line.abs_diff(2) <= 1, "{back:?}");

    let second = sync.forward("main.tex", 10).unwrap();
    assert_eq!(second.page, 2);
    let back = sync
        .inverse(2, second.x + 20.0, second.y + second.height / 2.0)
        .unwrap();
    assert_eq!(back.file, "main.tex");
    assert!(back.line.abs_diff(10) <= 1, "{back:?}");

    // An error in the included file is reported against that file and line, and the last good
    // PDF stays in place.
    project
        .write_file(
            "sections/proof.tex",
            "\\section{Included}\nBroken \\undefinedcommand here.\n",
        )
        .unwrap();
    let out = compile::run(&project, engine.as_ref(), &running, &on_log).unwrap();
    assert!(!out.ok);
    assert!(out.has_pdf);
    let error = out
        .diagnostics
        .iter()
        .find(|d| d.severity == "error")
        .unwrap_or_else(|| panic!("no error in {:?}", out.diagnostics));
    assert_eq!((error.file.as_str(), error.line), ("sections/proof.tex", 2));
    assert!(error.message.contains("Undefined control sequence"));
}
