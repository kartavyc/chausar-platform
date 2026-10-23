# Plan: Chausar Ink v2 (five waves)

## Goal

Build the approved spec `docs/superpowers/designs/2026-10-23-chausar-ink-v2.md`: close the audit, rework the frontend into Ink v2, add the new features and build every buildable business from the 130-product harvest, in five waves, one PR each.

## Architecture

See the spec, sections 4 and 5. The row-by-row "what" is `docs/research/harvest/cards2/CATALOGUE.md` (each row has an id such as H1, a wave and its sources); "why" for W1 and W2 is `docs/research/harvest/build-audit-2026-10-23.md`.

## Tech stack

TypeScript on Node 24 (engine, `node --test`, run as .ts directly), React 19 + Vite 8 + CSS Modules + vitest + testing-library (app/ui), Electron (app/desktop). New UI dependency in W3: `lucide-react` (MIT). No other new runtime dependencies without a line in the wave's PR saying why.

## How every wave runs

1. Branch: `b2c/ink-v2-w<N>` from the previous wave's branch (stacked; W1 from main 11a73e83). The PR targets main once the previous wave is merged, else the previous wave's branch.
2. Work packages run in parallel as subagents in this one checkout (no worktrees). Each package owns its files. Shared files (`platform/runtime/venture/contracts.ts`, `platform/runtime/engine.ts`, `app/desktop/ipc-contract.cjs`, `app/ui/src/engine/types.ts`, `app/ui/src/engine/fake*.ts`, `app/ui/src/text/*/*.json`) are changed with small Edit calls only, never rewritten whole; re-read before each edit. Agents never commit, stash, switch branches or run the full suite.
3. Test first. For every row: write the failing test, run it and see it fail for the right reason, implement, run it and see it pass. Engine tests: `node --test platform/tests/<file>.test.ts` (expect `# fail 0`). UI tests: `npx vitest run --config app/ui/vitest.config.ts <path>` (expect all passed). New engine test files are named `platform/tests/venture-<area>.test.ts` and must not need a built UI.
4. The integrator (the main session) then runs `npm run typecheck`, `npm run typecheck:ui`, `npm run test:ui`, `node scripts/bench.mjs` (all six shards, in the background) and fixes what breaks; then commits in logical, conventional commits (`fix(w1): ...`, `feat(w3): ...`), pushes, opens the PR and watches CI.
5. Every new user-facing string goes into `app/ui/src/text/en/*.json` and `hi/*.json` (machine-drafted Hindi) in the same change.
6. No em dashes in code, comments, copy or docs.

## Wave 1: safety and bug fixes (catalogue rows H1 to H21, Q3, M1, C1, U15, U16)

Paths below are relative to `platform/runtime/venture/` unless they start with `app/` or `platform/`.

### Package 1A: CA gates and current-year rates (H1, H2, H7)

**Files:** `delivery/runs.ts`, `build/share-links.ts`, `playbooks/ca-firm/claims.ts`, `playbooks/ca-firm/rates.ts`, `playbooks/ca-firm/playbook.ts`, `playbooks/draft-checks.ts`; tests `platform/tests/venture-ca-gates.test.ts` (new), `platform/tests/venture-playbook-ca-rates.test.ts`.

1. Failing tests:
   - Accepting a CA-firm regulated draft (GST working, TDS working, ITR prep) with no recorded CA sign-off throws `CA_SIGNOFF_REQUIRED`; after `venture.ca.signoff.record` for that draft's digest it accepts. Books-only offers are unaffected.
   - Creating a share link for that draft before sign-off throws `CA_SIGNOFF_REQUIRED`.
   - A GST or TDS working draft whose tax figure is not on a calculator receipt fails its checks with check id `tax-figure-receipted` and cannot be accepted; a refusal from the calculator (`NOT_MODELLED`, `RATE_TABLE_MISSING`) surfaces as "do not retry".
   - Rate tables: a TDS table for FY 2026-27 and an income-tax table for AY 2027-28 exist as new versions with `validFrom`/`validTo`, a citation and `confirmedBy: null`; the version is chosen by the transaction date (`asOf`), never the clock; a date past every table's window refuses with `RATE_TABLE_STALE`; an unconfirmed table works only in rehearsal (`RATE_UNCONFIRMED` otherwise), as today.
2. Implement. For the new tables, take values from official sources (incometaxindia.gov.in, the Finance Act 2026, the Income-tax Act 2025 and CBDT notifications), cite each URL in the table's `citations`; any value you cannot verify from an official source is carried forward from the previous year and its citation says "carried forward from FY 2025-26, not verified, needs CA confirmation". Section numbers follow the existing renumbering rule (ca-firm/rates.ts:16, claims.ts:86).
3. Run the tests; done when they pass and `node --test platform/tests/venture-playbook-ca-*.test.ts platform/tests/venture-ca-*.test.ts` is clean.

### Package 1B: journal resolve and safe retries (H3, H15, H21)

**Files:** `journal/journal.ts`, `journal/methods.ts` (or where journal methods register), `build/posting.ts` (resolveUnknownPost exposure only), `models/transport.ts`, `contracts.ts` (method names, types), `app/ui/src/places/money/Journal.tsx`, `app/ui/src/text/{en,hi}/money.json`; tests `platform/tests/venture-journal-resolve.test.ts` (new), `platform/tests/venture-model-retry.test.ts` (new), `app/ui/tests/places/money-ledgers.test.tsx`.

1. Failing tests:
   - `venture.journal.resolve {entryId, outcome: 'sent'|'not-sent', note}` settles an `outcome_unknown` entry (owner only, app channel, journalled); after `not-sent` the same subject may be proposed again; after `sent` it is recorded as applied; resolving an entry in any other state throws `JOURNAL_NOT_UNKNOWN`. A post's unknown outcome resolves through the same method.
   - Retries: a model or tool call retries only on 429 (honouring Retry-After, clamped to 30 s) and on transport errors for reads; any create or send that fails ambiguously becomes `outcome_unknown` and is never retried; one deadline per call that retries never reset; unknown status codes fail closed.
   - Every proposed outside action has `descriptionComplete` (default false unless the proposer sets it true); Ink shows "This description is incomplete: part of what this will send isn't shown." on the approve surface when false.
   - Ink: an `outcome_unknown` row in Money > Journal shows Resolve with "It went out" and "It did not go out"; choosing one calls the method and updates the row.
2. Implement, run, pass.

### Package 1C: spend before the call, recheck before apply (H4, H13, H14, M1)

**Files:** `delivery/harness/loop.ts`, `delivery/harness/tools.ts`, `money/spend.ts`, `views/queue.ts`, `contracts.ts`, `app/ui/src/places/money/SpendPolicy.tsx`, `app/ui/src/text/{en,hi}/money.json`; tests `platform/tests/venture-spend-reserve.test.ts` (new), `platform/tests/venture-harness-recheck.test.ts` (new), `app/ui/tests/places/money-ledgers.test.tsx`.

1. Failing tests:
   - The per-run cap is reserved before each model or tool call: the call that would cross it is refused before it runs (`RUN_CAP_REACHED`), and Today gets a row "Editor reached its spend cap for this run. Allow one more window of ₹X?" whose approval raises the cap for that run once.
   - Just before an approved action applies, the gate runs again (budget left, client still active, digest unchanged, caps re-read); a deny cancels with its reason in the journal.
   - While approvals wait, the agent's next turn includes "These calls are awaiting approval and have not executed." for each waiting call.
   - Spend settings take the monthly limit in rupees (or the key's currency) with two decimals; the engine converts to minor units; the old millionths-of-a-dollar field is gone from Ink.
2. Implement, run, pass.

### Package 1D: posting safety (H6, H19, H20)

**Files:** `build/posting.ts`, `build/browser.ts`, `playbooks/draft-checks.ts`, `playbooks/social/checks.ts`; tests `platform/tests/venture-posting-safety.test.ts` (new), `platform/tests/venture-prompt-leak.test.ts` (new).

1. Failing tests:
   - Posting takes a draft id, never free text: the draft must have passed its checks, have the client's recorded approval where the playbook needs one, and its digest must be unchanged; otherwise refused with a reason per post (`POST_DRAFT_UNCHECKED`, `POST_CLIENT_NOT_APPROVED`, `POST_DRAFT_CHANGED`).
   - Browser posting window: an action on a submit button, password field, file input, download or off-site link (also Enter in a form and `role="button"` in a form) is held for the owner; a challenge, verify or 403 page stops automatic actions on that site until cleared; a platform block freezes the channel for 72 hours. Use a fake page model in tests (no real browser).
   - Prompt-leak lint on every outbound draft ("as an AI", "here is a post", "[hook]", "<placeholder>", scaffold markers) fails the draft's checks before the owner sees it as ready.
2. Implement, run, pass.

### Package 1E: untrusted content, taint latch, effects and floor (H9, H10, H11, H12)

**Files (new):** `policy/untrusted.ts`, `policy/taint.ts`, `policy/effects.ts`; **changed:** `policy/floor.ts`, `policy/ladder.ts`, `delivery/harness/tools.ts`, `delivery/harness/loop.ts`; tests `platform/tests/venture-untrusted.test.ts`, `platform/tests/venture-taint.test.ts`, `platform/tests/venture-effects.test.ts` (all new).

1. Failing tests:
   - Untrusted screen: client files, mail, posts and web pages pass through a screen that strips script, iframe and style, redacts secrets and ids not needed, and flags injection phrases and text aimed at a checker ("mark this as safe", "ignore previous instructions"); the screen has `observe` and `enforce` modes; in enforce a flagged item is quarantined until the owner releases it; an error in the screen fails closed.
   - Taint latch: every tool declares effects from a fixed list (`read`, `private-read`, `write`, `send`, `egress`, `money`) and every result an integrity label (`trusted`, `untrusted`); once an untrusted result enters a run, any write, send, egress, money or private-read call needs the owner's approval of the exact action, at every posture; a tool with no declared effects is blocked.
   - Effects come from Chausar's connector catalogue and the action, never the model's label: an unclassified tool counts as destructive; names with delete, archive, send, publish, pay, refund count as destructive; `notifyCustomer: true` and mutating HTTP verbs can never be read; a gate that throws denies.
   - Floor additions: creating or changing a recurring job, adding or loosening a rule, any change of payment or payout details, and "issue for real" (separate from "draft") always ask; deleting a scheduled job does not.
2. Implement, run, pass.

### Package 1F: network and secret safety (H16, H17, H18)

**Files (new):** `core/net-guard.ts`, `core/secrets.ts`; **changed:** every place that fetches a URL an agent or client supplies (find them with Grep for `fetch(` under `platform/runtime/venture`), `models/port.ts` (screen before send), `journal/journal.ts` (redact payloads), `evidence/ledger.ts`, `build/share-links.ts`; tests `platform/tests/venture-net-guard.test.ts`, `platform/tests/venture-secrets.test.ts` (new).

1. Failing tests:
   - Net guard: http(s) only; no user info in the URL; refuse private, loopback, link-local, metadata and reserved addresses in every spelling (decimal, octal, hex, IPv6-mapped) after DNS resolution; re-check every redirect hop; the request uses the checked address. Tests stub DNS.
   - Secret screen: text sent to a model, written to traces, the journal, evidence or share links is screened for known key prefixes (sk-, sk-ant-, ghp_, AKIA, xoxb-, AIza and similar) and high-entropy strings of 16+ characters (placeholders like `<your-key>` exempt); found secrets are replaced with `[redacted secret]`; URLs lose user info and secret-looking query values; browser read-backs are screened for card numbers (Luhn), bank account and IFSC pairs, OTPs, Aadhaar (Verhoeff) and PAN.
   - Telemetry: any usage counter Chausar sends uses a field allowlist; a `showWhatWouldBeSent()` returns exactly what would go out; third-party tools Chausar launches get their telemetry environment switches set off.
2. Implement, run, pass.

### Package 1G: receipts check on drafts (Q3)

**Files:** `delivery/checks.ts`, `delivery/judge/claim-check.ts`; tests `platform/tests/venture-receipts-check.test.ts` (new).

1. Failing tests: a number in a draft or run summary without a tool-result receipt is labelled "model estimate" automatically (or fails where the playbook forbids estimates, as the CA firm does); a file or link a draft names must exist in the run's evidence with a matching digest; a figure the calculator can refute is replaced by the calculator's value with its receipt and a note.
2. Implement, run, pass.

### Package 1H: UI and leads bugs (H5, H8, C1, U15, U16)

**Files:** `app/ui/src/parts/ApprovalRow.tsx`, `app/ui/src/places/clients/Leads.tsx`, `app/ui/src/engine/fake-extras.ts`, `app/ui/src/places/connections/YourAi.tsx`, `app/ui/src/shell/BusinessMenu.tsx` (+ its CSS module), `app/ui/src/places/onboarding/Welcome.tsx`, `customers/leads.ts`; tests in `app/ui/tests/` beside the existing ones and `platform/tests/venture-leads-stages.test.ts` (new).

1. Failing tests:
   - ApprovalRow: when decide fails with `REQUEST_TIMEOUT`, the row re-reads the stored decision (queue view by id) and shows the real outcome; only if the re-read also fails does it show "Couldn't send".
   - Leads stages move forward only (found, contacted, replied, won, lost; terminal stays terminal); `recordSend` on a replied lead keeps it replied; each move stores an evidence ref.
   - Leads.tsx reacts to the real engine codes `LEADS_SOURCE_REQUIRED` and `LEADS_ADDRESS_MISSING` (the postal address field appears); the fake engine throws the same real codes.
   - YourAi: the key field is not inside a `<form>`, has `autocomplete="off"`, and is cleared in a `finally` after submit, success or not.
   - BusinessMenu opens as a popover above the page (portal), not clipped by the 220px rail or the phone top bar; test that it renders outside the rail element.
   - Welcome PassphraseOpen: under React StrictMode a wrong passphrase shows the refusal line and Open is enabled again (reset `live.current = true` on mount).
2. Implement, run, pass.

### Package 1I (integrator, before the agents start): copy the research

Copy `D:\claude\chausar-2\research\grok-harvest-2026-10-21\` (README, build-audit, cards, cards2, frontend, the TSVs) into `docs/research/harvest/`, minus clone logs. Commit with the spec and this plan: `docs(ink-v2): spec, plan and the harvest research`.

### Wave 1 done when

Every package's tests pass; typecheck (engine and UI) clean; the UI suite and all six bench shards green; one PR "Ink v2 wave 1: safety and bug fixes" with a table of rows fixed and their tests.

## Wave 2: wire the built-but-unreachable code (catalogue W2 rows; audit section "Built but not wired")

Packages, each with its own detailed task list written at the start of the wave from the code as it then stands: 2A CA tax engines as harness tools (income tax, interest, TDS, reconcile, portal diff) and CA receipts stored and re-derivable; 2B posting propose and sign-in methods, resilient selectors with dry-run `checkedOn`, the send governor, the script and read-back guard, owner records a client's answer; 2C judges on real orders, the cited-evidence judge for the practice clients, rehearsal and improvement controls in Ink with rollback; 2D bank statements feed the books with own-transfer pairing, consent and alert methods; 2E YouTube pieces into runs (hook ranking, EDL, chapters, retention reader, local transcription via whisper when present); 2F social pieces into runs (14-step flow, calendar, threads, report figures from exports, narrative check, rule freshness on screen, client lists into checks); 2G evidence ledger fed by an agent tool.

## Wave 3: Ink v2 look (catalogue W3 rows; spec section 4)

Starts once the founder picks the accent on the direction D canvas. Packages: 3A tokens and theme (accent variable, department hues, dark pairs, contrast tests); 3B parts (spec 4.2) with tests; 3C Today; 3D Team (departments, toggle, one-department view, agent panel shell); 3E Work and Clients shells (three tabs); 3F Money visuals; 3G Connections, Business, Start gallery; 3H phone layout (bottom tabs, swipe) and Hindi for every string; 3I screenshot walk at 1280 and 390, light and dark, against the direction D boards.

## Wave 4: new features (catalogue W4 rows; spec sections 5.1 to 5.7)

Packages: 4A departments map and Keeper; 4B agent threads, notes, standing orders, "from now on" proposals and versions; 4C chief of staff; 4D network import, strength, search, warm paths; 4E pipeline, follow-ups, drafts and handoffs (mail, LinkedIn, WhatsApp); 4F run controls and breakers; 4G notifications, digest, web push (count only); 4H models (CLI status checked against the installed tools, Your AI); 4I goals; 4J the remaining W4 catalogue rows (owner controls, approvals, quality and harness gaps), split by area at wave start.

## Wave 5: playbooks (catalogue W5 rows; spec section 5.8)

Packages: 5A shared playbook mechanics (catalogue 2.9.0); then one package per business: YouTube deepening, CA deepening, social deepening, SEO and AI-search, online seller and seller services, support desk, recruiting desk, job-search desk, translation and subtitling, bookkeeping and CFO-on-demand, podcast to article, lead generation, newsletter, tender desk, website builder, narration, and the smaller businesses that need no outside approval. Each: data, deterministic checks with tests, a committed judge baseline, connectors with honest labels, a Start gallery tile, Hindi strings.

## Pre-execution checklist

- [x] Every spec requirement maps to a wave and package (spec section 7 table, catalogue wave tags).
- [x] Wave 1 tasks name exact files, failing tests, error codes and commands.
- [x] Waves 2 to 5 get their detailed tasks at wave start, from the code as it then stands (the code changes under each wave).
- [x] Commit messages are conventional (`fix(w1): ...`).
