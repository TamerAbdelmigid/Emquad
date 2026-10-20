//! Reads the SyncTeX file a compile leaves behind and answers the two lookups the app needs:
//! source line to place on the page, and place on the page to source line.
//!
//! Only the parts of the format needed for that are interpreted: the input-file table and the
//! box and point records on each page. Coordinates come out in PDF points from the page's
//! top-left corner.

use crate::error::{Error, Result};
use flate2::read::GzDecoder;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PdfRect {
    /// 1-based page number.
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourcePos {
    pub file: String,
    pub line: u32,
}

/// Where a page of the PDF begins in one source file: the first line set on it.
#[derive(Debug, Clone, Serialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PageStart {
    /// 1-based page number.
    pub page: u32,
    /// 1-based line of the source file.
    pub line: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    HBox,
    VBox,
    Point,
}

#[derive(Debug, Clone)]
struct Rec {
    kind: Kind,
    tag: u32,
    line: u32,
    /// Left edge and baseline, in points from the top-left of the page.
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    d: f64,
    /// Index of the enclosing box on the same page.
    parent: Option<usize>,
}

impl Rec {
    fn top(&self) -> f64 {
        self.y - self.h
    }
    fn bottom(&self) -> f64 {
        self.y + self.d
    }
    fn contains(&self, x: f64, y: f64) -> bool {
        let slack = 1.0;
        x >= self.x - slack
            && x <= self.x + self.w + slack
            && y >= self.top() - slack
            && y <= self.bottom() + slack
    }
}

pub struct SyncTex {
    /// Input tag to project-relative path (forward slashes).
    inputs: HashMap<u32, String>,
    pages: Vec<Vec<Rec>>,
}

fn normalise(raw: &str, cwd: &Path, root: &Path) -> String {
    let raw = raw.trim().replace('\\', "/");
    let path = Path::new(&raw);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    // Drop "." and resolve ".." without touching the disk.
    let mut clean = std::path::PathBuf::new();
    for c in absolute.components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                clean.pop();
            }
            other => clean.push(other),
        }
    }
    let lower = |p: &Path| p.to_string_lossy().replace('\\', "/").to_lowercase();
    let (full, base) = (lower(&clean), lower(root));
    match full.strip_prefix(&base) {
        Some(rest) => {
            let keep = clean.to_string_lossy().replace('\\', "/");
            keep[keep.len() - rest.len()..]
                .trim_start_matches('/')
                .to_string()
        }
        None => clean.to_string_lossy().replace('\\', "/"),
    }
}

impl SyncTex {
    /// `cwd` is the folder the compiler ran in; relative input paths are relative to it.
    pub fn load(file: &Path, cwd: &Path, root: &Path) -> Result<SyncTex> {
        let bytes = fs::read(file).map_err(|_| {
            Error::app(
                "no_synctex",
                "Compile the document first; there is nothing to look up yet",
            )
        })?;
        let mut text = String::new();
        if bytes.starts_with(&[0x1f, 0x8b]) {
            let mut raw = Vec::new();
            GzDecoder::new(bytes.as_slice()).read_to_end(&mut raw)?;
            text = String::from_utf8_lossy(&raw).into_owned();
        } else {
            text.push_str(&String::from_utf8_lossy(&bytes));
        }
        Ok(Self::parse(&text, cwd, root))
    }

    pub fn parse(text: &str, cwd: &Path, root: &Path) -> SyncTex {
        let (mut unit, mut mag, mut x_off, mut y_off) = (1.0f64, 1000.0f64, 0.0f64, 0.0f64);
        let mut inputs = HashMap::new();
        let mut pages: Vec<Vec<Rec>> = Vec::new();
        let mut stack: Vec<usize> = Vec::new();
        let mut in_page = false;

        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("Input:") {
                if let Some((tag, name)) = rest.split_once(':')
                    && let Ok(tag) = tag.parse()
                {
                    inputs.insert(tag, normalise(name, cwd, root));
                }
                continue;
            }
            if !in_page {
                let num = |s: &str| s.trim().parse::<f64>().ok();
                if let Some(v) = line.strip_prefix("Unit:").and_then(num) {
                    unit = v;
                } else if let Some(v) = line.strip_prefix("Magnification:").and_then(num) {
                    mag = v;
                } else if let Some(v) = line.strip_prefix("X Offset:").and_then(num) {
                    x_off = v;
                } else if let Some(v) = line.strip_prefix("Y Offset:").and_then(num) {
                    y_off = v;
                } else if line.starts_with('{') {
                    in_page = true;
                    pages.push(Vec::new());
                    stack.clear();
                }
                continue;
            }
            let Some(first) = line.chars().next() else {
                continue;
            };
            match first {
                '}' => in_page = false,
                ')' | ']' => {
                    stack.pop();
                }
                '(' | '[' | 'h' | 'v' | 'x' | 'k' | 'g' | '$' => {
                    // TeX scaled points to PDF points: 65536 sp per TeX pt, 72.27 TeX pt per inch.
                    let scale = unit * mag / 1000.0 / 65781.76;
                    let Some(mut rec) = parse_record(&line[1..], scale, x_off, y_off) else {
                        continue;
                    };
                    rec.kind = match first {
                        '(' | 'h' => Kind::HBox,
                        '[' | 'v' => Kind::VBox,
                        _ => Kind::Point,
                    };
                    rec.parent = stack.last().copied();
                    let page = pages.last_mut().expect("inside a page");
                    page.push(rec);
                    if first == '(' || first == '[' {
                        stack.push(page.len() - 1);
                    }
                }
                _ => {}
            }
        }
        SyncTex { inputs, pages }
    }

    fn tag_of(&self, file: &str) -> Option<u32> {
        let want = file.replace('\\', "/").to_lowercase();
        self.inputs
            .iter()
            .filter(|(_, path)| path.to_lowercase() == want)
            .map(|(tag, _)| *tag)
            .min()
    }

    /// Where a source line landed. Falls forward to the next line that produced output, since
    /// blank lines, comments and commands often produce none themselves.
    pub fn forward(&self, file: &str, line: u32) -> Option<PdfRect> {
        self.forward_from(file, line).map(|(rect, _)| rect)
    }

    /// The same, with the line whose output was found: `line` itself, or one after it.
    pub fn forward_from(&self, file: &str, line: u32) -> Option<(PdfRect, u32)> {
        let tags: Vec<u32> = {
            let want = file.replace('\\', "/").to_lowercase();
            self.inputs
                .iter()
                .filter(|(_, p)| p.to_lowercase() == want)
                .map(|(t, _)| *t)
                .collect()
        };
        if tags.is_empty() {
            return None;
        }
        let mine = |r: &Rec| tags.contains(&r.tag) && r.kind != Kind::VBox;
        let all = || self.pages.iter().flatten().filter(|r| mine(r));
        let target = all()
            .map(|r| r.line)
            .filter(|l| *l >= line)
            .min()
            .or_else(|| all().map(|r| r.line).max())?;

        for (index, page) in self.pages.iter().enumerate() {
            let mut boxes: Vec<&Rec> = Vec::new();
            for r in page.iter().filter(|r| mine(r) && r.line == target) {
                // A point stands for the line of text it sits in: use its enclosing box.
                let host = match r.kind {
                    Kind::HBox => Some(r),
                    _ => {
                        let mut up = r.parent;
                        loop {
                            match up.map(|i| &page[i]) {
                                Some(p) if p.kind == Kind::HBox => break Some(p),
                                Some(p) => up = p.parent,
                                None => break None,
                            }
                        }
                    }
                };
                if let Some(h) = host.filter(|h| h.w > 0.0) {
                    boxes.push(h);
                }
            }
            if boxes.is_empty() {
                continue;
            }
            let left = boxes.iter().map(|b| b.x).fold(f64::MAX, f64::min);
            let right = boxes.iter().map(|b| b.x + b.w).fold(f64::MIN, f64::max);
            let top = boxes.iter().map(|b| b.top()).fold(f64::MAX, f64::min);
            let bottom = boxes.iter().map(|b| b.bottom()).fold(f64::MIN, f64::max);
            return Some((
                PdfRect {
                    page: index as u32 + 1,
                    x: left,
                    y: top,
                    width: right - left,
                    height: (bottom - top).max(8.0),
                },
                target,
            ));
        }
        None
    }

    /// Where lines `from` to `to` of `file` were set: the box around every line of text they
    /// made on the first page they made any, for drawing a block of LaTeX as it prints. None when
    /// they set nothing.
    pub fn block(&self, file: &str, from: u32, to: u32) -> Option<PdfRect> {
        let want = file.replace('\\', "/").to_lowercase();
        let tags: Vec<u32> = self
            .inputs
            .iter()
            .filter(|(_, p)| p.to_lowercase() == want)
            .map(|(t, _)| *t)
            .collect();
        for (index, page) in self.pages.iter().enumerate() {
            let mut boxes: Vec<&Rec> = Vec::new();
            for r in page.iter().filter(|r| {
                tags.contains(&r.tag) && r.kind != Kind::VBox && (from..=to).contains(&r.line)
            }) {
                // A point stands for the line of text it sits in.
                let mut host = Some(r);
                while let Some(h) = host.filter(|h| h.kind != Kind::HBox) {
                    host = h.parent.map(|i| &page[i]);
                }
                if let Some(h) = host.filter(|h| h.w > 0.0) {
                    boxes.push(h);
                }
            }
            if boxes.is_empty() {
                continue;
            }
            let left = boxes.iter().map(|b| b.x).fold(f64::MAX, f64::min);
            let right = boxes.iter().map(|b| b.x + b.w).fold(f64::MIN, f64::max);
            let top = boxes.iter().map(|b| b.top()).fold(f64::MAX, f64::min);
            let bottom = boxes.iter().map(|b| b.bottom()).fold(f64::MIN, f64::max);
            return Some(PdfRect {
                page: index as u32 + 1,
                x: left,
                y: top,
                width: right - left,
                height: (bottom - top).max(8.0),
            });
        }
        None
    }

    /// The source line behind a point on a page: the smallest box under the point, refined by
    /// the nearest recorded position inside it.
    pub fn inverse(&self, page: u32, x: f64, y: f64) -> Option<SourcePos> {
        let recs = self.pages.get(page.checked_sub(1)? as usize)?;
        let known = |r: &&Rec| self.inputs.contains_key(&r.tag) && r.line > 0;
        let (index, hbox) = recs
            .iter()
            .enumerate()
            .filter(|(_, r)| r.kind == Kind::HBox && r.contains(x, y) && known(r))
            .min_by(|a, b| (a.1.w * (a.1.h + a.1.d)).total_cmp(&(b.1.w * (b.1.h + b.1.d))))
            .or_else(|| {
                // Nothing under the point: take the line of text nearest to it vertically.
                recs.iter()
                    .enumerate()
                    .filter(|(_, r)| r.kind == Kind::HBox && r.w > 0.0 && known(r))
                    .min_by(|a, b| (a.1.y - y).abs().total_cmp(&(b.1.y - y).abs()))
            })?;
        let nearest = recs
            .iter()
            .filter(|r| r.parent == Some(index) && r.kind == Kind::Point && known(r))
            .min_by(|a, b| (a.x - x).abs().total_cmp(&(b.x - x).abs()))
            .unwrap_or(hbox);
        Some(SourcePos {
            file: self.inputs.get(&nearest.tag)?.clone(),
            line: nearest.line,
        })
    }

    /// Where each page with `file`'s text on it begins in the file: the line its text goes on
    /// from, the first of them being the page the file starts on. The text flows down the source
    /// in order, but a picture or a table may be set pages after the line it is written on, and a
    /// footnote at the foot of a page, so each page's first line is taken as the place that
    /// leaves the fewest of the file's records on the wrong side of it. Pages with nothing of the
    /// file on them are left out.
    pub fn page_starts(&self, file: &str) -> Vec<PageStart> {
        let want = file.replace('\\', "/").to_lowercase();
        let tags: Vec<u32> = self
            .inputs
            .iter()
            .filter(|(_, p)| p.to_lowercase() == want)
            .map(|(t, _)| *t)
            .collect();
        // Each page's lines of the file, one entry per record.
        let pages: Vec<Vec<u32>> = self
            .pages
            .iter()
            .map(|page| {
                page.iter()
                    .filter(|r| tags.contains(&r.tag) && r.kind != Kind::VBox && r.line > 0)
                    .map(|r| r.line)
                    .collect()
            })
            .collect();
        let mut lines: Vec<u32> = pages.iter().flatten().copied().collect();
        lines.sort_unstable();
        lines.dedup();
        let slot = |line: u32| lines.binary_search(&line).unwrap_or(0);
        // Records on the pages before the one looked at, and on it and after, by line.
        let mut before = vec![0usize; lines.len()];
        let mut after = vec![0usize; lines.len()];
        for line in pages.iter().flatten() {
            after[slot(*line)] += 1;
        }
        let mut out: Vec<PageStart> = Vec::new();
        for (index, page) in pages.iter().enumerate() {
            if !page.is_empty() {
                // Breaking before line j leaves before[j..] and after[..j] on the wrong side.
                let mut cost: usize = before.iter().sum();
                let (mut best, mut best_cost) = (0, cost);
                for j in 1..lines.len() {
                    cost = cost + after[j - 1] - before[j - 1];
                    if cost < best_cost {
                        (best, best_cost) = (j, cost);
                    }
                }
                let line = lines[best];
                if out.last().is_none_or(|last| line > last.line) {
                    out.push(PageStart {
                        page: index as u32 + 1,
                        line,
                    });
                }
            }
            for line in page {
                before[slot(*line)] += 1;
                after[slot(*line)] -= 1;
            }
        }
        out
    }

    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    pub fn has_file(&self, file: &str) -> bool {
        self.tag_of(file).is_some()
    }
}

/// "tag,line[,column]:h,v[:W,H,D]" with sizes optional.
fn parse_record(body: &str, scale: f64, x_off: f64, y_off: f64) -> Option<Rec> {
    let mut parts = body.split(':');
    let mut link = parts.next()?.split(',');
    let tag = link.next()?.parse().ok()?;
    let line = link.next()?.parse().ok()?;
    let mut point = parts.next()?.split(',');
    let h: f64 = point.next()?.parse().ok()?;
    let v: f64 = point.next()?.parse().ok()?;
    let mut size = parts.next().unwrap_or("").split(',');
    let mut next = || {
        size.next()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0)
    };
    let (w, hh, d) = (next(), next(), next());
    // A negative width means the box was set right to left; keep its left edge on the left.
    let (x, w) = if w < 0.0 { (h + w, -w) } else { (h, w) };
    Some(Rec {
        kind: Kind::Point,
        tag,
        line,
        x: (x + x_off) * scale,
        y: (v + y_off) * scale,
        w: w * scale,
        h: hh * scale,
        d: d * scale,
        parent: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "SyncTeX Version:1
Input:1:/work/paper/./main.tex
Input:2:/work/paper/sections/proof.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!100
{1
[1,10:4736286,47362867:26673152,43417026,0
(1,5:8799518,9000000:26673152,655360,0
x1,5:9000000,9000000
)
(1,7:8799518,11000000:26673152,655360,0
x1,7:9799518,11000000
g1,7:12000000,11000000
x1,8:20000000,11000000
)
(2,3:8799518,13000000:26673152,655360,0
x2,3:9799518,13000000
)
]
!200
}1
{2
[1,10:4736286,47362867:26673152,43417026,0
(2,9:8799518,9000000:26673152,655360,0
x2,9:9000000,9000000
)
]
}2
Postamble:
Count:12
";

    fn sample() -> SyncTex {
        SyncTex::parse(SAMPLE, Path::new("/work/paper"), Path::new("/work/paper"))
    }

    #[test]
    fn reads_inputs_relative_to_the_project_and_all_pages() {
        let s = sample();
        assert_eq!(s.page_count(), 2);
        assert!(s.has_file("main.tex"));
        assert!(s.has_file("sections/proof.tex"));
        assert!(s.has_file("sections\\Proof.tex"));
    }

    #[test]
    fn forward_finds_the_line_box_in_points_from_the_top_left() {
        let r = sample().forward("main.tex", 7).unwrap();
        assert_eq!(r.page, 1);
        // 8799518 sp is about 133.8 pt; the box is 655360 sp (10 TeX pt) tall above its baseline.
        assert!((r.x - 133.77).abs() < 0.1, "{r:?}");
        assert!(
            (r.y - (11000000.0 - 655360.0) / 65781.76).abs() < 0.01,
            "{r:?}"
        );
        assert!((r.width - 26673152.0 / 65781.76).abs() < 0.01);
    }

    #[test]
    fn forward_falls_to_the_next_line_with_output_and_reaches_other_pages() {
        let s = sample();
        assert_eq!(s.forward("main.tex", 6), s.forward("main.tex", 7));
        assert_eq!(s.forward("sections/proof.tex", 4).unwrap().page, 2);
        assert_eq!(s.forward("sections/proof.tex", 1).unwrap().page, 1);
        assert!(s.forward("missing.tex", 1).is_none());
    }

    #[test]
    fn inverse_uses_the_nearest_position_within_the_line() {
        let s = sample();
        let at = |x: f64, v: f64| s.inverse(1, x / 65781.76, v / 65781.76).unwrap();
        assert_eq!(
            at(9900000.0, 10900000.0),
            SourcePos {
                file: "main.tex".into(),
                line: 7
            }
        );
        assert_eq!(
            at(19900000.0, 10900000.0),
            SourcePos {
                file: "main.tex".into(),
                line: 8
            }
        );
        assert_eq!(
            at(9900000.0, 12900000.0),
            SourcePos {
                file: "sections/proof.tex".into(),
                line: 3
            }
        );
        // Below all text on the page: the nearest line still answers.
        assert_eq!(at(9900000.0, 30000000.0).line, 3);
        assert!(s.inverse(9, 0.0, 0.0).is_none());
    }

    /// Three pages of `main.tex`: lines 1 to 9 on the first, a paragraph on line 10 running
    /// over onto the second, which goes on to line 20, a figure from line 15 put at the top of
    /// the third, and lines 21 to 30 under it.
    fn three_pages() -> SyncTex {
        let mut text =
            String::from("SyncTeX Version:1\nInput:1:/p/main.tex\nInput:2:/p/other.tex\nUnit:1\n");
        let page = |text: &mut String, n: u32, lines: &[u32]| {
            text.push_str(&format!("{{{n}\n[1,1:0,0:100,100,0\n"));
            for (i, line) in lines.iter().enumerate() {
                let v = 1000 * (i + 1);
                // Lines from 100 on stand for other.tex's lines 1, 2…
                let (tag, line) = if *line >= 100 {
                    (2, line - 99)
                } else {
                    (1, *line)
                };
                text.push_str(&format!(
                    "({tag},{line}:100,{v}:500,10,0\nx{tag},{line}:100,{v}\n)\n"
                ));
            }
            text.push_str(&format!("]\n}}{n}\n"));
        };
        let first: Vec<u32> = (1..=10).collect();
        let second: Vec<u32> = [10, 10].into_iter().chain(11..=20).collect();
        let third: Vec<u32> = [15].into_iter().chain(21..=30).collect();
        page(&mut text, 1, &first);
        page(&mut text, 2, &second);
        page(&mut text, 3, &third);
        // A fourth page of other.tex alone, brought in after main.tex's text.
        page(&mut text, 4, &[100, 101, 102]);
        SyncTex::parse(&text, Path::new("/p"), Path::new("/p"))
    }

    #[test]
    fn pages_start_where_the_text_goes_on_past_a_float_and_a_paragraph_split_across_them() {
        let s = three_pages();
        assert_eq!(
            s.page_starts("main.tex"),
            vec![
                PageStart { page: 1, line: 1 },
                PageStart { page: 2, line: 10 },
                PageStart { page: 3, line: 21 }
            ]
        );
        // A file set from the fourth page on starts there.
        assert_eq!(
            s.page_starts("other.tex"),
            vec![PageStart { page: 4, line: 1 }]
        );
        assert!(s.page_starts("missing.tex").is_empty());
    }

    #[test]
    fn pages_start_in_the_order_of_the_source_and_skip_pages_without_its_text() {
        let s = sample();
        // The second page holds only proof.tex's line 9, which comes after its line 3 on the first.
        assert_eq!(
            s.page_starts("sections/proof.tex"),
            vec![
                PageStart { page: 1, line: 3 },
                PageStart { page: 2, line: 9 }
            ]
        );
        assert_eq!(
            s.page_starts("main.tex"),
            vec![PageStart { page: 1, line: 5 }]
        );
    }

    #[test]
    fn a_block_of_lines_is_the_box_around_what_they_set_on_their_first_page() {
        let s = sample();
        let one = s.forward("main.tex", 5).unwrap();
        let both = s.block("main.tex", 5, 8).unwrap();
        assert_eq!(both.page, 1);
        assert!((both.y - one.y).abs() < 0.01, "{both:?}");
        // Lines 5 and 7 are set on two lines of text: the box holds both.
        assert!(both.height > one.height + 20.0, "{both:?} {one:?}");
        // Lines that set nothing, and a file not in the compile, have no box.
        assert!(s.block("main.tex", 1, 3).is_none());
        assert!(s.block("missing.tex", 1, 99).is_none());
    }

    #[test]
    fn inverse_of_forward_returns_to_the_same_line() {
        let s = sample();
        for (file, line) in [("main.tex", 5), ("main.tex", 7), ("sections/proof.tex", 9)] {
            let r = s.forward(file, line).unwrap();
            let back = s.inverse(r.page, r.x + 2.0, r.y + r.height / 2.0).unwrap();
            assert_eq!((back.file.as_str(), back.line), (file, line));
        }
    }
}
