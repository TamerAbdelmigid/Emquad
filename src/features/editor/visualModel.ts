// What visual mode shows differently from the plain source, worked out from the text alone.
// The source is never changed: these are only instructions for drawing it.

export type Piece =
  /** Do not draw this range (a command name, a brace). */
  | { kind: "hide"; from: number; to: number }
  /** Draw this range with a style: a heading, bold, a reference chip and so on. */
  | { kind: "style"; from: number; to: number; style: string }
  /** Draw this range as typeset mathematics. */
  | { kind: "math"; from: number; to: number; tex: string; display: boolean }
  /** Draw this range, a whole tabular environment, as a table. */
  | { kind: "table"; from: number; to: number; rows: Row[] }
  /** Draw this range, an \includegraphics command, as the picture it names. */
  | { kind: "image"; from: number; to: number; path: string }
  /** Draw this range, a citation command, as the references it names. */
  | { kind: "cite"; from: number; to: number; keys: string[] }
  /** Draw this range as a list bullet. */
  | { kind: "bullet"; from: number; to: number }
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
const CHIPS = new Set(["label", "ref", "eqref", "pageref", "footnote", "includegraphics", "input", "include", ...CITES]);
const MATH_ENV = /\\begin\{((?:equation|align|gather|multline)\*?|displaymath)\}([\s\S]*?)\\end\{\1\}/g;

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
 * The pieces to draw for `text`. A construct the cursor or selection touches is left as plain
 * source, so what is being edited is always shown as it really is.
 */
export function visualPieces(text: string, selection: Range[]): Piece[] {
  const pieces: Piece[] = [];
  const touched = (from: number, to: number) => selection.some((r) => r.from <= to && r.to >= from);
  const lineStart = (at: number) => text.lastIndexOf("\n", at - 1) + 1;
  // Ranges already claimed by mathematics or a comment, which nothing else may draw into.
  const taken: Range[] = [];
  const free = (from: number, to: number) => !taken.some((r) => r.from < to && r.to > from);

  // Comments first: nothing inside one is a command.
  for (const m of text.matchAll(/(?<!\\)%.*$/gm)) taken.push({ from: m.index, to: m.index + m[0].length });

  const begin = text.indexOf("\\begin{document}");
  if (begin > 0) {
    // The preamble is set-up, not content: draw it quietly.
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
    const end = at < 0 ? -1 : text.indexOf(close, at);
    // A comment inside a table is part of it; a table that is itself commented out is not one.
    if (end < 0 || !free(from, from + 1)) continue;
    const to = end + close.length;
    const rows = tableRows(text.slice(at, end));
    if (touched(from, to) || rows.length === 0 || to - from > 20_000) continue;
    taken.push({ from, to });
    pieces.push({ kind: "table", from, to, rows });
  }

  const math = (from: number, to: number, tex: string, display: boolean) => {
    if (!free(from, to) || !tex.trim()) return;
    taken.push({ from, to });
    if (!touched(from, to)) pieces.push({ kind: "math", from, to, tex: tex.trim(), display });
  };

  // Display mathematics in environments, \[ \] and $$ $$.
  // Only mathematics environments are looked for, so an enclosing one such as `document`
  // cannot swallow them.
  for (const m of text.matchAll(MATH_ENV)) {
    const body = m[2].replace(/\\label\{[^}]*\}/g, "");
    const aligned = /^(align|gather|multline)/.test(m[1]);
    math(m.index, m.index + m[0].length, aligned ? `\\begin{aligned}${body}\\end{aligned}` : body, true);
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

    if (name in HEADINGS || name in INLINE) {
      const style = HEADINGS[name] ?? INLINE[name];
      if (name in HEADINGS) pieces.push({ kind: "line", from: lineStart(from), style });
      if (end - 1 > open + 1) pieces.push({ kind: "style", from: open + 1, to: end - 1, style });
      if (!touched(from, end)) {
        pieces.push({ kind: "hide", from, to: open + 1 });
        pieces.push({ kind: "hide", from: end - 1, to: end });
      }
    } else if (name === "includegraphics" && !touched(from, end) && text.slice(open + 1, end - 1).trim()) {
      pieces.push({ kind: "image", from, to: end, path: text.slice(open + 1, end - 1).trim() });
    } else if (CITES.has(name) && !touched(from, end)) {
      const keys = text.slice(open + 1, end - 1).split(",").map((k) => k.trim()).filter(Boolean);
      if (keys.length) pieces.push({ kind: "cite", from, to: end, keys });
      else pieces.push({ kind: "style", from, to: end, style: "chip" });
    } else if (CHIPS.has(name)) {
      pieces.push({ kind: "style", from, to: end, style: "chip" });
    } else if (name === "begin" || name === "end") {
      pieces.push({ kind: "style", from, to: end, style: "env" });
    }
  }

  // List items.
  for (const m of text.matchAll(/\\item\b[ \t]?/g)) {
    const from = m.index;
    const to = from + m[0].length;
    if (free(from, to) && !touched(from, to)) pieces.push({ kind: "bullet", from, to });
  }
  return pieces;
}

export interface References {
  citeKeys: string[];
  citations: { key: string; authors: string; year: string; title: string }[];
}

/** How a citation reads in the text, and what it stands for. */
export function describeCitation(keys: string[], index: References) {
  let unknown = false;
  const details: string[] = [];
  const names = keys.map((key) => {
    const found = index.citations.find((c) => c.key === key);
    if (found) {
      details.push([found.authors, found.year, found.title].filter(Boolean).join(". ") || key);
      return [found.authors, found.year].filter(Boolean).join(" ") || key;
    }
    if (index.citeKeys.includes(key)) return key;
    unknown = true;
    details.push(`No reference called ${key} was found in this project`);
    return `${key}?`;
  });
  return { label: `[${names.join("; ")}]`, detail: details.join("\n"), unknown };
}
