# Complete workspace interchange: source lane and root join contract

This lane implements `LIVE-D03-B11/A10`, `GAP-INT-51`, `GAP-INT-86` and the complete-generation requirement in `FIP-24-42`. Source base is `6ead4d1b5ad81eb2c828cfc7bbd0648de3f22754`, tree `1a7847e28cc4ea4706cb53cb6a92e9918505a088`. It adds only three new runtime modules, focused tests and this contract. Engine, Vault, shared IPC/preload/contracts, manifests and publication remain integration-owned.

## Wire and exhaustive inventory

`captureWorkspaceInterchange(state, artifactCapture)` creates a detached version 1 package and an independently retainable source inventory. `encodeWorkspaceInterchange` produces deterministic compact canonical outer JSON. Each State store is a compact JSON **text value**, preserving the original nested property order. The existing compiler/dictionary/recipe hashes depend on `JSON.stringify` order; sorting those nested keys would invalidate real bindings. Undefined object properties follow existing Vault persistence semantics and are omitted. Cycles, callbacks, getters, classes, nonfinite values, sparse arrays and deep/oversized input refuse.

The reviewed profile has 21 collection stores and five singleton stores. Every store is mandatory, including empty arrays and null ontology. Unknown stores refuse, rather than silently disappear. A newly added State store needs a reviewed codec/profile revision; the acceptance test compares the profile to every actual `initialState` key. Stores bind name, kind, count, UTF-8 byte size, SHA-256 and `{workspaceId,revision,captureId}`. Inventory additionally binds current members/policy, the whole State digest, root enumeration identity and every retained artifact/category count. The complete package has its own SHA-256.

`inspectWorkspaceInterchange` checks version, exact fields, full profile, every byte/count/digest, ordering, generation, duplicate/omitted entries and faithful readable views. It establishes structural consistency only. `validateWorkspaceInterchange(text, expectedInventory)` additionally compares the entire inventory against an independent root custody pin. A maliciously rewritten internally consistent package therefore fails the authoritative comparison. The inventory supplied in the wire is never its own provenance proof. Canonical input rejects duplicate JSON keys, alternate spellings, trailing data and truncation.

Definitions contain the complete current/history ontology as readable JSON. Recipes include all import records and retained recipe bodies. Legacy imports retain `recipeHash`/`contentHash` but not the bodies; complete interchange refuses those imports unless root supplies matching `mapping-recipes` and `source-originals` bodies. Recipe bodies must parse as version-one typed MappingRecipe data with unambiguous keys; binary/nonrecipe bodies refuse. A faithful pretty-printed recipe file retains its exact bytes while separately checking the legacy JSON.stringify semantic pin or connector canonical semantic pin. Original source content uses exact byte SHA-256. Missing bodies/pins must be reported, not reconstructed by downloading or acquiring new dependencies. Retaining hashes alone cannot satisfy this gate.

Readable recipe validation establishes inert data shape and semantic/byte identity. It does not publish a recipe against today's dictionary or scope; root must use the existing recipe/import gates before any later execution.

Artifacts have plain opaque IDs, category, media type, byte count, SHA-256, generation and an inert text representation. Exact UTF-8 uses `literal-utf8`; arbitrary binary uses canonical `base64`. Formula-like text, quoted delimiters, line breaks, Hindi, leading zeros, large IDs and negative exact numbers retain their literal content. The codec never opens a path, runs a formula, loads a plugin, renders HTML or dispatches an action. `retainedArtifactBytes` returns detached bytes for root custody. Native spreadsheet/open-save behavior is unqualified.

## Root capture and retained artifact custody

Root must hold its current-authority snapshot fence while reading State and enumerating retained bytes. It supplies a stable capture identity and attests **all nine categories**, including explicit zeros: `source-originals`, `mapping-recipes`, `dictionary-artifacts`, `report-files`, `plugin-assets`, `research-evidence`, `conversation-files`, `sync-evidence`, `other-retained`. Additional retained classes use `other-retained` in this reviewed version. Root is responsible for identifying every persisted external store, managed backup/export, original source and recipe, report/job artifact, historical authority snapshot, sync blob and writer identity/authority record, updater staging record and scoped companion evidence. The codec has no filesystem enumerator and cannot attest files it was not told about.

Root must record custody/disposition of ephemeral locks, temporary files, runtime installation bytes and externally held keys/credentials separately. They cannot be silently counted as absent or activated on import. Keys and credentials are custody dependencies, not executable imported authority. Source readiness must refuse incomplete/ambiguous root enumeration. Temporary in-memory analytics/search tables are not invented as permanent exported stores.

Root independently retains or authenticates the full `WorkspaceInventory` alongside the reviewed export receipt. Before invoking capture/export, authorize the current actor for complete workspace access and plaintext portability through the existing gates; the pure codec is not an RPC authorization boundary. This is an explicit plaintext open interchange format, separate from encrypted Vault backup/restore. Root still owns encryption, destination writing, managed discard, target identity and custody.

## Empty-target candidate and rechecks

`WorkspaceImportCandidateService` requires three trusted synchronous host ports:

```ts
const candidates = new WorkspaceImportCandidateService({
  source: ctx => ({ ready: true, inventory: independentlyRetainedCurrentInventory(ctx) }),
  target: (ctx, targetId) => inspectCurrentEmptyTargetUnderRootCustody(ctx, targetId),
  assertCompleteRead: (ctx, historicalState) => assertCurrentFullScopeAndReadiness(ctx, historicalState),
});
const candidate = candidates.prepare(ctx, { text: openWire, targetId });
const reviewed = candidates.review(ctx, {
  id: candidate.id, reviewedDigest: interchangeDigest(candidate),
});
```

The example functions are root join responsibilities, not supplied implementations. They must resolve current member/role/epoch, complete source and row scope, readiness, target ownership and storage authority. The full-read callback must finish synchronously and return undefined. Deferred Promise/thenable or boolean admission refuses. Existing `authorize(...,'admin')` also checks the actor against retained source membership. The current root callback must reject revoked source access even if the historical member was active.

The target inspection binds explicit target/workspace identity, immutable generation, current access digest, exact profile and readiness. **All 26 store counts must be zero**, including singleton stores and members. All nine retained-artifact counts, existing authority records and unexpected entries must also be zero. A pre-created initialized Vault is not empty under this contract. Root must inspect its uninitialized destination/slot and allocate a workspace identity different from the source. The caller supplies only a target ID; a caller-authored empty witness is never accepted by the service.

Preparation and exact-content review both re-read source and target, call complete-read admission and recheck both fences afterward. Changes in inventory, permissions, context, readiness, identity or generation refuse. The candidate is a detached immutable-by-digest historical archive with `inert:true` and `activation:'root-only'`. Caller changes cannot mutate the service's retained copy. The service has no StateStore, filesystem, scheduler or activation callback. It retains at most 64 candidates in memory; root owns managed disk custody and lifecycle. `discard` removes only the preparing context's in-memory candidate.

Review is not an activation transaction. Root must repeat checks under exclusive source/target custody through its actual durable commit, preserve historical evidence without rewriting IDs, and publish the receipt only after successful custody. Root must **not** attach the whole historical State to Engine: attachment automatically resumes/reconciles existing actions/jobs. Sessions, routes, plugins, approvals, leases and schedules remain inert evidence. Root alone decides a reviewed data/definition projection, fresh target membership/policy and explicit later authority activation. This lane exposes no new Engine/RPC method and does not change Vault.restore.

## Evidence and receipt equivalence

The focused acceptance runs the public ImportService preview, OntologyService/CalculatorService and an isolated fixture StateStore. It prepares/reviews an inert empty-target candidate, preserves every stored JSON field, original receipt IDs/timestamps, historical corrections/two-clock facts, tombstones, conversations and authority-bearing evidence, then recalculates three saved requests in a detached source-only sandbox.

The independent key is billed `100000+200000=300000`, received `60000+200000=260000`, earned `100000+150000=250000`, all INR minor units. Requests pin period, source and asOf. `compareRecalculatedReceipt` excludes **only** new receipt `id` and `createdAt`. Scope/member/epoch, asOf, definitions/compiler hashes, figures/amounts, row identities/contents, exclusions, coverage/import lineage, assumptions, allowed numbers, explanation, stale state and databaseProof must otherwise match. No verifier volatility is silently ignored. Imported historical receipts retain their identities and timestamps exactly; the fixture verifies receipt reads through the existing public guard.

The TAP diagnostic measures package/candidate/retained bytes and elapsed time, without hardware performance promises. Bounds are 64 MiB per wire/JSON, depth 64, one million JSON nodes and 4,096 artifacts. Target/source inventory reads and complete-read callbacks are injected source fixtures, not real filesystem/database/permission custody proof.

Run focused acceptance using existing Node 24 dependencies:

```text
node --test platform/tests/workspace-interchange.test.ts platform/tests/workspace-import-candidate.test.ts platform/tests/workspace-interchange-acceptance.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

## Remaining joined gates

Root still must join real artifact enumeration and encrypted custody, independently authenticated export pins, current permission/readiness APIs, actual exclusive empty-target storage inspection, managed archive persistence, reviewed activation and Engine/RPC journeys. Then run joined source acceptance over the actual export/import endpoints, including revoked access and target creation races. New State stores introduced by integration require a reviewed profile change.

Clean-machine/native portability, nightly execution, all supported OS/native applications, independently held keys/devices and business end-to-end sign-off are separate gates. The present factory bench runs repository tests; CI does not schedule a nightly check. Hidden/sealed datasets, live model/network calls, native GUI launches, real user vaults, external sends, spending, dependency acquisition and release were not used. Dedicated security review remains blocked/unverified; focused feature correctness checks do not replace it.
