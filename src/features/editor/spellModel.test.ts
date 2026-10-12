import { describe, expect, it } from "vitest";
import { skipWord, spellWords } from "./spellModel";

const words = (text: string) => spellWords(text).map((w) => w.word);

describe("spellWords", () => {
  it("gives prose words with their exact place in the text", () => {
    const text = "A smal mistake.";
    const found = spellWords(text);
    expect(found.map((w) => w.word)).toEqual(["smal", "mistake"]);
    expect(found.map((w) => text.slice(w.from, w.to))).toEqual(["smal", "mistake"]);
  });

  it("leaves out commands, their options and technical arguments", () => {
    expect(words("See \\ref{sec:intro} and \\cite[p. 3]{knuth84} for \\textbf{bold} claims")).toEqual(["See", "and", "for", "bold", "claims"]);
    expect(words("\\includegraphics[width=0.5\\textwidth]{figs/plot} shown")).toEqual(["shown"]);
    expect(words("\\begin{itemize} \\item first \\end{itemize}")).toEqual(["first"]);
    expect(words("\\newcommand{\\foo}[1]{bar} text")).toEqual(["text"]);
  });

  it("keeps the readable argument of a link or a coloured passage", () => {
    expect(words("\\href{https://example.org/page}{the website}")).toEqual(["the", "website"]);
    expect(words("\\textcolor{red}{warning}")).toEqual(["warning"]);
  });

  it("leaves out mathematics, comments and verbatim text", () => {
    expect(words("If $x = yz$ then \\(abc\\) holds % not thiss\nnext")).toEqual(["If", "then", "holds", "next"]);
    expect(words("\\begin{equation}\n e = mc^2 \\text{foo}\n\\end{equation}\nafter")).toEqual(["after"]);
    expect(words("\\[ a + b \\] and $$ c $$ done")).toEqual(["and", "done"]);
    expect(words("\\begin{verbatim}\nint mian()\n\\end{verbatim}\nok \\verb|xyzzy| fine")).toEqual(["ok", "fine"]);
    expect(words("100\\% sure")).toEqual(["sure"]);
  });

  it("leaves out the preamble but reads the title", () => {
    const text = "\\documentclass{article}\n\\usepackage{amsmath}\n\\title{A Grand Titel}\n\\author{Some One}\n\\begin{document}\nBody text\n\\end{document}";
    expect(words(text)).toEqual(["Grand", "Titel", "Some", "One", "Body", "text"]);
  });

  it("does not split a word at an accent command, or judge its pieces", () => {
    expect(words("a na\\\"{\\i}ve caf\\'e visit")).toEqual(["visit"]);
  });

  it("keeps apostrophes inside words and drops them at the end", () => {
    expect(words("the authors' don't")).toEqual(["the", "authors", "don't"]);
  });

  it("does not take parts of identifiers or numbers for words", () => {
    expect(words("3cm x_1 file2 well-known")).toEqual(["well"]);
  });
});

describe("spellWords on awkward input", () => {
  it("treats a dollar sign that is not closed on its line as text", () => {
    expect(words("costs $5 today\nand $x$ tomorrow")).toEqual(["costs", "today", "and", "tomorrow"]);
    expect(words("an escaped \\$ sign and $a$ math")).toEqual(["an", "escaped", "sign", "and", "math"]);
    expect(words("empty $$ $$ display then \\(y\\) inline")).toEqual(["empty", "display", "then", "inline"]);
  });

  it("stays quick on long runs with nothing to find", () => {
    const started = Date.now();
    spellWords("x".repeat(200_000));
    spellWords("\\(".repeat(100_000));
    spellWords("$ ".repeat(100_000));
    spellWords("\\'e".repeat(60_000));
    spellWords(`${"a".repeat(100_000)}\\'e`);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("skipWord", () => {
  it("skips abbreviations and mixed-case names", () => {
    expect(skipWord("NASA")).toBe(true);
    expect(skipWord("LaTeX")).toBe(true);
    expect(skipWord("Paris")).toBe(false);
    expect(skipWord("word")).toBe(false);
  });
});
