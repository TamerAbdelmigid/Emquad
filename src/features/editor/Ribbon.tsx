// The ribbon of the page view: Word's tabs and groups, in Word's places, over the commands the
// editor already has. Every tool writes plain LaTeX, and its tooltip says which.
import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, type IconName, Menu, type MenuItem } from "../../design/ui";
import { useStore } from "../../state/store";
import { SymbolPicker } from "./SymbolPicker";
import { TablePicker } from "./TablePicker";
import { buffers } from "./buffers";
import { INSERT, type Insertion } from "./insertions";
import { headingAt } from "./latex";
import { toggleReveal } from "./visual";
import { type Alignment, type BlockStyle, alignmentAt, blockStyleAt, environments } from "./blocks";
import type { Setup } from "./documentSetup";
import { COLOURS, formatAt } from "./formatting";
import { NUMBER_FORMATS, listAt, numberingAt } from "./lists";

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
  /** The document's line spacing, or null when its settings cannot be read. */
  spacing: Setup["spacing"] | null;
  marks: boolean;
  onMarks: (on: boolean) => void;
}

type TabName = "home" | "insert" | "view";

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

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group" role="group" aria-label={label}>
      <div className="rb-tools">{children}</div>
      <div className="rb-label" aria-hidden="true">
        {label}
      </div>
    </div>
  );
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
  const tabs: [TabName, string][] = [
    ["home", "Home"],
    ["insert", "Insert"],
    ["view", "View"],
  ];
  return (
    <div className="ribbon" ref={root}>
      <div className="rb-tabs">
        <div role="tablist" aria-label="Ribbon" className="rb-tablist">
          {tabs.map(([id, name]) => (
            <button key={id} type="button" role="tab" id={`rb-tab-${id}`} aria-selected={tab === id} aria-controls="rb-panel" className="rb-tab" onClick={() => setTab(id)}>
              {name}
            </button>
          ))}
        </div>
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
      <div className="rb-panel" id="rb-panel" role="tabpanel" aria-labelledby={`rb-tab-${tab}`}>
        {tab === "home" && (
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
                    disabled={off || p.spacing === null}
                    buttonProps={{ "data-tip": "Line spacing", "data-tex": "\\usepackage{setspace}\n\\onehalfspacing", "data-why": "For the whole document, in its settings at the top, as Document setup sets it." }}
                    items={SPACINGS.map((s) => ({ label: s.name, hint: s.tex || undefined, checked: p.spacing === s.id, run: () => p.actions.spacing(s.id) }))}
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
        {tab === "insert" && (
          <>
            <Group label="Pages">
              {insertTool(INSERT.pageBreak, "brk", true, off)}
              {insertTool(INSERT.contents, "toc", true, off)}
            </Group>
            <Group label="Tables">
              <TablePicker disabled={off} />
            </Group>
            <Group label="Illustrations">{insertTool(INSERT.figure, "picture", true, off)}</Group>
            <Group label="Links">{insertTool(INSERT.crossReference, "xref", true, off)}</Group>
            <Group label="Text">
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
        {tab === "view" && (
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
          </>
        )}
      </div>
      <Tip root={root} />
    </div>
  );
}
