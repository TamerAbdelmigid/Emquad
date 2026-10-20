// @vitest-environment jsdom
// Page view: the document stays drawn while the cursor moves through it, as in a word processor.
// Source shows only where the cursor is put inside what is not drawn (by going to a line, say) or
// where it is asked for with Ctrl+/. Deleting and typing never take a command's hidden parts
// apart.
import { closeBrackets } from "@codemirror/autocomplete";
import { cursorCharRight } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import type { PageChange } from "./trackChanges";
import { fromOtherSide } from "./split";
import { describeReference, keepChange, nextChange, onListNeeds, showChanges, undoChange, pageBackspace, pageDelete, pageEnter, pageFurniture, pageShiftTab, pageTab, pagesState, setLatexMarks, setPageBreaks, toggleReveal, visualMode, visualPage } from "./visual";

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

  it("Enter on an empty item in the middle of a numbered list cuts it in two, numbered on, and asks for enumitem", () => {
    const doc = "\\begin{document}\n\\begin{enumerate}\n  \\item a\n  \\item \n  \\item c\n\\end{enumerate}\n\\end{document}";
    const asked: string[] = [];
    onListNeeds((needs) => asked.push(...needs.map((n) => n.name)));
    try {
      const view = editor(doc, doc.indexOf("\\item \n") + 6);
      pageEnter(view);
      expect(text(view)).toContain("\\end{enumerate}\n\n\n\n\\begin{enumerate}[resume]\n  \\item c");
      expect([...view.contentDOM.querySelectorAll(".cm-v-number")].map((el) => el.textContent)).toEqual(["1.", "2."]);
      expect(asked).toEqual(["enumitem"]);
    } finally {
      onListNeeds(() => {});
    }
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

describe("page view: lays out like Word", () => {
  const PAGED = "\\documentclass{article}\n\\begin{document}\nFirst page.\n\nSecond page.\n\nThird page.\n\\end{document}\n";
  const text = (view: EditorView) => view.state.doc.toString();
  function paged(doc = PAGED, at = doc.indexOf("First"), extensions = [visualPage, pageFurniture]) {
    const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: at }, extensions }) });
    views.push(view);
    return view;
  }
  const breaks = (view: EditorView) => [...view.contentDOM.querySelectorAll(".cm-v-pagebreak")];
  const lineOf = (view: EditorView, s: string) => view.state.doc.lineAt(view.state.doc.toString().indexOf(s)).number;

  it("draws a page break before each line the last compile began a page with, named by its page", () => {
    const view = paged();
    view.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 1, line: 1 }, { page: 2, line: lineOf(view, "Second") }, { page: 3, line: lineOf(view, "Third") }], header: "", footer: "", numbers: true }) });
    const drawn = breaks(view);
    expect(drawn.map((b) => b.getAttribute("aria-label"))).toEqual(["Page 2", "Page 3"]);
    expect(drawn[0].nextElementSibling?.textContent).toBe("Second page.");
    // The page number of the page each ends is at its foot.
    expect(drawn[0].querySelector(".cm-v-pb-foot")?.textContent).toContain("1");
  });

  it("keeps each break before its line as text is written above it, and never in the draft view", () => {
    const view = paged();
    view.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 1, line: 1 }, { page: 2, line: lineOf(view, "Second") }], header: "", footer: "", numbers: true }) });
    view.dispatch({ changes: { from: PAGED.indexOf("First"), insert: "A new line.\n\n" }, userEvent: "input.type" });
    expect(breaks(view)[0].nextElementSibling?.textContent).toBe("Second page.");
    const draft = paged(PAGED, PAGED.indexOf("First"), [visualMode, pageFurniture]);
    draft.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 1, line: 1 }, { page: 2, line: lineOf(draft, "Second") }], header: "", footer: "", numbers: true }) });
    expect(breaks(draft)).toEqual([]);
  });

  it("never takes or moves text: typing at a break's line goes in on the next page, and Backspace there joins the lines as usual", () => {
    const view = paged();
    view.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 1, line: 1 }, { page: 2, line: lineOf(view, "Second") }], header: "", footer: "", numbers: true }) });
    const at = PAGED.indexOf("Second");
    view.dispatch({ selection: { anchor: at } });
    view.dispatch(view.state.replaceSelection("New "));
    expect(text(view)).toBe(PAGED.replace("Second", "New Second"));
    expect(breaks(view)[0].nextElementSibling?.textContent).toBe("New Second page.");
    view.dispatch({ selection: { anchor: at } });
    pageBackspace(view);
    expect(text(view)).toBe(PAGED.replace("\n\nSecond", "\nNew Second"));
  });

  it("draws the header at the top of each page and the footer and page number at the foot, as the settings give them", () => {
    const view = paged();
    view.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 1, line: 1 }, { page: 2, line: lineOf(view, "Second") }], header: "Draft \\& notes", footer: "Confidential", numbers: true }) });
    const [one] = breaks(view);
    expect(one.querySelector(".cm-v-pb-foot")?.textContent).toBe("Confidential1");
    expect(one.querySelector(".cm-v-pb-head")?.textContent).toBe("Draft & notes");
    expect(view.contentDOM.querySelector(".cm-v-pagetop .cm-v-pb-head")?.textContent).toBe("Draft & notes");
    expect(view.contentDOM.querySelector(".cm-v-pageend .cm-v-pb-foot")?.textContent).toBe("Confidential2");
    expect(text(view)).toBe(PAGED);
  });

  it("numbers each page's foot by the page the file's text is on, pages of other files skipped", () => {
    const view = paged();
    // The file is set from page 7, and its last part on page 9, after a page of another file.
    view.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 7, line: 1 }, { page: 9, line: lineOf(view, "Second") }], header: "", footer: "", numbers: true }) });
    expect(breaks(view)[0].getAttribute("aria-label")).toBe("Page 9");
    expect(breaks(view)[0].querySelector(".cm-v-pb-foot")?.textContent).toBe("7");
    expect(view.contentDOM.querySelector(".cm-v-pageend .cm-v-pb-foot")?.textContent).toBe("9");
  });

  it("draws a break that falls inside a figure or a formula before it, never splitting it", () => {
    const doc = "\\begin{document}\nText.\n\\begin{figure}[h]\n  \\centering\n  \\caption{A}\n\\end{figure}\nMore.\n\\end{document}\n";
    const view = paged(doc, doc.indexOf("Text"));
    view.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 1, line: 1 }, { page: 2, line: lineOf(view, "\\caption") }], header: "", footer: "", numbers: true }) });
    expect(view.state.field(pagesState).marks.map((m) => view.state.doc.lineAt(m.at).text)).toEqual(["\\begin{figure}[h]"]);
  });

  it("draws a break that falls inside a formula set with \\[ and \\] before it", () => {
    const doc = "\\begin{document}\nText.\n\\[\n  x = 1\n\\]\nMore.\n\\end{document}\n";
    const view = paged(doc, doc.indexOf("Text"));
    view.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 1, line: 1 }, { page: 2, line: lineOf(view, "x = 1") }], header: "", footer: "", numbers: true }) });
    expect(view.state.field(pagesState).marks.map((m) => view.state.doc.lineAt(m.at).text)).toEqual(["\\["]);
  });

  it("does not take a line break with spacing, \\\\[2pt], or a comment for a formula", () => {
    const doc = "\\begin{document}\n\\begin{tabular}{l}\na \\\\[2pt]\nb\n\\end{tabular}\n% a \\[ in a comment\nPage three.\n\nPage four.\n\n\\[ x = 1 \\]\nPage five.\n\\end{document}\n";
    const view = paged(doc, doc.indexOf("Page three"));
    const lines = ["Page three", "Page four", "Page five"].map((s) => lineOf(view, s));
    view.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 1, line: 1 }, ...lines.map((line, i) => ({ page: i + 2, line }))], header: "", footer: "", numbers: true }) });
    expect(view.state.field(pagesState).marks.map((m) => view.state.doc.lineAt(m.at).text)).toEqual(["Page three.", "Page four.", "Page five."]);
  });

  it("keeps the breaks it has, following the edits, when told only of the header and footer", () => {
    const view = paged();
    view.dispatch({ effects: setPageBreaks.of({ breaks: [{ page: 1, line: 1 }, { page: 2, line: lineOf(view, "Second") }], header: "", footer: "", numbers: true }) });
    view.dispatch({ changes: { from: PAGED.indexOf("First"), insert: "New.\n\n" } });
    view.dispatch({ effects: setPageBreaks.of({ breaks: null, header: "Head", footer: "", numbers: true }) });
    expect(breaks(view)[0].nextElementSibling?.textContent).toBe("Second page.");
    expect(breaks(view)[0].querySelector(".cm-v-pb-head")?.textContent).toBe("Head");
  });

  it("keeps the foot of the last page at the end when the whole text is replaced by a shorter one, with no breaks", () => {
    const view = paged();
    view.dispatch({ effects: setPageBreaks.of({ breaks: [], header: "", footer: "", numbers: true }) });
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Short." } });
    view.dispatch({ changes: { from: 0, insert: "A " } });
    expect(view.contentDOM.querySelector(".cm-v-pageend .cm-v-pb-foot")?.textContent).toBe("1");
    expect(text(view)).toBe("A Short.");
  });
});

describe("page view: refers like Word", () => {
  it("names what a reference points to as cleveref prints it, the kind read from where the label is when the compile does not say", () => {
    const numbers = { "fig:a": { number: "2", page: "3", title: "", kind: "" }, "eq:e": { number: "1", page: "1", title: "", kind: "" } };
    const kinds = { "fig:a": "figure", "eq:e": "equation" };
    expect(describeReference("Cref", ["fig:a"], numbers, kinds).text).toBe("Figure 2");
    expect(describeReference("cref", ["fig:a"], numbers, kinds).text).toBe("fig. 2");
    expect(describeReference("Cref", ["eq:e"], numbers, kinds).text).toBe("Equation (1)");
    expect(describeReference("ref", ["fig:a"], numbers, kinds).text).toBe("2");
    expect(describeReference("pageref", ["fig:a"], numbers, kinds).text).toBe("3");
    expect(describeReference("Cref", ["missing"], numbers, kinds).text).toBe("?");
    // hyperref names sub-levels and the appendix; cleveref calls them sections and the appendix.
    const deeper = { "sec:b": { number: "2.1", page: "1", title: "", kind: "subsection" }, app: { number: "A", page: "9", title: "", kind: "appendix" }, thm: { number: "3", page: "2", title: "", kind: "theorem" } };
    expect(describeReference("Cref", ["sec:b"], deeper, {}).text).toBe("Section 2.1");
    expect(describeReference("Cref", ["app"], deeper, {}).text).toBe("Appendix A");
    expect(describeReference("Cref", ["thm"], deeper, { thm: "figure" }).text).toBe("Figure 3");
  });
});

describe("page view: changes since a snapshot", () => {
  const NOW = "\\begin{document}\nThe quick red fox.\nLast line.\n\\end{document}\n";
  const at = (s: string) => NOW.indexOf(s);
  const CHANGES: PageChange[] = [
    { from: at("The"), to: at("Last"), old: "The quick brown fox.\nGone.\n", inserted: [{ from: at("red"), to: at("red") + 3 }], deleted: [{ at: at("red"), text: "brown" }, { at: at("Last"), text: "Gone.\n" }], who: "theirs" },
  ];
  function shown() {
    const view = new EditorView({ state: EditorState.create({ doc: NOW, selection: { anchor: at("quick") }, extensions: [visualPage, pageFurniture] }) });
    views.push(view);
    view.dispatch({ effects: showChanges.of({ since: "Draft 1", changes: CHANGES }) });
    return view;
  }

  it("draws what was put in underlined and what was taken out struck through, in the author's colour, with a bar beside the lines", () => {
    const view = shown();
    expect([...view.contentDOM.querySelectorAll(".cm-v-ins.cm-v-theirs")].map((e) => e.textContent)).toEqual(["red"]);
    expect([...view.contentDOM.querySelectorAll(".cm-v-del")].map((e) => e.textContent)).toEqual(["brown", "Gone. ↵"]);
    expect(view.contentDOM.querySelectorAll(".cm-v-changed").length).toBeGreaterThan(0);
    expect(view.state.doc.toString()).toBe(NOW);
  });

  it("keeps a change, taking its marks away and leaving the text, or undoes it, putting back what the snapshot had", () => {
    const kept = shown();
    expect(keepChange(kept)).toBe(true);
    expect(kept.contentDOM.querySelector(".cm-v-ins, .cm-v-del")).toBeNull();
    expect(kept.state.doc.toString()).toBe(NOW);
    const undone = shown();
    expect(undoChange(undone)).toBe(true);
    expect(undone.state.doc.toString()).toBe("\\begin{document}\nThe quick brown fox.\nGone.\nLast line.\n\\end{document}\n");
    expect(undone.contentDOM.querySelector(".cm-v-ins, .cm-v-del")).toBeNull();
  });

  it("never takes text typed at a change's edges when the change is undone", () => {
    const view = shown();
    view.dispatch({ changes: { from: at("Last"), insert: "NEW " } });
    view.dispatch({ selection: { anchor: at("quick") } });
    expect(undoChange(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\begin{document}\nThe quick brown fox.\nGone.\nNEW Last line.\n\\end{document}\n");
    // A change that only took something out: what is typed where it was stays.
    const only = new EditorView({ state: EditorState.create({ doc: NOW, selection: { anchor: at("Last") }, extensions: [visualPage, pageFurniture] }) });
    views.push(only);
    only.dispatch({ effects: showChanges.of({ since: "s", changes: [{ from: at("Last"), to: at("Last"), old: "Gone.\n", inserted: [], deleted: [{ at: at("Last"), text: "Gone.\n" }], who: "mine" }] }) });
    only.dispatch({ changes: { from: at("Last"), insert: "Typed " }, selection: { anchor: at("Last") } });
    expect(undoChange(only)).toBe(true);
    expect(only.state.doc.toString()).toBe(NOW.replace("Last line.", "Gone.\nTyped Last line."));
  });

  it("goes to the next change, and follows the text as it is edited", () => {
    const view = shown();
    view.dispatch({ selection: { anchor: 0 } });
    expect(nextChange(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(at("The"));
    view.dispatch({ changes: { from: at("quick"), insert: "very " } });
    expect([...view.contentDOM.querySelectorAll(".cm-v-ins")].map((e) => e.textContent)).toEqual(["red"]);
    expect(undoChange(view)).toBe(true);
    expect(view.state.doc.toString()).toContain("The quick brown fox.\nGone.\nLast line.");
  });
});

describe("page view: the bridge to LaTeX", () => {
  const text = (view: EditorView) => view.state.doc.toString();

  it("draws a TikZ picture as one block with its LaTeX until there is a PDF, steps past it on Backspace, and shows its LaTeX from its bar", () => {
    const B = String.fromCharCode(92);
    const doc = `${B}begin{document}\nBefore.\n${B}begin{tikzpicture}\n  ${B}draw (0,0) -- (1,1);\n${B}end{tikzpicture}\nAfter.\n${B}end{document}\n`;
    const view = editor(doc, doc.indexOf("\nAfter."));
    const block = view.contentDOM.querySelector(".cm-v-latexblock");
    expect(block?.querySelector("pre")?.textContent).toContain(`${B}draw (0,0)`);
    expect(block?.querySelector(".cm-v-lb-bar")?.textContent).toContain("tikzpicture");
    pageBackspace(view);
    expect(text(view)).toBe(doc);
    expect(view.state.selection.main.head).toBeLessThan(doc.indexOf("After."));
    (block?.querySelector("button") as HTMLButtonElement).click();
    expect(view.contentDOM.querySelector(".cm-v-latexblock")).toBeNull();
    expect(notShown(view)).not.toContain(`${B}draw (0,0) -- (1,1);`);
  });

  it("draws a command of the document's own as what it prints, and takes it whole on Backspace", () => {
    const B = String.fromCharCode(92);
    const doc = `${B}documentclass{article}\n${B}newcommand{${B}gwr}{groundwater recharge}\n${B}begin{document}\nThe ${B}gwr{} rate.\n${B}end{document}\n`;
    const view = editor(doc, doc.indexOf(" rate"));
    expect(view.contentDOM.querySelector(".cm-v-macro")?.textContent).toBe("groundwater recharge");
    pageBackspace(view);
    expect(text(view)).toBe(doc.replace(`${B}gwr{}`, ""));
  });
});

describe("page view: typing at the edge of formatting", () => {
  const text = (view: EditorView) => view.state.doc.toString();
  const type = (view: EditorView, insert: string) => view.dispatch({ ...view.state.replaceSelection(insert), userEvent: "input.type" });
  const B = String.fromCharCode(92);
  const doc = (body: string) => `${B}begin{document}\n${body}\n${B}end{document}\n`;

  it("goes on in the formatting of the word before it, on either side of the hidden brace, as in Word", () => {
    for (const where of [at("bold}", 4), at("} text", 1)]) {
      const view = editor(DOC, where);
      type(view, "er");
      type(view, "s");
      expect(text(view)).toContain(`Some ${B}textbf{bolders} text`);
      expect(view.state.selection.main.head).toBe(text(view).indexOf("} text"));
    }
  });

  it("stays plain after a plain word, before a formatted one, and after the space that follows one", () => {
    for (const where of [at(`${B}textbf`), at("bold")]) {
      const view = editor(DOC, where);
      type(view, "X");
      expect(text(view)).toContain(`Some X${B}textbf{bold} text`);
    }
    const view = editor(DOC, at(" text", 1));
    type(view, "Y");
    expect(text(view)).toContain(`${B}textbf{bold} Ytext`);
  });

  it("at the start of a paragraph, a heading or an item, takes the formatting of what follows", () => {
    const para = doc(`${B}textbf{Bold} start.`);
    const view = editor(para, para.indexOf(`${B}textbf`));
    type(view, "X");
    expect(text(view)).toContain(`${B}textbf{XBold} start.`);
    const heading = doc(`${B}section{Intro}\nText.`);
    const top = editor(heading, heading.indexOf(`${B}section`));
    type(top, "A ");
    expect(text(top)).toContain(`${B}section{A Intro}`);
    const end = editor(heading, heading.indexOf("}\nText"));
    end.dispatch({ selection: { anchor: heading.indexOf("}\nText") + 1 } });
    type(end, "s");
    expect(text(end)).toContain(`${B}section{Intros}\nText.`);
    const list = doc(`${B}begin{itemize}\n  ${B}item ${B}textbf{Term} rest\n${B}end{itemize}`);
    const item = editor(list, list.indexOf(`${B}textbf`));
    type(item, "X");
    expect(text(item)).toContain(`${B}item ${B}textbf{XTerm} rest`);
  });

  it("goes in the empty group a tool leaves for typing, and inside every format the word before it has", () => {
    const empty = doc(`Some ${B}textbf{bold}${B}textit{} text`);
    const view = editor(empty, empty.indexOf(`${B}textit{}`) + `${B}textit{`.length);
    type(view, "new");
    expect(text(view)).toContain(`${B}textbf{bold}${B}textit{new} text`);
    const nested = doc(`A ${B}textbf{${B}textit{word}} after`);
    const deep = editor(nested, nested.indexOf("} after") + 1);
    type(deep, "s");
    expect(text(deep)).toContain(`A ${B}textbf{${B}textit{words}} after`);
    const two = doc(`${B}textbf{a}${B}textit{b} c`);
    for (const where of [two.indexOf("a}") + 1, two.indexOf("a}") + 2, two.indexOf("b}")]) {
      const between = editor(two, where);
      type(between, "X");
      expect(text(between)).toContain(`${B}textbf{aX}${B}textit{b} c`);
    }
  });

  it("does not run on a link, nor take a formula's neighbour into a format", () => {
    const link = doc(`See ${B}href{https://x.org}{the site} now.`);
    for (const where of [link.indexOf("} now"), link.indexOf("} now") + 1]) {
      const view = editor(link, where);
      type(view, "!");
      expect(text(view)).toContain(`${B}href{https://x.org}{the site}! now.`);
    }
    const formula = doc(`Take $x$${B}textbf{b} here.`);
    const view = editor(formula, formula.indexOf(`${B}textbf`) + `${B}textbf{`.length);
    type(view, "y");
    expect(text(view)).toContain(`$x$y${B}textbf{b} here.`);
  });

  it("each cursor goes on in its own word's formatting, and the draft view and the LaTeX side are left as they are", () => {
    const two = doc(`${B}textbf{one} and ${B}textit{two} end`);
    const view = new EditorView({
      state: EditorState.create({
        doc: two,
        selection: EditorSelection.create([EditorSelection.cursor(two.indexOf("} and") + 1), EditorSelection.cursor(two.indexOf("} end") + 1)]),
        extensions: [visualPage, EditorState.allowMultipleSelections.of(true)],
      }),
    });
    views.push(view);
    type(view, "s");
    expect(text(view)).toContain(`${B}textbf{ones} and ${B}textit{twos} end`);
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([text(view).indexOf("} and"), text(view).indexOf("} end")]);
    const draft = new EditorView({ state: EditorState.create({ doc: DOC, selection: { anchor: at("} text", 1) }, extensions: [visualMode] }) });
    views.push(draft);
    type(draft, "X");
    expect(text(draft)).toContain(`${B}textbf{bold}X text`);
    const latex = editor(DOC, at("} text", 1));
    latex.dispatch({ changes: { from: at("} text", 1), insert: "X" }, annotations: fromOtherSide.of(true), userEvent: "input.type" });
    expect(text(latex)).toContain(`${B}textbf{bold}X text`);
  });

  /** Type as the browser does, through the editor's input handlers (closeBrackets among them), one key at a time. */
  function typeAsKeys(view: EditorView, keys: string) {
    for (const ch of keys) {
      const { from, to } = view.state.selection.main;
      const insert = () => view.state.update({ changes: { from, to, insert: ch }, selection: { anchor: from + ch.length }, userEvent: "input.type", scrollIntoView: true });
      if (!view.state.facet(EditorView.inputHandler).some((h) => h(view, from, to, ch, insert))) view.dispatch(insert());
    }
  }
  const withBrackets = (doc: string, at: number) => {
    const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: at }, extensions: [visualPage, closeBrackets()] }) });
    views.push(view);
    return view;
  };

  it("types brackets that close themselves inside the formatting, each closed once", () => {
    const view = withBrackets(DOC, at("} text", 1));
    typeAsKeys(view, "(s)");
    expect(text(view)).toContain(`Some ${B}textbf{bold(s)} text`);
    expect(view.state.selection.main.head).toBe(text(view).indexOf("} text"));
  });

  it("never puts a %, a backslash or a brace before a hidden brace, where it would break the command", () => {
    const comment = withBrackets(DOC, at("} text", 1));
    typeAsKeys(comment, "%x");
    expect(text(comment)).toContain(`Some ${B}textbf{bold}%x text`);
    const slash = withBrackets(DOC, at("} text", 1));
    typeAsKeys(slash, B);
    expect(text(slash)).toContain(`Some ${B}textbf{bold}${B} text`);
    const brace = withBrackets(DOC, at("} text", 1));
    typeAsKeys(brace, "{");
    expect(text(brace)).toContain(`Some ${B}textbf{bold}{} text`);
  });

  it("with LaTeX marks shown, types where the cursor is beside the brace it shows", () => {
    setLatexMarks(true);
    try {
      const view = editor(DOC, at("} text", 1));
      type(view, "X");
      expect(text(view)).toContain(`${B}textbf{bold}X text`);
    } finally {
      setLatexMarks(false);
    }
  });

  it("does not run on a link written over two lines", () => {
    const link = doc(`See ${B}href{https://x.org}{the\nsite} now.`);
    const view = editor(link, link.indexOf("} now") + 1);
    type(view, "!");
    expect(text(view)).toContain("site}! now.");
  });

  it("keeps a cursor typing put between brackets where it was among them", () => {
    const view = editor(DOC, at("} text", 1));
    view.dispatch({ changes: { from: at("} text", 1), insert: "()" }, selection: { anchor: at("} text", 2) }, userEvent: "input.type" });
    expect(text(view)).toContain(`${B}textbf{bold()} text`);
    expect(view.state.selection.main.head).toBe(text(view).indexOf("()") + 1);
  });
});
