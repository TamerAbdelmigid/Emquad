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
- **Toolbar.** Undo, redo, style (normal text, chapter where the class has chapters, Heading 1 to 3, run-in heading), bold, italic, insert table, insert symbol. Ctrl+B, Ctrl+I and Ctrl+U set bold, italic and underline, as in a word processor. Each inserts the corresponding LaTeX at the cursor, or, while a table in visual mode is being worked on, into that table: bold and italic on its selected cells, a symbol into the cell being typed in.
- **Symbols.** The symbol panel offers Greek letters, operators, relations, arrows, set and logic signs, calculus, accents and fonts, structures (fractions, roots, scripts, limits, growing brackets, matrices, cases), text symbols and special characters, found by kind or by searching for a name, a command or the character itself, with the ones used lately first. Each is shown as it will print. A symbol is written the way the place it goes needs: a command inside a formula, in `$…$` in text, a text symbol in `\mbox{…}` inside a formula, a structure around the selection. A package it needs (`amssymb`, `amsmath`) is added to the preamble, unless the document has it or one that provides it. The recently used list is kept in the app's settings.
- **Compile.** A Recompile button and a keyboard shortcut. Optional compile-on-save. Errors and warnings appear inline in the source and in a logs panel; the top bar shows compile state and error count. The commonest errors are explained in plain words, with a one-click fix where it is certain (load the package a command needs, escape a character typed in text, go to what was never closed); an error with no line is placed at what was never closed. Notes on how lines are set are kept apart from warnings.
- **PDF preview.** Page navigation, zoom, fit to width or height. The preview keeps its scroll position across recompiles.
- **Jump between source and PDF.** From the cursor to the matching place in the PDF, and from a click in the PDF to the matching source line.
- **Changes since last snapshot.** A mode in the editor that highlights what changed in the open file since a chosen snapshot, with each change revertible.

### History screen

- **Version list.** The working copy, every snapshot, and every imported bundle, newest first, each with author and description.
- **Version view.** Selecting a version shows the files it changed and, for the selected file, the source with that version's changes highlighted.
- **Snapshots.** Save a named snapshot at any time. Restore any snapshot. Compare any version with the working copy.
- **Versions kept automatically.** While the user writes, a version is kept after a save when the latest is ten minutes old or more, and before a file is deleted, so History has the work even when no snapshot was taken.
- **Bundle review.** Selecting an imported bundle shows a review panel: conflicts to resolve one by one (keep mine, keep theirs, or write the passage by hand), changes that merged automatically (each can still be rejected), and a Finish merge action that is enabled once every conflict is resolved.

### Bundles

- **Export.** Writes one `.emquad` file containing the sources, the history, optionally the compiled PDF, and a note to the recipient. Exporting records a snapshot.
- **Import.** Opening a `.emquad` file either creates a new project from it (if the user has no project with that identity) or brings it into the matching existing project for review.
- **Identity.** On first run the app asks for a display name. It is attached to snapshots and bundles so that changes can be attributed.

### Project lifecycle

- Create a project from a blank document or a built-in template: article, report, thesis (title page, abstract, contents, chapters and a bibliography), exam, letter. A project with no PDF is compiled as soon as it opens.
- Open an existing folder of LaTeX files as a project.
- A recent-projects list on start.

## Added after the first release

- **Visual mode.** The Code / Visual switch in the editor draws headings, emphasis, typeset mathematics, bulleted and numbered lists, tables, figures, citations, references (as the numbers the last compile gave them), footnotes, and the title, contents and bibliography in place, and folds the preamble into one line. The text underneath stays plain LaTeX, and whatever the cursor is in is shown as source. A project opens in visual mode until it is left in Code.
- **Pasting from elsewhere.** Text pasted from another program has the characters LaTeX treats specially written so that they print; text that is LaTeX already, or copied in Emquad, goes in as it is. Text pasted from Word, Google Docs or a web page keeps its bold, italic, underline, superscript and subscript, headings (as sections), bulleted and numbered lists (Word's own list paragraphs too) and links, written as LaTeX; colours, fonts and sizes are left behind. Ctrl+Shift+V pastes the words alone.
- **Pictures.** A picture dragged onto the text from elsewhere, or pasted on its own (a screenshot), is copied into the project, into `figures/` beside the main file or the folder `\graphicspath` names, and put in a figure there with a caption to type and a label; `graphicx` is loaded. PNG, JPEG and PDF are taken. A picture never replaces a file: one with a name already taken gets a name of its own, and the same picture twice is kept once. Other files dropped on the window are added to the project, and a bundle dropped on it is opened.
- **Equation editor.** Insert ▸ Equation… (Alt+=, as in Word) writes a formula with buttons for fractions, roots, powers, sums, integrals, limits, brackets, matrices and cases and for common symbols, shows how it will print as it is typed, and sets it in the line, on a line of its own, or numbered. Opened with the cursor in a formula, it changes that one.
- **Word count.** The status line counts the words of the file on screen, leaving out commands, mathematics and the preamble.
- **Document setup.** A dialog for the paper, the size of the text, margins, line spacing, typeface, page numbers and paragraph style, written as ordinary LaTeX in the main file's preamble.
- **References.** Insert ▸ Citation… finds a reference among the project's `.bib` files by an author, a word of its title or its year, and cites it where the cursor is, written the way the document's style reads best: `\cite`, natbib's `\citep` or biblatex's `\autocite`. A form adds a new reference, as Word's Add New Source does: it is written as a BibTeX entry at the end of the project's `.bib` file, with a key made from the first author and the year, and cited. Citation from Zotero… opens Zotero's own picker when Zotero runs on the same computer with the Better BibTeX add-on, adds the references chosen to the `.bib` file (any it has already are left as they are) and cites them. Citation style… sets numbered, IEEE, author and year (Harvard), APA or abbreviated labels by name.
- **Compiler choice.** Each project uses Automatic, Tectonic or `latexmk`; a compiler that is missing is refused with a message, not swapped.
- **Editing a conflict by hand** in review, as a third way to resolve it.
- **Search across the project.**
- **Themes.** Fieldwork, Glass and Onyx on the same layout.
- **texlab**, the LaTeX language server, when installed with the app: richer completion, hover, go to definition, find references, rename.
- **Fully offline bundles.** A bundle can carry the LaTeX packages the sender's computer holds, so the recipient compiles with no internet at all. The app checks this by compiling offline before it writes the bundle. The recipient's project keeps those packages to itself; they never affect another project.
- **Spell check.** Misspelled words in prose are underlined; commands, their technical arguments, mathematics, comments and the preamble are not checked. Right-click or Ctrl+. offers corrections and "add to my dictionary". Dictionaries for English (US and UK), French, Spanish, Dutch and Russian ship with the app, and a project can be checked in a language of its own; the words a user adds can be taken out again in Settings. Nothing is sent anywhere.
- **Windows.** Each window has one project open; File ▸ New window opens another, for another project. A project open in one window cannot be opened in a second, and nor can a folder inside it or around it. Closing a window, or opening another project in it, saves its unsaved changes first; if they cannot be saved, the user is asked.
- **Table editor.** In visual mode a plain `tabular` is edited where it is drawn, as in a word processor: type in cells; select cells by dragging, whole rows and columns by their handles and the table by its corner; merge and split; add rows and columns (also with the + between two of them) and delete them; align columns; set cells in bold or italic; choose a look for the borders (all, outside, inside, header lines, the `booktabs` book style, none) or draw a line on one edge of the selection; copy and paste cells, to and from spreadsheets too; delete the table; add a caption. The toolbar's table button inserts a table of a chosen size, and a table copied from Word or Excel can be pasted as one. Every action rewrites the LaTeX at once, as one undo step; nothing but LaTeX is stored. A table the editor could not write back exactly is drawn read-only and changed in its source.
- **Comments.** A remark on a selected passage, with replies, resolve and delete. Comments are kept beside the project, never inside its files, follow their passage as the text is edited, travel in bundles, and are combined with the recipient's without loss.

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
