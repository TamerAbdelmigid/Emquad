//! What the editor needs to know about a project as a whole: its labels, its citation keys,
//! and enough about each reference to show it by name.

use crate::error::Result;
use crate::project::{Project, as_text};
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectIndex {
    pub labels: Vec<String>,
    pub cite_keys: Vec<String>,
    /// The references found in the project's `.bib` files.
    pub citations: Vec<Citation>,
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
fn field(body: &str, name: &str) -> String {
    let Ok(start) = Regex::new(&format!(r"(?i)(?:^|[,\s]){name}\s*=\s*")) else {
        return String::new();
    };
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
    let people: Vec<String> = Regex::new(r"(?i)\s+and\s+")
        .unwrap()
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
    let entry = Regex::new(r"(?m)^\s*@(\w+)\s*\{\s*([^,\s}]+)\s*,").unwrap();
    let starts: Vec<(usize, usize, String, String)> = entry
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
        let authors = match field(body, "author") {
            a if a.is_empty() => field(body, "editor"),
            a => a,
        };
        let year = match field(body, "year") {
            y if y.is_empty() => field(body, "date").chars().take(4).collect(),
            y => y,
        };
        out.insert(
            key.clone(),
            Citation {
                key: key.clone(),
                authors: short_authors(&authors),
                year,
                title: field(body, "title"),
            },
        );
    }
}

pub fn build(project: &Project) -> Result<ProjectIndex> {
    let label = Regex::new(r"\\label\{([^}]+)\}").unwrap();
    let bib_item = Regex::new(r"\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}").unwrap();
    let (mut labels, mut keys) = (BTreeSet::new(), BTreeSet::new());
    let mut found = BTreeMap::new();
    for (rel, path) in project.walk_files()? {
        let is_tex = rel.ends_with(".tex");
        if !is_tex && !rel.ends_with(".bib") {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let Some(text) = as_text(&bytes) else {
            continue;
        };
        if is_tex {
            labels.extend(label.captures_iter(text).map(|c| c[1].to_string()));
            keys.extend(bib_item.captures_iter(text).map(|c| c[1].to_string()));
        } else {
            citations(text, &mut found);
        }
    }
    keys.extend(found.keys().cloned());
    Ok(ProjectIndex {
        labels: labels.into_iter().collect(),
        cite_keys: keys.into_iter().collect(),
        citations: found.into_values().collect(),
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
