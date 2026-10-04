# Encrypted source integration

This source candidate starts from `7bcb3b0cff25c1f872d8159049b234d5dd9f86f4` and preserves the reviewed learning `b8c270262742a97436cea829fc340c7073922744`, scenario `06c960aae2024691f6c4a81e83dd5e6d4f886830`, and lesson `7f43d631cea8e02e71fceb4dbb34740e8266c33c` ancestries. It does not change or rebuild the frozen native preview package.

`State.scenarioRecords` and `State.lessonState` are optional private encrypted namespaces. Opening an older workspace performs no namespace migration or write. Every authorized protocol mutation joins the existing serialized Vault transaction and encrypted snapshot commit. These records are not appended to public answer lists. A scenario's retained business input excludes both private namespaces, preventing recursive retention of unrelated private records.

## Public contracts

The existing Engine request context supplies the authenticated current member, role, permission epoch and channel. Requests cannot supply custody snapshots, calculators, evaluation authorities or a replacement context. Only these scenario revision methods are registered:

| Method | Required payload |
| --- | --- |
| `scenarios.create` | `version`, `label`, `baseline`, `alternatives`, using `ScenarioCreateRequest` |
| `scenarios.addAnalysis` | `scenarioId`, `expectedHeadRevisionId`, `input`, using `ScenarioAnalysisRequest` |
| `scenarios.changeAssumption` | `scenarioId`, `expectedHeadRevisionId`, `branchId`, `priceChangeBps` |
| `scenarios.beginRun` | `scenarioId`, `revisionId`, `jobId` |
| `scenarios.evaluate` | `scenarioId`, `runId` |
| `scenarios.finalize` | `scenarioId`, `expectedHeadRevisionId` |
| `scenarios.reopen` | `scenarioId`, `revisionId` |
| `scenarios.recompute` | `scenarioId`, `expectedHeadRevisionId` |

All outer payloads reject unknown fields. The producer validates nested requests and exact revision identities. Scenario calculations use the existing production `DatabaseCalculator.verify` capability and the existing per-view connector readiness guards. Historical inputs and receipts remain exact; later evidence requires explicit recomputation. Comparisons are inert and grant no action approval or execution authority.

`memory.lessons` takes an empty payload and returns current `LessonView` records. `memory.decideLesson` takes the exact `LessonDecision` fields: `candidate`, `reviewId`, `reviewDigest`, `decision`, and `reason`. Proposal, evaluation binding, review creation, retirement and applicability remain trusted host lifecycle methods; they are not extra public RPC endpoints.

The host must explicitly configure `EngineOptions.lessons` with an authentic current evidence resolver and personal target authority. Evaluation authority remains optional for proposals and mandatory before binding evaluations, reviewing or deciding an evaluated lesson. No evaluation scores, clean taint classifications, hidden-suite qualification, target schemas, schedules or model routes are invented by Engine. Without configured lesson authorities an empty legacy namespace lists as empty, retained lessons cannot be read, and all lesson decisions fail closed with `LESSON_AUTHORITY_REQUIRED`.

## Deletion and qualification

Source deletion and retention cleanup atomically purge each affected whole private record and its dependent lesson lineage with the existing source and invoice cleanup. Current source access and owner epoch remain release conditions. A retained scenario that exceeds current retention refuses release before physical cleanup. Approval and retirement are protocol state; current applicability rechecks all supplied evidence, target and evaluation authorities and grants no business effect.

The retained semantic interchange extension now handles absent, present-empty and populated private namespaces with explicit versioned profiles. Legacy absence remains the exact v1 archive; presence selects a v2 archive and the exact present namespace stores. Nested JSON order and original semantic pins remain unchanged. Current scenario reopen and lesson history/evidence/retention authorities guard complete copying. Fresh-owner activation keeps both namespaces solely inside unchanged encrypted historical evidence; it creates no active scenario namespace or lesson approval. See [retained interchange contract](retained-semantic-interchange.md) for compatibility and source verification. Broader namespace recovery is unqualified and `fullWorkspacePortable` remains false; PGlite remains unqualified as a production default.

The integration acceptance fixtures are explicitly synthetic source tests. They exercise actual loopback HTTP, Engine request dispatch, encrypted fixture storage, fresh Engine instances, SQL-verifier admission through injected prepared-statement projections, and current-authority refusal. They do not qualify native PostgreSQL, DuckDB, a real evaluator, a real model, a frontend, or real business outcomes. Native PostgreSQL acceptance reported by the separate task15 coordinator belongs to its accepted commit `1ca71782973ff9de3ff5365ea76101c350f90653`; no new native test was run for this candidate.

## Observed source validation

On 2026-10-03, Node source tests passed **314 tests** with zero failures, skipped or cancelled tests: 107 scenario/lesson/private-trial/calculator regressions, 131 canonical-learning/core-deletion/interchange regressions, six new public HTTP cases, and 70 private-transaction/Vault cases (including 27 new private transaction cases). The final strict TypeScript check passed with the existing `strict: true`, `noEmit: true` configuration. Syntax and JSON validation passed for 557 source files; the final small test-fixture correction also passed strict checking and actual Node execution.

Independent static review found and verified repairs for a post-publication retention gap and phantom source roots from arbitrary imported field values. Both pre-fix failures are retained as checks evidence. The held encrypted-commit regression now refuses an expired result without replaying publication. Typed-root cleanup now accepts ordinary source-looking values without inventing an additional grant. Evaluation-only source deletion purges its whole lesson and candidate-owned episodes while preserving unrelated custody. Malformed lifecycle collections roll back without changing encrypted bytes.

The public tests verify hand-authored totals `10010`, `11011`, and `12012` for a retained baseline and two alternatives, exact head refusal, later explicit recomputation, fresh Engine reopen, current private source/author access, human review-bound approval, retirement, and complete public source deletion. Every process and both redirected streams joined; no timeout or forced cleanup occurred. First-run fixture failures and their narrow corrections are preserved separately, including canonical sorted row membership and normal JSON omission of an optional legacy tombstone field.
