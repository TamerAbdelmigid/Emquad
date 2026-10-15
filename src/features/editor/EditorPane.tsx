import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { useEffect, useRef, useState } from "react";
import { Icon, Menu } from "../../design/ui";
import { type Tab, useStore } from "../../state/store";
import { SymbolPicker } from "./SymbolPicker";
import { countWords } from "./spellModel";
import { buffers } from "./buffers";
import { newTable, writeTable } from "./tableModel";

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
const PICK_ROWS = 8;
const PICK_COLS = 10;

/** The table button: opens a grid to choose how many rows and columns the new table has. */
function TablePicker({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState({ rows: 2, cols: 2 });
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    grid.current?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);
  const insert = (rows: number, cols: number) => {
    setOpen(false);
    buffers.insert(`${writeTable(newTable(rows, cols))}\n`);
  };
  const fit = (rows: number, cols: number) => ({ rows: Math.max(1, Math.min(PICK_ROWS, rows)), cols: Math.max(1, Math.min(PICK_COLS, cols)) });
  const grow = (rows: number, cols: number) => setSize((now) => fit(now.rows + rows, now.cols + cols));
  return (
    <div className="tpick" ref={root}>
      <button className="ib" aria-label="Insert table" title="Insert table" aria-haspopup="true" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        <Icon name="table" />
      </button>
      {open && (
        <div className="tpick-pop">
          <div
            ref={grid}
            className="tpick-grid"
            tabIndex={0}
            role="application"
            aria-label={`New table: ${size.rows} rows by ${size.cols} columns. Arrow keys change the size, Enter inserts it.`}
            style={{ gridTemplateColumns: `repeat(${PICK_COLS}, 16px)` }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "Enter" || e.key === " ") insert(size.rows, size.cols);
              else if (e.key === "ArrowRight") grow(0, 1);
              else if (e.key === "ArrowLeft") grow(0, -1);
              else if (e.key === "ArrowDown") grow(1, 0);
              else if (e.key === "ArrowUp") grow(-1, 0);
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseMove={(e) => {
              const at = (e.target as HTMLElement).dataset;
              if (at.r && at.c) setSize(fit(Number(at.r), Number(at.c)));
            }}
            onMouseUp={(e) => {
              const at = (e.target as HTMLElement).dataset;
              if (at.r && at.c) insert(Number(at.r), Number(at.c));
            }}
          >
            {Array.from({ length: PICK_ROWS * PICK_COLS }, (_, i) => {
              const [r, c] = [Math.floor(i / PICK_COLS) + 1, (i % PICK_COLS) + 1];
              return <i key={i} data-r={r} data-c={c} className={r <= size.rows && c <= size.cols ? "on" : ""} />;
            })}
          </div>
          <div className="tpick-size" aria-hidden="true">
            {size.rows} × {size.cols} table
          </div>
        </div>
      )}
    </div>
  );
}

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
    buffers.setVisual(p.visual);
  }, [p.visual]);

  const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);

  return (
    <main className="screen" style={{ ["--editor-size" as string]: `${p.fontSize}px` }}>
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
      <div className="cm-host" ref={host} />
      {!p.active && <div className="screen-empty">Choose a file on the left to start editing.</div>}
      <div className="sfoot">
        <span>
          <Position />
        </span>
        <WordCount path={p.active} />
        {p.engine && <span>{p.engine === "tectonic" ? "Tectonic engine" : "latexmk engine"}</span>}
        {p.languageServer && <span title="Hover for information; F12 goes to a definition; Shift+F12 finds references; F2 renames">texlab</span>}
        <span style={{ marginLeft: "auto" }}>Works offline</span>
      </div>
    </main>
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
