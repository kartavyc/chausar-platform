# Windows preview milestone and exact prerequisites

This desktop lane provides a source preview kit and a safe path to a genuine unsigned Electron ZIP. The source kit contains application code and scripts, **no Node/Electron executable, npm dependencies, PostgreSQL, Python or native installer**. An existing approved Node installation can run its source checks and headless synthetic worker smoke. The web command starts the synthetic loopback server without opening a browser; interactive inspection has not been performed.

From the extracted repository root, PowerShell offers `./scripts/windows-preview.ps1 -Mode Check`, `-Mode Smoke`, `-Mode Web` or `-Mode PackageCheck`. No execution policy change is required or authorized. If local policy blocks PowerShell scripts, use the existing direct Node commands `node scripts/check.mjs`, `node scripts/desktop-smoke.mjs`, and `node platform/runtime/server.ts --demo` on a permitted machine. No browser launch is automated. `PackageCheck` is read-only and fails honestly when the genuine dependency lock/distribution is absent.

## Dependency inventory

Inspected host: Windows x64, installed Node **24.13.1**, installed npm **11.8.0**. Direct npm CLI: `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`. The PowerShell npm shim points to an unavailable roaming path; no global repair was attempted.

| Package | Exact repository declaration | Local state at desktop-lane validation |
| --- | --- | --- |
| Electron | `44.4.5` | Not installed; no `node_modules/electron/dist` or `path.txt` |
| electron-builder | `26.0.12` | Not installed |
| TypeScript | `5.9.3` | Not installed; strict typecheck blocked |
| `@types/node` | `24.0.0` | Not installed |
| `@types/pg` | `8.15.5` | Not installed |
| `pg` | `8.23.0` | Not installed |
| `@duckdb/node-api` | `1.5.5-r.3` | Not installed; native API not qualified |
| Root npm lockfile | Genuine npm lockfile v3 | Absent; no invented integrity records |

These pins remain subject to integration's authoritative manifest/lock review. Separate `task-5/dependency-staging` owns only a snapshot for resolution; this lane does not edit integration files or add a fabricated lockfile.

The [official Electron release list](https://releases.electronjs.org/release?channel=stable) identifies 44.4.5 as a real stable release, with embedded Node **24.21.0**. Host Node smoke is therefore insufficient evidence for Electron's embedded runtime. The [44.4.5 npm source manifest](https://github.com/electron/electron/blob/v44.4.5/npm/package.json) declares Node >=22.12.0 and transitive ranges `@electron/get ^5.0.0`, `@electron-internal/extract-zip ^1.0.1`, `@types/node ^24.9.0`. The [pinned loader](https://github.com/electron/electron/blob/v44.4.5/npm/index.js) may install Electron automatically when its distribution is missing. Read-only checks never import that module or invoke its CLI. The genuine npm package and complete transitive resolution still need to be fetched and reviewed; source metadata is not installed-package evidence.

## Exact blocked step

The project-local, lifecycle-disabled lock resolution command was attempted once with npm 11.8.0:

```text
node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" install --package-lock-only --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=15000 --logs-max=0 --cache=<owned-staging-cache>
```

It failed fetching `https://registry.npmjs.org/@duckdb%2fnode-api`: **EACCES**, a socket/system permission failure. No lockfile was created. An explicitly requested, scoped approval escalation was then rejected by automatic review, which interpreted it as retrying the denied official-registry download. No alternate downloader, registry mirror, proxy, security setting change or further network retry followed.

The bounded next action is either to supply genuine already-acquired local package/distribution artifacts with their npm lock/provenance for validation, or to perform the dependency steps below on an approved build/download machine. Parent approval of that environment is needed before this lane resumes acquisition. NSIS/full installer, GUI inspection and other platforms remain outstanding.

## Genuine Electron ZIP setup on an approved machine

1. Integration generates and reviews a genuine npm v3 lockfile from its final manifest using the official registry. Keep all direct pins, transitive resolved HTTPS artifact URLs and npm integrity records. Do not copy a lock from this lane's unresolved staging.
2. Install that reviewed lock with `npm ci --ignore-scripts --no-audit --no-fund`. Use the verified direct CLI if its local shim is broken. Installation includes builder-native utilities, not merely TypeScript declarations. The pinned builder source declares `app-builder-bin 5.0.0-alpha.12` and `7zip-bin ~5.2.0`; the actual resolved tarballs/platform binaries must appear in the genuine lock and installed-package inventory.
3. Explicitly run `node node_modules/electron/install.js` only with approved official Electron download access. Its [44.4.5 source](https://github.com/electron/electron/blob/v44.4.5/npm/install.js) uses `@electron/get`, the package's bundled checksum table and a native archive extractor. The expected Windows x64 artifact is `https://github.com/electron/electron/releases/download/v44.4.5/electron-v44.4.5-win32-x64.zip`. Retain real upstream checksum evidence; no artifact hash was retrieved or invented here. Keep caches in the build-owned directory. Do not import `electron` as a purportedly harmless presence check.
4. Run source checks, meaningful desktop/updater tests and strict TypeScript checking. Run `node scripts/desktop-electron-smoke.mjs` on a machine where native Electron execution is approved; this uses Electron's Node mode without opening a browser. It is not GUI acceptance, and it has not run in this lane.
5. Run `node scripts/desktop-package.mjs --mode preview --platform win32 --arch x64 --check`, then the same command without `--check`. Preview config uses the validated local `electronDist`, disables rebuild/signing/publishing and selects ZIP only. The expected native artifact is **`Chausar-Preview-0.1.0-preview.1-win-x64.zip`**, accompanied by its actual checksum receipt. Extract it completely to an app-owned folder; the intended executable is `Chausar Unsigned Preview.exe`. Do not call this file present, launch-tested or qualified until those checks occur.

The ZIP's future launch is synthetic-only. It includes Electron and its notices plus packaged application/production npm dependencies; it intentionally omits production PostgreSQL/Python bundles. Neither it nor the source kit enables startup persistence, installs a service, adds a signing identity, publishes a release or configures an update feed. Python PDF/forecast/allocation helper availability and production database behavior remain explicitly unqualified.

## NSIS, macOS, Linux and final release

Windows NSIS scope remains in the final configuration. [electron-builder 26.0.12's NSIS source](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts) executes a generated installer to extract its uninstaller; [the Windows execution helper](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/app-builder-lib/src/wine.ts) launches that executable on Windows. NSIS also requires upstream **nsis 3.0.4.1** and **nsis-resources 3.4.1** artifacts outside the npm lock. ZIP-only is an intermediate preview, not completion of the native installer. Signed final builds need approved publisher certificate/manifest keys and genuine portable runtimes, plus installer/update/rollback qualification.

macOS Intel/ARM64 and Linux x64/ARM64 commands and the manual CI matrix remain supported paths. They need existing approved native runners, genuine platform-specific Electron/runtime distributions and native checks. The private workflow enables only explicitly chosen existing self-hosted runners; none was dispatched here. macOS requires nested native signing/notarization for a final release; Linux requires tested libc/distribution compatibility, AppImage launch and signed release manifests. Windows cannot supply their execution evidence.

See [runtime source candidates and exact PostgreSQL/Python gaps](desktop-runtime-prerequisites.md) and [release qualification](desktop-releases.md). No certificate/key/account purchase or creation, OS security change, paid CI activation or GUI-policy workaround is part of these prerequisites.
