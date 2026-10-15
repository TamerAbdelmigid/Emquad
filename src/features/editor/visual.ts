// Visual mode: draws the same plain source with headings, emphasis, typeset mathematics,
// bullets, tables, figures and citations. What to draw is decided in visualModel.ts; this file
// turns that into decorations.
import { type ChangeSet, type EditorSelection, type EditorState, type Extension, type Range as CmRange, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { openPdf } from "../../shared/pdf";
import { api } from "../../ipc/api";
import { store } from "../../state/store";
import { renderInline, typeset } from "./inlineTex";
import { EditableTable } from "./tableEditor";
import { parseTable } from "./tableModel";
import { type Row, describeCitation, visualPieces } from "./visualModel";


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
    typeset(el, this.tex, this.display);
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

const hidden = Decoration.replace({});
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
  /** The selection made something show as source when this was drawn. */
  touched: boolean;
  /** The text has changed since, and this was only moved along with it. */
  stale: boolean;
}

function build(state: EditorState): Drawn {
  const text = state.doc.toString();
  // Very large files stay in plain source: redrawing them on every keystroke would lag.
  if (text.length > 400_000) return { deco: Decoration.none, touched: false, stale: false };
  const selection = state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));
  const out: CmRange<Decoration>[] = [];
  const index = store().index;
  const report = { touched: false };
  for (const p of visualPieces(text, selection, report)) {
    if (p.kind === "line") out.push(Decoration.line({ class: `cm-v-line-${p.style}` }).range(p.from));
    else if (p.kind === "hide") out.push(hidden.range(p.from, p.to));
    else if (p.kind === "bullet") out.push(bullet.range(p.from, p.to));
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
  return { deco: Decoration.set(out, true), touched: report.touched, stale: false };
}

/** Whether a change reaches anything drawn: then it must be drawn again at once. */
function reaches(deco: DecorationSet, changes: ChangeSet): boolean {
  let hit = false;
  changes.iterChangedRanges((from, to) => {
    if (!hit) deco.between(from, to, () => ((hit = true), false));
  });
  return hit;
}

/** Whether the selection touches anything drawn, which would then show as source. */
function touches(deco: DecorationSet, selection: EditorSelection): boolean {
  let hit = false;
  for (const r of selection.ranges) {
    // Line styles do not give way to the cursor; only what covers some text does.
    deco.between(r.from, r.to, (from, to) => (from < to ? ((hit = true), false) : undefined));
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
      if (typing && !reaches(value.deco, tr.changes)) return { deco: value.deco.map(tr.changes), touched: value.touched, stale: true };
      return build(tr.state);
    }
    // The cursor moving through plain text, touching nothing before or after, changes nothing.
    if (tr.selection && (value.stale || value.touched || touches(value.deco, tr.state.selection))) return build(tr.state);
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
export const visualMode: Extension = [drawing, settle, EditorView.editorAttributes.of({ class: "cm-visual" })];
