# research-ops: recruiting, support desks, translation and subtitles

Second harvest, 23 October 2026. Ten products, each shallow-cloned into its own folder under the session scratchpad (`harvest-clones/<owner>__<repo>`) and read with file tools. Nothing was run, built or installed. Stars are Grok's figures from `oss-researcher-71.tsv`; licences and last-commit dates were read from the clones.

Every product here had its source in the repo, so none is NEEDS-REA. One is learn-only by licence (ResolveHQ). Index-Translate is partial: its models and its free API live outside the repo.

---

## matthewprice/JobFinderOS (MIT, ~180 stars, last commit 22 Sep 2026)

What it is: a Claude Code project, not an app. Three agent persona files and 25 markdown commands keep one job seeker's pipeline in an Obsidian vault. Small Python helpers run a scheduler and a deterministic job-board poller.

Source: full. The core loop is the model following markdown prompts. Only the scheduler, guards, pruner and job-board poller are code.

How it works:
- `config/recruiter_playbook.md` is the doctrine every command reads. It holds the warm-path gate (section 2), hard outreach caps (3.1: two bumps per thread, then park 30 days; 7 days between touches to one person; 3 new people a day and 10 a week; one unanswered thread per company), the two-fact rule (3.2), a silence table (4: a startup application quiet for 14 days is presumed dead; 7 days after a screen means "you are the backup"), funnel stages split warm and cold (5) and an objection log with seven fixed classes (9).
- `scripts/jobfinderos_ats_poll.py` reads the public Greenhouse, Ashby and Lever board APIs (lines 234-308). It gates on title, location and pay, diffs against a seen-set (`~/.jobfinderos/ats_seen.json`) and appends survivors to `vault/Market Intel/ATS Inbox.md` marked "unscored". `--seed` marks everything live as seen at install, so the first real run shows only new roles. Pay parsing fails open to "comp unverified" and skips figures followed by "million" (`parse_comp`, lines 391-422).
- `scripts/scheduler_tick.py` runs every 30 minutes behind a file lock. Weekly work wins and blocks daily that day, and a missed run catches up on the next tick.
- `.claude/commands/checkin.md` processes ticked dashboard boxes, re-ages every thread against the silence table and rewrites `vault/Dashboard.md`. Every command ends with a "Recruiter's read".
- `.claude/commands/voice-check.md` scans a draft for AI tells and returns PASS, REWRITE or DO NOT SEND. Failing the two-fact rule is always DO NOT SEND.
- Drafts go to the clipboard and the vault with a "Before you send" checklist and `[YOUR TAKE]` slots that the person has to fill.

Take for Chausar:
- Business: a job-search desk for working professionals. Offers: a monthly desk (watch target companies, keep the pipeline current, a prep pack per interview round), a one-off interview prep pack, and a job-title audit. The owner approves each draft and prep pack before the client sees it. The client sends every message and makes every application. It earns a monthly fee per client and carries little risk, because nothing goes to a third party from Chausar.
- Engine: put the outreach caps and the silence table into data and age threads in code over recorded send and reply dates (Alive, Cooling, Presumed dead). That covers the build audit's missing "follow-up dates" with a richer rule. The seed-then-diff watcher (a seen-set, seeding at install, alerting only on clean matches) suits any watcher Chausar runs.
- Connector: the Greenhouse, Lever and Ashby public job-board APIs are `read`, need no key and are real (lines 236, 256, 289). Planned for Chausar. Naukri and LinkedIn have no public job API, so they're `handoff`.
- UI: the "Before you send" checklist with blank slots the owner must fill, which forces a human edit; the verdict words PASS, REWRITE and DO NOT SEND; and dashboard tables "Now", "Live threads (last touch, next touch, state)" and "Applications (age, stage, human path)".

Traps: the 1 to 10 scores and the funnel percentages are written by the model into markdown (`config/scoring_rubric.template.md`, `checkin.md` step 6). Compute them in code or label them as model estimates. "Never send" rests on prompts alone: the README's Email safety section (lines 312-314) says the Gmail connector exposes send tools and "there is no separate technical lock". The Recruiter's read is opinion. The location regexes are US-only.

Already in Chausar?: drafts-only outreach, the blocklist and the MX check exist (`platform/runtime/venture/customers/leads.ts`, from revenue-squad in `cards/marketing-commerce.md`). Follow-up dates, Replied and Lost are listed as not built (`build-audit-2026-10-23.md` line 44). The caps, the silence table and the job-board watcher are new.

---

## 849879772/recruitops-agent (MIT, ~140 stars, last commit 7 Oct 2026)

What it is: a Windows desktop app (Electron shell, FastAPI, Postgres, Playwright) for a job seeker in Chinese campus hiring. It crawls about 60 company career sites, scores jobs against a resume with DeepSeek, fills application forms, reads recruiting email over IMAP and keeps an application board behind a strict approval layer.

Source: full (1,012 files with tests and frozen evals). Release zips exist too, but the source covers every feature in the README.

How it works:
- Stage order is enforced in code. `_STAGE_ORDER` in `packages/approval/policy.py:24-36` runs from interested (0) to offer (8), with rejected and withdrawn at 9. `validate_preview` refuses a backwards move and any move out of a terminal stage (lines 139-159). The same table guards mail updates (`packages/recruitment_mail/association.py:163-180`) and browser reviews (`packages/tools/browser_status_update.py`).
- An approval preview must carry an evidence summary. The token binds task, operation, idempotency key and the evidence digest. `begin_token` claims the write before any side effect and `release_token` frees a failed claim for a retry (`policy.py:113-533`).
- Mail-to-application matching is computed by code (`_candidate_score`, `association.py:104-140`). A top score under 0.65, or a gap under 0.15 to the runner-up, returns "unresolved" or "ambiguous" and needs confirmation (lines 284-390). Ambiguous times are dropped, a deadline never becomes an appointment, and an overlap with an existing appointment is flagged "schedule_conflict".
- Mail is treated as untrusted data. `packages/recruitment_mail/sanitization.py` strips script, iframe and style, redacts passwords, tokens, emails, phone numbers and national IDs, and flags injection phrases ("ignore previous instructions", "system prompt", "call the tool"). IMAP opens the mailbox read-only and fetches with BODY.PEEK, so nothing gets marked read (`connectors.py:348, 466, 692`). The agent's processing state is kept apart from the mailbox's read state (`models.py:28-46`).
- Career-site status text is quoted verbatim. A whole process ladder never counts as the current stage, and conflicting labels fail closed (`packages/domain/application_status_semantics.py`).
- Code-side hard filters (cohort, internship, degree) run first. Then the model returns a bounded score breakdown (direction 30, skills 30, project evidence 25, stack 15), with each requirement marked direct, adjacent or missing (`packages/matching/models.py:70-121`).

Take for Chausar:
- Business: the same job-search desk as JobFinderOS, or the candidate side of a recruiting desk. Its value is in the record-keeping, not a new business.
- Engine: four rules. (1) A stage order for every pipeline record (leads, candidates, tickets, orders): forward only, terminal stays terminal, every move carries an evidence ref. (2) Inbound-message association: code computes the match against a confidence floor and a margin, and anything below either becomes a confirm row on Today. (3) The sanitizer, as the first piece of the missing untrusted-content screen. (4) "Processing state is ours, read state belongs to the mailbox."
- Connector: read-only IMAP with an app password is `read`, real, and never changes the mailbox. Accounts that only allow OAuth (most Gmail and Outlook accounts) can't connect. Planned for Chausar.
- UI: the application board's subtitle "the step is the column, the card shows only the result" (`apps/web/index.html:336`). The mail page says links and calendar changes only create approval previews and shows counts for Current, Needs confirmation and Linked, with a freshness note (lines 696-719). The schedule has Todo and Month views plus a separate tray for items with no date yet (line 396). Automations "never pretend a missed time succeeded" (README) and every failure offers "ask the assistant to explain".

Traps: it only works with DeepSeek. The scores are model-written numbers, so label them as estimates. Crawling 60 company sites has to respect each site's terms. Form auto-fill on third-party sites only works because the user submits, and that should stay. App passwords sit on disk.

Already in Chausar?: single-use bound tokens, digest binding and the outcome-unknown journal are built (`docs/venture/ink.md`, "Journal and posture"). The stage-order guard is not. `recordSend` in `platform/runtime/venture/customers/leads.ts:180` sets `status: 'contacted'` even when a lead is already `replied`, so the lead will move backwards once Replied can be set. There's no untrusted-content screen either (build audit line 40).

---

## Viy1204/recruiting-copilot (MIT, ~93 stars, last commit 10 Oct 2026)

What it is: a recruiter's (HR or headhunter) workflow for any coding agent. Seven markdown skills and a workspace template with a CSV candidate ledger drive two Chinese job-board command-line tools (BOSS Zhipin, Liepin) and the Feishu (Lark) command-line tool for calendar, mail and chat cards. A plugin for the DeepSeek Harness (DSH) adds a live browser panel.

Source: full for the skills and the panel (`lib/index.js`, `client.js`). The job-board tools are separate repos.

How it works:
- `skills/recruit-grill/SKILL.md` asks one question at a time, each with a suggested answer. It turns "a strong X" into hard rules, must-have skills with a way to verify each, exclusion signals, target companies and search words. Output: a public job description, a private sourcing note that never leaves, and the rules in `CONTEXT.md`.
- `skills/recruit-daily/SKILL.md` runs unread messages, then search and recommend on both boards, then a hard-rule screen (thresholds, must-haves, exclusions, one to three stars), then greetings (confirm first; a batch consent lasts one round), then the ledger, the daily report and a keyword table refined from real matches. Every step has a "done when" test, such as "every screened person was either greeted or has a skip reason".
- The ledger, `02-sourcing/dedup-ledger.csv`, has fixed columns, dedups on name plus role and never downgrades a status (`references/ledger-and-report.md`).
- The daily card (`references/daily-card.md`) has five layers: four number tiles (unread handled, greeted, new in the ledger, waiting for you in orange), one block per key person, a "waiting for you" list with the reason for each item, the rest collapsed, and a button to a real link. Its rules: passing schema validation is not the same as being ready to send, and every number comes from the ledger.
- `skills/resume-review/SKILL.md` filters mail by sender domain first, then checks it really is a resume mail. It skips anything the mail system flags as risky and downloads attachments through a sha256 dedup index. It never marks mail read or moves it.
- `skills/interview-schedule/SKILL.md` checks free/busy, then asks one line ("<time>, <candidate> (<role> <round>), interviewers <names>, video, create?") and writes a calendar event with notes for the interviewers. The invite text goes to the owner to send. Without Feishu, it produces a manual pack.
- `lib/index.js:168-190, 400-427` is a breaker for platform challenge pages. When the browser lands on a 403, verify or security-check URL, every automatic action for that site stops. Only actions that make no new visit to the site are allowed, and only the human can clear the stop.

Take for Chausar:
- Business: a recruiting desk (hiring help for small companies, or sourcing as a service). Offers: role intake and job description (fixed fee), a shortlist per role (per batch), inbound resume screening (monthly), interview scheduling, and a success fee on hire set by the owner. The owner approves the hard rules, every first message to a candidate, every rejection (never automatic), every interview invite, and anything about pay or offers. See the sketch at the end.
- Engine: per-step "done when" tests that code can check against the records; the dedup key and the never-downgrade rule; consent that lasts one round only; and the challenge-page breaker for Chausar's owner-browser-session mode.
- Connector: the Feishu calendar (free/busy and create) is `write`; India's equivalent is Google Calendar, planned. Mail intake by sender domain with the sha256 index is `read`. Don't take BOSS or Liepin.
- UI: the five-layer daily card for Today; and the role intake interview: one question, a suggested answer, confirm or correct.

Traps: README lines 31-36 say the BOSS tool it relies on blocks the site's risk-control SDK and answers its report endpoints with fake 204s. That's platform evasion, so don't copy it. Test accounts were restricted for 24 hours. Greetings spend paid credits and can fail silently. It only works with Feishu.

Already in Chausar?: drafts-only leads and the blocklist exist. There are no candidate records and no recruiting playbook. The owner-browser-session posting mode is labelled but has no breaker.

---

## skeptrunedev/jev-recruiter (MIT, ~52 stars, last commit 18 Sep 2026)

What it is: a local web app that drives the owner's signed-in Chrome on LinkedIn. One model provider picks the next browser action from an indexed list, screens job titles, and judges visible profile text against up to 20 criteria with quoted evidence. The person shortlists.

Source: full (MIT, Browser Use copyright), small and tested. It needs a paid TypeSafe or Morph API.

How it works:
- `jev_ultrafast/recruiting_model.py`: code parses the criteria, one per line, marked Required or Preferred (lines 34-53). For each criterion the model answers two choice questions: met, not_met or unknown, and which excerpt id supports it. Code resolves the quote from the observed text, and no quote means unknown (lines 96-148). The fixed policy (lines 10-25): protected traits and their proxies are never assessed, missing evidence is unknown and never not_met, and years of experience are the union of overlapping dated roles.
- `jev_ultrafast/recruiter.py:70-97`: code recomputes the recommendation from the statuses. All required criteria met gives potential_match, any not_met gives not_a_match, and anything else is needs_review. The summary is one of three fixed sentences, never free model text.
- `docs/design.md`: the model picks an operation and a target from an indexed list, and its output never becomes a selector or code. Freshness guards run before each click, browser actions are never retried, and a run is capped at 60 actions and 120 decisions.

Take for Chausar:
- Business: the sourcing step of the recruiting desk ("find ten people who fit, with proof").
- Engine: the three-state criterion judge with code-resolved quotes and a recommendation and summary computed by code; and the protected-traits rule as a fixed policy for any task that screens people (candidates, tenants, leads).
- Connector: LinkedIn through the owner's browser session, read-only navigation, labelled with the ban risk. LinkedIn's terms forbid automated access, so default to `handoff`.
- UI: `static/recruiter.html` counters "supported matches 0 / 10, profiles found, assessed, shortlisted"; filters for all, potential matches, needs review, shortlisted and passed; the side note "One decision provider. Your Chrome session. Your final decision."; and the warning "Starting again replaces this session. Export your results first."

Traps: it browses LinkedIn automatically, and profile text goes to a third-party model provider. That's personal data under India's DPDP Act, so the owner needs a lawful basis and a notice. The README itself says a "potential match" is not verified.

Already in Chausar?: the judge already requires cited evidence ids (`docs/venture/ink.md`). Nothing screens people yet with three states, "missing is unknown" and summaries built by code.

---

## mirza-rizvi/ResolveHQ (source-available, learn-only; ~210 stars, last commit 29 Sep 2026)

What it is: a self-hosted helpdesk on one Cloudflare Worker (Hono, D1, R2, Queues, Email Routing, Resend). It has a three-pane inbox, response targets that respect working hours, snooze, satisfaction ratings, a knowledge base, webhooks and a read-only MCP server.

Source: full, but the LICENSE is a "Source-Available License". It forbids selling, offering it or "a substantially similar derivative" as a hosted service, and redistribution. The TSV's NOASSERTION hides this. Learn-only: describe the ideas and copy no code.

How it works:
- `src/server/sla/policy.ts` does working-hours arithmetic in local wall-clock time and converts to UTC only at the edges, so due times stay right across clock changes. It handles holidays, caps the scan at 365 days, and treats no configured hours as plain 24/7.
- `src/server/tickets/snooze.ts`: a snooze needs a reason. Waking moves the first-reply and resolution due times forward by the time actually snoozed, so the clock pauses, and a customer reply wakes the ticket early.
- `src/server/mail/queue.ts:233-280` threads replies by RFC Message-ID and References first, then by a signed reply address. Only as a last resort does it use the visible ticket number, and that number has to match the sender's own address ("a visible ticket number is not an authentication mechanism").
- `src/server/csat/service.ts`: ratings are off by default and use plain links with no tracking pixel. A unique index allows one survey per ticket, and scores always show how many answers sit behind them.
- `src/server/operations/readiness.ts` checks MX, SPF, DKIM and DMARC and says how to fix each one. When the DNS lookup fails it says that "does not mean your record is missing", and offers Re-check.
- AI (summarise, draft, classify, translate) stays off until an admin turns it on for the workspace (`src/server/assistant/routes.ts:43-64`). The MCP server is read-only "until there is a screen for approving what an assistant wants to send" (README). Server-side drafts save one revision at a time (`src/web/hooks/use-draft.ts:31-54`).

Take for Chausar (ideas only):
- Business: a support desk for small shops (sketch at the end).
- Engine: response-target due times computed by code in the shop's timezone and hours; a snooze that pauses the clock and wakes on a customer reply; the threading tiers; one survey per ticket; webhooks that carry ids and statuses but never message text.
- Connector: forwarded inbound mail is `read`. Outbound through a mail API stays `handoff` until Chausar wires a sender.
- UI: the queue order in `src/web/inbox/queues.ts:19-32` is All, Open, Overdue, Due soon, Pending, Unassigned, Mine, Waiting, Snoozed, Resolved, Closed ("what is late comes right after what is open"). The due badge in `sla-badge.tsx` is text, not an icon, and never animated. Colour backs the words and never carries them alone, and the badge shows nothing when there is "nothing honest to say" (no policy, already answered, snoozed). Otherwise it reads "Due in 3h" or "Overdue by 2h". The composer translates a reply into the customer's language and keeps "Draft before translation" beside it (`composer.tsx:278`). Other wording: "Queue clear. New conversations will appear here automatically.", "Queue unavailable" with "Retry tickets", and the placeholders "Reply to <name>…" and "Add context for your team…".

Traps: the licence (learn-only). When OpenAI is the configured AI provider, drafts go to OpenAI.

Already in Chausar?: none of response targets, snooze, threading or ratings. The support service type exists only as template words (`platform/runtime/venture/core/service-types.ts:191-211`: "Every reply before it reaches a customer", "Any refund or promise of money").

---

## GroundedCoreAI/nexusdesk (Apache-2.0, ~94 stars, last commit 22 Oct 2026)

What it is: a self-hosted agent platform (FastAPI, a LangGraph ReAct loop, Postgres, React with Ant Design). Its reference app is AI customer service: knowledge Q&A, tool calls, ticket drafts a human confirms, human takeover, customer memory and evaluation.

Source: full. The README says it's not production ready: the MCP adapter is planned, vector search is unvalidated, and the quickstart runs a mock model.

How it works:
- `backend/src/agent_platform/modules/agent_runtime/engine.py:32-146` caps model rounds and tool calls. An identical repeated tool call (same name and arguments) is a fault, and so are empty answers, duplicate tool ids and over-long output. It records the time to the first token of each round.
- `modules/customer_service/service.py:134-173`: the agent can only propose a ticket (`pending_actions`, a 30-minute expiry, a dedup key), and tells the customer the ticket is only drafted and gets created after confirmation in the workbench. `decide` (lines 175-304) runs in one transaction. It refuses an expired or already-decided proposal, and refuses while a run is still active on that conversation ("conversation_busy"). It's idempotent by action id. The customer id comes from the channel mapping, never from the model.
- `update_ticket` (lines 328-352) allows open to in_progress or closed; in_progress to waiting_customer, resolved or closed; waiting to in_progress or closed; resolved to in_progress or closed. Closed is final. Resolving or closing needs a note, and every change checks the revision.
- `modules/customer_service/TICKETING.md` designs typed ticket kinds with field definitions frozen per version, money as a decimal string plus currency ("a requested amount is not an executed refund"), an append-only process log, and an AI summary of request, verified facts, results, missing information and next step. It also says "saving a reply is not delivering it". The type designer isn't built yet (status line at the top).
- `modules/human_handoff/service.py:29-101`: asking for a human pauses auto replies, cancels queued runs, flags running ones, posts a system line and hands over a rolling summary with the last 10 messages. A human then claims, resolves or resumes, with a revision check. Blacklisted customers go straight to a human (`customer_service/service.py:105-116`).
- `modules/memory/pii.py` masks phone, ID, card and email numbers before any memory write. In `frontend/src/features/memory/PendingQueue.tsx`, low-confidence extracted facts wait for confirmation, and a fact a human protected can only get a "suggested update".
- `modules/evaluation/scoring.py:182-191`: hard rules fail first. A judge can never pass a case; at most it moves the case to needs_review.

Take for Chausar:
- Business: the chat side of the support desk, and a support line on WhatsApp or Telegram once a channel exists.
- Engine: a fault on repeated identical calls in the run loop; propose-then-confirm tickets with the "conversation busy" guard; the ticket state table with required notes; a handoff that pauses the agent and cancels queued work; and PII masking before any client memory is written.
- Connector: the channels are WeCom, WeChat Customer Service, Feishu, DingTalk, Slack, Telegram and Discord. There's no WhatsApp, which is the one India needs: planned.
- UI: `features/conversations/components/ProposalPanel.tsx` shows "Ticket to confirm · <title>", the body, "valid until <time>", and Reject and Confirm. The memory queue's header says low-confidence facts only take effect after confirmation. It ships a Hindi locale (`frontend/src/i18n/locales/hi.json`) worth a look by Chausar's Hindi reviewer.

Traps: the judge's 1 to 5 scores are model-written (it marks them analysis-only, so keep that). It's not production ready, and the channels lean towards China.

Already in Chausar?: propose and apply with expiry and decide-once is built (`docs/venture/ink.md`). The turn and tool-call caps exist (`platform/runtime/venture/delivery/harness/loop.ts:26`), but repeated calls aren't a fault. There are no ticket records, no handoff and no PII mask.

---

## bilibili/Index-Translate (Apache-2.0, ~1.8k stars, last commit 14 Oct 2026)

What it is: scripts, benchmarks and docs for a family of open-weight translation models covering 150 languages, image translation, speech to subtitles, voice-cloned dubbing, translation to a syllable budget and long documents. Bilibili also runs a free OpenAI-compatible public API for it.

Source: partial. The inference scripts, benchmarks, a browser extension and a video-dub pipeline are here. The models are Hugging Face weights and the API is a hosted service, so neither is in the repo.

How it works:
- `inference/llm/translate.py` (the prompt builder from line 162) supports hard constraints (glossary pairs, format), soft constraints (tone, domain) and a genre. A glossary comes as "k:v" pairs or a JSON file.
- `benchmarks/insttrans/eval/constraints.py` checks the hard constraints in code: glossary terms present with script-aware word boundaries (so "Öl" inside "Ölüberfluss" doesn't count), JSON keys unchanged, the HTML tag sequence kept, line breaks and indents kept, and hashtags and mentions kept. Soft constraints go to a judge.
- `video-dub/index_dub/segment.py` cuts speech into spans, merges short gaps and splits spans longer than the cap (about 10 s) at their quietest point. `timeline.py:11-60` stretches each dubbed clip into its original slot within a 1.5x cap, never lets it run into the next segment, and limits the peak level.
- Hindi is in the scripts' language list (`translate.py:102`). Speech dubbing covers only Chinese, English, Spanish and Japanese (README model table).

Take for Chausar:
- Business: translation and subtitling (sketch at the end). Documents with a client glossary, subtitles for the client's own videos, and dubbing only with the speaker's written consent.
- Engine: the code checks for translations (glossary, format, tags, layout, mentions) as playbook checks; the slot-fit rules for dubbed audio; the segment length cap for subtitles.
- Connector: the free public API (`https://index-translate.bilibili.com/v1`) is a model provider under "Your AI", labelled "free public service, no promise of uptime, client text leaves your computer". Self-hosted weights through llama.cpp or Ollama cover private work.
- UI: nothing to take; it's command-line tools and a demo page.

Traps: voice cloning needs consent and disclosure (Chausar's rule for AI voices). Client documents would go to a public API. Each benchmark carries its own licence. There's no Hindi score in the repo, so its Hindi quality is unknown.

Already in Chausar?: the YouTube playbook checks captions over faces, and "transcription" is listed as not built (build audit line 42). There is no translation offer.

---

## yuxino/Mimi (MIT, ~730 stars, last commit 23 Oct 2026)

What it is: a Tauri desktop app (Rust core, React UI) and an Android app. They capture system or microphone audio and show floating live translated subtitles through ten-plus cloud speech and translation services or Apple's on-device speech.

Source: full.

How it works:
- `shared/mimi-core/src/translation_policy.rs` classifies retries by HTTP status only, never by the provider's message text. Unknown or malformed error codes fail closed. Each line has one 45-second budget that retries never reset, and at most three lines can wait. Tests pin all of it (lines 150-253).
- `shared/mimi-core/src/subtitle_reducer.rs` is a state machine for draft lines, confirmed pairs (source and translation committed together by identity) and a bounded history.
- `src/lib/providerCapabilities.ts:64-149` keeps a table of each provider's source languages, target languages and modes, and the pickers only offer what the chosen provider supports. Its rule: what a user declares can narrow the options but never certifies that the model supports them.
- Saving subtitles or audio is off until the user turns it on, and history and exports (TXT, Markdown, WAV) stay on the device.

Take for Chausar:
- Business: live captions for webinars, classes and events, as an add-on to the translation service. Only with the host's permission to capture the audio.
- Engine: the retry policy (status-only classes, one deadline budget, a bounded queue) for every paid connector call; and a capability table per AI provider that limits what the UI offers, so Hindi only appears where a provider really supports it.
- Connector: the speech and translation providers (Gemini Live, OpenAI Realtime, Alibaba, Volcano Engine, Tencent, Baidu, DeepL) are model providers under "Your AI", labelled `write` because they receive audio or text.
- UI: wording from `src/lib/i18n.ts`: "Off by default. Content stays on this device. Turning a switch off does not delete saved records." (line 1010); "Model language support is unknown. Check your service documentation." (1045); "Language range was not saved. Your selection is kept; try again." (1057); "Nothing saved yet. Turn on a switch above, then start subtitles." (1132).

Traps: DeepLX is an unofficial DeepL endpoint, so don't offer it. Capturing other people's audio needs their consent, and recording copyrighted streams for a client needs rights.

Already in Chausar?: honest connector labels exist. A capability table per provider and a status-only retry policy don't.

---

## oboroge0/hayamimi (MIT code, model weights under their own licences; ~450 stars, last commit 16 Sep 2026)

What it is: a CPU-only Python pipeline for real-time speech to text. It routes each utterance to a model for its language (sherpa-onnx) and produces draft, final and refined transcripts, speaker labels, live translation, a dashboard and an OBS overlay.

Source: full. The TSV's NOASSERTION comes from a note appended to the MIT LICENSE: downloaded weights keep their own licences, and the Japanese-to-English model is CC BY-SA 4.0 (`THIRD_PARTY_NOTICES.md`).

How it works:
- `scripts/asr_engine.py` sends Japanese, Chinese, Korean, Cantonese, English and 24 EU languages to dedicated models and everything else to Meta's Omnilingual model. Models are evicted least-recently-used under a 2 GB cap.
- Draft text updates about every half second, and a final line lands about 100 ms after speech stops. After 2 s of silence a second pass re-decodes recent lines into a cleaner "refined" transcript.
- A hub publishes structured events: partial, final, translation, refine, warning (for example `diarization_failed`) and session_summary (`scripts/realtime_transcribe.py`).
- `docs/results/comparison.md` lists where it loses as well as where it wins.

Take for Chausar:
- Business: transcription as an add-on (meeting notes, interview transcripts for the recruiting desk) on the owner's own computer, with no cloud.
- Engine: three transcript tiers (draft, final, refined), where refined text replaces the final only once it lands; and a warning event instead of a silent fallback.
- Connector: the local model runtime is `write`, but local only: nothing leaves the machine. Planned.
- UI: the dashboard has a strip for in-progress text and a feed of finals with a language badge, a speaker chip and per-line latency. Translations sit under each line and a refined column runs beside them. The OBS overlay puts confirmed and in-progress text in separate rows.

Traps: Hindi isn't measured (it falls to the Omnilingual fallback). Bundling the weights brings the CC BY-SA terms with it. The WebSocket ingest has no authentication (it binds to localhost by default).

Already in Chausar?: transcription isn't built (build audit line 42).

---

## Edwardxlai/easyread (MIT, ~1.0k stars, last commit 20 Oct 2026)

What it is: a local paper reader (a Python standard-library server, a plain JS UI and an Electron wrapper). It translates PDFs page by page in the background with the user's chosen model, keeps equations and tables, shows the original beside the translation, and keeps notes and Ask AI in the margin.

Source: full.

How it works:
- `easyread/translate/page_check.py:30-52` counts a page as translated only if letter probes from its source text show up in the output. Old jobs that were marked done get repaired.
- `easyread/translate/terms.py:55-76` and `consistency.py:86-97`: the model only names the preferred translation of a term. Code swaps the text only when the variant appears exactly as many times as the source term, never inside formulas, and protects longer terms that contain it. Paragraphs the user edited are skipped, and every change goes to `job.log`.
- `easyread/translate/repair_guard.py` rejects a model "repair" that drops a block, changes an id, type or page, or empties a non-empty string.
- The reliability section of `docs/design.md` (lines 50-57): the agent and the user write different files. The page queues each edit locally and clears it only when the server confirms it's on disk. An edited paragraph stores the hash of the draft it replaced, so a later re-translation shows a notice instead of overwriting. Annotations anchor by quote, prefix and suffix, and show "translation changed" if the anchor is lost.
- `easyread/translate/translator_checks.py:16-30` puts problems the model finds in the source into the margin as "source check" notes, never into the text.
- A failed page retries, then gets skipped so the rest carries on, with one "retry failed pages" at the end. "Test one sentence" checks an engine before use (README).

Take for Chausar:
- Business: document translation (reports, research, contracts for a human translator to review). Deliverables are a bilingual document and an offline HTML file the client can open.
- Engine: the missing-page probe; the count-matched term swap; the repair guard; the "edited by the owner" hash, so agents never overwrite owner edits; and separate records per author.
- Connector: its engines (Claude Code, Codex, APIs, Ollama) are already covered by Chausar's "Your AI".
- UI: translation and commentary stay apart. The faithful text is the body, and AI notes sit in the margin labelled "AI · explanation" or "My note". There's a bilingual toggle, and the original page follows the reading position with a box round the current paragraph. With no model set, there's no Ask AI button at all; `docs/design.md` calls such a button fake. Colour marks the job: teal for AI, ochre for the owner's edits.

Traps: don't use a personal Claude subscription as the engine for paid client work; a business should use an API key. Client documents go to whichever model is chosen.

Already in Chausar?: "never fake a capability" and model setup exist. Owner edits are protected only by accept-by-digest on drafts. There's no translation playbook.

---

## Three businesses drafted from these cards

Each is a draft playbook, not a decision. Labels follow Chausar's rule: `read`, `write`, `handoff`, `planned`.

### A. Recruiting desk (hiring help for small companies)
- Offers: role intake and job description (fixed fee); a shortlist per role, each person with quoted proof (per batch); inbound resume screening (monthly); interview scheduling (per role); a success fee on hire, set by the owner.
- Records: Role (hard rules, must-haves with how to verify each, exclusions, a versioned keyword table); Candidate (dedup on email, or name plus role; source URL; date the privacy notice was shown; stage; stars; criterion findings with quotes; protected traits never stored); Touch (date, channel, who sent it); Interview (round, time, interviewers, status).
- Stage order, forward only: sourced, screened, contacted, replied, interview 1 to n, offer, joined. Rejected and withdrawn are terminal, and every move carries an evidence ref (recruitops).
- Steps: role intake, one question at a time with the owner confirming each rule (recruiting-copilot); sourcing from resumes the client sends, a read-only mailbox, or the owner's browser session; screening with the three-state judge and a summary built by code (jev-recruiter); the owner approves each first message and each rejection, and sends them; scheduling, where the owner confirms each invite; a weekly client report with numbers from the records only.
- Code checks: dedup; outreach caps and silence ageing (JobFinderOS); the protected-traits rule; a privacy notice line in every first message; each step's "done when" test.
- Connectors: read-only IMAP for resumes, `planned: read`; Greenhouse, Lever and Ashby boards, `planned: read`; calendar, `handoff` (Google Calendar `planned`); LinkedIn and Naukri, `handoff`.

### B. Support desk for small shops
- Offers: monthly support (every reply drafted, the owner approves); launch or sale support; help pages written from past tickets; a weekly report.
- Records: Ticket (status table from nexusdesk; priority; first-reply and resolution due times in the shop's hours; snooze with a reason; revision); Message (direction, threading ids, sanitised body, injection flags); Customer (identities, PII masked); Request (refund or replacement, with the amount as text plus currency and the note "requested, not done"); Rating (one per ticket, shown with its count).
- Steps: forwarded mail comes in and is sanitised; threading (Message-ID, then a signed reply address, then the number bound to the sender); a match to the customer and order (floor and margin, otherwise a confirm row on Today); classification; a draft that cites its sources; the owner approves, and the shop approves any policy change through a share link; the owner sends from the shop's mailbox; the ticket resolves with a note; an optional rating.
- Always ask: refunds or any promise of money, anything legal, deleting, and anything to a customer the shop has blocked (which goes straight to the owner).
- Code checks: due times and the paused clock; wake on a customer reply; the handoff pauses the agent and cancels queued runs; a repeated identical tool call stops the run; no figure in a draft without a source.
- Connectors: forwarded mail or IMAP, `planned: read`; sending, `handoff` (the owner sends); WhatsApp Business, `planned` (it needs Meta's approval).

### C. Translation and subtitling service
- Offers: document translation with the client's glossary (per page or per word); subtitle files for the client's own videos in Hindi, English and regional languages (per video minute); live captions for a webinar (per hour, with the host's permission); dubbing only with the speaker's signed consent and a disclosure line.
- Records: Job (files, rights confirmation, language pair, glossary version, provider used); Segment (source, draft, the hash of an owner edit, findings from checks); Glossary (term, chosen translation, locked by the owner); Provider capability (which languages each engine really supports, Mimi).
- Steps: intake with rights; the glossary agreed and locked; translation per page or segment; code checks (missing pages, glossary present, format and tags kept, term consistency through the count-matched swap, subtitle line length and timing); the owner reviews in a bilingual view with commentary in the margin; the client approves through a share link; delivery as DOCX, PDF, SRT or an offline HTML file.
- Always ask: the glossary, every deliverable, any voice clone (no consent file, no job), and the quote.
- Connectors: Your AI (an API, or a local model for private files), `write`; free public APIs labelled as such; local video and audio tools.

---

## Ideas worth taking, ranked by value

| Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|
| Support desk playbook: forwarded inbox, threading, match to customer, cited draft, owner approves, owner sends, due times, snooze | ResolveHQ (ideas only), nexusdesk, recruitops-agent | playbook | high | L |
| Stage order for every pipeline record: forward only, terminal stays terminal, evidence on each move (fixes `leads.ts:180` downgrading replied to contacted) | recruitops-agent `packages/approval/policy.py:24-159` | engine | high | S |
| Untrusted inbound screen: strip active HTML, redact secrets, IDs, phones and emails, flag injection phrases before any agent reads mail | recruitops-agent `packages/recruitment_mail/sanitization.py` | engine | high | S |
| Inbound-message association scored by code against a floor and a margin; otherwise a confirm row on Today | recruitops-agent `packages/recruitment_mail/association.py:284-390` | engine | high | M |
| Read-only IMAP connector (read-only select, BODY.PEEK, UIDVALIDITY cursor; our processing state kept apart from read state) | recruitops-agent `connectors.py`, `models.py:28-46` | connector | high | M |
| Outreach caps and silence table as data, threads aged by code (Alive, Cooling, Presumed dead), follow-ups due | JobFinderOS `config/recruiter_playbook.md` 3.1 and 4 | engine | high | S |
| Recruiting desk playbook with candidate records, role intake, shortlist with proof, never-auto-reject | recruiting-copilot, jev-recruiter, JobFinderOS | playbook | high | L |
| Translation and subtitle checks in code: glossary present, JSON, HTML and layout kept, missing pages, count-matched term swap, repair guard | Index-Translate `constraints.py`; easyread `page_check.py`, `terms.py`, `repair_guard.py` | engine | high | M |
| Translation and subtitling playbook (glossary locked by owner, bilingual review, consent before any voice clone) | Index-Translate, easyread, Mimi | playbook | high | L |
| Three-state people-screening judge: met, not_met, unknown; quotes resolved by code; recommendation and summary built by code; protected traits never assessed | jev-recruiter `recruiting_model.py:10-148`, `recruiter.py:70-97` | engine | high | S |
| Response-target due times in the client's hours and timezone; snooze pauses the clock and wakes on reply | ResolveHQ `sla/policy.ts`, `tickets/snooze.ts` (ideas only) | engine | high | M |
| Today daily card: number tiles from records only, "waiting for you" with the reason, the rest folded, a real link | recruiting-copilot `references/daily-card.md` | UI | high | S |
| Challenge-page breaker for owner-browser-session: on a verify or 403 page, stop every automatic action on that site until the owner clears it | recruiting-copilot `lib/index.js:168-190, 400-427` | engine | high | S |
| Human handoff: pause the agent, cancel queued runs, post a system line, give the human a summary; claim, resolve, resume | nexusdesk `modules/human_handoff/service.py` | engine | med | M |
| Ticket proposal with expiry, refused while a run is active on the conversation; ticket state table with required notes | nexusdesk `customer_service/service.py:134-352` | engine | med | M |
| Owner edits protected by the hash of the replaced draft; agent and owner write separate records; local queue cleared only when saved | easyread `docs/design.md` lines 50-57 | engine | med | M |
| Repeated identical tool call is a run fault | nexusdesk `agent_runtime/engine.py:108-116` | engine | med | S |
| Retry policy: class by HTTP status only, unknown fails closed, one deadline budget never reset, bounded queue | Mimi `shared/mimi-core/src/translation_policy.rs` | engine | med | S |
| Capability table per AI provider that limits language pickers (Hindi shown only where supported) | Mimi `src/lib/providerCapabilities.ts:64-149` | UI | med | S |
| Queue order with Overdue and Due soon right after Open; a text due badge that says nothing when there's nothing honest to say | ResolveHQ `inbox/queues.ts`, `inbox/sla-badge.tsx` (ideas only) | UI | med | S |
| Reply in the customer's language with "Draft before translation" kept beside it | ResolveHQ `inbox/composer.tsx:266-282` (ideas only) | UI | med | S |
| Per-step "done when" tests checked against records before a run reports done | recruiting-copilot `skills/recruit-daily/SKILL.md` | engine | med | M |
| PII masked before any client memory write; low-confidence facts wait in a pending queue; owner-protected facts only get a suggestion | nexusdesk `memory/pii.py`, `PendingQueue.tsx` | engine | med | S |
| Job-board watcher on Greenhouse, Lever and Ashby with a seen-set and seed-on-install | JobFinderOS `scripts/jobfinderos_ats_poll.py` | connector | med | S |
| Job-search desk playbook (client sends and applies; owner approves drafts and prep packs) | JobFinderOS | playbook | med | M |
| "Before you send" checklist with slots the owner must fill in their own words | JobFinderOS `.claude/agents/coach.md`, `voice-check.md` | UI | med | S |
| Bilingual review sheet: faithful text in the body, AI notes in the margin, original page beside, no AI button without a model | easyread `docs/design.md`, README | UI | med | M |
| Attachment intake: sender-domain allowlist, skip mail flagged risky, sha256 dedup index, never mark read | recruiting-copilot `skills/resume-review/SKILL.md` | engine | med | S |
| Role intake interview: one question at a time, each with a suggested answer to confirm or correct | recruiting-copilot `skills/recruit-grill/SKILL.md` | UI | med | S |
| Interview scheduling with a one-line confirm and a manual pack when no calendar is connected | recruiting-copilot `skills/interview-schedule/SKILL.md` | connector | med | M |
| Transcription and live captions with draft, final and refined tiers and a warning event on fallback | hayamimi, Mimi | engine | med | L |
| Mail-domain readiness (MX, SPF, DKIM, DMARC) with fix-it lines and "a failed lookup does not mean the record is missing" | ResolveHQ `operations/readiness.ts` (ideas only) | UI | low | S |
| One rating per ticket, always shown with its count, no tracking pixel | ResolveHQ `csat/service.ts` (ideas only) | engine | low | S |
| Dubbed-audio slot fit: segments capped and split at the quietest point, stretch within 1.5x, never into the next segment | Index-Translate `video-dub/index_dub/segment.py`, `timeline.py` | engine | low | M |
| Saving off by default, worded "Content stays on this device. Turning a switch off does not delete saved records." | Mimi `src/lib/i18n.ts:1010` | UI | low | S |
| Free public translation API as a "Your AI" option, labelled as a free public service with no uptime promise | Index-Translate README | connector | low | S |
