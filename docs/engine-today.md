# Engine Today composition

`EngineTodayService` assembles the installed Tiles, Attention, Events and persistent Review services over the exact same `StateStore`. It verifies real service identity and store identity. The narrow `authorityStore` getters supply identity only. Missing producers produce explicit unavailable sections. Attention without installed calculator consumer and receipt guards is unavailable.

The trusted constructor requires a synchronous, pure `authorityRevision()` returning a bounded live generation covering **all** installed read authority outside State: connector acquisition/readiness, report execution receipts, durable job release, lesson target/evaluation authorities, calendar adapters, and attention callbacks where installed. The host supplies this port; no public request accepts it. The optional attention selection port has an explicit identity, live revision, and pure selection function. A generated string, fixture callback or permissive guard is not a production fallback. Policy revision callbacks run before the final host generation read. State and current membership are checked after those callbacks too.

The Engine composition installs these real producers after its Actions, Jobs and Learning services are attached. Trusted `EngineOptions.today` carries explicit calendar rules/calendar adapter, selection policy and, when dynamic host ports are installed, a required live `authorityRevision`. It uses explicit Today calendar rules or the already explicitly installed job-calendar rules. It combines host revisions with the real connector runtime's current discovery/readiness generation and checks the installed host configuration identity. An explicit selection policy also requires meaningful live host generation coverage. No IPC caller supplies these constructor options, and static configuration cannot be credited for dynamic callbacks. Engine/domain wiring remains responsible for the host generation bracket and strict method allowlist.

## Requests and explicit preparation

The six methods are `prepareTiles`, `get`, `review`, `resolveReview`, `resolveEvent`, and `resolveAttention`. Engine integration owns their `today.*` dispatch/IPC allowlist. Inputs accept no host ports, raw producer results, URLs, mutation requests or caller authority assertions.

`prepareTiles` requires explicit displayed `date` and named `timeZone`, `configurationId`, `configurationDigest`, `starterPack: { id, dictionaryHash, version }`, and a complete `TodayTilesRequest`. The digest must equal the existing `hash(request)` over that exact JSON request. Starter-pack identity/hash/version must match `OntologyService.current(context).pack/hash/version`, and the request dictionary hash must match that publication. Validation runs before calculation. Configuration is exactly three tiles with at most 120 explicit buckets per tile. Existing Tiles validation checks declared operations, figures, source/branch scope, nonoverlapping buckets and comparison semantics. No periods or chart points are generated.

Published dictionary pack identities and reviewed calendar IDs/entry IDs/version strings are opaque nonblank source identities. They are matched exactly after current lookup, including supported custom dictionary packs. They are not coerced to a new identifier grammar, interpreted as URLs, or treated as arbitrary requests.

Preparation requires current untainted desktop preparation authority. It explicitly calls the installed Tiles `build`, publishing Calculator receipts and activity sequentially. A refused preparation can leave earlier private receipts; this is not an atomic write. Returned configuration includes its exact starter-pack binding and `origin: 'custom'`. No metric/chart default registry has been chosen, so `get` reports `defaults: { state: 'unconfigured', reason: 'pack-defaults-not-configured' }` and the current starter-pack binding, or `null` when no dictionary is published. Republished definitions require a fresh configuration and capture.

`get` takes `{ date, timeZone, tileCapture?: { id, digest } }`. Missing capture produces `capture-required`; missing producer produces `tiles-service-unavailable`. Unknown, changed or differently scoped references refuse with `TODAY_CAPTURE_UNAVAILABLE`. Current source/receipt failures retain their real errors, such as `SOURCE_REVOKED`. Refresh calls no `build`, calculation, update, audit, job, model or business effect.

## Private runtime custody

The runtime retains the original Tiles-issued object and immutable copies of its request/result and receipt proofs. `TodayTilesService.release` accepts only its authentic unchanged issued object in the exact workspace/member/role/epoch/channel/taint context. A serialized or modified result fails `TODAY_TILES_HELD_RESULT_FORBIDDEN`. Callers receive detached copies; changing their figures cannot change custody.

Every release opens **all** current receipts, including comparisons and unavailable/offscreen points, with the installed consumer/receipt guards. Original receipt content, dictionary/definition, figure, requested source scope, periods, knowledge cut and verifier/guard identity must remain exact. Stale evidence refuses. No omitted point or interpolation supplies financial evidence.

Installed calculator readiness/receipt guards are synchronous read assertions. The Engine full-State fence rejects an impure callback that mutates an earlier checked receipt during assembly. Standalone host use of Tiles release requires those pure guards too; its narrower input fingerprint is not a general transaction over arbitrary callback effects.

Elapsed retention is an independent release condition even when State is unchanged. Using actual `Date.now()` and persisted retention policy, release rejects expired or invalid `createdAt` on every receipt and `learnedAt` on every counted **and excluded** referenced fact. Future evidence relative to the clock cut also refuses. The final retention check follows receipt callbacks. Refusal is `TODAY_TILES_RETENTION_EXPIRED`; cleanup and recalculation never run implicitly.

At most 64 captures are retained per instance, with oldest-first eviction. These captures are runtime custody, not persistent workspace data. Engine lock/reopen must discard the service instance; a new process must prepare again. Captures bind display, configuration, host/selection authority and exact member context. This supplies no native PostgreSQL portability or namespace-recovery qualification.

## Sections and the common release fence

The typed response is `today-engine-v1`, with `atomic: false`, `noAction: true`, and global `state: { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' }`. Each section retains its own actual knowledge and coverage. A tile timestamp cannot become a whole-dashboard snapshot. `productReviewCount` remains `null`; these producers do not establish every product namespace's obligations.

The embedded Review page uses limit four on the same persistent service as full queue pagination and resolution. One eligible set supplies rows and `knownCount`; `count` stays `null` when producer coverage is incomplete. Pages, cursors, counts and exact resolver share current eligibility. Dedicated-domain exclusions must be installed inside this common eligibility before count/paging/fingerprints, never filtered from already paged output.

Attention returns the complete authorized source projection with actual provenance, lifecycle uncertainties, counts and calendar coverage. Displayed `selection.rows` uses only references chosen by the explicit installed policy. The callback receives detached copies and cannot change displayed evidence. Unknown, malformed or duplicate references refuse. Configured order is preserved and eligible count is computed before cutting to `max(0, 5 - initialReviewRows.length)`. Missing policy gives `selection-policy-required`; severity, cleared-episode eligibility and compliance ordering are not guessed. A UI adapter should use this selection rather than present every retained history row as a new attention claim.

Events keeps its real date/timezone-scoped producer, six-event cut, and total of the full authorized supported set before that cut. Partial coverage/capability stays explicit. Refresh generates no synthetic activity.

Before release, assembly renews the **full** original Attention projection through `assertCurrent`, the exact initial Review queue through the persistent service, and Events through `release` with the authentic original object. Tiles release runs last after later domain callbacks so retention is current. The final fence checks membership, exact full State and live host/policy generations. Changed evidence or authority withholds the entire response. Final host generation getters are contractually pure; no authority-changing callback runs after the fence.

## Exact destinations and mutation boundaries

`review` renews a page from the persistent service. `resolveReview` rebuilds eligibility and matches the exact pinned reference. `resolveEvent` accepts an event ID in its displayed day/zone and uses the real resolver, including authorized events outside the six-mark cut. `resolveAttention` rebuilds and renews the guarded projection before matching an exact episode, decision, compliance entry or reviewed-calendar reference. These methods read and never execute requests or open arbitrary URLs.

A resolved reference is not mutation authorization. Existing actions/jobs/lessons mutations must still check exact current revision, digest, owner, permission, source and effect authority atomically. In particular, the Review acceptance reference carries `deliverableDigest`; accepting only `{ id }` cannot substitute frontend validation for an atomic exact-deliverable check. Engine/domain mutation integration owns that acceptance boundary.

## Verification scope

The source tests use actual shipped services over explicitly imported synthetic fixtures and record State/write/effect counters. Cases cover preparation versus repeated reads, every offscreen/comparison receipt, forged/changed/context-scoped custody, missing guards and wrong stores, selection order/cap/refusal, exact Events/Attention resolution, persistent Review continuation/refusal, dictionary publication binding, source/epoch/host withdrawal, and elapsed receipt/counted/excluded retention without cleanup. Parent/root owns executable checks and strict compilation. These fixtures establish no native SQL, GUI selection, provider effect or whole-workspace recovery acceptance.
