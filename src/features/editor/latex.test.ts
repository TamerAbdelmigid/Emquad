import { describe, expect, it } from "vitest";
import { headingAt, setHeading, toggleCommand, completionAt, outline } from "./latex";

describe("outline", () => {
  it("lists sectioning commands in order with their lines and levels", () => {
    const text = [
      "\\documentclass{article}",
      "\\section{Introduction}",
      "text",
      "  \\subsection*{The {polar} trick}",
      "% \\section{Commented out}",
      "50\\% done \\section[short]{Results}",
    ].join("\n");
    expect(outline(text)).toEqual([
      { level: 2, title: "Introduction", line: 2 },
      { level: 3, title: "The {polar} trick", line: 4 },
      { level: 2, title: "Results", line: 6 },
    ]);
  });
});

describe("completionAt", () => {
  it("offers commands after a backslash", () => {
    expect(completionAt("see \\sec")).toEqual({ kind: "command", from: 5, typed: "sec" });
    expect(completionAt("\\")).toEqual({ kind: "command", from: 1, typed: "" });
  });
  it("offers labels inside reference commands", () => {
    expect(completionAt("as in \\ref{eq:")).toEqual({ kind: "label", from: 11, typed: "eq:" });
    expect(completionAt("\\eqref{")?.kind).toBe("label");
  });
  it("offers citation keys, completing the entry after the last comma", () => {
    expect(completionAt("\\cite{knuth84, lam")).toEqual({ kind: "cite", from: 15, typed: "lam" });
    expect(completionAt("\\citep{")?.kind).toBe("cite");
  });
  it("offers environments inside begin and end", () => {
    expect(completionAt("\\begin{equ")).toEqual({ kind: "environment", from: 7, typed: "equ" });
  });
  it("stays quiet in ordinary text and in other arguments", () => {
    expect(completionAt("plain text")).toBeNull();
    expect(completionAt("\\section{Intro")).toBeNull();
  });
});

describe("tools that act on what is written", () => {
  const apply = (text: string, changes: { from: number; to: number; insert: string }[]) =>
    [...changes].sort((a, b) => b.from - a.from).reduce((out, c) => out.slice(0, c.from) + c.insert + out.slice(c.to), text);

  it("change the level of the heading the cursor is in, or make it plain text", () => {
    const text = "Intro.\n\\section*{The {first} part}\nText.";
    const pos = text.indexOf("first");
    expect(headingAt(text, pos)?.level).toBe("section");
    expect(apply(text, setHeading(text, pos, "subsection")!)).toBe("Intro.\n\\subsection*{The {first} part}\nText.");
    expect(apply(text, setHeading(text, pos, null)!)).toBe("Intro.\nThe {first} part\nText.");
    expect(setHeading(text, 2, "section")).toBeNull();
  });

  it("set the selection in bold, or take it out when it is bold already", () => {
    const text = "a big word";
    const on = toggleCommand(text, 2, 5, "textbf");
    const bold = apply(text, on.changes);
    expect(bold).toBe("a \\textbf{big} word");
    expect(bold.slice(on.select.from, on.select.to)).toBe("big");
    // Selected as it was left: just its text.
    expect(apply(bold, toggleCommand(bold, on.select.from, on.select.to, "textbf").changes)).toBe(text);
    // Selected whole, command and all.
    expect(apply(bold, toggleCommand(bold, 2, bold.indexOf(" word"), "textbf").changes)).toBe(text);
    // With nothing selected, inside it.
    expect(apply(bold, toggleCommand(bold, bold.indexOf("ig"), bold.indexOf("ig"), "textbf").changes)).toBe(text);
    // With nothing selected anywhere else, an empty one to type in.
    expect(apply(text, toggleCommand(text, 0, 0, "textit").changes)).toBe("\\textit{}a big word");
    // Inside another command's group, it is not taken for this one.
    const italic = "an \\textit{odd} one";
    expect(apply(italic, toggleCommand(italic, 12, 12, "textbf").changes)).toBe("an \\textit{o\\textbf{}dd} one");
  });
});
