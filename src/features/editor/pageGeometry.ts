// The page the page view draws the document on: the paper's width, the margins, the size and
// kind of type and the spacing of lines, as the document's settings give them (read by
// documentSetup.ts). Only a likeness: where the PDF breaks lines and pages is the compiler's. Pure.
import type { Setup } from "./documentSetup";

export interface Geometry {
  /** Width of the paper, in centimetres, as it is turned. */
  width: number;
  /** Height of the paper, in centimetres, as it is turned. */
  height: number;
  /** Left and right margin, in centimetres. */
  margin: number;
  /** Size of the body text, in points. */
  pt: number;
  /** Line height as a multiple of the text size. */
  lineHeight: number;
  font: "serif" | "times" | "palatino" | "sans";
}

/** Each paper's width and height, upright, in centimetres. */
const PAPER_CM: Record<string, [number, number]> = {
  a4paper: [21, 29.7],
  letterpaper: [21.59, 27.94],
  a5paper: [14.8, 21],
  b5paper: [17.6, 25],
  legalpaper: [21.59, 35.56],
  executivepaper: [18.42, 26.67],
};
/** The standard classes' text width for each size of type, in centimetres (345, 360 and 390 pt). */
const TEXT_CM: Record<number, number> = { 10: 12.13, 11: 12.65, 12: 13.71 };
const UNIT_CM: Record<string, number> = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72.27, bp: 2.54 / 72 };

function lengthCm(length: string): number | null {
  const m = /^([\d.]+)\s*(cm|mm|in|pt|bp)$/.exec(length.trim());
  return m ? Number(m[1]) * UNIT_CM[m[2]] : null;
}

export function pageGeometry(setup: Setup | null): Geometry {
  const [upright, tall] = PAPER_CM[setup?.paper ?? ""] ?? PAPER_CM.a4paper;
  const [width, height] = setup?.landscape ? [tall, upright] : [upright, tall];
  const pt = Number.parseInt(setup?.size ?? "", 10) || 10;
  // Turned with geometry, which leaves margins of 15% of the paper when given none.
  const margin = lengthCm(setup?.margins ?? "") ?? (setup?.landscape ? width * 0.15 : Math.max(1, (width - (TEXT_CM[pt] ?? TEXT_CM[10])) / 2));
  const lineHeight = { single: 1.4, onehalf: 1.85, double: 2.3 }[setup?.spacing ?? "single"];
  const font = setup?.font === "times" || setup?.font === "palatino" || setup?.font === "sans" ? setup.font : "serif";
  return { width, height, margin, pt, lineHeight, font };
}
