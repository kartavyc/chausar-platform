# Desktop builds and release qualification

Chausar has two packaging paths. The unsigned preview runs the explicitly experimental demo vault. The final path retains the signed-release prerequisite gate and requires genuine bundled PostgreSQL and Python distributions. An artifact build alone does not qualify a platform for production.

| Path | Configuration | Installed identity | Runtime mode | Publishing |
| --- | --- | --- | --- | --- |
| Unsigned demo preview | `app/desktop/builder.preview.json` | `in.chausar.desktop.preview`, `chausar-preview`, Chausar Unsigned Preview | `chausarPreview: true`; demo only, with its own user-data identity | Disabled |
| Final release candidate | `app/desktop/builder.json` | `in.chausar.desktop` | Production; genuine vendored runtimes and signing prerequisites required | Disabled by the local command |

Preview metadata chooses demo mode even when a packaged application is started without command-line arguments. Development launches require `--demo` explicitly. This distinction prevents an unsigned preview artifact from silently selecting a production database or reading a production vault. No preview update feed is configured, and an unsigned preview receipt is never an updater release manifest.

## Local commands

Use Node 24.13.1 or later and run commands from the repository root. `scripts/desktop-package.mjs` invokes the pinned, installed electron-builder CLI with Node, without `npx`, a global CLI, shell interpolation, or dependency installation. Windows preview uses ZIP only; final NSIS builds execute a generated installer internally to extract the uninstaller, so final packaging also needs approval for that execution. It rejects an OS or architecture that does not match the host. Build each target on its native machine.

Read-only checks work before packaging dependencies are available and explain the missing prerequisites:

```text
node scripts/desktop-package.mjs --mode preview --check
node scripts/desktop-package.mjs --mode final --check
node scripts/desktop-launch.mjs --demo --check
```

After approved dependency setup, build a preview using the command matching the host:

| Host | Command | Artifact formats |
| --- | --- | --- |
| Windows x64 | `node scripts/desktop-package.mjs --mode preview --platform win32 --arch x64` | Portable `.zip`; NSIS remains uncompleted |
| Windows arm64 | `node scripts/desktop-package.mjs --mode preview --platform win32 --arch arm64` | Portable `.zip`; NSIS remains uncompleted |
| macOS Intel | `node scripts/desktop-package.mjs --mode preview --platform darwin --arch x64` | `.dmg`, `.zip` |
| macOS Apple silicon | `node scripts/desktop-package.mjs --mode preview --platform darwin --arch arm64` | `.dmg`, `.zip` |
| Linux x64 | `node scripts/desktop-package.mjs --mode preview --platform linux --arch x64` | `.AppImage`, `.tar.gz` |
| Linux arm64 | `node scripts/desktop-package.mjs --mode preview --platform linux --arch arm64` | `.AppImage`, `.tar.gz` |

Add `--dir` to create only an unpacked application for review. Outputs stay under `release/preview`; filenames contain the version, operating system and architecture. A successful build writes `packaging-receipt-<platform>-<arch>.json`. Installer and archive entries contain the byte size and SHA-256 of the actual produced files. A receipt explicitly says unsigned, unpublished and unqualified for production. Every build requires its output directory to be absent or empty, including final and unpacked builds; review and move or archive previous output before rebuilding. The script never removes existing evidence.

At the desktop-lane validation snapshot, the repository has no genuine npm lockfile and no installed packaging dependencies. This environment has not run an installer build. An operator with approved registry access must generate and review a real `package-lock.json`, then use `npm ci --ignore-scripts --no-audit --no-fund`. The lockfile must contain the exact direct pins and npm's real registry integrity records. Do not hand-write a lockfile, fabricate hashes or create executable placeholders. Electron's distribution download is a separate explicit step: `node node_modules/electron/install.js`. Preview config binds `electronDist` to the validated local `node_modules/electron/dist` and checks its version file and executable architecture, avoiding builder's second Electron download path. ZIP packaging still invokes genuine installed native build utilities (app-builder/7-Zip). Final NSIS additionally needs upstream NSIS 3.0.4.1 and nsis-resources 3.4.1 downloads, and generated-installer execution; approve those operations on a permitted build machine before final packaging. The script never performs these setup operations itself.

On the inspected Windows machine, the npm wrapper searches an absent roaming-profile CLI even though the Node installation contains npm. The read-only invocation `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" --version` works. If that exact bundled path exists, it can be used for an approved local npm operation; it does not justify changing global tools or bypassing a denied network operation.

The development launcher starts the validated native executable directly with a bounded argument list. It clears inherited Electron Node mode and npm distribution selectors, so the npm loader cannot redirect the validated path or automatically install a missing binary during launch. This command still opens the native app and requires an environment where GUI execution is approved; it has not been run here.

See [the exact Windows prerequisites and dependency blocker](windows-preview-prerequisites.md) and [portable production runtime sources](desktop-runtime-prerequisites.md). The separate Windows source kit runs check/smoke using an existing Node installation; it contains no Electron or native runtimes.

## CI preview matrix

`.github/workflows/desktop-preview.yml` is manual only, defaults to no build, and requires an explicit `build_preview` dispatch. The public-repository path uses native standard runners for six targets:

| Platform | x64 runner | arm64 runner |
| --- | --- | --- |
| Windows | `windows-2025` | `windows-11-arm` |
| macOS | `macos-15-intel` | `macos-15` |
| Linux | `ubuntu-24.04` | `ubuntu-24.04-arm` |

These labels are listed in [GitHub's standard runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). macOS `macos-15` is arm64; the Intel build uses an explicit Intel label. Each job checks the host match, installs only from the committed lockfile, downloads the pinned Electron distribution explicitly, runs the desktop/updater tests, smoke-tests the real demo worker without opening a browser, and builds with `--publish never`. The workflow uploads artifacts and checksums to workflow storage for seven days. It does not create a GitHub Release, updater feed, signing identity or service account. It has read-only repository permissions and does not receive production credentials.

For a private repository, the job runs only when `use_existing_self_hosted` is explicitly selected. That option chooses existing approved machines with GitHub's standard `self-hosted` label plus `windows`, `macOS` or `linux` and `x64` or `ARM64`. All six native runner combinations must already be available to complete the matrix. Missing runners leave jobs queued; no hosted fallback or runner provisioning is performed. This change does not register a runner, install a service or change persistence on a developer's laptop. Approve dependency and Electron downloads on those machines before dispatch.

Private GitHub-hosted builds are disabled because they may consume billable minutes. The workflow uses neither larger runners nor a paid CI activation. Every run and attempt gets a separate checkout directory and checkout cleanup is disabled, so a self-hosted build does not erase previous local artifact evidence. Retain or move old checkouts under the runner owner's approved maintenance process. No workflow run is claimed by this source change. A green matrix means commands completed on those runners; graphical launch and installed-app qualification still need evidence on the target systems.

## Signed final prerequisites

Run `node scripts/desktop-package.mjs --mode final --check` on the matching native host. The existing `scripts/package-preflight.mjs` remains the gate for final packaging. It requires all of the following before invoking electron-builder:

- A genuine matching npm lockfile and installed exact dependencies.
- Complete PostgreSQL and Python bundles under `runtime-binaries`, with target-native executables, redistribution licenses, vendor provenance and a complete verified file inventory. See `runtime-binaries/README.md`.
- The release operator's existing Ed25519 manifest key pair via absolute `CHAUSAR_RELEASE_PRIVATE_KEY_FILE` and `CHAUSAR_RELEASE_PUBLIC_KEY_FILE` paths. The private key stays outside the repository.
- Windows and macOS: an existing native certificate via an absolute local `CSC_LINK` and `CSC_KEY_PASSWORD`.
- macOS: the release operator's `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization.

This work does not purchase certificates, create keys or accounts, provision credentials, change operating-system security settings or activate paid services. After the approved prerequisites exist, `node scripts/desktop-package.mjs --mode final` builds without publication. The resulting receipt still requires native signing verification; the packaging command does not label it a qualified release.

The configurations follow the pinned [electron-builder 26.0.12 schema](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/app-builder-lib/scheme.json). Preview signing is explicitly disabled and preview child processes omit release/signing/service credentials. Final signing and hardened runtime remain enabled in the original configuration. Check actual Windows signatures and macOS code signatures, notarization and stapling using the publisher's normal release process before distribution. Linux needs the publisher-signed release manifest and integrity verification even though it has no equivalent certificate prerequisite in this gate.

## Qualification evidence and recovery

Maintain one evidence record per OS and architecture. Mark a platform partial until it completes native packaging, graphical launch, engine startup/shutdown, vault reopen and recovery. Record the commit, exact dependency lock digest, artifact digest, runtime provenance, host architecture and check results. Windows source tests do not count as macOS or Linux execution.

The updater verifies a canonical publisher-signed manifest and the artifact size and hash before staging. It refuses mutation, an untrusted publisher, downgrades, incompatible platforms or engines, redirects, corrupt downloads and unsafe staging paths. Staging does not execute an installer and does not grant an unsigned fallback. A staging test is narrower than an installed update.

Before approving a final release, exercise this sequence on each supported target with disposable test data: create and reopen a vault on version N; take a verified encrypted backup; stage the authentic signed N+1 artifact; verify its native signature; close the engine and database; apply the platform installer through an operator-approved flow; reopen and check row counts, receipts and schema compatibility; then restore version N using the approved recovery plan and backup. Preserve the result and artifact hashes. A schema change that cannot restore the old data format must remain blocked until a compatible backup/restore path is proven. Keep the previous qualified installer and backup available; the runtime staging API does not implement automatic installer rollback.

## Background execution boundary

The desktop engine runs as a child process while Chausar is open. A normal last-window close quits Chausar and shuts down the engine and local database. An explicitly requested `--background` session retains the tray and engine after the last window closes; a second launch reopens the window, and Quit from the tray drains the engine before closing the bundled database. This lasts only for that running session. This package does not register a Windows service, macOS LaunchAgent, Linux systemd unit, login item or startup task.

A home-box runner can reuse the same runtime on an explicitly chosen spare machine after its lifecycle, credentials, budgets and restart handling are qualified. Service registration needs a separate reviewed installation step on that chosen machine; it must be removable and must identify its data directory and owner. A server-hosted job requires separately approved deployment and pricing, and the trust panel must say that the server needs a data key. Neither path can claim to keep running on a sleeping laptop. No operating-system persistence or hosted service is enabled by the preview matrix.

## Current evidence limits

Windows Node checks and contract tests can run locally without Electron. Packaging and graphical launch remain blocked here by the absent genuine lockfile, packaging dependencies and approved upstream downloads. Native PostgreSQL/Python bundles, certificates, notarization and release-manifest keys are absent. macOS/Linux native execution, six-target CI execution, signed installers and installed upgrade/rollback have not been demonstrated by this change. The commands and matrix provide the path to collect that evidence without relabelling a preview as a final release.
