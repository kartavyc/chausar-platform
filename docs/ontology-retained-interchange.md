# Joined ontology and retained semantic interchange

This source candidate joins publication checkpoint `984eaa42b6594e12aaf522e3d18cecfc7c2b4f4e` and retained semantic checkpoint `c4dfd9e67b7b155c16b26c98c0ebe7472c5d54bf`, both based on exact `e5253ffe7c8f1fc46b60ce9079ff582593eec099`. Scenario/lesson authority admission, encrypted custody, backup formats and local backup-control files remain as supplied by those candidates.

## Exact historical profile

`StoreProfile.ontologyNamespaces`, when present, is the nonempty sorted exact presence of `firstRunReviewRequired`, `historicalPublicationEvidence` and `publicationAttempts` in the captured ontology singleton. Any modern presence selects `chausar.workspace-interchange.v2` and `chausar.persisted-state.v2`, even when no private top-level namespace is present. It introduces no additional State store. Empty arrays and empty origin receipt collections remain present. Absence omits the metadata entirely, preserving original v1 bytes and every original c4 scenario/lesson v2 profile, byte count and digest.

Package, inventory, ordered singleton text and readable definitions agree with the exact presence declaration. Modern wrappers require only `current`, `history` and their declared optional namespaces. Unsupported keys, malformed evidence or recorded baselines, duplicate origin workspaces, mismatched origin/draft/result binding and metadata mismatch refuse. Source receipt dictionary links must resolve once to exact ordered coherent history. Historical scenario input cuts validate their own original workspace and ontology presence, without recursively carrying scenario/lesson namespaces. Independent source pins still reject coherent package substitution.

Target capability admission recognizes only the exact original v1 target, the exact pre-ontology c4 full retained target, and the exact current full retained target. Old c4 targets support original namespace-absent source profiles; modern ontology sources require the full current capability. No target fields, pins or candidate issuance records are rewritten. A current source or target fence change still requires fresh review.

## Origin-only publication evidence

Modern published sources use `chausar.synthetic-business-projection.v2`. Its exact `ontologyDisposition` contains:

```ts
{
  format: 'chausar.ontology-historical-projection.v1';
  sourceWorkspaceId: string;
  sourceOntologyDigest: string;
  publicationAttempts: 'absent' | 'inert-origin-evidence';
  historicalPublicationEvidence: 'absent' | 'preserved';
}
```

The reviewed projection digest includes this disposition and the projected ontology. The authenticated target readback rebuilds the same projection from the original encrypted candidate/archive and independent pin. Original source `publicationAttempts` are retained unchanged in an explicit origin record:

```ts
ontology.historicalPublicationEvidence = [
  ...unchangedPreviousOrigins,
  { workspaceId: originalSourceWorkspaceId, publicationAttempts: unchangedOriginalReceipts },
];
```

An explicit empty source namespace produces an explicit empty origin record. Fresh target `publicationAttempts` is absent. Each historical origin stays distinct from the current workspace; live attempt IDs cannot overlap historical IDs. The complete original source namespace also remains in encrypted inert activation evidence. No actor, epoch, attempt identity, draft digest, expected baseline or result hash/version is reassigned or resealed.

Authorized lookup or publication using an inherited attempt ID refuses with `DICTIONARY_ATTEMPT_AUTHORITY`, even with a changed baseline or draft. It cannot return source attribution or create a fresh publication. A new attempt ID uses current owner/cofounder and epoch authorization and exact reviewed CAS, while every subsequent publication and transfer preserves prior origins. Exact retries of that new live attempt remain zero-write readbacks. Ordinary `ontology.get({})` keeps its existing `{ current, history }` shape.

## Deliberately unsupported transitions

Unpublished deferred sources retain their mandatory review marker losslessly in interchange, complete encrypted backup cuts and ordinary same-owner reopen. Fresh activation still requires a published dictionary and refuses such a source with `ACTIVATION_DICTIONARY` before authority allocation or commit. Choosing a new provisioning policy for an unpublished target is outside this source contract; neither deleting the marker nor pretending it is a published dictionary is supported.

Older unprofiled v1 packages containing modern ontology namespaces refuse. No implicit migration is implemented. Namespace-absent v1 and original c4 profiles remain supported. A migration for an already issued modern-v1 package would require an explicitly reviewed source/provenance policy.

## Source verification

New fixtures cover exact profiles and old byte pins, root target compatibility, real encrypted experimental-file reopen, publication before/after retained scenario capture, complete backup cuts before/after first review, lost responses, activation readback, empty presence, inherited ID refusal, legitimate fresh publication and a second transfer retaining both origins. Later source attempts remain absent from an earlier backup cut; missing historical receipts do not establish the outcome of a request against the current source.

The six pre-existing `demo-data-isolation.test.ts` failures are documented by exact test name and shared cause in [the baseline comparison](verification/ontology-retained-demo-baseline.md). They are compared against an untouched detached exact base and the settled joined source.

The final affected batch passed **597/597 tests across 21 source test files**, with zero failures, cancellations or skips. The [complete TAP evidence](verification/ontology-retained-composition-tests.tap) records the run. Independent runtime/specification and fixture reviews found no remaining scoped blocker. Syntax/JSON validation passed for 606 source files. `git diff --check` passed; the local backup-control modules have no diff from either joined candidate.

Strict compilation uses the existing `tsconfig.json` and `npm run typecheck` in an environment with the declared compiler/types installed. This environment has no TypeScript compiler and no package acquisition is authorized, so strict TS remains for local validation. Node syntax checks do not substitute for it. No native, PostgreSQL, browser, real credential, CI or full-product execution is claimed.
