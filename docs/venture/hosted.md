# Hosted web tier (experimental)

The hosted web tier lets someone use Chausar in a browser without installing anything: they sign in with their email or a passkey, and the server keeps their businesses. It is written as code on branch `b2c/hosted-web` and tested on one computer. **Nothing is deployed.** Every hosted feature is labelled experimental until a real deploy has been tested, and the screens say so.

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
              data/hosted/tenants/<tenant id>/<business id>/
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

## Who holds the keys

Each business is its own encrypted vault, the same format as the desktop's. On the hosted server nobody types a passphrase. Instead:

1. A master key comes from the server's environment (`CHAUSAR_HOSTED_CUSTODY_KEY`, 32 random bytes).
2. HKDF turns it into one key per tenant.
3. Each business gets a random vault passphrase. Only its sealed form is kept: AES-256-GCM under the tenant's key, bound to the tenant and the business, so a sealed passphrase copied to another tenant or business never opens.
4. The account directory (emails, passkeys, sessions, sealed passphrases, usage) is sealed under the same master key and written whole on every change.

**This is server custody, not end to end encryption.** Whoever holds the master key can open every vault on the server. The page tells the owner the server keeps the key, and shows the vault's recovery code once; the server never stores it.

## Tenancy

- Every account gets a tenant id at sign-up. Every business gets a business id. Both are made by the server, and both are shaped so they can never be a path.
- A request never names a tenant. The server takes it from the session, and a request can open only a business on its own user's list.
- Each business has its own folder, vault key and actor, under `data/hosted/tenants/<tenant id>/`.

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

## AI on the hosted server

Key-only. The two command-line options (Claude Code and Codex) say "Runs only in the desktop app" and can't be connected; the hosted transport refuses to start any process. Keys live in the server's memory only, never on its disk, and go when the business sleeps.

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

AI calls are paid on the owner's own key, so the monthly ceiling is a safety stop above each connection's own limit. It is a BigInt sum of the costs the model port already worked out in code; nothing estimates a price. With two calls allowed at once, a month can pass the ceiling by at most those two calls.

## What the page can call

The front page signs in and lists businesses. `/api/rpc` accepts only:

- `venture.countries` and `venture.preview`, before any business;
- `workspace.status`, `workspace.create` (a name only), `workspace.open` (a business id from the list), `workspace.lock`, `workspace.delete` (the exact name);
- every other venture method, and `receipts.get`.

Everything else answers `HOSTED_NOT_AVAILABLE`: backups and exports to the server's disk, file imports, plugins, the Python helper, MCP, the conversation views and the rest of the back office. Those stay in the desktop app.

## Honest labels

| Part | State | Why |
|---|---|---|
| Hosted business actors | experimental (`unverified`) | Tested on one computer, not on a real deploy |
| Event push to the page | experimental (`unverified`) | Same |
| Storage | experimental | Encrypted files on one server; PostgreSQL is not wired for this flow |
| Email sign-in | development only | No mail sender; links print on the console |
| Passkeys | experimental | Checked with a software authenticator in tests, not yet with real devices on a real domain |
| Rivet Actors adapter | planned | In-memory stand-in only |
| Schedules, cron, queues, workflows | planned | No venture action needs them yet |
| Containers and plugins | unavailable on hosted | Never on a shared server |
| Command-line AI | unavailable on hosted | Desktop only |

## What a real deploy needs

Each of these is outside this branch. The labels above change only after the deploy that covers them has been tested.

1. **A domain and TLS.** Either certificate files (`CHAUSAR_HOSTED_TLS_CERT`, `CHAUSAR_HOSTED_TLS_KEY`) or a TLS proxy in front (`CHAUSAR_HOSTED_TLS_PROXY=1`, and `CHAUSAR_HOSTED_TRUST_PROXY=1` if the proxy sets `X-Forwarded-For`). The proxy must pass the original `Host` header. The server sends HSTS on https.
2. **The custody key in a secret store.** `CHAUSAR_HOSTED_CUSTODY_KEY` opens every vault. It needs a managed secret store or KMS (planned), a backup kept apart from the data, and a rotation plan; rotation is not built.
3. **A mail sender.** SMTP or a mail API under the operator's account, with SPF, DKIM and DMARC on the sending domain. Not built: `CHAUSAR_HOSTED_MAILER` accepts only `none` outside development. Without it, new people can't sign up; existing people can sign in with passkeys.
4. **Durable storage.** PostgreSQL for the account directory and the business vaults (the engine has a PostgreSQL snapshot adapter for the desktop, not wired here), with backups and a tested restore.
5. **One server process, or shared state.** The directory holds a file lock, so one process serves one data folder. More than one process needs the directory, sessions and rate limits in a shared store.
6. **The real actor runtime.** Run the runtime conformance suite (`platform/tests/hosted-runtime.test.ts`) against a real Rivet engine on Linux before the Rivet adapter is labelled anything but planned.
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
| `CHAUSAR_HOSTED_TLS_CERT`, `CHAUSAR_HOSTED_TLS_KEY`, `CHAUSAR_HOSTED_TLS_PROXY`, `CHAUSAR_HOSTED_TRUST_PROXY` | TLS, as above |
| `CHAUSAR_HOSTED_MAILER` | `dev-outbox` (development) or `none` |
| `CHAUSAR_HOSTED_AI_CEILING_MICROS`, `CHAUSAR_HOSTED_BUSINESSES_PER_ACCOUNT` | Limit overrides |
| `CHAUSAR_VENTURE_RUNTIME`, `CHAUSAR_HOSTED_STORAGE` | Only `local` and `experimental-file` start; the others are refused as planned |

A key can be made with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## How it was checked

On Windows with Node 24.13.1, with no network beyond this computer's loopback and no paid calls:

- `hosted-custody.test.ts`: sealed passphrases open only for their own tenant and business and master key.
- `hosted-webauthn.test.ts`: real P-256, Ed25519 and RSA passkeys from a software authenticator; wrong site, challenge, ceremony, user, signature and counter are each refused.
- `hosted-accounts.test.ts`: email links bound to the asking browser, expiry, rate limits, passkeys from a fresh session, session expiry and limits, account deletion, and the sealed directory file (no email on disk in the clear, one server per folder, a wrong key refused).
- `hosted-limits.test.ts`: token buckets, the concurrency gate, the monthly ceiling, and the transport that applies them and refuses processes.
- `hosted-runtime.test.ts`: the same conformance checks on the local runtime and on the Rivet adapter over its stand-in, each business a real Engine over a real vault.
- `hosted-server.test.ts`: the server over real sockets: headers, host and origin checks, cookies, the bearer, the allow-list, two tenants that never meet, the event stream, limits, and the venture journey from the idea to an accepted plan with the synthetic recordings, the cost reaching the account ledger.
- The full typecheck with `typescript@5.9.3` against the repo `tsconfig.json`, and `node scripts/check.mjs` (485 files): both clean.
- One serial full run, `node --test --test-concurrency=1 platform/tests/*.test.ts`, with nothing else running: 2,777 tests, 2,776 pass, 0 fail, 1 skipped (the DuckDB proof that needs the native module, skipped before this work too), in about 22 minutes.
- `npm run start:hosted` with the recordings, in the browser: an email link from the console signed in; the front page listed no business, then started one; the shared app asked for a working name only, made the vault on the server and showed the recovery code once; the seven places opened with no back office and "Hosted, experimental"; a reload kept the session; the command-line AI rows said desktop only and a back office request answered `HOSTED_NOT_AVAILABLE`. At 375 px the front page fit. Passkeys were not tried in the browser: that would raise the computer's own passkey prompt, so they are checked with the software authenticator only.

Known limits:

- An email link opened in a different browser from the one that asked is refused. That stops forwarded links, and it also means asking on a laptop and opening the email on a phone doesn't work.
- A business sleeps after fifteen idle minutes, and any AI key typed into it goes with it.
- The front page and the app's business dialog use the existing styles; the dialog is the back office's light modal.
