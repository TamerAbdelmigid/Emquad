# Changelog

Each completed change set gets one numbered, dated section here before it lands on `main`. There is no `Unreleased` section. The rule for choosing the number is in `AGENTS.md` under "Versions".

Versions 0.1.0 to 0.8.0 were numbered when this file was started, one for each change set that had landed; until then every file said 0.1.0.

## 0.9.0 - 2026-10-15

What someone coming from Word reaches for first.

- Ctrl+B, Ctrl+I and Ctrl+U set bold, italic and underline, in the text and in tables. The file panel moves to Ctrl+Shift+B. Format has Underline.
- A project opens in visual mode, and each project remembers whether it was left in Visual or Code. A newly opened file starts where the writing does, past the settings at the top.
- Visual mode now draws references as the numbers the PDF shows (after the first compile), footnotes as raised numbers whose text shows when pointed at, numbered lists with their numbers, and the title, table of contents, lists of figures and tables, page breaks and the bibliography as labelled blocks. The settings at the top are folded into one "Document settings" line, and lines that only begin or end a list are left out.
- The heading menu is now Style: Normal text, Chapter (in a report or thesis), Heading 1 to 3 and Run-in heading.
- Insert has Numbered list, Footnote, Table of contents, Page break and Bibliography. A project with no `.bib` file is given `references.bib`, with an example reference.
- A Thesis template: title page, abstract, acknowledgements, contents, chapters, margins and line spacing ready to change, and a bibliography.
- Text pasted from Word, a web page or an e-mail has `%`, `&`, `#`, `_`, `$` and the like written so that they print, and each paragraph kept as one (joined into one inside a command's braces, where a paragraph cannot end). LaTeX, text copied in Emquad, and anything pasted into an address, a label, a citation key or a code listing goes in as it is.
- A project never compiled is compiled as soon as it opens.
- The status line counts the words of the file on screen.
- While you write, a version is kept after a save at most every ten minutes, so History has your work even if you never take a snapshot.

## 0.8.2 - 2026-10-15

Deleting a file can be undone from History, and long documents stay quick to type in.

- Deleting a file or folder takes a snapshot first, as the confirmation always said, so History can bring it back.
- Typing and moving the cursor in visual mode no longer redraw the whole document: in a 5,000-line document with 50 tables, a keystroke went from about 50 ms to well under 1 ms. What is drawn catches up when typing pauses.
- Spelling no longer freezes the window: dictionaries load and words are checked in the background, and the document is read again only when typing pauses. A word taken out of your own dictionary is now really forgotten.
- The PDF preview no longer goes blank while a recompiled document is drawn, and uses far less memory on long documents.
- Long bibliographies are read about 90 times faster (a 3,000-entry `.bib` in 12 ms instead of 1.1 s), and saving no longer reads the project's files twice over.
- Visual mode typesets `alignat`, `flalign`, `eqnarray`, `gather` and the `math` environment.
- Typing in a long table cell, going between source and PDF, searching a project with pictures, and placing comments on open are quicker. The app starts lighter: the PDF viewer loads when first needed, and unused copies of the fonts (1.2 MB) are no longer installed.

## 0.8.1 - 2026-10-15

Emquad keeps a changelog and numbers each version.

- This file, with a section for every change set so far.
- The installer, and Windows' list of installed apps, carry the version: this one is `Emquad_0.8.1_x64-setup.exe`.

## 0.8.0 - 2026-10-15

A window for each project, more languages for spelling, and the items left open after 0.7.0.

- File ▸ New window (Ctrl+Shift+N) opens another window, for another project. A project open in one window cannot be opened in a second, and nor can a folder inside it or around it: the window that has it comes forward. A bundle for a project open in another window goes to that window.
- Opening another project, or closing a window, saves unsaved changes first. If they cannot be saved, the other project is not opened, and a window asks before it closes without them.
- Spelling in French, Spanish, Dutch and Russian as well as English (US and UK), chosen for the app and, if wanted, for each project. Words added to your own dictionary can be taken out again in Settings.
- Go to definition (F12) opens a file that is not open yet.
- A bundle with LaTeX packages carries only the package files its project reads, found by watching a compile, instead of every package on the computer.
- The project's own style and class files are read for the packages they load, `.bib` files named outside the project are read for their references, and pictures are found in the folders `\graphicspath` names.
- The heading menu has "Normal text", and Bold and Italic take the style away again when the text already has it.
- Tables: many more kinds can be edited (columns with a width, `@{…}` and `>{…}`, booktabs rules with their thickness, `\cmidrule`, `\addlinespace`, `\rowcolor`, comments between rows), and typing in a cell keeps a hand-made layout. Side lines can be drawn beside some rows only. A cell whose text is not complete stays open instead of being lost.
- The Caption tool works in the ordinary cases it used to decline, and takes a caption's label with it when nothing refers to the label.
- Symbols go inside the formula just before them, and the symbol panel can stay open.
- Licence: MIT.
- Fixes from four independent reviews, among them: a `.bib` file or main file named on another computer is never looked up; a failed import from a bundle never touches the folder you chose; a refused export leaves a file already at the destination as it was; a window that closes stops its compile.

## 0.7.0 - 2026-10-14

Tables and symbols that work the way a word processor does.

- Select cells by dragging with the mouse, a row or column by its handle, the whole table by its corner. Copy and paste cells, to and from Word and Excel.
- A tool bar over the table: alignment, merge and split, insert and delete rows and columns, borders (all, outer, inner, the book style, or one side), caption and source.
- Ω opens a symbol panel with search, categories and recently used symbols, drawn as they print.
- Bold, Italic and Ω on the main toolbar act on the table you are working in.

## 0.6.0 - 2026-10-13

A table editor in visual mode.

- A plain `tabular` is edited where it is drawn: type in cells, merge and split, add and remove rows and columns, align, draw borders and set the caption. A table copied from Word or Excel can be pasted as one.
- A table that could not be written back exactly as it was read is shown, but not edited.
- What you type in a cell is written so that it prints: `&`, `%`, `#` and `_` get their backslash in prose, and are left alone in mathematics and in the arguments of commands such as `\ref`.
- The Caption tool acts only where the document is certain to compile afterwards, and says why otherwise.

## 0.5.0 - 2026-10-12

LaTeX packages in bundles, spelling, comments, and more of visual mode.

- A bundle can carry the LaTeX packages its project compiles with, so the recipient can compile with no internet. Export first proves the project compiles from them alone.
- Spelling for English, in prose only.
- Comments on passages, kept in `.emquad/`, that follow their passage through edits, travel in bundles and merge without loss.
- Visual mode draws tables, figures and citations.

## 0.4.0 - 2026-10-12

Visual mode, texlab, themes and project search.

- Visual mode draws headings, emphasis, typeset mathematics and lists over the unchanged source.
- With texlab beside the app: completion that knows the packages in use, hover, go to definition, find references and rename.
- Glass and Onyx join Fieldwork as themes.
- The side panel searches the whole project.
- A conflict in a review can be settled by writing the passage by hand.
- Menus work from the keyboard.

## 0.3.0 - 2026-10-12

A compiler setting for each project, and one Emquad window.

- Settings offers Automatic, Tectonic or latexmk for the open project. A compiler chosen but missing is reported, not quietly replaced.
- Starting Emquad while it is open, including by double-clicking a bundle, brings the open window forward and hands it the file.

## 0.2.0 - 2026-10-12

Resizable panels, the user guide and the installer.

- Panels resize by dragging the gaps between them or with the arrow keys, remembered for each project.
- `docs/user-guide.md`, the guide for people using the app.
- A Windows installer that includes Tectonic and opens `.emquad` files in Emquad.

## 0.1.1 - 2026-10-12

- An error in an included file is shown against that file, not the main file, when compiling with Tectonic.

## 0.1.0 - 2026-10-12

The first version.

- Projects from templates, files, and an editor with completion of commands, environments, labels and citation keys.
- Compiling with errors shown in the text, the PDF beside it, and jumping between the source and the PDF.
- Settings: your name, compiling on save, and the editor's font size.
- Snapshots and History.
- Bundles: one `.emquad` file that carries a project's files and history, so the recipient can continue the work and the sender can review and merge what comes back, passage by passage.
