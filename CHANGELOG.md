# Changelog

Each completed change set gets one numbered, dated section here before it lands on `main`. There is no `Unreleased` section. The rule for choosing the number is in `AGENTS.md` under "Versions".

Versions 0.1.0 to 0.8.0 were numbered when this file was started, one for each change set that had landed; until then every file said 0.1.0.

## 0.17.0 - 2026-10-20

The page view lays out like Word.

- A **Layout** tab sets the page for the whole document: **Margins**, **Orientation** (portrait or landscape), **Size**, **Columns** (one or two), **Breaks** (page, page after the pictures, column), **Line numbers**, the **first line** of paragraphs (indented or space between) and the **text size**. Each is written in the settings at the top, as Document setup writes them, and the document is compiled to show it.
- The page view now breaks the document into pages where the last compile broke them, with a gap between the sheets named by the page it begins. A landscape page is drawn on its side.
- **Insert ▸ Header** and **Footer** put text at the top and foot of every page, written with fancyhdr; the page number stays at the foot. **Page number ▸ None** leaves the numbers out. The page view shows the header and footer on each page.
- Put the cursor in a figure and a **Picture** tab appears: make the picture half, most or all of the line wide, and choose its **Position**: where it fits best, here, at the top of a page, on a page of its own, or exactly here (which loads the float package). The tooltip says why LaTeX moves pictures. Position is on the Layout tab too, for tables.
- New lines added to the settings at the top now go after a package's own set-up lines (such as `\doublespacing` after setspace) rather than between them. A setting written in a way the app cannot change for certain is now refused with a message, rather than left as it was without a word.
- Fixed: compiling again while a compile was running could fail on Windows with "Access is denied", because the file being compiled could not be saved over.

## 0.16.0 - 2026-10-20

The page view formats like Word.

- The Home tab has Word's font tools: strikethrough, subscript (Ctrl+=), superscript (Ctrl+Shift+=), small capitals, highlight and font colour join bold, italic and underline, and each is drawn on the page as it will print. On a selection they work as in Word: if every word has the format it is taken off, otherwise all of them get it. The package each needs, and the name of each colour, is added to the settings at the top for you.
- **Clear formatting** takes every format off the selection, or the word the cursor is in. The **format painter** (Ctrl+Shift+C) copies the formatting at the cursor onto the next text you select.
- **Bullets** (Ctrl+Shift+L) and **Numbering** make paragraphs a list, and a list's items paragraphs again; the arrow beside Numbering chooses 1., a), i. or A. In a list, **Tab** and **Shift+Tab** move an item a level down or up, **Enter** on an empty item ends the list, and **Backspace** at the start of an item turns it into a paragraph (it used to join it to the item above).
- **Align left**, **Centre** (Ctrl+E), **Align right** and **Justify**, and **Line spacing** for the whole document. The styles gallery adds **Quote** and **Abstract**. Centred and quoted paragraphs and the abstract are drawn as they print.
- A small toolbar appears over words you select with the mouse, and a right-click (or Shift+F10) opens a menu with cut, copy, paste, paste words only, a new comment and Show LaTeX.
- **LaTeX marks** (Ctrl+Shift+8), like Word's ¶, show the commands faintly around formatted text and the names of lists and other blocks in the margin, while you keep working on the page.
- Fixed: a heading or other styled line just after a list was drawn without its style in the page view.

## 0.15.1 - 2026-10-19

Nothing changes for users: the checks run before a merge no longer count other working copies of the project kept inside it, and the timing test for typing in a long table cell no longer fails on a busy computer.

## 0.15.0 - 2026-10-19

Visual mode looks and types like Word: the page view.

- Visual mode now shows your document on a white page, with the paper, margins, size of type and line spacing your document sets, under a ribbon with Word's Home, Insert and View tabs. Zoom it from the View tab or the status line.
- Moving the cursor through the page no longer turns what it touches into LaTeX: bold stays bold, a formula stays a formula. To see or change the LaTeX of a paragraph, press **Ctrl+/** (or View ▸ Show LaTeX); Ctrl+/ again, Esc, or moving away draws it again. Going to a line, an error or a search result inside something drawn still shows it as LaTeX.
- Typing works as in a word processor: Enter starts a new paragraph, or the next item in a list, or goes on below a heading; Backspace and Delete remove the letter you see, never a hidden brace, and taking the last letter of a bold word takes the bold with it.
- Every ribbon tool's tooltip names its shortcut and the LaTeX it writes, so you learn LaTeX as you use it. The styles gallery shows and sets the heading the cursor is in.
- The status line says where the cursor is in LaTeX's terms, such as `\section{Method} › itemize › \item › \textbf`.
- The earlier visual mode is still there as View ▸ Draft, for those who prefer the LaTeX to show under the cursor.

## 0.14.0 - 2026-10-15

An equation editor like Word's.

- The equation editor (Insert ▸ Equation…, Alt+=) now shows the formula as it prints while you type, and you type it as in Word: `/` makes a fraction, `^` a power, `_` an index, names such as `alpha`, `sqrt`, `sum` or `infty` become what they name, and Tab moves between boxes.
- A ribbon like Word's Equation tab: fractions, scripts, radicals, integrals, large operators, brackets and cases, functions, accents, limits, operators and matrices, each written around what you selected, and a row of symbols by kind.
- New line (Shift+Enter) sets a formula over several lines, lined up at `=`.
- A double-click on a formula in visual mode opens the editor on it. A single click on a drawn formula leaves it drawn; the arrow keys, or a click beside it, still show its LaTeX.
- The packages a formula needs (amsmath, amssymb, mathtools) are added to the settings at the top for you.
- A Word file you open is read in Pandoc's sandbox, so it cannot make Pandoc read or fetch anything else.

## 0.13.1 - 2026-10-15

Nothing changes for users: the check run on a release build before an installer is made now expects a project to open in visual mode, as it has since 0.9.0.

## 0.13.0 - 2026-10-15

Working with people who use Word.

- File ▸ Send to Word… saves the document as a Word file, with its pictures and references. File ▸ Open a Word file… makes a new project from a Word file and opens it. Both use Pandoc, a free program installed separately from pandoc.org; Emquad finds it by itself, and says where to get it when it is missing.
- File ▸ Save PDF with comments… saves a copy of the PDF with each open comment on it, on its passage and with its replies, as any PDF viewer shows comments.
- History has PDF with changes since this version…: a copy of the PDF with what was written or changed since the chosen version highlighted, each mark saying what was there before, and a marker where text was taken out.
- A `%` just after `\\` is read as the start of a comment, as LaTeX reads it, when the equation editor looks for a formula, and a second paragraph of a list item pasted from a web page stays in its item.

## 0.12.0 - 2026-10-15

Pictures, formatting and equations, the way Word has them.

- Drag a picture from File Explorer onto the text, or paste one such as a screenshot: it is copied into the project's `figures` folder (or the folder `\graphicspath` names) and put in a figure where it was dropped, with the cursor in its caption. PNG, JPEG and PDF work, and `graphicx` is loaded if the document did not load it.
- A picture never replaces a file: one whose name is taken gets a name of its own, such as `plot-2.png`, and the same picture added twice is kept once.
- Other files dropped on the window are added to the project, and a bundle dropped on it is opened.
- Text pasted from Word, Google Docs or a web page keeps its bold, italic, underline, superscripts and subscripts, headings, bulleted and numbered lists and links, written as LaTeX. Ctrl+Shift+V pastes the words alone.
- Insert ▸ Equation… (Alt+=) opens an equation editor: buttons for fractions, roots, powers, sums, integrals, matrices, cases and common symbols, a preview of the formula as it will print, and a choice of in the line, on a line of its own, or numbered. With the cursor in a formula it changes that one.
- File ▸ Add files from disk no longer replaces a file of the project with the same name: it says which names are taken and copies nothing.

## 0.11.0 - 2026-10-15

References and citations, as Word's References tab has them.

- Insert ▸ Citation… opens a list of the project's references, found by an author, a word of the title or the year. Tick one or several and press Cite.
- Add a reference… is a form for a new reference: kind, authors, title, year, where it was published, pages, DOI and web address. Emquad writes it at the end of the project's `.bib` file, with a key such as `lovelace1843`, and cites it.
- Insert ▸ Citation from Zotero… opens Zotero's quick search when Zotero runs on this computer with the Better BibTeX add-on, adds the references chosen to the `.bib` file and cites them. It is the only connection Emquad makes itself, and only to your own computer.
- Insert ▸ Citation style… sets numbered, IEEE, author and year (Harvard), APA or abbreviated labels, adding the package an author-and-year style needs.
- With an author-and-year style a new citation is written to print in parentheses, as (Knuth, 1984).
- The choices in dialogs (Document setup, Settings, and the new ones) now look like the other fields, in every theme.
- A line Emquad adds to a file that is open in a tab but not on screen, such as `\addbibresource` from Insert ▸ Bibliography, now marks that tab as changed, so it is saved with the rest.

## 0.10.0 - 2026-10-15

Compile errors you can understand, and a page setup.

- Compile errors are explained in plain words, under LaTeX's own message, in the editor and in Logs and messages. Where the fix is certain there is a button for it: add the package a command or environment needs, write a stray `&`, `#` or `_` so that it prints, or go to the `{` or `\begin` that was never closed. Emquad compiles again after a fix.
- An error LaTeX reports at the end of the file, such as an unclosed brace, is marked where the brace was opened.
- Notes on how a line is set (a little too wide or too loose) are folded away in the logs and no longer counted as warnings.
- File ▸ Document setup sets the paper, the size of the text, margins, line spacing, typeface, page numbers and paragraph style, writing the ordinary LaTeX for each at the top of the main file.

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
