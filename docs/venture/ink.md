# Ink: the new frontend and the engine pieces behind it

Ink is the React app in `app/ui`, and since 22 October it is Chausar's only app, on the desktop and on the hosted web tier. It is built around one idea: the owner approves, the team works. The spec is `docs/superpowers/designs/2026-10-21-chausar-frontend-ink.md` and the build plan is `docs/superpowers/plans/2026-10-21-chausar-frontend-ink.md`. This page says what was built on 21 October, how to run it, and what is still missing.

## The switch-over (22 October)

The old renderer (`app/renderer`: `app.js`, `launch.js`, `styles.css`, `index.html`) is gone, with its tests. Electron, the local server and the hosted server serve only the Ink build in `app/ui/dist`, from an allowlist of its files made at startup and under the same strict content security policy as before. The `--ink` switch and `CHAUSAR_UI` are gone too: there is nothing left to switch, and both are now ignored.

The engine acceptance tests that used to drive the old screens now drive the engine through the real desktop preload and its strict IPC contract (`platform/tests/fixtures/preload-bridge.ts`), which is the path Ink takes on the desktop. Every engine assertion stayed; the checks on the old screens' text went with them.

## Run it

```sh
npm start             # local server: Ink at /, the pairing link is printed
npm run desktop       # the Electron window
npm run start:hosted  # hosted web tier, development mode: Ink at /app/
```

Each of these runs `npm run build:ui` first (an npm `pre` script), so a fresh checkout works. Started any other way without a build, the local and hosted servers refuse with `UI_NOT_BUILT`, the desktop launcher stops before opening Electron, and a window started directly shows the reason in an error box; each says to run `npm run build:ui`. Packaging (`npm run package:preview`, `npm run package`) builds Ink itself with Vite before electron-builder runs, and the package carries `app/ui/dist` and none of the app's sources, tests or tooling.

For work on the screens alone, `npm run dev:ui` runs the app against its fake engine (two made-up businesses, Lumen Studio and Ledgerline), and `npm run test:ui` runs its tests.

## What the owner sees

- **Today** is the approval queue, across every business on this computer. Each row has exactly one primary action. A row that changed since it was opened says so and shows the new version; money rows ask twice; drafts, plans, invoices, posts and CA papers must be read before Approve unlocks. Working now lists the runs in progress.
- **Team** shows each agent, its posture, its spend and a gate per step (auto or hold). Steps on the always-ask floor stay on hold.
- **Work** shows runs and orders. One run sheet ("watch it work") opens from anywhere and shows steps, tool lines, evidence and the run's question.
- **Clients** shows clients with what each owes, leads (blocklist included), and where each field came from.
- **Money** shows Money at a glance, invoices, payments, books, spend with the reason a call was refused, the tax working, the action journal and the spend policy.
- **Connections** shows every connector with its honest label, posting modes with their risk line, your AI, bank statement import and staged website edits.
- **The business menu** holds the plan, prices, the website build, keeping the business safe, the CA of record for a CA firm, and a new business.
- **Onboarding** is one box: what do you want to start? The plan becomes Today's first row.

English and Hindi are both in from day one. The Hindi text was drafted by machine and still needs a native reviewer.

## What the engine added

Every figure the screens show comes from the engine already formatted, with its receipt; the UI never adds anything up.

| Area | Methods and records |
|---|---|
| Today | `venture.queue.list`, `venture.queue.decide` (decide once, stale digests, view first), and `venture.queue.view`, which returns what a row is about in words: a draft's text and the files it read, the exact text a run sends to your AI, a heavy-work brief, an agent's question, an invoice, the plan, a CA sign-off request, the rate tables waiting for the CA, a post's exact text, a cost to approve or a suggested value. |
| Runs and team | `venture.runs.list`, `venture.runs.get`, `venture.team.list`, `venture.team.gate`, and `venture.team.posture`: an agent may work at its business's stage or tighter, never looser (`POSTURE_ABOVE_STAGE`). A rules-judge check nobody settled reads "Not checked", never "Failed". |
| Money | `venture.money.overview` (owed, received this month, spent on AI and tools), owed per client on `venture.client.list`, the total and price receipt on each `venture.invoice.list` row, the refusal reason on each spend row, and `venture.tax.working`. The sums are BigInt with a `venture-sum-receipt` record each, which `venture.receipt.get` opens; the same sum opens the same receipt, and a changed sum makes a new one while the old one reads stale. |
| Evidence | `venture.evidence.list`, `venture.evidence.apply` and `venture.evidence.dismiss`: a dismissed suggestion stays in the ledger and never comes back to Today. |
| CA firm | `venture.ca.get`, `venture.ca.setOfRecord`, `venture.ca.recordSignoff` and `venture.ca.confirmRates`, each write checked against the CA's ICAI membership number. A delivery run for a regulated CA offer (GST, TDS, ITR, notices) asks for the CA's sign-off by itself when its draft is ready. |
| Leads | `venture.leads.add`, `.list`, `.draft`, `.recordSend` and `.block` (an email or a whole domain, checked before any draft). |
| Share links | `venture.share.create`, `.list` and `.revoke`: a read-only preview link for one ready or accepted draft. See below. |
| Journal and posture | Every outside effect (invoice issue, posts, website edits) is journalled, approved with a single-use token bound to the action, the member, the session and the business, and checked by the policy gate (allow, deny or ask; a gate that errors or times out denies) before anything leaves Chausar. The journal is swept when a business opens and every five minutes in the engine's tick, so an interrupted claim becomes "outcome unknown: check before retrying". At shadow, an agent's proposed outside action is simulated, never approved or applied. |
| Spend, judge, playbooks | Reserve then settle in micro-USD, unknown prices refused; yes or no rules with per-rule floors and cited evidence; the read-only auditor; and the YouTube channel, AI-native CA firm and social media agency playbooks with their dated platform rules. |

### Client share links

The owner makes a link inside the app for one draft that is ready (every check passed) or that the owner accepted or edited. The vault keeps a sha256 of the link's token, never the token, and a copy of the exact text the link shows. The token is in the address once, in the answer to `venture.share.create`; the list never shows it again.

Only the hosted web tier serves the link, at `/share/<token>`, and only when `CHAUSAR_PUBLIC_URL` is set to the server's own origin (`CHAUSAR_HOSTED_ORIGIN`). The page is plain HTML with no script and no cookie, a strict content security policy, and a small same-origin form with Approve and Ask for changes. The answer goes through the social playbook's approvals: once per draft, on the exact text shown, before the link ends. To find the business that owns a token without the owner's session, the hosted directory keeps an index of token hash, account, business, link id and end time; revoking a link or deleting the business removes its entries. Unknown, revoked and ended links all get the same page that says nothing is there. The local server answers 404 for `/share/`, and on the desktop a new link comes back with no address and the reason.

## Ink v2, wave 3: the look (26 October)

Wave 3 gave every place the direction D look the founder chose on 23 October (B's bento and department panels with C's greeting, dark goal card, stories and preview cards, made cohesive; the Jade accent #2FB67C; the theme follows the computer): the tokens, the new parts, every place, the phone layout and Hindi for every new string. The plan is `docs/superpowers/plans/2026-10-23-chausar-ink-v2-w3.md`; the boards, the board-by-board walk (`WALK.md`) and the founder's side-by-side page (`side-by-side.html`) are in `docs/superpowers/designs/ink-v2-direction-d/`.

### The walk and the real-browser checks

- `node scripts/ui-shots/walk.mjs` opens every place, its main states, its sheets and the forms and second asks inside them on the fake engine, at 1280 and 390 px, light and dark, and in Hindi at 390. It takes a full-height shot of each into `app/ui/.shots/` (not committed), runs axe-core on the whole page with colour contrast on, presses through the focus plan (J and K, the second ask, a sheet, the business menu), and checks what jsdom cannot: no sideways scroll, no text key on screen, no em dash, no console error, and Hindi counts in the body face. It exits 1 on anything not listed, with its reason, in `scripts/ui-shots/accepted.mjs`. `--base=http://localhost:<port>` uses a running `npm run dev:ui` (otherwise it starts its own on 5179); `--cdp=9481 --workers=4` gives each headless Chrome its own debugging port, with its profile inside the output folder; `--only=today,team` walks some cases; `--publish` copies the shots that match a board (1280 and 390, light) into the designs folder and rewrites `side-by-side.html` and `WALK.md` from `scripts/ui-shots/boards.mjs`.
- It drives headless Chrome, not Electron as the plan first said: the same Chromium engine, on the debugging ports and profiles every wave 3 package already used.
- The parts page, `app/ui/parts.html` with `app/ui/specimens/` (outside `src/`, on the dev server only, never built), draws the app on other fake starts (nothing waiting, the department views W4 4A1 sends) and the parts W4 feeds with sample props, so the boards with no place yet (one department, Network, Chats) and the charts have a picture. It says "sample props, not engine data" at the top.
- Word budgets: `app/ui/tests/budgets.test.tsx` holds each place at rest to its baseline in `app/ui/tests/baselines/words.json` (measured on 26 October, rounded up to the next 10; they may only shrink), a page's sub line to 20 words and an approval card's own copy to 12. Direction D carries far more than Ink v1's 35 to 45 words (Today 660, Connections 740); the founder confirms the baselines in the wave 3 PR.
- The last walk (256 checks, none failed, nothing accepted): no axe violation and no colour-contrast violation in either theme, every focus check passing, and twelve faults it found fixed with a test each, among them receipt sheets marked as the proof, Hindi step counts in the body face, the phone's covering sheet as a modal dialog, the business menu as a labelled dialog, the invoices table stacking when its column is narrow, and cards keeping to 12 words of their own. `WALK.md` has the list and the numbers.

### Known limits of wave 3

- **Listed, not fixed** (each in `WALK.md` with its reason): the sign-off paper preview shows only the two title lines the engine's view sends; a connector with one writing and one planned mode shows both labels on one card; some engine and fixture words still say "stopped" beside a Failed chip (W4 4F words).
- **Engine words stay English in Hindi.** Today's summary, row lines, action labels and the spend line are written by the engine; the fake engine writes English, so a Hindi page mixes them. Every Hindi string in the UI is machine-drafted and listed for a native reviewer in `app/ui/src/text/hi-review.json`.
- **Amounts in sentences.** `[data-engine-line]` lets an engine sentence carry an amount without its own receipt (Today's row lines, some Money lines) until W4 4J1 gives those amounts receipted row meta and removes the marker. Receipt sheets carry `[data-receipt-sheet]` for good: the sheet is the proof.
- **Choices the founder may change** (plan, "Choices made here"): type never below 12 px, nothing loops (no slow pulse, no cycling examples), measured word baselines, only real data on screen, the dark goal card lifted to #1f2124 with a border.
- **Phone install.** The local server and Electron do not serve the web manifest yet (a harmless 404); the hosted app serves `/app/manifest.webmanifest`. The desktop tray icon is still the old "C" mark, since wave 3 does not touch `app/desktop/`.

### What waits for wave 4

Where a board shows data the engine does not send yet, the place draws what is real and leaves the rest out; nothing is faked. The parts for that data are built and tested, so W4 wires data rather than drawing screens.

| Place | Waits for | W4 package |
|---|---|---|
| Rail and header | Chats in the rail, the Ask Chausar box and Ctrl K, the bell with its count; there is no account button | 4C, 4G |
| Today | goal progress, pace, days left, ready to issue and the next best step (the goal card shows what was invoiced until then); departments on agents (tints, badges, chips); the Chausar story and Add agent; card previews (frames, durations, chapters, invoice lines, post text, title choices, check counts); row meta (client, expiry, "Sends to the client"); Stop on running rows; the owner's first name in the greeting | 4I; 4A; 4C; 4J queue previews; 4J approvals; 4F; 4J owner profile |
| Team | departments and their summaries, the toggle and `?dept=`, the one-department view, the six-week chart, Done this week, Add an agent, Keeper, held spend; the Chat button and tab, the instructions version, standing orders, "set by" lines | 4A; 4B |
| Work | Stop, Force stop, Resume, the breaker's words, "Run again keeps step 1", How to fix it; order stage steps and the price on an order; frames on run tiles; runs across a locked business | 4F; 4J order steps; 4J queue previews; 4J |
| Clients | the Network tab with search, imports and warm paths; the pipeline stages Found to Not now, strength, follow-ups, drafts and handoffs, the stat tiles; cards that move | 4D; 4E |
| Money | the goal on Invoiced; aging in five buckets, in and out by month, 13-week cash, costs ahead, lateness, comparisons, money across businesses, the month picker, Export for your CA; spend by department and held spend; reminder drafts | 4I; 4J money views; 4A; 4E |
| Connections | the CLI found on this computer and its status; least-privilege setup guides and "Sends: nothing"; network sources | 4H; 4J connectors; 4D |
| Business | Goals; Notifications; the setup checklist's item names; the accountant invite | 4I; 4G; 4J |
| Start | the ways to earn (tiles per playbook in W5); "Good fit for you"; Ask Chausar; the business picker and file drop | 4J; 4C; 4J |
| Phone | the Chats tab (Clients moves into More); the bell; the business name in the hosted manifest | 4C; 4G; 4J |
| Parts built, waiting for data | GoalCard with a goal, NextStep, Gallery, PathLine, StrengthDots, the Board in W4's stages, NotificationBell, Composer, ChatThread, DiffCard, AgingBar, BarChart, CashLine, SplitBar; PreviewFrame's text view takes a `proof` the file and plan views do not send yet | 4I, 4J, 4D, 4E, 4G, 4C, 4B |

## Known limits

- **The walk.** Done in wave 3: see "Ink v2, wave 3" above and `docs/superpowers/designs/ink-v2-direction-d/WALK.md`. Run `node scripts/ui-shots/walk.mjs` again after any change to a place.
- **Other businesses are locked rows.** Each business is its own encrypted vault and the engine keeps one open, so Today shows other businesses as locked rows until a read-only vault open exists.
- **Auto with spot checks is not open.** The spot-check decision is now recorded when a run's write finishes at that posture, but the launch ladder keeps the stage planned, `venture.launch.advance` refuses it, the delivery runs allow only shadow and approve each, and every model turn on a real order still waits for the owner to approve its exact text. Opening it needs the ladder step, a stage the runs accept, and a decision on unattended turns for client data.
- **The hosted tick.** The hosted server sweeps the journal when a business opens, but does not run the engine's five-minute tick.
- **Share links on Rivet.** The Rivet adapter has no share path, so on Rivet the share page always says nothing is there. A client's answer is recorded under the owner's member, marked as coming from the share link.
- **Tax working.** For a CA firm in India the GST working runs on the firm's own issued invoices. Purchases are not in Chausar, so no input credit is counted; there is no TDS working without a payments register; income tax is not computed because Chausar does not hold the owner's whole income. Totals from the GST engine carry no receipt the UI can open; each invoice line carries its price receipt.
- **Posting.** API posting stays planned: no upload or posting client ships. YouTube's own page for `videos.insert` (updated 15 October 2026) no longer keeps uploads from unverified API projects private, so the requirement now reads as Google sign-in verification plus a YouTube upload client, which this build does not ship. Agent posts are not shadowed yet, because nothing proposes a post from an agent run.
- **Hindi** strings were drafted by machine and need a native reviewer. The Income-tax Act, 2025 section numbers need a CA's confirmation before the CA firm playbook cites them.
- **Regulated CA papers wait for wave 2 (Ink v2).** Since wave 1, a GST, TDS or ITR working must quote a figure from a calculator receipt, and nothing regulated can be accepted, shared, posted or sent until the CA signs that exact text (an edit needs its own sign-off). No agent tool calls the tax calculators until wave 2, so those offers stop at the check until then. The FY 2026-27 TDS and AY 2027-28 income-tax tables are new and unconfirmed: they work in rehearsal only until the CA confirms them, and the FY 2025-26 TDS table is now version 2 (the no-PAN rule is the higher of the rate and 20%), which the CA confirms again.
- **Spend is counted in US dollars.** Limits and caps are typed in dollars, the currency the AI providers bill. With a rupees-per-dollar rate set by the owner, spend also shows in rupees, labelled with that rate and its date.
- **The untrusted-content screen starts in observe mode.** It notes what it finds on outside content (kinds only, never the words) and the owner can switch a business to enforce, where flagged content waits on Today until released.

## Planned

A read-only open for other businesses on Today, the auto with spot checks stage, the hosted tick, share links on Rivet, API posting once a platform's app review is done and a client ships, a payments register for TDS, purchases for input credit, and a bank connector with a real provider (the read-only consent shape is built and planned).
