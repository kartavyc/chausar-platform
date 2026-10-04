# Independent sealed first-run Engine and lifecycle review

The reviewed final slice has no remaining functional finding in this bounded read-only audit. Earlier findings in `first-run-engine-audit-notes.md`, `first-run-engine-audit-v2-notes.md` and `first-run-final-engine-review-notes.md` are historical; their unsafe paths were retested against the final sources below. Initial source authoring was Fable; the final controller and Meanings corrections were completed after the user's explicit Codex fallback authorization. This reviewer did not author or edit product source, invoke Claude, or change any shared file.

Only synthetic Node and real React/jsdom source checks ran. No browser/native process, services, package/network acquisition, credentials, settings or business data were used. Runtime transpilation in the DOM harness is not a type check. Root owns final strict TypeScript and the full authored test qualification.

## Final source pins

All before/after pins match in the final runs. The final assertions also rehashed the current sources and checked equality with the DOM run pins.

| Source | SHA-256 |
| --- | --- |
| controller.ts | 5c7ea2805ada038d0324bf856442d7fa3b1f7d005740e7ebf94c71d3bddbfb2f |
| contracts.ts | 6889eef84789c91f5b60a5918f1505ecc1cc3548e0b827d628c7e1f331afed66 |
| digest.ts | 5530d7d788d2f6f1d7d8e6ab3e0b81c19b605c5ce91af472ee6c47f765face27 |
| review.ts | d20a0e32b457cf99e744bb7a85bf67fbb6ee5d76db34c8ee3ad3dc1d7bc90069 |
| FirstRun.tsx | bdff78fdd2d4c29632de7ec91bfc20206b8caca898bb539f41e2207e6ccb45d9 |
| Meanings.tsx | 40f81e46fd3005bc1a6703ab466d1d9cc4939a67c484cddd0ed9e233c4a0aba6 |
| text/en.json | 8ac4a43ad7755e9af7adbb632bb841aa758b62440773bcf7bb04fa1335f574ab |
| text/hi.json | 115a118736fa757315dad30f476259101692b1dc0e858840c3b3e160c6c34eaa |

Remaining imported UI pins are retained in `first-run-sealed-terminal-dom-review-results.json` and `first-run-sealed-review-assertions-results.json`.

## Reproducible independent results

Each script and result is outside the repository in this verification directory.

- `first-run-sealed-controller-review.mjs` / `first-run-sealed-controller-review-results.json`: **17 controller cases**. The original persisted result had16; the added17th case is `settings-queued-lock-before-delayed-admission`. The harness originally printed the added case without persisting its result; persistence was corrected and the final17-case result was rerun.
- `first-run-sealed-terminal-dom-review.cjs` / `first-run-sealed-terminal-dom-review-results.json`: **21 actual connected React DOM scenarios**, including old controls clicked before React rerenders.
- `first-run-sealed-remount-dom-review.cjs` / `first-run-sealed-remount-dom-review-results.json`: **2 actual React lifecycle scenarios**: StrictMode effect replay and immediate same-controller keyed remount with the original context read held.
- `first-run-sealed-compiler-order-review.mjs` / `first-run-sealed-compiler-order-review-results.json`: **6 genuine Engine dictionaries and42 compiled sums**, fixed-order proof checks and a hostile accessor DTO case.
- `first-run-review-digest-live-repro.mjs` / `first-run-sealed-review-digest-live-results.json`: held background review digest completion after the live guard died leaves a neutral unavailable state.
- `first-run-sealed-review-assertions.mjs` / `first-run-sealed-review-assertions-results.json`: exit0, explicit expected-result assertions over the17/21/2 cases and compiler checks, plus current source pin verification.

The final terminal and remount reruns include the final two-word locale correction. Controller behavior and SHA did not change for that correction.

## Confirmed behavior

An identical new publication by the same seat after this attempt loses its raw reply remains `PUBLISH_UNATTRIBUTED`, rather than being adopted as this attempt's success. A verified own raw reply is retained privately across departure, then can be recovered by an authorized exact readback. An issued observer sees dispatch count1; it cannot cancel a call that has not yet been dispatched. A resolved observer's lock remains the final state. Disposal seals first, so a dispose observer cannot start another read.

Guard loss on normal success, generic failure, Engine refusal, invalid reply, mismatched reply, preflight digest exception and reconcile exception hides all public workspace/member/review/attempt metadata. Member replacement is also neutral. Unknown effects remain pinned privately and cannot be retried or discarded by remount/dispose.

Departure success exposes only `ok` and a one-shot `admit()`. Synchronous LEFT observers that lock, cancel, dispose or kill the guard deliver zero Continue and Settings callbacks. A queued LEFT lock that occurs before async Continue's actual admission also delivers zero. Two valid clicks deliver one callback. Old Continue controls after cancel, lock, dead guard or context replacement deliver zero; Settings controls from an earlier pack revision deliver zero.

**Timing qualification:** the valid Settings callback is synchronous and runs before a LEFT observer's queued microtask. That scenario correctly delivers one callback while state is LEFT, then becomes unavailable after the queue. It is not a post-loss handoff. The separate controller case delays actual Settings ticket consumption until after the queued lock and proves `admit()` then returns null. No callback may be delayed or place another observer/await between successful `admit()` and its parent intent. The controller's broad top-comment statement about queued LEFT loss ending departure before the parent applies directly to async Continue; the synchronous Settings path is governed by the actual admission ordering described here.

Clicking Change and then the retained connected Publish button in the same batch issues zero publications, with the editor present. Both StrictMode replay and immediate retained-controller remount show all6 packs before the original held read releases; that stale read does not alter the fresh choose state. None of these mount/read/Settings scenarios publishes.

The frozen Engine and UI agree on all genuine dictionary proofs. Reordered wire fields retaining the original fixed compiler digest verify in both. A digest recomputed over reversed wire order is rejected by both (Engine `COMPILED_SUM_MISMATCH`). A label accessor in an otherwise exact six-pack DTO is refused without invoking the getter. The draft digest is the exact authored JSON draft, distinct from the full publication hash; compiled artifacts use the compiler's fixed field order.

## Narrow parent mount and Engine contracts

The slice remains unregistered. Parent integration owns host/bootstrap/router/desktop adapter code and all existing Saved/Today work. Export `FirstRunScreen` with one host-lifetime `createFirstRunController`, controlled English/Hindi and FR-01 view, honest earlier-stage completion certification, and explicit parent destinations/callbacks.

The trusted port is restricted to these existing methods (`platform/runtime/engine.ts:1041`, `:1443`, `:1444`, `:1445`):

| Method | Payload | Result |
| --- | --- | --- |
| ui.context | {} | validated workspace/member/epoch/role/contextKey |
| ontology.packs | {} | six authored DictionaryDraft proposals |
| ontology.get | {} | { current: Dictionary or null, history: Dictionary[] } |
| ontology.publish | { draft } | exact compiled Dictionary publication |

Only owner/cofounder may publish; the Engine rechecks admin inside its update (`platform/runtime/ontology.ts:80`). Accountant/viewer gets read-only state before pack reads. Valid bounded custom current/history dictionaries are accepted, while selectable starter IDs remain exactly ecommerce/retail/services/distributor/manufacturing/saas.

The parent guard must synchronously reflect the current first-run surface, writable seat and unlocked vault. Call invalidate on lock/revocation, cancel on departure, and keep the same controller/private attempt across remounts until issuance is none. Unmount cleanup cancels; a parent that leaves this component mounted must cancel explicitly. Disposal while issued/unresolved is refused.

Subscribe to `onIssuance` for the host lifetime, across screen departures. Treat Saved/Today as possibly stale after actual dispatch; retain that invalidation through lost replies and refresh current Engine truth on resolution. The shared host's unchanged-context guarded request cannot carry publication unchanged, since ontology mutation intentionally changes contextKey. A trusted mutation-aware port is required; self-hashes prove content consistency, not transport authentication.

Continue and Settings must consume the admission immediately at the actual parent callback. Parent navigation also has its own final authority boundary. Four handoff fields remain `not-configured`: calendar, timeZone, ordering and todayDefaults (`controller.ts:259`). No UTC, exact metric/chart defaults or accounting policy is invented.

## Remaining integration and qualification gates

1. The frozen Engine has no publication attempt ID, idempotency key, cancellation RPC or current-hash precondition. A change between the final context read and update cannot be prevented by this client. A genuinely lost reply with identical reviewed current bytes may remain unattributed indefinitely; it must not be silently retried or claimed as this attempt's success.
2. `workspace.create` immediately auto-publishes its default (`platform/runtime/engine.ts:959`), with no skip-publication payload. The slice does not call it. Parent/Engine integration must resolve that existing published revision before claiming installed first run's first publication only happens after this review.
3. Parent registration, mutation-aware transport, Saved/Today invalidation, missing calendar/ordering/time-zone/Today choices and owned earlier-stage journeys remain integration work.
4. Root owns strict checks, authored test counts, global source-checker/inventory baseline qualification, final checkpoint SHA, remote identity and private skip-CI publication. This audit makes no native/full-product or exact missing-visual-reference claim.

Source review of the final README confirms these mount and Engine obligations are reported, including mixed authorship, one-shot Admission, explicit review and workspace.create's existing publication behavior.
