# Venture launcher: models (P2)

The models package lets an owner bring their own AI: an Anthropic or OpenAI key, or Claude Code or Codex already signed in on this computer. Cheap models are the default, and every step also works without any AI, through built-in templates that say so. Every call is written down before it is sent, with the exact text and a cost worked out by code. The workspace privacy setting rules every send, and client details leave only after the owner approves the exact text.

Code: `platform/runtime/venture/models/`. Tests: `platform/tests/venture-models.test.ts`. Fixture: `platform/tests/fixtures/venture/models/replay.json` (a synthetic recording).

## Methods

| Method | Level | What it does |
| --- | --- | --- |
| `venture.models.presets` | read | The six AI options with their availability as of now. Works before a business exists |
| `venture.models.connect` | admin, app only | Connects an option after the owner accepts its consent text; keeps the key in memory only |
| `venture.models.disconnect` | admin | Marks a connection disconnected and forgets the key when nothing else uses it |
| `venture.models.status` | read | Which option does each job, whether it can run, this month's spend, the send setting, replay mode |
| `venture.models.calls` | read | The "What was sent" list: newest first, with the exact stored text of each call |

`index.ts` also exports `createModelPort`, `defaultModelTransport`, `createReplayTransport`, and for tests `PRESETS`, `assertSchemaSafe`, `callCostMicros`, `estimateMaxCostMicros` and `clientDataFindings`.

## The six options

| Option | Model | Jobs | Key | Price per million tokens (in / out) | Availability |
| --- | --- | --- | --- | --- | --- |
| Claude Haiku 5.5 | `claude-haiku-5-5` | fast | yes | USD 0.10 / 0.50, Anthropic list price for prompts up to 100K tokens | ready |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | main | yes | USD 2 / 10, Anthropic list price | ready |
| GPT-6 Luna | `gpt-6-luna`, or the id the owner types | fast, main | yes | USD 0.10 / 0.50, from a third-party tracker, not confirmed by OpenAI | unverified |
| Claude Code on this computer | `claude-sonnet-5-5` | fast, main | no | none (your own plan) | needs setup while the terms gate is closed (the default); once open, needs setup until found, then unverified |
| Codex on this computer | `gpt-6-luna` | fast, main | no | none (your own plan) | needs the reviewed host profile, then unverified |
| Built-in templates (no AI) | none | fast, main | no | none | ready |

Prices were typed in by hand on 15 October 2026 and are stored in micro-USD (millionths of a dollar). Fast jobs are the interview, made-up rehearsal clients and judging; main jobs are plan words, build briefs and draft replies (`PURPOSE_TIER` in the contracts).

Each option has a consent text that says exactly what is sent and what is never sent. The owner's screen sends back `digest(consentText)`; a wrong or missing digest refuses `MODEL_CONSENT_REQUIRED`.

## How one call goes

```
generate (standing consent)                     preview, then runPreview (client details)
  task checks, client-data flag refused           task checks
  schema rule (no numbers, closed objects)        schema rule
  tier -> newest connection, or templates         tier -> newest connection, or null (templates)
  send setting "nothing" -> SEND_DISABLED         send setting "nothing" -> SEND_DISABLED
  build the exact request                         build the exact request (no headers, no key)
  content guard -> CLIENT_DATA_NEEDS_APPROVAL     record status 'preview', hold the body in memory 30 minutes
  record status 'dispatching' + budget check      owner approves the digest in the app
  send once, parse, validate                      claim first: still 'preview', same digest, same connection,
  record 'completed' or 'failed' with cost          same consent, send setting, key, budget -> 'dispatching'
                                                  send once, parse, validate, record the result
```

Rules that hold on both paths:

- **One dispatch.** No retry, no switch to another model, no server-side fallback. A refusal is `MODEL_REFUSAL`; a cut-off answer is `MODEL_INCOMPLETE`.
- **Never inside a transaction.** No port method is called inside a `ventureAction`. Each call uses two short actions of its own: one before sending, one after.
- **`status()` never writes.** A call left dispatching for more than ten minutes reads as failed, and a preview older than 30 minutes reads as expired, in the returned view only. The next call that records anything writes those states down.
- **Approval sends once.** `runPreview` claims the call in its first action, before any other wait, and takes the held body out of memory in that same step. A double click, or the window and the paired browser together, finds the call already dispatching and gets `APPROVAL_STALE`. After a restart the held body is gone, so the owner runs the draft again.

## The send setting

A new workspace starts with "send nothing". Connecting any AI option (not templates) moves it to "send question shapes" after the connection is saved, through the trust service in its own write, and records a `send-policy-changed` event once. The consent text tells the owner this will happen. Setting it back to "send nothing" on Trust & access stops every venture model call and preview with `SEND_DISABLED`. Templates never send anything, so they keep working.

## Client details

Two guards keep client details out of calls that run under standing consent:

1. The task flag. A task with `containsClientData: true` is refused by `generate` and must go through `preview` and `runPreview`.
2. The content check (`guard.ts`). Before sending, the exact text is searched for every client email (any case), every client name of four or more characters (as a whole word, case-sensitive), and any 40-character window of an order request or an edited draft (lower-cased, with spaces collapsed). The search also looks inside the JSON text, so client words that were escaped by quotes or new lines are still found. Client texts shorter than 40 characters but at least 20 are matched whole. Findings name the record, never the text.

## Cost and the monthly limit

`cost.ts` works in BigInt micro-USD:

- A call's cost is `(input tokens x input price + output tokens x output price + 999999) / 1000000`, rounded up to a whole micro. Haiku with 812 in and 164 out is 164 micros, shown as `USD 0.0002`. Sonnet with 1430 in and 402 out is 6880 micros, `USD 0.0069`.
- Before sending, the most a call can cost is worked out with `ceil(characters / 2)` input tokens plus the full output allowance. This is reserved against the limit while the call is in flight.
- The limit is set per connection when connecting (`monthlyCapUsd`, 0.01 to 1000, default 5). The check counts this month's spend on that option (months in UTC), plus what every call of that option still in flight reserves, plus the new call. It runs inside the write that records the call, so two calls that start together can't both spend the last of the limit.
- Costs from an unconfirmed price table (Luna) carry the words "(estimate, price unconfirmed)". Command-line options have no price table; their previews say "(runs on your own plan)".

## The routes

**Anthropic Messages** (`anthropic.ts`): raw HTTPS through the injected transport, because the engine does not import third-party packages and tests inject the transport. `POST https://api.anthropic.com/v1/messages` with `content-type`, `x-api-key` and `anthropic-version: 2023-06-01`. The body holds exactly `model`, `max_tokens`, `system`, `messages` and `output_config` (`effort: 'low'` and a `json_schema` format). Thinking blocks in the answer are skipped. Server-side refusal fallbacks are off: turning them on would answer with a model the owner did not pick, and that is a founder decision.

**OpenAI Responses** (`openai.ts`): `POST https://api.openai.com/v1/responses` with a bearer key, `store: false`, no tools and a strict `json_schema` format. Parsing follows the `openai-responses` branch of the gateway.

**Claude Code** (`cli.ts`): runs `claude` with the flags from `cliArguments` in `gateway.ts`, the input as stdin, and only these environment names: `PATH`, `Path`, `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, plus fixed Claude Code settings. No key is ever passed; Claude Code uses its own login. The schema is written to a fresh temp folder, which is removed when the run ends. **The flag list has never been checked against an installed `claude`.** Connecting runs `claude --version` first (no network, no cost); a missing command is `CLI_UNAVAILABLE`.

**Codex** (`cli.ts`): runs the executable named in the reviewed host profile with `buildCodexCliArguments` and `parseCodexCliOutput` from `providers/codex-cli.ts`. Codex has no system prompt flag in the reviewed profile, so the instructions lead the stdin text, as the gateway does. The process port is the host's verified one, which checks the executable's SHA256 before each run.

The stored `payloadText` is the HTTP body (never a key), or for the command-line tools `{ command, args, stdin }` with the schema file path written as `<schema-file>`.

### Setting up Codex

Codex is offered only when the engine starts with a reviewed host profile:

- `CHAUSAR_CODEX_CLI_EVIDENCE_FILE`: the absolute path to `codex-cli-host.json`.
- `CHAUSAR_CODEX_CLI_EVIDENCE_SHA256`: the SHA256 of that file.

`loadCodexCliHostGateway` in `codex-cli-host.ts` reads both, checks the recorded help, version and features against the pinned executable, and hands the profile and its process port to the venture host. Without them, Codex shows "Needs the reviewed Codex host profile."

## Before the vault: the draft desk (onboarding v2)

Since 18 October onboarding starts by connecting an AI, before any vault exists. The engine keeps that AI in a draft desk, in memory only: a secret shelf for the key, an in-memory store with one draft business record and the draft connection and call records, and the same model port as the vault. So every rule above holds before the vault too: each call is written down before it is sent, the monthly limit, the consent digest, one dispatch, the client-data guard. [onboarding.md](onboarding.md#the-draft-desk-the-ai-before-any-vault) describes its lifetime (sixty minutes idle, paused on Keep it safe, wiped on lock, open, restart) and the handover into the vault.

| Method | What it does before the vault |
| --- | --- |
| `venture.ai.options` | The four Connect rows, each with the weakest status of its presets, the presets with live availability, the draft status, and whether any row that can connect is not yet checked with a live account |
| `venture.ai.connect` | The same checks as `venture.models.connect`, app only; refuses `built-in-templates` (no AI is simply no connection here); the key goes to the draft shelf |
| `venture.ai.disconnect` | Disconnects a draft connection |
| `venture.ai.status` | The draft status, with `scope: 'before-vault'` and `idleUntil` (null while paused or with nothing connected) |
| `venture.ai.calls` | The draft "What was sent" list, newest first, failed calls included |

When the business is kept, the draft connections and calls move into the vault with the same ids and times, and the key moves to the vault host's shelf after the write commits. The send setting moves to "send question shapes" then, as it does when an AI is connected in the vault. Once a vault holds a business, these methods refuse `VENTURE_EXISTS`; the vault's own methods take over.

New purposes: `decide` (fast tier) reads the owner's sentence and picks views; `compose` (main tier) builds the plan from blocks. Both carry only the owner's own sentence and the country, never client data.

### The Connect rows and their words

| Row | Presets | Words at rest |
| --- | --- | --- |
| Paste an API key | `anthropic-haiku-5-5` and `anthropic-sonnet-5-5` (one key, the recommended pair), `openai-gpt-6-luna` | Can connect |
| Claude Code on this computer | `claude-code-cli` | Needs setup while the terms gate is closed |
| Codex on this computer | `codex-cli` | Needs setup without the reviewed host profile |
| Sign in with ChatGPT | none | Not open yet |

No row's words say "works": nothing in this build has been tried with a live account.

**Sign in with ChatGPT** has no preset, no route and no request. OpenAI documents it, but lets only open-source tools, personal hobby projects and partners it picks use a ChatGPT plan; Chausar is commercial and hasn't been approved. Its words and sources are on [onboarding.md](onboarding.md#sign-in-with-chatgpt-real-but-not-open-to-chausar-yet).

**Codex** stays on the owner's own `codex login`, with the words "OpenAI hasn't said yet that apps like Chausar may use a ChatGPT plan this way. It needs the reviewed Codex install on this computer." Chausar never reads `auth.json`.

## The Claude Code terms gate

Anthropic's legal page says a product that runs Claude Code needs Anthropic's Commercial Terms accepted. Chausar hasn't accepted them yet, and that is the founder's action, so the route is gated in code:

- `CHAUSAR_CLAUDE_CODE_TERMS`, read by `host-env.ts` into `VentureHostOptions.claudeCodeTerms`. Only the value `accepted` opens the gate. Any other value, or none, means `pending`, the default in every build. It comes from the host's own settings, never from a request.
- While pending, `availabilityOf('claude-code-cli', ...)` answers needs setup with "Chausar hasn't yet accepted Anthropic's terms for running Claude Code. Use an Anthropic key for now.", before the vault and in the vault alike. `venture.ai.connect` and `venture.models.connect` refuse the preset with `PRESET_UNAVAILABLE` and those words, and the screens show no "Check and connect".
- Once open, the route behaves as before: `claude --version` first, then needs setup until Claude Code is found, then unverified.
- To open it: the founder accepts the terms for Chausar, the lead records the date and the words in `STATE.md`, and the desktop build sets `CHAUSAR_CLAUDE_CODE_TERMS=accepted`.

The gate doesn't replace the other conditions from Anthropic's pages, which hold either way: Chausar never reads `.credentials.json` or sets `CLAUDE_CODE_OAUTH_TOKEN`, never shows a sign-in of its own, passes no flag that removes sign-in methods, and says that plans have limits made for one person.

## Replay

`createReplayTransport(fixture)` answers from a synthetic recording and refuses any file whose label is not `synthetic recording`. For each request it picks responses by purpose, route kind and model, keeps those whose `mustInclude` strings all appear in the request, and uses the first one not used yet (or the last one once all are used). A request with no match fails `FIXTURE_MISSING` ("Record this fixture: {purpose} for {model}."). The version check always answers `synthetic recording`. Every call made this way is stored with `replay: true`, and `status` reports `replay.active`. The engine only loads a replay file in demo mode with its own switch (`CHAUSAR_VENTURE_REPLAY=1` or `--replay`).

## What is not verified

- No route in this package has been tried against a live account in this build. The Anthropic request shape was checked against the current API reference, not by a paid call.
- GPT-6 Luna: a past probe through Codex failed, and its price comes from a third-party tracker, so its costs are estimates.
- Claude Code and Codex: both run on the owner's own plan and have not been tried on a real task here. The Claude Code flags are unchecked.

## Choices made beyond the spec (the founder can reverse any)

- **The monthly limit counts spend per option**, not across the whole business, so a Sonnet limit is not used up by Haiku calls, and reconnecting the same option does not reset its spend.
- **Failed calls that used tokens count.** A cut-off or refused answer still reports usage, so its cost is recorded and counts against the limit. A call that never got an answer records no cost.
- **A successful answer with no usage report** on a priced option is charged its reserved maximum.
- **The content guard also reads inside the JSON text** and checks client texts of 20 to 39 characters whole (the spec names only 40-character windows).
- **`keyLoaded`** is true only for an option that needs a key and has it in memory; command-line options and templates read `false` and rely on `usable` and `reason`.
- **`status` and `calls` work before a business exists** (no connections, templates for both jobs, an empty list).

## Retention

Model call records keep the text that was sent. For calls that held client details, that text should later be dropped after a shorter period while the digests stay; the books keep a ten-year retention. This build keeps the text, so the owner can always see what was sent.

## Hand-off note

**Done.** Everything in section 5 of the build spec: presets, the five handlers, the model port (`status`, `presets`, `checkCli`, `generate`, `preview`, `runPreview`), the Anthropic, OpenAI, Claude Code and Codex routes, the real transport, the replay transport, cost and the monthly limit, the schema rule and the client data guard, with tests for all 13 items in 5.7.

**Verified.**

- `node --check` on every file in the package and the test.
- Scoped typecheck with `typescript@5.9.3` (scratch install outside the repo) of `venture/models/**` and the test: no errors.
- `node --test platform/tests/venture-models.test.ts`: 22 of 22 pass. No test touches a provider; one test posts to a loopback server on 127.0.0.1 to check the real transport refuses redirects and oversized answers.
- `node --test platform/tests/venture-contracts.test.ts`: 17 of 17.
- `node --test platform/tests/desktop-harness.test.ts platform/tests/desktop-ipc-methods.test.ts`: 12 of 12.
- A scratch run (outside the repo) of the spec's e2e model recording (11.1) through connect, interview, plan, a rehearsal draft, a client order, then preview and approval: every answer matched its recording, Haiku cost 164 and Sonnet 6880 micros, only the approved call held the order text, and no call held the key, the client name or the email.

**Contract change needed (for the integrator).** In `contracts.ts`, `ModelConnectionRecord` and `ModelCallRecord` each declare `kind: ModelRouteKind`, which clashes with `RecordBase`'s `kind` (the record kind). TypeScript reduces both types to `never`, and with them `ModelConnectionView`, `ModelStatusView['connections']`, `VentureResults['venture.models.calls']` and `RecordOf<'venture-model-connection' | 'venture-model-call'>`. This package stores the route kind as `routeKind` and uses the local shapes in `models/types.ts`, which are the contract types with that one rename. Proposed fix: rename the field to `routeKind: ModelRouteKind` in both contract types. After that, `types.ts` can re-export the contract types and the casts in `port.ts` and `handlers.ts` can go. P6 recorded the same change in `shell.md`.

**Applied in Phase C.** Both record types now carry the route as `routeKind` in `contracts.ts` (commit `b8752df`), and the models package, the engine and e2e tests and the renderer fixture read them through the contract types (commit `9faee82`). `types.ts` now re-exports the contract types and the casts are gone.

**Wiring changes needed.** None. The host in `host.ts` already builds the transport and the port the way this package expects.

**Not finished.** Nothing in P2's scope. The live checks above (a real key, an installed Claude Code, a real Codex profile) need the founder and are not part of this run.
