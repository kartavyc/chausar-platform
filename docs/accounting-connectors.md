# Accounting adapter slice and parent integration

This document and `accounting-validation.json` record the historical standalone slice `39d15618baf91684c72d0718b5c5c52da9131167`. Current Engine registration, strict TypeScript validation, refused native admission and remaining shared translation contracts are in [Accounting Engine join](accounting-engine-join.md). The later continuation is not included in this join.

This task owns `platform/runtime/adapters/accounting/`, six accounting test files, authored synthetic fixtures and this documentation. Its base is connector-framework commit `af089b75de85b8a07025f29970f609449aefc338`. It changes no framework, engine, database schema, baseline catalogue or main branch. The task-owned clone hosts branch `task-9/accounting-adapters` and its isolated worktree. No provider, network client, credentials, runtime qualification registry or engine entrypoint is installed by importing these adapters.

The approved product remains the original fifty groups plus Khatabook, OkCredit, myBillBook, BharatPe, Petpooja and Form26AS/AIS. Tally, Zoho Books, QuickBooks and Xero are this first slice. QuickBooks remains included. The parent owns the remaining catalogue and integration.

## Concrete first adapter

Zoho Books v3 is the first accountable sample-to-receipt path. `accounting-framework-integration.test.ts` exercises the actual `createZohoReadAdapter` and `parseZohoPage`, using an authored invoice response and an injected fixture transport. It retains exact original response bytes and SHA-256 through `ConnectorReadDispatcher` and `ConnectorReadImportBridge`; an owner reviews the exact decoder/recipe/domain; an independently hand-worked synthetic report reconciles invoice net value before `CursorImportService.publish`; the existing exact calculator produces a **billed** receipt. An invoice does not become an earned-sale or settled-cash event.

This is an executable synthetic demonstration, not semantic qualification of Zoho or a real organization. The source adapter honestly reports unknown source time/snapshot. The capture uses an unverified snapshot and the default `assertReady(..., true)` refuses certification even after matching totals. The test's limited calculator invocation demonstrates arithmetic/custody, not a certified production answer. Readable full invoice schema, actual organization custody, independent semantic corpus and trusted gate wiring remain required.

## Framework interfaces

The barrel is `platform/runtime/adapters/accounting/index.ts`. API factories implement the existing `ApiReadAdapter`; Tally implements `ExportReadAdapter`. Acquisition always requires explicit credential-broker authorization and injected transport/file reader. Exact company, resource, format/version, profile, dataset and paging settings are pinned; returned operation metadata is frozen. Transports must disable redirects/internal retries, preserve original bytes, attest the final allowlisted URL and enforce cancellation/budgets. All post-response decode failures include received bytes. Unsupported Retry-After formats deliberately exceed retry budgets rather than permitting an early retry.

`AccountingPage` and `AccountingRecord` are adapter-local representations, not a new shared engine schema. They retain source records, quantities, line amounts, taxes, allocations, account class, source total/balance, raw status and warnings. Missing money/currency/date remains null. Quantity and amount lexemes never become binary floating point. Native JSON exponents are retained in raw custody but the accounting decimal route refuses exponent-form amounts pending a reviewed representation.

`createAccountingDecoder` implements `QualifiedDecoder`. Its trusted parser, wire schema, company/dataset/branch, selected source measure and explicit currency precision map are pinned. The precision/configuration profile contributes to decoder version. It emits exact integer minor units, exact source event type and raw status key, retaining the entire normalized source record as accounting evidence. Provider revisions or content identities are retained; revision ordering is **unqualified**. Changed resources quarantine rather than silently replacing existing facts.

`proposeAccountingMapping` returns an unaccepted data-only recipe. A recipe must explicitly map `eventType` (kind, source subtype and direction) and `statusKey` (normalized status plus actual source status). This prevents customer invoices/purchase bills, incoming/outgoing payments and failed/successful observations from sharing a generic mapping. AI proposals have no acceptance authority; the existing owner review binds the exact recipe and source report. The generic mapping route does not translate line quantities, per-tax controls, withholding, FX or earned revenue automatically.

`reconcileAccountingSourceTotals` checks one source kind/currency/measure against an independent report in exact minor units. Equivalent revisions contribute once; contradictory identities, multiple unqualified observations, mixed kinds/currencies and fractional minor units refuse. Missing amounts and empty supplied arrays cannot manufacture observed zero. Voucher journal/document consistency checks are separate from independent source-report reconciliation.

Observed source shape fingerprints include numeric-versus-quoted types. New/optional/null fields and empty collections can conservatively cause schema quarantine across otherwise normal pages. No generic heterogeneous multi-page import compatibility is claimed without a separately reviewed optional-field profile. A static parser/version hash is not substituted for the actual observed wire fingerprint.

## Operation qualification states

Every operation is unqualified in an empty/default framework registry. Fixture tests describe implementation evidence; the parent must register exact read and import independently. No sandbox/live/vendor-account semantic evidence exists. No remote write operation is implemented.

| Adapter | Implemented acquisition/parser families | Qualification boundary |
| --- | --- | --- |
| Tally 6.0 / 7.0 XML v1 | Explicit response/offline file profiles, vouchers and ledger accounts; posting/item/bill lines, signed exact journal checks | Authored synthetic fixtures only; source money totals, status/cancellation/deletion/tax/refund/FX/snapshot/corrections unqualified |
| TallyPrime 7 native JSON | Documented envelope parser and raw custody checks | Voucher/account semantic mapping intentionally unimplemented and refused; header version 1 is distinct from application Release 7; legacy custom JSON is not interchangeable |
| Zoho Books v3 | Invoice, credit note, customer payment, chart-of-accounts list/detail; separate credit/payment refund lists | Synthetic candidate only; invoice schema reader blocked; list termination absent/null refuses; refunded aggregates are not events; cash settlement and refund currency unverified |
| QuickBooks Online v3 | Invoice, CreditMemo, Payment, RefundReceipt, Account query pages; exact requested minor version and optional posting-date scope | Synthetic fixtures only; unified SDK optional invoiceStatus availability unqualified in actual realm; zero is not void/paid; grouped applications not duplicated; cash settlement/earned recognition unverified |
| Xero Accounting 2.0 | Invoice/bill, credit note, payment/credit refund, account resource pages; exact source subtypes and directions | Synthetic fixtures only; no upstream snapshot; nonzero date offsets and advanced over/prepayment/rounding semantics refused or unqualified; returned original totals preserved |

Detailed operation/profile states, official source links, scope requirements and samples are in [Tally](accounting-tally.md), [Zoho](accounting-zoho.md), [QuickBooks](accounting-quickbooks.md) and [Xero](accounting-xero.md).

## Alignment with semantic gate fe26fa9

Read the semantic sibling handoff at `task-7/semantic-qualification/platform/semantic-qualification/docs/connector-handoff.md` and its executable `src/publication-gate.ts`, committed as `fe26fa945ccd847aad45310668853e67d0077f66`. No sibling files or package were copied, cherry-picked or changed. Its seventeen cases and gate host tests are synthetic; they do not qualify any vendor data.

The exact parent join is `evaluateConnectorSemanticGate({ binding, ledger, expectedHead, measure, evidenceId }, host)`. Accounting acquisition/import operation IDs are independent of a semantic measure such as `billed`. Read and import scopes must share the exact system/version/edition/configuration in semantic evidence. Tally uses release 6.0/7.0 plus wire profile; Zoho uses v3; QuickBooks uses the exact `v3-minor-<n>` profile; Xero uses Accounting 2.0, distinct from OpenAPI reference version 19.0.0. Do not reuse a generic semantic pack whose product/configuration identity differs.

| Semantic binding field | Required parent-owned source |
| --- | --- |
| workspace/source/readScope/importScope | Current authorized acquisition and independent file-import operation |
| readDefinitionDigest/readEvidenceDigest | Current registry qualification matching the issued read receipt |
| importDefinitionDigest/importEvidenceDigest/importImplementationDigest | Current import registration with `assertDefinition` and pinned implementation; registration alone is not evidence |
| captureId/generation/reviewId/recipeHash/decoder | Fenced stored capture, exact current owner review and `decoderDescriptor()` definition |
| originalPageHashes | Acquired native bytes in issued result and stored `ReadImportLink.pages`; never a decoded-row hash |
| datasetManifestId/sourceReceiptId/sourceRowsHash | Rights-admitted semantic `SourceBatch` and its exact translated rows; logical dataset and corpus manifest ID are distinct |
| semanticMappingFingerprint | Independently reviewed linkage from this exact baseline recipe/decoder to the compiled semantic pack/rules/ontology |
| domain.period/snapshot/sourceObservedAt | Verified exact acquisition coverage, source snapshot and source observation time, not capture time or a payload assertion |
| ledger/expectedHead/evidenceId/measure | Current qualified semantic operation receipt and independently retained durable hash-chain anchor |

The current generic decoder is a custody/import projection, not a complete semantic `SourceBatch` translator. That translator must preserve source subtype/direction/status, tax/net/gross controls, fractional quantities/unit scales, refund links, company rules and currency scales. It must not parse `accounting` as executable code, zero-fill missing fields, treat invoice date as delivery date, or infer FX/bank settlement. The source-row hash must fingerprint the exact admitted compiler input; it is not interchangeable with decoder schema or native page hashes.

Parent must install two stages: rights admission plus `qualifyCase` before newly qualified facts are inserted, then `assertReady(ctx, sourceId, domain, true)` plus the semantic gate before certifying a query/answer. The integration baseline now provides the synchronous semantic pre-insert hook and actual Engine gate; this accounting slice's custody projection and native fixture evidence do not meet its translation/admission contracts. This branch does not label its fixture publication semantically certified.

No permissive host is supplied. The parent must inject trusted clock, persisted ledger head, original-byte/capture/recipe custody verifier, current access/reviewer checks, capture readiness, exact qualification and current mapping/schema/rights/report/split/golden dependencies. All bindings/digests and generation fences must be checked before and after async work. The gate prototype refuses sandbox/live minima and always returns `liveVerified: false` and `writebackQualified: false`.

The first Zoho fixture path cannot pass this gate: acquisition has no period-scoped source snapshot or source clock; the vendor corpus/rights manifest, independent golden/holdout evidence, semantic recipe link, persisted anchor and trusted host are absent. This is the concrete qualification blocker, not a request to invent snapshot IDs or borrow the sibling's synthetic evidence.

## Required credentials, samples and rights

Supply credentials only through the parent's opaque broker reference. Tally needs user-selected exported files plus exact company/release/edition/configuration/currency. Zoho needs an existing authorized organization, confirmed DC/edition and resource READ scopes. QuickBooks needs an existing approved OAuth app/realm and `com.intuit.quickbooks.accounting` authorization; that vendor grant is broader than this GET-only adapter. Xero needs an existing authorized tenant UUID and resource-specific invoice/payment/settings read grants. No account creation or live call was performed.

Each real profile needs first/middle/terminal list pages and matched detail exports, actual field/schema/version evidence, native content hashes and acquisition authorization, taxes/currencies/decimal quantities, draft/void/partial/paid examples, credits versus cash refunds, payment success/failure/unapplied/grouped applications, account classification and independent source reports by kind/currency/company/branch/period/snapshot. Controlled before/after corrections/deletions require separately qualified ordering/completeness. Tally native7 additionally needs readable official voucher/ledger samples: API Explorer returned 403; linked DOCX responses cannot be read by the allowed web reader. Zoho full invoice HTML exceeds the web reader limit and linked OpenAPI media type is unsupported. Intuit entity pages return application placeholders; current readable unified SDK fields are not actual-account availability evidence.

Public vendor docs are internal references, separately from redistribution/training rights. Only the Xero OpenAPI specification's MIT grant is identified; it does not grant rights over business datasets or vendor services. Authored fixtures contain no private business data. Actual uploaded exports require authorization, redaction/rights admission, permitted qualification use, and separately evidenced redistribution/training permissions. No private scraping or denial bypass occurred.

## Validation

Final combined run: **238 passed, zero failed/cancelled/skipped**, including 99 new accounting tests and the 139 required framework/import/engine/action regressions. Syntax and JSON validation passed for 80 source files. The saved first-adapter artifact contains billed `valueMinor: "10000"`, original-byte hashes, decoder/review/capture/recipe/report lineage and actual `SOURCE_NOT_READY` refusal. `accounting-validation.json` records test counts, artifact and 24 fixture hashes. The fixtures have local LF attributes so their committed native bytes remain deterministic across checkouts.

Run the six new accounting test files with the five framework contracts and `connectors.test.ts`, `business-engine.test.ts`, `workflows-actions.test.ts`, followed by `node scripts/check.mjs`. The installed npm CLI was invoked directly per the recovery report; `typecheck` is blocked because local TypeScript dependencies/`tsc` are absent. Nothing was installed and no successful strict typecheck is claimed. Final local commit is returned with the task handoff.
