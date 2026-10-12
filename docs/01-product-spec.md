# Product spec

## Purpose

A desktop app for writing LaTeX that feels like Overleaf but runs entirely on the user's machine, with no account and no server. One person works on a project at a time. Collaboration happens by sending a single file to someone else, who opens it in the same app, continues the work, and sends a file back.

## Users

- A person writing papers, exams, reports or theses in LaTeX who wants Overleaf's convenience without depending on a network connection or a subscription.
- A collaborator who receives that person's work as one file and needs to continue or review it.

The first target platform is Windows 11. macOS and Linux should not be blocked by any design choice, but they are not release criteria for version 1.

## Principles

1. **Offline first.** Every feature works with no internet, except the first-time download of LaTeX packages that a document needs.
2. **No setup.** The user does not install TeX Live or MiKTeX. The app ships its own compiler.
3. **Plain files.** A project is an ordinary folder of `.tex`, `.bib` and image files. The app never writes markup, markers or metadata into the user's source files. Everything the app adds lives in a hidden `.emquad/` subfolder.
4. **Reuse over invention.** Editing, compiling, PDF rendering, language intelligence, history storage and merging all come from existing, maintained components (see `02-architecture.md`).
5. **Never lose work.** Any operation that overwrites source files (import, merge, restore) first records a snapshot that can be restored.

## Scope for version 1

### Editor screen

Layout follows Overleaf; see `04-design-system.md` and the mockup.

- **Project files.** Tree of files and folders: create, rename, delete, move, add from disk.
- **File outline.** Sections of the open file (`\section`, `\subsection`, …); clicking one moves the cursor there.
- **Source editor.** LaTeX syntax highlighting, line numbers, multiple open files as tabs, undo/redo, find and replace, bracket matching, auto-closing of environments, completion for commands, environments, labels and citation keys.
- **Toolbar.** Undo, redo, heading level, bold, italic, insert table, insert symbol. Each inserts the corresponding LaTeX at the cursor.
- **Compile.** A Recompile button and a keyboard shortcut. Optional compile-on-save. Errors and warnings appear inline in the source and in a logs panel; the top bar shows compile state and error count.
- **PDF preview.** Page navigation, zoom, fit to width or height. The preview keeps its scroll position across recompiles.
- **Jump between source and PDF.** From the cursor to the matching place in the PDF, and from a click in the PDF to the matching source line.
- **Changes since last snapshot.** A mode in the editor that highlights what changed in the open file since a chosen snapshot, with each change revertible.

### History screen

- **Version list.** The working copy, every snapshot, and every imported bundle, newest first, each with author and description.
- **Version view.** Selecting a version shows the files it changed and, for the selected file, the source with that version's changes highlighted.
- **Snapshots.** Save a named snapshot at any time. Restore any snapshot. Compare any version with the working copy.
- **Bundle review.** Selecting an imported bundle shows a review panel: conflicts to resolve one by one (keep mine or keep theirs), changes that merged automatically (each can still be rejected), and a Finish merge action that is enabled once every conflict is resolved.

### Bundles

- **Export.** Writes one `.emquad` file containing the sources, the history, optionally the compiled PDF, and a note to the recipient. Exporting records a snapshot.
- **Import.** Opening a `.emquad` file either creates a new project from it (if the user has no project with that identity) or brings it into the matching existing project for review.
- **Identity.** On first run the app asks for a display name. It is attached to snapshots and bundles so that changes can be attributed.

### Project lifecycle

- Create a project from a blank document or a built-in template.
- Open an existing folder of LaTeX files as a project.
- A recent-projects list on start.

## Planned after version 1

These are designed for but not reemquadd for the first release. `05-implementation-plan.md` places them in the last milestone.

- **Visual mode.** The Code / Visual switch in the editor. Renders headings, emphasis, math and figures inline while the underlying text stays plain LaTeX.
- **Fully offline bundles.** Including the LaTeX packages a document used inside the `.emquad` file, so the recipient can compile with no internet at all.
- **Alternative engine.** Use a system `latexmk` when one is installed, for documents that need pdfTeX-only features or `--shell-escape`.
- **Spell check, comments, search across the project.**
- **Other themes.** The mockup exploration produced two alternates (Glass, Onyx); the token structure in `04-design-system.md` allows them later.

## Out of scope

- Real-time collaboration, accounts, cloud storage, or any server component.
- A hosted or web version.
- Git or Dropbox integration exposed to the user. (History is stored with git internally; that is an implementation detail and is not surfaced.)
- Per-keystroke tracked changes with inline accept/reject while typing. Change tracking is always derived by comparing versions; see `03-bundles-and-history.md`.
- Editing the PDF.

## Core flows

### Write and compile

1. Open or create a project. The main file opens in the editor; the last PDF, if any, shows on the right.
2. Edit. Press Recompile (or save, with compile-on-save on).
3. The PDF updates in place. If compilation fails, the previous PDF stays visible, the top bar shows the error count, and the first error is marked in the source.

### Hand off

1. Press Export bundle. Confirm the file name, what to include, and an optional note.
2. The app records a snapshot and writes `name.emquad`.
3. Send the file by any means.

### Continue someone else's work

1. Open the received `.emquad` file. With no matching project on this machine, the app creates one from it and opens the editor.
2. Work normally. Export a bundle to send it back.

### Review what came back

1. Import the returned `.emquad` file while the matching project is open (or let the app find the project by its identity).
2. The app opens History with the bundle selected and the review panel showing.
3. Resolve each conflict. Optionally reject individual automatic merges.
4. Press Finish merge. The working copy now contains the merged result, and History shows a new merged version with both sides as its parents.
5. Cancelling at any point before Finish merge leaves the working copy untouched.

## Success criteria for version 1

- A user with no TeX installation can install the app, create a project from a template, and get a PDF.
- A project exported on one machine opens on another with identical sources and full history.
- Two people who both edit after a hand-off can merge without losing either person's changes, and every conflicting passage is shown to the user for a decision.
- Cancelling a review, or restoring the snapshot taken before a merge, returns the project to exactly its prior state.
