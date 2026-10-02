# Engine phone backend join

`EnginePhoneRuntime` composes the delivered `PhoneHost` and `PhoneRequestCustody`
through the coordinator's existing `StateStore`. The source lane is
`6b7fe4ec6fad50e31b0a491eccdf1d8372540a24`; its supplied bundle SHA256 is
`4060972ce41e1d51badb59f1fc7f7d84667fc443de123d93618244f4e3dce17a`.
This join starts on frozen root `b7b41857c7e21595762720413ec3d4e12588ead0` in
`task/phone-backend-join`. It changes only the new runtime, focused tests and this
document. Shared Engine/server/Gateway/session mounting belongs to the coordinator.

## Trusted ports

Construct `new EnginePhoneRuntime(store, sessions, ports, {clock?})`. The runtime
exposes `host`, `custody`, and desktop-only
`offer(owner, {sessionId, request})`. Mount the delivered HTTP handler with `host`
at its exact `/api/companion/rpc` route. The session object structurally implements
the supported adapter's `authenticate`, `pair`, pure `assertPrincipal` and `target`,
and durable `revoke`; it is never inferred from request JSON or a desktop token.

The required callback contract is:

```ts
review(ctx, exactRequest, currentView): {sourceIds: string[]; operationVersion: string};
executeConversation(ctx, exactRequest): Promise<unknown>;
reconcileConversation(ctx, previewId, currentView): ChatAnswer | undefined;
briefs(ctx, currentView): Brief[] | Promise<Brief[]>;
receipt(ctx, id, currentView): PhoneReceipt | Promise<PhoneReceipt>;
```

`review` and `reconcileConversation` are synchronous, pure current-authority checks.
They must install the actual Gateway/readiness/source/history/calculator guards.
They must support the exact original request in dispatching/uncertain and completed
readback states while continuing to prohibit a fresh send of used previews. A
failed-after-dispatch provider record is not evidence that no effect occurred.
`reconcileConversation` admits only exact currently guarded retained history linked
to the reviewed model preview; an arbitrary result object, successful provider
response, cached text or absent result cannot prove a commit. None of these callbacks
has a fixture fallback. Real Engine/session callback qualification is a separate join.

## Persistent boundaries

One namespaced `engine-phone-runtime` container in `State.conversations` stores
custody records, full desktop-reviewed offers and business intents. Its ID is within
the phone identifier bound, its kind is excluded by the existing history-kind filter,
and it never uses `role:user` or shares a history answer ID. The container checks its
workspace/version/revision, canonical body SHA256, structural identity and bounds.
The existing authenticated encrypted StateStore snapshot protects this checksum;
the checksum is not a separate credential or rollback anchor. No new private file,
key, default host authority or scheduler is created.

Custody mutations use the StateStore writer with container revision/integrity CAS.
Concurrent changes retry the pure synchronous custody callback at most eight times.
Read-only callbacks commit no no-op revision. Async/thenable callbacks and values
that cannot be cloned refuse before any write. The container is bounded at 8 MiB,
with at most 1,000 custody rows/offers/intents; the delivered custody class also
enforces 100 records per session, and intent aliases are bounded at 100. No identity
is silently evicted to make a preview or request replayable.

An offer requires a desktop, untainted exact owner context; the target must be that
same member with current chat capability. The runtime verifies one unused unified
conversation preview and its exact unused outbound approval, owner/epoch, question,
route, endpoint and payload digest. It preserves the complete canonical request,
including every comparison/scenario selector added to `ModelRequest`. Phone question
text selects only one exact current offered question; text cannot authorize a new
preview, model send, paid fallback, disclosure or operation.

Scope pins selected-source facts/imports/rules/tombstones, member/policy/ontology,
the full request, immutable preview/approval, stable route configuration, operation
version and grant/device/session/epoch. Global StateStore revision, authentication
nonces, Gateway dispatch state and consumed route cost are excluded. Own custody
and receipt writes therefore do not invalidate the reviewed business request.

Custody commits before backend admission. A separate business intent keyed by the
exact preview commits under the same StateStore writer before Gateway execution.
Different transport IDs attach to that intent and never invoke the provider or
calculation twice. Crash before/after an effect leaves unknown unless exact guarded
retained conversation history proves a committed answer. Status is read-only; it
never invokes the execution callback. A cancellation before effect admission commits
a tombstone that subsequent admission respects. Dispatching cancellation remains
unknown, and exact committed history wins. Provider execution and analytical work
retain their existing Engine transactions; this adapter does not claim an atomic
external provider/database commit.

Offer/approval expiry gates new admission and the first dispatch. Existing custody
can recover guarded history after that transfer bound while its current phone grant
and custody expiry remain live. Every read/list/cancel/result release rechecks current
membership, capability, source access/readiness and exact request/operation scope.
Retained records and past approval are never a permission lease.

Per-handle async context keeps the original brief/receipt projection and relevant
business fingerprint isolated from concurrent requests. Release compares original
content and source identity with fresh projections, then checks the final current
view after asynchronous work. Brief versions and receipt references must still
match. These are completed-boundary checks, not continuous exclusion of later writers.

## Remaining production gates

All approval list/inspect/submit paths return `OPEN_DESKTOP`. The production atomic
challenge/decision ledger and enabled writeback target set are unanswered; this
runtime does not alias the old message-only phone action policy or enable live action
execution. Upload also returns the delivered lane's `OPEN_DESKTOP` result.

Actual Engine/server mounting, supported session/key/pairing custody, guarded callback
acceptance, production approval ledger, frontend HTTP/restoration delivery, native
Android/iOS tooling/devices and relay/TLS deployment remain separate gates. No native,
real model/provider, customer or complete product qualification is claimed.

## Source-only verification

Syntax checks and bounded strict TypeScript pass for the new runtime and tests using
the genuine existing compiler/Node/pg declarations read-only. No dependencies were
acquired, no D writes occurred and no runtime tests ran while root's serial aggregate
was active. Independent bounded static review found no remaining concrete blocker.

The new focused suite exercises text-only refusal, distinct transport IDs and runtime
reopen, auth-nonce revisions, crash after intent commit, cancellation before/after
admission, retained commit with lost response, exact payload/source drift, paused
receipt release/provenance changes, concurrent read-ticket isolation, async callback
rollback, and actual encrypted Vault reopen. It is not yet an executed pass:

```powershell
node --test platform/tests/engine-phone-runtime.test.ts
```
