import { describe, expect, it } from "vitest";
import { inGroup, literalAt, looksLikeLatex, pastedText } from "./paste";

describe("pasting text from elsewhere", () => {
  it("writes the characters LaTeX treats specially so that they print", () => {
    expect(pastedText("Profits rose 50% for R&D, see file_name #3 at ~ $5.", false, false)).toBe(
      "Profits rose 50\\% for R\\&D, see file\\_name \\#3 at \\textasciitilde{} \\$5.",
    );
  });

  it("makes each line of text from a word processor a paragraph of its own", () => {
    expect(pastedText("First paragraph.\r\nSecond paragraph.\r\n", true, false)).toBe("First paragraph.\n\nSecond paragraph.");
    // Plain text keeps its lines as they are.
    expect(pastedText("one\ntwo", false, false)).toBe(null);
  });

  it("joins paragraphs pasted inside a command's braces, where a paragraph cannot end", () => {
    expect(pastedText("First.\r\nSecond.", true, false, true)).toBe("First. Second.");
    const text = "Before.\n\n\\textbf{} and {a} % {\nafter";
    expect(inGroup(text, text.indexOf("{}") + 1)).toBe(true);
    expect(inGroup(text, text.indexOf(" and"))).toBe(false);
    expect(inGroup(text, text.indexOf("after"))).toBe(false);
  });

  it("leaves LaTeX, mathematics and plain words as they are", () => {
    expect(looksLikeLatex("\\section{Intro} 50\\% done")).toBe(true);
    expect(looksLikeLatex("where $x_1 + y$ holds")).toBe(true);
    expect(pastedText("\\textbf{bold} & more", false, false)).toBe(null);
    expect(pastedText("a_1 + b_2", false, true)).toBe(null);
    expect(pastedText("Nothing special here", false, false)).toBe(null);
    // Escapes already written are never doubled.
    expect(pastedText("50\\% of cases, R\\&D", false, false)).toBe(null);
    expect(pastedText("Use \\noindent here", false, false)).toBe(null);
  });

  it("leaves addresses, names and code as they are written", () => {
    const text = "See \\url{} and \\includegraphics[width=2cm]{} and \\label{}.\n\\begin{lstlisting}\n\n\\end{lstlisting}\nplain";
    expect(literalAt(text, text.indexOf("\\url{") + 5)).toBe(true);
    expect(literalAt(text, text.indexOf("graphics[width=2cm]{") + 20)).toBe(true);
    expect(literalAt(text, text.indexOf("\\label{") + 7)).toBe(true);
    expect(literalAt(text, text.indexOf("\n\n\\end") + 1)).toBe(true);
    expect(literalAt(text, text.indexOf("plain"))).toBe(false);
    expect(literalAt(text, text.indexOf(" and"))).toBe(false);
  });
});
