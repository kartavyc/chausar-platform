# Actions, jobs and extensions

The local runtime has separate contracts for calculation, preparing an effect and executing an effect. A calculator or a plugin cannot acquire write permission by reading a source. Registered connectors describe their payload validator, independent write grant, provider idempotency rule and readback procedure.

## Action state machine

`prepare → approve → execute → readback → verified` records an attempt before calling its provider. An approval binds the canonical payload, sorted source IDs, connector, operation, idempotency key, action revision and approver epoch. Changing the preview removes approval. Accountant and viewer roles cannot approve. Imported text cannot approve or execute effects. Permission checks run again against current member epochs and source rules before execution and before a result is returned.

One action has one execution attempt. A timeout, dropped connection or unverifiable result produces `unknown`, never an assumed success. `reconcile` performs a read without repeating the write. A connector that proves the effect absent settles the attempt as `rejected`; creating a replacement remains a new, explicitly reviewed action. Verified delivery is recorded separately from business success. A reminder draft can be verified while its business outcome is false because nothing was sent.

The included fixture tests inject a provider that commits and then drops the connection. Production external connectors require separately configured providers and explicit write authorization; the shipped local reminder connector persists a draft and sends no external message.

## Durable jobs

A job needs a goal, accountable active owner, budget in integer INR paise, maximum runs and stop deadline. The global autonomy switch defaults off. Job configuration previews and required mandate approvals bind a digest and revision. External effects still use the action approval protocol.

Reservations, incremental route costs, leases and fencing counters live in the encrypted StateStore. Acquiring two workers concurrently creates one reservation. Expired leases release their remaining reservation, retain costs already charged, and fence out late completion. The catch-up policy is explicitly `latest` (one delayed run) or `skip` (advance to the next due slot). Paused, revoked, approval-blocked and budget-blocked jobs do not execute. Deliveries wait for human acceptance; they are not marked complete merely because a worker returned output.

The desktop engine can run a local due job while it is open. A host service must call the same acquire/charge/heartbeat/complete methods to run jobs with the window closed. The preview does not provide a paid hosted scheduler.

## WebAssembly plugin format

Plugins are disabled when installed. The owner reviews and enables the exact module and manifest digest.

```json
{
  "id": "constant-answer",
  "name": "Constant number demo",
  "version": "1.0.0",
  "runtime": "wasm",
  "entrypoint": "run",
  "capabilities": [],
  "sourceIds": [],
  "maxMemoryPages": 16,
  "timeoutMs": 1000
}
```

Only WebAssembly 1 binaries up to 1 MiB are accepted. Memory must declare a maximum no greater than the reviewed limit; maximum permitted memory is 256 pages (16 MiB). The module runs in a dedicated Node child process with permission mode, a clean environment, a 32 MiB JavaScript heap limit and a parent-enforced deadline. Infinite loops kill the child. No plugin JavaScript is loaded or evaluated. `vm`, `vm2`, WASI, filesystem, arbitrary network, imported memory, process and credential access are refused.

The only host ABI is a zero-argument function imported from `chausar` returning a finite scalar. Every import must exactly match a manifest capability and a registered parent `HostFunction`; its declared sources must be present in the manifest. The engine checks the current caller’s source and branch permissions, computes approved scalar values in the parent, and passes only those numbers into the child. The child never receives workspace data, keys or secrets. This deliberately narrow ABI does not claim compatibility with arbitrary Agent Skills, MCP servers or network plugins. Wrappers for those formats need explicit host capabilities and further review.

`fixtures/plugins/constant-answer.json` contains a runnable constant plugin. `fixtures/plugins/constant-answer.wasm` is its actual WASM module.

Generated miniapps are a separate data-only JSON format with metric/table cards referencing current published receipts, and action cards linking already approved exact actions. They accept no JavaScript, HTML, URLs or event handlers. The renderer descriptor requires an empty iframe sandbox, no allowed browser capabilities, no referrer and a restrictive CSP. This is a constrained dashboard builder, not an arbitrary app builder.

## Learning consent

Local mapping, matching, calculation and action decisions can be recorded in the encrypted learning log. Structure export is disabled by default, and an exporter is not configured in the shipped app. The redactor reconstructs each outbound event from enumerated event kinds, choices, canonical field names, field types, report shapes and reason codes. Free text, values, names, amounts, IDs and exact times are excluded; unknown source-column names are excluded rather than assumed safe.

The owner sees the exact JSON payload and its digest before consent. Consent binds both that digest and the immutable source decision hashes. Editing a decision, revoking source access, changing the consenting member epoch or turning sharing off blocks export. Each consent permits one transmission attempt. An ambiguous transmission stays `unknown` and is not automatically resent. Consent and export receipts have local integrity hashes and remain visible in the sharing history. Local administrators can modify application files; these are integrity receipts, not externally notarized signatures.

## Verified-numbers MCP and phone approvals

The MCP server explicitly supports initialized protocol `2025-11-25`: `initialize`, `notifications/initialized`, `tools/list`, `tools/call` and `ping`. It advertises registered closed-schema calculations and, when the current calculator receipt reader is configured, `open_receipt` and `list_counted_rows`. All tools carry read-only annotations. It does not claim the newer stateless `2026-07-28` protocol. Unsupported clients receive the pinned version during negotiation and must use it or disconnect. The line-delimited stdio adapter is available for local integrations; the desktop engine also exposes the same handler on its authenticated local transport.

A calculation returns an exact integer minor-unit value, its stored calculation receipt and `receiptDigest` (SHA-256 over canonical JSON). The value must occur in that receipt. The configured current receipt reader checks both owned and shared receipts, including counted and excluded evidence and connector readiness. Grants for counted and explicitly requested sources (including empty ones) are checked before and after the reader, while branch access follows the receipt's actual rows. A branch-scoped receipt does not require permission to unrelated branches in the same source. Row-backed receipts fail if the reader is unavailable; the legacy bare stored-scalar registration contract remains available without the evidence tools.

`open_receipt` accepts `receiptId` and an optional `receiptDigest`, returning the exact retained receipt and digest. `list_counted_rows` requires both pins and accepts a safe nonnegative integer `offset` and an integer `limit` of 1–100 (defaults: 0 and 50). It returns `receiptId`, `receiptDigest`, `offset`, `limit`, `totalRows`, retained `rows` and `nextOffset` (null on the final page). These reads check the full receipt's current permission and evidence, including excluded facts, before returning a page. They do not recalculate or mutate the workspace. Repeated reads return the same evidence; a changed pin, stale definition, missing evidence or current revocation refuses it. Preserved historical knowledge cuts remain readable when their retained facts and permissions are still available.

Tool refusals return no result numbers or evidence. Permission denials use JSON-RPC errors with public codes; other failures use `isError: true` with a bounded public code. Callback messages and unrecognized callback codes are withheld. Current member authority is checked again after an awaited calculation completes or fails. Arbitrary expressions, writes, approvals and foreign receipts are not exposed. [Source/public acceptance and remaining qualification](mcp-receipt-access.md) describe this incremental join; actual outside-assistant pairing and disclosure remain separate qualification.

Phone approval tokens are random, hash-stored, one-time and expire within five minutes. They bind an exact prepared simple message, owner ID and permission epoch. Money, destructive effects, general chat, mandate approvals and plugin approvals remain inside the app. Consuming a token approves its message; execution still happens through the local app action service. No WhatsApp or mail messages were sent while building or testing this code.
