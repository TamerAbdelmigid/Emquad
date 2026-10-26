import { describe, expect, it } from "vitest";
import { groupsToFold, rowPlan } from "./ribbonFit";

describe("groupsToFold", () => {
  const full = [60, 120, 300, 200, 150];
  const folded = [60, 64, 64, 64, 64];

  it("folds nothing when every group fits", () => {
    expect(groupsToFold(full, folded, 830)).toEqual([false, false, false, false, false]);
  });

  it("folds from the right, one group at a time, until the row fits", () => {
    // 830 wide in full; folding the last saves 86, the one before it 136.
    expect(groupsToFold(full, folded, 800)).toEqual([false, false, false, false, true]);
    expect(groupsToFold(full, folded, 700)).toEqual([false, false, false, true, true]);
    expect(groupsToFold(full, folded, 500)).toEqual([false, false, true, true, true]);
  });

  it("passes over a group that would be no narrower folded", () => {
    // The first group is as narrow as a folded one: folding it would only hide its tools.
    expect(groupsToFold(full, folded, 300)).toEqual([false, true, true, true, true]);
    expect(groupsToFold(full, folded, 10)).toEqual([false, true, true, true, true]);
  });

  it("moves groups from the right into one More button when folding alone does not fit", () => {
    // Folded as far as it goes: 60 + 4 × 64 = 316. With a 70-pixel More button, 200 holds two folded groups.
    expect(rowPlan(full, folded, 316, 70)).toEqual({ fold: [false, true, true, true, true], more: [false, false, false, false, false] });
    expect(rowPlan(full, folded, 200, 70)).toEqual({ fold: [false, true, true, true, true], more: [false, false, true, true, true] });
    // Too narrow for anything but More: every group goes in it.
    expect(rowPlan(full, folded, 50, 70).more).toEqual([true, true, true, true, true]);
    expect(rowPlan(full, folded, 900, 70)).toEqual({ fold: [false, false, false, false, false], more: [false, false, false, false, false] });
  });

  it("leaves a group the row has never measured unfolded, rather than guess", () => {
    expect(groupsToFold([60, 0, 300], [60, 64, 64], 200)).toEqual([false, false, true]);
  });
});
