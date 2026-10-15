import { redo, undo } from "@codemirror/commands";
import { startCompletion } from "@codemirror/autocomplete";
import { openSearchPanel } from "@codemirror/search";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, Mark, Menu } from "../design/ui";
import { EditorPane, WITH_CHAPTERS } from "../features/editor/EditorPane";
import { buffers, setHandlers } from "../features/editor/buffers";
import { outline } from "../features/editor/latex";
import { onPastedNeeds, onPastedPicture } from "../features/editor/paste";
import { onEditFormula } from "../features/editor/visual";
import { lspReceive, setDisplay, stopLsp } from "../features/editor/lsp";
import { Files } from "../features/files/Files";
import { Comments } from "../features/comments/Comments";
import { setCommentPick } from "../features/editor/comments";
import { Search } from "../features/files/Search";
import { History } from "../features/history/History";
import { Preview } from "../features/preview/Preview";
import { Start } from "../features/start/Start";
import { api } from "../ipc/api";
import type { TreeNode } from "../ipc/bindings/TreeNode";
import { useShallow } from "zustand/react/shallow";
import { type Layout, type State, store, useStore } from "../state/store";
import { Dialogs, SettingsDialog } from "./Dialogs";
import * as act from "./actions";

const historyBackend = {
  list: api.historyList,
  changedFiles: api.historyChangedFiles,
  fileDiff: api.historyFileDiff,
  review: api.reviewGet,
  decide: api.reviewDecide,
  edit: api.reviewEdit,
  finish: api.reviewFinish,
  cancel: api.reviewCancel,
};

export function App() {
  // Everything but where the cursor is and the compile log, which change on every keystroke
  // and every line the compiler writes: the parts that show them read them themselves.
  const s = useStore(useShallow(withoutBusyFields));
  const { set, notify } = s;
  const [outlineText, setOutlineText] = useState("");
  const [focusFile, setFocusFile] = useState<string | null>(null);
  /** A bundle the app was started with, waiting to be opened. */
  const [startupBundle, setStartupBundle] = useState<string | null>(null);

  // First load: settings, a bundle the app was started with, and backend events.
  useEffect(() => {
    void act.guard(async () => {
      set({ settings: await api.settingsGet() });
      void act.applySpelling();
      setStartupBundle(await api.startupFile());
    });
    setHandlers({
      save: () => void act.saveAndMaybeCompile(),
      compile: () => void act.compile(),
      comment: act.startComment,
      equation: () => store().set({ dialog: "equation" }),
    });
    // A picture pasted on its own, such as a screenshot, becomes a figure.
    onPastedPicture((file) => void act.addPictures([{ file }]));
    onEditFormula(() => store().set({ dialog: "equation" }));
    onPastedNeeds((packages) => packages.forEach((name) => void act.needPackage(name, "which the pasted text needs")));
    // Go to definition into a file that is not open opens it.
    setDisplay(
      async (path) => {
        await act.openFile(path, undefined, true);
        return buffers.showNow(path);
      },
      () => {
        const files = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.isDir ? files(n.children) : [n.path]));
        return [...store().tabs.map((t) => t.path), ...files(store().tree)];
      },
    );
    // Clicking a commented passage shows its comment.
    setCommentPick((id) => {
      store().set({ comment: id, filesOpen: true, sidePanel: "comments" });
      buffers.showComment(id);
    });
    // Each window hears only what is meant for it: its own compile, files and language server.
    const here = getCurrentWebviewWindow();
    const listen = here.listen.bind(here);
    const off = [
      listen<string>("compile://log", (e) => logLine(e.payload)),
      listen<string[]>("project://changed", (e) => void act.filesChangedOnDisk(e.payload)),
      listen<string>("app://open-bundle", (e) => setStartupBundle(e.payload)),
      listen<string>("lsp://message", (e) => lspReceive(e.payload)),
      // If the language server stops, say so in the footer and stop waiting on it.
      listen("lsp://closed", () => {
        stopLsp();
        store().set({ languageServer: false });
      }),
      // Files dragged from elsewhere: the editor shows where they will go, and takes them.
      here.onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") document.body.dataset.dropping = "";
        else delete document.body.dataset.dropping;
        if (p.type === "drop") void act.dropFiles(p.paths, p.position.x / window.devicePixelRatio, p.position.y / window.devicePixelRatio);
      }),
      // Closing the window saves what is not saved yet.
      here.onCloseRequested(async (e) => {
        if (!(await act.mayCloseWindow().catch(() => true))) e.preventDefault();
      }),
    ];
    return () => off.forEach((p) => void p.then((stop) => stop()));
  }, [set]);

  // A bundle the app was started with opens once the user has a name: on a first run the
  // welcome prompt comes first, and the bundle's own question follows it.
  const named = !!s.settings?.displayName.trim();
  useEffect(() => {
    if (!startupBundle || !named) return;
    setStartupBundle(null);
    void act.importBundle(startupBundle);
  }, [startupBundle, named]);

  const theme = s.settings?.theme ?? "fieldwork";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The outline follows the active buffer; reading it on a timer keeps typing cheap.
  useEffect(() => {
    const read = () => setOutlineText((s.active && buffers.text(s.active)) || "");
    read();
    const timer = window.setInterval(read, 800);
    return () => window.clearInterval(timer);
  }, [s.active]);
  const sections = useMemo(() => outline(outlineText), [outlineText]);

  useEffect(() => {
    if (!s.toast) return;
    const timer = window.setTimeout(() => set({ toast: null }), s.toast.error ? 8000 : 3200);
    return () => window.clearTimeout(timer);
  }, [s.toast, set]);

  const openHistory = useCallback(
    (file: string | null = null) => {
      void act.saveAll().then((ok) => {
        if (!ok) return;
        setFocusFile(file);
        set({ view: "history" });
      });
    },
    [set],
  );

  // Stable identity: History re-fetches when its callbacks change.
  const onHistoryError = useCallback(
    (e: unknown) => notify(e && typeof e === "object" && "message" in e ? String(e.message) : String(e), true),
    [notify],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !store().root) return;
      const key = e.key.toLowerCase();
      const run = (work: () => void) => {
        e.preventDefault();
        work();
      };
      if (e.shiftKey && key === "s") run(() => void act.saveSnapshot());
      else if (e.shiftKey && key === "f") run(() => set({ filesOpen: true, sidePanel: "search" }));
      else if (e.shiftKey && key === "h") run(() => openHistory());
      else if (e.shiftKey && key === "e") run(() => set({ dialog: "export" }));
      else if (e.shiftKey && key === "i") run(() => void act.importBundle());
      else if (e.shiftKey && key === "n") run(() => void act.guard(() => api.windowNew()));
      else if (e.altKey && key === "j") run(() => void act.jumpToPdf());
      else if (e.shiftKey && key === "b") run(() => set({ filesOpen: !store().filesOpen }));
      else if (!e.shiftKey && key === "enter") run(() => void act.compile());
      else if (!e.shiftKey && key === "s") run(() => void act.saveAndMaybeCompile());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openHistory, set]);

  const openComments = s.comments.filter((c) => !c.resolved).length;
  const errors = s.build?.diagnostics.filter((d) => d.severity === "error") ?? [];
  // Notes on how the text is set are not counted as warnings; the logs keep them apart.
  const warnings = useMemo(() => s.build?.diagnostics.filter((d) => d.severity === "warning" && !act.helpFor(d)?.note).length ?? 0, [s.build]);
  const errorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of errors) counts[d.file] = (counts[d.file] ?? 0) + 1;
    return counts;
    // Recomputed per build, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.build]);

  const status = s.compiling
    ? { text: "Compiling…", tone: "busy" }
    : !s.build
      ? { text: "Not compiled yet", tone: "idle" }
      : s.build.ok
        ? { text: "Compiled", tone: "ok" }
        : { text: "Compile failed", tone: "bad" };

  const needsName = s.settings !== null && s.settings.displayName.trim() === "";

  const savePdf = async () => {
    const dest = await saveDialog({
      title: "Save a copy of the PDF",
      defaultPath: `${s.info?.name ?? "document"}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (dest) await act.guard(() => api.pdfSave(dest));
  };

  // Columns: rail, gap, [files, handle], [source], [handle], [pdf]. The handles are the gaps.
  const bothPanes = s.layout === "split";
  const cols = [
    "50px",
    "8px",
    ...(s.filesOpen ? [`${s.filesWidth}px`, "8px"] : []),
    ...(s.layout !== "pdf" ? [`minmax(0,${bothPanes ? s.split : 1}fr)`] : []),
    ...(bothPanes ? ["8px"] : []),
    ...(s.layout !== "editor" ? [`minmax(0,${bothPanes ? 1 - s.split : 1}fr)`] : []),
  ];
  /** Left edge and width of the area the source and PDF panes share, in window pixels. */
  const paneArea = (work: HTMLElement) => {
    const box = work.getBoundingClientRect();
    const left = box.left + 58 + (s.filesOpen ? s.filesWidth + 8 : 0);
    return { left, width: box.right - left - 8 };
  };

  const layoutItem = (label: string, layout: Layout) => ({ label: `${s.layout === layout ? "● " : ""}${label}`, run: () => set({ layout }) });

  if (!s.root || s.view === "start") {
    return (
      <>
        <Start
          recent={s.settings?.recent ?? []}
          onOpen={(dir) => void act.openProject(dir)}
          onChoose={() => void act.chooseAndOpenProject()}
          onNew={() => set({ dialog: "newProject" })}
          onImport={() => void act.importBundle()}
        />
        <Dialogs />
        {needsName && <SettingsDialog firstRun onClose={() => {}} />}
        <Toast />
      </>
    );
  }

  return (
    <div className="app">
      <header className="mod top">
        <div className="tl">
          <Mark size={20} />
          <span className="brand">emquad</span>
          {s.view === "editor" ? (
            <>
              <Menu
                label="File"
                items={[
                  { label: "New file…", run: () => void act.newEntry(false) },
                  { label: "New folder…", run: () => void act.newEntry(true) },
                  { label: "Add files from disk…", run: () => void act.addFilesFromDisk() },
                  "separator",
                  { label: "Save", hint: "Ctrl+S", run: () => void act.save() },
                  { label: "Save snapshot…", hint: "Ctrl+Shift+S", run: () => void act.saveSnapshot() },
                  "separator",
                  { label: "Import bundle…", hint: "Ctrl+Shift+I", run: () => void act.importBundle() },
                  { label: "Export bundle…", hint: "Ctrl+Shift+E", run: () => set({ dialog: "export" }) },
                  "separator",
                  { label: "Document setup…", run: () => set({ dialog: "setup" }) },
                  "separator",
                  { label: "Send to Word…", run: () => void act.sendToWord() },
                  { label: "Open a Word file…", run: () => void act.openWordFile() },
                  { label: "Save PDF with comments…", run: () => void act.savePdfWithComments() },
                  "separator",
                  { label: "New project…", run: () => set({ dialog: "newProject" }) },
                  { label: "Open another folder…", run: () => void act.chooseAndOpenProject() },
                  { label: "New window", hint: "Ctrl+Shift+N", run: () => void act.guard(() => api.windowNew()) },
                  { label: "Close project", run: () => void act.closeProject() },
                ]}
              />
              <Menu
                label="Edit"
                items={[
                  { label: "Undo", hint: "Ctrl+Z", run: () => buffers.run(undo) },
                  { label: "Redo", hint: "Ctrl+Y", run: () => buffers.run(redo) },
                  "separator",
                  { label: "Suggest completions", hint: "Ctrl+Space", run: () => buffers.run(startCompletion) },
                  { label: "Find and replace", hint: "Ctrl+F", run: () => buffers.run(openSearchPanel) },
                  { label: "Search the project", hint: "Ctrl+Shift+F", run: () => set({ filesOpen: true, sidePanel: "search" }) },
                ]}
              />
              <Menu
                label="Insert"
                items={[
                  ...(WITH_CHAPTERS.test(s.index.documentClass) ? [{ label: "Chapter", run: () => buffers.insert("\\chapter{", "}") }] : []),
                  { label: "Section", run: () => buffers.insert("\\section{", "}") },
                  { label: "Figure", run: () => buffers.insert("\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{", "}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}\n") },
                  { label: "Numbered equation", run: () => buffers.insert("\\begin{equation}\n  ", "\n\\end{equation}\n") },
                  { label: "Bulleted list", run: () => buffers.insert("\\begin{itemize}\n  \\item ", "\n\\end{itemize}\n") },
                  { label: "Numbered list", run: () => buffers.insert("\\begin{enumerate}\n  \\item ", "\n\\end{enumerate}\n") },
                  { label: "Footnote", run: () => buffers.insertInline(() => ({ before: "\\footnote{", after: "}" })) },
                  { label: "Citation…", run: () => set({ dialog: "cite" }) },
                  { label: "Citation from Zotero…", run: () => void act.citeFromZotero() },
                  { label: "Cross-reference", run: () => buffers.insertInline(() => ({ before: "\\ref{", after: "}" })) },
                  "separator",
                  { label: "Table of contents", run: () => buffers.insert("\\tableofcontents\n") },
                  { label: "Page break", run: () => buffers.insert("\\newpage\n") },
                  { label: "Bibliography", run: () => void act.insertBibliography() },
                  { label: "Citation style…", run: () => set({ dialog: "citationStyle" }) },
                  "separator",
                  { label: "Equation…", hint: "Alt+=", run: () => set({ dialog: "equation" }) },
                  { label: "Formula in the line", run: () => buffers.insertInline((inMath) => (inMath ? { before: "", after: "" } : { before: "$", after: "$" })) },
                  { label: "Symbol…", run: () => set({ symbols: true }) },
                ]}
              />
              <Menu
                label="View"
                items={[
                  layoutItem("Source and PDF", "split"),
                  layoutItem("Source only", "editor"),
                  layoutItem("PDF only", "pdf"),
                  "separator",
                  { label: s.filesOpen ? "Hide file panel" : "Show file panel", hint: "Ctrl+Shift+B", run: () => set({ filesOpen: !s.filesOpen }) },
                  { label: "Logs and messages", run: () => set({ dialog: "logs" }) },
                  { label: "History", hint: "Ctrl+Shift+H", run: () => openHistory() },
                ]}
              />
              <Menu
                label="Format"
                items={[
                  { label: "Bold", hint: "Ctrl+B", run: () => buffers.format("textbf") },
                  { label: "Italic", hint: "Ctrl+I", run: () => buffers.format("textit") },
                  { label: "Underline", hint: "Ctrl+U", run: () => buffers.format("underline") },
                  { label: "Monospace", run: () => buffers.format("texttt") },
                  { label: "Emphasis", run: () => buffers.format("emph") },
                ]}
              />
              <Menu
                label="Help"
                items={[
                  { label: "Keyboard shortcuts", run: () => set({ dialog: "shortcuts" }) },
                  { label: "Settings…", run: () => set({ dialog: "settings" }) },
                ]}
              />
            </>
          ) : (
            <button className="btn" onClick={() => set({ view: "editor" })}>
              <Icon name="left" />
              Back to editor
            </button>
          )}
        </div>
        <div className="proj" role="status">
          <span>{s.info?.name}</span>
          <span className={`st ${status.tone}`}>{status.text}</span>
          <button className="dim" onClick={() => set({ dialog: "logs" })} title="Logs and messages">
            {errors.length} {errors.length === 1 ? "error" : "errors"}
          </button>
        </div>
        <div className="tr">
          {s.view === "editor" && (
            <>
              <button className="btn" onClick={() => openHistory()}>
                <Icon name="history" />
                History
                {s.pendingReviews > 0 && <i className="badge">{s.pendingReviews}</i>}
              </button>
              <Menu
                className="btn"
                label={<><Icon name="layout" />Layout</>}
                items={[layoutItem("Source and PDF", "split"), layoutItem("Source only", "editor"), layoutItem("PDF only", "pdf")]}
              />
              <button className="btn" onClick={() => void act.importBundle()}>
                <Icon name="down" />
                Import
              </button>
              <button className="btn dark" onClick={() => set({ dialog: "export" })}>
                <Icon name="up" />
                Export bundle
              </button>
            </>
          )}
        </div>
      </header>

      {s.view === "editor" ? (
        <div className="work" style={{ gridTemplateColumns: cols.join(" ") }}>
          <nav className="mod rail" aria-label="Panels">
            <button
              className="rb"
              aria-pressed={s.filesOpen && s.sidePanel === "files"}
              aria-label="File tree"
              title="File tree (Ctrl+Shift+B)"
              onClick={() => set(s.filesOpen && s.sidePanel === "files" ? { filesOpen: false } : { filesOpen: true, sidePanel: "files" })}
            >
              <Icon name="file" />
            </button>
            <button
              className="rb"
              aria-pressed={s.filesOpen && s.sidePanel === "search"}
              aria-label="Search the project"
              title="Search the project (Ctrl+Shift+F)"
              onClick={() => set(s.filesOpen && s.sidePanel === "search" ? { filesOpen: false } : { filesOpen: true, sidePanel: "search" })}
            >
              <Icon name="search" />
            </button>
            <button
              className="rb"
              aria-pressed={s.filesOpen && s.sidePanel === "comments"}
              aria-label="Comments"
              title="Comments"
              onClick={() => set(s.filesOpen && s.sidePanel === "comments" ? { filesOpen: false } : { filesOpen: true, sidePanel: "comments" })}
            >
              <Icon name="comment" />
              {openComments > 0 && <i className="badge">{openComments}</i>}
            </button>
            <button className="rb" aria-label="History and review" title="History and review (Ctrl+Shift+H)" onClick={() => openHistory()}>
              <Icon name="history" />
              {s.pendingReviews > 0 && <i className="badge">{s.pendingReviews}</i>}
            </button>
            <span className="sp" />
            <button className="rb" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => set({ dialog: "shortcuts" })}>
              <Icon name="help" />
            </button>
            <button className="rb" aria-label="Settings" title="Settings" onClick={() => set({ dialog: "settings" })}>
              <Icon name="gear" />
            </button>
          </nav>

          <span />
          {s.filesOpen && s.sidePanel === "search" && (
            <Search search={api.projectSearch} onOpen={(path, line) => void act.openFile(path, line)} onClose={() => set({ sidePanel: "files" })} />
          )}
          {s.filesOpen && s.sidePanel === "comments" && (
            <Comments
              comments={s.comments}
              active={s.active}
              picked={s.comment}
              canAdd={s.selecting && !!s.active}
              onAdd={act.addComment}
              onPick={(c) => void act.pickComment(c)}
              onReply={act.replyToComment}
              onResolve={(id, resolved) => void act.resolveComment(id, resolved)}
              onDelete={(id) => void act.deleteComment(id)}
              onClose={() => set({ sidePanel: "files" })}
            />
          )}
          {s.filesOpen && s.sidePanel === "files" && (
            <Files
              tree={s.tree}
              active={s.active}
              mainFile={s.info?.mainFile ?? ""}
              errorCounts={errorCounts}
              outline={sections}
              onOpen={(path) => void act.openFile(path)}
              onGoToLine={(line) => buffers.goToLine(line)}
              onNew={(isDir, parent) => void act.newEntry(isDir, parent)}
              onRename={(path) => void act.renameEntry(path)}
              onDelete={(path) => void act.deleteEntry(path)}
              onSetMain={(path) => void act.setMainFile(path)}
              onAddFromDisk={() => void act.addFilesFromDisk()}
              onClose={() => set({ filesOpen: false })}
            />
          )}
          {s.filesOpen && (
            <Splitter
              label="Resize the file panel"
              value={s.filesWidth}
              step={16}
              onDrag={(x, work) => set({ filesWidth: act.clampFiles(x - work.getBoundingClientRect().left - 58) })}
              onStep={(by) => set({ filesWidth: act.clampFiles(s.filesWidth + by) })}
              onDone={act.persistUi}
            />
          )}

          {s.layout !== "pdf" && (
            <EditorPane
              tabs={s.tabs}
              active={s.active}
              engine={s.build?.engine ?? null}
              languageServer={s.languageServer}
              fontSize={s.settings?.editorFontSize ?? 13}
              visual={s.visual}
              onVisual={(visual) => {
                set({ visual });
                act.persistUi();
              }}
              onSelect={(path) => set({ active: path })}
              onClose={(path) => void act.closeTab(path)}
              onComment={act.startComment}
              symbolsOpen={s.symbols}
              onSymbols={(symbols) => set({ symbols })}
              recentSymbols={s.settings?.recentSymbols ?? []}
              onSymbolUsed={act.symbolUsed}
              chapters={WITH_CHAPTERS.test(s.index.documentClass)}
            onShowChanges={() => openHistory(s.active)}
            />
          )}

          {bothPanes && (
            <Splitter
              label="Resize the source and PDF panes"
              value={Math.round(s.split * 100)}
              step={0.03}
              onDrag={(x, work) => {
                const area = paneArea(work);
                set({ split: act.clampSplit((x - area.left) / area.width) });
              }}
              onStep={(by) => set({ split: act.clampSplit(s.split + by) })}
              onDone={act.persistUi}
            />
          )}

          {s.layout !== "editor" && (
            <Preview
              version={s.pdfVersion}
              load={api.pdfRead}
              compiling={s.compiling}
              errors={errors.length}
              warnings={warnings}
              highlight={s.highlight}
              onCompile={() => void act.compile()}
              onCancel={() => void api.compileCancel()}
              onLogs={() => set({ dialog: "logs" })}
              onSavePdf={() => void savePdf()}
              onJumpToSource={(page, x, y) => void act.jumpToSource(page, x, y)}
              onJumpToPdf={() => void act.jumpToPdf()}
            />
          )}
        </div>
      ) : (
        <History
          backend={historyBackend}
          myAuthorId={s.settings?.authorId ?? ""}
          focusBundle={s.focusBundle}
          focusFile={focusFile}
          onError={onHistoryError}
          onRestore={act.restoreVersion}
          onChangesPdf={act.savePdfWithChanges}
          onSnapshot={act.saveSnapshot}
          onWorkingCopyChanged={async () => {
            await act.reloadOpenFiles();
            notify("Merge finished");
          }}
          onRevertBlock={async (path, text) => {
            await api.fileWrite(path, text);
            buffers.replace(path, text);
            // The app's own writes are not reported back, so the labels and references it may
            // have brought back or taken away are read here.
            void act.refreshIndex();
          }}
          onPendingChanged={() => void act.refreshPending()}
        />
      )}

      <Dialogs />
      {needsName && <SettingsDialog firstRun onClose={() => {}} />}
      <Toast />
    </div>
  );
}

/** A draggable gap between two panels. Arrow keys move it too. */
function Splitter(p: {
  label: string;
  value: number;
  step: number;
  onDrag: (clientX: number, work: HTMLElement) => void;
  onStep: (by: number) => void;
  onDone: () => void;
}) {
  const dragging = useRef(false);
  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    p.onDone();
  };
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={p.label}
      aria-valuenow={p.value}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        // Capture keeps the drag alive when the pointer leaves the narrow handle. It can be
        // refused (the pointer is already gone), and the drag still works while over the handle.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Nothing to do.
        }
      }}
      onPointerMove={(e) => {
        const work = e.currentTarget.parentElement;
        if (work && dragging.current) p.onDrag(e.clientX, work);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        p.onStep(e.key === "ArrowLeft" ? -p.step : p.step);
        p.onDone();
      }}
    />
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const set = useStore((s) => s.set);
  if (!toast) return null;
  return (
    <div className={`toast${toast.error ? " error" : ""}`} role={toast.error ? "alert" : "status"}>
      <span>{toast.text}</span>
      <button className="ib" aria-label="Dismiss" onClick={() => set({ toast: null })}>
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

function withoutBusyFields(state: State): Omit<State, "cursor" | "log"> {
  const rest: Partial<State> = { ...state };
  delete rest.cursor;
  delete rest.log;
  return rest as Omit<State, "cursor" | "log">;
}

/** Lines of the compile log not yet shown: added together once per frame, not one at a time. */
let pendingLog: string[] = [];
function logLine(line: string) {
  if (pendingLog.push(line) > 1) return;
  requestAnimationFrame(() => {
    const lines = pendingLog;
    pendingLog = [];
    const log = [...store().log, ...lines];
    store().set({ log: log.length > 4000 ? log.slice(-3000) : log });
  });
}
