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
