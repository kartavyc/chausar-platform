# Plan: Chausar Ink v2, wave 2 (wire the built-but-unreachable code)

## Goal

Every piece the build audit lists as "built but not wired" gets a real caller (a run, an engine method or a screen) and a test that goes through that caller. The catalogue's fifteen W2 rows (Q1, Q2, O19, M16, K1, K2, K3, K4, K5, K12, P1, Y1, Y17, CA1, S1) are built. Nothing new is invented here that the spec puts in W3 to W5; where a W2 row reaches into a later wave, this plan says where the line is.

Inputs: the spec `docs/superpowers/designs/2026-10-23-chausar-ink-v2.md` (sections 5.4 to 5.8, 6, 7), the master plan `docs/superpowers/plans/2026-10-23-chausar-ink-v2.md` ("How every wave runs", wave 2 outline), the audit `docs/research/harvest/build-audit-2026-10-23.md` ("Built but not wired", the safety list) and the catalogue `docs/research/harvest/cards2/CATALOGUE.md`.

Paths below are relative to `platform/runtime/venture/` unless they start with `app/`, `platform/` or `docs/`.

## Before the wave starts

- Branch `b2c/ink-v2-w2` from `b2c/ink-v2-w1` once the wave 1 integrator has committed every W1 package. Wave 2 builds on W1's results and must not start on a tree where W1 agents are still editing. In particular: 1A (rate tables FY 2026-27 and AY 2027-28, `tax-figure-receipted`), 1B (`venture.journal.resolve`, `descriptionComplete`), 1C (run spend reserve, `reserveRunCall`), 1D (posting by draft id with `POST_DRAFT_UNCHECKED`, `POST_CLIENT_NOT_APPROVED`, `POST_DRAFT_CHANGED`; the held-action page model in `build/browser.ts`), 1E (`policy/untrusted.ts`, `policy/taint.ts`, `policy/effects.ts`, the fixed effect list `read`, `private-read`, `write`, `send`, `egress`, `money`), 1F (`core/net-guard.ts`, `core/secrets.ts`).
- Re-read each file named in a package before editing it: W1 changed many of them (`delivery/runs.ts`, `playbooks/draft-checks.ts`, `build/posting.ts`, `build/bank.ts`, `journal/journal.ts`, `contracts.ts`, `views/queue.ts`, `app/ui/src/parts/ApprovalRow.tsx`).
- Everything in "How every wave runs" (master plan) holds: test first, packages in one checkout, no worktrees, agents never commit, stash, switch branches or run the full suite; shared files only by small Edit calls; every new string in `app/ui/src/text/en/*.json` and `hi/*.json`; no em dashes.

## Coverage: every audit item and W2 row, its package and the test through its real caller

| Audit item or row | Package | Real caller the test goes through |
|---|---|---|
| Audit safety 2 / CA1: tax engines unreachable (income tax, interest, TDS, GST working) | 2A1 | `venture.delivery.run` then `venture.delivery.approve` turns on a CA order; the tool call, its stored receipt and the draft's checks |
| CA1: AIS/26AS reconcile, portal diff; "stored CA receipts" (audit, finance) | 2A2 | the same run path, plus `venture.ca.receipt` and `venture.ca.explainDiff` |
| Posting: no method proposes a post (K1) | 2B1 | `venture.posting.propose`, then `venture.queue.decide` on the connector row |
| Posting: nothing opens the sign-in window (K1) | 2B1 | `venture.posting.signIn`; Connections screen button |
| Posting: on desktop the owner can't record a client's answer (O19) | 2B1 | `venture.share.recordAnswer`; Work screen control |
| K5 pre-post risk gate, the send governor | 2B1 | `venture.posting.propose` and the decide recheck |
| Audit safety 8: browser steps have one selector each and `checkedOn: null` (K2) | 2B2 | `venture.posting.checkSteps`, then `venture.queue.decide` posting through the fake page |
| K3 confirm by the platform's response, K4 script and read-back guard | 2B2 | the post decide path and `venture.posting.checkSteps` with a fake page |
| Judges: rules judge never runs on real orders (Q1) | 2C1 | `venture.delivery.judge` and `venture.delivery.judgeSend` on a ready draft |
| Judges: standard practice clients never get the rules judge (Q1) | 2C1 | `venture.simulation.run` |
| Ink has no control that starts a rehearsal or improvement run; no rollback (Q2) | 2C1 (engine), 2C2 (screen) | `venture.improve.rollback`; Business > Practice screen; Work > "Ask the judge" |
| Bank: imported statements feed nothing (M16) | 2D | `venture.bank.import`, `venture.bank.apply`, then `venture.books.summary` |
| Bank: consent code has no screen | 2D | Connections > Bank account sheet calling `venture.bank.consent` |
| Bank: alert code has no screen and no delivery | 2D | `venture.bank.alerts.set`, then `venture.bank.import`, then `venture.queue.list` |
| YouTube: hook ranking, EDL build, chapter drafting, Studio retention reader (Y1) | 2E1 | YouTube order runs through `venture.delivery.approve` |
| Y17 connector fact (uploads default to private, altered or synthetic flag) | 2E1 | `venture.connectors.list` |
| K12 local transcription through the speech service (Y1 "call the speech service") | 2E2 | `venture.files.transcribe`, then a YouTube run reads the transcript |
| Social: calendar slots, thread splits, report figures from exports, narrative receipt check, client lists (S1) | 2F1 | social order runs through `venture.delivery.approve` |
| Social: draft-before-schedule gate, calendar export (S1) | 2F2 (export), 2B1 (gate in posting) | `venture.social.calendar`; `venture.posting.propose` |
| Evidence ledger: no agent tool records facts | 2G | `evidence.record` tool in a run, then `venture.queue.list` and `venture.evidence.apply` |
| Social and YouTube rule freshness (S1, Y1), P1 dated rules into runs | 2H | `venture.rules.list`; a run with the clock past the recheck window |
| Bank polling (`pollAllowed`, `recordPoll`, `requireActiveConsent`) | not placed | see "Not placed" at the end |

## Shared files and sequencing

Most collisions are removed by package 2-0, which the integrator does first. After it, the files below are still touched by more than one package; each package changes only its own function or its own key prefix, with small Edit calls, re-reading first.

| File | Packages | How they share it |
|---|---|---|
| `contracts.ts`, `platform/runtime/engine.ts`, `app/desktop/ipc-contract.cjs` and `.d.cts`, `app/ui/src/engine/types.ts`, `views/runs.ts` (`TOOL_PURPOSE`), `delivery/harness/patches.ts` (`toolCeiling`), `delivery/harness/tools.ts` (the seam), `delivery/harness/env.ts` | 2-0 only | Packages add only what 2-0 missed, one small edit each |
| `playbooks/draft-checks.ts` | 2A1, 2A2, 2E1, 2F1, 2H | Each edits only its own function: `caChecks` (2A1 then 2A2), `youtubeChecks` (2E1), `socialChecks` (2F1), a new `ruleFreshnessResult` call in `playbookOwnChecks` (2H). 2A2 waits for 2A1 |
| `playbooks/ca-firm/playbook.ts` | 2A1, 2A2 | 2A1 changes the `compute` step; 2A2 then adds tools to `reconcile` and `portal-diff`. Sequence 2A1 first |
| `delivery/runs.ts` | 2G, 2E1, 2C1 | 2G stores pending evidence in `approveHarnessTurn`; 2E1 passes the run's screened hooks and chapters tables to the write step as `worked` (integrator approved, 23 Oct); 2C1 starts the automatic judge. Small edits each |
| `delivery/harness/tools.ts` `callTool` | 2G | Only 2G after 2-0 (collects `evidence`) |
| `build/posting.ts` | 2B1, 2B2 | 2B1 adds the method and gate calls; 2B2 touches only `runPost`'s result (post URL). Sequence 2B1 first |
| `build/browser.ts` | 2B2 | Only 2B2 |
| `build/index.ts` (handler table) | 2B1, 2B2, 2D, 2F2 | One line each |
| `delivery/index.ts` | 2C1, 2E2 | One line each |
| `views/index.ts` | 2A2, 2H | One line each |
| `views/queue.ts` | 2-0, 2D | 2-0 adds the `bank` entry to `RANK`; then only 2D (bank rows and their decide) |
| `playbooks/social/register.ts` | 2H, 2B1 | 2H adds `usedBy` and `limitations` to every rule and makes them required; 2B1's new house rules live in a new file and carry both fields. 2B1 merges its rules into the register with one line after 2H lands |
| `playbooks/youtube/playbook.ts` | 2E1, 2E2 | 2E1 changes step tools and the connector text; 2E2 changes only the `transcription` connector entry. Sequence 2E1 first |
| `app/ui/src/places/connections/index.tsx` | 2B1, 2D | One render line each; their UI lives in new files (`Posting.tsx`, `BankSheet.tsx`). 2B2 renders `StepsCheck.tsx` from inside 2B1's `Posting.tsx`, after 2B1 |
| `app/ui/src/places/work/OrderFocus.tsx` | 2B1, 2C2, 2E2, 2F2 | One render line each for their own component files |
| `app/ui/src/places/business/index.tsx`, `PlanView.tsx` | 2C2 (new `practice` page), 2H (one line rendering `RulesSection`) | One edit each |
| `app/ui/src/engine/fake.ts` | 2-0 only | 2-0 registers one empty fake desk per UI package; each package fills its own desk file |
| `app/ui/src/text/{en,hi}/work.json`, `business.json`, `connections.json`, `today.json` | several | Each package uses its own key prefix (`work.post.*`, `work.judge.*`, `work.calendar.*`, `work.transcribe.*`, `business.practice.*`, `business.rules.*`, `connections.posting.*`, `connections.steps.*`, `connections.bankSheet.*`, `today.posting.*`) |

Order of work:

1. 2-0 (integrator, alone).
2. In parallel: 2A1, 2B1, 2C1, 2D, 2E1, 2F1, 2G, 2H.
3. When their first package is in: 2A2 (after 2A1), 2B2 (after 2B1), 2C2 (after 2C1), 2E2 (after 2E1), 2F2 (after 2B1 and 2F1).
4. Integrator: typecheck, UI suite, bench shards, commits, PR.

## Package 2-0 (integrator, before agents start): shared names and seams

Size S. Mechanical; no behaviour, so no failing test of its own beyond the existing suite staying green.

1. `contracts.ts`:
   - `TOOL_NAMES` gains `tax.income`, `tax.interest`, `tax.gst`, `tax.tds`, `tax.statements`, `tax.portal`, `youtube.hooks`, `youtube.editList`, `youtube.chapters`, `youtube.retention`, `social.report`, `evidence.record`.
   - `VENTURE_METHODS`, `METHOD_OWNERS`, `VenturePayloads`, `VentureResults` gain: `venture.delivery.judge` {runId} (delivery), `venture.delivery.judgeSend` {runId, digest} (delivery), `venture.improve.rollback` {playbookId, digest} (delivery), `venture.files.transcribe` {orderId} (delivery), `venture.posting.propose` {draftId, account?} (build), `venture.posting.signIn` {connectorId} (build), `venture.posting.checkSteps` {connectorId} (build), `venture.share.recordAnswer` {draftId, answer, comment?} (build), `venture.social.calendar` {runId} (build), `venture.bank.ledger` {account?, month?} (build), `venture.bank.apply` {transactionId, as, invoiceId?} (build), `venture.bank.alerts.get` {} (build), `venture.bank.alerts.set` {account, rules, alertAddress?} (build), `venture.ca.receipt` {id} (views), `venture.ca.explainDiff` {receiptId, key, note, membershipNo} (views), `venture.rules.list` {} (views). Result types as each package below states.
   - `APP_ONLY_METHODS` gains `venture.delivery.judgeSend`, `venture.improve.rollback`, `venture.files.transcribe`, `venture.posting.signIn`, `venture.posting.checkSteps`, `venture.share.recordAnswer`, `venture.bank.apply`, `venture.bank.alerts.set`, `venture.ca.explainDiff`.
   - Spec section 6 names `venture.simulation.start` and `venture.improve.start`. The engine already has `venture.simulation.run` and `venture.improve.run`, which do exactly that; Ink uses those. No second name is added.
   - `QueueKind` gains `'bank'` (and its `RANK` in `views/queue.ts`, 3).
   - `WorkReceiptRecord.operation` gains `'ca.engine' | 'social.report'`; the record gains optional `ca?: { engine: CaEngine; inputs: Json; inputsDigest: string; caReceiptId: string; table: TableStamp | null; tables: TableStamp[]; sections: SectionRef[]; assumptions: string[]; openQuestions: string[]; working: Json }` and `report?: { platform; month; key; formula; inputs; unit }[]`. `WorkFigure.unit` gains `'percent' | 'post'` (minor holds hundredths for a percent, `'0'` for a post id, whose display is the id).
   - `WorkTableRecord.source` gains `{ kind: 'computed'; tool: ToolName; uploadIds: string[] }`.
   - `OrderIntake` gains optional `calendar?: { month: string; channels: SocialChannel[]; postsPerChannel: number; weekdays: number[] }` and `clientRules?: { bannedWords: string[]; bannedTopics: string[]; competitors: string[]; protectedPhrases: string[] }`.
   - `UploadRecord` gains optional `origin?: 'client' | 'local-transcription'` (absent means client).
   - `PaymentRecord` gains optional `bankTransactionId?: string`. `BankAccountRecord` gains optional `rules?: BankAlertRule[]`, `alertAddress?: { url; setBy; setAt } | null`.
   - `DeliveryRunRecord` gains optional `judge?: { status: 'waiting' | 'done' | 'failed'; callId: string | null; preview: ModelPreview | null; at: IsoTime }`.
   - New record kind `'venture-posting-steps'` (per connector: candidate keys with their own `checkedOn`, owner-added candidates) and `'venture-bank-match'` (one per bank transaction the owner decided: `{ transactionId, accountId, as: 'payment' | 'cost' | 'skip', invoiceId, paymentId, factId }`).
2. `delivery/harness/tools.ts`: export `Spec`, `Field`, `ToolResult`, `text`, `fail`, `fileOf`, `tableOf`, `receiptOut`, `rowsOut`, `base` and a new `computedTable(env, name, columns, rows, tool, uploadIds)` helper. `TOOLS` becomes `{ ...CORE_TOOLS, ...CA_TOOLS, ...CA_CHECK_TOOLS, ...YOUTUBE_TOOLS, ...SOCIAL_TOOLS, ...EVIDENCE_TOOLS }` imported from new files `delivery/harness/tools-ca.ts`, `tools-ca-checks.ts`, `tools-youtube.ts`, `tools-social.ts`, `tools-evidence.ts`. Each new file starts with one stub spec per name that returns `{ ok: false, error: { code: 'NOT_BUILT_YET' } }` so typecheck stays green; its package replaces the stubs.
3. `delivery/harness/patches.ts`: `toolCeiling(type, flagship = null)` with a `FLAGSHIP_TOOLS` map: `ca-firm` gets the six `tax.*`, `youtube` the four `youtube.*`, `social-agency` gets `social.report`; every flagship and service type gets `evidence.record`. `applyPatch`'s context gains `flagship`; `buildBody` in `delivery/playbook.ts` passes `deliveryFlagship(venture, blueprint)`.
4. `views/runs.ts` `TOOL_PURPOSE` and `TOOL_KIND`: one owner-words line per new tool ("Worked out income tax with the calculator", "Scored the hooks", "Built the edit list", "Drafted chapters from the pauses", "Read the retention export", "Worked out the report figures from the exports", "Noted where a client fact came from", and so on).
5. `delivery/harness/env.ts`: `ToolEnv` and `EnvInput` gain `intake: OrderIntake | null` and `rateUse: RateUse` (`rateUseFor(state, venture.id, 'client')` for a delivery run, `REHEARSAL` otherwise, from `playbooks/ca-firm/signoff.ts` and `rates.ts`). `delivery/runs.ts` passes `context.order.intake ?? null`; `delivery/simulate.ts` passes `null`.
6. `playbooks/draft-checks.ts`: `FlagshipCheckInput` gains `tables?: readonly WorkTableRecord[]` and `toolCalls?: readonly ToolCallRecord[]`; `runs.ts` `flagshipChecks` passes `made.tables` and `harness.toolCalls`; `simulate.ts` `practicePlaybookChecks` passes the episode's tables and tool calls.
7. `platform/runtime/engine.ts` case lines for every new method; `app/desktop/ipc-contract.cjs` and `.d.cts`; `app/ui/src/engine/types.ts` method map entries; `app/ui/src/engine/fake.ts` registers empty desks from new files `fake-posting.ts` (2B1, 2B2), `fake-practice.ts` (2C2), `fake-bank.ts` (2D), `fake-wiring.ts` (2E2, 2F2, 2H).
8. Run `npm run typecheck` and the existing contract tests (`platform/tests/venture-contracts.test.ts`, `desktop-ipc-methods.test.ts`, `app/ui/tests/engine/ipc-allowlist.test.ts`); they must pass before agents start.

---

## Package 2A1: CA tax engines as harness tools (CA1, audit safety item 2)

Size L (one agent). Rows: CA1 (income tax, interest, TDS, GST working), with H2's "the agent picks the rule, the calculator gives the number".

**Files:** `delivery/harness/tools-ca.ts` (replace the stubs for `tax.income`, `tax.interest`, `tax.gst`, `tax.tds`), new `playbooks/ca-firm/tool-inputs.ts` (builds engine inputs from tables and picked amounts), `playbooks/ca-firm/playbook.ts` (the `compute` step), `playbooks/draft-checks.ts` (`caChecks` only), `delivery/harness/practice.ts` (one practice sales register for the bookkeeping clean client); tests `platform/tests/venture-ca-tools.test.ts` (new).

**Failing tests first** (through `venture.delivery.run` and `venture.delivery.approve`, copying the scripted `Port` and `scriptTurns` pattern of `platform/tests/venture-harness-runs.test.ts` and the `business()` helper of `venture-playbook-wiring-delivery.test.ts`):

1. A CA firm business at approve each; order on offer `gst-working` with an uploaded `sales-register-october.csv` (columns Invoice, Date, GSTIN, State, HSN, Taxable, Rate; three rows: 10,000.00 at 18% intra-state, 5,000.00 at 12% inter-state, 2,500.00 at 5% intra-state). The scripted act turn calls `tax.gst {gstin: '27ABCDE1234F1Z5', period: '2026-10', outward: {table: 'f1', invoice: 'Invoice', date: 'Date', counterpartyGstin: 'GSTIN', placeOfSupply: 'State', hsnSac: 'HSN', taxable: 'Taxable', rate: 'Rate'}}`. Expect: the tool call succeeded; one `venture-work-receipt` with `operation: 'ca.engine'`, `ca.engine: 'gst-working'`, figures copied from `gstWorking`'s receipt in paise (for example the IGST on the 12% inter-state line, 600.00, under whatever key `gstWorking` gives it); the envelope lists figure refs `w1.<key>`; the write turn that quotes `w1.<key>` gives a ready draft whose `tax-figure-receipted` (W1 1A) and `figures-from-receipts` checks pass. The model never typed an amount: the tool input has no number field.
2. Same order, but the tables are not confirmed by the CA (no `venture.ca.confirmRates`): the tool answers `{ ok: false, error: { code: 'RATE_UNCONFIRMED', details: { retry: false } } }`, makes no receipt, and the next act task's history tells the agent "Do not retry: your CA has not confirmed this rate table." After `venture.ca.confirmRates` for that table the same call succeeds. In rehearsal (`venture.simulation.run` on a CA business) the tool works on unconfirmed tables and `rates-confirmed` reads "Rehearsal only".
3. `tax.income {assessmentYear: '2027-28', regime: 'new', residency: 'resident', ageBand: 'below-60', salary: {file: 'f2', amount: 'a3'}, deductions: [], alsoHas: ['capital-gains']}` on an order with a Form 16 PDF (`f2`, read first with `files.read` so `a3` exists): answers `NOT_MODELLED` with `details.retry: false` and the words of `computeIncomeTax`; the draft then fails `not-modelled-refused` unless an open item hands the capital gains to the CA (a line with "CA" in "Open items for you"). Without `alsoHas`, the call succeeds; with a picked salary just above the rebate limit the receipt carries `computeIncomeTax`'s 87A rebate step with its marginal relief.
4. A picked amount that does not exist (`amount: 'a9'` on a PDF with three amounts) fails with `TOOL_FAILED` "f2 has no amount a9. Read it again with files.read part pages." A table column that does not exist fails with `TOOL_FAILED` naming the columns.
5. `tax.interest {assessmentYear: '2027-28', taxFrom: 'w1', advanceTax: {table: 'f3', date: 'Date', amount: 'Amount'}, filedOn: '2027-09-10'}` takes the tax liability from the income tax receipt `w1` by key (refused with `TOOL_FAILED` when `w1` is not an income tax receipt) and returns the 234A, 234B and 234C figures with `computeInterest234`'s receipt.
6. `tax.tds {financialYear: '2026-27', payments: {table: 'f1', payeeName: 'Payee', pan: 'PAN', payeeKind: 'Kind', section: 'Section', date: 'Date', amount: 'Amount'}}` returns `tdsWorking`'s rows and challans; a section code outside `TdsSectionCode` is `NOT_MODELLED`. The name column is `payeeName`, never `payee`: a bare `payee` key reads as payment details to the policy and holds the call.
7. Hosted server (`deps.host = 'hosted-web'`): the four tools still run (they are code, no sandbox).
8. The CA playbook's `compute` step is now kind `work`, model `fast`, tools `['files.read', 'tax.income', 'tax.interest', 'tax.gst', 'tax.tds', 'handoff.owner']`, keeps its `caChecks` and gate; `validatePlaybook` accepts it; `playbookGrant` includes the four tools; a plain bookkeeping business (no flagship) is not granted them, and an improvement patch `tools.grant tax.gst` on it is refused by `applyPatch`.

**Implementation notes.**
- Each tool: read cells with `tableOf` and `parseMoneyCell`/`parseDateCell` (`delivery/harness/cells.ts`), or picked amounts the way `bills.pick` does (`pdfPages` then `amountCandidates(...)[n]`); build the engine input in `tool-inputs.ts`; call `gstWorking`, `computeIncomeTax`, `computeInterest234`, `tdsWorking` with `env.rateUse`; turn the `CaReceipt` into a work receipt with `receiptOut` (figures from `receipt.figures`, unit `money`, currency `INR`) and keep the whole receipt under `ca` (inputs included, so 2A2 can re-derive it).
- Errors: `ChausarError` codes `TAX_INPUT_INVALID`, `NOT_MODELLED`, `RATE_TABLE_MISSING`, `RATE_TABLE_STALE`, `RATE_UNCONFIRMED` become the envelope error with `details: { retry: false }`; the act task's tool-history line for a `retry: false` error starts "Do not retry:".
- Effects: declare each tool with 1E's list as `read` (it reads client files and computes; it writes and sends nothing). Proofs: `{ kind: 'totals', receiptId }`.
- `caChecks` in `draft-checks.ts`: read `tables` from `receipt.ca?.tables` (today it reads `raw.tables`), and add `not-modelled-refused` from `input.toolCalls` (any `tax.*` call whose envelope code is `NOT_MODELLED` needs an open item naming the CA).
- The literal input types `assessmentYear: '2026-27'` and `financialYear: '2025-26'` widen to the years 1A's tables cover; the version is still picked by date (`rateTableFor`).
- Add `sales-register-september.csv` to `PRACTICE_FILES['bookkeeping-clean']` so a CA rehearsal can call `tax.gst`.

**Done when:** `node --test platform/tests/venture-ca-tools.test.ts platform/tests/venture-playbook-ca-*.test.ts platform/tests/venture-playbook-wiring-delivery.test.ts platform/tests/venture-harness-runs.test.ts` shows `# fail 0`.

## Package 2A2: CA statements reconcile, portal diff, stored and re-derivable receipts (CA1, audit finance "stored CA receipts")

Size M. Starts after 2A1. AIS, 26AS and Form 16 file readers stay a non-goal (spec section 2): the tools read tables the agent maps column by column, never the official file formats.

**Files:** `delivery/harness/tools-ca-checks.ts` (`tax.statements`, `tax.portal`), new `playbooks/ca-firm/stored-receipt.ts`, `playbooks/ca-firm/methods.ts` (two handlers), `playbooks/ca-firm/signoff.ts` (a `diff-explanation` entry kind), `playbooks/ca-firm/playbook.ts` (tools on `reconcile` and `portal-diff`), `playbooks/draft-checks.ts` (`caChecks`: differences, `gaps-tie`, `portal-diff-explained`), `views/index.ts` (register two methods), `app/ui/src/places/business/YourCa.tsx` (receipts list with "Recomputed: same" or "differs"), `app/ui/src/text/{en,hi}/business.json`; tests `platform/tests/venture-ca-receipts.test.ts` (new), `app/ui/tests/places/business.test.tsx` (one case).

**Failing tests first:**

1. A CA order with `books.csv` and `ais.csv` (both tables with columns Source, Category, Payer, Gross, TDS). The act turn calls `tax.statements {entries: [{table: 'f1', source: 'books', ...columns}, {table: 'f2', source: 'ais', ...columns}]}`; the receipt holds `reconcileTaxStatements`'s differences (one `amount-differs` of 1,200.00 on interest). A draft whose open items leave that difference out fails `differences-listed` (the check now gets `differences` from the run's reconcile receipts); one that lists "1,200" passes. `gaps-tie` passes when every `Tie.ties` is true and fails naming the source otherwise.
2. `tax.portal {portal: {table: 'f3', key: 'Field', amount: 'Amount'}, ours: ['w1', 'w2']}` compares the portal's figures with the named receipts' figures by key (`diffAgainstPortal`); a key on both sides with different amounts is `differs`; the result is stored as a work receipt (`operation: 'ca.engine'`, engine `portal-diff`, figures per row). The draft's `portal-diff-explained` check fails while any row is not `same` and has no explanation, naming the keys.
3. `venture.ca.explainDiff {receiptId, key: 'tax-payable', note: 'Portal rounds differently; the CA accepts the portal figure.', membershipNo: '123456'}` (app only; the membership number must equal the CA of record's, else `CA_NOT_OF_RECORD`; an unknown key is `CA_DIFF_KEY_UNKNOWN`) records the explanation; re-running `venture.delivery.review` accept on the same draft then passes `portal-diff-explained` (`portalDiffReady`).
4. `venture.ca.receipt {id}` returns the stored CA receipt (figures, steps, tables, assumptions, open questions) and `rederived: 'same'`: it runs the engine again from `ca.inputs` with the stamped table versions and compares the `caReceiptId` digest. Change one stored figure in the vault (test store edit) and it answers `rederived: 'differs'` with the first differing key. An unknown id is `CA_RECEIPT_NOT_FOUND`. A table version that no longer exists answers `rederived: 'table-gone'`, never "same".
5. Ink: Business > Your CA lists the receipts of the latest regulated draft with "Recomputed: same" (or the differing line) from `venture.ca.receipt`.

**Implementation notes.** `reconcileTaxStatements`, `diffAgainstPortal`, `portalDiffReady` (`playbooks/ca-firm/reconcile.ts`, `portal.ts`); `rateTableFor`, `useRateTable`, `RATE_TABLES` (`rates.ts`) for re-deriving with exact versions (look the stamped `id` and `version` up in `RATE_TABLES`, never by date); `caOfRecord` and the entry helpers in `signoff.ts`. `tax.statements` and `tax.portal` are `read` effects. 2A2 adds `tax.statements` to the `reconcile` step and `tax.portal` to the `compute` step (the `portal-diff` step stays code; its gate holds).

**Done when:** `node --test platform/tests/venture-ca-receipts.test.ts platform/tests/venture-ca-tools.test.ts platform/tests/venture-playbook-ca-*.test.ts` and `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/business.test.tsx` are clean.

---

## Package 2B1: posting methods, the risk gate, the client's answer (K1, K5, O19, S1 draft-before-schedule gate)

Size L (one agent; it owns the most UI). Builds on 1D's `proposePost` by draft id and 1D's held-action page model.

**Draft ids.** A post is one channel line of a social delivery draft: `draftId = '<deliveryRunId>.post-<n>'`, the same numbering `socialChecks` uses (`post-1`, `post-2`, in text order). If 1D landed another shape, use 1D's and update this note.

**Files:** `build/posting.ts` (method handlers `postingPropose`, `postingSignIn`; risk gate before propose and again inside `decidePost` just before `applyAction`), new `playbooks/social/run-approvals.ts` (`draftApprovalsOfRun(state, runId)`: each post's `DraftApproval` from the run's checks, the owner's review verdict and the share link's client decisions), new `playbooks/social/risk-gate.ts`, new `playbooks/social/post-limits.ts` (house rules with the register's `PlatformRule` shape), `build/share-links.ts` (`shareRecordAnswer`), `build/index.ts` (register three methods), `app/ui/src/places/work/PostButtons.tsx` (new), `app/ui/src/places/work/ShareLinks.tsx` (record the answer), `app/ui/src/places/connections/Posting.tsx` (new: sign in), `app/ui/src/places/connections/index.tsx` (one render line), `app/ui/src/parts/ApprovalRow.tsx` (one line: the posting consent text while a connector row decides), `app/ui/src/engine/fake-posting.ts`, `app/ui/src/text/{en,hi}/{work,connections,today}.json`; tests `platform/tests/venture-posting-methods.test.ts`, `platform/tests/venture-posting-risk.test.ts`, `platform/tests/venture-share-answer.test.ts` (all new), `app/ui/tests/places/work-posting.test.tsx`, `app/ui/tests/places/connections-posting.test.tsx` (new).

**Failing tests first:**

1. `venture.share.recordAnswer {draftId: run.id, answer: 'approved'}` on desktop, for a social draft the owner accepted and shared (link kept, not served): records `{ via: 'owner-recorded', recordedBy: 'owner' }` through `recordClientDecision`; a second answer is `ALREADY_DECIDED`; an answer for a draft with no share link is `SHARE_NOT_FOUND` ("Share the draft first, so Chausar knows which text your client saw."); a draft edited after the link was made is `APPROVAL_STALE`; `answer: 'changes'` with `comment` keeps the comment; the phone channel is refused (`APP_APPROVAL_REQUIRED`).
2. `venture.posting.propose {draftId: '<run>.post-1'}` with a fake browser port present (`deps.connectors.browser.probe` answers present) on a LinkedIn post line: refused `POST_CLIENT_NOT_APPROVED` before the client's answer (the social offer `content-calendar` asks for client approval, `SOCIAL_APPROVALS` `every-draft`); after `recordAnswer approved` it makes one `venture-connector-post` in state `described` and one Today connector row; text comes from the stored draft, never the payload (a `text` field is refused by `exactPayload`). Refusals with every reason from `scheduleGate`: failed checks (`POST_DRAFT_UNCHECKED`), not accepted (`POST_NOT_APPROVED`), edited after the approval (`POST_DRAFT_CHANGED`), a draft id that names no post line (`POST_NOT_A_POST`), an Instagram line (`NOT_BUILT_YET`, "Posting a picture or video through the browser is not built yet."), an X line longer than one post that 2F1 split into a thread (`POST_THREAD_NOT_BUILT`, "Post a thread by hand; Chausar posts single posts.").
3. Risk gate (`venture-posting-risk.test.ts`), through `venture.posting.propose` with stored earlier posts as history: the fourth LinkedIn post in 24 hours is `POST_RISK_BLOCKED` with the line naming rule `house-post-cap-24h`; a post within 60 minutes of the last is blocked (`house-post-min-gap`); a post 0.9 similar (word three-shingles, Jaccard in whole permille) to one of the last five is blocked, 0.7 similar is allowed with a warning on the Today row's line (`house-near-duplicate` blocks at 850, `house-near-duplicate-warn` warns at 600: each number has its own dated rule); the first seven days of a channel allow one post a day (`house-warm-up`); a third post in a row linking the same domain warns (`house-link-streak`); hashtag and engagement bait reuse `checkChannelLimits` and rule `meta-engagement-bait`. The same gate runs again inside `decidePost` just before `applyAction`: a post that became blocked while it waited (another post went out meanwhile) is refused there and the fake browser's `post` is never called.
4. `venture.posting.signIn {connectorId: 'linkedin'}` on desktop calls the browser port's `signIn` once and answers `{ opened: true, line }` without waiting for the window to close (the port call is not awaited by the method; its failure is logged as an event, not thrown); on hosted it is `TIER_UNAVAILABLE` ("Posting through your own browser works only in the desktop app."); for Instagram it is `NOT_BUILT_YET`; from the phone `APP_APPROVAL_REQUIRED`.
5. The connector row's line starts with the task-scoped consent line "Chausar will post in a browser window on this computer. Please don't type in that window until the post is done." (spec K1), and the risk gate's warnings follow it.
6. Ink, Work: an accepted social draft with the client's recorded approval shows "Post to LinkedIn" per LinkedIn or X line (only for available modes from `venture.connectors.list`); clicking calls `venture.posting.propose` and the line reads "Waiting on Today"; a refusal shows the engine's words. ShareLinks shows "Your client's answer: Approved / Asked for changes" with a comment box, calling `venture.share.recordAnswer`, and then the recorded answer.
7. Ink, Connections: the LinkedIn and X cards show "Sign in" when the browser posting option is available, calling `venture.posting.signIn`; the line after says "A browser window opened. Sign in there, then close it." Today: while a connector row's approve is in flight, the row reads "Chausar is posting. Please don't type in that window until it is done." (the ApprovalRow pending text for `kind: 'connector'`).

**Implementation notes.** `proposePost`, `decidePost`, `postingOptions`, `postingEnvironment`, `portsOf` (`build/posting.ts`); `scheduleGate`, `recordClientDecision` (`playbooks/social/approvals.ts`); `asApprovalLink`, `shareView` (`build/share-links.ts`); `runView` for the run's accept state; `checkChannelLimits`, `hashtagsOf` (`social/checks.ts`); `platformRule` (`social/register.ts`) for the house numbers, so every number has a source and a checked date. Post history for the gate: `listRecords(state, 'venture-connector-post')` with state `applied` or `outcome_unknown` (an unknown post counts as sent for the caps). House rules use reading `house` and source "Chausar's own posting limits"; they are not platform rules and say so. The window-focus part of K1 is not testable with a fake and Playwright gives no switch for it without launch arguments, which `browser.ts` forbids; the consent line is the guarantee.

**Done when:** the three new engine test files and `venture-connectors-posting.test.ts`, `venture-share-links.test.ts` are `# fail 0`; `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/work-posting.test.tsx app/ui/tests/places/connections-posting.test.tsx app/ui/tests/parts/approval-row.test.tsx` all pass.

## Package 2B2: honest browser steps, confirmation by the platform, the script guard (K2, K3, K4, audit safety item 8)

Size M. Starts after 2B1. Tests use a fake Playwright (`PlaywrightLike`) with fake pages; no real browser.

**Files:** `build/browser.ts` (candidate lists, resolve-once, re-resolve before the click, response confirmation, language alternatives, `checkSteps`, owner-assisted pick), new `build/page-guard.ts`, `build/posting.ts` (`postingCheckSteps` handler; `runPost` keeps the post URL), `build/connectors.ts` (posting option gains `stepsCheckedOn`), `build/index.ts` (one line), `app/ui/src/places/connections/StepsCheck.tsx` (new), `app/ui/src/places/connections/Posting.tsx` (one render line), `app/ui/src/engine/fake-posting.ts`, `app/ui/src/text/{en,hi}/connections.json`; tests `platform/tests/venture-browser-steps.test.ts`, `platform/tests/venture-browser-guard.test.ts` (new), `app/ui/tests/places/connections-posting.test.tsx` (more cases).

**Failing tests first:**

1. Each step (`textbox`, `submit`, `confirm`) is an ordered list of candidates (`test-id`, `role` with a name per UI language, `aria-label`, DevTools-style `xpath`), each with its own `checkedOn` (null in the shipped data). Through `venture.queue.decide` approve on a LinkedIn post with a fake page: when the first candidate matches two visible elements and the second matches exactly one, the second is used; when none matches exactly one visible element, the post is `not-sent` with "LinkedIn's post button was not found the way Chausar knows it. Nothing was posted." and the fake page's `click` is never called.
2. Right before the click the submit target is resolved again; if its bounding box or text changed since the fill, the post is `not-sent` ("The page changed before posting. Nothing was posted.").
3. Confirmation: the post is `posted` when the page's confirm element shows or when the platform's own response to the matched request (pattern in data, with its checked date) is 2xx; with neither inside the step timeout it is `unknown`, never `not-sent` after the click and never a second click (the fake counts clicks: exactly one). When the confirm or response shows the post's address, the journal entry keeps it as `url`.
4. Language alternatives: with the page's UI in Hindi (the fake page's `lang` is `hi`), the role candidate matches by the Hindi name in data ("पोस्ट करें"), marked unchecked until a check run dates it.
5. `venture.posting.checkSteps {connectorId: 'x'}` (desktop, app only) opens the compose page in the owner's session through the fake, resolves every candidate of every step without typing or clicking, and stores today's date on each candidate that matched exactly one visible element (`venture-posting-steps`). A signed-out page answers `POSTING_NOT_SIGNED_IN`. `venture.connectors.list` then shows the X posting option's `stepsCheckedOn` as the oldest date across the three steps, or null; Connections shows "Steps last checked working on 23 Oct 2026" or "Steps not checked yet".
6. Owner-assisted repair: during `checkSteps`, a step with no unique candidate asks the owner to click the element once in the window; the fake page's pick returns the element's test id, role and name, aria-label and xpath; Chausar adds them as new candidates with today's date, and the next post uses them.
7. Script guard (`venture-browser-guard.test.ts`): every page script Chausar runs (the visibility count of `checkSteps` and the pick overlay) passes `checkPageScript` first. It refuses (`PAGE_SCRIPT_REFUSED`, with the reason) a script that reads `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB`, `navigator.credentials`, `navigator.clipboard`, a password, card or `autocomplete="cc-*"` field, calls `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, `postMessage`, `window.open`, assigns `location`, uses `eval`, `Function`, `import(`, `atob`, or is obfuscated (hex escapes, a line over 2,000 characters); a page not on http(s) or not Chausar's own tab is refused; an exception in the guard refuses. Audit lines carry the script's sha256 and counts only. Read-backs (the post URL, the confirm text, picked attributes) go through 1F's secret screen before they are stored or shown.

**Implementation notes.** Extend `LocatorLike` and `PageLike` only with Playwright's public API (`count`, `nth`, `isVisible`, `boundingBox`, `textContent`, `getByTestId`, `getByRole`, `waitForResponse`, `evaluate`); keep `LAUNCH_OPTIONS` unchanged. `BROWSER_SCRIPTS` keeps today's selectors as each step's first candidate. The model never proposes a selector in this wave, so K2's "inspection view for a model" is not built; say so in the module comment.

**Done when:** `node --test platform/tests/venture-browser-steps.test.ts platform/tests/venture-browser-guard.test.ts platform/tests/venture-posting-methods.test.ts platform/tests/venture-connectors-posting.test.ts` is `# fail 0` and the connections UI test passes.

---

## Package 2C1: judges on real orders and practice clients, improvement rollback (Q1, Q2 engine)

Size M.

**Files:** `delivery/scenarios.ts` (template clients ask the rules judge), new `delivery/judge-run.ts` (`deliveryJudgeHandler`, `deliveryJudgeSendHandler`), `delivery/improve.ts` (`improveRollbackHandler`), `delivery/index.ts` (register three methods); tests `platform/tests/venture-judge-practice.test.ts`, `platform/tests/venture-judge-real-orders.test.ts`, `platform/tests/venture-improve-rollback.test.ts` (all new). Existing tests that pin the template checks (`venture-delivery.test.ts`, `venture-views-runs.test.ts`, `venture-ink-final.test.ts`, `venture-judge-checks.test.ts`) are updated in the same change.

**Failing tests first:**

1. `venture.simulation.run {}` on a CA firm business with both tiers an AI: each of the three template practice clients' episodes has a `rules-judge` result decided over `CA_JUDGE_RULES` (rule ids `right-head` ... `no-filing-claims` in the votes), not only signal cases. On a plain consulting business the template clients get `DRAFT_RULES`. With `useTemplate: true` the episodes have no `rules-judge` result and the runs view says "Not checked: no judge connected." (as today for signal cases).
2. `venture.delivery.judge {runId}` on a ready, non-practice agent draft whose code checks and playbook checks all passed: stores `judge.status: 'waiting'` with a preview of the rules task (`containsClientData: true`, the flagship's rules or `DRAFT_RULES`, the trace from `traceFromHarness` with the client's message and the draft from `renderForJudge`) and returns the preview's digest and estimated cost. Refusals: a run not ready (`JUDGE_NOT_READY`), a failed check (`JUDGE_NOT_READY`, "Fix the failed check first; the judge reads only drafts that pass the code checks."), a practice draft (`PRACTICE_DRAFT`), no AI (`NO_MODEL_CONNECTED`).
3. `venture.delivery.judgeSend {runId, digest}` (app only) with the preview's digest: goes through `journalled` with action `delivery.send` ("Send to your AI"), runs the preview once (`deps.models.runPreview` with `validateBallot`), counts with `decideRules`, appends the `rules-judge` result to `run.checks`. A failing verdict (a checked "no" quoting the rule) blocks Accept with the judge's quoted reason (`venture.delivery.review accepted` refused through `failedCheckReason`); an unverified verdict shows "Not checked" and blocks nothing; a wrong digest is `APPROVAL_STALE`; a second send is `JUDGE_ALREADY_SENT`; a refused ballot shape leaves every rule unsettled (`notRuled`), never a pass.
3a. Founder decision (23 Oct): the judge runs **automatically** on every ready draft that goes to a client or the public (client replies, deliverables, posts, outreach), at most once per run (a run's draft never changes once it is ready), after its code checks pass, on the owner's own AI, with its estimated cost shown on the run. A per-business setting `judgeAuto` (default on) turns it off; internal notes never trigger it. The automatic call goes through the same journalled `delivery.send` path as `judgeSend` with the business's standing consent for judge calls recorded once when the setting is on (the setting's sheet says the client's words go to the owner's AI). Tests: a client-facing draft gets a `rules-judge` result without a button press; with `judgeAuto` off it gets none until "Ask the judge"; an internal note gets none; a run is judged at most once, and an owner edit is the owner's own words, never judged, with the run's judge line set to `JUDGE_EDIT_LINE`.
4. `venture.improve.rollback {playbookId: <parent>, digest: <current hash>}` (app only) after an adopted improvement: points the business back at the parent version (`currentPlaybook` returns it), keeps the adopted version stored, emits `playbook-adopted` with `rolledBack: true`; refused `ROLLBACK_NOTHING` when the current version is not from an improvement run or `playbookId` is not its parent, `ROLLBACK_STALE` when the plan changed since (the parent no longer fits the accepted plan, checked like `staleReason`), `APPROVAL_STALE` when `digest` is not the current version's hash. A later `venture.improve.status` shows the parent as active and no candidate.

**Implementation notes.** `rulesTask`, `decideRules`, `validateBallot`, `notRuled` (`delivery/judge/rules.ts`); `traceFromHarness` (`delivery/judge/trace.ts`); `flagshipJudgeRules` (`playbooks/draft-checks.ts`); `renderForJudge` (`delivery/deliverable.ts`); `journalled` (`journal/journal.ts`); `markFailedWhenSpent` behaviour copied for a spent judge call. In `scenarios.ts`, add `'rules-judge'` to `BASE_CHECKS` and so to `MESSY_CHECKS`; `practiceChecks` in `simulate.ts` already asks only when an AI judge is on and code checks passed. `improveRollbackHandler` uses `currentPlaybook`, `findRecord`, the `fits` rule in `delivery/playbook.ts` (export it) and `tx.touch({ playbookId })`.

**Done when:** the three new test files and `venture-delivery.test.ts`, `venture-harness-runs.test.ts`, `venture-judge-*.test.ts`, `venture-views-runs.test.ts` are `# fail 0`.

## Package 2C2: Ink controls for practice, improvement and the judge (Q2 screen, Q1 screen)

Size M. Starts after 2C1.

**Files:** `app/ui/src/places/business/PracticeView.tsx` (new), `app/ui/src/places/business/index.tsx` (a `practice` page in `PAGES`), `app/ui/src/places/work/JudgeLine.tsx` (new), `app/ui/src/places/work/OrderFocus.tsx` (one render line), `app/ui/src/engine/fake-practice.ts` (`venture.simulation.*`, `venture.improve.*`, `venture.delivery.judge*` following the engine's rules), `app/ui/src/text/{en,hi}/{business,work}.json`; tests `app/ui/tests/places/business-practice.test.tsx`, `app/ui/tests/places/work-judge.test.tsx` (new), plus axe in `app/ui/tests/a11y.test.tsx` for the new page.

**Failing tests first:**

1. `#/business/practice` lists the practice clients (`venture.simulation.scenarios`) and "Rehearse now"; clicking calls `venture.simulation.run {}`, shows "2 of 3 passed" with each failed client's first failure and the engine's `costDisplay` (labelled as the engine wrote it, never computed in Ink).
2. The improvement part reads `venture.improve.status`: the readiness line in the engine's words; "Run the improvement loop" is enabled only when readiness allows and calls `venture.improve.run`; a kept candidate shows its `changes` lines and "Use this version" (second ask), calling `venture.improve.adopt {runId, digest}`; a stale candidate shows the engine's `CANDIDATE_STALE` words.
3. After an adoption the page shows "Version in use: 5, from an improvement run" and "Go back to version 4" (second ask) calling `venture.improve.rollback {playbookId, digest}`; refusals show the engine's words.
4. Work > order: a ready draft that passed every check shows "Ask the judge"; it calls `venture.delivery.judge`, shows the cost estimate and "Send to the judge", which calls `venture.delivery.judgeSend` with the digest; the result line reads the judge check's detail; a failed verdict shows the quoted rule and the Accept control explains it is blocked.
5. Every new string is in `en` and `hi`; the page passes axe.

**Done when:** `npx vitest run --config app/ui/vitest.config.ts app/ui/tests/places/business-practice.test.tsx app/ui/tests/places/work-judge.test.tsx app/ui/tests/a11y.test.tsx app/ui/tests/text.test.ts` all pass.

---

## Package 2D: bank statements feed the books; consent and alerts on screen (M16, audit bank items)

Size M (engine and screen, one agent).

**Files:** `build/bank.ts` (`pairOwnTransfers`, `matchInvoices`; `alertDeliveries` sends a count only), `build/bank-methods.ts` (`bankLedger`, `bankApply`, `bankAlertsGet`, `bankAlertsSet`; `bankImport` evaluates alerts after the import), `money/payments.ts` (split out `recordPaymentMinor` so a bank row and the owner's typed payment share one path), `views/queue.ts` (`bank` rows), `build/index.ts` (register four methods), `app/ui/src/places/connections/BankSheet.tsx` (new: accounts, consent, alerts, transactions), `app/ui/src/places/connections/index.tsx` (one line: the bank card opens BankSheet; BankImport stays inside it), `app/ui/src/engine/fake-bank.ts`, `app/ui/src/text/{en,hi}/connections.json`; tests `platform/tests/venture-bank-books.test.ts`, `platform/tests/venture-bank-alerts.test.ts` (new), `app/ui/tests/places/connections-bank.test.tsx` (new).

**Failing tests first:**

1. Own transfers: import `HDFC current` with a row of -20,000.00 on 2026-11-03 and `SBI savings` with +20,000.00 on 2026-11-04: `venture.bank.ledger {}` marks both `own-transfer` paired to each other; a +20,000.00 three days later is not paired; a row whose counterparty names another own account's label is `own-transfer` unpaired. `venture.bank.apply {transactionId, as: 'payment' | 'cost'}` on an own transfer is `BANK_OWN_TRANSFER`.
2. Invoice match by whole word: with invoice `INV-0007` issued (balance 11,800.00), a money-in row "NEFT/INV-0007/Asha Rao" of 11,800.00 is suggested as its payment ("pays it in full"); a row naming `INV-00071` is not matched; a row of 5,000.00 naming `INV-0007` is suggested as a part payment; money out is never matched to an invoice.
3. `venture.bank.apply {transactionId, as: 'payment', invoiceId}` (app only) records the payment through `recordPaymentMinor` with method `bank-transfer`, `receivedOn` the row's date and `bankTransactionId`; `venture.books.summary` for the month then shows Received up by exactly 11,800.00 with the calculator's receipt; a second apply of the same row is `BANK_ALREADY_APPLIED`; an amount above the balance is `PAYMENT_TOO_LARGE`; money out as payment is `BANK_NOT_MONEY_IN`; an unknown row is `BANK_TRANSACTION_NOT_FOUND`.
4. `as: 'cost'` on a money-out row writes one books fact of kind `cost` (the services pack's `costs` definition, amount positive, the row's date, description from the statement) and the calculator's `costs` operation for that day counts it; an own transfer never reaches it. `as: 'skip'` records the decision and the row stops being suggested.
5. Today: after an import, each suggested match is one `bank` row ("Record 11,800.00 from 4 Nov as payment of INV-0007?", actions Record payment and Not this, decided through `venture.queue.decide`, which calls `bankApply`); own transfers make no row.
6. Alerts (`venture-bank-alerts.test.ts`): `venture.bank.alerts.set {account, rules: [{kind: 'large-debit', minor: '5000000'}], alertAddress: 'https://hooks.example.com/x'}` stores them through `setAlertWebhook` (1F's net guard refuses a private address); `venture.bank.alerts.get` returns the rules and "Alerts go to the address you set" without the address itself. After an import with a 60,000.00 debit, `evaluateAlerts` finds it, Today gets a `bank` alert row, and one journal entry `bank.alert` is applied whose sent body is `{ count: 1 }` only: no amount, no description, no transaction id (spec 5.7 count-only rule). The transport is a test stub; the request uses 1F's guarded fetch with redirects refused.
7. Ink, Connections > Bank account: the sheet lists accounts with the consent line from `venture.bank.consent`'s `status.line` ("Bank access ends on ..."), Renew (days) and Stop, the engine's `NO_PROVIDER_LINE`, the alert rules form, and the ledger with each row's classification and Record payment / Add as cost / Skip buttons calling `venture.bank.apply`. Every figure is shown as the engine wrote it.

**Implementation notes.** `importStatement`, `consentStatus`, `grantConsent`, `revokeConsent`, `evaluateAlerts`, `setAlertWebhook`, `modelBankView`, `alertDeliveries` (`build/bank.ts`); `insertBooksFact` (`money/facts.ts`, add a `costFact` beside `paymentFact`); `booksReceiptFor`; `recordPayment`'s transaction body moved into `recordPaymentMinor` unchanged. Pairing: opposite amounts, different own accounts, dates at most two days apart, nearest date first, then file order, each row paired once. Whole-word match: `\b` on both sides of the invoice number, case-insensitive, over description, counterparty and reference. All money in BigInt.

**Done when:** `node --test platform/tests/venture-bank-books.test.ts platform/tests/venture-bank-alerts.test.ts platform/tests/venture-bank-methods.test.ts platform/tests/venture-connectors-bank.test.ts platform/tests/venture-money.test.ts` is `# fail 0`; the connections bank UI test passes.

---

## Package 2E1: the built YouTube pieces into runs, and the connector fact (Y1, Y17)

Size M.

**Files:** `delivery/harness/tools-youtube.ts` (replace the stubs), `playbooks/youtube/playbook.ts` (step tools; `youtube-upload` connector text), `playbooks/draft-checks.ts` (`youtubeChecks` only), `build/posting.ts` (the YouTube `handoffWhat` line only, one edit, after 2B1), `build/catalogue.ts` and `app/ui/src/engine/fixtures-business.ts` (the YouTube note); tests `platform/tests/venture-youtube-tools.test.ts` (new).

**Failing tests first** (YouTube business, order with an SRT transcript upload, through `venture.delivery.approve` turns):

1. Hooks: the act turn calls `youtube.hooks {hooks: [five hooks]}`; code ranks them with `rankHooks` and keeps the best two as a computed work table (Hook, Score, Band, Weakest, Fix); the write step's package has two `Hook:` lines; at verify, `hook-score` judges the higher-scoring of the two (not the first written) and its detail names which one Chausar kept and the other's score. A package hook that is not one of the kept two fails `hook-score` with "This hook is not one the scorer kept."
2. Edit list: on a `shorts-from-own-video` order with rights recorded at intake, `youtube.editList {picks: [{from: 'seg-12', to: 'seg-18'}], fps: 30}` returns `buildEditList`'s frame ranges as a computed table; with no rights at intake it answers `RIGHTS_REQUIRED`; an unknown segment id answers `TOOL_FAILED` with the engine's words.
3. Chapters: `youtube.chapters {}` on the transcript returns `draftChapters`'s lines ("0:00 Budget Basics") and whether they are valid; the package's description that uses them passes `chapters`.
4. Retention: an uploaded Studio export CSV (`retention.csv`, 12 rows, percent axis) read by `youtube.retention {file: 'f2'}` returns `readRetentionExport`'s hook leak, verdict and cliffs with what was said there (from the transcript); fewer than 8 points answers `TOOL_FAILED` with the engine's words.
5. Grants: `intake` gets `youtube.retention`; `find` gets `files.read`, `youtube.hooks`, `youtube.editList`, `youtube.chapters`; a non-YouTube studio business is not granted them and a patch granting one is refused.
6. Y17: `venture.connectors.list` (and `youtubeConnectors`) for the YouTube upload says uploads default to private until the owner chooses, and that Chausar's publishing checklist ticks the altered or synthetic content setting whenever an AI voice or presenter is used; the old "locked to private until an audit" wording appears nowhere outside `previously` in `platform-rules.ts`.

**Implementation notes.** `rankHooks`, `hookScore`, `buildEditList`, `draftChapters`, `readRetentionExport`, `parseTranscript` (`playbooks/youtube/checks.ts`, `transcript.ts`); `transcriptCues` (`delivery/harness/files.ts`); `requireRights` through `buildEditList` with `env.intake` and the run's date; `computedTable` from 2-0. `youtubeChecks` reads `input.tables` for the kept hooks. All four are `read` effects.

**Done when:** `node --test platform/tests/venture-youtube-tools.test.ts platform/tests/venture-playbook-youtube*.test.ts platform/tests/venture-playbook-wiring-delivery.test.ts` is `# fail 0`.

## Package 2E2: local transcription on the desktop (K12)

Size M. Starts after 2E1.

**Files:** `platform/runtime/speech.ts` (`SpeechService.transcribeFile`), `platform/runtime/engine.ts` (pass `speech` into the venture host's services; one line), `contracts.ts` (`VentureEngineServices.speech?`, one edit), new `playbooks/youtube/transcribe.ts`, `delivery/harness/files.ts` (`venture.files.transcribe` handler beside `filesAddHandler`), `delivery/index.ts` (one line), `playbooks/youtube/playbook.ts` (`transcription` connector entry only), `app/ui/src/places/work/TranscribeButton.tsx` (new), `app/ui/src/places/work/OrderFocus.tsx` (one line), `app/ui/src/engine/fake-wiring.ts`, `app/ui/src/text/{en,hi}/work.json`; tests `platform/tests/venture-youtube-transcribe.test.ts` (new), `app/ui/tests/places/work-orders.test.tsx` (one case).

**Failing tests first:**

1. On desktop with a local-command speech provider configured (whisper-cli and model absolute paths) and an `FfmpegPort` stub: `venture.files.transcribe {orderId}` for a YouTube order whose intake names `cutFile` extracts mono 16 kHz audio with ffmpeg, runs whisper-cli once with `-osrt` and `--prompt` holding the business dictionary's terms (the glossary), parses the SRT with `parseTranscript`, drops cues whose text is empty or a non-speech marker (`[BLANK_AUDIO]`, `(music)`), and stores one upload `format: 'transcript'`, `origin: 'local-transcription'`, `clientData: true`; the next run's `files.list` lists it and `retention-risk` reads it. Nothing goes over the network (the process stub records the command).
2. No ffmpeg: `TRANSCRIBE_NOT_AVAILABLE` "ffmpeg not found on this computer. Chausar never installs it."; no speech provider: `TRANSCRIBE_NOT_AVAILABLE` "No whisper.cpp is set up on this computer."; hosted: `TIER_UNAVAILABLE`; no `cutFile`: `INVALID_VENTURE_REQUEST`; a transcript upload already on the order: `TRANSCRIPT_EXISTS`; whisper exits non-zero: `SPEECH_FAILED`, nothing stored, never retried.
3. The `transcription` connector reads `available` with "Makes a transcript with timings from the footage on this computer." when ffmpeg and a local whisper are both present, else planned with the plain reason.
4. Ink, Work: an order with a cut and no transcript shows "Make a transcript on this computer" (desktop only), which calls the method and then lists the transcript as an order file.

**Implementation notes.** `SpeechService.transcribeFile(context, { path, prompt, timeoutMs })` uses the first enabled `local-command` provider, `defaultProcess` from `gateway.ts`, a temp folder removed in `finally`, and the existing absolute-path rules; it never uploads. ffmpeg through `systemFfmpeg` or `deps`-injected `FfmpegPort` (`playbooks/youtube/finishing.ts`, `findOnPath`). Draft, final and refined tiers and model hashes (rest of K12) are W5's YouTube deepening.

**Done when:** `node --test platform/tests/venture-youtube-transcribe.test.ts platform/tests/venture-playbook-transcripts.test.ts` is `# fail 0` and the work UI test passes.

---

## Package 2F1: the built social pieces into runs (S1)

Size M to L. The order-chain part of "the whole 14-step flow" (voice sheet approved once, then calendar, then drafts as separate runs) is W5's social deepening (spec 5.8); this package wires every built piece into the run each offer has today.

**Files:** `delivery/harness/tools-social.ts` (`social.report`), `playbooks/social/playbook.ts` (`social.report` on the `intake` step; guidance lines for calendar slots), `playbooks/steps.ts` (calendar guidance on the `drafts` step), `playbooks/intake.ts` (social `calendar` and `clientRules` intake fields), `playbooks/draft-checks.ts` (`socialChecks` only), `app/ui/src/places/work/IntakeFields.tsx` (the new intake fields), `app/ui/src/text/{en,hi}/work.json`; tests `platform/tests/venture-social-run.test.ts`, `platform/tests/venture-social-report-run.test.ts` (new), `app/ui/tests/places/work-orders.test.tsx` (one case).

**Failing tests first** (social agency business, through `venture.order.create` with intake and `venture.delivery.approve` turns):

1. Calendar slots: a `content-calendar` order with `intake.calendar {month: '2026-11', channels: ['linkedin', 'instagram'], postsPerChannel: 3, weekdays: [1, 3, 5]}`: the drafting task's input lists the six slots from `planCalendar` (ids and dates from code); a draft with three LinkedIn and three Instagram lines passes `calendar-slots`, and each post gets its slot's date by order (the third LinkedIn line is `linkedin-3`); a draft with two LinkedIn lines fails `calendar-slots` ("LinkedIn has 3 slots and 2 posts."). A month with fewer posting days than posts is refused at `venture.order.create` with `planCalendar`'s words. No date in a post line is taken from the model.
2. Thread splits: an X line of 500 characters is split by `splitThread` into numbered parts; `channel-limits` passes with "split into 2 posts by code"; the stored check detail lists the parts' lengths; a LinkedIn line over 3,000 characters still fails.
3. Client lists: an order with `intake.clientRules {bannedWords: ['cheap'], competitors: ['Yoga Hub']}` fails `words` on a post saying "cheap classes" and on one naming "Yoga Hub"; a protected phrase is never flagged.
4. Report figures: a `monthly-report` order with an Instagram content export (`instagram-november.csv`, columns as `EXPORT_PROFILES.instagram`): the act turn calls `social.report {month: '2026-11', files: [{file: 'f1', platform: 'instagram'}]}`; the receipts from `monthlyReport` become one work receipt (`operation: 'social.report'`) with figures `views`, `reach`, `follows`, `engagements`, `engagement-rate` (unit percent), `top-post` (unit post), each with its formula, file digest, rows and columns; a file of another shape answers the engine's refusal.
5. Narrative check: the report draft that cites `w1.reach` and writes no other figure passes `narrative-receipted`; one that also writes "up 40%" fails with `checkReportNarrative`'s line and blocks Accept.

**Implementation notes.** `planCalendar` (`social/calendar.ts`), `splitThread`, `checkSocialDraft`, `checkChannelLimits`, `checkWords` (`social/checks.ts`), `monthlyReport`, `computePlatformReport`, `checkReportNarrative` (`social/report.ts`); `orderIntake` (`playbooks/intake.ts`). `socialChecks` builds `ClientRules` from `input.intake.clientRules`; it finds the report receipts among `input.receipts` by `operation === 'social.report'`. `social.report` is a `read` effect with a `totals` proof. The brand kit record that later feeds the client lists is W5 (catalogue P7).

**Done when:** `node --test platform/tests/venture-social-run.test.ts platform/tests/venture-social-report-run.test.ts platform/tests/venture-playbook-social*.test.ts platform/tests/venture-playbook-wiring-delivery.test.ts` is `# fail 0`.

## Package 2F2: the calendar file (S1 calendar export)

Size S. Starts after 2B1 (it uses `draftApprovalsOfRun`) and 2F1 (it uses the slots).

**Files:** new `playbooks/social/calendar-export.ts` (`socialCalendarHandler`), `build/index.ts` (one line), `app/ui/src/places/work/CalendarFile.tsx` (new), `app/ui/src/places/work/OrderFocus.tsx` (one line), `app/ui/src/engine/fake-wiring.ts`, `app/ui/src/text/{en,hi}/work.json`; tests `platform/tests/venture-social-calendar-export.test.ts` (new), `app/ui/tests/places/work-posting.test.tsx` (one case).

**Failing tests first:**

1. `venture.social.calendar {runId}` on an accepted content-calendar draft with the client's recorded approval returns `{ csv, rows: 6, blocked: [] }`, rows in date order with the slot dates from code; before the client's answer every post is in `blocked` with "Your client has not approved this draft." and the CSV has only its header; a post edited after approval is blocked with "The draft changed after it was approved."; a cell starting with `=` is defused (`calendarExport`'s rule). A run that is not a social draft is `CALENDAR_NOT_A_SOCIAL_DRAFT`; a draft with no calendar intake is `CALENDAR_NO_SLOTS`.
2. Ink, Work: "Download the calendar file" saves the CSV the engine returned (no file is built in Ink) and lists the blocked posts with their reasons.

**Implementation notes.** `calendarExport`, `scheduleGate` (`social/approvals.ts`), `draftApprovalsOfRun` (2B1), `planCalendar`.

**Done when:** `node --test platform/tests/venture-social-calendar-export.test.ts` is `# fail 0` and the work UI case passes.

---

## Package 2G: the evidence ledger fed by an agent tool

Size S to M.

**Files:** `delivery/harness/tools-evidence.ts` (`evidence.record`), `delivery/harness/tools.ts` (`ToolResult.evidence`, `ToolEnv.evidence` pending list, collected in `callTool`; a few lines), `delivery/runs.ts` (`approveHarnessTurn` stores the pending evidence in the same transaction as tables and receipts), `evidence/ledger.ts` (`recordEvidence` gains `noAutoApply`), every playbook's gather steps and the eight fixed steps' `work` step (grant `evidence.record`); tests `platform/tests/venture-evidence-tool.test.ts` (new).

**Failing tests first** (through `venture.delivery.approve`):

1. The agent reads an invoice PDF (`files.read f1 part pages`) and calls `evidence.record {subject: 'client', field: 'email', value: 'asha@example.in', type: 'document', from: 'f1', source: 'invoice page 1'}`: one `venture-evidence` record for `client:<the order's client>` with `type: 'document'`, `toolCallId` of that `files.read` call, strength `strong`; it is not applied; `venture.queue.list` shows it as a question row; `venture.evidence.apply` applies it and the client's email changes.
2. Claiming `type: 'document'` from a file the run never read is downgraded to `model-inferred`, weak and flagged with `UNCHECKED.document`; `type: 'tool-verified'` with `from: 'w1'` is accepted only when `w1` was made by a `compute` or `read` calculator tool in this run.
3. Two files that agree make the value `verified`, but a run that read client files is tainted (1E), so nothing is applied on its own: the record stays a suggestion with "From a client file: waits for you." Only the owner's apply writes it through.
4. A subject other than this order's client or the business is refused (`TOOL_FAILED`); a value with a secret is screened by 1F before it is stored; in rehearsal the tool answers `{ recorded: false, practice: true }` and stores nothing.

**Implementation notes.** `recordEvidence`, `evidenceQuestions`, `evidenceApply`, `backs`, `UNCHECKED` (`evidence/ledger.ts`, `evidence/types.ts`). Effect: it writes only Chausar's own ledger, as a suggestion. If 1E's taint latch would hold it as a `write`, add `evidence.record` to 1E's internal-suggestion allowance in `policy/taint.ts` (one line) rather than weakening the latch, and test both: allowed as a suggestion, never auto-applied.

**Done when:** `node --test platform/tests/venture-evidence-tool.test.ts platform/tests/venture-evidence.test.ts platform/tests/venture-harness-runs.test.ts` is `# fail 0`.

## Package 2H: dated platform rules wired into runs and on screen (P1; social and YouTube rule freshness)

Size S to M.

**Files:** `playbooks/social/register.ts` (`usedBy`, `limitations` on every rule; validation), `playbooks/youtube/platform-rules.ts` (the same), `playbooks/registry.ts` (`riskLevel`, `lastReviewed` per playbook; validation), new `playbooks/rules-view.ts` (`rulesListHandler`), `views/index.ts` (one line), `playbooks/draft-checks.ts` (one call in `playbookOwnChecks` adding a `rules-current` result), `app/ui/src/places/business/RulesSection.tsx` (new), `app/ui/src/places/business/PlanView.tsx` (one line), `app/ui/src/engine/fake-wiring.ts`, `app/ui/src/text/{en,hi}/business.json`; tests `platform/tests/venture-rules-register.test.ts` (new), `app/ui/tests/places/business.test.tsx` (one case).

**Failing tests first:**

1. `validateRulesRegister` and `validatePlatformRules` refuse a rule without `usedBy` (step or check ids) or whose `usedBy` names a step or check the playbook does not have; every shipped rule passes. `validateRegistry` refuses a playbook without `riskLevel` or `lastReviewed`.
2. `venture.rules.list {}` on a social business returns each rule with `checkedOn`, `stale` (from `rulesFreshness`), `usedBy`, `limitations` and the source link, plus the playbook's `riskLevel` and `lastReviewed`; on a YouTube business the same from `ruleFreshness`; on a business with no flagship an empty list.
3. A run: with the clock at 2027-01-25 (more than 90 days after 2026-10-21), a YouTube draft's checks include `rules-current` with outcome `not-run` and "not run: these rules were last checked more than 90 days ago: Video chapters added by hand, ... Recheck them." It does not block Accept. Before the window it is `pass`. The same for a social draft (rules the run's findings name by `ruleId`, plus those whose `usedBy` names a check the run ran).
4. Ink, Business > Plan and playbook shows "Platform rules: 18 current, 2 to recheck" with each stale rule's line and its source link.

**Implementation notes.** `rulesFreshness`, `RULE_STALE_AFTER_DAYS`, `platformRule` (`social/register.ts`); `ruleFreshness`, `PLATFORM_RULES` (`youtube/platform-rules.ts`); `findPlaybook` (`registry.ts`). 2B1's house posting rules carry `usedBy: ['publish']`.

**Done when:** `node --test platform/tests/venture-rules-register.test.ts platform/tests/venture-playbook-social*.test.ts platform/tests/venture-playbook-youtube*.test.ts` is `# fail 0` and the business UI case passes.

---

## Wave 2 done when

- Every package's tests pass; `npm run typecheck` and `npm run typecheck:ui` are clean; `npm run test:ui` and all six bench shards (`node scripts/bench.mjs`, in the background) are green, with no skipped tests.
- Every row of the coverage table above has its test going through the named caller.
- One PR "Ink v2 wave 2: wire the built-but-unreachable code", stacked on wave 1, with the coverage table and the commits in conventional form (`feat(w2): ...`).

## Not placed

- Bank polling (`pollAllowed`, `recordPoll`, `requireActiveConsent` in `build/bank.ts`). It counts reads Chausar makes on its own from a bank provider, and no provider exists: the Account Aggregator is a spec non-goal. Owner-started statement imports are not polls. It stays labelled planned (the bank card's `NO_PROVIDER_LINE` says so, tested in 2D) and is wired when a provider is.

## Open questions for the founder

- Spec section 6 names `venture.simulation.start`, `venture.improve.start` and `venture.posting.signIn {account}`. This plan keeps the existing `venture.simulation.run` and `venture.improve.run`, and keys sign-in by connector (one Chausar browser profile per platform). Say if the spec's names should be added as well.
- The house posting limits in 2B1 (three posts a day per channel, a 60 minute gap, a seven day warm-up, near-duplicate at 0.85) are Chausar's own choices, labelled as such. Change them before the PR if you want others.
- Answered 23 Oct: the judge runs automatically on drafts that go to a client or the public (switchable per business, `judgeAuto`); "Ask the judge" stays for everything else. See 2C1 step 3a.
