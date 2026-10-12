import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { listen } from "@tauri-apps/api/event";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon, Mark, Menu } from "../design/ui";
import { EditorPane } from "../features/editor/EditorPane";
import { buffers, setHandlers } from "../features/editor/buffers";
import { outline } from "../features/editor/latex";
import { Files } from "../features/files/Files";
import { History } from "../features/history/History";
import { Preview } from "../features/preview/Preview";
import { Start } from "../features/start/Start";
import { api } from "../ipc/api";
import { type Layout, store, useStore } from "../state/store";
import { Dialogs, SettingsDialog } from "./Dialogs";
import * as act from "./actions";

const historyBackend = {
  list: api.historyList,
  changedFiles: api.historyChangedFiles,
  fileDiff: api.historyFileDiff,
  review: api.reviewGet,
  decide: api.reviewDecide,
  finish: api.reviewFinish,
  cancel: api.reviewCancel,
};

export function App() {
  const s = useStore();
  const { set, notify } = s;
  const [outlineText, setOutlineText] = useState("");
  const [focusFile, setFocusFile] = useState<string | null>(null);

  // First load: settings, a bundle the app was started with, and backend events.
  useEffect(() => {
    void act.guard(async () => {
      set({ settings: await api.settingsGet() });
      const startup = await api.startupFile();
      if (startup) await act.importBundle(startup);
    });
    setHandlers({ save: () => void act.saveAndMaybeCompile(), compile: () => void act.compile() });
    const off = [
      listen<string>("compile://log", (e) => {
        const log = store().log;
        store().set({ log: log.length > 4000 ? [...log.slice(-3000), e.payload] : [...log, e.payload] });
      }),
      listen<string[]>("project://changed", (e) => void act.filesChangedOnDisk(e.payload)),
    ];
    return () => off.forEach((p) => void p.then((stop) => stop()));
  }, [set]);

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
      else if (e.shiftKey && key === "h") run(() => openHistory());
      else if (e.shiftKey && key === "e") run(() => set({ dialog: "export" }));
      else if (e.shiftKey && key === "i") run(() => void act.importBundle());
      else if (e.altKey && key === "j") run(() => void act.jumpToPdf());
      else if (!e.shiftKey && key === "b") run(() => set({ filesOpen: !store().filesOpen }));
      else if (!e.shiftKey && key === "enter") run(() => void act.compile());
      else if (!e.shiftKey && key === "s") run(() => void act.saveAndMaybeCompile());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openHistory, set]);

  const errors = s.build?.diagnostics.filter((d) => d.severity === "error") ?? [];
  const warnings = s.build?.diagnostics.filter((d) => d.severity === "warning").length ?? 0;
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

  const cols = [
    "50px",
    s.filesOpen ? "244px" : null,
    s.layout !== "pdf" ? "minmax(0,1.08fr)" : null,
    s.layout !== "editor" ? "minmax(0,1fr)" : null,
  ].filter(Boolean);

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
                  { label: "New project…", run: () => set({ dialog: "newProject" }) },
                  { label: "Open another folder…", run: () => void act.chooseAndOpenProject() },
                  { label: "Close project", run: () => void act.closeProject() },
                ]}
              />
              <Menu
                label="Edit"
                items={[
                  { label: "Undo", hint: "Ctrl+Z", run: () => buffers.run(undo) },
                  { label: "Redo", hint: "Ctrl+Y", run: () => buffers.run(redo) },
                  "separator",
                  { label: "Find and replace", hint: "Ctrl+F", run: () => buffers.run(openSearchPanel) },
                ]}
              />
              <Menu
                label="Insert"
                items={[
                  { label: "Section", run: () => buffers.insert("\\section{", "}") },
                  { label: "Figure", run: () => buffers.insert("\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{", "}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}\n") },
                  { label: "Numbered equation", run: () => buffers.insert("\\begin{equation}\n  ", "\n\\end{equation}\n") },
                  { label: "Bulleted list", run: () => buffers.insert("\\begin{itemize}\n  \\item ", "\n\\end{itemize}\n") },
                  { label: "Citation", run: () => buffers.insert("\\cite{", "}") },
                  { label: "Cross-reference", run: () => buffers.insert("\\ref{", "}") },
                ]}
              />
              <Menu
                label="View"
                items={[
                  layoutItem("Source and PDF", "split"),
                  layoutItem("Source only", "editor"),
                  layoutItem("PDF only", "pdf"),
                  "separator",
                  { label: s.filesOpen ? "Hide file panel" : "Show file panel", hint: "Ctrl+B", run: () => set({ filesOpen: !s.filesOpen }) },
                  { label: "Logs and messages", run: () => set({ dialog: "logs" }) },
                  { label: "History", hint: "Ctrl+Shift+H", run: () => openHistory() },
                ]}
              />
              <Menu
                label="Format"
                items={[
                  { label: "Bold", run: () => buffers.insert("\\textbf{", "}") },
                  { label: "Italic", run: () => buffers.insert("\\textit{", "}") },
                  { label: "Monospace", run: () => buffers.insert("\\texttt{", "}") },
                  { label: "Emphasis", run: () => buffers.insert("\\emph{", "}") },
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
            <button className="rb" aria-pressed={s.filesOpen} aria-label="File tree" title="File tree (Ctrl+B)" onClick={() => set({ filesOpen: !s.filesOpen })}>
              <Icon name="file" />
            </button>
            <button className="rb" aria-label="Find in this file" title="Find in this file (Ctrl+F)" onClick={() => buffers.run(openSearchPanel)}>
              <Icon name="search" />
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

          {s.filesOpen && (
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

          {s.layout !== "pdf" && (
            <EditorPane
              tabs={s.tabs}
              active={s.active}
              cursor={s.cursor}
              engine={s.build?.engine ?? null}
              fontSize={s.settings?.editorFontSize ?? 13}
              onSelect={(path) => set({ active: path })}
              onClose={(path) => void act.closeTab(path)}
              onShowChanges={() => openHistory(s.active)}
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
          onSnapshot={act.saveSnapshot}
          onWorkingCopyChanged={async () => {
            await act.reloadOpenFiles();
            notify("Merge finished");
          }}
          onRevertBlock={async (path, text) => {
            await api.fileWrite(path, text);
            buffers.replace(path, text);
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
