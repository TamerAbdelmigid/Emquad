// Visual mode: draws the same plain source with headings, emphasis, typeset mathematics,
// bullets, tables, figures and citations. What to draw is decided in visualModel.ts; this file
// turns that into decorations.
import { type EditorState, type Extension, type Range as CmRange, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "../../ipc/api";
import { store } from "../../state/store";
import { type Row, closingBrace, describeCitation, visualPieces } from "./visualModel";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function typeset(el: HTMLElement, tex: string, display: boolean) {
  // A formula that cannot be typeset is shown as its source, marked, never as an error box.
  try {
    katex.render(tex, el, { displayMode: display, throwOnError: true, output: "html" });
  } catch {
    el.textContent = tex;
    el.classList.add("cm-v-math-bad");
    el.title = "This formula could not be previewed here. It may still compile.";
  }
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

const INLINE_TAGS = new Map([
  ["textbf", "b"],
  ["textit", "i"],
  ["emph", "i"],
  ["texttt", "code"],
  ["underline", "u"],
  ["textsc", "span"],
  ["textrm", "span"],
  ["mbox", "span"],
]);

/**
 * Draw the text of a table cell: mathematics, bold and italic are shown as such, and the rest
 * as it is written. Everything is added as text or as elements made here, never as markup.
 */
export function renderInline(el: HTMLElement, tex: string) {
  let plain = "";
  const flush = () => {
    if (plain) el.append(plain.replace(/~/g, " ").replace(/\s+/g, " "));
    plain = "";
  };
  for (let i = 0; i < tex.length; ) {
    const c = tex[i];
    if (c === "$") {
      const end = tex.indexOf("$", i + 1);
      if (end > i) {
        flush();
        const span = document.createElement("span");
        span.className = "cm-v-math";
        typeset(span, tex.slice(i + 1, end), false);
        el.append(span);
        i = end + 1;
        continue;
      }
    }
    if (c === "\\") {
      const name = /^[a-zA-Z]+/.exec(tex.slice(i + 1))?.[0];
      const tag = name ? INLINE_TAGS.get(name) : undefined;
      if (name && tag && tex[i + 1 + name.length] === "{") {
        const open = i + 1 + name.length;
        const end = closingBrace(tex, open);
        if (end > 0) {
          flush();
          const child = document.createElement(tag);
          renderInline(child, tex.slice(open + 1, end - 1));
          el.append(child);
          i = end;
          continue;
        }
      }
      if (!name && i + 1 < tex.length) {
        // An escaped character such as \& or \% stands for itself.
        plain += tex[i + 1] === "\\" ? " " : tex[i + 1];
        i += 2;
        continue;
      }
    }
    if (c !== "{" && c !== "}") plain += c;
    i++;
  }
  flush();
}

class TableWidget extends WidgetType {
  constructor(readonly rows: Row[]) {
    super();
  }
  eq(other: TableWidget) {
    return JSON.stringify(other.rows) === JSON.stringify(this.rows);
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-v-table";
    wrap.title = "Click to edit the table's source";
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
  ignoreEvent() {
    return false;
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
    const task = pdfjs.getDocument({ data: bytes });
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

function build(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  // Very large files stay in plain source: redrawing them on every keystroke would lag.
  if (text.length > 400_000) return Decoration.none;
  const selection = state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));
  const out: CmRange<Decoration>[] = [];
  const index = store().index;
  for (const p of visualPieces(text, selection)) {
    if (p.kind === "line") out.push(Decoration.line({ class: `cm-v-line-${p.style}` }).range(p.from));
    else if (p.kind === "hide") out.push(hidden.range(p.from, p.to));
    else if (p.kind === "bullet") out.push(bullet.range(p.from, p.to));
    else if (p.kind === "style") out.push(Decoration.mark({ class: `cm-v-${p.style}` }).range(p.from, p.to));
    else if (p.kind === "table") out.push(Decoration.replace({ widget: new TableWidget(p.rows) }).range(p.from, p.to));
    else if (p.kind === "image") out.push(Decoration.replace({ widget: new ImageWidget(p.path, picturesVersion) }).range(p.from, p.to));
    else if (p.kind === "cite") {
      const { label, detail, unknown } = describeCitation(p.keys, index);
      out.push(Decoration.replace({ widget: new CiteWidget(label, detail, unknown) }).range(p.from, p.to));
    } else out.push(Decoration.replace({ widget: new MathWidget(p.tex, p.display) }).range(p.from, p.to));
  }
  return Decoration.set(out, true);
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
const drawing = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(redrawVisual)) ? build(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});

/** Everything visual mode adds to an editor. */
export const visualMode: Extension = [drawing, EditorView.editorAttributes.of({ class: "cm-visual" })];
