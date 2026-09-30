# Feature qualification and registered product methods

This checkout implements the local companion and preserves a separate enterprise service profile. The supplied architecture and ten-day plan are the target specification. Code, a catalog entry, or an earlier build's evidence does not establish customer support.

The qualification levels below apply to the exact boundary named in each row:

- **Verified locally:** deterministic fixtures exercised the installed application code, including public engine acceptance tests where indicated. Transport mocks establish enforcement at the application boundary, not a live account or device.
- **Experimental:** the implementation is runnable when its stated dependency is supplied, but independent businesses, live services, devices, or release qualification remain outstanding.
- **Planned:** the required operating service or connector is absent. The product refuses unsupported capabilities instead of inventing data or a successful effect.

`node --test platform/tests/*.test.ts` runs the public fixtures. `node scripts/check.mjs` checks source syntax and JSON. Native Node TypeScript execution is not a strict static typecheck; `npm run typecheck` additionally requires the pinned TypeScript package. The current environment has not qualified real providers, a production PostgreSQL deployment, Cube/Temporal execution, an installer, or browser interactions. The historical enterprise acceptance count is not part of this build's score. An independently held hidden and sealed test set remains a release requirement from the plan.

## 1. Desktop, vault, identity and release

| Registered boundary | Implemented behavior | Qualification and limits |
|---|---|---|
| `workspace.status`, `workspace.create`, `workspace.open`, `workspace.lock`, `workspace.recover`, `workspace.restore` | Named local workspaces, passphrase and recovery-kit custody, encrypted persistence, lock/unlock and guarded restore | Verified locally with the experimental file adapter. Production requires configured loopback PostgreSQL; PostgreSQL installation is not bundled. OS keychain custody and second-machine recovery are unqualified. |
| `workspace.backup`, `workspace.export`, `workspace.delete` | Encrypted managed backups; explicit authorized export; typed-name deletion and managed-copy cleanup | Verified locally. Copies taken outside the application are the owner's responsibility. Local deletion cannot erase a provider's past transmission. |
| `auth.invite`, `auth.accept`, `auth.session`, `auth.revoke`, `auth.sessions` | Digest-bound invitations, current membership/epoch checks and revocable sessions | Verified locally; an enterprise SSO/provisioning service is planned. Possession of an old session does not bypass current permissions. |
| Desktop renderer and isolated engine | Named IPC/HTTP requests; renderer text nodes; no direct renderer vault/key access | Source and engine/HTTP behavior verified locally. Browser launch was denied by automatic review, so visual and click-path checks remain unverified. Electron packaging and clean-account installation are experimental. |
| `updates.status`, `updates.verify`, `updates.stage` | Manifest schema, artifact hash/signature, platform/version checks and guarded staging | Verifier tests are local. No publisher certificate, signed installer, public update channel, or installed old-to-new update has been qualified. |

Evidence: `vault.test.ts`, `auth.test.ts`, `server.test.ts`, `updater.test.ts`, and public `acceptance.test.ts`. See [vault.md](vault.md), [frontend.md](frontend.md), [releases.md](releases.md), and [files.md](files.md).

## 2. Business dictionary, sources and memory

| Registered methods | Implemented behavior | Qualification and limits |
|---|---|---|
| `ontology.packs`, `ontology.get`, `ontology.publish` | Six distinct packs: online brand, retail, services, distributor, manufacturing and SaaS. Atomic versioned publication produces typed fields, checks and a closed calculation catalog. Definitions state recognition and null rules. | Verified locally against separate hand-worked fixtures; customer-specific accounting definitions require review. Packs do not certify an industry's books. |
| `sources.preview`, `sources.import`, `sources.list`, `sources.delete` | Quoted CSV parsing, typed data-only bindings, company/branch/currency/date scope, unknown-field coverage, explicit null handling and source control-total reconciliation. A mismatched or cut-short export cannot commit. Duplicate imports are idempotent. | Canonical CSV path verified locally. Vendor export parsers for Tally XML, Zoho JSON, GSTR-2B JSON, bank CSV and Shopify JSON remain experimental pending independent installations/businesses. Bank opening/running/closing balances and explicitly classified Tally ledgers are checked. Bank movements do not silently become revenue or costs. |
| `sources.workbook`, `sources.workbookPreview`, `sources.workbookImport` | Bounded native XLSX values extraction, selected-sheet conversion and the same reconciled import path | Workbook fixtures verify the installed reader. Formula/external-link/active content is refused. Arbitrary legacy XLS layouts and named vendor Excel reports are unqualified. The separate optional `ImportService.previewWorkbook` adapter refuses if its XLSX package is absent. |
| `sources.catalogue`, `sources.fetch`, `sources.recipe`, `sources.accept` | Fifty-system coverage catalog; bounded native Tally loopback XML and Zoho read adapters; evidence-backed data-only recipe proposals requiring reviewed resolutions | Application behavior is fixture-tested; no live Tally or Zoho account was accessed. Other named native integrations and all vendor writes are planned. A listed system does not inherit CSV or live-integration support. |
| `memory.list`, `memory.correct`, `memory.precedence` | Immutable source versions, happened-on/learned-on clocks, past-known views and explicit whole-record conflict precedence | Verified locally. Backdated learned-on times are limited to a labelled demo workspace. Unresolved claims stay excluded with a coverage warning. |
| `memory.merge`, `memory.undo` | Reversible customer aliases and conservative stale marking on dependent answers | Verified locally. Exact reviewed GST/PAN matching suggestions exist as a service method but are not an automatic merge or registered UI command. A phone, name or email is insufficient evidence. |

Evidence: `business-engine.test.ts`, `workbook.test.ts`, `connectors.test.ts`, and public `acceptance.test.ts`. See [connectors.md](connectors.md).

## 3. Calculations, receipts and decisions

| Registered methods | Implemented behavior | Qualification and limits |
|---|---|---|
| `calculation.run`, `conversation.ask`, `dashboard.get`, `receipts.get` | Exact BigInt minor-unit arithmetic; explicit periods and known-on time; current branch/source access; source rows, definitions, hashes, exclusions and coverage on every receipt. Unknown operations or questions abstain. A number guard rejects unsupported numerical explanations. Saved receipts are private to the originating membership epoch and are reauthorized. | Hand-worked local and public engine fixtures verified. Production additionally requires the isolated SQL verifier before receipt persistence; absence or disagreement refuses the result. Live DuckDB/PostgreSQL qualification is separate from arithmetic fixture success. |
| Generated calculation IDs | `billed`, `received`, `earned`, `revenue`, `refunds`, `costs`, `purchases`, `net_sales`, `margin`, `aging`, `change`, `scenario` plus published simple owner measures | Catalog depends on the dictionary. Billed, received and earned count different events. Margin includes imported costs only. Aging needs invoice/customer links and explicit due dates. Change is measured difference, not an invented cause. Scenarios hold volume constant and change assumptions, never source facts. Percentage calculations explicitly truncate basis points. |
| `decisions.create`, `decisions.list`, `decisions.review` | Decisions, hypotheses, evidence receipts, review dates and appended review outcomes | Verified locally. Hypotheses remain labelled text; a decision is not proof that an action happened or produced its desired outcome. |
| `reports.get`, `reports.brief` | Receipt-linked lender/investor/accountant review annexes, coverage gaps, due decisions and a published human-reviewed compliance calendar when one exists | Verified local drafts. These are not audited accounts, a certified bank application, tax filing, or delivered mail. Absent calendar dates are not guessed. Email/WhatsApp delivery remains planned pending approved registered transports. |
| `reports.forecast` | Exact monthly receipt lineage, consecutive history checks and a rolling held-out trend-versus-last-month comparison | Local gate verified; forecasting remains experimental. The candidate is refused unless it beats its stated baseline. Seasonality, uncertainty and customer forecasting performance are unqualified. |
| `helpers.run` | Named subprocess analytical-helper entrypoint with declared resource/time/input limits | Helper validation is separate from receipt-backed product calculations. Operator-supplied Python/dependency installation, PDF layouts, forecasting quality and operating-system process isolation require qualification; a helper result cannot replace a published verified calculation. |

Evidence: `business-engine.test.ts` and public `acceptance.test.ts`. The public fixture hand calculates earned INR 2,050.00, refunds INR 125.00, net sales INR 1,925.00 and contribution INR 1,345.00. See [acceptance.md](acceptance.md).

## 4. Model connection, disclosure, speech and learning

| Registered methods | Implemented behavior | Qualification and limits |
|---|---|---|
| `models.list`, `models.configure`, `models.preview`, `models.approve`, `models.test` and model-backed `conversation.ask` | Installed Codex then Claude routes, API Responses/compatible routes, local Ollama and explicit managed-service configuration. Strict analytical plans, exact outbound previews, single attempts, current grants and exact payload receipts. | Mock transports and CLI launch arguments verified. Installed CLI versions, actual accounts/provider quality and a managed allowance service are experimental or absent. CLI receipts observe application stdin, not the provider's hidden payload. Subscription token files are never read. |
| `speech.list`, `speech.configure`, `speech.preview`, `speech.approve`, `speech.transcribe` | Separate transcript, installed local-command and approved recorded-audio upload paths | Privacy and transport fixtures verified. Browser recognition is not certified offline; installed speech binaries and audio accuracy are unqualified. Paid realtime voice sessions are planned. |
| `trust.get`, `trust.update`, `members.list`, `members.add`, `members.revoke` | Enforced role/epoch/source/branch policy, nothing/shape/samples disclosure, retention, autonomy and source deletion | Verified locally, including old-receipt revocation. Enterprise identity and lifecycle operational qualification remain outstanding. |
| `learning.list`, `learning.log`, `learning.preview`, `learning.consent`, `learning.sharing`, `learning.share` | Local mapping/identity/action decision records, sharing off by default, typed structure-only preview and exact consent | Preview/consent/enforcement verified locally. A real hosted intake, qualified private mapping corpus, credits and trained models are planned. Sharing needs an explicitly registered transport; values cannot be smuggled through free-text reasons. |
| `activity.list` | Authorized audit events and model-disclosure receipts | Verified locally. Activity access does not grant source access. |

Evidence: `gateway.test.ts`, `speech.test.ts`, `workflows-plugins-learning-mcp.test.ts`, `business-engine.test.ts`, and public `acceptance.test.ts`. See [model-routes.md](model-routes.md).

## 5. Actions, jobs and collaboration

| Registered methods | Implemented behavior | Qualification and limits |
|---|---|---|
| `actions.list`, `actions.catalogue`, `actions.prepare`, `actions.approve`, `actions.revise`, `actions.execute`, `actions.reconcile` | Exact payload/hash approval, stable effect key, prepared/approved/executing/unknown/reconciled states, current authorization and actual adapter readback | Lifecycle fixtures verified, including uncertain outcomes. The installed product adapter creates a local payment-reminder **draft**. It does not send mail, collect money, edit stock/prices, or write to Tally/Zoho. External write adapters are planned. |
| `jobs.list`, `jobs.create`, `jobs.approve`, `jobs.pause`, `jobs.resume`, `jobs.run`, `jobs.accept`, `jobs.reject` | Owner-bound budgeted mandates, finite stop rules, leasing, schedules and explicit deliverable acceptance | Lifecycle fixtures verified. The installed engine runner accepts only explicit `owner-brief` jobs and returns a local brief. An arbitrary autonomous business workflow and an always-on hosted worker are planned. |
| `sync.status`, `sync.identity`, `sync.enable`, `sync.trust`, `sync.preview`, `sync.approve`, `sync.push`, `sync.pull` | Signed encrypted single-writer snapshots, exact ciphertext approval, transport lease/fencing, hash-chain verification and separate staged restore | Experimental protocol with local transport fixtures. No live second-device or Google Drive integration is qualified. Multi-writer mode is refused; pulling does not silently replace current authority. |

Evidence: `workflows-actions.test.ts`, `workflows-jobs.test.ts`, `sync.test.ts`, and public `acceptance.test.ts`. See [sync.md](sync.md).

## 6. Plugins, other assistants, phone and enterprise

| Registered methods / component | Implemented behavior | Qualification and limits |
|---|---|---|
| `plugins.list`, `plugins.install`, `plugins.enable`, `plugins.disable`, `plugins.remove`, `plugins.run`, `plugins.miniapp` | Digest-approved WebAssembly modules, declared capabilities and bounded execution; a deterministic receipt-linked mini-app descriptor | Local approved-WASM/denied-host tests verified. Arbitrary code/host modules/network/key access is refused. Generated arbitrary applications, a plugin marketplace and a general phone app are planned. |
| `mcp.info`, `mcp.handle` | Read-only registered `calculate` tool and authorized receipt resource; exact scalar result must come from the verified receipt | Public MCP fixtures verified. No arbitrary query, raw source dump, model number, or mutation tool is exposed. Additional client interoperability is experimental until tested. |
| Phone/email/WhatsApp | Channel labels and simple approval boundaries are represented in contracts | A deployed relay, Meta templates, mail transport and phone install are planned. There is no general WhatsApp assistant or completed phone app. |
| `enterprise/platform` and `enterprise/architecture/contracts` | Recovered separate PostgreSQL authority, scoped Cube source adapter, Temporal workflows, strict natural-language gateway and Python semantic validator | Source syntax/relative references checked in this checkout. Historical connected checks are not rerun evidence. Current PostgreSQL guard executed zero database checks without its disposable environment; Cube/Temporal/live model/deployment qualification remains outstanding. |

Evidence: `workflows-plugins-learning-mcp.test.ts`, public `acceptance.test.ts`, and [enterprise.md](enterprise.md). The original 33-check claim belongs to the recovered source profile only; original evidence/runtime data are deliberately excluded from the product tree.

## Release gates still required by the supplied plan

Independent unseen businesses and separately held hidden/sealed tests must qualify the promised connector/pack subset. A clean stranger installation must demonstrate first answer, recovery and a signed old-to-new update on each claimed operating system. Production database and analytical engines need fresh service evidence, not only simulated interfaces. Real provider routes require current vendor-version/account tests. External actions need registered write/readback adapters and controlled test accounts. Phone delivery, regulated bank data, GST-provider writes, hosted jobs, SSO and enterprise rollout require their actual services and operating controls. Until those gates pass, publish a preview with this qualification list.
