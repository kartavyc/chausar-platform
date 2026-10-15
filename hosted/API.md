# Chausar hosted API (v1)

The contract between the desktop (`platform/runtime/hosted-link/`) and the hosted services (`hosted/`). Written and tested; not deployed.

General rules:

- JSON bodies (`content-type: application/json`) with **exact keys**: an unknown field is refused with `INVALID_REQUEST`.
- Errors: `{ "error": { "code": "UPPER_CASE", "message": "Plain sentence." } }` with an HTTP status. A message never carries data from outside.
- Money: whole paise as a decimal string (`"1250"`), never a float. An unknown amount is `null` with a `...State` word field, never `"0"`.
- Times: ISO 8601 UTC strings.
- Auth: `Authorization: Bearer <sessionToken>` for every `/v1` route except the OTP routes, the billing webhook, the channel webhooks, the link pages, `POST /v1/allowance/responses` (which takes an allowance credential instead, and nothing else) and `/v1/recovery/requests…` (which take a recovery request credential instead). A session belongs to one desktop install (`deviceId`) of one account.
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
| `POST /v1/billing/webhooks/:partner` | partner body, signature header | `200 { received: true }`. Bad signature: `WEBHOOK_SIGNATURE_INVALID` (401). Replays are idempotent by partner event id. Razorpay signs only the body, so its event id is derived from the signed body (event name, subscription id, payment id when present, `created_at`): the same body under a new `x-razorpay-event-id` header is the same event. A Razorpay event whose `created_at` is more than three days old is refused `WEBHOOK_STALE` (400); `created_at` is required. |

## Relay (`hosted/relay`): briefs and simple approvals

Channels: `whatsapp` (Cloud API templates, to the account's verified phone), `telegram` (bot), `mail` (the relay's mail provider, to an address the account sets; Open the app only, never Approve or Not now).

| Route | Body | Reply |
|---|---|---|
| `GET /v1/relay/channels` | – | `{ channels: [{ channel, status: 'off'|'awaiting-start'|'awaiting-confirmation'|'on'|'stopped'|'not-configured', optInAt, address, verified }] }` (`address` is masked). `verified`: mail once its address was confirmed; WhatsApp while on for the account's current OTP-verified phone; Telegram while bound and on. |
| `PUT /v1/relay/channels/:channel` | `{ enabled, optIn: { given: true, textSha256, recordedAt } | null, address? }` | the channel row. Telegram returns `connectUrl` (`https://t.me/<bot>?start=<letters>`) and status `awaiting-start` until the person presses Start. Mail with an address not yet confirmed returns `awaiting-confirmation` and queues one confirmation mail (see below). A mail address (or WhatsApp number) bound to another account (confirmed there and not turned off, STOP included) is refused `ADDRESS_IN_USE` (409) and no mail is sent; a Telegram chat another account bound after this one turned Telegram off is let go, and the reply is `awaiting-start` with a fresh `connectUrl`. `textSha256` must be the SHA-256 of `OPT_IN_TEXT[channel]`, else `OPT_IN_TEXT_CHANGED`. |
| `POST /v1/relay/messages` | `{ event, channel, idempotencyKey, offer? }` | `202 { messageId, status: 'queued', month, sent, budget }`. The relay renders the fixed template; the desktop never supplies text. `MONTHLY_BUDGET_REACHED` (429) after `budget` (30) messages in the Indian calendar month. `CHANNEL_OFF` (409) when the channel is not on. |
| `GET /v1/relay/messages/by-key/:idempotencyKey` | – | `{ messageId, status: 'queued'|'sent'|'delivered'|'read'|'failed' }` for the message the caller's own account queued under that key (`[A-Za-z0-9_-]{8,100}`, else `INVALID_REQUEST`); `MESSAGE_NOT_FOUND` (404) when this account never queued one, including when another account did. Sends nothing and changes nothing. The desktop asks this after a send whose reply was lost (`phone.messages.check`, and its tick for entries still unknown after five minutes): a hit copies the relay's status, and only this route's own `MESSAGE_NOT_FOUND` marks the entry `not-sent` (a 404 without that code, such as from a server without this route, is a refusal and changes nothing). A `not-sent` entry is never resent with its old key or sealed buttons; sending again is a new message. |
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

Inbound text: `HELP` gets the help reply and opens a person-help ticket (at most three per account, or per unknown sender, in twenty-four hours; further HELPs get the reply and open nothing); `STOP` stops every message on that channel of the sender's own account; `START` turns it back on only for a channel already opted in from the desktop; anything else gets the one fixed reply. A typed "yes" is never an approval.

One binding per chat, number and address: a Telegram chat, a WhatsApp number or a confirmed mail address belongs to at most one account while that account's row is not `off` (a stopped row keeps it). A database unique index holds this. A Telegram start link from a second account, pressed in a chat already bound, binds nothing: the link is used up, the chat gets `buttonGone`, and the press is recorded as refusal reason `chat-in-use`. The sender of an inbound message belongs to the one account with a live binding (or, with none, the one account whose binding is turned off); more than one candidate is nobody.

Webhooks: `GET /v1/webhooks/whatsapp` (Meta verify handshake), `POST /v1/webhooks/whatsapp` (`x-hub-signature-256` HMAC-SHA256 of the raw body with the app secret), `POST /v1/webhooks/telegram` (`x-telegram-bot-api-secret-token`), `POST /v1/webhooks/mail/:provider` (inbound mail, below), `GET`/`POST /v1/webhooks/whatsapp-business/:hook` (a business's own status hook, below).

### Mail address confirmation

Before mail turns `on`, the relay sends one fixed mail to the address (`MAIL_TEXT.confirmHeadline`, a `/v/<48 letters>` link, `MAIL_TEXT.confirmNote`; no digit). The channel stays `awaiting-confirmation` until the link page's POST confirms it. The link is single use, expires a day after it is sent, and stops working when the address changes (a new address restarts confirmation and voids every earlier link). Saving again while a confirmation is pending sends nothing new; turning mail off and on with the same confirmed address needs no new confirmation. Confirmation mails do not count against the thirty; at most three are sent per account in twenty-four hours (`MAIL_CONFIRM_LIMITED`, 429). The token is stored only as a keyed hash; no copy of the address is made for it. A link for an address another account confirmed in the meantime is refused (the page says the link no longer works, the confirmation records `ADDRESS_IN_USE`, refusal reason `address-in-use`), and the desktop's next save is refused `ADDRESS_IN_USE`.

### Inbound mail

`POST /v1/webhooks/mail/:provider` takes a provider's inbound webhook through an adapter (`verify(rawBody, headers)`, `parse(rawBody, headers) → { from, text, messageId, authenticated } | null`):

- `postmark`: Postmark inbound JSON (`From`, `FromFull.Email`, `TextBody`, `StrippedTextReply`, `MessageID`, `Headers`). Postmark signs nothing, so the webhook URL carries HTTP basic credentials (`https://<user>:<password>@<api>/v1/webhooks/mail/postmark`), compared in constant time. Automatic replies (`Auto-Submitted` other than `no`) are ignored. `authenticated` is read conservatively from `Headers`: exactly one `Received-SPF` header that says `Pass` for `identity=mailfrom` with an `envelope-from` in exactly the From domain; or, only when `POSTMARK_INBOUND_AUTHSERV_ID` is set, exactly one `Authentication-Results` header with that authserv-id holding `dkim=pass` with `header.d` (or `header.i`) in exactly the From domain, or `spf=pass` with `smtp.mailfrom` there. Comments are ignored; anything else is unauthenticated.
- `hmac`: any other provider or forwarder: `x-chausar-mail-signature: sha256=<hex>` (HMAC-SHA256 of the raw body) and a body of exactly `{ from, text, messageId, authenticated }`, where `authenticated` (a boolean, required) is the forwarder's statement that SPF or DKIM passed for the From domain. A body without it is ignored.

Unknown or unconfigured provider: `MAIL_PROVIDER_UNKNOWN` (404); bad credentials or signature: `WEBHOOK_SIGNATURE_INVALID` (401). The sender is matched to an account whose mail channel is confirmed for that address, by the keyed hash of the normalized (trimmed, lower-case) address, never by a plaintext lookup. A sender nobody confirmed gets no mail. Anyone can write any From, so only an authenticated sender's command acts: from an unauthenticated sender every mail is free text (the fixed free-text reply, still within the per-sender limit) and changes nothing. For an authenticated sender the first non-empty line decides: `HELP` opens a help ticket (within the per-account limit) and gets the help reply, `STOP` stops mail and gets the stop reply, anything else gets the fixed free-text reply (`START` by mail is free text; mail is turned back on from the desktop). A typed "yes" is never an approval. Replies go through the queue under the subject `MAIL_TEXT.replySubject`, do not count against the thirty, and are limited to five per sender per Indian day. Each provider event counts once; the mail's text is read for the command and never stored. Checked end to end against the composed app (`platform/tests/hosted-link-message-log.test.ts`): a STOP whose From is forged (no SPF, a failing SPF, an SPF pass for another domain, or two Received-SPF headers) leaves mail on and gets only the free-text reply, while a STOP whose sender passed SPF for its own domain stops mail and the desktop's next mail send is refused `CHANNEL_OFF`.

### A business's own WhatsApp statuses (for the writeback lane)

The writeback lane sends template messages through the business's **own** WhatsApp Business account with `biz_opaque_callback_data: <reference>`. Meta posts their statuses to a webhook of that business's own app, which the business points at the relay:

| Route | Body | Reply |
|---|---|---|
| `PUT /v1/relay/business-hook` | `{ appSecret }` | `{ hookUrl: "<API_ORIGIN>/v1/webhooks/whatsapp-business/<48 letters>", verifyToken: "<letters>" }`. The app secret is sealed at rest; the hook and verify tokens are stored only as keyed hashes. Calling it again rotates both (the old URL stops at once). `APP_SECRET_INVALID`, `PLAN_REQUIRED` (402), `API_ORIGIN_NOT_SET` (503). |
| `GET /v1/webhooks/whatsapp-business/:hook` | Meta verify handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`) | the challenge as plain text, or `WEBHOOK_VERIFY_FAILED` (403) |
| `POST /v1/webhooks/whatsapp-business/:hook` | Meta callback, `x-hub-signature-256` over the raw body with **that account's** app secret (constant time) | `{ received: true }`, or `WEBHOOK_SIGNATURE_INVALID` (401) for a wrong signature or unknown hook |
| `GET /v1/relay/business-statuses?reference=…&messageId=…` | – | `{ statuses: [{ messageId, status: 'sent'|'delivered'|'read'|'failed', at, reference }] }` for the caller's account only: statuses carrying `reference`, or for `messageId` when given. `REFERENCE_INVALID` |

From each callback only `statuses[]` is read, and only `{ account, message_id, status, at, reference }` is stored, where `reference` is `biz_opaque_callback_data` matching `[A-Za-z0-9_.:-]{1,128}` (a status without one is ignored). Inbound customer messages and every other field are ignored and never stored. Statuses are kept thirty days. The relay's own message statuses (`GET /v1/relay/messages/:messageId`) are separate and unchanged.

**Telegram has no delivery callbacks**: the Bot API reports nothing after a message is accepted, so there is no Telegram equivalent of these statuses (and a relay Telegram message stays `sent`).

### Documents sent from the phone (`hosted/relay/documents.ts`, experimental)

A document (WhatsApp `document` or `image`; Telegram `document` or `photo`, largest size) from the opted-in owner's number or chat gets the fixed reply `documentReceived` ("Document received.") and is queued for the worker job `relay.document`; the provider media reference is kept only sealed with a server key in the job. The job downloads it (WhatsApp: `GET https://graph.facebook.com/v21.0/<media-id>` for the URL, then that URL with the access token; Telegram: `getFile`, then `https://api.telegram.org/file/bot<token>/<file_path>`), at most 10 MiB, and keeps it only if the bytes are a PDF, JPEG or PNG, or a CSV the provider also called `text/csv` (plain UTF-8). It encrypts the document in memory to every registered, non-revoked desktop key of the account and stores only the sealed bytes, the size, the media type and the received time: no file name, caption or plaintext reaches the disk or the database. Stored nothing, reply still sent: a sender who is not the opted-in owner, a channel that is not `on`, an account without the relay entitlement or without a registered desktop key, more than twenty documents in the Indian calendar day, too large, or another type. A copy is deleted when its desktop acknowledges it, or after seven days.

| Route | Body | Reply |
|---|---|---|
| `PUT /v1/relay/device-key` | `{ publicKey }` raw X25519 public key, 32 bytes, base64 | `{ deviceId, registered: true, updatedAt }`, bound to the caller's `deviceId`. `DEVICE_KEY_INVALID` otherwise. |
| `GET /v1/relay/documents` | – | `{ documents: [{ documentId, channel: 'whatsapp'|'telegram', mediaType: 'application/pdf'|'image/jpeg'|'image/png'|'text/csv', sizeBytes, receivedAt, expiresAt }] }`, only copies sealed to the caller's device |
| `GET /v1/relay/documents/:documentId` | – | `200 application/octet-stream`, the sealed copy, with `x-chausar-sha256`. `DOCUMENT_NOT_FOUND` (404) for another device or account. |
| `POST /v1/relay/documents/:documentId/ack` | `{ disposition: 'collected'|'invalid' }` | `{ documentId, disposition }`; the copy is deleted. `DOCUMENT_NOT_FOUND` (404) for another device or account. |

```text
sealed = "CHSDOC1\0" (8 bytes) | ephemeral X25519 public key (32) | nonce (12) | AES-256-GCM ciphertext | tag (16)
key    = HKDF-SHA256(ikm = X25519(ephemeral, desktop), salt = ephemeral public | desktop public, info = "chausar-relay-document-v1", 32 bytes)
AAD    = "chausar-relay-document-v1|<accountId>|<deviceId>|<documentId>|<mediaType>"
```

The desktop opens and checks each copy, acknowledges it and holds it as untrusted outside data awaiting review (`phone.documents.*`); the forwarded document is data and enters the same import checks as a file brought on the computer.

### Recovery through a contact (`hosted/relay/recovery.ts`, FR-13)

A two-part escrow, so that neither the relay alone nor a stolen computer alone can recover a vault. The desktop encrypts the workspace's recovery code (AES-256-GCM, AAD `chausar-recovery-contact-v1|<workspaceId>|<enrolmentId>`) under a random 32-byte key K and keeps the ciphertext, with a random 32-byte **request credential**, in a file outside the vault. The relay keeps K and the contact's address, both sealed with a server key (HKDF of `HOSTED_PEPPER`, info `recovery-seal`), a keyed hash of the contact, and a keyed hash of the SHA-256 of the credential. **The relay never receives the recovery code, and the contact's name never leaves the desktop.**

| Route | Auth | Body | Reply |
|---|---|---|---|
| `PUT /v1/recovery/enrolment` | session | `{ key, contact: { reach }, credentialSha256 }`: K as standard base64 (32 bytes); `reach` an Indian mobile `+91[6-9]…` (reached on WhatsApp) or a mail address; the credential's SHA-256 as hex | `{ enrolmentId, contactChannel: 'whatsapp'|'mail', contactMasked, enrolledAt }`. Replaces this device's earlier enrolment (its K and address are deleted and its open links stop working). `RECOVERY_KEY_INVALID`, `RECOVERY_REACH_INVALID`, `PLAN_REQUIRED` (402), `CHANNEL_NOT_CONFIGURED` (503) |
| `GET /v1/recovery/enrolment` | session | – | `{ enrolment: { enrolmentId, contactChannel, contactMasked, enrolledAt } | null }` for the calling device |
| `DELETE /v1/recovery/enrolment` | session | – | `{ removed: boolean }`; K and the address are deleted, open links stop working |
| `POST /v1/recovery/enrolment/withdraw` | request credential | `{}` | `{ removed: boolean }`: the same, for exactly the enrolment the credential belongs to, from a desktop with no session (unpaired, or the session ended) |
| `POST /v1/recovery/requests` | `Bearer <request credential>` | `{}` | `202 { requestId, status: 'waiting', expiresAt, contactChannel }`. Sends the contact one fixed message and the owner's own channels that are `on` one fixed notice. A new request voids every earlier link of the enrolment. `RECOVERY_REQUEST_LIMITED` (429): in twenty-four hours, three requests per enrolment and three messages to one contact from one account (another account naming the same contact cannot use this account's allowance), and a spam ceiling of twenty messages per contact across accounts that never refuses an account's first request of the day. `RECOVERY_KEY_RELEASED` (410) once the enrolment was used |
| `GET /v1/recovery/requests/:requestId` | request credential | – | `{ requestId, status: 'waiting'|'confirmed'|'declined'|'expired'|'failed'|'released', expiresAt }` |
| `POST /v1/recovery/requests/:requestId/release` | request credential | `{}` | `{ requestId, key }` **once**, only for a confirmed request within a day of the confirmation; K and the contact's address are deleted in the same transaction and the enrolment is used up. `RECOVERY_NOT_CONFIRMED` (409), `RECOVERY_DECLINED` (409), `RECOVERY_EXPIRED` (410), `RECOVERY_KEY_RELEASED` (410) |

Request-credential routes refuse `RECOVERY_CREDENTIAL_INVALID` (401) for an unknown credential, a session token or a device that was revoked, `RECOVERY_NOT_ENROLLED` (404) for a removed or replaced enrolment, and `RECOVERY_REQUEST_NOT_FOUND` (404) for another enrolment's request. A session is never needed: the desktop's session lives in the locked vault.

The messages (`RECOVERY_TEXT` in both catalogue copies; no digit, name or amount):

- To the contact, by mail: subject `RECOVERY_TEXT.contactSubject`, body `contactLine`, the `/r/<48 letters>` link, `contactNote`. On WhatsApp: the template **`chausar_recovery_confirm`** (`contactLine`, a URL button whose suffix is the link token). Sent through the job `relay.recovery`; the token is stored only as a keyed hash and set when the message is sent.
- To the owner, on each channel that is `on`: mail (subject `ownerSubject`, body `ownerLine`), Telegram (`ownerLine`) or the WhatsApp template **`chausar_recovery_requested`** (no button), so a request nobody expected is noticed.
- Neither counts against the monthly thirty; the request limits above bound them.

## Link pages (`hosted/link`)

`GET /r/:token` shows `RECOVERY_TEXT.pageAsk` with two buttons, Confirm and I did not ask (one form, `choice=confirm|decline`), and consumes nothing. `POST /r/:token` decides once (`confirmed` or `declined`) while the request is the enrolment's newest, unexpired (a day after it was asked) and the enrolment is active; anything else, including a second press, shows "This link no longer works."

`GET /l/:token` (Open the app, seven days, decides nothing), `GET /b/:token`, `POST /b/:token` (mail approvals sent before mail offers stopped; thirty minutes, single use), `GET /v/:token` (one Confirm button, consumes nothing) and `POST /v/:token` (confirms the mail address once; a day long): plain HTML, no data, no scripts except none, strict CSP, `noindex`, `no-referrer`, `no-store`. A changed or expired token shows "This link no longer works." The handover link is `chausar://open/<destination>`.

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

### Allowance credentials and the Responses endpoint

| Route | Auth | Body | Reply |
|---|---|---|---|
| `POST /v1/allowance/credentials` | session | `{}` | `201 { credentialId, credential, endpoint, createdAt }`. `credential` is shown once: an opaque `ca_` token, stored only as a keyed hash. `endpoint` is `<HOSTED_API_ORIGIN>/v1/allowance/responses`. Needs the allowance (`PLAN_REQUIRED`, 402); `ALLOWANCE_ENDPOINT_NOT_SET` (503) when the server has no `HOSTED_API_ORIGIN`. At most three are live per device: issuing a fourth revokes the oldest. |
| `DELETE /v1/allowance/credentials/:credentialId` | session | – | `{ credentialId, revokedAt }`. Any device of the account may revoke; a second revoke answers with the first time. Another account's id is `NOT_FOUND` (404). |
| `POST /v1/allowance/responses` | allowance credential | `{ model, input, max_output_tokens, instructions?, tools?: [], tool_choice?: 'none', store?: false, text?: { format: { type: 'json_schema', name, schema, strict?, description? } } }` | `{ id, object: 'response', status: 'completed'\|'incomplete', incomplete_details?, model, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], output_text, usage: { input_tokens, output_tokens } }` with headers `x-request-id`, `x-chausar-cost-paise`, `x-chausar-balance-paise`. |

A credential is bound to the account and device that asked for it and opens **only** `POST /v1/allowance/responses`; every other route refuses it (`UNAUTHENTICATED`), and that route refuses a session token. Revoking the credential, or the device, ends it at once.

The Responses endpoint takes exactly the body the desktop gateway's `managed` route sends (OpenAI Responses form) and goes through the same ledger as `/complete`: worst-case reservation under the month lock (instructions, input and schema by UTF-8 bytes plus framing; `max_output_tokens` at most 8192), settlement of the measured cost, an unclear outcome kept, nothing of the prompt or answer stored. `model` must be priced; the provider follows its priced route. An `openai` model is sent a Responses request (`instructions`, the input as one user message, `max_output_tokens`, `store: false`, and the `json_schema` format as `text.format`). An `anthropic` model is sent a Messages request with the instructions as `system` and the input as the one user message (the Messages API takes no json_schema format, so it is not sent). Either way the reply is the Responses shape above; `status: 'incomplete'` means the provider stopped at the output limit. The request id is server-made (`rsp_…`), or `idk_` + an `Idempotency-Key` header (8 to 124 of `A-Za-z0-9_-`), which then refuses a resend with `REQUEST_EXISTS`. Refusals are the hosted error shape: those of `/complete`, plus `TOOLS_NOT_ALLOWED` (400) for any tool or a `tool_choice` other than `none`.

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
- Billing: `PLAN_INVALID`, `PRICE_NOT_SET` (503), `SUBSCRIPTION_EXISTS`, `NO_SUBSCRIPTION`, `PAYMENT_PARTNER_CHANGED`, `SUBSCRIPTION_CHANGED` (all 409), `WEBHOOK_INVALID`, `WEBHOOK_STALE`, `PAYMENT_PARTNER_FAILED` (502). Cancelling ends paid entitlements at once; past due keeps them for a seven-day grace. Only one partner subscription is tracked per account: a new checkout while one is pending cancels the earlier checkout's partner subscription, a paid checkout replaces (and cancels at the partner) a newer pending one, and a second subscription that starts or charges beside the active or past-due one is cancelled at the partner and changes nothing. A failed partner cancel fails the webhook so the partner retries it. Plans carry `priceState` (`set` or `not-set`).
- Relay: `EVENT_UNKNOWN`, `CHANNEL_UNKNOWN`, `OFFER_INVALID`, `OFFER_NOT_ALLOWED`, `OPT_IN_REQUIRED`, `ADDRESS_REQUIRED`, `ADDRESS_INVALID`, `ACCOUNT_PHONE_MISSING`, `MESSAGE_NOT_FOUND`, `ENVELOPE_NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `WEBHOOK_VERIFY_FAILED`, `SERVICE_WINDOW_CLOSED`, `RECIPIENT_CHANGED`, `PROVIDER_*`, `DEVICE_KEY_INVALID`, `DOCUMENT_NOT_FOUND` (404). A message counts against the thirty when queued; a failed send does not give it back. Approve and Not now expire after thirty minutes; the Open the app link expires after seven days because it decides nothing. After STOP only START or a new desktop opt-in turns the channel on (by mail, only the desktop opt-in). HELP and STOP by reply work on WhatsApp, Telegram and, through the inbound mail webhook, mail. New: `MAIL_CONFIRM_LIMITED` (429), `MAIL_PROVIDER_UNKNOWN` (404), `APP_SECRET_INVALID`, `REFERENCE_INVALID`, `API_ORIGIN_NOT_SET` (503), `ADDRESS_IN_USE` (409). Refusal reasons recorded for presses and links that changed nothing: `unknown`, `used`, `expired`, `decided`, `not-owner`, `wrong-channel`, `channel-off`, `chat-in-use`, `address-in-use`. The digit rule (`hasDigit`, both catalogue copies) refuses a decimal digit of any script (Unicode `Nd`); `MAIL_FROM` must hold none (`RELAY_CONFIG_INVALID` at start).
- Recovery (FR-13): `RECOVERY_KEY_INVALID`, `RECOVERY_REACH_INVALID`, `RECOVERY_CREDENTIAL_INVALID` (401), `RECOVERY_NOT_ENROLLED` (404), `RECOVERY_REQUEST_NOT_FOUND` (404), `RECOVERY_REQUEST_LIMITED` (429), `RECOVERY_NOT_CONFIRMED` (409), `RECOVERY_DECLINED` (409), `RECOVERY_EXPIRED` (410), `RECOVERY_KEY_RELEASED` (410). Enrolling needs the paid plan; a request, a check and the release work for an existing enrolment whatever the plan, so a lapsed account can still recover. Revoking a device (`POST /v1/accounts/devices/:deviceId/revoke`, also run by unpairing) revokes its active enrolment in the same transaction (K and the address deleted, open links void); the relay's sweep, about once a minute, does the same for any active enrolment whose device is revoked. Rows of used or removed enrolments and of requests are deleted two days after.
- Backup: listing, download and delete work without the plan, so a lapsed account can take its backups home for thirty days; uploads need the plan.
- Allowance: `PRICING_NOT_SET` (503), `PRICING_INVALID` (server start). A provider HTTP error releases the reservation (`PROVIDER_FAILED`); a network error, timeout or unreadable success keeps it (`PROVIDER_OUTCOME_UNKNOWN`).
- Worker: `CONSENT_REQUIRED`, `JOB_TYPE_UNKNOWN` (404), `JOB_NOT_ENABLED` (409, due dates are stored only after consent). Turning the job off deletes its data. A server-side reminder goes through the relay's `notify` (first channel that is on), one per account per Indian day, and counts against the thirty.
