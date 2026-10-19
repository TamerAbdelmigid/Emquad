// What visual mode shows differently from the plain source, worked out from the text alone.
// The source is never changed: these are only instructions for drawing it.
import { MATH_NAMES, mathForDrawing } from "./mathEnvironments";

export type Piece =
  /**
   * Do not draw this range (a command name, a brace). The hidden parts of one construct, such as
   * `\textbf{` and its `}`, share a `group`, so an edit can keep or remove them together.
   */
  | { kind: "hide"; from: number; to: number; group: number }
  /** Draw this range with a style: a heading, bold, a reference chip and so on. */
  | { kind: "style"; from: number; to: number; style: string }
  /** Draw this range as typeset mathematics. */
  | { kind: "math"; from: number; to: number; tex: string; display: boolean }
  /** Draw this range, a whole tabular environment, as a table. */
  | { kind: "table"; from: number; to: number; rows: Row[]; source: string }
  /** Draw this range, an \includegraphics command, as the picture it names. */
  | { kind: "image"; from: number; to: number; path: string }
  /** Draw this range, a citation command, as the references it names. */
  | { kind: "cite"; from: number; to: number; keys: string[] }
  /** Draw this range, an \item, as its bullet, or as its number in a numbered list. */
  | { kind: "bullet"; from: number; to: number; label?: string }
  /** Draw this range, a \ref and the like, as what the PDF prints for it. */
  | { kind: "ref"; from: number; to: number; command: string; keys: string[] }
  /** Draw this range, a \footnote, as its number raised, with its text to read on hover. */
  | { kind: "footnote"; from: number; to: number; number: number; text: string }
  /** Draw this range, a command that makes something of its own, as a labelled block. */
  | { kind: "block"; from: number; to: number; label: string }
  /** Draw this range, the preamble, folded away as one line. */
  | { kind: "fold"; from: number; to: number; title: string }
  /** Style the whole line that starts at `from`. */
  | { kind: "line"; from: number; style: string };

export interface Cell {
  tex: string;
  /** How many columns the cell covers. */
  span: number;
}

export interface Row {
  cells: Cell[];
  /** A horizontal rule is drawn above, or below, this row. */
  ruleAbove: boolean;
  ruleBelow: boolean;
}

export interface Range {
  from: number;
  to: number;
}

const HEADINGS: Record<string, string> = {
  title: "title",
  part: "h1",
  chapter: "h1",
  section: "h1",
  subsection: "h2",
  subsubsection: "h3",
  paragraph: "h3",
};
const INLINE: Record<string, string> = {
  textbf: "bold",
  textit: "italic",
  emph: "italic",
  texttt: "mono",
  underline: "underline",
  caption: "caption",
};
const CITES = new Set(["cite", "citep", "citet", "parencite", "textcite", "autocite", "footcite"]);
const TABLE = /\\begin\{(tabular\*?|tabularx|longtable)\}/g;
const RULE = /^\s*(?:\\(?:hline|toprule|midrule|bottomrule)\b|\\(?:cline|cmidrule)(?:\([^)]*\))?\{[^}]*\})/;
const CHIPS = new Set(["label", "includegraphics", "input", "include", ...CITES]);
/** Commands that print what the last compile numbered a label. */
const REFS = new Set(["ref", "eqref", "pageref", "autoref", "cref", "Cref", "vref", "nameref"]);
/** Commands with no argument that make something of their own, and what to call it. */
const BLOCKS: Record<string, string> = {
  maketitle: "Title, author and date",
  tableofcontents: "Table of contents",
  listoffigures: "List of figures",
  listoftables: "List of tables",
  printbibliography: "Bibliography",
  newpage: "Page break",
  clearpage: "Page break",
  pagebreak: "Page break",
};
/** The environments that make lists, and how each level of a numbered one is numbered. */
const LISTS = /\\(begin|end)\{(itemize|enumerate|description)\}/g;
const NUMBERING = [(n: number) => `${n}.`, (n: number) => `(${String.fromCharCode(96 + n)})`, (n: number) => `${roman(n)}.`, (n: number) => `${String.fromCharCode(64 + n)}.`];

function roman(n: number): string {
  const parts: [number, string][] = [[10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, letters] of parts) {
    while (n >= value) {
      out += letters;
      n -= value;
    }
  }
  return out;
}

/** Where the document's body begins: its \\begin{document}, not one written in a comment. -1 when there is none. */
export function documentStart(text: string): number {
  for (const m of text.matchAll(/\\begin\{document\}/g)) {
    const lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
    if (!/(?<!\\)%/.test(text.slice(lineStart, m.index))) return m.index;
  }
  return -1;
}

/** Text with its commands and braces taken out, as a tooltip shows it. */
export function plainText(tex: string): string {
  return tex
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, "")
    .replace(/[{}$~]/g, (c) => (c === "~" ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}
const MATH_ENV = new RegExp(String.raw`\\begin\{(${MATH_NAMES})\}([\s\S]*?)\\end\{\1\}`, "g");

/** Offset just past the brace that closes the one at `open`, or -1 if it never closes. */
export function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
    else if (c === "\n" && text[i + 1] === "\n") return -1; // a blank line ends any argument
  }
  return -1;
}

/** The rows of a table, from what is written between \begin{tabular}{...} and \end{tabular}. */
export function tableRows(body: string): Row[] {
  const rows: Row[] = [];
  const chunks = body.replace(/(?<!\\)%.*$/gm, "").split(/\\\\(?:\[[^\]]*\])?/);
  for (let chunk of chunks) {
    let ruleAbove = false;
    for (let m = RULE.exec(chunk); m; m = RULE.exec(chunk)) {
      ruleAbove = true;
      chunk = chunk.slice(m[0].length);
    }
    if (!chunk.trim()) {
      // Rules after the last row belong under it.
      if (ruleAbove && rows.length) rows[rows.length - 1].ruleBelow = true;
      continue;
    }
    const cells = chunk.split(/(?<!\\)&/).map((raw): Cell => {
      const tex = raw.trim();
      const multi = /^\\multicolumn\s*\{(\d+)\}\s*\{[^}]*\}\s*\{/.exec(tex);
      if (multi) {
        const end = closingBrace(tex, multi[0].length - 1);
        if (end > 0) return { tex: tex.slice(multi[0].length, end - 1).trim(), span: Math.max(1, Math.min(50, Number(multi[1]))) };
      }
      return { tex, span: 1 };
    });
    rows.push({ cells, ruleAbove, ruleBelow: false });
  }
  return rows;
}

/**
 * Stretches of text, none overlapping another, kept in order so that whether a new one is free
 * is found by halving rather than by looking at every one: a long document has thousands.
 */
class Taken {
  private froms: number[] = [];
  private tos: number[] = [];
  /** The place of the first stretch that ends after `at`. */
  private after(at: number): number {
    let [lo, hi] = [0, this.tos.length];
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.tos[mid] > at) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
  free(from: number, to: number): boolean {
    const i = this.after(from);
    return i >= this.froms.length || this.froms[i] >= to;
  }
  /** Take a stretch. One that overlaps stretches already taken is joined with them. */
  add(from: number, to: number) {
    const i = this.after(from);
    let j = i;
    while (j < this.froms.length && this.froms[j] < to) j++;
    this.froms.splice(i, j - i, j > i ? Math.min(from, this.froms[i]) : from);
    this.tos.splice(i, j - i, j > i ? Math.max(to, this.tos[j - 1]) : to);
  }
}

/**
 * The pieces to draw for `text`. A construct the cursor or selection touches is left as plain
 * source, so what is being edited is always shown as it really is.
 */
export function visualPieces(text: string, selection: Range[], report?: { touched: boolean }): Piece[] {
  const pieces: Piece[] = [];
  let footnotes = 0;
  const chapters = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{\s*(?:report|book|memoir|scrbook|scrreprt)\s*\}/.test(text);
  // Whether the selection made any construct show as source, for `report`: when it made none,
  // moving it elsewhere that touches nothing draws the same pieces.
  const touched = (from: number, to: number) => {
    const hit = selection.some((r) => r.from <= to && r.to >= from);
    if (hit && report) report.touched = true;
    return hit;
  };
  const lineStart = (at: number) => text.lastIndexOf("\n", at - 1) + 1;
  // Ranges already claimed by mathematics or a comment, which nothing else may draw into.
  const taken = new Taken();
  const free = (from: number, to: number) => taken.free(from, to);

  // Comments first: nothing inside one is a command.
  for (const m of text.matchAll(/(?<!\\)%.*$/gm)) taken.add(m.index, m.index + m[0].length);

  const begin = documentStart(text);
  // The preamble is set-up, not content: folded away into one line, unless the cursor is in it.
  const foldTo = begin < 0 ? -1 : begin + "\\begin{document}".length;
  const folded = begin > 0 && !touched(0, foldTo);
  if (folded) {
    const title = /\\title\s*(?:\[[^\]]*\])?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/.exec(text.slice(0, begin));
    pieces.push({ kind: "fold", from: 0, to: foldTo, title: title ? plainText(title[1]) : "" });
    taken.add(0, foldTo);
  } else if (begin > 0) {
    // Shown, but quietly.
    for (let at = 0; at < begin; at = text.indexOf("\n", at) + 1 || begin) {
      // The title is content even though it is written in the preamble.
      if (!text.startsWith("\\title", at)) pieces.push({ kind: "line", from: at, style: "preamble" });
      if (text.indexOf("\n", at) < 0) break;
    }
  }

  // Tables first: one that is drawn covers everything inside it. One being edited is left as
  // source, with whatever it contains drawn as usual.
  for (const m of text.matchAll(TABLE)) {
    const from = m.index;
    let at = from + m[0].length;
    // The column layout, after a width for the kinds of table that take one.
    for (let groups = m[1] === "tabular" || m[1] === "longtable" ? 1 : 2; groups > 0; groups--) {
      if (text[at] === "[") at = text.indexOf("]", at) + 1 || at;
      at = text[at] === "{" ? closingBrace(text, at) : -1;
      if (at < 0) break;
    }
    const close = `\\end{${m[1]}}`;
    // The end that matches, past any table of the same kind inside this one.
    let end = -1;
    for (let depth = 1, i = at; at >= 0 && i >= 0 && i < text.length; ) {
      const open = text.indexOf(m[0], i);
      const shut = text.indexOf(close, i);
      if (shut < 0) break;
      if (open >= 0 && open < shut) {
        depth++;
        i = open + m[0].length;
      } else if (--depth === 0) {
        end = shut;
        break;
      } else i = shut + close.length;
    }
    // A comment inside a table is part of it; a table that is itself commented out is not one.
    if (end < 0 || !free(from, from + 1)) continue;
    const to = end + close.length;
    const rows = tableRows(text.slice(at, end));
    // A table gives way to its source only when the cursor is put inside it: it is edited
    // where it is drawn, so merely passing it with the cursor must not take it away.
    const inside = selection.some((r) => r.from < to && r.to > from);
    if (inside && report) report.touched = true;
    if (inside || rows.length === 0 || to - from > 20_000) continue;
    taken.add(from, to);
    pieces.push({ kind: "table", from, to, rows, source: text.slice(from, to) });
  }

  const math = (from: number, to: number, tex: string, display: boolean) => {
    if (!free(from, to) || !tex.trim()) return;
    taken.add(from, to);
    if (!touched(from, to)) pieces.push({ kind: "math", from, to, tex: tex.trim(), display });
  };

  // Display mathematics in environments, \[ \] and $$ $$.
  // Only mathematics environments are looked for, so an enclosing one such as `document`
  // cannot swallow them.
  for (const m of text.matchAll(MATH_ENV)) {
    const drawn = mathForDrawing(m[1], m[2].replace(/\\label\{[^}]*\}/g, ""));
    math(m.index, m.index + m[0].length, drawn.tex, drawn.display);
  }
  for (const m of text.matchAll(/\\\[([\s\S]*?)\\\]/g)) math(m.index, m.index + m[0].length, m[1], true);
  for (const m of text.matchAll(/\$\$([\s\S]*?)\$\$/g)) math(m.index, m.index + m[0].length, m[1], true);
  // Inline mathematics: \( \) and $ $ on one line.
  for (const m of text.matchAll(/\\\(([^\n]*?)\\\)/g)) math(m.index, m.index + m[0].length, m[1], false);
  for (const m of text.matchAll(/(?<![\\$])\$(?!\$)((?:\\.|[^$\\\n])+?)\$/g)) math(m.index, m.index + m[0].length, m[1], false);

  // Commands with one braced argument.
  for (const m of text.matchAll(/\\([a-zA-Z]+)\*?(?:\[[^\]\n]*\])?\{/g)) {
    const name = m[1];
    const from = m.index;
    const open = from + m[0].length - 1;
    if (!free(from, open + 1)) continue;
    if (begin >= 0 && from < begin && name !== "title") continue;
    const end = closingBrace(text, open);
    if (end < 0) continue;
    // What replaces the whole command must not cover anything drawn already, such as a formula
    // in it; what only styles its text, as a heading or bold does, may hold one.
    const whole = free(from, end);
    // Footnotes are numbered as the PDF numbers them: every one, drawn or not, and afresh with
    // each chapter where the class has chapters.
    if (name === "footnote") footnotes++;
    if (name === "chapter" && chapters) footnotes = 0;

    if (name in HEADINGS || name in INLINE) {
      const style = HEADINGS[name] ?? INLINE[name];
      if (name in HEADINGS) pieces.push({ kind: "line", from: lineStart(from), style });
      if (end - 1 > open + 1) pieces.push({ kind: "style", from: open + 1, to: end - 1, style });
      if (!touched(from, end)) {
        pieces.push({ kind: "hide", from, to: open + 1, group: from });
        pieces.push({ kind: "hide", from: end - 1, to: end, group: from });
      }
    } else if (name === "includegraphics" && !touched(from, end) && text.slice(open + 1, end - 1).trim()) {
      pieces.push({ kind: "image", from, to: end, path: text.slice(open + 1, end - 1).trim() });
    } else if (CITES.has(name) && !touched(from, end)) {
      const keys = text.slice(open + 1, end - 1).split(",").map((k) => k.trim()).filter(Boolean);
      if (keys.length) pieces.push({ kind: "cite", from, to: end, keys });
      else pieces.push({ kind: "style", from, to: end, style: "chip" });
    } else if (REFS.has(name) && whole && !touched(from, end)) {
      const keys = text.slice(open + 1, end - 1).split(",").map((k) => k.trim()).filter(Boolean);
      if (keys.length) pieces.push({ kind: "ref", from, to: end, command: name, keys });
    } else if (name === "footnote" && whole && !touched(from, end)) {
      pieces.push({ kind: "footnote", from, to: end, number: footnotes, text: plainText(text.slice(open + 1, end - 1)) });
      taken.add(from, end);
    } else if ((name === "bibliography" || name === "addbibresource") && from > begin && whole && !touched(from, end)) {
      pieces.push({ kind: "block", from, to: end, label: "Bibliography" });
    } else if (CHIPS.has(name) || REFS.has(name) || name === "footnote") {
      pieces.push({ kind: "style", from, to: end, style: "chip" });
    } else if (name === "begin" || name === "end") {
      pieces.push({ kind: "style", from, to: end, style: "env" });
    }
  }

  // Commands that make something of their own, such as the title or the table of contents.
  for (const m of text.matchAll(/\\([a-zA-Z]+)(?![a-zA-Z@])\*?/g)) {
    const label = BLOCKS[m[1]];
    const [from, to] = [m.index, m.index + m[0].length];
    if (label && from > begin && free(from, to) && !touched(from, to)) pieces.push({ kind: "block", from, to, label });
  }

  // Lists: each item drawn as its bullet or number, and the lines that only begin and end a list
  // left out, as a word processor shows a list. They are left out as a pair or not at all: one
  // hidden without the other could be deleted, or kept, without its partner.
  const lists: { kind: string; count: number; line: Range | null }[] = [];
  const listLines: Piece[] = [];
  const marks = [...text.matchAll(LISTS), ...text.matchAll(/\\item\b[ \t]?/g)].sort((a, b) => a.index - b.index);
  for (const m of marks) {
    const [from, to] = [m.index, m.index + m[0].length];
    if (!free(from, to)) continue;
    if (m[1] === "begin" || m[1] === "end") {
      const lineFrom = lineStart(from);
      const lineEnd = text.indexOf("\n", to);
      const lineTo = lineEnd < 0 ? text.length : lineEnd;
      const alone = /^[ \t]*$/.test(text.slice(lineFrom, from)) && /^(?:\[[^\]\n]*\])?[ \t]*$/.test(text.slice(to, lineTo));
      const line = alone && lineEnd >= 0 && !touched(lineFrom, lineTo) ? { from: lineFrom, to: lineTo + 1 } : null;
      if (m[1] === "begin") lists.push({ kind: m[2], count: 0, line });
      else if (lists[lists.length - 1]?.kind === m[2]) {
        const begin = lists.pop()!.line;
        if (begin && line) listLines.push({ kind: "hide", ...begin, group: begin.from }, { kind: "hide", ...line, group: begin.from });
      }
      continue;
    }
    const list = lists[lists.length - 1];
    if (list) list.count++;
    if (touched(from, to)) continue;
    const depth = lists.filter((l) => l.kind === "enumerate").length;
    const label = list?.kind === "enumerate" ? NUMBERING[(depth - 1) % NUMBERING.length](list.count) : list?.kind === "description" ? "" : undefined;
    pieces.push({ kind: "bullet", from, to, ...(label !== undefined ? { label } : {}) });
  }
  pieces.push(...listLines.sort((a, b) => (a as Range).from - (b as Range).from));
  return pieces;
}

export interface References {
  citeKeys: string[];
  citations: { key: string; authors: string; year: string; title: string }[];
}

/** How a citation reads in the text, and what it stands for. */
/** The references of an index by key, made once for each index: a bibliography can be long. */
const byKey = new WeakMap<References["citations"], Map<string, References["citations"][number]>>();
const keySets = new WeakMap<string[], Set<string>>();

export function describeCitation(keys: string[], index: References) {
  let unknown = false;
  const details: string[] = [];
  let found_ = byKey.get(index.citations);
  if (!found_) byKey.set(index.citations, (found_ = new Map(index.citations.map((c) => [c.key, c]))));
  let known = keySets.get(index.citeKeys);
  if (!known) keySets.set(index.citeKeys, (known = new Set(index.citeKeys)));
  const lookup = found_;
  const names = keys.map((key) => {
    const found = lookup.get(key);
    if (found) {
      details.push([found.authors, found.year, found.title].filter(Boolean).join(". ") || key);
      return [found.authors, found.year].filter(Boolean).join(" ") || key;
    }
    if (known.has(key)) return key;
    unknown = true;
    details.push(`No reference called ${key} was found in this project`);
    return `${key}?`;
  });
  return { label: `[${names.join("; ")}]`, detail: details.join("\n"), unknown };
}
