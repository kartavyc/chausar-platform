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

## Parent Engine and retained-codec join

The parent source join installs the exact `backupLocal` constructor capability in the experimental-file Engine composition before interchange is constructed. Activation retains the same local backup/interchange instances and its guarded late initialization. HTTP callers cannot supply this capability. Ordinary lock/open and a new Engine/server instance reconstruct the same trusted join around current Vault custody.

The joined retained codec checkpoint `c4dfd9e67b7b155c16b26c98c0ebe7472c5d54bf` preserves legacy namespace absence as v1 and uses the explicit v2 profile for present scenario/lesson namespaces. Current scenario and lesson release checks remain installed. Public regressions cover backup then export, inert restore, exact same-owner restart/readback and unchanged business receipts, with v1 absence and present-empty v2 cases. Service-produced populated history has its own combined regression; populated digest-bearing records are not fabricated or resealed for admission.

The preserved missing-Engine-wiring reproduction refuses export with `INTERCHANGE_CUSTODY_INCOMPLETE` after a successful backup and inert restore. A second expanded sequence also demonstrated the existing `BACKUP_INVENTORY_INCOMPLETE` refusal after semantic candidate preparation without an installed activation profile. That boundary remains: authentic repeated backup/export before preparation succeeds, while the unqualified candidate target is not silently excluded from later backup inventory. Unknown controls, caller capability injection and historical-source revocation remain refusals.

PostgreSQL runtime custody is unchanged. Its public transfer fixture now expects the codec's complete 28-store v2 fresh target, while the legacy absent-namespace source expectation stays 26. No native PostgreSQL process was run for this join, and historical native 8/8 evidence does not qualify this changed source. In particular, constructor control accounting installed here is for experimental-file backup custody; later PostgreSQL backup-to-export composition needs its own separately installed native custodian and acceptance. Fresh Engine/server-instance tests are not fresh-process native proof. Both portability flags remain false.

## Populated-history request latency repair

The combined populated-history regression first exhausted its whole-test budget. Per-RPC diagnostics then separated that aggregate limit from the unchanged 30-second HTTP deadline and exposed actual request failures. The original export was still pending at 30.062 seconds before the first repair; after that repair, a second export following inert restore and fresh Engine/server reopen was still pending at 30.509 seconds. Both failed receipts remain in the parent-owned `checks/runs/verify-populated-composition-with-per-request-deadlines-*` evidence (`e3ab7799c1894f48b86efec21c5fc0f0` and `5cd11d81f98e4cbd90550daad46cec0d`). These are preserved failures, not successful completion timings.

The bounded repairs remove duplicate computation within current reads. Scenario complete-read admission invokes `ScenarioService.describe` once per retained revision: that reader already performs the same load/view and release checks as `reopen`, then validates immutable comparison-referenced receipts, so the preceding ordinary reopen repeated those checks. Current readiness generations, exact custody equality, owner/epoch and source/branch admission, every retained revision and comparison receipt, and final retention/release assertions remain in place. Local backup readback uses `validateWorkspaceBackupV2Capture` to perform full fresh wire inspection and independent-pin validation, then synchronously reconstruct exact encrypted bytes from that checked object. Its private read result supplies those bytes to the same Vault authentication, removing another parse of the identical wire. Every operation still rereads current custody, authenticates ciphertext, checks physical witnesses and invokes current complete-owner admission; no cross-call cache, additional authority or public payload capability is introduced.

The dedicated populated regression uses service-issued scenario revisions, completed results and comparisons, plus an approved lesson with explicitly synthetic target/evaluation ports. It checks exact nested namespace content and pins, authenticated backup/semantic readback, inert restore, fresh same-owner Engine/server reopen, receipts and unchanged business State. Separate cases require refusal when lesson authority is absent or current evaluation bodies change, without new custody or State writes. Legacy absence and present-empty v2 cases remain separate. Final execution results and request timings belong to the parent's bounded run; the earlier 43/203 results above describe the original control slice. Production guards, codec budgets and HTTP deadlines are unchanged. This source coverage provides no native PostgreSQL, fresh-process, real-evaluation or full-workspace portability qualification, and both portability flags remain false.

The final repair follows the preserved CPU profile's finding that repeated full-State cloning dominated the pure internal access checks. `internalAccessView` is used only by `ScenarioService.#access`, `#requestAccess` and `#load`, each retaining its fresh `live.read()`. Those synchronous checks may read that already captured State directly; the view cannot update it and is never passed to a host or callback. The existing cloning `readOnly` view, detached resolver results and external callback inputs remain unchanged. No validation, current reread, source/epoch/retention check or readiness generation is removed. The earlier CPU profile and all failed receipts remain evidence of the diagnosed source rather than being replaced by the successful run.

Scenario input projection also removes `scenarioRecords` and `lessonState` from a shallow shell before cloning the ordinary business state. The returned data stays detached and has the same fields and ordering; private history is no longer cloned only to be discarded. Current authorization and release checks are unchanged.

## Confirmed bounded populated-source result

The fresh parent-owned run `verify-populated-composition-with-per-request-deadlines-9e58f3faea944df5bad780d4d28f944a` passed all three dedicated populated cases. Its external `checks/runs/.../joined.json` and `stdout.log` record exit 0, 93.123 seconds elapsed, complete process/stdout/stderr joins, no expiry, no forced cleanup and no incomplete cleanup. Every HTTP request retained the enforced 30-second bound.

The successful populated flow measured backup creation at 7.406 seconds, backup read at 2.884 seconds, semantic export at 10.722 seconds, inert restore at 12.461 seconds and restored readback at 5.182 seconds. After a new Engine/server instance, workspace open took 0.107 seconds, backup read 3.450 seconds, inert inspection 9.936 seconds, historical scenario reopen 0.044 seconds, lesson read 0.110 seconds, retained receipt read 0.013 seconds and the second semantic export 16.203 seconds. These are observed timings for this exact synthetic fixture and run, not a general latency bound. The missing lesson authority and changed evaluation cases returned `LESSON_AUTHORITY_REQUIRED` and `EVALUATION_CHANGED` as required, preserving State and artifact custody.

This result verifies the combined experimental-file Engine/HTTP source journey with populated retained namespaces and exact same-owner reopen. It does not transfer historical native 8/8 acceptance to this source or qualify fresh-process PostgreSQL execution, the later native backup-to-export custodian, real evaluation, or broader namespace portability. `fullWorkspacePortable` and `fullWorkspacePortabilityQualified` remain false. The parent retains the external evidence and owns final checkpoint acceptance/publication; no large TAP artifact is added to source by this update.

The later parent-owned component run `combined-core-bounded-group-1-65403ff3b94944ee8e3e6b32605d1e51` exited 1 with 38 passing, three failed and two cancelled checks. Its preserved failure is the eleven-mode nested refusal group's aggregate 30-second fixture budget: the parent group expired at 30.001 seconds while individually completed modes took approximately two to five seconds, cancelling the remaining children. That group now has a 60-second aggregate fixture budget and an explicit 30-second bound for each of its eleven children. The cases, assertions, custody checks and cleanup remain unchanged, preserving the existing 43-check TAP structure. This changes only the test group's aggregate scheduling budget; production HTTP deadlines and runtime guards remain unchanged. The parent owns its fresh rerun and final result, and the failed batch remains external evidence.

The subsequent preserved component run `combined-core-bounded-group-1-c2fbbf0b4ac14fbdb730237e01f2bec4` recorded 42 passing checks and one cancelled reservation journey at its whole-case 30.042-second fixture limit. Its eleven-mode refusal group completed in 49.615 seconds. The reservation journey contains twelve sequential custody/allocation/restore/rollback/reopen/readback/export operations, so it now has a 120-second aggregate fixture budget and a local diagnostic wrapper around each operation. The wrapper records the pending step before awaiting, reports completed elapsed time, and asserts that every completed step took less than 30 seconds. It introduces no operation timer, retry, publication replay or runtime guard change; all original receipt, empty-target, tombstone, refusal and unchanged-State assertions remain. The parent owns the fresh rerun, and this cancelled case remains failure evidence rather than a passed journey.

The preserved public run `combined-custody-codec-backup-and-flow-public-6b0625aa985e4947acb849c6a193e7b9` also exited 1: seventeen checks passed and the complete backup/export/restore/restart journey was cancelled at its whole-case 30.389-second fixture limit. Both this run and the component `c2fbbf0b4ac14fbdb730237e01f2bec4` receipt record complete process/stdout/stderr joins, no run expiry, no forced cleanup, no incomplete cleanup and no cleanup errors. Neither cancelled journey establishes a passed flow or an individual operation's latency.

The fresh qualification strategy separates the sequential fixture budget from each operation. The composition fixture allows 120 seconds for the complete reservation journey, diagnoses a pending operation before its await, and checks each completed operation against a less-than-30-second elapsed-time criterion; that assertion does not terminate an in-flight operation. The public fixture likewise allows 120 seconds for its complete journey, while every actual loopback HTTP request has `AbortSignal.timeout(30_000)`, pending/completed diagnostics and a less-than-30-second completion assertion. The production server's 30-second HTTP deadline remains unchanged. The parent owns the fresh bounded runs and their results; these fixture-only changes provide no native PostgreSQL or full-workspace portability qualification.

The accepted parent-owned run `combined-custody-codec-refusal-and-activation-public-9bb30582455646488477d33514aba177` passed all fifteen checks in the public interchange acceptance, lost-acknowledgement acceptance and activation fixtures. Its external joined receipt records exit 0 in 298.524 seconds, complete process/stdout/stderr joins, no expiry, no forced or incomplete cleanup and no cleanup errors; TAP reports no failed, cancelled or skipped checks. This records the observed source-fixture result for those files, not a general latency bound or fresh native PostgreSQL acceptance. The reservation composition rerun and retained partition runs remain separately parent-owned, and both portability flags remain false.

The final composition rerun `combined-core-bounded-group-1-f7349c47a0cc43a0a6070f14552a94db` passed all 43 checks in 152.677 seconds. Its twelve measured reservation/restart operations each completed below 30 seconds; the longest was the repeated semantic export at 4.921 seconds. The public backup/interchange rerun `combined-custody-codec-backup-and-flow-public-c0daf5c4ff1e48d18df4f13ec5f0e971` passed all 18 checks in 113.293 seconds, with the client abort and elapsed assertion retained for every HTTP request. The complete first journey took 29.453 seconds, including prepare at 5.109 seconds, review at 4.314 seconds and post-restart export at 3.629 seconds. These exact synthetic fixture timings do not establish native or general latency qualification.

The retained-history/candidate/injected-contract run `retained-bounded-history-and-contracts-f76a73c68f7d42b083c58ae4b8985ecb` passed 140 checks. The scenario/staging/injected-contract run `retained-bounded-scenario-injected-and-staging-0ce887eea6f84546a8b8c0d30f633124` passed 124, including callback mutation isolation. Final strict no-emit typing with `skipLibCheck=false` passed in run `f8ab5f8e480c41f3ba02d894e45669f3`; syntax/JSON validation passed for 600 source files in `d782085550b748fbb21583d684fd49a6`.

The aggregate retained and independent-public runs that reached their task-added 300-second process limits remain incomplete batches. Their completed TAP cases and joined cleanup are preserved separately. Exact remaining-case runs completed the seven unfinished backup-activation groups with 44 fresh passing checks, excluding the three already completed held-inspection children. The independently configured public occupation/late-collision case passed in `3a6ebc650ff84bed963f068f526c8d1a`; the earlier aggregate's completed archive/goldens and source-revocation cases were retained without replay. This is case coverage across the preserved prefixes and bounded continuations, not a claim that either expired aggregate passed. Every continuation exited 0 with complete process/stream joins and no expiry or cleanup errors. No PostgreSQL/native product, browser, GUI, live provider, dependency acquisition or D write was executed for this join. Both portability flags remain false; PGlite is not the default.
