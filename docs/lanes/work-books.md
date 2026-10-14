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
| `approvals.drop` | approve | `{ id }` | `{ id, state: 'cancelled' \| 'rejected' }` (an acceptance is sent back: `rejected`) |
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
| `approvals.job` | read | `{ id }` | `JobCard & { timeline: JobStep[]; result: JobResult \| null; meters?: JobMeters }` (WK-08 budget meters; see below) |
| `approvals.jobTemplates` | read | `{}` | `{ templates: JobTemplate[]; fromSentence: { available: boolean } }`. Fixed ready-made jobs over the core read-only `owner-brief` type (daily, weekly, month-end brief). `fromSentence` says whether `jobsx.propose` is installed. |
| `approvals.proposeJob` | approve | `{ templateId, budgetMinor?: string, maxRuns?: 1..366, missedRun?: 'skip' \| 'run-once-on-wake' }` or `{ sentence: string }` | `{ id: 'job:<jobId>' }`, the queue id of a new job waiting for approval. The template path calls core `jobs.create` with `type: 'owner-brief'`, `reserveMinor = budgetMinor`, `stopRule { maxRuns, deadline: now + days }`, the interval of `every` (a month is 30 days), `catchup` `skip` or `latest`, and `requiresApproval: true`. `budgetMinor` is integer paise, more than zero and at most ten times the template budget (`INVALID_BUDGET`). A sentence passes through to `jobsx.propose`, or refuses `PROPOSAL_FROM_SENTENCE_NOT_BUILT`. Core job creation needs an owner or cofounder: an accountant or viewer is refused `FORBIDDEN`. |

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
JobMeters = { model: { spent: Amount; budget: Amount; route: string | null; estimate: boolean };   // route null: no model
  clock: { minutes: number } | { missing: 'not-counted' };   // counted only when the ledger records durations
  exposure: Amount }   // sum of amountMinor of prepared or approved actions the job names (ledger or deliverable actionIds); else { missing: 'not-counted' }
JobTemplate = { id; title; goal; doneWhen; type: 'owner-brief'; every: 'day' | 'week' | 'month'; budget: Amount;
  maxRuns: number; days: number; missedRun: 'skip' | 'run-once-on-wake'; actions: string[]; needsModel: false }
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
| `books.draft` | prepare | `{ name, definition: { label, meaning, kind, field, nulls, sign? } \| null, replaces?: draftId }` (`null` removes the word; `replaces`, or the caller's own open draft, is discarded in the same transaction) | `Draft` |
| `books.discard` | prepare | `{ draftId }` | `{ draftId, state: 'discarded' }`. Owners and cofounders discard any open draft; anyone else only their own uncosigned draft (`FORBIDDEN`). |
| `books.cosign` | prepare | `{ draftId, digest }` | `Draft` (a different person than the author; recorded by name and role) |
| `books.publish` | approve | `{ draftId, digest }` | `{ version; hash; staleAnswers: number }` (one release, everywhere at once) |
| `books.packs` | read | `{}` | `{ packs: { pack; label; state: 'in-use' \| 'available'; meanings: number }[] }` |
| `books.gst` | read | `{}` | `{ gstMode: string \| null; rates: { available: false } }` |
| `books.memory` | read | `{ outsideOnly?: boolean }` | `{ lines: MemoryLine[] }` |
| `books.remember` | admin | `{ text, kind }` | `MemoryLine` (told by owner) |
| `books.memoryEdit` | admin | `{ id, text }` | `MemoryLine` (earlier version kept) |
| `books.forget` | admin | `{ id }` | `{ id, deleted: true }` |
| `books.memoryConfirm` | admin | `{ id }` | `MemoryLine` |
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

Additions after the first build, kept additive to the shapes above:

- `books.draft` takes an optional `replaces: draftId`. It discards that open draft and writes
  the new one in one transaction. `approvals.change` on a `release:` item uses it.
- `approvals.drop` on an `acceptance:` item sends the result back (`jobs.reject`) rather than
  cancelling the job; its reply state is `rejected`.
- Bad payloads refuse `INVALID_APPROVAL` (Work) and `INVALID_BOOKS_REQUEST` (Books). Neither
  family uses `INVALID_REQUEST`, which screens read as "not built yet".

## Lane report

### What a person can do

**Work** (`#/work/...`)

- **Approvals** (WK-01): one queue over prepared actions, jobs waiting for approval, job
  results waiting for acceptance, meaning releases and lessons waiting for review. Tier 2
  (the always-waits list: money, messages to outsiders, deleting, irreversible) first, then
  tier 1, then prepare-only. Each row shows the tier word, what it touches, who prepared
  it, the amount from the prepared request and the time left. Expired items move to their
  own list and can no longer be approved.
- **The approval sheet** (WK-02): built from the prepared request only. Message text as it
  will be sent, before and after for a record change, the Tally voucher preview (prepare
  only), a proposed job's card and the Practice variant. Approve is bound to the exact digest;
  a changed request says "It changed. Prepared again." Money asks a second time. Not now,
  Change and Drop.
- **Grouped approval** (WK-03): two to ten tier-1 items, each with its own tick and its own
  approval and result. The pace warning appears after three approvals under two seconds.
  Anything on the always-waits list cannot be grouped.
- **After Approve** (WK-04): do once, read back, and show the five steps with their times.
  An unknown outcome offers Check again, It was sent and It was not sent. A person's answer
  is recorded as told by the owner and never marks the action verified. While any
  always-waits action is unknown, sending stays closed.
- **Actions** (WK-05): the time line of every action, with its request, the read-back
  compared field by field, the rule and who approved. Reverse prepares a new action only
  where the write catalogue declares a reversal.
- **What it can do** (WK-06): the catalogue, one row per action per system, with the eleven
  fields. Write-back rows join when the writeback lane is installed. "Not in the list yet"
  adds the request to the wanted list.
- **Jobs** (WK-07..WK-11): proposed jobs first, with state, next run, cost against budget
  and the limit of ten. The job card shows the goal, owner, budget, stop rule, actions,
  tested routes and the missed-run rule, followed by the time line and the result.
  Pause, Resume, Cancel, Approve, Accept and Send back go through the core `jobs.*`
  methods. Accepting is bound to the exact deliverable. The job sheet shows the budget as
  three meters: model use with its route (or "no model"), clock time and effect exposure;
  what is not counted says so in words. An owner or cofounder can Start a job from a
  ready-made brief (daily, weekly, month-end): its card, then the budget in rupees (turned
  into whole paise as text), the most runs and the missed-run rule. Propose creates the job
  waiting for approval and opens its approval sheet. "From one sentence" says not built
  until `jobsx.propose` is installed.
- **After a restore** (WK-15): actions that may have gone out, each with Check, and the
  sending-closed sentence.

**Books** (`#/books/...`)

- **Sources** (BK-01/02/06): one line per source, showing the way in, the last read and
  twelve month squares (loaded, not loaded yet, refused), plus the number of fields no
  recipe covers. The source sheet adds the reads, the refusals with their codes, the rows
  per kind and the unmapped fields with their type and fill rate. Remove calls the core
  `sources.delete` after asking again.
- **Meanings** (BK-07/08/10/19): the words, with where each came from and its state. A
  draft shows the old rule beside the new one, the change in words, the calculations and
  saved answers it affects, the checks and the reviews. Co-sign must come from a different
  person. Publish is one atomic release, bound to the reviewed dictionary hash.
  The page also shows starter packs and the GST mode.
- **Accounts** (BK-11): the chart of accounts from Tally ledger masters. A class is proposed
  from the parent group. With no group, Chausar says it is unsure and does not guess.
  Yes, No and Change are logged with the person and their role.
- **Customers and suppliers** (BK-12/13/14/20): search, then the record page. It shows each
  detail with its source, what the record owes (with a receipt), the time line, the
  agreement to reminders per channel, the stopped flag and what we hold.
  "Same customer or not" shows the evidence and joins with Undo; a hint never joins on
  its own. "Sources that disagree" shows both claims and lets the owner set precedence.
- **History** (BK-15/16): a figure as known on a date beside it as known now, each with its
  receipt. Versions show a correction differently from a new event. Stale answers have a
  quick and a full rebuild compared to the paisa.
- **Memory** (BK-17): what Chausar was told, with its kind, status, source and dates, and
  its earlier versions. There is a filter for outside content, which is remembered and
  never obeyed. Only the owner or a cofounder can add, edit, confirm or delete a line.

Every page has the common states: loading (the last value stays shown), empty, not built
yet, locked, read only (a viewer sees no control that changes anything), failed with its
code and Try again, stale and partial. Every page works in Simple, Guided and Books views,
in English and Hindi.

### Supported and experimental

| Feature | Label |
|---|---|
| Approvals queue, approval sheet, Not now / Change / Drop, after Approve, Actions record, After a restore (core `local` connector) | supported |
| Grouped approval and pace warning | supported (design marks WK-03 experimental) |
| Money second ask | experimental: the screen asks the person to type the amount; the passphrase, PIN or fingerprint ask belongs to the trusted host |
| Practice, catalogue rows from write-back, Reverse | experimental: depends on `writeback.*` (writeback lane); shows "not built yet" until it is installed |
| Job list, card, time line, accept and send back | supported over core `jobs.*`; job proposals from `jobsx.*` experimental |
| Start a job from a ready-made brief, budget meters | supported over core `jobs.create` (`owner-brief`); a job from one sentence is experimental (`jobsx.propose`) |
| Sources, month squares, source sheet, unmapped fields | supported for file imports; freshness from `connectorsx.*` experimental |
| Meanings, drafts, co-sign, publish, packs, GST mode | supported |
| Accounts proposals from Tally groups and decisions | supported; proposals from `learningx.*` experimental |
| Customers and suppliers, opt-in and stop, holdings, same-or-not, conflicts and precedence | supported |
| History as known on a date, versions, stale answers and rebuild | supported |
| Memory lines | supported |

"Supported" means tested end to end on synthetic data through the engine module and the
screen with a fake rpc. No screen was tested against a live external system.

### Engine methods

There are 24 `approvals.*` methods (`platform/runtime/work-books/work.ts`, `work-queue.ts`, `work-jobs.ts`)
and 33 Books methods (`books-*.ts`). They are listed in `app/desktop/module-methods/work-books.json`.
Private state lives in `state.extensions['work-books']` under `work` and `books` (`state.ts`).
`purge` removes snoozes, notes, opt-ins, decisions and memory lines tied to removed
sources and records.

The module needs no trusted start-up options (no credentials, endpoints or keys), so it does
not implement `hostOptions`. `host.options.hasMethod` and `host.options.clock` are test hooks only.

### Screens

`app/ui/src/places/lane-work-books.tsx` registers `workPlace` (`screens/work/`) and
`booksPlace` (`screens/books/`). The shared kit is in `screens/work/kit/`: checked replies,
refusal-to-state mapping, the page frame and bilingual words. Every reply is checked by
`screens/work/contract.ts` and `screens/books/contract.ts` before it is drawn.

### Still missing

- WK-12 (reminder notes on payment rules, caps), WK-13 and BK-18 (a bill photo to an
  entry), WK-14 (Chausar is driving) and WK-16 (a step for a person) are not built.
- WK-08 has no measure chart. Clock time is "not counted" until the core job ledger records
  durations, and effect exposure is "not counted" until a job names its actions (no core
  job does yet). Job Edit and Delete have no methods.
- Ready-made jobs repeat on an interval: "month-end" runs every 30 days from when it is
  approved, not on the last day of each month (calendar schedules need a typed runner).
- Prepare-only items have no "download the file and the checklist" method.
- BK-02 Read now, Pause and Sign in again; BK-03 Add a source; BK-05 recipes; BK-06
  "Map this field". These belong to connectors-ext and show "not built yet".
- BK-09 "Try it on a copy" links to trials and is not built here.
- BK-15 has no step line of the belief over time.
- BK-19 exchange rates and the BK-20 Delete (`deletion.request`) are not built.
- Memory lists only the lane's own lines, not business-profile entries.
- The lane's "sending closed" gate holds for `approvals.execute`. The core
  `actions.execute` does not check it; closing that needs a core edit.
- Phone approvals (WK-03 "Open the app") follow the core rule: the engine refuses approving
  methods from phone sessions.
