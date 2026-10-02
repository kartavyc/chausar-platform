# Authoritative scoped phone sessions

`PhoneSessionService` is a Node host adapter for the committed phone-host contracts. It starts no listener and dispatches no model, notification, approval effect or arbitrary Engine method. The integration coordinator owns Engine/server mounting, supported Vault/PostgreSQL storage, source/row access, phone request custody and business-operation offers.

All invitation issuance/consumption, credential admission, one-use nonce consumption and revocation writes occur exclusively inside `StateStore.update`. Tagged records are `chausar-phone-invite-v1`, `chausar-phone-session-v1` and `chausar-phone-nonce-v1` in `State.sessions`. There is no production private-file fallback. This service retains nonce/invitation/session identities across its own revoke, expiry and replacement paths; configured capacity refuses new work with `OPEN_DESKTOP` instead of evicting a live identity. Existing `TrustService.revokeMember` removes session records belonging to its revoked target member. Revocation of a different issuing owner can leave the target's old records retained but without authority; an explicit new current-owner invite can replace that unusable grant without erasing its old record.

## Integration API

```ts
new PhoneSessionService(store, { clock?, maxInvites?, maxSessions?, maxNonces?, maxClockSkewMs? });
issueInvite(owner, { memberId, deviceId, keyId, channel, devicePublicKey,
  capabilities, inviteTtlMs, sessionTtlMs }): Promise<PhoneSessionInvite>;
pair(authentication, pairingPayload): Promise<SessionGrant>;
authenticate(authentication): Promise<PhoneHostPrincipal>;
assertPrincipal(principal, currentStateOrStore?, capability?): Context;
target(owner, sessionId, currentStateOrStore?): PhoneHostPrincipal;
list(owner): PhoneSessionMetadata[];
revoke(principal, exactDeviceId): Promise<void>;
revokeByOwner(owner, sessionId): Promise<void>;
```

Invitation/target/list/desktop revocation require the current untainted desktop owner. The owner explicitly chooses the target member/device/key/channel, complete capability list and both TTLs. Invitations allow 60 seconds–15 minutes; sessions allow 60 seconds–24 hours. The issuer's current branch scope must include the target member's branch scope at issuance, pairing and every current principal check, matching existing member-session issuance rules. A target resolver selects only sessions issued by that exact current owner/epoch and returns the actual target member's principal; it never treats the issuer as the target member. A downstream offer may impose a stricter same-member rule.

Phone principal roles map real `owner → owner`, `accountant → accountant`, and `cofounder/viewer → staff`. The returned Engine Context preserves the real role and permission epoch with channel `phone`. Only real owners can receive `approval.simple`; viewers can receive only `brief.read`. A phone capability is not a new source grant, model disclosure approval or authority to execute an action. Existing downstream source, row, action revision/catalogue and unused desktop-reviewed model-offer gates still apply.

`assertPrincipal` is a pure final-current-view checkpoint. It compares exact workspace, member/role/epoch, device, channel, session, capabilities, expiry, issuing-owner epoch and retained key identity. Session IDs content-pin every immutable issued field, including the key, capability list, expiry and credential hash plus a random identity salt; revocation metadata is excluded. This supports the existing PhoneHost principal shape without an unretained extra pin. `list` returns only binding/sessionId/channel/keyId/capabilities/expiresAt/revoked, with no invite, credential hash, nonce or public-key bytes.

## Concrete signed protocol v1

One algorithm is supported: **Ed25519**. Device public keys are canonical, unpadded base64url of the 44-byte DER SubjectPublicKeyInfo public key. Signatures are canonical unpadded base64url of 64 bytes. Nonces are canonical unpadded base64url of 32 random bytes. Key generation/private-key custody remain with an injected device signer/key-provider; no native protected-storage claim is made here.

The fixed route is HTTP **POST `/api/companion/rpc`**. The existing exact UTF-8 JSON body is `{protocolVersion:1,method,payload}`, bounded at 128 KiB. For ordinary methods the Authorization credential is the distinct returned opaque `phone_v1_...` value; existing desktop/member/CLI tokens are refused. Only a SHA-256 domain-separated hash is retained under `tokenHash`. An invitation uses a separately domain-separated `phone_invite_v1_...` value, also hashed at rest, and is consumed atomically once.

`phoneRequestSigningBytes` returns the UTF-8 JSON encoding of this ordered array, followed by one LF byte, followed by the **unaltered body bytes**:

```text
["chausar-phone-request-v1","POST","/api/companion/rpc",
 deviceId,keyId,timestamp,nonce,credentialHashOrNull,bodyByteLength]
```

`credentialHashOrNull` is SHA-256 hex of UTF-8 `chausar-phone-credential-v1\n` followed by the exact credential; absent pairing credentials use null. The timestamp is canonical UTC `Date.toISOString()` output. Default permitted skew is 30 seconds; configured skew must be an integer from zero to 120 seconds. No process or OS clock is changed. The existing frontend signer's `method` argument is the RPC method in this body, not the HTTP verb. Its injected implementation must use this documented transcript; header `signature` maps to host `proof`. The existing signer argument omits the credential, so the frontend-owned HTTP adapter must explicitly pass the same per-call optional credential used in Authorization to the injected signer (undefined for pairing). A mutable global or a different selected credential is not an acceptable replacement. This slice does not edit that frontend-owned port.

Pairing additionally requires a separate key-possession signature. `phonePairingSigningBytes` returns UTF-8 JSON for:

```text
["chausar-phone-pairing-v1",inviteCode,deviceId,channel,keyId,devicePublicKey]
```

This signature becomes the pairing payload's `proof`. The outer request signature then covers the complete body including that inner proof and all non-signature proof metadata. The invitation pins that exact public key/device/key ID and channel; possession of a different key cannot complete pairing. The header signature is not included in its own preimage. Pairing accepts no existing Authorization credential.

A business retry uses a fresh nonce and the same durable request ID. Re-signing a used nonce with a new timestamp does not revive it. Capacity, malformed proofs, wrong keys, stale timestamps, changed current authority, consumed invitations and expired grants refuse; they do not create successful-but-unknown authority.

## Evidence and limits

New focused cases use real Node-generated synthetic Ed25519 keys and signatures plus an explicitly labelled revision-bound reference StateStore. They cover fixed literal wire domains, separate pairing proof, one-use races/rollback, desktop-token refusal, modified bytes/metadata/route/key, persistent nonce reuse/capacity, expiry/algorithm/bounds, conservative roles, pure metadata/current checks, branch/epoch/key changes and explicit replacement after issuing-owner revocation.

At authoring handoff these cases are **not executed**. Node 24 syntax-only checks passed for the new runtime module and test file, and staged whitespace validation passed; these are not a TypeScript or end-to-end pass. The coordinator runs the focused cases serially against the joined tree. The new module/test/documentation paths are isolated; existing Engine, server, AuthService, portable contracts, old fixtures and package manifests are unchanged. The coordinator must filter tagged phone records from the generic `auth.sessions` listing and use business-specific permission/source/operation fingerprints: nonce writes advance global `State.revision`, which cannot serve as a stable business scope revision.

Real supported Vault/HTTP joins, TLS/relay, private-key lifecycle and protected mobile/browser key storage, Android/iOS SDK/build/device pairing, actual model inference, semantic connector readiness and production enterprise qualification remain separate checks. No D writes, downloads, account-token copying, native tooling, live provider or external dispatch is required by this slice.
