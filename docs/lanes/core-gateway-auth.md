# core-gateway-auth

Round 4 core lane. It owns `gateway.ts`, `actions.ts` (the second ask), `vault.ts` (secrets and PIN), `plugins.ts` (the canary) and the keychain and secret store. Its RPC methods live in `platform/runtime/modules/lane-core-gateway-auth.ts`, which spreads three method files under `platform/runtime/gateway-auth/`:

- `gateway-methods.ts` (+ `probe.ts`): route order, route states, discarding a waiting send, the monthly cap.
- `approval-methods.ts` (+ `second-ask.ts`): the second ask, per-member approval secrets, `auth.verifyApprovalSecret`.
- `vault-methods.ts` (+ `secret-store.ts`, `pin.ts`, `lifecycle.ts`, `network.ts`): the secret store, PIN quick unlock, `network.online`.

Every item below is labelled **supported** (tested end to end through the real engine on synthetic data) or **experimental** (works, but depends on a device, a signed helper or a live service that was not tested).

## What was built

### 1. Gateway

| Item | Label | How it works |
|---|---|---|
| Discard a waiting send (TR-09) | supported | `models.discard { id }`. A send waiting for approval becomes `discarded`; its payload is dropped (digest and byte count stay as the record), any unused outbound approval for it is spent, and it can never be dispatched. Your own sends, or anyone's for the owner and cofounder. A sent request answers `ALREADY_SENT`. Audit `model.outbound.discarded`. |
| Monthly model cap enforced (TR-08) | supported | The cap set with `trustx.setModelCap` is read through `registerMonthlyCap` and checked inside the gateway's reservation transaction, across every route: `spent + this call's reservation <= cap`, else `MONTHLY_CAP_REACHED`, nothing sent, approval unspent. The month's spend is kept in this lane's namespace (`spend: { month, spentMinor }`), started from the receipts the first time, so receipt retention never forgets money already spent. The month runs in `state.workspace.timeZone`, India time by default. Measured costs above the reservation are added. `models.capStatus` reports it. |
| "Decide" purpose (jobs-ext deciding agent) | supported (synthetic provider) / experimental live | In-process only: `gateway.previewDecision(ctx, { question, options, routeId, sourceIds, case })` then `models.approve`, then `gateway.executeDecision(ctx, { previewId, approvalId })`. The schema allows only `decision ∈ options` and `confidence ∈ [0,1]`; anything else is `DECISION_NOT_OFFERED` / `INVALID_DECISION` and the receipt fails. Shape sends case field names and kinds; samples send values. Always owner-approved. The RPC `models.test` cannot run a decision (no validator). |
| Bench selectors from fixtures | supported | In-process only: `gateway.preview(ctx, request, { fixtureSelectors: { branches, customerIds } })`. Allowed only for an analysis plan with no sources and no facts; any fixture value that matches a branch or customer id in the workspace is refused (`FIXTURE_SELECTOR_COLLIDES`). The receipt says `selectorOrigin: 'fixture'`. Under `send: 'shape'` the question is still reduced to safe words, so branch questions need `samples` to name the branch. |
| `models.setLadder` (FR-05, TR-08) | supported | The order routes are listed and tried by default. Survives reconfiguring a route. Never an automatic switch. |
| `models.probe` and route states (SH-09, FR-05) | supported (fake ports) / experimental against real CLIs | States: `ready`, `ready-unverified`, `signed-out`, `not-installed`, `version-not-tested`, `timed-out`, `error`, `off`, `skipped-send-nothing`, `demo-disabled`. A shallow probe looks only on this computer (PATH, keys held, last dispatch). A deep probe (owner/cofounder, in the app) runs the CLI's own `--version` and Codex's `login status` (exit code only) and asks a loopback Ollama for its models. It never contacts a paid provider, never retries, never reads a subscription token. |

### 2. Canary coverage (supported)

`guardOutbound(store, ctx, { channel, receiptId, endpoint, payload })` in `plugins.ts` runs every registered outbound check (`runOutboundChecks` in `gateway.ts`; trust-ext's `blockLeak` stops the planted canary, GSTINs, mail addresses and phone numbers from the books with `CANARY_BLOCKED`). It now guards:

- plugin network calls (`smallapps/plugin-methods.ts` `callRemote`): the exact arguments and URLs, before the single-use approval is spent;
- the learning upload (`learning-ext/sharing.ts`): the exact batch body; a block settles the batch as refused with `CANARY_BLOCKED`;
- the hosted allowance client (`hosted-link/service.ts` `AllowanceRouteClient`): the exact JSON body, through an optional `guard`.

### 3. Second ask (supported)

- Core money actions: the core `ActionService` is built with a money gate. `actions.approve` of a `money` action needs a single-use grant from `secondAsk.grant` (5 minutes, bound to workspace, member, epoch, role, action id and exact digest; in memory only), else `SECOND_ASK_REQUIRED`. Other ActionService instances (writeback, invoice follow-up, connector-framework write, journal execution) keep their own rules. Phone and tainted contexts are refused as before; autonomy cannot obtain a grant (it needs a typed secret in the app).
- The work-books approvals queue answers it: for a core money action `approvals.approve` takes `reauth` and calls `secondAsk.grant` first.
- Per-member approval secrets: a cofounder sets their own secret (`secondAsk.setSecret`); the owner always uses the vault passphrase. scrypt hashes (N=2^15) in this lane's namespace, bound to the member's epoch. 5 wrong tries lock that member for 15 minutes (`SECOND_ASK_LOCKED`), counted before the answer.
- `auth.verifyApprovalSecret` for writeback (coordinator's contract), so a cofounder can answer writeback's second ask in place of `REAUTH_OWNER_ONLY`.

### 4. PIN quick unlock (supported with the file store; experimental with the OS keychain)

- `pin.set { pin, passphrase }` (owner, in the app) wraps the vault key with a key from scrypt(PIN) and HKDF with a 32-byte device secret from the secret store, AES-GCM bound to the vault id and folder. The record is `<appDir>/pin-unlock/<folder>.json` on this device only; the PIN is never stored.
- `workspace.open { unlock: 'pin', pin, folder? }` unlocks (trusted local desktop owner only). A wrong PIN is the generic `UNLOCK_FAILED`.
- After the 3rd wrong try there is a wait (30 s, then 60 s; `PIN_WAIT`, time in `pin.status.waitUntil`). After 5 the wrapped key is erased and only the passphrase unlocks (`disabledReason: 'too-many-tries'`). A right PIN resets the count.
- The record is dropped when the vault is deleted, recovered or its passphrase changes.

### 5. Secret store (supported with the file fallback; experimental with the OS keychain)

- `secretCustody` holds each store's 32-byte key only while a workspace is unlocked (SH-02: keys and connector tokens usable only while unlocked). With a native keychain provider (`EngineOptions.keychain`), a store's key lives in the keychain under a random UUID (`.keychain-id`); otherwise the `.key` file is used as before. An existing `.key` migrates into the keychain on open. Once enrolled, a store never falls back to a file key (`SECRET_STORE_LOCKED`, `KEYCHAIN_UNAVAILABLE`).
- `ConnectorCredentialStore` (connectors-ext; also used by writeback and hosted-link) takes its key from custody, so connector and writeback credentials use it.
- `SecretStore` (sealed named secrets under `<appDir>/secrets`) holds this lane's device secret.

### 6. `network.online` (supported)

Before and after unlock. Decided from the network interfaces only; nothing leaves the machine.

## Round 4 contracts

All RPC methods are module methods; desktop-only unless stated (module methods refuse phone callers).

| Method | Permission | Request | Reply |
|---|---|---|---|
| `models.setLadder` | admin, untainted | `{ order: string[] }` (each route once) | `models.list` rows, in the new order |
| `models.discard` | prepare | `{ id: string }` | `{ id, status: 'discarded', discardedAt, digest, payloadBytes: number \| null }` |
| `models.capStatus` | read | `{}` | `{ month: 'YYYY-MM', timeZone, enforced: true, monthlyCapMinor: string \| null, spentMinor: string \| null, remainingMinor: string \| null, reached: boolean }` (amounts null below owner/cofounder) |
| `models.probe` | read (`deep` needs admin, in the app) | `{ routeId?: string, deep?: boolean }` | `{ send, routes: [{ routeId, kind, label, order, state, reason, version: string \| null, signIn: { kind: 'cli', command } \| { kind: 'key' } \| null, lastFailure: { code, at } \| null, checkedAt, deep }] }` |
| `secondAsk.grant` | approve, untainted | `{ target: { kind: 'action', id, digest }, secret }` | `{ granted: true, expiresAt }` |
| `secondAsk.setSecret` | approve, untainted, not owner | `{ secret (10–1024), current? }` | `{ set: true, at }` |
| `secondAsk.clearSecret` | admin, untainted | `{ memberId }` (owner: anyone; cofounder: self) | `{ cleared: boolean }` |
| `secondAsk.status` | read | `{}` | `{ by: 'passphrase' \| 'member-secret' \| 'none', secretSet: boolean, lockedUntil: string \| null }` (caller only) |
| `auth.verifyApprovalSecret` | approve, untainted | `{ secret }` | `{ verified: boolean }` |
| `pin.set` | admin, owner, untainted | `{ pin: '6–12 digits', passphrase }` | `pin.status` shape |
| `pin.clear` | admin, owner, untainted | `{}` | `pin.status` shape |
| `pin.status` | read, preVault | `{ folder?: string }` | `{ enabled, failuresLeft: number \| null, waitUntil: string \| null, disabledReason: 'too-many-tries' \| null, deviceBound: 'keychain' \| 'file' }` |
| `secrets.status` | admin | `{}` | `{ backing: 'keychain' \| 'file', unlocked, stores: [{ name: 'connector-credentials' \| 'secrets', backing, present, available }] }` |
| `network.online` | read, preVault | `{}` | `{ online: boolean \| null, basis: 'interfaces', checkedAt }` |
| `workspace.open` (core, extended) | trusted desktop owner | `{ unlock: 'pin', pin, folder? }` | `{ workspace }` |

In-process contracts:

- jobs-ext: `host.services.gateway.previewDecision(ctx, { question, options: string[2..12, /^[a-z][a-z0-9-]{0,39}$/], routeId, sourceIds, case: Record<string, string|number|boolean|null> })` → model-preview with `purpose: 'decide'`, `options`, `approvalRequired: true`; approve with `models.approve { id }`; then `host.services.gateway.executeDecision(ctx, { previewId, approvalId })` → `{ kind: 'decision', decision, confidence, receipt }`.
- models-ext bench: `host.services.gateway.preview(ctx, { question, routeId, sourceIds: [], purpose: 'analysis' }, { fixtureSelectors: { branches: string[], customerIds: string[] } })`.
- writeback: `verifySecondAskSecret(store, ctx, secret): Promise<boolean>` in `gateway-auth/second-ask.ts`, or `host.call('auth.verifyApprovalSecret', { secret })`.
- Any lane sending data out: `guardOutbound(store, ctx, { channel: 'plugin' | 'learning' | 'allowance', receiptId, endpoint, payload })` in `plugins.ts`.
- Gateway: `registerMonthlyCap(reader: (state) => string | null)`; `monthlySpend(state)`, `capMonth(state)`.

## Core edits

- `platform/runtime/gateway.ts`: the monthly cap (reader registry, spend ledger, check and spend in `execute`'s reservation), the decide purpose (`previewDecision`, `executeDecision`, shared `#previewStructured` behind `previewTask`), the trusted `fixtureSelectors` argument of `preview`, `setLadder`, `discard`, ladder-preserving `configureRoute`, `runOutboundChecks`. Owned by this lane.
- `platform/runtime/actions.ts`: optional `secondAsk` money gate (constructor option and one call in `approve`). Owned.
- `platform/runtime/vault.ts`: `registerKeyWithPassphrase` and `passphraseBinding`. Owned.
- `platform/runtime/plugins.ts`: `guardOutbound`, `UNATTRIBUTED_OUTBOUND`. Owned.
- `platform/runtime/engine.ts` (fenced `core-gateway-auth`): imports; `attach()` ends by opening secret custody; `closeVault()` starts by closing it; `workspace.open` accepts `unlock: 'pin'`; the core `ActionService` gets the money gate. These are needed because PIN unlock and secret custody follow the vault's lifecycle, which only the engine sees.
- `platform/runtime/connectors-ext/credentials.ts` (connectors-ext): `#key` asks custody first (one line + import), so connector and writeback credentials use the keychain-backed store.
- `platform/runtime/smallapps/plugin-methods.ts` (models-ext), `learning-ext/sharing.ts`, `hosted-link/service.ts`: the canary guard at each outbound call (a few lines each).
- `platform/runtime/work-books/work.ts` (work-books): `approveOne` answers a core money second ask through `secondAsk.grant`.
- `platform/tests/demo-data-isolation.test.ts`, `demo-provider-isolation.test.ts`: these run engine.ts in a VM with a fixed list of globals; the new imported names were added.
- `app/desktop/preload.cjs` (this lane's `laneRefusals` line) and the synced `app/ui/src/bridge/client.ts`.

## Cross-lane assumptions

- The cap enforced is the one reports-tools-trust stores at `extensions['reports-tools-trust'].tools.modelCap`. Its `modelsView` still returns `capEnforced: false`; it should switch to `true` (or read `models.capStatus`).
- jobs-ext adopts `previewDecision`/`executeDecision` for its deciding agent; models-ext passes `fixtureSelectors` from its open bench in `bench/live.ts` (its `notLive` rule can then drop the branch/customer refusal).
- work-books adds a `secondAsk.by: 'passphrase'` hint to the sheet of a core money action (the engine side is done).
- writeback switches to `auth.verifyApprovalSecret` to accept a cofounder's secret.
- frame-today draws `pin.status`/`pin.set`/PIN unlock, `network.online`, and the SH-09 states from `models.probe`; reports-tools-trust draws the ladder, `capStatus`, `secondAsk.*` settings and `models.discard` on the network ledger.
- The desktop bridge passes `workspace.open` payloads through, so `unlock: 'pin'` needs no IPC change.

## Still missing / needs the founder

- **The native keychain helper is not compiled or signed** (`platform/native/keychain`, release lane). Keychain mode is tested only with an in-memory provider; `deviceBound` is `file` in practice until the signed helper and manifest ship. Founder: signing certificate and a real Windows/macOS machine.
- **PIN with the file store:** the device secret sits under a file key next to the PIN record, so someone who can read the user's files can try PINs offline; the attempt counter is a file and protects only at the lock screen. With the OS keychain this improves; a hardware-bound key (TPM, Secure Enclave) would be needed to close it.
- **Probes against real CLIs and Ollama** were run only through injected ports.
- **The decide purpose and the cap** have not run against a live paid provider (needs a paid key).
- Spend before this lane was installed is counted from retained receipts only; receipts older than retention are not counted.
