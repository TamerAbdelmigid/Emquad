import { describe, expect, it } from "vitest";
import { type Piece, closingBrace, describeCitation, tableRows, visualPieces } from "./visualModel";

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

  it("typesets every environment that holds mathematics, in a form KaTeX can draw", () => {
    const text =
      "\\begin{document}\n\\begin{alignat}{2}a&=b&c&=d\\end{alignat}\n\\begin{flalign*}x&=y\\end{flalign*}\n" +
      "\\begin{eqnarray}a&=&b\\end{eqnarray}\n\\begin{gather}p\\\\q\\end{gather}\nIn \\begin{math}r\\end{math} text.\n\\end{document}";
    const math = of(visualPieces(text, []), "math") as Extract<Piece, { kind: "math" }>[];
    expect(math.map((m) => [m.tex, m.display])).toEqual([
      ["\\begin{alignedat}{2}a&=b&c&=d\\end{alignedat}", true],
      ["\\begin{aligned}x&=y\\end{aligned}", true],
      ["\\begin{aligned}a&=&b\\end{aligned}", true],
      ["\\begin{gathered}p\\\\q\\end{gathered}", true],
      ["r", false],
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

describe("tables, figures and citations", () => {
  const table = "\\begin{tabular}{|l|r|}\n\\hline\n Name & Value \\\\\n\\hline\n $x$ & 1 \\\\ % a note\n \\multicolumn{2}{c}{Both \\& all} \\\\\n\\hline\n\\end{tabular}";

  it("reads a table's rows, cells, rules and spanning cells", () => {
    const body = table.slice(table.indexOf("}", 16) + 1, table.indexOf("\\end"));
    expect(tableRows(body)).toEqual([
      { cells: [{ tex: "Name", span: 1 }, { tex: "Value", span: 1 }], ruleAbove: true, ruleBelow: false },
      { cells: [{ tex: "$x$", span: 1 }, { tex: "1", span: 1 }], ruleAbove: true, ruleBelow: false },
      { cells: [{ tex: "Both \\& all", span: 2 }], ruleAbove: false, ruleBelow: true },
    ]);
  });

  it("draws a whole table as one piece, and nothing separately inside it", () => {
    const text = `before\n${table}\nafter $y$`;
    const pieces = visualPieces(text, [{ from: 0, to: 0 }]);
    const tables = of(pieces, "table");
    expect(tables.map((p) => slice(text, p))).toEqual([table]);
    expect(of(pieces, "math").map((p) => slice(text, p))).toEqual(["$y$"]);
    expect(of(pieces, "style").filter((p) => slice(text, p).includes("tabular"))).toHaveLength(0);
  });

  it("shows a table being edited as source, with its mathematics still drawn", () => {
    const text = `before\n${table}\nafter`;
    const pieces = visualPieces(text, [{ from: text.indexOf("Name"), to: text.indexOf("Name") }]);
    expect(of(pieces, "table")).toHaveLength(0);
    expect(of(pieces, "math").map((p) => slice(text, p))).toEqual(["$x$"]);
  });

  it("handles tables that take a width, and leaves an unfinished one alone", () => {
    const wide = "\\begin{tabularx}{\\textwidth}{lX}\n a & b \\\\\n\\end{tabularx}";
    expect(of(visualPieces(wide + "\n", [{ from: wide.length + 1, to: wide.length + 1 }]), "table")).toHaveLength(1);
    expect(of(visualPieces("\\begin{tabular}{ll}\n a & b \\\\\n", []), "table")).toHaveLength(0);
  });

  it("draws a table with another inside it as one table, to its own end", () => {
    const nested = "\\begin{tabular}{ll}\n a & \\begin{tabular}{c} x \\\\ y \\end{tabular} \\\\\n b & c \\\\\n\\end{tabular}";
    const text = `${nested}\nafter`;
    const tables = of(visualPieces(text, [{ from: text.length, to: text.length }]), "table");
    expect(tables.map((p) => slice(text, p))).toEqual([nested]);
  });

  it("draws a picture command as its picture, unless it is being edited", () => {
    const text = "x \\includegraphics[width=\\linewidth]{figs/plot} y";
    const away = visualPieces(text, [{ from: 0, to: 0 }]);
    expect(of(away, "image")).toEqual([{ kind: "image", from: 2, to: text.length - 2, path: "figs/plot" }]);
    const inside = visualPieces(text, [{ from: 10, to: 10 }]);
    expect(of(inside, "image")).toHaveLength(0);
    expect(of(inside, "style").map((p) => slice(text, p))).toEqual([text.slice(2, text.length - 2)]);
  });

  it("draws a citation with all its keys", () => {
    const text = "as shown \\citep[p. 3]{knuth84, lamport94} here";
    const cites = of(visualPieces(text, [{ from: 0, to: 0 }]), "cite");
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({ keys: ["knuth84", "lamport94"] });
  });

  it("names a citation by author and year, and marks a key nobody defines", () => {
    const index = {
      citeKeys: ["knuth84", "byhand"],
      citations: [{ key: "knuth84", authors: "Knuth", year: "1984", title: "The TeXbook" }],
    };
    expect(describeCitation(["knuth84"], index)).toEqual({ label: "[Knuth 1984]", detail: "Knuth. 1984. The TeXbook", unknown: false });
    expect(describeCitation(["knuth84", "byhand"], index).label).toBe("[Knuth 1984; byhand]");
    const missing = describeCitation(["nobody"], index);
    expect(missing.label).toBe("[nobody?]");
    expect(missing.unknown).toBe(true);
  });

  it("styles a caption as a caption", () => {
    const text = "\\caption{Results by year}";
    expect(of(visualPieces(text + "\n", [{ from: text.length + 1, to: text.length + 1 }]), "style")).toEqual([
      { kind: "style", from: 9, to: text.length - 1, style: "caption" },
    ]);
  });
});
