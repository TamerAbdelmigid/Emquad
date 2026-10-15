// Typed wrappers over the Rust command surface. Payload types are generated from Rust (./bindings).
import { invoke } from "@tauri-apps/api/core";
import type { BuildOutput } from "./bindings/BuildOutput";
import type { BundleInfo } from "./bindings/BundleInfo";
import type { ChangedFile } from "./bindings/ChangedFile";
import type { Comment } from "./bindings/Comment";
import type { Decision } from "./bindings/Decision";
import type { Engines } from "./bindings/Engines";
import type { FileContent } from "./bindings/FileContent";
import type { FileDiff } from "./bindings/FileDiff";
import type { HistoryList } from "./bindings/HistoryList";
import type { Manifest } from "./bindings/Manifest";
import type { OpenedProject } from "./bindings/OpenedProject";
import type { PackagesInfo } from "./bindings/PackagesInfo";
import type { PdfRect } from "./bindings/PdfRect";
import type { Picked } from "./bindings/Picked";
import type { ProjectIndex } from "./bindings/ProjectIndex";
import type { ProjectInfo } from "./bindings/ProjectInfo";
import type { Review } from "./bindings/Review";
import type { SearchResult } from "./bindings/SearchResult";
import type { Settings } from "./bindings/Settings";
import type { SourcePos } from "./bindings/SourcePos";
import type { TreeNode } from "./bindings/TreeNode";
import type { WordImport } from "./bindings/WordImport";

export type {
  BuildOutput,
  BundleInfo,
  ChangedFile,
  Comment,
  Decision,
  Engines,
  FileDiff,
  HistoryList,
  Manifest,
  OpenedProject,
  PackagesInfo,
  PdfRect,
  Picked,
  ProjectIndex,
  ProjectInfo,
  Review,
  SearchResult,
  Settings,
  SourcePos,
  TreeNode,
};
export type { Anchor } from "./bindings/Anchor";
export type { Block } from "./bindings/Block";
export type { Diagnostic } from "./bindings/Diagnostic";
export type { ReviewItem } from "./bindings/ReviewItem";
export type { Segment } from "./bindings/Segment";
export type { Version } from "./bindings/Version";

/** The working copy, wherever a version id is expected. */
export const WORKING = "working";

export interface AppError {
  code: string;
  message: string;
}

export function errorOf(e: unknown): AppError {
  if (e && typeof e === "object" && "message" in e) {
    const o = e as { code?: unknown; message: unknown };
    return { code: typeof o.code === "string" ? o.code : "error", message: String(o.message) };
  }
  return { code: "error", message: String(e) };
}

export const api = {
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsUpdate: (patch: { displayName?: string; compileOnSave?: boolean; editorFontSize?: number; theme?: string; spellcheck?: string; recentSymbols?: string[] }) =>
    invoke<Settings>("settings_update", patch),
  dictionaryAdd: (word: string) => invoke<Settings>("dictionary_add", { word }),
  dictionaryRemove: (word: string) => invoke<Settings>("dictionary_remove", { word }),
  startupFile: () => invoke<string | null>("startup_file"),

  projectCreate: (parentDir: string, name: string, template: string) =>
    invoke<OpenedProject>("project_create", { parentDir, name, template }),
  projectOpen: (dir: string) => invoke<OpenedProject>("project_open", { dir }),
  projectClose: () => invoke<void>("project_close"),
  projectTree: () => invoke<TreeNode[]>("project_tree"),
  projectIndex: () => invoke<ProjectIndex>("project_index"),
  projectSearch: (query: string, matchCase: boolean) =>
    invoke<SearchResult>("project_search", { query, matchCase }),
  projectSetMain: (path: string) => invoke<ProjectInfo>("project_set_main", { path }),
  projectSetEngine: (engine: string) => invoke<ProjectInfo>("project_set_engine", { engine }),
  projectSetSpellcheck: (language: string) => invoke<ProjectInfo>("project_set_spellcheck", { language }),
  windowNew: () => invoke<void>("window_new"),
  enginesAvailable: () => invoke<Engines>("engines_available"),
  uiStateSave: (json: string) => invoke<void>("ui_state_save", { json }),

  fileRead: (path: string) => invoke<FileContent>("file_read", { path }),
  fileWrite: (path: string, text: string) => invoke<void>("file_write", { path, text }),
  fileCreate: (path: string, isDir: boolean) => invoke<TreeNode[]>("file_create", { path, isDir }),
  fileRename: (from: string, to: string) => invoke<TreeNode[]>("file_rename", { from, to }),
  fileDelete: (path: string) => invoke<TreeNode[]>("file_delete", { path }),
  fileImport: (sources: string[], destDir: string) =>
    invoke<TreeNode[]>("file_import", { sources, destDir }),
  /** Add a pasted picture to the project folder `dir`; the project path it was given. */
  pictureAdd: (dir: string, name: string, bytes: Uint8Array) =>
    invoke<string>("picture_add", bytes, { headers: { "x-dir": encodeURIComponent(dir), "x-name": encodeURIComponent(name) } }),
  /** Copy a picture from elsewhere on disk into the project folder `dir`; the project path it was given. */
  pictureImport: (source: string, dir: string) => invoke<string>("picture_import", { source, dir }),

  projectImage: (path: string) => invoke<ArrayBuffer>("project_image", { path }),

  commentsList: () => invoke<Comment[]>("comments_list"),
  commentAdd: (path: string, anchor: { quote: string; before: string; after: string; line: number }, text: string) =>
    invoke<Comment[]>("comment_add", { path, anchor, text }),
  commentReply: (id: string, text: string) => invoke<Comment[]>("comment_reply", { id, text }),
  commentResolve: (id: string, resolved: boolean) => invoke<Comment[]>("comment_resolve", { id, resolved }),
  commentDelete: (id: string) => invoke<Comment[]>("comment_delete", { id }),
  commentsReanchor: (moved: { id: string; quote: string; before: string; after: string; line: number }[]) =>
    invoke<Comment[]>("comments_reanchor", { moved }),

  compileRun: () => invoke<BuildOutput>("compile_run"),
  compileCancel: () => invoke<void>("compile_cancel"),
  pdfRead: () => invoke<ArrayBuffer>("pdf_read"),
  pdfSave: (dest: string) => invoke<void>("pdf_save", { dest }),
  synctexForward: (file: string, line: number) =>
    invoke<PdfRect | null>("synctex_forward", { file, line }),
  synctexInverse: (page: number, x: number, y: number) =>
    invoke<SourcePos | null>("synctex_inverse", { page, x, y }),

  historyList: () => invoke<HistoryList>("history_list"),
  historySnapshot: (label: string) => invoke<string>("history_snapshot", { label }),
  historyKeepWhileWriting: () => invoke<boolean>("history_keep_while_writing"),
  historyChangedFiles: (version: string, against: string | null) =>
    invoke<ChangedFile[]>("history_changed_files", { version, against }),
  historyFileDiff: (version: string, against: string | null, path: string) =>
    invoke<FileDiff>("history_file_diff", { version, against, path }),
  historyRestore: (version: string) => invoke<string>("history_restore", { version }),

  /** Whether Pandoc, which Word documents need, is on this computer. */
  pandocAvailable: () => invoke<boolean>("pandoc_available"),
  /** The document as a Word file at `dest`; what Pandoc warned about. */
  wordExport: (dest: string, bibliographies: string[]) => invoke<string[]>("word_export", { dest, bibliographies }),
  /** A new project from a Word file, in a folder named after it inside `parentDir`, opened; what Pandoc warned about. */
  wordImport: (source: string, parentDir: string) => invoke<WordImport>("word_import", { source, parentDir }),
  /** A copy of the PDF at `dest` with the open comments on it; how many. */
  pdfSaveWithComments: (dest: string) => invoke<number>("pdf_save_with_comments", { dest }),
  /** A copy of the PDF at `dest` with what changed since `version` marked; how many marks. */
  pdfSaveWithChanges: (version: string, label: string, dest: string) => invoke<number>("pdf_save_with_changes", { version, label, dest }),

  /** References picked in Zotero, on this computer; null when the picker was closed without one. */
  zoteroPick: () => invoke<Picked | null>("zotero_pick"),

  packagesInfo: () => invoke<PackagesInfo>("packages_info"),
  bundleExport: (dest: string, note: string, include: { pdf: boolean; packages: boolean; comments: boolean }) =>
    invoke<Manifest>("bundle_export", {
      dest,
      note,
      includePdf: include.pdf,
      includePackages: include.packages,
      includeComments: include.comments,
    }),
  bundleInspect: (path: string) => invoke<BundleInfo>("bundle_inspect", { path }),
  bundleImport: (path: string) => invoke<string>("bundle_import", { path }),
  bundleImportNew: (path: string, parentDir: string) =>
    invoke<OpenedProject>("bundle_import_new", { path, parentDir }),
  reviewGet: (bundleId: string) => invoke<Review>("review_get", { bundleId }),
  reviewDecide: (bundleId: string, itemId: string, decision: Decision) =>
    invoke<Review>("review_decide", { bundleId, itemId, decision }),
  reviewEdit: (bundleId: string, itemId: string, text: string) =>
    invoke<Review>("review_edit", { bundleId, itemId, text }),
  reviewFinish: (bundleId: string) => invoke<string>("review_finish", { bundleId }),
  lspSend: (message: string) => invoke<void>("lsp_send", { message }),
  reviewCancel: (bundleId: string) => invoke<void>("review_cancel", { bundleId }),
};
