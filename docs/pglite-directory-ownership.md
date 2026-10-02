# PGlite directory ownership

The actual PGlite 0.5.8 fixture previously acknowledged two independent revision-0 writers over one filesystem directory, then retained only revision/value 1/1. That raw WASM failure remains evidence. This change adds an independent, nondefault cooperative admission wrapper; it does not change PGlite itself, introduce a Vault authority adapter or select a runtime default.

`platform/runtime/pglite-directory-owner.ts` acquires an exclusive sibling directory before calling its synchronous client constructor. Existing claims always refuse `PGLITE_DIRECTORY_BUSY`, including malformed, incomplete or abandoned claims. There is no PID/age takeover or automatic recovery. The caller must provide existing, ordinary absolute filesystem directories, with the database strictly below the declared owned root. Canonical path and bigint filesystem identities are retained and checked. Relative paths, redirects and URL/in-memory storage profiles are outside this API.

The ownership directory is `<database-directory>.chausar-pglite-owner`, containing one bounded exact `owner.json` proof. It sits outside database contents: inspected PGlite 0.5.8 NodeFS source mounts the entire host data directory at PGDATA, and its database dump traverses that directory. An interior marker would enter the dump. No bootstrap failure from such a marker was claimed or tested.

The returned facade exposes `query`, `exec`, `transaction`, `close`, and read-only `directory`/`state`; it exposes no raw client, transaction client or independent close method. The trusted constructor must not retain/use the raw client separately. Close synchronously stops admission of new operations, drains already admitted work, and invokes the captured client close exactly once. Existing transaction callbacks can complete through their private query/exec facade. Ended transaction facades refuse new work.

All callers share the same close promise. Ownership release requires that original close promise to resolve and `client.closed === true`. It then validates directory identity, the original marker inode and exact bytes, and the absence of extra entries, before removing only its owner file and empty sibling directory. Data files are not removed or rewritten by this wrapper. Missing/replaced proof, unexpected entries, failed close, unconfirmed close or a deadline leave admission occupied/quarantined. Late readiness or shutdown completion never triggers a delayed release. A cached old close cannot remove a successor's claim.

The new transaction profile is deliberately conservative: any admitted child `query`/`exec` rejection rejects the driver's transaction callback, including detached or caught errors and `undefined` rejection values. This directs a conforming client's callback-failure rollback path; actual SQL rollback remains a native acceptance requirement. Savepoint/error-recovery transactions are outside the current profile. No existing product transaction caller is changed by this standalone module.

`startupTimeoutMs` bounds waiting for readiness only. `closeTimeoutMs` bounds operation drain and the original client close only. Both default to 5000 ms and accept 1–60000 ms. They do not interrupt synchronous construction or bound filesystem acquisition, identity checks or release. The native coordinator still needs an outer process ceiling. Successful library closure is a lifecycle condition, not a power-loss durability guarantee; inspected PGlite close code logs some shutdown errors rather than propagating them.

This is cooperative exclusion, not a security boundary or an engine authority fence. Every process using the directory must follow the wrapper. Removing/replacing a live marker, using an unguarded PGlite constructor, retaining raw clients, or mutating admitted directories violates the contract. Marker verification protects normal release; it is not performed before every live SQL operation. Manual recovery requires proven engine/process quiescence and remains outside this change. The existing process-lock helper is untouched because its dead-PID recovery and missing-marker release semantics differ from this policy.

## Source/unit evidence

`node --test --test-timeout=10000 platform/tests/pglite-directory-owner.test.ts` passed 25/25 on Windows with Node 24.13.1, zero failure/cancellation/skip/todo, in 1616.8863 ms. The tests use actual C-drive filesystem claims and explicitly injected lifecycle/query/transaction clients. They execute no PGlite import, WASM, native SQL, server, external provider or subprocess. They establish ownership/lifecycle logic rather than database arithmetic or durability. The Windows-only C fixture profile is explicit; other OS qualification is not inherited.

The cases cover independent constructors and canonical lexical/case aliases, distinct directories, pre-abort and invalid scope/deadlines, throwing/rejected/late readiness, `undefined` rejection, admitted operation drain, one cached close, successful reopen with unchanged data, close failure/unconfirmed/late timeout, exact proof/inode/extra-entry refusal, stale claim refusal, private transaction facades, and failed child propagation.

Raw report: `C:/Users/karta/Documents/Codex/2026-10-01/task-4/verification/pglite-owner-unit-20261002/source-unit-first-run.tap`. Test fixtures are retained under that C-only TEMP/TMP root. No recursive cleanup, dependency acquisition, D write, native/WASM launch, shared Engine/Vault/schema/package edit or publication occurred. Only the wrapper's normal successful claim release removes its own metadata.

The focused strict TypeScript check of these two new source/test files passed with `--noEmit --strict --target es2022 --module nodenext --allowImportingTsExtensions --types node`; it used the already installed C-drive compiler and Node types read-only. This was not a whole-product typecheck. Both files also passed `node --check`.

SHA256 evidence binds the tested inputs and raw output:

| Evidence | SHA256 |
| --- | --- |
| `platform/runtime/pglite-directory-owner.ts` | `1bcad4b09fc34598fe8331a774a902798816cabeb108c4831401bc227f7898e5` |
| `platform/tests/pglite-directory-owner.test.ts` | `8ebb738274924039fd31b92065f3893470d735ad9d8c08314f48c7b0c0e45d54` |
| `source-unit-first-run.tap` | `fbea089061a7d13c794e9c29ce48ce75263b2d602134e72841df5ae3e9fe555f` |

## Native acceptance for task15

- Use the exact integrated source and existing approved PGlite 0.5.8. Route every file-backed constructor in the selected qualification through `openOwnedPGliteDirectory`; retain the old raw two-instance failure separately.
- Hold the first actual WASM instance open and attempt a second independent owner. Assert `PGLITE_DIRECTORY_BUSY` and that the losing constructor count is zero. Repeat while readiness, admitted operations and close are pending; qualify cross-process cooperation separately.
- Exercise actual same-instance CAS and the complete unchanged arithmetic/decimal/currency/missing-state/fan-out corpus. Verify temporary projections and failed transaction rollback, including the conservative child-failure policy.
- Close the first actual client, confirm ownership release, reopen a fresh client and read exact retained revision/value and synthetic data. Prove the old cached close cannot remove the successor's claim.
- Probe actual readiness/extension/close failures and abnormal termination. Preserve occupied claims on ambiguous outcomes; do not auto-delete or steal them. Investigate swallowed shutdown errors before claiming durable closure.
- Preserve source/package/fixture provenance, owned filesystem scope, bounded outer supervision and explicit real-versus-injected evidence. Full encrypted authority, archive/activation, crash/power-loss recovery, other platforms and runtime-default selection remain unqualified.

No actual WASM rerun occurred in this source lane. The prior 41/42 failure is neither removed nor relabelled green by these 25 unit tests.
