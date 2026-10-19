import { describe, expect, it } from "vitest";
import { clearFormatting, formatAt, needsOf, paintFormat, preambleFor, setColour, toggleFormat, wordAt, type Restyled } from "./formatting";
import { visualPieces } from "./visualModel";

const DOC = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

/** The text after a change, and what it selects. */
function apply(text: string, done: Restyled | null): { text: string; selected: string } {
  if (!done) throw new Error("no change");
  let out = text;
  for (const c of [...done.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return { text: out, selected: out.slice(done.select.from, done.select.to) };
}
/** The selection of the first `word` in `text`. */
const sel = (text: string, word: string, from = 0): [number, number] => {
  const at = text.indexOf(word, from);
  return [at, at + word.length];
};

describe("character formats from the ribbon", () => {
  it("puts strikethrough, sub- and superscript and small capitals around the selection, and reads it back as drawn", () => {
    for (const [name, style] of [["sout", "strike"], ["textsubscript", "sub"], ["textsuperscript", "sup"], ["textsc", "smallcaps"], ["hl", "highlight"]]) {
      const text = DOC("Some words here.");
      const out = apply(text, toggleFormat(text, ...sel(text, "words"), name));
      expect(out.text).toContain(`Some \\${name}{words} here.`);
      expect(out.selected).toBe("words");
      const styled = visualPieces(out.text, []).filter((p) => p.kind === "style");
      expect(styled.map((p) => ("style" in p ? p.style : ""))).toContain(style);
    }
  });

  it("takes a format off when every selected word has it, and puts it on all when only some do", () => {
    const text = DOC("one \\sout{two} three");
    const off = apply(text, toggleFormat(text, ...sel(text, "two"), "sout"));
    expect(off.text).toContain("one two three");
    const some = apply(text, toggleFormat(text, sel(text, "one")[0], sel(text, "three")[1], "sout"));
    expect(some.text).toContain("\\sout{one two three}");
  });

  it("keeps every command whole when the selection starts inside bold and ends outside it", () => {
    const text = DOC("a \\textbf{bold words} plain");
    const out = apply(text, toggleFormat(text, sel(text, "words")[0], sel(text, "plain")[1], "textit"));
    expect(out.text).toContain("a \\textbf{bold \\textit{words}} \\textit{plain}");
    expect(out.selected.replace(/\\[a-z]+\{|\}/g, "")).toBe("words plain");
  });

  it("raises text that was lowered, rather than both", () => {
    const text = DOC("H\\textsubscript{2}O");
    const out = apply(text, toggleFormat(text, ...sel(text, "2"), "textsuperscript"));
    expect(out.text).toContain("H\\textsuperscript{2}O");
  });

  it("refuses inside a formula, and does nothing to the settings", () => {
    const text = DOC("see $x + y$ here");
    expect(toggleFormat(text, text.indexOf("x"), text.indexOf("y") + 1, "textbf")).toBeNull();
    expect(toggleFormat(text, 0, 10, "textbf")).toBeNull();
  });

  it("formats the words of a footnote inside the footnote", () => {
    const text = DOC("text\\footnote{a remark here} more");
    const out = apply(text, toggleFormat(text, ...sel(text, "remark"), "textsc"));
    expect(out.text).toContain("\\footnote{a \\textsc{remark} here}");
  });

  it("never puts a brace on a comment's line, nor lets a group run across a list item", () => {
    const text = DOC("one % note\ntwo");
    const out = apply(text, toggleFormat(text, sel(text, "one")[0], sel(text, "two")[1], "textbf"));
    expect(out.text).toContain("\\textbf{one} % note\n\\textbf{two}");
    const list = DOC("\\begin{itemize}\n  \\item alpha\n  \\item beta\n\\end{itemize}");
    const bold = apply(list, toggleFormat(list, sel(list, "alpha")[0], sel(list, "beta")[1], "textbf"));
    expect(bold.text).toContain("\\item \\textbf{alpha}\n  \\item \\textbf{beta}");
  });
});

describe("font colour", () => {
  it("writes \\textcolor with a colour of the palette, and changes it rather than nesting", () => {
    const text = DOC("make this red");
    const red = apply(text, setColour(text, ...sel(text, "this"), "darkred"));
    expect(red.text).toContain("make \\textcolor{darkred}{this} red");
    const blue = apply(red.text, setColour(red.text, ...sel(red.text, "this"), "royalblue"));
    expect(blue.text).toContain("make \\textcolor{royalblue}{this} red");
    const none = apply(blue.text, setColour(blue.text, ...sel(blue.text, "this"), null));
    expect(none.text).toContain("make this red");
  });

  it("is drawn in its colour, its command hidden as one construct", () => {
    const text = DOC("make \\textcolor{darkred}{this} red");
    const pieces = visualPieces(text, []);
    const hides = pieces.filter((p) => p.kind === "hide").map((p) => ("to" in p ? text.slice(p.from, p.to) : ""));
    expect(hides).toEqual(["\\textcolor{darkred}{", "}"]);
    expect(pieces.some((p) => p.kind === "style" && p.style === "color-darkred" && text.slice(p.from, p.to) === "this")).toBe(true);
    const groups = new Set(pieces.filter((p) => p.kind === "hide").map((p) => (p.kind === "hide" ? p.group : 0)));
    expect(groups.size).toBe(1);
  });
});

describe("clear formatting and the format painter", () => {
  it("takes every formatting command off the selection and leaves the words", () => {
    const text = DOC("\\textbf{\\textit{all}} of \\textcolor{darkred}{this} goes");
    const out = apply(text, clearFormatting(text, sel(text, "all")[0], sel(text, "goes")[1]));
    expect(out.text).toContain("\nall of this goes\n");
  });

  it("splits a command the selection is in the middle of", () => {
    const text = DOC("\\textbf{one two three}");
    const out = apply(text, clearFormatting(text, ...sel(text, "two")));
    expect(out.text).toContain("\\textbf{one} two \\textbf{three}");
  });

  it("copies the formatting at the cursor and puts the same commands on other text", () => {
    const text = DOC("\\textcolor{royalblue}{\\textbf{model}} and plain words");
    const heads = formatAt(text, text.indexOf("model") + 2);
    expect(heads).toEqual(["\\textcolor{royalblue}{", "\\textbf{"]);
    const out = apply(text, paintFormat(text, ...sel(text, "plain"), heads));
    expect(out.text).toContain("and \\textcolor{royalblue}{\\textbf{plain}} words");
  });

  it("finds the word around the cursor, and not a command's name", () => {
    const text = "the quick fox \\textbf{x}";
    expect(wordAt(text, text.indexOf("quick") + 2)).toEqual({ from: 4, to: 9 });
    expect(wordAt(text, text.indexOf("textbf") + 2)).toBeNull();
    expect(wordAt(text, 3)).toBeNull();
  });
});

describe("what the commands need in the settings", () => {
  it("loads ulem with normalem, soul and xcolor, and names a colour once", () => {
    const text = DOC("x");
    const needs = needsOf(["\\sout{", "\\hl{", "\\textcolor{darkred}{"]);
    const { change, added } = preambleFor(text, needs);
    expect(added).toEqual(["\\usepackage[normalem]{ulem}", "\\usepackage{xcolor}", "\\usepackage{soul}", "\\definecolor{darkred}{HTML}{C00000}"]);
    expect(change).toEqual({ from: text.indexOf("\\begin{document}"), to: text.indexOf("\\begin{document}"), insert: `${added.join("\n")}\n` });
    const again = text.slice(0, change!.from) + change!.insert + text.slice(change!.to);
    expect(preambleFor(again, needs).change).toBeNull();
  });

  it("tells, rather than guesses, when the file has no settings of its own", () => {
    const { change, notes } = preambleFor("Just a chapter.", needsOf(["\\sout{"]));
    expect(change).toBeNull();
    expect(notes[0]).toContain("no preamble");
  });

  it("counts xcolor as loaded by tikz", () => {
    const text = "\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\nx\n\\end{document}";
    expect(preambleFor(text, needsOf(["\\textcolor{royalblue}{"])).added).toEqual(["\\definecolor{royalblue}{HTML}{2450F0}"]);
  });
});
