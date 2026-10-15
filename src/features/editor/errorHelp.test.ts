import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../ipc/api";
import { explain, findUnclosed, locate } from "./errorHelp";

const error = (message: string, line = 3, file = "main.tex"): Diagnostic => ({ severity: "error", file, line, message });
const source = (lines: string[]) => (path: string) => (path === "main.tex" ? lines.join("\n") : undefined);
const none = () => false;

describe("explaining compile errors", () => {
  it("names the package an unknown command comes from, and offers to load it", () => {
    const text = source(["\\documentclass{article}", "\\begin{document}", "\\includegraphics{plot} and \\foo"]);
    expect(explain(error("Undefined control sequence."), text, none)).toEqual({
      text: "\\includegraphics comes from the graphicx package, which this document does not load.",
      fix: { kind: "package", label: "Add \\usepackage{graphicx}", name: "graphicx" },
    });
    // Loaded already: the command is misspelled, or comes from elsewhere.
    expect(explain(error("Undefined control sequence."), text, () => true)?.text).toMatch(/check the spelling of \\includegraphics, \\foo/);
  });

  it("offers to escape a character typed in text that LaTeX acts on", () => {
    // The & of a formula is left alone; the one in the text is the one to escape.
    const text = source(["", "", "With $a & b$ for R&D, see."]);
    expect(explain(error("Misplaced alignment tab character &."), text, none)?.fix).toEqual({ kind: "escape", label: "Write it as \\&", file: "main.tex", line: 3, column: 19, char: "&" });
    const under = source(["", "", "See file_name in $x_1$."]);
    expect(explain(error("Missing $ inserted."), under, none)?.fix).toMatchObject({ kind: "escape", column: 9, char: "_" });
  });

  it("explains environments, missing files and mismatched ends", () => {
    expect(explain(error("LaTeX Error: Environment align undefined."), source([]), none)?.fix).toMatchObject({ kind: "package", name: "amsmath" });
    expect(explain(error("LaTeX Error: File `plot.png' not found."), source([]), none)?.text).toMatch(/plot\.png is not in the project/);
    expect(explain(error("LaTeX Error: \\begin{itemize} on input line 4 ended by \\end{enumerate}."), source([]), none)?.fix).toEqual({
      kind: "go",
      label: "Go to line 4",
      file: "main.tex",
      line: 4,
    });
  });

  it("treats a line a little too wide as a note, not an error", () => {
    expect(explain({ severity: "warning", file: "main.tex", line: 2, message: "Overfull \\hbox (3.2pt too wide) in paragraph" }, source([]), none)?.note).toBe(true);
    expect(explain(error("Something LaTeX says that we have no words for"), source([]), none)).toBeNull();
  });
});

describe("finding what was never closed", () => {
  it("finds an unclosed brace, an unended environment, or one with nothing to close", () => {
    expect(findUnclosed("a\n\\textbf{b\nc")).toEqual({ line: 2, what: "brace" });
    expect(findUnclosed("\\begin{document}\n\\begin{itemize}\n\\item x\n\\end{document}")).toEqual({ line: 4, what: "extra" });
    expect(findUnclosed("\\begin{document}\n\\begin{center}\nx")).toEqual({ line: 2, what: "environment" });
    expect(findUnclosed("x}")).toEqual({ line: 1, what: "extra" });
    expect(findUnclosed("% {\n\\{ \\} {a}\n\\begin{document}\n\\end{document}")).toBeNull();
  });

  it("places an error the compiler gave no line for", () => {
    const text = source(["\\begin{document}", "\\emph{open", "more", "\\end{document}"]);
    expect(locate(error("Runaway argument?", 0), text)).toEqual({ kind: "go", label: "Go to the { that is never closed, line 2", file: "main.tex", line: 2 });
    expect(locate(error("Runaway argument?", 5), text)).toBeUndefined();
  });
});

describe("fixes only where they are certain", () => {
  const fixFor = (message: string, line: string, loaded: (name: string) => boolean = none) =>
    explain(error(message, 1), source([line]), loaded)?.fix;

  it("never escapes a label, a reference, an address, \\verb or a formula", () => {
    expect(fixFor("Missing $ inserted.", "Text with \\alpha and \\label{sec_intro}")).toBeUndefined();
    expect(fixFor("Missing $ inserted.", "see \\ref{fig_one} where x_1 holds")).toMatchObject({ column: 26, char: "_" });
    expect(fixFor("Misplaced alignment tab character &.", "See \\href{https://x.org/?a=1&b=2}{Q&A}.")).toMatchObject({ column: 36, char: "&" });
    expect(fixFor("Misplaced alignment tab character &.", "\\verb|a&b| and R&D")).toMatchObject({ column: 17 });
    expect(fixFor("You can't use `macro parameter character #' in horizontal mode.", "\\url{http://x/#a} and C# code")).toMatchObject({ column: 24 });
    expect(fixFor("Missing $ inserted.", "$$a_1$$ and \\alpha")).toBeUndefined();
    // Two candidates: which one is at fault is not certain, so no fix is offered.
    expect(fixFor("Missing $ inserted.", "a_b and c_d")).toBeUndefined();
    // Inside an equation over several lines.
    const eq = source(["\\begin{equation}", "x_1 + y", "\\end{equation}"]);
    expect(explain(error("Missing $ inserted.", 2), eq, none)?.fix).toBeUndefined();
  });

  it("never offers natbib to a document using biblatex, nor biblatex to one using BibTeX", () => {
    const biblatex = (name: string) => name === "biblatex";
    expect(explain(error("Undefined control sequence.", 1), source(["As \\citep{a} shows"]), biblatex)).toEqual({ text: expect.stringMatching(/parencite/) });
    expect(explain(error("Undefined control sequence.", 1), source(["\\printbibliography"]), none)).toEqual({ text: expect.stringMatching(/\\bibliography/) });
  });

  it("does not take a % in an address, \\\\ before a brace, or braces in verbatim for something unclosed", () => {
    expect(findUnclosed("a \\url{50%} b {c}")).toBeNull();
    expect(findUnclosed("a \\\\{\\bf b}")).toBeNull();
    expect(findUnclosed("\\begin{verbatim}\n{ not a brace\n\\end{verbatim}\nok")).toBeNull();
    expect(findUnclosed("\\verb|{| and {x}")).toBeNull();
    expect(findUnclosed("line one\n\\begin{verbatim}\n{\n\\end{verbatim}\n\\textbf{open")).toEqual({ line: 5, what: "brace" });
  });
});
