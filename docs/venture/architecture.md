# Chausar B2C: target architecture

Written 15 October 2026 for the founder and revised after review. Updated 16 October for the hosted web tier and the delivery harness, 18 October for onboarding v2: connect an AI first, one open box, a plan composed from checked blocks, and 19 October for keychain custody: no passphrase at onboarding, the computer keeps the vault key, automatic encrypted backups, and the live business preview. It replaces the SMB books-companion architecture (`D:\claude\chausar-2\CHAUSAR-ARCHITECTURE.md`) for this iteration; the books engine described there stays, as the back office. Nothing here claims a part exists today. `BUILD-SPEC.md` says exactly what this run builds.

## 1. The idea in one minute

Chausar helps a person start a service business that AI agents help run: a bookkeeping studio, a content shop, a research desk, a support team for hire. The person stays the owner and approves what matters.

They connect an AI first (their own key, or Claude Code or Codex on their computer), then type one sentence about what they want to do: an idea, a skill or a problem. The AI picks blocks from Chausar's checked library and Chausar's own code draws the plan; then they type their prices and say whether they charge tax. Keeping it locks it in an encrypted vault, whose key the computer keeps for the owner's login, so there is no passphrase to type, and turns every price into a receipt. Chausar writes the build brief for the website and client portal, opens it in Lovable or Replit with one click, and follows the code through GitHub, read only. Delivery agents practise on made-up clients first. When the first order comes in, the books engine issues the invoice and records the payment, and every number has a receipt.

Two rules bind everything:

- **The AI never does arithmetic.** Prices, tax, totals and costs come from deterministic code that writes a receipt. Model text with a number in it is refused, unless it's a word like "B2B" copied from the owner's own words.
- **Never fake a capability.** Every connector and every place agent work can run is labelled `handoff`, `read`, `write` or `planned`, and the label matches what the code does today. An agent may say work is done only when a tool run proves it, and it never says it sent anything.

## 2. The user's journey

```
 1 Your AI      your own Anthropic or OpenAI key, or Claude Code or Codex on this computer;
                kept in the engine's memory only; "Sign in with ChatGPT" shown as not open yet
 2 Your idea    "What do you want to do?"  one box: an idea, a skill or a problem
 3 Plan         the quick model says which it is and picks views; the plan model picks blocks
                code checks every block and word, then draws the plan; nothing is saved yet
                set your prices; nothing is added up yet
 4 Keep it      nothing to type: an encrypted vault named from the business; the computer keeps its key
                the AI and the plan move in; prices become receipts; you accept the plan
 5 Build        read the brief -> "Open in Lovable" / "Open in Replit" (you press send there)
                -> paste your repo -> Chausar reads GitHub and says only what it can see
 6 Connect      starter cards for your country and your plan's tools; honest chips on all 64
 7 Rehearse     agents practise on three made-up clients; checks first, then a judge
 8 Launch       rehearsal -> shadow (practice drafts) -> approve each draft
 9 Run          order + files -> agent works with tools -> draft with work receipts -> you approve
                -> invoice -> payment -> books with receipts
```

The first useful output comes after one connection and one sentence. Without an AI, "Continue without AI" gives a built-in plan at once and says it wasn't fitted to what the owner wrote. Keeping the plan asks for nothing: the engine makes the vault, names its folder from the business and gives its key to the computer's own protected storage for the owner's login. A passphrase is asked for only where no protected storage answers. Next time the app opens, the business opens by itself, and Welcome back lists the businesses on this computer when there are more. A passphrase lock, a recovery code, automatic backups and moving to another computer sit in Trust & access (piece 13). The hosted web tier keeps the earlier order and its server custody for now: idea, template plan, keep it, then add an AI inside the vault; its screens get the same live preview.

## 3. The pieces

### Piece 1. The venture desk: one durable actor per business

**What.** Each business is one record in the encrypted vault, changed only by named actions, with a short event log the screens read.

**How.** Every write goes through one helper: check permission, run the action on a draft, append declared events (`blueprint-accepted`, `invoice-issued`), commit once. A failed action changes nothing. Backup, export and delete already cover these records.

**Reference.** Rivet Actors gave the shape: one actor per key, actions in, events out, with Rivet's names so a hosted adapter can map onto real Rivet Actors later. Rivet isn't a dependency: its engine keeps state outside our encrypted vault and saves on a timer, not per action.

### Piece 2. The plan (blueprint)

**What.** A one-page plan: one to three offers, delivery steps with who does each, approvals, website pages, tools, questions to ask and things to check, and back office settings.

**How.** The owner's AI composes the structure from a checked library of blocks, before anything is saved, in two calls. A quick call decides what the sentence is and which views fit, from a fixed list of seven; then the plan model fills a strict schema with block ids and short words, never markup. Code checks every id, count and word (no digits, no numbers or prices in words), asks once more with the reason when an answer fails, and otherwise says plainly that there's no plan to show. Who does each step comes from the block, not the model. Without an AI, code builds the structure from a template for the service type and says so. After that the model only writes words into named slots, and a structure hash proves nothing moved while it wrote. The owner types the price; the calculator turns it into a receipt. Each step says who does it today. You add the client's files to the order and the agent reads them; for bookkeeping an agent reconciles the month from those files for you to check. Reading inboxes, other hands-on work and sending stay yours, marked planned.

**Reference.** helix-foundry: code computes structure, the model writes descriptions, a proposal is validated and accepted by digest. snapshift: decide first, then fill a fixed schema. SubQ Snap: decisions as typed questions instead of free text.

### Piece 3. What your business knows

**What.** Business terms (client, order, deliverable, invoice, payment) that start `proposed` and turn `active` only when evidence arrives, such as the first issued invoice. Calling a new business's words "known" on day one would be faking.

**Reference.** EvoOntology: nothing is active without a probe backing it, and agents should query meanings through tools rather than a pasted glossary (the tools are planned).

### Piece 4. Model connections

**What.** Bring your own key or your own command-line tool, with cheap models by default (Claude Haiku 5.5 for quick work and Sonnet 5.5 for plans on one Anthropic key, or GPT-6 Luna). Without either, built-in templates do the work and say so. Connecting is the first step of onboarding: before any vault exists, the AI waits in the engine's memory (the draft desk) and moves into the vault, with every call already made, when the plan is kept. "Sign in with ChatGPT" is shown but not open: OpenAI lets only open-source tools, personal projects that run locally and apps it picks use a ChatGPT plan. Claude Code waits behind a gate in code until Chausar accepts Anthropic's Commercial Terms.

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

**What.** 133 registered connectors in 12 categories: 74 shared entries and 59 playbook entries. Each card shows its current modes and qualification, such as `handoff`, `planned: handoff` or `planned: read`. Installed tools and current permissions can change which operations are available.

**How.** The catalogue is data, and each card describes the implemented operation and its limits. A `handoff` prepares a brief, draft or export for the owner to use manually; opening a vendor site alone does not count. Available reads include GitHub, local TallyPrime, Zoho Books through the owner's self client and selected organisation, and source readers for individual playbooks. Available writes include the built-in CRM and books, exact approved Zoho Books operations with readback, plain-text posts through supported official API connections, and the specific operations described on other playbook cards. These external implementations are fixture-tested, not proof of success on a live account. Setup, current source and client permissions, and any required named review still apply. Every outside effect needs approval of the exact action. Invoice issue asks separately; uncertain outcomes require inspection, never an automatic resend. TallyPrime writes remain planned with manual entry meanwhile, and LinkedIn remains copy-and-open only.

**Reference.** R6 for the list and region facts (Stripe is invite-only for new Indian businesses, so India defaults to Razorpay; WhatsApp limits AI-first chat services, and its card says so). agentOS: a versioned capability descriptor where each capability is available, planned or unavailable, with a plain reason.

### Piece 8. Delivery agents and their playbook

**What.** A playbook per business: typed steps (gather, question, compute, write, verify, approve, operator), versioned and hashed, run by a harness. Agents use tools in a bounded loop on the files the owner adds to an order. For bookkeeping the result is a real work product: a month reconciled from a bank statement and bills, with receipts. Other service types get a reply; their hands-on work stays with the owner.

**How.** A cheap model takes up to four act turns. Each turn it calls tools, deny by default: read a file (CSV, XLSX, PDF text through the Python helper), search the business dictionary, ask the calculator for sums, reconcile a statement, run its own row program in the sandbox, or hand a question to the client or owner, which ends the turn. Every tool answers with one envelope (`ok` and a result, or a typed error). Limits on turns, tool calls and spend force a last write step with tools off. On a real order every model turn waits for the owner to approve its exact text. Numbers and dates appear only as references to receipts, shown with their label ("Total: INR 2,948.82"). The client's message and files are information, never instructions. A sentence that claims finished work passes only when a tool run proves it. A playbook is validated before it runs, and every run records its hash.

**Reference.** AgentRun (Grep.ai): the model decides what a thing is, code decides what follows, with a verify pass and replay instead of rerun. agentOS: tools as host functions with one JSON envelope and deny-by-default permissions. xiryn: hand-offs end the turn. Factory Environments: only validated definitions run, and each run leaves the same record. `docs/venture/harness.md` has the detail.

### Piece 9. Rehearsal and the launch ladder

**What.** Three made-up clients per service type (clean, messy, pushy), run before any real client. Then a ladder: rehearsal, shadow, approve each draft. Approving a sample and auto with spot checks are planned.

**How.** A simulated client writes the request, the agent drafts, and every outside effect is a record-only mock. Deterministic checks run first, then a cheap judge answers four typed questions. Shadow needs a passing, judged rehearsal with a real model; its drafts are practice only and can't be copied or accepted. Without a model, Chausar gives a template outline that says no AI wrote it. Owner rejections and edits become signals, and a signal can become a new rehearsal case.

**The improvement loop.** A failed or rejected run is diagnosed and pinned to one level. Chausar writes one typed playbook change with a note, then runs the old and new playbook on the business's held-back cases and practice clients. The change is kept only if it wins, versions are never overwritten, and the owner adopts each change.

**Reference.** Harness Learning: the harness is a versioned program improved by one tested patch at a time, behind a paired gate. DigitalOcean Signals and Simulations (the cneuralnetwork post): personas, expected outcomes, turn limits, mock tools, baseline against candidate. AgentRun and EvoOntology: a held-back set the author never sees before anything is promoted.

### Piece 10. Where agent work runs

| Tier | What | State in this build |
|---|---|---|
| Code | Calculator, receipts, checks, the agent loop | Available; runs inside Chausar, not a sandbox |
| Actor | Agent turns with tools inside the engine | Available, with limits on turns, tool calls and spend |
| WASM, light | The agent's own row programs, in a separate process with no file, network or process access | Available on the desktop; off on the hosted server |
| WASM, full | agentOS virtual machine | Unavailable on Windows; planned elsewhere |
| Container | The agent's Python in Docker | Only where Docker is found ("Needs Docker Desktop"); never on the hosted server; not yet tried on a real Docker |
| Hosted | E2B, Sail or Cloudflare under your own account | Planned ("Needs your account") |

**Reference.** agentOS (host functions as the only bridge to trusted code), the mlejva (E2B) post on why sandboxes alone aren't enough, the danlovesproofs post on pay-by-the-minute sandboxes, the danieljvdm post on Durable Objects, and Factory Environments. Drivers will use the person's own account and stay labelled until tested.

### Piece 11. The back office: money with receipts

**What.** The existing books engine becomes the back office of every business: clients, orders, invoices, payments, books.

**How.** A price receipt records the inputs, each BigInt step and the rounding rule. Invoices, payments and delivered work become facts, and the existing calculator produces billed, received and earned receipts that the old twelve views open too. Tax applies only after the owner says they charge it, at a rate they confirm. For India, GST splits into CGST and SGST or IGST by place of supply, exports are zero-rated only after the owner confirms an LUT, and the invoice prints GSTIN, SAC and place of supply. Other VAT and GST countries print the owner's registration number. Until those fields are filled, the document says "Invoice (not a tax invoice)".

This build runs on the engine's file storage, which the code calls an experimental demo, so every money screen says: practise here, don't issue real invoices yet. Records are kept for ten years, and the owner is told.

**Reference.** The current architecture's pieces 7, 8 and 10.

### Piece 12. The screens

**What.** A short launch flow and seven places: Today, Business, Build, Clients, Agents, Money, Connections. The old twelve views stay under "Back office".

**How.** Today leads with what needs the owner and the launch checklist ("7 of 12"). A screen holds about 40 reading words at rest. The onboarding screens use look B, "bold and graphic": the asking on the left, the business taking shape on the right in real words (its kind, its name, its one line, each offer with its price and then its receipt, and a small website card), like the founder's prototype B, light and dark, one column on a phone, motion that happens once and stops for reduced motion, and 45 words or fewer at rest on each, the preview not counted. Every word in the preview is an engine answer, the owner's own typing or one of five fixed phrases; the renderer adds, rounds and formats no amount. While a model writes, a still outline of the coming view and one line of words replace any spinner. The renderer never computes money.

**Reference.** The founder's 1 October frontend spec. Riley Brown's internal app post: make the required action obvious. Jakub Antalik's skeleton post: an outline in the exact shape of the view, without the animation. lintapple: words at rest, no looping motion and honest labels, checked in tests.

### Piece 13. Keeping the business safe

**What.** No passphrase at onboarding. The computer keeps each business's vault key for the owner's login; a "Lock with a passphrase" switch in Trust & access adds a passphrase for owners who want one; automatic encrypted backups run while the app is open; and a business moves to another computer with one file and a one-time code.

**How.** The vault format doesn't change. A random data key encrypts the business and is wrapped twice, in a passphrase slot and a recovery slot. In this-computer mode the passphrase slot holds a random 32-byte computer secret that the owner never sees, and the operating system keeps that secret: Windows DPAPI for the current user, called through Windows PowerShell 5.1 with the secret on stdin only (run on a real Windows 11 computer); the macOS login keychain through `/usr/bin/security` and the Linux Secret Service through `/usr/bin/secret-tool` (written and tested with fake processes, not yet run on a Mac or a Linux desktop). Where no protected storage answers, the screen says why and asks for a passphrase. Turning the lock on swaps the computer secret for the owner's passphrase, makes a recovery code if there is none, and forgets the computer's key; turning it off checks the passphrase and swaps back. Backups are written by a 30-second tick: when the newest is six hours old and the business changed since, or soon after an important change (a plan accepted, an invoice issued, a payment recorded) once the newest is two minutes old; also when the business is closed or the engine stops, and as a safety copy before a lock change or a restore; a rotation keeps the ten newest, one a day for fourteen days, one a week for eight weeks and five safety copies, and never removes a copy the owner made. After a lock change every managed backup is sealed again, so it opens the way the business opens now. A restore inside the business saves a safety copy first. Since the computer's key can't travel, a move makes a backup whose passphrase slot opens with a one-time code shown once. No new npm package does any of this. `docs/custody.md` has the detail, what was run and the threat notes.

**Reference.** The founder's decisions of 18 October 2026, the existing vault and backup machinery, and Windows DPAPI's per-user scope.

## 4. Web and desktop from one engine

One engine, one renderer, two ways in:

```
renderer (app.js + launch.js) --+-- desktop: Electron IPC, allow-listed methods --+
                                +-- web: loopback HTTP /api/rpc, pairing token ----+--> one Engine --> vault
```

There are two web modes. **Local web mode**: the engine runs on the person's computer and their browser opens the printed pairing link. **The hosted web tier** (experimental, off unless the server starts with `--hosted`): sign-in by email link or passkey, the server holds each business's vault key, one actor per business in Rivet's shape (a Rivet adapter is planned), files or PostgreSQL for storage, key-only AI with rate and spend limits. It is written and tested on one computer and not deployed; PostgreSQL has been tested against a stand-in, not a real server. On the hosted server no agent tool starts a process: no containers, no agent-written code and no PDF reading, until the founder decides. `docs/venture/hosted.md` lists what a deploy still needs. CLI model routes stay on the person's own computer; a hosted web app will use keys only. Long model work runs one rehearsal client per request, so the desktop's request timer never cuts it off.

## 5. Models

| Job | Default | State |
|---|---|---|
| Reading the first sentence, interview, simulated clients, judging | Claude Haiku 5.5 (`claude-haiku-5-5`) | Ready with your key |
| Composing the plan, plan words, build brief, draft replies | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | Ready with your key |
| Either job | GPT-6 Luna | Unverified: a past probe failed; you type the model id; costs are estimates |
| Everything, on your own plan | Claude Code CLI or Codex CLI | Checked on this computer before use; Codex needs its reviewed host profile; Claude Code waits until Chausar accepts Anthropic's Commercial Terms |
| Everything, on a ChatGPT plan | Sign in with ChatGPT | Not open to Chausar yet: OpenAI approves which paid apps may use it |
| No AI yet | Built-in templates | Works offline; every line says it came from a template |

The Anthropic route asks for structured JSON at low effort and records refusals and cut-offs as errors. It never retries silently or switches models.

## 6. Connectors

| Category | Examples | Modes in this build |
|---|---|---|
| Build | Lovable, Replit, Bolt, v0, GitHub | handoff (brief link or copy); GitHub read |
| Site and domain | Vercel, Netlify, Cloudflare, Porkbun | planned: handoff |
| Payments | Razorpay, Cashfree, Stripe, PayPal, Paddle | planned: handoff, read, write |
| Email and inbox | Your own mail app, Google Workspace, Zoho Mail, Resend | Your own mail app: handoff (you send a draft); Google Workspace and Zoho Mail: read (your inbox over IMAP with an app password, desktop app only); others planned |
| Booking and calendar | Cal.com, Calendly, Google Calendar | Google Calendar: read (the private address you paste, desktop app only); planned: handoff, read |
| Customers and CRM | Chausar CRM, HubSpot, Zoho CRM, Attio | Chausar CRM read and write; others planned |
| Messaging and support | WhatsApp, Telegram, Slack, Discord | Telegram and Discord: write (exact approved plain text through the owner API connection, fixture-tested); planned: other modes |
| Docs and ops | Notion, Google Drive, Linear, Airtable | planned |
| Marketing and social | LinkedIn, X, Instagram, Buffer, Bluesky, Mastodon | Bluesky and Mastodon: write (exact approved plain text through the owner API connection, fixture-tested); planned: other modes. LinkedIn is copy-and-open only |
| Books, tax and invoicing | Chausar back office, TallyPrime, Zoho Books, Xero | Chausar back office read and write; TallyPrime read; Zoho Books read and write (exact approved drafts, masters, opening balances and received settlements with readback, fixture-tested; invoice issue asks separately); planned: TallyPrime write and Xero |
| Legal and entity | Stripe Atlas, India company and LLP, GST registration | planned: handoff (checklist), no legal advice |
| Analytics and feedback | PostHog, Plausible, Tally forms | planned: handoff (brief adds analytics) |

AI models are an engine setting, not a thirteenth category. A doc test keeps this table in line with the catalogue.

## 7. Reused and new

**Reused:** the encrypted vault and permission checks; the calculator, currency helpers, receipts and number guard; the GSTIN checksum; the `services` dictionary pack; facts and memory; the trust policy; backup and export; the desktop shell, IPC allow-list, loopback web server and the twelve back office views; the Claude Code and Codex CLI builders and the Codex host profile.

**New:** the venture desk (`platform/runtime/venture/`); the draft desk that keeps the AI and the plan before the vault; the composer with its block library and view registry; the instant plan, interview, blueprint, terms and a 15-row country table; model connections with standing consent and synthetic recordings; price receipts with GST splits, clients, orders, invoices and payments in the books; the brief, its lint, the builder links and the GitHub reader; the connector catalogue; playbook, rehearsal, launch ladder and capability list; the delivery harness (tools, the agent loop, the light sandbox for agent code, work receipts, the improvement loop); the hosted web tier; the launch screens; the vault key kept by the computer, the business list, automatic encrypted backups with their rotation, and the move file and code; an allow-listed way to open partner links.

## 8. What is not in this build, and why

| Not built | Why |
|---|---|
| A deployed public web app | The hosted tier is written and tested on one computer; a deploy needs TLS, a managed database and a real PostgreSQL test run, and no deploys were allowed |
| Durable storage for real books on the desktop | The desktop file vault is the engine's experimental demo; PostgreSQL is wired for the hosted tier only |
| Real outside writes (payment links, email, posts) | No paid services in this run; writes need sandbox evidence first |
| Agents that read inboxes or the web | Needs connectors; agents read only the files the owner adds |
| Agent-written code and PDF reading on the hosted server | Off there until the founder decides whether agent code may run on a shared server |
| Work products for service types other than bookkeeping | Bookkeeping came first; the others get replies |
| Approve a sample, auto with spot checks | Needs a sampling rule and a measured record |
| Lovable and Replit MCP, a GitHub App, webhooks, Zoho sign-in | OAuth and app reviews, and they'd spend the person's credits |
| India e-invoicing (IRN), cross-border VAT reverse charge | Needs portal access and per-country rules |
| Automatic polling and schedules | Sync is a click for now |
| AI keys in the OS keychain | AI keys live in memory and are entered again after a restart; since 19 October the vault key is kept by the computer, the AI keys not yet |
| The vault key on macOS and Linux, run for real | Written and tested with fake processes; nobody has run them on a Mac or a Linux desktop yet, so the screens say only what each computer's own check finds |
| Electron safeStorage for the vault key | Designed only; the engine's worker is plain Node and calls the operating system itself |
| agentOS and hosted sandboxes; containers tried on a real Docker | No Windows sidecar; Docker and vendor accounts aren't assumed |
| Several businesses in one vault | One currency and dictionary per vault |

## 9. Words

| Word | Meaning |
|---|---|
| Venture | One business started in Chausar |
| Blueprint | The one-page plan; each line marked told by you, assumption or computed |
| Receipt | The proof behind a number: inputs, steps, rounding, figures |
| Handoff | Chausar prepares it, you finish it in the other product |
| Playbook | The typed list of steps a delivery agent follows |
| Draft reply | What an agent writes from the client's message and its tool results, for you to check |
| Work receipt | The proof behind an agent's work: which files and rows a tool used and what it found |
| Improvement loop | One tested playbook change at a time, kept only if it beats the old one |
| Rehearsal | Practice runs with made-up clients and record-only effects |
| Practice draft | A shadow-stage draft that can't go to a client |
| Template outline | Text from built-in templates when no AI is connected |
| Block | One checked piece a composed plan is built from: an offer, a step, a page, a tool, a question or a thing to check |
| View | One of seven fixed ways the plan screen can show a plan; the AI picks which, code draws them |
| Draft desk | Where the AI and the plan wait in the engine's memory before the business is kept |
| Computer secret | The random key in a vault's passphrase slot that the computer keeps for the owner's login |
| Move file | A backup that opens with a one-time code, for moving a business to another computer |
| Signal | A rejection, an edit or a failed check that can become a rehearsal case |
| Standing consent | A one-time yes for sending non-client words to your chosen model |
| Tax invoice | An invoice with every registration field the country needs |
| Back office | The original twelve books views, now behind every business |
