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

/// What a run of Pandoc printed, and what it warned about, one line each.
struct Ran {
    printed: String,
    warnings: Vec<String>,
}

/// Read up to a megabyte of what a program writes, and let the rest go by unread, so a long
/// report never stops it.
fn drain(mut from: impl Read + Send + 'static) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let _ = (&mut from).take(1 << 20).read_to_end(&mut kept);
        let _ = std::io::copy(&mut from, &mut std::io::sink());
        String::from_utf8_lossy(&kept).into_owned()
    })
}

/// Run Pandoc with `args` in the folder `cwd`, stopping it if it runs past `deadline`.
fn run(pandoc: &Path, args: &[&std::ffi::OsStr], cwd: &Path, deadline: Duration) -> Result<Ran> {
    let mut child = quiet(Command::new(pandoc).args(args))
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::app("no_pandoc", format!("Pandoc could not be started: {e}")))?;
    let printed = drain(child.stdout.take().expect("piped"));
    let said = drain(child.stderr.take().expect("piped"));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() > deadline {
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
    let printed = printed.join().unwrap_or_default();
    let said = said.join().unwrap_or_default();
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
    Ok(Ran {
        printed,
        warnings: lines,
    })
}

/// The oldest Pandoc used: older ones could be led by a Word file to write pictures outside the
/// folder they were asked to (CVE-2023-35936, CVE-2023-38745).
const OLDEST: (u32, u32, u32) = (3, 1, 6);

/// Pandoc's version, from its first line, such as "pandoc 3.6.4".
fn version(pandoc: &Path) -> Result<(u32, u32, u32)> {
    let ran = run(
        pandoc,
        &["--version".as_ref()],
        Path::new("."),
        Duration::from_secs(20),
    )?;
    let word = ran
        .printed
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("");
    let mut parts = word.split('.').map(|p| p.trim().parse::<u32>().ok());
    match (parts.next().flatten(), parts.next().flatten()) {
        (Some(major), Some(minor)) => Ok((major, minor, parts.next().flatten().unwrap_or(0))),
        _ => Err(Error::app(
            "no_pandoc",
            "The program found as Pandoc did not say which version it is. Install Pandoc from pandoc.org.",
        )),
    }
}

/// Pandoc, found and new enough to be used, or why not.
pub fn require() -> Result<PathBuf> {
    new_enough(find().ok_or_else(missing)?)
}

/// `pandoc`, if it is new enough to be used.
fn new_enough(pandoc: PathBuf) -> Result<PathBuf> {
    let found = version(&pandoc)?;
    if found < OLDEST {
        return Err(Error::app(
            "old_pandoc",
            format!(
                "This computer has Pandoc {}.{}.{}; Emquad needs {}.{}.{} or newer, which is safe with Word files from others. Install the newest from pandoc.org.",
                found.0, found.1, found.2, OLDEST.0, OLDEST.1, OLDEST.2
            ),
        ));
    }
    Ok(pandoc)
}

/// Turn the document whose main file is `main` into a Word file at `dest`, with its pictures and
/// the references of the .bib files `bibliographies`. What Pandoc warned about.
pub fn to_word(
    pandoc: &Path,
    main: &Path,
    bibliographies: &[PathBuf],
    dest: &Path,
) -> Result<Vec<String>> {
    if !dest
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("docx"))
    {
        return Err(Error::app(
            "bad_path",
            "A Word file's name ends in .docx: choose one that does.",
        ));
    }
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
    if !bibliographies.is_empty() {
        args.push("--citeproc".as_ref());
        for bib in bibliographies {
            args.extend(["--bibliography".as_ref(), bib.as_os_str()]);
        }
    }
    let warnings = run(pandoc, &args, folder, DEADLINE)?.warnings;
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
    let warnings = run(pandoc, &args, work.path(), DEADLINE)?.warnings;
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;

    /// A stand-in for Pandoc: notes how it was called, and writes the file it was asked for.
    fn stand_in(dir: &Path, exit: u8) -> PathBuf {
        stand_in_of(dir, exit, "3.6.4")
    }

    fn stand_in_of(dir: &Path, exit: u8, version: &str) -> PathBuf {
        let script = dir.join("pandoc.cmd");
        fs::write(
            &script,
            format!(
                "@echo off\r\nif \"%~1\"==\"--version\" (echo pandoc {version}& exit /b 0)\r\necho %* > \"{}\"\r\necho [WARNING] Could not convert something 1>&2\r\nset out=\r\n:loop\r\nif \"%~1\"==\"\" goto done\r\nif \"%~1\"==\"--output\" set out=%~2\r\nshift\r\ngoto loop\r\n:done\r\nif not \"%out%\"==\"\" echo converted> \"%out%\"\r\nexit /b {exit}\r\n",
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
            &[project.join("refs.bib"), project.join("more.bib")],
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
            to_word(&failing, &project.join("main.tex"), &[], &dest)
                .unwrap_err()
                .code(),
            "pandoc_failed"
        );
        assert_eq!(fs::read_to_string(&dest).unwrap().trim(), "converted");
        // Only to a Word file: never over a file of another kind, such as a source file.
        assert_eq!(
            to_word(
                &pandoc,
                &project.join("main.tex"),
                &[],
                &project.join("main.tex")
            )
            .unwrap_err()
            .code(),
            "bad_path"
        );
        assert_eq!(fs::read_to_string(project.join("main.tex")).unwrap(), "x");
    }

    #[test]
    fn a_pandoc_too_old_to_be_safe_with_word_files_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let new = stand_in(tmp.path(), 0);
        assert_eq!(version(&new).unwrap(), (3, 6, 4));
        assert!(new_enough(new).is_ok());
        let old_dir = tmp.path().join("old");
        fs::create_dir_all(&old_dir).unwrap();
        let old = stand_in_of(&old_dir, 0, "3.1.5");
        assert_eq!(new_enough(old).unwrap_err().code(), "old_pandoc");
        let two_dir = tmp.path().join("two");
        fs::create_dir_all(&two_dir).unwrap();
        let two = stand_in_of(&two_dir, 0, "2.19");
        assert_eq!(version(&two).unwrap(), (2, 19, 0));
        assert_eq!(new_enough(two).unwrap_err().code(), "old_pandoc");
    }
}
