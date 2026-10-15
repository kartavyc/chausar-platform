# Lane: jobs-ext — jobs, autonomy, procedures

Branch `claude/lane-jobs-ext`. Spec: plan days 7–8, architecture piece 11, the AgentRun summary in `docs/build/LANES.md` §7, screens WK-07..WK-12, WK-16, TR-05 and SH-07 (their `Engine:` lines).

## What a person can do

- **Start a job.** Pick a ready-made job or describe one in a sentence. Chausar shows the job's card (WK-09) and the job starts only when you approve that exact card. The card shows:
  - the goal and how you will know it is finished;
  - the owner, the budget in rupees and the stop rule;
  - the actions it may prepare and the model routes it was tested on;
  - the review date, the rule for a missed run, background mode, and which computer runs it;
  - each step, marked "needs an AI model" or "runs without one".
- **Let Chausar propose jobs.** It notices repeating work and proposes a job for it, once a day and on request (`jobsx.detect`). It looks for three things:
  - unpaid invoices past their due date;
  - money received or owed asked about in three different weeks;
  - reminders written by hand on three different days.
  
  Proposals are listed first, as approvals. You can approve or dismiss each one; a dismissed proposal is not offered again for 30 days.
- **Steer a job.** A job can be paused, resumed or deleted at any time. An edit is a new card; approving it replaces the job.
- **Answer the job's questions** and **mark steps for a person done** (WK-16). The job waits for these and never marks them done itself.
- **Accept or send back the result** (WK-10). A job is finished only when its owner accepts the exact delivered result.
- **Set the missed-run rule** (WK-11): skip, run once on wake (the default), or run every missed one.
  - "Run every missed one" catches up at most 7 runs, and the note says how many older ones were skipped. Each caught-up run follows straight after you accept the one before.
  - That rule is offered only for jobs that deliver every run. A job of daily rounds, such as the receivables week, refuses it with `MISSED_RULE_UNSUITABLE`, because a week of chasing must not be squeezed into one day.
  - After a sleep, the note reads, for example, "3 runs were missed while this computer slept. Ran once."
- **Background mode** (SH-07). It is off until you turn it on. With it off, a closed window means jobs do not run, and the next start lists what was missed.
- **Autonomy** (TR-05):
  - Each kind of action has its own switch and a daily limit, and there are three presets.
  - The always-waits list has no switches: money, messages to outsiders, deleting, prices, stock, listings, sharing, invites to outsiders, webhooks and tax filings (prepare only).
  - The master switch is "run on its own" in Trust (`policy.autonomy`); a new install has it off.
  - For each kind, the screen shows how often the rule would have agreed with what you approved.

## Ready-made jobs

| Job | Reads | Notes |
|---|---|---|
| Chase unpaid invoices for a week (`receivables-week`) | `aging` | Seven daily steps, then one result to accept. Details below. |
| Cash position (`cash-position`) | `received`, `aging` | Daily. |
| Weekly close (`weekly-close`) | `net_sales`, `margin`, `aging` | Weekly. Ends with a step for a person: review the week and lock it in the books. |
| Stock check (`stock-check`) | `stock_on_hand` | Refused with `TEMPLATE_CALCULATION_MISSING` until the dictionary publishes that calculation. |
| GST matching (`gst-matching`) | `connectorsx.gstMatch` | Monthly: last month's purchase register against GSTR-2B, through the connectors lane. The card names both sources (`GST_SOURCES_REQUIRED` otherwise). Filing is a step for a person. |
| A job in your own words (`agent-task`) | the installed agent route | Needs an agent route (`AGENT_ROUTE_REQUIRED`). An imported skill makes a card marked "instructions only, no tools, untrusted". |

How `receivables-week` handles each step:

- It runs aging and works out each invoice's outstanding amount from the receipt's own rows (BigInt paise).
- For each overdue invoice it prepares a reminder only if three things hold:
  - the customer agreed on that channel;
  - the customer has not sent the stop word;
  - the caps allow it (one per customer per day, 20 a day in all).
- A long-overdue invoice becomes one question for you: remind, stop or call.
- "Sent" and "paid" are separate entries. A payment is read later from the books.
- The reminder always waits for your yes. Without the writeback lane it is only a local draft, and nothing is sent.

Every ready-made job can be exported in the Agent Skills folder format (`jobsx.templateSkill` → `<id>/SKILL.md`).

## How it works

- **The mandate.**
  - Each lane job is a `JobService` job of type `jobsx-<template>`. The core service still holds the goal, the owner, the rupee budget, the stop rule, the lease and reservation, and acceptance.
  - The lane namespace (`state.extensions['jobs-ext']`) adds proposals, the time line, results, questions, steps for a person, missed-run notes, the autonomy table, the consent register and procedures.
- **One step** (`platform/runtime/jobs-ext/run.ts`):
  1. `acquire` applies the catch-up rule, the stop rule, the budget reservation and the autonomy master.
  2. The template's work runs. Each model call is charged with `charge` against that step's reservation. A call is made only if its maximum cost fits what is left.
  3. Then one of two things happens:
     - It is an intermediate step: the lease is released and the next slot is set.
     - It is a delivery: `complete` holds the result digest and the job waits for acceptance.
- **Stop rules.**
  - The core rules: the number of runs and the last date.
  - The budget. When it stops a job, the job pauses with "Stopped by a rule: the budget" and lists what was left undone.
  - Untested routes. The job pauses and names the route it needs.
  - Set aside after N failed runs in a row (default 3, changeable). It stays aside until you resume it.
  - The goal ("finished when").
- **No network.** The steps that need no model finish. A model step waits and shows "Resumes at".
- **Rupee budgets.**
  - Costs come from `modelsx.price` (models-ext), then trusted host prices, then the local-model rule (zero, with minutes shown).
  - A command-line route's cost is labelled an estimate.
  - A route with no price is refused (`ROUTE_PRICE_UNAVAILABLE`). It is never counted as free.
  - `jobsx.budget` shows three meters: model use per route, clock time, and money exposure. Every ready-made job has zero money exposure.
- **The agent.**
  - The full agent is an `AgentPort` installed by a trusted host (`EngineOptions.modules['jobs-ext'].agent`), never by RPC. Demo mode accepts only a synthetic agent.
  - **The live agent in the installed app** (`jobs-ext/gateway-agent.ts`). The module's `hostOptions` turns it on outside demo mode. It runs over the core `ModelGateway` and the first enabled route the owner configured. The gateway accepts only an analytical plan that names a published calculation, so the live agent is a lookup, never a decision maker:
    1. It previews a request made of fixed words and typed case codes, under the trust panel's send level. In shape mode no invoice, customer or amount is sent.
    2. If the gateway says the send needs approval, the case waits (timeline code `AGENT_APPROVAL_REQUIRED`, with the preview's id) until you approve that exact payload with `models.approve`. Nothing is sent before.
    3. The gateway sends it once and keeps its model receipt. One approval covers one send.
    4. Software runs the calculation the model chose and keeps its receipt.
    5. The case comes to you with that receipt. The decision stays with a person.
  - A preview is reused only while its facts, privacy settings and route revision are unchanged; otherwise a fresh preview waits for a fresh approval.
  - A call is charged only when its model receipt shows it left the machine. A measured cost above the step's reservation is charged up to the reservation and the rest is stated on the time line (`COST_ABOVE_RESERVATION`).
  - The live call's cost is the gateway's measured cost at the route's token rates, or the route's reserved per-call estimate. It is reserved against the job step before the call and charged after; a local model is zero.
  - Agent text is quoted and never obeyed. A note with figures is withheld by the number guard.
  - Anything an agent touched is prepared as read-from-outside, so the autonomy switch never runs it.
  - When an agent asks for another job, that request becomes a proposal and waits for the owner. Its words are number-guarded, quoted on a card marked untrusted, and never adopted as the job's instructions.
  - An agent call is cut off well inside the step's lease (240 seconds by default). A call that runs out is charged its full reservation, because its use is unknown.
- **Procedures** (`platform/runtime/procedures/`, after AgentRun):
  - Every case run records a structure-only trace: route, tools, cost, latency, outcome, and a note of one to three sentences. The structure also goes to the learning log.
  - After 3 or more agent runs, `procedures.propose` derives typed steps: calculator calls, one typed question with a learned rule (options, confidence and support), catalogue actions per decision, and lookups.
  - The owner approves the exact digest.
  - The ready-made rule's hard guards come first: not due, no agreement, stopped by the customer, reminded today, and reminded three or more times (which asks you). Only the cases left are routed through a learned procedure.
  - A case is routed through the procedure only if it matches the shape, is untainted, and its bucket's confidence and support are high enough. Other cases fall back to the agent, or to you.
  - Consent and the caps are checked again after routing; a procedure, an agent or an answer can never override them.
  - `procedures.runs` shows the share of routed cases and the cost of routed and fallback cases.
- **Autonomy** (`jobs-ext/autonomy.ts`):
  - A kind can be switched on only if it is reversible and its name contains no always-waits word.
  - Each kind also has a daily amount limit in whole paise (`dailyAmountMinor`, default `0`). An action's money is the sum of every `amountMinor` in its payload. Any other field that may name money (amount, total, value, price…) at any depth makes the amount unknown. An action whose amount cannot be read never runs on its own, and the day's total plus this action must stay within the limit, checked in the same transaction as the count.
  - Outside the workspace's own local connector, a kind also needs the writeback catalogue to say explicitly that it can be undone and need not wait. An unknown or renamed connector has no switch.
  - Each claim reads the live switch, the limits and the action's state again in one transaction, and never claims an action already claimed by an overlapping tick.
  - The tick auto-approves and executes only actions that meet every one of these:
    - prepared by one of this lane's jobs, and exactly as the job recorded it: its private per-job key, its invoice and the job owner as author. Work prepared by hand, by a plugin, a small app or an assistant always waits;
    - untainted and never revised;
    - of a kind that is switched on, within the daily limit, which is checked and recorded in the same transaction so overlapping ticks cannot exceed it;
    - while the master switch is on.
  - A procedure's action steps describe what a person may approve; the executor never runs them. It only prepares reminders through its own code path.
- **Access.** Every read and change checks that the caller is the job's pinned owner and can still read all of the job's sources, the same rule `JobService.list` uses. Procedure runs follow the same rule.
- **Approval is one transaction.** Claiming the proposal, checking the limit, creating the mandate and stopping a replaced job commit together. Two approvals of one card create one job, and approving an edit withdraws the other pending edits of that job.
- **Retention.** With the workspace's retention cleanup, old records go: time lines, results, answered questions, finished steps for a person, missed-run notes, decided proposals, reminders, autonomy runs, recorded agreements and procedure runs. Open questions, waiting steps and undecided proposals stay. A procedure keeps its structure when only its old runs expire.
- **The scheduler.** The module declares `ownsJob` for `jobsx-*` jobs, so the core scheduler loop leaves them to the lane's tick.
- **Active-job limit.** It is the lower of the lane's limit (10 by default, changeable in Trust) and the engine host's `durableJobs.maxActiveJobs` ceiling.
- **Purge.** When a source is deleted, everything the lane derived from it is removed:
  - lane jobs, cases, time lines, results, questions, steps for a person, proposals and reminders;
  - procedure runs, and any procedure derived from a removed run;
  - a customer's recorded agreement, once no live record names that customer.

## Screens (round 4)

Two Work sub-places, drawn by `app/ui/src/places/lane-jobs-ext.tsx` from `app/ui/src/screens/jobs-ext/`, with words in `app/ui/src/text/lanes/jobs-ext.ts` (English and Hindi):

- **Work · Procedures** (`work/procedures`):
  - The owner's procedures, each with its state, version, "N of M cases routed", and the cost of routed and fallback cases.
  - "Propose a procedure" for each ready-made job, with plain sentences for its refusals.
  - A sheet with the typed steps: calculations, the question with its rule buckets and confidence, actions that wait for your yes, and lookups that need a model. It also lists the runs, and the agent's note as a quote.
  - Approve sends the exact digest shown; a changed card is read again.
  - Reject takes a reason; an approved procedure can be retired.
- **Work · Job controls** (`work/job-controls`): for each lane job,
  - the budget meters (rupees from paise; a model cost shown as an estimate, or priced at zero with its minutes; clock time; money exposure);
  - the stop rules, with the failed-run limit editable from 1 to 10;
  - "Show SKILL.md", with copy and save on this computer;
  - "Find repeating work" (`jobsx.detect`), then the new proposals;
  - the missed-run notes, with "Mark as read".

Both screens draw loading, empty, not built, read only (viewer), locked and error states, in the three views.

## Engine methods (45)

| Group | Methods |
|---|---|
| Ready-made jobs and proposals | `jobsx.types`, `jobsx.templateSkill`, `jobsx.propose`, `jobsx.detect`, `jobsx.proposals`, `jobsx.card`, `jobsx.approveProposal`, `jobsx.dismissProposal`, `jobsx.edit` |
| Jobs | `jobsx.list`, `jobsx.get`, `jobsx.timeline` (per job or per business record), `jobsx.result`, `jobsx.accept`, `jobsx.reject`, `jobsx.run`, `jobsx.pause`, `jobsx.resume`, `jobsx.delete` |
| Waiting for you | `jobsx.answer`, `jobsx.personStep.done`, `jobsx.consent.record` |
| Schedules, missed runs and background | `jobsx.schedules`, `jobsx.setMissedRule`, `jobsx.missed`, `jobsx.missed.seen`, `jobsx.background`, `jobsx.setBackground`, `jobsx.setWake` (through release's `native.wake.set`/`clear`; release's refusals pass through unchanged; `WAKE_TIMER_UNAVAILABLE` only while release lacks the method) |
| Budgets and stop rules | `jobsx.budget`, `jobsx.stopRules`, `jobsx.setStopRules` |
| Autonomy | `jobsx.autonomy`, `jobsx.setAutonomy`, `jobsx.autonomyPreset`, `jobsx.caps`, `jobsx.setCaps` |
| Procedures | `procedures.list`, `procedures.get`, `procedures.propose`, `procedures.approve`, `procedures.reject`, `procedures.retire`, `procedures.route` (a dry run), `procedures.runs` |

Refusal codes that screens can tell apart are on the jobs-ext line of `laneRefusals` in `app/desktop/preload.cjs`.

## Supported and experimental

| Feature | Label |
|---|---|
| Ready-made jobs: proposal, exact card approval, pause, resume, delete, edit by a new card, active-job limit | supported |
| Detection of repeating work | supported |
| The receivables week: aging cases, agreement, caps, a question, a step for a person, paid as a separate entry, acceptance | supported (reminders are local drafts until the writeback lane is merged) |
| Cash position, weekly close (with its step for a person) | supported |
| GST matching (`connectorsx.gstMatch`, card names both sources, filing a person's step) | supported (end-to-end test on synthetic purchase registers) |
| Stock check | experimental: refused with `TEMPLATE_CALCULATION_MISSING` until core-data publishes `stock_on_hand`; runs unchanged once it does |
| Daily amount limit per kind (TR-05) | supported |
| Deciding agent over the gateway `decide` purpose | experimental: for receivables cases only. A model may propose a reminder, which still waits for your yes; any other answer goes to you. It falls back to the lookup agent until core-gateway-auth adds the purpose, and is tested against a stub of the contract below |
| Catch-up rule (skip, once, all) and missed-run notes | supported |
| Background mode semantics and setting | supported (the OS service install belongs to the release lane) |
| Waking the computer for jobs | experimental: `jobsx.setWake {at, confirmed:true}` / `{clear:true, confirmed:true}` go through release's `native.wake.*`; `jobsx.background.wake` shows `native.wake.status` (`nextWakeAt`, or a code when the timer is not reachable) |
| Rupee budgets, the stop at the reservation, what was left undone | supported with host prices; experimental with `modelsx.price` (models-ext) |
| Stop rules and set aside after failures | supported |
| Acceptance by the owner, with an exact reference | supported |
| Autonomy switch per kind, presets, caps, always-waits list, agreement counts, auto-run of safe kinds | supported |
| Agent fallback, untested-route pause, waiting for the network | supported with a synthetic agent |
| Live model-gateway agent: lookup, exact payload approval, one send, receipts, cost charged to the job | supported against a local fake provider (a real local HTTP server and an injected HTTP port); experimental with a live provider |
| Procedures: traces, derivation, owner approval, routing, routed share and cost | supported with a synthetic agent; experimental live |
| A job asking for a job waits for a yes | supported |
| Imported skill as a job (untrusted, instructions only) | experimental (needs an agent route) |
| Always-on jobs while every laptop is closed | not built: an honest note in `jobsx.background.alwaysOn` |

## Tests

- `platform/tests/jobs-ext-jobs.test.ts`: the full lifecycle through the real engine, with a labelled test clock and a synthetic agent.
- `platform/tests/jobs-ext-gateway-agent.test.ts`: the live agent over the real `ModelGateway`, against a real local HTTP model server (Ollama format) and an injected HTTP port (OpenAI-compatible, with approval and measured cost). Also retention, the scheduler seam, the host job ceiling and the installed-app wiring.
- `platform/tests/jobs-ext-autonomy.test.ts`
- `platform/tests/jobs-ext-procedures.test.ts` and `jobs-ext-procedures-derive.test.ts`
- `platform/tests/engine-modules.test.ts`: the method allowlist.

## Cross-lane assumptions (adapters in `jobs-ext/adapters.ts`)

| Lane | Method | Assumed shape |
|---|---|---|
| models-ext | `modelsx.price` | `{ routeId }` → `{ unitMinor, basis: 'measured'\|'estimate'\|'zero', pricedAt }` |
| writeback | `writeback.connections`, `writeback.followUp.prepare`, `writeback.followUp.consents` | `followUp.prepare { connectionId, customerId, invoiceId, sourceIds }` → the prepared action's view `{ id }`; an agent-touched reminder is called with `{ tainted: true }` on the call's context; `FOLLOW_UP_*` refusals block the case with their reason |
| writeback | `writeback.catalogue` | rows `{ system, action, impact, alwaysWaits }` |
| work-books | `records.optIn` | `{ customerId }` → `{ channels: [{ channel, agreed: 'yes'\|'no'\|'not-asked', source, at, stoppedAt }] }` |
| connectors-ext | `connectorsx.gstMatch` | `{ sourceIds }` → `{ matched, unmatched }` |

A missing method is treated as "not built", and the lane falls back to:

- the local consent register;
- a local reminder draft;
- host prices;
- a typed refusal.

## Still missing

- **Real sending needs a connection.** With a live or sandbox mail (or WhatsApp) connection granted `smtp.send` (or `template.send`) in writeback, reminders go through `writeback.followUp.prepare`: writeback's consent, caps, invoice evidence and fixed template, then a person's yes. Without one, they are local drafts and nothing is sent.
- **Always-on jobs and the home box.** These are paid or experimental, and are only described.
- **The OS wake timer and the background service install.** These belong to the release lane; jobs-ext only calls `native.wake.*` and passes its refusals through.
- **Two core suggestions from the autonomy review (not made, core files):**
  - `ModuleHost.call` runs as the module's caller, so an agent-touched reminder sent to `writeback.prepare` carries its outside-text mark only as a payload field (`sourceTainted: true`). Writeback must honour it, or the host could let a module add the taint mark to the call's context.
  - `ModelGateway.approveOutbound` refuses the phone channel but not a context marked as read-from-outside. Every other approval refuses it.
- **A live agent that decides** waits on core-gateway-auth's `decide` purpose (contract below). Until then the live agent looks up and the decision stays with a person.
- **The stock check** waits on core-data's quantity measure (`stock_on_hand`, contract below).

## Round 4 contracts

Methods this lane calls in other lanes, with the exact shape it expects. A missing method or purpose is treated as "not built yet" and refused or bypassed with a typed code; nothing is guessed.

| Owner | Contract | Until it lands |
|---|---|---|
| models-ext | `modelsx.price` (read) `{ routeId: string }` → `{ routeId: string, unitMinor: string /* whole paise per model unit, /^(0\|[1-9]\d*)$/ */, basis: 'measured' \| 'estimate' \| 'zero', pricedAt: string /* ISO date-time */ }`. One unit is one model request. Any other reply is refused with `ROUTE_PRICE_INVALID`; `ROUTE_NOT_FOUND` (a route the gateway does not hold) falls through to host prices and the local rule; `ROUTE_ESTIMATE_UNAVAILABLE` stands. | Host prices (`modules['jobs-ext'].routePrices`), then the local-model rule; otherwise `ROUTE_PRICE_UNAVAILABLE` (never counted as free). |
| core-gateway-auth | `ModelGateway.preview(ctx, { purpose: 'decide', options: string[] /* 2–10 codes, /^[a-z0-9-]{1,32}$/ */, question, routeId, sourceIds, samples: [] })` with the receipt keeping `purpose: 'decide'` and the offered `options`, then `execute(ctx, { previewId, approvalId? })` → `{ kind: 'decision', decision: { option: string, confidence?: number /* 0..1 */ }, receipt: { id, actualCostMinor?, costReservedMinor } }`. An option outside the offered list counts as no decision. | The gateway refuses the purpose (`INVALID_CONVERSATION_PURPOSE`, or `DECIDE_PURPOSE_UNAVAILABLE`/`UNKNOWN_PURPOSE`); the agent falls back to the lookup request and the case goes to a person. |
| core-data | A published calculation `stock_on_hand` in the dictionary's `operations`, run as `calculator.calculate(ctx, { operation: 'stock_on_hand', sourceIds? })`, whose figures carry `unit` (for example `'quantity'`) instead of money. | `stock-check` is refused with `TEMPLATE_CALCULATION_MISSING`. |
| writeback | `writeback.connections` (read) → `[{ id, system: 'mail' \| 'whatsapp' \| …, environment: 'live' \| 'sandbox' \| 'practice', write: string[], revokedAt? }]`; `writeback.followUp.prepare` `{ connectionId, customerId, invoiceId, sourceIds }` → `{ id, … }` or `{ status: 'already-done' }`, refusing `FOLLOW_UP_NO_CONSENT`, `FOLLOW_UP_STOPPED`, `FOLLOW_UP_DAILY_CAP`, `FOLLOW_UP_NEEDS_REVIEW`, `FOLLOW_UP_NOTHING_DUE`; called with `{ tainted: true }` on the call's context for an agent-touched reminder; `writeback.followUp.consents` → `[{ customerId, channel: 'email' \| 'whatsapp', answer: 'yes' \| 'no' \| 'not-asked' \| 'stopped', observedOn }]`. | A local reminder draft; the local consent register. |
| connectors-ext | `connectorsx.gstMatch` `{ registerSourceId, gstr2bSourceId, period: { from, to } }` → `{ mode: 'matched' \| 'not-applicable', counts: { matched, amountMismatch, inBooksOnly, in2bOnly, probable, invalid } }`; `GST_MATCH_SOURCES_EMPTY` is an open item, not a failure. | `TEMPLATE_NOT_BUILT`. |
| work-books / frame-today | The place registry must let `work/procedures` and `work/job-controls` reach `jobsExtPlaces` (work-books' Work module claims every `work` address today). | The screens are tested directly. |

Methods this lane serves for others this round: `jobsx.autonomy` rows now carry `dailyAmountMinor` and `amountUsedTodayMinor`; `jobsx.setAutonomy` accepts `dailyAmountMinor` (whole paise, default `'0'`: nothing that touches money runs on its own).

