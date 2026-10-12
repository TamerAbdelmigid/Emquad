// Typed wrappers over the Rust command surface. Payload types are generated from Rust (./bindings).
import { invoke } from "@tauri-apps/api/core";
import type { BuildOutput } from "./bindings/BuildOutput";
import type { BundleInfo } from "./bindings/BundleInfo";
import type { ChangedFile } from "./bindings/ChangedFile";
import type { Decision } from "./bindings/Decision";
import type { FileContent } from "./bindings/FileContent";
import type { FileDiff } from "./bindings/FileDiff";
import type { HistoryList } from "./bindings/HistoryList";
import type { Manifest } from "./bindings/Manifest";
import type { OpenedProject } from "./bindings/OpenedProject";
import type { PdfRect } from "./bindings/PdfRect";
import type { ProjectIndex } from "./bindings/ProjectIndex";
import type { ProjectInfo } from "./bindings/ProjectInfo";
import type { Review } from "./bindings/Review";
import type { Settings } from "./bindings/Settings";
import type { SourcePos } from "./bindings/SourcePos";
import type { TreeNode } from "./bindings/TreeNode";

export type {
  BuildOutput,
  BundleInfo,
  ChangedFile,
  Decision,
  FileDiff,
  HistoryList,
  Manifest,
  OpenedProject,
  PdfRect,
  ProjectIndex,
  ProjectInfo,
  Review,
  Settings,
  SourcePos,
  TreeNode,
};
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
  settingsUpdate: (patch: { displayName?: string; compileOnSave?: boolean; editorFontSize?: number }) =>
    invoke<Settings>("settings_update", patch),
  startupFile: () => invoke<string | null>("startup_file"),

  projectCreate: (parentDir: string, name: string, template: string) =>
    invoke<OpenedProject>("project_create", { parentDir, name, template }),
  projectOpen: (dir: string) => invoke<OpenedProject>("project_open", { dir }),
  projectClose: () => invoke<void>("project_close"),
  projectTree: () => invoke<TreeNode[]>("project_tree"),
  projectIndex: () => invoke<ProjectIndex>("project_index"),
  projectSetMain: (path: string) => invoke<ProjectInfo>("project_set_main", { path }),
  uiStateSave: (json: string) => invoke<void>("ui_state_save", { json }),

  fileRead: (path: string) => invoke<FileContent>("file_read", { path }),
  fileWrite: (path: string, text: string) => invoke<void>("file_write", { path, text }),
  fileCreate: (path: string, isDir: boolean) => invoke<TreeNode[]>("file_create", { path, isDir }),
  fileRename: (from: string, to: string) => invoke<TreeNode[]>("file_rename", { from, to }),
  fileDelete: (path: string) => invoke<TreeNode[]>("file_delete", { path }),
  fileImport: (sources: string[], destDir: string) =>
    invoke<TreeNode[]>("file_import", { sources, destDir }),

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
  historyChangedFiles: (version: string, against: string | null) =>
    invoke<ChangedFile[]>("history_changed_files", { version, against }),
  historyFileDiff: (version: string, against: string | null, path: string) =>
    invoke<FileDiff>("history_file_diff", { version, against, path }),
  historyRestore: (version: string) => invoke<string>("history_restore", { version }),

  bundleExport: (dest: string, note: string, includePdf: boolean) =>
    invoke<Manifest>("bundle_export", { dest, note, includePdf }),
  bundleInspect: (path: string) => invoke<BundleInfo>("bundle_inspect", { path }),
  bundleImport: (path: string) => invoke<string>("bundle_import", { path }),
  bundleImportNew: (path: string, parentDir: string) =>
    invoke<OpenedProject>("bundle_import_new", { path, parentDir }),
  reviewGet: (bundleId: string) => invoke<Review>("review_get", { bundleId }),
  reviewDecide: (bundleId: string, itemId: string, decision: Decision) =>
    invoke<Review>("review_decide", { bundleId, itemId, decision }),
  reviewFinish: (bundleId: string) => invoke<string>("review_finish", { bundleId }),
  reviewCancel: (bundleId: string) => invoke<void>("review_cancel", { bundleId }),
};
