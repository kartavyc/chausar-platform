# Shared connector framework

The entry point is `platform/runtime/connector-framework/index.ts`. This change adds a vendor-neutral framework and deterministic synthetic qualification. It installs no external write provider, chooses no products, and does not change the baseline fifty-entry catalogue. The parent owns the approved 56-group catalogue, adapter families, the corpus/licensing and semantic mapping gate, engine integration, and normalized database storage.

## Operation and evidence interface

`ConnectorOperationScope` binds connector ID/version, exact operation ID/kind, transport, and application version, edition, module, configuration, deployment profile and optional region. Read, export, guided export, import and write are independent operations. `ConnectorCapabilityRegistry` starts empty. Registration alone never means support.

`ConnectorOperationRegistration` names implemented capabilities, evidence IDs and limitations. `ConnectorEvidence` names the exact scope, assertions, observation/expiry times, artifact SHA-256 and provenance. Synthetic, sandbox and live assertions cannot be combined to manufacture a stronger level. External evidence requires an injected trusted attestation of artifact custody and independent review. Expired, revoked, future and mismatched evidence fails closed. `implementationDigest` can pin a concrete implementation/profile; `assertDefinition` requires that pin and matching evidence. The write adapter requires it.

`assertCanUse(scope, at, minimum)` defaults to synthetic tests. External execution must explicitly request its actual sandbox or live level. `assertCapability` checks the exact declared capability. Qualification includes definition/evidence digests for approval binding and read provenance; catalogues and constructor inputs cannot mutate registry state.

## Bounded acquisition interface

`ConnectorReadDispatcher.read(request, adapter)` accepts explicitly injected API, file export or guided export readers. It has no default endpoint or network adapter. Readers declare no side effects, retry ownership, required auth scopes, paging and retry safety. Engine-supplied authorization binds workspace/source/company/organization, permission revision, scopes, credential reference and expiry. Tokens and source-provided instructions do not enter receipts.

Authentication, current qualification, resource limits and cancellation are checked before and after every attempt and backoff. Broker and transport waits have bounded deadlines. Defaults make one attempt. Only an explicitly qualified idempotent read with a closed transient-failure classification may retry. Provider Retry-After floors are honored within hard budgets; an unacknowledged timed-out request is not resubmitted. Adapter/SDK internal retries must be disabled, and adapters must report failed-response bytes for aggregate byte accounting.

Pages retain original bytes, SHA-256, source observation/report/snapshot evidence, exact domain hash, schema fingerprint and opaque continuation. A terminal page establishes pagination termination, not whole-company completeness. Unknown totals, unknown source time and unverified snapshots remain explicit. Schema changes are delivered as evidence for import quarantine. Redirect and endpoint qualification remain each adapter's obligation; the framework never follows source-provided URLs.

## Read-to-import custody

`ConnectorReadImportBridge` pins independent read/import operations, workspace/source/company, dataset/branches/period, decoder descriptor, identity namespace and permitted content types. Its trusted dispatcher verifies an in-process issuance seal; forged or deserialized DTOs and changed bytes are refused. The bridge preserves every UTF-8 byte, SHA-256 and continuation, and writes a typed provenance link before capturing pages. It does not infer mappings, source totals or fact publication.

Serialized or cross-process read results need a parent-owned persisted custody verifier; there is no implicit JSON trust fallback. Binary and other encodings require separately qualified decoder routes.

## Cursor import interface

`QualifiedDecoder` is trusted engine code with pinned ID/version/schema, immutable revision namespace, revision and resource identity fields, business/delivery fields and correction ordering. Source content cannot select code, expressions or SQL. Every decoded business quantity remains exact text. A monotonic correction profile additionally requires independently qualified `corrections` capability; unqualified changes and late older revisions quarantine rather than overwrite current facts.

`CursorImportService` offers `reviewMapping`, `open`, `capturePage`, `takeOwnership`, `publish`, `get` and `assertReady`. Owner review binds the exact recipe, company/branches, schema, decoder and source-report evidence. Review refuses source-tainted and phone approvals, zero-fill policies, and permissive unknown-column handling. Async methods snapshot caller inputs before queued transactions. Current workspace/source/branch access, reviewer epoch, ontology, qualification, decoder and generation fence are rechecked.

Raw evidence and captured frontier commit atomically in the existing `StateStore.update`; parsed, validated and published frontiers stay separate. Explicit terminal evidence and a valid page chain are required. A crash before commit leaves a replayable cursor. Equivalent immutable revisions contribute once, including harmless delivery/formatting changes. Conflicting revisions, intra-page contradictions, schema drift, decoder changes, false terminals and cursor loops never silently publish. Conflicts invalidate prior affected captures and saved receipts, including overlapping acquisition scopes. A source ID is durably scoped to one company/dataset/revision namespace so other companies cannot become corrections to its facts.

`reconcileSourceTotals` binds an independently reviewed report, SHA-256, exact domain, company/dataset, currency, row count, amount, observation time and snapshot ID. Source and canonical totals stay separate: typed source reconciliation occurs before typed FX conversion. Missing totals or missing source money are unavailable, never observed zero. A qualified complete empty scope is separate from missing acquisition. Successful publication inserts facts and its frontier in one transaction, retaining source/recipe/capture lineage for the existing deterministic calculator.

Captures and mapping reviews use discriminated records in existing `State.imports`; no shared State or database schema is changed. Native relational tables/indexes, retention/replay horizons and durable source-provider quota coordination belong to the parent database/jobs lanes. The framework exposes unresolved quarantine with owned reason codes; semantic repair, accepted exclusions and conflict-resolution policy must be integrated with the parent gate before live support is claimed.

**Required consumer boundary:** call `assertReady` for the selected source domain before certifying query/readiness or deletion completeness. It blocks unresolved overlapping conflicts and, by default, unverified snapshot consistency. Existing `engine.ts` and `calculator.ts` are untouched; importing the framework does not install this consumer guard automatically. A matched operator-supplied source report is reviewed evidence, not a verified upstream signature or hidden-company qualification.

## Write boundary

`QualifiedSyntheticWriteService` adapts the existing `ActionService` with no provider installed by default. Only an explicitly injected synthetic provider is executable; non-synthetic providers are rejected. Exact prepare/approve/do/readback/reconcile phase evidence, implementation/schema/mapping digest, source/account/endpoint and independent source read/write grants are required. Stable business intent identity survives refresh; refresh is limited to unattempted intentions and invalidates approval.

Preparation binds original source evidence, expected state, exact source-native command, version precondition, preserved fields, postconditions and validity window. Source acceptance or a pending asynchronous job does not establish business success. One durable attempt is reserved before `do`; conflicting, lagging, foreign or inconclusive observations remain unknown. Readback must prove final correlated effect and preserved fields. Unknown outcomes are reconciled by reads and never trigger another automatic write. New dispatch remains bound to the original evidence; read-only recovery may use renewed currently qualified evidence/grants. Account-specific services cannot list or cancel another source account's actions.

Interrupted-attempt recovery stays at the existing exclusively locked, single-engine startup boundary. No per-adapter service may reset another active attempt.

## Semantic qualification handoff

`SOURCE_PROFILE_NOTICES` carries the parent-provided Razorpay paid/refund, Shopify draft/return/cash-status, AIS/26AS overlap, Tally versioned wire format, coherent Zoho company and unresolved PhonePe Pulse licensing constraints. Notices are review constraints, not adapters or qualification evidence. The PhonePe collection/reuse hold remains in place. The parent semantic lane owns corpus rights, mapping-pack golden/holdout cases and the actual semantic gate.

Synthetic contract tests exercise draft exclusion, positive refund deduction exactly once, unsettled/failed cash distinctions, version isolation, duplicate equivalence and missing-value abstention. They do not qualify real vendor data or real accounts.

## Verification and specification custody

Run the five new contract files together with `connectors.test.ts`, `business-engine.test.ts` and `workflows-actions.test.ts`, then `node scripts/check.mjs`. This checks the new end-to-end read -> capture -> reviewed mapping -> independent totals -> typed calculator receipt, plus existing import/action behavior. No real API calls or writes are made.

Final local run: **139 tests passed, zero failed/cancelled/skipped** (91 new contracts and 48 existing regressions); syntax and JSON validation passed for 67 source files. The consuming workspace retains `connector-contracts.tap` outside the repository. Direct installed npm CLI invocation reached `typecheck`, but `tsc` is unavailable. No successful strict typecheck, real-account qualification, hidden-business qualification or cross-platform release acceptance is claimed.

Parent integration must choose the quarantine disposition rules: corrected source/decoder/mapping plus qualified replay, or an explicitly reviewed exclusion that retains the affected coverage gap. This branch does not pick a conflicting winner, erase unresolved evidence, or certify that acknowledging a ticket repairs a source. Consumer freshness policy, provider quota scope and replay retention must be supplied by the owning engine/jobs/database lanes for each real profile.

The exact Library IDs resolved through the current Library skill to:

- `libfile_7d0650e81b608191bdbc0ca48b08ee03`: `CHAUSAR-LIVE-QUESTLOG.html`, 1,018,566 reported bytes.
- `libfile_ccfe1d9fee9c8191aa54de1e93e9549f`: `CHAUSAR-ARCHITECTURE.md`, 37,196 reported bytes.
- `libfile_db67faa278948191adeb352f06c2f714`: `CHAUSAR-LIVE-BUILD-PLAN.md`, 251,530 reported bytes.

Library read supplied their text. The consuming executor requested materialization and retrieved the current helper unchanged, but could not execute it because Python is unavailable. No raw transfer, alternate downloader or network/browser-policy bypass was attempted. Fresh attachment readable-byte verification and equivalence to the repo's archived specs remain unfulfilled. Local requirements inspection used the actual code and archived specs, including final-plan acquisition contracts 21.1–21.17. Strict TypeScript checking also needs the absent local TypeScript dependencies; Node runtime tests and syntax checks are not a substitute for that check.
