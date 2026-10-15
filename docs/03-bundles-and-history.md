# Bundles and history

This document defines how versions are stored, what a `.emquad` file contains, and how an incoming bundle is compared, reviewed and merged. This is the part of the app where a mistake loses someone's writing, so the rules here are requirements, not suggestions.

## Model

- A **version** is a complete state of the project's files at a moment, with an author, a time and a description. Versions form a graph: each has one parent (an ordinary snapshot), two parents (a merge), or none (the first).
- The **working copy** is the files on disk right now. It is shown at the top of the History list but is not a stored version until snapshotted.
- A **snapshot** is a version the user (or the app, automatically) recorded.
- A **bundle** is a `.emquad` file: the versions needed to reconstruct one head version, plus that head's files in readable form.

Versions are git commits in `.emquad/history.git`. The user never sees git terminology.

| App concept | Stored as |
|---|---|
| Version | Commit |
| Version id | Commit hash |
| Description | Commit message subject |
| Author | Commit author name; email field holds `<authorId>@emquad.invalid` |
| Kind (snapshot, export, import, merge, automatic) and label | Trailer lines in the commit message |
| Current line of work | Branch `main` |
| An imported bundle awaiting or after review | Ref `refs/bundles/<bundleId>` |

Excluded from every version: `.emquad/` itself, and nothing else. The app does not apply the user's `.gitignore`; a project is small and everything in it is the document.

## File names the app will handle

Windows quietly treats several different spellings as the same file. A crafted name in a bundle could use that to reach a folder it does not appear to name, such as `.git` or the app's own `.emquad`. So one rule decides which names the app deals with at all (`check_component` in `project.rs`). A name is refused if it:

- is empty, `.` or `..`, or contains a control character or any of `< > : " | ? * / \`
- ends with a dot or a space
- is a Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), with or without an extension
- contains `~` followed by a digit, the shape of a Windows short name such as `GIT~1`
- is `.git` in any capitalisation, at any depth

The rule applies everywhere a path enters: commands from the interface, entries in a bundle's archive, and every path in every version of a bundle's history. In the user's own folder, entries that fail it are left completely alone: not listed, not stored in versions, never deleted.

On Windows and macOS, two paths that differ only in capital letters cannot both exist. Any operation that would need them to (a checkout, a merge result, a bundle's archive) is refused before it changes anything.

## When snapshots are taken

| Trigger | Kind | Label |
|---|---|---|
| User presses Save snapshot | snapshot | what the user typed, default "Draft N" |
| Export bundle | export | "Exported" plus the recipient note's first line, if any |
| Immediately before an import is reviewed | automatic | "Before import from <author>" |
| Immediately before a restore | automatic | "Before restoring <label>" |
| Finish merge | merge | "Merged bundle from <author>" |
| Immediately before a file or folder is deleted | automatic | "Before deleting <path>" |
| After a save, when the latest version is ten minutes old or more | automatic | "Saved while writing" |

Automatic snapshots are skipped when the working copy is identical to the current head. They are shown in History, visually quieter than named snapshots.

## Change tracking is derived, never stored

The app does not record edits as they are typed and does not put markers in source files. Every "tracked change" the user sees is the result of comparing two versions:

- **In History:** the selected version compared with its parent (or, for a bundle, with the common ancestor).
- **In the editor's changes mode:** the working copy compared with a chosen snapshot, by default the latest version the user made: automatic versions are passed over, so that the changes since the last snapshot, export or merge read as a whole. With none yet, the current head.
- **In review:** a three-way comparison, defined below.

"Accept" means keep the new text. "Reject" means put back the old text for that hunk. Both are ordinary edits to the working copy.

This is what makes single-file exchange robust: a collaborator's changes are always recoverable from the two versions, whatever tool they used to edit.

## Diff granularity

1. Compare files **line by line** to find hunks. This is what git does and what the merge relies on.
2. Inside each changed hunk, compare **word by word** for display, so that a one-word edit in a long paragraph highlights one word. LaTeX prose is often one paragraph per line, so step 2 is essential for readability.

Word-level detail is presentation only. Decisions (accept, reject, keep mine, keep theirs) apply to whole line-level hunks.

Binary files (images, PDFs) are compared by content hash only: changed or not.

## The `.emquad` file

A zip archive with this layout:

```
manifest.json
history/objects.pack     every version reachable from the head, as one git packfile
tree/                    the head version's files, as plain files
output/<name>.pdf        optional: the compiled PDF at export time
comments.json            optional: the project's comments
packages/                optional: the LaTeX package files, for compiling with no internet
  hashes/<source>          which package source a name stands for (a 64-digit digest)
  data/<digest>.index      the list of what that source holds
  data/<digest>/<file>     one package file, class or font
```

`tree/` duplicates what `history/` can reconstruct. It is there so the bundle is useful without the app: unzip it and the sources are right there.

### manifest.json

```json
{
  "formatVersion": 1,
  "app": { "name": "Emquad", "version": "<app version>" },
  "bundleId": "<uuid>",
  "createdAt": "<RFC 3339 timestamp>",
  "project": { "id": "<uuid>", "name": "gaussian-integral", "mainFile": "main.tex", "engine": "tectonic" },
  "author": { "id": "<uuid>", "name": "Lina" },
  "head": "<commit hash of the exported version>",
  "note": "Tightened the proof wording and added a reference.",
  "includes": { "history": true, "pdf": true, "packages": false, "comments": false }
}
```

Rules:

- `formatVersion` is an integer. A reader refuses a bundle whose `formatVersion` is higher than it understands and says so plainly. Additive fields do not bump it: `includes.comments`, `comments.json` and `packages/` were added this way, and a reader that predates them ignores them.
- `project.id` is how a bundle is matched to a project on the recipient's machine.
- `head` must exist in the history; `tree/` must match it. A reader verifies both and rejects a bundle that fails.
- `project.mainFile` must be a safe path inside the project.
- Every path in every version of the history must pass the file-name rule above, because any of those versions can later be restored.

### Export

1. Save all open buffers.
2. Take an export snapshot (see table above).
3. Write the history reachable from the new head into a single packfile.
4. Write `tree/` from the head version, the PDF if requested and present, the comments and packages if requested, and the manifest.
5. Write the zip to a temporary file next to the destination, then rename it into place, so a failed export never leaves a truncated file.

History is always included. A bundle without it could not be merged back, so the dialog shows it as a fixed part of the bundle rather than a choice.

### Import

1. Read and validate the manifest. Extract to `.emquad/incoming/<bundleId>/` under the safety rules in `02-architecture.md` (no absolute paths, no `..`, no links, size ceiling).
2. **No project with this `project.id` is known:** offer to create a new project from the bundle. Its `history.git` is initialised from the bundle's history and its files from `tree/`. The project is made in a temporary folder beside the one chosen and moved there whole once it is complete, so an import that fails leaves the chosen folder, and anything put in it meanwhile, as it was. Done.
3. **A matching project exists:** fetch the bundle's history into that project's `history.git` under `refs/bundles/<bundleId>`. Then start a review (next section).
4. **A matching project exists but the bundle has no history, or shares no common ancestor:** do not attempt a merge. Offer to open it as a separate new project instead, and explain why.

## LaTeX packages in a bundle

Tectonic keeps every package file, class and font it has fetched in a store on disk, shared by all projects. A bundle can carry a copy of that store, so its recipient can compile with no internet.

**What is carried.** From the store the project compiles from: the source records, their indexes, and the data files compiling this project reads. Tectonic does not report which files a compile reads, so Emquad finds out: it shows Tectonic the store as a bundle served on this computer's own address (127.0.0.1, an ephemeral port, reachable from nothing else), compiles the project in a scratch folder against it, building the format from nothing, and notes each file asked for. That set is then checked to compile with the network blocked, like any set. When it cannot be told (the store has more than one source, the compile fails, or something not in the store is asked for) or the smaller set does not compile, every package file the store holds is carried, as before. The export dialog shows the largest the packages can be. More than 512 MB of package files is refused before anything is checked or written, since the recipient refuses a bundle over 1 GiB. A file whose name fails the file-name rule is left out. The compiled *format* Tectonic keeps beside the store is never carried: it is a memory image the engine loads, and it is rebuilt from the package files in a second or two.

**The promise is checked.** Before a bundle with packages is written, the package files are copied to a scratch folder and the project is compiled from that copy, with fetching switched off. If that fails, the export is refused with an explanation. The bundle is then written from the same copy, so what it carries is byte for byte what was checked; the export code accepts package files in no other way. No other compile runs between the check and the writing, and the project's files are looked at again once the bundle is written and before it is put in place: if any changed, the bundle is not kept and a file that was already at the destination stays as it was. A bundle never claims to compile offline unless it has just been shown to. The compiles that find and check the packages are stopped after five minutes and count as failing; the server that shows the store to Tectonic refuses a request for more than 64 MB at once, and stops when the check ends however it ends.

**Where they go.** Package files from a bundle are untrusted. They are installed into the project's own store, `.emquad/packages/`, and from then on that project compiles from it instead of from the shared store. They never reach the shared store, so a bundle cannot change what any other project compiles with. Installing:

1. Check the whole `packages/` folder first. Only the three kinds of entry in the layout above are allowed; a digest must be 64 lower-case hexadecimal digits; every source must point at a digest whose index is present; every data folder must belong to a source; no folders inside a data folder. Anything else makes the bundle invalid, and nothing is installed.
2. Add the files, each copied under a temporary name and renamed into place. A package file the project's store already has is never replaced. The source records are written last and do replace what is there, so the project compiles with the packages that came with the work being opened, and a store never points at files that did not arrive. If the project had no store of its own and installing fails, the half-made store is removed and the project goes on compiling from the shared one.
3. Fill the project's store with what the shared store holds for the same source, so that moving the project onto its own store never takes away a package it could use before.

A project with its own store exports from it. If the recipient later needs a package the store lacks, Tectonic fetches it into the project's store when there is a connection.

Packages are installed when a bundle is imported, for a new project and for an existing one alike. They are app data: no file of the project is touched, and cancelling the review leaves them in place.

## Comments

A comment is a remark on a passage of one file, with replies. Comments are kept in `.emquad/comments.json` and are never written into the files they are about.

**Finding the passage.** A comment remembers the words it was made on, about thirty characters either side, and the line. To place it, the editor looks for those words; where they occur more than once, the surroundings decide, then the nearest line. While a file is open the comment follows its passage through every edit, and on save its remembered words are brought up to date. A comment whose words are gone from the file is still listed, without a place.

**State.** A comment is open or resolved. A reply reopens it. A deleted comment stays in the file as an empty marker, so that a bundle still carrying it cannot bring it back.

**Merging.** Comments travel in a bundle as `comments.json` and are combined with the recipient's when the bundle is imported, for every comment by its identifier:

- A comment only one side has is kept.
- For a comment both have, three things are decided separately:
  - *What it says and its state.* A deletion wins outright. Otherwise the copy whose text or state changed most recently decides.
  - *Where it sits* (file and passage). The copy placed most recently decides. Editing around a comment, or renaming its file, changes only its place, so it can never override someone else's resolve or delete. A passage that merely moved to another line is not a new place.
  - *Replies.* Every reply either copy has is kept, unless the comment is deleted: a deleted comment keeps nothing but its marker. A comment holds at most 500 replies; the limit is applied when replying, never by cutting a thread while merging.

The result is the same whatever the order bundles arrive in, and importing one twice changes nothing. This is a merge of app data, separate from the review: it never asks a question and cannot conflict, and cancelling the review does not undo it.

**From a bundle they are untrusted.** A comment is dropped if its identifier is not plain, its path is not a safe path inside the project, any of its text is over length, or one of its times cannot be read. Times are rewritten to one form (UTC, to the millisecond) before they are compared, and a time in the future is brought back to now, so a bundle cannot make its copy win for ever. (A sender whose clock runs ahead therefore has their comments stamped with the time of import, each time the bundle is imported.) A single comment may arrive with up to 10,000 replies, well above what one person can add, so a thread that two people filled still travels. The file is ignored if it is larger than 4 MB. Comment text is only ever shown as plain text.

## Review and merge

### Inputs

- **Ours (O):** the working copy, captured as an automatic snapshot at the start of review.
- **Theirs (T):** the bundle's head.
- **Base (B):** the most recent common ancestor of O and T in the version graph (git's merge base).

### Classification

Run a three-way merge of B, O and T per file. Every line-level hunk falls into exactly one class:

| Class | Meaning | Default outcome | Shown in review as |
|---|---|---|---|
| Unchanged | Neither side changed it | Keep | Not shown |
| Ours only | Only we changed it since B | Keep ours | Not shown |
| Theirs only | Only they changed it since B | Take theirs | "Merged automatically", rejectable |
| Same change | Both made the identical change | Take it | Not shown |
| **Conflict** | Both changed the same lines differently | **None; the user must decide** | "Conflict": keep mine / keep theirs |

Whole-file cases follow the same logic: a file added by them is "theirs only"; a file deleted on one side and edited on the other is a conflict; a binary file changed on both sides is a conflict resolved by choosing one whole file.

If B equals O (we made no changes since the hand-off), there are no conflicts and every difference is "theirs only". The review panel still appears so the user sees what is coming in.

### Implementation guidance

- libgit2 (`git2`) finds B. The per-file three-way comparison is `diff3` in `src-tauri/src/diff.rs`, built on line diffs from the `similar` crate; it returns structured chunks, so no conflict markers are ever written or parsed.
- Changes from the two sides that overlap **or touch** (adjacent lines, or insertions at the same point) are treated as one conflict. Some of these could be merged automatically, but asking can never drop text silently.
- A review session is held in memory and persisted under `.emquad/incoming/<bundleId>/review.json` so that closing the app mid-review loses no decisions.

### Decisions

- Each conflict accepts `mine`, `theirs`, or text the user writes for that passage. The hand-written text takes the place of a decision; choosing a side afterwards discards it. The written text is given the file's own line endings, and if the passage ended its line the text is made to end its line too, so the next line is never joined on. Whole-file items (a file added, deleted or not text) are a choice between files and cannot be rewritten.
- Each automatic merge accepts `accept` (default) or `reject`. Reject restores B's text for that hunk.
- Finish merge is enabled only when every conflict has a decision. It is refused if the working copy changed after the review began, because the merge was computed against the state captured then; the user starts the review again.

### Finish merge

1. Compute the merged content of every affected file from the decisions. Check that the resulting set of files can all be named safely and can exist side by side; if not, refuse and change nothing.
2. Apply removals, then writes. Each file is written to a temporary file and renamed into place. If any step fails, every file is put back as it was when the review began, the review stays open, and the user is told.
3. Record a merge version whose two parents are O and T.
4. Remove the review session and the extracted bundle directory. The `refs/bundles/<bundleId>` ref stays, so History can still show what the bundle contained.

### Cancel

Discard the review session. The working copy is exactly as it was. The automatic snapshot taken at the start remains in History and is harmless.

## Restore

Restoring a version takes an automatic snapshot of the working copy if it differs from head, then makes the working copy's tracked files identical to the chosen version (including deleting files that the version does not contain), and records a new snapshot labelled "Restored <label>". History is never rewritten; restore only adds versions. If the files cannot all be written, they are put back as they were from the snapshot just taken.

## Invariants

These must hold after every operation and are the basis of the test suite for this area.

1. **No silent loss.** For every hunk classified as a conflict, the user's explicit decision, or the text they wrote for it, determines the result. No text from O or T is dropped without either a decision or the "same change" rule.
2. **Recoverability.** Before any operation that overwrites working-copy files (finish merge, restore), a version exists from which the pre-operation state can be restored byte for byte.
3. **Cancel is a no-op.** After cancelling a review, every working-copy file is byte-identical to before the import began.
4. **Source files stay clean.** No operation writes anything into a user file other than content that came from O, T or B, or text the user wrote in the review for that passage.
5. **Round trip.** Exporting a project and importing the bundle as a new project yields byte-identical files and an identical version graph.
6. **Idempotent import.** Importing the same bundle twice does not create duplicate versions; the second import reopens or reports the existing review or merge.
7. **Line endings and encoding are preserved.** Files are treated as bytes for storage. Disable git's automatic line-ending conversion for `history.git`. Diffing treats text as UTF-8 and falls back to whole-file comparison if decoding fails.
8. **Extras stay out of the project and out of other projects.** Installing a bundle's packages and comments changes nothing outside `.emquad/` of the project being imported into. In particular it changes no source file, and no other project's packages.
9. **A bundle that says it carries packages compiles offline.** `includes.packages` is true only if the project was compiled, with fetching off, from exactly the package files in the bundle.
10. **Comments are never lost by merging.** After combining two sets of comments, every comment either side had is present, with every reply unless the comment is deleted; a deleted comment stays deleted; and the result does not depend on the order.

## Test plan for this area

- **Unit:** classification of hunks for hand-written B/O/T triples covering every row of the classification table and every whole-file case.
- **Property-based:** generate random B, apply random independent edits to get O and T, run the merge with random decisions, and assert invariants 1, 3 and 4. Assert that when edits touch disjoint lines there are no conflicts and the result contains both sets of edits.
- **Round trip:** invariant 5 on projects with nested folders, binary files, CRLF and LF files, non-ASCII file names and an empty file.
- **Hostile input:** bundles with path traversal entries, names that alias another file on Windows (in the archive and in an older version of the history), a main file outside the project, a `head` not present in history, a `tree/` that disagrees with `head`, a future `formatVersion`, and a truncated zip. Each must be rejected with a specific error and leave the project untouched.
- **Failure part-way:** a merge and a restore that cannot write one of their files must leave every file as it was.
- **Packages:** a round trip carries the store and installs it in the project's own store without replacing a file already there, and leaves the shared store and every other project byte for byte as they were (invariant 8); an install that fails part-way leaves no store behind; `packages/` laid out in any other way (a format image, a path that climbs out, a Windows device name, a nested folder, a source that names no digest, a data folder no source points at, a stray file) is rejected and installs nothing, for both kinds of import. Against the real Tectonic, with the network blocked: the files the project reads are found and are fewer than the store holds, they alone compile the project, a bundle with packages compiles in a new project from that project's own store, and a document needing a package nobody has is refused at export. The recording server's index and ranges have a unit test of their own.
- **Comments:** kept outside the project's files; follow a renamed file or folder, however the new path was typed; editing around a comment does not undo another person's resolve or delete; malformed, oversized or wrongly timed comments from a bundle are dropped or corrected while the work still arrives; property-based, that merging is the same in any order, any number of times, loses no comment and no reply, and never undoes a deletion (invariant 10).
