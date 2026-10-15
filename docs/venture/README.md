# Start a service business with Chausar

Chausar helps one person start a service business that AI agents help run: a bookkeeping studio, a content shop, a research desk, a support team for hire. The owner stays in charge and approves what matters. The full design is in [architecture.md](architecture.md).

Two rules hold everywhere:

- **The AI never does arithmetic.** Prices, tax, totals and costs come from code that writes a receipt. Model text with a new number in it is refused.
- **Never fake a capability.** Every connector and every place agent work runs is labelled `handoff`, `read`, `write` or `planned`, and the label matches what the code does today.

## The journey

1. **Idea.** One question: "What service business do you want to start?" Country comes from the browser.
2. **Plan.** A one-page plan appears at once from built-in templates. Nothing is saved yet. The owner sets a price and says whether they charge tax.
3. **Keep it.** A working name and a passphrase open an encrypted vault. The recovery code is shown once. Prices become receipts and the owner accepts the plan.
4. **Build.** Chausar writes a build brief, shows it, and opens it in Lovable or Replit from one click (Bolt and v0 get it copied). The owner presses send there. Then Chausar follows the repo on GitHub, read only.
5. **Connect.** Starter cards for the owner's country, with honest chips on all 64 connectors.
6. **Add your AI.** Optional. The owner's own Anthropic or OpenAI key, or a command-line tool on this computer. Templates work without any of them.
7. **Rehearse.** Agents practise on three made-up clients. Checks run first, then a judge model answers four questions.
8. **Launch.** Rehearsal, then shadow (practice drafts that can't reach a client), then approve each draft.
9. **Run.** An order comes in, an agent drafts a reply, the owner approves, then the invoice, the payment and the books, each number with a receipt.

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

Agents in this build only draft a reply from the client's message. Collecting files, doing the hands-on work and sending stay with the owner, marked `planned: agent`.

## Experimental storage

This build keeps each business in the engine's encrypted file vault, which the code calls an experimental demo. Every money screen says: practise here, don't issue real invoices yet. Real books need the PostgreSQL path, which is not wired for this flow. Records are kept for ten years, and the owner is told.

## What is not built

A public hosted web app; durable storage for real books; real outside writes such as payment links, email or posts; agents that read files, inboxes or the web; approving a sample of drafts or automatic sending with spot checks; Lovable and Replit MCP, a GitHub App, webhooks and Zoho sign-in; India e-invoicing; automatic polling; keys in the computer's keychain (keys live in memory and are typed again after a restart); the improvement loop; agentOS, containers and hosted sandboxes; several businesses in one vault. Section 8 of [architecture.md](architecture.md) says why for each.

## Demo script

Start the replay demo above and open the pairing link. Then:

1. Idea: "Monthly bookkeeping for cafes and small shops in Pune." Country: India. Show my plan.
2. Plan: Per month, 2499. Tax: Yes, 18. Keep this plan.
3. Keep it safe: name "Ledger Cafe Books", a passphrase of 12 or more characters. Keep the recovery code.
4. Your plan: GSTIN `27ZZZZZ9999Z1Z8`, SAC `998222`. Add your AI: the recommended Anthropic row with any key of 20 or more characters that starts `sk-ant-demo-` (the recording answers; nothing is sent). Rewrite with AI, then Accept plan.
5. Build: read the brief. On Connections, press Open on the Bolt card (it copies the brief, so no outside site opens). Back on Build, follow `demo-owner/ledger-cafe-books` with a key that starts `github_pat_demo` and has 20 or more characters, then Check GitHub now.
6. Agents: Rehearse, then Move to shadow.
7. Clients: add "Cafe Aroma Demo" (India, Maharashtra). New order for the first offer with the request "Please close my September books. The bank statement and bills are in the shared folder." Draft a reply, Approve and send, and see the practice draft. Move to approve each; draft again, approve, Accept.
8. Mark delivered; Prepare invoice; Issue; Record payment of 2948.82.
9. Money: open a receipt, then open the back office and find the same receipt there.

Every model and Build screen should say the answers come from a synthetic recording. Then run once more with no variables set, using built-in templates only: the plan, the brief, rehearsal (template, not judged), a template outline for an order, an invoice and a payment all work, and shadow stays blocked.

## How the desktop is checked

The Electron window is not launched in this run: `node_modules` stays absent, and the window needs the pinned Electron 44.4.5 from `npm install`. The desktop is checked another way. `node scripts/desktop-smoke.mjs` starts the real worker; a scratch script outside the repo starts `EngineHarness` on `platform/runtime/worker.ts` with `CHAUSAR_DEMO=1` and calls `venture.countries` and `venture.preview` through the forked worker; and the IPC contract, preload and main process are tested with mocks (`venture-shell.test.ts`). With `npm install` done, `npm run desktop` opens the window.

## Package pages

| Page | What it covers |
|---|---|
| [foundation.md](foundation.md) | Contracts, record helpers, method registration (P0) |
| [core.md](core.md) | Countries, the instant plan, interview, blueprint, terms, checklist, events (P1) |
| [models.md](models.md) | Presets, connections, the model port, routes, replay, cost (P2) |
| [money.md](money.md) | Price receipts, tax, clients, orders, invoices, payments, books (P3) |
| [build.md](build.md) | Brief, lint, handoff links, GitHub reader, connector catalogue (P4) |
| [delivery.md](delivery.md) | Playbook, draft replies, rehearsal, launch ladder, capabilities (P5) |
| [shell.md](shell.md) | The venture host, desktop types, shell and end-to-end tests (P6) |
| [launch.md](launch.md) | The launch screens in the renderer (P7) |
| [architecture.md](architecture.md) | The target architecture this build follows |
