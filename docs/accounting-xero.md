# Xero accounting read/import adapter

This slice implements injected GET acquisition and deterministic decoding for Xero Accounting API **2.0**, using the official OpenAPI reference `info.version: 19.0.0`. It makes no network calls by default, acquires no credentials, and implements no external writes. Official schemas were read through the available web tool; no executable download, shell network access, or private company scraping occurred.

## Operation and import interfaces

`xeroOperation(profile, 'read' | 'import')` produces separately qualified operation scopes. The nonsecret profile binds canonical company, Xero organisation UUID, endpoint resource, dataset, page size, configuration identity, edition, deployment, and optional region. The read factory refuses a scope qualified for another endpoint, tenant, API version, or acquisition configuration. Returned operation descriptors are immutable.

`createXeroReadAdapter({ ...profile, operation, environment, transport })` accepts the shared opaque `AccountingTransport`. The host resolves its credential reference and supplies OAuth; parser output never receives tokens. Requests use only `GET https://api.xero.com/api.xro/2.0/{Invoices|CreditNotes|Payments|Accounts}` and the configured `xero-tenant-id`. Redirects and changed final URLs are refused. Adapter retries are disabled. Failed-response bytes are counted, including malformed JSON and schema refusals.

`parseXeroPage(content, { resource, page?, pageSize? })` returns `AccountingPage`. `xeroSchemaFingerprint(content)` fingerprints original wire structure, including numeric versus quoted values. `createAccountingDecoder` in the shared adapter import module supplies the framework `QualifiedDecoder`; independently authorized human mapping review, raw read/import custody, and source-total reconciliation remain mandatory. Decoder ordering is unqualified; timestamps do not authorize automatic corrections.

Observed schema handling is deliberately conservative: optional-field, null, and empty-array variations can produce a different fingerprint, including an empty terminal page after a full page. Acquisition retains those bytes and reports drift; the current import gate quarantines them pending a reviewed schema profile. Multi-page import coverage is therefore not claimed for arbitrary heterogeneous Xero responses.

Only `branches: ['all']` with no period is admitted. Default dataset is `xero-${resource}`. This operation does not claim branch filtering, period filtering, deleted-history completeness, or a coherent tenant snapshot.

## Source semantics

Invoices preserve sales/bill types (`ACCREC`/`ACCPAY`), calendar dates, exact monetary spelling, line details, source tax mode, currencies, and source totals. Draft/submitted, authorised, paid, voided and deleted observations remain distinct. Credit-note allocations retain `IsDeleted`; embedded payments remain references. Cash is decoded separately from `Payments`, avoiding automatic credit/refund double counting. Source account `Class` drives classification; missing classes stay unknown. These fields follow the [official accounting schema](https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml).

Payment amount uses linked document currency; `BankAmount`, bank currency and `CurrencyRate` stay separate. A/R invoice payments map to inflow, A/P invoice payments to outflow, A/R credit payments to refund outflow, and A/P credit payments to refund inflow. This direction is an inference from the [official source type definitions](https://developer.xero.com/documentation/api/accounting/types), with no bank-settlement claim. Contradictory linked document types are refused.

The adapter preserves `Exclusive`, `Inclusive`, and `NoTax` without deriving tax from a name or applying a fresh tax rate. It does not recompute discounts, rounding, FX, accrual recognition, or tax liability. Missing quantities remain missing. Exponential monetary notation is refused rather than rounded. Calendar wrappers require midnight with zero/no offset and consistent explicit date companions; nonzero offset profiles are unqualified. Revision companions reject rollover dates and contradictory precision.

Pagination checks `page`, `pageSize`, `pageCount`, `itemCount` and actual rows. Without metadata, full pages require another request and short/empty pages terminate. A reported count is not an independent monetary report. `DateTimeUTC` is a response clock, so source generation time and snapshot stay unknown.

## Qualification and next evidence

All included JSON fixtures are authored synthetic test data. No fixture is a real account observation or a copied customer sample. No sandbox/live evidence or source credentials exist in this slice. Factory construction does not register qualification.

| Operation IDs | Implemented contract evidence | Sandbox/live |
| --- | --- | --- |
| `xero-invoices-read` / `xero-invoices-import` | Synthetic parser, read transport, paging and decoder interface | Unqualified |
| `xero-credit-notes-read` / `xero-credit-notes-import` | Synthetic credits, allocations and read transport | Unqualified |
| `xero-payments-read` / `xero-payments-import` | Synthetic payment/refund/direction and read transport | Unqualified |
| `xero-accounts-read` / `xero-accounts-import` | Synthetic account class and unpaged read transport | Unqualified |

Read grants are `accounting.invoices.read`, `accounting.payments.read`, and `accounting.settings.read`, chosen per resource. The [current scope guide](https://developer.xero.com/documentation/guides/oauth2/scopes/) and [granular-scope migration FAQ](https://developer.xero.com/faq/granular-scopes) take precedence over the broad scopes still displayed by this OpenAPI reference. Legacy broad grants need a separate reviewed profile.

To qualify actual execution, the parent needs an existing user-authorized OAuth broker credential reference, connection-selected tenant UUID, approved read grants/expiry, canonical company binding, and a no-retry/no-redirect transport attestation. Provide lawfully obtained raw JSON with SHA-256 and request context for empty/full/terminal pages, sales and supplier bills, draft/void/deleted cases, both credit directions, active/deleted allocations, partial payments, both refund directions, multi-currency document/bank amounts, explicit account classes, source revisions, and rate-limit/error responses. Also provide independent company/currency/period reports with exact row counts/totals, configuration/version identity, and independent review. No new account, payment, or write is necessary for the implemented synthetic contracts.

Unsupported profiles include prepayment/overpayment cash classification, arbitrary document types, nonzero date-wrapper offsets, single-invoice opt-in rounding behavior, reports/journals/bank-feed settlement, attachments, source corrections/deletions completeness, and all writes.

## Reference rights

The [Xero OpenAPI repository license](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/LICENSE) covers that specification under MIT. The notice below applies to reference-derived schema identifiers. Public documentation was used as internal implementation reference; this does not establish permission to redistribute vendor documentation, private data, or train models. The [developer terms](https://developer.xero.com/xero-developer-platform-terms-conditions) separately restrict API data use, including AI model training and third-party transfer. Actual API use needs the appropriate approved use case and user consent.

```text
MIT License

Copyright (c) 2017 Xero Developer API

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Validation: `node --check platform/runtime/adapters/accounting/xero.ts` and `node --test platform/tests/accounting-xero.test.ts`. Strict TypeScript checking remains an integration check; no dependency installation is authorized here.
