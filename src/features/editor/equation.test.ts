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
});

describe("writing a formula", () => {
  it("writes it in the line, on a line of its own, or numbered with its label kept", () => {
    expect(writeFormula(" x^2 \n + 1 ", "inline")).toBe("$x^2 + 1$");
    expect(writeFormula("x^2", "display")).toBe("\\[\n  x^2\n\\]");
    expect(writeFormula("a = b\n+ c", "numbered", "eq:one")).toBe("\\begin{equation}\n  a = b\n  + c\n  \\label{eq:one}\n\\end{equation}");
    expect(writeFormula("a", "numbered")).toBe("\\begin{equation}\n  a\n\\end{equation}");
  });
});
