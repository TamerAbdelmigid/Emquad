import { describe, expect, it } from "vitest";
import { type ListEdit, applyChanges, backspaceAtItemStart, enterInEmptyItem, indentItem, listAt, numberingAt, outdentItem, setNumbering, toggleList } from "./lists";
import { visualPieces } from "./visualModel";

const DOC = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;
/** The text after the edit, with | where the cursor is when the edit places it. */
function after(text: string, edit: ListEdit | null): string {
  if (!edit) throw new Error("no edit");
  const out = applyChanges(text, edit.changes);
  return edit.cursor === undefined ? out : `${out.slice(0, edit.cursor)}|${out.slice(edit.cursor)}`;
}
const body = (out: string) => out.slice(out.indexOf("\\begin{document}\n") + 17, out.lastIndexOf("\n\\end{document}"));
/** Whether every list has an \item before any text, and its \begin and \end match: what LaTeX needs to compile it. */
function compiles(text: string): boolean {
  const open: string[] = [];
  for (const m of text.matchAll(/\\(begin|end)\{(\w+)\}|\\item\b|([^\s\\{}|])/g)) {
    if (m[1] === "begin") open.push(m[2]);
    else if (m[1] === "end") {
      if (open.pop() !== m[2]) return false;
    } else if (m[3] && /^(?:itemize|enumerate)$/.test(open[open.length - 1] ?? "")) {
      const before = text.slice(0, m.index);
      const lastBegin = before.lastIndexOf(`\\begin{${open[open.length - 1]}}`);
      if (!before.slice(lastBegin).includes("\\item")) return false;
    }
  }
  return open.length === 0;
}

describe("the Bullets and Numbering buttons", () => {
  it("make the paragraph the cursor is in a list, its \\begin and \\end on lines of their own", () => {
    const text = DOC("First para.\n\nSecond para.");
    const out = after(text, toggleList(text, text.indexOf("Second") + 3, text.indexOf("Second") + 3, "itemize"));
    expect(body(out)).toBe("First para.\n\n\\begin{itemize}\n  \\item Sec|ond para.\n\\end{itemize}");
    // Read back: drawn as a bullet, the environment's lines hidden.
    const clean = out.replace("|", "");
    const pieces = visualPieces(clean, []);
    expect(pieces.filter((p) => p.kind === "bullet")).toHaveLength(1);
    expect(pieces.filter((p) => p.kind === "hide").map((p) => ("to" in p ? clean.slice(p.from, p.to) : ""))).toEqual(["\\begin{itemize}\n", "\\end{itemize}\n"]);
  });

  it("make each selected paragraph an item, and take the items out again", () => {
    const text = DOC("One.\n\nTwo.\n\nThree.");
    const listed = after(text, toggleList(text, text.indexOf("One"), text.indexOf("Three") + 2, "enumerate"));
    expect(body(listed).replace("|", "")).toBe("\\begin{enumerate}\n  \\item One.\n  \\item Two.\n  \\item Three.\n\\end{enumerate}");
    const clean = listed.replace("|", "");
    const back = after(clean, toggleList(clean, clean.indexOf("One"), clean.indexOf("Three") + 2, "enumerate"));
    expect(body(back)).toBe("|One.\n\nTwo.\n\nThree.");
  });

  it("make the middle item a paragraph, the list kept before and after it", () => {
    const text = DOC("\\begin{itemize}\n  \\item a\n  \\item b\n  \\item c\n\\end{itemize}");
    const out = after(text, toggleList(text, text.indexOf("b\n"), text.indexOf("b\n"), "itemize"));
    expect(body(out)).toBe("\\begin{itemize}\n  \\item a\n\\end{itemize}\n|b\n\\begin{itemize}\n  \\item c\n\\end{itemize}");
    expect(compiles(out.replace("|", ""))).toBe(true);
  });

  it("change a bulleted list to a numbered one, and set its numbering with enumitem", () => {
    const text = DOC("\\begin{itemize}\n  \\item a\n\\end{itemize}");
    const numbered = applyChanges(text, toggleList(text, text.indexOf("a\n"), text.indexOf("a\n"), "enumerate")!.changes);
    expect(body(numbered)).toBe("\\begin{enumerate}\n  \\item a\n\\end{enumerate}");
    const edit = setNumbering(numbered, numbered.indexOf("a\n"), numbered.indexOf("a\n"), "a)")!;
    const lettered = applyChanges(numbered, edit.changes);
    expect(body(lettered)).toBe("\\begin{enumerate}[label=\\alph*)]\n  \\item a\n\\end{enumerate}");
    expect(edit.needs).toEqual([{ kind: "package", name: "enumitem", why: "for the numbering format" }]);
    expect(numberingAt(lettered, lettered.indexOf("a\n"))).toBe("a)");
    // Drawn with the letters it prints.
    const pieces = visualPieces(lettered, []);
    expect(pieces.find((p) => p.kind === "bullet")).toMatchObject({ label: "a)" });
    const plain = applyChanges(lettered, setNumbering(lettered, lettered.indexOf("a\n"), lettered.indexOf("a\n"), "1.")!.changes);
    expect(body(plain)).toBe("\\begin{enumerate}\n  \\item a\n\\end{enumerate}");
  });

  it("start an empty list on an empty line, with the cursor in its item", () => {
    const text = DOC("Para.\n\n\n\nNext.");
    const at = text.indexOf("\n\n\n") + 2;
    expect(body(after(text, toggleList(text, at, at, "itemize")))).toBe("Para.\n\n\\begin{itemize}\n  \\item |\n\\end{itemize}\n\nNext.");
  });

  it("refuse in a formula or a table", () => {
    const text = DOC("\\begin{equation}\n  x = 1\n\\end{equation}");
    expect(toggleList(text, text.indexOf("x"), text.indexOf("x"), "itemize")).toBeNull();
  });
});

describe("levels: Tab and Shift+Tab in a list item", () => {
  const LIST = DOC("\\begin{itemize}\n  \\item a\n  \\item b\n  \\item c\n\\end{itemize}");

  it("Tab puts the item in a list inside the item above, and Shift+Tab takes it out again", () => {
    const nested = applyChanges(LIST, indentItem(LIST, LIST.indexOf("b\n"))!.changes);
    expect(body(nested)).toBe("\\begin{itemize}\n  \\item a\n    \\begin{itemize}\n      \\item b\n    \\end{itemize}\n  \\item c\n\\end{itemize}");
    expect(compiles(nested)).toBe(true);
    expect(listAt(nested, nested.indexOf("b\n"))).toBe("itemize");
    const back = applyChanges(nested, outdentItem(nested, nested.indexOf("b\n"))!.changes);
    expect(back).toBe(LIST);
  });

  it("Tab on the next item joins the list inside the item above, and the first item stays", () => {
    const nested = applyChanges(LIST, indentItem(LIST, LIST.indexOf("b\n"))!.changes);
    const two = applyChanges(nested, indentItem(nested, nested.indexOf("c\n"))!.changes);
    expect(body(two)).toBe("\\begin{itemize}\n  \\item a\n    \\begin{itemize}\n      \\item b\n      \\item c\n    \\end{itemize}\n\\end{itemize}");
    expect(indentItem(LIST, LIST.indexOf("a\n"))!.changes).toEqual([]);
  });

  it("Shift+Tab in the middle of an inner list takes the items after it along, one level down", () => {
    const text = DOC("\\begin{itemize}\n  \\item a\n    \\begin{itemize}\n      \\item b1\n      \\item b2\n      \\item b3\n    \\end{itemize}\n  \\item c\n\\end{itemize}");
    const out = applyChanges(text, outdentItem(text, text.indexOf("b2"))!.changes);
    expect(body(out)).toBe(
      "\\begin{itemize}\n  \\item a\n    \\begin{itemize}\n      \\item b1\n    \\end{itemize}\n  \\item b2\n    \\begin{itemize}\n      \\item b3\n    \\end{itemize}\n  \\item c\n\\end{itemize}",
    );
    expect(compiles(out)).toBe(true);
  });

  it("Shift+Tab at the top level leaves the item; Backspace at its start makes it a paragraph", () => {
    expect(outdentItem(LIST, LIST.indexOf("a\n"))!.changes).toEqual([]);
    const out = after(LIST, outdentItem(LIST, LIST.indexOf("a\n"), true));
    expect(body(out)).toBe("|a\n\\begin{itemize}\n  \\item b\n  \\item c\n\\end{itemize}");
    expect(compiles(out.replace("|", ""))).toBe(true);
  });
});

describe("Enter and Backspace in a list, as in a word processor", () => {
  it("Enter on an empty last item ends the list, with a new paragraph after it", () => {
    const text = DOC("\\begin{itemize}\n  \\item a\n  \\item \n\\end{itemize}\nAfter.");
    const out = after(text, enterInEmptyItem(text, text.indexOf("\\item \n") + 6));
    expect(body(out)).toBe("\\begin{itemize}\n  \\item a\n\\end{itemize}\n\n|\n\nAfter.");
  });

  it("Enter on an empty item in the middle cuts the list in two", () => {
    const text = DOC("\\begin{itemize}\n  \\item a\n  \\item \n  \\item c\n\\end{itemize}");
    const out = after(text, enterInEmptyItem(text, text.indexOf("\\item \n") + 6));
    expect(body(out)).toBe("\\begin{itemize}\n  \\item a\n\\end{itemize}\n\n|\n\n\\begin{itemize}\n  \\item c\n\\end{itemize}");
    expect(compiles(out.replace("|", ""))).toBe(true);
  });

  it("Enter on the only, empty, item takes the list away", () => {
    const text = DOC("Para.\n\\begin{itemize}\n  \\item \n\\end{itemize}\nAfter.");
    const out = after(text, enterInEmptyItem(text, text.indexOf("\\item ") + 6));
    expect(body(out)).toBe("Para.\n\n|\n\nAfter.");
  });

  it("Enter on an empty item of an inner list takes it up a level", () => {
    const text = DOC("\\begin{itemize}\n  \\item a\n    \\begin{itemize}\n      \\item \n    \\end{itemize}\n\\end{itemize}");
    const out = applyChanges(text, enterInEmptyItem(text, text.indexOf("\\item \n") + 6)!.changes);
    expect(body(out)).toBe("\\begin{itemize}\n  \\item a\n  \\item \n\\end{itemize}");
  });

  it("Enter in an item with words is not this", () => {
    const text = DOC("\\begin{itemize}\n  \\item a\n\\end{itemize}");
    expect(enterInEmptyItem(text, text.indexOf("a\n") + 1)).toBeNull();
  });

  it("Backspace at the start of an item makes it a paragraph, even the first, and keeps the rest a list", () => {
    const text = DOC("\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}");
    const first = after(text, backspaceAtItemStart(text, text.indexOf("one")));
    expect(body(first)).toBe("|one\n\\begin{itemize}\n  \\item two\n\\end{itemize}");
    const second = after(text, backspaceAtItemStart(text, text.indexOf("two")));
    expect(body(second)).toBe("\\begin{itemize}\n  \\item one\n\\end{itemize}\n|two");
    expect(backspaceAtItemStart(text, text.indexOf("two") + 1)).toBeNull();
  });
});
