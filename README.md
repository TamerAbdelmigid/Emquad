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

To compile documents the app needs a LaTeX engine. It uses the bundled Tectonic if present, otherwise a `latexmk` found on PATH. To fetch Tectonic into `src-tauri/sidecars/`:

```bash
pwsh scripts/fetch-sidecars.ps1
```

## Check it

```bash
pnpm verify
```

runs type-check, lint, the TypeScript unit tests, `cargo fmt --check`, `cargo clippy` and the Rust tests. One Rust test compiles a real document and is skipped on a machine with no LaTeX engine.

`scripts/e2e.js` drives the real app window through compile, source/PDF lookup, export, import and a merge with a conflict. How to run it is at the top of that file.

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
