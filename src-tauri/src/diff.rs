//! Line-level comparison for decisions, word-level comparison for display.
//! See docs/03-bundles-and-history.md, "Diff granularity" and "Classification".

use serde::Serialize;
use similar::{Algorithm, ChangeTag, DiffOp, TextDiff, capture_diff_slices};
use ts_rs::TS;

/// Lines with their endings kept, so joining them reproduces the input byte for byte.
pub fn split_lines(s: &str) -> Vec<&str> {
    s.split_inclusive('\n').collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Segment {
    /// "equal", "insert" or "delete"
    pub tag: String,
    pub text: String,
}

pub fn word_segments(old: &str, new: &str) -> Vec<Segment> {
    let diff = TextDiff::from_words(old, new);
    let mut out: Vec<Segment> = Vec::new();
    for change in diff.iter_all_changes() {
        let tag = match change.tag() {
            ChangeTag::Equal => "equal",
            ChangeTag::Insert => "insert",
            ChangeTag::Delete => "delete",
        };
        match out.last_mut() {
            Some(last) if last.tag == tag => last.text.push_str(change.value()),
            _ => out.push(Segment {
                tag: tag.into(),
                text: change.value().into(),
            }),
        }
    }
    out
}

/// A changed run of base lines `b0..b1` replaced by new lines `n0..n1`.
#[derive(Debug, Clone, Copy)]
struct Region {
    b0: usize,
    b1: usize,
    n0: usize,
    n1: usize,
}

fn regions(base: &[&str], new: &[&str]) -> Vec<Region> {
    let mut out: Vec<Region> = Vec::new();
    for op in capture_diff_slices(Algorithm::Myers, base, new) {
        let r = match op {
            DiffOp::Equal { .. } => continue,
            DiffOp::Delete {
                old_index,
                old_len,
                new_index,
            } => Region {
                b0: old_index,
                b1: old_index + old_len,
                n0: new_index,
                n1: new_index,
            },
            DiffOp::Insert {
                old_index,
                new_index,
                new_len,
            } => Region {
                b0: old_index,
                b1: old_index,
                n0: new_index,
                n1: new_index + new_len,
            },
            DiffOp::Replace {
                old_index,
                old_len,
                new_index,
                new_len,
            } => Region {
                b0: old_index,
                b1: old_index + old_len,
                n0: new_index,
                n1: new_index + new_len,
            },
        };
        match out.last_mut() {
            Some(last) if last.b1 == r.b0 && last.n1 == r.n0 => {
                last.b1 = r.b1;
                last.n1 = r.n1;
            }
            _ => out.push(r),
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Block {
    #[serde(rename_all = "camelCase")]
    Equal {
        new_start: u32,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Change {
        old_start: u32,
        new_start: u32,
        old_text: String,
        new_text: String,
        segments: Vec<Segment>,
    },
}

/// The new file as a sequence of unchanged and changed blocks, for display.
pub fn diff_blocks(old: &str, new: &str) -> Vec<Block> {
    let (a, b) = (split_lines(old), split_lines(new));
    let mut out = Vec::new();
    let mut bi = 0usize;
    let push_equal = |out: &mut Vec<Block>, from: usize, to: usize| {
        if to > from {
            out.push(Block::Equal {
                new_start: from as u32 + 1,
                text: b[from..to].concat(),
            });
        }
    };
    for r in regions(&a, &b) {
        push_equal(&mut out, bi, r.n0);
        let (old_text, new_text) = (a[r.b0..r.b1].concat(), b[r.n0..r.n1].concat());
        out.push(Block::Change {
            old_start: r.b0 as u32 + 1,
            new_start: r.n0 as u32 + 1,
            segments: word_segments(&old_text, &new_text),
            old_text,
            new_text,
        });
        bi = r.n1;
    }
    push_equal(&mut out, bi, b.len());
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    /// Only we changed these lines.
    Ours,
    /// Only they changed these lines.
    Theirs,
    /// Both made the identical change.
    Same,
    /// Both changed the same lines differently.
    Conflict,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Chunk {
    Stable(String),
    Change {
        class: Class,
        base: String,
        ours: String,
        theirs: String,
        /// 1-based line in our version where this chunk starts.
        ours_line: u32,
    },
}

/// Three-way comparison. Concatenating `Stable` text and each change's `ours` text gives `ours`
/// back exactly; likewise for `theirs` and `base`.
///
/// Changes from the two sides that overlap *or touch* are grouped into one chunk. Touching edits
/// could often be merged, but treating them as a conflict can never drop text silently.
pub fn diff3(base: &str, ours: &str, theirs: &str) -> Vec<Chunk> {
    let (b, o, t) = (split_lines(base), split_lines(ours), split_lines(theirs));
    let (ro, rt) = (regions(&b, &o), regions(&b, &t));
    let (mut i, mut j, mut pos) = (0usize, 0usize, 0usize);
    // Offset from a base index to the matching index in ours/theirs, outside changed regions.
    let (mut shift_o, mut shift_t) = (0isize, 0isize);
    let mut out = Vec::new();

    loop {
        let start = match (ro.get(i), rt.get(j)) {
            (Some(a), Some(c)) => a.b0.min(c.b0),
            (Some(a), None) => a.b0,
            (None, Some(c)) => c.b0,
            (None, None) => break,
        };
        if start > pos {
            out.push(Chunk::Stable(b[pos..start].concat()));
        }
        let o_start = (start as isize + shift_o) as usize;
        let t_start = (start as isize + shift_t) as usize;
        let (mut end, mut has_o, mut has_t) = (start, false, false);
        loop {
            let mut grew = false;
            if let Some(r) = ro.get(i).filter(|r| r.b0 <= end) {
                end = end.max(r.b1);
                shift_o += (r.n1 - r.n0) as isize - (r.b1 - r.b0) as isize;
                has_o = true;
                i += 1;
                grew = true;
            }
            if let Some(r) = rt.get(j).filter(|r| r.b0 <= end) {
                end = end.max(r.b1);
                shift_t += (r.n1 - r.n0) as isize - (r.b1 - r.b0) as isize;
                has_t = true;
                j += 1;
                grew = true;
            }
            if !grew {
                break;
            }
        }
        let o_end = (end as isize + shift_o) as usize;
        let t_end = (end as isize + shift_t) as usize;
        let (ours_text, theirs_text) = (o[o_start..o_end].concat(), t[t_start..t_end].concat());
        let class = match (has_o, has_t) {
            (true, false) => Class::Ours,
            (false, true) => Class::Theirs,
            _ if ours_text == theirs_text => Class::Same,
            _ => Class::Conflict,
        };
        out.push(Chunk::Change {
            class,
            base: b[start..end].concat(),
            ours: ours_text,
            theirs: theirs_text,
            ours_line: o_start as u32 + 1,
        });
        pos = end;
    }
    if pos < b.len() {
        out.push(Chunk::Stable(b[pos..].concat()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn side(chunks: &[Chunk], pick: fn(&Chunk) -> &str) -> String {
        chunks.iter().map(pick).collect()
    }
    fn ours_of(c: &Chunk) -> &str {
        match c {
            Chunk::Stable(s) => s,
            Chunk::Change { ours, .. } => ours,
        }
    }
    fn theirs_of(c: &Chunk) -> &str {
        match c {
            Chunk::Stable(s) => s,
            Chunk::Change { theirs, .. } => theirs,
        }
    }
    fn base_of(c: &Chunk) -> &str {
        match c {
            Chunk::Stable(s) => s,
            Chunk::Change { base, .. } => base,
        }
    }
    fn classes(chunks: &[Chunk]) -> Vec<Class> {
        chunks
            .iter()
            .filter_map(|c| match c {
                Chunk::Change { class, .. } => Some(*class),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn classifies_every_row_of_the_table() {
        let base = "a\nb\nc\nd\ne\nf\ng\n";
        let ours = "A\nb\nc\nd\nE\nf\nX\n";
        let theirs = "a\nb\nC\nd\nE\nf\nY\n";
        let chunks = diff3(base, ours, theirs);
        assert_eq!(
            classes(&chunks),
            [Class::Ours, Class::Theirs, Class::Same, Class::Conflict]
        );
        assert_eq!(side(&chunks, ours_of), ours);
        assert_eq!(side(&chunks, theirs_of), theirs);
        assert_eq!(side(&chunks, base_of), base);
    }

    #[test]
    fn unchanged_sides_produce_no_conflicts() {
        let base = "one\ntwo\nthree\n";
        let theirs = "zero\none\nthree\nfour";
        let only_theirs = classes(&diff3(base, base, theirs));
        assert!(!only_theirs.is_empty() && only_theirs.iter().all(|c| *c == Class::Theirs));
        assert!(classes(&diff3(base, theirs, theirs))
            .iter()
            .all(|c| *c == Class::Same));
    }

    #[test]
    fn insertions_at_the_same_point_conflict_unless_identical() {
        assert_eq!(
            classes(&diff3("a\nb\n", "a\nx\nb\n", "a\ny\nb\n")),
            [Class::Conflict]
        );
        assert_eq!(
            classes(&diff3("a\nb\n", "a\nx\nb\n", "a\nx\nb\n")),
            [Class::Same]
        );
    }

    #[test]
    fn word_level_detail_isolates_a_one_word_edit() {
        let old = "We give the classical evaluation of the Gaussian integral.\n";
        let new = "We recall the classical evaluation of the Gaussian integral.\n";
        let changed: Vec<_> = word_segments(old, new)
            .into_iter()
            .filter(|s| s.tag != "equal")
            .collect();
        assert_eq!(changed.len(), 2);
        assert_eq!(changed[0].text, "give");
        assert_eq!(changed[1].text, "recall");
    }

    #[test]
    fn blocks_rebuild_both_files_and_keep_crlf() {
        let old = "a\r\nb\r\nc\r\n";
        let new = "a\r\nB\r\nc\r\nd";
        let blocks = diff_blocks(old, new);
        let rebuilt_new: String = blocks
            .iter()
            .map(|b| match b {
                Block::Equal { text, .. } => text.as_str(),
                Block::Change { new_text, .. } => new_text.as_str(),
            })
            .collect();
        let rebuilt_old: String = blocks
            .iter()
            .map(|b| match b {
                Block::Equal { text, .. } => text.as_str(),
                Block::Change { old_text, .. } => old_text.as_str(),
            })
            .collect();
        assert_eq!(rebuilt_new, new);
        assert_eq!(rebuilt_old, old);
    }

    fn lines() -> impl Strategy<Value = Vec<String>> {
        prop::collection::vec("[a-e]{0,2}", 0..12)
    }
    fn edit(base: Vec<String>, ops: Vec<(usize, u8, String)>) -> Vec<String> {
        let mut v = base;
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
    fn ops() -> impl Strategy<Value = Vec<(usize, u8, String)>> {
        prop::collection::vec((0usize..20, 0u8..3, "[v-z]{1,2}"), 0..5)
    }

    proptest! {
        /// Every side can be rebuilt exactly from the chunks: nothing is lost or invented.
        #[test]
        fn chunks_partition_all_three_inputs(b in lines(), eo in ops(), et in ops()) {
            let (base, ours, theirs) = (text(&b), text(&edit(b.clone(), eo)), text(&edit(b.clone(), et)));
            let chunks = diff3(&base, &ours, &theirs);
            prop_assert_eq!(side(&chunks, ours_of), ours);
            prop_assert_eq!(side(&chunks, theirs_of), theirs);
            prop_assert_eq!(side(&chunks, base_of), base);
            for c in &chunks {
                if let Chunk::Change { class, base, ours, theirs, .. } = c {
                    match class {
                        Class::Ours => prop_assert_eq!(base, theirs),
                        Class::Theirs => prop_assert_eq!(base, ours),
                        Class::Same => prop_assert_eq!(ours, theirs),
                        Class::Conflict => prop_assert_ne!(ours, theirs),
                    }
                }
            }
        }

        /// Edits to lines that are well apart never conflict, and both survive a merge.
        #[test]
        fn disjoint_edits_merge_cleanly(n in 6usize..20, a in 0usize..100, c in 0usize..100) {
            let base: Vec<String> = (0..n).map(|i| format!("line{i}")).collect();
            let (ia, ic) = (a % (n / 2 - 1), n / 2 + 1 + c % (n - n / 2 - 1));
            let (mut o, mut t) = (base.clone(), base.clone());
            o[ia] = "OURS".into();
            t[ic] = "THEIRS".into();
            let chunks = diff3(&text(&base), &text(&o), &text(&t));
            prop_assert!(!classes(&chunks).contains(&Class::Conflict));
            let merged: String = chunks.iter().map(|ch| match ch {
                Chunk::Stable(s) => s.as_str(),
                Chunk::Change { class: Class::Theirs, theirs, .. } => theirs.as_str(),
                Chunk::Change { ours, .. } => ours.as_str(),
            }).collect();
            prop_assert!(merged.contains("OURS\n") && merged.contains("THEIRS\n"));
        }
    }
}
