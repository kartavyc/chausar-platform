# Encrypted device handoff

`SyncService` is an experimental single-writer encrypted snapshot protocol with an injected transport. No Google Drive integration or live second-device certification is claimed. The default setting is off. Multi-writer mode is refused, and a receiver never replaces the currently open local authority.

The service creates the payload through `Vault.backup`; it never calls a plaintext export or reads/exports the vault data-encryption key. It validates the bounded encrypted envelope, records the exact ciphertext payload and digest in a preview, and requires an owner/cofounder approval bound to that digest and the configured transport. A device signs the metadata and ciphertext digest with its separate Ed25519 key. The signing key is not the vault encryption key. Public device identities must be approved out of band on the receiving device.

Each publish acquires a time-limited writer lease carrying member ID, membership epoch, device ID and an increasing fencing number. The transport must atomically verify the current lease token/fence/expiry and compare the previous head hash before storing the blob and moving the head. A stale writer cannot overwrite a newer writer, even if its delayed request arrives later. Approval and membership/source permissions are rechecked around publication. A copy already committed remotely cannot be recalled by a subsequent local revocation; a failed receipt preserves that uncertainty instead of claiming rollback.

Every signed record contains a previous hash, increasing revision and sequence, vault/workspace identity and fencing number. Pull verifies the entire predecessor chain, known device signatures and encrypted envelope digests, then rejects replay, truncation, cycles, changed identities and non-monotonic heads. The local authority cannot be rolled back to an older remote revision. The implementation caps verification at 1024 snapshots; log compaction requires a separately qualified protocol.

Pull decrypts through `Vault.restore` into a new empty directory. It returns a separate open `stagedVault` handle. The caller must explicitly switch authority after inspecting it, or close/delete that staged vault. Existing live directories and nonempty targets are refused. The verified local replay receipt stays in the current authority.

## Engine API

```ts
const sync = new SyncService(vault, {
  transport: dedicatedEncryptedStore,
  deviceId: 'laptop',
  enabled: true,
  signingKey: privateDeviceSigningKey,
});
const preview = await sync.preview(ownerContext);
const approval = await sync.approve(ownerContext, preview.id);
await sync.push(ownerContext, {
  previewId: preview.id, approvalId: approval.id,
});

receiver.trustDevice(ownerContext, {
  ...sync.identity(ownerContext), memberId: 'owner', epoch: currentEpoch,
});
const staged = await receiver.pull(ownerContext, {
  directory: absoluteEmptyDirectory,
  passphrase: suppliedPassphrase,
  expectedWorkspaceId: knownWorkspaceId,
});
// Inspect staged.stagedVault, then explicitly switch or close it.
```

`SyncTransport` provides `getHead`, atomic `acquireLease`, fenced/CAS `put` and hash-keyed `get`. It must return exactly the head it committed. File creation alone is insufficient: the adapter must implement atomic head comparison and lease fencing across devices, or publication must remain disabled. The implementation makes no automatic network retries. Ciphertext bytes are removed from local completed sync preview receipts to avoid recursively nesting encrypted backups; the digest and remote signed-record reference remain.

A Google Drive transport is an optional future adapter. Its configuration must identify dedicated user-picked files, use a narrow file scope, and provide a correct CAS lease/head protocol. A broad drive crawler or whole-account data permission is not a sync adapter. Google Drive adapters without explicitly picked file IDs and a narrow scope are rejected. This repository includes the protocol and a deterministic in-memory test adapter; it sends no Drive requests.

Device signing keys/trusted-peer configuration should be supplied by an engine secret broker and retained securely by the operator. Default generated signing keys and trusted-device entries are session-local. A restarted device must retain its private signing key outside workspace plaintext and restore its reviewed peer identities. No remote provider sees passphrases, recovery codes or raw encryption keys.

## Invitation and session broker

`AuthService` supplies an engine-side invitation/session broker. An authenticated administrator issues an invitation with a fixed role, branch grants and expiry. `accept` consumes that invite once and returns a new opaque session token; authority snapshots retain hashes only. Every `authenticate` checks the live session, current membership role and epoch. Member, session and invite revocation invalidate previously issued credentials. A revoked issuer's outstanding invitation cannot be redeemed. Returned session listings omit token hashes.

The broker is not an unauthenticated bootstrap endpoint. A server must authenticate its initial owner through the existing trusted engine session, then call `issueSession` or `invite`. HTTP clients must not be allowed to supply trusted role/epoch/context objects. Deliver raw invitation/session tokens only to the intended recipient and hold them in protected client memory. `AuthService` does not send email or messages and supplies no public identity-provider integration.

The loopback server accepts its same-origin local owner bootstrap token or a current member session bearer. Standalone startup prints an owner pairing URL with the token in a URL fragment; fragments are not sent in HTTP requests. The renderer transfers that value to client memory and removes it from browser history. `/api/session` only validates an already-supplied exact owner bearer; anonymous and member callers cannot discover the owner token. Binding, remote-address and exact Origin/Host checks restrict the server to its trusted loopback owner instance. The printed link is an owner credential: the trusted local operating-system user can use it, and it must not be handed to members. This does not provide an identity boundary against an attacker who already controls the owner's terminal or device.

`auth.invite`, `auth.accept`, `auth.session`, `auth.revoke` and `auth.sessions` are named engine requests; invitation acceptance additionally requires the trusted local bootstrap over HTTP. Only owners can mint another member's session, with target branches contained inside the issuing owner's current grants. Self-session rotation keeps the existing member role and grants. Invitations and direct member creation cannot grant a stronger role or wider branches than the issuing administrator; pending invitations recheck those ceilings when redeemed. A member bearer never accepts a caller-supplied context or role. `AsyncLocalStorage` binds each HTTP call to its authenticated member while preserving the direct `Engine.context` interface used by local tests. Concurrent requests cannot change another request's member identity. Session authentication and engine operations check current membership epochs; member revocation denies already-issued sessions and withheld calculations recheck access after awaiting external work.

The engine exposes `sync.status`, `sync.identity`, `sync.enable`, `sync.trust`, `sync.preview`, `sync.approve`, `sync.push` and `sync.pull` to workspace administrators. Pass an explicitly reviewed adapter through `EngineOptions.sync`; the ordinary application starts with no sync transport and remains fail closed even when enablement is toggled. HTTP `sync.pull` accepts a bounded managed folder name and returns staged-directory metadata, without returning a live vault object or replacing the open workspace. Engine close closes staged vaults and clears transient model/speech credentials. The transport, key identity and trust registry are still experimental operator configuration.

## Tests

`node --test platform/tests/sync.test.ts platform/tests/auth.test.ts` uses real encrypted test vaults and an injected fenced transport. It checks encrypted payload opacity, approvals, competing writers, stale-head CAS, superseded fences, source revocation, signed staged restore, replay refusal, truncated/corrupt chains, one-use invitations, scoped seats and token revocation. These are application/protocol tests, not a claim that a commercial file service or a real second machine has passed certification.

`platform/tests/server-auth.test.ts` exercises the real loopback HTTP server with overlapping scoped sessions, branch filtering, token/session revocation, an in-flight member epoch change, metadata redaction, administrator-only sync and missing-transport refusal.
