// @vitest-environment jsdom
// Page view: the document stays drawn while the cursor moves through it, as in a word processor.
// Source shows only where the cursor is put inside what is not drawn (by going to a line, say) or
// where it is asked for with Ctrl+/. Deleting and typing never take a command's hidden parts
// apart.
import { cursorCharRight } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { pageBackspace, pageDelete, pageEnter, pageShiftTab, pageTab, setLatexMarks, toggleReveal, visualPage } from "./visual";

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

  it("Backspace after a bullet makes the item a paragraph, the list kept around it, the first item too", () => {
    const view = editor(LIST, LIST.indexOf("two"));
    pageBackspace(view);
    expect(text(view)).toContain("\\item one\n\\end{itemize}\ntwo\nAfter.");
    expect(view.state.selection.main.head).toBe(text(view).indexOf("two"));
    const first = editor(LIST, LIST.indexOf("one"));
    pageBackspace(first);
    expect(text(first)).toContain("See:\none\n\\begin{itemize}\n  \\item two\n\\end{itemize}");
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

  it("the cursor cannot be moved to before the document's settings, so nothing is put in before them", () => {
    const view = editor(FULL, FULL.indexOf("Text"));
    view.dispatch({ selection: { anchor: 0 }, userEvent: "select" });
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
    for (const ch of "abc") view.dispatch({ ...view.state.replaceSelection(ch), userEvent: "input.type" });
    expect(view.state.selection.ranges).toHaveLength(2);
    expect(text(view)).toContain("\\textbf{abcld}");
    expect(text(view)).toContain("abcNext");
  });

  it("typing letter by letter over a selection that starts at hidden text keeps the letters in order", () => {
    const view = editor(DOC, { anchor: at("\\textbf"), head: at("bold", 2) });
    for (const ch of "XYZ") view.dispatch({ ...view.state.replaceSelection(ch), userEvent: "input.type" });
    expect(text(view)).toContain("Some \\textbf{XYZld} text");
  });

  it("deleting from above a list into an item keeps the list's first item", () => {
    const doc = "\\begin{document}\nPara\n\\begin{itemize}\n  \\item a\n  \\item b\n\\end{itemize}\nNext\n\\end{document}";
    const view = editor(doc, { anchor: doc.indexOf("Para"), head: doc.indexOf("b\n") });
    view.dispatch({ ...view.state.replaceSelection(""), userEvent: "delete.selection" });
    expect(text(view)).toBe("\\begin{document}\n\\begin{itemize}\n\\item b\n\\end{itemize}\nNext\n\\end{document}");
  });

  it("several cursors each type where they are, when a selection ends at a hidden opening", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        selection: EditorSelection.create([EditorSelection.range(at("me \\textbf"), at("bold")), EditorSelection.cursor(at("Next"))]),
        extensions: [visualPage, EditorState.allowMultipleSelections.of(true)],
      }),
    });
    views.push(view);
    for (const ch of "abc") view.dispatch({ ...view.state.replaceSelection(ch), userEvent: "input.type" });
    // What replaced the plain "me " goes where it was, before the bold, all of it in one place.
    expect(text(view)).toContain("Soabc\\textbf{bold} text");
    expect(text(view)).toContain("abcNext");
  });

  it("going to the first line shows the settings, as going into anything drawn does", () => {
    const view = editor(FULL, FULL.indexOf("Text"));
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.state.selection.main.head).toBe(1);
    expect(notShown(view).some((s) => s.startsWith("\\documentclass"))).toBe(false);
  });

  it("deleting a whole list takes both its hidden lines, and a list line alone is not hidden", () => {
    const doc = "\\begin{document}\nPara\n\\begin{itemize}\n  \\item a\n\\end{itemize}\nNext\n\\end{document}";
    const view = editor(doc, { anchor: doc.indexOf("Para"), head: doc.indexOf("Next") });
    view.dispatch({ ...view.state.replaceSelection(""), userEvent: "delete.selection" });
    expect(text(view)).toBe("\\begin{document}\nNext\n\\end{document}");
    const lone = "\\begin{document}\n\\begin{itemize} \\item a\n\\end{itemize}\n\\end{document}";
    expect(notShown(editor(lone, lone.length))).not.toContain("\\end{itemize}\n");
  });
});

describe("page view: formats like Word", () => {
  const text = (view: EditorView) => view.state.doc.toString();
  const type = (view: EditorView, insert: string, userEvent = "input.type") => view.dispatch({ ...view.state.replaceSelection(insert), userEvent });
  const COLOUR = "\\begin{document}\nSee \\textcolor{darkred}{red} and \\sout{gone} or H\\textsubscript{2}O.\n\\end{document}";
  const LIST = "\\begin{document}\n\\begin{itemize}\n  \\item a\n  \\item b\n\\end{itemize}\nAfter.\n\\end{document}";

  it("draws colour, strikethrough and subscript with their commands hidden, each as one construct", () => {
    const view = editor(COLOUR, COLOUR.indexOf("See"));
    expect(notShown(view)).toEqual(["\\textcolor{darkred}{", "}", "\\sout{", "}", "\\textsubscript{", "}"]);
    const classes = [...view.contentDOM.querySelectorAll("[class*=cm-v-]")].map((el) => el.className);
    expect(classes).toEqual(expect.arrayContaining(["cm-v-color-darkred", "cm-v-strike", "cm-v-sub"]));
  });

  it("Backspace on the only letter of a subscript, or the last of a coloured word, takes the whole command", () => {
    const view = editor(COLOUR, COLOUR.indexOf("2}O") + 1);
    pageBackspace(view);
    expect(text(view)).toContain("or HO.");
    const red = editor("\\begin{document}\n\\textcolor{darkred}{x} y\n\\end{document}", 0);
    red.dispatch({ selection: { anchor: text(red).indexOf("x}") + 1 } });
    pageBackspace(red);
    expect(text(red)).toBe("\\begin{document}\n y\n\\end{document}");
  });

  it("typing over a selection that starts at a colour's hidden opening keeps the command whole and what is typed", () => {
    const view = editor(COLOUR, { anchor: COLOUR.indexOf("\\textcolor"), head: COLOUR.indexOf("ed} and") });
    type(view, "XY");
    expect(text(view)).toContain("See \\textcolor{darkred}{XYed} and");
  });

  it("with LaTeX marks shown, the commands are drawn faintly and edited just as when hidden", () => {
    setLatexMarks(true);
    try {
      const view = editor(DOC, at("bold}", 4));
      const marks = [...view.contentDOM.querySelectorAll(".cm-v-mark")].map((el) => el.textContent);
      expect(marks).toEqual(["\\textbf{", "}"]);
      expect(view.dom.classList.contains("cm-marks")).toBe(true);
      pageBackspace(view);
      expect(text(view)).toContain("Some \\textbf{bol} text");
      const whole = editor(DOC, { anchor: at("\\textbf"), head: at("bold", 2) });
      type(whole, "Q");
      expect(text(whole)).toContain("Some \\textbf{Qld} text");
      // The environment's name for the margin, on the first line of a list whose lines are hidden.
      const list = editor(LIST, LIST.indexOf("a\n"));
      expect(list.contentDOM.querySelector("[data-env]")?.getAttribute("data-env")).toBe("itemize");
    } finally {
      setLatexMarks(false);
    }
  });

  it("Tab puts an item a level down and Shift+Tab back, the inner list's lines hidden too", () => {
    const view = editor(LIST, LIST.indexOf("b\n"));
    expect(pageTab(view)).toBe(true);
    expect(text(view)).toContain("\\item a\n    \\begin{itemize}\n      \\item b\n    \\end{itemize}\n\\end{itemize}");
    expect(notShown(view).filter((s) => s.includes("begin") || s.includes("end{itemize}"))).toHaveLength(4);
    expect(view.contentDOM.querySelectorAll(".cm-v-bullet")).toHaveLength(2);
    expect(pageShiftTab(view)).toBe(true);
    expect(text(view)).toBe(LIST);
  });

  it("Enter on an empty item ends the list, the cursor in a new paragraph after it", () => {
    const view = editor(LIST, LIST.indexOf("b\n") + 1);
    pageEnter(view);
    expect(text(view)).toContain("\\item b\n  \\item \n\\end{itemize}");
    pageEnter(view);
    expect(text(view)).toBe("\\begin{document}\n\\begin{itemize}\n  \\item a\n  \\item b\n\\end{itemize}\n\n\n\nAfter.\n\\end{document}");
    expect(view.state.selection.main.head).toBe(text(view).indexOf("\n\n\nAfter") + 1);
    type(view, "New");
    expect(text(view)).toContain("\\end{itemize}\n\nNew\n\nAfter.");
  });

  it("a heading just after a list keeps its style, though the list's hidden last line joins it", () => {
    const doc = "\\begin{document}\n\\begin{itemize}\n  \\item a\n\\end{itemize}\n\\section{Next}\nText.\n\\end{document}";
    const view = editor(doc, doc.indexOf("Text"));
    const heading = view.contentDOM.querySelector(".cm-v-line-h1");
    expect(heading?.textContent).toBe("Next");
  });

  it("a centred paragraph's environment lines are hidden as a pair and kept by Delete and Backspace", () => {
    const doc = "\\begin{document}\nBefore.\n\\begin{center}\nMiddle.\n\\end{center}\nAfter.\n\\end{document}";
    const view = editor(doc, doc.indexOf("Middle.") + 7);
    expect(notShown(view)).toEqual(["\\begin{center}\n", "\\end{center}\n"]);
    pageDelete(view);
    expect(text(view)).toBe(doc);
    view.dispatch({ selection: { anchor: doc.indexOf("Middle") } });
    pageBackspace(view);
    expect(text(view)).toBe(doc);
    expect(view.contentDOM.querySelector(".cm-v-line-align-center")?.textContent).toBe("Middle.");
  });
});
