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

### Caption tool

- **Definitions in other files** (a class, a style file of the user's own, a file brought in with `\input`) are not read; a preamble that reads another file is declined, and what a class or style file defines is taken on trust.
- **Constructed cases** may still get through and then fail to compile, such as a macro that changes `\catcode` indirectly. The tool checks the ordinary forms of everything it knows can hide an environment.

### Spelling

- **Languages:** English (US and UK), French, Spanish, Dutch and Russian ship. German and Italian word lists are offered only under the GPL and are not shipped. Portuguese and Polish were left out because nspell takes from 8 seconds to several minutes to load them.
- **Loading blocks the editor** for a moment the first time a language is chosen (about three seconds for French), because nspell builds its tables on the page's own thread. Loading it in a worker would avoid that.

### Language server and compiler

- **Rename (F2) changes only the file on screen.** The editor shows one file at a time, and the language server's edits to other files (the `\ref`s of a renamed `\label`) are not applied. The references panel also closes after the first jump into another file.
- **A document that names a file on another computer.** The app never looks up a `.bib` name that points at a network share, but texlab, and the compiler when the user compiles, read the files a document names wherever they are. A project from someone else that names `//host/share/…` could make them contact that computer.

### Comments

- **A comment whose words and the text on either side were all rewritten** outside the app is listed without a place in the text.

### Platforms

- **macOS and Linux builds** (see the decision above).
- **A truly clean Windows computer** with no TeX has not been tried; it was simulated by taking TeX off the app's PATH and giving Tectonic an empty package cache.

### Windows of the app

- **Isolation between windows** is checked by unit tests and by the end-to-end script opening a second window, but no test drives two projects in two windows at once: the end-to-end harness drives the first window only.

## Suggested order

1. Load the spelling dictionary in a worker.
2. Apply the language server's edits to other files, so rename works across a project.
3. Add prose commands to `PROSE` as users meet them.
