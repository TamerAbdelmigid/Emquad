import { describe, expect, it } from "vitest";
import { type Piece, closingBrace, visualPieces } from "./visualModel";

const of = (pieces: Piece[], kind: Piece["kind"]) => pieces.filter((p) => p.kind === kind);
const slice = (text: string, p: Piece) => ("to" in p ? text.slice(p.from, p.to) : "");

describe("closingBrace", () => {
  it("matches nested and escaped braces, and gives up at a blank line", () => {
    expect(closingBrace("{a{b}c}d", 0)).toBe(7);
    expect(closingBrace("{a\\}b}", 0)).toBe(6);
    expect(closingBrace("{never\n\nclosed}", 0)).toBe(-1);
  });
});

describe("visualPieces", () => {
  it("turns a section into a heading and hides its command", () => {
    const text = "\\section{The {polar} trick}\ntext";
    const pieces = visualPieces(text, []);
    expect(of(pieces, "hide").map((p) => slice(text, p))).toEqual(["\\section{", "}"]);
    expect(of(pieces, "style").map((p) => slice(text, p))).toEqual(["The {polar} trick"]);
    expect(of(pieces, "line")).toEqual([{ kind: "line", from: 0, style: "h1" }]);
  });

  it("leaves a construct as plain source while the cursor is in it", () => {
    const text = "a \\textbf{bold} b $x^2$ c";
    const away = visualPieces(text, [{ from: 0, to: 0 }]);
    expect(of(away, "hide")).toHaveLength(2);
    expect(of(away, "math")).toHaveLength(1);
    const inBold = visualPieces(text, [{ from: 11, to: 11 }]);
    expect(of(inBold, "hide")).toHaveLength(0);
    expect(of(inBold, "style").map((p) => slice(text, p))).toEqual(["bold"]);
    const inMath = visualPieces(text, [{ from: 20, to: 20 }]);
    expect(of(inMath, "math")).toHaveLength(0);
  });

  it("finds inline and display mathematics and passes on the right TeX", () => {
    const text = "\\begin{document}Let $I = \\sqrt{\\pi}$ and \\[ a^2 \\]\n\\begin{equation}\\label{eq:x}\n  E = mc^2\n\\end{equation}\n\\begin{align}a&=b\\\\c&=d\\end{align}\\end{document}";
    const math = of(visualPieces(text, []), "math") as Extract<Piece, { kind: "math" }>[];
    expect(math.map((m) => [m.tex, m.display])).toEqual([
      ["E = mc^2", true],
      ["\\begin{aligned}a&=b\\\\c&=d\\end{aligned}", true],
      ["a^2", true],
      ["I = \\sqrt{\\pi}", false],
    ]);
  });

  it("does not treat prices, escaped dollars or comments as mathematics or commands", () => {
    const text = "It costs \\$5 and \\$6.\n% \\section{Hidden} $x$\nreal $y$";
    const pieces = visualPieces(text, []);
    expect((of(pieces, "math") as Extract<Piece, { kind: "math" }>[]).map((m) => m.tex)).toEqual(["y"]);
    expect(of(pieces, "hide")).toHaveLength(0);
  });

  it("draws list items as bullets and marks references and environments", () => {
    const text = "\\begin{itemize}\n\\item one \\ref{a}\n\\item two\n\\end{itemize}";
    const pieces = visualPieces(text, []);
    expect(of(pieces, "bullet")).toHaveLength(2);
    expect(of(pieces, "style").map((p) => [slice(text, p), (p as Extract<Piece, { kind: "style" }>).style])).toEqual([
      ["\\begin{itemize}", "env"],
      ["\\ref{a}", "chip"],
      ["\\end{itemize}", "env"],
    ]);
  });

  it("quiets the preamble but still shows the title as a heading", () => {
    const text = "\\documentclass{article}\n\\title{My Paper}\n\\begin{document}\n\\section{One}";
    const pieces = visualPieces(text, []);
    expect(of(pieces, "line").filter((p) => (p as Extract<Piece, { kind: "line" }>).style === "preamble")).toHaveLength(1);
    expect(of(pieces, "style").map((p) => slice(text, p))).toContain("My Paper");
    expect(of(pieces, "style").map((p) => slice(text, p))).not.toContain("\\documentclass{article}");
  });
});
