# Lane: ask

Ask, saved answers, decisions, checks and Not yet (design screens AS-01 to AS-19). Branch `claude/lane-ask`.

## What a person can do

- **Ask from the menu (AS-01).** Ask › New lists every published calculation, grouped by topic (sales, collections, cash, stock, tax), with what each needs and a plain calendar of named periods on the April to March year. Suggested questions come first: the ones you asked most, then the starter questions. While the published meanings are still a starter pack's, unchanged, the page and every answer say **seed**. No model is needed: the menu is the way to ask.
- **Type a question (AS-02, AS-03, AS-08, AS-09).** A typed question is read without any model, against the published calculations only (the reviewed alias pack plus a fixed English and Hindi word table). One match gives the line "what Chausar understood" (calculation, period, group) with Change; two give exactly one question back ("Which did you mean?"); none gives **Not yet** with the reason, nearby calculations, and a row on the wanted list. A business word Chausar does not know is named ("Not sure what 'gmv' means"). A request to do something (send, remind, pay…) is Not yet from Ask and goes on the wanted actions list. A rule that stops the answer for your seat is said in words.
- **An answer (AS-04).** One big figure from the calculator receipt, the check line ("Checked against the receipt. N rows, M left out.") which opens the number guard's list, months of the period with no rows loaded named in words, coverage gaps in words, labels (seed, what if, stale). Save, Save as a check, Why did it change, Record a decision.
- **The receipt (AS-05), the rows (AS-06), what was sent (AS-07).** The six parts, the sources with their way in and recipe state, five version numbers, the Allowed by line; every counted and left-out row with its cells as written; the exact text that went to a model while it is retained, then only its fingerprint (for an answer from the menu: nothing was sent).
- **Why did it change (AS-10).** The same published sum for two periods, split by customer, branch, source or kind. Measured bars add up to the change exactly (checked with BigInt before anything is shown). Possible causes are separate sentences labelled Guess, with receipts for and against; an outside source names itself and when it was fetched. Reopening checks permissions again.
- **What if (AS-11)** changes the price assumption through the published scenario: your books beside the books with the change, labelled What if. Nothing is written to facts.
- **Forecast (AS-12).** One receipt per month of history, then the engine's forecast evaluation backtests the linear trend against the last observed month on the latest six months held back. The forecast is the answer only when its error is lower; otherwise the baseline is the answer and the page says so. Under 24 months: "Not enough history to test a forecast." Labelled projection.
- **The best plan under limits (AS-13, experimental).** Tries price changes in a stated range through the published scenario, keeps those meeting every limit, recommends the highest revenue one and names the tight limit, or names the limits that clash.
- **Saved (AS-14)** with stale marks (meaning changed, books changed, new rows in its period, access changed) and Rebuild; after a source is deleted, only the question and "Something it used was deleted on D" remain.
- **Decisions (AS-15).** One sentence and a review date become a draft in the inbox; Confirm records it in the decision journal with its receipts as known that day. Decisions due for review are listed. Text forwarded from the phone (experimental) lands as a draft only.
- **Checks (AS-16).** Save an answer as a check; Run all now; each says same, moved or cannot run, with old and new receipts. Checks run again by themselves (scheduler, autonomy on) when the meanings, a recipe, the model route or the app version change.
- **Not yet list (AS-17)**: wanted calculations, wanted actions and unknown words, each with how often.
- **Search (AS-18)** over saved items, checks, why-changed pages, decisions and investigations, on this computer.
- **Purchases against GSTR-2B (AS-19).** Matched; differs inside or outside your tolerance; in 2B only; in your books only. The IMS list (accept, reject, pending, with the reason) and a CSV export for a person to act on in the GST portal. Not applicable for a composition or unregistered business; "not loaded yet" when there is no 2B for the month. Chausar never acts in the portal.

## Engine methods (`askx.*`)

All in `platform/runtime/modules/lane-ask.ts`, code in `platform/runtime/ask/`. Exact payloads and replies: `platform/runtime/ask/contracts.ts` (the list at its end). Private state lives in the vault under `extensions.ask`.

| Method | Permission | Notes |
|---|---|---|
| `askx.menu`, `askx.suggest`, `askx.understand`, `askx.wanted` | read | Menu, suggestions, typed question → proposal / choose / no-match / refused |
| `askx.run`, `askx.answer`, `askx.guard`, `askx.receipt`, `askx.sourceRows`, `askx.sent` | read | Through `calculation.run` and `receipts.get` |
| `askx.save`, `askx.saveRef`, `askx.rebuild`, `askx.unsave` | prepare | `askx.saved` is read |
| `askx.checks.save`, `askx.checks.run`, `askx.checks.remove` | prepare | `askx.checks.list`, `askx.checks.get` are read; `tick` reruns on change |
| `askx.why.start`, `askx.why.get` | read | `askx.why.guess` is prepare |
| `askx.whatIf`, `askx.plan`, `askx.forecast` | read | Through `calculation.run`, `forecasts.evaluate` |
| `askx.decisions.draft`, `confirm`, `discard`, `review` | prepare | Through `decisions.journal.*`; `askx.decisions.forward` is prepare and the only phone method |
| `askx.decisions.inbox`, `list`, `get`, `askx.search`, `askx.gst2b`, `askx.gst2b.line`, `askx.gst2b.exportIms` | read | `askx.gst2b.tolerance` is prepare |

Refusals are the lane's own fixed codes (listed on the ask line of `laneRefusals` in `app/desktop/preload.cjs`): `ASK_INVALID`, `ASK_NOT_FOUND`, `ASK_NO_DICTIONARY`, `ASK_NO_CALCULATION`, `ASK_STOPPED_BY_RULE`, `ASK_REFUSED`, `ASK_CHANGED`, `ASK_STALE`, `ASK_NOT_GROUPABLE`, `ASK_BRIDGE_NOT_EXACT`, `ASK_CANNOT_REBUILD`, `ASK_NOT_FORECASTABLE`, `ASK_FAILED`. Core refusals are translated into these, so no outside text reaches a screen.

`purge`: a deleted source turns each saved item that used it into its question and the deletion date, and removes checks and why-changed pages that used it. `tick`: reruns checks when something they depend on changed.

## Screens

The place module is `app/ui/src/places/lane-ask.tsx` → `app/ui/src/screens/ask/lane/AskPlace.tsx`. It draws **Ask › Saved, Decisions, Checks and Not yet**. Every view (menu, answer, receipt, rows, sent, why, what if, forecast, plan, GSTR-2B, search, saved, decision, check) opens on a small in-page stack with Back, and every lane page has "Ask from the menu". Addresses with `?sheet=why`, `whatif`, `forecast`, `plan`, `gst2b`, `search`, `answer.<receiptId>`, `decision.<id>`, `check.<id>` or `why.<id>` open that view directly. Shared parts built here for promotion: `parts/RankedBars`, `parts/Bridge` (measured bridge, BigInt-scaled, written out instead of drawn if parts do not add up), `parts/ForecastLine` (past, forecast with band, baseline). Every word is in per-file catalogues in English and Hindi; every figure opens the lane's own receipt view; viewer seats get no change controls; all replies are validated before drawing (`client.ts`, `core-replies.ts`, each analysis screen's validators).

## Audit: AS-01 to AS-19

Each entry's Shows, States, You can, Engine and Rules lines were checked against the screens and the engine, in Simple, Guided and Books and in English and Hindi. This table is the state after the engine gaps it found were closed.

| Screen | State | What is missing |
|---|---|---|
| AS-01 The ask page | done | Voice and Ctrl K belong to the host's ask line. The menu shows in Ask › New only when the host hands that address to `askPlaces` (see assumptions); it is one press away from every lane page. |
| AS-02 What Chausar understood | done | — |
| AS-03 One question back | done | — |
| AS-04 An answer | done | The two meanings of "sales" are offered as one question back, not as two answers side by side. |
| AS-05 The receipt | partial | Recipe "accepted by" and the meaning's reviewer and co-signer (the import and dictionary records do not carry them); the forecast method sits on the forecast page, not the receipt; the rule id and deciding check of the Allowed by line. |
| AS-06 The rows behind a number | done | — |
| AS-07 What was sent | done | — |
| AS-08 Not yet | partial | No "needs data: …" reason; Ask a person (`support.askAPerson`, day 10) is another lane's. |
| AS-09 Stopped by a rule | done | The rule is named by kind (branch, source, seat, access, marking) in fixed words; the rule's own text needs `trust.explain` (another lane). |
| AS-10 Why did it change | done | An investigation completes in one step, so there is nothing to resume; reopening re-checks access. |
| AS-11 What if | done | No branch picker on the form (the engine takes `branch`). |
| AS-12 Forecast | done | — |
| AS-13 Best plan under limits | done (experimental) | — |
| AS-14 Saved | done | Reached from every lane page; the host's retained what-if list draws `#/ask/saved` first. |
| AS-15 Decisions | done | Typing only (voice is the host's). |
| AS-16 Checks | done | — |
| AS-17 Not-yet list | done | — |
| AS-18 Search results | done | — |
| AS-19 Purchases against GSTR-2B | partial | A line opens its two source rows as written, not a calculator receipt; group and line amounts are written as text, not figures. |

## Labels

| Feature | Label |
|---|---|
| Menu, suggestions, typed question → proposal / one question back / Not yet / stopped by a rule | supported |
| Answer with receipt, number guard list, months not loaded, coverage words | supported |
| Receipt in six parts, rows counted and left out, what was sent (menu answers: nothing) | supported |
| What was sent for a model-written answer (`askx.sent` finding the model preview by question) | experimental (needs a live model route) |
| `askx.guard` over model-written text | supported (tested on synthetic text) |
| Saved with stale marks, Rebuild, deleted-source words | supported |
| Why did it change: measured bridge plus labelled guesses | supported |
| What if (price assumption) | supported |
| Best plan under limits | experimental |
| Forecast against baseline (restated-diagnostic backtest) | supported |
| Decisions: draft, confirm into the journal, review, inbox | supported |
| Decisions forwarded from the phone (`askx.decisions.forward`) | experimental (needs the phone channel) |
| Checks, Run all, rerun on change through the scheduler | supported |
| Not yet list, search | supported |
| Purchases against GSTR-2B with IMS list and export | supported on imported `gstr2b` facts; experimental against real 2B files (depends on the connectors-ext import shape) |

## Tests

- `platform/tests/ask-engine.test.ts` (24): the whole engine on synthetic businesses, and the regressions from two adversarial reviews: per-member lists and checks; hidden rows never marking stale; corrected rows; the number guard against bypasses (units, scale, sign, invisible characters, joined digits, other numerals, number words) and its structural dates, years and ordinals; GST left-out rows; forecast scope and reuse; checks run by the scheduler as each seat; figures withheld after narrowed access; a single confirm; owner-set tolerance; viewers keep nothing.
- `frontend-validation/tests/ask-core.test.tsx`, `ask-analysis.test.tsx`, `ask-audit.test.tsx`, `ask-wiring.test.tsx`: every screen against a fake `rpc`, both languages, three views, viewer seat, not built, invalid replies, and each engine field.

## Cross-lane assumptions

- **frame-today (host composition).** Ask › New and the bare Ask address stay with the host, which draws the model route picker and the conversation there; Ask › Saved is drawn first by the host's retained what-if surface. To show the lane's menu in New (the "no model connected" way to ask, AS-01) and the lane's Saved (AS-14), the host should hand those addresses to `askPlaces` when its own surface is idle. Until then both are reached from every lane page. The frame's `navigate` prop records the address without moving the hash, so `AskPlace.leave` also sets the hash.
- **connectors-ext.** GSTR-2B lines are read as facts of kind `gstr2b` (or `gstr-2b`) with `gstin`, `invoiceId`, `amountMinor`, `taxMinor`, beside the purchase register (`purchase`). If that lane imports 2B under another shape, `TWO_B_KINDS` and `key()` in `platform/runtime/ask/gst2b.ts` are the one place to adapt.
- **reports-tools-trust.** AS-08 "Ask a person" (`support.askAPerson`, RP-08) and AS-09 `trust.explain` are not built here; the screens show the fixed rule sentence and an Open Trust link.
- **work-books.** "Rebuild" for stale answers uses the lane's own `askx.rebuild`, not `history.rebuild`.
- Core methods called through `host.call`: `calculation.run`, `receipts.get`, `forecasts.evaluate`, `forecasts.get`, `decisions.list`, `decisions.review`, `decisions.journal.draft|confirm|review`, `investigations.list`.

## Core edits

- `app/desktop/preload.cjs`: the ask line of `laneRefusals` lists the lane's refusal codes (the permitted edit).

## Still missing

- Ask a person (AS-08, day 10) and `trust.explain` (AS-09) belong to other lanes.
- "Recorded later" comes from an optional decided-on date kept by the lane; "cancelled" is a decision whose last review was rejected. The journal itself has neither.
- The number guard is deliberately strict: number words ("one customer", "doubled") and any non-decimal numeral make it fall back to the template explanation. Dates, months with years, financial years, introduced years ("in 2026", "2026 में") and ordinals are recognised by structure.
- Asking about another member's receipt id says "stopped by a rule", while an id that does not exist says "not found" (the core's translation); ids are random.
- See the audit table for each screen's remaining partial items.

## Round 4

What changed, by item in ROUND4.md's "ask" section:

- **AS-05 provenance.** `askx.receipt` carries `provenance` (recipes accepted by, the meaning's reviewer and co-signer, the forecast line, the Allowed-by rule id, check and device), read field by field from the core lane's receipts (`provenanceOf`); `null` until core-data records it, and the screen says "not recorded yet".
- **AS-08 needs data and Ask a person.** A question about data no calculation covers says which data it needs (`needs-data`: GSTR-2B, Form 26AS, stock, bank statement, payroll) and whether it is loaded; every Not yet offers Ask a person through reports-tools-trust's `reportsx.askPerson`.
- **AS-09 the rule's words.** `askx.explainRule` asks reports-tools-trust's `trust.explain`; until it exists the reply is `not-built` and the screen keeps the fixed kind sentence (supported up to that boundary).
- **AS-11 branch picker.** `askx.menu` lists the branches the seat can see; What if passes the chosen one.
- **AS-19.** The match now runs through connectors-ext's own GSTR-2B recipe and matcher. That recipe writes the suppliers' lines as kind `purchase` in their own source, so the earlier `gstr2b`-kind assumption is kept only as a fallback. Probable matches are their own group, never counted as matched; two registers or two 2B reads ask which to match. Lines become receipts when core-data serves `coredata.gst2bReceipt`. An integration test imports the real GSTR-2B fixture through `connectorsx.importPreview`/`importCommit`.
- **AS-04 two meanings side by side.** The screen runs each meaning and shows the answers as different measures, each with its own receipt.
- **BK-17/SH-04 telling, not asking.** A statement typed into Ask ("Remember that…", or a sentence that tells rather than asks) is offered to Memory through work-books' `books.memoryPropose` (`askx.tell`); it waits for the owner to confirm it.
- **Receipts.** An unknown receipt id and another seat's receipt give the same answer (`ASK_NOT_FOUND`) on every method; only a seat's own receipt can be "stopped by a rule".
- **AS-02 `ask.change`, SH-04 `ask.stop`.** `askx.change` changes a proposal and records the correction as structure only. `askx.stop` stops this member's running forecast, plan or checks run (`ASK_STOPPED`).

## Round 4 contracts

Methods this lane serves (all in `platform/runtime/ask/contracts.ts`, list at its end):

| Method | Payload | Reply |
|---|---|---|
| `askx.change` | `{ operationId!, period \| periodId, branch, change!: { operationId, period \| periodId, branch }, today }` | `UnderstandReply` (proposal) |
| `askx.stop` | `{}` | `{ stopped: true, at }`; the stopped call refuses `ASK_STOPPED` |
| `askx.tell` | `{ text!, kind!: 'preference' \| 'claim' }` | `{ state: 'proposed', memoryId, status } \| { state: 'not-built' }` |
| `askx.explainRule` | `{ rule!: 'branch' \| 'source' \| 'seat' \| 'access' \| 'marking', receiptId, sourceId, language: 'en' \| 'hi' }` | `{ state: 'ready', ruleId, text, changeableBy } \| { state: 'not-built' }` |
| `askx.gst2b` (changed) | adds `registerSourceId`, `gstr2bSourceId` | adds state `choose-sources`; `ready` adds `via`, `sources`, `matchReceiptId`, group `probable`, `unknownTax`, line `receiptId` |
| `askx.understand` (changed) | — | adds `statement` and `no-match` with `reason: 'needs-data'`, `need`, `loaded` |
| `askx.receipt` (changed) | — | adds `provenance` |
| `askx.menu` (changed) | — | adds `branches` |

Methods this lane consumes from other lanes:

| Method | Owner | Contract assumed | Until it exists |
|---|---|---|---|
| `receipts.get` → `receipt.provenance` | core-data | `{ recipes?: { sourceId, recipeId, acceptedBy, acceptedAt }[]; meaning?: { publishedBy, reviewedBy, coSignedBy, reviewedAt }; forecast?: { method, learnedFrom, testedOn }; allowedBy?: { ruleId, check, device, memberId, at } }` | `provenance: null`, "not recorded yet" |
| `coredata.gst2bReceipt` | core-data | `{ registerSourceId, gstr2bSourceId, period, toleranceMinor }` → `{ receiptId, lines: { key: 'GSTIN\|INVOICE\|FY', receiptId }[] }` | lines open their two rows |
| `trust.explain` | reports-tools-trust | `{ rule, receiptId?, sourceId?, language? }` → `{ ruleId, text, changeableBy: 'owner' \| 'owner-or-cofounder' }`, registered on their branch at `86fd0b1`; `ruleId` may hold `:` and `+` | `not-built`, fixed kind sentence |
| `reportsx.askPerson` | reports-tools-trust | `{ question, reason, receiptId? }` → `{ file, sent: false }` (exists) | — |
| `books.memoryPropose` | work-books | `{ text, kind, receiptId? }` → memory line `{ id, status }` (exists) | `not-built` |
| `connectorsx.envelopes`, `connectorsx.gstMatch` | connectors-ext | as served (exist) | older local match on `gstr2b`-kind facts |
