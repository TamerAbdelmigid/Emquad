// How citations and the list of references look: the BibTeX style a document names, in the
// words a Word user would choose them by. Pure.
import { documentStart } from "./visualModel";

export interface Style {
  id: string;
  label: string;
  /** What a citation looks like in the text. */
  sample: string;
  /** The BibTeX style written in \bibliographystyle. */
  bst: string;
  /** Whether it cites by author and year, which needs the natbib package. */
  natbib: boolean;
}

export const STYLES: Style[] = [
  { id: "numbered", label: "Numbered, in the order cited", sample: "[1]", bst: "unsrt", natbib: false },
  { id: "plain", label: "Numbered, in alphabetical order", sample: "[1]", bst: "plain", natbib: false },
  { id: "ieee", label: "IEEE", sample: "[1]", bst: "ieeetr", natbib: false },
  { id: "authoryear", label: "Author and year (Harvard)", sample: "(Knuth, 1984)", bst: "plainnat", natbib: true },
  { id: "apa", label: "APA", sample: "(Knuth, 1984)", bst: "apalike", natbib: true },
  { id: "alpha", label: "Abbreviated labels", sample: "[Knu84]", bst: "alpha", natbib: false },
];

const STYLE_LINE = /\\bibliographystyle\s*\{([^}]*)\}/;

/** The style a document names now: one of `STYLES`, "other" for a style not among them, or "" for none. */
export function readStyle(text: string): string {
  const code = text.replace(/(?<!\\)%[^\n]*/g, "");
  const bst = STYLE_LINE.exec(code)?.[1].trim();
  if (bst === undefined) return "";
  return STYLES.find((s) => s.bst === bst)?.id ?? "other";
}

/**
 * The changes that give a document `id`'s style: its \bibliographystyle, and natbib in the
 * settings at the top where the style cites by author and year. A document with no
 * \bibliographystyle has one put before its \bibliography. `error` when it has neither, or
 * uses biblatex, whose styles are set otherwise.
 */
export function styleChanges(text: string, id: string): { from: number; to?: number; insert: string }[] | { error: string } {
  const style = STYLES.find((s) => s.id === id);
  if (!style) return { error: "That style is not one Emquad knows." };
  const code = text.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));
  if (/\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b/.test(code)) {
    return { error: "This document uses biblatex, whose style is set in the options of \\usepackage{biblatex}." };
  }
  const changes: { from: number; to?: number; insert: string }[] = [];
  const line = STYLE_LINE.exec(code);
  if (line) {
    const open = line.index + line[0].indexOf("{") + 1;
    changes.push({ from: open, to: open + line[1].length, insert: style.bst });
  } else {
    const bibliography = /\\bibliography\s*\{/.exec(code);
    if (!bibliography) return { error: "This document has no list of references yet: add one with Insert ▸ Bibliography first." };
    changes.push({ from: bibliography.index, insert: `\\bibliographystyle{${style.bst}}\n` });
  }
  const begin = documentStart(text);
  const preamble = begin >= 0 ? code.slice(0, begin) : "";
  if (style.natbib && begin >= 0 && !/\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bnatbib\b/.test(preamble)) {
    changes.push({ from: begin, insert: "\\usepackage{natbib}\n" });
  }
  // natbib, once loaded, puts numbers in round brackets unless told otherwise: a numbered style
  // is given square ones, as the dialog shows it, and an author-and-year style its round ones.
  const natbib = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{\s*natbib\s*\}/.exec(preamble);
  if (natbib) {
    const was = (natbib[1] ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    const options = style.natbib ? was.filter((o) => o !== "square") : [...was.filter((o) => o !== "round" && o !== "square"), "square"];
    if (options.join(",") !== was.join(",")) {
      changes.push({ from: natbib.index, to: natbib.index + natbib[0].length, insert: `\\usepackage${options.length ? `[${options.join(",")}]` : ""}{natbib}` });
    }
  }
  return changes.sort((a, b) => a.from - b.from);
}

/**
 * The command a citation is written with, so that it reads as a Word user expects: in
 * brackets or parentheses after the words it supports. natbib's \cite names the authors in the
 * running text instead, and biblatex cites best with \autocite.
 */
export function citeCommand(text: string): string {
  const code = text.replace(/(?<!\\)%[^\n]*/g, "");
  const begin = documentStart(code);
  const preamble = begin >= 0 ? code.slice(0, begin) : code;
  if (/\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b/.test(preamble)) return "autocite";
  if (/\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bnatbib\b/.test(preamble)) return "citep";
  return "cite";
}
