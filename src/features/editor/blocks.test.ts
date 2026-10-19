import { describe, expect, it } from "vitest";
import { alignmentAt, blockStyleAt, environments, paragraphLines, setAlignment, setBlockStyle } from "./blocks";
import { applyChanges } from "./lists";
import { visualPieces } from "./visualModel";

const DOC = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;
const body = (out: string) => out.slice(out.indexOf("\\begin{document}\n") + 17, out.lastIndexOf("\n\\end{document}"));
const lineStyles = (text: string) =>
  visualPieces(text, [])
    .filter((p) => p.kind === "line")
    .map((p) => `${text.slice(p.from, text.indexOf("\n", p.from))}:${"style" in p ? p.style : ""}`);

describe("paragraphs", () => {
  it("are the lines between blank lines, headings and environments", () => {
    const text = DOC("\\section{A}\nOne line\nand two.\n\nNext.");
    const lines = paragraphLines(text, text.indexOf("two"), text.indexOf("two"))!;
    expect(text.slice(lines.from, lines.to)).toBe("One line\nand two.");
    expect(paragraphLines(text, 3, 3)).toBeNull();
  });

  it("take a list whole, and are not found in a formula", () => {
    const text = DOC("\\begin{itemize}\n  \\item a\n\\end{itemize}\n\\begin{equation}\n  x\n\\end{equation}");
    const lines = paragraphLines(text, text.indexOf("a\n"), text.indexOf("a\n"))!;
    expect(text.slice(lines.from, lines.to)).toBe("\\begin{itemize}\n  \\item a\n\\end{itemize}");
    expect(paragraphLines(text, text.indexOf("x\n"), text.indexOf("x\n"))).toBeNull();
  });

  it("are not found where they would cut a command's braces in two", () => {
    const heading = DOC("\\section{A very long\n  title}\nText of the section.");
    expect(setAlignment(heading, heading.indexOf("Text"), heading.indexOf("Text"), "center")).toBeNull();
    expect(setBlockStyle(heading, heading.indexOf("title"), heading.indexOf("title"), "quote")).toBeNull();
    const group = DOC("{\\small Para one\n\nPara two}");
    expect(setAlignment(group, group.indexOf("two"), group.indexOf("two"), "center")).toBeNull();
    const verb = DOC("Code \\verb|{| here.");
    expect(setAlignment(verb, verb.indexOf("here"), verb.indexOf("here"), "center")).not.toBeNull();
  });

  it("are read past environments written in a comment", () => {
    expect(environments("% \\begin{center}\n\\begin{quote}x\\end{quote}").map((e) => e.name)).toEqual(["quote"]);
  });
});

describe("alignment", () => {
  it("centres a paragraph in a center environment, drawn centred with its lines hidden", () => {
    const text = DOC("Before.\n\nCentre me.\n\nAfter.");
    const out = applyChanges(text, setAlignment(text, text.indexOf("me."), text.indexOf("me."), "center")!);
    expect(body(out)).toBe("Before.\n\n\\begin{center}\nCentre me.\n\\end{center}\n\nAfter.");
    expect(lineStyles(out)).toContain("Centre me.:align-center");
    expect(alignmentAt(out, out.indexOf("me."))).toBe("center");
  });

  it("changes the environment for another alignment, and takes it away for justified", () => {
    const text = DOC("\\begin{center}\nText.\n\\end{center}");
    const right = applyChanges(text, setAlignment(text, text.indexOf("Text"), text.indexOf("Text"), "right")!);
    expect(body(right)).toBe("\\begin{flushright}\nText.\n\\end{flushright}");
    expect(lineStyles(right)).toContain("Text.:align-right");
    const justified = applyChanges(right, setAlignment(right, right.indexOf("Text"), right.indexOf("Text"), "justify")!);
    expect(body(justified)).toBe("Text.");
    expect(setAlignment(justified, justified.indexOf("Text"), justified.indexOf("Text"), "justify")).toBeNull();
    expect(setAlignment(text, text.indexOf("Text"), text.indexOf("Text"), "center")).toBeNull();
  });

  it("refuses where the lines would cut an environment in two", () => {
    const text = DOC("\\begin{minipage}{3cm}\nText.\n\\end{minipage}");
    expect(setAlignment(text, text.indexOf("\\begin{mini") - 1, text.indexOf("Text"), "center")).toBeNull();
  });
});

describe("Quote and Abstract from the styles gallery", () => {
  it("set the paragraph in a quote or the abstract, changing one into the other, and Normal takes it off", () => {
    const text = DOC("Said once.");
    const quoted = applyChanges(text, setBlockStyle(text, text.indexOf("once"), text.indexOf("once"), "quote")!);
    expect(body(quoted)).toBe("\\begin{quote}\nSaid once.\n\\end{quote}");
    expect(blockStyleAt(quoted, quoted.indexOf("once"))).toBe("quote");
    expect(lineStyles(quoted)).toContain("Said once.:quote");
    const abstract = applyChanges(quoted, setBlockStyle(quoted, quoted.indexOf("once"), quoted.indexOf("once"), "abstract")!);
    expect(body(abstract)).toBe("\\begin{abstract}\nSaid once.\n\\end{abstract}");
    expect(lineStyles(abstract)).toContain("Said once.:abstract abstract-first");
    const normal = applyChanges(abstract, setBlockStyle(abstract, abstract.indexOf("once"), abstract.indexOf("once"), null)!);
    expect(body(normal)).toBe("Said once.");
  });
});
