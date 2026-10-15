//! Notes on a copy of the compiled PDF, as a reader of it sees them in any PDF viewer: comments
//! as highlighted passages with what was said, and the changes since a version as highlighted
//! passages and markers where text was taken out. The PDF itself is never changed: the notes go
//! on a copy, written where the user chose.

use crate::error::{Error, Result};
use lopdf::{Dictionary, Document, Object, ObjectId, StringFormat};
use std::path::Path;

/// What a note says about its passage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteKind {
    /// A comment, with its replies.
    Comment,
    /// Text written or changed since the version compared with.
    Changed,
    /// Text taken out since that version, marked where it was.
    Removed,
}

/// One note: where on a page, in the units and from the top-left corner as SyncTeX gives them
/// (PDF points), what kind, by whom, and what it says.
#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub kind: NoteKind,
    pub author: String,
    pub text: String,
}

fn failed(e: lopdf::Error) -> Error {
    Error::app(
        "pdf_failed",
        format!("The PDF could not be read to add the notes to it: {e}"),
    )
}

/// Text as a PDF text string: UTF-16 with its byte-order mark, which every viewer reads.
fn text_string(text: &str) -> Object {
    let mut bytes = vec![0xFE, 0xFF];
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_be_bytes());
    }
    Object::String(bytes, StringFormat::Hexadecimal)
}

fn name(text: &str) -> Object {
    Object::Name(text.as_bytes().to_vec())
}

fn numbers(values: &[f64]) -> Object {
    Object::Array(values.iter().map(|v| Object::Real(*v as f32)).collect())
}

/// The box a page is drawn in, left, bottom, right and top, from the page or the pages above it.
fn page_box(doc: &Document, page: ObjectId) -> [f64; 4] {
    let mut at = Some(page);
    for _ in 0..32 {
        let Some(id) = at else { break };
        let Ok(dict) = doc.get_dictionary(id) else {
            break;
        };
        for key in [b"CropBox".as_slice(), b"MediaBox"] {
            if let Ok(found) = dict.get_deref(key, doc).and_then(Object::as_array)
                && let [a, b, c, d] = found.as_slice()
                && let (Ok(a), Ok(b), Ok(c), Ok(d)) =
                    (a.as_float(), b.as_float(), c.as_float(), d.as_float())
            {
                return [a as f64, b as f64, c as f64, d as f64];
            }
        }
        at = dict.get(b"Parent").and_then(Object::as_reference).ok();
    }
    // A US Letter page, as PDF assumes when a file names none.
    [0.0, 0.0, 612.0, 792.0]
}

/// The annotation for a note on a page whose box is `bounds`.
fn annotation(note: &Note, bounds: [f64; 4]) -> Dictionary {
    let [left, _, _, top] = bounds;
    let x1 = left + note.x;
    let x2 = x1 + note.width.max(1.0);
    let y2 = top - note.y;
    let y1 = y2 - note.height.max(1.0);
    let mut dict = Dictionary::new();
    dict.set("Type", name("Annot"));
    dict.set("T", text_string(&note.author));
    dict.set("Contents", text_string(&note.text));
    // Printed with the page, and not to be moved about.
    dict.set("F", Object::Integer(4));
    match note.kind {
        NoteKind::Comment | NoteKind::Changed => {
            dict.set("Subtype", name("Highlight"));
            dict.set("Rect", numbers(&[x1, y1, x2, y2]));
            dict.set("QuadPoints", numbers(&[x1, y2, x2, y2, x1, y1, x2, y1]));
            let colour: &[f64] = if note.kind == NoteKind::Comment {
                &[1.0, 0.85, 0.2]
            } else {
                &[0.55, 0.85, 0.55]
            };
            dict.set("C", numbers(colour));
        }
        NoteKind::Removed => {
            // A small marker in the margin beside the line, opened to read what was there.
            dict.set("Subtype", name("Text"));
            dict.set("Name", name("Note"));
            dict.set("Rect", numbers(&[x1 - 20.0, y2 - 16.0, x1 - 4.0, y2]));
            dict.set("C", numbers(&[0.9, 0.35, 0.3]));
        }
    }
    dict
}

/// Write a copy of the PDF at `from` to `to` with the notes on it. Notes on a page the PDF does
/// not have are left out; the number put on is returned.
pub fn annotate(from: &Path, to: &Path, notes: &[Note]) -> Result<usize> {
    let mut doc = Document::load(from).map_err(failed)?;
    let pages = doc.get_pages();
    let mut placed = 0;
    for (number, page) in &pages {
        let mine: Vec<&Note> = notes.iter().filter(|n| n.page == *number).collect();
        if mine.is_empty() {
            continue;
        }
        let bounds = page_box(&doc, *page);
        let ids: Vec<Object> = mine
            .iter()
            .map(|n| Object::Reference(doc.add_object(annotation(n, bounds))))
            .collect();
        placed += ids.len();
        // The page's own list of annotations, which may be written in it or kept elsewhere.
        let held = doc
            .get_dictionary(*page)
            .map_err(failed)?
            .get(b"Annots")
            .ok()
            .cloned();
        match held {
            Some(Object::Reference(list)) => match doc.get_object_mut(list).map_err(failed)? {
                Object::Array(items) => items.extend(ids),
                other => *other = Object::Array(ids),
            },
            Some(Object::Array(mut items)) => {
                items.extend(ids);
                set_annots(&mut doc, *page, Object::Array(items))?;
            }
            _ => set_annots(&mut doc, *page, Object::Array(ids))?,
        }
    }
    // Through a temporary file beside the destination, so a failure leaves no part of one.
    let parent = to
        .parent()
        .ok_or_else(|| Error::app("bad_path", "The PDF has no folder to go in"))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    doc.save_to(&mut tmp)?;
    tmp.persist(to).map_err(|e| Error::Io(e.error))?;
    Ok(placed)
}

/// Where a line of a file landed in the PDF, as SyncTeX finds it.
pub type Locate<'a> = &'a dyn Fn(&str, u32) -> Option<crate::synctex::PdfRect>;

/// Text cut to `most` characters, for a note that should stay readable.
fn shortened(text: &str, most: usize) -> String {
    let text = text.trim();
    match text.char_indices().nth(most) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_string(),
    }
}

fn note_at(rect: &crate::synctex::PdfRect, kind: NoteKind, author: &str, text: String) -> Note {
    Note {
        page: rect.page,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        kind,
        author: author.to_string(),
        text,
    }
}

/// A note for each comment still open, on the line it is on, with its replies.
pub fn comment_notes(comments: &[crate::comments::Comment], locate: Locate) -> Vec<Note> {
    comments
        .iter()
        .filter(|c| !c.resolved && !c.deleted)
        .filter_map(|c| {
            let rect = locate(&c.path, c.anchor.line.max(1))?;
            let mut text = c.text.trim().to_string();
            for reply in &c.replies {
                text.push_str(&format!("\n\n{}: {}", reply.author_name, reply.text.trim()));
            }
            Some(note_at(&rect, NoteKind::Comment, &c.author_name, text))
        })
        .collect()
}

/// Notes for the changes in `diffs`, each against the version called `since`: the lines
/// written or changed marked where they print, one note for each run of them on a page, with
/// what was there before; text taken out marked where it was.
pub fn change_notes(diffs: &[crate::history::FileDiff], since: &str, locate: Locate) -> Vec<Note> {
    let mut notes = Vec::new();
    for diff in diffs.iter().filter(|d| !d.binary) {
        for block in &diff.blocks {
            let crate::diff::Block::Change {
                new_start,
                old_text,
                new_text,
                ..
            } = block
            else {
                continue;
            };
            let was = shortened(old_text, 600);
            let count = new_text.lines().count() as u32;
            if count == 0 {
                if let Some(rect) = locate(&diff.path, *new_start) {
                    notes.push(note_at(
                        &rect,
                        NoteKind::Removed,
                        "Emquad",
                        format!("Taken out since {since}:\n{was}"),
                    ));
                }
                continue;
            }
            let text = if was.is_empty() {
                format!("Written since {since}.")
            } else {
                format!("Changed since {since}. It was:\n{was}")
            };
            // The lines of the change, joined where they follow one another on a page.
            let mut runs: Vec<crate::synctex::PdfRect> = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for line in *new_start..*new_start + count {
                let Some(rect) = locate(&diff.path, line) else {
                    continue;
                };
                // A line with no output of its own is found at the next that has some.
                if !seen.insert((rect.page, rect.y.to_bits())) {
                    continue;
                }
                match runs.last_mut() {
                    Some(run)
                        if run.page == rect.page
                            && rect.y >= run.y
                            && rect.y <= run.y + run.height + 14.0 =>
                    {
                        let right = (run.x + run.width).max(rect.x + rect.width);
                        run.x = run.x.min(rect.x);
                        run.width = right - run.x;
                        run.height = (rect.y + rect.height - run.y).max(run.height);
                    }
                    _ => runs.push(rect),
                }
            }
            for run in &runs {
                notes.push(note_at(run, NoteKind::Changed, "Emquad", text.clone()));
            }
        }
    }
    notes
}

fn set_annots(doc: &mut Document, page: ObjectId, list: Object) -> Result<()> {
    match doc.get_object_mut(page).map_err(failed)? {
        Object::Dictionary(dict) => {
            dict.set("Annots", list);
            Ok(())
        }
        _ => Err(Error::app(
            "pdf_failed",
            "A page of the PDF is not as PDF has it",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A PDF of `count` empty A4 pages.
    fn pdf(path: &Path, count: usize) {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let kids: Vec<Object> = (0..count)
            .map(|_| {
                let mut page = Dictionary::new();
                page.set("Type", name("Page"));
                page.set("Parent", Object::Reference(pages_id));
                Object::Reference(doc.add_object(page))
            })
            .collect();
        let mut pages = Dictionary::new();
        pages.set("Type", name("Pages"));
        pages.set("Kids", Object::Array(kids));
        pages.set("Count", Object::Integer(count as i64));
        pages.set("MediaBox", numbers(&[0.0, 0.0, 595.0, 842.0]));
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let mut catalog = Dictionary::new();
        catalog.set("Type", name("Catalog"));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(catalog);
        doc.trailer.set("Root", Object::Reference(catalog_id));
        doc.save(path).unwrap();
    }

    fn note(page: u32, kind: NoteKind, text: &str) -> Note {
        Note {
            page,
            x: 100.0,
            y: 200.0,
            width: 300.0,
            height: 12.0,
            kind,
            author: "Ada".into(),
            text: text.into(),
        }
    }

    #[test]
    fn notes_go_on_a_copy_on_their_pages_where_the_text_is() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("main.pdf");
        pdf(&from, 2);
        let before = std::fs::read(&from).unwrap();
        let to = tmp.path().join("with notes.pdf");
        let placed = annotate(
            &from,
            &to,
            &[
                note(1, NoteKind::Comment, "Is this right? — Ünïcode too"),
                note(2, NoteKind::Changed, "Changed"),
                note(2, NoteKind::Removed, "Taken out: old words"),
                note(9, NoteKind::Comment, "No such page"),
            ],
        )
        .unwrap();
        assert_eq!(placed, 3);
        // The compiled PDF is as it was.
        assert_eq!(std::fs::read(&from).unwrap(), before);
        let doc = Document::load(&to).unwrap();
        let pages = doc.get_pages();
        let annots = |page: u32| -> Vec<Dictionary> {
            doc.get_dictionary(pages[&page])
                .unwrap()
                .get(b"Annots")
                .and_then(Object::as_array)
                .map(|list| {
                    list.iter()
                        .map(|o| {
                            doc.get_dictionary(o.as_reference().unwrap())
                                .unwrap()
                                .clone()
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        let first = annots(1);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].get(b"Subtype").unwrap(), &name("Highlight"));
        assert_eq!(
            first[0].get(b"Contents").unwrap(),
            &text_string("Is this right? — Ünïcode too")
        );
        // From the top-left of an A4 page to PDF's own bottom-left.
        let rect: Vec<f32> = first[0]
            .get(b"Rect")
            .and_then(Object::as_array)
            .unwrap()
            .iter()
            .map(|v| v.as_float().unwrap())
            .collect();
        assert_eq!(rect, [100.0, 630.0, 400.0, 642.0]);
        let second = annots(2);
        assert_eq!(second.len(), 2);
        assert_eq!(second[1].get(b"Subtype").unwrap(), &name("Text"));
    }

    /// Each line of main.tex prints 14 points below the last, from 100 down, on page 1; line 50
    /// and on, on page 2; other files print nowhere.
    fn locate(file: &str, line: u32) -> Option<crate::synctex::PdfRect> {
        (file == "main.tex").then_some(crate::synctex::PdfRect {
            page: if line < 50 { 1 } else { 2 },
            x: 72.0,
            y: 100.0 + 14.0 * (line % 50) as f64,
            width: 400.0,
            height: 10.0,
        })
    }

    #[test]
    fn open_comments_become_notes_with_their_replies() {
        let comment = |text: &str, line: u32, resolved: bool| crate::comments::Comment {
            id: text.into(),
            path: "main.tex".into(),
            anchor: crate::comments::Anchor {
                quote: "w".into(),
                before: String::new(),
                after: String::new(),
                line,
            },
            author_id: "a".into(),
            author_name: "Lina".into(),
            created_at: String::new(),
            text: text.into(),
            resolved,
            deleted: false,
            updated_at: String::new(),
            placed_at: String::new(),
            replies: vec![crate::comments::Reply {
                id: "r".into(),
                author_id: "b".into(),
                author_name: "Sam".into(),
                created_at: String::new(),
                text: "Agreed".into(),
            }],
        };
        let notes = comment_notes(
            &[comment("Check this", 3, false), comment("Done", 4, true)],
            &locate,
        );
        assert_eq!(notes.len(), 1);
        assert_eq!((notes[0].page, notes[0].y), (1, 142.0));
        assert_eq!(notes[0].text, "Check this\n\nSam: Agreed");
        assert_eq!(notes[0].author, "Lina");
    }

    #[test]
    fn changes_are_marked_in_runs_with_what_was_there() {
        use crate::diff::Block;
        let change = |new_start: u32, old: &str, new: &str| Block::Change {
            old_start: new_start,
            new_start,
            old_text: old.into(),
            new_text: new.into(),
            segments: Vec::new(),
        };
        let diff = crate::history::FileDiff {
            path: "main.tex".into(),
            blocks: vec![
                Block::Equal {
                    new_start: 1,
                    text: "a\n".into(),
                },
                // Three lines rewritten, running over onto the next page.
                change(48, "old one\nold two\n", "new 48\nnew 49\nnew 50\n"),
                change(60, "", "added\n"),
                change(70, "gone for good\n", ""),
            ],
            binary: false,
        };
        let notes = change_notes(&[diff], "Draft 2", &locate);
        let kinds: Vec<(NoteKind, u32)> = notes.iter().map(|n| (n.kind, n.page)).collect();
        assert_eq!(
            kinds,
            [
                (NoteKind::Changed, 1),
                (NoteKind::Changed, 2),
                (NoteKind::Changed, 2),
                (NoteKind::Removed, 2)
            ]
        );
        // Lines 48 and 49 make one run, as tall as both.
        assert_eq!((notes[0].y, notes[0].height), (100.0 + 14.0 * 48.0, 24.0));
        assert_eq!(
            notes[0].text,
            "Changed since Draft 2. It was:\nold one\nold two"
        );
        assert_eq!(notes[2].text, "Written since Draft 2.");
        assert_eq!(notes[3].text, "Taken out since Draft 2:\ngone for good");
        // A file that is not in the PDF has no notes.
        let elsewhere = crate::history::FileDiff {
            path: "notes.txt".into(),
            blocks: vec![change(1, "", "x\n")],
            binary: false,
        };
        assert!(change_notes(&[elsewhere], "Draft 2", &locate).is_empty());
    }

    #[test]
    fn notes_are_added_to_those_a_page_has_and_a_broken_pdf_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("main.pdf");
        pdf(&from, 1);
        let once = tmp.path().join("once.pdf");
        annotate(&from, &once, &[note(1, NoteKind::Comment, "one")]).unwrap();
        let twice = tmp.path().join("twice.pdf");
        annotate(&once, &twice, &[note(1, NoteKind::Changed, "two")]).unwrap();
        let doc = Document::load(&twice).unwrap();
        let page = doc.get_pages()[&1];
        let count = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Annots")
            .and_then(Object::as_array)
            .unwrap()
            .len();
        assert_eq!(count, 2);
        let broken = tmp.path().join("broken.pdf");
        std::fs::write(&broken, b"%PDF-1.5 not really").unwrap();
        assert_eq!(
            annotate(&broken, &tmp.path().join("x.pdf"), &[])
                .unwrap_err()
                .code(),
            "pdf_failed"
        );
        assert!(!tmp.path().join("x.pdf").exists());
    }
}
