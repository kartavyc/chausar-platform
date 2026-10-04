# FR-06 / FR-08 independent first-run slice

Source and tests are confined to this folder and app/ui/tests/first-run. The frozen parent is 5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd. This slice does not register a route or modify the host, Engine, desktop adapter, Saved or Today. It mounts only through parent integration.

Actual installed Claude Code 2.1.286 authored the initial UI/controller/tests using claude-fable-5-1, explicit high effort and Fast off. The coordinator retained three completed author calls and an interrupted subsequent correction, including its partial source edits. The user then explicitly authorized Codex 6.1 Sol Ultra to finish corrections and qualification. The isolated Claude writer was verified closed before that takeover. No Opus request, alternative Claude author, paid fallback, endpoint/auth/proxy or global setting change occurred in this lane. Safe execution metadata is in the checkpoint evidence; raw author streams remain outside the source checkpoint.

## Behavior and scope

FR-06 reads six starter packs from the existing Engine in its exact order: ecommerce, retail, services, distributor, manufacturing, saas. Each plain hairline row says it is a draft awaiting review. None is selected or published automatically. The approved Start from a conversation phrase is a real link only when the parent supplies an in-app fragment destination and departure handler.

FR-08 shows six meaning rows and one currency/GST review row in the six-step shell. One row opens at a time. Its exact authored recognition meaning is visible, with Evidence: none yet; the Engine exposes no proposal-evidence API. Accept records the exact reviewed content. Change edits only the plain-language meaning, preserving executable bindings and all other draft fields. The editor contains the current text once; Save resets acceptance and changes the review revision. Every proposed currency/GST setting requires its own acceptance. All six packs currently propose INR and regular GST; those are displayed proposals, not silently adopted assumptions.

Changed text is marked Your words regardless of acceptance. Its original Engine proposal remains inspectable behind Original. Opening Original replaces the current paragraph and hides Accept/Change until the current version returns; the two complete versions are not repeated together. Engine meanings have lang=en; user text makes no language assertion. Changing pack clears decisions and the editor in a new generation.

Publish appears only after all seven decisions have current pins and a digest, with no editor open. A synchronous edit epoch also rejects a retained Publish control clicked before React commits an edit or after that edit ends. Publish requires an explicit click. Reads, selection, acceptance, mount/effects, settings departure and Continue never publish. After an exact validated reply and stable readback, the walking square remains on Meanings; the parent alone advances through Continue.

Calendar, business time zone, ordering and pack-specific Today defaults remain not-configured in the handoff. No UTC, metrics, charts, calendar or accounting policy is inferred.

## Narrow mount

Public exports are in index.ts: FirstRunScreen, createFirstRunController, FirstRunPort, FirstRunIntents, Admission, state/pin types and validators. Supply:

- One controller retained for the entire host lifetime, a trusted four-method port and a synchronous live guard.
- Controlled language en/hi, onLanguage, and the existing FR-01 view simple/guided/books. Apply the existing root data-view and theme in the parent; this slice provides no view selector.
- Honest stagesDone certification of You, Vault, Model and the file part of Your books. Uncertified stages remain unsure.
- Optional intents.startFromConversation { href, onLeave }, onContinue(handoff), and onChangeSettings(draft).

The screen owns a main landmark and must not be nested inside another main. Initial mounting of an idle controller starts a read-only load; unmount calls cancel. Lock/revocation requires invalidate(code), and a parent that navigates while keeping the component mounted must also cancel. Do not replace the controller on remount or discard an issued/uncertain attempt.

Continue calls leave(exactHandoffPin); settings Change calls leaveToSettings(exactReviewRevision). Success is an opaque, one-shot Admission with only ok and admit(). The UI calls admit() immediately before the parent callback, with no intervening await. Admission rechecks the exact departure generation, LEFT state identity, disposal and live guard, including guard reentry. Cancellation, lock or navigation during synchronous LEFT observers or the promise continuation gap returns null. The parent still performs its final host authority check before navigating.

## Existing Engine contracts

| Method | Payload | Result |
| --- | --- | --- |
| ui.context | {} | workspace/member/epoch/role and contextKey, validated against existing host contracts |
| ontology.packs | {} | DictionaryDraft[]: the six starter IDs in Engine order |
| ontology.get | {} | { current: Dictionary or null, history: Dictionary[] } |
| ontology.publish | { draft } | Compiled Dictionary with version, actor, operations, artifacts, checks and hash |

The desktop ontology allowlist already exists, but shared registration/type/error mapping and a trusted mutation-aware port belong to parent integration. Ordinary host/controller.ts guardedRequest checks its old contextKey after a call; successful publication changes that key, so it cannot carry this mutation unchanged. Restrict the dedicated port to FIRST_RUN_METHODS. Verified self-hashes establish content consistency, not authenticated transport.

Owner/cofounder may publish; accountant/viewer receive read-only state after context without pack reads. The Engine rechecks admin within the update. Current/history may contain a bounded custom pack identity; only starter choice is limited to six.

## Pins, refusal and publication uncertainty

Review SHA-256 is over JSON.stringify of the exact frozen draft. Acceptance pins definition/settings JSON; controls name their rendered generation/revision/digest. Stale controls, changed pack, lock, context or authority refuse. A raw publication is issued only after rehash, fresh context and a final synchronous guard/state/role check. Repeated clicks dispatch once.

The returned dictionary must match the reviewed draft, expected next version and actor. Its full hash is recomputed over content excluding hash, preserving authored order. Each compiled artifact binds the exact definition/operation and hashes fields in the Engine compiler's fixed order; reordered wire fields with a forged wire-order digest are refused. The readback must match the validated returned publication exactly, between stable context reads.

An issued attempt remains privately pinned across cancellation/unmount and failed replies; public state hides review/identity data on authority loss. There is no automatic retry. Unknown publication blocks new loads, pack selection, edits, Publish, Continue and disposal until trusted reconciliation. dispose refuses while issued/unresolved, and seals before notifying observers otherwise.

Reconciliation may adopt only the exact privately retained valid returned publication hash with stable readback. Matching reviewed bytes, expected version and actor after a lost reply is insufficient: the same seat can publish identical bytes elsewhere. Such a match remains PUBLISH_UNATTRIBUTED. Baseline/no-commit and superseded verdicts release the attempt without inventing success.

The frozen Engine has no attempt ID, idempotency key, current-hash precondition or cancellation RPC. A concurrent change between the final context read and update cannot be prevented here; post-call checks catch inconsistency, leaving it unresolved. Atomic attribution/compare-and-publish requires separate Engine work.

## Parent integration gates

1. Register the mount and dedicated trusted transport in shared host/bootstrap/router/desktop code.
2. Retain the controller/private attempt across remounts; invalidate on lock/revocation, cancel on departure, and do not dispose while pinned.
3. Subscribe to onIssuance. Treat Today and Saved as possibly stale from issued, even across departure or a lost reply; refresh under the resolved context. Engine publication marks all answers and receipts stale.
4. Resolve workspace.create: at this frozen base it immediately publishes ecommerce, with no skip-publication payload. This slice never calls it. Parent/Engine integration must explicitly present that existing revision or separately change creation before claiming installed first run first publishes only after review.
5. Preserve all four pending configuration fields; exact Today metrics/calendar/ordering/time-zone choices are still needed.
6. Provide destinations/callbacks, language/view and stage certification without claiming unowned steps complete.

## Verification and reference limits

Only source review and code/React synthetic tests are authorized. The test fixture uses the frozen Engine's own starterPacks, compileDictionary and assertCompiledSingleSum through a checked runtime boundary; independent digests use Node SHA-256. It does not start services or use business data.

Run from the checkout with the existing read-only dependency junction:

    node ./node_modules/typescript/bin/tsc --noEmit --project app/ui/tsconfig.json --skipLibCheck false
    node ./node_modules/typescript/bin/tsc --noEmit --project app/ui/tests/first-run/tsconfig.json --skipLibCheck false
    node --test app/ui/tests/first-run/contracts.test.ts app/ui/tests/first-run/review.test.ts app/ui/tests/first-run/controller.test.ts
    node ./node_modules/vitest/vitest.mjs run --config ./app/ui/tests/first-run/vitest.config.mjs --configLoader native

Strict production settings are unchanged; library checking is explicitly on. The native config loader avoids writing a Vite config cache into read-only node_modules; the slice-owned .vite cache is excluded from publication. Final counts, command exits and independent review are in tests/first-run/evidence/checkpoint.md.

Visible-copy checks include textarea values and open disclosures, exact meaning/provenance, both languages, six packs and all views, with 90/120/170 main-word ceilings and 22-code-point action labels. Synthetic bounded edited prose is qualified; arbitrary user prose is preserved exactly and cannot have a fixed word-budget guarantee. Closed previews are exact first words: Simple 0, Guided 2, Books 3. Simple's zero preview remains an explicit reference qualification against the approved closed-row meaning requirement.

The retained screens/build/design and exact repository screen inventory are the source of truth. FR-06 has approved row/copy text but no dedicated image. FR-08 has S09 light/dark; dedicated Simple/Books first-run geometry is absent. No pixel-fidelity claim is made. Native Hindi review, fonts/wrapping/zoom, contrast, screen-reader/browser/native execution and real-data journeys remain unqualified. text/banned.txt is absent.

The unchanged shared source checker resolves only shared catalogues. It reports six button-message-missing findings for owned FR.again, FR-08.changePack and FR-08.reconcile in both languages; their actual layered labels exist and are tested, but the global checker remains a failed parent integration gate. The unrelated frozen inventory byte-regeneration test also has a baseline CRLF discrepancy; no common file or relaxed checker setting was used to hide it.