// Pasting text from elsewhere, such as Word, a web page or an e-mail: written so that it prints
// as it reads. A % would otherwise hide the rest of the line, and an & or _ stop the compile.
import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { store } from "../../state/store";
import { mathAt } from "./symbols";

/** How each character LaTeX treats specially is written to print as itself. */
const PRINTED: Record<string, string> = {
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "\\": "\\textbackslash{}",
};

/** Whether text reads as LaTeX already: commands with arguments, environments, mathematics. */
export function looksLikeLatex(text: string): boolean {
  return /\\(?:[a-zA-Z]+\*?\s*[{[]|begin\b|end\b|item\b|\\|[a-zA-Z]+\s*$)/m.test(text) || /(?<!\\)\$[^$\n]+(?<!\\)\$/.test(text);
}

/**
 * What to write for text pasted from elsewhere, or null to paste it as it is: text that is
 * LaTeX already, or that goes into mathematics. Text that came with formatting, from a word
 * processor or a web page, has a paragraph on each line, which LaTeX would run together, so
 * each line is made a paragraph of its own.
 */
export function pastedText(text: string, formatted: boolean, inMath: boolean): string | null {
  if (inMath || looksLikeLatex(text) || !/[&%$#_{}~^\\]|\r?\n/.test(text)) return null;
  let out = text.replace(/\r\n?/g, "\n").replace(/[&%$#_{}~^\\]/g, (ch) => PRINTED[ch]);
  if (formatted) {
    out = out
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  return out === text ? null : out;
}

/** The text last copied or cut in the editor, which is LaTeX and is pasted back as it was. */
let copiedHere = "";

export const prosePaste: Extension = EditorView.domEventHandlers({
  copy(_event, view) {
    copiedHere = view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join("\n");
    return false;
  },
  cut(_event, view) {
    copiedHere = view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join("\n");
    return false;
  },
  paste(event, view) {
    const data = event.clipboardData;
    const text = data?.getData("text/plain") ?? "";
    if (!text || text === copiedHere) return false;
    const main = view.state.selection.main;
    const inMath = mathAt(view.state.doc.toString(), main.from);
    const written = pastedText(text, !!data?.getData("text/html"), inMath);
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
