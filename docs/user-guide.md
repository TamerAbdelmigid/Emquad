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
| Left rail | Show or hide the file panel, find in the open file, open History, keyboard shortcuts, settings |
| File tree | Your files. The buttons at its top create a file, create a folder, or add files from disk. The "···" on each row renames, deletes, or sets the main file |
| File outline | The sections of the open file. Click one to go there |
| Source | Where you type. Tabs along the top; a toolbar for undo, headings, bold, italic, tables, symbols and find |
| PDF | The typeset result, with page and zoom controls |

Drag the gaps between the file panel, the source and the PDF to resize them. **Layout** switches between source and PDF together, source only, and PDF only.

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
- **Show changes** in the source toolbar opens History on the working copy for the file you are editing.

## Working with someone else

Emquad has no accounts and no server. You collaborate by sending one file.

### Send your work

1. Press **Export bundle**.
2. Optionally include the compiled PDF and write a note about what to look at.
3. Choose where to save. You get one file ending in `.emquad`. Send it any way you like.

Exporting saves a snapshot, so Emquad remembers exactly what you sent.

### Continue work you received

Open the `.emquad` file with **Import** (or **Open bundle** on the start screen, or by double-clicking the file). If the project is not on your computer yet, Emquad asks where to put it and opens it as a new project with its full history. Work normally, then export a bundle to send back.

### Review what comes back

Import the returned bundle. Emquad opens History with the bundle selected and a review panel showing two kinds of change:

- **Conflicts** are passages that both of you changed since the version you sent. Each shows your text and theirs side by side, with the differing words highlighted. Click the one to keep.
- **Merged automatically** are changes only they made. They are accepted unless you press the ✕ on one to reject it.

**Finish merge** becomes available once every conflict has a choice. It writes the merged files and records the merge in History. Nothing in your files changes until you press it.

If you change your mind, **Start this review over** clears your choices. If you edit your files while a review is open, Emquad will ask you to start the review again, because the merge was worked out against your files as they were.

The state of your project from just before the import is always kept as a version called "Before import from …", so a merge can be undone by restoring it.

## Settings

The gear at the bottom of the left rail: your name, whether saving also compiles, and the editor's text size.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Recompile | Ctrl+Enter |
| Save | Ctrl+S |
| Go to this place in the PDF | Ctrl+Alt+J |
| Go to the source | Double-click in the PDF |
| Find and replace | Ctrl+F |
| Show or hide the file panel | Ctrl+B |
| Save snapshot | Ctrl+Shift+S |
| Open History | Ctrl+Shift+H |
| Export bundle | Ctrl+Shift+E |
| Import bundle | Ctrl+Shift+I |

## Good to know

- **Your files stay plain.** Emquad never writes anything into your `.tex` files except what you type. Its own data is in a hidden `.emquad` folder inside the project; deleting that folder removes the project's history but not your documents.
- **The compiler.** Emquad uses its bundled compiler, Tectonic. It handles most documents, but ones that depend on pdfTeX-only features or on running external programs (for example the `minted` package) may not compile. If `latexmk` is installed on your computer, Emquad falls back to it when Tectonic is not available.
- **File names.** Files whose names contain `~` followed by a digit (such as `notes~1.tex`), and folders named `.git` inside the project, are left alone by Emquad: they are not listed and not saved in versions.
- **One project at a time.** Opening another project closes the current one.
