import { describe, expect, it } from "vitest";
import {
  type Table,
  captionOf,
  captionPlace,
  copiedFromPlain,
  deleteColumn,
  deleteRow,
  ensureMultirow,
  escapeInserted,
  escapeTex,
  escapeTyped,
  expandRect,
  insertColumn,
  insertRow,
  merge,
  needsMultirow,
  newTable,
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
    expect(reason(wrap("lp{3cm}", "a & b \\\\"))).toMatch(/column type/);
    expect(reason(wrap("l@{}l", "a & b \\\\"))).toMatch(/column type/);
    expect(reason(wrap("l||l", "a & b \\\\"))).toMatch(/double/);
    expect(reason(wrap("ll", "a & \\begin{tabular}{l} x \\end{tabular} \\\\"))).toMatch(/another environment/);
    expect(reason(wrap("ll", "a & b \\\\ % a note\nc & d \\\\"))).toMatch(/comment/);
    expect(reason(wrap("ll", "a & b \\\\[2pt]\nc & d \\\\"))).toMatch(/space after a row/);
    expect(reason(wrap("ll", "\\rowcolor{gray} a & b \\\\"))).toMatch(/rowcolor/);
    expect(reason(wrap("ll", "a & b \\\\ \\hline\\hline c & d \\\\"))).toMatch(/more than one rule/);
    expect(reason(wrap("ll", "a & b \\\\ \\cmidrule{1-2} c & d \\\\"))).toMatch(/cmidrule/);
    expect(reason(wrap("ll", "a & b & c \\\\"))).toMatch(/every column/);
    expect(reason(wrap("ll", "a \\\\"))).toMatch(/every column/);
    expect(reason(wrap("ll", "\\multirow{2}{*}{a} & b \\\\ oops & d \\\\"))).toMatch(/not empty/);
    expect(reason(wrap("ll", "\\multirow{3}{*}{a} & b \\\\ & d \\\\"))).toMatch(/more rows/);
    expect(reason(wrap("ll", "\\multirow{2}{2cm}{a} & b \\\\ & d \\\\"))).toMatch(/cannot be edited/);
    expect(reason(wrap("ll", "\\multicolumn{2}{p{2cm}}{a} \\\\"))).toMatch(/column type/);
    expect(reason(wrap("ll", "a & b \\hline \\\\"))).toMatch(/middle of a row/);
    expect(reason(wrap("ll", "a & {b \\\\"))).toMatch(/braces/);
    expect(reason("\\begin{tabularx}{\\textwidth}{lX}\na & b \\\\\n\\end{tabularx}")).toMatch(/plain tabular/);
    expect(reason("\\begin{tabular}{ll}\na & b \\\\\n")).toMatch(/not finished/);
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
      `\\begin{center}\n${tabular}\n\\end{center}`,
      `\\begin{table}\n\\centering\n${tabular}\\\\[1ex]\n\\footnotesize Source: X.\n\\end{table}`,
      `\\begin{table}\n${tabular}\n\\\\ Source: X.\n\\end{table}`,
      `\\begin{table}\n${tabular}\n\\footnotesize Source: X.\n\\end{table}`,
      `We call \\lstinline[language=C]!printf! here. \\fbox{\\parbox{6cm}{Results:\n\n${tabular}\n\n}}`,
      `We call \\lstinline[language=C]{x} here. \\fbox{\\parbox{6cm}{Results:\n\n${tabular}\n\n}}`,
      `An unclosed \\verb|oops\n\n${tabular}\n\n`,
      `\\begin{table}[h]\n\\centering\n${tabular}\n% source\n\\\\[1ex] {\\small Source: x}\n\\end{table}`,
      `\\begin{table}\n${tabular}%\n%\n\\\\[1ex] Source: x\n\\end{table}`,
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
      expect(refused).toBe(true);
      expect(result.changes).toEqual([]);
    }
    // In a file that another includes, the surroundings cannot be seen, so nothing is done.
    expect(where(tabular).place.kind).toBe("no");
    expect(where(`\\newcommand{\\bt}{\\begin{table}}\n${DOC0}\\bt\n${tabular}\n\\end{table}`).place.kind).toBe("no");
    // Commands that open or close something out of sight, however they are written.
    for (const preamble of [
      "\\newcommand{\\bmp}[1]{\\begin{minipage}{#1}}\n\\newcommand{\\emp}{\\end{minipage}}",
      "\\newcommand{\\bt}{%\n  \\begin{table}[h]\\centering}",
      "\\def\\bt{\\bgroup}",
      "\\DeclareDocumentCommand{\\bmp}{}{\\begin{minipage}{5cm}}",
      "\\newrobustcmd{\\bmp}{\\begin{minipage}{5cm}}",
      "\\AtBeginDocument{\\begin{minipage}{5cm}}\\AtEndDocument{\\end{minipage}}",
      "\\newenvironment{note}{\\begin{quote}}{\\end{quote}}",
      "\\let\\b\\begin \\let\\e\\end",
      "\\usepackage{shortvrb}\\MakeShortVerb{\\|}",
      "\\usepackage{listings}\\lstMakeShortInline|",
      "\\def\\b{\\csname begin\\endcsname}",
    ]) {
      expect(where(`\\documentclass{article}\n${preamble}\n\\begin{document}\n\n${tabular}\n\n\\end{document}`).place.kind).toBe("no");
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
    expect(soundCaption("$50^2$ metres, $x_i$, $$a_b$$, \\(c^d\\)")).toBe(true);
    expect(soundCaption("\\si{m^2}, \\ref{tab:a_b}, \\url{http://x.org/a_b#frag}")).toBe(true);
    expect(soundCaption("open \\( never closed")).toBe(false);
    expect(soundCaption("$a$$")).toBe(false);
    expect(soundCaption("$$a$")).toBe(false);
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

  it("refuses verbatim text, whose & and \\\\ are not what they look like", () => {
    expect(reason(wrap("ll", "\\verb|a&b| \\\\"))).toMatch(/verb/);
    expect(reason(wrap("l", "\\verb|a\\\\b| \\\\"))).toMatch(/verb/);
    expect(reason(wrap("ll", "\\lstinline|x| & b \\\\"))).toMatch(/lstinline/);
  });

  it("refuses a rule with a thickness, and text that would be taken for one", () => {
    expect(reason(wrap("ll", "a & b \\\\\n\\midrule[2pt]\nc & d \\\\"))).toMatch(/thickness/);
    expect(reason(wrap("ll", "\\toprule\n[1] & b \\\\"))).toMatch(/thickness/);
    // ... so typing "[1]" into the first cell after such a rule is held back, not written.
    const t = read(wrap("ll", "\\toprule\na & b \\\\\nc & d \\\\"));
    expect(parseTable(writeTable(setCell(t, 0, 0, "[1]"))).ok).toBe(false);
    expect(parseTable(writeTable(setCell(t, 1, 0, "[1]"))).ok).toBe(false);
    expect(parseTable(writeTable(setCell(t, 0, 1, "[1]"))).ok).toBe(true);
  });

  it("refuses rules of kinds it does not know, but not a rule drawn inside a cell", () => {
    expect(reason(wrap("ll", "\\firsthline a & b \\\\"))).toMatch(/firsthline/);
    expect(reason(wrap("ll", "a & b \\\\ \\Xhline{1pt} c & d \\\\"))).toMatch(/Xhline/);
    expect(reason(wrap("ll", "a & b \\\\ \\hlineB{2} c & d \\\\"))).toMatch(/hlineB/);
    expect(reason(wrap("ll", "a & \\rule{1cm}{1pt} \\\\"))).toBe("editable");
  });

  it("refuses empty cells under a merged cell that are described differently from it", () => {
    expect(reason(wrap("ll", "\\multirow{2}{*}{a} & b \\\\\n\\multicolumn{1}{l|}{} & d \\\\"))).toMatch(/described differently/);
    expect(reason(wrap("lll", "\\multicolumn{2}{c|}{\\multirow{2}{*}{a}} & b \\\\\n\\multicolumn{2}{c}{} & d \\\\"))).toMatch(/described differently/);
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
  it("read as one line, with a space where the line ended", () => {
    const t = read("\\begin{tabular}{ll}\nName & A long description that\n   continues here \\\\\n\\multicolumn{2}{c}{two\nlines} \\\\\n\\end{tabular}");
    expect(t.rows[0][1].tex).toBe("A long description that continues here");
    expect(t.rows[1][0].tex).toBe("two lines");
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
    expect(writeTable(merged).split("\n")).toEqual(["\\begin{tabular}{ll}", "\\toprule", "\\multirow{2}{*}{a c} & b \\\\", "\\cline{2-2}", "& d \\\\", "\\bottomrule", "\\end{tabular}"]);
    expect(read(writeTable(merged))).toEqual(merged);
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
