import { describe, expect, it } from "vitest";
import { coalesced } from "./coalesced";

describe("coalesced", () => {
  it("runs once more after a run, however many times it was asked for meanwhile", async () => {
    let runs = 0;
    let release: () => void = () => {};
    const go = coalesced(async () => {
      runs++;
      await new Promise<void>((r) => (release = r));
    });
    const first = go();
    const waiting = [go(), go(), go()];
    expect(runs).toBe(1);
    release();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(2);
    release();
    await Promise.all([first, ...waiting]);
    expect(runs).toBe(2);
    // Once idle, a call runs straight away again.
    const later = go();
    expect(runs).toBe(3);
    release();
    await later;
  });
});
