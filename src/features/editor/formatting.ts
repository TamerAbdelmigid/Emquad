// Character formatting as a word processor has it, written as the LaTeX commands around the
// text: bold and the rest, strikethrough, sub- and superscript, small capitals, colour and
// highlight; clearing it, and copying it to other text with the format painter. Pure: each
// function reads the text and gives the changes to make.
//
// The text around a selection is read as runs of words, each with the formatting commands it
// sits in, and written out again with the selected runs' commands changed. So a selection that
// starts inside bold and ends outside it, or covers half of a coloured passage, comes out with
// every command whole and every brace matched; and nothing in the document is moved other than
// those commands.
import { type PackageNeed, ensurePackage, packageNotice, settingsLine } from "./tableModel";
import { documentStart } from "./visualModel";

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface Restyled {
  changes: TextChange[];
  /** The same text, selected, after the change. */
  select: { from: number; to: number };
  /** The commands written, for the packages they need. */
  heads: string[];
}

/** Commands that change only how text looks. Clear formatting takes them off. */
const LOOKS = [
  "textbf", "textit", "emph", "underline", "texttt", "textsc", "sout", "uline", "textsubscript", "textsuperscript",
  "hl", "textsf", "textrm", "textsl", "textup", "textmd", "textnormal",
];
/** The opening of one of them, colour included, as written: `\textbf{` or `\textcolor{name}{`. */
const HEAD = new RegExp(String.raw`\\(?:(?:${LOOKS.join("|")})|textcolor(?:\[[^\]{}\n]*\])?\{[A-Za-z0-9!.:+\-]*\})\{`, "y");
/** Commands that end a run of formatting: a group never reaches across them. */
const BARRIERS = new Set([
  "begin", "end", "item", "bibitem", "par", "part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph",
  "newpage", "clearpage", "pagebreak", "maketitle", "tableofcontents", "caption", "centering", "noindent",
]);
/** Environments whose body is text, read run by run. Any other is taken whole. */
const TEXT_ENVIRONMENTS = /^(?:itemize|enumerate|description|center|flushleft|flushright|quote|quotation|abstract|verse)$/;

/** The colours the ribbon offers. Each is named once, in the settings at the top, by `\definecolor`. */
export const COLOURS: { name: string; label: string; hex: string }[] = [
  { name: "darkred", label: "Dark red", hex: "C00000" },
  { name: "burntorange", label: "Orange", hex: "C55A11" },
  { name: "darkgreen", label: "Green", hex: "2E7D32" },
  { name: "royalblue", label: "Blue", hex: "2450F0" },
  { name: "darkpurple", label: "Purple", hex: "7030A0" },
  { name: "slategray", label: "Grey", hex: "595959" },
];

/** A piece of the text with the formatting commands it sits in, outermost first. */
interface Leaf {
  from: number;
  to: number;
  stack: string[];
  /** Words, which may be cut at a selection's ends; something taken whole; or something no group may reach across. */
  kind: "text" | "thing" | "barrier";
  /** Only spaces and line breaks. */
  space?: boolean;
}

/** Where a blank line, which ends a paragraph, starts at `at`, the length of it; else 0. */
function blankAt(text: string, at: number): number {
  const m = /\n(?:[ \t\r]*\n)+/y;
  m.lastIndex = at;
  return m.exec(text)?.[0].length ?? 0;
}

/**
 * Just past the brace that closes the one at `open`, before `limit`; -1 when it does not close
 * there or a paragraph ends first. Escaped characters and comments are stepped over.
 */
export function groupEnd(text: string, open: number, limit = text.length): number {
  let depth = 0;
  for (let i = open; i < limit; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "%") {
      const nl = text.indexOf("\n", i);
      if (nl < 0 || nl >= limit) return -1;
      i = nl - 1;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
    else if (c === "\n" && blankAt(text, i)) return -1;
  }
  return -1;
}

/** Just past the mathematics that starts with the `$` at `at`, or -1. */
function mathEnd(text: string, at: number, limit: number): number {
  const double = text.startsWith("$$", at);
  for (let i = at + (double ? 2 : 1); i < limit; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "\n" && blankAt(text, i)) return -1;
    else if (text[i] === "$") {
      if (!double) return i + 1;
      if (text[i + 1] === "$") return i + 2;
    }
  }
  return -1;
}

/** Just past the environment begun at `at`, to its matching \end, or -1. */
function environmentEnd(text: string, at: number, name: string, limit: number): number {
  const pattern = /\\(begin|end)\{([^}]*)\}/g;
  pattern.lastIndex = at;
  let depth = 0;
  for (let m = pattern.exec(text); m && m.index < limit; m = pattern.exec(text)) {
    if (m[2] !== name) continue;
    depth += m[1] === "begin" ? 1 : -1;
    if (depth === 0) return m.index + m[0].length <= limit ? m.index + m[0].length : -1;
  }
  return -1;
}

/** Just past a command that starts at `at` and the arguments written straight after it, or -1. */
function commandEnd(text: string, at: number, limit: number): number {
  const next = text[at + 1] ?? "";
  if (!/[a-zA-Z@]/.test(next)) {
    // \( … \) and \[ … \] are mathematics, taken whole; any other is one escaped character.
    if (next === "(" || next === "[") {
      const close = text.indexOf(next === "(" ? "\\)" : "\\]", at + 2);
      return close < 0 || close + 2 > limit ? -1 : close + 2;
    }
    return Math.min(at + 2, limit);
  }
  let j = at + 1;
  while (j < limit && /[a-zA-Z@]/.test(text[j])) j++;
  const name = text.slice(at + 1, j);
  if (text[j] === "*") j++;
  if (name === "verb" || name === "lstinline") {
    const close = text.indexOf(text[j], j + 1);
    return close < 0 || close >= limit ? -1 : close + 1;
  }
  for (;;) {
    let k = j;
    while (k < limit && (text[k] === " " || text[k] === "\t")) k++;
    if (text[k] === "{") {
      const end = groupEnd(text, k, limit);
      if (end < 0) return -1;
      j = end;
    } else if (text[k] === "[") {
      let depth = 0;
      let end = -1;
      for (let i = k; i < limit && end < 0; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        else if (text[i] === "]" && depth === 0) end = i + 1;
        else if (text[i] === "\n" && blankAt(text, i)) break;
      }
      if (end < 0) return -1;
      j = end;
    } else break;
  }
  if (name === "begin") {
    const env = /^\\begin\{([^}]*)\}/.exec(text.slice(at, j))?.[1] ?? "";
    // An environment whose body is not text (a formula, a table, a picture) is taken whole.
    if (!TEXT_ENVIRONMENTS.test(env)) return environmentEnd(text, at, env, limit);
  }
  return j;
}

/**
 * The text from `from` to `to` as leaves, each with the commands it is in. Formatting groups
 * found are noted in `groups`. False when a brace, a formula or an environment does not close
 * inside the stretch, so that it cannot be written out again safely.
 */
function read(text: string, from: number, to: number, stack: string[], out: Leaf[], groups: { from: number; to: number; depth: number }[]): boolean {
  let run = -1;
  const flush = (at: number) => {
    if (run >= 0 && at > run) out.push({ from: run, to: at, stack, kind: "text" });
    run = -1;
  };
  const piece = (a: number, b: number, kind: Leaf["kind"]) => {
    flush(a);
    out.push({ from: a, to: b, stack, kind });
  };
  for (let i = from; i < to; ) {
    const c = text[i];
    if (c === "\\") {
      HEAD.lastIndex = i;
      const head = HEAD.exec(text);
      const open = head ? i + head[0].length - 1 : -1;
      const close = head ? groupEnd(text, open, to) : -1;
      if (head && close > 0) {
        flush(i);
        groups.push({ from: i, to: close, depth: stack.length });
        if (!read(text, open + 1, close - 1, [...stack, head[0]], out, groups)) return false;
        i = close;
        continue;
      }
      const end = commandEnd(text, i, to);
      if (end < 0) return false;
      const name = /^\\([a-zA-Z@]+)/.exec(text.slice(i, i + 30))?.[1] ?? "";
      // Verbatim text cannot be in a command's argument: no group may reach across it.
      piece(i, end, BARRIERS.has(name) || name === "verb" || name === "lstinline" || end - i > 2000 ? "barrier" : "thing");
      i = end;
    } else if (c === "%") {
      // A comment with its line break: a brace written after it would be part of it.
      const nl = text.indexOf("\n", i);
      const end = nl < 0 || nl >= to ? to : nl + 1;
      piece(i, end, "barrier");
      i = end;
    } else if (c === "$") {
      const end = mathEnd(text, i, to);
      if (end < 0) return false;
      piece(i, end, "thing");
      i = end;
    } else if (c === "{") {
      const end = groupEnd(text, i, to);
      if (end < 0) return false;
      piece(i, end, "thing");
      i = end;
    } else if (c === "}") {
      return false;
    } else if (c === "\n" && blankAt(text, i)) {
      const end = i + blankAt(text, i);
      piece(i, end, "barrier");
      i = end;
    } else {
      if (run < 0) run = i;
      i++;
    }
  }
  flush(to);
  return true;
}

/** Where the paragraph holding `at` begins and, for `end`, where it ends: at a blank line, or the document's start or end. */
function paragraphBounds(text: string, from: number, to: number): { from: number; to: number } {
  const begin = documentStart(text);
  const floor = begin < 0 ? 0 : begin + "\\begin{document}".length;
  let start = Math.max(floor, Math.min(from, text.length));
  while (start > floor) {
    const nl = text.lastIndexOf("\n", start - 1);
    if (nl < floor) {
      start = floor;
      break;
    }
    const before = text.lastIndexOf("\n", nl - 1);
    if (/^[ \t\r]*$/.test(text.slice(before + 1, nl))) {
      start = nl + 1;
      break;
    }
    start = nl;
  }
  const docEnd = text.indexOf("\\end{document}", Math.max(to, floor));
  const ceiling = docEnd < 0 ? text.length : docEnd;
  const blank = /\n[ \t\r]*\n/g;
  blank.lastIndex = Math.max(to, start);
  const m = blank.exec(text);
  return { from: start, to: m && m.index < ceiling ? m.index : ceiling };
}

/**
 * The stretch to read for a selection: its paragraphs, or, when the selection is inside the
 * argument of a command (a footnote, a heading), that argument. Null where the text cannot be
 * formatted, such as inside a formula.
 */
function container(text: string, from: number, to: number): { from: number; to: number } | null {
  let box = paragraphBounds(text, from, to);
  for (let tries = 0; tries < 20; tries++) {
    const leaves: Leaf[] = [];
    if (!read(text, box.from, box.to, [], leaves, [])) return null;
    const around = leaves.find((l) => l.kind !== "text" && l.from < from && to < l.to);
    if (!around) return box;
    // Inside something taken whole: into the braces of it that hold the selection.
    let inner: { from: number; to: number } | null = null;
    for (let i = around.from; i < around.to; i++) {
      if (text[i] === "\\") {
        i++;
        continue;
      }
      if (text[i] !== "{") continue;
      const end = groupEnd(text, i, around.to);
      if (end < 0) return null;
      if (i < from && to < end) {
        inner = { from: i + 1, to: end - 1 };
        break;
      }
      i = end - 1;
    }
    if (!inner || text[around.from] === "$" || /^\\[([]/.test(text.slice(around.from, around.from + 2))) return null;
    box = inner;
  }
  return null;
}

/**
 * Change the formatting of the text from `from` to `to`: `change` is given the commands each
 * selected piece is in and returns the ones it should be in. Null where the text cannot be
 * formatted, such as inside a formula, or across a brace that does not close.
 */
export function restyle(text: string, from: number, to: number, change: (stack: string[]) => string[]): Restyled | null {
  if (from >= to) return null;
  const box = container(text, from, to);
  if (!box) return null;
  from = Math.max(from, box.from);
  to = Math.min(to, box.to);
  if (from >= to) return null;
  const leaves: Leaf[] = [];
  const groups: { from: number; to: number; depth: number }[] = [];
  if (!read(text, box.from, box.to, [], leaves, groups)) return null;
  // The stretch written again: the selection, widened to the outermost groups and the things
  // taken whole that its ends fall inside.
  let [r0, r1] = [from, to];
  const spans = [...groups.filter((g) => g.depth === 0), ...leaves.filter((l) => l.kind !== "text")];
  for (let widened = true; widened; ) {
    widened = false;
    for (const s of spans) {
      if (s.from < r0 && r0 < s.to) [r0, widened] = [s.from, true];
      if (s.from < r1 && r1 < s.to) [r1, widened] = [s.to, true];
    }
  }
  // The leaves of that stretch, words cut at the selection's ends.
  const pieces: Leaf[] = [];
  for (const l of leaves) {
    if (l.to <= r0 || l.from >= r1) continue;
    if (l.kind !== "text") {
      pieces.push(l);
      continue;
    }
    // Cut at the selection's ends, and the spaces and line breaks at the ends of each piece apart.
    const cuts = [l.from, ...[r0, from, to, r1].filter((c) => c > l.from && c < l.to), l.to];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [a, b] = [cuts[i], cuts[i + 1]];
      if (a < r0 || b > r1) continue;
      const lead = /^\s*/.exec(text.slice(a, b))![0].length;
      const trail = lead === b - a ? 0 : /\s*$/.exec(text.slice(a, b))![0].length;
      for (const [x, y, ws] of [[a, a + lead, true], [a + lead, b - trail, false], [b - trail, b, true]] as const) {
        if (y > x) pieces.push({ ...l, from: x, to: y, ...(ws ? { space: true } : {}) });
      }
    }
  }
  const selected = (l: Leaf) => l.from >= from && l.to <= to && l.kind !== "barrier";
  // Only the commands that change looks are changed; any other a piece is in is kept.
  const wanted = pieces.map((l) => (l.kind === "barrier" ? [] : selected(l) ? change(l.stack) : l.stack));
  // Spaces at the edge of formatting stay outside it: in only the commands on both sides of them.
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (!pieces[i].space) continue;
    const next = wanted.slice(i + 1).find((_, j) => !pieces[i + 1 + j].space) ?? [];
    const prev = [...wanted.slice(0, i)].reverse().find((_, j) => !pieces[i - 1 - j].space) ?? [];
    let common = 0;
    while (common < next.length && common < prev.length && next[common] === prev[common]) common++;
    wanted[i] = next.slice(0, common);
  }
  let out = "";
  let open: string[] = [];
  let selFrom = -1;
  let selTo = -1;
  const heads = new Set<string>();
  pieces.forEach((l, i) => {
    const want = wanted[i];
    let common = 0;
    while (common < open.length && common < want.length && open[common] === want[common]) common++;
    out += "}".repeat(open.length - common) + want.slice(common).join("");
    for (const h of want.slice(common)) heads.add(h);
    open = want;
    if (selFrom < 0 && l.from >= from) selFrom = out.length;
    out += text.slice(l.from, l.to);
    if (l.to <= to) selTo = out.length;
  });
  out += "}".repeat(open.length);
  const before = text.slice(r0, r1);
  const changes: TextChange[] = [];
  if (out !== before) {
    let start = 0;
    while (start < before.length && start < out.length && before[start] === out[start]) start++;
    let end = 0;
    while (end < before.length - start && end < out.length - start && before[before.length - 1 - end] === out[out.length - 1 - end]) end++;
    changes.push({ from: r0 + start, to: r1 - end, insert: out.slice(start, out.length - end) });
  }
  return {
    changes,
    select: { from: r0 + Math.max(0, selFrom), to: r0 + Math.max(selFrom, selTo) },
    heads: [...heads],
  };
}

/**
 * Whether the selected text can simply be put in a command's braces, where it cannot be read as
 * runs of text (in the settings at the top, say, inside \title): on one line, its braces
 * matched, with no comment, verbatim, environment or list item in it.
 */
export function plainWrapSafe(text: string, from: number, to: number): boolean {
  const selected = text.slice(from, to);
  if (selected.includes("\n") || /(?<!\\)%|\\(?:begin|end|item|verb|lstinline|par)(?![a-zA-Z])/.test(selected)) return false;
  let depth = 0;
  for (let i = 0; i < selected.length; i++) {
    if (selected[i] === "\\") i++;
    else if (selected[i] === "{") depth++;
    else if (selected[i] === "}" && --depth < 0) return false;
  }
  return depth === 0 && (selected.split("$").length - 1 - (selected.split("\\$").length - 1)) % 2 === 0;
}

/** The opening a tool writes: `\textbf{`, or `\textcolor{name}{` for a colour. */
export const headOf = (name: string) => `\\${name}{`;
const isColour = (head: string) => head.startsWith("\\textcolor");
/** Formats that exclude one another: text is raised or lowered, not both. */
const RIVALS: Record<string, string[]> = {
  textsubscript: ["textsuperscript"],
  textsuperscript: ["textsubscript"],
};

/** Whether every word of the selection is set in `head` already. */
function allIn(text: string, from: number, to: number, head: string): boolean {
  const box = container(text, from, to);
  if (!box) return false;
  const leaves: Leaf[] = [];
  if (!read(text, box.from, box.to, [], leaves, [])) return false;
  const words = leaves.filter((l) => l.kind === "text" && l.to > from && l.from < to && text.slice(Math.max(l.from, from), Math.min(l.to, to)).trim());
  return words.length > 0 && words.every((l) => l.stack.includes(head));
}

/**
 * A character format from a tool, on a selection, as Word applies it: when every word selected
 * has it already, it is taken off them all; otherwise it is put on all of them. Sub- and
 * superscript take each other's place.
 */
export function toggleFormat(text: string, from: number, to: number, name: string): Restyled | null {
  const head = headOf(name);
  const off = allIn(text, from, to, head);
  const rivals = (RIVALS[name] ?? []).map(headOf);
  return restyle(text, from, to, (stack) => (off ? stack.filter((h) => h !== head) : stack.includes(head) ? stack : [...stack.filter((h) => !rivals.includes(h)), head]));
}

/** Set the selection in a colour from the palette, in place of any colour it had; null takes the colour off. */
export function setColour(text: string, from: number, to: number, colour: string | null): Restyled | null {
  return restyle(text, from, to, (stack) => [...stack.filter((h) => !isColour(h)), ...(colour ? [`\\textcolor{${colour}}{`] : [])]);
}

/** Take every formatting command off the selection, leaving its words. */
export function clearFormatting(text: string, from: number, to: number): Restyled | null {
  return restyle(text, from, to, () => []);
}

/** The formatting commands the text at `at` is in, outermost first: what the format painter copies. */
export function formatAt(text: string, at: number): string[] {
  const box = container(text, at, at);
  if (!box) return [];
  const leaves: Leaf[] = [];
  if (!read(text, box.from, box.to, [], leaves, [])) return [];
  // As in Word, the formatting of the letter before the cursor, or of the one after at a start.
  const left = leaves.find((l) => l.kind === "text" && l.from < at && at <= l.to);
  const right = leaves.find((l) => l.kind === "text" && l.from <= at && at < l.to);
  return (left ?? right)?.stack ?? [];
}

/** Put the formatting `heads` (from `formatAt`) on the selection, in place of what it had. */
export function paintFormat(text: string, from: number, to: number, heads: string[]): Restyled | null {
  return restyle(text, from, to, () => heads);
}

/** The word around `at`, for a tool used with nothing selected; null when the cursor is not in one. */
export function wordAt(text: string, at: number): { from: number; to: number } | null {
  const letter = /[\p{L}\p{N}'’-]/u;
  let [from, to] = [at, at];
  while (from > 0 && letter.test(text[from - 1])) from--;
  while (to < text.length && letter.test(text[to])) to++;
  // A command's name is not a word.
  if (from > 0 && text[from - 1] === "\\") return null;
  return from < at && at < to ? { from, to } : null;
}

// ---------- what the commands need in the settings at the top ----------

export type Need = { kind: "package"; name: string; options?: string; why: string } | { kind: "colour"; name: string; hex: string };

/** The packages and colour names that the commands `heads` need. */
export function needsOf(heads: string[]): Need[] {
  const out: Need[] = [];
  const add = (n: Need) => {
    if (!out.some((o) => o.kind === n.kind && o.name === n.name)) out.push(n);
  };
  for (const head of heads) {
    if (head === "\\sout{" || head === "\\uline{") add({ kind: "package", name: "ulem", options: "normalem", why: "for strikethrough" });
    if (head === "\\hl{") {
      add({ kind: "package", name: "xcolor", why: "for highlighting" });
      add({ kind: "package", name: "soul", why: "for highlighting" });
    }
    const colour = /^\\textcolor\{([^}]*)\}\{$/.exec(head)?.[1];
    if (colour !== undefined) {
      add({ kind: "package", name: "xcolor", why: "for coloured text" });
      const known = COLOURS.find((c) => c.name === colour);
      if (known) add({ kind: "colour", name: known.name, hex: known.hex });
    }
  }
  // Colour names after the package that defines them.
  return [...out.filter((n) => n.kind === "package"), ...out.filter((n) => n.kind === "colour")];
}

/**
 * The change to the settings at the top of `text` that gives it what `needs` lists: package lines
 * and colour names, on lines of their own just before the document begins. `notes` says what was
 * added, and what could not be and why.
 */
export function preambleFor(text: string, needs: Need[], styles: Record<string, string[]> = {}): { change: TextChange | null; added: string[]; notes: string[] } {
  const added: string[] = [];
  const notes: string[] = [];
  let at = -1;
  let insert = "";
  let lead = "";
  const put = (change: { from: number; insert: string }) => {
    // Every line goes in at the same place; a line break before the first is kept, once.
    const line = change.insert.replace(/^\r?\n/, "");
    if (at < 0) {
      at = change.from;
      lead = change.insert.slice(0, change.insert.length - line.length);
    }
    insert += line;
  };
  let xcolor: PackageNeed | null = null;
  for (const need of needs) {
    if (need.kind === "package") {
      const result = ensurePackage(text, need.name, styles, need.options);
      if (need.name === "xcolor") xcolor = result;
      if (typeof result === "object") {
        put(result);
        added.push(`\\usepackage${need.options ? `[${need.options}]` : ""}{${need.name}}`);
      } else if (result !== "present") notes.push(packageNotice(need.name, result)!);
    } else {
      // Named only where the package that names colours is, or is being, loaded.
      if (xcolor === null || (typeof xcolor !== "object" && xcolor !== "present")) continue;
      const begin = documentStart(text);
      const preamble = text.slice(0, begin).replace(/(?<!\\)%[^\n]*/g, "");
      if (new RegExp(String.raw`\\(?:definecolor|colorlet)\s*\{${need.name}\}`).test(preamble)) continue;
      const line = `\\definecolor{${need.name}}{HTML}{${need.hex}}`;
      put(settingsLine(text, line, begin));
      added.push(line);
    }
  }
  return { change: at < 0 ? null : { from: at, to: at, insert: lead + insert }, added, notes };
}
