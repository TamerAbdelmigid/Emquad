// @vitest-environment jsdom
// The ribbon shows what is asked for from elsewhere: Insert ▸ Symbol… opens the Symbol panel,
// which lives on the Insert tab, whichever tab was showing.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Ribbon } from "./Ribbon";

afterEach(cleanup);

const noop = () => {};
const props = {
  actions: { equation: noop, cite: noop, zotero: noop, bibliography: noop, citationStyle: noop, setup: noop, comment: noop },
  active: true,
  chapters: false,
  onSymbols: noop,
  recentSymbols: [],
  onSymbolUsed: noop,
  onCode: noop,
  onShowChanges: noop,
  pageView: true,
  onPageView: noop,
  zoom: 1,
  onZoom: noop,
};

describe("Ribbon", () => {
  it("opens on Home, with the tools named and saying what LaTeX they write", () => {
    render(<Ribbon {...props} symbolsOpen={false} />);
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Bold" }).dataset.tex).toBe("\\textbf{…}");
  });

  it("turns to the Insert tab when the Symbol panel is asked for", () => {
    const { rerender } = render(<Ribbon {...props} symbolsOpen={false} />);
    rerender(<Ribbon {...props} symbolsOpen={true} />);
    expect(screen.getByRole("tab", { name: "Insert" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".sym-search")).not.toBeNull();
  });
});
