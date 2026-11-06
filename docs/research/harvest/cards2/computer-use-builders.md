# Computer use, app builders and research engines: second-pass cards (23 October 2026)

Group: computer-use-builders. Twelve products, read from shallow clones (nothing run). Stars are the approximate figures from the TSVs; last-commit dates come from the clones.

Note on method: drive C ran out of space during checkout, so several clones were incomplete on disk. Missing files were read straight from the git objects (`git show HEAD:<path>`), so every file cited below was read in full or in the part quoted.

---

## Intuned/selector-forge (MIT, ~71 stars, last commit 2 Jul 2026)

What it is: a Chrome and Firefox MV3 extension. You pick one element or two items of a list on a live page; a hosted AI proposes CSS or XPath selectors, the extension tests every candidate against the live DOM, and only selectors that resolve to exactly the picked set are shown.

Source: partial. The extension, the verify loop, the deterministic fallbacks and the tests are all there. The part that proposes and ranks selectors runs on Intuned's backend (`lib/agent/agentLoopController.ts` posts the whole session state to `getSelectorCreateUrl()` through `fetchIntunedApi`), and `lib/state/schema.ts` says the system prompt is "server-only IP". The README promises a self-hostable backend later. Reverse engineering the backend would mean watching that POST traffic with an Intuned account; not worth it, because the open half is the useful half.

How it works:
- The background worker runs a turn loop with at most 20 backend steps (`MAX_BACKEND_STEPS`, `lib/agent/agentLoopController.ts`). Each turn POSTs the full state; the reply is `test_selectors`, `done` or `error`.
- On `test_selectors` the content script runs each candidate on the real page and returns the element ids each one matched (`lib/content/dom/elementRegistry.ts`, `queryAll`, `resolvesExactlyTo`). A selector passes only if the found set equals the expected set: no over-match, no under-match.
- The state is one zod schema with one browser request in flight at a time, linked by `requestId` and `toolCallId` (`lib/state/schema.ts`). Candidates carry `source: extension_seed | agent`, `matchCount` and `exact`.
- Deterministic fallback: an XPath generator ported from Chromium DevTools' recorder (`lib/content/dom/xpath.ts`: short-circuits on `id`, adds sibling indices only when needed, handles shadow roots), and `generalizeArrayXpath` (`lib/content/dom/arrayXpath.ts`) turns `ul/li[1]/a` plus `ul/li[3]/a` into `ul/li/a` when the picks differ in exactly one index. If generation fails, that xpath is stored, flagged by the missing run id.
- What the model sees is an "inspection view" (`lib/content/dom/inspectionView.ts`): clone of `<body>`, scripts, styles and meta removed, attributes cut at 200 characters, only the targets' ancestor chains plus 3 siblings each side kept, everything else collapsed to "…", 250,000-character cap. Targets are stamped with `element_id`.
- In list mode the overlay highlights the predicted siblings before you press Done (`lib/content/dom/predictListItems.ts`, `pickerOverlay.ts`), and the overlay shows the phases "generating" then "judging".
- Tests include real-Chromium browser tests that prove each candidate resolves to exactly the expected elements (`tests/browser/*`), plus Playwright e2e against the packed extension.

Take for Chausar:
- Business: a monitored-data service (price lists, tender boards, job boards, public directories) for a client, on sites whose terms allow it. The owner approves the site list after a terms check; agents keep the selectors healthy; the client pays per tracked page per month. Plain scraping of sites that forbid it is out.
- Engine: this is the missing piece in Chausar's own posting path. Today `platform/runtime/venture/build/browser.ts` has one selector per step for X and LinkedIn with `checkedOn: null`. Take three rules: (1) each step (`textbox`, `submit`, `confirm`) becomes an ordered list of candidates (data-testid, role plus accessible name, aria-label, DevTools-style xpath), each with its own `checkedOn`; (2) at run time a candidate counts only if it resolves to exactly one visible element, and if none does the post is `not-sent` with a plain line, never a guess; (3) a dry-run "check the steps" opens the compose page, resolves every candidate without typing or clicking, and writes the new `checkedOn` dates. The inspection-view recipe is the right payload if a model is ever asked to propose a repaired selector, and the browser still has the final word.
- Connector: owner-browser-session posting (write, approval per post) gets "steps last checked working on <date>" from real checks instead of `null`. The selector check itself is read-only.
- UI (`entrypoints/popup/components/`): two mode cards with a radio and one-line description ("Pick a few repeated items, get one selector for all.") and a primary button whose label follows the mode (`NewSelector.tsx`); a busy state that names the other tab: "A selector is already in progress on <host>. Finish it there, or cancel to start a new one." (`SessionInProgress.tsx`); history rows with a type badge, "Matches 3 elements", a locate button that turns green or red for "Not found on this page", a "Latest" pill and "2h ago" times with the full timestamp on hover (`HistoryItem.tsx`). For Chausar this becomes the posting card in Connections: each step, its match count on the last check, and a "Show me" button. Owner-assisted repair: when a step fails, the owner clicks the element once in the Chausar browser window and code computes and verifies the candidates.

Traps: the AI half is a hosted service with closed prompts; the fallback xpath is stored as a normal history entry (only a missing run id marks it), so Chausar must label any unverified fallback as unverified; `yarn build:e2e` adds `<all_urls>` and must never ship; `xpath.ts` is a port of Chromium DevTools code (BSD), so copying it means keeping both notices.

Already in Chausar?: posting modes, the journal and the visible Playwright window exist (`build/posting.ts`, `build/browser.ts`). Candidate chains, the exact-one-match rule, the dry-run check and owner-assisted repair do not.

---

## gholtzap/lintapple (MIT, ~508 stars, last commit 22 Oct 2026)

What it is: a Playwright-based checker that loads a page in real Chromium at each policy viewport and colour scheme and reports 31 rules of UI faults (fonts, sizes, spacing, contrast, overflow, clipping, focus, labels, keyboard) as findings with a measured value, an expected value and a fix.

Source: full. `src/`, 70+ test files, a demo and examples.

How it works:
- `checkUrl` (`src/index.ts`) opens a fresh context per viewport and scheme with reduced motion, `en-US`, UTC and device scale 1, waits for fonts and two animation frames, then runs the audit inside the page together with axe-core (axe's module is loaded without touching the app's globals).
- Policy is one JSON file (`ui-policy.json`): allowed fonts and sizes, type rules per selector, minimum control size, gap and inset, banned copy, viewports, colour schemes, and exceptions that each need a selector, rule list and a reason. `validatePolicy` rejects unknown fields.
- Layout checks that need intent use contract attributes: `data-ui-stack`, `data-ui-actions`, `data-ui-container`, `data-ui-number` (tabular digits), `data-ui-content`, `data-ui-align`, `data-ui-radius` (README table).
- Each finding has `rule, selector, message, actual, expected, fix` plus a status of `passed | failed | unresolved` (`src/types.ts`). Unresolved checks still exit 1. Exit codes: 0 passed, 1 findings, 2 did not finish. Reports group repeats by rule, element, expected value, state and frame (`src/report.ts`).
- `checkInteractions` drives named states (click, hover, fill, press), dialogs (open, close, focus return), tabs and menus by keyboard, and re-checks each state (`src/interactions.ts`).
- Coverage is honest: each report lists the frames it did not check ("A check with no findings does not prove that omitted frames pass").
- `AGENTS.md` is a short guardrail for coding agents: fix the interface, "Do not change the policy, add exceptions, or remove contract attributes just to make a check pass", and "The checker cannot prove visual quality, correct wording, or test coverage. State which routes and states you checked."

Take for Chausar:
- Business: a "website check" add-on any web-design or social agency owner can sell: run the checker on a client's public site at phone and desktop, light and dark, and send a plain-language fix list. Every finding is a measured tool result, so the report carries a receipt (report hash). The owner reads it and approves before it goes to the client; a monthly re-check is the repeat sale.
- Engine: run lintapple against Ink itself. The build audit lists "real-browser walk at 1280 and 390" as a slipped must-keep, and Ink's only automated check is axe in jsdom with colour contrast switched off (`app/ui/tests/a11y.test.tsx:95`). Point it at `npm run dev:ui` (fake engine) at 390 and 1280 in light and dark, with an interaction plan for the run sheet, the business menu and J/K keys. Mark Money tables with `data-ui-number` so figures use tabular digits, and feed Chausar's house-style word list into `bannedCopy`.
- Connector: for the website-build playbook, read the lintapple JSON report back from the client repo's CI run (the brief already requires that CI) and show it as delivery evidence: "UI check: no problems at phone and desktop, light and dark". GitHub read is the connector; label it `planned` until a reader exists.
- UI: the finding shape (what, measured, expected, one-line fix) is the right row for a "checks" list on a website order; group repeats and show where they occurred instead of listing 40 copies.

Traps: it checks only the current document, never child frames, unless called per frame; it cannot judge wording or overall look; fonts in the policy must match the app or every page fails; "unresolved" must never be shown as passed.

Already in Chausar?: partly. `platform/runtime/venture/build/brief-lint.ts:26-36` already makes every website brief install `lintapple@0.1.20`, save a `ui-policy.json` and run it in CI. Not done: running it on Ink, reading the client's report back, and the sellable website check.

---

## PRN-6/workspace68 (MIT, ~4 stars, last commit 22 Oct 2026)

What it is: a browser-only drag-and-drop page builder (React, Zustand, dnd-kit) with an AI panel that turns a reference screenshot plus a prompt into an editable block tree, export as a React plus Tailwind zip, a "design prompt" for coding agents, and optional Supabase publishing.

Source: full (`src/`, Supabase migrations, headless check scripts). No unit tests, only `scripts/.verify*.mjs`.

How it works:
- The model must return `{"root":[...]}` using ten block types (`src/lib/aiWebsite.js`). Code rebuilds each block from its own template (`buildElement`), keeps only allowlisted style keys, drops values containing `url(`, `expression(`, `javascript:`, `@import`, `<` or `>`, keeps image URLs only if http(s), and caps the tree at 120 blocks, depth 8 and 120,000 characters. Anything else is an error, never a partial import.
- The page is a plain tree of `{id, type, name, props, style, animation, action}` (`src/lib/tree.js`); actions are `page`, `url` or `scroll`.
- `buildDesignPrompt` (`src/lib/promptExport.js`) writes a build brief: theme, every screen with every block and style, then a "Screen flow" section listing which button opens which screen.
- Publishing copies the draft into a separate `published_sites.published_document` snapshot with a reserved-slug check (`supabase/migrations/20261019_init_schema.sql`, `src/components/editor/PublishModal.jsx`); editing the draft never changes the live page until republished.

Take for Chausar:
- Business: landing pages for local businesses (clinic, tutor, shop) built by a web-design freelancer. Chausar already writes a build brief and hands it to Lovable or Replit; workspace68 adds nothing to that path except the ideas below.
- Engine: "the model proposes a typed tree, code rebuilds it" is the right shape if Ink ever shows an in-app page preview before handoff. The allowlist, value filter and caps are concrete and small.
- Playbook: add a "screen flow" section to Chausar's brief (which button opens which page), generated from the blueprint by code.
- UI (`src/components/editor/AiBuilder.jsx`): the empty state says what happens next ("Generated elements remain editable in the canvas."), a reassurance line next to the button ("Your current page is undoable after generation."), and the button label changes from "Generate website" to "Send & update page" after the first run.

Traps: the API key is typed into the page and sent straight from the browser to the provider; "production-ready" export is a claim with only a headless smoke script behind it; 4 stars and one author.

Already in Chausar?: brief, handoff and staged site edits exist (`build/brief.ts`, `build/handoff.ts`, `build/site-edits.ts`); share links already keep an exact copy of what the client sees. Screen flow and in-app preview do not.

---

## QuantumByteOSS/quantumbyte (Apache-2.0, ~305 stars, last commit 15 Jul 2026)

What it is: a chat workspace where an agent (Claude Agent SDK) builds a small business app in a per-project repo, plus a "requirements harness" that after every turn checks the app against plain-language business requirements and shows a ship decision.

Source: partial. What runs today is `apps/web` (Next.js), `apps/worker` (agent plus harness) and `apps/orchestrator`. The `packages/appspec`, `generator` and `slide-harness` that `ARCHITECTURE.md` and `docs/architecture/app-generator.md` describe do not exist yet ("target end-state"); deploy and billing are a hosted platform outside the repo.

How it works:
- `apps/worker/harness.py` runs after each turn's commit, code-triggered, never model-decided. It derives requirements from `_doc/product-overview.md` only when that file changed or the table is empty. Each requirement has `excerpt`, `description` in "explain-like-I'm-five" words, `type: explicit | hidden` (hidden = implied by the category) and `severity`.
- Each requirement is audited in its own one-shot run limited to `Read, Glob, Grep`, with a system prompt that does not inherit the builder's conversation, returning `SUCCESS | FAIL` plus evidence in plain words with no file names ("A customer can still place an order at an outlet that is closed."). Concurrency 4.
- A run with no structured output is recorded as INCONCLUSIVE, never as FAIL. With no app code at all, every requirement fails by rule.
- Re-checks are diff-scoped: the files each audit read are recorded (`watchedPaths`); a verdict is reused unless those files changed since `lastVerifiedSha` (`_needs_verify`).
- Requirements the user edited are "locked" and never reworded or deleted by re-derivation (`_reconcile_requirements`; skill `business-requirements/SKILL.md` writes a lock marker file).
- `harness_scheduler.py`: a new chat turn cancels the running audit (finished verdicts stay), a manual run that gets cancelled asks for itself again, and the last turn's audit is never cancelled.
- The ship gate is computed in the UI from verdicts (`apps/web/src/components/blueprint/harness-slide.tsx`): any critical FAIL is "Do not ship / A critical requirement is failing."; any other FAIL or an unverified critical is "Ship with warnings"; all criticals passing is "Safe to ship". Verdict filters: all, fail, inconclusive, unverified, pass, each with a count. A running row never shows a spinner next to "Pass".
- Turns are claimed from a Postgres table with `FOR UPDATE SKIP LOCKED` and a renewed lease (`apps/worker/main.py`), so a crashed worker's turn is picked up again.

Take for Chausar:
- Business: small operational apps for local businesses (appointments, orders, stock) sold by an "app studio" owner, with the requirement list as part of the deliverable: the client sees in plain words what the app does and that each item was checked.
- Engine: for the website-build playbook, after the builder hands back a repo, run Chausar's read-only auditor once per requirement from the brief, in plain words, with `inconclusive` kept apart from `fail`, owner-locked requirements, re-checks only when the files an audit read have changed, and a code-computed ship line. The same split (derived explicit plus hidden requirements, one audit each) fits any delivery run: for a CA firm, a hidden requirement is "no tax figure without a calculator receipt".
- Playbook: the "honest exit" (`main_agent/skills/disqualification/SKILL.md`): when a client's ask is outside the playbook, say it plainly early, offer the part that is in scope, point elsewhere if nothing is, and do not chase.
- UI: the ship gate header (one label, one reason), verdict filter chips with counts, and a requirement editor with a short line, a full description, explicit or hidden, and severity.

Traps: the main agent prompt sells: a `trigger_paywall` tool, a "convince ladder", "which vacation do we sell", and bear avatars (`main_agent/tools/trigger_paywall/description.md`, `skills/qualification/SKILL.md`, `components/blueprint/chat/bear-avatar.tsx`). None of that belongs in Chausar. The audits run with `bypassPermissions` (safe here only because tools are read-only). The architecture docs describe packages that are not built.

Already in Chausar?: partly. Yes/no rules with cited evidence, the read-only auditor and "Not checked" exist (spec 7.5, 7.7; `delivery/judge/rules.ts`). Not there: requirements derived from the brief with explicit/hidden and severity, owner locks, diff-scoped re-checks, and the three-state ship line.

---

## Jeidoban/Ironsmith (GPL-3.0, ~331 stars, last commit 12 Sep 2026)

What it is: a macOS menu-bar app that writes, compiles and repairs a small native SwiftUI app from a prompt, using local (Ollama) or hosted models or the bundled Codex CLI, then signs and sandboxes it; a Store lets people publish and remix generated apps.

Source: partial. The Mac app and its tests are complete; `ironsmith-backend/` (accounts, credits, the Store service) is a separate repository and not included (`AGENTS.md`). Licence is GPL-3.0: copying code into Chausar's closed desktop app would put Chausar under the GPL, so this is learn-only.

How it works:
- The model edits exactly one file, `Sources/<Name>/ContentView.swift`; Ironsmith owns `Package.swift` and the entry file and restores them after Codex runs (`AGENTS.md`, `Core/AgentPipeline/Artifacts/ToolPackageMaterializer.swift`).
- Repair order: clean the model output, compile, apply deterministic Swift fixes (up to 4 passes), then model repairs, then fresh regeneration. All limits live in one place (`Core/AgentPipeline/RepairPolicy/ToolGenerationRepairPolicy.swift`): regenerate once errors are at or below a threshold scaled by file length (one per 20 lines, 12 to 48), at most 10 generations, model repairs 6 to 20 turns, and a "paid-call safety limit" of 6 repair attempts for large hosted models.
- An edit keeps the original source and settings until the edited package builds (`Runtime/ToolVersionBackupClient.swift`).
- Generated apps are sandboxed with hardened runtime; camera, microphone and similar need an explicit toggle (`AppBundle/GeneratedAppResourcePermission.swift`).
- Store publishing (`Features/ToolLibrary/Popover/ToolLibraryStorePublisher.swift`, `Features/Store/StoreLicense.swift`): only MIT or Apache-2.0, each with a one-sentence summary; a remix must change the app name; creator handle and display name are validated.

Take for Chausar:
- Business: small desktop utilities for clients ("split a PDF per page", "find duplicate rows in a CSV"). Mac-only, so low for owners in India.
- Engine (idea only): Chausar's creator card lists "one bounded auto-repair" as not built. Ironsmith's shape is the template: deterministic fixes first, model repairs capped, a separate cap for paid calls, and the original kept until the new version passes. Pair the paid cap with Chausar's reserve-then-settle spend.
- Engine (idea only): "the agent may edit only the content file; code owns the scaffold" is a clean rule for any generated artefact Chausar ships (site, script, template).
- UI: permissions shown as explicit toggles, off by default; a licence picker that explains each licence in one sentence.

Traps: GPL-3.0; account, credits and Store are a hosted backend not in the repo; macOS 26 only.

Already in Chausar?: staged edits with verify and roll back exist (`build/site-edits.ts`); bounded auto-repair and a paid-call cap do not.

---

## Mzhvnn-tch/ultron (MIT, ~0 stars, last commit 29 Jun 2026)

What it is: an Express server that answers research questions by searching (Tavily), sniffing network calls with headless Playwright, scraping in "stealth" mode, parsing JS bundles for internal API endpoints, then scoring findings with confidence numbers; it can sell answers to other agents on a crypto marketplace (CROO on Base).

Source: full, but the README claims far more than the code does.

How it works:
- Five layers in `src/layers/`: API discovery (OpenAPI, GraphQL introspection), CDP network sniffing, a stealth scrape fallback, citation grounding, and a JS bundle parser.
- `layer3-grounding.ts` drops any finding with no evidence and finds contradiction candidates by word overlap and negation before asking a model.
- `src/pipeline/verifier.ts` caps single-domain claims at 0.65 confidence and warns on sources a finding uses but the citation list lacks.
- The "self-evolving codebase engine" (`src/agent/evolution.ts:68-87`) is a hard-coded string that rewrites `/v1/` to `/v2/` and returns `{success: true, status: "self-healed"}` without fetching anything; it then "hot-swaps" that function.

Take for Chausar:
- Business: a research-brief service (market sizing, competitor list) is possible, but only with Chausar's own evidence rules, not this engine.
- Engine (ideas only): a finding with no source is dropped; a claim backed by one domain is marked "single source"; search results are only pointers, and the agent must open the primary page before citing it; quantitative facts carry the time they were read. Chausar's evidence ledger already has the labels; these are the rules to apply in a research step.

Traps: bot-detection evasion (`STEALTH_MODE`, Layer 2); pulling internal APIs out of JS bundles (terms risk); the fake self-healing above; `factCheck` returns `isAccurate: true` when the model call fails (`verifier.ts:96-98, 134`), which is fail-open; the "numerical variance" check compares every number found anywhere in the evidence (`verifier.ts:185-210`); invented-precision confidence penalties presented as if measured; `node:vm` used as if it were a security sandbox; crypto settlement. The README's "eliminates hallucinations" is not backed by the code.

Already in Chausar?: evidence ledger with observed, inferred and needs-your-data (spec 7.6). Nothing here to copy as code.

---

## dzhng/jevgrep (MIT, ~2,833 stars, last commit 21 Oct 2026)

What it is: a CLI (`jg`) that answers "where is the code that does X?" by walking a repository, asking a hosted relevance model ("Jev", through Vercel AI Gateway or similar) about folders, files and declarations, and printing verbatim source excerpts for a coding agent. The repo also ships the author's agent skills (`.agents/skills/`).

Source: full for the CLI and skills; the Jev model is a hosted model, swappable by provider (`packages/core/src/providers.ts`).

How it works:
- Hierarchical search with a byte budget; reaching it reports incomplete discovery instead of pretending ("Completion means the planned search finished, not that every relevant byte was found", `docs/architecture.md`). Repository source is never executed.
- Before any upload, `packages/core/src/secrets.ts` excludes whole files that look like they hold credentials: known key prefixes (`sk-ant-`, `ghp_`, `AKIA`, `xoxb-`, `whsec_` and more) followed by 16+ key characters, or a credential-named assignment whose value is 16+ characters with Shannon entropy of at least 3.5, with placeholders and UUIDs exempt and an unclosed quote treated as suspicious. `jg files` counts what a search would read without any network call.
- `.agents/skills/screenshot-critique/scripts/receipts.mjs` checks a written critique: every number presented as a measurement (px, contrast, ratio, mean, count, hex colours) must appear in the output of a command shown in the report, and every file the report names must exist and match any sha256 it states. Unbacked numbers make it exit 1. The skill is explicit that this is attribution, not proof of execution, and that the file check is the part that touches the world.
- The same skill requires an unprimed reviewer: give it every screenshot at every viewport and state, never say what defect you expect, and when no reviewer exists "write one sentence making the strongest case that it is broken" before deciding.
- Evaluation notes are careful: single-run results "do not establish statistical equivalence", costs include failed attempts (`evals/cost-quality-policy.md`, README).

Take for Chausar:
- Business: code due-diligence for small buyers of software. Low for Chausar's owners.
- Engine: a receipts check over every agent draft and run summary. Numbers that cannot be traced to a tool result in the run are labelled "model estimate" automatically (spec 7.6 already allows them only with that label), and any file or link the draft names must exist in the run's evidence with a matching digest. This is cheap, deterministic and catches the commonest failure.
- Engine: a secret screen on everything Chausar sends to a model or writes into a trace or share link, using the prefix plus entropy rules above, and a "what will be sent" preview before a run reads a folder. The build audit lists "trace scan for secrets" as not built; nothing in `platform/runtime` screens model-bound content today.
- Quality: the unprimed visual review is the method for Ink's light and dark walk and for YouTube thumbnail checks.

Traps: costs and "same intelligence" claims rest on one ten-task run (the author says so); the relevance model is hosted.

Already in Chausar?: the number label exists as a rule; the deterministic receipts check and the secret screen do not.

---

## paulklayvc/skills, "High-Leverage Job Hunt" and four others (MIT, ~49 stars, last commit 14 Oct 2026)

What it is: five agent skills written by a VC, all prompts plus one Python script: high-leverage job hunt, decision-maker outreach, bootstrap growth, investor warm intros, and VC terms review (`vc-terms-review/scripts/deal_math.py` computes waterfalls, SAFE conversion and anti-dilution in code).

Source: full (skills are the product).

How it works:
- `high-leverage-job-hunt/SKILL.md`: five moves (edge, targets, access, an advice-first conversation, a zero-risk offer), each with a fixed one-page deliverable.
- Interviews run in rounds: every question that can be asked now, numbered, each with the agent's best guess, so the user replies "1 yes, 2 no, 3 skip". "Facts are your job; decisions are theirs": never ask the user for anything the agent can look up.
- "Never write a message, claim, or metric the user hasn't confirmed is true"; the positioning brief includes "What to stop claiming".
- Targets are scored 0 to 2 on seven criteria: visible gap, proof the approach works elsewhere, fit with track record, revenue impact, founder access, decision speed, whether anyone owns the problem (README, `references/targeting.md`).
- `references/pilot-offer.md`: one testable hypothesis, a 2 to 6 week window, success as "a number and a date, agreed in advance", the exact hours of whose time it needs, a pricing model (small fixed fee, fee plus success bonus, pure performance only when attribution is clean, deferred to equity), never free, permission to reference the result, access to the measurement, and after the pilot a case study and a referral ask.

Take for Chausar:
- Business: (1) a "pilot offer" step in every playbook's sales stage: the CA firm offers one month of books with a stated success measure, the social agency a 4-week content test with an agreed metric; the owner approves the one-page proposal before it is sent, and the price comes from Chausar's price receipts. (2) A career-coaching playbook (positioning brief, scored target list, outreach drafts, call plan, pilot proposal), where the coach approves each artefact and the client sends; a real paid service in India.
- Engine: lead scoring, which the build audit lists as not built: seven 0 to 2 scores, each with an evidence URL or "guess", summed by code, never by the model.
- UI: agent questions on Today asked in rounds with a best guess per question, answered with one short reply; and a rule for every agent: it never asks the owner for a fact it could look up.

Traps: "425k+ views" marketing; outreach skills invite volume if misused (the skill itself warns against mass outreach); the terms-review skill is not legal advice.

Already in Chausar?: leads, blocklist and owner-sends drafts exist (`venture.leads.*`); the pilot offer, scored leads and rounds-with-guesses do not.

---

## Tongyi-MAI/OpenGCUA (Apache-2.0, ~385 stars, last commit 23 Oct 2026)

What it is: a research preview of a "generalist computer-use agent": a macOS menu-bar harness and a Rust plus Python SDK that let a model act through accessibility trees, app APIs, shell, code cells and the GUI, including in background windows while the user keeps working; plus evaluation trajectories for eight models.

Source: partial. Harness, SDK, adapters and tests are there; the model weights are "planned" and the macOS action layer is marked incomplete (`ROADMAP.md`). Mac control runs through a third-party Cua Driver app pinned by URL, sha256 and signing team (`packages/sdk/adapters/macos/cua-driver.lock.json`).

How it works:
- Action journal (`packages/harness/runtime/action_journal.py`): append-only JSONL, file mode 0600, opened with `O_NOFOLLOW`; each record has `record_sequence`, `previous_digest` and `record_digest` (sha256 of canonical JSON), so any edit or gap marks the whole journal `CORRUPT` and stops. Stages: `intent_recorded → dispatching → receipt_received | outcome_unknown | rejected | cancelled_before_dispatch`, with allowed transitions checked. Keys that look secret (token, cookie, password, storage state) are redacted. Recovery never replays automatically.
- Unverified-operations index (`runtime/context_risk.py`): after the conversation is summarised, the model gets a bounded, read-only list (64 entries, 3,000 characters) of actions whose outcome is unknown or unverified, built only from durable journal records and never from model text, saying "verify by the original id against the current screen; never blindly replay".
- Foreground consent (`runtime/gui_approval.py`): taking over the mouse and keyboard needs a task-scoped yes for a named app and window, with a reason; the prompt says the user should not use the desktop meanwhile and that nothing runs until they answer; a refusal holds unless the agent explicitly retries.
- Stale targets (`packages/sdk/adapters/browser-playwright/src/identity.ts`): an element id is bound to its document; if the page navigated or the node detached, the action fails with `STALE_TARGET` rather than clicking a look-alike.
- Overlay guard (`runtime/overlay_guard.py`) computes where a foreground click will land so the native UI can show it.
- Honest roadmap: each component is "released", "preview" or "planned", and every number ships with its harness configuration and trajectories.

Take for Chausar:
- Business: back-office form filling for clients (the visa-form demo), with the owner approving each submission. Mac-only today and government portals stay `handoff` in Chausar, so low for now.
- Engine: add the hash chain (sequence, previous digest, record digest) and the corrupt-stop rule to Chausar's journal; it is the base the "signed receipts with an offline verifier" item needs. Add secret-key redaction on journal payloads.
- Engine: an "unconfirmed actions" block that survives history compaction. Chausar's `compactHistory` (`delivery/harness/loop.ts:138-143`) shortens old tool results and tells the model "call the tool again if you need it"; for anything with an outside effect, the model should instead see the journal's unknown and unverified entries and be told to check, not repeat.
- Connector: posting must re-resolve its target right before the click and refuse if the page changed (stale target), and any download of a browser runtime, if Chausar ever offers one, should be explicit, pinned and digest-checked like the Cua Driver lock.
- UI: a task-scoped consent line before Chausar's visible posting window opens: which site, why, "Please don't type in this window until the post is done", and nothing happens until the owner says yes.

Traps: research preview; Mac-only harness; depends on a third-party signed binary; the benchmark gains are the authors' own runs.

Already in Chausar?: the journal stages, outcome unknown and "never resent automatically" exist (`journal/journal.ts`); the hash chain, redaction, the compaction block, consent wording and stale-target refusal do not. The earlier card on QwenLM/open-computer-use covers accessibility-tree-first clicking (`cards/quality-data-ops.md:44`).

---

## AutoCua/AutoCua (MIT, ~191 stars, last commit 22 Oct 2026)

What it is: a Python package plus a Rust browser agent and a Chrome extension that drive the desktop (macOS, Windows, Linux), the user's own Chrome, a terminal, or an iPhone or simulator, from one `run_agent(mode, provider, model, task)` call.

Source: full (`AutoCua/`, per-platform folders kept separate on purpose, `AutoCua/Structure.md`).

How it works:
- Script guardrails for the browser agent (`AutoCua/web/controller/run_script/guardrails_check.rs`): a script injected into a page runs only in the agent's own tab and only on http(s) pages; it is refused before running, with the construct quoted, if it reads cookies, stored credentials, the clipboard, or a password or payment field, sends data to another site, writes to disk or clipboard, or hides what it does (`eval`, built-up property names). Results and errors are screened in Rust for session cookies, tokens and keys, cards, bank accounts, one-time codes and national ids: withheld if the result is the secret, redacted otherwise. Every check fails closed, the detector never runs inside the page, and the audit line carries hashes, sizes and counts, never data. Scripts are capped at 16 KB, errors at 300 characters.
- The web prompt (`web/agent/main_driver/system_prompt.md`) makes every step a prediction: before acting, state what the next page will show; a guard that fails means the agent's picture is wrong and it must recover first; record a milestone only after the end state is visible on the page (a confirmation number, a sent mail), not because a tool returned OK.
- UI maps as data (`default_skills/ios/instagram.md`): "This is a MAP, not a script ... When this map and the screen disagree, THE SCREEN WINS."
- The agent never brings its browser to the front; if a page pops a tab that steals focus on macOS, focus is handed straight back (`web/browser/page_tab_guard.rs`). Parallel runs each get their own tab. A pointer-events-none edge glow and cursor mark the browser being driven (`web/browser/glow/glow.js`).

Take for Chausar:
- Business: a virtual-assistant service is possible in principle, but AutoCua's defaults are unsafe for it (see traps).
- Engine: the script and result guard is directly reusable as rules for Chausar's posting window and any later browser agent: refuse page scripts that read secrets or send data elsewhere, screen anything read back for tokens, cards, bank accounts and OTPs (add Aadhaar and PAN patterns for India), fail closed, log hashes and counts only.
- Connector: posting confirmation must be something the platform shows on the page (Chausar's `confirm` selector already is); store the post's URL when visible.
- UI: Chausar's posting window should never take focus from the owner's work; show "Chausar is posting in the browser window" in Ink rather than injecting an overlay into the platform's page, because Chausar's rule is to change nothing in how the site sees the browser.

Traps: the web prompt tells the agent to solve CAPTCHAs ("A captcha or robot check: try `click` on its checkbox and tiles ... use `run_script` to select them"), which is bot-detection bypass; it places orders on its own (its own example milestone is "Order placed on amazon.com"); Instagram app automation for likes, comments, DMs and posting breaks Meta's terms (the creator card already says so); remote control of the desktop over Telegram (`mac/remote_connection/telegram/`).

Already in Chausar?: posting is approval-gated and journalled; the script guard and secret screen on read-backs are not built.

---

## UsmanAbid751/AgentFOXXY (MIT text in NOTICE.md, no LICENSE file, ~4 stars, last commit 9 Oct 2026)

What it is: a renamed copy of Nous Research's Hermes Agent. `NOTICE.md` says it "is built on the Hermes Agent open-source project by Nous Research"; the CLI package `hermes_cli` became `agentfoxxy_cli`, with the same gateway, TUI, toolsets, cron and approval modules.

Source: full (10,562 files), but nothing original beyond branding was found. The root has no `LICENSE` file although `pyproject.toml` declares `license-files = ["LICENSE"]`; the MIT text sits inside `NOTICE.md`.

How it works: as upstream Hermes Agent.

Take for Chausar: nothing. Use upstream Hermes if needed.

Traps: the README's comparison table misstates competitors (for example that Claude Code has no browser automation); "TeamFOXXY" and "40+ powers" are upstream features renamed.

Already in Chausar?: yes in effect. The founder's fleet already runs 45 bots on native Hermes (memory note "Hermes fleet").

---

## TencentARC/Player-1 (MIT licence file, ~187 stars, last commit 21 Oct 2026)

What it is: a README, two images and a licence for a paper on training computer-use models to play games (6,044 gameplay trajectories from 172 games, 16 synthetic training environments, evaluation on MineDojo, ViZDoom and GameWorld).

Source: NEEDS-REA, though there is nothing to reverse engineer yet. Data, gym, model weights (9B and 35B-A3B) and code are all "Coming Soon" in the README's release plan. The only artefacts are the paper PDF and the project page. Revisit when the gym and code ship.

Take for Chausar: nothing now. A game-testing QA service would need the released gym and weights.

Traps: stars reflect the paper, not code.

Already in Chausar?: no.

---

## Ideas worth taking, ranked by value for B2C owners

| Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|
| Posting steps as ordered selector candidates, each counted only if it matches exactly one visible element; otherwise `not-sent` with a plain line | Selector Forge (`elementRegistry.ts`), OpenGCUA (`identity.ts`) | connector | high | M |
| Dry-run "check the steps" that resolves every posting selector without typing or clicking and writes real `checkedOn` dates; Connections shows "last checked working" | Selector Forge (verify loop) | connector + UI | high | S |
| Pilot offer in every playbook's sales stage: one hypothesis, 2-6 weeks, success number and date agreed first, exact hours, pricing model (never free), permission to reference, then case study and referral | paulklayvc (`pilot-offer.md`) | playbook | high | S |
| Receipts check on every agent draft and summary: numbers without a tool-result receipt become "model estimate"; named files must exist with a matching digest | jevgrep (`receipts.mjs`) | engine | high | S |
| Secret screen on everything sent to a model or written to traces and share links (key prefixes, entropy ≥ 3.5 over 16+ chars, placeholders exempt), plus a "what will be sent" preview | jevgrep (`secrets.ts`, `jg files`) | engine | high | S |
| Script and read-back guard for the posting window and any browser agent: refuse secret-reading or data-sending scripts, screen results for tokens, cards, bank accounts, OTPs, Aadhaar and PAN; fail closed; log hashes and counts | AutoCua (`guardrails_check.rs`) | engine | high | M |
| Agent questions in rounds, each with the agent's best guess, answered in one short reply; agents never ask the owner for facts they can look up | paulklayvc (`high-leverage-job-hunt/SKILL.md`) | UI | high | S |
| Run lintapple on Ink at 390 and 1280, light and dark, with an interaction plan for sheets and menus; `data-ui-number` on money; house-style words as `bannedCopy` | lintapple (`src/index.ts`, `AGENTS.md`) | UI | high | S |
| Requirements check for the website-build playbook: plain-language explicit and hidden requirements with severity, owner locks, one read-only audit each, inconclusive kept apart, diff-scoped re-checks, ship line computed in code | QuantumByte (`harness.py`, `harness-slide.tsx`) | engine + UI | high | M |
| Sellable "website check" add-on: lintapple on a client's public site, plain fix list with the report hash as receipt, owner approves before sending, monthly re-check | lintapple | playbook | high | S |
| Owner-assisted selector repair: owner clicks the element once in the Chausar browser window; code builds and verifies candidates (DevTools-style xpath, test ids, roles) | Selector Forge (`pickerOverlay.ts`, `xpath.ts`) | connector + UI | med | M |
| "Unconfirmed actions" block that survives history compaction, built only from journal records, telling the model to check, not repeat | OpenGCUA (`context_risk.py`) vs Chausar `loop.ts:138-143` | engine | med | S |
| Lead scoring: seven 0-2 scores, each with an evidence URL or "guess", summed by code | paulklayvc (targeting scorecard) | engine + UI | med | S |
| Read back the client site's lintapple CI report as delivery evidence ("UI check passed at phone and desktop") | lintapple + Chausar `brief-lint.ts` | connector (planned) | med | M |
| Hash-chained journal records with a corrupt-stop rule and secret-key redaction, the base for signed receipts | OpenGCUA (`action_journal.py`) | engine | med | S |
| Task-scoped consent before the visible posting window opens ("don't type in this window"), nothing runs without a yes; the window never steals focus | OpenGCUA (`gui_approval.py`), AutoCua (`page_tab_guard.rs`) | UI | med | S |
| Honest exit at intake: say plainly when a client's ask is outside the playbook, offer the in-scope part, do not chase | QuantumByte (`disqualification/SKILL.md`) | playbook | med | S |
| Career-coaching playbook (positioning brief, scored targets, outreach drafts, call plan, pilot proposal; coach approves, client sends) | paulklayvc | playbook | med | M |
| Bounded auto-repair: deterministic fixes first, capped model repairs, a separate paid-call cap tied to spend reservation, original kept until the new version passes (idea only, GPL) | Ironsmith (`ToolGenerationRepairPolicy.swift`) | engine | med | M |
| Research-step evidence rules: no source, no finding; single-domain claims flagged; search results only point to the primary page; quantitative facts carry their read time (ideas only) | Ultron (`layer3-grounding.ts`, `verifier.ts`) | engine | med | S |
| Unprimed visual review for Ink and thumbnails: full capture set, reviewer not told the expected defect, strongest case for "broken" written first | jevgrep (`screenshot-critique/SKILL.md`) | UI quality | med | S |
| Inspection-view payload for any model-assisted selector repair (scripts stripped, attributes cut, ancestors plus 3 siblings, size cap) | Selector Forge (`inspectionView.ts`) | engine | low | S |
| In-app page preview from a typed block tree the model proposes and code rebuilds (allowlisted styles, value filter, caps), "undoable after generation" | workspace68 (`aiWebsite.js`, `AiBuilder.jsx`) | UI + engine | low | M |
| "Screen flow" section in the build brief: which button opens which page, written by code | workspace68 (`promptExport.js`) | playbook | low | S |
| Explicit, pinned, digest- and signature-checked install if Chausar ever offers to set up a browser runtime | OpenGCUA (`cua-driver.lock.json`, `setup.rs`) | connector | low | S |
| Publishing derivatives: remix must change the name; licence choice limited and explained in one sentence | Ironsmith (`StoreLicense.swift`, `ToolLibraryStorePublisher.swift`) | UI | low | S |
