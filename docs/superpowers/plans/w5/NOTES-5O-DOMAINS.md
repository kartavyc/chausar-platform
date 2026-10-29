# 5O domain checkpoint: tender grounding and exports

This is a bounded implementation checkpoint, not completion or a review pass for package 5O. The integrator owns registration, the public desk, model tools, the fake, owner UI, Hindi, the baseline, Today requests, privacy, exact approval and final package review. No external effect occurs in these domain functions.

## Owned implementation

- `platform/runtime/venture/playbooks/tender-desk/ground.ts`: `groundTenderAnswer(question, answer, documents)` and `aggregateTenderGaps(rows)`.
- `platform/runtime/venture/playbooks/tender-desk/export.ts`: `tenderExportPack`, `readIssuerTender` and `fillIssuerTender`.
- Tests: `platform/tests/venture-tender-ground.test.ts` and `venture-tender-export.test.ts`.
- Shared extraction: `delivery/judge/claim-check-core.ts` holds the existing pure lexical algorithm. `claim-check.ts` retains source adapters and reexports the core. `delivery/quote.ts` holds the existing pure quote helper; `delivery/shared.ts` reexports it. No second claim-checking algorithm was introduced.
- Independent review tests for root-owned question/state/source code: `platform/tests/venture-tender-domain-review.test.ts`. These tests are separately identified from the implementation tests.

TD1 uses the existing A5 DOCX/XLSX/ZIP/XML implementation and the existing CSV cell guard. Countersign workflow ideas informed the design; no AGPL source code was copied. The TD3 algorithm is Chausar's existing lexical checker extracted without changing its emitted JavaScript. `results/o-claim-core-equivalence.txt` records an emitted-JavaScript comparison against HEAD, and `o-claim-core-equivalence.cjs` is its reproducible comparison script. Type assertions added to guarded matches erase at runtime.

## Grounding contract

`groundTenderAnswer` returns `passed`, `gap`, `affirmativeGap`, `missingTerms`, `coverage: {matched, total}`, claim matches and source IDs. It checks answer claims only against the supplied document bucket, never the RFP question itself. Specific question claims and remaining non-stopword question terms determine retrieval coverage. Unsupported answer claims join the missing terms. Canonical standard identifiers deduplicate alternative suffixes such as certification and certified.

Any missing evidence remains a failed gap, including an honestly worded pending answer. English Yes and Hindi हाँ/हां openings are flagged after simple opening markup is stripped. The caller must show a gap and prevent a successful affirmative answer. Owner-written commercial answers belong to the separate owner-only path and must remain visibly owner-set after reclassification.

The function bounds question and answer text, each document, document count and aggregate text. `aggregateTenderGaps` returns deterministic question IDs and terms ranked by affected-answer count, counting a term once per answer. It does not create a Today record itself. The integrator must create one aggregated owner request from that result.

## Export contract

`tenderExportPack({title, coverLines, rows})` returns DOCX bytes, XLSX bytes and CSV text. Rows carry `id`, `kind`, `question`, `answer`. The DOCX contains the cover and answer sections; the XLSX and CSV contain the compliance matrix. Spreadsheet formula-like answers remain text, including CSV formula guarding.

An issuer workbook requires an exact map `{sheet, questionColumn, answerColumn, firstRow, lastRow}`. Columns use uppercase letters, question and answer columns differ, and at most 500 rows are mapped. `readIssuerTender(bytes, map)` returns questions with stable row and question/answer cell references. `fillIssuerTender(bytes, map, [{row, answer}])` returns new bytes without saving them.

Only mapped answer cells change. Untargeted ZIP entry payloads, other sheet XML, formulas and untargeted cells remain unchanged. The ZIP container is repacked, so whole-file ZIP byte identity is not claimed. Existing answer-cell style attributes survive. Answers use inline text, including a leading equals sign. Formula targets, array-formula ranges, merged target regions, protected sheets, duplicate parts and unsupported archive/XML profiles are refused for manual filling. Directory-entry ZIP profiles are refused because the A5 unzip reader omits those records and could otherwise silently drop an untargeted entry.

New refusal codes for integrator registration and localization: `TENDER_COLUMN_MAP_REQUIRED`, `TENDER_WORKBOOK_PROTECTED`, `TENDER_EXPORT_INVALID`. Grounding uses `TENDER_INPUT_INVALID` and `TENDER_SOURCE_REQUIRED`. Existing OOXML unreadable refusals remain possible. Export functions deliberately have no vault, approval or source-version authority; public callers must validate current reviewed rows and source binding immediately before making a saved export available.

## Test-first evidence

- `results/o-domains-red.txt`: missing ground/export modules before implementation.
- `results/o-ground-first.txt`: initial grounding plus existing claim checker, 14/14 pass.
- `results/o-export-first.txt`: initial issuer style test found a real greedy cell-tag regex defect; `o-export-green.txt` records the repaired 5/5.
- `results/o-domains-edge-red.txt`: four real failures for malformed rows/answers, empty document text and duplicate standard terms. `o-domains-edge-green.txt` records 16/16 after repairs.
- Added array-formula and sheet-protection assertions exercise already implemented refusal behavior; no false claim that these separately failed first.
- `results/o-domains-nearby-host.txt`: 61/61 domain, existing claim, receipt and OOXML tests pass with normal C-drive temporary storage. A prior restricted run failed two existing atomic-save cases due local filesystem permissions; the host retry passed without weakening the tests.
- `results/o-core-types-final.txt`: strict browser-only grounding/core typecheck exits 0, using `results/o-core-tsconfig.json`.
- Full engine snapshot `o-domain-types-final.txt` contained only concurrent ad integration, posting-risk and support-hour fixture errors outside this scope. Full UI snapshot `o-domain-ui-types-final.txt` contained concurrent newsletter and podcast article errors outside this scope. These snapshots are not claimed as final wave gates.

No UI files changed in this bounded increment, so there are no domain screenshots or Hindi UI claims. Final package screenshots, real/fake public-path tests, source-executed baseline and broad gates remain required.

## Independent root-domain review checkpoint

Reviewed `questions.ts`, `state.ts`, `records.ts`, `sources.ts` and their tests. Review regressions cover owner-only hourly/unit rates after reclassification; rejecting an RFP used as its own evidence; copied RFP bytes under another upload ID; aggregate document bounds; and a client change during an awaited PDF read. The initial three-failure and extended five-failure evidence is in `o-domain-independent-red.txt` and `o-domain-independent-extended-red.txt`.

The root's repairs passed the independent 13-test question/state/source/reviewer run in `o-domain-independent-green.txt`. Source selection is now a pure type in `records.ts`; full order and file snapshots are checked after awaited source reads. This closes the original five findings, subject to the following remaining duplicate-byte extension discovered before final signoff.

`o-domain-base64-red.txt` records the final duplicate-byte extension: accepted alternative base64 padding encoded identical issuer workbook bytes while bypassing encoded-string comparison. The public upload handler stores the accepted spelling unchanged, and full-sheet extraction differs from mapped RFP text. Root repaired this by comparing decoded bytes, and unified the source loader mapping refusal with `TENDER_COLUMN_MAP_REQUIRED`. The fresh independent question/state/source/reviewer run passed 14/14 in `results/o-domain-independent-final.txt`, including the alternative-base64 regression.

Bounded review verdict for root-owned `questions.ts`, `state.ts`, `records.ts` and `sources.ts`: **STAGE 1: PASS. STAGE 2: PASS.** The five original findings and final duplicate-byte extension are closed. This verdict does not include root's newly added public desk or certify the agent-authored ground/export implementation; those require their own separate review. No screens were in this domain-only review.

All statements above are scoped to these domain functions. They do not certify a registered working tender playbook or the unfinished public approval/export flow.

## Independent public boundary increment review

Reviewed the subsequent root-owned `desk.ts`, `ai.ts`, `ai-core.ts`, state/record additions, owner-commercial grounding, `privacy.ts` and `rows.ts`. This bounded review is **STAGE 1: PASS. STAGE 2: PASS** after the issuer-cell repair. Whole-package registration, model tools, fake/UI parity, baseline and screens remain outside this verdict.

One blocker was reproduced in `results/w5-o-boundary-review-red.txt`: mapped XLSX import split a cell on newlines and retained only the first question, losing a later pricing qualifier and its owner-only protection. Root added `tenderQuestionFromCell` to retain the whole bounded cell with its actual cell reference and classify the complete text. The independent public regression now passes and confirms that AI cannot draft that retained pricing question.

`platform/tests/venture-tender-boundary-review.test.ts` also verifies concurrent confirms dispatch only once, changed source bytes during model completion cannot save an answer, and a privacy change during preview creation expires and erases the unlinked preview payload. These additional adversarial checks already passed current code and are not claimed as previously failing product defects.

The root's reimport privacy regression was inspected and independently rerun: the replacement ledger retains old opaque model-call links, superseded previews are expired/redacted, and subsequent owner Forget erases source payloads while preserving spend. The combined independent boundary, desk, AI, Today, state, source-review and grounding run passed **27/27** in `results/w5-o-boundary-independent-final.txt`.

## Independent ground and export review

Root separately reviewed the agent-authored ground/export implementation and pure claim-check extraction. The extraction preserves the existing claim and receipt algorithm; source adapters remain in the server facade. Explicit issuer mapping, bounds, formula and merged-cell refusal, preservation of unrelated entry payloads and literal answer cells are covered. Fresh root-run grounding/export tests passed 18/18 in `results/w5-o-domain-root-review-green.log`. Two added independent tests cover reversed answer order, Hindi/XML-sensitive text, formula-looking text, exact untouched archive parts and refusal to treat an RFP question as proof of its own claims. Bounded verdict: STAGE 1 PASS, STAGE 2 PASS. The lexical check does not establish the truth of supplied documents or catch every paraphrased false claim; the later judge and owner review remain required.
