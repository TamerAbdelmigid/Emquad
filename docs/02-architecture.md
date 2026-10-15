# Architecture

## Stack

| Concern | Choice | Why this one |
|---|---|---|
| Desktop shell | **Tauri 2** (Rust backend, system webview) | Small installers, first-class support for bundling helper executables, Rust backend suits file and process work |
| UI | **React + TypeScript**, built with **Vite** | Largest ecosystem for the editor and PDF components |
| Package manager | **pnpm** | Fast, strict; one lockfile |
| Source editor | **CodeMirror 6** | The editor Overleaf itself uses; extensible enough for change highlighting and the later visual mode |
| LaTeX grammar | CodeMirror's `stex` stream mode (`@codemirror/legacy-modes`) | Syntax highlighting from a package maintained with CodeMirror itself |
| Compiler | **Tectonic**, shipped as a sidecar executable; a system `latexmk` as fallback | Tectonic is self-contained and downloads LaTeX packages on demand. When it is absent the app uses `latexmk` if one is on PATH |
| PDF rendering | **PDF.js** (`pdfjs-dist`) | Standard, renders to canvas with a text layer, lets us handle clicks for source lookup |
| Source ↔ PDF lookup | **SyncTeX** data produced by the compiler | The standard mechanism; see "SyncTeX" below |
| Completion and outline | Built in: a project index of labels and citation keys (Rust) and a completion source (TypeScript). With **texlab** present, completion, hover, definitions, references and rename come from it through `@codemirror/lsp-client` | The app works without the language server and gains from it when installed |
| Visual mode | CodeMirror decorations, with **KaTeX** for mathematics and PDF.js for PDF figures | Draws the plain source as a document without changing it; `visualModel.ts` decides what to draw and is tested on its own |
| Table editor | A pure grid model (`tableModel.ts`) with a CodeMirror widget over it (`tableEditor.ts`) | The `.tex` source is the only truth: the model reads a `tabular`, an action changes the grid, and the result is written back as one editor change. Reading refuses anything it could not write back exactly |
| Spell check | **nspell** with the Hunspell word lists for English (US and UK), French, Spanish, Dutch and Russian, each loaded when first chosen | Runs in the page with no network and no native code; `spellModel.ts` decides which words are prose and is tested on its own. Word lists that nspell takes too long to load (Portuguese, Polish) or that are offered only under the GPL (German, Italian) are left out |
| Comments | A Rust module over `.emquad/comments.json`; placement by quoted text in `commentAnchor.ts` | Keeps remarks out of source files, and lets them travel and merge in bundles |
| History storage | **libgit2** through the Rust `git2` crate | Versions, ancestry and the common-ancestor lookup; no system git required |
| Comparison and merge | The Rust `similar` crate, with a three-way pass in `diff.rs` | Review needs every hunk classified and individually rejectable, which a ready-made merge does not expose |
| Archive format | zip, through the Rust `zip` crate | A `.emquad` file is a zip; recipients can also open it with any unzip tool |
| File watching | Rust `notify` crate | Detect external edits to project files |
| UI state | **Zustand** | Small, no boilerplate, works well with CodeMirror's own state |
| Styling | Plain CSS with custom properties: `tokens.css`, `base.css` (ported from the mockup), `app.css` | The mockup's rules port directly; no runtime styling library |
| UI tests | **Vitest** + Testing Library | |
| Backend tests | `cargo test`, with `proptest` for the merge invariants | |
| Types across the boundary | `ts-rs`, generated into `src/ipc/bindings/` by `cargo test` | The two sides cannot drift |
| End-to-end | `scripts/e2e.js`, run inside the real window by a debug build | Drives compile, lookup, export, import and merge in the actual app |

Pin exact versions of every dependency and of the two sidecar binaries when scaffolding. The lockfiles record library versions; record the two sidecar versions in the repository README. Do not copy version numbers from memory; resolve the current stable release at the time of implementation.

### Licensing notes to respect

- **texlab** is GPL-3.0. It must remain a separate executable that the app starts and talks to over a pipe; do not link it into the app.
- **libgit2** is GPL-2.0 with a linking exception that permits linking from software under other licenses.
- **Pandoc** is GPL-2.0-or-later. It is never shipped or linked: the user installs it, and the app looks for it on the PATH and where its installer puts it (`%LOCALAPPDATA%\Pandoc`, `%ProgramFiles%\Pandoc`) and runs it as a separate program. **lopdf** and what it uses are MIT, Apache-2.0, BSD or Zlib.
- Tectonic, CodeMirror, PDF.js, Tauri, React, `git2`, `zip` and nspell are under permissive licenses. The word lists are under MIT, BSD and MPL terms; a word list offered only under the GPL is not shipped.
- LaTeX package files that a bundle carries keep their own licences, mostly the LaTeX Project Public License, which permits passing them on unchanged.
- No Overleaf source code is used. Overleaf is AGPL; the app only follows its layout conventions.

The app itself is under the MIT licence (`LICENSE`), chosen by the owner on 14 October 2026.

## Process model

```
┌──────────────────────────── Emquad (one desktop process) ────────────────────────────┐
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
my-paper/                    ← the user's folder; everything outside .emquad/ is theirs
├── main.tex
├── sections/…
├── figures/…
├── refs.bib
└── .emquad/
    ├── project.json         ← project id, main file, engine, format version
    ├── history.git/         ← a git directory whose work tree is the project folder
    ├── build/               ← compiler output: PDF, log, SyncTeX data, intermediates
    ├── incoming/            ← extracted bundles awaiting review
    └── state.json           ← open tabs, cursor, zoom; safe to delete
```

Rules:

- `history.git` is a bare repository. The app builds each version's tree from the folder's files itself and writes files back itself, without git's index or checkout, so file bytes are never converted and a user who keeps the project in their own git repository is unaffected. `.emquad/` and a top-level `.git/` are always excluded from the history.
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
| `bundle` | Write and read `.emquad` files; validate manifests |
| `review` | Build a review session from an imported bundle, apply decisions, finish or cancel a merge |
| `lsp` | Start texlab, forward JSON-RPC messages both ways |
| `settings` | App-wide and per-project settings |
| `zotero` | Ask Zotero's Better BibTeX add-on, on this computer only, for the references the user picks and their BibTeX |
| `pandoc` | Find Pandoc on this computer and run it: a document to `.docx`, a `.docx` to a new project |
| `pdfnotes` | Put notes on a copy of the compiled PDF (with `lopdf`): comments as highlights with what was said, changes since a version as highlights with what was there, where SyncTeX places their lines |

Each module exposes plain Rust functions that are unit-tested without Tauri. A thin `commands` layer wraps them as Tauri commands and maps errors to a single serialisable error type with a stable `code` and a user-readable `message`.

## Command surface

Names are indicative; keep the grouping. All paths in arguments are relative to the project root and are validated in Rust to stay inside it.

**Project**

| Command | Returns |
|---|---|
| `project_create(dir, template)` | project info |
| `project_open(dir)` | project info, file tree, restored UI state; refused, with the other window brought forward, when another window has the project open, or a folder inside or around it |
| `window_new()` | nothing; opens another window at the start screen |
| `file_read(path)` | text, or a marker that the file is binary |
| `file_write(path, text)` | — |
| `file_create(path, kind)` / `file_rename(from, to)` / `file_delete(path)` / `file_import(sourcePaths, destDir)` | updated tree |
| `project_index()` | labels, citation keys, and each reference's authors, year and title |
| `project_image(path)` | bytes of a picture in the project, for visual mode; the extension may be left out as in LaTeX |
| `picture_add(bytes)` with the headers `x-dir` and `x-name` | the project path a pasted picture was given; the bytes are the request's body |
| `picture_import(source, dir)` | the project path a picture dropped on the window was given |
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
| `history_keep_while_writing()` | whether a version was kept: after a save, when the latest version is ten minutes old or more and the files differ from it |
| `history_changed_files(version, against)` | paths with a status each |
| `history_file_diff(version, against, path)` | hunks with word-level detail (see `03-…`) |
| `history_restore(version)` | — (snapshots the working copy first) |

**Bundle and review**

| Command | Returns |
|---|---|
| `packages_info()` | whether the project's LaTeX packages can go in a bundle, and their size |
| `bundle_export(options)` | path written; with packages, only after an offline compile from them succeeds |
| `bundle_inspect(path)` | manifest summary, and whether it matches an existing project |
| `bundle_import(path)` | either a new project, or a review session id |
| `review_get(session)` | items: conflicts and automatic merges, with current decisions |
| `review_decide(session, itemId, decision)` | updated item |
| `review_finish(session)` | new merge version id |
| `review_cancel(session)` | — |

**Comments and spelling**

| Command | Returns |
|---|---|
| `comments_list()` | the project's comments, without deleted ones |
| `comment_add(path, anchor, text)` / `comment_reply(id, text)` / `comment_resolve(id, resolved)` / `comment_delete(id)` | the updated list |
| `comments_reanchor(moved)` | the updated list, after the editor reports where edited passages now are |
| `dictionary_add(word)` | settings, with the word added to the user's own dictionary |
| `dictionary_remove(word)` | settings, with the word taken out of the user's own dictionary |
| `project_set_spellcheck(language)` | project info, with the language this project is checked in ("" for the app's) |

**References**

| Command | Returns |
|---|---|
| `zotero_pick()` | the citation keys picked in Zotero and their BibTeX, or nothing when the picker was closed; `zotero_missing` when Zotero with Better BibTeX is not running |

The webview turns a reference into BibTeX (`bib.ts`) and adds it at the end of the project's `.bib` file, never changing an entry already there: with `file_write`, or, when the file is open in a tab, in its editor, which is then saved with whatever else was typed in it. Keys are compared without regard to case, as BibTeX compares them, and entries are read as BibTeX reads them, counting every brace. A `.bib` file with an entry that is never closed is not added to, since what came after would be read as part of it, and one the document names outside the project is never written. `citationStyle.ts` sets the citation style. Both are plain functions with tests.

**Word, and PDFs with notes**

| Command | Returns |
|---|---|
| `pandoc_available()` | whether Pandoc was found |
| `word_export(dest, bibliography)` | what Pandoc warned about; the `.docx` is written beside `dest` and put in place whole |
| `word_import(source, parentDir)` | the new project, opened; converted in a folder of its own and moved into place whole |
| `pdf_save_with_comments(dest)` / `pdf_save_with_changes(version, label, dest)` | how many notes were put on the copy at `dest` |

**LSP**

| Command | Returns |
|---|---|
| `lsp_send(message)` | — |
| event `lsp://message` | messages from texlab |

Payload types are generated from the Rust definitions with `ts-rs` into `src/ipc/bindings/`; `src/ipc/api.ts` holds the thin typed wrappers. The authoritative command list is the `handlers!` macro in `src-tauri/src/lib.rs`; the tables above describe its shape.

## Compile

```rust
trait Engine {
    fn name(&self) -> &str;
    fn compile(&self, project: &Project, on_log: impl Fn(&str)) -> Result<BuildOutput>;
}
```

- **`TectonicEngine`** (default) runs the sidecar against the main file with output directed to `.emquad/build/`, SyncTeX enabled, and logs kept.
- **`LatexmkEngine`** (later) is offered only when `latexmk` is found on the system, and runs it with SyncTeX, non-stop interaction and file-line-error output.

Behaviour:

- Only one compile runs at a time. A new request while one is running cancels it and starts again.
- Unsaved editor buffers are written to disk before compiling.
- On failure the previous PDF is kept and shown; `pdfPath` still points to it and `ok` is false.
- Diagnostics come from parsing the compiler's output. Keep the parser in its own unit with fixture logs as tests, because log formats are irregular.

Known limits of Tectonic to surface honestly in the UI when they bite: it is XeTeX-based, so documents relying on pdfTeX-only primitives may fail; `--shell-escape` workflows such as `minted` are restricted; its package set tracks a fixed TeX Live snapshot. The first compile of a document needs internet to fetch packages; after that they are cached.

## SyncTeX

The compiler writes a `.synctex.gz` file next to the PDF. The app needs two lookups from it: source position to PDF rectangle, and PDF point to source line.

`synctex.rs` parses the file in Rust and answers both lookups. It interprets only what those need: the input-file table and the box and position records per page. It is tested against a hand-written file and, in `tests/real_compile.rs`, against the output of a real compile. Do not shell out to a `synctex` executable: Tectonic does not ship one.

## Editor integration

- One CodeMirror `EditorState` per open file, kept alive while its tab is open so undo history survives tab switches.
- Extensions: LaTeX language, diagnostics (from compile and from texlab), completion (texlab), search, and a change-highlighting extension that takes a list of hunks and renders deletions and insertions as decorations.
- Completion comes from `latex.ts` (what is being typed) and the project index (labels, citation keys). When `texlab.exe` is in the sidecar folder, `lsp.rs` starts it for the open project and carries JSON messages to and from `@codemirror/lsp-client` through the `lsp_send` command and the `lsp://message` event; completion then comes from the server. Its hover text is sanitised before it is shown. `EMQUAD_LSP_TRACE=1` prints the conversation.
- The outline is a scan of sectioning commands in the open buffer.
- Spelling: `spellModel.ts` blanks out everything that is not prose and returns the remaining words; `spell.ts` checks the ones in view and underlines the unknown ones. The dictionary itself (`spellCore.ts`) runs in a Web Worker (`spellWorker.ts`), so building a large one never holds up the window; a word not yet judged counts as right until the worker answers. While typing, the underlines move with the text and the document is read for words again after a 400 ms pause. The dictionary is imported only when spelling is on; the language is the open project's own (`spellcheck` in `.emquad/project.json`) when it has one, the app's otherwise.
- Language server: `lsp.ts` gives the language client a workspace of its own (`ProjectWorkspace`), since the app shows one file at a time in one editor. When the server points into a file that is not shown, such as a definition elsewhere, the workspace opens that file's tab through the app and hands back the editor; a file outside the project is not opened.
- Project index: `index.rs` also lists the packages each style or class file of the project's own loads, which the package checks of the table tools and the symbol panel follow, and reads `.bib` files the document names outside the project for citation names (only `.bib` files, only those named, never written). A name that points at another computer or a device (`//host/share/…`, `\\host\share\…`, `\\?\…`, `\\.\…`) is never looked up: on Windows, looking one up can make the computer contact that host and offer it the user's credentials. `project.rs` finds pictures in the folders `\graphicspath` names, inside the project.
- Comments: `comments.ts` holds each comment's range in editor state and maps it through every edit; `commentAnchor.ts` finds a range from a comment's remembered words when a file is opened or reloaded. On save the editor reports the ranges that moved, and the backend records the new words.
- The table editor. `tableModel.ts` is pure and tested on its own: `parseTable` reads a `tabular` into a grid (alignments, vertical bars, a rule per horizontal boundary, cells with their spans) or gives the reason it cannot; the actions (`merge`, `splitMerged`, `splitIntoColumns`, `splitIntoRows`, `insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`, `setAlign`, `toggleBorders`, `setBorders`, `toggleEdge`, `toggleStyle`, `clearCells`, `pasteCells`) each return a new grid; `tableRemoval` and `ensurePackage` work out changes to the text around a table; `writeTable` writes it. `tableEditor.ts` is the widget: it holds no table of its own beyond what it last parsed from the source, turns each action into the smallest change to the document, and marks structural actions as undo steps of their own. Typing in a cell is committed on every keystroke, but only if what was typed reads back as that one cell. The same rule guards everything: `parseTable` accepts a table only if writing it and reading it again gives the identical grid, and the widget refuses any change whose result would not. A rule is stored as what is meant on a boundary; where a merged cell crosses it, the `\cline` pieces around the cell are worked out on writing. The widget handles its own keys and clicks; the editor around it ignores them. Its menus are put on the page itself, so the editor's scrolling never clips them. The app's toolbar reaches a table through `tableInput` in `tableEditor.ts`: when the keyboard leaves a table for the toolbar or a menu, the table it left (and the text selected in the cell being typed in) is remembered until the keyboard or the mouse goes anywhere else, and Bold, Italic and symbols act there.
- Symbols. `symbols.ts` is pure and tested: the catalogue, a search over it, `mathAt` (whether a place in a text is inside a formula, `\text{…}` and verbatim taken into account) and `insertion` (what to write for a symbol there). `SymbolPicker.tsx` is the panel; `buffers.insertInline` writes the result into the editor or the table cell in use, with any package it needs, as one undo step. The recently used symbols are a setting (`recentSymbols`), written through `settings_update`.
- Visual mode is drawn by a state field in `visual.ts` from `visualPieces`. Typing in plain text only moves what is drawn along with the text, and the document is drawn again after a 300 ms pause; a change that reaches anything drawn, or one that is not typing, is drawn at once. The cursor moving through plain text, touching nothing drawn, draws nothing again. Tables are read once per source text, and references are looked up by key. When the references or pictures change, only the file on screen is drawn again; the others when they are next shown. The environments that hold mathematics are listed once, in `mathEnvironments.ts`, for visual mode, spelling and the symbol panel.
- Compile errors: `errorHelp.ts` is pure and tested. `explain` turns a compiler message into plain words and, where it is certain, a fix as data (load a package, put a backslash before a character, go to a line); `findUnclosed` and `locate` place an error the compiler gave no line for. `actions.ts` applies a fix through the editor, so it is one undo step, and compiles again.
- Document setup: `documentSetup.ts` is pure and tested. `readSetup` reads the page settings from the main file's preamble; `setupChange` writes them back as class options, `geometry`, `setspace`, font packages, `parskip` and `\pagestyle`, removing only the lines it writes, and returns the smallest change.
- Files dropped on the window come as the window's drag-and-drop event, with their paths, since the webview is not given them. Adding files never replaces one: `file_import` refuses, copying nothing, when any name is taken or two of the files share one; `picture_add` and `picture_import` give a picture a name of its own (`plot-2.png`), keep the same picture once, write through a temporary file and put it in place only where no file is (`persist_noclobber`). Pictures are PNG, JPEG or PDF, at most 64 MB.
- Visual mode's tables, figures and citations are widgets that replace their source range. A table gives way to its source only when the cursor is put inside it (**Edit source**), not when the cursor passes its edge. A figure's bytes come from `project_image`; a PDF figure is drawn with PDF.js. Citations are named from the project index.
- Saving: explicit save and save-on-compile. External changes reported by `project://changed` reload a file silently if the buffer is clean, and prompt if it is dirty. `watch.rs` reports a burst of changes once it has settled (200 ms), leaving out the app's own saves (recorded by `file_write` with the file's size and time of change) and the temporary files a save passes through. Reading the project index again is asked for by saves and changes alike, and requests made while one runs collapse into one more.

## Preview integration

- Load the PDF from bytes returned by `pdf_read`, not from a file URL, to avoid file locking on Windows while the compiler rewrites it.
- `src/shared/pdf.ts` opens every PDF, for the preview and for PDF figures, with one shared pdf.js worker; pdf.js itself is loaded when the first PDF is opened. The preview keeps its pages across a recompile and draws each new page aside before copying it in, so nothing goes blank; a page well out of view gives back its picture's memory.
- The parsed SyncTeX of the last compile is kept in the window's session while its file is unchanged.
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

- Tauri capabilities are restricted to the commands above. The webview has no general file-system or shell permission. The capability applies to the first window (`main`) and to the windows the app opens for other projects (`w-*`), and to nothing else. Beyond `core:default` and `dialog:default` it grants `core:window:allow-destroy` alone: a window that is asked to close saves its unsaved changes first and then closes itself, which needs it.
- Each window has a session of its own (`Session` in `commands.rs`): its project, its compile and the lock that keeps compiles one at a time, its file watcher and its language server. Every command that acts on the open project takes the window that called it and works on that window's session; the events a session sends (compile log, file changes, the language server's messages) go to its window only, and each window listens only for its own. A window claims the folder of the project it opens in one step with the check that no other window has it, or a folder inside or around it (`AppState::claim`), so two windows opening one project at the same moment cannot both have it; a claimed project is not opened again, and the window that has it is brought forward. A window opening another project keeps its claim on the old one until the new one is open, and the folder of a project being created or imported from a bundle is claimed before anything is written to it. A window opens, creates or imports one project at a time. The watcher and language server of a project are put in place only once all of it has opened, so a failed open leaves the window as it was. A bundle for a project open in another window is handed to that window. A window that closes, or whose page loads again, ends its session: its compile is stopped, and its claim, watcher and language server go. A language server the app stops itself does not report that it has stopped, so the next project's server is not taken for it.
- The app opens one connection of its own: to Zotero's Better BibTeX add-on on `127.0.0.1:23119`, this computer's own address, and only when the user asks for a citation from Zotero. It never connects to another host, follows no redirect, and reads at most 16 MB of reply. Everything else that reaches the network is the compiler fetching LaTeX packages.
- Pandoc runs only when the user asks for a Word file, on the document's own files; a document that names a picture by a web address could have Pandoc fetch it, which is the one way it reaches the network. It is stopped after three minutes.
- Every path argument is resolved and checked to lie inside the project root (or, for bundle import and export, the path the user picked in a native dialog).
- Bundle extraction rejects entries with absolute paths, `..` segments, symbolic links, or names that fail the file-name rule in `03-bundles-and-history.md`, and enforces a size ceiling. Every version in a bundle's history is held to the same rule before any of it is accepted.
- A received bundle is untrusted input. Importing it never runs anything from it; compiling its LaTeX is subject to the engine's own restrictions (Tectonic does not enable shell escape by default; keep it that way).

## Risks

| Risk | Mitigation |
|---|---|
| Tectonic cannot compile a user's document | Clear error, documented limits, pluggable engine with `latexmk` fallback later |
| SyncTeX parsing is fiddly | Port a proven parser with its tests; ship source↔PDF jump as its own milestone |
| Merge loses or mangles text | Reuse libgit2's merge; snapshot before every write; property tests on the review module; see `03-…` |
| texlab startup cost or crashes | Start lazily, restart on exit, never block editing on it |
| Webview differences across platforms | Windows (WebView2) is the reference; keep CSS to widely supported features |
