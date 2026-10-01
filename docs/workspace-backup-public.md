# Public encrypted archive custody

The Engine now joins `WorkspaceBackupV2Host` to real local Vault/filesystem custody and the desktop IPC registry. The public contract exposes authenticated metadata, independent manifests and exact receipt readback. Archive creation retains encrypted authority and every file in both typed private purposes. Inert restore writes the complete archive into one separately reserved closed copy. It does not mount historical State or attach an Engine.

Routes:

- `workspace.backup.v2.create {destinationId, confirmed: true}` creates one managed single-use archive reference and returns its bounded summary.
- `workspace.backup.v2.read {backupId}` reauthenticates the entire committed archive and independently bound issuance, returning `{summary, creationId, sourcePin}`.
- `workspace.backup.v2.restoreInert {backupId, targetId, reviewedDigest, confirmed: true}` requires explicit review of that exact archive and creates one new closed target. Existing directories are not adopted.
- `workspace.backup.v2.readRestored {backupId, targetId, creationId, reviewedDigest}` verifies complete exact archive bytes and retained receipt under actual target custody.
- `workspace.backup.v2.inspectRestored {backupId, targetId, reviewedDigest}` performs read-only restart/lost-response discovery. It derives the creation ID from the authenticated existing target reservation, measures its still-inert files, then performs the normal complete readback. It never retries restore or invents an identity.
- `workspace.backup.v2.diagnostics {}` exposes measured custody and explicit namespace requirements to the current complete owner.

Every route uses current private owner/epoch, untainted desktop context, access to every retained source/row and connector consumer readiness. RPC payloads cannot install paths, budgets or callbacks. The local profile admits only experimental file storage; PostgreSQL requires a separate reviewed custody profile. Configured sync and managed connector sources additionally require `EngineOptions.backupCustody.withCompleteOwner`, a trusted installed capability holding their actual owner/source/readiness admission through publication. This capability wraps the actual snapshot-only Vault writer admission; synchronous assertions run immediately before/after publication and current source guards remain active. Merely supplying that hook does not bypass a failing semantic gate or qualify a vendor. The root does not install a permissive production hook.

Default ceilings are operation admission budgets, not partial scope: 32 MiB archive JSON, 16 MiB per encrypted entry and complete encrypted entry set, 4096 entries, depth 128 and 200000 JSON nodes; filesystem inventory is bounded by 8192 files, 128 MiB and depth 16. An oversized or unknown namespace rejects the whole operation. A trusted constructor may configure the explicit budgets; IPC cannot. Operator passphrase/recovery credentials remain separate external requirements. Encrypted wrappers are retained without returning keys or credentials.

`fullWorkspacePortable` remains false. Wider source/application namespaces are actually measured and disclosed as included, empty, transient or outside-archive. Unknown siblings/external enumeration, unsupported storage/keychain/consumer custody and changed source/target provenance refuse; this integration does not silently claim coverage of those stores.

`platform/tests/workspace-backup-public.test.ts` uses actual loopback HTTP, Engine, newly allocated encrypted Vaults and owned Windows temporary files. It proves empty private namespaces, every authored private status/tombstone, exact prior-backup ciphertext inclusion, source authority byte equality, authenticated reopen, complete inert container readback, durable creation-ID discovery, no target adoption/activation, typed malformed/stale refusals and actual unqualified managed-source refusal. All businesses and credentials are explicitly synthetic. Provider calls are forbidden in these fixtures.

Renderer-only fixtures are separate from those actual HTTP/Vault checks. Native database, installed GUI, full archive portability, usable fresh-authority activation, live vendor/model, hosted enterprise, dedicated security review and full-product acceptance remain unverified.
