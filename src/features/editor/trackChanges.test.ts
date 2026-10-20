import { describe, expect, it } from "vitest";
import type { Block } from "../../ipc/bindings/Block";
import { changesOnPage, textOf } from "./trackChanges";

const NOW = "First line.\nThe quick red fox.\nNew line here.\nLast line.\n";
// The snapshot had "The quick brown fox." and no third line, and a line "Gone." before the last.
const BLOCKS: Block[] = [
  { kind: "equal", newStart: 1, text: "First line.\n" },
  {
    kind: "change",
    oldStart: 2,
    newStart: 2,
    oldText: "The quick brown fox.\n",
    newText: "The quick red fox.\nNew line here.\n",
    segments: [
      { tag: "equal", text: "The quick " },
      { tag: "delete", text: "brown" },
      { tag: "insert", text: "red" },
      { tag: "equal", text: " fox.\n" },
      { tag: "insert", text: "New line here.\n" },
    ],
  },
  { kind: "change", oldStart: 3, newStart: 4, oldText: "Gone.\n", newText: "", segments: [{ tag: "delete", text: "Gone.\n" }] },
  { kind: "equal", newStart: 4, text: "Last line.\n" },
];

describe("changes since a snapshot, on the page", () => {
  it("places each change in the text as it is now: what was put in, and where something was taken out", () => {
    const changes = changesOnPage(BLOCKS, NOW, null);
    expect(changes).toHaveLength(2);
    const [first, second] = changes;
    expect(NOW.slice(first.from, first.to)).toBe("The quick red fox.\nNew line here.\n");
    expect(first.inserted.map((r) => NOW.slice(r.from, r.to))).toEqual(["red", "New line here.\n"]);
    expect(first.deleted).toEqual([{ at: NOW.indexOf("red"), text: "brown" }]);
    expect(first.old).toBe("The quick brown fox.\n");
    expect(second).toMatchObject({ from: NOW.indexOf("Last"), to: NOW.indexOf("Last"), old: "Gone.\n", deleted: [{ at: NOW.indexOf("Last"), text: "Gone.\n" }] });
    expect(changes.every((c) => c.who === "mine")).toBe(true);
  });

  it("gives a change to the other author when their version since the snapshot made the same change to the same lines", () => {
    // They changed line 2 as it is now; they did not take out "Gone.".
    const theirs: Block[] = [BLOCKS[0], BLOCKS[1], { kind: "equal", newStart: 4, text: "Gone.\nLast line.\n" }];
    expect(changesOnPage(BLOCKS, NOW, theirs).map((c) => c.who)).toEqual(["theirs", "mine"]);
    // A blank line they added somewhere else does not make a blank line of mine theirs.
    const blank: Block[] = [{ kind: "equal", newStart: 1, text: "First line.\n" }, { kind: "change", oldStart: 2, newStart: 2, oldText: "", newText: "\n", segments: [{ tag: "insert", text: "\n" }] }];
    const mine: Block[] = [{ kind: "equal", newStart: 1, text: "First line.\nThe quick brown fox.\n" }, { kind: "change", oldStart: 3, newStart: 3, oldText: "", newText: "\n", segments: [{ tag: "insert", text: "\n" }] }];
    expect(changesOnPage(mine, "First line.\nThe quick brown fox.\n\n", blank).map((c) => c.who)).toEqual(["mine"]);
  });

  it("gives nothing when the text is not the one the comparison was made with", () => {
    expect(changesOnPage(BLOCKS, NOW.replace("red", "blue"), null)).toEqual([]);
  });

  it("places the changes of a file whose lines end with CRLF on disk", () => {
    const crlf = BLOCKS.map((b) =>
      b.kind === "equal" ? { ...b, text: b.text.replace(/\n/g, "\r\n") } : { ...b, oldText: b.oldText.replace(/\n/g, "\r\n"), newText: b.newText.replace(/\n/g, "\r\n"), segments: b.segments.map((s) => ({ ...s, text: s.text.replace(/\n/g, "\r\n") })) },
    );
    expect(changesOnPage(crlf, NOW, null).map((c) => c.old)).toEqual(["The quick brown fox.\n", "Gone.\n"]);
  });

  it("reads a version's text back from a comparison with it", () => {
    expect(textOf(BLOCKS)).toBe(NOW);
  });
});
