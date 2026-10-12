# Design system: Fieldwork

The approved design is [mockup/emquad-fieldwork.html](../mockup/emquad-fieldwork.html). It is a single static HTML file with inline CSS and a little script; open it in a browser. When this document and the mockup disagree about how something looks, the mockup wins. When they disagree about behaviour, `01-product-spec.md` wins, because the mockup only fakes behaviour.

## The idea

The app is styled as a piece of desktop hardware: a light brushed-aluminium body made of separate rounded panels, a dark glass screen for the source, a paper bed for the page, and keys with physical depth. The layout itself is deliberately conventional and follows Overleaf, so that an Overleaf user knows where everything is.

Three things carry the identity; keep them and keep everything else quiet:

1. **Light body, dark screen.** Every panel is light except the source editor (and the project readout in the top bar), which are dark insets.
2. **Keys with depth.** Buttons have a hard lower edge and move down when pressed. One orange key per screen: the primary action.
3. **Typesetting details.** A ruler and crop marks around the page; monospace uppercase micro-labels on panels.

## Tokens

`src/design/tokens.css` holds the mockup's `:root` block plus tokens for the surfaces and edges the mockup wrote out as literal colours (`--on-bg`, `--edge-a`, `--pop-bg` and so on), so a theme is a set of token values. Components are built only from these custom properties. The essential ones:

| Token | Value | Use |
|---|---|---|
| `--bg` | radial gradient `#E2E1DB` → `#CDCCC6` | App background (the "chassis") |
| `--mod-bg` | linear gradient `#F0EFEA` → `#E9E8E3` | Panel face |
| `--mod-sh` | inset white top edge, 1px `#C6C5BF` ring, 2px `#B7B6AF` lower edge, soft drop shadow | Panel depth |
| `--r` | 14px | Panel corner radius |
| `--tx` / `--mu` | `#141414` / `#5C5B56` | Text / secondary text on light |
| `--acc` | `#FF4D00` | The accent: primary key, active markers, badges |
| `--acc-tx` | `#C23A00` | Accent used as text on light surfaces (meets contrast) |
| `--scr-bg` | `#121315` | Screen (editor) background |
| `--scr-tx` / `--scr-dim` / `--scr-num` | `#ECEAE3` / `#9A9CA2` / `#5C5F66` | Screen text / secondary / line numbers |
| `--scr-cur` / `--scr-line` | `#1B1D21` / `#26282C` | Current line and toolbar fill / dividers on screen |
| `--k` / `--m` | `#A9BCFF` / `#EBC66E` | Syntax: commands / math |
| `--lcd-bg`, `--lcd-tx`, `--lcd-mu` | dark gradient, `#F3F1E8`, `#8D9285` | Readout insets |
| `--ok` | `#3EDC81` | Status light: compiled |
| `--btn-bg`, `--btn-sh` | light gradient; 1px ring plus 3px hard lower edge | Keys |
| `--hover`, `--line`, `--card` | `#DFDED8`, `#D2D1CB`, `#F8F7F3` | Hover fill, dividers, cards on a panel |

### Author colours

Change tracking uses one colour per person, never red and green.

| Who | On light panels | On the dark screen | Highlight fill |
|---|---|---|---|
| You (`--mine`) | `#C23A00` | `#FFB08A` | `#FFE0D0` |
| The other author (`--theirs`) | `#2450F0` | `#93ADFF` (`--ts`) | `#DCE4FF` |

Insertions are underlined (or filled, in the History diff); deletions are struck through. Colour is never the only signal: every conflict option is also labelled "Yours" or "Theirs" in text.

### Type

| Role | Face | Notes |
|---|---|---|
| Interface | Hanken Grotesk 400/500/600; 800 for the wordmark and dialog titles | Wordmark is lowercase with tight tracking |
| Code, file names, numbers | Geist Mono 400/500 | Editor is 12.5px on a 24px line |
| Micro-labels | DM Mono 500, 10px, uppercase, 0.14em tracking | Panel headers such as "FILE TREE" |
| The typeset page | STIX Two Text | Only inside the mockup's fake page; the real app shows the real PDF |

Bundle the font files with the app. The mockup loads them from Google Fonts, which the offline app must not do.

## Layout

### Global rules

- The app fills the window exactly. **The window never scrolls.** Each panel scrolls internally when its content is longer.
- 8px padding around the app and 8px gaps between panels. Panels are separate rounded modules, not flush panes.
- Minimum supported window is about 1280 × 720. Below 1280px wide the mockup stacks panels and lets the window scroll; the real app should instead enforce a minimum window size and let the user collapse panels.
- Panel widths between files, source and PDF are user-resizable by dragging the gaps; the 8px gap is the drag target. The mockup does not show this.

### Top bar (about 43px tall)

Three zones: left, centre, right.

- **Left:** wordmark; menus File, Edit, Insert, View, Format, Help.
- **Centre:** the project readout, a dark inset with three cells: project name (a menu for switching or renaming), compile state with a status light, error count.
- **Right:** History (with a badge counting unresolved conflicts when a bundle awaits review), Layout, Import, and Export bundle as the dark key.

In History the left zone becomes a single "Back to editor" key and the right zone is empty.

### Editor screen

Columns, left to right: `50px | 244px | 1.08fr | 1fr`

1. **Icon rail.** File tree, search, comments (with a count of open comments), history (same badge as the top bar); help and settings pinned to the bottom. The active item is a dark key.
2. **Files panel.** "File tree" header with new file, new folder, add from disk, close. Then the tree. Then a grip divider. Then "File outline".
3. **Source screen** (dark). File tabs on top (active tab has an orange top edge); a one-row toolbar (undo, redo, heading level, bold, italic, table, symbol; then, right-aligned, the Code / Visual switch and the mode menu); the editor; a footer with cursor position, language, engine and offline state.
4. **PDF panel.** Header: Recompile split key (orange) with its options arrow, logs, save PDF; right-aligned page navigation and zoom. Below: a ruler strip, then the page centred on the bed with crop marks at its corners.

Two round arrow keys sit on the gap between source and PDF: jump to PDF, jump to source.

The mode menu in the mockup reads "Suggesting". In the app its options are **Editing** and **Showing changes since…** (see `03-bundles-and-history.md`); rename accordingly.

### History screen

Columns when a bundle is selected: `250px | 1fr | 320px | 300px`
Columns otherwise: `250px | 1fr | 300px`

1. **Files in this version**, each with an "Edited" tag where it differs.
2. **Source screen** (dark) with a header "Viewing <version>" and "<n> changes in <file>", then the file with changes highlighted and changed lines marked in the gutter.
3. **Review panel**, only for a bundle: a dark inset naming the bundle and its base; "Conflicts" with a resolved count; each conflict as two selectable cards, Yours and Theirs, with the differing words highlighted in the author's colour; "Merged automatically" as compact rows with accept and reject keys; Finish merge as a full-width dark key, disabled until every conflict is resolved.
4. **Versions**: an "All history / Snapshots" switch; entries grouped into Latest and Snapshots; the selected entry is a dark key. Pinned at the bottom: Restore this version, Compare with working copy.

### Export dialog

A centred modal on a dimmed backdrop: title and one-line explanation; file name; an "Include" group of checkbox rows (sources, history, PDF, comments, LaTeX packages) each with a short reason on the right; a note to the recipient; Cancel and an orange Export key.

## Components

Build these once in `src/design/` and use them everywhere.

| Component | Variants | Notes |
|---|---|---|
| `Module` | light, screen | The rounded panel. `screen` is the dark inset with the bezel rings |
| `Button` | default, primary (orange), dark; sizes regular (36px), small (28px) | Moves down 2px while pressed. Top-bar buttons use the small size |
| `SplitButton` | primary | Recompile plus its options arrow |
| `IconButton` | on light, on screen | 30px square, flat, fill on hover; always has an accessible name |
| `RailButton` | default, active, with badge | 36px square |
| `Badge` | count | Orange pill; hidden at zero |
| `Segmented` | on light, on screen | Code / Visual; All history / Snapshots |
| `Readout` | cells | Dark inset with divided cells and an optional status light |
| `Label` | — | The uppercase micro-label |
| `Tag` | theirs (blue), warning (orange) | "Edited" |
| `TreeItem` | file, folder, nested, active, with badge or tag | Active is a dark key with an orange icon |
| `Tab` | default, active | On the screen |
| `ChoiceCard` | mine, theirs; unselected, selected | A real button with pressed state; selected gets a 2px ring in the author's colour |
| `Dialog` | — | Native `<dialog>` semantics, focus trapped, Escape cancels |

## Interaction and accessibility requirements

- Every control is a real `button`, `input`, or link, reachable by keyboard, with a visible focus ring (the mockup uses a 3px blue outline).
- Icon-only controls have accessible names. Decorative icons are hidden from assistive technology.
- Toggle and selection controls expose their state (`aria-pressed`, `aria-selected`, `aria-expanded` as appropriate).
- Text contrast is at least 4.5:1, including secondary text on both light and dark surfaces. `--acc` (`#FF4D00`) is for fills and markers; use `--acc-tx` for accent-coloured text on light.
- Respect `prefers-reduced-motion`: the key press movement and any transitions are disabled.
- Icons are simple 16px line icons, 1.5px stroke, drawn inline. The mockup's set is the starting point. No emoji.

## Keyboard shortcuts

Initial set; make them discoverable in menus and tooltips.

| Action | Shortcut |
|---|---|
| Recompile | Ctrl+Enter (also Ctrl+S when compile-on-save is on) |
| Save | Ctrl+S |
| Jump to PDF / jump to source | Ctrl+Alt+J / double-click in the PDF |
| Find / replace | Ctrl+F / Ctrl+H |
| Comment on the selection | Ctrl+Alt+M |
| In a table: next / previous cell | Tab / Shift+Tab |
| In a table: select cells | Shift+arrow keys |
| In a table: the table's menu | Shift+F10 |
| Correct the word at the cursor | Ctrl+. |
| Toggle file panel | Ctrl+B |
| Save snapshot | Ctrl+Shift+S |
| Open History | Ctrl+Shift+H |
| Export bundle / import bundle | Ctrl+Shift+E / Ctrl+Shift+I |

## Where the app differs from the mockup

Deliberate differences, so nobody "fixes" them back:

- **Three themes.** Fieldwork is the default. Glass and Onyx (`src/design/themes.css`) redefine the tokens only; no component rule is repeated. The source editor stays dark and the PDF stays white in every theme.
- **The side panel** also holds project search and comments, each opened from the rail. A comment is a card: the quoted passage on an accent rule, then the remark and its replies, then Reply, Resolve and delete.
- **In the source**, a commented passage is tinted with the accent and underlined; the picked one is tinted more strongly. A misspelled word has a wavy accent underline, and its corrections open as a small menu under the word.
- **The source toolbar** has a speech-bubble button for commenting on the selection.
- **The table button** in the source toolbar opens a small grid; moving over it, or the arrow keys, chooses rows by columns, and a click or Enter inserts the table.
- **An editable table** in visual mode has a one-line tool bar above it, shown while the pointer or the keyboard is in the table: Merge, Split, the two divisions, rows, columns, alignment, Borders, Caption, Edit source. The same actions are on its right-click menu (Shift+F10 from the keyboard). Cells with no rule between them are separated by a faint dashed line that is not in the PDF; real rules are solid. The cell being typed in shows its LaTeX in the source typeface; selected cells are tinted with the accent.
- **Visual mode** draws read-only tables as plain ruled grids, figures as the picture on a quiet card, and citations as a quiet chip reading author and year.
- **Review** offers "Edit by hand" under each text conflict.

- **The mark.** The top bar and start screen show the Emquad mark beside the wordmark; the mockup predates the logo.
- **Code / Visual switch** as in the mockup. Beside it, **Changes** opens History on the working copy.
- **No mode menu.** Change tracking is always derived from versions, so there is no editing mode to choose.
- **Review panel.** It has a second key, "Start this review over". Automatic merges show accept and reject as a pressed pair, and a rejected one is struck through.
- **File tree rows** have a "···" menu for rename, delete, and set as main file; the main file carries a "Main" tag.
- **History** has no "Files in this version" list of everything, only the files that changed, each tagged Added, Edited or Removed.
- **A start screen** (new project, open folder, open bundle, recent projects) and a first-run prompt for the user's name exist in the app and not in the mockup.
- **Panels resize** by dragging the gaps between the file panel, the source and the PDF (or with the arrow keys when a gap has focus). The widths are remembered per project.

## What the mockup fakes

So nobody mistakes these for specifications:

- The page on the right is HTML, not a rendered PDF.
- Line and column numbers, conflict line numbers and version entries are static sample content.
- Menus, the Layout button, zoom, page navigation, tabs, search and settings do nothing.
- "Lina" and the Gaussian-integral paper are sample data.
- Panels are not resizable.
