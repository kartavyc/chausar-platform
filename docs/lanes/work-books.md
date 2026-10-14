# Lane: work-books

Work (WK-01..WK-16) and Books (BK-01..BK-20). This document starts with the engine
contract the screens code against; the lane report follows it.

## Engine contract

Conventions for every reply:

- Money is `Amount = { minor: string } | { missing: Missing }`: whole paise as an integer
  string, or one of the seven missing words `absent | null | unknown | withheld |
  not-applicable | not-loaded-yet | not-counted`. Never a float, never a zero for missing.
- A figure that comes from a calculation also carries `receiptId: string`.
- Times are ISO instants; dates are `YYYY-MM-DD`; months are `YYYY-MM`.
- Text from the books (names, narrations) is returned as data and drawn as text only.
- Refusals are `check(condition, 'CODE', 'Plain sentence.')` with fixed upper-case codes.
- A capability that belongs to another lane and is not installed answers with
  `{ available: false }` in the relevant field (never a fake value). Screens show "not built
  yet" for it.

### Work: `approvals.*`

Ids in the queue are typed: `action:<actionId>`, `job:<jobId>`, `release:<draftId>`,
`lesson:<lessonId>`, `acceptance:<jobId>`.

```
ApprovalRow = {
  id: string; source: 'action' | 'job' | 'release' | 'lesson' | 'acceptance';
  kind: 'message' | 'record-change' | 'money' | 'prepare-only' | 'job' | 'group';
  tier: 'tier-2' | 'tier-1' | 'prepare-only';   // tier-2 = always-waits list
  title: string;                // plain words built from the prepared request, never model text
  touches: string | null;       // who or what it touches (system and target)
  amount: Amount | null;        // from the prepared request; null when there is no amount
  preparedBy: { kind: 'person' | 'job' | 'chausar'; name: string } | null;
  createdAt: string; expiresAt: string | null;   // 24 h for a message to an outsider, 7 days inside
  state: 'prepared' | 'approved' | 'executing' | 'verified' | 'unknown' | 'rejected' | 'blocked' | 'cancelled';
  practice: boolean;
}
Step = { name: 'prepared' | 'approved' | 'done' | 'read-back' | 'recorded';
         state: 'done' | 'waiting-for-you' | 'waiting-for-network' | 'unsure' | 'stopped-by-rule' | 'not-reached';
         at: string | null }
ApprovalDetail = ApprovalRow & {
  digest: string; revision: number;
  reason: string;               // the rule that made it wait: 'always-waits:money' | 'always-waits:message' | 'always-waits:delete' | 'always-waits:irreversible' | 'autonomy-off' | 'job-approval' | 'release-cosign' | 'lesson-review' | 'acceptance'
  change: { asWritten?: string; fields?: { name: string; before: string; after: string }[] };
  voucher?: { type: string; number: string | null; date: string; lines: { ledger: string; debit: Amount | null; credit: Amount | null }[]; note: 'prepare-only' };
  job?: JobCard;                // for a proposed job (WK-09)
  steps: Step[];                // always five, in order
  can: ('approve' | 'notNow' | 'change' | 'drop' | 'reconcile')[];
  readOnly: boolean; prepareOnly: boolean; needsSecondAsk: boolean;
  blocked?: { kind: 'expired' | 'owner-approves' | 'unsure' | 'changed' | 'prepare-blocked'; code: string };
  snoozedUntil?: string;
}
```

| Method | Permission | Payload | Reply |
|---|---|---|---|
| `approvals.list` | read | `{}` | `{ items: ApprovalRow[]; expired: ApprovalRow[]; snoozed: number; counts: { tier2: number; tier1: number; prepareOnly: number } }`, tier-2 first, then tier-1, then prepare-only; newest first inside a tier |
| `approvals.get` | read | `{ id }` | `ApprovalDetail` |
| `approvals.approve` | approve | `{ id, digest, secondAsk?: true }` | `ApprovalDetail` after approval. Money (`needsSecondAsk`) refuses `SECOND_ASK_REQUIRED` without `secondAsk: true`. A changed digest refuses `PREVIEW_CHANGED`. Expired refuses `APPROVAL_EXPIRED`. |
| `approvals.notNow` | read | `{ id, hours?: 1..168 }` | `{ id, snoozedUntil }` (default 24 h; it leaves the list until then) |
| `approvals.change` | prepare | `{ id, payload }` | `ApprovalDetail` (a new revision, prepared again) |
| `approvals.drop` | approve | `{ id }` | `{ id, state: 'cancelled' }` |
| `approvals.group` | read | `{ ids: string[] }` (2..10) | `{ title, undoable: true, items: ApprovalDetail[] }`. Refuses `GROUP_NOT_ALLOWED` if any item is tier-2 or prepare-only. |
| `approvals.approveGroup` | approve | `{ items: { id, digest }[] }` | `{ results: { id, ok: boolean, code?: string, state?: string }[] }`, one approval per item |
| `approvals.pace` | read | `{}` | `{ fastStreak: number; warn: boolean }` (warn after 3 approvals under 2 s each) |
| `approvals.practice` | prepare | `{ id }` | `{ practice: true; available: boolean; steps: Step[]; wouldSend: string \| null; code?: string }`. Calls `writeback.practice` when installed; nothing is sent either way. |
| `approvals.execute` | prepare | `{ id }` (an `action:` id) | `ActionView` (do once) |
| `approvals.action` | read | `{ id }` | `ActionView` |
| `approvals.resolveUnknown` | approve | `{ id, result: 'check' \| 'was-sent' \| 'was-not-sent' }` | `ActionView`. `check` reads back first; the two person answers are recorded as told-by-owner. |
| `approvals.ledger` | read | `{}` | `{ items: ActionView[] }` newest first (WK-05) |
| `approvals.reverse` | approve | `{ id }` | `ApprovalDetail` of a new prepared reversing action, or refuses `REVERSAL_NOT_AVAILABLE` |
| `approvals.catalogue` | read | `{}` | `{ rows: CatalogueRow[]; writeback: { available: boolean } }` |
| `approvals.catalogueEntry` | read | `{ system, action }` | `CatalogueEntry` |
| `approvals.wanted` | prepare | `{ system: string; text: string }` | `{ id; at }` |
| `approvals.wantedList` | read | `{}` | `{ items: { id; system; text; at; by }[] }` |
| `approvals.afterRestore` | read | `{}` | `{ sendingClosed: boolean; items: ActionView[]; notes: string[] }` |
| `approvals.jobs` | read | `{}` | `{ items: JobRow[]; active: number; limit: 10; proposals: { available: boolean } }` |
| `approvals.job` | read | `{ id }` | `JobCard & { timeline: JobStep[]; result: JobResult \| null }` |

```
ActionView = { id; system; action; title; touches: string | null; amount: Amount | null;
  state; steps: Step[]; approvedBy: string | null; channel: 'desktop' | 'phone' | 'mcp' | null;
  request: Record<string, string>;                    // flattened request fields, as text
  readBack: { field: string; asked: string; found: string | null; same: boolean }[] | null;
  rule: string; attestation: { by: string; said: 'was-sent' | 'was-not-sent'; at: string } | null;
  wouldHaveDone: 'waited' | 'done' | null; createdAt; settledAt: string | null; can: ('execute' | 'reconcile' | 'resolve' | 'reverse')[] }
CatalogueRow = { system; systemTitle; action; title;
  kind: 'inside-undoable' | 'seen-outside' | 'money' | 'cannot-undo';
  waits: boolean; status: 'live' | 'experimental' | 'prepare-only' | 'not-yet'; source: 'core' | 'writeback' }
CatalogueEntry = CatalogueRow & { description; idempotency; readBack; retryWindow: string | null;
  tier: 'tier-1' | 'tier-2'; expires: string | null; readStatus: string | null }   // the eleven fields
JobRow = { id; goal; state: 'proposed' | 'scheduled' | 'running' | 'paused' | 'waiting' | 'set-aside' | 'missed' | 'stopped-by-rule' | 'stopped' | 'awaiting-acceptance' | 'accepted' | 'cancelled';
  reason: string | null; nextRunAt: string | null; resumesAt: string | null; spent: Amount; budget: Amount; can: ('pause' | 'resume' | 'cancel' | 'accept' | 'reject' | 'approve')[] }
JobCard = { id; goal; doneWhen: string; owner: string; budget: Amount; reserve: Amount; spent: Amount;
  stopRule: { maxRuns: number; deadline: string }; actions: string[]; testedRoutes: string[];
  reviewOn: string | null; missedRun: 'skip' | 'run-once-on-wake'; runsOn: 'this-computer'; runs: number; lastRunAt: string | null; nextRunAt: string | null;
  untrustedInstructions: boolean; digest: string; revision: number }
JobStep = { at; event: string; amount: Amount | null; needsModel: boolean | null; reason: string | null }
JobResult = { done: string[]; open: string[]; receiptIds: string[] }
```

Mutations on jobs use the core methods directly: `jobs.pause`, `jobs.resume`, `jobs.cancel`,
`jobs.approve { id, digest }`, `jobs.accept { id }`, `jobs.reject { id, reason }`.

### Books: `books.*`, `accounts.*`, `records.*`, `history.*`

```
MonthState = 'loaded' | 'loading' | 'not-loaded-yet' | 'refused' | 'failed'
SourceRow = { sourceId; system: string; way: 'files' | 'signed-in' | 'this-computer'; scope: string | null;
  lastReadAt: string | null; months: { month: string; state: MonthState }[];  // exactly twelve, oldest first
  rows: number; refused: number; unmapped: number; experimental: boolean; connected: boolean }
```

| Method | Permission | Payload | Reply |
|---|---|---|---|
| `books.sources` | read | `{ endMonth?: 'YYYY-MM' }` | `{ rows: SourceRow[]; unmappedFields: number; freshness: { available: boolean } }` |
| `books.source` | read | `{ sourceId }` | `{ row: SourceRow; reads: { id; at; rows: number; totals: Amount; reconciled: boolean; format }[]; refusals: { at; codes: string[] }[]; kinds: { kind; rows: number }[]; unmappedFields: string[] }` |
| `books.unmapped` | read | `{}` | `{ fields: { field; sourceIds: string[]; type: 'text' \| 'number' \| 'date' \| 'empty' \| 'unknown'; filled: { rows: number; of: number } \| null }[] }` |
| `books.meanings` | read | `{}` | `{ dictionary: { version; hash; pack; publishedAt; publishedBy; gstMode } \| null; words: { name; label; meaning; origin: 'core' \| 'pack' \| 'you'; state: 'published' \| 'draft' \| 'clash' }[]; drafts: Draft[] }` |
| `books.meaning` | read | `{ name }` | `{ word: Definition \| null; origin; draft: Draft \| null; history: { version; publishedAt; publishedBy; meaning: string }[] }` |
| `books.draft` | prepare | `{ name, definition: { label, meaning, kind, field, nulls, sign? } \| null }` (`null` removes the word) | `Draft` |
| `books.discard` | prepare | `{ draftId }` | `{ draftId, state: 'discarded' }` |
| `books.cosign` | prepare | `{ draftId, digest }` | `Draft` (a different person than the author; recorded by name and role) |
| `books.publish` | approve | `{ draftId, digest }` | `{ version; hash; staleAnswers: number }` (one release, everywhere at once) |
| `books.packs` | read | `{}` | `{ packs: { pack; label; state: 'in-use' \| 'available'; meanings: number }[] }` |
| `books.gst` | read | `{}` | `{ gstMode: string \| null; rates: { available: false } }` |
| `books.memory` | read | `{ outsideOnly?: boolean }` | `{ lines: MemoryLine[] }` |
| `books.remember` | prepare | `{ text, kind }` | `MemoryLine` (told by owner) |
| `books.memoryEdit` | prepare | `{ id, text }` | `MemoryLine` (earlier version kept) |
| `books.forget` | prepare | `{ id }` | `{ id, deleted: true }` |
| `books.memoryConfirm` | prepare | `{ id }` | `MemoryLine` |
| `accounts.list` | read | `{}` | `{ accounts: { name; group: string \| null; side: 'debit' \| 'credit' \| null; proposed: AccountClass \| null; reason: string[]; decided: { class: AccountClass; by: string; role: string; at: string } \| null; state: 'proposed' \| 'unsure' \| 'decided' }[]; proposals: { available: boolean } }` |
| `accounts.classes` | read | `{}` | `{ classes: AccountClass[] }` |
| `accounts.decide` | prepare | `{ name, decision: 'yes' \| 'no' \| 'change', class? }` | the account row |
| `records.search` | read | `{ kind?: 'customer' \| 'supplier' \| 'item'; text?: string }` | `{ records: { id; kind; name: string \| null; sources: string[]; facts: number }[] }` |
| `records.get` | read | `{ id }` | `RecordView` |
| `records.setOptIn` | prepare | `{ id, channel: 'mail' \| 'whatsapp', answer: 'yes' \| 'no', source: string, on: 'YYYY-MM-DD' }` | `RecordView` |
| `records.stop` | prepare | `{ id, on: 'YYYY-MM-DD' }` | `RecordView` (the customer sent the stop word) |
| `records.matches` | read | `{}` | `{ pairs: { left; right; relation; evidence: string[]; reason: string; state: 'open' \| 'joined' \| 'not-same'; mergeId: string \| null }[] }` |
| `records.decideMatch` | approve | `{ left, right, same: boolean }` | the pair |
| `records.undoMatch` | approve | `{ mergeId }` | the pair |
| `records.conflicts` | read | `{}` | `{ conflicts: { entityId; kind; claims: { sourceId; fields: Record<string, string> }[]; rule: string \| null; picked: string \| null }[]; rules: { kind; sourceIds: string[] }[] }` |
| `records.setPrecedence` | admin | `{ kind, sourceIds }` | `{ kind, sourceIds }` |
| `records.holdings` | read | `{ id }` | `{ stores: { store: string; count: number }[] }` |
| `history.asKnownOn` | read | `{ operation, period: { from, to }, asOf }` | `{ then: { value: Amount; receiptId; asOf }; now: { value: Amount; receiptId; asOf } }` |
| `history.versions` | read | `{ entityId }` | `{ versions: { factId; learnedAt; supersededAt: string \| null; kind; validFrom; amount: Amount; sourceId; change: 'first' \| 'correction' \| 'new-event' }[] }` |
| `history.stale` | read | `{}` | `{ answers: { id; question: string \| null; workedOutOn; reason: string \| null; rebuilt: { at; matches: boolean; quick: Amount; full: Amount } \| null }[] }` |
| `history.rebuild` | prepare | `{ id }` | the stale answer row after a quick and a full rebuild |

```
Draft = { id; name; author: string; createdAt; state: 'draft' | 'cosigned' | 'published' | 'discarded';
  before: Definition | null; after: Definition | null; change: string;
  affects: { calculations: string[]; savedAnswers: number };
  reviews: { kind: 'cosign' | 'ai-opinion'; by: string; role: string; at: string }[];
  checks: { ok: boolean; code: string | null }; digest: string }
RecordView = { id; kind; name: string | null;
  details: { field; value: string; sourceId: string }[];
  owes: { value: Amount; receiptId: string | null };
  timeline: { at; kind; amount: Amount; sourceId; ref: string | null }[];
  optIn: { channel: 'mail' | 'whatsapp'; answer: 'yes' | 'no' | 'not-asked'; source: string | null; on: string | null }[];
  stoppedOn: string | null }
MemoryLine = { id; text; kind: 'preference' | 'claim' | 'conversation' | 'working-context';
  status: 'told-by-owner' | 'assumed' | 'corrected' | 'proposed';
  source: 'told-by-owner' | 'computed' | 'outside-content'; receiptId: string | null;
  learnedAt; confirmedAt: string | null; earlier: { text; at }[] }
AccountClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'receivable' | 'payable' | 'bank' | 'cash' | 'tax'
```
