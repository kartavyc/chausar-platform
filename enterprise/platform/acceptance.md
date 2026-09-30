# Connected platform acceptance

This suite targets the first connected implementation layer of the full Chausar product. It does not redefine the destination as a prototype or a single workflow.

`scripts/verify-connected.ts` exports a callback-driven verifier. The orchestration runner starts and configures the actual API, PostgreSQL, Cube and Temporal services, supplies synthetic authentication tokens, and binds workflow start/query/signal callbacks. The verifier does not start services, use research dependency directories or install packages.

This is a recovered acceptance specification. Its earlier execution reports are deliberately not included in this checkout, and no current connected pass is implied. The current qualification and verifier map are in [enterprise deployment](../../docs/enterprise.md).

## Evidence required

1. Fetch the published ontology through the public authenticated API.
2. Create a profitability investigation through that API, execute its durable workflow and retrieve the persisted result. Assert gross INR 24,700, shipment quantity 20 and refund INR 75, with evidence.
3. Deny the broad saved result to the regional viewer. A successful regional query must independently compute the permitted northern population, not post-filter a broad total.
4. Create work while its owner is valid, then remove the last mandate owner before flushing its durable dispatch outbox. Work must reach a durable owner-waiting state with no result. Assign a replacement, signal the workflow and verify continuation.
5. Revoke the leader's current source grant and deny release of the already saved result.
6. Submit the same creation request twice and require the same investigation ID. Complete the resulting durable workflow once.

The synthetic tenant is `demo`, with mandates `watch-profit` and `watch-north`. The northern result must be gross INR 300, shipment quantity 9 and refund INR 35. Both source scope and exact numerical results are checked. Evidence must match the published definition/revision and report the actual source revision and permitted regions.

These are connected-service acceptance cases. Their results must be reported separately from pure reference-contract tests, compiler-only probes and mock transports. Passing does not demonstrate production scaling, arbitrary-code containment, browser privacy, model quality or customer-specific connector correctness.

## Fixture boundaries

The runner supplies fixture mutations for the exact installed `chausar_core` schema. Every mutation must identify the synthetic tenant and exact principal/mandate/grant; do not use blanket deletes or modify external/customer databases. Capture and restore fixture values in `finally`. Revocation cleanup restores only the test fixture, not production policy history. The verifier's service principal credentials are never written to returned receipts.

The workflow callback is an integration seam for the real runner, not permission to replace Temporal with an in-memory simulation. Likewise the API and result endpoints must be actual HTTP calls and the numerical result must come from the configured Cube/PostgreSQL path. Root orchestration must account for durable-outbox dispatch so a workflow is not accidentally started twice under different IDs.

## Run status

The recovered source's earlier baseline reported this verifier and two additional publication/outbox checks, for ten named checks. The expanded runner also calls `scripts/verify-model-connected.ts`; current named outcomes and cleanup require a fresh local run. Both HTTP API formats use the pinned SDK against instrumented loopback fixtures. Accepted plans require actual PostgreSQL/Temporal/Cube execution. This separates synthetic model-output evidence from analytical-service behavior; neither is currently certified by this source copy.

Gateway acceptance includes exact captured-body HMAC binding, filtered catalog/no raw records, personal regional authority, both adapters, duplicate/concurrent request accounting, explicit clarification, forged metrics/regions/SQL rejection, independent disclosure/model-operation denial, caller URL rejection, revocation during the HTTP call, timeout uncertainty, no private-to-external fallback, redirect rejection, malformed/refused/truncated/oversized responses, plan population ceiling, changed-publication refusal, current artifact-policy checks, inherited expiry, content erasure and terminal source-revocation state. A final question checks all three supported calculations and their evidence.
