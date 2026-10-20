import { describe, expect, it } from "vitest";
import { floatAt, setPictureWidth, setPlacement } from "./floats";
import type { TextChange } from "./formatting";

const apply = (text: string, changes: TextChange[] | null) => {
  if (!changes) throw new Error("no change");
  return [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text);
};
const FIG = "\\begin{document}\nText.\n\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/a.png}\n  \\caption{A picture.}\n\\end{figure}\nMore.\n\\end{document}\n";
const inFig = FIG.indexOf("caption");

describe("the picture or table the cursor is in", () => {
  it("reads a figure's placement and its picture's width as a share of the line", () => {
    expect(floatAt(FIG, inFig)).toMatchObject({ kind: "figure", placement: "h", width: 0.8, pictures: 1 });
    expect(floatAt(FIG, FIG.indexOf("\\begin{figure}"))?.kind).toBe("figure");
    expect(floatAt(FIG, FIG.indexOf("More"))).toBeNull();
    const plain = "\\begin{figure}\n\\includegraphics{a}\n\\end{figure}";
    expect(floatAt(plain, 20)).toMatchObject({ placement: "", width: null });
    expect(floatAt("\\begin{figure*}[t]\n\\includegraphics[width=\\textwidth]{a}\n\\end{figure*}", 20)).toMatchObject({ kind: "figure", placement: "t", width: 1 });
    expect(floatAt("\\begin{table}[p]\n\\begin{tabular}{l}x\\end{tabular}\n\\end{table}", 20)).toMatchObject({ kind: "table", placement: "p", pictures: 0 });
  });
});

describe("setting where LaTeX places it", () => {
  it("writes the placement in the brackets after \\begin, adding them when there are none", () => {
    expect(apply(FIG, setPlacement(FIG, inFig, "htbp")?.changes ?? null)).toBe(FIG.replace("\\begin{figure}[h]", "\\begin{figure}[htbp]"));
    const plain = "\\begin{figure}\n\\includegraphics{a}\n\\end{figure}";
    expect(apply(plain, setPlacement(plain, 20, "t")?.changes ?? null)).toBe(plain.replace("\\begin{figure}", "\\begin{figure}[t]"));
  });

  it("asks for the float package for exactly here", () => {
    const set = setPlacement(FIG, inFig, "H");
    expect(set?.needs).toEqual(["float"]);
    expect(apply(FIG, set?.changes ?? null)).toContain("\\begin{figure}[H]");
    expect(setPlacement(FIG, inFig, "p")?.needs).toEqual([]);
    expect(setPlacement(FIG, FIG.indexOf("More"), "p")).toBeNull();
  });
});

describe("what the review found", () => {
  it("reads and changes a placement written after a space, never leaving the old one as text", () => {
    const spaced = "\\begin{figure} [h]\n\\includegraphics{a}\n\\end{figure}";
    expect(floatAt(spaced, 25)?.placement).toBe("h");
    expect(apply(spaced, setPlacement(spaced, 25, "t")?.changes ?? null)).toBe(spaced.replace("\\begin{figure} [h]", "\\begin{figure}[t]"));
  });

  it("does not count a picture in a comment", () => {
    const commented = "\\begin{figure}\n\\includegraphics{a}\n% \\includegraphics{b}\n\\end{figure}";
    expect(floatAt(commented, 20)?.pictures).toBe(1);
    expect(apply(commented, setPictureWidth(commented, 20, 0.5))).toBe(commented.replace("\\includegraphics{a}", "\\includegraphics[width=0.5\\linewidth]{a}"));
  });
});

describe("setting a picture's width", () => {
  it("writes the width as a share of the line, in place of its other sizes", () => {
    expect(apply(FIG, setPictureWidth(FIG, inFig, 0.5))).toBe(FIG.replace("width=0.8\\linewidth", "width=0.5\\linewidth"));
    expect(apply(FIG, setPictureWidth(FIG, inFig, 1))).toBe(FIG.replace("width=0.8\\linewidth", "width=\\linewidth"));
    const plain = "\\begin{figure}\n\\includegraphics{a}\n\\end{figure}";
    expect(apply(plain, setPictureWidth(plain, 20, 0.5))).toBe(plain.replace("\\includegraphics{a}", "\\includegraphics[width=0.5\\linewidth]{a}"));
    const scaled = "\\begin{figure}\n\\includegraphics[scale=0.3, angle=90]{a}\n\\end{figure}";
    expect(apply(scaled, setPictureWidth(scaled, 20, 0.8))).toBe(scaled.replace("scale=0.3, angle=90", "angle=90, width=0.8\\linewidth"));
  });

  it("leaves a figure of several pictures, or a table, to its LaTeX", () => {
    const two = "\\begin{figure}\n\\includegraphics{a}\n\\includegraphics{b}\n\\end{figure}";
    expect(setPictureWidth(two, 20, 0.5)).toBeNull();
    expect(setPictureWidth("\\begin{table}\nx\n\\end{table}", 15, 0.5)).toBeNull();
  });
});
