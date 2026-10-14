// The table editor of visual mode: a drawn table whose cells can be typed in, selected with the
// mouse or the keyboard, merged, split, formatted and so on, much as in a word processor. Every
// action is worked out on the grid in tableModel.ts and written straight back to the LaTeX
// source as one editor change, so the source stays the only truth and undo works.
import { closeCompletion } from "@codemirror/autocomplete";
import { isolateHistory, redo, undo } from "@codemirror/commands";
import { type ChangeSpec, type Extension } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { confirm, prompt, store } from "../../state/store";
import { renderInline } from "./inlineTex";
import { type Insertion, mathAt } from "./symbols";
import {
  type Align,
  type BorderStyle,
  type Copied,
  type Edge,
  type Rect,
  type Table,
  anchorOf,
  bordersStyle,
  captionOf,
  captionPlace,
  cellsOf,
  cellsStyled,
  clearCells,
  copiedFromPlain,
  deleteColumn,
  deleteRow,
  ensureMultirow,
  ensurePackage,
  escapeInserted,
  escapeTex,
  expandRect,
  hasEdge,
  insertColumn,
  insertRow,
  isMerged,
  merge,
  needsBooktabs,
  needsMultirow,
  parseTable,
  pasteCells,
  setAlign,
  setBorders,
  setCaption,
  setCell,
  smallestChange,
  soundCaption,
  splitIntoColumns,
  splitIntoRows,
  splitMerged,
  tableFromCopied,
  tableRemoval,
  toggleEdge,
  toggleStyle,
  trimSpaces,
  writeTable,
} from "./tableModel";

interface At {
  r: number;
  c: number;
}

type Action =
  | "bold" | "italic" | "alignLeft" | "alignCentre" | "alignRight" | "rowAbove" | "rowBelow" | "columnLeft" | "columnRight"
  | "deleteRow" | "deleteColumn" | "clear" | "deleteTable" | "merge" | "split" | "splitColumns" | "splitRows" | "bordersAll"
  | "bordersOutside" | "bordersInside" | "bordersHeader" | "bordersBook" | "bordersNone" | "edgeTop" | "edgeBottom" | "edgeLeft"
  | "edgeRight" | "selectRow" | "selectColumn" | "selectTable" | "copy" | "cut" | "caption" | "source";

const ACTIONS: Record<Action, { label: string; title?: string; icon?: string; hint?: string }> = {
  bold: { label: "Bold", title: "Bold: the selected cells, or the selected text in a cell" },
  italic: { label: "Italic", title: "Italic: the selected cells, or the selected text in a cell" },
  alignLeft: { label: "Align left", icon: "al-l", title: "Align the selected columns left" },
  alignCentre: { label: "Centre", icon: "al-c", title: "Centre the selected columns" },
  alignRight: { label: "Align right", icon: "al-r", title: "Align the selected columns right" },
  rowAbove: { label: "Insert row above" },
  rowBelow: { label: "Insert row below" },
  columnLeft: { label: "Insert column to the left" },
  columnRight: { label: "Insert column to the right" },
  deleteRow: { label: "Delete rows", title: "Delete the selected rows" },
  deleteColumn: { label: "Delete columns", title: "Delete the selected columns" },
  clear: { label: "Clear cells", hint: "Del", title: "Empty the selected cells" },
  deleteTable: { label: "Delete table", title: "Delete the whole table" },
  merge: { label: "Merge cells", icon: "merge", title: "Merge the selected cells into one" },
  split: { label: "Unmerge cells", title: "Split this merged cell back into its cells" },
  splitColumns: { label: "Split into two columns", title: "Split this cell into two side by side" },
  splitRows: { label: "Split into two rows", title: "Split this cell into two, one above the other" },
  bordersAll: { label: "All borders" },
  bordersOutside: { label: "Outside border only" },
  bordersInside: { label: "Inside lines only" },
  bordersHeader: { label: "Lines above, below and under the first row" },
  bordersBook: { label: "Book style (booktabs)", title: "Heavier rules above and below, a lighter one under the first row, no vertical lines" },
  bordersNone: { label: "No borders" },
  edgeTop: { label: "Line above the selection" },
  edgeBottom: { label: "Line below the selection" },
  edgeLeft: { label: "Line left of the selection", title: "A vertical line always runs the whole height of a LaTeX table" },
  edgeRight: { label: "Line right of the selection", title: "A vertical line always runs the whole height of a LaTeX table" },
  selectRow: { label: "Select row" },
  selectColumn: { label: "Select column" },
  selectTable: { label: "Select table", hint: "Ctrl+A" },
  copy: { label: "Copy", hint: "Ctrl+C" },
  cut: { label: "Cut", hint: "Ctrl+X" },
  caption: { label: "Caption…", icon: "caption", title: "Add or change the table's caption" },
  source: { label: "Edit source", icon: "code", title: "Show this table's LaTeX and edit it directly" },
};

type Item = Action | "-";
type Tool = { kind: "button"; id: Action; glyph?: string; text?: string } | { kind: "menu"; id: string; label: string; icon: string; items: Item[] } | "sep";

const BAR: Tool[] = [
  { kind: "button", id: "bold", glyph: "B" },
  { kind: "button", id: "italic", glyph: "I" },
  "sep",
  { kind: "button", id: "alignLeft" },
  { kind: "button", id: "alignCentre" },
  { kind: "button", id: "alignRight" },
  "sep",
  { kind: "menu", id: "insert", label: "Insert", icon: "rows", items: ["rowAbove", "rowBelow", "-", "columnLeft", "columnRight"] },
  { kind: "menu", id: "delete", label: "Delete", icon: "trash", items: ["deleteRow", "deleteColumn", "-", "clear", "deleteTable"] },
  "sep",
  { kind: "button", id: "merge", text: "Merge" },
  { kind: "menu", id: "splitting", label: "Split", icon: "split", items: ["split", "splitColumns", "splitRows"] },
  "sep",
  {
    kind: "menu",
    id: "borders",
    label: "Borders",
    icon: "borders",
    items: ["bordersAll", "bordersOutside", "bordersInside", "bordersHeader", "bordersBook", "bordersNone", "-", "edgeTop", "edgeBottom", "edgeLeft", "edgeRight"],
  },
  "sep",
  { kind: "button", id: "caption", text: "Caption" },
  { kind: "button", id: "source", text: "Source" },
];

const CONTEXT: Item[] = [
  "cut", "copy", "-", "bold", "italic", "-", "rowAbove", "rowBelow", "columnLeft", "columnRight", "-", "deleteRow", "deleteColumn", "clear",
  "deleteTable", "-", "merge", "split", "splitColumns", "splitRows", "-", "alignLeft", "alignCentre", "alignRight", "-", "selectRow",
  "selectColumn", "selectTable", "-", "caption", "source",
];

const STYLES: Partial<Record<Action, BorderStyle>> = {
  bordersAll: "all",
  bordersOutside: "outside",
  bordersInside: "inside",
  bordersHeader: "header",
  bordersBook: "book",
  bordersNone: "none",
};
const EDGES: Partial<Record<Action, Edge>> = { edgeTop: "top", edgeBottom: "bottom", edgeLeft: "left", edgeRight: "right" };
/** Why a package was added to the preamble, said to the user. */
const WHY: Record<string, string> = {
  multirow: "Cells merged down a column need it.",
  booktabs: "The book style of rules needs it.",
  amssymb: "The symbol you chose needs it.",
  amsmath: "What you chose needs it.",
};
/** Cells copied from a table here, kept as LaTeX so that pasting them back loses nothing. */
const CELLS_TYPE = "application/x-emquad-cells";

const same = (a: Table, b: Table) => JSON.stringify(a) === JSON.stringify(b);
/** Two tables with the same cells, merges and rules, whatever the cells say. */
const sameShape = (a: Table, b: Table) => {
  const bare = (t: Table) => JSON.stringify({ ...t, rows: t.rows.map((row) => row.map((c) => ({ ...c, tex: "" }))) });
  return bare(a) === bare(b);
};

const SVG = "http://www.w3.org/2000/svg";
function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "ic");
  svg.setAttribute("aria-hidden", "true");
  const use = svg.appendChild(document.createElementNS(SVG, "use"));
  use.setAttribute("href", `#i-${name}`);
  return svg;
}
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/**
 * Where the keyboard was in a table when it left it for the tool bar or a menu: Bold, Italic and
 * symbols chosen there go into that table, not into the text around it.
 */
interface Target {
  controller: Controller;
  at: At;
  /** The text selected in the cell being typed in, or -1 when cells were selected instead. */
  start: number;
  end: number;
}
let target: Target | null = null;
/** A copy asked for from the table's menu, which the copy event that follows is for. */
let copying: { controller: Controller; cut: boolean } | null = null;

class Controller {
  readonly dom = document.createElement("div");
  private readonly bar = document.createElement("div");
  private readonly grid = document.createElement("table");
  private table: Table;
  private anchor: At | null = null;
  private head: At | null = null;
  /** What a mouse drag is choosing: cells, whole rows or whole columns. */
  private dragging: false | "cells" | "rows" | "cols" = false;
  /** The cell a press in the box being typed in started in, until the mouse is let go. */
  private pressFrom: At | null = null;
  private input: HTMLInputElement | null = null;
  /** What the box being typed in held before the last keystroke. */
  private typed = "";
  private menu: HTMLElement | null = null;
  /** The control that opened the menu, which gets the keyboard back when it closes. */
  private menuFrom: HTMLElement | null = null;
  /** Packages that what was put in the cell being typed in needs. */
  private readonly wanted = new Set<string>();
  private readonly warned = new Set<string>();
  /** The next change is one a tool made, and is a step of its own for undo. */
  private byTool = false;

  constructor(
    private view: EditorView,
    private source: string,
  ) {
    listenOnce();
    const parsed = parseTable(source);
    this.table = parsed.ok ? parsed.table : { aligns: ["l"], vrules: [false, false], rows: [], hrules: [{ kind: "none" }] };
    this.dom.className = "cm-v-tedit";
    // In the tab order, so the table can be reached without a mouse: Esc leaves the text,
    // Tab comes here, and Enter goes into the first cell.
    this.dom.tabIndex = 0;
    this.dom.setAttribute("role", "group");
    this.dom.setAttribute("aria-label", "Table. Press Enter to go into its cells, or click one to type in it. Shift+F10 opens its menu.");
    this.bar.className = "cm-v-tbar";
    this.bar.setAttribute("role", "toolbar");
    this.bar.setAttribute("aria-label", "Table tools");
    for (const tool of BAR) this.bar.append(this.tool(tool));
    this.dom.append(this.bar, this.grid);
    this.dom.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.dom.addEventListener("mouseover", (e) => this.onMouseOver(e));
    this.dom.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    this.dom.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.dom.addEventListener("focusout", (e) => {
      if (!this.dom.contains(e.relatedTarget as Node | null) && !this.menu) this.leave();
    });
    this.render();
  }

  /** The keyboard has left the table altogether: end the edit of a cell, and remember where it was. */
  private leave() {
    const [input, head] = [this.input, this.head];
    if (head) target = { controller: this, at: head, start: input ? (input.selectionStart ?? input.value.length) : -1, end: input ? (input.selectionEnd ?? input.value.length) : -1 };
    this.stopEditing(false);
  }

  /** The source changed under the table: by one of its own actions, by undo, or from outside. */
  update(view: EditorView, source: string) {
    this.view = view;
    if (source === this.source) return;
    const parsed = parseTable(source);
    if (!parsed.ok) return;
    const before = this.table;
    this.source = source;
    this.table = parsed.table;
    this.clampSelection();
    if (this.input && sameShape(before, this.table)) {
      // Typing: leave the cell being typed in alone and redraw only what changed around it.
      const at = this.head!;
      this.table.rows.forEach((row, r) =>
        row.forEach((cell, c) => {
          if (cell.hidden || (r === at.r && c === at.c) || before.rows[r][c].tex === cell.tex) return;
          const td = this.cellAt(r, c);
          if (td) this.draw(td, cell.tex);
        }),
      );
      const now = this.table.rows[at.r][at.c].tex;
      if (trimSpaces(this.input.value) !== now) {
        this.input.value = now;
        this.typed = now;
      }
      this.fit();
      this.paintSelection();
    } else {
      const editing = this.input ? { caret: this.input.selectionStart ?? 0 } : null;
      const focused = this.dom.contains(document.activeElement);
      this.input = null;
      this.render();
      if (editing && this.head) this.edit(this.head, editing.caret);
      else if (focused) this.refocus();
    }
    this.view.requestMeasure();
  }

  // ---------- the tool bar ----------

  private tool(tool: Tool): HTMLElement {
    if (tool === "sep") {
      const sep = document.createElement("span");
      sep.className = "sep";
      return sep;
    }
    const b = document.createElement("button");
    b.type = "button";
    // Pressing a tool leaves the keyboard where it was, in the cell being typed in or on the
    // selected cells, so that what the tool does applies there.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    if (tool.kind === "button") {
      const a = ACTIONS[tool.id];
      b.dataset.action = tool.id;
      b.title = (a.title ?? a.label) + (a.hint ? ` (${a.hint})` : "");
      b.setAttribute("aria-label", a.title ?? a.label);
      if (tool.glyph) {
        b.textContent = tool.glyph;
        b.classList.add(`g-${tool.id}`);
      } else if (a.icon) b.append(icon(a.icon));
      if (tool.text) b.append(Object.assign(document.createElement("span"), { className: "lbl", textContent: tool.text }));
      b.onclick = () => void this.run(tool.id);
      return b;
    }
    b.dataset.menu = tool.id;
    // The actions the menu holds, so that they can be found without opening it.
    b.dataset.items = tool.items.filter((i) => i !== "-").join(" ");
    b.title = tool.label;
    b.setAttribute("aria-label", tool.label);
    b.setAttribute("aria-haspopup", "menu");
    b.setAttribute("aria-expanded", "false");
    b.append(icon(tool.icon), Object.assign(document.createElement("span"), { className: "lbl", textContent: tool.label }), icon("chev"));
    b.lastElementChild!.classList.add("chev");
    b.onclick = () => {
      if (this.menuFrom === b) return this.closeMenu();
      const box = b.getBoundingClientRect();
      this.openMenu(tool.items, box.left, box.bottom + 4, b);
    };
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown") return;
      e.preventDefault();
      e.stopPropagation();
      b.click();
    });
    return b;
  }

  /** What can be done now, and which tools show as on. */
  private state(): { off: Partial<Record<Action, boolean>>; on: Partial<Record<Action, boolean>> } {
    const t = this.table;
    const cur = this.head;
    const rect = this.rect();
    const many = Boolean(rect && !this.single());
    const merged = Boolean(cur && isMerged(t, cur.r, cur.c));
    const none = !cur || !rect;
    const align = cur ? ((t.rows[cur.r][cur.c].spec && /[lcr]/.exec(t.rows[cur.r][cur.c].spec!)?.[0]) || t.aligns[cur.c]) : null;
    const style = bordersStyle(t);
    const off: Partial<Record<Action, boolean>> = {
      merge: !many,
      split: none || !merged || many,
      splitColumns: none || merged || many,
      splitRows: none || merged || many,
      deleteRow: none || rect!.bottom - rect!.top + 1 >= t.rows.length,
      deleteColumn: none || rect!.right - rect!.left + 1 >= t.aligns.length,
    };
    for (const id of ["rowAbove", "rowBelow", "columnLeft", "columnRight", "clear", "alignLeft", "alignCentre", "alignRight", "selectRow", "selectColumn", "copy", "cut", "bold", "italic"] as Action[]) off[id] = none;
    for (const id of Object.keys(EDGES) as Action[]) off[id] = none;
    const on: Partial<Record<Action, boolean>> = {
      bold: Boolean(rect && !this.input && cellsStyled(t, rect, "textbf")),
      italic: Boolean(rect && !this.input && cellsStyled(t, rect, "textit")),
      alignLeft: align === "l",
      alignCentre: align === "c",
      alignRight: align === "r",
    };
    for (const [id, s] of Object.entries(STYLES)) on[id as Action] = style === s;
    if (rect) for (const [id, edge] of Object.entries(EDGES)) on[id as Action] = hasEdge(t, rect, edge);
    return { off, on };
  }

  // ---------- drawing ----------

  private cellAt(r: number, c: number): HTMLTableCellElement | null {
    return this.grid.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  }

  private draw(td: HTMLElement, tex: string) {
    td.replaceChildren();
    if (tex) renderInline(td, tex);
    else td.append(" ");
  }

  /** A small + on the edge between two rows or two columns, which adds one there. */
  private adder(kind: "row" | "col", at: number): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    // The menus do the same from the keyboard; these are only for the mouse.
    b.tabIndex = -1;
    b.className = `cm-v-add cm-v-add-${kind}${at === 0 ? " first" : ""}`;
    b.textContent = "+";
    b.title = kind === "row" ? "Insert a row here" : "Insert a column here";
    b.setAttribute("aria-label", b.title);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.onclick = () => {
      const keep = this.head ?? { r: 0, c: 0 };
      if (kind === "row") this.act(insertRow(this.table, at), { r: at, c: keep.c });
      else this.act(insertColumn(this.table, at), { r: keep.r, c: at });
    };
    return b;
  }

  private render() {
    const t = this.table;
    this.grid.replaceChildren();
    const lineUnder = (b: number, c: number) => {
      const rule = t.hrules[b];
      return rule.kind === "cline" ? Boolean(rule.cols?.[c]) : rule.kind !== "none";
    };
    // Handles above the columns and before the rows, as in a word processor: click one to
    // choose a whole column or row, drag along them to choose several.
    const heads = this.grid.appendChild(document.createElement("tr"));
    heads.className = "cm-v-heads";
    const corner = heads.appendChild(document.createElement("th"));
    corner.className = "cm-v-corner";
    corner.title = "Select the whole table";
    t.aligns.forEach((_, c) => {
      const th = heads.appendChild(document.createElement("th"));
      th.className = "cm-v-colh";
      th.dataset.col = String(c);
      th.title = "Select this column (drag to select several)";
      if (c === 0) th.append(this.adder("col", 0));
      th.append(this.adder("col", c + 1));
    });
    t.rows.forEach((row, r) => {
      const tr = this.grid.appendChild(document.createElement("tr"));
      const th = tr.appendChild(document.createElement("th"));
      th.className = "cm-v-rowh";
      th.dataset.row = String(r);
      th.title = "Select this row (drag to select several)";
      if (r === 0) th.append(this.adder("row", 0));
      th.append(this.adder("row", r + 1));
      row.forEach((cell, c) => {
        if (cell.hidden) return;
        const td = tr.appendChild(document.createElement("td"));
        td.dataset.r = String(r);
        td.dataset.c = String(c);
        if (cell.colSpan > 1) td.colSpan = cell.colSpan;
        if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
        const align = (cell.spec && /[lcr]/.exec(cell.spec)?.[0]) || t.aligns[c];
        td.className = `al-${align}`;
        const ruleClass = (b: number) => (t.hrules[b].kind === "toprule" || t.hrules[b].kind === "bottomrule" ? "heavy" : "");
        if (lineUnder(r, c)) td.classList.add("rule-top", ...(ruleClass(r) ? [`${ruleClass(r)}-top`] : []));
        if (lineUnder(r + cell.rowSpan, c)) td.classList.add("rule-bottom", ...(ruleClass(r + cell.rowSpan) ? [`${ruleClass(r + cell.rowSpan)}-bottom`] : []));
        if (t.vrules[c]) td.classList.add("rule-left");
        if (t.vrules[c + cell.colSpan]) td.classList.add("rule-right");
        this.draw(td, cell.tex);
      });
    });
    this.paintSelection();
  }

  private rect(): Rect | null {
    if (!this.anchor || !this.head) return null;
    return expandRect(this.table, { top: this.anchor.r, left: this.anchor.c, bottom: this.head.r, right: this.head.c });
  }

  private paintSelection() {
    const rect = this.rect();
    const many = Boolean(rect && !this.single());
    const t = this.table;
    for (const td of this.grid.querySelectorAll<HTMLTableCellElement>("td")) {
      const [r, c] = [Number(td.dataset.r), Number(td.dataset.c)];
      td.classList.toggle("sel", Boolean(many && rect && r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right));
      td.classList.toggle("cur", Boolean(this.head && this.head.r === r && this.head.c === c));
    }
    // The handles of whole rows and columns that are selected show it too.
    const allRows = Boolean(rect && rect.top === 0 && rect.bottom === t.rows.length - 1);
    const allCols = Boolean(rect && rect.left === 0 && rect.right === t.aligns.length - 1);
    for (const th of this.grid.querySelectorAll<HTMLElement>("th.cm-v-colh")) {
      const c = Number(th.dataset.col);
      th.classList.toggle("on", Boolean(many && allRows && rect && c >= rect.left && c <= rect.right));
    }
    for (const th of this.grid.querySelectorAll<HTMLElement>("th.cm-v-rowh")) {
      const r = Number(th.dataset.row);
      th.classList.toggle("on", Boolean(many && allCols && rect && r >= rect.top && r <= rect.bottom));
    }
    const { off, on } = this.state();
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
      const id = b.dataset.action as Action;
      b.disabled = Boolean(off[id]);
      if (id in on) b.setAttribute("aria-pressed", String(Boolean(on[id])));
    }
  }

  /** The selection is one cell, merged or not. */
  private single(): boolean {
    if (!this.anchor || !this.head) return true;
    const a = anchorOf(this.table, this.anchor.r, this.anchor.c);
    const h = anchorOf(this.table, this.head.r, this.head.c);
    return a.r === h.r && a.c === h.c;
  }

  private clampSelection() {
    const t = this.table;
    const fit = (at: At | null): At | null => {
      if (!at || t.rows.length === 0) return null;
      return anchorOf(t, Math.min(at.r, t.rows.length - 1), Math.min(at.c, t.aligns.length - 1));
    };
    this.anchor = fit(this.anchor);
    this.head = fit(this.head);
  }

  private select(anchor: At, head: At) {
    this.stopEditing(false);
    this.anchor = anchor;
    this.head = head;
    this.paintSelection();
    this.dom.focus({ preventScroll: true });
  }

  // ---------- typing in a cell ----------

  private fit() {
    if (this.input) this.input.size = Math.max(2, this.input.value.length + 1);
  }

  private edit(at: At, caret?: number) {
    this.stopEditing(false);
    const cell = anchorOf(this.table, at.r, at.c);
    this.anchor = this.head = cell;
    const td = this.cellAt(cell.r, cell.c);
    if (!td) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "cm-v-tcell";
    input.spellcheck = false;
    input.value = this.table.rows[cell.r][cell.c].tex;
    input.setAttribute("aria-label", `Row ${cell.r + 1}, column ${cell.c + 1}`);
    input.addEventListener("input", () => this.onType());
    td.replaceChildren(input);
    td.classList.add("editing");
    this.input = input;
    this.typed = input.value;
    this.fit();
    this.paintSelection();
    input.focus({ preventScroll: true });
    const place = caret === undefined ? input.value.length : Math.min(caret, input.value.length);
    input.setSelectionRange(place, place);
    this.view.requestMeasure();
  }

  /** Leave the cell being typed in. Text that cannot go into a table as written is not kept. */
  private stopEditing(keepFocus: boolean) {
    const input = this.input;
    if (!input || !this.head) return;
    this.input = null;
    this.wanted.clear();
    const td = input.closest("td");
    const kept = this.table.rows[this.head.r]?.[this.head.c]?.tex ?? "";
    if (input.classList.contains("bad")) {
      store().notify(`“${input.value}” could not be put in the table as written, so the cell was left as it was. ${this.problem(input.value)}`, true);
    }
    if (td) {
      td.classList.remove("editing");
      this.draw(td, kept);
    }
    if (keepFocus) this.dom.focus({ preventScroll: true });
    this.paintSelection();
    this.view.requestMeasure();
  }

  /** What is wrong with text that cannot go into a cell, in a sentence. */
  private problem(text: string): string {
    if (/\\begin\{/.test(text)) return "An environment such as a matrix cannot go in a table cell here; use Edit source.";
    if (/\\\\/.test(text)) return "A line break (\\\\) would end the row.";
    return "Check that its braces match and that $ signs come in pairs; write a dollar sign as \\$, and a ^ inside $…$.";
  }

  private onType() {
    const input = this.input;
    const at = this.head;
    if (!input || !at) return;
    // Only what was just typed is escaped. What the cell already held is left as written.
    const escaped = escapeInserted(this.typed, input.value);
    this.typed = escaped;
    if (escaped !== input.value) {
      const caret = (input.selectionStart ?? 0) + (escaped.length - input.value.length);
      input.value = escaped;
      input.setSelectionRange(caret, caret);
    }
    this.fit();
    const next = setCell(this.table, at.r, at.c, trimSpaces(input.value));
    // What is typed must read back as this one cell, or it would break the table apart.
    const back = parseTable(writeTable(next));
    const sound = back.ok && same(back.table, next) && soundCaption(next.rows[at.r][at.c].tex);
    input.classList.toggle("bad", !sound);
    input.title = sound ? "" : `This cannot go into the table yet. ${this.problem(input.value)}`;
    if (sound) this.commit(next, false);
  }

  /** Put text around the selected text of the cell being typed in, keeping that text selected. */
  private surround(input: HTMLInputElement, start: number, end: number, ins: Insertion) {
    const value = input.value;
    const [s, e] = [Math.min(start, value.length), Math.min(end, value.length)];
    input.value = value.slice(0, s) + ins.before + value.slice(s, e) + ins.after + value.slice(e);
    input.setSelectionRange(s + ins.before.length, s + ins.before.length + (e - s));
    if (ins.pkg) this.wanted.add(ins.pkg);
    this.byTool = true;
    this.onType();
  }

  /** Bold or Italic from a tool: on the text selected in the cell, or on the selected cells. */
  format(name: string, where: { at: At; start: number; end: number } | null) {
    const input = this.input;
    if (input && !where) return this.surround(input, input.selectionStart ?? 0, input.selectionEnd ?? 0, { before: `\\${name}{`, after: "}" });
    if (where && where.start >= 0) {
      this.edit(where.at);
      if (this.input) this.surround(this.input, where.start, where.end, { before: `\\${name}{`, after: "}" });
      return;
    }
    const rect = this.rect();
    if (rect) this.act(toggleStyle(this.table, rect, name), "keep");
  }

  /** A symbol or a piece of LaTeX from a tool: into the cell, where its text cursor was or at its end. */
  insert(make: (inMath: boolean, next: string) => Insertion, where: { at: At; start: number; end: number }) {
    this.edit(where.at);
    const input = this.input;
    if (!input) return;
    const [s, e] = where.start >= 0 ? [where.start, where.end] : [input.value.length, input.value.length];
    this.surround(input, s, e, make(mathAt(input.value, s), input.value.slice(e, e + 1)));
  }

  /** Where typing in this table would go now: the text selected in the cell, or the current cell's end. */
  here(): { at: At; start: number; end: number } | null {
    const [input, head] = [this.input, this.head];
    if (!head) return null;
    return input ? { at: head, start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length } : { at: head, start: -1, end: -1 };
  }

  // ---------- changing the source ----------

  private place(): { from: number; indent: string; text: string } | null {
    const from = this.view.posAtDOM(this.dom);
    const doc = this.view.state.doc;
    if (doc.sliceString(from, from + this.source.length) !== this.source) return null;
    const line = doc.lineAt(from);
    const lead = doc.sliceString(line.from, from);
    return { from, indent: /^[ \t]*$/.test(lead) ? lead : "", text: doc.toString() };
  }

  /** Write a new version of the table to the source, as one step that undo takes back whole. */
  private commit(next: Table, structural: boolean): boolean {
    structural ||= this.byTool;
    this.byTool = false;
    const at = this.place();
    if (!at) return false;
    const changes: ChangeSpec[] = [];
    // Nothing is written that would not read back as the very table that was meant.
    const back = parseTable(writeTable(next));
    if (!back.ok || !same(back.table, next)) {
      store().notify("That change could not be written as LaTeX without altering the table, so it was not made. Use Edit source for this one.", true);
      return false;
    }
    const change = smallestChange(this.source, writeTable(next, at.indent), at.from);
    if (!change) return false;
    changes.push(change);
    // The packages the table now needs go into the preamble with the same change.
    const wanted = new Set(this.wanted);
    if (needsMultirow(next)) wanted.add("multirow");
    if (needsBooktabs(next)) wanted.add("booktabs");
    const added: string[] = [];
    for (const name of wanted) {
      const need = ensurePackage(at.text, name);
      if (typeof need === "object") {
        changes.push(need);
        added.push(name);
      } else if (need === "no-preamble" && !this.warned.has(name)) {
        this.warned.add(name);
        store().notify(`This needs \\usepackage{${name}}, and this file has no preamble to add it to. Add it to your main file's preamble.`, true);
      }
    }
    this.wanted.clear();
    if (added.length) store().notify(`Added ${added.map((name) => `\\usepackage{${name}}`).join(" and ")} to the preamble. ${WHY[added[0]] ?? ""}`.trim());
    this.view.dispatch({
      changes,
      userEvent: structural ? "input.table" : "input.type",
      annotations: structural ? isolateHistory.of("full") : undefined,
    });
    // Typing in a cell is typing, but not at the text cursor: no suggestions belong there.
    closeCompletion(this.view);
    return true;
  }

  async run(action: Action) {
    this.closeMenu();
    const t = this.table;
    const cur = this.head;
    const rect = this.rect();
    const last = { r: t.rows.length - 1, c: t.aligns.length - 1 };
    if (action === "source") {
      const at = this.place();
      if (!at) return;
      this.stopEditing(false);
      this.view.dispatch({ selection: { anchor: at.from + 1 } });
      this.view.focus();
      return;
    }
    if (action === "caption") return this.caption();
    if (action === "deleteTable") {
      const at = this.place();
      if (!at) return;
      this.stopEditing(false);
      const change = tableRemoval(at.text, at.from, at.from + this.source.length);
      this.view.dispatch({ changes: change, selection: { anchor: change.from }, userEvent: "delete.table", annotations: isolateHistory.of("full") });
      this.view.focus();
      store().notify("The table was deleted. Ctrl+Z brings it back.");
      return;
    }
    if (action === "selectTable") return this.select({ r: 0, c: 0 }, last);
    const style = STYLES[action];
    if (style) return void this.act(setBorders(t, style), "keep");
    if (action === "bold" || action === "italic") return this.format(action === "bold" ? "textbf" : "textit", null);
    if (!cur || !rect) return;
    const edge = EDGES[action];
    if (edge) return void this.act(toggleEdge(t, rect, edge), "keep");
    const rows = Array.from({ length: rect.bottom - rect.top + 1 }, (_, i) => rect.bottom - i);
    const cols = Array.from({ length: rect.right - rect.left + 1 }, (_, i) => rect.right - i);
    const align = (a: Align) => this.act(setAlign(t, rect, a), "keep");
    switch (action) {
      case "copy":
      case "cut":
        return this.copy(action === "cut");
      case "selectRow":
        return this.select({ r: rect.top, c: 0 }, { r: rect.bottom, c: last.c });
      case "selectColumn":
        return this.select({ r: 0, c: rect.left }, { r: last.r, c: rect.right });
      case "clear":
        return void this.act(clearCells(t, rect), "keep");
      case "merge":
        return void this.act(merge(t, rect), { r: rect.top, c: rect.left });
      case "split":
        return void this.act(splitMerged(t, cur.r, cur.c), cur);
      case "splitColumns":
        return void this.act(splitIntoColumns(t, cur.r, cur.c), cur);
      case "splitRows":
        return void this.act(splitIntoRows(t, cur.r, cur.c), cur);
      case "rowAbove":
        return void this.act(insertRow(t, rect.top), { r: rect.top, c: cur.c });
      case "rowBelow":
        return void this.act(insertRow(t, rect.bottom + 1), { r: rect.bottom + 1, c: cur.c });
      case "deleteRow":
        return void this.act(rows.reduce((x, r) => deleteRow(x, r), t), { r: Math.max(0, rect.top - 1), c: cur.c });
      case "columnLeft":
        return void this.act(insertColumn(t, rect.left), { r: cur.r, c: rect.left });
      case "columnRight":
        return void this.act(insertColumn(t, rect.right + 1), { r: cur.r, c: rect.right + 1 });
      case "deleteColumn":
        return void this.act(cols.reduce((x, c) => deleteColumn(x, c), t), { r: cur.r, c: Math.max(0, rect.left - 1) });
      case "alignLeft":
        return void align("l");
      case "alignCentre":
        return void align("c");
      case "alignRight":
        return void align("r");
    }
  }

  private async caption() {
    const at = this.place();
    if (!at) return;
    const to = at.from + this.source.length;
    const where = captionPlace(at.text, at.from, to);
    if (where.kind === "no") return store().notify(where.reason, true);
    const had = captionOf(at.text, at.from, to);
    const caption = await prompt("Table caption", had ?? "", "Save", "Shown under the table in the PDF. Leave it empty to remove the caption.");
    const again = this.place();
    if (caption === null || !again || again.from !== at.from || again.text !== at.text) return;
    if (trimSpaces(caption) === (had ?? "")) return;
    const wanted = trimSpaces(escapeInserted(had ?? "", caption));
    if (!wanted && where.kind === "float" && where.labelled) {
      return store().notify("This table has a label that goes with its caption, so the caption was not removed. Remove both in the source.", true);
    }
    if (!soundCaption(wanted)) {
      return store().notify("That caption cannot be written as LaTeX as it stands, so it was not changed. Check that its braces match and that $ signs come in pairs; write a dollar sign as \\$, and a ^ inside $…$.", true);
    }
    const changes = setCaption(at.text, at.from, to, wanted);
    if (changes.length) this.view.dispatch({ changes, userEvent: "input.table", annotations: isolateHistory.of("full") });
  }

  /**
   * Make a change to the table and leave the selection as asked: one cell, or the cells that
   * were selected before ("keep").
   */
  private act(next: Table, then: At | null | "keep") {
    const [anchor, head] = [this.anchor, this.head];
    this.stopEditing(false);
    if (then === "keep") [this.anchor, this.head] = [anchor, head];
    else this.anchor = this.head = then;
    if (!this.commit(next, true)) this.paintSelection();
    this.refocus();
  }

  /** Keep the keyboard where it was if that is a tool that can still be used; else the table. */
  private refocus() {
    const active = document.activeElement as HTMLButtonElement | null;
    if (active && this.bar.contains(active) && !active.disabled) return;
    this.dom.focus({ preventScroll: true });
  }

  // ---------- the clipboard ----------

  private copy(cut: boolean) {
    this.dom.focus({ preventScroll: true });
    copying = { controller: this, cut };
    try {
      document.execCommand("copy");
    } finally {
      copying = null;
    }
  }

  /** Put the selected cells on the clipboard: as LaTeX for this editor, as a table for others. */
  onCopy(e: ClipboardEvent, cut: boolean): boolean {
    const rect = this.rect();
    if (this.input || !rect || !e.clipboardData) return false;
    const cells = cellsOf(this.table, rect);
    e.clipboardData.setData("text/plain", cells.map((row) => row.join("\t")).join("\n"));
    e.clipboardData.setData("text/html", `<table>${cells.map((row) => `<tr>${row.map((tex) => `<td>${escapeHtml(tex)}</td>`).join("")}</tr>`).join("")}</table>`);
    e.clipboardData.setData(CELLS_TYPE, JSON.stringify(cells));
    e.preventDefault();
    if (cut) this.act(clearCells(this.table, rect), "keep");
    return true;
  }

  /** Paste cells: into the table from the selected cell on, as in a spreadsheet. */
  onPaste(e: ClipboardEvent) {
    const data = e.clipboardData;
    const rect = this.rect();
    if (!data || !rect) return;
    let cells: string[][] | null = null;
    try {
      const own: unknown = JSON.parse(data.getData(CELLS_TYPE) || "null");
      if (Array.isArray(own) && own.every((row) => Array.isArray(row) && row.every((x) => typeof x === "string"))) cells = own as string[][];
    } catch {
      cells = null;
    }
    const html = cells ? null : copiedFromHtml(data.getData("text/html"));
    if (html) cells = html.map((row) => row.map((cell) => escapeTex(cell.text)));
    if (!cells) {
      const plain = data.getData("text/plain").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
      cells = plain ? plain.split("\n").map((line) => line.split("\t").map(escapeTex)) : null;
    }
    // A single piece of text pasted while typing is typed, like any other.
    if (!cells || (this.input && cells.length === 1 && cells[0].length === 1)) return;
    e.preventDefault();
    e.stopPropagation();
    const from = this.input && this.head ? this.head : { r: rect.top, c: rect.left };
    const next = pasteCells(this.table, from.r, from.c, cells);
    if (!next) {
      store().notify("Cells cannot be pasted over merged cells. Split them first, or paste somewhere else.", true);
      return;
    }
    const width = Math.max(...cells.map((row) => row.length));
    this.stopEditing(false);
    this.anchor = from;
    this.head = { r: from.r + cells.length - 1, c: from.c + width - 1 };
    if (!this.commit(next, true)) this.paintSelection();
    this.dom.focus({ preventScroll: true });
  }

  // ---------- mouse ----------

  private cellOf(target: EventTarget | null): At | null {
    const td = (target as HTMLElement | null)?.closest?.("td");
    return td && this.grid.contains(td) ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : null;
  }

  /** Until the mouse button is let go. */
  private whenUp(then: () => void) {
    const up = () => {
      window.removeEventListener("mouseup", up);
      then();
    };
    window.addEventListener("mouseup", up);
  }

  private onMouseDown(e: MouseEvent) {
    const el = e.target as HTMLElement;
    if (e.button !== 0 || el.closest("button, .cm-v-tmenu")) return;
    this.closeMenu();
    if (el.closest("input")) {
      // A press in the text being typed: selecting letters, unless the mouse goes on into
      // another cell, when it selects cells instead.
      this.pressFrom = this.head;
      this.whenUp(() => {
        this.pressFrom = null;
        if (this.dragging) {
          this.dragging = false;
          this.dom.focus({ preventScroll: true });
        }
      });
      return;
    }
    e.preventDefault();
    const handle = el.closest("th");
    if (handle && this.grid.contains(handle)) return this.pressHandle(handle, e.shiftKey);
    const at = this.cellOf(e.target);
    if (!at) return;
    this.stopEditing(false);
    if (e.shiftKey && this.anchor) this.head = at;
    else this.anchor = this.head = at;
    this.dragging = "cells";
    this.paintSelection();
    this.whenUp(() => {
      this.dragging = false;
      if (this.single() && this.head && !e.shiftKey) this.edit(this.head);
      else this.dom.focus({ preventScroll: true });
    });
  }

  /** A press on a row or column handle, or on the corner. */
  private pressHandle(th: HTMLElement, extend: boolean) {
    const t = this.table;
    if (!t.rows.length) return;
    const last = { r: t.rows.length - 1, c: t.aligns.length - 1 };
    this.stopEditing(false);
    if (th.classList.contains("cm-v-corner")) return this.select({ r: 0, c: 0 }, last);
    if (th.dataset.col) {
      const c = Number(th.dataset.col);
      this.anchor = { r: 0, c: extend && this.anchor ? this.anchor.c : c };
      this.head = { r: last.r, c };
      this.dragging = "cols";
    } else {
      const r = Number(th.dataset.row);
      this.anchor = { r: extend && this.anchor ? this.anchor.r : r, c: 0 };
      this.head = { r, c: last.c };
      this.dragging = "rows";
    }
    this.paintSelection();
    this.dom.focus({ preventScroll: true });
    this.whenUp(() => (this.dragging = false));
  }

  private onMouseOver(e: MouseEvent) {
    const el = e.target as HTMLElement;
    const t = this.table;
    if (this.pressFrom && !this.dragging) {
      const at = this.cellOf(el);
      const from = anchorOf(t, this.pressFrom.r, this.pressFrom.c);
      if (!at || (anchorOf(t, at.r, at.c).r === from.r && anchorOf(t, at.r, at.c).c === from.c)) return;
      // The drag has left the cell it started in: from here on it selects cells.
      this.stopEditing(false);
      window.getSelection()?.removeAllRanges();
      this.anchor = from;
      this.head = at;
      this.dragging = "cells";
      this.paintSelection();
      return;
    }
    if (!this.dragging) return;
    const td = this.cellOf(el);
    const th = el.closest("th");
    let next: At | null = null;
    if (this.dragging === "cells") next = td;
    else if (this.dragging === "cols") {
      const c = th?.dataset.col !== undefined ? Number(th.dataset.col) : td?.c;
      if (c !== undefined) next = { r: t.rows.length - 1, c };
    } else {
      const r = th?.dataset.row !== undefined ? Number(th.dataset.row) : td?.r;
      if (r !== undefined) next = { r, c: t.aligns.length - 1 };
    }
    if (!next || (this.head && next.r === this.head.r && next.c === this.head.c)) return;
    this.head = next;
    this.paintSelection();
  }

  private onContextMenu(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(".cm-v-tbar")) return;
    e.preventDefault();
    const at = this.cellOf(e.target);
    const rect = this.rect();
    const inside = at && rect && at.r >= rect.top && at.r <= rect.bottom && at.c >= rect.left && at.c <= rect.right;
    if (at && !inside) {
      this.stopEditing(false);
      this.anchor = this.head = anchorOf(this.table, at.r, at.c);
      this.paintSelection();
    }
    this.openMenu(CONTEXT, e.clientX, e.clientY, null, true);
  }

  // ---------- menus ----------

  /**
   * Open a menu of actions at a place on screen. A tool bar menu shows every action it holds,
   * those that cannot be used now greyed; the right-click menu shows only those that can.
   */
  private openMenu(items: Item[], x: number, y: number, from: HTMLElement | null, onlyUsable = false) {
    this.closeMenu();
    const { off, on } = this.state();
    const menu = document.createElement("div");
    menu.className = "cm-v-tmenu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", from?.getAttribute("aria-label") ?? "Table");
    let gap = false;
    for (const id of items) {
      if (id === "-") {
        gap = menu.childElementCount > 0;
        continue;
      }
      if (onlyUsable && off[id]) continue;
      if (gap) menu.appendChild(document.createElement("div")).className = "sep";
      gap = false;
      const a = ACTIONS[id];
      const item = menu.appendChild(document.createElement("button"));
      item.type = "button";
      item.dataset.action = id;
      item.disabled = Boolean(off[id]);
      const checkable = id in on || id in STYLES || id in EDGES;
      item.setAttribute("role", checkable ? (id in STYLES ? "menuitemradio" : "menuitemcheckbox") : "menuitem");
      if (checkable) item.setAttribute("aria-checked", String(Boolean(on[id])));
      if (a.title) item.title = a.title;
      const tick = item.appendChild(document.createElement("span"));
      tick.className = "tick";
      if (on[id]) tick.append(icon("check"));
      item.append(Object.assign(document.createElement("span"), { className: "txt", textContent: a.label }));
      if (a.hint) item.append(Object.assign(document.createElement("kbd"), { textContent: a.hint }));
      item.addEventListener("mousedown", (e) => e.preventDefault());
      item.onclick = () => void this.run(id);
    }
    menu.addEventListener("keydown", (e) => {
      const usable = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const at = usable.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        const back = this.menuFrom;
        this.closeMenu();
        (back ?? this.dom).focus({ preventScroll: true });
      } else if (e.key === "ArrowDown") usable[(at + 1) % usable.length]?.focus();
      else if (e.key === "ArrowUp") usable[(at - 1 + usable.length) % usable.length]?.focus();
      else if (e.key === "Home") usable[0]?.focus();
      else if (e.key === "End") usable[usable.length - 1]?.focus();
      else if (e.key !== "Tab") return;
      e.preventDefault();
      e.stopPropagation();
    });
    menu.addEventListener("focusout", (e) => {
      const to = e.relatedTarget as Node | null;
      // A menu being closed, by one of its own items, says nothing about where the keyboard went.
      if (this.menu !== menu || menu.contains(to)) return;
      this.closeMenu();
      // Out of the menu and out of the table too.
      if (!this.dom.contains(to)) this.leave();
    });
    document.body.appendChild(menu);
    this.menu = menu;
    this.menuFrom = from;
    from?.setAttribute("aria-expanded", "true");
    // Keep the whole menu on screen.
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  private closeMenu() {
    const menu = this.menu;
    this.menu = null;
    this.menuFrom?.setAttribute("aria-expanded", "false");
    this.menuFrom = null;
    menu?.remove();
  }

  // ---------- keyboard ----------

  /** The cell one step from `at` in reading order, or null at either end of the table. */
  private step(at: At, by: 1 | -1): At | null {
    const t = this.table;
    const n = t.aligns.length;
    for (let i = at.r * n + at.c + by; i >= 0 && i < t.rows.length * n; i += by) {
      const [r, c] = [Math.floor(i / n), i % n];
      if (!t.rows[r][c].hidden) return { r, c };
    }
    return null;
  }

  /** The cell next to `at` in a direction, taking merged cells as one; `at` itself at an edge. */
  private beside(at: At, dr: number, dc: number): At {
    const t = this.table;
    const here = anchorOf(t, at.r, at.c);
    const cell = t.rows[here.r][here.c];
    const r = dr > 0 ? here.r + cell.rowSpan : dr < 0 ? here.r - 1 : at.r;
    const c = dc > 0 ? here.c + cell.colSpan : dc < 0 ? here.c - 1 : at.c;
    if (r < 0 || r >= t.rows.length || c < 0 || c >= t.aligns.length) return at;
    return { r, c };
  }

  private onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".cm-v-tmenu")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.toLowerCase();
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && !e.altKey && (lower === "z" || lower === "y")) {
      // Undo belongs to the document, not to the box being typed in.
      done();
      // Undo scrolls to the text cursor, which is not where the table is: stay here.
      const scroller = this.view.scrollDOM;
      const [top, left] = [scroller.scrollTop, scroller.scrollLeft];
      if (lower === "y" || e.shiftKey) redo(this.view);
      else undo(this.view);
      const stay = () => scroller.scrollTo(left, top);
      stay();
      this.view.requestMeasure({ read: () => null, write: stay });
      return;
    }
    if (target.closest(".cm-v-tbar")) {
      if (key === "Escape") {
        done();
        this.dom.focus({ preventScroll: true });
      } else if (key === "ArrowRight" || key === "ArrowLeft") {
        // Along the tool bar with the arrow keys.
        done();
        const tools = Array.from(this.bar.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const at = tools.indexOf(target as HTMLButtonElement);
        tools[(at + (key === "ArrowRight" ? 1 : -1) + tools.length) % tools.length]?.focus();
      }
      return;
    }
    if ((key === "F10" && e.shiftKey) || key === "ContextMenu") {
      done();
      const box = (this.head ? this.cellAt(this.head.r, this.head.c) : this.grid)?.getBoundingClientRect();
      if (box) this.openMenu(CONTEXT, box.left + 8, box.bottom, null, true);
      return;
    }
    const cur = this.head;
    const input = this.input;
    if (input && cur) {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const atStart = start === 0 && end === 0;
      const atEnd = start === input.value.length && end === input.value.length;
      if (key === "Tab") {
        done();
        const next = this.step(cur, e.shiftKey ? -1 : 1);
        if (next) this.edit(next);
        else if (!e.shiftKey) {
          // Past the last cell: a new row, and on into its first cell.
          this.stopEditing(false);
          this.anchor = this.head = { r: this.table.rows.length, c: 0 };
          const rowsBefore = this.table.rows.length;
          if (this.commit(insertRow(this.table, rowsBefore), true)) this.edit({ r: rowsBefore, c: 0 });
        }
      } else if (key === "Escape") {
        done();
        this.stopEditing(true);
      } else if (key === "Enter") {
        done();
        const below = this.beside(cur, 1, 0);
        if (below !== cur) this.edit(below);
      } else if (e.shiftKey && (key === "ArrowUp" || key === "ArrowDown" || (key === "ArrowLeft" && start === 0) || (key === "ArrowRight" && end === input.value.length))) {
        // Shift and an arrow at the edge of the text starts choosing cells instead of letters.
        done();
        this.stopEditing(true);
        this.anchor = cur;
        this.extend(key);
      } else if (!e.shiftKey && !mod && !e.altKey) {
        const to = key === "ArrowUp" ? this.beside(cur, -1, 0) : key === "ArrowDown" ? this.beside(cur, 1, 0) : key === "ArrowLeft" && atStart ? this.step(cur, -1) : key === "ArrowRight" && atEnd ? this.step(cur, 1) : null;
        if (!to) return;
        done();
        if (to !== cur) this.edit(to, key === "ArrowRight" ? 0 : undefined);
      }
      return;
    }
    if (target !== this.dom || !cur) {
      if (target === this.dom && !cur && (key === "Enter" || key.startsWith("Arrow")) && this.table.rows.length) {
        done();
        this.anchor = this.head = { r: 0, c: 0 };
        this.paintSelection();
      }
      return;
    }
    // Cells are selected and none is being typed in.
    if (key.startsWith("Arrow")) {
      done();
      if (e.shiftKey) this.extend(key);
      else {
        this.anchor = this.head = this.beside(cur, key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0, key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0);
        this.anchor = this.head = anchorOf(this.table, this.head.r, this.head.c);
        this.paintSelection();
      }
    } else if (key === "Enter" || key === "F2") {
      done();
      this.edit(cur);
    } else if (key === "Delete" || key === "Backspace") {
      done();
      const rect = this.rect();
      if (rect) this.act(clearCells(this.table, rect), "keep");
    } else if (mod && !e.altKey && lower === "a") {
      done();
      void this.run("selectTable");
    } else if (mod && !e.altKey && (lower === "c" || lower === "x")) {
      done();
      this.copy(lower === "x");
    } else if (key.length === 1 && !mod && !e.altKey) {
      // Typing over a selected cell starts editing it; the key itself lands in the box.
      this.edit(cur);
    }
  }

  private extend(key: string) {
    if (!this.head) return;
    this.head = this.beside(this.head, key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0, key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0);
    this.paintSelection();
  }
}

const controllers = new WeakMap<HTMLElement, Controller>();

/** The table the keyboard is in now, if any. */
function focusedTable(): Controller | null {
  const el = (document.activeElement as HTMLElement | null)?.closest?.(".cm-v-tedit");
  return el ? (controllers.get(el as HTMLElement) ?? null) : null;
}

/** Places outside a table the keyboard can visit and come back from without leaving it. */
const TOOLS = ".tools, .menu-wrap, .menu-list, .sym-pop";

let listening = false;
/** The clipboard and focus listeners every table shares, set up with the first one. */
function listenOnce() {
  if (listening) return;
  listening = true;
  document.addEventListener("copy", (e) => void (copying ?? { controller: focusedTable(), cut: false }).controller?.onCopy(e, copying?.cut ?? false), true);
  document.addEventListener("cut", (e) => void focusedTable()?.onCopy(e, true), true);
  document.addEventListener("paste", (e) => focusedTable()?.onPaste(e), true);
  // Going anywhere but the tools, or into another table, forgets the table the tools work on.
  const away = (e: Event) => {
    const el = e.target as HTMLElement | null;
    if (!target || !el?.closest) return;
    if (target.controller.dom.contains(el) || el.closest(TOOLS)) return;
    target = null;
  };
  document.addEventListener("focusin", away, true);
  document.addEventListener("mousedown", away, true);
}

/** The table the tools act on: the one the keyboard is in, or the one it last left for them. */
function tableTarget(): { controller: Controller; where: { at: At; start: number; end: number } | null } | null {
  const now = focusedTable();
  if (now) return { controller: now, where: null };
  if (target && !target.controller.dom.isConnected) target = null;
  return target ? { controller: target.controller, where: target } : null;
}

/**
 * The tool bar and menus of the app go through here first, so that what they put in lands in
 * the table being worked on, where there is one.
 */
export const tableInput = {
  /** Set the selected cells, or the selected text of a cell, in `\name`. False when no table is in use. */
  format(name: string): boolean {
    const t = tableTarget();
    if (!t) return false;
    t.controller.format(name, t.where);
    return true;
  },
  /** Put LaTeX into the cell in use. False when no table is in use. */
  insert(make: (inMath: boolean, next: string) => Insertion): boolean {
    const t = tableTarget();
    if (!t) return false;
    const where = t.where ?? t.controller.here();
    if (!where) return false;
    t.controller.insert(make, where);
    return true;
  },
};

/** A table drawn so that it can be edited where it stands. */
export class EditableTable extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: EditableTable) {
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    const controller = new Controller(view, this.source);
    controllers.set(controller.dom, controller);
    return controller.dom;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const controller = controllers.get(dom);
    if (!controller) return false;
    controller.update(view, this.source);
    return true;
  }
  /** The table handles its own keys and clicks; the editor around it must not act on them. */
  ignoreEvent() {
    return true;
  }
}

// ---------- pasting a table ----------

/** The first table in copied HTML, as Word and Excel put on the clipboard. */
export function copiedFromHtml(html: string): Copied[][] | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const table = new DOMParser().parseFromString(html, "text/html").querySelector("table");
  if (!table) return null;
  const rows: Copied[][] = [];
  for (const tr of table.querySelectorAll("tr")) {
    if (tr.closest("table") !== table) continue;
    const cells = Array.from(tr.children).filter((el) => el.tagName === "TD" || el.tagName === "TH") as HTMLTableCellElement[];
    if (cells.length) rows.push(cells.map((cell) => ({ text: cell.textContent ?? "", colSpan: cell.colSpan, rowSpan: cell.rowSpan })));
  }
  return rows.length ? rows : null;
}

/**
 * When what is pasted is a table copied from Word, Excel or a web page, offer to paste it as
 * a LaTeX table. Declining pastes the plain text, as pasting always has.
 */
export const tablePaste: Extension = EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData;
    if (!data) return false;
    const plain = data.getData("text/plain");
    const copied = copiedFromHtml(data.getData("text/html")) ?? copiedFromPlain(plain);
    const table = copied && copied.flat().length > 1 ? tableFromCopied(copied) : null;
    // Offered only if it can be written as a table this editor would read back the same.
    if (!table || !parseTable(writeTable(table)).ok) return false;
    event.preventDefault();
    const size = `${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"} and ${table.aligns.length} ${table.aligns.length === 1 ? "column" : "columns"}`;
    void confirm("Paste as a table?", `The clipboard holds a table of ${size}. Cancel pastes it as plain text instead.`, "Paste as table").then((yes) => {
      const insert = yes ? `${writeTable(table)}\n` : plain;
      const main = view.state.selection.main;
      const changes: ChangeSpec[] = [{ from: main.from, to: main.to, insert }];
      let cursor = main.from + insert.length;
      // Cells that were merged downwards need the multirow package, here as anywhere.
      const need = yes && needsMultirow(table) ? ensureMultirow(view.state.doc.toString()) : "present";
      if (typeof need === "object" && (need.from <= main.from || need.from >= main.to)) {
        changes.push(need);
        if (need.from <= main.from) cursor += need.insert.length;
        store().notify("Added \\usepackage{multirow} to the preamble. Cells merged down a column need it.");
      } else if (need !== "present") {
        store().notify("Cells merged down a column need \\usepackage{multirow}. Add it to your main file's preamble.", true);
      }
      // The cursor goes after what was pasted, so the table is drawn and typing does not replace it.
      view.dispatch({ changes, selection: { anchor: cursor }, userEvent: "input.paste", annotations: isolateHistory.of("full") });
      view.focus();
    });
    return true;
  },
});
