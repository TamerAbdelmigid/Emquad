//! Comments on passages of a project's files. See docs/03-bundles-and-history.md.
//!
//! Comments live in `.emquad/comments.json`, never in the files they are about. Each one
//! remembers the words it was made on and a little of what surrounds them, which is how it is
//! found again after the text around it moves. They travel in bundles, and two people's
//! comments are combined without either side losing anything.

use crate::error::{Error, Result};
use crate::history::Author;
use crate::project::{Project, atomic_write, clean_rel};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::sync::Mutex;
use ts_rs::TS;

/// Comments are read, changed and written back as one step; this keeps two commands from
/// interleaving and one of them writing over the other's change.
static LOCK: Mutex<()> = Mutex::new(());

const FILE: &str = "comments.json";
/// Ceilings for comments that arrive in a bundle.
pub const MAX_BYTES: u64 = 4 << 20;
const MAX_COMMENTS: usize = 5000;
const MAX_REPLIES: usize = 500;
const MAX_TEXT: usize = 20_000;
const MAX_QUOTE: usize = 2000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Comment {
    pub id: String,
    /// The file the comment is about.
    pub path: String,
    #[serde(flatten)]
    pub anchor: Anchor,
    pub author_id: String,
    pub author_name: String,
    pub created_at: String,
    pub text: String,
    #[serde(default)]
    pub resolved: bool,
    /// A deleted comment is kept as a marker, so a bundle that still carries it cannot bring
    /// it back.
    #[serde(default)]
    pub deleted: bool,
    /// When what the comment says, or whether it is resolved or deleted, last changed.
    pub updated_at: String,
    /// When its place, the file and passage it is on, last changed.
    #[serde(default)]
    pub placed_at: String,
    #[serde(default)]
    pub replies: Vec<Reply>,
}

/// Where a comment sits: the words it is on, a little text either side, and the line they
/// were last seen on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Anchor {
    pub quote: String,
    #[serde(default)]
    pub before: String,
    #[serde(default)]
    pub after: String,
    #[serde(default)]
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub id: String,
    pub author_id: String,
    pub author_name: String,
    pub created_at: String,
    pub text: String,
}

/// A comment's new place, worked out by the editor after its text moved.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Moved {
    pub id: String,
    #[serde(flatten)]
    pub anchor: Anchor,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    format_version: u32,
    comments: Vec<Comment>,
}

/// Timestamps of one fixed width, so that comparing them as text orders them in time.
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn not_found() -> Error {
    Error::app("comment_missing", "That comment no longer exists")
}

fn clean_text(text: &str) -> Result<String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(Error::app("comment_empty", "A comment needs some text"));
    }
    if text.len() > MAX_TEXT {
        return Err(Error::app("comment_too_long", "That comment is too long"));
    }
    Ok(text.to_string())
}

fn order(comments: &mut [Comment]) {
    comments.sort_by(|a, b| (&a.created_at, &a.id).cmp(&(&b.created_at, &b.id)));
}

/// Every comment the project holds, markers of deleted ones included. Unreadable comments are
/// set aside for recovery rather than written over.
pub fn load(project: &Project) -> Result<Vec<Comment>> {
    let path = project.data_dir().join(FILE);
    if !path.exists() {
        return Ok(Vec::new());
    }
    match serde_json::from_slice::<Stored>(&fs::read(&path)?) {
        Ok(mut stored) => {
            // Written before places were timed: placed when it was made, as a copy from a
            // bundle is taken to be, so both copies of one comment get the same time.
            for c in stored
                .comments
                .iter_mut()
                .filter(|c| c.placed_at.is_empty())
            {
                c.placed_at = c.created_at.clone();
            }
            Ok(stored.comments)
        }
        Err(_) => {
            let _ = fs::rename(&path, project.data_dir().join("comments.damaged.json"));
            Ok(Vec::new())
        }
    }
}

fn save(project: &Project, comments: &[Comment]) -> Result<()> {
    let stored = Stored {
        format_version: 1,
        comments: comments.to_vec(),
    };
    atomic_write(
        &project.data_dir().join(FILE),
        &serde_json::to_vec_pretty(&stored)?,
    )
}

/// The comments to show: everything not deleted.
pub fn visible(comments: Vec<Comment>) -> Vec<Comment> {
    comments.into_iter().filter(|c| !c.deleted).collect()
}

fn change(project: &Project, id: &str, edit: impl FnOnce(&mut Comment)) -> Result<Vec<Comment>> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load(project)?;
    let comment = all
        .iter_mut()
        .find(|c| c.id == id && !c.deleted)
        .ok_or_else(not_found)?;
    edit(comment);
    comment.updated_at = now();
    save(project, &all)?;
    Ok(all)
}

pub fn add(
    project: &Project,
    author: &Author,
    path: &str,
    anchor: Anchor,
    text: &str,
) -> Result<Vec<Comment>> {
    let text = clean_text(text)?;
    let path = clean_rel(path)?.join("/");
    if anchor.quote.trim().is_empty() || anchor.quote.len() > MAX_QUOTE {
        return Err(Error::app(
            "comment_no_text",
            "Select a few words to comment on, no more than a paragraph",
        ));
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load(project)?;
    let at = now();
    all.push(Comment {
        id: new_id(),
        path,
        anchor,
        author_id: author.id.clone(),
        author_name: author.name.clone(),
        created_at: at.clone(),
        text,
        resolved: false,
        deleted: false,
        updated_at: at.clone(),
        placed_at: at,
        replies: Vec::new(),
    });
    save(project, &all)?;
    Ok(all)
}

pub fn reply(project: &Project, author: &Author, id: &str, text: &str) -> Result<Vec<Comment>> {
    let text = clean_text(text)?;
    let full = load(project)?
        .iter()
        .any(|c| c.id == id && c.replies.len() >= MAX_REPLIES);
    if full {
        return Err(Error::app(
            "comment_full",
            "This comment has as many replies as it can hold. Start a new comment instead.",
        ));
    }
    change(project, id, |c| {
        c.replies.push(Reply {
            id: new_id(),
            author_id: author.id.clone(),
            author_name: author.name.clone(),
            created_at: now(),
            text,
        });
        // An answer reopens the conversation.
        c.resolved = false;
    })
}

pub fn set_resolved(project: &Project, id: &str, resolved: bool) -> Result<Vec<Comment>> {
    change(project, id, |c| c.resolved = resolved)
}

pub fn delete(project: &Project, id: &str) -> Result<Vec<Comment>> {
    change(project, id, |c| {
        c.deleted = true;
        c.text.clear();
        c.replies.clear();
    })
}

/// Record where comments now sit, after the text they are on was edited. A passage that only
/// moved to another line keeps its record as it is.
pub fn reanchor(project: &Project, moved: Vec<Moved>) -> Result<Vec<Comment>> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load(project)?;
    let mut changed = false;
    for m in moved {
        if m.anchor.quote.is_empty() || m.anchor.quote.len() > MAX_QUOTE {
            continue;
        }
        let Some(c) = all.iter_mut().find(|c| c.id == m.id && !c.deleted) else {
            continue;
        };
        let same_words = (&c.anchor.quote, &c.anchor.before, &c.anchor.after)
            == (&m.anchor.quote, &m.anchor.before, &m.anchor.after);
        if c.anchor != m.anchor {
            c.anchor = m.anchor;
            changed = true;
            if !same_words {
                c.placed_at = now();
            }
        }
    }
    if changed {
        save(project, &all)?;
    }
    Ok(all)
}

/// Keep comments with a file, or with everything in a folder, that was renamed or moved.
pub fn follow_rename(project: &Project, from: &str, to: &str) -> Result<()> {
    let (from, to) = (clean_rel(from)?.join("/"), clean_rel(to)?.join("/"));
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load(project)?;
    let mut changed = false;
    let inside = format!("{from}/");
    for c in all.iter_mut() {
        let new_path = if c.path == from {
            to.clone()
        } else if let Some(rest) = c.path.strip_prefix(&inside) {
            format!("{to}/{rest}")
        } else {
            continue;
        };
        c.path = new_path;
        c.placed_at = now();
        changed = true;
    }
    if changed {
        save(project, &all)?;
    }
    Ok(())
}

/// Combine two copies of one comment. Three things are decided separately, each in a way that
/// does not depend on which copy is called `a`:
///
/// - what it says and whether it is resolved: a deletion wins outright, otherwise the copy
///   whose text or state changed most recently;
/// - where it sits (file and passage): the copy placed most recently, so that editing around
///   a comment never overrides someone else's resolve or delete;
/// - its replies: every reply either copy has.
fn merge_one(a: Comment, b: Comment) -> Comment {
    // Each choice looks only at the fields it decides, so that a merged copy is chosen again
    // exactly as its parts were. The last element settles copies that tie. For state that takes
    // a tampered bundle; for place it is ordinary, since a passage that only moved to another
    // line keeps its time, and either line serves until the next save corrects it.
    let state = |c: &Comment| {
        let rest = (&c.text, &c.author_id, &c.author_name, &c.created_at);
        (
            c.deleted,
            c.updated_at.clone(),
            c.resolved,
            serde_json::to_string(&rest).unwrap_or_default(),
        )
    };
    let place = |c: &Comment| {
        (
            c.placed_at.clone(),
            serde_json::to_string(&(&c.path, &c.anchor)).unwrap_or_default(),
        )
    };
    let (path, anchor, placed_at) = {
        let newest = if place(&a) >= place(&b) { &a } else { &b };
        (
            newest.path.clone(),
            newest.anchor.clone(),
            newest.placed_at.clone(),
        )
    };
    let (mut winner, loser) = if state(&a) >= state(&b) {
        (a, b)
    } else {
        (b, a)
    };
    let mut replies: BTreeMap<String, Reply> = BTreeMap::new();
    for r in loser.replies.into_iter().chain(winner.replies) {
        // Two copies of one reply can only differ if a bundle was tampered with; pick one
        // the same way whichever side it came from.
        let rank = |r: &Reply| serde_json::to_string(r).unwrap_or_default();
        match replies.get(&r.id) {
            Some(kept) if rank(kept) >= rank(&r) => {}
            _ => {
                replies.insert(r.id.clone(), r);
            }
        }
    }
    let mut replies: Vec<Reply> = replies.into_values().collect();
    replies.sort_by(|x, y| (&x.created_at, &x.id).cmp(&(&y.created_at, &y.id)));
    // A deleted comment keeps nothing but its marker. Deletion is final, so emptying it here
    // gives the same result whatever order the copies are combined in.
    if winner.deleted {
        winner.text.clear();
        replies.clear();
    }
    winner.replies = replies;
    winner.path = path;
    winner.anchor = anchor;
    winner.placed_at = placed_at;
    winner
}

/// Combine two sets of comments. Nothing either side has is lost, and the order in which
/// bundles arrive makes no difference.
pub fn merge(mine: Vec<Comment>, theirs: Vec<Comment>) -> Vec<Comment> {
    let mut by_id: BTreeMap<String, Comment> = BTreeMap::new();
    for c in mine.into_iter().chain(theirs) {
        let merged = match by_id.remove(&c.id) {
            Some(existing) => merge_one(existing, c),
            None => merge_one(c.clone(), c),
        };
        by_id.insert(merged.id.clone(), merged);
    }
    let mut out: Vec<Comment> = by_id.into_values().collect();
    order(&mut out);
    out
}

/// The bytes a bundle carries for this project's comments, or nothing when it has none.
pub fn for_bundle(project: &Project) -> Result<Option<Vec<u8>>> {
    let all = load(project)?;
    if all.is_empty() {
        return Ok(None);
    }
    let stored = Stored {
        format_version: 1,
        comments: all,
    };
    Ok(Some(serde_json::to_vec_pretty(&stored)?))
}

/// A time from a bundle, rewritten in the one form this app compares: nothing unreadable, and
/// nothing later than now, which would otherwise win every merge from then on.
fn clean_time(stamp: &str, now: &chrono::DateTime<chrono::Utc>) -> Option<String> {
    let at = chrono::DateTime::parse_from_rfc3339(stamp)
        .ok()?
        .with_timezone(&chrono::Utc);
    Some(
        at.min(*now)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    )
}

/// Read the comments out of a bundle. They are untrusted: anything malformed or oversized is
/// dropped, and what remains can only ever be shown as plain text.
pub fn from_bundle(bytes: &[u8]) -> Vec<Comment> {
    from_bundle_at(bytes, &chrono::Utc::now())
}

/// The same, with times later than `present` brought back to it.
fn from_bundle_at(bytes: &[u8], present: &chrono::DateTime<chrono::Utc>) -> Vec<Comment> {
    let Ok(stored) = serde_json::from_slice::<Stored>(bytes) else {
        return Vec::new();
    };
    let short = |s: &str, max: usize| s.len() <= max;
    let present = *present;
    stored
        .comments
        .into_iter()
        .filter_map(|mut c| {
            let sound = safe_id(&c.id)
                && clean_rel(&c.path).is_ok_and(|parts| parts.join("/") == c.path)
                && short(&c.text, MAX_TEXT)
                && short(&c.anchor.quote, MAX_QUOTE)
                && short(&c.anchor.before, 400)
                && short(&c.anchor.after, 400)
                && short(&c.author_name, 200)
                && short(&c.author_id, 64)
                && c.replies.len() <= MAX_REPLIES * 20;
            if !sound {
                return None;
            }
            c.created_at = clean_time(&c.created_at, &present)?;
            c.updated_at = clean_time(&c.updated_at, &present)?;
            // A copy from before places were timed was placed when it was made.
            c.placed_at = clean_time(&c.placed_at, &present).unwrap_or(c.created_at.clone());
            for r in c.replies.iter_mut() {
                let sound = safe_id(&r.id)
                    && short(&r.text, MAX_TEXT)
                    && short(&r.author_name, 200)
                    && short(&r.author_id, 64);
                if !sound {
                    return None;
                }
                r.created_at = clean_time(&r.created_at, &present)?;
            }
            Some(c)
        })
        .take(MAX_COMMENTS)
        .collect()
}

/// Times a bundle gave from a clock that runs ahead were brought back to the moment of import
/// (`clamped`), so the same bundle imported again would bring them back to a later moment and
/// seem newer than itself. Where such a comment says just what the copy here says, it takes the
/// times of the copy here, and importing it again changes nothing.
fn settle(theirs: &mut [Comment], mine: &[Comment], clamped: &str) {
    for c in theirs.iter_mut() {
        let Some(m) = mine.iter().find(|m| m.id == c.id) else {
            continue;
        };
        if c.created_at == clamped {
            c.created_at = m.created_at.clone();
        }
        let same_place = c.path == m.path && c.anchor == m.anchor;
        if c.placed_at == clamped && same_place {
            c.placed_at = m.placed_at.clone();
        }
        let same_state = (
            c.deleted,
            c.resolved,
            &c.text,
            &c.author_id,
            &c.author_name,
            &c.created_at,
        ) == (
            m.deleted,
            m.resolved,
            &m.text,
            &m.author_id,
            &m.author_name,
            &m.created_at,
        );
        if c.updated_at == clamped && same_state {
            c.updated_at = m.updated_at.clone();
        }
        for r in c.replies.iter_mut().filter(|r| r.created_at == clamped) {
            if let Some(kept) = m.replies.iter().find(|x| x.id == r.id && x.text == r.text) {
                r.created_at = kept.created_at.clone();
            }
        }
    }
}

/// Take in the comments of a bundle.
pub fn import(project: &Project, bytes: &[u8]) -> Result<()> {
    let present = chrono::Utc::now();
    let mut theirs = from_bundle_at(bytes, &present);
    if theirs.is_empty() {
        return Ok(());
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mine = load(project)?;
    settle(
        &mut theirs,
        &mine,
        &present.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    );
    let merged = merge(mine.clone(), theirs);
    if merged != mine {
        save(project, &merged)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn project(dir: &std::path::Path) -> Project {
        Project::create(&dir.join("p"), "p", "article").unwrap()
    }

    fn me() -> Author {
        Author {
            id: "author-1".into(),
            name: "Tamer".into(),
        }
    }

    fn anchor(quote: &str) -> Anchor {
        Anchor {
            quote: quote.into(),
            before: "before ".into(),
            after: " after".into(),
            line: 3,
        }
    }

    #[test]
    fn comments_are_kept_outside_the_projects_files() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let before = fs::read_to_string(p.root.join("main.tex")).unwrap();
        let all = add(&p, &me(), "main.tex", anchor("a claim"), " Is this right? ").unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].text, "Is this right?");
        assert_eq!(fs::read_to_string(p.root.join("main.tex")).unwrap(), before);
        assert!(p.data_dir().join("comments.json").is_file());
        assert!(
            p.walk_files()
                .unwrap()
                .iter()
                .all(|(rel, _)| !rel.contains("comments"))
        );
    }

    #[test]
    fn a_comment_can_be_answered_resolved_and_deleted() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let id = add(&p, &me(), "main.tex", anchor("words"), "First").unwrap()[0]
            .id
            .clone();
        set_resolved(&p, &id, true).unwrap();
        let all = reply(&p, &me(), &id, "Second").unwrap();
        assert_eq!(all[0].replies.len(), 1);
        assert!(!all[0].resolved, "an answer reopens the comment");
        let all = delete(&p, &id).unwrap();
        assert!(all[0].deleted && all[0].text.is_empty() && all[0].replies.is_empty());
        assert!(visible(load(&p).unwrap()).is_empty());
        assert_eq!(
            reply(&p, &me(), &id, "x").unwrap_err().code(),
            "comment_missing"
        );
    }

    #[test]
    fn empty_comments_and_unsafe_paths_are_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        assert_eq!(
            add(&p, &me(), "main.tex", anchor("w"), "  ")
                .unwrap_err()
                .code(),
            "comment_empty"
        );
        assert!(add(&p, &me(), "../x.tex", anchor("w"), "hi").is_err());
        assert_eq!(
            add(&p, &me(), "main.tex", anchor(" "), "hi")
                .unwrap_err()
                .code(),
            "comment_no_text"
        );
    }

    #[test]
    fn comments_follow_a_renamed_file_and_a_renamed_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        add(&p, &me(), "sections/intro.tex", anchor("w"), "one").unwrap();
        add(&p, &me(), "main.tex", anchor("w"), "two").unwrap();
        follow_rename(&p, "sections", "parts").unwrap();
        follow_rename(&p, "main.tex", "paper.tex").unwrap();
        let paths: Vec<String> = load(&p).unwrap().into_iter().map(|c| c.path).collect();
        assert_eq!(paths, ["parts/intro.tex", "paper.tex"]);
    }

    #[test]
    fn moving_a_comment_records_its_new_place() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let id = add(&p, &me(), "main.tex", anchor("old words"), "hm").unwrap()[0]
            .id
            .clone();
        let all = reanchor(
            &p,
            vec![Moved {
                id: id.clone(),
                anchor: anchor("new words"),
            }],
        )
        .unwrap();
        assert_eq!(all[0].anchor.quote, "new words");
    }

    #[test]
    fn editing_around_a_comment_does_not_undo_someone_elses_resolve_or_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let base = add(&p, &me(), "sections/a.tex", anchor("old words"), "hm").unwrap();
        let id = base[0].id.clone();
        let pause = || std::thread::sleep(std::time::Duration::from_millis(3));

        // One person resolves, another deletes; both from the same starting point.
        pause();
        let resolved = set_resolved(&p, &id, true).unwrap();
        save(&p, &base).unwrap();
        pause();
        let deleted = delete(&p, &id).unwrap();

        // Meanwhile, and later than both, a third edits around the passage and renames the file.
        save(&p, &base).unwrap();
        pause();
        let moved = Moved {
            id: id.clone(),
            anchor: anchor("new words"),
        };
        reanchor(&p, vec![moved]).unwrap();
        follow_rename(&p, "sections\\a.tex", "./parts/a.tex").unwrap();
        let edited = load(&p).unwrap();
        assert_eq!(
            edited[0].path, "parts/a.tex",
            "the stored path is the plain one"
        );
        assert_eq!(edited[0].updated_at, base[0].updated_at);

        let with_resolve = merge(edited.clone(), resolved);
        assert!(with_resolve[0].resolved, "the resolve stands");
        assert_eq!(
            with_resolve[0].anchor.quote, "new words",
            "and so does the new place"
        );
        assert_eq!(with_resolve[0].path, "parts/a.tex");
        let with_delete = merge(deleted, with_resolve);
        assert!(with_delete[0].deleted, "a deletion wins over everything");
    }

    #[test]
    fn a_passage_that_only_changed_line_is_not_a_new_place() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let base = add(&p, &me(), "main.tex", anchor("words"), "hm").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(3));
        let mut lower = anchor("words");
        lower.line = 40;
        let moved = Moved {
            id: base[0].id.clone(),
            anchor: lower,
        };
        let after = reanchor(&p, vec![moved]).unwrap();
        assert_eq!(after[0].anchor.line, 40);
        assert_eq!(after[0].placed_at, base[0].placed_at);
    }

    #[test]
    fn times_from_a_bundle_cannot_claim_the_future_or_be_nonsense() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let mine = add(&p, &me(), "main.tex", anchor("w"), "my words").unwrap();
        let forged = |stamp: &str| {
            let mut c = mine[0].clone();
            c.text = "rewritten".into();
            c.updated_at = stamp.into();
            serde_json::to_vec(&Stored {
                format_version: 1,
                comments: vec![c],
            })
            .unwrap()
        };
        assert!(from_bundle(&forged("zzzz")).is_empty());
        assert!(from_bundle(&forged("9999")).is_empty());
        let future = from_bundle(&forged("9999-01-01T00:00:00Z"));
        assert!(future[0].updated_at.as_str() <= now().as_str());
        // Another time zone is brought to the one form before it is compared.
        let zoned = from_bundle(&forged("2026-01-01T05:00:00+05:00"));
        assert_eq!(zoned[0].updated_at, "2026-01-01T00:00:00.000Z");

        // A forged copy from the future does not stop a later change here from counting.
        import(&p, &forged("9999-01-01T00:00:00Z")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(3));
        let stale = load(&p).unwrap();
        let resolved = set_resolved(&p, &mine[0].id, true).unwrap();
        assert!(merge(resolved, stale)[0].resolved);
    }

    #[test]
    fn a_bundle_from_a_clock_that_runs_ahead_changes_nothing_the_second_time() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let mine = add(&p, &me(), "main.tex", anchor("w"), "my words").unwrap();
        let mut ahead = mine[0].clone();
        ahead.id = "from-the-future".into();
        ahead.text = "theirs".into();
        ahead.created_at = "2999-01-01T00:00:00.000Z".into();
        ahead.updated_at = "2999-01-01T00:00:00.000Z".into();
        ahead.placed_at = "2999-01-01T00:00:00.000Z".into();
        ahead.replies = vec![Reply {
            id: "reply-ahead".into(),
            author_id: "author-2".into(),
            author_name: "Sam".into(),
            created_at: "2999-01-01T00:00:00.000Z".into(),
            text: "agreed".into(),
        }];
        let bytes = serde_json::to_vec(&Stored {
            format_version: 1,
            comments: vec![ahead],
        })
        .unwrap();
        import(&p, &bytes).unwrap();
        let first = std::fs::read(p.root.join(".emquad").join("comments.json")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        import(&p, &bytes).unwrap();
        let second = std::fs::read(p.root.join(".emquad").join("comments.json")).unwrap();
        assert_eq!(first, second);
        // A real change in the bundle still counts.
        let mut changed: Stored = serde_json::from_slice(&bytes).unwrap();
        changed.comments[0].resolved = true;
        import(&p, &serde_json::to_vec(&changed).unwrap()).unwrap();
        let now_resolved = load(&p).unwrap();
        assert!(
            now_resolved
                .iter()
                .any(|c| c.id == "from-the-future" && c.resolved)
        );
    }

    #[test]
    fn a_long_thread_is_not_cut_short_by_merging() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let mut all = add(&p, &me(), "main.tex", anchor("w"), "hello").unwrap();
        all[0].replies = (0..MAX_REPLIES + 20)
            .map(|n| Reply {
                id: format!("r{n:04}"),
                author_id: "a".into(),
                author_name: "A".into(),
                created_at: now(),
                text: "x".into(),
            })
            .collect();
        let merged = merge(all.clone(), Vec::new());
        assert_eq!(merged[0].replies.len(), MAX_REPLIES + 20);
        // Two people can each fill a thread; the combined one must still travel in a bundle.
        let stored = Stored {
            format_version: 1,
            comments: merged,
        };
        let arrived = from_bundle(&serde_json::to_vec(&stored).unwrap());
        assert_eq!(arrived[0].replies.len(), MAX_REPLIES + 20);
        save(&p, &all).unwrap();
        assert_eq!(
            reply(&p, &me(), &all[0].id, "one more").unwrap_err().code(),
            "comment_full"
        );
    }

    #[test]
    fn a_deleted_comment_is_not_brought_back_by_an_older_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let old = add(&p, &me(), "main.tex", anchor("w"), "hello").unwrap();
        let id = old[0].id.clone();
        std::thread::sleep(std::time::Duration::from_millis(3));
        let mine = delete(&p, &id).unwrap();
        let answered = reply(&p, &me(), &id, "still here?");
        assert!(answered.is_err());
        let mut theirs = old.clone();
        theirs[0].replies.push(Reply {
            id: "r-1".into(),
            author_id: "b".into(),
            author_name: "Lina".into(),
            created_at: now(),
            text: "a reply made before the deletion arrived".into(),
        });
        let merged = merge(mine.clone(), theirs.clone());
        assert!(merged[0].deleted);
        assert!(merged[0].replies.is_empty() && merged[0].text.is_empty());
        assert_eq!(merged, merge(theirs, mine.clone()));

        // A file from before places were timed loads with a usable time.
        let raw = fs::read_to_string(p.data_dir().join(FILE)).unwrap();
        let timed = format!("\"placedAt\": \"{}\"", mine[0].placed_at);
        assert!(raw.contains(&timed));
        let untimed = raw.replace(&timed, "\"placedAt\": \"\"");
        fs::write(p.data_dir().join(FILE), untimed).unwrap();
        let loaded = load(&p).unwrap();
        assert_eq!(loaded[0].placed_at, loaded[0].created_at);
        // The same time as the same file brings when it comes in a bundle.
        let carried = from_bundle(&fs::read(p.data_dir().join(FILE)).unwrap());
        assert_eq!(carried[0].placed_at, loaded[0].placed_at);
    }

    #[test]
    fn replies_from_both_sides_are_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let base = add(&p, &me(), "main.tex", anchor("w"), "hello").unwrap();
        let id = base[0].id.clone();
        let mine = reply(&p, &me(), &id, "from me").unwrap();
        save(&p, &base).unwrap();
        let theirs = reply(&p, &me(), &id, "from them").unwrap();
        let merged = merge(mine, theirs);
        let texts: Vec<&str> = merged[0].replies.iter().map(|r| r.text.as_str()).collect();
        assert_eq!(texts.len(), 2);
        assert!(texts.contains(&"from me") && texts.contains(&"from them"));
    }

    #[test]
    fn comments_from_a_bundle_are_checked_before_use() {
        let good = Comment {
            id: "c-1".into(),
            path: "main.tex".into(),
            anchor: anchor("w"),
            author_id: "a".into(),
            author_name: "Lina".into(),
            created_at: "2026-01-01T00:00:00.000Z".into(),
            text: "fine".into(),
            resolved: false,
            deleted: false,
            updated_at: "2026-01-01T00:00:00.000Z".into(),
            placed_at: "2026-01-01T00:00:00.000Z".into(),
            replies: Vec::new(),
        };
        let spoil = |edit: &dyn Fn(&mut Comment)| {
            let mut c = good.clone();
            edit(&mut c);
            c
        };
        let stored = Stored {
            format_version: 1,
            comments: vec![
                good.clone(),
                spoil(&|c| c.id = "../../x".into()),
                spoil(&|c| c.path = "../outside.tex".into()),
                spoil(&|c| c.path = ".emquad/project.json".into()),
                spoil(&|c| c.path = "C:\\x.tex".into()),
                spoil(&|c| c.text = "x".repeat(MAX_TEXT + 1)),
                spoil(&|c| c.anchor.quote = "x".repeat(MAX_QUOTE + 1)),
            ],
        };
        let kept = from_bundle(&serde_json::to_vec(&stored).unwrap());
        assert_eq!(kept, vec![good]);
        assert!(from_bundle(b"{ not json").is_empty());
        assert!(from_bundle(b"[]").is_empty());
    }

    fn arb_comment() -> impl Strategy<Value = Comment> {
        (
            0..4u8,
            (0..3u8, 0..3u8, 0..2u8, 0..2u8),
            any::<bool>(),
            any::<bool>(),
            ("[a-c]{0,2}", "[a-c]{0,1}", "[a-b]"),
            prop::collection::vec((0..4u8, 0..3u8, "[a-c]{0,2}", 0..2u8), 0..4),
        )
            .prop_map(|(id, times, resolved, deleted, words, replies)| Comment {
                id: format!("c{id}"),
                path: format!("{}.tex", words.2),
                anchor: Anchor {
                    quote: words.1,
                    before: String::new(),
                    after: String::new(),
                    line: 1,
                },
                author_id: format!("a{}", times.2),
                author_name: "A".into(),
                created_at: format!("t{}", times.3),
                text: words.0,
                resolved,
                deleted,
                updated_at: format!("t{}", times.0),
                placed_at: format!("t{}", times.1),
                replies: replies
                    .into_iter()
                    .map(|(id, at, text, who)| Reply {
                        id: format!("r{id}"),
                        author_id: format!("a{who}"),
                        author_name: "A".into(),
                        created_at: format!("t{at}"),
                        text,
                    })
                    .collect(),
            })
    }

    /// A set as one person could hold it: one copy of each comment and of each reply.
    fn arb_set() -> impl Strategy<Value = Vec<Comment>> {
        prop::collection::vec(arb_comment(), 0..5).prop_map(|v| merge(v, Vec::new()))
    }

    proptest! {
        #[test]
        fn merging_is_the_same_in_any_order_and_any_number_of_times(
            a in arb_set(), b in arb_set(), c in arb_set()
        ) {
            let ab = merge(a.clone(), b.clone());
            prop_assert_eq!(&ab, &merge(b.clone(), a.clone()));
            prop_assert_eq!(&ab, &merge(ab.clone(), b.clone()));
            prop_assert_eq!(&ab, &merge(ab.clone(), ab.clone()));
            prop_assert_eq!(
                merge(ab.clone(), c.clone()),
                merge(a.clone(), merge(b.clone(), c.clone()))
            );
            // Nothing is lost: every comment either side had is still there.
            for comment in a.iter().chain(b.iter()) {
                let kept = ab.iter().find(|m| m.id == comment.id);
                prop_assert!(kept.is_some());
                // ... with every reply it had.
                let kept = kept.unwrap();
                for reply in &comment.replies {
                    prop_assert!(kept.deleted || kept.replies.iter().any(|r| r.id == reply.id));
                }
                // A deleted comment carries nothing but its marker.
                prop_assert!(!kept.deleted || (kept.text.is_empty() && kept.replies.is_empty()));
                // A deletion is never undone.
                prop_assert!(!comment.deleted || kept.deleted);
            }
        }
    }
}
