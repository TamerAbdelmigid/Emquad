import { describe, expect, it } from "vitest";
import { ALL_SYMBOLS, CATEGORIES, findSymbols, insertion, mathAt, placeInsertion, symbolId, symbolsById } from "./symbols";

const sym = (name: string) => ALL_SYMBOLS.find((s) => s.name === name)!;
/** Whether the place marked | is in a formula. */
const at = (marked: string) => mathAt(marked.replace("|", ""), marked.indexOf("|"));

describe("telling a formula from text", () => {
  it("knows the ways a formula is written", () => {
    expect(at("a $x| y$ b")).toBe(true);
    expect(at("a $x$ |b")).toBe(false);
    expect(at("a $$x|$$ b")).toBe(true);
    expect(at("a $$x$$ |b")).toBe(false);
    expect(at("see $x$$\\alpha$ and |")).toBe(false);
    expect(at("$x$$y|$ z")).toBe(true);
    expect(at("$x$$y$ |z")).toBe(false);
    expect(at("a \\(x|\\) b")).toBe(true);
    expect(at("a \\[x\\] |b")).toBe(false);
    expect(at("\\begin{equation}\n  x = |\n\\end{equation}")).toBe(true);
    expect(at("\\begin{align*}\n a &= b \\\\\n c &= |")).toBe(true);
    expect(at("\\begin{align}\n a \\end{align} |")).toBe(false);
    expect(at("|")).toBe(false);
  });

  it("takes text inside a formula for text, and a formula inside that for a formula", () => {
    expect(at("$a \\text{if |} b$")).toBe(false);
    expect(at("$a \\text{if} b|$")).toBe(true);
    expect(at("$a \\mbox{x $y|$} b$")).toBe(true);
    expect(at("$\\frac{a}{b|}$")).toBe(true);
  });

  it("is not fooled by escaped dollars, comments or verbatim text", () => {
    expect(at("costs \\$5 and |")).toBe(false);
    expect(at("a % $ not a formula\nb |")).toBe(false);
    expect(at("\\begin{verbatim}\n$x\n\\end{verbatim}\n|")).toBe(false);
    expect(at("a \\\\ $x|$")).toBe(true);
    expect(at("\\verb|$| and |")).toBe(false);
    expect(at("\\verb+a+ $x|$")).toBe(true);
  });
});

describe("writing a symbol", () => {
  it("writes a formula symbol as it is in a formula, and in $…$ in text", () => {
    expect(insertion(sym("alpha"), true, "$")).toEqual({ before: "\\alpha ", after: "" });
    expect(insertion(sym("alpha"), true, " ")).toEqual({ before: "\\alpha", after: "" });
    expect(insertion(sym("alpha"), false, " ")).toEqual({ before: "$\\alpha$", after: "" });
    expect(insertion(sym("less or equal, slanted"), false)).toEqual({ before: "$\\leqslant$", after: "", pkg: "amssymb" });
  });

  it("writes a text symbol so that a letter after it does not join its name", () => {
    expect(insertion(sym("copyright"), false, " ").before).toBe("\\textcopyright{}");
    expect(insertion(sym("copyright"), false, "A").before).toBe("\\textcopyright{}");
    expect(insertion(sym("copyright"), false, ".").before).toBe("\\textcopyright");
    expect(insertion(sym("en dash"), false, " ").before).toBe("--");
    expect(insertion(sym("percent sign"), false, "a").before).toBe("\\%");
  });

  it("writes a text symbol in a formula in a box, and a symbol with two forms in the right one", () => {
    expect(insertion(sym("copyright"), true).before).toBe("\\mbox{\\textcopyright}");
    expect(insertion(sym("times"), true, "x").before).toBe("\\times ");
    expect(insertion(sym("times"), false, " ").before).toBe("\\texttimes{}");
    expect(insertion(sym("degree"), true).before).toBe("^{\\circ}");
    expect(insertion(sym("degree"), false, "C").before).toBe("\\textdegree{}");
  });

  it("writes a structure around the selected text", () => {
    expect(insertion(sym("fraction"), true)).toEqual({ before: "\\frac{", after: "}{}" });
    expect(insertion(sym("fraction"), false)).toEqual({ before: "$\\frac{", after: "}{}$" });
    expect(insertion(sym("binomial coefficient"), true).pkg).toBe("amsmath");
    expect(insertion(sym("quotation marks"), false)).toEqual({ before: "``", after: "''" });
    expect(insertion(sym("quotation marks"), true)).toEqual({ before: "\\mbox{``", after: "''}" });
  });
});

describe("placing a symbol", () => {
  const make = (s: string) => (inMath: boolean, next: string) => insertion(sym(s), inMath, next);
  it("puts a formula symbol straight after a formula inside it", () => {
    const text = "where $n$ is";
    const at = text.indexOf("$ is") + 1;
    expect(placeInsertion(text, at, at, make("less or equal"))).toEqual({ from: at - 1, to: at - 1, ins: { before: "\\leq ", after: "" } });
    // Not after an escaped dollar, a display, or with text selected.
    expect(placeInsertion("costs \\$", 8, 8, make("alpha")).ins.before).toBe("$\\alpha$");
    expect(placeInsertion("$$x$$", 5, 5, make("alpha")).ins.before).toBe("$\\alpha$");
    expect(placeInsertion("$n$ ab", 3, 5, make("alpha")).from).toBe(3);
    // A text symbol straight after a formula stays outside it.
    expect(placeInsertion("$n$", 3, 3, make("copyright")).ins.before).toBe("\\textcopyright{}");
  });
});

describe("the catalogue", () => {
  it("names every symbol once and has a way to write each", () => {
    const ids = ALL_SYMBOLS.map(symbolId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ALL_SYMBOLS) expect(Boolean(s.math || s.text || s.wrap || s.textWrap)).toBe(true);
    for (const c of CATEGORIES) expect(c.symbols.length).toBeGreaterThan(5);
  });

  it("finds symbols by name, by LaTeX and by look", () => {
    expect(findSymbols("alpha")[0].math).toBe("\\alpha");
    expect(findSymbols("\\leq")[0].math).toBe("\\leq");
    expect(findSymbols("≤")[0].math).toBe("\\leq");
    expect(findSymbols("arrow").length).toBeGreaterThan(10);
    expect(findSymbols("micro")[0].math).toBe("\\mu");
    expect(findSymbols("frac")[0].name).toBe("fraction");
    expect(findSymbols("  ")).toEqual([]);
  });

  it("finds the ones used lately by name, dropping any no longer offered", () => {
    expect(symbolsById(["\\beta", "gone", "\\textcopyright"]).map((s) => s.name)).toEqual(["beta", "copyright"]);
  });
});
