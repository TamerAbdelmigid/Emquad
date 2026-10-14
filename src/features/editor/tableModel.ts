// A table as the table editor sees it, and the LaTeX it is read from and written to. Pure: no
// editor, no DOM. The .tex source is the only truth; this module turns a `tabular` into a grid,
// changes the grid, and writes the `tabular` back.
//
// Only tables that can be written back without loss are read. Anything else (a nested table, a
// column type other than l, c and r, a comment, a rule or macro this module does not model)
// is reported as not editable, so the editor shows it read-only and never rewrites it.

export type Align = "l" | "c" | "r";

/**
 * The rule meant on one horizontal boundary: none, a full rule, or a `\cline` over some columns.
 * Where a cell merged downwards crosses the boundary the rule is not drawn through it; that
 * is worked out when the table is written, so the rule comes back by itself if the cell is
 * split again.
 */
export interface Rule {
  kind: "none" | "hline" | "toprule" | "midrule" | "bottomrule" | "cline";
  /** For `cline`: which columns the rule runs under. */
  cols?: boolean[];
}

export interface Cell {
  tex: string;
  colSpan: number;
  rowSpan: number;
  /** Covered by a merged cell that starts above or to the left. */
  hidden: boolean;
  /** The column description of a hand-written `\multicolumn`, kept as it was written. */
  spec?: string;
}

export interface Table {
  /** One per column. */
  aligns: Align[];
  /** One per vertical boundary, so one more than there are columns. */
  vrules: boolean[];
  /** `rows[r][c]`; every row has one cell per column. */
  rows: Cell[][];
  /** One per horizontal boundary, so one more than there are rows. */
  hrules: Rule[];
  /** The optional position argument, such as `t`. */
  pos?: string;
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
const copy = (t: Table): Table => ({
  aligns: [...t.aligns],
  vrules: [...t.vrules],
  rows: t.rows.map((row) => row.map((c) => ({ ...c }))),
  hrules: t.hrules.map((r) => ({ kind: r.kind, ...(r.cols ? { cols: [...r.cols] } : {}) })),
  ...(t.pos ? { pos: t.pos } : {}),
});
const columns = (t: Table) => t.aligns.length;

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
  "begin", "end", "tabularnewline", "noalign", "rowcolor", "columncolor", "endhead", "endfirsthead", "endfoot", "endlastfoot", "cmidrule",
  "specialrule", "addlinespace", "arrayrulecolor", "hhline", "input", "include", "newline", "cr", "omit", "span", "multispan", "hdashline",
  "cdashline", "morecmidrules", "extracolsep", "vline", "arraybackslash", "makecell", "diagbox", "nopagebreak", "pagebreak", "captionof",
  "verb", "Verb", "lstinline", "mintinline", "path", "nolinkurl", "crcr",
]);
const RULES = new Set(["hline", "cline", "toprule", "midrule", "bottomrule"]);
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
 * whatever is written next.
 */
function trimTex(text: string): string {
  // A cell written over two lines reads as one: to TeX a single line end is a space.
  const out = trimSpaces(text).replace(/[ \t]*\r?\n[ \t]*/g, " ");
  const slashes = /\\+$/.exec(out)?.[0].length ?? 0;
  return slashes % 2 === 1 && /[ \t\r\n]$/.test(text) ? `${out} ` : out;
}
const RULE_AT_START = /^[ \t\r\n]*(?:\\(hline|toprule|midrule|bottomrule)(?![a-zA-Z@])|\\cline[ \t\r\n]*\{[ \t\r\n]*(\d+)[ \t\r\n]*-[ \t\r\n]*(\d+)[ \t\r\n]*\})/;
const RULE_ANYWHERE = /\\(?:hline|cline|toprule|midrule|bottomrule)(?![a-zA-Z@])/;
const no = (reason: string): Parsed => ({ ok: false, reason });

/**
 * Read a whole `\begin{tabular}…\end{tabular}`. A table is only accepted if writing it out
 * and reading that again gives the very same table, so nothing can be read that would not be
 * kept.
 */
export function parseTable(source: string): Parsed {
  const read = readTable(source);
  if (!read.ok) return read;
  const again = readTable(writeTable(read.table));
  if (!again.ok || JSON.stringify(again.table) !== JSON.stringify(read.table)) return no("It is written in a way that cannot be kept exactly");
  return read;
}

function readTable(source: string): Parsed {
  const head = /^\\begin\{tabular\}[ \t\r\n]*(?:\[([tbc])\])?[ \t\r\n]*\{/.exec(source);
  if (!head) return no("Only plain tabular tables can be edited here");
  const specEnd = closing(source, head[0].length - 1);
  const tail = /\\end\{tabular\}[ \t\r\n]*$/.exec(source);
  if (specEnd < 0 || !tail || tail.index < specEnd) return no("The table is not finished");
  const spec = source.slice(head[0].length, specEnd - 1);
  if (!/^[lcr| \t\r\n]*$/.test(spec)) return no("It uses a column type other than l, c and r");
  if (/\|[ \t\r\n]*\|/.test(spec)) return no("It uses double vertical rules");
  const aligns: Align[] = [];
  const vrules: boolean[] = [false];
  for (const ch of spec.replace(/[ \t\r\n]/g, "")) {
    if (ch === "|") vrules[vrules.length - 1] = true;
    else {
      aligns.push(ch as Align);
      vrules.push(false);
    }
  }
  if (aligns.length === 0) return no("It has no columns");

  // Cut the body into rows and cells, at the top level of braces only.
  const body = source.slice(specEnd, tail.index);
  const chunks: string[][] = [[""]];
  const add = (text: string) => {
    const row = chunks[chunks.length - 1];
    row[row.length - 1] += text;
  };
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      const next = body[i + 1] ?? "";
      if (next === "\\" && depth === 0) {
        i++;
        const after = /^[ \t\r\n]*([*[])/.exec(body.slice(i + 1));
        if (after) return no("It sets the space after a row by hand");
        chunks.push([""]);
      } else if (/[a-zA-Z@]/.test(next)) {
        const name = /^[a-zA-Z@]+/.exec(body.slice(i + 1))![0];
        if (UNKNOWN.has(name)) return no(name === "begin" ? "It has another environment inside it" : `It uses \\${name}, which cannot be edited here`);
        // An address given between two bars instead of braces is verbatim as well.
        if (name === "url" && body[i + 1 + name.length] !== "{") return no("It uses \\url without braces, which cannot be edited here");
        if (!RULES.has(name) && name !== "rule" && SOME_RULE.test(name)) return no(`It uses \\${name}, a kind of rule that cannot be edited here`);
        add(`\\${name}`);
        i += name.length;
      } else {
        add(c + next);
        i++;
      }
    } else if (c === "%") return no("It has a comment inside it");
    else if (c === "&" && depth === 0) chunks[chunks.length - 1].push("");
    else {
      if (c === "{") depth++;
      if (c === "}" && --depth < 0) return no("Its braces do not match");
      add(c);
    }
  }
  if (depth !== 0) return no("Its braces do not match");

  const n = aligns.length;
  const hrules: Rule[] = [];
  const raw: string[][] = [];
  for (let k = 0; k < chunks.length; k++) {
    const cells = chunks[k];
    const rule: Rule = { kind: "none" };
    for (let m = RULE_AT_START.exec(cells[0]); m; m = RULE_AT_START.exec(cells[0])) {
      cells[0] = cells[0].slice(m[0].length);
      if (m[1]) {
        if (rule.kind !== "none") return no("It has more than one rule between two rows");
        rule.kind = m[1] as Rule["kind"];
        // What follows a booktabs rule in brackets is its thickness, not text.
        if (m[1] !== "hline" && /^[ \t\r\n]*\[/.test(cells[0])) return no("It sets the thickness of a rule");
      } else {
        const [a, b] = [Number(m[2]), Number(m[3])];
        if (rule.kind !== "none" && rule.kind !== "cline") return no("It has more than one rule between two rows");
        if (a < 1 || b > n || a > b) return no("A \\cline names columns the table does not have");
        rule.kind = "cline";
        rule.cols ??= Array.from({ length: n }, () => false);
        for (let col = a; col <= b; col++) rule.cols[col - 1] = true;
      }
    }
    if (cells.some((text) => RULE_ANYWHERE.test(text))) return no("It has a rule in the middle of a row");
    if (cells.some((text) => /\n[ \t\r]*\n/.test(trimSpaces(text)))) return no("It has a blank line inside a cell");
    hrules.push(rule);
    const last = k === chunks.length - 1;
    if (last && cells.length === 1 && trimSpaces(cells[0]) === "") break;
    raw.push(cells.map(trimTex));
    // A last row written without its line end has no rule under it.
    if (last) hrules.push({ kind: "none" });
  }
  if (raw.length === 0) return no("It has no rows");

  const rows: Cell[][] = [];
  for (const texts of raw) {
    const row: Cell[] = [];
    for (let tex of texts) {
      const made = cell();
      const multi = /^\\multicolumn[ \t\r\n]*\{[ \t\r\n]*(\d+)[ \t\r\n]*\}[ \t\r\n]*\{/.exec(tex);
      if (multi) {
        const specClose = closing(tex, multi[0].length - 1);
        const open = specClose < 0 ? -1 : tex.indexOf("{", specClose);
        const end = open < 0 ? -1 : closing(tex, open);
        if (end !== tex.length || trimSpaces(tex.slice(specClose, open)) !== "") return no("A \\multicolumn is written in a way that cannot be edited here");
        made.colSpan = Number(multi[1]);
        made.spec = tex.slice(multi[0].length, specClose - 1).replace(/[ \t\r\n]/g, "");
        if (!/^\|?[lcr]\|?$/.test(made.spec) || made.colSpan < 1) return no("A \\multicolumn uses a column type other than l, c and r");
        tex = trimTex(tex.slice(open + 1, end - 1));
      }
      const down = /^\\multirow[ \t\r\n]*\{[ \t\r\n]*(\d+)[ \t\r\n]*\}[ \t\r\n]*\{[ \t\r\n]*\*[ \t\r\n]*\}[ \t\r\n]*\{/.exec(tex);
      if (down) {
        if (closing(tex, down[0].length - 1) !== tex.length) return no("A \\multirow is written in a way that cannot be edited here");
        made.rowSpan = Number(down[1]);
        if (made.rowSpan < 2) return no("A \\multirow covers fewer than two rows");
        tex = trimTex(tex.slice(down[0].length, -1));
      }
      if (/\\multi(?:column|row)(?![a-zA-Z@])/.test(tex)) return no("A merged cell is written in a way that cannot be edited here");
      made.tex = tex;
      row.push(made);
      for (let extra = 1; extra < made.colSpan; extra++) row.push(cell("", true));
    }
    if (row.length !== n) return no("A row does not have one cell for every column");
    rows.push(row);
  }
  const table: Table = { aligns, vrules, rows, hrules, ...(head[1] ? { pos: head[1] } : {}) };
  // A cell merged downwards is followed, in the rows it covers, by empty cells of its width,
  // described the way this module would describe them.
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < n; c++) {
      const top = rows[r][c];
      if (top.hidden || top.rowSpan === 1) continue;
      if (r + top.rowSpan > rows.length) return no("A \\multirow covers more rows than the table has");
      const described = top.colSpan > 1 ? (top.spec ?? specFor(table, c, top.colSpan)) : undefined;
      for (let below = r + 1; below < r + top.rowSpan; below++) {
        const under = rows[below][c];
        if (under.hidden || under.tex !== "" || under.rowSpan !== 1 || under.colSpan !== top.colSpan) return no("The cells under a \\multirow are not empty");
        if (under.spec !== described) return no("The empty cells under a \\multirow are described differently from it");
        for (let col = c; col < c + top.colSpan; col++) rows[below][col] = cell("", true);
      }
    }
  }
  // A rule written straight through a merged cell cannot be kept: it would be cut on writing.
  for (let b = 1; b < rows.length; b++) {
    const through = hrules[b].kind !== "none" && hrules[b].kind !== "cline" && crossed(table, b).some(Boolean);
    const partly = hrules[b].kind === "cline" && crossed(table, b).some((cut, c) => cut && hrules[b].cols?.[c]);
    if (through || partly) return no("A rule runs through a merged cell");
  }
  return { ok: true, table: normalize(table) };
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

/** The LaTeX for a rule, drawn only under the columns not in `cut`. */
function ruleLine(rule: Rule, cut: boolean[]): string {
  if (rule.kind === "none") return "";
  if (rule.kind !== "cline" && !cut.some(Boolean)) return `\\${rule.kind}`;
  let out = "";
  const cols = cut.map((gone, c) => !gone && (rule.kind !== "cline" || Boolean(rule.cols?.[c])));
  for (let c = 0; c < cols.length; c++) {
    if (!cols[c]) continue;
    let end = c;
    while (cols[end + 1]) end++;
    out += `\\cline{${c + 1}-${end + 1}}`;
    c = end;
  }
  return out;
}

/** Write the table as LaTeX. Lines after the first start with `indent`. */
export function writeTable(t: Table, indent = ""): string {
  const spec = t.aligns.map((a, c) => (t.vrules[c] ? "|" : "") + a).join("") + (t.vrules[columns(t)] ? "|" : "");
  const lines = [`\\begin{tabular}${t.pos ? `[${t.pos}]` : ""}{${spec}}`];
  const rule = (b: number) => {
    const line = ruleLine(t.hrules[b], crossed(t, b));
    if (line) lines.push(line);
  };
  rule(0);
  t.rows.forEach((row, r) => {
    const out: string[] = [];
    for (let c = 0; c < row.length; c++) {
      const at = row[c];
      if (!at.hidden) {
        const inner = at.rowSpan > 1 ? `\\multirow{${at.rowSpan}}{*}{${at.tex}}` : at.tex;
        out.push(at.colSpan > 1 || at.spec ? `\\multicolumn{${at.colSpan}}{${at.spec ?? specFor(t, c, at.colSpan)}}{${inner}}` : inner);
        c += at.colSpan - 1;
        continue;
      }
      // Under a cell merged downwards: an empty cell of the same width.
      const owner = anchorOf(t, r, c);
      const top = t.rows[owner.r][owner.c];
      out.push(top.colSpan > 1 ? `\\multicolumn{${top.colSpan}}{${top.spec ?? specFor(t, c, top.colSpan)}}{}` : "");
      c += top.colSpan - 1;
    }
    lines.push(trimSpaces(`${trimSpaces(out.join(" & "))} \\\\`));
    rule(r + 1);
  });
  lines.push("\\end{tabular}");
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
 * way: a `\cline` says nothing about columns a merged cell crosses, one that runs under every
 * other column is a full rule, and one that runs under none is no rule. A booktabs rule that
 * a merged cell has come to cross becomes an ordinary one, which can be drawn around the cell.
 */
function normalize(t: Table): Table {
  t.hrules = t.hrules.map((rule, b): Rule => {
    const cut = crossed(t, b);
    // A boundary that merged cells cross from end to end has no rule to speak of.
    if (rule.kind === "none" || cut.every(Boolean)) return { kind: "none" };
    if (rule.kind === "hline") return { kind: "hline" };
    if (rule.kind !== "cline") return cut.some(Boolean) ? { kind: "hline" } : { kind: rule.kind };
    const cols = cut.map((gone, c) => !gone && Boolean(rule.cols?.[c]));
    if (!cols.some(Boolean)) return { kind: "none" };
    // Running under everything a merged cell leaves free, it is a full rule drawn around
    // the cell. With no merged cell in the way it stays the \cline it was written as.
    if (cut.some(Boolean) && cols.every((on, c) => on || cut[c])) return { kind: "hline" };
    return { kind: "cline", cols };
  });
  // A description that says only what the table's own columns say need not be remembered.
  t.rows.forEach((row) =>
    row.forEach((at, c) => {
      if (at.spec && at.colSpan > 1 && at.spec === specFor(t, c, at.colSpan)) delete at.spec;
    }),
  );
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
  for (let b = r + 1; b < r + at.rowSpan; b++) {
    const rule = t.hrules[b];
    if (rule.kind === "cline" && rule.cols) for (let col = c; col < c + at.colSpan; col++) rule.cols[col] = true;
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
  t.vrules.splice(c + 1, 0, bar);
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
  t.vrules.splice(at === 0 ? 1 : at, 0, bar);
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
  t.vrules.splice(c === n - 1 ? c : c + 1, 1);
  for (const rule of t.hrules) rule.cols?.splice(c, 1);
  return fixRules(t);
}

/** Align every column a block touches. */
export function setAlign(table: Table, block: Rect, align: Align): Table {
  const t = copy(table);
  const rect = expandRect(t, block);
  for (let c = rect.left; c <= rect.right; c++) t.aligns[c] = align;
  for (const row of t.rows) {
    row.forEach((at, c) => {
      if (at.spec && c >= rect.left && c <= rect.right) at.spec = at.spec.replace(/[lcr]/, align);
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
  t.hrules = t.hrules.map((): Rule => ({ kind: on ? "hline" : "none" }));
  t.rows.forEach((row) =>
    row.forEach((at, c) => {
      // A hand-written description keeps its alignment and takes the table's new bars.
      if (at.spec) at.spec = (c === 0 && on ? "|" : "") + (/[lcr]/.exec(at.spec)?.[0] ?? t.aligns[c]) + (on ? "|" : "");
    }),
  );
  return fixRules(t);
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
        return;
      }
      at.spec = (c === 0 && t.vrules[0] ? "|" : "") + (/[lcr]/.exec(at.spec)?.[0] ?? t.aligns[c]) + (t.vrules[c + at.colSpan] ? "|" : "");
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
  t.hrules = t.hrules.map((_, b): Rule => {
    const ends = edge(b, m);
    if (style === "all" || (style === "outside" && ends) || (style === "inside" && !ends) || (style === "header" && (ends || b === 1))) return { kind: "hline" };
    if (style === "book") return b === 0 ? { kind: "toprule" } : b === m ? { kind: "bottomrule" } : b === 1 ? { kind: "midrule" } : { kind: "none" };
    return { kind: "none" };
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
export const needsBooktabs = (t: Table) => t.hrules.some((r) => r.kind === "toprule" || r.kind === "midrule" || r.kind === "bottomrule");

export type Edge = "top" | "bottom" | "left" | "right";

/** Which columns the rule on boundary `b` is drawn under. */
function drawnUnder(t: Table, b: number): boolean[] {
  const rule = t.hrules[b];
  const cut = crossed(t, b);
  return t.aligns.map((_, c) => !cut[c] && rule.kind !== "none" && (rule.kind !== "cline" || Boolean(rule.cols?.[c])));
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
    t.hrules[b] = { kind: was.kind === "none" || was.kind === "cline" ? book : was.kind };
  } else t.hrules[b] = { kind: "cline", cols };
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
const ARG = String.raw`\{[^{}]*\}\s*`;
const OPT = String.raw`\[[^\]]*\]\s*`;
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
  const reads = preamble.replace(/\\input\s*\{?\s*glyphtounicode(?:\.tex)?\s*\}?/g, "");
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
        // TikZ has a \path of its own, followed by a space and never by a mark.
        if (inline[0] === "\\path" && /[ \t\r\n([]/.test(text[at] ?? " ")) {
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
 * Whether text can be a caption, or a cell, as it stands: its braces match, it ends no group
 * early, its mathematics is closed, and it has no character on its own that LaTeX would act
 * on: a bare % anywhere, or a #, _ or ^ written in prose outside mathematics.
 */
export function soundCaption(caption: string): boolean {
  let depth = 0;
  let dollars = 0;
  const math = mathAt(caption);
  for (let i = 0; i < caption.length; i++) {
    const ch = caption[i];
    if (ch === "\\") {
      // A backslash with nothing after it would take the closing brace for itself.
      if (++i >= caption.length) return false;
    } else if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return false;
    else if (ch === "%") return false;
    else if (ch === "$") dollars++;
    else if ((ch === "#" || ch === "_" || ch === "^") && !math[i] && inProse(caption.slice(0, i))) return false;
  }
  // Mathematics left open would swallow whatever comes after.
  return depth === 0 && math[caption.length] === 0 && dollars % 2 === 0;
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
 * which of their braced arguments that is.
 */
const PROSE = new Map<string, number>([
  ...[
    "textbf", "textit", "emph", "texttt", "textsc", "textrm", "textsf", "textmd", "textup", "textsl", "textnormal", "underline", "mbox", "footnote", "caption",
    "makecell", "thead", "fbox", "makebox", "framebox", "shortstack", "textsuperscript", "textsubscript", "uppercase", "MakeUppercase", "MakeLowercase",
    "hyperref", "enquote", "sout", "uline", "hl", "rlap", "llap", "hbox", "centerline", "tnote",
  ].map((name): [string, number] => [name, 1]),
  ...["href", "textcolor", "colorbox", "parbox", "rotatebox", "raisebox", "foreignlanguage", "scalebox"].map((name): [string, number] => [name, 2]),
  ...["multicolumn", "multirow", "resizebox"].map((name): [string, number] => [name, 3]),
]);
/** Declarations, which take no argument: braces written after one are just a group of text. */
const DECLARATIONS = new Set([
  "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "bfseries", "mdseries", "itshape", "slshape",
  "scshape", "upshape", "ttfamily", "sffamily", "rmfamily", "normalfont", "centering", "raggedright", "raggedleft", "em", "bf", "it", "tt", "rm", "sf", "sc",
]);

/**
 * Whether the end of `text` is a place where prose is written: the top level, a plain group,
 * or the text argument of a command known to take prose. Inside the argument or the options of
 * any other command it is not, because there an underscore is part of a name, a unit or a
 * formula and must be left as it is typed.
 */
function inProse(text: string): boolean {
  const open: { ch: string; at: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "{") open.push({ ch, at: i });
    else if (ch === "[" && /\\[a-zA-Z@]+\*?(?:\{[^{}]*\}|\[[^\]]*\])*$/.test(text.slice(0, i))) open.push({ ch, at: i });
    else if ((ch === "}" || ch === "]") && open.length && open[open.length - 1].ch === (ch === "}" ? "{" : "[")) open.pop();
  }
  // Every group the text is inside must be one that holds prose.
  return open.every((group) => {
    if (group.ch === "[") return false;
    const owner = /\\([a-zA-Z@]+)\*?((?:\[[^\]]*\]|\{[^{}]*\})*)$/.exec(text.slice(0, group.at));
    if (!owner || (DECLARATIONS.has(owner[1]) && owner[2] === "")) return true;
    // Which braced argument of the command this group is.
    const nth = (owner[2].match(/\{[^{}]*\}/g) ?? []).length + 1;
    return PROSE.get(owner[1]) === nth;
  });
}

/** For each character of `text`, whether it stands in mathematics opened with $, $$, \( or \[. */
function mathAt(text: string): Uint8Array {
  const out = new Uint8Array(text.length + 1);
  let math = false;
  /** The formula open now was opened with a single $. */
  let inline = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "(" || next === "[" || next === ")" || next === "]") {
        math = next === "(" || next === "[";
        inline = false;
      }
      out[i] = out[i + 1] = math ? 1 : 0;
      i++;
    } else if (ch === "$") {
      // A $ closes $…$ even with another straight after it: $x$$y$ is two formulas. Two
      // together otherwise open or close a display, just as one does a formula in the line.
      const double: boolean = !(math && inline) && text[i + 1] === "$";
      if (double) out[i++] = 1;
      out[i] = 1;
      inline = !math && !double;
      math = !math;
    } else out[i] = math ? 1 : 0;
  }
  out[text.length] = math ? 1 : 0;
  return out;
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
  let out = "";
  for (let j = 0; j < m; j++) {
    const ch = after[j];
    const i = from[j];
    const escaped = /\\*$/.exec(out)![0].length % 2 === 1;
    if (i >= 0) {
      // There before. A backslash whose character has been deleted goes with it ...
      const orphan = ch === "\\" && !escapedIn(before, i) && SPECIAL.includes(before[i + 1] ?? " ") && keptAfter[j] !== i + 1;
      if (orphan) continue;
      // ... and a character whose backslash has been deleted gets it back.
      out += SPECIAL.includes(ch) && escapedIn(before, i) && keptBefore[j] !== i - 1 && !escaped ? `\\${ch}` : ch;
      continue;
    }
    // Where the text stands is only worked out for the characters it matters to.
    const math = (ch === "&" || ch === "_") && mathAt(out)[out.length] === 1;
    const bare = !escaped && (ch === "%" || ch === "#" || (ch === "&" && !math) || (ch === "_" && !math && inProse(out)));
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
      const w = Math.max(1, Math.min(50, at.colSpan ?? 1));
      const h = Math.max(1, Math.min(rowCount - r, at.rowSpan ?? 1));
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
