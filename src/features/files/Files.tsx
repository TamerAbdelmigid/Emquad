import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Menu } from "../../design/ui";
import type { TreeNode } from "../../ipc/api";

export interface OutlineEntry {
  level: number;
  title: string;
  line: number;
}

interface Props {
  tree: TreeNode[];
  active: string | null;
  mainFile: string;
  /** Paths with compile errors, to badge in the tree. */
  errorCounts: Record<string, number>;
  outline: OutlineEntry[];
  onOpen: (path: string) => void;
  onGoToLine: (line: number) => void;
  /** Move the section headed on line `from` before the heading on line `before`, or to the end. */
  onMoveSection: (from: number, before: number | null, fromTitle?: string, beforeTitle?: string) => void;
  /** Move the section headed on `line` one step up or down among its siblings. */
  onStepSection: (line: number, by: -1 | 1, title?: string) => void;
  onNew: (isDir: boolean, parent?: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onSetMain: (path: string) => void;
  onAddFromDisk: () => void;
  onClose: () => void;
}

export function Files(p: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const minLevel = useMemo(() => Math.min(...p.outline.map((o) => o.level), 9), [p.outline]);
  /** A heading being dragged to move its section: from where, and what it is over. */
  const [drag, setDragShown] = useState<{ from: number; y: number; over: number | "end" | null; moved: boolean } | null>(null);
  // Kept beside what is drawn, so that each pointer event sees the one before it at once.
  const dragNow = useRef<typeof drag>(null);
  const setDrag = (next: typeof drag) => {
    dragNow.current = next;
    setDragShown(next);
  };
  const dragged = useRef(false);
  /** The heading moved from the keyboard, to give the keyboard back to once the outline is read again. */
  const moved = useRef<string | null>(null);
  const outlineList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moved.current) return;
    const title = moved.current;
    const found = [...(outlineList.current?.querySelectorAll<HTMLButtonElement>(".out") ?? [])].find((b) => b.textContent === title);
    if (found) {
      moved.current = null;
      found.focus();
    }
  }, [p.outline]);

  const rows = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const isClosed = closed.has(node.path);
      const errors = p.errorCounts[node.path];
      return (
        <div key={node.path}>
          <div className={`file-row${node.path === p.active ? " on" : ""}`} style={{ paddingLeft: 8 + depth * 16 }}>
            <button
              className="file-main"
              aria-expanded={node.isDir ? !isClosed : undefined}
              onClick={() => {
                if (!node.isDir) return p.onOpen(node.path);
                const next = new Set(closed);
                if (isClosed) next.delete(node.path);
                else next.add(node.path);
                setClosed(next);
              }}
            >
              <Icon name={node.isDir ? "folder" : "file"} />
              <span className="file-name">{node.name}</span>
              {node.path === p.mainFile && <span className="tag">Main</span>}
              {errors ? <i className="badge">{errors}</i> : null}
            </button>
            <Menu
              className="ib file-more"
              ariaLabel={`Actions for ${node.name}`}
              label="···"
              items={[
                ...(node.isDir
                  ? [
                      { label: "New file here", run: () => p.onNew(false, node.path) },
                      { label: "New folder here", run: () => p.onNew(true, node.path) },
                    ]
                  : node.name.endsWith(".tex") && node.path !== p.mainFile
                    ? [{ label: "Set as main file", run: () => p.onSetMain(node.path) }]
                    : []),
                { label: "Rename or move…", run: () => p.onRename(node.path) },
                { label: "Delete…", run: () => p.onDelete(node.path) },
              ]}
            />
          </div>
          {node.isDir && !isClosed && rows(node.children, depth + 1)}
        </div>
      );
    });

  return (
    <aside className="mod files" aria-label="Project files">
      <div className="fh">
        <span className="lab">File tree</span>
        <button className="ib" aria-label="New file" title="New file" onClick={() => p.onNew(false)}>
          <Icon name="newfile" />
        </button>
        <button className="ib" aria-label="New folder" title="New folder" onClick={() => p.onNew(true)}>
          <Icon name="folder" />
        </button>
        <button className="ib" aria-label="Add files from disk" title="Add files from disk" onClick={p.onAddFromDisk}>
          <Icon name="up" />
        </button>
        <button className="ib" aria-label="Close file tree" title="Close file tree" onClick={p.onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="flist grow">{p.tree.length ? rows(p.tree, 0) : <p className="empty">This project has no files yet.</p>}</div>
      <div className="grip" aria-hidden="true" />
      <div className="fh">
        <span className="lab">File outline</span>
      </div>
      <div className="flist outline" ref={outlineList}>
        {p.outline.length === 0 && <p className="empty">Sections of the open file appear here.</p>}
        {p.outline.map((o) => (
          <button
            key={`${o.line}:${o.title}`}
            className={`out${drag?.moved && drag.from === o.line ? " dragging" : ""}${drag?.moved && drag.over === o.line && drag.from !== o.line ? " drop-before" : ""}`}
            style={{ paddingLeft: 8 + (o.level - minLevel) * 14 }}
            data-line={o.line}
            title="Drag to move this section, everything under it included; Alt+Shift+Up or Down moves it from the keyboard"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // A pointer the browser no longer tracks: the drag still works while over the outline.
              }
              setDrag({ from: o.line, y: e.clientY, over: null, moved: false });
            }}
            onPointerMove={(e) => {
              const drag = dragNow.current;
              if (!drag) return;
              if (!drag.moved && Math.abs(e.clientY - drag.y) < 5) return;
              const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-line], .out-end");
              const over = under?.classList.contains("out-end") ? "end" : under?.dataset.line ? Number(under.dataset.line) : null;
              setDrag({ ...drag, moved: true, over });
            }}
            onPointerUp={() => {
              const drag = dragNow.current;
              if (drag?.moved) {
                dragged.current = true;
                const title = (line: number) => p.outline.find((x) => x.line === line)?.title;
                if (drag.over !== null && drag.over !== drag.from) p.onMoveSection(drag.from, drag.over === "end" ? null : drag.over, title(drag.from), drag.over === "end" ? undefined : title(drag.over));
              }
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => {
              if (!e.altKey || !e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              moved.current = o.title;
              p.onStepSection(o.line, e.key === "ArrowUp" ? -1 : 1, o.title);
            }}
            onClick={() => {
              // The click that ends a drag does not also go to the heading.
              if (dragged.current) return void (dragged.current = false);
              p.onGoToLine(o.line);
            }}
          >
            {o.title}
          </button>
        ))}
        {drag?.moved && <div className={`out-end${drag.over === "end" ? " drop-before" : ""}`}>Move to the end</div>}
      </div>
    </aside>
  );
}
