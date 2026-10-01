# Tally accounting adapter: accountable first slice

This adapter parses explicitly selected UTF-8 XML exports into adapter-local source records. It never executes TDL, sends a Tally request, resolves credentials, or writes to Tally. `import` means importing retained evidence into Chausar through the parent-owned reviewed decoder and import bridge. Native Release 7 JSON currently has an envelope parser and a closed accounting-mapping refusal.

The implemented fixture profiles are exact TallyPrime `6.0` and `7.0`, XML messaging version `1`, declared `response-v1` or `offline-native` envelopes, and separate `vouchers` or `accounts` resources. They do not establish compatibility with other releases, editions, customized TDL schemas, or company configurations. Native JSON uses the independent `native-json-v7` / application `7.0` profile; messaging/header `Version: 1` is not application release 7.

## Interfaces and custody

`TallyProfile` binds application release, wire format, envelope variant, resource, exact company ID/name, edition, configuration profile, deployment profile, and explicitly reviewed ISO base currency or `null`. `tallyOperation(profile, 'export' | 'import')` hashes the complete profile into `applicability.configuration`, keeps resource in `applicability.module`, and returns frozen operation/applicability objects. Changing company, currency or profile changes the qualification scope.

- `parseTallyXml(text, profile): AccountingPage` returns records with original XML trees, signed source decimals, source types, direction, and explicit warnings.
- `parseTallyXmlDocument(text)` provides a bounded XML tree without resolving external entities or instructions.
- `tallyXmlSchemaFingerprint(text, profile)` hashes observed element/attribute paths and the declared release/envelope/resource. Optional-field changes conservatively trigger a new fingerprint.
- `reconcileTallyVoucher(node)` checks exact signed journal balance with BigInt decimal coefficients. Item and batch breakups are not counted twice. Overlapping direct ledger and inventory allocation representations make this check unavailable.
- `parseTallyNativeJsonEnvelope(text, profile)` retains the documented response containers and distinguishes numeric versus quoted wire types in its fingerprint. `messageCount` is explicitly not a qualified accounting record count.
- `parseTallyNativeJson(text, profile)` always refuses with `TALLY_NATIVE_JSON_MAPPING_UNQUALIFIED` after envelope validation.
- `createTallyExportAdapter({profile, environment, readExport})` implements framework `ExportReadAdapter`. The injected reader supplies `Uint8Array`, content type, company ID and company name. It receives opaque framework authorization; the parser never receives a token. There is no default endpoint, file path reader, credential broker or retry.

The read domain must select the same company in authority and data scope, dataset matching the resource, branches exactly `['all']`, no period, and no cursor. A complete file ends acquisition pagination; source row totals, source-generated time and consistent snapshot stay unknown. A source report and owner-approved domain reconciliation are still required before completeness claims. The parent dispatcher/bridge retains unchanged bytes and SHA-256; parsed trees do not replace raw custody.

## Mapped and unavailable meaning

Ledger entry amounts keep their source signs. `ISDEEMEDPOSITIVE` is recorded as the documented debit flag; a contradictory sign produces a warning. Inventory quantities and rates retain the original presentation in `source` while only documented simple numeric/unit presentations become exact numeric strings. Inventory/accounting/batch representations stay distinguishable. Bill allocations retain `New Ref`, `Agst Ref`, `Advance`, and `On Account` source values; bill-reference names are not proven document IDs.

`Sales` is a receivable invoice, `Purchase` a payable invoice, `Credit Note` a receivable credit, `Receipt` an inflow payment and `Payment` an outflow payment. These directions do not prove bank settlement. Custom voucher types remain vouchers. An explicit voucher `AMOUNT`, if present in a recognized decimal presentation, is retained as the source document total. Party amounts and line sums never fabricate a missing document total, tax total, balance or payment amount.

Ledger classification follows exact recognized predefined groups and exported custom-group ancestry as a candidate requiring human review. Missing ancestry is unknown. Duties and Taxes stays unknown because the group can contain liability or asset amounts. Localized names, renamed groups, branch/suspense classification and contradictory configuration require a reviewed mapping pack.

Dates accept real calendar `YYYYMMDD` values and convert to `YYYY-MM-DD` without adding a timezone. Currency is solely the explicit reviewed company currency; no INR default, symbol inference or FX conversion exists. Foreign-currency amount presentation stays raw and makes the normalized amount/currency unavailable. GST/VAT schedules, inclusive taxes, rounding, discount allocation, withholding and compound units require concrete export samples and additional mapping qualification.

Cancellation and deletion are distinct unresolved meanings. Source `ISCANCELLED`/`ISDELETED` fields, when present, remain in raw XML and do not change `status: unknown` without an evidenced export flag schema. Missing vouchers never establish deletion. Native offline export wrappers can contain exact `TALLYREQUEST: Import Data` and `Action: Create` metadata, which is retained as data and never executed. Cancel/Delete/Alter action packets are refused. All invoice/payment settlement states, correction ordering and deletion completeness remain unqualified; normalized revisions are `null`.

## Operation qualification

| Operation/profile | Current state | Evidence limit |
| --- | --- | --- |
| XML `response-v1` vouchers, explicit 6.0 / 7.0, file export + local import parser | Implemented; deterministic synthetic fixtures tested | No source account, real exporter sample, sandbox or live qualification |
| XML `offline-native` accounts, explicit 6.0 / 7.0, file export + local import parser | Implemented; deterministic synthetic fixtures tested | Same limit; exported group/master format requires independent review |
| Other supported-code XML resource/envelope combinations | Implemented code path, not operation-qualified by these fixtures | Add exact profile fixtures/evidence before registration |
| Native7 JSON documented response envelope | Synthetic envelope parsing tested | Opaque containers only; no native voucher/ledger mapping |
| Native7 JSON accounting export/local import | Unimplemented/unqualified; acquisition refuses | Readable native object samples blocked |
| Tally HTTP read, guided UI acquisition, any Tally write | Unimplemented/unqualified | No provider or endpoint installed |
| Corrections, deletions, voids, refunds, statutory tax/FX mapping and source completeness | Unqualified | Source-specific semantic and reconciliation evidence required |

The parent capability registry must bind the exact implemented operation and fixture artifact before calling it `synthetic-tested`. Neither registration nor these tests may promote a profile to sandbox/live. AI mapping proposals require human acceptance; this adapter does not publish accepted facts or install an automatic semantic mapping.

## Official reference and rights boundary

The [official XML integration overview](https://help.tallysolutions.com/xml-integration/) establishes versioned envelopes, response status and export/company variables. The [official XML sample reference](https://help.tallysolutions.com/sample-xml/) describes ledger/group ancestry, date, debit flag, signed postings, inventory/accounting/bill allocations, and balanced debit/credit requirements. Its example creation packets are source reference, not acquired company evidence. The [official chart of accounts reference](https://help.tallysolutions.com/tally-prime/accounting/charts-of-accounts-tally/) explains predefined group classification and the ambiguity of Duties and Taxes.

The [official JSON integration reference](https://help.tallysolutions.com/tally-prime-integration-using-json-1/) confirms Release 7 native JSON, the distinct messaging version, response containers and Tally Amount/Date/Quantity/Rate string types. It distinguishes native JSON/JSONEx from earlier/custom JSON. Concrete ledger/voucher responses link to DOCX files; the available web reader returned unsupported content type, so their object keys were not invented. The [Tally API Explorer](https://tallysolutions.com/tallyprime-api-explorer/) returned 403 to the parent research path. No denied-route bypass was attempted.

All committed fixtures are original synthetic data. No vendor example bodies, proprietary source exports, account data or credentials are redistributed. Public documentation is used for internal technical reference. Public availability does not grant redistribution, model-training or private-company access rights; obtain a separate rights decision for any collected vendor corpus. No external corpus is licensed by this change.

## Exact next evidence needed

1. Owner-authorized UTF-8 native XML exports for each selected release, edition and configuration, including Sales/Purchase invoices with inventory and accounting views, Credit Note/Debit Note, Receipt/Payment, bill allocations, custom voucher types, cancellation and deletion/Edit Log examples, foreign currency, GST/VAT/withholding, rounding and simple/compound units. Include original bytes and exporter settings, company binding, report/domain/period, source-generated time if supplied, and reviewed independent report totals.
2. Readable official native7 Ledger Collection Response and Voucher Collection Response samples, or owner-authorized Release 7 native JSON exports with original bytes and request/export format metadata (`svExportFormat: JSONEx`, explicit `svCurrentCompany`, actual application release and messaging `Version: 1`). Custom TDL JSON alone cannot establish native object keys.
3. An independently reviewed identity/revision mapping, account/group mapping, currency/tax interpretation, correction/deletion semantics, and accepted coverage gaps. Provide explicit source report totals per company/resource/currency/domain before readiness claims.
4. For file-export qualification, no password/API key is needed: inject authorized selected bytes plus company custody metadata and framework export grant. A future HTTP-read profile would additionally need an already authorized read-only Tally endpoint/profile and opaque credential reference, with policy-approved transport, redirect boundaries and no internal retries. This slice neither creates accounts nor enables servers/security settings.

Validation: `node --test platform/tests/accounting-tally.test.ts` passes **15 tests**, covering source precision/signs, invoice/credit/payment distinctions, group hierarchy, version/profile isolation, XML attacks and malformed input, schema changes, injected custody/domain/budget enforcement and native JSON fail-closed behavior. These synthetic fixtures do not qualify real accounting data.
