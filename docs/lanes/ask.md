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

- `platform/tests/ask-engine.test.ts` (18): the whole engine on synthetic businesses, including the review regressions (per-member lists and checks, hidden rows never marking stale, corrected rows, strict number guard, GST left-out rows, forecast scope).
- `frontend-validation/tests/ask-core.test.tsx` (18) and `ask-analysis.test.tsx` (20): every screen against a fake `rpc`, both languages, three views, viewer seat, not built, invalid replies.

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
- The inbox's "questions Chausar is waiting on" list is empty: pending conversation clarifications are not read here.
- Checks rerun on their own only for owners and cofounders (the scheduler runs as them); other seats run theirs with Run all.
- The number guard is strict: a model sentence naming a month as words with a year ("September 2026") is replaced by the template.
- Forecast builds one receipt per month on every run (bounded at 240 months), so each run adds receipts to the vault.
