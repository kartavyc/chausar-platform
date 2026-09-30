# Durable jobs through Engine

`Engine` now installs the delivered durable runner on its existing vault and `JobService` authority when the process host supplies `EngineOptions.durableJobs`. The recovered owner-brief path keeps its receipt/decision release guard. Typed goals use the runner's current source, evidence, objective and version guard instead.

## Explicit host policy and lifecycle

The host must supply `workerId`, `maxActiveJobs`, `leaseMs` and `networkAvailable`. No product active-job limit, spending cap, model tariff or live-provider qualification is selected by this integration. Both typed and legacy creation count the configured active ceiling; unresolved cancelled work still consumes capacity.

Server/worker entry points accept the complete set `CHAUSAR_JOB_WORKER_ID`, `CHAUSAR_JOB_MAX_ACTIVE`, `CHAUSAR_JOB_LEASE_MS`. Missing all three leaves typed jobs unavailable; partial configuration fails. These entry points install local ports only, and report no available remote job transport.

The trusted host calls `engine.updateJobLifecycle({ awake, windowOpen, backgroundEnabled })`. The worker also consumes private parent-process IPC `{ id, kind: 'host-lifecycle', state: { awake, windowOpen, backgroundEnabled } }` and acknowledges the same `id` with `result: { applied: true }`, or a bounded error. There is no renderer/member lifecycle RPC. Unknown lifecycle starts asleep with the window closed and background disabled. An open foreground window permits scheduling only while awake and with autonomy enabled; closed-window scheduling additionally requires host background permission and each job's background permission.

The desktop host must publish its actual window/suspend/resume/background state. This integration does not claim that installed native scheduling or the standalone server lifecycle is qualified. On-demand `jobs.run` is available through the public Engine/RPC path.

## Installed local goals

| Type | Input | Result |
| --- | --- | --- |
| `calculation-set` | `requests: [{ id, input: CalculationRequest, reserveMinor, durationMs }]` | Exact local calculation projection with accessible persisted receipt evidence. Only the mandate's selected sources contribute. |
| `evidence-review` | `records: [{ id, input: { receiptId }, reserveMinor, durationMs }]` | Observation of the exact existing receipt, with the same current source/row/owner permission checks. |
| `action-preparation` | `actions: [{ id, input: { connector, operation, payload, sourceIds? }, reserveMinor, durationMs }]` | Exact prepared action previews; no approval or execution, and `businessSuccess: false`. |

Each configuration retains its concrete `goal`, explicit budget/reservation, `limits` (model units, execution duration and action exposure), stop rule, source list, schedule, routes and allowed actions. These ports perform no remote model/provider call. The currently installed action operation is `local.reminder-draft`. A prepared preview is not a sent reminder, a persisted conversation draft, or proven business success.

The calculator's production database verifier and any consumer/receipt guards flow through the same `CalculatorOptions` used by Engine. Synthetic file-store tests do not qualify PostgreSQL, DuckDB, live connector semantics or hidden-shop correctness.

## Public requests

| Method | Payload |
| --- | --- |
| `jobs.types` | `{}`: installed types, explicit configured policy and reported lifecycle |
| `jobs.create` | Typed configuration or existing `owner-brief` configuration |
| `jobs.run` | `{ id }`: typed dispatch requires the pinned owner's exact member/role/epoch |
| `jobs.amend` | `{ id, config }`: replacement typed objective fences old work and preserves unresolved original scope |
| `jobs.cancel` | `{ id }`: durable cancellation plus provider abort signal |
| `jobs.reconcile` | `{ id }`: readback of one uncertain original operation, without redispatch |
| `jobs.progress` | `{ id }`: remaining obligations/children and reconciliation ownership |

Existing `jobs.list/pause/resume/approve/accept/reject` requests remain available. Typed acceptance rechecks the release guard inside `JobService`'s serialized state transaction. The desktop IPC allowlist must include the five new methods (`types`, `amend`, `cancel`, `reconcile`, `progress`).

## Persistence and stopping

The local calculator uses a scoped view of the same state, retaining only the mandate's source facts. Its operation key, exact input/authority binding and bounded settlement persist atomically with the saved receipt in `receipt.jobOperation`. Existing receipt-review operations persist their exact observation in the private answer journal. Readback uses these records and current receipt authorization; it never recalculates. A miss is unknown while the same in-process local calculation remains in flight. Aborted or over-duration calculations cannot save an invalid settlement. A verified receipt replay charges no duplicate cost.

After acquiring the vault's exclusive lock, workspace open/recover/restore calls runner recovery before scheduler dispatch. The scheduler dispatches each active owner's jobs under that owner's pinned context and releases another owner's output only as `{ id, status }`. Request/tick tracking prevents workspace replacement while a run is pending. `close()` refuses active work; `shutdown()` interrupts admitted work, drains requests and retains uncertain exposure for readback. Local HTTP close interrupts jobs while draining connections and closes their keepalive responses, with a bounded drain deadline. Readback has its own admitted-duration watchdog and abort signal. It cannot trigger a replay of the original dispatch.

## Verification evidence and remaining acceptance

`platform/tests/durable-jobs-engine.test.ts` uses explicitly labelled synthetic business data and host settings. It exercises public Engine/HTTP import → typed calculation → actual receipt → evidence review → exact action preview → owner acceptance; selected-source isolation; scoped-owner tick privacy; source revocation; objective replacement and cancellation; receipt/operation atomic recovery across lock/reopen; serialized acceptance revocation; active-job admission; stalled readback; over-duration rollback; and request/HTTP shutdown with retained uncertainty.

Existing durable-runner, jobs, acceptance, worker and server suites are run with `node --test --test-concurrency=1` to bound laptop load. These checks prove the described local synthetic roundtrips, not overall release completion. Production database power-loss/restore, native background installation, live providers/model routes, final write-back targets, spending/resource policy and broader product acceptance remain separate qualification work. The blocked security audit remains unverified; this functional integration does not replace it.
