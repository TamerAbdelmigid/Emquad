// References as Word makes them: a cross-reference picked from a list of every place with a
// label, a link, a bookmark, and moving a section, everything under it included, as dragging a
// heading in Word's Navigation pane does. Pure: each function reads the text and gives what to
// write.
import type { LabelPlace } from "../../ipc/bindings/LabelPlace";
import type { Numbered } from "../../ipc/bindings/Numbered";
import { environments } from "./blocks";
import { type TextChange, plainWrapSafe } from "./formatting";
import { outline } from "./latex";
import { ensurePackage, escapeTex } from "./tableModel";
import { documentStart } from "./visualModel";

export interface PickerItem {
  key: string;
  /** As the list shows it: "Figure 2: The map of wells". */
  text: string;
  file: string;
  line: number;
}

/** The kinds of place, in the order Word's Cross-reference dialog offers them. */
const GROUPS: { name: string; kinds: string[]; text: (n: string, caption: string, key: string) => string }[] = [
  { name: "Headings", kinds: ["part", "chapter", "section"], text: (n, c) => [n, c].filter(Boolean).join(" ") },
  { name: "Figures", kinds: ["figure"], text: (n, c) => `Figure ${n || "?"}${c ? `: ${c}` : ""}` },
  { name: "Tables", kinds: ["table"], text: (n, c) => `Table ${n || "?"}${c ? `: ${c}` : ""}` },
  { name: "Equations", kinds: ["equation"], text: (n) => `Equation (${n || "?"})` },
  { name: "Numbered items", kinds: ["item"], text: (n) => `Item ${n || "?"}` },
  { name: "Other places", kinds: [""], text: (n, _c, key) => (n ? `${key} (${n})` : key) },
];

/** Every label, by kind, each with the number the last compile gave it and its caption. */
export function labelGroups(places: LabelPlace[], numbers: Record<string, Numbered | undefined>): { name: string; items: PickerItem[] }[] {
  const sorted = [...places].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return GROUPS.map((g) => ({
    name: g.name,
    items: sorted
      .filter((p) => g.kinds.includes(GROUPS.some((o) => o.kinds.includes(p.kind)) ? p.kind : ""))
      .map((p) => ({ key: p.key, text: g.text(numbers[p.key]?.number ?? "", p.caption, p.key), file: p.file, line: p.line })),
  })).filter((g) => g.items.length);
}

/**
 * The LaTeX for a cross-reference: "Figure 2" (\Cref, with cleveref, which names what it points
 * to), "2" (\ref), or "page 3" (\pageref). The number follows the thing if it moves.
 */
export function crossReference(key: string, as: "named" | "number" | "page"): { tex: string; packages: string[] } {
  if (as === "named") return { tex: `\\Cref{${key}}`, packages: ["cleveref"] };
  return { tex: `\\${as === "page" ? "pageref" : "ref"}{${key}}`, packages: [] };
}

/**
 * A link: the address, with what \href reads specially escaped (braces and backslashes written
 * as the address's own escapes, %7B and the like), and the words shown; null without an address.
 */
export function linkFor(address: string, words: string): string | null {
  const url = address
    .trim()
    .replace(/[{}\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/[%#]/g, "\\$&");
  if (!url) return null;
  return words.trim() ? `\\href{${url}}{${escapeTex(words)}}` : `\\url{${url}}`;
}

/**
 * Why a link cannot go around the stretch from `from` to `to`, or null when it can: it must be in
 * the document's text, and be words a command's braces can hold (on one line, not cutting a
 * command, a formula or an environment in two).
 */
export function linkProblem(text: string, from: number, to: number): string | null {
  const begin = documentStart(text);
  // A file brought in with \input has no settings of its own: all of it is text.
  if (begin >= 0 && from < begin + "\\begin{document}".length) return "A link goes in the document's text, not in the settings at the top.";
  if (!plainWrapSafe(text, from, to)) return "A link cannot go around this: select words on one line, not cutting a formatting command, a formula or a list in two.";
  return null;
}

/**
 * The change that loads hyperref, which links need: just before cleveref when that is loaded,
 * since cleveref must come after it, else at the end of the settings. Null when it is loaded
 * already or the settings cannot be read.
 */
export function hyperrefChange(text: string): TextChange | null {
  const found = ensurePackage(text, "hyperref");
  if (typeof found !== "object") return null;
  const code = text.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));
  const cleveref = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bcleveref\b[^}]*\}/.exec(code.slice(0, Math.max(0, code.indexOf("\\begin{document}"))));
  if (cleveref) return { from: cleveref.index, to: cleveref.index, insert: `\\usepackage{hyperref}${text.includes("\r\n") ? "\r\n" : "\n"}` };
  return { from: found.from, to: found.to ?? found.from, insert: found.insert };
}

/** Why a bookmark cannot have this name, or null when it can. */
export function bookmarkProblem(name: string, taken: string[]): string | null {
  if (!name.trim()) return "Give the bookmark a name.";
  if (!/^[A-Za-z0-9:._-]+$/.test(name)) return "A bookmark's name holds letters, digits and : . _ - only, with no spaces.";
  if (taken.includes(name)) return `There is already a bookmark or label called ${name}.`;
  return null;
}

/** Lines that end the last section: what follows them is not part of it. */
const ENDS =
  /^[ \t]*\\(?:appendix|backmatter|bibliographystyle|bibliography|printbibliography|printindex|listoffigures|listoftables|end\{document\}|begin\{thebibliography\})(?![a-zA-Z])/;
const HEADING = /\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/;

/** Where line `line` (1-based) starts. */
const lineFrom = (text: string, line: number) => {
  let at = 0;
  for (let n = 1; n < line && at >= 0; n++) at = text.indexOf("\n", at) + 1 || -1;
  return at < 0 ? text.length : at;
};

/** Where the heading on line `line` begins: its line, or its command when other text comes before it there. */
function headingFrom(text: string, line: number): number {
  const from = lineFrom(text, line);
  const end = text.indexOf("\n", from) < 0 ? text.length : text.indexOf("\n", from);
  const m = HEADING.exec(text.slice(from, end).replace(/(?<!\\)%.*$/, ""));
  return m && text.slice(from, from + m.index).trim() ? from + m.index : from;
}

/**
 * The stretch the heading on line `line` heads: from the heading to the next heading of its
 * level or above, or to what ends the last section (the appendix, the bibliography and its
 * style, an index or a list of figures, the end of the document), or to the end of an
 * environment the heading is in. Null when there is no heading on that line.
 */
export function sectionAt(text: string, line: number): { from: number; to: number; level: number } | null {
  const items = outline(text);
  const i = items.findIndex((o) => o.line === line);
  if (i < 0) return null;
  const level = items[i].level;
  const from = headingFrom(text, line);
  const next = items.slice(i + 1).find((o) => o.level <= level);
  let to = next ? headingFrom(text, next.line) : text.length;
  // What ends the last section, before the next heading.
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lines = text.slice(lineStart, to).split("\n");
  let at = lineStart;
  for (let n = 0; n < lines.length; n++) {
    if (n > 0 && ENDS.test(lines[n])) {
      to = at;
      break;
    }
    at += lines[n].length + 1;
  }
  // The end of an environment the heading is in: its line, or the \end itself when text comes before it there.
  for (const env of environments(text)) {
    if (env.name === "document" || env.begin >= from || env.end < from || env.end >= to) continue;
    const start = text.lastIndexOf("\n", env.end - 1) + 1;
    to = text.slice(start, env.end).trim() ? env.end : start;
  }
  return { from, to: Math.max(from, to), level };
}

/** Whether a line that ends the last section stands between `from` and `to`. */
function crossesEnd(text: string, from: number, to: number): boolean {
  return text
    .slice(from, to)
    .split("\n")
    .some((l, n) => (n > 0 || from === 0 || text[from - 1] === "\n") && ENDS.test(l));
}

/** The changes that take the section out and put it in at `at`, on lines of its own. */
function placeSection(text: string, section: { from: number; to: number }, at: number): TextChange[] | null {
  if (at >= section.from && at <= section.to) return null;
  // An environment begun in the section and ended after it would be left with its \end first.
  if (environments(text).some((e) => e.begin >= section.from && e.begin < section.to && e.tail > section.to)) return null;
  let block = text.slice(section.from, section.to);
  if (!block.endsWith("\n")) block += "\n";
  // At the very end of a text whose last line has no line break, the heading starts a line.
  if (at === text.length && at > 0 && text[at - 1] !== "\n") block = `\n${block}`;
  return [
    { from: section.from, to: section.to, insert: "" },
    { from: at, to: at, insert: block },
  ];
}

/**
 * Move the section headed on line `from`, with everything under it, to just before the heading
 * on line `before`, or after the last section when `before` is null. Null when there is nothing
 * to move or it would land in itself or where it is.
 */
export function moveSection(text: string, from: number, before: number | null): TextChange[] | null {
  const section = sectionAt(text, from);
  if (!section) return null;
  let at: number;
  if (before === null) {
    const items = outline(text);
    const last = items.length ? sectionAt(text, items[items.length - 1].line) : null;
    if (!last) return null;
    at = last.to;
  } else {
    if (!outline(text).some((o) => o.line === before)) return null;
    at = headingFrom(text, before);
  }
  return placeSection(text, section, at);
}

/**
 * Move the section headed on line `line` one step up (-1) or down (1) among the headings of its
 * level under the same heading, as Alt+Shift+Up and Down do; never past the appendix or the
 * bibliography. Null when it cannot go that way.
 */
export function stepSection(text: string, line: number, by: -1 | 1): TextChange[] | null {
  const items = outline(text);
  const i = items.findIndex((o) => o.line === line);
  const section = sectionAt(text, line);
  if (i < 0 || !section) return null;
  const level = items[i].level;
  if (by < 0) {
    const before = [...items.slice(0, i)].reverse().find((o) => o.level <= level);
    if (!before || before.level !== level) return null;
    const at = sectionAt(text, before.line)!.from;
    return crossesEnd(text, at, section.from) ? null : placeSection(text, section, at);
  }
  const sibling = items.find((o, j) => j > i && o.level <= level);
  if (!sibling || sibling.level !== level) return null;
  const next = sectionAt(text, sibling.line)!;
  return crossesEnd(text, section.to, next.from) ? null : placeSection(text, section, next.to);
}

/** The line of the heading titled `title`, at `line` or else the nearest to it; null when there is none. */
export function headingLine(text: string, line: number, title: string): number | null {
  const items = outline(text).filter((o) => o.title === title);
  if (!items.length) return null;
  return items.reduce((a, b) => (Math.abs(b.line - line) < Math.abs(a.line - line) ? b : a)).line;
}
