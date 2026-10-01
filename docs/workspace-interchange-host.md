# Async workspace interchange host

`WorkspaceInterchangeHost` joins the pure codec to constructor-only trusted custody ports. It owns no filesystem enumerator, Vault/StateStore, database, keys, scheduler, provider, IPC or activation capability. Engine/Vault, actual retained-original/recipe custody, manifests and shared interfaces remain integration-owned.

The host exports these bounded operations:

```ts
await host.export(context, { destinationId, confirmed: true });
await host.prepare(context, { exportId, candidateId, targetId });
await host.review(context, { candidateId, reviewedDigest });
await host.discard(context, { recordId, reviewedDigest });
// Optional separate explicit open-export port; encrypted custody is the default.
await host.exportPlaintext(context, { destinationId, confirmed: true });
```

IDs are opaque root-owned identities, never filesystem paths. No destination is automatically selected. Public summaries contain IDs, digests, counts, inert status and actual measured byte sizes, without archive text, definitions, facts, historical State or key material.

## Root ports and lifetime

`withSource(context, expectedInventoryOrNull, work)` holds exclusive current-source custody through the complete asynchronous callback. It supplies detached `State` and `ArtifactCapture`, readiness, `assertCompleteOwner(context,historicalState)` and `assertCurrent()`. Both guards must finish asynchronously and return undefined. Root must resolve current complete workspace/source/row access, readiness and the actual authority/artifact fence. Historic member records alone are insufficient.

The codec receives all category witnesses and exact retained bytes from this independent capture. The host never synthesizes missing witnesses or retrieves missing originals/recipes. A missing category, import body or unknown persisted store refuses. When reopening an export/candidate, the independent durable inventory is passed back as an expected capture; root must verify current content, access and retained bytes against it while preserving its capture/enumeration identity. Reissuing a different generation cannot silently validate an older export.

`withTarget(context,{targetId,mode},work)` exclusively allocates or opens a root-owned **uninitialized** target. The supplied actual inspection must enumerate all26 stores and all9 artifact categories as absent, with no authority records or unexpected entries. It supplies an independent access digest and immutable generation, plus `assertCurrent()`. Root allocation must rollback an unsuccessfully allocated reservation where safe. Source is acquired before target; keep this lock order consistent. Source/candidate custody records must reside outside this target namespace so writing them does not falsify the empty-target proof.

`custody.create/read/remove` owns encrypted persistence. Archive and full independent inventory pin must be separately authenticated and committed together. Bind each ciphertext to its record identity and purpose. Create refuses any existing record and must not expose a partial result on failure. Read authenticates both ciphertexts and returns actual ciphertext byte measurements. Removal compares both `expectedPinDigest` and `expectedContentDigest`, removing only that exact owned pair. These are host ports, not constructor-free user callbacks or raw file paths.

After creation the host rereads the exact retained pair and checks both source/target fences. An operation-wide cleanup boundary includes final guards and failed lease exits. If a check fails after creation, it attempts exact pair removal; cleanup failure is reported as `INTERCHANGE_CUSTODY_CLEANUP_REQUIRED`. This narrowly bound creation rollback may run after a failed source/target lease exit: custody removal must independently compare the exact privately owned record/pin, without requiring permission to alter current workspace authority. Root transactions must keep their fences through callback completion, including final checks. They must not commit unexpected mutations after releasing a lease or swallow callback failures. Caller input is detached before any awaited custody so confirmation stays bound to the original destination and target.

The encrypted pin binds record kind/identity, a unique per-create `creationId`, preparing context, full independently issued source inventory and package digest. Removal's pin digest includes that creation identity; a late cleanup cannot delete an identical-content replacement created after an authorized discard. Candidate pins additionally bind the exact candidate digest and complete independent target inspection. Reopening does not depend on an in-memory candidate map. Wrong context, substituted pin/content, current source changes, target creation races or an altered review digest refuse.

Discard checks the current complete owner/readiness and exact historical record binding. A later source revision does not prevent the same authorized owner from disposing of an old owned archive. Discard removes the archive/pin only; root retains target reservation disposition. It never deletes or activates a target authority.

Optional `plaintext.create/remove` is a separate confirmed root destination port pair. Creation must hold the same source fence, refuse overwrite, retain the unique supplied `creationId` in private output ownership metadata, attest exact UTF-8 bytes/creation identity and leave no output if it throws before acknowledgement. Exact removal compares destination, creation identity and content digest. The host removes acknowledged output on a later byte/fence/lease-exit failure; unavailable exact removal reports `INTERCHANGE_PLAINTEXT_CLEANUP_REQUIRED` without overwriting any replacement. No plaintext write occurs through default export or candidate preparation.

## Activation boundary and evidence

Review returns an inert summary and does not initialize a Vault or attach historical State. Integration must independently repeat current source/target/access/readiness checks inside its actual exclusive activation transaction. Source sessions, routes, plugins, action approvals, jobs, leases and schedules are evidence and must not become active authority. The host deliberately has no activation port in this revision.

The focused host tests use actual AES-GCM encryption in private test memory with separately authenticated archive/pin ciphertexts. They label measurements `test-fixture`; these are neither installed filesystem custody nor a native/product acceptance pass. Root may supply `encrypted-local-host` measurements only from its actual encrypted custody implementation. No GUI, model, provider, dependency acquisition, D-drive writes or live user migration is involved.
