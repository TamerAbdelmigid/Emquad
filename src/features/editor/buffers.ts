// One CodeMirror state per open file, kept while its tab is open so undo history and the cursor
// survive switching tabs. The single EditorView shows whichever state is active.
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from "@codemirror/commands";
import { serverCompletionSource } from "@codemirror/lsp-client";
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { type Diagnostic as CmDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Comment, Diagnostic } from "../../ipc/api";
import { store } from "../../state/store";
import { type Anchor, describe, locate } from "./commentAnchor";
import { commenting, focusComment, placeComments, placedComments } from "./comments";
import { COMMANDS, ENVIRONMENTS, completionAt } from "./latex";
import { lspActive, lspFor } from "./lsp";
import { recheckSpelling, spelling } from "./spell";
import { type Insertion, type Sym, insertion, mathAt } from "./symbols";
import { tableInput, tablePaste } from "./tableEditor";
import { ensurePackage } from "./tableModel";
import { forgetPictures, redrawVisual, visualMode } from "./visual";

const states = new Map<string, EditorState>();
/** Text as last read from or written to disk, to tell whether a buffer has unsaved edits. */
const saved = new Map<string, string>();
let view: EditorView | null = null;
let shownPath: string | null = null;
let handlers = { save: () => {}, compile: () => {}, comment: () => {} };
/** Holds visual mode's extensions, or nothing, in every file's state. */
const visual = new Compartment();
let visualOn = false;
/** Holds the spelling checker's extensions, or nothing. */
const spell = new Compartment();
let spellOn = false;
/** The project's comments, to place in each file as it is opened. */
let comments: Comment[] = [];

/** Change one open file's editor state, whether or not it is the one on screen. */
function apply(path: string, spec: TransactionSpec) {
  const state = shownPath === path && view ? view.state : states.get(path);
  if (!state) return;
  if (shownPath === path && view) view.dispatch(spec);
  else states.set(path, state.update(spec).state);
}

/**
 * Put each comment of a file on its passage. A comment already being followed keeps its place,
 * which is truer than its remembered words while the file has unsaved edits; `afresh` looks
 * every one up again, for text that has just been read from disk.
 */
function place(path: string, afresh: boolean) {
  const state = shownPath === path && view ? view.state : states.get(path);
  if (!state) return;
  const text = state.doc.toString();
  const followed = new Map(afresh ? [] : placedComments(state).map((p) => [p.id, p]));
  const placed = comments
    .filter((c) => c.path === path)
    .flatMap((c) => {
      const at = followed.get(c.id) ?? locate(text, c);
      return at ? [{ id: c.id, from: at.from, to: at.to, quiet: c.resolved }] : [];
    });
  apply(path, { effects: placeComments.of(placed) });
}

export function setHandlers(h: typeof handlers) {
  handlers = h;
}

const highlight = HighlightStyle.define([
  { tag: [t.tagName, t.keyword], color: "var(--k)" },
  { tag: [t.atom, t.number, t.string, t.variableName], color: "var(--m)" },
  { tag: t.comment, color: "#70747B", fontStyle: "italic" },
  { tag: t.bracket, color: "var(--scr-dim)" },
  { tag: t.invalid, color: "#FF8A6B" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--scr-tx)", backgroundColor: "transparent", fontSize: "var(--editor-size, 13px)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.85", overflow: "auto", scrollbarWidth: "thin", scrollbarColor: "#3A3D43 transparent" },
    ".cm-content": { padding: "12px 0 16px", caretColor: "var(--acc)" },
    ".cm-line": { padding: "0 18px 0 6px" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--scr-num)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "44px" },
    ".cm-activeLine": { backgroundColor: "var(--scr-cur)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--scr-cur)", color: "var(--acc)" },
    ".cm-cursor": { borderLeftColor: "var(--acc)", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "#2F3F6B" },
    ".cm-selectionMatch": { backgroundColor: "#3A3D43" },
    ".cm-matchingBracket": { backgroundColor: "#3A3D43", outline: "1px solid #5C5F66" },
    ".cm-tooltip": { backgroundColor: "#1B1D21", color: "var(--scr-tx)", border: "1px solid #34373D", borderRadius: "8px", overflow: "hidden" },
    ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px", fontFamily: "var(--mono)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--acc)", color: "#fff" },
    ".cm-panels": { backgroundColor: "var(--scr-cur)", color: "var(--scr-tx)", borderTop: "1px solid var(--scr-line)" },
    ".cm-panel input, .cm-panel button": { fontFamily: "var(--ui)", fontSize: "12px" },
    ".cm-textfield": { backgroundColor: "#0D0E10", color: "var(--scr-tx)", border: "1px solid #34373D", borderRadius: "6px" },
    ".cm-button": { backgroundImage: "none", backgroundColor: "#2A2D33", color: "var(--scr-tx)", border: "1px solid #34373D", borderRadius: "6px" },
    ".cm-diagnostic": { fontFamily: "var(--ui)", fontSize: "12.5px" },
  },
  { dark: true },
);

function complete(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const request = completionAt(line.text.slice(0, context.pos - line.from));
  if (!request) return null;
  if (request.kind === "command" && request.typed === "" && !context.explicit) return null;
  const { labels, citeKeys } = store().index;
  const pool = {
    command: COMMANDS,
    environment: ENVIRONMENTS,
    label: labels,
    cite: citeKeys,
  }[request.kind];
  return {
    from: line.from + request.from,
    options: pool.map((label) => ({ label, type: request.kind === "command" ? "keyword" : "variable" })),
    validFor: /^[\w:.*-]*$/,
  };
}

/** After "\begin{env}" + Enter, add the matching "\end{env}" and put the cursor between them. */
function closeEnvironment(v: EditorView): boolean {
  const { state } = v;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const before = line.text.slice(0, range.head - line.from);
  const match = /^(\s*).*\\begin\{([^}]+)\}\s*$/.exec(before);
  if (!match || line.text.slice(range.head - line.from).trim() !== "") return false;
  const [, indent, env] = match;
  const rest = state.doc.sliceString(range.head, Math.min(state.doc.length, range.head + 2000));
  const opens = rest.split(`\\begin{${env}}`).length - 1;
  const closes = rest.split(`\\end{${env}}`).length - 1;
  if (closes > opens) return false;
  const inner = `\n${indent}  `;
  v.dispatch({
    changes: { from: range.head, insert: `${inner}\n${indent}\\end{${env}}` },
    selection: EditorSelection.cursor(range.head + inner.length),
    userEvent: "input",
  });
  return true;
}

function extensions(path: string): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    search({ top: false }),
    lintGutter(),
    StreamLanguage.define(stex),
    syntaxHighlighting(highlight),
    // With the language server, completion comes from it; without, from the built-in lists.
    autocompletion({ override: [lspActive() ? serverCompletionSource : complete] }),
    lspFor(path),
    visual.of(visualOn ? visualMode : []),
    spell.of(spellOn ? spelling : []),
    commenting,
    tablePaste,
    EditorView.lineWrapping,
    theme,
    keymap.of([
      { key: "Mod-s", run: () => (handlers.save(), true) },
      { key: "Mod-Enter", run: () => (handlers.compile(), true) },
      { key: "Mod-Alt-m", run: () => (handlers.comment(), true) },
      { key: "Enter", run: closeEnvironment },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const dirty = update.state.doc.toString() !== saved.get(path);
        const s = store();
        if (s.tabs.some((tab) => tab.path === path && tab.dirty !== dirty)) {
          s.set({ tabs: s.tabs.map((tab) => (tab.path === path ? { ...tab, dirty } : tab)) });
        }
      }
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        store().set({ cursor: { line: line.number, column: head - line.from + 1 }, selecting: !update.state.selection.main.empty });
      }
    }),
  ];
}

export const buffers = {
  has: (path: string) => states.has(path),

  /** Switch every open file between plain source and visual mode. */
  setVisual(on: boolean) {
    if (on === visualOn) return;
    visualOn = on;
    const effects = visual.reconfigure(on ? visualMode : []);
    for (const path of states.keys()) apply(path, { effects });
  },

  /** Draw visual mode again: the references or the pictures changed, not the text. */
  redrawVisual() {
    if (visualOn) for (const path of states.keys()) apply(path, { effects: redrawVisual.of(null) });
  },

  /** Picture files changed: read them again where visual mode shows them. */
  picturesChanged() {
    forgetPictures();
    buffers.redrawVisual();
  },

  /** Switch the spelling checker on or off in every open file, or check again after it changed. */
  setSpelling(on: boolean) {
    const effects = on === spellOn ? [recheckSpelling.of(null)] : [spell.reconfigure(on ? spelling : [])];
    spellOn = on;
    for (const path of states.keys()) apply(path, { effects });
  },

  /** Show these comments on their passages in every open file. */
  setComments(all: Comment[]) {
    comments = all;
    for (const path of states.keys()) place(path, false);
  },

  /** Where each comment of a file sits now, for the ones whose passage still exists. */
  commentAnchors(path: string): (Anchor & { id: string })[] {
    const state = buffers.current(path);
    if (!state) return [];
    const text = state.doc.toString();
    return placedComments(state)
      .filter((p) => p.to > p.from)
      .map((p) => ({ id: p.id, ...describe(text, p.from, p.to) }));
  },

  /** The selected passage of the file on screen, described so a comment can be put on it. */
  selectionAnchor(): { path: string; anchor: Anchor } | null {
    if (!view || !shownPath) return null;
    const { from, to } = view.state.selection.main;
    if (from === to) return null;
    return { path: shownPath, anchor: describe(view.state.doc.toString(), from, to) };
  },

  /** Pick a comment out and bring its passage into view. False when it has no place here. */
  showComment(id: string | null): boolean {
    for (const path of states.keys()) if (path !== shownPath) apply(path, { effects: focusComment.of(id) });
    if (!view || !shownPath) return false;
    const at = placedComments(view.state).find((p) => p.id === id && p.to > p.from);
    view.dispatch({
      effects: at ? [focusComment.of(id), EditorView.scrollIntoView(at.from, { y: "center" })] : [focusComment.of(id)],
    });
    return Boolean(at);
  },

  open(path: string, text: string) {
    saved.set(path, text);
    states.set(path, EditorState.create({ doc: text, extensions: extensions(path) }));
    place(path, true);
  },

  close(path: string) {
    states.delete(path);
    saved.delete(path);
    if (shownPath === path) shownPath = null;
  },

  closeAll() {
    states.clear();
    saved.clear();
    shownPath = null;
  },

  /** Follow a file that was renamed or moved. */
  rename(from: string, to: string) {
    const state = buffers.current(from);
    if (!state) return;
    const text = state.doc.toString();
    const wasSaved = saved.get(from);
    buffers.close(from);
    buffers.open(to, text);
    if (wasSaved !== undefined) saved.set(to, wasSaved);
  },

  current(path: string): EditorState | undefined {
    return shownPath === path && view ? view.state : states.get(path);
  },

  text: (path: string) => buffers.current(path)?.doc.toString(),

  markSaved(path: string, text: string) {
    saved.set(path, text);
  },

  /** Replace a buffer's content, for example after the file changed on disk. */
  replace(path: string, text: string) {
    const state = buffers.current(path);
    if (!state || state.doc.toString() === text) return saved.set(path, text);
    saved.set(path, text);
    apply(path, { changes: { from: 0, to: state.doc.length, insert: text } });
    place(path, true);
  },

  attach(parent: HTMLElement) {
    view = new EditorView({ parent, state: EditorState.create({ doc: "" }) });
    shownPath = null;
    return () => {
      buffers.stash();
      view?.destroy();
      view = null;
    };
  },

  /** Keep the visible state before the view shows something else. */
  stash() {
    if (view && shownPath && states.has(shownPath)) states.set(shownPath, view.state);
  },

  show(path: string | null) {
    if (!view || path === shownPath) return;
    buffers.stash();
    shownPath = path;
    const state = path ? states.get(path) : undefined;
    view.setState(state ?? EditorState.create({ doc: "" }));
    if (state) view.focus();
  },

  goToLine(line: number) {
    if (!view) return;
    const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
    view.dispatch({
      selection: EditorSelection.cursor(target.from),
      effects: EditorView.scrollIntoView(target.from, { y: "center" }),
    });
    view.focus();
  },

  run(command: (v: EditorView) => boolean) {
    if (view) {
      command(view);
      view.focus();
    }
  },

  /** Wrap the selection, or insert a snippet with the cursor between `before` and `after`. */
  insert(before: string, after = "") {
    if (!view || !shownPath) return;
    const range = view.state.selection.main;
    const selected = view.state.sliceDoc(range.from, range.to);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: before + selected + after },
      selection: EditorSelection.range(range.from + before.length, range.from + before.length + selected.length),
      userEvent: "input",
    });
    view.focus();
  },

  /**
   * Put in a short piece of LaTeX that belongs in a line of text, around the selection: into the
   * table cell being worked on, if there is one, else at the cursor. `make` is told whether the
   * place is inside a formula and what character comes after it. A package it needs is added to
   * the preamble, and the user told.
   */
  insertInline(make: (inMath: boolean, next: string) => Insertion) {
    if (tableInput.insert(make)) return;
    if (!view || !shownPath) return;
    const state = view.state;
    const range = state.selection.main;
    const text = state.doc.toString();
    const ins = make(mathAt(text, range.from), text.slice(range.to, range.to + 1));
    const selected = state.sliceDoc(range.from, range.to);
    const changes = [{ from: range.from, to: range.to, insert: ins.before + selected + ins.after }];
    let shift = 0;
    if (ins.pkg) {
      const need = ensurePackage(text, ins.pkg);
      if (typeof need === "object" && (need.to <= range.from || need.from >= range.to)) {
        // A package line that goes in where the cursor is goes in before what was chosen.
        if (need.to <= range.from) {
          changes.unshift(need);
          shift = need.insert.length;
        } else changes.push(need);
        store().notify(`Added \\usepackage{${ins.pkg}} to the preamble. What you chose needs it.`);
      } else if (need === "no-preamble") {
        store().notify(`This needs \\usepackage{${ins.pkg}}. This file has no preamble, so add it to your main file's.`, true);
      }
    }
    const from = range.from + shift + ins.before.length;
    view.dispatch({
      changes,
      selection: EditorSelection.range(from, from + selected.length),
      userEvent: "input",
      annotations: isolateHistory.of("full"),
      scrollIntoView: true,
    });
    view.focus();
  },

  /** Put in a symbol, written the way the place it goes needs. */
  insertSymbol(sym: Sym) {
    buffers.insertInline((inMath, next) => insertion(sym, inMath, next));
  },

  /** Bold, italic and the like: on the selected cells of a table being worked on, else around the selection. */
  format(name: string) {
    if (tableInput.format(name)) return;
    buffers.insert(`\\${name}{`, "}");
  },

  /** Show compile errors and warnings in every open file they belong to. */
  setDiagnostics(all: Diagnostic[]) {
    for (const path of states.keys()) {
      const state = buffers.current(path);
      if (!state) continue;
      const mine: CmDiagnostic[] = all
        .filter((d) => d.file === path && d.line > 0 && d.line <= state.doc.lines)
        .map((d) => {
          const line = state.doc.line(d.line);
          return {
            from: line.from,
            to: Math.max(line.to, line.from),
            severity: d.severity === "error" ? "error" : "warning",
            message: d.message,
          };
        });
      const spec = setDiagnostics(state, mine);
      if (shownPath === path && view) view.dispatch(spec);
      else states.set(path, state.update(spec).state);
    }
  },
};
