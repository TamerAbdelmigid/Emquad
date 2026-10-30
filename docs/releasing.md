# Releasing

How to produce the installer, and what is needed before giving it to other people.

## Build

1. Fetch the helper programs: `pwsh scripts/fetch-sidecars.ps1`. Record the versions it prints in `README.md`.
2. Run `pnpm verify`.
3. Run the end-to-end script (instructions at the top of `scripts/e2e.js`).
4. Build a release with the test harness and run the smoke test (instructions at the top of `scripts/smoke-release.js`).
5. Build the installer **without** the harness: `pnpm tauri build`. The result is in `src-tauri/target/release/bundle/nsis/`.
6. Install it and run `scripts/installed-test.ps1` against the installed copy (usage at the top of the script; Windows PowerShell 5 or 7). It opens a recent project, compiles it with the installed Tectonic, and checks that double-clicking a bundle reuses the open window. It puts the user's settings back exactly as they were.
7. Install it on a clean machine and open, compile and export once by hand.

## Publish

The repository is public at https://github.com/TamerAbdelmigid/Emquad, and users download the installer from its Releases page, which the README's Download button opens. A release is made only when the owner asks for one, from the merged `main`:

1. Tag that version's commit on `main` with an annotated tag `vX.Y.Z` and push `main` and the tag.
2. Create the GitHub release from the tag, titled `Emquad X.Y.Z`, with that version's `CHANGELOG.md` section as its notes, and attach `Emquad_X.Y.Z_x64-setup.exe` built without the test harness:

```bash
gh release create vX.Y.Z "src-tauri/target/release/bundle/nsis/Emquad_X.Y.Z_x64-setup.exe" --title "Emquad X.Y.Z" --notes-file notes.md
```

The README's pictures are in `docs/images/`. When a screen they show changes noticeably, take them again from the running app (`scripts/shot.ps1`), without a personal folder name in any path they show.

The version is set by the rule in `AGENTS.md` under "Versions": one for each change set that lands, written in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, the README and the newest `CHANGELOG.md` heading, which `pnpm verify` checks agree. The installer is named after it (`Emquad_X.Y.Z_x64-setup.exe`), and installing a newer one over an older replaces it.

## Signing

The installer is not signed: on 14 October 2026 the owner chose to stay unsigned for now. The steps below are for when that changes. On another person's computer, Windows SmartScreen will warn that the publisher is unknown, and they have to choose "More info" and then "Run anyway". Signing removes the unknown-publisher label; the SmartScreen warning itself fades as a signed app builds reputation, or immediately with an Extended Validation certificate.

Signing needs a code-signing certificate, which has to be bought and is issued to a verified person or organisation. That is a purchase and an identity check only the owner can do. The options:

| Option | What it involves | SmartScreen |
|---|---|---|
| Azure Trusted Signing | A Microsoft subscription billed monthly; identity verified by Microsoft; no hardware token | Trusted quickly |
| OV certificate from a certificate authority | Bought yearly; since 2023 the key must live on a hardware token or cloud HSM | Warns until reputation builds |
| EV certificate | More expensive; stricter verification; hardware token | Trusted immediately |

Once a certificate exists, Tauri signs during `pnpm tauri build`. Add to `bundle.windows` in `src-tauri/tauri.conf.json` one of:

```json
{ "certificateThumbprint": "<thumbprint of the installed certificate>", "digestAlgorithm": "sha256", "timestampUrl": "http://timestamp.digicert.com" }
```

for a certificate in the Windows certificate store (including one on a token), or

```json
{ "signCommand": "trusted-signing-cli -e <endpoint> -a <account> -c <profile> %1" }
```

for Azure Trusted Signing or any other tool that signs the file passed as `%1`. Tauri signs both `emquad.exe` and the installer. Check the result with `Get-AuthenticodeSignature` on the installer.

The two helper programs are shipped as their own projects built them. `tectonic.exe` and `texlab.exe` are not signed by Emquad's certificate unless the build is told to; signing them is allowed by their licences and avoids a second warning from some antivirus tools.

## Licences

`THIRD-PARTY-NOTICES.md` lists everything in the installer. Update it when a dependency that ships to users is added or removed. texlab is GPL-3.0: it must stay a separate, unmodified executable with its source address given, as it is now.
