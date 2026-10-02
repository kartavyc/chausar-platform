# Conversation comparison and scenario parameters lane

The lane now validates and schemas the existing `change` and `scenario` calculator inputs against exact owner-reviewed parameters. Synthetic functional tests use real reconciled CSV imports, the existing calculator and encrypted receipt/history readback. The public missing-input clarification path passes. Successful public comparison/scenario turns still need the coordinator-owned Gateway/Engine join described below; this lane does not claim that join has passed.

Base: `1dc19b856380951aea49b7143ed4b5617130c06b`, tree `68b396560c2b7950ccaf9d8c38ee52d87bd60d65`. Ownership follows `post-activation-implementation-lanes.md`, lane 1. Only the planner, new argument helper, new focused tests and this lane document change. The source checkout and pinned worktree have no `.agents` directory or `AGENTS.md`; no checkout-local skill could be read. Reviewed plan: `docs/specs/CHAUSAR-FINAL-IN-DEPTH-PLAN.md` sections 3.9, 20.36, 22.10, 22.18 and 22.31.

## Implemented contract

`ConversationPlannerContext.reviewedCalculationParameters` is an optional trusted host input:

```ts
{
  period?: { from: string; to: string };
  comparePeriod?: { from: string; to: string };
  assumptions?: { priceChangeBps: string };
}
```

Populate it only from explicitly selected owner inputs retained in the exact approved preview. Source text and planner output cannot populate it. The helper validates plain data descriptors, exact fields and canonical real inclusive calendar dates before generating a schema or validating a calculation. Supplied reviewed current periods must match every calculator call exactly. Existing unpinned ordinary calls preserve their original behavior.

Ordinary calculator wire objects retain exactly `operation`, `period`, `branch` and `customerId`, with explicit null absent selectors. `change` adds exactly `comparePeriod` and requires both reviewed periods. `scenario` adds exactly `assumptions` with the sole key `priceChangeBps`. Those operations appear in schema alternatives only when their required reviewed inputs and existing operation allowlist are present. Model-selected overrides, unsupported fields and unreviewed required inputs fail with `INVALID_CONVERSATION_PLAN`; validation never silently changes an execution request into approval or a clarification.

Basis points use the backend's signed integer string convention and existing range `[-10000, 100000]`. Exact strings such as `"00500"` and `"-0"` are preserved in requests and schema enums. The backend normalizes receipt figures, uses constant volume and truncates fractional minor units toward zero. Decimal, numeric, percentage, exponent, alternative-unit and extra demand/volume assumptions refuse. The existing planner transfer/text limits remain authoritative; the host helper bounds assumption text to the same existing text limit. No new formula or convention is introduced.

`conversationCalculationParameterDisclosure(parameters)` returns copied reviewed periods, an explicit `owner-requested` assumption origin/label, and plain missing-input questions. Labels remain outside backend assumptions. `conversationCalculationClarification(operation, parameters)` provides focused questions for missing current period, comparison period or price change. Planner instructions require clarification, preserve number grounding, and prohibit model `onDate`/`asOf` overrides. An alternate aging date requires a new reviewed scope.

The default context locks the new operations until shared integration supplies the reviewed inputs. A question mentioning a scenario is insufficient by itself to unlock it. The helper validates selected inputs; it does not parse free text, authorize effects, resolve fiscal calendars or certify a model's interpretation.

## Coordinator join

1. Extend the owner-facing request contract coherently with the existing calculator's explicit `comparePeriod` and `assumptions` values. Validate them using `validateReviewedConversationCalculationParameters` before preview. Preserve the current requested period alongside them. Keep calculation parameters separately from `BusinessContextRequest`, which currently rejects those fields. For inherited continuation values, retain exact parameter origins and require a fresh review when any parameter changes.
2. Include `conversationCalculationParameterDisclosure` in the exact outbound content and persist its validated raw parameters/digest. Supplied values are separately reviewed owner inputs, not values derived from evidence Shape. Do not send extra rows or names. Update `PLANNER_PARAMETERS` and `publishedCalculationCatalog` to describe supported operation-specific inputs and unavailable required inputs coherently.
3. Supply the same `reviewedCalculationParameters` to all three planner contexts in `gateway.ts`: preview schema construction, provider-output validation, and `assertConversationReceipt` retained/reopened validation. Bind parameters, schema, disclosure, endpoint and definition hashes to single-use approval. Check request changes before provider entry and retained parameter integrity before readback.
4. Carry only the appropriate new arguments into Engine calculator execution. Validate exact reviewed values before execution; do not inject a comparison or scenario parameter into unrelated operations. Keep trusted `asOf`/`onDate`, explicit empty source scope, source/readiness/current-permission checks, counted-row admission and receipt number guard intact.
5. Ensure both periods' evidence remains within reviewed source admission. `model.factIds` currently spans all dates for admitted sources, so do not broaden the current period to a union span. Ordinary manifest source IDs can omit a source with only prior-period records; retain explicitly selected/admitted sources under existing guards. Test an A-only current source plus a separately admitted prior-only source, and refusal when that prior source is unselected/revoked.
6. Prove actual public import -> preview -> exact single-use approval -> synthetic planner -> existing calculation -> retained answer/receipt -> reopen. Tests must include changed comparison/scenario inputs before dispatch, retained parameter tampering, changed dictionary, denied/unselected sources, unsupported scenario and unchanged source facts. The lane's successful calculator/retention fixture is not a replacement for this joined proof.

`docs/grounded-conversation-planner.md` and `platform/tests/conversation-gateway-catalog.test.ts` still document/assert unavailable arguments and need coordinator updates after this join. The existing `platform/tests/conversation-turns-engine.test.ts:90` fixture emits a four-field incomplete `change` execution and expects a retained `COMPARISON_REQUIRED` child error. The new contract correctly rejects that wire at planner admission. Update the fixture to a genuinely admitted calculator failure (for example a missing required aging link) to preserve its all-tool-error retention coverage; also assert missing comparison receives clarification/fail-closed admission. Do not relax new validation to retain the obsolete fixture.

## Executed evidence

The focused lane/planner/calculator source-scope command passed **55/55** tests, with no skips:

```powershell
node --test platform/tests/conversation-calculation-arguments.test.ts platform/tests/conversation-calculation-functional.test.ts platform/tests/conversation-planner.test.ts platform/tests/calculator-source-scope.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

The typecheck passed. New lane tests account for 27 passing cases. Functional arithmetic keys are independent constants: current `30001` minus prior `12000` gives `18001` and `15000` truncated basis points; owner `00500` basis points yields `31501` revenue from a `30001` baseline. Additional cases prove negative truncation, zero prior denominator, overlap lineage deduplication, exact integers above JavaScript's safe range and range edges. Import fixtures deliberately include outside-source conflicting identities. Source facts compare byte-equivalently as structured data before and after scenario evaluation.

The public clarification fixture proves an actual single-use preview/approval and synthetic provider dispatch, no calculation for missing input, encrypted reopening and no provider replay. Changed reviewed period or published meaning refuses before synthetic provider entry. Source revocation refuses new arithmetic and retained readback; definition publication withholds stale saved answers without recomputation. A newly admitted `aging` call over an actual imported invoice missing its links proves all-tool-error retention and reopened readback with `AGING_LINK_REQUIRED`; stricter comparison admission does not remove that behavior.

Gateway/catalog/history/turn regression command: **46/47** passed; only the obsolete incomplete-`change` fixture above failed. This is explicitly disclosed, not a green aggregate acceptance claim.

```powershell
node --test platform/tests/conversation-gateway.test.ts platform/tests/conversation-gateway-catalog.test.ts platform/tests/conversation-history.test.ts platform/tests/conversation-turns-engine.test.ts
```

The explicit successful-public-join gate is executable rather than a mock or skip:

```powershell
node --test platform/tests/fixtures/conversation-calculation-public-join.ts
```

It creates the real loopback HTTP server, imports current, prior-only and unselected source fixtures through HTTP, requires exact schema pins and changed-parameter refusal before provider entry, then checks independent arithmetic, one-use approval, unchanged facts and identical retained answers/receipts through HTTP reopening. Its two cases currently fail at the exact `PUBLIC_CALCULATION_JOIN_PENDING` schema check because the reserved Gateway does not yet supply `reviewedCalculationParameters`. No synthetic provider call occurs before that failure. The file is an explicit coordinator gate outside the standard `*.test.ts` glob; this red result is not reported as passed public acceptance.

## Remaining qualification

Successful public comparison/scenario join acceptance is pending coordinator changes. No real model/Codex wording or inference, native GUI, native PostgreSQL/DuckDB execution, device/hosted behavior, commercial eligibility or enterprise Temporal/Cube/PostgreSQL qualification ran here. Existing dependencies were reused read-only through a C-worktree junction; no packages were acquired and no D-drive files were written. The lane brief records unavailable enterprise dependencies; their state was not newly qualified here, and injected/synthetic tests do not qualify them. Fiscal mappings, causal explanations, demand scenarios and multi-job scenario revision graphs remain full-plan requirements beyond this existing price-only operation. Previous browser/security and dependency denial boundaries remain in force. Parent owns merge/push and public release acceptance.
