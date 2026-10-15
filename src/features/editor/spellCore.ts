// The dictionary itself: loading one and asking it about words. Used in a worker, so that a
// large dictionary (French takes about three seconds to build) never holds up the window, and
// directly where there are no workers, as in the tests.
import type NSpell from "nspell";

type Raw = Promise<{ default: string }>;
/** The dictionaries that ship with the app, each loaded only when it is first chosen. */
const DICTIONARIES: Record<string, () => [Raw, Raw]> = {
  "en-US": () => [import("../../../node_modules/dictionary-en/index.aff?raw"), import("../../../node_modules/dictionary-en/index.dic?raw")],
  "en-GB": () => [import("../../../node_modules/dictionary-en-gb/index.aff?raw"), import("../../../node_modules/dictionary-en-gb/index.dic?raw")],
  fr: () => [import("../../../node_modules/dictionary-fr/index.aff?raw"), import("../../../node_modules/dictionary-fr/index.dic?raw")],
  es: () => [import("../../../node_modules/dictionary-es/index.aff?raw"), import("../../../node_modules/dictionary-es/index.dic?raw")],
  nl: () => [import("../../../node_modules/dictionary-nl/index.aff?raw"), import("../../../node_modules/dictionary-nl/index.dic?raw")],
  ru: () => [import("../../../node_modules/dictionary-ru/index.aff?raw"), import("../../../node_modules/dictionary-ru/index.dic?raw")],
};

export const plain = (word: string) => word.replace(/’/g, "'");

/** A checker for one language, with the user's own words accepted too. */
export class Dictionary {
  private checker: NSpell | null = null;
  private language = "off";
  private own = new Set<string>();

  /** Make `language` the one checked. "off" checks nothing. */
  async load(language: string, ownWords: string[]) {
    if (language === "off") {
      this.checker = null;
      this.language = "off";
      return;
    }
    const words = new Set(ownWords.map(plain));
    // A word taken out of the user's own can only be forgotten by building the checker again.
    const forgot = [...this.own].some((w) => !words.has(w));
    if (language !== this.language || !this.checker || forgot) {
      const [{ default: nspell }, aff, dic] = await Promise.all([import("nspell"), ...(DICTIONARIES[language] ?? DICTIONARIES["en-US"])()]);
      this.checker = nspell(aff.default, dic.default);
      this.language = language;
      this.own = new Set();
    }
    for (const word of words) if (!this.own.has(word)) this.checker.add(word);
    this.own = words;
  }

  get on(): boolean {
    return this.checker !== null;
  }

  /** Whether the dictionary does not know `word`. */
  wrong(word: string): boolean {
    if (!this.checker) return false;
    const w = plain(word);
    // A possessive is as right as the word it is made from.
    return !this.checker.correct(w) && !(w.endsWith("'s") && this.checker.correct(w.slice(0, -2)));
  }

  /**
   * Corrections to offer, likeliest first: the same letters in another order (the commonest
   * typing slip), then words of the same length, then the rest as the dictionary gives them.
   */
  suggest(word: string): string[] {
    if (!this.checker) return [];
    const letters = (w: string) => Array.from(w.toLowerCase()).sort().join("");
    const mine = letters(plain(word));
    const rank = (s: string) => (letters(s) === mine ? 0 : s.length === word.length ? 1 : 2);
    return this.checker
      .suggest(plain(word))
      .map((s, i) => ({ s, i, r: rank(s) }))
      .sort((x, y) => x.r - y.r || x.i - y.i)
      .slice(0, 7)
      .map((x) => x.s);
  }
}

/** What the window asks the worker, and what it answers. */
export type Request =
  | { id: number; type: "load"; language: string; ownWords: string[] }
  | { id: number; type: "check"; words: string[] }
  | { id: number; type: "suggest"; word: string };
export type Answer = { id: number; result?: unknown; error?: string };
