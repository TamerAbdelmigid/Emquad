// @vitest-environment jsdom
// The page and its LaTeX side by side: one text in two views, an edit in either shown in both,
// and the block the cursor is in lit in the other.
import { undo } from "@codemirror/commands";
import { afterEach, describe, expect, it } from "vitest";
import { buffers } from "./buffers";

const DOC = "\\documentclass{article}\n\\begin{document}\nFirst paragraph.\n\nSecond paragraph,\nits second line.\n\\end{document}\n";

let detach: (() => void)[] = [];
afterEach(() => {
  detach.forEach((d) => d());
  detach = [];
  buffers.closeAll();
});

function split() {
  const page = document.body.appendChild(document.createElement("div"));
  const latex = document.body.appendChild(document.createElement("div"));
  detach.push(buffers.attach(page));
  buffers.open("main.tex", DOC);
  buffers.show("main.tex");
  detach.push(buffers.attachSource(latex));
  return { page: buffers.showNow("main.tex")!, latex: buffers.sourceView()! };
}

describe("the page and its LaTeX side by side", () => {
  it("shows the same text in both, an edit in the LaTeX going into the page and the other way round", () => {
    const { page, latex } = split();
    expect(latex.state.doc.toString()).toBe(DOC);
    latex.dispatch({ changes: { from: DOC.indexOf("First"), insert: "My " }, userEvent: "input.type" });
    expect(buffers.text("main.tex")).toBe(DOC.replace("First", "My First"));
    page.dispatch({ changes: { from: 0, insert: "% top\n" } });
    expect(latex.state.doc.toString()).toBe(`% top\n${DOC.replace("First", "My First")}`);
  });

  it("undoes an edit made in the LaTeX from either side, as one history", () => {
    const { page, latex } = split();
    latex.dispatch({ changes: { from: DOC.indexOf("First"), insert: "My " }, userEvent: "input.type" });
    undo(page);
    expect(buffers.text("main.tex")).toBe(DOC);
    expect(latex.state.doc.toString()).toBe(DOC);
  });

  it("undoes a word typed in the LaTeX as one step, and takes LaTeX edited there as it is, never as typing on the page", () => {
    buffers.setVisual(true, true);
    const text = DOC.replace("First paragraph.", "A \\textbf{bold} word.");
    const page = document.body.appendChild(document.createElement("div"));
    const latex = document.body.appendChild(document.createElement("div"));
    detach.push(buffers.attach(page));
    buffers.open("main.tex", text);
    buffers.show("main.tex");
    detach.push(buffers.attachSource(latex));
    const pageView = buffers.showNow("main.tex")!;
    const side = buffers.sourceView()!;
    const at = text.indexOf("word");
    for (const [i, c] of [..."new "].entries()) side.dispatch({ changes: { from: at + i, insert: c }, selection: { anchor: at + i + 1 }, userEvent: "input.type" });
    expect(buffers.text("main.tex")).toBe(text.replace("word", "new word"));
    undo(pageView);
    expect(buffers.text("main.tex")).toBe(text);
    // Deleting part of a command on the LaTeX side deletes it: there the LaTeX is what is edited.
    const bold = text.indexOf("\\textbf{");
    side.dispatch({ changes: { from: bold, to: bold + "\\textbf{".length }, userEvent: "delete.backward" });
    expect(buffers.text("main.tex")).toBe(text.replace("\\textbf{", ""));
    expect(side.state.doc.toString()).toBe(text.replace("\\textbf{", ""));
    buffers.setVisual(false);
  });

  it("lights nothing on a page shown again after the LaTeX beside it was closed", () => {
    const { page } = split();
    const latex = buffers.sourceView()!;
    latex.dispatch({ selection: { anchor: DOC.indexOf("First") } });
    expect(page.contentDOM.querySelectorAll(".cm-linked").length).toBe(1);
    buffers.open("other.tex", "Other.\n");
    buffers.show("other.tex");
    detach.pop()!();
    expect(buffers.showNow("main.tex")!.contentDOM.querySelectorAll(".cm-linked").length).toBe(0);
  });

  it("lights the paragraph the cursor is in on the other side, both ways", () => {
    const { page, latex } = split();
    page.dispatch({ selection: { anchor: DOC.indexOf("its second") } });
    const lit = [...latex.contentDOM.querySelectorAll(".cm-linked")].map((l) => l.textContent);
    expect(lit).toEqual(["Second paragraph,", "its second line."]);
    latex.dispatch({ selection: { anchor: DOC.indexOf("First") } });
    expect([...page.contentDOM.querySelectorAll(".cm-linked")].map((l) => l.textContent)).toEqual(["First paragraph."]);
  });

  it("follows the file on screen when another is shown", () => {
    const { latex } = split();
    buffers.open("other.tex", "Other text.\n");
    buffers.show("other.tex");
    expect(buffers.sourceView()?.state.doc.toString() ?? latex.state.doc.toString()).toBe("Other text.\n");
  });
});
