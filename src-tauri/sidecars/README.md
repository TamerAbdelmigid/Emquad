# Sidecars

Helper programs Emquad starts as separate processes. They are not checked in.

| File | What | Where from |
|---|---|---|
| `tectonic.exe` | The bundled LaTeX compiler (MIT) | https://github.com/tectonic-typesetting/tectonic/releases |
| `texlab.exe` | The LaTeX language server (GPL-3.0, run as a separate program) | https://github.com/latex-lsp/texlab/releases |

Run `scripts/fetch-sidecars.ps1` from the repository root to download them. Without `tectonic.exe`
here, the app falls back to a `latexmk` found on PATH. Without `texlab.exe` it uses its built-in
completion.
