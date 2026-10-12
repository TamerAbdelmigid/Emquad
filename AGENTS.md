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

Other files in `mockup/` are superseded explorations. Do not build from them.

## Branching

- Never work on `main`. Create a git worktree with its own scoped branch before changing any tracked file.
- Commit and verify inside that worktree.
- Never merge to `main` on your own initiative. When work is complete and verified, summarise it and ask the owner to approve the merge, with evidence: the tier used, the tail of the verifier output, and the reviewer verdict with the commit hash.

## Verifier

The single command that must pass before any merge request is:

```bash
pnpm verify
```

It runs, in order: TypeScript type-check, lint, `vitest run`, `cargo fmt --check`, `cargo clippy` with warnings as errors, and `cargo test`. `cargo test` also regenerates the TypeScript types in `src/ipc/bindings/`; commit them when they change.

For a change to anything the user sees or to compile, bundles or review, also run the end-to-end script against the real window. The instructions are at the top of `scripts/e2e.js`; the app exits with code 0 when every check passes.

Before handing over an installer, run `scripts/smoke-release.js` against a release build made with `--features e2e`, then build the installer **without** that feature. The harness must never be in what users install.

Status command:

```bash
git status --short && git log --oneline -5
```

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
- **Styling:** plain CSS in `src/design/`, built on the custom properties in `tokens.css`. No inline colours in components, no runtime styling library.
- **Frontend features** do not import one another's internals.
- **User files are sacred:** never write markers or metadata into a project's source files. App data goes in `.emquad/`.
- **No network at runtime** except what the compiler does to fetch LaTeX packages. Fonts and assets are bundled.
- **Dependencies:** pin exact versions. Check licences against the notes in `docs/02-architecture.md`; texlab must stay a separate process.
- **Copy:** name things the way a user would ("snapshot", "bundle", "version"), never by their git implementation.

## When the documents are wrong

Change them. Edit the relevant document in the same branch as the code, and call the change out in the summary so the owner can agree or object. Do not let the code and the documents drift.
