# Sidecars

Helper programs Emquad starts as separate processes. They are not checked in.

| File | What | Where from |
|---|---|---|
| `tectonic.exe` | The bundled LaTeX compiler | https://github.com/tectonic-typesetting/tectonic/releases |

Run `scripts/fetch-sidecars.ps1` from the repository root to download them. Without `tectonic.exe`
here, the app falls back to a `latexmk` found on PATH.
