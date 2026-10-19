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
