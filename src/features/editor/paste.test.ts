import { describe, expect, it } from "vitest";
import { looksLikeLatex, pastedText } from "./paste";

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

  it("leaves LaTeX, mathematics and plain words as they are", () => {
    expect(looksLikeLatex("\\section{Intro} 50\\% done")).toBe(true);
    expect(looksLikeLatex("where $x_1 + y$ holds")).toBe(true);
    expect(pastedText("\\textbf{bold} & more", false, false)).toBe(null);
    expect(pastedText("a_1 + b_2", false, true)).toBe(null);
    expect(pastedText("Nothing special here", false, false)).toBe(null);
    // A Windows path is not LaTeX.
    expect(pastedText("C:\\Users\\Me\\thesis_final", false, false)).toBe("C:\\textbackslash{}Users\\textbackslash{}Me\\textbackslash{}thesis\\_final");
  });
});
