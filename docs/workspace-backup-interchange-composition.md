# Local backup/interchange control accounting

Base: `e5253ffe7c8f1fc46b60ce9079ff582593eec099`, fetched from `private/workbook-today-join-5edf751b-20261004-a241fe29337d`. The isolated synthetic regression first created a v2 backup, then failed same-workspace interchange export with `INTERCHANGE_CUSTODY_INCOMPLETE` at the original `workspace-interchange-local.ts:358`. Backup had issued `wb2_<record-id-sha256>_{archive,pin,binding}` in the shared `workspace-interchange` private-artifact purpose; interchange admitted only its own `wic_*` and `wit_*` controls. The existing second-backup and export-before-backup tests did not exercise this sequence.

Ownership in this slice is limited to `platform/runtime/workspace-backup-local.ts`, `platform/runtime/workspace-interchange-local.ts`, `platform/tests/workspace-backup-interchange-composition.test.ts`, and this document. Engine integration, state profiles/schema, scenario/lesson services and native acceptance remain with their respective owners.

## Trusted root composition

`WorkspaceBackupV2LocalCustody` implements the typed `WorkspaceInterchangeLocalControlCustody` contract. Root constructs both adapters around the same currently unlocked Vault and canonical application directory, then supplies the actual backup owner through the interchange constructor:

```ts
const backupLocal = createWorkspaceBackupV2LocalPorts(backupOptions);
const interchangeLocal = createWorkspaceInterchangeLocalPorts({
  vault, applicationDirectory, assertCompleteOwner,
  backupControlCustody: backupLocal,
});
```

The capability is trusted constructor data; it is never a renderer/RPC field. Reopen reconstructs both adapters around the reopened Vault. A different Vault handle or application root refuses with `BACKUP_SOURCE_SCOPE`. Omitting this capability retains interchange's existing refusal of backup controls. The existing Engine constructor has not been changed in this slice; parent integration must install the join before the actual application path benefits from it.

Interchange holds its existing Vault source snapshot, bounds and inspects the physical private namespace, then supplies the complete authenticated reference inventory to the backup owner. The owner inspects directly inside that snapshot. It does not call backup's snapshot wrapper, create process controls, mutate authority, publish ciphertext, adopt orphan files or perform cleanup. A nested `Vault.snapshot()` would be a non-reentrant queue error; the join instead reuses the existing artifact-read scope.

## Exact owner claims and source fences

Backup claims only exact `wb2_*` parts whose authenticated issuance has the expected record/creation/context identity, typed refs and independent archive/pin digests. Committed records reuse the owner's existing archive/pin/binding verification and codec budgets. Their retained encrypted source is authenticated with the existing Vault contract, and current historical source admission is rechecked. Discarded bindings require complete absence of both payload files and valid nullable issued references. Preparing bindings and incomplete cleanup refuse. Orphan payloads, missing bound parts, aliases, altered ciphertext and unknown suffixes remain refusals. No wildcard ownership of `wb*` files is granted.

Each claimed artifact returns its exact authenticated ref, actual byte measurement and SHA-256 witness. Interchange checks that claims uniquely match its independently enumerated refs, then applies its original `wic_*`/`wit_*` checks to every unclaimed artifact. Backup control hashes and exact inert-target witnesses are compared by interchange's final in-operation source fence. Unknown backup process sections, stale `.stage` files, nonregular files and links also refuse; normal process-lock generation remains transient.

Administrative controls are excluded from the business payload, capture generation and inventory pin. Adding a valid backup between operations therefore preserves a prior export's business inventory and review semantics. Changing backup custody during an operation changes its separate source fence and refuses publication. The original cryptography, key hierarchy, codec/schema, limits, owner admission and unsafe-path checks remain in use.

## Inert target reservations

Exact `wbt2_<target-id-sha256>_reservation` ownership is available from the backup custodian's existing allocation, readback and rollback contracts. Accounting requires the exact typed source/context/physical binding and these layouts:

- `empty`: the original physical target exists and contains no entries; publication identity/digests are null.
- `restored`: the original physical target contains exactly `backup.inert.json`. Its hash, receipt identity and full encrypted source archive authenticate through the existing inert reader.
- `rolled-back` after publication: the original physical target exists and is empty. Its retained publication pins remain typed.
- `rolled-back` after failed empty allocation: null publication pins and either the original empty target or the absent directory produced by the owner's cleanup.

Unknown entries, replaced generations, links, tampered containers, a missing restored target, or payloads left under a rollback tombstone refuse. The join performs no target activation or cleanup. Unresolved publication/staging continues to require exact root inspection.

## Verification boundary

The dedicated test uses the existing deterministic shop/retained-input fixtures and experimental-file Vaults in checked canonical temporary directories. It covers backup → same-workspace export → backup/export after safe reopen, custody preservation, valid tombstones/reservations, failed attempts, corruption and current source authority. Focused custody/codec/host tests and repository syntax/JSON checks run without native engines, browser, PostgreSQL, services, CI, live data or dependency acquisition. Strict TypeScript compilation is unavailable in this environment because no compiler is installed.

On 2026-10-04, the dedicated suite passed 43/43 checks. The final combined run passed 203/203 checks, with no failures or skips:

```sh
node --test --test-reporter=tap \
  platform/tests/workspace-backup-interchange-composition.test.ts \
  platform/tests/workspace-backup-local.test.ts \
  platform/tests/workspace-interchange-local.test.ts \
  platform/tests/workspace-backup-local-activation.test.ts \
  platform/tests/workspace-interchange.test.ts \
  platform/tests/workspace-interchange-host.test.ts \
  platform/tests/workspace-interchange-acceptance.test.ts \
  platform/tests/workspace-backup-v2.test.ts
node scripts/check.mjs
git diff --check
```

Repository syntax/JSON validation passed for 596 source files. Independent read-only standards and task-spec reviews found no remaining functional blocker after nullable issued-reference validation and the business/operation fence separation were added. No full suite or native acceptance was run.

This is a private source checkpoint and synthetic local-custody composition result. `fullWorkspacePortable` and `fullWorkspacePortabilityQualified` remain false. It does not qualify Engine/RPC installation, actual native recovery, wider activation layouts, external custody or release acceptance. The separately denied security audit has not been launched.
