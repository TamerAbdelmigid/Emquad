// What a compile error means, in plain words, and a fix for it when one is certain. LaTeX's own
// messages are written for people who know TeX; these are for people who know Word. Pure: the
// app applies a fix, this only says what it is.
import type { Diagnostic } from "../../ipc/api";

/** A change that puts an error right. */
export type Fix =
  /** Load a package in the main file's settings. */
  | { kind: "package"; label: string; name: string }
  /** Put a backslash before the character at `column` (1-based) of `line`, so it prints. */
  | { kind: "escape"; label: string; file: string; line: number; column: number; char: string }
  /** Go to where the trouble is. */
  | { kind: "go"; label: string; file: string; line: number };

export interface Help {
  /** What went wrong, in plain words. */
  text: string;
  /** A note on how the document is set, not an error: a line a little too wide, say. */
  note?: boolean;
  fix?: Fix;
}

/** Commands that come from a package, and which. */
const COMMAND_PACKAGES: Record<string, string> = {
  includegraphics: "graphicx", graphicspath: "graphicx", rotatebox: "graphicx", scalebox: "graphicx", resizebox: "graphicx",
  url: "url", href: "hyperref", hyperref: "hyperref", autoref: "hyperref", hypersetup: "hyperref",
  toprule: "booktabs", midrule: "booktabs", bottomrule: "booktabs", cmidrule: "booktabs", addlinespace: "booktabs",
  multirow: "multirow", makecell: "makecell", thead: "makecell",
  textcolor: "xcolor", color: "xcolor", colorbox: "xcolor", definecolor: "xcolor", rowcolor: "xcolor", cellcolor: "xcolor",
  mathbb: "amssymb", mathfrak: "amssymb", checkmark: "amssymb", varnothing: "amssymb", leqslant: "amssymb", geqslant: "amssymb",
  text: "amsmath", eqref: "amsmath", binom: "amsmath", dfrac: "amsmath", tfrac: "amsmath", operatorname: "amsmath", DeclareMathOperator: "amsmath",
  boldsymbol: "amsmath", iint: "amsmath", iiint: "amsmath", intertext: "amsmath", tag: "amsmath", mathscr: "mathrsfs",
  SI: "siunitx", si: "siunitx", num: "siunitx", qty: "siunitx", unit: "siunitx", ang: "siunitx",
  cref: "cleveref", Cref: "cleveref", lipsum: "lipsum", blindtext: "blindtext", sout: "ulem", uline: "ulem", uwave: "ulem",
  cancel: "cancel", degree: "gensymb", celsius: "gensymb", captionof: "caption", onehalfspacing: "setspace",
  doublespacing: "setspace", singlespacing: "setspace", setstretch: "setspace", newgeometry: "geometry", lstinputlisting: "listings",
  citep: "natbib", citet: "natbib", citeauthor: "natbib", printbibliography: "biblatex", addbibresource: "biblatex",
  xspace: "xspace", nicefrac: "nicefrac", hl: "soul", euro: "eurosym", ding: "pifont", tikz: "tikz", usetikzlibrary: "tikz",
};

/** Environments that come from a package, and which. */
const ENVIRONMENT_PACKAGES: Record<string, string> = {
  align: "amsmath", "align*": "amsmath", gather: "amsmath", "gather*": "amsmath", multline: "amsmath", "multline*": "amsmath",
  flalign: "amsmath", alignat: "amsmath", "equation*": "amsmath", split: "amsmath", cases: "amsmath", matrix: "amsmath",
  pmatrix: "amsmath", bmatrix: "amsmath", vmatrix: "amsmath", Vmatrix: "amsmath", proof: "amsthm",
  tabularx: "tabularx", longtable: "longtable", multicols: "multicol", subfigure: "subcaption", subtable: "subcaption",
  lstlisting: "listings", algorithm: "algorithm", algorithmic: "algpseudocode", wrapfigure: "wrapfig", landscape: "pdflscape",
  tikzpicture: "tikz", spacing: "setspace", onehalfspace: "setspace", doublespace: "setspace", minted: "minted",
};

/** Where a line's text is a formula, as far as one line shows: inside $…$ or \(…\). */
function mathOnLine(line: string): boolean[] {
  const out: boolean[] = [];
  let math = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && (line[i + 1] === "(" || line[i + 1] === ")")) {
      math = line[i + 1] === "(";
      out.push(true, true);
      i++;
      continue;
    }
    if (ch === "\\") {
      out.push(math, math);
      i++;
      continue;
    }
    if (ch === "$") {
      out.push(true);
      math = !math;
      continue;
    }
    out.push(math);
  }
  return out;
}

/** The first `char` on a line that is outside a formula, has no backslash before it and is not in a comment: 1-based, or 0. */
function bareChar(line: string, char: string): number {
  const math = mathOnLine(line);
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "%") return 0;
    if (line[i] === char && !math[i]) return i + 1;
  }
  return 0;
}

/** The commands written on a line, comments left out. */
function commandsOn(line: string): string[] {
  const code = line.replace(/(?<!\\)%.*$/, "");
  return [...code.matchAll(/\\([a-zA-Z@]+)/g)].map((m) => m[1]);
}

/**
 * Where something begun in `text` was never ended: the line of the first `{` never closed, or
 * of the first `\begin` never ended; or of a `}` or `\end` with nothing to close. Comments and
 * escaped braces are left out. Null when everything is closed.
 */
export function findUnclosed(text: string): { line: number; what: "brace" | "environment" | "extra" } | null {
  const braces: number[] = [];
  const environments: { name: string; line: number }[] = [];
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].replace(/(?<!\\)%.*$/, "");
    for (const m of line.matchAll(/\\(begin|end)\s*\{([^}]*)\}|\\[{}]|\\verb(.).*?\3|[{}]/g)) {
      const token = m[0];
      if (m[1] === "begin") environments.push({ name: m[2], line: n + 1 });
      else if (m[1] === "end") {
        if (environments[environments.length - 1]?.name === m[2]) environments.pop();
        else return { line: n + 1, what: "extra" };
      } else if (token === "{") braces.push(n + 1);
      else if (token === "}") {
        if (!braces.pop()) return { line: n + 1, what: "extra" };
      }
    }
  }
  if (braces.length) return { line: braces[0], what: "brace" };
  if (environments.length && environments[0].name !== "document") return { line: environments[environments.length - 1].line, what: "environment" };
  if (environments.length > 1) return { line: environments[environments.length - 1].line, what: "environment" };
  return null;
}

/**
 * Plain words for a compile message, and a fix when one is certain. `textOf` gives a project
 * file's text when it is at hand, `loaded` whether the document loads a package.
 */
export function explain(d: Diagnostic, textOf: (path: string) => string | undefined, loaded: (name: string) => boolean): Help | null {
  const m = d.message;
  const lineText = d.line > 0 ? (textOf(d.file)?.split("\n")[d.line - 1] ?? "") : "";
  const at = (column: number, char: string, label: string): Fix | undefined =>
    column > 0 ? { kind: "escape", label, file: d.file, line: d.line, column, char } : undefined;

  if (/^(?:Overfull|Underfull) \\[hv]box/.test(m)) {
    return { note: true, text: "A line or a page here is a little too full or too loose to set well. The PDF is fine to read; rewording or a hyphen can tidy it." };
  }
  if (/Undefined control sequence/.test(m)) {
    const commands = commandsOn(lineText);
    const needs = commands.find((c) => COMMAND_PACKAGES[c] && !loaded(COMMAND_PACKAGES[c]));
    if (needs) {
      const name = COMMAND_PACKAGES[needs];
      return { text: `\\${needs} comes from the ${name} package, which this document does not load.`, fix: { kind: "package", label: `Add \\usepackage{${name}}`, name } };
    }
    return { text: `A command on this line is not one LaTeX knows${commands.length ? `: check the spelling of ${commands.map((c) => `\\${c}`).join(", ")}` : ""}, or load the package it comes from.` };
  }
  const environment = /Environment (\S+) undefined/.exec(m);
  if (environment) {
    const name = ENVIRONMENT_PACKAGES[environment[1]];
    if (name && !loaded(name)) return { text: `The ${environment[1]} environment comes from the ${name} package, which this document does not load.`, fix: { kind: "package", label: `Add \\usepackage{${name}}`, name } };
    return { text: `There is no environment called ${environment[1]}. Check its spelling, or load the package it comes from.` };
  }
  if (/Misplaced alignment tab character/.test(m)) {
    return { text: "An & on its own separates the columns of a table. To print the character in text, write \\&.", fix: at(bareChar(lineText, "&"), "&", "Write it as \\&") };
  }
  if (/macro parameter character #/.test(m)) {
    return { text: "A # on its own does not print. To print the character, write \\#.", fix: at(bareChar(lineText, "#"), "#", "Write it as \\#") };
  }
  if (/Missing \$ inserted/.test(m)) {
    const under = bareChar(lineText, "_");
    if (under) return { text: "An _ in ordinary text starts a subscript, which only works in a formula. To print the character, write \\_; for a subscript, put it in a formula, as $x_1$.", fix: at(under, "_", "Write it as \\_") };
    if (bareChar(lineText, "^")) return { text: "A ^ in ordinary text starts a power, which only works in a formula: write $x^2$, or \\textasciicircum{} for the character itself." };
    return { text: "Something on this line works only in a formula, or a formula is missing its closing $." };
  }
  const notFound = /File `([^']+)' not found/.exec(m);
  if (notFound) {
    const file = notFound[1];
    if (/\.(?:sty|cls)$/.test(file) || !/\./.test(file)) return { text: `The package ${file.replace(/\.(?:sty|cls)$/, "")} could not be found. Emquad downloads a package the first time it is used: check the internet connection and compile again, or check its name.` };
    return { text: `The file ${file} is not in the project. Check its name and folder${/\.(?:png|jpe?g|pdf|eps)$/i.test(file) ? ", or add the picture with File ▸ Add files from disk" : ""}.` };
  }
  const mismatch = /\\begin\{([^}]+)\} on input line (\d+) ended by \\end\{([^}]+)\}/.exec(m);
  if (mismatch) {
    return {
      text: `The ${mismatch[1]} begun on line ${mismatch[2]} is ended by \\end{${mismatch[3]}}. Each \\begin needs its own \\end, the last begun ended first.`,
      fix: { kind: "go", label: `Go to line ${mismatch[2]}`, file: d.file, line: Number(mismatch[2]) },
    };
  }
  if (/Missing \\begin\{document\}/.test(m)) return { text: "There is text in the settings at the top, before \\begin{document}, where only commands may go. Move it below \\begin{document}." };
  if (/Can be used only in preamble/.test(m)) return { text: "This command belongs in the settings at the top, before \\begin{document}." };
  if (/Extra \}, or forgotten \$|Too many \}'s/.test(m)) return { text: "There is a } with no { to match it." };
  if (/Missing \} inserted|Runaway argument|File ended while scanning|Paragraph ended before/.test(m)) return { text: "A { is not closed with } before the paragraph or the file ends." };
  if (/Emergency stop|\\end occurred|Missing \\end\{document\}|ended by \\end\{document\}/.test(m)) return { text: "The document ends before everything begun in it was ended: an environment or a { is still open." };
  if (/Illegal unit of measure/.test(m)) return { text: "A length needs a unit, such as 2cm, 10pt or 0.5\\linewidth." };
  if (/Missing number, treated as zero/.test(m)) return { text: "A number was expected here, such as a width, a length or a count." };
  const citation = /Citation `([^']+)'.*undefined/.exec(m);
  if (citation) return { text: `No reference called ${citation[1]} was found. Compile again; if it stays, add it to the .bib file, or check the key.` };
  const reference = /Reference `([^']+)'.*undefined/.exec(m);
  if (reference) return { text: `There is no \\label{${reference[1]}} in the document. Check the name, or compile again if it was just added.` };
  if (/There were undefined references|Label\(s\) may have changed|Rerun to get/.test(m)) return { note: true, text: "References are numbered on the compile after they change: compile once more." };
  const clash = /Option clash for package (\S+)/.exec(m);
  if (clash) return { text: `The ${clash[1]} package is loaded twice with different settings. Load it once, with all its settings together.` };
  if (/Font shape .* undefined|Font .* not found/.test(m)) return { note: true, text: "A font asked for is not available in that style; a similar one is used." };
  return null;
}

/** For an error the compiler gave no line for, where it most likely is: what was begun and never ended. */
export function locate(d: Diagnostic, textOf: (path: string) => string | undefined): Fix | undefined {
  if (d.line > 0 || d.severity !== "error") return undefined;
  if (!/Runaway|File ended|Emergency stop|\\end occurred|Missing \\end|Missing \} inserted|ended by|Extra \}|Too many/.test(d.message)) return undefined;
  const text = textOf(d.file);
  const found = text === undefined ? null : findUnclosed(text);
  if (!found) return undefined;
  const what = found.what === "brace" ? "the { that is never closed" : found.what === "environment" ? "the \\begin that is never ended" : "the } or \\end with nothing to close";
  return { kind: "go", label: `Go to ${what}, line ${found.line}`, file: d.file, line: found.line };
}
