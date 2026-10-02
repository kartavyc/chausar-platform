# Local companion Engine and HTTP join

The existing loopback server mounts the committed companion host at the exact
`POST /api/companion/rpc` path, after its Host/Origin/loopback checks and before
desktop token bootstrap. It starts no second listener and accepts no relay or
remote transport. A signed phone credential is distinct from desktop sessions
and cannot authenticate the general desktop RPC route.

The Engine lazily composes `PhoneSessionService` and `EnginePhoneRuntime` for its
actual current Vault. Companion requests participate in the Engine's active
request count, so workspace transitions and shutdown cannot replace authority
during an asynchronous protected read or model request. On reopen the runtime
uses the new Vault instance and resolves its retained sessions, nonce tombstones,
offers and request custody through supported StateStore writes.

An untainted current desktop owner chooses every invite field explicitly through
`phone.invite`: memberId, deviceId, keyId, channel, devicePublicKey, capabilities,
inviteTtlMs and sessionTtlMs. `phone.sessions` returns bounded public metadata;
`phone.revoke` accepts exactly sessionId. Ordinary `auth.sessions` only lists
member-invite and member-session records, excluding phone keys, invites and
private nonce records.

The desktop preload/main-process bridge explicitly allows only these four owner
phone methods. They retain the same owned main-frame and bounded plain-JSON IPC
checks and then pass through the Engine's current owner, epoch and channel checks.
Signed companion pairing and chat are not desktop RPC aliases. The headless
desktop harness test uses the production worker loop and actual synthetic Vault
for invite, session metadata, reviewed offer and revocation; its pairing request
passes through the real companion handler in memory, without a socket, GUI or
live provider.

`phone.conversation.offer` accepts exactly `{sessionId, request}`. Its request is
the complete exact desktop-reviewed conversation request, including its original
previewId, approvalId, route and all source/calculation selectors. The supported
backend permits offers only for that owner's current paired session. A phone
cannot issue its own model disclosure approval or change the reviewed question.
Execution uses `requestAs` with the same current phone Context and the existing
Gateway/conversation boundary. Current review uses the reviewed-preview guard for
preview/completed results and the read-only dispatched guard for dispatching or
failed-after-dispatch results. Scope includes current schema and dictionary
identity; neither a transport retry nor request-status polling dispatches again.

Only one currently guarded retained conversation record linked to the exact model
preview can prove completion. The returned text uses actual guarded calculation
explanations, displayed figures, business descriptions, clarification or explicit
tool refusal text. It returns the real local calculation receipt IDs and never
exposes model request payloads or response wire as a business answer.

Brief reads instantiate the existing JobService against the supplied candidate
StateStore with its actual deliverable guard. They project only retained scoped
owner-brief results: the result's id, canonical persisted deliverable digest,
original completion time, headline, exact report/coverage text, retained alert
observation/episode/uncertainty text and receipt IDs. They do not create or accept
a job, regenerate a report or infer a current breach from historical evidence.
Separate receipt reads use ConversationHistory.currentReceipt with its actual
CalculatorService and managed connector readiness, require stale=false, and
enforce both receipt and fact retention. A brief whose retained alert receipt cannot
meet that separate current receipt read refuses rather than promoting old
arithmetic to a current number.

`approval.*` and `upload.*` remain OPEN_DESKTOP through the existing host. There
is no joined phone action execution, native protected key adapter, Internet relay,
TLS endpoint or live mobile qualification in this source change. The frontend
must inject the documented Ed25519 signing/key provider and pass the exact
per-request optional credential into the signing transcript; CLI login material
is never copied into this interface.

The new `platform/tests/phone-engine-public-join.test.ts` contains four actual
loopback HTTP/Vault synthetic probes: durable proof and metadata isolation;
one reviewed import-to-calculation/receipt with restart reconciliation;
canonical cached brief readback and source withdrawal; and explicit no-offer,
approval/upload and revoked-session refusals. Its provider is an injected authored
fixture and makes no external request. Test execution and strict TypeScript
results must be reported independently from source inspection; these probes do
not qualify a native mobile app or full release.
