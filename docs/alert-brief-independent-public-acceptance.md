# Independent alert-to-brief consumer acceptance

Source base: `b7b41857c7e21595762720413ec3d4e12588ead0`, tree `cdd5ab2c9ebf9b28eb901731c421040d8d49d453`. This isolated slice adds only a new fixture, new test file and this document. Runtime files and all existing fixtures/assertions are unchanged.

The four independently selected public journeys use an actual loopback paired HTTP server, Engine, encrypted experimental-file Vault and new literal synthetic CSV inputs. Each source has its own sale, customer, invoice and order identities; a delivered INR 120 sale must calculate INR 12000 earned/net sales. The fixtures neither import existing acceptance fixtures nor ask the implementation to supply the business expectations.

1. A current private open episode enters the exact-approved source-A owner brief, survives a physical Engine restart with the same saved items/content pin, and is accepted by the exact owner. Acceptance survives a second restart with one acceptance ledger event. Fresh readback does not mutate alert observations, episodes or notices.
2. An actual host-clock-only ten-second receipt expiry leaves the alert revision, observation and open episode unchanged. The cached deliverable is withheld and repeat acceptance refuses without consuming or deleting the run. After restart, a fresh brief truthfully reports uncertain expired evidence even if its requested briefing date is in the past. The bounded expiry wait is at most twelve seconds; no process clock, RPC date or receipt bytes are forged.
3. Current public source-policy withdrawal hides the saved job and prevents acceptance across restart without erasing its retained evidence. A separate cofounder run is then revoked through the actual public member API, advancing its epoch and removing its session. The old session cannot disclose or accept the result, and a workspace owner cannot adopt the other pinned owner's result.
4. Source B has a separately authored condition. A new unavailable B observation changes the unscoped brief while leaving the exact source-A cache and acceptance usable across restart. All retained source-A report receipts exclude B. This detects overbroad cache invalidation as well as accidental scope expansion.

The pre-execution read-only review found the new code joins final detached authority snapshots, private owner/epoch receipts, entire declared alert source scopes, current row and connector consumer/receipt guards, and canonical scope/items pins. The original four HTTP cases cover changed observations, draft/private author filtering, source scope, empty sources and conflicts; their expiry and changed-definition tests operate below the Engine/HTTP boundary. These new cases address distinct public coverage gaps.

Coordinator command from this worktree (Node 24, serial; no package acquisition):

```powershell
& 'C:/Program Files/nodejs/node.exe' --experimental-strip-types --test --test-concurrency=1 platform/tests/alert-brief-additional-independent-public-acceptance.test.ts
```

Status at handoff: **authored, not executed**. The coordinator owns serial execution and joined aggregate checks. Successful checks must be recorded against the actual joined tree; this document does not self-certify them.

Every input/provider boundary is explicitly a synthetic fixture. CSV admission remains experimental. The source/epoch case does not qualify semantic mapping or managed connector readiness withdrawal; a separate actual synthetic managed-capture fixture is still needed for that boundary. No live provider, vendor adapter, model inference, external notification, native database, renderer, installed GUI or whole-product qualification is inferred. No D-drive writes, downloads, account credentials, global configuration changes or existing fixture edits are required.

The revoked-session HTTP expectations use the server boundary code `UNAUTHENTICATED`, not the internal AuthService code `INVALID_SESSION`. The three literal expectations were corrected after the first executed join. Every refusal and retained-state assertion remains; the separate original nine-case fixture is unchanged.
