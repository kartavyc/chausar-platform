# Phone companion implementation and integration handoff

This branch adds a framework-neutral TypeScript companion protocol, client lifecycle,
encrypted brief cache, atomic approval reference service, and messaging/relay contracts.
It is a remote client: calculations, books, connector credentials and action execution
remain on the desktop/home-box/hosted engine. The user selected React Native + TypeScript.
The second commit adds actual iOS/Android launcher projects, native screens/navigation,
and a responsive DOM web client. They share a screen controller and the portable client.
The default preview uses clearly labelled synthetic endpoints. Live pairing is not wired.

The source is the clean local baseline `100df1d3c3bdb8e7793d81e6590cd6145c617d3e`.
Published private main `3160d5a896b5fb3539405948671d530367cfe30d` has the same tree
but different ancestry. This task uses a task-owned clone of the local history bundle
and an isolated worktree. The parent integrates; no main edits or push were performed.

## Source and accepted scope

Read the exact current Library files, including the build-plan continuation:

- `libfile_7d0650e81b608191bdbc0ca48b08ee03`: CHAUSAR-LIVE-QUESTLOG.html.
- `libfile_ccfe1d9fee9c8191aa54de1e93e9549f`: CHAUSAR-ARCHITECTURE.md.
- `libfile_db67faa278948191adeb352f06c2f714`: CHAUSAR-LIVE-BUILD-PLAN.md.

The user has now approved native iOS and Android, responsive web, WhatsApp and email
phone paths, and remote companion architecture. Briefs may be cached for offline
reading. Approvals require fresh online authority; an offline tap never enters a retry
queue. The older spec's deferred-native timeline does not remove this new approved scope.
The spec still places chat in the app and restricts phone approvals to simple reversible
changes inside the workspace. Money, external messages and destructive actions open the
desktop. This implementation retains that scope pending any explicit later product choice.

## Selected native client

React Native + TypeScript shares the phone protocol/controller between iOS and Android.
The desktop Electron renderer remains plain JavaScript/DOM; no desktop framework was
replaced. The native dependency manifest is isolated at `app/companion/native/package.json`.
See its README for exact template references and Android/iOS build prerequisites.

## Added implementation

| File | Role |
|---|---|
| `platform/runtime/phone/contracts.ts` | Protocol version, typed method inputs/results, identity/authority states, brief/chat/upload/approval contracts and storage/transport ports. No Node/framework imports. |
| `platform/runtime/phone/client.ts` | Pair/restore/revoke, fresh authority validation, online chat and chunked uploads, brief reads, one-use approval taps, reconnect reconciliation and cancellation. Diagnostic snapshots omit credentials and challenge tokens. |
| `platform/runtime/phone/cache.ts` | AES-256-GCM brief snapshots, protected nonexportable key port, opaque dedicated storage port, identity-bound authenticated data, bounded retention and eviction. |
| `platform/runtime/phone/approval.ts` | Portable reference service with an injected durable atomic ledger. Current owner/device/session/action/catalogue checks and one-use token consumption happen in one transaction. It records decisions and never executes an action. |
| `platform/runtime/phone/channels.ts` | Generic opted-in WhatsApp/email notifications, fixed HELP/STOP/app replies, token-free paired-page links and sealed relay-envelope contracts. No provider sends. |
| `app/companion/shared/controller.ts` | Stable immutable screen snapshots, pairing, saved/current briefs, chat/proof, uploads, decisions, activity/cancel and device removal. Client subscriptions expose in-flight requests before responses arrive. |
| `app/companion/shared/adapters.ts` | Explicit live-host ports, device-signed fixed HTTPS RPC adapter, and browser IndexedDB storage for opaque encrypted bytes/nonexportable keys. Proposed endpoint awaits coordinator wiring. |
| `app/companion/shared/preview.ts` | Synthetic endpoint fixtures. No model, business engine, provider or live credential is used. |
| `app/companion/native/` | React Native shell and eight screens, Android Kotlin project and iOS Swift/Xcode project. Default native cache/session is synthetic and memory-only; live hosts inject protected adapters. |
| `app/companion/web/` / `scripts/phone-web-preview.mjs` | Responsive web screens and temporary loopback preview. Browser WebCrypto encrypts saved briefs in IndexedDB; synthetic session stays memory-only. |

Use `PhoneClient.restore()` at app startup, then `reconnect()` when online. Restore always
sets validation-required, never paired authority. Every online request calls session
validation; the server must also authenticate and authorize every endpoint independently.
Client freshness checks are only an additional guard. A validation response must retain
the same workspace/member/device/epoch/session and carry a recent server validation time.
Clock skew over 30 seconds may prevent requests; the server clock decides approval expiry.

Disconnect aborts in-flight requests and removes approval challenge tokens. Pending or
cancelling remote requests become unknown. Reconnect polls only request IDs: it does not
resend chats, upload bodies or approval taps. A lost acknowledgement remains unknown until
the remote ledger settles it. Cancel is confirmed only by a server result; cancellation
before an upload was sent can be confirmed locally. Request revision tickets prevent late
status responses from overwriting cancelled/completed states. Forget/revocation removes
old answers, request identities, credentials, cache bytes and cache keys; old asynchronous
work cannot resume through a later pairing, even if a request ID is reused.

Upload input is snapshotted before hashing. The client verifies SHA-256, bounded type/size,
chunk offsets and slot expiry. Final output is `awaiting-confirmation` with
`sourceTainted:true`. Uploaded text cannot be an instruction or approve its own import.
The server must check content type/size/checksum and require its existing import preview
and explicit confirmation before adding facts.

Offline `readBrief` returns only cached/read-only snapshots. AES-GCM authenticates
workspace/member/device/epoch and record ID. Default limits are 24 hours, 12 records,
64 KiB per record and 512 KiB total; finite hard caps are enforced. Only brief fields,
receipt IDs and cache timestamps are encrypted. Session authority, credentials, approval
objects, raw imports and chat history are not persisted by this cache. Erasure is serialized
against in-flight writes. Offline revocation cannot be discovered until reconnect; the
accepted cache retention window controls that exposure. Cached information is never used
as permission to act.

## Server wiring owned by the parent

The baseline server is loopback-only (`server.ts`), desktop uses narrow Electron IPC
(`app/desktop/preload.cjs`), and `Engine.requestAs` is the current engine boundary.
No remote listener, relay service or phone pairing endpoint exists in the baseline.
Do not expose the desktop bootstrap credential to phones or proxy arbitrary RPC methods.
Use a fixed remote protocol adapter that implements only these methods:

| Method | Adapter requirement |
|---|---|
| `pairing.accept` | Desktop-authorized, expiring, single-use invitation; verify device-key possession, bind workspace/member/device/epoch, issue a scoped session, and record consent. Invite code and proof travel in authenticated request bodies. |
| `session.validate` / `session.revoke` | Verify current membership, role/source/branch grants, device key/session, epoch, expiry and revocation. Return an allowlisted authority snapshot; revoke device credentials/keys and pending offers. |
| `brief.list` / `brief.read` | Read current accessible owner briefs/report receipts; project only declared fields. Authorize current source/branch scope before reading. |
| `chat.start` | App channels only. Route through `conversation.ask` and existing model disclosure/receipt checks. Store request idempotency/outcome durably and return only scoped proof-backed results. |
| `upload.begin` / `.chunk` / `.finish` | Bounded staging tied to current identity, TTL and request ID; checksum/MIME validation and cleanup. Bridge to managed ingest preview/confirmation without treating content as instructions. |
| `approval.list` | Freshly authenticated, bounded approval inbox for this identity; only approval ID/title. This new typed method is needed by both clients. |
| `approval.inspect` | Freshly authenticated delivery/redemption of a desktop-issued offer for this exact target session. Return a one-time challenge in the body only. Never recover a raw token from its hash. |
| `approval.submit` | Delegate to the atomic reference service and map its durable receipt to this request ID. No action execution from the phone handler. |
| `request.status` / `request.cancel` | Identity-bound durable request ledger. Cancellation acknowledges actual server state; a write/decision already committed may have succeeded. Never retry an uncertain external action. |

`PhoneApprovalLedger.transaction` must share the actual session/member/device/action and
operation-catalogue state and serialize conflicting updates across server processes.
`commitDecision` must atomically consume the token, persist the request/decision receipt,
and record the approved/rejected exact action disposition. An error rolls back all three.
The action adapter supplies the independent canonical `computedDigest` (existing
`ActionService.identity` can compute this) and the current `operationVersion` and
`actionRevision`. Later engine execution must recheck that exact version and all live
permissions, using the existing action runner/read-back path. Client-supplied identity,
role, channel or `online` flags cannot construct an `ApprovalPrincipal`.

The old `PhoneApprovalService` in `mcp.ts` permits simple messages; the existing
`ActionService.approve` phone path also permits message impact only. They are not the new
reversible-internal policy, and operation catalogue version is not a baseline approval
field. The parent must coordinate the shared action adapter and version guard instead of
aliasing the new protocol to those methods. No shared Engine/auth/action/server files were
edited here.

The reference service stores only token hashes. Its `issue()` result contains the raw
token once. The parent must choose authenticated one-time delivery or desktop-authorized
offer redemption/reissue for `approval.inspect`; persisting plaintext tokens or embedding
them in URL/message text is not acceptable. Decisions are bound to the exact owner,
workspace, phone/device, epoch, target session, digest, revision and catalogue version,
and expire within five minutes. Rejection consumes the challenge too. A refreshed session
needs a new challenge. The default reference policy targets the issuing owner's own phone;
delegated approval seats need an explicit later role policy.

WhatsApp/email adapters require stored opt-in, provider identity verification and an
authenticated binding for a simple decision. A forwarded token is insufficient. Generic
links open the paired responsive web app without authority in the URL. Bare YES and chat
receive fixed app/HELP/STOP replies. The host must persist STOP and route HELP to its human
support path. Provider registration, templates, compliance qualification, real messages
and delivery costs remain prerequisites, not actions performed by this branch.

`CompanionRelay` is a typed port only. Relay storage receives encrypted envelopes for an
opaque route. Actual sealing/decryption, delivery acknowledgements and transport adapters
remain to wire. Collection/acknowledgement proves delivery, never approval. An approval
intent collected after sleep must pass fresh online identity, live version and expiry
checks before it can become a decision. Expired or revoked envelopes cannot be executed.

## Remaining implementation and qualification

- Wire the supplied fixed HTTPS transport to the coordinator's authenticated companion
  endpoint. `/api/companion/rpc` is a proposed adapter path, not an existing live route.
  Direct trusted API requests use HTTPS/device proof; any untrusted store-and-forward relay
  must use the sealed relay contract before live data is routed through it.
- iOS/Android
  protected key/storage bridges must satisfy the portable WebCrypto/key contracts and
  destructive erasure behavior. A Node nonexportable key fixture does not prove OS keystore
  persistence. The native default demonstrates offline synthetic reading in the current
  process only. Browser storage has a tested transaction fixture; real browser/device
  storage and a protected live credential policy still need qualification.
- Durable server pairing/request ledger, atomic action/version adapter and authenticated
  challenge-offer delivery, relay sealing/collection, upload staging/cleanup, and opt-in
  channel adapters. Preserve this fixed API; do not permit arbitrary engine method names.
- The current client retains at most 100 visible requests in memory and polls known IDs
  during reconnect. Full app restart recovery needs a durable server list/journal of
  unresolved IDs (without replay bodies or tokens); this branch does not persist such a
  journal or run background retries.
- Native dependency resolution/lockfile, SDK/device checks and offline/reconnect/device-loss
  UX qualification. The coordinator must allocate free dependencies/toolchains on D: within
  the user's total 4 GB allowance before any download. No D: writes/downloads occurred here.
  iOS needs
  Mac/Xcode; Android needs SDK/JDK tooling. Signing/provisioning/store accounts come before
  distribution. [React Native environment](https://reactnative.dev/docs/set-up-your-environment),
  [Apple account guidance](https://developer.apple.com/help/account/basics/about-your-developer-account),
  [Android publishing](https://developer.android.com/studio/publish).
- Native TSX typecheck after permitted React Native dependency provisioning. The reviewed
  integration passes strict app and all-shared portable companion checks with actual
  TypeScript 5.9.3 dependencies reused read-only from the parent's allocation. React Native
  dependencies and toolchains remain absent. No shell network retry or dependency
  installation was attempted. Native builds, browser/device visual QA, provider delivery
  and production end-to-end behavior have not been qualified.

No vendor accounts, keys, push services, paid CI/store submission, real WhatsApp/email
messages or deployment were created. Prior network/browser-launch denials were respected.

Remaining choices in simple English: use small native bridges or a vetted community
package for protected device keys, encrypted brief storage and the file picker; qualify
Android on an existing phone or a provisioned emulator; qualify iOS on an existing Mac
simulator or device. Manual foreground checks work now. Notifications can be considered
later; no push vendor, hosted provider, account or paid service was chosen. The parent
coordinates relay hosting and any future WhatsApp/email provider decision.

## Verification

The focused suites test client lifecycle/races, encryption retention/erasure,
atomic single-use/version/identity decisions, and messaging/relay contracts. The approval
suite includes an actual `PhoneClient` to reference-service flow and lost-response
reconciliation. Adjacent existing auth/action/plugin/MCP tests remain green. See
`docs/evidence/phone-companion-checks.json` and `docs/evidence/phone-companion-tests.txt` for the
first-commit receipt. The second-commit checks and 164 passing tests are recorded in
`docs/evidence/phone-apps-checks.json` and `docs/evidence/phone-apps-tests.txt`. They include
controller workflows, HTTP adapter mocks, browser storage transaction fixtures and the
loopback preview module graph. Those files preserve the producer's historical results.
The reviewed integration's 127 focused phone tests, strict app and all-shared portable
TypeScript checks, and native grammar/XML checks are recorded in
`docs/evidence/phone-ui-join-checks.json`. Native TSX typechecking, native builds and
browser/device visual qualification have not run. No Android or iOS binary was built.

Run locally:

```powershell
node scripts/check.mjs
node --test platform/tests/phone-client.test.ts platform/tests/phone-cache.test.ts platform/tests/phone-approval.test.ts platform/tests/phone-channels.test.ts platform/tests/auth.test.ts platform/tests/workflows-actions.test.ts platform/tests/workflows-plugins-learning-mcp.test.ts
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run typecheck
node node_modules/typescript/bin/tsc --noEmit --pretty false --project app/companion/tsconfig.portable.json
```

Start the immediately runnable web preview from the repository root:

```powershell
node scripts/phone-web-preview.mjs
```

Manually open `http://127.0.0.1:4368`, pair with `DEMO-COMPANION`, and stop with Ctrl+C.
This requires Node 24.13.1+ and a browser with WebCrypto and IndexedDB. It starts no desktop
engine and installs no service. The loopback server cannot be opened directly from a phone.
No browser launch was attempted here. Native Metro/device instructions and prerequisites
are in `app/companion/native/README.md`.
