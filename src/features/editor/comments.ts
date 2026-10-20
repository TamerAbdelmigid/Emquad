// Comments in the editor: the passages that have a comment are tinted, and each tint follows
// its words as the text around them is edited. Finding a passage in the first place is done in
// commentAnchor.ts.
import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

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
  /** Comments are shown as balloons beside the page. */
  balloons: boolean;
}

/** What a balloon shows of a comment. */
export interface Said {
  id: string;
  author: string;
  text: string;
  replies: number;
}

export const placeComments = StateEffect.define<Placed[]>();
export const focusComment = StateEffect.define<string | null>();
/** Show comments as balloons beside the page, or not. */
export const showBalloons = StateEffect.define<boolean>();
/** What each comment says, for its balloon. */
let said: (id: string) => Said | undefined = () => undefined;
export function setSaid(read: (id: string) => Said | undefined) {
  said = read;
}
let onPick: (id: string) => void = () => {};

/** Called with a comment's id when its passage is clicked. */
export function setCommentPick(pick: (id: string) => void) {
  onPick = pick;
}

const field = StateField.define<Value>({
  create: () => ({ placed: [], focus: null, balloons: true }),
  update(value, tr) {
    let { placed, focus, balloons } = value;
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
      else if (e.is(showBalloons)) balloons = e.value;
    }
    return placed === value.placed && focus === value.focus && balloons === value.balloons ? value : { placed, focus, balloons };
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

/**
 * Where each balloon goes, from where its passage is and how tall it is: level with its passage,
 * or just below the balloon above when that one is in the way. In order of the passages.
 */
export function stackBalloons(wanted: { top: number; height: number }[], gap: number): number[] {
  const out: number[] = [];
  let below = -Infinity;
  for (const w of wanted) {
    const top = Math.max(w.top, below);
    out.push(top);
    below = top + w.height + gap;
  }
  return out;
}

/** The comments shown as balloons in a file: on a passage, and not resolved unless picked out. */
function ballooned(state: EditorState): Placed[] {
  const value = state.field(field, false);
  if (!value?.balloons) return [];
  return value.placed.filter((p) => p.to > p.from && (!p.quiet || p.id === value.focus) && said(p.id)).sort((a, b) => a.from - b.from);
}

/**
 * Comments as Word shows them in the page view: a balloon beside the page, level with each
 * passage, that picks the comment out when clicked. The page moves over to make room.
 */
const balloons = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;
    /** What was drawn last, to draw again only when it changes: reading heights forces a layout. */
    drawn = "";
    constructor(readonly view: EditorView) {
      this.dom = document.createElement("div");
      this.dom.className = "cm-balloons";
      this.dom.setAttribute("aria-label", "Comments beside the page");
      view.scrollDOM.appendChild(this.dom);
      this.measure();
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged || update.startState.field(field, false) !== update.state.field(field, false)) this.measure();
    }
    measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          if (!view.dom.classList.contains("cm-page")) return [];
          const scroller = view.scrollDOM.getBoundingClientRect();
          const content = view.contentDOM.getBoundingClientRect();
          return ballooned(view.state).flatMap((p) => {
            const at = view.coordsAtPos(p.from);
            return at ? [{ id: p.id, top: at.top - scroller.top + view.scrollDOM.scrollTop, left: content.right - scroller.left + view.scrollDOM.scrollLeft + 14 }] : [];
          });
        },
        write: (places) => this.draw(places),
      });
    }
    draw(places: { id: string; top: number; left: number }[]) {
      const focus = this.view.state.field(field, false)?.focus;
      const key = JSON.stringify([focus, places, places.map((p) => said(p.id))]);
      if (key === this.drawn) return;
      this.drawn = key;
      this.dom.replaceChildren(
        ...places.map((p) => {
          const s = said(p.id)!;
          const b = document.createElement("button");
          b.type = "button";
          b.className = p.id === focus ? "cm-balloon on" : "cm-balloon";
          b.dataset.comment = p.id;
          b.style.left = `${p.left}px`;
          const who = b.appendChild(document.createElement("b"));
          who.textContent = s.author;
          const what = b.appendChild(document.createElement("span"));
          what.textContent = s.text.length > 160 ? `${s.text.slice(0, 157)}…` : s.text;
          if (s.replies) b.appendChild(document.createElement("i")).textContent = `${s.replies} ${s.replies === 1 ? "reply" : "replies"}`;
          b.onclick = () => onPick(p.id);
          return b;
        }),
      );
      const kids = [...this.dom.children] as HTMLElement[];
      const tops = stackBalloons(places.map((p, i) => ({ top: p.top, height: kids[i].offsetHeight })), 6);
      kids.forEach((k, i) => (k.style.top = `${tops[i]}px`));
    }
    destroy() {
      this.dom.remove();
    }
  },
);

/** Room is made beside the page while it has balloons to show. */
const roomForBalloons = EditorView.editorAttributes.compute([field], (state) => (ballooned(state).length ? { class: "cm-has-balloons" } : ({} as Record<string, string>)));

/** Everything comments add to an editor. */
export const commenting: Extension = [
  field,
  balloons,
  roomForBalloons,
  EditorView.domEventHandlers({
    click(event) {
      const id = (event.target as HTMLElement).closest?.("[data-comment]")?.getAttribute("data-comment");
      if (id) onPick(id);
      return false;
    },
  }),
];
