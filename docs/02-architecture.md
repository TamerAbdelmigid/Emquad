# Architecture

## Stack

| Concern | Choice | Why this one |
|---|---|---|
| Desktop shell | **Tauri 2** (Rust backend, system webview) | Small installers, first-class support for bundling helper executables, Rust backend suits file and process work |
| UI | **React + TypeScript**, built with **Vite** | Largest ecosystem for the editor and PDF components |
| Package manager | **pnpm** | Fast, strict; one lockfile |
| Source editor | **CodeMirror 6** | The editor Overleaf itself uses; extensible enough for change highlighting and the later visual mode |
| LaTeX grammar | `codemirror-lang-latex` (a Lezer grammar) | Syntax highlighting and structure without writing a parser |
| Compiler | **Tectonic**, shipped as a sidecar executable | Self-contained; downloads LaTeX packages on demand; no TeX Live install |
| PDF rendering | **PDF.js** (`pdfjs-dist`) | Standard, renders to canvas with a text layer, lets us handle clicks for source lookup |
| Source ↔ PDF lookup | **SyncTeX** data produced by the compiler | The standard mechanism; see "SyncTeX" below |
| Language intelligence | **texlab**, shipped as a sidecar, spoken to over the Language Server Protocol | Completion, diagnostics, references, document symbols |
| History and merge | **libgit2** through the Rust `git2` crate | Snapshots, ancestry and three-way merge already solved; no system git required |
| Archive format | zip, through the Rust `zip` crate | A `.quire` file is a zip; recipients can also open it with any unzip tool |
| File watching | Rust `notify` crate | Detect external edits to project files |
| UI state | **Zustand** | Small, no boilerplate, works well with CodeMirror's own state |
| Styling | Plain CSS with custom properties, CSS Modules per component | The mockup's tokens port directly; no runtime styling library |
| UI tests | **Vitest** + Testing Library | |
| Backend tests | `cargo test` | |

Pin exact versions of every dependency and of the two sidecar binaries when scaffolding. The lockfiles record library versions; record the two sidecar versions in the repository README. Do not copy version numbers from memory; resolve the current stable release at the time of implementation.

### Licensing notes to respect

- **texlab** is GPL-3.0. It must remain a separate executable that the app starts and talks to over a pipe; do not link it into the app.
- **libgit2** is GPL-2.0 with a linking exception that permits linking from software under other licenses.
- Tectonic, CodeMirror, PDF.js, Tauri, React, `git2` and `zip` are under permissive licenses.
- No Overleaf source code is used. Overleaf is AGPL; the app only follows its layout conventions.

Decide the app's own license before the first public release.

## Process model

```
┌──────────────────────────── Quire (one desktop process) ────────────────────────────┐
│                                                                                     │
│   Webview (React)                              Rust core                            │
│   ───────────────                              ─────────                            │
│   files / outline        invoke(command)  ──▶  project   (files, watching)          │
│   editor (CodeMirror)                          compile   (engine trait)             │
│   preview (PDF.js)       ◀──  events           synctex   (parse + lookup)           │
│   history / review                             history   (git2)                     │
│   bundle dialogs                               bundle    (zip + manifest)           │
│                                                lsp       (pipe to texlab)           │
│                                                settings                             │
└──────────────────────────────────────────────────┬──────────────────────────────────┘
                                                   │ starts, as child processes
                                     ┌─────────────┴─────────────┐
                                     ▼                           ▼
                              tectonic (sidecar)           texlab (sidecar)
```

- The webview never touches the file system or starts processes directly. Every such action is a Rust command. This keeps all write paths in one place, where the safety rules in `03-bundles-and-history.md` are enforced.
- Sidecars are declared under `bundle.externalBin` in the Tauri configuration and started from Rust with `tokio::process`.
- Long operations (compile, import, export) run on background tasks and report through events; the UI never blocks.

## On-disk layout of a project

```
my-paper/                    ← the user's folder; everything outside .quire/ is theirs
├── main.tex
├── sections/…
├── figures/…
├── refs.bib
└── .quire/
    ├── project.json         ← project id, main file, engine, format version
    ├── history.git/         ← a git directory whose work tree is the project folder
    ├── build/               ← compiler output: PDF, log, SyncTeX data, intermediates
    ├── incoming/            ← extracted bundles awaiting review
    └── state.json           ← open tabs, cursor, zoom; safe to delete
```

Rules:

- `history.git` is a git directory kept apart from the work tree (`--git-dir` / `--work-tree` style), so a user who keeps the project in their own git repository is unaffected. `.quire/` is always excluded from the history itself.
- `build/`, `incoming/` and `state.json` are disposable. Deleting them loses nothing.
- `project.json` holds: `formatVersion`, `projectId` (a UUID created once, carried in every bundle), `name`, `mainFile`, `engine`.

App-wide settings (display name, author id, recent projects, preferences) live in the operating system's per-user config directory, obtained through Tauri's path API.

## Rust modules

| Module | Responsibility |
|---|---|
| `project` | Open or create a project, read and write files, file tree, rename/move/delete, watch for external changes |
| `compile` | The `Engine` trait and its implementations; run a compile, capture output, parse diagnostics |
| `synctex` | Load the SyncTeX file for the last build; forward and inverse lookup |
| `history` | Snapshots, version list, diffs between versions, restore |
| `bundle` | Write and read `.quire` files; validate manifests |
| `review` | Build a review session from an imported bundle, apply decisions, finish or cancel a merge |
| `lsp` | Start texlab, forward JSON-RPC messages both ways |
| `settings` | App-wide and per-project settings |

Each module exposes plain Rust functions that are unit-tested without Tauri. A thin `commands` layer wraps them as Tauri commands and maps errors to a single serialisable error type with a stable `code` and a user-readable `message`.

## Command surface

Names are indicative; keep the grouping. All paths in arguments are relative to the project root and are validated in Rust to stay inside it.

**Project**

| Command | Returns |
|---|---|
| `project_create(dir, template)` | project info |
| `project_open(dir)` | project info, file tree, restored UI state |
| `file_read(path)` | text, or a marker that the file is binary |
| `file_write(path, text)` | — |
| `file_create(path, kind)` / `file_rename(from, to)` / `file_delete(path)` / `file_import(sourcePaths, destDir)` | updated tree |
| event `project://changed` | paths changed outside the app |

**Compile**

| Command | Returns |
|---|---|
| `compile_run()` | `{ ok, diagnostics[], pdfPath, durationMs }` |
| `compile_cancel()` | — |
| `pdf_read()` | bytes of the last successful PDF |
| events `compile://started`, `compile://log`, `compile://finished` | progress and streamed log lines |

A diagnostic is `{ severity, file, line, message }`.

**SyncTeX**

| Command | Returns |
|---|---|
| `synctex_forward(file, line, column)` | `{ page, x, y, width, height }` in PDF points |
| `synctex_inverse(page, x, y)` | `{ file, line }` |

**History**

| Command | Returns |
|---|---|
| `history_list()` | versions, newest first: id, kind (working, snapshot, bundle, merge), label, author, time, summary |
| `history_snapshot(label)` | new version id |
| `history_changed_files(version, against)` | paths with a status each |
| `history_file_diff(version, against, path)` | hunks with word-level detail (see `03-…`) |
| `history_restore(version)` | — (snapshots the working copy first) |

**Bundle and review**

| Command | Returns |
|---|---|
| `bundle_export(options)` | path written |
| `bundle_inspect(path)` | manifest summary, and whether it matches an existing project |
| `bundle_import(path)` | either a new project, or a review session id |
| `review_get(session)` | items: conflicts and automatic merges, with current decisions |
| `review_decide(session, itemId, decision)` | updated item |
| `review_finish(session)` | new merge version id |
| `review_cancel(session)` | — |

**LSP**

| Command | Returns |
|---|---|
| `lsp_send(message)` | — |
| event `lsp://message` | messages from texlab |

Generate the TypeScript types for commands and payloads from the Rust definitions (for example with `tauri-specta` or `ts-rs`) so the two sides cannot drift.

## Compile

```rust
trait Engine {
    fn name(&self) -> &str;
    fn compile(&self, project: &Project, on_log: impl Fn(&str)) -> Result<BuildOutput>;
}
```

- **`TectonicEngine`** (default) runs the sidecar against the main file with output directed to `.quire/build/`, SyncTeX enabled, and logs kept.
- **`LatexmkEngine`** (later) is offered only when `latexmk` is found on the system, and runs it with SyncTeX, non-stop interaction and file-line-error output.

Behaviour:

- Only one compile runs at a time. A new request while one is running cancels it and starts again.
- Unsaved editor buffers are written to disk before compiling.
- On failure the previous PDF is kept and shown; `pdfPath` still points to it and `ok` is false.
- Diagnostics come from parsing the compiler's output. Keep the parser in its own unit with fixture logs as tests, because log formats are irregular.

Known limits of Tectonic to surface honestly in the UI when they bite: it is XeTeX-based, so documents relying on pdfTeX-only primitives may fail; `--shell-escape` workflows such as `minted` are restricted; its package set tracks a fixed TeX Live snapshot. The first compile of a document needs internet to fetch packages; after that they are cached.

## SyncTeX

The compiler writes a `.synctex.gz` file next to the PDF. The app needs two lookups from it: source position to PDF rectangle, and PDF point to source line.

Preferred approach: parse the file in Rust and answer lookups from memory, reloading after each successful build. Before writing a parser, check whether a maintained Rust crate exists; if not, port the parsing logic from an existing permissively-licensed implementation (LaTeX Workshop's TypeScript parser is the usual reference) and keep its tests. Do not shell out to a `synctex` executable: Tectonic does not ship one.

## Editor integration

- One CodeMirror `EditorState` per open file, kept alive while its tab is open so undo history survives tab switches.
- Extensions: LaTeX language, diagnostics (from compile and from texlab), completion (texlab), search, and a change-highlighting extension that takes a list of hunks and renders deletions and insertions as decorations.
- Language server: use a CodeMirror LSP client that accepts a custom transport, and bridge it to `lsp_send` / `lsp://message`. Check for the official CodeMirror LSP client package before choosing a third-party one.
- The outline comes from texlab's document symbols, with a regular-expression fallback over sectioning commands while the server is starting.
- Saving: explicit save and save-on-compile. External changes reported by `project://changed` reload a file silently if the buffer is clean, and prompt if it is dirty.

## Preview integration

- Load the PDF from bytes returned by `pdf_read`, not from a file URL, to avoid file locking on Windows while the compiler rewrites it.
- Render pages lazily as they scroll into view. Re-render on zoom.
- After a recompile, swap the document and restore the scroll position by page and offset.
- Forward lookup scrolls to and briefly highlights the returned rectangle. A double-click (or modifier-click) on a page calls inverse lookup and moves the editor cursor.

## Frontend structure

```
src/
├── app/            shell, routing between Editor and History, top bar
├── design/         tokens.css, base.css, shared primitives (Button, IconButton, Module, Badge, Segmented)
├── features/
│   ├── files/      tree, outline
│   ├── editor/     CodeMirror setup, tabs, toolbar, change highlighting
│   ├── preview/    PDF.js viewer, toolbar, source lookup
│   ├── compile/    compile state, diagnostics, logs panel
│   ├── history/    version list, version diff view
│   ├── review/     conflict and merge panel
│   └── bundle/     export dialog, import flow
├── ipc/            generated command and event types, thin typed wrappers
└── state/          Zustand stores
```

Features do not import from one another's internals; shared pieces go in `design/` or `state/`.

## Security posture

- Tauri capabilities are restricted to the commands above. The webview has no general file-system or shell permission.
- Every path argument is resolved and checked to lie inside the project root (or, for bundle import and export, the path the user picked in a native dialog).
- Bundle extraction rejects entries with absolute paths, `..` segments, or symbolic links, and enforces a size ceiling.
- A received bundle is untrusted input. Importing it never runs anything from it; compiling its LaTeX is subject to the engine's own restrictions (Tectonic does not enable shell escape by default; keep it that way).

## Risks

| Risk | Mitigation |
|---|---|
| Tectonic cannot compile a user's document | Clear error, documented limits, pluggable engine with `latexmk` fallback later |
| SyncTeX parsing is fiddly | Port a proven parser with its tests; ship source↔PDF jump as its own milestone |
| Merge loses or mangles text | Reuse libgit2's merge; snapshot before every write; property tests on the review module; see `03-…` |
| texlab startup cost or crashes | Start lazily, restart on exit, never block editing on it |
| Webview differences across platforms | Windows (WebView2) is the reference; keep CSS to widely supported features |
