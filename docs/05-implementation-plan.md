# Implementation plan

Seven milestones, in order. Each ends in something a person can run and use, and each lists what must be true before moving on. Do not start a milestone until the previous one's acceptance criteria pass.

The order is chosen so that the riskiest unknowns (does the compiler work on this machine; can we map between source and PDF) are met early, and so that the data-critical work (history, bundles, merge) is built on a stable editor.

## Current state

| Milestone | State | What is still open |
|---|---|---|
| M0 Scaffold and shell | Done | The end-to-end run checks that every control is a real, focusable, named control. The keyboard pass (`scripts/keyboard.mjs`) uses the app with real key presses only: Tab reaches every part of the screen, menus, dialogs, the symbol panel, a table and History work from the keyboard, and closing a dialog or panel gives the keyboard back where it was |
| M1 Projects, files, editor | Done | |
| M2 Compile and preview | Done, verified with Tectonic 0.17.0 and with `latexmk` | Compiling with Tectonic's network access blocked works once a document's packages are cached. A machine with no TeX was simulated on 15 October 2026 by taking every TeX folder off the app's PATH and giving Tectonic an empty package cache: only the built-in compiler is found, the first compile fetched its packages and succeeded, source/PDF lookup works, and a project set to `latexmk` is refused with a message saying none was found. A truly clean computer has still not been tried |
| M3 Source and PDF lookup | Done | Verified on both pdfTeX and XeTeX (Tectonic) output |
| M4 Snapshots and History | Done | **Changes** in the editor toolbar opens History on the working copy with an undo on each change, rather than marking changes inside the editor |
| M5 Bundles, review, merge | Done | Starting the app with a bundle as its argument is verified in a release build. The Explorer double-click itself relies on the installer's file association |
| M6 Language intelligence and release | Done | Completion, templates, settings, resizable panels, the Windows installer with Tectonic and texlab inside, the user guide (`docs/user-guide.md`). texlab 5.26.0 adds completion that knows the packages in use, hover, go to definition (opening the file it is in), find references and rename |

Known limitations, none of which lose data:

- The table editor reads `tabular`, `tabular*`, `tabularx` and `longtable` tables with columns `l`, `c`, `r`, `p{…}`, `m{…}`, `b{…}` and `X`, with `>{…}`, `<{…}`, `@{…}` and `!{…}` around them; `\hline`, `\cline`, the booktabs rules with their thicknesses, `\cmidrule`, `\addlinespace`, `\rowcolor`, row gaps, comments between rows, `\verb`, and environments (a matrix, a table) inside cells. Anything else is drawn read-only and changed in its source: another column type (such as siunitx's `S`, or `*{3}{l}`), double vertical rules, `\hhline`, dashed rules, `\specialrule`, a longtable's head and foot, `\\*`, a comment or a blank line inside a cell, verbatim environments in a cell, and a rule drawn through a merged cell.
- Typing in cells, clearing them, pasting into them and setting them in bold or italic change only those cells' text, where it stands. Any change to the table's shape (rows, columns, merges, borders, alignment) writes the table out in the editor's own layout: one row to a line. Its cells, merges, rules and descriptions are kept; its spacing is not, nor spaces at the ends of a cell that TeX ignores.
- A horizontal rule that merged cells cross along its whole length comes back when they are split only in a table ruled between all its rows; otherwise it has to be drawn again.
- A cell written over several lines keeps its lines until it is typed in: the box shows it as one line, as TeX reads it, and writes it so.
- The Caption tool still refuses where it cannot be sure the document will compile, and says why: inside braces, brackets, mathematics, a minipage or a list; in a float that also holds a picture or a part with a caption of its own; where the float's label has more written after it; in a document whose body uses a command of its own that begins or ends an environment, or a macro with delimited arguments; where the preamble reads another file (other than `glyphtounicode`), redefines a float environment or changes `\catcode`; for a table not yet in a float, after a file read with `\input` or `\include`; and in a file with no preamble of its own. What a class or a style file defines is not read.
- Packages a table or a symbol needs (`multirow`, `booktabs`, `array`, `amssymb`, `amsmath`) are added to the preamble of the file being edited. When that file has none, or its preamble reads another file that may load them, the app says so and leaves it to the user.

- A bundle's LaTeX packages are the files compiling its project reads, found with the compiler. When that cannot be told, the whole store goes in, as before; the export dialog shows the largest it can be.
- Spelling covers English (US and UK), French, Spanish, Dutch and Russian, one language for the app and, if wanted, one for each project. German and Italian are not offered: their word lists are under the GPL only. Portuguese and Polish were tried and left out, because the spelling engine takes from 8 seconds to several minutes to load them. The first load of French pauses the editor for about three seconds.
- A comment whose words and the text either side of them were all rewritten outside the app is listed without a place in the text.
- Visual mode draws a table it cannot edit as a plain grid. Figures are PNG, JPEG, GIF, WebP and PDF, found as written or in the `\graphicspath` folders inside the project. Citation names come from `.bib` files in the project and from `.bib` files the document names elsewhere.

- A file in the user's folder whose name contains `~` followed by a digit (such as `chapter~1.tex`), or a folder named `.git` below the top level, is ignored by the app: it is not listed and not stored in versions. The rule behind this is in `03-bundles-and-history.md`.
- Each window has one project open. A project open in one window cannot be opened in a second, nor can a folder inside or around it; trying brings the first forward. Rename (F2) changes only the file on screen. Starting Emquad while it is open, including by double-clicking a bundle, brings the window used last forward and hands it the file.
- If one side turned a folder into a file of the same name while the other added files inside it, Finish merge fails and puts everything back each time, until a decision in the review is changed. The message does not yet say which decision.
- A bundle made on Linux that holds two folders differing only in capital letters is rejected on Windows with a message about its files not matching its history, rather than one that names the real cause.
- On macOS, file names with invisible Unicode characters have not been examined for the aliasing that the file-name rule guards against on Windows.

Evidence: `pnpm verify` (unit, property and real-compile tests), `scripts/e2e.js` (every feature and the full hand-off loop in the real window, with an accessibility check of each screen), and `scripts/smoke-release.js` (the packaged frontend, fonts, PDF viewer and bundled compiler in a release build).

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

Done since the first release: the table editor (with mouse selection, row and column handles, formatting, border styles and edges on part of the table, copy and paste of cells, and the wider range of tables listed above), the symbol panel, visual mode (with tables, figures and citations, and a toolbar that acts on what is written), the `latexmk` engine with a per-project setting, editing a conflict by hand, project-wide search, the Glass and Onyx themes, texlab (go to definition opens the file it is in), LaTeX packages inside bundles (only those the project reads), spell check in six languages with a language per project, comments, and a window per project.

### Versions for people coming from Word

Agreed with the owner on 15 October 2026, after a review of the app for speed and for people moving from Word to LaTeX. Each is one version, landed and pushed before the next begins.

| Version | What it brings |
|---|---|
| 0.8.2 | Deleting a file can be undone from History; typing, spelling, the preview and long bibliographies are fast in long documents |
| 0.9.0 | What a Word user reaches for first: Ctrl+B, Ctrl+I and Ctrl+U; visual mode on by default and remembered, drawing footnotes, references, the title and numbered lists; Chapter and the missing Insert entries; pasted text escaped; a compile as soon as a project opens; a word count; a Thesis template with a bibliography; automatic versions while writing |
| 0.10.0 | Compile errors explained in plain words, with one-click fixes where they are safe; a Document setup dialog for margins, font, line spacing, paper size and page numbers |
| 0.11.0 | References: picking citations from Zotero running on the same computer, a citation style chooser, a form to add a reference, and a dialog that finds a reference to cite |
| 0.12.0 | Pictures by drag and drop or paste; text pasted with its formatting from Word, Google Docs or a web page; an equation editor (Alt+=) |
| 0.13.0 | Working with people who use Word: send to Word and open a Word file (through Pandoc, a separate program the user installs), a PDF that marks the changes since a version, and a PDF with the comments |
| 0.14.0 | Asked for by the owner on 15 October 2026: an equation editor that edits complex formulas as they print, as Word's does; Word files read in Pandoc's sandbox and checked both ways with a real Pandoc |
| 0.15.0 | The page view, first of the steps approved by the owner on 19 October 2026 (`mockup/proposal-visual-word.html`): visual mode on a white page with the document's margins, under a ribbon with Word's Home, Insert and View tabs; drawing that stays put under the cursor, with Ctrl+/ to show a paragraph's LaTeX; Enter, Backspace and Delete as in a word processor; tooltips that say what each tool writes; the LaTeX path in the status line; the earlier visual mode kept as Draft |

The rest of that proposal, one version each, in this order (numbers as they fall):

- **Formats like Word:** strikethrough, sub- and superscript, small capitals, colour, highlight, clear formatting and the format painter, each drawn in visual mode; list buttons with Tab for levels and Enter on an empty item to end a list; alignment and line spacing; a wider styles gallery (quote, abstract); a small toolbar over a selection and a right-click menu; LaTeX marks.
- **Lays out like Word:** a Layout tab (margins, size, orientation, columns, breaks, line numbers); page breaks placed where the last compile broke the pages; a Picture tab for a picture's size and position; header and footer.
- **Refers like Word:** a cross-reference picker; links and bookmarks; References and Review tabs; comments as balloons beside the page; changes since a snapshot drawn on the page; moving a section by dragging its heading.
- **The bridge to LaTeX:** the page and its LaTeX side by side, linked both ways; blocks of LaTeX drawn from the compile; the preamble explained; commands of the user's own; KeyTips.

Still ahead, in rough priority order; each is its own piece of work with its own spec.

1. **Signing the installer** (see `docs/releasing.md`). The owner chose on 14 October 2026 to stay unsigned for now.
2. **macOS and Linux builds.** Left for later by the owner on 14 October 2026; they cannot be built or tried on the Windows development machine.

## Working agreements

- One milestone per branch or short series of branches; nothing merges to `main` without the owner's approval (see `AGENTS.md`).
- Write the Rust module and its tests first, then the command wrapper, then the UI.
- When a decision in these documents turns out to be wrong during implementation, change the document in the same branch as the code and say so in the summary. The documents must stay true.
