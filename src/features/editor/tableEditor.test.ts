// @vitest-environment jsdom
// The table widget driven as a person would drive it: a real editor holding a real document,
// with the table drawn in it, clicked, typed in and changed through its tools.
import { history } from "@codemirror/commands";
import { EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { EditableTable } from "./tableEditor";

const PREAMBLE = "\\documentclass{article}\n\\begin{document}\n\n";
const TABLE = "\\begin{tabular}{|l|l|}\n  \\hline\n  Name   &   Value \\\\\n  \\hline\n  $x$    &   two \\\\\n  \\hline\n\\end{tabular}";

let view: EditorView | null = null;

// What jsdom lacks: scrolling, and the clipboard's data on copy and paste events.
Element.prototype.scrollTo ??= function () {};
class Clip {
  private data = new Map<string, string>();
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? "";
  }
}
const clipboard = (el: Element, type: "copy" | "paste", data: Clip) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", { value: data });
  el.dispatchEvent(e);
};

/** An editor with the document, the table in it drawn as the table editor. */
function open(doc = `${PREAMBLE}${TABLE}\n\nAfter.\n\\end{document}\n`) {
  const tables = StateField.define<DecorationSet>({
    create: (state) => decorate(state.doc.toString()),
    update: (deco, tr) => (tr.docChanged ? decorate(tr.state.doc.toString()) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({ state: EditorState.create({ doc, extensions: [history(), tables] }), parent });
  return view;
}

/** Draw the one tabular in `text` as an editable table. */
function decorate(text: string): DecorationSet {
  const from = text.indexOf("\\begin{tabular}");
  const close = "\\end{tabular}";
  const to = text.indexOf(close, from) + close.length;
  if (from < 0) return Decoration.none;
  return Decoration.set([Decoration.replace({ widget: new EditableTable(text.slice(from, to)), block: true }).range(from, to)]);
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

const doc = () => view!.state.doc.toString();
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const $$ = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector));
const td = (r: number, c: number) => $(`.cm-v-tedit td[data-r="${r}"][data-c="${c}"]`)!;
const box = () => $<HTMLInputElement>(".cm-v-tedit input.cm-v-tcell");
const mouse = (el: Element, type: string, more: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...more }));
const up = () => window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
const press = (el: Element, key: string, more: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more }));
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const click = (el: Element) => {
  mouse(el, "mousedown");
  up();
};
const tool = (id: string) => $<HTMLButtonElement>(`.cm-v-tbar button[data-action="${id}"]`);
/** Use an action from the tool bar's menus. */
const fromMenu = (id: string) => {
  const holder = $$(".cm-v-tbar button[data-items]").find((b) => b.dataset.items!.split(" ").includes(id))!;
  holder.click();
  $<HTMLButtonElement>(`.cm-v-tmenu button[data-action="${id}"]`)!.click();
};

describe("the table widget", () => {
  it("opens a cell to type in when it is clicked, and changes only that cell's text where it stands", () => {
    open();
    click(td(0, 1));
    expect(box()?.value).toBe("Value");
    type(box()!, "Total");
    // The hand-made layout around the cell is kept.
    expect(doc()).toContain("  Name   &   Total \\\\\n  \\hline\n  $x$    &   two \\\\");
    type(box()!, "R&D");
    expect(doc()).toContain("&   R\\&D \\\\");
  });

  it("keeps brackets typed at the start of a row from being read as an option of what is before them", () => {
    open(`${PREAMBLE}\\begin{tabular}{ll}\n\\rowcolor{gray} a & b \\\\\nc & d \\\\\n\\end{tabular}\n\\end{document}\n`);
    click(td(0, 0));
    type(box()!, "[1] Smith");
    expect(doc()).toContain("\\rowcolor{gray} {}[1] Smith & b \\\\");
    press(box()!, "Escape");
    click(td(1, 0));
    type(box()!, "[2] Jones");
    expect(doc()).toContain("\\\\\n{}[2] Jones & d \\\\");
    // Taking the [ away again takes the {} with it.
    type(box()!, "{}");
    expect(box()!.value).toBe("");
  });

  it("moves between cells with Tab, and adds a row after the last", () => {
    open();
    click(td(1, 1));
    press(box()!, "Tab");
    expect(td(2, 0)).toBeTruthy();
    expect(box()?.closest("td")).toBe(td(2, 0));
    expect((doc().match(/\\\\/g) ?? []).length).toBe(3);
  });

  it("selects cells by dragging, and sets them all in bold from the tool bar", () => {
    open();
    mouse(td(0, 0), "mousedown");
    mouse(td(1, 0), "mouseover");
    up();
    expect($$(".cm-v-tedit td.sel")).toHaveLength(2);
    tool("bold")!.click();
    expect(doc()).toContain("\\textbf{Name}");
    expect(doc()).toContain("\\textbf{$x$}");
    expect(doc()).not.toContain("\\textbf{Value}");
  });

  it("selects a whole row or column by its handle, and the table by its corner", () => {
    open();
    mouse($$(".cm-v-tedit th.cm-v-rowh")[1], "mousedown");
    up();
    expect($$(".cm-v-tedit td.sel").map((c) => c.dataset.r)).toEqual(["1", "1"]);
    mouse($$(".cm-v-tedit th.cm-v-colh")[0], "mousedown");
    up();
    expect($$(".cm-v-tedit td.sel").map((c) => c.dataset.c)).toEqual(["0", "0"]);
    mouse($(".cm-v-tedit th.cm-v-corner")!, "mousedown");
    up();
    expect($$(".cm-v-tedit td.sel")).toHaveLength(4);
  });

  it("selects cells when a drag that starts in a cell's text goes on into another", () => {
    open();
    click(td(0, 0));
    mouse(box()!, "mousedown");
    mouse(td(0, 1), "mouseover");
    up();
    expect(box()).toBeNull();
    expect($$(".cm-v-tedit td.sel")).toHaveLength(2);
  });

  it("empties selected cells with Delete, as one step for undo", () => {
    open();
    mouse(td(1, 0), "mousedown");
    mouse(td(1, 1), "mouseover");
    up();
    press($(".cm-v-tedit")!, "Delete");
    expect(doc()).not.toContain("two");
    press($(".cm-v-tedit")!, "z", { ctrlKey: true });
    expect(doc()).toContain("two");
  });

  it("copies selected cells, and pastes cells from the one selected on", () => {
    open();
    mouse(td(0, 0), "mousedown");
    mouse(td(0, 1), "mouseover");
    up();
    const copied = new Clip();
    clipboard($(".cm-v-tedit")!, "copy", copied);
    expect(copied.getData("text/plain")).toBe("Name\tValue");
    click(td(1, 0));
    press(box()!, "Escape");
    const pasted = new Clip();
    pasted.setData("text/plain", "a_1\tb");
    clipboard($(".cm-v-tedit")!, "paste", pasted);
    expect(doc()).toContain("a\\_1");
  });

  it("draws the book style from the Borders menu, adding its package", () => {
    open();
    click(td(0, 0));
    fromMenu("bordersBook");
    expect(doc()).toContain("\\usepackage{booktabs}");
    expect(doc()).toMatch(/\\toprule[\s\S]*\\midrule[\s\S]*\\bottomrule/);
  });

  it("keeps a box open, text and all, when the keyboard leaves it before the text is complete", () => {
    open();
    const outside = document.body.appendChild(document.createElement("button"));
    click(td(0, 1));
    type(box()!, "\\textbf{open");
    expect(box()!.classList.contains("bad")).toBe(true);
    box()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    expect(box()?.value).toBe("\\textbf{open");
    // Completed, it goes in.
    type(box()!, "\\textbf{open}");
    expect(doc()).toContain("\\textbf{open}");
  });

  it("deletes the whole table, which undo brings back", () => {
    open();
    click(td(0, 0));
    fromMenu("deleteTable");
    expect(doc()).not.toContain("tabular");
    expect(doc()).toBe(`${PREAMBLE}\nAfter.\n\\end{document}\n`);
  });

  it("puts the text cursor at the table after undo, so the status line shows where the work is", () => {
    open();
    click(td(0, 1));
    type(box()!, "Total");
    press(box()!, "z", { ctrlKey: true });
    expect(view!.state.selection.main.head).toBe(doc().indexOf("\\begin{tabular}"));
  });
});
