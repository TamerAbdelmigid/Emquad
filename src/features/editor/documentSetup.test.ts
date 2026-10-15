import { describe, expect, it } from "vitest";
import { type Setup, readSetup, setupChange } from "./documentSetup";

const apply = (text: string, change: { from: number; to: number; insert: string } | null) => (change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text);
const DOC = "\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\n\\title{T}\n\\begin{document}\nBody\n\\end{document}\n";

describe("document setup", () => {
  it("reads how a document is set", () => {
    expect(readSetup(DOC)).toEqual({ paper: "", size: "11pt", margins: "", spacing: "single", font: "default", pageNumbers: true, paragraphs: "indent" });
    const thesis = "\\documentclass[12pt, a4paper]{report}\n\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{setspace}\n\\onehalfspacing\n\\usepackage{newpxtext,newpxmath}\n\\usepackage{parskip}\n\\pagestyle{empty}\n\\begin{document}\n\\end{document}";
    expect(readSetup(thesis)).toEqual({ paper: "a4paper", size: "12pt", margins: "2.5cm", spacing: "onehalf", font: "palatino", pageNumbers: false, paragraphs: "space" });
    expect(readSetup("\\section{An included file}")).toBeNull();
  });

  it("writes the ordinary LaTeX for each setting, leaving the rest as it was", () => {
    const setup: Setup = { paper: "a4paper", size: "12pt", margins: "2cm", spacing: "double", font: "times", pageNumbers: false, paragraphs: "space" };
    const out = apply(DOC, setupChange(DOC, setup));
    expect(out).toBe(
      "\\documentclass[12pt, a4paper]{article}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\usepackage[margin=2cm]{geometry}\n\\usepackage{setspace}\n\\doublespacing\n\\usepackage{newtxtext,newtxmath}\n\\usepackage{parskip}\n\\pagestyle{empty}\n\n\\title{T}\n\\begin{document}\nBody\n\\end{document}\n",
    );
    expect(readSetup(out)).toEqual(setup);
    // And back again to how it was.
    expect(apply(out, setupChange(out, readSetup(DOC)!))).toBe(DOC);
  });

  it("keeps other options of the class and of geometry, comments and the file's line ends", () => {
    const text = "\\documentclass[twocolumn,10pt]{article}\r\n% \\usepackage{parskip}\r\n\\usepackage[top=3cm,margin=1in]{geometry}\r\n\\begin{document}\r\n\\end{document}";
    const setup = { ...readSetup(text)!, size: "11pt", margins: "2cm" };
    const out = apply(text, setupChange(text, setup));
    expect(out).toBe("\\documentclass[11pt, twocolumn]{article}\r\n% \\usepackage{parskip}\r\n\\usepackage[margin=2cm, top=3cm]{geometry}\r\n\\begin{document}\r\n\\end{document}");
    expect(setupChange(out, readSetup(out)!)).toBeNull();
  });
});
