# Today event source validation — 2026-10-04

Base: `2bc59dc1f527ec67dafa8fa350fd9832f3f705ba`.
Isolated branch: `private/today-events-20261004`.
Interpreter: installed Node `v24.19.0`.

Validation after the final projection changes:

```text
node --test platform/tests/today-events.test.ts platform/tests/today-events-services.test.ts
tests 19; pass 19; fail 0; cancelled 0; skipped 0; todo 0

node --check platform/runtime/today-events.ts
node --check platform/tests/today-events.test.ts
node --check platform/tests/today-events-services.test.ts
all exit 0

git diff --check
exit 0
```

Affected existing source-service regressions:

```text
node --test platform/tests/import-lineage.test.ts platform/tests/import-learning-custody.test.ts platform/tests/calculator-source-scope.test.ts platform/tests/workflows-actions.test.ts platform/tests/workflows-jobs.test.ts platform/tests/decision-journal.test.ts platform/tests/journal-execution.test.ts
tests 78; pass 78; fail 0; cancelled 0; skipped 0; todo 0
```

Independent source review identified silent authority-list misses, retained decision-history binding, mixed-source branch semantics, and restricted-owner diagnostic invariance. The implementation and regressions address those findings. The independent review also verified that the integration cases use current actual authority/readiness services, including the shipped local action catalogue and durable job runner, over synthetic imported CSV. No permissive service facade stands in for those resolvers.

The focused cases include day-boundary/DST membership, more than six authorized events, identical timestamps, restricted seats, source deletion/grant revocation, different owners' private receipts, epoch revocation, unknown kinds, missing actors, corrupt canonical proof, forged decision actor/outcome/revision, held stale job delivery, current acquisition readiness loss and safe reference release. Read repetition and duplicate imports produce no new projected business events.

Strict TypeScript checking was unavailable: `tsc` is not installed on PATH, no repository TypeScript dependency tree is present, and installed runtime locations contain no TypeScript compiler. No package was acquired. Node syntax validation is not semantic type checking.

Engine registration, shared Today DTO, desktop allowlist and frontend remain parent-owned. The module cannot remove calculation events that parent assembly itself creates through existing calculating dashboard/report paths; read-only assembly is still required. Preview partial flags remain and full Today acceptance is not claimed. Native/browser/live-provider/credential validation, native database durability, settings changes, external sends and CI reruns were not performed.
