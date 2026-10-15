# Chausar B2C: target architecture

Written 15 October 2026 for the founder and revised after review. It replaces the SMB books-companion architecture (`D:\claude\chausar-2\CHAUSAR-ARCHITECTURE.md`) for this iteration; the books engine described there stays, as the back office. Nothing here claims a part exists today. `BUILD-SPEC.md` says exactly what this run builds.

## 1. The idea in one minute

Chausar helps a person start a service business that AI agents help run: a bookkeeping studio, a content shop, a research desk, a support team for hire. The person stays the owner and approves what matters.

They type one sentence and see a plan at once, then set a price and say whether they charge tax, right on the plan. Keeping it locks it in an encrypted vault and turns every price into a receipt. Chausar writes the build brief for the website and client portal, opens it in Lovable or Replit with one click, and follows the code through GitHub, read only. Delivery agents practise on made-up clients first. When the first order comes in, the books engine issues the invoice and records the payment, and every number has a receipt.

Two rules bind everything:

- **The AI never does arithmetic.** Prices, tax, totals and costs come from deterministic code that writes a receipt. Model text with a number in it is refused, unless it's a word like "B2B" copied from the owner's own words.
- **Never fake a capability.** Every connector and every place agent work can run is labelled `handoff`, `read`, `write` or `planned`, and the label matches what the code does today. Agents in this build only draft from the client's message, so they never say they read, matched or sent anything.

## 2. The user's journey

```
 1 Idea         "What service business do you want to start?"  one box; country filled in from the browser
 2 Plan         a plan at once, from built-in templates; nothing is saved yet
                set your price and tax on the plan; "Tell us more" is optional
 3 Keep it      working name and passphrase -> encrypted vault, recovery code shown once
                prices become receipts; you accept the plan
 4 Build        read the brief -> "Open in Lovable" / "Open in Replit" (you press send there)
                -> paste your repo -> Chausar reads GitHub and says only what it can see
 5 Connect      starter cards for your country; honest chips on all 64
 6 Add your AI  optional: your own key or CLI; templates work without one
 7 Rehearse     agents practise on three made-up clients; checks first, then a judge
 8 Launch       rehearsal -> shadow (practice drafts) -> approve each draft
 9 Run          order -> draft reply -> you approve -> invoice -> payment -> books with receipts
```

The first useful output comes after one sentence. The passphrase comes only when the owner keeps the plan; it moves to the computer's keychain later.

## 3. The pieces

### Piece 1. The venture desk: one durable actor per business

**What.** Each business is one record in the encrypted vault, changed only by named actions, with a short event log the screens read.

**How.** Every write goes through one helper: check permission, run the action on a draft, append declared events (`blueprint-accepted`, `invoice-issued`), commit once. A failed action changes nothing. Backup, export and delete already cover these records.

**Reference.** Rivet Actors gave the shape: one actor per key, actions in, events out, with Rivet's names so a hosted adapter can map onto real Rivet Actors later. Rivet isn't a dependency: its engine keeps state outside our encrypted vault and saves on a timer, not per action.

### Piece 2. The plan (blueprint)

**What.** A one-page plan: two offers, four delivery steps, two approvals, back office settings.

**How.** Code builds the structure from a template for the service type, before anything is saved. The model, once connected, only writes words into named slots, and a structure hash proves nothing moved while it wrote. The owner types the price; the calculator turns it into a receipt. Each step says who does it today. In this build an agent can only draft a reply from the client's message, so "collect the files" and "sort the entries" are yours, marked `planned: agent`.

**Reference.** helix-foundry: code computes structure, the model writes descriptions, a proposal is validated and accepted by digest. snapshift: decide first, then fill a fixed schema. SubQ Snap: decisions as typed questions instead of free text.

### Piece 3. What your business knows

**What.** Business terms (client, order, deliverable, invoice, payment) that start `proposed` and turn `active` only when evidence arrives, such as the first issued invoice. Calling a new business's words "known" on day one would be faking.

**Reference.** EvoOntology: nothing is active without a probe backing it, and agents should query meanings through tools rather than a pasted glossary (the tools are planned).

### Piece 4. Model connections

**What.** Bring your own key or your own command-line tool, with cheap models by default. Without either, built-in templates do the work and say so.

**How.** One standing consent per connection covers non-client words: the idea, answers, plan words and made-up rehearsal clients. Code also checks each payload for client names, emails and order text. Client data shows its exact payload first, needs a click, and sends once. The workspace privacy setting rules every send: connecting moves it from "send nothing" to "send question shapes", and setting it back stops venture calls too. Every call is recorded with the exact text sent and a cost worked out by code. Keys stay in memory. Tests use synthetic recordings only.

**Reference.** xiryn: secrets never reach the model, and a hand-off ends the agent's turn. AgentRun and xiryn: a usage ledger per call that becomes a cost per delivery.

### Piece 5. The build handoff

**What.** A build brief of at most 9,000 characters, shown on screen first, then a Lovable link, a Replit link, or copy and paste for Bolt and v0.

**How.** Fixed sections, prices copied exactly from receipts, country notes, data rules (row level security on every table), and a "Chausar contract" block for `AGENTS.md` or `replit.md` carrying a brief id. A deterministic lint blocks the button when a section or required line is missing, a price doesn't match a receipt, or the text has an em dash or contact details. Lovable keeps the brief in the browser until the person presses send; Replit receives it as soon as its page opens, and the screen says so. A handoff counts as opened only after the browser opened it. Chausar never automates either site.

**Reference.** The R5 research on both products' documented links. lintapple: the brief adds `lintapple@0.1.20` (pinned), a `ui-policy.json` and a read-only GitHub workflow, so the client app is checked against the same design rules.

### Piece 6. Following the build on GitHub

**What.** Read-only status words from the synced repo: last change and whose account made it, brief marker found, sync conflict, the UI lint run passed or failed, a deployment address only when a host recorded one.

**How.** At most nine read calls per sync, every path part encoded, each response digested and kept as a receipt. Only fine-grained, single-repo tokens are accepted, and they stay in memory. It never says "built", "working" or "launched", and it lists what it can't see, including whether client data is locked down.

**Reference.** R5. The danieljvdm post: agents live in cheap durable actors and machines start only for checks. Acceptance checks on a synced commit are planned for the container tier.

### Piece 7. The connections catalogue

**What.** 64 connectors in 12 categories, each card showing chips such as `handoff`, `planned: handoff`, `planned: read`.

**How.** The catalogue is data. A `handoff` is available only where Chausar prepares something: Lovable and Replit (the brief in a link), Bolt and v0 (the brief to copy), and your mail app (a drafted reply or invoice to send yourself). Every other vendor shows `planned: handoff` and a plain "Visit site" link that isn't counted as a mode. `read` is available for GitHub, the existing Tally reader (TallyPrime must be running on this computer), and the built-in CRM and books. Zoho Books reading needs a sign-in path this build lacks, so it's planned. `write` is available only for the built-in CRM and books.

**Reference.** R6 for the list and region facts (Stripe is invite-only for new Indian businesses, so India defaults to Razorpay; WhatsApp limits AI-first chat services, and its card says so). agentOS: a versioned capability descriptor where each capability is available, planned or unavailable, with a plain reason.

### Piece 8. Delivery agents and their playbook

**What.** A playbook per business: typed steps (gather, question, compute, write, verify, approve, operator), versioned and hashed. Its output is a draft reply, never a finished deliverable.

**How.** Code steps do arithmetic and checks. Model steps write words or choose from closed lists. Numbers and dates appear only as references the engine fills in, shown with their label ("Total: INR 2,948.82"). The client's message is treated as information, never as instructions. A check refuses any sentence that claims finished work ("we matched", "your books are reconciled"), and the judge asks the same question. A playbook is validated before it runs, and every run records its hash.

**Reference.** AgentRun (Grep.ai): the model decides what a thing is, code decides what follows, with a verify pass and replay instead of rerun. Harness Learning: the harness is a versioned program improved by small patches. Factory Environments: only validated definitions run, and each run leaves the same record.

### Piece 9. Rehearsal and the launch ladder

**What.** Three made-up clients per service type (clean, messy, pushy), run before any real client. Then a ladder: rehearsal, shadow, approve each draft. Approving a sample and auto with spot checks are planned.

**How.** A simulated client writes the request, the agent drafts, and every outside effect is a record-only mock. Deterministic checks run first, then a cheap judge answers four typed questions. Shadow needs a passing, judged rehearsal with a real model; its drafts are practice only and can't be copied or accepted. Without a model, Chausar gives a template outline that says no AI wrote it. Owner rejections and edits become signals, and a signal can become a new rehearsal case.

**Reference.** DigitalOcean Signals and Simulations (the cneuralnetwork post): personas, expected outcomes, turn limits, mock tools, baseline against candidate. AgentRun and EvoOntology: a held-back set the author never sees before anything is promoted.

### Piece 10. Where agent work runs

| Tier | What | State in this build |
|---|---|---|
| Code | Calculator, receipts, checks | Available; runs inside Chausar, not a sandbox |
| Actor | Model calls and drafting inside the engine | Available; no tools and no agent-written code |
| WASM, light | The existing plugin sandbox | Available in the back office; agents don't use it yet |
| WASM, full | agentOS virtual machine | Unavailable on Windows; planned elsewhere |
| Container | Docker per agent, browser work, acceptance checks | Planned ("Needs Docker Desktop") |
| Hosted | E2B, Sail or Cloudflare under your own account | Planned ("Needs your account") |

**Reference.** agentOS (host functions as the only bridge to trusted code), the mlejva (E2B) post on why sandboxes alone aren't enough, the danlovesproofs post on pay-by-the-minute sandboxes, the danieljvdm post on Durable Objects, and Factory Environments. Drivers will use the person's own account and stay labelled until tested.

### Piece 11. The back office: money with receipts

**What.** The existing books engine becomes the back office of every business: clients, orders, invoices, payments, books.

**How.** A price receipt records the inputs, each BigInt step and the rounding rule. Invoices, payments and delivered work become facts, and the existing calculator produces billed, received and earned receipts that the old twelve views open too. Tax applies only after the owner says they charge it, at a rate they confirm. For India, GST splits into CGST and SGST or IGST by place of supply, exports are zero-rated only after the owner confirms an LUT, and the invoice prints GSTIN, SAC and place of supply. Other VAT and GST countries print the owner's registration number. Until those fields are filled, the document says "Invoice (not a tax invoice)".

This build runs on the engine's file storage, which the code calls an experimental demo, so every money screen says: practise here, don't issue real invoices yet. Records are kept for ten years, and the owner is told.

**Reference.** The current architecture's pieces 7, 8 and 10.

### Piece 12. The screens

**What.** A short launch flow and seven places: Today, Business, Build, Clients, Agents, Money, Connections. The old twelve views stay under "Back office".

**How.** Today leads with what needs the owner and the launch checklist ("7 of 12"). A screen holds about 40 reading words at rest. While a model writes, a still outline of the coming view and one line of words replace any spinner. The renderer never computes money.

**Reference.** The founder's 1 October frontend spec. Riley Brown's internal app post: make the required action obvious. Jakub Antalik's skeleton post: an outline in the exact shape of the view, without the animation. lintapple: words at rest, no looping motion and honest labels, checked in tests.

## 4. Web and desktop from one engine

One engine, one renderer, two ways in:

```
renderer (app.js + launch.js) --+-- desktop: Electron IPC, allow-listed methods --+
                                +-- web: loopback HTTP /api/rpc, pairing token ----+--> one Engine --> vault
```

In this run the web app is **local web mode**: the engine runs on the person's computer and their browser opens the printed pairing link. A public hosted web app needs sign-in, per-user vault custody, TLS and tenancy. That's a later tier, with Rivet Actors (one actor per business) as the candidate runtime. CLI model routes stay on the person's own computer; a hosted web app will use keys only. Long model work runs one rehearsal client per request, so the desktop's request timer never cuts it off.

## 5. Models

| Job | Default | State |
|---|---|---|
| Interview, simulated clients, judging | Claude Haiku 5.5 (`claude-haiku-5-5`) | Ready with your key |
| Plan words, build brief, draft replies | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | Ready with your key |
| Either job | GPT-6 Luna | Unverified: a past probe failed; you type the model id; costs are estimates |
| Everything, on your own plan | Claude Code CLI or Codex CLI | Checked on this computer before use; Codex needs its reviewed host profile |
| No AI yet | Built-in templates | Works offline; every line says it came from a template |

The Anthropic route asks for structured JSON at low effort and records refusals and cut-offs as errors. It never retries silently or switches models.

## 6. Connectors

| Category | Examples | Modes in this build |
|---|---|---|
| Build | Lovable, Replit, Bolt, v0, GitHub | handoff (brief link or copy); GitHub read |
| Site and domain | Vercel, Netlify, Cloudflare, Porkbun | planned: handoff |
| Payments | Razorpay, Cashfree, Stripe, PayPal, Paddle | planned: handoff, read, write |
| Email and inbox | Your own mail app, Google Workspace, Resend | Your own mail app: handoff (you send a draft); others planned |
| Booking and calendar | Cal.com, Calendly, Google Calendar | planned: handoff, read |
| Customers and CRM | Chausar CRM, HubSpot, Zoho CRM, Attio | Chausar CRM read and write; others planned |
| Messaging and support | WhatsApp, Telegram, Slack, Discord | planned: handoff, write |
| Docs and ops | Notion, Google Drive, Linear, Airtable | planned |
| Marketing and social | LinkedIn, X, Instagram, Buffer | planned |
| Books, tax and invoicing | Chausar back office, TallyPrime, Zoho Books, Xero | Chausar back office read and write; TallyPrime read; others planned |
| Legal and entity | Stripe Atlas, India company and LLP, GST registration | planned: handoff (checklist), no legal advice |
| Analytics and feedback | PostHog, Plausible, Tally forms | planned: handoff (brief adds analytics) |

AI models are an engine setting, not a thirteenth category. A doc test keeps this table in line with the catalogue.

## 7. Reused and new

**Reused:** the encrypted vault and permission checks; the calculator, currency helpers, receipts and number guard; the GSTIN checksum; the `services` dictionary pack; facts and memory; the trust policy; backup and export; the desktop shell, IPC allow-list, loopback web server and the twelve back office views; the Claude Code and Codex CLI builders and the Codex host profile.

**New:** the venture desk (`platform/runtime/venture/`); the instant plan, interview, blueprint, terms and a 15-row country table; model connections with standing consent and synthetic recordings; price receipts with GST splits, clients, orders, invoices and payments in the books; the brief, its lint, the builder links and the GitHub reader; the connector catalogue; playbook, rehearsal, launch ladder and capability list; the launch screens; an allow-listed way to open partner links.

## 8. What is not in this build, and why

| Not built | Why |
|---|---|
| A public hosted web app | Needs accounts, TLS and tenancy; this run allows no deploys |
| Durable storage for real books | The file vault is the engine's experimental demo; PostgreSQL isn't wired for this flow |
| Real outside writes (payment links, email, posts) | No paid services in this run; writes need sandbox evidence first |
| Agents that read files, inboxes or the web | Needs connectors and a sandbox tier |
| Approve a sample, auto with spot checks | Needs a sampling rule and a measured record |
| Lovable and Replit MCP, a GitHub App, webhooks, Zoho sign-in | OAuth and app reviews, and they'd spend the person's credits |
| India e-invoicing (IRN), cross-border VAT reverse charge | Needs portal access and per-country rules |
| Automatic polling and schedules | Sync is a click for now |
| Keys in the OS keychain | Keys live in memory and are entered again after a restart |
| The improvement loop | Needs more judged deliveries first |
| agentOS, containers, hosted sandboxes | No Windows sidecar; Docker and vendor accounts aren't assumed |
| Several businesses in one vault | One currency and dictionary per vault |

## 9. Words

| Word | Meaning |
|---|---|
| Venture | One business started in Chausar |
| Blueprint | The one-page plan; each line marked told by you, assumption or computed |
| Receipt | The proof behind a number: inputs, steps, rounding, figures |
| Handoff | Chausar prepares it, you finish it in the other product |
| Playbook | The typed list of steps a delivery agent follows |
| Draft reply | What an agent writes from the client's message, for you to check |
| Rehearsal | Practice runs with made-up clients and record-only effects |
| Practice draft | A shadow-stage draft that can't go to a client |
| Template outline | Text from built-in templates when no AI is connected |
| Signal | A rejection, an edit or a failed check that can become a rehearsal case |
| Standing consent | A one-time yes for sending non-client words to your chosen model |
| Tax invoice | An invoice with every registration field the country needs |
| Back office | The original twelve books views, now behind every business |
