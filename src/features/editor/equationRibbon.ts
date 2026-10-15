// The equation editor's ribbon, as Word's Equation tab has it: structures by kind, each written
// around what is selected in the formula, with boxes to fill in. And what the editor's output
// needs before it goes into the document. Pure.
import { ALL_SYMBOLS, CATEGORIES, type Sym } from "./symbols";

/**
 * One structure. `insert` is written into the formula: `#0` stands for what is selected there,
 * `#?` for an empty box to type in, which Tab moves between.
 */
export interface Structure {
  name: string;
  insert: string;
}

export interface StructureGroup {
  id: string;
  label: string;
  /** What the group's button shows. */
  icon: string;
  items: Structure[];
}

const x = (name: string, insert: string): Structure => ({ name, insert });

export const STRUCTURES: StructureGroup[] = [
  {
    id: "fraction",
    label: "Fraction",
    icon: "\\frac{x}{y}",
    items: [
      x("Stacked fraction", "\\frac{#0}{#?}"),
      x("Small fraction", "\\tfrac{#0}{#?}"),
      x("Linear fraction", "#0/#?"),
      x("dy over dx", "\\frac{dy}{dx}"),
      x("Partial derivative", "\\frac{\\partial #0}{\\partial #?}"),
      x("Change over change", "\\frac{\\Delta #0}{\\Delta #?}"),
      x("Pi over 2", "\\frac{\\pi}{2}"),
    ],
  },
  {
    id: "script",
    label: "Script",
    icon: "e^{x}",
    items: [
      x("Superscript", "#0^{#?}"),
      x("Subscript", "#0_{#?}"),
      x("Subscript and superscript", "#0_{#?}^{#?}"),
      x("Left subscript and superscript", "{}_{#?}^{#?}#0"),
      x("x squared", "x^{2}"),
      x("x sub n", "x_{n}"),
      x("e to the minus i omega t", "e^{-i\\omega t}"),
    ],
  },
  {
    id: "radical",
    label: "Radical",
    icon: "\\sqrt[n]{x}",
    items: [
      x("Square root", "\\sqrt{#0}"),
      x("Root of any degree", "\\sqrt[#?]{#0}"),
      x("Cube root", "\\sqrt[3]{#0}"),
      x("Quadratic formula", "\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"),
      x("Hypotenuse", "\\sqrt{a^2+b^2}"),
    ],
  },
  {
    id: "integral",
    label: "Integral",
    icon: "\\int_a^b",
    items: [
      x("Integral", "\\int #0\\,d#?"),
      x("Integral with limits", "\\int_{#?}^{#?} #0\\,d#?"),
      x("Double integral", "\\iint #0\\,d#?\\,d#?"),
      x("Triple integral", "\\iiint #0\\,d#?\\,d#?\\,d#?"),
      x("Contour integral", "\\oint_{#?} #0\\,d#?"),
      x("Integral from 0 to infinity", "\\int_{0}^{\\infty} #0\\,d#?"),
    ],
  },
  {
    id: "operator",
    label: "Large operator",
    icon: "\\sum_{i}",
    items: [
      x("Sum with limits", "\\sum_{#?}^{#?} #0"),
      x("Sum", "\\sum_{#?} #0"),
      x("Product with limits", "\\prod_{#?}^{#?} #0"),
      x("Coproduct", "\\coprod_{#?}^{#?} #0"),
      x("Union", "\\bigcup_{#?}^{#?} #0"),
      x("Intersection", "\\bigcap_{#?}^{#?} #0"),
      x("Logical or over", "\\bigvee_{#?} #0"),
      x("Logical and over", "\\bigwedge_{#?} #0"),
      x("Binomial sum", "\\sum_{k=0}^{n}\\binom{n}{k}"),
    ],
  },
  {
    id: "bracket",
    label: "Bracket",
    icon: "\\left(x\\right)",
    items: [
      x("Parentheses", "\\left(#0\\right)"),
      x("Square brackets", "\\left[#0\\right]"),
      x("Braces", "\\left\\{#0\\right\\}"),
      x("Absolute value", "\\left|#0\\right|"),
      x("Norm", "\\left\\|#0\\right\\|"),
      x("Angle brackets", "\\left\\langle #0\\right\\rangle"),
      x("Floor", "\\left\\lfloor #0\\right\\rfloor"),
      x("Ceiling", "\\left\\lceil #0\\right\\rceil"),
      x("Binomial coefficient", "\\binom{#0}{#?}"),
      x("Cases", "\\begin{cases}#0 & #?\\\\ #? & #?\\end{cases}"),
    ],
  },
  {
    id: "function",
    label: "Function",
    icon: "\\sin\\theta",
    items: [
      x("Sine", "\\sin #0"),
      x("Cosine", "\\cos #0"),
      x("Tangent", "\\tan #0"),
      x("Arcsine", "\\arcsin #0"),
      x("Hyperbolic sine", "\\sinh #0"),
      x("Natural logarithm", "\\ln #0"),
      x("Logarithm", "\\log #0"),
      x("Logarithm to a base", "\\log_{#?} #0"),
      x("Exponential", "\\exp #0"),
      x("Function by name", "\\operatorname{#?} #0"),
    ],
  },
  {
    id: "accent",
    label: "Accent",
    icon: "\\hat{a}",
    items: [
      x("Dot", "\\dot{#0}"),
      x("Two dots", "\\ddot{#0}"),
      x("Hat", "\\hat{#0}"),
      x("Wide hat", "\\widehat{#0}"),
      x("Tilde", "\\tilde{#0}"),
      x("Bar", "\\bar{#0}"),
      x("Overline", "\\overline{#0}"),
      x("Underline", "\\underline{#0}"),
      x("Vector", "\\vec{#0}"),
      x("Arrow over", "\\overrightarrow{#0}"),
      x("Brace over", "\\overbrace{#0}^{#?}"),
      x("Brace under", "\\underbrace{#0}_{#?}"),
      x("Box", "\\boxed{#0}"),
    ],
  },
  {
    id: "limit",
    label: "Limit and log",
    icon: "\\lim_{n}",
    items: [
      x("Limit", "\\lim_{#?} #0"),
      x("Limit to infinity", "\\lim_{n\\to\\infty} #0"),
      x("Maximum", "\\max_{#?} #0"),
      x("Minimum", "\\min_{#?} #0"),
      x("Supremum", "\\sup_{#?} #0"),
      x("Infimum", "\\inf_{#?} #0"),
      x("Limit of sin x over x", "\\lim_{x\\to 0}\\frac{\\sin x}{x}"),
    ],
  },
  {
    id: "operators",
    label: "Operator",
    icon: "\\overset{\\Delta}{=}",
    items: [
      x("Equal by definition", "\\overset{\\text{def}}{=}"),
      x("Defined as", "\\coloneqq"),
      x("Delta equals", "\\overset{\\Delta}{=}"),
      x("Something over", "\\overset{#?}{#0}"),
      x("Something under", "\\underset{#?}{#0}"),
      x("Arrow with text over", "\\xrightarrow{#?}"),
      x("Arrow with text under", "\\xrightarrow[#?]{}"),
      x("Left arrow with text over", "\\xleftarrow{#?}"),
    ],
  },
  {
    id: "matrix",
    label: "Matrix",
    icon: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}",
    items: [
      x("2 by 2 in parentheses", "\\begin{pmatrix}#0 & #?\\\\ #? & #?\\end{pmatrix}"),
      x("2 by 2 in brackets", "\\begin{bmatrix}#0 & #?\\\\ #? & #?\\end{bmatrix}"),
      x("Determinant", "\\begin{vmatrix}#0 & #?\\\\ #? & #?\\end{vmatrix}"),
      x("3 by 3 in parentheses", "\\begin{pmatrix}#0 & #? & #?\\\\ #? & #? & #?\\\\ #? & #? & #?\\end{pmatrix}"),
      x("Row vector", "\\begin{pmatrix}#0 & #?\\end{pmatrix}"),
      x("Column vector", "\\begin{pmatrix}#0\\\\ #?\\end{pmatrix}"),
      x("Identity matrix", "\\begin{pmatrix}1 & 0\\\\ 0 & 1\\end{pmatrix}"),
      x("n by n with dots", "\\begin{pmatrix}a_{11} & \\cdots & a_{1n}\\\\ \\vdots & \\ddots & \\vdots\\\\ a_{n1} & \\cdots & a_{nn}\\end{pmatrix}"),
    ],
  },
];

/** The symbol palettes: the symbol panel's own kinds, those written inside a formula. */
export const SYMBOL_GROUPS: { id: string; label: string; symbols: Sym[] }[] = CATEGORIES.filter((c) =>
  ["greek", "operators", "relations", "arrows", "logic", "calculus", "misc"].includes(c.id),
).map((c) => ({ id: c.id, label: c.label, symbols: c.symbols.filter((s) => s.math) }));

/** What a structure shows on its button: its boxes drawn as empty squares. */
export const preview = (insert: string) => insert.replace(/#[0?]/g, "\\square");

/**
 * What the visual editor writes that LaTeX does not know, as LaTeX writes it: its own names for
 * the d of a derivative, e and i, and a few symbols its typing shortcuts give.
 */
const OWN: [RegExp, string][] = [
  [/\\differentialD(?![a-zA-Z])/g, "\\mathrm{d}"],
  [/\\capitalDifferentialD(?![a-zA-Z])/g, "\\mathrm{D}"],
  [/\\exponentialE(?![a-zA-Z])/g, "\\mathrm{e}"],
  [/\\imaginaryI(?![a-zA-Z])/g, "\\mathrm{i}"],
  [/\\imaginaryJ(?![a-zA-Z])/g, "\\mathrm{j}"],
  [/\\doubleprime(?![a-zA-Z])/g, "\\prime\\prime"],
  [/\\questeq(?![a-zA-Z])/g, "\\stackrel{?}{=}"],
  [/\\Colon(?![a-zA-Z])/g, "::"],
  [/\\twoheadrightarrowtail(?![a-zA-Z])/g, "\\twoheadrightarrow"],
  // mathtools' \coloneq is :−; the := the shortcut means is \coloneqq.
  [/\\coloneq(?![a-zA-Z])/g, "\\coloneqq"],
  [/\\degree(?![a-zA-Z])/g, "^{\\circ}"],
  [/\\slash(?![a-zA-Z])/g, "/"],
];

/**
 * The LaTeX the visual editor gives, as it goes into a document: what only the editor knows
 * written as LaTeX does, an empty box left as an empty group (so the letters either side do
 * not run together), and an empty last line of several taken away.
 */
export function cleanFormula(latex: string): string {
  let out = latex.replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, "{}");
  for (const [pattern, written] of OWN) out = out.replace(pattern, written);
  return out
    .replace(/\\\\\s*&?\s*(?:\{\})?\s*\\end\{aligned\}/g, "\\end{aligned}")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The places in `text` where `token` begins at the text's own level: outside braces and
 * outside environments such as a matrix, so that a subscript's = or a matrix's rows are not
 * taken for the formula's own.
 */
function topLevel(text: string, token: string): number[] {
  const found: number[] = [];
  let braces = 0;
  let envs = 0;
  for (let i = 0; i < text.length; i++) {
    if (braces === 0 && envs === 0 && text.startsWith(token, i)) {
      found.push(i);
      i += token.length - 1;
      continue;
    }
    if (text.startsWith("\\begin{", i)) envs++;
    else if (text.startsWith("\\end{", i)) envs = Math.max(0, envs - 1);
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "{") braces++;
    else if (ch === "}") braces = Math.max(0, braces - 1);
  }
  return found;
}

/** `text` cut at each of `places`, the `width` characters there left out. */
function cut(text: string, places: number[], width: number): string[] {
  const parts: string[] = [];
  let from = 0;
  for (const at of places) {
    parts.push(text.slice(from, at));
    from = at + width;
  }
  return [...parts, text.slice(from)];
}

/**
 * The formula with a line added after it, as Word's Enter in an equation does: the lines are
 * set one under another in `aligned`, lined up at their first `=` of their own. `#?` marks
 * where typing goes on.
 */
export function withNewLine(latex: string): string {
  const align = (line: string) => {
    if (topLevel(line, "&").length) return line;
    const equals = topLevel(line, "=")[0];
    return equals === undefined ? `&${line}` : `${line.slice(0, equals)}&${line.slice(equals)}`;
  };
  const whole = latex.trim();
  const aligned = /^\\begin\{aligned\}([\s\S]*)\\end\{aligned\}$/.exec(whole);
  // Lines of an aligned block that is the whole formula, and not two blocks one after another.
  const body = aligned && topLevel(aligned[1], "\\end{aligned}").length === 0 ? aligned[1] : undefined;
  const lines = body !== undefined ? cut(body, topLevel(body, "\\\\"), 2).map((l) => l.trim()) : [whole];
  return `\\begin{aligned}${[...lines.map(align), "&#?"].join("\\\\ ")}\\end{aligned}`;
}

/** The packages a formula needs beyond LaTeX's own. */
export function packagesFor(tex: string): string[] {
  const out: string[] = [];
  if (AMSMATH.test(tex)) out.push("amsmath");
  if (AMSSYMB.test(tex)) out.push("amssymb");
  // mathtools, which loads amsmath, has \coloneqq.
  if (/\\coloneqq\b/.test(tex)) out.push("mathtools");
  // And those the symbol panel knows a symbol needs.
  for (const sym of ALL_SYMBOLS) {
    if (sym.pkg && sym.math && !out.includes(sym.pkg) && new RegExp(`${sym.math.replace(/[\\{}^$.|?*+()[\]]/g, "\\$&")}(?![a-zA-Z])`).test(tex)) out.push(sym.pkg);
  }
  return out;
}

const AMSMATH =
  /\\(?:text|operatorname|[pbvBV]?matrix|cases|aligned|gathered|dfrac|tfrac|binom|overset|underset|xrightarrow|xleftarrow|boxed|iint|iiint|substack)\b|\\begin\{(?:align|gather|multline|cases|[pbvBV]?matrix)/;
const AMSSYMB =
  /\\(?:mathbb|mathfrak|square|blacksquare|leqslant|geqslant|nleq|ngeq|nless|ngtr|varnothing|therefore|because|lesssim|gtrsim|checkmark|rightarrowtail|leftarrowtail|twoheadrightarrow|twoheadleftarrow|ltimes|rtimes|nexists|nmid|nparallel|complement|leqq|geqq|lll|ggg|lozenge|blacklozenge|circledast|boxplus|boxtimes)\b/;
