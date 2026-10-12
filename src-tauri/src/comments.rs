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
use ts_rs::TS;

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
    /// When the comment itself, its place or its state last changed.
    pub updated_at: String,
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
        Ok(stored) => Ok(stored.comments),
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
        updated_at: at,
        replies: Vec::new(),
    });
    save(project, &all)?;
    Ok(all)
}

pub fn reply(project: &Project, author: &Author, id: &str, text: &str) -> Result<Vec<Comment>> {
    let text = clean_text(text)?;
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

/// Record where comments now sit, after the text they are on was edited.
pub fn reanchor(project: &Project, moved: Vec<Moved>) -> Result<Vec<Comment>> {
    let mut all = load(project)?;
    let mut changed = false;
    for m in moved {
        if m.anchor.quote.is_empty() || m.anchor.quote.len() > MAX_QUOTE {
            continue;
        }
        let place = all
            .iter_mut()
            .find(|c| c.id == m.id && !c.deleted && c.anchor != m.anchor);
        if let Some(c) = place {
            c.anchor = m.anchor;
            c.updated_at = now();
            changed = true;
        }
    }
    if changed {
        save(project, &all)?;
    }
    Ok(all)
}

/// Keep comments with a file, or with everything in a folder, that was renamed or moved.
pub fn follow_rename(project: &Project, from: &str, to: &str) -> Result<()> {
    let mut all = load(project)?;
    let mut changed = false;
    let inside = format!("{from}/");
    for c in all.iter_mut() {
        let new_path = if c.path == from {
            to.to_string()
        } else if let Some(rest) = c.path.strip_prefix(&inside) {
            format!("{to}/{rest}")
        } else {
            continue;
        };
        c.path = new_path;
        c.updated_at = now();
        changed = true;
    }
    if changed {
        save(project, &all)?;
    }
    Ok(())
}

/// The newer of two copies of one comment decides its text, place and state; replies from both
/// are kept. The result does not depend on which copy is called `a`.
fn merge_one(a: Comment, b: Comment) -> Comment {
    let key = |c: &Comment| {
        (
            c.updated_at.clone(),
            c.deleted,
            c.resolved,
            serde_json::to_string(&(&c.path, &c.anchor, &c.text, &c.author_name))
                .unwrap_or_default(),
        )
    };
    let (mut winner, loser) = if key(&a) >= key(&b) { (a, b) } else { (b, a) };
    let mut replies: BTreeMap<String, Reply> = BTreeMap::new();
    for r in loser.replies.into_iter().chain(winner.replies) {
        // Two copies of one reply can only differ if a bundle was tampered with; pick one
        // the same way whichever side it came from.
        match replies.get(&r.id) {
            Some(kept) if (&kept.created_at, &kept.text) >= (&r.created_at, &r.text) => {}
            _ => {
                replies.insert(r.id.clone(), r);
            }
        }
    }
    let mut replies: Vec<Reply> = replies.into_values().collect();
    replies.sort_by(|x, y| (&x.created_at, &x.id).cmp(&(&y.created_at, &y.id)));
    replies.truncate(MAX_REPLIES);
    // Replies are kept even beside a deletion marker, so that the outcome never depends on
    // the order bundles arrive in. A deleted comment is not shown either way.
    winner.replies = replies;
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

/// Read the comments out of a bundle. They are untrusted: anything malformed or oversized is
/// dropped, and what remains can only ever be shown as plain text.
pub fn from_bundle(bytes: &[u8]) -> Vec<Comment> {
    let Ok(stored) = serde_json::from_slice::<Stored>(bytes) else {
        return Vec::new();
    };
    let short = |s: &str, max: usize| s.len() <= max;
    stored
        .comments
        .into_iter()
        .filter(|c| {
            safe_id(&c.id)
                && clean_rel(&c.path).is_ok_and(|parts| parts.join("/") == c.path)
                && short(&c.text, MAX_TEXT)
                && short(&c.anchor.quote, MAX_QUOTE)
                && short(&c.anchor.before, 400)
                && short(&c.anchor.after, 400)
                && short(&c.author_name, 200)
                && short(&c.author_id, 64)
                && short(&c.created_at, 40)
                && short(&c.updated_at, 40)
                && c.replies.len() <= MAX_REPLIES
                && c.replies.iter().all(|r| {
                    safe_id(&r.id)
                        && short(&r.text, MAX_TEXT)
                        && short(&r.author_name, 200)
                        && short(&r.author_id, 64)
                        && short(&r.created_at, 40)
                })
        })
        .take(MAX_COMMENTS)
        .collect()
}

/// Take in the comments of a bundle.
pub fn import(project: &Project, bytes: &[u8]) -> Result<()> {
    let theirs = from_bundle(bytes);
    if theirs.is_empty() {
        return Ok(());
    }
    let mine = load(project)?;
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
    fn a_deleted_comment_is_not_brought_back_by_an_older_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let p = project(tmp.path());
        let old = add(&p, &me(), "main.tex", anchor("w"), "hello").unwrap();
        let id = old[0].id.clone();
        std::thread::sleep(std::time::Duration::from_millis(3));
        let mine = delete(&p, &id).unwrap();
        let merged = merge(mine.clone(), old.clone());
        assert!(merged[0].deleted);
        assert_eq!(merged, merge(old, mine));
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
            0..3u8,
            any::<bool>(),
            any::<bool>(),
            "[a-c]{0,2}",
            prop::collection::vec((0..4u8, 0..3u8, "[a-c]{0,2}"), 0..4),
        )
            .prop_map(|(id, at, resolved, deleted, text, replies)| Comment {
                id: format!("c{id}"),
                path: "main.tex".into(),
                anchor: Anchor {
                    quote: text.clone(),
                    before: String::new(),
                    after: String::new(),
                    line: 1,
                },
                author_id: "a".into(),
                author_name: "A".into(),
                created_at: "t0".into(),
                text,
                resolved,
                deleted,
                updated_at: format!("t{at}"),
                replies: replies
                    .into_iter()
                    .map(|(id, at, text)| Reply {
                        id: format!("r{id}"),
                        author_id: "a".into(),
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
                prop_assert!(ab.iter().any(|m| m.id == comment.id));
            }
        }
    }
}
