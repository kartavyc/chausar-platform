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
