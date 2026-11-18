# Signed release verification and staging

`ReleaseUpdater` in `platform/runtime/updater.ts` verifies detached Ed25519 signatures with an explicitly pinned release public key, and stages the verified file. There is no unsigned path, and test keys exist only in tests.

This page is about that class: verifying and staging. The daily check of the feed is in `platform/runtime/update-service.ts`. What happens to a staged file when the owner quits is in `app/desktop/updates.cjs`: on Linux the AppImage is replaced, on Windows the installer runs only when it is signed by the pinned publisher, and on a Mac nothing installs by itself. [desktop-releases.md](desktop-releases.md) has the release checklist.

No build carries a release key, a feed address or a Windows publisher yet, so none of this has run against a real release. A signed installer, a public feed and an update from an installed old version to a new one have not been tried.

```ts
const updater = new ReleaseUpdater({
  publicKey: pinnedEd25519PublicKeyPem,
  version: runningVersion,
  stageDirectory: absolutePrivateDirectory,
});
const verified = updater.verify(canonicalManifestText, detachedSignatureBase64url);
const staged = await updater.stage(canonicalManifestText, detachedSignatureBase64url);
// staged.installed is false. Staging runs no executable.
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

A manifest names one of three systems: `win32` (the NSIS installer), `linux` (the AppImage) or `darwin` (a Mac build's zip, one for each of `arm64` and `x64`; the dmg is not an update target). On a Mac the verified file is staged and shown to the owner, who replaces the app by hand; nothing installs by itself there, and a Mac build is unsigned until an Apple Developer ID is configured (`desktop-releases.md`).

The manifest is limited to 64 KiB. It must target the running operating system and architecture, name a newer semantic version, and support the current minimum engine version. Numeric version components and prereleases are compared correctly. A valid previously staged higher version prevents replaying a lower release. Same-version manifests with different contents are refused. This is software rollback resistance; a malicious disk administrator can remove local stage history, so no hardware anti-rollback protection is claimed.

Artifacts use a canonical public HTTPS URL with no user credentials, IP-literal destination or nonstandard port. A redirect is followed only to GitHub's release hosts and the address's own host (`RELEASE_HOSTS`), at most five times. The download is bounded by the signed length, capped at 512 MiB, and stopped when no byte arrives for sixty seconds. The complete byte length and SHA-256 must match before a private staged artifact is published. The stage directory rejects symbolic links and uses an exclusive lock, private temporary files, file fsync, and atomic replacement of the pending plan. Existing artifacts are checked again; changed bytes fail.

The shared process lock publishes complete private JSON containing the PID, random token and start timestamp atomically. An abruptly stopped writer is reclaimed only when `process.kill(pid, 0)` reports `ESRCH`. Live or reused PIDs, permission failures and unrecognized owner records remain locked. Recovery uses an atomic claim for the exact original bytes and rereads them before unlinking; competing recoverers cannot remove the winner's replacement lock. A crashed recovery claim advances to a new immutable generation, with a maximum of 32 abandoned generations and two retries for a vanishing claim. Completed recovery removes its claims. Interrupted recovery can leave private claim or temporary files, and exhausted bounds require operator inspection after all writers have stopped. Legacy token-only updater locks lack a verifiable PID and are deliberately not reclaimed automatically. These subprocess interruption tests do not establish native installer or hardware power-loss guarantees.

The return value describes the signed manifest, artifact path, previous running version, and rollback prerequisites. It always declares `installed: false`, requires a verified previous package and a vault backup, and requires a native installer. `rollback.supported` is the publisher's declaration, not an executed rollback test. `ReleaseUpdater` itself runs no downloaded code, script or installer, even if its signature is valid.

Still to do before a real release: configure the release key, get the publisher signatures, update an installed old version with existing vaults, measure what an interruption or a power loss does, and test a restore across a data version change.
