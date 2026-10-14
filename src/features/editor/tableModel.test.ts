import { describe, expect, it } from "vitest";
import {
  type Table,
  bordersStyle,
  captionOf,
  cellBars,
  cellProblem,
  cellRanges,
  cellsOf,
  cellsStyled,
  clearCells,
  captionPlace,
  copiedFromPlain,
  deleteColumn,
  deleteRow,
  ensureMultirow,
  ensurePackage,
  escapeInserted,
  oneLine,
  escapeTex,
  escapeTyped,
  expandRect,
  floatLabels,
  hasEdge,
  insertColumn,
  insertRow,
  looksLikeMoney,
  merge,
  needsArray,
  needsBooktabs,
  needsMultirow,
  newTable,
  parseTable,
  pasteCells,
  setBorders,
  setAlign,
  setCaption,
  setCell,
  smallestChange,
  soundCaption,
  splitIntoColumns,
  splitIntoRows,
  splitMerged,
  tableFromCopied,
  tableRemoval,
  toggleBorders,
  toggleEdge,
  toggleStyle,
  writeTable,
} from "./tableModel";

const read = (source: string): Table => {
  const parsed = parseTable(source);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.table;
};
const reason = (source: string) => {
  const parsed = parseTable(source);
  return parsed.ok ? "editable" : parsed.reason;
};
const tex = (t: Table) => t.rows.map((row) => row.map((c) => (c.hidden ? "·" : c.tex)));
/** A table with borders whose cells are named by row and column: a1 b1 / a2 b2 … */
const grid = (rowCount: number, colCount: number, borders = true): Table => {
  let t = newTable(rowCount, colCount, borders);
  for (let r = 0; r < rowCount; r++) for (let c = 0; c < colCount; c++) t = setCell(t, r, c, `${"abcdef"[c]}${r + 1}`);
  return t;
};
const apply = (text: string, changes: { from: number; to: number; insert: string }[]) =>
  [...changes].sort((a, b) => b.from - a.from).reduce((out, ch) => out.slice(0, ch.from) + ch.insert + out.slice(ch.to), text);

const HAND = String.raw`\begin{tabular}{|l|c|r|}
\hline
 Name & \textbf{Value} & Unit \\ \hline
 $x$ & 1\,000 & m \\
 50\% & a \& b & {x & y} \\
\hline
\end{tabular}`;

describe("reading a table", () => {
  it("reads columns, bars, rules and cells", () => {
    const t = read(HAND);
    expect(t.aligns).toEqual(["l", "c", "r"]);
    expect(t.vrules).toEqual([true, true, true, true]);
    expect(t.hrules.map((r) => r.kind)).toEqual(["hline", "hline", "none", "hline"]);
    expect(tex(t)).toEqual([
      ["Name", "\\textbf{Value}", "Unit"],
      ["$x$", "1\\,000", "m"],
      ["50\\%", "a \\& b", "{x & y}"],
    ]);
  });

  it("reads cells merged across, downwards and both ways", () => {
    const t = read(String.raw`\begin{tabular}{lll}
\multicolumn{2}{c}{Wide} & \multirow{2}{*}{Tall} \\
\multicolumn{2}{|c|}{\multirow{2}{*}{Block}} & \\
\multicolumn{2}{|c|}{} & z \\
\end{tabular}`);
    expect(tex(t)).toEqual([
      ["Wide", "·", "Tall"],
      ["Block", "·", "·"],
      ["·", "·", "z"],
    ]);
    expect(t.rows[0][0]).toMatchObject({ colSpan: 2, rowSpan: 1, spec: "c" });
    expect(t.rows[0][2]).toMatchObject({ colSpan: 1, rowSpan: 2 });
    expect(t.rows[1][0]).toMatchObject({ colSpan: 2, rowSpan: 2, spec: "|c|" });
    expect(needsMultirow(t)).toBe(true);
  });

  it("reads partial rules, booktabs rules, a position and a last row without its line end", () => {
    const t = read("\\begin{tabular}[t]{lll}\n\\toprule\na & b & c \\\\\n\\cline{1-1}\\cline{3-3}\nd & e & f\n\\end{tabular}");
    expect(t.pos).toBe("t");
    expect(t.hrules).toEqual([{ kind: "toprule" }, { kind: "cline", cols: [true, false, true] }, { kind: "none" }]);
    expect(tex(t)[1]).toEqual(["d", "e", "f"]);
  });

  it("refuses what it could not write back exactly, saying why", () => {
    const wrap = (spec: string, body: string) => `\\begin{tabular}{${spec}}\n${body}\n\\end{tabular}`;
    expect(reason(wrap("lS", "a & b \\\\"))).toMatch(/column type/);
    expect(reason(wrap("*{2}{l}", "a & b \\\\"))).toMatch(/column type/);
    expect(reason(wrap("l||l", "a & b \\\\"))).toMatch(/double/);
    expect(reason(wrap("ll", "a % a note\n & b \\\\"))).toMatch(/comment inside a cell/);
    expect(reason(wrap("ll", "a & b \\\\*\nc & d \\\\"))).toMatch(/together/);
    expect(reason(wrap("ll", "a & \\rowcolor{gray} b \\\\"))).toMatch(/row colour/);
    expect(reason(wrap("ll", "a & \\begin{verbatim}x\\end{verbatim} \\\\"))).toMatch(/verbatim/);
    expect(reason(wrap("ll", "a & b \\\\ \\hline\\hline c & d \\\\"))).toMatch(/more than one rule/);
    expect(reason(wrap("ll", "a & b \\\\ \\cmidrule{1-2} \\cmidrule{2-2} c & d \\\\"))).toMatch(/overlap/);
    expect(reason(wrap("ll", "a & b & c \\\\"))).toMatch(/every column/);
    expect(reason(wrap("ll", "a \\\\"))).toMatch(/every column/);
    expect(reason(wrap("ll", "\\multirow{2}{*}{a} & b \\\\ oops & d \\\\"))).toMatch(/not empty/);
    expect(reason(wrap("ll", "\\multirow{3}{*}{a} & b \\\\ & d \\\\"))).toMatch(/more rows/);
    expect(reason(wrap("ll", "\\multicolumn{2}{lc}{a} \\\\"))).toMatch(/cannot be edited/);
    expect(reason(wrap("ll", "a & b \\hline \\\\"))).toMatch(/middle of a row/);
    expect(reason(wrap("ll", "a & {b \\\\"))).toMatch(/braces/);
    expect(reason("\\begin{tabulary}{\\textwidth}{lL}\na & b \\\\\n\\end{tabulary}")).toMatch(/can be edited here/);
    expect(reason("\\begin{tabular}{ll}\na & b \\\\\n")).toMatch(/not finished/);
  });
});

describe("tables written in other ways", () => {
  /** Read, check it writes back as itself, and give the table. */
  const kept = (source: string): Table => {
    const t = read(source);
    expect(read(writeTable(t))).toEqual(t);
    return t;
  };

  it("reads columns with a width, and others described in full, and keeps them", () => {
    const t = kept("\\begin{tabular}{|l|p{3cm}|>{\\centering\\arraybackslash}m{2cm}<{\\,}|@{}r@{}|}\na & b & c & d \\\\\n\\end{tabular}");
    expect(t.aligns).toEqual(["l", "l", "c", "r"]);
    expect(t.kinds).toEqual(["l", "p{3cm}", ">{\\centering\\arraybackslash}m{2cm}<{\\,}", "r"]);
    expect(writeTable(t).split("\n")[0]).toBe("\\begin{tabular}{|l|p{3cm}|>{\\centering\\arraybackslash}m{2cm}<{\\,}|@{}r|@{}}");
    expect(needsArray(t)).toBe(true);
    expect(needsArray(read("\\begin{tabular}{lp{1cm}}\na & b \\\\\n\\end{tabular}"))).toBe(false);
  });

  it("aligns a column with a width by what is written before it", () => {
    const t = kept("\\begin{tabular}{lp{3cm}}\na & b \\\\\n\\end{tabular}");
    const right = setAlign(t, { top: 0, left: 1, bottom: 0, right: 1 }, "r");
    expect(right.kinds![1]).toBe(">{\\raggedleft\\arraybackslash}p{3cm}");
    expect(right.aligns[1]).toBe("r");
    const centred = setAlign(right, { top: 0, left: 1, bottom: 0, right: 1 }, "c");
    expect(centred.kinds![1]).toBe(">{\\centering\\arraybackslash}p{3cm}");
    expect(setAlign(centred, { top: 0, left: 1, bottom: 0, right: 1 }, "l").kinds).toEqual(["l", "p{3cm}"]);
    expect(read(writeTable(right))).toEqual(right);
  });

  it("keeps a column's description when columns are added and taken away beside it", () => {
    const t = kept("\\begin{tabular}{lp{3cm}}\na & b \\\\\n\\end{tabular}");
    expect(insertColumn(t, 2).kinds).toEqual(["l", "p{3cm}", "p{3cm}"]);
    expect(deleteColumn(t, 1).kinds).toBeUndefined();
    expect(splitIntoColumns(t, 0, 1).kinds).toEqual(["l", "p{3cm}", "p{3cm}"]);
  });

  it("reads tabular*, tabularx and longtable, with their widths and positions", () => {
    const star = kept("\\begin{tabular*}{\\textwidth}{@{\\extracolsep{\\fill}}ll}\na & b \\\\\n\\end{tabular*}");
    expect(star.env).toEqual({ name: "tabular*", width: "\\textwidth" });
    expect(writeTable(star).split("\n")[0]).toBe("\\begin{tabular*}{\\textwidth}{@{\\extracolsep{\\fill}}ll}");
    const x = kept("\\begin{tabularx}{0.9\\linewidth}[t]{lX}\na & b \\\\\n\\end{tabularx}");
    expect(x.env).toEqual({ name: "tabularx", width: "0.9\\linewidth" });
    expect(x.pos).toBe("t");
    expect(writeTable(x).split("\n").pop()).toBe("\\end{tabularx}");
    const long = kept("\\begin{longtable}[c]{ll}\na & b \\\\\n\\end{longtable}");
    expect(long.env).toEqual({ name: "longtable" });
    // A longtable's head and foot are not modelled.
    expect(reason("\\begin{longtable}{ll}\nH & I \\\\\n\\endhead\na & b \\\\\n\\end{longtable}")).toMatch(/endhead/);
  });

  it("reads \\cmidrule pieces with their trims and thicknesses", () => {
    const t = kept("\\begin{tabular}{lll}\n\\toprule\nA & B & C \\\\\n\\cmidrule(lr){1-2} \\cmidrule[0.5pt]{3-3}\na & b & c \\\\\n\\bottomrule\n\\end{tabular}");
    expect(t.hrules[1]).toEqual({ kind: "cmidrule", segs: [{ a: 0, b: 1, trim: "lr" }, { a: 2, b: 2, width: "0.5pt" }] });
    expect(writeTable(t)).toContain("\\cmidrule(lr){1-2} \\cmidrule[0.5pt]{3-3}");
  });

  it("keeps the space between rows, row colours, row gaps and comments between rows", () => {
    const t = kept(
      "\\begin{tabular}{ll}\n% the head\n\\toprule\n\\rowcolor{gray!20} A & B \\\\ % first\n\\midrule\n\\addlinespace[2pt]\na & b \\\\[3pt]\nc & d \\\\\n\\bottomrule\n\\end{tabular}",
    );
    expect(t.hrules[0]).toEqual({ kind: "toprule", notes: [" the head"] });
    expect(t.hrules[1]).toEqual({ kind: "midrule", space: "2pt" });
    expect(t.rowInfo).toEqual([{ color: "\\rowcolor{gray!20}", note: " first" }, { gap: "3pt" }, {}]);
    expect(writeTable(t)).toContain("\\rowcolor{gray!20} A & B \\\\ % first");
    expect(writeTable(t)).toContain("a & b \\\\[3pt]");
    // Rows added and taken away carry their own.
    expect(insertRow(t, 1).rowInfo).toEqual([{ color: "\\rowcolor{gray!20}", note: " first" }, {}, { gap: "3pt" }, {}]);
    expect(deleteRow(t, 0).rowInfo).toEqual([{ gap: "3pt" }, {}]);
  });

  it("reads \\multirow with a width and a position", () => {
    const t = kept("\\begin{tabular}{ll}\n\\multirow[t]{2}{3cm}{a} & b \\\\\n& d \\\\\n\\end{tabular}");
    expect(t.rows[0][0]).toMatchObject({ rowSpan: 2, rowWidth: "3cm", rowPos: "t", tex: "a" });
    expect(writeTable(t)).toContain("\\multirow[t]{2}{3cm}{a}");
  });

  it("takes an environment inside a cell whole, a table inside a table included", () => {
    const t = kept("\\begin{tabular}{ll}\na & $\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$ \\\\\nb & \\begin{tabular}{c} x \\\\ y \\end{tabular} \\\\\n\\end{tabular}");
    expect(tex(t)).toEqual([
      ["a", "$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$"],
      ["b", "\\begin{tabular}{c} x \\\\ y \\end{tabular}"],
    ]);
  });

  it("knows where each cell's text is, so that one cell can be changed where it stands", () => {
    const source = "\\begin{tabular}{ll}\n  \\hline\n  Name   &   \\multicolumn{1}{c}{ Value } \\\\\n  $x$ &\n     two \\\\\n\\end{tabular}";
    const ranges = cellRanges(source)!;
    const at = (r: number, c: number) => source.slice(ranges[r][c]!.from, ranges[r][c]!.to);
    expect(at(0, 0)).toBe("Name");
    expect(at(0, 1)).toBe("Value");
    expect(at(1, 0)).toBe("$x$");
    expect(at(1, 1)).toBe("two");
  });
});

describe("writing a table", () => {
  it("writes exactly the LaTeX a person would", () => {
    expect(writeTable(grid(2, 2))).toBe("\\begin{tabular}{|l|l|}\n\\hline\na1 & b1 \\\\\n\\hline\na2 & b2 \\\\\n\\hline\n\\end{tabular}");
    expect(writeTable(grid(1, 2, false), "  ")).toBe("\\begin{tabular}{ll}\n  a1 & b1 \\\\\n  \\end{tabular}");
  });

  it("gives the same table when what it wrote is read again", () => {
    const tables: Table[] = [
      read(HAND),
      grid(3, 4),
      grid(2, 3, false),
      merge(grid(3, 3), { top: 0, left: 0, bottom: 1, right: 1 }),
      merge(grid(3, 3), { top: 0, left: 1, bottom: 2, right: 1 }),
      merge(grid(4, 4), { top: 1, left: 1, bottom: 2, right: 3 }),
      splitIntoRows(grid(2, 3), 0, 1),
      splitIntoColumns(grid(3, 2), 1, 0),
      setAlign(grid(2, 3), { top: 0, left: 1, bottom: 0, right: 2 }, "r"),
      toggleBorders(merge(grid(3, 3), { top: 0, left: 0, bottom: 2, right: 0 })),
      read("\\begin{tabular}[b]{lcr}\n\\toprule\na & \\multicolumn{2}{c|}{b} \\\\\n\\midrule\n\\multicolumn{1}{r}{c} & d & e \\\\\n\\bottomrule\n\\end{tabular}"),
    ];
    for (const t of tables) {
      const written = writeTable(t);
      expect(read(written)).toEqual(t);
      expect(writeTable(read(written))).toBe(written);
    }
  });

  it("keeps a hand-written table's cells, rules and descriptions when one cell is edited", () => {
    const source = "\\begin{tabular}{l|cr}\n\\toprule\n\\multicolumn{2}{c}{Head} & x \\\\\n\\cline{2-3}\na & $b$ & c\n\\end{tabular}";
    const edited = writeTable(setCell(read(source), 1, 2, "changed"));
    expect(edited).toBe("\\begin{tabular}{l|cr}\n\\toprule\n\\multicolumn{2}{c}{Head} & x \\\\\n\\cline{2-3}\na & $b$ & changed \\\\\n\\end{tabular}");
  });
});

describe("merging", () => {
  it("across a row writes \\multicolumn", () => {
    const t = merge(grid(2, 3), { top: 0, left: 0, bottom: 0, right: 1 });
    expect(writeTable(t).split("\n")[2]).toBe("\\multicolumn{2}{|l|}{a1 b1} & c1 \\\\");
    expect(needsMultirow(t)).toBe(false);
  });

  it("down a column writes \\multirow, with an empty cell under it and the rule stopped short", () => {
    const t = merge(grid(3, 2), { top: 0, left: 0, bottom: 1, right: 0 });
    expect(writeTable(t)).toBe(
      "\\begin{tabular}{|l|l|}\n\\hline\n\\multirow{2}{*}{a1 a2} & b1 \\\\\n\\cline{2-2}\n& b2 \\\\\n\\hline\na3 & b3 \\\\\n\\hline\n\\end{tabular}",
    );
    expect(needsMultirow(t)).toBe(true);
  });

  it("a block writes both, and repeats the width in the rows it covers", () => {
    const t = merge(grid(3, 3), { top: 0, left: 1, bottom: 1, right: 2 });
    const lines = writeTable(t).split("\n");
    expect(lines[2]).toBe("a1 & \\multicolumn{2}{l|}{\\multirow{2}{*}{b1 c1 b2 c2}} \\\\");
    expect(lines[3]).toBe("\\cline{1-1}");
    expect(lines[4]).toBe("a2 & \\multicolumn{2}{l|}{} \\\\");
  });

  it("keeps everything that was typed, in reading order, and skips empty cells", () => {
    let t = grid(2, 2);
    t = setCell(t, 0, 1, "");
    expect(merge(t, { top: 0, left: 0, bottom: 1, right: 1 }).rows[0][0].tex).toBe("a1 a2 b2");
  });

  it("takes in the whole of any merged cell the block touches", () => {
    const t = merge(grid(3, 3), { top: 0, left: 0, bottom: 1, right: 1 });
    expect(expandRect(t, { top: 1, left: 1, bottom: 2, right: 2 })).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
    const all = merge(t, { top: 1, left: 1, bottom: 2, right: 2 });
    expect(all.rows[0][0]).toMatchObject({ colSpan: 3, rowSpan: 3, tex: "a1 b1 a2 b2 c1 c2 a3 b3 c3" });
  });

  it("works in either direction of the drag", () => {
    const forward = merge(grid(2, 2), { top: 0, left: 0, bottom: 1, right: 1 });
    expect(merge(grid(2, 2), { top: 1, left: 1, bottom: 0, right: 0 })).toEqual(forward);
  });
});

describe("splitting", () => {
  it("a merged cell gives back its cells, with the text in the first and the rules restored", () => {
    const start = grid(3, 3);
    const merged = merge(start, { top: 0, left: 0, bottom: 1, right: 1 });
    const split = splitMerged(merged, 0, 0);
    expect(tex(split)[0]).toEqual(["a1 b1 a2 b2", "", "c1"]);
    expect(tex(split)[1]).toEqual(["", "", "c2"]);
    expect(split.hrules).toEqual(start.hrules);
    expect(split.rows.flat().every((c) => !c.hidden && c.colSpan === 1 && c.rowSpan === 1)).toBe(true);
  });

  it("an ordinary cell into columns widens every other cell in its column", () => {
    const t = splitIntoColumns(grid(3, 2), 1, 0);
    expect(t.aligns).toHaveLength(3);
    expect(tex(t)).toEqual([
      ["a1", "·", "b1"],
      ["a2", "", "b2"],
      ["a3", "·", "b3"],
    ]);
    expect(t.rows[0][0].colSpan).toBe(2);
    expect(t.rows[2][0].colSpan).toBe(2);
    expect(writeTable(t).split("\n")[2]).toBe("\\multicolumn{2}{|l|}{a1} & b1 \\\\");
    expect(writeTable(t).split("\n")[4]).toBe("a2 &  & b2 \\\\");
  });

  it("an ordinary cell into rows deepens every other cell in its row, with a rule under it alone", () => {
    const t = splitIntoRows(grid(2, 3), 0, 1);
    expect(tex(t)).toEqual([
      ["a1", "b1", "c1"],
      ["·", "", "·"],
      ["a2", "b2", "c2"],
    ]);
    expect(t.rows[0][0].rowSpan).toBe(2);
    expect(t.rows[0][2].rowSpan).toBe(2);
    expect(writeTable(t).split("\n").slice(2, 5)).toEqual(["\\multirow{2}{*}{a1} & b1 & \\multirow{2}{*}{c1} \\\\", "\\cline{2-2}", "&  & \\\\"]);
    expect(needsMultirow(t)).toBe(true);
  });

  it("widens a merged cell only once when it covers several rows of the column", () => {
    const tall = merge(grid(3, 2), { top: 0, left: 0, bottom: 1, right: 0 });
    const t = splitIntoColumns(tall, 2, 0);
    expect(t.rows[0][0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(read(writeTable(t))).toEqual(t);
  });
});

describe("borders", () => {
  it("are all drawn or all removed", () => {
    const off = toggleBorders(grid(2, 2));
    expect(writeTable(off)).toBe("\\begin{tabular}{ll}\na1 & b1 \\\\\na2 & b2 \\\\\n\\end{tabular}");
    expect(toggleBorders(off)).toEqual(grid(2, 2));
  });

  it("never draw a rule through a cell merged downwards", () => {
    const merged = merge(grid(3, 3, false), { top: 0, left: 1, bottom: 2, right: 1 });
    const t = toggleBorders(merged);
    const rules = writeTable(t).split("\n").filter((line) => line.includes("line"));
    expect(rules).toEqual(["\\hline", "\\cline{1-1}\\cline{3-3}", "\\cline{1-1}\\cline{3-3}", "\\hline"]);
    expect(writeTable(t)).toContain("\\cline{1-1}\\cline{3-3}");
    expect(writeTable(t)).not.toMatch(/\\\\\n\\hline\n&/);
  });

  it("keep a hand-written cell's alignment when its bars change", () => {
    const t = toggleBorders(read("\\begin{tabular}{ll}\n\\multicolumn{2}{c}{Head} \\\\\na & b \\\\\n\\end{tabular}"));
    expect(t.rows[0][0].spec).toBe("|c|");
    expect(toggleBorders(t).rows[0][0].spec).toBe("c");
  });

  it("come in the usual looks for the whole table, each of which reads back as itself", () => {
    const t = grid(3, 2);
    const look = (style: Parameters<typeof setBorders>[1]) => writeTable(setBorders(t, style));
    expect(look("outside")).toBe("\\begin{tabular}{|ll|}\n\\hline\na1 & b1 \\\\\na2 & b2 \\\\\na3 & b3 \\\\\n\\hline\n\\end{tabular}");
    expect(look("inside")).toBe("\\begin{tabular}{l|l}\na1 & b1 \\\\\n\\hline\na2 & b2 \\\\\n\\hline\na3 & b3 \\\\\n\\end{tabular}");
    expect(look("header")).toBe("\\begin{tabular}{ll}\n\\hline\na1 & b1 \\\\\n\\hline\na2 & b2 \\\\\na3 & b3 \\\\\n\\hline\n\\end{tabular}");
    expect(look("book")).toBe("\\begin{tabular}{ll}\n\\toprule\na1 & b1 \\\\\n\\midrule\na2 & b2 \\\\\na3 & b3 \\\\\n\\bottomrule\n\\end{tabular}");
    for (const style of ["all", "none", "outside", "inside", "header", "book"] as const) {
      const made = setBorders(t, style);
      expect(read(writeTable(made))).toEqual(made);
      expect(bordersStyle(made)).toBe(style);
    }
    expect(needsBooktabs(setBorders(t, "book"))).toBe(true);
    expect(needsBooktabs(t)).toBe(false);
    expect(bordersStyle(toggleEdge(t, { top: 0, left: 0, bottom: 0, right: 0 }, "bottom"))).toBe(null);
  });

  it("draw around a merged cell in every look, and the book look with \\cmidrule there", () => {
    const merged = merge(grid(3, 2), { top: 0, left: 0, bottom: 1, right: 0 });
    const book = setBorders(merged, "book");
    expect(writeTable(book)).toContain("\\cmidrule{2-2}");
    expect(read(writeTable(book))).toEqual(book);
  });

  it("can be drawn on one edge of the selected cells at a time", () => {
    const t = grid(3, 3, false);
    const middle = { top: 1, left: 1, bottom: 1, right: 1 };
    const above = toggleEdge(t, middle, "top");
    expect(writeTable(above)).toContain("a1 & b1 & c1 \\\\\n\\cline{2-2}\na2");
    expect(hasEdge(above, middle, "top")).toBe(true);
    expect(hasEdge(above, middle, "bottom")).toBe(false);
    expect(toggleEdge(above, middle, "top")).toEqual(t);
    const wide = toggleEdge(t, { top: 2, left: 0, bottom: 2, right: 2 }, "bottom");
    expect(wide.hrules[3]).toEqual({ kind: "hline" });
    const column = { top: 0, left: 1, bottom: 2, right: 1 };
    const left = toggleEdge(t, column, "left");
    expect(writeTable(left).split("\n")[0]).toBe("\\begin{tabular}{l|ll}");
    expect(hasEdge(left, { top: 0, left: 1, bottom: 0, right: 1 }, "left")).toBe(true);
    expect(writeTable(toggleEdge(t, column, "right")).split("\n")[0]).toBe("\\begin{tabular}{ll|l}");
    // Taking a piece out of a full rule leaves the rest of it.
    const cut = toggleEdge(grid(2, 3), { top: 0, left: 1, bottom: 0, right: 1 }, "top");
    expect(writeTable(cut).split("\n")[1]).toBe("\\cline{1-1}\\cline{3-3}");
    // A booktabs rule drawn whole again is the rule it was.
    const book = setBorders(grid(2, 2), "book");
    const corner = { top: 0, left: 0, bottom: 0, right: 0 };
    expect(toggleEdge(toggleEdge(book, corner, "top"), corner, "top")).toEqual(book);
    for (const made of [above, wide, left, cut]) expect(read(writeTable(made))).toEqual(made);
  });

  it("beside only some rows, are drawn in those rows' own descriptions", () => {
    const t = grid(2, 2, false);
    const first = { top: 0, left: 1, bottom: 0, right: 1 };
    const right = toggleEdge(t, first, "right");
    expect(writeTable(right)).toContain("a1 & \\multicolumn{1}{l|}{b1} \\\\\na2 & b2 \\\\");
    expect(hasEdge(right, first, "right")).toBe(true);
    expect(hasEdge(right, { top: 1, left: 1, bottom: 1, right: 1 }, "right")).toBe(false);
    expect(cellBars(right, 0, 1)).toEqual({ left: false, right: true });
    expect(cellBars(right, 1, 1)).toEqual({ left: false, right: false });
    // A line on the left of a cell further along is the right bar of the cell before it.
    const left = toggleEdge(t, first, "left");
    expect(writeTable(left)).toContain("\\multicolumn{1}{l|}{a1} & b1 \\\\");
    expect(hasEdge(left, first, "left")).toBe(true);
    // Taken away again, the cells need no description of their own.
    expect(toggleEdge(right, first, "right")).toEqual(t);
    expect(toggleEdge(left, first, "left")).toEqual(t);
    for (const made of [right, left]) expect(read(writeTable(made))).toEqual(made);
    // The whole height of the table is still said once, in the table's description.
    expect(toggleEdge(t, { top: 0, left: 1, bottom: 1, right: 1 }, "right").vrules).toEqual([false, false, true]);
  });

  it("on one edge of a merged cell, take the whole cell's edge", () => {
    const merged = merge(grid(3, 3, false), { top: 0, left: 0, bottom: 1, right: 1 });
    const t = toggleEdge(merged, { top: 0, left: 0, bottom: 0, right: 0 }, "bottom");
    expect(writeTable(t)).toContain("\\cline{1-2}\na3");
    expect(read(writeTable(t))).toEqual(t);
  });

  it("move a hand-written cell's bars with the table's", () => {
    const t = read("\\begin{tabular}{ll}\n\\multicolumn{2}{c}{Head} \\\\\na & b \\\\\n\\end{tabular}");
    const edged = toggleEdge(t, { top: 0, left: 1, bottom: 1, right: 1 }, "right");
    expect(edged.rows[0][0].spec).toBe("c|");
    expect(read(writeTable(edged))).toEqual(edged);
    // One that does not touch the line keeps its description as written.
    const three = read("\\begin{tabular}{lll}\n\\multicolumn{1}{c}{H} & b & c \\\\\n\\end{tabular}");
    const right = toggleEdge(three, { top: 0, left: 2, bottom: 0, right: 2 }, "right");
    expect(right.rows[0][0].spec).toBe("c");
    expect(toggleEdge(three, { top: 0, left: 0, bottom: 0, right: 0 }, "right").rows[0][0].spec).toBe("c|");
    // A bar the user wrote on the left of a cell further along goes when that line is taken away.
    const lefty = read("\\begin{tabular}{|l|l|}\na & \\multicolumn{1}{|c|}{H2} \\\\\n\\end{tabular}");
    expect(toggleEdge(lefty, { top: 0, left: 1, bottom: 0, right: 1 }, "left").rows[0][1].spec).toBe("c|");
    // A heading that draws no bars of its own has no line beside it, whatever the columns say:
    // the line goes on, in its description, and the other side stays as written.
    const ruled = read("\\begin{tabular}{|l|l|l|}\n\\multicolumn{1}{c}{H1} & b & c \\\\\nd & e & f \\\\\n\\end{tabular}");
    const heading = { top: 0, left: 0, bottom: 0, right: 0 };
    expect(hasEdge(ruled, heading, "right")).toBe(false);
    expect(toggleEdge(ruled, heading, "right").rows[0][0].spec).toBe("c|");
    expect(toggleEdge(toggleEdge(ruled, heading, "right"), heading, "right").rows[0][0].spec).toBe("c");
  });
});

describe("formatting cells", () => {
  const all = { top: 0, left: 0, bottom: 1, right: 1 };

  it("sets every cell with text in bold, and takes it out again", () => {
    const t = setCell(grid(2, 2), 1, 1, "");
    const bold = toggleStyle(t, all, "textbf");
    expect(tex(bold)).toEqual([["\\textbf{a1}", "\\textbf{b1}"], ["\\textbf{a2}", ""]]);
    expect(cellsStyled(bold, all, "textbf")).toBe(true);
    expect(toggleStyle(bold, all, "textbf")).toEqual(t);
  });

  it("makes the rest bold when only some cells are", () => {
    const some = setCell(grid(1, 2), 0, 0, "\\textbf{a1}");
    const row = { top: 0, left: 0, bottom: 0, right: 1 };
    expect(cellsStyled(some, row, "textbf")).toBe(false);
    expect(tex(toggleStyle(some, row, "textbf"))).toEqual([["\\textbf{a1}", "\\textbf{b1}"]]);
  });

  it("does not take text that only starts in bold for bold", () => {
    const t = setCell(grid(1, 1), 0, 0, "\\textbf{a} and \\textbf{b}");
    const one = { top: 0, left: 0, bottom: 0, right: 0 };
    expect(cellsStyled(t, one, "textbf")).toBe(false);
    expect(tex(toggleStyle(t, one, "textbf"))).toEqual([["\\textbf{\\textbf{a} and \\textbf{b}}"]]);
  });

  it("keeps merged cells merged", () => {
    const t = merge(grid(2, 2), { top: 0, left: 0, bottom: 0, right: 1 });
    const bold = toggleStyle(t, all, "textit");
    expect(tex(bold)).toEqual([["\\textit{a1 b1}", "·"], ["\\textit{a2}", "\\textit{b2}"]]);
    expect(read(writeTable(bold))).toEqual(bold);
  });

  it("empties the selected cells", () => {
    expect(tex(clearCells(grid(2, 2), { top: 0, left: 1, bottom: 1, right: 1 }))).toEqual([["a1", ""], ["a2", ""]]);
  });
});

describe("copying and pasting cells", () => {
  it("copies the LaTeX of each cell, a merged one once", () => {
    const t = merge(grid(2, 3), { top: 0, left: 0, bottom: 0, right: 1 });
    expect(cellsOf(t, { top: 0, left: 1, bottom: 1, right: 2 })).toEqual([["a1 b1", "", "c1"], ["a2", "b2", "c2"]]);
  });

  it("pastes into the cells from the one chosen, adding rows and columns that are needed", () => {
    const t = pasteCells(grid(2, 2), 1, 1, [["x", "y"], ["z", "w"]])!;
    expect(tex(t)).toEqual([["a1", "b1", ""], ["a2", "x", "y"], ["", "z", "w"]]);
    expect(read(writeTable(t))).toEqual(t);
  });

  it("will not paste over a merged cell", () => {
    const t = merge(grid(2, 2), { top: 0, left: 0, bottom: 0, right: 1 });
    expect(pasteCells(t, 0, 0, [["x"]])).toBe(null);
    expect(pasteCells(t, 1, 0, [["x", "y"]])).not.toBe(null);
    expect(pasteCells(t, 0, 0, [])).toBe(null);
  });
});

describe("deleting a table", () => {
  const table = "\\begin{tabular}{l}\na \\\\\n\\end{tabular}";
  const remove = (text: string) => {
    const from = text.indexOf("\\begin{tabular}");
    const change = tableRemoval(text, from, from + table.length);
    return text.slice(0, change.from) + change.insert + text.slice(change.to);
  };

  it("takes the table and the line it stood on", () => {
    expect(remove(`Before.\n${table}\nAfter.`)).toBe("Before.\nAfter.");
    expect(remove(`Before. ${table} After.`)).toBe("Before.  After.");
  });

  it("takes a float that held only the table, its caption and label", () => {
    const float = `\\begin{table}[h]\n  \\centering\n  ${table}\n  \\caption{Costs {by} year}\n  \\label{tab:a}\n\\end{table}\n`;
    expect(remove(`Before.\n${float}After.`)).toBe("Before.\nAfter.");
    const centred = `\\begin{table}\n\\begin{center}\n${table}\n\\end{center}\n\\caption[Short]{Long}\n\\end{table}\n`;
    expect(remove(`A\n${centred}B`)).toBe("A\nB");
  });

  it("takes a box that held only the table, and the float around it", () => {
    const float = `\\begin{table}[t]\n\\centering\n\\resizebox{\\linewidth}{!}{\n${table}}\n\\caption{C}\n\\end{table}\n`;
    expect(remove(`A\n${float}B`)).toBe("A\nB");
    expect(remove(`A \\fbox{${table}} B`)).toBe("A  B");
    // A box with other text in it keeps that text, and the box.
    expect(remove(`\\fbox{Key: ${table}}`)).toBe("\\fbox{Key: }");
    // The usual way of writing it, with comments at the line ends.
    expect(remove(`A\n\\resizebox{\\linewidth}{!}{%\n${table}%\n}\nB`)).toBe("A\nB");
    expect(remove(`A \\scalebox{0.8}[1]{${table}} B`)).toBe("A  B");
    // Text in an argument before the box's own braces is never taken with it.
    expect(remove(`Intro \\fbox{Keep me}{${table}} after`)).toBe(`Intro \\fbox{Keep me}{} after`);
    expect(remove(`\\parbox{3cm}{${table}}`)).toBe("");
    expect(remove(`A\n\\resizebox{\\linewidth}{!}%\n{%\n${table}%\n}\nB`)).toBe("A\nB");
  });

  it("leaves a float that holds something else as well", () => {
    const float = `\\begin{table}\n\\centering\n${table}\n\\includegraphics{x}\n\\end{table}`;
    expect(remove(float)).toBe("\\begin{table}\n\\centering\n\\includegraphics{x}\n\\end{table}");
    const two = `\\begin{table}\n${table}\n\\end{table}\nText\n\\begin{center}\n${table}\n\\end{center}`;
    const second = two.lastIndexOf("\\begin{tabular}");
    const change = tableRemoval(two, second, second + table.length);
    expect(two.slice(0, change.from) + two.slice(change.to)).toBe(`\\begin{table}\n${table}\n\\end{table}\nText\n`);
  });
});

describe("adding a package", () => {
  const DOC = "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nHi\n\\end{document}\n";

  it("adds it before the document starts, once", () => {
    const change = ensurePackage(DOC, "amssymb");
    expect(change).toEqual({ from: DOC.indexOf("\\begin{document}"), to: DOC.indexOf("\\begin{document}"), insert: "\\usepackage{amssymb}\n" });
    expect(ensurePackage(apply(DOC, [change as never]), "amssymb")).toBe("present");
  });

  it("knows packages and classes that provide it already, or would clash with it", () => {
    expect(ensurePackage(DOC.replace("graphicx", "mathtools"), "amsmath")).toBe("present");
    expect(ensurePackage(DOC.replace("article", "amsart"), "amsmath")).toBe("present");
    expect(ensurePackage(DOC.replace("graphicx", "newtxmath"), "amssymb")).toBe("present");
    expect(ensurePackage(DOC.replace("graphicx", "unicode-math"), "amssymb")).toBe("present");
    expect(ensurePackage(DOC.replace("graphicx", "amssymbx"), "amssymb")).not.toBe("present");
    expect(ensurePackage(DOC.replace("graphicx", "amsmath,amssymb"), "amssymb")).toBe("present");
    expect(ensurePackage(DOC.replace("graphicx", "booktabs"), "booktabs")).toBe("present");
    expect(ensurePackage("\\section{A part}\n", "booktabs")).toBe("no-preamble");
    expect(ensurePackage(DOC.replace("graphicx", "txfonts"), "amssymb")).toBe("present");
  });

  it("is not fooled by a comment that mentions the start of the document", () => {
    const doc = "\\documentclass{article}\n% Packages go before \\begin{document} here\n\\usepackage{amsmath}\n\\begin{document}\nHi\n\\end{document}\n";
    expect(ensurePackage(doc, "amsmath")).toBe("present");
    const change = ensurePackage(doc, "amssymb");
    expect(change).toEqual({ from: doc.indexOf("\\begin{document}\nHi"), to: doc.indexOf("\\begin{document}\nHi"), insert: "\\usepackage{amssymb}\n" });
    expect(ensurePackage("\\documentclass{article}\n% \\usepackage{amssymb}\n\\begin{document}\n", "amssymb")).not.toBe("present");
  });

  it("reads a \\path with a space before its mark as the address it is", () => {
    const doc = "\\documentclass{article}\n\\newcommand{\\p}{\\path |a%b|} \\usepackage{amssymb}\n\\begin{document}\n";
    expect(ensurePackage(doc, "amssymb")).toBe("present");
  });

  it("leaves it to the user when the preamble reads another file", () => {
    expect(ensurePackage(DOC.replace("\\usepackage{graphicx}", "\\input{preamble}"), "amssymb")).toBe("elsewhere");
    expect(typeof ensurePackage(DOC.replace("\\usepackage{graphicx}", "\\input{glyphtounicode}"), "amssymb")).toBe("object");
    expect(ensurePackage(DOC.replace("\\usepackage{graphicx}", "\\input{glyphtounicode-extra}"), "amssymb")).toBe("elsewhere");
    expect(ensurePackage(DOC.replace("\\usepackage{graphicx}", "\\input{glyphtounicodex}"), "amssymb")).toBe("elsewhere");
    expect(ensurePackage(DOC.replace("\\usepackage{graphicx}", "\\input{preamble}\n\\usepackage{amssymb}"), "amssymb")).toBe("present");
  });
});

describe("rows and columns", () => {
  it("a new row goes inside the outer rules and under any cell merged across the place", () => {
    const top = insertRow(grid(2, 2), 0);
    expect(tex(top)).toEqual([["", ""], ["a1", "b1"], ["a2", "b2"]]);
    expect(top.hrules.map((r) => r.kind)).toEqual(["hline", "hline", "hline", "hline"]);
    const end = insertRow(grid(2, 2, false), 2);
    expect(end.hrules.every((r) => r.kind === "none")).toBe(true);
    const through = insertRow(merge(grid(2, 2), { top: 0, left: 0, bottom: 1, right: 0 }), 1);
    expect(through.rows[0][0].rowSpan).toBe(3);
    expect(tex(through)[1]).toEqual(["·", ""]);
    expect(writeTable(through).split("\n").slice(3, 6)).toEqual(["\\cline{2-2}", "& \\\\", "\\cline{2-2}"]);
    expect(read(writeTable(through))).toEqual(through);
  });

  it("a new column goes inside the outer bars and under any cell merged across the place", () => {
    const t = insertColumn(merge(grid(2, 2), { top: 0, left: 0, bottom: 0, right: 1 }), 1);
    expect(t.rows[0][0].colSpan).toBe(3);
    expect(tex(t)[1]).toEqual(["a2", "", "b2"]);
    expect(t.vrules).toEqual([true, true, true, true]);
    expect(insertColumn(grid(1, 1, false), 1).aligns).toEqual(["l", "l"]);
  });

  it("deleting a row keeps the text of a cell merged downwards from it", () => {
    const merged = merge(grid(3, 2), { top: 0, left: 0, bottom: 2, right: 0 });
    const t = deleteRow(merged, 0);
    expect(t.rows[0][0]).toMatchObject({ tex: "a1 a2 a3", rowSpan: 2, hidden: false });
    expect(tex(t)).toEqual([["a1 a2 a3", "b2"], ["·", "b3"]]);
    expect(deleteRow(merged, 1).rows[0][0].rowSpan).toBe(2);
    expect(read(writeTable(t))).toEqual(t);
    expect(deleteRow(grid(1, 2), 0)).toEqual(grid(1, 2));
    expect(deleteRow(grid(3, 2), 2).hrules.map((r) => r.kind)).toEqual(["hline", "hline", "hline"]);
  });

  it("deleting a column keeps the text of a cell merged across from it", () => {
    const merged = merge(grid(2, 3), { top: 0, left: 0, bottom: 0, right: 2 });
    const t = deleteColumn(merged, 0);
    expect(t.rows[0][0]).toMatchObject({ tex: "a1 b1 c1", colSpan: 2 });
    expect(tex(t)[1]).toEqual(["b2", "c2"]);
    expect(deleteColumn(merged, 1).rows[0][0].colSpan).toBe(2);
    expect(deleteColumn(grid(2, 1), 0)).toEqual(grid(2, 1));
    expect(deleteColumn(grid(2, 3), 2).vrules).toEqual([true, true, true]);
  });

  it("alignment applies to the columns of the cells chosen", () => {
    const t = setAlign(grid(2, 3), { top: 1, left: 1, bottom: 1, right: 2 }, "c");
    expect(t.aligns).toEqual(["l", "c", "c"]);
    expect(writeTable(t).split("\n")[0]).toBe("\\begin{tabular}{|l|c|c|}");
  });

  it("every action leaves a table that reads back as itself", () => {
    // A small soak: a fixed sequence of varied actions, each checked for a clean round trip.
    let t = grid(3, 3);
    const steps: ((x: Table) => Table)[] = [
      (x) => merge(x, { top: 0, left: 0, bottom: 1, right: 1 }),
      (x) => insertRow(x, 1),
      (x) => insertColumn(x, 1),
      (x) => splitIntoRows(x, 3, 3),
      (x) => splitIntoColumns(x, 4, 3),
      (x) => toggleBorders(x),
      (x) => merge(x, { top: 3, left: 2, bottom: 4, right: 4 }),
      (x) => deleteColumn(x, 0),
      (x) => deleteRow(x, 0),
      (x) => toggleBorders(x),
      (x) => splitMerged(x, 0, 0),
      (x) => deleteRow(x, x.rows.length - 1),
      (x) => deleteColumn(x, x.aligns.length - 1),
      (x) => insertRow(x, x.rows.length),
      (x) => setAlign(x, { top: 0, left: 0, bottom: 0, right: 0 }, "r"),
    ];
    const typed = new Set(t.rows.flat().map((c) => c.tex));
    for (const step of steps) {
      t = step(t);
      expect(t.rows.every((row) => row.length === t.aligns.length)).toBe(true);
      expect(t.hrules).toHaveLength(t.rows.length + 1);
      expect(t.vrules).toHaveLength(t.aligns.length + 1);
      expect(read(writeTable(t))).toEqual(t);
    }
    // Only deleting a row or column may remove text; merging and splitting never do.
    const left = t.rows.flat().map((c) => c.tex).join(" ");
    expect([...typed].filter((word) => left.includes(word)).length).toBeGreaterThan(0);
  });
});

describe("the text around a table", () => {
  const DOC = "\\documentclass{article}\n\\usepackage{graphicx} % pictures\n\\begin{document}\nx\n\\end{document}\n";
  const DOC0 = "\\documentclass{article}\n\\begin{document}\n";

  it("adds the multirow package after the last package, once", () => {
    const change = ensureMultirow(DOC);
    if (typeof change === "string") throw new Error(change);
    const added = apply(DOC, [change]);
    expect(added).toBe("\\documentclass{article}\n\\usepackage{graphicx} % pictures\n\\usepackage{multirow}\n\\begin{document}\nx\n\\end{document}\n");
    expect(ensureMultirow(added)).toBe("present");
    expect(ensureMultirow(DOC.replace("graphicx", "booktabs, multirow"))).toBe("present");
    expect(ensureMultirow(DOC.replace("\\usepackage{graphicx} % pictures", "% \\usepackage{multirow}"))).not.toBe("present");
    expect(ensureMultirow("\\section{An included file}\ntext\n")).toBe("no-preamble");
    // Never inside a condition, and a class written over two lines still counts.
    const conditional = "\\documentclass[a4paper]\n{article}\n\\ifxetex\n\\usepackage{fontspec}\n\\else\n\\usepackage[T1]{fontenc}\n\\fi\n\\begin{document}\nx\n\\end{document}\n";
    const change2 = ensureMultirow(conditional);
    if (typeof change2 === "string") throw new Error(change2);
    expect(apply(conditional, [change2])).toContain("\\fi\n\\usepackage{multirow}\n\\begin{document}");
  });

  it("gives a lone table a float to carry its caption, and changes or removes a caption later", () => {
    const tabular = "\\begin{tabular}{l}\na \\\\\n\\end{tabular}";
    const text = `\\documentclass{article}\n\\begin{document}\nBefore.\n\n${tabular}\n\nAfter.`;
    const from = text.indexOf(tabular);
    expect(captionOf(text, from, from + tabular.length)).toBeNull();
    const withCaption = apply(text, setCaption(text, from, from + tabular.length, "Results"));
    expect(withCaption).toBe(`${DOC0}Before.\n\n\\begin{table}[h]\n\\centering\n${tabular}\n\\caption{Results}\n\\end{table}\n\nAfter.`);

    const at = withCaption.indexOf(tabular);
    expect(captionOf(withCaption, at, at + tabular.length)).toBe("Results");
    const changed = apply(withCaption, setCaption(withCaption, at, at + tabular.length, "New {results}"));
    expect(captionOf(changed, at, at + tabular.length)).toBe("New {results}");
    const removed = apply(changed, setCaption(changed, at, at + tabular.length, ""));
    expect(removed).toBe(`${DOC0}Before.\n\n\\begin{table}[h]\n\\centering\n${tabular}\n\\end{table}\n\nAfter.`);
    expect(setCaption(text, from, from + tabular.length, "")).toEqual([]);
  });

  it("uses the float a table is already in, whatever kind, and the caption it already has", () => {
    const tabular = "\\begin{tabular}{l}\na \\\\\n\\end{tabular}";
    for (const float of ["table*", "figure", "sidewaystable"]) {
      const text = `${DOC0}\\begin{${float}}\n${tabular}\n\\end{${float}}`;
      const from = text.indexOf(tabular);
      const out = apply(text, setCaption(text, from, from + tabular.length, "Wide"));
      expect(out).toBe(`${DOC0}\\begin{${float}}\n${tabular}\n\\caption{Wide}\n\\end{${float}}`);
    }
    const had = `${DOC0}\\begin{table}\n\\caption[Short]{Long\n  one}\n${tabular}\n\\end{table}`;
    const at = had.indexOf(tabular);
    expect(captionOf(had, at, at + tabular.length)).toBe("Long one");
    expect(apply(had, setCaption(had, at, at + tabular.length, "New"))).toBe(`${DOC0}\\begin{table}\n\\caption[Short]{New}\n${tabular}\n\\end{table}`);
  });

  it("puts a caption at the end of a float with a note under the table, and before its label", () => {
    const tabular = "\\begin{tabular}{l}\na \\\\\n\\end{tabular}";
    const put = (body: string) => {
      const text = `${DOC0}${body}\n\\end{document}\n`;
      const from = text.indexOf(tabular);
      return apply(text, setCaption(text, from, from + tabular.length, "New"));
    };
    expect(put(`\\begin{table}\n\\centering\n${tabular}\\\\[1ex]\n\\footnotesize Source: X.\n\\end{table}`)).toContain("\\footnotesize Source: X.\n\\caption{New}\n\\end{table}");
    expect(put(`\\begin{table}\n${tabular}\n\\vspace{2pt}\n\\label{t}\n\\end{table}`)).toContain("\\vspace{2pt}\n\\caption{New}\n\\label{t}");
    expect(put(`\\begin{table}[h]\n\\centering\n${tabular}\n% source\n\\\\[1ex] {\\small Source: x}\n\\end{table}`)).toContain("{\\small Source: x}\n\\caption{New}\n\\end{table}");
    // A label with more after it could not be kept naming the caption: left to the source.
    const tangled = `${DOC0}\\begin{table}\n${tabular}\n\\label{t}\n\\\\[1ex] Source\n\\end{table}\n\\end{document}`;
    expect(captionPlace(tangled, tangled.indexOf(tabular), tangled.indexOf(tabular) + tabular.length).kind).toBe("no");
    // A figure with a picture as well: whose caption it has is not clear.
    const both = `${DOC0}\\begin{figure}\n\\includegraphics{x}\n${tabular}\n\\caption{Picture}\n\\end{figure}\n\\end{document}`;
    expect(captionPlace(both, both.indexOf(tabular), both.indexOf(tabular) + tabular.length).kind).toBe("no");
  });

  it("puts a float around a table in center, or after a line that sets how it looks", () => {
    const tabular = "\\begin{tabular}{l}\na \\\\\n\\end{tabular}";
    const put = (body: string) => {
      const text = `${DOC0}${body}\n\nMore.\n\\end{document}\n`;
      const from = text.indexOf(tabular);
      return apply(text, setCaption(text, from, from + tabular.length, "New"));
    };
    expect(put(`Text.\n\n\\begin{center}\n${tabular}\n\\end{center}`)).toContain(`\\begin{table}[h]\n\\begin{center}\n${tabular}\n\\end{center}\n\\caption{New}\n\\end{table}`);
    expect(put(`Text.\n\n\\centering\n${tabular}`)).toContain(`\\begin{table}[h]\n\\centering\n${tabular}\n\\caption{New}\n\\end{table}`);
    expect(put(`Text.\n\n\\noindent\n${tabular}`)).toContain(`\\begin{table}[h]\n\\centering\n\\noindent\n${tabular}`);
  });

  it("keeps a file's own line ends", () => {
    const tabular = "\\begin{tabular}{l}\r\na \\\\\r\n\\end{tabular}";
    const text = `\\documentclass{article}\r\n\\begin{document}\r\n\r\n${tabular}\r\n\r\n\\end{document}\r\n`;
    const from = text.indexOf(tabular);
    const out = apply(text, setCaption(text, from, from + tabular.length, "New"));
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(ensurePackage(text, "booktabs")).toMatchObject({ insert: "\\usepackage{booktabs}\r\n" });
  });

  it("takes a caption's label with it when nothing refers to the label", () => {
    const tabular = "\\begin{tabular}{l}\na \\\\\n\\end{tabular}";
    const body = `\\begin{table}\n${tabular}\n\\caption{Old}\\label{tab:a}\n\\end{table}\n`;
    const text = `${DOC0}${body}\\end{document}\n`;
    const from = text.indexOf(tabular);
    const place = captionPlace(text, from, from + tabular.length);
    expect(floatLabels(text, place)).toEqual([{ key: "tab:a", used: false }]);
    expect(apply(text, setCaption(text, from, from + tabular.length, "", true))).toBe(`${DOC0}\\begin{table}\n${tabular}\n\\end{table}\n\\end{document}\n`);
    const cited = text.replace("\\end{document}", "See Table~\\ref{tab:a}.\n\\end{document}");
    expect(floatLabels(cited, captionPlace(cited, from, from + tabular.length))).toEqual([{ key: "tab:a", used: true }]);
  });

  it("refuses a caption where one cannot go, and never touches another table's", () => {
    const tabular = "\\begin{tabular}{l}\na \\\\\n\\end{tabular}";
    const where = (text: string) => {
      const from = text.lastIndexOf(tabular);
      return { place: captionPlace(text, from, from + tabular.length), changes: setCaption(text, from, from + tabular.length, "New") };
    };
    for (const body of [
      `\\begin{minipage}{5cm}\n${tabular}\n\\end{minipage}`,
      `\\begin{table}\n\\resizebox{\\textwidth}{!}{${tabular}}\n\\end{table}`,
      `\\resizebox{\\textwidth}{!}{${tabular}}`,
      `\\fbox{${tabular}}`,
      `\\begin{table}\n\\begin{minipage}{5cm}\n${tabular}\n\\end{minipage}\n\\caption{Old}\n\\end{table}`,
      `\\begin{table}\n${tabular}\n\\caption{First}\n${tabular}\n\\caption{Second}\n\\end{table}`,
      `\\[ ${tabular} \\]`,
      `Text $${tabular}$ text`,
      `\\twocolumn[ ${tabular} ]`,
      `\\section[${tabular}]{x}`,
      `\\begin {table}\n${tabular}\n\\end {table}`,
      `\\begin{table}\n\\fbox{x\\\\% }\n${tabular}}\n\\end{table}`,
      `\\verb|\\begin{table}|\n\n${tabular}\n\n\\begin{table}\\caption{Other}\\end{table}`,
      `\\iffalse\\begin{table}\\fi\n\n${tabular}\n\n\\begin{table}\\caption{Other}\\end{table}`,
      `\\begin{center}\n${tabular}\n\\captionof{table}{Old}\n\\end{center}`,
      `\\begin{table}\n${tabular}\n\\caption{Old % note\n more}\n\\end{table}`,
      `\\begin{table}\n${tabular}\n\\caption{Old\n\nmore}\n\\end{table}`,
      `Text\n$$\n${tabular}\n$$`,
      `\\begin{table}\n$$${tabular}$$\n\\end{table}`,
      `\\twocolumn[\nTitle\n\n${tabular}\n\n]`,
      `\\setbox0\\hbox\\bgroup\n\n${tabular}\n\n\\egroup`,
      `\\table[h]\n\n${tabular}\n\n\\caption{Old}\n\\endtable`,
      `Use \\lstinline{foo}: \\fbox{${tabular}}`,
      `\\begin{figure}\n\\begin{subfigure}{.4\\textwidth}x\\caption{Image}\\end{subfigure}\n${tabular}\n\\end{figure}`,
      `\\begin{figure}\n\\parbox{4cm}{x\\caption{Left}}\n${tabular}\n\\end{figure}`,
      `Some words ${tabular} in a sentence.`,
      `Text straight above\n${tabular}`,
      `We call \\lstinline[language=C]!printf! here. \\fbox{\\parbox{6cm}{Results:\n\n${tabular}\n\n}}`,
      `We call \\lstinline[language=C]{x} here. \\fbox{\\parbox{6cm}{Results:\n\n${tabular}\n\n}}`,
      `An unclosed \\verb|oops\n\n${tabular}\n\n`,
      `Text.\n\n${tabular}\n% note follows\n\\\\[1ex] {\\small Source: x}\n\nMore.`,
      `\\begin{table}\n${tabular}\\label{t}\\\\[1ex]\n{\\small Source: x}\n\\end{table}`,
      `\\begin{table}\n${tabular}\n\\label{t}\n\\\\[1ex] Source\n\\end{table}`,
      `\\begin{table}\n${tabular}\\label{t}\\newline Source: x\n\\end{table}`,
      `\\iffalse\n\\begin{table}\n\\fi\n\n${tabular}\n\n\\iffalse\n\\end{table}\n\\fi`,
      `\\csname begin\\endcsname{minipage}{5cm}\n\n${tabular}\n\n\\csname end\\endcsname{minipage}`,
      `Text\\vadjust{\\iffalse}\\fi\n\n${tabular}\n\n\\iffalse{\\fi}`,
      `\\twocolumn\n[\n\n${tabular}\n\n]`,
      `See \\url{http://example.org/a%20b}: \\parbox{6cm}{\\textbf{Source\ndata}\n\n${tabular}\n\n}`,
    ]) {
      const text = `${DOC0}${body}`;
      const result = where(text);
      const refused = result.place.kind === "no";
      // Either refused, or at the least not mistaken for a caption that belongs elsewhere.
      if (!refused) expect(apply(text, result.changes)).not.toMatch(/\\caption\{New\}\\end\{table\}/);
      if (body.includes("\\verb") || body.includes("\\iffalse")) continue;
      expect(refused, body).toBe(true);
      expect(result.changes).toEqual([]);
    }
    // In a file that another includes, the surroundings cannot be seen, so nothing is done.
    expect(where(tabular).place.kind).toBe("no");
    expect(where(`\\newcommand{\\bt}{\\begin{table}}\n${DOC0}\\bt\n${tabular}\n\\end{table}`).place.kind).toBe("no");
    // Commands that open or close something out of sight, however they are written.
    // ... where the document uses them, before the table or around it.
    for (const [preamble, before, after] of [
      ["\\newcommand{\\bmp}[1]{\\begin{minipage}{#1}}\n\\newcommand{\\emp}{\\end{minipage}}", "\\bmp{5cm}", "\\emp"],
      ["\\newcommand{\\bt}{%\n  \\begin{table}[h]\\centering}", "\\bt", "\\end{table}"],
      ["\\def\\bt{\\bgroup}", "\\bt", "\\egroup"],
      ["\\DeclareDocumentCommand{\\bmp}{}{\\begin{minipage}{5cm}}", "\\bmp", "\\end{minipage}"],
      ["\\newrobustcmd{\\bmp}{\\begin{minipage}{5cm}}", "\\bmp", "\\end{minipage}"],
      ["\\AtBeginDocument{\\begin{minipage}{5cm}}\\AtEndDocument{\\end{minipage}}", "", ""],
      ["\\newenvironment{note}{\\begin{quote}}{\\end{quote}}", "\\begin{note}", "\\end{note}"],
      ["\\let\\b\\begin \\let\\e\\end", "\\b{minipage}{5cm}", "\\e{minipage}"],
      ["\\usepackage{shortvrb}\\MakeShortVerb{\\|}", "", ""],
      ["\\usepackage{listings}\\lstMakeShortInline|", "", ""],
      ["\\def\\b{\\csname begin\\endcsname}", "\\b{minipage}{5cm}", "\\end{minipage}"],
      ["\\def\\b{\\csname begin\\endcsname}\n\\newcommand{\\c}{\\b{minipage}{5cm}}", "\\c", "\\end{minipage}"],
      ["\\long\\def\\boxit#1\\endboxit{\\fbox{#1}}", "\\boxit", "\\endboxit"],
      ["\\renewenvironment{table}{\\begin{minipage}{5cm}}{\\end{minipage}}", "", ""],
      ["\\input{mymacros}", "", ""],
    ]) {
      expect(where(`\\documentclass{article}\n${preamble}\n\\begin{document}\n${before}\n\n${tabular}\n\n${after}\n\\end{document}`).place.kind).toBe("no");
    }
    // Made but not used, they do no harm.
    for (const preamble of [
      "\\newcommand{\\be}{\\begin{equation}}\n\\newcommand{\\ee}{\\end{equation}}",
      "\\newenvironment{note}{\\begin{quote}}{\\end{quote}}",
      "\\AtBeginDocument{\\renewcommand{\\tablename}{Tab.}}",
      "\\makeatletter\n\\expandafter\\def\\csname tabular@note\\endcsname{x}\n\\makeatother",
      "\\input{glyphtounicode}",
    ]) {
      expect(where(`\\documentclass{article}\n${preamble}\n\\begin{document}\n\n${tabular}\n\n\\end{document}`).place.kind).toBe("bare");
    }
    // The same commands made in the body, starred or with parameters marked off their own way.
    for (const made of [
      "\\newcommand*{\\bt}{\\begin{table}[h]\\centering}",
      "\\newcommand*\\bt{\\begin{table}[h]}",
      "\\def\\bt(#1){\\begin{table}[#1]}",
      "\\def\\bt#1%\n{\\begin{table}[#1]}",
      "\\newcommand{\\bt}[1][h]{\\begin{table}[#1]}",
    ]) {
      expect(where(`\\documentclass{article}\n\\begin{document}\n${made}\n\n${tabular}\n\n\\end{document}`).place.kind).toBe("no");
    }
    // A class without ordinary floats.
    expect(where(`\\documentclass{standalone}\n\\begin{document}\n${tabular}\n\\end{document}`).place.kind).toBe("no");
    expect(where(`\\documentclass[12pt]{article}\n\\begin{document}\n${tabular}\n\\end{document}`).place.kind).toBe("bare");
    // A float whose table is followed by nothing but its end, a label or a blank line is fine.
    for (const rest of ["\n", "\n\\label{t}\n", "\n\n\\footnotesize Source: X.\n"]) {
      expect(where(`${DOC0}\\begin{table}\n\\centering\n${tabular}${rest}\\end{table}`).place.kind).toBe("float");
    }
    // A short form with brackets of its own is still the float's one caption.
    const short = `${DOC0}\\begin{table}\n${tabular}\n\\par\\caption[Short {[1]}]{Long}\n\\end{table}`;
    const at2 = short.indexOf(tabular);
    expect(captionOf(short, at2, at2 + tabular.length)).toBe("Long");
    expect(apply(short, setCaption(short, at2, at2 + tabular.length, "New"))).toBe(short.replace("Long", "New"));
    // \captionsetup is not a caption.
    expect(where(`${DOC0}\\begin{table}\n\\captionsetup{font=small}\n${tabular}\n\\end{table}`).place).toMatchObject({ kind: "float" });
    expect(captionOf(`${DOC0}\\begin{table}\n\\captionsetup{font=small}\n${tabular}\n\\end{table}`, `${DOC0}\\begin{table}\n\\captionsetup{font=small}\n`.length, `${DOC0}\\begin{table}\n\\captionsetup{font=small}\n`.length + tabular.length)).toBeNull();
    // A percent sign in a web address is not a comment, so what follows it is still seen.
    expect(where(`${DOC0}See \\url{http://example.org/a%20b}.\n\n${tabular}\n\n\\end{document}`).place.kind).toBe("bare");
    // Things an ordinary document has that must not make the tool decline.
    for (const body of [
      `A holds $a \\iff b$.\n\n${tabular}\n\nEnd.`,
      `\\begin{table}\n\\renewcommand{\\arraystretch}{1.3}\n${tabular}\n\\end{table}`,
      `\\tikz \\path (0,0) -- (1,1);\n\n${tabular}\n\nEnd.`,
      `\\tikz \\path[draw] (0,0) -- (1,1);\n\n${tabular}\n\nEnd.`,
    ]) {
      expect(where(`${DOC0}${body}`).place.kind).not.toBe("no");
    }
    // Ordinary definitions, in the preamble or the body, do not stand in the way.
    expect(where(`\\documentclass{article}\n\\newcommand{\\R}{\\mathbb{R}}\n\\begin{document}\n\\def\\x{y}\n\n${tabular}\n\n\\end{document}`).place.kind).toBe("bare");
    // A comment or verbatim text that mentions verbatim must not hide what follows it.
    const hidden = `${DOC0}% Code goes in \\begin{verbatim} blocks.\n\\begin{minipage}{5cm}\n${tabular}\n\\end{minipage}\n\\begin{verbatim}\nx\n\\end{verbatim}`;
    expect(where(hidden).place.kind).toBe("no");
    expect(where(`${DOC0}Say \\verb|\\begin{verbatim}| and\n\n\\fbox{${tabular}}\n\n\\begin{verbatim}\nx\n\\end{verbatim}`).place.kind).toBe("no");
    // Each table of a pair with its own sub-float has its own caption.
    const pair = `${DOC0}\\begin{table}\n\\begin{subtable}{.5\\linewidth}\n${tabular}\n\\caption{First}\n\\end{subtable}\n\\begin{subtable}{.5\\linewidth}\n${tabular}\n\\caption{Second}\n\\end{subtable}\n\\end{table}`;
    const at = pair.lastIndexOf(tabular);
    expect(captionOf(pair, at, at + tabular.length)).toBe("Second");
    expect(apply(pair, setCaption(pair, at, at + tabular.length, "New"))).toBe(pair.replace("Second", "New"));
    // A caption in a comment is not the caption; a table centred in its float is still in it.
    const commented = `${DOC0}\\begin{table}\n\\begin{center}\n${tabular}\n\\end{center}\n% \\caption{Old}\n\\caption{Real}\n\\end{table}`;
    const from = commented.indexOf(tabular);
    expect(captionOf(commented, from, from + tabular.length)).toBe("Real");
    expect(apply(commented, setCaption(commented, from, from + tabular.length, "New"))).toBe(commented.replace("Real", "New"));
  });

  it("knows a caption that would break the document", () => {
    expect(soundCaption("Results for \\textbf{2025}")).toBe(true);
    expect(soundCaption("50\\% done")).toBe(true);
    expect(soundCaption("50% done")).toBe(false);
    expect(soundCaption("open {brace")).toBe(false);
    expect(soundCaption("close} brace")).toBe(false);
    expect(soundCaption("ends with \\")).toBe(false);
    expect(soundCaption("Cost in $ per unit")).toBe(false);
    expect(soundCaption("Cost in \\$ per unit, $x$")).toBe(true);
    expect(soundCaption("Item #3")).toBe(false);
    expect(soundCaption("Item \\#3")).toBe(true);
    // A caret or an underscore on its own in prose would stop the document compiling.
    expect(soundCaption("50^2 metres")).toBe(false);
    expect(soundCaption("Sales_2024")).toBe(false);
    expect(soundCaption("$50^2$ metres, $x_i$, \\(c^d\\)")).toBe(true);
    // A display cannot stand in a cell or a caption.
    expect(soundCaption("$$a_b$$")).toBe(false);
    expect(soundCaption("\\[x^2\\]")).toBe(false);
    // An & on its own would end the cell, or break the caption; in an environment it is a column.
    expect(soundCaption("R & D")).toBe(false);
    expect(soundCaption("$\\begin{matrix} a & b \\end{matrix}$")).toBe(true);
    expect(soundCaption("\\si{m^2}, \\ref{tab:a_b}, \\url{http://x.org/a_b#frag}")).toBe(true);
    expect(soundCaption("open \\( never closed")).toBe(false);
    expect(soundCaption("$a$$")).toBe(false);
    expect(soundCaption("$$a$")).toBe(false);
    expect(soundCaption("$x$$y$")).toBe(true);
    expect(soundCaption("$x$$y$$z$")).toBe(true);
    expect(soundCaption("$\\alpha$$y_1$")).toBe(true);
    expect(escapeInserted("$\\alpha$$y", "$\\alpha$$y_")).toBe("$\\alpha$$y_");
    expect(escapeInserted("$x$$y$", "$x$$y_1$ a_b")).toBe("$x$$y_1$ a\\_b");
  });

  it("says what stops a cell or a caption going in", () => {
    expect(cellProblem("fine")).toBeNull();
    expect(cellProblem("Sales_2024")).toMatch(/underscore/);
    expect(cellProblem("Item #3")).toMatch(/#/);
    expect(cellProblem("50% done")).toMatch(/%/);
    expect(cellProblem("open {brace")).toMatch(/not closed/);
    expect(cellProblem("close} brace")).toMatch(/no opening/);
    expect(cellProblem("$$a$$")).toMatch(/display/);
    expect(cellProblem("Cost in $ per unit")).toMatch(/\$ starts a formula/);
    // A caret: the message offers the formula it was probably meant to be.
    expect(cellProblem("area 50^2 metres")).toContain("$50^2$");
  });

  it("takes the argument of \\text inside a formula for text", () => {
    expect(escapeInserted("", "$\\text{a_b}$ $x_1$")).toBe("$\\text{a\\_b}$ $x_1$");
    expect(escapeInserted("", "$\\mbox{a_b}$")).toBe("$\\mbox{a\\_b}$");
    expect(soundCaption("$\\text{a_b}$")).toBe(false);
    expect(soundCaption("$\\text{a\\_b} + x_1$")).toBe(true);
    // A formula inside the text inside a formula is a formula again.
    expect(escapeInserted("", "$\\text{if $x_1$}$")).toBe("$\\text{if $x_1$}$");
  });

  it("counts a command's arguments, and takes a group or [ after the last of them for text", () => {
    expect(escapeInserted("", "\\textbf{a}{c_d}")).toBe("\\textbf{a}{c\\_d}");
    expect(escapeInserted("", "\\textbf{a}[b_c]")).toBe("\\textbf{a}[b\\_c]");
    expect(escapeInserted("", "\\LaTeX[a_b")).toBe("\\LaTeX[a\\_b");
    expect(escapeInserted("", "\\color{red}{a_b}")).toBe("\\color{red}{a\\_b}");
    // Options and arguments that are names keep their underscores.
    expect(escapeInserted("", "\\raisebox{1ex}[0pt][0pt]{a_b}")).toBe("\\raisebox{1ex}[0pt][0pt]{a\\_b}");
    expect(escapeInserted("", "\\makebox[2cm_x]{a_b}")).toBe("\\makebox[2cm_x]{a\\_b}");
    expect(escapeInserted("", "\\label {a_b} \\ref {a_b}")).toBe("\\label {a_b} \\ref {a_b}");
    expect(escapeInserted("", "\\href{http://x/a_b}{my_page}")).toBe("\\href{http://x/a_b}{my\\_page}");
  });

  it("gives an escape back its backslash when only something other than a backslash was typed between", () => {
    expect(escapeInserted("A\\&B", "A\\ &B")).toBe("A\\ \\&B");
    expect(escapeInserted("50\\%", "50\\,%")).toBe("50\\,\\%");
    // A backslash typed there is a command being started in front of the escape.
    expect(escapeInserted("50\\%", "50\\\\%")).toBe("50\\\\%");
  });

  it("notices dollar signs meant as money", () => {
    expect(looksLikeMoney("Price $5 to $10")).toBe(true);
    expect(looksLikeMoney("$x$ and $5$ items")).toBe(false);
    expect(looksLikeMoney("Price \\$5 to \\$10")).toBe(false);
  });

  it("stays quick with a long text that has many groups", () => {
    const pasted = "\\textbf{a_b} {c_d} \\href{u_v}{w_x} & % ".repeat(400);
    const started = Date.now();
    escapeInserted("", pasted);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("finds the smallest change between two versions of a table", () => {
    const before = "\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}";
    const after = "\\begin{tabular}{ll}\na & bc \\\\\n\\end{tabular}";
    expect(smallestChange(before, after, 100)).toEqual({ from: 100 + before.indexOf("b ") + 1, to: 100 + before.indexOf("b ") + 1, insert: "c" });
    expect(smallestChange(before, before)).toBeNull();
    expect(smallestChange("aaa", "aa", 0)).toEqual({ from: 2, to: 3, insert: "" });
  });
});

describe("hand-written tables that must not be touched", () => {
  const wrap = (spec: string, body: string) => `\\begin{tabular}{${spec}}\n${body}\n\\end{tabular}`;

  it("keeps the space of a control space at the end of a merged cell", () => {
    const t = read(wrap("ll", "\\multicolumn{2}{c}{a\\ } \\\\\n\\multirow{2}{*}{b\\ } & c \\\\\n & d \\\\"));
    expect(t.rows[0][0].tex).toBe("a\\ ");
    const written = writeTable(insertRow(t, 3));
    expect(written).toContain("\\multicolumn{2}{c}{a\\ }");
    expect(written).toContain("\\multirow{2}{*}{b\\ }");
    expect(parseTable(written).ok).toBe(true);
  });

  it("takes verbatim text whole, its & and \\\\ included, and refuses it where it cannot be followed", () => {
    const t = read(wrap("ll", "\\verb|a&b| & c \\\\"));
    expect(tex(t)).toEqual([["\\verb|a&b|", "c"]]);
    expect(tex(read(wrap("l", "\\verb|a\\\\b| \\\\")))).toEqual([["\\verb|a\\\\b|"]]);
    expect(tex(read(wrap("ll", "\\lstinline|x| & b \\\\")))).toEqual([["\\lstinline|x|", "b"]]);
    expect(reason(wrap("ll", "\\verb|a & b \\\\"))).toMatch(/verb/);
  });

  it("keeps a rule's thickness, and holds back text that would be taken for one", () => {
    const thick = read(wrap("ll", "a & b \\\\\n\\midrule[2pt]\nc & d \\\\"));
    expect(thick.hrules[1]).toEqual({ kind: "midrule", width: "2pt" });
    expect(writeTable(thick)).toContain("\\midrule[2pt]");
    // As LaTeX reads it, brackets straight after a booktabs rule are its thickness.
    expect(read(wrap("ll", "\\toprule\n[1] & b \\\\")).hrules[0]).toEqual({ kind: "toprule", width: "1" });
    // ... and after a line end, the space after the row. So "[1]" typed at the start of a row
    // would not read back as typed, and is held back; anywhere else it is text.
    const t = read(wrap("ll", "\\toprule\na & b \\\\\nc & d \\\\"));
    const kept = (x: Table) => parseTable(writeTable(x)).ok && JSON.stringify(read(writeTable(x))) === JSON.stringify(x);
    expect(kept(setCell(t, 0, 0, "[1]"))).toBe(false);
    expect(kept(setCell(t, 1, 0, "[1]"))).toBe(false);
    expect(kept(setCell(t, 0, 1, "[1]"))).toBe(true);
  });

  it("refuses rules of kinds it does not know, but not a rule drawn inside a cell", () => {
    expect(reason(wrap("ll", "\\firsthline a & b \\\\"))).toMatch(/firsthline/);
    expect(reason(wrap("ll", "a & b \\\\ \\Xhline{1pt} c & d \\\\"))).toMatch(/Xhline/);
    expect(reason(wrap("ll", "a & b \\\\ \\hlineB{2} c & d \\\\"))).toMatch(/hlineB/);
    expect(reason(wrap("ll", "a & \\rule{1cm}{1pt} \\\\"))).toBe("editable");
  });

  it("keeps empty cells under a merged cell that are described in their own way", () => {
    const one = read(wrap("ll", "\\multirow{2}{*}{a} & b \\\\\n\\multicolumn{1}{l|}{} & d \\\\"));
    expect(one.rows[1][0]).toMatchObject({ hidden: true, fill: "l|" });
    expect(writeTable(one)).toContain("\\multicolumn{1}{l|}{} & d \\\\");
    const wide = read(wrap("lll", "\\multicolumn{2}{c|}{\\multirow{2}{*}{a}} & b \\\\\n\\multicolumn{2}{c}{} & d \\\\"));
    expect(writeTable(wide)).toContain("\\multicolumn{2}{c}{} & d \\\\");
    expect(reason(wrap("lll", "\\multicolumn{2}{c|}{\\multirow{2}{*}{a}} & b \\\\\n\\multicolumn{2}{c|}{} & d \\\\"))).toBe("editable");
  });

  it("refuses a rule written straight through a merged cell, which it would have to cut", () => {
    expect(reason(wrap("ll", "\\multirow{2}{*}{a} & b \\\\\n\\hline\n & d \\\\"))).toMatch(/through a merged cell/);
    expect(reason(wrap("ll", "\\multirow{2}{*}{a} & b \\\\\n\\midrule\n & d \\\\"))).toMatch(/through a merged cell/);
    expect(reason(wrap("ll", "\\multirow{2}{*}{a} & b \\\\\n\\cline{1-2}\n & d \\\\"))).toMatch(/through a merged cell/);
    expect(reason(wrap("ll", "\\multirow{2}{*}{a} & b \\\\\n\\cline{2-2}\n & d \\\\"))).toBe("editable");
  });
});

describe("what a rewrite must leave alone", () => {
  const wrap = (spec: string, body: string) => `\\begin{tabular}{${spec}}\n${body}\n\\end{tabular}`;

  it("keeps spaces that print, such as a no-break space, at the edges of a cell", () => {
    const t = read(wrap("rl", "\u00a0\u00a01\u00a0 & \u2007 \\\\"));
    expect(t.rows[0][0].tex).toBe("\u00a0\u00a01\u00a0");
    expect(t.rows[0][1].tex).toBe("\u2007");
    expect(writeTable(insertRow(t, 1))).toContain("\u00a0\u00a01\u00a0 & \u2007 \\\\");
  });

  it("keeps a \\cline under every column as a \\cline, and refuses a merge over one row", () => {
    const source = wrap("ll", "a & b \\\\\n\\cline{1-2}\nc & d \\\\");
    expect(writeTable(read(source))).toBe(source);
    expect(reason(wrap("ll", "\\multirow{1}{*}{a} & b \\\\"))).toMatch(/fewer than two rows/);
  });

  it("reads a row that begins with a bracket in round form after a booktabs rule", () => {
    const source = wrap("lr", "\\toprule\nTerm & Value \\\\\n\\midrule\n(Intercept) & 1 \\\\\n\\bottomrule");
    expect(writeTable(read(source))).toBe(source);
  });

  it("refuses addresses written between bars", () => {
    expect(reason(wrap("ll", "\\path|a&b| \\\\"))).toMatch(/path/);
    expect(reason(wrap("ll", "\\url|a&b| \\\\"))).toMatch(/url/);
    expect(reason(wrap("ll", "\\url{http://x.org/?a=1&b=2} & b \\\\"))).toBe("editable");
  });

  it("lets a table with a hand-written heading be aligned, bordered and divided", () => {
    const t = read(wrap("ll", "\\multicolumn{2}{c}{Head} \\\\\na & b \\\\"));
    for (const next of [
      setAlign(t, { top: 1, left: 0, bottom: 1, right: 0 }, "c"),
      setAlign(t, { top: 0, left: 0, bottom: 0, right: 0 }, "r"),
      toggleBorders(t),
      toggleBorders(toggleBorders(t)),
      splitIntoColumns(t, 1, 1),
      insertColumn(t, 1),
    ]) {
      expect(read(writeTable(next))).toEqual(next);
    }
    expect(writeTable(setAlign(t, { top: 1, left: 1, bottom: 1, right: 1 }, "r")).split("\n")[1]).toBe("\\multicolumn{2}{c}{Head} \\\\");
    const single = read(wrap("ll", "\\multicolumn{1}{c}{x} & b \\\\\na & b \\\\"));
    const divided = splitIntoColumns(single, 1, 0);
    expect(read(writeTable(divided))).toEqual(divided);
  });
});

describe("cells written over several lines", () => {
  it("keep their lines, and show as one line with a space where each line ended", () => {
    const t = read("\\begin{tabular}{ll}\nName & A long description that\n   continues here \\\\\n\\multicolumn{2}{c}{two\nlines} \\\\\n\\end{tabular}");
    expect(t.rows[0][1].tex).toBe("A long description that\n   continues here");
    expect(oneLine(t.rows[0][1].tex)).toBe("A long description that continues here");
    expect(t.rows[1][0].tex).toBe("two\nlines");
    expect(read(writeTable(t))).toEqual(t);
    expect(reason("\\begin{tabular}{ll}\nName & a\n\nb \\\\\n\\end{tabular}")).toMatch(/blank line/);
  });

  it("a heading keeps its own alignment when the column it started in is deleted", () => {
    const t = read("\\begin{tabular}{lcr}\nx & \\multicolumn{2}{c}{H} \\\\\na & b & c \\\\\n\\end{tabular}");
    expect(writeTable(deleteColumn(t, 1)).split("\n").slice(0, 2)).toEqual(["\\begin{tabular}{lr}", "x & \\multicolumn{1}{c}{H} \\\\"]);
    expect(reason("\\begin{tabular}{ll}\na & b\\crcr\n\\end{tabular}")).toMatch(/crcr/);
  });
});

describe("rules and merged cells", () => {
  it("a rule cut by a merge is whole again when the cell is split", () => {
    const start = grid(2, 1);
    const merged = merge(start, { top: 0, left: 0, bottom: 1, right: 0 });
    expect(writeTable(merged)).not.toContain("\\\\\n\\hline\n\\\\");
    const one = merge(grid(3, 2), { top: 0, left: 0, bottom: 1, right: 0 });
    expect(writeTable(one)).toContain("\\cline{2-2}");
    expect(splitMerged(one, 0, 0).hrules).toEqual(grid(3, 2).hrules);
  });

  it("a column added beside a merged cell gets the rules its neighbours have", () => {
    const t = insertColumn(merge(grid(2, 2), { top: 0, left: 0, bottom: 1, right: 0 }), 2);
    expect(writeTable(t)).toContain("\\cline{2-3}");
  });

  it("deleting a row out of a merged cell leaves no stray partial rule", () => {
    const merged = merge(grid(3, 2), { top: 0, left: 0, bottom: 1, right: 0 });
    const t = deleteRow(merged, 1);
    expect(t.rows[0][0].rowSpan).toBe(1);
    expect(writeTable(t)).not.toContain("cline");
    expect(t.hrules.map((r) => r.kind)).toEqual(["hline", "hline", "hline"]);
  });

  it("merging across a booktabs rule turns it into one that can go around the cell", () => {
    const t = read("\\begin{tabular}{ll}\n\\toprule\na & b \\\\\n\\midrule\nc & d \\\\\n\\bottomrule\n\\end{tabular}");
    const merged = merge(t, { top: 0, left: 0, bottom: 1, right: 0 });
    expect(writeTable(merged).split("\n")).toEqual(["\\begin{tabular}{ll}", "\\toprule", "\\multirow{2}{*}{a c} & b \\\\", "\\cmidrule{2-2}", "& d \\\\", "\\bottomrule", "\\end{tabular}"]);
    expect(read(writeTable(merged))).toEqual(merged);
    // Split again, the rule is the whole \midrule it was.
    expect(splitMerged(merged, 0, 0).hrules[1]).toEqual({ kind: "midrule" });
  });

  it("holds through a long run of varied actions", () => {
    // A fixed pseudo-random walk: every table along it must read back as itself, and no
    // action except deleting a row or column may lose a word that was typed.
    let seed = 12345;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const words = (t: Table) => t.rows.flat().flatMap((c) => c.tex.split(" ")).filter(Boolean).sort().join(" ");
    let t = grid(3, 3);
    for (let step = 0; step < 600; step++) {
      const [rows, cols] = [t.rows.length, t.aligns.length];
      const [r, c] = [next(rows), next(cols)];
      const block = { top: r, left: c, bottom: Math.min(rows - 1, r + next(2)), right: Math.min(cols - 1, c + next(2)) };
      const before = words(t);
      const kind = next(11);
      let deletes = false;
      if (kind === 0 && rows * cols < 60) t = merge(t, block);
      else if (kind === 1 && !t.rows[r][c].hidden && (t.rows[r][c].colSpan > 1 || t.rows[r][c].rowSpan > 1)) t = splitMerged(t, r, c);
      else if (kind === 2 && cols < 7) t = splitIntoColumns(t, r, c);
      else if (kind === 3 && rows < 7) t = splitIntoRows(t, r, c);
      else if (kind === 4 && rows < 7) t = insertRow(t, next(rows + 1));
      else if (kind === 5 && cols < 7) t = insertColumn(t, next(cols + 1));
      else if (kind === 6 && rows > 2) {
        t = deleteRow(t, r);
        deletes = true;
      }
      else if (kind === 7 && cols > 2) {
        t = deleteColumn(t, c);
        deletes = true;
      }
      else if (kind === 8) t = toggleBorders(t);
      else if (kind === 9) t = setAlign(t, block, (["l", "c", "r"] as const)[next(3)]);
      else if (!t.rows[r][c].hidden) {
        t = setCell(t, r, c, `w${step}`);
        deletes = true;
      }
      expect(t.rows.every((row) => row.length === t.aligns.length)).toBe(true);
      expect(t.hrules).toHaveLength(t.rows.length + 1);
      expect(t.vrules).toHaveLength(t.aligns.length + 1);
      const back = parseTable(writeTable(t));
      expect(back.ok && JSON.stringify(back.table)).toBe(JSON.stringify(t));
      if (!deletes) expect(words(t)).toBe(before);
    }
  });
});

describe("text typed into a cell", () => {
  it("has a bare ampersand or percent sign written as the character, and leaves escaped ones alone", () => {
    expect(escapeTyped("R&D 5%")).toBe("R\\&D 5\\%");
    expect(escapeTyped("R\\&D 5\\%")).toBe("R\\&D 5\\%");
    expect(escapeTyped("$x$ \\textbf{b}")).toBe("$x$ \\textbf{b}");
    // Inside braces an ampersand may be part of a matrix or an address, and is left as typed.
    expect(escapeTyped("$\\pmatrix{a & b}$ & c")).toBe("$\\pmatrix{a & b}$ \\& c");
    expect(escapeTyped("\\(\\matrix{a & b}\\) & c")).toBe("\\(\\matrix{a & b}\\) \\& c");
    expect(escapeTyped("\\textbf{R&D}")).toBe("\\textbf{R\\&D}");
    expect(escapeTyped("$50%$")).toBe("$50\\%$");
    expect(escapeTyped("ends \\")).toBe("ends \\");
  });
});

describe("text typed into a box that already held text", () => {
  it("escapes what was typed and never what was there", () => {
    const had = "\\xymatrix{A \\ar[r] & B \\\\ C & D} and \\url{http://x.org/?a=1&b=2}";
    expect(escapeInserted(had, `${had}!`)).toBe(`${had}!`);
    expect(escapeInserted(had, `x${had}`)).toBe(`x${had}`);
    expect(escapeInserted(had, `${had} R&D 5%`)).toBe(`${had} R\\&D 5\\%`);
    expect(escapeInserted("a  b", "a & b")).toBe("a \\& b");
    expect(escapeInserted(had, had)).toBe(had);
    expect(escapeInserted(had, had.slice(0, -1))).toBe(had.slice(0, -1));
  });

  it("treats changes in two places as two changes, leaving what lies between alone", () => {
    const had = "Sizes of \\ensuremath{\\begin{array}{cc}a & b\\end{array}} and \\url{x?a=1&b=2%20} in 2020";
    const now = `New ${had.replace("2020", "2021")}`;
    expect(escapeInserted(had, now)).toBe(now);
    expect(escapeInserted(had, `R&D: ${had.replace("2020", "50%")}`)).toBe(`R\\&D: ${had.replace("2020", "50\\%")}`);
  });

  it("never leaves bare a character that was escaped, when the text around it is retyped", () => {
    expect(escapeInserted("Profit \\& loss", "Research & development")).toBe("Research \\& development");
    expect(escapeInserted("A \\& B", "C & D")).toBe("C \\& D");
    expect(escapeInserted("50\\% of X", "100% of X")).toBe("100\\% of X");
    expect(escapeInserted("Sales \\& marketing, 2023", "Sales & marketing, 2024")).toBe("Sales \\& marketing, 2024");
  });

  /** Type text one key at a time, as the cell box does. */
  const typeOut = (keys: string, start = "") => {
    let value = start;
    for (const key of keys) value = key === "\b" ? escapeInserted(value, value.slice(0, -1)) : escapeInserted(value, value + key);
    return value;
  };

  it("writes an underscore or a hash typed in prose so that it prints", () => {
    expect(typeOut("Sales_2024")).toBe("Sales\\_2024");
    expect(typeOut("Item #3")).toBe("Item \\#3");
    expect(typeOut("\\textbf{a_b} and \\href{http://x.org/a_b}{my_text}")).toBe("\\textbf{a\\_b} and \\href{http://x.org/a_b}{my\\_text}");
    expect(typeOut("a\\_b and \\#1")).toBe("a\\_b and \\#1");
    // What was already there is left exactly as written.
    expect(escapeInserted("run_2 #x", "Old run_2 #x")).toBe("Old run_2 #x");
  });

  it("leaves them alone in mathematics and in any argument that is a name, a unit or a formula", () => {
    for (const typed of [
      "$x_i^2$ and $R^2$",
      "$$a_b$$",
      "\\(x_1\\) and \\ensuremath{x_1}",
      "see \\ref{tab:my_table} and \\cite[p.~3]{knuth_84}",
      "\\autocite{knuth_84} \\textcite{lamport_94} \\vref{sec:a_b} \\crefrange{sec:a_b}{sec:c_d}",
      "\\includegraphics[width=1cm]{fig_1}",
      "\\si{m^2} \\qty{3}{m^2} \\num{10^3} \\ce{SO4^2-}",
      "\\gls{my_term} \\textcolor{my_red}{x}",
      "\\hyperref[sec:a_b]{text}",
      "H$_2$O",
    ]) {
      expect(typeOut(typed)).toBe(typed);
    }
    expect(typeOut("see [note_1]")).toBe("see [note\\_1]");
  });

  it("takes the backslash away with a character it was put there for", () => {
    expect(typeOut("Sales_\b2024")).toBe("Sales2024");
    expect(typeOut("file_\bx")).toBe("filex");
    expect(typeOut("x#\by")).toBe("xy");
    expect(typeOut("R&\bD")).toBe("RD");
    expect(typeOut("50%\b")).toBe("50");
    // Deleting the underscore out of the middle does the same.
    expect(escapeInserted("Sales\\_2024", "Sales\\2024")).toBe("Sales2024");
    // A backslash that begins a command is nobody's leftover.
    expect(escapeInserted("\\alpha_1", "\\alpha1")).toBe("\\alpha1");
    expect(escapeInserted("a\\\\_b", "a\\\\b")).toBe("a\\\\b");
  });

  it("keeps a backslash typed in front of an escaped character, and the escape too", () => {
    expect(escapeInserted("50\\%", "50\\,\\%")).toBe("50\\,\\%");
    expect(escapeInserted("50\\%", "50\\\\%")).toBe("50\\\\%");
    expect(escapeInserted("R\\&D", "R\\,\\&D")).toBe("R\\,\\&D");
    expect(escapeInserted("a \\& b", "a \\quad\\& b")).toBe("a \\quad\\& b");
    expect(escapeInserted("x\\_y", "x\\-\\_y")).toBe("x\\-\\_y");
    expect(escapeInserted("\\#", "\\textbf{\\#")).toBe("\\textbf{\\#");
    expect(escapeInserted("\\_id", "\\texttt{\\_id")).toBe("\\texttt{\\_id");
    // Typed key by key in front of the escape, as it really happens.
    let value = "50\\%";
    for (const key of ["\\", ","]) value = escapeInserted(value, `50${value.slice(2, value.length - 2)}${key}\\%`);
    expect(value).toBe("50\\,\\%");
  });

  it("escapes an underscore in the text of boxes, headers and other commands that hold prose", () => {
    for (const [typed, written] of [
      ["\\rotatebox{90}{unit_cost}", "\\rotatebox{90}{unit\\_cost}"],
      ["\\thead{unit_cost}", "\\thead{unit\\_cost}"],
      ["\\fbox{a_b} \\makebox[2cm]{a_b}", "\\fbox{a\\_b} \\makebox[2cm]{a\\_b}"],
      ["\\textsuperscript{a_b}", "\\textsuperscript{a\\_b}"],
      ["\\hyperref[sec:a_b]{my_text}", "\\hyperref[sec:a_b]{my\\_text}"],
      ["\\footnotesize{a_b} {\\small c_d}", "\\footnotesize{a\\_b} {\\small c\\_d}"],
      ["\\MakeUppercase{a_b}", "\\MakeUppercase{a\\_b}"],
    ]) {
      expect(typeOut(typed)).toBe(written);
      expect(soundCaption(written)).toBe(true);
      expect(soundCaption(typed)).toBe(false);
    }
  });

  it("stays quick when a long text is pasted", () => {
    const pasted = "\\textbf{word} [x] $a_b$ plain_text & more % ".repeat(120);
    const started = Date.now();
    expect(escapeInserted("", pasted).length).toBeGreaterThan(pasted.length);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("does not escape twice, however the keys come", () => {
    expect(typeOut("\\_")).toBe("\\_");
    expect(typeOut("a_", "")).toBe("a\\_");
    expect(typeOut("_", "a\\_")).toBe("a\\_\\_");
    expect(typeOut("a_b & c% #d")).toBe("a\\_b \\& c\\% \\#d");
    expect(escapeInserted("", "a_b & c% #d")).toBe("a\\_b \\& c\\% \\#d");
  });

  it("knows mathematics and a waiting backslash from what stands before", () => {
    expect(escapeInserted("$a  b$", "$a & b$")).toBe("$a & b$");
    expect(escapeInserted("$a$  b", "$a$ & b")).toBe("$a$ \\& b");
    expect(escapeInserted("50\\", "50\\%")).toBe("50\\%");
    expect(escapeInserted("", "R&D")).toBe("R\\&D");
  });
});

describe("tables from the clipboard", () => {
  it("escapes the characters LaTeX would otherwise act on", () => {
    expect(escapeTex("R&D: 50% of $5 #1 a_b {x} ~ ^ \\")).toBe("R\\&D: 50\\% of \\$5 \\#1 a\\_b \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}");
    expect(escapeTex("  two\u00a0words\n here ")).toBe("two words here");
  });

  it("reads spreadsheet text, and only when it really is a table", () => {
    const copied = copiedFromPlain("Name\tShare\r\nR&D\t50%\r\n");
    expect(copied).toEqual([[{ text: "Name" }, { text: "Share" }], [{ text: "R&D" }, { text: "50%" }]]);
    expect(writeTable(tableFromCopied(copied!)!)).toBe("\\begin{tabular}{|l|l|}\n\\hline\nName & Share \\\\\n\\hline\nR\\&D & 50\\% \\\\\n\\hline\n\\end{tabular}");
    expect(copiedFromPlain("just a sentence\nand another")).toBeNull();
    // Spans that overlap, as malformed copied HTML can have, are cut back to fit.
    const odd = tableFromCopied([[{ text: "a", rowSpan: 2 }, { text: "b" }], [{ text: "c", colSpan: 2 }]])!;
    expect(odd).not.toBeNull();
    expect(read(writeTable(odd))).toEqual(odd);
    // Indented source and ragged lines have tabs too, and are not tables.
    expect(copiedFromPlain("\\begin{itemize}\n\t\\item a\n\t\\item b\n\\end{itemize}")).toBeNull();
    expect(copiedFromPlain("a\tb\nc")).toBeNull();
    expect(copiedFromPlain("one\tcell too many\textra\na\tb")).toBeNull();
    expect(tableFromCopied([])).toBeNull();
  });

  it("keeps cells that were merged in Word or Excel, and squares off ragged rows", () => {
    const t = tableFromCopied([
      [{ text: "Head", colSpan: 2 }, { text: "Side", rowSpan: 2 }],
      [{ text: "a" }, { text: "b" }],
      [{ text: "only one" }],
    ])!;
    expect(tex(t)).toEqual([
      ["Head", "·", "Side"],
      ["a", "b", "·"],
      ["only one", "", ""],
    ]);
    expect(t.rows[0][2].rowSpan).toBe(2);
    expect(read(writeTable(t))).toEqual(t);
  });
});
