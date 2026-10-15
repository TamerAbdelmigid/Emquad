// Spelling: underlines the prose words the dictionary does not know, and offers corrections.
// Which words count as prose is decided in spellModel.ts. The dictionaries ship with the app;
// nothing is looked up anywhere else.
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type Tooltip, ViewPlugin, type ViewUpdate, keymap, showTooltip } from "@codemirror/view";
import { type Answer, Dictionary, type Request } from "./spellCore";
import { type Word, skipWord, spellWords } from "./spellModel";

/** Where the dictionary is asked: a worker in the app, so the window never waits on it. */
interface Engine {
  load(language: string, ownWords: string[]): Promise<void>;
  check(words: string[]): Promise<boolean[]>;
  suggest(word: string): Promise<string[]>;
  /** Set where answers can be had at once, as in tests, which have no workers. */
  now?: Dictionary;
}

function workerEngine(): Engine {
  const worker = new Worker(new URL("./spellWorker.ts", import.meta.url), { type: "module" });
  let next = 0;
  const waiting = new Map<number, { done: (v: unknown) => void; fail: (e: Error) => void }>();
  worker.onmessage = (event: MessageEvent<Answer>) => {
    const { id, result, error } = event.data;
    const wait = waiting.get(id);
    waiting.delete(id);
    if (error) wait?.fail(new Error(error));
    else wait?.done(result);
  };
  type Ask = Request extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;
  const ask = <T>(request: Ask) =>
    new Promise<T>((done, fail) => {
      const id = ++next;
      waiting.set(id, { done: done as (v: unknown) => void, fail });
      worker.postMessage({ ...request, id });
    });
  return {
    load: (language, ownWords) => ask<void>({ type: "load", language, ownWords }),
    check: (words) => ask<boolean[]>({ type: "check", words }),
    suggest: (word) => ask<string[]>({ type: "suggest", word }),
  };
}

function threadEngine(): Engine {
  const dictionary = new Dictionary();
  return {
    load: (language, ownWords) => dictionary.load(language, ownWords),
    check: async (words) => words.map((w) => dictionary.wrong(w)),
    suggest: async (word) => dictionary.suggest(word),
    now: dictionary,
  };
}

const engine: Engine = typeof Worker === "undefined" ? threadEngine() : workerEngine();
let language = "off";
/** Verdicts already reached, since the same words come up on every redraw. */
const verdicts = new Map<string, boolean>();
/** Words waiting for a verdict from the worker. */
const asking = new Set<string>();
let onLearn: (word: string) => void = () => {};
/** The editors showing underlines, told to look again when verdicts arrive. */
const views = new Set<EditorView>();

/**
 * Make `language` the one that is checked, with the user's own words accepted too. Loading a
 * dictionary takes a moment the first time, so it is only done when spelling is switched on.
 */
export async function loadSpelling(chosen: string, ownWords: string[], learn: (word: string) => void) {
  onLearn = learn;
  await engine.load(chosen, ownWords);
  language = chosen;
  verdicts.clear();
  asking.clear();
  for (const view of views) view.dispatch({ effects: recheckSpelling.of(null) });
}

/** Ask the worker about the words waiting, then have the editors underline what it found. */
let flushing = false;
function flush() {
  if (flushing) return;
  flushing = true;
  queueMicrotask(async () => {
    flushing = false;
    const words = [...asking];
    asking.clear();
    const asked = language;
    const wrong = await engine.check(words).catch(() => words.map(() => false));
    if (asked !== language) return;
    words.forEach((w, i) => verdicts.set(w, wrong[i]));
    if (wrong.some(Boolean)) for (const view of views) view.dispatch({ effects: recheckSpelling.of(null) });
  });
}

/** Whether a word is misspelled, as far as is known yet: one not yet asked about counts as right until the answer comes. */
export function misspelled(word: string): boolean {
  if (language === "off" || skipWord(word)) return false;
  let wrong = verdicts.get(word);
  if (wrong === undefined && engine.now) verdicts.set(word, (wrong = engine.now.wrong(word)));
  if (wrong === undefined) {
    asking.add(word);
    flush();
    return false;
  }
  return wrong;
}

/** Corrections to offer for a word, likeliest first. */
export function suggestions(word: string): Promise<string[]> {
  return language === "off" ? Promise.resolve([]) : engine.suggest(word);
}

/** Check again: the dictionary or the user's own words changed. */
export const recheckSpelling = StateEffect.define<null>();
const mark = Decoration.mark({ class: "cm-misspelled" });

/** The prose words of the document last scanned, so scrolling does not scan it again. */
let scanned: { doc: unknown; words: Word[] } | null = null;
/** How long typing must pause before the document is read for words again. */
const PAUSE = 400;

const underlines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /** The misspelled words now in view. */
    words: Word[] = [];
    timer = 0;
    constructor(readonly view: EditorView) {
      views.add(view);
      this.decorations = this.find(view);
    }
    update(update: ViewUpdate) {
      const asked = update.transactions.some((tr) => tr.effects.some((e) => e.is(recheckSpelling)));
      if (asked) {
        this.decorations = this.find(update.view);
      } else if (update.docChanged) {
        // While typing, the underlines move with the text; the document is read again only
        // once typing pauses, since reading a long one takes a noticeable moment.
        this.decorations = this.decorations.map(update.changes);
        this.words = this.words.map((w) => ({ ...w, from: update.changes.mapPos(w.from, 1), to: update.changes.mapPos(w.to, -1) })).filter((w) => w.to > w.from);
        this.later();
      } else if (update.viewportChanged) {
        if (this.timer) this.later();
        else this.decorations = this.find(update.view);
      }
    }
    later() {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.view.dispatch({ effects: recheckSpelling.of(null) });
      }, PAUSE);
    }
    find(view: EditorView): DecorationSet {
      this.words = [];
      const doc = view.state.doc;
      if (language === "off" || doc.length > 400_000) return Decoration.none;
      if (scanned?.doc !== doc) scanned = { doc, words: spellWords(doc.toString()) };
      const { from, to } = view.viewport;
      for (const word of scanned.words) {
        if (word.to < from) continue;
        if (word.from > to) break;
        if (misspelled(word.word)) this.words.push(word);
      }
      return Decoration.set(this.words.map((w) => mark.range(w.from, w.to)));
    }
    destroy() {
      clearTimeout(this.timer);
      views.delete(this.view);
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
  // The corrections come from the dictionary's worker; the panel opens at once and they fill it.
  const none = dom.appendChild(document.createElement("div"));
  none.className = "cm-spell-none";
  none.textContent = "Looking for corrections…";
  button(`Add “${word.word}” to my dictionary`, "cm-spell-learn", () => {
    onLearn(word.word);
    close();
  });
  void suggestions(word.word).then((found) => {
    const keyboardHere = dom.contains(document.activeElement);
    for (const s of found) {
      button(s, "cm-spell-fix", () => view.dispatch({ changes: { from: word.from, to: word.to, insert: s }, userEvent: "input.spell" }));
      dom.insertBefore(dom.lastChild!, none);
    }
    if (found.length) none.remove();
    else none.textContent = "No suggestions";
    if (keyboardHere) dom.querySelector("button")?.focus();
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
