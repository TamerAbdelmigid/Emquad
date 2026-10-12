// The connection to texlab, the LaTeX language server, when it is installed. It adds completion
// that knows the packages in use, hover information, go to definition, find references and
// rename. Without it the editor falls back to its built-in completion.
import {
  LSPClient,
  type Transport,
  findReferencesKeymap,
  hoverTooltips,
  jumpToDefinitionKeymap,
  renameKeymap,
} from "@codemirror/lsp-client";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

let client: LSPClient | null = null;
let root = "";
const handlers = new Set<(message: string) => void>();

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
