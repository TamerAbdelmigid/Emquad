# Open items

What is still to do, and what the code reviews noted that has not been dealt with. Rewritten on 15 October 2026, after the work on branch `feat/open-items` closed most of the earlier list. Update this file as items are closed; delete an item when it is done rather than marking it.

The limits users will meet are also listed, in user terms, under "Known limitations" in `05-implementation-plan.md`. This file is the working list behind it.

## Decided by the owner on 14 October 2026

- **Licence:** MIT (`LICENSE`).
- **Code signing:** the installer stays unsigned for now. The steps for when that changes are in `releasing.md`.
- **The Caption tool:** kept, and widened to the ordinary cases it used to decline.
- **macOS and Linux builds:** left for later.

## Not yet reviewed

- **The work on `feat/open-items`** (the commits after `6bec482`) passed `pnpm verify`, the end-to-end script and the keyboard pass, but has not yet been read by an independent reviewer. It touches the bundle and package code, the per-window sessions and the capability configuration, so it is full tier.

## Still open

### Table editor

- **What a list cannot cover.** Underscores typed in the text argument of a command are escaped only for the commands the editor knows hold prose (`PROSE` in `tableModel.ts`, with a list of commands whose arguments are names). In the argument of a command it knows nothing about, an underscore is left as typed, and the document will not compile until it is escaped by hand. Add commands as they come up.
- **A rule a merge took away whole** comes back on splitting only in a table ruled between all its rows; the source keeps no trace of it otherwise, by design.
- **Read-only still:** column types other than `l c r p m b X` (such as siunitx's `S`, `D`, `*{n}{…}`), double vertical rules, `\hhline`, dashed rules, `\specialrule`, a longtable's head and foot, `\\*`, a comment or a blank line inside a cell, verbatim environments in a cell.
- **Structural changes lay the table out again**, one row to a line; only typing, clearing, pasting and bold or italic keep a hand-made layout.

### Caption tool

- **Definitions in other files** (a class, a style file of the user's own, a file brought in with `\input`) are not read; a preamble that reads another file is declined, and what a class or style file defines is taken on trust.
- **Constructed cases** may still get through and then fail to compile, such as a macro that changes `\catcode` indirectly. The tool checks the ordinary forms of everything it knows can hide an environment.

### Spelling

- **Languages:** English (US and UK), French, Spanish, Dutch and Russian ship. German and Italian word lists are offered only under the GPL and are not shipped. Portuguese and Polish were left out because nspell takes from 8 seconds to several minutes to load them.
- **Loading blocks the editor** for a moment the first time a language is chosen (about three seconds for French), because nspell builds its tables on the page's own thread. Loading it in a worker would avoid that.

### Comments

- **A comment whose words and the text on either side were all rewritten** outside the app is listed without a place in the text.

### Platforms

- **macOS and Linux builds** (see the decision above).
- **A truly clean Windows computer** with no TeX has not been tried; it was simulated by taking TeX off the app's PATH and giving Tectonic an empty package cache.

### Windows of the app

- **Isolation between windows** is checked by unit tests and by the end-to-end script opening a second window, but no test drives two projects in two windows at once: the end-to-end harness drives the first window only.

## Suggested order

1. Have `feat/open-items` reviewed.
2. Load the spelling dictionary in a worker.
3. Add prose commands to `PROSE` as users meet them.
