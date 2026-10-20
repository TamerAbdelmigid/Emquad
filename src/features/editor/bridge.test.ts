import { describe, expect, it } from "vitest";
import { bodyProblem, commandProblem, compiledLines, defineCommand, myCommands, packagesExplained, replaceable } from "./bridge";

const doc = (preamble: string, body = "Text.") => `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;
const apply = (text: string, c: { from: number; to: number; insert: string }) => text.slice(0, c.from) + c.insert + text.slice(c.to);

describe("My commands", () => {
  it("reads the commands of the document's own that take nothing, as buttons show them", () => {
    const text = doc("\\newcommand{\\gwr}{groundwater recharge}\n\\newcommand\\etal{\\textit{et al.}}\n\\newcommand{\\vect}[1]{\\mathbf{#1}}\n% \\newcommand{\\gone}{x}\n");
    expect(myCommands(text).map((c) => [c.name, c.body])).toEqual([
      ["gwr", "groundwater recharge"],
      ["etal", "\\textit{et al.}"],
    ]);
  });

  it("names a new command only with letters, and never one that exists", () => {
    const text = doc("\\newcommand{\\gwr}{x}\n");
    expect(commandProblem("rech", text)).toBeNull();
    expect(commandProblem("gwr", text)).toMatch(/already/);
    expect(commandProblem("section", text)).toMatch(/LaTeX/);
    expect(commandProblem("my cmd", text)).toMatch(/letters/);
    expect(commandProblem("", text)).toMatch(/name/);
  });

  it("never takes a name the document defines in any way, an environment's, a one-letter one, or a common LaTeX one", () => {
    const text = doc("\\newcommand{\\vect}[1]{\\mathbf{#1}}\n\\DeclareMathOperator{\\argmax}{arg\\,max}\n\\def\\old{x}\n\\newenvironment{note}{}{}\n");
    for (const name of ["vect", "argmax", "old", "note", "figure", "abstract", "text", "max", "S", "c"]) expect(commandProblem(name, text), name).not.toBeNull();
  });

  it("refuses what a command cannot print as it is: braces that do not close, a comment, a #, a line break", () => {
    expect(bodyProblem("groundwater \\textit{recharge}")).toBeNull();
    expect(bodyProblem("old} text")).toMatch(/brace/);
    expect(bodyProblem("50% more")).toMatch(/%/);
    expect(bodyProblem("item #1")).toMatch(/#/);
    expect(bodyProblem("two\nlines")).toMatch(/line/);
    expect(bodyProblem("a \\begin{itemize}")).toMatch(/environment|list/);
    expect(bodyProblem("")).toMatch(/print/);
  });

  it("puts the command in place of the selection only where that is the words it prints, in the document's text, inside no name or address", () => {
    const text = doc("", "Groundwater recharge, see \\ref{fig:recharge} and \\textbf{recharge} rates.");
    const at = (words: string, nth = 0) => {
      let i = -1;
      for (let n = 0; n <= nth; n++) i = text.indexOf(words, i + 1);
      return [i, i + words.length] as const;
    };
    expect(replaceable(text, ...at("Groundwater recharge"), "Groundwater recharge")).toBe(true);
    expect(replaceable(text, ...at("recharge", 2), "recharge")).toBe(true);
    expect(replaceable(text, ...at("recharge", 1), "recharge")).toBe(false);
    expect(replaceable(text, ...at("Groundwater"), "Groundwater recharge")).toBe(false);
    expect(replaceable(text, ...at("article"), "article")).toBe(false);
    expect(replaceable(text, 5, 5, "")).toBe(false);
  });

  it("writes the command once, at the end of the settings at the top", () => {
    const text = doc("\\usepackage{amsmath}\n");
    expect(apply(text, defineCommand(text, "gwr", "groundwater recharge")!)).toBe(doc("\\usepackage{amsmath}\n\\newcommand{\\gwr}{groundwater recharge}\n"));
    expect(defineCommand("\\section{No preamble}", "x", "y")).toBeNull();
  });
});

describe("blocks drawn from the PDF", () => {
  it("finds a block's lines as the compile read them, the copy nearest where it is now, or none once it has changed", () => {
    const pic = "\\begin{tikzpicture}\n\\draw (0,0);\n\\end{tikzpicture}";
    const compiled = `A\n${pic}\nB\nC\nD\n${pic}\nE\n`;
    expect(compiledLines(compiled, pic, 2)).toEqual({ from: 2, to: 4 });
    // Three lines typed above the second since the compile: it is still the second.
    expect(compiledLines(compiled, pic, 11)).toEqual({ from: 8, to: 10 });
    expect(compiledLines(compiled, pic.replace("0,0", "1,1"), 2)).toBeNull();
  });
});

describe("the preamble, explained", () => {
  it("says what each package is for and which tool loads it, and keeps the ones it does not know", () => {
    const text = doc("\\usepackage[margin=2cm]{geometry}\n\\usepackage{amsmath, amssymb}\n\\usepackage[normalem]{ulem}\n\\usepackage{mystuff}\n% \\usepackage{float}\n");
    const list = packagesExplained(text);
    expect(list.map((p) => p.name)).toEqual(["geometry", "amsmath", "amssymb", "ulem", "mystuff"]);
    expect(list[0]).toMatchObject({ options: "margin=2cm", line: 2, by: "Layout ▸ Margins, Size, Orientation" });
    expect(list[0].what).toMatch(/margins/i);
    expect(list[3].by).toMatch(/Strikethrough/);
    expect(list[4]).toMatchObject({ what: "", by: "" });
  });
});
