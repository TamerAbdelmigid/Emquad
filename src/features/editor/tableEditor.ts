// The table editor of visual mode: a drawn table whose cells can be typed in, merged, split and
// so on. Every action is worked out on the grid in tableModel.ts and written straight back to
// the LaTeX source as one editor change, so the source stays the only truth and undo works.
import { closeCompletion } from "@codemirror/autocomplete";
import { isolateHistory, redo, undo } from "@codemirror/commands";
import { type ChangeSpec, type Extension } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { confirm, prompt, store } from "../../state/store";
import { renderInline } from "./inlineTex";
import {
  type Align,
  type Copied,
  type Rect,
  type Table,
  anchorOf,
  captionOf,
  copiedFromPlain,
  deleteColumn,
  deleteRow,
  ensureMultirow,
  escapeTyped,
  expandRect,
  hasBorders,
  insertColumn,
  insertRow,
  isMerged,
  merge,
  needsMultirow,
  parseTable,
  setAlign,
  setCaption,
  setCell,
  smallestChange,
  soundCaption,
  splitIntoColumns,
  splitIntoRows,
  splitMerged,
  tableFromCopied,
  toggleBorders,
  writeTable,
} from "./tableModel";

interface At {
  r: number;
  c: number;
}

type Action =
  | "merge" | "split" | "splitColumns" | "splitRows" | "rowAbove" | "rowBelow" | "deleteRow" | "columnLeft" | "columnRight"
  | "deleteColumn" | "alignLeft" | "alignCentre" | "alignRight" | "borders" | "caption" | "source";

const ACTIONS: { id: Action; label: string; title: string; group: number }[] = [
  { id: "merge", label: "Merge", title: "Merge the selected cells into one", group: 0 },
  { id: "split", label: "Split", title: "Split this merged cell back into its cells", group: 0 },
  { id: "splitColumns", label: "Split ↔", title: "Split this cell into two side by side", group: 0 },
  { id: "splitRows", label: "Split ↕", title: "Split this cell into two, one above the other", group: 0 },
  { id: "rowAbove", label: "Row ↑", title: "Insert a row above", group: 1 },
  { id: "rowBelow", label: "Row ↓", title: "Insert a row below", group: 1 },
  { id: "deleteRow", label: "Row ✕", title: "Delete the selected rows", group: 1 },
  { id: "columnLeft", label: "Col ←", title: "Insert a column to the left", group: 2 },
  { id: "columnRight", label: "Col →", title: "Insert a column to the right", group: 2 },
  { id: "deleteColumn", label: "Col ✕", title: "Delete the selected columns", group: 2 },
  { id: "alignLeft", label: "Left", title: "Align the selected columns left", group: 3 },
  { id: "alignCentre", label: "Centre", title: "Centre the selected columns", group: 3 },
  { id: "alignRight", label: "Right", title: "Align the selected columns right", group: 3 },
  { id: "borders", label: "Borders", title: "Draw every border, or remove them all", group: 4 },
  { id: "caption", label: "Caption", title: "Add or change the table's caption", group: 4 },
  { id: "source", label: "Edit source", title: "Show this table's LaTeX and edit it directly", group: 5 },
];

const same = (a: Table, b: Table) => JSON.stringify(a) === JSON.stringify(b);
/** Two tables with the same cells, merges and rules, whatever the cells say. */
const sameShape = (a: Table, b: Table) => {
  const bare = (t: Table) => JSON.stringify({ ...t, rows: t.rows.map((row) => row.map((c) => ({ ...c, tex: "" }))) });
  return bare(a) === bare(b);
};

class Controller {
  readonly dom = document.createElement("div");
  private readonly bar = document.createElement("div");
  private readonly grid = document.createElement("table");
  private table: Table;
  private anchor: At | null = null;
  private head: At | null = null;
  private dragging = false;
  private input: HTMLInputElement | null = null;
  private menu: HTMLElement | null = null;
  private warned = false;

  constructor(
    private view: EditorView,
    private source: string,
  ) {
    const parsed = parseTable(source);
    this.table = parsed.ok ? parsed.table : { aligns: ["l"], vrules: [false, false], rows: [], hrules: [{ kind: "none" }] };
    this.dom.className = "cm-v-tedit";
    // In the tab order, so the table can be reached without a mouse: Esc leaves the text,
    // Tab comes here, and Enter goes into the first cell.
    this.dom.tabIndex = 0;
    this.dom.setAttribute("role", "group");
    this.dom.setAttribute("aria-label", "Table. Press Enter to go into its cells, or click one to type in it.");
    this.bar.className = "cm-v-tbar";
    this.bar.setAttribute("role", "toolbar");
    this.bar.setAttribute("aria-label", "Table tools");
    let group = 0;
    for (const a of ACTIONS) {
      if (a.group !== group) this.bar.appendChild(document.createElement("span")).className = "sep";
      group = a.group;
      const b = this.bar.appendChild(document.createElement("button"));
      b.type = "button";
      b.textContent = a.label;
      b.title = a.title;
      b.setAttribute("aria-label", a.title);
      b.dataset.action = a.id;
      b.onclick = () => void this.run(a.id);
    }
    this.dom.append(this.bar, this.grid);
    this.dom.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.dom.addEventListener("mouseover", (e) => this.onMouseOver(e));
    this.dom.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    this.dom.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.dom.addEventListener("focusout", (e) => {
      // Leaving the table altogether ends the edit of a cell.
      if (!this.dom.contains(e.relatedTarget as Node | null) && !this.menu) this.stopEditing(false);
    });
    this.render();
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
      if (escapeTyped(this.input.value).trim() !== now) this.input.value = now;
      this.fit();
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

  // ---------- drawing ----------

  private cellAt(r: number, c: number): HTMLTableCellElement | null {
    return this.grid.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  }

  private draw(td: HTMLElement, tex: string) {
    td.replaceChildren();
    if (tex) renderInline(td, tex);
    else td.append(" ");
  }

  private render() {
    const t = this.table;
    this.grid.replaceChildren();
    const lineUnder = (b: number, c: number) => {
      const rule = t.hrules[b];
      return rule.kind === "cline" ? Boolean(rule.cols?.[c]) : rule.kind !== "none";
    };
    t.rows.forEach((row, r) => {
      const tr = this.grid.appendChild(document.createElement("tr"));
      row.forEach((cell, c) => {
        if (cell.hidden) return;
        const td = tr.appendChild(document.createElement("td"));
        td.dataset.r = String(r);
        td.dataset.c = String(c);
        if (cell.colSpan > 1) td.colSpan = cell.colSpan;
        if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
        const align = (cell.spec && /[lcr]/.exec(cell.spec)?.[0]) || t.aligns[c];
        td.className = `al-${align}`;
        if (lineUnder(r, c)) td.classList.add("rule-top");
        if (lineUnder(r + cell.rowSpan, c)) td.classList.add("rule-bottom");
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
    const many = rect && (rect.top !== rect.bottom || rect.left !== rect.right) && !this.single();
    for (const td of this.grid.querySelectorAll<HTMLTableCellElement>("td")) {
      const [r, c] = [Number(td.dataset.r), Number(td.dataset.c)];
      td.classList.toggle("sel", Boolean(many && rect && r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right));
      td.classList.toggle("cur", Boolean(this.head && this.head.r === r && this.head.c === c));
    }
    const t = this.table;
    const cur = this.head;
    const merged = Boolean(cur && isMerged(t, cur.r, cur.c));
    const off: Partial<Record<Action, boolean>> = {
      merge: !many,
      split: !cur || !merged || Boolean(many),
      splitColumns: !cur || merged || Boolean(many),
      splitRows: !cur || merged || Boolean(many),
      rowAbove: !cur,
      rowBelow: !cur,
      deleteRow: !cur || !rect || rect.bottom - rect.top + 1 >= t.rows.length,
      columnLeft: !cur,
      columnRight: !cur,
      deleteColumn: !cur || !rect || rect.right - rect.left + 1 >= t.aligns.length,
      alignLeft: !cur,
      alignCentre: !cur,
      alignRight: !cur,
    };
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>("button")) {
      const id = b.dataset.action as Action;
      b.disabled = Boolean(off[id]);
      if (id === "borders") b.setAttribute("aria-pressed", String(hasBorders(t)));
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
    const td = input.closest("td");
    const kept = this.table.rows[this.head.r]?.[this.head.c]?.tex ?? "";
    if (input.classList.contains("bad")) {
      store().notify(`“${input.value}” could not be put in the table as written, so the cell was left as it was. Check that its braces match.`, true);
    }
    if (td) {
      td.classList.remove("editing");
      this.draw(td, kept);
    }
    if (keepFocus) this.dom.focus({ preventScroll: true });
    this.view.requestMeasure();
  }

  private onType() {
    const input = this.input;
    const at = this.head;
    if (!input || !at) return;
    const escaped = escapeTyped(input.value);
    if (escaped !== input.value) {
      const caret = (input.selectionStart ?? 0) + (escaped.length - input.value.length);
      input.value = escaped;
      input.setSelectionRange(caret, caret);
    }
    this.fit();
    const next = setCell(this.table, at.r, at.c, input.value.trim());
    // What is typed must read back as this one cell, or it would break the table apart.
    const back = parseTable(writeTable(next));
    const sound = back.ok && same(back.table, next);
    input.classList.toggle("bad", !sound);
    input.title = sound ? "" : "This cannot go into the table yet. Check that its braces match and that it has no line break (\\\\) in it.";
    if (sound) this.commit(next, false);
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
    if (needsMultirow(next)) {
      const need = ensureMultirow(at.text);
      if (typeof need === "object") {
        changes.push(need);
        store().notify("Added \\usepackage{multirow} to the preamble. Cells merged down a column need it.");
      } else if (need === "no-preamble" && !this.warned) {
        this.warned = true;
        store().notify("Cells merged down a column need \\usepackage{multirow}. This file has no preamble, so add it to your main file's.", true);
      }
    }
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
    if (action === "source") {
      const at = this.place();
      if (!at) return;
      this.stopEditing(false);
      this.view.dispatch({ selection: { anchor: at.from + 1 } });
      this.view.focus();
      return;
    }
    if (action === "caption") {
      const at = this.place();
      if (!at) return;
      const to = at.from + this.source.length;
      const had = captionOf(at.text, at.from, to);
      const caption = await prompt("Table caption", had ?? "", "Save", "Shown under the table in the PDF. Leave it empty to remove the caption.");
      const again = this.place();
      if (caption === null || !again || again.from !== at.from || again.text !== at.text) return;
      const wanted = escapeTyped(caption.trim());
      if (!soundCaption(wanted)) return store().notify("That caption's braces do not match, so it was not changed.", true);
      const changes = setCaption(at.text, at.from, to, wanted);
      if (changes.length) this.view.dispatch({ changes, userEvent: "input.table", annotations: isolateHistory.of("full") });
      return;
    }
    if (action === "borders") return void this.act(toggleBorders(t), cur);
    if (!cur || !rect) return;
    const rows = Array.from({ length: rect.bottom - rect.top + 1 }, (_, i) => rect.bottom - i);
    const cols = Array.from({ length: rect.right - rect.left + 1 }, (_, i) => rect.right - i);
    const align = (a: Align) => this.act(setAlign(t, rect, a), cur);
    switch (action) {
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

  /** Make a change to the table's structure and leave one cell selected afterwards. */
  private act(next: Table, then: At | null) {
    this.stopEditing(false);
    this.anchor = this.head = then;
    if (!this.commit(next, true)) this.paintSelection();
    this.refocus();
  }

  /** Keep the keyboard where it was if that is a tool that can still be used; else the table. */
  private refocus() {
    const active = document.activeElement as HTMLButtonElement | null;
    if (active && this.bar.contains(active) && !active.disabled) return;
    this.dom.focus({ preventScroll: true });
  }

  // ---------- mouse ----------

  private cellOf(target: EventTarget | null): At | null {
    const td = (target as HTMLElement | null)?.closest?.("td");
    return td && this.grid.contains(td) ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : null;
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, .cm-v-tmenu")) return;
    const at = this.cellOf(e.target);
    e.preventDefault();
    this.closeMenu();
    if (!at) return;
    this.stopEditing(false);
    if (e.shiftKey && this.anchor) this.head = at;
    else this.anchor = this.head = at;
    this.dragging = true;
    this.paintSelection();
    const up = () => {
      window.removeEventListener("mouseup", up);
      this.dragging = false;
      if (this.single() && this.head) this.edit(this.head);
      else this.dom.focus({ preventScroll: true });
    };
    window.addEventListener("mouseup", up);
  }

  private onMouseOver(e: MouseEvent) {
    if (!this.dragging) return;
    const at = this.cellOf(e.target);
    if (!at || (this.head && at.r === this.head.r && at.c === this.head.c)) return;
    this.head = at;
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
    this.openMenu(e.clientX, e.clientY);
  }

  // ---------- the menu ----------

  private openMenu(x: number, y: number) {
    this.closeMenu();
    this.stopEditing(false);
    const menu = document.createElement("div");
    menu.className = "cm-v-tmenu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Table");
    for (const source of this.bar.querySelectorAll<HTMLButtonElement>("button")) {
      if (source.disabled) continue;
      const item = menu.appendChild(document.createElement("button"));
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.textContent = source.title;
      item.onclick = () => void this.run(source.dataset.action as Action);
    }
    menu.addEventListener("keydown", (e) => {
      const items = Array.from(menu.querySelectorAll("button"));
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        this.closeMenu();
        this.dom.focus({ preventScroll: true });
      } else if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
      else if (e.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
      else if (e.key === "Home") items[0]?.focus();
      else if (e.key === "End") items[items.length - 1]?.focus();
      else if (e.key !== "Tab") return;
      e.preventDefault();
      e.stopPropagation();
    });
    menu.addEventListener("focusout", (e) => {
      if (!menu.contains(e.relatedTarget as Node | null)) this.closeMenu();
    });
    this.dom.appendChild(menu);
    this.menu = menu;
    // Keep the whole menu on screen.
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
    menu.querySelector("button")?.focus({ preventScroll: true });
  }

  private closeMenu() {
    const menu = this.menu;
    this.menu = null;
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
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && !e.altKey && (key.toLowerCase() === "z" || key.toLowerCase() === "y")) {
      // Undo belongs to the document, not to the box being typed in.
      done();
      // Undo scrolls to the text cursor, which is not where the table is: stay here.
      const scroller = this.view.scrollDOM;
      const [top, left] = [scroller.scrollTop, scroller.scrollLeft];
      if (key.toLowerCase() === "y" || e.shiftKey) redo(this.view);
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
      }
      return;
    }
    if ((key === "F10" && e.shiftKey) || key === "ContextMenu") {
      done();
      const box = (this.head ? this.cellAt(this.head.r, this.head.c) : this.grid)?.getBoundingClientRect();
      if (box) this.openMenu(box.left + 8, box.bottom);
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
        this.paintSelection();
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
      if (!rect) return;
      let next = this.table;
      for (let r = rect.top; r <= rect.bottom; r++) for (let c = rect.left; c <= rect.right; c++) if (!next.rows[r][c].hidden && next.rows[r][c].tex) next = setCell(next, r, c, "");
      const [a, h] = [this.anchor, this.head];
      if (this.commit(next, true)) {
        this.anchor = a;
        this.head = h;
        this.paintSelection();
      }
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
    if (!table) return false;
    event.preventDefault();
    const size = `${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"} and ${table.aligns.length} ${table.aligns.length === 1 ? "column" : "columns"}`;
    void confirm("Paste as a table?", `The clipboard holds a table of ${size}. Cancel pastes it as plain text instead.`, "Paste as table").then((yes) => {
      const insert = yes ? `${writeTable(table)}\n` : plain;
      const pasted = view.state.replaceSelection(insert);
      // Cells that were merged downwards need the multirow package, here as anywhere.
      const need = yes && needsMultirow(table) ? ensureMultirow(view.state.doc.toString()) : "present";
      const main = view.state.selection.main;
      if (typeof need === "object" && (need.from <= main.from || need.from >= main.to)) {
        view.dispatch({ changes: [pasted.changes ?? [], need], userEvent: "input.paste", annotations: isolateHistory.of("full") });
        store().notify("Added \\usepackage{multirow} to the preamble. Cells merged down a column need it.");
      } else {
        view.dispatch(pasted, { userEvent: "input.paste", annotations: isolateHistory.of("full") });
        if (need === "no-preamble") store().notify("Cells merged down a column need \\usepackage{multirow}. This file has no preamble, so add it to your main file's.", true);
      }
      view.focus();
    });
    return true;
  },
});
