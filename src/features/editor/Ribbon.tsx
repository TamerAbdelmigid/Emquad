// The ribbon of the page view: Word's tabs and groups, in Word's places, over the commands the
// editor already has. Every tool writes plain LaTeX, and its tooltip says which.
import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../../design/ui";
import { useStore } from "../../state/store";
import { SymbolPicker } from "./SymbolPicker";
import { TablePicker } from "./TablePicker";
import { buffers } from "./buffers";
import { INSERT, type Insertion } from "./insertions";
import { headingAt } from "./latex";
import { toggleReveal } from "./visual";

/** What the ribbon asks of the app: the dialogs and actions that live outside the editor. */
export interface RibbonActions {
  equation: () => void;
  cite: () => void;
  zotero: () => void;
  bibliography: () => void;
  citationStyle: () => void;
  setup: () => void;
  comment: () => void;
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

/** The style of the line the cursor is on, as the gallery names it. */
function useStyleAtCursor(): string | null {
  // Read so that the gallery follows the cursor.
  useStore((s) => s.cursor);
  const active = useStore((s) => s.active);
  const text = active ? buffers.text(active) : undefined;
  const at = buffers.cursorAt();
  if (text === undefined || at === null) return null;
  return headingAt(text, at)?.level ?? "normal";
}

const STYLES: { level: string | null; id: string; name: string; tex: string }[] = [
  { level: null, id: "normal", name: "Normal", tex: "(ordinary text: a blank line ends a paragraph)" },
  { level: "chapter", id: "chapter", name: "Chapter", tex: "\\chapter{…}" },
  { level: "section", id: "section", name: "Heading 1", tex: "\\section{…}" },
  { level: "subsection", id: "subsection", name: "Heading 2", tex: "\\subsection{…}" },
  { level: "subsubsection", id: "subsubsection", name: "Heading 3", tex: "\\subsubsection{…}" },
  { level: "paragraph", id: "paragraph", name: "Run-in", tex: "\\paragraph{…}" },
];

export function Ribbon(p: Props) {
  const [tab, setTab] = useState<TabName>("home");
  const root = useRef<HTMLDivElement>(null);
  // The Symbol panel lives on the Insert tab: asked for from elsewhere (Insert ▸ Symbol…), it is shown there.
  if (p.symbolsOpen && tab !== "insert") setTab("insert");
  const style = useStyleAtCursor();
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
            <Group label="Font">
              <Tool name="Bold" keys="Ctrl+B" tex="\textbf{…}" glyph={<b>B</b>} className="glyph" disabled={off} run={() => buffers.format("textbf")} />
              <Tool name="Italic" keys="Ctrl+I" tex="\textit{…}" glyph={<i>I</i>} className="glyph" disabled={off} run={() => buffers.format("textit")} />
              <Tool name="Underline" keys="Ctrl+U" tex="\underline{…}" glyph={<u>U</u>} className="glyph" disabled={off} run={() => buffers.format("underline")} />
              <Tool
                name="Emphasis"
                tex="\emph{…}"
                why="Italic in upright text and upright inside italic: what LaTeX means by stressing a word."
                glyph={<em>E</em>}
                className="glyph"
                disabled={off}
                run={() => buffers.format("emph")}
              />
              <Tool name="Typewriter" tex="\texttt{…}" glyph={<span className="mono">Tt</span>} className="glyph" disabled={off} run={() => buffers.format("texttt")} />
            </Group>
            <Group label="Paragraph">
              {insertTool(INSERT.bullets, "list-ul", false, off)}
              {insertTool(INSERT.numbers, "list-ol", false, off)}
            </Group>
            <Group label="Styles">
              <div className="rb-gallery">
                {STYLES.filter((s) => s.level !== "chapter" || p.chapters).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`rb-style rb-style-${s.id}`}
                    aria-pressed={style === s.id}
                    disabled={off}
                    data-tip={s.name}
                    data-tex={s.tex}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => buffers.heading(s.level)}
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
              <Tool name="Document setup" icon="page" big label="Page setup" why="Paper, margins, type size, line spacing, typeface." disabled={off} run={p.actions.setup} />
            </Group>
          </>
        )}
      </div>
      <Tip root={root} />
    </div>
  );
}
