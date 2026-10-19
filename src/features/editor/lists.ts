// Lists as a word processor has them, written as itemize and enumerate: the Bullets and
// Numbering buttons, numbering formats (with enumitem), Tab and Shift+Tab for levels, Enter on
// an empty item to end the list, and Backspace at the start of an item to make it a paragraph.
// Pure: each function reads the text and gives the changes to make. Every list written has its
// \begin and \end on lines of their own and at least one \item, so it compiles and the page view
// hides those lines.
import { type Env, environments, lineAlone, lineEnd, lineStart, paragraphLines } from "./blocks";
import type { Need, TextChange } from "./formatting";

export type ListKind = "itemize" | "enumerate";

export interface ListEdit {
  changes: TextChange[];
  /** Where the cursor goes, in the text after the change; undefined to keep it where it was. */
  cursor?: number;
  /** Packages the list needs. */
  needs?: Need[];
}

/** The numbering formats offered, as enumitem's label option writes them. "" is LaTeX's own 1. 2. 3. */
export const NUMBER_FORMATS: { id: string; label: string; option: string }[] = [
  { id: "1.", label: "1. 2. 3.", option: "" },
  { id: "a)", label: "a) b) c)", option: "label=\\alph*)" },
  { id: "i.", label: "i. ii. iii.", option: "label=\\roman*." },
  { id: "A.", label: "A. B. C.", option: "label=\\Alph*." },
];

const LIST = /^(?:itemize|enumerate|description)$/;

interface Item {
  /** Where its \item is, and just past `\item ` (with a label in brackets, if any). */
  at: number;
  text: number;
  /** The start of its first line, and where it ends: the start of the next item's line, or of the list's \end line. */
  line: number;
  end: number;
}

interface List {
  env: Env;
  items: Item[];
  /** The list's \begin and \end lines, with their line breaks. */
  open: { from: number; to: number };
  close: { from: number; to: number };
  /** The list this one is nested in, if it is in an item of one. */
  outer: List | null;
}

/** The lists found last, for the text they were found in: the ribbon asks again at every cursor move. */
let found: { text: string; lists: List[] } | null = null;

/** The lists of the text that are written one thing to a line, as the page view draws them. */
function lists(text: string): List[] {
  if (found?.text !== text) found = { text, lists: readLists(text, environments(text)) };
  return found.lists;
}

function readLists(text: string, envs: Env[]): List[] {
  const out: List[] = [];
  const byEnv = new Map<Env, List>();
  for (const env of envs) {
    if (!LIST.test(env.name)) continue;
    const open = lineAlone(text, env.begin, env.head);
    const close = lineAlone(text, env.end, env.tail);
    if (!open || !close) continue;
    // The items of this list, not of lists inside it.
    const inner = envs.filter((e) => e !== env && e.begin > env.begin && e.tail <= env.end);
    const items: Item[] = [];
    let ok = true;
    // An item's words start where its bullet ends, as the page view draws it: a label in square
    // brackets, such as a description's term, is part of its words.
    for (const m of text.slice(env.head, env.end).matchAll(/\\item\b[ \t]?/g)) {
      const at = env.head + m.index;
      if (inner.some((e) => e.begin < at && at < e.tail) || /(?<!\\)%/.test(text.slice(lineStart(text, at), at))) continue;
      const line = lineStart(text, at);
      if (!/^[ \t]*$/.test(text.slice(line, at))) ok = false;
      items.push({ at, text: at + m[0].length, line, end: -1 });
    }
    if (!ok || !items.length) continue;
    items.forEach((item, i) => (item.end = i + 1 < items.length ? items[i + 1].line : close.from));
    const list: List = { env, items, open, close, outer: null };
    byEnv.set(env, list);
    out.push(list);
  }
  for (const list of out) {
    let parent = list.env.parent;
    while (parent && !LIST.test(parent.name)) parent = parent.parent;
    list.outer = parent ? (byEnv.get(parent) ?? null) : null;
  }
  return out;
}

/** The innermost list around `at`, and the item `at` is in. */
function itemAt(text: string, at: number): { list: List; index: number } | null {
  let best: { list: List; index: number } | null = null;
  for (const list of lists(text)) {
    const index = list.items.findIndex((item) => item.line <= at && at < Math.max(item.end, item.text + 1));
    if (index >= 0 && (!best || list.env.begin > best.list.env.begin)) best = { list, index };
  }
  return best;
}

const indentOf = (text: string, at: number) => /^[ \t]*/.exec(text.slice(lineStart(text, at)))![0];
const beginLine = (text: string, list: List) => text.slice(list.open.from, list.open.to);
const endLine = (text: string, list: List) => text.slice(list.close.from, list.close.to);

/** Add (or with a negative `by`, take away up to) `by` spaces at the start of every line from `from` to `to`. */
function reindent(text: string, from: number, to: number, by: number): TextChange[] {
  const out: TextChange[] = [];
  for (let at = from; at < to; at = lineEnd(text, at) + 1) {
    if (by > 0) out.push({ from: at, to: at, insert: " ".repeat(by) });
    else {
      const lead = /^[ \t]*/.exec(text.slice(at, lineEnd(text, at)))![0].length;
      if (lead) out.push({ from: at, to: at + Math.min(lead, -by), insert: "" });
    }
    if (lineEnd(text, at) >= text.length) break;
  }
  return out;
}

/** Marks where the cursor goes, in what a change inserts. */
const CURSOR = "\u0000";

/** `text` with `changes` made, all at once; changes at the same place in the order given. */
export function applyChanges(text: string, changes: TextChange[]): string {
  let out = "";
  let pos = 0;
  for (const c of changes.map((c, i) => ({ ...c, i })).sort((a, b) => a.from - b.from || a.i - b.i)) {
    out += text.slice(pos, c.from) + c.insert;
    pos = Math.max(pos, c.to);
  }
  return out + text.slice(pos);
}

/** The edit, with the cursor where CURSOR was put in what it inserts, and CURSOR taken out. */
function finish(text: string, changes: TextChange[], needs?: Need[]): ListEdit {
  const at = applyChanges(text, changes).indexOf(CURSOR);
  return { changes: changes.map((c) => ({ ...c, insert: c.insert.replace(CURSOR, "") })), ...(at >= 0 ? { cursor: at } : {}), ...(needs?.length ? { needs } : {}) };
}

/**
 * The items `first` to `last` of a list made paragraphs: the items before them stay a list, those
 * after start a new one of the same kind, and the paragraphs are set apart by blank lines.
 */
function itemsToParagraphs(text: string, list: List, first: number, last: number): ListEdit {
  const changes: TextChange[] = [];
  const indent = indentOf(text, list.env.begin);
  const { items } = list;
  if (first === 0) changes.push({ from: list.open.from, to: list.open.to, insert: "" });
  else changes.push({ from: items[first].line, to: items[first].line, insert: endLine(text, list) });
  for (let i = first; i <= last; i++) {
    const item = items[i];
    // `\item ` and the item's indentation go; a blank line sets each paragraph apart from the next.
    changes.push({ from: item.line, to: item.text, insert: i === first ? CURSOR : "" });
    changes.push(...reindent(text, lineEnd(text, item.text) + 1, item.end, -(item.at - item.line + 2)));
    if (i < last) changes.push({ from: item.end, to: item.end, insert: "\n" });
  }
  if (last === items.length - 1) changes.push({ from: list.close.from, to: list.close.to, insert: "" });
  else changes.push({ from: items[last].end, to: items[last].end, insert: `${indent}${beginLine(text, list).trimStart()}` });
  return finish(text, changes);
}

/**
 * The Bullets or Numbering button: the paragraphs of the selection made a list of that kind; in
 * a list of that kind, its selected items made paragraphs again; in a list of the other kind,
 * the list changed to this one. `format` is a numbering format's option (see NUMBER_FORMATS).
 */
export function toggleList(text: string, from: number, to: number, kind: ListKind, format?: string): ListEdit | null {
  const here = itemAt(text, from);
  if (here && here.list.env.end >= to) {
    const { list } = here;
    if (list.env.name === kind && (format === undefined || kind !== "enumerate")) {
      const last = list.items.reduce((at, item, i) => (item.line <= to ? i : at), here.index);
      return itemsToParagraphs(text, list, here.index, last);
    }
    return setListFormat(list, kind, format ?? "");
  }
  const lines = paragraphLines(text, from, to);
  if (!lines) return null;
  const block = text.slice(lines.from, lines.to);
  if (/\\begin\s*\{|\\end\s*\{|\\item\b/.test(block)) return null;
  const indent = /^[ \t]*/.exec(block)![0];
  // The cursor stays in the words it was in.
  const marked = text.slice(lines.from, from) + CURSOR + text.slice(from, lines.to);
  const paragraphs = marked.split(/\n[ \t]*\n(?:[ \t]*\n)*/).map((p) => p.split("\n").map((l) => l.trim()));
  const open = `${indent}\\begin{${kind}}${format ? `[${format}]` : ""}\n`;
  const body = paragraphs.map((lines) => `${indent}  \\item ${lines.join(`\n${indent}    `)}`.replace(/[ \t]+$/, " ")).join("\n");
  return finish(text, [{ from: lines.from, to: lines.to, insert: `${open}${body}\n${indent}\\end{${kind}}` }], needsFor(format));
}

function needsFor(format: string | undefined): Need[] {
  return format ? [{ kind: "package", name: "enumitem", why: "for the numbering format" }] : [];
}

/** A list made of `kind` with the numbering format `format` ("" for LaTeX's own). */
function setListFormat(list: List, kind: ListKind, format: string): ListEdit {
  // The list's other options, such as where its numbers start, are kept; a bulleted list has none.
  const others = kind === "enumerate" && list.env.name === "enumerate" ? list.env.options.split(",").filter((o) => o.trim() && !/^\s*label\s*=/.test(o)) : [];
  const options = [...(kind === "enumerate" && format ? [format] : []), ...others].join(",");
  const head = `\\begin{${kind}}${options ? `[${options}]` : ""}`;
  const changes = [
    { from: list.env.begin, to: list.env.head, insert: head },
    { from: list.env.end, to: list.env.tail, insert: `\\end{${kind}}` },
  ];
  return { changes, needs: kind === "enumerate" ? needsFor(format) : [] };
}

/** The numbering format of the numbered list at `at`, as one of NUMBER_FORMATS' ids; null when not in one. */
export function numberingAt(text: string, at: number): string | null {
  const here = itemAt(text, at);
  if (!here || here.list.env.name !== "enumerate") return null;
  const label = /(?:^|,)\s*label\s*=\s*([^,]*)/.exec(here.list.env.options)?.[1].trim() ?? "";
  return NUMBER_FORMATS.find((f) => f.option === (label ? `label=${label}` : ""))?.id ?? "custom";
}

/** The kind of list the cursor is in, if any. */
export function listAt(text: string, at: number): ListKind | "description" | null {
  return (itemAt(text, at)?.list.env.name as ListKind | "description" | undefined) ?? null;
}

/** A numbering format from the Numbering menu: for the list the cursor is in, or a new numbered list. */
export function setNumbering(text: string, from: number, to: number, formatId: string): ListEdit | null {
  const format = NUMBER_FORMATS.find((f) => f.id === formatId)?.option ?? "";
  const here = itemAt(text, from);
  if (here) return setListFormat(here.list, "enumerate", format);
  return toggleList(text, from, to, "enumerate", format);
}

/**
 * Tab in a list item: the item goes one level down, into a list inside the item above it, of
 * the same kind. The first item has none above it and stays. Null when not in a list item.
 */
export function indentItem(text: string, at: number): ListEdit | null {
  const here = itemAt(text, at);
  if (!here) return null;
  const { list, index } = here;
  if (index === 0) return { changes: [] };
  const item = list.items[index];
  const prev = list.items[index - 1];
  // A list of the same kind that the item above ends with takes it as its last item.
  const nested = lists(text).find((l) => l.outer?.env.begin === list.env.begin && l.env.name === list.env.name && l.close.to === item.line && l.env.begin > prev.at);
  if (nested) {
    const by = nested.items[0].at - nested.items[0].line - (item.at - item.line);
    return {
      changes: [{ from: nested.close.from, to: nested.close.to, insert: "" }, ...reindent(text, item.line, item.end, by), { from: item.end, to: item.end, insert: endLine(text, nested) }],
    };
  }
  const indent = indentOf(text, item.at);
  return {
    changes: [
      { from: item.line, to: item.line, insert: `${indent}  \\begin{${list.env.name}}\n` },
      ...reindent(text, item.line, item.end, 4),
      { from: item.end, to: item.end, insert: `${indent}  \\end{${list.env.name}}\n` },
    ],
  };
}

/**
 * Shift+Tab in a list item: the item goes one level up, after the item its list is in, taking
 * the items after it along as a list of its own. At the top level it stays, or, with
 * `toParagraph` (Backspace at its start), becomes a paragraph.
 */
export function outdentItem(text: string, at: number, toParagraph = false): ListEdit | null {
  const here = itemAt(text, at);
  if (!here) return null;
  const { list, index } = here;
  if (!list.outer) return toParagraph ? itemsToParagraphs(text, list, index, index) : { changes: [] };
  const item = list.items[index];
  const parentItem = list.outer.items.find((i) => i.at < list.env.begin && list.env.tail <= i.end);
  const by = parentItem ? item.at - item.line - (parentItem.at - parentItem.line) : 0;
  const changes: TextChange[] = [];
  if (index === 0) changes.push({ from: list.open.from, to: list.open.to, insert: "" });
  else changes.push({ from: item.line, to: item.line, insert: endLine(text, list) });
  changes.push(...reindent(text, item.line, item.end, -by));
  if (index === list.items.length - 1) changes.push({ from: list.close.from, to: list.close.to, insert: "" });
  else changes.push({ from: item.end, to: item.end, insert: beginLine(text, list) });
  return { changes };
}

/** Whether the cursor is at the very start of an item's words, just after its bullet. */
export function atItemStart(text: string, at: number): boolean {
  const here = itemAt(text, at);
  return Boolean(here && here.list.items[here.index].text === at);
}

/** Whether the item the cursor is in has no words. */
function emptyItem(text: string, here: { list: List; index: number }): boolean {
  const item = here.list.items[here.index];
  return text.slice(item.text, item.end).trim() === "";
}

/**
 * Enter in an empty item ends the list there, as in a word processor: the cursor goes to a new
 * paragraph after the list (or between its two halves); in a list inside another, the item goes
 * up a level instead. Null when the cursor is not in an empty item.
 */
export function enterInEmptyItem(text: string, at: number): ListEdit | null {
  const here = itemAt(text, at);
  if (!here || !emptyItem(text, here)) return null;
  const { list, index } = here;
  if (list.outer) return outdentItem(text, at);
  const item = list.items[index];
  const last = list.items.length - 1;
  // The new paragraph is set apart by a blank line from the text before and after it.
  const blankBefore = (pos: number) => pos === 0 || /\n[ \t]*\n$/.test(text.slice(Math.max(0, pos - 200), pos)) || /\\begin\{document\}[ \t]*\n?$/.test(text.slice(Math.max(0, pos - 40), pos));
  const blankAfter = (pos: number) => pos >= text.length || /^[ \t]*(?:\n|$)/.test(text.slice(pos)) || /^[ \t]*\\end\{document\}/.test(text.slice(pos));
  const paragraph = (before: number, after: number) => `${blankBefore(before) ? "" : "\n"}${CURSOR}\n${blankAfter(after) ? "" : "\n"}`;
  let changes: TextChange[];
  if (index === 0 && index === last) {
    // The only item: the list goes, and an empty paragraph takes its place.
    changes = [{ from: list.open.from, to: list.close.to, insert: paragraph(list.open.from, list.close.to) }];
  } else if (index === last) {
    // The last item: it goes, and a paragraph follows the list.
    changes = [
      { from: item.line, to: item.end, insert: "" },
      { from: list.close.to, to: list.close.to, insert: `\n${CURSOR}\n${blankAfter(list.close.to) ? "" : "\n"}` },
    ];
  } else if (index === 0) {
    // The first item: it goes, and a paragraph comes before the list.
    changes = [
      { from: list.open.from, to: list.open.from, insert: `${blankBefore(list.open.from) ? "" : "\n"}${CURSOR}\n\n` },
      { from: item.line, to: item.end, insert: "" },
    ];
  } else {
    // An item in the middle: the list is cut in two there, with a paragraph between.
    changes = [{ from: item.line, to: item.end, insert: `${endLine(text, list)}\n${CURSOR}\n\n${beginLine(text, list)}` }];
  }
  return finish(text, changes);
}

/**
 * Backspace at the start of an item's words: the item becomes a paragraph, or, in a list inside
 * another, goes up a level. Null when the cursor is not there.
 */
export function backspaceAtItemStart(text: string, at: number): ListEdit | null {
  if (!atItemStart(text, at)) return null;
  return outdentItem(text, at, true);
}
