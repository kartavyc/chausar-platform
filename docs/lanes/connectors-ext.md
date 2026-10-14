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
- `report`: the export truly has no total, so the person types the total from the system's own report.

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
| Zoho Books, Xero, QuickBooks | Invoices | Report total; declared count checked |
| Razorpay | Payments, settlements, settlement recon | Settlement's own amount for recon |
| Stripe | Payout reconciliation | Payout amount |
| Cashfree, PayU | Parsers and recipes | Live read refused by design: `CASHFREE_AUTH_UNSUPPORTED`, `PAYU_SIGNED_REQUEST_UNSUPPORTED` |
| Shopify, WooCommerce | Orders | Declared count checked; amount from the report total |
| Google Workspace | Sheets and Drive (`drive.file` only), Calendar | Sheet's Total row; counts with report totals |
| Zoho CRM, HubSpot | Deals (a won deal is never a sale) | Report total; HubSpot count checked |

### Import depth through recipes — experimental (layouts from memory, not checked against real exports)

- Books: Vyapar, BUSY, Marg (sales and purchase), myBillBook, Khatabook, OkCredit, BharatPe, Petpooja.
- Marketplaces: Amazon settlement V2 (its own total row), Flipkart, Meesho.
- Money: Paytm, PhonePe, Instamojo; restaurant partner payout annexures; quick-commerce sales.
- Bank statements: CSV and Excel in five synthetic bank layouts (deposit/withdrawal and amount+Dr/Cr), with running-balance continuity, the statement summary's own counts and totals, and a refusal naming the line where the balance breaks. PDF through the Python helper with a generic line parser; scanned pages refused (`PDF_SCANNED_PAGE`).
- GST: GSTR-1 (with and without the portal summary), GSTR-1 notes, GSTR-2B (portal ITC summary), GSTR-2B notes, GSTR-3B supplies and ITC, e-invoice (single and batch, each document against its own `AssVal`), e-way bills.
- Form 26AS (each deductor's transactions against its own totals) and AIS (reported, processed and accepted never mixed; never summed with 26AS).
- Shiprocket, Delhivery, Unicommerce, Zoho Inventory, Keka, greytHR, Zoho Payroll, RazorpayX Payroll (no employee names imported), Chargebee, Freshdesk, Meta Ads, Google Ads, Google Analytics, YouTube, Instagram, Mailchimp, Notion, Slack, Microsoft 365 (canonical sheet), WATI/Interakt, PostHog, GitHub.

### Plain database connector — SQLite experimental-tested on a real engine; PostgreSQL and MySQL experimental

Identifiers are checked against the database's own catalogue and quoted; values are bound; reads run in one read-only snapshot that ends in ROLLBACK. The `COUNT` and `SUM` from the same snapshot are the source total. Float amount columns are refused. PostgreSQL is tested with a fake client. MySQL uses a minimal client over `node:net` (no new dependency), tested against an in-process fake server; full authentication over plain TCP is refused (`MYSQL_FULL_AUTH_REQUIRES_TLS`).

### GST matching — experimental

`gst-match.ts` and `connectorsx.gstMatch`. Exact key: GSTIN, invoice number and financial year. Probable matches (separators and leading zeros; a date on the wrong side of 1 April) are suggestions only. Invalid GSTINs and duplicates are set aside. Each line carries its receipt (entity ids and source rows on both sides).

### Cut-short refusal — experimental

Every family has a cut-short and a filtered copy refused, with the reason stated in a fixed sentence and the two totals as typed checks.

## Boundaries that need a person (typed refusals)

- **Sign-in apps** (`OAUTH_CLIENT_REQUIRED`): the founder's decision on registering sign-in apps or a sign-in helper. The host passes `modules['connectors-ext'].oauthClients`.
- **Code exchange and token storage** (`TOKEN_EXCHANGE_HOST_REQUIRED`, `CREDENTIAL_BROKER_REQUIRED`): the host credential broker (`credentialBroker`, `tokenExchange`, `databaseCredentials` module options). Not wired in `main.cjs` by this lane.
- **Live accounts**: no Tally installation, Zoho organisation or other account was available; all reads are recorded-response tested.
- **Google Calendar**: `calendar.readonly` needs Google's app verification.
- **Cashfree and PayU** live reads need header-key and signed-request support.
- **E-invoice / e-way bill live reads** need a licensed GST service provider.
- **Screen-driving export** (`SCREEN_EXPORT_NOT_BUILT`) and OCR for scanned PDFs are not built.
- **Hidden businesses and the bench** decide what moves to supported.

## Known gaps

- Several layouts are best recollection (see the recipe notices): Vyapar returns sign, BUSY and Marg headings, Flipkart and Meesho summary sheets, Mailchimp send dates, Notion long dates, PostHog wide layout, and the AIS JSON shape.
- Zoho Books list reads carry gross totals only; net needs a per-invoice detail read.
- A `declared` total with a count but no amount still needs the report total; those recipes use `report`, and the read kit enforces the declared count.
- No scheduled reads (`tick`): repeating reads belong to the jobs lane.
- No screens in this lane; Books, Sources (work-books lane) calls these methods.
