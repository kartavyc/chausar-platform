# Quality judging, evaluation, data and computer use: repo cards

Harvest of 21 October 2026. Seven repos, each shallow-cloned and read from source. Nothing was installed or run. Paths are relative to each repo root. "Planned" is the honest label for every pattern below: none of it is in Chausar today.

---

## NVIDIA/SkillEvaluator

- **What it is.** A Python CLI that checks an agent skill (a `SKILL.md` folder) in three tiers: static and security checks, duplicate-guidance detection, then live sandboxed agent runs with and without the skill. Version 0.6.0 (20 Oct 2026), about 113k lines of Python, backed by an arXiv paper.
- **How it works.**
  - *Paired trials and Skill Lift.* Tier 3 runs the same cases twice, with the skill and without it, and lift is plain subtraction in code: `lift = with_skill - baseline` (`src/skillevaluator/evaluation/dimension_judge.py`, `compute_dimensions_deterministic`). Without a baseline run, lift is reported as missing rather than guessed.
  - *The judge votes and code counts.* The accuracy judge has to return five named booleans, and code computes `score = sum(true) / len(applicable)` itself (`src/skillevaluator/tier3/eval_core/llm_judge.py`, `judge_accuracy`). The JSON is strictly validated: duplicate keys and non-finite numbers are rejected, and a malformed reply gets an error instead of a guess.
  - *Deterministic checks before the judge.* `tier3/eval_core/checks.py` (5.7k lines) parses the agent's trajectory for secret exposure, network exfiltration, protected-path writes, and whether the skill file was actually read. Each of these is decided by code, never by a model.
  - *Bring your own grader.* `evals/grader.py` runs after the agent in the sandbox. Modes are `default`, `default_plus_custom` and `custom_only` (`docs/custom-graders.mdx`).
- **What Chausar should take.**
  - *Rehearsal/quality judge.* Use with/without pairs: rehearse a delivery agent on the three made-up clients with its playbook and without it, and have code report the lift. That number is the honest answer to "does this playbook help?".
  - *Rehearsal/quality judge.* Make the judge return booleans only, one per named criterion, and let code do the counting. This fits the no-arithmetic rule exactly.
  - *Delivery harness.* Use a trace scanner (secrets, outbound network calls, writes outside the work folder) as a deterministic gate that runs before any judge.
- **Licence verdict.** Apache-2.0: reuse with attribution (keep NOTICE).
- **Risks or gaps.**
  - The five-dimension judge asks the LLM for a float `score` per dimension (`dimension_judge.py` prompt). That's LLM-made numbers; a deterministic fallback exists, but the LLM path is the default. The accuracy judge also keeps a legacy "score only" payload path.
  - The stack is heavy: Docker sandboxes, Harbor, Semgrep, Gitleaks and SkillSpector. Tier 3 needs paid model calls.
  - Claims match the code, with that judge-score caveat.
- **Label for Chausar today:** planned.

## braintrustdata/agentbehavior

- **What it is.** An open format (`BEHAVIOR.md`, YAML frontmatter plus Markdown) for writing down how an agent should behave across a whole trajectory, plus a small validator CLI. It started as a Basis and Braintrust collaboration and has about 75 files.
- **How it works.**
  - *Spec format.* Specs live in `.agents/behaviors/<name>/BEHAVIOR.md` under optional labels: Intent, Evidence, Decision, Execution, Recovery, Failure modes. `packages/agentbehavior/src/index.ts` (716 lines) only checks structure: name pattern, lengths, frontmatter.
  - *Judge per H2, folded by code.* In `examples/tax-research-behavior-eval/src/judge.ts`, each H2 heading is judged on its own as `true`/`false`/`na`, and the prompt says "do not calculate a file-level verdict". `foldBehaviorVerdicts` folds them as: any false gives false, all na gives na, otherwise true.
  - *Citations are checked by code.* Every occurrence must cite event IDs that exist in the trajectory, and a `false` verdict must quote the violated clause verbatim. Code checks both (`judge.ts` lines ~257-322) and throws otherwise.
  - *Calibration matrix.* `.agents/skills/writing-agent-behavior/references/calibrating-with-trajectories.md` has five fixture types: positive, negative, "lucky-correct negative" (right answer, wrong process), outside scope, and allowed boundary.
- **What Chausar should take.**
  - *Blueprint/playbook.* Store each delivery step's conduct rules as a behavior spec next to the playbook. The example specs `financial-work-verification` and `cost-sensitive-actions` are close to what Chausar's agents need already.
  - *Rehearsal/quality judge.* Use the judge contract as is: per-rule true/false/na, cited event IDs checked against the run log, a verbatim clause on failure, and a deterministic fold.
  - *Rehearsal/quality judge.* Add the "lucky-correct negative" fixture to the three made-up clients, so an agent that gets the right invoice the wrong way still fails.
- **Licence verdict.** Apache-2.0: reuse with attribution.
- **Risks or gaps.**
  - The package itself only validates file shape. Judging lives in example code, not a library.
  - It's young (last commit July 2026), and the spec deliberately prescribes no labels or folding.
- **Label for Chausar today:** planned.

## QwenLM/open-computer-use

- **What it is.** An MCP server (`@qwen-code/open-computer-use`) with 9 tools that drive desktop apps through accessibility APIs: Swift on macOS, and experimental Go plus PowerShell UI Automation on Windows and Go plus Python AT-SPI on Linux. It's a fork of iFurySt/open-codex-computer-use, MIT, last commit June 2026.
- **How it works.**
  - *Accessibility tree first.* `get_app_state` returns a screenshot plus an indexed accessibility tree, and the model acts by `element_index`. Clicks try the semantic `AXPress` first and fall back to events aimed at that one process (`packages/OpenComputerUseKit/Sources/OpenComputerUseKit/ComputerUseService.swift`). Global pointer fallbacks are off unless `OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS` is set.
  - *State per turn.* The tool description requires `get_app_state` once per assistant turn before interacting (`ToolDefinitions.swift`), so element indexes never go stale across turns.
  - *Scaled coordinates.* Screenshots are downsampled to a byte budget, and model coordinates are mapped back against live window bounds (`docs/IMAGE_CAPTURE.md`).
  - *Fixture app plus smoke suite.* `apps/OpenComputerUseFixture` is a low-risk GUI target, and `apps/OpenComputerUseSmokeSuite` calls all 9 tools against it over JSON-RPC.
- **What Chausar should take.**
  - *Connectors.* For "work done entirely on a computer" where no API exists (a client's desktop accounting tool, say), accessibility-first control is a possible future `write` path, with each app as its own connector. Until a run proves it, it stays `planned`.
  - *Rehearsal.* Rehearse against a fixture app, never against a real one: Chausar's made-up-client rehearsal should have an equivalent made-up desktop target.
  - *Delivery harness.* Re-read the state each turn before acting, which is a cheap guard against acting on stale screen state.
- **Licence verdict.** MIT: reuse with attribution.
- **Risks or gaps.**
  - There's no app allowlist, approval step or action log in the server. Safety is entirely the MCP client's job.
  - Windows and Linux are called experimental in `docs/ARCHITECTURE.md`. The mature path is macOS, and the Chausar founder runs Windows.
  - Most docs are in Chinese. The repo has Git LFS objects that 404 (an upstream reverse-engineering bundle). A lot of the effort went into cursor-animation fidelity, not safety.
- **Label for Chausar today:** planned.

## HelixDB/helix-foundry

- **What it is.** A local-first data workspace on HelixDB and DuckDB. It connects Postgres, Stripe, WorkOS, PostHog, files and so on, suggests one ontology across them, and answers questions. Docker Compose with a local Ollama model, about 22k lines of TypeScript. Chausar's architecture already cites it for Piece 2.
- **How it works.**
  - *Code proposes structure; a digest pins it.* `suggestOntology` in `apps/api/src/discovery.ts` builds entities and links from keys and overlaps in code, then hashes the structural parts (`digest(JSON.stringify({entities, links}))`, around line 811). `confirmOntology` accepts only exclusions and renames of known IDs, and checks that names are unique and non-empty.
  - *Preview, then execute, with revision and idempotency.* `POST /actions/execute` (`apps/api/src/routes/ontology.ts`, around line 216) needs the object's revision (optimistic lock) and an idempotency key. A key reused with a different body gets a 409. Edits go to an overlay, never the source row, and each one writes an audit record with before and values.
  - *The model writes SQL; DuckDB computes.* The question prompt says "Answer the question with one read-only SQL query ... Do not calculate results yourself" (`apps/api/src/assistant.ts` ~954). Home metrics work the same way: the AI picks metric specs, and code compiles, runs and keeps the ones that work (`metrics.ts`).
- **What Chausar should take.**
  - *Venture desk / autonomy ladder.* Copy the execute contract for owner approvals: preview showing before and after, approve with revision plus idempotency key, write an overlay plus an audit row. This is the right shape for "approve each draft".
  - *Back office / unit economics.* Copy "model writes a query, engine computes" for owner questions over the books ("which client paid late most?").
  - *Blueprint.* The digest-pinned proposal is already adopted in Piece 2. Keep citing it.
- **Licence verdict.** Apache-2.0: reuse with attribution (keep NOTICE).
- **Risks or gaps.**
  - The result summary is model-written and told to use "only numbers that appear in the result rows ... or the difference between two of them" and to "divide by 100" for Stripe cents (`assistant.ts` ~1066). That's LLM arithmetic, and no code checks the summary's numbers. Chausar must not copy that step; it should use a numeral-faithfulness check instead.
  - Validated on macOS only. Windows is untested and the scripts need bash.
- **Label for Chausar today:** planned.

## rollroyces/py-idp

- **What it is.** An intelligent document processing pipeline in Python: parse, classify, extract, assess, validate, human review. It's Pydantic-schema driven, with many LLM backends and an eval harness. v0.5.0, about 15k lines.
- **How it works.**
  - *A stage pipeline over one Document.* `src/idp/pipeline/pipeline.py` runs pure stage functions and records per-stage timing and cost.
  - *Honest confidence.* `src/idp/assess/confidence.py` defaults to a crude but reproducible heuristic (by extraction mode and field type). Its docstring says LLM self-rating is "calibrated poorly". Blending in LLM self-assessment is opt-in.
  - *Business rules as small functions.* `src/idp/validate/validator.py` has `required_fields_rule` and `numeric_range_rule`, which return `(passed, reason)`.
  - *"RL" from human corrections, which is really a rule update.* `src/idp/rl/policy.py` raises per-field review floors and lowers confidence for fields humans keep correcting. The code says plainly that it ISN'T a learned model.
- **What Chausar should take.**
  - *Back office (bookkeeping studio).* Use the per-field review loop: fields the owner corrects often get sent to review more often. It's deterministic and inspectable, which fits the receipts rule.
  - *Delivery harness.* Use the stage-and-rule split for "agent reads the client's files": the extraction is the model's, and the checks (required fields, ranges, and subtotal plus tax equals total, which py-idp lacks) are code.
- **Licence verdict.** Learn only. The `LICENSE` file is a dual licence: AGPL-3.0 or a paid commercial licence (Solo $300 a year and up). A hosted Chausar embedding it would trigger AGPL. Don't copy code; re-implement the ideas.
- **Risks or gaps.**
  - The README markets "RL", but the code admits it's a rule update.
  - No built-in arithmetic cross-check between line items and the total.
  - The heuristic confidence doesn't measure correctness.
  - It's a single author, and the licence has a one-company carve-out and a placeholder contact for buying.
- **Label for Chausar today:** planned.

## useopendesk/opendesk

- **What it is.** An open-source helpdesk (shared inbox, live chat, knowledge base) with a built-in AI, "Ollie", that drafts, triages and answers. It's one Go binary plus an Elixir realtime gateway and Postgres. Apache-2.0, very active (commit 21 Oct 2026), about 2.6k files. The clone needed `core.longpaths` on Windows.
- **How it works.**
  - *Propose and Apply tools.* Every write tool in the owner's assistant has a `Propose` (builds a preview) and an `Apply` (`internal/ai/assistant/tools_write.go`). "Nothing is sent without" approval of the full reply draft. Only one change can wait at a time, and a new message expires pending ones (`run.go`, `expirePending`).
  - *An approval token the model never sees.* The decision is a signed token bound to action, user, sign-in session and workspace. Code says "It reaches only the user's browser, never the model" (`run.go`, `approvalToken` and `decide`), and claiming the action is atomic.
  - *Tool policy from MCP annotations.* Each connected MCP tool gets `policy: auto | confirm`, defaulting to auto only for `readOnlyHint` tools. Non-read-only tools start disabled, and `verified_only` limits tools to verified visitors (`contracts/agent.md`). Visitor actions expire after 15 minutes.
  - *A quality loop.* A review queue lists replies rated unhelpful or handed off. "Improve answer" turns into a Q&A snippet plus an optional saved test, and tests carry expectations: `mentions`, `not_mentions`, `handoff`, `no_handoff`, `uses_tool`, `cites_knowledge` (`internal/ai/agent_review.go`, `agent_tests.go`). There's also a transactional outbox: events are written in the same transaction as the change (`internal/events/events.go`).
- **What Chausar should take.**
  - *Autonomy ladder.* Use Propose/Apply with an approval token bound to user, session and action, which the model can't forge. One pending approval at a time, expiring on new input. This is the "approve each draft" step done right.
  - *Connectors.* Derive each connector tool's default from its declared read-only or destructive hints: read tools auto, write tools confirm and off by default. This matches Chausar's honest connector labels.
  - *Rehearsal/quality judge.* Every owner correction becomes a regression test with typed expectations. Most of them (handoff, uses_tool, cites) are checked by code.
  - *Venture desk.* The outbox of events in the same transaction confirms the Piece 1 design.
- **Licence verdict.** Apache-2.0: reuse with attribution.
- **Risks or gaps.**
  - The README hero ("Ollie cancels and refunds an order") depends on the company's own MCP server. opendesk itself doesn't refund anything.
  - The confirm card's `_summary` (like "refund $25") is model-written text with a number in it. Chausar would refuse that and render the amount from the tool's arguments.
  - The `mentions` expectations are graded by an LLM call.
- **Label for Chausar today:** planned.

## trycompai/crm (branch `release`)

- **What it is.** An "agentic-first" CRM. A durable agent (on Vercel's eve framework) researches contacts on its own schedule and writes facts to the CRM with evidence. It's MIT, a Bun, Postgres and Next stack, about 1.5k files, with the last commit August 2026.
- **How it works.**
  - *Evidence kinds priced by a ledger, not model confidence.* `apps/agent/agent/lib/evidence.ts` has fixed weights per kind (like `crm.signature-block` 0.8 and `web.cited-claim` 0.4), combined as `1 - product(1 - w)`, capped at 0.99, and held to 0.45 on any contradiction. That gives bands VERIFIED, PROBABLE or POSSIBLE, and VERIFIED also needs a "primary" source. Only VERIFIED may overwrite an existing value; anything else becomes a suggestion for a human (`lib/facts.ts`).
  - *A capabilities list told up front.* `lib/capabilities.ts` builds an on/off list of which keys exist and what each gives. The agent gets it at session start, and it's printed at boot.
  - *Lease-based work queue.* `lib/tasks.ts` `claimDue` uses `FOR UPDATE SKIP LOCKED` with a lease, so a dead run frees its row. Rechecks are `dueAt` rows with a stated reason, not cron.
  - *Sensitive writes denied when unattended.* `lib/approval.ts` `sensitiveWrite` returns `denied` for automated sessions and `user-approval` otherwise. The sandbox has deny-all egress and is never given `DATABASE_URL`. `docs/currency.md` covers money as amount plus currency, with a frozen FX rate, and a missing rate is "disclosed not zeroed".
- **What Chausar should take.**
  - *Customer engine.* Use the evidence ledger, which in code is a fixed table plus a pure scoring function, for client and lead facts, with "strong overwrites, weak becomes a suggestion".
  - *Connectors.* Use the capability preamble: tell the agent at session start exactly which connectors are on, which is the runtime twin of Chausar's honest connector chips.
  - *Autonomy ladder.* Use "denied when unattended, user-approval when attended" as a per-tool rule.
  - *Back office/books.* The currency rules (rates frozen at write time, missing rates disclosed and excluded from sums with a count shown) are good for multi-currency invoices.
  - *Delivery harness.* Use the lease queue for agent work.
- **Licence verdict.** MIT: reuse with attribution.
- **Risks or gaps.**
  - The "nothing is guessed" claim is only partly backed. The model still picks the evidence `kind` itself in `record_fact`, and code doesn't check that a matching tool call happened, so a model could claim `profile.email-match` without seeing it.
  - The weights are hand-set constants. Also, eve is a Vercel framework, so the durable runtime is a dependency.
- **Label for Chausar today:** planned.

---

## Top 3 to adopt first

1. **opendesk's Propose/Apply plus a bound approval token** (`internal/ai/assistant/run.go`, `tools_write.go`). This is the most direct fit for "the owner approves each draft": a preview, a token only the owner's browser holds, one pending change at a time, and an audit trail. Pair it with helix-foundry's revision plus idempotency key on execute.
2. **The judge votes, code counts.** Combine agentbehavior's per-rule `true/false/na` with cited event IDs checked against the log and a deterministic fold, and SkillEvaluator's boolean criteria counted by code plus with/without-playbook lift. This gives the rehearsal judge a design that never asks a model for a number.
3. **trycompai/crm's evidence ledger and capability preamble** (`lib/evidence.ts`, `lib/capabilities.ts`). A fixed weight table that turns observations into VERIFIED, PROBABLE or POSSIBLE (strong writes, weak suggests), plus a session-start list of which connectors are really on. Chausar should add one step CRM lacks: check each claimed evidence kind against an actual tool result.
