# Local Codex CLI adapter

This isolated adapter implements the user's local Codex CLI choice. The native CLI owns normal ChatGPT sign-in. It accepts one explicit model ID; Luna is not advertised as available without actual account evidence. No API credential, login/browser flow, backend endpoint, dependency or automatic paid fallback is introduced.

## Reviewed official interface

Reviewed 2026-10-01. The [official CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli) documents `exec`, stdin `-`, JSON events, explicit model/schema, ephemeral runs, read-only sandbox and ignoring user config/rules. Ignoring user config preserves CLI-managed authentication. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents the ordinary configuration keys in `CODEX_CLI_CONFIG`, including forced ChatGPT authentication and explicit OpenAI provider selection. The [non-interactive reference](https://learn.chatgpt.com/docs/non-interactive-mode) describes completion/failure/error events and schema output.

Original primary URLs fetched: `https://developers.openai.com/codex/cli/reference`, `https://developers.openai.com/codex/config-reference`, `https://developers.openai.com/codex/noninteractive`; each redirects to the official pages above.

`features.plugins` is described in managed requirements, so this adapter does not assume an ordinary per-run override. Built-in provider IDs are reserved and cannot be redefined. The adapter consequently omits `model_providers.openai.*` retry overrides. It invokes its injected process exactly once. Internal CLI retries, effective managed policy and complete prevention of every vendor tool are unverified; refusing tool events cannot undo an already attempted tool.

## Consumer interfaces

`platform/runtime/providers/codex-cli.ts` exports:

- `buildCodexCliArguments(model, schemaPath, capabilities)`: checks an explicitly supplied supported interface profile and builds the bounded documented command. Missing support refuses the run; controls are never silently removed.
- `parseCodexCliOutput(stdout)`: validates bounded unknown JSONL, one final plan object and successful `turn.completed`; refuses errors, failed/duplicate turns, duplicate final messages, malformed/unsupported events and tool items. Usage is validated when present and never invented. The returned `value: unknown` still requires the existing `validatePlan` gate.
- `createCodexCliProcessAdapter({ capabilities, process, mode })`: preserves the injected `ProcessRequest -> Promise<ProcessResult>` boundary using type-only gateway imports. Exact arguments, native command, CLI-owned environment, input/schema limits and timeout are checked before one invocation. Successful exit alone is insufficient. This module never spawns, opens authentication files or writes a schema.
- `codexCliBoundary(request)`: hashes exact application stdin and the declared schema; reports `application-to-official-cli` with `providerPayloadObserved=false`. The declared schema digest does not prove schema-file contents or the vendor's hidden provider payload.

`synthetic-fixture`, `official-docs` and `installed-help` profiles carry separate evidence. Documentation profiles can build arguments; local process mode requires installed-help evidence bound to the exact native executable. Fixture profiles require explicitly synthetic process mode and cannot qualify a live native process. These host-supplied profiles describe interface evidence, never verified login, account entitlement, model support or commercial eligibility.

The trusted host creates an isolated temporary directory, writes exactly `JSON.stringify(request.schema)` to the schema path, builds arguments, and supplies the existing process port with `shell:false`, timeout and output bounds. The CLI receives the host's ordinary login-location environment, including `CODEX_HOME` when provided; the adapter never reads its contents. Injected ports must enforce actual timeout/output limits while streaming. Post-return validation cannot bound a misbehaving port's allocation.

## Root-owned integration

Root later delegates the Codex branch of `gateway.ts::cliArguments` to the argument builder and its provider parser to `parseCodexCliOutput`, keeping `validatePlan`, exact outbound approvals, source revocation and budget authority in ModelGateway. Inject the adapter process through `GatewayOptions.process`; add trusted EngineOptions/Engine attachment injection if needed. Engine currently constructs `new ModelGateway(store)` directly. No shared gateway, Engine, renderer, manifest, HTTP or IPC file is changed by this worktree.

Keep existing CLI receipt semantics: exact application stdin, response hash, one attempt, and `providerPayloadObserved=false`. Do not persist child environment, authentication material, raw CLI errors or fixture account claims in production receipts. Public app fixture tests and real qualification belong to root's later joined checkpoint.

## Verification and remaining qualification

All tests in `platform/tests/codex-cli.test.ts` are labelled synthetic. They verify the protocol, completion requirement, bounds, unsupported capabilities, existing plan validation, exact process boundary and one-attempt failures. They launch no native executable and establish no provider/account qualification.

Run focused fixtures with `node --test platform/tests/codex-cli.test.ts`; strict compile with `node node_modules/typescript/bin/tsc --noEmit`. The worktree uses already verified dependencies; no acquisition is required.

Local verification: 33 synthetic tests passed; the full configured strict application TypeScript compile passed using the staged TypeScript 5.9.3. No broad application or semantic fixture suite was run in this independent worktree.

No trusted native executable was located in the bounded discovery. `codex`/`codex.exe` were unresolved on this executor's PATH; selected known install locations and matching Appx metadata did not supply a binary. This does not establish global absence. Process-path lookup returned `Get-CimInstance: Access denied`; listing `C:/Users/karta/AppData/Local/OpenAI` was also denied. Neither action was retried or rerouted. Version/help were not invoked; authentication files and session directories were never opened.

Actual qualification remains outstanding: a trusted native executable and its version/help; CLI-owned ChatGPT sign-in evidence without copying credentials; positive support for the requested actual model ID; one completed explicitly synthetic inference through the public app route with no business effects. Luna availability, commercial/hosted eligibility, internal retries and effective vendor/managed controls remain unverified. No live inference is authorized in this adapter task.
