import { describe, expect, it } from "vitest";
import { figureFor, pictureFolder } from "./pictures";

describe("where a picture goes", () => {
  it("goes in the folder \\graphicspath names, or in figures beside the main file", () => {
    expect(pictureFolder("\\graphicspath{{images/}{other/}}", "")).toEqual({ dir: "images", byName: true });
    expect(pictureFolder("\\graphicspath{{../pics/}}", "thesis/")).toEqual({ dir: "pics", byName: true });
    expect(pictureFolder("% \\graphicspath{{images/}}\n", "thesis/")).toEqual({ dir: "thesis/figures", byName: false });
    // Outside the project: never written there.
    expect(pictureFolder("\\graphicspath{{../../shared/}}", "thesis/")).toEqual({ dir: "thesis/figures", byName: false });
  });
});

describe("the figure for a picture", () => {
  it("names the picture as LaTeX finds it, with a caption to type and a label of its own", () => {
    const { text, caret } = figureFor("thesis/figures/My-plot.png", "thesis/", false, ["fig:my-plot"]);
    expect(text).toBe(
      "\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/My-plot.png}\n  \\caption{}\n  \\label{fig:my-plot-2}\n\\end{figure}\n",
    );
    expect(text.slice(caret, caret + 1)).toBe("}");
    expect(figureFor("images/a.jpg", "", true, []).text).toContain("{a.jpg}");
  });
});
