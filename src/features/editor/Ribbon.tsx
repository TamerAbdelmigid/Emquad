// The ribbon of the page view: Word's tabs and groups, in Word's places, over the commands the
// editor already has. Every tool writes plain LaTeX, and its tooltip says which.
import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { type ReactNode, type RefObject, createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName, Menu, type MenuItem } from "../../design/ui";
import { useStore } from "../../state/store";
import { SymbolPicker } from "./SymbolPicker";
import { TablePicker } from "./TablePicker";
import { buffers } from "./buffers";
import { INSERT, type Insertion } from "./insertions";
import { headingAt } from "./latex";
import { keepChange, nextChange, toggleReveal, undoChange } from "./visual";
import { type Alignment, type BlockStyle, alignmentAt, blockStyleAt, environments } from "./blocks";
import type { Setup } from "./documentSetup";
import { COLOURS, formatAt } from "./formatting";
import { NUMBER_FORMATS, listAt, numberingAt } from "./lists";
import { type FloatHere, floatAt } from "./floats";
import { rowPlan, tabsShown } from "./ribbonFit";

/** What the ribbon asks of the app: the dialogs and actions that live outside the editor. */
export interface RibbonActions {
  equation: () => void;
  cite: () => void;
  zotero: () => void;
  bibliography: () => void;
  citationStyle: () => void;
  setup: () => void;
  comment: () => void;
  /** Line spacing for the whole document, set as Document setup sets it. */
  spacing: (spacing: Setup["spacing"]) => void;
  /** A setting of the Layout tab, for the whole document, set as Document setup sets it. */
  layout: (patch: Partial<Setup>) => void;
  /** Type the header's or the footer's text. */
  headerFooter: (which: "header" | "footer") => void;
  bookmark: () => void;
  compile: () => void;
  /** Save a snapshot; done when it is saved. */
  snapshot: () => Promise<unknown> | void;
  history: () => void;
  exportBundle: () => void;
  sendToWord: () => void;
  pdfWithComments: () => void;
  wordCount: () => void;
  /** Pick out the next comment, or the one before. */
  stepComment: (by: 1 | -1) => void;
  /** Show comments as balloons beside the page, or not. */
  balloons: (on: boolean) => void;
  /** The snapshots the changes can be shown since, newest first. */
  snapshots: () => Promise<{ id: string; label: string }[]>;
  /** Draw the changes since a snapshot on the page, or stop (null). */
  showChanges: (since: { id: string; label: string } | null) => void;
  packages: () => void;
  myCommands: () => void;
  logs: () => void;
  /** The commands the document defines, for their buttons. */
  myCommandList: () => Promise<{ name: string; body: string }[]>;
  insertMyCommand: (name: string) => void;
}

interface Props {
  actions: RibbonActions;
  active: boolean;
  chapters: boolean;
  symbolsOpen: boolean;
  onSymbols: (open: boolean) => void;
  recentSymbols: string[];
  onSymbolUsed: (id: string) => void;
  onCode: () => void;
  onShowChanges: () => void;
  pageView: boolean;
  onPageView: (page: boolean) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  /** The document class has an abstract environment. */
  abstract: boolean;
  /** How the document is set, or null when its settings cannot be read. */
  setup: Setup | null;
  marks: boolean;
  onMarks: (on: boolean) => void;
  /** Comments are shown as balloons beside the page. */
  balloons: boolean;
  /** The LaTeX is shown beside the page. */
  split: boolean;
  onSplit: (on: boolean) => void;
}

type TabName = "home" | "insert" | "layout" | "references" | "review" | "view" | "latex" | "picture";

/** A tool: a real button named for assistive technology, with what its tooltip says kept on it. */
function Tool(p: {
  name: string;
  keys?: string;
  tex?: string;
  why?: string;
  big?: boolean;
  icon?: IconName;
  glyph?: ReactNode;
  label?: string;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  run: () => void;
}) {
  return (
    <button
      type="button"
      className={`${p.big ? "rb-big" : "rb-tool"}${p.className ? ` ${p.className}` : ""}`}
      aria-label={p.name}
      // What the tooltip shows, for those who do not see it.
      aria-description={[p.keys, p.tex && `Writes ${p.tex}`, p.why].filter(Boolean).join(". ") || undefined}
      aria-pressed={p.pressed}
      disabled={p.disabled}
      data-tip={p.name}
      data-keys={p.keys}
      data-tex={p.tex}
      data-why={p.why}
      // Keep the cursor, and the selection, in the text while a tool is clicked.
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.run}
    >
      {p.icon ? <Icon name={p.icon} size={p.big ? 22 : 16} /> : p.glyph}
      {p.label && <span>{p.label}</span>}
    </button>
  );
}

/**
 * How the tab on show fits the pane: the groups folded into one button each, those moved into the
 * More button, and the element More's tools are drawn in while it is open.
 */
interface Fitting {
  folded: readonly string[];
  more: readonly string[];
  box: HTMLElement | null;
}
const Fit = createContext<Fitting>({ folded: [], more: [], box: null });

/** The icon a group shows when it is folded into one button. */
const GROUP_ICONS: Record<string, IconName> = {
  Undo: "undo",
  Clipboard: "paste",
  Font: "abc",
  Paragraph: "al-l",
  Styles: "toc",
  Editing: "search",
  Pages: "page",
  Tables: "table",
  Illustrations: "picture",
  Links: "link",
  "Header & Footer": "header",
  Text: "footnote",
  Equations: "sigma",
  Citations: "quote",
  "Page setup": "margins",
  "Paragraph · whole document": "spacing",
  Arrange: "picture",
  Document: "gear",
  "Size · of the line": "size",
  Picture: "picture",
  "Table of contents": "toc",
  Footnotes: "footnote",
  Captions: "caption",
  Proofing: "abc",
  Comments: "comment",
  Changes: "history",
  Versions: "snap",
  Share: "send",
  Views: "page",
  Zoom: "plus",
  LaTeX: "code",
  Window: "split",
  "Write LaTeX": "code",
  Learn: "learn",
  Build: "play",
};

/** A group drawn whole: its tools over its name. */
function WholeGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group" role="group" aria-label={label} data-label={label}>
      <div className="rb-tools">{children}</div>
      <div className="rb-label" aria-hidden="true">
        {label}
      </div>
    </div>
  );
}

/**
 * A group of tools under its name. To fit a narrow pane, as Word's ribbon does, it is folded into
 * one button that opens its tools below it, or, narrower still, moved into the More button. `open`
 * holds it open while something in it is in use from elsewhere, such as the Symbol panel opened
 * from the Insert menu.
 */
function Group({ label, open: held = false, children }: { label: string; open?: boolean; children: ReactNode }) {
  const fit = useContext(Fit);
  const [open, setOpen] = useState(false);
  /** Opened from the keyboard, so the keyboard goes into it. */
  const [grab, setGrab] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const folded = fit.folded.includes(label) && !fit.more.includes(label);
  // Unfolded while open, it is shut, so that folding again later does not open it unasked.
  if (open && !folded) setOpen(false);
  if (fit.more.includes(label)) return fit.box ? createPortal(<WholeGroup label={label}>{children}</WholeGroup>, fit.box) : null;
  if (!folded) return <WholeGroup label={label}>{children}</WholeGroup>;
  const shown = open || held;
  return (
    <FoldButton label={label} icon={GROUP_ICONS[label] ?? "chev"} button={button} shown={shown} controls={id} onToggle={() => (setGrab(document.activeElement === button.current), setOpen(!shown))} className="rb-group rb-folded" data-label={label}>
      {shown && (
        <FoldedTools id={id} label={label} anchor={button} grab={open && grab} onClose={(refocus) => (setOpen(false), refocus && button.current?.focus())}>
          {children}
        </FoldedTools>
      )}
    </FoldButton>
  );
}

/** The button a folded group, or More, is drawn as, with what it opens. */
function FoldButton(p: {
  label: string;
  icon: IconName;
  button: RefObject<HTMLButtonElement | null>;
  shown: boolean;
  /** The id of what it opens. */
  controls: string;
  onToggle: () => void;
  className: string;
  "data-label"?: string;
  children: ReactNode;
}) {
  // A disclosure, not a menu: what it opens is the group's own tools.
  return (
    <div className={p.className} data-label={p["data-label"]}>
      <button
        ref={p.button}
        type="button"
        className="rb-big rb-fold"
        aria-expanded={p.shown}
        aria-controls={p.shown ? p.controls : undefined}
        data-tip={p.label}
        data-why="Folded to fit the pane: its tools open below. A wider pane shows them all."
        onMouseDown={(e) => e.preventDefault()}
        onClick={p.onToggle}
      >
        <Icon name={p.icon} size={22} />
        <span>
          {p.label}
          <Icon name="chev" size={10} />
        </span>
      </button>
      <div className="rb-label" aria-hidden="true">
        &nbsp;
      </div>
      {p.children}
    </div>
  );
}

/**
 * Folded tools, below their button: put away by Escape, a click elsewhere, or using a tool. For
 * More, the groups are drawn into it from where they stand (`into`), so its own handling listens
 * to what happens inside it in the page rather than in React's tree.
 */
function FoldedTools(p: {
  id: string;
  label: string;
  /** Take the keyboard, as a menu opened from the keyboard does. Opened with the mouse, or for a
   * panel inside asked for from elsewhere, it stays where it was: in the text, or a table's cell. */
  grab: boolean;
  anchor: RefObject<HTMLButtonElement | null>;
  onClose: (refocus: boolean) => void;
  into?: (el: HTMLDivElement | null) => void;
  /** Changes when what it holds is drawn, so that it is placed and focused again. */
  filled?: unknown;
  children?: ReactNode;
}) {
  const { anchor, filled, grab } = p;
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(p.onClose);
  close.current = p.onClose;
  const focused = useRef(false);
  // Placed again when the window changes size, so that it stays inside it.
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const bump = () => setResized((n) => n + 1);
    window.addEventListener("resize", bump);
    return () => window.removeEventListener("resize", bump);
  }, []);
  useLayoutEffect(() => {
    const button = anchor.current?.getBoundingClientRect();
    const width = box.current?.offsetWidth ?? 0;
    if (button) {
      const left = Math.max(8, Math.min(button.left, window.innerWidth - width - 8));
      setAt((was) => (was?.left === left && was.top === button.bottom + 4 ? was : { left, top: button.bottom + 4 }));
    }
    // The keyboard goes to the first tool, as a menu's does, once there is one and it is placed:
    // until then it is hidden, and a hidden button cannot take the keyboard.
    const first = box.current?.querySelector<HTMLElement>("button:not(:disabled)");
    if (grab && at && first && !focused.current) {
      focused.current = true;
      first.focus();
    }
  }, [anchor, filled, at, resized, grab]);
  useEffect(() => {
    const el = box.current;
    const outside = (target: EventTarget | null) => target instanceof Node && !el?.contains(target) && !anchor.current?.contains(target);
    const away = (e: MouseEvent) => {
      if (outside(e.target)) close.current(false);
    };
    const left = () => close.current(false);
    // The keyboard taken elsewhere, by Tab or by a tool that gives it back to the writing.
    const gone = (e: FocusEvent) => {
      if (outside(e.relatedTarget)) close.current(false);
    };
    // Opened with the mouse, the keyboard is still elsewhere: Escape there puts it away too.
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !el?.contains(document.activeElement)) close.current(false);
    };
    const key = (e: KeyboardEvent) => {
      // A menu or panel open inside takes its own Escape first.
      if (e.key === "Escape" && !el?.querySelector(".menu-list, .sym-pop, .tpick-pop")) {
        e.stopPropagation();
        close.current(true);
      }
    };
    let later = 0;
    const click = (e: MouseEvent) => {
      // A tool used puts the tools away; one that opens a menu or a panel leaves them open. Put
      // away after the tool has had the click: React hears it further up, and a tool taken out
      // of the page before then would never run.
      const used = (e.target as HTMLElement).closest("button");
      if (used && !used.hasAttribute("aria-haspopup")) later = window.setTimeout(() => close.current(false));
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("blur", left);
    window.addEventListener("keydown", escape);
    el?.addEventListener("focusout", gone);
    el?.addEventListener("keydown", key);
    el?.addEventListener("click", click);
    return () => {
      clearTimeout(later);
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("blur", left);
      window.removeEventListener("keydown", escape);
      el?.removeEventListener("focusout", gone);
      el?.removeEventListener("keydown", key);
      el?.removeEventListener("click", click);
    };
  }, [anchor]);
  return (
    <div ref={box} id={p.id} className={p.into ? "rb-pop rb-pop-more" : "rb-pop"} role="group" aria-label={p.label} style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }}>
      <div className="rb-tools" ref={p.into}>
        {p.children}
      </div>
      {!p.into && (
        <div className="rb-label" aria-hidden="true">
          {p.label}
        </div>
      )}
    </div>
  );
}

/** A folded group's, and More's, width before it is first drawn. */
const FOLDED_GUESS = 72;

/**
 * Which groups of the tab on show to fold, and which to move into More, so that its row fits the
 * pane, worked out from each group's width as drawn: whole when it was last drawn whole, as one
 * button when folded.
 */
function useFolding(panel: RefObject<HTMLDivElement | null>, shown: TabName) {
  const whole = useRef(new Map<string, number>());
  const one = useRef(new Map<string, number>());
  /** The tab's groups in order, as last seen all in the row: those in More are not. */
  const order = useRef(new Map<TabName, string[]>());
  const none = { tab: shown, labels: [] as string[], more: [] as string[], over: false };
  const [fold, setFold] = useState(none);
  const current = fold.tab === shown ? fold : none;
  const key = `${current.labels.join("\n")}|${current.more.join("\n")}`;
  // Measured again whenever the pane, or any group in it, changes width: the window is resized,
  // or a group gains tools (the document's own commands, read when the LaTeX tab opens).
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const el = panel.current;
    // Without a ResizeObserver (a test's page) the row is fitted as it is drawn, not on resizing.
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setResized((n) => n + 1));
    watch.observe(el);
    for (const g of el.querySelectorAll(":scope > .rb-group")) watch.observe(g);
    return () => watch.disconnect();
  }, [panel, shown, key]);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const inRow = [...el.querySelectorAll<HTMLElement>(":scope > .rb-group[data-label]")];
    for (const g of inRow) {
      const label = g.dataset.label ?? "";
      if (g.classList.contains("rb-folded")) one.current.set(label, g.offsetWidth);
      else whole.current.set(`${shown}|${label}`, g.offsetWidth);
    }
    const seen = inRow.map((g) => g.dataset.label ?? "");
    if (current.more.length === 0) order.current.set(shown, seen);
    const labels = order.current.get(shown) ?? seen;
    const moreButton = el.querySelector<HTMLElement>(":scope > .rb-more");
    const moreWidth = moreButton?.offsetWidth || FOLDED_GUESS;
    const full = labels.map((l) => whole.current.get(`${shown}|${l}`) ?? 0);
    const folded = labels.map((l) => one.current.get(l) ?? FOLDED_GUESS);
    const style = getComputedStyle(el);
    const available = el.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    const plan = rowPlan(full, folded, available, moreWidth);
    const next = { labels: labels.filter((_, i) => plan.fold[i]), more: labels.filter((_, i) => plan.more[i]) };
    // Even More alone too wide: the row scrolls, as the last resort.
    const width = full.reduce((sum, w, i) => sum + (plan.more[i] ? 0 : plan.fold[i] ? folded[i] : w), 0) + (next.more.length ? moreWidth : 0);
    const over = width > available;
    if (`${next.labels.join("\n")}|${next.more.join("\n")}` !== key || over !== current.over) setFold({ tab: shown, ...next, over });
  }, [panel, shown, key, current.more.length, current.over, resized]);
  return current;
}

/**
 * The tabs that do not fit the row beside the mode switch, from the right, offered from one
 * button instead; the tab on show always keeps its place. Worked out from each tab's width as last
 * drawn in the row.
 */
function useTabsFit(row: RefObject<HTMLDivElement | null>, ids: TabName[], shown: TabName) {
  const widths = useRef(new Map<string, number>());
  const [hidden, setHidden] = useState<TabName[]>([]);
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setResized((n) => n + 1));
    watch.observe(el);
    const right = el.querySelector(".rb-right");
    if (right) watch.observe(right);
    return () => watch.disconnect();
  }, [row]);
  const idsKey = ids.join(" ");
  const hiddenKey = hidden.join(" ");
  useLayoutEffect(() => {
    const el = row.current;
    // Not laid out (a test's page): every tab keeps its place.
    if (!el || el.clientWidth === 0) return;
    for (const tab of el.querySelectorAll<HTMLElement>("[role=tab]")) if (tab.offsetWidth) widths.current.set(tab.id, tab.offsetWidth);
    const list = idsKey.split(" ") as TabName[];
    const style = getComputedStyle(el);
    const px = (v: string) => Number.parseFloat(v) || 0;
    const gap = px(style.columnGap);
    const right = el.querySelector<HTMLElement>(".rb-right")?.offsetWidth ?? 0;
    const overflow = (el.querySelector<HTMLElement>(".rb-tabs-more")?.offsetWidth || 32) + gap;
    const available = el.clientWidth - px(style.paddingLeft) - px(style.paddingRight) - right - gap;
    const between = px(getComputedStyle(el.querySelector(".rb-tablist") ?? el).columnGap);
    const keep = tabsShown(
      list.map((t) => widths.current.get(`rb-tab-${t}`) ?? 0),
      list.indexOf(shown),
      available,
      overflow,
      between,
    );
    const next = list.filter((_, i) => !keep[i]);
    if (next.join(" ") !== hiddenKey) setHidden(next);
  }, [row, idsKey, shown, hiddenKey, resized]);
  return hidden;
}

const insertTool = (ins: Insertion, icon: IconName, big = false, disabled = false) => (
  <Tool name={ins.label} tex={ins.tex} icon={icon} big={big} label={big ? ins.label : undefined} disabled={disabled} run={ins.run} />
);

/** The tooltip: the tool's name, its keys, and the LaTeX it writes. One for the whole ribbon. */
function Tip({ root }: { root: React.RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<{ el: HTMLElement; x: number; y: number } | null>(null);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let timer = 0;
    const show = (e: Event) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-tip]");
      clearTimeout(timer);
      if (!el || !host.contains(el)) return setTip(null);
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setTip({ el, x: Math.max(8, Math.min(window.innerWidth - 320, r.left)), y: r.bottom + 6 });
      }, e.type === "focusin" ? 0 : 450);
    };
    const hide = () => {
      clearTimeout(timer);
      setTip(null);
    };
    host.addEventListener("mouseover", show);
    host.addEventListener("focusin", show);
    host.addEventListener("mouseleave", hide);
    host.addEventListener("focusout", hide);
    host.addEventListener("mousedown", hide);
    return () => {
      clearTimeout(timer);
      host.removeEventListener("mouseover", show);
      host.removeEventListener("focusin", show);
      host.removeEventListener("mouseleave", hide);
      host.removeEventListener("focusout", hide);
      host.removeEventListener("mousedown", hide);
    };
  }, [root]);
  if (!tip) return null;
  const { tip: name, keys, tex, why } = tip.el.dataset;
  return (
    <div className="rb-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <div className="rb-tip-name">
        {name}
        {keys && <kbd>{keys}</kbd>}
      </div>
      {tex && <code>{tex}</code>}
      {why && <div className="rb-tip-why">{why}</div>}
    </div>
  );
}

/** What the text at the cursor is set in, for the tools to show pressed: its style, formats, list and alignment. */
interface Here {
  style: string;
  heads: string[];
  list: string | null;
  numbering: string | null;
  alignment: Alignment;
  /** The figure or table the cursor is in. */
  float: FloatHere | null;
}

/**
 * Where the cursor is, read again once it rests: reading a long document at every keystroke
 * would hold up typing. Very long files are not read at all.
 */
function useHere(): Here | null {
  const cursor = useStore((s) => s.cursor);
  const active = useStore((s) => s.active);
  const [here, setHere] = useState<Here | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const text = active ? buffers.text(active) : undefined;
      const at = buffers.cursorAt();
      if (text === undefined || at === null || text.length > 400_000) return setHere(null);
      const envs = environments(text);
      setHere({
        style: headingAt(text, at)?.level ?? blockStyleAt(text, at, envs) ?? "normal",
        heads: formatAt(text, at),
        list: listAt(text, at),
        numbering: numberingAt(text, at),
        alignment: alignmentAt(text, at, envs),
        float: floatAt(text, at),
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [cursor, active]);
  return here;
}

const STYLES: { level: string | null; block?: BlockStyle; id: string; name: string; tex: string; why?: string }[] = [
  { level: null, id: "normal", name: "Normal", tex: "(ordinary text: a blank line ends a paragraph)" },
  { level: "chapter", id: "chapter", name: "Chapter", tex: "\\chapter{…}" },
  { level: "section", id: "section", name: "Heading 1", tex: "\\section{…}" },
  { level: "subsection", id: "subsection", name: "Heading 2", tex: "\\subsection{…}" },
  { level: "subsubsection", id: "subsubsection", name: "Heading 3", tex: "\\subsubsection{…}" },
  { level: "paragraph", id: "paragraph", name: "Run-in", tex: "\\paragraph{…}" },
  { level: null, block: "quote", id: "quote", name: "Quote", tex: "\\begin{quote}\n  …\n\\end{quote}", why: "Indented on both sides, for a passage quoted at length." },
  { level: null, block: "abstract", id: "abstract", name: "Abstract", tex: "\\begin{abstract}\n  …\n\\end{abstract}", why: "The summary at the start of a paper, set under its own heading." },
];

/** Character formats on the Font group, in Word's order, with the LaTeX each writes. */
const FONT: { name: string; command: string; keys?: string; why?: string; glyph: ReactNode }[] = [
  { name: "Bold", command: "textbf", keys: "Ctrl+B", glyph: <b>B</b> },
  { name: "Italic", command: "textit", keys: "Ctrl+I", glyph: <i>I</i> },
  { name: "Underline", command: "underline", keys: "Ctrl+U", glyph: <u>U</u> },
  { name: "Strikethrough", command: "sout", why: "Loads the ulem package for you, set so that \\emph stays italic.", glyph: <s>S</s> },
  { name: "Subscript", command: "textsubscript", keys: "Ctrl+=", glyph: <span className="rb-script">x<sub>2</sub></span> },
  { name: "Superscript", command: "textsuperscript", keys: "Ctrl+Shift+=", glyph: <span className="rb-script">x<sup>2</sup></span> },
  { name: "Small capitals", command: "textsc", glyph: <span className="rb-sc">Sc</span> },
  {
    name: "Emphasis",
    command: "emph",
    why: "Italic in upright text and upright inside italic: what LaTeX means by stressing a word.",
    glyph: <em>E</em>,
  },
  { name: "Typewriter", command: "texttt", glyph: <span className="mono">Tt</span> },
];

const SPACINGS: { id: Setup["spacing"]; name: string; tex: string }[] = [
  { id: "single", name: "Single", tex: "" },
  { id: "onehalf", name: "1.5 lines", tex: "\\onehalfspacing" },
  { id: "double", name: "Double", tex: "\\doublespacing" },
];

const ALIGN: { id: Alignment; name: string; icon: IconName; keys?: string; tex?: string; why?: string }[] = [
  { id: "left", name: "Align left", icon: "al-l", tex: "\\begin{flushleft} … \\end{flushleft}" },
  { id: "center", name: "Centre", icon: "al-c", keys: "Ctrl+E", tex: "\\begin{center} … \\end{center}" },
  { id: "right", name: "Align right", icon: "al-r", tex: "\\begin{flushright} … \\end{flushright}" },
  { id: "justify", name: "Justify", icon: "al-j", why: "LaTeX's own setting: nothing is written, and alignment written before is taken away." },
];

/** A tall tool that opens a menu, its word under its icon. */
function BigMenu(p: { name: string; icon: IconName; tex?: string; why?: string; disabled?: boolean; items: (MenuItem | "separator")[] }) {
  return (
    <Menu
      className="rb-big"
      ariaLabel={p.name}
      label={
        <>
          <Icon name={p.icon} size={22} />
          <span>
            {p.name} <Icon name="chev" size={10} />
          </span>
        </>
      }
      disabled={p.disabled}
      buttonProps={{ "data-tip": p.name, "data-tex": p.tex, "data-why": p.why }}
      items={p.items}
    />
  );
}

/** Word's margins, written as geometry's margin on every side. */
const MARGINS: { label: string; value: string }[] = [
  { label: "Normal · 2.5 cm", value: "2.5cm" },
  { label: "Narrow · 1.27 cm", value: "1.27cm" },
  { label: "Moderate · 1.9 cm", value: "1.9cm" },
  { label: "Wide · 3.5 cm", value: "3.5cm" },
  { label: "LaTeX's own", value: "" },
];

const PAPERS: { label: string; value: string }[] = [
  { label: "A4 · 21 × 29.7 cm", value: "a4paper" },
  { label: "Letter · 8.5 × 11 in", value: "letterpaper" },
  { label: "A5 · 14.8 × 21 cm", value: "a5paper" },
  { label: "B5 · 17.6 × 25 cm", value: "b5paper" },
  { label: "Legal · 8.5 × 14 in", value: "legalpaper" },
  { label: "Executive · 7.25 × 10.5 in", value: "executivepaper" },
  { label: "The class's own (Letter)", value: "" },
];

/** Why LaTeX moves pictures and tables, in one sentence, as the Position tool says it. */
export const WHY_FLOATS =
  "LaTeX places pictures and tables where they fit best, so that no page is left half empty, and the text refers to them by number; here you can ask for a place.";

/** Where a figure or table may go, and what each choice writes. */
export const PLACES: { label: string; value: string }[] = [
  { label: "Where it fits best", value: "htbp" },
  { label: "Here, if it fits", value: "h" },
  { label: "Top of a page", value: "t" },
  { label: "A page of its own", value: "p" },
  { label: "Exactly here", value: "H" },
];

/** The Position menu, for the figure or table the cursor is in. */
const placeItems = (here: FloatHere | null): MenuItem[] =>
  PLACES.map((pl) => ({
    label: pl.label,
    hint: `[${pl.value}]${pl.value === "H" ? " float" : ""}`,
    checked: here !== null && (here.placement || "tbp") === pl.value,
    disabled: !here,
    run: () => buffers.placement(pl.value),
  }));

/** Each tab's KeyTip, as Word has them. */
const TAB_KEYS: Record<TabName, string> = { home: "H", insert: "N", layout: "P", references: "S", review: "R", view: "W", latex: "X", picture: "J" };

/**
 * Word's KeyTips: Alt pressed and let go alone shows a letter on each tab; pressing one chooses
 * the tab and shows a letter on each of its tools, and pressing that uses the tool. Escape goes
 * back a step; a click or any other key puts them away. Alt held for a shortcut shows nothing.
 */
function useKeyTips(root: RefObject<HTMLElement | null>, tabs: TabName[], shown: TabName, choose: (tab: TabName) => void) {
  const [mode, setModeShown] = useState<"off" | "tabs" | "tools">("off");
  const [tips, setTips] = useState<{ key: string; x: number; y: number; el: HTMLElement }[]>([]);
  // Kept beside what is drawn, so that each key sees the one before it at once.
  const modeNow = useRef(mode);
  const tipsNow = useRef(tips);
  tipsNow.current = tips;
  /** What had the keyboard when the tips came on, to give it back to. */
  const cameFrom = useRef<Element | null>(null);
  const setMode = (next: "off" | "tabs" | "tools" | ((was: "off" | "tabs" | "tools") => "off" | "tabs" | "tools")) => {
    modeNow.current = typeof next === "function" ? next(modeNow.current) : next;
    setModeShown(modeNow.current);
  };
  const tabsKey = tabs.join(" ");
  useEffect(() => {
    let alone = false;
    // A dialog has the keyboard to itself.
    const dialogOpen = () => Boolean(document.querySelector("dialog[open]"));
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        alone = !e.ctrlKey && !e.shiftKey && !e.metaKey && !dialogOpen();
        return;
      }
      alone = false;
      const mode = modeNow.current;
      if (mode === "off") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setMode(mode === "tools" ? "tabs" : "off");
      const key = e.key.toUpperCase();
      if (mode === "tabs") {
        const tab = tabsKey.split(" ").find((t) => TAB_KEYS[t as TabName] === key) as TabName | undefined;
        if (!tab) return setMode("off");
        choose(tab);
        return setMode("tools");
      }
      const tool = tipsNow.current.find((t) => t.key === key);
      setMode("off");
      if (tool) {
        tool.el.focus();
        tool.el.click();
        // A menu keeps the keyboard; any other tool gives it back to the writing.
        if (!tool.el.hasAttribute("aria-haspopup") && !tool.el.hasAttribute("aria-expanded")) {
          tool.el.blur();
          // To the LaTeX side of Split when the typing was there, else to the page.
          const side = buffers.sourceView();
          if (side && cameFrom.current && side.dom.contains(cameFrom.current)) side.focus();
          else buffers.run(() => true);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt" && alone && !dialogOpen()) {
        e.preventDefault();
        if (modeNow.current === "off") cameFrom.current = document.activeElement;
        setMode((m) => (m === "off" ? "tabs" : "off"));
      }
      alone = false;
    };
    // A click, or leaving the window, puts them away, and Alt let go after it shows none.
    const away = () => {
      alone = false;
      if (modeNow.current !== "off") setMode("off");
    };
    const hidden = () => document.visibilityState === "hidden" && away();
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("mousedown", away, true);
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [tabsKey, choose]);
  // Where each letter goes, read from the ribbon as it is drawn.
  useLayoutEffect(() => {
    const host = root.current;
    if (mode === "off" || !host) return setTips([]);
    const box = host.getBoundingClientRect();
    const at = (el: HTMLElement, key: string) => {
      const r = el.getBoundingClientRect();
      return { key, el, x: r.left - box.left + r.width / 2 - 7, y: r.bottom - box.top - 10 };
    };
    if (mode === "tabs") {
      return setTips(
        tabsKey
          .split(" ")
          .map((t) => [document.getElementById(`rb-tab-${t}`), TAB_KEYS[t as TabName]] as const)
          .flatMap(([el, key]) => (el && !el.hidden ? [at(el, key)] : [])),
      );
    }
    // A tool's letter is the first of its name not taken already, else a digit.
    const used = new Set<string>();
    const out: { key: string; x: number; y: number; el: HTMLElement }[] = [];
    for (const el of host.querySelectorAll<HTMLButtonElement>("#rb-panel button:not(:disabled)")) {
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").toUpperCase();
      const key = [...name.replace(/[^A-Z]/g, ""), ..."123456789"].find((c) => !used.has(c));
      if (!key) continue;
      used.add(key);
      out.push(at(el, key));
    }
    setTips(out);
  }, [mode, shown, tabsKey, root]);
  return tips;
}

/** The page and its LaTeX side by side, or the page alone. */
function SplitTool(p: Props) {
  return (
    <Tool
      name="Split with LaTeX"
      icon="split"
      big
      label="Split"
      why="The page and its LaTeX side by side: edit either, and the paragraph you are in is lit in the other."
      pressed={p.split}
      disabled={!p.active}
      run={() => p.onSplit(!p.split)}
    />
  );
}

/** The LaTeX tab, the bridge: write LaTeX, learn it, the document's settings and commands, and the build. */
function LatexTab(p: Props & { off: boolean }) {
  const off = p.off;
  const [mine, setMine] = useState<{ name: string; body: string }[]>([]);
  const read = useRef(p.actions.myCommandList);
  read.current = p.actions.myCommandList;
  const dialog = useStore((s) => s.dialog);
  useEffect(() => {
    // Read as the tab opens, and again after the My commands dialog closes.
    if (off || dialog) return;
    let live = true;
    void read
      .current()
      .then((list) => live && setMine(list))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [off, dialog]);
  return (
    <>
      <Group label="Write LaTeX">
        <Tool
          name="Show LaTeX"
          keys="Ctrl+/"
          icon="code"
          big
          label="Show LaTeX"
          why="Opens the paragraph, table or figure you are in as its LaTeX, right on the page. Ctrl+/ again draws it again."
          disabled={off || !p.pageView}
          run={() => buffers.run(toggleReveal)}
        />
        <SplitTool {...p} />
      </Group>
      <Group label="Learn">
        <Tool
          name="LaTeX marks"
          keys="Ctrl+Shift+8"
          icon="marks"
          big
          label="Marks"
          why="Like Word's ¶: the commands are shown faintly around the text."
          pressed={p.marks}
          run={() => p.onMarks(!p.marks)}
        />
      </Group>
      <Group label="Document">
        <Tool name="Packages" icon="pkg" big label="Packages…" why="What each \usepackage line in the settings at the top is for, and which tool loaded it." disabled={off} run={p.actions.packages} />
        <Tool name="My commands" icon="wand" big label="My commands…" why="Make a shortcut from the selection: \newcommand. Your commands appear as buttons here." disabled={off} run={p.actions.myCommands} />
        {mine.length > 0 && (
          <div className="rb-col rb-mine">
            {mine.slice(0, 9).map((c) => (
              <Tool key={c.name} name={`\\${c.name}`} tex={`\\${c.name}{}`} why={`Prints: ${c.body}`} glyph={<span className="mono">\{c.name}</span>} className="wide" disabled={off} run={() => p.actions.insertMyCommand(c.name)} />
            ))}
          </div>
        )}
      </Group>
      <Group label="Build">
        <Tool name="Recompile" keys="Ctrl+Enter" icon="play" big label="Recompile" disabled={off} run={p.actions.compile} />
        <Tool name="Logs" icon="log" big label="Logs" why="What the compiler said, and the errors explained." run={p.actions.logs} />
      </Group>
    </>
  );
}

/** Word's Review tab: proofing, comments, the changes since a snapshot, versions and sharing. */
function ReviewTab(p: Props & { off: boolean }) {
  const off = p.off;
  const [snapshots, setSnapshots] = useState<{ id: string; label: string }[]>([]);
  const actions = p.actions;
  // Read once as the tab opens, not at every render: the app's actions are new each time.
  const read = useRef(actions.snapshots);
  read.current = actions.snapshots;
  const live = useRef(true);
  const refetch = () =>
    void read
      .current()
      .then((list) => live.current && setSnapshots(list))
      .catch(() => {});
  useEffect(() => {
    live.current = true;
    if (!off) refetch();
    return () => {
      live.current = false;
    };
  }, [off]);
  const [shown, setShown] = useState<{ since: string; count: number } | null>(null);
  // Read again now and then: changes are shown, kept and undone from here and from the page.
  useEffect(() => {
    const read = () =>
      setShown((was) => {
        const now = buffers.changesShown();
        return was?.since === now?.since && was?.count === now?.count ? was : now;
      });
    read();
    const timer = window.setInterval(read, 400);
    return () => window.clearInterval(timer);
  }, []);
  const showing = shown !== null;
  return (
    <>
      <Group label="Proofing">
        <Tool name="Word count" icon="abc" big label="Word count" why="Words as they print: commands, mathematics and the settings at the top are left out." disabled={off} run={actions.wordCount} />
      </Group>
      <Group label="Comments">
        <Tool name="New comment" keys="Ctrl+Alt+M" icon="comment" big label="New comment" why="Kept beside the project, never written into the file. Travels in bundles." disabled={off} run={actions.comment} />
        <div className="rb-col">
          <Tool name="Previous comment" icon="up" label="Previous" disabled={off} run={() => actions.stepComment(-1)} />
          <Tool name="Next comment" icon="down" label="Next" disabled={off} run={() => actions.stepComment(1)} />
          <Tool name="Show comments" icon="eye" label="Show comments" why="As balloons beside the page." pressed={p.balloons} run={() => actions.balloons(!p.balloons)} />
        </div>
      </Group>
      <Group label="Changes">
        <BigMenu
          name="Show changes"
          icon="history"
          why="Instead of Track Changes: the page shows what changed since a snapshot, in each author's colour, so there is nothing to forget to switch on."
          disabled={off}
          items={[
            ...(snapshots.length ? snapshots.map((s) => ({ label: `Since “${s.label}”`, checked: shown?.since === s.label, run: () => actions.showChanges(s) })) : [{ label: "No snapshots yet: save one now", hint: "Ctrl+Shift+S", run: () => void Promise.resolve(actions.snapshot()).then(refetch) }]),
            "separator" as const,
            { label: "Stop showing changes", disabled: !showing, run: () => actions.showChanges(null) },
          ]}
        />
        <div className="rb-col">
          <Tool name="Keep change" icon="check" label="Keep" why="The change stays; its marks go." disabled={off || !shown?.count} run={() => (buffers.run(keepChange), setShown(buffers.changesShown()))} />
          <Tool name="Undo change" icon="x" label="Undo change" why="Puts back what the snapshot had." disabled={off || !shown?.count} run={() => (buffers.run(undoChange), setShown(buffers.changesShown()))} />
          <Tool name="Next change" icon="down" label="Next" disabled={off || !shown?.count} run={() => buffers.run(nextChange)} />
        </div>
      </Group>
      <Group label="Versions">
        <Tool name="Save snapshot" keys="Ctrl+Shift+S" icon="snap" big label="Snapshot" disabled={off} run={() => void Promise.resolve(actions.snapshot()).then(refetch)} />
        <Tool name="Compare versions" keys="Ctrl+Shift+H" icon="history" big label="Compare" why="History: every version, and what changed between them." disabled={off} run={actions.history} />
      </Group>
      <Group label="Share">
        <div className="rb-col">
          <Tool name="Send as bundle" keys="Ctrl+Shift+E" icon="send" label="Send as bundle" disabled={off} run={actions.exportBundle} />
          <Tool name="Send to Word" icon="word" label="Send to Word" why="Through Pandoc, for a reader who uses Word." disabled={off} run={actions.sendToWord} />
          <Tool name="PDF with comments" icon="page" label="PDF with comments" disabled={off} run={actions.pdfWithComments} />
        </div>
      </Group>
    </>
  );
}

/** A style from the gallery: a heading level, a block style, or Normal, which takes either off. */
function setStyle(s: (typeof STYLES)[number], current: string | null) {
  if (s.block) return buffers.blockStyle(s.block);
  if (s.id === "normal" && (current === "quote" || current === "abstract")) return buffers.blockStyle(null);
  buffers.heading(s.level);
}

/** A colour's swatch, drawn in its colour. */
const Swatch = ({ name }: { name: string }) => <i className={`rb-swatch cm-v-color-${name}`} aria-hidden="true" />;

/** Font colour: a palette named once in the settings at the top; Automatic takes the colour off. */
export function colourItems(): MenuItem[] {
  return [
    ...COLOURS.map((c) => ({ label: c.label, hint: `\\textcolor{${c.name}}`, icon: <Swatch name={c.name} />, run: () => buffers.colour(c.name) })),
    { label: "Automatic (black)", run: () => buffers.colour(null) },
  ];
}

export function Ribbon(p: Props) {
  const [tab, setTab] = useState<TabName>("home");
  const root = useRef<HTMLDivElement>(null);
  // The Symbol panel lives on the Insert tab: asked for from elsewhere (Insert ▸ Symbol…), it is shown there.
  if (p.symbolsOpen && tab !== "insert") setTab("insert");
  const here = useHere();
  const style = here?.style ?? null;
  const heads = here?.heads ?? [];
  const painting = useStore((s) => s.painting);
  const off = !p.active;
  const setup = p.setup;
  const unset = off || setup === null;
  // A figure's own tab, shown while the cursor is in one, as Word shows Picture Format.
  const figure = here?.float?.kind === "figure" ? here.float : null;
  // Out of the figure, its tab goes, back to Home, and is not chosen again by the next figure.
  if (tab === "picture" && !figure) setTab("home");
  const shown: TabName = tab === "picture" && !figure ? "home" : tab;
  const tabs: [TabName, string][] = [
    ["home", "Home"],
    ["insert", "Insert"],
    ["layout", "Layout"],
    ["references", "References"],
    ["review", "Review"],
    ["view", "View"],
    ["latex", "LaTeX"],
    ...(figure ? [["picture", "Picture"] as [TabName, string]] : []),
  ];
  const panel = useRef<HTMLDivElement>(null);
  const folding = useFolding(panel, shown);
  const tabRow = useRef<HTMLDivElement>(null);
  const tabsHidden = useTabsFit(
    tabRow,
    tabs.map(([id]) => id),
    shown,
  );
  // More: the groups that do not fit even folded, opened from one button at the end of the row.
  const moreButton = useRef<HTMLButtonElement>(null);
  // Open for the tab it was opened on, and shut once there is nothing in it, so that it never opens unasked.
  const [moreFor, setMoreFor] = useState<TabName | null>(null);
  const [moreGrab, setMoreGrab] = useState(false);
  if (moreFor !== null && (moreFor !== shown || folding.more.length === 0)) setMoreFor(null);
  const moreOpen = moreFor === shown;
  const moreId = useId();
  const [moreBox, setMoreBox] = useState<HTMLDivElement | null>(null);
  // The Symbol panel, asked for from the Insert menu while its group is in More, opens More.
  const moreShown = folding.more.length > 0 && (moreOpen || (p.symbolsOpen && folding.more.includes("Text")));
  const keyTips = useKeyTips(
    root,
    tabs.map(([id]) => id),
    shown,
    setTab,
  );
  return (
    <div className="ribbon" ref={root}>
      <div className="rb-tabs" ref={tabRow}>
        <div role="tablist" aria-label="Ribbon" className="rb-tablist">
          {tabs.map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`rb-tab-${id}`}
              aria-selected={shown === id}
              aria-controls="rb-panel"
              className={id === "picture" ? "rb-tab rb-ctx" : id === "latex" ? "rb-tab rb-lx" : "rb-tab"}
              hidden={tabsHidden.includes(id)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab(id)}
            >
              {name}
            </button>
          ))}
        </div>
        {/* The tabs the row has no room for, offered from one button at its end. */}
        {tabsHidden.length > 0 && (
          <div className="rb-tabs-more">
            <Menu
              className="rb-tab rb-tab-more"
              ariaLabel="More tabs"
              label={<Icon name="chev" size={14} />}
              buttonProps={{ "data-tip": "More tabs", "data-why": "The tabs this pane has no room for. A wider pane shows them all." }}
              items={tabs.filter(([id]) => tabsHidden.includes(id)).map(([id, name]) => ({ label: name, run: () => setTab(id) }))}
            />
          </div>
        )}
        <div className="rb-right">
          <div className="seg" role="group" aria-label="Editor mode">
            <button type="button" aria-pressed={false} onClick={p.onCode}>
              Code
            </button>
            <button type="button" className="on" aria-pressed={true}>
              Visual
            </button>
          </div>
          <button type="button" className="mode" disabled={off} onClick={p.onShowChanges} title="Compare this file with the last snapshot">
            Changes
          </button>
        </div>
      </div>
      <div
        ref={panel}
        className={folding.over ? "rb-panel rb-over" : "rb-panel"}
        id="rb-panel"
        role="tabpanel"
        aria-labelledby={`rb-tab-${shown}`}
      >
        <Fit.Provider value={{ folded: folding.labels, more: folding.more, box: moreShown ? moreBox : null }}>
        {shown === "home" && (
          <>
            <Group label="Undo">
              <Tool name="Undo" keys="Ctrl+Z" icon="undo" run={() => buffers.run(undo)} />
              <Tool name="Redo" keys="Ctrl+Y" icon="redo" run={() => buffers.run(redo)} />
            </Group>
            <Group label="Clipboard">
              <Tool
                name="Paste"
                keys="Ctrl+V"
                icon="paste"
                big
                label="Paste"
                why="Text from Word, Google Docs or the web keeps its bold, italic, headings, lists and links, written as LaTeX."
                disabled={off}
                run={() => void buffers.paste(false)}
              />
              <div className="rb-col">
                <Tool name="Cut" keys="Ctrl+X" icon="cut" disabled={off} run={() => buffers.clipboard("cut")} />
                <Tool name="Copy" keys="Ctrl+C" icon="copy" disabled={off} run={() => buffers.clipboard("copy")} />
                <Menu
                  className="rb-tool"
                  ariaLabel="Paste options"
                  label={<Icon name="chev" size={12} />}
                  disabled={off}
                  buttonProps={{ "data-tip": "Paste options" }}
                  items={[
                    { label: "Keep formatting", hint: "Ctrl+V", run: () => void buffers.paste(false) },
                    { label: "Words only", hint: "Ctrl+Shift+V", run: () => void buffers.paste(true) },
                  ]}
                />
              </div>
              <Tool
                name="Format painter"
                keys="Ctrl+Shift+C"
                icon="brush"
                why="Copies the formatting at the cursor (bold, colour, highlight…) and puts the same commands around the next text you select. Esc stops."
                pressed={painting}
                disabled={off}
                run={() => (painting ? buffers.stopPainting() : buffers.copyFormat())}
              />
            </Group>
            <Group label="Font">
              <div className="rb-col">
                <div className="rb-row">
                  {FONT.slice(0, 7).map((f) => (
                    <Tool
                      key={f.command}
                      name={f.name}
                      keys={f.keys}
                      tex={`\\${f.command}{…}`}
                      why={f.why}
                      glyph={f.glyph}
                      className="glyph"
                      pressed={heads.includes(`\\${f.command}{`)}
                      disabled={off}
                      run={() => buffers.format(f.command)}
                    />
                  ))}
                </div>
                <div className="rb-row">
                  {FONT.slice(7).map((f) => (
                    <Tool
                      key={f.command}
                      name={f.name}
                      tex={`\\${f.command}{…}`}
                      why={f.why}
                      glyph={f.glyph}
                      className="glyph"
                      pressed={heads.includes(`\\${f.command}{`)}
                      disabled={off}
                      run={() => buffers.format(f.command)}
                    />
                  ))}
                  <Tool
                    name="Highlight"
                    tex="\hl{…}"
                    why="Loads the soul and xcolor packages for you. It shows in the PDF; for a note to yourself, use a comment instead."
                    icon="hl"
                    className="rb-hl"
                    pressed={heads.includes("\\hl{")}
                    disabled={off}
                    run={() => buffers.format("hl")}
                  />
                  <Menu
                    className="rb-tool rb-colour"
                    ariaLabel="Font colour"
                    label={
                      <>
                        A<Icon name="chev" size={10} />
                      </>
                    }
                    disabled={off}
                    buttonProps={{
                      "data-tip": "Font colour",
                      "data-tex": "\\textcolor{royalblue}{…}",
                      "data-why": "Each colour is named once in the settings at the top (\\definecolor), so every blue in the document is the same blue. Loads xcolor for you.",
                    }}
                    items={colourItems()}
                  />
                  <Tool
                    name="Clear formatting"
                    icon="clear"
                    why="Takes the formatting commands off the selection, or the word at the cursor, and leaves the words."
                    disabled={off}
                    run={() => buffers.clearFormatting()}
                  />
                </div>
              </div>
            </Group>
            <Group label="Paragraph">
              <div className="rb-col">
                <div className="rb-row">
                  <Tool
                    name="Bullets"
                    keys="Ctrl+Shift+L"
                    tex={"\\begin{itemize}\n  \\item …\n\\end{itemize}"}
                    icon="list-ul"
                    pressed={here?.list === "itemize"}
                    disabled={off}
                    run={() => buffers.list("itemize")}
                  />
                  <Tool
                    name="Numbering"
                    tex={"\\begin{enumerate}\n  \\item …\n\\end{enumerate}"}
                    icon="list-ol"
                    pressed={here?.list === "enumerate"}
                    disabled={off}
                    run={() => buffers.list("enumerate")}
                  />
                  <Menu
                    className="rb-tool rb-narrow"
                    ariaLabel="Numbering format"
                    label={<Icon name="chev" size={12} />}
                    disabled={off}
                    buttonProps={{ "data-tip": "Numbering format", "data-tex": "\\begin{enumerate}[label=\\alph*)]", "data-why": "1. a) i. A. — the formats other than LaTeX's own are written with the enumitem package, loaded for you." }}
                    items={NUMBER_FORMATS.map((f) => ({ label: f.label, hint: f.option || undefined, checked: here?.numbering === f.id, run: () => buffers.numbering(f.id) }))}
                  />
                  <Tool name="Decrease indent" keys="Shift+Tab" icon="outdent" why="In a list: the item goes up a level." disabled={off} run={() => buffers.indent(-1)} />
                  <Tool name="Increase indent" keys="Tab" icon="indent" why="In a list: the item goes down a level, into a list inside the item above it." disabled={off} run={() => buffers.indent(1)} />
                  <Tool
                    name="Show LaTeX marks"
                    keys="Ctrl+Shift+8"
                    icon="marks"
                    why="Like Word's ¶: the commands are shown faintly around the text, and the names of lists and other blocks in the margin, without leaving the page."
                    pressed={p.marks}
                    run={() => p.onMarks(!p.marks)}
                  />
                </div>
                <div className="rb-row">
                  {ALIGN.map((a) => (
                    <Tool
                      key={a.id}
                      name={a.name}
                      keys={a.keys}
                      tex={a.tex}
                      why={a.why}
                      icon={a.icon}
                      pressed={(here?.alignment ?? "justify") === a.id}
                      disabled={off}
                      run={() => buffers.align(a.id)}
                    />
                  ))}
                  <Menu
                    className="rb-tool"
                    ariaLabel="Line spacing"
                    label={
                      <>
                        <Icon name="spacing" />
                        <Icon name="chev" size={10} />
                      </>
                    }
                    disabled={unset}
                    buttonProps={{ "data-tip": "Line spacing", "data-tex": "\\usepackage{setspace}\n\\onehalfspacing", "data-why": "For the whole document, in its settings at the top, as Document setup sets it." }}
                    items={SPACINGS.map((s) => ({ label: s.name, hint: s.tex || undefined, checked: setup?.spacing === s.id, run: () => p.actions.spacing(s.id) }))}
                  />
                </div>
              </div>
            </Group>
            <Group label="Styles">
              <div className="rb-gallery">
                {STYLES.filter((s) => (s.level !== "chapter" || p.chapters) && (s.id !== "abstract" || p.abstract)).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`rb-style rb-style-${s.id}`}
                    aria-pressed={style === s.id}
                    disabled={off}
                    data-tip={s.name}
                    data-tex={s.tex}
                    data-why={s.why}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setStyle(s, style)}
                  >
                    <span className="rb-style-sample" aria-hidden="true">
                      AaBb
                    </span>
                    <span className="rb-style-name">{s.name}</span>
                  </button>
                ))}
              </div>
            </Group>
            <Group label="Editing">
              <Tool name="Find and replace" keys="Ctrl+F" icon="search" label="Find" disabled={off} run={() => buffers.run(openSearchPanel)} />
              <Tool
                name="Comment"
                keys="Ctrl+Alt+M"
                icon="comment"
                label="Comment"
                why="Kept beside the project, never written into the file."
                disabled={off}
                run={p.actions.comment}
              />
            </Group>
          </>
        )}
        {shown === "insert" && (
          <>
            <Group label="Pages">
              {insertTool(INSERT.pageBreak, "brk", true, off)}
              {insertTool(INSERT.contents, "toc", true, off)}
            </Group>
            <Group label="Tables">
              <TablePicker disabled={off} />
            </Group>
            <Group label="Illustrations">{insertTool(INSERT.figure, "picture", true, off)}</Group>
            <Group label="Links">
              <div className="rb-col">
                <Tool name="Link" keys="Ctrl+K" tex="\href{https://…}{…}" why="The words show in the document, and the reader follows them to the address. Loads hyperref." icon="link" label="Link" disabled={off} run={INSERT.link.run} />
                <Tool name="Bookmark" tex="\label{…}" why="A name for this place, so a cross-reference can point at it." icon="bookmark" label="Bookmark" disabled={off} run={p.actions.bookmark} />
                <Tool
                  name="Cross-reference"
                  tex="\Cref{fig:map}  →  “Figure 1”"
                  why="Pick a heading, figure, table or equation. The number follows it if it moves."
                  icon="xref"
                  label="Cross-reference"
                  disabled={off}
                  run={INSERT.crossReference.run}
                />
              </div>
            </Group>
            <Group label="Header & Footer">
              <div className="rb-col">
                <Tool
                  name="Header"
                  tex={"\\usepackage{fancyhdr}\n\\pagestyle{fancy}\n\\fancyhead[R]{…}"}
                  why="Printed at the top of every page, written once in the settings at the top. The page view shows it in each page's top margin."
                  icon="header"
                  label="Header"
                  disabled={unset}
                  run={() => p.actions.headerFooter("header")}
                />
                <Tool name="Footer" tex="\fancyfoot[C]{…}" why="Printed at the foot of every page, with the page number beside it." icon="footer" label="Footer" disabled={unset} run={() => p.actions.headerFooter("footer")} />
                <Menu
                  className="rb-tool"
                  ariaLabel="Page number"
                  label={
                    <>
                      <Icon name="pagenum" />
                      <span>Page number</span>
                      <Icon name="chev" size={10} />
                    </>
                  }
                  disabled={unset}
                  buttonProps={{ "data-tip": "Page number", "data-tex": "\\pagestyle{empty}", "data-why": "LaTeX numbers the pages by itself, at the foot; none leaves the numbers out." }}
                  items={[
                    { label: "At the foot", checked: setup?.pageNumbers === true, run: () => p.actions.layout({ pageNumbers: true }) },
                    { label: "None", hint: "\\pagestyle{empty}", checked: setup?.pageNumbers === false, run: () => p.actions.layout({ pageNumbers: false }) },
                  ]}
                />
              </div>
            </Group>
            <Group label="Text" open={p.symbolsOpen}>
              {insertTool(INSERT.footnote, "footnote", true, off)}
              <SymbolPicker open={p.symbolsOpen} disabled={off} recent={p.recentSymbols} onOpen={p.onSymbols} onUsed={p.onSymbolUsed} />
            </Group>
            <Group label="Equations">
              <Tool name="Equation" keys="Alt+=" tex="\begin{equation} … \end{equation}" icon="sigma" big label="Equation" disabled={off} run={p.actions.equation} />
              {insertTool(INSERT.inlineFormula, "formula", true, off)}
            </Group>
            <Group label="Citations">
              <Tool name="Citation" tex="\cite{…}" icon="quote" big label="Citation" why="Find a reference in the project's .bib files, or add a new one." disabled={off} run={p.actions.cite} />
              <Tool name="From Zotero" icon="quote" label="Zotero" disabled={off} run={p.actions.zotero} />
              <Tool name="Bibliography" tex="\bibliography{…}" icon="toc" label="Bibliography" disabled={off} run={p.actions.bibliography} />
              <Tool name="Citation style" icon="gear" label="Style" disabled={off} run={p.actions.citationStyle} />
            </Group>
          </>
        )}
        {shown === "layout" && (
          <>
            <Group label="Page setup">
              <BigMenu
                name="Margins"
                icon="margins"
                tex="\usepackage[margin=2.5cm]{geometry}"
                why="The same on every side. Other margins are set in Document setup."
                disabled={unset}
                items={[
                  ...MARGINS.map((m) => ({ label: m.label, hint: m.value ? `margin=${m.value}` : undefined, checked: setup?.margins === m.value, run: () => p.actions.layout({ margins: m.value }) })),
                  "separator" as const,
                  { label: "Custom margins…", run: p.actions.setup },
                ]}
              />
              <BigMenu
                name="Orientation"
                icon="orient"
                tex="\usepackage[landscape]{geometry}"
                why="For the whole document. One wide table on a landscape page of its own is written with pdflscape, in its LaTeX."
                disabled={unset}
                items={[
                  { label: "Portrait", checked: setup?.landscape === false, run: () => p.actions.layout({ landscape: false }) },
                  { label: "Landscape", hint: "landscape", checked: setup?.landscape === true, run: () => p.actions.layout({ landscape: true }) },
                ]}
              />
              <BigMenu
                name="Size"
                icon="size"
                tex="\documentclass[a4paper]{article}"
                disabled={unset}
                items={PAPERS.map((s) => ({ label: s.label, hint: s.value || undefined, checked: setup?.paper === s.value, run: () => p.actions.layout({ paper: s.value }) }))}
              />
              <BigMenu
                name="Columns"
                icon="cols"
                tex="\documentclass[twocolumn]{article}"
                why="Two columns for the whole document, as the compile sets them; the page view keeps the text in one."
                disabled={unset}
                items={[
                  { label: "One", checked: setup?.columns === 1, run: () => p.actions.layout({ columns: 1 }) },
                  { label: "Two", hint: "twocolumn", checked: setup?.columns === 2, run: () => p.actions.layout({ columns: 2 }) },
                ]}
              />
              <div className="rb-col">
                <Menu
                  className="rb-tool"
                  ariaLabel="Breaks"
                  label={
                    <>
                      <Icon name="brk" />
                      <span>Breaks</span>
                      <Icon name="chev" size={10} />
                    </>
                  }
                  disabled={off}
                  buttonProps={{ "data-tip": "Breaks", "data-tex": "\\newpage   \\clearpage", "data-why": "LaTeX breaks pages by itself; a break you put in starts the next page, or column, here." }}
                  items={[
                    { label: "Page", hint: setup?.columns === 2 ? "\\clearpage" : "\\newpage", run: () => buffers.insert(setup?.columns === 2 ? "\\clearpage\n" : "\\newpage\n") },
                    { label: "Page, the pictures first", hint: "\\clearpage", run: () => buffers.insert("\\clearpage\n") },
                    { label: "Column", hint: "\\newpage", disabled: setup?.columns !== 2, run: () => buffers.insert("\\newpage\n") },
                  ]}
                />
                <Tool
                  name="Line numbers"
                  tex={"\\usepackage{lineno}\n\\linenumbers"}
                  why="What journals ask for when you send a draft for review."
                  icon="lnum"
                  label="Line numbers"
                  pressed={setup?.lineNumbers ?? false}
                  disabled={unset}
                  run={() => p.actions.layout({ lineNumbers: !setup?.lineNumbers })}
                />
              </div>
            </Group>
            <Group label="Paragraph · whole document">
              <div className="rb-col">
                <Menu
                  className="rb-tool"
                  ariaLabel="First line"
                  label={
                    <>
                      <span>First line: {setup?.paragraphs === "space" ? "space between" : "indented"}</span>
                      <Icon name="chev" size={10} />
                    </>
                  }
                  disabled={unset}
                  buttonProps={{ "data-tip": "First line", "data-tex": "\\usepackage{parskip}", "data-why": "LaTeX indents the first line of each paragraph; parskip puts a space between paragraphs instead." }}
                  items={[
                    { label: "Indented", checked: setup?.paragraphs === "indent", run: () => p.actions.layout({ paragraphs: "indent" }) },
                    { label: "Space between", hint: "parskip", checked: setup?.paragraphs === "space", run: () => p.actions.layout({ paragraphs: "space" }) },
                  ]}
                />
                <Menu
                  className="rb-tool"
                  ariaLabel="Text size"
                  label={
                    <>
                      <span>Text size: {setup?.size ? setup.size.replace("pt", " pt") : "10 pt"}</span>
                      <Icon name="chev" size={10} />
                    </>
                  }
                  disabled={unset}
                  buttonProps={{ "data-tip": "Text size", "data-tex": "\\documentclass[11pt]{article}", "data-why": "The size of the body text; headings and footnotes follow it." }}
                  items={["10pt", "11pt", "12pt"].map((size) => ({ label: size.replace("pt", " pt"), checked: (setup?.size || "10pt") === size, run: () => p.actions.layout({ size: size === "10pt" && !setup?.size ? "" : size }) }))}
                />
              </div>
            </Group>
            <Group label="Arrange">
              <BigMenu name="Position" icon="picture" tex="\begin{figure}[htbp]" why={WHY_FLOATS} disabled={off} items={placeItems(here?.float ?? null)} />
            </Group>
            <Group label="Document">
              <Tool name="Document setup" icon="gear" big label="Document setup" why="Paper, margins, type size, line spacing, typeface, page numbers, paragraph style." disabled={off} run={p.actions.setup} />
            </Group>
          </>
        )}
        {shown === "picture" && figure && (
          <>
            <Group label="Size · of the line">
              {[
                { share: 0.5, glyph: "½", label: "Half width" },
                { share: 0.8, glyph: "⅘", label: "Most of it" },
                { share: 1, glyph: "1", label: "Full width" },
              ].map((w) => (
                <Tool
                  key={w.share}
                  name={w.label}
                  tex={`\\includegraphics[width=${w.share === 1 ? "" : w.share}\\linewidth]`}
                  why="A share of the line, so the picture stays right when the margins change."
                  big
                  glyph={<span className="rb-share">{w.glyph}</span>}
                  label={w.label}
                  pressed={figure.width === w.share}
                  disabled={figure.pictures !== 1}
                  run={() => buffers.pictureWidth(w.share)}
                />
              ))}
            </Group>
            <Group label="Arrange">
              <BigMenu name="Position" icon="picture" tex="\begin{figure}[htbp]" why={WHY_FLOATS} items={placeItems(figure)} />
            </Group>
            <Group label="Picture">
              <Tool name="Show LaTeX" keys="Ctrl+/" icon="code" big label="Source" why="Shows the figure as the LaTeX it is written in, to change it there." run={() => buffers.run(toggleReveal)} />
            </Group>
          </>
        )}
        {shown === "references" && (
          <>
            <Group label="Table of contents">
              {insertTool(INSERT.contents, "toc", true, off)}
              <Tool name="Update" icon="play" big label="Update" why="Contents, numbers and references are filled in by the compiler: updating them is a recompile." disabled={off} run={p.actions.compile} />
            </Group>
            <Group label="Footnotes">{insertTool(INSERT.footnote, "footnote", true, off)}</Group>
            <Group label="Citations">
              <Tool name="Citation" tex="\cite{…}" icon="quote" big label="Citation" why="Find a reference in the project's .bib files, or add a new one." disabled={off} run={p.actions.cite} />
              <div className="rb-col">
                <Tool name="From Zotero" icon="quote" label="Zotero" disabled={off} run={p.actions.zotero} />
                <Tool name="Citation style" icon="gear" label="Style" why="Numbered, IEEE, Harvard, APA, abbreviated." disabled={off} run={p.actions.citationStyle} />
                <Tool name="Bibliography" tex="\bibliography{…}" icon="toc" label="Bibliography" disabled={off} run={p.actions.bibliography} />
              </div>
            </Group>
            <Group label="Captions">
              <Tool name="Cross-reference" tex="\Cref{…}" why="Pick a heading, figure, table or equation. The number follows it if it moves." icon="xref" big label="Cross-reference" disabled={off} run={INSERT.crossReference.run} />
              <div className="rb-col">
                <Tool name="Table of figures" tex="\listoffigures" icon="toc" label="Table of figures" disabled={off} run={() => buffers.insert("\\listoffigures\n")} />
                <Tool name="List of tables" tex="\listoftables" icon="toc" label="List of tables" disabled={off} run={() => buffers.insert("\\listoftables\n")} />
              </div>
            </Group>
          </>
        )}
        {shown === "review" && <ReviewTab {...p} off={off} />}
        {shown === "view" && (
          <>
            <Group label="Views">
              <Tool
                name="Page"
                icon="page"
                big
                label="Page"
                pressed={p.pageView}
                why="White pages with the document's margins. What you write stays drawn as you move through it; Ctrl+/ shows the LaTeX."
                run={() => p.onPageView(true)}
              />
              <Tool
                name="Draft"
                icon="draft"
                big
                label="Draft"
                pressed={!p.pageView}
                why="The earlier visual mode: whatever the cursor is in shows as its LaTeX."
                run={() => p.onPageView(false)}
              />
            </Group>
            <Group label="Zoom">
              <Tool name="Zoom out" icon="minus" disabled={p.zoom <= 0.5} run={() => p.onZoom(p.zoom - 0.1)} />
              <Tool name="Actual size" glyph={<span className="mono">100%</span>} className="glyph wide" run={() => p.onZoom(1)} />
              <Tool name="Zoom in" icon="plus" disabled={p.zoom >= 2} run={() => p.onZoom(p.zoom + 0.1)} />
            </Group>
            <Group label="LaTeX">
              <Tool
                name="Show LaTeX"
                keys="Ctrl+/"
                icon="code"
                big
                label="Show LaTeX"
                why="Shows the paragraph you are in as the LaTeX it is written in, to change it there. Ctrl+/ again, Esc or moving away draws it again."
                disabled={off || !p.pageView}
                run={() => buffers.run(toggleReveal)}
              />
              <Tool
                name="LaTeX marks"
                keys="Ctrl+Shift+8"
                icon="marks"
                big
                label="Marks"
                why="Like Word's ¶: the commands are shown faintly around the text, and the names of lists and other blocks in the margin, without leaving the page."
                pressed={p.marks}
                run={() => p.onMarks(!p.marks)}
              />
              <Tool name="Document setup" icon="page" big label="Page setup" why="Paper, margins, type size, line spacing, typeface." disabled={off} run={p.actions.setup} />
            </Group>
            <Group label="Window">
              <SplitTool {...p} />
            </Group>
          </>
        )}
        {shown === "latex" && <LatexTab {...p} off={off} />}
        {folding.more.length > 0 && (
          <FoldButton label="More" icon="plus" button={moreButton} shown={moreShown} controls={moreId} onToggle={() => (setMoreGrab(document.activeElement === moreButton.current), setMoreFor(moreShown ? null : shown))} className="rb-group rb-folded rb-more">
            {moreShown && (
              <FoldedTools
                id={moreId}
                label="More"
                grab={moreOpen && moreGrab}
                anchor={moreButton}
                into={setMoreBox}
                filled={moreBox}
                onClose={(refocus) => (setMoreFor(null), refocus && moreButton.current?.focus())}
              />
            )}
          </FoldButton>
        )}
        </Fit.Provider>
      </div>
      <Tip root={root} />
      {keyTips.map((t) => (
        <span key={t.key} className="rb-kt" style={{ left: t.x, top: t.y }} aria-hidden="true">
          {t.key}
        </span>
      ))}
      {keyTips.length > 0 && (
        <span className="sr-only" role="status">
          KeyTips: press a letter, or Escape
        </span>
      )}
    </div>
  );
}
