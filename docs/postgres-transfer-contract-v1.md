# PostgreSQL workspace transfer constructor contract v1

Base: published `87c400870563b92803841d3a198cee801f7740df`. The shared types are in `platform/runtime/workspace-postgres-contracts.ts`. They are constructor capabilities, never RPC payloads, archive contents, credentials or a claim of native qualification. The coordinator owns this file, Engine, Vault and `workspace-postgres-engine.ts`. Separate storage, backup and activation lanes implement the capabilities without changing the pure codecs.

## Storage lane A

Own `postgres.ts`, `workspace-postgres-custody.ts` and storage-only tests/docs. Issue actual store/slot/incarnation witnesses. Store and slot together identify physical custody; incarnation detects replacement and cannot make one slot count as two. Source and journal must be different physical slots and different actual encrypted Vaults.

`withSourceLease(expected, work)` holds native advisory/row exclusion for the entire awaited callback. `assertCurrent()` authenticates store, slot, incarnation and the current encrypted envelope. Route operations within the lease through the transaction-bound client; do not reacquire its lock through another connection or let nested BEGIN/COMMIT release it. Existing ordinary PostgreSQL operations remain available. Reserved, prepared and uncertain transfer targets must also be refused by ordinary adapter paths, including callers without a transfer profile.

Vault now requires `EncryptedSnapshotAdapter.deleteIfCurrent(expectedEnvelope)` before PostgreSQL fresh-authority bootstrap. Perform comparison and deletion in one slot transaction, against the full encrypted envelope including Vault ID and revision. Return `deleted`, `absent` or `mismatch`; preserve a competing occupant. Do not use load followed by unconditional delete. A lost publication acknowledgement with no exact authenticated readback is `BOOTSTRAP_COMMIT_UNKNOWN`; preserve possible authority. An uncertain or mismatched cleanup is `BOOTSTRAP_CLEANUP_REQUIRED`; no automatic deletion retry.

Normalize the complete v1 envelope after JSONB readback while preserving ciphertext and authenticated values. Captures remain honestly labelled `adapter-issued-envelope`; this is not original physical JSONB byte custody.

## Backup lane B

Own `workspace-backup-postgres.ts` and backup-only tests/docs. Return `PostgresWorkspaceBackupInstallation`: the existing v2 host ports and metadata-only diagnostics. Reuse v2 encryption and interchange codecs. Preserve every admitted namespace, including terminal private records and tombstones, encrypted history, artifact bytes, reservations and custody pins. Reject unknown or omitted namespaces instead of reporting a complete portable workspace. Nonempty filesystem or enterprise namespaces outside the supported archive remain explicit portability refusals.

Source and journal supplied to installation are actual distinct PostgreSQL Vaults. Bind archive bodies, candidates and pins to authenticated current custody and independent operations. Call the supplied `assertCompleteOwner(context, historicalState)` for current and historical authority; an archived owner snapshot grants no current authority. Keep private bodies, paths, keys, connection strings and ciphertext out of diagnostics.

## Activation lane C

Own `workspace-activation-postgres.ts` and activation-only tests/docs. Return bridge/activation ports plus target inspection and committed-target launch capabilities. Reuse the existing pure hosts. Durable claims bind operation ID, creation ID, target ID, physical target digest, activation ID, workspace ID, fresh owner ID, Vault ID and actual final store/slot/incarnation. Authenticate these against native publication records; matching shapes alone is insufficient.

`withWorkspaceAdmission(input, work)` rejects reserved/prepared/unknown targets for create, open, recover and restore. Authenticate the committed publication and issued final slot, recheck physical bindings, and hold native admission through the entire awaited `work`, including actual Vault open and Engine attachment. Transfer exactly one owned PostgreSQL adapter to Vault; its connection capability must remain usable after the admission transaction exits. Closing the admission transaction must not accidentally close the Vault's adapter. No caller or archive chooses a database slot.

`inspectOpenTarget` returns a host-local `PostgresWorkspaceLaunch` only after committed authenticated readback. The coordinator verifies final canonical `target/live` location and authority pins, then creates a fresh Engine using only its storage admission and workspace/owner/Vault pins. It does not retain source credentials, sessions, providers, job routes or sync capabilities. Staging aliases never issue live authority.

## Coordinator join and acceptance limits

`EngineOptions.postgresWorkspace` explicitly installs the profile. Actual source/journal witnesses, Vault encryption and an approved synthetic workspace are required; the demo flag alone grants no transfer capability. Configured sync and managed connector histories are refused until their complete archive contracts are supported. Existing experimental file activation and ordinary PostgreSQL paths remain available.

The existing Engine transition fence holds through final admission exit and refuses concurrent public requests with `VAULT_BUSY`. Failed admission closes newly attached resources and retains durable authority. Fresh bootstrap cleanup uses conditional custody deletion as above.

Focused injected-port tests exercise actual Vault encryption and coordinator checks; they do not qualify PostgreSQL concurrency, crash durability or full transfer. Native acceptance must pin the final joined tree and actual PostgreSQL/DuckDB executables, keep every cluster and report under an owned C-drive run root, and prove import/history/archive/prepare/activate, public billed/received/earned calculations with receipts, fresh-process reopen and prepared-target ordinary-open refusal. Start no native process unless the complete tracked production composition and cleanup handle exist. PGlite's independent-instance CAS failure remains a failure. No native, release or full-product completion follows from this contract freeze.
