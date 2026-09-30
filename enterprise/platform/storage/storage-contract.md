# PostgreSQL authority and result storage contract

Recovered contract dated 11 September 2026. SQL integration foundation for the TypeScript platform and Python analytical workers. Earlier source reports described `schema.sql` and `seed.sql` against an isolated PostgreSQL database; this checkout has not replayed that execution. See the [current verifier map](../../../docs/enterprise.md). The SQL files contain no cluster roles, credentials or unqualified drops; the runner separately creates narrowly scoped local roles.

## Table contract

All tenant-bound foreign keys include `tenant_id`. The named schemas are `chausar_core` and `chausar_source`. A separate customer deployment is the production direction; the tenant discriminator also makes accidental cross-scope access testable in one synthetic installation. It does not by itself enforce authorization or replace deployment isolation.

- `tenants`: active switch and monotonically advanced `policy_epoch`.
- `principals`: human/service identity, active state, explicit capabilities and current revision. Authentication maps credentials to this server-owned identity outside these tables. Ontology publication requires the explicit publication capability.
- `policy_revisions`: immutable published policy bodies. `policies` selects current revision and activation.
- `datasets`: active state, source revision and permitted source field names.
- `grants`: exact principal/dataset/purpose binding, operations `read`, `release`, `retain`, `model`, explicit field/region lists, expiry, revocation, policy reference and grant revision. No wildcard or null scope semantics. The model operation additionally requires the independent disclosure policy below.
- `mandates`: company service principal, exact grant, state and revision. `mandate_owners` supports multiple accountable owners. At least one active membership with an active human principal is necessary for execution; the service enforces that condition.
- `ontology_revisions`: immutable published JSON bodies and hash metadata; `publications` selects a revision and mutable generation. Triggers reject ordinary UPDATE/DELETE of revision rows. Database owners/superusers can bypass controls and must not be the application role.
- `investigations`: exact principal/grant/purpose, optional mandate, state and revision. IDs are server-generated UUIDs; idempotent request keys retain the original ID and reject changed input. Never trust a caller ID as proof of those bindings.
- `tasks`: CAS revision, monotonic fencing token and lease. A running task requires a lease and positive fence.
- `retained_results`: one current result per task, exact ontology revision, task fence and authorization epoch, expiry and payload. Retirement sets payload NULL and records retirement time/reason. This is an integration shape, not the eventual full multi-result artifact system.
- `result_bindings`: input source revision and original grant/policy revision plus fields/regions. These are provenance, not perpetual authorization.
- `model_endpoint_revisions`: immutable endpoint/API/model/handling configuration with verified content hash, never credential values.
- `model_policy_revisions` and `model_policies`: immutable per-human disclosure/artifact rules and active revision pointer, separate from source grants and source retention policy.
- `model_invocations`: durable one-attempt receipt, protected request-key/content/payload digests, exact endpoint and authority identity, state and expiry. No prompt or raw model output is saved. Dispatch commit precedes HTTP, and uncertain attempts cannot implicitly replay.

Personal natural-language investigations add the accepted model invocation, pinned definition revision, explicit region ceiling, inherited expiry and sanitized failure reason. Results cannot outlive that plan. Current model-artifact policy is checked at execution and saved-result release. The explicit expiry sweep clears result payloads, plan selections and protected content digests while retaining a protected idempotency tombstone. See `../src/natural-investigation.ts` and the [current verifier map](../../../docs/enterprise.md).

The seed does not publish an unvalidated ontology. The runner invokes the Python validator and trusted publication service to create a revision with a canonical body digest before serving requests. The seed invoice fixture yields gross INR24700. The other tenant contains a conspicuous999999 amount to reveal scope leaks. The connected profile does not expose contribution calculations yet.

Expanded connected fixture includes orders, shipments and returns, with composite tenant keys. Invoice-to-order has no foreign key so missing-parent behavior is testable; child-to-invoice references are enforced. Logical `invoices` capability fields `shipment_quantity` and `refund` authorize server-curated child relations through the invoice scope. Query code must independently aggregate child arms and restrict each via the allowed invoices, not multiply a shipments-by-returns join. Fixture totals: broad gross24700/shipments20/refunds75; north300/9/35; south24400/11/40. Refunds here are INR-only synthetic values, not a general FX model.

`watch-profit` has owners `owner` and `leader`; removing just one must not suspend it. `watch-north` runs as `north-agent` under `north-mandate`, accountable to `north-leader`. Investigation idempotency uses unique `(tenant_id, requested_by, request_id)` plus `request_digest`; a reused key with different normalized request must fail. `metric_ids` records the requested published methods. `work_outbox` commits with the investigation; dispatcher updates attempts/dispatched_at. This is an at-least-once delivery handoff, not a claim that a DB commit and Temporal start are atomic.

## Transactional authorization protocol

Use parameterized, application-owned SQL templates only. The ontology body selects supported registered method names, never arbitrary SQL strings from a client/model. Resolve permitted fields and regions from current grants. Bind tenant and regions as values; field identifiers come from a strict server registry, not string interpolation of client text.

For source access, acquire the tenant row `FOR SHARE` first, then current principal, grant, policy, dataset and publication rows as required. Recheck active states, operation, exact purpose, expiry using current database time, field subsets and region scope. For a mandate, also check its exact principal/grant and active owner membership; never substitute creator, administrator or another convenient grant. Hold the authorization transaction until the protected read finishes. Do not use a stale cached authorization result as this check.

All authority-changing operations acquire the tenant row `FOR UPDATE` before modifying principals, grants, policy selection, dataset activation or owner membership, and increment `policy_epoch` in the same transaction. This conservative tenant-wide ordering serializes revocation against protected transactions and makes ownership removal safe even when checking an absence condition. Every writer must follow it; foreign keys do not enforce this protocol. A future higher-concurrency scheme must preserve the same tested ordering guarantees.

Do not hold this transaction during a long Temporal wait or model call. Release it after source read; reacquire current authority at artifact retention and result release. Database commit cannot atomically revoke bytes already sent over HTTP. Define release eligibility immediately before sending, record its epoch and stop later frames after observed revocation. Source reads and output release are distinct authorization events.

Current viewer access must cover each result binding's contributing fields/regions and required operation, using a currently valid grant for that viewer and purpose. The original producer grant is provenance, not a grant to a new viewer. For the integration, changed epochs conservatively require reauthorization or retirement rather than trusting earlier aggregate permissions. A single epoch mismatch need not permanently deny an unrelated result in the eventual product.

## Task claim, completion and retirement

Claim with an UPDATE bounded by tenant/task, expected revision and allowable state. Increment fence and revision, set running and a server-issued lease, and require RETURNING to produce exactly one row. Reclaim only after an expired lease; never reset a fencing token. Completion/retention checks tenant/task, expected revision, fence, running state and unexpired lease, with current authorization locks in the same transaction as the result insert and task state change. A stale attempt must affect zero rows and cannot persist a result under a newer worker's fence.

Owner loss moves a mandate to `suspended_owner`. Queued/running activities independently reject authority once no active human owner remains. Owner transfer adds an authorized active owner and removes prior membership within one authority transaction, rather than temporarily borrowing an unrelated principal. Temporal is the scheduling owner; task rows provide durable business state and a commit fence, not a second retry scheduler.

Retirement clears local payload atomically with the retired marker. No result release may return an expired or retired payload. Propagate deletion to caches/exports/evidence stores through the lifecycle implementation; this schema alone does not remove backups or other derived copies. Source revision changes must be accompanied by matching dataset revision updates in the same synthetic source transaction.

## Boundaries and acceptance still required

App/read roles are provisioned by the isolated bootstrap, not this schema. Earlier source reports described separate core and source-reader roles against PostgreSQL; this checkout has not replayed that execution. Composite keys are structural isolation, not row-level security. Historical selected connected checks do not certify this copy; exhaustive role-denial and concurrent transaction tests remain outstanding.

Acceptance inventory: cross-tenant fixture exclusion; wrong purpose/field/region denial; expired/revoked grant; disabled principal; active alternate owner preserved; last owner removed with no fallback; authority change concurrent with read/release; stale CAS/fence rejection; expired lease; immutable revision update rejected; source revision binding; retirement removing payload; duplicate result idempotency; exact ontology revision preserved through publication change. Every claimed pass requires a new runner-generated evidence record. This inventory is not a list of passed tests.

Full-product gaps remain explicit: generalized bitemporal assertions, graph/identity corrections, cross-dataset publications, multi-source disclosure routing, multiple analytical results per task, source-copy policy, rich action effects and operational retention/restore. This foundation connects the real authority/query/activity/model path; it does not claim the full ontology is implemented.
