// The page and its LaTeX side by side: the paragraph the cursor is in on one side is lit on the
// other, so the eye goes from the drawing to what it is written as, and back.
import { Annotation, type EditorState, type Extension, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export interface Block {
  from: number;
  to: number;
}

/**
 * On an edit passed from one side to the other. The LaTeX side's edits are of the LaTeX itself, so
 * the page view's filters, which keep typing on the page from cutting a command, let them be.
 */
export const fromOtherSide = Annotation.define<boolean>();

/** Light this block, or nothing (null). */
export const setLinked = StateEffect.define<Block | null>();

const linkedField = StateField.define<Block | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLinked)) return e.value;
    return value && tr.docChanged ? { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) } : value;
  },
});

const linkedDrawn = EditorView.decorations.compute([linkedField, "doc"], (state) => {
  const block = state.field(linkedField);
  if (!block || block.from > state.doc.length) return Decoration.none;
  const lines = [];
  for (let at = state.doc.lineAt(block.from).from; at <= Math.min(block.to, state.doc.length); ) {
    const line = state.doc.lineAt(at);
    lines.push(Decoration.line({ class: "cm-linked" }).range(line.from));
    if (line.to >= block.to || line.to >= state.doc.length) break;
    at = line.to + 1;
  }
  return Decoration.set(lines);
});

/** What lights a block in an editor. */
export const linkedBlock: Extension = [linkedField, linkedDrawn];

/** The block lit in `state`, if any. */
export function linkedIn(state: EditorState): Block | null {
  return state.field(linkedField, false) ?? null;
}

/** A line that is structure rather than text: a block of its own. */
const STRUCTURE = /^[ \t]*\\(?:begin|end|item|part|chapter|section|subsection|subsubsection|paragraph|maketitle|tableofcontents|newpage|clearpage|documentclass|usepackage)(?![a-zA-Z])/;

/** The paragraph around `pos`: the lines up to a blank line or a line of structure on either side. */
export function blockAround(doc: Text, pos: number): Block {
  let first = doc.lineAt(Math.min(pos, doc.length));
  let last = first;
  if (!first.text.trim() || STRUCTURE.test(first.text)) return { from: first.from, to: first.to };
  const text = (n: number) => doc.line(n).text;
  while (first.number > 1 && text(first.number - 1).trim() && !STRUCTURE.test(text(first.number - 1))) first = doc.line(first.number - 1);
  while (last.number < doc.lines && text(last.number + 1).trim() && !STRUCTURE.test(text(last.number + 1))) last = doc.line(last.number + 1);
  return { from: first.from, to: last.to };
}
