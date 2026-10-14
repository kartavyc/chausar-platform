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
`lesson:<lessonId>`, `acceptance:<jobId>`, `writeback:<actionId>` (a write-back action; see
"Write-back in Work" below).

```
ApprovalRow = {
  id: string; source: 'action' | 'job' | 'release' | 'lesson' | 'acceptance' | 'writeback';
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
  writeback?: WbExtra;          // write-back items only
  secondAsk?: { by: 'typed-amount' | 'passphrase' };   // present when needsSecondAsk
  reminder?: Reminder;          // WK-12: write-back customer reminders only (approvals.get / approve / change)
}
```

| Method | Permission | Payload | Reply |
|---|---|---|---|
| `approvals.list` | read | `{}` | `{ items: ApprovalRow[]; expired: ApprovalRow[]; snoozed: number; counts: { tier2: number; tier1: number; prepareOnly: number } }`, tier-2 first, then tier-1, then prepare-only; newest first inside a tier |
| `approvals.get` | read | `{ id }` | `ApprovalDetail` |
| `approvals.approve` | approve | `{ id, digest, secondAsk?: true, reauth?: string }` | `ApprovalDetail` after approval. Money (`needsSecondAsk`) refuses `SECOND_ASK_REQUIRED` without `secondAsk: true`. A changed digest refuses `PREVIEW_CHANGED`. Expired refuses `APPROVAL_EXPIRED`. `reauth` (1..1024 characters) is accepted only when the sheet says `secondAsk.by: 'passphrase'` (write-back declared it) and is passed to `writeback.approve`, never stored; missing then refuses `REAUTH_REQUIRED`; sent otherwise refuses `INVALID_APPROVAL`. |
| `approvals.notNow` | read | `{ id, hours?: 1..168 }` | `{ id, snoozedUntil }` (default 24 h; it leaves the list until then) |
| `approvals.change` | prepare | `{ id, payload }` | `ApprovalDetail` (a new revision, prepared again) |
| `approvals.drop` | approve | `{ id }` | `{ id, state: 'cancelled' \| 'rejected' }` (an acceptance is sent back: `rejected`) |
| `approvals.group` | read | `{ ids: string[] }` (2..10) | `{ title, undoable: true, items: ApprovalDetail[] }`. Refuses `GROUP_NOT_ALLOWED` if any item is tier-2 or prepare-only. |
| `approvals.approveGroup` | approve | `{ items: { id, digest }[] }` | `{ results: { id, ok: boolean, code?: string, state?: string }[] }`, one approval per item |
| `approvals.pace` | read | `{}` | `{ fastStreak: number; warn: boolean }` (warn after 3 approvals under 2 s each) |
| `approvals.practice` | prepare | `{ id }` | `{ practice: true; available: boolean; steps: Step[]; wouldSend: string \| null; code?: string; outcome?: string; requests?: number }`. A `writeback:` item runs `writeback.practice { actionId }` against fresh practice systems; `outcome` is write-back's (`would-be-done`, `would-be-not-sure`, `would-not-happen`, `already-done`, `prepare-only`, `refused`) and `requests` counts what would leave. Other items answer `available: false` with `PRACTICE_NOT_AVAILABLE` (or `WRITEBACK_NOT_BUILT` when write-back is absent). Nothing is sent either way. |
| `approvals.execute` | prepare | `{ id }` (an `action:` or `writeback:` id) | `ActionView` (do once). A `writeback:` id calls `writeback.execute` (look first, do once, read back) behind the same sending gate and reservation; when write-back sent nothing the reply carries `notice`. |
| `approvals.action` | read | `{ id }` | `ActionView` |
| `approvals.resolveUnknown` | approve | `{ id, result: 'check' \| 'was-sent' \| 'was-not-sent' }` | `ActionView`. `check` reads back first; the two person answers are recorded as told-by-owner. For a `writeback:` id: `check` → `writeback.readBack`, the answers → `writeback.settle { said: 'sent' \| 'not-sent' }` (write-back reads the system first; a person's word settles only what it cannot show). |
| `approvals.ledger` | read | `{}` | `{ items: ActionView[] }` newest first (WK-05), core actions and `writeback.ledger` merged |
| `approvals.reverse` | approve | `{ id }` | `ApprovalDetail` of a new prepared reversing action, or refuses `REVERSAL_NOT_AVAILABLE` (always for `writeback:` ids: write-back states its reversal in words) |
| `approvals.catalogue` | read | `{}` | `{ rows: CatalogueRow[]; writeback: { available: boolean } }` |
| `approvals.catalogueEntry` | read | `{ system, action }` | `CatalogueEntry` |
| `approvals.wanted` | prepare | `{ system: string; text: string }` | `{ id; at; writeback: 'listed' \| 'counted' \| null }`. When the system names a write-back system (by id or title), it is also asked of `writeback.request` (counted on write-back's wanted list). |
| `approvals.wantedList` | read | `{}` | `{ items: { id; system; text; at; by }[] }` |
| `approvals.afterRestore` | read | `{}` | `{ sendingClosed: boolean; items: ActionView[]; notes: string[] }`. Includes write-back actions that are not sure, still running, or named by `writeback.afterRestore` (the send journal outside the vault); those close sending too. |
| `approvals.exportPrepared` | prepare, desktop only | `{ id }` (a prepare-only item) | `{ files: { name; path; bytes }[] }`: the exact prepared payload as JSON (for `gst-portal return.file`, the return: form, GSTIN, period and the prepared command) and a plain-text checklist, written into `<app directory>/exports/` as `chausar-prepared-<YYYYMMDD-HHMMSSZ>-<digest12>[-n]-prepared.json` / `-checklist.txt`. Names never come from outside text; an existing file is never replaced. Refuses `NOT_PREPARE_ONLY`, `INVALID_APPROVAL_STATE`, `OPEN_DESKTOP` (phone or MCP). |
| `approvals.prepareReminder` | prepare | `{ connectionId, customerId, invoiceId, language?: 'en' \| 'hi' }` | `{ id: 'writeback:<id>' \| null; blocked: { code; reason } \| null }`. Calls `writeback.followUp.prepare`; a refusal `FOLLOW_UP_NO_CONSENT`, `FOLLOW_UP_STOPPED`, `FOLLOW_UP_DAILY_CAP`, `FOLLOW_UP_NOTHING_DUE` or `FOLLOW_UP_NEEDS_REVIEW` comes back as `blocked` with its plain reason (blocked at prepare). Refuses `WRITEBACK_NOT_BUILT` without write-back. |
| `approvals.jobs` | read | `{}` | `{ items: JobRow[]; active: number; limit: 10; proposals: { available: boolean } }` |
| `approvals.job` | read | `{ id }` | `JobCard & { timeline: JobStep[]; result: JobResult \| null; meters?: JobMeters }` (WK-08 budget meters; see below) |
| `approvals.jobTemplates` | read | `{}` | `{ templates: JobTemplate[]; fromSentence: { available: boolean } }`. Fixed ready-made jobs over the core read-only `owner-brief` type (daily, weekly, month-end brief). `fromSentence` says whether `jobsx.propose` is installed. |
| `approvals.proposeJob` | approve | `{ templateId, budgetMinor?: string, maxRuns?: 1..366, missedRun?: 'skip' \| 'run-once-on-wake' }` or `{ sentence: string }` | `{ id: 'job:<jobId>' }`, the queue id of a new job waiting for approval. The template path calls core `jobs.create` with `type: 'owner-brief'`, `reserveMinor = budgetMinor`, `stopRule { maxRuns, deadline: now + days }`, the interval of `every` (a month is 30 days), `catchup` `skip` or `latest`, and `requiresApproval: true`. `budgetMinor` is integer paise, more than zero and at most ten times the template budget (`INVALID_BUDGET`). A sentence passes through to `jobsx.propose { sentence }` when it is installed (no probe), or refuses `PROPOSAL_FROM_SENTENCE_NOT_BUILT`; jobs-ext replies a proposal, so the reply adds `proposal: { id, digest }` (see Still missing). Core job creation needs an owner or cofounder: an accountant or viewer is refused `FORBIDDEN`. |

```
ActionView = { id; system; action; title; touches: string | null; amount: Amount | null;
  state; steps: Step[]; approvedBy: string | null; channel: 'desktop' | 'phone' | 'mcp' | null;
  request: Record<string, string>;                    // flattened request fields, as text
  readBack: { field: string; asked: string; found: string | null; same: boolean }[] | null;
  rule: string; attestation: { by: string; said: 'was-sent' | 'was-not-sent'; at: string } | null;
  wouldHaveDone: 'waited' | 'done' | null; createdAt; settledAt: string | null; can: ('execute' | 'reconcile' | 'resolve' | 'reverse')[];
  writeback?: WbExtra; notice?: { kind: string; message: string } }   // notice: after a write-back execute that sent nothing
CatalogueRow = { system; systemTitle; action; title;
  kind: 'inside-undoable' | 'seen-outside' | 'money' | 'cannot-undo';
  waits: boolean; status: 'live' | 'experimental' | 'prepare-only' | 'not-yet'; source: 'core' | 'writeback';
  qualification?: 'synthetic-tested' | 'sandbox-verified' | 'live-verified' | 'unqualified' | null; writeScore?: string | null }   // null for core rows
CatalogueEntry = CatalogueRow & { description; idempotency; readBack; retryWindow: string | null;
  tier: 'tier-1' | 'tier-2'; expires: string | null; readStatus: string | null;   // the eleven fields
  // write-back rows also carry:
  waitsBecause?: string | null; plannedStatus?: status | null; businessReference?: string | null; approvalLifetime?: string | null;
  reviewedOn?: 'YYYY-MM-DD' | null; installed?: boolean; grants?: number; undo?: string | null;
  connections?: { id; label; environment: 'live' | 'sandbox' | 'practice'; read: boolean; write: boolean }[] }
WbExtra = { system; action; systemTitle; catalogueKind: CatalogueRow['kind']; waitsBecause: string;
  connection: { label; environment; removed: boolean } | null; notices: { kind; at }[]; externalId: string | null; settledBy: 'person' | 'system' | null }
Reminder = { customerId: string | null; invoiceId: string | null; channel: 'email' | 'whatsapp' | null;
  asWritten: string | null; invoiceLink: string | null; outstanding: Amount | null;
  notes: { id; text: { en; hi }; source: string; checkedOn: 'YYYY-MM-DD'; notLegalAdvice: true }[] | null;   // owner only; null for every other seat
  agreement: { channel: 'email' | 'whatsapp'; answer: 'yes' | 'no' | 'not-asked'; source: string | null; on: 'YYYY-MM-DD' | null }[];   // both channels
  stoppedOn: 'YYYY-MM-DD' | null;
  caps: { perCustomer; perDay; day: string | null; preparedOnDay; customerOnDay; reached: boolean; customerReached: boolean } | null;
  blocked: { code; reason } | null }   // the customer's agreement on this channel is no longer yes, or they said stop
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

#### Write-back in Work

Write-back actions live in write-back's own ActionService registry, so the core `actions.list`
never shows them. Work reads them as the same caller through `writeback.ledger` (and
`writeback.followUp.consents`, `writeback.settings`, `writeback.afterRestore`) and joins them to
the one queue and the one record as `source: 'writeback'`, id `writeback:<actionId>`:

- Row: tier from the catalogue (`1` → `tier-1`, `2` → `tier-2`, prepare-only), kind (money,
  message, record change, prepare only), title from the catalogue row, `touches` = system title
  and the prepared target, the amount from the prepared payload (`amountMinor`, `priceMinor`) or
  the reminder's outstanding balance, `preparedBy` (a reminder is prepared by the job "Invoice
  follow-up"), write-back's own `expiresAt`, and `practice` for practice connections.
- Sheet: the exact change from `view.approval.change`, the five steps mapped to the queue's step
  words, `reason` from the catalogue kind, `needsSecondAsk` from write-back (money and cannot be
  undone), `writeback` (system, connection, the catalogue's own "why it waits", notices),
  `blocked` (`OUTCOME_UNKNOWN`, `PREPARED_AGAIN`, `EVIDENCE_CHANGED`, or the reminder block).
  Change is offered for a plain mail (its body, `{ asWritten }`); anything built from evidence is
  prepared again instead.
- Mutations: approve → `writeback.approve { id, digest }` (+ `reauth` only when declared);
  change → `writeback.change`; drop → `writeback.drop`; practice → `writeback.practice
  { actionId }`; execute → `writeback.execute`; check → `writeback.readBack`; was sent / was not
  sent → `writeback.settle`. Re-authentication: write-back does not declare one yet (no `reauth`
  field on its views), so money keeps the typed-amount second ask. When a view's approval
  carries `reauth: 'passphrase'`, the sheet asks for the passphrase instead and passes it through.
- Catalogue: rows are read in write-back's real shape (status, qualification, write score,
  connections and grants, and the eleven fields). A reversal named in words is shown as `undo`;
  it becomes `approvals.reverse` only when it names an action of the same system.
- Reminders (WK-12): the payment notes are a fixed list in `work-writeback.ts`, written by hand
  and never by a model: the MSMED Act, 2006 sections 15 and 16 (pay a micro or small supplier
  within 45 days; compound interest at three times the bank rate), and the Income-tax Act, 1961
  section 43B(h) (deduction only in the year paid when paid late). Each carries its source, the
  date it was checked (2026-10-14) and "not legal advice", and only the owner sees them.

Mutations on jobs use the core methods directly: `jobs.pause`, `jobs.resume`, `jobs.cancel`,
`jobs.approve { id, digest }`, `jobs.accept { id }`, `jobs.reject { id, reason }`.

### Work: jobs, round 2 (WK-07, WK-08, WK-11, WK-14, WK-16)

All additive. `approvals.job` adds these fields to its reply:

```
JobStep, a step for a person (WK-16) = JobStep & {
  event: 'person-step'; kind: 'person'; stepId: string; what: string;
  who: { kind: 'you' | 'person'; name: string; memberId: string | null };
  done: boolean; doneAt: string | null; doneBy: string | null; canDone: boolean }
  // open person steps lead the time line, done ones come last; core rows carry no `kind`
measure: { name: string; goal: Amount; goalReceiptId: string | null;
  points: { at: string; value: Amount; receiptId: string }[] } | null          // WK-08
schedule: { kind: 'interval'; everyDays: number | null; everyMs: number }
        | { kind: 'calendar'; rule: 'month-end' | 'calendar'; at: string | null; timeZone: string; paused: boolean }
missedRun: 'skip' | 'run-once-on-wake'   // replaces the card's value: a calendar keeps its own rule; jobs-ext 'all' reads 'run-once-on-wake' here
missedRule: { rule: 'skip' | 'run-once-on-wake' | 'run-all'; choices: (same)[];
              runAll: 'offered' | 'unsuitable' | 'not-built' }   // WK-11; 'run-all' only through jobs-ext
manage: { edit: 'jobsx' | 'core' | 'not-built'; delete: 'jobsx' | 'cancel';
          missedRule: 'jobsx' | 'core' | 'not-built'; personStep: 'jobsx' | 'not-built' }
jobsx: { title: string | null; state: string | null; reason: string | null;
         steps: { kind; title; needsModel: boolean }[];                  // the ready-made card's steps
         questions: { id; prompt; options: string[]; askedAt: string | null }[];
         missed: { text; at } | null; leftUndone: string[] } | null       // null for a core job
meters, result                                                          // replaced for a lane job, see below
```

**Lane jobs and core jobs.** jobs-ext (`claude/lane-jobs-ext`, `platform/runtime/jobs-ext/methods.ts`) runs its jobs as
core jobs of type `jobsx-<template>` (its `isLaneJob`), and every `jobsx.*` job method refuses any other job. So a
`jobsx.*` method is used only for a lane job and only when the method registry (or a trusted host's `hasMethod`) lists
it; it is never probed. A core job (the ready-made briefs, the month-end calendar job) keeps the core-only paths even
with jobs-ext installed.

- For a lane job, `approvals.job` reads `jobsx.get { id }` (`{ ...view, facts: { goal, progress: { stepsDone,
  stepsPerDelivery, casesOpen, casesClosed }, budget: budgetView, stops }, steps, waitingForYou, timeline, next,
  missedRule: 'skip' | 'once' | 'all', leftUndone, ... }`) and `jobsx.result { id }` (a `LaneResult`; `NO_RESULT` reads
  as none):
  - person steps are the `waitingForYou` rows of kind `person-step` (`{ id, jobId, title, assignee, status: 'waiting',
    createdAt }`); `assignee` is a member id. jobs-ext lists only waiting steps, and only the job's pinned owner may mark
    one (`canDone`);
  - the time line is jobs-ext's own (oldest first): `event` is its fixed text, `amount` its `costMinor`, `needsModel`,
    `reason` its `code`;
  - `meters` come from jobs-ext's measured `budgetView`: model spent and budget, the routes it used (`estimate` when a
    route's basis is `estimate`), clock time from `clockMs`, exposure from `exposureMinor`;
  - `result` is `jobsx.result`'s `done`, `open` and receipts (`receiptIds` and each figure's `receiptId`);
  - `missedRule` maps `skip | once | all` to `skip | run-once-on-wake | run-all`. "Run every missed one" is offered only
    when `facts.progress.stepsPerDelivery` is 1; for daily rounds it is `unsuitable` (jobs-ext refuses it
    `MISSED_RULE_UNSUITABLE`).
- For a core job, person steps come from a core plan step whose `kind` or `provider` is `person` with `input { what,
  memberId?, who? }`; a ledger entry `{ event: 'person-step-done', stepId, by? }` reads as done. Nothing in this lane
  marks a step done.
- The measure's points are the calculation receipts the job names (its deliverable, its runs' evidence, its ledger
  `receiptId`, and for a lane job the `receiptIds` on its jobs-ext time line and in its delivered result), read with
  `calculator.receipt` as the caller. A receipt that exists but the caller cannot read is a point `{ missing: 'withheld'
  }`; an id that is not a calculation receipt is ignored. The operation with the most points is the measure. jobs-ext
  declares no measure goal, so the goal is the plan input's `measure.goalMinor`, else `{ missing: 'absent' }`
  (`goalReceiptId` is then null). `null` when no readable receipt is named. The screen draws the goal as a rule only
  when it has a receipt; otherwise it writes it beside the chart.
- `approvals.jobs` reads `jobsx.list` when installed (else `jobsx.proposals`): `proposals` becomes `{ available: true,
  items: { id, title, origin, replacesJobId: string | null, evidence: string[], digest }[] }` (an edit has `origin:
  'edit'` and names the job it replaces), and a lane job's row takes jobs-ext's label (`set-aside`, `stopped-by-rule`,
  `result-waiting` → `awaiting-acceptance`, `waiting-for-you` / `waiting-network` → `waiting` with that reason). With
  neither installed it stays `{ available: false }`.

| Method | Permission | Payload | Reply |
|---|---|---|---|
| `approvals.personStepDone` | approve | `{ jobId, stepId }` | `{ jobId, stepId, done, doneAt, doneBy }` from jobs-ext's step record (`doneBy` named). Calls `jobsx.personStep.done { id: stepId }` (approve, the job's pinned owner); refuses `PERSON_STEP_NOT_BUILT` for a core job or without it, `PERSON_STEP_ALREADY_DONE`, `PERSON_STEP_NOT_YOURS`, `INVALID_JOB_REPLY`. |
| `approvals.editJob` | approve | `{ id, config: { budgetMinor?, maxRuns?: 1..366, missedRun?: 'skip' \| 'run-once-on-wake' \| 'run-all' } }` | Lane job: `jobsx.edit { id, changes: { budgetMinor?, reserveMinor?, missedRule? } }` proposes a new card (`reserveMinor` is lowered to the budget when it would exceed it) and replies `{ id: 'job:<id>', via: 'jobsx', waitsFor: 'proposal', proposal: { id, digest } }`: the job keeps its card until that proposal is approved, and the proposal is listed in `approvals.jobs`. `maxRuns` is not a jobs-ext card field: `JOB_EDIT_FIELD_NOT_BUILT`. Core: for a typed job only, `jobs.amend` with the whole objective (and `jobs.calendar.configure` for a calendar's missed rule), replying `{ id, via: 'core', waitsFor: 'approval', proposal: null }`; a read-only brief refuses `JOB_EDIT_NOT_BUILT`; `run-all` refuses `MISSED_RULE_NOT_BUILT`. Bad fields: `INVALID_JOB_CHANGE`, `INVALID_BUDGET`, `STOP_RULE_REQUIRED`, `INVALID_SCHEDULE`. |
| `approvals.deleteJob` | approve | `{ id }` | `{ id, state: 'deleted' \| 'cancelled', note: null \| 'cancel-keeps-record' }`. Lane job: `jobsx.delete { id }` (jobs-ext's `jobs.remove`); otherwise core `jobs.cancel`: the job stops and its record is kept. |
| `approvals.setMissedRule` | approve | `{ id, rule: 'skip' \| 'run-once-on-wake' \| 'run-all' }` | `{ id: 'job:<id>', missedRun, via, waitsForApproval }`. Lane job: `jobsx.setMissedRule { id, rule: 'skip' \| 'once' \| 'all' }`, applied at once (`waitsForApproval: false`); `MISSED_RULE_UNSUITABLE` passes through for daily rounds. Core: a typed job's `jobs.amend` (`catchup`) or calendar revision (`missed` `skip` with 6 h grace, or `coalesce`), waiting for a new approval; `run-all` and a read-only brief refuse `MISSED_RULE_NOT_BUILT`. |
| `approvals.drivingStatus` | read | `{}` | `{ available: false, rules }`, or `{ available: true, rules, status: DrivingStatus, windows: { id, title, app }[] }` from `session.status` and `session.windows` |
| `approvals.drivingStart` | approve | `{ windowId }` | the same from `session.start { windowId, mode: 'read-export', typesSecrets: false }`; refuses `SESSION_WINDOW_CHANGED` if the session reports another window |
| `approvals.drivingContinue` | prepare | `{}` | the same from `session.resume` |
| `approvals.drivingStop` | prepare | `{}` | the same from `session.stop` |

```
DrivingStatus = { state: 'idle' | 'driving' | 'sign-in' | 'paused-by-you' | 'stopped-by-key' | 'stopped' | 'step-failed' | 'done';
  window: { id; title } | null; steps: { at; text; state: 'done' | 'running' | 'failed' }[]; reason: string | null }
rules = { windows: 1, mode: 'read-export', typesSecrets: false }
```

A session reply that does not fit refuses `INVALID_SESSION_REPLY`. No lane provides `session.*` yet.

Month-end on the calendar: `approvals.jobTemplates` adds `monthEnd: { available }` and each template a `schedule:
'interval' | 'month-end'`. `approvals.proposeJob` takes `schedule?: 'month-end' | 'every-30-days'` (the month-end brief
only; default `month-end`) and replies `{ id, schedule }`. Month-end is made only where the core can schedule it
(`jobs.types` lists `calculation-set` and `calendar.configured`). It is then a typed `calculation-set` job with one
request (`{ operation: 'aging' }`: what customers owe, with its receipt), pinned to the sources the caller may read, and
a `CalendarDefinition` for the last day of each month (`monthly`, `dayOfMonth: 31`, `missingDate: 'last-day'`) at 18:00
`Asia/Kolkata`, `identityBasis: 'local-month'`, missed `skip` (6 h grace) or `coalesce`. Otherwise it refuses
`CALENDAR_SCHEDULE_UNAVAILABLE` (also when the core refuses the calendar), `MONTH_END_CALCULATION_UNAVAILABLE` or
`NO_BOOKS_LOADED`. "Every 30 days, not month-end" is the old interval path and runs only when the person chooses it.

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
| `books.gst` | read | `{}` | `{ gstMode: string \| null; rates: { available: true } }` (the table is `books.rates`, BK-19) |
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
| `history.beliefLine` | read | `{ operation, period: { from, to }, from: instant, to: instant }` (`to` not in the future) | `{ operation; period; from; to; points: { at; value: Amount; receiptId; changes: ('start' \| 'correction' \| 'new-event' \| 'join' \| 'undo')[] }[]; omitted: number }`. The first point is the start of the window; then one point per instant in the window where a fact dated inside the period was learned or replaced, or customers were joined or a join undone. Each point's value is a real calculator run at that `asOf`, with its receipt. At most 24 points: older changes beyond the bound are counted in `omitted`. (BK-15) |
| `records.optIn` | read | `{ customerId }` | `{ channels: { channel: 'mail' \| 'whatsapp'; agreed: 'yes' \| 'no' \| 'not-asked'; source: string \| null; at: 'YYYY-MM-DD' \| null; stoppedAt: 'YYYY-MM-DD' \| null }[] }` from the lane's consent register (`records.setOptIn`, `records.stop`). `at` is the date of the answer, `stoppedAt` the date of the latest stop word. Same visibility as `records.get` (`RECORD_NOT_FOUND`). Used by jobs-ext; keep the name stable. |
| `records.deletionPlan` | read | `{ id }` | `{ recordId; canDelete: boolean; sourceDeletion: { available: boolean }; stores: { store; count; state: 'can-delete' \| 'needs-owner' \| 'nothing-held'; reason: string \| null }[] }` (BK-20). `sourceDeletion` says whether `trustx.deletions` is installed. |
| `records.delete` | approve | `{ id, confirmation }` (`confirmation` must equal `id`) | `DeletionReport`. Deletes what this lane keeps about the customer and every id joined with it: agreements and stop words, same-or-not decisions, memory lines naming it. Each store is counted again after deleting; only a store found empty is `deleted`. Core stores (facts, receipts, answers, actions, conversations) are `not-possible`, with the reason and who can remove them. Refuses `CONFIRMATION_REQUIRED`, `TAINTED_APPROVAL`, and `DELETION_NOT_AVAILABLE` when only core stores hold something. Deleting is on the always-waits list: the typed id is the person's yes. |
| `records.deletions` | read | `{}` | `{ reports: DeletionReport[] }`, newest first |
| `books.rates` | read | `{}` | `{ rates: { currency; on: 'YYYY-MM-DD'; rate: { units: string; per: string }; source; enteredBy; at }[]; notCounted: { currency; rows: number }[] }` (BK-19). `rate` is exact: `units` rupees for `per` units of the currency, both whole-number strings (83.2150 INR per USD is `{ units: '832150', per: '10000' }`). `notCounted` counts visible facts in another currency, not converted when read, with no rate for their date. Nothing is converted here. |
| `books.setRate` | admin | `{ currency: 'AAA', on, rate: { units, per }, source }` | the rate row; replaces the rate for the same currency and date. Never fetched. |
| `books.removeRate` | admin | `{ currency, on }` | `{ currency; on; removed: true }` or `RATE_NOT_FOUND` |
| `books.billRead` | prepare | `{ bytesBase64, mime: 'application/pdf' \| 'image/png' \| 'image/jpeg' }` (at most 4 MB) | `BillRead` (WK-13/BK-18, experimental). Reads locally through the Python helper's `pdf.ocr`; a PNG or JPEG is first wrapped as a one-page PDF in memory. Nothing is stored. Refuses `OCR_DEPENDENCY_UNAVAILABLE` (no helper, no Python or no tesseract), `IMAGE_OCR_NOT_AVAILABLE` (a picture layout the wrapper cannot carry), `NOT_AVAILABLE_WITH_SEND_SETTING` (the same while send is `nothing`), `BILL_TOO_LARGE`, `INVALID_BILL_FILE`, `BILL_READ_FAILED`, `TAINTED_REQUEST`. |
| `books.billConfirm` | prepare | `{ readId, digest, fields: { supplier, billNumber, date, lines: { description, quantity, amountMinor }[], tax: { name, amountMinor }[], totalMinor }, zoho?: { connectionId, vendorId } }` | `BillView`. The person's corrected fields, bound to the digest of the reading they saw (`PREVIEW_CHANGED`; `BILL_READ_EXPIRED` after 30 minutes, after a restart or for another person). Lines plus tax must equal the total exactly (BigInt) or `BILL_TOTAL_MISMATCH`; a missing field is `BILL_FIELD_MISSING`. With `zoho` it calls `writeback.prepare` (`zoho-books`, `bill.createFromPhoto`; `WRITEBACK_NOT_BUILT` when writeback is absent); without it, it prepares a Tally purchase voucher, prepare only. Either way the bill waits in the approvals queue as `bill:<id>`. |
| `books.bills` | read | `{}` | `{ bills: BillView[] }`, newest first |
| `books.billBook` | prepare | `{ id }` | `BillView` after `writeback.execute` (or `writeback.readBack` when unsure) for an approved Zoho bill. A Tally bill refuses `PREPARE_ONLY`. |

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
BillField = { value: string | null; certainty: 'sure' | 'check-this' | 'could-not-read'; region: { page; line; of } | null }
                                  // amounts are whole paise as text; region is the line on the page (the reader gives no word boxes)
BillRead = { readId; digest; mime; stored: false; expiresAt; untrusted: true;
  reader: { engine: 'tesseract'; version; pages: number; confidence: number };      // lowest page confidence, 0-100
  supplier: BillField; billNumber: BillField; date: BillField; total: BillField;
  lines: { description: BillField; quantity: BillField; amount: BillField }[]; tax: { name: BillField; amount: BillField }[];
  sums: { linesPlusTax: Amount; total: Amount; equal: boolean | null };               // null when an amount could not be read
  routes: { zohoBooks: { available: boolean; connections: { id; label }[] }; tallyPreview: { available: true } } }
BillView = { id; approvalId: 'bill:<id>'; route: 'tally-preview' | 'zoho-books'; state: RowState; supplier; billNumber; date;
  lines: { description; quantity; amount: Amount }[]; tax: { name; amount: Amount }[]; total: Amount;
  voucher: { type: 'Purchase'; number; date; lines: { ledger; debit: Amount | null; credit: Amount | null }[]; note: 'prepare-only' } | null;
  writeback: { id } | null; createdAt; by }
DeletionReport = { id; recordId; at; by; complete: boolean;
  rows: { store; count; state: 'deleted' | 'pending' | 'not-possible' | 'nothing-held'; reason: string | null }[] }
```

Additions after the first build, kept additive to the shapes above:

- `books.draft` takes an optional `replaces: draftId`. It discards that open draft and writes
  the new one in one transaction. `approvals.change` on a `release:` item uses it.
- `approvals.drop` on an `acceptance:` item sends the result back (`jobs.reject`) rather than
  cancelling the job; its reply state is `rejected`.
- Bad payloads refuse `INVALID_APPROVAL` (Work) and `INVALID_BOOKS_REQUEST` (Books). Neither
  family uses `INVALID_REQUEST`, which screens read as "not built yet".
- Round 2 (additive): the approvals queue has a sixth source, `bill` (ids `bill:<billId>`). A
  Tally bill is `tier: 'prepare-only'`, `kind: 'prepare-only'` with its `voucher`; it can only
  wait or be dropped. A Zoho bill is `tier-1`, `kind: 'record-change'`; its `digest` is the
  writeback action's digest, `approvals.approve` passes it to `writeback.approve` and
  `approvals.drop` calls `writeback.drop`. Its fields are listed in `change.fields`; it expires
  after 7 days. **Screens that check `source` must accept `'bill'`**: `screens/work/contract.ts`
  lists five sources today, so the coordinator adds the sixth when wiring `#/work/bill`.

### Books, round 2: connections, add a source, recipes, map a field, a change on a copy, profile memory

The Books side now calls the connectors-ext lane (`connectorsx.*`), the learning-ext lane
(`learningx.recipePropose`, `learningx.recipeSave`) and the core `trials.*` and
`business.profile.*` methods, as the same caller. Every reply from another lane is checked field
by field and copied into the shapes below (`books-connectors.ts`), never passed through. A
reader whose lane is missing answers `available: false`; a changer refuses
`CONNECTORS_NOT_INSTALLED` or `RECIPE_PROPOSALS_NOT_INSTALLED`. Refusals from the other lane
pass through unchanged (for example `DEMO_EXTERNAL_DISABLED`, `OAUTH_CLIENT_REQUIRED`,
`CREDENTIAL_NOT_ACCEPTED`).

Additive fields on existing replies:

- `SourceRow` gains `connection?: { connectionId; group; road: 'interface' | 'file' | 'database'; status: 'active' | 'paused' } | null`,
  `lastFailure?: { at; code: string | null } | null` and `stale?: boolean` (past its freshness target).
  `books.sources` now lists connections without an import yet, and reads from the connector
  factory. A month is `loaded` when either side holds facts, `loading` when an accepted read of
  that month waits to be imported, `failed` when the read itself failed, `refused` when it was
  refused or asked a question. Every id passes the core source rule (`sourceVisible`).
  `freshness.available` is true when any connector method answered.
- `books.source` gains `connectors: { available }`, `connection: (ConnectionView & { operations: { id; label; limitation; live }[] }) | null`
  and `envelopes: EnvelopeView[]` (the history of reads, newest first, at most 50).
- `books.unmapped` rows gain `origin: 'file' | 'connector'`, `recipeId: string | null` and
  `mappable: boolean`. Connector fields (from `connectorsx.unmapped`) have type `unknown` and no
  fill rate; they belong to a registered recipe and are not mapped here.
- `MemoryLine` gains `origin?: 'business-profile'`, `field?: string` and `readOnly?: boolean`.
  `books.memory` appends the business profile's entries (core `business.profile.history`): one
  line per version chain, kind `claim`, status `told-by-owner` (or `corrected` with its earlier
  versions, or `assumed` for a draft assumption), source `told-by-owner` (or `outside-content`
  when it was recorded by tainted work). Their ids are `profile:<profileId>`.
  `books.forget` on such a line calls `business.profile.remove` (the whole chain);
  `books.memoryEdit` and `books.memoryConfirm` refuse `PROFILE_LINE_READ_ONLY`.

```
ConnectionView = { connectionId; sourceId; group; road: 'interface' | 'file' | 'database'; label; company; branch; status: 'active' | 'paused' }
EnvelopeView = { id; sourceId; at; operation; recipeId; recipeVersion; status: 'accepted' | 'refused' | 'abstained' | 'failed';
  refusal: { code; reason } | null; abstention: { reason; field; question; options: string[] } | null;
  period: { from; to } | null; rows: number; excludedRows: number;
  total: { measure: 'money' | 'count'; unit: string; ours: string | null; theirs: string | null; match: 'yes' | 'no' | 'unavailable' };  // exact integer text; money in paise
  checks: { id; status: 'passed' | 'failed' | 'unavailable' }[]; unmappedFields: string[]; notices: string[];
  waiting: boolean;   // accepted and not imported yet: Import is offered
  committed: { at; rows: number; duplicate: boolean } | null }
SystemRow = { id; name; family; depth: 'full' | 'read' | 'import' | null; available: boolean;
  status: 'tested' | 'experimental' | 'planned' | 'not-possible'; tier: 'supported' | 'experimental' | 'planned'; liveVerified: boolean;
  evidence: { synthetic: number; madeToOrder: number; realWithConsent: number };
  ways: ('interface' | 'file' | 'database')[]; signIn: { method: 'browser' | 'key' | 'none'; note: string | null };
  settings: string[];   // the non-secret settings its interface read takes
  operations: { id; label; depth; road; status; tier; limitation; evidence }[] }
RecipeRow = { id; version; system; operation; title; state: 'seed' | 'tested' | 'not-yet-tested' | 'failed'; totals: string; measure: 'money' | 'count'; lastReadAt: string | null }
ProposalView = { id; sourceId; field; target: string | null; origin: 'library' | 'person'; state: 'proposed' | 'accepted' | 'declined' | 'published';
  proposedBy; at; valid: boolean; fieldBound: boolean; digest: string | null; scope: { system; company; branches: string[] } | null;
  bindings: { target; source: string | null; type; state: 'accepted' | 'proposed'; acceptedBy: { by; role; at } | null;
    grade: 'model' | 'owner' | 'accountant' | 'ca' | 'reconciled' | null; change: 'same' | 'new' | 'changed' }[];
  dropped: string[]; issues: { path; code }[]; removed: { path; code }[]; missingTargets: string[];
  decided: { by; role; at } | null; libraryId: string | null; baseChanged: boolean }
TrialCell = { value: Amount; refused: string | null; receiptId: string | null;   // receiptId: the live saved answer's receipt ("now" only)
  receipt: { operation; period; counted: number; excluded: number; definitions: string[]; completeness: string } | null }   // the copy's receipt, shown in place
TrialView = { trialId; draftId: string | null; proposalId: string | null; experimental: true; status: 'created' | 'evaluated';
  change: { type; target }; cost: { preparationMs: number; diskBytes: number }; evaluationDigest: string | null;
  rows: { answerId; operation; period; now: TrialCell; withChange: TrialCell; differs: boolean }[];
  impact: { digest; strategy: 'prospective'; affectedAnswers: number; rebuild: number; activeWork: number } | null; impactCode: string | null; limitations: string[] }
```

| Method | Permission | Payload | Reply |
|---|---|---|---|
| `books.systems` | read | `{ group? }` | `{ available: boolean; systems: SystemRow[] }` (`connectorsx.systems`) |
| `books.connect` | admin | `{ group, road: 'interface' \| 'file' \| 'database', company, branch?, label?, settings? }` | `ConnectionView` (`connectorsx.connect`; a setting named like a credential refuses `CREDENTIAL_NOT_ACCEPTED` before the call) |
| `books.pause` | admin | `{ sourceId, paused: boolean }` | `ConnectionView` |
| `books.disconnect` | admin | `{ sourceId }` | `{ sourceId; removed: boolean; factsKept: boolean }` (facts stay until `sources.delete`) |
| `books.signIn` | admin | `{ sourceId, operation? }` | `{ sourceId; method: 'browser'; url: string; expiresInSeconds; note }` (an `https:` address shown as text; the screen never opens it) or `{ sourceId; method: 'key' \| 'none'; instruction }` |
| `books.readNow` | prepare | `{ sourceId, operation, period?, reportTotals?: { total }, parameters? }` | `EnvelopeView` (`connectorsx.read`; a file source refuses `CONNECTION_REQUIRED`) |
| `books.importRead` | prepare | `{ envelopeId }` | `EnvelopeView` after `connectorsx.importCommit` (a read the caller cannot see refuses `ENVELOPE_NOT_FOUND` first) |
| `books.discardRead` | prepare | `{ envelopeId }` | `EnvelopeView` after `connectorsx.discard` |
| `books.recipes` | read | `{ group? }` | `{ available; recipes: RecipeRow[]; proposals: { id; sourceId; field; state; proposedBy; at; valid }[] }` |
| `books.recipe` | read | `{ recipeId }` | `{ recipe: RecipeRow; scope: { system; company; branch; gstin: null; period }; bindings: { meaning; headings: string[]; type; required; state: 'seed'; acceptedBy: null; grade: 'reconciled' \| null }[]; check: { envelopeId; at } & EnvelopeView['total'] \| null; questions: { envelopeId; sourceId; at; reason: 'value-not-in-list' \| 'binding-not-settled' \| 'not-known-whether-applies' \| 'check-failed' \| 'too-little-evidence'; detail; field; question; choices: string[]; ours; theirs; measure; unit }[]; newer: { readWith; current } \| null; notices: string[]; sourceIds: string[] }` |
| `books.mapField` | prepare | `{ sourceId, field, target?, type?: 'string' \| 'money' \| 'date' \| 'integer' \| 'boolean', dateFormat?, moneyUnit? }` | `ProposalView`. The file import's own recipe plus one binding for the field goes to `learningx.recipePropose` as the candidate (without `target`, the library's best match). Only a field of a file import that no binding covers (`FIELD_NOT_UNMAPPED`, `MAP_FIELD_NOT_AVAILABLE`). |
| `books.proposal` | read | `{ id }` | `ProposalView` |
| `books.decideProposal` | prepare | `{ id, decision: 'accept' \| 'decline', digest }` | `ProposalView`. Accept needs a complete grammar pass (`RECIPE_GRAMMAR`) and keeps the recipe in the library (`learningx.recipeSave`, `passedTests: false`); the person is recorded by name and role. Imports do not change. |
| `books.trialQuestions` | read | `{}` | `{ available; questions: { id; receiptId; operation; period; stale }[] }` (`trials.savedQuestions`) |
| `books.trial` | prepare | `{ draftId \| proposalId, savedAnswerIds?: string[] (≤ 50) }` | `TrialView` after `trials.create` and `trials.evaluate`. A draft becomes `{ type: 'definition', name, replacement }`; adding or removing a word refuses `TRIAL_CHANGE_UNSUPPORTED`; a draft over an older dictionary refuses `DICTIONARY_CONFLICT`. A proposal becomes `{ type: 'recipe', sourceId, recipeId, replacement }`. Without ids, every saved question that is not stale (`TRIAL_NO_SAVED_QUESTIONS` when none). |
| `books.trialRead` | read | `{ trialId \| draftId \| proposalId }` | `{ trial: TrialView \| null }` (only the caller's own copies; a discarded copy is `null`) |
| `books.trialPublish` | approve | `{ trialId, evaluationDigest, impactDigest }` | `{ trialId; status: 'promoted'; publicationId; draftId; proposalId }`. A draft must still pass every release rule (unchanged digest, co-sign when the team needs one, checks); a proposal must be accepted (`PROPOSAL_NOT_ACCEPTED`). Then `trials.promote` with strategy `prospective` and the reviewed impact digest; the draft or proposal is marked published. |
| `books.trialDiscard` | prepare | `{ trialId }` | `{ trialId; status: 'discarded'; cleanupComplete }` (`trials.discard`) |

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
  Round 2: a step only a person can do leads the time line, with your square or a named
  person and Done (the job waits; it is never marked done by itself). The measure is drawn
  against its goal with the shared goal-line chart; each point opens its receipt and a point
  you cannot read is a gap in words. The card shows when the job runs (an interval, or the
  last day of each month at 18:00 India time) and its missed-run rule, which an owner can
  change. Edit (budget, most runs, missed-run rule) makes a change that waits for approval;
  Delete asks first and, without job extensions, cancels the job and keeps its record.
- **Chausar is driving** (WK-14, `#/work/driving`): the choice of one window, the banner
  "Chausar is driving. Ctrl Alt Pause to stop." with Stop, the steps, and the states (sign in
  yourself, paused after you moved the mouse with Continue and Stop, stopped by your key, a
  step failed). Not built yet until a lane provides `session.*`.
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
  The belief line (BK-15, `#/books/belief`, linked from History) draws the figure as known at every point in a window where the
  knowledge changed (a correction, a new event, a join or an undo) as a step line; each mark
  opens the receipt of a real calculation at that time. At most 24 points.
- **A photo of a bill** (WK-13/BK-18, `#/books/bill`, experimental): choose a PDF, PNG or JPEG.
  It is read on this computer. The page is drawn on the left from your own file, with the line
  each field was read from outlined; the form is on the right with "read clearly", "check
  this" or "could not read" beside each field (an unreadable field is empty and amber). Lines
  plus tax must equal the total. Confirm prepares a Tally purchase voucher (prepare only) or,
  with a Zoho Books connection that may write bills, a Zoho bill through writeback; it then
  waits in Approvals. Nothing is kept before Confirm. `BillPhotoBody` is exported for Work.
- **Exchange rates** (BK-19, `#/books/rates`, drawn under Meanings): the rates you entered,
  each with its date, source and who entered it, as exact fractions; the rows in another
  currency left "not counted" for want of a rate; an entry form for the owner or a cofounder.
- **Delete what we hold** (BK-20): on a customer's record, Delete shows what each store will
  do, asks for the customer id typed exactly, deletes what this lane keeps and shows the
  report per store. Facts, receipts, answers, actions and conversations are "not possible
  here", with who can remove them (delete the source in Trust).
- **Memory** (BK-17): what Chausar was told, with its kind, status, source and dates, and
  its earlier versions. There is a filter for outside content, which is remembered and
  never obeyed. Only the owner or a cofounder can add, edit, confirm or delete a line.
  The business profile's entries (industry, products, customers, how the business earns,
  location) appear as read-only claim lines with their earlier versions; Delete removes the
  whole entry through the core business profile.
- **Connections** (BK-01/02, round 2): a connected system appears as a source before anything
  is imported, with failed and loading months. Its sheet offers Read now (the result's checks
  against the source's own totals, its question or refusal in words, then Import after review
  or Set aside), Pause, Sign in again (the browser address is shown as text: sign-in happens in
  the person's browser and the screen never opens anything), Remove the connection, and the
  history of reads. In the demo, a read says in a plain sentence that nothing outside is reached.
- **Add a source** (BK-03, `#/books/add`): every system with what Chausar can do (full, read,
  import), tested or experimental, its evidence counts and tier, not yet tested on a live
  account; one table per system with each operation. The way in: its own interface, files or a
  database; for Tally, where it lives (this computer; this network and another computer are
  labelled experimental and point to a file) and "Which company?". Non-secret settings only.
  A system with no road in is "planned, not available yet".
- **Recipes** (BK-05, `#/books/recipes`): each registered recipe's state (seed, tested, not yet
  tested, failed), its scope in five fields, its bindings with who accepted them and their
  grade, the check against the system's own totals as two figures side by side, questions with
  one of the five fixed reasons and their choices, and a newer version. Proposed mappings are
  listed with theirs.
- **Map this field** (BK-06): on a field of an imported file, the person names the meaning and
  its kind; the learning lane's grammar keeps only what can be true. The proposal shows each
  binding as new, changed or unchanged, what was removed and why, and stays "proposed" until a
  named person accepts it.
- **Try a change on a copy** (BK-09, `#/books/trial`, experimental): from a meaning draft or an
  accepted proposal. Pick the saved questions, make the copy (its time and disk space are
  shown), then each question has two figures, now and with the change; a figure that differs
  is in ink, the rest grey. "Now" opens the saved answer's receipt; "with the change" opens the
  copy's receipt in place. Publish (owner or cofounder, the same release rules) or Discard.

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
| Write-back actions in the queue, the sheet, approve, change, drop, execute, not sure, the record and after a restore | supported over `writeback.*`, tested end to end in the real engine against practice connections (mail, GST) |
| Practice of a write-back action, catalogue rows in write-back's real shape (status, test, score, grants) | supported over `writeback.practice` / `writeback.catalogue` |
| Prepare-only "Get file and checklist" (`approvals.exportPrepared`) | supported (desktop only) |
| WK-12 reminder sheet: link, agreement per channel, stopped flag, limits, owner payment notes, blocked at prepare | supported over `writeback.followUp.*`; the payment notes are fixed text checked 2026-10-14 |
| Passphrase second ask | experimental: drawn only when write-back declares `reauth: 'passphrase'`, which it does not yet; otherwise the typed amount |
| Reverse | supported for core actions whose catalogue row names a reversal action; write-back reversals are shown in words |
| Job list, card, time line, accept and send back | supported over core `jobs.*`; job proposals from `jobsx.*` experimental |
| Start a job from a ready-made brief, budget meters | supported over core `jobs.create` (`owner-brief`); a job from one sentence is experimental (`jobsx.propose`) |
| Month-end brief on the core calendar | supported where the engine has calendar rules; otherwise refused, with every 30 days as the labelled choice |
| Person steps (WK-16), measure chart (WK-08), Edit, Delete and the missed-run rule | experimental: complete with `jobsx.*`; core fallback for typed jobs, Delete as cancel |
| Chausar is driving (WK-14) | experimental: "not built yet" until `session.*` exists |
| Sources, month squares, source sheet, unmapped fields | supported for file imports; freshness from `connectorsx.*` experimental |
| Meanings, drafts, co-sign, publish, packs, GST mode | supported |
| Accounts proposals from Tally groups and decisions | supported; proposals from `learningx.*` experimental |
| Customers and suppliers, opt-in and stop, holdings, same-or-not, conflicts and precedence | supported |
| History as known on a date, versions, stale answers and rebuild | supported |
| Belief line (BK-15) | supported |
| Bill photo to a prepared entry (WK-13/BK-18): local reading, the form, the Tally voucher preview, the Zoho route | experimental: tested with a fake reader and stubbed writeback; no real tesseract or Zoho account was used |
| Exchange rates (BK-19) | supported (entry and "not counted"; this lane converts nothing) |
| Delete what we hold (BK-20) | supported for the lane's own stores; core stores are reported "not possible here" |
| `records.optIn` for jobs-ext | supported |
| Memory lines | supported |
| Business profile lines in Memory, delete through `business.profile.remove` | supported |
| Connections, read now, import, pause, sign in again, remove, history of reads, add a source | experimental: over `connectorsx.*`, tested with a fake dispatcher and the real lane in demo mode (no live system) |
| Recipe view, questions and checks | experimental: over `connectorsx.*` |
| Map this field and proposals | experimental: over `learningx.recipePropose` / `recipeSave`, tested through the real engine |
| Try a change on a copy | experimental (as the design marks BK-09): over core `trials.*`, tested through the real engine |

"Supported" means tested end to end on synthetic data through the engine module and the
screen with a fake rpc. No screen was tested against a live external system.

### Engine methods

There are 32 `approvals.*` methods (`platform/runtime/work-books/work.ts`, `work-queue.ts`, `work-jobs*.ts`, `work-driving.ts`)

There are 26 `approvals.*` methods (`platform/runtime/work-books/work.ts`, `work-queue.ts`, `work-jobs.ts`)
and 33 Books methods (`books-*.ts`). They are listed in `app/desktop/module-methods/work-books.json`.
There are 24 `approvals.*` methods (`platform/runtime/work-books/work.ts`, `work-queue.ts`, `work-jobs.ts`)
and 45 Books methods (`books-*.ts`). They are listed in `app/desktop/module-methods/work-books.json`.
There are 24 `approvals.*` methods (`platform/runtime/work-books/work.ts`, `work-queue.ts`, `work-jobs.ts`)
and 33 Books methods, plus 18 from round 2 (`books-*.ts`). They are listed in `app/desktop/module-methods/work-books.json`.
Private state lives in `state.extensions['work-books']` under `work` and `books` (`state.ts`).
`purge` removes snoozes, notes, opt-ins, decisions, memory lines, mapping proposals and their copies tied to removed
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
  entry) are not built. WK-14 (Chausar is driving) shows "not built yet" until a lane
  provides `session.*`; WK-16 Done needs `jobsx.personStep.done`.
- WK-08: clock time is "not counted" until the core job ledger records durations, and
  effect exposure is "not counted" until a job names its actions (no core job does yet).
  Neither core jobs nor jobs-ext declare a measure goal, so the goal is "absent" unless a
  typed job's input names one. For a lane job, clock time and exposure come from jobs-ext.
  For a core job (with or without jobs-ext), Edit and the missed-run rule work only for typed
  jobs; a read-only brief says not built, and Delete cancels it (the record is kept).
- jobs-ext's questions (`jobsx.answer`), proposal approval (`jobsx.approveProposal`) and
  result acceptance with its reference (`jobsx.accept`) are shown or listed here but not
  answered or approved from Work: the job sheet still uses core `jobs.approve`/`jobs.accept`.
- One sentence: `jobsx.propose` replies a proposal, not a job. `approvals.proposeJob` adds
  `proposal: { id, digest }`, but its `id` is still `job:<proposal id>` (the Start sheet's
  reply check needs `job:`), so opening it from the Start sheet finds no job until that sheet
  reads `proposal` (contract.ts and StartJob.tsx).
- Month-end on the calendar needs an engine started with a typed job runner and calendar
  rules (`durableJobs`, `jobCalendar`). Where the engine has none, only "every 30 days, not
  month-end" is offered, as the person's own choice. On the calendar the month-end job works
  out what customers owe (`aging`, with its receipt); it does not write a narrative brief.
- `approvals.get` (the approval sheet's job card) still reads the missed-run rule from the
  interval catch-up; `approvals.job` reads a calendar's own rule.
- The Today row "3 runs were missed while this computer slept" (WK-11) belongs to frame-today.
- Prepare-only items have no "download the file and the checklist" method.

- WK-13 and BK-18 (a bill photo to an entry), WK-14 (Chausar is driving) and WK-16 (a step for
  a person) are not built. WK-12 has no screen entry point of its own for
  `approvals.prepareReminder` (a customer page can call it); "record the agreement" is a note
  that points to the customer's page.
- Write-back does not ask for a passphrase yet; money and irreversible write-back approvals keep
  the typed-amount second ask until it declares `reauth` on its views.
- Files written by `approvals.exportPrepared` are not removed when the workspace is deleted (the
  engine's purge of `exports/` matches only its own vault copies; widening it is a core edit).
- The caps line counts reminders prepared on the reminder's own day (write-back's business day);
  the screen does not know write-back's configured time zone.
- WK-12 (reminder notes on payment rules, caps), WK-14 (Chausar is driving) and WK-16 (a
  step for a person) are not built.
- Bill photo: the helper's `pdf.ocr` returns text lines with a page confidence, not word
  boxes, so a region is the line's band across the page, not a box around the word. Only the
  first page is outlined. Parsing is fixed patterns for Indian bill layouts (Bill No, Date,
  CGST/SGST/IGST, Grand Total); anything else is left for the person. A PNG must be 8-bit and
  not interlaced, a JPEG grey or RGB; other pictures refuse `IMAGE_OCR_NOT_AVAILABLE`. A
  reading is held in memory for 30 minutes and lost on restart. No model reads pictures. The
  Zoho route sends tax as its own line items (Zoho tax ids are not mapped) and needs the Zoho
  vendor id typed. `approvals.execute` takes only `action:` ids, so an approved Zoho bill is
  booked with `books.billBook`. The Tally voucher names ledgers from the bill (`Purchase: …`,
  `Input CGST …`, the supplier); the accountant maps them.
- WK-08 has no measure chart. Clock time is "not counted" until the core job ledger records
  durations, and effect exposure is "not counted" until a job names its actions (no core
  job does yet). Job Edit and Delete have no methods.
- Ready-made jobs repeat on an interval: "month-end" runs every 30 days from when it is
  approved, not on the last day of each month (calendar schedules need a typed runner).
- BK-02 Read now, Pause and Sign in again; BK-03 Add a source; BK-05 recipes; BK-06
  "Map this field". These belong to connectors-ext and show "not built yet".
- BK-09 "Try it on a copy" links to trials and is not built here.
- Exchange rates are not applied by the calculator: no core hook reads them, so a
  foreign-currency row stays "not counted" and the count is on `books.rates`, not on each
  receipt. `books.gst` still answers `rates: { available: false }`, and Meanings has no link to
  `#/books/rates` yet (Meanings is edited in parallel).
- BK-20 Delete cannot remove core facts, receipts, answers, actions or conversations for one
  customer: the core has no such method, and `trustx.deleteSource` removes whole sources only.
- Memory lists only the lane's own lines, not business-profile entries.
- Prepare-only items have no "download the file and the checklist" method.
- BK-03: Chausar cannot list the companies open in Tally (`connectorsx` has no list-companies
  method), so "Which company?" is a typed name. The exporter and one-page guide for Tally on
  another computer are not built.
- BK-05: answering a recipe question in place has no method (the person fixes the export or the
  setting and reads again); a newer recipe version says which versions, not what changed between
  them; registered recipes have no "who accepted" (they are seeds), and tax registration in the
  scope is unknown. A connector recipe's unmapped field cannot be mapped here.
- BK-09: a copy is reached from a meaning draft and a proposal, not yet from "sources that
  disagree" (BK-14); publishing uses the prospective strategy only.
- BK-15 has no step line of the belief over time.
- BK-19 exchange rates and the BK-20 Delete (`deletion.request`) are not built.
- The lane's "sending closed" gate holds for `approvals.execute`. The core
  `actions.execute` does not check it; closing that needs a core edit.
- Phone approvals (WK-03 "Open the app") follow the core rule: the engine refuses approving
  methods from phone sessions.
