# Desktop workspace renderer

The renderer is a standalone HTML/CSS/JavaScript application. It requires no framework, package installation, CDN, web font, or internet connection. `app/renderer/index.html` loads only the local stylesheet, module, and SVG icon. The desktop host supplies `window.chausar.request(method, payload)`. The local browser uses the startup pairing link `/#token=<code>` or a manually pasted session code, verifies it with `workspace.status`, and makes authenticated JSON requests to `POST /api/rpc`. It never discovers a credential through an anonymous session request.

The screen creates DOM nodes and renders every engine value with text nodes or `textContent`. Source records, model replies, plugin records, and report HTML are never inserted as trusted markup. HTML review packs are offered as an explicit file download. The CSP forbids inline script, plugins, object embeds, and arbitrary network requests.

## Workspace entry

- Browser pairing accepts the 64-character hexadecimal owner bootstrap code or a 43-character base64url member session code. A pasted full pairing link must have this engine's origin and exactly one token fragment. Startup fragments are removed from browser history immediately; credentials remain only in memory, never browser storage. Refreshing the page requires pairing again. The Electron bridge requires no browser pairing.
- Create a named vault with a short folder ID and passphrase, or unlock an existing folder. The passphrase stays in the current input and local request only; it is cleared after use.
- Including the sample business is an explicit labelled choice. Every sample workspace retains its label in the sidebar, top bar, and brief.
- Display the one-time recovery kit in a blocking native dialog, offer copy and save, and require an acknowledgement before entering the workspace.
- Expose encrypted backup/export, locking, and typed-name deletion from the workspace menu. Locking clears in-memory conversation state. Deletion explains that the vault and managed backup/export copies are removed while external copies remain the owner's responsibility. Recovery accepts the saved kit; restore accepts only a managed `.backup` filename and a new workspace folder.
- Keep engine/storage errors visible. The renderer cannot make PostgreSQL, keychain custody, or an unavailable production capability appear to work.

## Launch

`app/renderer/launch.js` adds the start-a-business screens beside the twelve original views. It is a classic deferred script that `index.html` loads before the `app.js` module. It defines one frozen `ChausarLaunch` factory and touches nothing until `app.js` calls `create(kit)` with its own helpers (`h`, `request`, `navigate`, `renderShell`, `renderSetup`, `showRecoveryKit`, `openExternal`, `reserveTab`, `saveText`, `state` and the rest). Without `launch.js`, `app.js` behaves exactly as before. The package page is [venture/launch.md](venture/launch.md).


### Keeping the business safe on this computer (launch.js)

- **Start.** `firstRun` resumes a held draft or a connected draft AI; otherwise it reads `workspace.list`. One business that opens with this computer, not closed by its owner (`workspace.status.closedByOwner`), opens with `workspace.open { folder }`; otherwise Welcome back lists them (name, chip, Open; a passphrase row opens its own field). `openExisting` is what app.js calls after "Close this business".
- **Trust & access.** `custodyPanel()` is mounted at the top of Trust & access by app.js (not on hosted), and `openCustodySheet()` opens the same panel from the workspace menu ("Backups and lock"). It reads `workspace.custody.get` and `workspace.backups.list` and calls `workspace.custody.passphraseOn`, `passphraseOff`, `recoveryCode`, `workspace.backups.create`, `workspace.backups.restore { file, confirmed: true }` and `workspace.transfer.export`. A code is shown once (the recovery code screen, or the move code in chunks of four) and kept nowhere; every passphrase field is cleared after each send.
- **The live preview.** `obFrame(step, content, { preview })` draws the right pane from a preview of words: `planPreview`, `templatePreview` and `blueprintPreview` build it from engine answers, and `card.setPreview`, `setPrices` and `setLine` update it as prices and receipts come back or the owner types. Prices are the engine's display strings or the owner's own text, never worked out. Classes `ob-ckind`, `ob-coffers`, `ob-coffer`, `ob-cprice`, `ob-site`, `ob-saddr`, `ob-snav`, `ob-spages`, `ob-shead`, `ob-soffers`; motion once (a row slots in, a changed price fades, the website card settles), off under reduced motion.

### First run: one question, then a plan

There is no rail, only a top bar with the wordmark and a line of steps.

1. **Idea.** "What service business do you want to start?" One textarea, an example in grey, and the country taken from the browser language ("India, prices in INR. Change"). The only requests are the boot `workspace.status` and `venture.countries`. The idea stays in memory.
2. **Plan.** `venture.preview { idea, countryCode }` draws the plan from built-in templates. Nothing is saved and no key is asked for. The owner sets a price (per month, project or hour, typed text kept as typed) and says whether they charge tax (a rate field prefilled from the preview). "Tell us more" holds the two optional questions.
3. **Keep this plan.** Since the keychain change (18 October) there is no Keep it safe screen on this computer: `workspace.create { name, pack: 'services', folder: null }` with no passphrase key, named after the plan, and the engine picks the folder and keeps the vault key with this computer's own protected storage. Only when the engine answers `DEVICE_KEYS_UNAVAILABLE` does "Choose a passphrase." show, with the engine's reason, then the recovery code once. Hosted keeps Keep it safe (a working name, server custody). Then in order: `venture.create`, `venture.interview.next { useTemplate: true }`, one `venture.interview.answer` per question (unanswered optional questions are `{ skipped: true }`), `venture.blueprint.draft { useTemplate: true }`, and `venture.price.quote` for `offer_1` when a price was typed.
4. **Your plan.** The plan in the vault with each priced offer's receipt total, tax invoice details, Change plan, Rewrite with AI (opens Add your AI when no model is connected) and Accept plan.
5. **Build.** The brief, the builders, and following the build on GitHub. "Go to your business" opens Today.

An open vault without a business resumes at the idea and skips the passphrase. A vault opened from "I already have a business in Chausar" goes to Today, or back to the idea when it has no business yet.

### The seven places

The rail lists Today, Your business, Build, Clients, Agents, Money and Connections, then one "Back office" group holding the twelve original views with their ids, titles and render functions unchanged. The group opens when a back office view is current.

| Place | Engine methods | What the owner does there |
| --- | --- | --- |
| Today | `venture.get`, `venture.delivery.list`, `venture.invoice.list`, `venture.books.summary`, `venture.events`, `receipts.get` | Sees what awaits them, the checklist as "7 of 12", the three money figures (each opens its receipt) and the last six events |
| Your business | `venture.get`, `venture.blueprint.get`, `venture.blueprint.update`, `venture.blueprint.draft`, `venture.blueprint.accept`, `venture.price.quote`, `venture.preview`, `venture.models.status` | Reads the plan with its labels, opens price receipts, sets prices and tax invoice details, changes or rewrites the plan, accepts it, reads what the business knows |
| Build | `venture.build.status`, `venture.build.brief`, `venture.build.handoff`, `venture.build.handoffOpened`, `venture.build.link`, `venture.build.sync` | Reads the brief, opens it in Lovable or Replit, copies or saves it, follows the repo read only, checks GitHub |
| Clients | `venture.client.list`, `venture.client.add`, `venture.order.list`, `venture.order.create`, `venture.receipt.get`, `venture.delivery.run`, `venture.order.deliver`, `venture.invoice.prepare`, `venture.invoice.get`, `venture.invoice.issue`, `venture.payment.record` | Adds clients and orders, drafts a reply, marks an order delivered, prepares, issues, copies and saves an invoice, records a payment |
| Agents | `venture.launch.status`, `venture.launch.advance`, `venture.simulation.scenarios`, `venture.simulation.run`, `venture.simulation.get`, `venture.delivery.playbook`, `venture.delivery.list`, `venture.delivery.approve`, `venture.delivery.review`, `venture.capabilities`, `venture.models.status` | Rehearses one practice client per request, moves up the launch ladder, approves a send, accepts, edits or rejects a draft reply, reads what agents can do today |
| Money | `venture.books.summary`, `receipts.get`, `venture.invoice.get` | Reads the books figures and their receipts, the open invoices, and goes to the back office |
| Connections | `venture.connectors.list`, `venture.build.handoff`, `venture.build.handoffOpened` | Reads each connector's chips; Open only for an available handoff, Visit site for a vendor page |
| Add your AI (a sheet) | `venture.models.presets`, `venture.models.status`, `venture.models.connect` | Picks an AI, cheapest first, after reading the consent text word for word |

### Rules the launch screens keep

- Engine values become text nodes. There is no `innerHTML`, `eval` or inline style, and a test runs the screens on a fake DOM whose `innerHTML` setter throws.
- Money on screen is always an engine `display` string. Amounts the owner types go to the engine as typed. The screens never add, round or convert an amount, and never work out a tax rate (a test checks that `launch.js` has no `parseFloat`, `toFixed` or `BigInt`).
- An API key or GitHub token is typed into a password field that is not inside a form, with `autocomplete="off"`, sent from a button and cleared in `finally`, beside the line "Chausar keeps this in memory only. If your browser offers to save it, choose Never."
- Outside links go through `openExternal(url)` in `app.js`: only `https`, no user or password, and only origins in `EXTERNAL_ORIGINS` (a copy of the contracts list, compared by a test). The desktop uses `window.chausar.openExternal`. In the browser, a link opened straight from a click (Visit site, Create a read-only key) goes through a temporary `rel="noopener noreferrer"` link. Open in Lovable or Replit must ask the engine first, and a browser blocks a tab opened after a wait without saying so, so `reserveTab()` opens an empty tab inside the click, before any request, cuts its `opener`, and says "Your browser blocked the new tab. Allow pop-ups for Chausar and try again." when the browser refuses; the link is sent to that tab once it passes the checks, and the tab is closed when the request fails or the link is refused. A builder is marked opened (`venture.build.handoffOpened`) only after the link opened or the copy worked. When a copy is refused, the card shows "Save brief" beside the error.
- Labels are the engine's own: `handoff`, `read`, `write` and `planned` chips, "told by you" and "assumption" on every plan line (each step and each approval carries its own), "planned: agent" on steps an agent can't do yet. A planned chip has no button. Every model and Build screen says when answers come from a synthetic recording. In a demo with recordings the draft reply sheet says so above the payload and the draft, and its send line reads "This is exactly what Chausar would send to {model}. In this demo a synthetic recording answers instead." Waiting lines say "from a synthetic recording" instead of naming the model.
- While slow work runs (over 100 ms), the area shows a still outline of hairlines and one line of words. Nothing spins, shimmers or pulses; the old loading spinner is now a still mark. When the desktop stops waiting (`REQUEST_TIMEOUT`), rehearsal and approvals read the stored result instead of showing a failure; other actions say "Still working. Check again in a minute."
- Each place holds at most 120 visible words at rest and one filled button (tested with the fixtures). Detail opens in a sheet on the right or in a row that opens.
- The look is quiet: type on a plain background, hairlines, ink and grey. Light uses the existing tokens. Dark follows the computer on the launch screens and sheets; the back office keeps its light look. Motion is 120 ms for a button and 200 ms for a sheet, once, and zero when the computer asks for less motion.

## Back office views and real requests

| View | Engine operations | User controls |
| --- | --- | --- |
| Conversation | `dashboard.get`, `models.list`, `conversation.ask`, `models.preview`, `models.approve`, `receipts.get` | Questions, explicit model route, exact outbound preview/approval, calculation receipts and result export |
| Daily brief | `reports.brief`, `dashboard.get`, `reports.get`, `reports.forecast` | Real calculation figures, coverage/gaps, decisions due, reviewed compliance calendar, local review packs, rolling backtests |
| Sources | `sources.list`, `sources.preview`, `sources.import`, `sources.catalogue`, `sources.fetch`, `sources.workbook`, `sources.workbookPreview`, `sources.workbookImport` | CSV file or paste, read-only XLSX sheet selection, typed field mappings, company/branch/date scope, independent amount/row totals, preview before commit, truthful connector qualification, bounded Tally/Zoho snapshot reads and structured file imports |
| Dictionary | `ontology.packs`, `ontology.get`, `ontology.publish` | Six starter packs, editable draft JSON, exact published revision and catalog |
| Memory | `memory.list`, `memory.correct`, `memory.merge`, `memory.undo` | Source lineage, happened/learned timestamps, corrections, canonical entity merges and undo |
| Decisions | `decisions.list`, `decisions.create`, `decisions.review` | Reasoning, evidence receipt IDs, hypotheses, review dates and outcomes |
| Actions | `actions.list`, `actions.catalogue`, `actions.prepare`, `actions.approve`, `actions.execute`, `actions.reconcile` | Registered connector operation, exact payload and stable effect key, digest approval, execution and readback |
| Jobs | `jobs.list`, `jobs.create`, `jobs.approve`, `jobs.pause`, `jobs.resume`, `jobs.run`, `jobs.accept` | Explicit `owner-brief` runner, purpose, INR budgets/reserves, finite stop rules, schedules, skip/latest policy, exact approval and deliverable acceptance |
| Trust and access | `trust.get`, `trust.update`, `members.list`, `members.add`, `members.revoke`, `learning.list`, `learning.preview`, `learning.consent` | Disclosure, source scope, retention, autonomy, sharing, role/branch grants, structure-only preview and exact consent |
| Models | `models.list`, `models.configure`, `models.test`, `models.preview` | Codex first, Claude second, API third, Ollama fourth; model/endpoint, limits, engine-only credentials, single tests |
| Plugins and tools | `plugins.list`, `plugins.install`, `plugins.enable`, `plugins.disable`, `plugins.run`, `mcp.info` | WASM file/base64, manifest, capability digest approval, limits, sandbox run and read-only MCP info |
| Activity | `activity.list` | Audit timeline, model disclosure receipts and export |

The direct calculation dialog uses the published operation IDs `billed`, `received`, `earned`, `revenue`, `net_sales`, `costs`, `purchases`, `refunds`, `margin`, `aging`, `change`, and `scenario`. It sends explicit periods, historical learned time, branch scope, an ageing date, comparison periods, or basis-point assumptions as applicable. The renderer formats integer minor-unit values for display and never performs business calculations.

## Accessibility and interaction

Navigation has a labelled landmark and current-page states. Forms pair visible labels with their controls. Buttons have visible names or accessible labels, keyboard focus is prominent, dialogs use native focus trapping, and notices use appropriate live/alert roles. Conversation submission supports Ctrl/Command + Enter. Mobile navigation, single-column forms, responsive cards, scrollable data tables, and reduced-motion styles support smaller screens and user preferences.

Import preview is invalidated when content, a mapping, scope, or an expected total changes. Commit is disabled until the engine accepts the exact current preview. Action, model, job, learning, and plugin approvals are deliberately separate interactions with the displayed digest/payload. Errors are returned verbatim as plain text and retained visibly in the relevant form or result.

XLSX import passes the original workbook bytes to the engine, selects a sheet explicitly, shows a bounded sample of literal cell values and every parser warning, then reuses the CSV mapping and reconciliation screen. The derived CSV display is read-only. Preview and commit both pass the original bytes, selected sheet, typed mapping, and independent expected totals to the workbook RPC methods. Formulas, macros, external links, unsupported formats, and numeric date-serial ambiguities remain engine refusals or visible warnings. The mapping screen supports up to two hundred header columns.

Jobs are labelled as the installed owner-brief runner and creation includes `type: 'owner-brief'`. The human purpose text describes the brief; the UI offers no arbitrary model/action runner.

## Qualification

`node --check app/renderer/app.js` passes. All four renderer text assets were checked to contain zero Unicode replacement characters. Pairing parser checks cover owner/member formats, same-origin links, duplicate token rejection, invalid codes, immediate fragment clearing, and the native bridge. Static checks verify that there is no anonymous session request or browser credential storage. A read-only HTTP audit of nine integrated RPC endpoints returned successful responses and the documented shapes. Twelve requested page headings are present, and a static method-name audit checks renderer RPC calls against the engine dispatcher.

Browser visual and interaction checks remain unverified: the environment's automatic approval review rejected the browser launch. No alternate launch or browser-control path was attempted. Live model endpoints, remote multi-user identity, voice hardware, signed updates, OS keychain support, and production database deployment are not established by the renderer. Its labels retain experimental/unchecked status supplied by the engine.
