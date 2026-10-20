// The page a document is set on, as a word processor's page setup shows it: the paper, the
// size of the type, the margins, the spacing between lines, the typeface, page numbers and how
// paragraphs are told apart, and what the Layout tab sets: the orientation, the columns, line
// numbers, the header and the footer. Read from the settings at the top of the main file, and written
// back there one setting at a time: only what was changed is touched, in place where it is
// written already, and nothing else in the settings is moved or taken out. Pure.
import { escapeTex, smallestChange } from "./tableModel";
import { closingBrace, documentStart } from "./visualModel";

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
  /** The paper turned on its side. */
  landscape: boolean;
  columns: 1 | 2;
  /** Lines numbered in the margin, as journals ask of a draft sent for review. */
  lineNumbers: boolean;
  /** The header's text, on the right, as LaTeX; "" for none. */
  header: string;
  /** The footer's text, in the middle, as LaTeX; "" for none. */
  footer: string;
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
const PAGESTYLE = /\\pagestyle\s*\{\s*([a-zA-Z]*)\s*\}/g;

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

/** A header or footer field set with fancyhdr: `\fancyhead[R]{…}`, where its argument is. */
interface Field {
  kind: "head" | "foot";
  /** What is in the brackets, "" when there are none. */
  at: string;
  arg: string;
  from: number;
  to: number;
  argFrom: number;
  argTo: number;
}

/**
 * How fancyhdr sets the pages, read from the settings with their comments blanked out. What a
 * \fancypagestyle defines is another page style, and is left out.
 */
function fancyOf(given: string, pre: string) {
  let code = given;
  for (const m of given.matchAll(/\\fancypagestyle\s*\{[^}]*\}\s*(?:\[[^\]]*\]\s*)?\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = closingBrace(given, open);
    if (close > 0) code = code.slice(0, open) + " ".repeat(close - open) + code.slice(close);
  }
  const loaded = packages(code).some((p) => p.names.includes("fancyhdr"));
  const fields: Field[] = [];
  // \fancyhead[R]{…}, and the older \rhead{…}, \cfoot{…} and the like.
  for (const m of code.matchAll(/\\(?:fancy(head|foot)\s*(?:\[([^\]]*)\])?|([lcr])(head|foot))\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = closingBrace(code, open);
    if (close < 0) continue;
    const kind = (m[1] ?? m[4]) as Field["kind"];
    const at = m[3] ? m[3].toUpperCase() : (m[2] ?? "").replace(/\s/g, "");
    fields.push({ kind, at, arg: pre.slice(open + 1, close - 1), from: m.index, to: close, argFrom: open + 1, argTo: close - 1 });
  }
  const on = loaded && [...code.matchAll(PAGESTYLE)].some((m) => m[1] === "fancy");
  const cleared = /\\fancy(?:hf|foot)\s*\{\s*\}/.test(code);
  const field = (kind: Field["kind"], at: string) => fields.find((f) => f.kind === kind && f.at === at);
  const numbered = fields.some((f) => /\\thepage(?![a-zA-Z])/.test(f.arg)) || (!cleared && !field("foot", "C"));
  return { loaded, on, fields, field, numbered };
}

/** Whether a field holds only the page number. */
const pageOnly = (f: Field) => f.arg.trim() === "\\thepage";

/** A header or footer's text as LaTeX that prints it. */
export function fieldLatex(text: string): string {
  return escapeTex(text);
}

const UNESCAPES: Record<string, string> = { "\\&": "&", "\\%": "%", "\\$": "$", "\\#": "#", "\\_": "_", "\\{": "{", "\\}": "}", "\\textasciitilde{}": "~", "\\textasciicircum{}": "^", "\\textbackslash{}": "\\" };

/** A header or footer's LaTeX as the text it prints, or null when it holds commands of its own. */
export function fieldText(latex: string): string | null {
  const text = latex.replace(/\\(?:[&%$#_{}]|textasciitilde\{\}|textasciicircum\{\}|textbackslash\{\})/g, (e) => UNESCAPES[e]);
  return /\\|[{}]/.test(latex.replace(/\\(?:[&%$#_{}]|textasciitilde\{\}|textasciicircum\{\}|textbackslash\{\})/g, "")) ? null : text;
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
  const fancy = fancyOf(code, found.pre);
  const footer = fancy.on ? fancy.field("foot", "C") : undefined;
  return {
    // geometry's paper, where it is given one, is the one that counts.
    paper: geometryOptions.split(",").map((o) => o.trim()).find((o) => PAPERS.has(o)) ?? options.find((o) => PAPERS.has(o)) ?? "",
    size: options.find((o) => SIZES.has(o)) ?? "",
    margins: margin,
    spacing: spacing === "onehalfspacing" ? "onehalf" : spacing === "doublespacing" ? "double" : "single",
    font,
    pageNumbers: fancy.on ? fancy.numbered : !/\\pagestyle\s*\{\s*empty\s*\}/.test(code),
    paragraphs: loaded.some((p) => p.names.includes("parskip")) ? "space" : "indent",
    landscape: options.includes("landscape") || geometryOptions.split(",").some((o) => o.trim() === "landscape"),
    columns: options.includes("twocolumn") ? 2 : 1,
    lineNumbers: loaded.some((p) => p.names.includes("lineno")) && /\\linenumbers(?![a-zA-Z])/.test(code + bodyCode(text)),
    header: fancy.on ? (fancy.field("head", "R")?.arg ?? "") : "",
    footer: footer && !pageOnly(footer) ? footer.arg : "",
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

/** The document's text after its settings, with its comments taken out. */
function bodyCode(text: string): string {
  const begin = documentStart(text);
  return begin < 0 ? "" : text.slice(begin).replace(/(?<!\\)%[^\n]*/g, "");
}

/**
 * `text` with the stretch from `from` to `to` taken out; the whole line when nothing else is on
 * it but a comment after it, which goes with it.
 */
function cut(text: string, from: number, to: number): string {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = text.indexOf("\n", to) < 0 ? text.length : text.indexOf("\n", to);
  if (/^[ \t]*$/.test(text.slice(lineStart, from)) && /^[ \t]*(?:(?<!\\)%.*)?\r?$/.test(text.slice(to, lineEnd))) {
    return text.slice(0, lineStart) + text.slice(Math.min(lineEnd + 1, text.length));
  }
  return text.slice(0, from) + text.slice(to);
}

/** Lines that set a package up, written just after it: they stay with it. */
const SETTING_UP = /^[ \t]*(?:\\(?:linenumbers|onehalfspacing|doublespacing|singlespacing|fancyhf|fancyhead|fancyfoot)(?![a-zA-Z])|\\pagestyle\s*\{\s*fancy\s*\})/;

/**
 * Where a new line goes: after the line that ends the last package loaded, and the lines that
 * set it up just after it, or after the class.
 */
function insertionPoint(code: string): number {
  const last = packages(code).pop();
  const after = last ? last.to : (CLASS.exec(code)?.index ?? 0) + (CLASS.exec(code)?.[0].length ?? 0);
  let end = code.indexOf("\n", after);
  while (last && end >= 0 && SETTING_UP.test(code.slice(end + 1, code.indexOf("\n", end + 1) < 0 ? code.length : code.indexOf("\n", end + 1)))) end = code.indexOf("\n", end + 1);
  return end < 0 ? code.length : end + 1;
}

/**
 * The settings `pre` with the header, the footer and the page numbers set as `setup` says.
 * Without a header or a footer, page numbers are LaTeX's own, left out by \pagestyle{empty}.
 * With one, fancyhdr sets the pages: its fields are cleared and the header's text written on
 * the right, the footer's in the middle, and the page number in the middle of the foot, or on
 * its right beside a footer. Cleared again, the lines written for it go; fields of the
 * document's own are kept, and so is fancyhdr for them.
 */
function pagesChange(start: string, setup: Setup): string | { error: string } {
  let pre = start;
  const code = () => pre.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));
  const nl = pre.includes("\r\n") ? "\r\n" : "\n";
  const insertLines = (lines: string[], at = insertionPoint(code())) => {
    if (lines.length) pre = pre.slice(0, at) + lines.map((l) => l + nl).join("") + pre.slice(at);
  };
  const fancy = () => fancyOf(code(), pre);
  const { header, footer, pageNumbers } = setup;
  const page = "\\thepage";

  if (!fancy().on) {
    if (!header && !footer) {
      // LaTeX's own page style: \pagestyle{empty} leaves the numbers out.
      const empty = [...code().matchAll(PAGESTYLE)].filter((m) => m[1] === "empty");
      if (pageNumbers) for (const m of empty.reverse()) pre = cut(pre, m.index, m.index + m[0].length);
      else if (!empty.length) insertLines(["\\pagestyle{empty}"]);
      return pre;
    }
    // fancyhdr loaded with fields of the document's own, but not switched on in the settings:
    // clearing its fields would lose them, so it is left to the document.
    if (fancy().fields.length) return { error: "The header and footer are set up with fancyhdr in the document's own way; change them in the settings at the top." };
    // Set the pages with fancyhdr: any other page style chosen would win over it, so it goes.
    for (const m of [...code().matchAll(PAGESTYLE)].reverse()) pre = cut(pre, m.index, m.index + m[0].length);
    insertLines([
      ...(fancy().loaded ? [] : ["\\usepackage{fancyhdr}"]),
      "\\pagestyle{fancy}",
      "\\fancyhf{}",
      ...(header ? [`\\fancyhead[R]{${header}}`] : []),
      ...(footer ? [`\\fancyfoot[C]{${footer}}`] : []),
      ...(pageNumbers ? [`\\fancyfoot[${footer ? "R" : "C"}]{${page}}`] : []),
    ]);
    return pre;
  }

  // fancyhdr sets the pages already: the fields are changed where they are.
  const afterFancy = () => {
    const c = code();
    const ends = [...fancy().fields.map((f) => f.to), ...[...c.matchAll(/\\fancyhf\s*\{\s*\}|\\pagestyle\s*\{\s*fancy\s*\}/g)].map((m) => m.index + m[0].length)];
    const end = c.indexOf("\n", Math.max(0, ...ends));
    return ends.length ? (end < 0 ? c.length : end + 1) : insertionPoint(c);
  };
  const setField = (kind: Field["kind"], at: string, value: string) => {
    const f = fancy().field(kind, at);
    if (f && value) pre = pre.slice(0, f.argFrom) + value + pre.slice(f.argTo);
    else if (f) pre = cut(pre, f.from, f.to);
    else if (value) insertLines([`\\fancy${kind}[${at}]{${value}}`], afterFancy());
  };
  setField("head", "R", header);
  // The middle of the foot holds the footer's text, or else the page number.
  const middle = fancy().field("foot", "C");
  if (footer) {
    const moved = middle && pageOnly(middle) && pageNumbers;
    setField("foot", "C", footer);
    if (moved && !fancy().field("foot", "R")) setField("foot", "R", page);
  } else if (middle && !pageOnly(middle)) {
    setField("foot", "C", "");
    const right = fancy().field("foot", "R");
    if (right && pageOnly(right) && pageNumbers) {
      setField("foot", "R", "");
      setField("foot", "C", page);
    }
  }
  if (pageNumbers && !fancy().numbered) {
    // In the middle of the foot, or on its right; never over text of the document's own.
    const slot = ["C", "R"].find((at) => {
      const f = fancy().field("foot", at);
      return !f || pageOnly(f);
    });
    if (!slot) return { error: "The foot of the page holds text of the document's own in the middle and on the right, so there is no place for the page number; change it in the settings at the top." };
    setField("foot", slot, page);
  }
  if (!pageNumbers && fancy().numbered) {
    const own = fancy().fields.some((f) => /\\thepage(?![a-zA-Z])/.test(f.arg) && !(f.kind === "foot" && (f.at === "C" || f.at === "R") && pageOnly(f)));
    if (own) return { error: "The page number is set in the header or footer in the document's own way; change it there, in the settings at the top." };
    for (const f of fancy().fields.filter(pageOnly).reverse()) pre = cut(pre, f.from, f.to);
    if (fancy().fields.some((f) => /\\thepage(?![a-zA-Z])/.test(f.arg))) return { error: "The page number is written in the header or footer with other text; change it there, in the settings at the top." };
    // fancyhdr's own footer numbers the pages until it is cleared.
    if (fancy().numbered) insertLines(["\\fancyfoot[C]{}"], afterFancy());
  }

  // With no header or footer left, and nothing of the document's own, the lines written for them go.
  if (!header && !footer) {
    const f = fancy();
    let rest = pre;
    const cuts: [number, number][] = [
      ...f.fields.filter(pageOnly).map((x): [number, number] => [x.from, x.to]),
      ...[...code().matchAll(/\\fancyhf\s*\{\s*\}|\\pagestyle\s*\{\s*fancy\s*\}/g)].map((m): [number, number] => [m.index, m.index + m[0].length]),
      ...packages(code())
        .filter((p) => p.names.length === 1 && p.names[0] === "fancyhdr" && !p.options)
        .map((p): [number, number] => [p.from, p.to]),
    ].sort((a, b) => b[0] - a[0]);
    if (f.fields.every(pageOnly) && f.fields.every((x) => x.kind === "foot" && (x.at === "C" || x.at === "R"))) {
      for (const [from, to] of cuts) rest = cut(rest, from, to);
      const left = rest.replace(/(?<!\\)%[^\n]*/g, "");
      if (!/\\(?:fancy|[lcr](?:head|foot)(?![a-zA-Z])|headrule|footrule)|\{fancyhdr\}/.test(left)) {
        pre = rest;
        if (!pageNumbers) insertLines(["\\pagestyle{empty}"]);
      }
    }
  }
  return pre;
}

/**
 * The change that sets the document as `setup` says. Only the settings that differ from how
 * the document is set now are written; null when none does. `error` when a setting is written
 * in a way that cannot be changed for certain.
 */
export function setupChange(text: string, setup: Setup): { from: number; to: number; insert: string } | { error: string } | null {
  const was = readSetup(text);
  const before = was && { ...was };
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

  // The paper, the size of the text and the columns: options of the class. The page turned on
  // its side by the class is turned back there.
  const turnedByClass = (CLASS.exec(code())?.[1] ?? "").split(",").some((o) => o.trim() === "landscape");
  const unturn = setup.landscape !== was.landscape && !setup.landscape && turnedByClass;
  if (setup.size !== was.size || setup.paper !== was.paper || setup.columns !== was.columns || unturn) {
    const m = CLASS.exec(code())!;
    if (m[0].includes("\n")) return { error: "The \\documentclass line is written over several lines; change its options there." };
    let options = m[1] ?? "";
    if (setup.size !== was.size) options = setOption(options, (o) => SIZES.has(o), setup.size);
    if (setup.paper !== was.paper) options = setOption(options, (o) => PAPERS.has(o), setup.paper);
    if (setup.columns !== was.columns) options = setOption(options, (o) => o === "twocolumn" || o === "onecolumn", setup.columns === 2 ? "twocolumn" : "");
    if (unturn) options = setOption(options, (o) => o === "landscape", "");
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

  // The orientation: geometry's landscape option, wherever geometry is given its options.
  if (setup.landscape !== was.landscape) {
    const value = setup.landscape ? "landscape" : "";
    const isTurn = (o: string) => o === "landscape";
    const geometry = () => packages(code()).find((p) => p.names.length === 1 && p.names[0] === "geometry");
    const settingIt = () => [...code().matchAll(/\\geometry\s*\{([^}]*)\}/g)];
    const inStatement = (g: NonNullable<ReturnType<typeof geometry>>) => {
      const statement = pre.slice(g.from, g.to);
      const options = setOption(g.options, isTurn, value);
      pre = pre.slice(0, g.from) + statement.replace(/^\\usepackage\s*(?:\[[^\]]*\])?/, `\\usepackage${options ? `[${options}]` : ""}`) + pre.slice(g.to);
    };
    const inCommand = (m: RegExpMatchArray) => {
      const open = m.index! + m[0].indexOf("{") + 1;
      pre = pre.slice(0, open) + setOption(m[1], isTurn, value) + pre.slice(open + m[1].length);
    };
    const loaded = packages(code()).some((p) => p.names.includes("geometry"));
    if (setup.landscape) {
      const g = geometry();
      const command = settingIt()[0];
      if (g && (!command || g.options)) inStatement(g);
      else if (command) inCommand(command);
      else if (loaded) insertLines(["\\geometry{landscape}"]);
      else insertLines(["\\usepackage[landscape]{geometry}"]);
    } else {
      for (const m of settingIt().reverse()) if (m[1].split(",").some((o) => isTurn(o.trim()))) inCommand(m);
      // Given to geometry with other packages on the same line, the option goes there too.
      const g = packages(code()).find((p) => p.names.includes("geometry"));
      if (g && g.options.split(",").some((o) => isTurn(o.trim()))) inStatement(g);
    }
  }

  // Line numbers: the lineno package and \linenumbers.
  if (setup.lineNumbers !== was.lineNumbers) {
    const lineno = packages(code()).find((p) => p.names.includes("lineno"));
    if (setup.lineNumbers) {
      if (lineno) {
        const end = pre.indexOf("\n", lineno.to);
        insertLines(["\\linenumbers"], end < 0 ? pre.length : end + 1);
      } else insertLines(["\\usepackage{lineno}", "\\linenumbers"]);
    } else {
      const body = bodyCode(text);
      if (/\\linenumbers(?![a-zA-Z])/.test(body)) return { error: "Line numbers are switched on in the document's text with \\linenumbers; take it out there." };
      for (const m of [...code().matchAll(/\\linenumbers(?![a-zA-Z])/g)].reverse()) pre = cut(pre, m.index, m.index + m[0].length);
      // The package stays while the text still uses it.
      const used = /\\(?:nolinenumbers|linelabel|lineref|resetlinenumber|modulolinenumbers|runninglinenumbers|pagewiselinenumbers|begin\s*\{(?:linenumbers|numbertext))/.test(body);
      const p = used ? undefined : packages(code()).find((q) => q.names.includes("lineno"));
      if (p && p.names.length === 1) pre = cut(pre, p.from, p.to);
      else if (p) {
        const statement = pre.slice(p.from, p.to);
        pre = pre.slice(0, p.from) + statement.replace(/\{[^}]*\}$/, `{${p.names.filter((n) => n !== "lineno").join(",")}}`) + pre.slice(p.to);
      }
    }
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

  // The header, the footer and page numbers.
  if (setup.header !== was.header || setup.footer !== was.footer || setup.pageNumbers !== was.pageNumbers) {
    const done = pagesChange(pre, setup);
    if (typeof done !== "string") return done;
    pre = done;
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

  // Each setting asked for must read back as asked: one written in a way not changed above is
  // left alone and said so, rather than reported as done.
  const now = readSetup(pre + text.slice(found.pre.length));
  const missed = (Object.keys(setup) as (keyof Setup)[]).find((k) => before && setup[k] !== before[k] && k !== "font" && now?.[k] !== setup[k]);
  if (missed) return { error: `The ${NAMES[missed]} is written in the settings at the top in a way the app does not change for certain; change it there.` };
  return smallestChange(found.pre, pre);
}

/** Each setting as a message names it. */
const NAMES: Record<keyof Setup, string> = {
  paper: "paper size",
  size: "text size",
  margins: "margin",
  spacing: "line spacing",
  font: "typeface",
  pageNumbers: "page numbering",
  paragraphs: "paragraph style",
  landscape: "orientation",
  columns: "number of columns",
  lineNumbers: "line numbering",
  header: "header",
  footer: "footer",
};
