# Chausar's frontend today: an audit before the rework

Written 21 October 2026 from a read-only look at `D:\claude\chausar-platform` (branch `main`, HEAD `120def64`). Nothing in that repo was edited, installed or run. Captures were looked at under `docs/venture/screens/`.

## The short version

- The app is one hand-written vanilla JS renderer: `app/renderer/app.js` (1,318 lines, many of them 400 to 3,274 characters long) holds the old twelve "back office" views and the shell, and `app/renderer/launch.js` (3,792 lines, about 207 functions inside one closure) holds onboarding and the seven B2C places. One stylesheet, `styles.css` (603 lines), carries three different visual systems.
- The same renderer runs in three ways: the Electron window (IPC), a browser paired to the local engine (`POST /api/rpc`), and the experimental hosted web tier (same files served under `/app/`, with a separate sign-in page in `app/hosted/`).
- Every B2C screen is wired to the real engine. What is not real is labelled as such on screen: most connectors are "planned", two launch stages are planned, ChatGPT sign-in is "not open yet", and demo mode answers from synthetic recordings and says so.
- The phone companion is a separate TypeScript codebase (web preview + React Native source). It only runs against synthetic data. The native app has never been built.
- There is an older, unmerged React rewrite (`app/ui/`, 695 files) on the `origin/claude/lane-*` branches, built from the 1 October design spec before the B2C pivot. It is worth mining, not merging.
- All `b2c/*` branches are fully merged into `main`. `main` is the newest B2C frontend.

---

## 1. Stack and structure

### Files

| Path | Lines | What it is |
|---|---|---|
| `app/renderer/index.html` | 19 | Loads `styles.css`, `launch.js` (classic deferred script) then `app.js` (ES module). Strict CSP: no inline script or style, `connect-src` only self and `127.0.0.1`. |
| `app/renderer/app.js` | 1,318 | Transport, pairing, vault setup, the shell (rail, top bar, workspace menu), the twelve back office views, all shared DOM helpers (`h`, `button`, `modal`, `form`, `table`...). |
| `app/renderer/launch.js` | 3,792 | `globalThis.ChausarLaunch.create(kit)`: onboarding ("look B"), Welcome back, custody, and the seven places. Gets about 35 helpers from `app.js` through `kit`. |
| `app/renderer/styles.css` | 603 | Back office tokens, then `/* launch */` tokens (`--l-*`), then look B tokens (`--ob-*`). |
| `app/desktop/main.cjs` | 119 | Electron main. Serves the renderer from a `chausar://app/` protocol with a fixed file list, sandboxed window, context isolation, allowed external links only. |
| `app/desktop/preload.cjs` | 18 | Exposes `window.chausar.request`, `openExternal`, `onEngineStatus`. |
| `app/desktop/ipc-contract.cjs` | 121 | The method allowlist (about 330 names), request validator, trusted-sender check, the 55 partner origins for external links. |
| `app/desktop/engine-harness.cjs` | 97 | Forks `platform/runtime/worker.ts` and relays requests. Desktop request timeout is 15 minutes. |
| `app/hosted/` | 184 | Separate sign-in page: email magic link and passkeys, business picker, account delete. Then it sends the browser to `/app/`. |
| `app/companion/` | ~1,100 (excluding native project files) | Phone companion: `shared/` (controller, adapters, view contracts), `web/app.mjs` (DOM preview), `native/` (React Native screens). |

No framework, no build step, no bundler, no TypeScript in the renderer, no web fonts (system fonts only). `package.json` has no frontend dependencies at all.

### How the renderer talks to the engine

One function, `request(method, payload)` in `app.js` (line 127), picks the transport:

```
renderer request(method, payload)
   ├─ Electron:  window.chausar.request ──IPC 'chausar:request'──> main.cjs validateRequest + assertTrustedSender ──> engine worker
   ├─ Local web: fetch POST /api/rpc, Authorization: Bearer <pairing token from #token=... or pasted code>
   └─ Hosted:    same /api/rpc, bearer fetched from /api/hosted/session (HttpOnly cookie behind it)
```

- The method allowlist lives in `app/desktop/ipc-contract.cjs` (`METHODS`). Families: `workspace.*` (vault, custody, backups, transfer), `venture.*` (about 75 B2C methods), and the back office families (`conversation.*`, `sources.*`, `ontology.*`, `memory.*`, `decisions.*`, `actions.*`, `jobs.*`, `trust.*`, `models.*`, `plugins.*`, `activity.list`, and more).
- `launch.js` calls 79 distinct methods and `app.js` calls 81.
- `request()` also manages "evidence": a list of methods (`evidenceChanges`) and error codes that wipe conversation answers, plus a generation counter that discards late replies. This is BI-era logic that every screen goes through.
- External links: `openExternal(url)` only opens https links on the partner allowlist. In a browser, `reserveTab()` opens a blank tab inside the click before the engine is asked, because browsers block tabs opened after a wait.
- Engine status: `onEngineStatus` pushes `starting / ready / failed / stopping / stopped`.

### Hosted web vs local vs companion

| | Desktop / local web | Hosted web (experimental, off unless `--hosted`) | Companion |
|---|---|---|---|
| Code | `app/renderer/*` | `app/hosted/*` for sign-in, then the same `app/renderer/*` with `<meta name="chausar-mode" content="hosted">` injected by `platform/runtime/hosted/server.ts` | `app/companion/*`, its own UI |
| Sign-in | None (Electron) or pairing token | Email link or passkey, no passwords | Pairing code (`DEMO-COMPANION` in preview) |
| Key custody | OS key store, passphrase fallback | Server holds the vault key under the account | n/a |
| Differences in the UI | Full rail + "Back office" group | No back office, no custody panel, keeps the old "Keep it safe" screen, onboarding is still idea first then AI inside the vault | Briefs, chat with receipts, uploads, approvals, activity, device |
| State | Real engine | Written and tested on one computer, never deployed | Synthetic controller only; live bootstrap not wired; native never built |

---

## 2. Every screen and flow that exists

"Real" means the screen calls engine methods that do the thing in the local vault. "Labelled" means the engine says it is planned or synthetic and the screen shows that.

### Onboarding, "look B" (launch.js lines 344 to 1800)

A split page: reading words on the left, a decorative live preview of the business on the right (shapes, a card, a mock website). Five progress segments: AI, Idea, Plan, Accept, Build.

| Step | Function | Engine | State |
|---|---|---|---|
| Connect an AI | `showConnect`, `aiRow`, `pairPanel`, `lunaPanel`, `cliPanel` | `venture.ai.options/connect/status` | Real. Anthropic pair (Haiku 5.5 fast + Sonnet 5.5 main), OpenAI key (GPT-6 Luna), Claude Code (behind a terms gate), Codex. "Sign in with ChatGPT" is labelled "Not open yet". Keys live in engine memory only. |
| Open box | `showOpenBox` | `venture.countries`, `venture.compose.decide` | Real model call (quick tier) that classifies the sentence and picks 2 to 4 views. |
| Working, then the plan | `showWorking`, `showComposedPlan`, `viewNode` | `venture.compose.fill/get/update` | Real model call (main tier). Code checks every block; refusals get "Chausar can't plan this one" or "There's no plan to show". |
| No AI path | `useBuiltIn`, `showTemplatePlan`, `showTemplatePrices` | `venture.preview` | Real built-in templates, labelled "Written from built-in templates, not by AI." |
| Prices | `showPrices` | `venture.compose.update` | Typed text goes to the engine as typed. No totals before the vault. |
| Keep it | `keepSilently`, `showChoosePassphrase`, `showHostedKeepSafe` | `workspace.create`, `venture.create`, `venture.price.quote` | Real. No passphrase where the OS has protected storage (qualified on the Windows key store). Passphrase + recovery code shown once otherwise. Hosted keeps a "Keep it safe" screen. |
| Accept, then Build | `showOwnedPlan`, `showBuildStep` | `venture.blueprint.accept`, `venture.build.*` | Real. |
| Welcome back, open by folder, recover, restore, move here | `paintWelcome`, `showOpenByFolder`, `showRecover`, `showRestoreBackup`, `showMoveHere` | `workspace.list/open/recover/backups.*/transfer.import` | Real. |
| Pairing (browser) | `pairing` | `workspace.status` | Real. |

### The seven places (launch.js lines 2683 to 3565)

| Place | Render function | What is there | State |
|---|---|---|---|
| Today | `renderToday` | Date line, "Awaiting you" rows, three money figures (billed, received, earned) that open receipts, checklist "6 of 12" as squares, "Earlier" fold | Real |
| Your business | `renderBusiness` → `paintPlan`, `planBody` | Plan with "told by you / assumption / computed" labels, price receipts, change plan, tax invoice details, rewrite with AI, accept by digest | Real |
| Build | `renderBuild` → `buildBody`, `followForm`, `followStatus` | Brief, Open in Lovable / Replit (real handoff link), Bolt and v0 by copy, follow a GitHub repo read only | Real (GitHub read is fixture-tested) |
| Clients | `renderClients`, `orderRow`, `filesPart`, `openOrderSheet`, `openInvoiceSheet` | Clients, orders, up to ten files per order, draft a reply, mark delivered, prepare/issue invoice, record a payment | Real, in local vault storage that is labelled experimental ("don't issue real invoices yet") |
| Agents | `renderAgents`, `paintRehearsal`, `ladderNodes`, `openRunSheet`, `paintImprove` | Rehearsal on three made-up clients with a judge, the launch ladder, draft review (accept / edit / reject), harness turns with tools, agent questions, work receipts and reconciliations, heavy-work briefs handed to the owner's own Claude Code or Codex, the improvement loop | Real for rehearsal, shadow and approve-each. "Approve a sample" and "auto with spot checks" are labelled planned. Work products exist only for bookkeeping. |
| Money | `renderMoney` | Books figures by period with receipts, open invoices | Real. No payment rails: "Clients pay through ... links on your site, and you record each payment here." |
| Connections | `renderConnections`, `connectorCard` | 64 connector cards with chips | Mostly labelled. Available today: handoff to Lovable, Replit, Bolt, v0, mail app; read of GitHub, Tally, Chausar CRM, Chausar books; write only to Chausar CRM and books. Everything else is "planned". |
| Add your AI (sheet) | `openAiSheet` | Presets cheapest first, consent text word for word | Real |
| Trust (custody) | `custodyPanel`, `paintCustody` | Passphrase on/off, recovery code, automatic backups, restore, move to another computer | Real; mounted at the top of the back office Trust page, not on hosted |

### Back office (app.js, light theme only, BI era)

Twelve views behind a "Back office" fold in the rail: Conversation, Daily brief, Sources, Dictionary, Memory, Decisions (with a decision journal), Actions, Jobs, Trust & access, Models, Plugins & tools, Activity. All call real engine methods. Several edit raw JSON in a textarea (Dictionary draft, Memory corrections, plugin manifests) and many offer "View exact engine record" JSON. On hosted the whole group is hidden.

### The journey in the architecture vs the screens

`CHAUSAR-ARCHITECTURE-B2C.md` lists nine steps: Idea, Plan, Keep it, Build, Connect, Add your AI, Rehearse, Launch, Run. On desktop the code now runs AI first (onboarding v2, 18 October), so the architecture's order is out of date for desktop and still true for hosted. There is no place called Rehearse, Launch, Run or Books: rehearse and launch live inside Agents, run is spread across Clients and Agents, books are Money.

---

## 3. The design system as built

There are three, layered in one stylesheet.

| | Back office | Launch places ("quiet") | Onboarding ("look B") |
|---|---|---|---|
| Tokens | `--paper #f7f6f1`, `--ink #252e2b`, `--green #214c3d`, `--gold #a77636`, `--danger` | `--l-bg`, `--l-fg`, `--l-fg2`, `--l-mute`, `--l-line`, `--l-line2`, `--l-cha`, `--l-warn`, `--l-red` | About 25 `--ob-*` tokens, plus timing tokens `--ob-t1..t5` (120 to 400 ms) and `--ob-ease` |
| Type | Inter / Segoe UI; Georgia serif headings in modals and setup | system-ui; `ui-monospace` for the wordmark and figures ("INR 0.00") | Segoe UI Variable Display, heavy weights (700 to 760), mono labels |
| Colour | Paper, green, gold | Ink and grey; dark accent `#46f09b` | Green field, orange shapes, cards, pills, shadows |
| Dark mode | None | Follows the computer on launch pages and sheets | Light and dark, plus a `data-theme` override |
| Motion | 0.2 s menu slide | 120 ms buttons, 200 ms sheet, once | Fill, rise, nudge, swap, slot, settle, badge; each once, never over 400 ms |

Shared: `prefers-reduced-motion` turns motion to 0, `prefers-contrast:more` strengthens hairlines in the launch styles, `:focus-visible` rings everywhere, `color-scheme: light dark` in `index.html`. The stylesheet has 232 distinct hex colours.

The 1 October design spec (`D:\claude\chausar-2\docs\superpowers\designs\2026-10-01-chausar-app-frontend.md`) asked for Instrument Sans, DM Mono and IBM Plex Mono bundled locally, nine "squares", an ask line on every screen, charts, three views (Simple, Guided, Books) and Hindi. On `main` only the squares, the quiet rows, sheets on the right and the words-at-rest rule made it in. Fonts, ask line, charts, three views and Hindi exist only on the unmerged React branch.

---

## 4. Problems

### Code structure

- **One closure of 3,792 lines.** `launch.js` is a single `create(kit)` with module-level mutable variables (`openSheet`, `lastActor`, `sheetOpener`, `ownerZone`, onboarding state) shared by about 207 inner functions. Nothing can be imported or tested on its own.
- **`app.js` is written like minified code.** 64 lines are over 400 characters, the longest 3,274. `renderShell` is one line. Diffs and reviews are close to impossible.
- **Two-file coupling through a 35-item kit.** `launch.js` depends on `app.js` helpers and on the shared `state` object, and `app.js` reaches back into `launch.pages`, `launch.views` and `launch.custodyPanel`. Neither file stands alone.
- **Contract lists are copied, not imported.** `EXTERNAL_ORIGINS` lives in three places (`contracts.ts`, `ipc-contract.cjs`, `app.js`); `INDIA_STATES`, custody words, view registries, AI rows and chips are copied into `launch.js` (`copies`). Tests keep them equal, but a rework has to keep doing that or import them properly.
- **Three style systems in one file**, overriding each other through `.shell.launch` and `:root:has(.ob-root)` cascades.
- **Back office carries BI-era machinery** (evidence generations, continuation selection, synthesis previews) inside the shared `request()` that every B2C screen also goes through.
- **Transport is hard-wired per host.** The Electron protocol (`main.cjs`) and the hosted server (`server.ts`, lines 21 to 28) each serve a fixed list of four files. Any new file, chunk or font must be added to both and to the packager.

### Consistency

- Onboarding is bold and graphic (cards, pills, colour blocks, big shapes). The places are quiet ink and grey. The workspace menu and back office are the old paper-and-green look with Georgia serif headings and boxed buttons. Moving from Plan to Today to the workspace menu crosses all three.
- The workspace menu offers four overlapping safety actions: "Back up vault", "Export encrypted workspace", "Encrypted archive", "Backups and lock", next to "Close this business" and "Delete this vault".
- Words drift: "workspace" vs "business" vs "vault"; the page title is still "Chausar · Know your business" and the rail says "Always know." and "Experimental · checked capabilities inside".
- Desktop and hosted run different onboarding orders from the same file.
- Docs drift from code: `docs/frontend.md` says a place may hold 120 words at rest, the test says 60; its "First run" section still describes idea first.

### Accessibility

Good: native `<dialog>` with focus return to the opener, `aria-live` status lines, reduced motion, higher contrast, decorative shapes `aria-hidden`, state never shown by colour alone, 44 pt targets on native companion.

Weak:
- The back office uses 8 to 11 px text in many places (27 rules at 10 px, 13 at 9 px, one at 8 px).
- Sheets open with `showModal()`, so the list behind is inert. The design promise "the list stays usable beside the sheet" isn't what happens.
- A lot sits behind `<details>` folds and "›" links, which hides content from people who don't know to open them.
- No language switch and no Hindi on `main`.
- No browser accessibility audit is recorded. `docs/frontend.md` says browser visual checks of the back office "remain unverified".

### Things that will block a rework

- **Tests read source text.** `platform/tests/launch-renderer-harness.ts` loads exactly `app/renderer/app.js`, `launch.js`, `styles.css`, `index.html` and `preload.cjs` into a `vm` context with a fake DOM. House-rule tests slice the CSS from the `/* launch` comment, find `const INDIA_STATES` by string search, ban words and characters in `launch.js`, require it to be a classic script, and look for class names such as `launch-row`, `launch-btn`, `launch-row-label`, `footer-note`, `ob-root`. A new file layout or framework breaks roughly 3,500 lines of renderer tests even when behaviour is unchanged.
- **CSP forbids inline styles** (`style-src 'self'`), and a test bans `.style` and `style=` in `launch.js`. CSS-in-JS libraries and many component kits won't work without changing the CSP. Plain CSS files, CSS Modules or Tailwind built to a file are fine.
- **No build pipeline.** A framework means adding a bundler, a build step to `scripts/build.mjs`, the packager (`app/desktop/builder.json`) and both file allowlists.
- **Words-at-rest budgets are pinned per place** (Today 50, Business 52, Build 55, Clients 20, Agents 56, Money 57, Connections 31; 60 ceiling) and per onboarding screen, counted on the fake DOM.

### Where the UI says more than the code does

The engine labels are honest and tested. The overstatements are in the chrome and the decoration:

- The onboarding preview draws a website card with "Home, Plans and prices, How it works, Book a call" before any site exists. It is a picture of a plan, but it reads like a built site.
- "Experimental · checked capabilities inside" and "Your vault. Your rules." in the rail are slogans, not facts the screen checks.
- The back office footer always says "Every result comes from your local engine."
- Money and Clients look like a working back office, but storage is the experimental file vault (a notice says so on Money and invoices, not on Clients or Today).
- 64 connector cards make the catalogue look large; 9 connectors have any working mode, and 2 of those are Chausar's own CRM and books.
- The back office `amount()` and `toMinor()` in `app.js` parse and format money with `BigInt`. The "the screen never does money arithmetic" rule is only enforced on `launch.js`.

---

## 5. What a rework must keep

### Contracts

- The preload API: `window.chausar.request(method, payload)`, `openExternal(url)`, `onEngineStatus(cb)`, with coded errors (`error.code`, `error.message`, sometimes `error.reason`).
- The IPC allowlist and validator in `app/desktop/ipc-contract.cjs`: method names, JSON-only payloads, 2 MB limit, the trusted document `chausar://app/index.html`, the partner origin list (must match `platform/runtime/venture/contracts.ts`).
- Web transport: `POST /api/rpc` with a bearer token; the pairing fragment `#token=` read once and removed from history; hosted session from `/api/hosted/session`.
- Engine contracts the screens copy: `platform/runtime/venture/contracts.ts`, `onboarding-contracts.ts`, `workspace-custody-contracts.ts` (`CUSTODY_WORDS`).
- Timeout behaviour: on `REQUEST_TIMEOUT`, rehearsal and approvals re-read the stored result instead of failing.

### Invariants (each has a test today)

- Engine values become text nodes only. No `innerHTML`, `outerHTML`, `eval`, `new Function`, `document.write`.
- No browser storage. Keys, passphrases, GitHub tokens and recovery codes go in password fields outside any form, `autocomplete="off"`, sent from a button, cleared in `finally`, shown at most once.
- The screen never computes money: every amount is the engine's display string, every typed amount goes as typed.
- Every figure opens its receipt; plans are accepted and changes adopted by digest; approvals show the exact payload before it is sent once.
- Honest labels: "told by you / assumption / computed" on every plan line; `handoff / read / write / planned` chips (a planned chip has no button); "AI answers here come from a synthetic recording" in demo; "Practice draft. Not for the client."; "Template outline. No AI wrote this..."; the experimental storage notice; "Accept" only when every check passed.
- External links only through the allowlist, a blank tab reserved inside the click, a builder marked opened only after the link opened or the copy worked.
- Still outlines and one line of words instead of spinners; nothing loops; motion once, 400 ms max; zero under reduced motion; light and dark.
- One filled button per place; words-at-rest budgets.

### Tests that pin UI behaviour

| File | Lines | Pins |
|---|---|---|
| `platform/tests/venture-launch-renderer.test.ts` | 1,341 | Seven places, house rules, word budgets, harness, money, build handoff |
| `platform/tests/venture-onboarding-renderer.test.ts` | 1,137 | Connect, open box, plan, prices, keep, Welcome back, look B tokens, motion |
| `platform/tests/launch-renderer-harness.ts` | 508 | The fake DOM and fake engine from `platform/tests/fixtures/venture/renderer/` (`results.ts`, `onboarding.ts`, `custody.ts`) |
| `platform/tests/custody-renderer.test.ts` | 218 | Passphrase switch, recovery code, backups, move |
| `platform/tests/venture-shell.test.ts` | 219 | External link rules, clipboard permission, preload |
| `platform/tests/desktop-renderer.test.ts` | 628 | Back office conversation and calculator through the real preload and worker |
| `platform/tests/decision-journal-renderer.test.ts`, `conversation-synthesis-renderer.test.ts`, `definition-disclosure-renderer.test.ts` | ~700 | Back office screens |
| `platform/tests/desktop-ipc-methods.test.ts`, `desktop-main.test.ts`, `desktop-harness.test.ts`, `hosted-server.test.ts` | ~750 | IPC allowlist, Electron main, engine harness, hosted serving |
| `platform/tests/phone-*.test.ts` | ~1,600 | Companion |

The fixtures and the behaviour assertions are the valuable part. The source-text checks (class names, file slices, banned strings in one file) should be rewritten against the new structure rather than kept as they are.

### Worth reusing from the unmerged React branch

`origin/claude/lane-reports-tools-trust` (and its siblings, split from `main` on 2 October) has `app/ui/`: React 19, strict TypeScript, CSS Modules, a token set matching the 1 October spec, bundled fonts (Instrument Sans, DM Mono, IBM Plex Mono, Noto Sans Devanagari), `en.json` / `hi.json` text catalogues, parts (Row, Sheet, Figure, Stat, Steps, TimeLine), and charts whose geometry is computed from exact `BigInt` values (`charts/scale.ts`). It was never wired into the renderer and it targets the BI product, not B2C, but its tokens, parts and receipt rules ("every known figure opens its receipt", "missing is words") fit the rework.
