// The page a document is set on, as a word processor's page setup shows it: the paper, the
// size of the type, the margins, the spacing between lines, the typeface, page numbers and how
// paragraphs are told apart. Read from the settings at the top of the main file and written back
// there as the ordinary LaTeX for each, leaving everything else as it was. Pure.
import { smallestChange } from "./tableModel";

export interface Setup {
  /** "a4paper", "letterpaper", or "" for the class's own. */
  paper: string;
  /** "10pt", "11pt", "12pt", or "" for the class's own. */
  size: string;
  /** A margin on every side, such as "2.5cm", or "" for the class's own. */
  margins: string;
  spacing: "single" | "onehalf" | "double";
  font: "default" | "times" | "palatino" | "sans";
  pageNumbers: boolean;
  /** Paragraphs told apart by an indented first line, or by space between them. */
  paragraphs: "indent" | "space";
}

/** The fonts offered, and the lines that choose each. */
const FONTS: Record<Setup["font"], string[]> = {
  default: [],
  times: ["\\usepackage{newtxtext,newtxmath}"],
  palatino: ["\\usepackage{newpxtext,newpxmath}"],
  sans: ["\\renewcommand{\\familydefault}{\\sfdefault}"],
};
/** Lines that choose a typeface, whichever way they were written. */
const FONT_LINE = /^\s*(?:\\usepackage(?:\[[^\]]*\])?\{\s*(?:newtxtext|newtxmath|newpxtext|newpxmath|mathptmx|times|mathpazo|palatino|helvet)(?:\s*,\s*(?:newtxtext|newtxmath|newpxtext|newpxmath|mathptmx|times|mathpazo|palatino|helvet))*\s*\}|\\renewcommand\s*\{?\\familydefault\}?\s*\{\\sfdefault\})\s*$/;
const CLASS = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/;
const SIZES = new Set(["10pt", "11pt", "12pt"]);
const PAPERS = new Set(["a4paper", "letterpaper", "a5paper", "b5paper", "legalpaper", "executivepaper"]);

/** The lines of the settings at the top, each with where it starts, comments left alone. */
function preambleLines(text: string): { lines: string[]; end: number } | null {
  const begin = text.search(/^[ \t]*\\begin\{document\}/m);
  if (begin < 0 || !CLASS.test(text.slice(0, begin))) return null;
  return { lines: text.slice(0, begin).split("\n"), end: begin };
}

const live = (line: string) => !/^\s*%/.test(line);

/** How the document is set now, or null when the text has no settings of its own to read. */
export function readSetup(text: string): Setup | null {
  const pre = preambleLines(text);
  if (!pre) return null;
  const lines = pre.lines.filter(live);
  const all = lines.join("\n");
  const options = (CLASS.exec(all)?.[1] ?? "").split(",").map((o) => o.trim());
  const geometry = /\\usepackage\s*\[([^\]]*)\]\s*\{geometry\}/.exec(all)?.[1] ?? "";
  const margin = /(?:^|,)\s*margin\s*=\s*([^,\s]+)/.exec(geometry)?.[1] ?? "";
  const spacingCommand = /\\(onehalfspacing|doublespacing|singlespacing)\b/.exec(all)?.[1] ?? /\\usepackage\s*\[\s*(onehalfspacing|doublespacing)\s*\]\s*\{setspace\}/.exec(all)?.[1];
  const font = lines.find((l) => FONT_LINE.test(l)) ?? "";
  return {
    paper: options.find((o) => PAPERS.has(o)) ?? geometry.split(",").map((o) => o.trim()).find((o) => PAPERS.has(o)) ?? "",
    size: options.find((o) => SIZES.has(o)) ?? "",
    margins: margin,
    spacing: spacingCommand === "onehalfspacing" ? "onehalf" : spacingCommand === "doublespacing" ? "double" : "single",
    font: /sfdefault|helvet/.test(font) ? "sans" : /px|pazo|palatino/.test(font) ? "palatino" : /tx|ptmx|times/.test(font) ? "times" : "default",
    pageNumbers: !/\\pagestyle\s*\{\s*empty\s*\}/.test(all),
    paragraphs: /\\usepackage(?:\[[^\]]*\])?\{\s*parskip\s*\}/.test(all) ? "space" : "indent",
  };
}

/**
 * The change that sets the document as `setup` says, in the settings at the top of `text`; null
 * when nothing needs to change, or the text has no settings of its own.
 */
export function setupChange(text: string, setup: Setup): { from: number; to: number; insert: string } | null {
  const pre = preambleLines(text);
  if (!pre) return null;
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = pre.lines.map((l) => l.replace(/\r$/, ""));
  const keep: string[] = [];
  for (const line of lines) {
    if (!live(line)) {
      keep.push(line);
      continue;
    }
    // The class's options: the paper and the size of the type as chosen, the rest as they were.
    const cls = CLASS.exec(line);
    if (cls) {
      const others = (cls[1] ?? "").split(",").map((o) => o.trim()).filter((o) => o && !SIZES.has(o) && !PAPERS.has(o));
      const options = [setup.size, setup.paper, ...others].filter(Boolean);
      keep.push(line.replace(CLASS, `\\documentclass${options.length ? `[${options.join(", ")}]` : ""}{${cls[2]}}`));
      continue;
    }
    // Lines that set what the dialog sets go, and are written again below as chosen.
    if (/^\s*\\usepackage\s*\[[^\]]*\]\s*\{geometry\}\s*$/.test(line)) {
      const others = /\[([^\]]*)\]/.exec(line)![1].split(",").map((o) => o.trim()).filter((o) => o && !/^margin\s*=/.test(o) && !PAPERS.has(o));
      if (others.length) keep.push(`\\usepackage[${others.join(", ")}]{geometry}`);
      continue;
    }
    if (/^\s*\\(?:onehalfspacing|doublespacing|singlespacing)\s*$/.test(line)) continue;
    if (/^\s*\\usepackage\s*(?:\[[^\]]*\])?\s*\{setspace\}\s*$/.test(line)) continue;
    if (FONT_LINE.test(line)) continue;
    if (/^\s*\\pagestyle\s*\{\s*empty\s*\}\s*$/.test(line)) continue;
    if (/^\s*\\usepackage\s*(?:\[[^\]]*\])?\s*\{\s*parskip\s*\}\s*$/.test(line)) continue;
    keep.push(line);
  }
  const added: string[] = [];
  if (setup.margins) {
    const geometry = keep.findIndex((l) => live(l) && /\\usepackage\s*\[[^\]]*\]\s*\{geometry\}/.test(l));
    if (geometry >= 0) keep[geometry] = keep[geometry].replace(/\[([^\]]*)\]/, (_m, o: string) => `[margin=${setup.margins}, ${o}]`);
    else added.push(`\\usepackage[margin=${setup.margins}]{geometry}`);
  }
  if (setup.spacing !== "single") added.push("\\usepackage{setspace}", setup.spacing === "double" ? "\\doublespacing" : "\\onehalfspacing");
  added.push(...FONTS[setup.font]);
  if (setup.paragraphs === "space") added.push("\\usepackage{parskip}");
  if (!setup.pageNumbers) added.push("\\pagestyle{empty}");
  // New lines go after the last package the settings load, or at their end.
  let at = keep.length;
  while (at > 0 && keep[at - 1].trim() === "") at--;
  const lastPackage = keep.reduce((last, l, i) => (live(l) && /\\usepackage/.test(l) ? i + 1 : last), -1);
  if (lastPackage >= 0) at = lastPackage;
  keep.splice(at, 0, ...added);
  const before = text.slice(0, pre.end);
  const after = keep.join(nl);
  return smallestChange(before, after);
}
