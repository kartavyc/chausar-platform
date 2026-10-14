# Signed release verification and staging

`ReleaseUpdater` verifies detached Ed25519 signatures using an explicitly pinned release public key. There is no unsigned path or generated production signing identity. Test keys exist only in tests. The verifier and artifact staging are implemented; native installer execution, OS publisher certificates, a production update feed, and data-migration rollback remain unqualified.

```ts
const updater = new ReleaseUpdater({
  publicKey: pinnedEd25519PublicKeyPem,
  version: runningVersion,
  stageDirectory: absolutePrivateDirectory,
});
const verified = updater.verify(canonicalManifestText, detachedSignatureBase64url);
const staged = await updater.stage(canonicalManifestText, detachedSignatureBase64url);
// staged.installed is false. No executable is run.
```

The signature payload is the UTF-8 output of `canonicalReleaseManifest`: JSON object keys sorted lexically at every level, no whitespace, fixed integers and strings, and exactly the documented fields. The detached signature uses unpadded base64url. A raw manifest string must exactly equal its canonical form, preventing alternate encodings and duplicate keys from having ambiguous signing meaning. Manifest objects are cloned and checked before use. Node's Ed25519 verifier receives a null digest algorithm, as required by its [official crypto documentation](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback).

```json
{
  "schemaVersion": 1,
  "version": "1.1.0",
  "publishedAt": "2026-09-01T00:00:00.000Z",
  "platform": "win32",
  "architecture": "x64",
  "url": "https://downloads.example.com/chausar.pkg",
  "sha256": "a 64-character lower-case hexadecimal digest goes here",
  "size": 123456,
  "minEngineVersion": "1.0.0",
  "dataSchemaVersion": 1,
  "rollback": { "supported": true, "requiresBackup": true }
}
```

This readable example is a schema illustration, not a usable release or signature. Only a manifest with a real 64-character digest, canonical payload, valid signature, and matching artifact can stage.

The manifest is limited to 64 KiB. It must target the running operating system and architecture, name a newer semantic version, and support the current minimum engine version. Numeric version components and prereleases are compared correctly. A valid previously staged higher version prevents replaying a lower release. Same-version manifests with different contents are refused. This is software rollback resistance; a malicious disk administrator can remove local stage history, so no hardware anti-rollback protection is claimed.

Artifacts use a canonical public HTTPS URL with no user credentials, redirect, IP-literal destination, or nonstandard port. The single download is bounded by the signed length, capped at 256 MiB, and given a sixty-second timeout. The complete byte length and SHA-256 must match before a private staged artifact is published. The stage directory rejects symbolic links and uses an exclusive lock, private temporary files, file fsync, and atomic replacement of the pending plan. Existing artifacts are checked again; changed bytes fail.

The shared process lock publishes complete private JSON containing the PID, random token and start timestamp atomically. An abruptly stopped writer is reclaimed only when `process.kill(pid, 0)` reports `ESRCH`. Live or reused PIDs, permission failures and unrecognized owner records remain locked. Recovery uses an atomic claim for the exact original bytes and rereads them before unlinking; competing recoverers cannot remove the winner's replacement lock. A crashed recovery claim advances to a new immutable generation, with a maximum of 32 abandoned generations and two retries for a vanishing claim. Completed recovery removes its claims. Interrupted recovery can leave private claim or temporary files, and exhausted bounds require operator inspection after all writers have stopped. Legacy token-only updater locks lack a verifiable PID and are deliberately not reclaimed automatically. These subprocess interruption tests do not establish native installer or hardware power-loss guarantees.

The return value describes the signed manifest, artifact path, previous running version, and rollback prerequisites. It always declares `installed: false`, requires a verified previous package and a vault backup, and requires a native installer. `rollback.supported` is the publisher's declaration, not an executed rollback test. No downloaded code, script, or installer is run, even if its signature is valid.

Before release qualification, ship audited platform-specific runtimes, configure the real release key, obtain the required publisher signatures, verify old-install updates with existing vaults, measure interruption and power-loss behavior, and test restoration across data-schema changes. Windows directory durability and installer-level atomic replacement need native verification. A clearly labelled source preview remains the correct status until these checks pass.

## Update channel, staged rollout, kill switch and swap (release lane, 14 October 2026)

The release lane builds on `ReleaseUpdater` without changing it. Code lives in `platform/runtime/native/update-*.ts`; the engine methods are in `platform/runtime/modules/lane-release.ts`.

- **Channel document** (`chausar.channel.v1`): canonical JSON signed with the same pinned Ed25519 key, at `<feedUrl>` with its signature at `<feedUrl>.sig`. It lists, per platform and architecture, each release's version, manifest SHA-256, rollout percent, a `withdrawn` flag and, on the preview channel, the build's expiry. The feed itself expires within 30 days, and an older `issuedAt` than the last accepted one is refused (`UPDATE_FEED_ROLLBACK`), so a stale or replayed feed cannot freeze or downgrade an install.
- **Staged rollout:** an install takes a release only when `sha256(installId + version)` falls inside the rollout percent. The install id is random, stored at `<appData>/release/install-id`, and is used for nothing else.
- **Kill switch:** when the running version is marked withdrawn, `release.checkUpdate` returns `rollback-advised` with the highest earlier version that is not withdrawn.
- **Manifests** are fetched from `releases/<version>/<platform>-<arch>.json` (and `.sig`) beside the feed; their SHA-256 must equal the feed's entry before `ReleaseUpdater.verify` checks the signature.
- **Swap:** zip, tar.gz and AppImage artifacts unpack into `<installRoot>/versions/<version>/`; `current.json` is replaced atomically (temporary file, fsync, rename, directory fsync). A new version starts in `trial`; it is committed by `release.confirmHealthy`, and after two launches without that confirmation the launcher rolls back by itself. `release.rollback` flips back by hand. Two old versions are kept. Windows NSIS and macOS dmg installers are never executed: `NATIVE_INSTALLER_REQUIRED`.
- **Data guard:** an update that raises the data schema needs a fresh vault copy; `release.applyUpdate` makes one through `workspace.backup` and hashes it before the swap. The marker `<appData>/release/data-schema.json` records the highest schema written; an older app refuses it with `VAULT_NEWER_THAN_APP`. `apply` does not raise the marker: the new app does when it migrates, so a rollback before migration still opens the vault.
- **Preview expiry:** a preview build carries `chausarPreviewExpiresAt`; after that instant `release.status` reports `build.usable: false` and `updateNeeded: true` (the frame's "update needed" banner).

### Adversarial review (release lane, 14 October 2026)

`platform/tests/release-attack-*.test.ts` holds one test per attack tried; passing means it is refused. Results and remaining limits:

- **Encoding and signatures:** duplicate keys, unicode escapes, `1.0`/`1e0` numbers, whitespace and a byte-order mark are refused because the text must equal its canonical form. Malleated Ed25519 signatures (S + L), padded or standard-alphabet base64 and non-zero trailing bits are refused. Manifests and channel documents share one key without a domain tag; their exact-key schemas are disjoint, so one can never verify as the other (tested). A feed served with a leading byte-order mark is decoded to the same signed text, which is harmless.
- **Key confusion:** `releasePublicKey` (updater.ts) is the one key parser. X25519, RSA and private keys are refused; a private-key PEM is no longer silently turned into its public half (that would ship the signing secret in the app).
- **Withdrawal after download:** the last accepted feed's signed text is kept (`<appData>/release/channel-document.json`) and re-verified. `apply` refuses a staged release the newest accepted feed withdrew (`UPDATE_WITHDRAWN`) or names with a different manifest digest; `release.rollback` refuses a withdrawn previous version (`ROLLBACK_TARGET_WITHDRAWN`). A changed saved feed fails closed (`UPDATE_FEED_STATE_INVALID`).
- **Rollback and data schema:** `apply` records both versions' data schemas in `<appData>/release/version-schemas.json` before the pointer moves. `release.rollback` refuses `VAULT_NEWER_THAN_APP` when the marker is above the previous version's schema (or that schema was never recorded). **Safe rule for the automatic trial rollback:** the launcher never rolls back past a raised marker; the trial stays current with `rollbackUnavailable: true`, and the backup taken before the swap is the way back. Without a migration the automatic rollback works as before. The service checks the pointer before the layout takes its install lock; a second engine process swapping versions in between is not covered until the layout itself takes the check (see the patch note in the release-lane review).
- **Documented limits:** the feed anti-rollback anchor (`channel-state.json`), the install pointer and the schema ledger are local files. Deleting the anchor re-admits any unexpired older feed (at most 30 days old): that freezes updates or withdrawal news for that window, but cannot install a lower version (`RELEASE_DOWNGRADE_REFUSED`). Switching the channel and back also resets the anchor. A well-formed pointer or ledger edit by local malware or an administrator is not defended against; malformed ones are refused. Staged and installed files are protected by re-hashing, not by OS permissions against the same user.
- **Keychain:** status and enrollment share `validKeychainHelperManifest` (engine-keychain-host.ts), so they cannot disagree (tested over a manifest corpus). The helper name is fixed, never a path. Status only hashes bytes; it never runs the helper. Status does not apply the enrollment's ownership and mode checks, so `present` is not a promise that enrollment will accept the helper. Hard links to the helper are not refused at run time (the hash-then-spawn gap is already a stated host responsibility); the release script refuses links in its output folder.

## Building a release

`.github/workflows/release.yml` builds on a `v*` tag or by hand. It never publishes: artifacts, `SHA256SUMS` and the signed update manifest go to workflow storage; an optional draft-release job is off by default. Signing runs only when its secrets exist:

| Step | Needs | Without it |
|---|---|---|
| Windows Authenticode through a cloud key service | `CHAUSAR_WIN_SIGNER` = `digicert-keylocker` or `sslcom-esigner`, plus that service's settings | `WINDOWS_SIGNING_UNCONFIGURED`; the build is an unsigned preview |
| macOS signing and notarization | Developer ID certificate, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | `MAC_SIGNING_IDENTITY_MISSING` |
| Update manifest signature | `CHAUSAR_RELEASE_PRIVATE_KEY` (Ed25519 PEM) | `RELEASE_KEY_UNCONFIGURED` |
| PostgreSQL and Python runtimes | pinned archive hashes in `scripts/release/runtime-sources.json` | `RUNTIME_SOURCE_UNPINNED` |

Scripts: `scripts/release/stage-runtime.ts` (download, verify, lay out and inventory the runtimes), `keychain-manifest.ts`, `checksums.ts`, `sign-update-manifest.ts`, `windows-sign.cjs` (electron-builder sign hook), `releases-page.ts` (the public releases page), `feature-lists.ts` (the supported, experimental and left-for-later lists from `docs/lanes/*.md`) and `public-copy.ts` (the clean public copy with its secret and private-detail scan). Staged runtimes are never committed.
