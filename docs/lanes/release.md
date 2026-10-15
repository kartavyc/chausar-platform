# Release lane

Installers, the bundled database, the updater, native pieces and the enterprise server. Branch `claude/lane-release`. Nothing here is deployed, signed or published: every step that needs a certificate, account or key refuses with a typed code until the founder supplies it.

## What a person gets

- **Updates that cannot be forced on them.** The app checks a signed channel (`release.checkUpdate`), shows what would change, downloads only after a click (`release.stageUpdate`), and swaps only after a second, exact confirmation (`release.applyUpdate`). A vault copy is made first. The new version runs on trial; if it does not start cleanly twice, the old one comes back on its own. `release.rollback` brings it back by hand.
- **A preview that says when it expires.** A preview build reports `updateNeeded` after its expiry date, for the frame's "update needed" banner.
- **A bad release pulled back.** The publisher marks a version withdrawn; installs running it are advised to roll back.
- **Background mode** installed as an ordinary user task: Windows Task Scheduler, a macOS launchd agent or a systemd user unit. No administrator rights. The plan (files and commands) is shown before the click.
- **An honest download page** that says "Preview — not signed" in plain words for an unsigned build, with the SHA-256 fingerprint and the steps to check it.
- **A company server** (`enterprise/server/`) that runs the same engine for many people over HTTPS, with company sign-in (OIDC), roles and branch scope, opened in a browser.

## Engine methods (`platform/runtime/modules/lane-release.ts`)

| Method | Permission | What it does |
|---|---|---|
| `release.status` | read | Version, channel, build expiry (`build.usable`, `build.updateNeeded`), last accepted feed, install pointer, data-schema marker, `vaultCompatible` (false when a newer app wrote the data), staged candidate. `configured: false` when no release key is set. |
| `release.checkUpdate` | admin, external | Fetches and verifies the signed channel and manifest. Returns `none`, `update` (with rollout, size, install mode, whether a vault copy is needed) or `rollback-advised`. |
| `release.stageUpdate` | admin, external | `confirmed: true` required. Downloads and verifies the artifact; never installs or runs it. |
| `release.applyUpdate` | admin | `confirmed: true` required. Makes a vault copy (`workspace.backup`), checks the data guard, swaps atomically, leaves the new version on trial. |
| `release.rollback` | admin | `confirmed: true` required. Flips back to the previous version. |
| `release.confirmHealthy` | admin | Commits a trial version. |
| `native.keychainStatus` | admin | Which OS keychain backs the vault and whether the native helper and its manifest are present and valid. Never runs the helper. |
| `native.databaseStatus` | admin | Bundled PostgreSQL state: absent, uninitialized, stopped, running, needs-upgrade, newer-than-app or unavailable, with the port and the last crash recovery. |
| `service.status`, `service.plan` | admin | Background-service state, and the exact files and commands an install would use. |
| `service.install`, `service.uninstall` | admin | `confirmed: true` required. |

All writing methods refuse phone sessions (`OPEN_DESKTOP`) and requests that read outside text (`TAINTED_RELEASE_REQUEST`). Trusted options come only from `EngineOptions.modules.release` (`releasePublicKey`, `channel`, `feedUrl`, `installRoot`, `previewExpiresAt`, `appExecutable`, `resourcesPath`, …). The release refusal codes are on the release line of `laneRefusals` in `app/desktop/preload.cjs`. No screens: the Trust and Tools lanes and the frame draw these.

## Build list

| Item | Where | Label |
|---|---|---|
| Release build configs (NSIS, dmg + zip, AppImage + tar.gz) | `app/desktop/builder.json`, `builder.preview.json`, `entitlements.mac.plist` | **experimental** (Linux preview AppImage and tar.gz built here; Windows and macOS never packaged) |
| Windows signing through a cloud key service (DigiCert KeyLocker or SSL.com eSigner) | `scripts/release/windows-sign.cjs` | **experimental** (needs the certificate) |
| macOS signing and notarization | `builder.json`, `release.yml` | **experimental** (needs an Apple account) |
| Release CI with checksums | `.github/workflows/release.yml`, `ci.yml` job `release-config`, `scripts/release/checksums.ts`, `sign-update-manifest.ts` | **experimental** (never run on GitHub) |
| Runtime-binary staging with checksum inventory | `scripts/release/stage-runtime.ts`, `runtime-sources.json` | **supported** (Linux x64 pinned and staged from the real archives; other targets unpinned) |
| Bundled PostgreSQL lifecycle: initdb, start, stop, port, crash recovery, upgrade | `platform/runtime/native/postgres-lifecycle.ts`, `desktop-database.ts` (wired into `main.cjs`) | **supported** (Linux x64, real PostgreSQL 17.6 and a 16 → 17 upgrade; other OSes experimental) |
| Signed update channel, staged rollout, kill switch | `platform/runtime/native/update-channel.ts`, `update-feed-client.ts` | **supported** |
| Staging, atomic swap, trial launch, automatic and manual rollback | `update-install.ts`, `update-service.ts`, `update-zip.ts`, `update-launch.ts`, `scripts/release/launcher/chausar-launcher.sh` | **supported** (Linux, run with the real built app through the launcher; native installers refuse) |
| Expiry on preview builds | `update-expiry.ts` | **supported** |
| Vault copy before a schema change; older app refuses a newer vault | `update-data-guard.ts`, `release.applyUpdate` | **supported** |
| Native keychain providers (Windows Credential Manager/DPAPI, macOS Keychain, libsecret) | existing `platform/native/keychain` helper and `PlatformKeychain`; status in `native/keychain-status.ts`; manifest writer `scripts/release/keychain-manifest.ts` | **experimental** (not run against a real OS store) |
| OS background service install | `platform/runtime/native/background-service.ts` | **experimental** (generators and installer tested with a fake runner) |
| Public releases page generator | `scripts/release/releases-page.ts`, `releases.json` | **supported** |
| Supported and experimental lists generator | `scripts/release/feature-lists.ts`, `supported-evidence.json` | **supported** |
| Clean public copy with allowlist, scan and licence tags | `scripts/release/public-copy.ts`, `public-allowlist.json` | **supported** (dry run; publishing waits for the licence) |
| Enterprise server: HTTPS, OIDC, roles, branch scope, browser UI, sessions in PostgreSQL, remote PostgreSQL over TLS | `enterprise/server/` | **experimental** (real PostgreSQL over TLS and a fake identity provider; never deployed) |
| Enterprise Docker image and compose file | `enterprise/server/Dockerfile`, `compose.yaml` | **experimental** (built and smoke-tested here, 17 of 17; never pushed or deployed) |

## How to use the scripts

- `node scripts/release/feature-lists.ts` → `release/site/{lists.json,supported.md,experimental.md,later.md}`. A feature a lane document labels as supported keeps that label only with bench and hidden-case evidence in `supported-evidence.json`; otherwise it moves to the other list with the reason. The parser reads table rows with a label cell (an optional note in brackets may follow) and list items that end in a bold label.
- `node scripts/release/releases-page.ts --sums SHA256SUMS` → `release/site/releases/index.html`.
- `node scripts/release/public-copy.ts --out release/public` (dry run) → the copy plus `public-copy-report.json`. `--publish` refuses `LICENCE_UNDECIDED` while the licence is the draft. `--init-git` makes one fresh commit.
- `node scripts/release/stage-runtime.ts --platform win32 --arch x64 --out runtime-binaries`.
- Enterprise: see `enterprise/server/README.md` (first step: run the local build as a server and open it from a browser).

## Tests

`platform/tests/release-*.test.ts`: module wiring, update channel, expiry, install swap, data guard, update service, PostgreSQL lifecycle, runtime staging, background service generators and install, keychain status, build configs and workflow, release page, feature lists, public copy, enterprise OIDC and server (real HTTPS with a self-signed certificate; skipped without openssl). All use synthetic keys, temporary directories, fake runners and an in-process identity provider; nothing reaches the network.

## What waits for the founder

| Refusal | What is missing |
|---|---|
| `WINDOWS_SIGNING_UNCONFIGURED` | The Windows code-signing certificate in a cloud key service (D9), the signer settings and the publisher name. |
| `MAC_SIGNING_IDENTITY_MISSING` | An Apple Developer ID certificate and notarization credentials. |
| `RELEASE_KEY_UNCONFIGURED`, `UPDATES_UNAVAILABLE` | The Ed25519 release key pair; the public half is pinned into the app. |
| `UPDATE_FEED_NOT_CONFIGURED` | A public update feed URL (hosting is a deployment). |
| `RUNTIME_SOURCE_UNPINNED`, `RUNTIME_SOURCE_UNAVAILABLE` | SHA-256 pins for the Windows and macOS PostgreSQL and Python archives (Linux x64 is pinned); a PostgreSQL build for Windows on Arm. |
| `LICENCE_UNDECIDED` | The licence choice before the public copy is published. |

## Still missing

- Nothing has run on Windows or macOS: no installer, signing, keychain store, service manager or launcher there. On Linux nothing ran with Chromium's sandbox on, under FUSE, or through a power cut (only `kill -9`).
- `scripts/desktop-package.mjs` refuses to package because `package-lock.json` (core) resolves `@electron/node-gyp` over `git+ssh://`; the Linux artifacts were built with the same electron-builder command run directly.
- The theseus-rs Linux PostgreSQL build links system libraries it does not ship (OpenSSL, libxml2, zstd, lz4, GSSAPI, zlib; glibc 2.34+). No relocatable PostgreSQL 16 archive is pinned for the upgrade's old runtime. Ending orphaned backends after a crash is Linux-only.
- The enterprise engine is still one writer per workspace: several HTTPS front ends share sessions in PostgreSQL, but not two engines. The identity map stays on that engine's disk; keychain unlock does not work in a container; private token search still needs a loopback database.
- Updates cannot be served from GitHub release-download URLs, which always redirect; the feed and artifacts need a host that serves them directly.
- The public-copy dry run still finds the 5 npm-author email hits in `package-lock.json` (left for the founder), plus newer hits in other lanes' files (see round 4 below). The 3 invoice-follow-up markers are gone.
- The Windows launcher is built (round 4) but has run only under Wine, not on Windows.

## Full suite

`npm test` on `3d2f7bc` (after round 2): 4,230 tests, 4,199 passed, 1 failed, 30 skipped. The failure is `vault-encrypted-custody-bigint-identity.test.ts` ("unsafe-collision"), which fails the same way on the base branch; it depends on file-system inode numbers and is not touched by this lane. The skipped release tests are the real-binary ones (`release-postgres-real`, `release-enterprise-postgres`), which run only when pointed at a staged runtime or a real database, and did run here (see below). `desktop-host-bundle-join.test.ts` needs `--experimental-vm-modules`, which `npm test` supplies.

## Real Linux runs: PostgreSQL

Run on 2026-10-14 in a Linux x64 container (kernel 6.18, Ubuntu 24.04 userland, Node 24.13.1), as the unprivileged `postgres` account (uid 102). The checks and the staging are repeatable: `node scripts/release/verify-postgres-linux.ts --stage <dir> --old-bin /usr/lib/postgresql/16/bin --as-user postgres` (stage, then run the checks under that account through `runuser`), or `--runtime <dir>` to reuse a staged runtime. The same checks run as `platform/tests/release-postgres-real.test.ts` when `CHAUSAR_REAL_POSTGRES_RUNTIME` (and optionally `CHAUSAR_REAL_POSTGRES_OLD_BIN`) are set; without them, on another OS or as root it is skipped with the reason, so the normal suite stays offline.

**Pins (linux-x64 only; every other target stays `null`).** Each archive was downloaded and hashed here, and the hash matched the publisher's own checksum file. Both are third-party builds (`official: false`).

| Component | Archive | SHA-256 | Verified against |
|---|---|---|---|
| PostgreSQL 17.6 | theseus-rs `postgresql-17.6.0-x86_64-unknown-linux-gnu.tar.gz` (11.7 MB) | `19dbf09f0fc33255ff7596fc3ceb7696647286dd15fdf60f3f65c583aae6ad5d` | the release's `.sha256` asset next to the archive |
| Python 3.13.7 | python-build-standalone 20250818 `cpython-3.13.7+20250818-x86_64-unknown-linux-gnu-install_only.tar.gz` (119 MB) | `f3488a36ef5c10d01d346b9e540727d0807202c9bef52f40a987dc59ddc4ecee` | the release's `SHA256SUMS` |

`runtime-sources.json` records this in a new `checksumSource` field. The validator now requires `checksumSource` on every pin and refuses it on an unpinned entry.

**Staging.** `stage-runtime.ts --platform linux --arch x64` passed against the real archives: 5,116 files in 25 s, with PostgreSQL at 30 MB and Python at 496 MB. The recorded layouts were right: strip folder, `COPYRIGHT` and `lib/python3.13/LICENSE.txt`. The 8 libpq/ecpg symlinks and 1,047 Python symlinks (mostly terminfo) were materialised. One fix: materialising `bin/python` and `lib/libpython3.13.so` duplicated a 113 MB interpreter and a 246 MB library (839 MB in all). A new layout `exclude` list drops those two links. The binaries are unstripped upstream. The real staged tree passed the runtime checks of `scripts/package-preflight.mjs`: ELF64 x86-64 header checks on `postgres`, `initdb`, `pg_ctl` and `python3`, and the complete integrity and provenance manifest. The non-runtime checks failed only because that check ran outside the repository and without release keys.

**Real-run receipt** (`chausar.postgres-real-run.v1`, `ok: true`, PostgreSQL 17.6 bundled, 16.15 Ubuntu as the old major):

| Step | Result | Time |
|---|---|---|
| initdb, start, `pg` connect from the connection descriptor, `select 1` | pass; port 56400, password file `0600` | 1.0 s |
| live foreign lock (second instance on the same data root) | refused `POSTGRES_DATA_IN_USE`, lock `foreign` | 14 ms |
| orderly stop | stopped, `postmaster.pid` gone | 0.1 s |
| restart | same persisted port, data intact | 0.1 s |
| `kill -9` of the postmaster after 1,000 committed inserts | lock `stale`; restart replayed WAL ("not properly shut down; automatic recovery in progress", "redo starts/done"); 1,001 rows; `stale-lock-recovered` recorded | 0.3 s |
| `kill -9` while a backend runs a long query | the orphaned backend was found and ended; restart succeeded; rows intact | 2.6 s |
| data newer than the bundled major (`PG_VERSION` 18) | state `newer-than-app`, refused `POSTGRES_DATA_NEWER`, not started | 0.2 s |
| upgrade 16 → 17 (old cluster created by real PG 16 binaries, then crashed with `kill -9`) | `needs-upgrade`; start refused `POSTGRES_UPGRADE_REQUIRED`; no proof refused `BACKUP_REQUIRED`; with a real 40.8 MB tar vault copy and its SHA-256: crashed old cluster replayed by the PG 16 binaries, `pg_upgrade --check` then copy mode (`link: false`), 500 rows and their paise total intact on 17.6, `cluster.pre-17` kept with `PG_VERSION` 16 | 5.9 s |

The same run also passed with the data roots under a 126-character path (`…/work/upgrade`), longer than the socket limit.

**Bugs found by the real run and fixed in `postgres-lifecycle.ts`:**

- *Readiness meant "port open".* During crash recovery the server listens but answers `57P03 not yet accepting connections`, so `start()` returned too early. Worse, before an upgrade the crashed old cluster was stopped mid-recovery, and `pg_upgrade` then refused it ("shut down while in recovery mode"). Readiness now also requires `ready` in the lock file, as `pg_ctl -w` checks.
- *`delete_old_cluster.sh` would have deleted the live database.* `pg_upgrade` writes that script to its working folder (the data root). The script runs `rm -rf <data root>/cluster`, which after the swap is the upgraded cluster. `pg_upgrade` now runs from a private temporary folder that is removed afterwards.
- *Socket path length.* `pg_upgrade` put its sockets in its working folder. With a deep data root this went past the 107-byte Unix limit ("socket path … is too long"). It now gets `--socketdir` with that short private folder.
- *Orphaned backends after `kill -9`.* A backend busy in a query outlives its postmaster and keeps shared memory attached. The next start then failed with a generic `POSTGRES_START_FAILED` ("pre-existing shared memory block is still in use"). On Linux, the lifecycle now finds the `postgres` processes of the same user whose working folder is the data folder and ends them before restarting. This also covers the old cluster before an upgrade. The count is recorded as `orphansEnded`. If they will not end, the refusal is `POSTGRES_STALE_PROCESSES`.
- *Running as root* failed as `POSTGRES_INITDB_FAILED`. It now refuses up front with `POSTGRES_RUN_AS_ROOT`, on non-Windows platforms with the real runner.
- `pg_upgrade` failure output now reaches `onDiagnostic`.

The public API is unchanged. The new options are `effectiveUid`, `orphanedServerProcesses` and `killProcess`, with test doubles in `release-postgres-lifecycle.test.ts`.

**What this does not prove / still open:**

- The theseus-rs PostgreSQL links the system's `libssl.so.3`, `libcrypto.so.3`, `libxml2.so.2`, `libzstd.so.1`, `liblz4.so.1`, `libgssapi_krb5.so.2` and `libz.so.1`, and needs glibc ≥ 2.34. These are not vendored, so the "complete runtime" rule is not met for older or minimal distributions.
- The upgrade test lays the distribution's PG 16 `bin/` and `lib/` out as `postgres-16/` copies. No genuine relocatable PG 16 archive is pinned yet, and the README's `postgres-<major>/bin` layout needs `lib/` too for a build that resolves `$libdir` relative to `bin`.
- The orphan sweep is Linux-only. On macOS and Windows, a crash during a long query still surfaces as `POSTGRES_START_FAILED` until the old backends finish.
- Python was staged and launched (`python3` 3.13.7 runs from the staged tree) but not otherwise exercised. Nothing ran on macOS or Windows, on arm64, or under power loss as opposed to `kill -9`.
- `app/desktop/main.cjs` still starts PostgreSQL through `scripts/postgres-runtime.mjs`. These results apply to `BundledPostgres`.

## Real Linux runs: enterprise server

Run on 2026-10-14 in one Linux container (kernel 6.18, Node 24.13.1, Docker 29.8.2, Compose v5.6.0, PostgreSQL 16 server binaries from Ubuntu, `postgres:17` image). Nothing was pushed, published or deployed; every container, network and volume was removed afterwards.

### What changed

- **Remote PostgreSQL over verified TLS, enterprise only.** `PostgresSnapshotAdapter.connect` accepts a new `PostgresRemoteOptions` (`host` any name or address, plus `remoteTls: { ca, servername? }`). It connects with `ssl: { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', servername? }`; a missing or malformed CA is refused (`POSTGRES_TLS_REQUIRED`). The engine passes `remoteTls` only when the trusted host sets both `storageMode: 'enterprise-server'` and `postgresTls`; the enterprise `main.ts` is the only caller that does. Every existing call (desktop, owner server, tests) builds the same loopback-only options as before and takes the unchanged code path. The server refuses to start with a non-loopback database URL and no `database.caFile` (`POSTGRES_TLS_REQUIRED`).
- **Sessions in PostgreSQL.** `enterprise/server/state-store.ts`: `PostgresEnterpriseStore` (tables `chausar_enterprise_sessions`, `chausar_enterprise_logins`, `chausar_enterprise_rate_limits`) and `MemoryEnterpriseStore` behind one interface. Only SHA-256 digests of session ids and OIDC states are keys; client addresses are digested too. Expiry, sign-out, revocation and the per-request member re-check are unchanged; the OIDC state, nonce and PKCE verifier are taken with `DELETE … RETURNING`, so a state works once across processes. `main.ts` uses the PostgreSQL store over the same connection settings (and TLS) as the engine.
- **Docker.** The Dockerfile builds (optional `build_ca` BuildKit secret for a TLS-intercepting proxy, not stored in the image; proxy build args do not appear in `docker history`). `compose.yaml` now runs PostgreSQL with `ssl=on` and a `pg_hba.conf` with `hostssl` lines only, on an internal network; the server verifies the database certificate against a mounted CA. `testing/compose.smoke.yaml` adds a fake OpenID provider over HTTPS (test only), and `testing/compose-smoke.ts` runs the whole smoke test and tears it down.

### Results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Syntax check | `node scripts/check.mjs` | pass (688 files) |
| Release, PostgreSQL and workspace-PostgreSQL tests, no database URL | `node --experimental-vm-modules --test platform/tests/release-*.test.ts platform/tests/postgres-*.test.ts platform/tests/workspace-postgres-*.test.ts platform/tests/engine-keychain-postgres.test.ts` | 341 tests: 337 pass, 0 fail, 4 skipped (2 need the Windows C-drive fixture; 2 need `CHAUSAR_TEST_POSTGRES_URL`). `release-postgres-tls.test.ts` starts its own real cluster and is not skipped. |
| Same, with a real TLS-only PostgreSQL 16 on a non-loopback address (192.0.2.2) | same command with `CHAUSAR_TEST_POSTGRES_URL=postgresql://chausar:…@192.0.2.2:<port>/chausar` and `CHAUSAR_TEST_POSTGRES_CA=<ca.pem>` (cluster from `enterprise/server/testing/real-postgres.ts`, run as the unprivileged `postgres` user) | 341 tests: 339 pass, 0 fail, 2 skipped (Windows fixture) |
| Desktop still refuses a non-loopback host | `release-postgres-tls.test.ts` | pass: `192.0.2.10`, `db.example.com` and `localhost` refused with `INVALID_POSTGRES_CONFIG`; TLS options without the enterprise mode are ignored |
| Enterprise mode without TLS refuses | `release-postgres-tls.test.ts` | pass: engine `INVALID_POSTGRES_CONFIG`; adapter, session store and `main.ts` `POSTGRES_TLS_REQUIRED` |
| Enterprise mode with TLS against a real cluster (`ssl=on`, generated CA and server certificate, `hostssl` only) | `release-postgres-tls.test.ts` | pass: connects to 192.0.2.2 with the pinned CA (`pg_stat_ssl`: TLSv1.3); an unrelated CA and a wrong server name are refused; the plaintext loopback path is refused by the server; an engine creates, reopens and reads a workspace over TLS |
| Two server instances on one database | `release-enterprise-postgres.test.ts` (real cluster above) | pass: sign in on A, `/api/me` and `workspace.status` on B, sign out on B, refused (401) on A; a sign-in started on A finishes on B and cannot be replayed on A; revocation ends the session on both and deletes its row; a fresh instance after A stops still accepts the session; only the digest is stored |
| Image build | `docker build --network host --build-arg HTTPS_PROXY --secret id=build_ca,src=/root/.ccr/ca-bundle.crt -f enterprise/server/Dockerfile -t chausar-enterprise:dev .` | pass; 529 MB on disk, 130 MB compressed. Without the proxy CA, `npm ci` fails behind this container's proxy ("Exit handler never called"); the first base-image pull from Docker Hub got 429 and succeeded on retry. |
| Compose smoke | `node enterprise/server/testing/compose-smoke.ts` | 17/17 steps pass in about 18 s: postgres (TLS only) and fake IdP up; workspace created by the operator command; container healthy; `GET /healthz` from the host `{"status":"ok","vaultOpen":true}`; both Chausar connections (`chausar-vault`, `chausar-enterprise-sessions`) on TLSv1.3; plaintext `sslmode=disable` refused (`no pg_hba.conf entry`); sign-in through the fake IdP; `/api/me` (owner), `workspace.status`, `members.list`; session row in PostgreSQL; session survives `docker compose restart server`; sign-out ends it. Torn down: no containers, networks or volumes left. |

### What could not run or is still missing

- Several engine processes on one workspace. The engine is one writer per workspace (in-memory snapshot plus a writer lock in the workspace directory); a second engine would not see the first one's changes and its writes would be refused (`REVISION_CONFLICT`). The two-instance test therefore runs two HTTPS servers, each with its own PostgreSQL session-store pool, over one engine. Shared sessions give restart and hand-over survival, not active-active engines.
- The identity map (`identities.json`) stays in the server data directory, next to the single engine.
- Private token search (`PostgresInvestigationSearch` in `platform/runtime/investigation-search.ts`, not a release-lane file) still accepts a loopback database only, so it is unavailable with a remote database.
- Sign-ins in progress keep the PKCE verifier and nonce in the database for up to ten minutes (deleted on use).
- Not run: CI, a real identity provider, a managed PostgreSQL service, IPv6, client-certificate authentication to PostgreSQL, and `"keychain"` unlock in a container.

## Real Linux runs: desktop, launcher and updater

Run on 14 October 2026 in the Linux x64 cloud container (kernel 6.18, root user, Node 24.13.1, Electron 44.4.5 with Node 24.21.0, Xvfb, no FUSE, no xdotool). Synthetic keys, a synthetic feed served through the injectable HTTP seam and a demo profile only; nothing was signed, uploaded or published.

### What changed to make these reachable

| Item | Where | Label |
|---|---|---|
| Desktop start-up through `BundledPostgres`: runtime inventory check, stale-lock recovery; `needs-upgrade` starts the engine without a database (`CHAUSAR_DATABASE_STATE=needs-upgrade`, typed `POSTGRES_UPGRADE_REQUIRED` dialog; every database request fails closed); a newer cluster refuses start-up (`DATABASE_NEWER_THAN_APP`). Same `userData/database` layout (`cluster/`, `database-password`), so existing clusters carry over | `platform/runtime/native/desktop-database.ts`, one delimited block in `app/desktop/main.cjs` | **experimental** (real PostgreSQL 17.6 run below; no packaged non-demo app yet) |
| Start-up inventory of `runtime-binaries` against `manifest.json` (SHA-256 and size of every file; missing, changed and unlisted files refuse; a receipt keyed by manifest SHA-256, app version and a file-identity fingerprint in `userData/release/runtime-inventory.json` skips re-hashing) | `platform/runtime/native/runtime-inventory.ts` | **supported** |
| Launcher stub in front of `versions/<version>/` (POSIX sh) and its resolver (`resolve`, `adopt`) | `scripts/release/launcher/chausar-launcher.sh`, `platform/runtime/native/update-launch.ts` | **experimental** (Linux run below; macOS path untested; Windows not built) |
| Automatic `confirmHealthy` once a workspace opens; the data-schema marker rises only then | `release.status` in `lane-release.ts` (field `trial`), nudged by `main.cjs` after start-up and after `workspace.open/create/recover/restore` when `CHAUSAR_INSTALL_ROOT` is set | **experimental** |
| Built-in ZIP reader (central directory, stored + deflate through `zlib.inflateRawSync`, CRC-32 and size checks; refuses zip64, encryption, links, special files, absolute, `..`, backslash and drive paths, duplicates, file-as-folder, oversize and over-ratio entries) | `platform/runtime/native/update-zip.ts`, used by `update-install.ts` `defaultUnpack` | **supported** |
| Review fixes: the staged artifact is copied privately with `copyVerifiedPrivate` and only the copy is unpacked; rollback checks (`canReturnTo`) run inside the install lock; the launcher resolves through `resolveInstalledLaunch` (update-service.ts), which never rolls back past a raised data-schema marker and not at all without `<installRoot>/app-data.json` (written by `apply`); hard-linked unpacked files refuse; the trial attempt count stops one past the limit | `update-install.ts`, `update-service.ts` | **supported** |

Launcher design: the person runs `<installRoot>/chausar-launcher`. It never edits `current.json`: it runs an installed copy of Chausar in Node mode (`ELECTRON_RUN_AS_NODE=1 <versions/v>/<top>/<exe> resources/app.asar.unpacked/platform/runtime/native/update-launch.ts resolve --install-root <root>`), preferring the committed previous version while a new one is on trial (so a broken new build cannot block its own rollback), then `exec`s the chosen executable with `CHAUSAR_INSTALL_ROOT` set. In-place updates therefore need the unpacked archive (`tar.gz` on Linux); an AppImage cannot host the resolver and stays a standalone download. First install: `node update-launch.ts adopt --install-root <dir> --archive <tar.gz> --version <v> --launcher <chausar-launcher.sh> --executable-name chausar-preview` (the packaged copy of the stub is at `resources/app.asar.unpacked/scripts/release/launcher/`). Windows equivalent (not built, experimental): a `chausar-launcher.cmd` that runs `chausar.exe` with `ELECTRON_RUN_AS_NODE=1` on the same resolver and starts the printed executable; zip artifacts now unpack without `tar`.

Electron check: the main process can `await import()` a `.ts` file (type stripping works in Electron 44's Node 24.21.0, both in the main process under Xvfb and with `ELECTRON_RUN_AS_NODE=1`), so no `.mjs` bridge was needed. `scripts/postgres-runtime.mjs` is unchanged for other callers. `desktop-main.test.ts`'s seam now replaces the `desktop-database.ts` import (the old string no longer exists).

Dotfiles: electron-builder's resource filters drop dotfiles such as `runtime-binaries/.gitignore`. The start-up check skips a **listed** dotfile that is absent (reported in `skippedDotfiles`) and ignores an unlisted one; everything else must match. Note for `stage-runtime.ts` (another agent's file): its inventory should exclude dotfiles too, and `runtime-binaries/.gitignore` should not be packaged.

### Results

| Run | Command | Result |
|---|---|---|
| Typecheck, check, tests | `npm run typecheck`; `node scripts/check.mjs`; `node --experimental-vm-modules --test platform/tests/desktop-*.test.ts platform/tests/release-*.test.ts` | pass; pass (702 files); 310 tests, 307 pass, 0 fail, 3 skipped (env-gated real-PostgreSQL tests of other release work) |
| New tests | `release-update-zip`, `release-desktop-database`, `release-launcher`, `release-install-review`, two new cases in `desktop-main` | pass. `release-launcher` runs the real sh stub over real tar.gz versions with the real `UpdateService` (signed feed and manifest, stage, confirmed apply), two unconfirmed launches then automatic rollback, an engine-confirmed update (real `Engine` + release module wired from `CHAUSAR_INSTALL_ROOT`, marker raised to the confirmed version), and the kill switch's advised rollback |
| Preview packaging script | `node scripts/desktop-package.mjs --mode preview --platform linux --arch x64` | **blocked** by its lockfile gate: `package-lock.json` resolves `@electron/node-gyp` (an electron-builder dependency) through `git+ssh://`, which the gate refuses ("locked packages must resolve to HTTPS registry artifacts"). Core file; not changed here |
| Preview build | the exact builder invocation of that script (`electron-builder --config app/desktop/builder.preview.json --linux --x64 --publish never -c.extraMetadata.chausarPreviewExpiresAt=<+90 days>`, same environment), skipping only the lockfile gate, after `npm ci --ignore-scripts` and `node node_modules/electron/install.js` | pass |
| Artifacts | `release/preview/` (not committed) | `Chausar-Preview-0.1.0-preview.1-linux-x86_64.AppImage`: 175,102,286 bytes, SHA-256 `915adf79ee3f96052e17cba714be245143d187717678f0e656a09fb56f3f8e86`. `Chausar-Preview-0.1.0-preview.1-linux-x64.tar.gz`: 166,327,330 bytes, SHA-256 `f62458381467c9f26543d129842fc9a82d974f273a7f908c467b5909644e0ede` (one top folder `Chausar-Preview-0.1.0-preview.1-linux-x64/`, executable `chausar-preview`) |
| Artifact naming | | electron-builder names the AppImage `…-linux-x86_64.AppImage`, while `desktop-package.mjs` expects `…-linux-x64.AppImage` when it hashes outputs, so the script would fail after a successful build. Fix with `"appImage": { "artifactName": "Chausar-Preview-${version}-linux-x64.${ext}" }` or an arch mapping in the script (not changed here) |
| GUI launch | `linux-unpacked/chausar-preview --demo --ui-preview --no-sandbox` under `Xvfb :97`, screenshot with `import -window root` after 25 s, then SIGTERM | pass: the synthetic preview workspace opened on Today ("Chausar Preview (synthetic business)", owner); clean exit (code 0). `--no-sandbox` only because the container runs as root |
| Real launcher with the real app | adopt the built tar.gz as `0.1.0-preview.1`; repack it as `0.1.0-preview.2` and `.3` (only `resources/app.asar.unpacked/package.json`'s version changed); real `UpdateService` check → stage → confirmed apply; each launch through `<installRoot>/chausar-launcher` under Xvfb for 25 s | pass, in order: v1 launch (first-run screen); apply `.2` → trial; `--demo` launches without a workspace: attempts 1, then 2; third launch printed "version 0.1.0-preview.2 did not confirm a clean start twice; returned to 0.1.0-preview.1" and v1 ran (pointer committed, previous null); apply `.3`; a `--demo --ui-preview` launch opened the preview workspace and the engine committed the trial (pointer `0.1.0-preview.3`, committed, attempts 0); the next launch stayed on `.3`. The resolver ran in the packaged Electron's Node mode from `app.asar.unpacked` |
| Real PostgreSQL start-up through the desktop bridge | `runuser -u postgres -- node real-db.mjs` with the staged runtime (`/var/tmp/chausar-pg-runtime`, PostgreSQL 17.6 + Python 3.13.7) as `runtime-binaries` | pass: inventory of 5,116 files (535,384,966 bytes) hashed, then initdb and start, 5.0 s in all; `select version()` → PostgreSQL 17.6; SIGKILL of the postmaster, restart in 0.6 s from the inventory receipt (no re-hash), `stale-lock-recovered` recorded, the row written before the crash read back; a `PG_VERSION` 16 cluster → `needs-upgrade` / `POSTGRES_UPGRADE_REQUIRED`, untouched; a `PG_VERSION` 18 cluster → `DATABASE_NEWER_THAN_APP` |
| Electron smoke | `node scripts/desktop-electron-smoke.mjs` | pass (`ok: true`, graceful shutdown) |

### Could not run

- A packaged non-demo app with `runtime-binaries`: the preview config ships none (`extraResources: []`) and is always demo, so the inventory and `BundledPostgres` start-up ran through the bridge with the real runtime, not inside a packaged app. The final config was not built (it needs signing).
- The AppImage under FUSE (no FUSE here); the unpacked directory was launched instead. The AppImage is not an in-place update target (see the launcher design).
- The final `builder.json` still lists only `AppImage` for Linux; the launcher needs `tar.gz` there too (a one-line change plus its assertion in `release-build-config.test.ts`).
- macOS and Windows launchers; a launch as a non-root desktop user with the Chromium sandbox.
- A window-title check (no `xdotool` or `wmctrl`); screenshots were checked instead.

## Round 4: wake timer and start at login

SH-07 and TR-12 ("This computer"): waking the computer for jobs and starting at sign-in. Both are per-user OS mechanisms in `platform/runtime/native/`, with injectable runner, home folder, uid and clock, and handler-ready functions for the release module (methods `native.wake.status`, `native.wake.set`, `native.wake.clear`, `shell.startAtLogin`, `shell.setStartAtLogin`; registered in `lane-release.ts` separately).

### What changed

| Piece | Files | Label |
|---|---|---|
| Wake timer: one pending wake, ISO time with an explicit offset, rounded down to the minute, at least a minute and at most seven days ahead, confirmation required. Windows: Task Scheduler task `Chausar\Wake` (TimeTrigger in UTC, `WakeToRun`, InteractiveToken, LeastPrivilege, action = app `--background`) via `schtasks /Create /XML`. macOS: `pmset schedule wake "<MM/dd/yyyy HH:mm:ss>" Chausar` (local time; pmset has no offset syntax), refused `WAKE_TIMER_NEEDS_ADMIN` unless root, with the exact command in the plan, never a password prompt. Linux: `chausar-wake.timer` (`OnCalendar=<UTC> UTC`, `WakeSystem=true`, `Persistent=false`) + `chausar-wake.service` (app `--background`), daemon-reload, enable, restart; refused `WAKE_TIMER_UNAVAILABLE` without `/sys/class/rtc/rtc0/wakealarm` and `WAKE_TIMER_NEEDS_ADMIN` unless the user manager holds `cap_wake_alarm` (`systemctl show user@<uid>.service -p AmbientCapabilities`; root's always does) | `wake-timer.ts`, `os-integration.ts` | **experimental** |
| Start at login (off by default): Windows HKCU `...\CurrentVersion\Run` value `Chausar` = `"<exe>" --start-at-login` via `reg.exe add/delete/query` (no PowerShell); macOS LaunchAgent `in.chausar.login.plist` (RunAtLoad, no KeepAlive, never loaded or booted out by Chausar, so it neither starts a second copy nor stops the running one); Linux XDG autostart `~/.config/autostart/in.chausar.desktop` (Exec quoted per the Desktop Entry spec, `X-GNOME-Autostart-enabled=true`; an entry the session turned off reads as disabled). Status reports `matches` when the entry points to another executable | `start-at-login.ts`, `os-integration.ts` | **supported** (Linux), **experimental** (Windows, macOS: code only) |
| Desktop main process: `--start-at-login` starts hidden in the tray (no window until Open; closing the window keeps the tray) and grants nothing else (background jobs still need `--background`). A later launch with `--background` (the wake timer) or `--start-at-login` only wakes the running instance and never opens a window | `app/desktop/main.cjs` (delimited release-lane block + 4 one-line changes) | **supported** |

Electron's `app.setLoginItemSettings` was not used: the engine runs in a worker process and cannot call Electron APIs, it has no Linux implementation, and the OS-level mechanism is testable with an injected runner and a temporary home.

Notes for other lanes: the release refusal line in `preload.cjs` does not yet list `WAKE_TIMER_NEEDS_ADMIN`, `WAKE_TIMER_UNAVAILABLE`, `WAKE_TIME_INVALID`, `WAKE_TIME_PAST`, `WAKE_TIME_TOO_FAR`, `START_AT_LOGIN_UNSUPPORTED` (to be added with the method registration). The dev launcher (`desktopLaunchArguments`) does not accept `--start-at-login`; only installed launches use it. The host should pass the launcher path (not a versioned executable) as `executable` once in-place updates are used, or `matches` turns false after an update.

### Results

| Run | Command | Result |
|---|---|---|
| Typecheck, check, tests | `npm run typecheck`; `node scripts/check.mjs`; `node --experimental-vm-modules --test platform/tests/release-*.test.ts platform/tests/desktop-*.test.ts` | pass; pass (1162 files); 337 tests, 334 pass, 0 fail, 3 skipped (env-gated real-PostgreSQL tests) |
| New tests | `release-wake-timer.test.ts` (12), `release-login.test.ts` (7), two new cases in `desktop-main.test.ts` | pass: generated XML/units/plists/commands, escaping, rounding, past/too-far/offset-less times, confirmation, macOS non-root and Linux no-capability refusals before any write, symlink refusals, Windows UTF-16 task file removed after `/Create` |
| Real Linux start at login | `release-login.test.ts` "real Linux" case | pass: the autostart entry was written, read back (Exec parsed back to the exact executable, mode 0644, no temporary file), detected as disabled when edited to `X-GNOME-Autostart-enabled=false`, and removed, in a temporary HOME |
| Real Linux wake status | default runner, this container | `available: false`, `WAKE_TIMER_UNAVAILABLE` (no `/sys/class/rtc`; no user bus); `set` refused with nothing written |
| Generated units | `systemd-analyze verify` on the timer and service; `systemd-analyze calendar "2026-10-16 01:30:00 UTC"` | pass; normalized form unchanged |
| Generated XML | `xmllint --noout` on the Windows task and the login plist | pass |

### Could not run

- A real wake on any OS (needs a machine that sleeps and an RTC; this container has neither).
- Windows `schtasks /Create /XML` and `reg.exe`; macOS `pmset` and launchd at sign-in: code and recorded-command tests only.
- A Linux user manager with `cap_wake_alarm` (`systemctl --user` has no bus here), and a real desktop session reading the autostart entry.

## Round 4: enterprise identity map and search

Run on 2026-10-15 in one Linux container (kernel 6.18, Node 24.13.1, Docker 29.8.2, PostgreSQL 16.15 server binaries from Ubuntu for the test clusters, `postgres:17` image for compose). Nothing was pushed, published or deployed; every cluster, container, network and volume was removed afterwards. This section supersedes two lines under "What could not run or is still missing" in the enterprise section above: the identity map on disk and loopback-only search.

### What changed

| Item | Where | Label |
|---|---|---|
| Identity map in PostgreSQL. Table `chausar_enterprise_identities` holds issuer, `subject_hash` (the SHA-256 of `sub`), member id, role, branches (JSONB), `revoked` and `updated_at`, with `UNIQUE (issuer, subject_hash)` and checks on the digest shape and role. It is created with the other enterprise tables under the same advisory schema lock, over the same pool and TLS rules as the sessions (`PostgresEnterpriseStore.identities`) | `enterprise/server/state-store.ts` | **experimental** (real TLS-only PostgreSQL; never deployed) |
| Concurrency. A sign-in runs in one transaction. It takes `pg_advisory_xact_lock(hashtextextended('chausar-enterprise-identity:' + key, 0))` for its (issuer, subject), reads the row, and decides: reuse, refuse, or revoke-and-add through the engine. It then writes with `INSERT … ON CONFLICT (issuer, subject_hash) DO UPDATE` before `COMMIT`, with a `lock_timeout` of 30 s. A second process signing in the same person waits, then sees the first one's row and reuses its member. If the row cannot be written after the engine added a member, that member is revoked (`ENTERPRISE_IDENTITY_STORE_FAILED`) | `state-store.ts`, `identity.ts` | **experimental** |
| Revoked state recorded. When a sign-in finds the mapped member revoked in the engine, the row is marked `revoked = true`. Later sign-ins with the same mapping are then refused from the table as well (`ENTERPRISE_MEMBER_REVOKED`). A changed role or branch list provisions a new member and clears the mark | `identity.ts` | **experimental** |
| One-time import. An `identities.json` (version 1) in `dataDirectory` is checked as before: a regular file, not a link, owner-only mode, at most 8 MB, well formed. Its entries are inserted with `ON CONFLICT DO NOTHING`, so existing rows win, and the file is renamed `identities.json.imported`. If another process renamed it first (`ENOENT`), start-up continues. With the in-memory store the file is read but left in place | `identity.ts` | **experimental** |
| `MemoryIdentityStore` (a per-identity promise chain) for unit tests and for embedders without a shared store; `MemoryEnterpriseStore.identities` uses it. `createEnterpriseServer` now always takes the identity map from its state store, and no `identities.json` is written any more | `state-store.ts`, `server.ts` | **supported** (unit-tested contract) |
| Private token search on a remote PostgreSQL over verified TLS. `PostgresInvestigationSearch.connect` accepts `InvestigationSearchRemoteOptions`: `host` (a name or address) and `remoteTls: { ca, servername? }`, with only those two keys. It connects with `ssl: { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', servername? }` and checks `pg_stat_ssl.ssl` on its own backend. It records the server's own address rather than comparing it with the host name. A missing or malformed pin is refused before any connection (`POSTGRES_TLS_REQUIRED`). Without `remoteTls` the old code path runs unchanged: a literal loopback host, `ssl: false`, and the address must equal the host | `platform/runtime/investigation-search.ts` (core edit) | **experimental** |
| The engine passes `remoteTls` to the search adapter only when both `storageMode === 'enterprise-server'` and `postgresTls` are set, as it already does for the snapshot adapter | `platform/runtime/engine.ts` (one fenced spread in `privateSearchAdapter`) | **experimental** |

### Core edits

- **`platform/runtime/investigation-search.ts`.** Adds one exported type (`InvestigationSearchRemoteOptions`) and one helper (`remoteSearchTls`). Inside `connect` it makes three guarded changes:
  - `remoteTls` is an allowed key only when it is present;
  - the pool uses `ssl: tls`, where `tls` is `false` for every existing caller;
  - the identity check compares the address only for loopback, and requires TLS for a remote host.

  Reason: the search adapter refused every non-loopback host, so `research.search` could not run in the enterprise server with a database on another host. No other lane owns this file in round 4: core-data owns calculator, ontology, workbook, trust and mcp, and core-gateway-auth owns gateway, actions, vault and plugins.
- **`platform/runtime/engine.ts`.** Adds one spread in `privateSearchAdapter`, marked `release (round 4)`. Reason: the engine builds and closes the search adapter itself from its options, and the enterprise-only gate (`storageMode`) lives there. Injecting a search port through `options.research.search` would instead bypass the engine's own close on lock and shutdown. Desktop and owner-server engines never set `storageMode`, so they build the same loopback-only options as before.

### Results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Syntax check | `node scripts/check.mjs` | pass (1,159 files) |
| Release, investigation and PostgreSQL tests, no database URL | `node --experimental-vm-modules --test platform/tests/release-*.test.ts platform/tests/investigation*.test.ts platform/tests/postgres-*.test.ts` | 434 tests: 429 pass, 0 fail, 5 skipped. Of the skipped tests, 2 need the Windows C-drive fixture, 1 needs a staged runtime (`CHAUSAR_REAL_POSTGRES_RUNTIME`) and 2 need `CHAUSAR_TEST_POSTGRES_URL`. The new identity and search tests start their own real clusters, so they are not skipped. All existing `investigation*.test.ts` tests pass unchanged |
| Same, with a real TLS-only PostgreSQL 16.15 on a non-loopback address (192.0.2.2) | the same command with `CHAUSAR_TEST_POSTGRES_URL` and `CHAUSAR_TEST_POSTGRES_CA` (cluster from `enterprise/server/testing/real-postgres.ts`, run as the unprivileged `postgres` user) | 434 tests: 431 pass, 0 fail, 3 skipped (Windows fixture, staged runtime). `release-enterprise-postgres.test.ts` (sessions shared by two instances) passes with the identity map now in PostgreSQL |
| In-memory identity store | `release-enterprise-identity.test.ts` | pass. One identity is held at a time while another proceeds. A failed decision saves nothing, and an import never overwrites. Two directories sharing one store, racing four sign-ins of one new person, add one member; without a shared store they add two, which is the case the store prevents. Revoked state is recorded and kept until the mapping changes. A legacy file is read; a malformed or group-readable file is refused (`ENTERPRISE_IDENTITY_STORE_INVALID`) |
| Identity map, real TLS-only cluster | `release-enterprise-identity.test.ts` (starts its own cluster) | pass. See "Identity map against a real cluster" below |
| Search adapter refusals | `release-investigation-tls.test.ts` | pass. Without `remoteTls`, `192.0.2.10`, `db.example.com` and `localhost` are refused (`INVALID_POSTGRES_CONFIG`). Missing, empty, non-PEM, extra-key and badly named pins are refused (`POSTGRES_TLS_REQUIRED`). Driver controls such as `ssl` are still refused (`SEARCH_CONFIGURATION_INVALID`) |
| Desktop refuses; enterprise without TLS refuses | `release-investigation-tls.test.ts` | pass. `research.search` with a remote URL is refused with `INVALID_POSTGRES_CONFIG` in a desktop engine, in a desktop engine with `postgresTls` only, and in an enterprise engine without `postgresTls`. An enterprise engine with a pin takes the remote path: a malformed pin is refused with `POSTGRES_TLS_REQUIRED` |
| Enterprise search, real TLS-only cluster | `release-investigation-tls.test.ts` (starts its own cluster) | pass. See "Search against a real cluster" below |
| Image build | `docker build --network host --build-arg HTTPS_PROXY --secret id=build_ca,src=/root/.ccr/ca-bundle.crt -f enterprise/server/Dockerfile -t chausar-enterprise:dev .` | pass (no new runtime files; the identity store is in `state-store.ts`) |
| Compose smoke | `node enterprise/server/testing/compose-smoke.ts` | **24/24 steps pass** (was 17). See "Compose smoke" below. Torn down: no containers, networks or volumes left |

#### Identity map against a real cluster

- **Import.** `identities.json` was imported (1 entry), renamed `.imported` and not read again. The imported mapping signs in as the same member.
- **Constraints.** A second row for one (issuer, subject) is refused by `chausar_enterprise_identities_subject`, and a raw subject is refused by the check.
- **Three separate OS processes.** Each ran `testing/identity-race-child.ts` with its own pool over TLS, and all three started at the same instant on one new identity. Exactly one provisioned a member, and all three resolved to that member. The other two waited on the lock (at least 300 ms of a 400 ms hold). The table has one row.
- **Two HTTPS server instances.** Each had its own pool, store and identity directory, over one engine (the engine is one writer per workspace). Both finished the same new person's sign-in concurrently, three times. Each time, both sessions were the same member, exactly one member was added, and the table had one row.
- **Restart.** After both instances stopped and a fresh instance started with a fresh pool, signing in again gave the same member. Only digests are stored.

#### Search against a real cluster

- Plaintext loopback is refused by the server. An unrelated CA and a wrong server name are refused.
- With the pinned CA the adapter indexes a two-document projection:
  - "August payment" finds the investigation;
  - "private draft" finds the journal;
  - "September" finds nothing.

  The server identity is 192.0.2.2, PostgreSQL 16. With `servername: 'chausar-db.test'` over 127.0.0.1 the search works too.
- An enterprise engine creates a workspace and an investigation over TLS, and `research.search` returns the investigation (`engine: 'postgres'`). The same URL in a desktop engine is refused.

#### Compose smoke

The 17 earlier steps pass, plus seven new ones:

- the identity map is one row in PostgreSQL, with a 64-hex subject digest, the signed-in member's id and `revoked = false`;
- no `identities.json` is written on the server volume;
- `investigations.create` over `/api/rpc` succeeds;
- `research.search` over `/api/rpc` finds the new investigation in the remote database (`engine postgres`, server 172.18.0.2:5432, 1 match);
- a search for "September" finds nothing;
- the `chausar-private-investigation-search` connection uses TLSv1.3, alongside `chausar-vault` and `chausar-enterprise-sessions`;
- after `docker compose restart server`, a new sign-in is the same member, the member count is unchanged and the table still has one row.

### Still missing

- Active-active engines. The HTTPS race test shares one engine, because the engine is one writer per workspace: a second engine opening the same PostgreSQL workspace is refused with `VAULT_BUSY` (checked here). The identity lock itself is proven across real OS processes at the store level.
- An administrator's revocation is written to the identity table at that person's next sign-in, not when it happens. Sessions still end at once through the per-request member check.
- Not run or not supported:
  - search through a remote database whose server port is translated (the adapter requires the server's own port to equal the configured one);
  - IPv6;
  - a managed PostgreSQL service;
  - a real identity provider;
  - CI.

## Round 4: bundled PDF readers

Run on 15 October 2026 in the Linux x64 cloud container (Node 24.13.1, Docker 29.8.2). The installed app now ships the FR-07 PDF readers, so nothing needs downloading: `imports.readerStatus` reports them installed and `imports.installReader` verifies them instead of refusing.

### What changed

| Item | Where | Label |
|---|---|---|
| Reader staging: the staged interpreter's own pip installs hash-pinned wheels (`--no-deps --only-binary=:all: --require-hashes --no-compile`) into its site-packages, drops `bin/` console scripts, checks every installed `dist-info` against the pins, byte-compiles with checked-hash `.pyc`; conda-forge `.conda` packages (zip of `pkg-`/`info-*.tar.zst`, zstd through Node's zlib, archive listings checked for unsafe paths) are merged and only `bin/tesseract`, its shared-library closure and `share/tessdata/configs/tsv` are copied (symlinks materialised), plus every package's licences (`info/licenses`, or `licensePaths` in the payload for the GCC runtime packages) and the separately pinned `eng.traineddata`; writes `readers.json` (`chausar.readers.v1`); refuses another host (`READER_STAGE_HOST_ONLY`), unresolved targets (`READER_SOURCE_UNRESOLVED`), changed downloads, a different package set, missing closure files and missing licences | `scripts/release/stage-readers.ts`; `stage-runtime.ts` gains `--readers` / `--readers-only` (re-signs, tesseract included, and re-inventories) | **experimental** (Linux x64 run below; other targets unrun) |
| Pins: requirement files per target (one wheel per package, every hash equal to PyPI's JSON API digest, resolved with pip's dry-run report per platform tag) and a `readers` section in `runtime-sources.json` | `scripts/release/reader-requirements/*.txt`, `scripts/release/runtime-sources.json` | **supported** for linux-x64; recorded only elsewhere |
| `readerBundle({ resourcesPath, pythonExecutable })` and `verifyReaderBundle(...)`: read only `runtime-binaries/manifest.json` and `readers.json` (which must match its own manifest entry); the configured Python must be the bundled one; verification re-hashes the reader package folders, everything under `tesseract/` and `readers.json`, and refuses unlisted files there. No download | `platform/runtime/native/reader-bundle.ts` | **supported** |
| Helper lookup: `bundled_tesseract()` finds `<runtime>/tesseract/bin/tesseract[.exe]` beside `sys.executable` (`python/bin/python3` or `python/python.exe`): a regular file, not a link, whose real path stays inside the runtime; `TESSDATA_PREFIX` points at the bundled `tessdata`; otherwise the old `os.defpath` lookup. No `LD_LIBRARY_PATH` (conda's `RPATH $ORIGIN/../lib`) | `platform/helpers/analytics.py` (connectors-ext/helpers area; small edit) | **experimental** |
| `imports.readerStatus.sizeBytes` from `native.readerBundle`; `imports.installReader` calls `native.installReader` and returns `{ installed: true, downloaded: false, ...readerStatus }`; without the release method (`UNKNOWN_METHOD`, `METHOD_UNAVAILABLE`) or without a bundle (`READER_BUNDLE_MISSING`) it still refuses `READER_INSTALL_UNAVAILABLE` | `platform/runtime/connectors-ext/fr07.ts` (cross-lane edit) | **experimental** until `native.*` is wired |

### Round 4 contracts

- `native.readerBundle` (read, no payload) → `{ present, reason, python: { version } | null, packages: { pdfplumber, pypdfium2, Pillow } | null, tesseract: { version, languages } | null, sizeBytes | null, manifestSha256 | null }`. Absent reasons: `RUNTIME_NOT_BUNDLED`, `RUNTIME_MANIFEST_INVALID`, `READERS_NOT_BUNDLED`, `READERS_CHANGED`, `READERS_INVALID`, `PYTHON_NOT_CONFIGURED`, `PYTHON_NOT_BUNDLED`, `READER_PACKAGE_MISSING`, `OCR_PROGRAM_MISSING`. `sizeBytes` sums the manifest sizes under `python/` and `tesseract/`.
- `native.installReader` (admin, no payload) → `{ installed: true, downloaded: false, verifiedFiles, verifiedBytes, manifestSha256, bundle }`, or `READER_BUNDLE_MISSING` / `READER_BUNDLE_CHANGED`.
- Both take `resourcesPath` from the release module options (`process.resourcesPath` in the app) and `pythonExecutable` from `host.services.helper.options.executable` (the engine's `CHAUSAR_PYTHON`). The methods are wired by the coordinator in `lane-release.ts` and `module-methods/release.json`.

### Pins (linux-x64, staged and run)

| Part | Pin | Checksum source |
|---|---|---|
| pdfplumber 0.11.10, pdfminer.six 20260107, pypdfium2 5.14.0, Pillow 12.3.0, charset-normalizer 3.5.2, cryptography 50.0.2, cffi 2.1.1, pycparser 3.11 | `reader-requirements/linux-x64.txt` (manylinux_2_17/2_28 x86_64 or py3-none-any wheels) | PyPI JSON API `digests.sha256`, cross-checked with pip's report. cryptography (with cffi, pycparser) is required: pdfminer.six imports it at load time for encrypted PDFs |
| tesseract 5.5.3 (`h7618cdf_0`), leptonica 1.87.0 and 29 further conda-forge linux-64 packages (31 in all, the closure's owners) | `runtime-sources.json` `readers.targets.linux-x64.tesseract.packages` | conda-forge `repodata.json` sha256 via micromamba 2.9.0's solve |
| `eng.traineddata` (4,113,088 bytes, sha256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`) and its LICENSE | tesseract-ocr/tessdata_fast commit `87416418657359cb625c412a48b6e1d6d41c29bd` | hashed locally (git blob `bbef4675…`); byte-identical to the copy inside the pinned conda tesseract package |

Other targets: `linux-arm64`, `win32-x64`, `darwin-x64` (cryptography 48.0.1, the last with Intel macOS wheels) and `darwin-arm64` have pinned requirement files; pypdfium2 5.14.0 needs macOS 13. `win32-x64`, `darwin-x64` and `darwin-arm64` have conda-forge tesseract 5.5.3 package pins (repodata sha256) but no computed closure (`include: null`), so staging refuses. Windows also needs the embeddable Python's `python313._pth` to gain `Lib\site-packages` and `import site` (not done). `win32-arm64` has no pins: cryptography publishes no `win_arm64` wheel. The UB Mannheim Windows installer is recorded as an unpinned alternative (no publisher checksum could be read here).

### Results

| Run | Command | Result |
|---|---|---|
| Stage | copy of `/var/tmp/chausar-pg-runtime`, then `NODE_EXTRA_CA_CERTS=… PIP_CERT=… node scripts/release/stage-runtime.ts --platform linux --arch x64 --out <copy> --readers-only` | pass in 21 s: 8 Python packages, tesseract 40 files (39 ELF files + the TSV config), 33 licence files; manifest 6,614 files (was 5,116), 698,432,034 bytes (+163 MB: tesseract 96.7 MB, site-packages 67.4 MB) |
| Desktop start-up inventory | `verifyRuntimeInventory` on the staged copy | pass: 6,614 files verified in 5.1 s |
| Bundle record | `readerBundle` / `verifyReaderBundle` | present; Python 3.13.7; pdfplumber 0.11.10, pypdfium2 5.14.0, Pillow 12.3.0; tesseract 5.5.3, `eng`; `sizeBytes` 669,031,286; install verified 1,012 files (154,532,565 bytes) in about 1 s, no download |
| Real helper (`helper.ts` → `analytics.py`, staged Python, process limits on) | `CHAUSAR_TEST_READER_RUNTIME=<copy> node --test platform/tests/release-readers-real.test.ts` | `pdf.status` → `{pdfText: true, pdfOcr: true, tesseract: true}` (0.3 s); `pdf.extract` of a hand-built text PDF returns its four lines exactly (0.2 s); a Pillow-drawn picture-only PDF has no text layer and `pdf.ocr` reads all four lines exactly at confidence 95, engine 5.5.3, renderer pypdfium2 (1.0 s) |
| connectors-ext real OCR case on the bundle | `connectors-ext-ocr.test.ts`'s "real OCR" test with `CHAUSAR_PYTHON=<copy>/python/bin/python3` and its probe relaxed (scratch copy, not committed; its probe looks only on `os.defpath`) | pass: a two-page A4 300 dpi scanned statement OCRs at ≥ 80 confidence and passes the bank recipe's running-balance check (total 1750000) |
| Self-contained in a minimal OS | same test with `CHAUSAR_TEST_READER_DOCKER=1`: `docker run --network none debian:bookworm-slim` with only the runtime and `analytics.py` mounted read-only (image pulled through `mirror.gcr.io` after Docker Hub returned 429) | pass: OCR reads all four lines; `ldd` inside the container resolves everything to the bundle except glibc (libc, libm, libpthread, libdl, libresolv, ld-linux; Debian 12.15, glibc 2.36) |
| Typecheck, check, tests | `npm run typecheck`; `node scripts/check.mjs`; `node --experimental-vm-modules --test platform/tests/release-*.test.ts platform/tests/connectors-ext*.test.ts platform/tests/helper*.test.ts` | pass; pass; 457 tests, 449 pass, 0 fail, 8 skipped (env-gated) |

A finding on the way: tesseract's `tsv` output needs `tessdata/configs/tsv`; with only `eng.traineddata` in `TESSDATA_PREFIX` it silently prints plain text and the helper reads no words. The config is part of the closure now.

### Still missing

- `native.readerBundle` / `native.installReader` wiring in `lane-release.ts` and `release.json` (coordinator).
- Windows and macOS: closures not computed, never staged or run; Windows `._pth` change not made; macOS signing of the bundled dylibs (the sign hook now covers `tesseract/`) not run.
- The conda binaries keep their build-prefix placeholders (default tessdata, OpenSSL and Kerberos configuration paths); the helper always sets `TESSDATA_PREFIX` and never uses the network paths, so they are inert, but they are not rewritten.
- libcurl, OpenSSL, Kerberos and ICU ride along because the conda tesseract links them (about 45 MB); a tesseract built without URL input would drop them.
- `connectors-ext-ocr.test.ts` and `connectors-ext-fr07.test.ts` gate their real cases on `os.defpath` tesseract and on pypdf/reportlab, so with only the bundled runtime they skip (connectors-ext may switch the OCR probe to `pdf.status`).
- No packaged app was built with the readers; the run used the staged folder through the helper and the desktop inventory check.

## Round 4: keychain on a real Secret Service, Windows launcher, public copy

### What changed

| Piece | Files | Status |
|---|---|---|
| A real Secret Service run of the Linux keychain helper, scripted, printing a JSON receipt | `scripts/release/verify-keychain-linux.ts`. Test: `platform/tests/release-keychain-real.test.ts`. The test runs only with `CHAUSAR_REAL_KEYCHAIN=1`; it uses `CHAUSAR_REAL_KEYCHAIN_HELPER` or compiles the helper with CMake. | **experimental** (libsecret on Linux has now run against a real store; the Windows and macOS stores still have not) |
| Bug fix in the Linux helper: reads no longer require the stored content type | `platform/native/keychain/linux.cpp` and its README | **experimental** |
| Windows launcher stub | `scripts/release/launcher/chausar-launcher.cmd`. `adopt` places it as `chausar-launcher.cmd` (`update-launch.ts`). Both builder configs set `win.executableName: "Chausar"`, so the app is `Chausar.exe`. Test: `platform/tests/release-launcher-cmd.test.ts`. | **experimental** (static checks and a Wine run; **not run on Windows**) |
| Public-copy markers in `platform/runtime/invoice-follow-up.md` | Its one "Requirements" line, rewritten without the internal plan names or links into `docs/specs/` | done |

### Keychain: how it ran

`node scripts/release/verify-keychain-linux.ts --build <dir> --as-user <name>` works in five steps:

1. It compiles `platform/native/keychain` with the real libsecret backend (CMake, as in `native-keychain.yml`).
2. It starts its own `dbus-daemon` session bus.
3. It starts `gnome-keyring-daemon --unlock --components=secrets` with a random throwaway password under a temporary `HOME`.
4. It pins the helper with `keychain-manifest.ts`.
5. It loads the helper through the engine's own manifest reader (`loadEngineKeychain`).

So the real `PlatformKeychain`, with its real pin, ownership and environment checks, runs the real helper. Nothing touches a person's own keyring. Keys and vault ids are random and are never printed.

Setup: an Ubuntu 24.04 container with libsecret 0.21.4, GLib 2.80.0, gnome-keyring 46.1 and D-Bus 1.14.10. It ran as an unprivileged account (uid 30033) and again as root; both runs pass. The receipt:

| Step | Result |
|---|---|
| `secret-service-started` | A private bus; `org.freedesktop.secrets` is owned by gnome-keyring; the default collection `/org/freedesktop/secrets/collection/login` is unlocked. |
| `manifest-written-and-loaded-by-engine` | Helper sha256 `9e53c6c3d33c22ecabc8620c3999dac7a8654b7ac21a6df42fe77289cf7b07e8` (29,536 bytes; two builds produced the same bytes). A wrong pin refuses `KEYCHAIN_UNAVAILABLE`. |
| `store-retrieve-conflict-remove` | Absent, then store, then retrieve: the bytes are equal. Storing the same key again succeeds. A different key gets `KEYCHAIN_CONFLICT` and the entry is unchanged. `secret-tool` sees exactly 1 item under schema `in.chausar.vault.v1` (label "Chausar vault key"). After remove, retrieve finds nothing, a second remove succeeds, and 0 items are left. |
| `vault-created-with-custody-reopened-with-keychain` | `Vault.create` registers the key and `Vault.openWithKeychain` reopens it. `delete` removes the entry; reopening afterwards gives `UNLOCK_FAILED`. |
| `engine-workspace-open-unlock-keychain` | An `Engine` (demo, experimental-file storage, real provider) runs `workspace.create`, then lock. A fresh engine's `workspace.open { unlock: 'keychain' }` opens the same vault. `workspace.delete` removes the entry, and a second keychain unlock gives `UNLOCK_FAILED`. |
| `no-session-bus` | With the address of a missing socket, the helper runs and answers "unavailable", giving `KEYCHAIN_UNAVAILABLE`. With the address unset, the request is refused before any helper launch, also `KEYCHAIN_UNAVAILABLE`. |
| `bus-without-secret-service` | On a second bus with no keyring, retrieve and store give `KEYCHAIN_UNAVAILABLE`. Nothing was auto-started. |
| `locked-keyring` | With the login collection locked over D-Bus, retrieve, store (new key and same key) and remove all give `KEYCHAIN_DENIED`, with no prompt and no hang (about 0.3 s). `workspace.create` refuses with `KEYCHAIN_DENIED` and leaves no workspace. |

**Bug found and fixed.** The helper compared the stored secret's content type with `application/vnd.chausar.vault-key`, but gnome-keyring returns every secret as `text/plain`. So every entry the helper wrote read back as a conflict:

- retrieve gave `KEYCHAIN_CONFLICT`;
- a second store of the same key gave `KEYCHAIN_CONFLICT`;
- keychain unlock always failed with `UNLOCK_FAILED`.

The first real run showed this: steps 3 to 5 failed. Reads now identify the entry by its exact schema, service and account attributes and its 32-byte size. The content type is still written. `PlatformKeychain` and `engine-keychain-host.ts` needed no change.

What this run does not prove:

- other Secret Service providers (KWallet, KeePassXC);
- a desktop session's real login keyring and its unlock at login;
- concurrent helpers against one vault;
- duplicate entries made by another client;
- Windows Credential Manager and the macOS Keychain, which have still never run.

In the worker host, `"keychain"` unlock still needs PostgreSQL storage (non-demo). The engine path here used the demo file storage, with the real provider passed in directly.

### Windows launcher

`chausar-launcher.cmd` follows the same design as the sh stub:

- It never edits `current.json`.
- It runs an installed `Chausar.exe` with `ELECTRON_RUN_AS_NODE=1` on the packaged resolver: `resources\app.asar.unpacked\platform\runtime\native\update-launch.ts resolve --install-root <root> --executable-name Chausar.exe`.
- While a new version is on trial, it tries the previous committed version first, then the current one.
- It reads the resolver's `key=value` lines, runs the chosen executable with `CHAUSAR_INSTALL_ROOT` set and Node mode cleared, and returns the app's exit code.
- Its refusals match the sh stub: 64 when the executable name is not plain, 66 when nothing is installed, and 70 when no copy could resolve or there is no executable.

Quoting rules in the stub:

- It runs under `setlocal EnableExtensions DisableDelayedExpansion`.
- Every path appears only inside double quotes.
- Values from `current.json`, folder names and the resolver arrive through FOR variables or SET and are never parsed again. There is no CALL.
- The two short delayed-expansion scopes (the name check and the pointer rewrite) touch no path.
- A `CHAUSAR_EXECUTABLE_NAME` override is read from SET's raw output and checked before use.
- The resolver's output goes to a temporary file in `%TEMP%`, not through `for /f` over a command, so no second cmd re-reads a path.
- The file is ASCII with CRLF line endings; `scripts/release/launcher/.gitattributes` (`*.cmd -text`) stops git from converting them.

`release-launcher-cmd.test.ts` has three parts:

1. **Static reading** of the file. It checks: CRLF and ASCII; setlocal comes first; no CALL; `!` only inside the delayed scopes; every path quoted; labels; Node mode set and cleared around the resolver; previous-first ordering; exit codes equal to the sh stub's; the pointer is never written.
2. **Packaging and placement.** It checks that both builder configs package `scripts/release/launcher/**/*` and name the Windows executable `Chausar`. It runs `adopt` to place the stub with the default and a custom executable name, and checks that an LF copy is refused.
3. **A Wine run**, only when `CHAUSAR_TEST_WINE_NODE` names a Windows `node.exe`. Here: Wine 9.0 and Node 24.13.1 win-x64, its published SHA-256 checked. The stub runs over a real install root named `Chausar & Co! x`, with `node.exe` standing in for `Chausar.exe` and the real resolver. The run passes:
   - Version 2.0.0 launches twice on trial. Its own resolver is broken, so 1.0.0's copy resolves.
   - The third launch returns to 1.0.0 and prints the rollback message.
   - The app's exit code 7 comes back. `CHAUSAR_INSTALL_ROOT` arrives, `ELECTRON_RUN_AS_NODE` does not, and arguments pass through.
   - Six hostile names refuse with 64 and run nothing: `..\evil.exe`, an injection attempt with `"` and `&`, `a&b.exe`, `%PATH%`, `bang!.exe` and `.hidden.exe`.
   - The last two launches give 70 (no copy can resolve) and 66 (no install).

Wine is not Windows. Wine 9's cmd has six gaps that real Windows cmd does not:

- no `findstr /r`;
- `for /d` with a quoted pattern is misread;
- `%%~` modifiers in nested loops are misread;
- `pushd` reports the wrong status to `||`;
- a quoted `)` inside a block ends the block;
- a `%` in the path is lost from `%~dp0`.

The stub avoids the first four. The Wine run avoids the last two by keeping `(`, `)` and `%` out of its path; the static test covers their quoting. **The stub has not run on Windows.** Still to do: a Windows run with a real packaged `Chausar.exe`, and checking how the console window looks when a shortcut starts the stub.

### Public copy

A dry run of `node scripts/release/public-copy.ts --out <tmp>` after the edit copied 1,752 files and found:

| Kind | Hits |
|---|---|
| private-key | 0 |
| token | 0 |
| email | 24 |
| private-link | 7 |
| fleet-marker | 15 (was 19: the 3 `invoice-follow-up.md` markers are gone, and so is a private base-branch name in this document's "Full suite" paragraph) |
| licence | 0 |

The 5 npm-author emails in `package-lock.json` stay (the founder's decision). The other hits are in files merged since round 3, mostly other lanes':

- **19 emails** in tests and fixtures: the hosted-link relay and mail tests, connectors-ext payments, learning-ext, models-ext speech and reports-tools-trust.
- **7 private-host URLs** in tests: 6 in frame-today and connectors-ext tests, and 1 deliberately hostile URL in `release-attack-signatures.test.ts`.
- **15 fleet markers:** the `claude/lane-<id>` branch line in 10 lane documents (this one included), 4 in work-books files and tests, and 1 in a hosted-link test.

These are synthetic or fleet-internal details. The coordinator or the owning lanes need to clear or allowlist them before publishing.

### Commands run

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `node scripts/check.mjs` | pass (1,160 files) |
| `node --experimental-vm-modules --test platform/tests/release-*.test.ts platform/tests/*keychain*.test.ts` | 275 tests: 270 pass, 0 fail, 5 skipped. Two need `CHAUSAR_TEST_POSTGRES_URL` and one a staged PostgreSQL runtime; the real-keychain and Wine tests skip without their variables and pass with them. |
| `CHAUSAR_REAL_KEYCHAIN=1 CHAUSAR_TEST_WINE_NODE=<node.exe> node --test platform/tests/release-keychain-real.test.ts platform/tests/release-launcher-cmd.test.ts` | 7 of 7 pass |
| `node scripts/release/verify-keychain-linux.ts --build <dir> --as-user kcuser` | receipt `ok: true` (above) |
