# Wave 6 decisions

Agreed by the founder on 30 October 2026, after a code audit, a hands-on walk of the app as a new user, and research on Codex, T3 Code and the tools named below. This file is the single source of truth for wave 6. Where it differs from older docs, this file wins.

Each decision has an id (D1, D2...). Work packages in `PACKAGES.md` point back to these ids.

## Who the beta is for

- **D1. Audience.** Ordinary professionals with classic jobs (CA, teacher, designer, marketer, recruiter, writer and so on) who want to earn from a small AI-run service business built around their skills. India first, global too.
- **D2. Beta scope: 57 professions in 11 families.** Money and tax; Teaching and coaching; Creative work; Writing and content; Local services; Documents and reports; Research and analysis; People and careers; Shop and back office; Tech services; Licensed work. The full list with offers, cautions and the playbook each uses is in `PACKAGES.md` (package 6E6). Families share engines; only four new desks are built: lesson, booking, document and sign-off.
- **D3. Beta form.** A free download. Windows and Linux. No Mac for now. No Chausar-hosted server, so no running costs. Code signing is skipped for now.
- **D4. Laptop users only** for the beta. Phone-only users are out of scope until a hosted version exists.
- **D5. Day jobs.** Onboarding asks whether the owner's employment contract allows side work, and says plainly that this is their responsibility.

## How the AI runs

- **D6. The AI tool is the agent.** Chausar drives the owner's Codex (through `codex app-server`) or Claude Code (through the Claude Agent SDK) as the full agent, the way T3 Code does. Chausar's engine is exposed to it as an MCP server: read records and files, the calculator (returns receipts), draft documents, propose an action (becomes a Today card), and later the UI tools (D40).
- **D7. Chausar keeps:** receipts and the rule that every number comes from the calculator; exact approval for outside effects; client-data consent; the quality check; the audit log.
- **D8. Chausar drops:** its own agent loop caps (4 turns, 12 tool calls, USD 0.25), the WASM row-language sandbox as the main way to run work, the separate "heavy work" tier, per-call cost reservations for plan users (show "runs on your plan" and the plan's own usage instead), and its own model routing for tool users.
- **D9. Approvals.** Per-turn approval of AI steps goes, and so does the 30-minute preview expiry. In their place: (a) one recorded consent per client before that client's data reaches the AI; (b) inside a job, the tool's own reviewer handles its steps (`--approve-for-me` for Codex, `--permission-mode auto` for Claude Code), always inside Chausar's job folder; (c) a tap for anything that reaches the outside world: send, post, pay, issue an invoice, change a price, delete. Standing rules (routines, webhooks, monitors) still ask once.
- **D10. Auto mode** becomes an owner setting per agent ("Let the reviewer approve routine steps"). The lock that needed "the founder's yes" and its screen text are removed.
- **D11. Default settings** (all editable on Settings > AI):

  | Setting | Codex | Claude Code |
  |---|---|---|
  | Quick work (sorting, classifying) | `gpt-6-luna`, effort high | Haiku 5.5, effort high |
  | Plans, drafts, client text | `gpt-6.1-sol`, effort high | Sonnet 5.5, effort high, fallback Haiku 5.5 |
  | Approvals inside a job | `--approve-for-me` | `--permission-mode auto` |
  | Sandbox | job folder only; on Windows also `windows.sandbox=unelevated` | file tools only; shell off unless a playbook needs it |
  | Network and web search | off; on for research playbooks | web tools off; on for research playbooks |
  | MCP | Chausar's server plus servers the owner adds | same |
  | Tool memory, hooks, history | off (Chausar keeps its own memory) | project settings only |
  | Spend cap | none (plan-based) | only for key users |

- **D12. Getting the AI connected.** The first screen after install is "Connect your AI". The installer bundles Codex (Apache-2.0: ship its LICENSE and NOTICE, no OpenAI endorsement implied). A setup helper starts each tool's own official login (`codex login --device-auth` shows a code and link; Claude Code's own login). Chausar never shows its own Claude or ChatGPT sign-in, never reads, copies or forwards login files or tokens. A plain AI key is the alternative, with presets for OpenAI, Anthropic and OpenAI-compatible gateways (OpenRouter; Rapid Router only after it confirms company details and data retention in writing). Keys live in the computer's keychain, not in memory only.
- **D13. Claude Code is on by default.** The founder accepts Anthropic's Commercial Terms for this use. `CHAUSAR_CLAUDE_CODE_TERMS` defaults to accepted; the variable can still switch it off.
- **D14. Policy watch.** Anthropic's 7 October 2026 support pages say a user's own plan covers `claude -p`, the Agent SDK and third-party apps; an app may not offer its own claude.ai login. OpenAI's ChatGPT sign-in for third-party apps is partner or open-source only. The founder applies to OpenAI's access form; the desktop app is open-sourced (D46), which may qualify on its own. Re-check both before beta.

## Getting started

- **D15. Country and currency** come from the AI reading the owner's words and from the computer's time zone (India when it is Asia/Kolkata), confirmed on the first screen and changeable any time. Never from the computer's language setting.
- **D16. Profession, offers and plan are chosen by the AI**, from a sentence, a resume PDF or the owner's own LinkedIn data export (never a profile URL). The keyword guesser remains only as a fallback when no AI is connected.
- **D16a. The About-you step is A that becomes B.** It opens as option A (a message box at the top, the field tiles below). When the owner sends a message, the page animates into option B: the message box grows into the chat column on the left and the live "Your business" preview slides in from the right, as one motion of at most 400 ms (none with reduced motion). It changes on Send, not on the first keystroke, so nothing moves while they type. Picking a tile instead goes straight to the plan, and "Back to fields" returns to A. Reference: `reference-ui/OnboardAB.dc.html` (clickable), drawn from `OnboardA.dc.html` and `OnboardB.dc.html`.
- **D17. Price ranges** show an (i) button with sources and the date checked. Credible sources only: professional bodies (for example ICAI's recommended fee scale), government data, published rate pages of established marketplaces, reputable surveys. With no credible source the app says "No reliable data". Prices stay owner-set.
- **D18. English only.** Hindi is removed from the app for now; the translation plumbing stays.
- **D19. Two launch stages:** "Practice" and "Live (you approve each)". Shadow folds into practice. The missing button to move up is added. Stages that do not work yet are hidden.
- **D20. The 43 lawyer and CA rules** are unlocked by owner attestation: each rule gets a plain-English screen, the owner ticks "I am responsible for this in my business", the tick is recorded with the date and can be withdrawn.
- **D21. Hard stops** that no attestation unlocks: stock tips, target prices or promised returns without a SEBI registration; advocates advertising or soliciting; AI diagnosis or prescription; children's data without verified parental consent; CAPTCHA bypass, detection evasion, LinkedIn automation, fake reviews; undisclosed AI voices or presenters. The app explains each stop in one line.

## Money

- **D22. Storage is beta-grade.** The encrypted file store is the real storage in the download-only beta. After a short checklist (backup and restore, a crash during a save, the recovery code) the "experimental storage" label and the "Practice invoice" line are removed on desktop.
- **D23. Invoices are fully configurable:** several invoices per order (advance %, milestones, partial, final), due dates on orders and invoices, payment terms, reminder schedules, recurring invoices. Sensible defaults.
- **D24. How to pay, on every invoice:** the owner's UPI ID with a `upi://pay` link and QR code for the exact code-computed amount, bank details, a PDF, and Share through WhatsApp or email (the owner sends). No receipt id on the client's copy.
- **D25. Payments.** Beta: UPI link and QR, paid status "marked paid by you". Next: Razorpay Payment Links on the owner's own account, with Chausar asking Razorpay for status whenever the app is open (no webhooks needed). Dodo does not accept these businesses (its policy rejects services where human work is most of the value); keep it only for Chausar's own subscription later. Stripe India is invite-only; PayPal does not serve payments inside India.
- **D26. Foreign clients** can be invoiced in their currency.

## Owner control

- **D27. Posting and outreach limits are owner settings.** Today's numbers stay as defaults with a plain warning that WhatsApp, Gmail and X ban accounts that send too fast. The "can lower but not raise" rule goes. Every send still needs a tap.
- **D28. Jargon is renamed:** Posture becomes "How much it asks you"; Shadow becomes "Practice on real orders"; The judge becomes "Quality check"; Playbook becomes "How the work is done"; Handoff becomes "You send it"; Webhook becomes "Send to n8n or Make". Founder-facing text is removed from customer screens.
- **D29. Everything that can reasonably be configured is configurable**, with defaults.

## Reaching outside, without a Chausar server

- **D30. MCP client.** Chausar connects to any MCP server: local (stdio, desktop) and remote (streamable HTTP, OAuth with PKCE, tokens in the keychain), with elicitation. Read-only tools on Chausar's checked list run freely; every other tool call gets an exact approval card tied to a digest of its arguments; a changed tool description asks again; tool output is untrusted and never starts a write; large tool sets sit behind a tool search. A small curated list comes from the official MCP registry.
- **D31. Plugins are playbook packs:** markdown skills, MCP server references and WASM calculators. No code hooks in beta.
- **D32. Web search and reading.** Search uses the AI tool's own built-in web search first (Codex web search, Claude Code's WebSearch and WebFetch): included in the owner's plan, nothing to set up, switched on for research playbooks. Owners on a plain AI key can add a free Brave, Exa or Tavily key; no DuckDuckGo scraping (it breaks that site's rules). Page reading is local: robots.txt, terms-barred list, caching, one request per site every few seconds, an honest bot name, no proxies, and a full stop at a CAPTCHA. JavaScript pages use Electron's own hidden browser window; small site crawls use Crawlee.
- **D33. Webhooks.** Outbound only in beta: owner-approved, signed sends to the owner's n8n, Make or Zapier, with retries and a receipt.
- **D34. Email** goes through the AI tool's own Gmail connection first: owners on a ChatGPT or Claude plan connect Gmail once inside ChatGPT or Claude, and Codex or Claude Code can use it. Chausar sets the tool to always ask before any send-type tool and shows that request as a normal exact-approval card; the tool's auto reviewer never approves a send. Owners without such a connection get the existing path: a ready draft opened in their own mail app. Chausar's own Google sign-in (`gmail.send`) is later and optional, so no Google review is needed for the beta.
- **D35. Phone alerts** go through the owner's own Telegram bot (free; the desktop app talks to it). Approvals stay in the app: on the same Wi-Fi by pairing link, away from home through Tailscale.
- **D36. Client links, forms and background work.** Client links become PDFs and files sent on WhatsApp or email, or the owner's own Google Drive folder. Enquiry forms are the owner's free Google Form or Tally form, imported into Chausar. Work runs while the app runs (start at login, system tray).
- **D37. People search:** Happenstance for the owner's own network and Probe42 or Tofler for Indian company records, each on the owner's own key. Apollo later. Nothing sourced from LinkedIn. Data services need their own accounts; a ChatGPT plan does not unlock them.
- **D38. Images and video** through Sunra's MCP server: one approval card per generation with the cost in rupees from code, rights recorded, never Sunra's auto-confirm.

## Inside the app

- **D39. Mini apps.** The owner asks for a small tool and the AI builds it inside Chausar: a web page in a sandboxed frame with no internet, no access to the rest of Chausar and no file access. It talks to Chausar only through a bridge in the MCP Apps message format: read only what the owner granted, keep its own notes in the vault, ask the calculator for amounts, propose actions as Today cards. First use shows a permission screen. Versions with undo. Pin to Today or the Apps place. Export as one file. Screens: `reference-ui/AppsA.dc.html` and `AppsB.dc.html`.
- **D40. The UI is configurable and usable by the AI.** Each place is a list of blocks from a fixed library, saved per owner as a layout file. The AI can read a description of the current screen and use tools to show, hide or reorder blocks, rename labels, pin mini apps, save views and navigate. Layout and wording changes apply at once with Undo; changes touching approvals, privacy, money rules or limits become a Today card. The approval card and receipts use a fixed design the AI cannot restyle. The same tools are in Chausar's MCP server.
- **D41. Recorded flows** (record once, run with no AI). The owner does a website task once in Chausar's browser window; Chausar saves it as a recipe of plain steps with blanks; the owner tests it and approves once; Chausar replays it exactly with no AI, filling blanks from its records, and stops before any submit, pay or post step for that run's exact approval. A changed page stops the run; an AI-drafted repair needs new approval. Builds on `app/desktop/owner-browser*.cjs` and `playbooks/kit/recipes.ts`; JavaScript must be allowed in that window.
- **D42. Chats** get four states: Pinned, Active, Snoozed, Settled. Auto-settle after 7 quiet days, never while an approval or question is open. Snooze presets wake early only when the owner is needed. Archive lives in Settings. Every action has Undo. Receipts are never touched.
- **D43. Retiring an agent:** a check screen lists open work, routines and instructions; the owner hands each to another agent or stops it; routines switch off; the thread becomes read-only on a Retired shelf; receipts keep the name with "(retired)"; Bring back restores it as it was.
- **D44. CRM and memory upgrades:** every field remembers who changed it and when; pipelines as lists; a real Company record with two-way links; calls, WhatsApp messages and invoices on each client's timeline; facts stored with when they became true, what they replaced, their source and who may see them; an AI-spend meter and a model receipt on every run.
- **D45. Voice:** push-to-talk built as a chain: speech to text (Sarvam key or the local whisper.cpp), the normal chat, text to speech. Spoken numbers only from receipt-checked text. A spoken "yes" never approves anything; the owner taps the card. Consent notice before the microphone first turns on; audio not stored by default.

- **D50. "Connect what your business needs" in onboarding.** After the plan is kept, the AI lists the outside services this owner's business would use (for example Razorpay for payments, Gmail for email, a Telegram bot for phone alerts, Tailscale for phone access away from home, Happenstance or Probe42 for finding clients, Sunra for images and video, MCP servers for their other tools), each with one line on why. Each has a guided connect that uses the service's own sign-in or a key saved to the keychain, and each is skippable and available later in Connections. Chausar ships no shared keys for these; every owner connects their own.

## Shipping and learning

- **D46. Open source** under AGPL, after a check of the repo history for anything private.
- **D47. Feedback** through an opt-in "Send report" the owner previews before it leaves: PostHog for milestones, drop-off, friction, AI health, quality and earnings in ranges; Sentry for crashes; short in-app questions. Never client names, client data, message text, files or prompts. A privacy notice and "delete my reports".
- **D48. No dates.** The plan carries no timeline.
- **D49. Traders** are served within the rules: a securities guard (no orders, tips, copy trading or return promises), a trading journal from broker exports with every charge computed by code, and a tax pack for the owner's CA. Later, a back office for SEBI-registered research analysts.

## Things only the founder provides

Astra sets these up itself by computer use in the founder's browser and apps, with the founder doing only sign-ins, verification codes and 2FA: Sentry and PostHog projects, a Telegram test bot, Razorpay test keys (only if the founder already has an account; never entering PAN, KYC or bank details), and the VPS login user (below). Linux test machine: the Hostinger VPS, freshly reinstalled and empty (host key ED25519 SHA256:npgqXyjsoyOl5WPdLWTfFgV4R2glLT7IrbsNJBtbWPE, confirmed by the founder on 30 October); Astra creates the user `fable` with the key in `~/.ssh/chausar_vps_fable.pub` through the Hostinger browser terminal, so `ssh chausar-vps` works. Later and optional: a Google OAuth client for Chausar's own Gmail sign-in. Founder admin: the OpenAI access form from Chausar's company OpenAI account. Done: the Anthropic terms acceptance (D13). Until each exists, the package that needs it builds against fixtures, labels itself "fixture-tested", and lists the missing item in its notes. Keys go in `C:\Users\karta\.chausar\w6.env`, outside the repo, never in chat, code, fixtures or commits.
