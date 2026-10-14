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

## Status

<!-- STATUS -->
