import { describe, expect, it } from "vitest";
import { citeCommand, readStyle, styleChanges } from "./citationStyle";

const apply = (text: string, changes: ReturnType<typeof styleChanges>) => {
  if ("error" in changes) throw new Error(changes.error);
  return [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to ?? c.from), text);
};
const DOC = "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nSee \\cite{k}.\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}\n";

describe("citation styles", () => {
  it("reads the style a document names", () => {
    expect(readStyle(DOC)).toBe("plain");
    expect(readStyle(DOC.replace("{plain}", "{plainnat}"))).toBe("authoryear");
    expect(readStyle(DOC.replace("{plain}", "{amsplain}"))).toBe("other");
    expect(readStyle("% \\bibliographystyle{plain}\n")).toBe("");
  });

  it("changes the style, and loads natbib for one that cites by author and year", () => {
    expect(apply(DOC, styleChanges(DOC, "ieee"))).toBe(DOC.replace("{plain}", "{ieeetr}"));
    const harvard = apply(DOC, styleChanges(DOC, "authoryear"));
    expect(harvard).toBe(DOC.replace("{plain}", "{plainnat}").replace("\\begin{document}", "\\usepackage{natbib}\n\\begin{document}"));
    // natbib once only.
    expect(apply(harvard, styleChanges(harvard, "apa"))).toBe(harvard.replace("{plainnat}", "{apalike}"));
  });

  it("names a style where there is none yet, and says why it cannot otherwise", () => {
    const none = DOC.replace("\\bibliographystyle{plain}\n", "");
    expect(apply(none, styleChanges(none, "numbered"))).toBe(DOC.replace("{plain}", "{unsrt}"));
    expect(styleChanges("\\documentclass{article}\n\\begin{document}\n\\end{document}", "plain")).toEqual({ error: expect.stringMatching(/Bibliography first/) });
    expect(styleChanges(DOC.replace("\\usepackage{amsmath}", "\\usepackage[style=apa]{biblatex}"), "plain")).toEqual({ error: expect.stringMatching(/biblatex/) });
  });
});

describe("the command a citation is written with", () => {
  it("cites in brackets or parentheses, whichever package the document loads", () => {
    expect(citeCommand(DOC)).toBe("cite");
    expect(citeCommand(DOC.replace("\\usepackage{amsmath}", "\\usepackage[round]{natbib}"))).toBe("citep");
    expect(citeCommand(DOC.replace("\\usepackage{amsmath}", "\\usepackage[style=apa]{biblatex}"))).toBe("autocite");
    expect(citeCommand(DOC.replace("\\usepackage{amsmath}", "% \\usepackage{natbib}"))).toBe("cite");
  });
});
