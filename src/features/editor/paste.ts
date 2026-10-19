// Pasting text from elsewhere, such as Word, a web page or an e-mail: written so that it prints
// as it reads. A % would otherwise hide the rest of the line, and an & or _ stop the compile.
import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { store } from "../../state/store";
import { mathAt } from "./symbols";
import { formattedPaste, printed } from "./formattedPaste";


/**
 * Whether text reads as LaTeX already: any command, any character written with its backslash
 * (`\%`, `\&` and the like), or a formula. Such text is pasted as it is, so nothing in it is
 * escaped twice.
 */
export function looksLikeLatex(text: string): boolean {
  return /\\(?:[a-zA-Z@]+|[%&$#_{}\\])/.test(text) || /(?<!\\)\$[^$\n]+(?<!\\)\$/.test(text);
}

/** Commands whose argument is a name, an address or a key, written as it is. */
const LITERAL_ARGUMENTS = new Set([
  "url", "href", "nolinkurl", "includegraphics", "input", "include", "label", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "nameref",
  "vref", "cpageref", "Cpageref", "subref", "hyperref", "hyperlink", "hypertarget", "cite", "citep", "citet", "Citep", "Citet", "citealp",
  "citealt", "citeauthor", "Citeauthor", "citeyear", "citeyearpar", "citetitle", "fullcite", "parencite", "Parencite", "textcite",
  "Textcite", "autocite", "Autocite", "footcite", "smartcite", "supercite", "nocite", "bibitem", "bibliography", "addbibresource",
  "bibliographystyle", "usepackage", "RequirePackage", "documentclass", "graphicspath", "lstinputlisting", "verb", "input", "subfile",
]);
/** Environments whose text is taken as it is written. */
const VERBATIM = /^(?:verbatim\*?|Verbatim|lstlisting|minted|comment|filecontents\*?|alltt)$/;

/**
 * Whether `pos` is where text is taken as it is written: in the argument of a command such as
 * \url or \label, or inside a verbatim environment or a code listing.
 */
export function literalAt(text: string, pos: number): boolean {
  // The innermost group the place is in, braces or the square brackets of an option such as
  // \hyperref[label], and the command it belongs to.
  let depth = 0;
  for (let i = pos - 1; i >= 0 && pos - i < 4000; i--) {
    const ch = text[i];
    if (text[i - 1] === "\\") continue;
    if (ch === "}" || ch === "]") depth++;
    else if ((ch === "{" || ch === "[") && depth-- === 0) {
      const name = /\\([a-zA-Z@]+)\*?(?:\[[^\]]*\])?\s*$/.exec(text.slice(Math.max(0, i - 80), i))?.[1];
      if (name && LITERAL_ARGUMENTS.has(name)) return true;
      break;
    }
  }
  // The environments still open at the place.
  const open: string[] = [];
  for (const m of text.slice(0, pos).matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
    if (m[1] === "begin") open.push(m[2]);
    else if (open[open.length - 1] === m[2]) open.pop();
  }
  return open.some((env) => VERBATIM.test(env));
}

/**
 * What to write for text pasted from elsewhere, or null to paste it as it is: text that is
 * LaTeX already, or that goes into mathematics. Text that came with formatting, from a word
 * processor or a web page, has a paragraph on each line, which LaTeX would run together, so
 * each line is made a paragraph of its own.
 */
export function pastedText(text: string, formatted: boolean, inMath: boolean, inArgument = false): string | null {
  if (inMath || looksLikeLatex(text) || !/[&%$#_{}~^\\]|\r?\n/.test(text)) return null;
  let out = printed(text.replace(/\r\n?/g, "\n"));
  if (formatted || inArgument) {
    const lines = out
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    // Inside a command's braces, such as \textbf{…}, a paragraph cannot end: the lines are
    // joined into one, or the document would not compile.
    out = lines.join(inArgument ? " " : "\n\n");
  }
  return out === text ? null : out;
}

/** Whether `pos` is inside a braced group of the paragraph it is in, such as the argument of \textbf. */
export function inGroup(text: string, pos: number): boolean {
  const start = Math.max(text.lastIndexOf("\n\n", pos), 0);
  let depth = 0;
  for (let i = start; i < pos; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "%") {
      const end = text.indexOf("\n", i);
      if (end < 0 || end >= pos) break;
      i = end;
    } else if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

/** The text last copied or cut in the editor, which is LaTeX and is pasted back as it was. */
let copiedHere = "";
/** What is done with a picture pasted on its own: the app adds it to the project. */
let pastedPicture: (file: File) => void = () => {};
export function onPastedPicture(add: (file: File) => void) {
  pastedPicture = add;
}

/** What is done for packages pasted text needs: the app has the main file load them. */
let pastedNeeds: (packages: string[]) => void = () => {};
export function onPastedNeeds(load: (packages: string[]) => void) {
  pastedNeeds = load;
}

/** The next paste is of the words alone: Ctrl+Shift+V was pressed. */
let plainNext = false;
/** Make the next paste one of the words alone, as Paste words only in a menu does. */
export function pasteWordsNext() {
  plainNext = true;
  setTimeout(() => (plainNext = false), 500);
}
/** Text compared as copied: line ends and a final line break do not count. */
const same = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");

/** Note what is being copied: the selection, or with nothing selected the whole lines, as the editor copies them. */
function noteCopy(view: EditorView) {
  const { state } = view;
  const empty = state.selection.ranges.every((r) => r.empty);
  copiedHere = state.selection.ranges
    .map((r) => (empty ? state.doc.lineAt(r.head).text : state.sliceDoc(r.from, r.to)))
    .join("\n");
}

export const prosePaste: Extension = EditorView.domEventHandlers({
  copy(_event, view) {
    noteCopy(view);
    return false;
  },
  cut(_event, view) {
    noteCopy(view);
    return false;
  },
  keydown(event) {
    // Ctrl+Shift+V pastes the words alone, without their formatting, as in a word processor.
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
      plainNext = true;
      setTimeout(() => (plainNext = false), 500);
    }
    return false;
  },
  paste(event, view) {
    const data = event.clipboardData;
    const text = data?.getData("text/plain") ?? "";
    const plain = plainNext;
    plainNext = false;
    // A picture on its own, such as a screenshot, is added to the project as a figure.
    const picture = [...(data?.files ?? [])].find((f) => /^image\/(png|jpeg)$/.test(f.type));
    if (picture && !text.trim()) {
      event.preventDefault();
      pastedPicture(picture);
      return true;
    }
    if (!text || same(text) === same(copiedHere)) return false;
    const main = view.state.selection.main;
    const doc = view.state.doc.toString();
    if (literalAt(doc, main.from)) return false;
    const inMath = mathAt(doc, main.from);
    const html = data?.getData("text/html") ?? "";
    const inArgument = inGroup(doc, main.from);
    // With its formatting, where a paragraph may begin: not inside a formula or a command's braces.
    const formatted = !plain && html && !inMath && !inArgument && !looksLikeLatex(text) ? formattedPaste(html) : null;
    if (formatted) {
      event.preventDefault();
      view.dispatch({
        changes: { from: main.from, to: main.to, insert: formatted.latex },
        selection: { anchor: main.from + formatted.latex.length },
        userEvent: "input.paste",
        annotations: isolateHistory.of("full"),
        scrollIntoView: true,
      });
      store().notify("Pasted with its formatting, written as LaTeX. Ctrl+Shift+V pastes the words alone.");
      // A package the LaTeX needs, such as hyperref for links, goes in the main file's settings,
      // which may be another file than this one.
      if (formatted.packages.length) pastedNeeds(formatted.packages);
      return true;
    }
    // Only text from a word processor or a web page has a paragraph on each line; code copied
    // from an editor keeps its lines and their indentation.
    const paragraphs = /<(?:p|li|br|h[1-6])[\s>/]/i.test(html);
    const written = pastedText(text, paragraphs, inMath, inArgument);
    if (written === null) return false;
    event.preventDefault();
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: written },
      selection: { anchor: main.from + written.length },
      userEvent: "input.paste",
      annotations: isolateHistory.of("full"),
      scrollIntoView: true,
    });
    if (/[&%$#_{}~^\\]/.test(text)) store().notify("Pasted text: characters LaTeX treats specially, such as % and &, were written so that they print.");
    return true;
  },
});
