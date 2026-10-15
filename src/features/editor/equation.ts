// The equation editor's view of a formula: finding the one the cursor is in, and writing one
// in the line, on a line of its own, or numbered. Pure.

/** How a formula is set: in the line of text, on a line of its own, or on its own and numbered. */
export type Placement = "inline" | "display" | "numbered";

/** A formula of the document, as the equation editor edits it. */
export interface Formula {
  from: number;
  to: number;
  tex: string;
  placement: Placement;
  /** The \label of a numbered one, kept when it is written again. */
  label: string;
}

const LABEL = /\\label\{([^}]*)\}/;

/**
 * The formula the place is in, or right at the edge of: one in $ $ or \( \), one in \[ \] or
 * $$ $$, or an equation environment. Null elsewhere, and for environments of several lines
 * such as align, which are edited in their source.
 */
export function formulaAt(text: string, pos: number): Formula | null {
  // Looked for in the text with comments, line breaks written \\ (as in \\[2pt]) and dollars
  // written \$ blanked out, every character in its place, so none of them is taken for the
  // edge of a formula.
  // The escaped pairs first, from the left as TeX reads them: in \\% the % begins a comment.
  const code = text.replace(/\\[\\$%]/g, "  ").replace(/%[^\n]*/g, (c) => " ".repeat(c.length));
  const found: Formula[] = [];
  const add = (from: number, to: number, inner: number, innerTo: number, placement: Placement) => {
    const tex = text.slice(inner, innerTo);
    const label = LABEL.exec(tex)?.[1] ?? "";
    found.push({ from, to, tex: tex.replace(LABEL, "").trim(), placement, label });
  };
  for (const m of code.matchAll(/\\begin\{(equation\*?)\}[\s\S]*?\\end\{\1\}/g)) {
    const from = m.index!;
    add(from, from + m[0].length, from + m[0].indexOf("}") + 1, from + m[0].lastIndexOf("\\end"), m[1] === "equation" ? "numbered" : "display");
  }
  /** Formulas between marks `edge` characters long. */
  const between = (pattern: RegExp, edge: number, placement: Placement) => {
    for (const m of code.matchAll(pattern)) add(m.index!, m.index! + m[0].length, m.index! + edge, m.index! + m[0].length - edge, placement);
  };
  between(/\\\[[\s\S]*?\\\]/g, 2, "display");
  between(/\$\$[\s\S]*?\$\$/g, 2, "display");
  between(/\\\([^\n]*?\\\)/g, 2, "inline");
  between(/(?<!\$)\$(?!\$)[^$\n]+?\$/g, 1, "inline");
  // The innermost that holds the place: one written in the middle of another is not a formula.
  return found.filter((f) => f.from <= pos && pos <= f.to).sort((a, b) => a.to - a.from - (b.to - b.from))[0] ?? null;
}

/** A formula written as LaTeX, set as `placement`. */
export function writeFormula(tex: string, placement: Placement, label = ""): string {
  const body = tex.trim();
  if (placement === "inline") return `$${body.replace(/\s*\n\s*/g, " ")}$`;
  // A blank line would end the paragraph in the middle of the formula.
  const lines = body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `  ${line.trim()}`)
    .join("\n");
  if (placement === "display") return `\\[\n${lines}\n\\]`;
  return `\\begin{equation}\n${lines}${label ? `\n  \\label{${label}}` : ""}\n\\end{equation}`;
}

/**
 * The structures the equation editor offers, each written around what is selected in it, with
 * the cursor after `before` when nothing was.
 */
export const STRUCTURES: { label: string; title: string; before: string; after: string }[] = [
  { label: "a/b", title: "Fraction", before: "\\frac{", after: "}{}" },
  { label: "√", title: "Square root", before: "\\sqrt{", after: "}" },
  { label: "xⁿ", title: "Power", before: "^{", after: "}" },
  { label: "xₙ", title: "Index", before: "_{", after: "}" },
  { label: "∑", title: "Sum", before: "\\sum_{i=1}^{n} ", after: "" },
  { label: "∫", title: "Integral", before: "\\int_{a}^{b} ", after: "\\,dx" },
  { label: "lim", title: "Limit", before: "\\lim_{x \\to \\infty} ", after: "" },
  { label: "( )", title: "Brackets that grow", before: "\\left( ", after: " \\right)" },
  { label: "[ ]", title: "Matrix", before: "\\begin{pmatrix} ", after: " & b \\\\ c & d \\end{pmatrix}" },
  { label: "{", title: "Cases", before: "\\begin{cases} ", after: " & \\text{if } x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}" },
  { label: "abc", title: "Words in a formula", before: "\\text{", after: "}" },
];

/** Symbols a formula often needs: as shown, as LaTeX writes them, and by name. */
export const SYMBOLS: [string, string, string][] = [
  ["α", "\\alpha", "alpha"],
  ["β", "\\beta", "beta"],
  ["γ", "\\gamma", "gamma"],
  ["δ", "\\delta", "delta"],
  ["θ", "\\theta", "theta"],
  ["λ", "\\lambda", "lambda"],
  ["μ", "\\mu", "mu"],
  ["π", "\\pi", "pi"],
  ["σ", "\\sigma", "sigma"],
  ["ω", "\\omega", "omega"],
  ["Δ", "\\Delta", "capital delta"],
  ["±", "\\pm", "plus or minus"],
  ["×", "\\times", "times"],
  ["÷", "\\div", "divided by"],
  ["≤", "\\leq", "less than or equal to"],
  ["≥", "\\geq", "greater than or equal to"],
  ["≠", "\\neq", "not equal to"],
  ["≈", "\\approx", "approximately equal to"],
  ["∞", "\\infty", "infinity"],
  ["→", "\\to", "tends to"],
  ["∈", "\\in", "element of"],
  ["∂", "\\partial", "partial derivative"],
  ["·", "\\cdot", "dot"],
  ["…", "\\ldots", "dots"],
];
