# Conversation contract verification — 2026-10-01

Backend source read-only: `../task/luna-synthesis-engine`, HEAD `ce5dc4f6c432ce637b23cbd26f159346acdcd68e`.

## Deliverables

- `../src/bridge/conversation-contract.ts`: exact seven method payload types and checked projections for planning/synthesis previews, outbound approval, clarification/grounded/synthesized replies, all five retained history forms, and retained continuation.
- `conversation-fixtures.ts`: shared synthetic wire fixtures, explicitly separate from live evidence.
- `conversation-contract.test.ts`: 22 actual-module tests; `tsconfig.conversation.json` extends the real strict foundation configuration.
- `conversation-contract-host-current.tap`: final combined 22 contract + 23 host tests, 45 pass, zero failures/skips. Host implementation/tests belong to the host worker.

Both strict commands succeeded using existing TypeScript 5.9.3, without installing packages:

```powershell
node --test --test-reporter=tap --test-timeout=60000 app/ui/tests/conversation-contract.test.ts app/ui/tests/conversation-host.test.ts
& 'C:/Users/karta/Documents/Codex/2026-10-01/task/integration/node_modules/.bin/tsc.cmd' --project app/ui/tests/tsconfig.conversation.json
& 'C:/Users/karta/Documents/Codex/2026-10-01/task/integration/node_modules/.bin/tsc.cmd' --project app/ui/tests/tsconfig.foundation.json
```

## Direct Engine compatibility proof

The final test creates a synthetic experimental-file workspace in the C temporary directory, configures local Ollama and official Claude CLI route metadata, and obtains actual Engine `models.preview`, `models.approve`, local business `conversation.ask`, and `conversation.get` outputs. Both HTTP and process dispatch adapters throw if called. Dispatch count is zero. No credentials, model inference, network, vendor acquisition, D writes, or shared backend changes occur. Cleanup checks the exact temporary child directory before removing it.

Standalone artifacts can set `CHAUSAR_UI_ENGINE_SOURCE` to the frozen source checkout. When actual Engine source is unavailable, that one test explicitly skips; this recorded run had zero skips.

## Checked bindings

Exact question whitespace and absent versus explicitly empty source scope are retained. Continuation hashes use the original server JSON insertion order and release only server-retained text. Preview verification checks SHA256 payload/question/schema hashes, CLI or supported HTTP input envelopes, exact outbound question and continuation disclosure, private scope digest, exact synthesis summary/authority digest, and individual synthesis evidence hashes. Only the verified frozen preview identity can construct approval or dispatch requests; invented preview copies cannot.

Replies reject unsupported fields/tools, stale calculation receipts, uncited claims/conflicts, suppressed fixed business limitations, malformed error codes, mismatched receipt IDs, forged final cautions/references, and changed retained tool bodies. The fresh error limit is 512 characters; retained history admits 2,000, matching the distinct backend validators. The only readback ID alias is an actual clarification's model receipt ID; returned continuation ID remains server canonical.

Independent read-only review reproduced and checked 12 scoped malformed/valid fixture cases. All previously reported gaps now reject; no unresolved concrete finding remains within that review scope.

## Authority limits

These projections and digest checks validate the renderer's review and presentation boundary. The Engine remains responsible for current source/row permissions and readiness, retained child reopening, installed codecs, current approver authority, expiry and single-use consumption, no-resend rules, and dispatch. Public synthesis output lacks the typed output parts required to independently recompute `outputDigest`; the Engine's synthesis host owns that binding and the frontend host reads back the current retained answer. Grounded/synthesis full flows use synthetic source-shaped fixtures here, without performing model dispatch.

Source references: `platform/runtime/gateway.ts:129`, `:468`, `:557`, `:602`; `engine.ts:452`; `conversation-context.ts:170`, `:209`; `conversation-history.ts:210`; `conversation-synthesis-host.ts:62`, `:143`.
