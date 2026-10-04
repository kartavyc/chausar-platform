# Today tiles source contract

`platform/runtime/today-tiles.ts` exports `TodayTilesService`. Its distinctly named contract file is `platform/runtime/today-tiles-contracts.ts`. The host passes its **installed** `CalculatorService`, with synchronous consumer and receipt readiness guards. The service preserves that instance's verifier when configured; it never constructs an unguarded calculator or supplies a substitute verifier. Engine registration, the shared Today DTO, desktop allowlist and frontend adapters remain integration-owned.

`build(context, request)` requires:

- The current published `dictionaryHash` and one canonical ISO `asOf` timestamp with milliseconds and `Z`.
- An explicit scope: distinct `sourceIds` and `branch` (a named branch or `null` for the caller's authorized branches). An empty source list stays empty.
- Explicit tile IDs, labels, published operations, receipt figure keys, inclusive business-date periods and ordered, nonoverlapping bucket IDs, labels and periods. Buckets must lie within the tile's period. A caller can omit dates from its bucket configuration; the service returns only the declared buckets and never fills or interpolates them.
- If requested, a comparison operation, figure key and explicit prior period. The only compatible installed comparison is the published earned-revenue `change` operation for an earned/revenue sum tile's `total`. Billed, received and contribution comparisons remain unavailable. No comparison arithmetic is added here.

The service bounds requests to twelve tiles, sixty-four sources, 366 buckets per tile and 512 total calculations. These are input allocation limits, not product presets. Starter packs have no chart configuration. There are no production tile choices, timezone defaults, automatic buckets, qualification thresholds or scheduling settings in this module.

Each primary value, comparison and chart point returns its currently authorized receipt ID, exact calculator figure (integer string, unit, currency and display), dictionary/definition identity, original coverage and structured gaps. A partial measured value retains its gaps. Missing evidence or an absent figure returns `figure: null`; the retained receipt can still be opened for its evidence and omissions. Unknown operations and unsupported comparisons return unavailable gaps without a receipt.

No counted known amount for any required definition in any requested period establishes zero. This conservatively withholds a compound figure when a required term has no evidence. A reconciled imported row with an explicit zero amount establishes a measured zero; an empty selection does not. For comparisons, both periods need evidence, even though the calculator's receipt aggregates coverage over both. An undefined basis-point denominator leaves its requested figure unavailable. Currency, amount and event-sign refusals retain their typed error as an unavailable gap. Authority, readiness, verifier, consistency and publication failures propagate without returning a protected partial batch.

Every calculation uses the same declared knowledge timestamp, source scope and branch. Receipts must match their current dictionary, operation definitions, currency, periods and scope. The service fences changes to workspace identity, authority, facts, import evidence, source precedence, customer identity and tombstones between computations. It reopens **all** receipts after the last awaited calculation, including offscreen points, through the installed calculator's current row/source/member/epoch/branch and readiness checks. It also rechecks consumer readiness and refuses changed or stale receipts.

The coherence fence is deliberately conservative: a change outside the selected source/branch scope also invalidates an in-progress assembly. For compound operations, every published definition needs evidence even when the selected figure is an intermediate figure that uses fewer definitions.

`atomic: false` is intentional. Calculator publication occurs sequentially; a failed batch can leave earlier private receipts and answers. The coherence fence rejects a mixed result but does not create a transaction spanning all calculations or undo earlier receipts. `asOf` is the installed memory service's learned-at timestamp, not certification of the full product plan's durable distributed authority visibility cut. `verification` reports whether the host installed a verifier; it does not qualify native SQL or any connector/provider.

The design basis is approved inventory TD-01 (receipt-opening charts, no-data state, measured changes without asserted causes) and TD-04 (typed evidence links). This source slice does not complete Today or Activity acceptance. The user preview and broader product remain partial; no partial flags are cleared.

Focused tests import labelled synthetic CSV facts through the actual `ImportService`, publish definitions through `OntologyService`, and compute/open real `CalculatorService` receipts with `EngineConnectorService` readiness guards. Synthetic storage and verifier probes do not qualify a native database, a live connector, browser/native presentation, persistent custody or production deployment. No packages or datasets are acquired for this slice.

## Source verification, 2026-10-04

Base commit: `2bc59dc1f527ec67dafa8fa350fd9832f3f705ba`, verified against remote `private/joined-source-corpus-native-fable-20261003`. Node runtime: `v24.19.0`.

- `node --test platform/tests/today-tiles-imported.test.ts`: **31 passed**, zero failed/skipped. Includes explicit null branch and empty source scope, custom money-field binding, actual managed-source consumer/receipt refusal, all final-point mutations, offscreen receipt denial, verifier failure and installed guard/verifier replacement. The custom-field test proves exact binding; its source control total reconciles the existing import amount field, not an independent semantic control total for the custom field.
- `node --test platform/tests/calculator-source-scope.test.ts platform/tests/import-lineage.test.ts platform/tests/comparison-scenario-custom-definitions.test.ts platform/tests/comparison-scenario-custom-sql.test.ts`: **122 passed**, zero failed/skipped. SQL regressions use injected synthetic ports; no native database was executed.
- `node --check` passed for both new runtime files and the new focused test file.
- Independent read-only source review found no concrete correctness defect in the service/contracts; focused test review confirmed real service use and the stated synthetic/in-memory limits.
- `npm run typecheck` could not execute: exit **127**, `tsc: not found`. No installed compiler was found and acquisition was outside this task's authorization. Syntax and runtime tests do not substitute for strict TypeScript checking.

There was no native/browser/credential execution, external send, setting change, CI rerun or main update. The private Git publication is a source handoff, not deployment or full product acceptance.
