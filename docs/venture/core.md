# Venture launcher: core (P1)

Core turns one sentence into a plan. It owns the instant plan preview, the venture record, the country table, the interview, the blueprint and its business terms, the launch checklist and the event feed.

## What it does

| Method | Level | What happens |
| --- | --- | --- |
| `venture.countries` | none, before a vault | The fifteen-row country table, a fresh copy each time |
| `venture.preview` | none, before a vault | A plan from the idea alone, in template words. Nothing is saved, no model is asked |
| `venture.create` | admin, in the app | Sets record keeping to ten years, publishes the services dictionary in the country's currency when needed, then makes the venture and its empty interview |
| `venture.get` | read | The venture, its checklist ("7 of 12") and its terms, or `null` |
| `venture.events` | read | The venture's events after a sequence number, oldest first |
| `venture.interview.next` | prepare | Writes the questions once: two optional opening questions (model or template), then the fixed price and tax questions |
| `venture.interview.answer` | prepare | Checks one answer against its question. Prices and rates are parsed by code |
| `venture.blueprint.draft` | prepare | Code builds the structure; a model or the templates write only the words |
| `venture.blueprint.get` | read | The newest version with the price receipt made for exactly that version |
| `venture.blueprint.update` | prepare | Owner edits make a new draft version |
| `venture.blueprint.accept` | approve, in the app | Accepts the newest draft whose digest matches, makes the business terms and marks "offer" active |

Files live in `platform/runtime/venture/core/`: `countries.ts`, `service-types.ts`, `preview.ts`, `venture.ts`, `interview.ts`, `blueprint.ts`, `tax-fields.ts`, `checklist.ts`, `events.ts`, `lookups.ts`, `words.ts` and `index.ts`.

## How the rules hold

- **No AI arithmetic.** Owner prices go through `amountText` and `decimalMinor`; rates through `percentBps`. Model words go through `modelWords` with only the owner's own letter-and-digit tokens allowed (so "B2B" from the idea passes and a new "500" is refused). The model schemas have no number types, and the blueprint task carries no amounts.
- **Honest labels.** Every plan line says who said it: told by you, assumption (by the model, the templates or the engine), or computed. Who does each step is copied from `STEP_PLAN`, never chosen by a model.
- **The structure guard.** The structure is hashed before the model writes and again inside the write. If the answers or the plan changed meanwhile, the draft is refused with `APPROVAL_STALE` and nothing is stored.
- **No client data reaches a model.** The interview and blueprint tasks are flagged `containsClientData: false` and hold only the idea, the country, the opening answers and the fixed structure. A test seeds a client and an order first and checks every task.
- **One write path.** Every write goes through `ventureAction`. The ten-year retention and the dictionary are their own writes before the venture action, never inside it.

## Choices made inside the package

These follow the spec; where the spec left room, this is what the code does.

1. Tax labels read naturally inside a sentence: acronyms stay ("GST", "VAT"), other labels start lower case ("sales tax", "consumption tax"). So Japan's question reads "Are you registered for consumption tax, so you charge it on your invoices?".
2. Model words in the interview and the blueprint are also refused (`MODEL_OUTPUT_REJECTED`) when they hold one of the house-style words Chausar keeps out of its screens. Em dashes are already turned into commas by `tidyWords`.
3. A template plan's name is the owner's working name, labelled told by you. The default "My service business" is labelled an assumption by the templates.
4. "Rewrite with AI" keeps the owner's edits. Before acceptance, a `blueprint.update` of the first offer's price or pricing model, or of the tax switch or rate, also updates the matching interview answer, so a rewrite that rebuilds the structure from the interview keeps them. The registration number, state, SAC code, LUT and the second offer's pricing (which the interview never asks) carry over from the previous version. After acceptance the interview is closed, so every owner setting carries over.
5. The venture status never moves back: a draft moves it to `blueprint` only from `interview`, and acceptance moves it to `build` only from an earlier status.
6. Business terms are made once. A later acceptance adds only a term that is now needed and missing (for example "retainer period" after the first offer becomes monthly).
7. The United States and "another country" have no registration number field, so a `taxId` there is refused with `INVALID_VENTURE_REQUEST`. A `taxRate` while tax is off is refused with `INVALID_TAX_RATE`.
8. Without `useTemplate`, the interview and the blueprint always ask `deps.models.generate` with a template attached. When no model serves the tier, the port returns the template and nothing leaves the computer. Core never reads `models.status`, which throws `NOT_BUILT_YET` while the models package is missing.
9. `venture.get` answers `null` before a venture exists. `venture.blueprint.get` and `venture.events` refuse `VENTURE_NOT_FOUND` then.
10. The only engine code core throws that is not in `VENTURE_ERRORS` is `UNKNOWN_PACK`, the ontology's own code, if the services starter pack were ever missing.

## How it was checked

- `node --check` on every file in `core/` and on the test.
- Scoped typecheck with the scratch `typescript@5.9.3` (`core/**` and `venture-core*.test.ts`, which also follows their imports): no errors.
- `node --test platform/tests/venture-core.test.ts`: 15 of 15 pass. They cover all thirteen items in section 4.8, plus a check that every error code core throws is declared, and a role check.
- `node --test platform/tests/venture-contracts.test.ts platform/tests/desktop-harness.test.ts platform/tests/desktop-ipc-methods.test.ts`: 29 of 29 pass.
- A scratch run outside the repo against a real `experimental-file` Vault on a temp folder: the India model path (create, model interview, answers, model draft, GSTIN and SAC update, accept) and the United States template path both work, with retention at 3650 days and the dictionary republished in USD for the US.

## Hand-off note

Done: everything in section 4 of the build spec.

Contract change needed (for the integrator, it is not core's to make):

- In `contracts.ts`, `ModelConnectionRecord` and `ModelCallRecord` each declare `kind: ModelRouteKind`, which shares its name with the record kind from `RecordBase` (`kind: 'venture-model-connection'` and `kind: 'venture-model-call'`). The intersection makes `kind` the type `never`, and a record that stored the route kind under `kind` would no longer be found by `listRecords` and would be refused by `tx.put`. The models package already stores it as `routeKind` (with casts), so core's checklist item "Add your AI (optional)", which finds connections by record kind, works today. Suggested fix: rename the field to `routeKind` on both record types so the contract matches what is stored (`ModelPreset.kind` and `ModelReplayFixture.responses[].kind` are fine as they are).

Wiring changes needed: none.

Not finished: nothing in core's scope.

For other packages:

- The preview's opening questions and `venture.interview.next { useTemplate: true }` use the same template for the same idea, so the choice ids `c_1` to `c_3` the renderer shows on the plan match the stored interview.
- `venture.blueprint.update` returns the new draft. Its digest is new, so `offerReceipts` is empty until the money package quotes that version again.
