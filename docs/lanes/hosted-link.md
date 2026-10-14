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
| `phone.documents.register`, `phone.documents.collect`, `phone.documents.list`, `phone.documents.preview`, `phone.documents.discard` | admin, external / read / admin | PH-05 (`documents.ts`). Pairing registers a fresh X25519 public key (`register` does it on demand). `collect` (also run by `tick`) downloads each copy sealed to this device, opens and checks it, acknowledges it and holds it re-encrypted under a vault key in `<app data>/phone-documents/<workspace>/` (0600): untrusted outside data awaiting review, never imported, no facts. `list` shows the "Awaiting your review" rows without content. `preview` hands a CSV to the normal import preview (`ImportService.preview`, the code behind `sources.preview`) with `sourceTainted: true` and returns the `sources.import` input for the normal confirm; other types refuse `DOCUMENT_PREVIEW_UNAVAILABLE`. An imported or discarded document's file is deleted |

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

## Gaps

- The phone page (PH-04) is not built (after day 10, founder's decision).
- PH-05 stops at the fixed reply; nothing is downloaded or imported.
- The allowance route client is not registered in the gateway's route catalogue (models-ext owns routes); models-ext's `connectAllowance` uses `hosted.allowanceCredential` with the core `managed` route instead.
- The engine host must wire `GoogleDriveSyncTransport` into `EngineOptions.sync` and record the picked folder; no method does it yet.
- Mail HELP and STOP by reply need an inbound mail webhook; the mail footer says to turn mail off in the app instead. HELP and STOP by reply work on WhatsApp and Telegram.
- Mail addresses are not verified with a confirmation link before the channel turns on.
- Free-plan mail from the person's own mail account is the writeback lane's SMTP adapter, not this relay.
