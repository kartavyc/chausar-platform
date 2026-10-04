# First-run host handoff on backend 52d1226f

This is a source-only independent FR-06 / FR-08 slice. Backend pin: `52d1226f0eac6bfd18d7b68074b44b2d42a33bc0`, tree `ca85c98e1ac5ec30e10674fe67eb892b7f2f0daf`. The original UI source `da7da1a39116ed263d47498ed6740d863652b81c` and qualified correction `82e0045dd17e69e70c9879e807257bc79395e81d` were cherry-picked without conflicts as `add5204da39ed664d4d47a4e47eb2332ba3244b2` and `0eb8edc6a3670b7745bcd2c92ee775725f003c65`. No main change or native/full-product acceptance is implied.

## Creation and mount

The parent creates an explicit new first-run workspace through actual `workspace.create({name, passphrase, dictionaryMode:'deferred', demo:false, ...allowedHostFields})`. Omit `pack` and `demoFixtureMonth` entirely; own undefined values also refuse. Omitted `dictionaryMode` remains legacy and immediately publishes a starter. Deferred mode writes encrypted revision zero with `{current:null,history:[],firstRunReviewRequired:true}`; ordinary reopen preserves it. The slice never calls creation.

Gate first-run after trusted context and ontology read, before `app/ui/src/host/controller.ts` refresh eagerly calls billed/received/margin dashboard methods and before `bootstrap.tsx` unconditionally navigates Today. The current known route list lacks first-run. Register and mount the slice outside Frame's existing main: FirstRunScreen owns its main landmark. Shared bootstrap/router/renderer/desktop changes belong to the main UI integration task.

Supply one controller retained for host lifetime, `FirstRunPort` restricted to `ui.context`, `ontology.packs`, `ontology.get`, `ontology.publish`, and a synchronous current unlocked live-surface guard. Bind the trusted raw mutation-aware transport. Ordinary host guardedRequest requires the old contextKey after every request and rejects intentional publication changes. Provide controlled English/Hindi, existing simple/guided/books view, root data-view/theme, honest stagesDone, callbacks/destinations. Do not certify previous steps from this slice alone.

Cancel on navigation/unmount, invalidate on lock/revocation, and retain the private pending attempt across remount/disposal refusal. Subscribe to onIssuance so Today and Saved become possibly stale even when publication's response is lost or the user departs. Continue's opaque Admission is one-shot; call admit immediately before the callback and make the final host authority check before navigation. No await belongs between admission and the intent.

## Exact four-method protocol

| Method | Payload | Result |
| --- | --- | --- |
| ui.context | `{}` | Existing trusted workspace/member/role/epoch/contextKey DTO |
| ontology.packs | `{}` | Actual six DictionaryDraft values in Engine order |
| ontology.get | `{}` | Exactly `{current,history}` |
| ontology.get | `{attemptId}` | Exactly `{current,history,attempt}`; attempt is null or the exact receipt |
| ontology.publish | `{draft,expectedCurrentHash,attemptId}` | Actual compiled Dictionary, not a receipt |

Receipt fields are exactly `attemptId,workspaceId,memberId,epoch,draftDigest,expectedCurrentHash,dictionaryHash,version`. Digest is SHA-256 over exact UTF-8 `JSON.stringify(structuredClone(draft))`, preserving authored key order. Preserve the complete frozen reviewed draft in the payload. New durable IDs use crypto.randomUUID once at issuance; deterministic test injection does not change production generation.

`attempt:null` remains unknown, including unchanged baseline, because a queued accepted publication may subsequently commit. There is no automatic retry or cancellation RPC. Exact receipt plus unique fully verified history Dictionary proves that attempt committed. Historical proof does not make a newer current dictionary eligible for Continue. Wrong actor/epoch/workspace, changed exact digest/baseline, malformed receipt, unverified history and stale context refuse.

## Sanitized bridge gate

Both `app/desktop/preload.cjs` refusalCodes and `app/ui/src/bridge/client.ts` desktopRefusalCodes omit all fourteen first-run dictionary codes:

`INVALID_DICTIONARY`, `INVALID_CURRENCY`, `INVALID_GST_MODE`, `INVALID_FIELD`, `INVALID_DEFINITION`, `RESERVED_MEASURE`, `UNKNOWN_PACK`, `COMPILED_SUM_INVALID`, `INVALID_DICTIONARY_OPTIONS`, `INVALID_DICTIONARY_RECEIPT`, `DICTIONARY_REVIEW_REQUIRED`, `DICTIONARY_CONFLICT`, `DICTIONARY_ATTEMPT_REUSED`, `DICTIONARY_ATTEMPT_AUTHORITY`.

The IPC ontology method allowlist and uppercase publicError admit these already. Preload and renderer independently collapse them to REQUEST_FAILED. Add the same explicit known safe codes to both shared closed lists; keep messages/details sanitized. The parent-owned creation path additionally needs `INVALID_DICTIONARY_MODE`. Actual direct Engine-port tests do not qualify this desktop propagation. With the present shared lists, generic REQUEST_FAILED correctly retains publication uncertainty.

## Retained v2 and pending configuration

Use the composed retained-v2 backend. Original publication receipts remain inert origin evidence; inherited IDs cannot authorize a fresh owner's replay. Do not rewrite, strip or coerce receipt namespaces/profile pins. Ordinary deferred creation/reopen/review is supported. Fresh-owner activation of an unpublished deferred source intentionally refuses ACTIVATION_DICTIONARY pending an explicit provisioning policy.

Calendar, business timezone, ordering and exact customizable pack-specific Today metrics remain not-configured. No UTC, chart presets, metric or accounting policy is inferred. Exact Simple/Books first-run geometry and FR-06 image remain absent from retained references. Native Hindi/font/wrapping/zoom/screen-reader/pixel fidelity and full-product journeys remain unqualified.

## Current strict blocker

The strict root compile against backend 52d1226f (library checks on, original include set) reports four ontology.ts errors at 47:59, 137:47 and 257:42/58, plus three PostgreSQL native-probe fixture errors at 4:60, 106:40 and 116:10. The first fixture error is unavailable `pg` types in existing permitted dependencies. No backend repair, package acquisition, exclusion or relaxed compiler flag belongs to this slice. Preserve these as current blockers until a delivered backend repair and fresh strict root run resolve them. The old six demo VM failures are historical; 52d1226f repairs their two fixture bindings, and the selected 84-case synthetic source batch now passes.
