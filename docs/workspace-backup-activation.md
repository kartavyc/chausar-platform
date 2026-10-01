# Authenticated archive-to-activation evidence bridge

`platform/runtime/workspace-backup-activation.ts` implements a constructor-only bridge from an independently issued v2 encrypted archive, its actual inert restore, and an independently issued semantic export to an inert candidate accepted by the existing activation evidence format. It creates and inspects candidate custody; it does not activate authority, initialize a Vault, attach an Engine, or add HTTP/IPC/renderer routes.

Only exact source workspace IDs listed in `WorkspaceBackupActivationPolicy.approvedSyntheticWorkspaceIds` are admitted. Root must independently establish their synthetic provenance and actual custody. A demo flag, source label, caller-authored hash, or matching revision cannot grant admission. The current untainted desktop owner must have unrestricted ownership and current access to every historical source and row. The root lease must continuously check current owner/epoch and all configured consumer readiness.

## Inputs and working behavior

Construct `new WorkspaceBackupActivationHost(ports, policy)` once in trusted root construction. Constructor ports are capabilities, never public request fields. The policy supplies all six v2 operation budgets and positive `maxMaterialUtf8Bytes` and `maxCandidateUtf8Bytes`; both latter limits are at most the existing interchange codec's 64 MiB ceiling. Existing interchange artifact/count/depth/node limits also apply. Exceeding a limit refuses the whole operation without dropping history or namespaces.

The public inputs contain only managed identities, an acknowledged digest and confirmation:

```ts
const review = await bridge.prepare(context, {
  backupId, materialId, inertTargetId, inertCreationId,
  candidateId, targetId, reviewedArchiveDigest, confirmed: true,
});

const inspected = await bridge.inspect(context, { candidateId });
// inspected.review is the candidate summary.
// inspected.evidence has the existing WorkspaceActivationEvidence shape.
```

`backupId`, `materialId` and `candidateId` must be distinct record IDs. `targetId` must differ from `inertTargetId`. The inert restore already contains `backup.inert.json`; it cannot truthfully satisfy the separate activation target's empty inspection. Root must reserve a distinct uninitialized physical target and a distinct workspace identity. Existing or unrelated empty directories cannot be adopted.

Preparation obtains one held root transaction and reopens:

- The complete v2 archive and separate authenticated backup pin, including record creation, exact issuing context and every source identity.
- The actual inert restore and its authenticated reservation, exact restore creation, physical location/generation and measured container binding. Its content must equal the original archive text exactly; its receipt must account for every encrypted entry and byte.
- A separate committed interchange **export**, including its independent inventory pin and creation context. A candidate, self-consistent wire package or hash-only declaration cannot substitute for this export.

Root authenticates every original authority/artifact envelope without exporting keys. The authenticated historical State must have the exact v2 source workspace and revision. Each retained export store text must equal `JSON.stringify` of that historical store. The comparison preserves every nested object key order and array order while allowing the interchange codec's alphabetical top-level store reconstruction. Existing dictionary/compiler and retained recipe hashes remain meaningful.

The semantic export supplies all retained source originals, mapping recipes and other reviewed artifact categories. Its full export archive, independent pin and committed binding must each be present as distinct `workspace-interchange` artifacts in the original v2 encrypted capture. Root's `authenticateMaterial` port must authenticate those exact archived envelope bytes and their values against the independently reopened export. Matching State, workspace, revision, value digest or caller-provided refs alone is insufficient: wider files can change without a State revision.

The supported root order is authenticated semantic export, complete v2 capture/issuance, inert restore, distinct empty activation-target reservation, then bridge preparation. An existing v2 archive without those three semantic export envelopes refuses this profile. Issuing another export later at the same revision cannot repair that original archive's provenance; preserve it and separately issue a new complete capture when authorized.

The bridge rebinds semantic retained-artifact generation metadata to the independently pinned v2 generation and retains every artifact's original body bytes. It adds one reserved `other-retained` JSON artifact, `backup_activation_provenance_v1`, containing:

- The exact complete original v2 archive text and independent backup custody pin.
- The complete semantic export text and its independent export custody pin.
- The inert content, complete receipt and independently measured reservation/container inspection.
- The authenticated archived export/archive-pin/binding refs and truthful source custody qualification.

A source artifact using that reserved identity refuses preparation. No original archive, body, pin, reservation or evidence is overwritten or removed. All complete encrypted history remains inert inside the candidate, including administrative/private control records excluded from any later business projection. The new provenance is an artifact inside the unchanged candidate archive; no fields are added to the strict existing `WorkspaceActivationEvidence` shape.

The candidate records the source inventory, issuing context, reserved empty target proof and distinct random `bridge_...` creation identity. Root publishes the complete candidate and independent candidate pin under durable no-overwrite custody, calls the supplied fence immediately before actual publication, and returns measured encrypted readback. The bridge checks exact content, pin and measurement equality and rechecks every original issuance and fence through lease exit.

All `connector-*` import history refuses this bridge, including records claiming a legacy format. The bridge does not remove connector markers, reinterpret quarantine or stale evidence, or manufacture current acquisition profiles. Existing activation projection and current consumer guards remain required.

## Exact trusted root ports

| Port | Required behavior |
| --- | --- |
| `ports.withTransaction(context, selection, work)` | Hold current source writer/inventory/admission exclusion, exact backup and export record custody, inert reservation/container exclusion, candidate record exclusion and separate empty activation-target custody through callback completion and lease exit. Execute `work` exactly once. `mode: 'inspect'` must not publish. Follow the repository's consistent authority-before-record/target lock ordering. |
| `lease.currentState` | Supply the actual current source authority, not historical State presented as current. Its workspace must equal the v2 source workspace. |
| `lease.target` | Independently inspect the exact reserved activation target, current permissions, immutable physical generation, all reviewed zero store/category counts, zero authority and no unexpected entries. It must remain uninitialized for bridge preparation and inspection. |
| `lease.readBackup()` | Authenticate committed archive ciphertext, separate source pin and durable creation binding. Return exact content/pin and actual positive encrypted measurements. Refuse revoked, replaced, orphaned, pending or unrelated issuance. |
| `lease.readMaterial()` | Authenticate the committed semantic export, separate independently issued inventory pin and exact creation/context binding, with actual encrypted measurements. |
| `lease.readInert()` | Authenticate the restored reservation and exact restore creation; remeasure the actual sole inert container and its physical custody under exclusion. Return content/receipt plus the reservation's location/generation/current context and actual container hash/byte count. Decoded fields alone do not establish physical provenance. |
| `lease.authenticateArchive(capture)` | Authenticate historical authority and every purpose/identity/value-bound original encrypted artifact. Return historical State without mounting it or exporting a data key. The existing Vault encrypted-custody authentication method supplies the cryptographic operation. |
| `lease.authenticateMaterial(capture, material)` | Locate and authenticate the exact export archive, independent pin and committed binding envelopes inside the supplied original capture. Verify all values and committed ciphertext-ref relationships against the independently reopened export. Return their three exact archived `PrivateArtifactRef`s. Do not fabricate inclusion from same-State/revision hashes. |
| `lease.assertCompleteOwner(context, historicalState)` | Check actual unrestricted current ownership, epoch, every retained historical source/row/private view, complete source custody and all configured current acquisition/consumer readiness. Complete asynchronously and return `undefined`. |
| `lease.assertCurrent()` | Recheck actual current authority/access/readiness plus exact backup/export issuance, restored reservation/physical container and reserved empty activation target under held exclusion. Complete and return `undefined`. |
| `lease.createCandidate(record, guard)` | Enforce durable single-use no-overwrite record/creation admission, encrypt and bind complete content plus independent pin, and invoke/await `guard` immediately before actual publication. Keep all exclusions held. Resolve exact completed writes by authenticated readback; never treat a rejected acknowledgement as proof that publication failed. Return truthful measured encrypted custody. |
| `lease.readCandidate()` | Authenticate the exact complete candidate, independent pin and durable committed creation binding under the held candidate lock. |
| `ports.custody.read(context, candidateId)` | Reopen the same authenticated candidate after restart with actual current complete-owner admission. Never adopt caller hashes, an orphan file or an unrelated creation. |

Every guard must complete and return `undefined`; boolean or deferred admission values refuse. Pure structural/hash validation does not replace these trusted root duties. The host supplies no filesystem adapter or memory ledger that can stand in for durable publication and restart custody.

`Vault.authenticateEncryptedCustody` authenticates archived artifact envelopes but returns only historical State. It does not return the decrypted export/pin/commit values needed by `lease.authenticateMaterial`. When the exact archived ciphertext files still exist unchanged, root can independently authenticate current `readArtifact` values while proving their entire file bytes equal the captured envelopes under exclusion. For a detached archive whose original files are unavailable, the missing shared Vault port is a bounded constructor-only operation that authenticates specified archived `PrivateArtifactRef`/byte pairs and returns their values without exporting keys or mounting historical authority. No read of an unrelated current artifact or copied hash can replace that port.

## Publication failure and explicit restart inspection

Once `createCandidate` is entered, any failure through readback or lease exit produces `BACKUP_ACTIVATION_COMMIT_UNKNOWN`. The bridge does not delete a possibly committed candidate, publish again, overwrite it, or allocate a replacement identity automatically. Preserve the exact `candidateId` and use `inspect`.

Inspection first reopens authenticated candidate/pin custody, extracts its retained selection, then obtains a fresh held transaction. It reauthenticates the independent backup, semantic export, inert reservation and every original envelope; rebuilds the entire candidate; and compares its exact provenance, content, inventory, target and held candidate readback. It only returns the summary and existing evidence shape. If root cannot establish an exact committed creation, its custody port must refuse with the precise remaining status/custody blocker; this API does not invent a failed/unknown status or republish.

Inspection requires the activation target to remain empty. After a later activation initializes that target, use the separate activation host's explicit `resolve` and phase-aware storage recovery contract. Bridge inspection does not attach or inspect a live Engine.

## Activation integration and limits

The candidate and `inspected.evidence` use the existing `WorkspaceImportCandidate` and `WorkspaceActivationEvidence` formats. The bridge review digest is a candidate acknowledgement; it is not an activation projection acknowledgement. The existing activation host must separately review the candidate under its policy and issue the projection digest before explicit activation.

The unchanged activation host captures its transaction source lease's State/artifacts and requires that inventory to equal the candidate's independently retained inventory. The bridge inventory instead describes the archived v2 generation, semantic export bodies and added provenance artifact. An ordinary current interchange source capture will therefore differ, even when business State is unchanged. Business revisions, owner epochs, source access and readiness may also have changed since archive capture. Root needs a reviewed archived-source/current-authority join that authenticates the exact derived inventory while retaining actual current admission and source custody. Passing historical State or a fabricated provider lease as current authority does not satisfy this seam.

Do not call the existing backup local `withSource` with the old v2 source pin and assume it represents current source custody: successful backup/restore has introduced archive/pin/binding and target reservation controls since that historical enumeration. Root must hold a fresh current physical fence and separately validate the historical issued pin. The bridge does not modify existing codecs, Vault, Engine, activation host or authority admission to hide these differences.

Summaries retain the original namespace dispositions and external key requirements unchanged, with `scope: 'authority-and-all-typed-private-artifacts'` and `fullWorkspacePortable: false`. Including an independently retained semantic export does not silently promote v2 outside-archive namespaces to included or qualify unknown/external custody. Positive measurements cover candidate archive/pin ciphertext; root must separately account for journal/binding overhead. If either original source custody is `test-fixture`, provenance and candidate custody must remain `test-fixture`; encrypted fixture storage does not qualify installed application storage.

The final focused run passed **43/43** cases, with zero failures, cancellations, skips or todo cases, in 234.497 seconds. It uses actual synthetic C-drive experimental-file Vaults, independently encrypted semantic export/v2 issuance, actual inert restore reservations, encrypted candidate records and physical process locks. A fresh Node process reopens the same synthetic Vault after a deliberately lost candidate acknowledgement, inspects identical retained evidence and refuses replay without publishing. Constructor admission/candidate transaction ports remain explicitly `test-fixture`; this does not establish usable activation, installed/native storage or live provider readiness.

Other focused cases prove exact original ciphertext retention, all terminal private-control entries, archived export/pin/commit inclusion, unchanged namespace dispositions, current owner/epoch/source/readiness refusal, nested semantic key-order refusal, absent same-revision export provenance, same-value/same-size re-encryption refusal, actual copied-container/empty-directory replacement refusal, physical target contamination, publication-guard revocation, mandatory guards, managed connector refusal and complete byte-budget refusal. Strict application/semantic TypeScript and Node source syntax checks pass. The unchanged v2 codec, import-candidate and activation compatibility suites pass **170/170** cases, recorded separately rather than counting exploratory repetitions.

Focused verification belongs to `platform/tests/workspace-backup-activation.test.ts`. The bounded invocation is:

```powershell
node --test --test-concurrency=1 --test-reporter=tap platform/tests/workspace-backup-activation.test.ts
```

This source lane does not qualify actual fresh-authority bootstrap, atomic activation filesystem publication, usable Engine attachment, three fresh public HTTP/Vault receipt comparisons, aggregate acceptance, native databases/installers/GUI, external namespaces, live connectors/models/providers, enterprise custody or real migration. It makes no user-vault read/migration, D-drive write, dependency acquisition, credential, paid service or external-send claim. The separately blocked dedicated security audit remains unverified.
