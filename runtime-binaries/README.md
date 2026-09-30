# Vendored native runtimes

This directory deliberately contains no PostgreSQL or Python executable. The preview uses an explicitly selected experimental file vault; production PostgreSQL does not fall back to a database installed on the developer's machine. A native release must vendor genuine, licensed runtimes for each supported target and pass `node scripts/package-preflight.mjs` before invoking electron-builder.

Assemble one target platform and architecture per package checkout directly under this directory. The manifest declares that target, such as `win32` with `x64` or `darwin` with `arm64`. Runtime startup uses `process.resourcesPath/runtime-binaries` in the installed app. Required paths relative to this directory are:

| Component | Windows | macOS/Linux |
| --- | --- | --- |
| PostgreSQL server | `postgres/bin/postgres.exe` | `postgres/bin/postgres` |
| PostgreSQL initialization | `postgres/bin/initdb.exe` | `postgres/bin/initdb` |
| PostgreSQL control | `postgres/bin/pg_ctl.exe` | `postgres/bin/pg_ctl` |
| Python interpreter | `python/python.exe` | `python/bin/python3` |

Ship the complete runtime, including dependent libraries, PostgreSQL share files, Python standard library and license notices. Native files must match the declared architecture. Use real directories and regular files without symbolic links. On Unix, unpack genuine Python symlinks into a regular interpreter file and retain executable permissions. Do not add placeholders or substitute PATH commands.

Obtain PostgreSQL through the [official download entry point](https://www.postgresql.org/download/) and Python through the [official download entry point](https://www.python.org/downloads/). Record the actual package vendor and distribution source; do not invent official builds for unsupported combinations. Review redistribution licensing, validate the vendor's download integrity independently, and test the native runtime on the target operating system.

This directory requires a `manifest.json` with exactly these top-level fields: `schemaVersion: 1`, `platform`, `architecture`, `components` and `files`. `components` has exactly `postgres` and `python`. Each component records an exact vendor `version` (for example PostgreSQL's two-part release or Python's three-part release), public HTTPS `source`, SPDX or descriptive `license`, and relative `licenseFile`. `files` lists every regular bundled file other than the manifest itself, including this README if retained in the package. Each entry has exactly a relative POSIX `path`, lowercase 64-character `sha256` and integer byte `size`. Paths cannot contain parent traversal, drive letters or backslashes. The license files belong in this inventory too. Generate hashes from the real runtime distribution; an inventory generated from a placeholder is not an acceptable release artifact.

`scripts/package-preflight.mjs` is read-only. It rejects missing native binaries, invalid platform formats, incomplete inventory, changed bytes, symlinks, missing helpers, missing exact npm dependency lockfile and absent signing prerequisites. It never downloads runtimes, creates a synthetic lockfile, initializes a database or executes an installer. The gate is a prerequisite check and cannot qualify a vendor's provenance or a signed installer by itself.

The publisher must supply `CHAUSAR_RELEASE_PRIVATE_KEY_FILE` and `CHAUSAR_RELEASE_PUBLIC_KEY_FILE` as absolute Ed25519 PEM paths. Keep the private key outside the source repository. Windows and macOS additionally require an absolute local signing certificate path in `CSC_LINK` and a `CSC_KEY_PASSWORD` in the release environment. macOS also requires `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization. Keep all private credentials in the release operator's protected environment; never commit them. The preflight checks key ownership without printing key material. The native signing and notarization tools must separately validate the certificate and produce a signed artifact.

The native credential names follow the [pinned electron-builder 26 signing documentation](https://www.electron.build/v26/docs/features/code-signing/). This project's gate selects local certificate files and refuses missing publisher credentials; electron-builder offers additional signing backends that would require their own explicit configuration and validation.

The release pipeline must run the preflight and stop on its nonzero exit status, then run electron-builder with signing enabled. For example, in PowerShell, run `node scripts/package-preflight.mjs`; if `$LASTEXITCODE -ne 0`, stop before packaging. A source build from `scripts/build.mjs` is explicitly an unsigned preview and does not satisfy this gate.

Desktop startup is wired to launch the bundled PostgreSQL binaries on loopback when no explicit PostgreSQL URL is configured, using a private generated password file. The packaged Python path is explicit. The native runtimes are absent in this environment, so this wiring has not been qualified with a native launch. Before claiming an installed production release, verify startup and orderly shutdown on each target, test the Python helper process restrictions, sign the actual release manifest with the publisher's pinned Ed25519 key, and prove backup/rollback across an upgrade. Those qualifications are not asserted by this source tree.
