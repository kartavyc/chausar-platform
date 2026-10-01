# Joined conversation acceptance repair

Original base: `de1608438bef08d263e32f71e599b31aec9142e7`; continuation integration starts from the frozen repair checkpoint `21bf514f71b49ba761a0be304319a8771dfd5662`. This change joins Engine, Calculator, Gateway, strict IPC and the existing renderer. It is not a live-provider, frontend redesign, native package or overall release qualification.

## Isolated ownership

Root: `engine.ts`, `calculator.ts`, the necessary `engine-connectors.ts` readiness seam, and new root tests. Task 17: `gateway.ts` and its tests. Task 15: `conversation-history.ts`, the existing renderer and acceptance tests. The new authoritative frontend lane owns separate new files until the acceptance renderer patch is integrated. Do not pull uncommitted changes or write another lane's files.

## Calculation scope

`CalculationRequest.sourceIds?: string[]` selects a unique, bounded source list. `[]` means empty. The Calculator filters the fact view before every primary/comparison/aging selection, conflict resolution and arithmetic. Its receipt includes `requestedSourceIds` only for scoped requests, including sources with no counted rows. Current access is rechecked after asynchronous verification, during persistence and on readback. Engine passes the completed reviewed manifest's explicit selected sources, including selected sources with no observed rows; absent an explicit selection it uses the model receipt's validated sources. Its subset postcondition remains. Connector captures and installed profiles are checked only within this requested scope; receipt readiness retains that scope. Legacy unscoped requests preserve their existing behavior.

## Retained clarification shape: Task 15 integration

Returned answer:

```ts
{
  clarification,
  modelReceiptId
}
```

Signed `state.conversations` record:

```ts
{
  id,
  kind: 'conversation-clarification-answer',
  at, memberId, epoch,
  question, // exact original wording, including leading/trailing whitespace
  answer,
  modelReceiptId,
  sourceIds,
  rowIds,
  integrity
}
```

Lineage uses the union of the model's `factIds` and `rowIds`, plus all model source IDs and sources derived from those facts, sorted and unique. Admission must bind the exact retained answer to a completed, current, private conversation model receipt whose validated plan is a clarification and whose `naturalQuestion` is the stored question. Retention/current source and fact authority still apply, including zero-fact scopes. Clarification has no calculation child or resultRefs. History summary kind is `clarification`, its ID is the retained record ID, and its `receiptId` is the model receipt ID. Render its words as a clarification; preserve the history item ID for an explicitly selected continuation. This matches Task 15's committed exact reader contract at `0abb7626a13ce5eb31fb9ca13008fe352039f1bc`.

All-tool-error answers retain the existing `grounded-conversation`/`conversation-tools-answer` shape. They now persist unconditionally with ordered tool errors and `resultRefs: []`. Task 15 must allow zero successful children while still validating the completed model's exact ordered execute plan, error shape and all model lineage/current authority. No provider failure or invalid plan is converted into an admitted conversation answer.

## Joined reviewed continuation

Engine supplies a synchronous trusted host resolver to Gateway:

```ts
engine.conversationContinuation(context, turnId, currentView?): {
  schemaVersion: 1,
  turnId,
  originalQuestion,
  clarification,
  sourceIds,
  requestScope,
  digest,
  exchanges?: { question: string; clarification: string }[]
}
```

The resolver does not invoke a provider, preview or resend text. It checks the signed retained clarification, exact question/plan/answer binding, member/epoch, record retention, current model/source authority and lineage. It separately preserves every selected source, including sources with no observed facts. Its source IDs and private scope are authority metadata, **not automatic outgoing Shape disclosure**.

`ModelRequest.continuationId?: string` identifies one pending clarification. Gateway resolves it through `GatewayOptions.conversationContinuation(context, turnId, view, resolvedByModelReceiptId?)`; Engine supplies the callback. The public strict RPC method `conversation.continuation` accepts exactly `{ id: string }`. It cannot supply a descriptor body or the internal consumed-by receipt override. Continuing without a reviewed conversation model route refuses.

The next preview separately shows the prior original objective, clarification, bounded exchanges and current reply in the exact payload. Request and receipt bind continuation ID/digest, question, current source/branch/period scope and route. Approval and dispatch recheck the retained turn and current authority. Changed or omitted continuation IDs, changed payloads and conflicting fixed scope refuse. Unspecified prior scope can be narrowed in the new exact reviewed request. No prior private text is sent merely because the user types a fresh question.

The existing renderer offers an explicit continuation action on fresh clarifications. Opening a saved pending clarification also selects that objective; this selection survives closing the answer dialog and typing a reply after reopening the worker. It shows the objective and clarification beside the composer and offers “Start a new question.” It forwards only the opaque ID, preserves the exact reply text, and shows a separate prior-text disclosure warning before the published-definition warning and approval checkbox. Delayed responses, lock/access changes and unavailable contexts clear stale selection. Provider failure leaves the objective pending and requires another exact reviewed preview; there is no automatic retry.

Only a durably retained resulting clarification or combined answer consumes its parent. Engine commits the answer and signed `conversation-continuation-resolved` marker in the same authorized state update. Provider, plan or persistence failure does not consume the parent. Public reuse of a legitimately consumed ID returns `CONVERSATION_CONTINUATION_RESOLVED`; the saved old clarification remains readable. Gateway readback permits that consumed parent only for the exact recorded resulting model receipt. Current source/retention authority continues to apply to archived answers.

Chains preserve the first objective and ordered question/clarification exchanges. The resolver admits at most eight exchanges and a 64 KiB descriptor, and Gateway limits recursive current-binding checks to eight. It refuses full or oversized context with `CONVERSATION_CONTINUATION_LIMIT` rather than truncating private text. The saved clarification remains readable with a visible explanation and no continuation action; starting a new question is the explicit recovery. Recursive Gateway preview checks also refuse excess depth with `INVALID_CONVERSATION_CONTINUATION` before dispatch. Independent acceptance and native packaging remain separate release gates.

## Evidence

All new fixtures are authored synthetic records and HTTP contracts. No live provider, CLI or customer vault is used, and no files on D: are written. Root's public-flow checks use the actual renderer, preload, strict IPC, production worker and Engine. They cover a saved billed objective followed by “September 2026,” exact scoped local arithmetic, receipt/history reopening without redispatch, further clarifications, provider failure followed by a newly reviewed attempt, current source revocation and selected sources with no rows. The independent supplemental acceptance patch is retained unchanged. Existing operator-provided dependency files are linked read-only through the local worktree junction. Frozen-tree aggregate results are recorded separately with the exact source commit and tree; these tests do not establish live Luna access, Electron GUI, hosted/enterprise, vendor, signing or overall release readiness.
