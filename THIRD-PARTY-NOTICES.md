# Third-party notices

Emquad itself is under the MIT licence (`LICENSE`). It is built from, and ships with, software and fonts made by other people. This file lists what is included in the installed app and under which licence. Each project's full licence text is available at the address given, and in the package's own files in this repository's dependency folders.

## Programs shipped beside the app

These are separate executables in the `sidecars` folder of the installed app. Emquad starts them and exchanges data with them; they are not part of the Emquad executable.

| Program | What it does | Licence | Source |
|---|---|---|---|
| Tectonic | Compiles LaTeX to PDF | MIT | https://github.com/tectonic-typesetting/tectonic |
| texlab | LaTeX language server | GPL-3.0 | https://github.com/latex-lsp/texlab |

texlab is distributed unmodified under the GNU General Public License, version 3. Its complete source code is available from the address above for the version recorded in `README.md`. The licence of texlab applies to texlab only.

Tectonic downloads LaTeX packages, classes and fonts from its package bundle when a document first needs them. Those files carry their own licences, mostly the LaTeX Project Public License. When you export a bundle with its LaTeX packages, copies of those files, unchanged, travel inside it under the same licences.

Pandoc, which Send to Word and Open a Word file use, is not shipped with Emquad. Users install it themselves from pandoc.org, under its own licence (GPL-2.0 or later), and Emquad runs it as a separate program.

## Compiled into the app

| Component | Licence | Source |
|---|---|---|
| Tauri, wry, tao | MIT or Apache-2.0 | https://github.com/tauri-apps |
| libgit2 (through the `git2` crate) | GPL-2.0 with a linking exception that permits use in programs under any licence | https://github.com/libgit2/libgit2 |
| `git2`, `similar`, `zip`, `flate2`, `regex`, `notify`, `serde`, `uuid`, `chrono`, `tempfile`, `thiserror`, `ts-rs`, `lopdf` and their dependencies | MIT or Apache-2.0 (some dual, some BSD or Zlib) | https://crates.io |
| React | MIT | https://github.com/facebook/react |
| CodeMirror 6 and its packages | MIT | https://github.com/codemirror |
| PDF.js | Apache-2.0 | https://github.com/mozilla/pdf.js |
| KaTeX | MIT | https://github.com/KaTeX/KaTeX |
| Zustand | MIT | https://github.com/pmndrs/zustand |
| nspell | MIT | https://github.com/wooorm/nspell |
| English word lists (`dictionary-en`, `dictionary-en-gb`), from SCOWL and the Hunspell en_US and en_GB dictionaries | MIT and BSD | https://github.com/wooorm/dictionaries |
| French word list (`dictionary-fr`), from Dicollecte's Hunspell dictionary | MPL-2.0 | https://github.com/wooorm/dictionaries/tree/main/dictionaries/fr |
| Spanish word list (`dictionary-es`), from the LibreOffice Spanish dictionary; offered under GPL-3.0, LGPL-3.0 or MPL-1.1, and used here under MPL-1.1 | MPL-1.1 | https://github.com/wooorm/dictionaries/tree/main/dictionaries/es |
| Dutch word list (`dictionary-nl`), from OpenTaal; offered under BSD-3-Clause or CC-BY-3.0, and used here under BSD-3-Clause | BSD-3-Clause | https://github.com/wooorm/dictionaries/tree/main/dictionaries/nl |
| Russian word list (`dictionary-ru`), by Alexander Lebedev | BSD-3-Clause | https://github.com/wooorm/dictionaries/tree/main/dictionaries/ru |

The exact versions are in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`. To list every Rust dependency with its licence, run `cargo tree --format "{p} {l}"` in `src-tauri`; for the JavaScript ones, `pnpm licenses list`.

### Notices for parts under the BSD licence

`lopdf` reads compressed PDFs with `brotli-decompressor`, `alloc-no-stdlib` and `alloc-stdlib` (Copyright (c) 2016 Dropbox, Inc. All rights reserved.), and decodes text with `encoding_rs`, whose data comes from the WHATWG Encoding Standard (Copyright © WHATWG (Apple, Google, Mozilla, Microsoft)). Each is distributed under these terms:

> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
>
> 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Fonts

| Font | Used for | Licence | Source |
|---|---|---|---|
| Hanken Grotesk | The interface | SIL Open Font License 1.1 | the `@fontsource/hanken-grotesk` package |
| Geist Mono | Source code and file names | SIL Open Font License 1.1 | the `@fontsource/geist-mono` package |
| DM Mono | Small labels | SIL Open Font License 1.1 | the `@fontsource/dm-mono` package |
| KaTeX fonts | Mathematics in visual mode | SIL Open Font License 1.1 | https://github.com/KaTeX/KaTeX |

## The Windows component Emquad relies on

Emquad displays its interface with Microsoft Edge WebView2, which is part of Windows 11 and is not shipped with Emquad.
