// The page a document is set on, as a word processor's page setup shows it: the paper, the
// size of the type, the margins, the spacing between lines, the typeface, page numbers and how
// paragraphs are told apart. Read from the settings at the top of the main file, and written
// back there one setting at a time: only what was changed is touched, in place where it is
// written already, and nothing else in the settings is moved or taken out. Pure.
import { smallestChange } from "./tableModel";
import { documentStart } from "./visualModel";

export interface Setup {
  /** "a4paper", "letterpaper" and the like, or "" for the class's own. */
  paper: string;
  /** "10pt", "11pt", "12pt", or "" for the class's own. */
  size: string;
  /** A margin on every side, such as "2.5cm", or "" for the class's own. */
  margins: string;
  spacing: "single" | "onehalf" | "double";
  font: "default" | "times" | "palatino" | "sans" | "other";
  pageNumbers: boolean;
  /** Paragraphs told apart by an indented first line, or by space between them. */
  paragraphs: "indent" | "space";
}

/** The lines that choose each typeface offered. */
const FONTS: Record<Setup["font"], string[]> = {
  default: [],
  other: [],
  times: ["\\usepackage{newtxtext,newtxmath}"],
  palatino: ["\\usepackage{newpxtext,newpxmath}"],
  sans: ["\\renewcommand{\\familydefault}{\\sfdefault}"],
};
/** Packages that choose a typeface. */
const FONT_PACKAGES = new Set(["newtxtext", "newtxmath", "newpxtext", "newpxmath", "mathptmx", "times", "mathpazo", "palatino", "helvet", "tgtermes", "tgpagella", "tgheros"]);
const SIZES = new Set(["10pt", "11pt", "12pt"]);
const PAPERS = new Set(["a4paper", "letterpaper", "a5paper", "b5paper", "legalpaper", "executivepaper"]);
const CLASS = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/;
const USE = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
const SPACING = /^[ \t]*\\(onehalfspacing|doublespacing|singlespacing)\b[ \t]*(?:%.*)?$/m;
const SANS_DEFAULT = /\\renewcommand\s*\{?\\familydefault\}?\s*\{\\sfdefault\}/;

/** The settings at the top, with their comments blanked out (every offset kept), or null. */
function settings(text: string): { pre: string; code: string } | null {
  const begin = documentStart(text);
  if (begin < 0) return null;
  const pre = text.slice(0, begin);
  const code = pre.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));
  return CLASS.test(code) ? { pre, code } : null;
}

/** The packages loaded, each with where its statement is and its options. */
function packages(code: string): { names: string[]; options: string; from: number; to: number }[] {
  return [...code.matchAll(USE)].map((m) => ({
    names: m[2].split(",").map((n) => n.trim()),
    options: m[1] ?? "",
    from: m.index,
    to: m.index + m[0].length,
  }));
}

/** How the document is set now, or null when the text has no settings of its own to read. */
export function readSetup(text: string): Setup | null {
  const found = settings(text);
  if (!found) return null;
  const { code } = found;
  const options = (CLASS.exec(code)?.[1] ?? "").split(",").map((o) => o.trim());
  const loaded = packages(code);
  const geometry = loaded.find((p) => p.names.includes("geometry"));
  const geometryOptions = [geometry?.options ?? "", ...[...code.matchAll(/\\geometry\s*\{([^}]*)\}/g)].map((m) => m[1])].join(",");
  const margin = /(?:^|,)\s*margin\s*=\s*([^,\s]+)/.exec(geometryOptions)?.[1] ?? "";
  const setspace = loaded.find((p) => p.names.includes("setspace"));
  const spacing = SPACING.exec(code)?.[1] ?? /(onehalfspacing|doublespacing)/.exec(setspace?.options ?? "")?.[1];
  const fonts = loaded.flatMap((p) => p.names).filter((n) => FONT_PACKAGES.has(n));
  const font: Setup["font"] = SANS_DEFAULT.test(code)
    ? "sans"
    : fonts.length === 0
      ? "default"
      : fonts.every((f) => /^newpx|pazo|palatino|pagella/.test(f))
        ? "palatino"
        : fonts.every((f) => /^newtx|ptmx|times|termes/.test(f))
          ? "times"
          : "other";
  return {
    paper: options.find((o) => PAPERS.has(o)) ?? geometryOptions.split(",").map((o) => o.trim()).find((o) => PAPERS.has(o)) ?? "",
    size: options.find((o) => SIZES.has(o)) ?? "",
    margins: margin,
    spacing: spacing === "onehalfspacing" ? "onehalf" : spacing === "doublespacing" ? "double" : "single",
    font,
    pageNumbers: !/\\pagestyle\s*\{\s*empty\s*\}/.test(code),
    paragraphs: loaded.some((p) => p.names.includes("parskip")) ? "space" : "indent",
  };
}

/**
 * An options list with the one matching `which` set to `value` ("" takes it out), others kept
 * as they were written. A new one goes at the end.
 */
function setOption(options: string, which: (o: string) => boolean, value: string): string {
  const parts = options.split(",");
  const at = parts.findIndex((p) => p.trim() !== "" && which(p.trim()));
  if (at >= 0) {
    if (value) parts[at] = parts[at].replace(parts[at].trim(), value);
    else parts.splice(at, 1);
  } else if (value) {
    const spaced = /,\s/.test(options) || (options.trim() !== "" && !options.includes(","));
    parts.push(options.trim() === "" ? value : `${spaced ? " " : ""}${value}`);
  }
  return parts.filter((p, i) => p.trim() !== "" || (i === 0 && parts.length === 1)).join(",").replace(/^\s+/, "");
}

/** `text` with the stretch from `from` to `to` taken out; the whole line when nothing else is on it. */
function cut(text: string, from: number, to: number): string {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = text.indexOf("\n", to) < 0 ? text.length : text.indexOf("\n", to);
  if (/^[ \t]*$/.test(text.slice(lineStart, from)) && /^[ \t]*$/.test(text.slice(to, lineEnd))) {
    return text.slice(0, lineStart) + text.slice(Math.min(lineEnd + 1, text.length));
  }
  return text.slice(0, from) + text.slice(to);
}

/** Where a new line goes: after the line that ends the last package loaded, or after the class. */
function insertionPoint(code: string): number {
  const last = packages(code).pop();
  const after = last ? last.to : (CLASS.exec(code)?.index ?? 0) + (CLASS.exec(code)?.[0].length ?? 0);
  const end = code.indexOf("\n", after);
  return end < 0 ? code.length : end + 1;
}

/**
 * The change that sets the document as `setup` says. Only the settings that differ from how
 * the document is set now are written; null when none does. `error` when a setting is written
 * in a way that cannot be changed for certain.
 */
export function setupChange(text: string, setup: Setup): { from: number; to: number; insert: string } | { error: string } | null {
  const was = readSetup(text);
  const found = settings(text);
  if (!was || !found) return null;
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  let pre = found.pre;
  const code = () => pre.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));
  const insertLines = (lines: string[], at = insertionPoint(code())) => {
    if (lines.length) pre = pre.slice(0, at) + lines.map((l) => l + nl).join("") + pre.slice(at);
  };

  // The paper, where geometry is given it: changed there, since geometry's is the one that counts.
  const geometryPaper = packages(code()).find((p) => p.names.length === 1 && p.names[0] === "geometry" && p.options.split(",").some((o) => PAPERS.has(o.trim())));
  if (setup.paper !== was.paper && geometryPaper) {
    const statement = pre.slice(geometryPaper.from, geometryPaper.to);
    const options = setOption(geometryPaper.options, (o) => PAPERS.has(o), setup.paper);
    pre = pre.slice(0, geometryPaper.from) + statement.replace(/^\\usepackage\s*(?:\[[^\]]*\])?/, `\\usepackage${options ? `[${options}]` : ""}`) + pre.slice(geometryPaper.to);
    was.paper = setup.paper;
  }

  // The paper and the size of the text: options of the class.
  if (setup.size !== was.size || setup.paper !== was.paper) {
    const m = CLASS.exec(code())!;
    if (m[0].includes("\n")) return { error: "The \\documentclass line is written over several lines; change its options there." };
    let options = m[1] ?? "";
    if (setup.size !== was.size) options = setOption(options, (o) => SIZES.has(o), setup.size);
    if (setup.paper !== was.paper) options = setOption(options, (o) => PAPERS.has(o), setup.paper);
    pre = pre.slice(0, m.index) + `\\documentclass${options ? `[${options}]` : ""}{${m[2]}}` + pre.slice(m.index + m[0].length);
  }

  // The margins: geometry's margin option, wherever geometry is given its options.
  if (setup.margins !== was.margins) {
    const isMargin = (o: string) => /^margin\s*=/.test(o);
    const value = setup.margins ? `margin=${setup.margins}` : "";
    const geometry = packages(code()).find((p) => p.names.includes("geometry"));
    const settingIt = /\\geometry\s*\{([^}]*)\}/.exec(code());
    if (settingIt && (/margin\s*=/.test(settingIt[1]) || !geometry?.options)) {
      const inner = setOption(settingIt[1], isMargin, value);
      const open = settingIt.index + settingIt[0].indexOf("{") + 1;
      pre = pre.slice(0, open) + inner + pre.slice(open + settingIt[1].length);
    } else if (geometry && geometry.names.length === 1) {
      const statement = pre.slice(geometry.from, geometry.to);
      const options = setOption(geometry.options, isMargin, value);
      pre = pre.slice(0, geometry.from) + statement.replace(/^\\usepackage\s*(?:\[[^\]]*\])?/, `\\usepackage${options ? `[${options}]` : ""}`) + pre.slice(geometry.to);
    } else if (geometry) {
      if (value) insertLines([`\\geometry{${value}}`]);
    } else if (value) insertLines([`\\usepackage[${value}]{geometry}`]);
  }

  // The spacing between lines: setspace's command, or its option.
  if (setup.spacing !== was.spacing) {
    const command = setup.spacing === "onehalf" ? "\\onehalfspacing" : setup.spacing === "double" ? "\\doublespacing" : "";
    const line = SPACING.exec(code());
    const setspace = packages(code()).find((p) => p.names.includes("setspace"));
    const option = setspace && /onehalfspacing|doublespacing/.exec(setspace.options);
    if (line) {
      const from = line.index + line[0].indexOf("\\");
      const to = from + line[1].length + 1;
      pre = command ? pre.slice(0, from) + command + pre.slice(to) : cut(pre, from, to);
    } else if (option && setspace) {
      const statement = pre.slice(setspace.from, setspace.to);
      const options = setOption(setspace.options, (o) => /^(?:onehalfspacing|doublespacing)$/.test(o), command.slice(1));
      pre = pre.slice(0, setspace.from) + statement.replace(/^\\usepackage\s*(?:\[[^\]]*\])?/, `\\usepackage${options ? `[${options}]` : ""}`) + pre.slice(setspace.to);
    } else if (command) {
      if (setspace) {
        const end = pre.indexOf("\n", setspace.to);
        insertLines([command], end < 0 ? pre.length : end + 1);
      } else insertLines(["\\usepackage{setspace}", command]);
    }
  }

  // The typeface: what chooses one now goes, and the lines for the new one are added.
  if (setup.font !== was.font && setup.font !== "other") {
    for (const p of packages(code()).reverse()) {
      const fonts = p.names.filter((n) => FONT_PACKAGES.has(n));
      if (!fonts.length) continue;
      if (fonts.length === p.names.length) pre = cut(pre, p.from, p.to);
      else {
        const statement = pre.slice(p.from, p.to);
        const kept = p.names.filter((n) => !FONT_PACKAGES.has(n)).join(",");
        pre = pre.slice(0, p.from) + statement.replace(/\{[^}]*\}$/, `{${kept}}`) + pre.slice(p.to);
      }
    }
    const sans = SANS_DEFAULT.exec(code());
    if (sans) pre = cut(pre, sans.index, sans.index + sans[0].length);
    insertLines(FONTS[setup.font]);
  }

  // Page numbers: \pagestyle{empty} leaves them out.
  if (setup.pageNumbers !== was.pageNumbers) {
    if (setup.pageNumbers) {
      for (const m of [...code().matchAll(/\\pagestyle\s*\{\s*empty\s*\}/g)].reverse()) pre = cut(pre, m.index, m.index + m[0].length);
    } else insertLines(["\\pagestyle{empty}"]);
  }

  // Paragraphs set apart by space: the parskip package.
  if (setup.paragraphs !== was.paragraphs) {
    if (setup.paragraphs === "space") insertLines(["\\usepackage{parskip}"]);
    else {
      const p = packages(code()).find((q) => q.names.includes("parskip"));
      if (p && p.names.length === 1) pre = cut(pre, p.from, p.to);
      else if (p) {
        const statement = pre.slice(p.from, p.to);
        pre = pre.slice(0, p.from) + statement.replace(/\{[^}]*\}$/, `{${p.names.filter((n) => n !== "parskip").join(",")}}`) + pre.slice(p.to);
      }
    }
  }

  return smallestChange(found.pre, pre);
}
