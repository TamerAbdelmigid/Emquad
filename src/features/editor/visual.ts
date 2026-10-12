// Visual mode: draws the same plain source with headings, emphasis, typeset mathematics and
// bullets. What to draw is decided in visualModel.ts; this file turns that into decorations.
import { type EditorState, type Extension, type Range as CmRange, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import { visualPieces } from "./visualModel";

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.display ? "cm-v-math cm-v-display" : "cm-v-math";
    // A formula that cannot be typeset is shown as its source, marked, never as an error box.
    try {
      katex.render(this.tex, el, { displayMode: this.display, throwOnError: true, output: "html" });
    } catch {
      el.textContent = this.tex;
      el.classList.add("cm-v-math-bad");
      el.title = "This formula could not be previewed here. It may still compile.";
    }
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-v-bullet";
    el.textContent = "•";
    return el;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });

function build(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  // Very large files stay in plain source: redrawing them on every keystroke would lag.
  if (text.length > 400_000) return Decoration.none;
  const selection = state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));
  const out: CmRange<Decoration>[] = [];
  for (const p of visualPieces(text, selection)) {
    if (p.kind === "line") out.push(Decoration.line({ class: `cm-v-line-${p.style}` }).range(p.from));
    else if (p.kind === "hide") out.push(hidden.range(p.from, p.to));
    else if (p.kind === "bullet") out.push(bullet.range(p.from, p.to));
    else if (p.kind === "style") out.push(Decoration.mark({ class: `cm-v-${p.style}` }).range(p.from, p.to));
    else out.push(Decoration.replace({ widget: new MathWidget(p.tex, p.display) }).range(p.from, p.to));
  }
  return Decoration.set(out, true);
}

// Kept in editor state rather than a view plugin, because a formula that spans several lines
// replaces line breaks, which only state-provided decorations may do.
const drawing = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => (tr.docChanged || tr.selection ? build(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});

/** Everything visual mode adds to an editor. */
export const visualMode: Extension = [drawing, EditorView.editorAttributes.of({ class: "cm-visual" })];
