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

  it("aligns one paragraph of several aligned together, the environment cut round it, as Word aligns a paragraph", () => {
    const text = DOC("\\begin{flushright}\nOne.\n\nTwo.\n\nThree.\n\\end{flushright}");
    const centred = applyChanges(text, setAlignment(text, text.indexOf("Two"), text.indexOf("Two"), "center")!);
    expect(body(centred)).toBe("\\begin{flushright}\nOne.\n\\end{flushright}\n\n\\begin{center}\nTwo.\n\\end{center}\n\n\\begin{flushright}\nThree.\n\\end{flushright}");
    expect(alignmentAt(centred, centred.indexOf("One"))).toBe("right");
    expect(alignmentAt(centred, centred.indexOf("Two"))).toBe("center");
    expect(lineStyles(centred)).toEqual(expect.arrayContaining(["One.:align-right", "Two.:align-center", "Three.:align-right"]));
    // The first, justified: the environment begins after it.
    const first = applyChanges(text, setAlignment(text, text.indexOf("One"), text.indexOf("One"), "justify")!);
    expect(body(first)).toBe("One.\n\n\\begin{flushright}\nTwo.\n\nThree.\n\\end{flushright}");
    // The last two at once.
    const last = applyChanges(text, setAlignment(text, text.indexOf("Two"), text.indexOf("Three"), "left")!);
    expect(body(last)).toBe("\\begin{flushright}\nOne.\n\\end{flushright}\n\n\\begin{flushleft}\nTwo.\n\nThree.\n\\end{flushleft}");
    // Every paragraph of it: the environment changes, as before.
    const all = applyChanges(text, setAlignment(text, text.indexOf("One"), text.indexOf("Three"), "center")!);
    expect(body(all)).toBe("\\begin{center}\nOne.\n\nTwo.\n\nThree.\n\\end{center}");
  });

  it("keeps a paragraph taken out of an environment apart from the text written just outside it", () => {
    const text = DOC("A\n\\begin{center}\nB\n\nC\n\\end{center}\nD");
    const last = applyChanges(text, setAlignment(text, text.indexOf("C\n"), text.indexOf("C\n"), "justify")!);
    expect(body(last)).toBe("A\n\\begin{center}\nB\n\\end{center}\n\nC\n\nD");
    const first = applyChanges(text, setAlignment(text, text.indexOf("B\n"), text.indexOf("B\n"), "justify")!);
    expect(body(first)).toBe("A\n\nB\n\n\\begin{center}\nC\n\\end{center}\nD");
    const whole = DOC("A\n\\begin{center}\nB\n\\end{center}\nD");
    expect(body(applyChanges(whole, setAlignment(whole, whole.indexOf("B\n"), whole.indexOf("B\n"), "justify")!))).toBe("A\n\nB\n\nD");
  });

  it("writes the environment for the paragraph at the indentation of the one it is cut from", () => {
    const text = DOC("  \\begin{flushright}\n    One.\n\n    Two.\n  \\end{flushright}");
    const out = applyChanges(text, setAlignment(text, text.indexOf("Two"), text.indexOf("Two"), "center")!);
    expect(body(out)).toBe("  \\begin{flushright}\n    One.\n  \\end{flushright}\n\n  \\begin{center}\n    Two.\n  \\end{center}");
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

  it("act on the paragraph, not the whole quotation it is in", () => {
    const text = DOC("\\begin{quote}\nFirst said.\n\nThen said.\n\\end{quote}");
    const normal = applyChanges(text, setBlockStyle(text, text.indexOf("Then"), text.indexOf("Then"), null)!);
    expect(body(normal)).toBe("\\begin{quote}\nFirst said.\n\\end{quote}\n\nThen said.");
    expect(blockStyleAt(normal, normal.indexOf("First"))).toBe("quote");
    expect(blockStyleAt(normal, normal.indexOf("Then"))).toBeNull();
    const abstract = applyChanges(text, setBlockStyle(text, text.indexOf("First"), text.indexOf("First"), "abstract")!);
    expect(body(abstract)).toBe("\\begin{abstract}\nFirst said.\n\\end{abstract}\n\n\\begin{quote}\nThen said.\n\\end{quote}");
    // A paragraph in a quotation inside a centred block: the quotation is what is cut, not the centring.
    const nested = DOC("\\begin{center}\n\\begin{quote}\nA.\n\nB.\n\\end{quote}\n\\end{center}");
    const out = applyChanges(nested, setBlockStyle(nested, nested.indexOf("B."), nested.indexOf("B."), null)!);
    expect(body(out)).toBe("\\begin{center}\n\\begin{quote}\nA.\n\\end{quote}\n\nB.\n\\end{center}");
  });
});
