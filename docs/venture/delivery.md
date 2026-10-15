# Venture launcher: delivery (P5)

This package is how agents help with client work in this build: a playbook they follow, practice runs with made-up clients, a launch ladder, draft replies to real orders, and an honest list of what the build can do.

One rule shapes all of it. An agent here only has the client's message. It has not opened a file, an inbox, an account or a website, so it drafts and promises; it never reports work as done. A check refuses any sentence like "we matched each entry" or "your books are reconciled", and the judge asks the same question.

## Files

| File | What it does |
| --- | --- |
| `platform/runtime/venture/delivery/index.ts` | The twelve handlers, plus `validatePlaybook`, `renderDeliverable`, `renderForJudge`, `runChecks`, `scenariosFor` and `capabilityList` for tests |
| `playbook.ts` | The seven fixed steps, `validatePlaybook`, and `venture.delivery.playbook` |
| `deliverable.ts` | Figure and date refs, the delivery model task and its validator, the template outline, and rendering |
| `checks.ts` | The nine deterministic checks |
| `scenarios.ts` | Three practice clients per service type, and cases made from signals |
| `simulate.ts` | Rehearsal: `venture.simulation.run`, `.get`, `.scenarios` and `.fromSignal` |
| `judge.ts` | The judge task: four typed questions, placeholders instead of prices and dates |
| `launch.ts` | The launch ladder: `venture.launch.status` and `.advance` |
| `runs.ts` | Real orders: `venture.delivery.run`, `.approve`, `.review` and `.list` |
| `capabilities.ts` | `capabilityList` and `venture.capabilities` |
| `shared.ts` | Small read helpers |

Tests: `platform/tests/venture-delivery.test.ts`, with synthetic recordings in `platform/tests/fixtures/venture/delivery/`.

## The playbook

`venture.delivery.playbook` builds the playbook from the accepted plan. It needs an accepted plan (`BLUEPRINT_NOT_ACCEPTED`). If the newest playbook was built from the same plan digest, it is returned as it is; otherwise a new version is validated, stored, linked from the venture record, and `playbook-ready` is emitted.

| Step | Kind | Tier | Model | Done by | Checks |
| --- | --- | --- | --- | --- | --- |
| gather | gather | actor | fast | agent | |
| clarify | question | actor | fast | agent | questions-raised |
| price | compute | code | none | agent | figures-resolve |
| draft (the plan's step 3 title) | write | actor | main | agent | the six draft checks |
| verify | verify | code | none | agent | every check except questions-raised and turn-limit |
| approve | approve | code | none | you | |
| send | operator | code | none | you | no-outside-writes |

In this build the gather, clarify and draft steps run as **one** delivery model call over the client's message only. Steps 1, 2 and 4 of the plan (collect the files, do the hands-on work, send) stay with the owner, marked `planned: agent` by the plan's `STEP_PLAN`. The send step is the owner copying an accepted draft; Chausar sends nothing.

`validatePlaybook` refuses duplicate ids, a code, approval or operator step with a model, any tier above `actor` (sandboxes are planned), a writing step without required sections or without the done-claim check, and an operator step that comes before an approval step. The hash is the digest of the steps, and every rehearsal and real run records it.

## Draft replies

The model never sees an amount or a date. It gets refs with words-only labels:

- prices: for rehearsal, `offer_1.unit`, `offer_1.total` and `offer_1.tax` (tax only when above zero) for each offer with a current price receipt; for a real order, `order.unit`, `order.total` and `order.tax` from the order's receipt;
- dates: `today` always, and `order.created` for a real order.

The validator turns the model's flat output into a draft: headings only from the plan's required list, each once; one to twelve parts per section; text through the number guard with tokens copied from the client's message and the idea (so "B2B" passes and a new "500" fails); figure and date parts only with refs that were offered. A figure renders as its receipt label and display, for example `Total: INR 2,948.82`, so the label says what the number is. Dates use the country's date order.

The judge sees `Total: [price from Chausar]` and `[date from Chausar]` instead, so no receipt amount leaves under standing consent.

The template outline is what runs when no AI serves the drafting tier: one sentence per required section that promises work ahead, the plan's total in the second section when a receipt exists, and the question "Is anything missing that we should know before we start?". For a real order its text starts with "Template outline. No AI wrote this and it doesn't read the client's request."

## Checks

`no-numeric-prose`, `figures-resolve`, `required-sections`, `no-outside-writes`, `house-style`, `length-bounds` (40 to 12,000 characters), `turn-limit`, `questions-raised` and `no-done-claims`. Each returns a plain sentence. `no-outside-writes` always passes in this build, and its sentence says why: every outside effect is only recorded.

## Rehearsal

`venture.simulation.run { scenarioIds?, episodes?, useTemplate? }` builds the playbook first (its own transaction), then for each practice client: a client turn, an agent draft, and, when the draft asked questions, one more client turn and one more draft. What would have been sent is recorded as a mock effect (a digest, never sent). Then the checks, then the judge when a model serves the fast tier. Every model call runs outside any transaction; one transaction stores the run at the end, moves the venture from `build` to `rehearsal`, and emits `simulation-finished`. With one practice client per request, a request makes at most five model calls.

Costs come from the model port's outcomes and are summed with BigInt. When any outcome came from an unconfirmed price table, the display ends with "(estimate, price unconfirmed)".

## The launch ladder

- **rehearsal**: made-up clients only. A real order can get a template outline, not an agent draft.
- **shadow**: needs a passing, judged rehearsal of all three practice clients with the current playbook. Agent drafts for real orders are practice drafts: they can be edited or rejected, never accepted.
- **approve each**: one step up from shadow. Drafts can be accepted, edited or rejected. The venture status becomes `live`.
- **approve a sample** and **auto with spot checks** are planned and always refused with `STAGE_PLANNED`.

Moving down is always allowed; moving up is one allowed stage at a time (`LAUNCH_STAGE_BLOCKED` with the reason otherwise).

## Real orders

`venture.delivery.run { orderId, useTemplate? }` decides first whether a template or a model will write, so a blocked request stores nothing. A template outline works at any stage and is ready at once. An agent draft needs shadow or approve each; it stores the exact text the model will receive and waits.

`venture.delivery.approve { runId, digest }` reads the waiting draft outside any transaction, then asks the model port to send the approved text once (the port claims the call first, so two approvals send once). The draft is rendered and checked, and one action stores it. A failed check stores a `check-failed` signal.

`venture.delivery.review` accepts, edits or rejects a ready draft. A practice draft refuses `accepted` with `PRACTICE_DRAFT`. A rejection needs a reason from the list. Edits and rejections store signals. `venture.simulation.fromSignal` turns a signal into a rehearsal case built from the messy practice client, with checks focused on the reason. It never copies the client's request.

## Choices made where the spec left room

1. **What "judged" means.** A rehearsal row counts as judged only when the run was not template only, every agent draft for that client was written by a model, and every judge answer is a real answer. This follows the contract's own comment ("judged means a model wrote and a judge answered"), so a run where templates wrote the drafts and a model only judged them can't unlock shadow.
2. **The shadow reason.** "Connect an AI and rehearse with it first. Template outlines can't be judged." shows when every practice client that has a run is unjudged; otherwise "Rehearse all three practice clients with the current playbook."
3. **Model answers that fail in rehearsal.** When the model's answer is refused (`MODEL_OUTPUT_REJECTED`, `MODEL_REFUSAL`, `MODEL_INCOMPLETE`), that practice client fails with a sentence such as "The draft was refused: ..." and the run is still stored. Any other error (no key, budget, send setting) stops the request.
4. **A spent approval that failed.** If the approved call was claimed and then failed, the draft can never be approved again, so it is marked `failed` and the owner drafts again. A refusal before the claim (a stale digest, the send setting, the budget) leaves it waiting.
5. **`venture.simulation.run {}`** runs the three template practice clients. Signal cases run only when named.
6. **The template practice client** answers a follow-up question with "That is all I can share for now. Please go ahead with what you have."
7. **The practice client's history** holds only the agent's questions, never the rendered draft, so no amount reaches the practice client either.
8. **Signal cases** keep five core checks (numbers, prices, outside writes, turns, done claims) and add the checks for the reason, for example `required-sections` for a missing section.
9. **Moving to the stage you are on** changes nothing and returns the ladder. Moving down from approve each sets the venture status back to `rehearsal`.
10. **`capabilityList`** takes an optional fourth argument, the model presets, so a model row can name the preset and its availability words. Without it, Anthropic presets that serve a tier count as available and the others as unverified, as in the models table.

## How it was checked

- `node --check` on every file in this package and the test (see the note below on what it misses).
- Scoped typecheck with the scratch compiler (`typescript@5.9.3`, the repo `tsconfig.json`) over `platform/runtime/venture/delivery/**` and `platform/tests/venture-delivery.test.ts`, filtered to these paths: no errors.
- `node --test platform/tests/venture-delivery.test.ts`: 18 of 18 pass. Two rules were broken on purpose (practice drafts at shadow, and what counts as judged) and the tests caught each one.
- `node --test platform/tests/desktop-harness.test.ts platform/tests/desktop-ipc-methods.test.ts platform/tests/venture-contracts.test.ts`: 29 of 29 pass.

## Hand-off note

**Done:** everything in section 8 of the build spec: the twelve handlers, the exported helpers, the tests in 8.7 and the fixtures.

**Contract change needed (for the integrator):** in `contracts.ts`, `ModelConnectionRecord` and `ModelCallRecord` each add `kind: ModelRouteKind` on top of `RecordBase`, whose `kind` is the record kind. The two literal types can't both hold, so TypeScript reduces both record types, and `ModelConnectionView`, to `never`. P2 found the same thing and stores the route kind as `routeKind`. Rename the field to `routeKind` in both record types. This package does not depend on the fix: `runs.ts` looks up a model call by id only and reads its `status`.

**Wiring changes needed:** none.

**Found while checking (for the integrator):** on this machine (Node 24.13.1), `node --check` exits 0 for a `.ts` file with an `export` and a plain syntax error (tried with `export const a: string = 'it's broken';` in this package's folder, then removed). So `scripts/check.mjs` does not catch syntax errors in the engine's ES module TypeScript files; only the typecheck does. Run the full typecheck in Phase C before trusting `check.mjs`.

**For P6 (end-to-end):** the steps in section 11 that touch this package should pass as written: the rehearsal draft fixture matches only requests that offer `offer_1.total`, a real order offers only `order.*` refs, and the template path gives `modelMode: 'template'`, `costMicros: '0'` and the "Connect an AI" reason.

**For P7 (screens):** a run's `practice` flag means the screen shows "Practice draft. Not for the client." with no Accept, Copy or Save; `servedBy: 'template'` means the text already starts with the template outline line. Send one practice client per `venture.simulation.run` request.

**Not finished:** nothing in this package's scope.
