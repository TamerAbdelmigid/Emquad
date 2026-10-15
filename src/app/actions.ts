// What the app can do, as plain functions over the store, the editor buffers and the backend.
// Components call these; they never talk to the backend for a multi-step action themselves.
import { relativeTo } from "./paths";
import { documentStart } from "../features/editor/visualModel";
import { type Setup, readSetup, setupChange } from "../features/editor/documentSetup";
import { type Fix, type Help, explain, locate } from "../features/editor/errorHelp";
import { ensurePackage, packageNotice } from "../features/editor/tableModel";
import type { Diagnostic } from "../ipc/api";
import type { TreeNode } from "../ipc/bindings/TreeNode";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { buffers } from "../features/editor/buffers";
import { startLsp, stopLsp } from "../features/editor/lsp";
import { loadSpelling } from "../features/editor/spell";
import { type Comment, type OpenedProject, WORKING, api, errorOf } from "../ipc/api";
import { confirm, prompt, store } from "../state/store";
import { coalesced } from "./coalesced";

/** Run an action and show any failure to the user instead of losing it. */
export async function guard<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (e) {
    store().notify(errorOf(e).message, true);
    return undefined;
  }
}

export const clampFiles = (px: number) => Math.round(Math.min(480, Math.max(170, px)));
export const clampSplit = (share: number) => Math.min(0.8, Math.max(0.2, share));

export function persistUi() {
  const s = store();
  if (!s.root) return;
  const state = { tabs: s.tabs.map((t) => t.path), active: s.active, filesWidth: s.filesWidth, split: s.split, visual: s.visual };
  void api.uiStateSave(JSON.stringify(state)).catch(() => {});
}

async function enter(opened: OpenedProject) {
  buffers.closeAll();
  buffers.picturesChanged();
  setComments([]);
  // The language server is set up before any file opens, so each file's editor connects to it.
  if (opened.languageServer) startLsp(opened.root, (message) => void api.lspSend(message).catch(() => {}));
  else stopLsp();
  store().set({ languageServer: opened.languageServer });
  store().set({
    root: opened.root,
    info: opened.info,
    tree: opened.tree,
    tabs: [],
    active: null,
    build: null,
    log: [],
    view: "editor",
    highlight: null,
    pendingReviews: 0,
    focusBundle: null,
    settings: await api.settingsGet(),
  });
  // The project may check its spelling in a language of its own.
  void applySpelling();
  let remembered: { tabs?: string[]; active?: string | null; filesWidth?: number; split?: number; visual?: boolean } = {};
  try {
    remembered = JSON.parse(opened.uiState ?? "{}");
  } catch {
    // A damaged state file only costs the remembered tabs.
  }
  if (typeof remembered.filesWidth === "number") store().set({ filesWidth: clampFiles(remembered.filesWidth) });
  if (typeof remembered.split === "number") store().set({ split: clampSplit(remembered.split) });
  // Visual mode as the project was last left, and on for a project never opened before.
  store().set({ visual: remembered.visual ?? true });
  const wanted = remembered.tabs?.length ? remembered.tabs : [opened.info.mainFile];
  for (const path of wanted.filter(Boolean)) await openFile(path, undefined, true);
  const active = remembered.active && buffers.has(remembered.active) ? remembered.active : store().tabs[0]?.path;
  store().set({ active: active ?? null });
  void refreshIndex();
  void refreshPending();
  void refreshComments();
  // Show the last PDF if one exists from an earlier session; a project never compiled is
  // compiled at once, so its document is there to see from the start.
  store().set({ pdfVersion: store().pdfVersion + 1 });
  // Only with the built-in compiler, which runs nothing from the project: latexmk reads a
  // project's own latexmkrc, so a project from someone else is compiled with it only when asked.
  if (!opened.hasPdf && opened.info.engine !== "latexmk") {
    void api
      .enginesAvailable()
      .then((engines) => {
        if (engines.tectonic && store().root === opened.root) void compile();
      })
      .catch(() => {});
  }
}

// Unsaved edits are saved before another project is opened: once it is, a save would go to it.
export const openProject = async (dir: string) => {
  if (!(await saveAll())) return;
  await guard(async () => enter(await api.projectOpen(dir)));
};

export async function chooseAndOpenProject() {
  const dir = await openDialog({ directory: true, title: "Open a project folder" });
  if (typeof dir === "string") await openProject(dir);
}

export async function createProject(name: string, template: string) {
  const parent = await openDialog({ directory: true, title: "Choose where to create the project" });
  if (typeof parent !== "string") return;
  if (!(await saveAll())) return;
  await guard(async () => {
    await enter(await api.projectCreate(parent, name, template));
    store().set({ dialog: null });
  });
}

/**
 * Whether the window may close: its unsaved edits are saved first, and if they cannot be, the
 * user decides.
 */
export async function mayCloseWindow(): Promise<boolean> {
  if (await saveAll().catch(() => false)) return true;
  return confirm("Close without saving?", "Some changes could not be saved, and will be lost if this window closes.", "Close anyway", true);
}

export async function closeProject() {
  if (!(await saveAll())) return;
  await api.projectClose();
  buffers.closeAll();
  setComments([]);
  stopLsp();
  store().set({ root: null, info: null, tree: [], tabs: [], active: null, view: "start", settings: await api.settingsGet() });
  void applySpelling();
}

/** Every file of the project, by its path. */
export function projectFiles(nodes: TreeNode[] = store().tree): string[] {
  return nodes.flatMap((n) => (n.isDir ? projectFiles(n.children) : [n.path]));
}

/** An example reference for a project's first .bib file, to show how one is written. */
const FIRST_REFERENCE = `% Your references. Each one has a key, here knuth1984, which \\cite{knuth1984} writes in
% the text. Add yours below, or copy them from a reference manager as BibTeX.

@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984},
}
`;

/**
 * Put the list of references where the cursor is, made from the project's .bib file. A
 * project with none is given references.bib, with an example to copy.
 */
export async function insertBibliography() {
  await guard(async () => {
    const main = store().info?.mainFile ?? "main.tex";
    // LaTeX looks for the .bib file from the main file's folder.
    const folder = main.includes("/") ? main.slice(0, main.lastIndexOf("/") + 1) : "";
    let bib = projectFiles().find((p) => p.toLowerCase().endsWith(".bib"));
    if (!bib) {
      bib = `${folder}references.bib`;
      store().set({ tree: await api.fileCreate(bib, false) });
      await api.fileWrite(bib, FIRST_REFERENCE);
      store().notify(`Added ${bib}, with an example reference. Add yours there, and cite them with Insert ▸ Citation.`);
      void refreshIndex();
    }
    const name = relativeTo(folder, bib);
    const mainText = buffers.text(main) ?? (await api.fileRead(main).catch(() => null))?.text ?? "";
    if (/\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b[^}]*\}/.test(mainText)) {
      // biblatex names its .bib files in the settings and prints the list with \printbibliography.
      if (!/\\addbibresource\s*\{/.test(mainText) && buffers.has(main)) {
        const at = documentStart(mainText);
        if (at >= 0) buffers.change(main, { from: at, insert: `\\addbibresource{${name}}\n` });
      }
      buffers.insert("\\printbibliography\n");
    } else buffers.insert(`\\bibliographystyle{plain}\n\\bibliography{${name.replace(/\.bib$/i, "")}}\n`);
  });
}


export const refreshTree = () => guard(async () => store().set({ tree: await api.projectTree() }));
/**
 * Read the project index again. Asked for while a reading is under way, it is read once more
 * when that one ends, not once per asking: saves, changes on disk and merges come in bursts.
 */
export const refreshIndex = coalesced(() =>
  guard(async () => {
    const index = await api.projectIndex();
    const before = store().index;
    store().set({ index });
    // Visual mode names references from the index, so it is redrawn when they changed.
    const changed = (pick: (i: typeof index) => unknown) => JSON.stringify(pick(before)) !== JSON.stringify(pick(index));
    if (changed((i) => i.citations) || changed((i) => i.citeKeys) || changed((i) => i.labels) || changed((i) => i.labelNumbers)) buffers.redrawVisual();
  }),
);


/** Count bundles waiting for review, for the History badge. Counting must not start a review. */
export async function refreshPending() {
  await guard(async () => {
    const list = await api.historyList();
    store().set({ pendingReviews: list.versions.filter((v) => v.pending).length });
  });
}

// ---------- files ----------

export async function openFile(path: string, line?: number, quiet = false) {
  await guard(async () => {
    const s = store();
    if (!buffers.has(path)) {
      const content = await api.fileRead(path);
      if (content.text === null) {
        if (!quiet) s.notify(`${path} is not a text file, so it cannot be edited here`);
        return;
      }
      buffers.open(path, content.text);
      s.set({ tabs: [...store().tabs, { path, dirty: false }] });
    }
    store().set({ active: path, view: "editor" });
    if (line) requestAnimationFrame(() => buffers.goToLine(line));
    persistUi();
  });
}

export async function closeTab(path: string) {
  const s = store();
  const tab = s.tabs.find((t) => t.path === path);
  if (tab?.dirty && !(await confirm("Close without saving?", `${path} has changes that are not saved.`, "Close anyway", true))) {
    return;
  }
  buffers.close(path);
  const tabs = s.tabs.filter((t) => t.path !== path);
  store().set({ tabs, active: s.active === path ? (tabs[tabs.length - 1]?.path ?? null) : s.active });
  persistUi();
}

/** When a version of the work while writing was last asked for. */
let lastKeptAsked = 0;

export async function save(path: string | null = store().active): Promise<boolean> {
  if (!path) return true;
  const text = buffers.text(path);
  if (text === undefined) return true;
  const done = await guard(async () => {
    await api.fileWrite(path, text);
    buffers.markSaved(path, text);
    const s = store();
    s.set({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty: false } : t)) });
    // Comments remember the words they are on; record where the edits have taken them.
    const known = new Map(s.comments.map((c) => [c.id, c]));
    const moved = buffers.commentAnchors(path).filter((a) => {
      const c = known.get(a.id);
      return c && (c.quote !== a.quote || c.before !== a.before || c.after !== a.after || c.line !== a.line);
    });
    if (moved.length) setComments(await api.commentsReanchor(moved));
    return true;
  });
  if (done) {
    void refreshIndex();
    // A version of the work is kept every ten minutes or so of saving, so History has it even
    // when no snapshot was ever taken. Asked for no more often: working out whether one is due
    // can read the whole project.
    if (Date.now() - lastKeptAsked > 10 * 60 * 1000) {
      lastKeptAsked = Date.now();
      void api.historyKeepWhileWriting().catch(() => {});
    }
  }
  return done === true;
}

export async function saveAll(): Promise<boolean> {
  for (const tab of store().tabs.filter((t) => t.dirty)) {
    if (!(await save(tab.path))) return false;
  }
  return true;
}

export async function saveAndMaybeCompile() {
  if ((await save()) && store().settings?.compileOnSave) await compile();
}

export async function newEntry(isDir: boolean, parent = "") {
  const name = await prompt(isDir ? "New folder" : "New file", isDir ? "" : "untitled.tex", "Create");
  if (!name?.trim()) return;
  const path = parent ? `${parent}/${name.trim()}` : name.trim();
  await guard(async () => {
    store().set({ tree: await api.fileCreate(path, isDir) });
    if (!isDir) await openFile(path);
  });
}

export async function renameEntry(path: string) {
  const to = await prompt("Rename or move", path, "Rename", "Give the new path, relative to the project.");
  if (!to?.trim() || to.trim() === path) return;
  const target = to.trim();
  if (!(await saveAll())) return;
  await guard(async () => {
    const tree = await api.fileRename(path, target);
    const s = store();
    // Open tabs follow the file, including files inside a renamed folder.
    const moved = (p: string) => (p === path ? target : p.startsWith(`${path}/`) ? target + p.slice(path.length) : p);
    for (const tab of s.tabs) if (moved(tab.path) !== tab.path) buffers.rename(tab.path, moved(tab.path));
    s.set({
      tree,
      tabs: s.tabs.map((t) => ({ ...t, path: moved(t.path) })),
      active: s.active ? moved(s.active) : null,
    });
    if (s.info?.mainFile && moved(s.info.mainFile) !== s.info.mainFile) {
      store().set({ info: await api.projectSetMain(moved(s.info.mainFile)) });
    }
    await refreshComments();
    persistUi();
  });
}

export async function deleteEntry(path: string) {
  if (!(await confirm("Delete?", `${path} will be removed from the project. A snapshot can bring it back.`, "Delete", true))) return;
  await guard(async () => {
    const tree = await api.fileDelete(path);
    const s = store();
    const gone = (p: string) => p === path || p.startsWith(`${path}/`);
    s.tabs.filter((t) => gone(t.path)).forEach((t) => buffers.close(t.path));
    const tabs = s.tabs.filter((t) => !gone(t.path));
    s.set({ tree, tabs, active: s.active && gone(s.active) ? (tabs[0]?.path ?? null) : s.active });
    persistUi();
  });
}

export async function addFilesFromDisk() {
  const picked = await openDialog({ multiple: true, title: "Add files to the project" });
  const sources = Array.isArray(picked) ? picked : picked ? [picked] : [];
  if (sources.length) await guard(async () => store().set({ tree: await api.fileImport(sources, "") }));
}

export async function setMainFile(path: string) {
  await guard(async () => store().set({ info: await api.projectSetMain(path) }));
}

/** Files changed outside the app: reload clean buffers, leave edited ones alone. */
export async function filesChangedOnDisk(paths: string[]) {
  void refreshTree();
  if (paths.some((p) => /\.(pdf|png|jpe?g|gif|webp)$/i.test(p))) buffers.picturesChanged();
  // Labels and references may have changed with them.
  if (paths.some((p) => /\.(tex|bib)$/i.test(p))) void refreshIndex();
  const s = store();
  for (const tab of s.tabs.filter((t) => paths.includes(t.path))) {
    const content = await api.fileRead(tab.path).catch(() => null);
    if (!content || content.text === null || content.text === buffers.text(tab.path)) continue;
    if (!tab.dirty) buffers.replace(tab.path, content.text);
    else s.notify(`${tab.path} changed on disk. Your unsaved edits were kept; saving will overwrite the file.`);
  }
}

/** Re-read every open file after an operation rewrote the working copy (restore, merge). */
export async function reloadOpenFiles() {
  await refreshTree();
  for (const tab of store().tabs) {
    const content = await api.fileRead(tab.path).catch(() => null);
    if (content && content.text !== null) buffers.replace(tab.path, content.text);
    else {
      buffers.close(tab.path);
      const s = store();
      const tabs = s.tabs.filter((t) => t.path !== tab.path);
      s.set({ tabs, active: s.active === tab.path ? (tabs[0]?.path ?? null) : s.active });
    }
  }
  const s = store();
  s.set({ tabs: s.tabs.map((t) => ({ ...t, dirty: false })) });
  void refreshIndex();
}

// ---------- compile and source/PDF lookup ----------

export async function compile() {
  if (!(await saveAll())) return;
  store().set({ compiling: true, log: [] });
  const out = await guard(() => api.compileRun());
  store().set({ compiling: false });
  if (!out || out.cancelled) return;
  // An error the compiler gave no line for is placed where something begun was never ended.
  for (const d of out.diagnostics) {
    const found = locate(d, (path) => buffers.text(path));
    if (found?.kind === "go") d.line = found.line;
  }
  buffers.setDiagnostics(out.diagnostics, helpFor, (fix) => void applyFix(fix));
  const s = store();
  s.set({ build: out, pdfVersion: out.hasPdf ? s.pdfVersion + 1 : s.pdfVersion });
  // References are numbered by the compile, so visual mode can show their numbers now.
  void refreshIndex();
  const first = out.diagnostics.find((d) => d.severity === "error");
  if (first && first.line > 0) await openFile(first.file, first.line, true);
}

/** Whether the document loads a package, as its main file's settings say. */
function packageLoaded(name: string): boolean {
  const main = store().info?.mainFile;
  const text = main ? buffers.text(main) : undefined;
  return text !== undefined && ensurePackage(text, name, store().index.stylePackages) === "present";
}

/** A compile message in plain words, with its fix when one is certain. */
export function helpFor(d: Diagnostic): Help | null {
  return explain(d, (path) => buffers.text(path), packageLoaded);
}

/** How the document is set now, read from its main file; null when that has no settings of its own. */
export async function currentSetup(): Promise<Setup | null> {
  const main = store().info?.mainFile;
  if (!main) return null;
  await openFile(main, undefined, true);
  return readSetup(buffers.text(main) ?? "");
}

/** Set the document's page as the Document setup dialog says, in its main file, and compile to show it. */
export async function applySetup(setup: Setup) {
  const main = store().info?.mainFile;
  if (!main) return;
  await guard(async () => {
    await openFile(main, undefined, true);
    const change = setupChange(buffers.text(main) ?? "", setup);
    if (change) buffers.change(main, change);
    store().set({ dialog: null });
    if (change) await compile();
  });
}

/** Put a compile error right as its fix says, then compile again to show it is gone. */
export async function applyFix(fix: Fix) {
  await guard(async () => {
    if (fix.kind === "go") return void (await openFile(fix.file, fix.line));
    if (fix.kind === "package") {
      const main = store().info?.mainFile;
      if (!main) return;
      await openFile(main, undefined, true);
      const need = ensurePackage(buffers.text(main) ?? "", fix.name, store().index.stylePackages);
      if (typeof need !== "object") {
        return store().notify(packageNotice(fix.name, need) ?? `The document loads ${fix.name} already.`, need !== "present");
      }
      buffers.change(main, need);
      store().notify(`Added \\usepackage{${fix.name}} to the settings at the top of ${main}.`);
    } else {
      await openFile(fix.file, fix.line, true);
      const text = buffers.text(fix.file) ?? "";
      const lines = text.split("\n");
      const at = lines.slice(0, fix.line - 1).reduce((n, l) => n + l.length + 1, 0) + fix.column - 1;
      if (text[at] !== fix.char) return store().notify("The text there has changed since the compile; compile again to see what is wrong now.", true);
      buffers.change(fix.file, { from: at, insert: "\\" });
    }
    await compile();
  });
}

export async function jumpToPdf() {
  const s = store();
  if (!s.active) return;
  await guard(async () => {
    const rect = await api.synctexForward(s.active!, s.cursor.line);
    if (!rect) return s.notify("That line has no matching place in the PDF");
    store().set({ highlight: { ...rect, nonce: Date.now() }, layout: s.layout === "editor" ? "split" : s.layout });
  });
}

export async function jumpToSource(page: number, x: number, y: number) {
  await guard(async () => {
    const pos = await api.synctexInverse(page, x, y);
    if (!pos) return store().notify("Nothing in the source matches that place");
    const s = store();
    if (s.layout === "pdf") s.set({ layout: "split" });
    await openFile(pos.file, pos.line);
  });
}

// ---------- history and bundles ----------

export async function saveSnapshot() {
  const label = await prompt("Save snapshot", "", "Save", "Name this version so you can find it later, for example “Draft 2”.");
  if (label === null) return;
  if (!(await saveAll())) return;
  await guard(async () => {
    await api.historySnapshot(label);
    store().notify("Snapshot saved");
  });
}

export async function restoreVersion(version: string, label: string) {
  if (version === WORKING) return;
  if (!(await confirm(`Restore “${label}”?`, "Your current files are saved as a snapshot first, so this can be undone from History.", "Restore"))) return;
  if (!(await saveAll())) return;
  await guard(async () => {
    await api.historyRestore(version);
    await reloadOpenFiles();
    store().notify(`Restored “${label}”`);
  });
}

export async function exportBundle(note: string, include: { pdf: boolean; packages: boolean; comments: boolean }) {
  const s = store();
  if (!s.info) return;
  const dest = await saveDialog({
    title: "Export bundle",
    defaultPath: `${s.info.name}.emquad`,
    filters: [{ name: "Emquad bundle", extensions: ["emquad"] }],
  });
  if (!dest) return;
  if (!(await saveAll())) return;
  await guard(async () => {
    await api.bundleExport(dest, note, include);
    store().set({ dialog: null });
    store().notify("Bundle exported");
  });
}

/** Open a `.emquad` file: review it in its project, or make a new project from it. */
export async function importBundle(path?: string) {
  const picked =
    path ??
    (await openDialog({ title: "Import bundle", filters: [{ name: "Emquad bundle", extensions: ["emquad"] }] }));
  if (typeof picked !== "string") return;
  await guard(async () => {
    const info = await api.bundleInspect(picked);
    const from = info.manifest.author.name;
    if (!info.matchesOpenProject && info.knownPath) {
      if (!(await saveAll())) return;
      await enter(await api.projectOpen(info.knownPath));
    } else if (!info.matchesOpenProject) {
      const ok = await confirm(
        `Open “${info.manifest.project.name}” from ${from}?`,
        "This bundle does not belong to a project on this computer. It will be opened as a new project in a folder you choose.",
        "Choose folder",
      );
      if (!ok) return;
      const parent = await openDialog({ directory: true, title: "Choose where to put the project" });
      if (typeof parent !== "string") return;
      if (!(await saveAll())) return;
      await enter(await api.bundleImportNew(picked, parent));
      store().notify(`Opened ${info.manifest.project.name} from ${from}`);
      return;
    }
    if (!(await saveAll())) return;
    const bundleId = await api.bundleImport(picked);
    await refreshPending();
    // A bundle's comments arrive with it, before any of its text is accepted.
    await refreshComments();
    store().set({ view: "history", focusBundle: bundleId });
  });
}

// ---------- comments ----------

function setComments(comments: Comment[]) {
  store().set({ comments });
  buffers.setComments(comments);
}

export const refreshComments = () => guard(async () => setComments(await api.commentsList()));

/** Open the comments panel, ready to write a comment on the selected text. */
export function startComment() {
  if (!buffers.selectionAnchor()) return store().notify("Select the text you want to comment on first");
  store().set({ filesOpen: true, sidePanel: "comments" });
  requestAnimationFrame(() => document.getElementById("comment-draft")?.focus());
}

export async function addComment(text: string): Promise<boolean> {
  const at = buffers.selectionAnchor();
  if (!at) {
    store().notify("Select the text you want to comment on first");
    return false;
  }
  const done = await guard(async () => {
    const before = new Set(store().comments.map((c) => c.id));
    const all = await api.commentAdd(at.path, at.anchor, text);
    setComments(all);
    const added = all.find((c) => !before.has(c.id));
    if (added) {
      store().set({ comment: added.id });
      buffers.showComment(added.id);
    }
    return true;
  });
  return done === true;
}

export async function replyToComment(id: string, text: string): Promise<boolean> {
  return (await guard(async () => (setComments(await api.commentReply(id, text)), true))) === true;
}

export const resolveComment = (id: string, resolved: boolean) =>
  guard(async () => {
    setComments(await api.commentResolve(id, resolved));
    // A resolved comment is put away: its passage is no longer picked out.
    if (resolved && store().comment === id) {
      store().set({ comment: null });
      buffers.showComment(null);
    }
  });

export async function deleteComment(id: string) {
  if (!(await confirm("Delete this comment?", "The comment and its replies are removed for everyone who merges your next bundle.", "Delete", true))) return;
  await guard(async () => setComments(await api.commentDelete(id)));
}

/** Pick a comment out and show the passage it is on. */
export async function pickComment(comment: Comment) {
  await openFile(comment.path, undefined, true);
  store().set({ comment: comment.id });
  // The editor shows the file on the next frame.
  requestAnimationFrame(() => {
    if (!buffers.showComment(comment.id)) store().notify("The text this comment was on is no longer in the file");
  });
}

// ---------- symbols ----------

/** Remember a symbol as used lately, first in the list. */
export function symbolUsed(id: string) {
  const settings = store().settings;
  if (!settings) return;
  const recentSymbols = [id, ...settings.recentSymbols.filter((x) => x !== id)].slice(0, 20);
  store().set({ settings: { ...settings, recentSymbols } });
  void guard(async () => {
    store().set({ settings: await api.settingsUpdate({ recentSymbols }) });
  });
}

// ---------- spelling ----------

/** Make the spelling checker match the settings: its language and the user's own words. */
export async function applySpelling() {
  const settings = store().settings;
  if (!settings) return;
  // The project's own language when it has one, the app's otherwise.
  const language = store().info?.spellcheck || settings.spellcheck;
  await guard(async () => {
    await loadSpelling(language, settings.dictionary, (word) => {
      void guard(async () => {
        store().set({ settings: await api.dictionaryAdd(word) });
        await applySpelling();
      });
    });
    buffers.setSpelling(language !== "off");
  });
}
