# Full-build parallel source lanes, 1 October 2026

Main remains `c8cbf93f09ca83c39564ded48259868083655e1f`. Approved frontend source
`9329823c20d9c43da03344ea17e43b5584728d18` is isolated and unactivated. Its host
contracts passed applicable checks; genuine React/fonts and rendered journeys are
pending. These source lanes preserve the full plan, including hosted/enterprise,
56 connector groups and all native platforms. No full quest has user end-to-end
sign-off. Historical ledger descriptions are not current completion counts.

Workers can start independently from c8cbf93. Integration exclusively owns
`engine.ts`, `server.ts`, `worker.ts`, shared IPC/preload methods and root manifests.
Workers own only the new module/test paths below. Existing `reports.ts`, `sync.ts`,
calculator/ontology and frontend remain read-only until a narrow integration seam
is agreed. No acquisition, missing dependencies, real model dispatch, GUI launch,
spending or D-drive writes are necessary. Task 18 exclusively coordinates D-drive
tool writers; task 16 owns the separately approved C-only native synthetic setup.

## 1. Operational forecast backtesting at historical origins

Authority: final plan 10.6 and 22.24, Day 5. Current `ReportService.forecast` takes
a single flat monthly series and performs one-step folds; it does not bind each
training receipt to the knowledge available at a historical origin, requested
operational horizons or origin manifests. Later-known corrections can leak into
an earlier evaluation. FORECAST-1/library and probabilistic qualification remain
additional requirements rather than being replaced by this lane.

Own `platform/runtime/forecast-contracts.ts`, `forecast-evaluation.ts`,
`forecast-service.ts` and new focused/source-import acceptance files.

Contract: `ForecastEvaluationRequest` includes version 1; explicit mode
`operational-as-known | restated-diagnostic`; operation, dictionaryHash,
sourceIds, branch; horizonsMonths, cadenceMonths, minimumTrainingMonths;
method `linear-trend-v1`, benchmark `last-observed-v1`, availabilityLagMs;
origins `{id,eventCutoff,knowledgeCut,trainingReceiptIds,
targets:[{horizonMonths,receiptId}]}`. Implement
`evaluateForecast(request,resolvedEvidence)` and
`ForecastService.evaluate(ctx,request)/get(ctx,id)`.

Operational training binds the declared origin's knowledge cut and whole-month
event scope, including the explicit availability lag. Check that the dictionary
existed at that origin, pin compatible definition/currency/scope and reject
duplicate/gapped/overlapping/incomplete evidence. Evaluate every declared horizon
against the same benchmark with exact BigInt rational arithmetic. Record
predictions and errors per origin/horizon, request and evidence digests, method
revisions, coverage and limitations. Label restated diagnostic runs separately;
they cannot qualify operational evaluation. No calibrated-interval claim.

Prerequisites: guarded CalculatorService receipts, OntologyService.history,
two-clock facts and encrypted State.answers already exist. Inject current receipt
and historical-definition checks rather than bypassing the connector gates.
Order: contracts/evaluator -> persisted service -> root-owned
`forecasts.evaluate/forecasts.get` join -> actual late-correction, horizons 1/3,
missing-origin, deletion and current-permission public acceptance.

## 2. Receipt-backed business alert episodes

Authority: final plan 22.22 and GAP INT-47. `ReportService.brief` currently gathers
a report, due decisions and compliance dates. There is no deterministic alert
episode service maintaining one problem's activation, continuation and clearance.

Own `platform/runtime/alerts-contracts.ts`, `alerts.ts` and new focused/import
acceptance files. Implement `create/publish/evaluate/list/get` over the encrypted
StateStore with injected current-authority receipt resolution.

Rules explicitly declare their identity/version, operation and figure, units and
currency, source/population scope, comparison thresholds, activation and clear
persistence, severity levels and reopening behavior. Supply no business defaults.
Observations carry stable identities, receipt/definition/scope digests, observed
and known-on times, completeness and rule revision. Persist one episode identity
per problem with immutable transitions/amendments and receipt lineage. Repeated
observation cannot duplicate episodes; missing/partial/stale evidence creates
uncertainty and cannot clear a breach. Late corrections retain traceable amendment
or retraction history. Commit and reads recheck current member/source/row authority.

Return local transition notices only. Delivery remains behind existing exact
action preparation/approval; do not enable any unanswered write-back target.
Prerequisites: CalculatorService, source/receipt guards, StateStore and exact
integer units. Order: service -> root public Engine/RPC installation -> actual
import/calculation/episode acceptance -> optional brief/durable-goal composition
through the existing coordinator, with no second scheduler.

## 3. Persistent fenced transport for encrypted snapshot sync

Authority: final plan 24.2; Day 6; GAP SEC-39, INT-17, AGT-19. `sync.ts` declares
SyncTransport but runtime has no implementation. SyncService already owns
preparation, approval, signatures, encrypted snapshots, validation and staging.

Own `platform/runtime/sync-file-transport.ts`, optional
`sync-publication-recovery.ts` and isolated process/crash tests. Implement the
existing exact interface: `getHead()`, `acquireLease({deviceId,memberId,epoch,
now,ttlMs})`, `put({lease,expectedHeadHash,recordHash,snapshot,now})`,
`get(recordHash)`. A factory receives an explicit owned directory, workspace/vault
identity, trusted clock and bounds. Caller timestamps cannot extend a lease.

Persist bounded immutable hash-addressed opaque encrypted snapshots, atomic
lease/head state and monotonic fencing across restart. Enforce exact lease-token
identity and head CAS under cross-process exclusion, using existing process-lock
primitives only where their semantics support this contract. Reject mismatched
workspace/vault identities. Ambiguous publication reconciliation inspects the
persisted head/chain and never blindly resubmits or reports success without proof.

Prerequisites: Node filesystem/crypto, process-lock.ts and existing SyncTransport.
Order: transport -> independent process/restart/crash fixtures -> root injects
EngineOptions.sync -> separately join writer admission to jobs/actions. This is a
real local filesystem transport. It does not qualify remote peers, synchronized
cloud folders, partitions, device key custody, hosted operation or distributed
authority. No OS service, watcher, global setting or user directory default.

## Integration's concurrent lane

Join committed private investigation goal `e3fe940c7526cdfaa150d90f35a77bfb3d09cf81`
and independent public acceptance `475de1588460fe48cbb355a4f647b037f98a84ac` to
the existing Engine/desktop job admission. Preserve the exact saved objective,
ordered pending steps, owner/epoch, source/definition bindings, explicit capacity,
atomic measurement/operation record, blocked outcomes and guarded delivery.
No new scheduler or provider is installed. Sources remain synthetic in acceptance;
native/hosted/power-loss/business outcome acceptance is not inferred.

The candidate has its own C-only worktree and does not change the c8cbf93 native
acceptance source or activate the frontend. All three source lanes can start
without waiting for this join. Shared runtime joins and aggregate checks are
serialized by integration. Dedicated security review stays blocked/unverified;
normal feature correctness tests do not replace it.
