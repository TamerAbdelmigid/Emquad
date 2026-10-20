import { describe, expect, it } from "vitest";
import { stackBalloons } from "./comments";

describe("comment balloons beside the page", () => {
  it("puts each balloon level with its passage, pushed down only as far as the one above needs", () => {
    expect(stackBalloons([{ top: 10, height: 40 }, { top: 30, height: 20 }, { top: 200, height: 30 }], 6)).toEqual([10, 56, 200]);
    expect(stackBalloons([], 6)).toEqual([]);
  });
});
