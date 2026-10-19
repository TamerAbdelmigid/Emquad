// @vitest-environment jsdom
// Page view: the document stays drawn while the cursor moves through it, as in a word processor.
// Source shows only where the cursor is put inside what is not drawn (by going to a line, say) or
// where it is asked for with Ctrl+/. Deleting and typing never take a command's hidden parts
// apart.
import { cursorCharRight } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { pageBackspace, pageDelete, pageEnter, toggleReveal, visualPage } from "./visual";

/** The stretches of source that are not shown as they are written: hidden or drawn. */
function notShown(view: EditorView): string[] {
  const out: string[] = [];
  for (const deco of view.state.facet(EditorView.decorations)) {
    const set = typeof deco === "function" ? deco(view) : deco;
    set.between(0, view.state.doc.length, (from, to, d) => {
      if (from < to && d.spec.widget !== undefined) out.push(view.state.doc.sliceString(from, to));
      else if (from < to && !d.spec.class && !d.spec.attributes) out.push(view.state.doc.sliceString(from, to));
    });
  }
  return out;
}

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

function editor(doc: string, at: number | { anchor: number; head: number }) {
  const selection = typeof at === "number" ? { anchor: at } : at;
  const view = new EditorView({ state: EditorState.create({ doc, selection, extensions: [visualPage] }) });
  views.push(view);
  return view;
}

const DOC = "\\begin{document}\nSome \\textbf{bold} text with $x^2$ in it.\n\nNext paragraph.\n\\end{document}\n";
const at = (s: string, plus = 0) => DOC.indexOf(s) + plus;

describe("page view: what is drawn", () => {
  it("keeps bold and a formula drawn with the cursor in or beside them", () => {
    const view = editor(DOC, at("bold", 2));
    expect(notShown(view)).toEqual(["\\textbf{", "}", "$x^2$"]);
    view.dispatch({ selection: { anchor: at("$x^2$") } });
    expect(notShown(view)).toEqual(["\\textbf{", "}", "$x^2$"]);
    view.dispatch({ selection: { anchor: at("Some"), head: at("in it") } });
    expect(notShown(view)).toEqual(["\\textbf{", "}", "$x^2$"]);
  });

  it("shows the source of what the cursor is put inside, and draws it again when it leaves", () => {
    const view = editor(DOC, at("\\textbf", 3));
    expect(notShown(view)).toEqual(["$x^2$"]);
    view.dispatch({ selection: { anchor: at("x^2", 1) } });
    expect(notShown(view)).toEqual(["\\textbf{", "}"]);
    view.dispatch({ selection: { anchor: at("Next") } });
    expect(notShown(view)).toEqual(["\\textbf{", "}", "$x^2$"]);
  });

  it("shows a paragraph as LaTeX on Ctrl+/, and draws it again on a second Ctrl+/ or when the cursor leaves it", () => {
    const view = editor(DOC, at(" text", 1));
    toggleReveal(view);
    expect(notShown(view)).toEqual([]);
    toggleReveal(view);
    expect(notShown(view)).toEqual(["\\textbf{", "}", "$x^2$"]);
    toggleReveal(view);
    view.dispatch({ selection: { anchor: at("Next", 2) } });
    expect(notShown(view)).toEqual(["\\textbf{", "}", "$x^2$"]);
  });
});

describe("page view: moving", () => {
  it("the arrow keys go letter by letter through bold text, and step over its hidden braces", () => {
    const view = editor(DOC, at("bold"));
    cursorCharRight(view);
    expect(view.state.selection.main.head).toBe(at("bold", 1));
    view.dispatch({ selection: { anchor: at("bold}", 4) } });
    cursorCharRight(view);
    expect(view.state.selection.main.head).toBe(at("} text", 1));
  });
});

describe("page view: editing", () => {
  const text = (view: EditorView) => view.state.doc.toString();

  it("Backspace after a bold word takes its last letter, not the hidden brace", () => {
    const view = editor(DOC, at("bold}", 5));
    expect(pageBackspace(view)).toBe(true);
    expect(text(view)).toContain("Some \\textbf{bol} text");
    expect(view.state.selection.main.head).toBe(at("bold}", 3));
  });

  it("Backspace on the only letter of a bold word takes the command with it", () => {
    const doc = "\\begin{document}\na \\textbf{b} c\n\\end{document}";
    const view = editor(doc, doc.indexOf("b} c") + 2);
    pageBackspace(view);
    expect(text(view)).toBe("\\begin{document}\na  c\n\\end{document}");
  });

  it("Delete before a bold word takes its first letter", () => {
    const view = editor(DOC, at("\\textbf"));
    expect(pageDelete(view)).toBe(true);
    expect(text(view)).toContain("Some \\textbf{old} text");
  });

  it("deleting a selection that ends inside bold keeps the command whole", () => {
    const view = editor(DOC, { anchor: at("Some"), head: at("bold", 2) });
    view.dispatch({ ...view.state.replaceSelection(""), userEvent: "delete.selection" });
    expect(text(view)).toContain("\n\\textbf{ld} text");
  });

  it("deleting a selection that covers a whole bold word takes the command too", () => {
    const view = editor(DOC, { anchor: at("Some"), head: at(" text") });
    view.dispatch({ ...view.state.replaceSelection(""), userEvent: "delete.selection" });
    expect(text(view)).toContain("\n text with");
  });

  it("Enter in a paragraph starts a new one, as a blank line", () => {
    const view = editor(DOC, at("in it.", 6));
    expect(pageEnter(view)).toBe(true);
    expect(text(view)).toContain("in it.\n\n\n\nNext");
    expect(view.state.selection.main).toEqual(EditorSelection.cursor(at("in it.", 8)));
  });

  it("Enter at the end of a heading goes on below it", () => {
    const doc = "\\begin{document}\n\\section{Intro}\ntext\n\\end{document}";
    const view = editor(doc, doc.indexOf("}\ntext"));
    pageEnter(view);
    expect(text(view)).toBe("\\begin{document}\n\\section{Intro}\n\ntext\n\\end{document}");
    expect(view.state.selection.main.head).toBe(doc.indexOf("\ntext") + 1);
  });

  it("Enter in a list item starts the next item", () => {
    const doc = "\\begin{document}\n\\begin{itemize}\n  \\item one\n\\end{itemize}\n\\end{document}";
    const view = editor(doc, doc.indexOf("one") + 3);
    pageEnter(view);
    expect(text(view)).toContain("\\item one\n  \\item \n\\end{itemize}");
  });
});

describe("page view: what the review found", () => {
  const text = (view: EditorView) => view.state.doc.toString();
  const type = (view: EditorView, insert: string, userEvent = "input.type") => view.dispatch({ ...view.state.replaceSelection(insert), userEvent });
  const LIST = "\\begin{document}\nSee:\n\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}\nAfter.\n\\end{document}";
  const FULL = "\\documentclass{article}\n\\begin{document}\nSome \\textbf{bold} text.\n\\end{document}\n";

  it("typing over a selection that starts at hidden text keeps what is typed, and the command whole", () => {
    const view = editor(DOC, { anchor: at("\\textbf"), head: at("bold", 2) });
    type(view, "XYZ");
    expect(text(view)).toContain("Some \\textbf{XYZld} text");
    const pasted = editor(DOC, { anchor: at("\\textbf"), head: at("bold", 2) });
    type(pasted, "pasted", "input.paste");
    expect(text(pasted)).toContain("Some \\textbf{pastedld} text");
  });

  it("select all and type keeps the settings and the end of the document, and what is typed", () => {
    const view = editor(FULL, { anchor: 0, head: FULL.length });
    type(view, "New text");
    expect(text(view)).toBe("\\documentclass{article}\n\\begin{document}New text\\end{document}");
  });

  it("typing at the very start goes in the document, not before its settings", () => {
    const view = editor(FULL, 0);
    type(view, "Title");
    expect(text(view).startsWith("\\documentclass{article}\n\\begin{document}Title")).toBe(true);
  });

  it("copying or dragging part of a bold word carries the whole command", () => {
    const view = editor(DOC, { anchor: at("Some"), head: at("bold", 2) });
    const out = (t: string) => view.state.facet(EditorView.clipboardOutputFilter).reduce((s, f) => f(s, view.state), t);
    expect(out(view.state.sliceDoc(at("Some"), at("bold", 2)))).toBe("Some \\textbf{bo}");
    view.dispatch({ selection: { anchor: at("bold", 2), head: at(" with") } });
    expect(out(view.state.sliceDoc(at("bold", 2), at(" with")))).toBe("\\textbf{ld} text");
  });

  it("Delete at the end of a list's last item, and Backspace before a list, leave the list alone", () => {
    const view = editor(LIST, LIST.indexOf("two") + 3);
    pageDelete(view);
    expect(text(view)).toBe(LIST);
    view.dispatch({ selection: { anchor: LIST.indexOf("After") } });
    pageBackspace(view);
    expect(text(view)).toBe(LIST);
  });

  it("Backspace after a bullet joins the item to the one above, and does nothing on the first", () => {
    const view = editor(LIST, LIST.indexOf("two"));
    pageBackspace(view);
    expect(text(view)).toContain("\\item onetwo\n\\end{itemize}");
    const first = editor(LIST, LIST.indexOf("one"));
    pageBackspace(first);
    expect(text(first)).toBe(LIST);
  });

  it("Enter goes in as a plain line break in verbatim and inside a command's braces", () => {
    const doc = "\\begin{document}\n\\begin{verbatim}\ncode here\n\\end{verbatim}\nSee \\href{https://x.org}{click here} now.\n\\end{document}";
    const view = editor(doc, doc.indexOf("code") + 4);
    expect(pageEnter(view)).toBe(false);
    view.dispatch({ selection: { anchor: doc.indexOf("click") + 5 } });
    expect(pageEnter(view)).toBe(false);
  });
});

describe("page view: what the second review found", () => {
  const text = (view: EditorView) => view.state.doc.toString();
  const FULL = "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\n\nText.\n\\end{document}\n";

  it("a list line hidden alone is kept by a deletion across it", () => {
    const doc = "\\begin{document}\n\\begin{itemize} \\item a\n  \\item b\n\\end{itemize}\nNext\n\\end{document}";
    const view = editor(doc, { anchor: doc.indexOf("b\n") + 1, head: doc.indexOf("Next") + 2 });
    view.dispatch({ ...view.state.replaceSelection(""), userEvent: "delete.selection" });
    expect(text(view)).toContain("\\end{itemize}");
  });

  it("the cursor cannot rest before the document's settings, so nothing is put in before them", () => {
    const view = editor(FULL, FULL.indexOf("Text"));
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.state.selection.main.head).toBe(FULL.indexOf("\\begin{document}") + "\\begin{document}".length);
  });

  it("Backspace on an empty line under a heading takes the line", () => {
    const view = editor(FULL, FULL.indexOf("\n\nText") + 1);
    pageBackspace(view);
    expect(text(view)).toContain("\\section{Intro}\nText.");
  });

  it("copying from inside a list item to past the list gives a list that starts with an item", () => {
    const doc = "\\begin{document}\n\\begin{itemize}\n  \\item two\n\\end{itemize}\nNext\n\\end{document}";
    const view = editor(doc, { anchor: doc.indexOf("wo"), head: doc.indexOf("Next") + 2 });
    const out = view.state.facet(EditorView.clipboardOutputFilter).reduce((s, f) => f(s, view.state), view.state.sliceDoc(doc.indexOf("wo"), doc.indexOf("Next") + 2));
    expect(out).toBe("\\begin{itemize}\n\\item wo\n\\end{itemize}\nNe");
  });

  it("an edit kept off hidden text keeps every cursor", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        selection: EditorSelection.create([EditorSelection.range(at("\\textbf"), at("bold", 2)), EditorSelection.cursor(at("Next"))]),
        extensions: [visualPage, EditorState.allowMultipleSelections.of(true)],
      }),
    });
    views.push(view);
    view.dispatch({ ...view.state.replaceSelection("Z"), userEvent: "input.type" });
    expect(view.state.selection.ranges).toHaveLength(2);
    expect(text(view)).toContain("\\textbf{Zld}");
    expect(text(view)).toContain("ZNext");
  });
});
