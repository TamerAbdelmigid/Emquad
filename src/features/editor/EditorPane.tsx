import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Icon, Menu } from "../../design/ui";
import { type Tab, useStore } from "../../state/store";
import { Ribbon, type RibbonActions } from "./Ribbon";
import { SymbolPicker } from "./SymbolPicker";
import { TablePicker } from "./TablePicker";
import { buffers } from "./buffers";
import { readSetup } from "./documentSetup";
import { latexPath } from "./latexPath";
import { type Geometry, pageGeometry } from "./pageGeometry";
import { countWords } from "./spellModel";

interface Props {
  tabs: Tab[];
  active: string | null;
  engine: string | null;
  languageServer: boolean;
  fontSize: number;
  visual: boolean;
  onVisual: (on: boolean) => void;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onShowChanges: () => void;
  onComment: () => void;
  symbolsOpen: boolean;
  onSymbols: (open: boolean) => void;
  recentSymbols: string[];
  onSymbolUsed: (id: string) => void;
  /** The document's class has chapters. */
  chapters: boolean;
  /** The main file, whose settings give the page when the file on screen has none of its own. */
  mainFile: string;
  pageView: boolean;
  onPageView: (page: boolean) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  ribbon: RibbonActions;
}

/** The heading levels, named as a word processor names them, with the command each writes. */
const HEADINGS: [string, string][] = [
  ["section", "Heading 1"],
  ["subsection", "Heading 2"],
  ["subsubsection", "Heading 3"],
  ["paragraph", "Run-in heading"],
];
/** The document classes that have chapters; `\chapter` in any other stops the compile. */
export const WITH_CHAPTERS = /^(?:report|book|memoir|scrbook|scrreprt|thesis|ut-thesis|amsbook)$/;
export function EditorPane(p: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const detach = buffers.attach(host.current);
    return detach;
  }, []);

  useEffect(() => {
    buffers.show(p.active);
  }, [p.active]);

  useEffect(() => {
    buffers.setVisual(p.visual, p.pageView);
  }, [p.visual, p.pageView]);

  const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const paged = p.visual && p.pageView;
  const geometry = useGeometry(paged ? p.active : null, p.mainFile);
  const width = useWidth(host, paged);
  // A page wider than the pane is shown whole, made smaller to fit, as a word processor does; zoom is on top of that.
  const fit = width ? Math.min(1, (width - 60) / (geometry.width * CM)) : 1;

  return (
    <main className={paged ? "screen paged" : "screen"} style={{ ["--editor-size" as string]: `${p.fontSize}px`, ...(paged ? pageStyle(geometry, p.zoom * fit) : {}) }}>
      <div className="stabs" role="tablist" aria-label="Open files">
        {p.tabs.map((tab) => (
          <div key={tab.path} className={`stab${tab.path === p.active ? " on" : ""}`}>
            <button role="tab" aria-selected={tab.path === p.active} title={tab.path} onClick={() => p.onSelect(tab.path)}>
              {name(tab.path)}
              {tab.dirty && <span className="dot" aria-label="unsaved changes" />}
            </button>
            <button className="stab-x" aria-label={`Close ${name(tab.path)}`} onClick={() => p.onClose(tab.path)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
      {paged ? (
        <Ribbon
          actions={p.ribbon}
          active={Boolean(p.active)}
          chapters={p.chapters}
          symbolsOpen={p.symbolsOpen}
          onSymbols={p.onSymbols}
          recentSymbols={p.recentSymbols}
          onSymbolUsed={p.onSymbolUsed}
          onCode={() => p.onVisual(false)}
          onShowChanges={p.onShowChanges}
          pageView={p.pageView}
          onPageView={p.onPageView}
          zoom={p.zoom}
          onZoom={p.onZoom}
        />
      ) : (
      <div className="tools">
        <button className="ib" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={() => buffers.run(undo)}>
          <Icon name="undo" />
        </button>
        <button className="ib" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={() => buffers.run(redo)}>
          <Icon name="redo" />
        </button>
        <span className="sep" />
        <Menu
          className="ib tool-text"
          ariaLabel="Heading level"
          label={<>Style<Icon name="chev" size={12} /></>}
          items={[
            { label: "Normal text", run: () => buffers.heading(null) },
            ...(p.chapters ? [{ label: "Chapter", run: () => buffers.heading("chapter") }] : []),
            ...HEADINGS.map(([command, name]) => ({ label: name, hint: `\\${command}`, run: () => buffers.heading(command) })),
          ]}
        />
        <button className="ib" aria-label="Bold" title="Bold: the selection, or the selected table cells" onMouseDown={(e) => e.preventDefault()} onClick={() => buffers.format("textbf")}>
          B
        </button>
        <button className="ib italic" aria-label="Italic" title="Italic: the selection, or the selected table cells" onMouseDown={(e) => e.preventDefault()} onClick={() => buffers.format("textit")}>
          I
        </button>
        <span className="sep" />
        <TablePicker disabled={!p.active} />
        <SymbolPicker open={p.symbolsOpen} disabled={!p.active} recent={p.recentSymbols} onOpen={p.onSymbols} onUsed={p.onSymbolUsed} />
        <button className="ib" aria-label="Find and replace" title="Find and replace (Ctrl+F)" onClick={() => buffers.run(openSearchPanel)}>
          <Icon name="search" />
        </button>
        <button className="ib" aria-label="Comment on the selection" title="Comment on the selected text (Ctrl+Alt+M)" disabled={!p.active} onClick={p.onComment}>
          <Icon name="comment" />
        </button>
        <div className="r">
          <div className="seg" role="group" aria-label="Editor mode">
            <button className={p.visual ? "" : "on"} aria-pressed={!p.visual} onClick={() => p.onVisual(false)}>
              Code
            </button>
            <button className={p.visual ? "on" : ""} aria-pressed={p.visual} onClick={() => p.onVisual(true)}>
              Visual
            </button>
          </div>
          <button className="mode" disabled={!p.active} onClick={p.onShowChanges} title="Compare this file with the last snapshot">
            Changes
          </button>
        </div>
      </div>
      )}
      <div className="cm-host" ref={host} />
      {!p.active && <div className="screen-empty">Choose a file on the left to start editing.</div>}
      {paged ? (
        <div className="sfoot">
          <WordCount path={p.active} />
          <LatexPath path={p.active} />
          <div className="zoom" role="group" aria-label="Zoom">
            <button type="button" className="ib" aria-label="Zoom out" disabled={p.zoom <= 0.5} onClick={() => p.onZoom(p.zoom - 0.1)}>
              <Icon name="minus" size={14} />
            </button>
            <span>{Math.round(p.zoom * 100)}%</span>
            <button type="button" className="ib" aria-label="Zoom in" disabled={p.zoom >= 2} onClick={() => p.onZoom(p.zoom + 0.1)}>
              <Icon name="plus" size={14} />
            </button>
          </div>
        </div>
      ) : (
      <div className="sfoot">
        <span>
          <Position />
        </span>
        <WordCount path={p.active} />
        {p.engine && <span>{p.engine === "tectonic" ? "Tectonic engine" : "latexmk engine"}</span>}
        {p.languageServer && <span title="Hover for information; F12 goes to a definition; Shift+F12 finds references; F2 renames">texlab</span>}
        <span style={{ marginLeft: "auto" }}>Works offline</span>
      </div>
      )}
    </main>
  );
}

/** CSS pixels in a centimetre. */
const CM = 96 / 2.54;

/** The width of an element, followed as it changes; 0 while it is not watched. */
function useWidth(ref: React.RefObject<HTMLElement | null>, on: boolean): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    setWidth(el.clientWidth);
    return () => watch.disconnect();
  }, [ref, on]);
  return width;
}

/** The page's measurements as custom properties, at the zoom chosen. */
function pageStyle(g: Geometry, zoom: number): CSSProperties {
  const pt = (g.pt * 96) / 72;
  return {
    ["--page-w" as string]: `${(g.width * zoom).toFixed(2)}cm`,
    ["--page-m" as string]: `${(g.margin * zoom).toFixed(2)}cm`,
    ["--page-size" as string]: `${(pt * zoom).toFixed(2)}px`,
    ["--page-lh" as string]: String(g.lineHeight),
    ["--page-font" as string]: `var(--page-${g.font})`,
  };
}

/**
 * The page the file on screen is set on, from its own settings or, for a file without any, the
 * main file's. Read again now and then, since Document setup and typing change them.
 */
function useGeometry(path: string | null, mainFile: string): Geometry {
  const [geometry, setGeometry] = useState(() => pageGeometry(null));
  useEffect(() => {
    if (!path) return;
    let last = "";
    const read = () => {
      const own = buffers.text(path) ?? "";
      const setup = readSetup(own) ?? readSetup(buffers.text(mainFile) ?? "");
      const next = pageGeometry(setup);
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setGeometry(next);
      }
    };
    read();
    const timer = window.setInterval(read, 2000);
    return () => window.clearInterval(timer);
  }, [path, mainFile]);
  return geometry;
}

/** Where the cursor is, in LaTeX's terms: the section, the environments and commands around it. */
function LatexPath({ path }: { path: string | null }) {
  const cursor = useStore((s) => s.cursor);
  const [parts, setParts] = useState<string[]>([]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const text = path ? buffers.text(path) : undefined;
      const at = buffers.cursorAt();
      setParts(text === undefined || at === null || text.length > 400_000 ? [] : latexPath(text, at));
    });
    return () => cancelAnimationFrame(frame);
  }, [path, cursor]);
  const shown = ["document", ...parts];
  return (
    <span className="latex-path" title="Where the cursor is in the LaTeX: the section, then what it is inside">
      <span className="latex-path-label">LaTeX</span>
      {shown.map((part, i) => (
        <span key={i} className={i === shown.length - 1 ? "on" : undefined}>
          {i > 0 && <i aria-hidden="true">›</i>}
          {part}
        </span>
      ))}
    </span>
  );
}

/** Where the cursor is. Read here alone, so moving it redraws this line and nothing else. */
function Position() {
  const cursor = useStore((s) => s.cursor);
  return (
    <>
      Line <b>{cursor.line}</b>, column <b>{cursor.column}</b>
    </>
  );
}

/**
 * How many words the file on screen has, as a reader would count them: commands, mathematics,
 * comments and the preamble left out. Counted when the text has changed and the app is idle,
 * since counting a long document takes a moment.
 */
function WordCount({ path }: { path: string | null }) {
  const [words, setWords] = useState<number | null>(null);
  useEffect(() => {
    let last: string | undefined;
    let idle = 0;
    const count = () => {
      const text = path ? buffers.text(path) : undefined;
      if (text === last) return;
      last = text;
      cancelIdleCallback(idle);
      // A very long file is not counted: it would hold up typing each time.
      idle = requestIdleCallback(() => setWords(text === undefined || text.length > 400_000 ? null : countWords(text)), { timeout: 3000 });
    };
    count();
    const timer = window.setInterval(count, 2000);
    return () => {
      window.clearInterval(timer);
      cancelIdleCallback(idle);
    };
  }, [path]);
  if (words === null) return null;
  return <span title="Words in this file's text, not counting commands, mathematics, comments or the preamble">{words.toLocaleString()} words</span>;
}
