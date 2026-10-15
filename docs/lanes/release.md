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
- The public-copy dry run finds 5 email hits (one npm author's public address in `package-lock.json`, left for the founder) and 3 private-detail markers in `platform/runtime/invoice-follow-up.md` (another lane's file).
- The Windows launcher is documented, not built.

## Full suite

`npm test` on `3d2f7bc` (after round 2): 4,230 tests, 4,199 passed, 1 failed, 30 skipped. The failure is `vault-encrypted-custody-bigint-identity.test.ts` ("unsafe-collision"), which fails the same way on the base branch `claude/clever-goldberg-49qobq`; it depends on file-system inode numbers and is not touched by this lane. The skipped release tests are the real-binary ones (`release-postgres-real`, `release-enterprise-postgres`), which run only when pointed at a staged runtime or a real database, and did run here (see below). `desktop-host-bundle-join.test.ts` needs `--experimental-vm-modules`, which `npm test` supplies.

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
