import { create } from "zustand";
import type { BuildOutput, Comment, ProjectIndex, ProjectInfo, Settings, TreeNode } from "../ipc/api";

export type View = "start" | "editor" | "history";
export type Layout = "split" | "editor" | "pdf";

export interface Tab {
  path: string;
  dirty: boolean;
}

/** A question the app is asking: a text prompt or a yes/no confirmation. */
export interface Ask {
  title: string;
  message?: string;
  /** Present for text prompts: the initial value. */
  value?: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (answer: string | null) => void;
}

export interface Highlight {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Changes on every jump so the same place can be highlighted twice in a row. */
  nonce: number;
}

export interface State {
  settings: Settings | null;
  view: View;
  layout: Layout;
  filesOpen: boolean;
  /** texlab is running for the open project. */
  languageServer: boolean;
  /** The editor draws the source with headings, emphasis and typeset mathematics. */
  visual: boolean;
  /** Visual mode draws the page view (a page that stays drawn under the cursor) rather than the draft view. */
  pageView: boolean;
  /** How large the page view draws the page, 1 being its printed size. */
  pageZoom: number;
  /** The Symbol panel is open. */
  symbols: boolean;
  /** What the side panel shows when it is open. */
  sidePanel: "files" | "search" | "comments";
  /** The project's comments, without the deleted ones. */
  comments: Comment[];
  /** The comment picked out in the panel and in the text. */
  comment: string | null;
  /** Width of the file panel in pixels. */
  filesWidth: number;
  /** Share of the remaining width given to the source pane, from 0 to 1. */
  split: number;
  root: string | null;
  info: ProjectInfo | null;
  tree: TreeNode[];
  index: ProjectIndex;
  tabs: Tab[];
  active: string | null;
  cursor: { line: number; column: number };
  /** Some text is selected in the editor. */
  selecting: boolean;
  compiling: boolean;
  build: BuildOutput | null;
  log: string[];
  /** Bumped whenever there is a new PDF to show. */
  pdfVersion: number;
  highlight: Highlight | null;
  /** Imported bundles still waiting for review. */
  pendingReviews: number;
  /** Bundle to select when History opens. */
  focusBundle: string | null;
  dialog: null | "export" | "logs" | "settings" | "newProject" | "shortcuts" | "setup" | "cite" | "reference" | "citationStyle" | "equation";
  ask: Ask | null;
  toast: { text: string; error: boolean } | null;
  set: (patch: Partial<State>) => void;
  notify: (text: string, error?: boolean) => void;
}

export const useStore = create<State>((set) => ({
  settings: null,
  view: "start",
  layout: "split",
  filesOpen: true,
  languageServer: false,
  // Visual mode is what a newcomer expects; the source is a click away.
  visual: true,
  pageView: true,
  pageZoom: 1,
  symbols: false,
  sidePanel: "files",
  comments: [],
  comment: null,
  filesWidth: 244,
  split: 0.52,
  root: null,
  info: null,
  tree: [],
  index: { labels: [], citeKeys: [], citations: [], stylePackages: {}, labelNumbers: {}, documentClass: "" },
  tabs: [],
  active: null,
  cursor: { line: 1, column: 1 },
  selecting: false,
  compiling: false,
  build: null,
  log: [],
  pdfVersion: 0,
  highlight: null,
  pendingReviews: 0,
  focusBundle: null,
  dialog: null,
  ask: null,
  toast: null,
  set: (patch) => set(patch),
  notify: (text, error = false) => set({ toast: { text, error } }),
}));

export const store = () => useStore.getState();

/** Ask for a line of text. Resolves to null when cancelled. */
export function prompt(title: string, value = "", confirmLabel = "OK", message?: string) {
  return new Promise<string | null>((resolve) =>
    store().set({ ask: { title, value, confirmLabel, message, resolve } }),
  );
}

/** Ask a yes/no question. */
export async function confirm(title: string, message: string, confirmLabel: string, danger = false) {
  const answer = await new Promise<string | null>((resolve) =>
    store().set({ ask: { title, message, confirmLabel, danger, resolve } }),
  );
  return answer !== null;
}
