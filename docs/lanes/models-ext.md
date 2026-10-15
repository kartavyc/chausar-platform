# Lane: models-ext

Model routes, the route comparison bench, rupee costs, speech, small apps and plugin wrapping. Branch `claude/lane-models-ext`. Architecture pieces 3 and 12; plan days 1, 8 and 9; `docs/model-routes.md`.

Everything here is engine work. There are no screens in this lane. The Trust, Tools and Ask lanes draw these methods, and each reply is shaped so a screen can show it without doing any arithmetic.

## Labels

**Supported** means tested end to end through the real engine on synthetic data. **Experimental** means it works but depends on a live service, device or account that has not been tested.

| Feature | Label |
|---|---|
| Route catalogue (`modelsx.catalogue`) | supported |
| Dated price table, FX setting, per-request cost, route meters, job cost | supported |
| Anthropic Messages API route | experimental (needs a paid key; replayed wire format only) |
| SubQ Snap decision-model route | experimental (needs a SubQ key; preview API; replayed wire format only) |
| Chausar allowance route client (`modelsx.connectAllowance`) | experimental (refuses `ALLOWANCE_NOT_AVAILABLE` until hosted-link provides a credential) |
| Codex CLI, Claude Code CLI, OpenAI Responses, compatible, Ollama | unchanged; experimental as before |
| Route comparison bench, offline replay of recorded transcripts | supported as a harness; every result is experimental because all transcripts are synthetic |
| Live route comparison (plan, approve, run) | supported against a local fake provider; experimental against any real provider |
| 50-question open bench with hand-worked answers | supported |
| Speech: browser transcript, local whisper.cpp | supported (whisper binary must be installed and checked by the operator) |
| Speech provider settings kept in the encrypted workspace, revocation | supported |
| Speech: API upload, Sarvam, Bhashini | experimental |
| `voice.*` (SH-05) with the browser transcript and local whisper; confirm, speak, usage | supported |
| Paid live voice through `voice.start {live:true}`, WebRTC client with the minute cap enforced | experimental (client tested with fakes; needs an OpenAI realtime account) |
| Remote MCP servers over the MCP protocol (2026-07-28, 2025-11-25, 2025-06-18) through the approved network door | experimental |
| TL-07 pending requests (`smallapps.pendingRequests`) | supported |
| `modelsx.price`, `modelsx.localList`, this month's spend and voice minutes on the meters | supported (localList tested with an injected loopback reply) |
| "What it understood" reader (Hindi traps) | supported |
| Speech recorded-clip bench | supported as a harness; fixtures are synthetic |
| Small apps from one line, over the core and write catalogues | experimental (every made app is new) |
| Follow-up book (a small app that keeps records) | experimental |
| Plugin file format, signature check, plain-words review | supported |
| Signed plugins from trusted publishers carrying skills and data | supported |
| Tool arguments checked against their JSON schema, host doors (`calculate`, `read_published`, `prepare_action`), grants, recipe check hand-off, Network ledger | supported |
| Plugin network door | experimental (tested against a real local HTTPS server with the production transport; never against a live third-party site) |
| Wrapped MCP tools, code from an unverified publisher | experimental |

## How a person uses it

- **Choosing a model.** Trust → Models shows `modelsx.catalogue`: every route kind, what it sends, where the receipt boundary is, how it is costed, and what you must supply. The owner sets the dollar rate once (`modelsx.setFx`, paise per US dollar, with the date it was read). `modelsx.applyPricing` then copies the dated prices onto a configured route, so the gateway measures the real cost of each call. `modelsx.meters` shows budget, consumed, remaining and cost per answer for each route. Missing figures read "not counted", never zero.
- **Comparing routes.** An owner states the pass bars first (`bench.setPassBars`). `bench.compare` must quote the digest of those bars. It reports right, wrong, refused, interventions, invented numbers, attacks obeyed, actions without permission and cost per job, with a verdict against the bars. The bars cannot change mid-run. There are two modes:
  - **Offline** replays recorded transcripts, five runs each.
  - **Live** runs the open bench against your configured, qualified routes:
    1. `bench.planLive` states the exact routes, questions, runs and a rupee cap, with the worst-case cost.
    2. An owner approves that exact plan digest in the app (`bench.approveLive`). The approval expires after 10 minutes and works once.
    3. `bench.compare {live:true}` runs it. Every question goes through the real gateway with no workspace sources, one attempt each. The run stops at the cap and lists what was left undone.

    A plan approval never approves sending data: if the gateway still asks for an outbound approval, that route is skipped.
- **Talking to it.** Speech providers are configured through the existing `speech.*` methods.
  - The new kinds are `sarvam-stt`, `bhashini-asr` and `live-voice`.
  - Settings stay in the encrypted workspace across restarts. Keys stay in memory, the broker or `CHAUSAR_*` variables; after a restart the key must be supplied again.
  - `modelsx.speechRevoke` turns a provider off.
  - Before anything runs, `modelsx.speechInterpret` shows what was understood. Each negation ("nahi", "नहीं", "don't") is flagged as flipping the meaning, each number is shown in Indian grouping ("do lakh" → 2,00,000), and anything unsure is flagged. The person confirms the exact text with `modelsx.speechConfirm`.
- **A small app from one line.**
  - `smallapps.propose` turns a line into a typed descriptor. It is local software with no model, and text in the line is treated as data.
  - It uses only published calculations and actions from the write catalogue: `writeback.catalogue` when that lane is present, otherwise the core `actions.catalogue`.
  - The person sees what the app uses and creates it with `smallapps.create`.
  - `smallapps.open` runs every figure through the calculator as the caller, so each number has a receipt.
  - A changed dictionary marks the app out of date until `smallapps.rebuild`.
  - An action button only prepares the action, through `writeback.prepare` or `actions.prepare`. Money, outside messages, deleting and anything irreversible are marked as always waiting for a person.
- **Plugins.**
  - **Review.** `smallapps.pluginInspect` shows a `chausar.plugin.v1` file in plain words: what it holds, every door and site it asks for, and its signature status.
  - **Install.** `smallapps.pluginInstall` stores skills and data as quoted data and installs any WASM, disabled, into the existing locked box. The owner enables it through the core `plugins.enable` with the exact digest.
  - **Grant.** The owner opens doors with `smallapps.pluginGrant`: exact HTTPS sites, and per code `calculate`, `read_published` or `prepare_action`. A grant is tied to the plugin's exact digest.
  - **Run.** Tools take arguments checked against their declared schema (`smallapps.pluginCallTool`, or `smallapps.pluginCallRemote` when the tool declares requests).
  - **Network requests.** Every remote call goes prepare → approve exactly this → send once:
    1. `smallapps.pluginPrepareRemote` shows the exact URL, method, canonical body and its digest, and whether a key will be attached (never the key). It is refused when the send level is `nothing`.
    2. An owner or cofounder approves that digest in the app with `smallapps.pluginApproveRemote`. The approval is single-use and expires after 5 minutes.
    3. `smallapps.pluginCallRemote {previewId, approvalId}` sends it once, to approved sites only. The approver is re-checked at that point.

    Keys come from the host broker only for a plugin verified with a still-trusted publisher key. Answers to keyed requests are never returned to the caller, and the plugin sees them redacted. Each request is written to the Network ledger (`smallapps.pluginLedger` and the core audit event `network.request`) with a receipt.
  - **Plugin results.** A plugin's number is a signal, not a figure. If it equals a calculator figure bound for that run it carries that receipt; otherwise it must be a code from 0 to 255, and anything else is refused (`PLUGIN_RESULT_UNRECEIPTED`).
  - **Blocking.** Blocking a key or digest also removes grants and disables installed code.
  - **Recipes.** A recipe inside a plugin is handed to the existing recipe checker (`sources.preview`) with evidence, and never executed.
  - **Wrapping.** `smallapps.pluginWrap` turns an Agent Skills `SKILL.md`, or an MCP `tools/list` plus declared requests, into an unsigned plugin file for review.

## Engine methods

All are in `platform/runtime/modules/lane-models-ext.ts`, which composes five parts, and are listed in `app/desktop/module-methods/models-ext.json`.

| Method | Permission | Notes |
|---|---|---|
| `modelsx.catalogue` | read | Route kinds plus the configured routes of each kind |
| `modelsx.pricing` | read | Dated table (micro-USD per million tokens), FX, paise per million when FX is set |
| `modelsx.setFx` | admin | `{paisePerUsd, asOf}` |
| `modelsx.setPrice` | admin | `{kind, model, price:{inputUsdMicroPerMillion, outputUsdMicroPerMillion, asOf, source}}` operator override |
| `modelsx.applyPricing` | admin | `{routeId}` writes paise-per-million rates onto the route (credential untouched) |
| `modelsx.cost` | read | `{routeId \| kind+model, inputTokens, outputTokens}` → `costMinor` or "not counted" with the reason |
| `modelsx.meters` | read | Per-route budget, consumed, remaining, measured cost, cost per answer, `nextCallFits`, totals |
| `modelsx.jobCost` | read | `{receiptIds}` → reserved and measured paise for a job's model calls (for jobs-ext) |
| `modelsx.connectAllowance` | admin, external | Configures the `managed` route from hosted-link's allowance credential |
| `bench.cases`, `bench.passBars`, `bench.results`, `bench.result` | read | Open bench, bars, history |
| `bench.setPassBars` | admin | Bars with digest; four bars are fixed at zero |
| `bench.compare` | prepare | Offline `{routes?, runs?, barsDigest}`; live `{live:true, planId, approvalId, barsDigest}` |
| `bench.planLive` | prepare, external | `{budgetCapMinor, barsDigest, routeIds?, caseIds?, languages?, runs?}` |
| `bench.approveLive` | approve, external, desktop only | `{planId, planDigest}`; expires after 10 minutes, used once |
| `modelsx.speechCatalogue`, `modelsx.speechInterpret` | read | Providers; "what it understood" |
| `modelsx.speechConfirm`, `modelsx.speechBench` | prepare | Confirmation id; offline clip bench (host fixtures required) |
| `modelsx.speechRevoke` | admin | `{providerId}` |
| `smallapps.propose`, `validate`, `list`, `get`, `open`, `records.list`, `records.history` | read | |
| `smallapps.create`, `rebuild`, `remove`, `pressAction`, `records.add`, `records.update` | prepare | |
| `smallapps.pluginInspect`, `pluginList`, `pluginGet`, `pluginLedger` | read | |
| `smallapps.pluginWrap`, `pluginCallTool`, `pluginCheckRecipe` | prepare | |
| `smallapps.pluginPrepareRemote`, `pluginCallRemote` | prepare, external, desktop only | `pluginCallRemote {previewId, approvalId}` |
| `smallapps.pluginApproveRemote` | approve, external, desktop only | exact digest, single use, 5 minutes |
| `smallapps.pluginRemotePreview` | read | |
| `smallapps.pluginTrustKey`, `pluginInstall`, `pluginBlock`, `pluginRemove`, `pluginGrant` | admin, desktop app only, untainted | |

Refusal codes that screens can tell apart are on the models-ext line of `laneRefusals` in `app/desktop/preload.cjs`.

### Gateway route kinds added

- **`anthropic-messages`** sends `POST https://api.anthropic.com/v1/messages`.
  - The instructions go in `system` and the input is the only user message. No tools are declared, and `output_config.format` carries the JSON schema.
  - Credentials go in the `x-api-key` and `anthropic-version` headers.
  - It works for every gateway purpose.
  - A refusal, tool use, `max_tokens` or `pause_turn` stop fails once, with no retry.
- **`subq-snap`** sends `POST https://api.subq.ai/v1/systemone` to the Decisions API.
  - It asks two choice questions: which registered calculation answers the question (or `none_fits`), and which dated period preset applies. The presets are computed from the trusted gateway clock, or from today when none is set.
  - Below 0.6 confidence it asks for clarification instead of answering.
  - It never fills branch or customer.
  - It serves only the analytical plan. Any other purpose is refused with `SNAP_PURPOSE_UNSUPPORTED`.

Both kinds keep the gateway's privacy gate, exact payload approval, single attempt and word-for-word receipt, because they run inside `ModelGateway`.

### Installed-app options (`EngineModule.hostOptions`)

When the host passes no `modules['models-ext']`, the engine builds the options from `CHAUSAR_*` settings in `platform/runtime/models-ext/host-options.ts`. Demo mode builds none.

| Setting | Option | Meaning |
|---|---|---|
| `CHAUSAR_BENCH_TRANSCRIPTS` | `benchTranscripts` | Absolute folder of real recorded route transcripts |
| `CHAUSAR_SPEECH_BENCH_FIXTURES` | `speechBench` | Absolute path to recorded speech clips (JSON, at most 16 MB) |
| `CHAUSAR_PLUGIN_PUBLISHER_KEYS` | `publisherKeys` | JSON `[{publisherId, publicKey}]` of trusted plugin publishers |
| `CHAUSAR_PLUGIN_CREDENTIALS` | `pluginCredentials` | JSON `[{keyId, plugin, site, header, env}]`, bound to the verified publisher key id. Each entry names the `CHAUSAR_*` variable holding the key, which is read only when the request is made; the key itself is never in the options or state. |

Development-only options (`pluginSigningKey`, `clock`, `pluginTransport`) are never built for the installed app. A malformed setting is left out, so the feature refuses with its own typed code.

## Bench findings on synthetic transcripts

These results come from transcripts written by hand, not recorded from real providers. They test the scoring, not the providers.

- **Pass:** codex-cli, claude-cli, openai-responses, anthropic-messages and managed.
- **Fail:**
  - openai-compatible: invented numbers.
  - ollama: right-or-refused rate, invented numbers, attacks obeyed.
  - subq-snap: right-or-refused rate, because Snap cannot select a branch or customer, so branch-scoped questions come out wrong.

The offline replay pins the gateway clock to each transcript's recording day, and aging answers are fixed at the bench day. No lane test depends on the real date; every lane test file passes with the clock shifted by hundreds of days either way.

## Security review

An adversarial review of the lane found 1 high, 8 medium and 6 low issues. Each was fixed with a regression test.

- **Plugin network door (high).** It sent caller-chosen data immediately, ignoring the send level. It now runs prepare → exact owner approval → send once, as above.
- **Plugins (medium):**
  - Blocking did not stop installed plugins.
  - A key echoed back in a response leaked.
  - Credentials were bound to a self-declared publisher.
  - Plugin text reached error messages.
  - Plugin numbers were shown as if they were figures.
  - Any accountant could sign a plugin.
- **Small-app number guard (medium).** It missed Hindi numerals 21–99, ordinals, fractions, multiples and zero words. Labels are now limited to words from the published menu, the catalogue and the period names, with a larger number list as a backstop (`SMALLAPP_WORDS_OFF_MENU`, `UNGROUNDED_NUMBER`). One trade-off: freely worded labels in an outside descriptor are refused.
- **Live voice (medium).** Approval authorized an unbounded stream. It is now off unless the host enforces the minute cap, and works on the desktop only.
- **Low:**
  - Follow-up history leaked earlier customer-scoped versions; they are now withheld, and a count is shown.
  - Outside text in plugin reviews was unquoted.
  - A `..` argument could remove a URL path segment.
  - Prices were accepted as non-strings.
  - The live-bench approver was not re-checked at run time.
  - Writeback rows with no impact showed as not always-waits.

## Core edits

- **`platform/runtime/gateway.ts`** (additive) adds the two route kinds and a clock option. The changes are:
  - the `RouteKind` union and `PRIORITY` entries;
  - default endpoints;
  - two `modelPayload` branches and two `parseProviderOutput` branches, with an optional `payload` argument passed from `execute`;
  - provider-specific auth headers;
  - the Anthropic message extraction in the two conversation and synthesis disclosure checks;
  - an optional trusted `clock` in `GatewayOptions`, used only to date the SubQ period presets.

  The provider code itself lives in `platform/runtime/providers/`.
- **`platform/runtime/plugins.ts`** (additive) adds per-run inputs for the locked box:
  - `HostFunction.bound`;
  - `BOUND_HOST_FUNCTIONS` (`calculate`, `read_published`, `prepare_action`), which are merged into every PluginService and answer only from per-run bound values; otherwise they refuse with `HOST_VALUE_NOT_BOUND`;
  - an optional `run(context, id, input)` carrying bound values and an input buffer of at most 256 KiB.

  A plain core `plugins.run` can never answer a bound door.

  A failed run now reports a fixed `PLUGIN_FAILED` message. The worker's stderr is dropped, so text chosen by the plugin never reaches an error or a stored run reason.
- **`platform/runtime/wasm-worker.mjs`** (additive): an optional input buffer is copied into the module's exported memory through its `alloc`, then `run(ptr, len)` is called. The stdin limit is raised to fit it.
- **`app/desktop/preload.cjs`:** codes added to the models-ext line of `laneRefusals`, the one permitted edit.
- **`docs/model-routes.md`:** sections for the new routes, pricing and speech providers.

## Cross-lane assumptions

- **hosted-link:** `hosted.allowanceCredential` returns `{endpoint, credential, model?, budgetMinor?}`. Until then, `modelsx.connectAllowance` refuses with `ALLOWANCE_NOT_AVAILABLE`.
- **writeback:** confirmed against merged writeback (commit 1bba591) and documented at the top of `platform/runtime/smallapps/catalogue-adapter.ts`.
  - `writeback.catalogue` rows are `{system, action, title, tier: 1|2|'prepare-only', kind, alwaysWaits, status, installed, connections[], recipe.requiredFields}`.
  - `writeback.prepare({connectionId, action, payload, intentId, sourceIds?, sourceTainted?})` returns the action view.
  - Small apps made outside the local planner press with `sourceTainted: true`. A repeated press of the same card and payload is one intent.
- **jobs-ext:** reads costs from `modelsx.cost`, `modelsx.meters` and `modelsx.jobCost`.
- **reports-tools-trust:** draws the screens, and reads plugin network requests from the core audit events `network.request` (and `smallapps.pluginLedger`) for its Network ledger. **ask** also draws its screens over these methods.
- **The Monday brief:** may read the follow-up book through `smallapps.records.list`.
- **Core methods called:** `calculation.run`, `ontology.get`, `actions.catalogue`, `actions.prepare`, `sources.preview`, `plugins.install`, `plugins.list`, `plugins.run`, `plugins.remove`, `models.configure` and `speech.*`.

## Still missing, or needs the founder

- **Real provider data.**
  - Real bench transcripts need the founder's paid keys and installed CLIs; the steps are in `platform/benchmarks/routes/README.md`.
  - Real speech clips need recording.
  - Live comparison has run only against the local fake provider.
- **Live comparison limits.**
  - Branch and customer questions (18 of 50) cannot run live, because the gateway offers those selectors only from workspace facts, which the bench never sends.
  - Live rows judge only the validated plan; the gateway keeps a hash of the raw reply.
  - The Claude CLI can never qualify until host evidence for it exists.
- **Accounts.** Paid accounts for OpenAI, Anthropic, SubQ, Sarvam, Bhashini (integrator ID and ULCA key) and OpenAI realtime.
- **Prices.**
  - There is no default FX rate; the owner sets it.
  - The SubQ price comes from a third-party listing and is marked unverified.
- **Live voice.** Built, but tested only with fakes; a real run needs an OpenAI realtime account. Minutes are measured on the engine's clock, not from the provider's bill.
- **Plugins.**
  - Remote MCP: tools with `x-mcp-header` stay description-only; server questions (`input_required`) are refused; only the first page of `tools/list` is read; no `DELETE` ends an older-version session.
  - Recipe checks need evidence supplied by a person; recipes start as "not checked".
  - A production publisher signing key must be created and held by the founder.
- **Small apps.**
  - The planner is local software. A model-made descriptor can enter only through `smallapps.validate` and `smallapps.create`.
  - No `writeback.practice` dry run from a press (practice connections work).

## Round 4 contracts

These are stable payload and reply shapes for other lanes. Every reply is plain JSON. Amounts are whole paise as strings, and a missing figure is a missing-state word, never zero. A method that is absent returns `UNKNOWN_METHOD`.

### `voice.*` (SH-05, for frame-today's ask line and Today)

Voice is **off by default**. When it is off, every method except `voice.status`, `voice.usage` and `voice.providers` refuses with `VOICE_OFF`, and the microphone opens Trust · Rules · Send. When Send is `nothing` or `shape`, speech is turned into text on this computer only (browser transcript or local whisper); a cloud provider refuses with `VOICE_LOCAL_ONLY`. No raw audio is kept: once audio is turned into text, the engine drops the bytes and keeps only their digest.

| Method | Permission | Payload | Reply |
|---|---|---|---|
| `voice.status` | read | `{}` | `{ enabled, mode: 'off'\|'browser'\|'local'\|'paid', send, localOnly, provider: {id, kind, label, local, ratePerMinuteMinor\|null} \| null, live: {sessionId, startedAt, capMs, endsAt} \| null, speaking: {utteranceId} \| null, usage: <voice.usage month> }` |
| `voice.setEnabled` | admin, desktop | `{ enabled, providerId? }` | `{ enabled, providerId }` (the TR-08 voice row) |
| `voice.providers` | read | `{}` | the same rows as `modelsx.speechCatalogue` |
| `voice.start` | prepare, desktop | `{ providerId?, live?: boolean, capMs? }` | `{ sessionId, capture: 'browser-transcript'\|'record-audio'\|'live-session', provider, capMs, approval?: {previewId, digest, costCapMinor} }`. A paid provider returns `approval`; the owner approves it with `speech.approve` before audio leaves. For `live`, the reply after approval carries `live: {clientSecret, expiresAt, connectEndpoint, model, capMs, endsAt}`, and `voice.start {sessionId, approvalId}` completes it. |
| `voice.stop` | prepare, desktop | `{ sessionId, transcript? , audioBase64?, mimeType?, durationMs }` | `{ sessionId, heard: string \| null, understood: <modelsx.speechInterpret reply> \| null, needsConfirmation: true, words }`. Nothing caught gives `heard: null` and `words: 'Not sure what was said.'`. For a live session, stop also records the minutes used, ended at the cap at the latest. |
| `voice.confirm` | prepare | `{ sessionId, digest, text? }` | `{ confirmationId, text, digest }`. `text` is the person's edit, re-read before it is confirmed. Refuses `UNDERSTOOD_CHANGED` when the digest no longer matches. |
| `voice.dropNote` | prepare, desktop | `{ audioBase64, mimeType, durationMs, providerId? }` | same as `voice.stop` (a recorded note dropped on the ask line) |
| `voice.speak` | read | `{ receiptId, language?: 'en'\|'hi' }` | `{ utteranceId, language, segments: [{ text, figureKey? }] }`. Every number is read from the receipt's own figures, never from written text. The renderer speaks it locally (browser speech synthesis), and no audio leaves. |
| `voice.stopSpeaking` | read | `{ utteranceId }` | `{ stopped: true }` |
| `voice.usage` | read | `{ month?: 'YYYY-MM' }` | `{ month, providers: [{ providerId, kind, minutes, minutesMs, costMinor \| 'not counted', basis }], totals: { minutesMs, costMinor \| 'not counted' } }` |

**Live voice (WebRTC).** `app/ui/src/screens/voice/live-client.ts` exports `startLiveVoice({ live, onTranscript, onEnd })`. It connects to `live.connectEndpoint` with the ephemeral `clientSecret` and **ends the call itself at `endsAt`**. The engine also closes the session at the cap, whether or not `voice.stop` arrives.

### `modelsx.price` (for jobs-ext's `routePrice` adapter)

`{ routeId }` → `{ routeId, unitMinor, basis: 'measured'|'estimate'|'zero', pricedAt }`. One unit is one model request. The value comes from:
- `measured`: the mean measured cost per answer when the route has any, rounded up;
- `estimate`: otherwise the route's per-call reservation `maxCostMinor`;
- `zero`: local Ollama.

Codex and Claude CLI routes refuse `ROUTE_ESTIMATE_UNAVAILABLE`, because they run on a plan, not per request. An unknown route refuses `ROUTE_NOT_FOUND`.

### `modelsx.localList` (FR-05 local model picker)

`{ endpoint? }` → `{ endpoint, models: [{ name, sizeBytes, modifiedAt, family }], reachable: true }`, or `{ reachable: false, words }`. It reads Ollama's `GET /api/tags` on loopback only. It is refused in demo mode.

### Meters (TR-08)

`modelsx.meters` adds `month: { month, spendMinor, measuredMinor, reservedMinor, voiceMinutesMs, voiceCostMinor }` across all routes and speech providers for the current calendar month.

### TL-07 pending requests (for reports-tools-trust's request sheet)

`smallapps.pendingRequests` (read) → `{ requests: [{ id, kind: 'plugin-network'|'plugin-tool'|'mcp-call', pluginId, plugin, tool, site?, method?, question: <untrusted quoted text>, receives: string[], preparedBy, preparedAt, expiresAt, approveWith: { method, previewId, digest } }] }`. A secret is never part of a request, and the sheet never asks for one.

### Round 4 deviations from the contracts above

- **Paid recorded voice (Sarvam, Bhashini, API upload).** The approval comes at stop, not start, because there is no audio to approve at start.
  1. `voice.stop` (or `voice.dropNote`) returns `heard: null` and `approval: {previewId, digest, costCapMinor}`.
  2. The owner approves with `speech.approve`.
  3. `voice.stop {sessionId, approvalId}` sends the recording once.
- **Extra reply fields.**
  - `voice.confirm` also returns `understood` and `receiptId`.
  - `voice.stop` returns `receiptId`, plus `live: {minutesMs, costMinor, closedBy}` for a live session.
- **`voice.setEnabled`** works while voice is off; it is the way to turn voice on. `providerId` defaults to `browser`.
- **Live sessions are transcription-only.** The configured model must be a transcription model, for example `gpt-4o-transcribe`.
- **`modelsx.speechKey`** (admin, desktop, untainted) `{providerId, secret}` → `{providerId, credentialConfigured, revision, enabled}` re-supplies a key without moving the revision. Earlier previews stay valid.
- **`modelsx.meters`.** `month` also carries `modelSpendMinor`; `spendMinor` is model plus voice.
- **`smallapps.pluginMcpRefresh`** (prepare, external, desktop) `{id}` prepares an MCP `tools/list`. It is approved and sent through `pluginApproveRemote` and `pluginCallRemote`, and the reply is a review diff. Nothing is installed.
- **MCP version.** A remote MCP plugin is pinned to one protocol version when it is wrapped. There is no automatic fallback, because a fallback would send requests nobody approved.
- **`smallapps.pressAction`** adds an optional `connectionId`. The reply's `approval` carries `secondAsk`, `approveWith` and `reauthWith`, or the reply is `{action: null, alreadyDone}`.

### Round 4 review (all fixed, each with a regression test)

An adversarial review of round 4 found 11 issues. Contract effects (all additive):
- **Voice status.** `voice.status` gains `blocked: 'VOICE_LOCAL_ONLY' | null`, and `provider` gains `words`. `mode` is `'off'` when the chosen provider is blocked.
- **Browser speech.** It may use the network (Chromium sends audio to its speech service), so when Send is `nothing` or `shape` it is refused unless the host asserts on-device recognition (`browserSpeechOnDevice`). `voice.setEnabled` then picks local whisper, or refuses `VOICE_NO_LOCAL_PROVIDER`.
- **Live voice.**
  - It needs the trusted host option `liveVoiceClient`, which the installed desktop worker sets; otherwise it refuses `LIVE_VOICE_CAP_NOT_ENFORCED`.
  - The approved cap stays reserved against the speech budget.
  - Measured minutes, timed with a monotonic clock, feed only usage and meters.
  - Only one live session can be open at a time, even under concurrent starts.
- **Voice confirm.** `voice.confirm` is desktop-only and refuses a tainted context. It returns `edited`.
- **Voice speak.**
  - It announces a stale answer first.
  - It speaks fixed labels per figure key, never owner text.
  - Basis points are spoken as basis points, and a non-INR amount is not read aloud.
- **Audio retention.** Raw audio is dropped from every speech record except a recent in-flight dispatch. A dispatch stuck past 5 minutes becomes `failed` with `SPEECH_INTERRUPTED`, and stale whisper temp folders are removed.
- **Months.** Voice and model spend share one month function that follows the workspace time zone, with an invalid zone falling back to India.
- **Small apps.**
  - An app made from a tainted or off-desktop context is `madeBy: 'outside'`, and a tainted presser always presses tainted.
  - A repeated press is idempotent only while the earlier action is still prepared. After it is finished it prepares afresh, at most 8 times. While it is approved, executing or unknown, the reply says so: `{ action: null, existing: {id, connector, operation, status, through}, words }`.
- **`modelsx.localList`.** The `endpoint` override is limited to an owner or cofounder on the desktop and untainted (`LOCAL_ENDPOINT_APP_ONLY`).
- **`smallapps.pendingRequests`.** The view across members needs an owner or cofounder on the desktop, untainted. Reading never writes.
