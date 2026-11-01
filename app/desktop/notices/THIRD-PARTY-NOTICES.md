# Third-party software in the Chausar beta installer

The Chausar beta installer for Windows and the Linux AppImage and tar.gz carry the software below besides Chausar itself. Each licence text sits next to this file, in the folder named. In an installed app this folder is `resources/notices`; the bundled Codex also keeps its own `LICENSE` and `NOTICE` in `resources/codex`.

Chausar bundles Codex so the owner can connect their own ChatGPT plan without installing anything else. Chausar is not endorsed by OpenAI, and it is not made by or affiliated with OpenAI. Codex runs only with the owner's own sign-in, started through Codex's own login.

## OpenAI Codex CLI 0.154.0

- What: the `codex` program and its helper programs, copied unchanged from the official `@openai/codex` npm package for this computer's platform (`bin`, `codex-resources`, `codex-path`, `codex-package.json`).
- Source: https://github.com/openai/codex, release tag `rust-v0.154.0`.
- Licence: Apache License 2.0. Files: `codex/LICENSE` and `codex/NOTICE`, byte for byte the files in that repository at that tag (the npm package itself carries no licence files).

## Ratatui (inside Codex)

- Named in the Codex `NOTICE`: Codex includes code derived from Ratatui.
- Source: https://github.com/ratatui/ratatui
- Licence: MIT. File: `ratatui/LICENSE`.

## ripgrep 15.2.0 (inside Codex, `codex-path/rg`)

- Source: https://github.com/BurntSushi/ripgrep, tag `15.2.0`.
- Licence: dual Unlicense or MIT, at the user's choice. Files: `ripgrep/COPYING`, `ripgrep/LICENSE-MIT` and `ripgrep/UNLICENSE`.

## PCRE2 10.45 (inside ripgrep)

- The bundled ripgrep is built with PCRE2 10.45.
- Source: https://github.com/PCRE2Project/pcre2, tag `pcre2-10.45`.
- Licence: BSD-3-Clause with the PCRE2 exception. File: `pcre2/LICENCE.md`.

## Electron 44.4.5 and Chromium

- The app window. The packager places Electron's own `LICENSE.electron.txt` and Chromium's `LICENSES.chromium.html` in the app folder, next to the Chausar program.

## Node packages

- The packages the engine uses at run time are carried in `resources/app.asar.unpacked/node_modules`, each with the licence file it was published with.

## Installer

- The Windows installer is built with NSIS (zlib licence) through electron-builder. The Linux AppImage uses the AppImage runtime (MIT).
