import { describe, expect, it } from "vitest";
import { pageGeometry } from "./pageGeometry";

const setup = (over: object) => ({ paper: "", size: "", margins: "", spacing: "single", font: "default", pageNumbers: true, paragraphs: "indent", landscape: false, columns: 1, lineNumbers: false, header: "", footer: "", ...over }) as const;

describe("pageGeometry", () => {
  it("uses the class's own page when the document sets none: A4, 10 pt, the text width LaTeX gives it", () => {
    const g = pageGeometry(null);
    expect(g.width).toBeCloseTo(21);
    expect(g.margin).toBeCloseTo((21 - 12.13) / 2, 1);
    expect(g.pt).toBe(10);
    expect(g.font).toBe("serif");
  });

  it("reads the paper, the size of the type and the margins the document sets", () => {
    const g = pageGeometry(setup({ paper: "letterpaper", size: "12pt", margins: "1in", spacing: "onehalf", font: "sans" }));
    expect(g.width).toBeCloseTo(21.59);
    expect(g.margin).toBeCloseTo(2.54);
    expect(g.pt).toBe(12);
    expect(g.lineHeight).toBeGreaterThan(pageGeometry(null).lineHeight);
    expect(g.font).toBe("sans");
  });

  it("understands margins in millimetres and points, and ignores what it cannot read", () => {
    expect(pageGeometry(setup({ margins: "25mm" })).margin).toBeCloseTo(2.5);
    expect(pageGeometry(setup({ margins: "72pt" })).margin).toBeCloseTo(2.54, 1);
    expect(pageGeometry(setup({ margins: "\\mymargin" })).margin).toBeCloseTo(pageGeometry(null).margin);
  });

  it("turns the page on its side, and the margins with it when the document sets none", () => {
    const g = pageGeometry(setup({ landscape: true, margins: "2cm" }));
    expect(g.width).toBeCloseTo(29.7);
    expect(g.height).toBeCloseTo(21);
    expect(g.margin).toBeCloseTo(2);
    expect(pageGeometry(null).height).toBeCloseTo(29.7);
    // geometry's own margins are a share of the paper.
    expect(pageGeometry(setup({ landscape: true })).margin).toBeCloseTo(29.7 * 0.15, 1);
  });
});
