# Hosted web tier (experimental)

The hosted web tier lets someone use Chausar in a browser without installing anything: they sign in with their email or a passkey, and the server keeps their businesses. It is written as code on branch `b2c/hosted-web`, with PostgreSQL storage added on `b2c/hosted-postgres` and the delivery harness joined on `b2c/integrate`, and tested on one computer. **Nothing is deployed.** Every hosted feature is labelled experimental until a real deploy has been tested, and the screens say so.

The desktop app and local web mode (`npm start`) are unchanged. Hosted mode is a separate server that starts only when asked.

## Run it on this computer

```sh
npm run start:hosted
```

That runs `node platform/runtime/hosted/server.ts --hosted --dev` and serves `http://localhost:4320`. Without `--hosted` (or `CHAUSAR_HOSTED=1`) the server refuses to start.

In development:

- Sign-in links are printed on the server console, not emailed. The page says so.
- The custody key is made once and kept in `data/hosted/dev-custody.key`, so restarts keep working. Never use that key for real accounts.
- Passkeys work on `localhost`, because browsers treat it as a secure site.

The synthetic recordings work here too, in development only:

```sh
CHAUSAR_VENTURE_REPLAY=1 CHAUSAR_VENTURE_MODEL_REPLAY=platform/tests/fixtures/venture/demo/model-replay.json CHAUSAR_VENTURE_GITHUB_REPLAY=platform/tests/fixtures/venture/e2e/github-sync.json npm run start:hosted
```

In PowerShell:

```powershell
$env:CHAUSAR_VENTURE_REPLAY='1'; $env:CHAUSAR_VENTURE_MODEL_REPLAY='platform/tests/fixtures/venture/demo/model-replay.json'; $env:CHAUSAR_VENTURE_GITHUB_REPLAY='platform/tests/fixtures/venture/e2e/github-sync.json'; npm run start:hosted
```

### On PostgreSQL

By default the server keeps everything in encrypted files in its data folder. To keep the account directory and the business vaults in PostgreSQL instead, point it at a database on this computer:

```sh
CHAUSAR_HOSTED_STORAGE=postgres CHAUSAR_HOSTED_POSTGRES_URL=postgres://chausar:password@127.0.0.1:5432/chausar npm run start:hosted
```

The server makes its two tables on first start. It needs the `pg` package (`npm install`), which loads only when PostgreSQL is turned on. See [PostgreSQL storage](#postgresql-storage) for how it works and what it doesn't do yet.

## How it fits together

```
browser
  |  https (http only on localhost in development)
  v
hosted server                          platform/runtime/hosted/server.ts
  |-- sign-in and sessions             accounts.ts, webauthn.ts, cbor.ts, mailer.ts
  |-- account directory, sealed        directory.ts, custody.ts
  |-- rate and budget limits           limits.ts, models.ts
  |-- request router                   app.ts
  '-- actor runtime                    runtime/local.ts (runtime/rivet.ts is the planned seam)
        '-- one actor per business: an Engine over its own encrypted vault
              files:      data/hosted/tenants/<tenant id>/<business id>/
              PostgreSQL: one row per business, slot hosted.<tenant id>.<business id>
```

The browser loads two things. The front page (`app/hosted/`) signs people in and lists their businesses. The app itself (`/app/`) is the same `app.js` and `launch.js` the desktop uses; one meta tag tells it it runs hosted, so it asks for no passphrase, shows the seven launch places without the back office, and sends people back to the front page to sign in.

## Signing in

There are no passwords anywhere, so none can leak.

| Way in | How it works |
|---|---|
| Email link | The person types their email. The server makes a random token, keeps only its SHA-256, and sends a link (`/#signin=...`). The link works once, for fifteen minutes, and only in the browser that asked for it: that browser holds a random value in an HttpOnly cookie, and the server checks it. A forwarded link signs nobody in. The first link makes the account. |
| Passkey | After signing in with a link, the person can add a passkey. Adding one needs a session younger than fifteen minutes, so an old stolen session can't plant its own key. Sign-in with a passkey needs no email: the browser offers the passkeys it has for this site. |

Passkeys are checked with Node's own crypto and no new packages: a small CBOR reader, COSE keys for P-256, Ed25519 and RSA, the exact origin, the relying party hash, user presence and user verification, and the signature counter. Attestation is not used to trust a device maker; `none` is accepted, and `packed` only after its signature checks.

Sessions are random tokens in an HttpOnly, SameSite=Strict cookie (with Secure and the `__Host-` prefix on https). The server keeps only their hashes. A session ends after three idle days or fourteen days in all, on sign-out, or when the account passes twenty sessions (the oldest goes). "Sign out everywhere" ends them all.

Each request to `/api/rpc` also carries a bearer the page gets from `/api/hosted/session`. It is an HMAC of the session id, so the server stores nothing extra, and it only works beside its own cookie.

## Starting without an account

Someone can start a business before giving an email (Ink v2 wave 4, package 4J23; `hosted/trial.ts`). It is off unless the server starts with `CHAUSAR_HOSTED_TRIALS=1`; with `--dev` it is on unless set to `0`. When it is off, `POST /api/hosted/trial` answers `HOSTED_NOT_AVAILABLE` and the session view carries `trials: false`. Claiming stays open either way.

| Route | What it does |
|---|---|
| `POST /api/hosted/trial` with `{}` | Starts a trial: an account with no email, its own tenant and one session cookie (HttpOnly, like every session). A browser that already holds a live trial gets that same one back. A signed-in account is refused (`ALREADY_SIGNED_IN`): it starts businesses from the account. |
| `POST /api/hosted/trial/claim` with `{ email }` | "Add your email": sends a link that keeps the business. It is a sign-in link in every way: single use, fifteen minutes, this browser only, and the same answer whether or not the email has an account. Three per trial in all. |
| `POST /api/hosted/trial/claim/passkey` with `{ credential }` | After `POST /api/auth/passkey/login/options`: signs in with an existing account's passkey and moves the business to that account. |

The email travels only in the request body, and the link uses the sign-in link's own `/#signin=` pattern. The server keeps no email and no network address for a trial.

**How long it lasts.** 7 days from its last use; any request of its session counts, written at most every five minutes. While it has no business, an hour. The session view (`me.trial`, and `hosted.trial` in `workspace.status`) says "This business is temporary until you add your email." In its last day it adds "This business will be deleted within a day unless you add your email." Once it has ended, its cookie answers "This temporary business has ended. Start again."

**What a trial can't do.** Each answers `TRIAL_LIMIT` with plain words:

- **One business, ever.** A second `workspace.create` is refused, also after the first was deleted (the directory keeps `businessStartedAt`).
- **No invoice issued and no payment recorded for real.** The hosted app refuses `venture.invoice.issue`, `venture.payment.record`, `venture.payment.clear`, `venture.credit.issue` and `venture.bills.pay` before anything is journalled. The engine's own write path (`ventureAction` in `venture/records.ts`) refuses the records themselves on any other way in, such as Issue on Today or a bank row: an issued invoice, a payment, an issued credit note, a bill with a payment on it. Drafts are fine.
- **Nothing published or sent from the server.** The hosted app refuses `venture.share.create`, `venture.share.request` and `venture.bank.alerts.set`; the engine refuses a client share link, a client file request and a bank alert address.
- **A small vault.** At most 8 MB as stored (the encrypted vault). The vault store itself checks every write, whoever makes it (a venture action, the record of an AI call, the engine's own writes): one that grows the vault past the cap is refused ("This temporary business is full.") and nothing is written, so an AI call whose record would not fit never leaves; one that keeps the size or makes it smaller always passes, so deleting works.
- **No passkey** until it has an email.

Plans, orders, the delivery harness and Today work as they do for an account.

**AI.** Only on the owner's own key: a call that does not carry the key the owner connected never leaves the server. A trial gets USD 2 a month and 20 calls a minute, and the same two calls at once as an account. The server holds no AI key and pays for no call.

**Claiming.**

| Case | What happens |
|---|---|
| A new email | The trial becomes that account where it stands: same tenant, business and vault, the email set, the end gone. |
| An existing account (its email link or its passkey) | The business moves to the account. Its vault stays in the trial's tenant folder (or row `hosted.<trial tenant>.<business>`) and opens with the key sealed for that tenant (`vaultTenantId` in the directory), so nothing is copied on disk and one directory change does it all. The trial's AI spend this month joins the account's ledger, so the account's ceiling counts it, and the AI rate and the two-at-once gate count toward the account. The trial's account is removed. |
| An account with no room | `LIMIT_REACHED`. The link stays unused, so it works once a business is deleted. |
| A trial that ended or is being deleted | The link signs in and keeps nothing. |

Either way the trial's session ends, and the phone alerts turned on during the trial end with it, as for a revoked session. The page turns them on again from the account's session.

**What expiry deletes.** Housekeeping looks once a minute and deletes at most 20 trials a round. For each one it:

1. marks the trial as ending, so a claim or a use that lands after this can't keep it;
2. ends its sessions' phone alert subscriptions;
3. deletes each vault through the runtime, with the business's own name: the vault file or PostgreSQL row, the business folder, and everything inside the vault (its records, alerts and push subscriptions). A vault that won't open for a known reason is removed without opening (its folder, and on PostgreSQL its row by its key); one that fails for no known reason is tried again next round;
4. removes the trial's account from the directory, with its sealed vault keys, sessions, passkey challenges, claim links, AI usage ledger and share link index;
5. removes the tenant folder, and in this process the actor and whether its owner was watching.

The tenant key is derived from the custody key and was never stored. The limit on trials per network lives in this process's memory, keyed by the address (an IPv6 address by its /64); housekeeping forgets each bucket once it has filled up again.

## Who holds the keys

Each business is its own encrypted vault, the same format as the desktop's. On the hosted server nobody types a passphrase. Instead:

1. A master key comes from the server's environment (`CHAUSAR_HOSTED_CUSTODY_KEY`, 32 random bytes).
2. HKDF turns it into one key per tenant.
3. Each business gets a random vault passphrase. Only its sealed form is kept: AES-256-GCM under the tenant's key, bound to the tenant and the business, so a sealed passphrase copied to another tenant or business never opens.
4. The account directory (emails, passkeys, sessions, sealed passphrases, usage) is sealed under the same master key and written whole on every change, to a file or to one PostgreSQL row.
5. The web push key pair for phone alerts (VAPID) is derived from the master key too, so every server process has the same one and it is never written anywhere. **Rotating the custody key breaks every phone alert subscription**: each browser has to turn phone alerts on again.

**This is server custody, not end to end encryption.** Whoever holds the master key can open every vault on the server. The page tells the owner the server keeps the key, and shows the vault's recovery code once; the server never stores it.

## Tenancy

- Every account gets a tenant id at sign-up. Every business gets a business id. Both are made by the server, and both are shaped so they can never be a path.
- A request never names a tenant. The server takes it from the session, and a request can open only a business on its own user's list.
- Each business has its own folder, vault key and actor, under `data/hosted/tenants/<tenant id>/`. On PostgreSQL it also has its own row, and the folder keeps only the vault's writer lock.

The tests sign in two people and check that neither can open, select or read the other's business, and that one tenant's sealed key never opens under the other.

## One actor per business

The runtime follows Rivet Actors' shape, so a hosted adapter can map onto real Rivet Actors later. Business data stays in the encrypted vault; actor state holds pointers only.

| Contract (`runtime/contract.ts`) | Rivet Actors | Local runtime (`runtime/local.ts`) |
|---|---|---|
| `create(key, input)` | `client.venture.create(key, { input })` | makes the business's vault; returns the recovery code once |
| `get(key)` | `client.venture.get(key)` | never creates |
| `handle.action(name, input, caller)` | `handle[name](input)` | the engine method of that name, as the owner, on channel `web` |
| declared actions | `actions: { ... }` | the venture methods, `workspace.status` and `receipts.get` |
| `handle.on(event, listener)` | `conn.on(event, ...)` | the declared venture events, read after each action |
| commit per action | `c.saveState({ immediate: true })` | every action commits through `ventureAction` or changes nothing |
| sleep and wake | `onSleep`, `onWake` | after fifteen idle minutes, or when the server needs room; wakes on the next action |
| `destroy(key, name)` | `c.destroy()` | deletes the vault and the folder after the name is typed |

An actor wakes by opening its vault with the passphrase from custody. Sleeping closes the vault and drops every key typed into it, the same as a restart on the desktop. The server keeps at most 200 businesses awake and sleeps the one idle longest when it needs room.

The Rivet adapter (`runtime/rivet.ts`) is written against structural types, because `rivetkit` is not a dependency. It is checked only against an in-memory stand-in, so every capability it declares says planned, and the server refuses `CHAUSAR_VENTURE_RUNTIME=rivet`.

## PostgreSQL storage

`CHAUSAR_HOSTED_STORAGE=postgres` moves both stores into PostgreSQL. It's written and tested against a stand-in that answers the same statements. The checks against a real PostgreSQL server are a separate qualification run, `platform/tests/qualification/hosted-postgres-real.test.ts`, which reads the database from `CHAUSAR_TEST_POSTGRES_URL`. It passed on 16 October against a throwaway PostgreSQL 17.11 server on this computer (see [How it was checked](#how-it-was-checked)). It stays experimental until a real deploy has been tested.

**The account directory** is one row in `chausar_hosted_directory`: the same sealed value the file store writes, plus a revision number. PostgreSQL sees ciphertext only. A change works like this:

1. The server opens a transaction and takes this directory's advisory lock (`pg_advisory_xact_lock`), so server processes take turns. The lock is held only while one change runs and is released at commit.
2. Inside its turn it loads the newest row, runs the change on a copy and seals the result.
3. It writes with compare and set: `UPDATE ... WHERE revision = <the revision it loaded>`. The first write is an `INSERT ... ON CONFLICT DO NOTHING`.
4. If no row changed, something wrote without taking the turn (an older server, say). The server runs the change again in a new turn, up to ten times, then answers "busy" (503).

So two processes never overwrite each other, and the checks inside a change (a sign-in link is used once, a business count, a passkey not on another account) hold across processes. The tests send two servers at one sign-in link: one signs in, the other is refused.

Why turns: the first version only used compare and set. On a real PostgreSQL 17 server, a server writing back to back kept winning, and a slower one lost every retry and answered "busy". The stand-in never showed this; the real-server qualification run did, three times out of three. With turns that run passes.

Each server keeps the last value it saw in memory and catches up at the start of every API request, with one small query for the revision. A session made on one process works on the next request to another. The row's revision only goes forward: if it ever goes back (an older copy put back while a server runs), that server refuses to carry on until it restarts.

**Business vaults** use the engine's own PostgreSQL adapter, the one the desktop uses: one row per business in `chausar_vault_authority`, ciphertext only, with its own compare and set. The slot is `hosted.<tenant id>.<business id>`, made from the ids alone. So the same business opens on any server whatever its data folder, and a hosted slot can never match a desktop one (those are hex digests). The business folder on disk keeps only the vault's writer lock. Deleting a business deletes its row.

All businesses share one pool of 10 connections per server process. The engine keeps the same preview profile as on file storage: exact integer arithmetic, labelled experimental.

**How the server reaches its database.** Chausar dials PostgreSQL only on this computer's loopback (`127.0.0.1` or `::1`), with TLS off, the same rule the desktop's adapter has always had. `CHAUSAR_HOSTED_POSTGRES_URL` with any other host, or with query options like `sslmode`, is refused. A deploy reaches a managed database through a proxy on the server's own loopback that carries the TLS, such as the cloud provider's database proxy, or PgBouncer set to verify the database's certificate. We chose this because:

- one rule covers the desktop and the server, and the desktop adapter doesn't change;
- Chausar ships no TLS settings it could get wrong (`sslmode=require` without verifying the certificate is a common trap);
- the database's certificates and credentials stay with the proxy, which the provider maintains.

The cost is one more process to run and watch, and its TLS settings have to be checked as part of the deploy. Dialing a remote host directly, with verified TLS, is planned if a deploy can't run a proxy.

**What it doesn't share yet.** PostgreSQL shares the directory, the sessions in it, the AI usage ledger and the vaults. It does not make more than one process safe on its own:

- Rate limits, the "two AI calls at once" gate and open event streams are counted in each process's memory. With N processes, each limit is N times as loose.
- The monthly AI ceiling reads the shared ledger, but each process checks it alone, so a month can pass the ceiling by up to two calls per process.
- Each business needs one process at a time. If two processes wake the same business, the second one's writes are refused with `REVISION_CONFLICT` (nothing is lost or overwritten), and that process can't write to it again until the business sleeps. A load balancer has to send each business to one process, which is the job the Rivet runtime would do.
- The directory is one row, rewritten whole on every change. That suits a small number of accounts; a table per kind of record comes later.

## AI on the hosted server

Key-only. The two command-line options (Claude Code and Codex) say "Runs only in the desktop app" and can't be connected; the hosted transport refuses to start any process. Keys live in the server's memory only, never on its disk, and go when the business sleeps.

## Delivery agents on the hosted server

The delivery harness ([harness.md](harness.md)) runs here too. Agents work on the files the owner adds to an order with tools in a bounded loop, each turn of a real order waits for the owner's approval of its exact text, and the improvement loop rehearses on the practice clients. The calculator, the checks, the dictionary and reading CSV and XLSX all run inside the business's engine, so none of them starts a process. Everything that would start one is off:

| Part | On the hosted server | Why |
|---|---|---|
| CSV and XLSX files | Read by code in the engine | Nothing to start |
| PDF files | Refused when added (`TIER_UNAVAILABLE`); PDF text is never read here | Reading it needs Chausar's Python helper, which never runs on a shared server |
| Row programs (`sandbox.transform`) | Refused (`TIER_UNAVAILABLE`); the agent isn't offered the tool | Off until the founder decides whether agent-written code may run on a shared server |
| Python in a container (`sandbox.python`) | Refused (`TIER_UNAVAILABLE`); not offered; nothing checks for Docker | Containers never run on a shared server |
| Bills picked from PDFs (`bills.pick`) | Refused (`TIER_UNAVAILABLE`); not offered | Needs PDF text |

A playbook keeps the tools it grants. The host decides only what the agent is offered and what runs: a call to a refused tool comes back to the agent as a `TIER_UNAVAILABLE` envelope with the reason, before its input is read. The capability list's light sandbox and container rows use the same words, and its agent tools row says PDFs and agent-written code are off here.

Bookkeeping's work product still works here. `books.reconcile` reads the bank statement and the bills from CSV or XLSX with code and adds with BigInt, so a reconciled month needs no sandbox. Without row programs the agent can't make its own match keys, so matching uses the other three passes: a bill number in the bank text, the same amount and the supplier's name, then an amount that is unique on both sides. A test runs a real order on a hosted host this way: the agent reads both files, its row program and Python calls are refused, and the month reconciles and balances with receipts.

One more limit comes from the server itself: a request body is at most 256 KB, so a file added here can be at most about 190 KB (it travels base64 encoded), against 1.45 MB on the desktop. A larger one is refused with `REQUEST_TOO_LARGE` before it reaches the engine.

## Limits

| Limit | Default | Where |
|---|---|---|
| Sign-in emails per address | 5, one more every 12 minutes | `accounts.ts` |
| Sign-in emails per network | 20, one more every 3 minutes | `accounts.ts` |
| Sign-in attempts per network | 30, one more every 2 minutes | `accounts.ts` |
| Requests per session | 120, one more every quarter second | `app.ts` |
| AI calls per account | 60, one more every minute | `models.ts` |
| AI calls at once per account | 2 | `models.ts` |
| AI spend per account per month | USD 20 (`CHAUSAR_HOSTED_AI_CEILING_MICROS`) | `models.ts` |
| GitHub checks per account | 10, one more every 3 minutes | `app.ts` |
| Businesses per account | 3 (`CHAUSAR_HOSTED_BUSINESSES_PER_ACCOUNT`) | `app.ts` |
| Passkeys per account | 10 | `accounts.ts` |
| Businesses awake per server | 200 | `runtime/local.ts` |
| Request body | 256 KB | `server.ts` |
| Open event streams per account | 3 | `server.ts` |
| New trials per network (an IPv6 address by its /64) | 3, one more every 20 minutes | `accounts.ts` |
| Trials at once on the server | 500 (`CHAUSAR_HOSTED_TRIALS_LIVE`) | `accounts.ts` |
| How long a trial lasts | 7 days from its last use (`CHAUSAR_HOSTED_TRIAL_IDLE_DAYS`); an hour with no business | `trial.ts` |
| Requests per trial session | 60, one more every half second | `app.ts` |
| AI calls per trial | 20, one more every minute | `models.ts` |
| AI spend per trial per month | USD 2 (`CHAUSAR_HOSTED_TRIAL_AI_CEILING_MICROS`) | `models.ts` |
| A trial's vault | 8 MB as stored (`CHAUSAR_HOSTED_TRIAL_VAULT_BYTES`) | `runtime/business.ts` |
| Claim links per trial | 3 in all | `accounts.ts` |
| Trials deleted per housekeeping round | 20 | `app.ts` |

Every limit keyed by a network address takes the address the connection came from or, behind trusted proxies, the `X-Forwarded-For` entry as many from the right as there are proxies: `CHAUSAR_HOSTED_TRUST_PROXY=1` (or `true`) takes the last entry, the one the one proxy appended; `=2` the second from the right, for a load balancer behind a CDN; up to 10. Every entry before it came from the browser, which can write anything there. A header with fewer entries than that did not pass every proxy, and the connection's own address is used. Housekeeping forgets each rate bucket once it has filled up again, so no address is held past its own window.

AI calls are paid on the owner's own key, so the monthly ceiling is a safety stop above each connection's own limit. It is a BigInt sum of the costs the model port already worked out in code; nothing estimates a price. With two calls allowed at once, a month can pass the ceiling by at most those two calls.

## What the page can call

The front page signs in and lists businesses. `/api/rpc` accepts only:

- `venture.countries` and `venture.preview`, before any business;
- `workspace.status`, `workspace.create` (a name only), `workspace.open` (a business id from the list), `workspace.lock`, `workspace.delete` (the exact name);
- every other venture method, the delivery harness's included (with the limits in [Delivery agents on the hosted server](#delivery-agents-on-the-hosted-server)), and `receipts.get`.

Everything else answers `HOSTED_NOT_AVAILABLE`: backups and exports to the server's disk, the back office's file imports, plugins, the Python helper, MCP, the conversation views and the rest of the back office. Those stay in the desktop app.

## Phone alerts

An owner can turn on phone alerts in a browser (Business > Notifications). The server's service worker (`/app/sw.js`) shows one notification, "Chausar" with "3 need you", and a tap opens the approval page; nothing is decided from the notification.

- Each push carries `{"count":N}` and nothing else, encrypted for that browser (RFC 8291), with a TTL of one hour. The push service sees the browser's own address, a fixed topic and the server's signed token, never a name or a figure.
- Only endpoints on the known push services are accepted (Google, Mozilla, Microsoft, Apple), and each push goes through the network guard with no redirects.
- A subscription belongs to the session that made it. It counts only while that session is live, so signing out or a session ending stops its alerts, and the next look deletes it.
- Each try is one action journal entry holding the count, the push service's host and the outcome. 404, 410, 401 and 403 remove the browser; three failing deliveries in a row remove it too.
- Phone alerts come while Chausar is awake for this business: the server looks at each awake business once a minute, and a sleeping one is not woken for it. The pause, quiet hours, the digest and the pacing of the notification centre hold as on the desktop.

## Honest labels

| Part | State | Why |
|---|---|---|
| Hosted business actors | experimental (`unverified`) | Tested on one computer, not on a real deploy |
| Event push to the page | experimental (`unverified`) | Same |
| Storage | experimental | Encrypted files on one server, or PostgreSQL. PostgreSQL is checked against a stand-in only, not yet a real server or a real deploy. On the hosted server the storage row says `unverified` and invoices keep their practice notice on either store. |
| Email sign-in | development only | No mail sender; links print on the console |
| Passkeys | experimental | Checked with a software authenticator in tests, not yet with real devices on a real domain |
| Rivet Actors adapter | planned | In-memory stand-in only |
| Schedules, cron, queues, workflows | planned | No venture action needs them yet |
| Containers and plugins | unavailable on hosted | Never on a shared server; nothing checks for Docker there |
| Agent-written code (the light sandbox) | unavailable on hosted | Off until the founder decides; the desktop app runs it |
| PDF reading (the Python helper) | unavailable on hosted | The helper never runs on a shared server, so PDFs are refused when added |
| Command-line AI | unavailable on hosted | Desktop only |
| Phone alerts (web push) | experimental (`unverified`) | The encryption matches RFC 8291's own example; not yet sent to a real push service from a real deploy |
| Starting without an account | experimental, off by default | The routes and the session view are tested on one computer; no screen offers it yet |

## What a real deploy needs

Each of these is outside this branch. The labels above change only after the deploy that covers them has been tested.

1. **A domain and TLS.** Either certificate files (`CHAUSAR_HOSTED_TLS_CERT`, `CHAUSAR_HOSTED_TLS_KEY`) or a TLS proxy in front (`CHAUSAR_HOSTED_TLS_PROXY=1`, and `CHAUSAR_HOSTED_TRUST_PROXY=1` if the proxy sets `X-Forwarded-For`, or the number of proxies in a chain). The proxy must pass the original `Host` header. The server sends HSTS on https.
2. **The custody key in a secret store.** `CHAUSAR_HOSTED_CUSTODY_KEY` opens every vault. It needs a managed secret store or KMS (planned), a backup kept apart from the data, and a rotation plan; rotation is not built, and rotating it would also break every phone alert subscription.
3. **A mail sender.** SMTP or a mail API under the operator's account, with SPF, DKIM and DMARC on the sending domain. Not built: `CHAUSAR_HOSTED_MAILER` accepts only `none` outside development. Without it, new people can't sign up; existing people can sign in with passkeys.
4. **Durable storage.** The PostgreSQL path is written ([PostgreSQL storage](#postgresql-storage)). A deploy still needs: a managed PostgreSQL with backups and a tested restore; the TLS proxy on the server's loopback, with its certificate checks confirmed; and a passing qualification run against a real server: `npm install` (for `pg`), then `CHAUSAR_TEST_POSTGRES_URL=postgres://user:password@127.0.0.1:5432/db node --test platform/tests/qualification/hosted-postgres-real.test.ts` on a disposable database. It runs the two real directory and vault checks and the runtime conformance suite on real rows. After a restore, restart every server process: each one refuses a directory that went back.
5. **One server process, or shared state.** File storage holds a lock, so one process serves one data folder. On PostgreSQL the directory, sessions and usage ledger are shared, and more than one process can serve them. Still per process: rate limits, the AI concurrency gate and event-stream counts. Each business also needs one process at a time, so a load balancer must send each business to one process (or the Rivet runtime places them). Until a shared rate-limit store and that routing exist, run one process.
6. **The real actor runtime.** Run the runtime conformance suite (`runtimeConformance` in `platform/tests/hosted-runtime-conformance.ts`) against a real Rivet engine on Linux before the Rivet adapter is labelled anything but planned.
7. **Operations.** Logs without secrets or client text, monitoring, abuse handling, account and data deletion requests, a privacy notice and terms, and an incident plan.
8. **Review.** A security review and a test of passkeys and email links on the real domain with real devices.

## Settings

| Variable | Meaning |
|---|---|
| `CHAUSAR_HOSTED=1` or `--hosted` | Turns hosted mode on. Off by default. |
| `--dev` | Development: `http://localhost`, the console outbox, a development custody key file, recordings allowed |
| `CHAUSAR_HOSTED_ORIGIN` | The public origin, like `https://app.example.com`. Passkeys need a domain, not an IP address. |
| `CHAUSAR_HOSTED_LISTEN`, `CHAUSAR_HOSTED_PORT` | Where the server listens (default `127.0.0.1`, the origin's port or 4320) |
| `CHAUSAR_HOSTED_DATA` | Data folder (default `data/hosted`) |
| `CHAUSAR_HOSTED_CUSTODY_KEY` | 32 random bytes as base64url. Required outside development. |
| `CHAUSAR_HOSTED_TLS_CERT`, `CHAUSAR_HOSTED_TLS_KEY`, `CHAUSAR_HOSTED_TLS_PROXY` | TLS, as above |
| `CHAUSAR_HOSTED_TRUST_PROXY` | With a TLS proxy: `0` (default) trusts no `X-Forwarded-For`; `1` or `true` trusts one proxy and takes the last entry; `2` to `10` for a chain of proxies, taking the entry that many from the right |
| `CHAUSAR_HOSTED_MAILER` | `dev-outbox` (development) or `none` |
| `CHAUSAR_HOSTED_AI_CEILING_MICROS`, `CHAUSAR_HOSTED_BUSINESSES_PER_ACCOUNT` | Limit overrides |
| `CHAUSAR_HOSTED_STORAGE` | `experimental-file` (default) or `postgres`. Both are experimental. |
| `CHAUSAR_HOSTED_POSTGRES_URL` | With `postgres` only: `postgres://user:password@127.0.0.1:port/database` (or `[::1]`). No other host and no query options; a managed database is reached through a TLS proxy on this computer. |
| `CHAUSAR_VENTURE_RUNTIME` | Only `local` starts; `rivet` is refused as planned |
| `CHAUSAR_HOSTED_PUSH` | `1` (default) turns phone alerts on; `0` turns them off, and the app then says they are not set up here |
| `CHAUSAR_HOSTED_PUSH_CONTACT` | The contact the push services see: a `mailto:` or `https:` address. Default: the server's https origin; none over plain http in development |
| `CHAUSAR_HOSTED_TRIALS` | `1` lets people start a business without an account; `0` turns it off. Off by default; on by default with `--dev` |
| `CHAUSAR_HOSTED_TRIALS_LIVE`, `CHAUSAR_HOSTED_TRIAL_IDLE_DAYS`, `CHAUSAR_HOSTED_TRIAL_AI_CEILING_MICROS`, `CHAUSAR_HOSTED_TRIAL_VAULT_BYTES` | Trial limit overrides: trials at once (1 to 100000), days from the last use (1 to 30), whole micro US dollars a month, and vault bytes (1 MB to 256 MB) |

A key can be made with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## How it was checked

On Windows with Node 24.13.1, with no network beyond this computer's loopback and no paid calls:

- `hosted-custody.test.ts`: sealed passphrases open only for their own tenant and business and master key.
- `hosted-webauthn.test.ts`: real P-256, Ed25519 and RSA passkeys from a software authenticator; wrong site, challenge, ceremony, user, signature and counter are each refused.
- `hosted-accounts.test.ts`: email links bound to the asking browser, expiry, rate limits, passkeys from a fresh session, session expiry and limits, account deletion, and the sealed directory file (no email on disk in the clear, one server per folder, a wrong key refused).
- `hosted-limits.test.ts`: token buckets, the concurrency gate, the monthly ceiling, and the transport that applies them and refuses processes.
- `hosted-runtime.test.ts`: the same conformance checks (`hosted-runtime-conformance.ts`) on the local runtime, on the Rivet adapter over its stand-in, and on the local runtime with every vault in the PostgreSQL stand-in, each business a real Engine over a real vault.
- `hosted-postgres.test.ts`, against `hosted-postgres-standin.ts`, which answers the exact statements with PostgreSQL's rules (compare and set, unique slots, advisory locks, revisions as text, JSONB key order): two servers changing the directory at once take turns and lose nothing; two servers sent at one sign-in link sign in once; a session made on one server works on the other after it catches up, and so does signing out; a change that keeps losing to a writer outside the turns gives up and writes nothing; a wrong key, a damaged row and a table put back to an older copy are refused; an unreachable database answers 503; the settings accept loopback only; a business vault is one row that opens from another data folder, and a second writer on the same business is refused rather than lost; and two hosted servers over real sockets share one sign-in, with a business made on the first opened, read and deleted on the second. Removing the turn's lock on purpose fails two of these tests, and removing the per-request catch-up fails the two-server one.
- The qualification run on a real PostgreSQL server, `platform/tests/qualification/hosted-postgres-real.test.ts`, on 16 October against a throwaway PostgreSQL 17.11 server started from the installed programs with its own data folder, port and generated password (the installed server was not touched). It holds the two "real PostgreSQL" tests (two pools on one directory row; a business vault in its own row) and the six runtime conformance checks on the local runtime with every vault in the real database. It sits outside the open suite on purpose: CI doesn't qualify PostgreSQL, and the benchmark fails any shard with a skipped test. Without `CHAUSAR_TEST_POSTGRES_URL` it fails with one test that says so, and it never skips, so it can't pass by accident. First run: 6 of 8 passed. The two failures were a cleanup that closed its pool before deleting its rows (test code), and a real bug: two pools changing the directory at once ended in "busy", because the faster server kept winning compare and set. Directory changes now take turns under an advisory lock (see [PostgreSQL storage](#postgresql-storage)). After the fix: 8 of 8, three runs in a row; with the old directory code put back, the two-pool test failed three runs out of three.
- `hosted-server.test.ts`: the server over real sockets: headers, host and origin checks, cookies, the bearer, the allow-list, two tenants that never meet, the event stream, limits, and the venture journey from the idea to an accepted plan with the synthetic recordings, the cost reaching the account ledger.
- `hosted-trial.test.ts` (4J23), over real sockets: the switch and its settings; a trial and its one business, even after a delete; the session view's line and last-day warning; the end 7 days after the last use and an hour without a business, and everything expiry deletes; a trial being deleted can't be claimed; a vault that won't open is removed only for a known reason; claiming by a new email, into an existing account (asleep and woken again, its share link working) and with a passkey; three claim links; `TRIAL_LIMIT` on the refused methods and, through Today's Issue, in the engine's write path; the size cap; AI on the owner's key only, at the trial's rate and ceiling, keyed by the account at each call; starts per network by /64 and the proxy's own `X-Forwarded-For` entry; the slower request rate; and rate buckets swept.
- The full typecheck with `typescript@5.9.3` against the repo `tsconfig.json`, and `node scripts/check.mjs` (487 files with the PostgreSQL work): both clean.
- After the delivery harness was merged in (branch `b2c/integrate`): `node scripts/check.mjs` (504 files) and the full typecheck, both clean; every `venture-*.test.ts` and `hosted-*.test.ts` file run one after another, 315 tests, 307 pass, 0 fail, 8 skipped (the real PostgreSQL tests, which have since moved to the qualification run); and the parity and shell files (`desktop-harness`, `desktop-ipc-methods`, `desktop-renderer`, `desktop-main`, `desktop-packaging`, `server`), 57 of 57. New tests check that on a hosted host nothing checks for Docker, row programs, Python, containers and PDFs are refused with `TIER_UNAVAILABLE` and not offered, the capability rows use the same words, and a real bookkeeping order reconciles from CSV. Removing any one of those guards on purpose fails at least one of them. The whole suite was not run after the merge.
- One serial full run, `node --test --test-concurrency=1 platform/tests/*.test.ts`, with nothing else running. On `b2c/hosted-web`: 2,777 tests, 2,776 pass, 0 fail, 1 skipped (the DuckDB proof that needs the native module, skipped before this work too), in about 22 minutes. On `b2c/hosted-postgres`: 2,802 tests, 2,793 pass, 0 fail, 9 skipped (that DuckDB proof and the eight real PostgreSQL tests, which have since moved to the qualification run), in about 26 minutes.
- After the real PostgreSQL tests moved to the qualification run: `node scripts/check.mjs` (506 files) and the full typecheck, both clean; every `hosted-*.test.ts` file, 67 tests, 67 pass, 0 fail, 0 skipped; the qualification file without `CHAUSAR_TEST_POSTGRES_URL`, one test, failed as it should; and the benchmark shards that hold the hosted files. `node scripts/bench.mjs --shard=4/5` passed, 706 of 706. `--shard=1/5` ran 653 tests, 652 pass, 0 fail, 1 skipped: the DuckDB proof, because this computer has no `node_modules`. The benchmark refuses any skip, so that shard reports not passed here. The open suite now skips only that DuckDB proof, and only on a computer without the native module. CI installs it, so a CI run skips nothing.
- `npm run start:hosted` with the recordings, in the browser: an email link from the console signed in; the front page listed no business, then started one; the shared app asked for a working name only, made the vault on the server and showed the recovery code once; the seven places opened with no back office and "Hosted, experimental"; a reload kept the session; the command-line AI rows said desktop only and a back office request answered `HOSTED_NOT_AVAILABLE`. At 375 px the front page fit. Passkeys were not tried in the browser: that would raise the computer's own passkey prompt, so they are checked with the software authenticator only.

Known limits:

- An email link opened in a different browser from the one that asked is refused. That stops forwarded links, and it also means asking on a laptop and opening the email on a phone doesn't work.
- A business sleeps after fifteen idle minutes, and any AI key typed into it goes with it.
- The front page and the app's business dialog use the existing styles; the dialog is the back office's light modal.
- Starting without an account has no screen yet: the front page has no button for it and the app no banner (Ink v2 wave 4, 4J21). The routes and the session view are ready for them.
- A trial can ask for three email links in all. After three mistyped addresses, it can be kept only with an existing account's passkey.
- Claiming ends the phone alerts turned on during the trial; they have to be turned on again.
- A business kept by an account that already existed keeps its vault, and its share links, under the trial's tenant id. That is by design, so nothing is copied, but the tenant folder then holds a business of another account.
- The limits on trials per network and per session, like the other rate limits, are counted in each process's memory.
