# Emquad

An offline desktop LaTeX editor in the spirit of Overleaf: source on the left, typeset PDF on the right, compile with one click. Collaboration works by exchanging a single `.emquad` file that carries the sources and their history, so the recipient can continue the work and the sender can review and merge what comes back.

The name comes from the em quad, the square blank a typesetter sets between words (`\quad` in LaTeX). The logo sheet is `mockup/emquad-logo.html`.

## Status

Version 1 is implemented and runs: projects and files, the editor, compile with errors shown inline, PDF preview, jumping between source and PDF, snapshots and History, bundles, and review with merge. `docs/05-implementation-plan.md` has the exact state of each milestone, including what is not done yet.

## Run it

Prerequisites on Windows: the Rust toolchain (MSVC), the Microsoft C++ build tools, Node.js and pnpm.

```bash
pnpm install
```

```bash
pnpm tauri dev
```

To compile documents the app needs a LaTeX engine. It uses the bundled Tectonic if present, otherwise a `latexmk` found on PATH. With texlab present it also gets hover, go to definition, references and rename. To fetch both into `src-tauri/sidecars/`:

```bash
pwsh scripts/fetch-sidecars.ps1
```

The script takes the latest releases; the app was last verified with Tectonic 0.17.0 and texlab 5.26.0. The first compile of a document downloads the LaTeX packages it uses, so it needs internet once.

## Build the installer

With Tectonic fetched into `src-tauri/sidecars/`:

```bash
pnpm tauri build
```

The installer is written to `src-tauri/target/release/bundle/nsis/`. It installs for the current user, includes Tectonic, and registers `.emquad` files so they open in Emquad. `docs/user-guide.md` is the guide for people using the app, `docs/releasing.md` covers signing, and `THIRD-PARTY-NOTICES.md` lists what the installer contains.

## Check it

```bash
pnpm verify
```

runs type-check, lint, the TypeScript unit tests, `cargo fmt --check`, `cargo clippy` and the Rust tests. One Rust test compiles a real document and is skipped on a machine with no LaTeX engine.

`scripts/e2e.js` drives the real app window through compile, source/PDF lookup, export, import and a merge with a conflict. `scripts/smoke-release.js` checks a release build: the packaged frontend, fonts, PDF viewer and bundled compiler. How to run each is at the top of the file.

## Read in this order

| File | What it answers |
|---|---|
| [docs/01-product-spec.md](docs/01-product-spec.md) | What the app does, for whom, and what is out of scope |
| [docs/02-architecture.md](docs/02-architecture.md) | The stack, the process model, modules, and the command surface between UI and backend |
| [docs/03-bundles-and-history.md](docs/03-bundles-and-history.md) | Snapshots, the `.emquad` file format, import, conflict detection, and merge |
| [docs/04-design-system.md](docs/04-design-system.md) | The Fieldwork visual design, layout rules, and component inventory |
| [docs/05-implementation-plan.md](docs/05-implementation-plan.md) | Milestones in build order, each with acceptance criteria and current state |
| [AGENTS.md](AGENTS.md) | Working rules for anyone (human or agent) changing this repository |

## Layout

| Path | What is there |
|---|---|
| `src-tauri/src/` | The Rust core: `project`, `compile`, `synctex`, `history`, `diff`, `bundle`, `review`, `index`, `settings`, and the thin `commands` layer |
| `src/` | The interface: `app/` (shell, actions, dialogs), `features/` (editor, preview, files, history, start), `design/` (tokens and styles), `ipc/` (typed command wrappers and generated types) |
| `mockup/` | The approved design, [mockup/emquad-fieldwork.html](mockup/emquad-fieldwork.html), and earlier explorations kept for reference |
| `scripts/` | The end-to-end script and the sidecar download script |
