# Direct native vault custody source

This is the source for a one-shot helper used by the trusted host provider. The
user selected direct native entries. A vault's encrypted-envelope UUID is the
account identity; copies restored with the same UUID refer to the same entry.
The helper does not accept a directory, provider selector, passphrase, recovery
code, file input, credential argument or secret-bearing environment variable.

This source has **not** been compiled against platform SDKs, executed against an
OS credential store, signed or included in a qualified release. No native helper,
keychain, credentials, D-Bus service or permissions were accessed to develop it.
The portable parser self-test uses synthetic bytes and no platform backend.

## Fixed protocol

Standard input is one binary request followed by EOF. The helper rejects unknown
versions/operations, noncanonical IDs, truncation and any trailing byte before
calling a native API. The host must close stdin and enforce a process timeout.
Standard output is one binary response. Stderr is never a protocol or diagnostic
channel; Linux library diagnostics are suppressed. Requests carry no filenames.

| Request offset | Value |
| --- | --- |
| 0–3 | ASCII `CKP1` |
| 4 | Operation: `1` store, `2` retrieve, `3` remove |
| 5–40 | Exactly 36 ASCII bytes: lowercase hex UUID with hyphens at 8/13/18/23 |
| 41–72 | Exactly 32 raw key bytes, only for store |

Retrieve/remove requests are exactly 41 bytes; store requests are exactly 73.

| Response offset | Value |
| --- | --- |
| 0–3 | ASCII `CKR1` |
| 4 | `0` ok, `1` missing, `2` unavailable, `3` denied, `4` conflict, `5` invalid |
| 5 | Backend: `1` Windows, `2` macOS, `3` Linux |
| 6 | Key length: `0`, or `32` only for successful retrieve |
| 7–38 | Exactly 32 raw key bytes, only for successful retrieve |

A protocol-level failure is still a seven-byte response and process exit zero.
Transport initialization/output failures may exit nonzero without a full response.
The host must reject any extra output, wrong backend, status, key size or exit.

## Native entry behavior

The fixed namespace is `in.chausar.vault.v1`, with the exact vault UUID as account.
Store first checks existing custody: the same 32-byte key succeeds without
replacing it; a different, malformed or ambiguous entry returns conflict. Retrieve
returns missing only for absence; unavailable/locked/denied is not absence. Remove
is idempotent for absence and otherwise propagates native failure. Linux removes
all exact matching entries, preflighting locked items before any deletion; a
later native failure can leave partial external custody and is still a failure.

| OS | Native API/storage | Qualification dependency |
| --- | --- | --- |
| Windows | `CredReadW`/`CredWriteW`/`CredDeleteW`, generic credential target `in.chausar.vault.v1/<UUID>`, account `<UUID>`, `CRED_PERSIST_LOCAL_MACHINE` | Windows SDK, `advapi32`, signed helper identity and per-user logon-session qualification |
| macOS | `SecItemCopyMatching`/`SecItemAdd`/`SecItemDelete`, generic password with exact service/account, synchronizable false | macOS SDK Security/CoreFoundation, signed helper identity and existing Keychain ACL/access qualification |
| Linux | Direct libsecret `SecretService`/`SecretItem`/binary `SecretValue` on fixed `org.freedesktop.secrets`; existing default native collection | libsecret-1 development/runtime libraries, GLib/GIO >= 2.50, session D-Bus and an already unlocked Secret Service keyring |

Windows helper operations use a transient, current-user-SID/vault mutex across
logon sessions. Linux helper operations use a transient session-bus name with the
UUID dashes removed. Contention returns unavailable; neither creates a lock file
or changes an ACL. These locks serialize participating helpers, not arbitrary
credential-store clients. macOS uses atomic add and never updates existing keys.
The host and Vault still own process/transition barriers and deletion authority.

macOS queries reject duplicate matching items and suppress authentication UI;
checked `SecKeychainSetUserInteractionAllowed(false)` also disables legacy
login-keychain prompts within the one-shot process. It changes no persistent
policy, ACL or security setting. Removal targets the exact service/account.
Linux resolves the existing unique owner of fixed `org.freedesktop.secrets` and
pins all operations to that owner, preventing autostart/restart when it disappears.
Linux refuses locked collections/items
and all prompts, creates no collection/alias, never selects a portal/file/password
backend, and rejects libsecret's `plain` transfer session before exchanging key
bytes. Only `dh-ietf1024-sha256-aes128-cbc-pkcs7` is accepted. This source does not
claim that a Secret Service protocol response certifies the provider's encryption
at rest; approved distribution/provider qualification must establish that.

Own input/output/key buffers are cleared with volatile writes; Windows API blob
copies use `SecureZeroMemory` before `CredFree`. libsecret `SecretValue` references
are released through its secret-memory lifecycle. CoreFoundation, IPC and OS APIs
can retain copies which this process cannot claim to erase. No secret is printed,
passed in argv/env, or written by the helper to a file.

## Build and remaining acceptance

`CMakeLists.txt` selects exactly one backend and fails unsupported platforms. It
does not acquire dependencies. The parent release process must compile with each
supported OS SDK, review/distribute library licenses (libsecret is LGPL-2.1-or-later),
inventory runtime libraries, sign the helper and distribution manifest, and wire
the resulting qualified artifact into the host's verified runtime inventory.
Do not treat the standalone source or an unsigned preview as an accepted helper.

An installed C++17 compiler can build `protocol-selftest.cpp` alone without any
native backend, platform SDK, libsecret, D-Bus or credential-store call. It tests
the actual shared parser, all operation/length combinations, invalid UUID/header
bytes, key comparison and explicit clearing. It does not qualify native behavior.

The `Native keychain compile verification` workflow uses only the existing
automatic Ubuntu/Windows runner labels and installed CMake/compiler/SDK tools.
`CHAUSAR_KEYCHAIN_PROTOCOL_ONLY=ON` returns before resolving native libraries;
its sole CTest target links only `protocol-selftest.cpp`, never the helper entrypoint
or provider backends. CI runs that parser test, then compiles/links the actual
native helper without launching it. Missing installed dependencies fail explicitly
rather than triggering acquisition. The isolated `checkpoint/keychain-native-ci-*`
push branch skips the ordinary npm-install workflow; parent branches and PR
verification are unchanged. macOS still needs an already approved matching native
runner through the private release workflow gate. No successful compile is OS
credential-store acceptance.

Native acceptance remains open on every OS: same/conflicting store, reopen and
exact-entry retrieval/removal, unavailable/locked/denied states, duplicate entries,
concurrency, restored-copy/shared-UUID behavior, helper timeout/crash, signed
identity/access controls, platform upgrade and distribution dependency checks.
Those steps need parent coordination and separate authorized native execution.

Primary API references: [Windows credential write and replacement behavior](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew),
[Apple item queries](https://developer.apple.com/documentation/security/secitemcopymatching(_:_:)),
[libsecret direct service API](https://gnome.pages.gitlab.gnome.org/libsecret/class.Service.html),
[libsecret binary values](https://gnome.pages.gitlab.gnome.org/libsecret/struct.Value.html),
[libsecret prompt override](https://gnome.pages.gitlab.gnome.org/libsecret/vfunc.Service.prompt_sync.html),
[libsecret service constructor](https://raw.githubusercontent.com/GNOME/libsecret/master/libsecret/secret-service.c),
[GLib construction lifecycle](https://raw.githubusercontent.com/GNOME/glib/main/gobject/gobject.c),
and [Secret Service encrypted transfer protocol](https://specifications.freedesktop.org/secret-service/latest/ch07s03.html).
