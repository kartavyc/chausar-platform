# Public corpus intake: stopped attempts

No external dataset was acquired or admitted. This separate intake continuation preserves semantic implementation commit `fe26fa945ccd847aad45310668853e67d0077f66` and changes no connector/compiler integration files.

[manifest.json](manifest.json) identifies the three requested generic source families, their permission evidence, attribution, proposed schema, provenance, stopped endpoints and actual counts. [manifest.schema.json](manifest.schema.json) defines the blocked-attempt contract. It cannot represent corpus admission or qualification. The 1,500–3,000 independent configuration bundle range remains an aspirational research target.

| Source | Verified rights evidence | Exact acquisition blocker | Acquired dataset size/hash |
| --- | --- | --- | --- |
| UCI Online Retail | The [official dataset page](https://archive.ics.uci.edu/dataset/352/online%2Bretail) explicitly assigns CC BY 4.0. Full normalized [legal text](evidence/CC-BY-4.0.normalized.txt) is retained. | Official ZIP link through the public web tool: `(400) Content length is too large: 4194305+`. | Absent: size, SHA-256 and local path are `null`; actual retained data bytes are 0. |
| Microsoft AdventureWorks | [Microsoft Learn](https://learn.microsoft.com/en-us/sql/samples/sql-samples-where-are?view=sql-server-ver17) states the sample repository uses MIT. Exact asset revision, licence text and component notices were not inspected. | Official GitHub database directory: `Failed to fetch restricted URL`. Stopped before selecting an asset. | Absent: size, SHA-256 and local path are `null`; actual retained data bytes are 0. |
| Microsoft WideWorldImporters | Same official repository-level MIT reference; exact asset/component review remains pending. | Same stopped official GitHub directory route. This was one shared discovery attempt, not a second dataset download. | Absent: size, SHA-256 and local path are `null`; actual retained data bytes are 0. |

The UCI page reports `Online Retail.xlsx`, 22.6 MB, 541,909 instances, eight named columns and one UK retailer. Those values are documentation-reported, not observed file sizes, headers, rows or independently acquired companies. `4194305+` is the tool error threshold and supplies no measured ZIP size. The exact original dataset and HTTP byte hashes remain unknown.

Actual corpus counts are **0 dataset assets, 0 retained dataset bytes, 0 coherent business books, 0 independent company/configuration families, 0 named adapters qualified and 0 new synthetic cases**. Separately, five retained reference/schema/attempt artifacts occupy **26,992 bytes**: three primary reference captures, one derived schema specification and one acquisition receipt file containing two route attempts. No reference capture increments a corpus count.

The normalized CC licence capture has SHA-256 `2ade8c89b8bbe0d859b124a9e47032c8494022f43091e8278ae8e2554a292196`, 18,615 bytes and all 354 consecutively extracted web-tool text lines. Its revision is Attribution 4.0 International; upstream VCS/HTTP revision was not exposed. The manifest records normalization explicitly: this is a hash of retained evidence text, not original HTTP bytes. Creative Commons dedicates its public licence text to CC0 in the text's final notice. Curated UCI metadata deliberately excludes the creator's email.

## Rights and attribution

UCI attribution: **Chen, D. (2015). Online Retail [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5BW33. CC BY 4.0: https://creativecommons.org/licenses/by/4.0/.** No dataset changes have occurred. Future projections must describe actual changes and retain supplied attribution, notices, licence/source links and disclaimers when shared. The licence does not grant privacy/personality, patent or trademark rights and supplies no endorsement or accuracy warranty.

Acquisition, reuse and redistribution copyright permissions are recorded separately from operational admission. A training copyright basis is an inference from CC BY reproduction/adaptation/database grants, not bespoke UCI training consent. No dataset was disclosed to a model, no training pipeline was authorized or run, and no sample row entered the semantic engine. Microsoft's official MIT reference is retained as a repository claim; the exact release licence and any component notices cannot be invented after the route failed.

## Reproducible next intake

Both source acquisition attempts are terminal under the user's stop-on-blocked-route instruction. No shell network, mirrors, alternate hosts, range/chunk requests, accounts, payments or submitted user details were used. The package contains no downloader or network code. Resume only after a permitted binary transfer capability exists and a fresh authorized intake is recorded. Do not retry these stopped routes or prior npm/cache routes.

[The proposed UCI schema](schemas/uci-online-retail.documented-schema.json) keeps InvoiceNo, StockCode, Quantity, InvoiceDate and UnitPrice. CustomerID, Country and Description are planned exclusions before retention; no rows have been inspected, redacted or anonymized. Remaining source identifiers may permit linkage, so minimization cannot be called anonymization. A future parser must review bounded transient/quarantine handling before any raw workbook storage, inspect package parts/hidden sheets/external links/actual columns and reject unexpected identifying fields. Record original artifact hash and byte count, parser build, projection hash, schema fingerprint and source-cell receipts without retaining unnecessary fields.

Keep decimal/numeric-cell lexemes exact. GBP price metadata does not establish tax inclusion, date basis/timezone, quantity units, fulfillment or settlement. The `c` cancellation marker does not prove cash refunded. No independent source accounting report or coherent golden-company bundle was acquired. Refuse money/revenue qualification until those gaps are resolved.

Hold out entire company and template/configuration origins, including clones, subsets, alternate exports and revisions. Customer IDs, invoices, periods, database versions and derivative exports never become independent companies. Origins and split assignment remain unassigned in these blocked receipts. Generic Microsoft/UCI sources cannot qualify Tally or any of the 56 named groups.

## Verify the retained record

Use installed Node directly from this directory; no dependencies or network are required:

```powershell
node audit.ts
node --test tests/*.test.ts
```

The audit depends only on the queued semantic package's data-only/hash helpers. It verifies the five retained artifact byte counts and hashes, separate metadata/observation fields, terminal blocker receipts, absent dataset hashes/sizes, no privacy/training/adapter claims, and recomputed zero corpus counts. It also checks the authored schema/projection consistency and official source/descriptor joins. Resolved artifact paths stay inside this package. SHA-256 receipts establish byte consistency, not publisher signatures or a deployed custody boundary. Repository commit/review anchors this record; changing both artifacts and their manifest hashes requires an independently reviewed new revision.
