// Visual mode: draws the same plain source with headings, emphasis, typeset mathematics,
// bullets, tables, figures and citations. What to draw is decided in visualModel.ts; this file
// turns that into decorations.
import {
  type ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  Prec,
  type Range as CmRange,
  StateEffect,
  StateField,
  Transaction,
  findClusterBreak,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType, keymap } from "@codemirror/view";
import { openPdf } from "../../shared/pdf";
import { api } from "../../ipc/api";
import type { ProjectIndex } from "../../ipc/bindings/ProjectIndex";
import { store } from "../../state/store";
import { renderInline, typeset } from "./inlineTex";
import { EditableTable } from "./tableEditor";
import { parseTable } from "./tableModel";
import { type Piece, type Range, type Row, describeCitation, visualPieces } from "./visualModel";
import { formulaAt } from "./equation";
import type { PageChange } from "./trackChanges";
import { latexPath } from "./latexPath";
import { type ListEdit, enterInEmptyItem, indentItem, outdentItem, toggleList } from "./lists";
import { alignmentAt, environments, setAlignment, uncommented } from "./blocks";


/** What a double-click on a formula does: the app opens the equation editor on it. */
let editFormula: () => void = () => {};
export function onEditFormula(edit: () => void) {
  editFormula = edit;
}

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
    el.title = "Double-click to change this formula";
    typeset(el, this.tex, this.display);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  constructor(readonly label = "•") {
    super();
  }
  eq(other: BulletWidget) {
    return other.label === this.label;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.label === "•" ? "cm-v-bullet" : "cm-v-bullet cm-v-number";
    el.textContent = this.label;
    return el;
  }
}

/** A short piece of text drawn in place of some source: a reference's number, a footnote's mark, a block's name. */
class LabelWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly detail: string,
    readonly className: string,
  ) {
    super();
  }
  eq(other: LabelWidget) {
    return other.text === this.text && other.detail === this.detail && other.className === this.className;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.className;
    el.textContent = this.text;
    if (this.detail) el.title = this.detail;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

/** The preamble, folded into one line; clicking it opens it. */
class FoldWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }
  eq(other: FoldWidget) {
    return other.title === this.title;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-v-fold";
    el.title = "The document's settings: its class, the packages it uses, the title. Click to see and change them.";
    el.textContent = this.title ? `Document settings · ${this.title}` : "Document settings";
    el.onmousedown = (e) => {
      e.preventDefault();
      // Inside the settings, not at their edge, so the page view shows them too.
      view.dispatch({ selection: { anchor: Math.min(1, view.state.doc.length) }, scrollIntoView: true });
      view.focus();
    };
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/** What cleveref calls each kind of thing: as \cref writes it, and as \Cref does. */
const NAMES: Record<string, [string, string]> = {
  figure: ["fig.", "Figure"],
  table: ["table", "Table"],
  equation: ["eq.", "Equation"],
  section: ["section", "Section"],
  subsection: ["section", "Section"],
  subsubsection: ["section", "Section"],
  paragraph: ["section", "Section"],
  appendix: ["appendix", "Appendix"],
  chapter: ["chapter", "Chapter"],
  part: ["part", "Part"],
  item: ["item", "Item"],
};

/**
 * What a reference prints, as the last compile numbered it; "?" before the first compile. What a
 * label is on, for the references that name it, comes from the compile when it says (with
 * hyperref) and else from where the label is written (`kinds`).
 */
export function describeReference(command: string, keys: string[], numbers: ProjectIndex["labelNumbers"], kinds: Record<string, string> = {}): { text: string; detail: string } {
  const one = (key: string) => {
    const found = numbers[key];
    if (!found) return "?";
    if (command === "pageref") return found.page;
    if (command === "nameref") return found.title || found.number;
    // The compile's kind where cleveref has a name for it, else what the label is written on.
    const kind = (found.kind && NAMES[found.kind.toLowerCase()] ? found.kind : kinds[key] || found.kind || "").toLowerCase();
    const number = kind === "equation" && command !== "autoref" ? `(${found.number})` : found.number;
    if (command === "eqref") return `(${found.number})`;
    if (command === "cref" || command === "Cref" || command === "vref") {
      const name = NAMES[kind]?.[command === "Cref" ? 1 : 0];
      return name ? `${name} ${number}` : found.number;
    }
    if (command === "autoref" && kind) return `${kind[0].toUpperCase()}${kind.slice(1)} ${found.number}`;
    return found.number;
  };
  const text = keys.map(one).join(", ");
  const unknown = keys.filter((k) => !numbers[k]);
  const detail = unknown.length
    ? `Refers to ${keys.join(", ")}. ${Object.keys(numbers).length ? `No label called ${unknown.join(", ")} was numbered in the last compile.` : "Numbered when the document is compiled."}`
    : `Refers to ${keys.join(", ")}`;
  return { text, detail };
}

/** A table that is drawn but not edited in place, because it could not be written back exactly. */
class TableWidget extends WidgetType {
  constructor(
    readonly rows: Row[],
    readonly reason: string,
  ) {
    super();
  }
  eq(other: TableWidget) {
    return other.reason === this.reason && JSON.stringify(other.rows) === JSON.stringify(this.rows);
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-v-table";
    const note = wrap.appendChild(document.createElement("div"));
    note.className = "cm-v-tnote";
    note.append(`${this.reason}, so this table is shown as it will look but is changed in its source. `);
    const link = note.appendChild(document.createElement("button"));
    link.type = "button";
    link.textContent = "Edit source";
    link.onclick = () => {
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) + 1 } });
      view.focus();
    };
    const table = wrap.appendChild(document.createElement("table"));
    for (const row of this.rows) {
      const tr = table.appendChild(document.createElement("tr"));
      if (row.ruleAbove) tr.classList.add("rule-above");
      if (row.ruleBelow) tr.classList.add("rule-below");
      for (const cell of row.cells) {
        const td = tr.appendChild(document.createElement("td"));
        if (cell.span > 1) td.colSpan = cell.span;
        renderInline(td, cell.tex);
      }
    }
    return wrap;
  }
  ignoreEvent(event: Event) {
    return Boolean((event.target as HTMLElement | null)?.closest?.("button"));
  }
}

/** Pictures already fetched, as addresses an <img> can show; null when there is none to show. */
const pictures = new Map<string, Promise<string | null>>();
let picturesVersion = 0;

function startsWith(bytes: Uint8Array, ...codes: number[]) {
  return codes.every((code, i) => bytes[i] === code);
}

async function pictureUrl(path: string): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await api.projectImage(path));
  } catch {
    return null;
  }
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46)) {
    // A PDF figure: draw its first page.
    const task = await openPdf(bytes);
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 900 / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    } finally {
      void task.destroy();
    }
  }
  const type = startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)
    ? "image/png"
    : startsWith(bytes, 0xff, 0xd8)
      ? "image/jpeg"
      : startsWith(bytes, 0x47, 0x49, 0x46)
        ? "image/gif"
        : startsWith(bytes, 0x52, 0x49, 0x46, 0x46)
          ? "image/webp"
          : null;
  return type ? URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type })) : null;
}

class ImageWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly version: number,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.path === this.path && other.version === this.version;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-v-figure";
    el.title = this.path;
    el.textContent = this.path;
    let wanted = pictures.get(this.path);
    if (!wanted) pictures.set(this.path, (wanted = pictureUrl(this.path)));
    void wanted.then((url) => {
      if (!url) return el.classList.add("cm-v-figure-missing");
      const img = document.createElement("img");
      img.alt = this.path;
      img.onload = () => view.requestMeasure();
      img.src = url;
      el.replaceChildren(img);
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class CiteWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly detail: string,
    readonly unknown: boolean,
  ) {
    super();
  }
  eq(other: CiteWidget) {
    return other.label === this.label && other.detail === this.detail && other.unknown === this.unknown;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.unknown ? "cm-v-cite cm-v-cite-unknown" : "cm-v-cite";
    el.textContent = this.label;
    el.title = this.detail;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

/** Hidden command text shown faintly in place, as LaTeX marks show it: `\textbf{` and its `}`. */
class MarkWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: MarkWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-v-mark";
    el.textContent = this.text;
    return el;
  }
}

/**
 * LaTeX marks, as Word's ¶ shows formatting marks: the commands around formatted text drawn
 * faintly in place, and the names of the environments whose lines are hidden in the margin. The
 * page stays drawn and is edited as before. One setting for every open file.
 */
let marksOn = false;
export function setLatexMarks(on: boolean) {
  marksOn = on;
}
/** What Ctrl+Shift+8 does: the app switches the marks and draws every file again. */
let toggleMarks: () => void = () => {};
export function onToggleMarks(toggle: () => void) {
  toggleMarks = toggle;
}

const bullet = Decoration.replace({ widget: new BulletWidget() });

/** Why each table source cannot be edited, or null when it can, remembered: reading a table back is the dearest part of a redraw. */
const tableReadings = new Map<string, string | null>();
function readingOf(source: string): string | null {
  let reading = tableReadings.get(source);
  if (reading === undefined) {
    const parsed = parseTable(source);
    reading = parsed.ok ? null : parsed.reason;
    if (tableReadings.size > 500) tableReadings.clear();
    tableReadings.set(source, reading);
  }
  return reading;
}

/** What visual mode has drawn, and what it needs to know to tell when to draw again. */
interface Drawn {
  deco: DecorationSet;
  /** What covers source text (hidden command text and drawings): the cursor steps over it whole. */
  covers: DecorationSet;
  /** The selection made something show as source when this was drawn. */
  touched: boolean;
  /** The text has changed since, and this was only moved along with it. */
  stale: boolean;
}

/**
 * The page view: the document stays drawn while the cursor moves through it, as in a word
 * processor. Without it (the draft view), whatever the cursor touches shows as source.
 */
const pageLook = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

/** Show a stretch as source (Ctrl+/), or stop showing it (null). */
const setReveal = StateEffect.define<Range | null>();

/** The stretch shown as source on request, if any: it lasts until the cursor leaves it. */
const revealed = StateField.define<Range | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setReveal)) return e.value;
    if (!value) return value;
    const mapped = tr.docChanged ? { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) } : value;
    const head = tr.state.selection.main.head;
    return head < mapped.from || head > mapped.to ? null : mapped;
  },
});

/** Pieces that cover source with something else, which the cursor cannot be put inside by hand. */
const COVERS = new Set<Piece["kind"]>(["hide", "math", "table", "image", "cite", "bullet", "ref", "footnote", "block", "fold"]);

/**
 * What the page view shows as source: what was asked for with Ctrl+/, and anything the cursor has
 * been put strictly inside of, which only going to a place does (a line, an error, a search
 * result), never a click or the arrow keys.
 */
function pagePieces(state: EditorState, text: string, report: { touched: boolean }): Piece[] {
  const asked = state.field(revealed, false);
  const shown: Range[] = asked ? [asked] : [];
  const pieces = visualPieces(text, shown, report);
  const points = state.selection.ranges.flatMap((r) => (r.empty ? [r.head] : [r.anchor, r.head]));
  const inside = points.filter((at) => pieces.some((p) => COVERS.has(p.kind) && "to" in p && p.from < at && at < p.to));
  if (!inside.length) return pieces;
  report.touched = true;
  return visualPieces(text, [...shown, ...inside.map((at) => ({ from: at, to: at }))], report);
}

function build(state: EditorState): Drawn {
  const text = state.doc.toString();
  // Very large files stay in plain source: redrawing them on every keystroke would lag.
  if (text.length > 400_000) return { deco: Decoration.none, covers: Decoration.none, touched: false, stale: false };
  const out: CmRange<Decoration>[] = [];
  const index = store().index;
  /** What each label is on, read once a drawing, when a reference needs it. */
  let kinds: Record<string, string> | undefined;
  const report = { touched: false };
  const page = state.facet(pageLook);
  const marks = page && marksOn;
  const pieces = page ? pagePieces(state, text, report) : visualPieces(text, state.selection.ranges.map((r) => ({ from: r.from, to: r.to })), report);
  // A line just after a hidden whole line, such as a list's \begin line, is drawn as part of the
  // line the hidden one starts: its style goes there, or it would be lost.
  const joined = new Map<number, number>();
  for (const p of pieces) if (p.kind === "hide" && text[p.to - 1] === "\n") joined.set(p.to, p.from);
  const lineStartOf = (at: number) => {
    for (let n = 0; joined.has(at) && n < 50; n++) at = joined.get(at)!;
    return at;
  };
  for (const p of pieces) {
    if (p.kind === "line") {
      const lineClass = p.style.split(" ").map((s) => `cm-v-line-${s}`).join(" ");
      out.push(Decoration.line({ class: lineClass, ...(p.env ? { attributes: { "data-env": p.env } } : {}) }).range(lineStartOf(p.from)));
    } else if (p.kind === "hide") {
      // With LaTeX marks on, a command's hidden text is shown faintly; a whole hidden line stays hidden.
      const shown = marks && !text.slice(p.from, p.to).endsWith("\n");
      out.push(Decoration.replace({ group: p.group, ...(shown ? { widget: new MarkWidget(text.slice(p.from, p.to)) } : {}) }).range(p.from, p.to));
    }
    else if (p.kind === "bullet") out.push((p.label === undefined ? bullet : Decoration.replace({ widget: new BulletWidget(p.label) })).range(p.from, p.to));
    else if (p.kind === "ref") {
      kinds ??= Object.fromEntries(index.labelPlaces.map((l) => [l.key, l.kind]));
      const { text, detail } = describeReference(p.command, p.keys, index.labelNumbers, kinds);
      out.push(Decoration.replace({ widget: new LabelWidget(text, detail, "cm-v-ref") }).range(p.from, p.to));
    } else if (p.kind === "footnote") {
      out.push(Decoration.replace({ widget: new LabelWidget(String(p.number), `Footnote: ${p.text}`, "cm-v-footnote") }).range(p.from, p.to));
    } else if (p.kind === "block") {
      out.push(Decoration.replace({ widget: new LabelWidget(p.label, "", "cm-v-block") }).range(p.from, p.to));
    } else if (p.kind === "fold") {
      out.push(Decoration.replace({ widget: new FoldWidget(p.title), block: true }).range(p.from, p.to));
    }
    else if (p.kind === "style") out.push(Decoration.mark({ class: `cm-v-${p.style}` }).range(p.from, p.to));
    else if (p.kind === "table") {
      const reason = readingOf(p.source);
      const widget = reason === null ? new EditableTable(p.source) : new TableWidget(p.rows, reason);
      out.push(Decoration.replace({ widget }).range(p.from, p.to));
    }
    else if (p.kind === "image") out.push(Decoration.replace({ widget: new ImageWidget(p.path, picturesVersion) }).range(p.from, p.to));
    else if (p.kind === "cite") {
      const { label, detail, unknown } = describeCitation(p.keys, index);
      out.push(Decoration.replace({ widget: new CiteWidget(label, detail, unknown) }).range(p.from, p.to));
    } else out.push(Decoration.replace({ widget: new MathWidget(p.tex, p.display) }).range(p.from, p.to));
  }
  const covers = out.filter((r) => r.value.spec.widget !== undefined || typeof r.value.spec.group === "number");
  return { deco: Decoration.set(out, true), covers: Decoration.set(covers, true), touched: report.touched, stale: false };
}

/** Whether a change reaches anything drawn: then it must be drawn again at once. */
function reaches(deco: DecorationSet, changes: ChangeSet): boolean {
  let hit = false;
  changes.iterChangedRanges((from, to) => {
    if (!hit) deco.between(from, to, () => ((hit = true), false));
  });
  return hit;
}

/**
 * Whether the selection touches anything drawn, which would then show as source. In the page
 * view only an end of the selection strictly inside something hidden or drawn does.
 */
function touches(deco: DecorationSet, selection: EditorSelection, page: boolean): boolean {
  let hit = false;
  for (const r of selection.ranges) {
    if (page) {
      for (const at of [r.anchor, r.head]) deco.between(at, at, (from, to, d) => (from < at && at < to && !d.spec.class ? ((hit = true), false) : undefined));
    } else {
      // Line styles do not give way to the cursor; only what covers some text does.
      deco.between(r.from, r.to, (from, to) => (from < to ? ((hit = true), false) : undefined));
    }
    if (hit) break;
  }
  return hit;
}

/** Redraw: something outside the text changed, such as the references or a picture file. */
export const redrawVisual = StateEffect.define<null>();

/** Forget the pictures fetched so far, so that changed files are read again. */
export function forgetPictures() {
  for (const wanted of pictures.values()) void wanted.then((url) => url?.startsWith("blob:") && URL.revokeObjectURL(url));
  pictures.clear();
  picturesVersion++;
}

// Kept in editor state rather than a view plugin, because a formula or a table that spans
// several lines replaces line breaks, which only state-provided decorations may do.
const drawing = StateField.define<Drawn>({
  create: build,
  update(value, tr) {
    if (tr.effects.some((e) => e.is(redrawVisual))) return build(tr.state);
    if (tr.docChanged) {
      // Typing in plain text moves what is drawn along with it, and it is drawn again once
      // typing pauses: drawing a long document takes longer than a keystroke should. A change
      // that reaches anything drawn, or one made other than by typing, is drawn at once.
      const typing = tr.isUserEvent("input.type") || tr.isUserEvent("delete");
      if (typing && !reaches(value.deco, tr.changes)) return { deco: value.deco.map(tr.changes), covers: value.covers.map(tr.changes), touched: value.touched, stale: true };
      return build(tr.state);
    }
    if (tr.startState.field(revealed, false) !== tr.state.field(revealed, false)) return build(tr.state);
    // The cursor moving through plain text, touching nothing before or after, changes nothing.
    if (tr.selection && (value.stale || value.touched || touches(value.deco, tr.state.selection, tr.state.facet(pageLook)))) return build(tr.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (drawn) => drawn.deco),
});

/** Whether what is drawn in `state` is out of date, moved along by typing but not drawn again. */
export function drawingStale(state: EditorState): boolean {
  return state.field(drawing, false)?.stale ?? false;
}

/** How long typing must pause before the document is drawn again. */
const PAUSE = 300;

/** Draws again once typing pauses, when typing has left the drawing only moved along. */
const settle = ViewPlugin.fromClass(
  class {
    timer = 0;
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (!update.docChanged || !update.state.field(drawing).stale) return;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        if (this.view.state.field(drawing, false)?.stale) this.view.dispatch({ effects: redrawVisual.of(null) });
      }, PAUSE);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);

/** Everything visual mode adds to an editor. */
/**
 * As in Word, a formula drawn in visual mode is changed with a double-click, which opens the
 * equation editor on it. A click on it leaves it drawn, rather than showing its source, so the
 * second click of a double-click lands where the first did; the arrow keys, or a click beside
 * it, still reach its LaTeX.
 */
const formulaClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const drawn = event.target instanceof Element ? event.target.closest(".cm-v-math") : null;
    // A formula in a drawn table belongs to the table, which is edited where it is drawn.
    if (!drawn || !view.contentDOM.contains(drawn) || drawn.closest(".cm-v-table, .cm-v-tedit")) return false;
    // Inside the formula, so the editor opens on it; only where there is one.
    const inside = Math.min(view.posAtDOM(drawn) + 1, view.state.doc.length);
    if (!formulaAt(view.state.doc.toString(), inside)) return false;
    event.preventDefault();
    view.focus();
    if (event.detail >= 2) {
      view.dispatch({ selection: { anchor: inside } });
      editFormula();
    }
    return true;
  },
});

export const visualMode: Extension = [revealed, drawing, settle, formulaClicks, EditorView.editorAttributes.of({ class: "cm-visual" })];

// --- The page view's editing ---------------------------------------------------------------

interface Hidden {
  from: number;
  to: number;
  /** Which construct this is part of: the parts of one construct share it. */
  group: number;
}

/** The hidden parts of commands drawn in `state`, in order. */
function hiddenParts(state: EditorState, from = 0, to = state.doc.length): Hidden[] {
  const out: Hidden[] = [];
  state.field(drawing).deco.between(from, to, (f, t, d) => {
    if (typeof d.spec.group === "number") out.push({ from: f, to: t, group: d.spec.group });
  });
  return out;
}

/** The drawing that covers the text just before (`side` -1) or after (1) `at`, if any. */
function widgetBeside(state: EditorState, at: number, side: -1 | 1): { from: number; to: number; whole: boolean; bullet: boolean } | null {
  let found: { from: number; to: number; whole: boolean; bullet: boolean } | null = null;
  state.field(drawing).deco.between(at, at, (f, t, d) => {
    // A command's text shown as a LaTeX mark is part of a construct, not a drawing of its own.
    if (d.spec.widget && typeof d.spec.group !== "number" && (side < 0 ? t === at && f < at : f === at && t > at)) {
      // The settings and a table are too much to lose to one key: the key steps past them.
      const big = d.spec.widget instanceof FoldWidget || d.spec.widget instanceof EditableTable || d.spec.widget instanceof TableWidget;
      found = { from: f, to: t, whole: !big, bullet: d.spec.widget instanceof BulletWidget };
    }
  });
  return found;
}

/** Remove one character, or one drawn thing, on the `side` of the cursor, stepping over hidden command text. */
function pageDeleteBy(view: EditorView, side: -1 | 1): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || !state.field(drawing, false)) return false;
  const parts = hiddenParts(state);
  let at = range.head;
  for (let moved = true; moved; ) {
    moved = false;
    for (const h of parts) {
      if (side < 0 ? h.to === at : h.from === at) {
        at = side < 0 ? h.from : h.to;
        moved = true;
      }
    }
  }
  if (side < 0 ? at === 0 : at === state.doc.length) return true;
  let [from, to] = [at, at];
  const drawn = widgetBeside(state, at, side);
  if (drawn && !drawn.whole) {
    view.dispatch({ selection: { anchor: side < 0 ? drawn.from : drawn.to }, scrollIntoView: true });
    return true;
  }
  if (drawn?.bullet && side < 0) {
    // Backspace after a bullet makes the item a paragraph, as in a word processor, the list kept
    // before and after it; in a list inside another, the item goes up a level.
    applyListEdit(view, outdentItem(state.doc.toString(), drawn.to, true));
    return true;
  }
  if (drawn) [from, to] = [drawn.from, drawn.to];
  else {
    const line = state.doc.lineAt(at);
    if (side < 0) from = at === line.from ? at - 1 : line.from + findClusterBreak(line.text, at - line.from, false);
    else to = at === line.to ? at + 1 : line.from + findClusterBreak(line.text, at - line.from, true);
    // A line break next to a hidden line, such as a list's \begin or \end, stays: taking it would
    // join that line to the text and show it, half a command for the next key to take.
    const wholeLine = (h: Hidden) => (h.from === 0 || state.sliceDoc(h.from - 1, h.from) === "\n") && state.sliceDoc(h.to - 1, h.to) === "\n";
    if (state.sliceDoc(from, to) === "\n" && parts.some((h) => wholeLine(h) && (h.from === to || h.to === from))) return true;
  }
  // What empties a command takes the command with it, rather than leave it empty.
  const before = parts.find((h) => h.to === from);
  const after = before && parts.find((h) => h.from === to && h.group === before.group);
  if (before && after) [from, to] = [before.from, after.to];
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: side < 0 ? "delete.backward" : "delete.forward", scrollIntoView: true });
  return true;
}

export const pageBackspace = (view: EditorView) => pageDeleteBy(view, -1);
export const pageDelete = (view: EditorView) => pageDeleteBy(view, 1);

/** Environments whose text is taken as it is written, where Enter is a plain line break. */
const LITERAL = /^(?:verbatim|Verbatim|BVerbatim|lstlisting|minted|alltt|comment)\*?$/;

/** Whether `before`, text on a line up to the cursor, leaves a brace open. */
function braceOpen(before: string): boolean {
  let depth = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === "\\") i++;
    else if (before[i] === "{") depth++;
    else if (before[i] === "}") depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

/** Lines of commands that are not text, where Enter goes in as it does in the source. */
const NOT_PROSE = /^\\(?:begin|end|label|centering|caption|includegraphics|hline|toprule|midrule|bottomrule|maketitle|tableofcontents)\b/;

/**
 * Enter as a word processor has it: a new paragraph (a blank line, in LaTeX), the next item in a
 * list, and below a heading when at its end. Elsewhere, and in source being shown, as usual.
 */
export function pageEnter(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const drawn = state.field(drawing, false);
  if (!range.empty || !drawn || drawn.touched || state.field(revealed, false)) return false;
  const at = range.head;
  const line = state.doc.lineAt(at);
  const go = (pos: number, insert: string) =>
    view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: "input", scrollIntoView: true });
  let heading = false;
  drawn.deco.between(line.from, line.from, (_f, _t, d) => {
    if (/cm-v-line-(?:h\d|title)/.test(d.spec.class ?? "")) heading = true;
  });
  if (heading) {
    const closing = hiddenParts(state, at, at).find((h) => h.from === at);
    if (closing && !state.sliceDoc(closing.to, line.to).trim()) {
      go(line.to, "\n");
      return true;
    }
    return false;
  }
  // Inside a command's argument, or in text taken as written, a blank line would end it early.
  if (braceOpen(line.text.slice(0, at - line.from)) || latexPath(state.doc.toString(), at).some((p) => LITERAL.test(p))) return false;
  // Enter on an empty item ends the list, as in a word processor.
  const ended = enterInEmptyItem(state.doc.toString(), at);
  if (ended) return applyListEdit(view, ended);
  const item = /^(\s*)\\item\b/.exec(line.text);
  if (item) {
    go(at, `\n${item[1]}\\item `);
    return true;
  }
  if (!line.text.trim() || NOT_PROSE.test(line.text.trim())) return false;
  go(at, "\n\n");
  return true;
}

/** Make a list tool's change, the cursor where the tool puts it or kept in its words. True when there was one. */
export function applyListEdit(view: EditorView, edit: ListEdit | null): boolean {
  if (!edit) return false;
  if (edit.changes.length) {
    view.dispatch({
      changes: edit.changes,
      ...(edit.cursor !== undefined ? { selection: { anchor: edit.cursor } } : {}),
      userEvent: "input.list",
      scrollIntoView: true,
    });
  }
  return true;
}

/** Tab in a list item of the page view: the item goes one level down. Elsewhere, Tab as usual. */
export function pageTab(view: EditorView): boolean {
  const { state } = view;
  if (!state.selection.main.empty || state.field(revealed, false)) return false;
  return applyListEdit(view, indentItem(state.doc.toString(), state.selection.main.head));
}

/** Shift+Tab in a list item of the page view: the item goes one level up. */
export function pageShiftTab(view: EditorView): boolean {
  const { state } = view;
  if (!state.selection.main.empty || state.field(revealed, false)) return false;
  return applyListEdit(view, outdentItem(state.doc.toString(), state.selection.main.head));
}

/** Ctrl+/: show the paragraph the cursor is in as its LaTeX, or draw it again. */
export function toggleReveal(view: EditorView): boolean {
  const { state } = view;
  if (state.field(revealed, false)) {
    view.dispatch({ effects: setReveal.of(null) });
    return true;
  }
  const head = state.selection.main.head;
  let first = state.doc.lineAt(head);
  let last = first;
  while (first.number > 1 && state.doc.line(first.number - 1).text.trim()) first = state.doc.line(first.number - 1);
  while (last.number < state.doc.lines && state.doc.line(last.number + 1).text.trim()) last = state.doc.line(last.number + 1);
  view.dispatch({ effects: setReveal.of({ from: first.from, to: last.to }) });
  return true;
}

/** Stop showing what Ctrl+/ showed. */
function hideReveal(view: EditorView): boolean {
  if (!view.state.field(revealed, false)) return false;
  view.dispatch({ effects: setReveal.of(null) });
  return true;
}

/** Edits made by typing, pasting, dropping or deleting. */
const USER_EDITS = ["input.type", "input.paste", "input.drop", "delete", "move.drop"];

/**
 * An edit by typing, pasting, dropping or deleting that would take only part of a construct's
 * hidden text leaves that text in place, and so do the document's settings and its
 * \end{document}: the rest of the edit goes ahead, and what was typed or pasted goes in just after
 * what was kept, so that nothing written is lost and no command is left broken.
 */
const keepConstructs = EditorState.transactionFilter.of((tr) => {
  const drawn = tr.startState.field(drawing, false);
  if (!tr.docChanged || !drawn || !USER_EDITS.some((e) => tr.isUserEvent(e))) return tr;
  const start = tr.startState;
  let parts: Hidden[] | null = null;
  // A construct with only one part hidden (a list whose other end shares its line with text)
  // has no span the edit can be seen to take whole, so that part is always kept.
  const span = (group: number) => {
    const mine = (parts ??= hiddenParts(start)).filter((h) => h.group === group);
    return mine.length < 2 ? null : { from: mine[0].from, to: mine[mine.length - 1].to };
  };
  let end: Range | null | undefined;
  const kept: Range[] = [];
  tr.changes.iterChangedRanges((fromA, toA) => {
    drawn.deco.between(fromA, toA, (f, t, d) => {
      const group = typeof d.spec.group === "number";
      const fold = d.spec.widget instanceof FoldWidget;
      if (!group && !fold) return;
      if (Math.min(t, toA) <= Math.max(f, fromA) && !(fold && fromA === f)) return;
      if (group) {
        const whole = span(d.spec.group);
        if (whole && fromA <= whole.from && toA >= whole.to) return;
      }
      kept.push({ from: f, to: t });
      // A list that is kept keeps its first item too: a list without an \item does not compile.
      if (group && toA > t && /\\begin\{(?:itemize|enumerate|description)\}/.test(start.sliceDoc(f, t))) {
        let first: Range | null = null;
        drawn.deco.between(t, toA, (bf, bt, bd) => {
          if (!first && bf >= t && bf < toA && bd.spec.widget instanceof BulletWidget) first = { from: bf, to: bt };
        });
        if (first) kept.push(first);
      }
    });
    if (toA > fromA) {
      if (end === undefined) {
        const at = start.doc.toString().lastIndexOf("\\end{document}");
        end = at < 0 ? null : { from: at, to: at + "\\end{document}".length };
      }
      if (end && fromA < end.to && toA > end.from) kept.push(end);
    }
  });
  if (!kept.length) return tr;
  kept.sort((a, b) => a.from - b.from);
  const changes: { from: number; to?: number; insert?: string }[] = [];
  /** Where each change's text went in and how long it is, in the order of the changes. */
  const carets: { at: number; length: number }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    let at = -1;
    let pos = fromA;
    for (const k of kept) {
      if (k.to <= pos || k.from >= toA) continue;
      if (k.from > pos) {
        changes.push({ from: pos, to: k.from });
        if (at < 0) at = pos;
      }
      pos = Math.max(pos, k.to);
    }
    if (pos < toA) {
      changes.push({ from: pos, to: toA });
      if (at < 0) at = pos;
    }
    if (at < 0) at = fromA;
    for (const k of kept) if (k.from <= at && at < k.to) at = k.to;
    if (inserted.length) changes.push({ from: at, insert: inserted.toString() });
    carets.push({ at, length: inserted.length });
  });
  const set = start.changes(changes);
  // Each cursor just after what went in at it, as a cursor: a range that held part of a command
  // would otherwise stay selected, and the next key would type over this one. The start of what
  // went in is mapped, then its length added, since a deletion beginning at the same place would
  // otherwise leave the cursor before the new text and the next key would go in ahead of it.
  const after = (c: { at: number; length: number }) => set.mapPos(c.at, -1) + c.length;
  const ranges = start.selection.ranges;
  return {
    changes: set,
    selection:
      ranges.length > 1 && carets.length === ranges.length
        ? EditorSelection.create(carets.map((c) => EditorSelection.cursor(after(c))), start.selection.mainIndex)
        : ranges.length > 1
          ? EditorSelection.create(ranges.map((r) => EditorSelection.cursor(set.mapPos(r.to, 1))), start.selection.mainIndex)
          : { anchor: after(carets[carets.length - 1]) },
    effects: tr.effects,
    userEvent: tr.annotation(Transaction.userEvent),
    scrollIntoView: true,
  };
});

/**
 * Text copied, cut or dragged from the page view carries whole commands: what the selection cuts
 * across is closed or opened again, as a word processor copies formatting with the words.
 */
const wholeOnCopy = EditorView.clipboardOutputFilter.of((text, state) => {
  const range = state.selection.main;
  if (!state.field(drawing, false) || state.selection.ranges.length !== 1 || state.sliceDoc(range.from, range.to) !== text) return text;
  const groups = new Map<number, Hidden[]>();
  for (const h of hiddenParts(state)) groups.set(h.group, [...(groups.get(h.group) ?? []), h]);
  const inside = (h: Hidden) => h.from >= range.from && h.to <= range.to;
  const opened: Hidden[][] = [];
  const closed: Hidden[][] = [];
  for (const parts of groups.values()) {
    if (parts.length < 2) continue;
    const [first, last] = [parts[0], parts[parts.length - 1]];
    if (inside(first) && !inside(last)) opened.push(parts);
    else if (inside(last) && !inside(first)) closed.push(parts);
  }
  // The innermost is closed first, and the outermost opened first.
  const after = opened.sort((a, b) => b[0].from - a[0].from).map((p) => state.sliceDoc(p[p.length - 1].from, p[p.length - 1].to));
  const before = closed.sort((a, b) => b[b.length - 1].from - a[a.length - 1].from).map((p) => state.sliceDoc(p[0].from, p[0].to));
  // A list opened again must start with an item, or it will not compile.
  const item = before.length && /\\begin\{(?:itemize|enumerate|description)\}\s*$/.test(before[before.length - 1]) && !/^\s*\\item\b/.test(text) ? "\\item " : "";
  return before.join("") + item + text + after.join("");
});

/**
 * In the page view the cursor never rests at the start of the folded settings, where whatever
 * went in would go before \\documentclass. Moved there by the user (Ctrl+Home, a click), it goes
 * just past them, into the document; sent there (going to line 1, to an error on it), it goes
 * just inside them, which shows them, as going inside anything drawn does.
 */
const pastSettings = EditorState.transactionFilter.of((tr) => {
  const range = tr.newSelection.main;
  if (!tr.selection || !range.empty || range.head !== 0 || tr.newSelection.ranges.length > 1) return tr;
  const drawn = tr.startState.field(drawing, false);
  let end = -1;
  drawn?.deco.between(0, 0, (f, t, d) => {
    if (f === 0 && d.spec.widget instanceof FoldWidget) end = t;
  });
  if (end < 0) return tr;
  const anchor = tr.isUserEvent("select") || tr.docChanged ? tr.changes.mapPos(end, 1) : Math.min(1, tr.newDoc.length);
  return [tr, { selection: { anchor }, sequential: true }];
});

// --- Pages: where the last compile broke them, and their header and footer ------------------

/** Where the last compile began each page of a file, and what is printed at the top and foot of each. */
export interface PageLayout {
  /**
   * Each page with the file's text on it and the line it begins with, the first being the page
   * the file starts on; null to keep the breaks there are, followed through the edits since.
   */
  breaks: { page: number; line: number }[] | null;
  /** The header's and the footer's text, as LaTeX; "" for none. */
  header: string;
  footer: string;
  /** Page numbers at the foot. */
  numbers: boolean;
}

/** Give a file the pages of the last compile. */
export const setPageBreaks = StateEffect.define<PageLayout>();

interface Pages {
  /** The page the file starts on. */
  first: number;
  /** Each break at the start of the line its page begins with, followed through edits since. */
  marks: { page: number; at: number }[];
  header: string;
  footer: string;
  numbers: boolean;
}

/** Environments never split by a drawn break: it goes before them, where they begin. */
const UNSPLIT = /^(?:figure|table|equation|align|gather|multline|flalign|alignat|eqnarray|displaymath|math|tabular|tabularx|longtable|verbatim|lstlisting|minted)\*?$/;

/** A header or footer's LaTeX as it prints, for the page view. */
function printed(latex: string): string {
  return latex
    .replace(/\\(?:[&%$#_{}])/g, (e) => e.slice(1))
    .replace(/\\textasciitilde\{\}/g, "~")
    .replace(/\\textasciicircum\{\}/g, "^")
    .replace(/\\textbackslash\{\}/g, "\\")
    .replace(/\\(?:thepage|today)(?![a-zA-Z])\s*/g, "")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?|[{}]/g, "")
    .trim();
}

/**
 * The gap between two pages, where the last compile ended one and began the next: the foot of
 * the one, with its footer and page number, the gap, and the top of the next, with its header.
 * At the top of the first page only the header is drawn, and at the foot of the last only the
 * footer.
 */
class PageBreakWidget extends WidgetType {
  constructor(
    /** The page that begins after it. */
    readonly page: number,
    /** The page whose foot is drawn above it. */
    readonly foot: number,
    readonly header: string,
    readonly footer: string,
    readonly numbers: boolean,
    readonly where: "between" | "top" | "end",
  ) {
    super();
  }
  eq(other: PageBreakWidget) {
    return other.page === this.page && other.foot === this.foot && other.header === this.header && other.footer === this.footer && other.numbers === this.numbers && other.where === this.where;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = this.where === "between" ? "cm-v-pagebreak" : this.where === "top" ? "cm-v-pagetop" : "cm-v-pageend";
    el.contentEditable = "false";
    const part = (className: string, ...texts: string[]) => {
      const div = el.appendChild(document.createElement("div"));
      div.className = className;
      for (const t of texts.filter(Boolean)) div.appendChild(document.createElement("span")).textContent = t;
      return div;
    };
    // The footer's text in the middle and the page number on its right, or the number alone in the middle, as fancyhdr sets them.
    const foot = () => {
      const div = part("cm-v-pb-foot", printed(this.footer), this.numbers ? String(this.foot) : "");
      if (div.children.length === 2) div.lastElementChild!.className = "cm-v-pb-right";
    };
    if (this.where !== "top") foot();
    if (this.where === "between") {
      el.setAttribute("role", "separator");
      el.setAttribute("aria-label", `Page ${this.page}`);
      part("cm-v-pb-gap", `Page ${this.page}`, "where the last compile began it");
    }
    if (this.where !== "end") part("cm-v-pb-head", printed(this.header));
    return el;
  }
  get estimatedHeight() {
    return this.where === "between" ? 90 : 24;
  }
}

const pagesField = StateField.define<Pages>({
  create: () => ({ first: 1, marks: [], header: "", footer: "", numbers: false }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(setPageBreaks)) continue;
      const furniture = { header: e.value.header, footer: e.value.footer, numbers: e.value.numbers };
      if (!e.value.breaks) return { ...mapPages(value, tr), ...furniture };
      const { doc } = tr.state;
      const text = doc.toString();
      const envs = environments(text);
      // Formulas set with \[ \] and $$ $$ are not environments, but are not split either.
      // Not the \[ of a line break with spacing, \\[2pt], nor one in a comment.
      const displays = [...uncommented(text).matchAll(/(?<!\\)\\\[[\s\S]*?(?<!\\)\\\]|(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$/g)].map((m) => ({ name: "math", begin: m.index, tail: m.index + m[0].length }));
      const marks: Pages["marks"] = [];
      for (const b of e.value.breaks.slice(1)) {
        if (b.line < 2 || b.line > doc.lines) continue;
        let at = doc.line(b.line).from;
        // Inside a figure, a table or a formula, the break goes before it.
        for (const env of [...envs, ...displays]) if (UNSPLIT.test(env.name) && env.begin < at && at < env.tail) at = Math.min(at, doc.lineAt(env.begin).from);
        if (at > 0 && !marks.some((m) => m.at >= at)) marks.push({ page: b.page, at });
      }
      return { first: e.value.breaks[0]?.page ?? 1, marks, ...furniture };
    }
    return mapPages(value, tr);
  },
});

/** The breaks followed through an edit, each kept at the start of a line: a break is between lines. */
function mapPages(value: Pages, tr: Transaction): Pages {
  if (!tr.docChanged || !value.marks.length) return value;
  const marks: Pages["marks"] = [];
  for (const m of value.marks) {
    const at = tr.state.doc.lineAt(tr.changes.mapPos(m.at, -1)).from;
    if (at > 0 && !marks.some((n) => n.at >= at)) marks.push({ page: m.page, at });
  }
  return { ...value, marks };
}

/** The pages a file has, for tests: where each break is drawn. */
export const pagesState = pagesField;

/** What the pages draw, in the page view only; drawn again with every change, since the last page's foot is at the end of the text. */
const pagesDrawn = EditorView.decorations.compute([pagesField, pageLook, "doc"], (state) => {
  if (!state.facet(pageLook)) return Decoration.none;
  const { first, marks, header, footer, numbers } = state.field(pagesField);
  const out: CmRange<Decoration>[] = [];
  if (header) out.push(Decoration.widget({ widget: new PageBreakWidget(first, first, header, footer, numbers, "top"), block: true, side: -1 }).range(0));
  marks.forEach((m, i) => {
    const foot = i === 0 ? first : marks[i - 1].page;
    out.push(Decoration.widget({ widget: new PageBreakWidget(m.page, foot, header, footer, numbers, "between"), block: true, side: -1 }).range(m.at));
  });
  const last = marks.length ? marks[marks.length - 1].page : first;
  if (footer || numbers) out.push(Decoration.widget({ widget: new PageBreakWidget(last, last, header, footer, numbers, "end"), block: true, side: 1 }).range(state.doc.length));
  return Decoration.set(out, true);
});

// --- Changes since a snapshot, drawn on the page --------------------------------------------

/** Show the changes since a snapshot (`since` names it), or stop showing them (null). */
export const showChanges = StateEffect.define<{ since: string; changes: PageChange[] } | null>();
/** Take one change, by its place in the list, off the page. */
const dropChange = StateEffect.define<number>();

interface Shown {
  since: string;
  changes: PageChange[];
}

/** Something taken out, struck through where it stood. */
class DeletedWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly who: string,
  ) {
    super();
  }
  eq(other: DeletedWidget) {
    return other.text === this.text && other.who === this.who;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-v-del cm-v-${this.who}`;
    el.textContent = this.text.replace(/\n(?=.)/g, " ↵ ").replace(/\n$/, " ↵");
    el.title = "Taken out since the snapshot";
    return el;
  }
}

const changesField = StateField.define<Shown | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(showChanges)) value = e.value && { ...e.value, changes: e.value.changes.filter((c) => c.to <= tr.state.doc.length) };
    if (value && tr.docChanged) {
      const map = (at: number, side: -1 | 1) => tr.changes.mapPos(at, side);
      value = {
        ...value,
        changes: value.changes.map((c) => ({
          ...c,
          // Text typed at either edge stays outside the change, so undoing it never takes that text.
          from: map(c.from, c.from === c.to ? -1 : 1),
          to: map(c.to, -1),
          inserted: c.inserted.map((r) => ({ from: map(r.from, 1), to: map(r.to, -1) })).filter((r) => r.to > r.from),
          deleted: c.deleted.map((d) => ({ ...d, at: map(d.at, -1) })),
        })),
      };
    }
    for (const e of tr.effects) if (e.is(dropChange) && value) value = { ...value, changes: value.changes.filter((_c, i) => i !== e.value) };
    return value;
  },
});

/** The changes, drawn in the page view only. */
const changesDrawn = EditorView.decorations.compute([changesField, pageLook], (state) => {
  const shown = state.field(changesField);
  if (!shown || !state.facet(pageLook)) return Decoration.none;
  const out: CmRange<Decoration>[] = [];
  for (const c of shown.changes) {
    // A bar beside each line changed, as Word draws one in the margin.
    for (let at = state.doc.lineAt(c.from).from; at <= Math.min(c.to, state.doc.length); ) {
      const line = state.doc.lineAt(at);
      if (line.from < c.to || line.from === c.from) out.push(Decoration.line({ class: `cm-v-changed cm-v-${c.who}` }).range(line.from));
      at = line.to + 1;
      if (line.to >= c.to) break;
    }
    for (const r of c.inserted) out.push(Decoration.mark({ class: `cm-v-ins cm-v-${c.who}` }).range(r.from, r.to));
    for (const d of c.deleted) out.push(Decoration.widget({ widget: new DeletedWidget(d.text, c.who), side: -1 }).range(d.at));
  }
  return Decoration.set(out, true);
});

/** The change the cursor is in, or the first after it; its place in the list, or -1. */
function changeHere(state: EditorState): number {
  const shown = state.field(changesField, false);
  if (!shown) return -1;
  const head = state.selection.main.head;
  const inside = shown.changes.findIndex((c) => c.from <= head && head <= c.to);
  return inside >= 0 ? inside : shown.changes.findIndex((c) => c.from > head);
}

/** Keep the change at the cursor: its marks go, the text stays as it is. */
export function keepChange(view: EditorView): boolean {
  const i = changeHere(view.state);
  if (i < 0) return false;
  view.dispatch({ effects: dropChange.of(i) });
  return true;
}

/** Undo the change at the cursor: its lines go back to what the snapshot had. */
export function undoChange(view: EditorView): boolean {
  const i = changeHere(view.state);
  if (i < 0) return false;
  const c = view.state.field(changesField)!.changes[i];
  view.dispatch({ changes: { from: c.from, to: c.to, insert: c.old }, effects: dropChange.of(i), selection: { anchor: c.from }, userEvent: "input", scrollIntoView: true });
  return true;
}

/** Go to the next change after the cursor, or the first. */
export function nextChange(view: EditorView): boolean {
  const shown = view.state.field(changesField, false);
  if (!shown?.changes.length) return false;
  const head = view.state.selection.main.head;
  const next = shown.changes.find((c) => c.from > head) ?? shown.changes[0];
  view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true });
  return true;
}

/** The snapshot whose changes are shown, and how many are left; null when none are shown. */
export function changesShown(state: EditorState): { since: string; count: number } | null {
  const shown = state.field(changesField, false);
  return shown ? { since: shown.since, count: shown.changes.length } : null;
}

/**
 * The pages of the last compile, kept in every file's state whichever way it is shown, so that
 * the breaks follow the edits made in the draft view or the source too. Drawn in the page view.
 */
export const pageFurniture: Extension = [pagesField, pagesDrawn, changesField, changesDrawn];

/** The page view: visual mode that stays drawn under the cursor, and is edited as a word processor is. */
export const visualPage: Extension = [
  pageLook.of(true),
  visualMode,
  keepConstructs,
  pastSettings,
  wholeOnCopy,
  EditorView.atomicRanges.of((view) => view.state.field(drawing).covers),
  EditorView.editorAttributes.of({ class: "cm-page" }),
  EditorView.editorAttributes.of(() => (marksOn ? { class: "cm-marks" } : null)),
  Prec.high(
    keymap.of([
      { key: "Backspace", run: pageBackspace },
      { key: "Delete", run: pageDelete },
      { key: "Enter", run: pageEnter },
      { key: "Mod-/", run: toggleReveal },
      { key: "Escape", run: hideReveal },
      { key: "Tab", run: pageTab, shift: pageShiftTab },
      // Word's keys for bullets and for centring, which a second time takes the centring away.
      { key: "Mod-Shift-l", run: (v) => (applyListEdit(v, toggleList(v.state.doc.toString(), v.state.selection.main.from, v.state.selection.main.to, "itemize")), true) },
      {
        key: "Mod-e",
        run: (v) => {
          const { from, to } = v.state.selection.main;
          const text = v.state.doc.toString();
          const changes = setAlignment(text, from, to, alignmentAt(text, from) === "center" ? "justify" : "center");
          if (changes) v.dispatch({ changes, userEvent: "input", scrollIntoView: true });
          return true;
        },
      },
      // As Word's Ctrl+Shift+8 shows formatting marks.
      { key: "Mod-*", run: () => (toggleMarks(), true) },
      { key: "Mod-Shift-8", run: () => (toggleMarks(), true) },
    ]),
  ),
];

