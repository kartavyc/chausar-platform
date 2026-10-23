# Chausar Ink v2: a visual app for earning with AI, the audit gaps closed, and the 130-product harvest built in

Written 23 October 2026 with the founder, from structured questions and three rounds of mockups. Builds on `2026-10-21-chausar-frontend-ink.md` (Ink v1, merged as 11a73e83). Research behind it: `D:\claude\chausar-2\research\grok-harvest-2026-10-21\` (copied into this repo as `docs/research/harvest/` in wave 1): the build audit (`build-audit-2026-10-23.md`), the second-pass cards (`cards2/`) and the merged catalogue (`cards2/CATALOGUE.md`, 344 rows tagged W1 to W5). This spec says how; the catalogue says what, row by row.

## 1. Goal

Chausar is for retail customers and self-employed people (India first) who want to earn money or grow revenue with AI. The owner picks a computer-only business, a team of AI agents runs it, and the owner approves what matters. The app must be easy to understand and convenient for a non-technical person, yet have the depth and polish of a production-grade app.

This build does four things:

1. **Ink v2, the look.** Ink v1 read like a text ledger; the founder found it too plain everywhere. Ink v2 keeps Ink's fonts, greys and honesty rules and adds visual cues: tiles, cards with previews, agent avatars with status rings, progress rings and bars, charts, icons, department colours, a calmer green accent and the Chausar logo.
2. **Close the audit.** Every safety gap, bug and built-but-unreachable piece in `build-audit-2026-10-23.md` gets fixed or wired (except the three India pieces in section 2).
3. **New features.** Chats with Chausar as chief of staff; chat with each agent and change how it works through approved, versioned instruction changes; departments; a CRM with your own network, warm paths and a pipeline (modelled on Happenstance); run controls; notifications and phone push; models paid by the owner (own key or own CLI).
4. **More businesses.** Every buildable business and mechanism in the catalogue: the three existing playbooks deepened, eleven new playbooks, and the shared playbook mechanics they need.

## 2. Non-goals

- GST e-invoicing (IRN, QR), Account Aggregator bank feeds, and readers for AIS, 26AS, Form 16 and GSTR-2B files (founder, 23 Oct). Their connectors stay labelled `planned`.
- Anything that needs an outside party's approval to go live stays a tested code path labelled `planned` until that approval exists: official posting APIs (Meta, LinkedIn, X, YouTube app reviews), Gmail and Outlook sign-in (restricted Google scope), WhatsApp Business. Owner-side handoffs (open in the app with the text ready) ship now.
- Features that need many hosted users (shared network "circles") and a Telegram approval bot: designed, not built.
- Automated LinkedIn messaging or connecting, scraping other people's profiles, detection evasion, clipping without rights, CAPTCHA solving, unattended orders. Never built (catalogue section 3 lists every trap and reject).
- Credits, plans or billing. The owner pays for AI directly (section 3).
- A native phone app. The hosted web app is phone-ready instead.

## 3. Founder decisions (23 Oct)

| Topic | Decision |
|---|---|
| Look | Mockups A (ledger), B (bento) and C (feed) were shown; the founder chose **C + B, made cohesive** (direction D). Desktop grammar from B (bento tiles, tinted department panels, stats), friendly touches from C (greeting, dark goal card, stories row of agents, big preview cards, swipe on phone) |
| Brand | Logo and accent only: the two-square mark and lowercase "chausar" wordmark; keep Ink's fonts (Instrument Sans, DM Mono, Noto Sans Devanagari) and greys; the theme follows the computer |
| Accent | The neon #46F09B is too loud. The founder picked **Jade #2FB67C** from four calmer greens shown on the real Today screen; it fills the logo's second square too, with #0b0d0e text on it. Green text on light stays #0B7A45 for contrast |
| Quality judge | Runs automatically on every draft that goes to a client or the public (a few model calls per order on the owner's key), switchable off per business; internal notes skip it |
| Rupees | Spend limits stay in US dollars (what providers bill); the owner can set a rupees-per-dollar rate with its date, and spend then also shows in rupees, labelled with that rate |
| Today | Above the fold: goal progress (money invoiced this month toward a goal the owner sets), needs-you as visual cards, team at work. Not a money summary |
| Team | Five fixed departments as tinted tiles: Sales and clients, Marketing, Production, Money, Operations. A toggle shows one department at a time |
| Agent chat | Read every run as a conversation and talk to an agent. A "from now on" request becomes a proposed instruction change the owner accepts or rejects, versioned and undoable. The chat is not in your face: a quiet Chat button beside each agent on Team opens it |
| Avatars | Initials on the department tint, with a status ring (working, waiting on you, failed) |
| Chats | A new place in the rail to talk to Chausar itself as chief of staff. It answers with receipts and acts only through approvals: anything that spends, sends or changes prices becomes a Today card |
| Start | A gallery of ways to earn, plus "or describe it in one sentence" |
| Phone | The hosted web app is designed for phones too: bottom tabs, large touch targets, swipe to decide |
| CRM | Modelled on Happenstance: find people in your own network in plain words, warm paths, a pipeline, drafted intros and follow-ups; the owner sends them. Clients has three tabs: Clients, Pipeline, Network. Drafts open in mail, LinkedIn or WhatsApp (handoff). The unsubscribe line and postal address go only on cold outreach |
| AI payment | The owner's own API key, or the owner's installed Codex or Claude Code CLI (desktop only). No credits |
| Phone alerts | Web push with a count only ("3 need you"), quiet hours and a daily digest |
| Auto mode | Build the gate, drills and a shadow summary of what Auto would have done; keep Auto with spot checks locked |
| Hindi | Every new screen ships in English and Hindi (machine-drafted, marked for a native reviewer); agents get Hindi voice profiles and writing checks |
| Model numbers | Allowed only labelled "model estimate", never with a receipt (21 Oct rule, unchanged) |
| Shipping | Five waves, one PR each; the founder merges each |

My calls (no question needed): charts use greys plus the accent, with amber and red only for waiting and overdue; client and contact avatars are initials unless the owner uploads a logo.

## 4. The look: Ink v2

### 4.1 Tokens

Ink v1 tokens stay (bg, surface, fg, fg2, mute, dim, line, hover, link, wait, fail, edge, fonts, spacing, motion). Added:

- `--accent` (the founder's green), `--accent-ink` (#0b0d0e, text on the accent), `--accent-soft` (accent at 12%), `--accent-text` (#0B7A45 light, accent itself dark).
- Department hues and tints: sales #2F5BD3/#E8EEFC, marketing #7C3AED/#F1EAFE, production #0F766E/#E3F4F2, money #0B7A45/#E6F6EC, operations #475467/#EEF0F3, each with a dark-theme pair that holds 4.5:1.
- Rings: working = accent, waiting = #F2A93B, failed = #F04438 (rings are shape plus colour; the words still say the state).
- Radius: tile 16, card 12, chip 999, button 10. Shadow: one, `0 1px 2px rgba(16,24,40,.06)`, on tiles only.

The Ink v1 rules that change: "no boxes, no colour blocks" becomes "tiles and cards, colour for state and department only"; "one filled button per row" stays; "figures in DM Mono with a receipt or 'model estimate'" stays; "motion once, 400 ms or less" stays; "no emoji, no AI personality" stays.

### 4.2 New parts (`app/ui/src/parts/`)

Icon (lucide-react, MIT), Logo, Avatar (initials, tint, ring, badge), Tile, Card, Chip, StatTile, ProgressRing, ProgressBar (segments, striped "ready" part, pace marker), Sparkline, BarChart, AgingBar, CashLine (all plain SVG, every value from the engine, each with its receipt), Segmented (the department toggle and tabs), StoriesRow, PreviewFrame (video, document, invoice, post, diff), PathLine (warm paths), StrengthDots, Board (pipeline columns), SwipeCard, BottomTabs, NotificationBell, Composer, ChatThread, DiffCard (instruction change), Gallery. Existing parts (ApprovalRow, Change, Receipt, ModelEstimate, Provenance, Gate, Steps, JobList, RunSheet, Sheet, StatusLine) are restyled, not replaced, so their tested behaviour holds.

### 4.3 Places

The rail: logo, business switcher, then Today, Chats, Team, Work, Clients, Money, Connections (icons, Today's count). The business menu stays (and stops being clipped: it opens as a popover over the page, not inside the rail).

- **Today**: greeting and one summary line; the dark goal card (bar with invoiced, ready-to-issue and pace, the next best step as a big button); team at work (stories row plus live agent tiles with rings); needs-you as a grid of preview cards with filter chips (to approve, questions, setup, per business); Working now; Earlier. Every rule of v1 holds: approve by digest, second ask, view-before-approve, decided cards shrink to a receipt line.
- **Chats** (new): conversation list and the chief-of-staff thread (section 5.4).
- **Team**: stats tiles; the department toggle (All, or one of five); five tinted department panels with agent cards (ring, role, now line, progress, posture chip, Chat button). One-department view: big agent cards, its playbook steps as a flow with gates (floor steps locked), recent work with previews, spend and jobs chart. The agent chat opens as a 440px panel beside the page.
- **Work**: orders as cards grouped by client with step progress, live runs with rings, filter chips, failed runs with the real reason and Run again; run controls (section 5.6).
- **Clients**: three tabs. Clients (people who pay you, with provenance), Pipeline (board), Network (search and import) (section 5.5).
- **Money**: tiles (invoiced with the goal, received, owed with five aging buckets, AI spend); in and out by month; 13-week cash line; invoices with status chips; books, spend and journal as before; the journal's "outcome unknown" gets its Resolve control.
- **Connections**: connectors as cards with honest labels (write, read, handoff, planned) and setup steps; Your AI (own key, or the CLI found on this computer, with its real status).
- **Business**: Plan and playbook, Prices, Website build, Keep, Your CA, restyled; plus Goals (set the monthly goal) and Notifications.
- **Start**: the gallery (one tile per business: what you do, hours a week, what the AI team does, what clients usually pay as a "model estimate" range) and the one-sentence box.
- **Phone** (under 760px): top bar with logo and business, bottom tabs Today, Chats, Team, Work, More; cards stack; swipe right to approve (second ask still applies), left to skip; sheets cover the screen.

## 5. Architecture

```
app/ui (React, Ink v2)                      platform/runtime/venture (engine)
  places/today  chats  team  work           views/        queue, runs, team (+departments), events
  clients  money  connections  business     agents/       NEW threads, notes, standing orders, instruction proposals
  start  phone layout                       chief/        NEW chief-of-staff threads and proposal tools
  parts/ (Ink v2 parts)                     network/      NEW people, imports, strength, warm paths, pipeline, handoffs
  engine/client.ts  (IPC on desktop,        notify/       NEW notification centre, digest, web push (count only)
          /api/rpc + SSE on web)            delivery/     harness, judge, runs (+run controls, breakers, taint latch)
        |                                   playbooks/    youtube, ca-firm, social + 11 new + shared mechanics
        +--- venture.* methods ---------->  money/ journal/ policy/ evidence/ build/ customers/ models/
```

Everything new follows the engine's existing rules: records in the vault, every outside effect journalled, approvals bound by token and digest, the always-ask floor, money in BigInt minor units, receipts from code, model figures labelled.

### 5.1 Departments

Each playbook's roles map to one of the five departments in data (`playbooks/departments.ts`): for example Producer to Sales and clients, Researcher and Publisher to Marketing, Editor to Production, Bookkeeper and Billing to Money. Operations holds **Keeper**, which is honest about being code, not AI: it shows the engine's own jobs (backups, the journal sweep, connector checks, rule and rate freshness, selector checks) with their real last run and result. `venture.team.list` gains `department` per agent and a `departments` summary (working, waiting, done this week, spend this month, all computed).

### 5.2 Agent chat, notes and instruction changes

- **Threads**: one per agent per business (`venture-agent-message` records). The thread shows the agent's runs as conversation: owner messages, the agent's replies, each run folded into tick rows (from the run's steps), previews, failures with Run again.
- **Talking to an agent**: the owner's message goes to the harness with that role's read tools only (its runs, the order files, its notes), so it can answer questions about its work. A message that asks for work becomes an order or a run step through the existing order path, so gates and the floor apply.
- **"From now on"**: code, not a model, spots standing requests ("from now on", "always", "never", "I prefer", in English and Hindi). The agent then drafts a typed playbook patch on the steps its role owns (the improvement loop's patch types). The thread shows a DiffCard: old and new guidance, "Version 4 to 5, you can undo", Accept and Reject. Accept writes a new playbook version (versions are never overwritten); Undo points the business back at the previous version. The floor, tool grants and checks are not editable this way.
- **Notes**: owner-editable notes per agent (see, correct, forget, with a journal and undo). New notes are proposed only from the owner's own words, never invented; the owner accepts each. When a run uses notes, its thread shows a "Recalled" chip listing them.
- **Standing orders**: a short list per agent ("Always add burned-in captions to shorts") rendered from the accepted patches, so the owner sees in one place how the agent has been told to work.

### 5.3 Models: the owner pays

Your AI offers: an API key (Anthropic, OpenAI, or any preset already supported), or the Claude Code or Codex CLI installed and signed in on this computer (desktop only; the hosted app shows only keys). The CLI routes exist (`models/cli.ts`); this build checks their flags against the installed tools, shows the real status (found, version, signed in or not, terms accepted), and falls back to "not connected" with plain words, never a fake success. No credits or plans.

### 5.4 Chats: Chausar as chief of staff

A `chief` agent with read tools over every unlocked business (queue, runs, team, money, clients, plan, journal) and propose tools only. Its answers cite receipts (code checks every figure it quotes against a receipt, or labels it "model estimate"). It can plan, brief an agent (posts a message into that agent's thread), and propose actions; every action that spends, sends, changes prices or starts paid work becomes a Today card (kind `proposal`) that goes through the normal approval with digest and floor. Threads are stored per owner (`venture-chief-message`). Locked businesses are invisible to it until opened.

### 5.5 Network, pipeline and outreach (Happenstance-style)

- **Import, on this computer**: LinkedIn data export (Connections.csv, messages metadata only), contacts CSV or vCard, calendar ICS, and a mail header export; message bodies are dropped; one record per person, merged by email, phone and LinkedIn URL. Nothing is scraped; nothing leaves the computer.
- **Strength**: computed in code from weighted signals that fade over time (email both ways, meetings together, being a client, saved contact, LinkedIn connection), shown as five dots with a receipt listing each signal and its source.
- **Search in plain words**: the model turns the question into filters; code runs them over stored facts; every "why this match" line must quote a stored fact (checked in code).
- **Warm paths**: the strongest known connector between the owner and a person, drawn as a PathLine; any path Chausar cannot confirm is labelled "possible path, not confirmed".
- **Pipeline**: Found, Asked, Talking, Proposal, Won, Lost, Not now. Stages move forward only (terminal stays terminal; fixes the `recordSend` bug); follow-up dates are code arithmetic (wait days, allowed weekdays) and due follow-ups appear on Today; a reply stops the sequence.
- **Drafts and handoffs**: intro requests (a note to the connector plus a forwardable blurb), connection notes with a character counter, follow-ups; each opens in mail (`mailto:`), on the LinkedIn profile with the text copied, or in WhatsApp (`wa.me`); the owner sends and taps "I sent it". Cold outreach keeps the source URL, MX check, blocklist, unsubscribe line and postal address; warm notes do not carry the footer.
- **Privacy (DPDP)**: keep the minimum, Forget a person on request, an opt-out list kept for good, private by default.

### 5.6 Run controls, breakers and the taint latch

Stop (finishes the current tool call, keeps finished steps), Force stop (states what is lost), Resume, and an owner gate after each round when asked. A repeat-failure breaker stops a run on the same error 3 times, the same action 3 times, or 5 failures in a row, and hands the next turn an "already tried" list. A taint latch: once untrusted content (a client file, an email, a web page) enters a run, any outbound or write tool needs approval for the rest of that run. A spend cap is reserved before each call; a run that reaches its cap asks on Today for one more window.

### 5.7 Notifications

A notification centre (bell) with pause, quiet hours and a daily digest; web push on the hosted app with a count only ("3 need you"), never business details; the desktop shows the same count in the tray. Pushes come only for needs-you items, once per item.

### 5.8 Playbooks

Shared mechanics first (catalogue 2.9.0): a pilot offer in every sales stage, playbook steps with outcome edges, retry caps and timeouts, a dated rule register with freshness on screen, judges on real orders, coverage stated as a fraction, a measurement-boundaries table. Then:

- Deepened: YouTube (hook ranking runs, EDL, chapters, retention reader, captions, edit-by-asking on transcript word ids, local transcription, after-publish review, channel review add-on), CA firm (tax engines as tools, receipts stored and re-derivable, sign-off gates Accept and share links, current-year rate tables pending CA confirmation, citation checks with the 1961-to-2025 Act renumbering, NEEDS_FACTS loop, practice clients), social agency (the whole 14-step flow wired, client lists into checks, report figures from exports, calendar, threads, risk gate, owner-browser posting with resilient selectors and a send governor).
- New: SEO and AI-search visibility (incl. local), online seller and seller services desk, support desk for small shops, recruiting desk, job-search desk, translation and subtitling, bookkeeping and CFO-on-demand, podcast or video to article, lead generation and appointment setting, newsletter service, tender and proposal desk, website builder (deepened), narration and audiobooks, and the smaller businesses (virtual assistant, phone receptionist, data entry desk, app testing, demo videos, dev agency, client room, monitored data, IT triage) where they need no outside approval.

Each playbook ships as data plus deterministic checks plus a committed judge baseline, the way the three flagships do: offers with owner-set prices, typed steps with roles and departments, the owner's approval points, code checks, connectors with honest labels, and a start-gallery tile.

## 6. Interface (new engine methods)

All go into `VENTURE_METHODS`, the area map, the types, `engine.ts` routing, `app/desktop/ipc-contract.cjs` and the hosted contract.

| Area | Methods |
|---|---|
| Agents | `venture.agents.thread.list {agent}`, `venture.agents.thread.send {agent, text}`, `venture.agents.proposal.decide {id, digest, decision}`, `venture.agents.version.undo {agent}`, `venture.agents.notes.list/edit/forget`, `venture.agents.orders.list` |
| Chief | `venture.chief.thread.list`, `venture.chief.thread.send {text}`, `venture.chief.threads` |
| Team | `venture.team.list` gains `department`, `departments`; `venture.team.keeper` (Operations jobs) |
| Goals | `venture.goals.get`, `venture.goals.set {month, amountMinor}`; Today reads progress from receipts |
| Network | `venture.network.import {kind, file}`, `venture.network.search {text}`, `venture.network.person {id}`, `venture.network.forget {id}`, `venture.pipeline.list/move/followups`, `venture.outreach.draft {personId, kind}`, `venture.outreach.sent {draftId, at}` |
| Runs | `venture.runs.stop {runId, force?}`, `venture.runs.resume {runId}`, `venture.runs.roundGate {runId, on}` |
| Journal | `venture.journal.resolve {entryId, outcome, note}` (settles "outcome unknown") |
| Notify | `venture.notify.list/read/settings`, `venture.notify.push.subscribe {subscription}` (hosted) |
| Rehearsal | `venture.simulation.start`, `venture.improve.start/rollback` exposed to Ink |
| Posting | `venture.posting.propose {draftId, account}`, `venture.posting.signIn {account}`, `venture.share.recordAnswer {draftId, answer}` |
| Models | `venture.models.cli.status` |

Events added: `agent.message`, `chief.message`, `proposal.created`, `notify.new`, `pipeline.changed`.

## 7. Waves (one PR each)

| Wave | What | Done when |
|---|---|---|
| W1 Safety and bugs | Catalogue W1 rows: CA sign-off gates Accept and share links; tax drafts need calculator receipts; current-year rate tables (unconfirmed until the CA confirms); taint latch and untrusted-content screen; journal Resolve; spend reserved before the call and the cap window on Today; timeout re-read restored; post path checks; the leads stage bug, the leads error codes, spend limits in rupees, the business menu clipping, the Welcome StrictMode bug; copy the research into the repo | each fix has a failing test first; CI green |
| W2 Wiring | Catalogue W2 rows: tax engines as tools, posting with resilient selectors, risk gate and script guard, judge on real orders, rehearsal and improvement controls in Ink, bank statements feed the books, the built YouTube and social pieces reach real runs | every audit "built but not wired" item has a caller and a test through it |
| W3 Look | Ink v2 tokens, parts and every place (section 4), phone layout, Start gallery, Hindi for every string | UI tests per part and place, axe, contrast, word budgets, screenshots at 1280 and 390 in light and dark compared with the direction D mockups |
| W4 Features | Section 5.1 to 5.7 and the catalogue W4 rows | engine tests per module, contract tests, UI tests, a walk of each flow in the running app |
| W5 Playbooks | Section 5.8 and the catalogue W5 rows | each playbook validated, its checks tested, its judge baseline committed, its gallery tile live |

W1 and W2 touch the engine; W3 the UI; W4 and W5 both. Inside a wave, agents work in parallel on separate files and one integrator commits (the 21 Oct rule). The CI sharding and the no-skip rule hold.

## 8. Edge cases

| Case | Behaviour |
|---|---|
| CLI not installed, not signed in, or the hosted app | Your AI says which, in plain words; agents wait with "Connect your AI"; never a fake success |
| "From now on" while a run is active | The proposal waits; an accepted change applies from the next run, and the thread says so |
| Proposal made against an older playbook version | Refused as stale; the agent redrafts against the current version |
| Owner asks an agent to do something on the floor | It becomes a Today card; the chat says it needs approval |
| Chief quotes a figure with no receipt | Code labels it "model estimate" or strips it |
| Network import with a bad or huge file | Refused with the line number or size; nothing half-imported |
| Two people merge wrongly | Split from the person sheet; the merge is journalled |
| Warm path unconfirmed | Labelled "possible path, not confirmed" |
| Push permission denied | The bell still works; Notifications says push is off |
| One-department view with no agents | One sentence and a way to add the playbook that staffs it |
| Goal not set | The goal card asks for one with a suggested figure labelled "model estimate" |
| Hindi strings longer | Cards and chips wrap to two lines; no truncation of figures |
| Swipe on an irreversible item | The second ask still appears; swipe never decides money alone |
| Stop during an irreversible send | The send finishes or becomes "outcome unknown"; never resent |

## 9. Testing

- Engine: `node --test` per new module (`platform/tests/venture-*.test.ts`), contract tests for every new method, failing test first for every W1 fix.
- UI: vitest + testing-library per part and place, axe on every place and sheet, contrast tests for every token pair in both themes, text parity (every `en` key in `hi`), word budgets per place.
- Running app: the dev UI and Electron with the sample engine; screenshots at 1280 and 390 in light and dark, compared by eye with the direction D canvas.
- CI: the six verify shards and the ui job stay green; no skipped tests.

## 10. Open questions

- Current-year TDS and income-tax rate tables need a CA's confirmation before they leave rehearsal.
- Hindi strings need a native reviewer.
- Platform API rows (marketplaces, social) in the catalogue were written from memory; each is checked before its connector is built.
- Spend limits: wave 1 takes them in US dollars, the currency the AI providers bill and the spend ledger counts, because Chausar has no exchange rate it could honestly use. A rupee view needs a rupees-per-dollar rate the owner enters and confirms (founder to decide; wave 4 if wanted).
- Reverse engineering: two products need it (Player-1, whose code is not released yet, and the hosted Nexscope app). The REA tool did not connect in this session; the Nexscope pass runs when it does, and its findings join wave 5.
