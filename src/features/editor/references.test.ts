import { describe, expect, it } from "vitest";
import type { LabelPlace } from "../../ipc/bindings/LabelPlace";
import { bookmarkProblem, crossReference, headingLine, hyperrefChange, labelGroups, linkFor, linkProblem, moveSection, sectionAt, stepSection } from "./references";

const place = (key: string, kind: string, caption = "", file = "main.tex", line = 1): LabelPlace => ({ key, kind, caption, file, line });

describe("the cross-reference picker", () => {
  it("lists every label by kind, in Word's order, each with its number from the last compile and its caption", () => {
    const groups = labelGroups(
      [place("fig:b", "figure", "Wells", "main.tex", 9), place("sec:a", "section", "Methods", "main.tex", 2), place("eq:c", "equation"), place("odd", ""), place("fig:a", "figure", "Map", "main.tex", 5)],
      { "fig:a": { number: "1", page: "2", title: "", kind: "" }, "sec:a": { number: "2", page: "1", title: "", kind: "" } },
    );
    expect(groups.map((g) => g.name)).toEqual(["Headings", "Figures", "Equations", "Other places"]);
    expect(groups[1].items.map((i) => [i.key, i.text])).toEqual([
      ["fig:a", "Figure 1: Map"],
      ["fig:b", "Figure ?: Wells"],
    ]);
    expect(groups[0].items[0].text).toBe("2 Methods");
  });

  it("writes the reference as the reader is to see it: the kind and number, the number alone, or the page", () => {
    expect(crossReference("fig:a", "named")).toEqual({ tex: "\\Cref{fig:a}", packages: ["cleveref"] });
    expect(crossReference("fig:a", "number")).toEqual({ tex: "\\ref{fig:a}", packages: [] });
    expect(crossReference("fig:a", "page")).toEqual({ tex: "\\pageref{fig:a}", packages: [] });
  });
});

describe("links and bookmarks", () => {
  it("writes a link with its text as it prints, and the address's % and # escaped for \\href", () => {
    expect(linkFor("https://example.org/a%20b#top", "R&D site")).toBe("\\href{https://example.org/a\\%20b\\#top}{R\\&D site}");
    expect(linkFor("https://example.org", "")).toBe("\\url{https://example.org}");
    expect(linkFor("  ", "x")).toBeNull();
  });

  it("names a bookmark only with what a label may hold, and never twice", () => {
    expect(bookmarkProblem("sec:intro", ["fig:a"])).toBeNull();
    expect(bookmarkProblem("sec:a", ["sec:a"])).toMatch(/already/);
    expect(bookmarkProblem("my place", [])).toMatch(/letters/);
    expect(bookmarkProblem("", [])).toMatch(/name/);
  });
});

describe("what the review found", () => {
  const apply = (text: string, changes: { from: number; to: number; insert: string }[] | null) => {
    if (!changes) return null;
    return [...changes].sort((x, y) => y.from - x.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text);
  };
  const lineOf = (text: string, s: string) => text.slice(0, text.indexOf(s)).split("\n").length;

  it("puts a link only around words of the document's text that a command can hold", () => {
    const doc = "\\documentclass{article}\n\\begin{document}\n\\textbf{bold} and plain.\n\\begin{itemize}\n\\item a\n\\end{itemize}\n\\end{document}\n";
    const at = (s: string) => doc.indexOf(s);
    expect(linkProblem(doc, at("and"), at("and") + 3)).toBeNull();
    expect(linkProblem(doc, at("bold") + 2, at(" plain"))).toMatch(/formatting|cannot/);
    expect(linkProblem(doc, 0, doc.length)).toMatch(/settings|cannot/);
    expect(linkProblem(doc, at("\\item"), at("\\end{itemize}") + 5)).toMatch(/cannot/);
    expect(linkProblem(doc, 3, 3)).toMatch(/settings/);
  });

  it("puts a link in a chapter file brought in with \\input, which has no settings of its own", () => {
    const chapter = "\\chapter{Results}\nSee the survey site.\n";
    expect(linkProblem(chapter, chapter.indexOf("survey"), chapter.indexOf("survey") + 6)).toBeNull();
  });

  it("does not move a section that begins an environment ended in the next one, and keeps text before an \\end on its line with its section", () => {
    const opened = "\\section{A}\na\n\\begin{landscape}\n\\section{B}\nb\n\\end{landscape}\n\\section{C}\nc\n";
    expect(moveSection(opened, 1, lineOf(opened, "\\section{C}"))).toBeNull();
    expect(stepSection(opened, 1, 1)).toBeNull();
    const shared = "\\begin{multicols}{2}\n\\section{A}\nb \\end{multicols}\n\\section{C}\nc\n";
    const a = sectionAt(shared, 2)!;
    expect(shared.slice(a.from, a.to)).toBe("\\section{A}\nb ");
  });

  it("writes an address with braces or backslashes so that it still reads as one", () => {
    expect(linkFor("https://x.org/{a}\\b", "w")).toBe("\\href{https://x.org/\\%7Ba\\%7D\\%5Cb}{w}");
  });

  it("finds cleveref anywhere on its line, to load hyperref before it", () => {
    const text = "\\documentclass{article}\n\\usepackage{amsmath}\\usepackage{cleveref}\n\\begin{document}\nx\n\\end{document}\n";
    const out = text.slice(0, hyperrefChange(text)!.from) + hyperrefChange(text)!.insert + text.slice(hyperrefChange(text)!.to);
    expect(out.indexOf("{hyperref}")).toBeLessThan(out.indexOf("{cleveref}"));
  });

  it("keeps a heading on a line of its own when it moves to the end of a text that ends without a line break", () => {
    const text = "\\section{A}\nText a.\n\\section{B}\nText b. % note";
    expect(apply(text, moveSection(text, 1, null))).toBe("\\section{B}\nText b. % note\n\\section{A}\nText a.\n");
  });

  it("moves only the section: not the \\begin{document} on its line, nor the \\end of an environment it is in, nor the bibliography's style", () => {
    const begun = "\\begin{document}\\section{A}\nText a.\n\\section{B}\nText b.\n\\end{document}\n";
    expect(apply(begun, moveSection(begun, 1, null))).toBe("\\begin{document}\\section{B}\nText b.\n\\section{A}\nText a.\n\\end{document}\n");
    const inside = "\\section{A}\nText a.\n\\begin{multicols}{2}\n\\section{B}\nText b.\n\\end{multicols}\n\\section{C}\nText c.\n";
    const b = sectionAt(inside, lineOf(inside, "\\section{B}"))!;
    expect(inside.slice(b.from, b.to)).toBe("\\section{B}\nText b.\n");
    const styled = "\\section{A}\nText a.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n";
    const a = sectionAt(styled, 1)!;
    expect(styled.slice(a.from, a.to)).toBe("\\section{A}\nText a.\n");
  });

  it("steps a section down past the next of its level, but never past the appendix", () => {
    const text = "\\section{A}\nText a.\n\\section{B}\nText b.\n\\appendix\n\\section{X}\nText x.\n";
    expect(apply(text, stepSection(text, 1, 1))).toBe("\\section{B}\nText b.\n\\section{A}\nText a.\n\\appendix\n\\section{X}\nText x.\n");
    expect(stepSection(text, lineOf(text, "\\section{B}"), 1)).toBeNull();
    const three = "\\section{A}\nText a.\n\\section{B}\nText b.\n\\section{C}\nText c.\n\\appendix\n";
    expect(apply(three, stepSection(three, 1, 1))).toBe("\\section{B}\nText b.\n\\section{A}\nText a.\n\\section{C}\nText c.\n\\appendix\n");
    expect(apply(three, stepSection(three, lineOf(three, "\\section{B}"), 1))).toBe("\\section{A}\nText a.\n\\section{C}\nText c.\n\\section{B}\nText b.\n\\appendix\n");
    expect(apply(three, stepSection(three, lineOf(three, "\\section{B}"), -1))).toBe("\\section{B}\nText b.\n\\section{A}\nText a.\n\\section{C}\nText c.\n\\appendix\n");
  });

  it("finds a heading again by its title when the outline it was read from is out of date", () => {
    const text = "\\section{A}\nText.\n\\section{B}\n";
    expect(headingLine(text, 3, "B")).toBe(3);
    expect(headingLine(text, 1, "B")).toBe(3);
    expect(headingLine(text, 1, "Z")).toBeNull();
  });
});

describe("the packages links and references need", () => {
  const doc = (preamble: string) => `\\documentclass{article}\n${preamble}\\begin{document}\nText.\n\\end{document}\n`;
  const apply = (text: string, c: { from: number; to: number; insert: string } | null) => (c ? text.slice(0, c.from) + c.insert + text.slice(c.to) : text);

  it("loads hyperref for a link before cleveref, which has to come after it", () => {
    expect(apply(doc("\\usepackage{cleveref}\n"), hyperrefChange(doc("\\usepackage{cleveref}\n")))).toBe(doc("\\usepackage{hyperref}\n\\usepackage{cleveref}\n"));
    expect(apply(doc(""), hyperrefChange(doc("")))).toBe(doc("\\usepackage{hyperref}\n"));
    expect(hyperrefChange(doc("\\usepackage[colorlinks]{hyperref}\n"))).toBeNull();
  });
});

describe("moving a section with everything under it", () => {
  const DOC = "\\begin{document}\n\\section{A}\nText a.\n\\subsection{A1}\nText a1.\n\n\\section{B}\nText b.\n\\section{C}\nText c.\n\\bibliography{refs}\n\\end{document}\n";
  const line = (s: string) => DOC.slice(0, DOC.indexOf(s)).split("\n").length;

  it("finds the stretch a heading heads: to the next heading of its level or above, or the end of the text", () => {
    const a = sectionAt(DOC, line("\\section{A}"))!;
    expect(DOC.slice(a.from, a.to)).toBe("\\section{A}\nText a.\n\\subsection{A1}\nText a1.\n\n");
    const c = sectionAt(DOC, line("\\section{C}"))!;
    expect(DOC.slice(c.from, c.to)).toBe("\\section{C}\nText c.\n");
    expect(sectionAt(DOC, line("Text b."))).toBeNull();
  });

  it("moves a section before another heading, or to the end, the words kept exactly", () => {
    const moved = (from: string, before: string | null) => {
      const changes = moveSection(DOC, line(from), before === null ? null : line(before));
      if (!changes) return null;
      return [...changes].sort((x, y) => y.from - x.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), DOC);
    };
    expect(moved("\\section{C}", "\\section{A}")).toBe("\\begin{document}\n\\section{C}\nText c.\n\\section{A}\nText a.\n\\subsection{A1}\nText a1.\n\n\\section{B}\nText b.\n\\bibliography{refs}\n\\end{document}\n");
    expect(moved("\\section{A}", null)).toBe("\\begin{document}\n\\section{B}\nText b.\n\\section{C}\nText c.\n\\section{A}\nText a.\n\\subsection{A1}\nText a1.\n\n\\bibliography{refs}\n\\end{document}\n");
    // Into itself, or where it is already, nothing moves.
    expect(moved("\\section{A}", "\\subsection{A1}")).toBeNull();
    expect(moved("\\section{A}", "\\section{A}")).toBeNull();
    expect(moved("\\section{A}", "\\section{B}")).toBeNull();
  });
});
