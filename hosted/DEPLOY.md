# Deploying the Chausar hosted services

**Status: written and tested, not deployed.** Nothing in this repository deploys anything. This guide is for the person who later chooses to run the paid-plan services. Every step that needs an account, a contract, a certificate or money is marked **Founder step**.

## What runs

One image (`hosted/Dockerfile`), two roles, one PostgreSQL 16 database:

| Role | Command | Does |
|---|---|---|
| `api` | `node server.ts api` | Accounts (phone OTP), billing, the relay (WhatsApp, Telegram, mail), the link pages, blind backup storage, the model allowance proxy, the worker settings |
| `worker` | `node server.ts worker` | Drains the job queue (message dispatch with retries, due-date reminders, backup pruning) and runs maintenance sweeps about once a minute |
| `migrate` | `node db/migrate-cli.ts` | Applies `db/migrations/*.sql` once each, under an advisory lock. An edited, already applied migration is refused |

The job queue is a table in the same database (`jobs`), claimed with `FOR UPDATE SKIP LOCKED` under a lease, so several workers may run.

## What each part can read

| Part | Holds | Can read business data? |
|---|---|---|
| Relay | Opt-ins, masked addresses (sealed at rest), message status, single-use button tokens as keyed hashes, sealed approval envelopes until collected | No. Messages are fixed templates with no digits, names or amounts. Approval envelopes are sealed by the desktop with a key the server never has |
| Link pages | Nothing | No. The pages hold no data |
| Business status hooks | Per account: the sealed app secret of the business's own Meta app, and for thirty days each status line (message id, status, time, the business's own reference) | No. Customer messages in the same callbacks are ignored and never stored |
| Backup | Encrypted files and their size and SHA-256 | No. The desktop encrypts before upload; the server never receives a key |
| Allowance proxy | Token counts and paise per request | It passes prompts to the provider and does not store prompts or answers. The provider sees what the trust panel allowed |
| Always-on jobs worker | The inputs of each job a person turned on (today: due dates, date only) | **Yes. Not end-to-end encrypted**: the server does the work, so it can read what each job uses. Every reply and screen says so |

## Configuration (`hosted.env`)

Write `hosted/hosted.env` (never commit it) and `hosted/secrets/db_password`.

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://chausar:<password>@db:5432/chausar_hosted` |
| `HOSTED_PEPPER` | yes | At least 32 random characters. Keys every stored hash of a token or code, and the at-rest sealing of addresses. Rotating it signs everyone out and voids pending buttons |
| `LINK_ORIGIN` | yes | `https://` origin of the link pages, with **no digit in it** (messages must hold no digit), for example `https://link.chausar.app` |
| `PORT` | no | Default `8080` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | for sign-in | SMS for phone OTP. Without them sign-in refuses `OTP_PROVIDER_NOT_CONFIGURED`. **Founder step:** a Twilio account and DLT registration of the sender and the OTP template in India |
| `OTP_GLOBAL_PER_HOUR`, `OTP_ADDRESS_PER_HOUR` | no | Sign-in codes sent per hour across the server (default 300) and per client address (default 20), on top of the per-phone limits. They cap the SMS bill |
| `TRUST_PROXY` | no | `1` when the TLS proxy in front of `api` sets `X-Forwarded-For` to the client address (replacing any value the client sent: nginx `proxy_set_header X-Forwarded-For $remote_addr;`, Caddy does so by default). Only then is the per-address limit applied, keyed on the first entry; only a keyed hash of the address is stored. Default `0`: the per-address limit is skipped |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_ID`, `RAZORPAY_WEBHOOK_SECRET` | for billing | Without them checkout refuses `PAYMENT_PARTNER_NOT_CONFIGURED`. **Founder step:** a Razorpay account, KYC, the plan and the webhook |
| `BILLING_PAID_PRICE_PAISE` | for billing | Whole paise as digits. Absent: the price is shown as "not set", never zero |
| `BACKUP_DIRECTORY`, `BACKUP_QUOTA_BYTES` | for backup | A mounted volume. Without a directory backup refuses `BLOB_STORE_NOT_CONFIGURED` |
| `ALLOWANCE_MONTHLY_PAISE` | for the allowance | The monthly grant of the paid plan, whole paise above zero. Absent: the grant is shown as "not set" (never zero) and the allowance stays off |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | for the allowance | Provider keys stay on the server. A missing key refuses `PROVIDER_NOT_CONFIGURED` for that route |
| `ALLOWANCE_PRICING_JSON` | for the allowance | The dated pricing table (`checkedOn`, `source`, `fxPaisePerUsd`, per-model prices in micro-dollars per million tokens). Absent: every request refuses `PRICING_NOT_SET`. A person checks it against the providers' published prices and dates it |
| `HOSTED_API_ORIGIN` | for allowance credentials and business status hooks | This server's public `https://` origin (for example `https://api.chausar.app`). Each allowance credential names `<origin>/v1/allowance/responses` as its endpoint, and business status hook URLs use it. Absent: `POST /v1/allowance/credentials` refuses `ALLOWANCE_ENDPOINT_NOT_SET` |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | for WhatsApp | **Founder step:** Meta business verification, a WhatsApp Business number, and approval of the four templates named in `shared/templates.ts` (`chausar_week_ahead_ready`, `chausar_review_ready`, `chausar_document_received`, `chausar_due_date_near`), each with a URL button whose suffix is the link token, and `chausar_review_ready` also with two quick-reply buttons. Also a written reading of WhatsApp's business terms (general AI assistants are not allowed): Chausar sends only these templates and fixed replies |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME`, `TELEGRAM_WEBHOOK_SECRET` | for Telegram | **Founder step:** create the bot with BotFather and set its webhook to `https://<api>/v1/webhooks/telegram` with the secret token |
| `POSTMARK_SERVER_TOKEN`, `MAIL_FROM` | for relay mail | **Founder step:** a Postmark server and a verified sending domain (SPF, DKIM) |
| `POSTMARK_INBOUND_USER`, `POSTMARK_INBOUND_PASSWORD` | for HELP and STOP by mail | Basic credentials the relay expects on Postmark's inbound webhook (user 8 to 128 of letters, digits, `_.-`; password 16 to 256 of letters, digits, `_.~-`). **Founder step:** an inbound address (or domain) in Postmark whose webhook is `https://<user>:<password>@<api>/v1/webhooks/mail/postmark`, with the sending address's replies going to it. Absent: inbound mail refuses `MAIL_PROVIDER_UNKNOWN` |
| `MAIL_INBOUND_HMAC_SECRET` | no | For another inbound mail provider or a forwarder: posts to `/v1/webhooks/mail/hmac` signed `x-chausar-mail-signature: sha256=<hex>` with this secret |
| `RELAY_PRICES_JSON` | no | Dated per-message cost per channel in paise. Absent: counts show the cost as unknown, never zero |

## Steps

1. **Founder step:** choose a host in India (data residency), a domain for the API and a digit-free domain for the link pages, and TLS certificates. Put a TLS-terminating proxy (Caddy, nginx or the host's load balancer) in front of `api` on port 8080. The services speak plain HTTP behind it and must not be exposed without TLS.
2. Write `hosted.env` and `secrets/db_password` with mode `0600`.
3. `docker compose build && docker compose up -d`. The `migrate` service runs before `api` and `worker` start.
4. Check `GET /healthz` and `GET /readyz`.
5. Point the providers' webhooks at `/v1/webhooks/whatsapp`, `/v1/webhooks/telegram`, `/v1/webhooks/mail/postmark` (with the basic credentials in the URL) and `/v1/billing/webhooks/razorpay`. Each business that uses its own WhatsApp Business account points its own Meta app at the hook URL the desktop shows it.
6. Back up the database (point-in-time recovery) and the backup volume. The backup volume holds only ciphertext, but losing it loses people's off-site copies.

## Operating rules

- Logs carry codes and ids only: never a phone number, an address, a token, a prompt or an answer.
- Mail turns on only after the address owner presses the confirmation link (a day long, single use, at most three mails per account a day). Inbound mail is answered only for a confirmed address.
- HELP requests land in `relay_help_requests`; a person answers them. Nothing automatic replies beyond the fixed texts.
- STOP is honoured at once and kept until the person turns messages on again in the desktop app.
- Link lifetimes: Approve and Not now are single use and expire thirty minutes after the message is queued; they are offered only on WhatsApp and Telegram, where a press counts only from the owner's number or chat. The Open the app link (`/l/<token>`) stays usable for seven days because it decides nothing and holds no data: whoever opens it, forwarded or late, only reaches the app's own screen. Mail carries Open the app only.
- Approval envelopes go back only to the desktop install (device) that sent the offer.
- Never send a free-form message from the operator side through the relay; the catalogue is fixed and tested to hold no digit.
