// @vitest-environment jsdom
// When visual mode draws again: at once when what is drawn is reached, or after a pause while
// typing in plain text, and never just because the cursor passes through plain text.
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { redrawVisual, visualMode } from "./visual";

const DOC = "\\begin{document}\nSome text with $x^2$ in it.\n\nMore text here.\n\\end{document}\n";

/** What is drawn in a state: the stretches replaced by a drawing, as the text they cover. */
function drawn(state: EditorState): string[] {
  const view = new EditorView({ state });
  const out: string[] = [];
  for (const deco of view.state.facet(EditorView.decorations)) {
    const set = typeof deco === "function" ? deco(view) : deco;
    set.between(0, state.doc.length, (from, to, d) => {
      if (from < to && d.spec.widget) out.push(state.doc.sliceString(from, to));
    });
  }
  view.destroy();
  return out;
}

describe("visual mode's drawing", () => {
  const start = (at: number) => EditorState.create({ doc: DOC, selection: { anchor: at }, extensions: [visualMode] });
  const more = DOC.indexOf("More text");

  it("draws a formula, and shows its source when the cursor moves into it", () => {
    let state = start(more);
    expect(drawn(state)).toEqual(["$x^2$"]);
    state = state.update({ selection: { anchor: DOC.indexOf("x^2") } }).state;
    expect(drawn(state)).toEqual([]);
    state = state.update({ selection: { anchor: more + 2 } }).state;
    expect(drawn(state)).toEqual(["$x^2$"]);
  });

  it("moves the drawing along while typing, and draws what was typed once asked to", () => {
    let state = start(more);
    const type = (text: string) => {
      const at = state.selection.main.head;
      state = state.update({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: "input.type" }).state;
    };
    type("A $y$ and ");
    // Not yet drawn, but the formula already there is where it was.
    expect(drawn(state)).toEqual(["$x^2$"]);
    state = state.update({ effects: redrawVisual.of(null) }).state;
    expect(drawn(state)).toEqual(["$x^2$", "$y$"]);
  });

  it("draws at once a change that is not typing, or that reaches a drawing", () => {
    let state = start(more);
    const change = (tr: Transaction) => (state = tr.state);
    change(state.update({ changes: { from: DOC.indexOf("here"), insert: "$z$ " } }));
    expect(drawn(state)).toEqual(["$x^2$", "$z$"]);
    const formula = state.doc.toString().indexOf("$x^2$");
    change(state.update({ changes: { from: formula, to: formula + 5, insert: "$w$" }, userEvent: "input.type" }));
    expect(drawn(state)).toEqual(["$w$", "$z$"]);
  });
});
