# Chausar frontend rework, "Ink", and the engine pieces it needs

Written 21 October 2026 with the founder. Approved in conversation section by section (overview, architecture, interface, edge cases); the founder asked for the whole thing built in one go. Research behind it: `D:\claude\chausar-2\research\grok-harvest-2026-10-21\` (cards for 35 repos, frontend studies of 16 products, an audit of the current renderer).

## 1. Goal

One React frontend for desktop (Electron) and hosted web, in the Ink look, built around one idea: **the owner approves; the team works.** It replaces `app/renderer` (vanilla JS, three visual systems) once it covers every place. Alongside it, the engine gains the mechanisms the research found worth taking: journalled actions, bound approvals, a posture ladder, reserve-then-settle spend, a vote-then-count judge, an evidence ledger, three flagship playbooks and honest connector modes.

## 2. Non-goals

- The phone companion (later).
- Deploying the hosted tier, paid services, sending real messages, live platform posting.
- Merging the `claude/lane-*` branches. We mine `app/ui` from `origin/claude/clever-goldberg-49qobq` for parts (fonts, tokens, text catalogues, charts, sheet focus rules) and restyle them.
- A portfolio home page. One shared queue covers "what needs me" across businesses.

## 3. Founder decisions (21 Oct)

| Topic | Decision |
|---|---|
| Home | Today is the approval queue |
| Several businesses | A switcher in the rail; Today's queue spans every business on this computer |
| Agents | Live "Working now" under Today, a Team place, and one run sheet ("watch it work") opened from anywhere |
| Onboarding | One sentence, then inside the app; the plan is Today's first row; connect AI, prices and keep arrive as rows |
| Look | A, Ink (canvas https://claude.ai/artifact/JRgVmuiEaSJB4ubvBgpJnc) |
| Surfaces | Desktop and hosted web, Hindi from day one |
| Build | New React app alongside the old renderer, one switch when every place is covered |
| Places | Today, Team, Work, Clients, Money, Connections; plus a business menu at the top of the rail |
| Books | Inside Money |
| Model numbers | **Allowed.** Supersedes "the AI never does arithmetic". Shown as "model estimate", never with a receipt. Receipted figures still come from code |
| Posting | Browser-automation and cookie-session posting on the owner's own accounts: allowed, approval-gated, labelled with the ban risk. Not built: proxy rotation to evade detection; clipping without rights (rights recorded at intake instead) |

"Never fake a capability" still binds: every connector and execution place is labelled `handoff`, `read`, `write` or `planned`, matching what the code does.

## 4. Information architecture

```
Rail (220 px)                       Main                         Sheet (360-480 px, beside, never modal)
  Business menu                     Place content                Run sheet / approval detail / receipt
    switch business                                              one at a time, focus returns to the row
    plan and playbook
    prices
    website build
    new business
  Today        (count of needs-you)
  Team
  Work
  Clients
  Money
  Connections
```

Address is the hash: `#/<place>[/<sub>][?sheet=<kind>:<id>]`. Narrow windows (< 760 px): the rail becomes a top bar with a place menu; the sheet covers the main area.

### Today
1. Header: "Today" and one line: "3 need you, across 2 businesses" (count comes from the engine as a display string).
2. **Needs you**: rows oldest first. Each row: `business · agent`, title, one line, optional change (old value struck through in grey, new value in ink, receipt link or "model estimate"), and exactly two actions (primary right). Kinds: draft review (Watch/Read first, then Approve unlocks), price or quote approval, plan acceptance, invoice to issue, step needing a licensed sign-off ("Send to CA"), agent question (Answer), setup rows (Connect your AI, Set prices, Keep this business), locked business ("Lumen Studio is locked. Open to see what needs you.").
3. Decided rows shrink to one receipt line ("Approved · R-0418", "Resolved elsewhere") and leave after the session.
4. **Working now**: one line per active run: agent, step named by purpose, elapsed time; "Waiting on you" in amber when paused on the owner (timer stops). Clicking opens the run sheet.
5. Empty: "Nothing needs you." Working now stays.
6. Keys: J/K move, Enter opens, A primary, D secondary (never on money rows: those take the second ask).

### Run sheet (one component, opened from Today, Team, Work)
Header (agent · run n, purpose title, started/elapsed), steps (done ✓ with time, current ○ in ink, pending in grey, waiting in amber), evidence links (each opens the thing: transcript, file, check result), tool lines folded under each step, the run's question box when it asks, and when done it folds to "Worked for 4m" with its result and receipt. Indeterminate progress says "indeterminate", never fakes a bar. A failed run shows the real error in plain words and Run again.

### Team
One row per agent: name, role, now (current step or "Idle"), last result (with receipt or "model estimate"). Opening an agent shows its steps from the playbook, each with an **auto / hold** gate (qm), its posture, its spend so far, and its runs.

### Work
Active runs and jobs on top (per-stage progress, BridgeClip layout), previous below folded to one line each. Orders appear here with their state sentence (CogSend wording). Filter by state in the URL.

### Clients
Clients list; a client sheet shows orders, drafts they have seen, shared preview links, files. Evidence-backed fields carry a dotted underline that shows their source on hover/focus (CRM).

### Money
Invoices, payments, quotes, books summary, tax workings. Every receipted figure is a button that opens its receipt. Model estimates are labelled. Spend: reserved vs settled per agent and per connector, unpriced calls shown as refused.

### Connections
All connectors grouped by category, each with its honest label (handoff/read/write/planned) and, for posting connectors, its mode (API, owner browser session, handoff) and the risk line. Your AI (models, keys, CLI) lives here too.

### Business menu
Switch business (`workspace.list`, `workspace.open`), plan and playbook (`venture.blueprint.*`), prices (`venture.price.quote`), website build (`venture.build.*`), new business (onboarding).

### Onboarding
One box: "What do you want to start?" On submit: `venture.preview` paints the plan inside the app shell; the plan is Today's first row ("Your plan is ready. Read it."). Next rows: Connect your AI, Set your prices, Keep this business (custody; no passphrase where the OS key store exists). No wizard, no mock website.

## 5. Look: Ink tokens

Fonts (bundled, OFL, from the lane branch): Instrument Sans 400/500/600, DM Mono 400/500, Noto Sans Devanagari 400/500 (Hindi and the rupee sign).

| Token | Light | Dark |
|---|---|---|
| `--bg` | #fbfbfa | #111214 |
| `--surface` (sheet) | #ffffff | #17181a |
| `--fg` | #16181b | #eceef0 |
| `--fg2` | #3d4146 | #c4c8cc |
| `--mute` | #5c6168 | #9aa0a6 |
| `--dim` (struck old values, pending steps) | #6e737a (was #71767d; 4.42:1 failed the contrast test) | #858b92 |
| `--line` | #e3e5e8 | #2a2d31 |
| `--hover` | #eceef0 | #1f2123 |
| `--link` | #2f5bd3 | #8fb4ff |
| `--wait` (waiting on you) | #b45309 | #e5a54b |
| `--fail` (only failure earns a hue) | #b42318 | #f97066 |

Type: 28/600 page title, 15/500 row title, 14 body, 13 secondary, 12 labels (never below 12; 13 for anything read). Spacing 4-px scale. Radius 6. Thin lines, no cards, no colour blocks, no shadows except the narrow-window sheet. One filled button per row (the primary). Motion: once, ≤ 400 ms, none when reduced motion is on. Theme follows the computer and is set before first paint. No AI personality: no mascot, no tint for AI, no "thinking..." flourishes; working states say what is happening.

Word budget at rest: about 40 words per place, excluding row content.

## 6. Architecture

```
app/ui (React 19, Vite 8, CSS Modules)
  src/tokens      tokens.css, fonts.css, motion.css
  src/text        en/*.json, hi/*.json (one file per place), t() with plural by exact digits
  src/engine      client.ts: request() over preload (desktop) or /api/rpc (web); events.ts: run event subscription
  src/shell       App, Rail, BusinessMenu, StatusLine, routes, keys
  src/parts       Row, ApprovalRow, Change, Receipt, ModelEstimate, Button, Sheet, RunSheet, Steps, JobList,
                  EmptyState, Field, Gate, Provenance, Label (handoff/read/write/planned)
  src/places      today/ team/ work/ clients/ money/ connections/ business/ onboarding/
  tests           vitest + jsdom + testing-library; one file per part and place
        |
        |  preload API (desktop) | POST /api/rpc + SSE /api/events (web)
        v
platform/runtime (engine)  venture.* methods, unchanged contract plus the additions in section 7
```

Rules the UI keeps (carried from the old renderer's tests):
- Text nodes only (no innerHTML), no storage of secrets, no money arithmetic in the UI: figures arrive formatted with their receipt id.
- Accept and approve send the digest of what was shown; a stale digest is refused by the engine and the row says "This changed since you opened it" and shows the new version.
- Honest labels drawn from engine data only.
- Strict CSP: no inline styles at runtime; CSS Modules compiled to a file.

Switch-over: a setting `ui.renderer` = `ink` | `legacy` (default `legacy` until every place passes its checks, then `ink`). Electron's asset allowlist and the hosted server's allowlist gain the built `app/ui/dist` files.

Done on 22 October, without the setting: Ink is the only app, `app/renderer` and its tests are removed, Electron and both servers serve only the `app/ui/dist` allowlist and refuse to start without it (`UI_NOT_BUILT`), the start commands and packaging build Ink first, and the engine acceptance tests drive the engine through the real preload instead of the old screens. See `docs/venture/ink.md`.

## 7. Engine additions

### 7.1 Contracts the UI needs (new methods)
| Method | Returns |
|---|---|
| `venture.queue.list { scope: 'current' \| 'all' }` | needs-you rows across businesses: `{ id, businessId, businessName, agent, kind, title, line, change?, receiptId?, estimate?, digest, actions: [primary, secondary], requiresView?, secondAsk? }`; locked businesses as `kind: 'locked'` rows |
| `venture.queue.decide { id, digest, action, answer? }` | `{ outcome: 'done' \| 'stale' \| 'refused', receiptId?, latest? }`; decide-once |
| `venture.runs.list { state?: 'active' \| 'done' \| 'all' }` | runs with agent, purpose, steps, elapsed (engine-computed display), waiting flag |
| `venture.runs.get { runId }` | full run: steps, tool lines, evidence refs, question, result, receipt |
| `venture.team.list` | agents with role, now, last result, gates per step, posture, spend display |
| `venture.team.gate { agent, step, gate: 'auto' \| 'hold' }` | updated gate (tighten-only rules apply, section 7.3) |
| run events | `run.started`, `run.step`, `run.waiting`, `run.done`, `run.failed`, `queue.changed` added to `VENTURE_EVENTS`; desktop gets them over IPC push, web over SSE `/api/events` |

Each new method goes into `VENTURE_METHODS`, the area map, the param/result types, `engine.ts` routing, `app/desktop/ipc-contract.cjs`, and the hosted contract (derived).

### 7.2 Action journal (Cloudflare OS)
Every outside effect is a journal entry: `described → approved → applied | rejected`, with `outcome_unknown` when an irreversible send times out ("check before retrying", never resent automatically). A durable claim is taken before an irreversible send. In shadow mode the agent continues against a simulated result and the simulation lists what it could not simulate.

### 7.3 Bound approvals and posture (opendesk, qm, omnigent, decionis)
- Propose then Apply. The approval token is bound to action, member, session and business, is single-use, expires (15 min for agent proposals, 1 hour for quotes), and never enters model context.
- Posture ladder: rehearsal → shadow → approve each → auto with spot checks. A narrower scope can only tighten. A fixed floor of always-ask actions (money out, sending to a client or public, deleting, changing prices, anything on a government portal) needs approval at every posture.
- Policy verdicts allow / deny / ask; a policy that errors blocks the action (fail closed). Gates start denied; a timeout never opens one.

### 7.4 Spend (floe-guard, Open Edit)
Reserve the estimated cost before a paid call, settle after with the billed amount; each cost carries `estimate` or `billed`. An unknown price is refused, never treated as zero. A quote binds draft digest, figure and payer for one hour and is refused if any changes. A charge record is written before each paid call so a retry never pays twice. All money is BigInt minor units.

### 7.5 Judge (agentbehavior, SkillEvaluator, bridgeclip, Countersign)
Rules are yes/no questions with a per-check floor (no averaging). The model must cite evidence ids from the run's trace; code checks the ids exist and that a failure quotes the rule. Code counts the verdicts. Claim checks compare figures, names and certifications in a draft against the source files with no model. Pairwise comparison for choosing between options. A committed baseline per playbook fails the check suite if quality drops.

### 7.6 Evidence ledger and model numbers (trycompai/crm, YouTube Pro)
Evidence types with fixed weights; only `verified` evidence overwrites a stored value; weaker evidence becomes a suggestion row. The claimed evidence type must match a real tool result. Claims carry `observed`, `inferred` or `needs-your-data`. The number guard changes from refuse to label: model text with numbers is allowed and marked `estimate: true`; a receipt is never attached to it.

### 7.7 Auditor role (LongHorizon)
Each run has a manager (plans), executor (one step), and a read-only auditor that checks the real output; only audited steps count as progress; a round ledger is kept.

### 7.8 Flagship playbooks (data plus deterministic checks)
- **YouTube channel**: offers (episode package; shorts from the client's own long video; clips under a recorded clip programme or licence), ten typed steps, approvals (rights at intake, quote before paid generation, draft after viewing, owner publishes), deterministic checks (hook score, title and thumbnail pairing, chapter rules, finishing check via ffmpeg when present: black, frozen, silent, levels, captions over face), disclosure of AI voice or presenter.
- **AI-native CA firm**: offers (monthly books, GST working, ITR prep, TDS working; audit and notices CA-only), steps with reconciliation against AIS/26AS/Form 16, all tax computed by the calculator, CA of record with membership number, CA confirmation of each rate-table version, final diff against the portal's own file. Portal connectors are `planned: handoff`; agents never file or sign.
- **Social media agency**: offers, 14 steps, owner then client approval via share link, channel capability table, draft-before-schedule, report numbers from client-uploaded platform exports, disclosure checks.
- A dated register of platform rules per playbook.

### 7.9 Connectors and the customer engine
- Posting connectors get a mode: `api` (needs app review; `planned` until reviewed), `owner-browser-session` (browser automation or cookie session on the owner's own account, approval per post, labelled "the platform may restrict this account"), `handoff`.
- Read-only bank connector shape (consent with visible expiry, polling cap, fingerprints against double import): `planned` until a provider is wired.
- Website edits: staged, applied only with the reviewed hash, verified, reversible.
- Leads: a lead needs its source URL; an email needs a passing MX check; blocklist before drafting; agents only draft, the owner sends; unsubscribe line and postal address added to outreach drafts.

## 8. Edge cases

| Case | Behaviour |
|---|---|
| Item changed after viewing | Engine refuses the digest; the row says "This changed since you opened it" and shows the new version |
| Run fails | Real error in plain words, Run again; finished steps kept |
| No AI connected | Today's first row is "Connect your AI"; templates still work; agent rows say what they wait for |
| Engine offline / web session ended | One thin status line at the top says what is wrong; nothing stale shown as live |
| Nothing needs you | "Nothing needs you."; Working now stays |
| Planned connector | Action shown as a handoff ("Open in YouTube Studio"), never a button that pretends |
| Locked business | A locked row; opening asks for the passphrase through the trusted host control |
| Second ask (money, irreversible) | A second confirm inside the row; keyboard A never runs it |
| Hindi | Every string in `hi`; rows may wrap to two lines |
| Narrow window | Rail becomes a top bar; sheet covers main |

## 9. Testing

- Engine: node `--test` files per new module (`platform/tests/venture-*.test.ts`), contract tests updated for new methods, the full serial suite green.
- UI: vitest + jsdom + testing-library per part and place; a contract test that every method the UI calls is in the IPC allowlist; axe checks on each place; text catalogue parity (every `en` key exists in `hi`).
- Running app: the hosted dev server and Electron both load Ink behind `ui.renderer=ink`; screenshots of each place in light and dark at 1280 and 390 px.
- The old renderer tests stay green while `legacy` is the default.

## 10. Open questions

- Hindi strings are machine-drafted in this build; a native reviewer should pass over them.
- Cross-business queue reads other businesses only when their keys are in the OS key store; passphrase-locked businesses show a locked row.
- The Income-tax Act, 2025 section renumbering from April 2026 needs a CA to confirm before the CA firm playbook cites sections.
