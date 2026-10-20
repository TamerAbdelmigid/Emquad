// Changes since a snapshot, drawn on the page as Word draws tracked changes: what was put in
// underlined, and what was taken out struck through where it stood, each in its author's colour.
// Nothing is recorded while writing; the changes are read from History's comparison of the
// snapshot with the text as it is now. Pure.
import type { Block } from "../../ipc/bindings/Block";

export interface PageChange {
  /** The lines the change covers in the text now: what "Undo change" puts back the old lines over. */
  from: number;
  to: number;
  /** What those lines were in the snapshot. */
  old: string;
  /** The stretches put in since. */
  inserted: { from: number; to: number }[];
  /** What was taken out, and where it stood. */
  deleted: { at: number; text: string }[];
  /** You, or the other author, whose version since the snapshot brought it. */
  who: "mine" | "theirs";
}

/** The text a comparison was made with, read back from it. */
export function textOf(blocks: Block[]): string {
  return blocks.map((b) => (b.kind === "equal" ? b.text : b.newText)).join("");
}

/** Where line `line` (1-based) of `text` starts. */
function lineFrom(text: string, line: number): number {
  let at = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf("\n", at);
    if (next < 0) return text.length;
    at = next + 1;
  }
  return at;
}

/** The editor holds a file's lines with \n alone, whatever the file on disk ends them with. */
function withLf(blocks: Block[]): Block[] {
  const lf = (s: string) => s.replace(/\r\n/g, "\n");
  return blocks.map((b) =>
    b.kind === "equal" ? { ...b, text: lf(b.text) } : { ...b, oldText: lf(b.oldText), newText: lf(b.newText), segments: b.segments.map((s) => ({ ...s, text: lf(s.text) })) },
  );
}

/**
 * The changes of a comparison of a snapshot with `text`, placed in `text`; none when `text` is
 * not what was compared. A change is the other author's when `theirs`, the comparison of the
 * same snapshot with their latest version since, made the same change to the same lines.
 */
export function changesOnPage(given: Block[], text: string, theirs: Block[] | null): PageChange[] {
  const blocks = withLf(given);
  if (textOf(blocks) !== text) return [];
  const theirChanges = new Set(
    withLf(theirs ?? [])
      .filter((b) => b.kind === "change")
      .map((b) => (b.kind === "change" ? `${b.oldStart}\u0000${b.oldText}\u0000${b.newText}` : "")),
  );
  const out: PageChange[] = [];
  for (const b of blocks) {
    if (b.kind !== "change") continue;
    const from = lineFrom(text, b.newStart);
    const change: PageChange = { from, to: from + b.newText.length, old: b.oldText, inserted: [], deleted: [], who: "mine" };
    let at = from;
    for (const s of b.segments) {
      if (s.tag === "delete") change.deleted.push({ at, text: s.text });
      else {
        if (s.tag === "insert") change.inserted.push({ from: at, to: at + s.text.length });
        at += s.text.length;
      }
    }
    if (theirChanges.has(`${b.oldStart}\u0000${b.oldText}\u0000${b.newText}`)) change.who = "theirs";
    out.push(change);
  }
  return out;
}
