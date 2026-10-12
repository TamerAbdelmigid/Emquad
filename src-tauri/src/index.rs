//! What completion needs to know about a project: its labels and citation keys.

use crate::error::Result;
use crate::project::{Project, as_text};
use regex::Regex;
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectIndex {
    pub labels: Vec<String>,
    pub cite_keys: Vec<String>,
}

pub fn build(project: &Project) -> Result<ProjectIndex> {
    let label = Regex::new(r"\\label\{([^}]+)\}").unwrap();
    let bib_entry = Regex::new(r"(?m)^\s*@\w+\s*\{\s*([^,\s}]+)\s*,").unwrap();
    let bib_item = Regex::new(r"\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}").unwrap();
    let (mut labels, mut keys) = (BTreeSet::new(), BTreeSet::new());
    for (rel, path) in project.walk_files()? {
        let is_tex = rel.ends_with(".tex");
        if !is_tex && !rel.ends_with(".bib") {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let Some(text) = as_text(&bytes) else { continue };
        if is_tex {
            labels.extend(label.captures_iter(text).map(|c| c[1].to_string()));
            keys.extend(bib_item.captures_iter(text).map(|c| c[1].to_string()));
        } else {
            keys.extend(bib_entry.captures_iter(text).map(|c| c[1].to_string()));
        }
    }
    Ok(ProjectIndex {
        labels: labels.into_iter().collect(),
        cite_keys: keys.into_iter().collect(),
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
            r"\begin{equation}\label{eq:polar}\end{equation} \label{sec:proof}",
        )
        .unwrap();
        p.write_file("refs.bib", "@book{knuth84,\n title={The TeXbook}}\n@article{ lamport94 ,\n}\n").unwrap();
        let index = build(&p).unwrap();
        assert_eq!(index.labels, ["eq:polar", "sec:proof"]);
        assert_eq!(index.cite_keys, ["knuth84", "lamport94"]);
    }
}
