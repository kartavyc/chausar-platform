# Onboarding: connect an AI first, one open box, a plan made from checked blocks

The founder's decisions of 18 October 2026 changed how a new owner starts. The old first screen asked "What service business do you want to start?" and dropped the answer into one of eight built-in templates by counting keywords. No AI was involved, so "Dog walking for busy nurses in Leeds" got the generic template.

Now the owner connects an AI first, then types one sentence about what they want to do. The AI reads it, picks views from a fixed list and builds a plan from Chausar's checked library of blocks. Code checks every id and every word. The AI chooses; Chausar draws. It never writes markup, a number or a price.

The spec (revision 2) and the research behind the ChatGPT row are local working notes in `.b2c-work/`, a folder that isn't in the repository. This page says what the build does and carries what a reader needs from them.

## The flow

```
0  Pair this browser          local web only, when the browser has no session
1  Connect an AI              API key (Anthropic or OpenAI), Claude Code, Codex; ChatGPT sign-in "Not open yet"
       |  the key lives in the engine's memory only: never on disk, never in the browser
2  What do you want to do?    one sentence: an idea, a skill or a problem
       |  call 1, the quick model (decide): idea, skill or problem? which two to four views fit?
3  Working                    still outlines in the shapes of those views; nothing spins, nothing loops
       |  call 2, the plan model (compose): blocks from the library, short words for each
       |  code checks every block id, count, word cap and word: no money, no price words, no markup (a number marks a model estimate)
4  Here's your plan           drawn by Chausar's own code from the blocks
5  Set your prices            typed by the owner; nothing is added up yet
       |  Keep this plan: Chausar makes the encrypted vault itself, named after the business, and this
       |  computer keeps its key for the owner's login (no passphrase, no folder; see "Keeping the plan" below)
6  Setting up                 the plan, the AI and "What was sent" move into the vault; prices become receipts
7  Accept, Build, then the seven places, as before
```

Side paths:

- **Continue without AI** (a quiet link on Connect): the open box, then today's built-in template plan, labelled "Built-in plan, not fitted to what you wrote."
- **Already have a business? Open it** (on the open box) and **Open my business** (on Connect): Welcome back, which lists this computer's businesses (below).
- **Hosted web** keeps today's order for now (idea, template plan, keep, then Add your AI inside the vault). Connect-first there needs a draft desk per session behind the hosted rate limits (founder flag F4).

## Keeping the plan, Welcome back and the live preview (keychain custody, 18 October)

The founder's later decisions of 18 October removed the Keep it safe step. The engine side is in [docs/custody.md](../custody.md); this is what the screens do.

- **Keep this plan** sends `workspace.create { name, pack: 'services', folder: null }` with no passphrase key. The name is the composed plan's name, or the built-in plan's kind of service. The engine picks the folder from the name and asks this computer to keep the vault key. Then Setting up, Accept and Build, as before. Progress has five segments here: AI, Idea, Plan, Accept, Build.
- **No protected storage.** When the engine answers `DEVICE_KEYS_UNAVAILABLE`, one screen, "Choose a passphrase.", shows the engine's own reason, two passphrase fields, then the recovery code once. Nothing else changes.
- **Opening the app.** A held draft or a connected draft AI resumes onboarding. Otherwise `workspace.list`: one business that opens with this computer (and that its owner didn't close) opens straight away; more, or one locked with a passphrase, show Welcome back; none starts at Connect.
- **Welcome back** lists the businesses on this computer, newest opened first, two at rest and the rest under "More businesses". Each row has its name, a chip ("Opens with this computer", "Needs your passphrase" or "This computer's key is missing") and Open. A passphrase row opens its own field. "Start a new business" and "Move from another computer" sit under the rows; More options holds "Restore a backup", "Use a recovery code" (the business is chosen from the list, and a new passphrase is asked only when the engine says this computer can't keep the key), "Open by folder name" (only when the list is incomplete or empty), "Try the engine again" and, on the experimental engine, the sample business.
- **Restore a backup** lists `workspace.backups.list` by business, each with its day and time and its kind ("Automatic", "You made it", "Before a change"), and sends the file's name, never a path. **Move a business here** takes the move file and its code; the code field is a password field outside any form and is cleared after each send.
- **Trust & access** starts with "Keeping your business safe": the "Lock with a passphrase" switch, the recovery code, the automatic backups with Back up now and a confirmed restore, "Move to another computer" (the code in chunks of four and "Save the file") and "What this protects". The same panel opens from the workspace menu as "Backups and lock". In this-computer mode the menu's "Lock vault" reads "Close this business". Today shows one quiet line while the business has no recovery code.
- **Hosted web** keeps server custody, Keep it and its recovery code, and never calls a custody method.

**The live preview.** The right side shows the business coming together in real words, like the founder's prototype B: the kind, the name, the one line, each offer with how it is charged and its price, and a small website card with the first four page names, the line and the offers. Every word there is an engine answer, the owner's own typing, or one of five fixed phrases ("Your business", "Takes shape as you type.", "Price not set", "before tax", "Encrypted on this computer"). A price is the engine's `priceDisplay` before the vault, the receipt's total label and display after it, or, on the built-in plan, the owner's typed text beside the currency code. The renderer adds, rounds and formats nothing. There is no web address. The pane stays `aria-hidden`, and it isn't counted in the 45 words at rest. At phone width a strip under the header shows the small shapes, the kind and the name. Hosted gets the same preview, without the lock words.

Words at rest, header and left pane, measured by the renderer test with the longest answers: Pair 30, Connect 45, the open box 35, Working 37, Plan 43, Set your prices 44, Not a service 31, Refused 39, Choose a passphrase 36, the recovery code 36, Setting up 9, Accept 45 (the longest plan) or 30, Build 44, Welcome back 38 (three businesses, the longest name, the typed folder offered) or 20 (none). The captures, light and dark at 1366 px and 375 px, are `screens/60-*` to `78-*`: [prices](screens/63-prices-light.png), [setting up](screens/64-setup-light.png), [Accept](screens/65-accept-light.png), [Welcome back](screens/68-welcome-back-light.png), [Trust, off](screens/72-trust-off-light.png), [backups](screens/75-trust-backups-light.png), [moving](screens/76-trust-move-light.png). They come from the renderer fixtures in headless Edge, not from a live engine. The live walk of 19 October, against the real engine and this computer's Windows key store, is in [`screens/onboarding-v3/`](screens/onboarding-v3/); the next section says what it did.

## The live walk, 19 October

The integration pass ran the app in local web mode on port 4391 with the demo replay variables and an empty vault folder under `.b2c-work/demo-data`, and walked it in headless Edge over the DevTools protocol, by clicking and typing in the real page. The engine used this computer's real key store, Windows DPAPI. What happened, in order:

1. First visit: Pair this browser; the printed pairing link opened Connect. Paste an API key with a demo key, I agree, Connect.
2. The open box, Based in India, "Monthly bookkeeping for cafes and small shops in Pune." The right side showed "Your business" and the typed line as it was typed, then the plan's kind, name, line, offers and a website card with four page names.
3. Set your prices: 2499 and 9999, shown in the preview as typed ("INR 2499") and then as the engine formatted them ("INR 2,499.00 before tax"); GST yes at 18.
4. Keep this plan: no screen asked for anything. The engine made the vault in the folder `ledger-cafe-books`, `workspace.status` said `unlock: 'this-computer'`, the card file held the name and the key record a DPAPI blob, and neither the vault nor the backup file holds the business name in plain text. Accept showed the receipts (INR 2,948.82 and INR 11,798.82, worked out by the engine with GST) in the preview. Accept plan, then Build.
5. Automatic backups: one at the first tick after the vault was made, and one after the plan was accepted, as soon as the rule allows (two minutes after the first).
6. The server was stopped and started again (a new pairing link, as after any restart). The business opened by itself, with no passphrase and no folder typed. "Close this business" from the workspace menu showed Welcome back with the business listed and "Opens with this computer"; Open opened it.
7. Trust & access: Lock with a passphrase, a passphrase twice, the recovery code shown once; the switch on, the key record gone from `custody/keys`. After another restart Welcome back said "Needs your passphrase"; the passphrase opened it. The switch off again with the passphrase: a new key record, `this-computer` again, and every backup sealed again (all of them "Opens the way your business opens now").
8. Back up now, then a client added, then Restore on that copy, confirmed: the client was gone and a "Before a change" copy had been saved first.
9. Make a new one (a recovery code in this-computer mode, no passphrase asked), and Move to another computer: the move code in chunks of four, Save the file. The captures hide the characters of both codes. Welcome back's Restore a backup and Move a business here, and a second business (Night Shift Walkers, with Working and Setting up held back a moment so they could be captured), after which Welcome back listed both.

Nineteen screens are captured in light and dark at 1366 px and 375 px, and the moments in between (a row opened, a price being typed, a sheet, a confirmation) in light at 1366 px; the back office keeps its light look in dark mode. Nothing scrolls sideways at 375 px. Words at rest are the renderer test's measure, listed in the section above; the walk did not count them again.

Not walked: a move imported on a second computer (the engine refuses a move file of a vault already on this computer; `workspace-custody.test.ts` imports one between two engines), the passphrase fallback on a computer with no protected storage (renderer tests and `CHAUSAR_DEVICE_KEYS=none` cover it), the hosted screens (the renderer test checks the same preview there), and any Mac or Linux key store.

## Connecting an AI

Each row on Connect has one status, the weakest of its presets, in this order: ready, unverified, needs setup, unavailable, not open. At rest a row shows only a short chip. No word on the screen says "works" or "working", because no preset in this build has been tried with a live account; the line "Not yet checked with a live account." shows once under the rows while that is true. The line is worked out from the presets, not fixed.

| Row | What the code does | Status today | Chip |
|---|---|---|---|
| Paste an API key | Anthropic: one key for Claude Haiku 5.5 (quick work) and Claude Sonnet 5.5 (plans), two connect calls. OpenAI: GPT-6 Luna for both, with an editable model id. | Anthropic ready, OpenAI unverified (price not confirmed by OpenAI), so the row is unverified | Can connect |
| Claude Code on this computer | The owner's own unmodified `claude -p`, signed in through Claude Code's own login. Behind the terms gate below. | needs setup while the gate is closed | Needs setup |
| Codex on this computer | The owner's own `codex exec` on the reviewed host profile, on their own `codex login`. | needs setup without the reviewed profile, else unverified | Needs setup or Can connect |
| Sign in with ChatGPT | Nothing. No preset, no route, no request, no button. | not open | Not open yet |

Cheap by default: the recommended row connects Haiku 5.5 for decide and Sonnet 5.5 for compose with one Anthropic key. Claude Code runs Sonnet 5.5 for both tiers in this milestone (one model per connection, founder flag F12), and the screens name it "Claude Code (Sonnet 5.5)".

If the second call of the recommended pair fails, the first stays connected and `venture.ai.status` shows the quick tier only. The screen says "Connected for quick work only.", shows the engine's words and the key field again, and offers "Connect Sonnet 5.5 for plans", which sends only the second call. Connect doesn't move on until both the quick and the plan tier can serve, because decide runs on the quick tier.

### Sign in with ChatGPT: real, but not open to Chausar yet

The founder is right that OpenAI now documents a way for other apps to use a ChatGPT plan: OAuth 2 with PKCE at `auth.openai.com`, a `127.0.0.1` callback and the `chatgpt.tokens.use.direct` scope. It isn't open to every app. The row's words, shown when it is opened, are exactly:

> OpenAI lets only open-source tools, personal projects that run locally and apps it picks use a ChatGPT plan. Chausar is a commercial app and hasn't been picked yet. Use an OpenAI key for now.

So the row has no control that pretends; its only link opens the API key row on OpenAI. The token rule is not the blocker: the one-hour access token and the thirty-day refresh token could live on a memory-only shelf, with a sign-in again after each restart, and no token file would exist. Eligibility is the blocker. If the local app is open-sourced, or OpenAI approves Chausar through its interest form, this could be built (founder flag F1). Nobody has applied.

Sources for this row, checked 18 Oct 2026 (the research note itself is a local working file, not in the repository). The integration pass read the first two again the same day: OpenAI's plan usage page covers open-source and locally hosted apps and sends paid or remotely hosted apps to the interest form, and the cookbook names open-source projects, personal projects that run locally and selected private apps. Chausar's desktop app runs on the owner's computer, but it is a paid, closed app, so it needs OpenAI's approval first.

- https://developers.openai.com/siwc
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites
- https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt
- https://openai.com/form/sign-in-with-chatgpt-interest/

### Codex

The row keeps the owner's ChatGPT login inside Codex, with honest words: "OpenAI hasn't said yet that apps like Chausar may use a ChatGPT plan this way." OpenAI's closest line says app-server sign-in "has never been permitted for commercial or hosted services". No page bans `codex exec` on the owner's own login for this use, and none approves it. Chausar never reads `auth.json`. The safer alternative, Codex only with an OpenAI key, is founder flag F2.

### The Claude Code terms gate

Anthropic says a product that runs Claude Code needs its Commercial Terms accepted. That is a founder action, so it is a gate in code. `CHAUSAR_CLAUDE_CODE_TERMS=accepted` opens it; anything else, or nothing, keeps it pending, which is the default in every build. While pending, before the vault and inside it alike, the Claude Code preset is "needs setup" with the words "Chausar hasn't yet accepted Anthropic's terms for running Claude Code. Use an Anthropic key for now.", and both `venture.ai.connect` and `venture.models.connect` refuse it with `PRESET_UNAVAILABLE`. When the founder says yes, the lead records it in `STATE.md` and the desktop build sets the variable. [models.md](models.md#the-claude-code-terms-gate) has the details.

The other conditions hold whether the gate is open or not: Chausar never reads `.credentials.json`, never sets `CLAUDE_CODE_OAUTH_TOKEN`, shows no sign-in of its own, passes no flag that removes sign-in methods, and the row warns that plans have limits made for one person.

## The draft desk: the AI before any vault

Before a business is kept, the engine holds everything in a **draft desk**, in memory only:

- a secret shelf for keys (`model:<presetId>`);
- an in-memory store with one draft business record, the draft connections and every draft call, so the same model port runs every rule it runs in the vault: the call is written down before it is sent, the monthly cap, the consent digest, one dispatch per call, the client-data guard;
- one compose session (the decision, then the plan, then the owner's edits).

| Event | Draft desk |
|---|---|
| First `venture.ai.*` or `venture.compose.*` request | Made (loaded on first use) |
| Any draft request | The idle timer starts again at sixty minutes |
| Sixty minutes with no draft request | Cleared: keys, records and plan. The next fill or update answers `COMPOSE_NOT_FOUND`, and decide answers `NO_MODEL_CONNECTED`, so the screen can send the owner back to Connect. |
| `workspace.create` (Keep this plan) | Kept, timer paused, so making the vault can't wipe the plan |
| `venture.create` succeeds | Adopted into the vault, then wiped |
| `venture.create` fails | Kept as it was; the owner can try again |
| `workspace.open`, `recover`, `restore`, lock, close | Cleared |
| The engine stops | Gone. Keys never touched disk. |
| A vault that already holds a business is open | Every draft method refuses `VENTURE_EXISTS` |

The nine draft methods are `venture.ai.options`, `venture.ai.connect`, `venture.ai.disconnect`, `venture.ai.status`, `venture.ai.calls`, `venture.compose.decide`, `venture.compose.fill`, `venture.compose.get` and `venture.compose.update`. The engine answers them before its vault check. The local server lets only the trusted owner's bootstrap session use them, and the hosted server answers `HOSTED_NOT_AVAILABLE`. `venture.ai.connect`, `decide` and `fill` are app-only: a phone or a tainted context is refused.

**Handover.** `venture.create` gains `composeId` and `composedDigest`, sent together or not at all. The renderer never sends the plan itself. The engine checks the held plan's digest (else `APPROVAL_STALE`), checks the plan again, then writes in one action: the business, the composition record, the answered interview, plan version 1, the adopted connections and calls (same ids and times, so "What was sent" in the vault lists the calls made before it), and the events `venture-created`, `plan-composed`, `interview-updated`, `blueprint-drafted` and `model-connected`. Only after that commit are the keys copied to the vault's memory-only shelf. An AI connected before the vault is adopted even when the owner chose a built-in plan.

## The open box

One textarea, "What do you want to do?", 10 to 2,000 characters. Decide sorts the sentence into one of four kinds:

| Kind | Example | Lead view the pick lines steer toward |
|---|---|---|
| idea | "Dog walking for busy nurses in Leeds." | `offers-first` |
| skill | "I'm good at Excel and I want to teach it." | `steps-first` |
| problem (one other people have) | "Small cafes lose track of their bills." | `audience-first` |
| not a service | "My landlord won't fix the heating." | none: "Chausar plans services you sell to other people. Try saying what you could do for them." |

All three service kinds end in the same plan shape. There is no keyword fallback in the product: with no AI connected, decide refuses `NO_MODEL_CONNECTED` and the screen offers the built-in plan by name. The keyword rules in `platform/tests/fixtures/venture/onboarding/kind-rules.ts` exist for tests only.

## The block library

The AI picks block ids and writes short words for them. What each block means, who does each step, the approval and note words, and which pricing an offer may use are code (`platform/runtime/venture/core/blocks.ts`).

| Kind | Ids | Count | The AI writes | Code decides |
|---|---|---|---|---|
| Offer | `retainer`, `subscription`, `one-off-project`, `package`, `audit`, `setup`, `session`, `course`, `hourly-help`, `done-for-you` | 1 to 3 | name (4 words), description (30 words), pricing from the block's list | id `offer_1` on, allowed pricing, price only from the owner |
| Step | `collect-inputs`, `book-time`, `meet-client`, `hands-on-work`, `in-person-work`, `draft-reply`, `send`, `deliver-files`, `follow-up`, `get-paid` | 3 to 6, exactly one `draft-reply`, and `send`, `deliver-files`, `follow-up`, `get-paid` only after it | title (4 words) | id `step_1` on, who does it, what it can do today, its note |
| Approval | `each-draft`, `prices-invoices`, `posts-in-your-name`, `client-files` | 1 to 4, always `each-draft` | nothing | the words |
| Page | `home`, `offers-prices`, `how-it-works`, `start-request`, `booking`, `about`, `faq`, `portfolio`, `client-area`, `privacy-terms` | 4 to 6, always `home` and `offers-prices` | title (4 words), purpose (24 words) | id `page_1` on |
| Tool | 29 connector catalogue ids, never a payments connector | 2 to 6 | reason (18 words) | the connector card |
| Question | `customer`, `first-offer`, `channel`, `area`, `hours`, `experience`, `tools-you-use` | 0 to 2; 1 to 2 only with the `questions` view | text (20 words), 2 to 4 choices (5 words each) or a typed answer; never about prices | id `q_1` on, the field it fills, optional |
| Note | `licence-may-apply`, `insurance`, `personal-data`, `children-or-care`, `regulated-advice`, `safety` | 0 to 3; 1 to 3 only with the `notes` view | nothing | the words: prompts to check, not advice |

The tool ids are `mail-app`, `google-workspace`, `zoho-mail`, `cal-com`, `calendly`, `google-calendar`, `chausar-crm`, `hubspot`, `zoho-crm`, `attio`, `whatsapp`, `telegram`, `slack`, `discord`, `notion`, `google-drive`, `linear`, `airtable`, `linkedin`, `x`, `instagram`, `buffer`, `chausar-books`, `zoho-books`, `tally`, `xero`, `quickbooks-online`, `tally-forms` and `typeform`. The payment rail always comes from the owner's country.

Who does a step is never the AI's call. `draft-reply` is the only step an agent drafts in this build ("An agent drafts a reply from the client's message. You check it."). `meet-client`, `in-person-work` and `get-paid` are the owner's alone, with no agent planned, so "Walk the dogs" can never be credited to an agent.

Word caps for the top-level words: business name 4 words (60 characters), one line summary 24, customer line 24, the reading 12 (90 characters), the `audience-first` who line 7 and problem line 8. The caps keep every onboarding screen at 45 words or fewer even when every answer is as long as allowed. A longer answer is refused and repaired once (founder flag F21).

## The view registry

The AI picks two to four views from this fixed list: one lead view, first, then support views in the order it wants them. The renderer has one drawing function per id, built from text nodes; the AI never sends markup.

| View | Role | Heading | Draws |
|---|---|---|---|
| `offers-first` | lead | What you sell | one or two offer names at rest |
| `steps-first` | lead | How the work gets done | two or three step titles with who does each |
| `audience-first` | lead | Who it helps | the who line and the problem line |
| `pages` | support | Your website | pages, in a fold |
| `tools` | support | Tools to connect | tools, in a fold |
| `questions` | support | Quick questions | one or two questions, in a fold |
| `notes` | support | Check before you start | notes, in a fold |

The lead view is open at rest with only its lead items. The first support view is a closed fold. Everything else sits in one fold, "More of your plan". The right-hand preview shows the plan in real words (see "Keeping the plan, Welcome back and the live preview" above); while the AI writes, its website card outlines only the page list when the picks include `pages`, and `notes` adds one badge to the card.

## The composer contract

```
venture.compose.decide { text, countryCode }
   quick tier, schema venture-decide, marker chausar-decide-v1
   check -> rejected: one repair call (chausar-redecide-v1) -> rejected again: COMPOSE_REFUSED
venture.compose.fill { composeId }
   plan tier, schema built from the decided views only, marker chausar-compose-v1
   check -> rejected: one repair call (chausar-recompose-v1) -> rejected again: COMPOSE_REFUSED
   assemble (pure code) -> the plan, held in the draft desk
```

- Only a refused answer (`MODEL_OUTPUT_REJECTED`) gets the repair call. Every other error (timeout, refusal by the model, budget, send setting off, no key, no CLI) passes through with the port's own words.
- The repair call carries the engine's description of what was wrong, never the rejected text.
- Each call is its own entry under "What was sent", the failed one included, and counts toward the month's cap. One plan can cost four calls at most (founder flag F8).
- A refused decide stores no decision. A refused fill keeps the decision and stores no plan, so "Try again" calls fill again. There is never a made-up plan, a partial plan or a quiet swap to a template. The refused screen says "There's no plan to show." and "The AI's answer failed Chausar's checks again. No plan was saved. Both tries are listed under What was sent."

### The number guard, every layer

1. **Schema.** No number or integer type anywhere a model writes.
2. **Numbers are model estimates.** Since the founder's decision of 21 October a number the model writes, in digits or in words ("Walks for 2 dogs", "twice a week"), passes and marks its plan line `estimate: true`, shown as a model estimate and never given a receipt.
3. **Money and price words.** No currency sign, no currency code or name next to a number ("INR 500", "Twenty pounds a walk"), no amount token even if the owner typed it (Rs500, 15GBP), no "20% off" or "half price", and none of the currency names, currency codes the owner didn't write themselves, or the price words free, discount and discounted. "stress-free" is allowed. "Twenty pounds a walk" is refused and repaired (founder flag F23).
4. **Ids and choices** are enums and refs, never free text.
5. **Prices** are typed by the owner, parsed by code into the currency's smallest unit, and shown back as the engine formats them. Before the plan is kept it shows only what the owner typed: no tax and no total (founder flag F5). After it, each priced offer gets a calculator receipt.
6. **The renderer** never parses or works out an amount. It sends the typed text as typed and shows the engine's words.

## The screens

The renderer package builds these screens in look B, "bold and graphic", from a prototype the founder picked (a local working file, not in the repository): a split layout with the asking on the left and the business assembling on the right (in real words since the keychain change; see above), light and dark, one column at phone width. Pairing, the recovery code and Welcome back move to the same look (Keep it safe did too, until the keychain change took it out of the local flow). The spec's motion rules: short, once, nothing loops, nothing over 400 ms, and reduced motion turns it all off.

Each screen has a budget of words at rest: 45 or less, and lower on Pair 35, Not a service 35, Refused 40 and Setting up 25 (Welcome back was 40 and is 45 now that it lists businesses). The recovery code and the experimental-storage line are counted on their own, and since the keychain change so is the live preview; the current counts are in the section above. At the onboarding v2 integration, with the header and both halves counted together and every model string at its cap, the renderer test measured: Pair 30, Connect 45, the open box 37, Working 37, Plan 43, Set your prices 44, Not a service 31, Refused 39, Keep it safe 40, the recovery code 41, Setting up 14, Accept 45, Build 44, Welcome back 32. Accept fits by showing the version and the Offers heading only on the Your business place, so no screen needed the F10 exception. The demo walk's own counts are in [README.md](README.md#onboarding-v2-integration-18-october).

Every "with <model>" line on these screens comes from the live status, and the plan screen names who wrote the plan from its own `writtenBy` (with `replay` set for a recording), so a plan written by Sonnet still says Sonnet after the owner connects another AI. In the replay demo, Working and Plan say "from a synthetic recording" and name no model.

The renderer package owns the screens (`app/renderer/launch.js`, `app.js`, `styles.css`) and their test `venture-onboarding-renderer.test.ts`. [launch.md](launch.md#onboarding-v2-18-october) lists the screens and their exact words; the captures are in [`screens/onboarding-v2/`](screens/onboarding-v2/).

## After the plan is kept

The kept plan becomes the records that already existed, so everything downstream (receipts, the build brief, the playbook, rehearsal, orders, invoices) reads the same records as before. [core.md](core.md#composed-plans-onboarding-v2) explains how. In short:

- Plan version 1 is written by the model, with its block ids, pages, tools, notes and approval blocks. Later versions ("Rewrite with AI", owner edits) keep all of them; a rewrite may change words, never the block structure.
- A composed plan can't fall back to template words. With no AI connected, a rewrite refuses with "This plan was made with your AI. Connect an AI to rewrite it."
- The playbook finds the drafting step by its `draft-reply` block, and takes the agent's work step title only from `hands-on-work`.
- The build brief uses the plan's own pages in order. Without a `client-area` page it leaves out the sign-in, row security and private upload lines, because there is no private client area to protect.
- The launch checklist starts with "Connect your AI", then "Say what you want to do".

## How it is tested

| Test | What it proves |
|---|---|
| `venture-compose.test.ts` (engine package) | the fixed words, the schemas, every validation rule and the number guard cases, the repair, assembly, later plan versions keeping the blocks, and that no runtime file imports from the tests |
| `venture-draft.test.ts` (engine package) | the draft desk through the real engine: connect, the half-connected pair, the Claude Code gate, lifetime and idle expiry, the handover, and that the key is in no result, record, error or file |
| `venture-onboarding-e2e.test.ts` | the whole new journey on recordings: connect before any vault, compose "Dog walking for busy nurses in Leeds" in the United Kingdom, type GBP 18 and GBP 60.50, keep the plan with no passphrase (the engine composed as `server.ts` composes it, with an in-memory key store in place of the operating system's), adopt the plan and the AI, receipts equal to the typed prices, accept, a brief with the plan's pages and no client-area lines, a playbook that credits no agent with the walks, GitHub followed read only from the existing recording, a template rehearsal, an order, an issued invoice whose total is the receipt total and whose money lines pass the number guard, and no key in any file, call record or vault record, then a restart that lists the business by name, finds an automatic backup and opens it with no passphrase; the repaired and refused recordings, each checked for the rule it was refused by and a repair that names that rule; a judged rehearsal of a composed plan (the demo bookkeeping plan, on all three practice clients); the skill and problem plans; the Claude Code route with the gate open and closed; a restart before Keep this plan; a plan kept with a passphrase, as on a computer with no protected storage; and the demo replay |
| `venture-onboarding-renderer.test.ts` (renderer package) | every screen through the real `launch.js` and `app.js` on a fake engine: Connect first, the honest chips, the recommended and half-connected pair, a plan tier with no quick tier staying on Connect, the Claude Code gate, the open box, the decided views, not a service and refused, prices sent as typed, Keep this plan with no passphrase to Build in order, the passphrase fallback, five progress segments, the start-up choices, Welcome back's list, recovery, restore and move, the recovery code chunks, a reload, pairing, words at rest within each budget with the longest answers, the live preview's words and their sources, hosted's own Keep it, the CSS tokens, VAT kept in capitals, no control characters, and the renderer's copies of the contract lists |
| `custody-renderer.test.ts` (renderer package) | the Trust panel: the switch off, on, and on but disabled with the engine's reason; turning it on with the recovery code shown once; turning it off with the current passphrase; making a recovery code with and without the passphrase; backups, Back up now and a confirmed restore; moving, with the code in chunks of four and the file saved as given; Today's line and the workspace menu's "Close this business"; the copies of the custody words |

The recordings are in `platform/tests/fixtures/venture/onboarding/` ([README](../../platform/tests/fixtures/venture/onboarding/README.md)). All are hand-written and labelled synthetic recording.

## The demo

The offline demo answers the composer for the demo idea ("Monthly bookkeeping for cafes and small shops in Pune."), the three open-box examples, the landlord sentence, and "Bike repairs at home for families in Bristol.", whose two plan answers both use a block Chausar doesn't have, so the refused screen can be seen. Any other sentence has no recording and says so (`FIXTURE_MISSING`); nothing is made up. While other agents share this worktree, run it on its own port and folder so it never meets the founder's server on 4317 or the repo's `data/` folder:

In sh:

```sh
CHAUSAR_PORT=4391 CHAUSAR_VAULT_DIRECTORY=.b2c-work/demo-data CHAUSAR_VENTURE_REPLAY=1 CHAUSAR_VENTURE_MODEL_REPLAY=platform/tests/fixtures/venture/demo/model-replay.json CHAUSAR_VENTURE_GITHUB_REPLAY=platform/tests/fixtures/venture/e2e/github-sync.json npm start
```

In PowerShell:

```powershell
$env:CHAUSAR_PORT='4391'; $env:CHAUSAR_VAULT_DIRECTORY='.b2c-work/demo-data'; $env:CHAUSAR_VENTURE_REPLAY='1'; $env:CHAUSAR_VENTURE_MODEL_REPLAY='platform/tests/fixtures/venture/demo/model-replay.json'; $env:CHAUSAR_VENTURE_GITHUB_REPLAY='platform/tests/fixtures/venture/e2e/github-sync.json'; npm start
```

Add `CHAUSAR_CLAUDE_CODE_TERMS=accepted` to try the Claude Code row; the demo has Claude Code answers for decide and compose only.

[README.md](README.md#demo-script) has the steps.

## Founder flags

Section 12 of the spec (a local working note) lists every choice the founder may want to reverse (F1 to F23). The ones this page touches most: F1 (ChatGPT sign-in not built), F2 (Codex on the ChatGPT login), F3 (the Claude Code gate), F4 (hosted keeps today's order), F5 (no tax or total before the plan is kept), F7 (sixty minutes idle, paused while the vault is made), F8 (one repair call each), F10 (45 words or fewer per screen, lower on some, with a recorded exception possible for Accept and Build), F18 (a personal problem is refused, and a built-in plan is still offered), F21 (word caps), F23 (numbers in words refused).
