import { useMemo, useState } from "react";
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
      <div className="flist outline">
        {p.outline.length === 0 && <p className="empty">Sections of the open file appear here.</p>}
        {p.outline.map((o) => (
          <button key={`${o.line}:${o.title}`} className="out" style={{ paddingLeft: 8 + (o.level - minLevel) * 14 }} onClick={() => p.onGoToLine(o.line)}>
            {o.title}
          </button>
        ))}
      </div>
    </aside>
  );
}
