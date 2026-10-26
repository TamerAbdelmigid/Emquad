// @vitest-environment jsdom
// The ribbon shows what is asked for from elsewhere: Insert ▸ Symbol… opens the Symbol panel,
// which lives on the Insert tab, whichever tab was showing.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ribbon } from "./Ribbon";
import { buffers } from "./buffers";
import type { Setup } from "./documentSetup";

afterEach(cleanup);

const noop = () => {};
const props = {
  actions: { equation: noop, cite: noop, zotero: noop, bibliography: noop, citationStyle: noop, setup: noop, comment: noop, spacing: noop, layout: noop, headerFooter: noop, bookmark: noop, compile: noop, snapshot: noop, history: noop, exportBundle: noop, sendToWord: noop, pdfWithComments: noop, wordCount: noop, stepComment: noop, balloons: noop, snapshots: () => Promise.resolve([{ id: "v1", label: "Draft 1" }]), showChanges: noop, packages: noop, myCommands: noop, logs: noop, myCommandList: () => Promise.resolve([{ name: "gwr", body: "groundwater recharge" }]), insertMyCommand: noop },
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
  split: false,
  onSplit: noop,
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

  it("builds the bridge to LaTeX: a LaTeX tab with Split, Packages, My commands and a button for each of the document's own commands", async () => {
    const insertMyCommand = vi.fn();
    const onSplit = vi.fn();
    render(<Ribbon {...props} onSplit={onSplit} actions={{ ...props.actions, insertMyCommand }} symbolsOpen={false} />);
    fireEvent.click(screen.getByRole("tab", { name: "LaTeX" }));
    for (const name of ["Show LaTeX", "Packages", "My commands", "Recompile", "Logs"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Split with LaTeX" }));
    expect(onSplit).toHaveBeenLastCalledWith(true);
    fireEvent.click(await screen.findByRole("button", { name: "\\gwr" }));
    expect(insertMyCommand).toHaveBeenLastCalledWith("gwr");
  });

  it("shows KeyTips when Alt is pressed alone, a letter choosing a tab and then a tool, as in Word", () => {
    render(<Ribbon {...props} symbolsOpen={false} />);
    fireEvent.keyDown(window, { key: "Alt" });
    fireEvent.keyUp(window, { key: "Alt" });
    const tips = () => [...document.querySelectorAll(".rb-kt")].map((t) => t.textContent);
    expect(tips()).toEqual(expect.arrayContaining(["H", "N", "P", "S", "R", "W", "X"]));
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByRole("tab", { name: "Layout" }).getAttribute("aria-selected")).toBe("true");
    expect(tips()).toContain("M");
    fireEvent.keyDown(window, { key: "m" });
    expect(screen.getByRole("menuitem", { name: /Narrow/ })).toBeTruthy();
    expect(tips()).toEqual([]);
    // Alt held for a shortcut, such as Alt+=, shows none.
    fireEvent.keyDown(window, { key: "Alt" });
    fireEvent.keyDown(window, { key: "=", altKey: true });
    fireEvent.keyUp(window, { key: "Alt" });
    expect(tips()).toEqual([]);
  });

  it("shows no KeyTips for Alt let go after a click, after leaving the window, or over a dialog, and leaves no tool holding the keyboard", () => {
    render(<Ribbon {...props} symbolsOpen={false} />);
    const tips = () => [...document.querySelectorAll(".rb-kt")].map((t) => t.textContent);
    fireEvent.keyDown(window, { key: "Alt" });
    fireEvent.mouseDown(document.body);
    fireEvent.keyUp(window, { key: "Alt" });
    expect(tips()).toEqual([]);
    fireEvent.keyDown(window, { key: "Alt" });
    fireEvent.blur(window);
    fireEvent.keyUp(window, { key: "Alt" });
    expect(tips()).toEqual([]);
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.setAttribute("open", "");
    fireEvent.keyDown(window, { key: "Alt" });
    fireEvent.keyUp(window, { key: "Alt" });
    expect(tips()).toEqual([]);
    dialog.remove();
    // A tool that is not a menu, used by its letter, gives the keyboard back.
    fireEvent.keyDown(window, { key: "Alt" });
    fireEvent.keyUp(window, { key: "Alt" });
    fireEvent.keyDown(window, { key: "h" });
    const letter = [...document.querySelectorAll<HTMLElement>(".rb-kt")].find((t) => t.textContent === "B");
    expect(letter).toBeTruthy();
    fireEvent.keyDown(window, { key: "b" });
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Bold" }));
  });

  it("gives the keyboard back to the LaTeX side of Split when that is where the typing was", () => {
    const page = document.body.appendChild(document.createElement("div"));
    const latex = document.body.appendChild(document.createElement("div"));
    const detach = [buffers.attach(page)];
    try {
      buffers.open("main.tex", "\\begin{document}\nText.\n\\end{document}\n");
      buffers.show("main.tex");
      detach.push(buffers.attachSource(latex));
      render(<Ribbon {...props} symbolsOpen={false} />);
      const side = buffers.sourceView()!;
      side.focus();
      expect(side.hasFocus).toBe(true);
      fireEvent.keyDown(window, { key: "Alt" });
      fireEvent.keyUp(window, { key: "Alt" });
      fireEvent.keyDown(window, { key: "h" });
      fireEvent.keyDown(window, { key: "b" });
      expect(side.hasFocus).toBe(true);
      // Typing on the page, the keyboard goes back to the page.
      buffers.showNow("main.tex")!.focus();
      fireEvent.keyDown(window, { key: "Alt" });
      fireEvent.keyUp(window, { key: "Alt" });
      fireEvent.keyDown(window, { key: "h" });
      fireEvent.keyDown(window, { key: "b" });
      expect(buffers.showNow("main.tex")!.hasFocus).toBe(true);
    } finally {
      detach.reverse().forEach((d) => d());
      buffers.closeAll();
      page.remove();
      latex.remove();
    }
  });

  describe("in a narrow pane", () => {
    // jsdom lays nothing out: the panel is given a width, each group 150 pixels whole and 64 folded.
    const widths = { panel: 520, whole: 150, folded: 64, tabs: 2000 };
    const restore: (() => void)[] = [];
    const measure = (name: "clientWidth" | "offsetWidth" | "scrollWidth", get: (el: HTMLElement) => number | undefined) => {
      // offsetWidth is an HTMLElement's own; clientWidth and scrollWidth are any Element's.
      const owner = name === "offsetWidth" ? HTMLElement.prototype : Element.prototype;
      const was = Object.getOwnPropertyDescriptor(owner, name)!;
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) {
          return get(this) ?? was.get!.call(this);
        },
      });
      restore.push(() =>
        owner === HTMLElement.prototype ? Object.defineProperty(owner, name, was) : delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name],
      );
    };
    const groupWidth = (el: HTMLElement) => (el.classList.contains("rb-folded") ? widths.folded : widths.whole);
    const panelWidth = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(":scope > .rb-group")].reduce((sum, g) => sum + groupWidth(g), 0);
    beforeEach(() => {
      // The tab row: 70 pixels a tab, and the mode switch 150.
      measure("clientWidth", (el) => (el.id === "rb-panel" ? widths.panel : el.classList.contains("rb-tabs") ? widths.tabs : undefined));
      measure("scrollWidth", (el) => (el.id === "rb-panel" ? Math.max(widths.panel, panelWidth(el)) : undefined));
      measure("offsetWidth", (el) =>
        el.classList.contains("rb-group") ? groupWidth(el) : el.getAttribute("role") === "tab" ? (el.hidden ? 0 : 70) : el.classList.contains("rb-right") ? 150 : undefined,
      );
    });
    afterEach(() => restore.splice(0).forEach((r) => r()));

    it("folds groups from the right into one button each, so that nothing has to be scrolled to", () => {
      render(<Ribbon {...props} symbolsOpen={false} />);
      const panel = document.getElementById("rb-panel")!;
      const groups = [...panel.querySelectorAll<HTMLElement>(":scope > .rb-group")];
      const folded = groups.map((g) => g.classList.contains("rb-folded"));
      // Home has six groups: 900 pixels whole; three folded bring it to 642, four to 556, five to 470.
      expect(folded).toEqual([false, true, true, true, true, true]);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
      expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
      const font = screen.getByRole("button", { name: "Font" });
      // A disclosure of the group's own tools, not a menu.
      expect(font.getAttribute("aria-haspopup")).toBeNull();
      expect(font.getAttribute("aria-expanded")).toBe("false");
    });

    it("opens a folded group's tools below its button, with the keyboard in them, and closes on Escape or once a tool is used", async () => {
      render(<Ribbon {...props} symbolsOpen={false} />);
      const font = screen.getByRole("button", { name: "Font" });
      // Pressed from the keyboard: the button has it.
      font.focus();
      fireEvent.click(font);
      expect(font.getAttribute("aria-expanded")).toBe("true");
      expect(document.getElementById(font.getAttribute("aria-controls")!)?.classList.contains("rb-pop")).toBe(true);
      const bold = screen.getByRole("button", { name: "Bold" });
      expect(bold.closest(".rb-pop")).toBeTruthy();
      expect(document.activeElement?.closest(".rb-pop")).toBeTruthy();
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
      expect(document.activeElement).toBe(font);
      fireEvent.click(font);
      // Put away only once the tool has had the click.
      fireEvent.click(screen.getByRole("button", { name: "Italic" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Italic" })).toBeNull());
      // Or once the keyboard goes elsewhere.
      font.focus();
      fireEvent.click(font);
      const outside = document.createElement("button");
      document.body.append(outside);
      fireEvent.focusOut(document.activeElement!, { relatedTarget: outside });
      expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
      outside.remove();
      // A click elsewhere puts it away too.
      fireEvent.click(font);
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
    });

    it("opened with the mouse, leaves the keyboard where it was, as in a table's cell being typed in", () => {
      render(<Ribbon {...props} symbolsOpen={false} />);
      const cell = document.createElement("input");
      document.body.append(cell);
      try {
        cell.focus();
        fireEvent.click(screen.getByRole("button", { name: "Font" }));
        expect(screen.getByRole("button", { name: "Bold" }).closest(".rb-pop")).toBeTruthy();
        expect(document.activeElement).toBe(cell);
        // Escape where the keyboard is puts it away, and only that: the cell never hears it.
        const heard = vi.fn();
        cell.addEventListener("keydown", heard);
        fireEvent.keyDown(cell, { key: "Escape" });
        expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
        expect(document.activeElement).toBe(cell);
        expect(heard).not.toHaveBeenCalled();
      } finally {
        cell.remove();
      }
    });

    it("puts what still does not fit, folded, into one More button, so that nothing has to be scrolled to", () => {
      widths.panel = 200;
      try {
        render(<Ribbon {...props} symbolsOpen={false} />);
        // Six groups folded are 384 pixels; with More, Undo and Clipboard stay in the row.
        const row = [...document.querySelectorAll<HTMLElement>("#rb-panel > .rb-group")].map((g) => g.dataset.label ?? "More");
        expect(row).toEqual(["Undo", "Clipboard", "More"]);
        const more = screen.getByRole("button", { name: "More" });
        expect(more.getAttribute("aria-expanded")).toBe("false");
        more.focus();
        fireEvent.click(more);
        expect(screen.getByRole("button", { name: "Bold" }).closest(".rb-pop")).toBeTruthy();
        expect(screen.getByRole("group", { name: "Styles" })).toBeTruthy();
        expect(document.activeElement?.closest(".rb-pop")).toBeTruthy();
        fireEvent.keyDown(document.activeElement!, { key: "Escape" });
        expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
        expect(document.activeElement).toBe(more);
      } finally {
        widths.panel = 520;
      }
    });

    it("offers the tabs the row has no room for from one button, keeping the tab on show in the row", () => {
      // 400 less the switch leaves 250: with the button's 32, three tabs of 70.
      widths.tabs = 400;
      try {
        render(<Ribbon {...props} symbolsOpen={false} />);
        const inRow = () => screen.getAllByRole("tab").map((t) => t.textContent);
        expect(inRow()).toEqual(["Home", "Insert", "Layout"]);
        fireEvent.click(screen.getByRole("button", { name: "More tabs" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Review" }));
        expect(inRow()).toEqual(["Home", "Insert", "Review"]);
        expect(screen.getByRole("tab", { name: "Review" }).getAttribute("aria-selected")).toBe("true");
      } finally {
        widths.tabs = 2000;
      }
    });

    it("draws every group whole again when the pane is wide enough", () => {
      widths.panel = 2000;
      try {
        render(<Ribbon {...props} symbolsOpen={false} />);
        expect(document.querySelectorAll(".rb-folded")).toHaveLength(0);
        expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
      } finally {
        widths.panel = 520;
      }
    });
  });
});
