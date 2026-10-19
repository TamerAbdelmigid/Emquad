// Visual mode: draws the same plain source with headings, emphasis, typeset mathematics,
// bullets, tables, figures and citations. What to draw is decided in visualModel.ts; this file
// turns that into decorations.
import {
  type ChangeSet,
  type EditorSelection,
  EditorState,
  type Extension,
  Facet,
  Prec,
  type Range as CmRange,
  StateEffect,
  StateField,
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

/** What a reference prints, as the last compile numbered it; "?" before the first compile. */
export function describeReference(command: string, keys: string[], numbers: ProjectIndex["labelNumbers"]): { text: string; detail: string } {
  const one = (key: string) => {
    const found = numbers[key];
    if (!found) return "?";
    if (command === "pageref") return found.page;
    if (command === "nameref") return found.title || found.number;
    if (command === "eqref") return `(${found.number})`;
    const named = command === "autoref" || command === "cref" || command === "Cref" || command === "vref";
    const kind = found.kind && named ? `${found.kind[0].toUpperCase()}${found.kind.slice(1)} ` : "";
    return `${kind}${found.number}`;
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
  const report = { touched: false };
  const page = state.facet(pageLook);
  const pieces = page ? pagePieces(state, text, report) : visualPieces(text, state.selection.ranges.map((r) => ({ from: r.from, to: r.to })), report);
  // Where each construct's hidden parts end, so an edit can tell whether it takes it whole.
  const ends = new Map<number, number>();
  for (const p of pieces) if (p.kind === "hide") ends.set(p.group, Math.max(ends.get(p.group) ?? p.to, p.to));
  for (const p of pieces) {
    if (p.kind === "line") out.push(Decoration.line({ class: `cm-v-line-${p.style}` }).range(p.from));
    else if (p.kind === "hide") out.push(Decoration.replace({ group: p.group, end: ends.get(p.group) }).range(p.from, p.to));
    else if (p.kind === "bullet") out.push((p.label === undefined ? bullet : Decoration.replace({ widget: new BulletWidget(p.label) })).range(p.from, p.to));
    else if (p.kind === "ref") {
      const { text, detail } = describeReference(p.command, p.keys, index.labelNumbers);
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
  /** Where the construct this part belongs to starts and ends. */
  group: number;
  end: number;
}

/** The hidden parts of commands drawn in `state`, in order. */
function hiddenParts(state: EditorState, from = 0, to = state.doc.length): Hidden[] {
  const out: Hidden[] = [];
  state.field(drawing).deco.between(from, to, (f, t, d) => {
    if (typeof d.spec.group === "number") out.push({ from: f, to: t, group: d.spec.group, end: d.spec.end });
  });
  return out;
}

/** The drawing that covers the text just before (`side` -1) or after (1) `at`, if any. */
function widgetBeside(state: EditorState, at: number, side: -1 | 1): { from: number; to: number; whole: boolean } | null {
  let found: { from: number; to: number; whole: boolean } | null = null;
  state.field(drawing).deco.between(at, at, (f, t, d) => {
    if (d.spec.widget && (side < 0 ? t === at && f < at : f === at && t > at)) {
      // The settings and a table are too much to lose to one key: the key steps past them.
      const big = d.spec.widget instanceof FoldWidget || d.spec.widget instanceof EditableTable || d.spec.widget instanceof TableWidget;
      found = { from: f, to: t, whole: !big };
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
  if (drawn) [from, to] = [drawn.from, drawn.to];
  else {
    const line = state.doc.lineAt(at);
    if (side < 0) from = at === line.from ? at - 1 : line.from + findClusterBreak(line.text, at - line.from, false);
    else to = at === line.to ? at + 1 : line.from + findClusterBreak(line.text, at - line.from, true);
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
  const item = /^(\s*)\\item\b/.exec(line.text);
  if (item) {
    go(at, `\n${item[1]}\\item `);
    return true;
  }
  if (!line.text.trim() || NOT_PROSE.test(line.text.trim())) return false;
  go(at, "\n\n");
  return true;
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

/** Edits by typing, pasting or deleting that would take only part of a construct's hidden text are kept off it. */
const keepConstructs = EditorState.changeFilter.of((tr) => {
  const user = ["input.type", "input.paste", "input.drop", "delete", "move.drop"].some((e) => tr.isUserEvent(e));
  const drawn = tr.startState.field(drawing, false);
  if (!tr.docChanged || !user || !drawn) return true;
  const keep: number[] = [];
  tr.changes.iterChangedRanges((fromA, toA) => {
    drawn.deco.between(fromA, toA, (f, t, d) => {
      if (Math.min(t, toA) <= Math.max(f, fromA)) return;
      const group = typeof d.spec.group === "number";
      const whole = group && fromA <= d.spec.group && toA >= d.spec.end;
      if ((group && !whole) || d.spec.widget instanceof FoldWidget) keep.push(f, t);
    });
  });
  return keep.length ? keep : true;
});

/** The page view: visual mode that stays drawn under the cursor, and is edited as a word processor is. */
export const visualPage: Extension = [
  pageLook.of(true),
  visualMode,
  keepConstructs,
  EditorView.atomicRanges.of((view) => view.state.field(drawing).covers),
  EditorView.editorAttributes.of({ class: "cm-page" }),
  Prec.high(
    keymap.of([
      { key: "Backspace", run: pageBackspace },
      { key: "Delete", run: pageDelete },
      { key: "Enter", run: pageEnter },
      { key: "Mod-/", run: toggleReveal },
      { key: "Escape", run: hideReveal },
    ]),
  ),
];

