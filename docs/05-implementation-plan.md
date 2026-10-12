# Implementation plan

Seven milestones, in order. Each ends in something a person can run and use, and each lists what must be true before moving on. Do not start a milestone until the previous one's acceptance criteria pass.

The order is chosen so that the riskiest unknowns (does the compiler work on this machine; can we map between source and PDF) are met early, and so that the data-critical work (history, bundles, merge) is built on a stable editor.

## Before starting

1. Initialise a git repository in the project root and make a first commit containing `mockup/`, `docs/`, `README.md` and `AGENTS.md`. All later work happens on branches, per `AGENTS.md`.
2. Install the prerequisites for Tauri 2 on Windows: the Rust toolchain (MSVC), the Microsoft C++ build tools, WebView2 (already present on Windows 11), Node.js and pnpm.
3. Read `02-architecture.md` and resolve current stable versions for every dependency and both sidecars. Record them.

## M0 — Scaffold and static shell

**Goal:** the app opens a window that looks like the mockup, with no behaviour.

- Scaffold Tauri 2 + React + TypeScript + Vite with pnpm.
- Set up formatting, linting and type-checking for both sides, Vitest, `cargo test`, and a single `pnpm verify` script that runs all of them (see `AGENTS.md`).
- Port the mockup's tokens to `src/design/tokens.css`. Bundle the three font families locally.
- Build the design primitives listed in `04-design-system.md`.
- Build the Editor and History screens as static React components with the mockup's sample content, including switching between them and the Export dialog opening and closing.
- Set the minimum window size.

**Accepted when**

- `pnpm verify` passes on a clean checkout.
- `pnpm tauri dev` opens the app; side by side with the mockup at 1440 × 800, the two screens match in layout, colour and type.
- The window does not scroll at any size at or above the minimum.
- The app makes no network requests (fonts are local).
- Every control is reachable by keyboard and shows a focus ring.

## M1 — Projects, files and the editor

**Goal:** open a folder, edit LaTeX files, save them.

- Rust `project` module: create from a blank template, open a folder, file tree, read, write, create, rename, move, delete, add from disk, watch for external changes. Path validation.
- `.emquad/project.json` and `.emquad/state.json`.
- File tree wired to real data, with context actions.
- CodeMirror 6 with the LaTeX grammar, the Fieldwork editor theme, line numbers, search, bracket matching, tabs with per-file undo history.
- Toolbar actions that insert LaTeX at the cursor.
- Outline from a regular-expression pass over sectioning commands.
- Start screen: recent projects, new project, open folder.

**Accepted when**

- A folder of `.tex` files can be opened, edited across several tabs, saved, closed and reopened with tabs and cursor restored.
- A file changed in another program reloads when its buffer is clean and prompts when it is dirty.
- No command accepts a path outside the project root (covered by tests).
- Unit tests cover the `project` module's file operations, including names with spaces and non-ASCII characters.

## M2 — Compile and preview

**Goal:** press Recompile, see the PDF.

- Ship the Tectonic sidecar; `Engine` trait and `TectonicEngine`.
- `compile_run` with cancellation, streamed log events, and output in `.emquad/build/`.
- Diagnostic parser with fixture logs.
- PDF.js viewer: lazy page rendering, zoom, fit modes, page navigation, scroll position kept across recompiles.
- Compile state in the top-bar readout; error markers in the editor gutter; a logs panel.
- Compile-on-save setting.

**Accepted when**

- On a machine with no TeX installation, a new project from the blank template compiles to a PDF.
- Introducing an undefined command shows an error on the right line, updates the error count, and leaves the previous PDF visible. Fixing it clears the error.
- Starting a compile during a compile cancels the first; the UI stays responsive throughout.
- After the packages for a document have been fetched once, it compiles with the network disconnected.
- The diagnostic parser's fixture tests pass, including multi-file projects where the error is in an included file.

## M3 — Jump between source and PDF

**Goal:** the two arrow keys work.

- Rust `synctex` module: load after each successful build, forward and inverse lookup.
- Jump to PDF scrolls to and highlights the location for the cursor.
- Double-click in the PDF moves the editor cursor to the source line, opening the file if needed.

**Accepted when**

- In a multi-file, multi-page test document, forward lookup from a line in an included file lands on the correct page and highlights the right paragraph; inverse lookup from that paragraph returns to the same file and within one line of the origin.
- Lookups before any successful build fail with a clear message rather than an error.
- The parser has unit tests against at least two real SyncTeX files checked into the repository as fixtures.

## M4 — Snapshots and History

**Goal:** save versions, look at them, go back.

- Rust `history` module on `git2`: initialise `history.git`, snapshot, list, changed files, file diff with word-level detail, restore. Line-ending conversion disabled.
- First-run prompt for the display name; author id generated and stored.
- History screen wired to real data for the working copy and snapshots: version list, files in version, diff view with highlighted changes.
- Save snapshot, Restore this version, Compare with working copy.
- The editor's "Showing changes since…" mode, with per-hunk revert.

**Accepted when**

- Snapshots persist across restarts and list in order with author and label.
- Restoring an older snapshot makes the working copy byte-identical to it, including removing files it did not contain, and a snapshot of the pre-restore state exists.
- Diffs are correct for added, deleted, renamed and binary files, and for files with CRLF line endings.
- A one-word edit inside a long single-line paragraph highlights only that word.
- A project that is also the user's own git repository is unaffected: their `.git` is untouched and `.emquad/` does not appear in the app's history.

## M5 — Bundles, review and merge

**Goal:** the full hand-off loop. This milestone implements `03-bundles-and-history.md` and is governed by its invariants.

- Rust `bundle` module: export and import with manifest validation and safe extraction.
- Export dialog wired up; atomic write.
- Import: new-project path and existing-project path; `.emquad` file association so double-clicking a bundle opens the app.
- Rust `review` module: classification, decisions, persisted session, finish, cancel.
- Review panel in History wired to real data; the conflict badge on the History buttons.
- Bundles and merges appear in the version list.

**Accepted when**

- Every invariant in `03-bundles-and-history.md` is covered by an automated test and passes, including the property-based merge tests, the round-trip tests and the hostile-input tests.
- Manual end-to-end check with two separate project folders standing in for two people: A exports; B imports as new, edits, exports; A edits the same and different passages, imports B's bundle, sees exactly the expected conflicts and automatic merges, resolves them, finishes; the result contains what was chosen and both histories.
- Cancelling the review at any step leaves A's working copy byte-identical to before the import.
- Closing the app mid-review and reopening returns to the same review with decisions intact.
- Importing a bundle from an unrelated project offers to open it as a new project and does not attempt a merge.

## M6 — Language intelligence and release

**Goal:** something that can be handed to a real user.

- texlab sidecar and the LSP bridge: completion for commands, environments, labels and citation keys; diagnostics; outline from document symbols with the regular-expression fallback.
- Project templates (article, report, exam, letter at minimum).
- Settings screen: display name, compile-on-save, editor font size, default zoom.
- Resizable and collapsible panels; layout remembered per project.
- Windows installer through Tauri's bundler, with the `.emquad` file association and both sidecars included.
- A short user guide.

**Accepted when**

- Typing `\ref{` offers the labels defined in the project; `\cite{` offers keys from the `.bib` file.
- If texlab fails to start or exits, editing and compiling continue and the app restarts it without user action.
- The installer, run on a clean Windows 11 machine with no developer tools, produces an app that passes the M2 and M5 manual checks.

## After version 1

In rough priority order; each is its own piece of work with its own spec.

1. **Visual mode** using CodeMirror decorations over the same plain-text source.
2. **Offline packages in bundles**: include the compiler's cached package files that the last build used, and seed the recipient's cache from them on import.
3. **`latexmk` engine** when available on the system.
4. **Edit by hand** as a third conflict resolution.
5. **Project-wide search**, spell check, comments.
6. **macOS and Linux builds.**
7. **Glass and Onyx themes**, as alternate token sets.

## Working agreements

- One milestone per branch or short series of branches; nothing merges to `main` without the owner's approval (see `AGENTS.md`).
- Write the Rust module and its tests first, then the command wrapper, then the UI.
- When a decision in these documents turns out to be wrong during implementation, change the document in the same branch as the code and say so in the summary. The documents must stay true.
