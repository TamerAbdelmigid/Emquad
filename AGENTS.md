# Working in this repository

Rules for anyone, human or agent, changing this project. Read `README.md` first for what the project is and where its documents are.

## Truth surfaces

These are the sources of truth. Code that contradicts them is wrong unless the document is changed in the same branch.

| Question | Source |
|---|---|
| What the app does and does not do | `docs/01-product-spec.md` |
| Stack, module boundaries, command surface | `docs/02-architecture.md` |
| History, bundle format, merge rules and invariants | `docs/03-bundles-and-history.md` |
| How it looks | `mockup/emquad-fieldwork.html`, explained by `docs/04-design-system.md` |
| What to build next and when it is done | `docs/05-implementation-plan.md` |

`mockup/proposal-visual-word.html` is the approved proposal for the page view of visual mode; `docs/04-design-system.md` says which parts are built. Other files in `mockup/` are superseded explorations. Do not build from them.

## Branching

- Never work on `main`. Create a git worktree with its own scoped branch before changing any tracked file.
- Commit and verify inside that worktree.
- Never merge to `main` on your own initiative. When work is complete and verified, summarise it and ask the owner to approve the merge, with evidence: the version and its changelog section, the tier used, the tail of the verifier output, and the reviewer verdict with the commit hash.

## Verifier

The single command that must pass before any merge request is:

```bash
pnpm verify
```

It runs, in order: the version check (`scripts/check-version.mjs`), `cargo fmt --check`, `cargo clippy` with warnings as errors, `cargo test`, TypeScript type-check, lint, and `vitest run`. The Rust tests come before the type-check because `cargo test` regenerates the TypeScript types in `src/ipc/bindings/` that the type-check needs; commit them when they change.

For a change to anything the user sees or to compile, bundles or review, also run the end-to-end script against the real window. The instructions are at the top of `scripts/e2e.js`; the app exits with code 0 when every check passes. For a change to what the keyboard reaches (focus, menus, dialogs, panels), also run the keyboard pass, `scripts/keyboard.mjs`, as its header says.

Before handing over an installer, run `scripts/smoke-release.js` against a release build made with `--features e2e`, then build the installer **without** that feature. The harness must never be in what users install.

Status command:

```bash
git status --short && git log --oneline -5
```

## Versions

Each completed change set, the work of one branch that lands on `main`, gets one version and one dated section at the top of `CHANGELOG.md`, written on the branch before the merge request. Commits along the way do not each get a version, and there is no `Unreleased` section.

- **The number** is `MAJOR.MINOR.PATCH`. A change set that adds something a user can do, or changes or removes what they could do, raises MINOR and sets PATCH to 0; one made only of fixes, speed-ups, documents, tests, refactoring or tidying raises PATCH. MAJOR stays 0 until the owner decides Emquad is 1.0, and changes only on the owner's word. If another branch lands first with the same number, the later one takes the next number, renaming its section and its version commit, before its merge request.
- **The section** is headed `## X.Y.Z - YYYY-MM-DD`, opens with a line saying what the version is about, then lists in plain bullets what a user now sees or can do differently, the way `docs/user-guide.md` would put it. Fixes that a user could have met are listed; internal work is summed up in a line, if at all.
- **The same number** is written in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, the "Current version" line of `README.md`, and the newest changelog heading. `pnpm verify` fails when any of them differ.
- **The commit** that bumps the version and writes its section starts its subject with the version, as in `0.9.0: Show a word count in the status line`. Other commits on the branch do not mention one.
- **Pushing:** `main` goes to `origin` (the private GitHub repository) once the owner has approved a merge and the merged `main` passes `pnpm verify`. Branches are not pushed unless the owner asks. No tags or GitHub releases are made unless the owner asks for one; one made then is an annotated tag `vX.Y.Z` on that version's commit on `main`.

## Tiers

Default to the lite tier. Use the full tier when a change touches any of these, because a defect there can lose a user's writing:

- The `history`, `bundle` or `review` Rust modules.
- Any code path that writes, renames or deletes files in a user's project.
- The `.emquad` manifest or archive layout, or `formatVersion`.
- Path validation or bundle extraction.
- The Tauri capability configuration.

For those areas, the invariants in `docs/03-bundles-and-history.md` must each be covered by an automated test, and the tests must pass.

## Conventions

- **Boundary:** the webview never reads or writes files or starts processes. Add a Rust command instead.
- **Rust:** module logic is plain functions tested without Tauri; the `commands` layer is a thin wrapper. One serialisable error type with a stable `code`.
- **Types across the boundary** are generated from Rust with `ts-rs`, not hand-written twice. A new command is added in three places: `commands.rs`, the `handlers!` list in `lib.rs`, and `src/ipc/api.ts`.
- **Styling:** plain CSS in `src/design/`, built on the custom properties in `tokens.css`. No inline colours in components, no runtime styling library. A colour that differs between themes is a token, defined for all three in `tokens.css` and `themes.css`.
- **Frontend features** do not import one another's internals.
- **User files are sacred:** never write markers or metadata into a project's source files. App data goes in `.emquad/`.
- **No network at runtime** except what the compiler does to fetch LaTeX packages, and Zotero on this computer's own address (`127.0.0.1`), only when the user asks for a citation from it. Pandoc, which the user installs separately, is run only when they ask for a Word file; it may fetch a picture the document names by a web address. Fonts and assets are bundled.
- **Dependencies:** pin exact versions. Check licences against the notes in `docs/02-architecture.md`; texlab must stay a separate process. Anything shipped in the installer is listed in `THIRD-PARTY-NOTICES.md`.
- **Copy:** name things the way a user would ("snapshot", "bundle", "version"), never by their git implementation.

## When the documents are wrong

Change them. Edit the relevant document in the same branch as the code, and call the change out in the summary so the owner can agree or object. Do not let the code and the documents drift.
