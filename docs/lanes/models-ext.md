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
| Route comparison bench (offline replay of recorded transcripts) | supported as a harness; every result is experimental because all transcripts are synthetic |
| 50-question open bench with hand-worked answers | supported |
| Speech: browser transcript, local whisper.cpp | supported (whisper binary must be installed and checked by the operator) |
| Speech: API upload, Sarvam, Bhashini, paid live voice | experimental |
| "What it understood" reader (Hindi traps) | supported |
| Speech recorded-clip bench | supported as a harness; fixtures are synthetic |
| Small apps from one line | experimental (every made app is new) |
| Follow-up book (a small app that keeps records) | experimental |
| Plugin file format, signature check, plain-words review | supported |
| Signed plugins from trusted publishers carrying skills and data | supported |
| Wrapped MCP tools, code from an unverified publisher | experimental |

## How a person uses it

- **Choosing a model.** Trust → Models shows `modelsx.catalogue`: every route kind, what it sends, where the receipt boundary is, how it is costed, and what you must supply. The owner sets the dollar rate once (`modelsx.setFx`, paise per US dollar, with the date it was read). `modelsx.applyPricing` then copies the dated prices onto a configured route, so the gateway measures the real cost of each call. `modelsx.meters` shows budget, consumed, remaining and cost per answer for each route. Missing figures read "not counted", never zero.
- **Comparing routes.** An owner states the pass bars first (`bench.setPassBars`). `bench.compare` must quote the digest of those bars and replays the open bench across the routes, five runs each. The result table shows right, wrong, refused, interventions, invented numbers, attacks obeyed, actions without permission and cost per job, with a verdict against the bars. The bars cannot change mid-run.
- **Talking to it.** Speech providers are configured through the existing `speech.*` methods. The new kinds are `sarvam-stt`, `bhashini-asr` and `live-voice`. Before anything runs, `modelsx.speechInterpret` shows what was understood. Each negation ("nahi", "नहीं", "don't") is flagged as flipping the meaning, each number is shown in Indian grouping ("do lakh" → 2,00,000), and anything unsure is flagged. The person confirms the exact text with `modelsx.speechConfirm`.
- **A small app from one line.** `smallapps.propose` turns a line into a typed descriptor, using only published calculations and catalogue actions. It is local software with no model, and text in the line is treated as data. The person sees what the app uses and creates it with `smallapps.create`. `smallapps.open` runs every figure through the calculator as the caller, so each number has a receipt. A changed dictionary marks the app out of date until `smallapps.rebuild`. An action button only prepares the action, which then waits on the normal approval card.
- **Plugins.** `smallapps.pluginInspect` shows a `chausar.plugin.v1` file in plain words: what it holds, every door it asks for, and its signature status. `smallapps.pluginInstall` stores skills and data as quoted data and installs any WASM, disabled, into the existing locked box. The owner enables it through the core `plugins.enable` with the exact digest. `smallapps.pluginWrap` turns an Agent Skills `SKILL.md` or an MCP `tools/list` into an unsigned plugin file for review.

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
| `bench.compare` | prepare | `{routes?, runs?, barsDigest}`; `live: true` refused |
| `modelsx.speechCatalogue`, `modelsx.speechInterpret` | read | Providers; "what it understood" |
| `modelsx.speechConfirm`, `modelsx.speechBench` | prepare | Confirmation id; offline clip bench (host fixtures required) |
| `smallapps.propose`, `validate`, `list`, `get`, `open`, `records.list`, `records.history` | read | |
| `smallapps.create`, `rebuild`, `remove`, `pressAction`, `records.add`, `records.update` | prepare | |
| `smallapps.pluginInspect`, `pluginList`, `pluginGet` | read | |
| `smallapps.pluginWrap`, `pluginCallTool` | prepare | |
| `smallapps.pluginTrustKey`, `pluginInstall`, `pluginBlock`, `pluginRemove` | admin, app only, untainted | |

Refusal codes that screens can tell apart are on the models-ext line of `laneRefusals` in `app/desktop/preload.cjs`.

### Gateway route kinds added

- **`anthropic-messages`** sends `POST https://api.anthropic.com/v1/messages`.
  - The instructions go in `system` and the input is the only user message. No tools are declared, and `output_config.format` carries the JSON schema.
  - Credentials go in the `x-api-key` and `anthropic-version` headers.
  - It works for every gateway purpose.
  - A refusal, tool use, `max_tokens` or `pause_turn` stop fails once, with no retry.
- **`subq-snap`** sends `POST https://api.subq.ai/v1/systemone` to the Decisions API.
  - It asks two choice questions: which registered calculation answers the question (or `none_fits`), and which dated period preset applies.
  - Below 0.6 confidence it asks for clarification instead of answering.
  - It never fills branch or customer.
  - It serves only the analytical plan. Any other purpose is refused with `SNAP_PURPOSE_UNSUPPORTED`.

Both kinds keep the gateway's privacy gate, exact payload approval, single attempt and word-for-word receipt, because they run inside `ModelGateway`.

## Bench findings on synthetic transcripts

These results come from transcripts written by hand, not recorded from real providers. They test the scoring, not the providers.

- **Pass:** codex-cli, claude-cli, openai-responses, anthropic-messages and managed.
- **Fail:**
  - openai-compatible: invented numbers.
  - ollama: right-or-refused rate, invented numbers, attacks obeyed.
  - subq-snap: right-or-refused rate, because Snap cannot select a branch or customer, so branch-scoped questions come out wrong.

One caveat on SubQ: its period options are computed from the day of the run, so its synthetic period answers only line up while today is in October 2026. Its tests make no assertions about its figures.

## Core edits

- **`platform/runtime/gateway.ts`** (additive) adds the two route kinds. The changes are:
  - the `RouteKind` union and `PRIORITY` entries;
  - default endpoints;
  - two `modelPayload` branches and two `parseProviderOutput` branches, with an optional `payload` argument passed from `execute`;
  - provider-specific auth headers;
  - the Anthropic message extraction in the two conversation and synthesis disclosure checks.

  The provider code itself lives in `platform/runtime/providers/`.
- **`app/desktop/preload.cjs`:** codes added to the models-ext line of `laneRefusals`, the one permitted edit.
- **`docs/model-routes.md`:** sections for the new routes, pricing and speech providers.

## Cross-lane assumptions

- **hosted-link:** `hosted.allowanceCredential` returns `{endpoint, credential, model?, budgetMinor?}`. Until then, `modelsx.connectAllowance` refuses with `ALLOWANCE_NOT_AVAILABLE`.
- **jobs-ext:** reads costs from `modelsx.cost`, `modelsx.meters` and `modelsx.jobCost`.
- **reports-tools-trust and ask:** draw the screens over these methods.
- **The Monday brief:** may read the follow-up book through `smallapps.records.list`.
- **Core methods called:** `calculation.run`, `ontology.get`, `actions.catalogue`, `actions.prepare`, `plugins.install`, `plugins.list`, `plugins.run`, `plugins.remove`, `models.configure` and `speech.*`.

## Still missing, or needs the founder

- **Real provider data.**
  - Real bench transcripts need the founder's paid keys and installed CLIs; the steps are in `platform/benchmarks/routes/README.md`.
  - Real speech clips need recording.
  - Live comparison is not built (`BENCH_LIVE_NOT_BUILT`).
- **Accounts.** Paid accounts for OpenAI, Anthropic, SubQ, Sarvam, Bhashini (integrator ID and ULCA key) and OpenAI realtime.
- **Prices.**
  - There is no default FX rate; the owner sets it.
  - The SubQ price comes from a third-party listing and is marked unverified.
- **Live voice.** The renderer's WebRTC client and enforcement of the minute cap are not built.
- **Plugins.**
  - No network door (`PLUGIN_NETWORK_NOT_BUILT`).
  - No tool arguments (`PLUGIN_TOOL_ARGUMENTS_NOT_BUILT`).
  - Core registers no host functions, so code asking for a capability is refused.
  - A production publisher signing key must be created and held by the founder.
  - Recipes inside plugins are not yet handed to the recipe checker.
- **Small apps.**
  - The planner is local software. A model-made descriptor can enter only through `smallapps.validate` and `smallapps.create`.
  - The only catalogue action today is `local/reminder-draft`.
- **Configuration.** Speech provider configurations stay session-local, as before.
