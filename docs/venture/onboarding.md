# Onboarding: connect an AI first, one open box, a plan made from checked blocks

The founder's decisions of 18 October 2026 changed how a new owner starts. The old first screen asked "What service business do you want to start?" and dropped the answer into one of eight built-in templates by counting keywords. No AI was involved, so "Dog walking for busy nurses in Leeds" got the generic template.

Now the owner connects an AI first, then types one sentence about what they want to do. The AI reads it, picks views from a fixed list and builds a plan from Chausar's checked library of blocks. Code checks every id and every word. The AI chooses; Chausar draws. It never writes markup, a number or a price.

The spec is `.b2c-work/ONBOARDING-SPEC.md` (revision 2). This page says what the build does.

## The flow

```
0  Pair this browser          local web only, when the browser has no session
1  Connect an AI              API key (Anthropic or OpenAI), Claude Code, Codex; ChatGPT sign-in "Not open yet"
       |  the key lives in the engine's memory only: never on disk, never in the browser
2  What do you want to do?    one sentence: an idea, a skill or a problem
       |  call 1, the quick model (decide): idea, skill or problem? which two to four views fit?
3  Working                    still outlines in the shapes of those views; nothing spins, nothing loops
       |  call 2, the plan model (compose): blocks from the library, short words for each
       |  code checks every block id, count, word cap and word: no digits, no numbers in words, no prices, no markup
4  Here's your plan           drawn by Chausar's own code from the blocks
5  Set your prices            typed by the owner; nothing is added up yet
6  Keep it safe               working name, passphrase, recovery code shown once
7  Setting up                 the plan, the AI and "What was sent" move into the vault; prices become receipts
8  Accept, Build, then the seven places, as before
```

Side paths:

- **Continue without AI** (a quiet link on Connect): the open box, then today's built-in template plan, labelled "Built-in plan, not fitted to what you wrote."
- **Already have a business? Open it** (on the open box): Welcome back, the passphrase, recovery, restore, the sample business.
- **Hosted web** keeps today's order for now (idea, template plan, keep, then Add your AI inside the vault). Connect-first there needs a draft desk per session behind the hosted rate limits (founder flag F4).

## Connecting an AI

Each row on Connect has one status, the weakest of its presets, in this order: ready, unverified, needs setup, unavailable, not open. At rest a row shows only a short chip. No word on the screen says "works" or "working", because no preset in this build has been tried with a live account; the line "Not yet checked with a live account." shows once under the rows while that is true. The line is worked out from the presets, not fixed.

| Row | What the code does | Status today | Chip |
|---|---|---|---|
| Paste an API key | Anthropic: one key for Claude Haiku 5.5 (quick work) and Claude Sonnet 5.5 (plans), two connect calls. OpenAI: GPT-6 Luna for both, with an editable model id. | Anthropic ready, OpenAI unverified (price not confirmed by OpenAI), so the row is unverified | Can connect |
| Claude Code on this computer | The owner's own unmodified `claude -p`, signed in through Claude Code's own login. Behind the terms gate below. | needs setup while the gate is closed | Needs setup |
| Codex on this computer | The owner's own `codex exec` on the reviewed host profile, on their own `codex login`. | needs setup without the reviewed profile, else unverified | Needs setup or Can connect |
| Sign in with ChatGPT | Nothing. No preset, no route, no request, no button. | not open | Not open yet |

Cheap by default: the recommended row connects Haiku 5.5 for decide and Sonnet 5.5 for compose with one Anthropic key. Claude Code runs Sonnet 5.5 for both tiers in this milestone (one model per connection, founder flag F12), and the screens are to name it "Claude Code (Sonnet 5.5)".

If the second call of the recommended pair fails, the first stays connected and `venture.ai.status` shows the quick tier only. The spec has the screen say "Connected for quick work only.", show the engine's words and the key field again, and offer "Connect Sonnet 5.5 for plans", which sends only the second call; Connect doesn't move on until there is a usable plan model.

### Sign in with ChatGPT: real, but not open to Chausar yet

The founder is right that OpenAI now documents a way for other apps to use a ChatGPT plan: OAuth 2 with PKCE at `auth.openai.com`, a `127.0.0.1` callback and the `chatgpt.tokens.use.direct` scope. It isn't open to every app. The row's words, shown when it is opened, are exactly:

> OpenAI lets only open-source tools, personal hobby projects and partners it picks use a ChatGPT plan. Chausar is a commercial app and hasn't been approved yet. Use an OpenAI key for now.

So the row has no control that pretends; its only link opens the API key row on OpenAI. The token rule is not the blocker: the one-hour access token and the thirty-day refresh token could live on a memory-only shelf, with a sign-in again after each restart, and no token file would exist. Eligibility is the blocker. If the local app is open-sourced, or OpenAI approves Chausar through its interest form, this could be built (founder flag F1). Nobody has applied.

Sources for this row, checked 18 Oct 2026 (from `.b2c-work/R7-ai-signin.md`):

- https://developers.openai.com/siwc
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
| `workspace.create` (Keep it safe) | Kept, timer paused, so the passphrase and the recovery code can't wipe the plan |
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

The lead view is open at rest with only its lead items. The first support view is a closed fold. Everything else sits in one fold, "More of your plan". The right-hand preview follows the picks with shapes only: a site with blank bars for `pages`, blank chips for `tools`, one badge for `notes`.

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
2. **Digits and signs.** No digit unless the token also holds a letter and was copied from the owner's own sentence (so "B2B" passes and "2 dogs" doesn't); no currency signs, percent or magnitude words.
3. **Numbers and money in words.** Cardinals from two upward, ordinals from second upward, dozen, half, quarter, double, twice, triple, currency names, currency codes the owner didn't write themselves, and the price words free, discount and discounted. "One sentence", "your first client", "stress-free" and "second-hand" are allowed. "Twenty pounds a walk" is refused and repaired (founder flag F23).
4. **Ids and choices** are enums and refs, never free text.
5. **Prices** are typed by the owner, parsed by code into the currency's smallest unit, and shown back as the engine formats them. Before Keep it safe the plan shows only what the owner typed: no tax and no total (founder flag F5). After it, each priced offer gets a calculator receipt.
6. **The renderer** never parses or works out an amount. It sends the typed text as typed and shows the engine's words.

## The screens

The renderer package builds these screens in look B, "bold and graphic", from `.b2c-work/onboarding-options/b-bold/index.html`: a split layout with the asking on the left and the business assembling as shapes on the right, light and dark, one column at phone width. Pairing, Keep it safe, the recovery code and Welcome back move to the same look. The spec's motion rules: short, once, nothing loops, nothing over 400 ms, and reduced motion turns it all off.

The spec gives every screen one budget of 45 words at rest, counting the header, both halves and every closed fold's summary together (the recovery code itself is not counted). With every model string at its cap, the worst cases it works out are: Connect 42, the open box 37, Working 37, Plan 44, Set your prices 44, Keep it safe 40, the recovery code 41. Accept and Build reuse the business and build places; the renderer package measures them and records them against founder flag F10. The renderer test counts each screen; this page will carry the measured numbers once that package lands.

Every "with <model>" line on these screens is to come from the live status (the plan records who wrote it in `writtenBy`, with `replay` set for a recording). In the replay demo, Working and Plan are to say "from a synthetic recording" and name no model.

The renderer package owns the screens (`app/renderer/launch.js`, `app.js`, `styles.css`) and their tests (`venture-onboarding-renderer.test.ts`). [launch.md](launch.md#onboarding-v2-18-october) lists the screens and their exact words.

## After Keep it safe

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
| `venture-onboarding-e2e.test.ts` | the whole new journey on recordings: connect before any vault, compose "Dog walking for busy nurses in Leeds" in the United Kingdom, type GBP 18 and GBP 60.50, keep it safe, adopt the plan and the AI, receipts equal to the typed prices, accept, a brief with the plan's pages and no client-area lines, a playbook that credits no agent with the walks, a template rehearsal, an order, an issued invoice whose total is the receipt total; the repaired and refused recordings; the skill and problem plans; the Claude Code route with the gate open and closed; a restart before Keep it safe; and the demo replay |
| `venture-onboarding-renderer.test.ts` (renderer package) | the screens, their words at rest, the right pane, the CSS tokens and the copies of the contract lists |

The recordings are in `platform/tests/fixtures/venture/onboarding/` ([README](../../platform/tests/fixtures/venture/onboarding/README.md)). All are hand-written and labelled synthetic recording.

## The demo

The offline demo answers the composer for the demo idea ("Monthly bookkeeping for cafes and small shops in Pune."), the three open-box examples and the landlord sentence. Any other sentence has no recording and says so (`FIXTURE_MISSING`); nothing is made up. While other agents share this worktree, run it on its own port and folder so it never meets the founder's server on 4317 or the repo's `data/` folder:

```sh
CHAUSAR_PORT=4391 CHAUSAR_VAULT_DIRECTORY=.b2c-work/demo-data CHAUSAR_VENTURE_REPLAY=1 CHAUSAR_VENTURE_MODEL_REPLAY=platform/tests/fixtures/venture/demo/model-replay.json CHAUSAR_VENTURE_GITHUB_REPLAY=platform/tests/fixtures/venture/e2e/github-sync.json npm start
```

Add `CHAUSAR_CLAUDE_CODE_TERMS=accepted` to try the Claude Code row; the demo has Claude Code answers for decide and compose only.

[README.md](README.md#demo-script) has the steps.

## Founder flags

Section 12 of the spec lists every choice the founder may want to reverse (F1 to F23). The ones this page touches most: F1 (ChatGPT sign-in not built), F2 (Codex on the ChatGPT login), F3 (the Claude Code gate), F4 (hosted keeps today's order), F5 (no tax or total before Keep it safe), F7 (sixty minutes idle, paused on Keep it safe), F8 (one repair call each), F10 (one budget of 45 words per screen), F18 (a personal problem is refused, and a built-in plan is still offered), F21 (word caps), F23 (numbers in words refused).
