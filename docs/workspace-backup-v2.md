# Managed archive backup v2

`platform/runtime/workspace-backup-v2.ts` supplies a pure ciphertext archive codec and constructor-only host orchestration. It has no filesystem enumeration, path selection, raw-key port, writable `StateStore`, Engine attachment, provider, scheduler, plugin execution, or authority activation capability.

This profile covers **the encrypted authority envelope and every encrypted artifact in both reviewed private purposes**. It deliberately reports `scope: authority-and-all-typed-private-artifacts` and `fullWorkspacePortable: false`. Its wider namespace dispositions and external custody requirements describe the additional work needed for a broader workspace recovery claim. A byte/count budget failure rejects the whole capture; the codec never truncates a namespace or chooses a product scope limit.

## Exact encrypted content

The root supplies `WorkspaceBackupV2Capture` under its actual source fence:

- `source`: vault identity, workspace identity, authority revision, capture identity, and independent enumeration identity.
- `authority`: the exact authenticated UTF-8 envelope bytes issued by the source storage adapter.
- `artifacts`: every actual `private-trial` and `workspace-interchange` artifact, each with its authenticated `PrivateArtifactRef` and original encrypted file bytes.
- `namespaces`: measured dispositions for every wider namespace inspected by root, plus explicit included entries for `authority`, `private-artifacts/private-trial`, and `private-artifacts/workspace-interchange`. Both private namespaces are required even when empty.
- `externalKeyRequirements`: an explicit list, including an empty list when there are no external requirements. Entries describe keychain or adapter recovery dependencies; they must never contain credentials or key material.

There is no status, filename suffix, or payload-kind filter within a reviewed private purpose. The archive therefore retains private fork/evaluation/issued-binding records, discarded/promoting/promoted bindings, interchange archive/pin/commit records, discard tombstones, and target reservations. Their encrypted payloads stay untouched. Root authenticates the entire namespace and validates any required semantic relationships before issuing a capture.

Authority and artifact bytes are encoded as canonical base64 inside deterministic outer JSON. Outer JSON may be sorted; embedded envelope JSON is never reconstructed, normalized, or sorted. The v1 snapshot AAD serializes the nested passphrase/recovery wrappers in their original order. Sorting their keys can make an otherwise unchanged snapshot impossible to decrypt. Envelope whitespace is preserved too.

For experimental file storage, root can preserve the exact regular-file bytes. PostgreSQL JSONB does not expose original physical JSON bytes: its adapter reconstructs the v1 wrapper order and issues an authenticatable envelope representation. Root must qualify that distinction in the source namespace/adapter requirements; preserving adapter-issued bytes does not claim preservation of PostgreSQL physical storage.

## Strict manifest and independent pin

The wire format is `chausar.backup.v2`. Its `chausar.backup-source-pin.v2` contains every encrypted entry's byte count and SHA-256, every artifact's identity/purpose/value digest, all source identities, and all namespace and external custody dispositions. Entries have unique sorted identities, including refusal of filesystem case aliases. The archive has a separate digest over the full manifest and encrypted bodies.

`captureWorkspaceBackupV2(capture, budgets)` constructs the archive. `encodeWorkspaceBackupV2`, `inspectWorkspaceBackupV2`, and `workspaceBackupV2Bytes` encode, inspect, and recover exact encrypted bytes. `validateWorkspaceBackupV2(text, independentlyAuthenticatedPin, budgets)` additionally compares the entire independently issued source pin. Structural/hash inspection alone neither authenticates ciphertext nor proves completeness. A self-consistent attacker archive with recomputed hashes is refused when compared with the independent pin.

The codec refuses unknown/missing fields, duplicate JSON keys, duplicate/missing/extra artifact entries, unsafe identities and namespaces, invalid UTF-8, noncanonical base64, malformed wrapper/ciphertext shapes, unknown purposes, wrong authority/artifact vault or revision bindings, changed digests/counts, and truncated archives. Every operation receives explicit trusted budgets for wire bytes, individual encrypted bytes, aggregate encrypted bytes, entry counts, JSON depth, and JSON nodes.

The pure package cannot discover an omitted physical file or decrypt the workspace identity inside the authority ciphertext. Root's independent enumeration and cryptographic authentication are essential. Root must inspect unknown actual namespaces and either refuse them or record an explicit wider custody requirement. Do not fabricate a complete capture by copying a caller-declared manifest.

## Root host ports

Use `createWorkspaceBackupV2Host(ports, budgets)` once in trusted root construction. Public method inputs are exact managed IDs/digests:

```ts
await host.create(context, { destinationId, confirmed: true });
await host.read(context, { backupId });
await host.restoreInert(context, { backupId, targetId, reviewedDigest });
await host.readRestored(context, { backupId, targetId, creationId, reviewedDigest });
```

No public method accepts a path, constructor capability, callback, storage adapter, credential, or filesystem port. Root selects and authenticates the managed locations and credential flow.

`withSource` must execute its callback exactly once while holding source authority/artifact custody through callback completion and lease exit. Its source lease supplies current State and independently enumerated encrypted bytes. `assertCompleteOwner` checks current unrestricted owner access to every relevant current/historical row, source, and private view. `assertCurrent` rechecks the actual source revision, bytes, physical identities, enumeration, readiness, and access. `authenticateCapture` authenticates the authority workspace/revision and every purpose/identity/value-bound artifact without exporting the data key.

`custody.create(context, record, assertCurrent)` atomically retains the complete archive and a separately encrypted/authenticated custody pin without overwrite. It must invoke `assertCurrent` immediately before publication. The pin binds record/creation identity, caller context, complete source pin, and archive digest. `custody.read` authenticates both retained ciphertexts and their durable record binding. `custody.remove` compares exact creation/archive/pin digests and removes only that owned creation. If create rejects, the port must already have removed its staging and partial output, including a publication followed by lost acknowledgement. A rejection is never permission to adopt a partial record.

Restore first reopens authenticated archive/pin custody, compares the reviewed digest, calls root's current `assertRestoreOwner`, and cryptographically authenticates every original envelope through `authenticateArchive`. It does not require a surviving live source Vault, but it rechecks the retained archive issuance and current root owner during each restore fence.

`read(context, { backupId })` returns `WorkspaceBackupV2Readback`: `{ summary, creationId, sourcePin }`. The creation identity is the durable **backup custody** creation, and `sourcePin` is the complete independently authenticated pin. The host validates exact payload shape, requires the untainted desktop owner, verifies committed independent archive/pin custody and measured ciphertext sizes, checks current root owner/source access and readiness through `assertRestoreOwner`, and authenticates the entire original authority and all archived private artifacts. It rereads the exact issuance and measurements before and after archive authentication and checks owner access before and after awaited custody reads.

`readRestored(context, { backupId, targetId, creationId, reviewedDigest })` returns `WorkspaceBackupV2RestoredReadback`: `{ receipt, summary, sourcePin }`. Its input creation identity is the durable **inert restore** creation from `restoreInert`, and its reviewed digest must match the exact source archive. After authenticated source readback, the host reads the restored target twice, compares its exact original archive string, full independent source pin, and complete target/creation/entry/byte/inert receipt, and rechecks current source issuance and owner after each target read. Neither output contains archive bodies, authority plaintext, credentials, data keys, or filesystem paths. Reads are reversible and never delete failed or changed custody.

Public readback has no transient candidate cache and can run through a newly constructed host after process restart when root's durable committed ports and current ownership/access remain valid. Root's `restore.readRestored` must reopen its durable binding under exclusion and authenticate the target/reservation physical identity, current owner/readiness, exact complete original ciphertext, and still-inert/unadmitted state on every call. A receipt alone cannot certify a replaced target. Readback is evidence for review; a later admission must hold its own actual target and authority fence. Changed source, epoch, archive/pin/ciphertext, measurement, reservation, target, or binding must refuse.

`withTarget` executes its callback exactly once under an exclusive physical target lease and a current root owner/epoch admission fence held through actual publication. The host rechecks current owner both before and after awaiting retained custody reads, but asynchronous checks alone cannot replace that held root admission fence. The target must be a distinct root-managed empty location, with zero authority records, zero private artifact records, and no unexpected wider entries. `assertEmpty` re-enumerates actual emptiness; `assertCurrent` retains exclusive target identity and ownership after publication. Root must reject symbolic/hard links, a replaced directory, changed reservations, and a target that becomes nonempty.

`restoreAtomic` stages and authenticates every original encrypted byte, reads back the complete staged set, then invokes the supplied `assertEmptyCurrent` immediately before its one atomic no-overwrite publication. It returns the exact complete receipt. The published result must remain an **inert complete archive** outside live authority storage and Engine attachment. The host reads that archive and receipt back, checks every pinned body, and retains custody/target fences through lease exit. A rejected restore must leave no partial target. `rollback` compares exact target/creation/archive identity before removing a failed owned publication.

Host failures after acknowledged create or restore—including readback, guards, duplicate callback, or final lease exit failures—trigger exact owned cleanup. Cleanup can occur after the outer source/target lease releases: `remove` and `rollback` must reacquire exclusion, compare exact creation/digest ownership, and verify the target remains inert and has not been admitted before deleting it. Unresolved cleanup produces `BACKUP_CLEANUP_REQUIRED` or `BACKUP_RESTORE_CLEANUP_REQUIRED`; root must inspect the retained inert evidence and must not activate, overwrite, or adopt it.

## Namespace and authority semantics

Root's wider inventory must explicitly account for the source root and both private purposes, workspace `reports`, `plugin-assets`, `research-evidence`, `conversation-files`, and `sync-evidence`, application `backups`/`exports`, `.workspace-interchange-control` records/target locks, writer reservations, adapter state, external keychain custody, and any newly discovered managed namespaces. Actual nonempty wider payload namespaces are `outside-archive` with a concrete recovery requirement. Empty namespaces are explicit. Process locks are `transient` with a requirement to reacquire them. Unknown namespaces cannot be silently excluded or reported as included. A private purpose other than the two reviewed purposes requires a new codec/profile and is refused here.

The original encrypted authority is evidence of historical State. The host cannot open it as active authority, return a writable Vault, replay archived authorization, or enable archived jobs, schedules, actions, routes, plugins, or sessions. Any later root activation must use a separate explicit approval and fresh authority/admission semantics. An `inert` label on a normally runnable Vault would not satisfy this boundary. Recovery credential rewrapping, new target keychain registration, and fresh authority activation belong to that separate root workflow.

## Focused verification

`platform/tests/workspace-backup-v2.test.ts` uses only synthetic temporary sources and empty targets. It proves exact envelope/artifact byte roundtrip and actual v1 passphrase/recovery authentication, demonstrates failure after sorting nested wrappers, retains control/terminal private records, exercises independent-pin refusal after coherent attacker rehash, enforces explicit budgets, and checks source/target/publication/readback/lease-exit cleanup. Public readback tests reconstruct hosts against retained fixture ports, verify detached metadata, and refuse malformed or changed source/target/binding/measurement/epoch data. Host transaction and reconstructed-host tests use the declared `test-fixture` custody qualification; they do not qualify actual process restart, installed filesystem transactions or native PostgreSQL custody.

```powershell
node --test platform/tests/workspace-backup-v2.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --verbatimModuleSyntax platform/runtime/workspace-backup-v2.ts platform/tests/workspace-backup-v2.test.ts
```

Root still owns Vault authentication/export joins, physical independent enumeration, actual encrypted custody transactions, inert target publication, and the separate fresh-authority activation workflow. No installed storage, model/provider, GUI, external download, or existing user-vault mutation is exercised by these checks.
