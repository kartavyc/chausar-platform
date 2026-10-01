# QuickBooks Online v3 read and artifact import

QuickBooks remains in the user-selected product scope. This adapter is one slice of the first four accounting integrations. It neither changes the shared framework nor claims the remaining connector groups are complete.

The implementation is `platform/runtime/adapters/accounting/quickbooks.ts`; deterministic fixtures and tests are under `platform/tests/fixtures/accounting/quickbooks/` and `platform/tests/accounting-quickbooks.test.ts`. These fixtures were authored for this implementation. They are not observations of a customer, vendor sandbox, or live account.

## Framework interfaces

- `quickBooksOperation(profile, 'read' | 'import')` produces separate `ConnectorOperationScope` definitions. Connector version is `1.0.0`. Operation IDs are `qbo-{entityLower}-read-v1` and `qbo-{entityLower}-import-v1`. The application version is the exact requested `v3-minor-{minorVersion}`.
- The operation configuration digest binds realm ID, canonical company ID, entity, minor version, page size, dataset, branch `all`, configured posting-date period, inactive-account inclusion, environment, edition and region. A qualified Invoice operation cannot execute a Payment query. The configured edition defaults to the product identity `QBO`; this is not qualification of every subscription tier.
- `createQuickBooksReadAdapter({...profile, operation, transport})` implements `ApiReadAdapter`. It supplies no credentials, network implementation, SDK, refresh logic or internal retries. The injected transport receives the dispatcher context containing an opaque credential reference. Authorization headers never enter the adapter request model, parser or receipts.
- `parseQuickBooksPage(rawUtf8, profile)` returns the adapter-local `AccountingPage`. `quickBooksSchemaFingerprint(rawUtf8)` fingerprints actual wire structure, including numeric versus quoted fields. `quickBooksParserDescriptorHash(profile)` is a separate parser descriptor identity; it does not stand in for observed schema evidence.
- The parent-owned `createAccountingDecoder` can wrap the fixed parser callback for `QualifiedDecoder` and the existing read/import custody bridge. It retains the full normalized record and original source object. Publication still requires separately qualified import scope, reviewed human mapping, exact currency precision and independent source report reconciliation.

The profile specifies `entity`, `realmId`, `minorVersion`, `environment` and optional `companyId`, `dataset`, `pageSize`, `edition`, `region` and `period`. Default dataset is `qbo-{entityLower}`, default page size is 100, maximum 1000. Read authority company ID and `dataScope.company` must both match the configured company. Only `branches: ['all']` is implemented. A period must match the period bound into the operation and is sent as an inclusive `TxnDate` filter. Account masters reject periods.

## Implemented source meaning

| Native entity | Normalized event | Preserved evidence and restrictions |
| --- | --- | --- |
| Invoice | `invoice`, receivable | `TotalAmt`, `Balance`, posting date, currency, native lines, tax details, links and `SyncToken`. No earned-revenue or fulfillment conclusion. |
| CreditMemo | `credit-note`, receivable | Positive source total, `RemainingCredit`, `InvoiceRef`, item lines and tax details. A credit note is not independently treated as cash paid out. |
| Payment | `payment`, inflow | Positive source total, `UnappliedAmt`, destination account and grouped `LinkedTxn` applications. This records the native receipt stream; it does not establish bank settlement. |
| RefundReceipt | `refund`, outflow | Positive source total, item lines and taxes. Refund bank settlement and overlap with credit notes remain unresolved. |
| Account | `account`, unknown direction | Native account type/class/subtype, name/code, active flag, currency and `CurrentBalance`. Balance is not a transaction total. Queries include active and inactive accounts. |

Numeric JSON lexemes stay strings from original bytes; no monetary value passes through binary floating point. `SyncToken` remains an exact nonnegative revision string. The parent decoder deliberately does not enable automatic correction ordering merely because this adapter sees a SyncToken. Such ordering needs independently qualified corrections evidence.

`TxnDate` is the native calendar posting date. The adapter does not derive it from `MetaData.CreateTime`, `LastUpdatedTime`, response `time`, capture time, host timezone or due date. Missing date, currency or money remains `null`. It does not insert USD, INR, zero, today's date or a home-currency conversion. `ExchangeRate` stays native source evidence; conversion is outside this adapter.

Invoice statuses map only directly observed `invoiceStatus` values described by the referenced Intuit schema: `VOIDED` to void; `PAID_NOT_DEPOSITED` or `DEPOSITED` to paid; the explicit due/overdue states and `PARTIALLY_PAID` to open. Zero `TotalAmt` or zero `Balance` does not prove void or paid. Missing, conflicting or other status forms remain unknown. The PHP reference includes fields for multiple product/version profiles: actual field presence and meaning for the selected v3 minor version, locale and account still needs vendor-observed qualification. A synthetic status test is not that qualification.

Sales item quantities, unit prices, native item-account references and tax codes are retained. A line without `ItemRef` is documentation and its native amount is excluded from the normalized posting amount. Subtotal and description lines retain raw amounts but do not become additional charges. Discounts retain their positive native allowance amount and explicit warning; they are not silently converted into revenue. `DeferredRevenue` requires fulfillment/accounting review. Item-to-account lookup is unresolved when the source does not supply `ItemAccountRef`.

Tax totals come from `TxnTaxDetail.TotalTax`; no tax rate is recalculated. Native `TaxLine`, `TaxPercent`, `NetAmountTaxable`, `TaxInclusiveAmt`, `GlobalTaxCalculation` and tax references remain in source custody. Inclusive taxes, tax overrides, embedded taxes, country-specific reporting and undocumented line types require separate qualification. Group lines remain preserved raw with an unsupported-line warning.

A Payment line may link both an Invoice and CreditMemo. Its amount belongs to that native grouping. The normalized allocation amount is unavailable for multi-link groups instead of being repeated against each reference. Payment lines never add extra cash or extra revenue to the payment total. Parent mapping must review unpaid balances, unapplied cash, credit offsets and undeposited funds together with appropriate source evidence.

`reconcileQuickBooksDocument(record)` provides exact local consistency checking for the implemented simple `TaxExcluded` / `NotApplicable` sales-line and discount subset. It compares item charges less discounts plus the native tax total with the native document total, excluding repeated subtotal and documentation amounts. It refuses unsupported lines, absent required totals, inclusive profiles and void postings. This check neither decides revenue recognition nor replaces the framework's independent source report. A mismatch is explicit and never fixed by rounding or replacing source totals.

## Acquisition and qualification limits

GET queries use the configured `/v3/company/{realmId}/query` endpoint and explicit `minorversion`. `STARTPOSITION` starts at 1; full pages advance by actual returned entity count and short/empty pages terminate. Returned `startPosition` and `maxResults`, when supplied, must agree with the request and actual count. `SELECT COUNT(*)` responses are refused by this data route because they contain no entities and need separately reviewed report evidence. Page continuation is not company completeness. Positional pages provide no coherent company snapshot under concurrent changes. Source total row count, independent monetary totals and snapshot ID remain unavailable.

The host must disable redirects, restrict the request to the exact allowlisted URL, perform a single transport attempt, and attest `finalUrl`. The adapter refuses redirects, changed final URLs, oversized/non-UTF-8/non-JSON responses, source Fault envelopes, sparse objects, duplicate/reserved keys, malformed decimals, entity mismatches and incompatible scopes. Received response bytes are included in closed failure accounting even when parsing fails. OAuth expiry and rate limits become closed classifications; source error text is not emitted as a receipt message.

Schema fingerprints conservatively include observed optional/null shapes. A changed unknown field, a quoted numeric token, a different optional structure or even a differently shaped terminal empty page may trigger framework quarantine. This conservative slice does not contain an approved optional-shape schema compatibility pack.

| Operations | Implementation and evidence state |
| --- | --- |
| Invoice read and import | Implemented parser/transport interface; synthetic fixture tests only. |
| CreditMemo read and import | Implemented parser/transport interface; synthetic fixture tests only. |
| Payment read and import | Implemented parser/transport interface; synthetic fixture tests only. |
| RefundReceipt read and import | Implemented parser/transport interface; synthetic fixture tests only. |
| Account read and import | Implemented parser/transport interface; synthetic fixture tests only. |
| Sandbox and live execution for every operation | Unqualified. No sandbox/company access or live request was made. |
| Create, update, void, delete, refund execution, OAuth/account setup, CDC, webhooks, reports, attachments, QuickBooks Desktop/qbXML, Item lookup, supplier Bills/BillPayments and bank-feed retrieval | Not implemented or qualified by this slice. |

Registry entries and attested evidence are integration-owned; exporting a scope or constructing an adapter does not register or qualify it. Minor version `75` is a deterministic fixture profile, not a claim about the current latest/minimum production version. Tests pass without npm installation, credentials or source calls.

## Official references and permissions

Reviewed through the allowed web tool:

- [Intuit QuickBooks v3 query/pagination and tax quickstart](https://intuit.github.io/QuickBooks-V3-PHP-SDK/quickstart.html).
- [Intuit SDK configuration, OAuth scope and explicit minor version](https://intuit.github.io/QuickBooks-V3-PHP-SDK/configuration.html).
- Intuit-maintained source schemas for [Invoice](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPInvoice.php), [SalesTransaction](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPSalesTransaction.php), [Transaction](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPTransaction.php), [SyncToken](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPIntuitEntity.php), [Payment](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPPayment.php), [CreditMemo](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPCreditMemo.php), [RefundReceipt](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPRefundReceipt.php), [Account](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPAccount.php), [item lines](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPItemLineDetail.php), [sales details/deferred revenue](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPSalesItemLineDetail.php) and [tax line details](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPTaxLineDetail.php).
- Official [API Invoice page](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice), [queries page](https://developer.intuit.com/app/developer/qbo/docs/develop/explore-the-quickbooks-online-api/data-queries), [minor versions page](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions) and [sandbox guidance](https://developer.intuit.com/app/developer/qbo/docs/develop/sandboxes) returned JavaScript application placeholders in the allowed reader. Their live content was not silently replaced by a third-party guide, browser-policy bypass or shell download.

The public docs and schemas were consulted for internal implementation reference. No Intuit documentation, SDK implementation, vendor example credentials or customer records were copied into this repository. The SDK repository's [license](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/LICENSE) is separate from rights in vendor documentation, customer exports and future training datasets. Redistribution/training rights for those materials have not been granted by their public readability. Production corpus permissions remain a parent review gate.

## Evidence needed for the next qualification level

Through the parent and host credential broker, supply an existing user-authorized QuickBooks Online OAuth connection with the `com.intuit.quickbooks.accounting` scope, realm ID, exact canonical company/source identities, approved endpoint environment, region/edition, requested/effective minor version, and currency/locale/tax configuration evidence. Secret client/token values stay in the existing secure broker; do not paste them into fixtures or commit them. This slice creates no account, obtains no token and performs no provider call.

Provide permitted, de-identified raw responses for each implemented entity and operation: multiple full/short/empty pages, mutable-page overlap, actual void and zero-value invoices, partial/unpaid/paid invoices, credits both applied and unapplied, grouped invoice-credit payment offsets, cash receipts versus bank deposits, refunds overlapping credit notes, inactive account classes, missing ItemRef and deferred-revenue lines, tax-exclusive/inclusive/override profiles, multiple currencies, schema variations, source Faults, 401/403/429 responses, and real SyncToken corrections. Include user-reviewed independent source reports with exact entity/period/company/currency domain, row counts, amounts, observed timestamp, report SHA-256 and any genuine source snapshot identity. Credentials alone cannot qualify these semantics.
