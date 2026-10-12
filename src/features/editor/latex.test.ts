import { describe, expect, it } from "vitest";
import { completionAt, outline } from "./latex";

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
