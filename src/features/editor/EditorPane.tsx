import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { useEffect, useRef } from "react";
import { Icon, Menu } from "../../design/ui";
import type { Tab } from "../../state/store";
import { buffers } from "./buffers";

interface Props {
  tabs: Tab[];
  active: string | null;
  cursor: { line: number; column: number };
  engine: string | null;
  fontSize: number;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onShowChanges: () => void;
}

const HEADINGS = ["section", "subsection", "subsubsection", "paragraph"];
const SYMBOLS = ["\\alpha", "\\beta", "\\gamma", "\\pi", "\\theta", "\\lambda", "\\sum", "\\int", "\\infty", "\\leq", "\\geq", "\\neq", "\\approx", "\\times", "\\rightarrow"];
const TABLE = "\\begin{tabular}{|l|l|}\n\\hline\n A & B \\\\\n\\hline\n C & D \\\\\n\\hline\n\\end{tabular}\n";

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
          label={<>Tт<Icon name="chev" size={12} /></>}
          items={HEADINGS.map((h) => ({ label: h[0].toUpperCase() + h.slice(1), run: () => buffers.insert(`\\${h}{`, "}") }))}
        />
        <button className="ib" aria-label="Bold" title="Bold" onClick={() => buffers.insert("\\textbf{", "}")}>
          B
        </button>
        <button className="ib italic" aria-label="Italic" title="Italic" onClick={() => buffers.insert("\\textit{", "}")}>
          I
        </button>
        <span className="sep" />
        <button className="ib" aria-label="Insert table" title="Insert table" onClick={() => buffers.insert(TABLE)}>
          <Icon name="table" />
        </button>
        <Menu className="ib" ariaLabel="Insert symbol" label="Ω" items={SYMBOLS.map((s) => ({ label: s, run: () => buffers.insert(s) }))} />
        <button className="ib" aria-label="Find and replace" title="Find and replace (Ctrl+F)" onClick={() => buffers.run(openSearchPanel)}>
          <Icon name="search" />
        </button>
        <div className="r">
          <button className="mode" disabled={!p.active} onClick={p.onShowChanges} title="Compare this file with the last snapshot">
            Show changes
          </button>
        </div>
      </div>
      <div className="cm-host" ref={host} />
      {!p.active && <div className="screen-empty">Choose a file on the left to start editing.</div>}
      <div className="sfoot">
        <span>
          Line <b>{p.cursor.line}</b>, column <b>{p.cursor.column}</b>
        </span>
        <span>LaTeX</span>
        {p.engine && <span>{p.engine === "tectonic" ? "Tectonic engine" : "latexmk engine"}</span>}
        <span style={{ marginLeft: "auto" }}>Works offline</span>
      </div>
    </main>
  );
}
