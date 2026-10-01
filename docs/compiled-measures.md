# Owner-authored exact sums

An owner can publish a separate money definition through the existing dictionary screen/RPC and calculate it without adding a handwritten operation ID. For example, `bank_revenue` can explicitly count settled payment `amountMinor` while billed, received and earned retain their own meanings and receipts. A definition bound to `feeMinor` counts that field; the receipt no longer silently copies transaction `amountMinor` as its evidence.

The supported compiler subset is a single-definition exact money sum. Its closed artifact pins compiler/contract revision, operation and definition identity, record kind, money field, currency, sign, missing-value rule, dictionary revision, definition hash and artifact digest. The receipt anchors that artifact to the published dictionary hash. Each projected row names its measure field and carries that field's exact unsigned/signed input value; the definition's declared sign is applied once by arithmetic.

Both native adapters consume the same bounded artifact with the registered prepared sum statement. Definition names, identities and values stay parameters. Caller expressions, arbitrary SQL, unsupported artifacts and mismatched bindings refuse before acquiring a SQL connection. Native proof retains the compiled digest. An injected SQL connection remains labelled `injected-sql`; it does not establish native engine execution.

Existing fixed composite calculations keep their contracts. New sum artifacts are compiler-generated, not accepted as dictionary-authoring fields. Legacy dictionaries without an artifact catalogue can reconstruct the supported sum contract; a present but malformed, missing, duplicate or altered catalogue refuses. Legacy saved receipts remain readable under their original access checks. New compilation does not upgrade an old receipt to native evidence.

The existing calculator rechecks current authority, source readiness, facts and dictionary before saving. Missing-value `exclude` produces partial coverage; `reject` refuses. Dictionary changes mark old receipts stale; a new calculation uses the new authored meaning. Branch/source/member revocation and source deletion still govern private receipt retrieval. The semantic qualification service remains restricted to its existing qualified measures. Publishing an owner definition does not qualify a named vendor or an arbitrary source mapping.

Acceptance files:

- `platform/tests/compiled-measure.test.ts`: independent literals, actual bound fields, signs, large integers, null rules, compiler rejection, legacy shapes, atomic publication and races.
- `platform/tests/compiled-measure-sql.test.ts`: prepared adapter contracts in both dialects, mismatch refusal and compiled-type dispatch. Connections in these adapter fixtures are explicitly injected.
- `platform/tests/compiled-measure-http.test.ts`: public import → published catalogue → calculation → private receipt → reopen, authority/drift refusal and optional actual native DuckDB execution. Its file-storage fixture is explicitly experimental.
- `scripts/verify-compiled-measures.mjs`: separate opt-in native qualification against a pristine disposable loopback PostgreSQL database and actual DuckDB, including the production Engine storage path.

This addresses the bounded owner-measure path in `LIVE-D02-A08`, `LIVE-D02-X05` and `ARCH-018`. Full typed ontology/IR, units and missing-state algebra, relationships and grain, compiler target qualification, all 56 connector groups and the 250 final contracts retain their independent requirements. External corpus acquisition remains zero. No end-to-end quest, vendor, native GUI, hosted/enterprise or security release pass follows from these source tests.
