// How a comment finds its passage again. A comment remembers the words it was made on, a little
// of the text either side, and the line; nothing is written into the file itself.

export interface Anchor {
  quote: string;
  before: string;
  after: string;
  line: number;
}

const CONTEXT = 32;

/** What to remember about the passage from `from` to `to`. */
export function describe(text: string, from: number, to: number): Anchor {
  let line = 1;
  for (let i = text.indexOf("\n"); i >= 0 && i < from; i = text.indexOf("\n", i + 1)) line++;
  return {
    quote: text.slice(from, to),
    before: text.slice(Math.max(0, from - CONTEXT), from),
    after: text.slice(to, to + CONTEXT),
    line,
  };
}

/**
 * Where the passage is now, or null when its words are no longer in the text. When the same
 * words appear more than once, the place whose surroundings match best wins, then the one
 * nearest the line it was last seen on.
 */
export function locate(text: string, anchor: Anchor): { from: number; to: number } | null {
  if (!anchor.quote) return null;
  let best: { from: number; score: number; distance: number } | null = null;
  let line = 1;
  let counted = 0;
  let seen = 0;
  for (let at = text.indexOf(anchor.quote); at >= 0 && seen < 500; at = text.indexOf(anchor.quote, at + 1), seen++) {
    for (let i = text.indexOf("\n", counted); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) {
      line++;
      counted = i + 1;
    }
    let score = 0;
    const end = at + anchor.quote.length;
    while (score < anchor.before.length && text[at - 1 - score] === anchor.before[anchor.before.length - 1 - score]) score++;
    let ahead = 0;
    while (ahead < anchor.after.length && text[end + ahead] === anchor.after[ahead]) ahead++;
    score += ahead;
    const distance = Math.abs(line - anchor.line);
    if (!best || score > best.score || (score === best.score && distance < best.distance)) best = { from: at, score, distance };
  }
  return best ? { from: best.from, to: best.from + anchor.quote.length } : null;
}
