# Isolated scenario revisions

This slice implements the retained revision and comparison portion of the authoritative [build plan sections 10.6 and 22.31](specs/CHAUSAR-FINAL-IN-DEPTH-PLAN.md). It is based on exact commit `7bcb3b0cff25c1f872d8159049b234d5dd9f86f4`, confirmed as the parent of backup checkpoint `7109689003c09a62b70a0702a5558d070ad03617`.

At that baseline, `platform/runtime/calculator.ts:145–150` produces one constant-volume price-change receipt. `platform/runtime/private-trial-contracts.ts:7–11` defines definition, recipe and source-precedence trials. Neither retains a scenario revision graph. The new `platform/runtime/scenario-contracts.ts` and `platform/runtime/scenario-service.ts` wrap the unchanged `CalculatorService` to fill that independent gap.

## Integrated composition addendum — 2026-10-03

The integrated candidate adds `platform/runtime/engine-scenarios.ts`. Its `EngineScenarioService` requires the actual encrypted `Vault`; every mutation creates a detached producer and synchronous custody host inside one awaited, serialized `Vault.update`. The host resolves only exact service-issued records from the optional `State.scenarioRecords` namespace and performs insert-only or exact-digest draft CAS. The outer Vault transaction encrypts and commits the complete draft before returning a result. There are no nested Vault writes or caller-supplied custody bundles. Legacy State without this namespace starts empty.

Reopening uses the Vault's serialized read-only snapshot fence and retains the original revision, evidence and receipts without rerunning arithmetic or advancing the authority revision. Every producer State projection removes both `scenarioRecords` and `lessonState`, so one retained input cannot recursively capture private scenario or lesson custody.

Engine supplies current calculator guards for each retained view and, in production, the existing trusted `DatabaseCalculator.verify` capability. The producer forwards this verifier to its isolated `CalculatorService`; it does not install a new arithmetic authority or accept a verifier from RPC. Synthetic preview composition may omit it under the existing preview policy. The verifier must remain bounded and must not reenter Vault. This supersedes the original host-only slice's no-verifier and pending Engine-adaptation statements below; it adds no action, model, provider, materialization or execution authority.

Current-policy retention is checked on the whole record at custody use and immediately before operation release. Any expired retained revision, run, comparison, receipt, evidence knowledge cut, fact learning time, dated import or retained core evidence makes the record unavailable. Reopening and recomputing do not refresh those historical timestamps. After an awaited encrypted commit, the adapter enters a fresh read-only Vault fence and rechecks the exact issued revision pins, whole retained graph, current access, readiness and retention. A queued withdrawal or expiry during publication withholds the original result; this check performs no arithmetic replay or second write. Physical source deletion and retention cleanup must purge complete affected records in the same authority transaction; snapshots are not partially redacted and resealed.

This is a source integration description. The original isolated-slice observations below remain preserved as producer evidence. Final integrated validation is reported separately by the coordinator; this addendum makes no claim of native PostgreSQL, native arithmetic, browser, provider, frontend, full-suite or production acceptance.

## Authorized discovery addendum — 2026-10-04

On base `2bc59dc1f527ec67dafa8fa350fd9832f3f705ba`, `scenarios.discover` adds a read-only source-selection projection for retained what-ifs (plan §22.31, C01-R3-031/C02-R1-008; screen inventory AS-11/A9.1). It accepts only `{ limit?: number, cursor?: string }`. The default limit is 25, with integer bounds 1–50. The result is `{ mode: 'retained-revisions', items, nextCursor, noAction: true }`, with no totals or unavailable placeholders. Each item contains only:

```ts
{
  scenarioId: string;
  revisionId: string;
  label: string;
  createdAt: string;
  revisionMode: 'initial' | 'assumption-change' | 'graph-change' | 'current-state-recompute';
  status: 'partial' | 'complete';
  isHead: boolean;
  noAction: true;
}
```

One row describes one exact historical revision; discovery includes retained history and the current head. Newest creation time sorts first, then scenario/revision identities break ties. Labels are display data and need not be unique. Saved selection must retain `{ scenarioId, revisionId }` and reopen through `scenarios.reopen` with both exact pins. `isHead` describes the release instant; a later head change never replaces the selected revision. Partial, running or stale descendants stay partial. Complete describes graph coherence, not source completeness or approval to perform work.

The serialized Vault snapshot fence checks current account, workspace, private member/epoch, record authenticity and whole-record retention before considering a row. `ScenarioService.describe` uses existing exact reopen source, branch, evidence and per-view request/receipt guards and verifies graph/evaluation/run/result/comparison pins and original receipt lineage before releasing metadata. Selected rows are rechecked at release, then all selected retention checks use one shared release instant. No input snapshots, branches, jobs, assumptions, sources, result numbers, receipt bodies or action capabilities appear in discovery. Hash validation performs no calculation, and discovery never calls recompute, a verifier, a Vault update, label lookup or action preparation.

Discovery additionally requires installed `EngineScenarioOptions.discoveryAuthorityRevision(state)`, a pure synchronous generation covering external readiness dependencies. The service captures it before scanning, checks it after the scan and after all selected-row release callbacks, and binds it into continuation. A later callback withdrawing an earlier row therefore refuses the whole page with `SCENARIO_AUTHORITY_CHANGED`, even without a Vault write. The generation must advance without reuse on every readiness withdrawal/restoration; it never comes from RPC. Engine derives the fence from registry qualification digests, installed profile metadata and capture freshness eligibility across current and retained evidence under current authority. Dynamic semantic gates, profile factories and custom connector clocks must install `EngineConnectorOptions.readinessRevision`; missing generation refuses discovery with `SCENARIO_HOST_REQUIRED`. Existing create, mutation and exact reopen behavior remains unchanged.

Other members/workspaces/epochs are invisible. Known row-level availability refusals (absent/changed artifacts, expired retention, missing evidence/revisions/runs/branches, invalid graphs/vectors, source/branch/receipt refusal and `SOURCE_NOT_READY`) withhold that row without its name, count or reason. Current-account, Vault-fence, host/custody and unexpected guard failures refuse the page. Existing exact reopen safety refusals remain intact. Source deletion/retention purge removes discoverability; a previously selected pin then follows the existing exact reopen refusal, with no fallback to a label or newer head.

The complete current namespace is scanned to fill each bounded page; there is no hidden scan cap that drops authorized rows behind inaccessible ones. `nextCursor` exists only if another authorized row remains. Its opaque HMAC binds the service instance, current Vault identity/revision, account/role/epoch, readiness generation, page size and complete authorized projection (including custody digests). It contains no namespace offset, count, label or exposed Vault revision. A changed head, delayed completion, deletion, revocation, retention/readiness change, different limit/account/workspace or service restart invalidates continuation with `SCENARIO_AUTHORITY_CHANGED`; restart discovery with no cursor. Invalid parameter shapes use `INVALID_SCENARIO`. Neither error adds a frontend refusal-code requirement.

Engine dispatch and desktop allowlist/declaration/request/result parity explicitly register `scenarios.discover`. The existing generic desktop adapter forwards it. This slice does not change frontend selection or conversation persistence and makes no native, browser or complete-product acceptance claim.

## Original parent integration contract

Instantiate `ScenarioService(live, host)`. `live` exposes only `read(): State`; the service has no live update capability. The required `ScenarioHost` ports are:

- `now()`: trusted ISO wall clock. An omitted initial knowledge cut resolves once; explicit recomputation resolves a new current cut.
- `resolveScenario(ctx, id)`: authenticated private custody of the exact service-issued `ScenarioRecord`, never a caller-authored bundle or public RPC payload.
- `assertArtifactAuthentic(ctx, digest)`: independently authenticate the current ledger identity. Recomputing a checksum does not establish authenticity.
- `retainScenario(ctx, expectedDigest, record)`: synchronous atomic compare-and-swap and registration of the new authentic digest. `null` is insert-only. A conflict throws without overwriting or merging. Preserve contained evidence/revisions/runs/results/comparisons as append-only artifacts; head and per-revision job states are separate mutable manifests.
- `calculatorGuards(view, phase)`: synchronous, required consumer and receipt readiness guards for the particular retained evidence view. These do not grant action capabilities or install a database verifier.

Custody and readiness hooks must complete synchronously. The parent owns adaptation to its sole durable business coordinator, encrypted storage under workspace custody, current readiness, authenticated restoration and source-deletion purge. An asynchronous storage adapter must provide an appropriate atomic custody boundary before integration; this service does not silently accept unawaited writes. Purged/missing artifacts must refuse reopening. No Engine, RPC, Ask Saved, frontend, native, credential or packaging code is changed by this slice.

Public methods and their results:

| Method | Meaning |
| --- | --- |
| `create(ctx, request)` | Retain an explicit zero-price-change baseline and explicit price alternatives; return a partial `ScenarioView`. Each branch gets a stable ID even when labels match. |
| `addAnalysis(ctx, scenarioId, expectedHeadRevisionId, input)` | Create a new graph revision containing one required existing-calculator analysis. Dependencies are exact existing job IDs in the same branch. |
| `changeAssumption(ctx, scenarioId, expectedHeadRevisionId, branchId, priceChangeBps)` | Create an immutable alternative assumption revision. Preserve the baseline and every historical artifact. |
| `beginRun(ctx, scenarioId, revisionId, jobId)` | Issue and retain an exact run token after all predecessors are ready. Refuse old heads, already-ready/running jobs, and pending dependencies. |
| `evaluate(ctx, scenarioId, runId)` | Evaluate that issued token with `CalculatorService` in isolated memory and retain the immutable receipt/result. A late completion fills only its original revision. Repeating a completed run reopens its original result after current access checks. |
| `finalize(ctx, scenarioId, expectedHeadRevisionId)` | Retain an inert comparison only when every declared required job has an exact compatible request/evidence/assumption/predecessor vector. Return a manifest naming each actual run and receipt. |
| `reopen(ctx, scenarioId, revisionId)` | Return the exact retained revision and available receipts under current access/readiness. No arithmetic is rerun. Pending/stale/running jobs make the view visibly partial. |
| `recompute(ctx, scenarioId, expectedHeadRevisionId)` | Explicitly capture later evidence and a new knowledge cut in a new revision. Preserve prior requests, baseline, assumptions, receipts and comparison manifests. |

All mutation methods require ordinary `prepare` authority and exact head IDs. Reopening uses current read authority. Scenario IDs, branch IDs, assumption revision IDs, job IDs, revision IDs, run IDs and receipt IDs are identities; display labels never select or reconcile objects. Every declared job is required. No optional-job or arbitrary dependency language is introduced.

Dependencies establish readiness and exact provenance. These calculator jobs do not consume predecessor numbers as a new model or formula. A calculation refusal leaves its issued run active without publishing a result; the same token can be retried after readiness is restored or superseded by a new revision. A separate cancel/refused-state API is not implemented.

## Pins and invalidation

The initial baseline request explicitly supplies the existing published price-scenario operation and integer `priceChangeBps` numerically equal to zero. Alternatives explicitly supply their own basis-point strings; there are no business assumption defaults. Authored requests retain exact string values and omitted versus empty source scopes. Effective requests separately pin the normalized knowledge cut. Receipt assumption normalization does not rewrite authored request strings.

Each evidence artifact retains the exact isolated facts, imports, dictionary version/hash, source rules and identity history. Revisions pin its ID and digest. Each job pins its authored and effective requests and a transitive vector including evidence identity, directly used assumption revision, and predecessor job/input identities. Each issued run additionally pins the actual predecessor run/result identities. Every receipt is retained unchanged with its own digest.

Changing one alternative affects direct assumption consumers and their transitive descendants. Completed independent jobs with unchanged vectors are reused with their original run revision and an explicit reuse reference. A previously running affected descendant stays stale/pending in the new revision even if its old run completes later. Finalization checks all actual predecessor result identities and refuses partial or mixed comparisons. Historical revisions can still reopen after their head advances; historical heads cannot be newly finalized as the current comparison.

Explicit recomputation preserves the graph and branch identities but captures a fresh evidence identity/current knowledge cut, so all required runs need fresh evaluation. The old baseline remains retained under its original revision. The recomputation's authored request records its explicit new cut; previous authored requests remain unchanged.

## Access and no-action boundaries

Retained memberships never authorize a read. The service checks current workspace, private member and epoch, active membership/role, source grants, requested source scope, branch access and deletion. It rechecks after awaited calculator work, readiness/custody callbacks and before returning. Counted, excluded, superseded and other retained history are covered. Empty results still check requested-source grants.

This host-only slice conservatively retains the complete input snapshot. If any retained history becomes inaccessible, it withholds the artifact rather than returning a partially redacted graph. Scoped snapshot projection is not implemented. Parent custody must keep these snapshots private and purge them as part of ordinary source deletion. Returned views contain revision/job manifests and receipts, not the host-only input `State`.

The calculator sees an isolated evidence snapshot with live membership, policy and source-grant rules, including at its update boundary. Retained source-precedence rules preserve the original evidence interpretation. Its receipt/answer/audit writes affect only isolated memory. Action, model, workflow, route, plugin and session arrays are empty. No verifier, network, provider, solver, formula evaluator, execution or materialization port is installed. Comparison finalization grants no approval or action authority; any later acceptance must enter the parent's ordinary current-state action preparation.

Receipt provenance, coverage gaps, exclusions, assumptions and constant-volume/truncation semantics remain unchanged. Graph completeness means all declared runs are revision-coherent; it does not claim complete source coverage, a qualified demand model, causal effects or calibrated uncertainty. Broader variables, changed constraints, forecasts, optimization, provisional-object creation/materialization and real execution remain required in the full plan and gated until their contracts are specified and integrated.

## Validation scope

Tests use synthetic in-memory state/custody and synthetic CSV imports. No dependencies or datasets are acquired, and no provider, browser, native database, Electron, credentials or system changes are exercised. Node syntax/executable tests are reported as source evidence. TypeScript is absent in the execution environment, so compiler validation remains outstanding. GitHub CI is billing-blocked; the checkpoint uses `[skip ci]`, a private feature branch and a non-force push. The parent owns main and final integration.

Observed with Node `v24.19.0` on 2026-10-03:

- `node --test platform/tests/scenario-service.test.ts platform/tests/private-trials.test.ts platform/tests/calculator-source-scope.test.ts`: **60 passed, 0 failed/cancelled/skipped**, including **23 scenario tests** (25.41 seconds combined).
- `node scripts/check.mjs`: syntax and JSON validation passed for **543 source files**. Each of the three added TypeScript files also passed a final individual `node --check` after the authority fix.
- `git diff --cached --check`: passed. Only these three new source/test files and this directly related document are changed.
- `npm run typecheck`: **unavailable**, exit 127, `tsc: not found`. No compiler/dependency installation or CI rerun was attempted.

The acceptance fixture uses required calculator descendants as a synthetic stand-in for delayed analyses. It proves revision orchestration; it does not qualify demand/optimization models, durable custody, native arithmetic, materialization, UI flows or production execution.
