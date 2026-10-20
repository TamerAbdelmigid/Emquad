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
    /// Each label with the file and line it is written on, what it is on and its caption.
    pub label_places: Vec<LabelPlace>,
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
    /// What `\nameref` prints: the title of what is numbered, when the compile said (with
    /// hyperref); empty otherwise.
    pub title: String,
    /// What is numbered, when the compile said (with hyperref): "section", "figure", "table",
    /// "equation"; empty otherwise.
    pub kind: String,
}

/// A label written in the project, with what it names, as a cross-reference picker lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LabelPlace {
    pub key: String,
    /// The file it is written in, relative to the project.
    pub file: String,
    /// 1-based line of the `\label`.
    pub line: u32,
    /// "part", "chapter", "section", "figure", "table", "equation" or "item"; "" when the label
    /// is on nothing the app knows.
    pub kind: String,
    /// The caption, or the heading's title, as it prints; "" when there is none.
    pub caption: String,
}

pattern!(
    TOKEN,
    r"\\(begin|end)\s*\{([^}]+)\}|\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{|\\caption(?:of)?(?:[^a-zA-Z]|$)|\\label\s*\{([^}]+)\}"
);
pattern!(ESCAPED, r"\\([&%$#_{}])");
pattern!(COMMAND, r"\\[a-zA-Z]+\*?(?:\[[^\]]*\])?");

/// Text as it prints, its commands and braces taken out.
fn printed(tex: &str) -> String {
    let unescaped = ESCAPED.replace_all(tex, "\u{0}$1");
    let bare = COMMAND.replace_all(&unescaped, "");
    let mut out = String::new();
    let mut escaped = false;
    for ch in bare.chars() {
        match ch {
            '\u{0}' => escaped = true,
            '{' | '}' | '$' if !escaped => {}
            '~' => out.push(' '),
            _ => {
                out.push(ch);
                escaped = false;
            }
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Environments a label numbers as an equation.
const EQUATIONS: &[&str] = &[
    "equation", "align", "gather", "multline", "eqnarray", "flalign", "alignat",
];
const FIGURES: &[&str] = &[
    "figure",
    "wrapfigure",
    "subfigure",
    "sidewaysfigure",
    "SCfigure",
];
const TABLES: &[&str] = &[
    "table",
    "longtable",
    "sidewaystable",
    "wraptable",
    "SCtable",
];
/// Environments that number nothing of their own: a label in them names what is around them.
const TRANSPARENT: &[&str] = &[
    "document",
    "center",
    "flushleft",
    "flushright",
    "minipage",
    "itemize",
    "description",
    "quote",
    "quotation",
    "multicols",
    "abstract",
    "small",
    "footnotesize",
];

/// The argument of a `\caption` that ends at `after`: past a short form in brackets.
fn caption_at(code: &str, after: usize) -> String {
    let bytes = code.as_bytes();
    let mut i = after;
    let blank = |i: &mut usize| {
        while *i < bytes.len() && bytes[*i].is_ascii_whitespace() {
            *i += 1;
        }
    };
    blank(&mut i);
    if bytes.get(i) == Some(&b'[')
        && let Some(j) = code[i..].find(']')
    {
        i += j + 1;
    }
    blank(&mut i);
    if bytes.get(i) == Some(&b'{') {
        groups(code, i)
            .first()
            .map(|a| printed(a))
            .unwrap_or_default()
    } else {
        String::new()
    }
}

/// An environment open where a label is read, and the caption read in it so far: what it numbers
/// ("figure" or "table") and its words.
struct Open {
    name: String,
    caption: Option<(String, String)>,
}

/// Every `\label` in `text`, with the kind of thing it is on and its caption or heading, read in
/// one pass: as LaTeX numbers it, a label names the figure or table whose caption (or
/// `\captionof`) comes before it, the equation or numbered item it is in, or else the last
/// heading; in another environment of its own (a theorem, say), nothing the app knows.
pub fn label_places(file: &str, text: &str) -> Vec<LabelPlace> {
    // Comments blanked out, every offset kept.
    let code: String = text
        .split('\n')
        .map(|l| {
            let kept = uncomment(l);
            format!("{kept}{}", " ".repeat(l.len() - kept.len()))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let mut out = Vec::new();
    // The text itself, as the outermost "environment", holds a \captionof written outside any.
    let mut open: Vec<Open> = vec![Open {
        name: String::new(),
        caption: None,
    }];
    let mut heading: Option<(String, String)> = None;
    let (mut line, mut counted) = (1u32, 0usize);
    for t in TOKEN.captures_iter(&code) {
        let whole = t.get(0).unwrap();
        if let Some(which) = t.get(1) {
            let name = t[2].trim().trim_end_matches('*').to_string();
            if which.as_str() == "begin" {
                open.push(Open {
                    name,
                    caption: None,
                });
            } else if let Some(i) = open.iter().rposition(|o| o.name == name)
                && i > 0
            {
                open.truncate(i);
            }
        } else if let Some(command) = t.get(3) {
            let kind = match command.as_str() {
                "subsection" | "subsubsection" | "paragraph" => "section",
                other => other,
            };
            let title = groups(&code, whole.end() - 1)
                .first()
                .map(|a| printed(a))
                .unwrap_or_default();
            heading = Some((kind.to_string(), title));
            open[0].caption = None;
        } else if let Some(key) = t.get(4) {
            line += code[counted..whole.start()].matches('\n').count() as u32;
            counted = whole.start();
            // From the innermost environment out: the first with a caption names the label, else
            // the first that numbers something of its own.
            let mut found: Option<(String, String)> = None;
            for o in open.iter().rev() {
                let name = o.name.as_str();
                if let Some(c) = &o.caption {
                    found = Some(c.clone());
                } else if EQUATIONS.contains(&name) {
                    found = Some(("equation".into(), String::new()));
                } else if name == "enumerate" {
                    found = Some(("item".into(), String::new()));
                } else if name.is_empty() || TRANSPARENT.contains(&name) {
                    continue;
                } else if !FIGURES.contains(&name) && !TABLES.contains(&name) {
                    found = Some((String::new(), String::new()));
                }
                // A figure or table whose caption is still to come numbers nothing yet.
                break;
            }
            let (kind, caption) = found.or_else(|| heading.clone()).unwrap_or_default();
            out.push(LabelPlace {
                key: key.as_str().trim().to_string(),
                file: file.to_string(),
                line,
                kind,
                caption,
            });
        } else {
            // A caption: of the innermost figure or table; \captionof{kind}{…} of the
            // environment it is in, whatever that is.
            let of = whole.as_str().starts_with("\\captionof");
            let mut after = whole.start()
                + whole
                    .as_str()
                    .trim_end_matches(|c: char| !c.is_ascii_alphabetic())
                    .len();
            let mut kind = String::new();
            if of {
                let rest = code[after..].trim_start();
                let brace = after + (code[after..].len() - rest.len());
                if let Some(k) = groups(&code, brace).first() {
                    kind = k.trim().trim_end_matches('*').to_string();
                    after = brace + k.len() + 2;
                }
            }
            let words = caption_at(&code, after);
            if of {
                let kind = if TABLES.contains(&kind.as_str()) {
                    "table"
                } else {
                    "figure"
                };
                if let Some(o) = open.last_mut() {
                    o.caption = Some((kind.into(), words));
                }
            } else if let Some(o) = open
                .iter_mut()
                .rev()
                .find(|o| FIGURES.contains(&o.name.as_str()) || TABLES.contains(&o.name.as_str()))
            {
                let kind = if TABLES.contains(&o.name.as_str()) {
                    "table"
                } else {
                    "figure"
                };
                o.caption = Some((kind.into(), words));
            }
        }
    }
    out
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
    // Each entry is one line, and is read within it: a group never closed cannot make reading
    // one entry run through the rest of the file.
    for line in aux.lines() {
        let Some(at) = line.find("\\newlabel{") else {
            continue;
        };
        let found = groups(line, at + "\\newlabel".len());
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
                title: fields.get(2).map(|s| clean(s)).unwrap_or_default(),
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
    let mut places = Vec::new();
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
            places.extend(label_places(&rel, text));
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
        label_places: places,
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
    fn each_label_is_named_by_what_it_is_on_and_its_caption_or_heading() {
        let text = "\\section{Methods \\& data}\\label{sec:m}\n\
            Text.\n\
            \\begin{figure}[h]\n  \\centering\n  \\includegraphics{a}\n  \\caption{The \\textbf{map} of wells}\n  \\label{fig:map}\n\\end{figure}\n\
            \\begin{table}\n  \\label{tab:x}\n  \\caption[Short]{Rainfall by year}\n\\end{table}\n\
            \\begin{equation}\n  E = mc^2 \\label{eq:e}\n\\end{equation}\n\
            \\subsection{Wells}\n\\label{sec:w}\n\
            \\begin{enumerate}\\item First\\label{it:one}\\end{enumerate}\n\
            % \\label{commented}\n\
            Plain \\label{loose}\n";
        let places = label_places("main.tex", text);
        let seen: Vec<(&str, &str, &str, u32)> = places
            .iter()
            .map(|p| (p.key.as_str(), p.kind.as_str(), p.caption.as_str(), p.line))
            .collect();
        assert_eq!(
            seen,
            [
                ("sec:m", "section", "Methods & data", 1),
                ("fig:map", "figure", "The map of wells", 7),
                // Written before its caption, it takes the section's number, as LaTeX gives it.
                ("tab:x", "section", "Methods & data", 10),
                ("eq:e", "equation", "", 14),
                ("sec:w", "section", "Wells", 17),
                ("it:one", "item", "", 18),
                ("loose", "section", "Wells", 20),
            ]
        );
        assert!(places.iter().all(|p| p.file == "main.tex"));
    }

    #[test]
    fn labels_in_other_environments_are_not_taken_for_headings_and_captions_are_read_exactly() {
        let text = "\\section{One}\n\
            \\begin{theorem}\\label{thm:a}\\end{theorem}\n\
            \\begin{table*}\\captionsetup{x}\\caption{Wide}\\label{tab:w}\\begin{tablenotes}n\\end{tablenotes}\\end{table*}\n\
            \\begin{wrapfigure}{r}{3cm}\\caption{Small}\\label{fig:s}\\end{wrapfigure}\n\
            \\begin{center}\\label{sec:c}\\end{center}\n\
            \\begin{minipage}{5cm}\\captionof{figure}{Map}\\label{fig:m}\\end{minipage}\n\
            \\begin{figure}\\captionof{table}{Odd}\\label{tab:o}\\end{figure}\n";
        let seen: Vec<(String, String, String)> = label_places("a.tex", text)
            .into_iter()
            .map(|p| (p.key, p.kind, p.caption))
            .collect();
        let s = |a: &str, b: &str, c: &str| (a.to_string(), b.to_string(), c.to_string());
        assert_eq!(
            seen,
            [
                s("thm:a", "", ""),
                s("tab:w", "table", "Wide"),
                s("fig:s", "figure", "Small"),
                s("sec:c", "section", "One"),
                s("fig:m", "figure", "Map"),
                s("tab:o", "table", "Odd"),
            ]
        );
    }

    #[test]
    fn the_index_lists_every_label_with_its_place() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Project::create(&tmp.path().join("p"), "p", "article").unwrap();
        p.write_file("sections/a.tex", "\\chapter{One}\\label{ch:one}\n")
            .unwrap();
        let index = build(&p).unwrap();
        let place = index
            .label_places
            .iter()
            .find(|l| l.key == "ch:one")
            .unwrap();
        assert_eq!(
            (
                place.file.as_str(),
                place.kind.as_str(),
                place.caption.as_str()
            ),
            ("sections/a.tex", "chapter", "One")
        );
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
                title: "Introduction".into(),
                kind: "section".into()
            }
        );
        assert_eq!(
            get("fig:x"),
            Numbered {
                number: "2.1".into(),
                page: "4".into(),
                title: "A {\\em nested} caption".into(),
                kind: "figure".into()
            }
        );
        assert_eq!(
            get("eq:y"),
            Numbered {
                number: "3".into(),
                page: "5".into(),
                title: String::new(),
                kind: String::new()
            }
        );
        assert!(!found.contains_key("fig:x@cref") && !found.contains_key("broken"));
        // A group never closed, in a large file, is read within its own line, and quickly.
        let crafted = "\\newlabel{x}{{1}{2}\n".repeat(50_000);
        let started = std::time::Instant::now();
        label_numbers(&crafted, &mut BTreeMap::new());
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );
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
