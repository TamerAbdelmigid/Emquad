# Emquad

An offline desktop LaTeX editor in the spirit of Overleaf: source on the left, typeset PDF on the right, compile with one click. Collaboration works by exchanging a single `.emquad` file that carries the sources and their history, so the recipient can continue the work and the sender can review and merge what comes back.

The name comes from the em quad, the square blank a typesetter sets between words (`quad` in LaTeX). The logo sheet is `mockup/emquad-logo.html`.

## Status

Design is settled; no application code exists yet. The repository currently holds the approved mockup and the implementation documents.

## Read in this order

| File | What it answers |
|---|---|
| [docs/01-product-spec.md](docs/01-product-spec.md) | What the app does, for whom, and what is out of scope |
| [docs/02-architecture.md](docs/02-architecture.md) | The stack, the process model, modules, and the command surface between UI and backend |
| [docs/03-bundles-and-history.md](docs/03-bundles-and-history.md) | Snapshots, the `.emquad` file format, import, conflict detection, and merge |
| [docs/04-design-system.md](docs/04-design-system.md) | The Fieldwork visual design, layout rules, and component inventory |
| [docs/05-implementation-plan.md](docs/05-implementation-plan.md) | Milestones in build order, each with acceptance criteria |
| [AGENTS.md](AGENTS.md) | Working rules for anyone (human or agent) changing this repository |

## The mockup

[mockup/emquad-fieldwork.html](mockup/emquad-fieldwork.html) is the approved design. Open it in a browser. It shows two screens: the editor, and History (opened from the History button), which also hosts bundle review.

The other files in `mockup/` are earlier explorations that were rejected or superseded. They are kept for reference only; do not build from them.
