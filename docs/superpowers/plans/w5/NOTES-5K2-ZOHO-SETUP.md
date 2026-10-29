# Zoho setup provider increment

Provider implementation only. Root owns durable journal integration, owner UI, public session/account configuration and full K2 acceptance. No live credentials or provider accounts were used. Test responses are explicitly synthetic API-schema fixtures, never native captures.

## Official evidence checked 28 October 2026

- [Contacts API](https://www.zoho.com/books/api/v3/contacts/), including the [official OpenAPI schema](https://www.zoho.com/books/api/v3/contacts/contacts.yml): customer/vendor types, exact contact number, GST treatment and place, INR currency identity, zero opening balances, disabled portal and no contact persons. Stable contact numbers are owner supplied and bounded to fifty characters. Full lookup explicitly includes inactive contacts with Status.All.
- [Chart of Accounts API](https://www.zoho.com/books/api/v3/chart-of-accounts/): owner-selected account code and documented account type. No inferred classification or implicit master creation. Full list uses AccountType.All then reads each detail.
- [Opening Balance API](https://www.zoho.com/books/api/v3/opening-balance/) and [India opening-balance help](https://www.zoho.com/in/books/help/settings/opening-balances.html): this is organization-wide migration state, never a new document each financial cycle. Customers/vendors and general ledger balances are separate accounting concerns. This increment does not fabricate an AR/AP allocation or import inventory balances.
- [Organizations OpenAPI schema](https://www.zoho.com/books/api/v3/organizations/organizations.yml): organization identity, active state, INR currency ID/code, two-decimal precision and address country India are verified before preparation.

Copies of the three downloaded official schemas are ignored research evidence in results/zoho-contacts-official.yml, zoho-opening-official.yml and zoho-organizations-official.yml. They are not production fixtures or credentials.

## API and safety contract

`createZohoSetupAdapter(connection, net)` exposes `connectionIdentity`, `prepareMaster`, `readMaster`, `sendMaster`, `prepareOpening`, `readOpening`, `sendOpening`.

Master input is an exact tagged union: contact (source ID, name, stable number, customer/vendor type, customer subtype where relevant, explicit GST treatment/number/place, INR currency ID and explicit openingBalanceMinor zero) or account (source ID, name, stable code, explicit supported type, INR currency ID). Lookup reads up to twenty pages, two hundred rows per page, one thousand total identities, and every detail. An unfinished page, duplicate, casing/spacing collision, same-name different identity, cross-company evidence or conflicting material field refuses. Readback returns provider ID and normalized material digest. Preparation only accepts proven absence; it does not update existing records.

Prepared objects retain the complete input, stable external identity, exact POST path/query/body, connection identity, evidence and material digests, and final digest. They contain no token. Restart does not depend on an ephemeral map. `send` rebuilds from live evidence and compares the entire approved digest, then invokes the required callback at the pinned physical transport immediately before one request. Root must bind the current source/account/consent and durable journal claim in that callback. Master journal subjects must use organization + kind + stable number/code, independent of cycle or connection revision.

Opening input uses the actual resolved account IDs after separately approved masters, a migration date, explicit locationId null, INR currency ID and balanced BigInt debit/credit entries. Supported scope is ordinary general-ledger accounts with zero contact opening balances, no AR/AP, inventory, foreign currency or location allocation. A balance is prepared only when the provider explicitly returns an opening_balance object with accounts empty, total zero and no nonempty identity. Missing object/fields, nonzero totals or existing identity refuse; no absence is inferred from HTTP errors or omitted data. This empty-state envelope is a conservative acceptance condition, not a claim that every installation returns it. Accounts are read live and bound by ID, name, code, type, parent and currency. Existing migration balances are never overwritten. The opening journal subject is organization-wide, never cycle-wide. Readback sorts exact account entries and binds date, location, currencies and both sides of every amount.

No PUT, delete, email, contact person, portal invitation, implicit tax rate, retry or automatic recovery resend is implemented. Provider acknowledgement alone is not confirmation; root must read back and compare material identity. Unknown outcomes remain unknown until reconciled. Unsupported setup profiles use the reviewed manual handoff.

## Files and verification

Own new files: platform/runtime/adapters/accounting/zoho-setup.ts, zoho-setup-types.ts, zoho-transport.ts; platform/tests/accounting-zoho-setup.test.ts, accounting-zoho-transport.test.ts; this note.

Approved shared refactor: zoho-write.ts delegates connection validation, pinned GET/POST and exact response parsing to zoho-transport.ts. It retains nested contact/item/tax/invoice company fences and reexports ZohoWriteConnection. No invoice payload/material rule changed.

- Initial correct missing-module RED: results/w5-k2-zoho-setup-red.txt and w5-k2-zoho-transport-red.txt.
- Root review exposed data-centre array coercion. Correct RED then strict-string fix: w5-k2-zoho-transport-shape-red.txt.
- Identity-casing and unexpected account hierarchy RED before fixes: w5-k2-zoho-setup-identity-red.txt.
- Explicit inactive-contact read RED before adding Status.All: w5-k2-zoho-setup-inactive-red.txt.
- Malformed provider JSON initially leaked a source parser code. RED then normalization to BOOKS_READ_FAILED or BOOKS_WRITE_UNCONFIRMED: w5-k2-zoho-transport-response-red.txt.
- Final setup11 + transport4 + prior invoice/provider/material18 = 33/33, fail0: results/w5-k2-zoho-setup-final.txt. Default C temp used.
- One initial setup assertion used a single row and hit the minimum-row validator before balance validation; adjusted its fixture to two unequal sides. No assertion was weakened.

Independent review pending. No full-package or visual PASS is claimed here.

Get-account source correction: official Chart of Accounts Get response places account fields at the response root, unlike create/update envelopes. Corrected synthetic GET fixture first, observed BOOKS_READ_FAILED expected-object RED in w5-k2-zoho-setup-account-shape-red.txt, then changed setup detail reads to the documented root shape with no compatibility fallback. New regression run follows in the same final log.

Provider summary total is not used to confirm nonempty written opening accounts. The official documentation does not establish its arithmetic meaning; confirmation binds each exact account, currency, debit and credit amount plus the migration date and location instead. The explicit empty-state total-zero check remains an additional absence condition.

## Independent root provider review

Root STAGE 1 SPEC PASS and STAGE 2 QUALITY PASS for the documented supported setup provider profile and shared transport only. Exact owner source integration, durable journal, UI and full K2 remain separate. Independently ran setup/transport/invoice/public and reviewer fixtures: 34/34 in results/w5-k2-setup-root-final.log. Verified documented root account GET and wrong-organization rejection. Data-centre coercion and incorrect nested account GET fixtures were repaired before acceptance.

An exploratory total-versus-opening-lines assertion was withdrawn: the official summary total field does not specify enough arithmetic semantics to assume debit-side or all-lines summation. That failed assertion is not reported as a fixed bug or a killed mutant. Readback confirmation uses every exact account, debit/credit amount, currency and migration date; the ambiguous summary total is not used as proof of written accounts. Native account qualification is not claimed.
