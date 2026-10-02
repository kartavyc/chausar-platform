# Custom-field comparison and scenario regression handoff

Base: `87c400870563b92803841d3a198cee801f7740df`.

This lane repairs custom money-field evidence for comparison and price scenarios and adds deterministic coverage through actual publication, import, reviewed planner inputs and in-process public Engine requests. The calculator now serializes the published earned field and exact money amount; the real SQL projection admits that binding for these two registered operations. Native PostgreSQL/DuckDB qualification remains outstanding. Injected SQL responses and synthetic receipts do not establish production readiness.

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
- Explicit null exclusion retains partial coverage, an exclusion and a missing-amount gap; it never treats a missing fee as zero. Signed assumptions and money values beyond JavaScript Number precision retain exact integer truncation. Ambiguous, untyped or unitless mapping bindings refuse atomically through public preview and import.
- Revoking selected-source access invalidates pending review with `PREVIEW_STALE`. Retained refusal readback returns `CONVERSATION_NOT_FOUND`, and history omits it, including after reopening the synthetic workspace.
- Reimporting identical source bytes with `feeMinor` rebound to `feeAlternative` changes the actual recipe revision and fact versions. Pending review becomes `PREVIEW_STALE`; old retained readback becomes unavailable. Fresh review at the later cut uses baseline `32002`, scenario `33602` and change `1600`, without silently rebasing the old cut.
- Republishing the definition invalidates pending review with `BUSINESS_CONTEXT_STALE` before provider execution.

The public fixture uses a temporary synthetic file workspace, an injected authored provider response and no HTTP server. Its default verifier captures the receipt and throws the fixture-only `SYNTHETIC_SQL_BOUNDARY` before SQL verification. With `project: true`, the fixture instead invokes the actual `DatabaseCalculator.verify` projection and then reaches a refusing injected connection factory. This distinguishes correct custom-field projection from withheld SQL execution; the factory does not open a database.

Captured receipts in those refusal fixtures are transient diagnostics. They establish independent local exact arithmetic, selected-source lineage and unchanged facts. The public answer retains only a typed tool error; no receipt or saved numeric question is admitted, including after reopen. `receipts.get` returns `RECEIPT_NOT_FOUND` for a diagnostic receipt ID.

Separate injected SQL tests exercise the actual registered prepared statements through a recorder with independently authored result rows and an `injected-sql` proof label. These are source-level SQL compilation and adapter checks, not a database execution or native proof. They verify the projected exact custom amounts and the existing prepared-query boundary; no field name becomes dynamic SQL and no new price, volume or causal semantics are introduced.

The public retained-receipt tests also use that real prepared-statement path with independently authored SQL result literals. Those fixtures admit synthetic receipts labeled `injected-sql`, check the exact fee row amounts and measure markers, and read the receipts back after reopening the synthetic workspace. Saved scenario inputs retain the reviewed `"00500"` text. This is admission under an explicitly injected source-contract verifier, distinct from the withheld-SQL diagnostic fixtures above and from native database qualification.

## Verification commands

Observed on this isolated lane: **27/27 definition, public-contract and unchanged provenance-gate tests passed**, plus **92/92 source SQL tests passed**, all with zero skips. Existing TypeScript 5.9.3 `tsc --noEmit` passed with zero diagnostics. Both original provenance gates are green with their file and assertions unchanged. These results qualify synthetic source/public contracts and SQL compilation; every successful SQL test proof is explicitly `injected-sql`.

Run the focused deterministic contract suite from the checkout:

```powershell
node --test platform/tests/comparison-scenario-custom-definitions.test.ts platform/tests/comparison-scenario-custom-fields.test.ts platform/tests/comparison-scenario-custom-sql.test.ts
```

Run the explicit coordinator provenance gate separately:

```powershell
node --test platform/tests/fixtures/comparison-scenario-custom-provenance.acceptance.ts
```

The provenance gate is intentionally outside the ordinary `platform/tests/*.test.ts` suite. Its file and assertions are unchanged: it failed at the initial base because compound receipt rows omitted `measureField: "feeMinor"` and serialized the unrelated raw amount. The corrected receipt serialization makes those same assertions pass in the observed run. The fixture still withholds SQL through `SYNTHETIC_SQL_BOUNDARY`, and the gate admits no diagnostic receipt. A green provenance gate qualifies row evidence, not native SQL or production custom-field acceptance. The integration evidence records those observed green results alongside the source SQL checks.

## Bounded implementation and later qualification

`platform/runtime/calculator.ts` now uses the one published earned definition's field when constructing comparison/scenario receipt rows. A custom field is serialized as both the exact `amountMinor` value and its required `measureField` marker. Existing `amountMinor` receipt shape remains compatible, including legacy rows without that marker. This repairs provenance without changing arithmetic or mutating source facts.

`platform/runtime/analytics.ts` accepts a custom field only for registered `change` and `scenario` operations carrying exactly one `earned` definition. The projection validates the published definition and dictionary pins and requires each custom row to name that exact field. Existing checks retain exact integer amounts, distinct complete lineage, currency, periods and signs. The prepared queries already sum a canonical projected money column, so this fix needs neither generated field-name SQL nor new operation semantics. Other uncompiled operations retain their existing custom-field refusal, and malformed or inconsistent custom bindings still refuse before connection acquisition. Engine, Gateway and Vault contracts are unchanged.

Task15 must qualify these custom mappings against real PostgreSQL and DuckDB, with independently expected figures and receipt-row values for both operations. Qualification must include null/missing and ambiguous definitions, revised mappings, access revocation, stale cuts and unsupported projections. The injected SQL tests establish source contracts only. This lane provides no live model, HTTP-server, native database, GUI or enterprise production qualification and adds no dependency acquisition.

The pinned checkout has no `.agents` directory. The plan's [preview/scenario contract](../specs/CHAUSAR-FINAL-IN-DEPTH-PLAN.md#75-previews-scenarios-and-recovery) and analytical-app requirements require pinned assumptions, current-access readback and explicit separation of retained evidence from later recomputation; these regressions preserve those boundaries.
