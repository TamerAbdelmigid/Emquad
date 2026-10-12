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
