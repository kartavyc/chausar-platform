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
| Speech: API upload, Sarvam, Bhashini, paid live voice | experimental |
| "What it understood" reader (Hindi traps) | supported |
| Speech recorded-clip bench | supported as a harness; fixtures are synthetic |
| Small apps from one line, over the core and write catalogues | experimental (every made app is new) |
| Follow-up book (a small app that keeps records) | experimental |
| Plugin file format, signature check, plain-words review | supported |
| Signed plugins from trusted publishers carrying skills and data | supported |
| Tool arguments checked against their JSON schema, host doors (`calculate`, `read_published`, `prepare_action`), grants, recipe check hand-off, Network ledger | supported |
| Plugin network door | experimental (tested only against an injected fake transport) |
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
  - **Network requests.** Chausar makes the declared requests itself, once, to approved sites only, attaching keys the plugin never sees. Each request is written to the Network ledger (`smallapps.pluginLedger` and the core audit event `network.request`).
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
| `smallapps.pluginCallRemote` | prepare, external | |
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
| `CHAUSAR_PLUGIN_CREDENTIALS` | `pluginCredentials` | JSON `[{plugin, site, header, env}]`. Each entry names the `CHAUSAR_*` variable holding the key, which is read only when the request is made; the key itself is never in the options or state. |

Development-only options (`pluginSigningKey`, `clock`, `pluginTransport`) are never built for the installed app. A malformed setting is left out, so the feature refuses with its own typed code.

## Bench findings on synthetic transcripts

These results come from transcripts written by hand, not recorded from real providers. They test the scoring, not the providers.

- **Pass:** codex-cli, claude-cli, openai-responses, anthropic-messages and managed.
- **Fail:**
  - openai-compatible: invented numbers.
  - ollama: right-or-refused rate, invented numbers, attacks obeyed.
  - subq-snap: right-or-refused rate, because Snap cannot select a branch or customer, so branch-scoped questions come out wrong.

The offline replay pins the gateway clock to each transcript's recording day, and aging answers are fixed at the bench day. No lane test depends on the real date; every lane test file passes with the clock shifted by hundreds of days either way.

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
- **`platform/runtime/wasm-worker.mjs`** (additive): an optional input buffer is copied into the module's exported memory through its `alloc`, then `run(ptr, len)` is called. The stdin limit is raised to fit it.
- **`app/desktop/preload.cjs`:** codes added to the models-ext line of `laneRefusals`, the one permitted edit.
- **`docs/model-routes.md`:** sections for the new routes, pricing and speech providers.

## Cross-lane assumptions

- **hosted-link:** `hosted.allowanceCredential` returns `{endpoint, credential, model?, budgetMinor?}`. Until then, `modelsx.connectAllowance` refuses with `ALLOWANCE_NOT_AVAILABLE`.
- **writeback:** the contract is assumed and documented at the top of `platform/runtime/smallapps/catalogue-adapter.ts`.
  - `writeback.catalogue` returns rows of `{system|connector, operation, label|title, tier, alwaysWaits, status|depth, impact?, payloadSchema?}`.
  - `writeback.prepare({system, operation, payload, idempotencyKey, sourceIds?})` returns `{id, status:'prepared', digest}`.
  - When writeback is absent, the core catalogue is used.
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
- **Live voice.** The renderer's WebRTC client and enforcement of the minute cap are not built.
- **Speech keys.** A missing key can only be re-supplied by reconfiguring, which moves the revision on, so earlier previews must be made again.
- **Plugins.**
  - Remote MCP servers are not spoken to over the MCP protocol itself; a remote tool runs only through declared plain HTTPS requests.
  - Recipe checks need evidence supplied by a person; recipes start as "not checked".
  - A production publisher signing key must be created and held by the founder.
- **Small apps.**
  - The planner is local software. A model-made descriptor can enter only through `smallapps.validate` and `smallapps.create`.
  - The writeback contract must be confirmed when that lane merges.
