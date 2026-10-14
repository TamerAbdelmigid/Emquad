// LaTeX knowledge that does not depend on the editor widget: the outline and what to complete.

export interface OutlineItem {
  level: number;
  title: string;
  line: number;
}

const LEVELS = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph"];
const SECTION = new RegExp(`\\\\(${LEVELS.join("|")})\\*?\\s*(?:\\[[^\\]]*\\])?\\s*\\{`, "g");

/** Sectioning commands in document order. Commented-out lines are ignored. */
export function outline(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(/(^|[^\\])%.*$/, "$1");
    SECTION.lastIndex = 0;
    for (let m = SECTION.exec(line); m; m = SECTION.exec(line)) {
      // Read the title up to its matching brace so "\section{A {B} C}" stays whole.
      let depth = 1;
      let end = SECTION.lastIndex;
      while (end < line.length && depth > 0) {
        if (line[end] === "{") depth++;
        else if (line[end] === "}") depth--;
        end++;
      }
      const title = line.slice(SECTION.lastIndex, depth === 0 ? end - 1 : end).trim();
      items.push({ level: LEVELS.indexOf(m[1]), title: title || "(untitled)", line: index + 1 });
    }
  });
  return items;
}

export const COMMANDS = [
  "documentclass", "usepackage", "begin", "end", "title", "author", "date", "maketitle",
  "tableofcontents", "part", "chapter", "section", "subsection", "subsubsection", "paragraph",
  "label", "ref", "eqref", "pageref", "cite", "footnote", "caption", "includegraphics", "input",
  "include", "bibliography", "bibliographystyle", "textbf", "textit", "emph", "underline", "texttt",
  "item", "newpage", "clearpage", "noindent", "centering", "hline", "vspace", "hspace", "quad",
  "qquad", "frac", "sqrt", "sum", "int", "prod", "lim", "infty", "partial", "nabla", "alpha",
  "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "pi", "sigma", "phi", "omega",
  "left", "right", "cdot", "times", "leq", "geq", "neq", "approx", "mathbb", "mathcal", "mathrm",
  "newcommand", "renewcommand", "multicolumn", "multirow", "textwidth", "linewidth", "today",
];

export const ENVIRONMENTS = [
  "document", "abstract", "equation", "equation*", "align", "align*", "itemize", "enumerate",
  "description", "figure", "table", "tabular", "center", "quote", "verbatim", "theorem", "proof",
  "lemma", "matrix", "pmatrix", "bmatrix", "cases", "minipage", "thebibliography",
];

export type CompletionKind = "command" | "environment" | "label" | "cite";

export interface CompletionRequest {
  kind: CompletionKind;
  /** Offset in the line where the text being completed starts. */
  from: number;
  typed: string;
}

/** What, if anything, is being typed just before the cursor on this line. */
export function completionAt(lineBeforeCursor: string): CompletionRequest | null {
  const brace = /\\([a-zA-Z]+)\*?\{([^{}]*)$/.exec(lineBeforeCursor);
  if (brace) {
    const [, command, inside] = brace;
    // Lists such as \cite{a,b complete the entry after the last comma.
    const typed = inside.slice(inside.lastIndexOf(",") + 1).trimStart();
    const from = lineBeforeCursor.length - typed.length;
    if (command === "begin" || command === "end") return { kind: "environment", from, typed };
    if (/^(ref|eqref|pageref|autoref|cref|Cref)$/.test(command)) return { kind: "label", from, typed };
    if (/cite/.test(command)) return { kind: "cite", from, typed };
    return null;
  }
  const command = /\\([a-zA-Z]*)$/.exec(lineBeforeCursor);
  if (command) {
    return { kind: "command", from: lineBeforeCursor.length - command[1].length, typed: command[1] };
  }
  return null;
}

// ---------- acting on what is written, as a word processor's tools do ----------

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** Just past the brace that closes the one at `open`, on the same paragraph, or -1. */
function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
    else if (c === "\n" && text[i + 1] === "\n") return -1;
  }
  return -1;
}

/** The heading the line holding `pos` starts with: its level, where its command is, and its title. */
export function headingAt(text: string, pos: number) {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const m = /^[ \t]*\\(part|chapter|section|subsection|subsubsection|paragraph)(\*?)[ \t]*(?:\[[^\]]*\][ \t]*)?\{/.exec(text.slice(lineStart));
  if (!m) return null;
  const open = lineStart + m[0].length - 1;
  const close = closeOf(text, open);
  if (close < 0) return null;
  const nameFrom = lineStart + m[0].indexOf("\\");
  return { level: m[1], nameFrom, nameTo: nameFrom + 1 + m[1].length, start: nameFrom, open, close };
}

/**
 * The changes that make the heading on the line at `pos` one of `level`, or plain text when
 * `level` is null. Null when that line holds no heading.
 */
export function setHeading(text: string, pos: number, level: string | null): TextChange[] | null {
  const at = headingAt(text, pos);
  if (!at) return null;
  if (level) return [{ from: at.nameFrom, to: at.nameTo, insert: `\\${level}` }];
  return [{ from: at.start, to: at.close, insert: text.slice(at.open + 1, at.close - 1) }];
}

/**
 * Bold, italic and the like from a tool: set the selected text in `\name`, or, when it is set in
 * it already, take it out. With nothing selected, the group the cursor is in comes out of it;
 * failing that an empty one goes in for typing. Gives the changes and what to select after.
 */
export function toggleCommand(text: string, from: number, to: number, name: string): { changes: TextChange[]; select: { from: number; to: number } } {
  const head = `\\${name}{`;
  // The selection is the whole command, or exactly its text.
  if (text.startsWith(head, from) && closeOf(text, from + head.length - 1) === to) {
    const inner = text.slice(from + head.length, to - 1);
    return { changes: [{ from, to, insert: inner }], select: { from, to: from + inner.length } };
  }
  if (text.slice(Math.max(0, from - head.length), from) === head && closeOf(text, from - 1) === to + 1) {
    const start = from - head.length;
    return {
      changes: [{ from: start, to: to + 1, insert: text.slice(from, to) }],
      select: { from: start, to: start + (to - from) },
    };
  }
  if (from === to) {
    // The nearest group around the cursor that this command opens.
    let depth = 0;
    for (let i = from - 1; i >= 0 && text[i] !== "\n"; i--) {
      if (text[i] === "}" && text[i - 1] !== "\\") depth++;
      else if (text[i] === "{" && text[i - 1] !== "\\") {
        if (depth > 0) {
          depth--;
          continue;
        }
        const close = closeOf(text, i);
        if (text.slice(i - head.length + 1, i + 1) === head && close > from) {
          const start = i - head.length + 1;
          return { changes: [{ from: start, to: close, insert: text.slice(i + 1, close - 1) }], select: { from: from - head.length, to: from - head.length } };
        }
        break;
      }
    }
  }
  return {
    changes: [{ from, to, insert: `${head}${text.slice(from, to)}}` }],
    select: { from: from + head.length, to: to + head.length },
  };
}
