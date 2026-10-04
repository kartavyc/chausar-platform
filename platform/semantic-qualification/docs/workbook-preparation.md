# Bounded workbook preparation

[`workbook-preparation.ts`](../src/local-artifact-preparation/workbook-preparation.ts) supplies an actual in-memory XLSX inspector and column minimizer for the existing [local-artifact preparation contract](local-artifact-preparation.md). [`workbook-container.ts`](../src/local-artifact-preparation/workbook-container.ts) reads a bounded ZIP/XML subset using installed Node and zlib. This is source-only preparation evidence tested with authored synthetic packages. No original UCI workbook has been acquired or parsed, and the original UCI download socket restriction has not been retried.

The result remains **UNQUALIFIED**. External real-corpus admission and qualified-vendor counts remain **zero**. These modules change no Today, frontend, Engine, connector admission or gate policy. Successful parsing grants no rights, declassification, publication, model disclosure, redistribution, training, connector admission or vendor qualification. Tax, units, settlement, cancellation and refund meanings remain unknown; a numeric cell, date format or identifier does not establish accounting semantics.

## APIs and the existing host boundary

- `createWorkbookInspector()` returns a `LocalArtifactInspector`. Its `inspect(originalBytes, PREPARATION_LIMITS)` produces the inventory and `ArtifactObservation` from those bytes, including hidden and very-hidden sheets.
- `proposeWorkbookMinimization(observation, id, version)` produces a versioned **review candidate**. It removes headers matching `CustomerID`, `Country` or `Description`, after trimming and case folding, in every sheet; other columns are initially retained. It supplies no review or authority evidence.
- `createWorkbookMinimizer()` returns a `LocalArtifactMinimizer`. Its `project(observation, plan, PREPARATION_LIMITS)` requires exactly one ordered retain/remove disposition for every column in every sheet and enforces removal of those three labels. Reviewers may remove additional columns. Sheets with no retained columns disappear from projected sheets; their cell removal receipts remain.
- `workbookMemberEvidencePath(name)` and `workbookMemberName(path)` map between an accepted package member and its contract-compatible evidence identity.

Install the inspector and minimizer on a trusted `LocalArtifactPreparationHost` and use the existing `prepareLocalArtifact(request, host)` entry point. Its independent custody read, trusted recomputation, manifest validation, review verification, audit receipt retention and final atomic `verifyRetainedEvidence` decision remain mandatory. The host must supply the existing custody, review, source-identity and audit stores; this slice provides no production host adapter or parallel authority ledger. `revalidateLocalArtifactPreparation` remains required before reuse, and consumers must use its returned current snapshot.

Rights and privacy reviews are explicit inputs over the exact subjects from `rightsReviewSubject` and `privacyReviewSubject`. These helpers calculate hashes; they do not approve a use. The host must independently establish current permission for local retention, inspection, derivative use and sensitive receipt hashes. It must atomically check current custody, rights/privacy/source evidence, installed implementation identities, retained attempt receipt and trusted decision time in one consistent final decision. Parser success and a matching self-supplied review hash cannot substitute for that decision.

## Byte custody, identity and cell evidence

The observation binds SHA-256 of the exact original ZIP bytes and a hash of the installed parser identity. Its part inventory records each actual member's inflated byte length and raw-byte SHA-256, with every member inspected before success. Original custody still comes from the trusted host and binds those bytes to storage version and processing attempt. Changed bytes, observations, parser identity, projection, review or retained evidence invalidate the earlier receipt through the existing contract.

Package member names are not extraction paths. An actual member such as `xl/worksheets/sheet1.xml` is represented as `opc/<lowercase ASCII hex>.part`; `workbookMemberName` reverses the mapping. Decode these identities when reviewing the actual inventory. Names are bounded portable ASCII, with a specific allowance for `[Content_Types].xml`. Traversal, absolute/drive paths, directories, reserved device names, trailing-dot aliases and duplicate/case-alias names refuse. No member is written to disk.

Implementation identities are measured from the installed `workbook-preparation.ts`, `workbook-container.ts` and `validation.ts` source-file bytes. The build hash binds those hashes; the profile hash binds the supported syntax, fixed budgets, Node version and zlib version. A caller or workbook cannot select its own implementation claim. The source files must remain available beside the module. A compiled distribution with absent or stale TypeScript sources is unsupported and needs a separately specified build-identity mechanism before use.

Row 1 is an explicit header convention in every sheet. Headers must be contiguous nonblank literal text, unique after trimming and case folding; labels are never invented. Row and cell coordinates must be explicit, unique and increasing, and every data column needs a header. Source row numbers are retained, including gaps. Missing cells within an existing data row's declared header grid become canonical blank observations; missing rows are not invented. Header values remain schema labels, not projected data rows.

The contract uses canonical types: inline/shared-string cells become `text`, literal `n` or an omitted `t` becomes `number`, `d` becomes `date`, `b` becomes `boolean`, and an empty untyped/numeric cell becomes `blank`. Shared strings are resolved only from the same inspected package; only a plain single `t` is supported. Raw OOXML `t` spelling, shared-string indices and XML markup remain recoverable from retained original bytes and raw part hashes rather than being copied as separate fields. This is a defined type mapping, not an Excel round-trip representation. Text character entities may be decoded. Entity-encoded numeric/date/index scalars refuse so that their exact original scalar spelling remains unambiguous.

Numbers remain literal decimal/exponent strings, including large integers, negative values, signs and trailing zeros. ISO date/date-time cells retain their exact supported text; no floating-point or calendar conversion occurs. Numeric date serials remain `number` cells with their exact recorded number format. The workbook's 1900/1904 date basis is disclosed in observation limitations; serial 60 is not converted. Supported built-in formats are `General`, `0`, `0.00`, `mm-dd-yy` and `m/d/yy h:mm`; explicit custom formats may be recorded without rendering. Locale-dependent or other built-in formats refuse. `displayLexeme`, `formula` and `cachedLexeme` are null for accepted cells; no displayed value is guessed.

Every observed data cell receives a projection receipt with member identity, sheet, original row and column, source column index, canonical source-cell hash, disposition and output column index. Retained cells preserve their observed lexeme and type. These fingerprints bind canonical cell evidence; raw part hashes and original custody bind original XML bytes. Removed values disappear from projected rows, but originals, headers, shared strings, observations and source-cell hashes remain sensitive evidence. Review all of them, including hidden content. Dropping columns does not establish declassification or authorize disclosure of the receipt.

## Supported forms and explicit refusals

This profile accepts conventional **transitional OOXML** namespaces, one root workbook relationship, complete exact content types, worksheet parts under `xl/worksheets/`, and optional conventional `xl/sharedStrings.xml` and `xl/styles.xml`. Workbook markup is restricted to sheet definitions and optional `date1904`; worksheet markup to optional dimension and literal row/cell data. Styles support bounded number formats and `cellXfs` with only `numFmtId`. Ordinary Excel files containing additional features can refuse even when Excel itself opens them.

| Layer | Accepted boundary | Refused examples |
| --- | --- | --- |
| ZIP | Stored or raw-deflate regular entries; exact central/local agreement, sizes, CRC and consumed compressed input | Encryption, ZIP64, multi-disk, descriptors, extra fields, archive/member comments, links/directories, overlap, gaps, prefixes, trailing or unindexed payloads |
| XML | UTF-8 XML 1.0; bounded exact namespaces; predefined/numeric character entities | DTDs and entity declarations, entity expansion, CDATA, comments, processing instructions, malformed XML, namespace aliases/redeclarations, unknown elements/attributes |
| Workbook | All visible, hidden and very-hidden sheets; plain inline/shared text, exact numbers, ISO dates, booleans and blanks | Any formula or cached formula representation, error cells, rich text, fonts/fills/borders and other unsupported styles, merged cells, unknown/orphaned parts or relationships |
| Relationships/content | Canonical internal relationships whose members and content types match the exact package inventory | External relationships/links, active content, VBA, embeddings, queries/connections and unsupported data parts |

Formula checks cover every parsed XML part, header, hidden sheet and removed column. Cached values are never trusted, formulas are never executed, and relationships are never retrieved. An external link or unsupported form refuses the whole observation; no partial safe result is issued by skipping that content. Binary/encrypted Office containers also refuse before XML parsing.

## Fixed budgets and the UCI mismatch

Both adapters require the exact existing `PREPARATION_LIMITS`; callers cannot increase or replace them.

| Resource | Maximum |
| --- | --- |
| Original bytes | 16 MiB |
| Aggregate inflated bytes | 32 MiB |
| ZIP parts | 256 |
| Sheets | 64 |
| Columns per sheet | 200 |
| Data rows per sheet | 2,000 |
| Cells | 4,000 |

The cell budget separately bounds actual XML cells including headers and complete observed data grids including missing cells. Deflate output is bounded while inflating and must equal the declared size. XML depth is at most 32, aggregate XML elements at most 100,000, attributes per element at most 32, and XML scalar text at most 20,000 characters. Cells, headers and number formats have the existing tighter 1,000-character lexical bound. Shared-string inventories are bounded by 4,000 and number-format/style tables by 200; the inherited data-only validator also applies.

The known UCI Online Retail reference workbook is about **22.6 MB**, above the existing **16 MiB** original-artifact limit. Even a parser that recognizes its syntax would not make that workbook acceptable under this contract. No limit is increased, and splitting/exporting an artifact to evade its limit is unsupported. This slice measures supported synthetic syntax and refusals; it establishes neither universal Excel capacity nor qualification acceptance for a real workbook. A future request must resolve the policy/size mismatch explicitly before intake, without retrying the restricted download.

## Validation and remaining intake work

The workbook tests use actual small authored ZIP/OOXML bytes, including stored and deflated entries. They exercise exact lexemes and mixed cell types, date serials and date basis, hidden-sheet disclosure, minimization and source-cell lineage, tampered custody, formula/external-link refusal, path and archive ambiguity, encryption and resource bounds, and constant unqualified authority. The overlap test reaches the span guard with distinct, valid matching local/central records; the trailing-deflate test verifies complete compressed-input consumption. Synthetic fixtures prove only those observed source behaviors; they provide no real-corpus or vendor evidence.

Validation on Node **24.19.0**, isolated from exact `5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd` (the supplied `8d9dfb7078c00b05f6ddf3454fb3662e2a123114` tip has the same tree):

- `node --test platform/semantic-qualification/tests/workbook-preparation.test.ts`: **98/98** passed.
- `node --test platform/semantic-qualification/tests/*.test.ts platform/tests/engine-semantic.test.ts platform/tests/engine-semantic-translation.test.ts platform/tests/workbook.test.ts`: **384/384** passed.
- `node scripts/check.mjs`: syntax/JSON validation passed for **595** source files; whitespace checks passed.
- Independent Standards review: **zero** remaining hard violations or reported smells. Independent Spec review: **zero** blocking requirement deviations. A duplicate path validator was consolidated and overlap/deflate evidence strengthened after review.

Strict TypeScript validation is unavailable: no `tsc` executable or installed local TypeScript compiler was found. Node syntax/type-stripping execution is not strict compilation. No compiler/package acquisition, native/browser/credential operation, dataset acquisition, qualification evidence regeneration or CI rerun was performed. Source publication uses a private branch, a non-force push and a skip-CI commit.

For a user-provided workbook, the remaining practical work is to retain exact original bytes under independently verified custody; establish explicit applicable rights and privacy reviews before authorized inspection; check size and supported forms; review the full inventory, hidden sheets, retained headers/shared strings and sensitive cell hashes; approve the versioned minimization candidate; and supply a production host whose final evidence decision has qualified transaction/isolation behavior. Unsupported syntax needs a separately bounded parser profile, not silent adaptation. Reinspect/review any separately authorized derivative and preserve its lineage. Only then can the existing preparation boundary issue an unqualified receipt; corpus or vendor admission remains a separate existing gate.
