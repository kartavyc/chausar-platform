# Wave 6 work packages

Read `DECISIONS.md` first; each package names the decisions it delivers. Run batches in order. Inside a batch, packages that touch different files may run in parallel through helper agents; one integrator commits.

Every package:
1. Writes the failing test first, then the code (AGENTS.md "How work is done").
2. Passes `REVIEW.md`.
3. Ends with one commit, `feat(w6): <id> <what>`.
4. If it touches an installed tool or an outside service, runs once for real on harmless sample data and records the result in `NOTES-6.md` (or says "fixture-tested, waiting on <founder item>").

After each batch: run both typechecks, `node scripts/check.mjs`, the UI tests and the engine tests near the batch, then stop and report to the founder what passed, what is left and what needs them.

---

## Batch 0: set up

**6-0 Start.** Branch `b2c/ink-v2-w6` from `b2c/ink-v2-w5`. Run the full test suite and record the baseline in `NOTES-6.md`. Shoot every current screen with `node scripts/ui-shots/walk.mjs` into `reference-ui/current/` so the existing look is the reference for everything not drawn in `reference-ui/`. List every place in code that the decisions below change, so nothing is missed.

## Batch 1: foundations

- **6A1 Storage is beta-grade (D22).**
  - Add tests for backup then restore, a crash in the middle of a save, and opening with the recovery code.
  - Then make `experimentalStorage()` false for the desktop file store.
  - Remove the "Practice invoice" line and the "experimental storage" banners on desktop.
  - The hosted tier keeps its label.
  - Done when an invoice issued on desktop carries no practice line and the three storage tests pass.
- **6A2 English only (D18).**
  - Remove the Hindi strings, the language switch, the Devanagari font and `hi-review.json`.
  - Remove the tests and rules that demand Hindi; keep the translation plumbing.
  - Done when the UI tests pass with English only.
- **6A3 Country and currency (D15).**
  - Default from the time zone (Asia/Kolkata gives India and INR).
  - The AI reading the owner's words can override it; the first screen confirms it.
  - Never use the language setting.
  - Done when tests cover India from the time zone, a sentence naming another country, and an owner change.
- **6A4 Claude Code on by default (D13).** `CHAUSAR_CLAUDE_CODE_TERMS` defaults to accepted. Remove the pending-terms screens. Keep the variable to switch it off. Done when tests show Claude Code offered by default and hidden when the variable says pending.
- **6A5 Limits are owner settings (D27, D29).**
  - Posting pace, outreach caps and the send governor become editable settings.
  - Keep today's numbers as defaults, with one plain warning about platform bans.
  - Remove "can lower but not raise".
  - Done when an owner can raise a cap and the warning shows.
- **6A6 Words and founder text (D10, D28).**
  - Apply the renames everywhere in UI strings.
  - Remove "the founder's yes" and any founder-facing text from customer screens.
  - Remove the receipt id from client-facing documents.
  - Update the word budgets in `app/ui/tests/baselines/words.json` down where text shrank.
- **6A7 Repo rules.** `AGENTS.md` is already updated in this pack. Make the tests match it (Hindi checks removed, new rules where a test can hold them).

## Batch 2: the AI tool becomes the agent

- **6B1 Chausar as an MCP server for agents (D6, D7).**
  - Extend `platform/runtime/mcp.ts` into the agent's toolbox, scoped to one run, with these tools:
    - read business, client, order and files;
    - calculator (returns a receipt id and figures);
    - draft document;
    - propose action (creates a Today card);
    - search records.
  - Tool results are marked untrusted.
  - The agent may only cite numbers that come back from the calculator; the existing number guard checks drafts.
  - Done when a scripted agent can read an order, get a receipt-backed total, and propose a send that appears on Today without sending.
- **6B2 Codex driver (D6, D11).**
  - Drive `codex app-server` over JSON-RPC on stdio: threads, turns, streamed events into Work and the agent's chat, interrupt and resume.
  - Codex approval requests are routed to its own reviewer.
  - Defaults come from Settings > AI, including `windows.sandbox=unelevated` on Windows and Chausar's MCP server.
  - Reference: T3 Code's `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts` and `packages/effect-codex-app-server` (MIT; read for the approach, write our own).
  - Live check: one real run on this machine on a sample order.
- **6B3 Claude driver (D6, D11).**
  - Drive Claude Code through `@anthropic-ai/claude-agent-sdk`, using the user's own Claude Code login, never ours: permission mode auto, tool allowlist plus Chausar's MCP server, the default models, effort and fallback.
  - Reference: T3 Code's `ClaudeAdapterV2.ts`.
  - Live check if Claude Code is installed; otherwise fixture-tested and noted.
- **6B4 Key route (D12).**
  - Keys work through the same two drivers (Codex with an API key, the Agent SDK with an Anthropic key).
  - Add OpenAI-compatible gateway presets where the driver supports that wire format; say so honestly where it does not.
  - Keys go in the OS keychain (Electron safeStorage).
  - Cost receipts come from the provider's reported usage.
- **6B5 Approvals rework (D9, D10).**
  - Add one consent per client for sending their data to the AI, recorded and withdrawable.
  - Remove per-turn previews and `PREVIEW_TTL_MS`.
  - Outside effects keep exact approval cards and the journal.
  - Auto mode becomes a per-agent owner setting.
  - Done when a real order runs end to end with no per-turn approval and still stops at the send.
- **6B6 Retire the old paths (D8).** Fold the heavy-work tier into the drivers. Retire Chausar's own loop caps and the row-language sandbox as the main path (keep the code only if a playbook still needs it). Plan users see "runs on your plan" in place of cost reservations. Delete dead code and its tests.
- **6B7 Settings > AI (D11, D29).** One page: model per task, effort, sandbox and network, web search, MCP servers, approval mode, keys. Defaults as in D11.
- **6B8 Live end-to-end.** On this machine: install state, sign in, a sample order from intake to a drafted deliverable to an approved (handed-off) send, using Codex. Record it.

## Batch 3: onboarding

- **6C1 Connect your AI (D12).**
  - Build the first-run screen from `reference-ui/Main.dc.html`. It detects installed tools and starts each tool's own official login:
    - Codex: `codex login --device-auth`, showing the code and the link;
    - Claude Code: its own login.
  - Other paths: a key option, and "Skip for now: use templates".
  - Chausar never handles credentials.
  - Live check with Codex.
- **6C2 About you (D16, D16a).**
  - Build the hybrid in `reference-ui/OnboardAB.dc.html`: it opens as A (`OnboardA.dc.html`), and sending a message turns it into B (`OnboardB.dc.html`), with the message box growing into the chat and the preview sliding in from the right. One motion, at most 400 ms, none with reduced motion. It changes on Send, never mid-typing. A tile pick goes straight to the plan; "Back to fields" returns to A. Done when a UI test covers A, the switch on Send, reduced motion and going back.
  - The AI reads a sentence, a resume PDF or a LinkedIn export ZIP (`Profile.csv`) and returns profession family, offers and country.
  - The family tiles are the fallback and the correction path.
  - The keyword classifier is used only without an AI.
- **6C3 Price ranges with sources (D17).**
  - A data file of ranges per profession (and city where data exists), each with source links, publisher and date checked.
  - Credible sources only; otherwise "No reliable data".
  - The (i) popover shows the sources, as in the reference.
  - Ranges are labelled and never set the price.
- **6C4 Two launch stages (D19).** Practice and Live, with a working button to move up (the engine method `venture.launch.advance` exists; no screen calls it today). Hide unfinished stages.
- **6C5 Owner attestation (D20, D21).**
  - One screen per locked rule: plain words, a tick, recorded with date, withdrawable.
  - Hard stops are listed and never unlock.
  - Done when the eight locked playbooks run on a real order after attestation, and a hard-stopped action is still refused.
- **6C7 Connect what your business needs (D50).** After the plan is kept, show the outside services this business would use, each with why, a guided connect (the service's own sign-in or a key into the keychain) and Skip. The same list lives in Connections. Done when a CA, a tutor and a video editor each see a sensible, different list, and skipping everything still leaves a working business.
- **6C6 Day-job and compliance check (D5, D21).** When the profession is picked, ask the side-work question and show that profession's rules; switch off what its regulator forbids (outreach for advocates, for example).

## Batch 4: money

- **6D1 Configurable invoices (D23).**
  - Many invoices per order (advance %, milestones, partial, final); due dates on orders and invoices; payment terms; reminder schedule; recurring.
  - Remove "One order becomes one invoice, once" in `money/invoices.ts`.
  - All BigInt and receipts.
- **6D2 How to pay (D24).**
  - The owner's UPI ID and bank details in settings.
  - A `upi://pay` link and QR built by code with the exact amount and invoice reference.
  - A PDF export, and Share through WhatsApp or email (the owner sends).
  - Live check: the QR opens a UPI app with the right amount (do not pay).
- **6D3 Razorpay Payment Links (D25).** Runs on the owner's own account, test mode first. Creating a link needs approval. Chausar polls status while the app is open and marks the invoice paid with a receipt. Live check in test mode once the founder supplies keys.
- **6D4 Foreign currency (D26).** Invoice in the client's currency, with the GST export (LUT) handling the code already has.

## Batch 5: professions

- **6E1 Service types (D2).** Add `teaching`, `local-services` and `licensed` to `core/service-types.ts`, plus keyword fallbacks for every family.
- **6E2 Lesson desk.** Batches, sessions, worksheets and quizzes, progress reports, parent updates, attendance and fees. Parental consent for children's data (D21).
- **6E3 Booking desk.** Intake, slots, deposits through the UPI link, reminders, quotes computed by code.
- **6E4 Document desk.** Generalise the tender desk and the kit's proposal, report and ooxml blocks into document and report services.
- **6E5 Sign-off desk.** Generalise the CA firm's sign-off gate so a licensed professional signs every regulated output; switch off tools a regulator forbids.
- **6E6 The 57-profession map (D2).**
  - A data file mapping each profession to its family, offers, playbook or desk, cautions and size.
  - Tests check every profession resolves to a working playbook.
  - The gallery shows the families.

  | Family | Professions | Engine |
  |---|---|---|
  | Money and tax | Accountant, CA, retired tax or bank staff (ITR), payroll executive, company secretary | CA firm, bookkeeping-cfo, sign-off desk |
  | Teaching and coaching | School teacher, spoken English trainer, yoga or fitness trainer, music or dance teacher, corporate trainer, senior mentor, dietitian, language teacher | lesson desk (+ job-search coaching, narration) |
  | Creative work | Photographer, video editor, graphic designer, voice artist, interior designer or architect, tailor or fashion designer | brand kit, YouTube, narration, social |
  | Writing and content | Journalist (newsletters), marketing executive (SEO blogs), copywriter, podcaster, founder ghostwriter, translator | SEO, newsletter, social, podcast, translation |
  | Local services | Beautician or salon, electrician or plumber or AC technician, home chef or tiffin, real estate broker, travel agent, event or wedding planner, physiotherapist | booking desk |
  | Documents and reports | Tender or GeM bid writer, HR executive (handbooks), quality engineer (SOPs), bank officer (DPR or CMA reports), civil engineer (estimates), academic (thesis editing), technical writer | document desk |
  | Research and analysis | Market research analyst, MIS or data analyst, sales executive, researcher, procurement executive | monitored data, lead generation, CFO pack |
  | People and careers | HR recruiter, placement officer (resumes) | recruiting, job search |
  | Shop and back office | Ex-retail staff (marketplaces), customer service, data entry, executive assistant | online seller, support desk, data entry, virtual assistant |
  | Tech services | Software engineer (websites), QA tester, IT support, call centre agent (AI receptionist) | website studio, dev agency, app testing, IT triage, phone receptionist |
  | Licensed work | Advocate, doctor (appointments and follow-ups), financial planner or MFD (review packs) | sign-off desk with regulator limits |

  Cautions to carry in the data:
  - RTE s.28 (school teachers and private tuition);
  - BCI Rule 36 (advocates);
  - Telemedicine Guidelines 2020 (doctors);
  - SEBI RIA and RA rules (finance);
  - the CoA "architect" title;
  - RERA (brokers);
  - FSSAI (home food);
  - NCAHP (physiotherapists);
  - TRAI DND (calls).

  Check each statute before it ships; mark any unchecked ones.
- **6E7 Traders (D49).** Add a securities guard enforced in code. Add a trading journal from broker CSV exports (Zerodha, Groww, Upstox, Dhan) with realised P&L and every charge computed by code. Add a tax pack for the owner's CA (intraday, F&O, capital gains; labelled "check with your CA"; rules versioned for the Income-tax Act 2025).

## Batch 6: outside world

- **6F1 MCP client (D30).** Stdio (desktop) and streamable HTTP, OAuth with PKCE, keychain tokens, elicitation, exact approval by argument digest for non-read tools, tool description fingerprints, tool search, a curated list from the official registry. Reference: Codex `codex-rs/rmcp-client`, `core/src/mcp_tool_call.rs`. Live check against one public read-only MCP server.
- **6F2 Playbook packs (D31).** A pack format of skills, MCP references and WASM calculators, with no code hooks. Load, validate, show.
- **6F3 Web search and reading (D32).** Search through the AI tool's own built-in web search by default (switched on per research playbook in the driver settings); for key users, an optional Brave, Exa or Tavily key. Local page reading with robots.txt, the terms-barred list, cache, polite pacing, an honest user agent and Readability. JavaScript pages through a hidden Electron window. Crawlee for small crawls. Stop at a CAPTCHA.
- **6F4 Outbound webhooks (D33).** Wire `sendToWebhook`: an approved exact payload to registered addresses only, HMAC signing, timeout, limited retries, idempotency key, receipt.
- **6F5 Email through the tool's Gmail connection (D34).** Enable the tool's connectors in the drivers (Codex apps for ChatGPT-plan users; Claude's connectors for Claude-plan users). Set every send-type connector tool to always ask, and turn that request into Chausar's exact-approval card (the auto reviewer must never approve a send). Fall back to opening a ready draft in the owner's mail app. Live check: the founder's Gmail connected in ChatGPT, one approved test email to the founder's own address.
- **6F6 Telegram alerts (D35).** The owner's own bot token in the keychain. Alerts are counts by default, details opt-in. Approvals stay in the app.
- **6F7 Phone access (D35).** Same-Wi-Fi pairing by link, plus a Tailscale guide in the beta guide.
- **6F8 People search (D37).** Happenstance and Probe42 or Tofler connectors on the owner's keys. Honest labels. Nothing LinkedIn-sourced.
- **6F9 Images and video (D38).** Sunra through the MCP client: an approval card with the cost in rupees from code, a rights record, never auto-confirm.

## Batch 7: chats, agents, CRM

- **6G1 Chat states (D42).** Pinned, Active, Snoozed, Settled; auto-settle; snooze presets; archive in Settings; undo. Reference: T3 Code `apps/server/src/orchestration-v2/ThreadSettlementService.ts`, `packages/client-runtime/src/state/threadSettled.ts`.
- **6G2 Retire an agent (D43).** Check screen, handover, routines off, read-only shelf, "(retired)" on receipts, Bring back.
- **6G3 CRM upgrades (D44).** Field history with who and when, pipelines as lists, a Company record, timeline entries.
- **6G4 Dated memory (D44).** Facts carry since-when, what they replaced, source and visibility.
- **6G5 Spend meter and model receipts (D44).** Per agent and per routine, with an owner cap; a model receipt on every run.

## Batch 8: configurable app

- **6H1 Mini apps (D39).**
  - Build from `reference-ui/AppsA.dc.html` and `AppsB.dc.html`: both the Apps place and making an app in chat.
  - A sandboxed frame host (reuse `app/ui/src/places/work/desks/SitePreviewFrame.tsx`) with no network, a strict content policy and its own origin.
  - A bridge in the MCP Apps message format.
  - A permission screen, versions with undo, pin to Today, export.
- **6H2 Recorded flows (D41).**
  - Record in the owner browser with JavaScript allowed.
  - The recipe is data with blanks.
  - Dry run, one approval, then exact replay with no AI.
  - Stop before submit, pay or post for that run's approval.
  - A fingerprint mismatch stops the run; an AI repair needs new approval.
- **6H3 UI as data and AI tools (D40).** Layout files per place, the block library, tools to read the screen, rearrange, rename, save views and navigate, guardrails, and the same tools in Chausar's MCP server.

## Batch 9: voice

- **6I1 Push-to-talk (D45).** Speech to text through Sarvam (key) or local whisper.cpp; the normal chat; text to speech through `speech-out.ts`. Numbers spoken only from receipt-checked text. Tap to approve. A consent notice; no audio kept by default. Live check with whisper.cpp if installed.

## Batch 10: ship

- **6J1 Installers (D3).** Windows (unsigned) and Linux (AppImage and tar.gz) through `scripts/desktop-package.mjs`; bundle Codex with its LICENSE and NOTICE; start at login and keep running in the tray. Mac out of scope. Live check: install and launch on Windows; Linux on the founder's machine or VM.
- **6J2 Feedback (D47).** An opt-in "Send report" with a preview; PostHog events (milestones, drop-off, friction counts, AI health, quality, earnings in ranges); Sentry crashes; short questions after milestones; a privacy notice and "delete my reports".
- **6J3 Open-source prep (D46).** AGPL licence, a check of the repo history for secrets and private data (report findings to the founder before anything goes public), NOTICE files for bundled tools, CONTRIBUTING.
- **6J4 Beta guide.** Install (Windows "More info, then Run anyway"; Linux AppImage executable), connect your AI, first business, first client, getting paid, phone access, sending a report.
- **6J5 Finish.** The full screenshot walk, all six engine shards, UI tests, both typechecks, the build, then `NOTES-6.md` with what is real, fixture-tested or waiting on the founder. Open the PR on base `b2c/ink-v2-w5`. The founder merges.
