# Phone client request restoration seam

Reviewed against lane 2 of `post-activation-implementation-lanes.md` and pinned
base `1dc19b856380951aea49b7143ed4b5617130c06b`. The lane coordinator approved
this exact optional client port before implementation. This change owns only
`platform/runtime/phone/client.ts`, the focused restoration tests, and this note;
the portable shared protocol and companion UI are unchanged.

The recovered `CHAUSAR-FINAL-IN-DEPTH-PLAN.md` sections 23.9, 23.12, 23.27,
23.30, 23.33–35 and 23.38–39 were also read directly. `requestId` is a transport
lookup reference; the authoritative host preserves the bound normalized
request, business-operation identity, data/definition cut, exact reviewed
revision and durable admission. Client identity discovery never grants a new
business intent or starts a replacement operation. A host result must say what
its evidence proves: pending/unknown is not applied success; upload success
remains outside data awaiting confirmation; effective cancellation needs the
host's applied acknowledgment rather than a transport acknowledgment. Native
provider finality and enterprise Temporal replay/admission remain separate
qualified profiles.

```ts
export type PhoneRequestIdentity = {
  requestId: string;
  kind: 'chat' | 'upload' | 'approval';
  target?: string;
};
export interface PhoneRequestRestoration {
  list(
    authority: SessionAuthority,
    credential: string,
    signal: AbortSignal,
  ): Promise<readonly PhoneRequestIdentity[]>;
}
```

`PhoneClient` accepts `requestRestoration?: PhoneRequestRestoration` in its
constructor. The host's new `request.list` port can import this type or satisfy
it structurally. The adapter must authenticate the credential independently
and restrict every descriptor to the validated session ID and full
workspace/member/device/epoch binding. Caller-supplied authority is context,
not proof. Do not return descriptors from another session or binding, even
when request IDs happen to match.

The result is a bounded array of at most 100 unique IDs. Every ID and optional
target must pass the existing portable ID validator; `approval` requires the
approval ID in `target`. The client accepts only `requestId`, `kind`, and
`target` keys and rejects the whole list before import if the list is malformed,
duplicates an ID, conflicts with a retained kind/target, or would exceed 100
retained requests. Bodies, question text, upload bytes, approval challenges,
credentials, and tokens are never restoration state.

`restore()` reads the saved session grant and exposes `validation-required`
state; it performs no network call or request discovery. Loading a replacement
credential/session/binding invalidates outstanding IO, and a changed session
or binding clears old request identities. `reconnect()` invalidates old IO,
freshly validates the grant, lists identities under a tracked abort signal,
and checks that generation, credential, session, and binding still match before
import, including that authority did not expire while discovery was pending.
New identities become `unknown`, with current generation and fresh
local response revision, then obtain results using `request.status` IDs only.
The client marks host-listed identities as remotely started so cancellation
must obtain a host acknowledgment. It never sends a recovered question,
upload body/chunk, or approval decision again.

Existing terminal results remain retained within the same validated identity;
this avoids a terminal result regressing when a client reconnects. These are
retained snapshots, not evidence of current source/revision readmission.
`refreshRequest()` also returns already-terminal state locally. The host must
enforce its authorization and readmission policy on discovery/status/receipt
reads. Source deletion, changed revision and scope-refusal acceptance must
exercise a reopened client's actual host readback. A host adapter that merely
filters a stale terminal ID from the list cannot make a same-instance retained
snapshot current. A changed session/epoch cannot retain those snapshots.

Revocation/expiry failures from discovery use the same fixed public codes and
credential/cache clearing behavior as ordinary transport requests. Unknown
adapter failures disconnect with `TRANSPORT_UNKNOWN`; raw adapter text is not
returned. Disconnect, forget, revoke and a newer reconnect abort discovery and
reject late lists/results. Poll and cancellation generation checks prevent a
continuation from crossing into a later connection. Per-request revisions
preserve acknowledged cancellation and newer outcomes against late responses.

`platform/tests/phone-request-restoration.test.ts` uses synthetic in-memory
durable custody shared by multiple real `PhoneClient` instances and deferred
promises instead of timing sleeps. It checks lost acknowledgment/restart,
chat/upload/approval result validation, no replay, duplicate reservation,
remote cancellation, list closure/bounds/atomicity, identity conflicts,
revocation/expiry, changed session/epoch and late discovery/status races.
The existing client tests remain the regression suite for pairing, chunking,
cache, approval and response ordering. No dependency was acquired.

This seam alone does not mount the HTTP route or connect an authoritative
Engine/StateStore/session port. The coordinator owns that join; actual local
HTTP acceptance belongs to the joined host lane. Native SDK/device pairing,
relay, Android/iOS builds and real model inference remain unexecuted separate
gates. No live/native/vendor/enterprise qualification is claimed here.

Verified on the final client change: `node --test
platform/tests/phone-client.test.ts
platform/tests/phone-request-restoration.test.ts` passed 44/44 tests (27
existing, 17 restoration). A scoped TypeScript 5.9.3 strict `--noEmit` check of
`client.ts` and `phone-request-restoration.test.ts`, with the root compiler
options and reused existing dependencies, passed. Joined root/portable strict
checks belong to the coordinator because they include concurrently owned host
and custody files. The lane coordinator owns the final commit and bundle.
