# 5O owner desk and rehearsal checkpoint

The tender desk is real (`TenderDeskDesk.ready = true`). It selects a current client order, attaches source files through the existing file API, explicitly maps an issuer workbook, imports the full question ledger, edits answers and reassigns types, applies length/tone controls, previews each exact configured-model request, approves saved answers by type, and prepares genuine Word/Excel/CSV files plus issuer filling and money receipts. Commercial answers remain owner-written. Private documents remain manual until a qualified local model is available. Downloads do not claim the device saved a file; portal submission is an owner handoff.

## Ownership

- UI: `TenderDeskDesk.tsx`, `TenderSources.tsx`, `TenderQuestions.tsx`, `TenderDesk.module.css` under `app/ui/src/places/work/desks/`.
- Rehearsal: `app/ui/src/engine/fake-tender-desk.ts`, `fake-tender-files.ts`.
- Copy: `app/ui/src/text/en/pb-tender.json`, Hindi counterpart and only their machine-review keys in `hi-review.json`.
- Native/browser shared extractions: tender `sources-core.ts` with native `sources.ts` facade; `export-core.ts` with `export.ts` facade; browser-safe `TenderPreview` in `records.ts`. The current-byte/client/source limits, issuer XML checks and approval transitions remain shared.
- Office transport: kit `read-parts.ts`, `docx-parts.ts`, `zip-core.ts`, `browser.ts`; native `read.ts`, `docx.ts`, `zip.ts` facades use these. Existing dependencies were checked; none supplied a suitable bounded browser reader. Native `DecompressionStream` uses bounded chunks, followed by the same output-length and CRC checks. Stored browser exports preserve binary parts, not just text XML.
- CSV: exact existing `csvCell` moved to `money/csv-cell.ts`, reexported from `money/export.ts` to avoid loading the server graph in browsers.
- Narrow fake host edits: `eraseTenderIntake` declaration in `fake-w4.ts`, delegate in `fake.ts`, and source-intake removal in `fake-work.ts`. Root owns the separate optional tender Today interface and queue transport wiring in the same shared files.
- Tests: `venture-tender-browser-ooxml.test.ts`, narrow Json annotation in `venture-tender-boundary-review.test.ts`; UI `engine/fake-tender-desk.test.ts`, `places/tender-desk.test.tsx`.

## Evidence and review repairs

- First missing browser adapter RED: `w5-o-browser-ooxml-red.txt`; native/browser/export green 29/29 in `w5-o-browser-ooxml-green-host.txt`. Root independently added bounded-inflation and byte-offset checks and passed 31/31 (`w5-o-office-root-review.log`), scoped spec PASS / quality PASS.
- Shared source-policy extraction retained all 11 source/domain/async-boundary tests (`w5-o-source-core-green.txt`).
- Original fake stub RED5 in `w5-o-fake-red.txt`; source-bound flow, commercial author protection, AI exact single-use preview, private-source refusal and issuer multiline import initially green5.
- Money receipt omission RED then fixed with the shared code receipt helper: `w5-o-fake-money-red.txt`.
- Owner UI original-stub rejection is `w5-o-ui-stub-red.txt` (2 failed with Not built yet). Earlier restricted test-cache ENOENT runs are not counted as product RED evidence.
- Reviewer source hydration and source-dirty findings: existing source form now waits for current bid detail, uses its stable source version, and keeps old approvals/downloads locked while file/map selection differs. `w5-o-source-dirty-red2.txt` captures the blank hydration defect; the separate lock mutant log verifies removal of dirty propagation is caught.
- Saved-answer acknowledgements clear only the acknowledged local buffer, preserving other dirty answers. The source version, rather than each save digest, determines the ledger remount boundary.
- Explicit Forget clears imported and pre-import client-linked tender files, copied delivery/report authority and order source intake. A null blueprint in an unrelated workspace no longer throws. RED/GREEN logs: `w5-o-fake-intake-*`, `w5-o-fake-queue-forget-*`, `w5-o-fake-null-blueprint-*`.
- Live Today notices aggregate missing terms once per bid, read actual current files, and support an explicit workspace snapshot without switching active workspaces. Mutation and Forget emit `queue.changed`; `w5-o-fake-queue-mutants-red.txt` rejects removal of both the event and scope behavior. Root owns public queue conversion/integration.
- Focused UI/rehearsal/text/source green51 in `w5-o-review-ui-green.txt`; later fake null-plan green9 in `w5-o-fake-null-blueprint-green.txt`. Final combined evidence is being rerun after the last queue and model tests.
- Nearby UI/text/source/a11y/budgets completed 245/246 in `w5-o-ui-nearby-final.txt`. The sole failure is the existing onboarding word count, 661 against 330; no baseline was raised here. Screenshot axe checks also report zero violations.

## Screens and honest limits

`results/w5-o-shots/` contains actual public-FakeEngine onboarding/source/answer/approval screens: `desk-en-1280.png`, `receipt-en-1280.png`, `desk-en-390.png`, `receipt-en-390.png`, `desk-hi-390.png`, `receipt-hi-390.png`. The first receipt capture found a long source hash overflow; the owned CSS now wraps it. Final settled `report.json` records exact viewport/scroll widths of 1280 or 390, and no axe violations. The short opening animation is allowed to finish before width measurement. The temporary screenshot server and Chrome stop in finally.

PDF extraction uses the real desktop helper only; the browser rehearsal has no helper and returns the same helper-unavailable or hosted refusal, with the manual text/spreadsheet route. Rehearsal model output is synthetic and performs no provider call. Lexical grounding proves only matches in the supplied client evidence, not the truth of the client's claim. Hindi is machine-drafted and listed for native review. The React review checklist was applied: separate stateful concerns, direct leaf imports, scoped async reads, dirty-edit preservation, labelled controls and phone-width checks.

Full package review is pending the independent reviewer and root's queue/engine extensions. Root owns broad gates, commits, release notes and the wave PR. No Git state was changed by this implementer.
## Final closure

Independent full-package reviewer `seller_f2`: **STAGE 1 PASS / STAGE 2 PASS**. Root independently reviewed the owner UI and shared Office extraction with the same verdict. Reviewer evidence: combined 58/58 and public queue 2/2; root UI typecheck exit 0 is `results/w5-o-typecheck-ui-final.log`.

Author final focused checks pass 57/57 in `results/w5-o-ui-owned-final.txt` (owner desk 4, fake 11, text 22, source rules 20). Isolated accessibility passes 165/165 in `results/w5-o-a11y-isolated.txt`. The source-lock mutant preserves hydration but removes dirty propagation and fails the intended approval lock assertion (`w5-o-source-lock-mutant-red.txt`); current code is restored. Queue event and workspace-scope mutants likewise fail their two intended cases.

Two extra actual-browser captures exercised native browser decompression of a deflated issuer XLSX with explicit column mapping, then the configured-model exact preview in Hindi: `results/w5-o-shots/issuer-ai-desk-hi-390.png` and `issuer-ai-receipt-hi-390.png`. Both measure 390/390 with axe 0 (`issuer-ai-report.json`). The AI request/cost label and quote payload stay one review step away, and no provider is called by the rehearsal. All temporary harness files were removed and both screenshot browser/server instances stopped. This closes the owned 5O UI/fake work; broad batch gates remain the integrator's responsibility.
