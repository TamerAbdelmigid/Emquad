import { describe, expect, it } from "vitest";
import { formulaAt, writeFormula } from "./equation";

describe("the formula at the cursor", () => {
  const text = "Energy $E = mc^2$ and\n\\begin{equation}\n  a^2 + b^2 = c^2\n  \\label{eq:pythagoras}\n\\end{equation}\nthen \\[ x \\] costs \\$5.";

  it("finds one in the line, one of its own, and a numbered one with its label", () => {
    expect(formulaAt(text, text.indexOf("mc"))).toEqual({ from: 7, to: 17, tex: "E = mc^2", placement: "inline", label: "" });
    const eq = formulaAt(text, text.indexOf("b^2"))!;
    expect(eq).toMatchObject({ tex: "a^2 + b^2 = c^2", placement: "numbered", label: "eq:pythagoras" });
    expect(text.slice(eq.from, eq.to).endsWith("\\end{equation}")).toBe(true);
    expect(formulaAt(text, text.indexOf(" x "))).toMatchObject({ tex: "x", placement: "display" });
    // At its edge too, but not in the text around it, nor at an escaped dollar.
    expect(formulaAt(text, 7)?.tex).toBe("E = mc^2");
    expect(formulaAt(text, text.indexOf("Energy"))).toBeNull();
    expect(formulaAt(text, text.indexOf("costs"))).toBeNull();
  });

  it("does not take align and its like, which are edited in their source", () => {
    expect(formulaAt("\\begin{align}\n  a &= b\n\\end{align}", 16)).toBeNull();
  });

  it("does not take a line break such as \\\\[2pt], an escaped dollar or a comment for the edge of a formula", () => {
    const align = "\\begin{align} a \\\\[2pt] b \\label{e} \\end{align} text \\[ x \\]";
    expect(formulaAt(align, align.lastIndexOf("x"))).toMatchObject({ from: align.indexOf("\\[ x"), tex: "x", placement: "display", label: "" });
    expect(formulaAt(align, align.indexOf("2pt"))).toBeNull();
    const dollars = "cost \\\\$x$ and \\$5 and $y$ % $z$";
    expect(formulaAt(dollars, dollars.indexOf("x"))?.tex).toBe("x");
    expect(formulaAt(dollars, dollars.indexOf("5"))).toBeNull();
    expect(formulaAt(dollars, dollars.indexOf("y"))?.tex).toBe("y");
    expect(formulaAt(dollars, dollars.indexOf("z"))).toBeNull();
  });
});

describe("writing a formula", () => {
  it("writes it in the line, on a line of its own, or numbered with its label kept", () => {
    expect(writeFormula(" x^2 \n + 1 ", "inline")).toBe("$x^2 + 1$");
    expect(writeFormula("x^2", "display")).toBe("\\[\n  x^2\n\\]");
    expect(writeFormula("a = b\n+ c", "numbered", "eq:one")).toBe("\\begin{equation}\n  a = b\n  + c\n  \\label{eq:one}\n\\end{equation}");
    expect(writeFormula("a", "numbered")).toBe("\\begin{equation}\n  a\n\\end{equation}");
    // A blank line would end the paragraph inside the formula.
    expect(writeFormula("a\n\n  \nb", "display")).toBe("\\[\n  a\n  b\n\\]");
  });
});
