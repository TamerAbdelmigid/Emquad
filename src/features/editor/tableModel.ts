// A table as the table editor sees it, and the LaTeX it is read from and written to. Pure: no
// editor, no DOM. The .tex source is the only truth; this module turns a `tabular` into a grid,
// changes the grid, and writes the `tabular` back.
//
// Only tables that can be written back without loss are read. Anything else (a column type or
// a rule this module does not model, a comment inside a cell, verbatim text) is reported as not
// editable, so the editor shows it read-only and never rewrites it.

export type Align = "l" | "c" | "r";

/** One piece of a `\cmidrule`: the columns it runs under (from 0, both ends included), its trim and thickness. */
export interface Seg {
  a: number;
  b: number;
  /** What is in the parentheses, such as `lr`. */
  trim?: string;
  /** What is in the square brackets, such as `0.5pt`. */
  width?: string;
}

/**
 * What is meant on one horizontal boundary: no rule, a full rule, a `\cline` or `\cmidrule`
 * under some columns, and what else is written there. Where a cell merged downwards crosses the
 * boundary the rule is not drawn through it; that is worked out when the table is written, so
 * the rule comes back by itself if the cell is split again.
 */
export interface Rule {
  kind: "none" | "hline" | "toprule" | "midrule" | "bottomrule" | "cline" | "cmidrule";
  /** For `cline`: which columns the rule runs under. */
  cols?: boolean[];
  /** For `cmidrule`: its pieces. */
  segs?: Seg[];
  /** The thickness of a booktabs rule, as in `\midrule[2pt]`. */
  width?: string;
  /** An `\addlinespace` here, with what was in its brackets ("" for nothing). */
  space?: string;
  /** The `\addlinespace` comes before the rule rather than after it. */
  spaceFirst?: boolean;
  /** Comment lines written here, each the text after its `%`. */
  notes?: string[];
}

export interface Cell {
  tex: string;
  colSpan: number;
  rowSpan: number;
  /** Covered by a merged cell that starts above or to the left. */
  hidden: boolean;
  /** The column description of a `\multicolumn`, kept as it was written. */
  spec?: string;
  /** Under a `\multirow`: the description of the empty `\multicolumn` written in this row, when it has its own. */
  fill?: string;
  /** For a `\multirow`: the width it was given, when not `*`, and its position option. */
  rowWidth?: string;
  rowPos?: string;
}

/** What is written for one row besides its cells. */
export interface RowInfo {
  /** The space after it set by hand, as in `\\[2pt]`. */
  gap?: string;
  /** A `\rowcolor` at its start, written out whole. */
  color?: string;
  /** A comment after its line end, the text after the `%`. */
  note?: string;
}

/** The environments a table can be written in, besides a plain `tabular`. */
export type TableEnv = "tabular*" | "tabularx" | "longtable";

export interface Table {
  /** One per column: how its text is aligned. */
  aligns: Align[];
  /** One per vertical boundary, so one more than there are columns. */
  vrules: boolean[];
  /** `rows[r][c]`; every row has one cell per column. */
  rows: Cell[][];
  /** One per horizontal boundary, so one more than there are rows. */
  hrules: Rule[];
  /** The optional position argument, such as `t`. */
  pos?: string;
  /** The environment, when not a plain `tabular`, and the width it is given. */
  env?: { name: TableEnv; width?: string };
  /** One per column, when some column is described as more than l, c or r: `p{3cm}`, `>{\centering}X` and the like. */
  kinds?: string[];
  /** One per vertical boundary, when something besides a bar is written there, such as `@{}`. */
  seps?: string[];
  /** One per row, when some row has more than its cells. */
  rowInfo?: RowInfo[];
}

/** A block of cells, edges included. */
export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type Parsed = { ok: true; table: Table } | { ok: false; reason: string };

const cell = (tex = "", hidden = false): Cell => ({ tex, colSpan: 1, rowSpan: 1, hidden });
const copy = (t: Table): Table => JSON.parse(JSON.stringify(t)) as Table;
const columns = (t: Table) => t.aligns.length;
/** What a rule carries besides its line, which a change to the line keeps. */
const extrasOf = (rule: Rule): Partial<Rule> => ({
  ...(rule.space !== undefined ? { space: rule.space } : {}),
  ...(rule.spaceFirst ? { spaceFirst: true } : {}),
  ...(rule.notes?.length ? { notes: [...rule.notes] } : {}),
});

/** Offset just past the brace that closes the one at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Commands that change how a table is built in ways the grid does not model. */
const UNKNOWN = new Set([
  "tabularnewline", "noalign", "columncolor", "endhead", "endfirsthead", "endfoot", "endlastfoot", "specialrule", "arrayrulecolor", "hhline",
  "input", "include", "newline", "cr", "omit", "span", "multispan", "hdashline", "cdashline", "morecmidrules", "extracolsep", "vline",
  "arraybackslash", "diagbox", "nopagebreak", "pagebreak", "captionof", "mintinline", "path", "nolinkurl", "crcr", "caption", "label",
]);
/** Environments whose text is not LaTeX, which a cell cannot be laid out around. */
const VERBATIM_ENVS = /^(?:verbatim\*?|Verbatim|lstlisting|minted|comment|filecontents\*?)$/;
/** The commands for rules and the space between rows that this module reads. */
const RULES = new Set(["hline", "cline", "toprule", "midrule", "bottomrule", "cmidrule", "addlinespace"]);
/** Any other command that draws a rule between rows, whatever package it comes from. */
const SOME_RULE = /hline|rule$|cline|dashline/i;

/**
 * Take away the spaces TeX itself ignores at the ends of a cell: space, tab and line ends.
 * Other characters that merely look like spaces, such as a no-break space, print, and stay.
 */
export function trimSpaces(text: string): string {
  return text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

/**
 * Trim, but keep the space of a `\ ` at the end: without it the backslash would swallow
 * whatever is written next. A cell written over several lines keeps its lines.
 */
function trimTex(text: string): string {
  const out = trimSpaces(text);
  const slashes = /\\+$/.exec(out)?.[0].length ?? 0;
  return slashes % 2 === 1 && /[ \t\r\n]$/.test(text) ? `${out} ` : out;
}

/** A cell's text on one line, as a one-line box shows it: to TeX a single line end is a space. */
export function oneLine(tex: string): string {
  return tex.replace(/[ \t]*\r?\n[ \t]*/g, " ");
}

const W = String.raw`[ \t\r\n]*`;
/** What may start a row: a rule, a piece of one, or space between rows. */
const BOUNDARY_ITEM = new RegExp(
  String.raw`^${W}(?:\\(hline)(?![a-zA-Z@])|\\(toprule|midrule|bottomrule)(?![a-zA-Z@])(?:${W}\[([^\]]*)\])?|\\cline${W}\{${W}(\d+)${W}-${W}(\d+)${W}\}|\\cmidrule(?![a-zA-Z@])(?:${W}\[([^\]]*)\])?(?:${W}\(([^)]*)\))?${W}\{${W}(\d+)${W}-${W}(\d+)${W}\}|\\addlinespace(?![a-zA-Z@])(?:${W}\[([^\]]*)\])?)`,
);
const ROW_COLOR = new RegExp(String.raw`^${W}(\\rowcolor(?:${W}\[[^\]]*\])?${W}\{[^{}]*\})`);
const RULE_ANYWHERE = /\\(?:hline|cline|toprule|midrule|bottomrule|cmidrule|addlinespace|rowcolor)(?![a-zA-Z@])/;
const no = (reason: string): Parsed => ({ ok: false, reason });

/** A column description read: its columns' alignment, bars, own descriptions and what else is written between them. */
interface Spec {
  aligns: Align[];
  vrules: boolean[];
  kinds: string[];
  seps: string[];
}

/** How a column described as `kind` is aligned. */
function alignOf(kind: string): Align {
  let i = 0;
  let pre = "";
  while (kind[i] === ">" && kind[i + 1] === "{") {
    const end = closing(kind, i + 1);
    if (end < 0) break;
    pre += kind.slice(i, end);
    i = end;
  }
  const base = kind[i];
  if (base === "l" || base === "c" || base === "r") return base;
  return /\\centering(?![a-zA-Z@])/.test(pre) ? "c" : /\\raggedleft(?![a-zA-Z@])|\\RaggedLeft(?![a-zA-Z@])/.test(pre) ? "r" : "l";
}

/** A column's description with its alignment changed, keeping its width and anything else in it. */
export function kindWithAlign(kind: string, align: Align): string {
  if (kind === "l" || kind === "c" || kind === "r") return align;
  let i = 0;
  const kept: string[] = [];
  while (kind[i] === ">" && kind[i + 1] === "{") {
    const end = closing(kind, i + 1);
    if (end < 0) return kind;
    const inner = kind
      .slice(i + 2, end - 1)
      .replace(/\\(?:centering|raggedright|raggedleft|RaggedRight|RaggedLeft|Centering|arraybackslash)(?![a-zA-Z@])\s*/g, "")
      .trim();
    if (inner) kept.push(`>{${inner}}`);
    i = end;
  }
  const base = kind.slice(i);
  if (base[0] === "l" || base[0] === "c" || base[0] === "r") return kept.join("") + align + base.slice(1);
  const set = align === "l" ? "" : `>{\\${align === "c" ? "centering" : "raggedleft"}\\arraybackslash}`;
  return kept.join("") + set + base;
}

/** Read a column description, or say why it cannot be edited here. */
function readSpec(spec: string): Spec | string {
  const out: Spec = { aligns: [], vrules: [false], kinds: [], seps: [""] };
  let pre = "";
  for (let i = 0; i < spec.length; ) {
    const ch = spec[i];
    const last = out.vrules.length - 1;
    const group = (at: number) => (spec[at] === "{" ? closing(spec, at) : -1);
    if (/[ \t\r\n]/.test(ch)) i++;
    else if (ch === "|") {
      if (pre) return "A column description has a bar after >{…}";
      if (out.vrules[last]) return "It uses double vertical rules";
      out.vrules[last] = true;
      i++;
    } else if (ch === "@" || ch === "!" || ch === ">") {
      const end = group(i + 1);
      if (end < 0) return "A column description is not finished";
      if (ch === ">") pre += spec.slice(i, end);
      else out.seps[last] += spec.slice(i, end);
      i = end;
    } else if ("lcrX".includes(ch) || "pmb".includes(ch)) {
      let end = i + 1;
      if ("pmb".includes(ch)) {
        end = group(i + 1);
        if (end < 0) return "A column's width is not finished";
      }
      let kind = pre + spec.slice(i, end);
      pre = "";
      i = end;
      while (/[ \t\r\n]/.test(spec[i] ?? "")) i++;
      while (spec[i] === "<") {
        const close = group(i + 1);
        if (close < 0) return "A column description is not finished";
        kind += spec.slice(i, close);
        i = close;
      }
      out.aligns.push(alignOf(kind));
      out.kinds.push(kind);
      out.vrules.push(false);
      out.seps.push("");
    } else return "It uses a column type that cannot be edited here";
  }
  if (pre) return "A column description is not finished";
  return out;
}

/** The column description of a table. */
function writeSpec(t: Table): string {
  const at = (b: number) => (t.vrules[b] ? "|" : "") + (t.seps?.[b] ?? "");
  return t.aligns.map((a, c) => at(c) + (t.kinds?.[c] ?? a)).join("") + at(columns(t));
}

/** The alignment a `\multicolumn` description gives its cell. */
export function specAlign(spec: string): Align | null {
  const read = readSpec(spec);
  return typeof read === "string" || read.aligns.length !== 1 ? null : read.aligns[0];
}

/** A `\multicolumn` description with its alignment changed. */
function specWithAlign(spec: string, align: Align): string {
  const read = readSpec(spec);
  if (typeof read === "string" || read.kinds.length !== 1) return spec;
  return (read.vrules[0] ? "|" : "") + read.seps[0] + kindWithAlign(read.kinds[0], align) + (read.vrules[1] ? "|" : "") + read.seps[1];
}

/**
 * Read a whole table environment. A table is only accepted if writing it out and reading that
 * again gives the very same table, so nothing can be read that would not be kept.
 */
export function parseTable(source: string): Parsed {
  const read = readTable(source);
  if (!read.ok) return read;
  const again = readTable(writeTable(read.table));
  if (!again.ok || JSON.stringify(again.table) !== JSON.stringify(read.table)) return no("It is written in a way that cannot be kept exactly");
  return read;
}

/** The place in a table's source of each cell's text, from its first character to just after its last; null for a hidden cell. */
export type CellRanges = ({ from: number; to: number } | null)[][];

/** Where each cell's text is in `source`, for changing one cell without laying out the rest again. Null when it cannot be told. */
export function cellRanges(source: string): CellRanges | null {
  const read = readTable(source, true);
  return read.ok ? read.ranges : null;
}

type Read = { ok: true; table: Table; ranges: CellRanges } | { ok: false; reason: string };

function readTable(source: string): Parsed;
function readTable(source: string, withRanges: true): Read;
function readTable(source: string, withRanges = false): Parsed | Read {
  const head = new RegExp(String.raw`^\\begin\{(tabular\*?|tabularx|longtable)\}${W}`).exec(source);
  if (!head) return no("Only tabular, tabular*, tabularx and longtable tables can be edited here");
  const name = head[1];
  let at = head[0].length;
  let width: string | undefined;
  if (name === "tabular*" || name === "tabularx") {
    const end = source[at] === "{" ? closing(source, at) : -1;
    if (end < 0) return no("The table's width is not given");
    width = source.slice(at + 1, end - 1);
    at = end;
    while (/[ \t\r\n]/.test(source[at] ?? "")) at++;
  }
  const posMatch = new RegExp(String.raw`^\[([tbclr])\]${W}`).exec(source.slice(at));
  if (posMatch) at += posMatch[0].length;
  if (source[at] !== "{") return no("The table is not finished");
  const specEnd = closing(source, at);
  const close = `\\end{${name}}`;
  const tail = new RegExp(String.raw`${close.replace(/[\\{}*]/g, (c) => `\\${c}`)}${W}$`).exec(source);
  if (specEnd < 0 || !tail || tail.index < specEnd) return no("The table is not finished");
  const spec = readSpec(source.slice(at + 1, specEnd - 1));
  if (typeof spec === "string") return no(spec);
  const { aligns, vrules, kinds, seps } = spec;
  if (aligns.length === 0) return no("It has no columns");

  // Cut the body into rows and cells, at the top level of braces only. Each character kept
  // remembers where it was, so that a cell can later be changed where it stands.
  const bodyStart = specEnd;
  const body = source.slice(bodyStart, tail.index);
  interface Chunk {
    cells: { text: string; offs: number[] }[];
    notes: string[];
    gap?: string;
    note?: string;
  }
  const chunks: Chunk[] = [{ cells: [{ text: "", offs: [] }], notes: [] }];
  const current = () => chunks[chunks.length - 1];
  const add = (text: string, from: number) => {
    const c = current().cells[current().cells.length - 1];
    c.text += text;
    for (let k = 0; k < text.length; k++) c.offs.push(bodyStart + from + k);
  };
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      const next = body[i + 1] ?? "";
      if (next === "\\" && depth === 0) {
        i++;
        const after = body.slice(i + 1);
        if (/^[ \t\r\n]*\*/.test(after)) return no("It keeps rows together with \\\\*");
        // As LaTeX reads it, brackets after a line end, even on the next line, are the space after it.
        const gap = /^[ \t\r\n]*\[([^\]]*)\]/.exec(after);
        const chunk = current();
        if (gap) {
          chunk.gap = gap[1];
          i += gap[0].length;
        }
        chunks.push({ cells: [{ text: "", offs: [] }], notes: [] });
      } else if (/[a-zA-Z@]/.test(next)) {
        const name = /^[a-zA-Z@]+\*?/.exec(body.slice(i + 1))![0];
        const bare = name.replace(/\*$/, "");
        if (bare === "begin") {
          // An environment inside a cell is taken whole, its own & and \\ included.
          const env = /^\{([^{}]*)\}/.exec(body.slice(i + 6));
          if (!env) return no("An environment inside it is not written in a way that can be followed");
          if (VERBATIM_ENVS.test(env[1])) return no("It has verbatim text inside it");
          const end = endOf(body, i, env[1]);
          if (end < 0) return no("An environment inside it is not finished");
          add(body.slice(i, end), i);
          i = end - 1;
          continue;
        }
        if (bare === "end") return no("Its environments do not match");
        if (bare === "verb" || bare === "Verb" || bare === "lstinline") {
          // Verbatim in a line: taken whole up to the same mark again.
          const mark = body[i + 1 + name.length];
          const end = mark && !/[a-zA-Z\s{]/.test(mark) ? body.indexOf(mark, i + 2 + name.length) : -1;
          const lineEnd = body.indexOf("\n", i);
          if (end < 0 || (lineEnd >= 0 && end > lineEnd)) return no(`It uses \\${bare} in a way that cannot be followed`);
          add(body.slice(i, end + 1), i);
          i = end;
          continue;
        }
        if (UNKNOWN.has(bare)) return no(`It uses \\${bare}, which cannot be edited here`);
        // An address given between two bars instead of braces is verbatim as well.
        if (bare === "url" && body[i + 1 + name.length] !== "{") return no("It uses \\url without braces, which cannot be edited here");
        if (!RULES.has(bare) && bare !== "rule" && SOME_RULE.test(bare)) return no(`It uses \\${bare}, a kind of rule that cannot be edited here`);
        add(`\\${name}`, i);
        i += name.length;
      } else {
        add(c + next, i);
        i++;
      }
    } else if (c === "%") {
      // A comment on a line of its own between rows, or after a row's line end, is kept with
      // the row or the boundary; one in the middle of a cell is not.
      const stop = body.indexOf("\n", i) < 0 ? body.length : body.indexOf("\n", i);
      const text = body.slice(i + 1, stop).replace(/\r$/, "");
      const chunk = current();
      const sofar = chunk.cells.map((x) => x.text).join("&");
      const clear = chunk.cells.length === 1 && boundaryOnly(sofar);
      if (!clear || depth !== 0) return no("It has a comment inside a cell");
      if (chunks.length > 1 && !/\n/.test(sofar) && trimSpaces(sofar) === "" && chunks[chunks.length - 2].note === undefined) chunks[chunks.length - 2].note = text;
      else chunk.notes.push(text);
      i = stop - 1;
    } else if (c === "&" && depth === 0) current().cells.push({ text: "", offs: [] });
    else {
      if (c === "{") depth++;
      if (c === "}" && --depth < 0) return no("Its braces do not match");
      add(c, i);
    }
  }
  if (depth !== 0) return no("Its braces do not match");

  const n = aligns.length;
  const hrules: Rule[] = [];
  const rowInfo: RowInfo[] = [];
  const raw: { text: string; offs: number[] }[][] = [];
  for (let k = 0; k < chunks.length; k++) {
    const chunk = chunks[k];
    const cells = chunk.cells;
    const rule: Rule = { kind: "none" };
    const first = cells[0];
    const cut = (length: number) => {
      first.text = first.text.slice(length);
      first.offs = first.offs.slice(length);
    };
    for (let m = BOUNDARY_ITEM.exec(first.text); m; m = BOUNDARY_ITEM.exec(first.text)) {
      cut(m[0].length);
      if (m[1] || m[2]) {
        if (rule.kind !== "none") return no("It has more than one rule between two rows");
        rule.kind = (m[1] ?? m[2]) as Rule["kind"];
        if (m[3] !== undefined) rule.width = m[3];
      } else if (m[4]) {
        const [a, b] = [Number(m[4]), Number(m[5])];
        if (rule.kind !== "none" && rule.kind !== "cline") return no("It has more than one kind of rule between two rows");
        if (a < 1 || b > n || a > b) return no("A \\cline names columns the table does not have");
        rule.kind = "cline";
        rule.cols ??= Array.from({ length: n }, () => false);
        for (let col = a; col <= b; col++) rule.cols[col - 1] = true;
      } else if (m[8]) {
        const [a, b] = [Number(m[8]), Number(m[9])];
        if (rule.kind !== "none" && rule.kind !== "cmidrule") return no("It has more than one kind of rule between two rows");
        if (a < 1 || b > n || a > b) return no("A \\cmidrule names columns the table does not have");
        rule.kind = "cmidrule";
        const seg: Seg = { a: a - 1, b: b - 1, ...(m[7] !== undefined ? { trim: m[7] } : {}), ...(m[6] !== undefined ? { width: m[6] } : {}) };
        if ((rule.segs ?? []).some((s) => s.a <= seg.b && seg.a <= s.b)) return no("Two \\cmidrule pieces overlap");
        rule.segs = [...(rule.segs ?? []), seg].sort((x, y) => x.a - y.a);
      } else {
        if (rule.space !== undefined) return no("It has more than one \\addlinespace between two rows");
        rule.space = m[10] ?? "";
        if (rule.kind === "none") rule.spaceFirst = true;
      }
    }
    if (rule.space === undefined || rule.kind === "none") delete rule.spaceFirst;
    if (chunk.notes.length) rule.notes = chunk.notes;
    const info: RowInfo = {};
    const color = ROW_COLOR.exec(first.text);
    if (color) {
      info.color = color[1];
      cut(color[0].length);
    }
    if (cells.some((x) => RULE_ANYWHERE.test(x.text))) return no("It has a rule or a row colour in the middle of a row");
    if (cells.some((x) => /\n[ \t\r]*\n/.test(trimSpaces(x.text)))) return no("It has a blank line inside a cell");
    hrules.push(rule);
    const last = k === chunks.length - 1;
    if (last && cells.length === 1 && trimSpaces(cells[0].text) === "") {
      if (info.color) return no("A row colour has no row");
      break;
    }
    if (chunk.gap !== undefined) info.gap = chunk.gap;
    if (chunk.note !== undefined) info.note = chunk.note;
    rowInfo.push(info);
    raw.push(cells);
    // A last row written without its line end has no rule under it.
    if (last) hrules.push({ kind: "none" });
  }
  if (raw.length === 0) return no("It has no rows");

  const rows: Cell[][] = [];
  const ranges: CellRanges = [];
  for (const texts of raw) {
    const row: Cell[] = [];
    const where: CellRanges[number] = [];
    for (const piece of texts) {
      const made = cell();
      // The text of the cell, as a slice of the piece, so that where it is stays known.
      let [s, e] = [0, piece.text.length];
      const trimmed = () => {
        while (s < e && /[ \t\r\n]/.test(piece.text[s])) s++;
        while (e > s && /[ \t\r\n]/.test(piece.text[e - 1])) e--;
        // A `\ ` at the end keeps its space.
        const slashes = /\\+$/.exec(piece.text.slice(s, e))?.[0].length ?? 0;
        if (slashes % 2 === 1 && e < piece.text.length) e++;
      };
      trimmed();
      let tex = piece.text.slice(s, e);
      const multi = new RegExp(String.raw`^\\multicolumn${W}\{${W}(\d+)${W}\}${W}\{`).exec(tex);
      if (multi) {
        const specClose = closing(tex, multi[0].length - 1);
        const open = specClose < 0 ? -1 : tex.indexOf("{", specClose);
        const end = open < 0 ? -1 : closing(tex, open);
        if (end !== tex.length || trimSpaces(tex.slice(specClose, open)) !== "") return no("A \\multicolumn is written in a way that cannot be edited here");
        made.colSpan = Number(multi[1]);
        made.spec = tex.slice(multi[0].length, specClose - 1).replace(/[ \t\r\n]/g, "");
        const own = readSpec(made.spec);
        if (typeof own === "string" || own.aligns.length !== 1 || made.colSpan < 1) return no("A \\multicolumn is described in a way that cannot be edited here");
        [s, e] = [s + open + 1, s + end - 1];
        trimmed();
        tex = piece.text.slice(s, e);
      }
      const down = new RegExp(String.raw`^\\multirow${W}(?:\[([^\]]*)\]${W})?\{${W}(\d+)${W}\}${W}\{${W}([^{}]*?)${W}\}${W}\{`).exec(tex);
      if (down) {
        if (closing(tex, down[0].length - 1) !== tex.length) return no("A \\multirow is written in a way that cannot be edited here");
        made.rowSpan = Number(down[2]);
        if (made.rowSpan < 2) return no("A \\multirow covers fewer than two rows");
        if (down[1] !== undefined) made.rowPos = down[1];
        if (down[3] !== "*") made.rowWidth = down[3];
        [s, e] = [s + down[0].length, s + tex.length - 1];
        trimmed();
        tex = piece.text.slice(s, e);
      }
      if (/\\multi(?:column|row)(?![a-zA-Z@])/.test(tex)) return no("A merged cell is written in a way that cannot be edited here");
      made.tex = trimTex(tex);
      row.push(made);
      // Where the text is, if its characters stand together in the source.
      const offs = piece.offs.slice(s, e);
      const together = offs.every((o, k) => k === 0 || o === offs[k - 1] + 1);
      const from = offs.length ? offs[0] : s < piece.offs.length ? piece.offs[s] : (piece.offs[s - 1] ?? -2) + 1;
      where.push(together && from >= 0 && made.tex === tex ? { from, to: from + offs.length } : null);
      for (let extra = 1; extra < made.colSpan; extra++) {
        row.push(cell("", true));
        where.push(null);
      }
    }
    if (row.length !== n) return no("A row does not have one cell for every column");
    rows.push(row);
    ranges.push(where);
  }
  const table: Table = {
    aligns,
    vrules,
    rows,
    hrules,
    ...(posMatch ? { pos: posMatch[1] } : {}),
    ...(name !== "tabular" ? { env: { name: name as TableEnv, ...(width !== undefined ? { width } : {}) } } : {}),
    ...(kinds.some((k, c) => k !== aligns[c]) ? { kinds } : {}),
    ...(seps.some(Boolean) ? { seps } : {}),
    ...(rowInfo.some((r) => Object.keys(r).length) ? { rowInfo } : {}),
  };
  // A cell merged downwards is followed, in the rows it covers, by empty cells of its width.
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < n; c++) {
      const top = rows[r][c];
      if (top.hidden || top.rowSpan === 1) continue;
      if (r + top.rowSpan > rows.length) return no("A \\multirow covers more rows than the table has");
      const described = top.colSpan > 1 ? (top.spec ?? specFor(table, c, top.colSpan)) : undefined;
      for (let below = r + 1; below < r + top.rowSpan; below++) {
        const under = rows[below][c];
        if (under.hidden || under.tex !== "" || under.rowSpan !== 1 || under.colSpan !== top.colSpan) return no("The cells under a \\multirow are not empty");
        for (let col = c; col < c + top.colSpan; col++) {
          rows[below][col] = cell("", true);
          ranges[below][col] = null;
        }
        // An empty cell described in its own way keeps its description.
        if (under.spec !== undefined && under.spec !== described) rows[below][c].fill = under.spec;
      }
    }
  }
  // A rule written straight through a merged cell cannot be kept: it would be cut on writing.
  for (let b = 1; b < rows.length; b++) {
    const drawn = drawnCols(hrules[b], n);
    const cut = crossed(table, b);
    if (drawn.some((on, c) => on && cut[c])) return no("A rule runs through a merged cell");
  }
  const done = normalize(table);
  return withRanges ? { ok: true, table: done, ranges } : { ok: true, table: done };
}

/** Just past the `\end{name}` that closes the `\begin{name}` at `at`, nested ones counted; -1 if there is none. */
function endOf(text: string, at: number, name: string): number {
  const open = `\\begin{${name}}`;
  const close = `\\end{${name}}`;
  let depth = 0;
  for (let i = at; i < text.length; ) {
    if (text.startsWith(open, i)) {
      depth++;
      i += open.length;
    } else if (text.startsWith(close, i)) {
      if (--depth === 0) return i + close.length;
      i += close.length;
    } else i++;
  }
  return -1;
}

/** Whether text at the start of a row is nothing but rules and the space between rows. */
function boundaryOnly(text: string): boolean {
  let rest = text;
  for (let m = BOUNDARY_ITEM.exec(rest); m; m = BOUNDARY_ITEM.exec(rest)) rest = rest.slice(m[0].length);
  return trimSpaces(rest) === "";
}

/** For each column, whether a rule is drawn under it, before merged cells are taken into account. */
function drawnCols(rule: Rule, n: number): boolean[] {
  return Array.from({ length: n }, (_, c) =>
    rule.kind === "cline" ? Boolean(rule.cols?.[c]) : rule.kind === "cmidrule" ? (rule.segs ?? []).some((s) => s.a <= c && c <= s.b) : rule.kind !== "none",
  );
}

/** The cell that shows at row `r`, column `c`: the one there, or the merged cell covering it. */
export function anchorOf(t: Table, r: number, c: number): { r: number; c: number } {
  for (let row = r; row >= 0; row--) {
    for (let col = c; col >= 0; col--) {
      const at = t.rows[row][col];
      if (!at.hidden && row + at.rowSpan > r && col + at.colSpan > c) return { r: row, c: col };
    }
  }
  return { r, c };
}

function specFor(t: Table, c: number, span: number): string {
  return (c === 0 && t.vrules[0] ? "|" : "") + t.aligns[c] + (t.vrules[c + span] ? "|" : "");
}

/** For each column, whether a cell merged downwards crosses horizontal boundary `b` there. */
function crossed(t: Table, b: number): boolean[] {
  return t.aligns.map((_, c) => b > 0 && b < t.rows.length && anchorOf(t, b, c).r < b);
}

/** The runs of columns that are on, as pieces from `a` to `b`. */
function runs(on: boolean[]): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (let c = 0; c < on.length; c++) {
    if (!on[c]) continue;
    let end = c;
    while (on[end + 1]) end++;
    out.push({ a: c, b: end });
    c = end;
  }
  return out;
}

/** The LaTeX for a boundary: its comment lines, its rule, drawn only under the columns not in `cut`, and its space. */
function ruleLines(rule: Rule, cut: boolean[]): string[] {
  const lines = (rule.notes ?? []).map((note) => `%${note}`);
  let line = "";
  if (rule.kind === "cmidrule") {
    line = (rule.segs ?? [])
      .map((s) => `\\cmidrule${s.width !== undefined ? `[${s.width}]` : ""}${s.trim !== undefined ? `(${s.trim})` : ""}{${s.a + 1}-${s.b + 1}}`)
      .join(" ");
  } else if (rule.kind !== "none" && rule.kind !== "cline" && !cut.some(Boolean)) line = `\\${rule.kind}${rule.width !== undefined ? `[${rule.width}]` : ""}`;
  else if (rule.kind !== "none") {
    const cols = cut.map((gone, c) => !gone && (rule.kind !== "cline" || Boolean(rule.cols?.[c])));
    line = runs(cols)
      .map((r) => `\\cline{${r.a + 1}-${r.b + 1}}`)
      .join("");
  }
  const space = rule.space !== undefined ? `\\addlinespace${rule.space ? `[${rule.space}]` : ""}` : "";
  if (rule.spaceFirst && space) lines.push(space);
  if (line) lines.push(line);
  if (!rule.spaceFirst && space) lines.push(space);
  return lines;
}

/** Write the table as LaTeX. Lines after the first start with `indent`. */
export function writeTable(t: Table, indent = ""): string {
  const name = t.env?.name ?? "tabular";
  const width = t.env?.width !== undefined ? `{${t.env.width}}` : "";
  const lines = [`\\begin{${name}}${width}${t.pos ? `[${t.pos}]` : ""}{${writeSpec(t)}}`];
  const rule = (b: number) => lines.push(...ruleLines(t.hrules[b], crossed(t, b)));
  rule(0);
  t.rows.forEach((row, r) => {
    const out: string[] = [];
    for (let c = 0; c < row.length; c++) {
      const at = row[c];
      if (!at.hidden) {
        const down = `\\multirow${at.rowPos !== undefined ? `[${at.rowPos}]` : ""}{${at.rowSpan}}{${at.rowWidth ?? "*"}}`;
        const inner = at.rowSpan > 1 ? `${down}{${at.tex}}` : at.tex;
        out.push(at.colSpan > 1 || at.spec ? `\\multicolumn{${at.colSpan}}{${at.spec ?? specFor(t, c, at.colSpan)}}{${inner}}` : inner);
        c += at.colSpan - 1;
        continue;
      }
      // Under a cell merged downwards: an empty cell of the same width, described as it was.
      const owner = anchorOf(t, r, c);
      const top = t.rows[owner.r][owner.c];
      out.push(top.colSpan > 1 || at.fill ? `\\multicolumn{${top.colSpan}}{${at.fill ?? top.spec ?? specFor(t, c, top.colSpan)}}{}` : "");
      c += top.colSpan - 1;
    }
    const info = t.rowInfo?.[r] ?? {};
    const cells = trimSpaces(out.join(" & "));
    const end = `\\\\${info.gap !== undefined ? `[${info.gap}]` : ""}${info.note !== undefined ? ` %${info.note}` : ""}`;
    lines.push(trimSpaces(`${info.color ? `${info.color} ` : ""}${cells} ${end}`));
    rule(r + 1);
  });
  lines.push(`\\end{${name}}`);
  return lines.join(`\n${indent}`);
}

/** A new table of empty cells. */
export function newTable(rowCount: number, colCount: number, borders = true): Table {
  return {
    aligns: Array.from({ length: colCount }, () => "l" as Align),
    vrules: Array.from({ length: colCount + 1 }, () => borders),
    rows: Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => cell())),
    hrules: Array.from({ length: rowCount + 1 }, (): Rule => ({ kind: borders ? "hline" : "none" })),
  };
}

/**
 * Put the rules in their one plain form, so that the same table is always described the same
 * way: a `\cline` or `\cmidrule` says nothing about columns a merged cell crosses, a `\cline`
 * that runs under every other column is a full rule, and one that runs under none is no rule.
 * A booktabs rule that a merged cell has come to cross becomes `\cmidrule` pieces around it.
 * Every cell merged across columns describes itself, so that it keeps its alignment and bars
 * whatever is done to the columns later.
 */
function normalize(t: Table): Table {
  t.hrules = t.hrules.map((rule, b): Rule => {
    const cut = crossed(t, b);
    const extras = extrasOf(rule);
    // A boundary that merged cells cross from end to end has no rule to speak of.
    if (rule.kind === "none" || cut.every(Boolean)) return { kind: "none", ...extras };
    if (rule.kind === "cmidrule") {
      const segs = (rule.segs ?? []).flatMap((seg) => runs(cut.map((gone, c) => !gone && c >= seg.a && c <= seg.b)).map((r) => ({ ...seg, ...r })));
      return segs.length ? { kind: "cmidrule", segs, ...extras } : { kind: "none", ...extras };
    }
    if (rule.kind === "hline") return { kind: "hline", ...extras };
    if (rule.kind !== "cline") {
      if (!cut.some(Boolean)) return { kind: rule.kind, ...(rule.width !== undefined ? { width: rule.width } : {}), ...extras };
      return { kind: "cmidrule", segs: runs(cut.map((gone) => !gone)), ...extras };
    }
    const cols = cut.map((gone, c) => !gone && Boolean(rule.cols?.[c]));
    if (!cols.some(Boolean)) return { kind: "none", ...extras };
    // Running under everything a merged cell leaves free, it is a full rule drawn around
    // the cell. With no merged cell in the way it stays the \cline it was written as.
    if (cut.some(Boolean) && cols.every((on, c) => on || cut[c])) return { kind: "hline", ...extras };
    return { kind: "cline", cols, ...extras };
  });
  t.rows.forEach((row) =>
    row.forEach((at, c) => {
      if (!at.hidden && at.colSpan > 1 && at.spec === undefined) at.spec = specFor(t, c, at.colSpan);
    }),
  );
  if (t.kinds && t.kinds.every((k, c) => k === t.aligns[c])) delete t.kinds;
  if (t.seps && !t.seps.some(Boolean)) delete t.seps;
  if (t.rowInfo && !t.rowInfo.some((r) => Object.keys(r).length)) delete t.rowInfo;
  return t;
}
const fixRules = normalize;

/** Grow a block until no merged cell sticks out of it. */
export function expandRect(t: Table, rect: Rect): Rect {
  const out = { top: Math.min(rect.top, rect.bottom), left: Math.min(rect.left, rect.right), bottom: Math.max(rect.top, rect.bottom), right: Math.max(rect.left, rect.right) };
  for (let changed = true; changed; ) {
    changed = false;
    for (let r = out.top; r <= out.bottom; r++) {
      for (let c = out.left; c <= out.right; c++) {
        const owner = anchorOf(t, r, c);
        const at = t.rows[owner.r][owner.c];
        const grown = {
          top: Math.min(out.top, owner.r),
          left: Math.min(out.left, owner.c),
          bottom: Math.max(out.bottom, owner.r + at.rowSpan - 1),
          right: Math.max(out.right, owner.c + at.colSpan - 1),
        };
        if (grown.top !== out.top || grown.left !== out.left || grown.bottom !== out.bottom || grown.right !== out.right) {
          Object.assign(out, grown);
          changed = true;
        }
      }
    }
  }
  return out;
}

export function setCell(table: Table, r: number, c: number, tex: string): Table {
  const t = copy(table);
  t.rows[r][c].tex = tex;
  return t;
}

/** Make one cell of a block. The text of every cell in it is kept, joined in reading order. */
export function merge(table: Table, block: Rect): Table {
  const t = copy(table);
  const rect = expandRect(t, block);
  const texts: string[] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) {
      if (!t.rows[r][c].hidden && t.rows[r][c].tex) texts.push(t.rows[r][c].tex);
      t.rows[r][c] = cell("", true);
    }
  }
  t.rows[rect.top][rect.left] = { tex: texts.join(" "), colSpan: rect.right - rect.left + 1, rowSpan: rect.bottom - rect.top + 1, hidden: false };
  return fixRules(t);
}

export const isMerged = (t: Table, r: number, c: number) => t.rows[r][c].colSpan > 1 || t.rows[r][c].rowSpan > 1;

/** Undo a merge: the cells it covered come back, empty, and the text stays in the first. */
export function splitMerged(table: Table, r: number, c: number): Table {
  const t = copy(table);
  const at = t.rows[r][c];
  for (let row = r; row < r + at.rowSpan; row++) for (let col = c; col < c + at.colSpan; col++) t.rows[row][col] = cell();
  t.rows[r][c].tex = at.tex;
  // A partial rule that stopped at the merged cell runs under its cells again. A full rule
  // was only ever drawn around it, and is whole again without being touched.
  // A table ruled between all its other rows gets its rules back where the merged cell
  // had taken them away whole.
  const ruled = t.hrules.slice(1, -1).every((rule, k) => rule.kind !== "none" || (k + 1 > r && k + 1 < r + at.rowSpan));
  for (let b = r + 1; b < r + at.rowSpan; b++) {
    const rule = t.hrules[b];
    if (rule.kind === "cline" && rule.cols) for (let col = c; col < c + at.colSpan; col++) rule.cols[col] = true;
    else if (rule.kind === "cmidrule") {
      const on = drawnCols(rule, columns(t));
      for (let col = c; col < c + at.colSpan; col++) on[col] = true;
      const pieces = runs(on);
      const plain = (rule.segs ?? []).every((seg) => seg.trim === undefined && seg.width === undefined);
      // Whole again and never trimmed: the \midrule it was before the merge.
      t.hrules[b] =
        plain && pieces.length === 1 && pieces[0].a === 0 && pieces[0].b === columns(t) - 1
          ? { kind: "midrule", ...extrasOf(rule) }
          : { kind: "cmidrule", segs: pieces.map((p) => ({ ...((rule.segs ?? []).find((seg) => seg.a <= p.a && p.a <= seg.b) ?? {}), ...p })), ...extrasOf(rule) };
    } else if (rule.kind === "none" && ruled && t.hrules.length > 3) t.hrules[b] = { kind: "hline", ...extrasOf(rule) };
  }
  return fixRules(t);
}

/** The merged or plain cells that cover a row, or a column, each named once. */
function anchorsIn(t: Table, where: { row: number } | { col: number }): { r: number; c: number }[] {
  const seen = new Set<string>();
  const out: { r: number; c: number }[] = [];
  const count = "row" in where ? columns(t) : t.rows.length;
  for (let i = 0; i < count; i++) {
    const owner = "row" in where ? anchorOf(t, where.row, i) : anchorOf(t, i, where.col);
    const key = `${owner.r},${owner.c}`;
    if (!seen.has(key)) out.push(owner);
    seen.add(key);
  }
  return out;
}

const anyInnerRule = (t: Table) => t.hrules.slice(1, -1).some((r) => r.kind !== "none") || (t.rows.length === 1 && t.hrules.some((r) => r.kind === "hline"));
const anyInnerBar = (t: Table) => t.vrules.slice(1, -1).some(Boolean) || (columns(t) === 1 && t.vrules.some(Boolean));

/**
 * Divide one ordinary cell into two side by side. A column is added, and every other cell in
 * the old column is widened over it, so only this cell looks divided.
 */
export function splitIntoColumns(table: Table, r: number, c: number): Table {
  const t = copy(table);
  if (t.rows[r][c].hidden || isMerged(t, r, c)) return t;
  const others = anchorsIn(t, { col: c }).filter((a) => a.r !== r);
  const bar = anyInnerBar(t);
  t.aligns.splice(c + 1, 0, t.aligns[c]);
  t.kinds?.splice(c + 1, 0, t.kinds[c]);
  t.vrules.splice(c + 1, 0, bar);
  t.seps?.splice(c + 1, 0, "");
  t.rows.forEach((row, at) => row.splice(c + 1, 0, cell("", at !== r)));
  for (const rule of t.hrules) rule.cols?.splice(c + 1, 0, rule.cols[c]);
  for (const a of others) t.rows[a.r][a.c].colSpan++;
  return fixRules(t);
}

/**
 * Divide one ordinary cell into two, one above the other. A row is added, and every other
 * cell in the old row is deepened over it, so only this cell looks divided.
 */
export function splitIntoRows(table: Table, r: number, c: number): Table {
  const t = copy(table);
  if (t.rows[r][c].hidden || isMerged(t, r, c)) return t;
  const others = anchorsIn(t, { row: r }).filter((a) => !(a.r === r && a.c === c));
  const ruled = anyInnerRule(t);
  t.rows.splice(r + 1, 0, Array.from({ length: columns(t) }, (_, col) => cell("", col !== c)));
  t.rowInfo?.splice(r + 1, 0, {});
  t.hrules.splice(r + 1, 0, ruled ? { kind: "cline", cols: Array.from({ length: columns(t) }, (_, col) => col === c) } : { kind: "none" });
  for (const a of others) t.rows[a.r][a.c].rowSpan++;
  return fixRules(t);
}

/** Add an empty row so that it becomes row `at`. */
export function insertRow(table: Table, at: number): Table {
  const t = copy(table);
  const n = columns(t);
  const crossing = at > 0 && at < t.rows.length ? anchorsIn(t, { row: at }).filter((a) => a.r < at) : [];
  const covered = new Set<number>();
  for (const a of crossing) for (let c = a.c; c < a.c + t.rows[a.r][a.c].colSpan; c++) covered.add(c);
  const inner: Rule = anyInnerRule(t) ? { kind: "hline" } : { kind: "none" };
  t.rows.splice(at, 0, Array.from({ length: n }, (_, c) => cell("", covered.has(c))));
  t.rowInfo?.splice(at, 0, {});
  for (const a of crossing) t.rows[a.r][a.c].rowSpan++;
  // The rules at the very top and bottom stay where they are; the new one is an inner rule.
  t.hrules.splice(at === 0 ? 1 : at, 0, inner);
  return fixRules(t);
}

export function deleteRow(table: Table, r: number): Table {
  const t = copy(table);
  if (t.rows.length === 1) return t;
  for (const a of anchorsIn(t, { row: r })) {
    const at = t.rows[a.r][a.c];
    if (a.r < r) at.rowSpan--;
    else if (at.rowSpan > 1) {
      // A cell merged downwards from this row keeps its text and starts one row lower.
      t.rows[r + 1][a.c] = { ...at, rowSpan: at.rowSpan - 1 };
    }
  }
  t.rows.splice(r, 1);
  t.rowInfo?.splice(r, 1);
  t.hrules.splice(r === t.rows.length ? r : r + 1, 1);
  return fixRules(t);
}

/** Add an empty column so that it becomes column `at`. */
export function insertColumn(table: Table, at: number): Table {
  const t = copy(table);
  const n = columns(t);
  const crossing = at > 0 && at < n ? anchorsIn(t, { col: at }).filter((a) => a.c < at) : [];
  const covered = new Set<number>();
  for (const a of crossing) for (let r = a.r; r < a.r + t.rows[a.r][a.c].rowSpan; r++) covered.add(r);
  const bar = anyInnerBar(t);
  t.aligns.splice(at, 0, t.aligns[Math.max(0, at - 1)]);
  t.kinds?.splice(at, 0, t.kinds[Math.max(0, at - 1)]);
  t.vrules.splice(at === 0 ? 1 : at, 0, bar);
  t.seps?.splice(at === 0 ? 1 : at, 0, "");
  t.rows.forEach((row, r) => row.splice(at, 0, cell("", covered.has(r))));
  for (const rule of t.hrules) rule.cols?.splice(at, 0, rule.cols[Math.max(0, at - 1)]);
  for (const a of crossing) t.rows[a.r][a.c].colSpan++;
  return fixRules(t);
}

export function deleteColumn(table: Table, c: number): Table {
  const t = copy(table);
  const n = columns(t);
  if (n === 1) return t;
  for (const a of anchorsIn(t, { col: c })) {
    const at = t.rows[a.r][a.c];
    if (a.c < c) at.colSpan--;
    else if (at.colSpan > 1) {
      // A cell merged across from this column keeps its text and its own alignment, and
      // starts one column later.
      t.rows[a.r][c + 1] = { ...at, colSpan: at.colSpan - 1, spec: at.spec ?? specFor(t, a.c, at.colSpan) };
    }
  }
  t.rows.forEach((row) => row.splice(c, 1));
  t.aligns.splice(c, 1);
  t.kinds?.splice(c, 1);
  t.vrules.splice(c === n - 1 ? c : c + 1, 1);
  t.seps?.splice(c === n - 1 ? c : c + 1, 1);
  for (const rule of t.hrules) rule.cols?.splice(c, 1);
  return fixRules(t);
}

/** Align every column a block touches. */
export function setAlign(table: Table, block: Rect, align: Align): Table {
  const t = copy(table);
  const rect = expandRect(t, block);
  for (let c = rect.left; c <= rect.right; c++) {
    t.aligns[c] = align;
    if (t.kinds) t.kinds[c] = kindWithAlign(t.kinds[c], align);
  }
  for (const row of t.rows) {
    row.forEach((at, c) => {
      if (at.spec && c >= rect.left && c <= rect.right) at.spec = specWithAlign(at.spec, align);
    });
  }
  return normalize(t);
}

export const hasBorders = (t: Table) => t.vrules.some(Boolean) || t.hrules.some((r) => r.kind !== "none");

/** Draw every border, or none if there are any now. */
export function toggleBorders(table: Table): Table {
  const t = copy(table);
  const on = !hasBorders(t);
  t.vrules = t.vrules.map(() => on);
  t.hrules = t.hrules.map((rule): Rule => ({ kind: on ? "hline" : "none", ...extrasOf(rule) }));
  // A hand-written description keeps its alignment and takes the table's new bars.
  return fixRules(respec(t));
}

/**
 * Give cells with a description of their own the bars the table now has beside them: every
 * such cell, or only those on vertical boundary `only`.
 */
function respec(t: Table, only?: number): Table {
  t.rows.forEach((row) =>
    row.forEach((at, c) => {
      if (!at.spec) return;
      if (only !== undefined) {
        // Only the bar on the boundary that changed; the rest is as the user wrote it.
        if (c + at.colSpan === only) at.spec = at.spec.replace(/\|*$/, t.vrules[only] ? "|" : "");
        if (c === 0 && only === 0) at.spec = at.spec.replace(/^\|*/, t.vrules[0] ? "|" : "");
        // Further along, the bar on a cell's left is drawn by the column before it; one the
        // user wrote on the cell itself goes when the line there is taken away.
        if (c > 0 && c === only && !t.vrules[only]) at.spec = at.spec.replace(/^\|+/, "");
        return;
      }
      const own = readSpec(at.spec);
      const kind = typeof own === "string" || own.kinds.length !== 1 ? (specAlign(at.spec) ?? t.aligns[c]) : own.kinds[0];
      at.spec = (c === 0 && t.vrules[0] ? "|" : "") + kind + (t.vrules[c + at.colSpan] ? "|" : "");
    }),
  );
  return t;
}

/** The looks the Borders menu offers for a whole table. */
export type BorderStyle = "all" | "none" | "outside" | "inside" | "header" | "book";

/**
 * Give the whole table one of the usual looks. `book` is the style of the booktabs package:
 * a heavier rule above and below, a lighter one under the first row, and no vertical lines.
 */
export function setBorders(table: Table, style: BorderStyle): Table {
  const t = copy(table);
  const [n, m] = [columns(t), t.rows.length];
  const edge = (i: number, last: number) => i === 0 || i === last;
  t.vrules = t.vrules.map((_, i) => (style === "all" ? true : style === "outside" ? edge(i, n) : style === "inside" ? !edge(i, n) : false));
  t.hrules = t.hrules.map((old, b): Rule => {
    const ends = edge(b, m);
    const extras = extrasOf(old);
    if (style === "all" || (style === "outside" && ends) || (style === "inside" && !ends) || (style === "header" && (ends || b === 1))) return { kind: "hline", ...extras };
    if (style === "book") return { kind: b === 0 ? "toprule" : b === m ? "bottomrule" : b === 1 ? "midrule" : "none", ...extras };
    return { kind: "none", ...extras };
  });
  return fixRules(respec(t));
}

/** The look a table has now, if it is one of those the Borders menu offers. */
export function bordersStyle(t: Table): BorderStyle | null {
  for (const style of ["none", "all", "outside", "inside", "header", "book"] as BorderStyle[]) {
    const made = setBorders(t, style);
    if (JSON.stringify(made.vrules) === JSON.stringify(t.vrules) && JSON.stringify(made.hrules) === JSON.stringify(t.hrules)) return style;
  }
  return null;
}

/** The table uses the rules of the booktabs package. */
export const needsBooktabs = (t: Table) => t.hrules.some((r) => ["toprule", "midrule", "bottomrule", "cmidrule"].includes(r.kind) || r.space !== undefined);

/** The table describes a column with `>{…}`, `<{…}`, `m{…}` or `b{…}`, which need the array package. */
export const needsArray = (t: Table) =>
  t.env?.name !== "tabularx" &&
  [...(t.kinds ?? []), ...t.rows.flatMap((row) => row.map((at) => at.spec ?? ""))].some((kind) => /[<>]\{|(?:^|[|}])[mb]\{/.test(kind));

/** Whether a rule is drawn on boundary `b` under column `c`, merged cells taken into account. */
export function ruleUnder(t: Table, b: number, c: number): boolean {
  return drawnCols(t.hrules[b], columns(t))[c] && !crossed(t, b)[c];
}

export type Edge = "top" | "bottom" | "left" | "right";

/** Which columns the rule on boundary `b` is drawn under. */
function drawnUnder(t: Table, b: number): boolean[] {
  const cut = crossed(t, b);
  return drawnCols(t.hrules[b], columns(t)).map((on, c) => on && !cut[c]);
}

/** Whether a block has a line along one of its edges. */
export function hasEdge(table: Table, block: Rect, edge: Edge): boolean {
  const rect = expandRect(table, block);
  if (edge === "left") return table.vrules[rect.left];
  if (edge === "right") return table.vrules[rect.right + 1];
  const drawn = drawnUnder(table, edge === "top" ? rect.top : rect.bottom + 1);
  for (let c = rect.left; c <= rect.right; c++) if (!drawn[c]) return false;
  return true;
}

/**
 * Draw a line along one edge of a block, or take it away if it is there. A line above or
 * below runs under the block's columns only. A line beside it runs the whole height of the
 * table, because that is all a LaTeX column description can say.
 */
export function toggleEdge(table: Table, block: Rect, edge: Edge): Table {
  const t = copy(table);
  const rect = expandRect(t, block);
  const on = !hasEdge(t, rect, edge);
  if (edge === "left" || edge === "right") {
    const b = edge === "left" ? rect.left : rect.right + 1;
    t.vrules[b] = on;
    return fixRules(respec(t, b));
  }
  const b = edge === "top" ? rect.top : rect.bottom + 1;
  const was = t.hrules[b];
  const cols = drawnUnder(t, b);
  for (let c = rect.left; c <= rect.right; c++) cols[c] = on;
  const cut = crossed(t, b);
  if (cols.every((drawn, c) => drawn || cut[c])) {
    // Under every column it can be: a full rule, of the kind it was if it was one already,
    // and in a table drawn in the booktabs style, the booktabs rule for where it is.
    const book = needsBooktabs(t) ? (b === 0 ? "toprule" : b === t.rows.length ? "bottomrule" : "midrule") : "hline";
    t.hrules[b] = { kind: was.kind === "none" || was.kind === "cline" || was.kind === "cmidrule" ? book : was.kind, ...extrasOf(was) };
  } else if (needsBooktabs(t)) {
    // Part of a row in a booktabs table: \cmidrule pieces, trimmed at their ends as is usual,
    // or as they were for a piece that is not new.
    const pieces = runs(cols).map((p) => (was.segs ?? []).find((seg) => seg.a === p.a && seg.b === p.b) ?? { ...p, trim: "lr" });
    t.hrules[b] = { kind: "cmidrule", segs: pieces, ...extrasOf(was) };
  } else t.hrules[b] = { kind: "cline", cols, ...extrasOf(was) };
  return fixRules(t);
}

/** Whether `tex` is, from end to end, the one argument of `\name`. */
function wholly(tex: string, name: string): boolean {
  const head = `\\${name}{`;
  return tex.startsWith(head) && closing(tex, head.length - 1) === tex.length;
}

/** Every cell of a block that has text in it is set in `\name`, as Bold or Italic would make it. */
export function cellsStyled(table: Table, block: Rect, name: string): boolean {
  const rect = expandRect(table, block);
  let any = false;
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) {
      const at = table.rows[r][c];
      if (at.hidden || !at.tex) continue;
      if (!wholly(at.tex, name)) return false;
      any = true;
    }
  }
  return any;
}

/**
 * Set the text of every cell in a block in `\name`, such as `\textbf`, or take it out of it if
 * every one is already. Empty cells are left empty.
 */
export function toggleStyle(table: Table, block: Rect, name: string): Table {
  const t = copy(table);
  const rect = expandRect(t, block);
  const off = cellsStyled(t, rect, name);
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) {
      const at = t.rows[r][c];
      if (at.hidden || !at.tex) continue;
      if (off) at.tex = at.tex.slice(name.length + 2, -1);
      else if (!wholly(at.tex, name)) at.tex = `\\${name}{${at.tex}}`;
    }
  }
  return t;
}

/** Empty every cell of a block. */
export function clearCells(table: Table, block: Rect): Table {
  const t = copy(table);
  const rect = expandRect(t, block);
  for (let r = rect.top; r <= rect.bottom; r++) for (let c = rect.left; c <= rect.right; c++) t.rows[r][c].tex = "";
  return t;
}

/** The LaTeX of each cell of a block, by rows, for the clipboard. A merged cell is named once. */
export function cellsOf(table: Table, block: Rect): string[][] {
  const rect = expandRect(table, block);
  const out: string[][] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const row: string[] = [];
    for (let c = rect.left; c <= rect.right; c++) row.push(table.rows[r][c].hidden ? "" : table.rows[r][c].tex);
    out.push(row);
  }
  return out;
}

/**
 * Put a block of cell texts into the table with its top left at `r`, `c`, as pasting cells
 * does: rows and columns are added at the end when it does not fit. Null when a merged cell
 * is in the way, since it is not clear where the texts that fall on it should go.
 */
export function pasteCells(table: Table, r: number, c: number, texts: string[][]): Table | null {
  let t = copy(table);
  const height = texts.length;
  const width = Math.max(0, ...texts.map((row) => row.length));
  if (!height || !width) return null;
  while (t.rows.length < r + height) t = insertRow(t, t.rows.length);
  while (columns(t) < c + width) t = insertColumn(t, columns(t));
  for (let dr = 0; dr < height; dr++) {
    for (let dc = 0; dc < width; dc++) {
      const at = t.rows[r + dr][c + dc];
      if (at.hidden || isMerged(t, r + dr, c + dc)) return null;
      at.tex = texts[dr][dc] ?? "";
    }
  }
  return t;
}

/** Spaces, line ends and comments: what may stand between a box's braces and what is in it. */
const GAP = String.raw`(?:\s|(?<!\\)%[^\n]*(?:\n|$))*`;
const ARG = String.raw`\{[^{}]*\}${GAP}`;
const OPT = String.raw`\[[^\]]*\]${GAP}`;
/** A box command, with exactly the arguments it takes, whose last brace opens just before the end. */
const BOX = new RegExp(
  String.raw`\\(?:resizebox\*?\s*${ARG}${ARG}|scalebox\s*${ARG}(?:${OPT})?|adjustbox\s*${ARG}|parbox\s*(?:${OPT})*${ARG}|(?:makebox|framebox)\s*(?:${OPT})*|fbox\s*|mbox\s*)\{${GAP}$`,
);

/**
 * The text to take out of a document to delete the tabular at `from`..`to`. A `table` float or
 * a `center` that holds nothing else but its caption, label and \centering goes with it.
 */
export function tableRemoval(text: string, from: number, to: number): Change {
  const settings = /^(?:\s+|\\centering(?![a-zA-Z@])|\\label\{[^{}]*\}|\\(?:small|footnotesize|scriptsize|tiny)(?![a-zA-Z@]))/;
  /** Nothing but whitespace, a caption, a label or a setting. */
  const bare = (rest: string): boolean => {
    for (let s = rest; ; ) {
      if (s === "") return true;
      const m = settings.exec(s);
      if (m) {
        s = s.slice(m[0].length);
        continue;
      }
      const cap = /^\\caption\*?\s*(?:\[[^\]]*\]\s*)?\{/.exec(s);
      const end = cap ? closing(s, cap[0].length - 1) : -1;
      if (end < 0) return false;
      s = s.slice(end);
    }
  };
  let [start, stop] = [from, to];
  for (let level = 0; level < 4; level++) {
    // A box that held nothing else, such as \resizebox{\linewidth}{!}{…}: left empty it
    // would not compile.
    const box = BOX.exec(text.slice(0, start));
    const shut = new RegExp(`^${GAP}\\}`).exec(text.slice(stop));
    if (box && shut) {
      [start, stop] = [box.index, stop + shut[0].length];
      continue;
    }
    const opener = [...text.slice(0, start).matchAll(/\\begin\{(table\*?|center)\}(?:\[[^\]]*\])?/g)].pop();
    if (!opener) break;
    const close = `\\end{${opener[1]}}`;
    const end = text.indexOf(close, stop);
    if (end < 0) break;
    const inner = opener.index + opener[0].length;
    if (!bare(text.slice(inner, start)) || !bare(text.slice(stop, end))) break;
    [start, stop] = [opener.index, end + close.length];
  }
  // The line the table stood on goes too, when nothing else was on it.
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  if (/^[ \t]*$/.test(text.slice(lineStart, start))) {
    const after = /^[ \t]*(?:\r?\n|$)/.exec(text.slice(stop));
    if (after) [start, stop] = [lineStart, stop + after[0].length];
  }
  return { from: start, to: stop, insert: "" };
}

/** The table has a cell merged downwards, which needs the multirow package. */
export const needsMultirow = (t: Table) => t.rows.some((row) => row.some((at) => !at.hidden && at.rowSpan > 1));

// ---------- the text around a table ----------

export interface Change {
  from: number;
  to: number;
  insert: string;
}

/**
 * What to add to a document so that it loads the multirow package: a change to make, "present"
 * when it already does, or "no-preamble" when this file has no preamble to add it to.
 */
export function ensureMultirow(text: string): PackageNeed {
  return ensurePackage(text, "multirow");
}

/**
 * Packages that provide what another one does, or clash with it if it is loaded as well, and
 * document classes that load it themselves.
 */
const PROVIDED: Record<string, { packages: string[]; classes?: RegExp }> = {
  amssymb: { packages: ["unicode-math", "newtxmath", "newpxmath", "stix", "stix2", "mathabx", "libertinust1math", "mtpro2", "txfonts", "pxfonts", "kpfonts", "mathdesign"] },
  amsmath: { packages: ["mathtools", "physics", "empheq"], classes: /^ams(?:art|book|proc)$/ },
  array: { packages: ["tabularx", "tabulary", "colortbl", "dcolumn", "tabu", "nicematrix", "array"] },
};

/**
 * What adding a package comes to: the change to make, or why there is none. "present": the
 * document loads it, or something that provides it. "no-preamble": this file has none, being
 * included by another. "elsewhere": the preamble reads another file, which may load it or
 * something that clashes with it, so it is left to the user.
 */
export type PackageNeed = Change | "present" | "no-preamble" | "elsewhere";

/** The same for any package: what to add so that the document loads `name`. */
export function ensurePackage(text: string, name: string): PackageNeed {
  // Judged on the text with comments and verbatim blanked out, every character in its place:
  // a \begin{document} in a comment is not where the document begins.
  const { clean } = uncommented(text);
  const begin = clean.indexOf("\\begin{document}");
  const preamble = begin < 0 ? clean : clean.slice(0, begin);
  const also = PROVIDED[name] ?? { packages: [] };
  const names = [name, ...also.packages].map((n) => n.replace(/[-]/g, "\\-")).join("|");
  if (new RegExp(`\\\\(?:usepackage|RequirePackage)\\s*(?:\\[[^\\]]*\\])?\\s*\\{[^}]*(?<![\\w-])(?:${names})(?![\\w-])[^}]*\\}`).test(preamble)) return "present";
  const klass = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(preamble);
  if (klass && also.classes?.test(klass[1].trim())) return "present";
  if (begin < 0 || !klass) return "no-preamble";
  const reads = preamble.replace(/\\input\s*(?:\{\s*glyphtounicode(?:\.tex)?\s*\}|\s+glyphtounicode(?:\.tex)?(?![\w.-]))/g, "");
  if (/\\(?:input|include|import|subimport|InputIfFileExists)(?![a-zA-Z@])/.test(reads)) return "elsewhere";
  // On a line of its own just before the document starts: the one place in a preamble that
  // is never inside a condition or a group.
  const at = text.lastIndexOf("\n", begin) + 1;
  const lead = text.slice(at, begin);
  return /^[ \t]*$/.test(lead) ? { from: at, to: at, insert: `\\usepackage{${name}}\n` } : { from: begin, to: begin, insert: `\n\\usepackage{${name}}\n` };
}

/** What to tell the user when a package could not be added for them, or null when it could. */
export function packageNotice(name: string, need: PackageNeed): string | null {
  if (need === "no-preamble") return `This needs \\usepackage{${name}}, and this file has no preamble to add it to. Add it to your main file's preamble.`;
  if (need === "elsewhere") return `This needs \\usepackage{${name}}. Your preamble reads another file, which may load it already, so it was not added: check, and add it if it is missing.`;
  return null;
}

/** Environments that can carry a caption. */
const FLOATS = new Set(["table", "table*", "sidewaystable", "figure", "figure*", "subtable", "subfigure"]);
/** Environments a table may sit in, inside its float, and still take a caption. */
const PLAIN = new Set(["center", "flushleft", "flushright"]);
/** Document classes known to have an ordinary `table` float. */
const CLASSES = /^(?:article|report|book|scrartcl|scrreprt|scrbook|memoir|amsart|amsbook|amsproc|IEEEtran|llncs|acmart|elsarticle|revtex4(?:-[12])?|extarticle|extreport|extbook|ctexart|ctexrep|ctexbook)$/;
/**
 * Every `\caption` in `clean`: where the command starts and where its opening brace is. The
 * short form in square brackets is stepped over with its own brackets and braces counted.
 */
function captionsIn(clean: string): { index: number; brace: number }[] {
  const out: { index: number; brace: number }[] = [];
  for (const m of clean.matchAll(/\\caption\*?(?![a-zA-Z@])/g)) {
    let at = m.index + m[0].length;
    const skip = () => {
      while (/[ \t\r\n]/.test(clean[at] ?? "")) at++;
    };
    skip();
    if (clean[at] === "[") {
      let depth = 0;
      for (; at < clean.length; at++) {
        if (clean[at] === "\\") at++;
        else if (clean[at] === "[" || clean[at] === "{") depth++;
        else if ((clean[at] === "]" || clean[at] === "}") && --depth === 0) break;
      }
      at++;
      skip();
    }
    if (clean[at] === "{") out.push({ index: m.index, brace: at });
    else out.push({ index: m.index, brace: -1 });
  }
  return out;
}

/**
 * The text with everything that only looks like LaTeX blanked out, each character still where
 * it was: comments and verbatim text, taken in the order they come. `sure` is false when some
 * verbatim text could not be followed to its end, so that what comes after it may be misread.
 */
function uncommented(text: string): { clean: string; sure: boolean } {
  const out = text.split("");
  let sure = true;
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === "%") {
      const stop = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
      blank(i, stop);
      i = stop;
    } else if (ch !== "\\") i++;
    else {
      const rest = text.slice(i, i + 40);
      const env = /^\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|comment|filecontents\*?)\}/.exec(rest);
      const inline = /^\\(?:verb|lstinline|mintinline|Verb|path|nolinkurl)\*?(?![a-zA-Z@])/.exec(rest);
      const address = /^\\(?:url|href|hyperref|nolinkurl|path)[ \t]*\{/.exec(rest);
      if (address) {
        // A web address in braces is taken whole and kept: a percent sign in it is part of it.
        const stop = closing(text, i + address[0].length - 1);
        if (stop < 0) sure = false;
        i = stop < 0 ? i + address[0].length : stop;
      } else if (env) {
        const close = `\\end{${env[1]}}`;
        const found = text.indexOf(close, i);
        if (found < 0) sure = false;
        const stop = found < 0 ? text.length : found + close.length;
        blank(i, stop);
        i = stop;
      } else if (inline) {
        // Verbatim in a line: after any options, up to the same mark again, or for braces to
        // the matching one. \mintinline names its language in braces first.
        const lineEnd = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
        let at = i + inline[0].length;
        // TikZ has a \path of its own, followed by a coordinate, an option or a word, never by
        // a mark. Spaces may come before the mark of the other \path, as with \verb, so what
        // follows them decides.
        if (inline[0] === "\\path") while (text[at] === " " || text[at] === "\t") at++;
        if (inline[0] === "\\path" && /[\r\n([a-zA-Z\\]/.test(text[at] ?? " ")) {
          i += inline[0].length;
          continue;
        }
        if (text[at] === "[") at = text.indexOf("]", at) + 1 || lineEnd + 1;
        if (inline[0].startsWith("\\mintinline") && text[at] === "{") at = closing(text, at);
        const mark = at > 0 && at < lineEnd ? text[at] : undefined;
        const stop = mark === undefined || /[a-zA-Z\s]/.test(mark) ? -1 : mark === "{" ? closing(text, at) : text.indexOf(mark, at + 1) + 1;
        if (stop <= 0 || stop > lineEnd) sure = false;
        const end = stop <= 0 || stop > lineEnd ? lineEnd : stop;
        blank(i, end);
        i = end;
      } else i += 2;
    }
  }
  return { clean: out.join(""), sure };
}

export type CaptionPlace =
  /** In a float: where the float's body is, and its caption's braces if it has one. */
  | { kind: "float"; from: number; to: number; open?: number; close?: number; start?: number; labelled: boolean }
  /** On the page with nothing around it: a float can be put around it. */
  | { kind: "bare" }
  /** Somewhere a caption cannot be put, or changed, with certainty that the document still compiles. */
  | { kind: "no"; reason: string };

const SOURCE = "Add or change it in the source.";

/** How deep in braces `to` is, counted from `from`. Escaped braces do not count. */
function braceDepth(clean: string, from: number, to: number): number {
  let depth = 0;
  for (let i = from; i < to; i++) {
    if (clean[i] === "\\") i++;
    else if (clean[i] === "{") depth++;
    else if (clean[i] === "}") depth--;
  }
  return depth;
}

/**
 * Where the caption of the tabular at `from`..`to` is or could go. This is deliberately
 * cautious: a caption in the wrong place stops a document compiling, so the tool acts only on
 * the two plain shapes it can be sure of, and leaves everything else to the source:
 *
 * - a table that is a paragraph of its own in the body of an ordinary document, and
 * - a table directly in a float, alone there, with at most one caption of the float's own.
 */
export function captionPlace(text: string, from: number, to: number): CaptionPlace {
  const { clean, sure } = uncommented(text);
  const refuse = (why: string): CaptionPlace => ({ kind: "no", reason: `${why} ${SOURCE}` });
  if (!sure) return refuse("This document has verbatim text that cannot be followed to its end.");
  if (text.startsWith("\\begin{longtable}", from)) return refuse("A longtable is not put in a float: its caption is written as its own first row.");
  const body = clean.indexOf("\\begin{document}");
  if (body < 0 || body > from) return refuse("This file is included by another, so the table's surroundings cannot be seen from here.");
  // 3. A preamble that itself begins or ends anything, by whatever command, may have the
  // document start or end inside it.
  const HIDDEN = /\\(?:begin|end|bgroup|egroup|begingroup|endgroup|table|endtable|figure|endfigure|minipage|endminipage|AtBeginDocument|AtEndDocument|AddToHook|everypar|catcode|csname|@nameuse|MakeShortVerb|DefineShortVerb|lstMakeShortInline)(?![a-zA-Z@])/;
  if (HIDDEN.test(clean.slice(0, body))) return refuse("This document's preamble makes commands or hooks that begin or end environments.");
  // Anything that can open or close an environment or a group out of sight makes the
  // surroundings unknowable: home-made commands that do, and the plain TeX forms.
  // The same for anything defined in the body, by any of the commands that define.
  for (const m of clean.slice(body).matchAll(/\\(?:[gex]?def|let|(?:re)?newcommand|providecommand|(?:New|Renew|Provide|Declare)(?:Expandable)?Document(?:Command|Environment)|DeclareRobustCommand|(?:re)?newenvironment|(?:re)?newrobustcmd|providerobustcmd|catcode|AtEndDocument)(?![a-zA-Z@])/g)) {
    const at = body + m.index;
    // The definition runs to the end of the last of the arguments that follow the command.
    let stop = at + m[0].length;
    if (clean[stop] === "*") stop++;
    for (let groups = 0, i = stop; groups < 8 && i < clean.length; ) {
      while (/[ \t\r\n]/.test(clean[i] ?? "") && !/^\r?\n[ \t]*\r?\n/.test(clean.slice(i))) i++;
      // The parameters of a \def, whatever marks them off, stand between its name and its
      // body: step over them to the brace that opens the body, on this line or the next.
      if (groups === 1 && /def$/.test(m[0]) && clean[i] !== "{") {
        const brace = clean.indexOf("{", i);
        const far = clean.indexOf("\n", clean.indexOf("\n", i) + 1);
        if (brace >= 0 && (far < 0 || brace < far)) i = brace;
      }
      const next = clean[i];
      // Only the first thing after the command can be the bare name of what is defined.
      const name = next === "\\" && groups === 0 ? i + 1 + (/^[a-zA-Z@]+/.exec(clean.slice(i + 1))?.[0].length ?? 1) : -1;
      const end = next === "{" ? closing(clean, i) : next === "[" ? clean.indexOf("]", i) + 1 : name;
      // An argument that never closes cannot be followed: take in everything to the next blank line.
      if ((next === "{" || next === "[") && end <= 0) {
        stop = clean.indexOf("\n\n", i) < 0 ? clean.length : clean.indexOf("\n\n", i);
        break;
      }
      if (end <= 0) break;
      stop = i = end;
      groups++;
    }
    const defined = clean.slice(at, stop);
    if (m[0] === "\\catcode" || m[0] === "\\AtEndDocument" || HIDDEN.test(defined.slice(m[0].length))) {
      return refuse("This document makes its own commands that begin or end environments.");
    }
  }
  const text0 = clean.slice(body);
  if (/\\(?:begin|end)(?![a-zA-Z@{])/.test(text0)) return refuse("An environment here is begun or ended in a way that cannot be followed.");
  // Conditions, and commands built or passed around by name, can make the text mean something
  // other than it shows.
  if (/\\(?:if(?!f(?![a-zA-Z@]))[a-zA-Z@]*|else|fi|csname|@nameuse|expandafter|futurelet|let|vadjust|noexpand)(?![a-zA-Z@])/.test(text0)) {
    return refuse("This document uses conditions or commands built by name in its body.");
  }
  // The environments open at the table, outermost first.
  const open: { name: string; at: number }[] = [];
  for (const m of clean.slice(body, from).matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
    if (m[1] === "begin") open.push({ name: m[2], at: body + m.index });
    else if (open.length && open[open.length - 1].name === m[2]) open.pop();
    else return refuse("The environments before this table do not match up.");
  }
  if (open[0]?.name !== "document") return refuse("This table comes after the end of the document.");
  let floatAt = open.length - 1;
  while (floatAt > 0 && !FLOATS.has(open[floatAt].name)) floatAt--;
  const inner = open.slice(floatAt + 1).filter((env) => !PLAIN.has(env.name));
  if (inner.length) return refuse(`This table is inside a ${inner[inner.length - 1].name} environment, where a caption cannot go.`);
  const since = open[floatAt].at;
  const around = clean.slice(since, from);
  if (/\\(?:bgroup|egroup|begingroup|endgroup|setbox|hbox|vbox|vtop|table|endtable|figure|endfigure|minipage|endminipage)\b/.test(around)) {
    return refuse("A group or box is opened here in a way that cannot be followed.");
  }
  // Inside the braces of a box such as \resizebox a caption or a float would not compile.
  if (braceDepth(clean, since, from) !== 0) return refuse("This table is inside the braces of another command, where a caption cannot go.");
  // Nor inside the square brackets of a command, however far back they opened.
  for (const m of around.matchAll(/\\[a-zA-Z@]+\*?[ \t]*(?:\r?\n[ \t]*)?\[/g)) {
    let depth = 0;
    let at = since + m.index + m[0].length - 1;
    for (; at < clean.length; at++) {
      if (clean[at] === "\\") at++;
      else if (clean[at] === "[") depth++;
      else if (clean[at] === "]" && --depth === 0) break;
    }
    if (at >= from) return refuse("This table is inside the square brackets of another command, where a caption cannot go.");
  }
  // Nor inside mathematics, which cannot reach across a blank line.
  const paragraph = Math.max(since, clean.lastIndexOf("\n\n", from) + 1);
  let math = false;
  let display = false;
  for (let i = paragraph; i < from; i++) {
    const ch = clean[i];
    if (ch === "\\") {
      const next = clean[i + 1];
      if (next === "[" || next === "(") math = true;
      if (next === "]" || next === ")") math = false;
      i++;
    } else if (ch === "$" && clean[i + 1] === "$") {
      display = !display;
      i++;
    } else if (ch === "$") math = !math;
  }
  if (math || display) return refuse("This table is inside mathematics, where a caption cannot go.");

  if (floatAt === 0) {
    // On the page itself. A float can be put around the table only when it is a paragraph
    // of its own, directly in the body of a document whose class has ordinary floats.
    const klass = /\\documentclass[ \t\r\n]*(?:\[[^\]]*\])?[ \t\r\n]*\{([^}]*)\}/.exec(clean.slice(0, body));
    if (!klass || !CLASSES.test(klass[1].trim())) return refuse("This kind of document may not have ordinary table floats.");
    if (open.length > 1) return refuse(`This table is inside a ${open[open.length - 1].name} environment and not yet in a float.`);
    const lineStart = clean.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = clean.indexOf("\n", to) < 0 ? clean.length : clean.indexOf("\n", to);
    // Judged on the text as written: a line holding only a comment is not a blank line.
    const before = text.slice(text.lastIndexOf("\n", lineStart - 2) + 1, from);
    const after = text.slice(to, text.indexOf("\n", lineEnd + 1) < 0 ? text.length : text.indexOf("\n", lineEnd + 1));
    const own = (trimSpaces(before) === "" || trimSpaces(before) === "\\begin{document}") && (trimSpaces(after) === "" || /^[ \t]*\r?\n[ \t]*\\end\{document\}/.test(text.slice(to)));
    if (!own) return refuse("This table is not a paragraph of its own: put a blank line before and after it first.");
    if (clean.slice(body).includes("\\captionof")) return refuse("A caption is given in this document with \\captionof.");
    return { kind: "bare" };
  }
  const float = open[floatAt];
  const end = clean.indexOf(`\\end{${float.name}}`, to);
  if (end < 0) return refuse("The environment this table is in is not finished.");
  const inside = clean.slice(float.at, end);
  if (/\\begin\{(?:table|figure|sidewaystable)\*?\}/.test(clean.slice(to, end))) return refuse("The environment this table is in is not finished.");
  if ((inside.match(/\\begin\{tabular[x*]?\}/g) ?? []).length > 1) return refuse("This table shares its float with another, so it is not clear whose caption is whose.");
  if (inside.includes("\\captionof")) return refuse("A caption is given here with \\captionof.");
  const found = captionsIn(inside);
  if (found.length > 1) return refuse("This table's float has more than one caption.");
  if (found.some((c) => c.brace < 0)) return refuse("The caption in this float is written in a way that cannot be followed.");
  const labelled = inside.includes("\\label");
  if (found.length === 0) {
    // The new caption goes straight after the table, which must be the float's own level.
    if (braceDepth(clean, to, end) !== 0) return refuse("This table is inside the braces of another command, where a caption cannot go.");
    // A line break, a note or anything else written straight after the table would be cut
    // off from it by a caption put in between.
    // Judged on the text as written, where a comment is not a blank line.
    const quiet = (rest: string): boolean => {
      if (/^[ \t]*\r?\n[ \t]*\r?\n/.test(rest)) return true;
      const next = rest.replace(/^[ \t\r\n]+/, "");
      if (next === "" || /^\\end\{/.test(next) || /^\\par(?![a-zA-Z@])/.test(next)) return true;
      const label = /^\\label\{[^{}]*\}/.exec(next);
      return label ? quiet(next.slice(label[0].length)) : false;
    };
    if (!quiet(text.slice(to, end))) return refuse("Something is written straight after this table in its float.");
    return { kind: "float", from: float.at, to: end, labelled };
  }
  const start = float.at + found[0].index;
  const brace = float.at + found[0].brace;
  const close = closing(clean, brace);
  if (close < 0 || close > end) return refuse("The caption this table has is not finished.");
  // The caption must be the float's own: not inside a box, nor in a part of the float with
  // a caption to itself, such as a sub-figure beside the table.
  const nested = [...clean.slice(float.at, start).matchAll(/\\(begin|end)\{([^}]*)\}/g)].slice(1);
  let level = 0;
  for (const m of nested) if (!PLAIN.has(m[2]) && !/^tabular/.test(m[2])) level += m[1] === "begin" ? 1 : -1;
  if (level !== 0 || braceDepth(clean, float.at, start) !== 0) return refuse("The caption in this float belongs to something else in it.");
  // What is offered for editing must be the whole of the caption and nothing but it.
  if (clean.slice(brace + 1, close - 1) !== text.slice(brace + 1, close - 1)) return refuse("The caption has a comment or verbatim text in it.");
  if (/\n[ \t\r]*\n/.test(text.slice(brace + 1, close - 1))) return refuse("The caption has a blank line in it.");
  return { kind: "float", from: float.at, to: end, open: brace + 1, close: close - 1, start, labelled };
}

/** The caption of the tabular at `from`..`to`, or null when it has none. */
export function captionOf(text: string, from: number, to: number): string | null {
  const place = captionPlace(text, from, to);
  // Written over several lines, a caption reads as one: a line end is a space.
  return place.kind === "float" && place.open !== undefined ? text.slice(place.open, place.close).replace(/[ \t]*\r?\n[ \t]*/g, " ") : null;
}

/**
 * Give the tabular at `from`..`to` a caption, change the one it has, or with an empty caption
 * take it away. A tabular that stands alone is put in a `table` environment to carry it.
 * Nothing is changed where a caption cannot go.
 */
export function setCaption(text: string, from: number, to: number, caption: string): Change[] {
  const place = captionPlace(text, from, to);
  if (place.kind === "no") return [];
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart, from))![0];
  if (place.kind === "bare") {
    if (!caption) return [];
    return [
      { from, to: from, insert: `\\begin{table}[h]\n${indent}\\centering\n${indent}` },
      { from: to, to, insert: `\n${indent}\\caption{${caption}}\n${indent}\\end{table}` },
    ];
  }
  if (place.open === undefined || place.close === undefined || place.start === undefined) {
    return caption ? [{ from: to, to, insert: `\n${indent}\\caption{${caption}}` }] : [];
  }
  if (caption) return [{ from: place.open, to: place.close, insert: caption }];
  // Take the caption's whole line with it when nothing else is on that line.
  const [start, end] = [place.start, place.close + 1];
  const before = text.lastIndexOf("\n", start - 1);
  const after = text.indexOf("\n", end);
  const alone = trimSpaces(text.slice(before + 1, start)) === "" && trimSpaces(text.slice(end, after < 0 ? text.length : after)) === "";
  return [alone && before >= 0 ? { from: before, to: after < 0 ? text.length : after, insert: "" } : { from: start, to: end, insert: "" }];
}

/** The smallest single change that turns `before` into `after`. */
export function smallestChange(before: string, after: string, offset = 0): Change | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { from: offset + start, to: offset + before.length - end, insert: after.slice(start, after.length - end) };
}

// ---------- text going into cells ----------

/**
 * A bare & or % typed in a cell means the character, so it is written the way LaTeX prints
 * it. Inside mathematics an & is left alone: there it separates the columns of a matrix.
 */
export function escapeTyped(value: string): string {
  let out = "";
  let math = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") {
      const next = value[i + 1] ?? "";
      if (next === "(" || next === "[") math = true;
      if (next === ")" || next === "]") math = false;
      out += ch + next;
      i++;
      continue;
    }
    if (ch === "$") math = !math;
    out += ch === "%" || (ch === "&" && !math) ? `\\${ch}` : ch;
  }
  return out;
}

/**
 * Commands with an argument that is text to be read, not a name, a number or a formula, and
 * which of their braced arguments that is. It is always their last.
 */
const PROSE = new Map<string, number>([
  ...[
    "textbf", "textit", "emph", "texttt", "textsc", "textrm", "textsf", "textmd", "textup", "textsl", "textnormal", "underline", "mbox", "footnote", "caption",
    "makecell", "thead", "fbox", "makebox", "framebox", "shortstack", "textsuperscript", "textsubscript", "uppercase", "MakeUppercase", "MakeLowercase",
    "hyperref", "enquote", "sout", "uline", "hl", "rlap", "llap", "hbox", "centerline", "tnote", "text", "intertext", "uwave", "xout", "st", "textls",
    "tablefootnote", "footnotetext", "marginpar", "thanks", "textoverline", "ul", "MakeTextUppercase", "MakeTextLowercase", "textcircled", "tabularnote",
    "multirowcell",
  ].map((name): [string, number] => [name, 1]),
  ...["href", "textcolor", "colorbox", "parbox", "rotatebox", "raisebox", "foreignlanguage", "scalebox", "captionof", "pbox", "adjustbox"].map(
    (name): [string, number] => [name, 2],
  ),
  ...["multicolumn", "multirow", "resizebox", "fcolorbox"].map((name): [string, number] => [name, 3]),
]);
/** Declarations, which take no argument: braces written after one are just a group of text. */
const DECLARATIONS = new Set([
  "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "bfseries", "mdseries", "itshape", "slshape",
  "scshape", "upshape", "ttfamily", "sffamily", "rmfamily", "normalfont", "centering", "raggedright", "raggedleft", "em", "bf", "it", "tt", "rm", "sf", "sc",
]);
/** Commands that take no argument and no options: a [ or { after one is text. */
const NO_ARGS = new Set([
  "LaTeX", "TeX", "LaTeXe", "today", "ldots", "dots", "textbackslash", "textasciitilde", "textasciicircum", "newline", "linebreak", "par", "noindent",
  "hfill", "vfill", "quad", "qquad", "S", "P", "copyright", "dag", "ddag", "textregistered", "texttrademark", "textcopyright", "textdegree", "euro",
  "texteuro", "pounds", "textbullet", "slash", "xspace", "ss", "aa", "AA", "o", "O", "ae", "AE", "oe", "OE",
]);
/** Commands whose arguments are names, numbers or formulas, and how many braced ones they take. */
const NAMES = new Map<string, number>([
  ...["label", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "nameref", "cite", "citep", "citet", "citeauthor", "citeyear", "parencite", "textcite",
    "autocite", "url", "nolinkurl", "includegraphics", "vspace", "hspace", "color", "si", "num", "ang", "input", "include", "hyperlink", "hypertarget",
    "phantom", "hphantom", "vphantom", "unit", "qty"].map((name): [string, number] => [name, 1]),
  ...["rule", "SI", "setlength", "addtolength", "setcounter", "addtocounter"].map((name): [string, number] => [name, 2]),
]);

/** The command just before `at`, with the arguments written so far: its name and how many braced ones. */
function ownerOf(text: string, at: number): { name: string; braced: number; args: string } | null {
  const m = /\\([a-zA-Z@]+)\*?((?:\s*\[[^\]]*\]|\s*\{[^{}]*\})*)\s*$/.exec(text.slice(Math.max(0, at - 400), at));
  return m ? { name: m[1], braced: (m[2].match(/\{[^{}]*\}/g) ?? []).length, args: m[2] } : null;
}

/** How many braced arguments a command takes, when it is one this module knows. */
const arity = (name: string) => PROSE.get(name) ?? NAMES.get(name) ?? (NO_ARGS.has(name) || DECLARATIONS.has(name) ? 0 : undefined);

/** Whether a [ after the command and arguments before it opens its options. */
function opensOptions(owner: { name: string; braced: number } | null): boolean {
  if (!owner) return false;
  const most = arity(owner.name);
  // A command this module does not know may take options anywhere.
  return most === undefined || (most > 0 && owner.braced < most);
}

/** Whether a { after the command and arguments before it opens a group that holds prose. */
function opensProse(owner: { name: string; braced: number; args: string } | null): boolean {
  if (!owner) return true;
  const most = arity(owner.name);
  // A group past the last argument a command takes is just a group of text.
  if (most !== undefined && owner.braced >= most) return true;
  return PROSE.get(owner.name) === owner.braced + 1;
}

/**
 * For each place in `text` (one more than it has characters), whether it is a place where
 * prose is written: the top level, a plain group, or the text argument of a command known to
 * take prose. Inside the argument or the options of any other command it is not, because there
 * an underscore is part of a name, a unit or a formula and must be left as it is typed.
 */
function proseAt(text: string): Uint8Array {
  const out = new Uint8Array(text.length + 1);
  const open: { ch: string; prose: boolean }[] = [];
  let notProse = 0;
  for (let i = 0; i < text.length; i++) {
    out[i] = notProse === 0 ? 1 : 0;
    const ch = text[i];
    if (ch === "\\") {
      out[i + 1] = out[i];
      i++;
    } else if (ch === "{" || (ch === "[" && opensOptions(ownerOf(text, i)))) {
      const prose = ch === "{" && opensProse(ownerOf(text, i));
      open.push({ ch, prose });
      if (!prose) notProse++;
    } else if ((ch === "}" || ch === "]") && open.length && open[open.length - 1].ch === (ch === "}" ? "{" : "[")) {
      if (!open.pop()!.prose) notProse--;
    }
  }
  out[text.length] = notProse === 0 ? 1 : 0;
  return out;
}

/** Commands whose argument is text again, inside a formula. */
const TEXT_IN_MATH = /^(?:text|textrm|textit|textbf|textsf|texttt|textnormal|textup|mbox|hbox|intertext|emph)$/;

/**
 * For each place in `text` (one more than it has characters), what it stands in: 0 for text,
 * 1 for a formula in the line ($…$ or \(…\)), 2 for a display ($$…$$ or \[…\]). The argument of
 * \text and the like inside a formula is text again.
 */
function mathAt(text: string): Uint8Array {
  const out = new Uint8Array(text.length + 1);
  const open: string[] = [];
  const top = () => open[open.length - 1];
  const mode = () => {
    for (let k = open.length - 1; k >= 0; k--) {
      const o = open[k];
      if (o === "text") return 0;
      if (o === "$" || o === "\\)") return 1;
      if (o === "$$" || o === "\\]") return 2;
    }
    return 0;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1] ?? "";
      if (next === "(" || next === "[") {
        open.push(next === "(" ? "\\)" : "\\]");
        out[i] = out[i + 1] = mode();
        i++;
        continue;
      }
      if ((next === ")" || next === "]") && top() === `\\${next}`) {
        out[i] = out[i + 1] = mode();
        open.pop();
        i++;
        continue;
      }
      const name = /^[a-zA-Z@]+/.exec(text.slice(i + 1, i + 40))?.[0];
      if (!name) {
        out[i] = out[i + 1] = mode();
        i++;
        continue;
      }
      let at = i + 1 + name.length;
      if (mode() > 0 && TEXT_IN_MATH.test(name)) {
        while (text[at] === " ") at++;
        if (text[at] === "{") {
          for (let k = i; k <= at; k++) out[k] = mode();
          open.push("text");
          i = at;
          continue;
        }
      }
      for (let k = i; k < i + 1 + name.length; k++) out[k] = mode();
      i += name.length;
    } else if (ch === "$") {
      // A $ closes $…$ even with another straight after it: $x$$y$ is two formulas. Two
      // together otherwise open or close a display, just as one does a formula in the line.
      if (top() === "$") {
        out[i] = 1;
        open.pop();
      } else if (text[i + 1] === "$") {
        if (top() === "$$") open.pop();
        else open.push("$$");
        out[i] = out[i + 1] = 2;
        i++;
      } else {
        open.push("$");
        out[i] = 1;
      }
    } else if (ch === "{") {
      out[i] = mode();
      open.push("{");
    } else if (ch === "}") {
      out[i] = mode();
      if (top() === "{" || top() === "text") open.pop();
    } else out[i] = mode();
  }
  out[text.length] = mode();
  return out;
}

/**
 * What stops text going into a caption, or into a cell, as it stands, said for the user; null
 * when nothing does. Its braces must match and it must end no group early; its mathematics must
 * be closed and in the line, since a display cannot stand in a cell or a caption; and it must
 * have no character on its own that LaTeX would act on: a bare % anywhere, an & outside an
 * environment, or a #, _ or ^ written in prose outside mathematics.
 */
export function cellProblem(text: string): string | null {
  let depth = 0;
  let dollars = 0;
  let envs = 0;
  const math = mathAt(text);
  const prose = proseAt(text);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      // A backslash with nothing after it would take the closing brace for itself.
      if (i + 1 >= text.length) return "It ends in a backslash on its own; write a backslash as \\textbackslash{}.";
      if (text.startsWith("\\begin{", i)) envs++;
      if (text.startsWith("\\end{", i)) envs--;
      i++;
    } else if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return "A closing brace } has no opening brace { to match it.";
    else if (ch === "%") return "A % on its own would start a comment; write it as \\%.";
    else if (ch === "$") dollars++;
    else if (ch === "&" && envs <= 0) return "An & on its own would end the cell; write it as \\&.";
    else if (math[i] === 0 && prose[i]) {
      if (ch === "#") return "A # on its own does not print; write it as \\#.";
      if (ch === "_") return "An underscore in text must be written \\_, or put in a formula as $a_1$.";
      if (ch === "^") {
        const word = /\S*$/.exec(text.slice(0, i))![0] + /^\S*/.exec(text.slice(i))![0];
        return `A ^ outside a formula does not print. For a power write $${word}$; for the sign itself, \\textasciicircum{}.`;
      }
    }
  }
  if (depth > 0) return "An opening brace { is not closed with }.";
  if (math.includes(2)) return "A display formula ($$…$$ or \\[…\\]) cannot go in a table cell or a caption; write it in the line, as $…$.";
  // Mathematics left open would swallow whatever comes after.
  if (math[text.length] !== 0 || dollars % 2 !== 0) return "A $ starts a formula that is not closed; write a dollar sign as \\$.";
  return null;
}

/** Whether text can be a caption, or a cell, as it stands (see `cellProblem`). */
export function soundCaption(caption: string): boolean {
  return cellProblem(caption) === null;
}

/**
 * Whether a formula in `text` looks like a sum of money written with plain dollar signs, as in
 * "from $5 to $10": it compiles, but sets the words between as mathematics.
 */
export function looksLikeMoney(text: string): boolean {
  const math = mathAt(text);
  for (const m of text.matchAll(/(?<!\\)\$(?!\$)([^$]*)(?<!\\)\$/g)) {
    if (math[m.index] !== 1) continue;
    if (/^\s*\d[\d.,]*\s+[a-zA-Z]{2,}/.test(m[1])) return true;
  }
  return false;
}

/**
 * The same, for a box that already held text: only the characters that were put in are looked
 * at, wherever in the text they went. What was there before is the user's own LaTeX and is
 * left exactly as it was.
 *
 * Typed in prose, a `%`, `#` or `&` is written with a backslash, and so is an `_`. In
 * mathematics, and in the argument of a command that takes a name, a number or a formula,
 * they are left as typed. When a character that carries such a backslash is deleted, the
 * backslash goes with it.
 */
export function escapeInserted(before: string, after: string): string {
  const [n, m] = [before.length, after.length];
  // Which character of `before` each character of `after` is, or -1 for one that was put in:
  // the longest run of shared characters, in order.
  const from = new Int32Array(m).fill(-1);
  if (n * m <= 4_000_000) {
    const width = m + 1;
    const table = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = before[i] === after[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    for (let i = 0, j = 0; i < n && j < m; ) {
      if (before[i] === after[j]) from[j++] = i++;
      else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
      else j++;
    }
  } else {
    // Too long to compare in full: take what the two have in common at each end.
    let start = 0;
    while (start < n && start < m && before[start] === after[start]) start++;
    let end = 0;
    while (end < n - start && end < m - start && before[n - 1 - end] === after[m - 1 - end]) end++;
    for (let j = 0; j < start; j++) from[j] = j;
    for (let k = 1; k <= end; k++) from[m - k] = n - k;
  }
  const escapedIn = (text: string, i: number) => /\\*$/.exec(text.slice(0, i))![0].length % 2 === 1;
  const SPECIAL = "&%#_";
  // For each place in `after`, which character of `before` the nearest kept one on either
  // side is: what was typed in between does not make neighbours of old into strangers.
  const keptBefore = new Int32Array(m).fill(-1);
  const keptAfter = new Int32Array(m).fill(-1);
  for (let j = 1; j < m; j++) keptBefore[j] = from[j - 1] >= 0 ? from[j - 1] : keptBefore[j - 1];
  for (let j = m - 2; j >= 0; j--) keptAfter[j] = from[j + 1] >= 0 ? from[j + 1] : keptAfter[j + 1];
  // Where each character of the new text stands, worked out once: escaping only adds or takes
  // away backslashes before & % # _, which changes neither.
  const mathMap = mathAt(after);
  const proseMap = proseAt(after);
  // Where each character of `before` that was kept now is.
  const posOf = new Int32Array(n).fill(-1);
  for (let j = 0; j < m; j++) if (from[j] >= 0) posOf[from[j]] = j;
  let out = "";
  for (let j = 0; j < m; j++) {
    const ch = after[j];
    const i = from[j];
    const escaped = /\\*$/.exec(out)![0].length % 2 === 1;
    if (i >= 0) {
      // There before. A backslash whose character has been deleted goes with it ...
      const orphan = ch === "\\" && !escapedIn(before, i) && SPECIAL.includes(before[i + 1] ?? " ") && keptAfter[j] !== i + 1;
      if (orphan) continue;
      // ... and a character whose backslash has been deleted gets it back. Not when all that
      // was typed between the two is backslashes: that is a command being typed in front of
      // the escape, such as \, before \%.
      const lost = SPECIAL.includes(ch) && escapedIn(before, i) && !escaped;
      const typedInFront = i >= 1 && keptBefore[j] === i - 1 && /^\\*$/.test(after.slice(posOf[i - 1] + 1, j));
      out += lost && !typedInFront ? `\\${ch}` : ch;
      continue;
    }
    const math = mathMap[j] > 0;
    const bare = !escaped && (ch === "%" || ch === "#" || (ch === "&" && !math) || (ch === "_" && !math && proseMap[j] === 1));
    out += bare ? `\\${ch}` : ch;
  }
  return out;
}

// ---------- tables from the clipboard ----------

const ESCAPES: Record<string, string> = {
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "\\": "\\textbackslash{}",
};

/** Plain text as LaTeX that prints the same characters. */
export function escapeTex(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[&%$#_{}~^\\]/g, (ch) => ESCAPES[ch]);
}

/** One cell as copied: its text, and how many columns and rows it covers. */
export interface Copied {
  text: string;
  colSpan?: number;
  rowSpan?: number;
}

/** A table from copied rows of cells, merged cells included. Null when there is no table. */
export function tableFromCopied(copied: Copied[][]): Table | null {
  const rowCount = copied.length;
  if (rowCount === 0) return null;
  // Lay the cells out on a grid first, to find how many columns there are.
  const taken: boolean[][] = Array.from({ length: rowCount }, () => []);
  const placed: { r: number; c: number; at: Copied; w: number; h: number }[] = [];
  copied.forEach((row, r) => {
    let c = 0;
    for (const at of row) {
      while (taken[r][c]) c++;
      // Spans that run into cells already placed, as malformed copied HTML can have, are cut
      // back to the room there is.
      let w = Math.max(1, Math.min(50, at.colSpan ?? 1));
      while (w > 1 && taken[r].slice(c, c + w).some(Boolean)) w--;
      let h = Math.max(1, Math.min(rowCount - r, at.rowSpan ?? 1));
      while (h > 1 && taken[r + h - 1].slice(c, c + w).some(Boolean)) h--;
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) taken[r + dr][c + dc] = true;
      placed.push({ r, c, at, w, h });
      c += w;
    }
  });
  const colCount = Math.max(...taken.map((row) => row.length));
  if (!Number.isFinite(colCount) || colCount < 1 || colCount > 60 || rowCount > 500) return null;
  const t = newTable(rowCount, colCount);
  for (const p of placed) {
    for (let dr = 0; dr < p.h; dr++) for (let dc = 0; dc < p.w; dc++) t.rows[p.r + dr][p.c + dc] = cell("", true);
    t.rows[p.r][p.c] = { tex: escapeTex(p.at.text), colSpan: Math.min(p.w, colCount - p.c), rowSpan: p.h, hidden: false };
  }
  return fixRules(t);
}

/** Cells from text copied out of a spreadsheet: tabs between cells, a line for each row. */
export function copiedFromPlain(text: string): Copied[][] | null {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (!text.includes("\t") || lines.length > 500) return null;
  // Indented text has tabs too. A table has no line that starts with one, and the same
  // number of cells, at least two, on every line.
  if (lines.some((line) => line.startsWith("\t"))) return null;
  const rows = lines.map((line) => line.split("\t").map((cellText) => ({ text: cellText })));
  return rows[0].length > 1 && rows.every((row) => row.length === rows[0].length) ? rows : null;
}
