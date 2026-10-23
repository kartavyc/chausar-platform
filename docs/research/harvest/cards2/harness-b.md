# Harvest cards, second pass: harness-b

Seven products, read 23 October 2026 from shallow clones (default branch). Nothing was installed, built or run. Paths are relative to each repo root. Everything here is `planned` for Chausar unless a line says it is already built.

Focus asked for: team chat between people and agents (Beeline), agent-to-agent messaging, review screens with evidence and severity (Open Security, OpenQodex), and loop patterns that keep agents productive.

Clone notes: Beeline was cloned tree-only and checked out without images, videos and lockfiles (drive C ran out of space). OpenQodex lost five golden-test and corpus files to Windows path length; none of them matter here.

---

## Beeline-Work/beeline (MIT, 4 stars, last commit 2026-10-23)

What it is: a hosted team chat (iOS, Android, desktop) where people and coding agents share Rooms. A small helper on the owner's machine runs Claude Code, Codex, Pi and others as Room members; work happens in "corners", each a bounded assignment with its own brief, branch and pull request. The server is Postgres on Fly, with push through Firebase and APNs.

Source: full. Server (`apps/server`), mobile and desktop app (`apps/mobile`), helper (`apps/body`), shared contracts (`packages/api-contract`), installer and pages (`web/`), plus long invariant docs (`docs/agent-*.md`) and tests beside nearly every file.

How it works:
- **Rooms and corners.** A Room is conversation; a corner is "a fresh worktree, its own branch, one owning agent, and one fixed objective of at most 24 words" (`docs/getting-started.md`). In a Room the agent's filesystem is read-only; the only way to start write work is `open_corner`. A corner's scope is its brief: intent, stories, criteria, non-goals (`docs/agent-corners.md`, `apps/body/src/beeline-skill.ts`).
- **One merge rule.** `mergeAllowed = live checks green AND a yes on the exact head AND no hold`. A new commit cancels the yes; a hold is the only veto and only its holder or someone senior can lift it; `GitHubOperations.landCorner` is the only merge path (`docs/agent-corners.md`, `apps/server/src/corner-lifecycle.ts`).
- **Orders go down, reports go one step up.** Only `agent_commands` rows authorise a turn; chat history is context, not authority. A report must carry `status: done|blocked|failed|needs_decision` matching its text prefix. Recruiting a peer agent spends a depth-three budget (`apps/server/src/commander.ts`, `docs/agent-corners.md`).
- **Cascade caps between agents.** `MAX_EVENT_DEPTH = 4`, `MAX_TURNS_PER_ROOT = 12`, `MAX_MENTIONS_PER_EVENT = 3`. Past them the agent reads one fixed sentence: "nothing was posted. Answer in the Room instead of waking another agent." (`packages/api-contract/src/system-events.ts:207-235`).
- **Saved workflows.** A JSON contract of roles and states: each agent step has a `does` sentence (140 chars max), `requires` fields, outcome edges, a required `timeoutSeconds` and an ordered list of agents to fail over to; gates have 2-4 outcomes, a required timeout and a `default`; a `loop` cap bounds any retry edge; every cycle must pass a gate or a cap; runs have a deadline (24 h default); one live run per workflow per Room; an `attempt` number makes stale or repeated calls do nothing (`docs/workflows/README.md`, `packages/api-contract/src/workflow-contracts.ts:16-43, 208, 457`, `apps/server/src/workflow-runs.ts`).
- **When a person is pulled in.** Only when an agent explicitly asks, or an agent cannot be reached after normal retries. CI failures go back to the implementer with no human escalation cap (`docs/human-attention.md`).
- **"Needs you" rule.** A message needs a person when it tags them AND asks: ends with "?", contains please / approve / feedback, or starts `blocked:` / `needs-decision:` / `failed:`. A question leaves 24 h after first seen or when the person replies; an approval stays until decided, expired or dismissed (`apps/server/src/needs-you.ts:19-79`).
- **Failure sentences.** `classifyTurnSilence` maps a failed turn to one of ten kinds (wrong model, allowance spent, not signed in, workspace failure, helper out of date, offline, context overflow, memory limit, update interrupted, hiccup), each with a fixed sentence that says what to do. Only hiccups retry: three tries, two for a hung harness (`packages/api-contract/src/turn-silence.ts:135-400`).

Take for Chausar:
- Business (playbook): **an agency with a shared client room.** A freelancer or small studio (content, web, social) gives each client a room where the client, the owner and the agents talk; a client request becomes a bounded assignment with a brief; the agent works; checks run; the owner says yes on the exact version; the client sees the result in the same thread. The owner approves each brief and each final version. Earns as a monthly retainer. Chausar today has read-only share links with Approve and Ask for changes, which is the safer first step; a two-way client room is a later tier.
- Engine or harness mechanism:
  - **Give playbooks edges, caps and timeouts.** Chausar's `PlaybookStep` is a straight list (`platform/runtime/venture/contracts.ts:1059-1072`). Beeline's contract adds what keeps a run moving without the owner: outcome edges (`approved`, `changes_requested`), a `loop` cap with an `onExceeded` state, a per-step timeout with an ordered list of agents to try next, a built-in `blocked` outcome with a reason (1-500 chars), gates with a `default` and a timeout, and a run deadline. Validation refuses a cycle with no cap or gate. Take the shape, rebuilt on Chausar's records.
  - **Cascade caps before agents message each other.** When Team agents start handing work to each other, copy the depth and turns-per-root budget and the fixed refusal sentence.
  - **Report statuses.** Every agent-to-agent report carries `done`, `blocked`, `failed` or `needs_decision`; only `needs_decision` and `blocked` addressed to the owner reach Today.
  - **Failure kinds with fixed sentences**, and retry only the transient kind. The owner reads "the provider allowance is spent. Top up, or move the agent to another provider." instead of a stack trace.
  - **Wake batching.** Each agent is `immediate` or `batch:<minutes>`; human messages always stay immediate (`apps/server/src/commander-wakes.ts`). Useful for cheap models: a digest per window instead of one turn per event.
- Connector: GitHub App, Slack, Linear and Stripe event subscriptions (`apps/server/src/agent-subscriptions.ts`, `provider-webhooks.ts`). Honest label for Chausar: none needed now; `planned` if a dev-agency playbook arrives.
- UI:
  - **The tray** (`apps/mobile/sources/app/(app)/beeline/tray.tsx`, `components/buzz/NeedsYouCell.tsx`): Approvals then Questions; each cell is plain text `<actor> <ask>`, age at the right, the exact subject, the reason or options, then one quiet line `for <name> · where · expires in`. Approvals carry their decision buttons inline. Opening clears a question, never an approval. Dismiss has Undo. Empty: "Nothing needs you" / "Nobody has tagged you with a question or a request." Chausar's Today could add the `for · where · expires` line, which also covers the missing "approval expiry" item in the build audit.
  - **One sentence grammar for system lines**: `<subject> <verb>[ <object>][ · <consequence>]`, past tense, no colon, no trailing full stop, held by a contract test (`apps/server/src/system-line.ts`, `system-line.contract.test.ts`). Fits Chausar's state sentences.
  - **Folded tool work**: one line `N steps · F failed · duration`; open it for one line per call with a verdict (`DESIGN.md`, "Machine runs").
  - **The turn line**: activity verb plus elapsed seconds, `· received` when the owner's steer lands, `· stopping` then `stopped`; Stop keeps what was written. A ready answer to the build audit's missing "stop a run".
  - **Run page** (`components/buzz/WorkflowRunLine.tsx`): status as a word ("Running", "Waiting on you"), the run summary, then one vertical rail; upcoming steps are predicted from each state's first outcome and shown dimmed at 45%; step circles differ in shape, not only colour; gates on this page are records, not buttons.
  - **Purpose-first grant card**: the agent must give a plain purpose (1-240 chars); the card leads with it and folds the script behind "Show script" (`docs/approval-matrix.md`).
  - **Design held by lints**: allowed type sizes and spacing steps, colour literals only in token files, per-file baselines that may only shrink (`apps/mobile/sources/buzz/calm-lint.design.test.ts`, `design-lint.design.test.ts`). Chausar already has word-budget tests; this is the same idea for type and spacing.
  - **"Live breathes, never travels"**: a working agent gets one slow opacity pulse, no bars or marching dashes.
Traps: an agent avatar per animal species with a "soul" drifts toward the AI personality the founder rejected; take the deterministic hue and the person-versus-agent plate, not the mascots. "An agent never reviews its own code" is prompt discipline, not a gate (`docs/agent-corners.md` says so). Five sandbox grant kinds are "recorded but not yet enforced" (`docs/getting-started.md`, Beta). There are wallet spending tools; out of scope. The stack (Fly, Postgres, Firebase, a GitHub App) is far heavier than Chausar's engine; port patterns, not code.
Already in Chausar?: Today as the approval queue, decide once, "Waiting on you", Team gates (auto or hold) and delegation to Claude Code or Codex are built (`docs/venture/ink.md`; `platform/runtime/venture/delivery/harness/delegate.ts`). Step edges, loop caps, gate defaults, timeouts, failover, cascade caps, failure kinds, needs-you expiry, the turn line and Stop are not. The "Needs you" queue idea matches Cloudflare OS Activity in `frontend/README.md`; Beeline adds the ask rule and expiry.

---

## LamplitIsles/keet-for-agent (Apache-2.0, 7 stars, last commit 2026-10-13)

What it is: an MCP gateway that lets an agent use Keet, Holepunch's peer-to-peer chat app, as its messaging channel, plus a separate bot (`impri-keet`) that turns a Keet direct message into an approval channel for another product's action inbox (Impri). It is a bridge to Keet, not its own agent-to-agent network.

Source: partial. The integration code is all here (`packages/keet-core`, `packages/keet-mcp`, `packages/impri-keet`, tests). The Keet runtime is not: the operator downloads Keet 4.22.0 for Linux x64 and extracts its worker bundle and native addons from the AppImage (`docs/runtime-extraction.md`; `docs/adr/0001-distribute-code-without-official-runtime.md`). Impri, the action inbox it approves into, is another product. Nothing to reverse engineer for Chausar; the patterns are what matter.

How it works:
- **Approval by reaction** (`packages/impri-keet/src/bridge.ts:17-141`). The bot posts "Pending approval: <title>", the kind, the preview (cut at 10,000 chars with a link), the inbox link and "✅ Approve · ❌ Reject. Choose one; removing a reaction cannot undo an accepted decision." It adds both reactions itself and counts only reactions beyond its own.
- **Conflict and retry rules.** Both reactions present: it asks "Please keep only one" and submits neither. On an HTTP failure it keeps no verdict; the next poll re-reads the inbox first and then the current reactions, so a choice removed while offline is never replayed. A 409 from the inbox means someone decided first; the bot re-reads, never assumes success (`impri.ts:113-121`).
- **The inbox owns the decision.** "Approved" is treated as a middle state; the bot speaks again only on `executed`, `execute_failed`, `rejected` or `expired`. At most 512 requests are tracked; notifications are "not exactly-once", and duplicates are settled by the inbox (README "Interaction and recovery").
- **Recover your own message.** The native send can succeed without returning an id, so the bot finds its own exact text (which contains the unique action link) in recent history before adding reactions (`bridge.ts:143-159`).
- **One private DM is the authorisation boundary.** Setup accepts exactly one DM request; a running bot never accepts another; a binding can't be pointed at another identity, DM or inbox (README "Configure and onboard").
- **Ordered, durable inbound webhook** (`packages/keet-mcp/src/webhook-event-feed.ts`, README "Incoming webhook"): each event is written to disk before the first POST, sent one at a time in order, removed only on a 2xx, retried with bounded backoff while later events wait; a stable `eventId` lets the receiver drop repeats. Only DMs, mentions, the bot's display label and replies to the bot trigger it; other group messages are observable context (`CONTEXT.md`).
- **Honest partial send.** A text with a reaction returns `{ sent: true, reacted: false, reactionError }`, and the docs say "confirms text delivery; do not resend it."

Take for Chausar:
- Business (playbook): none on its own.
- Engine or harness mechanism: the reaction rules map one to one onto `venture.queue.decide`: Chausar's engine stays the only authority (decide once, digest), a chat reaction is just another way to send `approve` or `reject` for one digest, a double choice submits nothing, an offline click is never replayed, and the chat gets one closing line when the journal says applied, failed or unknown. Money rows and anything on the always-ask floor must stay in-app (the second ask can't be a reaction).
- Connector: **approve from the phone's chat app**, `planned`. In India the practical carrier is a Telegram bot (free Bot API, one private chat bound at setup, inline buttons or reactions). WhatsApp would need the Business Platform and Meta review, so `planned: handoff` until then. Keet itself is not worth wiring. The durable ordered inbound feed with a stable event id is the right shape for any incoming client message connector.
- UI: the approval message layout (title, kind, preview, link to the full item, the two choices and the one sentence about undo) is a good template for a phone notification or chat card.
Traps: depends on extracting a closed runtime from Keet's app, Linux x64 only, pinned to one version tuple; the tagline "no infra" hides a daemon plus that runtime. The approval bot has no approver allowlist: anyone in the DM counts, so the DM must be strictly one-to-one. Reaction-only approval is too light for money.
Already in Chausar?: decide once on a digest, stale digests and "outcome unknown" are built (`docs/venture/ink.md`). No phone or chat approval channel exists, and OS notifications are listed as not built in `build-audit-2026-10-23.md`.

---

## cobusgreyling/loop-engineering (MIT, 11,614 stars, last commit 2026-10-23)

What it is: mostly a pattern library and docs for running coding agents on a schedule (daily triage, PR babysitter, CI sweeper, dependency sweeper, changelog drafter), plus about fifteen small TypeScript CLIs that score, gate, drill and budget those loops. The repo runs its own daily triage in GitHub Actions and commits the result to `STATE.md`.

Source: full for the patterns and tools (`patterns/`, `starters/`, `tools/*/src`). Some published packages lag (its own `STATE.md` lists `loop-mcp-server@1.1.0` as not installable).

How it works:
- **Circuit breaker on a run ledger** (`tools/loop-context/src/context-manager.ts`). The ledger is `{ goal, attempts: [{ iteration, action, outcome, error, tokensUsed }] }`. Errors are reduced to a signature (timestamps, hex addresses, paths, line numbers and other numbers stripped) and compared by character-trigram similarity (0.85). It stops and escalates on, in this order: the same error 3 times in a row ("stagnation"), a very similar action 3 times ("frustration"), 5 failures in a row ("no-progress"), a token budget, then 10 iterations. A config that would switch a rule off (say `similarityThreshold: 95`) throws: "A breaker that silently stops breaking is worse than one that refuses to start."
- **What the next turn sees** (`buildContextInjection`, same file): the goal, one progress line, "Already tried (do NOT repeat)", failure patterns with counts, the last error cut to 8 lines, and the breaker status.
- **Fire drills for guardrails** (`tools/loop-drill/README.md`, `src/drill.ts`, `canary.ts`, `injection.ts`). Each guardrail is tested both ways: a denied path must be blocked and an ordinary doc change must be allowed; N identical failures must trip stagnation (not some other rule); a clean tree must pass the verifier and a seeded defect must fail it; an instruction planted in an issue title or HTML comment must not be obeyed. `--record` writes `loop-drill.json`.
- **Readiness levels with fresh proof** (`tools/loop-audit/src/auditor.ts:397-462, 1022-1043`). L1 report only, L2 assisted, L3 unattended. L3 needs a verifier, a state file, cost records, a real run in the last 14 days and drill results under 30 days old for the current `gate.yaml`; otherwise it is capped at L2 with a sentence saying why.
- **Path gate** (`gate.yaml`, `tools/loop-gate/src/gate.ts`): denylist globs (secrets, auth, payments, billing, migrations), at most 10 files per change, and an auto-merge allowlist (docs, markdown, tests).
- **Budget and kill switch** (`loop-budget.md`, `loop-constraints.md`): runs and tokens per day per loop; at 80% of the daily cap switch to report only; a `loop-pause-all` label stops everything; "Max 3 fix attempts per item; escalate after".
- **Several loops at once** (`docs/multi-loop.md`): one owner per branch per hour, an `acting_on` field each loop checks before acting, and a fixed priority order.
- **Failure modes with mitigations** (`docs/failure-modes.md`): Verifier Theater, Notification Fatigue ("notify only when human decision required", digest for report-only loops), Token Burn, Escalation Failure ("alert if an item waits on a human for more than 24 h"), Prompt Injection.

Take for Chausar:
- Business (playbook): **a software maintenance retainer** for a freelance developer: daily triage report for each client repo, patch-level dependency updates, draft changelogs, CI fixes in isolated worktrees. Week one is report only; the owner approves each pull request; nothing merges itself. Earns a fixed monthly fee per repo. Low-to-medium value for Chausar's first audience, but it is a clean computer-only business and Chausar's owner-CLI tier can already run Claude Code or Codex.
- Engine or harness mechanism:
  - **Add the breaker to the delivery loop.** Chausar's loop stops on turns, tool calls and cost (`platform/runtime/venture/delivery/harness/loop.ts:26, 272`) but not on "the same failure again". Store attempts per run step, normalise error text, and stop with the trigger name when stagnation, frustration or no-progress fires; feed the "already tried" block into the next turn. All of it is plain code, no model.
  - **Open "auto with spot checks" only on fresh proof.** The launch ladder keeps that stage closed today (`docs/venture/ink.md`, Known limits). Use L3's rule as the opening condition per agent and step: a verifier exists, a recent real run passed, the spend log is complete, and the guardrail drills for this playbook passed within 30 days and since the last playbook change.
  - **Drill Chausar's own gates.** A rehearsal suite that injects a money action at "auto", a client send without approval, a stale digest, an unpriced model and a planted instruction in a client email, and asserts each one is stopped; plus the benign twin of each that must pass. Record results beside the playbook hash.
  - **80% rule**: when an agent hits 80% of its run or daily budget, it may only report, not act.
  - **Notification rule**: the owner is notified only for a decision; everything else goes to a digest.
- Connector: GitHub (read for triage, write for draft PRs), `planned`.
- UI: the triage layout in `STATE.md` is a good owner digest: "High priority (acting or waiting on you)", "Watch list", "Recent noise (ignored this run)", with outside text shown as quoted data. A "waiting on you for more than 24 h" flag on Today rows follows from Escalation Failure.
Traps: the readiness score is the project's own heuristic, not a measure of quality. `loop-cost` multipliers (maker-checker 2x, parallel:N N+1, debate:R 1+R) are token guesses, never prices; a figure from it must read "model estimate". `loop-swarm` keeps the majority patch hash, and agreement is not correctness. Much of the 11.6k stars is for the docs, not the tools.
Already in Chausar?: the manager, executor and read-only auditor round and the round ledger are built from LongHorizon (`platform/runtime/venture/delivery/judge/auditor.ts`; `cards/harness.md`); turn, call and cost caps are built. The repeat-failure breaker, drills, fresh-proof gating and the 80% rule are not.

---

## pewdiepie-archdaemon/odysseus, now odysseus-dev/odysseus (AGPL-3.0, 94,247 stars, last commit 2026-10-22)

What it is: a self-hosted AI workspace in Python with a plain-JavaScript front end: chat and agent turns, deep research, email, calendar, notes, documents, scheduled tasks, local models.

Source: full (`app.py`, `routes/`, `src/`, `core/`, `static/js/`, about 2,650 files). AGPL: learn the ideas, copy no code.

How it works (the harness parts; the screens are in `frontend/workspaces.md`):
- **A latch after untrusted content** (`src/tool_capabilities.py:23-43, 666-889`; `THREAT_MODEL.md`). Every tool declares effects from a fixed list of 13 (read public, read private, write workspace, execute code, network egress, external side effect, destructive and so on) and a result integrity (system, workspace untrusted, external untrusted). Once external untrusted content has entered a run (a web page, search results, a YouTube transcript, research context, or a tool result that arms the gate), any tool with a private-read, write, execute, egress, side-effect, admin or destructive effect is blocked until the person authorises it; an unknown tool is blocked too. Control-plane sources (skills, the open email, uploaded files) still allow read-only tools. A run driven by an API token can never use privileged tools, and no approval lifts that.
- **Turn contract**: required, offered and executable capabilities are frozen before the turn; a missing one stops the turn with an honest message (`docs/AGENT_TURN_CONTRACT.md`).
- **Background research that reports back** (`docs/BACKGROUND_TOOL_JOBS.md`): a durable job row; a completion callback plus a startup worker that reconciles missed callbacks; the result message and its delivery marker are written in one transaction with a fixed message id, so a restart never posts twice; the report enters later turns as untrusted evidence; a run with zero sources shows a warning, not success; if the summary model is unavailable, an honest notice plus the report link.
- **Foreground first** (`src/task_scheduler.py:979-1074`): a scheduled task waits until the person is idle, is cancelled if they become active mid-run, and is deferred 20 minutes (40 after two deferrals). A failing task still moves its next run forward so it can't hammer.
- **Skill lifecycle** (`docs/skills-lifecycle.md`): Draft and Approved; an automatic audit takes at most eight records, oldest first; inconclusive checks retry after a day, failed repairs after a week; failed candidates stay drafts.
- **Recorded model**: each task run stores the model that actually ran, resolved inside the executor.

Take for Chausar:
- Business (playbook): a one-person research consultancy (market scans, competitor briefs) fits Chausar as an offer inside existing playbooks rather than a new one; the background-research shape is what to take.
- Engine or harness mechanism:
  - **The taint latch is the "restricted-data latch" the build audit lists as not built.** Give every Chausar tool a declared effect set and every tool result an integrity label. Once a run has read a client email, a web page, an uploaded file from outside or a bank statement, block outbound and write effects for the rest of that run unless the owner approves the exact action, at every posture. Unknown tools are blocked. Write it from the idea; no AGPL code.
  - **Background jobs report into the run that asked**, with a fixed message id and a delivery marker in one transaction, and "0 sources" shown as a warning.
  - **Foreground first** on the desktop: when the owner is using a local or rate-limited model, background runs wait and yield, and the run line says "Queued, waiting until you're idle".
  - **Improvement loop housekeeping**: audit at most N candidates at a time, oldest first, with retry spacing for inconclusive and failed ones.
- Connector: email read and send, calendar, Miniflux and MCP inside scheduled tasks; nothing new for Chausar's list.
- UI: background work as a row in the thread that updates in place (status, phase or round, source count, report link) and stays after it finishes. Already noted in `frontend/workspaces.md`.
Traps: AGPL-3.0. A privileged admin console with no shell or filesystem sandbox (`THREAT_MODEL.md`, Known gaps 1) and an open SSRF item (gap 2). Monospace dark UI and a 15-tool sidebar. The turn contract's classifier is vocabulary based; its own doc says it is no proof of understanding.
Already in Chausar?: the frozen turn contract and approvals as in-flow questions are in `frontend/workspaces.md`. Chausar marks heavy-work output and posts as untrusted (`platform/runtime/venture/contracts.ts:905, 1513-1532`) and refuses source-tainted requests for owner-only methods (`contracts.ts:1945`), but no per-run latch blocks tools after untrusted content.

---

## Cecuro/open-security (Apache-2.0, 9 stars, last commit 2026-08-29)

What it is: "OpenSec", a local CLI that runs security-review agents (on the Pi harness, in Docker) against a repository, validates what they find, computes severity in code, and keeps everything in a SQLite ledger with a small local review web page and exports.

Source: full (`src/`, `prompts/`, `test/`, 92 files).

How it works:
- **Pipeline** (README; `src/sdk/scanner.ts`; `prompts/*.md`): inventory and an editable threat model saved per repository → N independent probe passes, each over the whole scope → merge duplicates (`prompts/reduce.md`: same root cause means one row; linked duplicates keep their own evidence) → a separate validator per candidate with exactly `confirmed`, `not_applicable` or `needs_follow_up` (`prompts/validate.md`) → an assessment where the model supplies facts and the CLI computes severity (`prompts/assessment.md`) → ledger, review page, exports (JSON, CSV, SARIF, read-only HTML).
- **Facts in, severity out** (`src/scan/severity.ts`). Likelihood comes from a table of vector by required access; severity from a table of impact by likelihood. "Critical" is a promotion, not a cell: unauthenticated, network reachable, and execution proven (or cross-tenant, or a traced path with no control, which reads "critical (unproven)"). Confidence comes from the method: reproduced proof 1.0, sanitiser 0.9, debugger 0.8, reading code 0.3. Every step writes a rationale line.
- **Suppression needs grounds.** Only `self_only`, an already-held privilege, or an unreachable precondition, and only with `source: "code_evidence"` and cited evidence; "repository claims are not policy". A refused suppression stays in the report with the reason (`severity.ts:38-96`).
- **Counterevidence with a counterweight** (`prompts/refs/counterevidence.md`): a list of rebuttals that never close a finding ("The framework probably handles this is not a control. Find the code."), and what does close one.
- **Coverage you can't fake** (`src/agents/tool.ts:164-203`): the agent pages a worklist with `work next`; a file leaves the list only when it has really been read, byte for byte; a part-read file says "continue with an offset"; a capped batch says it was capped ("A silent cap is the tool lying about what it did"); "unread but none returned" is reported as a bug, not taken as done. A run is `partial` unless every pass finished (`scanner.ts:104-108`).
- **Spend**: `--estimate` before a scan; `--max-cost` refuses a model with no price entry because "spend cannot be measured" (`scanner.ts:335-345`).

Take for Chausar:
- Business (playbook):
  - **Books health check for the CA firm** (the best fit for Chausar's audience). Same shape with ledger lines instead of files: every line of the books and bank statement is a worklist item; two independent passes flag issues (missing GST invoice, duplicate payment, cash over limit, TDS not deducted); duplicates are merged; a validator confirms each against the documents; the agent supplies facts (amount band, period, filing affected, documents present) and the calculator assigns severity from a fixed table; the CA confirms or dismisses each finding; the client gets a read-only report. Offer: a fixed-fee review per quarter. The owner (or the CA of record) approves every finding before it reaches the client.
  - **Security review for small web apps**, for a freelance developer: fixed fee per scan, quote from the estimate, threat model the client can edit, findings confirmed by the owner, HTML snapshot delivered. Needs written permission from the code owner. Narrow audience.
- Engine or harness mechanism:
  - **The model states facts; code rates them.** Any Chausar check that ends in a rating (risk, priority, severity) takes typed facts from the model and computes the rating from a table in code, with rationale lines kept beside it. This matches the founder's rule that receipted figures come from code.
  - **Dismissing needs evidence.** An agent may not drop a finding without cited evidence of an allowed kind; a refused dismissal stays visible with its reason.
  - **Coverage from the tool, not the agent.** A work step over many items (statement lines, invoices, comments) uses a worklist the tool marks read; the result is "partial" unless coverage is complete, and the screen says so.
  - **Validator separate from finder**, with three outcomes including "needs follow-up" for missing facts.
- Connector: Docker and model providers through Pi; nothing new.
- UI (`src/review/assets/app.js:246-299`, `index.html`): two views, Runs and Findings. Run overview: name, status word, date, revision; a "Partial result" notice ("<n> of <total> probe passes reviewed the full scope. Findings may be useful, but this run cannot support a clean result."); a severity strip; facts list (repository, model, duration, cost, "Files read <n> of <total>"); the threat model. Finding page: eyebrow with the id, title, severity word, tags, a state picker with plain names (Needs review, Confirmed, Needs follow-up, Suppressed, Not applicable, Duplicate), Summary with copy, Locations with roles, "Severity basis" as a bullet list, Review history, a comment box whose draft is kept; a side column with Assessment (confidence, likelihood, proof gap, merged into) and Source (revision, filed by, created). Review opens only after the run ends; a shared snapshot says "This shared snapshot is read-only." For Chausar: the findings sheet beside the list, the state names, the "basis" list and the read-only client snapshot.
Traps: the page computes figures in the browser (`Math.round(bytes_read / bytes_in_scope * 100)`, `` `$${scan.cost_usd.toFixed(2)}` ``, `app.js:263, 442`), which Chausar forbids; take display strings from the engine. Float USD cost. Needs Docker and macOS or Linux (WSL2 on Windows). Tiny project, last code commit August. Agreement between probes is not proof, which the README itself says.
Already in Chausar?: unpriced models refused and estimates before spend are built (`floe-guard`, `Open Edit` in `cards/harness.md`; `docs/venture/ink.md`). The yes/no rules judge with cited evidence and the claims check are built (`delivery/judge/rules.ts`, `claim-check.ts`). Facts-in-severity-out, evidence-gated dismissal, the tool-marked worklist and "partial result" are not.

---

## openqodex/openqodex (Apache-2.0, 793 stars, last commit 2026-10-23)

What it is: a pre-push code review CLI. It runs the deterministic scanners that fit the changed files (22 built in: gitleaks, semgrep, osv-scanner and others), then starts a separate Claude Code or Codex process on the user's own login as reviewer, checks every claim the reviewer makes against the code, and writes a report plus a "receipt" the coding agent shows the developer.

Source: full (`packages/core`, `packages/review`, `packages/scanners`, `packages/graph`, `packages/mcp`, `packages/cli`, skills and plugins, golden tests).

How it works:
- **Every claim quotes the code, and code checks the quote** (`packages/review/src/evidence-check.ts:16-75`). A candidate carries 1-3 citations `{ file_path, line_number, quote }`. The quote must appear within two lines of the cited line in the snapshot, or in the removed lines of the diff. Every changed hunk must be listed as examined and given an analysis ("changed", "could_break"); misses go back to the reviewer as a correction round.
- **Coverage comes from the trace, never the reviewer's word** (`packages/core/src/completion.ts:1-60`). A changed range counts as reviewed only if its diff was in the brief, a correction round delivered it, or successful reads cover every line. The reviewer may use Read, Grep and Glob (web optional); any other tool in the trace fails the run.
- **Honest verdicts** (`packages/core/src/render/review.ts:20-125`): "Review incomplete: this is not a review of the change", with a Missing list and exit code 2; findings and "observations" are separate tiers, and observations "do not count toward the verdict"; scanner candidates no reviewer checked are named and count.
- **Second reviewer** (`packages/review/src/second.ts`): runs after the first with the same brief, tools and budget; findings merge by key with the higher severity kept and `foundBy` naming both; disagreements are recorded.
- **Lenses** (`packages/core/src/lenses.ts`): a named bug pattern is a markdown file with triggers (file globs, a regex on changed lines). A lens stands down when a scanner rule already checked the same files: "a script does the deterministic work, the model does not repeat it."
- **Severity and the gate** (`packages/core/src/severity.ts`, `push-gate.ts`): five words (info, nitpick, minor, major, critical); scanner levels map onto them; the push gate warns by default and blocks only at a configured severity.
- **Trust for added tools** (`packages/scanners/src/custom/index.ts:47-438`, `docs/custom-scanners.md`): only `openqodex trust` downloads a custom scanner, into quarantine; it shows what will run and asks yes or no; approval is bound to the entry's hash and the binary's sha256 and rechecked before each run.
- **The hand-back** (`skills/openqodex/SKILL.md:43`): the agent shows the receipt and asks "Fix all, or tell me which?", and changes nothing before the answer. By default the agent that wrote the code doesn't review it.

Take for Chausar:
- Business (playbook): **QA as a service for a freelance dev agency**: every client change gets a report before it ships; the client sees the verdict line and the findings. Medium value; same audience as the maintenance retainer above.
- Engine or harness mechanism:
  - **Quote-at-location checks for drafts.** Chausar's claims check already confirms that figures and names in a draft exist in the client's files or the run's evidence (`delivery/judge/claim-check.ts`). Add OpenQodex's stricter form wherever an agent cites a source: the cited quote must appear at the cited place (page, row, timestamp in a transcript) within a small window, else the citation is rejected and the agent gets one correction round.
  - **Coverage from the trace** for the read-only auditor: count only what the tool trace shows was read; any tool outside the auditor's allowlist fails the audit.
  - **Lenses that stand down** in playbooks: e.g. a "reverse charge" lens for GST drafts triggers on the words, and stands down when the calculator already computed RCM for those invoices.
  - **Findings versus observations**: only findings count toward a draft's verdict.
- Connector: GitHub Action and pre-push hooks; nothing new for Chausar.
- UI (`tests/golden/expected/claude/run/report.md`, `packages/core/src/render/`): the headline verdict ("Passed with warnings: 27 findings (14 major, 13 minor)"), one change line, then each finding as Where / Problem / Why it matters / Fix / Source, where Source names the scanner rule or "the reviewer". That card is a clean shape for Chausar's check results on a draft before the owner reads it. The "Fix all, or tell me which?" hand-back fits Today's "Send back with your own words", which the build audit lists as missing.
Traps: the benchmark tables in the README come from the project's own planted-bug set and can't be checked here. Not tested on Windows. Bearer, the example custom scanner, is Elastic Licence. Reviews run on the user's Claude or Codex subscription login; Chausar should check provider terms before automating a subscription CLI for clients. The reviewer still sends code to the model provider even with `--offline`.
Already in Chausar?: claims-grounded checks, yes/no rules with quotes, pairwise comparison and a quality baseline are built (`delivery/judge/`). Quote-at-location, trace-based coverage, observation tier, lenses and the second reviewer are not. Exact-hash approval of owner-added tools is close to Open Edit's script-hash approval (`cards/harness.md`, README table).

---

## pinloop-ai/pinloop-cli (MIT, CLI only; 559 stars, last commit 2026-10-22)

What it is: the published command-line client of Pinloop, a paid job board meant to be driven by a coding agent: search and pull postings, keep a resume and preference files on the server, have the server's model judge each posting against the person, save shortlists, and run saved routines on a schedule.

Source: partial. The CLI (`src/cli/`, 7 files) and the code shared with the server (`src/shared/`, 16 files) are here. The server (search, embeddings, the judge run, postings, billing, `src/core/judge.ts`, `src/server/limits.ts`, the specs and the `package-boundary` test the comments cite) is not; it is a hosted service at $20 a month. Nothing local to reverse engineer: the API is already readable from the CLI.

How it works:
- **Verdict words, not scores** (`src/shared/verdicts.ts`): the model may answer only `no`, `weak`, `fair` or `strong`; a run can keep postings at or above a word, and every drop prints "judged weak, below fair".
- **Coverage first, as a fraction** (`src/shared/coverage.ts`): whenever something was left out, the first thing said is how much came through, e.g. "996/1000 postings had embeddings and were considered"; never reduced, "0/0" when there was nothing; the server sends two whole numbers and the client formats them.
- **Two calls for anything that costs** (`src/shared/guide-text.ts:325-380`): the first call does nothing and prints what the second would do (judgments it would run, postings it would take, what is left this month) plus a token good for one hour, one account and the exact request. The agent must put the choice to the person in one sentence and also say the free way (read what the account already holds and form its own view). For a schedule it prints the most one firing could do.
- **Limits that protect against a stuck agent** (`src/shared/limits.ts`): 20 messages per account per day, counted from stored rows so a deploy can't reset it; a pull ceiling refused before any page is fetched; the agent guide prints these numbers from the same constants the server enforces.
- **Routines and watches** (`guide-text.ts:1368-1404`): saved steps (search → judge keep strong → add to a shortlist), and a watch runs a routine every six hours over new arrivals.
- **Progress names the real model** (`src/shared/progress-events.ts`): NDJSON events while a run goes; `call-started` carries the model and provider as the provider named them, "because the model that answers is not always the model that was asked for".
- **Agent-first onboarding**: running `pinloop` alone prints instructions for the coding agent; `pinloop welcome` has the agent walk the person through setup.

Take for Chausar:
- Business (playbook): **job-search assistant or career coach**, a real self-employed business in India: per client, a profile and preferences; a nightly routine finds new postings and the model screens them into the four words; the owner reviews the shortlist and tailors applications; the client gets a weekly list. Earns a monthly fee per client. The owner approves every shortlist and every application sent. Data is the hard part: Pinloop's own account is per person and its terms are not in the repo, so reselling it to clients is unclear; public job feeds from hiring systems are the honest connector.
- Engine or harness mechanism:
  - **Coverage-first wording rule** for every Chausar message about something partial: "1,204/1,210 statement lines matched" before the list of the six that didn't. The engine sends the two numbers; Ink formats them.
  - **Fixed verdict words for model judgments** (strong, fair, weak, no), labelled as the model's judgment, with a keep threshold and a printed drop reason. Never turned into a score that looks measured.
  - **Daily caps on agent writes**, counted from stored records, so an agent looping overnight can't flood a client or the books.
  - **Record the model that answered**, from the provider's own response, on every run line and cost receipt.
  - **Say the free way** on every quote row: what the owner could do without spending.
- Connector: Pinloop CLI as `handoff` (the owner's own account); public hiring-system job boards as `read`, `planned`.
- UI: the dry-run sentence before spend; "judged weak, below fair" as the reason line on hidden items; thousands separators applied only in the client.
Traps: postings are pulled from "job boards like LinkedIn" (README), which raises platform-terms questions Chausar should not inherit. The verdicts are model words, not facts. The core of the product is closed and paid; the MIT licence "covers the CLI only".
Already in Chausar?: quotes bound to draft, figure and payer for one hour are built (Open Edit pattern, `docs/venture/ink.md`); Chausar's spend refusal shows a reason. The coverage-first sentence rule, verdict words, daily write caps and the answered-model record are not. No recruiting playbook exists; Grok's list had other recruiting repos that were never read (`build-audit-2026-10-23.md`).

---

## Ideas worth taking, ranked by value

| Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|
| Repeat-failure breaker (same error 3x, same action 3x, 5 failures in a row) with an "already tried" block fed to the next turn | loop-engineering `tools/loop-context/src/context-manager.ts` | engine | high | S |
| Playbook steps with outcome edges, loop caps, step timeouts with failover agents, gate default plus timeout, run deadline, `blocked` with a reason, attempt numbers | Beeline `docs/workflows/README.md`, `workflow-contracts.ts` | engine | high | L |
| Taint latch: tools declare effects; after untrusted content enters a run, outbound and write effects need the owner's approval at every posture; unknown tools blocked | Odysseus `src/tool_capabilities.py` (AGPL, idea only) | engine | high | M |
| Model supplies typed facts, code computes the rating with rationale lines; dismissing a finding needs cited evidence | Open Security `src/scan/severity.ts` | engine | high | M |
| Books health check for the CA firm: every ledger line on a worklist, two passes, merge, validate, code-rated severity, CA confirms, client gets a read-only report | Open Security pipeline | playbook | high | M |
| Worklist the tool marks read, "partial" unless complete, and coverage said first as a fraction ("1,204/1,210 lines matched") | Open Security `src/agents/tool.ts`; Pinloop `src/shared/coverage.ts` | engine + UI | high | M |
| Failure kinds with fixed instruction sentences; retry only the transient kind (3 tries) | Beeline `packages/api-contract/src/turn-silence.ts` | engine + UI | high | S |
| Quote-at-location citation check with one correction round | OpenQodex `packages/review/src/evidence-check.ts` | engine | high | S |
| Open "auto with spot checks" only on fresh proof: verifier, a recent passing run, complete spend log, drills passed since the last playbook change | loop-engineering `tools/loop-audit/src/auditor.ts` | engine | high | M |
| Today row line `for <client> · <business> · expires in 2 h`; questions leave after 24 h seen, approvals stay until decided | Beeline `needs-you.ts`, `NeedsYouCell.tsx` | UI | high | S |
| Approve from a phone chat (Telegram first): engine stays the authority, double choice submits nothing, offline clicks never replayed, one closing line on applied, failed or unknown; money stays in-app | keet-for-agent `packages/impri-keet/src/bridge.ts` | connector | high | M |
| Turn line with "received", "stopping", "stopped", and Stop that keeps what was written | Beeline `DESIGN.md` (Turn line) | UI | med | S |
| Guardrail fire drills both ways (bad blocked, benign allowed), recorded against the playbook hash | loop-engineering `tools/loop-drill` | engine | med | M |
| "Review incomplete" honesty and auditor coverage taken from the tool trace; disallowed tool fails the audit | OpenQodex `packages/core/src/completion.ts`, `render/review.ts` | engine | med | S |
| Check-result card: verdict headline, then Where / Problem / Why it matters / Fix / Source; observations don't count | OpenQodex `report.md`, `render/review.ts` | UI | med | S |
| Findings sheet: plain state names, "Severity basis" list, review history, kept comment draft, read-only client snapshot | Open Security `src/review/assets/app.js` | UI | med | M |
| Notify only for decisions; everything else in a digest; flag rows waiting on the owner over 24 h | loop-engineering `docs/failure-modes.md`; Beeline `commander-wakes.ts` | UI + engine | med | S |
| 80% of budget switches the agent to report only | loop-engineering `loop-constraints.md` | engine | med | S |
| Orders down, reports up with `done/blocked/failed/needs_decision`; cascade caps (depth 4, 12 turns per root) once agents message each other | Beeline `commander.ts`, `system-events.ts` | engine | med | M |
| Run page rail with predicted upcoming steps dimmed; status as a word | Beeline `WorkflowRunLine.tsx` | UI | med | S |
| Purpose-first approval card (1-240 char purpose, details folded) | Beeline `docs/approval-matrix.md` | UI | med | S |
| Background job reports into the run that asked, fixed message id, "0 sources" as a warning | Odysseus `docs/BACKGROUND_TOOL_JOBS.md` | engine | med | M |
| Lenses: rule files with triggers that stand down when a code check already covered them | OpenQodex `packages/core/src/lenses.ts` | engine | med | M |
| Job-search assistant or career coach playbook (profile, nightly screen into four verdict words, owner-approved shortlist) | Pinloop CLI | playbook | med | M |
| Fixed verdict words for model judgments with a keep threshold and a drop reason | Pinloop `src/shared/verdicts.ts` | engine + UI | med | S |
| Daily caps on agent writes counted from stored records | Pinloop `src/shared/limits.ts` | engine | med | S |
| Foreground first: background runs wait while the owner is active on a local or rate-limited model | Odysseus `src/task_scheduler.py` | engine | med | S |
| One sentence grammar for system lines, held by a contract test | Beeline `system-line.ts` | UI | med | S |
| Type and spacing lints with per-file baselines that only shrink | Beeline `calm-lint`, `design-lint` tests | UI | med | S |
| Second reviewer with merged findings and recorded disagreements | OpenQodex `packages/review/src/second.ts` | engine | med | M |
| Durable ordered inbound feed with a stable event id for client-message connectors | keet-for-agent `webhook-event-feed.ts` | connector | med | S |
| Agency with a shared client room (brief per request, owner yes on the exact version) | Beeline | playbook | med | L |
| Record the model the provider says answered, on runs and cost receipts | Pinloop `progress-events.ts`; Odysseus `task_scheduler.py` | engine | low | S |
| Exact-hash trust for owner-added tools, rechecked before each run | OpenQodex `packages/scanners/src/custom/index.ts` | engine | low | S |
| Software maintenance retainer playbook (report-only week one, owner approves each PR) | loop-engineering patterns | playbook | low | M |
| QA-as-a-service playbook for dev agencies | OpenQodex | playbook | low | M |
| Security review for small web apps playbook | Open Security | playbook | low | M |
