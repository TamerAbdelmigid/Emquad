// One CodeMirror state per open file, kept while its tab is open so undo history and the cursor
// survive switching tabs. The single EditorView shows whichever state is active.
import { pasteWordsNext, prosePaste } from "./paste";
import {
  autocompletion,
  closeBrackets,
  closeCompletion,
  completionStatus,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, redo, undo } from "@codemirror/commands";
import { serverCompletionSource } from "@codemirror/lsp-client";
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { type Diagnostic as CmDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension, Transaction, type TransactionSpec } from "@codemirror/state";
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
import { type Anchor, describe, locate, relocate } from "./commentAnchor";
import { commenting, focusComment, placeComments, placedComments, setSaid, showBalloons } from "./comments";
import type { Fix, Help } from "./errorHelp";
import { COMMANDS, ENVIRONMENTS, completionAt, setHeading, toggleCommand } from "./latex";
import { lspActive, lspFor } from "./lsp";
import { recheckSpelling, spelling } from "./spell";
import { type Insertion, type Sym, insertion, mathAt, placeInsertion } from "./symbols";
import { tableInput, tablePaste } from "./tableEditor";
import { ensurePackage, packageNotice } from "./tableModel";
import { type PageLayout, applyListEdit, changesShown, forgetBlocks, showChanges, drawingStale, forgetPictures, pageFurniture, redrawVisual, setLatexMarks, setPageBreaks, visualMode, visualPage } from "./visual";
import { setPictureWidth, setPlacement } from "./floats";
import type { PageChange } from "./trackChanges";
import { blockAround, fromOtherSide, linkedBlock, linkedIn, setLinked } from "./split";
import { documentStart } from "./visualModel";
import { type Alignment, type BlockStyle, alignmentAt, setAlignment, setBlockStyle } from "./blocks";
import { type Need, type Restyled, type TextChange, clearFormatting, formatAt, headOf, needsOf, paintFormat, plainWrapSafe, setColour, toggleFormat, wordAt } from "./formatting";
import { type ListEdit, type ListKind, indentItem, outdentItem, setNumbering, toggleList } from "./lists";

const states = new Map<string, EditorState>();
/** Text as last read from or written to disk, to tell whether a buffer has unsaved edits. */
const saved = new Map<string, string>();
let view: EditorView | null = null;
let shownPath: string | null = null;
/** The LaTeX beside the page, when the two are shown side by side: the same text, in plain source. */
let source: EditorView | null = null;
/** A change one side made and passes to the other, which must not pass it back. */
let handlers = { save: () => {}, compile: () => {}, comment: () => {}, equation: () => {}, link: () => {} };
/** Holds visual mode's extensions, or nothing, in every file's state. */
const visual = new Compartment();
let visualOn = false;
/** Visual mode draws the page view rather than the draft view. */
let pageOn = true;
const visualExtension = () => (visualOn ? (pageOn ? visualPage : visualMode) : []);
/** Holds the spelling checker's extensions, or nothing. */
const spell = new Compartment();
let spellOn = false;
/** Files whose visual drawing is out of date, drawn again when they are next shown. */
const redrawWhenShown = new Set<string>();
/** The project's comments, to place in each file as it is opened. */
let comments: Comment[] = [];

/** What the app does with the packages and colour names a formatting tool's commands need. */
let formatNeeds: (needs: Need[]) => void = () => {};
export function onFormatNeeds(load: (needs: Need[]) => void) {
  formatNeeds = load;
}
/** The formatting the format painter holds, or null when it holds none, and the selection it was copied from. */
let painted: string[] | null = null;
let paintedFrom: { from: number; to: number } | null = null;

/** The selection on screen, or the word the cursor is in, or the cursor. */
function selectionOrWord(): { from: number; to: number } | null {
  if (!view || !shownPath) return null;
  const { from, to, empty } = view.state.selection.main;
  return empty ? (wordAt(view.state.doc.toString(), from) ?? { from, to }) : { from, to };
}

/** Make a formatting change, the same text selected after it, and load what its commands need. */
function restyle(done: Restyled) {
  if (!view) return;
  if (done.changes.length) view.dispatch({ changes: done.changes, selection: EditorSelection.range(done.select.from, done.select.to), userEvent: "input", scrollIntoView: true });
  view.focus();
  formatNeeds(needsOf(done.heads));
}

/** Make a list tool's change, or say why there is none. */
function listEdit(edit: ListEdit | null, why: string) {
  if (!view) return;
  if (!applyListEdit(view, edit)) store().notify(why, true);
  view.focus();
}

/** Make a paragraph tool's change, keeping the cursor in its words. */
function blockChange(changes: TextChange[]) {
  view?.dispatch({ changes, userEvent: "input", scrollIntoView: true });
}

/** Change one open file's editor state, whether or not it is the one on screen. */
function apply(path: string, spec: TransactionSpec) {
  const state = shownPath === path && view ? view.state : states.get(path);
  if (!state) return;
  if (shownPath === path && view) return view.dispatch(spec);
  const next = state.update(spec).state;
  states.set(path, next);
  // A file not on screen has no editor to see the change: its tab is marked here, so that it is
  // saved with the others.
  if (next.doc !== state.doc) markDirty(path, next.doc.toString() !== saved.get(path));
}

/** Show whether a file has changes not saved, on its tab. */
function markDirty(path: string, dirty: boolean) {
  const s = store();
  if (s.tabs.some((tab) => tab.path === path && tab.dirty !== dirty)) {
    s.set({ tabs: s.tabs.map((tab) => (tab.path === path ? { ...tab, dirty } : tab)) });
  }
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
      // Its own words first; failing those, the words that were either side of them.
      const at = followed.get(c.id) ?? locate(text, c) ?? relocate(text, c);
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
    visual.of(visualExtension()),
    pageFurniture,
    linkedBlock,
    spell.of(spellOn ? spelling : []),
    commenting,
    tablePaste,
    prosePaste,
    EditorView.lineWrapping,
    theme,
    keymap.of([
      { key: "Mod-s", run: () => (handlers.save(), true) },
      { key: "Mod-Enter", run: () => (handlers.compile(), true) },
      { key: "Mod-Alt-m", run: () => (handlers.comment(), true) },
      // As in Word: Alt+= opens the equation editor.
      { key: "Alt-=", run: () => (handlers.equation(), true) },
      // As in Word: Ctrl+K puts in a link.
      { key: "Mod-k", run: () => (handlers.link(), true) },
      // As in a word processor. Before the default keys, where Ctrl+I selects the enclosing syntax.
      { key: "Mod-b", run: () => (buffers.format("textbf"), true) },
      { key: "Mod-i", run: () => (buffers.format("textit"), true) },
      { key: "Mod-u", run: () => (buffers.format("underline"), true) },
      // Word's keys for subscript, superscript and the format painter.
      { key: "Mod-=", run: () => (buffers.format("textsubscript"), true) },
      { key: "Mod-+", run: () => (buffers.format("textsuperscript"), true) },
      { key: "Mod-Shift-=", run: () => (buffers.format("textsuperscript"), true) },
      // The painter paints in the page view, where its second half is.
      { key: "Mod-Shift-c", run: () => visualOn && pageOn && (buffers.copyFormat(), true) },
      { key: "Enter", run: closeEnvironment },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) markDirty(path, update.state.doc.toString() !== saved.get(path));
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        store().set({ cursor: { line: line.number, column: head - line.from + 1 }, selecting: !update.state.selection.main.empty });
      }
    }),
  ];
}

/** The LaTeX beside the page: the text on screen, as plain source with line numbers. */
function sourceState(): EditorState {
  return EditorState.create({
    doc: view?.state.doc ?? "",
    selection: { anchor: Math.min(view?.state.selection.main.head ?? 0, view?.state.doc.length ?? 0) },
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      StreamLanguage.define(stex),
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      theme,
      linkedBlock,
      EditorView.editorAttributes.of({ class: "cm-latex-side" }),
      keymap.of([
        // One history, the page's: undo here undoes there, and the change comes back here.
        { key: "Mod-z", run: () => (view ? undo(view) : false) },
        { key: "Mod-y", run: () => (view ? redo(view) : false) },
        { key: "Mod-Shift-z", run: () => (view ? redo(view) : false) },
        { key: "Mod-s", run: () => (handlers.save(), true) },
        { key: "Mod-Enter", run: () => (handlers.compile(), true) },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
    ],
  });
}

/**
 * Pass what one side did to the other: its edits, as edits of the plain text (never filtered as
 * typing on the page is, since they are typed as LaTeX), and the paragraph its cursor is in, lit.
 */
function mirror(trs: readonly Transaction[], from: EditorView, to: EditorView | null) {
  if (!to) return;
  for (const tr of trs) {
    if (tr.annotation(fromOtherSide)) continue;
    if (tr.docChanged) {
      // As the edit was made, so that typing a word is one step to undo and is drawn as typing.
      const userEvent = tr.annotation(Transaction.userEvent);
      to.dispatch({ changes: tr.changes, annotations: fromOtherSide.of(true), ...(userEvent ? { userEvent } : {}) });
      // Typing in the LaTeX does not ask the page for completions.
      if (to === view && completionStatus(to.state)) closeCompletion(to);
    }
    if (tr.selection || tr.docChanged) {
      const block = blockAround(from.state.doc, from.state.selection.main.head);
      const was = linkedIn(to.state);
      if (!was || was.from !== block.from || was.to !== block.to) {
        to.dispatch({ effects: [setLinked.of(block), EditorView.scrollIntoView(block.from, { y: "nearest" })], annotations: fromOtherSide.of(true) });
      }
    }
  }
}

export const buffers = {
  has: (path: string) => states.has(path),

  /** Switch every open file between plain source and visual mode, in the page or the draft view. */
  setVisual(on: boolean, page = pageOn) {
    if (on === visualOn && page === pageOn) return;
    visualOn = on;
    pageOn = page;
    const effects = visual.reconfigure(visualExtension());
    for (const path of states.keys()) apply(path, { effects });
  },

  /** Make a change to an open file, as one step of its undo history. */
  change(path: string, changes: { from: number; to?: number; insert: string } | { from: number; to?: number; insert: string }[]) {
    apply(path, { changes, userEvent: "input", annotations: isolateHistory.of("full") });
  },

  /** Draw visual mode again: the references or the pictures changed, not the text. */
  redrawVisual() {
    if (!visualOn) return;
    // Only the file on screen is drawn now; the others when they are next shown.
    if (shownPath && view) view.dispatch({ effects: redrawVisual.of(null) });
    for (const path of states.keys()) if (path !== shownPath) redrawWhenShown.add(path);
  },

  /** There is a new PDF: draw the blocks of LaTeX drawn from it again. */
  newPdf() {
    forgetBlocks();
    buffers.redrawVisual();
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
    const byId = new Map(all.map((c) => [c.id, c]));
    setSaid((id) => {
      const c = byId.get(id);
      return c && { id, author: c.authorName, text: c.text, replies: c.replies.length };
    });
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

  /** Where the cursor is in the file on screen, or null when none is shown. */
  cursorAt(): number | null {
    return view && shownPath ? view.state.selection.main.head : null;
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
    // The cursor starts where the writing does: past the settings at the top, so they stay
    // folded away in visual mode until they are wanted.
    const body = documentStart(text);
    const start = body < 0 ? 0 : text.indexOf("\n", body) + 1 || text.length;
    states.set(path, EditorState.create({ doc: text, selection: { anchor: start }, extensions: extensions(path) }));
    if (!store().balloons) apply(path, { effects: showBalloons.of(false) });
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
    view = new EditorView({
      parent,
      state: EditorState.create({ doc: "" }),
      dispatchTransactions: (trs, v) => {
        v.update(trs);
        if (v === view) mirror(trs, v, source);
      },
    });
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
    source?.setState(sourceState());
    // A page lights the LaTeX's paragraph only while the LaTeX is beside it.
    if (!source && linkedIn(view.state)) view.dispatch({ effects: setLinked.of(null) });
    const outOfDate = path ? redrawWhenShown.delete(path) : false;
    if (path && visualOn && (outOfDate || drawingStale(view.state))) view.dispatch({ effects: redrawVisual.of(null) });
    if (state) view.focus();
  },

  /**
   * Show the LaTeX of the file on screen beside the page, in `parent`: the same text, edited on
   * either side, with one history (the page's), and the paragraph the cursor is in lit on the
   * other side. Gives what takes it away again.
   */
  attachSource(parent: HTMLElement) {
    source = new EditorView({
      parent,
      state: sourceState(),
      dispatchTransactions: (trs, v) => {
        v.update(trs);
        if (v === source && view) mirror(trs, v, view);
      },
    });
    const attached = source;
    return () => {
      if (source === attached) source = null;
      attached.destroy();
      // The page lights nothing once the LaTeX is gone.
      view?.dispatch({ effects: setLinked.of(null) });
    };
  },

  /** The LaTeX beside the page, when it is shown. */
  sourceView(): EditorView | null {
    return source;
  },

  /** Show an open file now, and give the editor that shows it. */
  showNow(path: string): EditorView | null {
    if (!states.has(path) && path !== shownPath) return null;
    buffers.show(path);
    return view;
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

  /** The place in the file on screen at a point of the window, or null when the point is not over its text. */
  placeAt(x: number, y: number): number | null {
    if (!view || !shownPath) return null;
    const box = view.dom.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
    return view.posAtCoords({ x, y }, false);
  },

  /**
   * Put a block, such as a figure, on lines of its own: on the line the place is on when that is
   * empty, else after it. The place is the cursor unless given. `caret` is where in the block
   * the cursor goes.
   */
  insertBlock(text: string, caret: number, at?: number) {
    if (!view || !shownPath) return;
    const line = view.state.doc.lineAt(at ?? view.state.selection.main.head);
    const block = text.replace(/\n$/, "");
    // An empty line takes the block in its place; a line with text keeps it, and the block follows.
    const empty = line.text.trim() === "";
    const from = empty ? line.from : line.to;
    const insert = empty ? block : `\n${block}`;
    // Never past the end of the file, as the block may be its last line.
    const length = view.state.doc.length - (line.to - from) + insert.length;
    view.dispatch({
      changes: { from, to: line.to, insert },
      selection: { anchor: Math.min(from + (empty ? 0 : 1) + caret, length) },
      userEvent: "input",
      annotations: isolateHistory.of("full"),
      scrollIntoView: true,
    });
    view.focus();
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
    const text = state.doc.toString();
    const placed = placeInsertion(text, state.selection.main.from, state.selection.main.to, make);
    const range = { from: placed.from, to: placed.to };
    const ins = placed.ins;
    const selected = state.sliceDoc(range.from, range.to);
    const changes = [{ from: range.from, to: range.to, insert: ins.before + selected + ins.after }];
    let shift = 0;
    if (ins.pkg) {
      const need = ensurePackage(text, ins.pkg, store().index.stylePackages);
      if (typeof need === "object" && (need.to <= range.from || need.from >= range.to)) {
        // A package line that goes in where the cursor is goes in before what was chosen.
        if (need.to <= range.from) {
          changes.unshift(need);
          shift = need.insert.length;
        } else changes.push(need);
        store().notify(`Added \\usepackage{${ins.pkg}} to the preamble. What you chose needs it.`);
      } else if (typeof need !== "object" && need !== "present") {
        store().notify(packageNotice(ins.pkg, need)!, true);
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

  /** Show the comments as balloons beside the page in every open file, or not. */
  setBalloons(on: boolean) {
    for (const path of states.keys()) apply(path, { effects: showBalloons.of(on) });
  },

  /** Draw the changes since a snapshot on a file's page, or stop (null). */
  showChanges(path: string, shown: { since: string; changes: PageChange[] } | null) {
    apply(path, { effects: showChanges.of(shown) });
  },

  /** The snapshot whose changes the file on screen shows, and how many are left. */
  changesShown(): { since: string; count: number } | null {
    return view && shownPath ? changesShown(view.state) : null;
  },

  /** Put `text` in place of the selection, or at the cursor, as one step of undo. */
  replaceSelection(text: string) {
    if (!view || !shownPath) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input", annotations: isolateHistory.of("full"), scrollIntoView: true });
    view.focus();
  },

  /** The words selected in the file on screen, as written. */
  selectedText(): string {
    if (!view || !shownPath) return "";
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  },

  /** Where the last compile broke a file's pages, and what its header and footer print. */
  setPages(path: string, pages: PageLayout) {
    apply(path, { effects: setPageBreaks.of(pages) });
  },

  /** Ask LaTeX to place the figure or table at the cursor as `placement` says ("htbp", "H" and so on). */
  placement(placement: string) {
    if (!view || !shownPath) return;
    const set = setPlacement(view.state.doc.toString(), view.state.selection.main.head, placement);
    if (!set) return store().notify("Put the cursor in a figure or a table first.", true);
    view.dispatch({ changes: set.changes, userEvent: "input", scrollIntoView: true });
    view.focus();
    if (set.needs.length) formatNeeds(set.needs.map((name) => ({ kind: "package", name, why: "which keeps a figure or table exactly where it is written" })));
  },

  /** Make the picture in the figure at the cursor `share` of the line wide. */
  pictureWidth(share: number) {
    if (!view || !shownPath) return;
    const changes = setPictureWidth(view.state.doc.toString(), view.state.selection.main.head, share);
    if (!changes) return store().notify("This figure holds several pictures, or none; change their sizes in its LaTeX (Ctrl+/).", true);
    view.dispatch({ changes, userEvent: "input", scrollIntoView: true });
    view.focus();
  },

  /** Put in a symbol, written the way the place it goes needs. */
  insertSymbol(sym: Sym) {
    buffers.insertInline((inMath, next) => insertion(sym, inMath, next));
  },

  /**
   * Bold, italic, strikethrough and the like: on the selected cells of a table being worked on;
   * else on the selected words, as Word does it: taken off when every word has it, put on all
   * of them otherwise, with every command kept whole. With nothing selected, the group the
   * cursor is in comes out of it, or an empty one goes in for typing. The packages it needs are
   * loaded.
   */
  format(name: string) {
    if (tableInput.format(name)) return formatNeeds(needsOf([headOf(name)]));
    if (!view || !shownPath) return;
    const range = view.state.selection.main;
    const text = view.state.doc.toString();
    const restyled = range.empty ? null : toggleFormat(text, range.from, range.to, name);
    if (restyled) return restyle(restyled);
    // Where the text around cannot be read as runs of words, the selection is put in the
    // command's braces only when that cannot break anything.
    // soul's and ulem's commands do not work in a formula.
    if (/^(?:hl|sout|uline)$/.test(name) && mathAt(text, range.from)) {
      store().notify("Highlight and strikethrough cannot be used inside a formula.", true);
      return view.focus();
    }
    if (!range.empty && !plainWrapSafe(text, range.from, range.to)) {
      store().notify("This selection cannot be formatted as it stands: it crosses a formula, a comment or the edge of a command or environment. Select less, or press Ctrl+/ to change the LaTeX.", true);
      return view.focus();
    }
    const done = toggleCommand(text, range.from, range.to, name);
    view.dispatch({ changes: done.changes, selection: EditorSelection.range(done.select.from, done.select.to), userEvent: "input", scrollIntoView: true });
    view.focus();
    if (done.changes.some((c) => c.insert.includes(headOf(name)))) formatNeeds(needsOf([headOf(name)]));
  },

  /** Font colour: the selection, or the word at the cursor, in a colour of the palette; null takes the colour off. */
  colour(name: string | null) {
    const target = selectionOrWord();
    if (!view || !target) return;
    const text = view.state.doc.toString();
    const restyled = target.from < target.to ? setColour(text, target.from, target.to, name) : null;
    if (restyled) return restyle(restyled);
    if (name && target.from === target.to) return buffers.format(`textcolor{${name}}`);
    store().notify("A colour can be given to words in the text, not here.", true);
  },

  /** Clear formatting: every formatting command taken off the selection, or the word at the cursor. */
  clearFormatting() {
    const target = selectionOrWord();
    if (!view || !target || target.from === target.to) return;
    const restyled = clearFormatting(view.state.doc.toString(), target.from, target.to);
    if (restyled) restyle(restyled);
  },

  /**
   * The format painter: copy the formatting at the cursor. The next text selected (by the mouse,
   * or with Shift and the arrow keys) is given it, by `paint`.
   */
  copyFormat() {
    if (!view || !shownPath) return;
    painted = formatAt(view.state.doc.toString(), view.state.selection.main.head);
    paintedFrom = { from: view.state.selection.main.from, to: view.state.selection.main.to };
    store().set({ painting: true });
    store().notify(painted.length ? "Now select the text to give this formatting to. Esc cancels." : "No formatting here: the text you select next will be made plain. Esc cancels.");
    view.focus();
  },

  /** Give the selection the formatting the painter holds, if it holds any. True when it did. */
  paint(): boolean {
    if (!painted || !view || view.state.selection.main.empty) return false;
    const { from, to } = view.state.selection.main;
    // The selection the formatting was copied from is not the next one.
    if (paintedFrom && paintedFrom.from === from && paintedFrom.to === to) return false;
    const heads = painted;
    buffers.stopPainting();
    const restyled = paintFormat(view.state.doc.toString(), from, to, heads);
    if (restyled) restyle(restyled);
    return true;
  },

  stopPainting() {
    painted = null;
    if (store().painting) store().set({ painting: false });
  },

  /** The Bullets or Numbering button, on the paragraphs or list items of the selection. */
  list(kind: ListKind) {
    if (!view || !shownPath) return;
    const { from, to } = view.state.selection.main;
    listEdit(toggleList(view.state.doc.toString(), from, to, kind), "Lists are made of paragraphs of text: there is none here to make one of.");
  },

  /** A numbering format from the Numbering menu, for the list the cursor is in or a new one. */
  numbering(format: string) {
    if (!view || !shownPath) return;
    const { from, to } = view.state.selection.main;
    listEdit(setNumbering(view.state.doc.toString(), from, to, format), "Numbering is for paragraphs of text: there is none here to number.");
  },

  /** Increase or decrease indent: a list item one level down or up. */
  indent(by: 1 | -1) {
    if (!view || !shownPath) return;
    const at = view.state.selection.main.head;
    const text = view.state.doc.toString();
    listEdit(by > 0 ? indentItem(text, at) : outdentItem(text, at), "Indent moves a list item between levels. Put the cursor in a list item first.");
  },

  /** Align the paragraphs of the selection. */
  align(alignment: Alignment) {
    if (!view || !shownPath) return;
    const { from, to } = view.state.selection.main;
    const text = view.state.doc.toString();
    const changes = setAlignment(text, from, to, alignment);
    if (changes) blockChange(changes);
    else if (alignment !== alignmentAt(text, from)) store().notify("This cannot be aligned on its own: alignment is for paragraphs of text, outside formulas and tables.", true);
    view.focus();
  },

  /** Set the paragraphs of the selection as a quotation or the abstract; null takes that style off. */
  blockStyle(style: BlockStyle | null) {
    if (!view || !shownPath) return;
    const { from, to } = view.state.selection.main;
    const changes = setBlockStyle(view.state.doc.toString(), from, to, style);
    if (changes) blockChange(changes);
    else if (style) store().notify("This cannot be set as a quotation or an abstract: the styles are for paragraphs of text.", true);
    view.focus();
  },

  /** Show or hide LaTeX marks in the page view of every open file. */
  setMarks(on: boolean) {
    setLatexMarks(on);
    buffers.redrawVisual();
  },

  /** Where the selection is on screen, for the toolbar over it; null with nothing selected. */
  selectionBox(): { left: number; right: number; top: number; bottom: number } | null {
    if (!view || !shownPath) return null;
    const { from, to, empty } = view.state.selection.main;
    if (empty) return null;
    const start = view.coordsAtPos(from, 1);
    const end = view.coordsAtPos(to, -1);
    if (!start || !end) return null;
    return { left: Math.min(start.left, end.left), right: Math.max(start.right, end.right), top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) };
  },

  /** Where the cursor is on screen, for a menu opened from the keyboard. */
  cursorBox(): { left: number; right: number; top: number; bottom: number } | null {
    if (!view || !shownPath) return null;
    return view.coordsAtPos(view.state.selection.main.head);
  },

  /** A right-click: the cursor goes where it was made, unless that is inside the selection. */
  placeCursorUnlessSelected(x: number, y: number) {
    if (!view || !shownPath || (!x && !y)) return;
    const at = view.posAtCoords({ x, y });
    const { from, to } = view.state.selection.main;
    if (at !== null && (at < from || at > to)) view.dispatch({ selection: { anchor: at }, userEvent: "select.pointer" });
    view.focus();
  },

  /** Cut or copy the selection, as Ctrl+X and Ctrl+C do. */
  clipboard(action: "cut" | "copy") {
    if (!view) return;
    view.focus();
    document.execCommand(action);
  },

  /** Paste what is on the clipboard at the cursor, as Ctrl+V does, or the words alone, as Ctrl+Shift+V. */
  async paste(wordsOnly: boolean) {
    if (!view) return;
    const target = view;
    const data = new DataTransfer();
    try {
      for (const item of await navigator.clipboard.read()) {
        for (const type of item.types) if (type === "text/plain" || type === "text/html") data.setData(type, await (await item.getType(type)).text());
      }
    } catch {
      data.setData("text/plain", await navigator.clipboard.readText().catch(() => ""));
    }
    if (!data.getData("text/plain")) return store().notify("There is no text on the clipboard to paste.", true);
    target.focus();
    if (wordsOnly) pasteWordsNext();
    target.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  },

  /** Make the heading the cursor is in one of `level`, or plain text; or start a new heading of that level. */
  heading(level: string | null) {
    if (!view || !shownPath) return;
    const changes = setHeading(view.state.doc.toString(), view.state.selection.main.head, level);
    if (changes) {
      view.dispatch({ changes, userEvent: "input" });
      view.focus();
    } else if (level) buffers.insert(`\\${level}{`, "}");
  },

  /** Show compile errors and warnings in every open file they belong to. */
  /**
   * Mark the compile's errors and warnings in the files they are in, each explained in plain
   * words where it can be, with a button for its fix when one is certain.
   */
  setDiagnostics(all: Diagnostic[], help: (d: Diagnostic) => Help | null = () => null, fix: (f: Fix) => void = () => {}) {
    for (const path of states.keys()) {
      const state = buffers.current(path);
      if (!state) continue;
      const mine: CmDiagnostic[] = all
        .filter((d) => d.file === path && d.line > 0 && d.line <= state.doc.lines)
        .map((d) => {
          const line = state.doc.line(d.line);
          const said = help(d);
          const action = said?.fix && said.fix.kind !== "go" ? said.fix : undefined;
          return {
            from: line.from,
            to: Math.max(line.to, line.from),
            severity: said?.note ? "info" : d.severity === "error" ? "error" : "warning",
            message: said ? `${said.text}\n\nLaTeX says: ${d.message}` : d.message,
            ...(action ? { actions: [{ name: action.label, apply: () => fix(action) }] } : {}),
          };
        });
      const spec = setDiagnostics(state, mine);
      if (shownPath === path && view) view.dispatch(spec);
      else states.set(path, state.update(spec).state);
    }
  },
};
