// Paragraph formatting as a word processor has it, written as the LaTeX environment around the
// paragraphs: alignment (center, flushleft, flushright; justified is LaTeX's own and writes
// nothing) and the styles that are environments (quote, abstract). Pure: each function reads the
// text and gives the changes to make. The environments it writes are on lines of their own, so
// the page view hides them as it hides a list's.
import type { TextChange } from "./formatting";
import { documentStart } from "./visualModel";

export interface Env {
  name: string;
  /** What is in the square brackets after \begin{name}, if anything. */
  options: string;
  /** Where \begin is, and just past it and its options. */
  begin: number;
  head: number;
  /** Where \end is, and just past it. */
  end: number;
  tail: number;
  parent: Env | null;
}

/** Environments whose body is taken as written: nothing inside is a command. */
const VERBATIM = /^(?:verbatim\*?|Verbatim|BVerbatim|lstlisting|minted|alltt|comment)$/;
/** Environments that hold paragraphs of text, which the tools here may act inside. */
const TEXT = /^(?:document|center|flushleft|flushright|quote|quotation|abstract|itemize|enumerate|description|minipage|verse)$/;
const LISTS = /^(?:itemize|enumerate|description)$/;
export const ALIGNMENTS: Record<string, "center" | "left" | "right"> = { center: "center", flushleft: "left", flushright: "right" };
const ALIGN_ENV = { center: "center", left: "flushleft", right: "flushright" } as const;
export type Alignment = "left" | "center" | "right" | "justify";
export type BlockStyle = "quote" | "abstract";
const STYLE_ENVS = /^(?:quote|quotation|abstract)$/;

/** The text with comments blanked out, every offset kept. */
export function uncommented(text: string): string {
  return text.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));
}

/** The environments found last, for the text they were found in: the ribbon asks again at every cursor move. */
let found: { text: string; envs: Env[] } | null = null;

/** Every environment in the text that is begun and ended, in the order they begin. */
export function environments(text: string): Env[] {
  if (found?.text !== text) found = { text, envs: readEnvironments(text) };
  return found.envs;
}

/**
 * Whether the braces from `from` to `to` all close inside it, none closing what was opened
 * before: what whole lines need before an environment can go around them. Escaped braces,
 * comments and verbatim text do not count.
 */
export function bracesBalanced(text: string, from: number, to: number): boolean {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const c = text[i];
    if (c === "\\") {
      const verb = /^\\(?:verb|lstinline)\*?([^a-zA-Z\s*])/.exec(text.slice(i, i + 12));
      if (verb) {
        const close = text.indexOf(verb[1], i + verb[0].length);
        if (close < 0 || close >= to) return false;
        i = close;
      } else i++;
    } else if (c === "%") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? to : nl;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

function readEnvironments(text: string): Env[] {
  const code = uncommented(text);
  const out: Env[] = [];
  const open: Env[] = [];
  const pattern = /\\(begin|end)\s*\{([^}\n]*)\}/g;
  for (let m = pattern.exec(code); m; m = pattern.exec(code)) {
    const name = m[2].trim();
    if (m[1] === "begin") {
      const after = m.index + m[0].length;
      const options = /^\[([^\]\n]*)\]/.exec(code.slice(after, after + 300));
      const env: Env = { name, options: options?.[1] ?? "", begin: m.index, head: after + (options?.[0].length ?? 0), end: -1, tail: -1, parent: open[open.length - 1] ?? null };
      open.push(env);
      // Nothing inside verbatim is a command: on to its end.
      if (VERBATIM.test(name)) {
        const close = code.indexOf(`\\end{${name}}`, after);
        if (close < 0) break;
        pattern.lastIndex = close;
      }
    } else {
      const at = open.map((e) => e.name).lastIndexOf(name);
      if (at < 0) continue;
      const env = open[at];
      open.length = at;
      env.end = m.index;
      env.tail = m.index + m[0].length;
      out.push(env);
    }
  }
  return out.sort((a, b) => a.begin - b.begin);
}

/** The innermost environment around the stretch from `from` to `to`, among those `which` accepts. */
export function envAround(envs: Env[], from: number, to: number, which: (e: Env) => boolean = () => true): Env | null {
  let found: Env | null = null;
  for (const e of envs) if (e.head <= from && to <= e.end && which(e) && (!found || e.begin >= found.begin)) found = e;
  return found;
}

export const lineStart = (text: string, at: number) => text.lastIndexOf("\n", at - 1) + 1;
export const lineEnd = (text: string, at: number) => (text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at));

/** The line from `from` to its end, with its line break, when nothing but `[from, to)` and spaces is on it; else null. */
export function lineAlone(text: string, from: number, to: number): { from: number; to: number } | null {
  const start = lineStart(text, from);
  const end = lineEnd(text, to);
  if (!/^[ \t]*$/.test(text.slice(start, from)) || !/^[ \t]*$/.test(text.slice(to, end))) return null;
  return { from: start, to: Math.min(text.length, end + 1) };
}

/** A line that is structure rather than text: it begins or ends an environment, is a heading, a list item, or the like. */
const STRUCTURE = /^[ \t]*\\(?:begin|end|item|part|chapter|section|subsection|subsubsection|paragraph|maketitle|tableofcontents|newpage|clearpage|bibliography|printbibliography)\b/;
const isBlank = (line: string) => /^[ \t\r]*$/.test(line);

/**
 * The lines of the paragraphs the stretch from `from` to `to` is in, as a word processor's
 * paragraph tools see them: up to a blank line, a heading or the start or end of an environment.
 * Inside a list the whole list is the paragraph. Null where there is no text to act on: in the
 * settings, inside a formula, a table or verbatim, or where the lines would cut an environment
 * in two.
 */
export function paragraphLines(text: string, from: number, to: number, envs = environments(text)): { from: number; to: number } | null {
  const begin = documentStart(text);
  if (begin >= 0 && from < begin) return null;
  let inner = envAround(envs, from, to);
  if (inner && !TEXT.test(inner.name)) return null;
  // In a list, its paragraphs are its items: the tools act on the whole list.
  while (inner && LISTS.test(inner.name)) {
    const list = inner;
    inner = inner.parent;
    if (!inner || !TEXT.test(inner.name)) return null;
    from = Math.min(from, list.begin);
    to = Math.max(to, list.tail);
  }
  const floor = inner ? lineEnd(text, inner.head) + 1 : 0;
  const ceiling = inner ? lineStart(text, inner.end) : text.length;
  let start = lineStart(text, from);
  let stop = lineEnd(text, to);
  if (start < floor || stop > ceiling) return null;
  const line = (at: number) => text.slice(lineStart(text, at), lineEnd(text, at));
  // A cursor on a heading or a blank line has that line alone as its paragraph.
  if (!STRUCTURE.test(line(start)) && !isBlank(line(start))) {
    while (start > floor) {
      const prev = lineStart(text, start - 1);
      const t = text.slice(prev, start - 1);
      if (isBlank(t) || STRUCTURE.test(t)) break;
      start = prev;
    }
  }
  if (!STRUCTURE.test(line(stop)) && !isBlank(line(stop))) {
    while (stop < ceiling - 1) {
      const next = lineEnd(text, stop + 1);
      const t = text.slice(stop + 1, next);
      if (stop + 1 >= ceiling || isBlank(t) || STRUCTURE.test(t)) break;
      stop = next;
    }
  }
  // A list touched by the lines is taken whole.
  for (const e of envs) {
    if (!LISTS.test(e.name)) continue;
    if (e.begin < stop && e.tail > start && (e.begin < start || e.tail > stop) && e.parent === inner) {
      start = Math.min(start, lineStart(text, e.begin));
      stop = Math.max(stop, lineEnd(text, e.tail));
    }
  }
  // Every environment begun in the lines must end in them, and the other way round.
  if (envs.some((e) => (e.begin >= start && e.begin < stop) !== (e.end >= start && e.end < stop))) return null;
  // Nor may they cut a command's braces in two, such as a heading's title written over two lines.
  if (!bracesBalanced(text, start, stop)) return null;
  return { from: start, to: stop };
}

/** Wrap whole lines in an environment, its \begin and \end on lines of their own. */
function wrapLines(text: string, lines: { from: number; to: number }, name: string): TextChange[] {
  const indent = /^[ \t]*/.exec(text.slice(lines.from))![0];
  return [
    { from: lines.from, to: lines.from, insert: `${indent}\\begin{${name}}\n` },
    { from: lines.to, to: lines.to, insert: `\n${indent}\\end{${name}}` },
  ];
}

/** Take an environment away, keeping what is in it: its \begin and \end go with their lines when they are alone on them. */
export function unwrapEnv(text: string, env: Env): TextChange[] {
  const alone = { open: lineAlone(text, env.begin, env.head), close: lineAlone(text, env.end, env.tail) };
  const open = alone.open ?? { from: env.begin, to: env.head };
  const close = alone.close ?? { from: env.end, to: env.tail };
  // What it held stays a paragraph of its own, not joined to text written just outside it.
  return [
    { from: open.from, to: open.to, insert: alone.open && apart(lineBefore(text, open.from), lineAfter(text, open.to)) ? "\n" : "" },
    { from: close.from, to: close.to, insert: alone.close && apart(lineBefore(text, close.from), lineAfter(text, close.to)) ? "\n" : "" },
  ];
}

/** The line that ends just before `at`, a line's start; "" at the top. */
const lineBefore = (text: string, at: number) => (at > 0 ? text.slice(lineStart(text, at - 1), at - 1) : "");
/** The line that starts at `at`, a line's start; "" at the end. */
const lineAfter = (text: string, at: number) => (at < text.length ? text.slice(at, lineEnd(text, at)) : "");
/** Whether two lines of text that become neighbours need a blank line between them to stay two paragraphs. */
const apart = (above: string, below: string) => !isBlank(above) && !STRUCTURE.test(above) && !isBlank(below) && !STRUCTURE.test(below);

/** Give an environment another name, keeping what is in it; `options` replaces what is in its square brackets. */
export function renameEnv(text: string, env: Env, name: string, options?: string): TextChange[] {
  const head = options === undefined ? `\\begin{${name}}${text.slice(env.begin, env.head).replace(/^\\begin\s*\{[^}]*\}/, "")}` : `\\begin{${name}}${options ? `[${options}]` : ""}`;
  return [
    { from: env.begin, to: env.head, insert: head },
    { from: env.end, to: env.tail, insert: `\\end{${name}}` },
  ];
}

/**
 * The environment `env` cut round the paragraphs `lines` written directly in it, as a word
 * processor sets some paragraphs apart from the others: those before and after stay in `env`,
 * and these go in an environment `name`, or in none (null). Null when `lines` are all of its
 * paragraphs, or its \begin or \end shares a line with text.
 */
function cutRound(text: string, env: Env, lines: { from: number; to: number }, name: string | null, envs: Env[]): TextChange[] | null {
  const open = lineAlone(text, env.begin, env.head);
  const close = lineAlone(text, env.end, env.tail);
  if (!open || !close || envAround(envs, lines.from, lines.to, (e) => !LISTS.test(e.name)) !== env) return null;
  const before = text.slice(open.to, lines.from);
  // From the end of the last line, its line break first, to the \end line.
  const after = text.slice(lines.to + 1, close.from);
  if (!before.trim() && !after.trim()) return null;
  const head = text.slice(open.from, open.to);
  const foot = `${text.slice(close.from, env.end)}\\end{${env.name}}`;
  // Blank lines at the cut go between the environments, not inside them.
  const gapBefore = /\n((?:[ \t]*\n)*)$/.exec(before)?.[1] ?? "";
  const gapAfter = /^(?:[ \t]*\n)*/.exec(after)![0];
  const indent = /^[ \t]*/.exec(head)![0];
  const words = text.slice(lines.from, lines.to);
  const middle = name ? `${indent}\\begin{${name}}\n${words}\n${indent}\\end{${name}}` : words;
  // Words taken out to its edge stay a paragraph of their own beside text written just outside it.
  const first = before.trim() ? `${head}${before.slice(0, before.length - gapBefore.length)}${foot}\n${gapBefore}` : !name && !before && apart(lineBefore(text, open.from), words) ? "\n" : before;
  const last = after.trim() ? `\n${gapAfter}${head}${after.slice(gapAfter.length)}${foot}` : !name && apart(words.slice(words.lastIndexOf("\n") + 1), lineAfter(text, close.to)) ? "\n" : "";
  return [{ from: open.from, to: env.tail, insert: `${first}${middle}${last}` }];
}

/** How the paragraph at `at` is aligned. */
export function alignmentAt(text: string, at: number, envs = environments(text)): Alignment {
  const env = envAround(envs, at, at, (e) => e.name in ALIGNMENTS);
  return env ? ALIGNMENTS[env.name] : "justify";
}

/**
 * Align the paragraphs of the selection as a word processor does: centred, left or right by
 * the environment around them, justified (LaTeX's own setting) by taking it away. Where they
 * are aligned already, that environment is changed. Null when nothing is to change, or the
 * paragraphs cannot be told for certain.
 */
export function setAlignment(text: string, from: number, to: number, alignment: Alignment): TextChange[] | null {
  const envs = environments(text);
  const env = envAround(envs, from, to, (e) => e.name in ALIGNMENTS);
  if (env && ALIGNMENTS[env.name] === alignment) return null;
  const lines = paragraphLines(text, from, to, envs);
  if (env) {
    // Some of its paragraphs: the environment is cut round them. All of them: it changes.
    const cut = lines && cutRound(text, env, lines, alignment === "justify" ? null : ALIGN_ENV[alignment], envs);
    return cut ?? (alignment === "justify" ? unwrapEnv(text, env) : renameEnv(text, env, ALIGN_ENV[alignment], ""));
  }
  if (alignment === "justify") return null;
  return lines ? wrapLines(text, lines, ALIGN_ENV[alignment]) : null;
}

/** The style the paragraph at `at` has from the environment around it, if any. */
export function blockStyleAt(text: string, at: number, envs = environments(text)): BlockStyle | null {
  const env = envAround(envs, at, at, (e) => STYLE_ENVS.test(e.name));
  return env ? (env.name === "abstract" ? "abstract" : "quote") : null;
}

/** Set the paragraphs of the selection as a quotation or the abstract, or (null) take that style off. */
export function setBlockStyle(text: string, from: number, to: number, style: BlockStyle | null): TextChange[] | null {
  const envs = environments(text);
  const env = envAround(envs, from, to, (e) => STYLE_ENVS.test(e.name));
  const lines = paragraphLines(text, from, to, envs);
  if (env) {
    const now = env.name === "abstract" ? "abstract" : "quote";
    if (style === now) return null;
    const cut = lines && cutRound(text, env, lines, style, envs);
    return cut ?? (style ? renameEnv(text, env, style) : unwrapEnv(text, env));
  }
  if (!style) return null;
  return lines ? wrapLines(text, lines, style) : null;
}
