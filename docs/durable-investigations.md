# Durable private investigation jobs

This local goal continues an owner-authored saved investigation. It selects no business workflow, model, source mapping or action. Full-plan sections 22.1–22.5 and live Day 8 blocks 3, 4, 6 and 12 motivate the connected execution boundary; AGT-39 requires resumption from authoritative state rather than chat.

Use the existing `jobs.create` request with `type: 'private-investigation'`, the same authored investigation objective as `goal`, explicit mandate source IDs containing every investigation source, and normal explicit JobConfig budget, limits and stop rules:

```ts
input: {
  investigationId: saved.id,
  expectedRevision: saved.revision,
  steps: [
    { stepId: 'baseline', reserveMinor: '1', durationMs: 2000 },
    { stepId: 'current', reserveMinor: '1', durationMs: 2000 },
  ],
}
```

The sample capacities are synthetic examples, not product spending or time defaults. Every pending saved step must appear once, in saved order. Operations, parameters, definitions, time cut, scope and completed-prefix receipts come from current private authoritative state. Trusted installed-runner admission executes inside the mandate transaction and replaces any client-supplied binding. The stored binding pins owner/epoch/role, initial revision, authored basis, dictionary, plan, scope, knowledge cut, lineage and completed evidence. Generic goal runners retain their existing behavior.

Each sequential step atomically saves its calculation receipt, investigation revision/progress and a separate `private-investigation-job-operation-v1` answer record. Its immutable request and receipt-prefix identity, source/fact lineage, trusted timestamp, meters and integrity support current-authority readback. Receipt contents are not mutated to add correlation, preserving existing receipt pins. A lost runner settlement can recover the original calculation through `jobs.reconcile`; it does not calculate again.

A committed investigation budget pause with no measurement records `outcome: 'blocked'`. Dispatch reports `INVESTIGATION_JOB_PAUSED`; the existing uncertain-attempt state retains reservation until readback. Readback returns the distinct known-blocked outcome, records a blocked attempt and its reason, releases justified reservation and pauses the job. The required measurement remains unfinished. Resume cannot automatically redispatch that logical attempt. Owner repair requires explicit investigation revision/review and a new mandate; measured prefixes can remain reusable when their existing evidence checks still pass.

If the final measurement fits but the complete capsule exceeds its context budget, the receipt is retained and delivery is blocked. After explicitly revising the investigation budget and resuming it to `complete`, a new mandate can deliver the existing measurements without recalculation:

```ts
input: {
  investigationId: complete.id,
  expectedRevision: complete.revision,
  steps: [],
  finalize: { reserveMinor: '1', durationMs: 2000 },
}
```

Finalization requires an already complete current capsule, uses the explicit capacity, records a correlated `finalized` result and changes no investigation revision or calculation receipt. It also supports lost-settlement readback.

Intermediate release validates immutable measured prefixes while later authorized steps grow the investigation. Final release binds the exact complete capsule, all step receipts and its revision. Current member epoch/role, private ownership, branch/source grants, source readiness, dictionary, scope, plan and receipt guards run at admission, dispatch, atomic commit, readback, delivery and acceptance. Manual advancement or revision outside the pinned continuation refuses the old mandate. Amendments after measured or uncertain attempts cannot silently repin an investigation.

The final deliverable has kind `private-investigation-deliverable-v1`, investigation ID/revision, exact final capsule, all saved step receipt IDs (including a pre-existing prefix), and interpretation `measured-results-and-owner-hypotheses`. Completion still waits for owner acceptance. Hypotheses retain their original owner-authored, noncausal status. Source deletion and retention remove correlated answer records through explicit lineage and timestamps, including zero-row records.

Focused tests use real local calculation and serialized synthetic stores, exact literal money oracles, injected settlement loss and host interruption. They establish the bounded local source-code path. They do not qualify live vendors, learned planning, model semantics, external effects, closed-laptop operation, native database production, or the full Day 8 receivables/hidden-installation workflow.
