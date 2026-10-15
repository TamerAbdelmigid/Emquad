//! What the editor needs to know about a project as a whole: its labels, its citation keys,
//! enough about each reference to show it by name, and the packages its own style files load.

use crate::error::Result;
use crate::project::{Project, as_text};
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, Prefix};
use std::sync::LazyLock;
use ts_rs::TS;

/// A pattern made once, on first use: a project's bibliography can hold thousands of entries.
macro_rules! pattern {
    ($name:ident, $re:expr) => {
        static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($re).unwrap());
    };
}
pattern!(AUTHOR, r"(?i)(?:^|[,\s])author\s*=\s*");
pattern!(EDITOR, r"(?i)(?:^|[,\s])editor\s*=\s*");
pattern!(YEAR, r"(?i)(?:^|[,\s])year\s*=\s*");
pattern!(DATE, r"(?i)(?:^|[,\s])date\s*=\s*");
pattern!(TITLE, r"(?i)(?:^|[,\s])title\s*=\s*");
pattern!(AND, r"(?i)\s+and\s+");
pattern!(ENTRY, r"(?m)^\s*@(\w+)\s*\{\s*([^,\s}]+)\s*,");
pattern!(
    USES,
    r"\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}"
);
pattern!(LABEL, r"\\label\{([^}]+)\}");
pattern!(
    CLASS,
    r"\\documentclass\s*(?:\[[^\]]*\])?\s*\{\s*([^}\s]+)\s*\}"
);
pattern!(BIB_ITEM, r"\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}");
pattern!(
    BIB_NAMED,
    r"\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}"
);

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectIndex {
    pub labels: Vec<String>,
    pub cite_keys: Vec<String>,
    /// The references found in the project's `.bib` files, and in `.bib` files elsewhere that
    /// the document names.
    pub citations: Vec<Citation>,
    /// For each style or class file of the project's own, by name, the packages it loads.
    pub style_packages: BTreeMap<String, Vec<String>>,
    /// How the last compile numbered each label, by label: what `\ref` prints for it.
    pub label_numbers: BTreeMap<String, Numbered>,
    /// The class the main file's document is of, such as "article" or "report"; empty when it
    /// names none.
    pub document_class: String,
}

/// How the last compile numbered a label.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Numbered {
    /// What `\ref` prints: "2", "3.1", "A".
    pub number: String,
    /// What `\pageref` prints.
    pub page: String,
    /// What is numbered, when the compile said (with hyperref): "section", "figure", "table",
    /// "equation"; empty otherwise.
    pub kind: String,
}

/// The largest `.aux` file read for label numbers.
const MAX_AUX: u64 = 4 << 20;

/// The braced groups that follow one another from `at`, each without its braces; reading stops
/// at anything else.
fn groups(text: &str, mut at: usize) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    while bytes.get(at) == Some(&b'{') {
        let mut depth = 0;
        let mut end = None;
        let mut i = at;
        while i < bytes.len() {
            match bytes[i] {
                b'\\' => i += 1,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(i);
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        let Some(end) = end else { break };
        out.push(text[at + 1..end].to_string());
        at = end + 1;
    }
    out
}

/// The labels an `.aux` file records, as `\newlabel{key}{{number}{page}{title}{anchor}…}`.
fn label_numbers(aux: &str, out: &mut BTreeMap<String, Numbered>) {
    for (at, _) in aux.match_indices("\\newlabel{") {
        let found = groups(aux, at + "\\newlabel".len());
        let [key, data] = found.as_slice() else {
            continue;
        };
        // cleveref writes a second entry for each label, under key@cref.
        if key.contains('@') {
            continue;
        }
        let fields = groups(data, 0);
        let clean = |s: &str| s.replace("\\relax", "").trim().to_string();
        let kind = fields
            .get(3)
            .map(|anchor| anchor.split('.').next().unwrap_or("").to_lowercase())
            .filter(|k| k.chars().all(|c| c.is_ascii_alphabetic()) && k != "doc-start")
            .unwrap_or_default();
        out.insert(
            key.clone(),
            Numbered {
                number: fields.first().map(|s| clean(s)).unwrap_or_default(),
                page: fields.get(1).map(|s| clean(s)).unwrap_or_default(),
                kind,
            },
        );
    }
}

/// The label numbers of the last compile: every `.aux` file it wrote, the included files' too.
fn compiled_numbers(project: &Project) -> BTreeMap<String, Numbered> {
    let mut out = BTreeMap::new();
    let mut folders = vec![(project.build_dir(), 0)];
    while let Some((dir, depth)) = folders.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() && depth < 4 {
                folders.push((path, depth + 1));
            } else if kind.is_file()
                && path.extension().is_some_and(|e| e == "aux")
                && entry.metadata().is_ok_and(|m| m.len() <= MAX_AUX)
                && let Ok(text) = fs::read_to_string(&path)
            {
                label_numbers(&text, &mut out);
            }
        }
    }
    out
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub key: String,
    /// How the authors are named in running text: "Knuth", "Lamport and Knuth", "Mittelbach et al.".
    pub authors: String,
    pub year: String,
    pub title: String,
}

/// The value of one field of a `.bib` entry, with its braces and quotes removed.
fn field(body: &str, start: &Regex) -> String {
    let Some(found) = start.find(body) else {
        return String::new();
    };
    let rest = &body[found.end()..];
    let mut out = String::new();
    let mut depth = 0i32;
    let mut quoted = false;
    for (i, c) in rest.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            '"' if depth == 0 => quoted = !quoted,
            ',' | '\n' if depth == 0 && !quoted => break,
            _ => out.push(c),
        }
        if depth < 0 || i > 2000 {
            break;
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// "Knuth, Donald E. and Leslie Lamport" becomes "Knuth and Lamport".
fn short_authors(raw: &str) -> String {
    let surname = |person: &str| -> String {
        let person = person.trim();
        match person.split_once(',') {
            Some((last, _)) => last.trim().to_string(),
            None => person.rsplit(' ').next().unwrap_or(person).to_string(),
        }
    };
    let people: Vec<String> = AND
        .split(raw)
        .map(surname)
        .filter(|s| !s.is_empty())
        .collect();
    match people.as_slice() {
        [] => String::new(),
        [one] => one.clone(),
        [a, b] => format!("{a} and {b}"),
        [first, ..] => format!("{first} et al."),
    }
}

fn citations(text: &str, out: &mut BTreeMap<String, Citation>) {
    let starts: Vec<(usize, usize, String, String)> = ENTRY
        .captures_iter(text)
        .map(|c| {
            let all = c.get(0).unwrap();
            (
                all.start(),
                all.end(),
                c[1].to_lowercase(),
                c[2].to_string(),
            )
        })
        .collect();
    for (i, (_, body_start, kind, key)) in starts.iter().enumerate() {
        if matches!(kind.as_str(), "comment" | "string" | "preamble") {
            continue;
        }
        let body_end = starts.get(i + 1).map_or(text.len(), |next| next.0);
        let body = &text[*body_start..body_end];
        let authors = match field(body, &AUTHOR) {
            a if a.is_empty() => field(body, &EDITOR),
            a => a,
        };
        let year = match field(body, &YEAR) {
            y if y.is_empty() => field(body, &DATE).chars().take(4).collect(),
            y => y,
        };
        out.insert(
            key.clone(),
            Citation {
                key: key.clone(),
                authors: short_authors(&authors),
                year,
                title: field(body, &TITLE),
            },
        );
    }
}

/// Whether a name a document gives for a file points at another computer or a device: a
/// network share (`//host/share`, `\\host\share`) or a Windows device or verbatim path. Only
/// looking such a name up can make Windows contact the computer and offer it the user's
/// credentials, so a project someone sent must never get the app to do that.
fn names_another_computer(name: &str) -> bool {
    let unc = |s: &str| {
        s.starts_with("//") || s.starts_with("\\\\") || s.starts_with("/\\") || s.starts_with("\\/")
    };
    unc(name)
        || Path::new(name)
            .components()
            .any(|c| matches!(c, Component::Prefix(p) if !matches!(p.kind(), Prefix::Disk(_))))
}

/// The largest `.bib` file outside the project that is read for its references.
const MAX_OUTSIDE_BIB: u64 = 8 << 20;

/// The packages a piece of LaTeX loads with `\usepackage` or `\RequirePackage`, comments left out.
fn loaded_packages(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = uncomment(line);
        for c in USES.captures_iter(line) {
            out.extend(
                c[1].split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty()),
            );
        }
    }
    out
}

/// A line without its comment.
fn uncomment(line: &str) -> &str {
    let mut escaped = false;
    for (i, ch) in line.char_indices() {
        if ch == '%' && !escaped {
            return &line[..i];
        }
        escaped = ch == '\\' && !escaped;
    }
    line
}

pub fn build(project: &Project) -> Result<ProjectIndex> {
    let (mut labels, mut keys) = (BTreeSet::new(), BTreeSet::new());
    let mut found = BTreeMap::new();
    let mut style_packages = BTreeMap::new();
    let mut named_bibs = BTreeSet::new();
    let mut inside_bibs = BTreeSet::new();
    let mut document_class = String::new();
    for (rel, path) in project.walk_files()? {
        let is_tex = rel.ends_with(".tex");
        let is_style = rel.ends_with(".sty") || rel.ends_with(".cls");
        if !is_tex && !is_style && !rel.ends_with(".bib") {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let Some(text) = as_text(&bytes) else {
            continue;
        };
        if is_tex {
            if rel == project.info.main_file
                && let Some(c) = text.lines().map(uncomment).find_map(|l| CLASS.captures(l))
            {
                document_class = c[1].to_string();
            }
            labels.extend(LABEL.captures_iter(text).map(|c| c[1].to_string()));
            keys.extend(BIB_ITEM.captures_iter(text).map(|c| c[1].to_string()));
            for line in text.lines() {
                for c in BIB_NAMED.captures_iter(uncomment(line)) {
                    named_bibs.extend(
                        c[1].split(',')
                            .map(|b| b.trim().to_string())
                            .filter(|b| !b.is_empty()),
                    );
                }
            }
        } else if is_style {
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            style_packages.insert(name, loaded_packages(text));
        } else {
            inside_bibs.insert(path.clone());
            citations(text, &mut found);
        }
    }
    // A .bib file the document names but that is kept outside the project, such as a shared
    // bibliography: read for its references only, never written.
    let base = project
        .resolve(&project.info.main_file)
        .ok()
        .and_then(|main| main.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| project.root.clone());
    for name in named_bibs {
        if names_another_computer(&name) {
            continue;
        }
        let with_ext = if name.to_ascii_lowercase().ends_with(".bib") {
            name.clone()
        } else {
            format!("{name}.bib")
        };
        let path = base.join(&with_ext);
        let Ok(real) = fs::canonicalize(&path) else {
            continue;
        };
        if inside_bibs
            .iter()
            .any(|p| fs::canonicalize(p).is_ok_and(|q| q == real))
        {
            continue;
        }
        if !fs::metadata(&real).is_ok_and(|m| m.is_file() && m.len() <= MAX_OUTSIDE_BIB) {
            continue;
        }
        let Ok(bytes) = fs::read(&real) else { continue };
        if let Some(text) = as_text(&bytes) {
            citations(text, &mut found);
        }
    }
    keys.extend(found.keys().cloned());
    Ok(ProjectIndex {
        labels: labels.into_iter().collect(),
        cite_keys: keys.into_iter().collect(),
        citations: found.into_values().collect(),
        style_packages,
        label_numbers: compiled_numbers(project),
        document_class,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_labels_and_citation_keys_across_files() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        p.write_file(
            "sections/proof.tex",
            r"\begin{equation}\label{eq:polar}\end{equation} \label{sec:proof} \bibitem{byhand}",
        )
        .unwrap();
        p.write_file(
            "refs.bib",
            "@book{knuth84,\n title={The TeXbook}}\n@article{ lamport94 ,\n}\n",
        )
        .unwrap();
        let index = build(&p).unwrap();
        assert_eq!(index.labels, ["eq:polar", "sec:proof"]);
        assert_eq!(index.cite_keys, ["byhand", "knuth84", "lamport94"]);
    }

    #[test]
    fn style_files_of_the_projects_own_are_read_for_the_packages_they_load() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        p.write_file(
            "mystyle.sty",
            "\\RequirePackage[T1]{fontenc}\n\\RequirePackage{newtxmath, xcolor}\n% \\RequirePackage{amssymb}\n",
        )
        .unwrap();
        let index = build(&p).unwrap();
        assert_eq!(
            index.style_packages.get("mystyle").unwrap(),
            &vec!["fontenc".to_string(), "newtxmath".into(), "xcolor".into()]
        );
    }

    #[test]
    fn a_bib_file_named_outside_the_project_is_read_for_its_references() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        fs::write(
            tmp.path().join("shared.bib"),
            "@book{knuth84, author={Knuth, Donald}, year={1984}, title={The TeXbook}}\n",
        )
        .unwrap();
        p.write_file("main.tex", "\\documentclass{article}\n\\begin{document}\n\\bibliography{../shared}\n\\end{document}\n")
            .unwrap();
        let index = build(&p).unwrap();
        assert_eq!(index.cite_keys, ["knuth84"]);
        assert_eq!(index.citations[0].authors, "Knuth");
        // Only .bib files, and only those the document names.
        fs::write(tmp.path().join("secret.txt"), "@book{leak, title={x}}").unwrap();
        p.write_file("main.tex", "\\bibliography{../secret.txt}\n")
            .unwrap();
        assert!(build(&p).unwrap().cite_keys.is_empty());
    }

    #[test]
    fn labels_are_numbered_as_the_last_compile_numbered_them() {
        let mut found = BTreeMap::new();
        label_numbers(
            concat!(
                "\\relax\n",
                "\\newlabel{sec:intro}{{1}{1}{Introduction}{section.1}{}}\n",
                "\\newlabel{fig:x}{{2.1}{4}{A {\\em nested} caption}{figure.caption.3}{}}\n",
                "\\newlabel{eq:y}{{\\relax 3}{5}}\n",
                "\\newlabel{fig:x@cref}{{[figure][1][2]2.1}{[1][4][]4}}\n",
                "\\newlabel{broken}{{9}\n",
            ),
            &mut found,
        );
        let get = |k: &str| found.get(k).cloned().unwrap_or_default();
        assert_eq!(
            get("sec:intro"),
            Numbered {
                number: "1".into(),
                page: "1".into(),
                kind: "section".into()
            }
        );
        assert_eq!(
            get("fig:x"),
            Numbered {
                number: "2.1".into(),
                page: "4".into(),
                kind: "figure".into()
            }
        );
        assert_eq!(
            get("eq:y"),
            Numbered {
                number: "3".into(),
                page: "5".into(),
                kind: String::new()
            }
        );
        assert!(!found.contains_key("fig:x@cref") && !found.contains_key("broken"));
        // Read from every .aux file the compile wrote, an included file's in a subfolder too.
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        fs::create_dir_all(p.build_dir().join("chapters")).unwrap();
        fs::write(p.build_dir().join("main.aux"), "\\newlabel{a}{{1}{1}}\n").unwrap();
        fs::write(
            p.build_dir().join("chapters/one.aux"),
            "\\newlabel{b}{{2}{3}}\n",
        )
        .unwrap();
        let index = build(&p).unwrap();
        assert_eq!(index.label_numbers.keys().collect::<Vec<_>>(), ["a", "b"]);
        // The main file's class, read past a comment and options.
        assert_eq!(index.document_class, "article");
        p.write_file(
            "main.tex",
            "% \\documentclass{book}\n\\documentclass[12pt, a4paper]{ report }\n",
        )
        .unwrap();
        assert_eq!(build(&p).unwrap().document_class, "report");
    }

    #[test]
    fn a_bib_file_on_another_computer_is_never_looked_up() {
        for name in [
            "//host/share/refs",
            "\\\\host\\share\\refs",
            "/\\host/share/refs",
            "\\\\?\\UNC\\host\\share\\refs",
            "\\\\?\\C:\\refs",
            "\\\\.\\pipe\\refs",
        ] {
            assert!(names_another_computer(name), "{name}");
        }
        for name in [
            "refs",
            "../shared",
            "C:/bib/refs",
            "/home/me/refs",
            "C:\\bib\\refs",
        ] {
            assert!(!names_another_computer(name), "{name}");
        }
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        p.write_file("main.tex", "\\bibliography{//host.invalid/share/refs}\n")
            .unwrap();
        assert!(build(&p).unwrap().cite_keys.is_empty());
        // Nor through a main file named on another computer, which the names are read from.
        p.write_file("main.tex", "\\bibliography{refs}\n").unwrap();
        let mut odd = p.clone();
        odd.info.main_file = "//host.invalid/share/main.tex".into();
        odd.save_info().unwrap();
        let opened = Project::open(&p.root).unwrap();
        assert_eq!(opened.info.main_file, "main.tex");
        odd.info.main_file = "//host.invalid/share/main.tex".into();
        assert!(build(&odd).unwrap().cite_keys.is_empty());
    }

    #[test]
    fn references_are_read_well_enough_to_show_them_by_name() {
        let mut found = BTreeMap::new();
        citations(
            concat!(
                "@string{tug = \"TUGboat\"}\n",
                "@book{knuth84,\n  author = {Knuth, Donald E.},\n  title = {The {\\TeX}book},\n  year = 1984,\n}\n",
                "@article{two,\n  AUTHOR = \"Leslie Lamport and Donald Knuth\",\n  title = \"A, B\n     and C\",\n  year = {1994}\n}\n",
                "@inproceedings{many, author={Frank Mittelbach and Michel Goossens and Johannes Braams}, date={2004-05-01}}\n",
                "@misc{bare,\n  howpublished = {none}\n}\n",
            ),
            &mut found,
        );
        let get = |k: &str| found[k].clone();
        assert_eq!(found.len(), 4);
        assert_eq!(
            (
                get("knuth84").authors.as_str(),
                get("knuth84").year.as_str()
            ),
            ("Knuth", "1984")
        );
        assert_eq!(get("knuth84").title, "The \\TeXbook");
        assert_eq!(get("two").authors, "Lamport and Knuth");
        assert_eq!(get("two").title, "A, B and C");
        assert_eq!(get("many").authors, "Mittelbach et al.");
        assert_eq!(get("many").year, "2004");
        assert_eq!(get("bare").authors, "");
    }
}
