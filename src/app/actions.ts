// What the app can do, as plain functions over the store, the editor buffers and the backend.
// Components call these; they never talk to the backend for a multi-step action themselves.
import { relativeTo, resolveFrom } from "../shared/paths";
import { documentStart } from "../features/editor/visualModel";
import { type Reference, appendEntries, entries, formatEntry, makeKey, namedBib, unclosedEntry } from "../features/editor/bib";
import { citeCommand, readStyle, styleChanges } from "../features/editor/citationStyle";
import { PICTURE, figureFor, pictureFolder } from "../features/editor/pictures";
import { type Formula, type Placement, formulaAt, writeFormula } from "../features/editor/equation";
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
  // Each project keeps versions while writing on its own clock.
  lastKeptAsked = 0;
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
      store().notify(`Added ${bib}, with an example reference. Add yours there, and cite them with Insert ▸ Citation….`);
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

// ---------- references ----------

/** The main file's text, from its editor when it is open. */
async function mainText(): Promise<string> {
  const main = store().info?.mainFile;
  if (!main) return "";
  return buffers.text(main) ?? (await api.fileRead(main).catch(() => null))?.text ?? "";
}

/**
 * The .bib file new references go in: the one the document names, made if it is not there yet;
 * for a document that names none, the project's first, else a new references.bib beside the
 * main file. One the document names outside the project is never written: Emquad changes only
 * the project's own files.
 */
async function referencesFile(): Promise<string> {
  const main = store().info?.mainFile ?? "main.tex";
  const folder = main.includes("/") ? main.slice(0, main.lastIndexOf("/") + 1) : "";
  const files = projectFiles();
  const named = namedBib(await mainText());
  let bib: string;
  if (named) {
    // LaTeX looks for it from the main file's folder.
    const path = resolveFrom(folder, named);
    if (!path) throw new Error(`The document takes its references from ${named}, outside the project. Add them there, in your reference manager or another editor.`);
    const found = files.find((p) => p.toLowerCase() === path.toLowerCase());
    if (found) return found;
    bib = path;
  } else {
    const found = files.find((p) => p.toLowerCase().endsWith(".bib"));
    if (found) return found;
    bib = `${folder}references.bib`;
  }
  store().set({ tree: await api.fileCreate(bib, false) });
  return bib;
}

/**
 * Add BibTeX entries to the project's references, each one whose key is not there already;
 * the keys added and the keys it had. Nothing in the file is changed: they go at its end.
 */
async function addToReferences(bibtex: string): Promise<{ bib: string; added: string[]; kept: string[] }> {
  const bib = await referencesFile();
  const open = buffers.text(bib);
  const existing = open ?? (await api.fileRead(bib)).text;
  if (existing === null) throw new Error(`${bib} is not a text file, so references cannot be added to it.`);
  // What is added after an entry that is never closed would be read as part of it.
  const unclosed = unclosedEntry(existing);
  if (unclosed) throw new Error(`The entry ${unclosed} in ${bib} is never closed: a } is missing. Put it right, then add the reference again.`);
  const { text, added, kept } = appendEntries(existing, bibtex);
  if (added.length) {
    if (open !== undefined) {
      // Added in its editor and saved there, so edits not yet saved in it are kept too.
      buffers.change(bib, { from: open.length, insert: text.slice(open.length) });
      await save(bib);
    } else await api.fileWrite(bib, text);
    await refreshIndex();
  }
  return { bib, added, kept };
}

/** Cite `keys` where the cursor is, written the way the document's citation style reads best. */
export async function cite(keys: string[]) {
  if (!keys.length) return;
  const command = citeCommand(await mainText());
  buffers.insertInline(() => ({ before: `\\${command}{${keys.join(",")}}`, after: "" }));
  // A citation shows only where the document prints a list of references.
  const text = await mainText();
  if (!/\\(bibliography|printbibliography)\b/.test(text.replace(/(?<!\\)%[^\n]*/g, ""))) {
    store().notify("Cited. The document has no list of references yet: add one where it should go with Insert ▸ Bibliography.");
  }
}

/** Whether Zotero's picker is open, so that it is not opened twice. */
let pickingInZotero = false;

/** Pick references in Zotero, add them to the project's .bib file, and cite them where the cursor is. */
export async function citeFromZotero() {
  if (pickingInZotero) return store().notify("Zotero's window is open already: choose the references there.");
  pickingInZotero = true;
  try {
    await guard(async () => {
      store().notify("Choose the references in Zotero's window, then press Enter there.");
      const picked = await api.zoteroPick();
      if (!picked || !picked.keys.length) return;
      const { bib, added, kept } = await addToReferences(picked.bibtex);
      store().set({ dialog: null });
      await cite(picked.keys);
      const known = new Set([...added, ...kept].map((k) => k.toLowerCase()));
      const lost = picked.keys.filter((k) => !known.has(k.toLowerCase()));
      if (lost.length) store().notify(`Zotero gave no entry for ${lost.join(", ")}, so ${lost.length === 1 ? "it is" : "they are"} cited but not in ${bib}.`, true);
      else if (added.length) store().notify(`Added ${added.length === 1 ? "a reference" : `${added.length} references`} from Zotero to ${bib}.`);
    });
  } finally {
    pickingInZotero = false;
  }
}

/** Write a reference from the Add reference form into the project's .bib file, and cite it. */
export async function addReference(ref: Reference) {
  await guard(async () => {
    const bib = await referencesFile();
    const have = entries(buffers.text(bib) ?? (await api.fileRead(bib)).text ?? "").map((e) => e.key);
    const key = makeKey(ref.authors, ref.year, ref.title, [...have, ...store().index.citeKeys]);
    await addToReferences(formatEntry(ref, key));
    store().set({ dialog: null });
    await cite([key]);
    // A web page's address is written with \url, which the url package gives (hyperref too).
    if (ref.kind === "online" && ref.url.trim() && ensurePackage(await mainText(), "hyperref", store().index.stylePackages) !== "present") {
      await needPackage("url", "to print the web address");
    }
  });
}

/**
 * Have the document load a package, in the settings at the top of its main file, and say so;
 * nothing when it loads it already. Where its settings are not certain, the user is told.
 */
export async function needPackage(name: string, why: string) {
  const main = store().info?.mainFile;
  if (!main) return;
  const text = await mainText();
  const need = ensurePackage(text, name, store().index.stylePackages);
  // Where Emquad cannot be sure of the settings, the user is told what to add.
  if (typeof need !== "object") return void (need !== "present" && store().notify(packageNotice(name, need) ?? `Add \\usepackage{${name}} to the settings of ${main}.`, true));
  // In its editor when it is open, so that edits not yet saved there are kept.
  if (buffers.has(main)) buffers.change(main, need);
  else await api.fileWrite(main, text.slice(0, need.from) + need.insert + text.slice(need.to));
  store().notify(`Added \\usepackage{${name}} to the settings at the top of ${main}, ${why}.`);
}

// ---------- equations ----------

/** The formula the cursor is in, in the file on screen, for the equation editor to change. */
export function formulaHere(): Formula | null {
  const path = store().active;
  const at = buffers.cursorAt();
  const text = path ? buffers.text(path) : undefined;
  return text === undefined || at === null ? null : formulaAt(text, at);
}

/**
 * Put a formula from the equation editor into the document: in place of the one it was opened
 * on, or where the cursor is. A formula that uses amsmath's matrices, cases or words has the
 * package loaded.
 */
export async function applyFormula(tex: string, placement: Placement, was: Formula | null) {
  const path = store().active;
  if (!path || !tex.trim()) return;
  await guard(async () => {
    if (was) {
      buffers.change(path, { from: was.from, to: was.to, insert: writeFormula(tex, placement, was.label) });
      // A label belongs to a number: a formula no longer numbered loses it, and what refers to it shows ??.
      if (was.label && placement !== "numbered") store().notify(`The formula is no longer numbered, so its label ${was.label} was taken out with the number; references to it show ?? until they are changed.`, true);
    }
    else if (placement === "inline") buffers.insertInline((inMath) => ({ before: inMath ? tex.trim() : writeFormula(tex, "inline"), after: "" }));
    else {
      const block = writeFormula(tex, placement);
      buffers.insertBlock(block, block.length);
    }
    store().set({ dialog: null });
    if (/\\(?:text|[pbvBV]?matrix|cases|dfrac|tfrac|binom)\b|\\begin\{(?:align|gather|multline)/.test(tex)) {
      await needPackage("amsmath", "which the formula needs");
    }
  });
}

// ---------- pictures ----------

/**
 * Files dropped on the window from elsewhere: a bundle is opened; pictures dropped on the text
 * become figures there; anything else is added to the project, as Add files from disk does.
 */
export async function dropFiles(paths: string[], x: number, y: number) {
  if (paths.length === 1 && paths[0].toLowerCase().endsWith(".emquad")) return importBundle(paths[0]);
  if (!store().root || !paths.length) return;
  const at = store().view === "editor" ? buffers.placeAt(x, y) : null;
  const pictures = at === null ? [] : paths.filter((p) => PICTURE.test(p));
  const others = paths.filter((p) => !pictures.includes(p));
  if (pictures.length) await addPictures(pictures.map((source) => ({ source })), at ?? undefined);
  if (others.length) {
    await guard(async () => {
      store().set({ tree: await api.fileImport(others, "") });
      const names = others.map((p) => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1));
      store().notify(`Added ${names.join(", ")} to the project.`);
    });
  }
}

/**
 * Add pictures to the project, beside the main file in figures/ or where \graphicspath says,
 * never over a file that is there, and put each in a figure where the cursor is, or where they
 * were dropped. In a file that is not LaTeX they are only added.
 */
export async function addPictures(pictures: ({ source: string } | { file: File })[], at?: number) {
  await guard(async () => {
    const main = store().info?.mainFile;
    if (!main || !pictures.length) return;
    // The place, as a line of the file it is in: the file may change while the pictures are copied.
    const target = store().active;
    const line = at === undefined || !target ? null : (buffers.text(target) ?? "").slice(0, at).split("\n").length;
    const folder = main.includes("/") ? main.slice(0, main.lastIndexOf("/") + 1) : "";
    const { dir, byName } = pictureFolder(await mainText(), folder);
    const paths: string[] = [];
    for (const p of pictures) {
      if ("source" in p) paths.push(await api.pictureImport(p.source, dir));
      else {
        // A screenshot comes as image.png; the name says where it came from.
        const ext = p.file.type === "image/jpeg" ? "jpg" : "png";
        const name = /^image\.(png|jpe?g)$/i.test(p.file.name) || !p.file.name ? `pasted.${ext}` : p.file.name;
        paths.push(await api.pictureAdd(dir, name, new Uint8Array(await p.file.arrayBuffer())));
      }
    }
    void refreshTree();
    buffers.picturesChanged();
    const active = store().active;
    const activeText = active ? (buffers.text(active) ?? "") : "";
    // Back to a place in the file as it is now, on the same line; the cursor if another file is on screen.
    const lines = activeText.split("\n");
    const place = line !== null && active === target && line <= lines.length ? lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) : undefined;
    if (!active?.toLowerCase().endsWith(".tex")) {
      return store().notify(`Added ${paths.join(", ")} to the project. Open a .tex file to put ${paths.length === 1 ? "it" : "them"} in the document.`);
    }
    // A figure belongs in the text: never among the settings at the top.
    const begin = documentStart(activeText);
    if (begin >= 0 && (place ?? buffers.cursorAt() ?? 0) < begin) {
      return store().notify(`Added ${paths.join(", ")} to the project. Put the cursor in the text of the document to place ${paths.length === 1 ? "it" : "them"} there.`);
    }
    // One block of figures, the cursor in the first caption.
    const labels = [...store().index.labels];
    const files = new Set(projectFiles().map((p) => p.toLowerCase()));
    const figures = paths.map((path) => {
      // LaTeX looks beside the main file before the \graphicspath folders: a picture of the same
      // name there would be shown instead, so this one is named by its folder too.
      const shadowed = files.has(`${folder}${path.slice(path.lastIndexOf("/") + 1)}`.toLowerCase());
      const figure = figureFor(path, folder, byName && !shadowed, labels);
      labels.push(figure.label);
      return figure;
    });
    buffers.insertBlock(figures.map((f) => f.text).join("\n"), figures[0].caret, place);
    await needPackage("graphicx", "which shows pictures");
    store().notify(`Added ${paths.join(", ")} as ${paths.length === 1 ? "a figure" : "figures"}. Type ${paths.length === 1 ? "its" : "the first"} caption.`);
  });
}

/** The citation style the document names now. */
export const currentCitationStyle = async () => readStyle(await mainText());

/** Give the document a citation style, in its main file, and compile to show it. */
export async function setCitationStyle(id: string) {
  const main = store().info?.mainFile;
  if (!main) return;
  await guard(async () => {
    await openFile(main, undefined, true);
    const changes = styleChanges(buffers.text(main) ?? "", id);
    if ("error" in changes) return store().notify(changes.error, true);
    buffers.change(main, changes);
    store().set({ dialog: null });
    await compile();
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
    // A setting written in a way that cannot be changed for certain is left, and the dialog says why.
    if (change && "error" in change) return store().notify(change.error, true);
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

// ---------- Word, and PDFs with notes ----------

/** Whether Pandoc is here; when it is not, the user is told how to get it. */
async function havePandoc(): Promise<boolean> {
  if (await api.pandocAvailable()) return true;
  await confirm(
    "Pandoc is needed",
    "Sending to Word and opening Word files use Pandoc, a free program installed separately from pandoc.org. Install it, then try again; Emquad finds it by itself.",
    "OK",
  );
  return false;
}

/** The .bib file the document takes its references from, as a project path, if it has one there. */
async function referencesForWord(): Promise<string | null> {
  const main = store().info?.mainFile ?? "";
  const folder = main.includes("/") ? main.slice(0, main.lastIndexOf("/") + 1) : "";
  const named = namedBib(await mainText());
  const path = named ? resolveFrom(folder, named) : null;
  return path && projectFiles().some((p) => p.toLowerCase() === path.toLowerCase()) ? path : null;
}

/** Turn the document into a Word file, for someone who works in Word. */
export async function sendToWord() {
  const s = store();
  if (!s.info || !(await havePandoc())) return;
  const dest = await saveDialog({ title: "Send to Word", defaultPath: `${s.info.name}.docx`, filters: [{ name: "Word document", extensions: ["docx"] }] });
  if (!dest || !(await saveAll())) return;
  await guard(async () => {
    store().notify("Making the Word file…");
    const warnings = await api.wordExport(dest, await referencesForWord());
    store().notify(
      warnings.length
        ? `Saved ${dest}. Pandoc could not carry ${warnings.length === 1 ? "one thing" : `${warnings.length} things`} over exactly; check the Word file.`
        : `Saved ${dest}.`,
    );
  });
}

/** Make a new project from a Word file, and open it. */
export async function openWordFile() {
  if (!(await havePandoc())) return;
  const source = await openDialog({ title: "Open a Word file", filters: [{ name: "Word document", extensions: ["docx"] }] });
  if (typeof source !== "string") return;
  const parent = await openDialog({ directory: true, title: "Choose where to put the new project" });
  if (typeof parent !== "string") return;
  if (!(await saveAll())) return;
  await guard(async () => {
    store().notify("Turning the Word file into LaTeX…");
    await enter(await api.wordImport(source, parent));
    store().notify("Opened the Word file as a new project. Its pictures are in the media folder.");
  });
}

/** Compile, so a PDF with notes on it is of the text as it is now; whether there is one. */
async function freshPdf(): Promise<boolean> {
  await compile();
  const build = store().build;
  if (!build?.hasPdf) store().notify("The document has to compile before a PDF can be made from it.", true);
  return !!build?.hasPdf;
}

/** Save a copy of the PDF with the open comments on it, as PDF viewers show comments. */
export async function savePdfWithComments() {
  const s = store();
  if (!s.info) return;
  if (!s.comments.some((c) => !c.resolved)) return s.notify("There are no open comments to put on the PDF.");
  if (!(await freshPdf())) return;
  const dest = await saveDialog({ title: "Save PDF with comments", defaultPath: `${s.info.name} with comments.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!dest) return;
  await guard(async () => {
    const count = await api.pdfSaveWithComments(dest);
    store().notify(`Saved ${dest}, with ${count === 1 ? "one comment" : `${count} comments`} on it.`);
  });
}

/** Save a copy of the PDF with everything changed since a version marked on it. */
export async function savePdfWithChanges(version: string, label: string) {
  const s = store();
  if (!s.info || !(await freshPdf())) return;
  const dest = await saveDialog({ title: "Save PDF with changes", defaultPath: `${s.info.name} changes since ${label}.pdf`.replace(/[\\/:*?"<>|]/g, "-"), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!dest) return;
  await guard(async () => {
    const count = await api.pdfSaveWithChanges(version, label, dest);
    store().notify(count ? `Saved ${dest}, with the changes since “${label}” marked.` : `Saved ${dest}. Nothing in the PDF changed since “${label}”.`);
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
