// The bridge to LaTeX: commands of the user's own, made from a selection and kept in the settings
// at the top, and the settings' packages explained in plain words with the tool that loads each.
// Pure: each function reads the text and gives what to show or write.
import { COMMANDS, ENVIRONMENTS } from "./latex";
import { settingsLine } from "./tableModel";
import { plainWrapSafe } from "./formatting";
import { closingBrace, documentStart } from "./visualModel";

export interface MyCommand {
  name: string;
  /** What it prints, as LaTeX. */
  body: string;
}

/** The text with comments blanked out, every offset kept. */
const uncommented = (text: string) => text.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));

/** The commands the document defines that take no argument: \newcommand{\name}{…}. */
export function myCommands(text: string): MyCommand[] {
  const code = uncommented(text);
  const out: MyCommand[] = [];
  for (const m of code.matchAll(/\\(?:re)?newcommand\*?\s*(?:\{\s*\\([a-zA-Z]+)\s*\}|\\([a-zA-Z]+))\s*(\[)?/g)) {
    if (m[3]) continue;
    const open = m.index + m[0].length;
    if (code[open] !== "{") continue;
    const close = closingBrace(code, open);
    if (close < 0) continue;
    out.push({ name: m[1] ?? m[2], body: text.slice(open + 1, close - 1) });
  }
  return out;
}

/** Every name the document defines, as a command or an environment, with arguments or not. */
function definedNames(text: string): Set<string> {
  const code = uncommented(text);
  const names = new Set<string>();
  for (const m of code.matchAll(/\\(?:(?:re|provide)?newcommand|DeclareMathOperator|DeclareRobustCommand)\*?\s*\{?\s*\\([a-zA-Z]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\\(?:def|let|edef|gdef)\s*\\([a-zA-Z]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\\(?:re)?newenvironment\*?\s*\{\s*([a-zA-Z]+)\s*\}/g)) names.add(m[1]);
  return names;
}

/** Commands LaTeX, or the tools, already have, which a command of the user's own must not take. */
const TAKEN = new Set([
  ...COMMANDS,
  ...ENVIRONMENTS,
  "figure", "table", "abstract", "document", "itemize", "enumerate", "description", "equation", "center", "quote", "quotation",
  "verse", "tabular", "minipage", "array", "list", "picture", "flushleft", "flushright", "appendix", "thanks", "footnotemark",
  "text", "max", "min", "sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "lg", "exp", "det", "dim", "gcd", "sup", "inf",
  "arg", "deg", "hom", "ker", "Pr", "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan", "liminf", "limsup", "mathbf", "mathit",
  "mathsf", "mathtt", "boldsymbol", "operatorname", "raggedright", "raggedleft", "listoffigures", "listoftables", "printbibliography",
  "phantom", "hbox", "vbox", "mbox", "makebox", "framebox", "fbox", "parbox", "rule", "kern", "hskip", "vskip", "line", "circle",
  "AA", "aa", "AE", "ae", "OE", "oe", "ss",
  "par", "newline", "linebreak", "pagebreak", "textrm", "textsf", "textsc", "textsl", "textup", "textmd", "url", "href",
  "cref", "Cref", "autoref", "nameref", "sout", "uline", "hl", "textcolor", "color", "textsubscript", "textsuperscript",
  "LaTeX", "TeX", "ldots", "dots", "vspace", "hfill", "vfill", "small", "large", "Large", "huge", "Huge", "tiny",
  "footnotesize", "normalsize", "bf", "it", "rm", "sf", "tt", "sc", "em", "relax", "def", "let", "the", "space",
]);

/** Why a new command cannot have this name, or null when it can. */
export function commandProblem(name: string, text: string): string | null {
  if (!name) return "Give the command a name.";
  if (!/^[a-zA-Z]+$/.test(name)) return "A command's name holds letters only, with no spaces or digits.";
  if (definedNames(text).has(name)) return `The document has a command or environment called ${name} already.`;
  // One letter names are LaTeX's own accents and symbols (\c, \S, \L…).
  if (TAKEN.has(name) || name.startsWith("end") || name.length === 1) return `\\${name} is a LaTeX command already; choose another name.`;
  return null;
}

/** Why a command cannot print `body` as it is, or null when it can. */
export function bodyProblem(body: string): string | null {
  if (!body.trim()) return "Say what the command prints.";
  if (/\n/.test(body)) return "What a command prints is written on one line; select words on one line.";
  if (/(?<!\\)%/.test(body)) return "A % would make the rest of the line a comment: write \\% for a percent sign.";
  if (/(?<!\\)#/.test(body)) return "A # stands for an argument in a command: write \\# for the sign itself.";
  if (/\\(?:begin|end|item|par)(?![a-zA-Z])/.test(body)) return "A command made here prints words, not an environment, a list or a paragraph break.";
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") i++;
    else if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth < 0) break;
  }
  if (depth !== 0) return "Its braces do not close: select whole words, not part of a formatting command.";
  return null;
}

/** Commands whose braces hold a name, a key or an address rather than words that print. */
const NAMES_IN = /\\(?:label|ref|eqref|pageref|autoref|nameref|cref|Cref|cite[a-zA-Z]*|[a-z]*cite|input|include|includegraphics|href|url|usepackage|documentclass|begin|end|bibliography|bibliographystyle|addbibresource|newcommand|renewcommand|hypersetup|textcolor|color)\*?\s*(?:\[[^\]]*\]\s*)*\{[^{}]*$/;

/**
 * Whether the selection `from`–`to` of `text` may become the command that prints `body`: it is
 * those words, in the document's text, cutting nothing, and not inside a name or an address.
 */
export function replaceable(text: string, from: number, to: number, body: string): boolean {
  if (from >= to || text.slice(from, to) !== body || !plainWrapSafe(text, from, to)) return false;
  const begin = documentStart(text);
  if (begin >= 0 && from < begin) return false;
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  return !NAMES_IN.test(uncommented(text.slice(lineStart, from)));
}

/** The change that defines \name as `body`, at the end of the settings at the top; null without settings. */
export function defineCommand(text: string, name: string, body: string): { from: number; to: number; insert: string } | null {
  const begin = documentStart(text);
  if (begin < 0) return null;
  return settingsLine(text, `\\newcommand{\\${name}}{${body}}`, begin);
}

/**
 * The lines a block of LaTeX had in the text a compile read, for finding it in that compile's PDF:
 * of the copies of it there, the one nearest `line`, where it is now; null when it has changed.
 */
export function compiledLines(compiled: string, source: string, line: number): { from: number; to: number } | null {
  const lines = source.split("\n").length - 1;
  let best: number | null = null;
  for (let at = compiled.indexOf(source); at >= 0 && source; at = compiled.indexOf(source, at + 1)) {
    const from = compiled.slice(0, at).split("\n").length;
    if (best === null || Math.abs(from - line) < Math.abs(best - line)) best = from;
  }
  return best === null ? null : { from: best, to: best + lines };
}

export interface PackageLine {
  name: string;
  options: string;
  /** The 1-based line it is loaded on. */
  line: number;
  /** What it is for, in plain words; "" for a package the app does not know. */
  what: string;
  /** The tool that loads it, or uses it; "" when none does. */
  by: string;
}

/** What each package the tools load, and the common others, are for. */
const PACKAGES: Record<string, [string, string]> = {
  geometry: ["Page size, margins and orientation", "Layout ▸ Margins, Size, Orientation"],
  setspace: ["Space between lines", "Home ▸ Line spacing"],
  parskip: ["A space between paragraphs instead of an indent", "Layout ▸ First line"],
  lineno: ["Line numbers in the margin, for reviewers", "Layout ▸ Line numbers"],
  fancyhdr: ["The header and footer of each page", "Insert ▸ Header and Footer"],
  graphicx: ["Pictures", "Insert ▸ Picture"],
  float: ["A figure or table exactly where it is written", "Picture ▸ Position ▸ Exactly here"],
  hyperref: ["Links, and a PDF whose references can be clicked", "Insert ▸ Link"],
  cleveref: ["References that name what they point to (“Figure 2”)", "Insert ▸ Cross-reference"],
  ulem: ["Strikethrough and underlines that break across lines", "Home ▸ Strikethrough"],
  soul: ["Highlighting", "Home ▸ Highlight"],
  xcolor: ["Colours, named once", "Home ▸ Font colour"],
  enumitem: ["Numbering formats for lists", "Home ▸ Numbering format"],
  amsmath: ["Mathematics: equations, alignments, matrices", "Insert ▸ Equation"],
  amssymb: ["More mathematical symbols", "Insert ▸ Symbol"],
  mathtools: ["More for amsmath", "Insert ▸ Equation"],
  booktabs: ["Tables with book-style rules", "Table ▸ Borders"],
  multirow: ["Table cells over several rows", "Table ▸ Merge"],
  array: ["More column types in tables", "Table editor"],
  makecell: ["Line breaks inside table cells", "Table editor"],
  tabularx: ["Tables as wide as the line", "Table editor"],
  natbib: ["Author–year citations", "References ▸ Citation style"],
  biblatex: ["Citations and the bibliography, styled", "References ▸ Citation style"],
  babel: ["The document's language: hyphenation and words such as “Contents”", ""],
  inputenc: ["Reading accented letters in the file", ""],
  fontenc: ["Fonts with accented letters", ""],
  newtxtext: ["Times for the text", "Document setup ▸ Typeface"],
  newtxmath: ["Times for mathematics", "Document setup ▸ Typeface"],
  newpxtext: ["Palatino for the text", "Document setup ▸ Typeface"],
  newpxmath: ["Palatino for mathematics", "Document setup ▸ Typeface"],
  caption: ["How captions look", ""],
  subcaption: ["Pictures side by side, each with its caption", ""],
  tikz: ["Drawings written in LaTeX", ""],
  listings: ["Program code", ""],
  url: ["Web addresses", ""],
  textcomp: ["More text symbols", "Insert ▸ Symbol"],
  siunitx: ["Numbers and units", ""],
  microtype: ["Finer spacing of letters", ""],
  wrapfig: ["Text that flows round a picture", ""],
  pdflscape: ["A page on its side, for a wide table", ""],
  multicol: ["Columns for a passage", ""],
};

/** Every package the settings at the top load, each with what it is for and the tool that loads it. */
export function packagesExplained(text: string): PackageLine[] {
  const begin = documentStart(text);
  const code = uncommented(begin < 0 ? text : text.slice(0, begin));
  const out: PackageLine[] = [];
  for (const m of code.matchAll(/\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g)) {
    const line = code.slice(0, m.index).split("\n").length;
    for (const name of m[2].split(",").map((n) => n.trim()).filter(Boolean)) {
      const [what, by] = PACKAGES[name] ?? ["", ""];
      out.push({ name, options: (m[1] ?? "").trim(), line, what, by });
    }
  }
  return out;
}
