# Desktop builds and release qualification

Chausar has three packaging paths. The unsigned preview runs the explicitly experimental demo vault. The beta is the free download: real data and the bundled Codex, for Windows, Linux and (since 14 November 2026) macOS; see [The Mac beta build](#the-mac-beta-build) for exactly what state the Mac build is in. The final path keeps the signed-release gate (`scripts/package-preflight.mjs`), which still asks for bundled PostgreSQL and Python distributions ([runtime-binaries/README.md](../runtime-binaries/README.md)); that path has not been exercised. A build that finishes is not proof that a platform works.

| Path | Configuration | Installed identity | Runtime mode | Publishing |
| --- | --- | --- | --- | --- |
| Unsigned demo preview | `app/desktop/builder.preview.json` | `in.chausar.desktop.preview`, `chausar-preview`, Chausar Unsigned Preview | `chausarPreview: true`; demo only, with its own user-data identity | Disabled |
| Beta | `app/desktop/builder.beta.json` | `in.chausar.desktop`, `chausar`, Chausar | Real data, with the bundled Codex; Windows (NSIS), Linux (deb, AppImage, tar.gz) and macOS (dmg, zip), unsigned unless signing values are set | Disabled |
| Final release candidate | `app/desktop/builder.json` | `in.chausar.desktop` | Real data; bundled runtimes and signing values required by the gate | Disabled by the local command |

Preview metadata chooses demo mode even when a packaged application is started without command-line arguments. Development launches require `--demo` explicitly. This keeps an unsigned preview build from ever opening a real business's vault. No preview update feed is configured, and an unsigned preview receipt is never an updater release manifest.

## Local commands

Use Node 24.13.1 or later and run commands from the repository root. `scripts/desktop-package.mjs` invokes the pinned, installed electron-builder CLI with Node, without `npx`, a global CLI, shell interpolation, or dependency installation. Windows preview uses ZIP only; a final NSIS build runs the installer it has just made, to pull the uninstaller out of it. The script rejects an OS or architecture that does not match the host. Build each target on its native machine.

These checks change nothing. They work before the packaging dependencies are installed and say what is missing:

```text
node scripts/desktop-package.mjs --mode preview --check
node scripts/desktop-package.mjs --mode final --check
node scripts/desktop-launch.mjs --demo --check
```

After `npm ci` and the Electron download, build a preview with the command for the host:

| Host | Command | Artifact formats |
| --- | --- | --- |
| Windows x64 | `node scripts/desktop-package.mjs --mode preview --platform win32 --arch x64` | Portable `.zip`; NSIS remains uncompleted |
| Windows arm64 | `node scripts/desktop-package.mjs --mode preview --platform win32 --arch arm64` | Portable `.zip`; NSIS remains uncompleted |
| macOS Intel | `node scripts/desktop-package.mjs --mode preview --platform darwin --arch x64` | `.dmg`, `.zip` |
| macOS Apple silicon | `node scripts/desktop-package.mjs --mode preview --platform darwin --arch arm64` | `.dmg`, `.zip` |
| Linux x64 | `node scripts/desktop-package.mjs --mode preview --platform linux --arch x64` | `.AppImage`, `.tar.gz` |
| Linux arm64 | `node scripts/desktop-package.mjs --mode preview --platform linux --arch arm64` | `.AppImage`, `.tar.gz` |

Add `--dir` to create only an unpacked application for review. Outputs stay under `release/preview`; filenames contain the version, operating system and architecture. A successful build writes `packaging-receipt-<platform>-<arch>.json`. Installer and archive entries contain the byte size and SHA-256 of the actual produced files. A receipt explicitly says unsigned, unpublished and unqualified for production. Every build requires its output directory to be absent or empty, including final and unpacked builds; review and move or archive previous output before rebuilding. The script never removes existing evidence.

The root `package-lock.json` is committed (since PR D, November 2026). Install from it with `npm ci --ignore-scripts --no-audit --no-fund`; change a dependency only with an exact pin in `package.json` and `npm install --package-lock-only`, then commit both files together. The lockfile must contain the exact direct pins and npm's real registry integrity records. Do not hand-write a lockfile, fabricate hashes or create executable placeholders. Electron's distribution download is a separate explicit step: `node node_modules/electron/install.js`. Preview config binds `electronDist` to the validated local `node_modules/electron/dist` and checks its version file and executable architecture, avoiding builder's second Electron download path. ZIP packaging still invokes genuine installed native build utilities (app-builder/7-Zip). A final NSIS build also needs the upstream NSIS 3.0.4.1 and nsis-resources 3.4.1 downloads. The script does none of this setup itself.

The development launcher starts the validated native executable directly with a bounded argument list. It clears inherited Electron Node mode and npm distribution selectors, so the npm loader cannot redirect the validated path or automatically install a missing binary during launch. This command opens the app's window.

On Windows, `scripts/windows-preview.ps1` wraps four of these steps for someone with only Node installed: `-Mode Check` (`scripts/check.mjs`), `-Mode Smoke` (`scripts/desktop-smoke.mjs`), `-Mode Web` (the local server in demo mode; it opens no browser) and `-Mode PackageCheck` (the preview package check for this computer's chip).

## CI preview matrix

`.github/workflows/desktop-preview.yml` is manual only, defaults to no build, and requires an explicit `build_preview` dispatch. The public-repository path uses native standard runners for six targets:

| Platform | x64 runner | arm64 runner |
| --- | --- | --- |
| Windows | `windows-2025` | `windows-11-arm` |
| macOS | `macos-15-intel` | `macos-15` |
| Linux | `ubuntu-24.04` | `ubuntu-24.04-arm` |

These labels are listed in [GitHub's standard runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). macOS `macos-15` is arm64; the Intel build uses an explicit Intel label. Each job checks the host match, installs only from the committed lockfile, downloads the pinned Electron distribution explicitly, runs the desktop/updater tests, smoke-tests the real demo worker without opening a browser, and builds with `--publish never`. The workflow uploads artifacts and checksums to workflow storage for seven days. It does not create a GitHub Release, updater feed, signing identity or service account. It has read-only repository permissions and does not receive production credentials.

For a private repository, the job runs only when `use_existing_self_hosted` is explicitly selected. That option chooses existing approved machines with GitHub's standard `self-hosted` label plus `windows`, `macOS` or `linux` and `x64` or `ARM64`. All six native runner combinations must already be available to complete the matrix. Missing runners leave jobs queued; no hosted fallback or runner provisioning is performed. The workflow registers no runner and installs no service. Those machines need the dependency and Electron downloads allowed before the workflow is started.

Private GitHub-hosted builds are disabled because they may consume billable minutes. The workflow uses neither larger runners nor a paid CI activation. Every run and attempt gets a separate checkout directory and checkout cleanup is disabled, so a self-hosted build does not erase previous local artifact evidence. A green matrix means the commands finished on those runners. It does not show that a window opens or that an installed app works.

## Signed final prerequisites

Run `node scripts/desktop-package.mjs --mode final --check` on the matching native host. The existing `scripts/package-preflight.mjs` remains the gate for final packaging. It requires all of the following before invoking electron-builder:

- A genuine matching npm lockfile and installed exact dependencies.
- Complete PostgreSQL and Python bundles under `runtime-binaries`, with target-native executables, redistribution licenses, vendor provenance and a complete verified file inventory. See `runtime-binaries/README.md`.
- The release operator's existing Ed25519 manifest key pair via absolute `CHAUSAR_RELEASE_PRIVATE_KEY_FILE` and `CHAUSAR_RELEASE_PUBLIC_KEY_FILE` paths. The private key stays outside the repository.
- Windows and macOS: an existing native certificate via an absolute local `CSC_LINK` and `CSC_KEY_PASSWORD`.
- macOS: the release operator's `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization.

These commands buy no certificate, make no key or account and change no security setting. Once everything on the list exists, `node scripts/desktop-package.mjs --mode final` builds and publishes nothing. The resulting receipt still requires native signing verification; the packaging command does not label it a qualified release.

The configurations follow the pinned [electron-builder 26.0.12 schema](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/app-builder-lib/scheme.json). Preview signing is explicitly disabled and preview child processes omit release/signing/service credentials. Final signing and hardened runtime remain enabled in the original configuration. Check actual Windows signatures and macOS code signatures, notarization and stapling using the publisher's normal release process before distribution. Linux needs the publisher-signed release manifest and integrity verification even though it has no equivalent certificate prerequisite in this gate.

## The Mac beta build

The founder decided on 14 November 2026 to build a Mac version too, with the bundled Codex. The beta is now built for macOS on Apple chips (arm64) and Intel (x64), each on a Mac with the matching chip; nothing is cross-built.

```text
npm run package:codex -- --from <the installed @openai/codex folder>
node scripts/desktop-package.mjs --mode beta --check
node scripts/desktop-package.mjs --mode beta
```

A build leaves `Chausar-Beta-<version>-mac-<arm64 or x64>.dmg` (what a person installs from) and the same name ending `.zip` (the file the update check downloads) in `release/beta`, with the app itself in `release/beta/mac-arm64/Chausar.app` (`mac` on Intel). The staged Codex sits in `vendor/codex-bundle/mac-arm64` or `mac-x64` and ships as `Chausar.app/Contents/Resources/codex`. The dmg step needs `python3` on the build Mac: electron-builder runs its own bundled script with it and downloads nothing.

What is true today, in plain words:

- **Unsigned until an Apple Developer ID is configured.** No certificate, identity or key is in this repository, and no script makes one. With no signing values set, the app gets only macOS's own local (ad-hoc) signature (`scripts/desktop-after-pack.cjs`, with `/usr/bin/codesign`), so that macOS on Apple chips does not call a downloaded copy damaged. macOS still blocks the first open. On macOS 15 or later the person opens System Settings, Privacy & Security, and chooses Open Anyway; on macOS 14 or older they right-click the app and choose Open. The package checks print these words every time.
- **Signing and notarisation** switch on only when all five of these are set: `CSC_LINK` (the absolute path of the Developer ID Application certificate file, a `.p12` kept outside the code folder), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. electron-builder reads them itself, and only its own step of the build receives them. A half-set list stops the build and names what is missing. After a signed build, macOS `codesign` must confirm a Developer ID signature for that team with the hardened runtime, or no receipt is written. The entitlements are in `app/desktop/entitlements.mac.plist`: the JavaScript engine and the microphone, nothing else.
- **The bundled Codex is never re-signed** (`mac.signIgnore`). The engine checks its program against the digest recorded when it was staged, and a new signature would change the file. So Apple will notarise the app only if the Codex files in the npm package already carry OpenAI's own Developer ID signature with the hardened runtime. They do (checked on 14 November 2026, see the live result below): `bin/codex`, `bin/codex-code-mode-host` and `codex-path/rg` in both Mac packages are signed by "Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)" with the hardened runtime and a timestamp, and macOS confirms the arm64 ones are notarised. The ad-hoc signing leaves them byte for byte as staged. Whether Apple then notarises the whole app with them inside is still not tried, as that needs a certificate. The staging script refuses anything that is not the npm layout with a Mach-O program at `bin/codex`, the Codex inside the ChatGPT app included.
- **Updates are by hand on a Mac.** The app checks the signed feed, downloads and checks the Mac zip, and shows it in Finder; the person replaces the app with it. Nothing installs by itself.
- **Start at login** uses macOS's own login item, and saved connection secrets use the macOS keychain through Electron. Both are wired and tested with stand-ins; neither has run on a Mac build. On an unsigned build macOS may ask for the keychain again after each update.
- **Languages.** macOS spells the three languages its own way, so every builder file names `en`, `en_GB` and `hi` for its Mac target (`mac.electronLanguages`). A Mac app says which languages it speaks with one empty folder for each in `Contents/Resources` (`en.lproj` and so on). electron-builder copies the local Electron folder with a copy that never makes empty folders, so none of them reaches the app; the pack hook (`scripts/desktop-after-pack.cjs`) puts back exactly the three named, before the app is signed, and the contents check refuses a build without them. Without them a Mac set to English (India) ran the app in US English; with them it runs in UK English.
- **Run for real once, on Apple silicon, unsigned.** See the live result below. The signed path (a Developer ID certificate, notarisation, `mac.signIgnore`), an Intel build, start at login, the keychain and a person opening a downloaded copy are still proven only by tests with stand-ins and by reading electron-builder 26.0.12. The tag workflow (`release.yml`) still builds Windows and Linux only. A Mac build is smoked with `node scripts/release-smoke.mjs --app <Chausar.app/Contents/MacOS/Chausar>`.

### Live result, 14 November 2026 (macOS 27.2, Apple silicon, Node 24.22.2)

One real unsigned beta build was made and run on a Mac with an Apple chip. No certificate, no Apple account and no signing value was used, and nothing was published.

What was built:

- Codex came from the npm registry (`npm pack @openai/codex@0.166.0` and `@openai/codex@0.166.0-darwin-arm64`, both matching the registry's integrity hashes), unpacked outside the code folder as an install lays them out. The layout is what `scripts/codex-bundle.mjs` expects: `vendor/aarch64-apple-darwin/` with `codex-package.json` (layout 1, entrypoint `bin/codex`), `bin/codex`, `bin/codex-code-mode-host`, `codex-path/rg` and the voice folder, which is left out. `npm run package:codex -- --from <that @openai/codex folder>` staged it unchanged and the staged program answered `--version`, `exec --help` and `features list`. The Intel package (`-darwin-x64`) has the same layout and staged too; it has no voice folder.
- Electron 44.4.5 came from `node node_modules/electron/install.js`. `node scripts/desktop-package.mjs --mode beta --check` passed, and `npm run package:beta` left `Chausar-Beta-0.1.0-preview.1-mac-arm64.dmg` (about 317 MB) and `Chausar-Beta-0.1.0-preview.1-mac-arm64.zip` (about 310 MB) with the app in `mac-arm64/Chausar.app` and a receipt. The dmg step used the Mac's own `python3` (3.9.6) and downloaded nothing.

What the real build found and what was changed:

- The first build was refused by the contents check: no language folder at all was in the app (see Languages above). The pack hook now puts the three back.
- The release smoke could not see first paint: `app/desktop/main.cjs` read its diagnostics folder before it set the smoke run's own data folder, so the start phases went to the real data folder (`~/Library/Application Support/Chausar`). This was the same on Windows and Linux. The smoke folder is now set first.
- `--allow-unrecorded-codex` was refused on every system as a changed plan, and an arm64 Windows or Linux build was read from the x64 folder name (`win-unpacked`, not `win-arm64-unpacked`). Both are fixed and held by tests; neither was run on a real Windows or Linux arm64 build.

What was checked on the final build:

- `codesign -dv` on the app: `Signature=adhoc`, `flags=0x2(adhoc)`, no team. `codesign --verify --deep --strict` passes on the app, on the app unpacked from the zip and on the app inside the mounted dmg.
- `Contents/Resources` holds `en.lproj`, `en_GB.lproj` and `hi.lproj` only, in the app, the zip and the dmg.
- The Codex inside the app matches `BUNDLE.json` file for file (`verifyCodexBundle`), still carries OpenAI's signature, and `Contents/Resources/codex/bin/codex --version` answers `codex-cli 0.166.0`.
- `node scripts/package-contents.mjs <Chausar.app> --mode beta` finds no problem, and the notices check finds every notice.
- `node scripts/desktop-smoke.mjs --packaged <Chausar.app>` and `node scripts/desktop-electron-smoke.mjs --packaged <Chausar.app>` pass (the worker inside the app, under Node and under the app's own program).
- `node scripts/release-smoke.mjs --app <Chausar.app/Contents/MacOS/Chausar>` passes: app ready, engine forked, engine ready, window shown, first paint, first request, then a clean quit with no process left.
- Started directly with a throwaway data folder, the window showed the first screen ("Connect your AI"), the engine accepted the bundled Codex (its trust record was written) and started it once, and everything had gone after quit.
- `scripts/release-feed.mjs` reads the output folder as one update target, the zip for `darwin` `arm64`.

What macOS says about a downloaded copy (Gatekeeper on, nothing changed on the Mac): the zip was copied and marked as a download (`com.apple.quarantine`), and unpacking passed the mark on to the app.

- `spctl --assess --type execute -vv` on that app: `rejected`, with no source line.
- The same after `codesign --remove-signature` on a copy: `rejected`, `source=no usable signature`.
- `spctl --assess --type open --context context:primary-signature -vv` on the dmg: `rejected`, `source=no usable signature`.
- `syspolicy_check distribution` on the app: "Adhoc Signed App" (a warning) and "Notary Ticket Missing" (fatal).

So macOS does refuse the unsigned download, as the build's words say. Not tried: a person opening the downloaded copy, reading what macOS shows, and choosing Open Anyway in System Settings. That step changes a security choice on the Mac, so it was left for a person. Until one does it, two things rest on Apple's own help pages and not on a run: that the ad-hoc signature keeps macOS from calling the copy damaged, and that Open Anyway is offered.

Also not tried: a signed and notarised build, an Intel build (only its Codex package was staged), the dmg opened in Finder by hand, start at login, the keychain, an update shown by the app, and Hindi as the Mac's language.

The outputs of that run are not in the code folder. A build writes to `release/beta` in the checkout (which git ignores); move it to the run root when it is done.

To ship a signed Mac build, a person must still: join the Apple Developer Program; make a Developer ID Application certificate and export it as a `.p12`; make an app-specific password for the Apple ID; set the five values above on a Mac build machine; stage Codex there from its npm package; build, then check the result with `spctl --assess --type execute` and `xcrun stapler validate` before giving it to anyone.

## Qualification evidence and recovery

Maintain one evidence record per OS and architecture. Mark a platform partial until it completes native packaging, graphical launch, engine startup/shutdown, vault reopen and recovery. Record the commit, exact dependency lock digest, artifact digest, runtime provenance, host architecture and check results. A test that passed on Windows does not count as a run on macOS or Linux.

The updater verifies a canonical publisher-signed manifest and the artifact size and hash before staging. It refuses mutation, an untrusted publisher, downgrades, incompatible platforms or engines, redirects, corrupt downloads and unsafe staging paths. Staging does not execute an installer and does not grant an unsigned fallback. A staging test is narrower than an installed update.

Before approving a final release, exercise this sequence on each supported target with disposable test data: create and reopen a vault on version N; take a verified encrypted backup; stage the authentic signed N+1 artifact; verify its native signature; close the engine; apply the platform installer through an operator-approved flow; reopen and check row counts, receipts and schema compatibility; then restore version N using the approved recovery plan and backup. Preserve the result and artifact hashes. A schema change that cannot restore the old data format must remain blocked until a compatible backup/restore path is proven. Keep the previous qualified installer and backup available; the runtime staging API does not implement automatic installer rollback.

## The update feed (release checklist)

Every tagged release signs a new update feed with `node scripts/release-feed.mjs` (the tag workflow runs it with the `CHAUSAR_RELEASE_KEY` secret). The feed is good for 90 days by default (`--valid-days`, 1 to 365); after that the app refuses it as expired, so a replayed old feed cannot hide a newer release for long.

- Re-sign the feed before its 90 days run out, even when there is no new release: run `release-feed.mjs` again on the current release's installers with the same key and upload the new `feed.json` and `feed.json.sig` to that release. Put a reminder in the calendar for day 80.
- If the feed runs out, every app says it couldn't check for updates until a newly signed feed is up. Nothing installs from an expired feed.
- An app whose computer clock is far off can read a current feed as expired; its words say the clock may be wrong.

### What a build needs for updates

`package.json` carries three empty keys until the founder gives them, and a build with them empty reads "not set up" to the owner and asks nothing:

- `chausarUpdatePublicKey`: the public half from `node scripts/release-key.mjs`, as PEM text.
- `chausarUpdateFeed`: the address of `feed.json`, with `feed.json.sig` beside it. `{channel}` in it becomes `beta` or `stable`. Redirects are followed only to GitHub's release hosts and the address's own host.
- `chausarWindowsPublisher`: the certificate's CN. Empty, a Windows owner reads "Needs a signed installer" and gets Show installer; nothing runs by itself.

On a Mac nothing runs by itself whatever the keys hold: the feed carries the Mac zip for each chip (`release-feed.mjs` reads `Chausar-Beta-<version>-mac-<arm64 or x64>.zip`; the dmg is not an update target), and the owner gets Show installer and replaces the app by hand.

GitHub's `releases/latest` link skips anything marked pre-release, so a beta feed needs a release not marked pre-release, or a fixed tag in the address.

Each waiting update holds up to three copies of the installer on disk: the staged file, the private copy Windows runs, and the kept copy for rollback, about 1 GB at today's size.

## Running in the background

The engine runs as a child process while Chausar runs. The installed beta can start at login, hidden in the tray, and keep running in the tray after its window closes. Both are the owner's settings ([desktop-runtime.md](desktop-runtime.md)). A preview build and a run from source register nothing at login. No build installs a system service, and nothing runs while the computer is asleep or off.

## Closing Chausar when asked, and a slow start

Added on 15 November 2026 after the first walk of the built Windows app.

- **Asking it to quit.** `Chausar.exe --quit` (any platform: the program with `--quit`) asks the running Chausar to quit the way the tray's "Quit Chausar and stop jobs" does: the engine stops gracefully first. The asking launch opens no window and exits 0 once the other has gone, or at once when none is running; it exits 1 when the other is still there after 90 seconds, and it never ends anything by force. It goes through the single-instance lock in the user data folder, so it reaches only the Chausar that shares that folder (`--smoke-user-data` included). It asks once, then watches the process the running Chausar names in `running.json` in that folder. On Windows `taskkill /PID` without `/F` cannot do this: it only closes a window, and the beta keeps running in the tray.
- **The end of a Windows session** (sign-out, shutdown, an installer's Restart Manager) starts the same stop at once, without the update's safety copy or install. In the tray Chausar has no window, and Windows tells only windows, so a hidden one listens there; a close that reaches that hidden window (`taskkill /PID` without `/F` while Chausar is in the tray) is taken as an ask to quit. Windows decides how long the stop gets, about five seconds by default; Chausar does not hold a shutdown back.
- **The installer and the uninstaller** ask a running Chausar with `--quit` before they touch its files (`app/desktop/installer.nsh`, `customCheckAppRunning`), and end it by force only if it is still there afterwards, as electron-builder's own step did from the start. An update installs only after the engine has already stopped at quit, so it needs no ask.
- **The release smoke** asks with a `--quit` launch on Windows and with SIGTERM elsewhere (`--quit-by launch|signal` picks either), says "it closed when asked", and says plainly when it had to end the app by force. It waits for the engine's `engine-ready` phase as well as `first-paint`.
- **Why Chausar quit** is kept in `diagnostics/main.jsonl`: `{"op":"quit","reason":...}` (`tray`, `asked`, `session-end`, `close-request` or `quit`) and `{"op":"quit-engine","graceful":true|false,"ms":...}`.
- **A slow start.** The window opens as soon as Chausar knows it is not a tray start, before the engine has started, and says "Chausar is starting." until the engine is up (the engine gets 60 seconds). Before this a slow first start showed nothing for about ten seconds, and a second launch in that time ended both: on Windows the second launch's single-instance check ends a first one that is slow to answer and has no window on screen. A tray start still has no window, so that risk remains there.

Shown so far: tests with stand-ins, and on one Mac (macOS 27.2, Apple silicon, a run from source with synthetic data, 15 November 2026) the smoke with `--quit-by launch` passed, `--quit` exited 0 with `quit-engine` graceful, and a second launch during the start left the first running. Nothing of this has run on Windows yet, and `installer.nsh` has not been compiled.

## What has and has not been shown

- The tag workflow (`.github/workflows/release.yml`) builds the Windows and Linux beta. Those installers are unsigned.
- One unsigned Mac beta build was made and run on Apple silicon on 14 November 2026 ([the live result](#live-result-14-november-2026-macos-272-apple-silicon-node-24222)). That is one build on one Mac, not a qualified platform.
- No build has a publisher certificate, a notarisation, a release key or an update feed address. No signed installer exists, and no update from an installed old version to a new one has been tried.
- The six-target preview workflow has not been shown to pass on all six runners.
- The final path has not been exercised. Its gate still asks for PostgreSQL and Python bundles, and none is in this repository.
