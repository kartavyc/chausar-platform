# Second pass on the 35 shortlisted products, 23 October 2026

Group: second-pass. Research input, not a decision. The 21 Oct cards (`cards/`, `frontend/`) read these products for safety mechanisms and three playbooks. This pass re-cloned all 35 and read them again for what those cards did not take: B2C usability, visual richness, reading and talking to agents to customise them, team views, CRM and pipeline, onboarding, notifications, mobile, pricing and plans, and extra businesses a self-employed person could run. Each card below holds only new findings. Paths are relative to each product's repo root; "Ink" means `D:\claude\chausar-platform\app\ui\src`. Nothing was run, built or installed.

Clones: shallow, `--filter=blob:limit=2m`, at each repo's head on 23 Oct. Drive C: filled up during cloning, so 26 clones sit in the scratchpad `harvest-clones\` and 9 (LongHorizon-Harness, llm-space, postmill, akaunting, product-shots, trycompai/crm, Countersign, opendesk, bridgeclip) in `D:\tmp\harvest-clones-second-pass\`. omnigent and sealeap were read from git objects where the C: checkout broke off. opendesk's `internal/helpdesk/imports/nul.go` can't be checked out on Windows (reserved name); nothing depended on it.

Source status: all 35 have their source in the repo. **No product needs REA.** Four lean on hosted parts outside the repo: decionis (the policy engine), akaunting (paid apps and payment modules), diffusionstudio/editor (generation and billing API), and bridgeclip (its Jev judge, a third-party hosted model).

## The five most valuable new ideas

1. **A notification centre and a way to reach the phone** (opendesk, postmill, qm, podcast-shorts-factory). One chokepoint for every alert, a category by channel grid, an instant, hourly or daily digest at a chosen hour, a pause, pacing so a burst becomes one message, and quiet hours. Web Push on the hosted tier, plus a text-free push ("3 need you") from the desktop. Today Chausar has none of it.
2. **Chausar's own plan model and plan page** (cloudflare-os, opendesk, diffusionstudio, postmill). A free AI allowance, then the owner's own key, which spends none of the allowance. Top-ups that never expire, auto-recharge with a monthly cap, every feature on every plan, one usage bar with its reset date, and an "out of allowance" sheet offering connect or wait with a countdown.
3. **Reading and steering agents in plain words** (qm, postmill, opendesk, youtube-agent-skill). The playbook shown as readable versioned text with "Done when:", plus a voice the owner writes per language and channel, with a "What I will not claim" list. A memory and knowledge list the owner can edit or tell it to forget, and a Test tab that tries unsaved changes on practice clients.
4. **Stopping, steering and trusting a run** (LongHorizon, qm, bridgeclip). Stop then Force stop with the loss stated; Resume versus Start again. An owner gate after each round (finished, limit reached, needs an answer, three failures in a row), and agent health worked out in code that quarantines an agent taking an undeclared action. A check detail view that shows each rule's question, floor and verdict.
5. **A sales pipeline and the lead-generation business** (trycompai/crm, revenue-squad, instagram-agent-skill). Stages through Call booked, Proposal sent, Won and Nurture, with deal value and a follow-up date set by code. A lead score from per-factor votes that code adds up, a stalled-client rule that needs no model, and a trigger required on every DM. A daily run proposes ten checked leads with drafts that the owner sends.

Also high and cheap: the "this description is incomplete" flag on proposed actions (cloudflare-os); scheduled-job changes on the always-ask floor (omnigent); open vs overdue on Money with overdue reminders the owner approves and a "viewed" state from share links (akaunting, idea only); "Connect your AI" that finds keys and AI tools already on the computer.

## A Chausar bug found on the way

Ink asks the owner to type the monthly spend limit "in millionths of a US dollar: 5000000 is 5 US dollars" (`app/ui/src/text/en/money.json:106`, key `money.policy.capHint`). A B2C owner can't manage that. The field should take rupees or dollars, and the engine should convert.

## Corrections to the 21 Oct cards (checked against code on 23 Oct)

| Card | Claim | What the code shows |
|---|---|---|
| `cards/harness.md`, README traps | LongHorizon-Harness "ships no harness code"; the source isn't in the repo | At d53df0a the repo holds `src/lh_harness` (about 20,000 lines), `frontend/web`, `frontend/core` and tests, MIT |
| `cards/harness.md` | LongHorizon's Manager and Auditors get read-only permissions | They lose Write and Edit under Claude Code's `bypassPermissions`; auditor writes are caught afterwards and rolled back (`src/lh_harness/adapters/claude_permissions.py:24-70`, `auditor_agent.py:225-265`) |
| `cards/harness.md` | omnigent: an unpriced model counts as 0.0, so the budget steps aside | Now fails closed after the first turn (`omnigent/policies/builtins/cost.py:30-50,114-135`) |
| `cards/harness.md` | omnigent `sys_add_policy`: open question | Every call asks the user (`omnigent/policies/builtins/safety.py:327-350`) |
| `cards/quality-data-ops.md` | trycompai/crm last commit August 2026 | Commits to 22 Oct 2026 on `release` |
| `frontend/approvals-ops.md` | crm home: "Me / Team" toggle with cards for deals, tasks, activity | The toggle reads "Me / Everyone" (`overview-scope.tsx`), and the home leads with a sales dashboard of charts |
| `cards/creator.md` | bridgeclip's "typed editorial gate": every candidate clip must pass six checks, each with its own floor; "the best quality judge design in this group" | Jev is off by default for automatic clipping and always on only in Review & edit (`src/shared/jev-settings.ts:12-21`). It calls a hosted third-party judge model, `typesafe/jev-1.13`, via OpenRouter (`engine/clip_engine/services/jev_service.py:19-22`). There is a seventh floor, sufficient evidence at 50% |
| `cards/creator.md` | podcast-shorts-factory's uploader defaults to private | Only the code fallback is private; the shipped `config.yaml:144` sets `privacy: "public"` |
| `cards/creator.md`, README platform facts | Unaudited YouTube API uploads stay private | Out of date: Chausar's own `docs/venture/ink.md` (Known limits, Posting) records YouTube's 15 Oct 2026 change |
| `cards/creator.md` | instagram-agent-skill has five Python tools | Six (`swipe.py` is the one left out) |
| `cards/marketing-commerce.md` | Amazon-Skills has 53 skills | 52 `SKILL.md` files at 0f3b13f |
| `frontend/creator-marketing.md` | postmill: outward actions never run from the agent; every outward tool returns a draft | The ops agent holds `schedulePostTool` (type `now`), `deletePost` and `approveDraft`; the only guard is a prompt line asking for confirmation "when ui mode is true" (`libraries/nestjs-libraries/src/chat/agents/ops.agent.ts:15-22,49`). The agent can approve a draft itself |
| `cards/marketing-commerce.md` | revenue-squad lead score is 1 to 10 from the model; pipeline states Contacted, Replied, Lost, Blocked | A 0 to 15 point rubric with thresholds (`skills/research/SKILL.md:72-93`); only the sum is the model's. Eight statuses (New, Contacted, Replied, Call Booked, Proposal Sent, Won, Lost, Nurture); Blocked is a separate column |
| `cards/finance.md` | bankmcp watch kinds and features | Incomplete, not wrong: also `balance_above` and `debit_matching` watches (`src/watcher.ts:93-112`), six prompts, and account attestation |
| `cards/finance.md` | opentax-engine scope | Missed the `solve` what-if layer, the document compiler and the differential test harness. Its playground footer says Apache-2.0 while every package says AGPL-3.0-only: treat it all as AGPL |

## Look decisions this raises

Several ideas add colour, charts or faces, which Ink's tokens keep to a minimum ("only failure earns a hue", no colour blocks, no AI personality). Ideas that fit as they are: amber for "near the limit" and red for overdue (Ink already has `--wait` and `--fail`), thin bars, ranked inline bars with "N/A", and big numbers with hairlines (akaunting's summary row has no boxes). Ideas that need the founder's yes first: initials on a muted colour for clients and agents (cloudflare-os, cogsend), client logos from their domain (crm), a pipeline donut (crm), and generated agent faces (opendesk, which give the AI a personality).

## Contents

| Group | Products |
|---|---|
| Harness | qm, cloudflare-os, omnigent, decionis, floe-guard, llm-space, LongHorizon-Harness |
| Quality and data | opendesk, trycompai/crm, helix-foundry, SkillEvaluator, agentbehavior, open-computer-use, py-idp |
| Creator | youtube-agent-skill, youtubepro, open-edit, diffusionstudio/editor, podcast-shorts-factory, instagram-agent-skill, reels-af, bridgeclip |
| Finance and commerce | opentax-engine, itr-prep-skill, bankmcp, akaunting, Amazon-Skills, sealeap-ecommerce-skills, product-shots |
| Marketing and sales | postmill, cogsend, beyondseo, UGC-Factory, revenue-squad, Countersign |

Every product had something new. The thinnest are SkillEvaluator, open-computer-use, llm-space and agentbehavior (one idea each).

---

**Harness group**

## yc-software/qm (MIT, 15,479 stars, last commit 2026-10-22)
Source: full.
New findings:
- Agent customisation, standing jobs ("Loops"): each job has its own page (`plugins/web-ui/src/loops.ts:740-900`): an icon picker (built-in glyphs or an uploaded image up to 2 MB, `loop-icon.ts:22`), a health badge with its reason, Fire now, Pause or Resume ("Clear quarantine" when quarantined), an Autopilot switch whose sub-line says what it means ("Ships outputs without review"), then sections "Ready to ship (n)", "Needs confirmation (n)" (the owner confirms an outside send really happened), Triage, "Playbook v3" as editable text with a "Done when:" success line, "Work ledger" and "Decided". Empty lines: "Nothing waiting on you.", "No items yet. Fire the loop."
- Agent health, from code, not the model (`src/loops/governor.ts:25-110`): healthy < degraded < failing < quarantined, each with a one-line reason. An outside action the playbook never declared quarantines the job; 3 failed runs in a row quarantine it (2 marks it failing); if more than half of at least 4 reviewed outputs were sent back, it is throttled with "the playbook is producing work people don't want, revise it"; a deep or old queue marks it degraded.
- Owner-written triage with a dry run (`loops.ts:292-345`): two switches, "Prioritize: sort new items by urgency, with a reason on each" and "Consolidate: group items that one piece of work would resolve", each with the owner's own instruction ("e.g. Production incidents first, then customer friction") and a "Dry run" that ranks the current items before anything is saved.
- Defining a job (`skills-seed/define-loop/SKILL.md`): interview one or two questions at a time (source of work and its stable id, trigger, success condition, allowed outside actions, caps, who to ping), then "never arm a loop you have not watched work": one real item end to end with the owner watching, then arm. The success condition must carry a bound ("or park with a diagnosis after 5 turns").
- Readable memory (`plugins/web-ui/src/memory.ts`): a searchable list of plain facts, each with "Captured 2026-10-12", Edit and Forget ("Forgotten ✓"). Onboarding state lives in memory as a versioned fact ("Onboarding: completed v2 on ..."); bumping the version re-runs onboarding for everyone (`plugins/onboarding/README.md`).
- Voice: onboarding offers three clearly different voices written as the same short status update and saves the choice as first-person rules with two or three examples, including bad news (`plugins/onboarding/skills/onboarding/SKILL.md`, "Voice"). `skills-seed/email-voice-profile/SKILL.md` builds a profile from up to 300 sent emails: register by audience, openers and sign-offs with frequencies, rhythm, hard rules, anti-patterns, every claim backed by an observed frequency and 2-3 verbatim lines; it is marked `validated: <date>` only after drafting 3 held-out real threads and comparing them with what was really sent.
- Editing shared instructions (`skills.ts:305-400`, `skill-edit-review.ts`): Save first shows an impact line ("Publish this change to <team>? Everyone in this context can invoke the updated instructions. Description unchanged; instructions changed.") and the button turns into "Publish change", with "Review again".
- "Who is waiting on you" suggestions (`src/suggestions/activities.ts:9-18`, `plugins/web-ui/src/suggested-activities.ts`): a scheduled job every 4 hours writes 5 suggestions, owed work first (an unanswered question, a promise made, a review someone is blocked on), ranked by how blocked the other person is and how long they have waited, "Never invent an obligation"; 3 are shown, each dismissable, and the last 30 dismissals go back into the prompt so they never return. Titles: 4-9 words, verb first ("Reply to Dana about the launch plan").
- Notifications: a morning digest skill (`skills-seed/morning-digest/SKILL.md`): one message of what changed, grouped by topic, decisions and replies first, every claim with its source link; "nothing notable today" when nothing changed; a delivered-ids file stops repeats. No OS notifications at all (desktop prototype disables them, `desktop/README.md`).
- Team views: sub-agents shown as a tree whose status is inherited (a paused parent pauses its children) with "Pause all", "Resume all", "Stop all" (`swarm-strip.ts:1-60`). A "Sent mail" view lists what the agent sent for you, each with "Ask about this email" and "Open in Gmail" (`sent-mail.ts`).
- Visual: admin spend chart (`plugins/admin/ui/spend-chart.ts`): stacked daily or weekly bars split by kind (live chat, scheduled jobs, standing jobs, webhooks), by model or by person, a rounded axis ceiling (1, 2, 2.5, 5, 10), three date labels, and a detail line on hover.
- Mobile: installable web app; the manifest takes the deployment's own name and icon (`plugins/web-ui/server/index.ts:102-125`), with a theme colour per light and dark scheme (`plugins/web-ui/index.html:11-14`); 35 narrow-width rules in `shell.css`.
- Onboarding wording for connections (`onboarding-welcome.ts`): "Confirming access before marking it connected.", "We couldn't confirm an active connection yet.", "Connection preview · No accounts are linked".
- Computer access set-up page (`desktop/permissions.html`): each OS permission with one plain line ("Read controls, click, and type."), a live check while the OS settings window is open, and "Check again".
Take for Chausar:
- Engine: agent health from returns and failures with qm's thresholds; an outside action not declared in the playbook quarantines the agent. Shows on Team as one word plus a reason.
- Engine: "watch one real order end to end before arming" as the step between shadow and approve-each; a success condition with a bound ("or stop with a reason after 5 tries").
- Playbook: per-business voice profile from the owner's own sent mail (frequencies, verbatim examples, held-out check before "validated"). Fills the audit's missing "voice.md per business".
- UI: on the agent sheet, the playbook as readable text with "Done when:", a version number, and a save step that states the impact; a Memory list (fact, captured date, edit, forget).
- UI: a "who is waiting on you" block on Today drawn only from real records (client questions, promised invoices), dismissals remembered.
- UI: a morning digest that can say "nothing needs you today", with no repeats.
- UI: Pause all and Stop all for a business, status inherited down the team.
Traps: the spend chart sums money in the browser (`spend-chart.ts`, `values.reduce`); Chausar must take every total from the engine. Autopilot is one switch that ships without review; Chausar keeps its always-ask floor.
Corrections to the 21 Oct card: none found (the posture, command floor and approval store claims hold).
Already in Chausar?: Team shows posture, step gates, spend and runs only (`text/en/team.json`); no instructions, voice, memory, health, icon, pause or stop (the audit lists "stop a run" as not built). Suggestions exist only for client fields (`text/en/clients.json:34-38`). No charts, no manifest, no OS notifications.

---

## cloudflare/cloudflare-os (Apache-2.0, 11,523 stars, last commit 2026-10-22)
Source: full.
New findings:
- Pricing: a free daily allowance per person, then bring your own billing account (`packages/workshop-backend/src/ai-gateway-billing/limits/usage-checker.ts:1-60`). If the person connected an account with enough balance, calls bill to them and the free counter is not used; otherwise the free counter is used and blocks at zero. The out-of-allowance dialog (`packages/workshop-frontend/src/components/billing/OutOfCreditsModal.tsx`) has three branches: not connected (connect, or wait: "your free requests reset at 00:00 UTC, in 3h 12m 5s" with a live countdown, `ResetCountdown.tsx`), several accounts (pick one), low balance (top up). "Maybe later" closes it. It re-checks when the window regains focus after the connect pop-up.
- Approvals honesty: every action description is treated as incomplete unless its connector marks it complete; then every approve surface shows "This description is incomplete: part of what this action will send isn't shown." (`components/IncompleteDescriptionNotice.tsx`).
- Visual: avatars are initials on a colour picked by a hash of the id from a fixed list of 10 muted hues; the photo loads only when scrolled into view (`components/PersonAvatar.tsx`). Presence shows at most 3 faces plus a count (`GadgetPresence.tsx`).
- Schedules: a calendar shape instead of cron text: once, interval, or calendar (hourly, daily, weekly with weekdays, hour, minute, time zone) (`packages/gatekeeper-scheduler/src/schedule-types.ts`).
- Sharing levels: "Workspace" (edit, chat, manage) or "Gadget only" (use the page without chat or editing) (`ShareModal.tsx`). A viewer of a shared page that read private data must pick one of their own accounts that can read the same data, or the page will not open (`ObserverConfigModal.tsx`, header comment).
- Mobile: below 768 px the sidebar becomes a drawer with a dimmed backdrop, Escape and navigation close it (`components/AppShell/AppShell.tsx:33-140`).
Take for Chausar:
- Engine and UI (pricing for the hosted tier): free daily allowance, then the owner's own AI key or account; with a working key the allowance is not spent. The "out of allowance" sheet offers connect, or wait with a countdown.
- Engine and UI: a `descriptionComplete` flag on every proposed outside action, default false, and the incomplete line on the Today row (for a post with a video, an email with attachments).
- UI: client and agent marks as initials on a stable muted colour (Team, Clients), if the founder accepts colour there.
- Engine: store recurring work in the calendar shape with the owner's time zone ("every Monday 09:00, Asia/Kolkata").
- UI (later, client portal): "page only" sharing for a live order status page.
Traps: the "Context & Skills" entry in the navigation opens a frosted design mock of a page that does not exist (`routes/context.tsx`, `components/ComingSoonPreview.tsx`). Chausar must not ship a place that is a picture of a feature.
Corrections to the 21 Oct card: none found (`overseer.ts` is 13,681 lines; `plans/step-transactionality.md` is still a plan; `autoApprovable` is in `gatekeeper-kit/src/actions.ts:166`).
Already in Chausar?: No allowance or BYO billing split (the AI page says "You pay the AI company directly", `text/en/connections.json`). No incomplete-description flag, no avatars, no schedule shape in the UI.

---

## omnigent-ai/omnigent (Apache-2.0, 10,952 stars, last commit 2026-10-23)
Source: full in the repo. In this pass the local checkout failed (C: disk full) and was read from git objects with `git show`; the `web/` folder is in HEAD, so the "staged as deleted" note in the 21 Oct frontend study was a local checkout problem, not the repo.
New findings:
- Agent customisation (`web/src/pages/settings/CustomAgentConfigForm.tsx`): a custom agent is name, description, harness, instructions and its tools. Saving over a newer version says "This agent changed. Reload the latest configuration before saving. Your draft is still here."; a removed tool row reads "Will be removed when you save." with "Undo removal"; leaving asks "Discard unsaved changes?".
- Unattended work always asks: any agent call that creates or updates a scheduled job parks for approval (`omnigent/policies/builtins/safety.py:425-460`, `ask_on_scheduled_task_change`); deleting one does not ask "because deleting a task only removes future runs". Adding a policy from chat always asks too (`safety.py:327-350`, `ask_on_add_policy`, injected unconditionally).
- Automations page (`web/src/pages/TasksPage.tsx`, `web/src/components/scheduled/suggestions.ts`): three suggestion chips with coloured icons ("Follow-up monitor", "PR sweep", "News digest") prefill the create form and leave the schedule for the person to confirm. A code comment explains why "Mark all as read" was removed: there is no unread state, "so it would act on nothing".
- Mobile (`web/ios/README.md`): a thin SwiftUI web-view shell over the server's own web app, sign-in in the system sheet, foreground local notifications, app badge, and a notification tap that routes into the web app. It says plainly that it does not do push (APNs) or background polling.
- Team: members page with invite link and last login (`web/src/pages/MembersPage.tsx`); sharing levels read, edit, manage with an admin cap on public sharing (`SharingPage.tsx`). Usage page: total cost, daily cost chart, sessions (`UsagePage.tsx`).
Take for Chausar:
- Engine: add "an agent creates or changes a recurring job" and "an agent adds or loosens a rule" to the always-ask floor; deleting a job stays free.
- UI: the agent instruction editor wording for a stale save ("Your draft is still here") and "Will be removed when you save" with undo.
- UI principle: never show a control that acts on nothing; remove it until the state behind it exists.
- Mobile (phone companion, later): web-view shell, foreground notifications only, tap opens the single approval; say "no push yet" until push exists.
Traps: none new.
Corrections to the 21 Oct card: (1) "unpriced counts as 0.0, so the budget simply steps aside" is out of date: `omnigent/policies/builtins/cost.py:30-50,114-135` now fails closed, denying every turn after the first once tokens were used with no price ("asking the user to switch to a priced model"); the first turn on an unpriced model still runs. (2) The open question on `sys_add_policy` is answered: every call asks the user (`safety.py:327`); it is not limited to stricter policies, but nothing is added silently.
Already in Chausar?: Ink's always-ask floor covers money out, sending, deleting, prices and portals (design section 7.3), not scheduled-job changes. No agent editor, no phone shell.

---

## decionis/docker (Apache-2.0, 165 stars, last commit 2026-08-25)
Source: partial (the policy engine and verdicts are hosted at api.decionis.com, as the 21 Oct card says). The Docker Desktop extension UI (`extension/ui/src`) is full and was not covered.
New findings:
- Shadow summary tiles (`extension/ui/src/features/decisions/SummaryStrip.tsx`): Evaluations, Would approve, Would block, Would escalate, Review required, Policy mismatches and Near misses, each a large tabular number with a small label and a share "of evaluations"; a missing count shows a dash, never zero. Mode line: "Shadow mode: decisions are recorded and nothing is gated." (`features/connection/EnforcementControl.tsx`).
- First-run demo (`features/demo/DemoPolicyPack.tsx`, `DemoPolicyResults.ts`): the starter rules run on sample cases in three lanes, "Benign reads", "Destructive actions", "High-value changes", and the real verdicts come back as chips. "Nothing in this component executes the proposed action"; the REVIEW chip appears only once it happens.
- Pricing and onboarding: a workspace starts temporary with a free allowance of governed decisions and no owner: "This workspace is temporary: it has no owner, keeps the free allowance, and is lost if this extension is removed. Claim it to keep it." Then "This workspace has used all N free governed decisions." (`EnforcementControl.tsx`). Claiming is a browser sign-in returning to a loopback port (`internal/daemon/oneclick.go`).
- One vocabulary module (`extension/ui/src/protocol/VerdictLabels.ts`): verdict words rendered exactly as the published enums, a tone per verdict, unknown values shown as they are in a neutral tone, and a test that fails if the enums drift (`extension/ui/test/VerdictLabels.test.ts`).
Take for Chausar:
- UI: a shadow-week summary on the agent sheet: "would have gone out 14, would have been held 3, you would have changed 2", counts from the engine, a dash when unknown. It is the evidence an owner needs to move an agent from shadow to approve-each.
- Onboarding: after the plan, rehearse the agents on three sample orders (routine, risky, high-value) and show which ones would be held; nothing leaves Chausar.
- Hosted tier: start without an account; the business is temporary until claimed, said in one sentence.
- Engine: one module for every state word, a drift test against the engine's enums, unknown states shown verbatim.
Traps: the demo needs the hosted service; the open client alone decides nothing (already noted 21 Oct).
Corrections to the 21 Oct card: none found.
Already in Chausar?: Postures exist with plain meanings (`text/en/team.json`), but no shadow summary and no sample-case rehearsal on first run. Text catalogues exist; no enum drift test was seen in this pass.

---

## Floe-Labs/floe-guard (MIT, 357 stars, last commit 2026-10-21)
Source: full (the hosted Floe service is separate and closed).
New findings:
- Budget-aware plans (`examples/plan_complexity.py`, `js/src/guard.ts:150-210` `advisory()`): the agent reads an advisory before each round (share of budget used, near-limit flag, estimated calls left, per-step headroom, spend per minute) and drops optional sub-tasks first ("polish tone", "cross-check claims") while the required ones finish; the model stays the same. Nested steps can carry their own caps.
- Rate card (`js/src/rate-card.ts:1-50`): the owner's own rates override list prices; resolution is per-call override, then your rate, then the bundled list, then refuse. Each rate carries `confirmed`: list prices are `false`, typed rates are `true`, with source URL and retrieved date.
- Business type: AI phone calls. Pre-call admission gates for inbound calls (`js/src/gates.ts`) answer each provider's webhook (Retell, Vapi, LiveKit) with admit or reject from the remaining budget; a call already admitted is never cut off. The README prices one call by leg: phone line, speech-to-text, model, voice.
- Pricing of the hosted product (README lines 15-40): free, one key, no card, 7-day history, up to $2K a month tracked; the hosted ledger "ties spend to client and campaign, shows your margin per client, and lets you invoice your own customers off the actuals".
Take for Chausar:
- Engine: mark playbook steps required or optional; under budget pressure skip optional ones and say so on the run sheet ("Skipped polishing to stay within this month's limit"). An honest alternative to the unbuilt "drop to a cheaper model".
- UI: a budget meter on Money and on each agent: share of the monthly limit used, a near-limit line, and "about 12 more drafts at today's cost" labelled as an estimate.
- Engine and UI: AI cost per client and margin per client in Money, from receipted spend tagged by order.
- Playbook (new business type): an AI phone receptionist for local shops and clinics; calls admitted only within budget; cost per call by leg. Connector: Retell or Vapi webhook, `planned`; voice disclosure required.
Traps: money as floats (already noted). The near-limit preflight is non-binding by its own admission (`gates.ts:20-30`); only the reserve is binding.
Corrections to the 21 Oct card: none found.
Already in Chausar?: Partly: Money has "Limits and rates" with "Your rates", the source and "checked {date}" (`text/en/money.json:101-128`); there is no confirmed-versus-list flag, no advisory, no optional steps, no per-client margin. Side note: the monthly limit there is typed "in millionths of a US dollar: 5000000 is 5 US dollars" (`money.json:106`), which a B2C owner will not manage.

---

## deer-flow/llm-space (MIT, 2,042 stars, last commit 2026-10-12)
Source: full.
New findings:
- Onboarding (`apps/desktop/src/components/onboard-dialog.tsx:60-120`): the first-run dialog lists providers whose API keys it already found on the machine ("Provider detected"), offers one-click Add, and recommends three more; failure reads "Provider check did not finish. Open model settings to continue."
- Otherwise a developer workbench; the generate-a-definition popover, model and provider avatars and the rubric scorecard add nothing for an owner.
Take for Chausar:
- UI: "Connect your AI" first checks what is already on the computer (keys in the environment, installed AI command-line tools) and offers each as one click, with the plain states LongHorizon uses below.
Traps: a "Star LLM Space on GitHub" reminder dialog (`apps/desktop/src/components/github-star-reminder.tsx`) and analytics events fired from onboarding choices (`onboard-dialog.tsx`, `track(...)`); Chausar should not nag or track by default.
Corrections to the 21 Oct card: none found (still macOS only, README line 78).
Already in Chausar?: No: `places/connections/YourAi.tsx` asks for a key and connects; no detection.

---

## AMAP-ML/LongHorizon-Harness (MIT, 1,762 stars, last commit 2026-10-21)
Source: full now. At d53df0a the repo holds `src/lh_harness` (about 20,000 lines of Python), the React dashboard in `frontend/web` and `frontend/core`, and tests.
What it is (correcting the 21 Oct card): the harness code is in the repo, not only on PyPI.
New findings:
- End-of-round owner gate (`src/lh_harness/dashboard/gate.py`, `rules.py`): one hook after every round, with five triggers: finished ("Task complete. Continue the run?"), round limit reached (the owner can grant N more rounds), the manager needs an answer (its question shown with quick-answer buttons), blocked, and repeated failure (N failing rounds in a row: "The run may be looping; operator input is requested"). Options are only Continue or End/Stop, plus an optional instruction carried into the next round.
- Steering a live run: notes typed while it runs are queued and carried into the next round ("Sending continues the run", "Submitted. Waiting for the worker to pick it up…", `frontend/web/src/App.tsx`).
- Two-step stop (`App.tsx` strings): Stop lets the worker "finish up and write its report" (state "Stopping"); if that fails, "Force stop" says what is lost: "this run will not write a report". Resume ("Continue from the rounds already finished instead of starting over") is separate from Restart ("Start a new task from round 1 with the same task and configuration").
- Status vocabulary (`frontend/core/src/statusView.ts:1-80`): done, active, stopping, pending, waiting, blocked, failed, cancelled, skipped; every stage has a short summary sentence and the full detail behind it, and every round a "Next step".
- Provenance and honesty lines: changed files are labelled "From the workspace diff; not attributed to the Agent"; "Internal prompts are hidden; only the actionable summary is shown"; per-backend capability notes ("currently runs CLI/code tasks only; computer-use and MCP are not included"); local tool detection says "Not installed", "Installed but not runnable", or "on PATH but cannot run: <reason>".
- A checker that edits what it checks: if the auditor changes workspace files, its claims are declared invalid, the files are restored and the step is blocked (`src/lh_harness/auditor_agent.py:225-265`, `read_only_violation`).
Take for Chausar:
- Engine and UI: the owner gate after each delivery round with those triggers, especially "3 failed tries in a row: ask the owner instead of trying again" and "limit reached: allow 2 more tries?".
- UI: Stop, then Force stop with its stated loss; Resume versus Start again. Fills the audit's "stop a run".
- UI: a steer box on the run sheet that queues a note for the next step.
- UI: label files a run changed "changed during this run, not proven to be the agent's"; "skipped" and "stopping" as states.
- Engine: a check that alters its input voids its own verdict.
Traps: "read-only" roles are a tool deny-list run under Claude Code's `bypassPermissions`, and the code says the approval system and sandbox are "deliberately bypassed" (`src/lh_harness/adapters/claude_permissions.py:24-70`). Do not copy that as a safety boundary.
Corrections to the 21 Oct card: (1) "the source isn't in this repo ... no harness code here to reuse" is wrong at d53df0a: `src/lh_harness/`, `frontend/web/`, `tests/` are present (MIT). (2) "the Manager and Auditors get read-only permissions" is overstated: they lose the Write and Edit tools under bypass mode, and auditor writes are caught after the fact and rolled back, not prevented. The defaults (25 rounds; 300 s manager and auditor, 1,800 s executors, `src/lh_harness/config.py:96-106`) and "WSL2 only on Windows" (README line 196) hold.
Already in Chausar?: The auditor role is built (design 7.7). No end-of-round owner gate, steer box, two-step stop, resume, or "skipped/stopping" states in Ink (`text/en/common.json` has only "This run stopped." and "paused").

---

**Quality and data group**

## useopendesk/opendesk (Apache-2.0, 429 stars, last commit 2026-10-22)
Source: full (one file, `internal/helpdesk/imports/nul.go`, can't be checked out on Windows because "nul" is a reserved name; nothing depends on reading it).
New findings:
- Pricing and plans: `contracts/billing.md`. Free ($0, 1 mailbox, 1 member, $0.50 of AI a month), Pro ($18 per seat, $10 of AI per seat pooled), a hidden Collab tier an admin can offer, and self-hosted (unlimited, own AI key). "Every feature is on every plan; plans differ only in limits." Viewers are free seats. Downgrading deletes nothing; it only blocks adding more. AI is metered at the provider's real cost times a markup (default 1.5), kept in integer micro-dollars. A call is refused before it starts when the balance is below its estimate; failed calls cost nothing; calls on the workspace's own key cost $0 here but still write a usage row. Top-ups from $5 to $5,000 never expire and are spent after the monthly allowance. Auto-recharge is off by default (threshold, amount, monthly limit), retries a soft decline after 1, 6 and 18 hours, then turns itself off and notifies.
- Billing UI: `web/src/components/billing/`. `Meter.tsx` is a 4px bar, green under 80%, amber from 80%, red past the cap. `AiBalanceBanner.tsx` is a calm strip for owners and admins only, when the balance is low or out, dismissed per state and per period, hidden on the billing page itself ("The AI balance is running low. {remaining} left. Ollie pauses when it runs out."). `UsageChart.tsx` stacks spend by feature per day with "Show as table" and arrow-key reading. The public price page (`site/src/pages/pricing.astro`) says "Pricing, plainly" and lists each model's price and the cost of a typical draft.
- Notifications: `contracts/api.md` "Notification preferences and emails". Everything lands in the in-app bell; each type also has email, push and desktop channels, set per workspace with sensible defaults. Account-wide cadence: instant, hourly, or a daily digest at a chosen hour in the owner's timezone; a pause of up to 30 days (what arrives meanwhile is never sent later). Pacing: the first email waits 5 minutes and goes only if still unread; cooldowns grow 15m, 30m, 1h and reset after 2 quiet hours; urgent types may cut a cooldown (at most 6 a day); hourly and daily caps; nothing is emailed while the person was active in the app in the last 5 minutes. One grouped email per burst ("Maya Chen mentioned you #1095 and 4 more", "Since 14:05: 2 assigned, 1 mention, 3 replies"), with "Needs you now" first.
- Mobile: `ios/` is a native SwiftUI app (inbox, ticket, reply, assign, the AI's suggestions; settings stay on the web). `contracts/native.md`: push direct, or through a relay that sees only the instance, the notification type and a number, never ticket text or names, with requests signed by an Ed25519 key derived from the server secret. Browsers get Web Push (VAPID keys derived from the same secret) and `/manifest.webmanifest` makes the web app installable. A phone or browser subscription lives exactly as long as its sign-in session; each phone can mute types.
- Talking to and customising agents: `contracts/bots.md`. A bot is name, role, language, look and a structured personality: tone (friendly, professional, playful, concise, warm, or custom text), instructions (up to 4,000 characters), reply length (short, medium, detailed), emoji (none, some, lots), greeting, handoff line, blocked topics (up to 20) and email sign-off. The persona is one delimited block placed after the fixed rules, and "never overrides the rules about facts, tools, data and safety". The builder (`web/src/components/bots/`, strings in `web/src/i18n/locales/en/bots.json`) has three tabs, Look, Personality and Test; Test runs the unsaved edits ("Testing your unsaved changes."), offers three try-questions, and the playground returns what the reply cost. Each bot shows "Answers on {list}"; a bot in use can't be deleted and the message names where it is used. A per-agent monthly cap (`widget_monthly_cap_usd`, `contracts/agent.md` "Guardrails") silences the agent, hands work to people and notifies once a month.
- Avatars: a bot's look is one JSON of allow-listed parts (shape, solid or gradient fill, eyes, mouth, accessory, accent, blush, background; or an emoji or an uploaded picture). A pure function renders the same SVG in the browser, the widget and the server (`web/src/lib/botlook.ts`, `internal/ai/bots/render.go`, shared fixtures in `web/src/lib/botlook.fixtures.json`); a seeded "Shuffle" picks from curated palettes; a PNG endpoint serves email and push. Idle blink, "thinking" bob and a small bounce when a reply lands are CSS only and stop under reduced motion. No user SVG or URL ever reaches the renderer.
- Onboarding: `GET /v1/onboarding` computes nine steps from the workspace's real data (`internal/core/onboarding.go`), each with who can do it and where to go. `web/src/components/onboarding/Checklist.tsx`: "Get set up", a progress bar, one row per step with an icon, steps the viewer can't do yet disabled with a quiet reason, one celebration when the last step lands (none under reduced motion), dismiss per member, and a compact sidebar entry. Imports (`contracts/imports.md`) from Zendesk, Help Scout, Freshdesk, Intercom or CSV go Check (signs in, shows counts and three sample tickets as they will look, stores nothing), Start, Watch (progress events), Sync (bring over changes while switching) and Undo (removes exactly what it created; tickets touched since are kept). The empty Reports page shows labelled sample data: "A preview of what this page shows once tickets arrive. None of these numbers are real." (`web/src/i18n/locales/en/reports.json`).
- Team and department views: `contracts/teams.md`. Teams with lead, member and observer roles, a private flag, their own hours, SLA, saved replies and assignment; brands (what customers see) are separate from teams (who does the work). Team and brand pickers appear only once a workspace has a team or a second brand. Availability dots (online, away, offline) with an open-ticket cap per person (`web/src/components/presence/availability.tsx`). Reports by person and by team (`web/src/components/reports/AgentTable.tsx`, `TeamBrand.tsx`).
- Agent report: `contracts/agent.md` "Report": conversations, resolved without a person, handoffs, ratings, cost, a by-day series, tool errors, and up to 20 "gaps" (questions the agent handed off or couldn't answer), shown as "Knowledge gaps: questions the agent couldn't answer from your knowledge ... ready to become articles" (`web/src/i18n/locales/en/agent.json`).
Take for Chausar:
- Playbook: "Customer support desk for small shops". Offers: shared-inbox handling, a chat widget answered by a named bot, help-centre articles, a monthly report with satisfaction and knowledge gaps. Steps: import the client's history (check, preview, undo), draft articles from the top questions, the agent drafts replies (suggested mode), the owner approves each until rehearsal shows it is safe, handoffs reach the owner, the monthly report lists gaps to teach. Earns a monthly retainer per client inbox; AI cost passed through at a stated markup. Connectors: client mailbox read and reply-draft (`read` plus `handoff`; sending is `write` only after approval), chat widget on the client's site (`planned`).
- Engine: notification pacing (first-email delay, growing cooldowns, urgent bypass with a daily cap, hourly and daily caps, no email while active), cadence with a daily digest hour, a pause, and per-type channels. The build audit lists "OS notifications and quiet hours" as not built.
- Engine: Chausar's own plan model: monthly AI allowance, never-expiring top-ups spent after it, auto-recharge with a monthly limit, "low" and "out" alerts at most once a month, own key at zero cost but recorded; refuse a call when the balance is below its estimate (Chausar already reserves before a call). Price in rupees.
- Engine: a per-agent monthly spend cap that pauses that agent and puts a row on Today, not a silent stop.
- Engine and UI: agent persona as typed fields in one block placed after the fixed rules; an agent sheet with Voice and Test tabs where Test runs unsaved changes on practice clients.
- Connector: Web Push plus an installable manifest for the hosted web tier; for the desktop vault, a relay that carries only "2 things need you" (type and count, no text) to a phone.
- UI: a progress bar and count over the existing launch checklist; usage meters that turn amber at 80%; labelled sample data in empty charts; hide team and brand controls until there is a second one.
- Engine: import clients and history with check, preview and undo (from a spreadsheet, Tally or Zoho export).
- Engine: "gaps": what an agent could not do from the business's own knowledge, listed for the owner to teach.
Traps: the UI computes shares and percentages (`web/src/components/reports/Bars.tsx`, `Math.round(value / total * 100)`), which Chausar's no-arithmetic-in-UI rule forbids; a call with no provider-reported cost is charged a "typical cost" estimate that the bill does not label as an estimate; bot faces, the violet AI tint and celebrations give the AI a personality, which the founder's design note rejects (decide before taking avatars); all money is in US dollars.
Corrections to the 21 Oct card: none found (checked: Propose and Apply, the token never reaching the model, theme defaulting to light in `web/src/lib/theme.ts`).
Already in Chausar?: the launch checklist is already computed from records (`platform/runtime/venture/core/checklist.ts`, setup rows in `platform/runtime/venture/views/queue.ts`), but Ink shows no progress visual; reserve-then-settle spend exists (`docs/venture/ink.md`, "Spend, judge, playbooks"). No notifications, no persona editing (`app/ui/src/places/team/` has posture, gates and spend only), no plans or top-ups, no import with undo, no web push.

## trycompai/crm (MIT, 11,578 stars, last commit 2026-10-22, branch `release`)
Source: full.
New findings:
- CRM and pipeline: fixed deal stages with a tone each (`apps/app/lib/deal-stage.ts`): Demo booked (neutral), Qualified to buy and Decision maker in (info), Contract sent (warning), Closed won (success), Closed lost (error), Unqualified (neutral). `apps/app/components/crm/stage-stepper.tsx` draws the open stages plus Closed won as a thin top-border rail; clicking a step moves the deal; a lost deal shows its end state after the rail. Close-date filter: Overdue, Closing this month, Closing next month, Later, No close date (`components/crm/closing-window.ts`).
- Visual richness: the Overview (`apps/app/app/(app)/[slug]/sales-dashboard.tsx`, `dashboard-summary.tsx`) has four stat cards (closed won this month with change against last month, open pipeline with what is due this month, win rate over a window, average deal and cycle days) whose empty states are words ("Nothing has closed yet", "No wins to measure"); an area chart "Closed won vs. new pipeline" over six months; a donut "Open pipeline by stage" with a legend list where each row links to the filtered deals; biggest open deals; overdue tasks with Mark as done; recent activity. A "Me / Everyone" toggle scopes every figure. An "Enriching N" popover lists research jobs with running, queued or failed dots and elapsed time (`components/enrichment-queue.tsx`). Companies carry a logo, icon and brand colour from domain enrichment (`packages/db/prisma/schema.prisma` logoUrl, iconUrl, brandColor; `docs/crm-plan.md` section 9); people and companies without a picture get an initials monogram (`packages/ui/src/components/person-avatar.tsx`, `docs/connections.md` "Brand marks").
- Talking to agents to build them: the chat home reads "Ask about your CRM, tag a record or integration, or describe an agent to build to automate a task." with suggested agents ("Flag deals with no activity for 14 days", "Hand new customers from Sales to Onboarding") (`components/agent-builder/agent-builder-home.tsx`). "New agent" asks for a name and "What it should do", then "Hand to the builder" (`new-agent-dialog.tsx`). Each agent has a capability page (`agent-capabilities.tsx`): "What it can do there", "What it can see", "Connected tools", "If it is off here, it cannot do it."; a save makes a new version; "An agent that does nothing cannot be saved"; an empty record list is refused because it would open every record. When the builder can't work something out it asks with a Questionnaire (`docs/connections.md` "The Questionnaire", `packages/ui/src/components/questionnaire.tsx`): ask only what can't be derived, say what was already worked out, give each choice a fact that helps decide (member counts, last activity), always offer an escape, footnote the constraint, and make the submit label restate the answer ("Use #sales", not "Continue").
- Connections (`docs/connections.md`): every connection says what it "brings in" and what it "sends"; an empty Sends is stated as a guarantee ("Nothing, so nothing here can change HubSpot"). Destinations are derived (never asked; the UI says so) or chosen (asked once, in the builder chat). Permissions are grouped with counts. Each surface leads with liveness ("Last call arrived 31 minutes ago", "1 call needs a look", "3 of 4 matched"). "Irreversible things are bounded in writing" next to the switch ("never messages the same deal twice in a day"). MCP connections choose read-only or read-and-write.
- Website lead capture (`docs/tracking.md`): a first-party script on the owner's own site; "a form submission becomes a contact", and page views only give that contact a story; the contact shows original and latest source (`components/crm/website-activity.tsx`); pausing stops every browser within five minutes.
- Seats and roles (`docs/crm-plan.md` section 6): owner, manager, rep, read-only; enforced in the API middleware and again by an ownership check in the service; hiding a button is "presentation only".
- Mobile: a record sheet becomes a bottom drawer on small screens (`apps/app/components/responsive-sheet.tsx`).
- Planned, not in code: a model-written 0 to 100 deal score and "forecast context" (`docs/crm-plan.md` section 9, Phase 11; no `dealScore` anywhere in the code). Stalled-deal detection "needs no model at all" and exists as a days-since-activity filter on the agent's `list_deals` tool (`apps/agent/agent/tools/list_deals.ts`).
Take for Chausar:
- Playbook: "Lead generation and appointment setting for local businesses". Offers: a researched list, outreach drafts, follow-ups, booked meetings, a weekly pipeline report. Steps: build the list from enriched fields, research each lead with evidence, draft, the owner sends, track stages to "meeting booked", report. Earns per qualified meeting or a monthly retainer. Connectors: lead sources `read`, email `handoff` (the owner sends; Chausar already enforces this), calendar `planned`.
- Engine: a stalled-client rule with no model ("No reply from Asha in 14 days") that raises a Today row.
- UI: a stage rail on each client and lead; a pipeline donut whose legend rows open the filtered list; stat lines with word empties; a Me / Everyone style scope once a business has a human helper.
- UI: Connections rows that say "Brings in" and "Sends" in plain words, a liveness line, and the agent's limits written beside its switch.
- UI: the Questionnaire rules for every agent question on Today and in the run sheet.
- UI and engine: build or adjust an agent by describing it in a sentence, then confirm on a capability page ("What it can see", "What it can do"), each change a new version.
- UI and connector: client logos and brand colour from their website domain, initials when none.
- Connector: a form-to-client script for the website Chausar builds (`planned`).
Traps: the UI computes percentage change (`sales-dashboard.tsx`, `changeDelta`); the planned deal score is a model number and would need the "model estimate" label; the builder writes agent code, which an owner can't review (Chausar should keep agents as playbook data); stat cards, coloured donuts and "bloom" dither effects clash with Ink's "no colour blocks" rule, so take the structure, not the paint.
Corrections to the 21 Oct card: "with the last commit August 2026" (`cards/quality-data-ops.md`) is wrong: the `release` branch has commits to 22 October 2026 and GitHub showed a push on 20 October. The home description in `frontend/approvals-ops.md` ("Me / Team toggle", cards for deals, tasks and activity) is out of date: the toggle reads "Me / Everyone" (`overview-scope.tsx`) and the home now leads with the sales dashboard above.
Already in Chausar?: partly. Ink lists leads with New, Drafted, You wrote, Replied, Not now, Blocked (`app/ui/src/text/en/clients.json`) and has the provenance underline (`app/ui/src/parts/Provenance.tsx`) and question choices in the run sheet (`app/ui/src/parts/RunSheet.tsx`). No stage rail, no charts, no stalled rule, no per-agent capability page, no "brings in / sends" wording.

## HelixDB/helix-foundry (Apache-2.0, 1,641 stars, last commit 2026-10-23)
Source: full.
New findings:
- Onboarding (`docs/onboarding.md`, `apps/web/src/onboarding.tsx`): the AI choice comes first (Local, Claude or OpenAI) and Continue opens the Data step at once while the provider is checked in the background. "Continue with sample data" loads imitation sources and moves on while they load. Progress is computed by the server; there is no writable "done" flag. "Save and finish later" leaves setup, and Overview offers "Resume setup". "Large or failed imports are never replaced with sample data." If every AI-built chart fails, a computed overview that needs no model replaces it (record counts, records per entity, new records per month).
- Connection guides (`apps/web/src/connection-guides.tsx`): numbered steps beside each form for making a least-privilege key (Stripe: create a restricted key, Read for the named objects, None for everything else, try sandbox first, "Stripe shows it only once").
- Talking to the agent by voice (`apps/web/src/areas/analyst/voice.tsx`, `apps/api/src/live.ts`): hands-free voice over WebRTC inside the ordinary chat. The voice model must hand any question about business data to the analyst backend: "Never state, estimate or guess workspace numbers, names or trends unless the backend returned them." A router sorts each utterance into ask, clarify, end or none and rewrites it as one standalone question "never adding facts or numbers". A single answer is read aloud with its numbers; a table gets a one-line headline and "the details are in the chat below". Voice only answers; "it never builds or changes anything". Every voice failure ends with "or keep typing".
- Ties named together: before the summary call, code works out leaders, duplicates and missing values and passes them in, so the model never names a single leader when rows tie (`apps/api/src/assistant.ts`, around lines 1040 to 1078).
Take for Chausar:
- UI and engine: voice on Today, in Hindi and English: ask "what needs me?" or "how much did Lumen owe?"; read-only; every figure comes from the engine with its receipt; anything that changes something stays a row to approve.
- UI: a step guide beside each connector form for a read-only key (Razorpay, Zoho Books, Google).
- UI: onboarding with a labelled sample business, "Finish later" and "Resume setup"; never swap failed real data for samples.
- Engine: a computed fallback for any model-made summary on Money and Work.
Traps: the question and summary prompts still tell the model to divide Stripe cents by 100 (`apps/api/src/assistant.ts` lines 961 and 1078), which is arithmetic by the model; voice runs only on OpenAI's realtime model, a paid dependency.
Corrections to the 21 Oct card: none found (README line 101 still says macOS only; the dark theme is still "beta" in `apps/web/src/shell/CommandPalette.tsx:175`).
Already in Chausar?: no voice, no connector key guides, no sample-business onboarding. Ink's dev fake engine shows "Sample data. Nothing here is real." (`app/ui/src/text/en/common.json`), but that is for development only.

## NVIDIA/SkillEvaluator (Apache-2.0, 587 stars, last commit 2026-10-22)
Source: full.
New findings:
- Engine: lift now has a verdict, pass, neutral, fail or inconclusive, and an exact McNemar test on the paired cases where only one side passed, in exact fractions, with the smallest p-value the number of such cases could ever reach; too few cases reads "inconclusive" (`src/skillevaluator/evaluation/tier3_report.py`, `_mcnemar_exact_probability` near line 4597 and `_verdict_policy` near line 3497; verdict order in `src/skillevaluator/reporting/base.py:684`).
- Visual: an HTML report (`src/skillevaluator/reporting/html.py`, `templates/report.html.j2`) and a local dashboard on loopback with telemetry off (`reporting/dashboard.py`). Developer tools, nothing for owners.
Take for Chausar:
- Engine: when rehearsal reports whether a playbook helps, say "Not enough practice cases to tell yet" until the paired cases could reach significance, instead of showing a raw difference.
Traps: none new.
Corrections to the 21 Oct card: none found (still version 0.6.0 in `pyproject.toml`).
Already in Chausar?: no (the build audit lists with/without-playbook lift as not built).

## braintrustdata/agentbehavior (Apache-2.0, 360 stars, last commit 2026-07-28)
Source: full.
New findings:
- Customising agents from feedback: `.agents/skills/writing-agent-behavior/references/deciding-what-to-save.md` has an "elevation test" for turning feedback into a lasting rule: keep it only if it is recurring, consequential, a real choice, observable, durable and debuggable; write it at a "useful altitude" (a stable trigger and observable conduct, not one case or one tool); "distinguish a user-approved principle from an agent's inference"; a hypothesis stays a note "until someone with authority confirms".
- A support example fits the support desk playbook above: `examples/.agents/behaviors/support-ticket-triage/BEHAVIOR.md` (priority from impact and evidence, not tone; route with a summary and open questions; a documented fallback queue marked uncertain).
Take for Chausar:
- UI and engine: when the owner sends work back in their own words, the agent proposes the lasting rule it would keep, written at that altitude, and asks "Keep this as a rule for every client?"; only the owner's yes saves it to the playbook.
Traps: none new.
Corrections to the 21 Oct card: none found.
Already in Chausar?: no (the build audit lists "send back with your own words" and correction-driven review as not built).

## QwenLM/open-computer-use (MIT, 295 stars, last commit 2026-06-11)
Source: full.
New findings:
- Onboarding: `apps/OpenComputerUse/Sources/OpenComputerUse/PermissionOnboardingApp.swift` is one window: "Enable {app}", "needs these permissions to use apps on your Mac. These permissions are only used when you ask it to perform tasks.", one row per permission with Allow, a "Restart to finish enabling this permission" state, and "All required permissions are enabled." at the end.
- Visual: `packages/OpenComputerUseKit/Sources/OpenComputerUseKit/SoftwareCursorOverlay.swift` draws a separate agent cursor over the screen, on by default (`OPEN_COMPUTER_USE_VISUAL_CURSOR`), so the person sees where the agent acts.
Take for Chausar:
- UI: if computer use ever ships (it is `planned`), use a distinct agent cursor and one permission window with the "only used when you ask" line.
Traps: none new.
Corrections to the 21 Oct card: none found.
Already in Chausar?: no.

## rollroyces/py-idp (AGPL-3.0 or paid commercial; learn only, copy no code; 294 stars, last commit 2026-10-19)
Source: full.
New findings:
- Document templates (`templates/bank_statement.md`, `invoice.md`, `contract.md`, `id_card.md`, `medical_claim.md`): Markdown with frontmatter (file name patterns, classification hints), the fields, and a "Common mistakes" list (debits shown as positives, masked account numbers kept masked).
- Schema from a sample: `src/idp/discover.py` turns one PDF plus a plain hint ("extract vendor name, invoice number, total") into a schema.
- Review UI (`src/idp/hitl/app.py`, Streamlit): model and human values side by side, bulk accept at confidence 0.9 or more, a confidence histogram, j/k/s keys. Triage (`src/idp/hitl/triage.py`): a field is a "systematic error" when it was corrected in 60% or more of at least 3 reviews; with fewer reviews the report says there is not enough data.
Take for Chausar:
- Playbook: a document data-entry service for CAs and shops (bank statements and bills into the books), with one template per document type that carries its common mistakes.
- Engine: per-field correction rates on Today: "Invoice dates were corrected 4 of 5 times. Fix the rule instead of checking each one." (idea only, re-implement).
Traps: the bank statement template asks the model to check that opening balance plus transactions equals closing balance; no code does it (`balance_mismatch` appears only in the template), so it is arithmetic by the model; bulk accept rests on a heuristic confidence that does not measure correctness.
Corrections to the 21 Oct card: none found; the AGPL or paid dual licence and "Solo $300 a year" are confirmed (`LICENSE` line 41). Note: `CHANGELOG.md` now has an unreleased 0.6.0 adding an Unlimited-OCR backend; `pyproject.toml` still says 0.5.0.
Already in Chausar?: no (bank statement import exists but feeds nothing, per the build audit).

---

**Creator group**

## Jakeschincariol/youtube-agent-skill (MIT, 2131 stars, last commit 2026-09-16)
Source: full (11 SKILL.md files, 6 Python tools, `templates/voice.md`).
New findings:
- Customising agents: `templates/voice.md` has six fixed headings: who I talk to (one named person, not "creators"), how I actually talk (paste three transcripts), words I never use, words I do use, **what I will not claim** (numbers, results, tools I have not used), my format. Every skill reads it; if missing, the skill asks for three videos and writes the file itself (`skills/yt-plan/SKILL.md` "Before you write" step 1).
- Planning: `skills/yt-plan/SKILL.md` sizes a week to the owner's real hours: asks "how many hours do you actually have" and "what is already half-made", then one anchor video, one cheap one built from something that exists, three Shorts cut from the anchor. Output is a table (day, format, working title, the one-sentence promise, what already exists) plus "how many hours this costs, and what to drop first if the week goes wrong".
- Community: `skills/yt-comment/SKILL.md` sorts comments into four piles (questions, corrections, praise, bait) and says the count in each before writing; replies under 30 words; names the ONE comment to pin (the question most people share); never replies to bait.
- Offers: `skills/yt-audit/SKILL.md` ends in exactly one fix for this week, three things already working "so they do not break them", and what NOT to do yet. `skills/yt-seo/SKILL.md` has a "query test": write the three searches the video should win and check the title and first two description lines contain those words. `skills/yt-shorts/SKILL.md`: 20 to 55 second spans that open on a complete thought, contain a turn and end on a line; show the top five with timecode and first line; write a NEW first line, two-second on-screen text and a loop point for each.
Take for Chausar:
- Playbook: two fixed-price YouTube offers a solo owner can sell: "Channel audit, one fix" (title set, thumbnails at feed size, first 15 seconds of three videos, upload rhythm; ends in one fix, three keeps, one don't) and "Weekly plan sized to your hours". Steps: gather last ten titles and three transcripts, compute (title lint, hook score already in platform `playbooks/youtube/checks.ts`), write, owner approves, client receives.
- Engine: a business voice profile with a "What I will not claim" list that feeds the existing claim checks as banned claims, and a "write it from three of your videos" bootstrap when empty.
- UI: the comment-triage header line ("84 comments: 41 keyword, 2 lead...") as the first line of any reply-draft review, so the owner sees the shape before reading drafts.
Traps: none new.
Corrections to the 21 Oct card: none found (11 skills, 6 tools, 60/40 title limits and 60/40 hook weighting all verified in `skills/yt-package/title.py:17` and `skills/yt-script/hookscore.py:81`).
Already in Chausar?: filler, restart and dead-air findings from `skills/yt-edit/deadair.py` already exist as `retentionRisks` (platform `playbooks/youtube/checks.ts:321`). No voice profile, plan, audit or comment-triage offer: `YOUTUBE_OFFERS` (platform `playbooks/youtube/playbook.ts:34`) has only episode package, shorts from own video and licensed clips.

## AgriciDaniel/youtubepro (Apache-2.0, 422 stars, last commit 2026-08-28)
Source: full.
New findings:
- Visual: research page draws "Top videos by views" as ranked inline bars (plain divs, rank number, title, figure; `N/A` when a count is missing, never 0) and a "Duration mix" donut captioned "Format balance in the returned sample" (`client/src/pages/research.tsx` around lines 1199 to 1290, recharts only for the donut).
- Client deliverable: one click exports a PDF research report (`client/src/lib/pdfGenerator.ts`) plus CSV and XLS (`client/src/lib/research-export.ts`). Every KPI tile carries a caveat note ("Median views: less distorted by viral outliers", "Videos analyzed: maximum 50 per search call"), every chart has a subtitle ("Freshness mix, not proof of topic growth"), the evidence section is headed "Public YouTube Data API metadata for this returned sample, not channel-owner Analytics", and a "Public data coverage" block says how many videos had engagement, subscribers, captions and tags (`pdfGenerator.ts` lines 260 to 310).
- Recording aid: a built-in teleprompter (`client/src/pages/script.tsx:743`): scroll speed from spoken words only (stage directions excluded), 100 to 200 wpm picker, text size 24 to 48 px, fullscreen, Space to play or pause, a cues toggle that shows or hides stage directions, edit with undo and redo, progress.
- Thumbnail starting points: seven "outcome presets" (tutorial, comparison, result reveal, case study, news, list, review), each worded to avoid false claims ("Lead with the real outcome while avoiding an unsupported before-and-after claim", "frame the evaluation question without implying a verdict") (`client/src/pages/thumbnail.tsx:72`). A variation needs a written "direction" before it runs. Under the preview: "16:9 output, no visible app watermark requested. Invisible SynthID provenance remains." (`thumbnail.tsx:354`).
- Onboarding: Settings shows one row per key with what it unlocks ("Required for video search and research data") and a button straight to the provider page ("Open Google Cloud credentials", "Open Google AI Studio"); placeholder flips between "Paste API key" and "Enter a replacement key" (`client/src/pages/settings.tsx:283-296`). A "controller guide" dialog lists the five places with icons and "Recommended order: Research, Script Writer, then Thumbnail Creator" (`client/src/components/controller-guide.tsx`).
- Mobile: the sidebar becomes a sheet under the mobile breakpoint (`client/src/components/ui/sidebar.tsx:69`); nothing else is phone-specific.
- Errors: every failure carries `category`, `retryable` and a `suggestion` sentence; quota failures are named per stage ("YouTube quota was unavailable during search") (`server/youtube.ts:84-101`, `thumbnail.tsx` `readFailure`).
Take for Chausar:
- Playbook: "Niche research report" as a sellable one-off for YouTube consultants: code computes medians, ages and coverage; the model writes the interpretation labelled observed or inferred; the PDF carries a caveat under every figure and a coverage block. Owner approves the PDF before it goes to the client.
- UI: caveat line under every figure and chart in Money and in client reports ("sample of 50", "not your own analytics"); ranked inline bars with `N/A` for unknown as the first chart style for Ink (fits ink-and-grey better than tiles).
- UI: a teleprompter view for any approved script (owner-on-camera businesses: coaches, doctors, CA explainers).
- UI: per-key rows in Your AI that say what each key unlocks and link to the provider's key page.
Traps: the PDF uses five accent colours and tinted tiles; keep the caveats, not the palette.
Corrections to the 21 Oct card: none found (dark default, IndexedDB, snapshot ids verified: `client/src/App.tsx:80`, `client/src/lib/workflow-storage.ts:30`, `server/youtube.ts:170`).
Already in Chausar?: no teleprompter, no research report, no caveat-per-figure rule; Ink `places/connections/YourAi.tsx` has key fields and a monthly cap but no "what it unlocks" line or provider link (`text/en/connections.json:28-60`).

## veedstudio/open-edit (Apache-2.0, 1698 stars, last commit 2026-10-07)
Source: full (the hosted VEED and fal services are outside the repo, as before).
New findings:
- Batch approval: `cli/src/commands/generate-set.ts` puts SEVERAL paid shots under ONE approval. The set is hashed as a whole, order included ("two shots swapped is a different video"); each shot still runs under its own derived key (`poem-1`, `poem-2`) with its own charge record, so one failed shot leaves the paid ones alone.
- Wallets: `cli/src/veed/workspace.ts` resolves which workspace pays in one place: explicit choice, else remembered, else "only one, so take it and SAY which", else ask with every workspace's balance. An unreadable balance shows as unknown, never zero. If the chosen workspace cannot cover the quote it stops with "Nothing spent" and never moves to a richer one (`cli/src/commands/generate.ts:818-831`). Credits are one figure summed across four buckets (`cli/src/veed/allowances.ts`).
- Rights and provenance: `cli/src/commands/stills.ts` fetches real pictures from Wikimedia Commons because the licence and attribution come in the same response; a still with no stated licence is recorded as `unknown`, to be revisited before shipping. `cli/src/providers/assets.ts` keeps a manifest per run: kind, provider, model, prompt, derived-from, cost (`null` = "not measured", never 0), and `supersededBy` ("it was still billed"). Its comment cites a 12-minute film shipped "with 78.0% real footage and a per-shot account of where every second came from".
- Editing standards: `.claude/skills/open-edit/CUT.md`: measure cut points with `speech-probe` (transcript word boundaries are not cut points; no gap found means do not cut), move word timings with `retime-transcript` instead of paying to transcribe the cut again, and refuse sources whose colour or frame rate disagree. Free route first: `background-removal` stops with fal's price and only `--fal` buys (`SKILL.md` tools table).
Take for Chausar:
- Engine: a set approval on Today: "Approve this week's 5 posts" binds one hash over the ordered set plus the total quote; each item keeps its own journal entry and charge record. Big convenience for B2C owners without loosening the bound-approval rule.
- Engine: an asset record per deliverable file (source, licence or `unknown`, attribution, model, prompt, cost or "not measured"); a check blocks delivery while any asset licence is `unknown`; a provenance line on the draft ("62% your footage, 38% generated") feeds the AI disclosure.
- Engine: which-wallet rule for owners with several AI keys or businesses: never pick silently between two, say which when there is only one, unknown balance is not zero, stop rather than switch.
- Connector: Wikimedia Commons stills, `read`, licence and attribution recorded.
Traps: the cost estimates for VEED and fal remain the authors' own figures.
Corrections to the 21 Oct card: none found (one-hour approval `generate.ts:142`, spent approval removed `generate.ts:1146`).
Already in Chausar?: bound approvals, reserve-then-settle and unknown-price refusal are built (docs/venture/ink.md "What the engine added"); set approval, asset licence records and the wallet rule are not. Rights are recorded per order (`rightsBases` in platform `playbooks/youtube/playbook.ts:38`), not per asset.

## diffusionstudio/editor (MPL-2.0, 3363 stars, last commit 2026-10-19)
Source: full for the app; generation, `listen` and billing run on Diffusion's paid cloud API. MPL-2.0: ideas only, copy no files.
New findings:
- Pricing and plans: Free gives "the full editor, unlimited projects, unlimited exports" and 50 credits; Pro 25 USD a month (20 yearly) with 2,500 credits, Plus 50 (35) with 5,000, Max 150 (100) with 15,000 (`apps/web/src/lib/checkout.ts:18-32`). Paid tiers sell AI work only ("Let AI edit your videos", "Generate video, images & voice", "Top up credits anytime") (`apps/web/src/components/dashboard/plans-view.tsx`). Annual toggle with savings; a subscriber switches plan in the billing portal, which prorates upgrades and moves downgrades to period end.
- Credits view: one usage bar with percent, "Resets in N days, on <date>", a top-up grid of five credit packs as radio tiles, and a "Need more?" section (`apps/web/src/components/dashboard/ai-credits-view.tsx`). Billing info and invoices have their own views (`billing-info-view.tsx`, `invoices-view.tsx`).
- Tray: `apps/desktop/src/tray.ts`: busy and idle icons; busy lingers 1.5 s after the last tool call so it does not flicker; status line "An agent is working..." or "Ready for agents"; the last project; on Windows a one-time balloon the first time the window closes: "<app> is still running. Agents can keep using it in the background. Open it again from here."
- Home and onboarding: `apps/web/src/components/dashboard/home-view.tsx`: one large question ("What should we edit?"), one prompt box with a target picker (new project or one of eight recent), drag, drop or paste files, and a placeholder that cycles three example requests (500 ms fade, 2.4 s hold) only while the box is empty. Recent projects are tiles with a cover image captured as the project closes (`apps/web/src/projects/cover.ts`); "collections" are folders kept in the app's records (`apps/web/src/projects/collections.ts`).
- Your AI: the chat runs the user's installed Claude Code or Codex; each has a status of ready, not-installed, signed-out, error or checking, with one fix line ("Install Codex, then reopen the picker", "Run `codex login` in a terminal") (`packages/agent-chat/src/protocol.ts:15-27`, `packages/agent-chat/src/host/codex.ts:431-443`). The MCP page detects nine agents on the machine by marker files and writes the server entry into each with a switch (`apps/desktop/src/mcp-config.ts`, `components/dashboard/mcp-view.tsx`).
- Customising agents: a "house style" folder (`docs/brand/README.md`, `design.md`, `voice.md`, `video.md`, `library.md` plus reusable lower third, title card, end card): it is the fallback only; any style the brief, project or user supplies wins "in whole or in part" and the house style fills the gaps; check the library and reuse the closest item before making a new one.
- Editing standards: `docs/guides/walkthroughs/talking-head.md`: open on the first word, 0.3 to 0.5 s between sentences, butt words together mid-sentence, end with up to 0.8 s; then check the first frame of every clip for motion blur.
Take for Chausar:
- UI: Chausar's own plan page for the B2C tier: the app is free with your own AI key; paid plans sell hosted AI credits only; one usage bar with the reset date; top-ups as five tiles. All figures from the engine.
- UI (desktop): upgrade Chausar's tray (`app/desktop/main.cjs:80-88` has a static "Open Chausar / Quit") to busy or idle, "2 need you" in the menu, and the one-time "still running" balloon on Windows.
- UI: onboarding box gains a "for which business" picker, file drop, and two or three cycling example sentences while empty.
- UI: Your AI shows each CLI's five states with one fix line each.
- Engine: brand kit per client with precedence: client kit beats business house style beats Chausar default, field by field; agents check the kit's library before making a new asset.
Traps: the home page examples ask to clip other people's YouTube videos (`home-view.tsx:92-93`); Chausar's examples must use owned material. Dense 11 px editor UI stays out.
Corrections to the 21 Oct card: none found.
Already in Chausar?: Ink has a tray with a static menu (`app/desktop/main.cjs:80`), one fixed onboarding placeholder (`text/en/onboarding.json:3`), availability states for AI (`text/en/connections.json` "Can connect / Needs setup / Not here") but no CLI signed-out state, no plans or credits view, no brand kit precedence (social reads a brand kit as an order file: platform `playbooks/social/playbook.ts:210`).

## krakonjac300-pixel/podcast-shorts-factory (MIT, 128 stars, last commit 2026-07-22)
Source: full.
New findings:
- Notifications: `factory/notify.py` sends every event three ways, each best-effort so a failure never breaks the run: an `activity.md` feed, newest first, in plain words ("Posted X", "Queue ready with 3 clips", "Upload failed: ..."); a Windows toast through PowerShell; and a phone push through ntfy.sh on a secret topic with a click-through link.
- Onboarding: `factory/setup_wizard.py` asks only five things (AI provider and key, niche, platforms, call to action, notifications), is safe to re-run, and edits config lines without losing their comments. Provider presets mark which are free (OpenRouter free model, Groq, Gemini, local Ollama) and give the exact key page for each (`KEY_URLS`). Seven niche presets (money, fitness, mindset, comedy, sports, tech, relationships).
- Team and learning: ten numbered agents with job titles. `factory/agents/trainer.py` runs weekly: backtests the Finder's predicted scores against real views to find its bias, then proposes ONE change to ONE craft playbook, written between TRAINER markers so it can be read and reverted; the Manager signs off; `editorial-standards.md` (the MUSTs) can never be touched.
- Persona: the comment voice is one editable paragraph in config (`community.persona`, `factory/agents/community.py:22`). When the posting scope is missing, replies are drafted to `comment_drafts.md` "and flagged, never lost".
- Data shape: `factory/db.py`: source, clip (status candidate, approved, rejected, edited, uploaded), upload (platform, url), metrics snapshots per upload over time.
Take for Chausar:
- UI: an Activity line per business in plain words, newest first ("Draft ready for Asha Foods", "Invoice 0418 sent"), separate from the receipt journal.
- Connector: phone push via ntfy as a cheap optional "tell my phone" before the phone companion exists: `write`, carries only "3 need you" and a deep link, never client names or figures (topics are public to anyone who knows the name).
- Engine: learned changes go into one marked, reversible section of one playbook; a protected standards file no learning step may edit; prediction-versus-actual backtest as the trigger. This sharpens the Piece 9 loop already in the 21 Oct card.
- Engine: a missing permission turns an action into a draft for the owner, never a silent drop.
- UI: "Connect your AI" lists free options first with their key pages (fits "cheap BYO models").
Traps (new): `community.py` posts AI replies to viewers unattended as "the bloke who runs the channel" with no disclosure and no approval when the scope exists (`community.py:212-218`). `config.yaml:57` `auto_approve_top: 3` approves the top three candidates on unattended runs.
Corrections to the 21 Oct card: "Uploader defaults to private" is true only of the code fallback (`factory/agents/uploader.py:146`); the shipped `config.yaml:144` sets `privacy: "public"` ("auto-uploads post live to YouTube (hands-off)"), and scheduled posts are private only until `publishAt`. Also the card's platform fact "API projects that haven't passed Google's audit get their uploads locked private" is out of date: Chausar's own `docs/venture/ink.md` (Known limits, Posting) records that YouTube's `videos.insert` page, updated 15 October 2026, no longer says that; the creator playbook's connector table should be corrected.
Already in Chausar?: no activity feed, OS notifications or quiet hours (build audit lists them as not built); learning loop exists only as the owner-adopted improvement loop.

## Jakeschincariol/instagram-agent-skill (MIT, 2275 stars, last commit 2026-09-13)
Source: full.
New findings:
- CRM and pipeline: `skills/ig-dm/SKILL.md` allows only three DM kinds: the reply to a hand raised (keyword comment, poll, story reply), the warm approach (weeks of real comments first) and the collab or brand pitch. "If there is no trigger, there is no message." Keyword delivery sends the promised thing in message one with no gate, then one question answerable in four words. Exactly two follow-ups: +4 days with something new ("if there is nothing new, there is no follow-up") and +10 days closing the loop; then stop. Collab pitch is four lines: what you watched them do, the idea, what they get, what you need.
- Comment triage: `skills/ig-reply/SKILL.md` sorts into six buckets with counts first (keyword, lead, substance, question, support, noise); a high-like question becomes a Reel idea, not just a reply; noise is skipped "Replying gives them reach".
- Repurposing: `skills/ig-repurpose/SKILL.md` inventories a long asset into claims, numbers, stories, mechanisms, mistakes and quotable lines, with counts, before writing; fewer than four items means the source is thin and it says so; format follows the item (story or mistake to Reel, mechanism to carousel, quote to a story frame); hook formulas must vary across the week.
- Carousels are 1080 x 1350 (`README.md` table, `skills/ig-carousel/SKILL.md`).
Take for Chausar:
- Playbook: "Instagram for a local business or coach": weekly repurposing from one owner video, keyword-comment delivery drafts, community reply drafts by bucket, two follow-ups per warm lead; the owner sends everything (DMs stay `handoff`).
- Engine: a lead or DM record must name its trigger (comment id, story reply, keyword) just as a lead needs a source URL; follow-up dates are fixed at +4 and +10 days and a follow-up draft must contain something new. This fills "follow-up dates, Replied and Lost" from the build audit.
- Engine: repurposing inventory as a compute step with counts and a "thin source" stop.
Traps: none new beyond the 21 Oct card.
Corrections to the 21 Oct card: it says "Five Python tools"; the repo has six (`caption.py`, `beats.py`, `hookscore.py`, `humanize.py`, `detect.py`, `swipe.py`). The README's "five tools that actually run" leaves out `swipe.py`.
Already in Chausar?: social has a "Community reply drafts" offer with every reply on the floor (platform `playbooks/social/playbook.ts:157,191`) and house-style checks (em dash, AI-tell words: `records.ts:479-485`); no trigger field, no follow-up schedule, no repurposing offer (social offers are content calendar, community replies, monthly report, UGC ads: `playbook.ts:138`).

## Agent-Field/reels-af (Apache-2.0, 118 stars, last commit 2026-06-04)
Source: full (the AgentField control plane and OpenRouter are outside).
New findings:
- "Decide first, default no": optional decoration is a schema where the model must set `emit_overlay` (default false) and give a reason BEFORE it may fill the overlay, limited to six named patterns, so it is not carried into adding one by momentum (`src/reel_af/agents/accent.py`).
- Captions by code: `src/reel_af/planning/cards.py` packs word timings into caption cards at 5 words, 1.9 measured lines, a gap over 200 ms or clause punctuation, whichever comes first.
- Bring your own endpoint: `REEL_AF_API_BASE` and `REEL_AF_API_KEY` override OpenRouter, so a local or self-hosted model works (`tests/test_byo_endpoint.py`).
- Another business: `scripts/run_arxiv_batch.py` turns research papers (arXiv URLs) into reels in parallel with one summary at the end: explainer reels for academics, labs or ed-tech pages.
Take for Chausar:
- Engine: the decide-first schema for every optional agent action (add a sticker, add a follow-up, add an upsell line): boolean first, default false, reason saved.
- Engine: deterministic caption chunking rules for any captioned deliverable (owner can't see them, but every clip reads better).
- Playbook: "Paper or article to explainer reel" for academics and coaches, only from a fetched source with quoted spans (21 Oct trap still applies), AI voice disclosed.
- Connector: a custom OpenAI-compatible base URL in Your AI (for local models), `write`.
Traps: none new.
Corrections to the 21 Oct card: none found.
Already in Chausar?: no decide-first schema, no caption packer; Your AI takes a key and a model id but no base URL field (`text/en/connections.json`).

## bridge-mind/bridgeclip (MIT, 378 stars, last commit 2026-10-01)
Source: full for the app; the Jev judge is a hosted model (see corrections).
New findings:
- Choosing autonomy in plain words: `src/renderer/components/WorkflowPicker.tsx` offers two cards: "Automatic", chip "Beginner friendly", outcome "Go straight to finished clips", steps "Find → Check → Export"; "Review & edit", chip "For advanced users", outcome "Make the final cut yourself", steps "Find → You edit → Export". A small illustration replays only when chosen.
- Reading the agent's judgement: `src/renderer/components/JevTrace.tsx` shows each check as its exact question text, the answer ("72.0% yes"), "Required: Yes probability ≥ 70%", a Pass or Below threshold chip, a fold with the exact answer criteria, and earlier evaluations marked superseded. Honest gaps: "Exact question text was not saved for this evaluation", and an older trace with no threshold shows none ("Do not invent one").
- Tuning without re-spending: `src/renderer/components/EditorialWeights.tsx` sliders (0 to 5) re-rank clips from judgments already recorded: "No new AI calls"; missing context or an unresolved payoff still requires review whatever the score. `JevSettings.tsx` lets the owner edit each threshold, shows "N customized" with a reset, and states the consequence of off ("uses the planner's proposed clips and cuts without Jev checks or repairs").
- Talking to the app: the assistant (`src/main/assistant/system-prompt.ts`) runs on the owner's Claude or ChatGPT subscription through the CLI (sign-in finished inside the app, `components/assistant/AssistantSettings.tsx`) and drives the whole app by tools: find videos, start jobs, library, automations, posting. It may change some settings (custom vocabulary, review switches) but never keys or the library folder; a `show_in_bridgeclip` tool opens the page so the owner sees what it did; publish, delete or spend shows an approval card, and "don't ask for permission in text first".
- Onboarding: `components/SetupCard.tsx` puts the one missing key inline on the Create page instead of sending the owner to Settings, says "BridgeClip has no account and no server. One OpenRouter key covers transcription ... and clip selection", adds "Your key is encrypted on this computer with your system keychain", lists missing tools by plain name, and disappears when done.
- Visual: nine caption presets with a live preview and a one-line purpose each ("Boxed: readable on any footage", "Editorial: serif for podcasts & stories") (`components/CaptionPresetPicker.tsx`). Accounts are grouped into profiles, "one account per platform, for another brand or project", shown as platform tiles with status (Not connected, connecting, Reconnect, Disconnect) and "Showing the accounts from <time>" (`pages/AccountsPage.tsx:255-400`). Setup steps carry honest hints ("The first two connected accounts are free on most platforms; X may require a card", "Zernio only shows it once").
- Scheduling rules: `src/main/automations.ts`: a slot that comes due while the queue is busy still posts if freed within 60 minutes, otherwise it is reported as missed; "nothing ready" is reported once per slot; each blocked reason is a sentence ("Apply or discard the enhanced metadata drafts before these clips can post"); a file whose size, modified time or inode changed since review is not posted.
Take for Chausar:
- UI: show posture as two or three plain cards when an owner starts an offer ("Let the team finish it, you check samples" against "You check every piece"), with outcome and a step string; maps onto the existing posture ladder.
- UI: a check detail view in the run sheet: each judge rule's exact question, the verdict, its floor, pass or below, the cited evidence, earlier attempts as superseded; "Not checked" and "not saved" stay honest. This is how an owner reads why an agent's draft was held.
- Engine plus UI: "Your preferences" sliders that re-rank already-judged options in code with no new AI call; hard failures still go to review.
- Engine: an agent-editable settings allowlist (agents may change e.g. vocabulary or schedule; never keys, money policy, posture or storage) and a `show` tool that navigates Ink to what the agent just did.
- UI: inline first-run key on the page that needs it, with the keychain line; profiles per client grouping that client's platform accounts as tiles (social agency).
- Engine: missed-slot and changed-file rules for scheduled posts once posting exists.
Traps: the hosted judge's probabilities cannot be reproduced or audited offline (see below); score chips and glass panels stay out (21 Oct).
Corrections to the 21 Oct card: (1) Jev is OFF by default for automatic clipping (`src/shared/jev-settings.ts:12-21`: `jevEnabled: 'off'`; it always runs only in Review & edit), so the unattended path does not pass the typed gate unless the owner opts in. (2) Jev is not a local rules engine: it calls a third-party hosted judge model, `typesafe/jev-1.13`, through OpenRouter's alpha "decisions" endpoint at a priced rate (`engine/clip_engine/services/jev_service.py:19-22`); Chausar can copy the question shape and floors, not the calibrated probabilities. (3) The card lists six floors; there is a seventh, sufficient evidence at 50% (`src/shared/jev-settings.ts:8`).
Already in Chausar?: posture ladder with plain meanings exists (Ink `text/en/team.json` `team.postureMeans.*`), but is chosen per agent in Team, not offered as a choice card at start; check results show only as an evidence label (`parts/RunSheet.tsx:117`, `run.notChecked`); no agent chat, no settings allowlist for agents, no preference sliders.

---

**Finance and commerce group**

## Invaro/opentax-engine (AGPL-3.0, 163 stars, last commit 2026-10-11)
Source: full (core, cli, mcp, corpus-us-federal, plus `solve`, `compose`, `playground`, `site` and a `harness` folder the 21 Oct card did not mention).
New findings:
- What-if tools, all computed by real evaluations, not a model: `packages/solve/src/compare.ts` (same facts across every value of one choice, here filing status; failed scenarios are reported, not dropped), `marginal.ts` (tax on the next 100 as an exact difference of two runs), `cliffs.ts` (coarse sweep, then binary search to the exact cent where one more unit of income costs more than itself), `invert.ts` (bisection for "what input makes the answer X"; refuses if the function is not monotone in the range), `lookup.ts` (finds the amounts behind a plain question such as "standard deduction" with citation and validity window). Exposed as MCP tools `find_tax_cliffs`, `compare_filing_statuses`, `lookup_tax_parameter`, `verify_fact`, `explain_rule` (`packages/mcp/src/server.ts`).
- Agent transcribes, code decides: `packages/mcp/src/documents.ts` takes form boxes verbatim (W-2, 1099s) and does the classifying, summing and reconciling in code. It throws if the same value arrives both raw and pre-digested, flags transcription errors (qualified dividends above total, line 465), lists every box not transcribed and therefore treated as zero (`missing`), and lists every return item the documents call for that the build cannot compute, by form and line with reason and action (`unsupported`, `completeness.ts`). Strict mode refuses on any entry.
- Differential testing: `harness/REPORT.md` runs 572 scenarios against PolicyEngine US; 93.2% agree to the cent, every other difference is triaged in `harness/known-differences.json` with the primary source quoted, and "unexplained disagreements" must be zero.
- B2C usability (playground, `packages/playground/src/page.html`, `main.ts`): one-click example scenarios (`PRESETS`), fields grouped by plain headings, a result "ledger" with dotted leaders ("You owe" / "Your refund", "Refund expected next April"), defaults shown as "assumed (default)" in the proof tree, a lazy expandable proof tree, a second tab "Verify a proof" that re-derives offline, and refusals written as two kinds: "More facts needed, the engine never guesses" with the missing list, and "Refused: outside the encoded law".
- Extra business types (site use cases, `site/src/app/page.tsx`): second-engine review of a return prepared in other software, quarterly estimated tax for lumpy freelance income, sole proprietor vs company comparison, "what changes for me under the new law" client letter.
- Pricing: hosted MCP "free to try" with an OTP console and key rotation (`site/src/app/api/console/*`); commercial licence by sales call (`COMMERCIAL-LICENSE.md`).
Take for Chausar:
- Engine: a what-if layer on top of the existing India income-tax calculator: both-regime comparison (old vs new) as compare-across, the 87A rebate edge as a cliff finder, "how much more can I earn or invest before X" as inverse, all as receipts. Idea only (AGPL).
- Engine: a document compiler for Form 16, AIS and 26AS: the agent copies boxes verbatim, code classifies and sums, and the run carries `missing` and `unsupported` lists that feed the NEEDS_FACTS question to the client.
- Engine: differential tests of Chausar's tax calculator against an independent computation (the department's own calculator outputs captured as fixtures by a CA), with a known-differences file that quotes the rule for each accepted difference.
- Playbook (CA firm, new offers): "check a return prepared elsewhere" (recompute and list lines that differ, each with the rule) and "advance tax working for freelancers" (instalment amounts and dates from the calculator; dates and sections need CA confirmation under the Income-tax Act, 2025).
- UI: one-click examples on the tax working and quote screens; "assumed" marked on every default the calculator used; the two refusal kinds as plain sentences.
Traps:
- The playground adds deductions and credits in the browser and works out "% of income" with a float (`main.ts` `renderLedger`, around lines 205-255), although the file says every summary number is a derivation node. Chausar's UI must add nothing.
- The playground footer says "Apache-2.0" while every `package.json` says `AGPL-3.0-only`: treat it all as AGPL.
Corrections to the 21 Oct card: none wrong. It missed the `solve` layer, the document compiler and the differential harness, which are the most useful parts for a B2C tax product.
Already in Chausar?: partly. An India income-tax calculator with 87A marginal relief exists but is unreachable (`platform/runtime/venture/playbooks/ca-firm/income-tax.ts`; build audit item 2). No compare, cliff, inverse, document compiler or differential tests; the build audit lists "AIS/26AS/Form 16/2B readers" and "both-regime comparison" as not built.

---

## NidheeshJain/itr-prep-skill (MIT, 32 stars, last commit 2026-07-30)
Source: full (one SKILL.md, ten references, one script).
New findings:
- B2C intake shape (`references/01-interview-and-form-selection.md`): round one is three multi-select questions (income sources this year, job changes, "what do you want": full filing help, just form and regime, compute tax, verify a drafted return, prep checklist). Round two only asks what round one opened (residency, foreign assets, earlier losses, a yes/no disqualifier sweep). "Derive, don't ask": date of birth comes from AIS, not the user.
- The form chooser is a first-match table (ITR-3 or 4 for any business income, then ITR-4 presumptive, then ITR-2, then ITR-1) with named traps (one F&O trade makes it business income; foreign RSUs force Schedule FA).
- Deadline consequences in plain words: a belated return loses loss carry-forwards; ITR-U costs 25-70% extra tax; old regime for business filers needs Form 10-IEA before the due date and allows one switch back (`01-...md`, "Filing-section basics" and "Provisional regime call").
- Handoff: ends with a ready-to-paste prompt for a browser assistant, but "you stay the preparer until the return is filed" (`references/10-json-output-and-verification.md`, line 127).
Take for Chausar:
- Playbook: the "what do you want" answer as five priced ITR offers (full help, form and regime, computation, check a draft, checklist only) instead of one big offer; each is a smaller order a first-time client can buy.
- Engine: the form chooser and the regime-switch rules as code with dated rows, not prompt text; the agent only asks the questions the rules need.
- UI: client questions in two rounds, multi-select first, with one sentence of why for any technical question.
Traps: none new beyond the 21 Oct card.
Corrections to the 21 Oct card: none found (the `--dangerously-skip-permissions` line is at `README.md:43`, the self-install at `SKILL.md:73`).
Already in Chausar?: the CA firm playbook has ITR prep as one offer (`docs/superpowers/designs/2026-10-21-chausar-frontend-ink.md` 7.8); no split offers, no form chooser.

---

## noskillish/bankmcp (MIT, 290 stars, last commit 2026-10-22)
Source: full.
New findings:
- Ready "money check-up" products as MCP prompts (`src/prompts.ts`): savings scan (90 days, at most three findings ranked by money at stake and urgency, each with confidence and one action, "if nothing is worth doing, say so in one line"), monthly summary, subscription audit (cadence, latest amount, yearly cost, price rises, new ones, candidates to cancel), unusual transactions (large, duplicate within three days, first-time payees, old pending), build a budget. Each offers the next one rather than doing it.
- Own-transfer detection in code (`src/data.ts` `findOwnTransfers`, around line 129): counterparty is one of the owner's accounts, or another connected account has the opposite amount in the same currency within two days; each pairs once; card repayments count. `monthly_summary` leaves both legs out (`src/tools.ts` around line 541).
- `search_transactions` (whole-word match on a merchant or invoice number across all accounts) and `set_account_label` (the owner's own names for accounts).
- Account attestation, off by default (`ATTESTATION.md`, `src/attestation.ts`): a signed yes/no that an account is the owner's, optionally "holds at least X", with a ceiling and a rate limit so twenty questions cannot find the balance; the verifier's token sees only that one tool; when off the tool is not registered at all.
- Onboarding: a first-run setup page that registers the provider app for the user and falls back to the manual form (`src/setup.ts`, `src/controlpanel.ts`), a consent page that says in one sentence what the server reads and that it has no payment tools (`src/pages.ts` `CONSENT_DESCRIPTION`), and a public per-country "which banks work" directory built from the provider list (`scripts/banks.ts`, `docs/banks/`).
Take for Chausar:
- Playbook: a "money check-up" offer a self-employed person can sell to households or small shops: monthly summary, subscription audit, unusual transactions and a three-finding savings scan, read only, figures from code. Keep it to spending; nothing about investments (that is SEBI-regulated advice).
- Engine: own-transfer pairing in Chausar's statement import so a transfer between the owner's own accounts is never income or spending; whole-word search across statements to match a client's payment to an invoice number.
- UI: "at most three findings, most expensive or urgent first, say if others were dropped" as the shape of an agent's report row on Today.
- Connector: "is my bank supported" list before asking for consent, once an Account Aggregator provider is chosen (`planned: read`).
Traps:
- The prompts have the model compute totals, savings rate and yearly costs; in Chausar those must be receipts from code, or labelled model estimate.
- `src/controlpanel.ts` drives Enable Banking's undocumented control-panel API (fail-soft, manual path kept). Do not build on undocumented provider APIs.
Corrections to the 21 Oct card: not wrong, now incomplete. Watches also cover `balance_above` and `debit_matching` (`src/watcher.ts` lines 93-112); the float `total_in`/`total_out` is now at `src/tools.ts:501`.
Already in Chausar?: the consent, polling cap, twin ids and owner-set alert address are built (`platform/runtime/venture/build/bank.ts`, credited to bankmcp). Own-transfer pairing, summaries, search and the check-up prompts are not.

---

## akaunting/akaunting (BUSL-1.1 verified in `LICENSE.txt`, learn only; 10,198 stars, last commit 2026-10-08)
Source: partial. The core is here; payment modules come through Composer (`composer.json` lines 41-42) and the paid apps the screens link to (aged receivables report, cash-flow statement, bank feeds, custom roles, estimates) are not in the repo (`app/Widgets/Receivables.php` `report_class`, `app/Widgets/BankFeeds.php`).
New findings:
- Visual state: one bar per widget, open part in orange over an overdue base in red, grey when empty, with "Overdue" opening a dropdown of 1-30, 31-60, 61-90 and over 90 days (`resources/views/widgets/receivables_payables.blade.php`; the as-of rules are written out in `app/Abstracts/Widget.php` lines 182-190). Status colours per document: paid success, partial, sent and received danger, viewed, cancelled, draft (`app/Models/Document/Document.php` lines 502-512).
- Next action per state: `status_workflow` maps draft to "send", sent, viewed and partial to "get paid", cancelled to "restore", recurring to "schedule" (`config/type.php` around line 169), and the document page shows a timeline of those steps with "Not sent", "Sent on", "Viewed", "Awaiting payment" (`resources/lang/en-GB/invoices.php` lines 58-67).
- Big-number summary row: Overdue, Open, Paid in very large type with a hairline under each, a short "for humans" amount with the exact amount in a tooltip, each a link to the filtered list (`resources/views/components/index/summary.blade.php`, `app/View/Components/Contacts/Show/Content.php` lines 80-86). No boxes.
- Client portal and signed links: a customer opens the invoice by a signed link, prints, pays or confirms (`routes/signed.php`); opening it moves the invoice from sent to viewed, but "preview mode should never mutate document visibility state" (`app/Listeners/Document/MarkDocumentViewed.php`). The owner is told "Invoice viewed" and "Payment received" in the app and by email (`resources/lang/en-GB/notifications.php` lines 181-205). A logged-in customer sees a portal dashboard of paid, unpaid and overdue per month (`app/Http/Controllers/Portal/Dashboard.php`).
- Reminders: a daily command sends overdue notices on days after the due date the owner chooses (default 1, 3, 5, 10; bills 10, 5, 3, 1 before due), off by default (`app/Console/Commands/InvoiceReminder.php`, `config/setting.php` lines 166-169), from editable templates with merge tags (`resources/lang/en-GB/email_templates.php`).
- Recurring invoices: frequency, interval, end by count or date, auto-send flag, children created automatically (`app/Models/Common/Recurring.php`; "Repeat every :interval :frequency since :date", `documents.php` line 78).
- Roles: admin, manager, customer (portal only) and accountant (reads everything including reports, writes nothing) (`database/seeds/Permissions.php` lines 83-170).
- Rate change notice: "Tax rates have changed since this record was created. The amounts below use the rates that were charged at the time. Saving keeps them unchanged." with an opt-in "Recalculate taxes using the current rates" (`resources/lang/en-GB/documents.php`, `tax_rate`).
- Onboarding: a three-step wizard (company with tax number and financial year start, currencies, finish) whose last screen is "Create your first invoice" plus recommended apps (`resources/assets/js/views/wizard/*.vue`); spreadsheet import templates per record type (`public/files/import/*.xlsx`); a sample-data seeder (`database/seeds/SampleData.php`).
- Empty states: a large title, one sentence on what the thing is and why you need it ("Customers are required if you want to create invoices. They may also log in to Client Portal and see their balance."), then a list of action rows (title, one line, chevron) and an illustration (`resources/views/components/empty-page.blade.php`, `resources/lang/en-GB/general.php` lines 334-346).
- Mobile: responsive Tailwind, a PWA manifest that points to native Android and iOS apps (`manifest.json`, `serviceworker.js`).
- Pricing: free core, app store with monthly and yearly prices, "You save X a year", pre-sale discounts; monthly plans only on their cloud (`resources/lang/en-GB/modules.php` lines 13-75).
Take for Chausar (ideas only, no code):
- Engine and playbook: overdue reminders as Today rows on days the owner picks after the due date; each reminder is a draft the owner approves (sending to a client stays on the always-ask floor); owner gets a row when a client views or pays.
- Engine and UI: a "viewed" state for invoices and drafts opened through a Chausar share link, and the owner's own preview never marks it viewed.
- Engine: recurring invoices for retainers (monthly books, monthly social management): frequency, interval, end by count or date; each generated invoice lands as a Today row.
- UI: on Money, split what clients owe into open and overdue with one thin bar (overdue in `--fail`), aging buckets on demand; a three-figure summary row (Overdue, Open, Paid) in large type with no boxes, each opening the filtered list and its receipt.
- UI: one "next action" per invoice state (Issue, Record payment, Restore) and a short timeline ("Issued on", "Viewed", "Awaiting payment").
- UI: empty states as one plain sentence plus action rows; "Create your first invoice" as the last onboarding row for a business with clients.
- UI: the rate-change banner wording for any invoice or tax working whose rate table has a newer version.
- UI: invite a read-only accountant (the engine already has the role) from the Business menu.
Traps:
- Empty states and the dashboard advertise paid apps (`BankFeeds` widget, `suggestions` in `empty-page.blade.php`); Chausar should not sell inside empty states.
- Reminders and recurring auto-send go out with no approval; in Chausar each send is approved.
Corrections to the 21 Oct card: none found; licence confirmed BUSL-1.1 with the three-limit use grant; still no GSTIN, HSN/SAC or e-invoice logic in `app/`.
Already in Chausar?: partly. Invoice states draft, issued, part-paid, paid, void (`platform/runtime/venture/money/payments.ts:49`); Ink groups drafts, open and closed (`app/ui/src/places/money/Invoices.tsx:32-34`); Money at a glance shows owed, received and spent only (`app/ui/src/places/money/Overview.tsx`). Aging buckets exist only in the older back-office calculator (`platform/runtime/calculator.ts:171`). A monthly retainer block exists (`platform/runtime/venture/core/blocks.ts:27`) but no recurring invoice. Roles owner, cofounder, accountant, viewer exist (`platform/runtime/contracts.ts:24`) with no Ink screen. No reminders, no viewed state, no charts.

---

## nexscope-ai/Amazon-Skills (MIT, 785 stars, last commit 2026-08-26)
Source: full.
New findings:
- Talking to agents: every skill gathers what the message already says, then asks one follow-up with all remaining questions as multiple choice and accepts shorthand like "1b 2c 3a" (e.g. `amazon-return-reduction/SKILL.md`, "How This Skill Works"). Three skills add a card for listing a skill: display name, one-line description and a starter prompt (`amazon-product-photography/agents/openai.yaml`).
- Extra seller-services offers beyond the 21 Oct list: category ungating, brand registry, storefront design, return reduction, coupon and deal planning, Vine, seasonal planning, wholesale sourcing, product compliance (folder names at the repo root).
- `tariff-calculator-amazon/scripts/calculator.py` and `hs_lookup.py` (1,008 lines) estimate import duty with Section 301 rates.
Take for Chausar:
- UI: agent questions as one batch of lettered options with shorthand answers accepted, alongside clickable choices.
- UI: each agent skill shown to the owner as name, one line and a "try this" starter the owner can click (Team place).
- Playbook: the extra offers above as menu items for an "Amazon seller services" business (low priority; India marketplaces still absent).
Traps: the tariff calculator uses floats and hard-coded Section 301 rates with no source or checked-on date; do not reuse its figures.
Corrections to the 21 Oct card: it says 53 skills; the repo has 52 `SKILL.md` files at 0f3b13f.
Already in Chausar?: run questions can carry choices (`app/ui/src/engine/types.ts:35`, `choices?: string[]`); no shorthand answers, no starter prompts per agent.

---

## xjli360/sealeap-ecommerce-skills (MIT, 93 stars, last commit 2026-10-16)
Source: full in the git objects. The scratchpad checkout stopped part way because drive C: filled up; files were read with `git show HEAD:<path>` (195 `SKILL.md` confirmed with `git ls-tree`).
New findings:
- Decision record (`sealeap-amazon-skills/assets/decision-template.md`, in Chinese): platform, buyer job, data window and sources, verified facts, estimates and their basis, assumptions and unknowns, eligibility, net revenue and affordable acquisition cost, counter-evidence on demand, fulfilment and cash, then GO / HOLD / NO-GO with the reason, the next check and the maximum loss. "GO only means moving to the agreed next stage; it does not authorise buying stock, listing or ad spend."
- Experiment record (`assets/experiment-template.md`): one hypothesis, baseline window and control, a single main change from old value to new, metric and its denominator, attribution and refund maturity window, budget cap and maximum cumulative loss, guardrails, continue, stop and roll-back conditions, current authorisation scope, read-back record, result with uncertainty. "Without a control or enough sample, state observations only, never causal growth."
- Operations check record (`assets/operations-template.md`): item, observed issue, raw evidence, impact, suggested action, owner and time, read-back status; record separately "request accepted, processed in the back office, shown on the storefront, real business result"; never put full order numbers, buyer identity or credentials in it.
- Rule records carry `limitations` and `used_by` (which skills depend on the rule) (`assets/rule-refresh-20261016.json`); the catalogue gives each skill a `mode` (selection, operations) and the rule ids it checks (`assets/catalog.json`).
- A new business duty: "time away readiness" for a seller going on leave: existing orders and promises first, what keeps selling, an auto-reply that states real handling times only, settings read back after saving, and a return-day backlog checklist (`ebay/sealeap-ebay-time-away-readiness/SKILL.md`). Also capacity planning for Etsy makers and box-manifest checks with tests for Walmart and Wayfair (`walmart/.../check_box_manifest.py`, `wayfair/.../check_cartons.py`).
Take for Chausar:
- UI and engine: a GO / HOLD / NO-GO card for a new offer or product with "maximum loss" and "GO does not spend anything" on it.
- Engine: an experiment record for playbook changes (one change, control window, budget cap, stop and roll-back rules); without a control the result reads "observed", never "caused".
- Engine: the four-stage read-back (accepted, processed, shown, result) as the end states of a journal entry for outside actions.
- Engine: add `limitations` and `used_by` to Chausar's platform rule register so a changed rule lists the playbook steps it touches.
- Playbook and UI: an "Away" mode for the owner: before leave, list client promises falling due, which agents keep running and which approvals will wait, an auto-reply with real response times for the owner to approve, and a return-day backlog.
Traps: none new; content is still model-synthesised Chinese advice, as the 21 Oct card said.
Corrections to the 21 Oct card: none found.
Already in Chausar?: the rule register has sources, checked-on date and how it was read (`platform/runtime/venture/playbooks/social/register.ts:17-31`) but no limitations or used_by. No decision card, experiment record or away mode. The journal has applied and verified states for site edits (`app/ui/src/engine/fake-extras.ts:421`), not the four stages.

---

## motiful/product-shots (MIT, 113 stars, last commit 2026-06-08)
Source: full (skills and a sample gallery; image generation goes to a third-party gateway).
New findings:
- Clickable answers: the hub replies with `<suggestion><label>...</label><prompt>...</prompt></suggestion>` blocks that a front end renders as chips, one question per turn (`skills/product-shots/SKILL.md`, "Suggestion Format"; `references/suggestion-format.md`).
- Brief completeness as weighted fields (platform 25%, topic 20%, visual assets 15%, optimisation 15%, audience 10%, style 10%, variant count 5%), ready at 80% (`references/brief-output-and-routing.md` lines 72-90). It is pseudocode the model follows.
- Brand kit per client: colours, fonts, logo, voice, one to three sample assets, passed to every downstream skill (`skills/product-shots/SKILL.md`, "Brand Kit Reference").
- A product photography package per product: main image, secondary images, A+ modules, a nine-angle set for apparel, ad creatives per platform, organic social posts (`assets/gallery/dress/*`, `coffee-machine/*`), with consistency rules: main image first, referenced in every later call, one background, palette, font and icon style across the set (`skills/product-shots-main-image/references/consistency-rules.md`).
- Platform safe zones for CTAs: bottom 20% of Stories, bottom 35% of Reels, right 64 px of TikTok (`skills/product-shots-ad-creative/references/color-and-cta-strategy.md` line 147).
- Per-image cost table in CNY by model (`skills/product-shots-image-gen/references/model-selection.md` line 56).
- Replies in the user's language, never switching on its own (`skills/product-shots/SKILL.md`, "Language Rule").
Take for Chausar:
- Playbook: a "product photography for online sellers" business: one product photo in, a priced package out (main, secondaries, A+, angle set, ads, social), quote before paid generation, owner approves the set, the seller uploads.
- Engine: a client brand kit record (colours, fonts, logo, voice, samples) that every creative step reads, instead of a loose file.
- Engine and UI: intake completeness computed in code from weighted fields, shown as "Brief 80% ready" on the order.
- Engine: safe-zone checks for text and CTAs as data with a source and checked-on date (the build audit lists safe zones as not built).
- UI: answer chips with a label and the exact message they send.
Traps:
- "Conversion Rate Reference Data" cites "Amazon A/B test" lifts (+18%, +32%) with no link (`consistency-rules.md` lines 102-112); never show these to a client as fact.
- The completeness score and the self-checks are model-run pseudocode, not code.
Corrections to the 21 Oct card: none found.
Already in Chausar?: brand kit only as client files (`platform/runtime/venture/playbooks/social/playbook.ts:210`); run questions can carry plain choices (`app/ui/src/engine/types.ts:35`); no completeness meter, no safe-zone check, no product-photography playbook.

---

**Marketing and sales group**

## postmill-ai/postmill-app (AGPL-3.0, 26 stars, last commit 2026-10-22)
Source: full (learn only: describe ideas, copy no code).
New findings:
- Home that says what needs you: `libraries/nestjs-libraries/src/dashboard/dashboard.service.ts:482-665` builds a "Needs attention" list in code from eight probes (failed posts, unhealthy channels, drafts pending approval, unread replies, schedule gaps in the next 7 days, monthly post allowance used, failed media jobs, analytics anomalies). Each has a severity (critical, warning, info), is sorted by severity (`:661`), carries a deep link, and each probe has its own try/catch so one broken source never blanks the list. The UI (`apps/frontend/src/components/dashboard/widgets/attention.feed.tsx`) gives each row a coloured left rule and icon by severity, a count badge, and an inline Retry or Dismiss.
- Dashboard tiles: `components/dashboard/dashboard.component.tsx` lays out Setup checklist, Needs attention, At a glance (KPI tiles), 7-day engagement line chart, Next 7 days timeline, Active campaigns, Inbox, Media queue, Usage and budget, Recommendations, Daily brief; each section is permission-gated and can be hidden from a Customize popover (`customize.popover.tsx`). Empty chart says "No trend data yet. Publish posts and connect channels to see engagement over time."
- Honest charts: `components/analytics/views/best-time.tab.tsx` draws a day-by-hour heatmap with "Based on N posts", mutes cells with a thin sample "so they don't imply false precision", and tags top slots "low confidence". `analytics/kit/derived-metrics.tsx` hides a metric whose value is null instead of showing 0. `analytics/kit/stat-tile.tsx` shrinks the font rather than truncating a number, and keeps the exact figure on hover. `views/health.section.tsx` shows per channel "Last snapshot <date>", "Stale", or "Analytics not supported by <provider>", plus coverage.
- Anomalies by code: `libraries/nestjs-libraries/src/analytics/anomaly.detection.ts` flags the latest point when its z-score against a trailing baseline passes 3, needing at least 7 baseline points; anomalies land as info rows on the home list and as a digest notification.
- AI writing is labelled: the analytics summary modal shows "Generated by AI" (`views/narrate.modal.tsx:47`). The Daily brief (`libraries/nestjs-libraries/src/dashboard/dashboard-brief.service.ts:170`) is a 120 to 180 word model summary of a JSON context, cached per org per day, generated only when the owner opens it; it is not labelled as model text on the card.
- Talking to the AI to customise it: `components/settings/brand/brand-voice.tsx` asks "How should it write?" in plain words ("like briefing a new team member"), with an on/off switch, one profile per language (Hindi included) that keeps the others when you switch, and an optional per-channel override ("more formal on LinkedIn"). `brand/knowledge-base.tsx` is titled "What the AI knows about you": add text, a URL, a file, a post or media; "Learn from my posts" indexes your best-performing past posts; a search box shows what it would retrieve; vector store choice is hidden under "Advanced settings (most people can skip these)".
- Notifications: `components/settings/notifications/notification-preferences.panel.tsx` and `agents/notifications.md`: master switches per channel (email, push, in-app), a category by channel grid (post published, post failed, channel issues, replies, AI budget, media jobs, announcements, streak reminders, agent briefs, analytics alerts) and a digest choice (instant, daily, weekly, never). One service is the only way to notify, so opt-outs can't be bypassed; chat-app DMs (Slack, Telegram, Discord, Matrix, LINE) are a fourth bucket per linked member. Its own doc admits there are no quiet hours.
- Streak: `notification.service.ts:600` sends "You have 2 hours left to keep your posting streak alive."
- Reply inbox as a light CRM: `components/comments/comment.inbox.tsx`, `comment.inbox.filters.tsx`, `comment.card.tsx`: Needs reply, Handled, Ignored tabs; assignee; sentiment and priority (set once by a sync-time classifier with a confidence, `social.comments.repository.ts:145,287`); "High priority first"; "Last synced HH:mm" and Sync now; filters live in the URL.
- Team: custom roles with a name, description and a permission set (`settings/roles/role-editor.tsx`); every dashboard section checks the member's permission.
- Onboarding: a wizard where only "connect an AI" is required and every other step says skip and change later (`components/setup/setup-wizard.tsx:73-79,183`); then a dismissible "Welcome" checklist with a progress bar, done steps green and struck through (`components/dashboard/dashboard.setup.tsx`). A demo seeder marks every sample row so a reset drops exactly those (`database/seeds/demo-seeder.ts`).
- Pricing and plans (`libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts`, `agents/billing.md`): Starter $9, Pro $29, Team $99, Agency $249 a month, yearly at ten months; limits on channels, posts a month, seats, brand kits, competitors; add-on packs priced by env with a guard that a $0 or NaN price is never created; "no paid plan" is a 402, "not allowed" is a 403; downgrades wait for the period end; a failed payment gets a grace window, then falls to Starter. AI is bring-your-own: a build-failing test stops AI credit types coming back. Owner sets the AI budget as monthly cap, daily cap and alert threshold (`components/settings/ai/org-budget.card.tsx`).
- Mobile: Apple App Store and Google Play purchases are verified server-side and push goes through FCM (`agents/providers/payments.md`, `agents/notifications.md`), so a store app exists, but it is not in this repo. The web dashboard is responsive.
- Client view: a public analytics report link scoped to a date range and chosen channels, with rotate and disable (`views/analytics-share.modal.tsx`, `views/public-analytics-report.tsx`).
Take for Chausar:
- UI and engine: a code-built "what needs you" list with severity, deep links and per-probe isolation, adding the kinds Ink's Today lacks: broken connection, gap in next week's calendar, spend at the alert threshold, a number that moved sharply.
- UI: owner-written voice in plain words, with on/off, per language and per channel; a "What the AI knows about you" list of sources with a test search. This is how an owner reads and steers an agent without editing prompts.
- Engine: one notification chokepoint with category by channel toggles and a digest setting; add quiet hours (their gap) and WhatsApp or Telegram as the chat bucket for India.
- UI: honest charts: sample size on every aggregate, thin cells muted, nulls hidden, freshness per source.
- Engine: z-score anomaly check over a trailing baseline as a code rule that raises an info row.
- Engine (for Chausar's own plans): plan table with add-on packs, refuse any zero price, deferred downgrade, grace window.
- Playbook: the reply inbox (status, assignee, priority) for the social agency playbook; label `handoff` until comment APIs pass review.
Traps: the Daily brief is model prose over figures with no "model estimate" label on the card; the streak nudge is an engagement hook to use with care; VPN egress and cookie posting are still shipped (21 Oct card).
Corrections to the 21 Oct card: `frontend/creator-marketing.md` says "Outward actions never run from the agent" and "every outward tool returns a draft that needs a click". Only comment replies and paid media go through a confirm card. The agent's toolset includes `schedulePostTool` with type `now`, `deletePost` and `approveDraft` (`libraries/nestjs-libraries/src/chat/agents/ops.agent.ts:19`, `chat/tools/integration.schedule.post.ts:136`, `chat/tools/posts.approve.tool.ts`), and their only guard is a prompt line asking the model to confirm "when ui mode is true" (`ops.agent.ts:49`). So the agent can approve a draft itself, which undercuts the "approved before promoted" gate the marketing card praised.
Already in Chausar?: Today queue, setup rows and decided-row receipts exist (`docs/venture/ink.md`); spend has a monthly cap and an ask-first figure but no alert threshold (`platform/runtime/venture/money/spend.ts:8,335`); the social playbook's voice sheet is agent-written and owner-approved once (`platform/runtime/venture/playbooks/social/playbook.ts:62-69`), with no owner-editable voice; report figures come from exports by code (`playbooks/social/report.ts:224,316`). No notifications, charts, heatmap, inbox, roles or plans in Ink (`app/ui/src/parts`).

## cogsend/cogsend (MIT, 233 stars, last commit 2026-10-21)
Source: full.
New findings:
- Delivery insights without vanity numbers: `src/lib/domain/insights.ts` buckets published and failed sends by the owner's local day (not UTC), over 7, 30 or 90 days (90 is drawn as 13 whole weeks so the last bar is not partial), with the previous period drawn over it; success rate is null and shown as a dash when nothing was attempted. `src/routes/insights/+page.svelte` adds three tiles (Published, Scheduled, Last post), a Cumulative or Bars toggle, failure reasons grouped, "No failures in this period.", and "No data yet. Publish a few posts and their delivery stats will show up here."
- Avatars that leak nothing: `src/lib/components/initials.ts` draws two-letter initials locally "rather than fetched from an avatar service, which would send the owner's name to a third party"; `AccountAvatar.svelte` puts a small platform badge on the corner of each account picture, with a ring when selected; `platform-color.ts` keeps one colour per platform shared by editor and list.
- Signed self-update (`src/lib/domain/release-check.ts`, `docs/updates.md`): Settings says "Update to vX.Y.Z from here" and a dot sits on the avatar until seen; the bundle's signature and hashes are checked; the new version is uploaded but serves 0% of traffic until `/api/health` answers with the new version number; then traffic switches and Roll back stays available; a failed step leaves the old version serving and Abort tidies up.
- Connection setup: `src/lib/domain/platform-setup.ts` records, per platform, the console link, "the step people skip" before the console issues credentials, the redirect field named exactly as that page names it, and what the platform charges.
Take for Chausar:
- UI: delivery insights for any write connector (sent, failed, by the owner's local day, against last period, failure reasons), as a first honest chart that needs no platform analytics.
- UI: client and account avatars from local initials with a small source badge.
- Engine: for the hosted tier and the website-build playbook: stage the new version at 0%, health-check that it reports the new version, switch, keep Roll back.
- Connector: add "the step people skip" and the cost line to each connector's setup data.
Traps: none new.
Corrections to the 21 Oct card: none found; it is still light only (`src/routes/layout.css:7`).
Already in Chausar?: no charts or avatars in Ink (`app/ui/src/parts`); staged, reversible website edits exist (`app/ui/src/places/business/SiteEdits.tsx`) but not a 0% deploy with a health check.

## beyondtahir/beyondseo (MIT, 190 stars, last commit 2026-09-25)
Source: full.
New findings:
- Client deliverable renderer (`docs/branded-reports.md`, `src/beyondseo/reports.py`, `render.py`): content is typed blocks (text, bullets, callout, table up to six columns, metrics of 1 to 4 items with a required source, bars of 1 to 12 non-negative values with a required source, and a full finding record). Output is a PDF, a self-contained HTML and a manifest with checksums. If the PDF renderer is missing it keeps the HTML and says why; scripts the PDF font can't draw produce a stated limitation and keep the HTML rather than boxes, which matters for Hindi.
- Work tracker with a verified state (`src/beyondseo/projects.py:25-35,282-372`): jobs are onsite, new_page, offsite_plan, report or review, and move planned, running, awaiting_review, applied, verified (or blocked, cancelled). A new page or any job marked `requires_approval` can't run or apply without a recorded authorisation; "verified" needs the change applied first plus a dated acceptance-check file; a paused project refuses moves. Its read-only monitor (`dashboard_html`, `:506`) shows per job an estimate range ("10 to 20 min" or "Not estimated"), "Not yet verified" or "Checked <date>" with coverage, counts of verified and blocked, and "Next eligible review".
- Bounded monitoring (`src/beyondseo/monitor.py:13`): 1 to 10,000 cycles, at least 60 seconds apart, a fresh evidence folder per cycle, and it refuses a folder that already holds evidence.
- An SEO agency in a box: `playbooks/industry-playbooks/README.md` (agency, AI SaaS, dental, e-commerce, education and courses, local business, medical, real estate), `playbooks/local-seo/` (Google Business Profile, NAP citations, map pack audit, local landing pages, reviews, service area), and `playbooks/templates/` (client proposal, 90-day roadmap, keyword map, content calendar, issue log, audit report).
- B2C wording: `docs/questions.md` answers owner questions directly, including "Does it need tokens, APIs or paid scraping services?" (the crawler makes no model calls and needs no keys); `docs/lovable.md` is a host guide for running it inside Lovable.
Take for Chausar:
- Playbook: "Local SEO and Google Business Profile for small shops and clinics" as an offer set: audit, profile fixes, citations check, review replies drafted, monthly report. Owner approves every change to a client's site or profile; profile edits are `handoff` (owner applies) until a Business Profile API connector exists.
- Engine: client report blocks where a metrics or bars block cannot exist without a source, rendered to PDF plus HTML with a checksum manifest; fall back to HTML when Hindi can't be drawn.
- Engine: add "verified" after "applied" in the journal for client work: applied is not done until a dated acceptance check is saved.
- UI: per-job time estimate as a range or "Not estimated", and "Checked <date>" or "Not yet verified" on each job row.
Traps: proposal template has an "Expected movement" section; keep it as non-guaranteed words, never a model-written traffic figure. The 206-site backlink catalogue (21 Oct card) is still the headline of `docs/seo-house.md`.
Corrections to the 21 Oct card: none found.
Already in Chausar?: staged website edits (`app/ui/src/places/business/SiteEdits.tsx`); journal states stop at applied or rejected (design doc 7.2); no SEO playbook, report renderer or job estimates (`build-audit-2026-10-23.md`, "Marketing: SEO ... playbooks").

## charlesdove977/UGC-Factory (MIT, 89 stars, last commit 2026-06-29)
Source: full (prompt text plus an installer).
New findings:
- Brand kit reuse: before asking anything it looks for a saved brand kit and says which one it loaded (`skill/tasks/run-pipeline.md`, step `resolve_brief`); yet the brief itself is thrown away after each ad ("the next run starts blank by design").
- Style chosen by product category from a table (`skill/frameworks/style-routing.md`): physical product to e-commerce ad, beauty and apparel to fashion lookbook, food and supplements to food and beverage, property to real estate, software to motion design, founder story to brand story, else social hook; at most two styles blended.
- Clip count is arithmetic over the video model's own maximum clip length, read from the model catalogue at run time (`run-pipeline.md`, step `define_format`): clips = ceil(length / max clip seconds). Length has no default; ratio and target platform are asked together to sanity-check.
- Consistency of the presenter: a 3 to 4 image angle set registered once and referenced in every clip (`skill/frameworks/character-creation.md`).
- "If the hook is weak, fix it before spending any credits" (`skill/frameworks/ugc-ad-structure.md`).
Take for Chausar:
- Playbook: "short video ads for D2C brands, restaurants and property listings", routed by product category in code; owner approves brief, beat sheet and cost before any paid generation; disclosure label on every synthetic presenter (21 Oct trap still applies).
- Engine: compute generation units from the connector's declared maximum, never from model guesswork, so the quote is exact.
- Engine: keep the client's brand kit and past briefs as client memory (the opposite of this tool), shown on the client sheet.
Traps: if the owner has no product photo it generates the product, which in an ad can misrepresent what the buyer gets; Chausar should require a real photo for product ads.
Corrections to the 21 Oct card: none found.
Already in Chausar?: no UGC or ad playbook; AI voice and presenter disclosure exist in the YouTube intake (`platform/runtime/venture/playbooks/intake.ts:80`).

## naidx0/revenue-squad (MIT, 1 star, last commit 2026-07-10)
Source: full.
New findings:
- A full sales pipeline (`src/revenue_squad/crm.py`): 24 columns including Vertical, Service Line, Batch, Deal Value, Day 1/3/7 Sent, Follow Up Due, Replied and Reply Date, Call Booked and Call Date, and eight statuses: New, Contacted, Replied, Call Booked, Proposal Sent, Won, Lost, Nurture. The same shape ships for CSV, Notion and Supabase (`supabase_schema.sql`).
- Lead score rubric already exists (`skills/research/SKILL.md:72-93`): seven factors with points (outdated site +3, team of 5 to 50 +2, posted about being busy +3, high-automation industry +2, local +1, budget signals +3, active on professional network +1), thresholds 8+ priority, 5 to 7 good, below 5 low, and a written rationale naming each credited factor. The model adds the points; code stores whatever integer comes back (`pipeline.py:144`).
- Lead source: `src/revenue_squad/places.py` seeds candidates from the Google Places Text Search API (name, website, phone, address), treats them as untrusted until verified, and fails loudly without a key.
- Daily loop (`docs/v2-plan.md`): `squad daily` is bounded and proposes without executing: optional bounce sync, research N new prospects (default 10) from a small config of location, vertical and count, draft outreach, list follow-ups due.
- Gmail facts for a connector (`docs/v2-plan.md`): read and compose scopes are restricted; an unverified app in testing loses its refresh token every 7 days, so bounce sync is manual; bounces are parsed from the DSN part, and a domain-level failure blocks the whole domain.
- Proposal (`skills/proposal/SKILL.md`, `examples/demo-run/proposals/`): sections What we heard, Proposed roadmap, Investment, Next step, Open questions; grounded only in call notes, no invented prices or timelines, a bracketed placeholder wherever a fact is missing.
- Business shown in the demo: an AI automation consultant selling to local law firms (`examples/demo-run/`).
Take for Chausar:
- Engine: lead score as per-factor yes or no votes, each with an evidence URL; code sums and buckets (the judge pattern Chausar already has).
- Engine and UI: extend lead stages to Call booked, Proposal sent, Won, Nurture, with deal value and a follow-up date computed by code; a pipeline board grouped by stage with counts.
- Playbook: "local business lead generation" or "AI automation consultant": a daily run proposes 10 researched, MX-checked prospects with drafts; the owner reviews in the morning and sends; proposals use the placeholder shape and prices come from the owner's price list.
- Connector: Google Places search as `read` (owner's key); Gmail drafts as `write` to drafts only, with the 7-day token fact shown on the connection.
Traps: none new beyond the 21 Oct consent and unsubscribe points.
Corrections to the 21 Oct card: "Lead scores (1 to 10) come from the model; Chausar would need a code rubric" is off: the score runs 0 to 15 on a stated rubric with thresholds; the gap is only that the model does the sum. "Pipeline states (Contacted, Replied, Lost, Blocked)" is incomplete: there are eight statuses and Blocked is a separate column.
Already in Chausar?: lead statuses new, drafted, contacted, replied, lost, blocked, MX check, blocklist and drafts only are built (`platform/runtime/venture/customers/leads.ts:42,106,155,174`); no call, proposal, won or nurture stages, no deal value, scoring, follow-up dates, Places source or daily run (`build-audit-2026-10-23.md`).

## dboudreau00/Countersign-RFP-RFI-RFQ-Studio-for-AI-assisted-Workflows (AGPL-3.0, 93 stars, last commit 2026-10-21)
Source: full (learn only).
New findings:
- Three plain steps in `index.html`: "Documentation bucket" ("Upload the source of truth"; "Everything you add here becomes retrievable context for step 2"), "Response workspace" (upload or paste the RFP, extract questions, generate all answers), "Export the response pack".
- Question ledger: every imported question is auto-classified as Narrative or company, Technical, Compliance (yes/no) or Commercial and pricing, and the owner can reassign a row; answer length targets are set per type, and tone is one dropdown (Consultative, Formal or public sector, Professional, Technical). A spreadsheet RFP opens a "map the columns" step (question, optional ref, response column for round-trip).
- Gap report turned into a request (`index.html:2128-2165`): questions with coverage under 0.4 are flagged and sorted worst first; the header reads "N of M flagged" or "not run"; each gap says "Bucket has nothing on: <terms>" or "weak matches only, so the answer will lean generic", with a coverage meter; the ten most common missing terms become "Suggested documentation to add: material covering ...". Clean result: "No gaps: every analysed question is substantiated by the bucket."
- Exports: Word (cover page, numbered questions as headings), Excel, a flat CSV compliance matrix for portals, and the issuer's own workbook filled in place.
- Key handling choice in plain words: "Team server proxy (key stays on your server)".
Take for Chausar:
- Engine and UI: turn retrieval gaps into a Today row: "To answer 6 questions well, add files about: data retention, SLA, insurance." The owner uploads; the run continues. This is the concrete form of "needs your data".
- Playbook: "tender and proposal response desk" for small vendors and consultants: offers per bid; steps: load the client's documents, extract and classify questions, draft with citations, gap request, owner review per type (pricing rows always owner-written), export in the issuer's own format. Portal submission is `handoff`.
- UI: tone and length per question type as two simple controls instead of prompt editing.
Traps: none new.
Corrections to the 21 Oct card: none found (35 cases: 28 answerable, 7 not, verified in `eval/cases.json`).
Already in Chausar?: claim checks against source files are specified for the judge (design doc 7.5); no tender playbook and no gap-to-request row.

---

## Ranked table: every idea worth taking

Ranked by value for B2C owners (high, then medium, then low) and, within each, cheapest first. Rows from the five groups were merged where two products gave the same idea. "Idea only" marks AGPL, BUSL or MPL sources: describe and rebuild, copy no code.

Idea | From | Kind (playbook/engine/connector/UI) | Value for B2C owners (high/med/low) | Effort (S/M/L)
---|---|---|---|---
Monthly spend limit typed in rupees or dollars, not "millionths of a US dollar" (fix in Ink) | Chausar itself, found beside floe-guard | UI | high | S
"This description is incomplete: part of what this will send isn't shown" flag on every proposed outside action, default incomplete | cloudflare-os | engine | high | S
An agent creating or changing a recurring job, or adding or loosening a rule, joins the always-ask floor; deleting a job stays free | omnigent | engine | high | S
Shadow-week summary on each agent: would have gone out, would have been held, you would have changed; a dash when unknown | decionis | UI | high | S
Owner-written voice per business in plain words: on or off, per language (Hindi) and per channel, with a "What I will not claim" list that feeds the claim checks | postmill (idea only), youtube-agent-skill | UI + engine | high | S
Agent sheet shows the playbook as readable versioned text with "Done when:"; saving states the impact first; stale save keeps the draft ("Your draft is still here") | qm, omnigent | UI | high | S
Connect your AI: find keys and AI tools already on the computer; free options first with key-page links; what each key unlocks; CLI states (ready, not installed, signed out) with one fix line; custom base URL; key asked inline on the page that needs it | llm-space, LongHorizon-Harness, podcast-shorts-factory, youtubepro, diffusionstudio (idea only), reels-af, bridgeclip | UI | high | S
Posture as two or three plain choice cards when an offer starts ("the team finishes it, you check samples" vs "you check each piece"), with outcome and step string | bridgeclip | UI | high | S
Stalled-client rule with no model ("No reply from Asha in 14 days") raises a Today row | trycompai/crm | engine | high | S
Every lead and DM names its trigger; follow-ups fixed at +4 and +10 days, each must add something new, then stop | instagram-agent-skill | engine | high | S
Lead score as per-factor yes or no votes with evidence URLs; code adds and buckets | revenue-squad | engine | high | S
Connections rows say "Brings in" and "Sends" (an empty Sends stated as a guarantee), lead with a liveness line, and write the agent's limits beside its switch | trycompai/crm | UI | high | S
Open vs overdue split on Money with one thin bar (overdue in `--fail`), aging buckets on demand | akaunting (idea only) | UI | high | S
"Viewed" state for invoices and drafts opened through a share link; the owner's own preview never counts | akaunting (idea only) | engine + UI | high | S
Activity line per business in plain words, newest first ("Draft ready for Asha Foods"), separate from the receipt journal | podcast-shorts-factory | UI | high | S
Tray shows busy or idle (with a short linger), "N need you" in its menu, and a one-time Windows "still running" balloon | diffusionstudio (idea only) | UI | high | S
Offer: "Channel audit, one fix" (one fix this week, three things to keep, one not to do yet) | youtube-agent-skill | playbook | high | S
Two-step stop (Stop lets the run finish and report; Force stop states what is lost), plus Resume versus Start again | LongHorizon-Harness | UI | high | M
Owner gate after each delivery round: finished, limit reached (grant two more tries?), needs an answer (quick buttons), blocked, N failures in a row | LongHorizon-Harness | engine | high | M
Agent health worked out in code: share of work sent back, failures in a row, an undeclared outside action quarantines; one word plus a reason on Team | qm | engine | high | M
"Watch one real order end to end before arming" as the step before approve-each; every success condition carries a bound | qm | engine | high | M
Voice profile bootstrapped from the owner's sent mail or three of their videos: frequencies, verbatim examples, a held-out check before "validated" | qm, youtube-agent-skill | playbook | high | M
Agent persona as typed fields placed after the fixed rules; a Test tab runs unsaved edits on practice clients and shows the cost | opendesk | engine + UI | high | M
Memory and knowledge list: facts with a captured date, Edit and Forget; "What the AI knows about you" sources (text, link, file, best past work) with a test search | qm, postmill (idea only) | UI + engine | high | M
Code-built "needs you" rows with severity, deep links and per-probe isolation: broken connection, gap in next week's calendar, spend at the alert threshold, a number that moved sharply | postmill (idea only) | engine + UI | high | M
"Who is waiting on you" block on Today drawn only from real records, dismissals remembered | qm | UI | high | M
Gaps become requests: "To answer 6 questions well, add files about: SLA, insurance" as a Today row; a monthly list of what agents couldn't answer from the business's own knowledge | Countersign (idea only), opendesk | engine + UI | high | M
Notification centre: one chokepoint; category by channel (in-app, OS, email, push, WhatsApp or Telegram); instant, hourly or daily digest at a chosen hour; pause up to 30 days; pacing (first email only if still unread after 5 min, growing cooldowns, nothing while the owner is active); quiet hours; "nothing needs you today" | opendesk, postmill (idea only), qm | engine | high | M
Reach the phone: Web Push and an installable manifest (business name and icon) on the hosted tier; from the desktop, a relay or ntfy push carrying only "3 need you" and a link, never names or figures | opendesk, podcast-shorts-factory, qm | connector | high | M
Chausar's own plan model: a free AI allowance, then the owner's own key (which spends none of it); never-expiring top-ups; auto-recharge with a monthly cap; add-on packs; a zero-price guard; downgrade at period end; a grace window. Priced in rupees | cloudflare-os, opendesk, postmill (idea only) | engine | high | M
Plan and credits page: the app is free with your own key, paid plans sell hosted AI only, every feature on every plan, one usage bar with its reset date, top-up tiles, an "out of allowance" sheet with connect or wait (live countdown) | diffusionstudio (idea only), cloudflare-os, opendesk | UI | high | M
Set approval: one hash over an ordered batch ("this week's 5 posts") plus its total quote; each item keeps its own journal entry and charge record | open-edit | engine | high | M
Check detail view in the run sheet: each rule's exact question, verdict, floor, pass or below, cited evidence, earlier attempts as superseded; "not saved" stays honest | bridgeclip | UI | high | M
Optional playbook steps skipped under budget pressure, said on the run sheet ("Skipped polishing to stay within this month's limit") | floe-guard | engine | high | M
AI cost and margin per client in Money, from receipted spend tagged by order | floe-guard | engine | high | M
Pipeline: stages through Call booked, Proposal sent, Won, Nurture; deal value; follow-up date set by code; a stage rail on each lead or client; a board or donut by stage whose rows open the filtered list | revenue-squad, trycompai/crm | engine + UI | high | M
Playbook: lead generation and appointment setting for local businesses. A bounded daily run proposes 10 MX-checked leads with drafts, the owner sends in the morning, stages run to "meeting booked", weekly report | trycompai/crm, revenue-squad | playbook | high | M
Playbook: Instagram for a local business or coach (repurpose one video a week, keyword delivery drafts, reply drafts by bucket, follow-ups; owner sends, DMs `handoff`) | instagram-agent-skill | playbook | high | M
Playbook: local SEO and Google Business Profile for shops and clinics (audit, profile fixes, citations, review replies, monthly report; profile edits `handoff`) | beyondseo | playbook | high | M
Client report blocks: a metrics or bars block can't exist without a source; PDF plus HTML plus a checksum manifest; HTML kept when Hindi can't be drawn in the PDF | beyondseo | engine | high | M
Caveat under every figure and chart ("sample of 50", "not your own analytics"), a coverage block in client reports, sample size on aggregates, thin cells muted, nulls hidden, freshness per source | youtubepro, postmill (idea only) | UI | high | M
Overdue reminders on days the owner picks, each a draft the owner approves; a row when a client views or pays | akaunting (idea only) | playbook + engine | high | M
Recurring invoices for retainers (frequency, interval, end by count or date), each generated invoice a Today row | akaunting (idea only) | engine | high | M
What-if layer on the India tax calculator: old vs new regime, the 87A cliff, "how much more before X", all as receipts | opentax-engine (idea only) | engine | high | M
Voice on Today in Hindi and English: read-only, every figure from the engine with its receipt, changes stay rows to approve, "or keep typing" on failure | helix-foundry | UI | high | L
Playbook: customer support desk for small shops (shared inbox, bot-answered widget, help articles, monthly report with gaps); retainer per inbox, AI passed through at a stated markup | opendesk, agentbehavior | playbook | high | L
Document compiler for Form 16, AIS and 26AS: the agent copies boxes, code classifies and adds, with "missing" and "unsupported" lists that feed questions to the client | opentax-engine (idea only) | engine | high | L
Budget meter with an alert threshold: share of the limit used, amber from 80%, a Today row at the threshold, "about 12 more drafts at today's cost" labelled an estimate | floe-guard, opendesk, postmill (idea only) | engine + UI | med | S
Per-agent monthly spend cap that pauses only that agent and raises a Today row | opendesk | engine | med | S
Setup checklist with a progress bar and count, done steps struck through; "Create your first invoice" as the last row for a business with clients | opendesk, postmill (idea only), akaunting (idea only) | UI | med | S
Agent question rules: derive before asking, multi-select first then only what it opened, a deciding fact per choice, an escape, a submit label that restates the answer, chips that show the exact message, shorthand like "1b 2c" | trycompai/crm, itr-prep-skill, product-shots, Amazon-Skills | UI | med | S
Connector setup guides: numbered steps for a least-privilege key beside each form, "the step people skip", what the platform charges, "Confirming access before marking it connected" | helix-foundry, cogsend, qm | UI + connector | med | S
Avatars as initials drawn locally on a stable muted colour (no avatar service gets the name), a small platform badge, photos loaded lazily | cloudflare-os, cogsend | UI | med | S
Client logos and brand colour from their website domain, initials when none | trycompai/crm | UI + connector | med | S
Steer box on the run sheet: a note queued for the next step | LongHorizon-Harness | UI | med | S
Status words gain "stopping" and "skipped"; each step gets a short summary, its detail, and a next step | LongHorizon-Harness | UI | med | S
Files changed during a run labelled "changed during this run, not proven to be the agent's" | LongHorizon-Harness | UI | med | S
A check that alters its input voids its own verdict and restores the files | LongHorizon-Harness | engine | med | S
Rate card "confirmed" flag: list price unconfirmed vs the owner's checked rate | floe-guard | engine | med | S
Recurring work stored as once, interval or calendar with time zone ("every Monday 09:00, Asia/Kolkata"), never raw cron text | cloudflare-os | engine | med | S
One module for every state word, a drift test against the engine's enums, unknown states shown verbatim | decionis | engine | med | S
Never show a control that acts on nothing | omnigent | UI | med | S
Rule elevation: owner feedback becomes a lasting playbook rule only on the owner's yes, written as a stable trigger and observable conduct | agentbehavior | engine | med | S
Per-field correction rate flags a systematic error ("Invoice dates were corrected 4 of 5 times: fix the rule") | py-idp (idea only) | engine | med | S
Playbook: document data entry for CAs and shops, one template per document type with its common mistakes | py-idp (idea only) | playbook | med | S
Hide team and brand controls until a second one exists | opendesk | UI | med | S
Computed fallback when a model-made summary or chart fails (counts per entity, new records per month) | helix-foundry | engine | med | S
Preference sliders that re-rank already-judged options in code with no new AI call; hard failures still go to review | bridgeclip | engine | med | S
Repurposing inventory with counts (claims, stories, mistakes, quotes) and a "thin source" stop | instagram-agent-skill | engine | med | S
Which-wallet rule: never choose silently between two keys or wallets, say which when there is one, unknown balance is not zero, stop instead of switching | open-edit | engine | med | S
Onboarding box: a "for which business" picker, file drop, two or three cycling examples while empty | diffusionstudio (idea only) | UI | med | S
Comment triage counts ("84 comments: 41 keyword, 2 leads") as the first line of a reply-draft review | youtube-agent-skill, instagram-agent-skill | UI | med | S
Teleprompter for approved scripts (speed from spoken words only, text size, fullscreen, cues toggle) | youtubepro | UI | med | S
A missing permission turns the action into a flagged draft for the owner, never a silent drop | podcast-shorts-factory | engine | med | S
Decide-first schema for optional agent actions: a yes or no (default no) with a reason before any content | reels-af | engine | med | S
Offer: weekly plan sized to the owner's real hours (anchor, one cheap piece, three Shorts; hours and what to drop first) | youtube-agent-skill | playbook | med | S
Thumbnail starting presets worded to avoid false claims; a variation needs a written direction | youtubepro | UI | med | S
Overdue, Open, Paid summary row in large type with hairlines, exact amount on hover, each opening the filtered list | akaunting (idea only) | UI | med | S
Empty states: one sentence on what it is and why, then action rows; never sell inside them | akaunting (idea only) | UI | med | S
Rate-change banner: amounts keep the rate charged, recalculation is opt-in | akaunting (idea only) | UI + engine | med | S
GO / HOLD / NO-GO card for a new offer with its maximum loss; "GO spends nothing" | sealeap-ecommerce-skills | UI + engine | med | S
Journal end states beyond "applied": accepted, processed, shown, result; "verified" needs a dated acceptance check | sealeap-ecommerce-skills, beyondseo | engine | med | S
`limitations` and `used_by` on each platform rule, so a changed rule lists the steps it touches | sealeap-ecommerce-skills | engine | med | S
Own-transfer pairing in statement import (own accounts, opposite amount within two days) | bankmcp | engine | med | S
Whole-word search across statements to match a payment to an invoice number | bankmcp | engine | med | S
Split ITR offers: full help, form and regime, computation, check a draft, checklist only | itr-prep-skill | playbook | med | S
ITR form chooser and regime-switch rules as dated code rows; the agent asks only what they need | itr-prep-skill | engine | med | S
Intake completeness computed in code from weighted fields ("Brief 80% ready") | product-shots | engine + UI | med | S
Safe zones for on-screen text and CTAs as dated data with a source | product-shots | engine | med | S
"At most three findings, costliest first, say what was dropped" as the shape of an agent's report row | bankmcp | UI | med | S
Delivery insights for write connectors: sent vs failed by the owner's local day, against last period, failure reasons, a dash when nothing was attempted | cogsend | UI | med | S
Z-score anomaly check on a trailing baseline (at least 7 points) raises an info row | postmill (idea only) | engine | med | S
Proposal shape: what we heard, roadmap, investment, next step, open questions; a placeholder wherever a fact is missing; prices from the owner's list | revenue-squad | playbook | med | S
Generation units computed from the connector's declared maximum clip length, so the quote is exact | UGC-Factory | engine | med | S
Google Places as a `read` lead source (owner's key); Gmail drafts as `write` to drafts only, with the 7-day token fact on the connection | revenue-squad | connector | med | S
Report share link scoped to a date range and chosen channels, with rotate and disable | postmill (idea only) | UI | med | S
Tone and answer length per question type as two controls instead of prompt editing | Countersign (idea only) | UI | med | S
Per-job time estimate as a range or "Not estimated", and "Checked <date>" or "Not yet verified" on each job | beyondseo | UI | med | S
Owner-written triage rule ("clients with a deadline first") with a dry run on current items before saving | qm | UI | med | M
Pause all and Stop all for a business, status inherited down the team | qm | UI | med | M
First-run rehearsal on three sample orders (routine, risky, high value) showing what would be held; nothing leaves Chausar | decionis | UI | med | M
Hosted tier: start without an account; the business is temporary until claimed, said in one sentence | decionis | UI | med | M
Phone companion: web-view shell, foreground notifications, a tap opens the one approval, "no push yet" said plainly | omnigent | UI | med | M
Import clients and history (spreadsheet, Tally, Zoho) with check, preview of three samples, start, and undo of exactly what was created | opendesk | engine | med | M
Labelled sample data in empty charts ("None of these numbers are real"), a sample business in onboarding, "Finish later" and "Resume setup"; failed real data is never swapped for samples | opendesk, helix-foundry | UI | med | M
Client brand kit record (colours, fonts, logo, voice, samples) read by every creative step, with precedence client kit, then house style, then default; past briefs kept as client memory | product-shots, diffusionstudio (idea only), UGC-Factory | engine | med | M
Asset record per delivered file (source, licence or unknown, attribution, model, cost or "not measured"); an unknown licence blocks delivery; the footage share feeds AI disclosure; Wikimedia Commons stills as `read` | open-edit | engine | med | M
Agent-editable settings allowlist (vocabulary, schedule; never keys, money, posture or storage) plus a "show me" step that opens what the agent changed | bridgeclip | engine | med | M
Learned changes only in one marked, reversible section of one playbook; a protected standards file; prediction vs actual as the trigger | podcast-shorts-factory | engine | med | M
Client profiles that group a client's platform accounts as status tiles (social agency) | bridgeclip | UI | med | M
Away mode: client promises falling due, what keeps running, which approvals wait, an auto-reply with real response times for approval, a return-day backlog | sealeap-ecommerce-skills | playbook + UI | med | M
Invite a read-only accountant from the business menu (the role exists in the engine) | akaunting (idea only) | UI | med | M
Experiment record for playbook changes: one change, control window, budget cap, stop and roll-back; without a control the result reads "observed" | sealeap-ecommerce-skills | engine | med | M
Offer: money check-up for households and small shops (monthly summary, subscription audit, unusual transactions, three-finding savings scan; spending only, no investment advice) | bankmcp | playbook | med | M
CA offers: "check a return prepared elsewhere" and "advance tax working for freelancers" | opentax-engine (idea only) | playbook | med | M
Differential tests of the tax calculator against department-calculator outputs captured by a CA, with a cited known-differences file | opentax-engine (idea only) | engine | med | M
Offer: niche research report PDF (code figures, labelled interpretation, coverage block) | youtubepro | playbook | med | M
Playbook: product photography for online sellers (priced package per product, consistency rules, quote before generation, seller uploads) | product-shots | playbook | med | M
Playbook: short video ads for D2C brands, restaurants and property, style routed by category in code, a real product photo required, synthetic presenters disclosed | UGC-Factory | playbook | med | M
Best-time heatmap with "based on N posts" and low-confidence marks | postmill (idea only) | UI | med | M
Reply inbox: Needs reply, Handled, Ignored, assignee, priority first, "last synced" (`handoff` until comment APIs pass review) | postmill (idea only) | UI | med | M
Staged release at 0%, a health check that the new version answers, then switch, with Roll back kept (hosted tier, website builds) | cogsend | engine | med | M
Generated agent faces from allow-listed parts (gives the AI a personality; founder decides first) | opendesk | UI | med | M
Website form-to-client capture script for sites Chausar builds | trycompai/crm | connector | med | M
Describe an agent in a sentence, then confirm on a capability page ("What it can see", "What it can do"), each change a new version | trycompai/crm | UI | med | L
Playbook: tender and proposal response desk (classify questions, cite sources, gap request, pricing rows owner-written, export in the issuer's format; portal `handoff`) | Countersign (idea only) | playbook | med | L
Playbook: AI phone receptionist for shops and clinics (calls admitted within budget, cost per call by leg, voice disclosed; Retell or Vapi `planned`) | floe-guard | playbook | med | L
OS permission walkthrough with a live check while the settings window is open | qm | UI | low | S
Lift verdict from an exact paired test; "Not enough practice cases to tell yet" | SkillEvaluator | engine | low | S
Record sheet becomes a bottom drawer on phones | trycompai/crm | UI | low | S
Project and client tiles with a cover still captured on close | diffusionstudio (idea only) | UI | low | S
Caption chunking in code (5 words, 1.9 lines, 200 ms gap, clause end) and caption presets with a one-line purpose | reels-af, bridgeclip | engine | low | S
Talking-head cut standards and measured cut points | diffusionstudio (idea only), open-edit | engine | low | S
Missed-slot (60 min) and changed-file rules for scheduled posts | bridgeclip | engine | low | S
One-click example scenarios and "assumed" markers on calculator screens | opentax-engine (idea only) | UI | low | S
Each agent skill shown as a name, one line and a "try this" starter | Amazon-Skills, sealeap-ecommerce-skills | UI | low | S
"Is my bank supported" list before consent, once an Account Aggregator provider is chosen (`planned: read`) | bankmcp | connector | low | S
Extra Amazon seller-services offers (ungating, brand registry, returns, storefront, deals) | Amazon-Skills | playbook | low | S
Customise which home sections show | postmill (idea only) | UI | low | S
Posting streak reminder (an engagement hook: use with care) | postmill (idea only) | UI | low | S
Client portal: share one live order-status page without chat or editing | cloudflare-os | UI | low | M
Distinct agent cursor and one permission window, if computer use ships | open-computer-use | UI | low | M
Signed yes or no proof that an account is the owner's, with a ceiling and a rate limit | bankmcp | connector | low | M
Offer: paper or article to explainer reel, only from a fetched source with quoted spans | reels-af | playbook | low | M
Competitor watchlist (you vs them) | postmill (idea only), `apps/frontend/src/components/analytics/views/watchlist.tab.tsx` | UI | low | M
