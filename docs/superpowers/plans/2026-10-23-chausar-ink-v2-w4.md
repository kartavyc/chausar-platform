# Plan: Chausar Ink v2, wave 4 (new features)

## Goal

Build spec sections 5.1 to 5.7 and the 117 catalogue rows tagged W4, so that every place the direction D boards draw has real engine data behind it: departments and Keeper; agent chat with notes, standing orders and versioned instruction changes; Chats with Chausar as chief of staff; the owner's own network, warm paths, the pipeline and drafted handoffs; run controls and breakers; notifications and phone push; the owner's own AI with an honest CLI status; goals; and the rest of the W4 rows (approvals, money views, connectors, the Start gallery list, harness and quality). Every item wave 3 left as "placeholder until W4" gets its data here (coverage table B).

Inputs: the spec `docs/superpowers/designs/2026-10-23-chausar-ink-v2.md` (sections 3, 5.1 to 5.7, 6, 8), the master plan `docs/superpowers/plans/2026-10-23-chausar-ink-v2.md` ("How every wave runs"), the wave 2 and wave 3 plans (`...-w2.md`, `...-w3.md`; W3's "What only W4 provides, by place"), the catalogue `docs/research/harvest/cards2/CATALOGUE.md` (rows tagged W4), the cards `cards2/happenstance.md` and `cards2/harness-a.md`, and the direction D boards (in the repo at `docs/superpowers/designs/ink-v2-direction-d/` once W3's 3-0 copies them): `D-TeamChat`, `D-Chats`, `D-Clients`, `D-Network`, `D-Money`, `D-Team`, `D-TeamDept`, `D-Start`, `D-Today`, `D-Work`, `D-STYLE.md`.

Paths below are relative to `platform/runtime/venture/` unless they start with `app/`, `platform/`, `scripts/` or `docs/`.


## Added 23 Oct from wave 2 (2E2)

- Done in wave 2 (2E2 review follow-up): the whisper.cpp setup is stored as a record, configured at start, set from Connections > Your AI, and shown in `venture.connectors.list`. 4H only needs to show it beside the CLI status.
- Founder decisions of 23 Oct: closed-business summaries (4J6) are kept, encrypted with this computer's key; the goal counts invoices before tax; "simple first" applies to every new screen (advanced detail one step away; no GST fields for businesses not registered for GST).

## Two kinds of package, and running beside wave 3

Every package below is marked **E** (engine-only) or **U** (needs wave 3's parts and places first).

- **E packages** change only `platform/`, `scripts/`, `app/desktop/`, `app/ui/src/engine/*` (types and fake desks) and one new file `app/ui/public/sw.js`. Wave 3 changes none of these (its plan: "src/engine/*: nobody"; W3 touches no engine file). So E packages run in the same checkout while wave 3's UI agents work, once wave 2 is committed.
- **U packages** change `app/ui/src/places`, `shell`, `parts` usage and the text files. They start after wave 3 is committed and `b2c/ink-v2-w4` is cut from it, because they edit the places W3 rewrites and use W3's parts (Avatar, Tile, StatTile, Segmented, FilterChips, ProgressRing and Bar, the charts, StoriesRow, PreviewFrame, Gallery, PathLine, StrengthDots, Board, NotificationBell, Composer, ChatThread, DiffCard, the card layout of ApprovalRow, Sheet at panel width, Figure and Count, `states.ts`).
- Commit discipline while both waves share the checkout: W3's integrator stages only W3 paths (never `platform/`, `app/desktop/`, `app/ui/src/engine/`, `app/ui/public/sw.js`). W4's E work stays uncommitted until W3's last commit, then `b2c/ink-v2-w4` is cut and the integrator commits it there. W3's final checks (typecheck, the six bench shards) run only at a point where every running E package is green (its own tests pass, `npm run typecheck` clean); if one is mid-way, W3's integrator waits for it. Agents never commit, stash or switch branches (master plan).

## Founder decisions that bind W4, and where each is held

| Decision | Held by | Test that holds it |
|---|---|---|
| Departments fixed: Sales and clients, Marketing, Production, Money, Operations; Keeper shows the engine's real jobs as code, not AI | 4A1, 4A2 | `venture-departments.test.ts` (every flagship role maps to one of five), `venture-keeper.test.ts` (Keeper is `kind: 'code'`, no chat, jobs from records) |
| Agent chat from a quiet Chat button on Team | 4B3 | `team-chat.test.tsx`: the Chat button is `variant="chat"` with "Chat with {name}" and opens the panel; nothing on Today |
| "From now on" detected by code in English and Hindi, becomes a typed playbook patch the owner accepts, versioned, undo; floor and tool grants never editable that way | 4B1 | `venture-agent-standing.test.ts`, `venture-agent-versions.test.ts` (`PATCH_OWNER_OP` for tools, checks, limits) |
| Notes proposed only from the owner's own words | 4B2 | `venture-agent-notes.test.ts`: no note proposal from an agent message; each proposal quotes the owner |
| Chats: Chausar as chief of staff, propose-only; every spend, send or price change is a Today card; figures receipted or labelled model estimate | 4C1 | `venture-chief.test.ts`, `venture-chief-receipts.test.ts`, `venture-proposals.test.ts` |
| Network from the owner's own files only (LinkedIn export, contacts CSV or vCard, calendar ICS, mail headers) | 4D1 | `venture-network-import.test.ts`: only those five kinds; message text dropped; nothing fetched |
| Strength computed in code with a receipt; warm paths say "possible path, not confirmed" | 4D2 | `venture-network-strength.test.ts`, `venture-network-paths.test.ts` |
| Pipeline Found, Asked, Talking, Proposal, Won, Lost, Not now, forward only | 4E1 | `venture-pipeline.test.ts` (`PIPELINE_STAGE_BACKWARD`, `PIPELINE_STAGE_CLOSED`) |
| Follow-ups by date arithmetic on Today | 4E1 | `venture-followups.test.ts` |
| Drafts open in mail, LinkedIn or WhatsApp (wa.me); the owner taps "I sent it" | 4E2 | `venture-outreach.test.ts`: `venture.outreach.open` returns a handoff, never sends |
| Unsubscribe footer on cold outreach only | 4E2 | `venture-outreach.test.ts`: warm note to a tie of Know or better has no footer; cold email has both lines |
| DPDP: minimum data, Forget, opt-out list | 4D1, 4E2, 4E3 | `venture-network-forget.test.ts`, opt-out tests in `venture-inbound.test.ts` |
| Clients has three tabs Clients, Pipeline, Network | 4D4, 4E4 | `clients-network.test.tsx` flips W3's "no Network tab" test |
| Run controls Stop, Force stop, Resume, round gate, repeat-failure breaker | 4F1, 4F2 | `venture-run-controls.test.ts`, `venture-run-gate.test.ts`, `venture-breaker.test.ts` |
| Notification centre with quiet hours and digest; web push with a count only | 4G1, 4G3 | `venture-notify.test.ts`; `venture-webpush.test.ts` decrypts the payload and finds exactly `{"count":3}` |
| AI paid by the owner (own key, or Codex or Claude Code CLI on desktop, status checked honestly) | 4H1 | `venture-cli-status.test.ts`: never "signed in" without evidence |
| Goals: money invoiced this month toward a goal | 4I1 | `venture-goals.test.ts` |
| Spend in rupees at the owner's rate (W1 built it) | 4A1, 4J4 | department spend and money flow use `rupeesOf` and `rupeeFigure` (`money/spend.ts`), labelled with the rate |
| Auto with spot checks built but locked | 4J15 | `venture-auto-gate.test.ts`: every readiness check can pass and the stage still answers `AUTO_LOCKED` |
| Full Hindi | every U package, 4B1, 4B2, 4E3, 4J16, 4J17, 4Z | text parity (`tests/text.test.ts`), Hindi detector tests, `hi-review.json` lists every W4 key |

## Coverage A: every W4 catalogue row and its package

| Row | Package | Row | Package | Row | Package |
|---|---|---|---|---|---|
| H22 repeat-failure breaker | 4F2 | Q4 quote at location | 4J16 | A1 Chats, chief of staff | 4C1, 4C2 |
| H23 step edges, caps, timeouts | 4J12 | Q5 facts in, rating out | 4J16 | A2 agent chat, peek, one waiting place | 4B1, 4B3 |
| H24 per-order contract | 4J12 | Q6 coverage that can't be faked | 4J14 | A3 "from now on" patches, versions, undo | 4B1, 4B3 |
| H25 agent-to-agent rules | 4J12 | Q7 one vocabulary of verdict words | 4J14, 4J22a | A4 standing orders | 4B1 (list), 4B2 (assembled into runs) |
| H26 hash-chained journal, signed receipts | 4J10 | Q8 outcome words, three columns | 4J14 | A5 notes: read, correct, forget, undo | 4B2 |
| H27 journal end states | 4J10 | Q9 guardrail drills | 4J15 | A6 note proposals from owner words | 4B2 |
| H28 journalled-action extras | 4J10 | Q10 auto gate (locked) | 4J15 | A7 Recalled chip | 4B2, 4B3 |
| H29 context hygiene | 4J11 | Q11 shadow summary | 4J15 | A8 business voice | 4J17 |
| H30 background report-back | 4J13 | Q12 with and without lift | 4J15 | A9 persona fields, Test | 4J17 |
| H31 execution places | 4J11 | Q13 judge calibration | 4J15 | A10 what the AI knows | 4J18 |
| H32 daily write caps | 4F2 | Q14 trace scan before judges | 4J15 | A11 ideas, who waits on you | 4J18 |
| H33 mock providers, typed mock tools | 4J11 | Q15 learning from corrections | 4J16 | A12 routines | 4J13 |
| H34 lease work queue, resumable steps | 4J13 | Q16 experiment record | 4J16 | A13 timed questions | 4J13 |
| H35 one repair turn, repair ladder | 4F2 | Q17 second reviewer | 4J15 | A14 questions done well | 4J17 |
| H36 record the model that answered | 4H1 | Q18 guidance lines tied to checks | 4J16 | A15 one message wakes one agent | 4C1 |
| H38 method hints and parity | 4J10 | Q19 research evidence rules | 4J16 | A16 describe an agent, capability page | 4J18 (see Not placed) |
| H39 text-only calls on the owner's CLI | 4H1 | Q20 writing checks, English and Hindi | 4J16 | A17 Delivered card | 4J3 |
| | | Q21 computed fallback | 4J14 | A18 skills, starters, export | 4J17 |
| | | Q22 decide-first schema | 4J14 | A20 agent health | 4A1, 4A2 |
| | | Q23 preference sliders | 4J14 | | |

| Row | Package | Row | Package | Row | Package |
|---|---|---|---|---|---|
| O1 Stop in two steps, Resume | 4F1, 4F3 | M2 plan model | 4H1, 4F2 (parts that survive; credits are a spec non-goal) | C2 network import | 4D1 |
| O2 owner gate after each round | 4F1 | M3 plan and credits page | 4F2, 4J20 (meters and the "limit reached" sheet; no credits) | C3 relationship strength | 4D2 |
| O3 steer box | 4F1, 4F3 | M4 budget meter and threshold | 4F2 | C4 warm paths | 4D2 |
| O4 pause all, stop all, Away | 4F1, 4F3 | M5 under budget pressure | 4F2 | C5 plain-English search | 4D3 |
| O5 send back with words | 4J2, 4J19 | M6 rate honesty | 4F2 | C6 pipeline board | 4E1, 4E4 |
| O6 edit and undo | 4J2, 4J19 | M7 which wallet pays | 4F2 | C7 follow-ups by code | 4E1 |
| O9 set approval | 4J2, 4J19 | M8 cost and margin per client | 4J4 | C8 drafts the owner sends | 4E2 |
| O10 needs-you probes | 4G2 | M10 purchases and bills | 4J5 | C9 privacy for people data | 4D1, 4E2 |
| O11 one approval in three places, standalone page | 4G4 | M11 payments and credits | 4J5 | C10 lead states and read-backs | 4E3, 4J6 (shared never-contact list) |
| O12 notification centre | 4G1, 4G4 | M12 recurring invoices, reminders | 4J5, 4E2 (handoff) | C11 reply triage in code | 4E3, 4E2 (advisory lints) |
| O13 reach the phone | 4G3 | M13 four figure kinds | 4J4 | C12 lead score | 4E1 |
| O14 failure sentences by kind | 4F2 | M14 totals that say how made | 4J4 | C13 every lead names its trigger | 4E1 |
| O17 decision record | 4J1 | M15 Indian invoice tax kinds | 4J5 | C14 send governor | 4E2 |
| O18 owner-written triage rule | 4J2 | M17 client "what you owe us" page | 4J5 (data), 4J7 (page) | C15 inbound mail matched | 4E3 |
| O20 share link states | 4J7 | M19 per-role model choice | 4H1 | C16 per-lead timeline | 4E1 |
| O21 run scope line | 4F1 | | | C17 after a call | 4E3 |
| O25 hosted trial | 4J23 | | | C18 saved searches, job changes | 4D3 |
| | | | | C19 "Before you write" | 4D3 |
| | | | | C20 footer rule split | 4E2 |
| | | | | C21 excluded services | 4J9 (profile), 4E2 (check) |
| | | | | C22 import clients and history | 4D1 (the Check and Undo pattern, for network files only); clients and history import: see "Not placed" |

| Row | Package |
|---|---|
| K6 connector truth ladder | 4J7 |
| K7 check connections | 4J7 (Keeper job read by 4A1) |
| K8 read-only mailbox | 4E3 |
| K9 client file-request link | 4J7 |
| K18 report links verbatim, keys never in chat | 4J7, 4C1 (`CHAT_KEY_REFUSED`) |
| P12 export hygiene | 4J4 |
| CA8 NEEDS_FACTS loop | 4J16 |
| J2 approval bound to file bytes | 4J1 |

Count: 2.1 has 17, 2.2 has 20, 2.3 has 19, 2.4 has 17, 2.5 has 15, 2.6 has 21, 2.7 has 5, 2.9 has 3: 117.

## Coverage B: what wave 3 left for W4, by place

| W3 place | Data W3 could not draw | Package |
|---|---|---|
| Rail and header | Chats item and its "New" chip; Ask Chausar box and Ctrl K; bell with count | 4C1, 4C2; 4G1, 4G4 |
| Today | goal progress, pace, days left, ready to issue, still to invoice, received so far, next best step; ranking by money at stake then deadline | 4I1, 4I2 |
| Today | department of each agent (tints, badges, department chips); helpers nested under parents | 4A1, 4A2; 4J12 sets `parentId` |
| Today | Chausar story and "Ask anything" | 4C2 |
| Today | card previews: video poster, duration, chapters, check counts, invoice paper lines, post text with counts, title choices with estimates | 4J3, 4J19 |
| Today | row meta: client, expiry, "Sends to the client", attempt and last error, change count line, price beside Approve | 4J1, 4J19 |
| Today | Stop on running rows | 4F1, 4F3 |
| Today | the owner's first name in the greeting | 4J9, 4J21 |
| Team | departments, their summaries (working, waiting, done this week, spend this month, jobs this week), the toggle and `?dept=`, one-department view, 6-week spend and jobs series, "Add an agent", Keeper's jobs, held spend | 4A1, 4A2 |
| Team | Chat button, Chat tab, instructions version, standing orders, "set by" line | 4B1, 4B3; 4A1 (`postureSetBy`) |
| Work | Stop, Force stop, Resume, breaker words, "Run again keeps step 1", "How to fix it" | 4F1, 4F2, 4F3 |
| Work | order stage steps and "2 wait on you" | 4J3, 4J19 |
| Work | frames on run tiles; per-call progress | 4J3; 4F1 (`run.call`) |
| Work | runs across businesses when one is locked | 4J6 |
| Clients | Network tab, search, imports, warm paths, "Import contacts" | 4D1 to 4D4 |
| Clients | pipeline stages Found to Not now, strength dots, path lines, follow-up dates, drafted handoffs, four stat tiles, "Due today and late", "How people moved" | 4E1, 4E2, 4E4 |
| Money | goal on the invoiced tile | 4I1, 4I2 |
| Money | aging in five buckets, in and out by month, 13-week cash with assumptions, costs in the next three weeks, lateness words, last month's comparison, month picker, Export for your CA | 4J4, 4J20 |
| Money | money across businesses with business chips | 4J6, 4J20 |
| Money | spend by department and the held amount | 4A1, 4A2 |
| Money | reminder drafts ("Draft 3 reminders") | 4J5 (drafts), 4E2 (handoff), 4J20 |
| Connections | CLI found on this computer with version and sign-in state | 4H1, 4H2 |
| Connections | least-privilege setup guides, "Sends: nothing" lines | 4J7, 4J21 |
| Connections | "Your network" source cards | 4D1, 4D4 |
| Business | Goals page; Notifications page; setup checklist item names; accountant invite | 4I2; 4G4; 4J8, 4J21; 4J7 (read-only books link) |
| Start | the list of ways to earn (hours, AI team, price ranges labelled model estimate); "Good fit for you"; "Ask Chausar"; the business picker and file drop | 4J8, 4J21; 4C1, 4C2 |
| Phone | Chats tab; bell; business name in the hosted manifest | 4C2; 4G4; 4J9 |
| W3 rows | U5 series, U6 estimates after three runs, U7 call stream, U8 previews, U17 "names the engine that wrote it", U18 permission walkthrough, U20 sequenced stream with gap replay, O15 system-line grammar, O16 "set by", O22 autosave, O23 tray, K10 CLI detection, K11 guides, M9 buckets | 4A1 and 4J4; 4F1; 4F1; 4J3; 4H1; 4G4; 4G1 and 4G4; 4J1; 4A1 and 4B3; 4J2 and 4J21; 4G3; 4H1 and 4H2; 4J7 and 4J21; 4J4 and 4J20 |

## Coverage C: spec sections

5.1 departments: 4A1, 4A2. 5.2 agent chat, notes, instruction changes: 4B1, 4B2, 4B3. 5.3 models: 4H1, 4H2. 5.4 Chats: 4C1, 4C2. 5.5 network, pipeline, outreach: 4D1 to 4D4, 4E1 to 4E4. 5.6 run controls, breakers: 4F1 to 4F3 (the taint latch and the spend reserve were W1's 1E and 1C). 5.7 notifications: 4G1 to 4G4. Section 6 methods: 4-0 names every one. Section 8 edge cases: each is a failing test in the package named beside it in the package text (search for "spec 8").

## Shared files and sequencing

4-0 removes most collisions by adding every name, every row hook and every handler stub first. After it, these files are still touched by more than one package; each package changes only its own function, with small Edit calls, re-reading first.

| File | Packages | How they share it |
|---|---|---|
| `contracts.ts`, `platform/runtime/engine.ts`, `host.ts` (loaders), `app/desktop/ipc-contract.cjs` and `.d.cts`, `app/ui/src/engine/types.ts`, `app/ui/src/engine/fake.ts`, `views/queue.ts` | 4-0 only | Packages add only what 4-0 missed, one small edit each, and say so in their report |
| `delivery/harness/loop.ts` | 4B2 (`actTask` input: notes), 4F1 (`applyTurn` stop check, `settle` gate), 4F2 (one breaker call in `applyTurn`), 4J7 (`actTask` input: capability list), 4J11 (`compactHistory`), 4J13 (timed questions in `answerHandoff`), 4J17 (`actTask` input: persona) | 4F1 before 4F2 and 4J13; each `actTask` field is one small Edit, landed in the order 4B2, 4J7, 4J17, one at a time |
| `delivery/runs.ts` | 4F1 (`approveHarnessTurn` stop and lease), 4J1 (`deliveryReviewHandler` file manifest), 4J2 (`deliveryFixHandler`, new), 4J13 (lease expiry) | 4F1 before 4J13; the others edit their own function |
| `views/team.ts` | 4A1; then one line each from 4J1 (repeated denials into health), 4J12 (`parentId`), 4J15 (`autoLocked` in `teamPostureHandler`) | 4A1 first, then in that order |
| `views/runs.ts` | 4F1 (stopping words, scope, estimates), 4J3 (delivered card), 4J14 (verdict words, coverage) | 4F1 first; own functions |
| `money/sums.ts` | 4-0 (subjects and `currentPlan` cases), then each plan in its owner's own file | No package edits sums.ts after 4-0 |
| `money/index.ts`, `build/index.ts`, `delivery/index.ts`, `views/index.ts`, `core/index.ts`, `models/index.ts` and the four new `index.ts` | 4-0 registers every method with `notBuiltYet` | Each package replaces its own lines |
| `money/spend.ts` | 4F2 only | |
| `models/port.ts`, `models/presets.ts` | 4H1 only | |
| `customers/leads.ts` | 4E1 (map leads in), then 4E2 (footer split in `draftOutreach`) | 4E1 first |
| `network/import.ts` | 4D1; then one line each from 4D2 (recompute), 4D3 (saved searches), 4E2 (accept detection) | 4D1 first |
| `build/share-links.ts` | 4J7 only (4J5 provides `clientStatement`) | |
| `delivery/harness/patches.ts` | 4B1 only (owner rules) | |
| `delivery/playbook.ts` | 4B1 (owner versions), then 4J12 (validation of edges) | 4B1 first |
| `app/desktop/main.cjs` | 4G3 only | |
| `platform/runtime/hosted/*` | 4G3 (VAPID keys in `config.ts`), 4J9 (manifest route), 4J7 (share upload route), 4J23 (trial routes) | 4J23 first; each its own route or setting |
| `app/ui/src/places/team/*` (with `AgentSheet.tsx`) | 4A2, 4B3, 4H2 (one line), 4J22a, 4J22b | In that order |
| `app/ui/src/parts/RunSheet.tsx` | 4F3 (steer, scope, estimates), 4G4 ("N things need you" banner), 4J19 (Delivered card), 4J22a (coverage, outcomes, expiry words) | One section each, in that order |
| `app/ui/src/places/onboarding/Start.tsx` | 4C2 (fit tile, Ask link), then 4J21 (gallery, picker, drop) | 4C2 first |
| `app/ui/src/places/today/*` | 4I2 (GoalCard, NextStep), 4F3 (Stop in Working now), 4C2 (Chausar story), 4J19 (previews, actions), 4E4 (follow-up and reply rows, meeting notes), 4J21 (greeting name), 4J22b (ideas, question cards) | Each its own component file; `index.tsx` one render line each; 4I2 first |
| `app/ui/src/places/clients/*` | 4D4 (`NetworkTab.tsx`, person sheet), 4E4 (`PipelineTab.tsx`, outreach sheet) | `index.tsx` tab list: 4D4 adds Network, 4E4 changes Pipeline; 4D4 first |
| `app/ui/src/places/money/*` | 4A2 (spend split), 4I2 (goal tile), 4J20 (the rest), 4J22a (the journal's chain line) | 4A2 and 4I2 before 4J20; 4J22a last |
| `app/ui/src/places/work/*` | 4F3 (controls), 4J19 (order steps), 4J21 (file request, share link states), 4J22a (contract sheet) | 4F3 first; new files each; `OrderFocus.tsx` and `OrderList.tsx` one line each |
| `app/ui/src/places/connections/*` | 4D4 (network cards), 4E4 (mailbox, calendar), 4H2 (Your AI), 4J21 (guides, checks) | One new file each; `index.tsx` one line each |
| `app/ui/src/places/business/*` | 4F3 (Away), 4G4 (Notifications), 4I2 (Goals), 4J19 (Decisions), 4J21 (Owner, checklist names), 4J22a (Practice additions, Routines), 4J22b (Voice, What the AI knows) | One new page each in `PAGES` |
| `app/ui/src/shell/*` | 4C2 (rail Chats, Ask box), 4G4 (bell), 4F3 (business menu: Pause all, Stop all, Away), 4J20 (business menu: Invite your accountant), 4J21 (trial banner) | 4C2 first; the business menu 4F3 then 4J20 |
| `app/ui/src/text/{en,hi}/*.json` | every U package | Each package uses its own key prefix, named in its text |

### Order of work

1. **4-0** (integrator, alone).
2. **Phase E1**, in parallel beside wave 3: 4A1, 4B1, 4D1, 4F1, 4G1, 4H1, 4I1, 4J1, 4J3, 4J5, 4J7, 4J8, 4J9, 4J10, 4J11, 4J14, 4J18, 4J23 (4J7's one `actTask` line waits for 4B2's).
3. **Phase E2**, each when the package it needs is in: 4B2, 4C1, 4J12 and 4J16 (after 4B1); 4D2 and 4E1 (after 4D1); 4F2 and 4J13 (after 4F1); 4G3 (after 4G1); 4J4 (after 4J5); 4J15 (after 4J11); 4J17 (after 4B2).
4. **Phase E3**: 4D3 (after 4D2), 4E2 (after 4E1 and 4J9), 4E3 (after 4E1), 4J6 (after 4J4), 4G2 (after 4G1, 4E3, 4F2 and 4J7, whose data its probes read).
5. Wave 3 merged; `b2c/ink-v2-w4` cut; E work committed (`feat(w4-engine): ...`, one commit per area).
6. **Phase U**, each after its E packages: 4A2, 4H2, 4I2, 4F3, 4G4 first (they touch the shell and Team, Today, Work, Business heads); then 4B3, 4C2, 4D4, 4J19, 4J21; then 4E4, 4J20, 4J22a, 4J22b.
7. **4Z** (walk, screenshots, Hindi review list).
8. Integrator: `npm run typecheck`, `npm run typecheck:ui`, `npm run test:ui`, `npm run build:ui`, `node scripts/bench.mjs` (six shards, in the background); commits; PR.

Package sizes: S about half a day for one agent, M one agent for a day, L one agent for two days or more.

## Package 4-0 (integrator, before agents start): names, seams and stubs

Size M. E. Mechanical: no behaviour, so no failing test of its own beyond the existing suite staying green.

1. `contracts.ts`:
   - `VenturePackageId` gains `'agents' | 'chief' | 'network' | 'notify'`; `host.ts` `PACKAGE_LOADERS` gains a literal dynamic import for each of `agents/index.ts`, `chief/index.ts`, `network/index.ts`, `notify/index.ts`. Each new `index.ts` exports `handlers` with a `notBuiltYet` stub (the W2 pattern in `views/index.ts`) for every method its package owns.
   - `VENTURE_RECORD_KINDS`, `ID_PREFIX`, `AnyVentureRecord` gain: `venture-keeper-run` (4A1); `venture-agent-message`, `venture-agent-proposal`, `venture-chat-consent` (4B1); `venture-agent-note`, `venture-agent-note-change` (4B2); `venture-chief-thread`, `venture-chief-message`, `venture-proposal` (4C1); `venture-person`, `venture-network-import`, `venture-forgotten` (4D1); `venture-tie` (4D2); `venture-network-search` (4D3); `venture-opportunity`, `venture-pipeline-settings` (4E1); `venture-outreach` (4E2); `venture-mailbox`, `venture-inbound` (4E3); `venture-away` (4F1); `venture-notification`, `venture-notify-settings` (4G1); `venture-push-subscription` (4G3); `venture-cli-check` (4H1); `venture-goal` (4I1); `venture-decision` (4J1); `venture-draft-edit`, `venture-triage-rule`, `venture-settings-draft` (4J2); `venture-bill`, `venture-credit-note`, `venture-recurring-invoice` (4J5); `venture-connector-check`, `venture-file-request` (4J7); `venture-owner-profile` (4J9); `venture-signing-key` (4J10); `venture-order-contract` (4J12); `venture-routine`, `venture-routine-run` (4J13); `venture-drill-run` (4J15); `venture-voice`, `venture-persona` (4J17); `venture-knowledge`, `venture-idea` (4J18). Each record type is declared with the fields its package text names.
   - `VENTURE_EVENTS` gains `agent.message`, `chief.message`, `proposal.created`, `notify.new`, `pipeline.changed`, `run.stopped`, `run.call`, `keeper.ran`; `VentureRunEventType` and `VENTURE_RUN_EVENT_TYPES` gain the same, and `VentureRunEvent` gains optional `seq` (4G1) and `count` (on `notify.new` only). A frame never carries words, names or figures.
   - `QueueKind` gains `'proposal' | 'followup' | 'reply' | 'notice'`; `QueueActionId` gains `'sent' | 'continue' | 'stop' | 'resume'`; `QueueRow` gains optional `meta`, `sendsTo`, `attempt`, `counts`, `price`, `changeCount` (4J1) and `preview` (4J3).
   - `DeliveryRunStatus` gains `'stopped'`. `HarnessState` gains optional `control`, `alreadyTried`, `steer`, `gate`, `repairs`; `AgentTurnRecord` gains optional `recalled` (note ids) and `role`.
   - `AgentView` gains optional `department`, `kind: 'agent' | 'code'`, `state: 'working' | 'waiting' | 'failed' | 'idle'`, `health`, `parentId`, `postureSetBy`, `chat`; `venture.team.list`'s result gains `departments`.
   - `PlaybookPatch.proposedBy` gains `'owner'` and optional `source: { messageId: string; quote: string }`; `PlaybookRecord.origin` gains `'owner'`; `PlaybookStep` gains optional `optional`, `next`, `maxLoops`, `onExceeded`, `timeoutMs`, `failover` (4J12 validates them; nothing ships with them in W4).
   - `SumReceiptSubject` gains `spent-department`, `invoiced`, `goal`, `aging`, `flow`, `cash`, `margin` and `count` (`what: 'funnel' | 'bands' | 'jobs'`); `SumReceiptRecord.unit` gains `'count'`. `money/sums.ts` `currentPlan` gains one case per subject, each calling a plan function in its owner's file (stubbed with `NOT_BUILT_YET` until filled), so no package edits `sums.ts` later.
   - `VENTURE_METHODS`, `METHOD_OWNERS`, `APP_ONLY_METHODS`, `VenturePayloads`, `VentureResults`, and `PRE_VAULT_METHODS` (`venture.playbooks.list` only): every method below, with its owner, level and app-only flag.

   | Package | Methods: (owner) level; "app" marks app only |
   |---|---|
   | 4A1 | `venture.team.keeper {}` (views) read; `venture.team.clearQuarantine {agentId, digest}` (views) approve, app |
   | 4B1 | `venture.agents.thread.list {agent, before?}` read; `venture.agents.thread.send {agent, text}` prepare, app; `venture.agents.proposal.decide {id, digest, decision}` approve, app; `venture.agents.version.undo {agent, digest}` approve, app; `venture.agents.orders.list {agent}` read; `venture.chats.consent {digest}` approve, app (all agents) |
   | 4B2 | `venture.agents.notes.list {agent}` read; `.edit {agent, noteId?, text, basedOn?}`, `.forget {agent, noteId}`, `.undo {agent, changeId}` approve, app (agents) |
   | 4C1 | `venture.chief.threads {}` read; `venture.chief.thread.list {threadId, before?}` read; `venture.chief.thread.send {threadId?, text}` prepare, app; `venture.chief.thread.pin {threadId, pinned}` prepare, app; `venture.chief.fit {}` prepare; `venture.proposals.raise {id}`, `venture.proposals.dismiss {id}` prepare, app (chief) |
   | 4D1 | `venture.network.import {kind, name, text, check?}`, `.importUndo {importId}`, `.merge {a, b}`, `.split {personId, sourceIds}`, `.forget {id}` approve, app; `.hide {personId, hidden}` prepare, app; `.people {query?, hidden?}`, `.person {id}`, `.sources {}` read (network) |
   | 4D2 | `venture.network.recompute {}` prepare; `venture.network.know {personId, how, note?}`, `venture.network.link {a, b, note}` prepare, app (network) |
   | 4D3 | `venture.network.search {text, web?}`, `.searchMore {searchId}`, `.saveSearch {searchId, name}`, `.research {personId}` prepare, app (network) |
   | 4E1 | `venture.pipeline.list {filter?}`, `.followups {}` read; `.add {personId, trigger}`, `.setNext {id, text, due}` prepare, app; `.move {id, stage, reason?, evidence?}`, `.settings {weekdays?, sendTime?, caps?, scoreRules?}` approve, app (network) |
   | 4E2 | `venture.outreach.draft {opportunityId, kind, channel}` prepare, app; `venture.outreach.open {draftId}` read, app; `venture.outreach.sent {draftId, at, channel}`, `venture.outreach.restricted {channel}` approve, app (network) |
   | 4E3 | `venture.mailbox.connect {host, port, user, appPassword}`, `.disconnect {}` approve, app; `venture.mailbox.sync {}` prepare; `venture.inbound.list {}` read; `venture.inbound.confirm {id, opportunityId}` approve, app; `venture.network.calendar {url}` approve, app; `venture.meeting.digest {eventId?, notes}` prepare, app (network) |
   | 4F1 | `venture.runs.stop {runId, force?}`, `.resume {runId}`, `.roundGate {runId, on, every?}` approve, app; `venture.runs.steer {runId, text}` prepare, app; `venture.business.pause {paused, stopRunning?}`, `venture.away.set {from, to}` approve, app; `venture.away.get {}` read (views) |
   | 4F2 | `venture.runs.allowWrites {kind}` (views) approve, app |
   | 4G1 | `venture.notify.list {}` read; `venture.notify.read {ids?, all?}` prepare; `venture.notify.settings {...}` approve, app (notify) |
   | 4G3 | `venture.notify.push.key {}` read; `venture.notify.push.subscribe {subscription}`, `.push.unsubscribe {endpoint}`, `venture.notify.relay {url}` approve, app (notify) |
   | 4H1 | `venture.models.cli.status {}`, `venture.models.roles {}` read (models) |
   | 4I1 | `venture.goals.get {month?}` read; `venture.goals.set {month, amountMinor}` approve, app; `venture.goals.suggest {month}` prepare (money) |
   | 4J1 | `venture.decisions.list {}` read; `venture.policy.allowSession {stepId}` approve, app (views) |
   | 4J2 | `venture.queue.sendBack {rowId, digest, text}`, `.edit {rowId, digest, text}`, `.undo {rowId}`, `.set {rowIds, digest}`, `venture.triage.set {rule, digest}` approve, app; `venture.triage.preview {text}` prepare (views); `venture.delivery.fix {runId, checks}`, `venture.delivery.decideChange {runId, changeId, accept}` approve, app; `venture.delivery.changes {runId}` read (delivery); `venture.settings.draft {form, values}` prepare, `venture.settings.drafts {}` read (core) |
   | 4J3 | `venture.files.poster {uploadId}` (delivery) prepare, app |
   | 4J4 | `venture.money.aging {asOf?}`, `.flow {months?}`, `.cash {}`, `.margins {month}` read; `venture.money.export {month}` approve, app (money) |
   | 4J5 | `venture.bills.add`, `venture.bills.pay`, `venture.credit.issue`, `venture.invoice.recurring`, `venture.payment.clear` approve, app; `venture.bills.list`, `venture.invoice.recurringList` read; `venture.invoice.remind {invoiceId}` prepare, app (money) |
   | 4J6 | `venture.money.across {}` (money) read; `venture.runs.across {}` (views) read |
   | 4J7 | `venture.connectors.check {}` prepare; `venture.share.request {orderId, note?}` approve, app (build) |
   | 4J8 | `venture.playbooks.list {}` (core) read, pre-vault |
   | 4J9 | `venture.owner.get {}` read; `venture.owner.set {firstName?, excludedServices?}` approve, app (core) |
   | 4J10 | `venture.receipt.verify {id}` (money) read; `venture.journal.chain {}` (views) read |
   | 4J12 | `venture.order.contract {orderId}` read; `.contract.propose {orderId, contract}` prepare; `.contract.sign {orderId, digest}` approve, app (money) |
   | 4J13 | `venture.routines.list {}`, `.runs {id}` read; `.set {routine}`, `.remove {id}` approve, app (agents) |
   | 4J14 | `venture.options.rerank {questionId, weights}` (delivery) read |
   | 4J15 | `venture.drills.run {}` prepare, app; `venture.drills.list {}` read (delivery); `venture.auto.readiness {agent}`, `venture.shadow.summary {agent}` (views) read |
   | 4J16 | `venture.playbook.guidance {}` (delivery) read |
   | 4J17 | `venture.voice.get {}` read; `.set {voice}` approve, app; `.learn {samples}` prepare, app; `venture.persona.get {agent}` read; `.set {agent, persona}` approve, app; `.test {agent, persona}` prepare, app; `venture.agents.export {agent}` read; `venture.agents.import {text}` prepare, app (agents) |
   | 4J18 | `venture.knowledge.list {}`, `venture.ideas.list {}`, `venture.agents.capabilities {agent}` read; `venture.knowledge.add {source}`, `.remove {id}`, `.test {question}`, `venture.ideas.start {id}`, `venture.ideas.dismiss {id}` prepare, app (agents) |

2. `views/queue.ts`: one call each to row sources in new files, each returning `[]` until its package fills it: `proposalRows` (`chief/rows.ts`, 4C1), `followupRows` (`network/followup-rows.ts`, 4E1), `replyRows` (`network/inbound-rows.ts`, 4E3), `noticeRows` (`views/probes.ts`, 4G2), `runControlRows` (`delivery/run-control-rows.ts`, 4F1); `RANK` entries for the four new kinds; `queueDecideHandler` sends the new kinds and the new action ids to `decideW4Row` in new `views/queue-w4.ts` (one stubbed function per kind and action); after rows are built, `withMeta(state, rows, now)` from new `views/row-meta.ts` (4J1) and `withPreviews(state, rows)` from new `views/previews.ts` (4J3), both identity until filled. After 4-0, no package edits `queue.ts`.
3. Storage helpers, record writes only, so that later packages can run side by side: `agents/store.ts` `appendAgentMessage(tx, input)`; `chief/store.ts` `appendChiefMessage(tx, input)` and `draftProposal(tx, input)`; `network/store.ts` `personById(state, id)` and `listPeople(state, ventureId)`.
4. `platform/runtime/engine.ts` case lines; `app/desktop/ipc-contract.cjs` and `.d.cts` (every method, plus the channels `network:pickMailExport` for 4D1 and `notify:count` for 4G3); `app/ui/src/engine/types.ts` (method map entries and every view type the packages name); `app/ui/src/engine/fake.ts` registers empty desks from new files `fake-agents.ts` (4B3), `fake-chief.ts` (4C2), `fake-network.ts` (4D4, 4E4), `fake-notify.ts` (4G4), `fake-w4.ts` (4A2, 4F3, 4H2, 4I2, 4J19 to 4J22b).
5. Run `npm run typecheck` and the contract tests (`platform/tests/venture-contracts.test.ts`, `desktop-ipc-methods.test.ts`, `app/ui/tests/engine/ipc-allowlist.test.ts`, `app/ui/tests/engine/fake.test.ts`); they pass before any agent starts. The change waits uncommitted with the other E work until `b2c/ink-v2-w4` exists, then commits as `chore(w4): names and seams for wave 4`.

---

## 4A: departments and Keeper

### Package 4A1: departments, Keeper and agent health (E)

Size M. Rows: A20, O16 ("set by"); spec 5.1; W3's Team, Today and Money department data.

**Files:** new `playbooks/departments.ts`, `views/keeper.ts`, `views/health.ts`, `views/team-series.ts`, `money/department-spend.ts` (the `spent-department` and `count/jobs` plans); `views/team.ts`; `views/index.ts` (two lines); `build/journal-sweep.ts` (writes the Keeper run); `contracts.ts` `VentureWorkspacePort` gains `backups()` (engine.ts provides it from the custody view; one line each); tests `platform/tests/venture-departments.test.ts`, `venture-keeper.test.ts`, `venture-agent-health.test.ts` (new), `venture-views-team.test.ts` (updated).

**Failing tests first:**

1. `DEPARTMENTS` is exactly `sales`, `marketing`, `production`, `money`, `operations` with the words "Sales and clients", "Marketing", "Production", "Money", "Operations". `validateDepartments()` passes for the three flagships: every role id in `flagshipDelivery(...).roles` has exactly one department (YouTube: intake clerk and story editor Production, packager Marketing, producer Sales and clients, the code role Production; CA firm: intake clerk Sales and clients, tax preparer, reconciler and working papers writer Money, auditor Operations; social: intake Sales and clients, strategist, writer and analyst Marketing, creative Production, checker and the code role Operations). A fixture playbook with a role missing from the map fails with `DEPARTMENT_MISSING` naming the role. The eight fixed steps' one agent takes its department from the service type (`bookkeeping` Money; `agency` and `content` Marketing; `support` Sales and clients; `studio`, `consulting`, `research`, `other` Production).
2. `venture.team.list {}` on a YouTube business: each agent has `department`, `kind` (`code` for the code role and for Keeper), `state` derived from facts only (working when a run is active on a step it owns, waiting when that run waits on the owner, failed when its latest run failed, idle otherwise), `postureSetBy: 'business' | 'agent'` (agent when a `venture-agent-posture` record exists). Keeper (`id: 'keeper'`, `kind: 'code'`, department `operations`, `steps: []`, `chat: false`) is listed last once a plan is accepted (before that the team is empty, Keeper included; its jobs are always on `venture.team.keeper`). `departments` lists all five with `working`, `waiting`, `stopped`, `idle` counts, `doneThisWeek` (runs that reached ready-for-review or later and rehearsal runs that finished, in the owner's local week from `local-day.ts`; Keeper's job runs show only on its card), `spendThisMonth` and the 6-week `series`; `totals` gives the team's jobs this week and this month's spend (Money's own figure and receipt, which the departments and the shared part add up to exactly).
3. Spend by department: a YouTube run whose first act turn calls `youtube.hooks` (held only by the packager's step) settles a spend record; that cost lands in Marketing's `spendThisMonth`, a sum receipt with subject `spent-department` listing the spend record. A turn whose tools are held by more than one role's steps (only `files.read`) and whose run position names no single role lands in "Shared by the team" with its own receipt, never split by guess. With the owner's rupee rate set the figures show rupees beside dollars labelled with the rate (`rupeeFigure`); open reservations show as "plus ₹18.00 held for running work".
4. The 6-week series per department: `jobs` and spend per local week, each point with `permille` scaled in code to the largest week (integer division), a week with no data `valuePermille: null` (never 0), a receipt per week.
5. `venture.team.keeper {}` lists jobs `backups`, `journal-sweep`, `connection-checks`, `rule-freshness`, `rate-tables`, `posting-steps`, `network-strength`, each with `lastRun: { at, outcome: 'ok' | 'warn' | 'failed', line } | null` from records only: backups from the workspace port (`null` with "Not on the hosted app" there); the journal sweep from the `venture-keeper-run` that `build/journal-sweep.ts` now writes (one record per job, replaced each run, `keeper.ran` emitted); rule freshness from W2 2H's rules (the stale count); rate tables from `venture.ca.get` pending rates; posting steps from W2 2B2's oldest `checkedOn`; connection checks and network strength say "Not run yet" until 4J7 and 4D2 write their runs. Nothing claims a run that has no record.
6. Health (A20, `views/health.ts`), in code: 2 failed runs in a row is `failing`, 3 is `quarantined`; a proposed outside action no step of that role declares (a harness mock or journal entry whose tool is not in its steps' tools) is `quarantined`; more than half of at least 4 reviewed outputs rejected or edited is `degraded` with "The playbook is producing work people don't want. Revise it."; more than 10 rows waiting on the agent, or one older than 7 days, is `degraded`. Each has one plain reason. A quarantined agent's next `venture.delivery.run` is refused `AGENT_QUARANTINED`; `venture.team.clearQuarantine {agentId, digest}` (app only) clears it with the health digest the owner saw (`APPROVAL_STALE` otherwise).

**Implementation notes.** `flagshipDelivery`, `roleOf`, `roles` (`playbooks/steps.ts`); `agentViews`, `nowFor`, `spendOf` (`views/team.ts`); `deliveryRunDetails`, `positionOf` (`views/runs.ts`); `spendAgentOf`, `spendOfMonth`, `rupeesOf`, `rupeeFigure` (`money/spend.ts`); `sumReceipt`, `planTotal` (`money/sums.ts`); `localDayAt`, `ownerToday` (`local-day.ts`). A turn belongs to the role of its most specific tool (a tool held by exactly one role's steps), else to the one role that owns the step kind `positionOf` names, else to "Shared".

**UI pieces:** none (4A2). Feeds D-Team, D-TeamDept, D-Today stories, D-Money spend tile.

**Done when:** `node --test platform/tests/venture-departments.test.ts platform/tests/venture-keeper.test.ts platform/tests/venture-agent-health.test.ts platform/tests/venture-views-team.test.ts` shows `# fail 0`.

### Package 4A2: Team departments, Keeper and health on screen (U)

Size M. After 4A1 and W3's 3D, 3C, 3F.

**Files:** `app/ui/src/places/team/index.tsx`, `TeamStats.tsx`, `DepartmentPanel.tsx`, `OneDepartment.tsx`, `departments.ts` (maps `venture.team.list` onto W3's `DepartmentData`), `AgentCard.tsx`, new `KeeperCard.tsx`, new `HealthLine.tsx`; `app/ui/src/places/today/TeamAtWork.tsx` (tints and badges); `app/ui/src/places/money/Overview.tsx` (the spend tile's SplitBar); `app/ui/src/engine/fake-w4.ts` (team desk); `app/ui/src/text/{en,hi}/team.json` (`team.dept.`, `team.keeper.`, `team.health.`), `money.json` (`money.split.`); tests `app/ui/tests/places/team-w4.test.tsx`, `today-w4.test.tsx`, `money-w4.test.tsx` (one case each for the last two), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. The Segmented toggle "Show departments" (All departments, Sales and clients, Marketing, Production, Money, Operations) holds `?dept=` in the address; W3's "no department toggle" test is flipped. Five tinted DepartmentPanels with their counts line, jobs this week (`Count`), spend (`Figure` with receipt, the held amount in words) and their agent cards on the tint.
2. `#/team?dept=prod` renders OneDepartment: the hero with three stat boxes, "How Production runs" with each step's Gate (floor steps "Always asks you"), "A change here makes version 5. You can undo it." from the playbook version, recent work cards, and the spend and jobs BarChart from `series` with "View chart data". A department with no agents shows one sentence and a link "See ways to earn" to `#/onboarding?dept=prod` (spec 8).
3. Keeper card: a "Runs as code, not AI" chip, no Chat button, no posture choice, one row per job with its last run line and outcome words; a job with `lastRun: null` says "Not run yet".
4. Health: a quarantined agent shows "Quarantined" in fail words with its reason, and "Clear quarantine" asks once more, then calls `venture.team.clearQuarantine` with the digest; degraded shows its reason in wait words.
5. Stats tile "Done this week" with a `Count` and "jobs across five departments"; "AI spend this month" with the held line.
6. Today's stories and live tiles carry `data-dept` and the department badge; Money's AI spend tile shows the SplitBar by department with a "Shared by the team" part when present. `assertFiguresProved` and `assertOnePrimary` pass on each place.

**UI pieces:** D-Team (`.stats`, `.dp`, `.acard`), D-TeamDept (`.hero`, `.flow`, `.recent`, `.spendt`), D-Today (`.stories`, `.live`), D-Money (`.sbar`).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/team-w4.test.tsx app/ui/tests/places/team.test.tsx app/ui/tests/places/team-v2.test.tsx app/ui/tests/places/today-w4.test.tsx app/ui/tests/places/money-w4.test.tsx app/ui/tests/a11y.test.tsx` all pass.

---

## 4B: agent threads, notes, standing orders, proposals and versions

### Package 4B1: agent threads, "from now on" proposals, versions and standing orders (E)

Size L. Rows: A2, A3, A4 (the list); spec 5.2; spec 8 rows "from now on while a run is active", "proposal made against an older version", "owner asks an agent for something on the floor".

**Files:** new `agents/threads.ts`, `agents/standing.ts` (the detector), `agents/proposals.ts`, `agents/versions.ts`, `agents/consent.ts`, `agents/answer.ts`, `agents/index.ts`; `delivery/harness/patches.ts` (owner rules); `delivery/playbook.ts` (`ownerVersion`; export `fits`); tests `platform/tests/venture-agent-threads.test.ts`, `venture-agent-standing.test.ts`, `venture-agent-versions.test.ts`, `venture-chat-consent.test.ts` (new).

**Failing tests first** (a YouTube business at approve each, a scripted model port as in `venture-harness-runs.test.ts`):

1. Consent: `venture.agents.thread.send` before any consent is `CHAT_CONSENT_REQUIRED` with the consent text, which names the connected AI ("Chats send your message and what Chausar reads to answer it (run steps, file names, figures with their receipts, the agent's notes) to Claude Sonnet 5.5 with your key. Keys, passphrases and bank or card numbers are never sent."). `venture.chats.consent {digest}` (app only) records it; a later change of AI connection makes it `CHAT_CONSENT_STALE`. With templates only (no AI), the agent answers from code templates and no consent is asked. A chat call carries client data, so it goes through `deps.models.preview` with `containsClientData: true` and then `deps.models.runPreview` under the recorded consent (the path W2 2C1's automatic judge uses); `models/port.ts` does not change, and a plain `generate` with client data is still refused `CLIENT_DATA_NEEDS_APPROVAL`.
2. Thread view: `venture.agents.thread.list {agent: 'story-editor'}` returns, in time order, owner messages, agent replies, one folded item per run in which that role owned a step (purpose, state, done and total, steps from `deliveryRunDetails`), proposals with their decisions, and `waiting` (the role's open question, kept in one fixed place, never only in the scroll). An unknown agent is `AGENT_NOT_FOUND`; Keeper is `AGENT_IS_CODE` ("Keeper is code, not AI. It has no chat; its jobs are on Team."). Pages of 50 with `before`.
3. Keys never enter a thread: a message holding `sk-ant-...` or a 40-character high-entropy token is refused `CHAT_KEY_REFUSED` ("That looks like a key. Keys go in Connections, never in chat.") and nothing is stored (`secretFindings`).
4. Detector (`agents/standing.ts`, code, no model): "From now on, always add burned-in captions to shorts.", "Never put music under the intro", "I prefer square thumbnails", "अब से हर शॉर्ट में कैप्शन जोड़ना", "आगे से इंट्रो छोटा रखना" and sentences with "हमेशा" or "कभी नहीं" are `standing`; "Remember that Meera wants files by the 5th", "मेरा GST नंबर बदल गया है" and sentences with "याद रखना" are `note` (4B2); "Why did the thumbnail render stop?" is neither. A table test lists each sentence and its class.
5. A standing request: the agent drafts a patch through the model with a typed schema `{ stepId, op: 'guidance.add' | 'guidance.remove', value }`; code checks it with `applyPatch` under the owner rules and stores a `venture-agent-proposal` (`kind: 'instruction'`; the patch with `proposedBy: 'owner'` and `source.quote`; `fromVersion`, `toVersion`; `parentHash` of the playbook in use; the step's guidance before and after as diff lines with the lines around them; an "applies to" line; a digest). The reply reads "You said 'from now on', so here is the change to my instructions." With templates only, the owner's own sentence, tidied, becomes the value on the role's first agent or write step, labelled "Drafted by Chausar from your words".
6. Owner rules in `applyPatch` (proposedBy `owner`): only `guidance.add` and `guidance.remove` (`PATCH_OWNER_OP`: "Tools, checks and limits are not changed from chat."); the step must be one the role owns (`PATCH_NOT_YOUR_STEP`); numbers are allowed only when they appear in the quoted words (`copiedTokens(source.quote)` passed to `assertNoNumbers`), so "keep shorts under 60 seconds" is accepted and a model-added "under 45 seconds" is refused; the no-sums rule and house style still hold. Model-proposed patches (the improvement loop) keep today's rules unchanged.
7. Decide: `venture.agents.proposal.decide {id, digest, decision: 'accept'}` (app only) writes a new `venture-playbook` (version n+1, `origin: 'owner'`, patches = current plus this one, `parentId` the current id, validated) and points the business at it; versions are never overwritten. While a run is active, the thread line reads "Version 5 is in use from the next run. Run 31 keeps version 4." (spec 8). A proposal whose `parentHash` is not the current playbook's hash is `PROPOSAL_STALE` and the thread says "This was drafted against version 4; version 5 is in use now. Ask again and I will redraft it." (spec 8). A wrong digest is `APPROVAL_STALE`; a second decision `PROPOSAL_DECIDED`; `reject` stores the decision and changes nothing.
8. Undo: `venture.agents.version.undo {agent, digest}` (app only): when the version in use came from this agent's owner change, the business points back at its parent (which stays stored, like W2's rollback); when later versions sit on top, a new version is built with `buildBody` from the plan and the patch list minus that change, so later changes stay; `UNDO_NOTHING` when the agent has no owner change in use; `UNDO_CONFLICT` naming the later change that would no longer apply; `APPROVAL_STALE` when `digest` is not the current hash. A plan change rebuilds the playbook with the owner patches carried (`ensurePlaybook`), and they still show as standing orders.
9. `venture.agents.orders.list {agent}` returns each owner `guidance.add` in use on that role's steps (not later removed), with the step, the version it arrived in and the owner's quote.
10. Questions and work: a question gets one model answer (typed parts; figures only by receipt; any other number labelled model estimate through `modelNumbers`) built from the role's last 5 runs, the order files' names, its notes and its standing orders. A message that asks for work returns `suggestion: { kind: 'order', offerId, request }`, which the screen opens as a prefilled New order sheet; nothing is created. A request that lands on a floor step (publish, send, money) becomes a drafted proposal (`draftProposal`, kind `start-work`) and the reply says "That needs your approval on Today." (spec 8; the Today row is 4C1's). A message sent while the role's run waits on the owner's question is recorded as that question's answer through the `venture.delivery.answer` path, and the thread says so (A2: a reply while something is held counts as "change it").
11. Every stored message emits `agent.message` with ids only.

**Implementation notes.** `applyPatch`, `describePatch`, `patchWords` (`delivery/harness/patches.ts`); `buildBody`, `currentPlaybook`, `validatePlaybook`, `playbookHash`, `ensurePlaybook` (`delivery/playbook.ts`); `deliveryAnswerHandler` (`delivery/runs.ts`); `copiedTokens`, `assertNoNumbers`, `modelNumbers`, `tidyWords` (`records.ts`); `redactSecrets`, `secretFindings` (`core/secrets.ts`); `deps.models.generate`; `appendAgentMessage`, `draftProposal` (4-0). The Hindi patterns are a fixed list in `standing.ts`, each with an English twin in the test table.

**UI pieces:** none (4B3). Feeds D-TeamChat.

**Done when:** `node --test platform/tests/venture-agent-threads.test.ts platform/tests/venture-agent-standing.test.ts platform/tests/venture-agent-versions.test.ts platform/tests/venture-chat-consent.test.ts platform/tests/venture-improve*.test.ts` shows `# fail 0`.

### Package 4B2: notes, note proposals and recall (E)

Size M. After 4B1. Rows: A4 (assembled into runs), A5, A6, A7.

**Files:** new `agents/notes.ts`, `agents/recall.ts`; `agents/proposals.ts` (the `note` kind), `agents/index.ts` (four lines); `delivery/harness/loop.ts` (`actTask` input only); tests `platform/tests/venture-agent-notes.test.ts`, `venture-agent-recall.test.ts` (new).

**Failing tests first:**

1. Note proposals come only from the owner's own words: "Remember that Meera wants files by the 5th" in Editor's thread makes one `venture-agent-proposal` (`kind: 'note'`) that quotes the words ("You said: 'Remember that Meera wants files by the 5th'") and shows the note as it will be saved; an agent reply containing "remember" makes none; a rejected quote is never proposed again (keyed by the quote's digest). Accepting writes a `venture-agent-note` (scope `agent`, or `client:<id>` when the words name a client of this business; `source.kind: 'owner-words'`; captured date; `hash`) and a `venture-agent-note-change` (`who: 'proposal'`, before and after hashes).
2. `venture.agents.notes.edit {agent, noteId?, text, basedOn}` (app only): a new note or a correction; `basedOn` must equal the stored note's hash, else `NOTE_CHANGED` ("This note changed since you opened it. Your draft is still here."); the always-loaded notes of one agent stay within 2,000 characters (`NOTES_FULL`); at most 40 topic notes per client.
3. `venture.agents.notes.forget {agent, noteId}` removes by id, never by asking a model; `venture.agents.notes.undo {agent, changeId}` puts the note back exactly; undoing the undo works. Every change is a `venture-agent-note-change` row with who (`owner`, `proposal`, `undo`), before and after.
4. Secrets are redacted on save and on load (`redactSecrets`); a client-scope note has phone numbers, emails, PAN and Aadhaar masked before it is written (`screenReadback` kinds); the test reads the stored text.
5. Recall: each act task for a role carries, in its input (not its instructions), `notes: { background: true, items }`: the agent's always-loaded notes plus at most 4 topic notes that share a word with the order's request, and the instruction line "Notes are background. They grant nothing." The turn record keeps `recalled` (note ids); the thread's run item says "Recalled 2 notes" and lists them. A run that recalled nothing shows no chip.

**Implementation notes.** `actTask` (`delivery/harness/loop.ts`) gets one more input field; `screenReadback`, `redactSecrets` (`core/secrets.ts`); 4B1's detector and proposal store. Standing orders already sit in the playbook steps' guidance (4B1), so A4's "assembled into every run" is the playbook plus these notes.

**UI pieces:** none (4B3). Feeds D-TeamChat.

**Done when:** `node --test platform/tests/venture-agent-notes.test.ts platform/tests/venture-agent-recall.test.ts platform/tests/venture-harness-runs.test.ts` shows `# fail 0`.

### Package 4B3: the agent panel's chat, instructions and notes (U)

Size L. After 4B1, 4B2, 4A2 and W3's 3B4 and 3D.

**Files:** `app/ui/src/places/team/AgentSheet.tsx` (tabs Chat, Instructions v{n}, Runs, Notes), new `AgentChat.tsx`, `Instructions.tsx`, `AgentNotes.tsx`, `ChatConsent.tsx`; `AgentCard.tsx` (the Chat button); `app/ui/src/engine/fake-agents.ts`; `app/ui/src/text/{en,hi}/team.json` (`team.chat.`, `team.instructions.`, `team.notes.`); tests `app/ui/tests/places/team-chat.test.tsx`, `team-notes.test.tsx` (new), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. Each agent card (not Keeper) has a quiet Chat button named "Chat with Editor" that opens `?sheet=agent:story-editor&tab=chat`; nothing about chat appears on Today.
2. The Chat tab: ChatThread ("Conversation with Editor") with day separators, the owner's and the agent's messages, run items folded ("Cut episode 14 · 3 steps done") that expand to their steps, a "Recalled 2 notes" chip that opens the list, and the waiting question pinned above the thread with Answer. Buttons ‹ and › step between agents ("2 of 7").
3. A first message opens the consent sheet with the engine's text; Accept calls `venture.chats.consent`; the message then sends. Composer suggestion chips prefill and never send.
4. An instruction proposal renders as DiffCard: "Proposed change to Editor's instructions", the applies-to line, context and added lines, "Version 4 to 5, you can undo", Reject and Accept (the one primary) calling `venture.agents.proposal.decide`; a stale proposal hides both buttons and shows the engine's words (spec 8). A note proposal renders as a small card "Save this note?" with the quoted words.
5. Instructions tab: the steps the role owns as readable text, each with its guidance lines and "Done when: these checks pass: ..." from the step's checks (`checkLabel` words); standing orders with "since version 5" and the owner's quote; "Version 5, from your words on 23 Oct" and "Go back to version 4" (second ask) calling `venture.agents.version.undo`; the posture "set by" line (O16).
6. Notes tab: notes with their source and date; Edit keeps the owner's draft on `NOTE_CHANGED`; Forget asks once more; each change has an Undo line.
7. A work suggestion opens New order prefilled; a floor reply links "Open on Today". Every new string is in `en` and `hi`; axe passes on each tab.

**UI pieces:** D-TeamChat (`.cpanel`, `.cp-tabs`, `.bub`, `.runc*`, `.prop*`, `.diff`, `.ver`, `.sugs`, `.cbox`).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/team-chat.test.tsx app/ui/tests/places/team-notes.test.tsx app/ui/tests/a11y.test.tsx app/ui/tests/text.test.ts` all pass.

---

## 4C: Chats with Chausar as chief of staff

### Package 4C1: the chief of staff, proposals and their Today cards (E)

Size L. After 4B1 (chat consent, thread store). Rows: A1, A15, K18 (keys never in chat); spec 5.4; spec 8 "chief quotes a figure with no receipt".

**Files:** new `chief/threads.ts`, `chief/tools.ts` (read tools), `chief/answer.ts` (parts and the receipt check), `chief/proposals.ts`, `chief/rows.ts` (Today rows), `chief/routing.ts`, `chief/fit.ts`, `chief/index.ts`; `views/queue-w4.ts` (the `proposal` decide); tests `platform/tests/venture-chief.test.ts`, `venture-chief-receipts.test.ts`, `venture-proposals.test.ts` (new).

**Failing tests first:**

1. `venture.chief.thread.send {text: 'Can we hit 1.5 lakh this month?'}` with consent makes a thread (titled by the first question), stores the owner message and the answer, and emits `chief.message`. Without consent `CHAT_CONSENT_REQUIRED`; a key in the text `CHAT_KEY_REFUSED`, nothing stored. `venture.chief.threads {}` groups threads by Today, This week, Last week, Earlier, with the last answer line and unread; `thread.pin` pins.
2. Read tools only: `queue`, `runs`, `team`, `money` (books summary this and last month, overview, open invoices, the goal from 4I1 when present), `clients`, `plan` (offers and prices), `journal` (latest 20), `businesses` (4J6 snapshots of other businesses that open with this computer). Each returns engine data with receipt ids. No tool writes: a model turn naming an unknown tool gets `TOOL_NOT_ALLOWED` and the answer goes on without it. At most 3 tool turns, each reserved against a per-answer spend cap before it is sent (the W1 `reserveRunCall` pattern).
3. Answers are typed parts `text`, `figure {receiptId, key}`, `estimate {text}`. Code checks each figure part: the receipt must be one a tool returned in this answer and hold that key, else the part is dropped and a line says "One figure was left out: it had no receipt." A money amount inside a text part (₹, Rs, lakh, crore, or a currency-formatted number) is stripped and replaced with "(figure left out: no receipt)"; any other number in prose becomes an `estimate` part with the "model estimate" label (spec 8). The test answers with a receipted ₹1,18,400, an unreceipted ₹31,600 and "about 18,000 views", and checks the three outcomes.
4. Proposals: an answer may carry proposals of kinds `brief-agent`, `start-run`, `draft-invoice`, `draft-reminder`, `quote`, `outreach-draft`. `brief-agent` posts into that agent's thread at once ("From Chausar: ..."), with no Today card. Every other kind is stored with `draftProposal` (status `drafted`) and shown with "This becomes a card on Today for your approval." `venture.proposals.raise {id}` makes it a Today row (kind `proposal`; the agent; "Nothing changes until you approve"; Approve primary, with a second ask when it spends or sends; Not now). `venture.queue.decide` approve runs the real engine method for that kind (`venture.delivery.run`, `venture.invoice.prepare`, `venture.price.quote`, 4J5's reminder draft, 4E2's outreach draft) after the gate runs again (W1 H13). A changed proposal is `APPROVAL_STALE`; an unknown kind `PROPOSAL_KIND_UNKNOWN`; one that touches keys, money policy, posture or storage `PROPOSAL_NOT_ALLOWED`. 4B1's floor requests become rows here too. Each raise emits `proposal.created`.
5. Routing (A15): "@Editor cut the trailer", or a message beginning with an agent's name, goes to that agent's thread (one agent at most) and the chief says where it went; "ask the editor or the researcher" makes the chief ask "Which agent: Editor or Researcher?"; it never guesses.
6. Other businesses: a question about a business that opens with a passphrase answers "Sitara Events is locked. Open it to ask about it." and reads nothing; one that opens with this computer is answered from its snapshot, every figure saying "as of {time}, when you last opened it" (4J6; until 4J6 lands, "Chausar can read only the open business").
7. `venture.chief.fit {}` returns `{ wayId, line, estimate: true }` from `venture.playbooks.list` (4J8) and the open businesses' kinds, or `null` with no AI.
8. The pinned "Weekly review" is a routine (4J13) that posts its answer into a pinned chief thread; until 4J13 lands, no routine item shows.

**Implementation notes.** `TextPart` (`contracts.ts`), `modelNumbers`, `assertNoMoney` (`records.ts`); `queueListHandler`, `runsListHandler`, `teamListHandler`, `booksSummary`, `moneyOverview`, `listInvoices`, `listClients`, `journalListHandler` called as functions with the owner's context; `journalled` for anything that sends; `appendChiefMessage`, `appendAgentMessage`, `draftProposal` (4-0); `requireChatConsent` (4B1). Chief threads live in the open business's vault, because the engine keeps one business open at a time (see "Choices").

**UI pieces:** none (4C2). Feeds D-Chats, D-Today, D-Start.

**Done when:** `node --test platform/tests/venture-chief.test.ts platform/tests/venture-chief-receipts.test.ts platform/tests/venture-proposals.test.ts platform/tests/venture-views-queue.test.ts` shows `# fail 0`.

### Package 4C2: the Chats place, the Ask box and the Chausar story (U)

Size L. After 4C1, 4J8 and W3's 3A2, 3B4, 3H1.

**Files:** new `app/ui/src/places/chats/index.tsx`, `ChatList.tsx`, `ChiefThread.tsx`, `PlanCard.tsx`, `Chats.module.css`; `app/ui/src/shell/places.ts`, `routes.ts` (`chats` in `RAIL_PLACES` after `today`), `Rail.tsx` (the Chats item, icon messages-square, "New" until the first thread exists), `TopBar.tsx` and the BottomTabs list (Chats second on the phone, Clients moves into More); the page header's tools slot (the "Ask Chausar anything" box, Ctrl K); `app/ui/src/places/today/TeamAtWork.tsx` (the Chausar story as `lead`); `app/ui/src/places/onboarding/Start.tsx` ("Good fit for you", "Not sure which fits? Ask Chausar"); `app/ui/src/engine/fake-chief.ts`; `app/ui/src/text/{en,hi}/chats.json` (new), `common.json` (`rail.chats`, `ask.`); tests `app/ui/tests/places/chats.test.tsx` (new), `tests/shell/rail.test.tsx` and `tests/shell/phone.test.tsx` (flipped), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. The rail lists Today, Chats, Team, Work, Clients, Money, Connections; W3's "no Chats item" test is flipped. Ctrl K or the header box opens `#/chats` with the text in the composer, never sent until Send.
2. `#/chats`: "Your chats" with New chat and a search box that filters the titles shown (no engine call), Pinned first, groups by time; the thread shows the owner's messages and the chief's answers with figures as `Figure` with receipts and estimate parts with the "model estimate" chip (`assertFiguresProved`), the "Worked by the calculator" table when the answer carries one, and a plan card whose steps name agents and say "each one asks you first"; a step with a drafted proposal shows "This becomes a card on Today for your approval" with Not now and Start (`venture.proposals.raise`), then "On Today" with a link.
3. The consent sheet before the first message; refusals in the engine's words; the footer line "Every figure links to its receipt. Chausar never pays, posts or sends without you."
4. Today's stories lead with Chausar ("Chausar, ask anything"), which opens Chats; Start shows the Good fit tile from `venture.chief.fit` with its estimate chip, and "Not sure which fits? Ask Chausar" with two example questions that prefill.
5. Phone: BottomTabs Today, Chats, Team, Work, More.

**UI pieces:** D-Chats (`.cv-*`, `.sugg`), D-Today (`.stories` lead), D-Start (the fit tile), D-Phone-Today (tabs).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/chats.test.tsx app/ui/tests/shell/rail.test.tsx app/ui/tests/shell/phone.test.tsx app/ui/tests/places/today-v2.test.tsx app/ui/tests/places/start-v2.test.tsx app/ui/tests/a11y.test.tsx` all pass.

---

## 4D: the owner's network: import, strength, warm paths, search

### Package 4D1: network import, people, merge, privacy (E)

Size L. Rows: C2, C9 (privacy), C22; spec 5.5 "Import" and "Privacy"; spec 8 "import with a bad or huge file", "two people merge wrongly".

**Files:** new `network/import.ts`, `network/parse-linkedin.ts`, `network/parse-contacts.ts` (Google CSV and vCard), `network/parse-ics.ts`, `network/parse-mail-headers.ts` (accepts rows the desktop extracted), `network/people.ts` (merge, split, hide), `network/forget.ts`, `network/methods.ts`, `network/index.ts`; new `app/desktop/mail-headers.cjs` (reads an mbox header block by header block, keeps From, To, Cc, Date only) and its IPC channel `network:pickMailExport`; tests `platform/tests/venture-network-import.test.ts`, `venture-network-people.test.ts`, `venture-network-forget.test.ts`, `platform/tests/desktop-mail-headers.test.ts` (new).

**Failing tests first:**

1. `venture.network.import {kind: 'linkedin-connections', name: 'Connections.csv', text}` (app only): skips LinkedIn's "Notes:" lines before the header row, reads First Name, Last Name, URL, Email Address, Company, Position, Connected On, and makes one `venture-person` per row with `handles` (emails, phones, `linkedinUrl` normalised to `https://www.linkedin.com/in/<slug>`), `role` (title, company, `asOf`), and a `SourceRef {connector, importId, row}` for every fact. One `venture-network-import` records `{kind, fileName, digest, rows, people, merged, dropped, at}`.
2. `linkedin-messages` (Messages.csv): keeps FROM, TO, DATE and the conversation id; the CONTENT column is dropped and counted in `dropped` ("Dropped message text, 2,140 lines"); no message text is stored anywhere (the test searches the whole state for a sentence from the fixture). `contacts-csv` (Google: Name, E-mail 1 - Value, Phone 1 - Value, Organization 1 - Name, Organization 1 - Title) and `vcard` (FN, N, EMAIL, TEL, ORG, TITLE; PHOTO and NOTE dropped) work the same. `calendar-ics`: each VEVENT's date, SUMMARY and ATTENDEE emails make meeting facts on each attendee (`attendees` count kept, DESCRIPTION dropped). `mail-headers`: rows `{from, to, cc, date, direction}` only.
3. `check: true` returns `{ kept, dropped, people, merged, samples }` (three samples) and stores nothing (C22 "Check").
4. Merging: the same normalised email, phone (E.164 with the business country) or LinkedIn URL merges into one person automatically; the same name plus the same company makes a "Same person?" suggestion in `venture.network.people {suggestions: true}`; the same name alone never merges. A person's `history` keeps each merge `{op, from, at, by}` (spec 8: "the merge is journalled"). `venture.network.split {personId, sourceIds}` moves those source rows to a new person and records it.
5. Refusals, nothing half-imported (spec 8): a file over 4 MB is `NETWORK_FILE_TOO_LARGE` with its size ("This file is 6.2 MB; Chausar reads at most 4 MB at once."); a row that can't be read is `NETWORK_FILE_INVALID` with its line ("Line 812: the Connected On date could not be read."); more than 20,000 people is `NETWORK_FILE_TOO_LARGE`; the same file again is `NETWORK_ALREADY_IMPORTED`; an unknown kind `INVALID_VENTURE_REQUEST`. In each case the store is unchanged. On the hosted app every kind is `TIER_UNAVAILABLE` ("Import your network in the desktop app. It reads the file on your computer.").
6. `venture.network.importUndo {importId}` (app only) removes exactly what that import made: people only it created are removed; facts it added to merged people are removed; the import record is marked undone.
7. Hide and forget: `venture.network.hide {personId, hidden}` drops a person from search and lists. `venture.network.forget {id}` (app only) deletes the person, their ties, evidence rows (`person:<id>`), pipeline cards and drafts, and stores a `venture-forgotten` row with salted hashes (a per-business random salt kept in the vault) of their emails, phones and LinkedIn URL; a later import skips any row matching a hash and says "1 person you asked Chausar to forget was left out." A person linked to a client with invoices keeps the client and invoice records the law needs, and the reply says so ("Asha is your client. Her invoices stay; everything else Chausar kept about her is gone.").
8. `venture.network.person {id}` returns every field with its source row (the DPDP notice record "What Chausar keeps about this person"); `venture.network.sources {}` returns one card per import kind with file name, date, counts kept and dropped, and "Imported 3 months ago. Download a new copy to catch new connections." once the newest import of that kind is older than 60 days (date arithmetic in code).
9. Desktop extractor: `mail-headers.cjs` on a fixture mbox reads only header blocks, never a body line (the test plants a body line and finds it nowhere in the output), stops at 200,000 messages with a plain refusal, and marks `direction: 'sent'` when From is one of the owner's addresses given with the request.

**Implementation notes.** Parse CSV with the cell rules of `delivery/harness/cells.ts` and the bounds of `delivery/harness/files.ts` (`MAX_CELL_CHARS`); `ventureAction` for the one transaction; `redactUrl` for profile URLs; `screenReadback` never runs on names (it is for read-backs), but an imported note field is dropped, not stored. People live in `venture-person` per business; the never-contact list across businesses is 4J6's.

**UI pieces:** none (4D4). Feeds D-Network ("Where your network comes from") and Connections "Your network".

**Done when:** `node --test platform/tests/venture-network-import.test.ts platform/tests/venture-network-people.test.ts platform/tests/venture-network-forget.test.ts platform/tests/desktop-mail-headers.test.ts` shows `# fail 0`.

### Package 4D2: relationship strength and warm paths (E)

Size M. After 4D1. Rows: C3, C4; spec 5.5 "Strength", "Warm paths"; spec 8 "warm path unconfirmed".

**Files:** new `network/strength.ts` (the weight table and decay), `network/paths.ts`, `network/bands.ts`; `network/import.ts` (one line: recompute after an import); `money/quote.ts` `getReceipt` (serves tie receipts beside price and sum receipts; one branch); `network/methods.ts` (`recompute`, `know`, `link`); tests `platform/tests/venture-network-strength.test.ts`, `venture-network-paths.test.ts` (new).

**Failing tests first** (clock fixed at 23 Oct 2026):

1. The weight table, in basis points, with its source note "Chausar's own weights; tuned later from your outcomes": mail both ways 400 a month (capped at 2,400), mail one way 50 a month (cap 300), a meeting of 10 people or fewer 300 each (cap 1,800), a paying client 1,500 once, a saved contact 300, LinkedIn messages 150 a month (cap 900), a LinkedIn connection 100, "you said" 1,800 for "I know them well" and 500 for "we have met" (founder's decision, 26 Oct: the owner's own word is strong evidence, so "well" alone reaches Know well). Each signal fades with a half-life of 180 days from its last date, computed with integer halvings and a fixed 180-entry table (no floating point), and the receipt says the half-life is Chausar's own choice; what the owner said does not fade until they change it. Bands: Close from 2,700, Know well from 1,800, Know from 1,000, Met once from 150, else Cold; five dots 5 to 1. (The first draft said Close from 6,000, Know well from 3,500, Know from 1,500, Met once from 400. With the weights above those bands cannot give the outcomes in test 2: six months of mail both ways and two meetings add up to at most 3,000, and a client invoiced last month fades below 1,500 within a day. 4D2 kept the weights and set the bands so the outcomes hold, which also keeps a paying client at Know for 4E2's footer rule; the founder accepted them on 26 Oct.)
2. Outcomes, not raw numbers: a person with mail both ways in each of the last 6 months and two small meetings in the last 30 days is Close; the same signals three years old are Met once or Cold; a LinkedIn connection alone is Cold; a paying client with an invoice last month and nothing else is Know.
3. `venture.network.recompute {}` writes one `venture-tie` per person (`signals` with count, last date, weight, decayed value, source; `scoreBp`; `band`; `computedAt`; a digest) and one evidence row per signal (`venture-evidence`, subject `person:<id>`, field `tie.<kind>`, `by: 'engine'`). `venture.receipt.get {id}` serves the tie receipt with lines such as "14 emails both ways, the last on 2 Oct (mail headers, takeout-mail.mbox)". It runs after every import and writes the Keeper run `network-strength`; merge, split and Undo work the ties they touch out again, and the journal sweep's tick works every tie out again once a day (only ties that changed are written).
4. Bands summary: `venture.network.sources` gains `bands {close, knowWell, know, metOnce, cold, receiptId}` from a `count/bands` receipt listing the ties counted.
5. Paths: `venture.network.person` returns up to three paths, strongest first: direct ("You know her directly, well"); through a person at the same company whom the owner knows at Know or better; and through a connector whose second leg is backed by a fact (both on one meeting's attendees, one mail that one of the two wrote with the other on it, or the owner's own "they know each other" from `venture.network.link {a, b, note}`), which is `confirmed: true` with that fact's line. A mail the owner sent to both confirms nothing (reviewer's decision, 26 Oct: the stricter rule). A meeting after the day the file is read adds no person, signal or path; a generic employer (Self-employed, Freelance, Student, Unemployed, Retired and the like) is no company. A connector with no such fact is `confirmed: false` and its line is "possible path, not confirmed" (spec 8). The weaker leg ranks a path; an unknown leg ranks below every confirmed path. The "why" line is written by code from the legs.
6. `venture.network.know {personId, how: 'well' | 'met', note?}` adds the "you said" signal with the owner as source ("well" alone is Know well).

**Implementation notes.** `recordEvidence` (`evidence/ledger.ts`); `getReceipt` (`money/quote.ts`); `localDayAt` for dates. Paths never infer a second leg from a company name alone without a fact; the company match only makes the person a candidate connector.

**UI pieces:** none (4D4). Feeds D-Network (StrengthDots, PathLine, the bands chart), D-Clients (path lines on cards).

**Done when:** `node --test platform/tests/venture-network-strength.test.ts platform/tests/venture-network-paths.test.ts platform/tests/venture-network-import.test.ts` shows `# fail 0`.

### Package 4D3: plain-English search, saved searches, "Before you write" (E)

Size M. After 4D2. Rows: C5, C18, C19.

**Files:** new `network/search.ts`, `network/saved-searches.ts`, `network/research.ts`; `network/import.ts` (one line: saved searches and job changes after an import); `network/methods.ts`; tests `platform/tests/venture-network-search.test.ts`, `venture-network-research.test.ts` (new).

**Failing tests first:**

1. `venture.network.search {text: 'founders in Pune who sell skincare online'}` (app only, chat consent from 4B1): the first model call returns traits (at most 5: "Founder or owner", "Based in Pune", "Sells skincare online") and filters; code gathers at most 200 candidates from stored facts (role, company, location, the owner's notes, meeting titles); the second call (at most 50 candidates per call, at most 4 calls) scores each trait 0, 0.5 or 1 with a quote and the field it came from. Code checks every quote is in that person's stored field (whitespace and case folded); a quote that is not drops the score to 0 and the check reads "not supported". Results rank by fit (code's weighted sum), then by path score. The "Why:" line is built by code from the checked quotes and their sources ("Why: her LinkedIn role reads 'Co-founder, Dewdrop Naturals'. LinkedIn export, row 1,044"), never model prose. The run is stored as `venture-network-search`.
2. A trait about religion, caste, health, age, gender or sexual orientation is refused before any candidate is scored (`NETWORK_TRAIT_PROTECTED`).
3. `searchMore {searchId}` leaves out everyone already shown. `web: true` adds only cold results with their page URL through the research search port, each needing a source page as the lead rules do; with no search port the answer says "Web search is not set up here." and returns network results only.
4. Saved searches (C18): `saveSearch {searchId, name}`; after each import the saved filters re-run in code only (no model) and a notice row says "3 new people match your saved search 'Pune skincare founders'". A re-import showing a new company for a person adds an evidence row ("Rahul moved from Ubtan Lab to Neem Labs, LinkedIn export of 21 Oct") and keeps the old company in the role history.
5. "Before you write" (C19): `venture.network.research {personId}` reads public pages only through the research search port and the net guard; any linkedin.com address is refused `RESEARCH_HOST_REFUSED`; each line is `{text, url}` and a line without a URL is dropped; pages pass the untrusted screen (`screenUntrusted`); lines are stored on the person as `web` sources labelled "From public pages"; professional facts only (the same protected-trait list drops lines).

**Implementation notes.** `deps.models.preview` and `runPreview` with `containsClientData: true` under the chat consent; `screenUntrusted` (`policy/untrusted.ts`); `guardedFetch` (`core/net-guard.ts`); the research search port in the engine options (`research.search`). The India starter chips are UI text (4D4).

**UI pieces:** none (4D4). Feeds D-Network (results, Why lines, trait checks, Find more, Save search).

**Done when:** `node --test platform/tests/venture-network-search.test.ts platform/tests/venture-network-research.test.ts` shows `# fail 0`.

### Package 4D4: the Network tab, person sheet, import sheet and network cards (U)

Size L. After 4D1 to 4D3 and W3's 3E2, 3B4, 3G1.

**Files:** new `app/ui/src/places/clients/NetworkTab.tsx`, `PersonSheet.tsx`, `ImportSheet.tsx`, `NetworkSources.tsx`; `app/ui/src/places/clients/index.tsx` (the Network tab, `#/clients/network`); new `app/ui/src/places/connections/YourNetwork.tsx` and one line in `connections/index.tsx`; `app/ui/src/engine/fake-network.ts`; `app/ui/src/text/{en,hi}/clients.json` (`clients.network.`, `clients.person.`, `clients.import.`), `connections.json` (`connections.network.`); tests `app/ui/tests/places/clients-network.test.tsx`, `clients-person.test.tsx` (new), `connections-network.test.tsx` (new), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. The tabs are Clients, Pipeline, Network with counts (W3's "no Network tab" test is flipped); `#/clients/network` shows the search box ("Who are you looking for?"), starter chips that prefill and never send ("Clients quiet for 6 months", "An intro to Zomato", "Paste a client brief", and the Hindi set), and "Also look outside my network" with its line "Web results start cold and need a source page".
2. Results: the summary line in the engine's words ("11 people fit. Ran 3 searches · 4 you know well · fit first, then path"), the traits looked for, rows with initials, name, "1st" or "2nd", title at company, StrengthDots (opening the tie receipt), the Why line with its quoted fact and source, the trait checks (yes, partly, not supported) behind a disclosure, the PathLine with its via line ("possible path, not confirmed" dashed and in words), and actions: Add to pipeline (or "In pipeline, Found"), Open in LinkedIn, WhatsApp, Draft intro or Draft a note (4E2's sheet). Show more, Find more, Save search.
3. The person sheet beside the list (`?sheet=person:<id>`): How you know them (receipt lines), Paths, the pipeline card, Drafts, Sources (every kept field with its source row), Hide and Forget (Forget asks once more and says what goes and what stays), Split for a merged person.
4. Import sheet: choose the kind, pick the file (desktop: the mail export through `network:pickMailExport`), Check shows kept and dropped and three samples, Import, then Undo for that import; refusals show the engine's line or size words (spec 8).
5. Side tiles: "Where your network comes from" (per source: file, date, counts, kept and dropped, "Import a newer file"), "How well you know them" as a BarChart of the five bands with its receipt and "View chart data", and "Private to you" with "What Chausar keeps".
6. Connections "Your network" cards: the honest mode (read, file), the count and the import date.

**UI pieces:** D-Network (all of it), D-Clients (tab bar).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/clients-network.test.tsx app/ui/tests/places/clients-person.test.tsx app/ui/tests/places/connections-network.test.tsx app/ui/tests/places/clients-v2.test.tsx app/ui/tests/a11y.test.tsx` all pass.

---

## 4E: pipeline, follow-ups, drafts and handoffs

### Package 4E1: the pipeline and follow-ups (E)

Size L. After 4D1 (people) and 4D2 (strength and paths on cards). Rows: C6, C7, C12, C13, C16; spec 5.5 "Pipeline".

**Files:** new `network/pipeline.ts`, `network/followups.ts`, `network/score.ts`, `network/funnel.ts`, `network/followup-rows.ts`, `network/pipeline-methods.ts`; `customers/leads.ts` (`leadToOpportunity`); `views/queue-w4.ts` (the `followup` decide); tests `platform/tests/venture-pipeline.test.ts`, `venture-followups.test.ts`, `venture-lead-score.test.ts` (new).

**Failing tests first:**

1. Stages `found`, `asked`, `talking`, `proposal`, `won`, `lost`, `not-now`. `venture.pipeline.move` goes forward only (`PIPELINE_STAGE_BACKWARD`); `won`, `lost` and `not-now` are terminal (`PIPELINE_STAGE_CLOSED`); "Ask again from {date}" on a Not now card makes a new card linked to the old one, history kept. Each move needs its evidence (`PIPELINE_EVIDENCE_REQUIRED`): Asked a recorded send; Talking a reply (4E3) or the owner's "they replied" with a date; Proposal a quote receipt or an owner note; Won a client (the move makes one through `addClient` in the same transaction, or links an existing one); Lost one of the fixed reasons (no budget, no reply, chose someone else, not a fit, timing, other). A person on the blocklist is `PIPELINE_BLOCKED`.
2. Every card names its trigger (C13): an import row, a search, a saved search, the owner, or a lead's source URL; `venture.pipeline.add` without one is `PIPELINE_TRIGGER_REQUIRED` ("No source, no lead").
3. Existing leads map in: new to Found, drafted and contacted to Asked, replied to Talking, won to Won, lost to Lost; blocked stays a flag, not a stage. `recordSend` on a replied lead keeps Talking (W1's fix holds).
4. Follow-ups by code (C7), with the owner's allowed weekdays (default Monday to Friday) and send time: an intro request is due 7 days after the recorded send, with one follow-up only, after which the card says "Try another path, or Not now"; a first email 5 days; a WhatsApp or LinkedIn message 4 and then 10 days; a due date on a day not allowed moves to the next allowed day. Caps: two nudges, then the card parks as Not now with "Ask again from {date}" 30 days on; at least 7 days between touches to one person; a daily new-person cap (default 10) and a weekly one (40), shared with follow-ups as one ceiling where each side may use the other's unused slots. A recorded reply stops the sequence. Thread age: Alive under 7 days since the last reply, Cooling 7 to 21, Presumed dead after 21. The sequence is copied onto the card when it starts, so a later change to the settings never rewrites a card in flight.
5. Today: a due or late follow-up is a `followup` row ("Farhan Ali, Ali Spices: follow-up is 2 days late. Nudge drafted for WhatsApp.") with Open WhatsApp (the primary, a handoff through 4E2) and I sent it, once per card and due date.
6. `venture.pipeline.list {filter?}` returns the stages with their sub lines ("Not asked yet", "You sent the first note", "They wrote back", "A price is with them", "Now your clients") and cards (initials, name, company, band and dots, best path, next step with due date and lateness words, the draft line, the business); Lost and Not now folded with counts; the four tiles (next steps this week with late, today and later counts; drafts to send by channel; moved forward this week by stage; won this month with names), each count from records; filters `due`, `draft` and per business.
7. "How people moved" (last 90 days): reached each stage and the share that moved on, counted from the cards' histories, as permille in code, with a `count/funnel` receipt.
8. Lead score (C12): owner rules `{field, operator, value, points}` (fields from a fixed list; a protected trait is refused `NETWORK_TRAIT_PROTECTED`) and per-factor votes, each with an evidence URL or the word "guess"; code sums and buckets hot, warm, cold; the matched rules are the reasons shown. A weighted pipeline figure uses stage shares from the 90-day history, labelled "forecast from your last 90 days" with its receipt, or "Not enough history yet" under 10 closed cards. Money per stage comes only from quote receipts.
9. Timeline (C16): each card lists what was sent (with channel and date), what is scheduled (the next due date) and what is projected ("about 12 Aug, estimated" from the copied sequence), and where a reply came; Chausar tracks no opens, and the card says "Chausar doesn't track opens."
10. Every change emits `pipeline.changed` with ids only.

**Implementation notes.** `moveLead`, `STAGE_RANK` pattern, `recordSend`, `verifyLeadEmail` (`customers/leads.ts`); `addClient` (`money/clients.ts`); `localDayAt`, `ownerToday` (`local-day.ts`); `personById` (4-0); `paths` and the tie of 4D2 for card fields.

**UI pieces:** none (4E4). Feeds D-Clients (board, tiles, due list, funnel), D-Today (follow-up rows).

**Done when:** `node --test platform/tests/venture-pipeline.test.ts platform/tests/venture-followups.test.ts platform/tests/venture-lead-score.test.ts platform/tests/venture-leads-stages.test.ts` shows `# fail 0`.

### Package 4E2: drafts, handoffs, the footer rule and the send governor (E)

Size M. After 4E1 and 4J9. Rows: C8, C9 (draft fields), C11 (advisory lints), C14, C20, C21; spec 5.5 "Drafts and handoffs"; M12 reminders (the handoff part).

**Files:** new `network/outreach.ts`, `network/handoff.ts`, `network/governor.ts`, `network/outreach-checks.ts`; `customers/leads.ts` (`draftOutreach` takes a kind; the footer only on cold); `network/import.ts` (one line: accept detection); tests `platform/tests/venture-outreach.test.ts`, `venture-send-governor.test.ts` (new), `venture-leads-methods.test.ts` and `venture-connectors-leads.test.ts` (updated).

**Failing tests first:**

1. `venture.outreach.draft {opportunityId, kind, channel}` kinds: `intro-request` goes to the strongest confirmed connector with a note (decline made easy) and a forwardable blurb of 4 or 5 sentences in the third person with no pitch and at most one link; with only unconfirmed paths it is `OUTREACH_NO_CONFIRMED_PATH` ("No confirmed path to Sameer. Write to him yourself, or ask Rahul first whether he knows him."); `double-opt-in` (the owner introduces: first a check with the target, then the two-sided intro); `connection-note` with the owner's limit 200 (free account) or 300 (Premium), `OUTREACH_TOO_LONG` over it, and the line "Free accounts get only a few personal notes a month. LinkedIn has not said how many."; `follow-up`; `reply`; `cold-email` (the existing lead path). The agent drafts under the chat consent; the prompt-leak lint (W1 H20) and house style run on every draft.
2. Footer rule (C20, the founder's decision): a cold email (no tie, or a tie below Know, or kind `cold-email`) carries the unsubscribe line and the postal address (`LEADS_ADDRESS_MISSING` without an address), keeps its source URL and needs a verified email (MX check); a warm note to a tie of Know or better on any channel carries no footer. The blocklist applies to every kind (`OUTREACH_BLOCKED`). A cold email also needs the lawful basis the owner picked for that card (`they-wrote-first`, `existing-contact`, `public-business-contact`), else `OUTREACH_BASIS_REQUIRED`.
3. Excluded services (C21): a draft that offers a service in the owner profile's excluded list (4J9) is `OUTREACH_EXCLUDED_SERVICE` ("This offers GST filing, which you said you don't sell.").
4. Advisory lints (C11), warnings that block nothing: salesy words, a hard call to action, a link in a first touch, a LinkedIn note near its limit, a touch less than 7 days (or 2 days on WhatsApp) after the last.
5. `venture.outreach.open {draftId}` (app only) returns one handoff and sends nothing: `{action: 'mailto', url}` with to, subject and body; `{action: 'linkedin', profileUrl, text}` (the screen copies the text, then opens the profile); `{action: 'whatsapp', url: 'https://wa.me/<digits>?text=...'}` with the phone in E.164 digits. No phone is `OUTREACH_NO_PHONE`; no profile `OUTREACH_NO_PROFILE`; WhatsApp to someone below Know who never wrote first is `OUTREACH_WHATSAPP_COLD` ("WhatsApp is for people you know. Write cold messages by email.").
6. `venture.outreach.sent {draftId, at, channel}` (app only) records the send with channel `own-mailbox`, `linkedin`, `whatsapp` or `phone`, moves a Found card to Asked (forward only), sets the next follow-up date (4E1) and counts toward the governor; a time before the draft or in the future is refused as today.
7. Send governor (C14): per channel daily caps the owner may lower but never raise (LinkedIn notes 10 a day and 50 a week, LinkedIn messages 20, WhatsApp 20, email 30); a warm-up from the first recorded send (25, 40, 60, 80, then 100 percent of the cap over five weeks); `open` past the cap is `OUTREACH_DAILY_CAP` ("You've sent 10 LinkedIn notes today, your limit. Chausar opens LinkedIn again tomorrow."). `venture.outreach.restricted {channel}` (the owner says the platform restricted the account) pauses that channel for 72 hours with a Today notice ("Don't reconnect for 3 days.").
8. Accept detection (C8): a re-imported LinkedIn export with a new connection whose Connected On is on or after a sent connection note's date marks that note accepted and adds a card line; nothing else about LinkedIn activity is read.
9. Reminders (M12, the handoff part): 4J5's reminder draft opens through the same `open` and `sent` path.

**Implementation notes.** `draftOutreach`, `verifyLeadEmail`, `onBlocklist`, `DEFAULT_UNSUBSCRIBE_LINE` (`customers/leads.ts`); `promptLeaks` (W1 `playbooks/prompt-leak.ts`), `houseStyleFindings` (`records.ts`); the profile of 4J9; the never-contact hashes of 4J6 once it lands (one extra check, added by 4J6).

**UI pieces:** none (4E4). Feeds D-Network (the draft sheet), D-Clients (draft lines, "Due today and late").

**Done when:** `node --test platform/tests/venture-outreach.test.ts platform/tests/venture-send-governor.test.ts platform/tests/venture-leads-methods.test.ts platform/tests/venture-connectors-leads.test.ts platform/tests/venture-pipeline.test.ts` shows `# fail 0`.

### Package 4E3: inbound mail, reply triage, read-backs and "after a call" (E)

Size L. After 4E1. Rows: K8, C10, C11 (triage), C15, C17.

**Files:** new `network/imap.ts` (a read-only IMAP client over `node:tls`: LOGIN, EXAMINE, UID SEARCH, UID FETCH BODY.PEEK; no new dependency), `network/mailbox.ts`, `network/inbound.ts` (matching and triage), `network/bounces.ts` (DSN reading), `network/inbound-rows.ts`, `network/calendar-feed.ts`, `network/meeting.ts`; tests `platform/tests/venture-mailbox.test.ts`, `venture-inbound.test.ts`, `venture-meeting-digest.test.ts` (new), with a scripted fake IMAP server on a socket pair.

**Failing tests first:**

1. `venture.mailbox.connect {host, port, user, appPassword}` (app only): the host passes the net guard (public address, TLS); the app password goes to the engine's secret store, never a record or a log; the mailbox is opened with EXAMINE (read-only) and messages are fetched with `BODY.PEEK` so nothing is marked read; a server that asks for OAuth answers `MAILBOX_OAUTH_ONLY` ("This account only allows Google or Microsoft sign-in, so it can't connect this way. Use an app password, or keep recording replies by hand.").
2. `venture.mailbox.sync {}` reads new messages since the stored UID cursor; a changed UIDVALIDITY rescans the last 30 days; only messages from people in the network or the pipeline are kept, as `venture-inbound` (from, to, date, subject, references, matched, triage, `processed`), and their text passes the untrusted screen before any agent reads it. Chausar's processing state is its own and never touches the mailbox's read state.
3. Matching (C15): a reply from a card's person after a recorded send matches with a confidence computed in code (exact address 0.7, the draft's subject 0.2, within 30 days of the send 0.1); at or above 0.65 and at least 0.15 ahead of the next card it attaches; otherwise a confirm row asks "Is this from Priya about Acme?" (`venture.inbound.confirm`).
4. Triage in code before any model call (C11, C10): opt-out phrases ("unsubscribe", "stop", "remove me", "मत भेजो", "बंद करो") put the address on the blocklist for good and close the card as Lost, reason opted out; an auto-reply or out-of-office (an `Auto-Submitted` header or fixed phrases) is ignored and pushes the follow-up out; a one-word thanks needs nothing; a delivery report (`multipart/report; report-type=delivery-status`) with a 5.x.x status marks the address bounced and blocks it, a domain failure (5.1.2, 5.4.4) blocks the domain, a 4.x.x status suppresses the address for 90 days; replies that mention price, a contract, a meeting or buying skip the agent and become a `reply` row with a code-built line ("Priya asked about pricing. Reply yourself."); "are you a bot" gets one fixed honest draft ("I use an AI assistant to help draft messages, and I read and send every one myself."); any other reply proposes moving the card to Talking, which the owner confirms on Today. Identity for matching goes email first, then LinkedIn URL, then name and company.
5. Calendar by address (D-Network "read each morning"): `venture.network.calendar {url}` (app only) stores a private ICS address; a Keeper job reads it each morning through the net guard with redirects refused and adds meeting facts like a file import.
6. After a call (C17): when an event with a person from the network has ended, a notice row says "Add notes from your call with Rahul?"; `venture.meeting.digest {eventId, notes}` (chat consent) returns people mentioned, intros promised by either side and next steps, each as a drafted proposal (a pipeline next step or an intro draft) for the owner; a date the model gives is kept only when the same date is written in the notes, else the step has no date.

**Implementation notes.** `guardedFetch`, `resolvePublic` (`core/net-guard.ts`); `screenUntrusted` (`policy/untrusted.ts`); `optOut`, `addToBlocklist` (`customers/leads.ts`); the secret store the model keys use (`secrets` in the model port options); `draftProposal` (4-0). The fake IMAP server lives in the test file.

**UI pieces:** none (4E4). Feeds D-Clients (Talking column, reply rows) and Connections (mailbox and calendar cards).

**Done when:** `node --test platform/tests/venture-mailbox.test.ts platform/tests/venture-inbound.test.ts platform/tests/venture-meeting-digest.test.ts` shows `# fail 0`.

### Package 4E4: the Pipeline board, follow-ups, draft sheet and mailbox on screen (U)

Size L. After 4E1 to 4E3, 4D4 and W3's 3E2, 3B4.

**Files:** `app/ui/src/places/clients/PipelineTab.tsx` (stages Found to Not now), new `PipelineTiles.tsx`, `DueList.tsx`, `Funnel.tsx`, `OutreachSheet.tsx`, `CardSheet.tsx`; new `app/ui/src/places/connections/Mailbox.tsx`, `CalendarFeed.tsx` and one line each in `connections/index.tsx`; new `app/ui/src/places/today/MeetingNotes.tsx` (the "Add notes" sheet); `app/ui/src/engine/fake-network.ts`; `app/ui/src/text/{en,hi}/clients.json` (`clients.pipeline.`, `clients.outreach.`), `connections.json` (`connections.mailbox.`), `today.json` (`today.followup.`, `today.reply.`); tests `app/ui/tests/places/clients-pipeline.test.tsx`, `clients-outreach.test.tsx`, `connections-mailbox.test.tsx` (new), `today-w4.test.tsx` (cases), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. The board "Pipeline board. Drag a card, or press the bracket keys to move it." has the seven stages with their sub lines and counts; Lost and Not now folded ("Show Lost, 2 people"); a card shows initials, name, company, StrengthDots, PathLine and its via line, the next step and due date (late in wait words: "Follow up 21 Oct, 2 days late"), the draft line ("Intro drafted, for WhatsApp") and the business initials. `[` and `]` move a card through `venture.pipeline.move`; a refusal shows the engine's words and the card stays.
2. The four tiles, the filter chips (All, Due soon, Has a draft, one per business) and the path-line legend; "Due today and late" with Open WhatsApp, Open in Mail or Open in LinkedIn and I sent it; "How people moved" as a BarChart with its receipt and "View chart data".
3. The outreach sheet: to and connector, the note, "Note she can forward, 4 sentences" with the blurb, a live counter for connection notes ("142 of 200"), the footer shown only on cold drafts, lints as warnings, Send it yourself from Mail, LinkedIn or WhatsApp (each calls `venture.outreach.open` and performs the handoff: `mailto:`, copy then open the profile, or `wa.me`), then I sent it (`venture.outreach.sent`). The line "Chausar never sends. It opens the app with the text filled in." is always shown.
4. Today follow-up and reply rows use the card layout with the handoff as the primary; meeting-notes notices open the notes sheet.
5. Connections: the mailbox card (the app password field outside any form, `autocomplete="off"`, cleared in `finally`, as W1's U15 rule), the OAuth-only line, last sync; the calendar address card.
6. The card sheet shows the timeline (sent, scheduled, projected "estimated"), the score with its reasons, the trigger and the lawful basis picker for cold email.

**UI pieces:** D-Clients (all of it), D-Network (draft sheet), D-Today (rows).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/clients-pipeline.test.tsx app/ui/tests/places/clients-outreach.test.tsx app/ui/tests/places/connections-mailbox.test.tsx app/ui/tests/places/today-w4.test.tsx app/ui/tests/places/clients-leads.test.tsx app/ui/tests/a11y.test.tsx` all pass.

---

## 4F: run controls and breakers

### Package 4F1: Stop, Force stop, Resume, the round gate, steering, pause and Away (E)

Size L. Rows: O1, O2, O3, O4, O21; W3's U6 (estimates after three runs) and U7 (per-call progress); spec 5.6; spec 8 "stop during an irreversible send".

**Files:** new `delivery/run-controls.ts`, `delivery/run-control-rows.ts`, `delivery/away.ts`, `delivery/estimates.ts`; `delivery/runs.ts` (`approveHarnessTurn`: the stop check and the `run.call` events), `delivery/harness/loop.ts` (`applyTurn`: stop between calls; `settle`: the round gate), `delivery/harness/env.ts` (`ToolEnv.stopRequested()`), `views/runs.ts` (stopping and stopped words, the scope line, estimates), `views/queue-w4.ts` (`continue`, `stop`, `resume` decides); tests `platform/tests/venture-run-controls.test.ts`, `venture-run-gate.test.ts`, `venture-away.test.ts`, `venture-run-estimates.test.ts` (new).

**Failing tests first** (a YouTube run with a scripted model and fake tools, as in `venture-harness-runs.test.ts`):

1. Stop on a run waiting for the owner's approval of its next turn: `venture.runs.stop {runId}` (app only) sets status `stopped`, voids the preview (its call is released and never sent), keeps every finished step, and emits `run.stopped`; the run sheet reads "Stopped by you. Finished steps are kept."; a Today row offers Resume (primary) and Run again.
2. Stop while a turn is running (the approve call is in flight): the stop is recorded on the run (`control.stop`); the tool call in progress finishes and its result is kept; every later call in that turn is cancelled with "You stopped the run, so this call did not run."; then the run is `stopped`. The turn line reads received, stopping, stopped (O1).
3. Force stop (`force: true`) while in flight: the run is `stopped` at once and the reply names what is lost ("The step in progress is thrown away: Render the thumbnails. Anything already sent stays sent."); when the in-flight call returns, its result is not stored, except a journalled outside effect, which settles as its journal says. Stop during an irreversible send (a fake posting connector that is mid-call) leaves that post `applied` or `outcome_unknown` and it is never sent again (spec 8).
4. Refusals: `RUN_NOT_FOUND`; `RUN_NOT_RUNNING` for done, failed, accepted or rejected runs; `RUN_ALREADY_STOPPED`; from the phone channel `APP_APPROVAL_REQUIRED`.
5. `venture.runs.resume {runId}` (app only) puts a stopped run back to waiting for approval with a fresh preview of its next turn (the write turn when its limits are spent); a force-stopped step is done again; a run keeps its own playbook version even if a newer one is in use; `RUN_NOT_STOPPED` otherwise. "Start again" is Run again, which keeps finished step 1 where the playbook allows ("Run again keeps step 1").
6. Round gate (O2): `venture.runs.roundGate {runId, on: true, every: 1}` (app only; `every` one of 1, 2, 3, 5): after each round the run waits as a Today question row "Round 2 of Shorts from episode 13 is done: 3 tool calls, 1 failed. Continue or stop?" with Continue (primary) and Stop. Continue may carry a short instruction into the next turn's input (`ownerNote`). The gate names its reason: finished, limit reached ("Allow 2 more turns?", which raises the run's turns by 2 once, within `TURN_CHOICES`), needs an answer, blocked, or failures in a row. Three rounds that end with the same set of error codes stop the run ("Stopped: three rounds ended the same way.").
7. Steer (O3): `venture.runs.steer {runId, text}` (at most 500 characters, secret screen) queues a note for the next turn; the run sheet shows "Sent. Waiting for the agent to pick it up." and then "Picked up in turn 3"; it is used once.
8. Pause all and stop all (O4): `venture.business.pause {paused: true}` (app only) refuses new runs (`BUSINESS_PAUSED` on `venture.delivery.run` and on approve), routines skip with "Paused by you", and every agent on Team reads "Paused"; `stopRunning: true` also stops each running run as in test 2. Unpausing changes no run.
9. Away (O4): `venture.away.set {from, to}` (app only) and `venture.away.get {}` return a code-built list: client promises falling due between the dates (order and invoice due dates), what keeps running (routines, Keeper jobs), how many approvals will wait, and an auto-reply text with real response times for the owner to paste into their own mail app (Chausar sends nothing); on return Today's filter "Since you left" lists rows made while away.
10. Scope line (O21): when a run starts, its scope is frozen on the record (the tools granted in purpose words, the outside actions it may propose, its spend cap, its posture); `venture.runs.get` returns `scope`. A step that needs a connector that is only planned refuses the run to start with `RUN_CAPABILITY_MISSING` ("This run needs posting to LinkedIn, which is planned. Nothing was put in its place.").
11. Estimates (U6): `RunSummary.estimate` ("Usually 3 to 5 min", the lowest and highest of the last five finished runs of the same playbook steps, in whole minutes) appears only once three such runs have finished.
12. Per-call progress (U7): each tool call in a turn emits `run.call` with `{runId, callId, state: 'start' | 'done' | 'error'}` and no words; `RunStep.tools` lines gain each call's state and measured time.

**Implementation notes.** `approveHarnessTurn`, `markFailedWhenSpent`, `runView` (`delivery/runs.ts`); `applyTurn`, `settle`, `actTask`, `TURN_CHOICES` (`delivery/harness/loop.ts`, `patches.ts`); `applyAction`, `resolveIn` (`journal/journal.ts`) for effects in flight; `positionOf`, `deliveryRun` (`views/runs.ts`); `ownerToday`, `localDayAt` for Away dates. A stop request is read from the store between calls through `env.stopRequested()`, so it works while the approve call is running.

**UI pieces:** none (4F3). Feeds D-Work (Stop on tiles, the stopped tile), D-Today (running rows).

**Done when:** `node --test platform/tests/venture-run-controls.test.ts platform/tests/venture-run-gate.test.ts platform/tests/venture-away.test.ts platform/tests/venture-run-estimates.test.ts platform/tests/venture-harness-runs.test.ts platform/tests/venture-views-runs.test.ts` shows `# fail 0`.

### Package 4F2: breakers, failure words, write caps and spend limits (E)

Size M. After 4F1. Rows: H22, H32, H35, O14, M2 and M3 (the parts that survive: usage rows for own-key calls, meters, the "limit reached" sheet; credits and plans are a spec non-goal), M4, M5, M6, M7.

**Files:** new `delivery/harness/breaker.ts`, `delivery/harness/repair.ts`, `delivery/harness/write-caps.ts`, `delivery/failure-words.ts`; `delivery/harness/loop.ts` (one breaker call in `applyTurn`); `money/spend.ts` (meters, thresholds, daily cap, rate states, the payer line); tests `platform/tests/venture-breaker.test.ts`, `venture-failure-words.test.ts`, `venture-write-caps.test.ts`, `venture-spend-meter.test.ts`, `venture-rate-honesty.test.ts` (new).

**Failing tests first:**

1. Breaker (H22): a run stops (status `stopped`, `stopReason` naming the trigger) when the same error signature (tool, code, normalised message) comes back 3 times; when the same action (tool and input digest) runs 3 times, whatever its outcome; or after 5 failed calls in a row. The thresholds are frozen constants, and no limit patch or setting reaches them (`limits.turns` patches leave them unchanged). The Today row reads "Editor's run stopped: the same error came back three times: ffmpeg was not found on this computer." with Resume and Run again; on Resume the next turn's input carries `alreadyTried` (each tool, what it tried in purpose words, and the error) with the line "These were tried and failed. Don't repeat them."
2. One repair turn (H35): a turn the model returns in a shape `validateTurn` refuses gets exactly one repair turn ("Your last answer could not be read: {reason}. Answer again in the same shape."), reserved against the run's cap; a second bad shape fails the run with that reason; no third try.
3. Failure words (O14): a fixed table by kind gives one sentence and a fix: allowance spent ("This month's AI limit is used up. Raise it in Money, or wait until 1 Nov."), not signed in, offline ("Your computer seems offline. Chausar tries again when it is back."), too long for the AI in one go, out of date; only offline is transient. A connector error carries its action reason (a duplicate is looked up and adopted, already done is a success, past its deadline goes to a person). An unknown provider error never echoes its raw text ("The AI service answered with an error Chausar doesn't know. Nothing was retried."). A missing permission turns the action into a flagged draft, never a silent drop. `RunDetail` gains `fix` (the "How to fix it" words), for example ffmpeg missing: "Install ffmpeg, or turn off the finishing check, then run again."
4. Write caps (H32): per business per local day, agents may make at most 30 drafts, 500 books lines and 40 messages for people (the owner may lower each); the next one fails with `WRITE_CAP_REACHED` ("Chausar stops agents at 30 drafts a day so a stuck agent can't flood you.") and a Today row; `venture.runs.allowWrites {kind}` (app only) raises that cap once for the day.
5. Meters (M4, M3): the spend policy gains a daily cap and an alert threshold (default 800 permille); `venture.spend.policy.get` returns a meter (`usedPermille`, "79% of this month's limit used", near, its receipt); at the threshold one Today notice a month; per-agent monthly caps pause only that agent with a Today row; past the cap the "limit reached" sheet data offers raise the limit, connect another key, or wait until the reset date (with the date), never credits. "About 12 more drafts at today's cost" is computed in code from the last 10 drafts' costs and labelled "projection from your last 10 drafts" with its receipt.
6. Pressure (M5): at 80 percent of a run's cap or the day's cap, the next turn's input says "Budget nearly used: report what you have; don't start new work."; steps marked `optional` are skipped with "Skipped polishing to stay within this month's limit" (no shipped step is optional until W5 marks some); the automatic judge (W2 2C1) does not run past the threshold and says "Not checked: this month's limit is nearly used"; code checks always run.
7. Rate honesty (M6): each rate on the card is `confirmed` (the owner's checked rate with its source URL and date) or `list` (Chausar's list price with its checked date); a receipt shows the price snapshot date; prompt-cache read and write rates are separate lines; a cost states estimate, provider-reported, unknown or free on this computer; a refused paid call is never sent to another paid service instead.
8. Which wallet pays (M7): with two keys that could serve a tier, the call is refused `PAYER_AMBIGUOUS` until the owner picks one; with one, the preview names it ("Paid by your Anthropic key"); an unreadable balance is "unknown", never zero; an estimate that depends on something unmeasured stays a range ("₹380 to ₹520") and a single figure takes the high end. Own-key calls write a usage row at zero Chausar cost (M2's surviving part).

**Implementation notes.** `applyTurn`, `validateTurn`, `reserveRunCall` (`delivery/harness/loop.ts`); `resolveRate`, `ownerRates`, `monthSpendNow`, `reserveSpend`, `spendPolicyGet`, `spendPolicySet`, `rupeeFigure` (`money/spend.ts`); `transport.ts` retry classes from W1 1B for "offline".

**UI pieces:** none (4F3, 4J20). Feeds D-Work ("What went wrong", "How to fix it"), D-Money (meters).

**Done when:** `node --test platform/tests/venture-breaker.test.ts platform/tests/venture-failure-words.test.ts platform/tests/venture-write-caps.test.ts platform/tests/venture-spend-meter.test.ts platform/tests/venture-rate-honesty.test.ts platform/tests/venture-spend*.test.ts` shows `# fail 0`.

### Package 4F3: run controls on Work, Today and the run sheet (U)

Size M. After 4F1, 4F2 and W3's 3E1, 3C, 3B5a.

**Files:** `app/ui/src/places/work/RunTiles.tsx` (Stop), `StoppedRun.tsx` ("How to fix it", Resume), new `StopDialog.tsx`, `RoundGate.tsx`; `app/ui/src/parts/RunSheet.tsx` (steer box, scope line, estimates, per-call states); `app/ui/src/places/today/WorkingNow.tsx` (Stop on running rows); `app/ui/src/shell/BusinessMenu.tsx` (Pause all, Stop all, Away); new `app/ui/src/places/business/AwayView.tsx`; `app/ui/src/engine/fake-w4.ts` (run controls desk); `app/ui/src/text/{en,hi}/work.json` (`work.stop.`, `work.gate.`), `common.json` (`runsheet.steer.`, `runsheet.scope.`), `business.json` (`business.away.`); tests `app/ui/tests/places/work-controls.test.tsx`, `business-away.test.tsx` (new), `tests/parts/sheet-steps.test.tsx` (cases), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. Each running tile on Work and each running row on Today has "Stop run 31"; it opens a dialog with Stop (keeps finished steps) and Force stop (names what is lost, asks once more); after Stop the tile reads "Stopping" until the engine says stopped. W3's "no Stop button" assertion is flipped.
2. The stopped tile: "What went wrong" with the engine's error, "How to fix it" with `fix`, Resume (primary) and Run again; a breaker stop shows its trigger words.
3. The round gate row and its Continue box (instruction optional); the run sheet's steer box ("Tell Editor something for its next step") with the engine's states; the scope line under the run's title; "Usually 3 to 5 min" only when the engine sends it; per-call states as shapes and words.
4. The business menu has Pause all (second ask), Stop all (second ask, names how many runs stop) and Away; the Away page shows the engine's list and the paste-ready auto-reply with Copy.
5. `assertOnePrimary` passes on Work; every new string is in `en` and `hi`.

**UI pieces:** D-Work (`.rt*` Stop, `.stopped`, `.sd-*`), D-Today (Working now).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/work-controls.test.tsx app/ui/tests/places/business-away.test.tsx app/ui/tests/parts/sheet-steps.test.tsx app/ui/tests/places/work-v2.test.tsx app/ui/tests/a11y.test.tsx` all pass.

---

## 4G: notifications, digest and phone push

### Package 4G1: the notification centre, digest and the event sequence (E)

Size M. Rows: O12; W3's U20 (sequenced stream with gap replay); spec 5.7.

**Files:** new `notify/centre.ts`, `notify/digest.ts`, `notify/settings.ts`, `notify/index.ts`; `host.ts` (after a commit whose events include `queue.changed` or `run.waiting`, call `notify.refresh`; one edit); `core/events.ts` (run events carry `seq`); `platform/runtime/engine.ts` and `server.ts` (`seq` on IPC and SSE frames; one line each); tests `platform/tests/venture-notify.test.ts`, `venture-digest.test.ts`, `venture-events-seq.test.ts` (new).

**Failing tests first:**

1. One chokepoint: when a needs-you row first appears (any kind except `locked`), `notify.refresh` writes one `venture-notification` keyed by the row's subject; the same subject never notifies again, across row versions; `notify.new` is emitted with `count` only.
2. `venture.notify.list {}` returns items (row id, kind, the row's title for the in-app centre, time, read) newest first and `unread`; `venture.notify.read {ids}` or `{all: true}` marks them.
3. `venture.notify.settings` (app only): `pausedUntil` at most 30 days ahead (`NOTIFY_PAUSE_TOO_LONG`), and nothing is replayed after a pause ends; `quietHours {from, to}` in the business time zone; `digest {hour}` or off; `push` and `tray` switches. The answer also lists what keeps running while the app is closed (Keeper jobs and routines, from records).
4. Rules for outside alerts (push, tray, the OS): only needs-you items, once each; nothing while the owner has had an open event stream in the last 2 minutes; quiet hours hold alerts and then send one count when they end, while the in-app centre still lists everything; an item expiring within 2 hours (4J1's `expiresAt`) passes quiet hours, at most 6 a day; at most one alert per 10 minutes, then 30, then 60 while the owner does not open the app.
5. The digest at the chosen hour is code, no model: "Today: 5 need you (3 to approve, 2 questions). 2 runs finished. ₹18,880 is ready to invoice." with every figure from a receipt, or "Nothing needs you today."; an item already in yesterday's digest is not listed again, only counted as "still waiting".
6. Every run event frame on IPC and on `/api/events` carries `seq`; `venture.events {afterSeq}` returns exactly the missed ones, so a client that reconnects replays the gap (U20).

**Implementation notes.** `queueListHandler` (`views/queue.ts`) called as a function; `ventureEvents` (`core/events.ts`); `localDayAt`, `ventureTimeZone` (`local-day.ts`); `booksSummary` and 4I1's goal figures for the digest.

**UI pieces:** none (4G4). Feeds the bell in every D board header.

**Done when:** `node --test platform/tests/venture-notify.test.ts platform/tests/venture-digest.test.ts platform/tests/venture-events-seq.test.ts platform/tests/venture-views-events.test.ts` shows `# fail 0`.

### Package 4G2: needs-you probes (E)

Size M. After 4G1, 4E3, 4F2 and 4J7 (its probes read their data). Rows: O10.

**Files:** new `views/probes.ts` (fills 4-0's `noticeRows`); tests `platform/tests/venture-probes.test.ts` (new).

**Failing tests first:**

1. Each probe is code, has a severity and a deep link, and runs inside its own try and catch: a probe that throws is skipped, writes a Keeper run `probes` with its failure, and never stops the list.
2. Probes: posts that failed or are `outcome_unknown` in the last 7 days; a broken connection (an unusable model connection, a failed connection check from 4J7); drafts waiting more than 3 days; unread client replies (4E3); a gap in next week's social calendar (slots with no draft); spend at the alert threshold (4F2); a figure that moved sharply (weekly received or billed with a z-score over 3 on at least 7 points; the row shows both figures with receipts and says "Moved sharply this week"); a stalled client ("No reply from Asha in 14 days" for a Talking card or an open quote 14 days unanswered).
3. Each probe row is kind `notice`, deduped by subject, with Open and Later; Later is remembered and the same probe does not come back until its facts change.

**Implementation notes.** `listRecords`, `journalListHandler`, `openSpendQuotes`, 4E1's cards, 4F2's meter; integer arithmetic for the z-score on weekly totals in whole rupees.

**UI pieces:** none. Notice rows render as compact cards in 4J19.

**Done when:** `node --test platform/tests/venture-probes.test.ts platform/tests/venture-views-queue.test.ts` shows `# fail 0`.

### Package 4G3: web push, the phone relay and the tray count (E)

Size M. After 4G1. Rows: O13; W3's O23 (tray).

**Files:** new `notify/webpush.ts` (VAPID JWT with ES256 and RFC 8291 `aes128gcm` encryption on `node:crypto`; no new dependency), `notify/push-methods.ts`, `notify/relay.ts`; `platform/runtime/hosted/config.ts` (the VAPID keys, passed to the hosted venture actor's deps; no new route, since the methods go through `/api/rpc` and `sw.js` is served with the Ink files); new `app/ui/public/sw.js` (on push: one notification "Chausar" with the body "3 need you", tag `chausar-count`; on click: open `/app/#/approve/next`); `app/desktop/main.cjs` (tray tooltip and menu line "3 need you", a count-only OS notification, the one-time "still running" balloon); tests `platform/tests/venture-webpush.test.ts`, `venture-relay.test.ts` (new), `platform/tests/desktop-main.test.ts` (cases).

**Failing tests first:**

1. Encryption follows RFC 8291: the test vectors of its Appendix A give the same ciphertext; a push for a business with 3 unnotified items is sent with a payload that decrypts to exactly `{"count":3}`, TTL one hour, and no other field; no row title, name or figure is ever in a payload.
2. `venture.notify.push.key {}` returns the VAPID public key on the hosted app; on the desktop it is `TIER_UNAVAILABLE` ("Phone alerts need the hosted app. On this computer the tray shows the count."). `venture.notify.push.subscribe {subscription}` (app only) accepts only https endpoints on the known push services (Google, Mozilla, Microsoft, Apple hosts), else `PUSH_ENDPOINT_REFUSED`; the request goes through the net guard. A 404 or 410 answer removes the subscription; any other failure is logged and tried once more at most.
3. Push permission denied in the browser leaves the in-app centre working, and the settings say push is off (spec 8; the words are 4G4's).
4. Relay (O13 from the desktop): `venture.notify.relay {url}` (app only) stores an owner-set https address (an ntfy topic or similar); alerts post `{"count":3}` only, through the net guard with redirects refused; `url: null` clears it.
5. Tray: on `notify.new` the desktop tray tooltip reads "Chausar: 3 need you" and its menu has "3 need you", which opens the window at `#/approve/next`; the OS notification says only the count; the first time the window closes on Windows, one balloon says "Chausar is still running. It keeps your scheduled checks going." and never again.

**Implementation notes.** `guardedFetch` (`core/net-guard.ts`); the alert delivery pattern of W2 2D (`alertDeliveries`, count only); `createBackgroundTray` (`app/desktop/main.cjs`); the hosted event stream for "owner active".

**UI pieces:** none (4G4). The service worker file is plain JavaScript in `public/`, not a React part.

**Done when:** `node --test platform/tests/venture-webpush.test.ts platform/tests/venture-relay.test.ts platform/tests/desktop-main.test.ts platform/tests/hosted-server.test.ts` shows `# fail 0`.

### Package 4G4: the bell, the centre, Notifications settings and the approval page (U)

Size M. After 4G1 to 4G3 and W3's 3A2, 3B4, 3H1.

**Files:** new `app/ui/src/shell/Bell.tsx`, `NotificationCentre.tsx` (sheet `notifications`), new `app/ui/src/places/approve/index.tsx` (the standalone approval place, `#/approve/next` and `#/approve/<rowId>`), new `app/ui/src/places/business/NotificationsView.tsx`, `app/ui/src/main.tsx` (service worker registration on the hosted app only), `app/ui/src/engine/events.ts` (replay with `afterSeq` on reconnect), `app/ui/src/parts/RunSheet.tsx` (the "3 things need you (1 of 3)" banner with jumps); `app/ui/src/engine/fake-notify.ts`; `app/ui/src/text/{en,hi}/common.json` (`bell.`, `centre.`, `approve.`), `business.json` (`business.notify.`); tests `app/ui/tests/shell/bell.test.tsx`, `app/ui/tests/places/approve.test.tsx`, `business-notify.test.tsx` (new), `tests/engine/events.test.ts` (cases), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. The NotificationBell sits in the page header's tools and in the phone top bar ("Notifications, 2 new"); it opens the centre sheet listing items with their times; Mark all read; no number on the icon.
2. Business > Notifications: pause until a date (at most 30 days), quiet hours, digest hour, push on or off, tray on or off, and the "keeps running while closed" list. Turning push on runs a walkthrough that asks the browser for permission only on that click and checks the permission state live while the page is open (W3's U18); denied shows "Push is off: your browser blocked it. The bell still works." (spec 8).
3. `#/approve/next` shows the oldest waiting approval as one card (the same ApprovalRow card with its second ask and view-before-approve), and "Next" after deciding; `#/approve/<rowId>` shows that row or "This one was already decided." (O11).
4. A run sheet over a run with several waiting items shows "3 things need you (1 of 3)" with jumps.
5. On reconnect the event client asks `venture.events {afterSeq}` and applies the missed frames once (a test drops two frames and sees both applied).

**UI pieces:** the bell in every D board header (`.ib .dot`); the approval card from D-Today.

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/shell/bell.test.tsx app/ui/tests/places/approve.test.tsx app/ui/tests/places/business-notify.test.tsx app/ui/tests/engine/events.test.ts app/ui/tests/a11y.test.tsx` all pass.

---

## 4H: models and the CLI status

### Package 4H1: CLI status checked against the installed tools, and model records (E)

Size M. Rows: H36, H39, M19, M2 (own-key usage rows, with 4F2); W3's K10 (CLI detection) and U17 ("names the engine that wrote it"); spec 5.3; spec 8 "CLI not installed, not signed in, or the hosted app".

**Files:** new `models/cli-status.ts`, `models/roles.ts`; `models/port.ts` (`checkCli` becomes the full status; the provider-reported model on every call), `models/presets.ts` (availability from the status), `models/cli.ts` (H39 flags), `models/handlers.ts` (two methods); tests `platform/tests/venture-cli-status.test.ts`, `venture-model-records.test.ts` (new), `venture-models*.test.ts` (updated).

**Failing tests first** (a fake process transport):

1. `venture.models.cli.status {}` on the desktop returns, for Claude Code and for Codex: `found` (the path from `findOnPath`), `version` (the first version number in `--version`'s output), `flags` (`match`, `mismatch` or `unknown`) with `missingFlags`, `signedIn` (`yes`, `no` or `unknown`), `terms` (`accepted`, `pending` or not needed), the last real task's outcome, one plain line and one fix.
2. Flags: `--help` (5 second timeout) must list every flag `cliArguments` uses for Claude Code (`--print`, `--tools`, `--disallowedTools`, `--strict-mcp-config`, `--mcp-config`, `--no-session-persistence`, `--output-format`, `--model`, `--max-turns`, `--json-schema`, `--system-prompt` and the rest) and every flag `buildCodexCliArguments` uses for Codex; a missing one makes `flags: 'mismatch'` and `venture.models.connect` for that preset is refused `CLI_FLAGS_UNSUPPORTED` naming the flags ("Your Claude Code 2.3.1 doesn't know --safe-mode. Update it, or use an Anthropic key.").
3. Signed in: only from a status command the tool's own help lists, read for a fixed success phrase; when the help lists none, `signedIn: 'unknown'` with "Chausar can't check your sign-in without running a task. It will say so if the first task fails." It is never `yes` without that evidence.
4. Not installed: `found: false` with "Claude Code isn't installed on this computer." and agents that need the AI wait with "Connect your AI" (the team view's now line); the hosted app answers `TIER_UNAVAILABLE` ("The hosted app uses keys only.") and lists no CLI (spec 8). A CLI that is found, matches and has accepted terms stays `unverified` until one real task succeeds, then `ready`.
5. Text-only calls (H39): a `claude-cli` call has tools off, no MCP servers, no session kept, an empty temporary folder as its working folder, the prompt on stdin and a timeout; the test reads the process request. The Claude Code terms gate holds as today.
6. Model records (H36): every `venture-model-call` stores `answeredBy`, the model the provider's answer names (Anthropic and OpenAI responses, the CLI's output where it names one), else "not reported"; spend rows and run lines show it; a draft says "Written by Claude Sonnet 5.5" or, for a template, "Written by Chausar's template, not your AI" (U17).
7. Per-role models (M19): `venture.models.roles {}` lists each agent with its steps' tiers (`fast` for the work, `main` for checking or writing, as the playbook says), the preset that serves each tier and its price line; choosing a different connected preset per tier uses today's tier routing. A choice per role beyond tiers is not offered, and the answer says the team runs as one agent.

**Implementation notes.** `checkCli`, `presets`, `usableOf`, `problemOf` (`models/port.ts`); `availabilityOf`, `AVAILABILITY_REASONS` (`models/presets.ts`); `cliArguments` (`platform/runtime/gateway.ts`), `buildCodexCliArguments` (`providers/codex-cli.ts`), `claudePlan`, `cliEnv` (`models/cli.ts`); `findOnPath` (`playbooks/youtube/finishing.ts`).

**UI pieces:** none (4H2). Feeds Connections > Your AI.

**Done when:** `node --test platform/tests/venture-cli-status.test.ts platform/tests/venture-model-records.test.ts platform/tests/venture-models*.test.ts` shows `# fail 0`.

### Package 4H2: Your AI with the real CLI status (U)

Size S. After 4H1 and W3's 3G1.

**Files:** `app/ui/src/places/connections/YourAi.tsx`, new `CliStatus.tsx`; `app/ui/src/places/team/AgentSheet.tsx` (one line: the role's model lines, after 4B3); `app/ui/src/engine/fake-w4.ts` (models desk); `app/ui/src/text/{en,hi}/connections.json` (`connections.cli.`); tests `app/ui/tests/places/connections-cli.test.tsx` (new).

**Failing tests first:**

1. Your AI lists Claude Code and Codex on the desktop with found (path hidden behind a disclosure), version, flags, signed in, terms, each with its one fix line, and "Check again" calling `venture.models.cli.status`; the hosted app shows keys only with the engine's line.
2. A preset with `CLI_FLAGS_UNSUPPORTED` cannot be connected and shows the engine's words; the key field keeps W1's rules.
3. Agent cards show "Connect your AI" when no tier is usable; the agent panel lists the role's tiers with the preset and price line; run results say who wrote them.

**UI pieces:** built from D-STYLE pieces (tiles, chips, rows).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/connections-cli.test.tsx app/ui/tests/places/connections.test.tsx` all pass.

---

## 4I: goals

### Package 4I1: goals, progress with receipts and the next best step (E)

Size M. Rows: none of its own (the founder's goals decision; W3's U1 ranking); spec 3 "Today"; spec 8 "goal not set".

**Files:** new `money/goals.ts`, `money/goal-plans.ts` (the `invoiced` and `goal` plans), `money/next-step.ts`; `money/index.ts` (three lines); tests `platform/tests/venture-goals.test.ts`, `venture-next-step.test.ts` (new).

**Failing tests first** (clock 23 Oct 2026, business time zone Asia/Kolkata):

1. `venture.goals.set {month: '2026-10', amountMinor: '15000000'}` (app only) stores a `venture-goal`; a non-integer, zero, negative or over-15-digit amount is `GOAL_INVALID`; a past month `GOAL_MONTH_PAST`; a newer goal for the same month replaces it in use and the old stays in history.
2. `venture.goals.get {}` returns: `invoiced` (issued invoices this month before tax, a sum receipt with subject `invoiced` listing each invoice); `ready` (draft invoices ready to issue, same basis); `goal`; `invoicedPermille` and `readyPermille` of the goal (BigInt floor; past the goal says "Past the goal" and the bar is full); `pacePermille` (days elapsed over days in the month, integers); `ahead` or `behind` today's pace (`goal` subject receipt showing the steps); `stillToInvoice`; `receivedSoFar` (W1's received receipt); `daysLeft`. Every money figure has its receipt.
3. Unset (spec 8): `state: 'unset'` with `lastMonth` (what was invoiced last month, with its receipt) and no suggestion; `venture.goals.suggest {month}` (the owner's AI, the plan's offers and prices only, no client data) returns a figure with `estimate: true`, or `null` with no AI.
4. Next best step (U1): the waiting Today row with the most money at stake (the row's change or invoice total, from receipts), then the nearest deadline; rows without money come after rows with money; the answer carries the row id, title, agent, line, its figure with receipt and "Goal after: 92%" (code); no rows gives `null`. `briefing` lists 3 to 6 row ids in the same order with "and 4 more".

**Implementation notes.** `sumReceipt`, `planTotal`, `receivedPlan`, `openInvoices` (`money/sums.ts`); `listInvoices`, `invoiceView` (`money/invoices.ts`); `receiptFigure` (`money/quote.ts`); `ownerToday` (`local-day.ts`); `queueListHandler` for the rows.

**UI pieces:** none (4I2). Feeds D-Today's goal card and Next best step, D-Money's invoiced tile.

**Done when:** `node --test platform/tests/venture-goals.test.ts platform/tests/venture-next-step.test.ts platform/tests/venture-money.test.ts` shows `# fail 0`.

### Package 4I2: the goal card, the next step and the Goals page (U)

Size S. After 4I1 and W3's 3C, 3F.

**Files:** `app/ui/src/places/today/GoalCard.tsx`, `goal.ts` (maps `venture.goals.get` onto W3's `GoalCardData`), `NextStep.tsx` (now rendered), `index.tsx` (one line); new `app/ui/src/places/business/GoalsView.tsx`; `app/ui/src/places/money/Overview.tsx` (the invoiced tile with the goal); `app/ui/src/engine/fake-w4.ts` (goals desk); `app/ui/src/text/{en,hi}/today.json` (`today.goal.`), `business.json` (`business.goals.`); tests `app/ui/tests/places/today-goal.test.tsx`, `business-goals.test.tsx` (new), `money-w4.test.tsx` (case).

**Failing tests first:**

1. With a goal: the dark card shows the invoiced figure "of {goal}", the percent, the GoalBar labelled "79% of the goal invoiced. Issuing INV-0042 takes it to 92%. Today's pace is 74%.", the legend, the foot figures with dark receipts, "8 days left" and "Change the goal"; W3's fallback test still passes when the goal is unset.
2. Unset: "Set a goal for October" with last month's receipted figure, and the suggestion with the "model estimate" chip only when the engine sends one.
3. The Next best step tile with its figure and receipt and the primary that opens the row; no tile when the engine sends none.
4. Business > Goals sets a month's goal (rupees with two decimals; the engine converts) and lists past goals; Money's invoiced tile shows the goal and bar.

**UI pieces:** D-Today (`.goal`, `.g-*`, the next-step tile), D-Money (`.mt` invoiced tile).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/today-goal.test.tsx app/ui/tests/places/business-goals.test.tsx app/ui/tests/places/money-w4.test.tsx app/ui/tests/places/today-v2.test.tsx` all pass.

---

## 4J: the remaining W4 rows, by area

### Area: owner controls and approvals

#### Package 4J1: approval meta, expiry, the decision record and file-bound approvals (E)

Size M. Rows: O17, J2; W3's O7 rest ("Sends to the client", attempt and last error, character counts, price beside Approve, change count line, saved-rule lines), O8 (client, expiry, stale marking), O15 (the system-line grammar).

**Files:** `views/row-meta.ts` (fills 4-0's `withMeta`), new `journal/decisions.ts`, `policy/allow-session.ts`, `delivery/file-manifest.ts`, `journal/system-lines.ts`; `journal/list.ts` (the `allowedBy` line); `delivery/runs.ts` (`deliveryReviewHandler`: the manifest on Accept); `views/team.ts` (one line: repeated denials into health, after 4A1); tests `platform/tests/venture-approval-meta.test.ts`, `venture-decisions.test.ts`, `venture-file-manifest.test.ts`, `venture-system-lines.test.ts` (new).

**Failing tests first:**

1. `meta` on every row: the client (from the order, invoice, lead or card), the business and the time; `expiresAt` only from a real expiry (a spend quote's hour, a preview's `expiresAt`, a share link, a timed question from 4J13), never invented; `waitingLong` ("Waiting since yesterday") after 24 hours; a draft older than 14 days gets "This draft is 15 days old. Check it still fits."
2. `sendsTo` (`client`, `public`, `bank`, `portal`) from the action's declared effect (W1's effect list) and its connector, so the card can say "Sends to the client"; a row that sends nothing has none.
3. `attempt {n, lastError}` on Run again rows, from the run's earlier attempts. `counts` on post rows, each `{label, count, limit}` from the platform limits register (W2 2B, 2H). `price` on spend rows (`{display, receiptId, line: 'Nothing spent yet'}`, plus "Or use the built-in template, free" when a template path exists). `changeCount` on plan rows, computed by comparing the two plan versions in code ("1 price changed · 2 steps added"), with the details folded and "This comparison doesn't cover wording changes."
4. A decide on an old digest answers `outcome: 'stale'` with "This click did not run anything. Here is the new version." and the latest row.
5. Decision record (O17): every decision writes a `venture-decision` (`subject`, action, `who: 'owner' | 'saved-rule' | 'timeout'`, `ruleId`, reason); a step on auto that ran without asking records `saved-rule` with the gate as its rule, and the journal line reads "Allowed by your Auto setting on 'Cut the episode', without asking" with a Stop always allowing control that sets the gate to hold (`venture.team.gate`). Order of rules: always-ask beats every allow and never beats a deny (a test with a floor step at auto and a deny). `venture.policy.allowSession {stepId}` (app only) lets a held step below the floor run without asking for this engine session only, kept in memory and gone on restart; floor steps (money out, client sends, portals) are `ALLOW_SESSION_FLOOR`. The same tool and input refused 3 times adds the health reason "Asked 3 times for something you refused".
6. File-bound approval (J2): Accept on a draft with files (attachments, work tables or outputs the run made) stores a manifest `{fileId: sha256}`; a later share link, post or send of those files is `FILE_CHANGED` when any byte differs; a new render clears the acceptance and the row returns for review; only the owner's principal (owner or cofounder, in the app channel) accepts: an `approvedBy` field in a payload is refused by `exactPayload`, and an agent may only add an endorsement line, which changes nothing.
7. System lines (O15): every generator of journal lines, Earlier lines and run results follows `<subject> <verb>[ <object>][ · <consequence>]`; a contract test runs each generator over fixtures through `systemLineOk`, and offenders are fixed in the same change.

**Implementation notes.** `queueListHandler`, `summaryOf` (`views/queue.ts`, untouched; `withMeta` runs after); `QUOTE_TTL_MS`, `quoteLive` (`money/quote.ts`, `money/spend.ts`); `journalListHandler` (`journal/list.ts`); `stepGate`, `stepFloorReason` (`policy/posture.ts`, `policy/context.ts`); `deliveryReviewHandler`, `acceptableAsIs` (`delivery/runs.ts`); `shareCreate` and posting's `proposePost` call `checkManifest` (one line each, noted in 4J7).

**UI pieces:** none (4J19). Feeds D-Today card meta and notes.

**Done when:** `node --test platform/tests/venture-approval-meta.test.ts platform/tests/venture-decisions.test.ts platform/tests/venture-file-manifest.test.ts platform/tests/venture-system-lines.test.ts platform/tests/venture-views-queue.test.ts platform/tests/venture-journal.test.ts` shows `# fail 0`.

#### Package 4J2: send back with words, edit and undo, set approval, the triage rule, settings drafts (E)

Size L. Rows: O5, O6, O9, O18; W3's O22 (autosave and recovery for settings, engine side).

**Files:** new `views/queue-actions.ts`, `delivery/revise.ts`, `delivery/merge.ts` (three-snapshot merge by paragraph), `delivery/changes.ts`, `views/triage.ts`, `core/settings-drafts.ts`; `views/queue-w4.ts` (the `send-back` path); `delivery/index.ts` (three lines); tests `platform/tests/venture-send-back.test.ts`, `venture-draft-edit.test.ts`, `venture-set-approval.test.ts`, `venture-triage-rule.test.ts`, `venture-settings-drafts.test.ts` (new).

**Failing tests first:**

1. `venture.queue.sendBack {rowId, digest, text}` (app only) on a draft row: the run gets a revision turn whose input begins "Revise this to: {text}", and the row leaves Today; empty text is `SEND_BACK_EMPTY`; over 300 characters `INVALID_VENTURE_REQUEST`; on a price or plan row it is a deny that keeps the words on its decision; an old digest `APPROVAL_STALE`. `venture.delivery.fix {runId, checks: 'all' | ids}` after failed checks makes a revision that names those checks.
2. `venture.queue.edit {rowId, digest, text}` is deny and reopen with the owner's text stored as the edit, with the hash of the draft it replaced. A later agent revision of that run never overwrites it: the run shows both ("You edited this. The agent's new version is beside yours.") and merges by paragraph: a paragraph only the owner changed keeps the owner's; only the agent changed takes the agent's; both changed keeps the owner's and lists the agent's as a suggestion. A stale replacement offers "Review replacement", then "Confirm replacement" ("This does not merge the entries") or "Keep current, reject change", through `venture.delivery.decideChange`.
3. `venture.queue.undo {rowId}` restores an edit or a send-back until its revision starts (`UNDO_TOO_LATE` after); never for an outside effect (`UNDO_OUTSIDE_EFFECT`); the Restore line promises only "Restored until you edit this again." A sent item opens read-only with "Make a copy", which makes an owner draft with its text.
4. `venture.delivery.changes {runId}` lists paragraph changes between the accepted text and an agent's later edit; `decideChange {runId, changeId, accept}` takes or drops each.
5. Set approval (O9): `venture.queue.set {rowIds, digest}` (app only) takes one digest over the ordered rows the owner picked plus their total quote (a sum receipt); only `connector` and `draft` rows (`SET_KIND_REFUSED` for money, price, invoice, sign-off); an empty pick is `SET_NEEDS_PICK` and there is no "all" value; each item keeps its own journal entry and charge record; one changed item makes the whole set `APPROVAL_STALE`.
6. Triage rule (O18): `venture.triage.preview {text: 'clients with a deadline first'}` maps the words to a typed rule from fixed fields (`due`, `client`, `kind`, `money`, `business`, each ascending or descending) through the owner's AI, or offers the fixed choices with no AI, and returns today's rows re-ranked as a dry run; `venture.triage.set {rule, digest}` (app only) saves it and Today's order uses it; a rule never hides a row.
7. Settings drafts (O22): `venture.settings.draft {form, values}` stores unsent edits of a settings form in the vault (never browser storage) and answers "Saved"; `venture.settings.drafts {}` lists them with times for "Recover unsaved changes from 18:42?"; a draft is cleared only when the real setting method succeeds with the same values.

**Implementation notes.** `queueDecideHandler` (via `queue-w4.ts`), `deliveryReviewHandler`, `approveHarnessTurn`, `writeTask` (`delivery/runs.ts`, `delivery/harness/loop.ts`); `sumReceipt` for the set's total; `journalled` per item.

**UI pieces:** none (4J19). Feeds D-Today cards.

**Done when:** `node --test platform/tests/venture-send-back.test.ts platform/tests/venture-draft-edit.test.ts platform/tests/venture-set-approval.test.ts platform/tests/venture-triage-rule.test.ts platform/tests/venture-settings-drafts.test.ts platform/tests/venture-delivery.test.ts` shows `# fail 0`.

### Area: card previews and order steps

#### Package 4J3: card previews, order stage steps and the Delivered card (E)

Size M. Rows: A17; W3's U8 (previews), order steps and frames on tiles.

**Files:** new `views/previews.ts` (`QueueRow.preview`), `playbooks/order-stages.ts` (stage lists as data), `money/order-steps.ts`, `delivery/delivered.ts`, `delivery/poster.ts`; `money/orders.ts` (`listOrders` rows gain `stages`, `waitsOnYou`), `views/runs.ts` (`delivered` on run details); `views/previews.ts` fills 4-0's `withPreviews` hook; tests `platform/tests/venture-queue-previews.test.ts`, `venture-order-steps.test.ts`, `venture-delivered.test.ts`, `venture-poster.test.ts` (new).

**Failing tests first:**

1. Video: a YouTube draft row's `preview` is `{kind: 'video', title, duration?, chapters?, checks: {passed, run}, posterId?}` with the duration from W2 2E's edit list or transcript when known, the chapter count when the chapters check passed, and the check counts from the run; no field is filled without its source.
2. `venture.files.poster {uploadId}` (desktop, app only) takes one still at a tenth of the cut with ffmpeg into an upload `origin: 'poster'`; no ffmpeg is `POSTER_NOT_AVAILABLE` ("ffmpeg isn't on this computer, so there is no still. Chausar never installs it."); hosted `TIER_UNAVAILABLE`. A preview never carries a made-up image.
3. Paper: an invoice row's preview has the invoice's lines and tax lines as engine-formatted values, the total with its price receipt and "Due in 15 days"; a CA sign-off row has the tax working lines with their receipts (W2 2A).
4. Post: a connector row has the account, platform, exact text, counts against limits, and the attached short's title and length when there is one.
5. Choice: a question with choices lists each option's label and text; a model figure on an option ("Views in 30 days, option B: 12,000 to 18,000") is an estimate only.
6. A row with nothing to show has no preview.
7. Order steps: `venture.order.list` rows gain `stages` from the playbook's list (YouTube: Agreed, Price, Episode, Publish, Invoice, Paid; CA firm: Files in, Books, GST, Invoice, Paid; social: Agreed, Calendar, Drafts, Client OK, Posts, Report, Invoice, Paid; the fixed steps: Agreed, Price, Draft, Sent, Invoice, Paid), each `done`, `waits` (on you), `not-yet`, `always-asks` or `unknown` ("not sure: the last send timed out", from an `outcome_unknown` entry), from records only; and `waitsOnYou` ("2 wait on you: the new price and the episode 14 draft."). A validation test: every flagship has a stage list and every stage has a record rule.
8. Delivered (A17): an accepted run's details list the files it handed over (made by its tools, with digests) and, apart, files changed during the run by someone else, labelled "Changed during this run, not proven to be the agent's."

**Implementation notes.** `queueViewHandler` (`views/queue-view.ts`) for draft text; `invoiceView`, `taxLinesFor` (`money/invoices.ts`); `buildEditList`, `transcriptCues` (W2 2E); `systemFfmpeg`, `findOnPath` (`playbooks/youtube/finishing.ts`); `journalListHandler` for unknown outcomes.

**UI pieces:** none (4J19). Feeds D-Today previews and D-Work order steppers.

**Done when:** `node --test platform/tests/venture-queue-previews.test.ts platform/tests/venture-order-steps.test.ts platform/tests/venture-delivered.test.ts platform/tests/venture-poster.test.ts platform/tests/venture-money.test.ts` shows `# fail 0`.

### Area: the money views W3 needs

#### Package 4J4: aging, in and out, 13-week cash, export, margins (E)

Size L. After 4J5. Rows: M8, M13, M14, P12; W3's M9 and U11 (Export for your CA).

**Files:** new `money/aging.ts`, `money/flow.ts`, `money/cash.ts`, `money/export.ts`, `money/margins.ts`, `money/figure-kinds.ts`; `money/books.ts` (`previous` period and `YYYY-MM` periods); `money/invoices.ts` (`late` on list rows); `app/desktop/main.cjs` save path for exports (temp file, flush, rename, no overwrite unless asked; one handler, after 4G3); tests `platform/tests/venture-money-aging.test.ts`, `venture-money-flow.test.ts`, `venture-money-cash.test.ts`, `venture-money-export.test.ts`, `venture-money-margins.test.ts`, `venture-figure-kinds.test.ts` (new), `platform/tests/desktop-main.test.ts` (case).

**Failing tests first:**

1. `venture.money.aging {asOf?}`: open invoice balances with tax (the books' note on taxed invoices) in five buckets (not due, 1 to 30, 31 to 60, 61 to 90, over 90 days late, from the due date in the business time zone), with counts, amounts and permille of the total (BigInt floor), and one `aging` sum receipt listing each invoice and its bucket; the buckets add up to the total exactly; `venture.invoice.list` rows gain `late {days, line: '71 days late'}`.
2. `venture.money.flow {months: 6}`: per month In (received, with tax), Out (books cost facts from W2 2D, bills paid from 4J5, and AI spend at the owner's rupee rate labelled with that rate; without a rate the AI spend is left out and the month says "AI spend not counted: no rupee rate set"), and What was left; a receipt per month; points scaled to permille of the largest month; a month with no data is `null`, never 0.
3. `venture.money.cash {}`: 13 weekly points from the latest imported bank balance (W2 2D) with its date, or no line and "Import a bank statement to see cash ahead"; the forecast from open invoices' due dates (on time), bills due (4J5) and the usual costs (the average of the last 3 months' Out, labelled an assumption); "Lowest week, if clients pay on time" and "If the 3 late ones never pay"; the assumptions listed; a line that never falls shows no runway words; the next three weeks by date.
4. `venture.books.summary` gains `previous` (last month with its receipt) and accepts `period: '2026-09'`.
5. `venture.money.export {month}` (app only) returns invoices, payments, costs and receipts as CSV text; any cell beginning with `=`, `+`, `-` or `@` is prefixed so it can't run as a formula (P12); the desktop save writes a temporary file, flushes it, renames it, and refuses to replace an existing file unless the owner chose to (`EXPORT_EXISTS`).
6. `venture.money.margins {month}` (M8): per client, invoiced before tax and the AI and tool spend tagged by order (spend to run to order to client), and the margin in one currency only (spend at the owner's rate, or "Not counted: no rupee rate set"), each with its receipt.
7. Figure kinds (M13): every money figure in these views and in `venture.money.overview` carries `kind: 'reported' | 'calculated' | 'assumption' | 'estimate'` and its source (file and row, receipt, the owner's input shown beside each result that uses it, or model); a contract test walks each view.
8. Totals say how they were made (M14): each total carries `basis {filters, truncated, notCounted}` ("2 not counted: no rate"); a paged read that sees the same cursor twice stops with `PAGING_LOOP`, never treating a short page as the end.

**Implementation notes.** `openInvoices`, `owedPlan`, `receivedPlan`, `sumReceipt` (`money/sums.ts`); `booksSummary`, `BOOKS_AGING_NOTE` (`money/books.ts`); `bankLedger` (W2 2D); `rupeesOf`, `rupeeFigure` (`money/spend.ts`); `billsDue` (4J5); the calculator's `costs` operation. All money in BigInt minor units.

**UI pieces:** none (4J20). Feeds D-Money (owed tile, in and out, cash line, next three weeks, export).

**Done when:** `node --test platform/tests/venture-money-aging.test.ts platform/tests/venture-money-flow.test.ts platform/tests/venture-money-cash.test.ts platform/tests/venture-money-export.test.ts platform/tests/venture-money-margins.test.ts platform/tests/venture-figure-kinds.test.ts platform/tests/venture-money.test.ts platform/tests/desktop-main.test.ts` shows `# fail 0`.

#### Package 4J5: bills, payments and credits, recurring invoices and reminders, tax kinds (E)

Size L. Rows: M10, M11, M12, M15, M17 (the data).

**Files:** new `money/bills.ts`, `money/credits.ts`, `money/recurring.ts`, `money/reminders.ts`, `money/tax-kinds.ts`, `money/statement.ts`; `money/payments.ts` (pending and cleared, allocations, TDS), `money/invoices.ts` (tax-inclusive lines, the rate-change banner, the timeline); `money/index.ts` (lines); tests `platform/tests/venture-bills.test.ts`, `venture-credits.test.ts`, `venture-recurring.test.ts`, `venture-tax-kinds.test.ts` (new), `venture-money.test.ts` (updated).

**Failing tests first:**

1. Bills (M10): `venture.bills.add {vendor, lines: [{description, amountMinor, taxName, taxRateBps}], billDate, dueDate, recurring?}` (app only) keeps the tax name and rate at that time; states draft, posted, partial, paid and overdue (derived); `venture.bills.pay` records a payment (over the balance `BILL_PAYMENT_TOO_LARGE`) and writes a books cost fact, so the calculator's costs count it; `billsDue(state, from, to)` serves 4J4.
2. Payments (M11): a cheque payment is pending until the owner clears it (`venture.payment.clear`) or a bank row matches (W2 2D); only cleared money counts as received; one payment can be split across invoices (`allocations`), and over-allocation is refused by the calculator (`PAYMENT_TOO_LARGE`); existing payments read as cleared.
3. Credit notes: `venture.credit.issue {invoiceId, amountMinor, reason, digest}` is on the always-ask floor (W1 H12 "issue for real"), so it waits as a Today row with a second ask; once issued it is linked to its invoice and reduces the balance; an accepted quote becomes one invoice once (`QUOTE_ALREADY_INVOICED`).
4. Recurring (M12): `venture.invoice.recurring {clientId, offerId, frequency: 'monthly' | 'quarterly', startOn, end?}` (app only); each due date makes a draft invoice as a Today row, never issued by itself; reminders on the days the owner picks (default 3, 10 and 30 days late) are drafts from `venture.invoice.remind {invoiceId}`, handed off through 4E2's open and sent; a row when a client views (4J7) or pays; each invoice has one next action by state and a timeline (Issued on, Viewed, Awaiting payment).
5. Tax kinds (M15): normal GST; TDS the client deducts, recorded on the payment with its section and counted as settled pending the certificate ("TDS ₹1,600 to be shown on Form 16A"); tax-inclusive prices split by the calculator into taxable and tax in BigInt with the rounding rule stated on the receipt; the rate charged stays on each line; a rate change shows a banner on drafts, and recalculating is the owner's choice.
6. Statement (M17 data): `clientStatement(state, clientId)` returns open invoices, paid so far and credit notes with receipts, for 4J7's page.

**Implementation notes.** `recordPaymentMinor`, `PAYMENT_METHODS` (`money/payments.ts`); `prepareInvoice`, `issueInvoice`, `invoiceDigest`, `taxLinesFor` (`money/invoices.ts`); `buildPriceReceipt`, `taxFigures` (`money/quote.ts`); `insertBooksFact` and W2's `costFact` (`money/facts.ts`); `floorReason` for the credit-note floor.

**UI pieces:** none (4J20). Feeds D-Money ("Draft 3 reminders", invoice states).

**Done when:** `node --test platform/tests/venture-bills.test.ts platform/tests/venture-credits.test.ts platform/tests/venture-recurring.test.ts platform/tests/venture-tax-kinds.test.ts platform/tests/venture-money.test.ts platform/tests/venture-bank-books.test.ts` shows `# fail 0`.

#### Package 4J6: business snapshots: money and runs across businesses (E)

Size M. After 4J4. Rows: C10 (the never-contact list shared across businesses); W3's cross-business money and runs; 4C1's reads of other businesses.

**Files:** new `platform/runtime/workspace-snapshots.ts`; `platform/runtime/engine.ts` (write on change and on lock; the port); `contracts.ts` `VentureWorkspacePort.snapshots()` (one edit); new `money/across.ts`, `views/across.ts`; `network/outreach-checks.ts` and `chief/tools.ts` (one line each); tests `platform/tests/workspace-snapshots.test.ts`, `venture-across.test.ts` (new).

**Failing tests first:**

1. While a business that opens with this computer is open, a change to its money or runs writes `custody/snapshots/<folder>.json`, encrypted with this computer's key, at most once a minute and again on lock: name, kind, `asOf`, money (invoiced this month, received, owed, late count, AI spend) as display and minor strings, runs (working, waiting, stopped) and the needs-you count; no client names, titles or text (the test decrypts it and searches for a client's name).
2. A business that opens with a passphrase never writes one, and its row says "Sitara Events is locked with a passphrase, so Chausar shows nothing about it until you open it."
3. `venture.money.across {}`: the open business live, each other one from its snapshot with "as of {time}, when you last opened it"; a total only when every business shares one currency, added in BigInt from the minor strings, with a receipt listing the snapshots; other businesses' receipts open only after switching. `venture.runs.across {}` gives counts the same way.
4. A tampered or unreadable snapshot is skipped with "Couldn't read what Chausar saved about {name}."; on the hosted app the list is empty.
5. Never-contact (C10): `custody/never-contact.json` holds keyed hashes (HMAC with the computer key) of every blocklisted and forgotten email and phone from the businesses on this computer; a draft in any business to a listed address is `OUTREACH_BLOCKED`.

**Implementation notes.** `CustodyFiles` (`platform/runtime/workspace-custody.ts`) for paths and atomic writes; the computer key the `with-this-computer` unlock uses; `moneyOverview`, 4I1's invoiced figure and 4J4's late count for the content; `VentureWorkspacePort.businesses()` for names and lock modes.

**UI pieces:** none (4J20). Feeds D-Money's business chips, D-Work's runs across businesses, D-Chats.

**Done when:** `node --test platform/tests/workspace-snapshots.test.ts platform/tests/venture-across.test.ts platform/tests/venture-views-queue.test.ts` shows `# fail 0`.

### Area: connectors and setup guides

#### Package 4J7: connector truth, connection checks, guides, file requests and share link states (E)

Size L. Rows: K6, K7, K9, K18, O20, M17 (the page); W3's K11 (guides) and U11 (the accountant's read-only link).

**Files:** new `build/connector-truth.ts`, `build/connector-check.ts`, `build/guides.ts`, `build/file-requests.ts`; `build/share-links.ts` (viewed state, client-only answers, per-item comments, kinds `order-status`, `statement`, `books`, the file manifest check from 4J1), `build/catalogue.ts` and `build/connectors.ts` (guides and ladder on cards), `delivery/harness/loop.ts` (`actTask` capability list, after 4B2), `platform/runtime/server.ts` and `platform/runtime/hosted/server.ts` (the upload route `/share/<token>/upload`); tests `platform/tests/venture-connector-truth.test.ts`, `venture-connector-check.test.ts`, `venture-guides.test.ts`, `venture-file-request.test.ts`, `venture-share-states.test.ts` (new), `venture-share-links.test.ts` (updated).

**Failing tests first:**

1. Truth ladder (K6): each connector mode carries `ladder` (`documented`, `discovered`, `read-verified`, `write-verified`, `unavailable`) under its qualification; no mode claims `write-verified` without a recorded real write and read-back; each connector has a capability set, and a request field outside it is `CONNECTOR_FIELD_UNSUPPORTED`, never silently dropped; the act task's input lists capabilities on and off at the start of a run; posting tools are in a run's grant only while that browser session is signed in.
2. Checks (K7): `venture.connectors.check {}` makes one cheap real read per connected connector (an API key's free model list, 4H1's CLI status, the bank consent status, the mailbox's EXAMINE, the posting steps' last check date) and returns one row each, answered, failed or skipped with its reason, never a secret; "Connected as {account}" where the provider says it; expiry dates; the rows are stored (`venture-connector-check`) with the Keeper run `connection-checks`; setup health counts Ready, Warnings and Blocking, each with a one-sentence fix; a routine (4J13) can't be switched on for a connector that was never checked (`ROUTINE_NEEDS_CHECK`).
3. Guides (K11): every catalogue connector has a guide (numbered least-privilege steps, the step people skip, what the platform charges with its source date or "no charge", "Chausar checks access before marking it connected", a sends line such as "Sends: nothing, so nothing here can change Zoho", and the agent's limits); a validation test fails on a connector without one; a half-configured connector names its missing setting.
4. File request (K9): `venture.share.request {orderId, note?}` (app only) makes a single-use link valid for 15 minutes with an in-flight lock; the page says "The file goes straight to this server and is kept with this order. It never passes through the model's context."; an upload (at most 1.45 MB) is stored as an order file that agents see only by id and size until `files.read`, which the untrusted screen covers; a second use is `SHARE_USED`, a late one `SHARE_EXPIRED`.
5. K18: a report link in a draft must match a link from a tool result or the owner's records (extending W1 1G's receipts check to W2 2F's exports); keys in chat are refused by 4B1 and 4C1.
6. Share states (O20): the token page records `viewed` once (the owner's preview inside the app never counts); only that draft's client link may answer, and the answer is recorded under the client (`recordedFor`); the client can comment per item (per post) without an account; `kind: 'order-status'` shares a page-only status of a live order.
7. `kind: 'statement'` ("What you owe us", from 4J5's `clientStatement`) and `kind: 'books'` (a month's figures, invoices and payments for the owner's accountant, from the business menu's "Invite your accountant") are read-only and revocable like every link.

**Implementation notes.** `connectorModes`, `connectorCard`, `listConnectors` (`build/connectors.ts`); `CATALOGUE` entries (`build/catalogue.ts`); `shareCreate`, `sharePage`, `shareDecide`, `SHARE_TOKEN` (`build/share-links.ts`); `filesAddHandler`, `MAX_UPLOAD_BYTES` (`delivery/harness/files.ts`); `checkCli` and status (4H1); `consentStatus` (`build/bank.ts`).

**UI pieces:** none (4J21). Feeds the Connections place and the Work order card.

**Done when:** `node --test platform/tests/venture-connector-truth.test.ts platform/tests/venture-connector-check.test.ts platform/tests/venture-guides.test.ts platform/tests/venture-file-request.test.ts platform/tests/venture-share-states.test.ts platform/tests/venture-share-links.test.ts platform/tests/venture-connectors.test.ts platform/tests/server.test.ts platform/tests/hosted-server.test.ts` shows `# fail 0`.

### Area: the Start gallery list and the owner's name

#### Package 4J8: the ways to earn, checklist names, the business picker and file drop (E)

Size M. W3's U3 (the list, the picker and the drop) and the setup checklist's item names.

**Files:** new `playbooks/ways.ts` (data per registered playbook), `core/ways.ts` (`venture.playbooks.list`); `playbooks/registry.ts` (validation), `core/checklist.ts` (labels and links), `draft/handlers.ts` (compose takes `forBusiness` and `attachment`); tests `platform/tests/venture-ways.test.ts`, `venture-compose-attach.test.ts` (new), `venture-checklist.test.ts` (updated or new).

**Failing tests first:**

1. `venture.playbooks.list {}` answers before a vault opens (no write, no model): one way per registered playbook (YouTube channel, CA practice, Social media agency in W4) with a category (Content, Marketing, Money and tax, Shops and firms), "What you do" with hours a week as text ("4 to 8 h a week") and a `maxHours` number, "What your AI team does" (roles with initials and their departments from 4A1), "Clients usually pay" as `{text, estimate: true, source}`, and the businesses on this computer of that kind (from 4J6's snapshots) for "You run this" and "Start another". Counts per category. Every way names a registered playbook (no tile for an unbuilt one; W5 adds its own).
2. The filter "Up to 5 h a week" uses `maxHours`; sort keys are best fit (4C1's fit when present), fewest hours and name.
3. `checklistFor` items gain `label` and `link` ("Set your prices", `#/business/prices`) so Business can list "Setup, 3 of 5" by name.
4. The picker and the drop (U3): with a business open, the one-sentence box can "Add this to Lumen Studio", which drafts a plan change for that business that the owner accepts (`venture.blueprint.update`), or "Start a new business"; `attachment {name, text}` (desktop, at most 200 KB of text) passes the untrusted screen and is used only as context; a held attachment is dropped with "Chausar left out your file: it had words aimed at the AI."

**Implementation notes.** `PLAYBOOK_REGISTRY`, `validateRegistry`, `findPlaybook` (`playbooks/registry.ts`); `flagshipDelivery` roles; `checklistFor` (`core/checklist.ts`); `screenUntrusted`; the draft desk handlers (`draft/handlers.ts`).

**UI pieces:** none (4J21). Feeds D-Start.

**Done when:** `node --test platform/tests/venture-ways.test.ts platform/tests/venture-compose-attach.test.ts platform/tests/venture-checklist.test.ts platform/tests/venture-playbook*.test.ts` shows `# fail 0`.

#### Package 4J9: the owner profile and the hosted manifest name (E)

Size S. Rows: C21 (the profile part); W3's "owner's first name" and U4 (the business name in the hosted manifest).

**Files:** new `core/owner.ts`; `core/index.ts` (two lines); `platform/runtime/hosted/server.ts` (the manifest route); tests `platform/tests/venture-owner.test.ts`, `platform/tests/hosted-manifest.test.ts` (new).

**Failing tests first:**

1. `venture.owner.set {firstName}` (app only) takes 1 to 40 characters of letters in any script, spaces, dots, hyphens and apostrophes between letters (a curly apostrophe is kept as a straight one; a zero-width joiner or non-joiner only right after a letter or mark) (`OWNER_NAME_INVALID` otherwise); `venture.owner.get {}` returns it with the business name. `firstName: null` takes the name back, and that answer carries Forget's backups line (`kept`).
2. `excludedServices`: at most 20 lines of at most 80 characters each; 4E2 reads them.
3. The hosted app serves `/app/manifest.webmanifest` with `name` "Chausar: {business name}" (escaped, at most 45 characters, else "Chausar") for the signed-in owner's selected business; the desktop and local web keep W3's static manifest. The name is the hosted directory's business name (the one given when the business was made on the server), which can differ from the app's working name after a rename: accepted, so a manifest fetch never opens a vault. The hosted `/app/` page's manifest link gets `crossorigin="use-credentials"` (idempotent), so the browser sends the session cookie.

**Implementation notes.** `ventureAction`, `singleLine` (`records.ts`); the hosted `select` business (`platform/runtime/hosted/app.ts`).

**UI pieces:** none (4J21). Feeds D-Today's greeting.

**Done when:** `node --test platform/tests/venture-owner.test.ts platform/tests/hosted-manifest.test.ts` shows `# fail 0`.

### Area: the remaining harness rows

#### Package 4J10: the chained journal, signed receipts, end states, action extras, method hints (E)

Size M. Rows: H26, H27, H28, H38.

**Files:** new `journal/chain.ts`, `journal/signing.ts`, `journal/end-states.ts`, `journal/action-extras.ts`, `method-hints.ts`, `scripts/verify-receipts.mjs`; `journal/journal.ts` (chain on every write, end states, reject cleanup, dependencies, the account fence, the denylist); `money/quote.ts` (`getReceipt` returns the signature); `money/index.ts`, `views/index.ts` (one line each); tests `platform/tests/venture-journal-chain.test.ts`, `venture-receipt-signing.test.ts`, `venture-journal-states.test.ts`, `venture-action-extras.test.ts`, `venture-method-hints.test.ts` (new).

**Failing tests first:**

1. Chain (H26): every journal entry gets `seq`, `prevDigest` and `digest` (sha256 over its canonical JSON); `venture.journal.chain {}` verifies it; a gap or an edited entry (the test edits one in the store) marks the chain `corrupt` from the first bad `seq`, and every journalled action is then refused `JOURNAL_CORRUPT` ("Chausar's record of outside actions doesn't add up from entry 41, so nothing more goes out until you look."); the owner may accept a recorded break (`acceptBreak` with the digest, app only), which starts a new chain with a line that says so.
2. Signed receipts: price, sum, work and tie receipts carry an Ed25519 signature over their canonical JSON with a per-business key (`venture-signing-key`, made on first use, private half in the vault); `venture.receipt.verify {id}` answers `valid` and a label: `reproduction_ready` (inputs and table versions stored, as W2 2A2's re-derivable CA receipts), `incomplete` or `signature_only`; `node scripts/verify-receipts.mjs <export>` checks an exported file offline with the public key.
3. End states (H27): after `applied` an entry may move to `accepted`, `processed`, `shown` or `result` as the provider reports; `verified` needs a dated acceptance check; an action on several targets records each as applied, rejected, partial, unknown or throttled, and a retry covers only the targets that failed.
4. Extras (H28): an action kind may declare `reject()` cleanup that runs when the owner rejects (a staged site edit's file is removed); actions may declare `provides` and `dependsOn` (one that depends on an unapplied action waits; a rejected dependency rejects it); an approved action is fenced to its account (a post approved for one LinkedIn account refuses to run under another: `ACCOUNT_FENCE`); actions that outlive the session (credential minting, webhooks that keep delivering, bulk wrappers that hide the inner call) are refused `ACTION_DENYLISTED`.
5. Method hints (H38): `METHOD_HINTS` gives every venture method `readOnly`, `undoable`, `idempotent` and `reachesOutside`; a parity test checks one method set across `VENTURE_METHODS`, `METHOD_HINTS`, `app/desktop/ipc-contract.cjs`, `app/ui/src/engine/types.ts` and the hosted method allow-list; every read-level method is `readOnly`.

**Implementation notes.** `proposeIn`, `approveIn`, `applyAction`, `stepTo`, `digestOf` (`journal/journal.ts`); `digest` (`records.ts`); `node:crypto` `generateKeyPairSync('ed25519')` and `sign`; `buildPriceReceipt`, `sumReceipt`, 4D2's tie receipts.

**UI pieces:** none (4J22a). Feeds Money > Journal's chain line.

**Done when:** `node --test platform/tests/venture-journal-chain.test.ts platform/tests/venture-receipt-signing.test.ts platform/tests/venture-journal-states.test.ts platform/tests/venture-action-extras.test.ts platform/tests/venture-method-hints.test.ts platform/tests/venture-journal*.test.ts` shows `# fail 0`.

**Wired and deferred (4J10 review round).** Wired to real callers: end states on the website edit read-back (`verified`, dated `site-readback` check) and on a post the browser saw after posting (`shown`); the account fence on real posts (`decidePost` fences with the port's `signedInAccount`, refused when unknown; the Playwright port does not report it yet, so a post approved for a named account is refused there until it does); the `operation` allowlist on `connector.write` (the harness's mock outbox: `send-deliverable`, `create-link`); the reject cleanup on `rejectSiteEdit`; the signed receipts in `venture.money.export`. Deferred, no caller yet: per-target outcomes and `retryProposal` (no action reaches several targets today); `provides` and `dependsOn` (no package proposes dependent actions today). Each is built and tested through the journal and waits for its first caller.

#### Package 4J11: context hygiene, execution places, mock providers (E)

Size M. Rows: H29, H31, H33.

**Files:** `delivery/harness/loop.ts` (`compactHistory`), `delivery/harness/tools.ts` (large results to a file; tool groups), new `delivery/harness/tool-groups.ts`, `delivery/harness/delegate.ts` and `delegate-process.ts` (environment, one script per device, `.env` allowlist, the destructive-command backstop), new `delivery/harness/mocks.ts`; tests `platform/tests/venture-context-hygiene.test.ts`, `venture-exec-places.test.ts`, `venture-mocks.test.ts` (new).

**Failing tests first:**

1. Compaction (H29): a compacted history holds an "Unconfirmed actions" block built only from journal records (`described`, `approved`, `outcome_unknown`) with "Check these by id. Never repeat them."; the summary is fixed sections from the run's events, with no model call; the old "call the tool again" instruction is gone (the test reads the compacted input).
2. A tool result over 24,000 characters (about 6,000 tokens) is stored as a work file with a 600-character preview in the history; a turn's results over 40,000 characters in total are handled the same way per batch; tools are offered by group, with full specs only for the current step's group.
3. Execution places (H31): a delegated run (the owner's Claude Code or Codex) starts with no `*_KEY`, `*_TOKEN` or `*_SECRET` names in its environment; one delegated script per device at a time (`DELEGATE_BUSY`); authenticated requests never follow a redirect; a project `.env` in the work folder loads only allowlisted names; delegated coding work carries a backstop in its brief that refuses destructive database commands and force-push.
4. Mocks (H33): mock providers (payment link, mail, posting) run the real validation and state machine and offer `failNext()`; typed mock tools (a schema and a hand-written result) serve shadow and rehearsal runs; a mock never reaches the network (the net guard stub counts zero requests).

**Implementation notes.** `compactHistory`, `actTask` (`delivery/harness/loop.ts`); `callTool`, `toolSpec` (`delivery/harness/tools.ts`); `delegate.ts`'s brief and `DelegatePorts`; `guardedFetch` (`core/net-guard.ts`); `journalListHandler` for unconfirmed actions.

**UI pieces:** none.

**Done when:** `node --test platform/tests/venture-context-hygiene.test.ts platform/tests/venture-exec-places.test.ts platform/tests/venture-mocks.test.ts platform/tests/venture-harness-runs.test.ts platform/tests/venture-delegate*.test.ts` shows `# fail 0`.

#### Package 4J12: step edges, order contracts, agent-to-agent rules (E)

Size L. After 4B1 (and 4A1 for one line in `views/team.ts`). Rows: H23, H24, H25; W3's U2 (helpers nested under their parent).

**Files:** `delivery/playbook.ts` (`validatePlaybook` for edges), new `delivery/flow.ts`, `money/order-contracts.ts`, `agents/relay.ts`; `views/team.ts` (one line: `parentId`); tests `platform/tests/venture-playbook-flow.test.ts`, `venture-order-contract.test.ts`, `venture-agent-relay.test.ts` (new).

**Failing tests first:**

1. Edges (H23): a step may name `next` edges (`on: 'done' | 'failed' | 'blocked' | 'timeout'`), `maxLoops` with `onExceeded`, `timeoutMs` with an ordered `failover`, gates with a default and a timeout, and the run a deadline; a `blocked` outcome carries a reason; attempts are numbered. `validatePlaybook` refuses a cycle with no cap or gate (`PLAYBOOK_CYCLE_UNCAPPED`) and an edge to a missing step. A fixture playbook whose check step fails goes back to its write step at most twice, then ends `blocked`. Shipped playbooks get edges in W5 (spec 5.8).
2. Order contract (H24): for an offer marked `contract: 'required'` (fixtures only in W4), `venture.delivery.run` is refused `ORDER_CONTRACT_UNSIGNED` until the owner signs (`venture.order.contract.sign {orderId, digest}`) a contract with a goal, scope, constraints, protected items the engine enforces (a draft that changes a protected phrase or file fails its checks), deliverables with "done" by stage and acceptance checks with stable ids; done needs evidence, skipped needs a reason, only the auditor reopens; agents may propose scope and check changes (`contract.propose`), never autonomy, budget or protections (`CONTRACT_FIELD_LOCKED`); revisions append.
3. Agent to agent (H25): work goes down and reports go one step up as `done`, `blocked`, `failed` or `needs_decision`, and only the last two reach Today; caps of depth 4, 12 turns per root task and 3 mentions are refused with one fixed sentence ("This would pass the work along too many times. Chausar stopped it here."); messages go only to a parent, siblings or children, each marked `delivered` or `queued`; a handover carries a brief and is never handed back; code adds a return cap and a spend line to every helper brief; `parentId` on the team view nests helpers under their parent with spend rolled up.

**Implementation notes.** `validatePlaybook`, `buildBody` (`delivery/playbook.ts`); the `agent.delegate` tool (`delivery/harness/patches.ts`, `delegate.ts`); `appendAgentMessage` (4-0); `createOrder` (`money/orders.ts`).

**UI pieces:** none (4J22a for contracts, 4J22b for nesting).

**Done when:** `node --test platform/tests/venture-playbook-flow.test.ts platform/tests/venture-order-contract.test.ts platform/tests/venture-agent-relay.test.ts platform/tests/venture-delivery.test.ts` shows `# fail 0`.

**Deferred to W5 (recorded at the 4J12 review):** the harness does not call `relaySend` yet, and `delivery/runs.ts` does not follow step edges yet. No shipped team has a helper (`FlagshipRole.parent` is unset) and no shipped step has an edge in W4, so both are wired when W5 gives the playbooks helpers and edges (spec 5.8). What W4 does wire: `validateFlow` in every `validatePlaybook`, the return cap and spend line on every heavy-work brief (`delegateBrief` through `agents/helper-brief.ts`), the contract gates on run, approve, answer, heavy work and resume, Team's nesting (`nestTeam`), and Forget over relays and contracts.

#### Package 4J13: routines, timed questions, report-back, leases (E)

Size L. After 4F1. Rows: A12, A13, H30, H34.

**Files:** new `agents/routines.ts`, `agents/routine-runner.ts`, `delivery/timed-questions.ts`, `delivery/report-back.ts`, `delivery/leases.ts`; `platform/runtime/engine.ts` (the scheduler tick calls the routine runner; one line), `delivery/harness/loop.ts` (`answerHandoff` expiry), `delivery/runs.ts` (the lease on approve calls), `chief/threads.ts` (one line: routine answers into a pinned thread); tests `platform/tests/venture-routines.test.ts`, `venture-timed-questions.test.ts`, `venture-leases.test.ts`, `venture-report-back.test.ts` (new).

**Failing tests first:**

1. Schedules are stored as `once`, `interval` or `calendar` with a time zone ("every Monday 09:00, Asia/Kolkata"), never cron text; `venture.routines.set` refuses a prompt that leans on a conversation ("as above", "this one", "like before") with `ROUTINE_NOT_STANDALONE`, since a routine runs without the chat.
2. States queued, running, needs input, completed, failed, missed, skipped, interrupted: a late run inside the 60-minute catch-up window runs; older misses become one `missed` run that says how many; a new occurrence while one runs is `skipped`; after a restart only the latest missed occurrence runs; a run that was running at a crash is `interrupted` and never run again; history says "delivered", never "done".
3. A routine never approves anything: it takes the stricter of its own and the agent's posture, parks in needs input with one notification, and an approval nobody answers in 24 hours counts as no. An agent's routine can't change the owner's (`ROUTINE_NOT_YOURS`). The chief's Weekly review is a routine whose answer lands in a pinned chief thread.
4. Timed questions (A13): a run's question carries `expiresAt` (24 hours unless the playbook says otherwise), which 4J1 shows; when it passes unanswered, held calls are declined (fail closed) and the next turn reads "No answer by {time}. Go on without it, or stop."; other runs go on meanwhile.
5. Report-back (H30): a background job (heavy work, research) reports into the run that asked, with a fixed message id and a delivery marker written in one transaction; a second delivery of the same id is ignored; a report with zero sources carries a warning; on the desktop, background model work waits while the owner is active and the AI is local or rate-limited.
6. Leases (H34): an approve call in flight holds a renewable lease on its run; if the engine dies, the lease runs out and the run returns to waiting with "Interrupted: Chausar stopped while this ran. Nothing was sent again."; rechecks are dated rows with a reason, never cron; each step's state (pending, running, done, error, skipped) survives a restart, and Resume (4F1) continues from it.

**Implementation notes.** The engine's scheduler tick that calls `host.sweepJournal` (`platform/runtime/engine.ts`); `ventureTimeZone`, `localDayAt` (`local-day.ts`); `answerHandoff` (`delivery/harness/loop.ts`); `settleDelegation` for report-back; `DurableJobRunner`'s lease idea (`platform/runtime/job-runner.ts`) rebuilt for venture runs.

**UI pieces:** none (4J22a).

**Done when:** `node --test platform/tests/venture-routines.test.ts platform/tests/venture-timed-questions.test.ts platform/tests/venture-leases.test.ts platform/tests/venture-report-back.test.ts platform/tests/venture-run-controls.test.ts` shows `# fail 0`.

### Area: the remaining quality rows

#### Package 4J14: one vocabulary, coverage, outcome words, fallbacks (E)

Size M. Rows: Q6, Q7, Q8, Q21, Q22, Q23.

**Files:** new `delivery/verdicts.ts`, `delivery/coverage.ts`, `delivery/outcomes.ts`, `delivery/fallbacks.ts`, `delivery/decide-first.ts`, `delivery/rerank.ts`; `views/runs.ts` (words and coverage, after 4F1); `delivery/harness/files.ts` (the worklist marks); tests `platform/tests/venture-verdicts.test.ts`, `venture-coverage.test.ts`, `venture-outcomes.test.ts`, `venture-rerank.test.ts` (new).

**Failing tests first:**

1. One vocabulary (Q7): every check outcome maps through one table to words (Passed, Failed, Not run, Not checked); model judgments are words (strong, fair, weak, no) with a keep threshold and a printed drop reason; draft verdicts PASS, REWRITE, DO NOT SEND; delivery status Fixed, Partially fixed, Not fixed, Unverified; a report carries `generatedBy` and is stale once older than its draft; an unknown value is "Unknown", never a pass. The engine exports these lists for 4J22a's drift test.
2. Coverage (Q6): work over many items uses a worklist the tool marks read (`files.read` marks rows and pages); a result is `partial` unless coverage is complete; coverage leads as a fraction ("1,204 of 1,210 lines matched") on work receipts and run steps; checks that couldn't run are listed as not run; an unobserved value is null, never 0; unresolved never shows as passed; an incomplete review says "Review incomplete: this is not a review."
3. Outcomes (Q8): a run that acts outside is Success only when a code check of the real result passed, Not checked without one, Failed when the agent gave up; findings fall in three classes (hard errors, content issues, creative judgement left to the owner); a deliverable report has three columns: measured, looked at, needs a human.
4. Fallback (Q21): when a model summary or chart fails, the view shows counts per entity and new records per month from code, labelled "Counted by code; the summary didn't work."
5. Decide first (Q22): schemas for optional agent actions (add a follow-up, an upsell line) need `{decision: 'yes' | 'no', reason}` before any content, default no; content without a yes is dropped.
6. Rerank (Q23): `venture.options.rerank {questionId, weights}` re-orders options already scored (W2 2E's hook scores) by the owner's weights in code, with no AI call; a hard failure still goes to review.

**Implementation notes.** `checkLabel`, `playbookCheckLabel`, `deliveryRun` (`views/runs.ts`); `rankHooks` (`playbooks/youtube/checks.ts`); `notRuled`, `decideRules` (`delivery/judge/rules.ts`).

**UI pieces:** none (4J22a).

**Done when:** `node --test platform/tests/venture-verdicts.test.ts platform/tests/venture-coverage.test.ts platform/tests/venture-outcomes.test.ts platform/tests/venture-rerank.test.ts platform/tests/venture-views-runs.test.ts` shows `# fail 0`.

#### Package 4J15: drills, auto readiness (locked), shadow summary, lift, calibration, trace scan, second reviewer (E)

Size L. After 4J11 (mocks). Rows: Q9, Q10, Q11, Q12, Q13, Q14, Q17; the founder's "auto with spot checks built but locked".

**Files:** new `delivery/drills.ts`, `policy/auto-gate.ts`, `delivery/shadow-summary.ts`, `delivery/lift.ts`, `delivery/judge/calibration.ts`, `delivery/trace-scan.ts`, `delivery/second-review.ts`; `delivery/launch.ts` (the locked reason), `views/team.ts` (one line in `teamPostureHandler` calling `autoLocked`, after 4A1 and 4J1); tests `platform/tests/venture-drills.test.ts`, `venture-auto-gate.test.ts`, `venture-shadow-summary.test.ts`, `venture-lift.test.ts`, `venture-judge-calibration.test.ts`, `venture-trace-scan.test.ts`, `venture-second-review.test.ts` (new).

**Failing tests first:**

1. Drills (Q9): `venture.drills.run {}` (app only) runs, with 4J11's mocks and against the current playbook hash, a money action at auto, a client send without approval, a stale digest, an unpriced model, and an instruction planted in a client email and in a ledger note; each must be stopped and each benign twin must pass; a clean and an adversarial ledger with the same facts must give the same figures; results are stored with the playbook hash (`venture-drill-run`).
2. Auto readiness (Q10): `venture.auto.readiness {agent}` lists per step whether a verifier exists, a real run passed in the last 14 days, the spend log is complete, drills passed within 30 days and since the last playbook change, the kind allows auto, the owner switched it on, and no taint latch is set. Even with every item met, `venture.launch.advance` to auto with spot checks and `venture.team.posture` to it answer `AUTO_LOCKED` ("Auto with spot checks is built but locked. It opens after two clean drill runs and the founder's yes."). A decision model may lower friction but never authorises.
3. Shadow summary (Q11): `venture.shadow.summary {agent}` returns "Would have gone out 14, held 3, you would have changed 2" from shadow-stage records, with a dash where a figure is unknown; a first run offers rehearsal on three sample orders (routine, risky, high value); "Watch one real order end to end before arming" stays until one has been watched; every success condition carries a bound ("or stop with a reason after 5 tries").
4. Lift (Q12): paired rehearsal cases with and without a change are compared with the exact McNemar test; below the reachable significance it says "Not enough practice cases to tell yet."
5. Calibration (Q13): fixtures with the right answer reached the wrong way fail; votes may be `na`; one false vote makes the fold false; cited event ids are checked against the log; a failure quotes the rule's clause.
6. Trace scan (Q14): before any judge, code scans the run for secrets, outbound calls and writes outside the work folder; a tool outside the auditor's allowlist fails the audit; a check that edits what it checks voids its verdict and the files are restored.
7. Second reviewer (Q17): two reviewers' findings merge by key, keeping the higher severity and naming both; disagreements are recorded; findings and observations stay apart; a lens stands down where a code check already covered the item.

**Implementation notes.** `computeLaunchStatus`, `REASON_AUTO_PLANNED` (`delivery/launch.ts`); `teamPostureHandler` (`views/team.ts`); `rulesTask`, `decideRules`, `validateBallot` (`delivery/judge/rules.ts`); `simulate.ts` for rehearsal cases; `secretFindings` (`core/secrets.ts`).

**Decisions and deferred (4J15 as built, after the integrator's review of 26 Oct).**
- The lock: `policy/auto-lock.ts` holds `AUTO_LOCKED_WORDS` and `CLEAN_DRILL_RUNS = 2`; `launch.advance` and `team.posture` to auto answer `AUTO_LOCKED`, and `effectivePosture` caps every posture at approve each, so a vault edited, imported or restored with `launchStage: 'auto-spot-check'` still asks, spot checks are never recorded and `allowSession` stays refused. The readiness drills item counts the same two clean runs the lock words name (the last two drill runs on the current playbook, both passed, within 30 days).
- Readiness "no taint latch" (`OUTSIDE_LATCH` in `policy/auto-gate.ts`): a real order is latched from its first turn by its own request and by its files, so those cannot count against readiness. The item is unmet when a real run in the last 14 days was latched by mail, a post or a web page, or had a tool result the screen held or flagged.
- Shadow summary: "you would have changed" counts rejections and edits whose words differ from the draft; an edit saved with the same words is "sent as is". There is no "high value" practice client, so the rehearsal offer names the three that exist (routine, risky, pushes on price); no scenario was invented.
- The trace scan runs before every judge: the real-order judge (`judge-run.ts notJudgeable`), both rehearsal judges in each episode (`simulate.ts`), and the improvement loop's pairwise judge (`improve.ts tiePreferences`, on the two drafts). A secret the loop already redacted (`[redacted secret]`) counts as a secret. There is no owner acknowledge step (it would need a new method); the refusal words promise none.
- `guardedCheck` wraps a flagship playbook's own checks on real orders (`runs.ts flagshipChecks`, via `guardedPlaybookChecks`): a check that changes what it read is voided as one failed result (`checks-left-unchanged`) and what it changed is put back in place.
- Deferred: lift (`delivery/lift.ts`) is to be wired into `venture.improve.adopt` through `pairedCases` (4J16 owns `improve.ts` now); calibration (`delivery/judge/calibration.ts`) is to gate `venture.judge.auto.set`; the second reviewer (`delivery/second-review.ts`) has no reviewer source yet. Each is built and tested and has no caller.

**UI pieces:** none (4J22a).

**Done when:** `node --test platform/tests/venture-drills.test.ts platform/tests/venture-auto-gate.test.ts platform/tests/venture-shadow-summary.test.ts platform/tests/venture-lift.test.ts platform/tests/venture-judge-calibration.test.ts platform/tests/venture-trace-scan.test.ts platform/tests/venture-second-review.test.ts platform/tests/venture-judge-*.test.ts` shows `# fail 0`.

#### Package 4J16: evidence rules, writing checks, learning from corrections, NEEDS_FACTS (E)

Size L. After 4B1. Rows: Q4, Q5, Q15, Q16, Q18, Q19, Q20, CA8.

**Files:** new `delivery/checks/quote-at.ts`, `delivery/checks/rating.ts`, `delivery/corrections.ts`, `delivery/experiments.ts`, `delivery/guidance-report.ts`, `delivery/research-rules.ts`, `playbooks/writing-checks.ts`, `playbooks/ca-firm/needs-facts.ts`; `playbooks/draft-checks.ts` (calls in `playbookOwnChecks`, own functions), `delivery/harness/tools-ca.ts` (`NEEDS_FACTS` from the engines, after W2 2A1); tests `platform/tests/venture-quote-at.test.ts`, `venture-rating.test.ts`, `venture-corrections.test.ts`, `venture-experiments.test.ts`, `venture-guidance-report.test.ts`, `venture-research-rules.test.ts`, `venture-writing-checks.test.ts`, `venture-ca-needs-facts.test.ts` (new).

**Failing tests first:**

1. Quote at location (Q4): a cited quote must appear at its page, row or timestamp within a small window (2 lines, or 10 seconds of a transcript); one correction round, then the check fails; spot checks of quotes against transcripts.
2. Facts in, rating out (Q5): the model gives typed facts and code computes severity or priority from a table with rationale lines; dismissing a finding needs cited evidence of an allowed kind, and a refused dismissal stays visible; a validator answers confirmed, not applicable or needs follow-up.
3. Corrections (Q15): each owner edit or send-back becomes a regression case with typed expectations (mentions, doesn't mention, hands off, uses a tool, cites) added to rehearsal; a field corrected in 60 percent of at least 3 reviews is flagged "Fix the rule"; a lasting rule comes only through the owner's yes on a 4B1 proposal and lands as an owner patch.
4. Experiments (Q16): an improvement run records one hypothesis, one change, a control window, a budget cap, and stop and roll-back rules; without a control the result reads "observed", never "caused"; at most N candidates are reviewed, oldest first, with retry spacing.
5. Guidance report (Q18): `venture.playbook.guidance {}` lists every guidance line with the check that can see it, as measured, dark or unmeasured.
6. Research rules (Q19): no source, no finding; a claim from one domain is "single source"; a search result only points, and its page must be read; numbers carry the time read and a status (corroborated, single source, conflicting, search failed); sentinel values (-1, empty) are never numbers; results say what they can support and what they can't establish.
7. Writing checks (Q20): AI-tell and stock-phrase rates per 1,000 characters against an English and a Hindi baseline (fixed word lists in both languages); hard bans (the em dash, "not X but Y", summary phrases); a quoted-text share band; invisible characters stripped; a bait check (bait phrases, "tag N friends", stacked asks); each a draft check result with its rate.
8. NEEDS_FACTS (CA8): a CA calculator short of facts answers `NEEDS_FACTS` with the missing fields; the agent asks the client in plain words (a hand-off) and the turn ends; no figure is guessed. W5's CA deepening builds on it.

**Implementation notes.** `playbookOwnChecks`, `caChecks` (`playbooks/draft-checks.ts`); `houseStyleFindings`, `BANNED_WORDS` (`records.ts`); `parseTranscript` (YouTube); `computeIncomeTax`, `gstWorking`, `tdsWorking` errors (`playbooks/ca-firm/*`); `improveRunHandler` (`delivery/improve.ts`) for experiment records.

**UI pieces:** none (4J22a).

**Done when:** `node --test platform/tests/venture-quote-at.test.ts platform/tests/venture-rating.test.ts platform/tests/venture-corrections.test.ts platform/tests/venture-experiments.test.ts platform/tests/venture-guidance-report.test.ts platform/tests/venture-research-rules.test.ts platform/tests/venture-writing-checks.test.ts platform/tests/venture-ca-needs-facts.test.ts platform/tests/venture-playbook-*.test.ts` shows `# fail 0`.

### Area: agent extras

#### Package 4J17: business voice, persona, questions done well, skills (E)

Size L. After 4B2 (the act task input). Rows: A8, A9, A14, A18.

**Files:** new `agents/voice.ts`, `agents/persona.ts`, `agents/questions.ts`, `agents/skills.ts`, `agents/export.ts`; `playbooks/draft-checks.ts` (the `voice` check, its own function), `delivery/harness/loop.ts` (`actTask` input: persona fields, after 4B2 and 4J7); tests `platform/tests/venture-voice.test.ts`, `venture-persona.test.ts`, `venture-questions.test.ts`, `venture-agent-export.test.ts` (new).

**Failing tests first:**

1. Voice (A8): `venture.voice.set {voice}` (app only) in six typed sections (who I talk to, how I talk, never-use words, words I use, what I will not claim, format), on or off, per language (English, Hindi) and per channel; never-use words and will-not-claim items are checked by code on every draft (the `voice` check); `venture.voice.learn {samples}` takes three to ten of the owner's own texts, counts word frequencies and keeps verbatim lines in code, and marks the voice validated only after a held-out sample passes.
2. Persona (A9): typed fields after the fixed rules (tone, reply length, greeting, hand-off line, blocked topics, sign-off); a field that asks for a tool, a number or a change to facts or safety is `PERSONA_FIELD_REFUSED`; `venture.persona.test {agent, persona}` runs the unsaved persona on the practice clients and shows its cost; the role in the playbook stays apart from the persona.
3. Questions (A14): an agent's questions come in rounds, each with its best guess, answerable in one short reply ("1 yes, 2 no"); 2 to 8 related questions per card, each option with what it gains and what it costs and the recommended one first; free text always open, with an escape; the submit label restates the answer; shorthand is accepted; an approval never rides inside a questionnaire (`QUESTION_HAS_APPROVAL`); a question asking for a fact Chausar holds is refused.
4. Skills (A18): each agent's skills come with a name, one line and a "try this" starter that prefills and never sends; `venture.agents.export {agent}` returns its steps, persona and standing orders without notes; `venture.agents.import {text}` becomes a 4B1 proposal, never a direct change.

**Implementation notes.** `actTask` (`delivery/harness/loop.ts`); `houseStyleFindings` (`records.ts`); `simulate.ts` practice clients and `costDisplay`; 4B1's proposal store.

**UI pieces:** none (4J22b).

**Done when:** `node --test platform/tests/venture-voice.test.ts platform/tests/venture-persona.test.ts platform/tests/venture-questions.test.ts platform/tests/venture-agent-export.test.ts` shows `# fail 0`.

#### Package 4J18: what the AI knows, ideas, the capability page (E)

Size M. Rows: A10, A11, A16 (the capability page).

**Files:** new `agents/knowledge.ts`, `agents/ideas.ts`, `agents/capabilities.ts`; `agents/index.ts` (lines); tests `platform/tests/venture-knowledge.test.ts`, `venture-ideas.test.ts`, `venture-capabilities.test.ts` (new).

**Failing tests first:**

1. Knowledge (A10): `venture.knowledge.add {source}` (text; a link, fetched through the net guard and screened; a file; or a best past piece of work), `.list`, `.remove`, and `.test {question}` (a search over the sources by shared words, no model); questions the agents handed to the owner that the sources couldn't answer become requests ("To answer 6 questions well, add files about refunds and delivery times"), listed monthly.
2. Ideas (A11): code rules over evidence make ideas `{title, reason, evidence, prompt}` that the owner starts (`ideas.start` drafts a proposal or an order suggestion); an idea retires when its evidence no longer holds; "Who is waiting on you" lists only real records (an unanswered client question, an invoice a run promised); dismissals are remembered; an idea without an evidence record can't be made.
3. Capability page (A16): `venture.agents.capabilities {agent}` lists "What it can see" (its steps' read tools), "What it can do" (write and send tools and the outside actions it may propose) and "If it is off here, it can't do it"; an empty list never means everything.

**Implementation notes.** `guardedFetch`, `screenUntrusted`; `listRecords`; `toolSpec`, the effect list (`policy/effects.ts`); `draftProposal` (4-0).

**UI pieces:** none (4J22b).

**Done when:** `node --test platform/tests/venture-knowledge.test.ts platform/tests/venture-ideas.test.ts platform/tests/venture-capabilities.test.ts` shows `# fail 0`.

### Area: the hosted trial

#### Package 4J23: start without an account on the hosted app (E)

Size M. Rows: O25.

**Files:** `platform/runtime/hosted/accounts.ts`, `app.ts`, `server.ts` (trial routes), `limits.ts`; tests `platform/tests/hosted-trial.test.ts` (new).

**Failing tests first:**

1. `POST /api/hosted/trial` starts a business without an account: a trial session, a temporary business that expires 7 days after its last use unless claimed, and the line "This business is temporary until you add your email." on the session view; one business per trial, no paid calls except on the owner's own key, rate limits from `limits.ts`.
2. Claiming by email link or passkey moves the business to the new account and clears the expiry; an expiring trial says so in the session view a day before; an expired one is deleted with its vault.
3. A trial session can't issue invoices or payments for real (`TRIAL_LIMIT`).

**Implementation notes.** `AccountService`, `requestMagicLink`, `verifyMagicLink`, `selectBusiness` (`hosted/accounts.ts`, `app.ts`); `HostedCustody` for the vault; `DEFAULT_LIMITS`.

**UI pieces:** the banner (4J21).

**Done when:** `node --test platform/tests/hosted-trial.test.ts platform/tests/hosted-server.test.ts` shows `# fail 0`.

### Area: the 4J screens

#### Package 4J19: approvals, previews and order steps on screen (U)

Size L. After 4J1, 4J2, 4J3, 4G2 and W3's 3B5a, 3C, 3E1.

**Files:** `app/ui/src/parts/ApprovalRow.tsx` (meta line, "Sends to the client", attempt, counts, price, change count, stale words), `app/ui/src/places/today/CardPreview.tsx`, new `app/ui/src/places/today/SendBack.tsx`, `EditSheet.tsx`, `SetPicker.tsx`, `TriageBox.tsx`; new `app/ui/src/places/work/OrderSteps.tsx` and one line in `OrderList.tsx`; `app/ui/src/parts/RunSheet.tsx` (the Delivered card); new `app/ui/src/places/business/DecisionsView.tsx`; `app/ui/src/engine/fake-w4.ts`; `app/ui/src/text/{en,hi}/today.json` (`today.meta.`, `today.sendBack.`, `today.set.`, `today.triage.`), `work.json` (`work.steps.`), `common.json` (`approval.meta.`, `delivered.`), `business.json` (`business.decisions.`); tests `app/ui/tests/parts/approval-meta.test.tsx`, `app/ui/tests/places/today-actions.test.tsx`, `work-order-steps.test.tsx`, `business-decisions.test.tsx` (new), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. The card meta line "for Mehta Traders · Ledgerline · 09:20 · expires in 2 h" with the stale words; "Sends to the client" when `sendsTo` is set; "Try 2. Last time: {error}"; counts "212 of 3,000" per platform; the price beside Approve ("₹4.20, nothing spent yet") with its receipt and the free way; the change count line with folded detail and its coverage line; after a stale decide, "This click did not run anything. Here is the new version."
2. Send back: a secondary "Send back" on draft cards opens a box prefilled "Revise this to " and calls `venture.queue.sendBack`; after failed checks, "Fix all, or tell me which?" with check choices calling `venture.delivery.fix`.
3. Edit: the draft text opens for editing and Save calls `venture.queue.edit`; the merge notice and "Review replacement", "Confirm replacement" ("This does not merge the entries"), "Keep current, reject change"; Undo lines; sent items show "Make a copy".
4. "Approve several" on a group of posts opens a picker with nothing preselected, the total with its receipt and one Approve with a second ask; there is no "Approve all".
5. Previews: the video ground shows a poster only when `posterId` exists (an image from the engine's file, never a stand-in), with duration, chapters and "3 checks passed"; paper lines in DM Mono with the total's receipt; post text with counts; choice options with estimate chips.
6. Triage: "Sort Today by" with a dry-run list and Save; Work order cards show the stage stepper and "2 wait on you"; the run sheet shows the Delivered card; Business > Decisions lists who decided each item, with "Stop always allowing".
7. Ctrl+Enter approves only plain yes or no rows and never while a draft is open (O7).

**UI pieces:** D-Today (`.qcard`, `.qc-*`, `.pv*`, `.paper`, `.post*`, `.opt*`), D-Work (`.osteps`).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/parts/approval-meta.test.tsx app/ui/tests/places/today-actions.test.tsx app/ui/tests/places/work-order-steps.test.tsx app/ui/tests/places/business-decisions.test.tsx app/ui/tests/parts/approval-card.test.tsx app/ui/tests/a11y.test.tsx` all pass.

#### Package 4J20: the money views on screen (U)

Size L. After 4J4 to 4J6, 4F2, 4A2, 4I2 and W3's 3F, 3B2.

**Files:** `app/ui/src/places/money/OwedTile.tsx` (AgingBar), new `InOut.tsx`, `CashAhead.tsx`, `NextWeeks.tsx`, `ExportButton.tsx`, `Across.tsx`, `Bills.tsx`, `Recurring.tsx`, `Margins.tsx`, `Meter.tsx`, `LimitSheet.tsx`; `Invoices.tsx` (lateness, Remind, timeline), `PaymentSheet.tsx` (allocations, TDS, cheque pending), `views.ts` (fills W3's slots), `index.tsx` (month picker, business chips, Bills and Margins sub-pages); `app/ui/src/shell/BusinessMenu.tsx` ("Invite your accountant"); `app/ui/src/text/{en,hi}/money.json` (`money.aging.`, `money.flow.`, `money.cash.`, `money.export.`, `money.across.`, `money.bills.`, `money.recurring.`, `money.margins.`, `money.meter.`); tests `app/ui/tests/places/money-views.test.tsx`, `money-documents.test.tsx`, `money-across.test.tsx` (new), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. The owed tile draws the AgingBar (five buckets, legend with counts and amounts, one receipt), "Billing drafts, you send" and "Draft 3 reminders" (each late invoice's `venture.invoice.remind`, then 4E4's handoff sheet); W3's "no aging bar" test is flipped.
2. In and out by month: a paired BarChart with the engine's values above the bars and what was left under each month, "View chart data", and the no-rate line when present.
3. Cash, next 13 weeks: the CashLine with the actual line and the dashed forecast, "In the bank today", the two lowest-week figures with receipts, the assumptions, and "Issuing INV-0042 today adds ₹18,880 in the week of 2 Nov" linking to Today; without a statement, the import line and no chart.
4. Next three weeks by date; the month picker; "September ₹92,600"; Export for your CA (a save dialog on the desktop, a download on the web).
5. Business chips "All businesses", one per business, and the locked one with its words; snapshot figures with their as-of line.
6. Bills, recurring invoices, credit notes (second ask), cheque pending, the TDS line, margins per client, the meter "79% of this month's limit used" with its near line, and the limit sheet (raise it, use another key, wait until the date; no credits).
7. `assertFiguresProved` holds on every Money page.

**UI pieces:** D-Money (all of it).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/money-views.test.tsx app/ui/tests/places/money-documents.test.tsx app/ui/tests/places/money-across.test.tsx app/ui/tests/places/money*.test.tsx app/ui/tests/a11y.test.tsx` all pass.

#### Package 4J21: the Start gallery, connector guides, the owner's name, the trial banner (U)

Size M. After 4J7, 4J8, 4J9, 4J23, 4C2 and W3's 3G1, 3G2.

**Files:** `app/ui/src/places/onboarding/Start.tsx`, `ways.ts` (maps `venture.playbooks.list` onto W3's `WayData`), new `GalleryFilters.tsx`, `BusinessPick.tsx`, `FileDrop.tsx`; the connector sheet in `app/ui/src/places/connections/` (the guide), new `ChecksTile.tsx`; new `app/ui/src/places/work/FileRequest.tsx` and `ShareLinks.tsx` (viewed, client comments); `app/ui/src/places/business/PlanView.tsx` (checklist names), new `OwnerView.tsx`; `app/ui/src/places/today/Greeting.tsx` (the name); `app/ui/src/shell/` (the trial banner); `app/ui/src/text/{en,hi}/onboarding.json` (`onboarding.ways.`), `connections.json` (`connections.guide.`, `connections.checks.`), `work.json` (`work.request.`), `business.json` (`business.owner.`), `today.json` (`today.greeting.`), `common.json` (`trial.`); tests `app/ui/tests/places/start-gallery.test.tsx`, `connections-guides.test.tsx`, `work-file-request.test.tsx`, `business-owner.test.tsx` (new), `tests/a11y.test.tsx` rows.

**Failing tests first:**

1. Start: the `h1` becomes "Pick a way to earn" when ways exist (W3's rule); category chips with counts, "Up to 5 h a week", sort (Best fit, Fewest hours, Name); tiles with "You run this" and "Start another"; "Clients usually pay" always with the model estimate chip; the one-sentence box offers "Add this to {business}" or "Start a new business", and the file drop on the desktop.
2. Connections: each connector sheet shows its guide (numbered steps, the skipped step, charges, the "Sends: ..." line, limits), the half-configured line and the ladder words; "Check connections" calls `venture.connectors.check` and lists its rows; "Reconnect" where one expired.
3. Work order: "Ask the client for a file" makes the request link with its 15-minute expiry and the page's words; ShareLinks shows "Viewed 21 Oct, 10:42" and per-item client comments.
4. Business: the setup checklist by name with links; Owner: first name and excluded services; Today's greeting says "Good evening, Kartavy" once a name is set.
5. The hosted trial banner: "This business is temporary until you add your email." with Add email.
6. Settings forms (spend policy, owner, notifications, goals) keep unsent edits through `venture.settings.draft` and say "Saved"; reopening after a crash offers "Recover unsaved changes from 18:42?" (W3's O22); nothing is kept in browser storage.

**UI pieces:** D-Start (all of it), D-Today (greeting).

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/start-gallery.test.tsx app/ui/tests/places/connections-guides.test.tsx app/ui/tests/places/work-file-request.test.tsx app/ui/tests/places/business-owner.test.tsx app/ui/tests/places/start-v2.test.tsx app/ui/tests/a11y.test.tsx` all pass.

#### Package 4J22a: quality and harness on screen (U)

Size L. After 4J10 to 4J16 and 4F3.

**Files:** `app/ui/src/parts/states.ts` (W4 values), `app/ui/src/parts/RunSheet.tsx` (coverage, outcome words, the three-column report, question expiry, interrupted words), `app/ui/src/places/business/PracticeView.tsx` (drills, lift, experiments), new `RoutinesView.tsx`, `GuidanceReport.tsx`; new `app/ui/src/places/work/ContractSheet.tsx`; `app/ui/src/places/money/Journal.tsx` (the chain line, "Check a receipt"); `app/ui/src/places/team/AgentSheet.tsx` (shadow summary, auto readiness, after 4B3); `app/ui/src/text/{en,hi}/*` under `states.`, `runsheet.`, `business.practice.`, `business.routines.`, `work.contract.`, `money.chain.`, `team.readiness.`; tests `app/ui/tests/parts/states-w4.test.ts`, `app/ui/tests/places/business-practice-w4.test.tsx`, `business-routines.test.tsx`, `work-contract.test.tsx`, `team-readiness.test.tsx` (new).

**Failing tests first:**

1. Drift: every W4 engine verdict, outcome, run state, queue kind and stage value has its words in `states.ts` (the test reads the engine's exported lists).
2. The run sheet shows coverage ("1,204 of 1,210 lines matched"), "Not run" lists, Success, Not checked or Failed, the three-column report, "Expires in 3 h" on questions and "Interrupted: nothing was sent again".
3. Business > Practice runs drills and lists each result against the playbook version, the lift line and experiment records; Business > Routines lists schedules in words with their time zone and a history that says "delivered", and sets or removes with a second ask.
4. The agent panel shows the shadow summary (dashes where unknown) and the auto readiness list with each item met or not and "Built but locked. It opens after two clean drill runs and the founder's yes."; the auto posture choice stays disabled with that reason.
5. The contract sheet on a Work order (goal, scope, protected items, checks) with Sign (second ask); Money > Journal shows the chain line and "Check a receipt".

**UI pieces:** built from D-STYLE pieces and the run sheet of D-Work.

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/parts/states-w4.test.ts app/ui/tests/places/business-practice-w4.test.tsx app/ui/tests/places/business-routines.test.tsx app/ui/tests/places/work-contract.test.tsx app/ui/tests/places/team-readiness.test.tsx app/ui/tests/a11y.test.tsx` all pass.

#### Package 4J22b: agent extras on screen (U)

Size M. After 4J17, 4J18, 4J12, 4B3 and 4J22a (the agent panel).

**Files:** `app/ui/src/places/team/AgentSheet.tsx` (tabs Persona with Test, Skills, Can do), `AgentCard.tsx` and `DepartmentPanel.tsx` (helpers nested under parents); new `app/ui/src/places/business/VoiceView.tsx`, `KnowledgeView.tsx`; new `app/ui/src/places/today/IdeasFold.tsx`, `QuestionsCard.tsx`; `app/ui/src/text/{en,hi}/team.json` (`team.persona.`, `team.skills.`, `team.cando.`), `business.json` (`business.voice.`, `business.knowledge.`), `today.json` (`today.ideas.`, `today.questions.`); tests `app/ui/tests/places/business-voice.test.tsx`, `team-persona.test.tsx`, `today-ideas.test.tsx`, `today-questions.test.tsx` (new).

**Failing tests first:**

1. Business > Voice: the six sections per language and channel, on or off, and "Learn from my writing" with the validated mark only after the held-out check.
2. The agent panel: Persona with Test (showing its cost), Skills with "Try this" starters that prefill and never send, Can do with its three lists, and Export and Duplicate (without notes).
3. Today: Ideas folded at the end with their evidence and Start; the "Who is waiting on you" block; question cards in rounds that accept "1 yes, 2 no", with the submit label restating the answer and no approval inside.
4. Team: helpers nested under their parent with spend rolled up.
5. Business > What the AI knows: sources, the test search, and requests for missing files.

**UI pieces:** D-TeamChat panel tabs, D-Today folds.

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/business-voice.test.tsx app/ui/tests/places/team-persona.test.tsx app/ui/tests/places/today-ideas.test.tsx app/ui/tests/places/today-questions.test.tsx app/ui/tests/a11y.test.tsx` all pass.

---

## Package 4Z: the walk, the screenshots and the Hindi review list

Size M. Integrator plus one agent, after every package.

**Files:** `scripts/ui-shots/*` (W3's script: the W4 addresses), `app/ui/src/text/hi-review.json` (W4 keys), new `app/ui/tests/baselines/text-keys-w3.json`, `app/ui/tests/baselines/words.json` (W4 places), `app/ui/tests/a11y.test.tsx` rows, `docs/venture/ink.md` (known limits).

1. Walk each W4 flow in the running app (the dev UI with the fake engine, then Electron with the sample engine): chat with an agent, accept a "from now on" change, undo it; ask Chats a money question and raise a proposal to Today; import a LinkedIn export, search, draft an intro, hand it to WhatsApp, tap I sent it, see the follow-up on Today; stop and resume a run and trip the breaker; set a goal; see the bell and the digest; check the CLI status; export for the CA.
2. Screenshots at 1280 and 390, light and dark, of `#/chats`, `#/team?sheet=agent:story-editor&tab=chat`, `#/team?dept=prod`, `#/team`, `#/clients/pipeline`, `#/clients/network`, `#/money`, `#/onboarding`, `#/today`, `#/work`, compared by eye with D-Chats, D-TeamChat, D-TeamDept, D-Team, D-Clients, D-Network, D-Money, D-Start, D-Today and D-Work; Hindi at 390 light; the unprimed review (catalogue Q24) on the new shots; the side-by-side page published privately for the founder.
3. Real-browser axe with colour contrast on, both themes and both widths, for each new address and opened state.
4. Every English key added in W4 (keys not in `text-keys-w3.json`) is in `hi-review.json` and in both catalogues; word baselines for the new places are measured once and may only shrink after; any rise on an existing place is listed in the PR for the founder.
5. `docs/venture/ink.md` lists what stays planned (W5 playbooks and everything under "Not placed").

**Done when:** the walk finds no fault left unfixed or unlisted, axe passes in every case, the text and Hindi list tests pass, and the side-by-side page is published.

---

## Wave 4 done when

- Every package's tests pass; `npm run typecheck` and `npm run typecheck:ui` are clean; `npm run test:ui` (no skipped tests), `npm run build:ui` and all six bench shards (`node scripts/bench.mjs`, in the background) are green.
- Every row of coverage tables A, B and C has its test through the named method or place.
- One PR "Ink v2 wave 4: new features", stacked on wave 3, with the coverage tables, the founder decisions table, and conventional commits (`feat(w4-engine): ...` for E work, `feat(w4): ...` for screens).

## Not placed, or placed only in part

- **M2 and M3, the credits and plans parts.** A spec non-goal ("Credits, plans or billing. The owner pays for AI directly."). What survives (own-key usage rows, meters, the "limit reached" sheet without credits) is in 4F2 and 4H1.
- **A16, a custom agent from one sentence.** Playbooks are data, and a new role needs W5's step mechanics (5A). W4 builds the capability page and points "Add an agent" at the ways to earn that staff the department. Revisit in W5.
- **U7's filmstrip** (screenshots of browser posting runs). It needs W2 2B2's page model to capture a screenshot without new launch options; 4F1 builds it only if that holds, else it is listed in `ink.md`.
- **C22, importing clients and their history** (a spreadsheet, Tally, Zoho, a helpdesk export) with Start and Watch. 4D1 built the Check and Undo pattern for network files only (review of 23 Oct). The clients import reuses it and lands in W5 beside the playbooks that use client history.
- **Network import on the hosted app.** Refused in W4 (the decision says "on this computer"); it needs parsing in the browser before it can be offered there.

## Choices made here that the founder may want to change

1. Chats and the chief's threads live in each business's own vault, not one store per owner, because the engine opens one business at a time; Chats lists the open business's threads, and questions about other businesses use their snapshots (4J6).
2. Snapshots (4J6) are a new piece of custody: a summary of money and runs, encrypted with this computer's key, for businesses that open with this computer, so "All businesses" and Chats can show them while closed. Passphrase businesses show nothing. Say no, and "All businesses" shows only the open one.
3. One chat consent per business covers agent chat, Chats and network search, because each sends client or contact data to the owner's AI.
4. The department map of roles and service types (4A1), and "Shared by the team" for spend that no single role can claim.
5. Numbers: strength weights, the 180-day half-life and band edges (4D2); follow-up days and caps (4E1); the send governor (4E2); write caps (4F2); notification pacing (4G1); the push service host list (4G3).
6. Not now is terminal; "Ask again" makes a new linked card, so no stage ever moves backward.
7. Goals count invoices before tax (D's sample counted the tax).
8. An owner's standing order may keep numbers the owner typed ("under 60 seconds"); the model may not add any.
9. The read-only IMAP client is written in the repo on `node:tls` rather than adding a dependency.
10. The gallery shows only built playbooks (three in W4); W5 adds the rest.
