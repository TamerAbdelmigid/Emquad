# Open items

What is still to do, and what the code reviews noted that has not been dealt with. Rewritten on 15 October 2026, after the work on branch `feat/open-items` closed most of the earlier list. Update this file as items are closed; delete an item when it is done rather than marking it.

The limits users will meet are also listed, in user terms, under "Known limitations" in `05-implementation-plan.md`. This file is the working list behind it.

## Decided by the owner on 14 October 2026

- **Licence:** MIT (`LICENSE`).
- **Code signing:** the installer stays unsigned for now. The steps for when that changes are in `releasing.md`.
- **The Caption tool:** kept, and widened to the ordinary cases it used to decline.
- **macOS and Linux builds:** left for later.

## Reviewed

- **The work on `feat/open-items`** was read by three independent reviewers on 15 October 2026 (bundles and packages; windows, the language server and the capability; tables, captions and symbols). Each reported blocking defects: a `.bib` name that made the app contact a network share, a race that let two windows open one project, and a row's first cell starting with `[` that LaTeX took as an option. These, and the should-fix and minor findings, were fixed on the same branch with a test for each, except those listed below.

## Still open

### Table editor

- **What a list cannot cover.** Underscores typed in the text argument of a command are escaped only for the commands the editor knows hold prose (`PROSE` in `tableModel.ts`, with a list of commands whose arguments are names). In the argument of a command it knows nothing about, such as one the document defines itself (`\myemph{snake_case}`), an underscore is left as typed, and the document will not compile until it is escaped by hand. Add commands as they come up.
- **A rule a merge took away whole** comes back on splitting only in a table ruled between all its rows; the source keeps no trace of it otherwise, by design.
- **Read-only still:** column types other than `l c r p m b X` (such as siunitx's `S`, `D`, `*{n}{…}`), double vertical rules, a bar written after `@{…}` or `!{…}`, `\hhline`, dashed rules, `\specialrule`, a longtable's head and foot, `\\*`, brackets after a comment after `\\`, a comment or a blank line inside a cell, verbatim environments in a cell.
- **A cell that already holds a line break** outside `\makecell` and the like (as in a `\multirow` with a width, or a command of the document's own) can still be edited, but no further break can be typed into it.
- **A merged cell over columns with a width** takes the first column's description, width and all, so its text wraps at that width rather than at the width of all the columns it covers.
- **Structural changes lay the table out again**, one row to a line; only typing, clearing, pasting and bold or italic keep a hand-made layout.

### Visual mode

- **The lines that only begin and end a list, an alignment, a quotation or the abstract are hidden**, as a pair: when either shares its line with other text, both show as source. In the draft view, Backspace at the start of the line after a hidden one joins the two lines, showing the source; nothing is lost, and Ctrl+Z puts it back. The page view keeps those line breaks.
- **The page view is a likeness of the page,** not the PDF: lines break where the editor's width puts them. Pages break where the last compile broke them, but only between source lines (`SyncTeX` gives no columns for most text), each break placed where the fewest of the file's SyncTeX records fall on the wrong side of it, so that a float or a footnote set on another page does not move it. Two columns (`twocolumn`) and line numbers are not drawn; `multicols` for one passage is not offered.
- **The header and footer tools** own the header's right field and the footer's middle one; a document whose fancyhdr setup is its own (`\fancypagestyle`, `\lhead`, fields for even and odd pages) keeps it, and its fields are not drawn on the page. A page number written with other text (`Page \thepage`), or in fields for even and odd pages, cannot be switched off from the ribbon: the tool says so. A `\pagestyle{fancy}` written after `\begin{document}` is not read.
- **Changes since a snapshot** are History's comparison of whole lines, with the words that differ marked inside them: Undo change puts back all of a change's lines, and an environment begun in one change and ended in another can be left unbalanced by undoing one of them. Whose a change is, is judged from the other author's newest version since the snapshot: theirs when it made the same change to the same lines; one edited after it came in, or run together with changes of yours, is drawn as yours.
- **Comment balloons** are placed for the passages in view; they do not yet move to stay clear of one another across a long page, beyond stacking those on screen.
- **The cross-reference picker** lists labels from every `.tex` file of the project, with numbers from the last compile; one written in a file the compile does not read shows "?". A label in a subfigure with no caption of its own, inside a figure that has one, is listed under the last heading, though LaTeX numbers it as the figure.
- **The Picture tab** sizes a figure holding one picture; a figure of several (subfigures, minipages side by side) is sized in its LaTeX. Wrapping text round a picture (wrapfig) and one landscape page for a wide table (pdflscape) are not offered.
- **List tools need lists written one thing to a line.** A list whose `\item`s share lines with other text, or whose `\begin` or `\end` does, is left to ordinary editing by Tab, Enter and Backspace, and the Bullets and Numbering buttons say they cannot act on it. Rewriting such a list into lines of its own was not done, so that a hand-made layout is never changed unasked.
- **Alignment and Quote act on the whole environment** a paragraph is in: centring one paragraph of three already set right changes all three. Splitting the environment, as Word would, is left for later.
- **A numbered list cut in two** by Enter on an empty item numbers its second half from 1. Word continues the numbers; enumitem's `resume` would do it, but needs the first half to be found again when lists are edited later.
- **Highlight uses soul,** whose `\hl` cannot hold every command: a footnote or a `\cite` inside a highlighted passage may not compile. The tool does not check what it is put around.
- **Colours other than the palette's six** and xcolor's common names are kept but drawn in the text's usual colour; reading `\definecolor` lines to draw any colour is not done.
- **Where typing goes at the edge of formatting** follows the cursor's place in the source: at the end of a bold word it goes into the bold when the cursor is before the hidden `}`, and after it once the cursor has stepped past. Word continues the formatting on the left; the page view does not yet decide this itself.

- **Split with LaTeX** shows the file on screen; the LaTeX side has no completion, spelling or comments of its own, though Ctrl+F searches it, and its edits are undone from the page's history, a word typed there being one step. A block drawn from the PDF is found by its LaTeX as the last compile read it; once that LaTeX has changed it is shown as written until the next compile. A new command's name is checked against the commands the app knows and those the document defines; a package's own command that is neither is not known to be taken. It is in the page view only.
- **Blocks drawn from the PDF** are the environments listed in the product spec; another environment the editor cannot draw (one of the document's own, say) is shown as its source. The crop is the box around the lines the block set on its first page, so a block split over two pages shows its first part; after an edit it shows the last compile's drawing until the next.
- **My commands** are commands that take nothing; one written with arguments, or defined in another file than the one on screen, is used as written and not drawn as what it prints.
- **Packages…** explains and does not remove: taking a package out is done in the source.
- **KeyTips** give each tool the first letter of its name not taken already, so the letters can change as tools come and go; Word's own two-letter tips are not copied.

### The rest of the Word proposal

Not built in 0.15.0–0.19.0, from `mockup/proposal-visual-word.html`: a ruler with margins to drag; Focus; pages in the Navigation pane; Hyphenation; Wrap text (wrapfig); Kind of document; a landscape page for one table (pdflscape); multicols for one passage; drawing two columns and line numbers on the page; Endnote, Next footnote, Mark entry, Insert index and Acronym; Manage sources; F7 to step through misspellings and the document's language from the ribbon; Typeface and Size on Home, Title and Code styles, Modify and New style; the Table and Equation contextual tabs (their tools are in the table's bar and the equation editor); LaTeX block, Show what buttons write, the cheat sheet; the bibliography's entries drawn from the `.bbl`.

### Caption tool

- **Definitions in other files** (a class, a style file of the user's own, a file brought in with `\input`) are not read; a preamble that reads another file is declined, and what a class or style file defines is taken on trust.
- **Constructed cases** may still get through and then fail to compile, such as a macro that changes `\catcode` indirectly. The tool checks the ordinary forms of everything it knows can hide an environment.

### Spelling

- **Languages:** English (US and UK), French, Spanish, Dutch and Russian ship. German and Italian word lists are offered only under the GPL and are not shipped. Portuguese and Polish were left out because nspell takes from 8 seconds to several minutes to load them.

### Language server and compiler

- **Rename (F2) changes only the file on screen.** The editor shows one file at a time, and the language server's edits to other files (the `\ref`s of a renamed `\label`) are not applied. The references panel also closes after the first jump into another file.
- **A document that names a file on another computer.** The app never looks up a `.bib` name that points at a network share, but texlab, and the compiler when the user compiles, read the files a document names wherever they are. A project from someone else that names `//host/share/…` could make them contact that computer.

### Speed

- **Opening History, or a project,** works out whether anything changed since the last version by reading every file of the project, which takes about a second for 200 MB of pictures. Remembering each file's size and time of change would avoid it, but on file systems that keep times only to two seconds an edit of the same length could then go unseen by a snapshot, so it has not been done.
- **Very long documents** are drawn again in about 14 ms (5,000 lines, 50 tables) once typing pauses, and read for spelling in about 100 ms; both happen only after a pause, not while typing.

### Comments

- **A comment whose words and the text on either side were all rewritten** outside the app is listed without a place in the text.

### Platforms

- **macOS and Linux builds** (see the decision above).
- **A truly clean Windows computer** with no TeX has not been tried; it was simulated by taking TeX off the app's PATH and giving Tectonic an empty package cache.

### Windows of the app

- **Isolation between windows** is checked by unit tests and by the end-to-end script opening a second window, but no test drives two projects in two windows at once: the end-to-end harness drives the first window only.

## Suggested order

1. The versions planned after 0.8.2, in `05-implementation-plan.md`.
2. Apply the language server's edits to other files, so rename works across a project.
3. Add prose commands to `PROSE` as users meet them.
