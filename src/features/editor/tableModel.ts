// A table as the table editor sees it, and the LaTeX it is read from and written to. Pure: no
// editor, no DOM. The .tex source is the only truth; this module turns a `tabular` into a grid,
// changes the grid, and writes the `tabular` back.
//
// Only tables that can be written back without loss are read. Anything else (a nested table, a
// column type other than l, c and r, a comment, a rule or macro this module does not model)
// is reported as not editable, so the editor shows it read-only and never rewrites it.

export type Align = "l" | "c" | "r";

/** The rule on one horizontal boundary: none, a full rule, or a `\cline` over some columns. */
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
]);
const RULE_AT_START = /^\s*(?:\\(hline|toprule|midrule|bottomrule)(?![a-zA-Z@])|\\cline\s*\{\s*(\d+)\s*-\s*(\d+)\s*\})/;
const RULE_ANYWHERE = /\\(?:hline|cline|toprule|midrule|bottomrule)(?![a-zA-Z@])/;
const no = (reason: string): Parsed => ({ ok: false, reason });

/** Read a whole `\begin{tabular}…\end{tabular}`. */
export function parseTable(source: string): Parsed {
  const head = /^\\begin\{tabular\}\s*(?:\[([tbc])\])?\s*\{/.exec(source);
  if (!head) return no("Only plain tabular tables can be edited here");
  const specEnd = closing(source, head[0].length - 1);
  const tail = /\\end\{tabular\}\s*$/.exec(source);
  if (specEnd < 0 || !tail || tail.index < specEnd) return no("The table is not finished");
  const spec = source.slice(head[0].length, specEnd - 1);
  if (!/^[lcr|\s]*$/.test(spec)) return no("It uses a column type other than l, c and r");
  if (/\|\s*\|/.test(spec)) return no("It uses double vertical rules");
  const aligns: Align[] = [];
  const vrules: boolean[] = [false];
  for (const ch of spec.replace(/\s/g, "")) {
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
        const after = /^\s*([*[])/.exec(body.slice(i + 1));
        if (after) return no("It sets the space after a row by hand");
        chunks.push([""]);
      } else if (/[a-zA-Z@]/.test(next)) {
        const name = /^[a-zA-Z@]+/.exec(body.slice(i + 1))![0];
        if (UNKNOWN.has(name)) return no(name === "begin" ? "It has another environment inside it" : `It uses \\${name}, which cannot be edited here`);
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
    hrules.push(rule);
    const last = k === chunks.length - 1;
    if (last && cells.length === 1 && cells[0].trim() === "") break;
    raw.push(cells.map((text) => text.trim()));
    // A last row written without its line end has no rule under it.
    if (last) hrules.push({ kind: "none" });
  }
  if (raw.length === 0) return no("It has no rows");

  const rows: Cell[][] = [];
  for (const texts of raw) {
    const row: Cell[] = [];
    for (let tex of texts) {
      const made = cell();
      const multi = /^\\multicolumn\s*\{\s*(\d+)\s*\}\s*\{/.exec(tex);
      if (multi) {
        const specClose = closing(tex, multi[0].length - 1);
        const open = specClose < 0 ? -1 : tex.indexOf("{", specClose);
        const end = open < 0 ? -1 : closing(tex, open);
        if (end !== tex.length || tex.slice(specClose, open).trim() !== "") return no("A \\multicolumn is written in a way that cannot be edited here");
        made.colSpan = Number(multi[1]);
        made.spec = tex.slice(multi[0].length, specClose - 1).replace(/\s/g, "");
        if (!/^\|?[lcr]\|?$/.test(made.spec) || made.colSpan < 1) return no("A \\multicolumn uses a column type other than l, c and r");
        tex = tex.slice(open + 1, end - 1).trim();
      }
      const down = /^\\multirow\s*\{\s*(\d+)\s*\}\s*\{\s*\*\s*\}\s*\{/.exec(tex);
      if (down) {
        if (closing(tex, down[0].length - 1) !== tex.length) return no("A \\multirow is written in a way that cannot be edited here");
        made.rowSpan = Number(down[1]);
        if (made.rowSpan < 1) return no("A \\multirow covers no rows");
        tex = tex.slice(down[0].length, -1).trim();
      }
      if (/\\multi(?:column|row)(?![a-zA-Z@])/.test(tex)) return no("A merged cell is written in a way that cannot be edited here");
      made.tex = tex;
      row.push(made);
      for (let extra = 1; extra < made.colSpan; extra++) row.push(cell("", true));
    }
    if (row.length !== n) return no("A row does not have one cell for every column");
    rows.push(row);
  }
  // A cell merged downwards is followed, in the rows it covers, by empty cells of its width.
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < n; c++) {
      const top = rows[r][c];
      if (top.hidden || top.rowSpan === 1) continue;
      if (r + top.rowSpan > rows.length) return no("A \\multirow covers more rows than the table has");
      for (let below = r + 1; below < r + top.rowSpan; below++) {
        const under = rows[below][c];
        if (under.hidden || under.tex !== "" || under.rowSpan !== 1 || under.colSpan !== top.colSpan) return no("The cells under a \\multirow are not empty");
        for (let col = c; col < c + top.colSpan; col++) rows[below][col] = cell("", true);
      }
    }
  }
  const table: Table = { aligns, vrules, rows, hrules, ...(head[1] ? { pos: head[1] } : {}) };
  // A description that says only what the table's own columns say need not be remembered.
  rows.forEach((row) =>
    row.forEach((at, c) => {
      if (at.spec && at.colSpan > 1 && at.spec === specFor(table, c, at.colSpan)) delete at.spec;
    }),
  );
  return { ok: true, table };
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

function ruleLine(rule: Rule): string {
  if (rule.kind === "none") return "";
  if (rule.kind !== "cline") return `\\${rule.kind}`;
  let out = "";
  const cols = rule.cols ?? [];
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
    const line = ruleLine(t.hrules[b]);
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
    lines.push(`${out.join(" & ").trim()} \\\\`.trimStart());
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
 * Keep rules out of merged cells: where a cell merged downwards crosses a boundary, the rule
 * there becomes a `\cline` that stops short of it. A `\cline` that has come to run under every
 * column is written as a full rule again.
 */
function fixRules(t: Table): Table {
  const n = columns(t);
  t.hrules = t.hrules.map((rule, b) => {
    if (rule.kind !== "hline" && rule.kind !== "cline") return rule;
    const cols = rule.kind === "hline" ? Array.from({ length: n }, () => true) : Array.from({ length: n }, (_, c) => rule.cols?.[c] ?? false);
    if (b > 0 && b < t.rows.length) {
      for (let c = 0; c < n; c++) {
        const owner = anchorOf(t, b, c);
        if (owner.r < b) cols[c] = false;
      }
    }
    if (cols.every(Boolean)) return { kind: "hline" };
    if (!cols.some(Boolean)) return { kind: "none" };
    return { kind: "cline", cols };
  });
  return t;
}

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
  // The rules that stopped short of the merged cell run under its cells again.
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
      // A cell merged across from this column keeps its text and starts one column later.
      t.rows[a.r][c + 1] = { ...at, colSpan: at.colSpan - 1 };
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
  return t;
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
export function ensureMultirow(text: string): Change | "present" | "no-preamble" {
  const begin = text.indexOf("\\begin{document}");
  const preamble = begin < 0 ? text : text.slice(0, begin);
  const uncommented = preamble.replace(/(?<!\\)%.*$/gm, "");
  if (/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{[^}]*\bmultirow\b[^}]*\}/.test(uncommented)) return "present";
  const klass = /^[^%\n]*\\documentclass(?:\[[^\]]*\])?\{[^}]*\}.*$/m.exec(preamble);
  if (!klass || begin < 0) return "no-preamble";
  // After the last package already loaded, or else after the document class.
  let at = klass.index + klass[0].length;
  for (const m of preamble.matchAll(/^[^%\n]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\}.*$/gm)) at = Math.max(at, m.index + m[0].length);
  return { from: at, to: at, insert: "\n\\usepackage{multirow}" };
}

/** The `table` environment a tabular at `from`..`to` sits in, if it sits in one. */
function floatAround(text: string, from: number, to: number): { from: number; to: number } | null {
  const open = text.lastIndexOf("\\begin{table}", from);
  if (open < 0 || text.slice(open, from).includes("\\end{table}")) return null;
  const close = text.indexOf("\\end{table}", to);
  if (close < 0 || text.slice(to, close).includes("\\begin{table}")) return null;
  return { from: open, to: close };
}

/** The caption of the tabular at `from`..`to`, or null when it has none. */
export function captionOf(text: string, from: number, to: number): string | null {
  const float = floatAround(text, from, to);
  if (!float) return null;
  const at = /\\caption\s*\{/.exec(text.slice(float.from, float.to));
  if (!at) return null;
  const open = float.from + at.index + at[0].length - 1;
  const end = closing(text, open);
  return end < 0 || end > float.to ? null : text.slice(open + 1, end - 1);
}

/**
 * Give the tabular at `from`..`to` a caption, change the one it has, or with an empty caption
 * take it away. A tabular that stands alone is put in a `table` environment to carry it.
 */
export function setCaption(text: string, from: number, to: number, caption: string): Change[] {
  const float = floatAround(text, from, to);
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart, from))![0];
  if (!float) {
    if (!caption) return [];
    return [
      { from, to: from, insert: `\\begin{table}[h]\n${indent}\\centering\n${indent}` },
      { from: to, to, insert: `\n${indent}\\caption{${caption}}\n${indent}\\end{table}` },
    ];
  }
  const at = /\\caption\s*\{/.exec(text.slice(float.from, float.to));
  if (!at) return caption ? [{ from: to, to, insert: `\n${indent}\\caption{${caption}}` }] : [];
  const start = float.from + at.index;
  const open = start + at[0].length - 1;
  const end = closing(text, open);
  if (end < 0 || end > float.to) return [];
  if (caption) return [{ from: open + 1, to: end - 1, insert: caption }];
  // Take the caption's whole line with it when nothing else is on that line.
  const before = text.lastIndexOf("\n", start - 1);
  const after = text.indexOf("\n", end);
  const alone = text.slice(before + 1, start).trim() === "" && text.slice(end, after < 0 ? text.length : after).trim() === "";
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

/** A bare & or % typed in a cell means the character, so it is written the way LaTeX prints it. */
export function escapeTyped(value: string): string {
  return value.replace(/(?<!\\)((?:\\\\)*)([&%])/g, "$1\\$2");
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
  const rows = lines.map((line) => line.split("\t").map((cellText) => ({ text: cellText })));
  return rows.some((row) => row.length > 1) ? rows : null;
}
