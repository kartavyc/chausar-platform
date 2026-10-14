# Chausar hosted API (v1)

The contract between the desktop (`platform/runtime/hosted-link/`) and the hosted services (`hosted/`). Written and tested; not deployed.

General rules:

- JSON bodies (`content-type: application/json`) with **exact keys**: an unknown field is refused with `INVALID_REQUEST`.
- Errors: `{ "error": { "code": "UPPER_CASE", "message": "Plain sentence." } }` with an HTTP status. A message never carries data from outside.
- Money: whole paise as a decimal string (`"1250"`), never a float. An unknown amount is `null` with a `...State` word field, never `"0"`.
- Times: ISO 8601 UTC strings.
- Auth: `Authorization: Bearer <sessionToken>` for every `/v1` route except the OTP routes, the billing webhook, the channel webhooks and the link pages. A session belongs to one desktop install (`deviceId`) of one account.
- Entitlements gate paid features: refusal code `PLAN_REQUIRED` (HTTP 402).

## Accounts (`hosted/accounts`)

| Route | Body | Reply |
|---|---|---|
| `POST /v1/accounts/otp/start` | `{ phone }` E.164, India `+91` and ten digits | `202 { challengeId, expiresAt }`. Rate limits, all `OTP_RATE_LIMITED` (429): per phone three in fifteen minutes and ten an hour; across the server `OTP_GLOBAL_PER_HOUR` (default 300) an hour; per client address `OTP_ADDRESS_PER_HOUR` (default 20) an hour, only behind a trusted proxy (`TRUST_PROXY=1`, first `x-forwarded-for` entry; only a keyed hash of the address is kept). The code is sent through the `OtpProvider`. |
| `POST /v1/accounts/otp/verify` | `{ challengeId, code, deviceName }` | `200 { accountId, deviceId, sessionToken, expiresAt }`. Creates the account on first verify. `OTP_INVALID` (401), `OTP_EXPIRED` (410), `OTP_LOCKED` (429 after five wrong codes). |
| `GET /v1/accounts/me` | – | `{ accountId, phone, plan, entitlements, devices: [{ deviceId, deviceName, createdAt, lastSeenAt, current }] }` |
| `POST /v1/accounts/devices/:deviceId/revoke` | `{}` | `{ deviceId, revokedAt }`. Revoking ends that device's sessions at once. |

## Billing (`hosted/billing`)

| Route | Body | Reply |
|---|---|---|
| `GET /v1/billing/plans` | – | `{ plans: [{ plan, pricePaise, priceState, period: 'month', includes }] }`. `includes` is the plan's entitlements, except that its allowance line reads `allowanceMonthlyPaise: string|null` with `allowanceMonthlyState: 'set'|'not-set'|'not-included'` (never a grant of `"0"`). |
| `GET /v1/billing/subscription` | – | `{ plan, status: 'none'|'pending'|'active'|'past_due'|'cancelled', currentPeriodEnd, partner }` |
| `POST /v1/billing/checkout` | `{ plan: 'paid', idempotencyKey }` | `{ checkoutId, checkoutUrl, status: 'pending' }` from the `PaymentPartner`. `PAYMENT_PARTNER_NOT_CONFIGURED` (503) without a partner. |
| `POST /v1/billing/cancel` | `{}` | `{ status: 'cancelled', currentPeriodEnd }` |
| `POST /v1/billing/webhooks/:partner` | partner body, signature header | `200 { received: true }`. Bad signature: `WEBHOOK_SIGNATURE_INVALID` (401). Replays are idempotent by partner event id. |

## Relay (`hosted/relay`): briefs and simple approvals

Channels: `whatsapp` (Cloud API templates, to the account's verified phone), `telegram` (bot), `mail` (the relay's mail provider, to an address the account sets; Open the app only, never Approve or Not now).

| Route | Body | Reply |
|---|---|---|
| `GET /v1/relay/channels` | – | `{ channels: [{ channel, status: 'off'|'awaiting-start'|'on'|'stopped'|'not-configured', optInAt, address }] }` (`address` is masked) |
| `PUT /v1/relay/channels/:channel` | `{ enabled, optIn: { given: true, textSha256, recordedAt } | null, address? }` | the channel row. Telegram returns `connectUrl` (`https://t.me/<bot>?start=<letters>`) and status `awaiting-start` until the person presses Start. `textSha256` must be the SHA-256 of `OPT_IN_TEXT[channel]`, else `OPT_IN_TEXT_CHANGED`. |
| `POST /v1/relay/messages` | `{ event, channel, idempotencyKey, offer? }` | `202 { messageId, status: 'queued', month, sent, budget }`. The relay renders the fixed template; the desktop never supplies text. `MONTHLY_BUDGET_REACHED` (429) after `budget` (30) messages in the Indian calendar month. `CHANNEL_OFF` (409) when the channel is not on. |
| `GET /v1/relay/messages/:messageId` | – | `{ messageId, event, channel, status: 'queued'|'sent'|'delivered'|'read'|'failed', buttons: 'open-only'|'approve-not-now-open', decided: null|'approve'|'not-now', expiresAt }` |
| `GET /v1/relay/counts?month=YYYY-MM` | – | `{ month, sent, budget, costPaise: string|null, costState: 'known'|'unknown', byChannel: { whatsapp, telegram, mail } }` |
| `GET /v1/relay/envelopes` | – | `{ envelopes: [SealedEnvelope] }` waiting for this desktop install: only envelopes from offers this session's `deviceId` sent |
| `POST /v1/relay/envelopes/:envelopeId/ack` | `{ disposition: 'collected'|'expired'|'invalid' }` | `{ envelopeId, disposition }`. Another device's envelope is `ENVELOPE_NOT_FOUND` (404). |

`offer` (only with `event: 'review-ready'` and only on `whatsapp` or `telegram`, else `OFFER_NOT_ALLOWED`) attaches Approve and Not now to the message. Mail carries Open the app only: a mail link works for whoever holds the mail, forwarded copies included, while a chat press is bound to the owner's number or chat. The relay keeps the sending `deviceId` with the message and releases the envelope to that device only; server-side `notify` messages (worker reminders) carry no offer and no device.

```json
{ "approve": SealedBlob, "notNow": SealedBlob }
SealedBlob = { "format": "chausar-relay-sealed-v1", "nonce": "<base64, 12 bytes>", "ciphertext": "<base64, 16..4096 bytes>" }
```

The desktop seals each blob with AES-256-GCM under a key that only the desktop holds; the relay cannot read or forge it. The plaintext (desktop-defined) names the approval, the exact action digest, the decision and an expiry. The relay only stores the blobs and, when a button is pressed, releases the matching blob as an envelope:

```json
SealedEnvelope = { "envelopeId", "messageId", "purpose": "approval-intent", "decision": "approve"|"not-now",
  "channel", "createdAt", "expiresAt", "nonce", "ciphertext" }
```

Button rules, enforced by the relay and again by the desktop:

- Each button token is 48 letters (no digits), stored only as a keyed hash, **single use**, and **expires 30 minutes** after the message is queued.
- One decision per message: pressing Approve voids Not now and the reverse.
- WhatsApp quick-reply and Telegram callback buttons count only when they come from the opted-in number or chat ("for the owner's number only"); a forwarded copy does nothing.
- A press on a channel whose status is not `on` (after STOP, or turned off from the desktop) decides nothing (refusal reason `channel-off`).
- Mail: Open the app only. No new mail offers are made; `GET /b/:token` (one confirm button, no data) and `POST /b/:token` (decides) stay only so tokens already sent keep their thirty minutes.
- Open the app is a plain link page `GET /l/:token` that hands over to the desktop. It stays usable for **seven days**, unlike Approve and Not now (single use, thirty minutes), because it decides nothing and holds no data: a forwarded or late copy can only open the app's own screen.

Inbound text: `HELP` gets the help reply and opens a person-help ticket; `STOP` stops every message on that channel; `START` turns it back on only for a channel already opted in from the desktop; anything else gets the one fixed reply. A typed "yes" is never an approval.

Webhooks: `GET /v1/webhooks/whatsapp` (Meta verify handshake), `POST /v1/webhooks/whatsapp` (`x-hub-signature-256` HMAC-SHA256 of the raw body with the app secret), `POST /v1/webhooks/telegram` (`x-telegram-bot-api-secret-token`).

## Link pages (`hosted/link`)

`GET /l/:token` (Open the app, seven days, decides nothing), `GET /b/:token`, `POST /b/:token` (mail approvals sent before mail offers stopped; thirty minutes, single use): plain HTML, no data, no scripts except none, strict CSP, `noindex`, `no-referrer`, `no-store`. A changed or expired token shows "This link no longer works." The handover link is `chausar://open/<destination>`.

## Backup (`hosted/backup`): blind storage

| Route | Body | Reply |
|---|---|---|
| `PUT /v1/backups/:backupId` | raw bytes, `content-type: application/octet-stream`, `x-chausar-sha256: <hex>`; the body must start with the 8 bytes `CHSBK1\0\0` | `201 { backupId, sizeBytes, sha256, createdAt }`. `BACKUP_DIGEST_MISMATCH`, `BACKUP_FORMAT_INVALID`, `BACKUP_QUOTA_EXCEEDED` (413), `BACKUP_EXISTS` (409). |
| `GET /v1/backups` | – | `{ backups: [{ backupId, sizeBytes, sha256, createdAt }], quotaBytes, usedBytes, keep }` |
| `GET /v1/backups/:backupId` | – | raw bytes, `x-chausar-sha256` header |
| `DELETE /v1/backups/:backupId` | – | `{ backupId, deleted: true }` |

`backupId` is `bk_` + 32 lowercase hex. The server never receives a key. Older versions beyond `keep` are pruned by the worker.

## Model allowance (`hosted/allowance`)

| Route | Body | Reply |
|---|---|---|
| `GET /v1/allowance` | – | `{ month, grantPaise: string|null, grantState: 'set'|'not-set'|'not-included', spentPaise, reservedPaise, balancePaise: string|null, pricing: { checkedOn, fxPaisePerUsd, source } | null, models: [{ route, model }] }`. `not-set`: the server has no `ALLOWANCE_MONTHLY_PAISE`; `not-included`: the account's plan has no allowance. Either way `grantPaise` and `balancePaise` are `null`, never `"0"`. |
| `POST /v1/allowance/complete` | `{ requestId, route: 'anthropic'|'openai', model, system?, messages: [{ role: 'user'|'assistant', content }], maxOutputTokens }` | `{ requestId, text, usage: { inputTokens, outputTokens }, costPaise, balancePaise, route, model, pricingCheckedOn }` |

The proxy holds the provider keys. It reserves the most a request can cost before calling the provider, settles the measured cost afterwards (rounded up to whole paise), and keeps one attempt per `requestId` (`REQUEST_EXISTS`). Refusals: `ALLOWANCE_EXHAUSTED` (402), `MODEL_NOT_PRICED` (400), `PROVIDER_NOT_CONFIGURED` (503), `PROVIDER_FAILED` (502), `PROVIDER_OUTCOME_UNKNOWN` (504, the reservation is kept until reconciled). The proxy stores no prompt and no answer.

## Always-on jobs worker (`hosted/worker`)

**Not end-to-end encrypted.** The server does the work, so it can read what each job uses. Every reply carries `endToEndEncrypted: false` and the label.

| Route | Body | Reply |
|---|---|---|
| `GET /v1/worker` | – | `{ endToEndEncrypted: false, label, jobs: [{ type, title, enabled, consentAt, uses }] }` |
| `PUT /v1/worker/jobs/:type` | `{ enabled, consent: { notEndToEndEncrypted: true, recordedAt } | null }` | the job row. Turning on needs the consent. |
| `PUT /v1/worker/due-dates` | `{ dueDates: [{ id, date: 'YYYY-MM-DD', remindDaysBefore }] }` (at most 200) | `{ stored }`. Used by the `due-date-reminder` job; it sends "A due date is near." and nothing else. |
| `DELETE /v1/worker/data` | – | `{ deleted: true }` removes every stored job input |

## Health

`GET /healthz` → `{ ok: true }`. `GET /readyz` checks the database.

## Additional refusal codes and decisions (as built)

- Accounts: `INVALID_PHONE`, `DEVICE_NAME_INVALID`, `DEVICE_NOT_FOUND` (404), `OTP_SEND_FAILED` (502). Sessions slide: each use moves expiry to thirty days ahead.
- Billing: `PLAN_INVALID`, `PRICE_NOT_SET` (503), `SUBSCRIPTION_EXISTS`, `NO_SUBSCRIPTION`, `PAYMENT_PARTNER_CHANGED`, `SUBSCRIPTION_CHANGED` (all 409), `WEBHOOK_INVALID`, `PAYMENT_PARTNER_FAILED` (502). Cancelling ends paid entitlements at once; past due keeps them for a seven-day grace. Only one partner subscription is tracked per account: a new checkout while one is pending cancels the earlier checkout's partner subscription, a paid checkout replaces (and cancels at the partner) a newer pending one, and a second subscription that starts or charges beside the active or past-due one is cancelled at the partner and changes nothing. A failed partner cancel fails the webhook so the partner retries it. Plans carry `priceState` (`set` or `not-set`).
- Relay: `EVENT_UNKNOWN`, `CHANNEL_UNKNOWN`, `OFFER_INVALID`, `OFFER_NOT_ALLOWED`, `OPT_IN_REQUIRED`, `ADDRESS_REQUIRED`, `ADDRESS_INVALID`, `ACCOUNT_PHONE_MISSING`, `MESSAGE_NOT_FOUND`, `ENVELOPE_NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `WEBHOOK_VERIFY_FAILED`, `SERVICE_WINDOW_CLOSED`, `RECIPIENT_CHANGED`, `PROVIDER_*`. A message counts against the thirty when queued; a failed send does not give it back. Approve and Not now expire after thirty minutes; the Open the app link expires after seven days because it decides nothing. After STOP only START or a new desktop opt-in turns the channel on. There is no inbound mail webhook: HELP and STOP by reply work on WhatsApp and Telegram.
- Backup: listing, download and delete work without the plan, so a lapsed account can take its backups home for thirty days; uploads need the plan.
- Allowance: `PRICING_NOT_SET` (503), `PRICING_INVALID` (server start). A provider HTTP error releases the reservation (`PROVIDER_FAILED`); a network error, timeout or unreadable success keeps it (`PROVIDER_OUTCOME_UNKNOWN`).
- Worker: `CONSENT_REQUIRED`, `JOB_TYPE_UNKNOWN` (404), `JOB_NOT_ENABLED` (409, due dates are stored only after consent). Turning the job off deletes its data. A server-side reminder goes through the relay's `notify` (first channel that is on), one per account per Indian day, and counts against the thirty.
