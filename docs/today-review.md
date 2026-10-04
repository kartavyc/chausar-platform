# Existing-source Today review service

`platform/runtime/today-review.ts` supplies one explicitly scoped review set for TD-01. The approved inventory says to show its count, at most four rows at rest, and a continuation to every row. This module does not register an Engine method, change the shared Today DTO, widen the desktop allowlist, or change either renderer. Those joins belong to integration. The current Today preview remains partial.

The source baseline is `2bc59dc1f527ec67dafa8fa350fd9832f3f705ba`, verified against the private `private/joined-source-corpus-native-fable-20261003` remote ref before creating the isolated worktree. Repository safety guidance, module ownership, product specs and approved TD-01/TD-04 inventory were read; this source has no `AGENTS.md` or repository `.agents/skills` files.

## Contract

Construct `TodayReviewService(store, { actions, jobs, lessons })` with the current real services on the exact same workspace store. `actions` and `jobs` are existing `ActionService` and `JobService` instances. The optional lesson source is `{ service, targets, evaluations }`, using the **same installed authorities** as its `createEngineLessonService` and retained `store.lessonState`. An isolated lesson store is not accepted as proof of this Engine namespace. Missing services or evaluation/target authority remain unavailable; no default evaluation or human review is installed.

`list(context, { limit?, cursor? })` defaults to four rows. Limits are integers from 1 to 100. It returns:

- `scope: 'prepared-actions-job-mandates-deliverables-lessons-v1'`;
- `completeness`, per-producer coverage, `knownCount`, and `count` (null unless the whole scoped set is available);
- rows with exact revision references, real existing Engine request bindings, `canApprove`, and explicit producer provenance;
- an opaque continuation, or null when every authorized row has been reached.

Count, initial rows and continuation derive from the same current authorized set. Equal labels do not merge requests. The continuation contains no source names or hidden counts, and binds the current workspace state, calling context, producer availability and authorized rows. Changes require restarting from the first page; no stale-page omission or reuse under another role/epoch is accepted. Cursors belong to one service instance and carry no mutation authority.

Installed read guards must be synchronous and read-only, including their external authority. A host with action/job grants or release decisions outside persisted State must supply `authorityRevision: () => string`, a live token changing whenever those decisions change. An unavailable token refuses the read with `REVIEW_AUTHORITY_UNAVAILABLE`. The final token check covers late changes during the renewed producer pass; two passes alone do not establish arbitrary external-authority consistency without that host contract.

`resolve(context, reference)` reads the complete current set again, then returns only the exact matching current row. Changed or unavailable references fail with `REVIEW_REFERENCE_UNAVAILABLE`; invalidated continuation fails with `REVIEW_QUEUE_CHANGED`. Membership revocation preserves `ACCESS_REVOKED`. Producer releases and capabilities are renewed before returning any queue; a change during a read refuses the reply with `REVIEW_AUTHORITY_CHANGED`.

## Membership of this set

| Producer | Eligible obligation | Exclusions and current authority |
| --- | --- | --- |
| Actions | Prepared, unattempted exact request awaiting approval | Approved, executing, verified, unknown, rejected, blocked, cancelled and attempted requests are excluded. Existing action/source/branch/operation read grants control visibility. Approval role, taint, operation write grant, channel and exact digest control `canApprove`. Unknown outcomes require reconciliation outside this read. |
| Jobs | Explicit approval-required mandate with an outstanding approval request in an approvable state | Existing exact valid approval removes the row, even when autonomy-disabled reports approval-blocked. Expired/exhausted mandates, retained deliverables and unresolved dispatched/unknown attempts are excluded. Private metadata requires exact owner ID, role and epoch before count or paging. |
| Jobs | Delivered work awaiting human acceptance, with output released by the current guard | A missing guard leaves coverage incomplete. Withheld or invalid output contributes no acceptance row and marks coverage incomplete without exposing its contents, title, ID or withheld count. |
| Lessons | Released review-ready candidate with an existing exact human review bound to its current candidate, evaluation and actor | Proposed, evaluation-blocked, approved, rejected, deferred, retired and superseded states are not pending decisions. Review-ready without a human review token is excluded. Read operations never issue reviews. Source/role/epoch revocation filters before counting. Current permitted evidence, target or evaluator failures leave coverage incomplete rather than claiming zero. Retained history prevents a withheld approved conflict from incorrectly enabling approval of a released candidate. |

A released Engine `action-preparation` result can add `job-action-preview` provenance to the existing action approval. It must name the exact action ID/digest and evidence ID, current job revision, current execution plan, verified step and action idempotency key matching the persisted operation key. Hidden outputs supply no alias provenance. The approval is counted once. Human acceptance of the job result remains a separate obligation: accepting work does not approve its prepared action.

These producers do **not** exhaust all product review obligations. Setup, update readiness and other review producers remain outside this scope. Decisions due for review belong to attention, not this approval count. TD-04 activity, scheduling, tiles, thresholds, qualification and timezone choices are unchanged.

## Integration boundaries

Visibility does not authorize a decision. Request objects are review bindings, not executed commands; lesson decision and reason are required human input. Reads call no prepare, approve, execute, reconcile, accept, lesson review issuance or store update method.

An asynchronous transport must renew the queue/reference under current authority before releasing a held reply or reopening its details. Consumers must discard cached rows after revocation and expose the explicit scoped coverage. `count: null` must not become zero; `knownCount` must not be presented as a complete product total.

Actions and mandate approval bind the real existing `{ id, digest }` request. Lessons bind candidate pin, review ID and review digest. Job acceptance currently accepts an ID only: the returned reference additionally pins objective revision/digest and `deliverableDigest`, but this module does not repair the mutation API. Integration must enforce that full reference at the serialized acceptance boundary; an earlier read alone cannot guarantee atomic acceptance of an unchanged preview. Existing producer mutations must still reauthorize. No read reference, cursor or `canApprove` value is an approval grant.

Lesson approval is conservative when retained same-member history cannot be released, including approved guidance from an earlier role or epoch; the existing mutation conflict rule compares member IDs. Hidden older actors do not add identities or counts to coverage. Reject/defer remain available only where the existing exact review is currently decidable. This does not expose withheld lesson identities or invent conflict precedence.

## Executed source evidence

`platform/tests/today-review-source.test.ts` commits generated CSV through the actual import/ontology services, obtains a real reconciled calculation receipt and drives current Engine calculation/action-preparation jobs and the retained lesson lifecycle. Target and evaluation authorities are explicitly synthetic protocol fixtures. The imported source is experimental and the evaluations retain `synthetic-protocol`; no provider/model/hidden-suite/business qualification is implied.

The affected regression command passed **125 tests, zero failures, skips or cancellations**:

```sh
node --test platform/tests/today-review.test.ts platform/tests/today-review-source.test.ts platform/tests/workflows-actions.test.ts platform/tests/workflows-jobs.test.ts platform/tests/durable-jobs.test.ts platform/tests/lessons.test.ts platform/tests/engine-lessons.test.ts
```

Coverage includes every action/job/lesson status, seven eligible obligations with exactly four initial rows and all seven reachable, exact alias deduplication and distinct same-label requests, private owner/epoch/role filtering, source/operation/channel changes, held replies, output withholding, live guard changes during release, stale revisions, missing human review, missing authority, evaluator outage and withheld approved conflicts. State/target/evaluation hashes and provider counters prove queue reads introduce no mutation or effect.

Node `v24.19.0` executed TypeScript source and passed `node --check` for the new module and tests. `git diff --check` passed. No installed `tsc`, `tsc.js`, `typescript.js` or `tsserver.js` was found, so strict compiler verification is unavailable. No package/dataset acquisition, native/browser/credential execution, external send, setting change, CI rerun or main update occurred. Independent source review identified the two lesson coverage/capability gaps before repair and reviewed the final changes.

This is bounded source-service evidence. Engine/DTO/desktop/frontend integration, full Today producer coverage, native/browser/user acceptance and release qualification remain outstanding with their respective owners. The preview's partial flags are preserved.
