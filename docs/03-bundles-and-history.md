# Bundles and history

This document defines how versions are stored, what a `.emquad` file contains, and how an incoming bundle is compared, reviewed and merged. This is the part of the app where a mistake loses someone's writing, so the rules here are reemquadments, not suggestions.

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

## When snapshots are taken

| Trigger | Kind | Label |
|---|---|---|
| User presses Save snapshot | snapshot | what the user typed, default "Draft N" |
| Export bundle | export | "Exported" plus the recipient note's first line, if any |
| Immediately before an import is reviewed | automatic | "Before import from <author>" |
| Immediately before a restore | automatic | "Before restoring <label>" |
| Finish merge | merge | "Merged bundle from <author>" |

Automatic snapshots are skipped when the working copy is identical to the current head. They are shown in History, visually quieter than named snapshots.

## Change tracking is derived, never stored

The app does not record edits as they are typed and does not put markers in source files. Every "tracked change" the user sees is the result of comparing two versions:

- **In History:** the selected version compared with its parent (or, for a bundle, with the common ancestor).
- **In the editor's changes mode:** the working copy compared with a chosen snapshot, by default the current head.
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
history/                 a bare git directory containing one packfile and its refs
tree/                    the head version's files, as plain files
output/<name>.pdf        optional: the compiled PDF at export time
packages/                optional, later: LaTeX package cache for offline compile
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
  "includes": { "history": true, "pdf": true, "packages": false }
}
```

Rules:

- `formatVersion` is an integer. A reader refuses a bundle whose `formatVersion` is higher than it understands and says so plainly. Additive fields do not bump it.
- `project.id` is how a bundle is matched to a project on the recipient's machine.
- `head` must exist in `history/`; `tree/` must match it. A reader verifies both and rejects a bundle that fails.

### Export

1. Save all open buffers.
2. Take an export snapshot (see table above).
3. Write the history reachable from the new head into a single packfile inside a fresh bare git directory.
4. Write `tree/` from the head version, the PDF if requested and present, and the manifest.
5. Write the zip to a temporary file next to the destination, then rename it into place, so a failed export never leaves a truncated file.

The option to exclude history exists in the dialog but defaults to on and warns when turned off: a bundle without history can be opened as a new project but cannot be merged back.

### Import

1. Read and validate the manifest. Extract to `.emquad/incoming/<bundleId>/` under the safety rules in `02-architecture.md` (no absolute paths, no `..`, no links, size ceiling).
2. **No project with this `project.id` is known:** offer to create a new project from the bundle. Its `history.git` is initialised from the bundle's history and its files from `tree/`. Done.
3. **A matching project exists:** fetch the bundle's history into that project's `history.git` under `refs/bundles/<bundleId>`. Then start a review (next section).
4. **A matching project exists but the bundle has no history, or shares no common ancestor:** do not attempt a merge. Offer to open it as a separate new project instead, and explain why.

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

- Use libgit2's merge machinery (`git2`) to obtain B and to perform the per-file three-way merge with diff3-style output, so each conflict carries base, ours and theirs text. Derive the hunk list from that result.
- If conflict markers are used as an intermediate representation, configure a long marker length and treat any input file that already contains that marker sequence as a whole-file conflict rather than parsing it.
- A review session is held in memory and persisted under `.emquad/incoming/<bundleId>/review.json` so that closing the app mid-review loses no decisions.

### Decisions

- Each conflict accepts `mine` or `theirs`. (A third option, edit by hand, can be added later; it would open the passage in the editor with both versions and is not reemquadd for version 1.)
- Each automatic merge accepts `accept` (default) or `reject`. Reject restores B's text for that hunk.
- Finish merge is enabled only when every conflict has a decision.

### Finish merge

1. Compute the merged content of every affected file from the decisions.
2. Write those files to the working copy. Write each file to a temporary file and rename it into place.
3. Record a merge version whose two parents are O and T.
4. Remove the review session and the extracted bundle directory. The `refs/bundles/<bundleId>` ref stays, so History can still show what the bundle contained.

### Cancel

Discard the review session. The working copy is exactly as it was. The automatic snapshot taken at the start remains in History and is harmless.

## Restore

Restoring a version takes an automatic snapshot of the working copy if it differs from head, then makes the working copy's tracked files identical to the chosen version (including deleting files that the version does not contain), and records a new snapshot labelled "Restored <label>". History is never rewritten; restore only adds versions.

## Invariants

These must hold after every operation and are the basis of the test suite for this area.

1. **No silent loss.** For every hunk classified as a conflict, the user's explicit decision determines the result. No text from O or T is dropped without either a decision or the "same change" rule.
2. **Recoverability.** Before any operation that overwrites working-copy files (finish merge, restore), a version exists from which the pre-operation state can be restored byte for byte.
3. **Cancel is a no-op.** After cancelling a review, every working-copy file is byte-identical to before the import began.
4. **Source files stay clean.** No operation writes anything into a user file other than content that came from O, T or B.
5. **Round trip.** Exporting a project and importing the bundle as a new project yields byte-identical files and an identical version graph.
6. **Idempotent import.** Importing the same bundle twice does not create duplicate versions; the second import reopens or reports the existing review or merge.
7. **Line endings and encoding are preserved.** Files are treated as bytes for storage. Disable git's automatic line-ending conversion for `history.git`. Diffing treats text as UTF-8 and falls back to whole-file comparison if decoding fails.

## Test plan for this area

- **Unit:** classification of hunks for hand-written B/O/T triples covering every row of the classification table and every whole-file case.
- **Property-based:** generate random B, apply random independent edits to get O and T, run the merge with random decisions, and assert invariants 1, 3 and 4. Assert that when edits touch disjoint lines there are no conflicts and the result contains both sets of edits.
- **Round trip:** invariant 5 on projects with nested folders, binary files, CRLF and LF files, non-ASCII file names and an empty file.
- **Hostile input:** bundles with path traversal entries, a `head` not present in history, a `tree/` that disagrees with `head`, a future `formatVersion`, and a truncated zip. Each must be rejected with a specific error and leave the project untouched.
