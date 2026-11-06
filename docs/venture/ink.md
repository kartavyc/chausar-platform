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

## Known limits

- **The walk.** Ink was checked with its own tests (vitest and jsdom) and the engine tests. The full walk in light and dark at 1280 and 390 px and the axe checks on every place are still to do.
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
