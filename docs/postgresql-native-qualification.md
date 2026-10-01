# Completed native PostgreSQL and DuckDB qualification

The hard gate executed **110 checks with 110 passed, no failures, no blockers and exit 0** on native PostgreSQL **18.6** and native DuckDB **v1.5.5**. It qualified the registered receipt arithmetic and normal PostgreSQL encrypted-snapshot composition in this synthetic Windows setup. It does not select a production default or certify a packaged runtime, normalized business schema, crash/power-loss recovery or PGlite authority storage.

## Official portable archive and integrity

The [official PostgreSQL Windows page](https://www.postgresql.org/download/windows/) links the [EDB binary page](https://www.enterprisedb.com/download-postgresql-binaries). Its PostgreSQL 18.6 Windows x64 icon has the published href `https://sbp.enterprisedb.com/getfile.jsp?fileid=1260566`. A supported HEAD request succeeded and redirected to the single intended archive:

```text
https://get.enterprisedb.com/postgresql/postgresql-18.6-4-windows-x64-binaries.zip
```

The normal flow presented no account, click-through or automated-access refusal. After parent clarification, the previously scoped D: approval authorized the download and isolated test process. No hidden URL was guessed, no other archive was acquired, and no separately blocked npm dependency was reacquired.

The archive is **382,815,572 bytes**, SHA256 `1df55002afe95b945d934c078b13e82c1603fa546731e511d068aa983b4ead28`. Its recomputed 8 MiB multipart ETag matches the official HTTPS response's `171a6eaea12aed5b554b5e5b1ebdee3c-46`. Every one of **22,026 ZIP entries** passed expanded length and CRC32 checks; paths were safe and unique under Windows equivalence, with no symlinks. The full declared expansion is 1,004,378,762 bytes. These establish official HTTPS origin and transfer/archive consistency. No separately published vendor SHA256 or release signature was located; the tested executables report `NotSigned`, which is retained as an integrity limitation.

Only PostgreSQL `bin`, `lib`, `share`, `include`, `doc` and root legal-notice files were extracted, preserving the vendor layout: **4,448 entries / 195,912,065 bytes**. Optional pgAdmin and StackBuilder directories were not extracted or launched. The archive contains no DuckDB package entry. `server_license.txt` contains the permissive PostgreSQL license; all extracted notices remain intact. No installer or proprietary add-on ran.

Files reside in `D:/Chausar/build-tools/qualification/postgresql-18.6-4`. Origin headers, archive verification, selected extraction and binary version/hash records are retained as `origin.json`, `archive-verification.json` and `core-extraction.json` there. No OS, network, security or global tool setting changed.

## Failure found by the real gate and scoped fix

The first actual two-engine gate executed both engines and passed 107 of 108 checks, then failed persisted-vault reopening with `UNLOCK_FAILED`. PostgreSQL JSONB reorders nested object keys. Vault v1 serializes its key wrappers into authenticated additional data with their original insertion order, so a JSONB round trip changed the serialized bytes despite preserving field values.

A controlled protocol regression reproduced the failure. `platform/runtime/postgres.ts` now reconstructs loaded passphrase/recovery wrappers in the existing factory order: `salt`, `kdf`, `ciphertext`, then `nonce`, `tag`, `data`. Every field value and snapshot ciphertext is preserved. Unknown wrapper fields and unsupported KDFs fail closed rather than being discarded. The existing Vault v1 format, AAD code, GCM, KDF, database schema and stored encrypted content are unchanged. Future wrapper formats need explicit version support.

The new protocol tests verify reopening after nested key reordering, refusal of a tampered recovery tag even during passphrase unlocking, and refusal of unexpected authenticated metadata. Those tests use an injected pool and are not native-engine evidence. The subsequent fresh native gate independently passed actual JSONB storage, reopening and encrypted backup restoration with the fix.

## Actual executed coverage

| Evidence class in the 110-check report | Count | Scope |
| --- | --- | --- |
| JavaScript literal answer key | 30 | Entire figures compared with independently hand-worked exact integer strings. |
| JavaScript contract refusals | 4 | Expected unsupported currency/ambiguous-input refusals. |
| Native DuckDB | 32 | Smoke, 30 literal receipt verifications and one altered-answer refusal. |
| Native PostgreSQL arithmetic | 32 | Smoke, 30 literal receipt verifications and one altered-answer refusal. |
| PostgreSQL identity/pristine guard | 1 | Actual server version, exact disposable database, empty public relations and pinned search path. |
| Projection validation | 2 | Duplicate-invoice refusal before SQL; not counted as native arithmetic. |
| Native PostgreSQL snapshot checks | 4 | Encrypted envelope/revision inspection, concurrent creation CAS, concurrent update CAS and restored-slot deletion. |
| Dual-native verifier/Vault composition | 5 | Exact/idempotent import, FX lineage, immutable correction/known-on history/staleness, reopening and encrypted-backup restore. |

The literal corpus covers decimal precision limits, values above JavaScript safe integers, a currency-mismatch refusal, missing/zero/empty/conflicting states, truncation of negative ratios and scenarios, invoice/payment fan-out, unmatched receipts and aging boundaries. Exact USD-to-INR rational FX is a separate native composition check; currency-exponent variation is covered separately by source tests, not this native literal corpus. PostgreSQL and DuckDB each independently check the same hand-worked receipt figures; cross-implementation agreement alone is insufficient to pass. The encrypted authority remains a snapshot adapter, not normalized relational claims or dictionary-generated business tables.

## Process and storage evidence

The successful run initialized a fresh synthetic cluster with `initdb --auth=scram-sha-256 --encoding=UTF8 --no-locale`, an explicitly labelled public synthetic fixture credential and no customer database. `pg_ctl start` bound **only `127.0.0.1:63199`**, an available ephemeral port. The server query confirmed PostgreSQL 18.6 on x86_64-windows, MSVC 19.44.35228, 64-bit; it also confirmed the loopback bind and selected port. The database was exactly `chausar_test` and initially empty.

The external hard-gate process ceiling was 120 seconds; no timeout, output overflow or forced termination occurred. The gate's existing SQL/session deadlines remained enabled. `pg_ctl -m fast stop` returned 0, the server log confirms shutdown and `postmaster.pid` is absent. No Windows service was registered. Process-scoped temporary paths stayed under the owned D: run directory. The successful lifecycle measured **1,045,581,140 bytes** under the shared build-tools root, below its **4,000,000,000-byte cap**, including retained earlier synthetic clusters and evidence.

An earlier startup attempt reached server readiness but its parent waited on inherited Windows output pipes. Cleanup stopped that server; startup-only file-backed output handles corrected the wrapper. That failure is retained separately and is not presented as an engine failure or passed fixture run. All three synthetic clusters shut down; none is a permanent service.

## Reproduction and verification artifacts

The retained staging supervisor `D:/Chausar/build-tools/qualification/run-portable-postgres-qualification.mjs` rehashes the verified archive, generates a fresh run-owned cluster and port, runs the existing repository hard gate, then stops the owned server. It downloads nothing and uses already verified staged `pg@8.23.0` and `@duckdb/node-api@1.5.5-r.3`. Measure the shared cap before another run because cluster evidence is retained.

The successful actual-engine report is `D:/Chausar/build-tools/qualification/postgres-duckdb-native-complete.json`, SHA256 `2752679e35e91f2fe7f13c2efd1ea9363aa4fed304d4478f44fe4747657cc55b`. Its lifecycle/logs are under `postgresql-18.6-4/runs/synthetic-1790814232111-64676`; lifecycle SHA256 is `98a1adf1a1112fe011d27a91530c6fbc3d0666cc75787a133f5819c75e028042`. The staged `postgres.ts` exactly matches the committed source bytes, SHA256 `aea01838e5db7d42ce8b1e742c00652e6c00b372322443d624ca76d13d29ed39`. Earlier native reopening failure is retained as `postgres-duckdb-native-before-jsonb-fix.json` and in its run directory.

After the fix, the full source suite passed **276 tests, zero failed/skipped**. The focused PostgreSQL protocol, envelope and Vault suite passed **27 tests, zero failed/skipped**. Syntax/JSON validation passed for **67 files**; `git diff --check` passed. Full source output is retained in the lane workspace as `verification/postgres-jsonb-source-tests.txt`. No shared manifest/schema/engine file or integration worktree was edited, and parent owns integration.

## PGlite comparison and remaining contracts

The previous actual **PGlite 0.5.8 / PostgreSQL 18.3 WASM** run still has 45 completed probes and an intentional qualification failure: two independent instances sharing one directory both acknowledged the same revision-0 update. Its proof labels stay `injected-sql`; the separate report establishes real WASM execution. Product PGlite Vault integration, exclusive directory ownership and OS cross-process certification remain absent. See [the partial comparison evidence](native-database-qualification.md).

The PostgreSQL/DuckDB arithmetic and ordinary PostgreSQL snapshot gates are now green. Remaining full-scope requirements include normalized relational claims/schema/query compilation, interval/effective-on semantics, complete settlement/refund/source reconciliation profiles, PostgreSQL server crash/power-loss and backup-recovery drills, PGlite product authority integration and cross-process ownership, and installed/signed Windows/macOS/Linux runtime qualification. An unsigned portable qualification run does not choose or certify the shipped runtime default.
