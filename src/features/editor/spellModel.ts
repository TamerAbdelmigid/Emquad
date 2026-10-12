// Which words of a LaTeX source are prose, and so worth checking for spelling. Worked out from
// the text alone: commands, their technical arguments, mathematics, comments and the preamble
// are left out.
import { closingBrace } from "./visualModel";

export interface Word {
  from: number;
  to: number;
  word: string;
}

/** Commands whose arguments are names, keys, paths or code rather than prose. */
const TECHNICAL = new Set([
  "documentclass", "usepackage", "RequirePackage", "begin", "end", "label", "ref", "eqref", "pageref", "autoref", "cref", "Cref",
  "nameref", "cite", "citep", "citet", "citeauthor", "citeyear", "nocite", "parencite", "textcite", "autocite", "footcite",
  "bibliography", "bibliographystyle", "addbibresource", "input", "include", "includeonly", "includegraphics", "graphicspath",
  "url", "href", "hyperref", "newcommand", "renewcommand", "providecommand", "newenvironment", "renewenvironment", "def",
  "DeclareMathOperator", "newtheorem", "theoremstyle", "setlength", "addtolength", "setcounter", "addtocounter", "vspace", "hspace",
  "color", "textcolor", "colorbox", "definecolor", "pagestyle", "thispagestyle", "pagenumbering", "fontsize", "selectfont",
  "texttt", "verb", "lstinline", "mintinline", "lstinputlisting", "inputminted", "hypersetup", "geometry", "usetikzlibrary",
  "tikzset", "pgfplotsset", "captionsetup", "multicolumn", "multirow", "rule", "raisebox", "parbox", "resizebox", "scalebox",
  "bibitem", "newcounter", "numberwithin", "si", "SI", "unit", "qty", "num", "ce", "gls", "Gls", "glspl", "acrshort", "acrlong", "ac",
]);
/** Of those, the ones whose last argument is prose after all. */
const LAST_IS_PROSE = new Set(["href", "textcolor", "colorbox", "multicolumn", "multirow", "parbox", "resizebox", "scalebox", "raisebox", "hyperref"]);
const VERBATIM = /\\begin\{(verbatim\*?|lstlisting|minted|comment|filecontents\*?|tikzpicture|algorithmic|algorithm)\}[\s\S]*?(?:\\end\{\1\}|$)/g;
const MATH_ENV = /\\begin\{((?:equation|align|alignat|gather|multline|eqnarray|flalign|math)\*?|displaymath)\}[\s\S]*?(?:\\end\{\1\}|$)/g;
const WORD = /(?<![\p{L}\p{N}_@\\'’-])\p{L}[\p{L}'’]*(?![\p{L}\p{N}_@])/gu;

/** The prose words of `text`, in order. */
export function spellWords(text: string): Word[] {
  // Everything that is not prose is blanked out, keeping every offset where it was.
  const chars = Array.from({ length: text.length }, (_, i) => text[i]);
  const blank = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(to, chars.length); i++) if (chars[i] !== "\n") chars[i] = " ";
  };
  const current = () => chars.join("");

  for (const m of text.matchAll(/(?<!\\)%.*$/gm)) blank(m.index, m.index + m[0].length);

  // The preamble is set-up. Its title is the one part a reader sees.
  const begin = text.indexOf("\\begin{document}");
  if (begin > 0) {
    const keep: [number, number][] = [];
    for (const m of text.slice(0, begin).matchAll(/\\(?:title|author|date)\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const end = closingBrace(text, open);
      if (end > 0 && end <= begin) keep.push([open + 1, end - 1]);
    }
    let at = 0;
    for (const [from, to] of keep.sort((a, b) => a[0] - b[0])) {
      blank(at, from);
      at = Math.max(at, to);
    }
    blank(at, begin);
  }

  for (const m of current().matchAll(VERBATIM)) blank(m.index, m.index + m[0].length);
  for (const m of current().matchAll(/\\(?:verb|lstinline)\*?([^a-zA-Z\s])[^\n]*?\1/g)) blank(m.index, m.index + m[0].length);
  for (const pattern of [MATH_ENV, /\\\[[\s\S]*?(?:\\\]|$)/g, /\$\$[\s\S]*?(?:\$\$|$)/g]) {
    for (const m of current().matchAll(pattern)) blank(m.index, m.index + m[0].length);
  }
  // Inline mathematics, \( \) and $ $ on one line. These are walked by hand, each character
  // looked at once, so that a line of unclosed openers cannot make the scan crawl.
  {
    const text = current();
    for (const [open, close] of [["\\(", "\\)"], ["$", "$"]]) {
      let nextClose = -1;
      let lineEnd = -1;
      for (let at = text.indexOf(open); at >= 0; ) {
        if (open === "$" && text[at - 1] === "\\") {
          at = text.indexOf(open, at + 1);
          continue;
        }
        const from = at + open.length;
        if (lineEnd < from) lineEnd = text.indexOf("\n", from) < 0 ? text.length : text.indexOf("\n", from);
        if (nextClose < from) {
          nextClose = text.indexOf(close, from);
          while (close === "$" && nextClose > 0 && text[nextClose - 1] === "\\") nextClose = text.indexOf(close, nextClose + 1);
          if (nextClose < 0) break;
        }
        if (nextClose > lineEnd || nextClose === from) {
          // Not closed on this line: nothing to leave out here. Carry on after the line.
          at = text.indexOf(open, Math.max(from, nextClose === from ? from + close.length : lineEnd));
          continue;
        }
        blank(at, nextClose + close.length);
        at = text.indexOf(open, nextClose + close.length);
      }
    }
  }

  // Commands: the name always goes, and so do the arguments of the technical ones.
  const now = current();
  for (const m of now.matchAll(/\\([a-zA-Z@]+)\*?/g)) {
    let at = m.index + m[0].length;
    blank(m.index, at);
    const technical = TECHNICAL.has(m[1]);
    // Options in square brackets are settings, whatever the command.
    const skipSpace = () => {
      while (now[at] === " " || now[at] === "\t") at++;
    };
    const option = () => {
      skipSpace();
      if (now[at] !== "[") return false;
      const close = now.indexOf("]", at);
      const lineEnd = now.indexOf("\n\n", at);
      if (close < 0 || (lineEnd >= 0 && lineEnd < close)) return false;
      blank(at, close + 1);
      at = close + 1;
      return true;
    };
    while (option());
    if (!technical) continue;
    const groups: [number, number][] = [];
    for (;;) {
      skipSpace();
      if (now[at] !== "{") break;
      const end = closingBrace(now, at);
      if (end < 0) break;
      groups.push([at, end]);
      at = end;
      while (option());
    }
    if (LAST_IS_PROSE.has(m[1])) groups.pop();
    for (const [from, to] of groups) blank(from, to);
  }
  // An accent written as a command breaks its word in two, so the whole word is left alone.
  // Found from the backslash and then widened by hand, never past the previous one, so the
  // work stays in step with the length of the text.
  let done = 0;
  for (const m of now.matchAll(/\\[`'^"~=.]\{?\\?[a-zA-Z]\}?|\\[cHkuv]\{[a-zA-Z]\}/g)) {
    if (m.index < done) continue;
    let from = m.index;
    while (from > done && /\p{L}/u.test(now[from - 1])) from--;
    let to = m.index + m[0].length;
    while (to < now.length && /[\p{L}\\`'^"~=.{}]/u.test(now[to])) to++;
    blank(from, to);
    done = to;
  }
  // What is left of other commands: a backslash and one character, such as \& or \%.
  for (const m of now.matchAll(/\\[^a-zA-Z\s]/g)) blank(m.index, m.index + 2);

  const out: Word[] = [];
  for (const m of current().matchAll(WORD)) {
    const word = m[0].replace(/['’]+$/, "");
    if (word.length < 2) continue;
    out.push({ from: m.index, to: m.index + word.length, word });
  }
  return out;
}

/** Words that are not judged: abbreviations in capitals and names written in mixed case. */
export function skipWord(word: string): boolean {
  return word === word.toUpperCase() || /\p{Ll}\p{Lu}/u.test(word);
}
