# Checked presentation boundary

This isolated foundation follows the supplied frontend/build/screens/enterprise design and the frozen source map in `task-18/code-contracts.md`. It does not activate the new renderer or replace an existing journey. No dependencies were installed; the existing engine dependency junction was read only.

## Canonical component data

`presentation.ts` defines exact discriminated figures: INR whole paise strings, whole count strings, and whole basis-point strings. Every known figure requires a nonempty `receiptId` and explicit `labels`, including `[]`. Missing figures have one of seven categorical states and no numerical fallback. Header counts are metadata and remain distinct; `null` is never changed to zero.

Rows offer a local `open-sheet` intent only. Addresses use the actual known place/sub-place schema and optional `?sheet=<opaque-id>`; engine identities such as `action_<uuid>` and `receipt_<uuid>` keep their underscores unchanged. Foreign schemes, extra path segments, arbitrary/duplicate queries and encoded foreign targets fail. A guess row cannot carry a known money, count or percent figure, including measured zero; categorical missing may remain. Today validates four attention rows at most, five attention/worth-a-look rows combined, six day events at most, stable unique identities and explicit state. Chart points may be a known figure or an explicit missing gap. A chart cannot mix money, counts and percents. Chart geometry may scale supplied values; it may not infer trends, ratios, totals or missing points.

Call `validateToday`, `validateFigure`, or the relevant validator **before** projecting or showing a reply. Validation rejects undeclared fields, getters, nonplain prototypes, corrupt dates, unsupported discriminants, inexact numbers and invalid evidence references. It returns a cloned, deeply frozen value. Failure exposes only `INVALID_REPLY` and a structural path, never the rejected value or raw exception text. Client failures expose only fixed short codes.

A locked Today requires empty rows, stats and day events and a null pending count. Retained evidence or action context in a locked reply fails before projection. The host must also replace the workspace surface with its trusted unlock slot when the canonical state is locked; the boundary does not authenticate or invent an unlock flow.

## Current engine evidence

`CalculationReceiptEvidence` is explicitly a selected subset of `platform/runtime/calculator.ts`'s exported `CalculationReceipt`; it is not the proposed design's new Receipt DTO or a complete unchanged receipt. `projectCalculationReceipt` consumes the actual full serialized DTO and selects retained identity, clocks, periods, exact figures/display strings, rows, coverage, exclusions, assumptions, definition/dictionary hashes, explanation, staleness and allowed numbers. Published definitions, compiled artifacts and database proofs remain engine-owned; they are checked as JSON extensions but are not exposed by this subset. A complete six-part receipt component needs the full typed engine adapter.

The corrected frozen `ce5dc4f6c432ce637b23cbd26f159346acdcd68e` receipt also carries optional `requestedSourceIds`. Its absence and an explicit empty list remain different. This reviewed selection is retained separately from counted-row `sourceIds`; bounded distinct source identities are checked, and counted sources cannot escape an explicit selection.

The adapter does not sum rows or compare figures to a sum. Margin, change, scenario and aging have different engine algebra. Nor does it require `selectedRows = countedRows + excludedRows`; exclusions may describe records outside the requested period. It does check row identity correspondence and the engine's positive source-row/retained-row-count invariants.

`figureFromReceipt` selects the named exact engine figure and preserves its receipt identity. Basis points become percent figures, never money. A foreign-currency amount cannot be relabelled INR. Empty coverage produces categorical unknown. Partial coverage with no counted rows also produces unknown: current engine fixtures cover all-unknown measures and unresolved conflicts that have an arithmetic zero. Reconciled coverage with an explicitly reported zero preserves zero. Partial coverage/staleness remain on the retained receipt; stale is the only provenance label derived from this current DTO. No seed, forecast or model qualification is invented. `engineFigureDisplay` retains the engine's original display for evidence inspection.

The full-receipt projection consumes a **serialized** reply. The existing desktop engine harness forks with default JSON serialization and the browser RPC uses JSON, which omit optional `branch: undefined` emitted by the direct core constructor. A direct untransported DTO with undefined fields fails strict validation; no general-purpose normalizer hides corruption. If a future host uses advanced structured-clone IPC, its typed adapter must deliberately handle declared optional engine fields before this boundary.

## Formatting exports

All number/date formatting stays in `format/`:

```ts
import { figureText, money, count, percent, date, time } from '../format/index.ts';
const checked = validateFigure(rawFigure);
const display = figureText(checked, catalogMissingWords);
// Known examples: money('31000000'), count('124500'), percent('3140').
const headingDate = date('2026-10-01', 'long', 'en');
const eventTime = time('2026-10-01T00:35:00.000Z', 'Asia/Kolkata');
```

`money` and `count` use exact BigInt Indian grouping. `percent` receives basis points and rounds half up to at most one decimal at the display boundary. `moneyShort` takes catalog-owned lakh/crore words; its exact `money` display must accompany the abbreviated figure in title/accessibility text and a receipt. `moneySpoken` takes catalog-owned names for 0..99 and rupee/paise/group words. Hindi number names are irregular and must come from that catalogue. Full sentences and plural messages still belong to the text/ICU layer; the spoken-number helper is not a Hindi language review.

`missing(state, words)` and `figureText(figure, words)` take all seven fixed localized words from the caller's text catalogue. `points` takes its catalog word. `age` and `year` take their catalog prefix. Dates use `en-IN`/`hi-IN`; workspace timezones are explicit. None of these functions performs business arithmetic or persists display rounding.

## Component projection

`project-ui.ts` validates unknown input before building explicit preformatted projection DTOs. Its exports are `projectFigureForUi`, `projectMetadataCountForUi`, `projectRowForUi`, `projectChartForUi` and `projectTodayForUi`. `UIFormatContext` supplies language, workspace timezone and the complete missing-state catalogue; optional spoken-money words qualify the amount-in-words accessible name. It defaults to three stats, with an explicit host layout capacity of three, four or twelve. An overflow fails rather than silently dropping engine data.

The projection retains exact figure strings, every receipt reference and every supplied label. It leaves absent source actions absent. A row can offer Open only when its checked local sheet intent exists. Row/day action maps are returned separately for the controller to resolve; no component calls a transport.

Only Columns, Line and OrderedBar are currently implemented in this component slice. `projectChartForUi` returns an explicit unavailable state for absent series, unsupported chart forms, a chart with no points or one with only missing points. Every projected stat carries `chartState`, so the component can show the localized limitation instead of an empty plot. Chart points retain explicit missing gaps and source labels. Line endpoints come from those source labels, never generated dates. Unsupported forms remain in the canonical eleven-form contract for the full scope.

The common Today projection preserves ready/empty directly and other states as `boundary-state.source`; it does not invent a holder, rule owner, missing-month count or stale date to satisfy a richer component state. It formats supplied dates/instants only. It does not create day figures, receipt IDs, cash entries, Books queue rows, close steps, enterprise lens/scope or approval targets/steps that were absent from the canonical input. Those require their respective full engine adapters. Source-without-stats yields explicit unknown; source-without-series yields `CHART_NOT_PROVIDED`.

These are actual independent projection types, not React stubs. `tests/type-contracts.ts` checks assignments to the real component `FigureOrMissing`, `Count`, `RowItem`, `Chart`, `ChartAvailability`, `StatTile`, `DayEvent`, `ScreenState` and `TodayData`. All pass strict TypeScript without casts: exact nullable counts, all figure labels, readonly chart points, explicit chart availability and the neutral canonical state are structurally compatible. This checks DTOs, not a React build or runtime host wiring.

## Checked Today host seam

`today-host.ts` maps the actual corrected Engine's `dashboard.get` and `reports.brief` envelopes. The former contains four calculation receipts or operation errors; the latter contains investor-report section summaries and a weekly brief with draft delivery. Neither supplies the finalized Today aggregate pending count, attention/worth-a-look rows, day-event contract or chart series. They are explicit unavailable capabilities, never totals or empty-business claims inferred from action lists or historical activity.

`createDesktopTodayReader` and `createBrowserTodayReader` use distinct injected ports. Both reread **every** successful aggregate receipt, including receipts outside the chosen stat slots, through the existing checked receipt readers before returning. This is necessary because the current dashboard does not reauthorize its earlier receipts after later awaited calculations. An access/lock/unavailable denial suppresses the complete result and invalidates concurrent generations. Inputs are detached before an await, no retry is automatic, and errors expose only fixed codes.

`DashboardTodayInput` supplies a title, ISO display date, an explicit `request` and up to three `{operation, figureKey}` selections. Dashboard forwards only `period`; it does not support source, branch or as-of filters. `BriefTodayInput` exposes its actual useful period/as-of/branch/customer/order/source/on-date/ritual filters. Selected labels come from existing engine figures. Margin `contribution` stays money and `marginBps` stays percent; omitted ratios and unsupported currencies remain explicitly unavailable. No ratio or financial total is computed by this adapter.

`projectDashboardToday` and `projectBriefToday` validate bounded serialized envelopes, receipt IDs and exact shared fields against supplied freshly authorized receipt DTOs. Dashboard immutable receipt fields must match; only the fresh staleness annotation can change. Brief section summaries must match the corresponding full evidence. `statsEvidence` retains the source's exact display/unit, receipt ID, actual period/as-of/branch/currency/requested-source scope and coverage. Current receipts do not retain customer/order filters as explicit scope fields, so this adapter does not invent those provenance fields. The aggregate state is partial with `asOf: null`: sequential operation timestamps are not represented as an atomic business snapshot.

Brief weekly headline and local-draft delivery remain separately typed metadata. Report HTML, opaque decisions/actions/jobs/activity and raw operation failures are not rendered or forwarded. Report gaps mix coverage with raw error messages; only actual fresh coverage gaps and the report's fixed investor-annex qualification leave this boundary.

Use `projectTodayHostForUi(result.value, formatContext)` when displaying this partial host result. It preserves receipt bindings and unavailable metadata, and adds `earlierTodayMissing: 'unknown'`, so the absent event contract cannot display “Nothing has happened yet today.” Generic `projectTodayForUi` is unchanged: an authoritative ready-empty view can still represent truly empty activity. The host-specific projection rechecks evidence bindings before formatting and remains structurally compatible with actual `TodayData`.

The host must request the intended calendar month explicitly, or show the actual supplied period; arbitrary/all-time figures cannot acquire the fixed “This month” heading through the display date alone. This seam is not automatically mounted into the new renderer. Trusted context/authority/lock changes must invalidate readers and clear the visible view; receipt opens still need a fresh current-authority read. Live service, native database, React/runtime and desktop/browser asset qualification remain separate.

## Actions and privacy

`approvalControls` uses only engine-offered `can`. A read-only seat has no mutations. Prepare-only has no approval. Unknown actions offer reconciliation only when writable and offered; they cannot approve, revise or resend. Reconciliation is valid only for unknown state. Executing/terminal states have no mutation offers. Money always needs a second ask and never acquires Ctrl+Enter approval. These are UI guards; the engine must independently recheck exact digest/revision, current access, grants and expiry before any action. No execution method is exposed by this read foundation.

`PhoneHeadlineView` contains fixed template keys and opaque link intents, never free-text names, amounts or receipts. Unknown extra fields are rejected recursively. `phoneActions` removes approval offers when the supplied UI clock reaches expiry; it never lengthens a preview. Current source caps phone approval at five minutes, while the finalized PH-01 design specifies thirty minutes. Host/engine owners must settle and implement that mismatch; this UI does not override the engine expiry or alias the older desktop phone policy to the companion protocol.

`CAConsoleView` allows client company labels plus status dates/counts/states. It contains no business figures, receipts, documents or customer rows. The cross-client view cannot spread a raw workspace result into a row.

## Separate host ports and remaining integration

`contract.ts`/`client.ts` implement three distinct injected read adapters:

- Desktop: existing `receipts.get` through the trusted engine port.
- Browser: the same desktop-engine RPC schema through a separate browser host port.
- Enterprise: existing `/v1/investigations/:id` status API; no desktop receipt alias.

They re-read evidence and validate reply IDs; they do not cache a formerly authorized receipt, retry uncertain requests, read credentials, connect to a network, or choose endpoints. The trusted host calls `invalidate()` on workspace/identity/access/lock changes; late completions or failures then expose only `READ_INVALIDATED`. Access-denied, locked, unauthenticated and evidence-unavailable replies also invalidate concurrent reads and return fixed codes. The host must clear any previously rendered evidence when `isEvidenceDenial(code)` is true. Error code accessors are never invoked; raw error text is never forwarded. The trusted host owns origin, authentication and transport. Receipt/broad Today capabilities are not claimed live merely because source exists. The current engine lacks the finalized aggregate pending count and general chart DTO. A future engine-authored Today projection must supply them or explicitly mark them missing. Enterprise result, CA and phone live-host adapters remain distinct integration work.

Run the foundation tests with Node 24 native type stripping and `tests/tsconfig.foundation.json`. That strict config checks these dependency-free sources plus boundary tests and intentionally does not pretend to typecheck React without the absent React/Vite/types packages. Its Node type roots check local frontend dependencies, the integrated repository dependencies, and the current read-only sibling integration junction as a fallback. No package is installed or fabricated for these checks.
