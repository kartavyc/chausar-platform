# Native database qualification after approved D: staging

**Historical partial report:** This records the first D: phase, before the portable PostgreSQL download and server run. The parent clarified the download authorization, and the later native PostgreSQL/DuckDB gate passed all 110 checks after a scoped JSONB envelope fix. See [completed PostgreSQL native qualification](postgresql-native-qualification.md) for current results. The earlier download hold and PostgreSQL nonexecution below are superseded; the PGlite ownership blocker remains.

Native DuckDB receipt arithmetic passed. Actual PGlite SQL and orderly persistence probes completed, but competing instances demonstrated an unsafe ownership condition. Native PostgreSQL has not executed. No production default is selected, and both qualification runners intentionally exit 1 for their remaining blockers.

## Actual engines and proof boundaries

| Execution | Observed version | Result | What it establishes |
| --- | --- | --- | --- |
| Production DuckDB worker with native Windows binding | DuckDB `v1.5.5`; `@duckdb/node-api` and binding `1.5.5-r.3` | 32 native checks passed | Exact literal receipt figures, registered operations, fan-out traps and rejection of an altered answer. |
| PostgreSQL-dialect verifier backed by actual PGlite WASM queries | PostgreSQL `18.3`, PGlite `0.5.8`, wasm32 / Emscripten `3.1.74` | 45 checks passed; qualification blocked | 30 real SQL fixtures, four JavaScript refusals, exact import/FX, synthetic claims/idempotency, transaction rollback and orderly directory reopening. |
| Native PostgreSQL server / `PostgresSnapshotBackend` | Driver `pg@8.23.0` installed; server absent | Not executed | No native PostgreSQL arithmetic, transactional CAS, encrypted Vault composition or PostgreSQL-versus-DuckDB agreement is claimed. |

The combined PostgreSQL/DuckDB report contains 67 successful checks: 30 JavaScript literal-answer checks, four JavaScript refusals, one projection validation and 32 native DuckDB checks. It reports `duckdb: native-executed`, `postgres: not-executed`, `DISPOSABLE_DATABASE_REQUIRED`, and `BOTH_NATIVE_ENGINES_REQUIRED`. These are mandatory failures, not skipped tests.

The PGlite harness counts 236 verifier SQL calls, plus additional setup, persistence and transaction queries. Its production verifier proof remains `injected-sql` because `connectionFactory` is an injected adapter path; the separate qualification report identifies the actual WASM engine. Synthetic SQL tables test persistence mechanics. Application composition uses `FixtureStateStore`, not a product PGlite Vault adapter. PGlite's engine string does not count as native PostgreSQL server verification.

## PGlite ownership blocker

Two independent PGlite instances opened the same synthetic directory within one Windows process. Each observed revision/value `0/0`. Both updates constrained by revision `0` acknowledged revision/value `1/1`; two writers reported success. After orderly closing and reopening, the persisted row remained `1/1`, losing the second acknowledged increment.

The report records `UNSAFE_INDEPENDENT_INSTANCE_CAS`, `directoryOwnershipSafe:false`, `processLocksCertified:false` and `productionQualified:false`. Detecting this condition passes the probe but blocks qualification. This establishes a reproducible unsafe ownership condition in the tested setup; it does not characterize OS cross-process locking, which was not tested. A future authority adapter must enforce one owner per directory and qualify competing processes before selection. Single-instance CAS and orderly reopening alone cannot satisfy that gate.

## Scoped DuckDB initialization fix

The pinned native C configuration API refuses `enable_logging` and rejects a temporary-directory change after external access has already been disabled. `platform/runtime/analytics.ts` now configures empty temporary storage and its zero-byte limit first, disables external access and extension loading, and locks configuration last. It reads the actual session's logging state before exposing the connection and refuses unsupported states as `SQL_SANDBOX_UNSUPPORTED`.

An actual native diagnostic observed disabled logging, external access `false`, locked configuration, an empty temporary directory and a zero-byte temporary storage limit. Attempting to enable external access failed because configuration was locked. No OS or network setting changed. Initialization failure closes the created connection and instance; cleanup failure paths were reviewed, not fault-injected against native handles.

With the fix, the full source suite passed **274/274**, with no failures or skips. The focused analytical, differential and PostgreSQL protocol suite passed **58/58**. Those source/protocol tests include injected pools and do not claim server verification. Native fixtures provide the separate engine evidence above. Syntax and `git diff --check` passed.

## Approved staging and integrity

The user approved portable tools and dependencies on D: with synthetic data, a 4,000,000,000-byte shared staging cap and no permanent Windows service. D: existed with 75,128,967,168 bytes free, and `D:/Chausar/build-tools/qualification` had no conflicting contents or reparse points before creation. This lane's dependency and qualification files remain in that isolated directory. A later recursive all-file measurement of the shared `D:/Chausar/build-tools` root reported **315,532,466 bytes** across 5,443 files, below the shared cap. This is a measurement snapshot, not a guarantee about other tasks' future writes; retained synthetic databases, logs and caches are included.

Supported escalated tools succeeded for official registry metadata and an exact, project-local dependency installation. The private staging manifest pins `pg@8.23.0`, `@duckdb/node-api@1.5.5-r.3` and `@electric-sql/pglite@0.5.8`. Npm used a new approved D: cache with lifecycle scripts disabled, audit/funding requests disabled and no global changes. All 19 installed package tarballs were independently rehashed against the official registry SHA512 values and lockfile. Their compressed bytes total 22,548,110. Vendor/package legal notices remain in the staged distributions.

This successful acquisition occurred before the parent's later instruction to stop all DuckDB package acquisition following another task's rejected registry retry. No package was acquired after that stop instruction. Existing verified staged bytes were used for local tests. The previously inaccessible C: npm cache was never retried. The parent-reported rejection of `https://registry.npmjs.org/@duckdb%2fnode-api` in the packaging lane is separate from this lane's earlier successful approved installation; it does not authorize any alternative route or machine.

The final native runner used process-scoped `TEMP` and `TMP` under the approved D: staging directory. PGlite used only generated synthetic directories there and a supervisor outside WASM with a 50-second process ceiling. It completed in approximately 16.6 seconds without being killed. No database server, permanent service, cloud resource, customer database, system security change, signing key or live connector action was created.

## PostgreSQL prerequisite still held

The [official PostgreSQL Windows page](https://www.postgresql.org/download/windows/) identifies EDB's ZIP distribution as the portable route. The [EDB binary landing page](https://www.enterprisedb.com/download-postgresql-binaries) lists PostgreSQL 18.6, the intended server version. Its exact current Windows x64 archive URL, distributor build revision, archive size and integrity reference remain unverified. The landing-page request succeeded; archive HEAD/GET, download, extraction and execution were not attempted.

Review identified [EDB Terms of Use section 5](https://www.enterprisedb.com/terms-use), which restricts automated data gathering without written consent. Its defined website property is `www.enterprisedb.com`; applicability to a particular portable archive endpoint was not established. This possible restriction on an unattempted programmatic archive request prompted the hold. It was not a network denial or an automatic approval rejection in this lane.

Section 3 also contains generic agreement-before-install/use wording. No mandatory click-through, checkbox, account/login gate or archive-specific acceptance step was observed, and no terms were accepted. The archive flow was not visited. A requirement to accept the proprietary EULA for this PostgreSQL OSS ZIP is not established: [EDB EULA section 1.15](https://www.enterprisedb.com/legal/EDB-Eula) expressly places OSS exclusively under its applicable open-source license. Preserve the [PostgreSQL license](https://www.postgresql.org/about/licence/) and bundled notices; their existence alone does not justify requesting confirmation. The earlier handoff's blanket license-acceptance language overstated the observed evidence.

The next prerequisite is clarification of the automated-download clause for the official Windows x64 PostgreSQL 18.6 ZIP, or a parent/user-supplied official archive with its exact URL and integrity evidence. No new archive-specific acceptance action has been identified. Stage any permitted archive under the already approved D: root, verify before execution, and then initialize an isolated synthetic `chausar_test` database. Any test server must bind only to loopback on an available explicit ephemeral port and stop afterward without service registration. No such server has started. The existing hard runner requires a fresh empty disposable database and will then exercise native PostgreSQL arithmetic, encrypted snapshot CAS/history and dual-engine composition. EDB archives must not be used to acquire the blocked npm dependency.

## Reproduction and retained evidence

The staging directory contains a source snapshot of commit `4ca43c` plus the reviewed analytics initialization fix. The repo manifests, shared schema and integration worktree were not edited. Use the existing pinned staged dependencies; these commands acquire nothing:

```powershell
$env:TEMP = 'D:/Chausar/build-tools/qualification/temp'
$env:TMP = $env:TEMP
node D:/Chausar/build-tools/qualification/source/scripts/verify-database-differential.mjs
node D:/Chausar/build-tools/qualification/qualification-pglite.mjs
```

These retain qualification failure until their blockers are resolved. PostgreSQL URLs and disposable acknowledgement must meet the guard in [database-differential.md](database-differential.md). The PGlite harness asserts its exact approved D: root and generates a fresh synthetic directory; repeated runs retain additional data, so measure the shared cap before repetition.

| Artifact under `D:/Chausar/build-tools/qualification` | Purpose |
| --- | --- |
| `package-lock.json`, `package-inventory.json`, `package-integrity.json` | Exact dependency provenance, notices and independently verified hashes. |
| `postgres-duckdb-qualification.json` | Native DuckDB evidence and explicit native PostgreSQL blockers. |
| `qualification-pglite.mjs`, `pglite-qualification.json`, `pglite-qualification.log` | Actual WASM harness, ownership result and supervisor evidence. |
| `duckdb-ordered-config.mjs`, `duckdb-ordered-config.log` | Actual native initialization and locked-configuration probe. |
| `focused-tests.log` | 58 focused source/protocol tests. |
| `metadata/edb-binaries.html` | Previously fetched landing page; no server archive is present. |

The PGlite harness SHA256 is `495901908e30c4dbdeb3eddbb9465b54d3d75c8f17924aeb6ebf515ff1b476dd`; its final report SHA256 is `86708a8434cc83315fa089aacff3cf194f8e7a87807b6b2b0f85deac4db4034d`. Full source-suite output remains in the lane workspace at `verification/native-fix-source-tests.txt`. Qualification artifacts are local supporting evidence, not release assets.

Remaining full-scope contracts from the earlier report still apply: normalized relational claim/schema compilation, interval-claim semantics, settled-payment source contracts, complete source extractors, product PGlite authority integration, cross-process ownership, crash/power-loss recovery and installed signed runtime qualification. None is inferred complete from fixture arithmetic.
