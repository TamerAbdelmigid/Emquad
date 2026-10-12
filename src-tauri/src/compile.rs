//! Turning the project's main file into a PDF with whichever engine is available.

use crate::error::{Error, Result};
use crate::project::Project;
use regex::Regex;
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Instant;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Diagnostic {
    /// "error" or "warning"
    pub severity: String,
    /// Project-relative path, forward slashes.
    pub file: String,
    /// 1-based; 0 when the log gives no line.
    pub line: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildOutput {
    pub ok: bool,
    pub cancelled: bool,
    pub engine: String,
    pub diagnostics: Vec<Diagnostic>,
    /// A PDF exists, from this run or an earlier one.
    pub has_pdf: bool,
    #[ts(type = "number")]
    pub duration_ms: u64,
}

pub trait Engine: Send + Sync {
    fn name(&self) -> &'static str;
    /// The command to run, with the working directory already set to the main file's folder.
    fn command(&self, main_name: &str, build_dir: &Path) -> Command;
}

pub struct Tectonic(pub PathBuf);
pub struct Latexmk(pub PathBuf);

impl Engine for Tectonic {
    fn name(&self) -> &'static str {
        "tectonic"
    }
    fn command(&self, main_name: &str, build_dir: &Path) -> Command {
        let mut c = Command::new(&self.0);
        c.args(["-X", "compile", "--synctex", "--keep-logs", "--outdir"])
            .arg(build_dir)
            .arg(main_name);
        c
    }
}

impl Engine for Latexmk {
    fn name(&self) -> &'static str {
        "latexmk"
    }
    fn command(&self, main_name: &str, build_dir: &Path) -> Command {
        let mut c = Command::new(&self.0);
        c.args([
            "-pdf",
            "-interaction=nonstopmode",
            "-file-line-error",
            "-synctex=1",
        ])
        .arg(format!("-outdir={}", build_dir.display()))
        .arg(main_name);
        c
    }
}

/// Look for an executable in a set of extra folders first, then on PATH.
pub fn find_exe(name: &str, extra_dirs: &[PathBuf]) -> Option<PathBuf> {
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let path_dirs = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();
    extra_dirs
        .iter()
        .chain(path_dirs.iter())
        .map(|d| d.join(&file))
        .find(|p| p.is_file())
}

/// Choose the engine for a project. "auto" prefers the bundled Tectonic and falls back to a
/// system latexmk; an explicit choice falls back the same way rather than failing outright.
pub fn pick_engine(preference: &str, sidecar_dirs: &[PathBuf]) -> Result<Box<dyn Engine>> {
    let tectonic =
        || find_exe("tectonic", sidecar_dirs).map(|p| Box::new(Tectonic(p)) as Box<dyn Engine>);
    let latexmk = || find_exe("latexmk", &[]).map(|p| Box::new(Latexmk(p)) as Box<dyn Engine>);
    let found = if preference == "latexmk" {
        latexmk().or_else(tectonic)
    } else {
        tectonic().or_else(latexmk)
    };
    found.ok_or_else(|| {
        Error::app(
            "no_engine",
            "No LaTeX compiler was found. Emquad's bundled compiler is missing and there is no latexmk on this computer.",
        )
    })
}

/// Stop a running compile, including the programs it started.
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = quiet(Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}

/// Keep child processes from flashing a console window on Windows.
fn quiet(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

pub fn pdf_path(project: &Project) -> PathBuf {
    let stem = Path::new(&project.info.main_file)
        .file_stem()
        .map(|s| s.to_os_string())
        .unwrap_or_default();
    project.build_dir().join(stem).with_extension("pdf")
}

/// Run one compile. `running` holds the child's process id while it runs so another thread can
/// cancel it; `on_log` receives output lines as they arrive.
pub fn run(
    project: &Project,
    engine: &dyn Engine,
    running: &Arc<Mutex<Option<u32>>>,
    on_log: &(dyn Fn(&str) + Sync),
) -> Result<BuildOutput> {
    if project.info.main_file.is_empty() {
        return Err(Error::app(
            "no_main_file",
            "This project has no main .tex file to compile",
        ));
    }
    let main = project.resolve(&project.info.main_file)?;
    let (cwd, main_name) = (
        main.parent().unwrap_or(&project.root),
        main.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default(),
    );
    let build = project.build_dir();
    fs::create_dir_all(&build)?;
    let started = Instant::now();

    let mut command = engine.command(main_name, &build);
    quiet(&mut command)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| {
        Error::app(
            "engine_failed",
            format!("Could not start {}: {e}", engine.name()),
        )
    })?;
    *running.lock().unwrap() = Some(child.id());

    let (tx, rx) = mpsc::channel::<String>();
    let mut readers = Vec::new();
    let streams: [Option<Box<dyn std::io::Read + Send>>; 2] = [
        child.stdout.take().map(|s| Box::new(s) as _),
        child.stderr.take().map(|s| Box::new(s) as _),
    ];
    for stream in streams.into_iter().flatten() {
        let tx = tx.clone();
        readers.push(std::thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut buf = Vec::new();
            while reader.read_until(b'\n', &mut buf).unwrap_or(0) > 0 {
                let line = String::from_utf8_lossy(&buf).trim_end().to_string();
                if tx.send(line).is_err() {
                    break;
                }
                buf.clear();
            }
        }));
    }
    drop(tx);
    let mut output = String::new();
    for line in rx {
        on_log(&line);
        output.push_str(&line);
        output.push('\n');
    }
    for r in readers {
        let _ = r.join();
    }
    let status = child.wait()?;
    let cancelled = running.lock().unwrap().take().is_none();

    // The engine's own log file is more complete than what it prints, when it exists.
    let log_file = pdf_path(project).with_extension("log");
    let log = fs::read(&log_file)
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    let mut diagnostics = parse_log(&format!("{log}\n{output}"), &project.info.main_file);
    diagnostics.dedup();
    let has_pdf = pdf_path(project).is_file();
    let ok = !cancelled
        && status.success()
        && has_pdf
        && !diagnostics.iter().any(|d| d.severity == "error");
    Ok(BuildOutput {
        ok,
        cancelled,
        engine: engine.name().into(),
        diagnostics,
        has_pdf,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

fn clean_file(raw: &str, main_file: &str) -> String {
    let f = raw.trim().replace('\\', "/");
    let f = f.strip_prefix("./").unwrap_or(&f);
    if f.is_empty() {
        return main_file.to_string();
    }
    // Tectonic names an included file the way the document did, usually without ".tex".
    let has_extension = f.rsplit('/').next().is_some_and(|name| name.contains('.'));
    if has_extension {
        f.to_string()
    } else {
        format!("{f}.tex")
    }
}

/// Pull errors and warnings out of compiler output. Log formats are irregular, so this
/// recognises the common shapes and ignores the rest; see the fixture tests below.
pub fn parse_log(log: &str, main_file: &str) -> Vec<Diagnostic> {
    // "./sections/a.tex:12: Undefined control sequence."  (file-line-error style)
    let file_line =
        Regex::new(r"^(?:error: )?([^\s:][^:\n]*\.(?:tex|sty|cls|bib|bbl|aux)):(\d+): (.+)$")
            .unwrap();
    // "warning: main.tex:7: Overfull \hbox ..." and "error: sections/proof:2: Undefined ..."
    // (Tectonic; the file may be given without its extension)
    let tectonic = Regex::new(r"^(warning|error): ([^:\n]+):(\d+): (.+)$").unwrap();
    // "LaTeX Warning: Reference `x' on page 1 undefined on input line 9."
    let latex_warn = Regex::new(r"^(?:LaTeX|Package \S+) Warning: (.+)$").unwrap();
    let on_line = Regex::new(r"on input line (\d+)").unwrap();
    // "! Undefined control sequence." followed some lines later by "l.12 \foo"
    let bang = Regex::new(r"^! (.+)$").unwrap();
    let l_dot = Regex::new(r"^l\.(\d+)").unwrap();

    let lines: Vec<&str> = log.lines().collect();
    let mut out: Vec<Diagnostic> = Vec::new();
    let mut seen_file_line_errors = false;
    let mut unplaced: Vec<Diagnostic> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if let Some(c) = tectonic.captures(line) {
            seen_file_line_errors |= &c[1] == "error";
            out.push(Diagnostic {
                severity: c[1].to_string(),
                file: clean_file(&c[2], main_file),
                line: c[3].parse().unwrap_or(0),
                message: c[4].trim().into(),
            });
        } else if let Some(c) = file_line.captures(line) {
            seen_file_line_errors = true;
            out.push(Diagnostic {
                severity: "error".into(),
                file: clean_file(&c[1], main_file),
                line: c[2].parse().unwrap_or(0),
                message: c[3].trim().into(),
            });
        } else if let Some(c) = latex_warn.captures(line) {
            // Warnings wrap; join the continuation so "on input line N" is found.
            let mut message = c[1].trim().to_string();
            if !message.ends_with('.')
                && let Some(next) = lines.get(i + 1)
            {
                message.push(' ');
                message.push_str(next.trim());
            }
            out.push(Diagnostic {
                severity: "warning".into(),
                file: main_file.into(),
                line: on_line
                    .captures(&message)
                    .and_then(|c| c[1].parse().ok())
                    .unwrap_or(0),
                message,
            });
        } else if let Some(c) = bang.captures(line) {
            let line_no = lines[i + 1..]
                .iter()
                .take(12)
                .find_map(|l| l_dot.captures(l))
                .and_then(|c| c[1].parse().ok())
                .unwrap_or(0);
            unplaced.push(Diagnostic {
                severity: "error".into(),
                file: main_file.into(),
                line: line_no,
                message: c[1].trim().into(),
            });
        }
    }
    // A "! ..." error names no file. When the same run also reports errors with a file and a
    // line, those describe the same problems better, so the unplaced ones are dropped.
    if !seen_file_line_errors {
        out.extend(unplaced);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(severity: &str, file: &str, line: u32, message: &str) -> Diagnostic {
        Diagnostic {
            severity: severity.into(),
            file: file.into(),
            line,
            message: message.into(),
        }
    }

    #[test]
    fn file_line_error_style_including_an_included_file() {
        let log = "(./main.tex\nLaTeX2e <2024-11-01>\n(./sections/proof.tex\n./sections/proof.tex:4: Undefined control sequence.\nl.4 \\foo\n         bar\n)\n./main.tex:21: LaTeX Error: \\begin{equation} on input line 19 ended by \\end{document}.\n";
        assert_eq!(
            parse_log(log, "main.tex"),
            [
                d(
                    "error",
                    "sections/proof.tex",
                    4,
                    "Undefined control sequence."
                ),
                d(
                    "error",
                    "main.tex",
                    21,
                    "LaTeX Error: \\begin{equation} on input line 19 ended by \\end{document}."
                ),
            ]
        );
    }

    #[test]
    fn classic_bang_errors_take_their_line_from_the_l_dot_marker() {
        let log = "! Undefined control sequence.\n<recently read> \\foo \n\nl.12 \\foo\n         bar\n? \n";
        assert_eq!(
            parse_log(log, "main.tex"),
            [d("error", "main.tex", 12, "Undefined control sequence.")]
        );
    }

    #[test]
    fn warnings_from_latex_and_tectonic() {
        let log = "LaTeX Warning: Reference `eq:polar' on page 1 undefined on input line 9.\n\nPackage hyperref Warning: Token not allowed in a PDF string\n(hyperref)                on input line 14.\nwarning: main.tex:7: Overfull \\hbox (12.3pt too wide) in paragraph\nerror: main.tex:3: Undefined control sequence\n";
        assert_eq!(
            parse_log(log, "main.tex"),
            [
                d(
                    "warning",
                    "main.tex",
                    9,
                    "Reference `eq:polar' on page 1 undefined on input line 9."
                ),
                d(
                    "warning",
                    "main.tex",
                    14,
                    "Token not allowed in a PDF string (hyperref)                on input line 14."
                ),
                d(
                    "warning",
                    "main.tex",
                    7,
                    "Overfull \\hbox (12.3pt too wide) in paragraph"
                ),
                d("error", "main.tex", 3, "Undefined control sequence"),
            ]
        );
    }

    #[test]
    fn tectonic_names_included_files_without_their_extension() {
        // The engine's own log comes first and has only the "!" form; Tectonic's summary line,
        // which names the file, comes after it.
        let log = "(main.tex\n(sections/proof\n! Undefined control sequence.\nl.2 Broken \\undefinedcommand\n                             here.\nNo pages of output.\n\nnote: downloading size10.clo\nerror: sections/proof:2: Undefined control sequence\nerror: something bad happened inside XeTeX; its output follows:\nerror: the XeTeX engine had an unrecoverable error\n";
        assert_eq!(
            parse_log(log, "main.tex"),
            [d(
                "error",
                "sections/proof.tex",
                2,
                "Undefined control sequence"
            )]
        );
    }

    #[test]
    fn a_clean_log_has_no_diagnostics() {
        assert!(
            parse_log(
                "Output written on main.pdf (1 page, 12345 bytes).\n",
                "main.tex"
            )
            .is_empty()
        );
    }
}
