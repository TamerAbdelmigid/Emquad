import katex from "katex";
import { describe, expect, it } from "vitest";
import { STRUCTURES, SYMBOL_GROUPS, cleanFormula, packagesFor, preview, withNewLine } from "./equationRibbon";

const typesets = (tex: string) => {
  try {
    katex.renderToString(tex, { throwOnError: true, displayMode: true });
    return true;
  } catch {
    return false;
  }
};

describe("the equation ribbon", () => {
  it("has buttons that each show what they write, and write LaTeX that typesets", () => {
    for (const group of STRUCTURES) {
      expect(typesets(group.icon), group.icon).toBe(true);
      for (const item of group.items) {
        expect(typesets(preview(item.insert)), item.name).toBe(true);
        expect(typesets(item.insert.replace(/#[0?]/g, "x")), item.name).toBe(true);
      }
    }
    // The symbols of formulas, and only those.
    expect(SYMBOL_GROUPS.map((g) => g.id)).toContain("greek");
    for (const group of SYMBOL_GROUPS) for (const sym of group.symbols) expect(typesets(sym.math!), sym.name).toBe(true);
  });
});

describe("what the editor gives", () => {
  it("is LaTeX with no empty boxes left in it", () => {
    expect(cleanFormula("\\frac{a}{\\placeholder{}} + \\sqrt[\\placeholder[n]{}]{x}")).toBe("\\frac{a}{} + \\sqrt[]{x}");
  });

  it("has a new line added as Word does, the lines lined up at their =", () => {
    expect(withNewLine("y = x^2")).toBe("\\begin{aligned}y &= x^2\\\\ &#?\\end{aligned}");
    expect(withNewLine("\\begin{aligned}y &= x^2\\\\ &= 4\\end{aligned}")).toBe("\\begin{aligned}y &= x^2\\\\ &= 4\\\\ &#?\\end{aligned}");
    expect(withNewLine("a + b")).toBe("\\begin{aligned}&a + b\\\\ &#?\\end{aligned}");
  });

  it("says which packages the formula needs", () => {
    expect(packagesFor("x^2 + \\frac{a}{b}")).toEqual([]);
    expect(packagesFor("\\begin{pmatrix}1&0\\end{pmatrix} \\in \\mathbb{R}")).toEqual(["amsmath", "amssymb"]);
    expect(packagesFor("f \\coloneqq g")).toEqual(["mathtools"]);
    expect(packagesFor("\\text{if } x")).toEqual(["amsmath"]);
  });
});
