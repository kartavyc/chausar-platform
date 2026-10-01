# Private definition, recipe and precedence trials: integration contract

Lane1 source base: `6ead4d1b5ad81eb2c828cfc7bbd0648de3f22754`, tree `1a7847e28cc4ea4706cb53cb6a92e9918505a088`.
Authority: `LIVE-D03-B10/X08`, `GAP-REF-11`, `FIP-03-07`, `FIP-20-06/07`.

This lane supplies the isolated evaluator, typed contracts and deterministic synthetic acceptance. It does not change Engine, Vault, shared IPC/preload/types, manifests or publication. Its qualification is `isolated-source-replay`; joined product acceptance remains open.

## Implemented behavior

`PrivateTrialService` accepts one existing definition replacement, one named mapping recipe replacement, or one ordered source-precedence replacement. The host-only fork binds the exact live authority, baseline/candidate dictionary versions and hashes, facts/imports/rules/identity digests, retained recipe generations and original saved calculation requests. It contains no installed action, job, plugin, route, model receipt, conversation or schedule history. Original trust policy is preserved for source-capture authority checks; execution has no model, transport, action or database/native verifier port.

Choose 1–32 saved calculation answers. Their original receipts must currently be accessible, nonstale and linked to the same operation, explicit knowledge cut, period, comparison period, branch and requested source scope. Aging requires a saved explicit `onDate`; scenario assumptions must match the original receipt. Refresh stale saved questions before creating a fork. No natural-language re-resolution or silent request rewrite occurs.

Both sides run the existing `CalculatorService` with the identical saved request, view-specific consumer and receipt guards, and current live access checks around every awaited calculation. Guard/authentication failures abort the operation; calculator refusals are recorded as refusals and cannot authorize promotion. All full receipts are retained. JSON Pointer differences distinguish absence from null and cover every changed property; only `/id` and `/createdAt` are tagged as incidental receipt identity. Exact integer totals and figure deltas use `BigInt`.

The candidate is explicitly a **restated private diagnostic**. Definitions reinterpret the retained facts; source precedence applies the hypothetical ordered rule from the earliest saved knowledge cut; remapping retains each claim's original learned time. Original receipts and live evidence are untouched. This label must remain visible alongside historical requests; candidate results are not claims that the changed meaning was operationally published at those past times.

Recipe trials require the exact retained original content, parser, recipe, control totals, import IDs, generation identity and row lineage. Every source import/fact generation must be represented and complete. Retained historical input recipes may differ from the current baseline recipe while retaining the same recipe identity, installation and scope. Preview must reproduce each original semantic claim. Deduplicated reexports may reorder source rows; occurrence order is checked against that capture's row IDs, while the stored claim's original `sourceRow` remains its receipt provenance. Candidate preview must reconcile the unchanged original controls. It replaces only that source's interpretations in the isolated copy; other producers remain unchanged. It does not call append-only `ImportService.commit`.

## Required trusted host ports

Construct the service with a read-only live state port and `PrivateTrialHost`. None of these ports or fork artifacts may be supplied by an RPC caller.

| Port | Required host behavior |
| --- | --- |
| `now()` | Supply the actual host time for candidate compilation. Test fixtures use a labelled fixed clock. |
| `resolveRecipeEvidence(ctx, sourceId)` | Resolve authenticated retained bytes/recipes/controls and complete producer history under current permission. Refuse missing inputs instead of inferring a recipe from a hash. |
| `resolveTrial(ctx, id)` | Resolve the member/epoch/workspace-owned fork and retained evaluation from managed custody. Discarded artifacts must cease to resolve. |
| `assertArtifactAuthentic(ctx, kind, digest)` | Verify an immutable service-issued artifact identity using authenticated custody and an independently retained/sealed issuance binding. Recomputing the presented JSON hash is insufficient; altered arithmetic with recomputed hashes must refuse. Complete synchronously. |
| `calculatorGuards(view, { phase, side, change })` | Supply synchronous `consumerGuard` and `receiptGuard` for each actual view. Check current real acquisition/semantic readiness; do not reuse live qualification for a changed dictionary/recipe. Missing or asynchronous guards refuse. No extra verifier port is accepted by this source evaluator. |
| `resolvePromotionImpact(ctx, fork, evaluation, strategy)` | Enumerate the complete affected artifact, rebuild and active-work inventory. Refuse incomplete dependency discovery. |

Engine currently supplies view-specific connector guards through `connectorForView`; this is the existing seam, not an implemented Engine join. Managed connector captures bind the full ontology digest and actual semantic proof. A candidate with new meaning therefore needs fresh real evidence or must refuse. Synthetic guard fixtures do not qualify a managed candidate or bypass its publication/review gates. Production database verification remains a separate joined gate; this evaluator's receipts carry no native/database proof.

## Host-owned lifecycle and publication

1. `create(ctx, request)` returns a host-only `PrivateTrialFork`. Persist it as an encrypted fork inside the workspace under its existing encryption/key hierarchy; register its immutable service-issued identity. Do not expose complete State snapshots over RPC.
2. `evaluate(ctx, trialId)` loads that authenticated fork and returns paired receipt evidence. Persist and seal the issued evaluation. `read(ctx, trialId)` rechecks current access, exact base, saved evidence, artifact identity and both sides' readiness before returning comparisons.
3. `promotionImpact(ctx, trialId, 'prospective' | 'retrospective')` returns the explicit restatement/dependency plan and its digest. Present it for review. It preserves original historical receipt IDs and lists affected saved questions even when only meaning changed and totals did not.
4. `proposePromotion(ctx, { trialId, evaluationDigest, strategy, acknowledgedImpactDigest })` requires owner/cofounder authority, the exact retained evaluation, no refused candidate results, complete acknowledged impact and no affected active work. It returns an inert proposal; it does not publish or authorize an ActionService action.
5. Inside the **same atomic live commit boundary**, construct the service against that commit-state read view and call `assertPromotionCurrent(ctx, proposal)` immediately before activation. Recheck actual current semantic readiness there. Another publication, changed access/evidence, changed dependency impact or mismatched issuance identity refuses. Do not turn this check into a prior non-atomic preflight.
6. The coordinator owns actual dictionary/recipe/rule activation, stale marking, dependencies/rebuilds and temporal producer replacement. Publish rules at real publication time; never copy the trial's hypothetical historical rule timestamp into live authority. If final dictionary compilation/publication metadata changes its reviewed hash, produce a new pinned candidate/evaluation and repeat acknowledgement. Do not silently adjust candidate pins.
7. For remapping, activate a complete producer-owned replacement relation with expected previous generation, including explicit justified empty output. Append/retract normal temporal versions, preserve other producers and permitted as-known history, and refuse failed/incomplete/racing replacements. Fork fact IDs represent isolated alternative interpretations, not new live assertion IDs. The root's replacement/publication code must provide the `2 → 1 → justified-empty` joined proof; these source tests do not certify live retraction.
8. Managed discard revokes custody resolution and issuance identities and deletes the encrypted fork/receipt artifacts. Measure encrypted on-disk bytes and create/discard elapsed time. The evaluator reports measured preparation/replay elapsed time and exact serialized bytes with `diskBytes: null`, so serialized bytes cannot be mistaken for disk proof.

Saving trial/evaluation output history or incrementing State.revision does not stale its own base. The pinned authority includes schema/workspace/member/policy/dictionary/fact/import/rule/merge/tombstone state. Chosen saved answer requests and original receipts are additionally pinned separately. Rebase means a new fork ID, new candidate, new replay and new impact acknowledgement; the old proposal cannot authorize it.

## Source acceptance and remaining gates

Run `node --test platform/tests/private-trials.test.ts` and `node node_modules/typescript/bin/tsc --noEmit` using the already available Node/compiler dependencies. The synthetic fixtures use public calculator/compiler/import APIs and read-only live stores; no Vault, native database, GUI, model or external transport is invoked.

Evidence covers three identical saved questions, hand-worked amounts beyond JavaScript's safe integer range, definition and compiler differences, historical source precedence, recipe cancellations and source-total refusal, complete generation custody, current permissions/readiness, stale base, exact restatement acknowledgement, active work, immutable artifact origin and unchanged live state. Paired receipt files can support the plan's permitted partial-screen evidence.

Open coordinator gates: encrypted same-key fork custody, real disk and discard measurements, atomic activation and temporal owned-output replacement, Engine/IPC/renderer joins, production verifier/semantic qualification, user-visible side-by-side/discard journey, cross-platform/native acceptance and shared/team trials. Dedicated security review remains blocked and unverified. This lane makes no release or full-plan completion claim.
