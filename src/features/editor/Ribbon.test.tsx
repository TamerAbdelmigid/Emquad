// @vitest-environment jsdom
// The ribbon shows what is asked for from elsewhere: Insert ▸ Symbol… opens the Symbol panel,
// which lives on the Insert tab, whichever tab was showing.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ribbon } from "./Ribbon";
import type { Setup } from "./documentSetup";

afterEach(cleanup);

const noop = () => {};
const props = {
  actions: { equation: noop, cite: noop, zotero: noop, bibliography: noop, citationStyle: noop, setup: noop, comment: noop, spacing: noop, layout: noop, headerFooter: noop, bookmark: noop, compile: noop, snapshot: noop, history: noop, exportBundle: noop, sendToWord: noop, pdfWithComments: noop, wordCount: noop, stepComment: noop, balloons: noop, snapshots: () => Promise.resolve([{ id: "v1", label: "Draft 1" }]), showChanges: noop },
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
  setup: { paper: "a4paper", size: "", margins: "2.5cm", spacing: "single", font: "default", pageNumbers: true, paragraphs: "indent", landscape: false, columns: 1, lineNumbers: false, header: "", footer: "" } satisfies Setup as Setup,
  marks: false,
  onMarks: noop,
  balloons: true,
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

  it("lays out like Word: the Layout tab sets the page for the whole document, each tool saying what it writes", () => {
    const layout = vi.fn();
    render(<Ribbon {...props} actions={{ ...props.actions, layout }} symbolsOpen={false} />);
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
    expect(screen.getByRole("button", { name: "Margins" }).dataset.tex).toContain("geometry");
    expect(screen.getByRole("button", { name: "Orientation" }).dataset.tex).toContain("landscape");
    expect(screen.getByRole("button", { name: "Columns" }).dataset.tex).toContain("twocolumn");
    expect(screen.getByRole("button", { name: "Breaks" })).toBeTruthy();
    const numbers = screen.getByRole("button", { name: "Line numbers" });
    expect(numbers.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(numbers);
    expect(layout).toHaveBeenLastCalledWith({ lineNumbers: true });
    fireEvent.click(screen.getByRole("button", { name: "Margins" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Narrow/ }));
    expect(layout).toHaveBeenLastCalledWith({ margins: "1.27cm" });
    fireEvent.click(screen.getByRole("button", { name: "Orientation" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Landscape/ }));
    expect(layout).toHaveBeenLastCalledWith({ landscape: true });
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(screen.getByRole("menuitem", { name: /A4/ }).textContent).toContain("✓");
  });

  it("puts the header and footer on the Insert tab, as Word does", () => {
    const headerFooter = vi.fn();
    render(<Ribbon {...props} actions={{ ...props.actions, headerFooter }} symbolsOpen={false} />);
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(screen.getByRole("button", { name: "Header" }).dataset.tex).toContain("fancyhdr");
    fireEvent.click(screen.getByRole("button", { name: "Footer" }));
    expect(headerFooter).toHaveBeenLastCalledWith("footer");
    expect(screen.getByRole("button", { name: "Page number" })).toBeTruthy();
  });

  it("refers like Word: the References tab gathers contents, footnotes, citations and captions", () => {
    render(<Ribbon {...props} symbolsOpen={false} />);
    fireEvent.click(screen.getByRole("tab", { name: "References" }));
    for (const name of ["Table of contents", "Update", "Footnote", "Citation", "From Zotero", "Citation style", "Bibliography", "Cross-reference", "Table of figures", "List of tables"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Cross-reference" }).dataset.tex).toBe("\\Cref{…}");
  });

  it("refers like Word: the Review tab shows changes since a snapshot, comments, versions and sharing", async () => {
    const showChanges = vi.fn();
    const balloons = vi.fn();
    render(<Ribbon {...props} actions={{ ...props.actions, showChanges, balloons }} symbolsOpen={false} />);
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    for (const name of ["Word count", "New comment", "Previous comment", "Next comment", "Save snapshot", "Compare versions", "Send as bundle", "Send to Word", "PDF with comments"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Show comments" }));
    expect(balloons).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Show changes" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Since “Draft 1”/ }));
    expect(showChanges).toHaveBeenLastCalledWith({ id: "v1", label: "Draft 1" });
  });

  it("puts Link, Bookmark and Cross-reference in the Insert tab's Links group", () => {
    render(<Ribbon {...props} symbolsOpen={false} />);
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(screen.getByRole("button", { name: "Link" }).dataset.keys).toBe("Ctrl+K");
    expect(screen.getByRole("button", { name: "Bookmark" }).dataset.tex).toBe("\\label{…}");
  });
});
