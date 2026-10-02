# Reviewed conversation calculation join

This source join connects the isolated comparison/scenario parameter contract to Gateway preview, provider-output admission, retained receipt admission and the narrow Engine conversation calculation path. All model fixtures are explicitly synthetic; no live inference, vendor qualification, native GUI or security-pass claim follows from this join.

- Exact owner-requested current/prior periods and integer-string price assumptions are disclosed separately from evidence Shape and retained with their origins and digest. The approved bytes and regenerated closed schema must match them before dispatch/readback.
- Explicit selected sources (including prior-only and empty selections) remain the exact calculation admission; the descriptive manifest remains current-period-specific. Current access, fact digests, business readiness and Calculator row guards continue to apply.
- Clarification continuations retain parameter inputs independently of BusinessContextRequest, permit missing inputs only in a fresh review, and refuse conflicting inherited values.
- The incomplete-change all-tool-error fixture was replaced with valid aging admission and a genuine missing-link tool failure. A separate missing-comparison admission test preserves its newly correct refusal boundary.

The pure trusted-host API `ModelGateway.assertReviewedConversationRequest(context, exactRequest, view)` shares dispatch request/current-evidence checks. It requires an unused original approval for a preview or the original consumed approval for a completed receipt. It only returns the current model DTO and never mutates state, dispatches, reserves budget or grants effect authority. Phone orchestration can call this guard against its transaction view before reserving intent and again before protected readback. Historical ordinary receipts without the new parameter disclosure retain their earlier admission shape.

## Serial verification inventory

The original `platform/tests/fixtures/conversation-calculation-public-join.ts` is unchanged. The new `platform/tests/conversation-calculation-public-join.test.ts` imports it into the ordinary test inventory. Do not run both entry points in the same Node test invocation.

Run from this worktree with existing operator-installed dependencies:

```powershell
node node_modules/typescript/bin/tsc --noEmit --project tsconfig.json
node --test --test-concurrency=1 platform/tests/conversation-calculation-arguments.test.ts platform/tests/conversation-calculation-functional.test.ts platform/tests/conversation-calculation-gateway-join.test.ts platform/tests/conversation-calculation-public-join.test.ts platform/tests/conversation-gateway-catalog.test.ts platform/tests/conversation-turns-engine.test.ts platform/tests/conversation-continuation-gateway.test.ts
node scripts/check.mjs
```

Lane validation: strict root TypeScript completed with zero diagnostics; Node syntax checks passed for Gateway, Engine and the two new test entry points; git diff whitespace checks passed; the standalone public fixture has no changes from the imported lane. The runtime gates were deliberately not executed during the coordinator aggregate freeze. The coordinator owns serial execution of the runtime gates and aggregate checks. This lane does not assert their results before they execute. No dependencies were acquired and no D-drive files were written.