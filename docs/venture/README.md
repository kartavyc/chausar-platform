# Start a service business with Chausar

Chausar helps one person start a service business that AI agents help run: a bookkeeping studio, a content shop, a research desk, a support team for hire. The owner stays in charge and approves what matters. The full design is in [architecture.md](architecture.md).

Two rules hold everywhere:

- **The AI never does arithmetic.** Prices, tax, totals and costs come from code that writes a receipt. Model text with a new number in it is refused.
- **Never fake a capability.** Every connector and every place agent work runs is labelled `handoff`, `read`, `write` or `planned`, and the label matches what the code does today.

## The journey

Since 18 October onboarding connects an AI first and asks one open question ([onboarding.md](onboarding.md)).

1. **Connect an AI.** The owner's own Anthropic or OpenAI key (one Anthropic key runs Claude Haiku 5.5 for quick work and Sonnet 5.5 for plans), or Claude Code or Codex on this computer. "Sign in with ChatGPT" is shown as not open to Chausar yet, with the reason. The AI is kept in the engine's memory only until the owner keeps the plan. "Continue without AI" leads to the built-in templates.
2. **What do you want to do?** One sentence: an idea, a skill or a problem. The quick model says which it is and picks two to four views from a fixed list.
3. **Plan.** The plan model builds the plan from Chausar's checked blocks (offers, steps with who does each, website pages, tools, questions, things to check). Code checks every id and word: no digits, no numbers in words, no prices, no markup. A refused answer gets one repair, then a clear "There's no plan to show." Nothing is saved yet.
4. **Set your prices.** The owner types each price. Nothing is added up yet.
5. **Keep it.** A working name and a passphrase open an encrypted vault. The recovery code is shown once. The plan, the AI and "What was sent" move into the vault, prices become receipts and the owner accepts the plan.
6. **Build.** Chausar writes a build brief from the plan's own pages, shows it, and opens it in Lovable or Replit from one click (Bolt and v0 get it copied). The owner presses send there. Then Chausar follows the repo on GitHub, read only.
7. **Connect.** Starter cards for the owner's country and the plan's tools, with honest chips on all 64 connectors.
8. **Rehearse.** Agents practise on three made-up clients. Checks run first, then a judge model answers four questions.
9. **Launch.** Rehearsal, then shadow (practice drafts that can't reach a client), then approve each draft.
10. **Run.** An order comes in, an agent drafts a reply, the owner approves, then the invoice, the payment and the books, each number with a receipt.

The hosted web tier keeps the earlier order for now: idea, template plan, keep it, then Add your AI inside the vault.

## Run it

Local web mode (the engine runs on this computer and the browser opens the printed pairing link):

```sh
npm start
```

The desktop window, once the pinned Electron is installed:

```sh
npm install
npm run desktop
```

The hosted web tier, experimental and not deployed: sign in with an email link or a passkey, and the server keeps each business in its own encrypted vault. It starts only with `--hosted` or `CHAUSAR_HOSTED=1`. [hosted.md](hosted.md) says how it works and what a real deploy still needs:

```sh
npm run start:hosted
```

The offline demo answers every model and GitHub call from hand-written recordings. It needs demo mode and its own switch, `CHAUSAR_VENTURE_REPLAY=1`, so a leftover variable can never stand in for a real provider:

```sh
CHAUSAR_VENTURE_REPLAY=1 CHAUSAR_VENTURE_MODEL_REPLAY=platform/tests/fixtures/venture/demo/model-replay.json CHAUSAR_VENTURE_GITHUB_REPLAY=platform/tests/fixtures/venture/e2e/github-sync.json npm start
```

In PowerShell:

```powershell
$env:CHAUSAR_VENTURE_REPLAY='1'; $env:CHAUSAR_VENTURE_MODEL_REPLAY='platform/tests/fixtures/venture/demo/model-replay.json'; $env:CHAUSAR_VENTURE_GITHUB_REPLAY='platform/tests/fixtures/venture/e2e/github-sync.json'; npm start
```

## Honest labels

| Label | What it means today |
|---|---|
| `handoff` | Chausar prepares something and you finish it in the other product: the brief in a Lovable or Replit link, the brief copied for Bolt or v0, a drafted reply or invoice for your own mail app. |
| `read` | Chausar reads it and never writes: GitHub (one repo, a fine-grained token kept in memory), TallyPrime running on this computer, and the built-in CRM and books. |
| `write` | Only the built-in CRM and books. |
| `planned` | Not in this build. A "Visit site" link opens the vendor's page and is not counted as a mode. |
| Template outline | Text from built-in templates when no AI is connected. It says no AI wrote it and that it didn't read the client's request. |
| Synthetic recording | A hand-written answer shaped like a real one. Every model and Build screen says so when one is in use. |
| Practice draft | A draft made at the shadow stage. It can't be copied, saved or accepted. |

Agents work on the files the owner adds to an order with tools in a bounded loop, and each turn on a real order waits for the owner's approval of its exact text. For bookkeeping they reconcile a month from a bank statement and bills, with receipts; other service types get replies. Agent-written code runs in the light sandbox (WebAssembly, on every computer) or in Docker where it is set up. On the hosted server agents read CSV and XLSX files only and run no code they write ([hosted.md](hosted.md#delivery-agents-on-the-hosted-server)). A draft may say work was done only when a tool run proved it. Collecting files from clients and sending stay with the owner. See [harness.md](harness.md).

## Experimental storage

This build keeps each business in the engine's encrypted file vault, which the code calls an experimental demo. Every money screen says: practise here, don't issue real invoices yet. Real books need the PostgreSQL path. The hosted server can now keep businesses in PostgreSQL ([hosted.md](hosted.md#postgresql-storage)), but that path is experimental too, so its screens keep the same notice. Records are kept for ten years, and the owner is told.

## What is not built

A deployed public web app (the hosted tier is written and tested on one computer, see [hosted.md](hosted.md)); durable storage for real books on the desktop; real outside writes such as payment links, email or posts; agents that read inboxes or the web (agents read the files the owner adds to an order, see [harness.md](harness.md)); work products for service types other than bookkeeping; approving a sample of drafts or automatic sending with spot checks; Lovable and Replit MCP, a GitHub App, webhooks and Zoho sign-in; India e-invoicing; automatic polling; keys in the computer's keychain (keys live in memory and are typed again after a restart); agentOS and hosted sandboxes, and containers tried against a real Docker; agent-written code and PDF reading on the hosted server, which stay off there until the founder decides; several businesses in one vault. Section 8 of [architecture.md](architecture.md) says why for most of them; [harness.md](harness.md) covers the delivery harness.

## Demo script

Start the replay demo above and open the pairing link. While other agents share the onboarding worktree, give it its own port and folder, so it never meets a server on 4317 or the repo's `data/` folder: add `CHAUSAR_PORT=4391 CHAUSAR_VAULT_DIRECTORY=.b2c-work/demo-data` to the command. Then:

1. Connect an AI: Paste an API key, Anthropic, any key of 20 or more characters that starts `sk-ant-demo-` (the recording answers; nothing is sent). Tick I agree for each consent text, then Connect.
2. What do you want to do: "Monthly bookkeeping for cafes and small shops in Pune." Country: India. The demo also answers the three Examples (dog walking for nurses, the Excel skill, cafe bills) and "My landlord won't fix the heating." (not a service). Any other sentence has no recording and says so.
3. Your plan: Ledger Cafe Books, written from a synthetic recording. Set your prices: Monthly books 2499 per month. Tax: yes, 18. Keep this plan.
4. Keep it safe: name "Ledger Cafe Books", a passphrase of 12 or more characters. Save the recovery code.
5. Your plan in the vault: GSTIN `27ZZZZZ9999Z1Z8`, SAC `998222`. Rewrite with AI (the words change, the blocks stay), then Accept plan.
6. Build: read the brief. On Connections, press Open on the Bolt card (it copies the brief, so no outside site opens). Back on Build, follow `demo-owner/ledger-cafe-books` with a key that starts `github_pat_demo` and has 20 or more characters, then Check GitHub now.
7. Agents: Rehearse, then Move to shadow.
8. Clients: add "Cafe Aroma Demo" (India, Maharashtra). New order for the first offer with the request "Please close my September books. The bank statement and bills are in the shared folder." Draft a reply, Approve and send, and see the practice draft. Move to approve each; draft again, approve, Accept.
9. Mark delivered; Prepare invoice; Issue; Record payment of 2948.82.
10. Money: open a receipt, then open the back office and find the same receipt there.

Every model and Build screen should say the answers come from a synthetic recording. Then run once more with no variables set and choose Continue without AI: the built-in plan, the brief, rehearsal (template, not judged), a template outline for an order, an invoice and a payment all work, and shadow stays blocked. To see the Claude Code row connect, add `CHAUSAR_CLAUDE_CODE_TERMS=accepted`; the demo has Claude Code answers for decide and compose only.

## How the desktop is checked

The Electron window is not launched in this run: `node_modules` stays absent, and the window needs the pinned Electron 44.4.5 from `npm install`. The desktop is checked another way. `node scripts/desktop-smoke.mjs` starts the real worker; a scratch script outside the repo starts `EngineHarness` on `platform/runtime/worker.ts` with `CHAUSAR_DEMO=1` and calls `venture.countries` and `venture.preview` through the forked worker; and the IPC contract, preload and main process are tested with mocks (`venture-shell.test.ts`). With `npm install` done, `npm run desktop` opens the window.

## Integration (Phase C)

Phase C joined the seven packages in one checkout and applied their hand-off notes:

- `contracts.ts`: model connection and model call records carry the route as `routeKind`, because `kind` is the record kind. Before this, TypeScript reduced both record types to `never`. The models package, the engine and end-to-end tests and the renderer fixture now use the contract types.
- `main.cjs`: the app window on the trusted document may write text to the clipboard (`clipboard-sanitized-write`), so Copy brief, Copy invoice and the Bolt and v0 handoffs can copy on the desktop. Every other permission is still refused. This is tested with mocks, not yet in a real Electron window.
- The draft reply sheet offers Accept only when every check passed, because the engine refuses Accept after a failed check.
- The plan's back office line says "Clients pay through Stripe links on your site, and you record each payment here." instead of "Payments by Stripe.", since Chausar takes no payments itself. Tax names read in plain case inside a sentence ("sales tax", but "GST").

How it was checked, on Windows with Node 24.13.1:

- `node scripts/check.mjs` and a full typecheck with `typescript@5.9.3` against the repo `tsconfig.json`, unfiltered: both clean. `node --check` does not catch every syntax error in an ES module `.ts` file, so the typecheck is the one to trust.
- Every `venture-*.test.ts` file, the parity, shell and renderer tests, and the end-to-end test: all pass.
- One serial full run, `node --test --test-concurrency=1 platform/tests/*.test.ts`, with nothing else running: 2,718 tests, 2,717 pass, 0 fail, 1 skipped (a DuckDB proof that needs the native module, skipped before this work too), in about 23 minutes.
- `node scripts/desktop-smoke.mjs`, and `EngineHarness` on the forked worker answering `venture.countries` (15 rows) and `venture.preview` (bookkeeping) before any vault.
- The replay demo above, driven through the local server's `/api/rpc` in the order the screens call it: plan, recording-backed rewrite, brief, Bolt copy, GitHub check, three judged rehearsals, a practice draft that can't be accepted, an accepted draft, `INV-0001` as a TAX INVOICE with CGST and SGST, the payment of 2948.82, the books (billed 249900, received 294882, earned 249900 paise) and the same billed total in the back office; checklist 12 of 12. Each of the seven places then opened in the browser; Your business, Build and Agents say the AI answers come from a synthetic recording.
- The template walk with no variables, clicked through in the browser: plan, keep it safe, accept, the template brief, rehearsal (template outline, not judged), shadow blocked with its reason, a template outline accepted for a 2 hour order (USD 300.00), invoice `INV-0001`, payment, and Money showing USD 300.00. The send setting stayed `nothing` and no model call was made.

The two limits this walk found are fixed in the second pass below: Money now has a period choice that reaches back-dated entries, and every date on screen is the owner's day.

## Second pass, 16 October

The engine now marks what waits for the owner on each draft (`awaitingYou`, `canApprove`, `canAccept`, `acceptBlocked`), words template offers for how the owner charges, says "Not yet checked with a live key." beside a ready Haiku or Sonnet, and keeps every day on the owner's calendar. The screens read those fields by the names the engine sends; no name differed between the two sides.

How it was checked:

- `node scripts/check.mjs` and the full typecheck with `typescript@5.9.3` against the repo `tsconfig.json` (426 files), unfiltered: both clean.
- Every `venture-*.test.ts` file: 201 of 201, the end-to-end test included. The parity, shell and renderer tests from spec 11.5, run one after another: 145 of 145.
- One serial full run at commit `438e6e2`, `node --test --test-concurrency=1 platform/tests/*.test.ts`, with nothing else running: 2,727 tests, 2,726 pass, 0 fail, 1 skipped (the same DuckDB proof as before), in about 23 minutes. None of the timing-heavy vault tests that failed under load in the baseline failed here.
- The replay demo in local web mode. The steps that take a passphrase or a key (keeping the vault, adding the AI, following GitHub) and the steps that send (approving drafts, issuing the invoice, recording the payment) went through the local server's `/api/rpc`, in the order the screens call them. Every place was then opened in the browser, in light and dark, at 1280 px and at 375 px. Nothing overflowed at 375 px.
- What the walk saw: the plan rewords its offers when the owner picks how they charge ("Bookkeeping hours" per hour, "Monthly books" per month). At shadow, Today lists the practice draft and its sheet has no Accept. Once the stage is approve each, Today drops it and a new draft can be accepted. "Practise this" on a rejected draft added a rehearsal case. Money switches between This month, Last month, This year, All time and the owner's own dates.
- The walk ran at 04:25 in India on 16 October, while it was still 15 October in UTC. Today said "Friday 16 October", the invoice was issued on 2026-10-16 and is due on 2026-10-31, and the books named `Asia/Kolkata`. The template walk, in the United States, said "Thursday 15 October" and named `America/New_York`.
- The template walk with no variables: the plan, the template brief, rehearsal (template outlines, not judged), shadow blocked with its reason, a template outline accepted, `INV-0001` for USD 300.00 and its payment. No model call was made and the send setting stayed `nothing`.

Words at rest per place, counted the way the renderer test counts them:

| Place | Replay demo | Template walk |
|---|---|---|
| Today | 31 | 34 |
| Your business | 60 | 54 |
| Build | 57 | 88 |
| Clients | 27 | 18 |
| Agents | 45 | 45 |
| Money | 50 | 50 |
| Connections | 36 | 36 |

The screenshots in [`screens/`](screens/) were saved again from this walk: 02, 03, 04, 07, 10 to 16, 19, 21, 22, 24 and 25 to 29. The others show the first pass. 05, 06, 08 and 09 come right after the passphrase in onboarding, which this walk did through `/api/rpc`; 01, 17, 18, 20 and 23 look the same as before.

Known limits:

- Today and Money open on this month. An invoice or payment dated in an earlier month shows when the owner picks Last month, This year, All time or their own dates on Money. A books request without a period gets All time, which starts at the earliest dated entry.
- Each country has one time zone for its days: the most populous one where a country has several (New York for the United States, Toronto for Canada, Sydney for Australia). There is no time zone setting per owner. Until a page has read the books once, a date field starts at this computer's own day.
- Build rests at 88 words before a repo is followed, because the follow form and its two key notes are open. That is above the 60 word ceiling; the words test checks Build with a repo already followed.
- With model-written words, Your business rests at 60, right at the ceiling.
- "Practise this" looks for the review among the newest 500 events. An older review needs the engine to name its signal on the draft.
- There is no separate fixed price model; "Per project" covers fixed price work.

## Onboarding v2, 18 October

The engine package (commits `bec1bd8`, `9622d60`, `d926ccb`) added the draft desk, the composer, the block library and the view registry. This package added the recordings, the end-to-end test, the demo answers and these docs. The renderer package's screens had not landed when this was written.

How it was checked, on Windows with Node 24.13.1:

- `node --test platform/tests/venture-onboarding-e2e.test.ts`: 9 of 9. The new journey on recordings, from Connect to an issued invoice (see [onboarding.md](onboarding.md#how-it-is-tested)).
- `venture-e2e.test.ts` (2 of 2, now also checking that "Connect your AI" is the first checklist item) and `venture-docs.test.ts`, plus the engine package's `venture-compose.test.ts` and `venture-draft.test.ts`.
- `node scripts/check.mjs` and a scoped typecheck with `typescript@5.9.3` over the three test files this package owns.
- The replay demo in local web mode on port 4391 with its own vault folder, driven through `/api/rpc` in the order the new screens call it: the four Connect rows (API key unverified, Claude Code and Codex needing setup, ChatGPT not open), the recommended pair before any vault, the three Examples (an idea with `offers-first`, a skill with `steps-first`, a problem with `audience-first`), the landlord sentence refused as not a service, an unrecorded sentence refused with `FIXTURE_MISSING`, the demo idea's plan, INR 2,499.00 typed and GST at 18, no key in any draft call, Keep it safe, the plan and AI adopted ("Connect your AI" done), the receipt INR 2,948.82, GSTIN and SAC, a rewrite that kept the blocks and pages, Accept, a brief that passed its checks with the client-area lines kept (the demo plan has a client uploads page), the playbook's work step "Match every entry", three judged rehearsals passed, shadow, a practice draft with every check passed, `INV-0001` as a TAX INVOICE for 294882 paise, and the payment of 2948.82 (balance 0). The browser screens wait for the renderer package.

What this pass changed in the demo replay: the composer answers above; the template plan rewrite now matches only a template plan's request, and the composed one only a composed plan's, so neither answers the other; and the bookkeeping agent turns from the end-to-end recording, without which rehearsal of the reconciling agent stopped with `FIXTURE_MISSING` in the demo (that gap predates onboarding v2).

## Package pages

| Page | What it covers |
|---|---|
| [foundation.md](foundation.md) | Contracts, record helpers, method registration (P0) |
| [core.md](core.md) | Countries, the instant plan, interview, blueprint, terms, checklist, events (P1) |
| [models.md](models.md) | Presets, connections, the model port, routes, replay, cost (P2) |
| [money.md](money.md) | Price receipts, tax, clients, orders, invoices, payments, books (P3) |
| [build.md](build.md) | Brief, lint, handoff links, GitHub reader, connector catalogue (P4) |
| [delivery.md](delivery.md) | Playbook, draft replies, rehearsal, launch ladder, capabilities (P5) |
| [harness.md](harness.md) | The delivery harness: tools, client files, work receipts, the sandbox tiers and the improvement loop |
| [shell.md](shell.md) | The venture host, desktop types, shell and end-to-end tests (P6) |
| [onboarding.md](onboarding.md) | Onboarding v2: connect an AI first, the open box, the block library, the view registry, the composer and its number guard, the draft desk |
| [launch.md](launch.md) | The launch screens in the renderer (P7), and the onboarding v2 screens |
| [hosted.md](hosted.md) | The experimental hosted web tier: sign-in, custody, tenancy, one actor per business, limits, and what a deploy needs |
| [architecture.md](architecture.md) | The target architecture this build follows |
