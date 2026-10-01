# Controlled synthetic workspace activation

`platform/runtime/workspace-activation.ts` implements isolated root orchestration for an explicitly reviewed synthetic business projection. It does not install historical `State` as a live Engine. The existing `workspace.interchange.export/prepare/review/discard` public methods remain inert. This package adds no RPC or shared schema, Vault implementation, filesystem transaction, Engine attachment, scheduler, provider or model capability.

This is a source-package fixture slice. Its tests use actual AES-GCM in private memory with `qualification: 'test-fixture'`. They do not qualify installed/native storage, application UI, HTTP, database, enterprise custody, or real migration.

## Admission and review

The constructor requires `WorkspaceActivationPorts` and an explicit `WorkspaceActivationPolicy`. Only root-approved exact workspace identities in `approvedSyntheticWorkspaceIds` qualify. Every activated fact and legacy import source must be in `allowedSyntheticSourceIds`. `workspace.demo`, a source name, user JSON, or a caller-provided synthetic flag cannot grant admission. The root must independently establish that its configured source workspace is the intended synthetic fixture, including its current physical custody and complete inventory. An unrestricted current untainted desktop owner is required.

Positive constructor budgets cover the complete candidate bytes, retained artifact bytes/count, fact history count and total store records. Budget failure refuses the entire activation. The host does not truncate history, narrow the requested source scope, drop fact rows or invent an arbitrary business cut.

`review(context, { candidateId, reviewedDigest })` reopens authenticated candidate ciphertext and its separately issued pin, rebuilds the candidate against the independently retained inventory and empty-target proof, and obtains a held root transaction. It checks source readiness, full current access, current source inventory, exact candidate issuance, current target permissions, target identity and uninitialized generation again inside that transaction. The return includes `projectionDigest`, business store dispositions and inert import/grant identities.

`activate(context, { candidateId, reviewedDigest, projectionDigest, activationId, confirmed: true })` requires both exact acknowledged digests and an explicit single-use activation identity. It repeats all admission checks inside source, target and record exclusion, allocates fresh authority, rechecks the fences, attempts publication once, and requires exact authenticated readback. A changed fresh retention/source policy changes the projected digest and requires review again.

## Active projection and preserved meaning

The historical archive remains complete in `WorkspaceActivationEvidence`, including the exact originally authenticated candidate text and independent pin. The root must preserve this entire evidence encrypted and inert, even if a business projection excludes its administrative or executable records.

The active projection preserves:

- Every fact and original array order, IDs, source rows, exact fields and minor-unit strings, valid/learned/superseded/deleted dates, branch and lineage.
- Exact ontology current/history, dictionary/compiler artifacts and object key order. Existing semantic pins using `JSON.stringify` remain valid.
- Legacy import records for the six currently implemented formats, their original retained input/recipe material, coverage and pins. Original source and recipe bodies remain in the complete encrypted archive.
- Business source precedence records, including an empty `sourceIds` list meaning agreement is required. Historical `by` is evidence of authorship and confers no current authority.
- Conflicts, merge/undo history and tombstones needed to preserve current interpretation and explicit known-on cuts.

`sourceRules` also contains access grants. Historical grants remain in inert evidence. Only precedence records containing the business fields `id`, `kind`, `sourceIds`, `at`, and optional `by` can be active; records that mix precedence and access authority refuse activation.

Active legacy imports must be complete untyped importer records with supported fields. A typed runtime record claiming a legacy format refuses activation. Retained original input, recipe/content hashes and generation must agree exactly. Every source in facts and imports requires current source access, including sources with no fact rows. Published ontology hash, operation/compiler catalogue, schema/null rules, current dictionary and ordered history must be coherent before activation.

Old members, policy, workspace identity, revision, receipts, answers, decisions, actions, jobs, learning, plugins, model receipts, activity, conversations, provider routes, sessions, unsupported requests and schedules stay inert. The target starts with empty runtime collections, a fresh root-allocated owner/context/session authority, revision zero and a distinct reserved workspace identity. The fresh reviewed policy has `send: 'nothing'`, autonomy and sharing disabled, named synthetic sources only, and explicit bounded retention. No historical credential, approval, lease, bearer token or session becomes a grant.

All `connector-*` import history refuses this first activation slice, including records that also claim a legacy format. Dropping old capture/binding markers while copying connector facts would bypass acquisition guards. Managed stale or quarantined connector evidence cannot qualify by copying. A future connector activation profile requires fresh installed acquisition/read/semantic gates, with missing current profiles refusing all relevant consumers.

Explicit `asOf` preserves fact versions, precedence and identity history. The calculator still uses the current published dictionary; preserving ontology history does not make `asOf` automatically replay an earlier dictionary.

## Root port implementation contract

The exported types in `workspace-activation.ts` are constructor ports, never RPC callback payloads:

| Port | Required root behavior |
| --- | --- |
| `custody.read(context, candidateId)` | Authenticate the exact candidate archive, independent issuance pin, creation instance and committed ciphertext binding; return measured encrypted custody. Never adopt self-consistent caller hashes as provenance. |
| `withTransaction(context, pins, work)` | Hold source writer/inventory/access exclusion, exact candidate record exclusion and exclusive reserved physical target custody through callback, commit and readback. Execute the callback exactly once. Recheck actual current inventory and exact uninitialized target physical identity/generation against the supplied independent pins. |
| `lease.source.assertCompleteOwner` | Check current unrestricted owner, every historical source and row, complete source enumeration and all current consumer/acquisition readiness. Historical members alone are insufficient. Complete asynchronously and return `undefined`. |
| `lease.source.assertCurrent` | Recheck captured source State, retained artifact bytes, access and readiness fence under held exclusion. Complete and return `undefined`. |
| `lease.readCandidate` | Authenticate the same durable candidate creation instance and independently bound pin again under the held record lock. |
| `lease.assertCurrent` | Before publication, recheck source, exact candidate, actual empty physical target identity, permissions and uninitialized generation. Complete and return `undefined`. |
| `lease.allocateAuthority` | Allocate a distinct fresh current owner ID and root session authority; verify no old session/token/member tuple is admitted. Bind them to the reserved workspace identity. Do not publish authority at this stage. |
| `lease.commit(publication)` | Enforce durable single-use CAS for both `candidateCreationId` and `activationId`; initialize only the exact reserved uninitialized target; atomically retain encrypted full evidence, reviewed projection, fresh authority and final binding without overwrite. Keep source/record/target exclusion held. Refuse consumed, failed, pending and ambiguous attempts after restart. |
| `lease.readback()` | Authenticate the exact committed initial bootstrap snapshot, complete evidence, independent pin, fresh authority and durable binding under the same held transaction; report measured encrypted bytes and truthful qualification. |
| `ports.readback(context, { activationId })` | Explicit restart/recovery inspection. Independently verify current owner authority, exact source issuance and committed target custody. Return committed, failed or unknown; do not retry, adopt a partial directory, overwrite, or attach Engine. |

The existing inert interchange `withTarget` performs an empty-target check on lease exit. An activation transaction needs a separate phase-aware implementation: the target is legitimately initialized after publication, so final source exclusion/readback checks must replace an inappropriate post-commit empty assertion. The original reserved physical identity remains bound throughout.

The root must persist the committed initial bootstrap snapshot separately from later live revisions so `resolve` can compare its exact original `stateDigest`. Subsequent fresh receipt writes alter live State; they do not rewrite the one-time activation binding or full historical evidence. Restart recovery must also verify the actual initialized target and live source/authority custody before allowing Engine use. A bootstrap receipt alone cannot qualify an arbitrary later target.

`stateDigest` is SHA-256 of `JSON.stringify(state)`, matching the persisted insertion order. The host also reconstructs and compares the exact ordered bootstrap State on readback. Canonical JSON hashes alone are insufficient: reordering dictionary, definition or recipe object keys can invalidate existing semantic pins even when canonical content is unchanged.

Source/target storage is a cross-vault operation. The host cannot implement filesystem publication or invent atomicity across them. The root must provide a durable attempt/commit journal, no-overwrite publication and exact recovery rules that distinguish committed, definitively failed, and unresolved outcomes. An unacknowledged commit cannot be treated as rollback success. Unknown targets remain unavailable until explicit root inspection establishes their exact custody.

## Unknown outcomes and restart

Any failure after entering `lease.commit`, including lost acknowledgement, failed readback or lease-exit failure, becomes `ACTIVATION_COMMIT_UNKNOWN`. The host does not remove a possibly committed target or try again. The user/root can explicitly call `resolve(context, { activationId })`. Unknown/failed results retain the exact attempt identity; committed results revalidate evidence, projection, fresh authority and every issuance/target binding before returning a summary. This method inspects; it never activates or attaches the target.

Durable single-use enforcement is a root storage responsibility. A new host process has no in-memory activation ledger and therefore cannot substitute an in-memory set for root CAS. Creating another activation ID for the same candidate creation instance must still refuse.

## Verification and remaining gates

Focused verification:

```powershell
node --test platform/tests/workspace-activation.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --verbatimModuleSyntax --skipLibCheck platform/runtime/workspace-activation.ts platform/tests/workspace-activation.test.ts
```

Fixture tests cover encrypted complete history, separate reviewed projection, fresh authority, inert runtime collections, old-context refusal, exact source/target/candidate fences, budgets, malformed guards, ciphertext corruption, synthetic provenance policy, managed source refusal, durable single-use, explicit unknown readback, lost commit acknowledgement and exact restart bootstrap validation. Three newly calculated billed/received/earned receipts match the independent answer key (`300000`, `260000`, `250000` minor units) after activation and fixture restart. Their fresh member/epoch identities are intentionally different. After checking those differences explicitly, every remaining receipt semantic field compares exactly, with only normal new receipt ID/creation time ignored. Further known-on fixtures check correction order, precedence, merge/undo and tombstones.

Required before claiming a usable transferred workspace: actual root Vault/filesystem transaction and authenticated restart recovery, public root-owned review/activation surface, target Engine owner/session binding, full current connector/profile consumer gates, and three actual fresh calculation receipt comparisons through HTTP/Vault before and after restart. No existing user vault mutation, native database, GUI, provider/model invocation, real migration, enterprise/full-scope qualification or release/install claim is authorized or proven by this package slice.
