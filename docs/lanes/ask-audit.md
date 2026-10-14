# Ask lane: audit of AS-01 to AS-19

Checked one entry at a time against `docs/specs/CHAUSAR-APP-DESIGN.md` (the Ask entries, part 7 words, part 8 views, part 10 states) and the screens in `app/ui/src/screens/ask/lane/`. The engine contract is `platform/runtime/ask/contracts.ts`. This audit did not edit anything under `platform/`. Where a screen needs something the engine reply does not carry, that is listed as an engine gap and nothing was invented in its place.

Rules checked on every screen: the UI does no business arithmetic (exact strings go through the kit helpers only); every known figure opens its receipt; a missing value is words, never 0; every reply is validated; a viewer seat gets no control that changes anything; outside text is drawn as text nodes only; every word is in the file's own en and hi catalogues; plain CSS Modules with the existing tokens.

## What this pass added

- **Part 8, Simple view money in rows.** `rowMoneyFigure` in `kit.tsx` shows the short form spelled out ("₹12.35 lakh") in Simple-view rows (Saved, Checks). The exact value stays in the figure's title and the figure opens the same receipt. Tiles, sheets and the receipt stay exact.
- **AS-01.** A plain calendar (From and To dates) under the period choice. It runs menu rows with an exact `period`, and says so when the first date is after the second. The suggestion button text now comes from a catalogue template.
- **AS-04.** The stale state now has a **Rebuild** action (it used to say "Try again"), and a viewer seat does not get it. Two or more figures are shown as different measures, each a figure that opens the receipt, in every view (in Books also with its key). Several months not loaded are counted in words ("2 months not loaded yet: …"). An empty period with months not loaded shows the part 10 "Not enough loaded to tell" state.
- **AS-05.** The small print now lists the way in for each source, the recipe and its state, each exchange rate with its date, and the full "Allowed by" line, as well as the five versions. Sources are shown in the Simple view too, because the receipt must always name the recipe and its state. When the question came through a tool connection (`allowedBy.device === 'mcp'`), the page says: "Only the text handed to the tool is visible."
- **AS-06.** When every row is hidden from this seat, the page now says that, and no longer also says "No rows were counted".
- **AS-12.** When the baseline is the answer, the answer tile itself says so ("Next: Oct 2026, from the simple baseline").
- **AS-14.** A stale item that cannot be rebuilt now has a sentence saying so (and still has no Rebuild). There are words for `ASK_CANNOT_REBUILD` in both refusal catalogues. The kind-and-date line is one template.
- **AS-15.** The rows Chausar is waiting on no longer open as decisions, because they are questions. The order is drafts, then due, then waiting, and the screen marks each section.
- **AS-16.** A moved check labels its two tiles "Old value" and "New value", each opening its own receipt, and says that each one does.
- **AS-17.** Each list heading is one catalogue template, so no sentence is joined from pieces.
- **AS-19.** `leftOut` (required by the contract) is validated, and the screen says how many rows were left out of the match and that they are not counted as zero. `bookRowId` and `twoBRowId` are validated too. The Books view adds the five groups as a table (count, taxable value, tax). Guided and Books say that the amounts come from the rows as written, because the match has no receipt of its own yet.

## Audit table

| screen | done or partial | what is missing (after this pass) | engine gaps |
|---|---|---|---|
| AS-01 The ask page | done | Voice-first "Hold to talk" (Simple) and Ctrl K (Books) belong to the host's ask line, not this module. | none |
| AS-02 What Chausar understood | done | none | none |
| AS-03 One question back | done | Not Yet when the answer still does not settle the question is the engine's job. Once a choice is picked, it runs. | none |
| AS-04 An answer | partial | "Rows may not be sent to the model: the explanation is from a template and says so": the page says "written from a template", but it cannot say why. "Two meanings give two numbers, each with its own receipt": both measures are shown, but they open the same receipt. Simple view hides the written explanation. | `askx.run`/`askx.answer` `explanation`: no reason code (for example `rows-not-sent`, `no-model`) for why the template was used. `AnswerReply.figures[]`: no `receiptId` per figure, so two meanings cannot each open their own receipt (also `understand` returns `choose` rather than both answers). |
| AS-05 The receipt | partial | Recipe "accepted by", who published, reviewed and co-signed the meaning, the forecast method on the receipt, the rule id and which check decided, the Demo clock label, Export, Open the recipe. The two dates are always shown (as of, worked out on); there is no separate "as known on a past date" flag. | `askx.receipt`: no `recipe.acceptedBy`, no `meaning.{publishedBy, reviewedBy, coSignedBy}`, no `forecast` method block, no `allowedBy.{ruleId, decidedBy}`, no `demoClock` label, and no `sent.route` kind to tell "your own Codex or Claude Code tool" apart from `device: 'mcp'`. `reports.export` is not an `askx.*` method. |
| AS-06 The rows behind a number | partial | "Rows hidden from this seat: a line says how many and why." The line says they are hidden and why (a rule in Trust), but not how many. | `askx.sourceRows`: `hidden` is a boolean. When the receipt is forbidden it returns `total: 0` with no count of hidden rows (part 10: show the count unless it is fewer than three), and no rule name. |
| AS-07 What was sent to the AI model | done | The words "after 30 days" are general ("after the time you set") because the reply does not carry the retention days. | `askx.sent`: no `retentionDays` for the "removed after N days" sentence. |
| AS-08 Not yet | partial | A reason such as "needs data: the GST file for September". Ask a person (day 10). | `askx.understand` `no-match`: `reason` has no `needs-data` with what is needed. There is no `support.askAPerson` method. |
| AS-09 Stopped by a rule | partial | The rule in plain words: the screen gives a general sentence and "The owner in Trust", not the actual rule. | `ASK_STOPPED_BY_RULE` carries no rule id or words, and there is no `trust.explain` in `askx.*`. |
| AS-10 Why did it change | partial | Long investigations as resumable plan steps: the steps are drawn, but they are always done and there is nothing to resume. | `WhyReply.steps[].state` is only `'done'`, and there is no `askx.why.resume`. A guess cannot cite receipts other than the two figures from the UI form (the engine takes `forReceiptIds` but the screen has no picker for other receipts), so the form sends none. |
| AS-11 What if | done | No branch picker on the form, though the engine takes `branch`. | none |
| AS-12 Forecast | done | none | none |
| AS-13 The best plan under limits | done | none | none |
| AS-14 Saved | done | Opening a saved what-if goes to an empty What-if form rather than the saved result. | `askx.saved`: no way to read a saved what-if back by its `refId` (there is no `askx.whatIf.get`). |
| AS-15 Decisions | partial | "Questions Chausar is waiting on" is drawn but always empty. Replaced or cancelled is not shown on an opened decision. Say or paste one sentence: typing only (voice is the host's). | `askx.decisions.inbox`: `waiting` is always `[]`. `askx.decisions.get` (`DecisionReply`) has no `replaced` or `cancelled`, only `revision`. |
| AS-16 Checks | done | none | none |
| AS-17 The not-yet list | done | Actions are drawn as their own list, but they arrive only once actions exist (day 7). | none |
| AS-18 Search results | done | A "saved" hit opens the Saved list, not the one item. | `askx.search` saved hits carry the saved id only, not its kind, `receiptId` or `refId`, so the screen cannot open the item itself. |
| AS-19 Purchases against GSTR-2B | partial | "Each line opens its receipt": a line opens its two source rows as written, and group and line amounts are text, not figures. | `askx.gst2b`: no `receiptId` for the match, for a group or for a line. Group and line amounts cannot be figures that open a receipt. |

## Across screens (part 8, part 10)

- **Read only:** the banner line and the hidden controls are done. "The page says who holds the pen" is not: `PlaceMember` carries only `id` and `role` (host gap, not engine).
- **Loading:** the frame is drawn at once with a still state. "What was known last time, with its time" would need a cache the host owns.
- **Access removed / seat ended:** these arrive as refusal codes, and the screens show the fixed failed state with the code. There are no dedicated words, because the replies carry no `by` or `on`.
- **Views:** Simple shows short money in rows, hides the forecast and plan links and the written explanation, and shows one chart. Books shows tables (rows, the GSTR-2B groups), keys, the full small print and ISO times. Guided is the default.
