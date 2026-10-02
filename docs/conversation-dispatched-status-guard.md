# Dispatched conversation status guard

`ModelGateway.assertDispatchedConversationRequest(context: Context, request: ModelRequest, view: StateStore = this.store): DispatchedConversationStatus` is a pure trusted-host read/reconciliation guard for `dispatching` and `failed` receipts with persisted evidence of one original dispatch. It cannot start, retry, approve, reserve budget, release an answer or grant an external effect.

The guard requires the exact reviewed request matcher, current member/source/fact/privacy/readiness/route/schema/dictionary and parameter bindings, the unique original consumed approval, its current approver/epoch, and the original preview/route/endpoint/payload digest. `attempts` must be exactly one. Persisted `dispatchedAt` must be a finite timestamp in the original approval interval `[createdAt, expiresAt)` and no later than the current clock.

A later status read can occur after the one-transfer approval expires: the recorded dispatch must have occurred during its approval interval. The existing `assertReviewedConversationRequest` and `Gateway.execute` retain their prior semantics. New execution still requires a current unused exact approval, and both guard APIs reject replay. Completed answers continue through the reviewed guard and retained history/receipt admission.

The returned status DTO contains only `id`, `purpose`, `status`, member/epoch, selected `sourceIds`, route metadata, payload/schema digests, `attempts`, `dispatchedAt` and published dictionary hash/version. It excludes plans, answer/result wires, provider output, payload bytes and error text. Phone orchestration may use it for current read/status/cancel checks after its first dispatch, never as result or execution authority.

## Verification handoff

Run serially from the joined source tree when the coordinator's current checks finish:

```powershell
node --test --test-concurrency=1 platform/tests/conversation-dispatched-request.test.ts platform/tests/conversation-calculation-gateway-join.test.ts platform/tests/conversation-continuation-gateway.test.ts
node node_modules/typescript/bin/tsc --noEmit --project tsconfig.json
```

The focused synthetic tests hold one actual Gateway fixture dispatch in memory, exercise a genuine provider failure, verify read-only transaction views, expired approval/status distinctions, exact original approval/dispatch evidence, current readiness/dictionary/source access and replay/result refusal. No external provider, customer data, native process or network is used.

Only scoped Node syntax checks and git diff checks were run for this follow-up; runtime tests and TypeScript were deferred to the coordinator's serial checks. No Engine edits, dependencies, D-drive writes or security audit were performed.