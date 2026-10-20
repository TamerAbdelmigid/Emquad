# Emquad user guide

Emquad is a LaTeX editor that works without an internet connection or a TeX installation. You write on the left and see the typeset PDF on the right.

## Getting started

1. Start Emquad. The first time, it asks for your name. The name is attached to the snapshots and bundles you make so a collaborator can tell whose changes are whose.
2. Choose **New project**, give it a name, pick a starting document (article, report, thesis, exam or letter), and choose where to create it. A project is an ordinary folder; you can also use **Open folder** on any folder of `.tex` files you already have. The **Thesis** document has a title page, an abstract, a table of contents, chapters, a bibliography in `references.bib`, and the margins and line spacing at the top, ready to change.
3. Emquad compiles the new project straight away and the PDF appears on the right. After that, press **Recompile** (or Ctrl+Enter) whenever you want to see your changes.

The first time a document is compiled, Emquad downloads the LaTeX packages it uses. That needs internet once; after that the document compiles offline.

## The editor screen

| Area | What it is for |
|---|---|
| Top bar | Menus, the project name with compile state and error count, and the History, Layout, Import and Export bundle buttons |
| Left rail | The file panel, search across the project, History, keyboard shortcuts, settings |
| File tree | Your files. The buttons at its top create a file, create a folder, or add files from disk. The "···" on each row renames, deletes, or sets the main file |
| File outline | The sections of the open file. Click one to go there |
| Source | Where you type. Tabs along the top; in Visual, a ribbon like Word's, and in Code a toolbar for undo, headings, bold, italic, tables, symbols and find; the Code / Visual switch |
| PDF | The typeset result, with page and zoom controls |

Drag the gaps between the file panel, the source and the PDF to resize them. **Layout** switches between source and PDF together, source only, and PDF only.

### Code and Visual

**Visual** draws your source as a document: section titles as headings, bold and italic as themselves, mathematics typeset, list items as bullets or numbers, tables as tables, `\includegraphics` as the picture itself, citations by author and year (taken from your `.bib` files; a key nobody defines is shown with a question mark), references such as `\ref{fig:plot}` as the number the PDF shows (after the first compile; `?` until then), footnotes as a raised number whose text shows when you point at it, and the title, table of contents and bibliography as labelled blocks. The settings at the top of the file (the class, the packages, the title) are folded into one **Document settings** line; click it to see and change them. A project opens in Visual until you leave it in Code. Nothing in the file changes; switch back to **Code** at any time. A formula Emquad cannot preview is shown as its source with a dotted underline; it may still compile. Pictures are also found in the folders named by `\graphicspath`, and citation names also come from a `.bib` file the document names outside the project, such as `\bibliography{../shared}`.

**The toolbar acts on what is written**, in either mode. The heading menu (Tт) changes the level of the heading the cursor is in, and **Normal text** makes it ordinary text again; on a line with no heading it starts one. **B** and *I* (and Format ▸ Monospace and Emphasis) set the selection in that style, or, when it is in it already, take it out; with nothing selected, they take the group the cursor is in out of the style, or start an empty one to type in.

### The page view

Visual mode sets your document on a white page, as Word does, with the paper, margins, size of type and line spacing that **Document setup** gives it. (It is a likeness: where lines break in the PDF is up to the compiler.) After each compile the page is broken into pages where the PDF breaks them, with a gap between the sheets. Above it is a ribbon with Word's tabs: **Home** (undo, the clipboard and format painter, the font and paragraph tools, the styles gallery, find, comment), **Insert** (page break, contents, table, figure, cross-reference, header and footer, footnote, symbol, equation, citation and bibliography), **Layout** (margins, orientation, size, columns, breaks, line numbers, the first line of paragraphs, text size, position) and **View** (Page or Draft, zoom, Show LaTeX, LaTeX marks, page setup). Point at any tool to see its shortcut and the LaTeX it writes.

What is drawn stays drawn while you work in it. Click into bold text and type: it is still bold. The arrow keys move over a formula or a citation in one step, and Backspace and Delete take the letter you see, never a hidden brace; taking the last letter of a bold word takes the bold with it. Text you copy keeps its formatting whole, and selecting everything and typing keeps the document's settings. Enter starts a new paragraph (in LaTeX, a blank line), the next item in a list, or a new line below a heading.

#### Formatting

The **Font** group works as Word's: select words and press **Bold**, **Italic**, **Underline**, **Strikethrough**, **Subscript** (Ctrl+=), **Superscript** (Ctrl+Shift+=), **Small capitals**, **Emphasis**, **Typewriter** or **Highlight**, or choose a **Font colour**. If every word you selected has that format already it is taken off; otherwise all of them get it. **Clear formatting** takes every format off the selection, or off the word the cursor is in, and leaves the words. Each format is a LaTeX command around the words, such as `\sout{…}` or `\textcolor{royalblue}{…}`; the package it needs (ulem, soul, xcolor) is added to the settings at the top for you, and each colour is named there once, so every blue in the document is the same blue.

The **Format painter** (Ctrl+Shift+C) copies the formatting where the cursor is. Then select other text, with the mouse or with Shift and the arrow keys, and it gets the same formatting. Esc puts the painter down.

Select words with the mouse and a **small toolbar** appears over them, with bold, italic, underline, highlight, colour, clear formatting, comment and Show LaTeX. **Right-click** (or Shift+F10) for cut, copy, paste, **paste words only**, a new comment and Show LaTeX.

#### Lists and paragraphs

**Bullets** (Ctrl+Shift+L) and **Numbering** make the paragraph you are in, or the paragraphs you selected, a list; press them again in the list to make its items ordinary paragraphs. The arrow beside Numbering chooses 1. 2. 3., a) b) c), i. ii. iii. or A. B. C. In a list item, **Tab** moves the item one level down and **Shift+Tab** one level up (or use **Increase indent** and **Decrease indent**). **Enter** on an empty item ends the list, and **Backspace** at the start of an item turns it into an ordinary paragraph.

**Align left**, **Centre** (Ctrl+E) and **Align right** set the paragraph in `flushleft`, `center` or `flushright`; **Justify**, LaTeX's usual setting, takes that away. **Line spacing** sets single, 1.5 or double spacing for the whole document. In the styles gallery, **Quote** sets the paragraph as a quotation, indented on both sides, and **Abstract** as the paper's abstract; **Normal** makes it an ordinary paragraph again.

**LaTeX marks** (Ctrl+Shift+8, on Home and View), like Word's ¶ button, show the commands faintly where they stand, such as `\textbf{` before bold words, and the names of lists, quotations and the like in the left margin. You keep working on the page as usual; press it again to hide them.

#### Layout, pages, header and footer

The **Layout** tab sets the page for the whole document, in the settings at the top of the main file, and compiles to show it: **Margins** (Normal, Narrow, Moderate, Wide, or LaTeX's own; **Custom margins…** opens Document setup), **Orientation** (portrait or landscape), **Size** (A4, Letter and others), **Columns** (one or two), **Breaks** (a page break, a page break after the pictures still waiting, or in two columns a column break), **Line numbers** (what journals ask for in a draft sent for review), whether a paragraph's **first line** is indented or paragraphs have space between them, and the **text size**.

Where the PDF breaks a page, the page view shows a gap between two sheets, named by the page it begins. LaTeX decides where a page ends; after you change the text, **Recompile** to see the pages break anew.

**Insert ▸ Header** and **Footer** ask for the text printed at the top right, or in the middle of the foot, of every page; the page view shows it at the top and foot of each page. The page number stays at the foot, beside the footer's text; **Page number ▸ None** leaves the numbers out. Clear the text to take the header or footer away.

#### Pictures

Put the cursor in a figure and a **Picture** tab appears. **Half width**, **Most of it** and **Full width** make the picture that share of the line, so it stays right if the margins change. **Position** asks LaTeX where to put the figure: where it fits best, here if it fits, at the top of a page, on a page of its own, or exactly here. LaTeX moves pictures and tables to where they fit best, so that no page is left half empty, which is why the text refers to them by number ("see Figure 2") rather than "below"; *Exactly here* keeps it where it is written, even if that leaves a gap, and loads the `float` package for you. The same **Position** menu is on the Layout tab, for a table too.

To see or change the LaTeX of a paragraph, press **Ctrl+/** (or View ▸ Show LaTeX). Press it again, or Esc, or move to another paragraph, and it is drawn again. Going to a line, an error or a search result that is inside something drawn shows it as LaTeX too.

The status line at the bottom says where the cursor is in LaTeX's terms, such as `\section{Method} › itemize › \item › \textbf`, and holds the zoom.

**View ▸ Draft** is the earlier visual mode, on the dark source screen, where whatever the cursor is in shows as its LaTeX. Emquad remembers your choice, and the zoom, for each project.

### Tables

**Insert.** The table button in the toolbar opens a small grid. Move over it (or use the arrow keys) to choose rows and columns, then click (or press Enter). Emquad writes the matching `tabular`.

**Edit.** In **Visual** mode, click a cell and type. What you type is LaTeX, so `$x^2$` and `\textbf{…}` work; a plain `&`, `%` or `#` that you type is written as `\&`, `\%` or `\#` for you, and so is an `_` typed in ordinary text. In mathematics (`$…$`), and inside the argument of a command such as `\ref{…}`, `\cite{…}`, `\si{…}` or `\includegraphics{…}`, they are left as typed, and so is everything in `\verb|…|` and every character but `%` in a web address (`\url{…}`, the first argument of `\href`). Deleting such a character takes its backslash with it. A `[` typed at the start of a row's first cell gets `{}` in front of it, since LaTeX would otherwise take `[1]` as a setting of the line before. A cell that could not compile as it stands (an unclosed `$`, a `^` outside mathematics, or a line break `\\` anywhere but inside `\makecell{…}` and the like) is held back, marked, until it can; write a dollar sign as `\$`. Only what you type is treated this way; LaTeX already in the cell is never rewritten. Tab and Shift+Tab move between cells, and Tab in the last cell adds a row. The arrow keys move to the next cell when the cursor is at the edge of the text. Esc stops typing and leaves the cell selected.

**Select cells** as in a word processor:

- drag across cells, or Shift-click a second cell. A drag that starts in the text of a cell selects letters until it goes on into another cell, and then selects cells;
- point just above a column or just left of a row to see its handle: click it to select the whole column or row, drag along the handles to select several, or Shift-click to extend;
- the small square at the top left corner selects the whole table, and so does Ctrl+A once cells are selected;
- with the keyboard, Shift and the arrow keys.

A **+** appears on the line between two rows or columns when you point at their handle; click it to insert one there.

**Without a mouse.** Esc leaves the text; Tab then reaches the table. Enter (or an arrow key) selects its first cell, the arrow keys move between cells, and Enter starts typing in the selected one.

**The tools** are in the bar above the table, shown while the pointer or the keyboard is in it, and on its right-click menu (Shift+F10 from the keyboard; Esc then Tab reaches the bar, and the arrow keys move along it). In a narrow pane the bar shows its icons only; every one has a tooltip.

| Tool | What it does |
|---|---|
| **B**, *I* | Sets the selected cells in bold (`\textbf`) or italic (`\textit`), or takes them out of it when they all are. While you type in a cell, they act on the selected text instead |
| Align left, centre, right | Align the selected columns. The one that is lit shows the column's alignment |
| Insert ▾ | A row above or below, a column to the left or right |
| Delete ▾ | The selected rows or columns, the text of the selected cells (also Del), or the whole table. A table alone in a `table` float with its caption and label takes the float with it |
| Merge | Makes one cell of the selected cells. Across a row this is `\multicolumn`, down a column `\multirow`, a block both. Text in the cells is joined, never dropped |
| Split ▾ | **Unmerge cells** gives a merged cell its separate cells back, the text staying in the first. **Split into two columns** or **two rows** divides an ordinary cell; the other cells in its column or row are widened so that only this cell looks divided |
| Borders ▾ | A look for the whole table: all borders, the outside only, the inside lines only, lines above, below and under the first row, the book style of the `booktabs` package, or none. Below them, a line on one edge of the selected cells: above, below, left or right. Ticks show what is drawn now. A line above or below runs under the selected columns only (`\cline`); a line beside the cells runs the whole height of the table, because that is all LaTeX allows |
| Caption | Adds, changes or (left empty) removes the caption. See below for where it works |
| Source | Shows the table's LaTeX so you can change it directly. Move the cursor out of it to see the table again |

The right-click menu also has **Cut** and **Copy**, and **Select row**, **Select column** and **Select table**.

**Copy and paste cells.** Ctrl+C copies the selected cells: Emquad pastes them back exactly as they were written, and Word or Excel receive them as a table. Ctrl+V pastes cells from the selected one on, as a spreadsheet does, adding rows and columns at the end if they are needed; text from Word or Excel has its special characters escaped. Cells cannot be pasted over a merged cell. Ctrl+X copies the cells and empties them.

**Bold, Italic and Ω from the main toolbar** act on the table you were working in: on the selected cells, or on the cell you were typing in.

**Where Caption works.** A caption in the wrong place stops a document compiling, so the tool acts where it can be sure, and otherwise tells you why and changes nothing:

- a table that is a paragraph of its own (a blank line before and after) in the body of an ordinary document such as an `article`, `report` or `book`, also when it is inside a `center` that holds only it (which goes into the float with it), or follows a `\centering`, `\noindent` or size line such as `\small`: it is put in a `table` environment, centred and at that size, with the caption under it. Lines like these before it stay where they are, since they also set the text that follows;
- a table in a `table`, `table*`, `figure` or `subtable` environment, alone there: the caption goes at the end of the float, after any note or space under the table and before the float's `\label`; or the float's own caption is changed. Removing a caption also removes its `\label` when nothing in the document refers to it; when something does, or the document reads other files that might, the caption is left and you are told which reference.

It leaves the caption to you, in the source, for a table inside anything else (a `minipage`, `\resizebox{…}`, mathematics, a list), in a float that also holds a picture, where the float's label has more written after it, in a file that another file includes, after a file read with `\input` or `\include` (for a table not yet in a float), in a document that uses a command of its own that begins or ends an environment, or whose preamble reads another file, redefines a float environment or changes what characters mean. A longtable writes its caption as its own first row, so the tool leaves it to the source.

Every action changes your `.tex` file at once, and **Code** shows exactly what was written. Each action is one step for Undo (Ctrl+Z).

**Merging down a column needs the `multirow` package**, the book style of borders the `booktabs` package, and aligning a column with a width the `array` package. The first time you need one, Emquad adds its `\usepackage` line just before `\begin{document}` and tells you. The same happens when you paste a table from Word or Excel that has cells merged downwards. If the file you are in has no preamble, because it is included from another file, add that line to your main file yourself; Emquad reminds you.

**Paste from Word or Excel.** Copy a table there and paste it into the editor. Emquad asks whether to paste it as a table; merged cells are kept and characters LaTeX treats specially are escaped. Cancel pastes the plain text.

**Which tables can be edited.** `tabular`, `tabular*`, `tabularx` and `longtable`, with columns `l`, `c`, `r`, `p{…}`, `m{…}`, `b{…}` and `X` (and `>{…}`, `<{…}`, `@{…}` around them); `\hline`, `\cline`, the booktabs rules with their thicknesses, `\cmidrule`, `\addlinespace`, `\rowcolor`, a space set after a row (`\\[2pt]`), comments between rows, `\verb`, and a matrix or even another table inside a cell. Aligning a column with a width writes `>{\centering\arraybackslash}` and the like before it.

**Tables Emquad shows but does not edit.** A table that uses something the editor cannot write back exactly is drawn with a note saying why and an **Edit source** link. Examples: a column type such as siunitx's `S`, `*{3}{l}`, double vertical lines, `\hhline`, dashed rules, a longtable's head and foot, a comment inside a cell, or a rule drawn straight through a merged cell. Emquad never rewrites such a table. Before accepting any table it checks that writing it out and reading it again gives the same table, and it makes the same check before every change.

**Your layout is kept while you type.** Typing in a cell, clearing cells, pasting into them and setting them in bold change only those cells' text, where it stands. A change to the table's shape (rows, columns, merges, borders, alignment) writes it out in Emquad's own layout, one row to a line, keeping its cells, merges, rules and descriptions. A cell written over several lines is typed in as one line, as TeX reads it.

**A line beside only some rows** (from Borders ▸ Line left or right of the selection) is written in those cells' own `\multicolumn` descriptions, as LaTeX allows; beside the whole height of the table it goes in the table's own description.

### Symbols

**Ω** in the toolbar (or **Insert ▸ Symbol…**) opens the symbol panel. Type to search by name, by LaTeX command or by the symbol itself ("alpha", "arrow", "\leq", "≤"), or browse by kind: Greek, operators, relations, arrows, sets and logic, calculus, other, accents and fonts, structures (fractions, roots, sub- and superscripts, sums and integrals with limits, brackets that grow, matrices, cases), text symbols (©, §, –, —, €, ½ and so on) and special characters (`\$`, `\%`, a non-breaking space). **Recent** holds the ones you used last. Every tile shows the symbol as it will print; the line under the grid says what will be written, in a formula and in text.

Emquad writes a symbol the way the place it goes needs:

- inside a formula (`$…$`, `\[…\]`, `equation`, `align` and the like) it writes the command, such as `\alpha`;
- in ordinary text it puts a formula symbol in `$…$`, and writes a text symbol such as `\textcopyright{}` with the braces that keep it from running into the next word;
- a text symbol chosen inside a formula is put in `\mbox{…}`;
- an accent or structure goes around the selected text: select `x` and choose the fraction to get `\frac{x}{}`;
- when the symbol needs a package (`amssymb` for ⩽, ∴ or ℝ; `amsmath` for matrices, cases and `\binom`), Emquad adds it to the preamble and tells you, unless the document already has it or a package that provides it.

While you type in a table cell, the symbol goes into the cell. Each symbol is one step for Undo.

Keyboard: the panel opens with the cursor in its search box; the down arrow goes to the symbols, the arrow keys move among them, Enter puts one in, and Esc closes the panel. Enter in the search box puts in the first match.

**Insert ▸ Formula in the line** puts `$…$` around the selection.

### Spelling

Words Emquad does not know are underlined with a wavy line. Only prose is checked: commands, labels, file names, mathematics, comments and the preamble are left alone. Right-click an underlined word, or put the cursor in it and press Ctrl+., to choose a correction or to add the word to your own dictionary. In Settings, choose the language: English (US or UK), French, Spanish, Dutch, Russian, or Off; and, under **For this project**, a different language for the project that is open, kept with the project. Settings also lists the words you added, each with a × that takes it out again. The dictionaries are part of the app; nothing you type leaves your computer. The first time French is chosen it takes a few seconds to load.

### Comments

Select some text and press the speech-bubble button in the toolbar (Ctrl+Alt+M), write your remark and press **Add comment**. The passage is tinted, and the comment appears in the Comments panel, opened from the speech bubble in the left rail. There you can reply, **Resolve** a comment that is dealt with, reopen it, or delete it. Click a comment to go to its passage; click a tinted passage to see its comment.

Comments are kept beside your project, never inside your `.tex` files, and they follow their passage as you edit around it. When the passage itself was rewritten by another program, a comment finds it again by the text either side. They travel in bundles: your collaborator sees your comments and you see their replies when the bundle comes back.

### Searching

The magnifier in the left rail (Ctrl+Shift+F) searches every text file in the project as you type. Click a result to go to that line. Ctrl+F searches and replaces within the open file.

### While typing

- Type `\` to get suggestions for commands. Inside `\ref{` you get the labels in your project; inside `\cite{` you get the keys from your `.bib` files; inside `\begin{` you get environments.
- After `\begin{something}` press Enter and the matching `\end{something}` is added.
- **Style** in the toolbar sets the paragraph the cursor is in as normal text, a chapter (in a report or thesis), Heading 1 to 3, or a run-in heading. Ctrl+B, Ctrl+I and Ctrl+U set bold, italic and underline.
- **Insert** also has a numbered list, a footnote, a table of contents, a page break, and the bibliography. A project with no `.bib` file is given `references.bib`, with an example reference to copy. Citations have a section of their own, below.
- Text pasted from another program, such as Word or a web page, has `%`, `&`, `#`, `_`, `$` and the like written so that they print, and each paragraph kept as a paragraph. Text from Word, Google Docs or a web page keeps its bold, italic, underline, superscripts and subscripts, headings, bulleted and numbered lists and links, written as LaTeX; its colours, fonts and sizes are left behind, since the document sets those. **Ctrl+Shift+V** pastes the words alone. LaTeX you paste, and text copied in Emquad, goes in as it is.
- To add a picture, drag it from File Explorer onto the text where it should go, or paste one you copied, such as a screenshot. Emquad copies it into the project's `figures` folder (or the folder `\graphicspath` names), puts it in a figure there, and leaves the cursor in its caption. PNG, JPEG and PDF pictures work. A picture never replaces a file of yours: one whose name is taken gets a name of its own. Other files you drop on the window are added to the project.
- The status line shows how many words the file on screen has, not counting commands, mathematics or the settings at the top.
- An orange dot on a tab means the file has unsaved changes. Ctrl+S saves, and recompiles if "Compile when saving" is on in Settings. Opening another project, or closing the window, saves them first.

### Equations

**Insert ▸ Equation…**, or **Alt+=** as in Word, opens the equation editor. The formula is shown as it will print while you type, and you type it as in Word:

- `/` makes a fraction (`1/2`), `^` a power (`x^2`), `_` an index (`x_n`); the arrow keys or Tab leave the box you are in.
- A name becomes what it names: `alpha` gives α, `sqrt` a root, `sum` a sum, `int` an integral, `infty` ∞, `->` an arrow, `<=` ≤.
- The ribbon above has Word's structures: **Fraction**, **Script**, **Radical**, **Integral**, **Large operator**, **Bracket** (with cases and binomials), **Function**, **Accent**, **Limit and log**, **Operator** and **Matrix**. Each is written around what you selected, with empty boxes to fill in; Tab moves between them.
- The row of symbols under it has Greek letters, operators, relations, arrows, logic and calculus; choose the kind on the left.
- **New line** (or Shift+Enter) starts a line below, the lines lined up at their `=`.
- **LaTeX** under the formula shows what will be written, and you can type there too.

Choose whether the formula sits in the line of text, on a line of its own, or on a line of its own with a number to refer to, and press **Insert** (or Ctrl+Enter). To change a formula, double-click it in visual mode, or put the cursor in it and press Alt+=. In visual mode a click on a formula leaves it drawn; the arrow keys, or a click beside it, show its LaTeX to edit by hand. A package the formula needs is added to the settings at the top for you.

### References and citations

Your references live in a `.bib` file in the project, `references.bib` in a new thesis. Emquad adds to it for you:

- **Insert ▸ Citation…** lists the references you have. Type an author, a word of the title or a year to find one, tick it (or several), and press **Cite**. The citation goes where the cursor is.
- **Add a reference…** in the same dialog is a form, like Word's Add New Source: the kind (article, book, conference paper, thesis, web page), the authors one to a line (an organisation in braces, such as `{World Health Organization}`), the title, the year, where it was published, and the pages, DOI or web address if you have them. **Add and cite** writes it at the end of your `.bib` file, gives it a key such as `lovelace1843`, and cites it. References go into the `.bib` file your document names; if that file is outside the project, Emquad leaves it alone and says so.
- **Insert ▸ Citation from Zotero…** (or **From Zotero…** in the dialog) opens Zotero's own quick search, if Zotero is running on this computer with the free Better BibTeX add-on. Choose references there and press Enter: Emquad adds them to your `.bib` file, leaving any it has already as they are, and cites them. This is the only time Emquad connects to anything, and only to Zotero on your own computer.
- **Insert ▸ Citation style…** chooses how citations and the list of references look: numbered in the order cited, numbered alphabetically, IEEE, author and year (Harvard), APA, or abbreviated labels such as [Knu84]. Emquad writes the style, adds the package an author-and-year style needs, and compiles to show it. A document that uses biblatex sets its style in `\usepackage[style=…]{biblatex}` instead.

With an author-and-year style a citation is written `\citep{…}`, which prints as (Knuth, 1984); with biblatex it is `\autocite{…}`. Citations show in the PDF once the document has a list of references: **Insert ▸ Bibliography** adds one.

### When a compile fails

The top bar shows the number of errors, the line is marked in the source, and the previous PDF stays on screen. Emquad says what each error means in plain words, under LaTeX's own message: point at the marked line, or open **Logs and messages** with the page icon next to Recompile. Where the fix is certain it offers it as a button:

- a command or environment from a package the document does not load: **Add \usepackage{…}** adds the package to the settings at the top;
- an `&`, `#` or `_` typed in ordinary text: **Write it as \&** (and so on) puts the backslash before it;
- a `{` or a `\begin{…}` that is never closed, which LaTeX reports at the end of the file: **Go to** takes you to where it was opened.

After a fix Emquad compiles again. Notes on how a line is set (a line a little too wide or too loose) are kept apart in the logs, folded away, and not counted as warnings.

### Moving between source and PDF

- The round arrow between the two panes takes you from the cursor to the matching place in the PDF.
- Double-click anywhere in the PDF to go to the source line that produced it.

## Snapshots and History

A snapshot is a saved version of the whole project that you can return to.

- **Save a snapshot:** File → Save snapshot, or Ctrl+Shift+S. Give it a name such as "Draft 2".
- **Versions kept for you:** while you write, Emquad keeps a version after a save at most every ten minutes ("Saved while writing"), and one before a file is deleted ("Before deleting …"), so History has your work even if you never save a snapshot.
- **Open History:** the History button, or Ctrl+Shift+H.

In History, the list on the right shows the working copy (your files as they are now) and every version, newest first. Select one to see which files it changed and, for each file, the text with its changes marked: removed words struck through, added words highlighted.

- **Restore this version** puts the project back to that version. Your current files are saved as a snapshot first, so a restore can itself be undone.
- **Compare with working copy** shows what your current files have that the selected version does not.
- With the working copy selected, each change has **Undo this change**, which puts that one passage back.
- **Changes** in the source toolbar opens History on the working copy for the file you are editing.

## Working with someone else

Emquad has no accounts and no server. You collaborate by sending one file.

### Send your work

1. Press **Export bundle**.
2. Choose what else to include: the compiled PDF, your comments, and the **LaTeX packages**. With the packages included, the other person can compile with no internet at all. Emquad puts in only the package files your project reads (the dialog gives the most it can add), and first checks that your project really does compile offline from them, which takes a little while. Write a note about what to look at.
3. Choose where to save. You get one file ending in `.emquad`. Send it any way you like.

Exporting saves a snapshot, so Emquad remembers exactly what you sent.

### Continue work you received

Open the `.emquad` file with **Import** (or **Open bundle** on the start screen, or by double-clicking the file). If the project is not on your computer yet, Emquad asks where to put it and opens it as a new project with its full history. Work normally, then export a bundle to send back.

### Review what comes back

Import the returned bundle. Emquad opens History with the bundle selected and a review panel showing two kinds of change:

- **Conflicts** are passages that both of you changed since the version you sent. Each shows your text and theirs, with the differing words highlighted. Click the one to keep, or choose **Edit by hand** to write what the passage should say; the box starts with both versions.
- **Merged automatically** are changes only they made. They are accepted unless you press the ✕ on one to reject it.

**Finish merge** becomes available once every conflict has a choice. It writes the merged files and records the merge in History. Nothing in your files changes until you press it.

If you change your mind, **Start this review over** clears your choices. If you edit your files while a review is open, Emquad will ask you to start the review again, because the merge was worked out against your files as they were.

The state of your project from just before the import is always kept as a version called "Before import from …", so a merge can be undone by restoring it.

### Working with someone who uses Word

- **File ▸ Send to Word…** saves the document as a Word file, with its pictures, headings, lists, tables, footnotes and references, for someone who works in Word. Formulas become Word equations.
- **File ▸ Open a Word file…** makes a new project from a Word file someone sent you, its pictures in a `media` folder, and opens it. Your other projects are not touched.
- Both use **Pandoc**, a free program you install once from pandoc.org (version 3.1.6 or newer); Emquad finds it by itself. A Word file someone sent you is read in Pandoc's sandbox, so it cannot make Pandoc read or fetch anything else. Some things do not carry over exactly, and Emquad says when that happens.
- **File ▸ Save PDF with comments…** saves a copy of the PDF with each open comment on it, highlighted on its passage with the replies, as Acrobat or any PDF viewer shows comments.
- In **History**, choose a version and press **PDF with changes since this version…** to save a copy of the PDF with what was written or changed since then highlighted, each mark saying what was there before, and a note in the margin where text was taken out. Send it to someone who reads PDFs rather than bundles. A change to something that does not print, such as a setting at the top, is not marked. Both PDFs are made after a compile without errors, so the marks fall on the right lines.

## Document setup

**File ▸ Document setup…** sets the page as a word processor's page setup does: the paper (A4 or US Letter), the size of the text, the margins, the line spacing (single, 1.5 lines, double), the typeface (Computer Modern, Times, Palatino or sans serif), whether pages are numbered, and whether paragraphs start with an indent or are set apart by space. Emquad writes the ordinary LaTeX for each choice at the top of the main file (class options, `geometry`, `setspace`, the font packages, `parskip`, `\pagestyle`) and compiles. Everything else in your settings stays as you wrote it, and Ctrl+Z takes the change back.

## Settings

The gear at the bottom of the left rail: your name, whether saving also compiles, the editor's text size, the theme (Fieldwork, Glass or Onyx), the spelling language (for the app and for the open project), your own words, and the compiler for the open project.

The compiler is **Automatic** unless you change it: Emquad's built-in Tectonic, or `latexmk` if Tectonic is missing. Choose **latexmk** for a document that needs your own TeX installation, for example one that relies on pdfTeX-only features. The choice is saved with the project and travels in its bundles; a compiler that is not on the computer is shown as not found, and compiling with it is refused with a message rather than silently using the other one.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Recompile | Ctrl+Enter |
| Save | Ctrl+S |
| Go to this place in the PDF | Ctrl+Alt+J |
| Go to the source | Double-click in the PDF |
| Find and replace | Ctrl+F |
| Bold, italic, underline | Ctrl+B, Ctrl+I, Ctrl+U |
| Search the project | Ctrl+Shift+F |
| Comment on the selected text | Ctrl+Alt+M |
| In the page view: show the paragraph as LaTeX, or draw it again | Ctrl+/ |
| Subscript, superscript | Ctrl+=, Ctrl+Shift+= |
| Format painter: copy the formatting at the cursor | Ctrl+Shift+C |
| In the page view: bullets, centre | Ctrl+Shift+L, Ctrl+E |
| In the page view: a list item a level down or up | Tab, Shift+Tab |
| In the page view: show or hide LaTeX marks | Ctrl+Shift+8 |
| In the page view: the right-click menu | Shift+F10 |
| Equation editor | Alt+= |
| Paste without formatting | Ctrl+Shift+V |
| In a table: next or previous cell | Tab, Shift+Tab |
| In a table: select cells | Shift+arrow keys |
| In a table: stop typing; then reach the tools | Esc; then Tab |
| In a table: open its menu | Shift+F10 |
| In a table: select the whole table | Ctrl+A, with cells selected |
| In a table: copy, cut, paste cells | Ctrl+C, Ctrl+X, Ctrl+V, with cells selected |
| In a table: empty the selected cells | Del |
| Correct the misspelled word at the cursor | Ctrl+. |
| Suggest completions | Ctrl+Space |
| Go to definition, find references, rename | F12, Shift+F12, F2 |
| New window, for another project | Ctrl+Shift+N |
| Leave the editor with the keyboard | Esc, then Tab |
| Show or hide the file panel | Ctrl+Shift+B |
| Save snapshot | Ctrl+Shift+S |
| Open History | Ctrl+Shift+H |
| Export bundle | Ctrl+Shift+E |
| Import bundle | Ctrl+Shift+I |

## Language help

When the footer of the source pane shows **texlab**, the LaTeX language server is running. Completion then knows the packages your document loads, hovering over a command or label shows information about it, F12 goes to where a label or command is defined, opening the file it is in if need be, Shift+F12 lists where it is used, and F2 renames a label everywhere in the open file.

## Good to know

- **Your files stay plain.** Emquad never writes anything into your `.tex` files except what you type. Its own data is in a hidden `.emquad` folder inside the project; deleting that folder removes the project's history but not your documents.
- **The compiler.** Emquad uses its bundled compiler, Tectonic. It handles most documents, but ones that depend on pdfTeX-only features or on running external programs (for example the `minted` package) may not compile. If you have a TeX installation, switch such a project to `latexmk` in Settings.
- **Packages that came in a bundle.** A project opened from a bundle that carried LaTeX packages keeps them in its own `.emquad` folder and compiles from there. They are used by that project only.
- **File names.** Files whose names contain `~` followed by a digit (such as `notes~1.tex`), and folders named `.git` inside the project, are left alone by Emquad: they are not listed and not saved in versions.
- **A window for each project.** File ▸ New window (Ctrl+Shift+N) opens another window, for another project. A project open in one window cannot be opened in a second, and nor can a folder inside it or around it: Emquad brings the first forward. A bundle for a project open in another window goes to that window. Starting Emquad again, or double-clicking a bundle, uses the window you used last.
