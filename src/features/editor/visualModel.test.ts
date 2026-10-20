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

  it("draws a link's words as a link, its command and address hidden as one, and a bare address as a link", () => {
    const text = "See \\href{https://example.org}{the site} and \\url{https://a.b}.";
    const pieces = visualPieces(text, []);
    expect(of(pieces, "hide").map((p) => slice(text, p))).toEqual(["\\href{https://example.org}{", "}", "\\url{", "}"]);
    const hidden = of(pieces, "hide") as Extract<Piece, { kind: "hide" }>[];
    expect(hidden[0].group).toBe(hidden[1].group);
    expect(of(pieces, "style").filter((p) => p.kind === "style" && p.style === "link").map((p) => slice(text, p))).toEqual(["the site", "https://a.b"]);
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

  it("draws a list as a word processor does: bullets or numbers, without the lines that begin and end it", () => {
    const text = "Before\n\\begin{itemize}\n\\item one \\ref{a}\n\\item two\n  \\begin{enumerate}\n  \\item first\n  \\item second\n  \\end{enumerate}\n\\end{itemize}\nAfter";
    const pieces = visualPieces(text, []);
    const bullets = of(pieces, "bullet") as Extract<Piece, { kind: "bullet" }>[];
    expect(bullets.map((b) => b.label)).toEqual([undefined, undefined, "1.", "2."]);
    expect(of(pieces, "hide").map((p) => slice(text, p))).toEqual(["\\begin{itemize}\n", "  \\begin{enumerate}\n", "  \\end{enumerate}\n", "\\end{itemize}\n"]);
    expect(of(pieces, "ref").map((p) => slice(text, p))).toEqual(["\\ref{a}"]);
    // A line being worked on is shown as it is written.
    const at = text.indexOf("\\begin{enumerate}") + 3;
    expect(of(visualPieces(text, [{ from: at, to: at }]), "hide").map((p) => slice(text, p))).not.toContain("  \\begin{enumerate}\n");
  });

  it("draws references, footnotes and the parts LaTeX makes itself", () => {
    const text = "\\begin{document}\n\\maketitle\n\\tableofcontents\nSee \\ref{fig:a} and \\eqref{eq:b}.\\footnote{A \\emph{short} note.} More.\\footnote{Second.}\n\\newpage\n\\bibliography{refs}\n\\end{document}";
    const pieces = visualPieces(text, []);
    expect(of(pieces, "block").map((p) => (p as Extract<Piece, { kind: "block" }>).label)).toEqual(["Bibliography", "Title, author and date", "Table of contents", "Page break"]);
    expect(of(pieces, "ref").map((p) => (p as Extract<Piece, { kind: "ref" }>).command)).toEqual(["ref", "eqref"]);
    const notes = of(pieces, "footnote") as Extract<Piece, { kind: "footnote" }>[];
    expect(notes.map((n) => [n.number, n.text])).toEqual([[1, "A short note."], [2, "Second."]]);
  });

  it("still draws headings and bold text that hold a formula, and numbers footnotes as the PDF does", () => {
    const text = "\\documentclass{report}\n\\begin{document}\n\\section{The $n$-body problem}\nText \\textbf{bold $x$}.\\footnote{see $y$} Then\\footnote{plain}.\n\\chapter{Two}\nMore\\footnote{again}.\n\\end{document}";
    const pieces = visualPieces(text, []);
    expect(of(pieces, "line").map((p) => (p as Extract<Piece, { kind: "line" }>).style)).toContain("h1");
    expect(of(pieces, "style").map((p) => slice(text, p))).toEqual(expect.arrayContaining(["The $n$-body problem", "bold $x$", "\\footnote{see $y$}"]));
    // The footnote with a formula is a chip, but still counted: the next is 2, and a chapter starts again at 1.
    expect((of(pieces, "footnote") as Extract<Piece, { kind: "footnote" }>[]).map((f) => [f.text, f.number])).toEqual([["plain", 2], ["again", 1]]);
  });

  it("takes no \\begin{document} in a comment for the real one", () => {
    const text = "\\documentclass{article}\n% put the text after \\begin{document}\n\\usepackage{amsmath}\n\\begin{document}\nBody";
    const fold = of(visualPieces(text, [{ from: text.length, to: text.length }]), "fold");
    expect(fold.map((p) => slice(text, p))).toEqual([text.slice(0, text.indexOf("\nBody"))]);
  });

  it("folds the preamble into one line, named by the title, until the cursor goes into it", () => {
    const text = "\\documentclass{article}\n\\usepackage{amsmath}\n\\title{My \\emph{Great} Paper}\n\\begin{document}\n\\section{One}";
    const folded = visualPieces(text, [{ from: text.length, to: text.length }]);
    expect(of(folded, "fold").map((p) => [slice(text, p), (p as Extract<Piece, { kind: "fold" }>).title])).toEqual([[text.slice(0, text.indexOf("\n\\section")), "My Great Paper"]]);
    expect(of(folded, "line").filter((p) => (p as Extract<Piece, { kind: "line" }>).style === "preamble")).toHaveLength(0);
    // With the cursor in it, it is shown, quietly, with the title as a heading.
    const open = visualPieces(text, [{ from: 5, to: 5 }]);
    expect(of(open, "fold")).toHaveLength(0);
    expect(of(open, "line").filter((p) => (p as Extract<Piece, { kind: "line" }>).style === "preamble")).toHaveLength(2);
    expect(of(open, "style").map((p) => slice(text, p))).toContain("My \\emph{Great} Paper");
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

  it("ties together the hidden parts of one construct, so they are kept or removed together", () => {
    const text = "\\begin{document}\na \\textbf{b} c \\section{d}\n\\begin{itemize}\n\\item e\n\\end{itemize}\n\\end{document}";
    const hides = of(visualPieces(text, []), "hide") as Extract<Piece, { kind: "hide" }>[];
    const groups = new Map<number, string[]>();
    for (const h of hides) groups.set(h.group, [...(groups.get(h.group) ?? []), slice(text, h)]);
    expect([...groups.values()]).toEqual([["\\textbf{", "}"], ["\\section{", "}"], ["\\begin{itemize}\n", "\\end{itemize}\n"]]);
  });

  it("styles a caption as a caption", () => {
    const text = "\\caption{Results by year}";
    expect(of(visualPieces(text + "\n", [{ from: text.length + 1, to: text.length + 1 }]), "style")).toEqual([
      { kind: "style", from: 9, to: text.length - 1, style: "caption" },
    ]);
  });
});
