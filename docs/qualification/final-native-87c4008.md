# Final source native database qualification

The unchanged platform source at `87c400870563b92803841d3a198cee801f7740df`, tree `84658363a35be7f31a148d676fdea18ec3669e68`, was qualified afresh on Windows with Node 24.13.1, native PostgreSQL 18.6 and the existing DuckDB 1.5.5 packages. [Retained evidence](final-native-87c4008-evidence.json) embeds the actual reports and lifecycle records, and records the source-manifest digest and runner hashes. Earlier `1dc19b8` evidence remains historical; none of its test results is inherited here. Separate gate counts are not a unique whole-product test total.

| Gate | Result | Native execution and limits |
| --- | --- | --- |
| Differential foundation | 110/110, exit 0 | Independent literal JavaScript answers, PostgreSQL and DuckDB SQL, exact decimal/currency/missing-state fixtures, fan-out traps, actual encrypted PostgreSQL Vault, CAS, bitemporal correction, idempotent imports, reopen and v1 restore. |
| Compiled measures | 37/37, exit 0 | Seven unchanged authored vectors through both native SQL engines; custom fields, negative sign, 38-digit boundary, missing values, wrong-answer refusal, public Engine HTTP calculation and reopen. |
| Investigations/search | 10/10, exit 0 | PostgreSQL token search, public Engine HTTP, native DuckDB receipts, investigation pause/reopen/resume, capsule/drilldown and source erasure. |
| Forecasts/alerts/jobs | 50/50, exit 0 | Public Engine request, PostgreSQL authority, 16 native DuckDB receipt proofs and new Engine reopens. Workflow algorithms execute JavaScript. |
| Saved-answer recovery | 20/20, exit 0 | PostgreSQL CAS, native DuckDB, concurrent exact recovery, immutable originals, actual encrypted v1 restore, compiled current tax field and typed storage-profile refusals. |
| PGlite 0.5.8 | 41/42, exit 1 | Actual PostgreSQL 18.3 WASM SQL, 30 accepted arithmetic fixtures, four pre-SQL JavaScript refusals, filesystem reopen and competing-instance ownership failure. Explicitly labelled injected-SQL interface; in-memory application selection is not a product authority adapter. |
| Comparison/scenario | 66/66, exit 0 | Paired public Engine HTTP, PostgreSQL authority, 12 default native DuckDB receipt proofs and 12 independent native PostgreSQL proofs, plus a native wrong-answer refusal. Nineteen authored planning responses are separately labelled. |
| Alert brief freshness | 19/19, exit 0 | Six public paired HTTP journeys, 54 native DuckDB receipt proofs, PostgreSQL encrypted persistence/reopen, actual ten-second expiry, correction, scope, source withdrawal and owner-epoch refusals. Brief projection executes JavaScript. |
| Signed phone continuation | 23/23, exit 0 | 74 actual loopback HTTP calls across desktop/session and signed phone routes, PostgreSQL encrypted authority and nonce persistence, native DuckDB `32110` result, reviewed selector binding, immutable offer, retry, reopen, withdrawal and device revocation. |

Comparison literal answers are current `30002`, previous `30000`, difference `2`, truncated basis points `0`. A reviewed `+00500` price adjustment canonicalizes to `500`, produces `31502` and change `1500`; `-00500` produces `28501` and change `-1501`. The large integer `900719925474099325` produces `945755921747804291` at +5%, with exact change `45035996273704966`. West-branch and unselected-source values are exclusion traps. The fixture includes narrow/empty scopes, zero-prior ratio omission, overlapping periods, changed owner input, reversed scenario/comparison call order, reopen and actual learned-at correction history. No clock is mocked or backdated.

Comparison with the measure bound to custom `feeMinor` remains unsupported: production projection validation refuses `SQL_DEFINITION_UNSUPPORTED` before SQL. Direct calls save no receipt; admitted conversation calls save an error-only history entry with no numeric answer/result reference. The refusal survives reopen. This is a retained product gap, not a successful custom-field native calculation. Arbitrary multi-measure compound transformation support is not established by these vectors.

The first comparison attempt stopped after 24 successful checks because whole `memory.list` response equality included its unpinned current `asOf` timestamp. Native literal/SQL checks had passed up to that point. The corrected fixture pins the public read to its actual post-import knowledge cut and also compares the entire authoritative Vault facts array; production source is unchanged. The failed attempt, original runner hash, report and clean shutdown remain in the evidence and are not counted as a qualified gate.

Alert freshness proves all five report operations carry native DuckDB proof. The correction journey replaces imported values `12000` with `9000` while the empty alert pin stays unchanged, isolating stale report withholding; it does not call `memory.correct`. Expiry uses the actual host clock with a bounded wait. Refusal readbacks compare the logical PostgreSQL authority revision/envelope; they do not claim unchanged physical pages or WAL. Day-long retention and controlled concurrent-writer freshness races remain unqualified.

Phone and comparison planning use exactly two and nineteen literal authored Gateway responses respectively. No real model/provider socket or inference runs. Phone signatures import public RFC 8032 test-vector material in memory; no signing keys are generated and no external credential is used. Signed nonces legitimately advance authority revision, so retry assertions cover business result/history and exact reviewed selectors. Failed/incomplete planner continuation and multi-member revocation are not exercised in this two-response native phone gate. This does not qualify native mobile, remote relay, TLS or protected device-key custody.

PGlite still fails `UNSAFE_INDEPENDENT_INSTANCE_CAS`: two independent WASM instances both acknowledge revision 0 as revision/value 1/1, and orderly reopen retains only 1/1. This failure remains red. Product PGlite authority, exclusive ownership and cross-process/crash/power-loss recovery are unqualified. No runtime default was selected.

Source `87c4008` still refuses complete PostgreSQL v2 archive/inert restore/fresh activation with typed `BACKUP_STORAGE_PROFILE_REQUIRED` or `ACTIVATION_ROOT_REQUIRED`; full encrypted-artifact omission is refused with `ARTIFACT_BACKUP_REQUIRED`. The parent owns the separate complete-transfer implementation and its qualification. Existing PostgreSQL authority stores encrypted snapshots; normalized persistent relational business claims are not established by this lane.

All mutable data, clusters, logs, cwd and TEMP/TMP stay under task4 on C:. Existing packages and four pinned PostgreSQL executables on D: are read only; no D measurement or write occurs. No acquisition, denied registry/cache retry, service, GUI, live connector/provider, external/customer data, signing-key creation, OS/network/security change, push or integration-checkout edit occurs. Each started server listens only on `127.0.0.1` at an ephemeral port; its shutdown command exits 0 and its `postmaster.pid` is absent afterward. Exact ports, timestamps and retained C bytes are in the evidence.

Read-only Git capture under the checkout owner pins 470 baseline platform/differential files. The supervisor verifies their hashes and the four PostgreSQL binary hashes before and after each run; separate runner hashes match before/after each gate. These are functional provenance checks, not a full runtime security audit. Each gate has a 240-second outer process deadline, bounded output, server-wide statement/lock/idle-transaction deadlines and finally shutdown. Forced process-tree cleanup is bounded and targeted to the owned process; passing runs did not exercise its kill deadline. The approved process path is required because the ordinary Windows sandbox token cannot start this portable server; no Git safety or host policy is changed.

To reproduce with the already available, approved runtime packages, first capture source under its checkout owner:

```powershell
node scripts/capture-native-source-87c4008.mjs
```

Then use the supported process permission path, with the supervisor's C-only staging and existing read-only runtime references:

```powershell
$env:CHAUSAR_NATIVE_GATES = 'verify-database-differential.mjs,verify-compiled-measures-c-native.mjs,verify-investigations-c-native.mjs,verify-workflows-native.mjs,verify-answer-recovery-native.mjs,verify-pglite-c-native.mjs,verify-comparison-scenario-native.mjs,verify-alert-brief-native.mjs,verify-phone-continuation-native.mjs'
node scripts/qualify-portable-databases-c.mjs
```

The command installs nothing, creates a new owned C-only cluster and recreates only its private `chausar_test` between gates. It should exit 1 while the PGlite ownership failure remains. Existing retained test data is not erased. Shared `engine.ts`, packages, schemas, platform files and other worktrees are unchanged. The parent retains ordinary source/CI evidence; no full ordinary source suite is rerun here.

Further qualification retains full PostgreSQL transfer, product PGlite authority, normalized business persistence where required, crash/power-loss drills and other installed native platforms. GUI/mobile/device custody, live providers, the 56 connector groups, enterprise deployment, hosted/installer release, signing and the separately blocked security audit remain outside these successful native functional gates. This checkpoint is not full-product release acceptance.
