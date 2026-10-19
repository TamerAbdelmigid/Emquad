// The page the page view draws the document on: the paper's width, the margins, the size and
// kind of type and the spacing of lines, as the document's settings give them (read by
// documentSetup.ts). Only a likeness: where the PDF breaks lines and pages is the compiler's. Pure.
import type { Setup } from "./documentSetup";

export interface Geometry {
  /** Width of the paper, in centimetres. */
  width: number;
  /** Left and right margin, in centimetres. */
  margin: number;
  /** Size of the body text, in points. */
  pt: number;
  /** Line height as a multiple of the text size. */
  lineHeight: number;
  font: "serif" | "times" | "palatino" | "sans";
}

const PAPER_CM: Record<string, number> = { a4paper: 21, letterpaper: 21.59, a5paper: 14.8, b5paper: 17.6, legalpaper: 21.59, executivepaper: 18.42 };
/** The standard classes' text width for each size of type, in centimetres (345, 360 and 390 pt). */
const TEXT_CM: Record<number, number> = { 10: 12.13, 11: 12.65, 12: 13.71 };
const UNIT_CM: Record<string, number> = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72.27, bp: 2.54 / 72 };

function lengthCm(length: string): number | null {
  const m = /^([\d.]+)\s*(cm|mm|in|pt|bp)$/.exec(length.trim());
  return m ? Number(m[1]) * UNIT_CM[m[2]] : null;
}

export function pageGeometry(setup: Setup | null): Geometry {
  const width = PAPER_CM[setup?.paper ?? ""] ?? PAPER_CM.a4paper;
  const pt = Number.parseInt(setup?.size ?? "", 10) || 10;
  const margin = lengthCm(setup?.margins ?? "") ?? Math.max(1, (width - (TEXT_CM[pt] ?? TEXT_CM[10])) / 2);
  const lineHeight = { single: 1.4, onehalf: 1.85, double: 2.3 }[setup?.spacing ?? "single"];
  const font = setup?.font === "times" || setup?.font === "palatino" || setup?.font === "sans" ? setup.font : "serif";
  return { width, margin, pt, lineHeight, font };
}
