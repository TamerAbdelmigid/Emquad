import { describe, expect, it } from "vitest";
import { groupsToFold, rowPlan, tabsShown } from "./ribbonFit";

describe("groupsToFold", () => {
  const full = [60, 120, 300, 200, 150];
  const folded = [60, 64, 64, 64, 64];

  it("folds nothing when every group fits", () => {
    expect(groupsToFold(full, folded, 830)).toEqual([false, false, false, false, false]);
  });

  it("folds from the right, one group at a time, until the row fits", () => {
    // 830 wide in full; folding the last saves 86, the one before it 136. Once the one before it is
    // folded, the last fits whole again.
    expect(groupsToFold(full, folded, 800)).toEqual([false, false, false, false, true]);
    expect(groupsToFold(full, folded, 700)).toEqual([false, false, false, true, false]);
    expect(groupsToFold(full, folded, 500)).toEqual([false, false, true, true, false]);
    expect(groupsToFold(full, folded, 400)).toEqual([false, false, true, true, true]);
  });

  it("draws whole again a group folded on the way, once a wider one folded makes room for it", () => {
    // Folding the last two saves 222 of the 130 needed: the last, 86 wider whole, fits again.
    expect(groupsToFold(full, folded, 700)).toEqual([false, false, false, true, false]);
    // A narrow last group and a wide one before it, as Word's Styles gallery and Editing.
    expect(groupsToFold([100, 500, 120], [100, 70, 70], 400)).toEqual([false, true, false]);
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

describe("tabsShown", () => {
  const widths = [60, 60, 60, 90, 60];

  it("keeps every tab when the row has room for them", () => {
    // 330 of tabs and 4 gaps of 2.
    expect(tabsShown(widths, 0, 338, 30, 2)).toEqual([true, true, true, true, true]);
  });

  it("keeps as many as fit from the left, after room for the button that offers the rest", () => {
    // 337 is short by one: the button takes 30 of it, and three tabs and their gaps take 184.
    expect(tabsShown(widths, 0, 337, 30, 2)).toEqual([true, true, true, true, false]);
    expect(tabsShown(widths, 0, 250, 30, 2)).toEqual([true, true, true, false, false]);
  });

  it("always keeps the tab on show", () => {
    expect(tabsShown(widths, 4, 250, 30, 2)).toEqual([true, true, false, false, true]);
    expect(tabsShown(widths, 3, 40, 30, 2)).toEqual([false, false, false, true, false]);
  });
});
