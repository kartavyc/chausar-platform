# Companion preview and integration

The user selected React Native + TypeScript. `native/` contains actual iOS/Android
launcher projects and screens. `web/` contains a responsive DOM client alongside the
existing desktop frontend. Both call `shared/controller.ts`, which calls the same typed
phone protocol. The engine stays remote. The default is a visibly synthetic preview.

## Try the web preview now

From the repository root with Node 24.13.1+:

```text
node scripts/phone-web-preview.mjs
```

Open `http://127.0.0.1:4368` manually. Enter `DEMO-COMPANION` to pair the sample workspace.
Ctrl+C stops the foreground server; `--port 0` selects a free port. No engine or service
is started. A browser with WebCrypto and IndexedDB is required. If browser storage is
unavailable the preview fails visibly rather than substituting plaintext storage.

Try Briefs → open a brief → Device → Go offline → Briefs → Show saved briefs → open the
saved copy. Reconnect in Device. In Chat, send a question, then check its request in
Activity to obtain the fixture answer and open its receipt. Upload a small PDF/CSV/JPEG/PNG
to exercise staging; it stays unconfirmed. In Approvals refresh the inbox, inspect the
internal-note action, and approve or reject it online. The payment example opens desktop.
No real model, import, payment or remote request is performed.

The browser stores encrypted brief records and nonexportable AES-GCM keys in a dedicated
IndexedDB namespace. Synthetic session credentials remain memory-only: saved reading
works during the current preview session, and reload requires sample pairing again.
No approval token, retry body or chat history is persisted. There is no service worker
or offline app-shell installation; an already-open preview can read saved briefs.

## Native preview

See [native/README.md](native/README.md). Dependency manifests and native project sources
are supplied, but no packages, native toolchain, compiled JS bundle or application binary
were downloaded/built. Coordinate D: allocation with the parent before provisioning;
all free tools/project dependencies must stay within the user's shared 4 GB budget.
The native preview uses the bundled synthetic CSV and ephemeral synthetic cached briefs.
Actual OS picking, protected persisted credentials/briefs and connectivity require host
adapters. These limitations are visible in the app; sample pairing is not live pairing.

Screens: pairing, brief catalogue/detail, chat/proof, uploads/confirmation, approval
inbox/detail, Activity/status/cancel, device/reconnect/forget/revoke, and receipt detail.
Native navigation uses tabs, detail-back controls and Android hardware back. Layout uses
safe areas, a scrolling keyboard-aware shell, readable tablet widths, accessible labels
and 44-point controls. Browser/device visual qualification remains outstanding.

## Connect the real engine

`createLiveCompanionController(adapters)` requires all ports explicitly and never fills
missing adapters with synthetic data. `App` accepts that controller through its prop.
Provide device identity/proof, HTTPS transport, protected credential store, encrypted
brief cache, actual document picker, scoped receipt reader, cryptography and unique IDs.
The browser DOM UI currently boots only the synthetic controller; live browser bootstrap
and protected credential policy still need wiring.

`createHttpPhoneTransport` signs the exact JSON body, uses only the proposed fixed
`/api/companion/rpc` HTTPS path, and sends the bearer credential/proof in headers. It has
no discovery or arbitrary engine method passthrough. Upload bytes use numeric JSON arrays;
the server must decode/check bounds. This wire format is a proposal for coordinator
integration, not a claim that the current relay server implements it. The typed
`approval.list` method supplies the new inbox; receipt reading is an injected scoped port.
The parent owns server ledgers, pairing/revocation, upload staging, receipts, action version
checks, offer delivery and any relay sealing/provider wiring.

Every approval requires fresh online authority, matching revision/digest/operation version
and an unused expiring challenge. Taps are never queued. Disconnect discards challenge
tokens and turns in-flight work unknown. Reconnect only polls request IDs. Cancellation
waits for the remote result; a request already committed can have succeeded. Forget and
acknowledged revoke clear workspace views, credentials, cache bytes and keys.

Remaining choices: platform bridges or a vetted community package for protected keys/
storage/picking, an existing phone or simulator for qualification, and any later hosting/
notification/channel provider through the parent. No hosted vendor, account, push provider,
signing key or store submission was chosen. No real WhatsApp/email messages were sent.

## Actual validation

The integrated follow-up passed 127 portable phone/controller/adapter/storage-fixture/
loopback tests. Strict app and portable companion typechecks pass with the real installed
TypeScript 5.9.3 compiler. From the repository root with those dependencies available:

```text
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/typescript/bin/tsc --noEmit --pretty false --project app/companion/tsconfig.portable.json
```

The portable project includes all shared browser/controller source and the native view
helper; it excludes React Native TSX because React Native dependencies are absent.
Native grammar and XML checks pass, but they do not compile, render or build the app.
Android and iOS builds: **none**. Browser launch/visual testing: **none**. Live pairing:
**none**. See `docs/evidence/phone-ui-join-checks.json` for current integration evidence;
`docs/evidence/phone-apps-checks.json` records the earlier producer's separate checks.
