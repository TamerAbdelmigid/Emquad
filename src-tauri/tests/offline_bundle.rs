//! A bundle that carries its LaTeX packages compiles on the receiving side with the network
//! blocked. Uses the real Tectonic; skipped (with a note) where it is not installed.
//!
//! This file is its own test program because it cuts the whole process off from the network.

use emquad_lib::bundle::{self, Extras};
use emquad_lib::compile::{self, Tectonic, find_exe};
use emquad_lib::history::{Author, History};
use emquad_lib::packages;
use emquad_lib::project::Project;
use std::sync::{Arc, Mutex};

#[test]
fn a_bundle_with_its_packages_compiles_offline_from_the_projects_own_store() {
    let sidecars = [std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecars")];
    let Some(exe) = find_exe("tectonic", &sidecars) else {
        eprintln!("skipped: Tectonic is not on this machine");
        return;
    };
    let engine = Tectonic(exe.clone());
    let tmp = tempfile::tempdir().unwrap();
    let a = Project::create(&tmp.path().join("a"), "paper", "article").unwrap();
    let running = Arc::new(Mutex::new(None));
    let quiet = |_: &str| {};

    // The sender compiles once, fetching whatever the document needs.
    let first = compile::run(&a, &engine, &running, &quiet).unwrap();
    assert!(first.ok, "{first:?}");
    let store = packages::store_for(&a, &exe).expect("a compile leaves a package store");
    let carried = packages::list(&store).unwrap();
    assert!(packages::info(&carried).available);

    // From here on nothing in this process can reach the network.
    for name in [
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "https_proxy",
        "http_proxy",
    ] {
        // SAFETY: this test program has one test, and no other thread reads the environment.
        unsafe { std::env::set_var(name, "http://127.0.0.1:9") };
    }

    let checked =
        packages::verify(&exe, &a, &carried).expect("the carried packages are enough to compile");
    assert_eq!(checked.entries().len(), carried.len());
    // What will be carried is the checked copy, not the live store, which may change.
    assert!(
        checked
            .entries()
            .iter()
            .all(|e| !e.path.starts_with(&store))
    );
    let me = Author {
        id: "a".into(),
        name: "Tamer".into(),
    };
    let file = tmp.path().join("paper.emquad");
    let extras = Extras {
        pdf: false,
        packages: Some(&checked),
        comments: None,
    };
    let manifest =
        bundle::export(&a, &History::open(&a).unwrap(), &me, &file, "", &extras).unwrap();
    assert!(manifest.includes.packages);

    // The receiving side: a new project that has never compiled anything.
    let b = bundle::import_new(&file, &tmp.path().join("elsewhere")).unwrap();
    let own = packages::project_cache(&b);
    assert!(own.join("bundles").is_dir());
    assert!(
        !own.join("formats").exists(),
        "no compiled format is carried"
    );
    let out = compile::run(&b, &engine, &running, &quiet).unwrap();
    assert!(out.ok, "{out:?}");
    assert!(
        own.join("formats").is_dir(),
        "the compile used the project's own store and built its format there"
    );

    // A document that needs a package nobody has cannot be promised to compile offline.
    a.write_file(
        "main.tex",
        "\\documentclass{article}\n\\usepackage{nosuchpackage-emquad}\n\\begin{document}x\\end{document}\n",
    )
    .unwrap();
    let refused = packages::verify(&exe, &a, &carried).err().map(|e| e.code());
    assert_eq!(refused, Some("packages_incomplete"));
    // Nothing to carry is not something to promise either.
    assert!(packages::verify(&exe, &b, &[]).is_err());
}
