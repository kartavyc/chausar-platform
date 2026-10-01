# Encrypted archive controls

The **Encrypted archive** button in **Your workspace** opens owner-operated archive v2 controls. Existing **Back up vault**, **Export encrypted workspace**, and setup **Restore backup** controls remain available and retain their v1 behavior.

Creating an archive requires a chosen managed archive ID and an initially unchecked confirmation. No file paths, callbacks, budget settings, passphrase, recovery code or external credentials enter any archive request from this screen. The engine remains responsible for current owner/access, complete source readiness, profile support and actual physical custody admission.

An acknowledged creation is followed by authenticated, read-only archive lookup. The review shows the exact archive ID, source evidence, scope, read-only digest, entry counts and measurements. Namespaces marked outside the archive appear with their separate requirements, along with external access/key requirements. An archive contains encrypted authority and typed private artifacts; it does not claim complete workspace portability. Recovery credentials stay outside this screen.

Copy creation requires an unused managed copy ID and a separate, initially unchecked confirmation. Its digest comes from the retained authenticated review, not an editable field. Changing the archive reference discards the prior review and consent. Before requesting a copy, the renderer re-reads the archive and compares its issuance, source pin and summary with that review. Root admission still applies at publication. A returned copy receipt is accepted only when its IDs, digest, source pin, counts and inert flags match that review; final readback also has to match. The copy remains closed and inert. This screen has no activation or workspace-open control for it.

Each create/copy action is attempted at most once for its selected operation within the dialog, including concurrent submits and errors. An ambiguous result never triggers automatic retry, discovery or activation. The UI distinguishes an acknowledged creation with incomplete readback from an unverified creation and keeps the entered IDs for explicit readback. For an unknown whole-copy response, it retains the original reviewed digest and chosen references. **Inspect existing closed copy** uses those retained references; after a restart, entering the archive/copy IDs performs a fresh authenticated archive read before inspecting the existing reservation. **Read exact copy receipt** additionally requires its exact creation ID. Both actions only read existing custody; neither creates or adopts a copy. Closing the dialog discards its metadata. Reopening starts with blank IDs and consent.

Workspace navigation, lock/setup, evidence changes and authority/source/custody refusals clear retained archive metadata. Pending replies cannot repaint a revoked/closed dialog or a changed archive selection. Typed refusals remain visible. Source and connector readiness failures do not fall back to v1 or manufacture successful receipts.

## Exact IPC payloads

| Method | Payload | Use |
| --- | --- | --- |
| `workspace.backup.v2.create` | `{ destinationId, confirmed: true }` | Explicit archive creation |
| `workspace.backup.v2.read` | `{ backupId }` | Authenticated archive review/readback |
| `workspace.backup.v2.restoreInert` | `{ backupId, targetId, reviewedDigest, confirmed: true }` | Explicit closed-copy creation |
| `workspace.backup.v2.readRestored` | `{ backupId, targetId, creationId, reviewedDigest }` | Exact known-creation receipt readback |
| `workspace.backup.v2.inspectRestored` | `{ backupId, targetId, reviewedDigest }` | Existing-copy reservation discovery after restart/lost response |
| `workspace.backup.v2.diagnostics` | `{}` | Explicit installed-profile diagnostics |

## Qualification boundary

`platform/tests/workspace-backup-renderer.test.ts` executes the actual renderer, actual preload and strict structured-clone IPC registry using **authored synthetic RPC fixtures**. It covers explicit confirmations, strict payloads, limited portability disclosure, lost responses, exact receipt/pin binding, ID validation, revoked evidence and stale replies. It does not start Engine/Vault, create real archives, qualify a source/custody profile, launch an Electron GUI or prove portability. Root owns separate actual public HTTP/Vault acceptance. This renderer slice alone is not a full product or release qualification.

Bounded renderer check:

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 platform/tests/workspace-backup-renderer.test.ts
```

Scoped strict TypeScript check (the new test and its harness/IPC type imports):

```powershell
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --verbatimModuleSyntax --skipLibCheck --esModuleInterop platform/tests/workspace-backup-renderer.test.ts
```
