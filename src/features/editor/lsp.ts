// The connection to texlab, the LaTeX language server, when it is installed. It adds completion
// that knows the packages in use, hover information, go to definition, find references and
// rename. Without it the editor falls back to its built-in completion.
import {
  LSPClient,
  LSPPlugin,
  type Transport,
  Workspace,
  type WorkspaceFile,
  findReferencesKeymap,
  hoverTooltips,
  jumpToDefinitionKeymap,
  renameKeymap,
} from "@codemirror/lsp-client";
import type { ChangeSet, Extension, Text } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

let client: LSPClient | null = null;
let root = "";
const handlers = new Set<(message: string) => void>();
/** Opens a project file in the editor and gives its view; set by the app. */
let display: (path: string) => Promise<EditorView | null> = async () => null;

/** How the app puts a project file in front of the user when the server points into it. */
export function setDisplay(open: (path: string) => Promise<EditorView | null>) {
  display = open;
}

/** The project path a file URI from the server names, or null for a file outside the project. */
export function pathFromUri(projectRoot: string, uri: string): string | null {
  // The server may write the drive letter in either case, and its colon encoded or not.
  const plain = (u: string) => decodeURIComponent(u).replace(/^file:\/\/\/?/, "").replace(/\\/g, "/").toLowerCase();
  const base = plain(fileUri(projectRoot, "")).replace(/\/$/, "");
  const target = decodeURIComponent(uri).replace(/^file:\/\/\/?/, "").replace(/\\/g, "/");
  if (!target.toLowerCase().startsWith(`${base}/`)) return null;
  const rel = target.slice(base.length + 1);
  return rel.split("/").some((part) => part === ".." || part === "") ? null : rel;
}

/**
 * The files the server knows are open. The app shows one file at a time in one editor, so a
 * file the server points to that is not shown (a definition in another file) is opened in its
 * tab and shown, through `display`.
 */
class ProjectWorkspace extends Workspace {
  files: (WorkspaceFile & { view: EditorView })[] = [];
  private versions: Record<string, number> = {};

  private nextVersion(uri: string) {
    return (this.versions[uri] = (this.versions[uri] ?? -1) + 1);
  }

  syncFiles() {
    const out: { changes: ChangeSet; file: WorkspaceFile; prevDoc: Text }[] = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (!changes.empty) {
        out.push({ changes, file, prevDoc: file.doc });
        file.doc = file.view.state.doc;
        file.version = this.nextVersion(file.uri);
        plugin.clear();
      }
    }
    return out;
  }

  openFile(uri: string, languageId: string, view: EditorView) {
    if (this.getFile(uri)) return;
    const file = { uri, languageId, version: this.nextVersion(uri), doc: view.state.doc as Text, view, getView: () => view };
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri: string) {
    if (!this.getFile(uri)) return;
    this.files = this.files.filter((f) => f.uri !== uri);
    this.client.didClose(uri);
  }

  async displayFile(uri: string): Promise<EditorView | null> {
    const path = pathFromUri(root, uri);
    return path === null ? null : display(path);
  }
}

/** Called with each message the server sends. */
export function lspReceive(message: string) {
  handlers.forEach((handle) => handle(message));
}

/** A file URI for a path inside the project, as the server expects it. */
export function fileUri(projectRoot: string, path: string) {
  const full = `${projectRoot.replace(/\\/g, "/")}/${path}`;
  // A network share, //server/share/..., keeps its server as the URI's host.
  const share = full.startsWith("//");
  const parts = full.split("/").filter((p) => p !== "");
  const encoded = parts.map((p, i) => (i === 0 && (share || /^[A-Za-z]:$/.test(p)) ? p : encodeURIComponent(p)));
  return `${share ? "file://" : "file:///"}${encoded.join("/")}`;
}

/**
 * Server text is shown as HTML, and it can quote the user's documents, which may have come from
 * someone else. Keep formatting only: nothing that loads, runs, submits or navigates.
 */
export function sanitize(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, link, meta, base, form, img, svg, video, audio").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      // A link would take the whole window away from the app, so links keep their text only.
      const dangerous = attr.name.startsWith("on") || ["style", "href", "src", "srcset", "action", "formaction"].includes(attr.name);
      if (dangerous) el.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

export function startLsp(projectRoot: string, send: (message: string) => void) {
  stopLsp();
  root = projectRoot;
  const transport: Transport = {
    send,
    subscribe: (handler) => void handlers.add(handler),
    unsubscribe: (handler) => void handlers.delete(handler),
  };
  client = new LSPClient({
    rootUri: fileUri(projectRoot, "").replace(/\/$/, ""),
    timeout: 10000,
    sanitizeHTML: sanitize,
    workspace: (c) => new ProjectWorkspace(c),
    extensions: [hoverTooltips(), keymap.of([...jumpToDefinitionKeymap, ...findReferencesKeymap, ...renameKeymap])],
  }).connect(transport);
}

export function stopLsp() {
  client?.disconnect();
  client = null;
  handlers.clear();
}

export const lspActive = () => client !== null;

/** What an editor for this file needs in order to talk to the server; nothing when it is absent. */
export function lspFor(path: string): Extension {
  return client ? client.plugin(fileUri(root, path), "latex") : [];
}
