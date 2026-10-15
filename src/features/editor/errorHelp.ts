// What a compile error means, in plain words, and a fix for it when one is certain. LaTeX's own
// messages are written for people who know TeX; these are for people who know Word. Pure: the
// app applies a fix, this only says what it is.
import { literalAt } from "./paste";
import { mathAt } from "./symbols";
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

/**
 * The one place on line `n` of `text` where `char` stands bare in ordinary text: no backslash
 * before it, and not in a comment, a formula (one over several lines too), `\verb`, or an
 * argument written as it is, such as a label, a reference or an address. Its 1-based column;
 * 0 when there is none, or more than one, since then which one is at fault is not certain.
 */
function onlyBare(text: string, n: number, char: string): number {
  const lines = text.split("\n");
  const line = lines[n - 1] ?? "";
  const start = lines.slice(0, n - 1).reduce((at, l) => at + l.length + 1, 0);
  const found: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      const verb = /^\\(?:verb|lstinline)\*?([^a-zA-Z\s*])/.exec(line.slice(i));
      if (verb) {
        const close = line.indexOf(verb[1], i + verb[0].length);
        i = close < 0 ? line.length : close;
      } else i++;
      continue;
    }
    if (line[i] === "%") break;
    if (line[i] === char && !mathAt(text, start + i) && !literalAt(text, start + i)) found.push(i + 1);
  }
  return found.length === 1 ? found[0] : 0;
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
  let line = 1;
  // Step over `text` from `from` to `to`, counting the lines passed.
  const skip = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (text[k] === "\n") line++;
    return to - 1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") line++;
    else if (ch === "%") {
      const end = text.indexOf("\n", i);
      i = (end < 0 ? text.length : end) - 1;
    } else if (ch === "\\") {
      const name = /^[a-zA-Z@]+/.exec(text.slice(i + 1, i + 40))?.[0];
      // \\, \{, \}, \% and the like are a backslash and one character.
      if (!name) {
        i++;
        continue;
      }
      const after = i + 1 + name.length;
      const verb = /^\*?([^a-zA-Z\s*])/.exec(text.slice(after, after + 2));
      if ((name === "verb" || name === "lstinline") && verb) {
        const close = text.indexOf(verb[1], after + verb[0].length);
        i = close < 0 || text.slice(after, close).includes("\n") ? after : close;
        continue;
      }
      // An address is written as it is: a % in it is not a comment.
      if ((name === "url" || name === "href" || name === "nolinkurl") && text[after] === "{") {
        const close = text.indexOf("}", after);
        i = close < 0 ? after : skip(after, close + 1);
        continue;
      }
      const env = /^\s*\{([^}]*)\}/.exec(text.slice(after, after + 80));
      if ((name === "begin" || name === "end") && env) {
        const envName = env[1];
        i = after + env[0].length - 1;
        if (name === "begin") {
          // What a verbatim environment holds is text, braces and all.
          if (/^(?:verbatim\*?|Verbatim|lstlisting|minted|comment|filecontents\*?)$/.test(envName)) {
            const end = text.indexOf(`\\end{${envName}}`, i);
            if (end < 0) return { line, what: "environment" };
            i = skip(i + 1, end + `\\end{${envName}}`.length);
          } else environments.push({ name: envName, line });
        } else if (environments[environments.length - 1]?.name === envName) environments.pop();
        else return { line, what: "extra" };
        continue;
      }
      i = after - 1;
    } else if (ch === "{") braces.push(line);
    else if (ch === "}" && braces.pop() === undefined) return { line, what: "extra" };
  }
  if (braces.length) return { line: braces[0], what: "brace" };
  const open = environments.filter((e) => e.name !== "document");
  if (open.length) return { line: open[open.length - 1].line, what: "environment" };
  return null;
}

/**
 * Plain words for a compile message, and a fix when one is certain. `textOf` gives a project
 * file's text when it is at hand, `loaded` whether the document loads a package.
 */
export function explain(d: Diagnostic, textOf: (path: string) => string | undefined, loaded: (name: string) => boolean): Help | null {
  const m = d.message;
  const fileText = textOf(d.file) ?? "";
  const lineText = d.line > 0 ? (fileText.split("\n")[d.line - 1] ?? "") : "";
  const bare = (char: string) => (d.line > 0 ? onlyBare(fileText, d.line, char) : 0);
  const at = (column: number, char: string, label: string): Fix | undefined =>
    column > 0 ? { kind: "escape", label, file: d.file, line: d.line, column, char } : undefined;

  if (/^(?:Overfull|Underfull) \\[hv]box/.test(m)) {
    return { note: true, text: "A line or a page here is a little too full or too loose to set well. The PDF is fine to read; rewording or a hyphen can tidy it." };
  }
  if (/Undefined control sequence/.test(m)) {
    const commands = commandsOn(lineText);
    const needs = commands.find((c) => COMMAND_PACKAGES[c] && !loaded(COMMAND_PACKAGES[c]));
    // natbib and biblatex cannot both be loaded: a command of one in a document using the other
    // is written the other's way instead.
    if (needs && COMMAND_PACKAGES[needs] === "natbib" && loaded("biblatex")) {
      return { text: `\\${needs} belongs to natbib, and this document uses biblatex: write \\parencite or \\textcite instead.` };
    }
    if (needs && COMMAND_PACKAGES[needs] === "biblatex" && !loaded("biblatex")) {
      return { text: `\\${needs} belongs to biblatex, and this document uses BibTeX: the list of references is printed by \\bibliography{…}.` };
    }
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
    return { text: "An & on its own separates the columns of a table. To print the character in text, write \\&.", fix: at(bare("&"), "&", "Write it as \\&") };
  }
  if (/macro parameter character #/.test(m)) {
    return { text: "A # on its own does not print. To print the character, write \\#.", fix: at(bare("#"), "#", "Write it as \\#") };
  }
  if (/Missing \$ inserted/.test(m)) {
    const under = bare("_");
    if (under) return { text: "An _ in ordinary text starts a subscript, which only works in a formula. To print the character, write \\_; for a subscript, put it in a formula, as $x_1$.", fix: at(under, "_", "Write it as \\_") };
    if (bare("^")) return { text: "A ^ in ordinary text starts a power, which only works in a formula: write $x^2$, or \\textasciicircum{} for the character itself." };
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
