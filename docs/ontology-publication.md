# Reviewed first-run dictionary publication

Fresh first-run creation explicitly selects `dictionaryMode: 'deferred'` on `workspace.create`. It accepts neither a selected `pack` nor a demo fixture. Engine passes the reviewed mode to `Vault.create`, which includes `ontology: { current: null, history: [], firstRunReviewRequired: true }` in its initial encrypted revision-zero commit before Engine attachment. Deferred creation needs no second State write to initialize review. The marker survives reopening; ordinary `ontology.get({})` exposes exactly `{ current: null, history: [] }` until an authorized reviewed publication commits. Creation and reopening produce no dictionary publication audit or learning record. No RPC can convert an existing workspace to this creation mode.

The first publication in a marked workspace requires both `expectedCurrentHash: null` and a valid retained `attemptId`; otherwise it refuses with `DICTIONARY_REVIEW_REQUIRED`. Successful publication creates version 1 and atomically replaces the marker with the normal current/history/publicationAttempts wrapper. Omitting `dictionaryMode`, or selecting `'legacy'`, preserves the existing starter publication behavior, including the default ecommerce pack and separately selected demo fixtures. Existing unmarked Vaults retain the legacy publication contract.

The service contract is:

```ts
type DictionaryPublishOptions = {
  expectedCurrentHash?: string | null;
  attemptId?: string;
};

type DictionaryPublicationReceipt = {
  attemptId: string;
  workspaceId: string;
  memberId: string;
  epoch: number;
  draftDigest: string;
  expectedCurrentHash: string | null;
  dictionaryHash: string;
  version: number;
};
```

`OntologyService.publish(context, draftOrPack, options)` returns a published `Dictionary`. `OntologyService.get(context, {})` returns exactly `{ current, history }`. The optional `get(context, { attemptId })` adds `attempt: DictionaryPublicationReceipt | null`. Engine exposes these through `ontology.publish({ draft, expectedCurrentHash, attemptId })` and `ontology.get({ attemptId })`; a selected `pack` can replace `draft` in the publish envelope. Bare legacy draft and pack publication retain their existing behavior in unmarked workspaces. Options are adjacent payload fields, never dictionary fields or imported authority.

## Reviewed baseline and current authority

`expectedCurrentHash` is optional in the legacy unmarked contract. Omission permits unconditional publication there; the persistent deferred marker requires explicit `null` and an attempt identity for the first publication. Explicit `null` requires no current dictionary. A string requires the exact currently published dictionary hash. Comparison occurs inside the existing serialized update before dictionary compilation, history append, answer/receipt staleness, learning or audit. A refused stale review changes none of those records. The caller must review the newly current dictionary before authoring another attempt.

Publication options, draft and caller context are detached before queued work. Queued publication rechecks current active owner/cofounder role and exact member epoch against the transaction State; earlier authorization cannot survive revocation while waiting. Only declared option fields are accepted. Attempt IDs contain 1–128 characters, begin with an ASCII letter or digit, and otherwise contain ASCII letters, digits, underscore or hyphen. Hashes contain exactly 64 lowercase hexadecimal characters. An `attemptId` requires an explicitly supplied string or null baseline.

Draft input must be ordinary finite JSON data with at most 2 MiB of serialized UTF-8 content, depth 16 and 100,000 nodes. Accessors, class/prototype authority, cycles, symbols, hidden fields, sparse or extended arrays and unsupported values refuse before queued work. Draft validation and dictionary compilation still enforce the supported data fields and explicit business definitions.

The draft digest is SHA-256 over the exact detached persisted JSON draft. Original object key order is significant, matching existing dictionary semantic hashing. It is not a normalized content comparison. Identical dictionary meaning published by another actor or attempt does not establish this attempt's outcome.

## Durable outcome attribution

Successful retained attempts append `publicationAttempts: DictionaryPublicationReceipt[]` inside the existing encrypted `State.ontology` wrapper. The receipt and dictionary/history publication commit in the same serialized State update. Later publications preserve the receipt namespace. Each receipt stores only origin binding, exact input/baseline pins and the resulting history hash/version; it does not duplicate draft, dictionary, time or credentials.

The same attempt ID with the same workspace, actor, epoch, exact draft digest and reviewed baseline returns the original retained history dictionary. This remains true when the current dictionary is newer. It performs zero State writes, increments no revision, appends no second dictionary and repeats no publication staleness, learning or audit. The same ID with changed input, baseline or origin refuses. The service validates retained receipt shape and requires exactly one matching dictionary hash/version in retained history, a coherent full dictionary hash and the exact original draft digest; malformed or inconsistent attribution refuses.

Lookup requires current owner/cofounder authorization and returns only the exact attempt belonging to the current workspace, member and epoch. It cannot attribute another actor's identical publication. The returned receipt, current dictionary and history are detached readbacks. Lookup never publishes, adopts an attempt or retries a request.

After a lost response, an exact authorized receipt and retained history dictionary establish that the attempt committed. `attempt: null` establishes only that no matching committed receipt was found at that read. It is never proof that a queued or pending publication cannot still commit. The UI must preserve the attempt identity and the uncertain outcome instead of silently retrying or inferring publication from matching content, author or version. A new reviewed submission requires an explicit new attempt and exact current baseline.

## Export, backup and fresh-owner recovery

No new top-level State store is introduced. The existing `chausar.persisted-state.v1` interchange profile retains the whole ontology singleton as original ordered JSON, includes it in readable definitions, and binds all bytes/counts/digests to the independently retained source inventory. The local enumerator also retains the whole ontology as its dictionary artifact. The deferred review marker and later receipts therefore survive complete legacy interchange capture and historical readback unchanged. A structurally consistent rewritten package that removes or disables the marker, removes receipts or rewrites their actor, epoch, baseline or result still fails validation against the original independent inventory. Interchange inspection alone proves structural consistency, not authentic receipt issuance or review admission.

Encrypted backup v2 captures the complete original encrypted authority envelope without decoding or projecting nested ontology. Publication receipts need no new backup purpose or top-level archive field. Authentication and restore must retain the original State and origin bindings; an opaque archive's checksum alone cannot establish receipt authenticity.

The current fresh-owner activation profile requires a coherent published dictionary and accepts only the reviewed `{ current, history }` ontology wrapper. It refuses the unpublished deferred marker and `publicationAttempts`, even when the latter is empty, with `ACTIVATION_DICTIONARY`. This explicit refusal is preserved. It prevents an unreviewed expansion of the business projection and does not silently discard review state or historical receipt data. A freshly allocated owner/workspace cannot receive authority to claim an original publication attempt.

Integration with the separately developed retained-v2 profile requires an explicit reviewed ontology projection. That profile must validate the exact receipt fields and their unique linkage to unchanged dictionary history, keep the complete authenticated receipt namespace in inert historical evidence, and preserve original workspace/member/epoch/draft/baseline/result binding without rewriting it to fresh authority. A live fresh-workspace projection must either exclude receipt authority while retaining that original evidence or retain immutable origin-bound receipts that cannot match the fresh workspace context. Unpublished deferred sources require an explicit review-state disposition that preserves the mandatory first publication review; copying or dropping the marker cannot qualify a published dictionary. The profile must bind these dispositions to its exact profile/projection digest and prove old attempts cannot become lookup successes or idempotent publications for the new owner. Unknown namespaces continue to refuse; accepting arbitrary ontology keys or dropping review/receipt data to keep the legacy profile working is not an integration.

## Verification scope

`platform/tests/ontology-interchange.test.ts` uses a decoded deferred revision-zero State fixture, actual OntologyService publications, the existing source fixture StateStore, pure interchange codecs and declared in-memory activation ports. It checks deferred marker preservation and reviewed v1 publication after reconstructed historical readback, receipt preservation through later publication and exact complete capture/readback, independent-pin refusal after coherent marker/receipt rewrites, and existing fresh-owner activation refusal before authority allocation or commit. The dedicated service/Engine fixtures verify that the marker belongs to the initial encrypted commit, successful creation/reopening, publication concurrency and lost-response attribution.

These are source correctness fixtures. They do not qualify native storage or hard-crash recovery on installed storage, installed PostgreSQL, real credentials, browser/desktop journeys, full product operation, retained-v2 activation or independent audit. The retained-v2 module is not changed by this slice; its review-state and receipt projection remain explicit integration requirements.

Validation on the isolated `e5253ffe7c8f1fc46b60ce9079ff582593eec099` base: all 71 dedicated service/Engine/interchange cases passed, and the final selection of those cases plus affected compiler, currency, semantic, Vault, backup, activation, Today and desktop bootstrap fixtures passed 279/279 with no skips. `node scripts/check.mjs` validated syntax and JSON for 598 source files. Strict TypeScript checking was unavailable because no compiler was installed; no package acquisition was attempted. The six existing `demo-data-isolation.test.ts` cases fail with an undefined `invoiceConnectorId` in their VM fixture; all six failures were independently reproduced on the untouched exact base and remain outside this slice.
