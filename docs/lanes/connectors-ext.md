# connectors-ext: every system, read and import depth

Branch `claude/lane-connectors-ext`. This lane builds the connector factory: a typed recipe language, a registry of recipes for every approved group, read adapters for systems with their own interface, a plain-database connector, GST matching, and the `connectorsx.*` engine methods that the Books, Sources screens and first run call.

Every operation here has been tested on synthetic data only. The plan's bar for **supported** is the bench and at least one hidden business, which a person must run. So nothing in this lane is labelled supported yet; the label below says what was tested and how.

## How a person uses it

1. **Add a source** (BK-03). `connectorsx.systems` lists the 56 groups. Each group lists its operations, and each operation has a depth (import, read or full), a way in (file, its own interface, database), a status and its evidence count. A claim is per operation, never per logo.
2. **Connect**. `connectorsx.connect` stores the system, way in, company, branch and *non-secret* settings (region, organisation id, store address, loopback port, ledger list). A setting that looks like a credential is refused (`CREDENTIAL_NOT_ACCEPTED`). Each connection gets its own source id, so the same record arriving by a file and by the interface counts once.
3. **Sign in**, where the system needs it. `connectorsx.signIn` opens the system's own page in the browser with PKCE (Google, Zoho, HubSpot, Xero, QuickBooks, Shopify). Key-based systems (Razorpay, Stripe, WooCommerce) say where to create a read-only key. Tally needs no sign-in.
4. **Bring a file or read now**. `connectorsx.importPreview` runs a recipe over a CSV/TSV/JSON/XML text export, a worksheet, or a bank PDF. `connectorsx.read` reads through the system's interface. Both return an *envelope*: system, company, period, when it was fetched, the checks against the source's own totals, rows loaded and excluded, unmapped fields, and either accepted, refused (with the reason) or abstained (with one question).
5. **Import**. `connectorsx.importCommit` writes an accepted envelope into facts through the core importer. Nothing from a refused or abstained envelope reaches an answer.
6. **See freshness** (BK-01). `connectorsx.freshness` gives twelve monthly squares per source: loaded, not loaded yet, refused, failed. A month not loaded is words, never zero.

## The recipe language

A recipe (`platform/runtime/connectors-ext/recipe.ts`) is data. It names columns by their source headings, maps source words to dictionary kinds and statuses, says which rows are excluded and which column sets the sign, and lists dictionary outputs. It **must** name its check against the source's own totals:

- `footer-row`: the export's own Total / Grand Total row.
- `declared`: a structured total the source states (a JSON summary, a settlement amount, an API count, a database aggregate).
- `running-balance`: opening balance plus every entry equals each running balance and the closing balance.
- `report`: the export truly has no total, so the person types the total from the system's own report. `{ kind: 'report', declaredCount: 'accepts' }` (only for recipes over records a system read): when no total is typed and the system stated its record count for exactly the filter read, the read is accepted on that count alone (`source-row-count: passed`, `source-total: unavailable`, provenance `source-declared-count`, and a notice that the amount was not checked). A typed total is still checked in full, beside the count.

`compileRecipe` refuses a recipe without a totals check (`RECIPE_TOTALS_REQUIRED`), with code in it, with an unstated date format, or with an unregistered decoder. Decoders are registered engine code chosen by recipe id; the source never chooses code.

At run time the interpreter:

- **Abstains** with one of five reasons and one question: `ambiguous_field` (two columns fit), `unknown_value`, `date_format` (two readings), `currency`, `sign_convention`.
- **Refuses** with a fixed sentence and a line number where there is one: `SOURCE_CUT_SHORT` (total row, summary or closing balance missing, or a quote left open), `SOURCE_TOTAL_MISMATCH` and `SOURCE_ROW_MISMATCH` (filtered or cut files; the two totals travel as typed `checks`, never inside the message), `BALANCE_BROKEN` (names the line), `MISSING_AMOUNT` (missing is never zero), `DUPLICATE_SOURCE_ROW`, `MIXED_CURRENCY`, `SOURCE_TOTALS_REQUIRED`.
- **Lists unmapped fields**: headings no recipe field and no ignore list covers.
- **Counts a repeated row once** when it is identical, and refuses a conflicting duplicate.
- **Keeps outside text as data.** Instruction-shaped text in cells changes nothing; every family's tests plant one.

Measures are money (exact paise as strings and BigInt) or counts (sessions, tickets, commits). Money goes through the core `ImportService`, which validates the dictionary, branch access and deletion and checks the totals a second time. Counts are written as `quantity` facts under the same access and deletion rules.

## Engine methods (`connectorsx.*`)

| Method | Permission | What it does |
|---|---|---|
| `systems` | read | 56 groups, operations with depth, road, status, evidence; board counts; the sign-in method per group. Reads `writeback.catalogue` when it exists. |
| `recipes` | read | Every compiled recipe: input kind, totals kind, measure, sensitivity, notices, fields and headings. |
| `connections`, `connect`, `pause`, `disconnect` | read / admin | Connections without credentials. Disconnect keeps imported facts (Books, Sources deletes them). |
| `signIn`, `signInComplete` | admin (complete is external) | PKCE browser sign-in. The code exchange is the host credential broker's job. |
| `read` | prepare, external | A read through the system's interface (18 operations), then the recipe. Per-read `parameters` such as a settlement id. |
| `importPreview` | prepare | A file through a recipe: text, `bytesBase64` worksheet, or `pdfBase64` bank statement through the Python helper. |
| `importCommit`, `discard` | prepare | Import an accepted envelope, once. |
| `envelopes`, `freshness`, `unmapped` | read | Read history per source (BK-02), twelve-month squares (BK-01), "fields no recipe covers". |
| `gstMatch` | read | Purchase register against GSTR-2B: matched, amount mismatch, in books only, in 2B only, probable (never auto-matched), invalid. Composition and unregistered businesses get "not applicable" with the reason. |
| `plainDb.tables`, `plainDb.read` | admin / prepare, external | Read-only PostgreSQL, MySQL and SQLite with the database's own aggregate as the source total. |
| `credentials.set`, `credentials.remove`, `credentials.status` | admin / admin / read | Keys typed in Trust, credentials go into the sealed local store, never into workspace state; status says only whether one is present. |
| `schedule` | admin | A repeating read for one connection: interval, freshness target, catch-up rule (`run-once` or `skip`), optional `autoImport`. |
| `tally.exporter`, `tally.importExport` | prepare | Tally on another computer: a PowerShell script holding the same read-only requests, a one-page guide (English and Hindi), and the answer file replayed through the same reader and recipe. |
| `tally.companies`, `tally.ledgers` | admin, external | The companies open in Tally and the ledgers of one, for "Which company?" (BK-03). |
| `recipes.answer`, `recipes.answers`, `recipes.answerRemove` | prepare / read / prepare | Answer a recipe's question in place, for one source and recipe version (BK-05). |
| `recipes.upgradeDiff`, `recipes.reconcile` | read / prepare | What changed between the recipe a read used and the current one; re-total an import's live facts against the source's own total. |
| `screenExport.start`, `screenExport.collect` | prepare, external | A desktop program's own export, collected over the driving lane's `session.*` (Round 4, experimental). |

Methods that reach outside, store a way in, or move secrets (`connect`, `pause`, `disconnect`, `signIn`, `signInComplete`, `read`, `plainDb.*`, `credentials.*`, `schedule`) refuse callers that are not the person at the desktop (`OPEN_DESKTOP` for phone, MCP and source-tainted contexts). Reads check the caller's branch and the source's trust before any request, and the listings show only connections in the caller's branches and allowed sources.

Refusal codes a screen may need are listed on this lane's line in `app/desktop/preload.cjs`. Demo mode refuses every `external` method (`DEMO_EXTERNAL_DISABLED`). `purge` removes every envelope and pending row derived from a deleted or revoked source.

## Coverage, by build-list item

Labels: **experimental** = works and is tested end to end on synthetic data, but no real export, account or hidden business has been checked. "Synthetic-tested" is the catalogue status `tested`.

### The connector factory — experimental

- Catalogue of 56 groups (`catalogue.ts`), 55 with at least one road in. 42 groups at import depth, 13 at read depth. Full depth (write) is the writeback lane's and shows as planned until `writeback.catalogue` answers.
- Typed recipes with source-total assertions, abstention and unmapped-field lists (`recipe.ts`, `decoders.ts`, `values.ts`, `tabular.ts`).
- 86 compiled recipes; 18 interface read operations.
- Fixture harness (`harness.ts`): 64 hand-checked cases in `fixtures/connectors/*/cases.json`, run by `connectors-ext-harness.test.ts`. Every file recipe is accepted on at least one case. API recipes are covered by recorded-response tests, worksheet and PDF bank recipes by the bank tests.

### Read adapters with real HTTP clients — experimental (never run against a live account)

Built on `adapters/read-kit.ts`: allowlisted HTTPS origins (loopback only for Tally), no redirects, page, byte, request and time budgets, loop detection, typed failures (`SOURCE_SIGN_IN_EXPIRED`, `SOURCE_RATE_LIMITED` ...), nothing retried automatically. The token comes from the engine credential broker per origin and never reaches results, logs or state.

| System | Operations | Source total |
|---|---|---|
| Tally | Sales and Purchase Register over the XML interface; ledgers; list companies | Tally's own group movement (or the report total when credit notes or journals are in the period) |
| Zoho Books | Invoices gross (list), and net through a bounded per-invoice detail read (at most 49 invoices per read; a longer period is read in up to 8 parts by date, `ZOHO_DETAIL_BUDGET` for a single day that does not fit) | Declared count (accepted on it alone); report total checked when typed |
| Xero, QuickBooks | Invoices | Declared count (accepted on it alone); report total checked when typed |
| Razorpay | Payments, settlements, settlement recon | Settlement's own amount for recon |
| Stripe | Payout reconciliation | Payout amount |
| Cashfree | Settlements, with header-key sign-in set by the runner | Report total |
| PayU | Settlement details, signed sha512(key\|command\|var1\|salt) by the runner; the salt never leaves the computer | Report total |
| Shopify, WooCommerce | Orders | Declared count checked; Shopify's amount from the report total; WooCommerce accepted on its count alone when no total is typed |
| Google Workspace | Sheets and Drive (`drive.file` only), Calendar | Sheet's Total row; counts with report totals |
| Zoho CRM, HubSpot | Deals (a won deal is never a sale) | Zoho CRM: report total. HubSpot: its count of matching deals (accepted on it alone); report total checked when typed |

### Import depth through recipes — experimental (layouts from memory, not checked against real exports)

- Books: Vyapar, BUSY, Marg (sales and purchase), myBillBook, Khatabook, OkCredit, BharatPe, Petpooja.
- Marketplaces: Amazon settlement V2 (its own total row), Flipkart, Meesho.
- Money: Paytm, PhonePe, Instamojo; restaurant partner payout annexures; quick-commerce sales.
- Bank statements: CSV and Excel in five synthetic bank layouts (deposit/withdrawal and amount+Dr/Cr), with running-balance continuity, the statement summary's own counts and totals, and a refusal naming the line where the balance breaks. PDF through the Python helper with a generic line parser. Scanned pages go to OCR (experimental): tesseract over an in-memory page render inside the helper's limits, only for pages with no text layer, each page above a confidence floor (default 80, `PDF_OCR_LOW_CONFIDENCE` otherwise), and the running-balance check still decides. Without OCR installed: `OCR_DEPENDENCY_UNAVAILABLE`. The envelope says when a page was read by OCR. Tested with real tesseract 5.3.4 on a synthetic image-only statement.
- GST: GSTR-1 (with and without the portal summary), GSTR-1 notes, GSTR-2B (portal ITC summary), GSTR-2B notes, GSTR-3B supplies and ITC, e-invoice (single and batch, each document against its own `AssVal`), e-way bills.
- Form 26AS (each deductor's transactions against its own totals) and AIS (reported, processed and accepted never mixed; never summed with 26AS).
- Shiprocket, Delhivery, Unicommerce, Zoho Inventory, Keka, greytHR, Zoho Payroll, RazorpayX Payroll (no employee names imported), Chargebee, Freshdesk, Meta Ads, Google Ads, Google Analytics, YouTube, Instagram, Mailchimp, Notion, Slack, Microsoft 365 (canonical sheet), WATI/Interakt, PostHog, GitHub.


### Export layouts: checked or still unconfirmed

Each recipe's notices carry one line saying which. "Checked" means compared with a published sample export, official schema docs or open-source exporter code; most samples are real export files people published in public repositories. 17 checked, 26 still unconfirmed; `microsoft-365.canonical-sheet` is Chausar's own layout.

| Recipe | Layout |
|---|---|
| vyapar.sale-report | checked (headings and DD/MM/YYYY; total row not shown in the sample): github.com/mehulbasu/trevito-dashboard docs/vyapar.md |
| amazon-seller.settlement-v2 | checked: github.com/guysolan/thetis reports v2.txt |
| meesho.order-payments | checked: github.com/Divyansh-rl/monthlySummary data_august.csv |
| zoho-inventory.sales-orders | checked (headings only): github.com/epritesh/order-suggest DATA_SCHEMA.md |
| freshdesk.tickets | checked: github.com/zyn10/Freshdesk-Ticket-Insights |
| meta-ads.campaign-daily, meta-ads.campaign-daily-report | checked: github.com/daaronr/eamt_data_analysis |
| google-ads.campaign-daily | checked: github.com/dwolfe1966/pds Campaign report.csv |
| google-analytics.sessions-daily-report | checked: github.com/DewSam/H1-B-data-Analytics data-export.csv |
| youtube-analytics.views-daily | checked: github.com/billmengg/YTAnalytics Date.csv |
| mailchimp.campaigns | checked: github.com/oscarotero/oscarotero.gal campaigns.csv |
| notion.expense-database | checked: github.com/cameronmurdock/Rivertree |
| slack.workspace-analytics | checked: github.com/astropy/community_management |
| posthog.event-trend | checked: PostHog's open-source csv_exporter.py |
| github.commits-json | checked: docs.github.com/en/rest/commits/commits#list-commits |
| income-tax.form26as-tds, income-tax.form26as-income | checked (Part A; later parts not in the sample): github.com/SRathinaGiri/MLDemo FORM 26AS.txt |
| vyapar.purchase-report, busy.*, marg.*, mybillbook.sales-report, khatabook.customer-transactions, okcredit.account-statement, bharatpe.transaction-report, petpooja.order-summary, flipkart-seller.settled-orders, shiprocket and delhivery remittance, unicommerce.*, zoho-inventory.inventory-summary, keka / greythr / zoho-payroll / razorpayx-payroll registers, chargebee.invoices, google-analytics.sessions-daily (Grand total row), instagram-insights.reach-daily, whatsapp-api.campaign-report, github.commits-csv, income-tax.ais-* | still unconfirmed: no public sample found |

Checking real samples changed several recipes: Google Ads repeats its totals per day (only the overall "Total: Account" row is the check now), Meta Ads puts its summary row first, GA4 downloads have no grand total (a report-total recipe was added), Mailchimp and Notion use long month-name dates (normalised in their decoders), Meesho has a section row and a duplicated fee heading, Petpooja puts Total, Min., Max. and Avg. rows directly under the header, and Mailchimp campaigns are identified by their own Unique Id.

### Plain database connector — experimental, run against real engines

Identifiers are checked against the database's own catalogue and quoted; values are bound; reads run in one read-only snapshot that ends in ROLLBACK. The `COUNT` and `SUM` from the same snapshot are the source total. Float amount columns and system catalogues (`pg_*`, `information_schema`, `mysql`, `sys`, `sqlite_*`) are refused. MySQL uses a minimal client over `node:net` (no new dependency); full authentication over plain TCP is refused (`MYSQL_FULL_AUTH_REQUIRES_TLS`) and never downgrades.

Real-engine runs on 14 October 2026 (`platform/tests/connectors-ext-plain-db-live.test.ts`, which skips unless `CHAUSAR_TEST_PG_*` / `CHAUSAR_TEST_MYSQL_*` are set): PostgreSQL 16.15 with MySQL 8.0.46 over TLS, 18 of 18 passed; PostgreSQL 16.15 with MariaDB 10.11.14, 17 passed and 1 skipped (MariaDB has no caching_sha2_password); MySQL 8 without TLS, 9 of 9 passed. These runs found and fixed: system tables readable by a superuser connection, mislabelled PostgreSQL timeouts, and no server-side time limit on MariaDB. SQLite runs on the real `node:sqlite` engine in the normal suite.

### GST matching — experimental

`gst-match.ts` and `connectorsx.gstMatch`. Exact key: GSTIN, invoice number and financial year. Probable matches (separators and leading zeros; a date on the wrong side of 1 April) are suggestions only. Invalid GSTINs and duplicates are set aside. Each line carries its receipt (entity ids and source rows on both sides).

### Cut-short refusal — experimental

Every family has a cut-short and a filtered copy refused, with the reason stated in a fixed sentence and the two totals as typed checks.

## Host wiring (supported on synthetic data; experimental for live systems)

The module wires itself through `hostOptions`, with no edit to `main.cjs` or the worker. Outside demo mode it builds:

- a **sealed local credential store** in `<app directory>/connector-credentials/`: one AES-256-GCM file per source (AAD = source id) under a 32-byte key with owner-only permissions, opened through one descriptor with no symlink following. Protection is the operating system's file permissions; the native keychain is the intended home once a general secret store exists;
- the **credential broker** over it (keys, OAuth tokens with refresh before expiry, one refresh at a time per source), the **code exchange** for browser sign-in (PKCE verifier, redirect pinned to the registered app), and the **database password resolver** (only the connection's own stored password, only for plain databases);
- the bounded **read transport** (`readHttp`), which also passes the response headers adapters need;
- **sign-in apps** from a trusted config file (`CHAUSAR_OAUTH_CLIENTS_FILE`, or `oauth-clients.json` in the app directory). Client secrets stay inside the broker and never reach module options. With no app registered, sign-in refuses with `OAUTH_CLIENT_REQUIRED`.

Demo launches get no options, so every external system stays disabled.

## Scheduled refresh (experimental)

`connectorsx.schedule` attaches a repeating read to an interface connection. The module `tick` runs only while autonomy is on and the computer is awake, only for the owner (so nothing runs twice), and only for active connections whose source trust allows it. Each scheduled read covers the current month to date in India's calendar. Rules:

- only reads checked against a source-declared total, or a report recipe that accepts the system's own count (`declaredCount: 'accepts'`), can repeat (`SCHEDULE_NEEDS_SOURCE_TOTAL` otherwise);
- a missed slot runs **once** on waking with `run-once`, or waits for the next slot with `skip`; never once per missed slot;
- budgets: at most 3 reads per tick and 24 per connection per day;
- accepted reads wait for a person unless `autoImport` was chosen;
- `connectorsx.freshness` shows the schedule and whether the source is past its freshness target.

## Security review

An adversarial review of the lane (SSRF, injection, path traversal, credential leakage, authorization, resource exhaustion, money correctness) found and this lane fixed:

- a catastrophic-backtracking pattern in the bank decoder (now linear, cells capped);
- `passwordRef` letting a database connection borrow another connection's stored key (the setting is refused; a database resolves only its own password, and only plain-database entries);
- admin methods accepting MCP and source-tainted callers (now refused);
- reads and listings without branch and source-trust scoping (now scoped);
- quadratic loops in the recipe engine and GST pairing (now linear and per supplier);
- WooCommerce accepting IP literals and local names (now refused);
- credential file name collisions, directory permissions, temporary-file and key-read races, concurrent token refresh (all fixed);
- an opening balance read as zero when its figure was missing, and long identities truncated into collisions (both now refused);
- live WooCommerce reads losing `X-WP-Total` (the read transport now passes headers);
- PayU `var1` values that could change the signed string (now restricted).

Checked and found sound: origin allowlists including next-page and queued requests, redirect refusal, credential headers set only by the runner, fixed error codes with no source text, Tally XML escaping, GraphQL and JSON bodies built by the adapters, the SQL identifier and value rules, read-only snapshots, exact money throughout.

## Boundaries that need a person (typed refusals)

- **Sign-in apps** (`OAUTH_CLIENT_REQUIRED`): the founder's decision on registering sign-in apps or a sign-in helper. The host passes `modules['connectors-ext'].oauthClients`.
- **Native keychain**: credentials are sealed under a key protected by file permissions; moving the key into the OS keychain needs a general secret store from the release lane.
- **Live accounts**: no Tally installation, Zoho organisation or other account was available; all reads are recorded-response tested.
- **Google Calendar**: `calendar.readonly` needs Google's app verification.
- **E-invoice / e-way bill live reads** need a licensed GST service provider.
- **Screen-driving export** needs the driving lane's `session.*`; until it exists both `connectorsx.screenExport.*` methods refuse `SCREEN_DRIVING_NOT_INSTALLED`.
- **Hidden businesses and the bench** decide what moves to supported.

## Known gaps

- 26 export layouts are still unconfirmed (table above); they need a real export from a user or a made-to-order book.
- Zoho Books net reads take at most 49 invoices per read (each detail is a request and a page); a longer period is split automatically, but a single day with more invoices than that is refused.
- A read accepted on the system's own count alone has its amount unchecked: its import is recorded with `coverage.reconciled: false`, and Books, Sources shows the total match as unavailable. Recipes whose system states no count for the filter read (Shopify, Zoho CRM, the payment gateways) still need the report total.
- The Tally exporter's PowerShell script has never run in real Windows PowerShell 5.1 (no Windows here). Its requests are byte-exact and its answer file is tested by replay. Run it once on Windows before calling it more than experimental.
- Answers to recipe questions are held per source and recipe version. A new recipe version asks again, on purpose: an answer for one version is never carried forward silently.

## Core and shared edits

- `app/desktop/preload.cjs`: this lane's line in `laneRefusals` only.
- `platform/runtime/helper.ts` (shared, owned by no lane): additive registration of the `pdf.ocr` operation — the operation name in `HelperOperation` and `OPERATIONS`, `OCR_DEPENDENCY_UNAVAILABLE` in `ERROR_CODES`, its allowed input keys, and `sourceTainted` for its receipt.
- `platform/helpers/analytics.py` (shared): the `pdf.ocr` handler and its helpers, added beside `pdf.extract`; an optional `password` for `pdf.extract` and `pdf.ocr` with two distinct refusals (`PASSWORD_REQUIRED` with no password, `WRONG_PASSWORD` for a wrong one), never echoed or logged; and a `pdf.status` operation that reports which readers are importable.
- `platform/runtime/helper.ts` (second change, for FR-07): `pdf.status` registered, `password` allowed for `pdf.extract` and `pdf.ocr`, `PASSWORD_REQUIRED` and `WRONG_PASSWORD` in `ERROR_CODES`, and the receipt's input hash computed without the password.
- `platform/helpers/analytics.py` (Round 4): `pdf_status` also returns `sizeBytes` (a whole number, or `null` with no reader). `helper.ts` needs no change: its output check already allows safe integers and `null`.
- `platform/runtime/adapters/accounting/books-api.ts` (this lane's adapter): a Zoho net read now takes at most 49 invoices, because each invoice detail counts as a page as well as a request; with 50–59 invoices it used to fail with `READ_PAGE_LIMIT`.
- `app/ui/src/places/lane-connectors-ext.tsx`, `places/subplaces/connectors-ext.ts`, `text/lanes/connectors-ext.ts` and `screens/connectors/**`: this lane's own UI files. No other lane's screen was edited.
- No dependency was added. OCR uses system tesseract and the Python packages pypdfium2 and Pillow when they are installed, and refuses cleanly when they are not.

## FR-07 contract

The `imports.*` methods serve FR-07, "Bring a file" (and BK-04). They live in this lane's engine module and are listed in `app/desktop/module-methods/connectors-ext.json`. Every refusal below is on this lane's `laneRefusals` line, so it reaches the screen by its code. Money is whole paise as strings.

### `imports.providePassword` (prepare, desktop only)

Request: `{ sourceId: string, password: string }`. `sourceId` matches `^[A-Za-z0-9_.:-]{1,100}$`; `password` is 1–256 characters with no control characters.

Reply: `{ held: true, sourceId, expiresInSeconds: 600, usedOnce: true }`. The password is never echoed.

The password is held in engine memory only, keyed by the open vault and the `sourceId`, for the member who gave it. The next `imports.preview` of that source uses it once and wipes it. It expires after 10 minutes and is dropped when the workspace is locked or the engine closes. It is never persisted, backed up, logged, audited, hashed into a receipt or returned. Refusals: `OPEN_DESKTOP` (phone, MCP or source-tainted caller), `PASSWORD_INVALID`, `CONNECTOR_REQUEST_INVALID`.

### `imports.preview` (prepare, desktop only)

Request:

- PDF bank statement: `{ sourceId, kind: 'pdf', bytesBase64, company?, branch? }` (at most 4 MB). `company` defaults to the workspace name.
- CSV: `{ sourceId, kind: 'csv', content, recipe?, expectedTotals? }` — a thin delegation to core `sources.preview`; the reply is the core preview unchanged.
- XLSX: `{ sourceId, kind: 'xlsx', bytesBase64, sheet?, recipe?, expectedTotals? }` — a delegation to core `sources.workbookPreview`, with the held password as described under Round 4 below.

Reply for a PDF: the envelope (as `connectorsx.importPreview` returns it: `id`, `status` `accepted | refused | abstained`, `refusal`, `abstention`, `checks`, `observed`, `sourceTotals`, `balances`, `unmappedFields`, `notices`, `pendingRows` …) plus `fr07`, the result shape below.

Thrown refusals (the file could not be read at all):

| Code | When | Words |
|---|---|---|
| `PASSWORD_REQUIRED` | The PDF is encrypted and no password is held | ask for it, then preview again |
| `WRONG_PASSWORD` | The held password did not open it | "That password did not open the file." |
| `PICTURE_ONLY` | No text layer, and OCR is missing or not confident enough | "This statement is a picture. Chausar cannot read it yet." |
| `READER_NOT_INSTALLED` | The trusted Python helper or pdfplumber is missing | show `imports.readerStatus` |
| `INVALID_PDF`, `PDF_LINE_UNREADABLE`, `PDF_PAGE_LIMIT` | Not a PDF, a transaction line that cannot be read, too many pages | fixed sentences |

Content refusals return an envelope with `status: 'refused'` and `fr07.reason`:

| `fr07.reason` | From | Shown with |
|---|---|---|
| `CUT_SHORT` | the closing balance or total row is missing, or the statement stops early | — |
| `FILTERED` | totals differ from the statement's own summary | `fr07.totals.expected` and `fr07.totals.observed` |
| `DOES_NOT_ADD_UP` | the running balance breaks | `fr07.line` (the line in the extracted text where it broke) |

### `imports.commit` (prepare)

Request: `{ sourceId, envelopeId }`. The `sourceId` must be the one the envelope was read for. For a workbook: `{ sourceId, kind: 'xlsx', bytesBase64, sheet?, recipe?, expectedTotals? }` (Round 4, desktop only).

Reply: the `fr07` result with `state: 'imported'` and `imported: { importId, rows, duplicate }`. The import runs through this lane's importer and the core `ImportService` (branch access, deletion tombstones and the second total check apply). Refusals: `IMPORT_NOT_ACCEPTED`, `ENVELOPE_NOT_FOUND`, `ENVELOPE_EXPIRED`.

### `imports.result` (read)

Request: `{ envelopeId }`. Reply, the `fr07` result:

```
{ envelopeId, sourceId, kind: 'bank-statement',
  state: 'checked' | 'refused' | 'question' | 'imported',
  reason: 'CUT_SHORT' | 'FILTERED' | 'DOES_NOT_ADD_UP' | null, code: string | null, line: number | null,
  totals: { expected, observed } | null,            // FILTERED only
  linesRead: number, openingMinor: string | null, closingMinor: string | null, checkPassed: boolean,
  readByOcr: boolean,                               // a scanned page was read by OCR (experimental)
  kept: { file: 'not-kept', record: 'books-sources-history' },
  imported: { importId, rows, duplicate } | null }
```

"Where the refused file is kept": Chausar does not keep the refused file itself; its read record (checks, reason, totals, line) stays in Books, Sources history (`connectorsx.envelopes`).

### `imports.readerStatus` (read)

Request: `{}`. Reply: `{ status: 'installed' | 'not-installed', pdfText: boolean, pdfOcr: boolean, reason: null | 'PYTHON_NOT_CONFIGURED' | 'PDF_LIBRARY_MISSING' | <helper code>, sizeBytes: number | null }`. It asks the helper's `pdf.status` operation, which opens no file. `sizeBytes` is described under Round 4 below.

### `imports.installReader` (admin, external)

Request: `{}`. Always refuses `READER_INSTALL_UNAVAILABLE` in this build: no download is made. The release lane must bundle Python with pdfplumber (text), pypdfium2 and Pillow plus tesseract with English data (OCR). Demo launches refuse it as `DEMO_EXTERNAL_DISABLED`.

### Not built here

`imports.pickFile` (the native file dialog belongs to the frame) and `dictionary.proposals` (learning-ext).

## Round 4 contracts

These are written before the code, so other lanes can build against them. Every method is in this lane's engine module and in `app/desktop/module-methods/connectors-ext.json`; every refusal code is on this lane's `laneRefusals` line. Money is whole minor units (paise) as strings; a figure the engine does not have is `null`, never `0`.

### For work-books BK-05: answering a recipe question, the version diff, reconcile

An envelope that abstained now carries its question with the choices the engine will accept:

```
question: null | { reason: 'ambiguous_field' | 'unknown_value' | 'date_format' | 'currency' | 'sign_convention',
                   field: string, sample: string | null, choices: string[] }
```

- `ambiguous_field`: `choices` are the column headings that could hold the field.
- `unknown_value`: `sample` is the source's value (outside text, shown as data). `choices` are the recipe's own words for that column (for example `invoice`, `credit_note`), plus `leave-out` when the recipe can exclude rows by that column, plus `no-status` for a status column.
- `date_format`: `choices` are the formats the field allows (`DMY`, `MDY`, …).
- `currency`: `choices` are ISO codes (`INR`, `USD`, `EUR`, `GBP`, `AED`, `SGD`, `AUD`, `CAD`, `JPY`). An answer is used only for rows whose currency cell is empty.
- `sign_convention`: `sample` is the word; `choices` are `in` and `out`.

#### `recipes.answer` (prepare, desktop only)

Request: `{ envelopeId, choice }`. `choice` must be one of the envelope's `question.choices`.

Reply: `{ answer: Answer, read: Envelope | null, readAgain: 'not-needed' | 'bring-the-file-again' | 'read-again' }`.

```
Answer = { id, sourceId, recipeId, recipeVersion, reason, field, sample: string | null, choice,
           answeredBy: { memberId, name, role, at }, envelopeId }
```

- The answer belongs to one source and one recipe version. It is never applied to another source or to a later recipe version.
- From then on it applies to every read of that source with that recipe: file previews, interface reads, scheduled reads and database reads.
- The recipe with its answers is compiled again, as data, before it runs. Its digest changes, so imports dedupe correctly.
- Where the engine still holds the input that abstained, it reads it again at once and `read` is the new envelope. That envelope may ask the next question.
- The held input is kept in memory only, for at most 6 hours. It is dropped when the workspace is locked or closed, and is never written down. When it is gone, `read` is `null` and `readAgain` says what the person does.
- Refusals: `ENVELOPE_NOT_FOUND`, `RECIPE_QUESTION_NONE` (the read asked nothing), `RECIPE_ANSWER_INVALID` (not an offered choice), `RECIPE_ANSWER_STALE` (the recipe changed version since that read), `ANSWER_LIMIT`, `OPEN_DESKTOP`.
- A caller who cannot see the envelope's branch or source gets `ENVELOPE_NOT_FOUND`.

#### `recipes.answers` (read)

Request: `{ recipeId?, sourceId? }`. Reply: `{ answers: Answer[] }`, newest first, limited to sources the caller can see. This is the "who accepted" record for an answered recipe: `answeredBy.role` grades it.

#### `recipes.answerRemove` (prepare, desktop only)

Request: `{ answerId }`. Reply: `{ removed: true, answerId }`. Later reads ask the question again. Facts already imported stay. Refusals: `ANSWER_NOT_FOUND`, `OPEN_DESKTOP`.

#### `recipes.upgradeDiff` (read)

Request: `{ recipeId, envelopeId? , sourceId? }`.

- `envelopeId`: compares the recipe that read was made with against the current recipe with that source's answers.
- `sourceId` alone: compares the registered seed recipe against the seed with that source's answers.
- Neither: compares the seed with itself, so `same` is `true`.

Reply:

```
{ recipeId, available: boolean, reason: null | 'OLD_VERSION_NOT_KEPT',
  from: { version, digest, label: 'read-with' | 'seed' }, to: { version, digest, label: 'current' | 'with-answers' },
  same: boolean,
  changes: { path: string, change: 'added' | 'removed' | 'changed', before: string | null, after: string | null,
             effect: 'columns' | 'meaning' | 'dates' | 'amount' | 'check' | 'identity' | 'other' }[] }
```

- `path` names the place in the recipe, for example `fields.amount.from`, `kind.values.Credit Note`, `totals.kind` or `measure.currency`.
- From this round, the engine keeps the exact recipe each read used, by digest; at most 200 recipes are kept. Reads made before this round, or recipes pushed out of that store, have `available: false` and `reason: 'OLD_VERSION_NOT_KEPT'`.
- Refusals: `RECIPE_NOT_FOUND`, `ENVELOPE_NOT_FOUND`.

#### `recipes.reconcile` (prepare)

Request: `{ envelopeId, reportTotals? }`. `reportTotals` is `{ total: '<minor units>', rowCount?: number | null }`, as typed from the system's own report.

Reply:

```
{ envelopeId, importId: string | null, at, by: { memberId, name, role },
  status: 'matches' | 'differs' | 'rows-changed' | 'not-imported' | 'no-source-total',
  theirs: { total: string | null, rowCount: number | null, reference: string, provenance: string } | null,
  ours: { total: string | null, rowCount: number, live: number, changed: number },
  measure: 'money' | 'count', unit }
```

- The import's facts are re-totalled now, using only live facts, exact BigInt sums in the engine.
- They are compared with the source's own total: the one the read was checked against, or `reportTotals` when given.
- `changed` counts facts from that import that were since deleted or superseded. Any such fact makes the status `rows-changed`.
- When the read was not imported, `ours.total` is `null` and the status is `not-imported`.
- The latest 10 reconciliations are kept on the envelope and listed as `reconciliations` in `connectorsx.envelopes`. A `matches` result made by a named person is what grades a recipe "reconciled".
- Refusals: `ENVELOPE_NOT_FOUND`, `INVALID_SOURCE_TOTALS`.

### Tally on another computer (BK-03)

#### `connectorsx.tally.exporter` (prepare, desktop only)

Request: `{ connectionId, register: 'sales' | 'purchase', period: { from, to }, ledgers: string[], baseCurrency }`. The connection is a Tally connection; its `company` is the Tally company.

Reply: `{ exportId, fileName, script, guideFileName, guide: { en, hi }, expiresAt }`.

- `script` is a Windows PowerShell file.
- The person runs it on the computer where Tally is open. It sends the same read-only export requests Chausar would send to `http://127.0.0.1:9000`: the register, and the Sales Accounts or Purchase Accounts movement.
- It writes one answer file beside itself. It changes nothing in Tally and sends nothing anywhere else.
- `guide` is the one-page guide as plain text, in English and Hindi.
- The engine remembers the request (not the answer) for 30 days, so the answer file can be checked against the export Chausar made.
- Refusals: `CONNECTION_NOT_FOUND`, `TALLY_CONNECTION_REQUIRED`, `CONFIG_INVALID`, `COMPANY_REQUIRED`, `OPEN_DESKTOP`.

#### `connectorsx.tally.importExport` (prepare)

Request: `{ connectionId, text }`, where `text` is the answer file the script wrote.

Reply: the envelope, as `connectorsx.importPreview` returns it, on the `file` road.

- The file's answers are replayed through the same Tally register reader and recipe, so the check against Tally's own group movement applies unchanged.
- Refusals:
  - `TALLY_EXPORT_UNKNOWN`: no export with that id, or it expired.
  - `TALLY_EXPORT_MISMATCH`: the file answers other requests than the ones made.
  - `TALLY_EXPORT_INVALID`: not an answer file.
  - The Tally reader's own codes, for example `TALLY_SOURCE_ERROR`.

#### `connectorsx.tally.companies` and `connectorsx.tally.ledgers` (admin, external, desktop only)

Request: `{ connectionId }` for a Tally connection on the `interface` road (this computer).

Replies:
- companies: `{ companies: { name, booksFrom }[] }`, the companies open in Tally now;
- ledgers: `{ ledgers: { name, parent }[] }`, for choosing the register's ledgers.

This answers BK-03 "Which company?". Refusals: `READ_NOT_AVAILABLE`, the read kit's fixed codes, `DEMO_EXTERNAL_DISABLED`.

### Zoho Books net reads split automatically

Built, experimental (recorded responses only). `connectorsx.read` for `zoho-books` / `invoices-net` (binding flag `split: 'period'` in `reads.ts`, `splitRead` in `service.ts`) no longer refuses a period with more invoices than one read takes. One read takes at most 49: every invoice detail is both a request and a page, and the read kit allows 50 pages (the earlier "59" counted requests only, so 50 to 59 invoices failed `READ_PAGE_LIMIT`):

- It halves the period by date and reads each part, one after another, until every part fits one read.
- The parts' records are joined; the declared count is the sum of the parts' counts, and is checked as before.
- At most 8 parts and 400 requests in total, refused attempts included. A single day with more invoices than one read allows, a ninth part or the 401st request refuses `ZOHO_DETAIL_BUDGET`, and nothing partial is kept. Without a period there is nothing to halve, and the read refuses as before.
- The envelope's `read` gains `parts: number`.

### Declared counts without a typed total

Built, experimental. The recipes for these reads (`totals: { kind: 'report', declaredCount: 'accepts' }`):
- Zoho Books invoices (gross and net): `page_context.total` for the dated list,
- Xero invoices (net and gross): `pagination.itemCount` for the same `where`; QuickBooks invoices: a `count(*)` query with the same filter (absent when the last data page is exactly full, and then the typed total is needed),
- WooCommerce orders: `X-WP-Total` for the `after`/`before` filter,
- HubSpot deals: the search `total` for the close-date filter.

Each states the system's own record count for exactly the filter read. When no report total is typed:

- The read is accepted on the count alone. `checks` holds `source-row-count: passed` and `source-total: unavailable`.
- `sourceTotals.provenance` is `source-declared-count`, and a notice says the amount was not checked against a report.
- A typed report total, when given, is still checked in full.
- A count that differs still refuses `SOURCE_ROW_MISMATCH`. The count is compared with every record the system returned, before exclusions (drafts, voids) and repeated rows.
- With a typed total, the declared count is checked too (`source-declared-count`).
- The import of a read accepted on the count alone is recorded with `coverage.reconciled: false`, so receipts never treat it as reconciled; Books, Sources shows the total match as unavailable.
- Because these reads now carry a total from the system, they can repeat on a schedule.

Recipes whose system states no count still need a typed total.

### FR-07 additions

Built, experimental.

- `imports.readerStatus.sizeBytes` is the size on disk of the PDF reader the helper found (the pdfplumber, pypdf, pypdfium2 and PIL package folders, plus the tesseract program and its English data), as a whole number of bytes. It is `null` when nothing is installed.
- `imports.preview` with `kind: 'xlsx'` passes the password held by `imports.providePassword` to core-data's `sources.workbookPreview` as `password`. The password is used once and then wiped.
  - core-data's refusals for an encrypted workbook are mapped to `PASSWORD_REQUIRED` and `WRONG_PASSWORD`.
  - If the core does not accept `password` yet, the refusal is `WORKBOOK_PASSWORD_NOT_SUPPORTED`; the password is never sent to a method that does not take it.
  - How: the workbook goes to the core first without the password. Only a refusal that a core with the password path gives (`PASSWORD_REQUIRED`, `WORKBOOK_ENCRYPTED`, `ENCRYPTED`, `ENCRYPTED_WORKBOOK`, `WORKBOOK_PASSWORD_REQUIRED`) brings a second call with it. Today's core refuses an encrypted workbook as `ENCRYPTED_ZIP` or `UNSUPPORTED_WORKBOOK` (an OLE file with an `EncryptionInfo` stream): that is `PASSWORD_REQUIRED` with no password held, and `WORKBOOK_PASSWORD_NOT_SUPPORTED` with one, which is then wiped unsent. A plain workbook never receives the held password. On the second call, a password refusal is `WRONG_PASSWORD`, and a shape refusal (`INVALID_REQUEST` and similar) is `WORKBOOK_PASSWORD_NOT_SUPPORTED`.
  - `sizeBytes` is summed in `analytics.py` (`pdf_status`) from `importlib.util.find_spec` locations, without importing them or following symbolic links, plus `shutil.which('tesseract')` and the first `eng.traineddata` found.
- `imports.commit` for an xlsx preview: `{ sourceId, kind: 'xlsx', bytesBase64, sheet?, recipe?, expectedTotals? }`.
  - It delegates to `sources.workbookImport` with the same rule.
  - The person gives the password again for the import, because it was wiped after the preview.

### Screen export over the driving lane (needs `session.*`)

Built, experimental (`platform/runtime/connectors-ext/screen-export.ts`), tested against a fake driving lane only.

`connectorsx.connect` with `road: 'screen'` is accepted for desktop programs with no interface Chausar can read: Busy, Marg, Vyapar, and Tally when it is not on this computer. `SCREEN_EXPORT_NOT_BUILT` is gone.

Served by the driving lane as written (its "Round 4 contracts", `claude/lane-driving` at `b9cf157`):

- `session.windows({})` returns `{ windows: { id, title, app }[], available, code, reason }`, for owners and co-founders only.
- `session.start({ windowId, purpose: 'connector-export', connectionId })` returns the driving `Status`, with its `sessionId`. The plan comes from the connection's group. A group with no plan exports a PNG picture of the window. TallyPrime's plan refuses `DRIVING_PLAN_UNVERIFIED` until it has run against a real Tally.
- `session.status({ sessionId })` returns `Status & { export: { fileName, bytesBase64 } | null }`. `state` is one of `idle`, `driving`, `sign-in`, `paused-by-you`, `stopped-by-key`, `stopped`, `step-failed` or `done`.
- `session.discardExport({ exportId })` is called for each of the session's exports once the file is read. It is best effort: the driving lane's copy expires after a day anyway.

The rules of driving (one window, read and export only, never a password, one-time code or captcha) are the driving lane's. Only `sessionId`, `state`, `export` and the export ids are read from a `Status`, and each one is checked.

#### `connectorsx.screenExport.start` (prepare, desktop only)

Request: `{ connectionId, windowId }`. It calls `session.start` and returns `{ sessionId, state }`.

#### `connectorsx.screenExport.collect` (prepare, desktop only)

Request: `{ connectionId, sessionId, recipeId, reportTotals? }`. It calls `session.status`.

- While the session is not `done`, it returns `{ state, read: null }`; a session that ended otherwise (`stopped`, `stopped-by-key`, `step-failed`) never yields a read.
- When the session is done, its exported file goes through `connectorsx.importPreview` for that connection and recipe, and the reply is `{ state: 'done', read: Envelope }`.
- The exported bytes are outside data and are never kept beyond the read.

A screen connection takes no settings; any other system with `road: 'screen'` is `CONNECTOR_REQUEST_INVALID`. Every `session.*` reply is checked field by field (exact keys, the asked session id, a known state, a plain file name, bounded base64); anything else is `SCREEN_EXPORT_FAILED`, as is a done session with no export. A text recipe reads the export as UTF-8 (`SOURCE_ENCODING_INVALID` otherwise); a worksheet recipe reads its bytes. The envelope's road is `screen`.

When the driving methods are absent, both methods refuse `SCREEN_DRIVING_NOT_INSTALLED`. A picture of the window (a PNG) is refused as `SCREEN_EXPORT_PICTURE`: money is never read from a picture. Other refusals: `CONNECTION_NOT_FOUND`, `SCREEN_ROAD_REQUIRED`, `SCREEN_EXPORT_FAILED`, `OPEN_DESKTOP`, and `DEMO_EXTERNAL_DISABLED` (both are external).

### Books sub-places drawn by this lane

These sub-places are drawn by this lane's place module (`app/ui/src/places/lane-connectors-ext.tsx`):

- `#/books/scheduled`: repeating reads over `connectorsx.connections`, `connectorsx.freshness` and `connectorsx.schedule`.
- `#/books/database`: the database road over `connectorsx.connections`, `connectorsx.plainDb.tables` and `connectorsx.plainDb.read`, with import through `connectorsx.importCommit`.
- `#/books/tally-export`: Tally on another computer, over `connectorsx.tally.exporter` and `connectorsx.tally.importExport`.

Routing: the base's `placeModuleFor` sends a lane-registered sub-place to that lane's own module first, so `booksPlace` no longer swallows these three (tested through the real lookup in `frontend-validation/tests/connectors-ext-books.test.tsx`).

Screens (**experimental**: tested with a fake engine in `frontend-validation/tests/connectors-ext-books.test.tsx` and reply checks in `app/ui/tests/connectors-ext-contract.test.ts`; never against a live system) live in `app/ui/src/screens/connectors/`, words in `app/ui/src/text/lanes/connectors-ext.ts` (`CX.*`, English and Hindi). Every reply is checked in `contract.ts` before it is drawn; a method that answers `UNKNOWN_METHOD`, `INVALID_REQUEST` or `METHOD_UNAVAILABLE` is drawn as "not installed in this build"; a viewer gets no control; Simple drops detail columns; money is exact minor-unit text formatted by `format/money.ts`, missing is "not known". Schedule changes and listing tables are offered to owner and cofounder seats (engine permission `admin`); reading a mapped table, Import, Set aside and the Tally script to anyone who can prepare. These replies carry no receipt ids, so no figure here opens a receipt.

Every thrown refusal these screens name in words is on this lane's `laneRefusals` line, including the database mapping codes (`PLAIN_DB_MAPPING_INVALID`, `PLAIN_DB_OPTIONS_INVALID`, `PLAIN_DB_PERIOD_INVALID`, `DB_ENGINE_MISMATCH`, `DB_AGGREGATE_INVALID`).
