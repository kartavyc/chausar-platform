# core-data (round 4)

Branch `claude/lane-core-data`. This lane fills the core data and calculation gaps of round 4: exchange rates in the calculator, receipts for connector bank and GST figures, a quantity measure, definitions with a worked example and a date used, provenance on receipts, deletion of one customer and re-applying deletions after a restore, the workspace time zone, prepared-export purge, two journal states, three trust rules, MCP withholding and encrypted Excel workbooks.

New RPC methods live in `platform/runtime/modules/lane-core-data.ts`, which spreads one methods file per part from `platform/runtime/core-data/`:

| File | Part |
|---|---|
| `calc.ts`, `calc-receipts.ts`, `calc-connectors.ts` (and core `stock-on-hand.ts`) | Exchange rates, connector and GST receipts, stock on hand |
| `provenance.ts` | Definition extras, meaning reviews, receipt provenance |
| `data.ts`, `deletion-customer.ts`, `deletion-register.ts`, `prepared-exports.ts` | Deletion, re-apply, time zone, prepared exports, journal cancel |
| `trust-rules.ts` | Staff own entries, record and field markings, keep periods, the module tick |
| `cfb.ts`, `ecma376.ts`, `workbook-password.ts` | Encrypted workbooks (no new method) |

## What was built, item by item

1. **Exchange rates applied by the calculator (BK-19).**
   - `calculator.ts` exports `registerRateSource`; `core-data/calc.ts` registers work-books' `peekRates`. The calculator imports no lane.
   - A row in another currency is converted with the owner's rate dated exactly on the row's `validFrom` day. The arithmetic is `home minor = amount × units × 10^homeDigits / (per × 10^foreignDigits)` in BigInt, rounded half away from zero, with exponents from `currency.ts`.
   - The receipt row keeps `sourceAmountMinor` and `normalization { sourceCurrency, targetCurrency, rate: { units, per, on, source, rounding: 'half-up' } }`.
   - A row with no rate for its day is excluded and counted as not counted. The receipt is `partial`, with a gap sentence.
   - Every receipt carries `coverage.notCounted` (0 when none).
   - Rows converted when they were read (`_fx`) behave as before.
   - Rates are part of the `FACTS_CHANGED` snapshot.
2. **Receipts for connector bank totals, GSTR-3B turnover and the GSTR-2B match (RP-02, AS-19).** These are `coredata.bankTotals`, `coredata.gstr3bTurnover` and `coredata.gst2bReceipt`.
   - Each is a full `CalculationReceipt` stored with an answer, and opens with `receipts.get`.
   - GSTR-2B matching reuses connectors-ext's `gst-match.ts` unchanged.
   - Identical receipts are reused rather than stored twice.
3. **Quantity measure and stock on hand.**
   - A definition may declare `measure: 'quantity'` with an integer `field`, `unit`, `item`, `balance: 'movements' | 'snapshots'` and an optional `location`. A dictionary has at most one.
   - It generates operation `stock_on_hand` (type `stock`): per item as of `onDate`, figures of unit `quantity`.
   - Units are never mixed or converted.
   - Starter packs are unchanged, because jobs-ext's tests expect the stock check to refuse with them. An owner's draft declares the quantity definition, for example kind `stock_level`, field `quantity`, unit `unit`, item `sku`, balance `snapshots`, location `outletId`.
4. **Definitions: worked example, date used, reviewer (BK-08).**
   - `Definition.example { rows: { label, amountMinor, counted, reason? }[1..12], resultMinor }`. The result must equal the counted rows times the sign.
   - `Definition.usedFrom 'YYYY-MM-DD'`.
   - Dictionaries without the new fields keep their exact hash.
   - Reviews and co-signs are recorded by the reviewer themself (`meanings.review`). They are kept outside the hashed dictionary, keyed by its hash. Work-books' `books.cosign` is read and counted.
   - `meanings.releases` names the publisher, reviewers and co-signers of every version.
5. **Provenance on receipts (AS-05).**
   - The calculator exports `registerReceiptDecorator` and `decorateReceipt`. Every calculator and connector receipt gets `provenance` when it is made, in the shape agreed with the coordinator (see the contracts below).
   - `receipts.provenance` serves the fuller view: who accepted each recipe, meaning reviews now and at calculation time, the forecast evaluation that cites the receipt, and the Allowed by line.
6. **Deletion.**
   - `deletion.customer` deletes one customer's facts, receipts, answers, actions and conversations: exactly what work-books' `holdingsOf` counts.
     - It leaves content tombstones, removes model receipts that carried those rows, marks other people's answers stale, and runs every module purge.
     - Actions that are executing or unknown are kept and reported `pending`.
   - Every customer and source deletion is written to a deletion register outside the vault. The register holds keyed hashes only: `<directory>/deletions/register-<hash>.json`, written atomically.
   - After a restore, `deletion.pending` says what came back and `deletion.reapply` deletes it again.
7. **Workspace time zone.** `workspace.setTimeZone` writes `state.workspace.timeZone`; `workspace.timeZone` and `ui.context.timeZone` serve it.
8. **Workspace delete purges `approvals.exportPrepared` files.**
   - The names come from `approvals.exported` activity and from module state.
   - Every name must match the exact export-name pattern and resolve inside `exports/`; links are never followed.
   - Keep-period clean-up remembers the names before it trims activity.
9. **Decision journal: "recorded later" and "cancelled" (AS-15).**
   - An optional `decidedOn` enters through the existing draft/confirm path. It gives `recordedOn` and `recordedLater`, and a later date is refused (`DECIDED_ON_LATER`).
   - `decisions.journal.cancel` cancels an open decision with a reason. A cancelled decision is never due and cannot be revised or reviewed.
   - Decisions without the new fields keep their digest.
10. **Trust rules enforced.**
    - **TR-06:** a member on the staff seat sees only facts they entered. Facts carry `enteredBy`, recorded by `memory.append` and import commits; an `enteredBy` sent in a payload is ignored.
    - **TR-02:** record marks hide every fact naming the record (by id, entity, customer, supplier, item, invoice or order id, and merges not undone). Field marks withhold the field.
      - Calculations exclude a withheld measure as "withheld", with its own gap.
      - Fact reads drop withheld fields.
    - **TR-04:** keep periods are enforced for model receipts, activity, briefs, exports and the learning log. This happens through the retention clean-up, a daily module tick (only while autonomy is on) and `keep.enforce`.
      - What other parts still need is held back with a reason.
11. **MCP withholding (TL-08).**
    - Calculation, `open_receipt` and `list_counted_rows` replies remove withheld fields and list them as `removed: { field, why, count }[]`.
    - Below the samples send level, an assistant gets no entity, customer, invoice or order ids on rows.
    - Figures and the number guard are unchanged.
12. **Encrypted Excel workbooks (ECMA-376 agile).**
    - A bounded compound file reader (`cfb.ts`) and agile decryption (`ecma376.ts`), using node:crypto only. Decryption verifies the password and checks the dataIntegrity HMAC.
    - `sources.workbook`, `sources.workbookPreview` and `sources.workbookImport` take an optional one-time `password`.
    - The password is never stored, logged, hashed into an input, or put in an error. Key material is zeroed after use.

## How a person uses it

- **Rates:** the owner enters a rate for a currency and day in Books. Answers count those rows from then on, and a receipt says how many rows had no rate.
- **Reports and Ask:** these can show bank totals, GSTR-3B turnover and every GSTR-2B line with a receipt you can open.
- **Stock:** a business that declares a stock measure gets stock on hand per item, with a receipt.
- **Meanings:** a meaning can carry a worked example and the date it came into use. An accountant or cofounder records "reviewed" or "co-signed" on a release.
- **Receipts:** a receipt's small print says who accepted the recipe, who reviewed the meaning, and which rule, check and device allowed it.
- **Deleting a customer:** this now removes core rows too. After restoring a backup, Chausar says what came back and re-deletes it when you confirm with the workspace name.
- **Time zone:** the owner sets the business time zone.
- **Decisions:** a decision can be dated earlier than it was recorded, or cancelled.
- **Staff and markings:** staff see only what they entered. Marked records and fields are hidden from seats that may not see them, including over MCP.
- **Keep periods:** these remove old data.
- **Locked workbooks:** a locked Excel file opens with its password, once.

## Engine methods (Round 4 contracts)

Every method is a module method behind the engine's authorization. None is phone-callable.

### Calculations

**`coredata.bankTotals`** (read)
- Request: `{ sourceIds: string[1..64], period: {from,to}, branch? }`.
- Reply: `{ receipt: CalculationReceipt, figures: Record<key, minor>, missing: Record<key, MissingState> }`.
- Figure keys:
  - `credits` and `debits`, both positive;
  - `net`;
  - `entries`, a count;
  - `opening` and `closing`, only when a committed statement's stated balances cover the date. Otherwise they are missing: `absent` or `unknown`.

**`coredata.gstr3bTurnover`** (read)
- Request and reply have the same shapes as `coredata.bankTotals`.
- Figure keys: `turnover`, `outwardTaxable`, `zeroRated`, `nilExempt`, `nonGst`, `reverseChargeInward` (never counted as turnover), `outwardTax`.
- Refuses `GST_RETURN_NOT_APPLICABLE` when the business is not GST-regular.

**`coredata.gst2bReceipt`** (read)
- Request: `{ registerSourceId, gstr2bSourceId, period: {from,to}, toleranceMinor: '0'..'10000000' }`.
- Reply: `{ receiptId, lines: { key: 'SUPPLIERGSTIN|INVOICE|FY', receiptId }[] }`, sorted by key. A probable pair uses its register line's key.
- Group receipt, operation `gstr2b_match`:
  - money figures: `booksTaxable`, `gstr2bTaxable`, `difference`, `matchedTaxable`, `inBooksOnlyTaxable`, `in2bOnlyTaxable`, `creditAtRisk`;
  - count figures: `matched`, `withinTolerance`, `amountDiffers`, `inBooksOnly`, `in2bOnly`, `probable`, `invalid`, `creditAtRiskUnknownTax`.
- Line receipt, operation `gstr2b_line`:
  - figure keys: `booksTaxable`, `gstr2bTaxable`, `difference`, `booksTax`, `gstr2bTax`, `taxDifference`;
  - a side or tax the line does not have becomes an entry in `missingFigures`;
  - `assumptions` is `{ key, group, rule?, toleranceMinor }`.
- At most 2000 register lines.
- Refuses `GST_MATCH_TOO_LARGE`, `GST_MATCH_NOT_APPLICABLE` and `GST_MATCH_SOURCES_EMPTY`.

All three refuse `SOURCE_REVOKED`, `FORBIDDEN_BRANCH`, `INVALID_CALCULATION`, `INVALID_SOURCE_SCOPE`, `INVALID_PERIOD` and `DICTIONARY_REQUIRED`.

**`calculation.run { operation: 'stock_on_hand', onDate?, asOf?, branch? }`** (an existing method)
- Figure keys:
  - `item:<sku>`, unit `quantity` with `quantityUnit`, at most 100 items;
  - `items`, a count;
  - `total`, only when every item shares one unit;
  - `itemsNotShown`.
- Rows carry `item` and `quantityUnit`.

### Receipt shape additions (every receipt)

- `coverage.notCounted: number`.
- Rows may carry `sourceAmountMinor` with `normalization`, and `item` with `quantityUnit`.
- Figures may have `unit: 'quantity' | 'count'`, with `quantityUnit` on quantity figures.
- `missingFigures?: { key, label, missing: 'not-loaded-yet'|'absent'|'unknown'|'not-applicable'|'not-counted', reason }[]`.
- `provenance?`, with these fields:
  - `recipes?: { sourceId: string; recipeId: string; acceptedBy: string | null; acceptedAt: string | null }[]`
  - `meaning?: { publishedBy: string; reviewedBy: string | null; coSignedBy: string | null; reviewedAt: string | null }`
  - `forecast?: { method: string; learnedFrom: { from: string; to: string }; testedOn: { from: string; to: string } } | null` (`null` on calculator receipts)
  - `allowedBy?: { ruleId: string; check: string; device: 'desktop' | 'phone' | 'mcp'; memberId: string; at: string }`, omitted when the caller has no channel.

### Meanings and provenance

**`meanings.review`** (prepare)
- Request: `{ version: number, hash: string(64 hex), kind: 'review' | 'cosign' }`.
- Reply: `{ version, hash, kind, by: { memberId, name }, at }`.
- Refuses:
  - `REVIEW_SELF` when the reviewer is the publisher;
  - `REVIEW_NEEDS_PERSON` for MCP or tainted callers;
  - `ALREADY_REVIEWED`;
  - `RELEASE_NOT_FOUND`;
  - `INVALID_PROVENANCE_REQUEST`.

**`meanings.releases`** (read)
- Request: `{}`.
- Reply: `{ releases: { version, hash, publishedBy: { memberId, name }, publishedAt, reviewers: { memberId, name, at, via }[] | 'not reviewed', coSigners: [...] | 'not co-signed', definitions: { name, label, example: DefinitionExample | 'absent', usedFrom: 'YYYY-MM-DD' | 'absent' }[] }[] }`, oldest first.

**`receipts.provenance`** (read)
- Request: `{ receiptId }`.
- Reply: `{ receiptId, recorded: 'recorded' | 'not recorded', recipes, meaning, forecast, allowedBy }`:
  - `recipes`: `{ sourceId, state: 'recorded', recipeId, acceptedBy: { memberId, name } | 'unknown', acceptedAt | 'unknown' }` or `{ sourceId, state: 'absent' }`.
  - `meaning`: `'absent'`, or `{ version, hash, publishedBy, publishedAt, reviewedBy, coSignedBy, atCalculation }`.
  - `forecast`: `'not applicable'`, or `{ forecastId, method, baseline, learnedFrom, testedOn, horizons, stale }`.
  - `allowedBy`: `'not recorded'`, or `{ ruleId, checkStep, device: { channel, deviceId: 'absent' }, by, at }`.
- An unknown receipt and a forbidden one both refuse `RECEIPT_NOT_FOUND`.

### Deletion

**`deletion.customerPlan`** (read)
- Request: `{ id }`.
- Reply: `{ recordId, canDelete, stores: { store: 'facts'|'receipts'|'answers'|'actions'|'conversations', count, waiting, state: 'can-delete'|'pending'|'nothing-held', reason }[] }`.

**`deletion.customer`** (approve)
- Request: `{ id, confirmation }`, where `confirmation` must equal `id`.
- Reply: `{ recordId, at, complete, rows: { store, count, remaining, state: 'deleted'|'pending'|'not-possible'|'nothing-held', reason }[], elsewhere: { store: 'source-files'|'decisions', count, state, reason }[], derived: { staleMarked, modelReceiptsRemoved, privateRemoved } }`.
- Refuses `TAINTED_APPROVAL`, `CONFIRMATION_REQUIRED`, `RECORD_NOT_FOUND` and `DELETION_REGISTER_*`.
- **Work-books' `records.delete` should call this** for the five core stores it reports "not-possible" today.

**`deletion.pending`** (read)
- Request: `{}`.
- Reply: `{ registered, kinds: { kind: 'customer' | 'source', cameBack }[], total }`.

**`deletion.reapply`** (approve)
- Request: `{ confirmation }`, where `confirmation` is the workspace name.
- Reply: `{ at, complete, kinds: { kind, cameBack, deleted, remaining, state, reason }[] }`.

### Workspace and journal

**`workspace.setTimeZone`** (admin)
- Request: `{ timeZone }`, an IANA zone.
- Reply: `{ timeZone }`.
- Refuses `INVALID_TIME_ZONE` and `TAINTED_SETTING`.

**`workspace.timeZone`** (read)
- Request: `{}`.
- Reply: `{ timeZone: string | null }`.

**`decisions.journal.cancel`** (prepare, desktop only)
- Request: `{ id, revision, reason }`.
- Reply: the journal decision with `status: 'cancelled'` and `cancellation: { reason, by, at }`.
- Refuses `DECISION_NOT_OPEN`, `REVISION_CONFLICT`, `DECISION_NOT_FOUND`, `APP_DECISION_REQUIRED` and `INVALID_CANCELLATION`.
- `decisions.journal.draft` and `decisions.journal.confirm` accept an optional `decidedOn` in the content. Confirmed decisions then carry `recordedOn` and `recordedLater`.

### Keep periods and MCP

**`keep.enforce`** (admin)
- Request: `{}`.
- Reply: `{ at, kinds: { kind: 'modelReceipts'|'activity'|'briefs'|'exports'|'learning', days: number | null, removed, held, why: string[] }[] }`.

**MCP replies** (`mcp.handle`) gain `removed: { field, why: 'personal'|'financial'|'confidential'|'withheld'|'send-level', count }[]`.
- It is always present for a numbers-only assistant. For anyone else it appears only when something was removed.
- A stored receipt whose counted measure is now withheld refuses `RECEIPT_CHANGED`.

### Encrypted workbooks

`sources.workbook { bytesBase64, sheet?, password? }`, `sources.workbookPreview` and `sources.workbookImport { sourceId, bytesBase64, sheet?, recipe?, expectedTotals?, password? }` refuse:
- `PASSWORD_REQUIRED`: a locked workbook and no password.
- `WRONG_PASSWORD`.
- `WORKBOOK_PASSWORD_INVALID`: not a 1–255 character string.
- `WORKBOOK_INTEGRITY_FAILED`.
- `WORKBOOK_ENCRYPTION_UNSUPPORTED`: Standard, RC4 or extensible encryption.
- `WORKBOOK_ENCRYPTION_INVALID`.
- `WORKBOOK_CFB_INVALID`.
- `WORKBOOK_LIMIT`.

These codes were agreed with the coordinator for connectors-ext.

## Core edits

| File | Change and reason |
|---|---|
| `calculator.ts` (owned) | The rate hook and conversion, `notCounted`, the stock calculation, the `withheldMeasure` exclusion and its gap, the receipt decorator hook and `decorateReceipt`, new figure and missing-figure types. |
| `ontology.ts` (owned) | Optional quantity binding, `example` and `usedFrom` on definitions, and the `stock` operation type. |
| `workbook.ts` (owned) | Password option; compound files go through decryption. |
| `trust.ts` (owned) | `visibleFacts` drops hidden facts and withheld fields. New `factFor`, `withheldMeasure` and `registerRetentionHook`; clean-up runs retention hooks. Source deletion notes the deletion register (one call). |
| `mcp.ts` (owned) | `discloseRows` and `removed` in replies. |
| `decision-journal.ts` (owned) and `reports.ts` (journal facade) | `decidedOn`, `recordedOn`/`recordedLater`, `cancelled` and `cancelJournalDecision`. |
| `contracts.ts` | Optional `Fact.enteredBy` and `Fact.withheld` (read copies only); a `factWithheld` core hook beside `sourceHidden`; optional `workspace.timeZone`. Needed for TR-06 and TR-02 in every fact read path, and for item 7. |
| `memory.ts` | `canSeeFact` uses the new hook; `selectFacts` and `history` return copies without withheld fields; `insertFacts` records `enteredBy`. Every fact read goes through these. |
| `ingest.ts` | One line: an import commit passes `ctx.memberId` as the author (TR-06). |
| `engine.ts` | Two fenced additive edits. `sources.workbook*` pass `password` to `readWorkbook` (item 12), and `workspace.delete` adds the prepared-export purge to `copiesRemoved` (item 8). No new `case`. |
| `workspace-interchange.ts` | `compareRecalculatedReceipt` ignores `provenance` as it ignores `id` and `createdAt`: provenance is issuance metadata, not a semantic change. |
| `stock-on-hand.ts` (new core file) | The pure stock-on-hand computation. |
| `app/ui/src/bridge/validate.ts`, `app/ui/src/bridge/today-engine.ts`, `app/ui/src/bridge/presentation.ts` (frame-today) | The renderer's exact-key receipt checks accept the new optional keys, with strict types, and pass `provenance` on. Without this the packaged UI refused every receipt (`INVALID_REPLY`). Nothing was loosened. |
| `app/desktop/preload.cjs` | The core-data `laneRefusals` line only; `client.ts` is regenerated. |
| Test expectations | `desktop-ui-bootstrap` (`notCounted: 0`), `database-fixtures` (a foreign currency is now not counted rather than refused), `today-tiles-imported`, `workbook.test.ts` (a truncated compound file is `WORKBOOK_CFB_INVALID`), `workspace-interchange-acceptance` and `private-trials-public-acceptance` (provenance ignored in replay comparison). |

## Supported or experimental

| Feature | Label |
|---|---|
| Exchange rates in calculations, not counted on every receipt | supported |
| Bank totals, GSTR-3B turnover, GSTR-2B group and line receipts | supported (synthetic connector data in the connectors-ext shapes) |
| Stock on hand | supported (with a declared quantity definition) |
| Definition example, date used, reviews and co-signs, release history | supported |
| Receipt provenance | supported; the device id is `absent` until core-sync-jobs provides one |
| Customer deletion of core rows | supported |
| Deletion register and re-apply after restore | supported for customers; experimental for sources through the engine (see gaps) |
| Workspace time zone | supported |
| Prepared-export purge on workspace delete | supported |
| Journal recorded-later and cancelled | supported |
| Staff own entries, record and field markings | supported |
| Keep periods for every kind | supported; activity is mostly held back (see gaps) |
| MCP withholding | supported |
| Encrypted workbooks (agile) | supported on synthetic workbooks built to the spec; experimental against files saved by Excel itself (no real Excel file in the repo) |

## Still missing (and who closes it)

- **Callers to adapt:**
  - work-books: `records.delete` must call `deletion.customer`, and `books.draft` must carry `example`/`usedFrom`.
  - reports-tools-trust: `connector-pages.ts` should call the three `coredata.*` receipts; `tools-assistants.ts` still stores `removed: []`; the `core-keep.ts` words still say non-fact kinds are not enforced.
  - ask: read `receipt.provenance`, `coredata.gst2bReceipt`, `decisions.journal.cancel` and `decidedOn`; `ask/answers.ts` types a unit as money or basis points.
  - frame-today: `BringFile.tsx` must send locked workbooks to the engine and act on `PASSWORD_REQUIRED`/`WRONG_PASSWORD`; first-run `contracts.ts` must accept a quantity definition and a `stock` operation.
  - connectors-ext: forward the held `password`.
- **Staff and actions:** the staff "own" rule covers facts, receipts and conversations. `actions.list` still shows source-linked actions to anyone who can read the source; that needs a change in `actions.ts` (core-gateway-auth).
- **Activity keep:** the reports lane's tamper-evident record links nearly every activity entry, so those are held back. The record needs a safe way to drop old links before activity can actually shrink.
- **Source deletion register timing:** the register entry for a source deletion is written before the vault commit. If that commit fails, re-apply would offer to delete a source that was not deleted. It still needs the owner's confirmation.
- **Rates and staleness:** `books.setRate` (work-books) does not mark earlier answers stale.
- **Aging:** if an invoice's link fields are withheld, aging refuses `AGING_LINK_REQUIRED` instead of giving a partial number.
- **Workbook size:** the engine's base64 cap (about 2.1 MB) can refuse an encrypted workbook that `readWorkbook` itself would accept (up to 2.5 MiB).
- **Allowed by ids:** `ruleId` and `check` are identifiers (`policy.allowed-sources:all`, `source-grant:<ids>`, `member-access`; `source-access+number-guard`), as ask reads them.
- **Device id:** provenance reports the device id as `absent` until core-sync-jobs adds devices.

Nothing in this lane needs the founder.
