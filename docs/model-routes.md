# Model routes and speech

The engine offers official installed Codex first, official Claude Code second, then API-key Responses, compatible Chat Completions, localhost Ollama, and a configured managed allowance. It selects one route and makes one dispatch attempt. It never changes routes after an error. Every external route is **experimental / not live verified** until exercised against that operator's installed version or endpoint. An entry in the route list does not certify installation, account entitlement, provider availability, or model support.

## Privacy and exact receipts

`TrustService` checks the current member role and epoch, branch scope, allowed sources and individual source grants. `nothing` denies model dispatch. `shape` sends field names and a question reduced to a fixed business vocabulary; amounts, customer selectors and arbitrary question text are omitted. `samples` adds at most five visible fact rows; callers select existing fact identifiers and fields, never supply their own unrestricted sample blob. Outside text remains data. Cloud requests that read source data require an owner or cofounder to approve the exact payload digest, endpoint and preview. That approval expires, can be consumed once, and cannot survive permission revocation. Local Ollama remains subject to the send policy.

The encrypted authority holds the exact application payload before dispatch, its SHA-256 digest, destination, member epoch, source lineage, one-attempt status, budget reservation and response digest. HTTP receipts contain the exact provider JSON body. Authorization headers are deliberately absent. Official CLI receipts cover the exact stdin submitted to the executable: `receiptBoundary=application-to-official-cli`, `providerPayloadObserved=false`. The CLI may add its own unpublished system prompt and authentication protocol; Chausar does not claim to observe those words or its internal destination. This is a material boundary on full provider-payload certification for subscription CLI routes.

Revocation is checked immediately before the call and after completion. A revoked result is withheld even though an already-started remote request cannot be recalled. Deletion removes the source and derived local records, leaving hashes and no-resend tombstones. Deleting a source requires a current administrator source grant and access to every affected branch; a source mixing allowed and restricted branches is refused. Retention cleanup removes expired facts and dependent records and requires a current owner with every branch and source grant. Remote providers' independent retention is outside local deletion authority.

## Official CLI configuration

Codex starts in a fresh temporary directory, using `exec`, `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--skip-git-repo-check`, read-only sandbox, JSON events and a JSON output schema. Config disables shell, unified execution, apps, multi-agent, hooks, memories, plugins, goals, web search and image viewing. Provider request and stream retry counts are zero. An unsupported installed version fails; there is no permissive fallback.

Claude Code uses print mode, `--restricted`, `--safe-mode`, no built-in tools, denied MCP tools, a strict empty MCP configuration, disabled commands, no browser and no session persistence. It uses one turn and an explicit schema. The subprocess environment disables network and structured-output retries, nonstreaming fallback, nonessential traffic, marketplace auto-install and title generation. Managed administrator policy remains outside application control. Live version qualification must inspect that policy as well as tool denial.

Use native official executables. Windows shell wrappers are intentionally refused. The subprocess inherits only the environment needed to find the official executable and its own login. Chausar never opens, copies, saves, converts or exports subscription token files. A CLI configuration cannot accept an API secret.

Official references checked during implementation:

- [OpenAI CLI reference](https://developers.openai.com/codex/cli/reference)
- [OpenAI configuration reference](https://developers.openai.com/codex/config-reference)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code environment variables](https://code.claude.com/docs/en/env-vars)

## HTTP routes and credentials

`openai-responses` posts tools-disabled JSON to the configured HTTPS Responses endpoint. `openai-compatible` posts one tools-disabled Chat Completions request. `ollama` posts a schema-constrained chat request only to loopback. All redirects are refused. `managed` requires an explicitly configured real HTTPS service and credential; there is no included allowance service bundled in this repository.

`ModelGateway.configureRoute(context, config, secret?)` retains an API key in engine memory only. Alternatively supply `credentialEnv: 'CHAUSAR_PROVIDER_KEY'` or inject a credential broker. Keys never enter workspace snapshots, receipts, route metadata or renderer storage. In-memory keys must be supplied again after restart. The broker may implement an encrypted engine-owned secret service; plugin code must not receive it.

The explicit model identifier comes from the operator. The code does not advertise an invented live model or hardcode account entitlements. Configuration supports integer paise strings for `budgetMinor`, `maxCostMinor`, `inputPerMillionMinor` and `outputPerMillionMinor`. Each dispatch reserves its configured maximum using BigInt. Failed calls keep that conservative reservation, and a non-sensitive cumulative route counter survives deletion/retention of detailed receipts. When HTTP token rates are configured, the reservation must cover a conservative request-byte/output-token bound. Provider-reported token usage produces cost only when both operator-configured rates are present; otherwise `actualCostMinor=null` and the receipt says cost was unavailable. Actual usage above an estimate raises the accounted reservation. These local controls cannot retrospectively cap a provider invoice; set the provider's own spend cap as well.

## Analytical output contract

The model chooses an operation from the currently published dictionary and may select an inclusive ISO-date period and already-visible branch/customer identifiers. Without a dictionary, a small seed catalog supports the first-day flow. A present but unpublished dictionary provides no executable catalog. Unknown keys, arbitrary operations, impossible dates, unavailable selectors, tools, SQL, code, URLs and numeric explanations fail validation. Optional schema properties may be null and are normalized away. The model never supplies a calculated amount or executable query. The deterministic calculator produces all figures and their proof separately.

```ts
const preview = await gateway.preview(context, { question, routeId });
const approval = preview.approvalRequired
  ? await gateway.approveOutbound(ownerContext, preview.id)
  : undefined;
const { plan, receipt } = await gateway.execute(context, {
  previewId: preview.id, approvalId: approval?.id,
});
```

## Speech providers

`SpeechService` keeps speech separate from model planning. Its default `browser` provider accepts transcript text only and records that the browser provider may process audio remotely; this is not certified offline recognition. A browser transcript can be accepted directly or through a one-use preview.

`local-command` supports an installed `whisper.cpp` `whisper-cli` executable and model, each supplied as an absolute path. It handles wav, mp3 and ogg recordings in a temporary directory, suppresses timestamps and logs, disables decoding fallback and detects language. Chausar makes no network call for this path; the operator must qualify the installed binary. See the [upstream CLI reference](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md).

`api-upload` takes an explicit HTTPS transcription endpoint, API key, model and paise-per-minute estimate. It requires the samples policy and a human approval of exact multipart bytes. The preview includes the payload base64 and digest, filename/content type, duration and reservation. Supported uploads are wav, mp3, mp4, webm and ogg, under nine megabytes and five minutes. This adapter performs recorded-file transcription, not a deployed live-voice session. Browser and provider durations/costs are not fabricated as measured billing. See the [OpenAI transcription contract](https://platform.openai.com/docs/api-reference/audio/createTranscription).

Speech provider configurations are session-local; configure installed binaries and upload providers again after restart. API secrets remain memory-only or broker-injected. Permission changes, provider revocation, redirects and provider errors stop the request without retries.

## Verification

`node --test platform/tests/gateway.test.ts platform/tests/speech.test.ts` covers privacy enforcement, exact payload approvals, before/after revocation, source scopes, BigInt budget boundaries, strict plans, redirect refusal, one-attempt behavior, source deletion/retention, isolated CLI process arguments, opaque credentials and speech upload receipts. All transports are injected mocks. Those tests establish application behavior; they do not constitute live provider, installed CLI or audio-quality certification.
