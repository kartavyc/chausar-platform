# Custom-field comparison and scenario regression handoff

Base: `87c400870563b92803841d3a198cee801f7740df`.

This lane adds deterministic coverage of published custom money fields through actual publication, import, reviewed planner inputs and in-process public Engine requests. Custom-field comparison and scenario receipts remain **unadmitted**: the real SQL projection refuses them with `SQL_DEFINITION_UNSUPPORTED` before acquiring a connection. Passing these regression tests proves that refusal and the surrounding contracts, not production custom-field support.

## Fixture and independent amounts

The synthetic owner explicitly publishes ecommerce `earned.field = feeMinor`, with a meaning that identifies the imported fee column as the owner's exact minor-INR earned measure for delivered sale events. The field name alone does not establish that meaning. The recipe binds `feeMinor` to CSV `fee`, in minor INR with rejected nulls, while retaining a separate `amountMinor` binding and its reconciliation control.

| Selected source row | Date | `amountMinor` | `feeMinor` | Alternative mapping value |
| --- | --- | ---: | ---: | ---: |
| `current-start` | 2026-09-01 | 111 | 10001 | 11001 |
| `current-end` | 2026-09-30 | 222 | 20001 | 21001 |
| `prior` | 2026-08-01 | 333 | 30000 | 31000 |

The selected source is `synthetic-custom-earned`; another imported source contains a large unselected fee and must remain excluded. Raw-amount reconciliation is `666`, which does not validate fee arithmetic. September's fee baseline is `30002`; August's is `30000`. The comparison delta is `2` and integer-truncated change basis points are `0`. An accidental `amountMinor` fallback would instead compare `333` with `333` and produce zero delta.

The reviewed scenario assumption is the exact text `priceChangeBps: "00500"`. It applies the existing price-only, constant-volume scenario: `30002 * 10500 / 10000`, integer-truncated to `31502`, with change `1500`. The receipt's normalized basis-point amount is `500`. Review and provider-plan validation retain the original `"00500"`; replacing it with `"500"` is a changed input even though the numbers are equal. The scenario remains explicitly hypothetical, and the comparison makes no causal claim.

Both operations use branch `main`, September 1–30, and the pinned knowledge cut `2026-10-01T12:00:00.000Z`. The comparison's prior period is August 1–31. Calculations must leave imported facts unchanged.

## Contract checks

- Actual ontology publication retains valid custom money bindings. Missing or non-money fields, currency mismatches and duplicate earned definitions refuse atomically; reserved generated-name collisions also refuse. A dictionary without `earned` may publish but exposes neither comparison nor price-scenario capability. A compiled custom single sum does not establish compound-operation SQL support.
- Operation-specific schemas and plan validation allow only exact reviewed periods and price basis-point text. Model-supplied field selectors, totals, formulas, additional scenario drivers and unreviewed source selectors refuse. Missing comparison/scenario inputs require clarification rather than inferred defaults.
- Public `models.preview` and `models.approve` bind the exact request. Changed owner inputs refuse with `PREVIEW_REQUEST_CHANGED` before provider dispatch; changed authored plan inputs refuse with `INVALID_CONVERSATION_PLAN`. An approval is consumed once. Shape disclosure includes the published field but excludes custom row values.
- A mapped missing fee uses the explicit null-omission fixture and refuses calculation with `MISSING_MEASURE_VALUE`, without falling back to raw amounts or zero and without reaching SQL verification.
- Revoking selected-source access invalidates pending review with `PREVIEW_STALE`. Retained refusal readback returns `CONVERSATION_NOT_FOUND`, and history omits it, including after reopening the synthetic workspace.
- Reimporting identical source bytes with `feeMinor` rebound to `feeAlternative` changes the actual recipe revision and fact versions. Pending review becomes `PREVIEW_STALE`; old retained readback becomes unavailable. Fresh review at the later cut uses baseline `32002`, scenario `33602` and change `1600`, without silently rebasing the old cut.
- Republishing the definition invalidates pending review with `BUSINESS_CONTEXT_STALE` before provider execution.

The public fixture uses a temporary synthetic file workspace, an injected authored provider response and no HTTP server. It attaches the actual `DatabaseCalculator.verify` projection to the calculator. Its injected connection factory throws if acquired; rejection must occur first. The PostgreSQL adapter is tested through `PostgresDatabaseCalculator.fromPool` with an equally inaccessible injected pool. No native SQL execution is simulated as a successful result.

Captured receipts are transient diagnostic inputs to the refusing verifier. They establish independent local exact arithmetic, selected-source lineage and unchanged facts. The public answer retains only a typed tool error; no receipt or saved numeric question is admitted, including after reopen. `receipts.get` returns `RECEIPT_NOT_FOUND` for a diagnostic receipt ID.

## Verification commands

Observed at the pinned base plus this lane: **23/23 focused tests passed, zero skips**. The separate provenance gate reports **0/2 passed, two failures** on the omitted `feeMinor` field binding. Null exclusion also retains partial coverage, and signed/large-integer scenarios preserve exact truncation beyond JavaScript Number precision. These results qualify synthetic in-process contracts and guarded refusal only.

Run the focused deterministic contract suite from the checkout:

```powershell
node --test platform/tests/comparison-scenario-custom-definitions.test.ts platform/tests/comparison-scenario-custom-fields.test.ts
```

Run the explicit coordinator provenance gate separately:

```powershell
node --test platform/tests/fixtures/comparison-scenario-custom-provenance.acceptance.ts
```

The provenance gate is intentionally outside the ordinary `platform/tests/*.test.ts` suite. At the pinned base it is expected to fail for both operations because compound receipt rows omit `measureField: "feeMinor"` and serialize the unrelated raw amount. It continues through the guarded public path and never bypasses SQL refusal or admits a diagnostic receipt. A green contract suite alongside this red gate is not custom-field production acceptance.

## Required coordinator join and later qualification

`platform/runtime/calculator.ts` computes the definition-specific money field, but compound receipt construction currently uses `compiledSum?.moneyField ?? "amountMinor"`. Comparison and scenario do not have a compiled single-sum binding, so row evidence loses the published custom field and amount. The coordinator must preserve the selected published measure field and its exact money value in compound receipt rows.

`platform/runtime/analytics.ts` deliberately accepts only `amountMinor` for uncompiled compound definitions. The coordinator must join verified custom compound-field projection support with corrected receipt evidence, retaining validation of definition/row bindings, exact amounts, lineage, currency, periods, signs, authorization and cut. Removing the guard alone would admit inconsistent evidence. This lane changes no shared Calculator, Gateway, Engine, Vault or SQL projection contracts.

After that join, task15 must qualify these custom mappings against real PostgreSQL and DuckDB, with independently expected figures and receipt-row values for both operations. Qualification must include null/missing and ambiguous definitions, revised mappings, access revocation, stale cuts and unsupported projections. The current injected-pool checks prove refusal before acquisition only. This lane provides no live model, HTTP-server, native database, GUI or enterprise production qualification and adds no dependency acquisition.

The pinned checkout has no `.agents` directory. The plan's [preview/scenario contract](../specs/CHAUSAR-FINAL-IN-DEPTH-PLAN.md#75-previews-scenarios-and-recovery) and analytical-app requirements require pinned assumptions, current-access readback and explicit separation of retained evidence from later recomputation; these regressions preserve those boundaries.
