// Which of a ribbon tab's groups to fold into a single button so that the row fits the width the
// pane gives it, as Word's ribbon does in a narrow window: from the right, one group at a time,
// passing over any group that would be no narrower folded. Pure.

/**
 * The whole plan for a row: which groups to fold, and, when folding them all still leaves the
 * row too wide, which to move (from the right) into one More button `moreWidth` wide, so that
 * nothing has to be scrolled to.
 */
export function rowPlan(full: number[], folded: number[], available: number, moreWidth: number): { fold: boolean[]; more: boolean[] } {
  const fold = groupsToFold(full, folded, available);
  const more = full.map(() => false);
  let width = full.reduce((sum, w, i) => sum + (fold[i] ? folded[i] : w), 0);
  // Once there is a More button, it takes room of its own.
  if (width <= available) return { fold, more };
  for (let i = full.length - 1; i >= 0 && width + moreWidth > available; i--) {
    more[i] = true;
    width -= fold[i] ? folded[i] : full[i];
  }
  return { fold, more };
}

/**
 * `full` and `folded` are each group's width in pixels as drawn whole and as one button (0 where
 * a group's whole width is not known yet); `available` is the row's width. Gives, for each group,
 * whether to fold it.
 */
export function groupsToFold(full: number[], folded: number[], available: number): boolean[] {
  const fold = full.map(() => false);
  let width = full.reduce((sum, w) => sum + w, 0);
  for (let i = full.length - 1; i >= 0 && width > available; i--) {
    if (full[i] === 0 || folded[i] >= full[i]) continue;
    fold[i] = true;
    width -= full[i] - folded[i];
  }
  return fold;
}
