# Open items

What is still to do, and what the code reviews noted that has not been dealt with. Written on 13 October 2026, at commit `a5f3145` (the table editor). Update this file as items are closed; delete an item when it is done rather than marking it.

The limits users will meet are also listed, in user terms, under "Known limitations" in `05-implementation-plan.md`. This file is the working list behind it.

## Decisions waiting for the owner

| Decision | Why it matters | Options |
|---|---|---|
| Licence for the app | Nothing can be published without one. The dependencies allow any choice; texlab (GPL-3.0) stays a separate program either way | MIT or Apache-2.0 (permissive), GPL-3.0 (copyleft), or closed |
| Code-signing certificate | The installer is unsigned, so Windows SmartScreen warns on first run. Steps are in `releasing.md` | Buy an OV or EV certificate, use Azure Trusted Signing, or stay unsigned |
| Keep the Caption tool in the table bar? | It is deliberately cautious and declines often; LaTeX cannot be checked statically, so it can never be proven safe in every document | Keep as is, or remove it and leave captions to the source |

## Not yet reviewed

- **Commit `a5f3145`** fixes the two findings of the ninth review of the table editor (below). It passed `pnpm verify`, the end-to-end script, the release smoke test and the installed-copy test, but no independent reviewer has read it. The ninth review's verdict, on `23ec40a`, was "blocking defects found". A review of `a5f3145` alone, scoped to `escapeInserted`, `inProse`, `soundCaption` and `PROSE` in `src/features/editor/tableModel.ts`, would close this.
- **Commit `13c5737`** (the last tidy-up of comments and packages) was likewise verified but not re-reviewed after the second review of that work.
- **The fixes to the review of the table tools and symbols** (the commit after `0e87df0` on `feat/word-like-editing`) passed every automated check but have not been reviewed again.

## Table editor: noted in review, not fixed

All in `src/features/editor/tableModel.ts` unless another file is named. None of these writes anything without the user acting, and each is one undo away.

### Typing in cells and captions

- **Display mathematics in a cell or caption.** `$$a_b$$` and `\[x^2\]` are accepted as sound but do not compile inside a table cell or a caption. Refuse `$$` and `\[` there, or say so in the message.
- **Text commands inside mathematics.** In `$\text{a_b}$` or `$\mbox{a_b}$` the underscore is left bare, because being in mathematics wins over being in a text argument. Rare.
- **Argument counting in `inProse`.** `\textbf{a}{c_d}` is read as a second argument, and a `[` typed straight after a command (`\textbf{a}[b_c]`, `\LaTeX[a_b`) is read as options. In both the underscore is left bare and the cell is written. Needs unusual typing with no space.
- **A caret outside mathematics is held, not converted.** `50^2` marks the cell until the user writes `$50^2$`. Deliberate, but the message could offer to do it.
- **The commands known to hold prose are a list** (`PROSE`). A command not on it has its argument left as typed, so an underscore typed in the text of an unlisted box or formatting command is written bare and the document will not compile until it is escaped by hand. Add commands as they come up.
- **A cell that already holds a bare `#`** inside an address, such as `\url{http://x.org/#a}`, is accepted as sound; one that holds a bare `#` in prose can never be changed in visual mode. The message does not say why.
- **Messages.** When a cell is held back, the notice names braces, `$` and `^` but not a bare `_` or `#`. It should name whichever check failed.
- **A dollar amount.** `Price $5 to $10` compiles but sets "5 to" as mathematics. Nothing warns.
- **Pasting a very long text into one cell** is slow above about 5,000 characters, because where each character stands is worked out again for every `&` and `_`.
- **`\url|…|` with a space before the bar** (`\path |a%b|`) is read as TikZ's `\path`, so a `%` in it starts a comment as far as the caption tool is concerned.

### Rules and merged cells

- **A rule that merged cells cross along its whole length is forgotten.** Splitting those cells later does not bring it back. A rule crossed in part is drawn around the merged cell and returns whole.
- **Merging across a `booktabs` rule** turns it into an ordinary `\hline`, because only that can be drawn around a merged cell with `\cline`.
- **A filler cell's own description is not kept.** Under a `\multirow`, a filler written `\multicolumn{1}{l|}{}` makes the table read-only rather than being preserved.
- **A table that came from malformed HTML** (overlapping row and column spans on the clipboard) is not offered as a table. Word and Excel do not produce this.

### Reading tables

- **Read-only by design, could be supported later:** `p{…}`, `m{…}`, `X` and `@{}` columns; `tabularx`, `tabular*`, `longtable`; `\cmidrule`; `\midrule[2pt]`; `\rowcolor`; `\\[2pt]`; `\multirow` with a width; a comment inside the table; `\verb`; nested tables.
- **A hand-written table is laid out again on its first edit**, one row to a line. Cells, merges, rules and column descriptions are kept; spacing is not. `\multicolumn{2}{c}{…}` whose description says only what the columns already say is written without change, but is no longer remembered separately, so aligning that column afterwards aligns the heading too.
- **A cell written over several source lines** is joined into one line with spaces.

### Caption tool

- **It declines in many ordinary documents.** The commonest reasons: a preamble with `\newcommand{\be}{\begin{equation}}` or a `\newenvironment` built on `\begin`; `\AtBeginDocument`; `\csname` under `\makeatletter`; a table inside `center` that is not yet in a float; `\noindent` or `\centering` on the line before a table that stands on its own; a note or `\vspace` straight after the table in its float; a commented-out `\caption` after the table. Each could be allowed with more care.
- **A `figure` that holds an image, its caption and a table** offers the image's caption as the table's. The user sees the text before changing it, but nothing says whose it is.
- **Removing a caption that shares its line with a `\label`** is refused, rather than removing both.
- **Constructed cases that still get through** and then fail to compile: a home-made delimited macro around the table (`\long\def\boxit#1\endboxit{…}`), a redefined `table` environment (`\renewenvironment{table}…`), a `\catcode` change that makes other characters act as braces. Also anything defined in another file (`\input`, a user's `.sty`, the class), which is not read.
- **Windows line endings.** Wrapping a table in a float inserts `\n` even in a file that uses `\r\n`.

### The widget (`src/features/editor/tableEditor.ts`)

- **Leaving a cell that is marked as not yet valid** discards what was typed there and shows a notice. It could keep the box open instead.
- **Undo while typing in a cell** keeps the view where it is, but the text cursor of the document is elsewhere, so the status line shows that position.
- **No test drives the widget except the end-to-end script.** The model is unit-tested; the controller is not.

## Table tools and symbols: noted, not fixed

From the work on word-processor-style editing (branch `feat/word-like-editing`). The review of its first commit found ten defects; all ten were fixed, each with a test.

- **A symbol put straight after a formula** starts a formula of its own: with the cursor just after `$n$`, ≥ gives `$n$$\geq$`. It compiles and prints the same, but reads untidily. It could go inside the formula before it instead.
- **Packages loaded by a style file of the user's own** (`\usepackage{mystyle}`) are not looked into. A symbol needing `amssymb` adds it even if `mystyle.sty` loads a font package that clashes with it, such as `newtxmath`. A preamble that reads another file with `\input` is left to the user, with a message.
- **The left and right edges** from the Borders menu draw a line the whole height of the table, since that is all a column description can say; the menu says so in its tooltips, but a user may expect only the selected cells.
- **A matrix or `cases` in a table cell** is held back as not yet valid (an environment makes the table one the editor cannot write back), with a message saying so. It could be allowed once the reader understands environments inside cells.
- **The Symbol panel** inserts one symbol and closes. Several in a row mean opening it again each time (Recent makes this quick).

## Bundles, comments and spelling: noted in review, not fixed

- **A sender whose clock runs ahead** has their comments stamped with the time of import each time the bundle is imported, so importing the same bundle twice can rewrite `comments.json` (`src-tauri/src/comments.rs`, `clean_time`).
- **A file saved by another program in the few seconds between the offline check and the writing of a bundle** is not checked again (`commands.rs`, `bundle_export`). The package files are safe from this; the project's own files are not.
- **Opening a bundle into an existing empty folder**, when its packages or comments then fail to install, leaves the files already written there (`bundle.rs`, `import_new`).
- **A bundle with packages carries every package file the sender's computer holds**, not only the ones the document uses. Tectonic does not report which files a compile read. A local HTTP range server that records what Tectonic asks for would give the exact set.
- **A comment whose words were all rewritten outside the app** is listed without a place.
- **Spelling is English only**, one language for every project, and words added to the dictionary cannot be removed from the app.
- **The installed-copy test** (`scratchpad/e2e/installed-test.ps1`, not in the repository) must be run with PowerShell 7. Under Windows PowerShell 5 it writes the settings file with a byte-order mark, which the app sets aside as damaged. The app could accept a byte-order mark; the script could live in `scripts/`.

## Older items still open

- **Jumping to a definition in a file that is not open** (texlab) is not wired up.
- **No one has used the whole app with the keyboard alone.** The end-to-end script checks that every control is focusable and named, which is not the same.
- **A machine with no TeX at all** has not been tried; the development machine has TeX installed beside the bundled Tectonic.
- **macOS and Linux builds.**
- **Visual mode:** toolbar actions that act on the drawn document; figures do not follow `\graphicspath`; citation names come only from `.bib` files in the project.
- **One window, one project at a time.**

## Suggested order

1. Decide the three questions at the top.
2. Review `a5f3145`.
3. Name the failed check in the held-cell message, and refuse `$$` and `\[` in cells and captions.
4. Let the Caption tool through the commonest ordinary cases it now declines (`center` without a float, a `\vspace` or note after the table, a preamble whose only `\begin` is inside a `\newenvironment`).
5. `p{…}` columns and `\cmidrule` in the table editor.
6. Smaller offline bundles.
