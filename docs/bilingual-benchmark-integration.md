# Bilingual benchmark integration contract

The lane adds an independently runnable synthetic benchmark around existing public Engine APIs. The integration coordinator owns Engine, Vault, shared IPC, authoritative manifests, publication and merging. This lane changes none of those shared hooks. Its source acceptance covers the authored fixture and actual local parser behavior; deployment and native qualification remain separate.

## Owned files and entry points

| Deliverable | Purpose |
| --- | --- |
| `fixtures/bilingual-benchmark/v1/questions.json` | Versioned open questions, paired language labels, requests, literal expectations and worked explanations. |
| `fixtures/bilingual-benchmark/v1/shop.csv`, `large.csv` | Authored source rows and exact-money boundary evidence. |
| `platform/benchmarks/bilingual/contracts.ts` | Package, observation, score and public port types. |
| `platform/benchmarks/bilingual/fixture.ts` | Package validation, fixture recipe, source controls and content fingerprints. |
| `platform/benchmarks/bilingual/runner.ts` | Public API execution, receipt checks, scoring, report and owned scratch cleanup. |
| `scripts/bilingual-benchmark.mjs` | CLI with an unused relative JSON output destination. |
| `docs/bilingual-benchmark-method.md` | Method, scoring definitions and qualification limits. |

The programmatic entry point is `runBilingualBenchmark({ scratchRoot })`. Supply an explicitly owned scratch root; Windows paths must resolve on C. The runner creates direct `chausar-bilingual-*` child directories, closes each Engine, verifies resolved cleanup targets stay within the scratch root and removes only those disposable fixture directories. It uses existing dependencies.

`PublicBenchmarkPort.request(method, payload)` is the narrow observation seam. `observePublicCase`, `scoreObservation` and `summarize` expose execution/scoring behavior for focused acceptance tests. The package permits `calculation.run`, `conversation.ask` and `receipts.get`; model-dispatch fields are excluded. Fixture preparation uses public workspace, dictionary, import, memory, member, trust and activity methods. The normal Engine calculation/current-authority checks remain installed.

## Fixture and acceptance contract

The package schema is `chausar.bilingual-synthetic-package.v1`; the report schema is `chausar.bilingual-synthetic-report.v1`. Changing questions, expectations, source rows or the method note changes their fingerprints; UTF-8 text is normalized from CRLF to LF before hashing so fresh Windows and LF source copies remain equivalent. Preserve the original question on the parser track. Treat typed requests as authored selections; no pretranslation or successful language-understanding claim is supported by that track.

There are 40 paired cases, producing 80 observations: 31 typed cases per language with 17 answers and 14 refusals, plus 9 parser cases per language. The reviewed core alias pack supplies exact, bounded phrase recognition for unchanged starter definitions. The parser expectations in each language are now 6 answers and 3 refusals. With all expectations matched, aggregate observed outcomes are 46 right, 0 wrong and 34 refused, while correctness is 80 correct and 0 incorrect. Each language is 23 right / 17 refused. These are package expectations, not a claim that a run has completed. Preserve language and track subtotals alongside aggregate scores. See `docs/core-operation-aliases.md` for the scope and semantic-binding contract; general language interpretation remains model-routed and unqualified here.

Answer checks require the authored operation, exact `valueMinor` and `totalMinor`, currency, complete figure set, counted entity set and declared coverage. Required exclusions, margin limitations and scenario/change assumptions are checked where specified. Successful responses are reread through the current `receipts.get` API; dictionary revision, definitions and their digest must match current fixture authority. Each receipt row must match its imported fact's source, source row, entity, kind, date, branch and exact amount. Request checks pin period, comparison period, branch and explicit source scope; supplied known-on time, aging day, customer and order selectors must match the returned evidence. Generated receipt/fact/import identities are not compared across independent runs.

Expected refusals cover unpublished/SQL-like operations, undeclared amount fields, impossible/inverted periods, unparseable known-on time, missing/out-of-range scenario assumptions, missing comparison period, invalid aging day, forbidden branch, explicit revoked source, revoked member and another member's private receipt. Error codes must remain exact. Unsupported questions must return the exact message and `receipt:null`. An observed refusal does not count as correct unless its expectation matches; refusals retaining a completed calculation fail acceptance.

The runner also verifies import reconciliation, duplicate import idempotency, zero provider dispatches and zero model receipts. It must never acquire dependencies, use real vaults or credentials, dispatch an LLM, launch a native GUI, spend money, send externally or publish a release as part of this source acceptance.

## Reproducibility and join evidence

Run the CLI from the integrated source copy and retain the JSON report outside the disposable fixture directories. Each run requires a new relative output filename. Record the integrated commit SHA, runtime version, command and report fingerprint in the coordinator's handoff. The report discloses execution times, experimental file storage and fixture count. Its semantic digest covers source/method fingerprints, stable dictionary semantics, observations and scores while omitting volatile identities and wall-clock timestamps.

The coordinator should run the focused acceptance tests and the benchmark against the actual joined code, preserving ordinary current-authority/readiness gates. A future release-candidate qualification must rerun from a fresh clean public copy and retain that copy's identity, candidate identity, per-language/per-track results and any mismatches. Local tests and isolated source copies do not establish that public-copy gate.

## Remaining requirements

`LIVE-D10-B13` calls for the open questions, correct calculations, worked answers, refusals, runner and method note, followed by clean public-copy/release-candidate evidence. `GAP-ONT-35` additionally describes positioning typed-operation model selection against text-to-SQL. This deterministic runner supplies neither model selection quality nor a text-to-SQL baseline; both are explicitly unqualified.

`GAP-ONT-30` is a separate experimental measure-subset export with Chausar semantics in `custom_extensions`, planned for the first update. No pinned, reviewed OSI schema/version was found in the inspected source. Schema selection/verification and the exporter remain coordinator-owned pending work; a guessed exporter is not part of this lane.

Hindi understanding, live-model, hidden/sealed, independent peer, native storage/client, clean-machine, production, public-distribution and dedicated security qualifications remain outstanding. The security audit is blocked and unverified. Report this lane as bounded synthetic acceptance, with those remaining gates attached.
