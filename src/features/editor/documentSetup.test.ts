import { describe, expect, it } from "vitest";
import { type Setup, fieldLatex, fieldText, readSetup, setupChange } from "./documentSetup";

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
    expect(readSetup(DOC)).toEqual({ paper: "", size: "11pt", margins: "", spacing: "single", font: "default", pageNumbers: true, paragraphs: "indent", landscape: false, columns: 1, lineNumbers: false, header: "", footer: "" });
    const thesis = doc("\\documentclass[12pt, a4paper]{report}\n\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{setspace}\n\\onehalfspacing\n\\usepackage{newpxtext,newpxmath}\n\\usepackage{parskip}\n\\pagestyle{empty}");
    expect(readSetup(thesis)).toEqual({ paper: "a4paper", size: "12pt", margins: "2.5cm", spacing: "onehalf", font: "palatino", pageNumbers: false, paragraphs: "space", landscape: false, columns: 1, lineNumbers: false, header: "", footer: "" });
    expect(readSetup(doc("\\documentclass{article}\n\\usepackage{geometry}\n\\geometry{margin=1in}"))?.margins).toBe("1in");
    expect(readSetup(doc("\\documentclass{article}\n\\usepackage{fontspec}\n\\usepackage{amsmath,helvet}"))?.font).toBe("other");
    expect(readSetup("\\section{An included file}")).toBeNull();
  });
});

describe("setting a document's page", () => {
  it("writes only what was changed, in place, and leaves the rest as it was", () => {
    const out = apply(DOC, setupChange(DOC, { paper: "a4paper", size: "12pt", margins: "2cm", spacing: "double", font: "times", pageNumbers: false, paragraphs: "space", landscape: false, columns: 1, lineNumbers: false, header: "", footer: "" }));
    expect(out).toBe(
      "\\documentclass[12pt, a4paper]{article}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\usepackage[margin=2cm]{geometry}\n\\usepackage{setspace}\n\\doublespacing\n\\usepackage{newtxtext,newtxmath}\n\\usepackage{parskip}\n\\pagestyle{empty}\n\n\\title{T}\n\\begin{document}\nBody\n\\end{document}\n",
    );
    expect(readSetup(out)).toEqual({ paper: "a4paper", size: "12pt", margins: "2cm", spacing: "double", font: "times", pageNumbers: false, paragraphs: "space", landscape: false, columns: 1, lineNumbers: false, header: "", footer: "" });
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

  it("changes the paper where geometry is given it, since that one counts", () => {
    const text = doc("\\documentclass{article}\n\\usepackage[a4paper,margin=2cm]{geometry}");
    expect(set(text, { paper: "letterpaper" })).toBe(doc("\\documentclass{article}\n\\usepackage[letterpaper,margin=2cm]{geometry}"));
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

describe("the Layout tab's settings: orientation, columns, line numbers, header and footer", () => {
  const LAID = doc(
    "\\documentclass[twocolumn]{article}\n\\usepackage[landscape,margin=2cm]{geometry}\n\\usepackage{lineno}\n\\linenumbers\n\\usepackage{fancyhdr}\n\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyhead[R]{Draft}\n\\fancyfoot[C]{\\thepage}",
  );

  it("reads them, and a document without them reads as LaTeX sets it", () => {
    expect(readSetup(LAID)).toMatchObject({ columns: 2, landscape: true, lineNumbers: true, header: "Draft", footer: "", pageNumbers: true, margins: "2cm" });
    expect(readSetup(DOC)).toMatchObject({ columns: 1, landscape: false, lineNumbers: false, header: "", footer: "", pageNumbers: true });
    expect(readSetup(doc("\\documentclass[landscape]{article}"))?.landscape).toBe(true);
    // Line numbers need both the package and \linenumbers.
    expect(readSetup(doc("\\documentclass{article}\n\\usepackage{lineno}"))?.lineNumbers).toBe(false);
    // fancyhdr's own page style numbers the pages until its fields are cleared.
    expect(readSetup(doc("\\documentclass{article}\n\\usepackage{fancyhdr}\n\\pagestyle{fancy}"))?.pageNumbers).toBe(true);
    expect(readSetup(doc("\\documentclass{article}\n\\usepackage{fancyhdr}\n\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyfoot[C]{Ours}"))).toMatchObject({ pageNumbers: false, footer: "Ours" });
    // That changes nothing.
    expect(setupChange(LAID, readSetup(LAID)!)).toBeNull();
  });

  it("turns the page on its side in geometry's options, and back", () => {
    const wide = set(DOC, { landscape: true });
    expect(wide).toBe(DOC.replace("\\usepackage{graphicx}\n", "\\usepackage{graphicx}\n\\usepackage[landscape]{geometry}\n"));
    expect(set(wide, { landscape: false })).toBe(DOC.replace("\\usepackage{graphicx}\n", "\\usepackage{graphicx}\n\\usepackage{geometry}\n"));
    expect(set(DOC, { landscape: true, margins: "2cm" })).toBe(DOC.replace("\\usepackage{graphicx}\n", "\\usepackage{graphicx}\n\\usepackage[margin=2cm, landscape]{geometry}\n"));
    // Given to \geometry, or to the class, it is changed there.
    expect(set(doc("\\documentclass{article}\n\\usepackage{geometry}\n\\geometry{margin=1in}"), { landscape: true })).toBe(doc("\\documentclass{article}\n\\usepackage{geometry}\n\\geometry{margin=1in, landscape}"));
    expect(set(doc("\\documentclass[landscape,11pt]{article}\n\\usepackage{geometry}"), { landscape: false })).toBe(doc("\\documentclass[11pt]{article}\n\\usepackage{geometry}"));
  });

  it("sets two columns as an option of the class, and one by taking it out", () => {
    const two = set(DOC, { columns: 2 });
    expect(two).toBe(DOC.replace("[11pt]", "[11pt, twocolumn]"));
    expect(set(two, { columns: 1 })).toBe(DOC);
    expect(set(doc("\\documentclass[onecolumn]{article}"), { columns: 2 })).toBe(doc("\\documentclass[twocolumn]{article}"));
  });

  it("numbers the lines with lineno, and takes both lines out again", () => {
    const numbered = set(DOC, { lineNumbers: true });
    expect(numbered).toBe(DOC.replace("\\usepackage{graphicx}\n", "\\usepackage{graphicx}\n\\usepackage{lineno}\n\\linenumbers\n"));
    expect(set(numbered, { lineNumbers: false })).toBe(DOC);
    // Loaded already: only \linenumbers is added.
    expect(set(doc("\\documentclass{article}\n\\usepackage[switch]{lineno}\n\\usepackage{amsmath}"), { lineNumbers: true })).toBe(doc("\\documentclass{article}\n\\usepackage[switch]{lineno}\n\\linenumbers\n\\usepackage{amsmath}"));
  });

  it("writes a header with fancyhdr, keeping the page numbers at the foot, and takes it all away when cleared", () => {
    const headed = set(DOC, { header: "Draft" });
    expect(headed).toBe(DOC.replace("\\usepackage{graphicx}\n", "\\usepackage{graphicx}\n\\usepackage{fancyhdr}\n\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyhead[R]{Draft}\n\\fancyfoot[C]{\\thepage}\n"));
    expect(readSetup(headed)).toMatchObject({ header: "Draft", footer: "", pageNumbers: true });
    expect(set(headed, { header: "Second draft" })).toBe(headed.replace("{Draft}", "{Second draft}"));
    expect(set(headed, { header: "" })).toBe(DOC);
  });

  it("puts a footer's text in the middle, and the page number then on the right", () => {
    const footed = set(DOC, { footer: "Confidential" });
    expect(footed).toContain("\\fancyhf{}\n\\fancyfoot[C]{Confidential}\n\\fancyfoot[R]{\\thepage}\n");
    expect(readSetup(footed)).toMatchObject({ header: "", footer: "Confidential", pageNumbers: true });
    expect(set(footed, { pageNumbers: false })).not.toContain("\\thepage");
    expect(set(footed, { footer: "" })).toBe(DOC);
  });

  it("keeps page numbers off when a header is added, and turns them on and off while there is one", () => {
    const empty = doc("\\documentclass{article}\n\\pagestyle{empty}");
    const headed = set(empty, { header: "Notes" });
    expect(headed).not.toContain("\\pagestyle{empty}");
    expect(headed).not.toContain("\\thepage");
    expect(readSetup(headed)).toMatchObject({ header: "Notes", pageNumbers: false });
    const numbered = set(headed, { pageNumbers: true });
    expect(numbered).toContain("\\fancyfoot[C]{\\thepage}");
    expect(readSetup(set(numbered, { pageNumbers: false }))).toMatchObject({ header: "Notes", pageNumbers: false });
    // Cleared again, the document has no page numbers, as before.
    expect(readSetup(set(headed, { header: "" }))).toMatchObject({ header: "", pageNumbers: false });
    expect(set(headed, { header: "" })).not.toContain("fancy");
  });

  it("keeps fields of the document's own, and says so rather than guess at a page number written with other text", () => {
    const own = doc("\\documentclass{article}\n\\usepackage{fancyhdr}\n\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyhead[L]{\\leftmark}\n\\fancyhead[R]{Old}\n\\fancyfoot[C]{Page \\thepage}");
    expect(set(own, { header: "" })).toBe(own.replace("\\fancyhead[R]{Old}\n", ""));
    expect(setupChange(own, { ...readSetup(own)!, pageNumbers: false })).toEqual({ error: expect.stringMatching(/page number/) });
  });
});

describe("what the review found: the document's own header and footer, line numbers and options are kept", () => {
  const fancy = (lines: string) => doc(`\\documentclass{article}\n\\usepackage{fancyhdr}\n${lines}`);

  it("never writes the page number over a field of the document's own: says so instead", () => {
    const own = fancy("\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyfoot[C]{\\thepage}\n\\fancyfoot[R]{Draft}");
    expect(setupChange(own, { ...readSetup(own)!, footer: "F" })).toEqual({ error: expect.stringMatching(/page number/) });
  });

  it("says so rather than clear fields of the document's own when fancyhdr is loaded but not switched on in the settings", () => {
    const own = fancy("\\fancyhead[L]{Mine}");
    expect(setupChange(own, { ...readSetup(own)!, header: "New" })).toEqual({ error: expect.stringMatching(/own/) });
  });

  it("leaves what \\fancypagestyle defines out of the header and footer it reads and writes", () => {
    const styled = fancy("\\fancypagestyle{plain}{\\fancyhf{}\\fancyhead[R]{Plain}}\n\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyhead[R]{Main}\n\\fancyfoot[C]{\\thepage}");
    expect(readSetup(styled)).toMatchObject({ header: "Main", pageNumbers: true });
    expect(set(styled, { header: "New" })).toBe(styled.replace("{Main}", "{New}"));
    const plainCleared = fancy("\\fancypagestyle{plain}{\\fancyhf{}}\n\\pagestyle{fancy}");
    expect(readSetup(plainCleared)?.pageNumbers).toBe(true);
  });

  it("says so rather than take away page numbers set out in the document's own way", () => {
    const own = fancy("\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyfoot[LE,RO]{\\thepage}");
    expect(setupChange(own, { ...readSetup(own)!, pageNumbers: false })).toEqual({ error: expect.stringMatching(/page number/) });
  });

  it("reads the old commands for fields, \\cfoot and the like, and changes them where they are", () => {
    const old = fancy("\\pagestyle{fancy}\n\\fancyhf{}\n\\cfoot{Draft}");
    expect(readSetup(old)).toMatchObject({ footer: "Draft", pageNumbers: false });
    expect(set(old, { footer: "Final" })).toBe(old.replace("\\cfoot{Draft}", "\\cfoot{Final}"));
  });

  it("keeps lineno while the text still uses it, and reads \\linenumbers in the text as line numbers on", () => {
    const body = (preamble: string, text: string) => `${preamble}\n\\begin{document}\n${text}\n\\end{document}\n`;
    const used = body("\\documentclass{article}\n\\usepackage{lineno}\n\\linenumbers", "\\nolinenumbers\nText.");
    expect(set(used, { lineNumbers: false })).toBe(used.replace("\\linenumbers\n", ""));
    const inText = body("\\documentclass{article}\n\\usepackage{lineno}", "\\linenumbers\nText.");
    expect(readSetup(inText)?.lineNumbers).toBe(true);
    expect(setupChange(inText, { ...readSetup(inText)!, lineNumbers: false })).toEqual({ error: expect.stringMatching(/text/) });
  });

  it("takes a whole line out in a file with CRLF line ends, and a comment at its end with it", () => {
    const crlf = "\\documentclass{article}\r\n\\usepackage{lineno} % for review\r\n\\linenumbers\r\n\\begin{document}\r\nBody\r\n\\end{document}\r\n";
    expect(set(crlf, { lineNumbers: false })).toBe("\\documentclass{article}\r\n\\begin{document}\r\nBody\r\n\\end{document}\r\n");
  });

  it("turns the page back from geometry's options shared with another package, and says so when a setting cannot be changed", () => {
    const shared = doc("\\documentclass{article}\n\\usepackage[landscape]{geometry,xcolor}");
    expect(set(shared, { landscape: false })).toBe(doc("\\documentclass{article}\n\\usepackage{geometry,xcolor}"));
    const elsewhere = doc("\\documentclass{article}\n\\usepackage{geometry}\n\\newgeometry{landscape}");
    expect(readSetup(elsewhere)?.landscape).toBe(false);
    const turned = doc("\\documentclass{article}\n\\usepackage{geometry}\n\\geometry{landscape}");
    expect(set(turned, { landscape: false })).toBe(doc("\\documentclass{article}\n\\usepackage{geometry}\n\\geometry{}"));
  });
});

describe("what the second review found", () => {
  it("changes the paper where both the class and geometry name one, reading geometry's as the one that counts", () => {
    const both = doc("\\documentclass[a4paper]{article}\n\\usepackage[a4paper,margin=2.5cm]{geometry}");
    expect(set(both, { paper: "letterpaper" })).toBe(doc("\\documentclass[a4paper]{article}\n\\usepackage[letterpaper,margin=2.5cm]{geometry}"));
    expect(readSetup(doc("\\documentclass[a4paper]{article}\n\\usepackage[letterpaper]{geometry}"))?.paper).toBe("letterpaper");
  });

  it("leaves out fields of a \\fancypagestyle written with fancyhdr 4's brackets", () => {
    const styled = doc("\\documentclass{article}\n\\usepackage{fancyhdr}\n\\fancypagestyle{plain}[fancy]{\\fancyhead[R]{Plain}}\n\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyhead[R]{Main}");
    expect(readSetup(styled)?.header).toBe("Main");
    expect(set(styled, { header: "New" })).toBe(styled.replace("{Main}", "{New}"));
  });
});

describe("a header or footer's text, as typed and as LaTeX", () => {
  it("escapes what LaTeX would read as a command, and reads it back; text with commands in it is not taken for plain", () => {
    expect(fieldLatex("R&D 50% #1")).toBe("R\\&D 50\\% \\#1");
    expect(fieldText("R\\&D 50\\% \\#1")).toBe("R&D 50% #1");
    expect(fieldText("Draft")).toBe("Draft");
    expect(fieldText("\\leftmark")).toBeNull();
  });
});
