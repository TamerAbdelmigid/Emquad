import { describe, expect, it } from "vitest";
import { latexPath } from "./latexPath";

const DOC = [
  "\\documentclass{article}",
  "\\begin{document}",
  "Before any heading.",
  "\\section{Introduction}",
  "Some \\textbf{bold and \\emph{both}} text.",
  "% \\begin{itemize} in a comment",
  "\\begin{itemize}",
  "  \\item one \\emph{two}",
  "\\end{itemize}",
  "\\subsection{A heading that is rather too long to show whole}",
  "\\begin{equation}",
  "  x = 1",
  "\\end{equation}",
  "\\end{document}",
].join("\n");
const at = (s: string, plus = 0) => DOC.indexOf(s) + plus;

describe("latexPath", () => {
  it("is empty before the first heading, and names the preamble there", () => {
    expect(latexPath(DOC, at("Before"))).toEqual([]);
    expect(latexPath(DOC, at("article"))).toEqual(["preamble"]);
  });

  it("names the section, then the commands the cursor is inside, outermost first", () => {
    expect(latexPath(DOC, at("Some"))).toEqual(["\\section{Introduction}"]);
    expect(latexPath(DOC, at("bold", 2))).toEqual(["\\section{Introduction}", "\\textbf"]);
    expect(latexPath(DOC, at("both", 1))).toEqual(["\\section{Introduction}", "\\textbf", "\\emph"]);
  });

  it("names the list and the item, and ignores what is in comments", () => {
    expect(latexPath(DOC, at("one"))).toEqual(["\\section{Introduction}", "itemize", "\\item"]);
    expect(latexPath(DOC, at("two", 1))).toEqual(["\\section{Introduction}", "itemize", "\\item", "\\emph"]);
    expect(latexPath(DOC, at("Some \\textbf", 40))).toEqual(["\\section{Introduction}"]);
  });

  it("shortens a long heading and names the environment", () => {
    expect(latexPath(DOC, at("x = 1"))).toEqual(["\\subsection{A heading that is rather…}", "equation"]);
  });
});
