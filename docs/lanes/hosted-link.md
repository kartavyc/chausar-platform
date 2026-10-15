# Lane: hosted-link

Hosted services (written and tested, **not deployed**) and the phone channels. Branch `claude/lane-hosted-link`.

## What was built

### 1. The hosted service set (`hosted/`)

A Node 24 and TypeScript service set on PostgreSQL 16, with the job queue on the database, one Docker image with two roles (`api`, `worker`), a Compose file, a migration runner and a deploy guide. The contract with the desktop is `hosted/API.md`; deployment, what each part can read, and every founder step are in `hosted/DEPLOY.md`.

| Part | Folder | What it does |
|---|---|---|
| Foundation | `shared/`, `db/` | Fixed-code errors, a socket-free router with exact-key JSON checks and security headers, digit-free 48-letter tokens, keyed hashes of every bearer secret, the database port (`pg`), ordered migrations under an advisory lock (an edited applied migration is refused), and the job queue (`FOR UPDATE SKIP LOCKED`, leases, exponential backoff, dead jobs) |
| Accounts | `accounts/` | Phone OTP sign-in for desktop installs behind `OtpProvider` (Twilio SMS client, a fake, and an unconfigured provider that refuses `OTP_PROVIDER_NOT_CONFIGURED`). Six-digit codes stored hashed, five minutes, five tries, single use, rate limits; devices and sliding thirty-day sessions; device revoke |
| Billing | `billing/` | Free and paid plans, subscriptions and entitlements behind `PaymentPartner` (Razorpay subscriptions client, a fake, and an unconfigured partner that refuses `PAYMENT_PARTNER_NOT_CONFIGURED`). Signed webhooks, idempotent by event id. Price is configuration in whole paise; absent, it is "not set", never zero |
| Relay | `relay/` | Briefs and simple approvals over WhatsApp Cloud API templates, a Telegram bot, and mail (Postmark). Messages are only the fixed catalogue in `shared/templates.ts`: a headline and a link. Approve, Not now and Open the app; Approve and Not now are single use, expire in thirty minutes, count only from the opted-in number or chat, and release a sealed envelope the relay cannot read. HELP, STOP, START, free text and documents get fixed replies. Monthly budget of thirty, counted atomically. Cost per channel from a dated price table, or "unknown" |
| Link page | `link/` | `GET /l/<token>` hands over to `chausar://open/<place>`; `GET /b/<token>` shows one confirm button, `POST` decides. Plain HTML, no scripts, no data, strict CSP, `noindex`, `no-store`. A changed or old token shows "This link no longer works." |
| Backup | `backup/` | Blind storage of client-encrypted files: magic header and SHA-256 checked, quota per plan held atomically, newest versions kept, a lapsed plan's files kept thirty days. The server never receives a key |
| Allowance | `allowance/` | The model allowance proxy with provider keys on the server (Anthropic Messages and OpenAI Responses clients). Metered in paise with BigInt from a dated pricing table and an FX setting, rounded up; reserves the worst case before the call so concurrent requests cannot overspend; one attempt per request id; an unknown provider outcome keeps the reservation. Stores no prompt and no answer |
| Worker | `worker/` | The always-on jobs worker, **labelled not end-to-end encrypted on every reply**. Consent per job. The first job sends "A due date is near." from stored due dates (date only) while the computer is off, through the relay's own budget and template |
| Composition | `app.ts`, `server.ts` | Builds every module over one database and refuses to start with a short pepper or a link origin that is not https or holds a digit. `/healthz`, `/readyz` |

### 2. The desktop side (engine module `hosted-link`, `platform/runtime/hosted-link/`)

| Method | Permission | Notes |
|---|---|---|
| `hosted.status` | read | Configured, paired, plan and entitlements (cached), and the plain labels for backup, worker and relay |
| `hosted.pair.start`, `hosted.pair.finish` | admin, external | Phone OTP pairing. The session token and a new 32-byte relay sealing key live in the vault |
| `hosted.unpair` | admin | Revokes this device on the server when reachable; always forgets local credentials and voids open offers |
| `hosted.account.refresh` | read, external | Plan and entitlements |
| `phone.channels.list` | read | Merged desktop and relay view; cached with `stale: true` when the relay is out of reach |
| `phone.channels.set` | admin, external | Needs the ticked opt-in; sends the SHA-256 of the desktop's own opt-in wording |
| `phone.templates.preview` | read | The exact text of every message, button and fixed reply before the first one is sent. No digit anywhere |
| `phone.messages.counts` | read, external | This month against the budget of thirty, and the cost in paise or "unknown" |
| `phone.messages.send` | admin, external | One fixed message. With `actionId`, Approve and Not now only for a single prepared, unattempted, `reversible` action on the workspace's own `local` connector; anything else (money, outside messages, deleting, outside systems, groups) gets Open the app only with the reason. Mail never carries Approve or Not now, because a forwarded mail cannot be told apart from the owner. A retry after a lost reply reuses the same key and sealed blobs |
| `phone.relay.collect` | admin, external | Also run by `tick`. Envelopes reach only the device that made the offer; one this computer cannot open is left alone, never acknowledged away. Opens each sealed envelope and applies it only if the offer is unused and unexpired, the action is still prepared with the same digest and revision, and still eligible. Approve calls `actions.approve` with the exact digest and never executes; Not now leaves it prepared. Each outcome is audited with the channel |
| `hosted.backup.upload`, `hosted.backup.list`, `hosted.backup.restore`, `hosted.backup.exportKey` | admin / read | The core vault backup, wrapped again with AES-256-GCM under a backup key kept in the vault, uploaded blind; restore writes a file the core `workspace.restore` opens. The key can be exported once for the recovery kit |
| `hosted.allowance.status` | read, external | Balance and pricing date. `AllowanceRouteClient` is exported for the models-ext route catalogue and keeps the exact request and reply word for word |
| `hosted.allowanceCredential` | admin, external, desktop only | For models-ext `connectAllowance`: returns exactly `{ endpoint, credential, model?, budgetMinor? }`. `endpoint` is `<hosted origin>/v1/allowance/responses` (a different address from the server is refused); `credential` is an allowance-scoped token returned once and not kept (the gateway's credential store owns it); `model` is the first priced model the status lists; `budgetMinor` is the month's grant in paise as a digit string, only when the grant is set. Records the credential id with an audit line (`allowance-credential.ts`) |
| `hosted.allowanceRevoke` | admin, external, desktop only | Revokes every recorded credential id; `{ revoked, failed }`, one the server no longer knows counts as revoked |
| `hosted.worker.status`, `hosted.worker.set`, `hosted.worker.dueDates`, `hosted.worker.deleteData` | read / admin, external | The server's label verbatim; enabling needs explicit consent; due dates are date only |
| `phone.documents.register`, `phone.documents.collect`, `phone.documents.list`, `phone.documents.preview`, `phone.documents.discard` | admin, external / read / admin | PH-05 (`documents.ts`). Pairing registers a fresh X25519 public key (`register` does it on demand). `collect` (also run by `tick`) downloads each copy sealed to this device, opens and checks it, acknowledges it and holds it re-encrypted under a vault key in `<app data>/phone-documents/<workspace>/` (0600): untrusted outside data awaiting review, never imported, no facts. `list` shows the "Awaiting your review" rows without content. `preview` hands a CSV to the normal import preview (`ImportService.preview`, the code behind `sources.preview`) with `sourceTainted: true`; a PDF read as a bank statement goes to connectors-ext `imports.preview`, and a PDF or photo read as a bill to work-books `books.billRead` (round 4). It returns the normal confirm for the person to run; this lane never confirms. An imported or discarded document's file is deleted |
| `phone.verify` | read, external | `{ channel: 'mail' \| 'whatsapp' }` → `{ verified }`: mail once its confirmation link was used, WhatsApp while on for the account's verified phone. Refuses `HOSTED_NOT_PAIRED` (`relay-extras.ts`) |
| `hosted.messageStatuses` | read, external | `{ reference, messageId: string\|null }` → `[{ messageId, status, at, reference }]` from the business's own WhatsApp status callbacks, for writeback's read-back. Telegram has no delivery callbacks |
| `hosted.businessHook.set` | admin, external, desktop only | `{ appSecret }` → `{ hookUrl, verifyToken }`: registers the business's own Meta app webhook on the relay; the secret is sealed on the server and never kept on the desktop |
| `hosted.drive.connect`, `hosted.drive.status`, `hosted.drive.disconnect` | admin, external / read / admin | Creates or adopts a Drive folder (token only through the connectors-ext credential broker, `drive.file` scope), records it in the vault, and attaches `GoogleDriveSyncTransport` to the core `SyncService`; status re-attaches after the vault reopens; disconnect detaches and turns sync off (`drive-sync.ts`) |

**Installed app wiring.** `hostOptions` reads `CHAUSAR_HOSTED_ORIGIN` and `CHAUSAR_LINK_ORIGIN` (https, the link origin digit-free) and uses the platform fetch. Demo mode, or an absent or invalid origin, leaves the module unconfigured (`HOSTED_NOT_CONFIGURED`). No edit to `main.cjs` is needed.

`GoogleDriveSyncTransport` (`drive-transport.ts`) is a `SyncTransport` for the existing encrypted one-writer sync, with the `drive.file` scope and the picked file ids only. Drive has no compare-and-swap, so it writes and reads back the head and refuses `SYNC_HEAD_MISMATCH`; sync stays single-writer with hand-over. `createDriveSyncFolder` makes the folder and head file.

## How a person uses it

1. Tools, Phone (drawn by reports-tools-trust and frame-today) calls `hosted.pair.start` with the owner's mobile number and `hosted.pair.finish` with the code.
2. After paying (checkout and webhook on the server), the owner turns on WhatsApp, Telegram (the reply carries a `t.me` start link) or mail with the opt-in ticked, after reading `phone.templates.preview`.
3. When something small awaits review, the app sends "Something is ready for your review." with Approve, Not now and Open the app. A tap on the phone reaches the relay; the laptop collects it on its next tick and approves exactly that action once. Money and everything on the always-waits list only ever get Open the app.
4. Backup: `hosted.backup.upload`; on a new computer, `hosted.backup.restore` with the exported key, then the normal restore with the vault passphrase.

## Supported and experimental

| Feature | Label | Why |
|---|---|---|
| Fixed message catalogue, no digit in any body, preview before sending | **supported** | Tested end to end on synthetic data, desktop to real hosted router |
| Pairing, channel opt-in, counts against thirty, cost known or unknown | **supported** (code); service **experimental** until deployed | The hosted service is not deployed |
| Simple approvals: single use, thirty minutes, owner's number only, sealed, applied once, never executes | **supported** (code, end to end with the real relay on synthetic data); WhatsApp **experimental** | WhatsApp needs Meta verification and approved templates; Telegram needs the bot; mail needs Postmark |
| Mail address confirmation (`/v/<letters>`, a day, single use, three a day) and `phone.verify` | **supported** (code); service **experimental** until deployed | Postmark sending domain |
| Inbound mail: HELP ticket, STOP, fixed free-text reply, confirmed senders only (`/v1/webhooks/mail/:provider`, Postmark basic auth or a generic HMAC adapter) | **experimental** | Needs a Postmark inbound address and its webhook credentials (`POSTMARK_INBOUND_USER`/`PASSWORD`) |
| A business's own WhatsApp statuses for writeback (`hosted.businessHook.set`, `hosted.messageStatuses`) | **experimental** | Needs `HOSTED_API_ORIGIN` and each business pointing its own Meta app at its hook URL; Telegram has no delivery callbacks |
| Link pages | **supported** (code) | Not deployed |
| Blind backup upload and restore | **supported** (code, round trip into `workspace.restore`) | Not deployed |
| Allowance proxy and route client | **experimental** | Needs provider keys, a dated pricing table checked by a person, and the models-ext route wiring |
| Allowance credentials and the Responses endpoint for the gateway's managed route | **experimental** | Tested end to end through the core gateway on synthetic data; needs `HOSTED_API_ORIGIN`, provider keys and pricing on a deployed server. Anthropic models get no json_schema format (the Messages API takes none) |
| Always-on worker (due-date reminders) | **experimental** | Not end-to-end encrypted by design; needs deployment |
| Phone OTP accounts, billing | **experimental** | Need Twilio with DLT registration and a Razorpay account |
| Google Drive sync transport | **experimental** | Google app verification; no compare-and-swap on Drive |
| Sending a document from the phone (PH-05) | **experimental** | Sealed to the desktop key on the relay, held for review on the desktop, CSV through the normal import preview and confirm; PDF and photos are held and discarded but have no import preview yet. Needs deployment and the provider media APIs |

## Tests

`platform/tests/hosted-link-*.test.ts` (all lane tests): foundation, accounts, billing, relay (no-digit rule over every rendered body and button, budget under concurrency, replay, expiry, forwarded presses, webhooks, HELP/STOP/START), link page, backup, allowance (exact BigInt costs, concurrency, no prompt stored; credentials issued, rotated, revoked and scoped; the Responses endpoint for both providers), the allowance as a managed gateway route through the real hosted ledger, worker, the composed app end to end, the desktop module against a fake server, the Drive transport through the core `SyncService`, the desktop module against the real hosted services, and phone documents (sealing, owner only, sizes and types, per-device access, collect, preview as outside data, import only by the normal confirm). Database tests start a disposable PostgreSQL 16 (`hosted-link-pg.ts`; as root it runs the server as the `postgres` user) and skip with a reason when no server binaries exist.

## Adversarial review

An independent review traced every path a forwarded, replayed or expired button could take, the sealing, the budget and allowance races, webhook signatures, SQL, authorization and demo mode. Fixed after it: envelopes are scoped to the offering device and the desktop never acknowledges one it cannot open; large uploads are authenticated and size-checked before the body is read; superseded subscriptions are cancelled at the partner; mail carries no Approve; a press on a stopped channel decides nothing; global and per-address OTP limits; Postmark tracking off; an unset allowance grant is a state word; a 5xx is an unknown outcome on the desktop; an interrupted phone approval resumes; purge scrubs removed actions from the message log. Kept by decision: the Open the app link stays usable for seven days because it decides nothing and holds no data.

## What still needs a person (typed refusals in the code)

- Deploying anything: a host in India, domains (the link domain must hold no digit), TLS (`hosted/DEPLOY.md`).
- Twilio account and DLT registration (`OTP_PROVIDER_NOT_CONFIGURED`).
- Razorpay account, plan and webhook (`PAYMENT_PARTNER_NOT_CONFIGURED`), and the plan price (`PRICE_NOT_SET`).
- Meta business verification, the WhatsApp number and approval of the four templates; a written reading of WhatsApp's terms. Telegram bot. Postmark sending domain (`CHANNEL_NOT_CONFIGURED`).
- Provider keys and a checked, dated pricing table (`PROVIDER_NOT_CONFIGURED`, `PRICING_NOT_SET`); the per-message price table (cost shows "unknown").
- Google OAuth app verification for the Drive transport.

## Cross-lane contracts

| Method | Caller | Shape |
|---|---|---|
| `hosted.allowanceCredential` | models-ext `modelsx.connectAllowance` | `{}` → `{ endpoint, credential, model?, budgetMinor? }`; the gateway's `managed` route then speaks the OpenAI Responses format to `endpoint` with the credential. Tested end to end through the core gateway into the hosted ledger |
| `hosted.messageStatuses` | writeback WhatsApp read-back, through `host.call` | `{ reference, messageId }` → `[{ messageId, status, at, reference }]` |
| `phone.verify` | reports-tools-trust | `{ channel: 'mail' \| 'whatsapp' }` → `{ verified: boolean }` |
| `phone.channels.list` | frame-today PH-01..03 | `channels[].channel`, `channels[].desktop.enabled` (kept stable) |
| `phone.messages.counts` | frame-today | `sent`, `desktopBudget` (numbers, kept stable) |
| `actions.approve`, `workspace.backup`, `workspace.restore`, `ImportService.preview` / `sources.import` | core | Phone approvals approve only, with the exact digest; documents enter the normal import preview marked tainted |
| connectors-ext credential store and broker | Drive sync | The same sealed store and `oauth-clients.json`, `google-workspace` with `drive.file` |

### Round 4 contract: recovery through a contact (FR-13, SH-02, TR-12)

**Experimental** (supported end to end against the composed hosted app on synthetic data; it needs the deployed relay, Postmark or the two new WhatsApp templates). frame-today's `todayx.recoveryContact.request` should call, from the lock screen (all three are `preVault`, desktop only, refusing in demo mode):

1. `hosted.recovery.request` `{ folder? }` → `{ requestId, status: 'waiting', expiresAt, contactChannel: 'mail' | 'whatsapp' }`.
2. `hosted.recovery.check` `{ requestId, folder? }` → `{ requestId, status, expiresAt?, failure? }`; poll about once a second. `status` is `waiting | confirmed | declined | expired | failed | released`, and after step 3 `recovering`, then `recovered` (the workspace is open). While the vault transition runs, every request, this one too, may be refused `VAULT_BUSY`: keep polling. A recovery that failed after the key was fetched reads `confirmed` with `failure` (a code) and step 3 may be retried for fifteen minutes; `failure: 'RECOVERY_CODE_REJECTED'` means the enrolled code does not open this vault.
3. `hosted.recovery.complete` `{ requestId, newPassphrase, folder? }` (vault locked; 12 to 1024 characters, checked before the key is fetched) → `{ requestId, status: 'recovering' }`.

With the vault open (admin): `hosted.recovery.enrol` `{ recoveryCode, contact: { name, reach }, folder? }` → `{ enrolled: true, folder, contactChannel, contactMasked, enrolledAt }` (frame-today keeps the name and reach in the vault as before; only the reach goes to the relay); `hosted.recovery.status` `{ folder? }` → `{ enrolled, local, paired, relay, folder }`; `hosted.recovery.remove` `{ folder? }` → `{ removed: true }`. The code is checked for its form only: core keeps the vault's recovery wrapper out of reach of a module, so a wrong code shows only at recovery time (`RECOVERY_CODE_REJECTED`). New codes: `RECOVERY_CODE_INVALID`, `RECOVERY_CONTACT_INVALID`, `RECOVERY_FOLDER_UNKNOWN`, `RECOVERY_FILE_INVALID`, `RECOVERY_NOT_ENROLLED`, `RECOVERY_CREDENTIAL_INVALID`, `RECOVERY_REQUEST_LIMITED`, `RECOVERY_REQUEST_NOT_FOUND`, `RECOVERY_NOT_CONFIRMED`, `RECOVERY_DECLINED`, `RECOVERY_EXPIRED`, `RECOVERY_KEY_RELEASED`, `RECOVERY_IN_PROGRESS`, `RECOVERY_CODE_REJECTED`, `RECOVERY_REACH_INVALID`, `RECOVERY_KEY_INVALID`, plus `WEAK_PASSPHRASE`, `VAULT_OPEN` and `CHANNEL_NOT_CONFIGURED` on this lane's refusal line. The escrow, routes and messages are in `hosted/API.md`.

Why `complete` returns before the vault opens: a module request holds one of the engine's active-request slots, and `Engine.request` runs a vault transition (`workspace.recover`) only with none active, so `host.call('workspace.recover')` from inside a module handler is refused `VAULT_BUSY`. `complete` therefore starts the transition through `host.call` right after its own request settles (retrying briefly while the engine is busy). A small core hook (a module-scheduled transition) would make this synchronous.

## Round 4 contracts

| Method | Permission | Contract |
|---|---|---|
| `hosted.recovery.enrol` / `status` / `remove` | admin, external / read / admin, external | Above, under "recovery through a contact" |
| `hosted.recovery.request` / `check` / `complete` | admin, `preVault`, external, desktop only | For frame-today's `todayx.recoveryContact.request` (it still refuses until frame-today calls these). Above |
| `phone.documents.preview` | admin, desktop only | `{ documentId, as?: 'statement' \| 'bill', recipe?, expectedTotals? }`. CSV: no `as`, normal import preview, tainted. PDF: `as` required (`DOCUMENT_ROUTE_REQUIRED`); `statement` → connectors-ext `imports.preview { sourceId, kind: 'pdf', bytesBase64 }`; `bill` (PDF, JPEG, PNG) → work-books `books.billRead { bytesBase64, mime }`; a photo as a statement or `as` on a CSV is `DOCUMENT_ROUTE_INVALID`; over 4 MiB `DOCUMENT_TOO_LARGE_TO_READ`; a missing reader `DOCUMENT_READER_UNAVAILABLE`; other reader refusals pass through unchanged. Reply `{ documentId, route, untrusted: true, outside: true, imported: false, preview: <reader reply verbatim>, confirm }`; `confirm` is `{ method: 'sources.import' \| 'imports.commit', input }`, or for a bill `{ method: 'books.billConfirm', input: { readId, digest }, add: ['fields'] }` (the screen shows a field-check form and calls `books.billConfirm` with `{ readId, digest, fields }` only on the person's press), or null |
| (preview, added) | | `confirmReason: 'statement-question' \| 'statement-refused' \| 'statement-imported' \| 'reply-unrecognised' \| null`; a statement confirm is offered only for a `checked` reading; the bill confirm also carries `optional: ['zoho']` |
| `phone.documents.done` | admin, desktop only | `{ documentId }` → `{ documentId, done: true }`: clears a held document once the person finished with it |
| `phone.messages.log` | read | `{ filter?: 'lost' \| 'all' }` → `{ messages: [{ id, event, channel, status, at, buttons, errorCode, checkedAt }], lost }`; lost means `unknown` (no reply) or `failed`; no keys, ids of other systems or sealed blobs |
| `phone.messages.check` | admin, external, desktop only | `{ id }` → the log row plus `sendAgain`; asks the relay by idempotency key (`GET /v1/relay/messages/by-key/:key`) and never sends. Not received becomes `not-sent` (its approval offer voided) only five minutes after the last attempt (`MESSAGE_CHECK_TOO_SOON` before that); rows from an earlier pairing are never checked (`MESSAGE_OTHER_PAIRING`); `tick` re-checks old `unknown` rows, five at a time |
| Phone page (PH-04) | companion | Off unless `experiments.phonePage`; reads `approval.list` (rows now carry an optional `eligibility`), `approval.inspect` / `approval.submit`, `brief.list` titles, and `session.validate` `validatedAt` for "laptop last seen" |
| Desktop screens | UI | `tools/phonedocs` (Documents from your phone) and `tools/phonelog` (Messages whose result was lost) |

Recovery hardening after review: enrolment uses the open workspace's folder (`RECOVERY_FOLDER_MISMATCH`); `enrol` reports `replaced` and `status` reports `replacedBy`; `remove` withdraws the relay half with the local request credential (`POST /v1/recovery/enrolment/withdraw`); revoking a device clears its escrow on the relay; requests are limited to three a day per account and contact, with a separate ceiling of twenty a day per contact that never refuses an account's first request.

Mail STOP and HELP act only for senders whose mail passes SPF (or DKIM through a configured authserv id) for the From domain; a forged From gets only the fixed free-text reply. Tested end to end.

## Core edits

- `platform/runtime/sync.ts`: `SyncService.attachTransport(transport | null)` (11 added lines, nothing existing changed). `SyncService` takes its transport only at construction and modules cannot change `EngineOptions.sync`; the seam accepts only a narrowly scoped Google Drive transport, never replaces a host-configured one, and turns sync off on any change.
- `app/desktop/preload.cjs`: the hosted-link line of `laneRefusals` only.

## Gaps

- The phone page (PH-04) is built and off by default; shipping it is the founder's decision. With the real engine its review list says "in the app": the engine answers `approval.list` with open-desktop, and serving it (with the `eligibility` marking) needs a core change. The page is English only.
- PH-05 photos and PDFs depend on the local Python reader and tesseract (release lane bundles them); without them the readers' own refusals show.
- Recovery through a contact: `complete` returns `recovering` and the caller polls, because a module cannot run a vault transition inside its own request; a wrong enrolled recovery code shows only at recovery time.
- Drive sync in the installed app: connect and attach work, but `sync.enable` refuses `SYNC_WRITER_ADMISSION_REQUIRED` because the installed app gives the engine no sync device identity or writer admission (`worker.ts` passes no `sync` options), and configured sync trips existing core gates (`workspace.create`, backup, interchange, activation). Completing it is a core and product decision.
- Free-plan mail from the person's own mail account is the writeback lane's SMTP adapter, not this relay.
