# Coordinator integration handoff

Reviewed join branch: `integration/phone-ui-join`, based on integrated commit
`3f93ac8f7374b3b1dedcecf2f8b3d3f1ec7dd5e4`. The source producer is
`795714e190fc021fed0c2a0382c12559320fc131`; only its follow-up above the already
integrated protocol `bfe3a0876bbc0673db52063eb81e05a6636986ed` was applied.
The join includes React Native app/project source, responsive web and portable phone
client/cache extensions. Shared server, Engine, desktop renderer and root manifests
are unchanged. The producer's optional root `phone:preview` package script was excluded;
the explicit Node command below works. Parent owns integration and publication.

## Delivered

- Native pairing, brief catalogue/detail, chat/proof, upload/desktop confirmation,
  approval inbox/detail, Activity/status/cancel, device/reconnect/forget/revoke and receipt.
- Android and iOS launcher/project sources. Safe areas, tabs/detail navigation, Android
  hardware back, accessible controls, responsive tablet widths and keyboard-aware scrolling.
- Shared stable snapshot controller with in-flight request subscriptions. Cancellation
  remains available while upload/chat delivery is pending. Revocation/forget clears all
  workspace views; stale IO cannot restore them or override later tab navigation.
- Responsive web alongside the existing desktop. Fixed loopback preview serves only its
  allowlisted assets; no engine listener, external provider or permanent service.
- Explicit live ports, proposed device-signed HTTPS RPC adapter, encrypted browser brief
  storage, scoped cached catalogue support and synthetic preview fixtures.

## Server coordination

New inbox contract: `approval.list` → `{ approvalId, title }[]`, bounded at 100 entries,
fresh `approval.simple` validation and server identity/scope checks. Both UIs require it.
Receipt details are a scoped `CompanionReceiptReader` port, not a newly invented live API.

`createHttpPhoneTransport` proposes POST `/api/companion/rpc` at an explicit HTTPS origin.
Envelope: `{ protocolVersion: 1, method, payload }`. Sign exact JSON bytes before send.
Header proof fields: `X-Chausar-Device`, `X-Chausar-Key`, `X-Chausar-Time`,
`X-Chausar-Nonce`, `X-Chausar-Proof`; scoped bearer in Authorization only.
Upload chunk bytes encode as numeric JSON arrays. Responses wrap `{ result }` or a
sanitized `{ error: { code } }`. This is a proposed fixed adapter contract, not a live
server claim. Verify proof, timestamp/nonce, scoped session and exact method server-side;
derive principal from authenticated live state. An untrusted relay uses sealed envelopes.

Preserve original phone handoff's durable ledger, no-execution decision reference,
single-use challenge delivery and action revision/digest/operation-version checks.
Do not alias the new reversible-internal policy to baseline message-only phone approval.
Unknown receipts reconcile by request ID; never repeat an approval or uncertain write.

## Developer preview and qualification

Web works with existing Node: `node scripts/phone-web-preview.mjs`, manually open
`http://127.0.0.1:4368`, pair `DEMO-COMPANION`, stop with Ctrl+C. This is desktop loopback
preview only. See `app/companion/README.md` for exact flow and limits.

Native: after permitted dependency/toolchain provisioning, from native package run
`npm run typecheck`, `npm start`, then `npm run android` (or `npm run ios` on an existing
Mac). The recovered Windows npm CLI workaround and detailed prerequisites are in
`app/companion/native/README.md`. No native dependency install, wrapper JAR, SDK, signing
key or binary is included. Native package dependencies remain absent, so native TSX
typechecking, Metro bundling and platform compilation remain unverified.

Current integration checks pass: 127 portable phone tests, strict app typecheck, explicit
all-shared companion/browser typecheck, 153 source syntax/JSON checks, six native source
grammar checks and ten native XML-family parses. Both strict checks used actual installed
TypeScript 5.9.3 and Node type declarations, reused read-only from the parent's D: dependency
allocation. No fake React Native types were introduced. The eight loopback tests were
rerun after correcting their server-close callback type and passed.

Native TSX compilation/render and Android/iOS builds: none. Web loopback/module graph
tested; browser launch/visual qualification: none. IndexedDB tests use an asynchronous
transaction fixture with real Node WebCrypto, not a real browser. Current evidence is
`docs/evidence/phone-ui-join-checks.json`; the producer's 164-test/82-source record in
`phone-apps-checks.json` is historical evidence from its separate checkout.

Review corrected the native offline catalogue control to expose “Show saved briefs”
for a cached session and qualified the native demo cache copy as synthetic in-memory
snapshots. These controls have source/grammar review, not device rendering acceptance.

## Remaining prerequisites and simple choices

The database worker owns `D:/Chausar/build-tools/qualification`; coordinate that shared
allocation before downloads. User approved free tools/project dependencies on D: with
a total 4 GB cap. This lane downloaded nothing and wrote nothing to D:. Do not silently
install a global SDK or grow that budget. Source shell/config work is already authorized.

Choose native bridges or vetted community packages for protected key/storage/cryptography
and document picking. Native synthetic cache/session is ephemeral; real encrypted persistence
is an explicit live adapter requirement. Choose an existing Android phone or allocated
emulator and an existing Mac simulator/device for qualification. Manual foreground checks
are implemented; optional notifications and any later hosting/channel provider are parent
decisions. The responsive browser needs a live bootstrap and protected credential policy.
Full restart activity recovery still needs unresolved-ID persistence/list without retry bodies.

No account creation, store submission, paid service, signing-key handling, real WhatsApp/email
message, hosted vendor choice or deployment. Prior shell-network/browser denials were respected.
