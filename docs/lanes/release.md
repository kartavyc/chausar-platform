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
| Release build configs (NSIS, dmg + zip, AppImage) | `app/desktop/builder.json`, `entitlements.mac.plist` | **experimental** (never packaged here) |
| Windows signing through a cloud key service (DigiCert KeyLocker or SSL.com eSigner) | `scripts/release/windows-sign.cjs` | **experimental** (needs the certificate) |
| macOS signing and notarization | `builder.json`, `release.yml` | **experimental** (needs an Apple account) |
| Release CI with checksums | `.github/workflows/release.yml`, `ci.yml` job `release-config`, `scripts/release/checksums.ts`, `sign-update-manifest.ts` | **experimental** (never run on GitHub) |
| Runtime-binary staging with checksum inventory | `scripts/release/stage-runtime.ts`, `runtime-sources.json` | **supported** (synthetic archives; the real pins are not filled in) |
| Bundled PostgreSQL lifecycle: initdb, start, stop, port, crash recovery, upgrade | `platform/runtime/native/postgres-lifecycle.ts` | **experimental** (fake runner only; no real binaries here) |
| Signed update channel, staged rollout, kill switch | `platform/runtime/native/update-channel.ts`, `update-feed-client.ts` | **supported** |
| Staging, atomic swap, trial launch, automatic and manual rollback | `update-install.ts`, `update-service.ts` | **supported** (zip, tar.gz, AppImage; native installers refuse) |
| Expiry on preview builds | `update-expiry.ts` | **supported** |
| Vault copy before a schema change; older app refuses a newer vault | `update-data-guard.ts`, `release.applyUpdate` | **supported** |
| Native keychain providers (Windows Credential Manager/DPAPI, macOS Keychain, libsecret) | existing `platform/native/keychain` helper and `PlatformKeychain`; status in `native/keychain-status.ts`; manifest writer `scripts/release/keychain-manifest.ts` | **experimental** (not run against a real OS store) |
| OS background service install | `platform/runtime/native/background-service.ts` | **experimental** (generators and installer tested with a fake runner) |
| Public releases page generator | `scripts/release/releases-page.ts`, `releases.json` | **supported** |
| Supported and experimental lists generator | `scripts/release/feature-lists.ts`, `supported-evidence.json` | **supported** |
| Clean public copy with allowlist, scan and licence tags | `scripts/release/public-copy.ts`, `public-allowlist.json` | **supported** (dry run; publishing waits for the licence) |
| Enterprise server: HTTPS, OIDC, roles, branch scope, browser UI | `enterprise/server/` | **experimental** (tested with a fake identity provider; never deployed) |
| Enterprise Docker image and compose file | `enterprise/server/Dockerfile`, `compose.yaml` | **experimental** (never built) |

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
| `RUNTIME_SOURCE_UNPINNED`, `RUNTIME_SOURCE_UNAVAILABLE` | SHA-256 pins for the PostgreSQL and Python archives; a PostgreSQL build for Windows on Arm. |
| `LICENCE_UNDECIDED` | The licence choice before the public copy is published. |

## Still missing

- Nothing has run on a real Windows, macOS or Linux machine: no installer, keychain store, service manager, PostgreSQL binary or power-loss test.
- Desktop wiring: the module reads its trusted options from the engine worker's own environment (`CHAUSAR_UPDATE_PUBLIC_KEY`, `CHAUSAR_UPDATE_FEED_URL`, `CHAUSAR_KEYCHAIN_MANIFEST` → resources path, `CHAUSAR_APP_EXECUTABLE` or the packaged Electron executable) and the package's `chausarReleaseChannel`/`chausarPreviewExpiresAt` (stamped by `scripts/desktop-package.mjs`, 90 days). `app/desktop/main.cjs` (frame-today) still starts PostgreSQL through `scripts/postgres-runtime.mjs`; `native.databaseStatus` reads the same `userData/database` cluster, but switching the start-up to `BundledPostgres` (crash recovery and upgrade at launch) is a merge step in `main.cjs`. Nothing calls `resolveLaunch` before start yet: the in-place swap needs a small launcher stub in front of `versions/<version>/`, which is not built, so the automatic trial rollback is tested but not reachable from an installed app.
- The enterprise server needs a core change to reach a PostgreSQL on another host with TLS (`postgres.ts` accepts loopback only); sessions are in memory, so one process only; keychain unlock does not work in a container.
- `scripts/check.mjs` skips folders named `release`, so `scripts/release/*` is syntax-checked only through the tests and typecheck.
- Zip artifacts on Linux need an unpacker other than GNU tar.
- The public-copy dry run finds 5 email hits (one npm author's public address in `package-lock.json`) and 3 private-detail markers in `platform/runtime/invoice-follow-up.md` (another lane's file).
- Electron-builder may drop `runtime-binaries/.gitignore` when packaging, so the packaged copy can differ from its inventory by that one file; nothing checks the installed copy today.

## Full suite

`npm test` on `55d6f5f`: 4,163 tests, 4,132 passed, 4 failed, 27 skipped. The four failures are in `platform/tests/benchmark-sharding.test.ts` and fail identically on the base branch (`claude/clever-goldberg-49qobq`); they are not caused by this lane. `desktop-host-bundle-join.test.ts` needs `--experimental-vm-modules` and fails under a plain `node --test` (also on the base).

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
