# Decision journal application wiring

The Engine now exposes the rich journal facade through paired local HTTP RPC and the desktop IPC allowlist. The real `EngineHarness` launches the normal `worker.ts`; its requests reach the same named Engine cases and encrypted workspace store. Legacy `decisions.create`, `decisions.list` and `decisions.review` retain their behavior. Legacy review refuses a rich record with `JOURNAL_REVIEW_REQUIRED`.

## Named requests

All payloads are closed objects. Unknown keys and omitted required fields are refused before persistence. Nested journal content, drafts, observations and reviews retain the facade's validation and authoritative evidence checks.

| Method | Payload | Result |
| --- | --- | --- |
| `decisions.journal.draft` | `{ content: JournalContent }` | Transient `JournalDraft` with exact retained receipt previews and digest |
| `decisions.journal.confirm` | `{ draft: JournalDraft, reviewedDigest: string }` | New `JournalDecision`, revision 1 |
| `decisions.journal.revise` | `{ id: string, content: JournalContent, expectedRevision: number, reason: string }` | Updated journal and retained prior content |
| `decisions.journal.review` | `{ id: string, review: JournalDecisionReview, expectedRevision: number }` | Updated journal and retained human assessment/evidence |
| `decisions.journal.due` | `{ dueOn?: string, branch?: string }`, or no payload | Currently accessible mixed legacy/rich records |

`JournalContent` requires text, options, assumptions, selected option ID, explicit current owner ID, expected outcome, review date and hypotheses; branch is optional. The expected outcome requires description, measure, population, ordered window, maturity date, lag rule and uncertainty, with an optional receipt/figure baseline. Evidence references carry saved receipt IDs and optional figure keys. Each option needs its own ID, label, reason and evidence list; each assumption needs ID, text, declared status and evidence list. An empty list is explicit rather than an omitted required field. Type definitions live in `platform/runtime/decision-journal.ts` and are imported into the desktop request/result contract.

Confirmation creates a new record and therefore has no prior record revision. It requires the exact digest explicitly reviewed by the human. Subsequent revision and review require a positive integer `expectedRevision`; the facade reloads the current record inside `StateStore.update`. A lost race returns `REVISION_CONFLICT` without another record revision or audit event. Clients must reload the record rather than automatically repeat a failed writer.

Drafting requires prepare permission and persists nothing. All four journal writer methods require an explicit `desktop` channel and an untainted request (`APP_DECISION_REQUIRED` otherwise); confirmation remains a distinct human step. Due reads use the existing authorized read context, including its current membership, permission epoch, branch, private receipt and source rules. No reader channel restriction is added. Due reads without a date include closed records; a supplied date returns open records due on or before that date. Invalid or blank supplied dates retain `INVALID_DATE`.

## Desktop lifecycle example

`content` below is a complete `JournalContent` assembled from explicitly selected owner, dates and current saved receipts. The user first sees the draft's content and exact evidence, then explicitly confirms it:

```ts
const draft = await window.chausar!.request('decisions.journal.draft', { content });
// Render draft.content and draft.receipts for human review before the next call.
const saved = await window.chausar!.request('decisions.journal.confirm', {
  draft, reviewedDigest: draft.digest,
});
const revised = await window.chausar!.request('decisions.journal.revise', {
  id: saved.id, content: revisedContent, expectedRevision: saved.revision,
  reason: 'Human explanation of the changed premise',
});
const reviewed = await window.chausar!.request('decisions.journal.review', {
  id: revised.id, expectedRevision: revised.revision,
  review: { outcome: 'continue', nextReviewDate: '2026-11-01', observation: {
    state: 'pending', measurements: [], notes: 'Awaiting further evidence',
    uncertainty: ['Other activity may affect the result'],
    concurrentInterventions: [], executionReceiptIds: [],
  } },
});
const due = await window.chausar!.request('decisions.journal.due', {
  dueOn: '2026-11-01', ...(reviewed.branch ? { branch: reviewed.branch } : {}),
});
```

The dates and text in this example are synthetic, not suggested business policy. `continue` reopens the record and may set a next review date. `accepted`, `rejected` and `completed` close it. Revising a closed record preserves its closed status. Observation states and outcome judgments remain human declared; measurement snapshots prove the exact referenced figures, not causality, window/population matching or achievement. Scenario projections cannot be measured outcomes.

## Trusted execution boundary

`EngineOptions.reports` exposes only `Pick<ReportOptions, 'executionReceipt'>`. During vault attachment the Engine passes that resolver alongside its existing calculator verification/consumer/receipt guards. RPC payloads, route configuration and the desktop bridge cannot install this function or override those guards. The host resolver receives `(ctx, id, view)` and must return an existing authoritative `JournalExecutionReceipt` under current access. `view` is the transaction's read-only current-state view. Saved execution snapshots retain their source/row dependencies; later reads and writers recheck both current references and historical lineage.

Normal Engine construction now installs `createJournalExecutionResolver` against the actual current action registry. It accepts only existing action or attempt IDs with one verified attempt, identical verified readback, exact durable identity/approval and audit evidence, current source/branch/member access, registry read authorization and retention. It uses the supplied transaction view. Unknown IDs, prepared/uncertain/absent effects and job/calculation IDs refuse. A trusted host may explicitly replace this resolver; RPC cannot supply one.

Snapshots retain exact action/attempt/readback/approval/audit identity, `executionVerification`, `providerReportedBusinessSuccess` and `businessOutcome: 'not-assessed'`. They omit payload, provider result and opaque readback data. Actions have no authoritative row-ID field, so the resolver returns no inferred rows. A verified local reminder draft proves a retained draft exists; it does not send a message or establish business achievement. The paired HTTP lifecycle tests link that actual effect, reopen its encrypted review and deny the saved journal after source revocation. Verified execution, business success and a human-declared observation remain separate claims.

## Remaining renderer and root integration

The ordinary form lifecycle is now joined in the existing renderer: complete content controls, a draft/evidence preview and explicit confirmation, loaded revision/reason, review observations/current figure selection, due filters and readable retained history. It retains the simple decision flow and uses rich methods for revision-bearing records. A conflict preserves typed values, reloads accessible evidence and requires explicit adoption of the new revision before another submission. The execution picker offers current authorized verified-action candidates, with every link rechecked by the resolver on submission. See `docs/journal-renderer.md` for its focused evidence and remaining role-selection/transfer boundaries. Native visual acceptance remains unverified.

No renderer, preload implementation, execution service, provider, host profile, dependency or requirements ledger was changed. This join completes named Engine/HTTP/worker/typed desktop transport wiring, not the full journal product UI or real execution-reference integration.

## Focused verification

`node --test platform/tests/decision-journal-engine.test.ts platform/tests/decision-journal-worker.test.ts platform/tests/desktop-harness.test.ts` passed 17/17, with zero skipped: nine paired HTTP/Engine cases, one actual worker lifecycle and seven existing desktop contract/harness cases. All business/effect evidence is explicitly synthetic. The worker uses a narrow environment without provider credentials or installed CLI evidence. Tests cover digest and counterfeit evidence refusal, exact money/history, lock/open persistence, concurrent revision versus review, required fields, default resolver refusal, trusted resolver retention, source/branch/private receipt revocation, channel/taint checks and legacy compatibility. `node node_modules/typescript/bin/tsc --noEmit` passed separately using the already verified TypeScript 5.9.3 dependency stage; no live provider or native inference is invoked.
