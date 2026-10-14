# Lane: writeback — the full write catalogue, fakes, Practice

Branch `claude/lane-writeback`. Plan day 7 (actions, the catalogue, the write table, unknown outcomes), architecture piece 10 (the hands), founder decision: full catalogue.

## What a person can do

1. **See what Chausar can do.** `writeback.catalogue` is the written list: one row per action per system. If an action is not on it, it does not exist: asking for it (`writeback.request`, or preparing it) answers "Not in the list yet. It is on the wanted list." and the request is counted on `writeback.wanted`.
2. **Connect a system and grant writing, action by action.** The owner adds a connection (`writeback.connect`) with account identifiers only (organisation id, shop, sender address); secrets stay in the credential broker. A new connection can read but write nothing. The owner grants each catalogue action separately (`writeback.grant`). Reading never grants writing.
3. **Prepare, approve, do, read back, settle.** `writeback.prepare` reads the system and builds the exact change: the text as it will be sent, or each field's before and after. `writeback.approve` says yes to that exact digest. `writeback.execute` looks at the system once more, then acts once and reads back. The result is recorded field by field (`writeback.get`), and the whole record is `writeback.ledger`.
4. **Not sure yet.** If the reply is lost, the action is `unknown` ("not sure"). Chausar never sends again. `writeback.readBack` looks at the system; when the system offers no way to look (WhatsApp without status callbacks, mail without IMAP), a person settles it with "It was sent" or "It was not sent" (`writeback.settle`), recorded as the person's word. The system is always read first: a person's word settles only what the system cannot show, and "not sent" never overrides a system that shows the effect.
5. **Practice.** `writeback.practice` runs any action, a prepared action (`{ actionId }`), or a whole job's list of steps against fresh copies of the systems. It shows the preview, every request that would leave (credentials removed), what the system would hold afterwards and the read-back. Nothing is sent and nothing enters the actions record. Faults can be injected per step ("lose the reply after the system applied it").
6. **Remind a customer who agreed.** `writeback.followUp.*` records consent, prepares a reminder with the invoice balance from the calculator, sends it once after your yes through your mail server or WhatsApp, and journals it as `sent`. `paid` is a separate later entry, only when the books show nothing due and every payment matches exactly one bank line.

## The catalogue (eleven fields per row)

Each row in `platform/runtime/writeback/catalogue.ts` states: system; action; kind (inside and undoable, seen outside, money, cannot be undone); whether it always waits and why; planned status; how it avoids doing it twice; the business reference written into the system; how it reads back; the retry window; how long a yes lasts; when it was reviewed and when it expires. Each row also carries its write-back recipe: required fields, preconditions, the reference, and the read-back query.

| System | Actions | Kind | Always waits |
|---|---|---|---|
| Tally (XML, port 9000, this computer only) | `voucher.create`, `ledger.create` | inside, undoable | no |
| Zoho Books | `invoice.createDraft`, `contact.create`, `contact.update`, `bill.createFromPhoto`, `payment.record` | inside, undoable | no |
| Zoho Books | `invoice.paymentReminder` | seen outside | yes |
| Razorpay | `paymentLink.create` (notifications always off), `refund.create` | money | yes |
| Shopify | `variant.price`, `inventory.set`, `product.status` | cannot be undone | yes |
| Google Workspace | `sheets.append`, `sheets.update`, `calendar.createEvent` (no guests), `drive.createFile` (never shared) | inside, undoable | no |
| WhatsApp Business Cloud | `template.send` | seen outside | yes |
| Your own mail server | `smtp.send` (IMAP read-back optional) | seen outside | yes |
| GST portal | `return.file` | prepare only, forever | yes |

A yes lasts 24 hours for messages, money and irreversible changes, and 7 days for undoable changes inside your own data. The owner can shorten these (`writeback.configure`).

**Status.** A row shows `experimental` until a sandbox run has passed its write-back recipe test on a real sandbox account; the four rows the founder recommended live (Zoho draft invoice, Zoho payment record, the sheet row, the mail reminder) become `live` only then. `writeback.qualify` runs the recipe test against the fakes: (1) applied once and read back, (2) the same effect key again sends nothing, (3) a reply lost after the system applied it is settled by reading back with exactly one effect. Every installed row scores 3/3. This write score is kept apart from the read score.

## How it protects against doing things twice

- **Effect key.** Every action has a stable key from (system, action, connection, intent). The adapter writes a business reference derived from it into the system (Zoho `reference_number`, Razorpay `reference_id` / refund `receipt` plus the `X-Refund-Idempotency` header, Tally `REMOTEID`, Google event id / sheet key column / Drive app property, the mail `Message-ID`, WhatsApp `biz_opaque_callback_data`).
- **Look first.** Before dispatch the service prepares again. An effect already present is read back instead of sent. A changed target (price, contact, balance) drops the yes and prepares again ("The target changed after you approved. It was prepared again; nothing was sent.").
- **The send journal** (`writeback/journal.ts`) is a file outside the vault, in the app's folder, holding only hashes of dispatched effect keys. It is written and flushed before a request leaves. After a restore of an older vault, an approved action whose key is in the journal is never sent again: it is read back, or a person settles it. `writeback.afterRestore` lists such actions.
- **Second ask.** Money and changes that cannot be undone need the passphrase again: `writeback.reauth {id, digest, passphrase}` checks it against the open vault (`Vault.verifyPassphrase`, which changes nothing) and returns a single-use token bound to that action, its exact digest, the member and their permission epoch, valid for two minutes and kept only in memory. `writeback.approve {id, digest, secondAsk}` refuses without it (`REAUTH_REQUIRED`); a token is consumed by any attempt, matching or not. Desktop only; imported text cannot ask.
- **Integrity.** The stored action must still hash to the prepared and approved digest, or nothing is sent (`PREVIEW_CHANGED`).
- **Mail read-back.** With IMAP settings, Chausar opens the Sent folder over implicit TLS (port 993), searches by the Message-ID with `UID SEARCH HEADER Message-ID` (at most 1000 reply lines), and fetches only the To, Subject and Message-ID headers (`BODY.PEEK`, so nothing is downloaded or marked read). A reply that was not sure becomes sure when the copy is found; the same search runs before sending, so a copy already there is never sent again. Tested against a local fake IMAP and SMTP server, including STARTTLS order and a lost reply.
- **Taint.** Anything that read outside text may prepare, but cannot approve, change, drop, execute or settle.
- **Evidence pins.** A reminder cannot be edited into another message (`WRITE_PREPARE_AGAIN`); its recipient must equal the agreed address at dispatch, and the daily caps are checked again on the day of sending. A reminder pins the invoice rows, the customer and the consent. If any of them changes before dispatch (a payment, an undone merge, a new address, a stop), the reminder is cancelled and nothing is sent.

## Invoice follow-up for real customers

Generalised from the synthetic-only host (which is untouched) to real mail and WhatsApp:

- Consent per customer and channel (`writeback.followUp.consent`), with the agreed address. The reminder goes only to that address, never to an address found in an invoice or note.
- Caps: one reminder per customer per day and 20 per day in all (configurable), counted in the business's time zone (default Asia/Kolkata).
- Stop words (`STOP`, `UNSUBSCRIBE`, `BAND KARO`, `RUKO`, and Hindi forms): `writeback.followUp.inbound` compares an observed reply with them, ignoring punctuation and matching whole words anywhere in the reply, and then discards the text. A stop records consent `stopped` and drops waiting reminders.
- The balance comes from the calculator's aging receipt. The text is a fixed English or Hindi template filled from the receipt; no model writes it.
- `sent` and `paid` are two journal entries with two dates (`writeback.followUp.journal`, `writeback.followUp.checkPaid`).

Jobs-ext coordinates through `writeback.followUp.prepare` (a reminder becomes an approval prepared by a job) and `writeback.practice` (job practice runs).

## Engine methods (`writeback.*`)

| Method | Permission | Gives or does |
|---|---|---|
| `catalogue`, `catalogueEntry {system, action}` | read | Rows with status, qualification, write score, connections and grants |
| `wanted`, `request {system, action}` | read / prepare | The wanted list; a request outside the list is refused and counted |
| `settings`, `configure` | read / admin | Approval lifetimes, reminder caps, stop words |
| `connections`, `connect`, `grant`, `disconnect` | read / admin | Connections and per-action write grants |
| `prepare {connectionId, action, payload, intentId, sourceIds?}` | prepare | The exact change, as a view with its `approval` in the design's `Approval` shape |
| `change {id, payload}` | prepare | A new exact change; the yes is gone |
| `reauth {id, digest, passphrase}` | approve | The second ask for money and irreversible changes: a single-use, two-minute token |
| `approve {id, digest, secondAsk?}`, `drop {id}` | approve | Yes to the exact digest (with the token where needed); drop |
| `credentials.set {connectionId, secret}`, `credentials.remove`, `credentials.status` | admin / read | A connection's own sealed credential (desktop only); status never shows a secret |
| `execute {id}` | prepare | Look first, do once, read back, settle |
| `readBack {id}`, `settle {id, said}` | prepare / approve | Settle an unknown result by looking, or by a person's word |
| `reconcile`, `afterRestore` | admin / read | Read back every unknown; list what may already have gone out |
| `ledger {limit?}`, `get {id}` | read | The record with five steps and the field-by-field read-back |
| `practice {steps} \| {actionId}`, `practiceRuns` | prepare / read | Practice runs |
| `qualify` | admin | The write-back recipe test against the fakes |
| `qualifySandbox {connectionId, cases}` | admin, external | The recipe test on a person's sandbox connection; a full pass records `sandbox-verified` and promotes a planned-live row to `live` |
| `followUp.consent`, `followUp.consents`, `followUp.prepare`, `followUp.inbound`, `followUp.checkPaid`, `followUp.journal` | prepare / read / approve | Invoice follow-up |

Every view carries `word` (`waiting-for-you`, `approved`, `doing`, `done`, `not-sure`, `not-done`, `dropped`, `prepare-only`), the five `steps`, `expiresAt`, `notices` (`expired`, `prepared-again`, `already-done`, `looked-first`, `cancelled-evidence`), and an `approval` object matching the design's `Approval` interface (tier, kind, change as written or fields, waits-because rule, `needsSecondAsk` for money and irreversible changes, `can`).

`tick` (autonomy on only) drops expired yeses and preparations and reads back unknown results. It never sends. `purge` removes consents, journal entries, attestations, notices and Practice records derived from a deleted source or a removed action.

Refusal codes reaching the desktop UI are listed on the writeback line of `laneRefusals` in `app/desktop/preload.cjs`.

## Supported and experimental

**Supported** (tested end to end on synthetic data, in the app engine and against the stateful fakes):
- The catalogue, the wanted list and the refusal of anything outside it.
- Per-action write grants separate from read.
- The five steps and the record, approval tied to the exact digest with expiry, look-first, the send journal and the restore drill, not-sure settled by read-back or by a person.
- Practice (single action, prepared action, a job's list of steps, injected faults).
- The write-back recipe test against the fakes (every installed row 3/3).
- Practice connections in demo mode.
- Invoice follow-up rules: consent, caps, stop word, evidence pins, sent and paid as separate entries.

**Experimental** (the code and its real client are written and tested against fakes; no real account has been used):
- Every adapter against the real system: Tally, Zoho Books, Razorpay, Shopify, Google Workspace, WhatsApp Business Cloud, SMTP/IMAP mail.
- The bill-from-a-photo booking in Zoho (`bill.createFromPhoto`).
- WhatsApp read-back, which reads delivery statuses from the hosted relay (`hosted.messageStatuses`, called through the engine; a host option can replace it). Until the relay reports a status the send stays not sure.

## What still needs a person (typed refusals)

- **Credentials.** Live writes use the same sealed credential store as connectors-ext (`connector-credentials` in the app folder, AES-256-GCM, owner-only files, never in the vault). A write connection can link to a signed-in connectors-ext read connection of the same system (`linkTo` on `writeback.connect`), so one credential serves its reads and writes; the read grant still never grants writing, and the owner grants each write action. A system with no read side (your mail server) keeps its own sealed entry, set from the desktop only with `writeback.credentials.set` (key pairs such as Razorpay keys and mail logins are written `id:secret`). `hostOptions` wires this in the installed app; demo mode installs none. The real sign-ins themselves (OAuth apps for Zoho, Google and Shopify, Razorpay keys, Meta's WhatsApp verification and template approval) remain founder or user steps.
- **Sandbox evidence.** Promotion to `live` needs a passing run on a real sandbox (the Zoho trial organisation held by Con, the test sheet, the test mailbox). The synthetic score cannot earn it.

## Decisions for the founder

- `zoho-books payment.record` is classed as an undoable change inside your own books (tier 2, not on the always-waits list), because it records money already received and moves none. If you want recorded payments treated as money (always waits, never grouped), it is a one-line change in the catalogue.

## Gaps

- WhatsApp has no read API; without the relay's status callbacks a WhatsApp send stays `not sure` until a person settles it. The same holds for mail without IMAP, and for a mail server that keeps no Sent copy.
- The Google Drive upload carries content with `Content-Transfer-Encoding: base64` in the multipart body; this matches Google's documentation but is untested against the live service.
- Tally's look-first searches the Day Book 31 days either side of the voucher date; a duplicate number further away is left to Tally's own import check.
- Sandbox qualification (`writeback.qualifySandbox`) is built and tested against a fake standing in for a sandbox; it has not run against a real sandbox account. It cannot stage a lost reply on a real system, so that check stays with the fakes.
- The engine's generic `actions.list` does not show writeback actions (they live in their own ActionService registry so that approval expiry, look-first and the journal cannot be bypassed). Screens read `writeback.ledger`.

## Cross-lane contracts

- **Provided:** `writeback.*` above. `approvals.*` (work-books) can render `view.approval` directly and call `writeback.approve/drop/change/practice`. jobs-ext calls `writeback.followUp.prepare` and `writeback.practice { steps }`.
- **Assumed:** `host.services.calculator.calculate(ctx, { operation: 'aging', … })` (existing). hosted-link's `hosted.messageStatuses({ reference, messageId }) → [{ messageId, status, at, reference }]` (until it exists, read-back stays not sure). connectors-ext's `ConnectorCredentialStore`, `hostCredentialServices` and its connection records (`connections[].{id, group, sourceId}`) for linked credentials; each module builds its own broker over the same files, so two modules may each refresh an expired OAuth token. `Vault.verifyPassphrase` (core helper added by this lane).

## Files

- `platform/runtime/writeback/`: `types.ts` (adapter contract), `catalogue.ts`, `service.ts`, `practice.ts`, `follow-up.ts`, `journal.ts`, `http.ts` (real HTTPS transport and TLS mail dialer), `validate.ts`, `reference.ts`, `systems/*.ts` (one per system).
- `platform/runtime/connector-framework/write.ts`: `catalogueReadback`, the read-back bridge into the ActionService.
- `platform/fakes/`: one stateful fake per system plus `index.ts` (the practice world) and `harness.ts`.
- `fixtures/writeback/`: synthetic seeds and `cases.json` (the recipe test cases).
- Tests: `platform/tests/writeback-*.test.ts`.
