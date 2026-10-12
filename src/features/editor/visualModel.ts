// What visual mode shows differently from the plain source, worked out from the text alone.
// The source is never changed: these are only instructions for drawing it.

export type Piece =
  /** Do not draw this range (a command name, a brace). */
  | { kind: "hide"; from: number; to: number }
  /** Draw this range with a style: a heading, bold, a reference chip and so on. */
  | { kind: "style"; from: number; to: number; style: string }
  /** Draw this range as typeset mathematics. */
  | { kind: "math"; from: number; to: number; tex: string; display: boolean }
  /** Draw this range as a list bullet. */
  | { kind: "bullet"; from: number; to: number }
  /** Style the whole line that starts at `from`. */
  | { kind: "line"; from: number; style: string };

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
};
const CHIPS = new Set(["label", "ref", "eqref", "pageref", "cite", "citep", "citet", "footnote", "includegraphics", "input", "include"]);
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
