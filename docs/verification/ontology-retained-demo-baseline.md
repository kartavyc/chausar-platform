# Ontology / retained-v2 demo-isolation baseline comparison

Date: 2026-10-04. Execution: Node v24.19.0, source fixtures only.

The untouched `e5253ffe7c8f1fc46b60ce9079ff582593eec099` base, initial joined candidate, and final settled joined candidate all fail the same six tests with the same error and failure location. The follow-up introduces no observed worsening in this suite's test statuses or errors. This is a baseline comparison, not a passing demo-isolation qualification: every test stops during VM Engine attachment before its intended behavior assertions.

## Reproduction and source identity

The exact command in both workspaces was:

```sh
node --test --test-reporter=tap platform/tests/demo-data-isolation.test.ts
```

The baseline ran in a newly created detached temporary worktree at the exact base SHA. `git status --porcelain` was empty after the run; no baseline source was modified. Both joined runs used `private/ontology-retained-v2-join-20261004-984eaa42`, HEAD `984eaa42b6594e12aaf522e3d18cecfc7c2b4f4e`, with the staged retained-v2 join and follow-up changes present. The final rerun followed the coordinator's settled-source notice. The fixture and all six relevant runtime source fingerprints below were identical immediately before and after that run.

The fixture file is byte-identical to the base (`git diff --quiet e5253ffe7c8f1fc46b60ce9079ff582593eec099 -- platform/tests/demo-data-isolation.test.ts` exited 0). Its SHA-256 in both workspaces is:

```text
c1b51c44dd558b54165b6a711154bb0e845333dabf401d93d8bd65a76f64cbec
```

## Exact six-test comparison

| # | Exact test name | Untouched e525 | Initial joined | Final joined | Exact cause in all three runs |
| --- | --- | --- | --- | --- | --- |
| 1 | demo refuses legacy Tally HTTP and Zoho credentials after mode metadata mutation and reattach | FAIL | FAIL | FAIL | `ReferenceError: invoiceConnectorId is not defined` |
| 2 | demo refuses an installed qualified host reader before grants and acquisition effects | FAIL | FAIL | FAIL | `ReferenceError: invoiceConnectorId is not defined` |
| 3 | normal Engine preserves actual legacy read admission and bounded synthetic transport | FAIL | FAIL | FAIL | `ReferenceError: invoiceConnectorId is not defined` |
| 4 | normal Engine preserves installed reader qualification, role and current source guards | FAIL | FAIL | FAIL | `ReferenceError: invoiceConnectorId is not defined` |
| 5 | demo keeps data-only recipe review, explicit local import and exact calculations available | FAIL | FAIL | FAIL | `ReferenceError: invoiceConnectorId is not defined` |
| 6 | demo refusal retains current authority checks before either acquisition method | FAIL | FAIL | FAIL | `ReferenceError: invoiceConnectorId is not defined` |

For every row, TAP reported the identical fields:

```text
status: not ok
failureType: testCodeFailure
error: invoiceConnectorId is not defined
code: ERR_TEST_FAILURE
name: ReferenceError
first stack frame: Engine.attach (synthetic-engine-data-isolation.vm.js:751:50)
```

The per-test entry frames also match across all three runs after removing only the workspace root:

| # | Test entry frame in all three runs |
| --- | --- |
| 1 | `platform/tests/demo-data-isolation.test.ts:126:74` |
| 2 | `platform/tests/demo-data-isolation.test.ts:143:74` |
| 3 | `platform/tests/demo-data-isolation.test.ts:156:36` |
| 4 | `platform/tests/demo-data-isolation.test.ts:171:36` |
| 5 | `platform/tests/demo-data-isolation.test.ts:187:36` |
| 6 | `platform/tests/demo-data-isolation.test.ts:205:36` |

| Result field | Untouched e525 | Initial joined | Final joined |
| --- | --- | --- | --- |
| Process exit code | 1 | 1 | 1 |
| Tests | 6 | 6 | 6 |
| Pass | 0 | 0 | 0 |
| Fail | 6 | 6 | 6 |
| Cancelled | 0 | 0 | 0 |
| Skipped | 0 | 0 | 0 |
| Todo | 0 | 0 | 0 |

The initial comparison parsed each TAP case into its number, exact name, status, failure type, error text, error code, error name, first Engine frame, and normalized test entry frame, then compared the resulting ordered records, process exit codes, and result counts. They were exactly equal. Complete TAP comparisons for both joined runs then normalized only workspace roots, the warning's process ID, and duration fields; both complete outputs were byte-identical to the untouched baseline. All test diagnostic fields and stack frames were preserved. Independent read-only review also reproduced the initial complete-TAP and parsed-record equality from the retained outputs.

## Cause and limits

The fixture removes Engine imports before evaluating its source in a VM and supplies an explicit `globals` object. That object omits the imported `invoiceConnectorId` constant. `Engine.attach` reads the constant while constructing `TodayReviewService` unsupported-mutation metadata, so all six tests fail before their requested Engine operations begin. The same missing binding and attachment failure exist on the untouched base. Neither the fixture nor runtime was changed to conceal or repair that existing failure.

This comparison proves unchanged observed outcomes and failure causes for these six tests. It does not prove the blocked behavior assertions would pass after correcting the fixture. No native, browser, PostgreSQL, real credential, provider, acquisition, or CI operation was performed. Strict TypeScript checking remains unavailable locally; no compiler or package was acquired.

## Final settled joined source fingerprints

These SHA-256 values identify the final joined run's working source rather than only its HEAD, which precedes the staged join. The complete list was measured before and after the final test command and remained exactly equal:

```text
ec2b11ec3f5d5e1a066b9db1b5111f34a825603a75c743dc6ac362e5348cd249  platform/runtime/engine.ts
86639aa617690bac40d7d8f6ce8c70cd25c011bc57e24a2eecc34d2e0f21ed83  platform/runtime/ontology.ts
7a3385733d40a65737f9dab739b6ed190a28778bd2dbc003fb28934dddb72656  platform/runtime/workspace-activation.ts
c22e2c4c9584a3a56ea858cdd930dfe3cc84980416f2169a35b2045b19c614d8  platform/runtime/workspace-interchange.ts
3c891fb4ecc006272a1cc5e7ebe0033f071bc77d39c7187fbcbfe0685be3a2b9  platform/runtime/workspace-interchange-contracts.ts
db88e542e6e16896334afd69951d44f205fc7d55ec108b83a387c15b1a563451  platform/runtime/workspace-import-candidate.ts
```
