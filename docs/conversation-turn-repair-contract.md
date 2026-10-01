# Joined conversation acceptance repair

Base: `de1608438bef08d263e32f71e599b31aec9142e7`. This change repairs Engine/Calculator behavior. It is not a live-provider, frontend redesign, native package or overall release qualification.

## Isolated ownership

Root: `engine.ts`, `calculator.ts`, the necessary `engine-connectors.ts` readiness seam, and new root tests. Task 17: `gateway.ts` and its tests. Task 15: `conversation-history.ts`, the existing renderer and acceptance tests. The new authoritative frontend lane owns separate new files until the acceptance renderer patch is integrated. Do not pull uncommitted changes or write another lane's files.

## Calculation scope

`CalculationRequest.sourceIds?: string[]` selects a unique, bounded source list. `[]` means empty. The Calculator filters the fact view before every primary/comparison/aging selection, conflict resolution and arithmetic. Its receipt includes `requestedSourceIds` only for scoped requests, including sources with no counted rows. Current access is rechecked after asynchronous verification, during persistence and on readback. Engine passes the completed reviewed model receipt's actual `sourceIds`; its subset postcondition remains. Connector captures and installed profiles are checked only within this requested scope; receipt readiness retains that scope. Legacy unscoped requests preserve their existing behavior.

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

## Pending-turn port: Task 17 coordination before outbound wiring

Root has added a synchronous host-only resolver:

```ts
engine.conversationContinuation(context, turnId, currentView?): {
  schemaVersion: 1,
  turnId,
  originalQuestion,
  clarification,
  sourceIds,
  requestScope,
  digest
}
```

It does not invoke a provider, preview or resend text. It checks the signed retained clarification, exact question/plan/answer binding, member/epoch, record retention, current model/source authority and lineage. It refuses consumed turn IDs represented by a `conversation-continuation-resolved` journal record. The port's source IDs and private scope are authority metadata, **not automatic outgoing Shape disclosure**.

Proposed exact Gateway seam for the external owner to confirm: `ModelRequest.continuationId?: string` and `GatewayOptions.conversationContinuation?: (context: Context, turnId: string, view: StateStore) => ConversationContinuation`. Gateway resolves IDs through this trusted host callback; RPC cannot supply the descriptor body. Root will inject its method once that Gateway contract exists.

The next reviewed preview must separately show the prior original objective, clarification and current reply in the exact payload. Request and receipt bind continuation ID/digest, question, current source/branch/period scope and route. A changed continuation or changed current scope must invalidate dispatch. No old private text is sent because the user merely types a fresh question. UI continuation selection is explicit, including after reopening; new approval covers the full outgoing prior text and reply.

Still to join: Gateway preview/dispatch support, public history/UI admission, consuming a pending turn only after a durable resulting turn, and bounded multi-clarification chains. These are not claimed implemented by the host resolver alone. Parent must relay this contract to Tasks 15/17 before their patches are merged; source publication/package release remains paused until joined independent acceptance passes.

## Evidence

All new fixtures are authored synthetic records and HTTP contracts. No live provider, CLI or customer vault is used, and no files on D: are written. Root's focused Engine checks cover public reviewed selected-source arithmetic and receipt/history reopening; an empty source selection; unrelated unpublished connector refusal boundaries; durable all-tool-error and clarification records; exact objective retention; and refusal of revoked, tampered or expired pending turns. Existing operator-provided dependency files are linked read-only through the local worktree junction.
