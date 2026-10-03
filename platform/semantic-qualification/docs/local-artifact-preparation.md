# Bounded local-artifact preparation

The preparation boundary in [`contracts.ts`](../src/local-artifact-preparation/contracts.ts) and [`preparation.ts`](../src/local-artifact-preparation/preparation.ts) records a versioned, reviewed projection of user-supplied local artifact evidence. Its output remains **UNQUALIFIED**. A preparation receipt grants no connector or vendor admission, fact publication, model disclosure, redistribution, training or writeback authority. It does not insert facts, acquire datasets or install an Engine route.

The existing [`DatasetManifest`](../src/contracts.ts) remains the source of dataset identity, declared origin/category, source revision, rights and artifact paths/digests. Preparation binds that exact manifest rather than creating a second qualification system. The synthetic fences in [`qualification.ts`](../src/qualification.ts), [`publication-gate.ts`](../src/publication-gate.ts) and [`engine-semantic.ts`](../../runtime/engine-semantic.ts) remain in force. An external origin enum value cannot establish qualification.

`prepareLocalArtifact(request, host)` validates a `LocalArtifactPreparationRequest`, compares its observed and projected data with trusted inspector/minimizer output, and returns a frozen `PreparedLocalArtifact`. `revalidateLocalArtifactPreparation(prepared, request, host)` checks the prepared result against the exact request, current host evidence and retained audit receipt before reuse, returning the frozen current snapshot. Consumers must use that returned snapshot; a mutable deserialized caller DTO is never certified for subsequent consumption. Neither function admits a source into semantic qualification.

## Evidence and custody

Original-byte custody must establish the exact byte sequence, its SHA-256 and byte length, the retained storage identity/version and the processing attempt. Parsing and review must refer to those same bytes. A stable path, caller-provided digest or deserialized `verified` flag cannot prove this custody. The trusted host owns independent custody verification and current evidence; the request cannot install those verifiers.

Parser identity binds the parser version/build and declared profile. Observed schema and cells retain their source coordinates, original cell types and literal lexemes. A claimed observation requires evidence tied to the verified original bytes and parser identity. Rehashing a fabricated observation makes it internally consistent; it does not make it observed. Missing or unverifiable custody, parser observations or review evidence refuses preparation.

The projection identifies the exact retained and removed fields. `CellProjectionReceipt` covers every observed cell, including removed cells, and binds its part, sheet, row, source column/index and source-cell hash to its disposition and output-column index. Numeric and date text must retain its original lexeme and source type, including displayed lexemes and number formats where present. A date serial remains syntax evidence. Preparation cannot round, normalize or invent replacement values. Privacy review must cover the original artifact, all inspected parts, the resulting projection and any sensitive cell-receipt hashes; removing visible columns alone cannot establish that hidden content is safe.

The receipt retains original, observation, schema, parser, manifest, projection, rights/privacy review and source-identity dependencies. Consumers must verify the receipt against independent current evidence before reuse. Rights withdrawal, changed bytes/storage version, parser revision, observations, projection, review or source identity invalidates the earlier receipt. A receipt digest is tamper evidence, not a publisher signature, secure storage or a legal grant. The host's `retainAudit` and `retainedReceiptHash` use the parent's existing audit store. They retain `receipt.id`, the hash of the full receipt payload excluding its own `id` field. `retainAudit` must atomically insert an absent attempt or confirm the same digest; it must refuse a conflicting existing attempt rather than overwrite it. The earlier pin lookup alone cannot provide this guarantee across processes. This module creates no separate authority ledger.

## Rights, privacy and source identity

Preparation uses the manifest's explicit rights evidence and permissions. Public availability and a permissive code license do not establish artifact rights. Unknown or denied acquisition/reuse permission, discovery-only status and unreviewed personal data refuse this boundary. Rights for other uses remain separately recorded and do not follow from successful preparation. The host must resolve applicable retention, parsing and derivative-use permission through the existing restricted intake review; this boundary cannot issue those grants.

Declared source origin, content status and source-family identity answer different questions. Preserve the manifest's `synthetic`, `official-public` or `authorized-upload` declaration while recording the actual source identity and evidenced family lineage separately. Unknown business, template or configuration families may remain unknown; the output cannot claim independence, a sealed holdout or a new observed installation from them. Renaming, sanitizing or exporting the same source again does not create an independent family.

Review binds the exact input and projection. A review over an earlier digest, an unreviewed personal-data classification or unsupported claims about removed content cannot satisfy it. Automated screening and synthetic tests cannot establish perfect secret or personal-data detection.

`rightsReviewSubject(manifest, custody)` and `privacyReviewSubject(manifest, observation, projection, projected)` produce the exact review subjects; `preparationEvidenceBinding(request)` binds the complete request dependencies. These helpers calculate hashes. The host's `verifyEvidence(binding, at)` must independently establish current custody, parser, rights, privacy and source evidence, including permission for local retention/inspection and receipt hashes. A self-supplied review reference or matching subject hash is insufficient. The host supplies the clock and checks current evidence throughout preparation and receipt reuse.

## Parser and minimizer interface limits

`LocalArtifactInspector.inspect(original, limits)` receives the exact verified original bytes and returns `ArtifactObservation`; its `identity` pins the implementation version/build/profile. `LocalArtifactMinimizer.project(observation, plan, limits)` returns `ProjectedArtifact` under its separately pinned identity. The request's observation and projection must agree exactly with these trusted host results. `LocalArtifactPreparationHost.readOriginal` resolves original custody to bytes; arbitrary paths are not opened by this module.

This task defines those parser/minimizer interfaces and validates their contract. It contains no workbook parser, file reader, archive extractor, native spreadsheet launcher or production minimizer. It cannot inspect an XLSX package, authenticate its publisher, prove parser correctness or qualify parser isolation merely by validating a DTO. A future host must supply actual bounded parser evidence and independently verified reviews; synthetic host callbacks are labelled fixtures.

Parser containment remains a separate required implementation: detect actual media type, inspect compound artifacts completely, prevent unauthorized external references, contain archive members and bound expansion, depth, execution and temporary storage. This version accepts only literal cells. Any formula, cached value, error cell, external link, encryption or active content refuses, including in a column selected for removal. Every declared part must be inspected. A later formula/cache acceptance policy needs separately qualified calculation provenance; this boundary performs no recalculation.

`PREPARATION_LIMITS` fixes the version-one budgets. Requests cannot raise them.

| Resource | Maximum |
| --- | --- |
| Original bytes | 16 MiB |
| Sum of declared expanded part bytes | 32 MiB |
| Parts | 256 |
| Sheets | 64 |
| Columns per sheet | 200 |
| Data rows per sheet | 2,000 |
| Observed cells | 4,000 |

The inherited data-only validator also bounds nesting to 32, data nodes to 300,000, arrays to 20,000 entries and strings to 20,000 characters; narrower field-specific limits still apply. It refuses accessors, sparse/decorated arrays and executable values. Evidence exceeding any applicable limit refuses before a receipt is issued. The declared expanded-byte budget is a contract check; actual parsing must enforce it while reading. These bounds describe this preparation contract, not measured production workbook capacity or parser resource certification.

## Future UCI reference workbook

The UCI Online Retail workbook has **not been acquired or parsed** for this task. Its discovery record in [`public-sources.md`](public-sources.md) remains reference evidence. A later separately authorized local preparation must:

- Pin exact original bytes, artifact revision, attribution, applicable license evidence and change notices.
- Inspect every workbook/package part, including hidden and very-hidden sheets, relationships, external links, formulas/caches and unexpected embedded content; report unsupported or incomplete inspection explicitly.
- Remove `CustomerID`, `Country` and `Description` from the reviewed derivative, with transformation lineage and removal receipts, then reinspect the derivative for residual sensitive content.
- Preserve the original numeric/date lexemes and cell types and bind retained cells to their original coordinates. Inspect formula-versus-literal distinctions without evaluating or following links; formulas/caches and external links remain outside this version's accepted preparation scope.
- Record unknown business/configuration meanings. Unit prices and cancellation-looking identifiers do not establish tax inclusion, amount units, settlement, payment, refund linkage or accounting event semantics. Do not manufacture source control reports or golden accounting labels from the projection.

No future prepared UCI derivative can qualify an ERP vendor, the 56-group roster or an unseen-company installation. The external corpus admitted count and qualified-vendor count remain unchanged by this module or its synthetic fixtures.

## Plan trace and validation scope

The contract follows [`CHAUSAR-FINAL-IN-DEPTH-PLAN.md`](../../../docs/specs/CHAUSAR-FINAL-IN-DEPTH-PLAN.md): §21.26 parser containment; §21.27 spreadsheet calculation provenance; §21.30 immutable processing custody; §21.38 purpose-specific rights; §21.39 restricted intake and versioned sanitization; §21.40 assertion/source authority; §21.41 correction and withdrawal dependencies; §21.42 origin-family holdouts; §21.46 synthetic limits; and §21.47 coherent evidence bundles.

[`local-artifact-preparation.test.ts`](../tests/local-artifact-preparation.test.ts) uses authored synthetic evidence to check missing/tampered custody, unknown rights, unreviewed personal data, unsafe paths, fabricated observations, stale receipts and constant unqualified outputs. Affected qualification regressions must continue to refuse external origin and named-vendor admission. These tests establish contract behavior only; they do not establish observed workbook contents, parser/minimizer correctness, corpus admission or release acceptance.

At the isolated `19d77160597a344c7b4cef7be2716eb210878632` base, validation on Node 24.19.0 passed 145 preparation tests plus 75 existing semantic tests (`node --test platform/semantic-qualification/tests/*.test.ts`), and 29 Engine semantic/translation tests (`node --test platform/tests/engine-semantic.test.ts platform/tests/engine-semantic-translation.test.ts`). Repository-wide `node scripts/check.mjs` passed syntax/JSON checks for 560 source files. `npm run typecheck` could not run because `tsc` was absent; no package was acquired. No native/browser launch, dataset acquisition, qualification-suite evidence regeneration or CI run was performed.
