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
| `POST /v1/accounts/otp/start` | `{ phone }` E.164, India `+91` and ten digits | `202 { challengeId, expiresAt }`. Rate limits: `OTP_RATE_LIMITED` (429). The code is sent through the `OtpProvider`. |
| `POST /v1/accounts/otp/verify` | `{ challengeId, code, deviceName }` | `200 { accountId, deviceId, sessionToken, expiresAt }`. Creates the account on first verify. `OTP_INVALID` (401), `OTP_EXPIRED` (410), `OTP_LOCKED` (429 after five wrong codes). |
| `GET /v1/accounts/me` | – | `{ accountId, phone, plan, entitlements, devices: [{ deviceId, deviceName, createdAt, lastSeenAt, current }] }` |
| `POST /v1/accounts/devices/:deviceId/revoke` | `{}` | `{ deviceId, revokedAt }`. Revoking ends that device's sessions at once. |

## Billing (`hosted/billing`)

| Route | Body | Reply |
|---|---|---|
| `GET /v1/billing/plans` | – | `{ plans: [{ plan, pricePaise, period: 'month', includes }] }` |
| `GET /v1/billing/subscription` | – | `{ plan, status: 'none'|'pending'|'active'|'past_due'|'cancelled', currentPeriodEnd, partner }` |
| `POST /v1/billing/checkout` | `{ plan: 'paid', idempotencyKey }` | `{ checkoutId, checkoutUrl, status: 'pending' }` from the `PaymentPartner`. `PAYMENT_PARTNER_NOT_CONFIGURED` (503) without a partner. |
| `POST /v1/billing/cancel` | `{}` | `{ status: 'cancelled', currentPeriodEnd }` |
| `POST /v1/billing/webhooks/:partner` | partner body, signature header | `200 { received: true }`. Bad signature: `WEBHOOK_SIGNATURE_INVALID` (401). Replays are idempotent by partner event id. |

## Relay (`hosted/relay`): briefs and simple approvals

Channels: `whatsapp` (Cloud API templates, to the account's verified phone), `telegram` (bot), `mail` (the relay's mail provider, to an address the account sets).

| Route | Body | Reply |
|---|---|---|
| `GET /v1/relay/channels` | – | `{ channels: [{ channel, status: 'off'|'awaiting-start'|'on'|'stopped'|'not-configured', optInAt, address }] }` (`address` is masked) |
| `PUT /v1/relay/channels/:channel` | `{ enabled, optIn: { given: true, textSha256, recordedAt } | null, address? }` | the channel row. Telegram returns `connectUrl` (`https://t.me/<bot>?start=<letters>`) and status `awaiting-start` until the person presses Start. `textSha256` must be the SHA-256 of `OPT_IN_TEXT[channel]`, else `OPT_IN_TEXT_CHANGED`. |
| `POST /v1/relay/messages` | `{ event, channel, idempotencyKey, offer? }` | `202 { messageId, status: 'queued', month, sent, budget }`. The relay renders the fixed template; the desktop never supplies text. `MONTHLY_BUDGET_REACHED` (429) after `budget` (30) messages in the Indian calendar month. `CHANNEL_OFF` (409) when the channel is not on. |
| `GET /v1/relay/messages/:messageId` | – | `{ messageId, event, channel, status: 'queued'|'sent'|'delivered'|'read'|'failed', buttons: 'open-only'|'approve-not-now-open', decided: null|'approve'|'not-now', expiresAt }` |
| `GET /v1/relay/counts?month=YYYY-MM` | – | `{ month, sent, budget, costPaise: string|null, costState: 'known'|'unknown', byChannel: { whatsapp, telegram, mail } }` |
| `GET /v1/relay/envelopes` | – | `{ envelopes: [SealedEnvelope] }` waiting for this account |
| `POST /v1/relay/envelopes/:envelopeId/ack` | `{ disposition: 'collected'|'expired'|'invalid' }` | `{ envelopeId, disposition }` |

`offer` (only with `event: 'review-ready'`) attaches Approve and Not now to the message:

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
- Mail uses the same one-time link: `GET /b/:token` shows a page with one confirm button and holds no data; only `POST /b/:token` decides.
- Open the app is a plain link page `GET /l/:token` that hands over to the desktop and decides nothing.

Inbound text: `HELP` gets the help reply and opens a person-help ticket; `STOP` stops every message on that channel; `START` turns it back on only for a channel already opted in from the desktop; anything else gets the one fixed reply. A typed "yes" is never an approval.

Webhooks: `GET /v1/webhooks/whatsapp` (Meta verify handshake), `POST /v1/webhooks/whatsapp` (`x-hub-signature-256` HMAC-SHA256 of the raw body with the app secret), `POST /v1/webhooks/telegram` (`x-telegram-bot-api-secret-token`).

## Link pages (`hosted/link`)

`GET /l/:token`, `GET /b/:token`, `POST /b/:token`: plain HTML, no data, no scripts except none, strict CSP, `noindex`, `no-referrer`, `no-store`. A changed or expired token shows "This link no longer works." The handover link is `chausar://open/<destination>`.

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
| `GET /v1/allowance` | – | `{ month, grantPaise, spentPaise, reservedPaise, balancePaise, pricing: { checkedOn, fxPaisePerUsd, source } | null, models: [{ route, model }] }` |
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
