// @vitest-environment jsdom
// A dialog gives the keyboard back where it came from, or, when that is gone, to what stands in for it.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Dialog } from "./ui";

afterEach(cleanup);

beforeAll(() => {
  // jsdom has the dialog element but not its modal showing.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
});

describe("Dialog", () => {
  it("gives the keyboard back to the control that opened it", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<Dialog title="Test" onClose={() => {}}>{null}</Dialog>);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("gives it to the button of a card that held the control, once the card is put away", () => {
    // A folded ribbon group: its button, and the card of tools it opened, one of which opens a dialog.
    const fold = document.createElement("button");
    fold.id = "fold-button";
    const card = document.createElement("div");
    card.dataset.returnTo = "fold-button";
    const tool = document.createElement("button");
    card.append(tool);
    document.body.append(fold, card);
    tool.focus();
    const { unmount } = render(<Dialog title="Test" onClose={() => {}}>{null}</Dialog>);
    card.remove();
    unmount();
    expect(document.activeElement).toBe(fold);
    fold.remove();
  });
});
