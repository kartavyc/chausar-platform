# Semantic qualification prototype

Executable deterministic qualification for authored synthetic business registers. This package is isolated from the production runtime. It does not implement or qualify the 56 named connector groups.

From the repository root, using Node 24.13.1 or later:

```powershell
node --test platform/semantic-qualification/tests/*.test.ts
node platform/semantic-qualification/run-suite.ts
node scripts/check.mjs
```

There are no package dependencies, installs, external credentials or network effects. `run-suite.ts` writes only its package's `evidence/` directory. The root manifest and CI remain unchanged; the parent must add these commands to integration checks.

The source contract separates product/version/edition/configuration mapping packs from company/branch/tax-registration/currency/unit rules. The compiler accepts explicit fixed bindings and semantic tables, with no executable SQL, model arithmetic, formula or script surface. It hashes the actual compiler source distribution in addition to pack, rules, ontology and raw schema. Exact money uses decimal strings and BigInt. Unsupported or ambiguous kinds, states, amounts, units, dates, refund signs and links abstain atomically. A schema or product change invalidates the mapping.

Qualification admission verifies acquisition and reuse rights, personal-data review, consumer-local artifact hashes, complete company/template/configuration split membership and pack/rule provenance before any arithmetic. Unresolved admission throws `SemanticError` without appending source-bearing receipts. Admitted semantic failures create unqualified operation evidence with one clarification and no returned proposed facts, values, controls or source-row exclusions.

Every accepted case reconciles included/excluded/source row counts and per-kind/per-currency net, tax and gross controls to independent source report literals. Independent golden assertions verify every included row's identity, kind, date, company, branch, tax registration, currency/scale, net/tax/gross money, quantity/unit, refund link and source position. They also verify exclusions and seven operation values. Money equality alone cannot establish a correct date, quantity or identity.

`billed`, `earned`, `refunds`, `purchases` and `costs` sum their respective net event amounts. `received` sums included payment gross cash amounts, including tax. `net_sales` subtracts only refunds explicitly linked to delivered sales; an invoice credit does not establish a sale reversal. The fixture ontology's `event-date` is deliberately narrow; real invoice, delivery, completion and settlement date bindings remain unimplemented. Costs in this fixture ontology are explicitly net of tax; real tax recoverability and composition/unregistered cases require additional company rules and assertions.

The 17 independently authored disclosed synthetic cases include eight answerable businesses and nine deliberately ambiguous/adversarial businesses. Entire company, template and configuration origins are withheld across the eight tuning and nine holdout cases. Two template families use different raw columns, tax-exclusive versus inclusive values, and ISO versus day-first dates. Expected monetary, semantic and exclusion values are literal and authored in a separate agent lane without inspecting the mapper. The fixtures are public and reviewer-authored synthetic examples, not human-signed business books or a sealed model generalization benchmark.

Evidence is generated per operation, with original source row receipts, source controls, exclusions, golden/split/manifest hashes and exact configuration scope. Hash-linked ledger records detect changes and reordering; an independently retained head also detects truncation. This is local tamper evidence, not a publisher signature or secure persistence. Reuse checks include current mapping, schema, row-set/snapshot, source report, rights/provenance manifest, split and golden hashes.

All official-source candidates remain discovery-only. The candidate registry separates reference/schema documents, coherent business books and independent company/configuration/version/template origins from synthetic cases. Future 1,500–3,000 configuration-bundle suggestions are aspirational acquisition targets, not known available or qualified data. Code licenses do not automatically authorize dataset training or redistribution. The manifest records acquisition, reuse, redistribution and training independently. Generic licensed data cannot qualify a named connector; executable qualification currently rejects all systems except the authored `synthetic-register` profile.

Start with [the interface proposal](docs/interface-proposal.md), [the exact connector gate](docs/connector-handoff.md), [source research](docs/public-sources.md), [exact gaps](docs/gaps.md), and [the generated qualification report](evidence/qualification-report.json). The requested roster is 50 original groups plus six additions, with QuickBooks retained. Read/import/write status stays unqualified for every named group. Source-specific traps are recorded as unqualified assertion requirements in `fixtures/source-profile-requirements.json`; this package does not pretend those vendor guards have been implemented.
