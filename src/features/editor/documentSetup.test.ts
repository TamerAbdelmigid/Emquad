import { describe, expect, it } from "vitest";
import { type Setup, readSetup, setupChange } from "./documentSetup";

type Result = ReturnType<typeof setupChange>;
const apply = (text: string, change: Result) => {
  if (change && "error" in change) throw new Error(change.error);
  return change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text;
};
/** `text` set as it is now, but for the settings in `part`. */
const set = (text: string, part: Partial<Setup>) => apply(text, setupChange(text, { ...readSetup(text)!, ...part }));
const DOC = "\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\n\\title{T}\n\\begin{document}\nBody\n\\end{document}\n";
const doc = (preamble: string) => `${preamble}\n\\begin{document}\nBody\n\\end{document}\n`;

describe("reading how a document is set", () => {
  it("reads each setting, wherever it is written", () => {
    expect(readSetup(DOC)).toEqual({ paper: "", size: "11pt", margins: "", spacing: "single", font: "default", pageNumbers: true, paragraphs: "indent" });
    const thesis = doc("\\documentclass[12pt, a4paper]{report}\n\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{setspace}\n\\onehalfspacing\n\\usepackage{newpxtext,newpxmath}\n\\usepackage{parskip}\n\\pagestyle{empty}");
    expect(readSetup(thesis)).toEqual({ paper: "a4paper", size: "12pt", margins: "2.5cm", spacing: "onehalf", font: "palatino", pageNumbers: false, paragraphs: "space" });
    expect(readSetup(doc("\\documentclass{article}\n\\usepackage{geometry}\n\\geometry{margin=1in}"))?.margins).toBe("1in");
    expect(readSetup(doc("\\documentclass{article}\n\\usepackage{fontspec}\n\\usepackage{amsmath,helvet}"))?.font).toBe("other");
    expect(readSetup("\\section{An included file}")).toBeNull();
  });
});

describe("setting a document's page", () => {
  it("writes only what was changed, in place, and leaves the rest as it was", () => {
    const out = apply(DOC, setupChange(DOC, { paper: "a4paper", size: "12pt", margins: "2cm", spacing: "double", font: "times", pageNumbers: false, paragraphs: "space" }));
    expect(out).toBe(
      "\\documentclass[12pt, a4paper]{article}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\usepackage[margin=2cm]{geometry}\n\\usepackage{setspace}\n\\usepackage{newtxtext,newtxmath}\n\\usepackage{parskip}\n\\pagestyle{empty}\n\\doublespacing\n\n\\title{T}\n\\begin{document}\nBody\n\\end{document}\n",
    );
    expect(readSetup(out)).toEqual({ paper: "a4paper", size: "12pt", margins: "2cm", spacing: "double", font: "times", pageNumbers: false, paragraphs: "space" });
    // And back again to how it was.
    expect(apply(out, setupChange(out, readSetup(DOC)!))).toBe(DOC.replace("\\usepackage{graphicx}\n", "\\usepackage{graphicx}\n\\usepackage{geometry}\n\\usepackage{setspace}\n"));
  });

  it("changes nothing when nothing was changed, however the settings are written", () => {
    for (const preamble of [
      "\\documentclass[a4paper,12pt]{article}",
      "\\documentclass{article}\n\\usepackage[margin=1in,showframe]{geometry}",
      "\\documentclass{article}\n\\usepackage[onehalfspacing]{setspace}",
      "\\documentclass{article}\n\\usepackage[osf]{newtxtext}",
      "\\documentclass{article}\n\\usepackage[scaled]{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}",
      "\\documentclass{article}\n\\usepackage[skip=6pt]{parskip}",
      "\\documentclass[\n  12pt\n]{article}",
    ]) {
      const text = doc(preamble);
      expect(setupChange(text, readSetup(text)!), preamble).toBeNull();
    }
  });

  it("never takes away a package the document still uses", () => {
    const stretch = doc("\\documentclass{article}\n\\usepackage{setspace}\n\\setstretch{1.2}");
    expect(set(stretch, { spacing: "double" })).toBe(doc("\\documentclass{article}\n\\usepackage{setspace}\n\\doublespacing\n\\setstretch{1.2}"));
    const newgeometry = doc("\\documentclass{article}\n\\usepackage[a4paper]{geometry}\n\\newgeometry{margin=1cm}");
    expect(set(newgeometry, { margins: "2cm" })).toBe(doc("\\documentclass{article}\n\\usepackage[a4paper, margin=2cm]{geometry}\n\\newgeometry{margin=1cm}"));
    expect(set(doc("\\documentclass{article}\n\\usepackage[margin=2cm]{geometry}"), { margins: "" })).toBe(doc("\\documentclass{article}\n\\usepackage{geometry}"));
  });

  it("puts new lines after a package loaded over several lines, never inside it", () => {
    const text = doc("\\documentclass{article}\n\\usepackage[\n  colorlinks\n]{hyperref}");
    expect(set(text, { margins: "2.5cm" })).toBe(doc("\\documentclass{article}\n\\usepackage[\n  colorlinks\n]{hyperref}\n\\usepackage[margin=2.5cm]{geometry}"));
  });

  it("changes a margin written with a comment after it, or given to \\geometry", () => {
    expect(set(doc("\\documentclass{article}\n\\usepackage[margin=2cm]{geometry} % page"), { margins: "3cm" })).toBe(doc("\\documentclass{article}\n\\usepackage[margin=3cm]{geometry} % page"));
    expect(set(doc("\\documentclass{article}\n\\usepackage{geometry}\n\\geometry{margin=1in}"), { margins: "2.5cm" })).toBe(doc("\\documentclass{article}\n\\usepackage{geometry}\n\\geometry{margin=2.5cm}"));
    expect(set(doc("\\documentclass{article}\n\\usepackage{geometry}"), { margins: "2cm" })).toBe(doc("\\documentclass{article}\n\\usepackage[margin=2cm]{geometry}"));
  });

  it("says so rather than guess at a class written over several lines, and keeps the file's line ends", () => {
    const split = doc("\\documentclass[\n  12pt\n]{article}");
    expect(setupChange(split, { ...readSetup(split)!, size: "11pt" })).toEqual({ error: expect.stringMatching(/several lines/) });
    const crlf = "\\documentclass[twocolumn,10pt]{article}\r\n% \\usepackage{parskip}\r\n\\begin{document}\r\n\\end{document}";
    expect(set(crlf, { size: "11pt", paragraphs: "space" })).toBe("\\documentclass[twocolumn,11pt]{article}\r\n\\usepackage{parskip}\r\n% \\usepackage{parskip}\r\n\\begin{document}\r\n\\end{document}");
  });
});
