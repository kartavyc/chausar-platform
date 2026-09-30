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

## Product views and real requests

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
