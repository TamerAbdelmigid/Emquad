//! Reviewing an imported bundle: classify every difference, record the user's decisions, and
//! write the merged result. The rules and invariants are in docs/03-bundles-and-history.md.

use crate::diff::{Chunk, Class, Segment, diff3, word_segments};
use crate::error::{Error, Result};
use crate::history::{Author, History};
use crate::project::{Project, as_text, atomic_write, remove_file_retry};
use git2::Oid;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Decision {
    Mine,
    Theirs,
}

/// One file as it is in the common ancestor, in our version and in theirs. `None` means absent.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Triple {
    pub base: Option<Vec<u8>>,
    pub ours: Option<Vec<u8>>,
    pub theirs: Option<Vec<u8>>,
}

pub enum Plan {
    /// Text on all sides: decided hunk by hunk.
    Text(Vec<Chunk>),
    /// Decided as a whole file: binary content, or the file exists on only some sides.
    Whole(Class),
}

/// Decide how a file is reviewed. `None` means there is nothing to review: they did not change
/// it, or both sides ended up identical.
pub fn plan(t: &Triple) -> Option<Plan> {
    if t.ours == t.theirs || t.theirs == t.base {
        return None;
    }
    let text = |side: &Option<Vec<u8>>| side.as_deref().and_then(as_text).map(str::to_owned);
    let (ours, theirs) = (text(&t.ours), text(&t.theirs));
    let base = match &t.base {
        Some(_) => text(&t.base),
        None => Some(String::new()),
    };
    let only_they_changed = t.ours == t.base;
    match (base, ours, theirs) {
        // A file that exists on our side only as an empty ancestor is still a whole-file choice.
        (Some(b), Some(o), Some(th)) if t.base.is_some() || !only_they_changed => {
            Some(Plan::Text(diff3(&b, &o, &th)))
        }
        _ if only_they_changed => Some(Plan::Whole(Class::Theirs)),
        _ => Some(Plan::Whole(Class::Conflict)),
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReviewItem {
    pub id: String,
    pub path: String,
    /// "conflict" needs a decision; "auto" merged by itself and can still be rejected.
    pub kind: String,
    pub whole_file: bool,
    /// Line in our version where the passage starts; 0 for whole-file items.
    pub line: u32,
    /// Word-level comparison of our text ("delete" and "equal") with theirs ("insert" and "equal").
    pub segments: Vec<Segment>,
    /// Plain-language description for whole-file items.
    pub note: Option<String>,
    pub decision: Option<Decision>,
}

fn reviewable(class: Class) -> bool {
    matches!(class, Class::Theirs | Class::Conflict)
}

fn kind_of(class: Class) -> String {
    if class == Class::Conflict {
        "conflict"
    } else {
        "auto"
    }
    .into()
}

fn whole_file_note(t: &Triple, them: &str) -> String {
    match (&t.base, &t.ours, &t.theirs) {
        (None, None, Some(_)) => format!("{them} added this file"),
        (Some(_), Some(_), None) if t.ours == t.base => format!("{them} deleted this file"),
        (Some(_), Some(_), None) => format!("{them} deleted this file, and you edited it"),
        (Some(_), None, Some(_)) => format!("You deleted this file, and {them} edited it"),
        (None, Some(_), Some(_)) => format!("You and {them} both added this file"),
        _ if t.ours == t.base => format!("{them} replaced this file"),
        _ => format!("You and {them} both changed this file"),
    }
}

pub fn items(path: &str, t: &Triple, plan: &Plan, them: &str) -> Vec<ReviewItem> {
    match plan {
        Plan::Whole(class) => vec![ReviewItem {
            id: format!("{path}#file"),
            path: path.into(),
            kind: kind_of(*class),
            whole_file: true,
            line: 0,
            segments: Vec::new(),
            note: Some(whole_file_note(t, them)),
            decision: None,
        }],
        Plan::Text(chunks) => chunks
            .iter()
            .filter_map(|c| match c {
                Chunk::Change {
                    class,
                    ours,
                    theirs,
                    ours_line,
                    ..
                } if reviewable(*class) => Some((class, ours, theirs, ours_line)),
                _ => None,
            })
            .enumerate()
            .map(|(n, (class, ours, theirs, line))| ReviewItem {
                id: format!("{path}#{n}"),
                path: path.into(),
                kind: kind_of(*class),
                whole_file: false,
                line: *line,
                segments: word_segments(ours, theirs),
                note: None,
                decision: None,
            })
            .collect(),
    }
}

/// The merged content of one file under the given decisions. `None` means the file is absent.
/// A conflict without a decision is an error: nothing is ever chosen on the user's behalf.
pub fn resolve(
    path: &str,
    t: &Triple,
    plan: &Plan,
    decisions: &BTreeMap<String, Decision>,
) -> Result<Option<Vec<u8>>> {
    let decide = |id: String, class: Class| -> Result<Decision> {
        match (decisions.get(&id), class) {
            (Some(d), _) => Ok(*d),
            (None, Class::Theirs) => Ok(Decision::Theirs),
            _ => Err(Error::app(
                "unresolved",
                "Every conflict needs a decision before the merge can finish",
            )),
        }
    };
    match plan {
        Plan::Whole(class) => Ok(match decide(format!("{path}#file"), *class)? {
            Decision::Mine => t.ours.clone(),
            Decision::Theirs => t.theirs.clone(),
        }),
        Plan::Text(chunks) => {
            let mut out = String::new();
            let mut n = 0;
            for chunk in chunks {
                match chunk {
                    Chunk::Stable(s) => out.push_str(s),
                    Chunk::Change {
                        class,
                        ours,
                        theirs,
                        ..
                    } if reviewable(*class) => {
                        let decision = decide(format!("{path}#{n}"), *class)?;
                        n += 1;
                        out.push_str(if decision == Decision::Mine {
                            ours
                        } else {
                            theirs
                        });
                    }
                    Chunk::Change { ours, .. } => out.push_str(ours),
                }
            }
            Ok(Some(out.into_bytes()))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Session {
    bundle_id: String,
    ours: String,
    theirs: String,
    base: String,
    decisions: BTreeMap<String, Decision>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Review {
    pub bundle_id: String,
    /// Who sent the bundle.
    pub from: String,
    /// Label of the version both sides started from.
    pub base_label: String,
    pub items: Vec<ReviewItem>,
    pub unresolved: u32,
}

fn session_path(project: &Project, bundle_id: &str) -> std::path::PathBuf {
    project.incoming_dir(bundle_id).join("review.json")
}

fn load(project: &Project, bundle_id: &str) -> Result<Option<Session>> {
    match fs::read(session_path(project, bundle_id)) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(_) => Ok(None),
    }
}

fn save(project: &Project, session: &Session) -> Result<()> {
    atomic_write(
        &session_path(project, &session.bundle_id),
        &serde_json::to_vec_pretty(session)?,
    )
}

fn their_name(history: &History, theirs: Oid) -> Result<String> {
    Ok(history
        .repo
        .find_commit(theirs)?
        .author()
        .name()
        .unwrap_or("the sender")
        .to_string())
}

/// Begin reviewing an imported bundle, or pick up a review already in progress.
fn open_session(
    project: &Project,
    history: &History,
    me: &Author,
    bundle_id: &str,
) -> Result<Session> {
    if let Some(session) = load(project, bundle_id)? {
        return Ok(session);
    }
    let theirs = history.bundle_head(bundle_id)?;
    if let Some(head) = history.head()
        && history.is_ancestor(theirs, head)?
    {
        return Err(Error::app(
            "already_merged",
            "This bundle is already merged",
        ));
    }
    let from = their_name(history, theirs)?;
    let ours = history.snapshot(
        project,
        me,
        "automatic",
        &format!("Before import from {from}"),
    )?;
    let base = history.repo.merge_base(ours, theirs).map_err(|_| {
        Error::app(
            "no_common_history",
            "This bundle shares no history with your project",
        )
    })?;
    let session = Session {
        bundle_id: bundle_id.into(),
        ours: ours.to_string(),
        theirs: theirs.to_string(),
        base: base.to_string(),
        decisions: BTreeMap::new(),
    };
    save(project, &session)?;
    Ok(session)
}

fn planned(history: &History, session: &Session) -> Result<Vec<(String, Triple, Plan)>> {
    let files = |id: &str| -> Result<BTreeMap<String, Oid>> {
        history.files_in(history.repo.find_commit(Oid::from_str(id)?)?.tree_id())
    };
    let (base, ours, theirs) = (
        files(&session.base)?,
        files(&session.ours)?,
        files(&session.theirs)?,
    );
    let paths: BTreeSet<&String> = base
        .keys()
        .chain(ours.keys())
        .chain(theirs.keys())
        .collect();
    let mut out = Vec::new();
    for path in paths {
        if base.get(path) == theirs.get(path) || ours.get(path) == theirs.get(path) {
            continue;
        }
        let read = |m: &BTreeMap<String, Oid>| m.get(path).map(|id| history.blob(*id)).transpose();
        let triple = Triple {
            base: read(&base)?,
            ours: read(&ours)?,
            theirs: read(&theirs)?,
        };
        if let Some(plan) = plan(&triple) {
            out.push((path.clone(), triple, plan));
        }
    }
    Ok(out)
}

pub fn get(project: &Project, history: &History, me: &Author, bundle_id: &str) -> Result<Review> {
    let session = open_session(project, history, me, bundle_id)?;
    let theirs = Oid::from_str(&session.theirs)?;
    let from = their_name(history, theirs)?;
    let mut all = Vec::new();
    for (path, triple, plan) in planned(history, &session)? {
        for mut item in items(&path, &triple, &plan, &from) {
            item.decision = session.decisions.get(&item.id).copied();
            all.push(item);
        }
    }
    let unresolved = all
        .iter()
        .filter(|i| i.kind == "conflict" && i.decision.is_none())
        .count() as u32;
    let base_label = history
        .repo
        .find_commit(Oid::from_str(&session.base)?)?
        .summary()
        .ok()
        .flatten()
        .unwrap_or_default()
        .to_string();
    Ok(Review {
        bundle_id: bundle_id.into(),
        from,
        base_label,
        items: all,
        unresolved,
    })
}

pub fn decide(project: &Project, bundle_id: &str, item_id: &str, decision: Decision) -> Result<()> {
    let mut session = load(project, bundle_id)?.ok_or_else(|| {
        Error::app(
            "not_found",
            "There is no review in progress for that bundle",
        )
    })?;
    session.decisions.insert(item_id.into(), decision);
    save(project, &session)
}

/// Write the merged files and record the merge. Refuses if the working copy has changed since
/// the review began, because the merge was computed against the state captured then.
pub fn finish(project: &Project, history: &History, me: &Author, bundle_id: &str) -> Result<Oid> {
    let session = load(project, bundle_id)?.ok_or_else(|| {
        Error::app(
            "not_found",
            "There is no review in progress for that bundle",
        )
    })?;
    let (ours, theirs) = (
        Oid::from_str(&session.ours)?,
        Oid::from_str(&session.theirs)?,
    );
    if history.tree_of_dir(&project.root)? != history.repo.find_commit(ours)?.tree_id() {
        return Err(Error::app(
            "working_copy_changed",
            "Your files changed after this review started. Cancel the review and start it again.",
        ));
    }
    // Resolve everything before touching any file, so an unresolved conflict changes nothing.
    let mut changes = Vec::new();
    for (path, triple, plan) in planned(history, &session)? {
        let merged = resolve(&path, &triple, &plan, &session.decisions)?;
        if merged != triple.ours {
            changes.push((path, merged));
        }
    }
    // The files as they will be afterwards must all be nameable and able to sit side by side.
    let ours_tree = history.repo.find_commit(ours)?.tree_id();
    let mut after: BTreeSet<String> = history.files_in(ours_tree)?.into_keys().collect();
    for (path, merged) in &changes {
        if merged.is_some() {
            after.insert(path.clone());
        } else {
            after.remove(path);
        }
    }
    crate::history::check_paths(after.iter())?;

    // Removals first, so a file renamed only in its capitalisation is not removed after being
    // written under its new name on a filesystem that ignores case.
    let apply = || -> Result<()> {
        for (path, _) in changes.iter().filter(|(_, merged)| merged.is_none()) {
            remove_file_retry(&project.resolve(path)?)?;
        }
        for (path, merged) in &changes {
            if let Some(bytes) = merged {
                let target = project.resolve(path)?;
                if target.is_dir() {
                    fs::remove_dir(&target)?;
                }
                atomic_write(&target, bytes)?;
            }
        }
        Ok(())
    };
    if let Err(e) = apply() {
        // A merge is all or nothing: put every file back as it was when the review began.
        let put_back = history.checkout(project, ours_tree).is_ok();
        return Err(Error::app(
            "merge_failed",
            format!(
                "The merge could not be written ({e}). {}",
                if put_back {
                    "Your files were put back as they were, and the review is still open."
                } else {
                    "Some files may be partly merged: restore the version saved before the import from History."
                }
            ),
        ));
    }
    let from = their_name(history, theirs)?;
    let head = history.head().unwrap_or(ours);
    let merge = history.commit(
        history.tree_of_dir(&project.root)?,
        &[head, theirs],
        me,
        "merge",
        &format!("Merged bundle from {from}"),
        Some(bundle_id),
    )?;
    let _ = fs::remove_dir_all(project.incoming_dir(bundle_id));
    Ok(merge)
}

/// Abandon a review. The working copy was never touched, so there is nothing to undo.
pub fn cancel(project: &Project, bundle_id: &str) -> Result<()> {
    let dir = project.incoming_dir(bundle_id);
    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::{export, import_into, import_new};
    use crate::history::tests::{author, new_project, read_all};
    use proptest::prelude::*;
    use std::path::Path;

    fn triple(base: Option<&str>, ours: Option<&str>, theirs: Option<&str>) -> Triple {
        let b = |s: Option<&str>| s.map(|s| s.as_bytes().to_vec());
        Triple {
            base: b(base),
            ours: b(ours),
            theirs: b(theirs),
        }
    }

    fn kinds(t: &Triple) -> Vec<(String, bool)> {
        match plan(t) {
            None => Vec::new(),
            Some(p) => items("f.tex", t, &p, "Lina")
                .into_iter()
                .map(|i| (i.kind, i.whole_file))
                .collect(),
        }
    }

    fn merged(t: &Triple, decisions: &[(&str, Decision)]) -> Result<Option<String>> {
        let p = plan(t).expect("something to review");
        let d = decisions
            .iter()
            .map(|(id, d)| (id.to_string(), *d))
            .collect();
        Ok(resolve("f.tex", t, &p, &d)?.map(|b| String::from_utf8(b).unwrap()))
    }

    #[test]
    fn whole_file_cases() {
        let auto_file = vec![("auto".to_string(), true)];
        let conflict_file = vec![("conflict".to_string(), true)];
        // Nothing to review: they did not change it, or both ended identical.
        assert!(kinds(&triple(Some("a"), Some("b"), Some("a"))).is_empty());
        assert!(kinds(&triple(Some("a"), Some("b"), Some("b"))).is_empty());
        assert!(kinds(&triple(Some("a"), None, Some("a"))).is_empty());
        assert!(kinds(&triple(None, Some("x"), None)).is_empty());
        // They added a file.
        let added = triple(None, None, Some("new\n"));
        assert_eq!(kinds(&added), auto_file);
        assert_eq!(merged(&added, &[]).unwrap().as_deref(), Some("new\n"));
        assert_eq!(
            merged(&added, &[("f.tex#file", Decision::Mine)]).unwrap(),
            None
        );
        // They deleted a file we left alone.
        let deleted = triple(Some("a\n"), Some("a\n"), None);
        assert_eq!(kinds(&deleted), auto_file);
        assert_eq!(merged(&deleted, &[]).unwrap(), None);
        // Deleted on one side, edited on the other: always a decision.
        for t in [
            triple(Some("a\n"), Some("b\n"), None),
            triple(Some("a\n"), None, Some("b\n")),
        ] {
            assert_eq!(kinds(&t), conflict_file);
            assert_eq!(merged(&t, &[]).unwrap_err().code(), "unresolved");
            assert_eq!(
                merged(&t, &[("f.tex#file", Decision::Mine)])
                    .unwrap()
                    .map(String::into_bytes),
                t.ours
            );
            assert_eq!(
                merged(&t, &[("f.tex#file", Decision::Theirs)])
                    .unwrap()
                    .map(String::into_bytes),
                t.theirs
            );
        }
        // Binary changed on both sides: one whole-file decision.
        let bin = Triple {
            base: Some(vec![0, 1]),
            ours: Some(vec![0, 2]),
            theirs: Some(vec![0, 3]),
        };
        assert_eq!(kinds(&bin), conflict_file);
        // Both added the same path with different text: a conflict over the content.
        assert_eq!(
            kinds(&triple(None, Some("mine\n"), Some("theirs\n"))),
            vec![("conflict".to_string(), false)]
        );
    }

    #[test]
    fn hunks_are_decided_one_by_one() {
        let t = triple(
            Some("a\nb\nc\nd\ne\nf\ng\n"),
            Some("a\nb\nc\nd\ne\nf\nMINE\n"),
            Some("a\nTHEIRS1\nc\nd\ne\nf\nTHEIRS2\n"),
        );
        assert_eq!(
            kinds(&t),
            vec![("auto".to_string(), false), ("conflict".to_string(), false)]
        );
        assert_eq!(merged(&t, &[]).unwrap_err().code(), "unresolved");
        assert_eq!(
            merged(&t, &[("f.tex#1", Decision::Mine)]).unwrap().unwrap(),
            "a\nTHEIRS1\nc\nd\ne\nf\nMINE\n"
        );
        assert_eq!(
            merged(
                &t,
                &[("f.tex#0", Decision::Mine), ("f.tex#1", Decision::Theirs)]
            )
            .unwrap()
            .unwrap(),
            "a\nb\nc\nd\ne\nf\nTHEIRS2\n"
        );
    }

    fn edit(base: &[String], ops: Vec<(usize, u8, String)>) -> Vec<String> {
        let mut v = base.to_vec();
        for (at, kind, text) in ops {
            let at = if v.is_empty() { 0 } else { at % (v.len() + 1) };
            match kind % 3 {
                0 => v.insert(at, text),
                1 if at < v.len() => {
                    v.remove(at);
                }
                2 if at < v.len() => v[at] = text,
                _ => {}
            }
        }
        v
    }
    fn text(v: &[String]) -> String {
        v.iter().map(|l| format!("{l}\n")).collect()
    }

    proptest! {
        /// Invariants 1 and 4: with every decision "mine" the result is exactly ours, with every
        /// decision "theirs" on conflicts it is a text built only from ours and theirs, and
        /// leaving a conflict undecided is refused.
        #[test]
        fn decisions_fully_determine_the_result(
            b in prop::collection::vec("[a-e]{0,2}", 0..10),
            eo in prop::collection::vec((0usize..20, 0u8..3, "[m-p]{1,2}"), 0..4),
            et in prop::collection::vec((0usize..20, 0u8..3, "[v-z]{1,2}"), 0..4),
            picks in prop::collection::vec(any::<bool>(), 12),
        ) {
            let (ours, theirs) = (text(&edit(&b, eo)), text(&edit(&b, et)));
            let t = triple(Some(&text(&b)), Some(&ours), Some(&theirs));
            let Some(p) = plan(&t) else { return Ok(()); };
            let list = items("f.tex", &t, &p, "Lina");
            let all = |d: Decision| list.iter().map(|i| (i.id.clone(), d)).collect::<BTreeMap<_, _>>();

            let mine = resolve("f.tex", &t, &p, &all(Decision::Mine)).unwrap().unwrap();
            prop_assert_eq!(String::from_utf8(mine).unwrap(), ours.clone());
            let all_theirs = resolve("f.tex", &t, &p, &all(Decision::Theirs)).unwrap().unwrap();
            if !list.iter().any(|i| i.kind == "conflict") && ours == text(&b) {
                prop_assert_eq!(String::from_utf8(all_theirs).unwrap(), theirs.clone());
            }

            let has_conflict = list.iter().any(|i| i.kind == "conflict");
            prop_assert_eq!(resolve("f.tex", &t, &p, &BTreeMap::new()).is_err(), has_conflict);

            // Any mix of decisions yields only lines that exist in ours or theirs.
            let mixed: BTreeMap<_, _> = list.iter().zip(&picks)
                .map(|(i, m)| (i.id.clone(), if *m { Decision::Mine } else { Decision::Theirs }))
                .collect();
            let out = String::from_utf8(resolve("f.tex", &t, &p, &mixed).unwrap().unwrap()).unwrap();
            for line in out.lines() {
                prop_assert!(ours.lines().any(|l| l == line) || theirs.lines().any(|l| l == line));
            }
        }
    }

    /// Two folders standing in for two people: A exports, B imports as new and edits, A edits
    /// too, then A imports B's reply.
    struct Pair {
        _tmp: tempfile::TempDir,
        a: Project,
        ha: History,
        bundle_id: String,
    }

    fn hand_off(ours: &[(&str, Option<&str>)], theirs: &[(&str, Option<&str>)]) -> Pair {
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let me = author("Tamer");
        a.write_file("main.tex", "one\ntwo\nthree\nfour\nfive\nsix\nseven\n")
            .unwrap();
        a.write_file("refs.bib", "@book{a}\n").unwrap();
        a.write_file("old.tex", "old\n").unwrap();
        let out = tmp.path().join("out.emquad");
        export(&a, &ha, &me, &out, "", false).unwrap();

        let b = import_new(&out, &tmp.path().join("b")).unwrap();
        let hb = History::open(&b).unwrap();
        let apply = |p: &Project, edits: &[(&str, Option<&str>)]| {
            for (path, content) in edits {
                match content {
                    Some(c) => p.write_file(path, c).unwrap(),
                    None => p.delete(path).unwrap(),
                }
            }
        };
        apply(&b, theirs);
        let back = tmp.path().join("back.emquad");
        export(&b, &hb, &author("Lina"), &back, "", false).unwrap();
        apply(&a, ours);
        let bundle_id = import_into(&a, &ha, &back).unwrap().bundle_id;
        Pair {
            _tmp: tmp,
            a,
            ha,
            bundle_id,
        }
    }

    fn file(p: &Project, path: &str) -> String {
        fs::read_to_string(p.root.join(Path::new(path))).unwrap()
    }

    #[test]
    fn full_round_merges_what_was_chosen_and_keeps_both_histories() {
        let pair = hand_off(
            &[(
                "main.tex",
                Some("one\nTWO mine\nthree\nfour\nfive\nsix\nSEVEN mine\n"),
            )],
            &[
                (
                    "main.tex",
                    Some("one\ntwo\nthree\nFOUR theirs\nfive\nsix\nSEVEN theirs\n"),
                ),
                ("refs.bib", Some("@book{a}\n@book{b}\n")),
                ("new.tex", Some("added\n")),
                ("old.tex", None),
            ],
        );
        let (a, ha, id) = (&pair.a, &pair.ha, pair.bundle_id.as_str());
        let me = author("Tamer");
        let before = read_all(a);

        let review = get(a, ha, &me, id).unwrap();
        assert_eq!(review.from, "Lina");
        assert_eq!(review.unresolved, 1);
        let summary: Vec<_> = review
            .items
            .iter()
            .map(|i| (i.path.as_str(), i.kind.as_str(), i.line))
            .collect();
        assert_eq!(
            summary,
            [
                ("main.tex", "auto", 4),
                ("main.tex", "conflict", 7),
                ("new.tex", "auto", 0),
                ("old.tex", "auto", 0),
                ("refs.bib", "auto", 2),
            ]
        );
        assert_eq!(
            read_all(a),
            before,
            "starting a review must not touch files"
        );

        assert_eq!(finish(a, ha, &me, id).unwrap_err().code(), "unresolved");
        assert_eq!(read_all(a), before, "a refused finish must not touch files");

        decide(a, id, "main.tex#1", Decision::Theirs).unwrap();
        decide(a, id, "refs.bib#0", Decision::Mine).unwrap();
        // Decisions survive closing the app: they are read back from disk.
        let again = get(a, ha, &me, id).unwrap();
        assert_eq!(again.unresolved, 0);
        assert_eq!(again.items[4].decision, Some(Decision::Mine));

        let merge = finish(a, ha, &me, id).unwrap();
        assert_eq!(
            file(a, "main.tex"),
            "one\nTWO mine\nthree\nFOUR theirs\nfive\nsix\nSEVEN theirs\n"
        );
        assert_eq!(
            file(a, "refs.bib"),
            "@book{a}\n",
            "rejected change stays out"
        );
        assert_eq!(file(a, "new.tex"), "added\n");
        assert!(!a.root.join("old.tex").exists());

        let list = ha.list(a).unwrap();
        let top = &list.versions[0];
        assert_eq!(top.id, merge.to_string());
        assert_eq!((top.kind.as_str(), top.parents.len()), ("merge", 2));
        assert!(!list.dirty);
        assert!(list.versions.iter().all(|v| !v.pending));
        assert!(list.versions.iter().any(|v| v.author == "Lina"));
        assert!(!a.incoming_dir(id).exists());

        // Invariant 2: the state from before the merge can be restored byte for byte.
        let prior = list
            .versions
            .iter()
            .find(|v| v.label == "Before import from Lina")
            .unwrap();
        ha.restore(a, &me, &prior.id).unwrap();
        assert_eq!(read_all(a), before);
    }

    #[test]
    fn cancel_changes_nothing_and_the_review_can_start_again() {
        let pair = hand_off(
            &[("main.tex", Some("one\ntwo\nthree\nfour\nfive\nsix\nmine\n"))],
            &[(
                "main.tex",
                Some("one\ntwo\nthree\nfour\nfive\nsix\ntheirs\n"),
            )],
        );
        let (a, ha, id) = (&pair.a, &pair.ha, pair.bundle_id.as_str());
        let me = author("Tamer");
        let before = read_all(a);
        get(a, ha, &me, id).unwrap();
        decide(a, id, "main.tex#0", Decision::Theirs).unwrap();
        cancel(a, id).unwrap();
        assert_eq!(read_all(a), before);
        let fresh = get(a, ha, &me, id).unwrap();
        assert_eq!(fresh.items[0].decision, None);
    }

    #[test]
    fn finish_refuses_when_files_changed_during_the_review() {
        let pair = hand_off(&[], &[("main.tex", Some("changed by them\n"))]);
        let (a, ha, id) = (&pair.a, &pair.ha, pair.bundle_id.as_str());
        let me = author("Tamer");
        // We made no changes, so there is nothing to decide, but the panel still lists theirs.
        let review = get(a, ha, &me, id).unwrap();
        assert_eq!(review.unresolved, 0);
        assert!(review.items.iter().all(|i| i.kind == "auto"));

        a.write_file("main.tex", "typed during review\n").unwrap();
        assert_eq!(
            finish(a, ha, &me, id).unwrap_err().code(),
            "working_copy_changed"
        );
        assert_eq!(file(a, "main.tex"), "typed during review\n");
    }

    #[cfg(windows)]
    #[test]
    fn a_rename_that_only_changes_capitals_keeps_exactly_one_file() {
        let pair = hand_off(
            &[],
            &[("old.tex", None), ("Old.tex", Some("renamed by them"))],
        );
        let (a, ha, id) = (&pair.a, &pair.ha, pair.bundle_id.as_str());
        let me = author("Tamer");
        get(a, ha, &me, id).unwrap();
        finish(a, ha, &me, id).unwrap();
        let names: Vec<String> = fs::read_dir(&a.root)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.to_lowercase() == "old.tex")
            .collect();
        assert_eq!(names, ["Old.tex"]);
        assert_eq!(file(a, "Old.tex"), "renamed by them");
    }

    #[cfg(windows)]
    #[test]
    fn keeping_an_edited_file_whose_capitals_they_changed_is_never_overwritten() {
        let pair = hand_off(
            &[("old.tex", Some("my edit"))],
            &[("old.tex", None), ("Old.tex", Some("theirs"))],
        );
        let (a, ha, id) = (&pair.a, &pair.ha, pair.bundle_id.as_str());
        let me = author("Tamer");
        let before = read_all(a);
        get(a, ha, &me, id).unwrap();
        // Keep our edited file. Their copy under the other capitalisation is still accepted by
        // default, and the two cannot both exist here: the merge must refuse, not overwrite.
        decide(a, id, "old.tex#file", Decision::Mine).unwrap();
        assert_eq!(finish(a, ha, &me, id).unwrap_err().code(), "case_collision");
        assert_eq!(read_all(a), before);
        decide(a, id, "Old.tex#file", Decision::Mine).unwrap();
        finish(a, ha, &me, id).unwrap();
        assert_eq!(file(a, "old.tex"), "my edit");
    }

    #[cfg(windows)]
    #[test]
    fn a_merge_that_cannot_be_written_in_full_changes_nothing_and_can_be_retried() {
        let pair = hand_off(
            &[],
            &[
                ("main.tex", Some("their main")),
                ("refs.bib", Some("their refs")),
            ],
        );
        let (a, ha, id) = (&pair.a, &pair.ha, pair.bundle_id.as_str());
        let me = author("Tamer");
        get(a, ha, &me, id).unwrap();
        let before = read_all(a);
        // refs.bib cannot be replaced while it is read-only; main.tex is written before it.
        let blocked = a.root.join("refs.bib");
        let mut perms = fs::metadata(&blocked).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&blocked, perms.clone()).unwrap();
        let outcome = finish(a, ha, &me, id);
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        fs::set_permissions(&blocked, perms).unwrap();
        assert_eq!(outcome.unwrap_err().code(), "merge_failed");
        assert_eq!(
            read_all(a),
            before,
            "a failed merge leaves no file half merged"
        );

        finish(a, ha, &me, id).unwrap();
        assert_eq!(file(a, "main.tex"), "their main");
        assert_eq!(file(a, "refs.bib"), "their refs");
    }

    #[test]
    fn unrelated_history_with_the_same_identity_is_not_merged() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, ha) = new_project(&tmp.path().join("a"));
        let me = author("Tamer");
        ha.snapshot(&a, &me, "snapshot", "Draft 1").unwrap();
        // A folder that claims the same project identity but was never derived from A.
        let dir = tmp.path().join("impostor");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("main.tex"), "unrelated\n").unwrap();
        let c = Project::adopt(&dir, "paper", Some(a.info.clone())).unwrap();
        let hc = History::open(&c).unwrap();
        let file = tmp.path().join("c.emquad");
        export(&c, &hc, &author("Lina"), &file, "", false).unwrap();

        let before = read_all(&a);
        assert_eq!(
            import_into(&a, &ha, &file).unwrap_err().code(),
            "no_common_history"
        );
        assert_eq!(read_all(&a), before);
        assert!(ha.list(&a).unwrap().versions.iter().all(|v| !v.pending));
    }
}
