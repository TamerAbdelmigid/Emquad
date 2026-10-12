// What the app can do, as plain functions over the store, the editor buffers and the backend.
// Components call these; they never talk to the backend for a multi-step action themselves.
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { buffers } from "../features/editor/buffers";
import { type OpenedProject, WORKING, api, errorOf } from "../ipc/api";
import { confirm, prompt, store } from "../state/store";

/** Run an action and show any failure to the user instead of losing it. */
export async function guard<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (e) {
    store().notify(errorOf(e).message, true);
    return undefined;
  }
}

function persistUi() {
  const s = store();
  if (!s.root) return;
  void api.uiStateSave(JSON.stringify({ tabs: s.tabs.map((t) => t.path), active: s.active })).catch(() => {});
}

async function enter(opened: OpenedProject) {
  buffers.closeAll();
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
  let remembered: { tabs?: string[]; active?: string | null } = {};
  try {
    remembered = JSON.parse(opened.uiState ?? "{}");
  } catch {
    // A damaged state file only costs the remembered tabs.
  }
  const wanted = remembered.tabs?.length ? remembered.tabs : [opened.info.mainFile];
  for (const path of wanted.filter(Boolean)) await openFile(path, undefined, true);
  const active = remembered.active && buffers.has(remembered.active) ? remembered.active : store().tabs[0]?.path;
  store().set({ active: active ?? null });
  void refreshIndex();
  void refreshPending();
  // Show the last PDF if one exists from an earlier session.
  store().set({ pdfVersion: store().pdfVersion + 1 });
}

export const openProject = (dir: string) => guard(async () => enter(await api.projectOpen(dir)));

export async function chooseAndOpenProject() {
  const dir = await openDialog({ directory: true, title: "Open a project folder" });
  if (typeof dir === "string") await openProject(dir);
}

export async function createProject(name: string, template: string) {
  const parent = await openDialog({ directory: true, title: "Choose where to create the project" });
  if (typeof parent !== "string") return;
  await guard(async () => {
    await enter(await api.projectCreate(parent, name, template));
    store().set({ dialog: null });
  });
}

export async function closeProject() {
  if (!(await saveAll())) return;
  await api.projectClose();
  buffers.closeAll();
  store().set({ root: null, info: null, tree: [], tabs: [], active: null, view: "start", settings: await api.settingsGet() });
}

export const refreshTree = () => guard(async () => store().set({ tree: await api.projectTree() }));
export const refreshIndex = () => guard(async () => store().set({ index: await api.projectIndex() }));

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

export async function save(path: string | null = store().active): Promise<boolean> {
  if (!path) return true;
  const text = buffers.text(path);
  if (text === undefined) return true;
  const done = await guard(async () => {
    await api.fileWrite(path, text);
    buffers.markSaved(path, text);
    const s = store();
    s.set({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty: false } : t)) });
    return true;
  });
  if (done) void refreshIndex();
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
  buffers.setDiagnostics(out.diagnostics);
  const s = store();
  s.set({ build: out, pdfVersion: out.hasPdf ? s.pdfVersion + 1 : s.pdfVersion });
  const first = out.diagnostics.find((d) => d.severity === "error");
  if (first && first.line > 0) await openFile(first.file, first.line, true);
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

export async function exportBundle(note: string, includePdf: boolean) {
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
    await api.bundleExport(dest, note, includePdf);
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
    store().set({ view: "history", focusBundle: bundleId });
  });
}
