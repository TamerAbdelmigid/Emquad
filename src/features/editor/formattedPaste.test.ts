// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { formattedPaste } from "./formattedPaste";

const latex = (html: string) => formattedPaste(html)?.latex;

describe("pasting with formatting", () => {
  it("writes bold, italic, underline, superscript and subscript as LaTeX, and escapes the rest", () => {
    expect(latex("<p>Costs <b>rose 50%</b> for <i>R&amp;D</i>, see <u>this</u>.</p>")).toBe(
      "Costs \\textbf{rose 50\\%} for \\textit{R\\&D}, see \\underline{this}.",
    );
    expect(latex("<p>E = mc<sup>2</sup> and H<sub>2</sub>O</p>")).toBe("E = mc\\textsuperscript{2} and H\\textsubscript{2}O");
    // Formatting given in a style, as Google Docs and Word write it; not written twice.
    expect(latex('<p><span style="font-weight:700">bold <b>still</b></span> and <span style="font-style:italic">slanted</span></p>')).toBe(
      "\\textbf{bold still} and \\textit{slanted}",
    );
    expect(latex("<p><b><i>both</i></b></p>")).toBe("\\textbf{\\textit{both}}");
  });

  it("keeps each paragraph, and turns headings into sections", () => {
    expect(latex("<h1>Introduction</h1><p>First.</p><p>Second, <b>bold</b>.</p><h2><b>Method</b></h2>")).toBe(
      "\\section{Introduction}\n\nFirst.\n\nSecond, \\textbf{bold}.\n\n\\subsection{Method}",
    );
    // A line break ends a paragraph, but inside bold it is only a space.
    expect(latex("<p>one<br>two <b>a<br>b</b></p>")).toBe("one\n\ntwo \\textbf{a b}");
  });

  it("writes lists as itemize and enumerate, nested as they were", () => {
    expect(latex("<ul><li>Apples</li><li>Pears<ol><li><b>Conference</b></li></ol></li></ul>")).toBe(
      "\\begin{itemize}\n  \\item Apples\n  \\item Pears\n  \\begin{enumerate}\n    \\item \\textbf{Conference}\n  \\end{enumerate}\n\\end{itemize}",
    );
  });

  it("reads Word's own list paragraphs, leaving out the numbers Word writes itself", () => {
    const word =
      "<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp;</span></span>First step</p>" +
      "<p class=MsoListParagraphCxSpMiddle style='mso-list:l0 level2 lfo1'><span style='mso-list:Ignore'>o<span>&nbsp;</span></span>A detail</p>" +
      "<p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>2.<span>&nbsp;</span></span>Second step</p>" +
      "<p class=MsoNormal>After the list<o:p></o:p></p>";
    expect(latex(word)).toBe(
      "\\begin{enumerate}\n  \\item First step\n  \\begin{itemize}\n    \\item A detail\n  \\end{itemize}\n  \\item Second step\n\\end{enumerate}\n\nAfter the list",
    );
  });

  it("writes links with hyperref, and leaves out what is not text", () => {
    expect(formattedPaste('<p>See <a href="https://x.org/a#b">the site</a> or <a href="https://x.org">https://x.org</a>.</p>')).toEqual({
      latex: "See \\href{https://x.org/a\\#b}{the site} or \\url{https://x.org}.",
      packages: ["hyperref"],
    });
    expect(latex('<style>p{color:red}</style><p><b>Hi</b><img src="x.png"><script>alert(1)</script></p>')).toBe("\\textbf{Hi}");
  });

  it("leaves plain text, and tables, to the other ways of pasting", () => {
    expect(formattedPaste("<p>Just words &amp; more</p>")).toBeNull();
    expect(formattedPaste("<table><tr><td><b>a</b></td></tr></table>")).toBeNull();
  });
});
