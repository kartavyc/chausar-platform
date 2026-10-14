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
- **Set the missed-run rule** (WK-11): skip, run once on wake (the default), or run every missed one. At most 7 missed runs are caught up, and the note says how many older ones were skipped. After a sleep, the note reads, for example, "3 runs were missed while this computer slept. Ran once."
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
| GST matching (`gst-matching`) | `connectorsx.gstMatch` | Refused with `TEMPLATE_NOT_BUILT` until the connectors lane serves it. Filing is a step for a person. |
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
  - Agent text is quoted and never obeyed. A note with figures is withheld by the number guard.
  - Anything an agent touched is prepared as read-from-outside, so the autonomy switch never runs it.
  - When an agent asks for another job, that request becomes a proposal and waits for the owner.
- **Procedures** (`platform/runtime/procedures/`, after AgentRun):
  - Every case run records a structure-only trace: route, tools, cost, latency, outcome, and a note of one to three sentences. The structure also goes to the learning log.
  - After 3 or more agent runs, `procedures.propose` derives typed steps: calculator calls, one typed question with a learned rule (options, confidence and support), catalogue actions per decision, and lookups.
  - The owner approves the exact digest.
  - A case is routed through the procedure only if it matches the shape, is untainted, and its bucket's confidence and support are high enough. Other cases fall back to the agent, or to you.
  - `procedures.runs` shows the share of routed cases and the cost of routed and fallback cases.
- **Autonomy** (`jobs-ext/autonomy.ts`):
  - A kind can be switched on only if it is reversible and its name contains no always-waits word. The tick auto-approves and executes only prepared, untainted actions of kinds that are switched on, within the daily limit, and only while the master switch is on.
- **Purge.** When a source is deleted, everything the lane derived from it is removed: lane jobs, cases, time lines, results, questions, proposals, reminders and procedure runs.

## Engine methods (45)

| Group | Methods |
|---|---|
| Ready-made jobs and proposals | `jobsx.types`, `jobsx.templateSkill`, `jobsx.propose`, `jobsx.detect`, `jobsx.proposals`, `jobsx.card`, `jobsx.approveProposal`, `jobsx.dismissProposal`, `jobsx.edit` |
| Jobs | `jobsx.list`, `jobsx.get`, `jobsx.timeline` (per job or per business record), `jobsx.result`, `jobsx.accept`, `jobsx.reject`, `jobsx.run`, `jobsx.pause`, `jobsx.resume`, `jobsx.delete` |
| Waiting for you | `jobsx.answer`, `jobsx.personStep.done`, `jobsx.consent.record` |
| Schedules, missed runs and background | `jobsx.schedules`, `jobsx.setMissedRule`, `jobsx.missed`, `jobsx.missed.seen`, `jobsx.background`, `jobsx.setBackground`, `jobsx.setWake` (refused: `WAKE_TIMER_UNAVAILABLE`) |
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
| Stock check, GST matching | experimental: refused until the calculation, or the connectors method, exists |
| Catch-up rule (skip, once, all) and missed-run notes | supported |
| Background mode semantics and setting | supported (the OS service install belongs to the release lane) |
| Waking the computer for jobs | experimental: refused with `WAKE_TIMER_UNAVAILABLE` |
| Rupee budgets, the stop at the reservation, what was left undone | supported with host prices; experimental with `modelsx.price` (models-ext) |
| Stop rules and set aside after failures | supported |
| Acceptance by the owner, with an exact reference | supported |
| Autonomy switch per kind, presets, caps, always-waits list, agreement counts, auto-run of safe kinds | supported |
| Agent fallback, untested-route pause, waiting for the network | supported with a synthetic agent; experimental with a live model route |
| Procedures: traces, derivation, owner approval, routing, routed share and cost | supported with a synthetic agent; experimental live |
| A job asking for a job waits for a yes | supported |
| Imported skill as a job (untrusted, instructions only) | experimental (needs an agent route) |
| Always-on jobs while every laptop is closed | not built: an honest note in `jobsx.background.alwaysOn` |

## Tests

- `platform/tests/jobs-ext-jobs.test.ts`: the full lifecycle through the real engine, with a labelled test clock and a synthetic agent.
- `platform/tests/jobs-ext-autonomy.test.ts`
- `platform/tests/jobs-ext-procedures.test.ts` and `jobs-ext-procedures-derive.test.ts`
- `platform/tests/engine-modules.test.ts`: the method allowlist.

## Cross-lane assumptions (adapters in `jobs-ext/adapters.ts`)

| Lane | Method | Assumed shape |
|---|---|---|
| models-ext | `modelsx.price` | `{ routeId }` → `{ unitMinor, basis: 'measured'\|'estimate'\|'zero', pricedAt }` |
| writeback | `writeback.prepare` | `{ system, action: 'payment-reminder', payload, idempotencyKey, sourceIds }` → `{ actionId \| id }` |
| writeback | `writeback.catalogue` | rows `{ system, action, impact, alwaysWaits }` |
| work-books | `records.optIn` | `{ customerId }` → `{ channels: [{ channel, agreed: 'yes'\|'no'\|'not-asked', source, at, stoppedAt }] }` |
| connectors-ext | `connectorsx.gstMatch` | `{ sourceIds }` → `{ matched, unmatched }` |

A missing method is treated as "not built", and the lane falls back to:

- the local consent register;
- a local reminder draft;
- host prices;
- a typed refusal.

## Still missing

- **Real sending.** Reminders are sent only once writeback is merged, which gives them its approval, read-back and unknown-state handling.
- **Always-on jobs and the home box.** These are paid or experimental, and are only described.
- **The OS wake timer and the background service install.** These belong to the release lane.
- **A model or managed allowance route as the live agent.** Wiring one in as an `AgentPort` belongs to models-ext; until then only synthetic agents are tested.
- **Core noise.** The core scheduler loop also tries to run `jobsx-*` jobs and records a harmless "no installed runner" entry in `tick()` results, which nobody reads. The coordinator may filter non-`owner-brief` plan-less jobs there. I left `engine.ts` unchanged.
