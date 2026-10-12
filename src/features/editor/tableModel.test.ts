import { describe, expect, it } from "vitest";
import {
  type Table,
  captionOf,
  copiedFromPlain,
  deleteColumn,
  deleteRow,
  ensureMultirow,
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
    expect(t.hrules[1]).toEqual({ kind: "cline", cols: [false, true, false] });
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
    expect(t.hrules).toEqual([{ kind: "hline" }, { kind: "cline", cols: [true, false, true] }, { kind: "cline", cols: [true, false, true] }, { kind: "hline" }]);
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
    expect(through.hrules[1]).toEqual({ kind: "cline", cols: [false, true] });
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

  it("adds the multirow package after the last package, once", () => {
    const change = ensureMultirow(DOC);
    if (typeof change === "string") throw new Error(change);
    const added = apply(DOC, [change]);
    expect(added).toBe("\\documentclass{article}\n\\usepackage{graphicx} % pictures\n\\usepackage{multirow}\n\\begin{document}\nx\n\\end{document}\n");
    expect(ensureMultirow(added)).toBe("present");
    expect(ensureMultirow(DOC.replace("graphicx", "booktabs, multirow"))).toBe("present");
    expect(ensureMultirow(DOC.replace("\\usepackage{graphicx} % pictures", "% \\usepackage{multirow}"))).not.toBe("present");
    expect(ensureMultirow("\\section{An included file}\ntext\n")).toBe("no-preamble");
  });

  it("gives a lone table a float to carry its caption, and changes or removes a caption later", () => {
    const tabular = "\\begin{tabular}{l}\na \\\\\n\\end{tabular}";
    const text = `Before.\n\n${tabular}\n\nAfter.`;
    const from = text.indexOf(tabular);
    expect(captionOf(text, from, from + tabular.length)).toBeNull();
    const withCaption = apply(text, setCaption(text, from, from + tabular.length, "Results"));
    expect(withCaption).toBe(`Before.\n\n\\begin{table}[h]\n\\centering\n${tabular}\n\\caption{Results}\n\\end{table}\n\nAfter.`);

    const at = withCaption.indexOf(tabular);
    expect(captionOf(withCaption, at, at + tabular.length)).toBe("Results");
    const changed = apply(withCaption, setCaption(withCaption, at, at + tabular.length, "New {results}"));
    expect(captionOf(changed, at, at + tabular.length)).toBe("New {results}");
    const removed = apply(changed, setCaption(changed, at, at + tabular.length, ""));
    expect(removed).toBe(`Before.\n\n\\begin{table}[h]\n\\centering\n${tabular}\n\\end{table}\n\nAfter.`);
    expect(setCaption(text, from, from + tabular.length, "")).toEqual([]);
  });

  it("finds the smallest change between two versions of a table", () => {
    const before = "\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}";
    const after = "\\begin{tabular}{ll}\na & bc \\\\\n\\end{tabular}";
    expect(smallestChange(before, after, 100)).toEqual({ from: 100 + before.indexOf("b ") + 1, to: 100 + before.indexOf("b ") + 1, insert: "c" });
    expect(smallestChange(before, before)).toBeNull();
    expect(smallestChange("aaa", "aa", 0)).toEqual({ from: 2, to: 3, insert: "" });
  });
});

describe("text typed into a cell", () => {
  it("has a bare ampersand or percent sign written as the character, and leaves escaped ones alone", () => {
    expect(escapeTyped("R&D 5%")).toBe("R\\&D 5\\%");
    expect(escapeTyped("R\\&D 5\\%")).toBe("R\\&D 5\\%");
    expect(escapeTyped("$x$ \\textbf{b}")).toBe("$x$ \\textbf{b}");
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
