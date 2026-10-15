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
  const found: Formula[] = [];
  const add = (from: number, to: number, tex: string, placement: Placement) => {
    const label = LABEL.exec(tex)?.[1] ?? "";
    found.push({ from, to, tex: tex.replace(LABEL, "").trim(), placement, label });
  };
  for (const m of text.matchAll(/\\begin\{(equation\*?)\}([\s\S]*?)\\end\{\1\}/g)) add(m.index, m.index + m[0].length, m[2], m[1] === "equation" ? "numbered" : "display");
  for (const m of text.matchAll(/\\\[([\s\S]*?)\\\]/g)) add(m.index, m.index + m[0].length, m[1], "display");
  for (const m of text.matchAll(/(?<!\\)\$\$([\s\S]*?)\$\$/g)) add(m.index, m.index + m[0].length, m[1], "display");
  for (const m of text.matchAll(/\\\(([^\n]*?)\\\)/g)) add(m.index, m.index + m[0].length, m[1], "inline");
  for (const m of text.matchAll(/(?<![\\$])\$(?!\$)((?:\\.|[^$\\\n])+?)\$/g)) add(m.index, m.index + m[0].length, m[1], "inline");
  // The innermost that holds the place: one written in the middle of another is not a formula.
  return found.filter((f) => f.from <= pos && pos <= f.to).sort((a, b) => a.to - a.from - (b.to - b.from))[0] ?? null;
}

/** A formula written as LaTeX, set as `placement`. */
export function writeFormula(tex: string, placement: Placement, label = ""): string {
  const body = tex.trim();
  if (placement === "inline") return `$${body.replace(/\s*\n\s*/g, " ")}$`;
  const lines = body
    .split("\n")
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

/** Symbols a formula often needs, as LaTeX writes them. */
export const SYMBOLS: [string, string][] = [
  ["α", "\\alpha"],
  ["β", "\\beta"],
  ["γ", "\\gamma"],
  ["δ", "\\delta"],
  ["θ", "\\theta"],
  ["λ", "\\lambda"],
  ["μ", "\\mu"],
  ["π", "\\pi"],
  ["σ", "\\sigma"],
  ["ω", "\\omega"],
  ["Δ", "\\Delta"],
  ["±", "\\pm"],
  ["×", "\\times"],
  ["÷", "\\div"],
  ["≤", "\\leq"],
  ["≥", "\\geq"],
  ["≠", "\\neq"],
  ["≈", "\\approx"],
  ["∞", "\\infty"],
  ["→", "\\to"],
  ["∈", "\\in"],
  ["∂", "\\partial"],
  ["·", "\\cdot"],
  ["…", "\\ldots"],
];
