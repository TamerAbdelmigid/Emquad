import { describe, expect, it } from "vitest";
import type { Block } from "../../ipc/api";
import { revertBlock } from "./History";

const blocks: Block[] = [
  { kind: "equal", newStart: 1, text: "one\n" },
  { kind: "change", oldStart: 2, newStart: 2, oldText: "two\n", newText: "TWO\n", segments: [] },
  { kind: "equal", newStart: 3, text: "three\n" },
  { kind: "change", oldStart: 4, newStart: 4, oldText: "", newText: "added\n", segments: [] },
];

describe("revertBlock", () => {
  it("puts one change back and leaves the others as they are", () => {
    expect(revertBlock(blocks, 0)).toBe("one\ntwo\nthree\nadded\n");
    expect(revertBlock(blocks, 1)).toBe("one\nTWO\nthree\n");
  });
});
