# Local strict-root source follow-up

This isolated follow-up starts from `5c0619dbce581f4329eab11521205e7fcfdcefbf`. It changes only `platform/runtime/ontology.ts` and adds `platform/tests/ontology-data-validation.test.ts`. Shared host, desktop, router, UI, preview, PostgreSQL fixture, package manifests and compiler configurations remain unchanged. Publication is blocked pending the parent's fresh user confirmation; this checkpoint is local only.

## Exact original diagnostics and resolution

| Original location | Diagnostic | Resolution |
| --- | --- | --- |
| ontology.ts 47:59 | TS2551: `value` does not exist on `number` | Supply the existing descriptor function's `object` generic argument, avoiding array mapped-type inference. The runtime descriptor traversal and dense/data-only array assertions are unchanged. |
| ontology.ts 137:47 | TS18046: `ontology.history` is `unknown` in a callback | Capture the already asserted array in a local reference and use it throughout the history assertion. Ordered versions, current/history equality and exact dictionary hashes remain required. |
| ontology.ts 257:42 and 257:58 | TS2339: union has no common `draft` / `pack` properties | View already data-record/exact-key validated publication data as `Record<string, unknown>` before selecting its own input. Wrapper detection, options and subsequent validation remain unchanged. |
| PostgreSQL native probe fixture 4:60 | TS2307: `pg` or corresponding declarations unavailable | Resolve genuine installed `pg 8.23.0` and `@types/pg 8.15.5`, matching the repository manifest. No fixture edit or invented declaration. |
| Same fixture 106:40 | TS7006: implicit `any` for `client` | Correct inference returns when the genuine declarations resolve. No annotation or cast added. |
| Same fixture 116:10 | TS2571: object is `unknown` | Correct generic query-result inference returns with the same genuine declarations. No annotation or cast added. |

The seven original errors are reproduced in [baseline diagnostics](root-typing-baseline-strict.txt). The prior frontend-only task-18 dependency tree omitted these PostgreSQL types. The new checkout alone uses a read-only junction to the existing verified backend dependency tree at `D:/Chausar/build-tools/project-dependencies/20261001000938489/node_modules`; no package was acquired, installed or changed. [Dependency proof](root-typing-dependencies.json) pins 120 genuine declarations, package versions and matching TypeScript compiler bytes. A checkout using only the frontend dependencies would still have the three environmental fixture diagnostics.

## Frozen validation

Full-root TypeScript compilation passes with the original `tsconfig.json`, TypeScript 5.9.3, `--noEmit --skipLibCheck false --incremental false`. No include/exclude, compiler setting, assertion, public type, permission check or type suppression changed. The exact final command and source hashes are retained in [strict metadata](root-typing-final-root-strict-frozen.json); its raw diagnostic log is empty, with exit 0.

The focused batch passes **187/187 Node tests**, zero fail/skip/cancel, covering publication, retained receipts, deferred review, backups, interchange, activation, compatibility, profile validation and the existing first-run actual Engine join. The new regression file contributes 23 cases checking dense frozen arrays, sparse/accessor/hidden/extra-property/prototype rejection, untouched getters and state, valid/invalid ordered history, exact CAS/digests, all four public publication forms and malformed-wrapper refusals. [Exact regression output](root-typing-final-regressions.txt). Syntax and JSON validation passes for 622 sources, including the independent probe program retained as an evidence artifact. All final command metadata records unchanged source bytes throughout execution.

The first new test incorrectly expected `INVALID_DICTIONARY` for an undefined wrapper draft. Existing behavior returns `UNKNOWN_PACK`; only the test expectation was corrected. [Initial failure](root-typing-regression.txt) remains preserved. No public refusal code or production behavior was changed to satisfy the test.

[Independent review](root-typing-independent-review.md) and its probes compare baseline and corrected behavior and check assertion/public-contract preservation. [Source and evidence hashes](source-and-evidence-sha256.json) bind the final two source files to every final check. The parent can review or cherry-pick this local commit after checking its own dependency resolution; no shared host change or coordination write is needed for these fixes.

New publication evidence copies normalize CRLF to LF and trim blank EOF lines; text logs also trim trailing display padding. The complete external raw evidence remains preserved; the manifest pins both raw and publication hashes. No diagnostics or outcomes are removed.

Tests use synthetic in-memory or encrypted experimental-file fixtures with verified temporary cleanup. No native PostgreSQL, Electron, browser, service or provider was launched. No credentials/authfiles, actual business data, global configuration or current preview was touched. This follow-up closes source compilation and local dependency resolution; it makes no native, desktop integration, pixel or full-product claim.
