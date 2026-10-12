# Emquad user guide

Emquad is a LaTeX editor that works without an internet connection or a TeX installation. You write on the left and see the typeset PDF on the right.

## Getting started

1. Start Emquad. The first time, it asks for your name. The name is attached to the snapshots and bundles you make so a collaborator can tell whose changes are whose.
2. Choose **New project**, give it a name, pick a starting document (article, report, exam or letter), and choose where to create it. A project is an ordinary folder; you can also use **Open folder** on any folder of `.tex` files you already have.
3. Press **Recompile** (or Ctrl+Enter). The PDF appears on the right.

The first time a document is compiled, Emquad downloads the LaTeX packages it uses. That needs internet once; after that the document compiles offline.

## The editor screen

| Area | What it is for |
|---|---|
| Top bar | Menus, the project name with compile state and error count, and the History, Layout, Import and Export bundle buttons |
| Left rail | The file panel, search across the project, History, keyboard shortcuts, settings |
| File tree | Your files. The buttons at its top create a file, create a folder, or add files from disk. The "···" on each row renames, deletes, or sets the main file |
| File outline | The sections of the open file. Click one to go there |
| Source | Where you type. Tabs along the top; a toolbar for undo, headings, bold, italic, tables, symbols and find; the Code / Visual switch |
| PDF | The typeset result, with page and zoom controls |

Drag the gaps between the file panel, the source and the PDF to resize them. **Layout** switches between source and PDF together, source only, and PDF only.

### Code and Visual

**Visual** draws your source as a document: section titles as headings, bold and italic as themselves, mathematics typeset, list items as bullets, tables as tables, `\includegraphics` as the picture itself, and citations by author and year (taken from your `.bib` files; a key nobody defines is shown with a question mark). Nothing in the file changes; switch back to **Code** at any time. Whatever the cursor is in is shown as plain source, so you always edit the real text. A formula Emquad cannot preview is shown as its source with a dotted underline; it may still compile.

### Tables

**Insert.** The table button in the toolbar opens a small grid. Move over it (or use the arrow keys) to choose rows and columns, then click (or press Enter). Emquad writes the matching `tabular`.

**Edit.** In **Visual** mode, click a cell and type. What you type is LaTeX, so `$x^2$` and `\textbf{…}` work; a plain `&` or `%` is written as `\&` or `\%` for you. Tab and Shift+Tab move between cells, and Tab in the last cell adds a row. The arrow keys move to the next cell when the cursor is at the edge of the text. Esc stops typing and leaves the cell selected.

**Select cells** by dragging across them, or with Shift and the arrow keys.

**The tools** are in the bar above the table and on its right-click menu (Shift+F10 from the keyboard; Esc then Tab reaches the bar):

| Tool | What it does |
|---|---|
| Merge | Makes one cell of the selected cells. Across a row this is `\multicolumn`, down a column `\multirow`, a block both. Text in the cells is joined, never dropped |
| Split | Gives a merged cell its separate cells back. The text stays in the first |
| Split ↔, Split ↕ | Divides an ordinary cell in two, side by side or one above the other. The other cells in its column or row are widened so that only this cell looks divided |
| Row ↑ ↓ ✕, Col ← → ✕ | Insert or delete rows and columns |
| Left, Centre, Right | Align the selected columns |
| Borders | Draws every border, or removes them all |
| Caption | Adds, changes or (left empty) removes the caption. A table without one is put in a `table` environment to carry it |
| Edit source | Shows the table's LaTeX so you can change it directly. Move the cursor out of it to see the table again |

Every action changes your `.tex` file at once, and **Code** shows exactly what was written. Each action is one step for Undo (Ctrl+Z).

**Merging down a column needs the `multirow` package.** The first time you do it, Emquad adds `\usepackage{multirow}` to the preamble and tells you. If the file you are in has no preamble, because it is included from another file, add that line to your main file yourself; Emquad reminds you.

**Paste from Word or Excel.** Copy a table there and paste it into the editor. Emquad asks whether to paste it as a table; merged cells are kept and characters LaTeX treats specially are escaped. Cancel pastes the plain text.

**Tables Emquad shows but does not edit.** A table that uses something the editor cannot write back exactly, such as a `p{3cm}` column, a table inside a table, a comment, or `tabularx`, is drawn with a note saying why and an **Edit source** link. Emquad never rewrites such a table.

When you edit a table you wrote by hand, Emquad lays its source out its own way, one row to a line. The cells, merges and rules are kept as they were.

### Spelling

Words Emquad does not know are underlined with a wavy line. Only prose is checked: commands, labels, file names, mathematics, comments and the preamble are left alone. Right-click an underlined word, or put the cursor in it and press Ctrl+., to choose a correction or to add the word to your own dictionary. Choose English (US), English (UK) or Off in Settings. The dictionaries are part of the app; nothing you type leaves your computer.

### Comments

Select some text and press the speech-bubble button in the toolbar (Ctrl+Alt+M), write your remark and press **Add comment**. The passage is tinted, and the comment appears in the Comments panel, opened from the speech bubble in the left rail. There you can reply, **Resolve** a comment that is dealt with, reopen it, or delete it. Click a comment to go to its passage; click a tinted passage to see its comment.

Comments are kept beside your project, never inside your `.tex` files, and they follow their passage as you edit around it. They travel in bundles: your collaborator sees your comments and you see their replies when the bundle comes back.

### Searching

The magnifier in the left rail (Ctrl+Shift+F) searches every text file in the project as you type. Click a result to go to that line. Ctrl+F searches and replaces within the open file.

### While typing

- Type `\` to get suggestions for commands. Inside `\ref{` you get the labels in your project; inside `\cite{` you get the keys from your `.bib` files; inside `\begin{` you get environments.
- After `\begin{something}` press Enter and the matching `\end{something}` is added.
- An orange dot on a tab means the file has unsaved changes. Ctrl+S saves, and recompiles if "Compile when saving" is on in Settings.

### When a compile fails

The top bar shows the number of errors, the line is marked in the source, and the previous PDF stays on screen. The page icon next to Recompile opens **Logs and messages**, which lists each error and warning with its file and line, and can show the compiler's full output.

### Moving between source and PDF

- The round arrow between the two panes takes you from the cursor to the matching place in the PDF.
- Double-click anywhere in the PDF to go to the source line that produced it.

## Snapshots and History

A snapshot is a saved version of the whole project that you can return to.

- **Save a snapshot:** File → Save snapshot, or Ctrl+Shift+S. Give it a name such as "Draft 2".
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
2. Choose what else to include: the compiled PDF, your comments, and the **LaTeX packages**. With the packages included, the other person can compile with no internet at all; the bundle is larger (the dialog says by how much), and Emquad first checks that your project really does compile offline from them, which takes a few seconds. Write a note about what to look at.
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

## Settings

The gear at the bottom of the left rail: your name, whether saving also compiles, the editor's text size, the theme (Fieldwork, Glass or Onyx), the spelling language, and the compiler for the open project.

The compiler is **Automatic** unless you change it: Emquad's built-in Tectonic, or `latexmk` if Tectonic is missing. Choose **latexmk** for a document that needs your own TeX installation, for example one that relies on pdfTeX-only features. The choice is saved with the project and travels in its bundles; a compiler that is not on the computer is shown as not found, and compiling with it is refused with a message rather than silently using the other one.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Recompile | Ctrl+Enter |
| Save | Ctrl+S |
| Go to this place in the PDF | Ctrl+Alt+J |
| Go to the source | Double-click in the PDF |
| Find and replace | Ctrl+F |
| Search the project | Ctrl+Shift+F |
| Comment on the selected text | Ctrl+Alt+M |
| In a table: next or previous cell | Tab, Shift+Tab |
| In a table: select cells | Shift+arrow keys |
| In a table: stop typing; then reach the tools | Esc; then Tab |
| In a table: open its menu | Shift+F10 |
| Correct the misspelled word at the cursor | Ctrl+. |
| Suggest completions | Ctrl+Space |
| Go to definition, find references, rename | F12, Shift+F12, F2 |
| Leave the editor with the keyboard | Esc, then Tab |
| Show or hide the file panel | Ctrl+B |
| Save snapshot | Ctrl+Shift+S |
| Open History | Ctrl+Shift+H |
| Export bundle | Ctrl+Shift+E |
| Import bundle | Ctrl+Shift+I |

## Language help

When the footer of the source pane shows **texlab**, the LaTeX language server is running. Completion then knows the packages your document loads, hovering over a command or label shows information about it, F12 goes to where a label or command is defined, Shift+F12 lists where it is used, and F2 renames a label everywhere in the open file. Going to a definition in a file that is not open is not available yet.

## Good to know

- **Your files stay plain.** Emquad never writes anything into your `.tex` files except what you type. Its own data is in a hidden `.emquad` folder inside the project; deleting that folder removes the project's history but not your documents.
- **The compiler.** Emquad uses its bundled compiler, Tectonic. It handles most documents, but ones that depend on pdfTeX-only features or on running external programs (for example the `minted` package) may not compile. If you have a TeX installation, switch such a project to `latexmk` in Settings.
- **Packages that came in a bundle.** A project opened from a bundle that carried LaTeX packages keeps them in its own `.emquad` folder and compiles from there. They are used by that project only.
- **File names.** Files whose names contain `~` followed by a digit (such as `notes~1.tex`), and folders named `.git` inside the project, are left alone by Emquad: they are not listed and not saved in versions.
- **One project and one window at a time.** Opening another project closes the current one. Starting Emquad again, or double-clicking a bundle, uses the window that is already open.
