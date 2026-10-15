//! Word documents, through Pandoc: a separate program the user installs, which Emquad looks for
//! and runs when asked, and never ships. "Send to Word" turns the document into a .docx where
//! the user chooses; "Open a Word file" turns one into a new project of its own, so nothing of
//! an existing project is touched.

use crate::compile::{kill_tree, quiet};
use crate::error::{Error, Result};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The longest a conversion may take before it is stopped.
const DEADLINE: Duration = Duration::from_secs(180);

fn missing() -> Error {
    Error::app(
        "no_pandoc",
        "Sending to Word and opening Word files use Pandoc, a free program installed separately. Install it from pandoc.org, then try again.",
    )
}

/// Where Pandoc is on this computer: on the PATH, or where its installer puts it.
pub fn find() -> Option<PathBuf> {
    let mut dirs = Vec::new();
    for var in ["LOCALAPPDATA", "ProgramFiles"] {
        if let Some(base) = std::env::var_os(var) {
            dirs.push(PathBuf::from(base).join("Pandoc"));
        }
    }
    // The PATH first: a Pandoc the user put there is the one they mean.
    crate::compile::find_exe("pandoc", &[]).or_else(|| crate::compile::find_exe("pandoc", &dirs))
}

/// Run Pandoc with `args` in the folder `cwd`, stopping it if it runs past the deadline. What it
/// warned about, one line each.
fn run(pandoc: &Path, args: &[&std::ffi::OsStr], cwd: &Path) -> Result<Vec<String>> {
    let mut child = quiet(Command::new(pandoc).args(args))
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::app("no_pandoc", format!("Pandoc could not be started: {e}")))?;
    // Read what it says as it goes, so a long report never stops it.
    let mut stderr = child.stderr.take().expect("piped");
    let reader = std::thread::spawn(move || {
        let mut said = Vec::new();
        let _ = (&mut stderr).take(1 << 20).read_to_end(&mut said);
        String::from_utf8_lossy(&said).into_owned()
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() > DEADLINE {
            kill_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::app(
                "pandoc_failed",
                "Pandoc took too long and was stopped.",
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let said = reader.join().unwrap_or_default();
    let lines: Vec<String> = said
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();
    if !status.success() {
        let last: Vec<&str> = lines
            .iter()
            .rev()
            .take(4)
            .rev()
            .map(String::as_str)
            .collect();
        return Err(Error::app(
            "pandoc_failed",
            format!("Pandoc could not convert the document: {}", last.join(" ")),
        ));
    }
    Ok(lines)
}

/// Turn the document whose main file is `main` into a Word file at `dest`, its pictures and,
/// when `bibliography` is given, its references with it. What Pandoc warned about.
pub fn to_word(
    pandoc: &Path,
    main: &Path,
    bibliography: Option<&Path>,
    dest: &Path,
) -> Result<Vec<String>> {
    let folder = main
        .parent()
        .ok_or_else(|| Error::app("bad_path", "The main file has no folder"))?;
    let parent = dest
        .parent()
        .ok_or_else(|| Error::app("bad_path", "Choose a folder for the Word file"))?;
    // Written beside the destination first, and put in place whole.
    let tmp = tempfile::Builder::new()
        .suffix(".docx")
        .tempfile_in(parent)?
        .into_temp_path();
    let mut args: Vec<&std::ffi::OsStr> = vec![
        main.as_os_str(),
        "--from=latex".as_ref(),
        "--to=docx".as_ref(),
        "--output".as_ref(),
        tmp.as_os_str(),
        "--resource-path".as_ref(),
        folder.as_os_str(),
    ];
    if let Some(bib) = bibliography {
        args.extend([
            "--citeproc".as_ref(),
            "--bibliography".as_ref(),
            bib.as_os_str(),
        ]);
    }
    let warnings = run(pandoc, &args, folder)?;
    tmp.persist(dest).map_err(|e| Error::Io(e.error))?;
    Ok(warnings)
}

/// Turn the Word file `source` into LaTeX in the empty folder `dir`: `main.tex`, and its
/// pictures in `media/`. Done in a folder of its own beside `dir` and moved there whole, so a
/// failure leaves nothing behind. What Pandoc warned about.
pub fn from_word(pandoc: &Path, source: &Path, dir: &Path) -> Result<Vec<String>> {
    if dir.exists() && std::fs::read_dir(dir)?.next().is_some() {
        return Err(Error::app(
            "not_empty",
            format!("{} already contains files", dir.display()),
        ));
    }
    let parent = dir
        .parent()
        .ok_or_else(|| Error::app("bad_path", "Choose a folder for the project"))?;
    std::fs::create_dir_all(parent)?;
    let work = tempfile::tempdir_in(parent)?;
    let args: Vec<&std::ffi::OsStr> = vec![
        source.as_os_str(),
        "--from=docx".as_ref(),
        "--to=latex".as_ref(),
        "--standalone".as_ref(),
        "--extract-media=.".as_ref(),
        "--output".as_ref(),
        "main.tex".as_ref(),
    ];
    let warnings = run(pandoc, &args, work.path())?;
    if !work.path().join("main.tex").is_file() {
        return Err(Error::app(
            "pandoc_failed",
            "Pandoc gave no LaTeX for the Word file.",
        ));
    }
    if dir.exists() {
        std::fs::remove_dir(dir)?;
    }
    let made = work.keep();
    if let Err(e) = std::fs::rename(&made, dir) {
        let _ = std::fs::remove_dir_all(&made);
        return Err(e.into());
    }
    Ok(warnings)
}

pub fn require() -> Result<PathBuf> {
    find().ok_or_else(missing)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;

    /// A stand-in for Pandoc: notes how it was called, and writes the file it was asked for.
    fn stand_in(dir: &Path, exit: u8) -> PathBuf {
        let script = dir.join("pandoc.cmd");
        fs::write(
            &script,
            format!(
                "@echo off\r\necho %* > \"{}\"\r\necho [WARNING] Could not convert something 1>&2\r\nset out=\r\n:loop\r\nif \"%~1\"==\"\" goto done\r\nif \"%~1\"==\"--output\" set out=%~2\r\nshift\r\ngoto loop\r\n:done\r\nif not \"%out%\"==\"\" echo converted> \"%out%\"\r\nexit /b {exit}\r\n",
                dir.join("called.txt").display()
            ),
        )
        .unwrap();
        script
    }

    #[test]
    fn a_word_file_becomes_a_new_folder_whole_or_not_at_all() {
        let tmp = tempfile::tempdir().unwrap();
        let pandoc = stand_in(tmp.path(), 0);
        let source = tmp.path().join("Report.docx");
        fs::write(&source, "docx").unwrap();
        let dir = tmp.path().join("projects").join("Report");
        let warnings = from_word(&pandoc, &source, &dir).unwrap();
        assert_eq!(warnings, ["[WARNING] Could not convert something"]);
        assert_eq!(
            fs::read_to_string(dir.join("main.tex")).unwrap().trim(),
            "converted"
        );
        let called = fs::read_to_string(tmp.path().join("called.txt")).unwrap();
        assert!(called.contains("--from=docx") && called.contains("--extract-media=."));
        // Into a folder that has files: refused before anything runs.
        assert_eq!(
            from_word(&pandoc, &source, &dir).unwrap_err().code(),
            "not_empty"
        );
        // A failure leaves no folder, and nothing beside it.
        let failing = stand_in(&tmp.path().join("projects"), 3);
        let other = tmp.path().join("projects").join("Other");
        assert_eq!(
            from_word(&failing, &source, &other).unwrap_err().code(),
            "pandoc_failed"
        );
        assert!(!other.exists());
        let left: Vec<_> = fs::read_dir(tmp.path().join("projects"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            left.iter()
                .all(|n| n == "Report" || n == "pandoc.cmd" || n == "called.txt"),
            "{left:?}"
        );
    }

    #[test]
    fn a_document_goes_to_word_with_its_pictures_and_references() {
        let tmp = tempfile::tempdir().unwrap();
        let pandoc = stand_in(tmp.path(), 0);
        let project = tmp.path().join("paper");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("main.tex"), "x").unwrap();
        fs::write(project.join("refs.bib"), "").unwrap();
        let dest = tmp.path().join("out").join("paper.docx");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        to_word(
            &pandoc,
            &project.join("main.tex"),
            Some(&project.join("refs.bib")),
            &dest,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap().trim(), "converted");
        let called = fs::read_to_string(tmp.path().join("called.txt")).unwrap();
        assert!(
            called.contains("--to=docx")
                && called.contains("--citeproc")
                && called.contains("refs.bib")
                && called.contains("--resource-path")
        );
        // A failed conversion leaves the file that was there as it was.
        let failing = stand_in(&tmp.path().join("out"), 2);
        assert_eq!(
            to_word(&failing, &project.join("main.tex"), None, &dest)
                .unwrap_err()
                .code(),
            "pandoc_failed"
        );
        assert_eq!(fs::read_to_string(&dest).unwrap().trim(), "converted");
    }
}
