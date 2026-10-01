# Declared descriptive change bridge

This bounded operation implements the descriptive clause of final plan §22.23,
`C02-R1-009` ([requirement](specs/CHAUSAR-FINAL-IN-DEPTH-PLAN.md#L2311)). It
explains the difference between two exact private money receipts under an
explicit owner-published factor convention. Its results are descriptive and
`declared-experimental`; they do not establish causal effects, intervention
benefits, source/vendor qualification or executable action recommendations.

The kernel and service are independent new modules. Integration supplies
`analysis.bridge.publish`, `analysis.bridge.profiles`, `analysis.bridge.run`
and `analysis.bridge.get`; this document describes their service contracts,
not native GUI acceptance.

## Publication and population contract

An untainted desktop app administrator publishes:

```ts
{
  id: 'reviewed-product-convention',
  expectedRevision: 0, // A new profile publishes revision 1.
  definition: {
    label: 'Explicit owner product convention',
    dictionaryHash,
    operationId,
    moneyDefinitionHash, // hash of the exact published Definition
    quantityField, quantityMeaning, quantityScale,
    identityFields, identityMeaning,
    grain: 'one-fact-per-product-period',
    unitField, unit, unitMeaning,
    factorRule: 'realized-average-net-amount-per-unit',
    method: 'separate-interaction',
    rounding: 'truncate-toward-zero-minor',
    incompleteCoverage: 'partial', // Or explicitly 'refuse'.
    scope: { branch, sourceIds }
  }
}
```

Every field is required. Subsequent publication supplies the exact current
`expectedRevision` and creates the next immutable revision. Publication alone
does not admit a managed source's factor semantics. Quantity and unit meanings
must be written explicitly; generic field names or schemas do not establish
them. Quantity binds a published integer field whose raw value is encoded at
the declared scale, from zero through six. For scale two, raw integer `125`
means quantity `1.25`. Unit values must equal the declared canonical unit;
the service performs no package conversion. Product identity uses the exact
ordered string fields with no normalization or inferred aliases.

The sole supported grain is one counted fact per product per period. Duplicate
product keys refuse the operation rather than inferring aggregation or mixing
line and document grains. Missing product identity also refuses the operation:
without identity, a scope addition/removal cannot be established.

The money operation must be a current compiled single-definition sum. Its
meaning, dictionary revision, currency, bound money field, null policy and
sign remain pinned. The declared sign applies exactly once. Factor manifests
retain both source and effective signed amounts, the money field and sign.

Running accepts only:

```ts
{ profileId, profileRevision, baselineReceiptId, comparisonReceiptId }
```

Both IDs resolve actual private `CalculatorService` receipts under the current
member and permission epoch. They require disjoint explicit periods, the same
known-on timestamp, the same branch/customer/order population selectors and
the exact profile money definition. The original retained calculation request
establishes selectors absent from the receipt header. No caller-supplied rows,
quantities, prices, model output or qualification flag enter the calculation.

## Arithmetic and coverage

For a common product, the explicitly chosen factor rule computes realized
average unit net value `P = amount / quantity` using exact BigInt rationals.
It attributes the change with separate interaction:

```text
volume       = P0 × (Q1 − Q0)
price        = Q0 × (P1 − P0)
interaction  = (Q1 − Q0) × (P1 − P0)
```

Each product's three contributions truncate toward zero to whole minor units
before summation. The rounding residual preserves the exact difference.
For 10 units at 10 becoming 20 units at 12, measured amounts 100 and 240
produce volume 100, price 20, interaction 20 and residual zero.

New products contribute their full comparison amount to scope additions;
removed products contribute their negative baseline amount to scope removals.
These known scope amounts require no invented unit price. Missing or zero
common-product quantities and missing/incompatible canonical units produce
missing-factor residual rather than a fabricated price of zero. Unknown
money already excluded by the original dictionary remains unknown in the
original receipt coverage.

The declared `partial` policy releases a visibly partial bridge with separate
missing-factor and rounding residuals. `refuse` retains measured totals and
gaps but releases neither contributions nor residual attribution. Empty cuts
and incomplete money coverage create explicit gaps. Exact reconciliation to
the currently measured receipt delta does not establish complete business
coverage. Product and diagnostic ordering is deterministic under row
permutations. Exact rational components remain inspectable in kernel output.

## Current access, admission and retention

`BridgeService` accepts existing `CalculatorOptions` so integration installs
the same receipt/source/semantic readiness guards used for normal numbers.
It rechecks both receipts during preparation, inside the authoritative commit
view and on reopening. Counted facts are compared with the original known-on
selection and exact money/source row bindings. Counted and excluded fact IDs,
source roots, profile revision, factor hashes, receipts and population cuts
remain in the private saved manifest. Factor, profile, dictionary, permission
or admission drift prevents release or reopening; stale evidence is never
silently restated as a fresh result.

Managed capture, consumer-binding and semantic evidence/anchor records make
the trusted `factorAdmission` host port mandatory, including roots with empty
or excluded populations. That port must prove the product grain, quantity and
unit semantics for the exact manifest in addition to existing money/source
readiness. RPC requests cannot install it. No implementation is installed by
default. A synthetic test port records `synthetic-factor-admitted`; it does
not qualify a named vendor. Manual owner-authored cases record
`source-unqualified`. All outputs retain `declared-experimental` status.

Profiles and results live in `State.answers` with explicit source roots and
fact lineage, so existing source deletion and retention cleanup remove them.
Profile enumeration exposes only current accessible profiles belonging to
the same member/epoch. `get({id})` revalidates current evidence and returns a
detached private record; another member, a removed source or an obsolete
profile cannot reopen it. Execution makes no model/provider/helper call and
creates no external action.

## Bounded verification

`descriptive-bridge.test.ts` has independent literal cases for interaction,
scope effects, signed rational arithmetic, scaling, per-product truncation,
large integers, permutations, missing factors, empty coverage, refusal and
closed input/resource bounds. `bridge-service.test.ts` exercises actual
synthetic imports and private calculator receipts, explicit publication,
source row lineage, partial/refuse behavior, current readiness, managed empty
scope admission, permission/revision/factor drift, erasure and commit races.

These tests establish local code behavior. They do not establish acquisition
of an external corpus, independent installation/vendor qualification, causal
identification, native GUI behavior, a database proof for the bridge kernel
or a release/security pass. The dedicated security review remains separately
blocked and unverified; this implementation does not retry it.
