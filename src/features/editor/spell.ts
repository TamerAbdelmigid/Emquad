// Spelling: underlines the prose words the dictionary does not know, and offers corrections.
// Which words count as prose is decided in spellModel.ts. The dictionaries ship with the app;
// nothing is looked up anywhere else.
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type Tooltip, ViewPlugin, type ViewUpdate, keymap, showTooltip } from "@codemirror/view";
import type NSpell from "nspell";
import { type Word, skipWord, spellWords } from "./spellModel";

let checker: NSpell | null = null;
let loaded = "off";
/** Verdicts already reached, since the same words come up on every redraw. */
const verdicts = new Map<string, boolean>();
let onLearn: (word: string) => void = () => {};

const plain = (word: string) => word.replace(/’/g, "'");

/**
 * Make `language` the one that is checked, with the user's own words accepted too. Loading a
 * dictionary takes a moment the first time, so it is only done when spelling is switched on.
 */
export async function loadSpelling(language: string, ownWords: string[], learn: (word: string) => void) {
  onLearn = learn;
  if (language === "off") {
    checker = null;
    loaded = "off";
    verdicts.clear();
    return;
  }
  if (language !== loaded || !checker) {
    const british = language === "en-GB";
    const [{ default: nspell }, aff, dic] = await Promise.all([
      import("nspell"),
      british ? import("../../../node_modules/dictionary-en-gb/index.aff?raw") : import("../../../node_modules/dictionary-en/index.aff?raw"),
      british ? import("../../../node_modules/dictionary-en-gb/index.dic?raw") : import("../../../node_modules/dictionary-en/index.dic?raw"),
    ]);
    checker = nspell(aff.default, dic.default);
    loaded = language;
  }
  for (const word of ownWords) checker.add(plain(word));
  verdicts.clear();
}

export function misspelled(word: string): boolean {
  if (!checker || skipWord(word)) return false;
  let wrong = verdicts.get(word);
  if (wrong === undefined) {
    const w = plain(word);
    // A possessive is as right as the word it is made from.
    wrong = !checker.correct(w) && !(w.endsWith("'s") && checker.correct(w.slice(0, -2)));
    verdicts.set(word, wrong);
  }
  return wrong;
}

/**
 * Corrections to offer, likeliest first: the same letters in another order (the commonest
 * typing slip), then words of the same length, then the rest as the dictionary gives them.
 */
export function suggestions(word: string): string[] {
  if (!checker) return [];
  const letters = (w: string) => Array.from(w.toLowerCase()).sort().join("");
  const mine = letters(plain(word));
  const rank = (s: string) => (letters(s) === mine ? 0 : s.length === word.length ? 1 : 2);
  return checker
    .suggest(plain(word))
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .slice(0, 7)
    .map((x) => x.s);
}

/** Check again: the dictionary or the user's own words changed. */
export const recheckSpelling = StateEffect.define<null>();
const mark = Decoration.mark({ class: "cm-misspelled" });

/** The prose words of the document last scanned, so scrolling does not scan it again. */
let scanned: { doc: unknown; words: Word[] } | null = null;

const underlines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /** The misspelled words now in view. */
    words: Word[] = [];
    constructor(view: EditorView) {
      this.decorations = this.find(view);
    }
    update(update: ViewUpdate) {
      const asked = update.transactions.some((tr) => tr.effects.some((e) => e.is(recheckSpelling)));
      if (update.docChanged || update.viewportChanged || asked) this.decorations = this.find(update.view);
    }
    find(view: EditorView): DecorationSet {
      this.words = [];
      const doc = view.state.doc;
      if (!checker || doc.length > 400_000) return Decoration.none;
      if (scanned?.doc !== doc) scanned = { doc, words: spellWords(doc.toString()) };
      const { from, to } = view.viewport;
      for (const word of scanned.words) {
        if (word.to < from) continue;
        if (word.from > to) break;
        if (misspelled(word.word)) this.words.push(word);
      }
      return Decoration.set(this.words.map((w) => mark.range(w.from, w.to)));
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const openFix = StateEffect.define<Word | null>();

function fixPanel(view: EditorView, word: Word): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-spell";
  dom.setAttribute("role", "menu");
  dom.setAttribute("aria-label", `Spelling of ${word.word}`);
  const close = () => {
    view.dispatch({ effects: openFix.of(null) });
    view.focus();
  };
  const button = (label: string, className: string, run: () => void) => {
    const b = dom.appendChild(document.createElement("button"));
    b.type = "button";
    b.className = className;
    b.textContent = label;
    b.setAttribute("role", "menuitem");
    b.onclick = () => {
      run();
      view.focus();
    };
  };
  const found = suggestions(word.word);
  for (const s of found) button(s, "cm-spell-fix", () => view.dispatch({ changes: { from: word.from, to: word.to, insert: s }, userEvent: "input.spell" }));
  if (found.length === 0) {
    const none = dom.appendChild(document.createElement("div"));
    none.className = "cm-spell-none";
    none.textContent = "No suggestions";
  }
  button(`Add “${word.word}” to my dictionary`, "cm-spell-learn", () => {
    onLearn(word.word);
    close();
  });
  dom.onkeydown = (e) => {
    const items = Array.from(dom.querySelectorAll("button"));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  };
  return dom;
}

const fix = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(openFix)) continue;
      const word = e.value;
      if (!word) return null;
      return {
        pos: word.from,
        end: word.to,
        above: false,
        create: (view) => {
          const dom = fixPanel(view, word);
          return { dom, mount: () => dom.querySelector("button")?.focus() };
        },
      };
    }
    return tr.docChanged || tr.selection ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

function wordAt(view: EditorView, pos: number): Word | undefined {
  return view.plugin(underlines)?.words.find((w) => w.from <= pos && w.to >= pos);
}

/** Offer corrections for the misspelled word the cursor is in. */
function fixAtCursor(view: EditorView): boolean {
  const word = wordAt(view, view.state.selection.main.head);
  if (!word) return false;
  view.dispatch({ effects: openFix.of(word) });
  return true;
}

/** Everything the spelling checker adds to an editor. */
export const spelling: Extension = [
  underlines,
  fix,
  keymap.of([{ key: "Mod-.", run: fixAtCursor }]),
  EditorView.domEventHandlers({
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const word = pos === null ? undefined : wordAt(view, pos);
      if (!word) return false;
      event.preventDefault();
      view.dispatch({ selection: { anchor: word.from }, effects: openFix.of(word) });
      return true;
    },
  }),
];
