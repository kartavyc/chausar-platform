# Enterprise deployment and boundaries

The desktop workspace and the enterprise service follow the same published-definition and evidence principles. Their current receipt and persistence types are separate implementations; no automatic schema/receipt compatibility or desktop-to-enterprise migration is claimed. The enterprise implementation under `enterprise/platform/` is a recovered service layer, including source queries through Cube, investigation coordination through Temporal, PostgreSQL authority, and a disclosure-controlled model gateway. Shared Python semantic-validation contracts live under `enterprise/architecture/contracts/`. Original evidence, runtime directories, credentials and fleet records were not copied into the product tree.

## Deployment components

| Component | Authority |
|---|---|
| Core API | Authenticated principal, tenant, current scope, persisted results |
| PostgreSQL authority store | Grants, mandate owners, policy epochs, definitions, investigations and outbox |
| Source reader | Read-only access to specifically registered source tables |
| Cube | Scoped aggregation against registered source queries; no authority-store privileges |
| Temporal | Durable workflow state and waiting; core rechecks actual authority on execution |
| Model gateway | Disclosure permission, endpoint and exact payload, bounded dispatch, protected receipt |
| Python validator | Semantic-profile validation before immutable publication |

The core and source reader require distinct database roles. The core application's role must not directly read source tables; the Cube source role must not read the authority store. Worker credentials identify a service, then the core resolves the investigation's current human/company authority. A workflow wakeup signal never grants permission.

## Configuration

Use fresh deployment credentials, an owned database and explicitly configured endpoints. Integration fixture tokens are unsuitable for customer authentication. Configure `CHAUSAR_CORE_URL`, `CHAUSAR_INTERNAL_SERVICE_TOKEN`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` and `TEMPORAL_TASK_QUEUE` for the worker. The connected test runner additionally requires `CHAUSAR_TEST_DATABASE_DISPOSABLE=1`, a dedicated `CHAUSAR_TEST_DATABASE_URL` ending in `/chausar_test`, `CHAUSAR_PYTHON`, and `CHAUSAR_TEMPORAL_CLI`.

The recovered manifest records Node 24.13.1, PostgreSQL 16.14, Cube 1.7.29, Temporal TypeScript SDK 1.13.2 and TypeScript 5.9.3. Installed package types and pinned lockfiles are the implementation's API reference. Native TypeScript stripping is execution, not typechecking.

## Verified profile and remaining qualification

The recovered service profile supports gross invoice INR, shipped quantity and refund INR over registered source tables and permitted regions. It pins the published ontology revision and authority ceiling. A personal natural-language question first passes through a strict gateway plan; unsupported, ambiguous or excessive scope is refused or clarified. Synthetic model endpoints test transport and enforcement, not language quality.

The original source snapshot reported 33 synthetic connected acceptance checks. Those reports predate the present build. They do not establish that this checkout has replayed PostgreSQL, Cube, Temporal or a real model. Reproduction must create an empty disposable database, execute the present runner, and retain new results with hashes of the present files.

## Verifier and source map

| Boundary | Present source / verifier | Current execution claim |
|---|---|---|
| Enterprise bootstrap | `enterprise/platform/scripts/run-connected.ts` | Source retained; dependency/service execution not replayed. The runner requires explicit disposable configuration and a fresh `chausar_test` database before schema setup. |
| Authority, scoped reads and durable investigation | `src/core.ts`, `src/authority.ts`, `src/activities.ts`, `src/workflows.ts`, `src/dispatcher.ts`; `scripts/verify-connected.ts` | Relative to `enterprise/platform/`. Current syntax/reference checks passed; prior connected outcomes remain historical. |
| PostgreSQL authority/source separation | `storage/schema.sql`, `storage/seed.sql`, `src/shared.ts` and runner-created separate roles | Current service test unavailable without a new disposable database. Schema presence is not database execution or production authorization qualification. |
| Cube analytical projection | `src/cube.ts`, `src/ontology.ts` | Current source checked; Cube packages/server/source database not run in this build. |
| Gateway and natural-language plans | `src/model-gateway.ts`, `src/natural-investigation.ts`, `src/planning.ts`; `scripts/model-fixture.ts`, `scripts/verify-model-connected.ts` | Strict plan/disclosure source retained. Historical loopback fixtures did not certify real-provider language quality. This composition has not been replayed here. |
| Semantic publication | `src/publication.ts`, `analytics/validate_definition.py`; `enterprise/architecture/contracts/business.py`, `test_business.py` | Publication imports resolve to the copied contract directory. Python contract tests are separate from a connected published database revision. |
| Desktop PostgreSQL profile | `platform/runtime/postgres.ts`; `scripts/verify-postgres.mjs` at repository root | The current configuration guard refused absent disposable setup and executed zero database checks. This is not an enterprise runner result. |
| Fresh evidence | Runner generates local `evidence/` only when executed | No historical evidence JSON/log/workflow/database file is included. New evidence must identify the current file hashes and environment; generated credentials/artifacts stay ignored. |

All eighteen recovered TypeScript source/runner files passed `node --check`, and their relative TypeScript imports resolve. This is a syntax/reference check, not strict typechecking or execution of imported SDKs. The root desktop checks and acceptance tests do not load or certify this enterprise service.

From `enterprise/platform/`, install its pinned dependencies in a separate environment, then run `npm run typecheck`. To replay the integration, explicitly provision a disposable loopback PostgreSQL service and the Python/Temporal dependencies, set the variables listed above, and run `npm run verify:connected`. The runner refuses an existing `chausar_core` or `chausar_source` schema, creates random temporary test credentials, starts local Cube/core/Temporal/model-fixture services, and attempts cleanup. Its simulated HTTP model still tests the boundary rather than provider quality. Never point this runner at customer infrastructure.

Before customer deployment, qualify company sign-in and provisioning, supported policy mutations, credential rotation, worker crash recovery, workflow upgrades, network containment, provider retention, lifecycle deletion and backup propagation, concurrent workloads, operational dispatch and monitoring, and customer-specific connector reconciliation. Do not call an undeployed server or a connector catalog a working integration.

## Customer recipe acceptance

An SAP, Oracle or other enterprise connector must retain source provenance, stable event identity, event and learned-on clocks, explicit units/currency, reconciliation totals, source precedence, scope enforcement and deletion behavior. The customer approves its semantic recipe and source precedence before publication. A new connector inherits no write capability from read access; every allowed write needs a registered prepare/approve/do/readback/settle adapter with idempotency and unknown-outcome recovery.

## Restore procedure

1. Restore the authority database and source data to isolated services while public ingress and dispatch remain stopped.
2. Restore encryption keys and model-receipt keys through the deployment's secret custody process.
3. Verify ontology/source revisions, deletion tombstones, policy epochs, grants and active owners before opening reads.
4. Resume Temporal against the restored authority state. Recheck unfinished actions against each external target before retrying.
5. Execute the deployment acceptance suite, record the restored revision and only then enable normal operation.

A file backup demonstrates local state recovery. It does not certify PostgreSQL point-in-time recovery, workflow-history compatibility or external-target reconciliation.
