# Desktop rollback validation

`ReleaseUpdater.prepareRollback` checks a proposed step back using local files and a trusted restore validator. It returns a manual plan with `installed: false`. It does not download, execute, install, rewrite the authoritative vault, register services, or change startup settings. Manifest version one and normal update downgrade refusal remain unchanged.

The running release must authenticate with the pinned Ed25519 public key and exactly match the engine version. The previous release must authenticate with the same key, target this operating system and architecture, and have a strictly older semantic version. The running release must declare rollback support. The previous release's rollback flag governs leaving that release; it does not determine whether that release can be a rollback target.

The previous package is read through a bounded file handle and checked against its signed size and SHA-256. The encrypted backup must match the digest captured at backup creation, use `chausar.backup.v1`, and contain complete version-one encrypted key wrappers and snapshot fields. Its envelope ID and revision must match the expected trusted vault identity. Inputs require absolute regular-file paths; ancestor links, file links, special files, oversized input and changes observed during reading are refused. The maximum package size remains 256 MiB and the maximum backup size is 64 MiB.

```ts
const plan = await updater.prepareRollback({
  currentManifest, currentSignature,
  previousManifest, previousSignature,
  previousArtifactPath,
  backup: { path: encryptedBackupPath, sha256: backupCreationDigest },
  expectedVault: { vaultId: trustedEnvelopeId, workspaceId, revision: backupRevision },
  validateRestore: trustedDisposableRestoreValidator,
});
// plan.installed === false; an approved native rollback still requires qualification.
```

`validateRestore` is an engine-owned dependency, supplied directly as a function. Renderer messages, user-entered booleans, uploaded JSON receipts and remote model output must never supply this dependency or its result. No default validator assumes a restore succeeded. Equal data-schema numbers do not replace a decrypt-and-restore check.

The callback receives copies of the exact checked package and encrypted backup bytes, both authenticated release manifests, their canonical manifest digests, artifact and backup digests, and the expected vault identity. It must validate a credential-preserving restore into isolated disposable storage using the target runtime's supported data format. It returns exactly `restored`, both manifest digests, both byte digests, `vaultId`, `workspaceId`, `revision`, and `dataSchemaVersion`. The result must bind the same bytes and identities and produce the previous manifest's data-schema version. An incompatible schema requires a qualified restore/repair procedure; the updater does not infer a reverse migration.

Vault envelope IDs and business workspace IDs are different. Capture expected metadata from trusted engine state or a backup-creation receipt, not from an arbitrary backup being inspected. `Vault.read()` exposes the workspace ID and revision but not the encrypted envelope ID; a production integration needs an engine-owned metadata/receipt adapter. Credential recovery changes wrapping and increments the revision, so this initial contract requires preservation of the source revision. Recovery-based validation needs an explicit source-to-restored revision contract before it can qualify here. Disposable validation must use a new empty location, no OS keychain hook, and guaranteed vault closure. The callback must not execute a downloaded package merely because its signature passed; native execution remains a separate reviewed qualification step.

A returned plan describes the snapshots checked during this call. Files may change after the call returns. A native installer must independently authenticate manifests and recheck package and backup length/digests immediately before use, under exclusive vault ownership, and verify the live vault has not advanced. It must pause jobs and reconcile external actions and reminders before resuming them. Backup restoration can discard changes made after that backup; this requires an explicit approved data-preservation decision. `requiresInputRevalidation`, `requiresExclusiveVaultLock`, `requiresEffectReconciliation`, `requiresNativeInstaller` and `requiresUserApproval` stay true. Preparation grants no execution or restoration authority.

The synthetic tests exercise a real encrypted `Vault.backup`/`Vault.restore` round trip on disposable storage, preserve the complete fixture snapshot, verify signatures and package bytes, and refuse missing/mismatched restore bindings, altered backups, incorrect identities, incompatible schemas and unsafe paths. They execute on the local Node runtime. They do not run a previous native installer, certify publisher signatures, prove Windows/macOS/Linux update interruption safety, or qualify a production data migration. Windows does not provide the same `O_NOFOLLOW` protection as POSIX; handle/path identity checks detect observed replacements but cannot establish native installer atomicity against a privileged disk administrator.

The full release requirement still needs an old-install upgrade, native installer replacement, restored historical answers, action/reminder reconciliation, health progression, signed feed withdrawal/kill-switch authorization, vulnerability-aware rollback eligibility, a timed recovery drill, and evidence from each supported platform. Production keys, publisher certificates, release hosting and service persistence require the parent-approved release process. This local foundation neither creates those resources nor claims those gaps are complete.
