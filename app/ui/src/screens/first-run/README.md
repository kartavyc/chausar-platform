# FR-06 / FR-08 independent first-run slice

Source and tests are confined to this folder and app/ui/tests/first-run, apart from the separately authorized scoped catalogue checker correction in scripts/check-ui-source.mjs and inventory LF rule in app/ui/.gitattributes. The original frozen Engine parent is 5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd. Original private checkpoint da7da1a39116ed263d47498ed6740d863652b81c and qualified correction 82e0045dd17e69e70c9879e807257bc79395e81d remain intact. Their source was cherry-picked without conflicts into this independent checkout on backend 52d1226f0eac6bfd18d7b68074b44b2d42a33bc0. The new controller joins that backend's CAS and durable attempt API. This lane does not register a route or modify host, Engine, desktop adapter, Saved or Today. It mounts only through parent integration.

Actual installed Claude Code 2.1.286 authored the initial UI/controller/tests using claude-fable-5-1, explicit high effort and Fast off. Completed author streams and an interrupted subsequent correction, including its partial source edits, were retained. The user then explicitly authorized Codex 6.1 Sol Ultra to finish corrections, qualification and this backend join. The isolated Claude writer was verified closed before that takeover. No new Claude call, Opus request, alternative Claude author, paid fallback, endpoint/auth/proxy or global setting change occurred in this join. Original nonsecret authorship/config metadata remains unchanged; raw author streams remain outside the source checkpoint.

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
| ontology.get | {} | exactly { current: Dictionary or null, history: Dictionary[] } |
| ontology.get | { attemptId } | exactly { current, history, attempt: DictionaryPublicationReceipt or null } |
| ontology.publish | { draft, expectedCurrentHash, attemptId } | Compiled Dictionary with version, actor, operations, artifacts, checks and hash |

The desktop ontology allowlist already exists, but shared registration/type/error mapping and a trusted mutation-aware port belong to parent integration. Ordinary host/controller.ts guardedRequest checks its old contextKey after a call; successful publication changes that key, so it cannot carry this mutation unchanged. Restrict the dedicated port to FIRST_RUN_METHODS. Verified self-hashes establish content consistency, not authenticated transport.

Owner/cofounder may publish; accountant/viewer receive read-only state after context without pack reads. The Engine rechecks admin within the update. Current/history may contain a bounded custom pack identity; only starter choice is limited to six.

## Pins, refusal and publication uncertainty

Review SHA-256 is over UTF-8 JSON.stringify of the exact frozen draft, preserving authored key order. Acceptance pins definition/settings JSON; controls name their rendered generation/revision/digest. Stale controls, changed pack, lock, context or authority refuse. A raw publication is issued only after rehash, fresh context and a final synchronous guard/state/role check. Repeated clicks dispatch once. The request includes the reviewed current hash, or explicit null for an unpublished deferred workspace, and a new durable opaque attempt ID from crypto.randomUUID. createAttemptId is injectable for deterministic synthetic tests; a review-generation ID is never used as durable identity.

The returned Dictionary must match the reviewed draft, expected next version and actor. Its full hash is recomputed over content excluding hash, preserving authored order. Each compiled artifact binds the exact definition/operation and hashes fields in the Engine compiler's fixed order; reordered wire fields with a forged wire-order digest are refused. The scoped readback must include its own attempt field. An exact receipt has only attemptId, workspaceId, memberId, epoch, draftDigest, expectedCurrentHash, dictionaryHash and version. Every field must match the private issued scope, and one exact verified history Dictionary must bind the receipt. The current snapshot and stable context are separately checked before handoff.

An issued attempt remains privately pinned across cancellation/unmount and failed replies; public state hides review/identity data on authority loss. There is no automatic retry. Unknown publication blocks new loads, pack selection, edits, Publish, Continue and disposal until trusted reconciliation. dispose refuses while issued/unresolved, and seals before notifying observers otherwise.

An exact scoped receipt can attribute an issued publication after a lost reply, including when its Dictionary is now historical. Matching bytes/version/actor alone remains insufficient. attempt:null remains unknown even if current equals the reviewed baseline: an accepted queued request can still commit. No lookup failure, malformed reply or generic transport/storage failure proves non-publication. Trusted declared precommit refusal codes may settle a refused attempt; the shared sanitized bridge must preserve those codes. There is no automatic retry.

A receipt proving a historical commit does not authorize Continue for a superseded dictionary. The private attempt can resolve, while REVIEW_NOT_CURRENT keeps that handoff unavailable. Current dictionary, authority and live guard are fenced again at one-shot admission. The backend serializes the reviewed current-hash comparison and durable receipt with publication; identical replay of the same ID/draft/baseline returns the original Dictionary without a new write. No cancellation RPC exists, so departure never infers that queued publication stopped.

## Parent integration gates

1. Register the mount and dedicated trusted transport in shared host/bootstrap/router/desktop code.
2. Retain the controller/private attempt across remounts; invalidate on lock/revocation, cancel on departure, and do not dispose while pinned.
3. Subscribe to onIssuance. Treat Today and Saved as possibly stale from issued, even across departure or a lost reply; refresh under the resolved context. Engine publication marks all answers and receipts stale.
4. The parent owns fresh workspace.create. Explicit first-run creation must pass dictionaryMode: 'deferred' and demo: false (or omit demo), while omitting pack and demoFixtureMonth entirely, including own undefined properties. Deferred creation retains an unpublished encrypted revision zero and review marker through reopen. Omitted dictionaryMode remains the legacy immediate-publication path. This slice never creates a workspace.
5. Preserve all four pending configuration fields; exact Today metrics/calendar/ordering/time-zone choices are still needed.
6. Provide destinations/callbacks, language/view and stage certification without claiming unowned steps complete.
7. Gate first-run after trusted ui.context and ontology.get, before host/controller.ts refresh issues billed/received/margin dashboard calls and before bootstrap's unconditional Today navigation. Mount outside Frame's main landmark. Shared route/bootstrap wiring remains parent-owned.
8. Preserve explicitly declared dictionary validation, CAS, review, attempt and receipt refusal codes in app/desktop/preload.cjs and app/ui/src/bridge/client.ts sanitized closed allowlists. They currently omit those codes. Without that parent change the controller correctly treats REQUEST_FAILED as unknown. Do not expose raw error messages/details.
9. Use the composed retained-v2 backend without rewriting receipts or profile pins. Inherited IDs remain inert original-workspace evidence and cannot authorize a fresh owner. Ordinary deferred create/reopen/review works; fresh-owner activation of an unpublished deferred source deliberately refuses ACTIVATION_DICTIONARY pending provisioning policy.

## Verification and reference limits

Only source review and code/React synthetic tests are authorized. Existing rendering/compiler fixtures use the actual Engine starterPacks, compileDictionary and assertCompiledSingleSum through a checked runtime boundary; independent digests use Node SHA-256. New engine-join fixtures forward the actual Engine.requestAs API against bounded synthetic temporary encrypted experimental-file Vaults. They do not launch native/browser/Electron/PostgreSQL, services or providers, acquire packages, inspect credentials or use business data. Direct Engine-port tests do not qualify the shared sanitized desktop bridge.

Run from the checkout with the existing read-only dependency junction:

    node ./node_modules/typescript/bin/tsc --noEmit --project app/ui/tsconfig.json --skipLibCheck false
    node ./node_modules/typescript/bin/tsc --noEmit --project app/ui/tests/first-run/tsconfig.json --skipLibCheck false
    node ./node_modules/typescript/bin/tsc --noEmit --project tsconfig.json --skipLibCheck false --incremental false
    node --test app/ui/tests/first-run/contracts.test.ts app/ui/tests/first-run/review.test.ts app/ui/tests/first-run/controller.test.ts
    node --test app/ui/tests/first-run/engine-join.test.ts
    node ./node_modules/vitest/vitest.mjs run --config ./app/ui/tests/first-run/vitest.config.mjs --configLoader native

Strict production settings are unchanged; library checking is explicitly on. The native config loader avoids writing a Vite config cache into read-only node_modules; the slice-owned .vite cache is excluded from publication. Current backend join results and limitations are in tests/first-run/evidence/backend-join/qualification.md. Original checkpoint.md and corrections/qualification.md, including original failures, remain unchanged as historical evidence. The initial strict root compile on 52d1226f reports four ontology.ts type errors and three PostgreSQL probe-fixture errors (including unavailable pg types); current qualification must report them unless a delivered backend repair and fresh strict compile resolve them. No acquisition or relaxed compiler setting is permitted.

Visible-copy checks include textarea values and open disclosures, exact meaning/provenance, both languages, six packs and all views, with 90/120/170 main-word ceilings and 22-code-point action labels. Synthetic bounded edited prose is qualified; arbitrary user prose is preserved exactly and cannot have a fixed word-budget guarantee. Closed previews are exact first words: Simple 1, Guided 2, Books 3. The full current text and original Engine proposal remain in the existing disclosure; authored meanings are unchanged. The separately authorized Codex correction compacts bounded surrounding labels to restore the required nonempty Simple preview within its 90-word ceiling.

The retained screens/build/design and exact repository screen inventory are the source of truth. FR-06 has approved row/copy text but no dedicated image. FR-08 has S09 light/dark; dedicated Simple/Books first-run geometry is absent. No pixel-fidelity claim is made. Native Hindi review, fonts/wrapping/zoom, contrast, screen-reader/browser/native execution and real-data journeys remain unqualified. text/banned.txt is absent.

The source checker validates shared catalogues as before and grants the first-run layer only to Button nodes reached through the verified FirstRunText provider/component boundary. Other sources, unreachable components and explicit reading-fixture IDs retain shared lookup. Removed or misplaced providers, missing local messages and local IDs outside that boundary remain failures. This is a conservative check of the current first-run provider contract; a future provider or component change needs its own scope qualification. Existing static/runtime limitations remain reported.

The design-screen inventory is restored byte-for-byte from the immutable frozen LF Git blob, without changing its content, generator or ten existing tests. app/ui/.gitattributes scopes text eol=lf only to that inventory. New temporary-fixture tests prove CRLF JSON/normalized-byte equivalence while the unchanged raw-byte checker still rejects CRLF and a semantic mutation. Set UI_DESIGN_INPUTS to the retained original four-document directory when running inventory tests. No global Git setting was changed.

## The whole first run as a journey (frame-today)

`FirstRunJourney` (FirstRunJourney.tsx) draws the six steps in the shared `patterns/FirstRunStep` frame: FR-01 Welcome, FR-02 identity card and GST mode, FR-03 vault, FR-04 recovery kit, FR-05 model route, FR-07 bring a file, FR-06/FR-08 this slice (through `FirstRunTask`, unchanged), FR-09 first answer with its receipt, FR-11/FR-12 for an idea (`Idea.tsx`: the owner's statements as typed on `todayx.idea.*`, the draft beside them in `patterns/TwoSides`, no model), FR-13 open with the recovery kit. After a CSV file, `ProposedMeanings.tsx` draws learning-ext's "Proposed meanings (draft)" through the `proposals.ts` adapter; nothing is accepted there. `journey.ts` is the pure state machine; `journey-contracts.ts` names every engine method and validates every reply. Before the vault exists nothing is read from or written to the engine except the optional format check; after it, `todayx.firstRun.status` is the record of what is done. A missing method shows "not built yet" for that step. The engine reads a file only against published meanings, so a file refused with `DICTIONARY_REQUIRED` is held and read right after the meanings are agreed. Words are the `FR.journey.*` and `FR-01.*`..`FR-13.*` keys of this folder's catalogue (button labels end in `.btn`); the frame's blocked and left lines are the shared `FRSTEP.*` keys. Tests: app/ui/tests/frame-today-first-run-journey.test.ts, frontend-validation/tests/frame-today-first-run-journey.test.tsx and frontend-validation/tests/frame-today-idea.test.tsx.
