# PostgreSQL original-custody composition

`WorkspacePostgresOriginals` is a constructor-only bridge in `platform/runtime/workspace-postgres-originals.ts`. It supplies the actual `source.withSource` and `WorkspacePostgresBackupActivationOriginals.withTransaction` capabilities required by the PostgreSQL activation lane. It also issues and inspects empty activation targets. It does not replace the interchange, encrypted-backup or candidate codecs, publish live SQL authority, attach an Engine, open a provider or install a default database.

## Constructor and composition

Install actual distinct PostgreSQL source and journal Vaults below one canonical application directory, the exact source `WorkspacePostgresCustody`, B's `WorkspaceBackupV2PostgresCustody`, the existing `WorkspaceInterchangeLocalCustody`, reviewed backup/activation policies and the current complete-owner/readiness guard. All adapters must already be installed before source capture begins.

The additional capabilities are:

- `withTargetCustody(targetId, targetDirectory, work)`: the root holds the preinstalled exact target adapter's `withLease` through the entire callback. The callback receives that same adapter's `WorkspacePostgresCustody`. Nested custody queries must stay on the same transaction-bound adapter. An unheld per-call `inspectOperation` is insufficient. The root must reject another ID/path/slot and preserve the standard Engine slot derived from canonical `target/live/main`.
- `candidates()`: a late constructor reference exposing C's actual `readCandidateHeld`. It resolves the source/candidate construction cycle without acquiring a second source queue.
- `bridge()`: a late reference to the actual `WorkspaceBackupActivationHost` composed from C's `backupActivationPorts(originals.originals)`. Its independently authenticated backup/export/inert readers remain mandatory. Missing capabilities refuse; there are no success defaults.

Construct the originals helper first; construct C's candidates from `originals.source`; construct the existing pure backup activation host from C's candidate ports and `originals.originals`; then install C's activation ports using `originals.source` and the same candidate issuer. The root retains actual target bootstrap/current-live inspection, committed open admission and Engine attachment.

## Held source boundary

The acquisition order is B's `withHeldSource` (actual Vault snapshot queue, then installed adapter native lease), followed by A's same-adapter `nativeSource.withSource`. All awaited source work stays inside those leases. Null-inventory readers invoked inside an existing callback reuse its current lease after matching the exact context. Nested archived admission refuses. The helper never takes a candidate lock; C owns that exclusion.

At admission and final exit, the helper checks the current unrestricted desktop owner, epoch, all retained source/row permissions and complete consumer readiness. Its independent current fence includes complete State, the authenticated adapter-issued encrypted authority, every authenticated retained private artifact, physical source files and directory generations, source storage/incarnation/authority and the measured native catalogue. It additionally fences the intermediate `private-artifacts` directory, whose physical generation is not included in B's purpose-directory listing.

Completed application `backups`, `exports` and `updates` directories/files/namespace dispositions are compared across the callback. Journal, control, staging and target namespaces intentionally have separate authenticated transaction protocols; comparing their entire mutable inventory against a pre-publication snapshot would reject C's legitimate journal/candidate transitions. Every actual outside sibling must still be explicitly classified and measured by B's root-provided `outsideApplicationNamespaces`; unknown siblings fail. Source/journal/target databases are distinct in the native acceptance profile to avoid B's full-capture SHARE-lock and control-table fingerprint conflicts.

For an archive-derived candidate, `expectedInventory` requires its exact candidate ID. The helper reads C's already-held-source candidate capability, rebuilds it using the existing bridge and original readers, authenticates the complete v2 encrypted authority and private entries, and authenticates the three archived semantic export envelopes and their committed binding. It reconstructs the original semantic State/artifact inventory with the existing codecs and requires exact agreement. The lease's State remains current authority; its separate `authenticatedHistoricalCapture` grants no old membership/session/access capability.

## Empty-target issuance and uncertainty

`createTarget(context,targetId)` holds the source snapshot, the existing exact target process-lock identity and root-provided native target lease. It verifies a distinct, actually absent/unreserved target SQL slot and refuses any existing physical directory or consumed reservation ID. It creates the empty directory and persists the existing encrypted `wit_<sha256(targetId)>_reservation` plus `wpg_target_<sha256(targetId)>_identity`, binding its exact independently encrypted reservation reference to the actual PostgreSQL storage identity. It does not reserve SQL: C later chooses its actual publication operation/creation IDs.

`inspectTarget` authenticates both issued records, context, actual SQL absence and physical directory generation. This is pre-publication empty-target inspection, not a committed live-target opener. A missing issued record produces the existing unknown-reservation result. Any uncertain issuance after physical creation returns `ACTIVATION_TARGET_COMMIT_UNKNOWN`; there is no retry, deletion, adoption or overwrite.

Original bridge transactions hold the actual backup record reader, semantic export reader, restored inert-container reader, target process lock and native target lease. They re-read all independent evidence and target custody with the complete source fence at final exit. C adds its own exact candidate exclusion and durable paired issuance methods. The archive/material authentication invokes actual Vault cryptography; `createCandidate` and `readCandidate` are deliberately absent from this helper's original lease.

## Qualification

The helper retains `fullWorkspacePortable=false`. Wider filesystem namespaces, journal/control/target recovery and enterprise SQL outside the source authority archive still require explicit complete recovery profiles. Adapter-issued envelope bytes do not certify original PostgreSQL physical JSONB bytes. Constructor capabilities and focused protocol checks cannot establish native transfer, competing independent writers, public HTTP receipts, restart/crash recovery, native UI or release qualification.

This delivery was checked with Node syntax and scoped strict TypeScript. Actual public/native transfer acceptance is owned by the coordinator and remains required on the joined final source tree. No native process, network/download, D-drive write, provider or full-suite run was performed for this module.
