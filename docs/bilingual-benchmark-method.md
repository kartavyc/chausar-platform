# Hindi and English synthetic benchmark: method v1

This open, authored fixture checks deterministic calculations, saved receipts and refusals through the existing public Engine API. It implements the bounded source benchmark portion of `LIVE-D10-B13` / `GAP-ONT-35`. A passing run qualifies this fixture contract only. It does not establish model quality, Hindi understanding, production readiness or a text-to-SQL comparison.

## Questions and two tracks

`fixtures/bilingual-benchmark/v1/questions.json` contains 40 cases, each with an English question, a Hindi question, an explicit request, literal answer/refusal expectations and worked explanations in both languages. The 80 observations are split as follows:

| Track, per language | Expected answers | Expected refusals |
| --- | ---: | ---: |
| Authored typed requests, English | 17 | 14 |
| Authored typed requests, Hindi | 17 | 14 |
| Actual local question parser, English | 6 | 3 |
| Actual local question parser, Hindi | 6 | 3 |

The typed track sends the same author-selected `calculation.run` request for each language; one case uses `receipts.get`. Its questions label the intended business meaning. No model interprets them, and the two language observations are dependent repetitions. The parser track submits each original question to `conversation.ask` without a model route. A reviewed bilingual alias pack recognizes exact, bounded phrase frames for six operations whose definitions and parameter contract still match the published starter pack. It consumes the complete question; it does not extract keywords or guess filters. The three questions about ambiguous sales, accounting profit and causation still refuse in both languages. This qualifies the included literal phrases only, not general Hindi understanding or model quality. The original pre-repair nine-Hindi-refusal result is retained in the dated source-check handoff.

## Evidence and scoring

The hand-authored CSV files contain a 12-row shop and one large exact-money event. Controls are 885500 paise across the shop's 12 imported rows and 9007199254740993 paise for the large event. These are source control sums, not revenue. The runner imports through the public API, verifies reconciliation and duplicate-import idempotency, then uses disposable synthetic workspaces with current owner/viewer/source permissions.

An answer must match exact integer minor units, the complete figure set, contributing entity identities and coverage. Applicable cases also require exclusions, assumptions and limitations. The runner reads each receipt back through `receipts.get`, compares its current dictionary/version/definitions, and checks row linkage, invoice/customer/order identifiers, due dates, statuses and the exact contributing-source summary. Period, comparison period, branch, counted-row consistency and non-stale status must also match. Refusals must match their exact error code or unsupported-question object and must not retain a completed calculation.

`right`, `wrong` and `refused` are disjoint observed outcomes. Every observed refusal counts as `refused`, including an unexpected or incorrectly coded refusal. Separate `correct`, `incorrect`, `matchedRefusals` and `unexpectedRefusals` fields determine whether expectations matched. Scores are reported per language and per track; zero incorrect observations is the pass condition.

## Reproduce and limits

With the repository's existing Node runtime (24.13.1 or newer), from this source copy run:

```sh
node scripts/bilingual-benchmark.mjs --output results/bilingual-benchmark.json
```

Choose an unused relative JSON destination: the runner refuses overwriting. The source copy and report destination may be on another drive. Disposable scratch workspaces use a unique directory under the existing canonical system temporary parent; on Windows this parent must resolve on C before any scratch directory is created. The CLI validates and removes its owned scratch directory after success or failure. The report hashes UTF-8 question/CSV/method text with CRLF normalized to LF, plus stable dictionary semantics. This preserves fingerprints across Git line-ending settings. Its semantic run digest excludes generated identities, absolute scratch paths and wall-clock creation/publication/as-of timestamps; raw execution timestamps remain disclosed.

Provider transports fail closed and the runner checks zero dispatches and zero model receipts. Hidden/sealed datasets and the attack pack are excluded. This run uses experimental file storage; native storage, GUI, clean-machine and public-release-candidate proof are not run. Public distribution, independent qualification and the blocked security audit remain separate gates. `GAP-ONT-30` measure interchange is pending a pinned, reviewed schema and is not exercised here.
