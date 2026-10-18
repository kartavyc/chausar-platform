# Start a service business with Chausar

Chausar helps one person start a service business that AI agents help run: a bookkeeping studio, a content shop, a research desk, a support team for hire. The owner stays in charge and approves what matters. The full design is in [architecture.md](architecture.md).

Two rules hold everywhere:

- **The AI never does arithmetic.** Prices, tax, totals and costs come from code that writes a receipt. Model text with a new number in it is refused.
- **Never fake a capability.** Every connector and every place agent work runs is labelled `handoff`, `read`, `write` or `planned`, and the label matches what the code does today.

## The journey

Since 18 October onboarding connects an AI first and asks one open question ([onboarding.md](onboarding.md)). The screens are drawn in look B, "bold and graphic", and were walked in the browser on 18 October; the captures are in [`screens/onboarding-v2/`](screens/onboarding-v2/).

1. **Connect an AI.** The owner's own Anthropic or OpenAI key (one Anthropic key runs Claude Haiku 5.5 for quick work and Sonnet 5.5 for plans), or Claude Code or Codex on this computer. "Sign in with ChatGPT" is shown as not open to Chausar yet, with the reason. The AI is kept in the engine's memory only until the owner keeps the plan. "Continue without AI" leads to the built-in templates, and "Open my business" takes a returning owner to Welcome back, since every restart starts on this screen.
2. **What do you want to do?** One sentence: an idea, a skill or a problem. The quick model says which it is and picks two to four views from a fixed list. A sentence about a personal problem with nothing to sell gets "Chausar can't plan this one." and the built-in plan as a way on.
3. **Plan.** The plan model builds the plan from Chausar's checked blocks (offers, steps with who does each, website pages, tools, questions, things to check). Code checks every id and word: no digits, no numbers in words, no prices, no markup. A refused answer gets one repair, then a clear "There's no plan to show." Nothing is saved yet.
4. **Set your prices.** The owner types each price. Nothing is added up yet.
5. **Keep it.** Keep this plan makes the encrypted vault, named after the business, and this computer keeps its key for the owner's login: no passphrase and no folder to type (since the keychain change; a passphrase is asked only where the computer has no protected storage, and hosted keeps its own Keep it). The plan, the AI and "What was sent" move into the vault, prices become receipts and the owner accepts the plan. Next time the app opens, the business opens by itself; Trust & access holds the optional passphrase, the recovery code, the automatic backups and moving to another computer.
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

Start the replay demo above and open the pairing link. While other agents share the onboarding worktree, give it its own port and folder, so it never meets a server on 4317 or the repo's `data/` folder. In PowerShell:

```powershell
$env:CHAUSAR_PORT='4391'; $env:CHAUSAR_VAULT_DIRECTORY='.b2c-work/demo-data'; $env:CHAUSAR_VENTURE_REPLAY='1'; $env:CHAUSAR_VENTURE_MODEL_REPLAY='platform/tests/fixtures/venture/demo/model-replay.json'; $env:CHAUSAR_VENTURE_GITHUB_REPLAY='platform/tests/fixtures/venture/e2e/github-sync.json'; npm start
```

In sh, put `CHAUSAR_PORT=4391 CHAUSAR_VAULT_DIRECTORY=.b2c-work/demo-data` in front of the replay command above. `.b2c-work/` is a local working folder outside the repository; the demo makes its vault there.

Then:

1. Connect an AI: Paste an API key, Anthropic, any key of 20 or more characters that starts `sk-ant-demo-` (the recording answers; nothing is sent). Tick I agree for each consent text, then Connect.
2. What do you want to do: "Monthly bookkeeping for cafes and small shops in Pune." Country: India (Based in, Change). The demo also answers the three Examples (dog walking for nurses, the Excel skill, cafe bills), "My landlord won't fix the heating." (not a service) and "Bike repairs at home for families in Bristol.", whose two plan answers both use a block Chausar doesn't have, so the screen says "There's no plan to show." Any other sentence has no recording and says so.
3. Your plan: Ledger Cafe Books, drafted from a synthetic recording. Set your prices: Monthly books 2499 per month. Open "Tax: not registered", answer Yes and type 18. Keep this plan.
4. Nothing to type: the vault is made with the plan's name, and this computer keeps the key. (Where the engine has no protected storage, it asks for a passphrase of 12 or more characters and shows the recovery code once.)
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

The engine package (commits `bec1bd8`, `9622d60`, `d926ccb`, and the review fixes in `901be97`) added the draft desk, the composer, the block library and the view registry. The renderer package (`f0e3da4`, `2788ebc`) drew every onboarding screen in look B. The end-to-end package (`31459d2`, `9c14254`, `e72664c`) added the recordings, the end-to-end test, the demo answers and these docs. The integration pass below joined them.

How it was checked, on Windows with Node 24.13.1:

- `node --test platform/tests/venture-onboarding-e2e.test.ts`: 10 of 10. The new journey on recordings, from Connect to an issued invoice, with GitHub followed from the existing recording and the number guard run on the invoice's money lines; the reason each refused answer was refused; and a judged rehearsal of a composed plan (see [onboarding.md](onboarding.md#how-it-is-tested)).
- `venture-e2e.test.ts` (2 of 2, now also checking that "Connect your AI" is the first checklist item) and `venture-docs.test.ts`, plus the engine package's `venture-compose.test.ts` and `venture-draft.test.ts`.
- `node scripts/check.mjs` and a scoped typecheck with `typescript@5.9.3` over the three test files this package owns.
- The replay demo in local web mode on port 4391 with its own vault folder, driven through `/api/rpc` in the order the new screens call it: the four Connect rows (API key unverified, Claude Code and Codex needing setup, ChatGPT not open), the recommended pair before any vault, the three Examples (an idea with `offers-first`, a skill with `steps-first`, a problem with `audience-first`), the landlord sentence refused as not a service, an unrecorded sentence refused with `FIXTURE_MISSING`, the demo idea's plan, INR 2,499.00 typed and GST at 18, no key in any draft call, Keep it safe, the plan and AI adopted ("Connect your AI" done), the receipt INR 2,948.82, GSTIN and SAC, a rewrite that kept the blocks and pages, Accept, a brief that passed its checks with the client-area lines kept (the demo plan has a client uploads page), the playbook's work step "Match every entry", three judged rehearsals passed, shadow, a practice draft with every check passed, `INV-0001` as a TAX INVOICE for 294882 paise, and the payment of 2948.82 (balance 0).

What this pass changed in the demo replay: the composer answers above; the template plan rewrite now matches only a template plan's request, and the composed one only a composed plan's, so neither answers the other; and the bookkeeping agent turns from the end-to-end recording, without which rehearsal of the reconciling agent stopped with `FIXTURE_MISSING` in the demo (that gap predates onboarding v2).

## Onboarding v2 integration, 18 October

The three packages were joined in one worktree on branch `b2c/onboarding-v2`, their hand-off notes applied, the new screens walked in the browser against the real engine, and what the walk found fixed.

What changed in this pass:

- **The quick tier.** The engine reads the sentence on the quick tier, so Connect now moves on only when both the quick and the plan tier can serve. Before, a connection for plans alone would have shown the open box and then refused every sentence.
- **A way back in from the first screen.** Every restart starts on Connect, because the engine opens locked and can't list vaults. Connect now has "Open my business" beside "Continue without AI", which goes to Welcome back. It rests at 45 words, inside its budget.
- **VAT read "vat".** A stray control character in `launch.js` had turned a pattern's word boundary into a backspace, so every tax name was lower cased inside a sentence. Fixed, and a test now checks the renderer files for control characters. The same fault is on `main`.
- **The ChatGPT row's words** follow OpenAI's own wording, checked again on 18 October: "OpenAI lets only open-source tools, personal projects that run locally and apps it picks use a ChatGPT plan. Chausar is a commercial app and hasn't been picked yet. Use an OpenAI key for now." Before, it said "personal hobby projects", which isn't OpenAI's phrase.
- **The brief lint** takes a `clientArea` option, so a composed plan with no client area doesn't need the row security and sign-in lines; before, the build package filtered those two findings after the fact.
- **The demo** has one sentence whose plan is refused twice, so the refused screen can be seen offline. The end-to-end test checks it.
- **Look B fixes from the walk:** each Connect row shows a chevron, so it reads as something that opens; the currency code sits beside its price field and every row lines up; Accept and Build use the same title, eyebrow and fold style as the other onboarding screens; the storage line on Keep it safe has room before the button; Accept has top room at phone width.

How it was checked, on Windows with Node 24.13.1:

- `node scripts/check.mjs` (524 files) and a full typecheck with `typescript@5.9.3` against the repo `tsconfig.json` (654 files), unfiltered: both clean.
- Every `venture-*`, `hosted-*`, `desktop-*` and `server` test, and the renderer tests (`venture-launch-renderer`, `venture-onboarding-renderer`, `desktop-renderer`, `decision-journal-renderer`, `conversation-*-renderer`, `definition-disclosure-renderer`, `workspace-backup-renderer`, `phone-web-preview`, `conversation-acceptance`): 567 of 567 across 44 files. The end-to-end test `venture-onboarding-e2e` passes 10 of 10.
- The local web demo on port 4391 with the replay switch and its own vault folder, walked in headless Edge over the DevTools protocol by clicking and typing in the real page: pair, Connect, the API key row, the recommended pair, the open box, Working (held while the plan was written, to capture it), the three Examples as an idea, a skill and a problem, the landlord sentence, the refused sentence, the demo idea, Set your prices with GST at 18, Keep it safe, the recovery code, Setting up, Accept, Build and Today; then a restart, "Open my business" and Welcome back; then a fresh engine with Continue without AI and the built-in plan. Each of the fifteen screens was captured in light and dark at 1366 px and at 375 px. Nothing scrolls sideways at either width.
- One serial full run, `node --test --test-concurrency=1 platform/tests/*.test.ts`, with nothing else running: 2,933 tests, 2,932 pass, 0 fail, 1 skipped (the DuckDB proof that needs the native module, skipped before this work too), in about 26 minutes. A small spacing change on Keep it safe came after it; the renderer, docs and desktop renderer tests, the check and the typecheck were run again after that change and pass.

Words at rest, counted the way the renderer test counts them (header, both halves and closed folds' summaries; the recovery code and the storage line not counted):

| Screen | Budget | Longest answers (renderer test) | Demo walk |
| --- | --- | --- | --- |
| Pair | 35 | 30 | 30 |
| Connect | 45 | 45 | 45 |
| Open box | 45 | 37 | 36 |
| Working | 45 | 37 | 30 |
| Plan | 45 | 43 | 26 (idea), 37 (skill), 35 (problem) |
| Set your prices | 45 | 44 | 33 |
| Not a service | 35 | 31 | 31 |
| Refused | 40 | 39 | 39 |
| Keep it safe | 45 | 40 | 39 |
| Recovery code | 45 | 41 | 41 |
| Setting up | 25 | 14 | 19 |
| Accept | 45 | 45 | 32 |
| Build | 45 | 44 | 39 |
| Welcome back | 40 | 32 | 32 |
| Built-in plan | 45 | 33 | 33 |

No screen needed the F10 exception: Accept fits 45 by showing the version and the Offers heading only on the Your business place.

Known limits:

- The walk was done in headless Edge, not in the Electron window or the app's own browser pane; the desktop window still needs `npm install`.
- At the time of this walk the engine couldn't say whether a vault existed before one was opened, so a returning owner saw Connect first and typed a folder name on Welcome back. The keychain change replaced both: `workspace.list` lists this computer's businesses (see below).

## Keychain custody: the renderer (19 October)

The founder's decisions of 18 October, built on the screens: no Keep it safe step (the vault is made, named from the business, when the owner keeps the plan); Welcome back lists this computer's businesses, and one that opens with this computer opens by itself; Trust & access has "Lock with a passphrase", the recovery code, automatic encrypted backups with restore, and moving to another computer with a file and a one-time code; and the live preview on the right shows the business coming together in real words, like prototype B. The screens are in [onboarding.md](onboarding.md#keeping-the-plan-welcome-back-and-the-live-preview-keychain-custody-18-october); the engine is in [docs/custody.md](../custody.md).

What was run: the renderer tests (`venture-onboarding-renderer`, `venture-launch-renderer`, the new `custody-renderer`), the desktop, backup, shell and docs renderer tests, `node scripts/check.mjs`, and screenshots of nineteen screens from the renderer fixtures in headless Edge over the DevTools protocol, light and dark at 1366 px and 375 px, with nothing scrolling sideways at 375 px: [`screens/60-idea-typed`](screens/60-idea-typed-light.png) to [`screens/78-hosted-prices`](screens/78-hosted-prices-light.png). Not run here: a walk against the real engine with this computer's DPAPI (that is the integration pass), and any Mac or Linux keychain.

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
