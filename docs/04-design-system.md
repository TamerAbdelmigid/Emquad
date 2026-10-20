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
| Toggle file panel | Ctrl+Shift+B |
| Bold, italic, underline | Ctrl+B, Ctrl+I, Ctrl+U |
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
- **An editable table** in visual mode has a one-line tool bar above it, shown while the pointer or the keyboard is in the table: Bold and Italic; the three alignments, the current one lit; Insert, Delete, Split and Borders as menus that open below their button, with a tick beside what is in force; Merge, Caption and Source. Each tool has an icon and, when the pane is wide enough, a word; in a narrow pane only the icons show, so the bar keeps to one line. The actions are also on the right-click menu (Shift+F10 from the keyboard), which lists only what can be done there. Faint handles above the columns, before the rows and at the top left corner appear while the pointer is over the table; pointing at one lights it in the accent and shows a round accent + on its edge for inserting a row or column there. Cells with no rule between them are separated by a faint dashed line that is not in the PDF; real rules are solid. The cell being typed in shows its LaTeX in the source typeface; selected cells are tinted with the accent.
- **Visual mode** draws read-only tables as plain ruled grids, figures as the picture on a quiet card, and citations as a quiet chip reading author and year.
- **The page view** (visual mode's default look since 0.15.0) follows the proposal approved by the owner on 19 October 2026, [mockup/proposal-visual-word.html](../mockup/proposal-visual-word.html), for what 0.15.0 builds of it. The source panel becomes a light module: the file tabs, then a ribbon (tabs Home, Insert, Layout and View since 0.17.0, each a row of groups with a micro-label under them; the Code / Visual switch and Changes on the right of the tab row), then the page, then a status line. The page is a white sheet (`--paper`, white in every theme, as the PDF is) on the panel's well, as wide as the document's paper, with its margins and a shadow; text is set in KaTeX's Computer Modern face (`--page-serif`), or the document's Times, Palatino or sans. There are no line numbers and no current-line fill. Headings are bold and black, as LaTeX sets them. A tooltip on every tool is a dark card: the tool's name and keys, then the LaTeX it writes in the source typeface, then at most one sentence where LaTeX works differently from Word. The status line holds the word count, the LaTeX path as a dark readout (the last step in the accent), and the zoom. Ribbon tools are 28 px keys, or 54 px tall ones with a word under the icon; a pressed tool is a dark key. Draft keeps the dark source screen and toolbar.
- **Formats like Word** (0.16.0) builds the proposal's Home tab, except Typeface and Size, Styles' Title and Code entries and its More styles menu, and Find's Replace and Select buttons. Clipboard is a tall Paste key, a column with Cut, Copy and Paste options, and the format painter. Font and Paragraph are groups of two rows of 28 px keys: B, I, U, S, x₂, x², Sc over Emphasis, Typewriter, Highlight (its icon on a yellow bar), Font colour (an A on a blue bar, opening the palette with a swatch for each colour) and Clear formatting; Bullets, Numbering with its format menu, Decrease and Increase indent and LaTeX marks over the four alignments and Line spacing. A tool is pressed when the text at the cursor has its format, list or alignment. The styles gallery adds Quote and Abstract. Over a selection made with the mouse floats a small toolbar, a pop-over card of the same keys; a right-click opens a menu in the style of the menus elsewhere, with each item's keys. The painter, while it holds formatting, shows a dark note at the bottom of the window and a copy pointer over the page. On the page, strikethrough, sub- and superscript, small capitals, highlight (`--ink-hl`) and colours (`--ink-*`, the palette's six and xcolor's common names, the same in every theme, as the PDF is) are drawn as they print; centred, right and left paragraphs are aligned, a quotation and the abstract are indented on both sides, the abstract smaller under its bold heading. LaTeX marks draw a command's hidden text in place, in the source face at 62 % in the page's grey, and an environment's name at the top of its first line in the left margin.
- **Lays out like Word** (0.17.0) builds the proposal's Layout tab, except Hyphenation, Wrap text, Kind of document and the Line spacing menu (which stays on Home), and adds the Insert tab's Header & Footer group and the contextual Picture tab. Page setup is a row of tall keys that open menus, Margins, Orientation, Size and Columns, each with a tick beside the choice in force, then a column with Breaks and Line numbers (pressed while the lines are numbered); Paragraph · whole document holds First line and Text size as small menus naming the setting; Arrange holds Position; Document holds Document setup. Header & Footer is a column of Header, Footer and Page number. The Picture tab's name is in the accent text colour, as a contextual tab, and it shows only while the cursor is in a figure: Size · of the line has three tall keys showing ½, ⅘ and 1 in the source face, the one in force pressed; Arrange holds Position; Picture holds Source. On the page, a break the last compile made is a band of the panel's well, 30 px high, shaded at its edges as a gap between two sheets, labelled in the micro-label style "Page 2 · where the last compile began it"; above it the page's foot holds the footer's text centred and the page number on the right (or the number alone, centred), below it the next page's top holds the header on the right, both in the page's face at 80 % in `--paper-mu`. The first page's header sits in its top margin and the last page's footer under the text.
- **Refers like Word** (0.18.0) builds the proposal's References tab, except Endnote, Next footnote, Manage sources, Mark entry, Insert index and Acronym, and its Review tab, except Spelling and Language; the Insert tab's Links group becomes a column of Link, Bookmark and Cross-reference. Show changes is a tall key opening the list of snapshots, with a tick beside the one shown; Keep, Undo change and Next stand in a column beside it, greyed while no change is shown. On the page, a link is drawn in `--ink-royalblue`, underlined; a change since a snapshot is underlined (what went in) or struck through (what went out) in the author's colour, `--mine` or `--theirs`, with a 2 px bar of that colour at the left of each changed line. Comment balloons stand in a 220 px column 14 px to the right of the page: a card (`--card`) with an accent rule on its left, the author in bold, the words, and the number of replies in `--mu`; the one picked out has a 2 px accent ring. While a file has balloons the page moves left to leave 250 px for them, and is fitted to the pane without them. In the File outline a heading being dragged is faded, and where it would go is marked by an accent line above the heading it would go before, or above "Move to the end".
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
