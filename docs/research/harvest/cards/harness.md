# Harvest cards: agent harness, approval and safety

Studied 21 October 2026 from shallow clones (default branch; `decionis/docker` on `master`). Nothing was installed or run. Paths are relative to each repo root. Every pattern below is labelled `planned` for Chausar: none of it is in Chausar's code today.

---

## yc-software/qm

- **What it is.** A multiplayer agent harness for a company, used through Slack and a web app. Each person and each room gets its own scoped memory, files, keychain view, permissions and a durable sandbox; Pi or Claude Code drive the turns.
- **How it works.**
  - *Security posture ladder.* `src/security/security-posture.ts` defines three postures: `strict` (every tool call waits for a human), `auto` (default; blocks private networks) and `dangerous`. `composeSecurityPosture` ranks them, and a narrower scope can only make things stricter than the org floor, never looser.
  - *A command floor that applies in every posture.* `src/policy/command-policy.ts` holds org floor rules (recursive delete, force push, `drop table`, pipe-to-shell need approval; `mkfs` and fork bombs are denied). It parses the shell command with tree-sitter and unwraps `sudo`, `xargs`, `nice` and other wrappers, so it isn't fooled by simple string tricks. Scope rules are appended to the floor; they can't remove it.
  - *Untrusted-content screen.* The same posture file carries a classifier prompt that treats tool output as data. Its question is whether the text tries to take authority it doesn't have; ordinary business records, READMEs and imperative wording don't count. Modes are `off`, `observe` (logs only) and `enforce` (quarantines content until someone releases it).
  - *Approvals as durable records.* `src/core/approval-store.ts` stores a pending approval and sends a card with an idempotency key, so a restart re-sends without duplicating. `src/credentials/keychain-approval.ts` lets the owner answer a credential request with `once`, `standing` or `deny`, and sends the card back to the conversation that asked.
- **What Chausar should take.**
  - **Autonomy ladder:** the rule that a narrower scope can only tighten. A business-level setting of "approve each draft" should always beat a playbook step that asks for less. Keep a floor of actions (send, issue invoice, delete) that need approval at every rung, including the planned "auto with spot checks".
  - **Delivery harness:** the `observe` then `enforce` rollout for a new check. Chausar can run a new guard in observe mode during rehearsal and shadow, and switch it to enforce once it stops misfiring.
  - **Model connections:** `once` / `standing` / `deny` maps directly onto Chausar's standing consent for non-client words and one-time consent for client data.
- **Licence verdict.** MIT. Reuse with attribution.
- **Risks or gaps.** A large system (Postgres, Fastify, Slack Bolt, Fly or AWS) built for internal staff, not for a business owner and their clients. The injection screen is a model call, so it is a probabilistic filter, not a guarantee; the README says this too. The `src/decisions/` hooks pick actions from model probabilities, which is fine for routing but must never touch money. Contributions are accepted only as written ideas, not code.
- **Label for Chausar today:** planned.

---

## cloudflare/cloudflare-os

- **What it is.** Cloudflare's internal "AI productivity OS" on Workers: an agent chat, small sandboxed apps called gadgets, and "Gatekeepers", one per outside service, that sit between agents and that service. Marked early access (v2, August 2026).
- **How it works.**
  - *Every side effect is a journalled action.* `packages/gatekeeper-kit/src/actions.ts` defines an action kind with `describe()` (plain text for the approver), `apply()` (runs only after approval), optional `reject()` (cleans up what staging set aside) and `provides()` / `dependsOn()` for actions that build on each other. `src/action-journal.ts` stores each record as `staged`, `pending`, `claimed`, `failed` or `applied`.
  - *Approval without stopping the agent.* Each kind declares `delivery: "continue-with-simulation"` or `"await-decision"`. With simulation, the agent carries on and reads back a simulated result. `src/simulation.ts` replays pending actions over the real state, and when it meets an effect it can't simulate it returns `incomplete` with a reason instead of pretending. See `packages/gatekeeper-google/src/sheets-simulation.ts` for a real example.
  - *Honest unknown outcomes.* `claimBeforeApply` takes a durable claim before an irreversible call. If the process dies or times out after the provider was reached, the record becomes `ActionOutcomeUnknownError` with the message "may or may not have taken effect, check the provider before submitting it again". The Gmail gatekeeper then refuses to resend (`gatekeeper-google/src/gmail.ts`, "refusing to risk duplicate delivery").
  - *Fences and narrow auto-approval.* A `fence` pins an approved action to the account it was approved under, so it won't run after the user reconnects a different account. `packages/workshop-backend/src/auto-approval.ts` auto-applies only when the gatekeeper author marked the kind `autoApprovable`, the user switched on a rule for that exact kind on that gatekeeper, and the workspace hasn't been latched into restricted-data mode.
- **What Chausar should take.**
  - **Back office / books and connectors (`write`):** model "issue invoice", "record payment" and every future send as a journalled action with `describe` / `apply` / `reject`, a durable claim before dispatch, and a third outcome, "unknown, check before retrying". That is the honest answer when a send times out, and it fits "never fake a capability".
  - **Rehearsal and shadow:** `continue-with-simulation` is exactly Chausar's record-only mocks. Use the simulation replay with its `incomplete` result so a rehearsal run says plainly which effects it couldn't simulate.
  - **Autonomy ladder:** auto-approval needs three keys at once (the kind allows it, the owner turned it on for that kind, no restricted-data latch). That is a sound shape for the planned "auto with spot checks" rung.
- **Licence verdict.** Apache-2.0. Reuse with attribution (keep the NOTICE and licence text; mark changes).
- **Risks or gaps.** Built on workerd, Durable Objects, Dynamic Workers and Cap'n Web, so the code won't drop into Chausar's engine; port the pattern. `workshop-backend/src/overseer.ts` is 13,500 lines. `plans/step-transactionality.md` describes a crash bug the team calls live and a fix that is still a plan, not code. The simulation is only as good as each gatekeeper's per-kind simulator.
- **Label for Chausar today:** planned.

---

## omnigent-ai/omnigent

- **What it is.** A "meta-harness" in Python that drives Claude Code, Codex, Cursor, OpenCode, Hermes, Pi and YAML-defined agents under one server, with cloud sandboxes and shared sessions. Self-described alpha.
- **How it works.**
  - *Three verdicts, three levels.* `docs/POLICIES.md` and `omnigent/policies/`: each policy returns ALLOW, DENY or ASK (pause for the user). Policies come from the server admin, the agent spec and the session; session policies run first, and any DENY stops the rest.
  - *Fail closed where it matters.* `omnigent/policies/types.py` lists `FAIL_CLOSED_PHASES = ("PHASE_TOOL_CALL", "PHASE_REQUEST")`. If a policy errors before the model runs or before a tool runs, the action is blocked. On the tool-result phase it fails open, because the tool has already run.
  - *Spend gate.* `omnigent/policies/builtins/cost.py` `cost_budget` asks "continue?" at soft thresholds (remembered once approved) and denies at a hard cap. It can also block only expensive models, so the session can carry on with a cheaper one.
  - *Risk that builds up.* `builtins/risk_score.py` adds points for risky tool calls and for results labelled sensitive. Past a threshold, guarded tools such as `gmail_message_send` move from ALLOW to ASK or DENY. The score persists across turns.
- **What Chausar should take.**
  - **Delivery harness:** declare per-step guards as data in the playbook (ALLOW / DENY / ASK), evaluated in a fixed order, with request and tool-call phases failing closed.
  - **Unit economics / model connections:** soft ask thresholds plus a hard cap per delivery, with "drop to the cheap model" as the action rather than stopping. Chausar's calculator must do the cost sums and write the receipt; the policy only reads the result.
  - **Autonomy ladder:** risk accrual is a good trigger for stepping back down a rung. A run that has read client bank statements should need approval for anything outbound, even on a higher rung.
- **Licence verdict.** Apache-2.0. Reuse with attribution.
- **Risks or gaps.** Alpha and very broad (11 sandbox providers, many harnesses). Cost is tracked as float USD, and "unpriced" counts as 0.0, so the budget simply steps aside for models it can't price. Chausar should do the opposite and refuse. A built-in `sys_add_policy` tool lets the agent add policies from chat; I didn't confirm whether it can only add stricter ones, so don't copy that without a check.
- **Label for Chausar today:** planned.

---

## decionis/docker (branch master)

- **What it is.** The open Docker-side client for Decionis, a hosted "execution authority" service: an MCP server, a Docker Desktop extension, a dev-container feature and an authority proxy that ask for PROCEED / HOLD / BLOCK before a risky action.
- **How it works.**
  - *A gate that starts denied.* `internal/authority/gate.go`: `Decide` begins with a denial, and only an explicit `APPROVE` from the control plane replaces it. A timeout, an unreachable service, a refused evaluation or an unknown answer all stay denied, each with a stable code (`evaluation_timeout`, `evaluation_refused`, `not_approved`) and a plain sentence: "A timeout is not an approval."
  - *Pass the verdict through, never invent one.* `internal/api/evaluate.go` sends a structured action descriptor (`decision_type`, `amount`, `risk_score`, `channel`) and decodes only the fields the published contract returns. The comment says no path makes up an APPROVE.
  - *Offline proof checks.* `internal/dossier/dossier.go` verifies a signed "Decision Dossier" with Ed25519 against a public key set, over canonical JSON (`internal/canonicaljson/`). `internal/dossier/reproduce.go` reports `reproduction_ready`, `incomplete` or `signature_only` and says outright that it never claims the verdict reproduced.
- **What Chausar should take.**
  - **Delivery harness / autonomy ladder:** copy the start-denied gate shape for every approval check: default no, one explicit yes, typed reason codes the screens can show in plain words.
  - **Back office / books:** canonical JSON plus a signature over each receipt would let an accountant or a client verify a receipt offline later. The three-way reproducibility label is a good honest word for "we can show the inputs, not that a rerun matches".
- **Licence verdict.** Apache-2.0. Reuse with attribution for the gate and verifier code; the policy engine itself isn't open.
- **Risks or gaps.** The README sells "deterministic, versioned policy", but no policy is evaluated in this repo. The gate's own comment says "no policy is evaluated here"; every verdict comes from `https://api.decionis.com` (`internal/api/client.go`). Presence (passkey approval) is hosted too. So the open part is a well-built client and verifier, and on its own it does nothing. Small project, recent (badges added August 2026).
- **Label for Chausar today:** planned.

---

## Floe-Labs/floe-guard

- **What it is.** A small in-process library (Python and TypeScript) that prices every AI call from a bundled price table and hard-stops an agent before it crosses a spend ceiling. An optional hosted Floe service adds history and a "Coverage Score".
- **How it works.**
  - *Check or reserve before the call, settle after.* `src/floe_guard/guard.py` `BudgetGuard`: `check()` raises `BudgetExceeded` if the next call would cross the limit. `reserve()` / `settle()` and `reserve_tool()` / `settle_tool()` hold budget before a paid tool runs, under a lock (or SQLite across processes), so parallel workers can't both spend the last dollar. `record_tool()` alone only meters afterwards, and the README says so.
  - *Provenance is enforced in code.* `src/floe_guard/receipt.py` `FloeCost.source` must be `"estimate"` (local price table) or `"hosted"`. Anything else raises, with the comment "the estimate/hosted distinction is the honesty contract".
  - *Unpriced means refused, not free.* `src/floe_guard/pricing.py` rejects half-valid or non-finite price entries and unknown provider prefixes ("fail closed"), and `floe-guard estimate` refuses an unpriced model rather than showing $0.00.
  - *Per-leg costs.* `cost_map.json` (dated LiteLLM snapshot plus hand-curated speech, voice and telephony rates) and `leg_units.py` price each leg of a call (speech-to-text, model, voice, phone line) separately.
- **What Chausar should take.**
  - **Unit economics / model connections:** reserve-before, settle-after spend per delivery, so the agent loop's spend limit is binding even with tools that cost money. Every cost figure carries a provenance label (`estimate` from the price table versus `billed` from the provider's invoice), which matches Chausar's receipt rule.
  - **Model connections:** an unpriced model is refused with a plain reason, never counted as free. A dated price snapshot shown on the cost receipt ("prices as of 21 Sep 2026").
- **Licence verdict.** MIT. Reuse with attribution, but rewrite the money parts.
- **Risks or gaps.** Money is held as Python `float`, with a rounding tolerance constant. Chausar's calculator must use BigInt minor units, so take the design, not the arithmetic. The price table is hand-curated and will go stale. Part of the README is an upsell to the hosted service. Pre-call voice gates are explicitly non-binding (two calls can see the same headroom), which the docs admit.
- **Label for Chausar today:** planned.

---

## deer-flow/llm-space

- **What it is.** A desktop workbench (Bun, Electrobun, React, Pi agent core) for building, tracing, replaying and comparing agent runs. Sister project of ByteDance's DeerFlow. Threads are files on the user's machine.
- **How it works.**
  - *A run is a saved file.* `docs/core-concepts.md` and `packages/core/src/thread/history.ts`: a Thread JSON holds model, system prompt, variables, tools, messages and run history. Each run is a snapshot with a stable id, kept inline or in a versioned sidecar index.
  - *Paired comparison with a rubric.* `history.ts` and `run-evaluation-utils.ts`: pick two runs, score them on a rubric of 2 to 6 criteria, each 1 to 5. Code computes the averages and the B minus A difference; the overall verdict stays a separate human call. The rubric is copied into the saved evaluation, so editing the rubric later never rewrites old results.
  - *Mock tools.* A "Custom Function Tool" has a schema but no backend; a person or an outside workflow fills in the result. A built-in `calculator` tool (`packages/runtime/src/tools/built-in/calculator.ts`) uses its own tokenizer and parser, not `eval`.
  - *Traces.* `packages/runtime/src/traces/` sends traces to Langfuse.
- **What Chausar should take.**
  - **Rehearsal / quality judge and the improvement loop:** the paired old-versus-new comparison with an immutable rubric snapshot is the shape Chausar's "keep the change only if it wins" gate needs. The judge (or the owner) gives criterion scores; Chausar's code does the averages and the difference, keeping the AI out of arithmetic.
  - **Delivery harness:** a run record per order with a stable id and the exact config used, so a rejected draft can be replayed against a new playbook version.
  - **Rehearsal:** "tool with a schema, result filled in by hand" is a cheap way to build mock tools for made-up clients.
- **Licence verdict.** MIT. Reuse with attribution.
- **Risks or gaps.** "Evaluate: measure how your agent performs across runs" is manual, side-by-side scoring of two runs at a time. There's no automated eval suite or judge model in the code I read. Anonymous telemetry is on by default (opt out per `TELEMETRY.md`). Releases are macOS only; pull requests are merged only from the DeerFlow core team.
- **Label for Chausar today:** planned.

---

## AMAP-ML/LongHorizon-Harness

- **What it is.** A "loop engineering" wrapper that keeps Claude Code, Codex, OpenCode or DeepSeek Harness working on one goal for hours across desktop apps and the terminal, with a paper (arXiv 2608.01964) and benchmark claims.
- **How it works (from the README and release notes; the source isn't in this repo).**
  - *Three roles in one loop.* A Manager rebuilds each round from the original goal, the verified progress and the failure evidence; an Executor does one bounded step with a fresh context; an Auditor checks the real files, screens, logs and tests instead of trusting the Executor's claim.
  - *Only audited work counts.* A result becomes task state only when it passes audit. A rejected result is kept as evidence, not progress. The next round starts from the last verified checkpoint, and runs keep a "round ledger" that a follow-up continues from.
  - *Bounds and isolation.* Defaults of 25 rounds and per-role timeouts (Manager 300 s, executors 1,800 s, Auditor 300 s); the Manager and Auditors get read-only permissions; each role can use its own model, so a cheap executor can sit under a strong auditor. Task text and API keys are kept out of the config file on purpose.
- **What Chausar should take.**
  - **Delivery harness:** a separate, read-only verify role that inspects the actual output (the reconciled ledger, the generated file) before a draft reaches the owner. That is how Chausar's rule "say work is done only when a tool run proves it" gets enforced.
  - **Rehearsal / quality judge:** "a rejected result is evidence, not progress" plus a round ledger maps onto Chausar's signals: a failed round feeds the next attempt and can become a rehearsal case.
  - **Model connections / unit economics:** per-role model choice (cheap doer, stronger checker) as a playbook setting.
- **Licence verdict.** Idea only. The repo is MIT, but it holds only the README, release notes, assets and an OSWorld evaluation folder. The harness itself ships as the `lh-harness` PyPI package, and `.github/workflows/release.yml` builds from folders (`frontend/web` and others) that aren't in the public repo, so there's no harness code here to reuse.
- **Risks or gaps.** The headline gains (about 50% to about 80% on WeaveBench, plus OSWorld 2.0 and Terminal-Bench 2.1) can't be checked from this repo. Native Windows is blocked by POSIX-only parts (release notes, issue #70); WSL2 only. Agents work in the launch directory by default, so a task acts on the real project unless a workspace is set. Version 0.1.8, moving fast.
- **Label for Chausar today:** planned.

---

## Top 3 to adopt first

1. **cloudflare-os journalled actions** for every outside effect in the back office and connectors: `describe` / `apply` / `reject`, a durable claim before an irreversible send, an honest "outcome unknown, check before retrying" state, account fences, and simulation that admits what it couldn't simulate. It covers approvals, shadow mode and the honest-label rule in one design.
2. **qm's tighten-only posture ladder with an always-on floor, plus omnigent's fail-closed ALLOW / DENY / ASK phases** for the autonomy ladder and per-step playbook guards. Add decionis's start-denied gate with typed reason codes as the coding pattern for each check.
3. **floe-guard's reserve-before-call and settle-after spend, with a required `estimate` or `billed` provenance on every cost**, rebuilt on Chausar's BigInt calculator, for per-delivery spend limits and unit-economics receipts. Unpriced models are refused, never counted as free.
