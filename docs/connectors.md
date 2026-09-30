# Source connectors and the recipe factory

The installed native readers are TallyPrime Day Book over loopback XML/HTTP and Zoho Books invoices over its regional API. Both are fixture-tested, with no live-account verification. The catalogue contains fifty named targets and separate import, read, and write status for every target. A listed name is not a supported-system claim. No connector in this module implements financial writes.

`ConnectorService(store, { http?, credentialBroker? })` provides `catalogue(context)` and `fetch(context, { connector, sourceId, company?, organizationId?, endpoint?, sourceOwnTotals? })`. A fetch returns raw import content, format, coverage, and a persisted provenance receipt. An organization, credential, endpoint, or remote instruction is never inferred from a source row. The engine supplies a trusted credential broker; the renderer does not receive the OAuth token.

```ts
const connectors = new ConnectorService(store, {
  credentialBroker: async (context, { connector, sourceId, organizationId, origin }) => {
    // Read a token from the trusted engine's credential service for this exact scope.
    return trustedCredentialService.token(context, { connector, sourceId, organizationId, origin });
  },
});
const source = await connectors.fetch(context, {
  connector: 'zoho-books', sourceId: 'books', organizationId: '100001',
  endpoint: 'https://www.zohoapis.in/books/v3',
});
```

Tally sends a fixed `Export Data` request for Day Book and an XML-escaped explicitly selected company. The endpoint must be numeric loopback or `localhost` with an explicit unprivileged port; `localhost` is normalized to `127.0.0.1`. No import or execute request is available. Tally's configured report period still needs to match the independently reviewed report used for reconciliation. A real TallyPrime Windows installation, supported editions, and unseen company qualification have not been tested.

Zoho requires a numeric organization ID and an explicit official `/books/v3` regional endpoint. Its token is sent in Zoho's documented `Zoho-oauthtoken` authorization header. The reader follows its own numbered pages and `page_context.has_more_page`; response-supplied URLs never control the next request. Invoice-list responses that omit net subtotals trigger bounded detail reads for those exact invoice IDs. Gross totals never substitute for net sales. JSON numeric lexemes are preserved as decimal strings before JavaScript can round IDs or amounts. Every invoice requires its explicit currency, net subtotal, and date.

The reader refuses redirects, retries nothing, limits a page to 4 MiB, all responses to 16 MiB, invoice rows to 2,000, pages to twenty, requests to 250, and a complete operation to sixty seconds. Every request has at most a fifteen-second timeout. Permission and trust-policy fingerprints are checked before and after credential acquisition and every source request, and again before persisting the receipt. Revoking access while a request is running prevents content delivery and receipt publication.

## Reconciliation and evidence

A finished HTTP export does not prove accounting completeness or a consistent database snapshot. Coverage states that snapshot consistency remains unverified. Missing source totals produce `independent-source-totals-required`, never a success badge. `sourceOwnTotals` must include an independent report ID, company, row count, amount in minor units, and `provenance: 'upstream-report'`. Fetch checks the report row count. `reconcile(context, { sourceId, format, content, recipe, sourceOwnTotals })` runs the data-only importer, checks the company scope, and compares both mapped row count and exact net money against that report. Incorrect totals or a cut-short file are refused. Operator-supplied report provenance is evidence to review, not a verified digital signature from the upstream system.

Tally ledger classifications are mandatory: tax and party ledger balances cannot become sales. Unknown accounts stop the import. Zoho needs a scoped recipe and matching currency meanings. Successful fixture reconciliation remains experimental until a real installation and a hidden business pass the qualification suite.

`proposeRecipe(context, { connector, sourceId, company, edition, fields, evidence })` stores a data-only proposal with the source-report ID, SHA-256, candidate field bindings, and ambiguity flags. `acceptRecipe(context, { proposalId, resolutions })` requires an owner or cofounder and explicit resolutions for missing or ambiguous identity, date, net-money, or currency meaning. Acceptance records who chose each meaning. It neither compiles nor executes code, and it does not raise a connector to live verified. Field names and source text that resemble instructions remain data. The existing `MappingRecipe` importer still validates transformations and source totals separately.

## Fifty target systems

The per-system operation records are returned by `catalogue`; these groups describe the same fifty entries.

| Family | Named targets | Current native-read qualification |
|---|---|---|
| Accounting | TallyPrime, Tally.ERP 9, Zoho Books, Vyapar, myBillBook, BUSY, Marg ERP, QuickBooks, Xero, Wave, Sage | TallyPrime and Zoho Books fixture-tested; others planned |
| ERP | Odoo, ERPNext | Planned |
| Enterprise | SAP, Oracle Fusion, NetSuite, Dynamics 365 | Planned |
| Payments | Razorpay, Cashfree, PayU, Stripe, PhonePe, Paytm | Planned |
| Banking | HDFC Bank, ICICI Bank, SBI, Axis Bank, Kotak Bank, IDFC FIRST Bank | Planned; regulated partner feeds absent |
| Tax | GST portal/GSTR-2B, income tax portal | Native reads planned; generic file parsers are separate |
| Commerce | Shopify, WooCommerce, Amazon Seller, Flipkart Seller, Meesho, Myntra | Planned; generic file parsers are separate |
| Logistics | Shiprocket, Delhivery, Unicommerce, Vinculum | Planned |
| Advertising | Meta Ads, Google Ads | Planned |
| Analytics | Google Analytics 4 | Planned |
| CRM | Salesforce, HubSpot, Zoho CRM | Planned |
| Files | Google Sheets, Microsoft Excel, canonical CSV | CSV import fixture-tested; native reads planned |

Generic CSV import availability does not prove any named vendor's export layout, account mapping, live API, or write operation. The catalogue labels those vendor recipes planned until evidence exists. No real-account request was made during implementation or tests.

## Official references

- [Tally XML integration](https://help.tallysolutions.com/xml-integration/) and [Tally Connector](https://help.tallysolutions.com/tally-prime-developer-tools/tally-connector/): XML requests and local HTTP connectivity.
- [Zoho Books API introduction](https://www.zoho.com/books/api/v3/introduction/): organization scoping and the eight official regional API domains.
- [Zoho Books pagination](https://www.zoho.com/books/api/v3/pagination/): numbered pages and page-context continuation.

These conventions were checked against the official documentation on 1 October 2026. Fixtures exercise wire formats and refusal behavior; they do not certify a live vendor account.
