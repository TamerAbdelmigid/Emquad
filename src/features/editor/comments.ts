// Comments in the editor: the passages that have a comment are tinted, and each tint follows
// its words as the text around them is edited. Finding a passage in the first place is done in
// commentAnchor.ts.
import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export interface Placed {
  id: string;
  from: number;
  to: number;
  /** Resolved: still followed, no longer tinted. */
  quiet: boolean;
}

interface Value {
  placed: Placed[];
  /** The comment picked out in the panel. */
  focus: string | null;
}

export const placeComments = StateEffect.define<Placed[]>();
export const focusComment = StateEffect.define<string | null>();
let onPick: (id: string) => void = () => {};

/** Called with a comment's id when its passage is clicked. */
export function setCommentPick(pick: (id: string) => void) {
  onPick = pick;
}

const field = StateField.define<Value>({
  create: () => ({ placed: [], focus: null }),
  update(value, tr) {
    let { placed, focus } = value;
    if (tr.docChanged) {
      // Text typed at either edge of a passage stays outside it.
      placed = placed.map((p) => {
        const from = tr.changes.mapPos(p.from, 1);
        return { ...p, from, to: Math.max(from, tr.changes.mapPos(p.to, -1)) };
      });
    }
    for (const e of tr.effects) {
      if (e.is(placeComments)) placed = e.value;
      else if (e.is(focusComment)) focus = e.value;
    }
    return placed === value.placed && focus === value.focus ? value : { placed, focus };
  },
  provide: (f) =>
    EditorView.decorations.from(f, ({ placed, focus }) =>
      Decoration.set(
        placed
          .filter((p) => p.to > p.from && (!p.quiet || p.id === focus))
          .map((p) =>
            Decoration.mark({ class: p.id === focus ? "cm-comment cm-comment-on" : "cm-comment", attributes: { "data-comment": p.id } }).range(p.from, p.to),
          ),
        true,
      ),
    ),
});

/** Where each comment of this file sits now. A passage that was deleted has no length. */
export function placedComments(state: EditorState): Placed[] {
  return state.field(field, false)?.placed ?? [];
}

/** Everything comments add to an editor. */
export const commenting: Extension = [
  field,
  EditorView.domEventHandlers({
    click(event) {
      const id = (event.target as HTMLElement).closest?.("[data-comment]")?.getAttribute("data-comment");
      if (id) onPick(id);
      return false;
    },
  }),
];
