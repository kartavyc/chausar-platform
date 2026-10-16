# Venture launcher: delivery (P5)

This package is how agents help with client work in this build: a playbook they follow, practice runs with made-up clients, a launch ladder, draft replies to real orders, and an honest list of what the build can do.

One rule shapes all of it: a draft may say work was done only when a tool run proved it. With no files, an agent has only the client's message, so it drafts and promises and never reports work as done; a check refuses any sentence like "we matched each entry" or "your books are reconciled", and the judge asks the same question. With files, the agent works through them with tools in a bounded loop, and a claim passes only when a tool run of the matching kind backs it. The loop, the tools, the sandbox, the work products and the improvement loop are described in [harness.md](harness.md).

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
| `improve.ts` | The gated improvement loop: `venture.improve.status`, `.run`, `.get` and `.adopt` |
| `harness/` | The delivery harness: tools, the agent loop, client files, the work calculator, the dictionary, the sandbox tiers ([harness.md](harness.md)) |
| `shared.ts` | Small read helpers |

Tests: `platform/tests/venture-delivery.test.ts`, with synthetic recordings in `platform/tests/fixtures/venture/delivery/`, and `venture-harness.test.ts` and `venture-harness-runs.test.ts` for the harness.

## The playbook

`venture.delivery.playbook` returns the playbook the business uses: the one the venture record points at. It needs an accepted plan (`BLUEPRINT_NOT_ACCEPTED`). When that playbook was built from the same plan digest in the harness format, it is returned as it is; otherwise a new version is built from the plan, the patches the owner adopted are applied again where they still fit, and the version is validated, stored, linked from the venture record, and `playbook-ready` is emitted. Versions are never overwritten.

| Step | Kind | Tier | Model | Done by | Tools | Checks |
| --- | --- | --- | --- | --- | --- | --- |
| gather | gather | actor | fast | agent | files, dictionary, hand-offs | |
| clarify | question | actor | fast | agent | dictionary.resolve, hand-offs | questions-raised |
| work (the plan's step 2 title) | work | wasm-lite | fast | agent | calculator, reconcile, bills, sandbox, hand-offs | |
| price | compute | code | none | agent | | figures-resolve |
| draft (the plan's step 3 title) | write | actor | main | agent | none: tools off | the six draft checks |
| verify | verify | code | none | agent | | every check except questions-raised and turn-limit |
| approve | approve | code | none | you | | |
| send | operator | code | none | you | | no-outside-writes |

With no files the gather, clarify and draft steps still run as **one** delivery model call over the client's message. With files they run as the agent loop in [harness.md](harness.md): act turns that call the agent steps' tools, then the write step. Collecting files from the client and sending stay with the owner; the send step is the owner copying an accepted draft, and Chausar sends nothing. Each step can carry guidance lines that the improvement loop adds and removes; the writing step's guidance reaches the drafting model.

`validatePlaybook` refuses duplicate ids, a code, approval or operator step with a model, a work step without one, a tier above `container` or one that is planned (`wasm`, `hosted`), an unknown tool, tools on any step that is not an agent step (the writing step has them off), any outside-write tool, a writing step without required sections or without the done-claim check, and an operator step that comes before an approval step. The hash covers the steps, the limits and the dictionary words, and every rehearsal and real run records it.

## Draft replies

The model never sees an amount or a date. It gets refs with words-only labels:

- prices: for rehearsal, `offer_1.unit`, `offer_1.total` and `offer_1.tax` (tax only when above zero) for each offer with a current price receipt; for a real order, `order.unit`, `order.total` and `order.tax` from the order's receipt;
- dates: `today` always, and `order.created` for a real order.

The validator turns the model's flat output into a draft: headings only from the plan's required list, each once; one to twelve parts per section; text through the number guard with tokens copied from the client's message and the idea (so "B2B" passes and a new "500" fails); figure and date parts only with refs that were offered. A figure renders as its receipt label and display, for example `Total: INR 2,948.82`, so the label says what the number is. Dates use the country's date order.

The judge sees `Total: [price from Chausar]` and `[date from Chausar]` instead, so no receipt amount leaves under standing consent.

The template outline is what runs when no AI serves the drafting tier: one sentence per required section that promises work ahead, the plan's total in the second section when a receipt exists, and the question "Is anything missing that we should know before we start?". For a real order its text starts with "Template outline. No AI wrote this and it doesn't read the client's request." The owner copies the outline to a client, so its words speak to the client: the price line reads "Here is the price for this work. Total: INR 2,948.82", never "your plan", and no sentence mentions more questions than the one it asks.

## Checks

`no-numeric-prose`, `figures-resolve`, `required-sections`, `no-outside-writes`, `house-style`, `length-bounds` (40 to 12,000 characters), `turn-limit`, `questions-raised` and `no-done-claims`. Each returns a plain sentence. `no-outside-writes` always passes in this build, and its sentence says why: every outside effect is only recorded.

With the harness, `figures-resolve` also accepts the run's work receipts, `required-sections` asks for the report headings (Summary, What we did, What needs your answer, Next steps) once a tool run proved a work product, and `no-done-claims` passes a claim only when a tool run proved that kind of work (the table is in [harness.md](harness.md)). House style and length are checked on the agent's words; the reconciliation Chausar attaches is code-rendered from a receipt and holds client text, so it is left out of those two.

## Rehearsal

`venture.simulation.run { scenarioIds?, episodes?, useTemplate? }` builds the playbook first (its own transaction), then for each practice client: a client turn, an agent draft, and, when the draft asked questions, one more client turn and one more draft. What would have been sent is recorded as a mock effect (a digest, never sent). Then the checks, then the judge when a model serves the fast tier. Every model call runs outside any transaction; one transaction stores the run at the end, moves the venture from `build` to `rehearsal`, and emits `simulation-finished`. With one practice client per request and no practice files, a request makes at most five model calls.

Bookkeeping's clean and messy practice clients send practice files. When an AI serves quick work, their episodes run the agent loop instead: the client turn, up to four act turns, a practice client answer for each hand-off while the scenario's turns allow, the write step and the judge, so at most nine model calls. The tables and work receipts the tools made are stored with the run, and the episode keeps the loop's record (`harness`).

Costs come from the model port's outcomes and are summed with BigInt. When any outcome came from an unconfirmed price table, the display ends with "(estimate, price unconfirmed)".

## The launch ladder

- **rehearsal**: made-up clients only. A real order can get a template outline, not an agent draft.
- **shadow**: needs a passing, judged rehearsal of all three practice clients with the current playbook. Agent drafts for real orders are practice drafts: they can be edited or rejected, never accepted.
- **approve each**: one step up from shadow. Drafts can be accepted, edited or rejected. The venture status becomes `live`.
- **approve a sample** and **auto with spot checks** are planned and always refused with `STAGE_PLANNED`.

Moving down is always allowed; moving up is one allowed stage at a time (`LAUNCH_STAGE_BLOCKED` with the reason otherwise). Moving down is the owner's safety lever when an agent misbehaves, so every step of a real order checks the stage again (see Real orders).

When shadow is closed, the reason says why, in words that match what the rehearsal really did:

| What the newest rehearsals show | Reason |
| --- | --- |
| Every practice client with a run was rehearsed by templates alone | "Connect an AI and rehearse with it first. Template outlines can't be judged." |
| A practice client has no run with the current playbook, or was rehearsed by templates alone while others used an AI | "Rehearse all three practice clients with the current playbook." |
| An AI took part, but templates wrote the drafts | "Template outlines can't be judged. Rehearse each practice client with your AI writing the drafts." |
| The AI wrote the drafts, but templates serve quick work, so no AI judged | "Your AI wrote the drafts, but no AI judged them. Connect an AI for quick work, then rehearse again." |
| The AI's draft was refused, or the episode stopped, so nothing was judged | "Your last rehearsal was not judged. Run it again with your AI." |
| Every practice client was judged, but one failed | "Every practice client must pass. Rehearse the ones that failed again." |

## Real orders

`venture.delivery.run { orderId, useTemplate? }` decides first whether a template or a model will write, so a blocked request stores nothing. A template outline works at any stage and is ready at once. An agent draft needs shadow or approve each; it stores the exact text the model will receive and waits. When the order has files (`venture.files.add`), the run is the agent loop: each turn waits for approval of its exact text, a hand-off waits in `needs-answer` for `venture.delivery.answer`, and the last approval stores the report with its reconciliation attached. The stage rules below apply to every turn.

`venture.delivery.approve { runId, digest }` reads the waiting draft outside any transaction, then asks the model port to send the approved text once (the port claims the call first, so two approvals send once). The draft is rendered and checked, and one action stores it. A failed check stores a `check-failed` signal. Before anything is sent, approve refuses with `LAUNCH_STAGE_BLOCKED` unless the stage is shadow or approve each now, so a draft made at approve each and approved after a move down to rehearsal never reaches the model. The store step checks the stage again (it can move while the call is out): at shadow the answer is stored as a practice draft whatever the stage was when the draft was made; at rehearsal nothing is stored and the run is marked `failed`.

`venture.delivery.review` accepts, edits or rejects a ready draft. A practice draft refuses `accepted` with `PRACTICE_DRAFT`, and so does any agent draft while the stage is below approve each; an edit or a rejection made then is stored as a practice draft, so it is never copied to a client. A draft that failed a check can't be accepted as it stands (`INVALID_VENTURE_REQUEST`, "This draft claims work that was not done. Edit it or reject it." for a done claim, or "This draft failed a check: ... Edit it or reject it." for any other); the owner edits it, which records a signal, or rejects it. A rejection needs a reason from the list. Edits and rejections store signals. `venture.simulation.fromSignal` turns a signal into a rehearsal case built from the messy practice client, with checks focused on the reason. It never copies the client's request.

## Choices made where the spec left room

1. **What "judged" means.** A rehearsal row counts as judged only when the run was not template only, every agent draft for that client was written by a model, and every judge answer is a real answer. This follows the contract's own comment ("judged means a model wrote and a judge answered"), so a run where templates wrote the drafts and a model only judged them can't unlock shadow.
2. **The shadow reason.** The spec names two reasons; this package adds four more so an owner who rehearsed with an AI is never told to connect one (the table under The launch ladder). "Connect an AI" shows only when every practice client with a run was rehearsed by templates alone.
3. **Model answers that fail in rehearsal.** When the model's answer is refused (`MODEL_OUTPUT_REJECTED`, `MODEL_REFUSAL`, `MODEL_INCOMPLETE`), that practice client fails with a sentence such as "The draft was refused: ..." and the run is still stored. Any other error (no key, budget, send setting) stops the request.
4. **A draft that can never be approved is marked failed.** If the approved call was claimed and then failed, or its answer could not be stored, the draft is marked `failed` (preview cleared) and the owner drafts again. A stale approval (`APPROVAL_STALE`) leaves the draft waiting only while its preview is live: before `expiresAt` and with the model call still a preview. After the preview's thirty minutes the next approval marks it `failed`, so the list doesn't keep a draft that looks approvable and is not. A wrong digest, the send setting or the budget while the preview is live leaves it waiting. One limit: after an app restart the model port forgets the previews it held in memory, so for the rest of those thirty minutes an approval is refused as stale and the draft still shows as waiting; the first approval after the thirty minutes marks it failed.
5. **`venture.simulation.run {}`** runs the three template practice clients. Signal cases run only when named.
6. **The template practice client** answers a follow-up question with "That is all I can share for now. Please go ahead with what you have."
7. **The practice client's history** holds only the agent's questions, never the rendered draft, so no amount reaches the practice client either.
8. **Signal cases** keep five core checks (numbers, prices, outside writes, turns, done claims) and add the checks for the reason, for example `required-sections` for a missing section.
9. **Moving to the stage you are on** changes nothing and returns the ladder. Moving down from approve each sets the venture status back to `rehearsal`.
10. **`capabilityList`** takes an optional fourth argument, the model presets, so a model row can name the preset and its availability words. Without it, Anthropic presets that serve a tier count as available and the others as unverified, as in the models table.
11. **The stage is checked at every step of a real order**, not only when the draft is made: at approve before anything is sent, again when the answer is stored, and at review. Moving down always wins.
12. **Accept needs every check to pass.** The spec allows accept at approve each; this package also refuses a plain accept when a check failed, because the owner copies an accepted draft to a client in one click. Editing is always open, so the owner keeps the last word.

## How it was checked

- `node --check` on every file in this package and the test (see the note below on what it misses).
- Scoped typecheck with the scratch compiler (`typescript@5.9.3`, the repo `tsconfig.json`) over `platform/runtime/venture/delivery/**` and `platform/tests/venture-delivery.test.ts`, filtered to these paths: no errors.
- `node --test platform/tests/venture-delivery.test.ts`: 21 of 21 pass. Rules were broken on purpose and a test caught each one: practice drafts at shadow, what counts as judged, the stage check at approve (before the send and when storing), the practice flag when storing, marking a spent draft failed, the stage check at review, the stale preview rule, accept after a failed check, and the shadow reason.
- A scratch probe outside the suite drove these methods through the real engine and the real model port with the end-to-end recordings: a wrong digest leaves the draft waiting; an approval after moving down to rehearsal sends nothing; a draft made at approve each and approved at shadow is a practice draft that accept refuses; the US template outline reads "Here is the price for this work. Total: USD 300.00" and can be accepted.
- `node --test platform/tests/desktop-harness.test.ts platform/tests/desktop-ipc-methods.test.ts platform/tests/venture-contracts.test.ts`: 29 of 29 pass.

## Hand-off note

**Done:** everything in section 8 of the build spec: the twelve handlers, the exported helpers, the tests in 8.7 and the fixtures.

**Contract change needed (for the integrator):** in `contracts.ts`, `ModelConnectionRecord` and `ModelCallRecord` each add `kind: ModelRouteKind` on top of `RecordBase`, whose `kind` is the record kind. The two literal types can't both hold, so TypeScript reduces both record types, and `ModelConnectionView`, to `never`. P2 found the same thing and stores the route kind as `routeKind`. Rename the field to `routeKind` in both record types. This package does not depend on the fix: `runs.ts` looks up a model call by id only and reads its `status`. **Applied in Phase C.** Both record types now carry the route as `routeKind` in `contracts.ts` (commit `b8752df`), and the models package, the engine and e2e tests and the renderer fixture read them through the contract types (commit `9faee82`).

**Wiring changes needed:** none.

**Found while checking (for the integrator):** on this machine (Node 24.13.1), `node --check` exits 0 for a `.ts` file with an `export` and a plain syntax error (tried with `export const a: string = 'it's broken';` in this package's folder, then removed). So `scripts/check.mjs` does not catch syntax errors in the engine's ES module TypeScript files; only the typecheck does. Run the full typecheck in Phase C before trusting `check.mjs`.

**For P6 (end-to-end):** the steps in section 11 that touch this package should pass as written: the rehearsal draft fixture matches only requests that offer `offer_1.total`, a real order offers only `order.*` refs, and the template path gives `modelMode: 'template'`, `costMicros: '0'` and the "Connect an AI" reason.

**For P7 (screens):** a run's `practice` flag means the screen shows "Practice draft. Not for the client." with no Accept, Copy or Save; `servedBy: 'template'` means the text already starts with the template outline line. Send one practice client per `venture.simulation.run` request. Review can now refuse Accept on a run whose `practice` is false: an agent draft while the stage is below approve each (`PRACTICE_DRAFT`), and any draft with a failed check (`INVALID_VENTURE_REQUEST`). The screen shows the error words today, which is safe; it would read better to offer Accept only when every check passed and, for `servedBy: 'model'`, the stage is approve each. **Applied in Phase C:** the draft sheet no longer offers Accept after a failed check and says why (commit `4ea8160`); the stage part still shows the engine's words.

**Not finished:** nothing in this package's scope.
