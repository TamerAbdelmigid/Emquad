// @vitest-environment jsdom
// The ribbon shows what is asked for from elsewhere: Insert ▸ Symbol… opens the Symbol panel,
// which lives on the Insert tab, whichever tab was showing.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Ribbon } from "./Ribbon";

afterEach(cleanup);

const noop = () => {};
const props = {
  actions: { equation: noop, cite: noop, zotero: noop, bibliography: noop, citationStyle: noop, setup: noop, comment: noop, spacing: noop },
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
  abstract: true,
  spacing: "single" as const,
  marks: false,
  onMarks: noop,
};

describe("Ribbon", () => {
  it("opens on Home, with the tools named and saying what LaTeX they write", () => {
    render(<Ribbon {...props} symbolsOpen={false} />);
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Bold" }).dataset.tex).toBe("\\textbf{…}");
    // The tools of "Formats like Word", each saying what it writes.
    const writes: [string, string][] = [
      ["Strikethrough", "\\sout{…}"],
      ["Subscript", "\\textsubscript{…}"],
      ["Superscript", "\\textsuperscript{…}"],
      ["Small capitals", "\\textsc{…}"],
      ["Highlight", "\\hl{…}"],
    ];
    for (const [name, tex] of writes) expect(screen.getByRole("button", { name }).dataset.tex).toBe(tex);
    for (const name of ["Format painter", "Clear formatting", "Bullets", "Numbering", "Increase indent", "Decrease indent", "Centre", "Align right", "Justify", "Show LaTeX marks", "Quote", "Abstract", "Paste", "Cut", "Copy"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Font colour" }).dataset.tex).toContain("\\textcolor");
    expect(screen.getByRole("button", { name: "Line spacing" })).toBeTruthy();
  });

  it("turns to the Insert tab when the Symbol panel is asked for", () => {
    const { rerender } = render(<Ribbon {...props} symbolsOpen={false} />);
    rerender(<Ribbon {...props} symbolsOpen={true} />);
    expect(screen.getByRole("tab", { name: "Insert" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".sym-search")).not.toBeNull();
  });
});
