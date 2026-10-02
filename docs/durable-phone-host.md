# Durable phone-host continuation integration handoff

Base: `1dc19b856380951aea49b7143ed4b5617130c06b`, tree
`68b396560c2b7950ccaf9d8c38ee52d87bd60d65`. Lane 2 only. The isolated C worktree
was created from the full-history bundle whose SHA256 is
`3e453e89f16a7ec38e07377498b6f6056d4a3a70d44e3d947966c4825a45bb93`.

The lane provides an executable fixed HTTP handler, encrypted durable request/result
custody, and an optional client request-restoration port. It does not mount the shared
Engine/server route or create a listener, session identity, relay, or provider. The
coordinator owns the supported session/StateStore adapters and public join. Task18 owns
frontend adapter wiring, native tooling, and all D build-tools writers.

## Executable contracts

`PhoneHost` takes `PhoneHostPorts`, `PhoneRequestCustody`, and a trusted host clock.
`createPhoneHttpHandler(host)` is mounted explicitly at POST `/api/companion/rpc`.
It accepts the existing `{ protocolVersion: 1, method, payload }` envelope, exact signed
body bytes, scoped Authorization bearer, and `X-Chausar-Device`, `X-Chausar-Key`,
`X-Chausar-Time`, `X-Chausar-Nonce`, `X-Chausar-Proof` headers. Responses are `{ result }`
or sanitized `{ error: { code } }`. Body size is bounded at 128 KiB; duplicate critical
headers, extra typed fields, other paths and arbitrary Engine methods refuse.
There is no CORS opt-in or desktop-token bootstrap.

Supported methods are pairing acceptance through an explicitly supplied existing
invitation adapter, validation/revocation, brief list/read, chat start, approval
list/inspect/submit, request list/status/cancel, and receipt read. Upload requires the
desktop and returns `OPEN_DESKTOP`; staging is not falsely represented as implemented.
Missing pairing/revocation/approval adapters refuse. Pairing still requires a real
desktop-authorized, expiring, single-use invitation and proof of the device key.

`host-contracts.ts` adds `request.list` and `receipt.read` without editing shared
`PhoneMethods`. `request.list` returns only `{ requestId, kind, target? }`, bounded at
100 records, after current authorization for every retained record. It returns no
question, upload bytes, credential, or challenge. `receipt.read` returns only scoped
`{ id, workspaceId, text }` from the authoritative receipt reader. Host brief/receipt
reads must enforce current source and row access within their read boundary. The required
`release` port performs a final current-grant/capability/source/version checkpoint after
asynchronous brief/receipt/approval projection and before protected output is returned.

The `authenticate` port verifies the exact signed bytes and metadata, route/method,
key possession, one-use nonce, timestamp, scoped credential, current session/device,
membership, role, epoch, capabilities, expiry, and revocation. Desktop/CLI credentials
cannot be phone credentials. Returned principal identity comes from current trusted
state. The handler independently checks device binding, authority validity, app channel,
capability and owner role for simple approval. A body-supplied principal has no authority.

## Durable identity and result behavior

Before any backend dispatch, custody encrypts and durably records the exact
workspace/member/device/epoch/session/request ID, operation ID, input digest, trusted
scope revision/operation version/source IDs, expiry, kind/approval target and `unknown`
state. It retains no replayable request body or raw approval token. Duplicate exact
requests recover their existing record; changed input or scope refuses. A persisted
reservation receives at most one call to `start`. A crash before dispatch can leave
`unknown`; reconnect performs read-only reconciliation and never guesses absence or
starts the operation again.

The backend `start` port must atomically bind that operation ID to current authority,
exact reviewed scope, any effect and its retained receipt. It must also use the existing
business-intent authority to reconcile duplicate business requests with different
transport IDs. `status` observes that same operation without execution. `cancel` either
commits a durable cancellation tombstone before effect admission, retains uncertainty,
or returns the already committed outcome. A successful cancellation cannot mean only
that a local task was stopped. These ports are deliberately not aliases for arbitrary
Engine RPC or the old permissive message-only phone approval policy.

Simple approval calls the existing atomic `PhoneApprovalService` policy: exact digest,
action revision, catalogue version, owner/device/session and expiring one-use challenge.
The backend commits decision/token consumption/receipt together and performs no action
execution. Phone text cannot approve itself or authorize a model send. Conversation
admission must use the existing exact owner-reviewed disclosure/approval workflow.

Results are type-checked and terminal state is monotonic. Every current result read,
request listing and cancellation rechecks current grant/capability, source existence
and access, scope revision, and operation version. Retained encryption is no permission
lease. Revocation, expiry, source deletion and changed reviewed revision forbid protected
readback. Unknown request IDs reveal no other session's state.

`PhoneCustodyStorage.transaction` is the coordinator's durable synchronous transaction
seam. An executable `EncryptedFilePhoneCustodyStorage` also provides AES-256-GCM,
authenticated custody ID/format/revision, bounded snapshots, regular-file/path checks,
same-directory atomic replacement, file fsync, conservative process locks and in-process
serialization. The key and custody ID come from trusted host provisioning; the adapter
does not derive authority from phone credentials or create a host identity. No identity
is silently evicted to permit redispatch; bounds refuse new requests.

The file adapter is a local synthetic qualification route. It has no external
anti-rollback anchor. Windows directory-fsync/power-loss durability, protected key
lifecycle/ACLs, and production Vault/PostgreSQL integration remain separate gates.
Restoring or deleting custody without restoring authoritative backend operation state
is not qualified recovery. Production must preserve the same durable identities through
the supported StateStore/Vault boundary; no new scheduler is introduced.

## Client and frontend join

The reviewed client seam is documented in `phone-client-restoration-seam.md`.
An optional `requestRestoration.list(authority, credential, signal)` obtains host
identities after fresh reconnect validation. A new app instance imports kinds/targets,
local revision tickets and generation, then polls only `request.status`. It never
resends a chat, upload, or approval tap. Old asynchronous results cannot cross a
disconnect/forget/revocation/new binding or session. Existing users without the optional
port retain the existing interface and lifecycle.

Task18 must extend its narrow live HTTP adapter to the two additional methods and
inject this port into the live client factory; those frontend files were not edited.
An existing same-instance terminal snapshot is retained information, not a newly
authorized current read. The host list/readback path enforces current release checks;
frontend presentation must preserve that distinction.

## Evidence and qualification

Focused suites cover actual encrypted disk reopen, integrity/tamper/wrong-key and
identity refusal, reservation races, terminal outcomes, client restart/no-replay and
generation races, strict host contracts, actual loopback HTTP and child-process restart.
The HTTP fixture creates a synthetic Engine workspace, imports synthetic business facts,
performs an explicit owner-reviewed synthetic planner calculation, and exposes retained
brief/receipt-backed responses through a signed synthetic phone grant. Its approval
adapter uses the real reference approval service with durable synthetic fixture state.
The synthetic JSON backend serializes inspection reads with writes: a Windows `EPERM`
replacement race observed during joined testing was resolved by closing each queued
reader before replacement. No retry or permission change masked that failure.
Fixture auth/business adapters are labelled synthetic. They do not qualify production
phone authentication, protected native storage, remote TLS/relay, or real inference.

Commands and final receipts are in `docs/verification/durable-phone-host-*`. The current
source check and strict root/portable TypeScript checks reuse the existing installed
dependencies read-only. No package or SDK acquisition, D write, native GUI/model call,
real user vault/credential, spending, external send, merge or push occurs in this lane.

Final joined verification passed 231/231 phone/auth/action/MCP tests with zero failures,
skips or cancellations, strict root and portable TypeScript, and syntax/JSON validation
of 351 source files. The actual HTTP subset passed 25/25; five bounded repetitions of
the seven paused release cases and their parent passed 40/40 checks after the fixture
read/write coordination fix. Independent review found no remaining source blocker.

Live production Engine/server mounting and supported session/StateStore adapters,
device pairing/key custody, Android/iOS dependency/SDK/build/device acceptance, browser
visual acceptance, relay/TLS operation, and real model inference are unqualified.
Genuine Temporal/Cube/PostgreSQL enterprise packages and qualification are not supplied
by this lane; fixture ports are not an enterprise production pass. Prior denial
boundaries remain in force. The coordinator owns merge/push and public join acceptance.

The pinned Git tree and recovered source checkout contain no `.agents/skills` or
`AGENTS.md`. The lane read the exact ownership contract, existing phone handoffs,
grant/client/cache/approval/HTTP adapter contracts, and recovered final-plan sections
23.9, 23.12, 23.27, 23.30, 23.33–35 and 23.38–39. No missing checkout skill was fabricated.
