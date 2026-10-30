# 5N newsletter service implementation checkpoint

In progress, not review-ready. The registration and definition remain null while the integrator runs shared gates. No completion or readiness claim is made.

## Current source and boundaries

- Read BRIEF, REVIEW, the 5N plan and NL1 to NL4 catalogue rows, plus the MailCheap card. Read upstream presend-checks, first-send, import-checks and report-stats through the GitHub connector. MailCheap is AGPL, learn only: the TypeScript here is original.
- Read Gmail sender guidelines, RFC 8058, AWS SES production access, FTC CAN-SPAM guidance and the official DPDP Act. Yahoo direct pages currently return HTTP 429; official search excerpts are available, but do not claim a full current Yahoo page verification. ASCI code index was reachable, full relevant rule text still needs checking.
- Live list import and export require named professional confirmation of the consent rule, currently null. Preparation stays available. Rehearsal posture does not turn an actual client list into fictional evidence.
- Import preview does not perform DNS. Exact owner approval of the source, consent and current suppression state precedes bounded MX queries, followed by a fresh source/consent check before saving. MX verifies a domain's mail servers, not a mailbox or universal spam-trap detection.
- All sends remain in the owner's tool. HTML, plain text and audience CSV exports retain `sent: false`. Each next slice waits for a matching source report and three elapsed hours. No automatic release after a pause or block.
- House thresholds conservatively omit the upstream minimum-event exceptions: any ratio beyond the requested limit pauses or blocks. This is safer and follows the explicit package tests. Note this decision in the PR.
- No cleanup deletes contacts. Explicit Forget must still erase their personal data and retained source copies. That integration is not implemented yet.

## Test-first evidence

- `n-domain-red.log`: four new domain test files fail because their implementations are absent. `n-domain-green.log`: 9/9 pass after implementation.
- `n-state-red.log`: missing state implementation. `n-state-green.log`: 6/6 pass (3 state cases plus 3 presend fixture-import cases).
- `n-desk-red.log`: missing public desk factory and legal guard. `n-desk-green.log`: 6/6 pass (3 public cases plus 3 imported presend cases).
- `n-optout-red.log`: a real existing opt-out is incorrectly accepted, expected suppressed count 1 but got 0. `n-optout-green.log`: 7/7 pass after correcting the existing settings kind to `venture-lead-settings`.
- Engine temp remains the default C: folder. No broad suites, typechecks or git mutations during concurrent integration gates.

## Remaining work

1. Complete source-result/cleanup/last-chance flows, source replacement checks, suppression races and Forget integration, including derived model/receipt copies.
2. Actual agent draft path, source-bound tools, final checks and `use-run`; metadata registration, definition, typed baselines, rule register, catalogue and browser metadata parity.
3. Fake exact contract with honest DNS demonstration boundary, owner UI, Hindi/hi-review, receipts and source-based stats display.
4. Focused real/fake/UI/public-flow tests, appropriate text/source/Ink checks, own type errors, phone EN/HI light/dark screenshots, independent spec then quality review.
5. Final notes/owned shared hunks and root handoff. Root owns full-wave gates and PR.

## Review handoff, 2026-10-29

Implementation is now registered and ready for independent spec, then quality review. Earlier checkpoint remaining-work text above is historical. No PASS or completion claim until the separate reviewer closes it. Root owns broad batch/wave gates.

### What is built

- `newsletter-studio` registration, validated kit definition, two owner-priced offers, requested roles/workflow and owner approval floors, seven dated rules with explicit `needs`, three typed source baselines, Content tile, engine Hindi and browser metadata. Available connector `newsletter-owner-tool` is a manual HTML/text/CSV handoff. SES, MailCheap Cloud and Postmaster remain planned in the definition. Connector guide integration is owned by batch1_verify.
- Owner desk: prepare from the actual generated kit offer identity; review consent/source before bounded real MX queries; counted cleaning exclusions; write/review/send panels; exact saved source notes and configured model preview/confirmation; atomic draft review; exact export audience; result-file preview and confirmation; cleanup/last-chance states; explicit subscriber Forget; owner-entered sponsor/tier rupee calculation and retained code receipt. `NewsletterStudioDesk.ready=true`.
- Source-note AI selects and orders verbatim owner notes under stable IDs. It cannot invent body facts or numeric subjects. Subject meaning and any owner rewrites still need owner review. Subscriber addresses are excluded from the direct model request. Private source notes are manual pending a qualified local model. Generic kit delivery copies the saved source-bound desk artifact and code-generated result report, and final checks refuse altered titles, headings or extra claims. Generic client runs also wait for the named consent-rule confirmation before spend.
- Every import/export is owner-authorized and exact. DNS starts only after app authority and exact approved preview, and state is rechecked after asynchronous work. Sponsor disclosure and United States rules have their own export gates. Production confirmations remain null. Preparation works while actual client list import/export are labelled as waiting for professional review.
- The shared block list is updated from reported unsubscribes, bounces and complaints. Later lists with another sender/tool do not evade it. Forget follows opaque source-file, order, issue, run, preview and model-call identities, removes retained copies and clears model payloads while preserving cost metadata. Cleanup alone never deletes.
- Report CSV accepts exact recipient rows and actual sent/reported times. Optional openedAt/clickedAt event timestamps feed hourly observations; unobserved and future hours stay null. Counts are reported by the owner tool, never independently measured by Chausar. Comparison uses at most ten distinct earlier issues on the same list and needs at least two. Open rates are explicitly soft.
- Fake desk shares pure algorithms and matches public shapes/codes. DNS and AI are demonstration responses, not actual external calls. Complete public FakeEngine onboarding/import/issue/export/report/price receipt is covered, including generated offer IDs.

### Source reading and deliberate boundaries

ASCI current official code was retrieved and its advertising disclosure provisions read, including Sponsored among permitted labels. Yahoo direct pages still return 429; the rule is explicitly unconfirmed based on official search excerpts, not a claimed full-page verification. The Gmail, RFC, FTC, AWS and DPDP sources are listed in the code. No real provider account was connected or send attempted.

Known domain lists are limited house heuristics, not universal disposable/spamtrap detection. MX checks domain mail routing, never mailbox existence. Sender authentication and one-click headers are owner attestations in the actual sending tool; HTML alone does not implement them. The conservative slice limits omit upstream minimum-event exceptions. Every actual tool send remains manual, and exports keep sent:false. Own-newsletter work uses an owner-chosen client record representing that list, with sponsor/tier totals as calculation receipts, not automatic billing or predicted sales.

### Test-first and verification evidence

In addition to the original domain/state/desk RED/GREEN above:

- `n-import-authority-red` showed a viewer triggering a DNS query, then GREEN 8/8. `n-permanent-optout-red` showed a missing permanent block, then GREEN 9/9.
- `n-forget-red` lacked the public Forget action; GREEN 10/10. `n-ai-forget-red` retained an opaque linked issue/model source; GREEN 12/12, including preserved cost.
- `n-ai-core-red` and `n-ai-desk-red` preceded the source validator and actual model-port path. `n-fake-ai-red` rejected source-notes; GREEN 4/4 after exact fake model parity.
- `n-kit-offer-red` rejected a generated kit offer ID; GREEN after resolving the current blueprint offer. `n-stats-unknown-red` fabricated zero for an absent hourly observation; GREEN after unknown stays null.
- `n-price-red`, `n-checks-red`, `n-tools-red` and `n-registration-red` precede their actual implementations. Baseline cases each run domain cores and fail missing/corrupted source fixtures.
- `n-sponsor-gate-red` exported sponsor copy despite absent disclosure confirmation; GREEN 11/11 with its own gate. `n-csv-red` exposed a generic malformed-CSV error; GREEN 14/14 with typed input failure and strict UTF-8 byte identity.
- `n-buffers-red` showed sibling form editing stayed enabled while source notes were dirty; `n-buffers-green2` passes the actual UI save, AI preview and confirm flow. One dirty form disables the sibling editors, result confirmation and export approval.
- `n-hourly-red` refused optional actual event timestamps; GREEN 5/5 after exact bounded event-time parsing and report aggregation. No estimated timestamps are introduced.
- Current combined engine run: `results/n-final-engine.log`, 35/35. Final UI/fake/text run: `results/n-final-ui.log`, 28/28. Earlier UI/fake/text 27/27 and public FakeEngine flow 1/1. Shared test fixtures were extracted from test modules so counts no longer include duplicate imported tests.
- Engine and UI types passed at the pre-handoff checkpoints (`n-engine-types.log`, `n-final-ui-types.log`); final own changes are being rechecked. No root package-lock edits or git mutations. Engine temp stayed default C:.

### Screens and ownership

Twelve author phone captures: `results/n-{en,hi}-{light,dark}-{write,source,results}-390.png`, all viewport/scroll width 390/390 in `results/n-shots.log`. Inspected EN light Write and HI dark Results with no overflow or clipping found. The fixture uses a synthetic test confirmation only to populate reported history and restores production rule null before rendering. Vite and Chrome were stopped. Temporary `app/ui/newsletter-review.{html,tsx,css}` remains only until independent visual review; remove before commit.

Owned files: `playbooks/newsletter-studio/*`, `delivery/harness/tools-newsletter-studio.ts`, `build/catalogue/newsletter-studio.ts`, `fake-newsletter-studio.ts`, `fake-newsletter-ai.ts`, `newsletter-metadata.ts`, `Newsletter*.tsx`, `newsletter-types.ts`, `NewsletterStudio.module.css`, newsletter UI text and own tests. Narrow shared hunks: network Forget callback; current newsletter final-check input in draft-checks/runs; private/consent generic-run gate in fake-work/runs; newsletter HANDOFF mode; kit metadata import and own fixture rows; kit parity test own ID; own hi-review entries. No other package changes are intended.

Final engine type refresh (`n-handoff-engine-types.log`) encountered only the concurrent tender test syntax at lines eleven/fifteen, so no new final engine type pass is claimed from that attempt. The integrator was notified. Prior engine type checkpoint passed.

## Independent review closure, 29 October 2026

Independent reviewer seller_f2: Stage 1 spec PASS, Stage 2 quality PASS. Reviewer reran the complete focused engine selection, 37/37 (`n-independent-final-engine.log`), and own focused UI/fake selection, 10/10 (`n-independent-final-ui.log`), and inspected English light Write and Hindi dark Results at 390 px. Author results are separate: 37/37 engine and 35/35 UI/fake/text (`n-reviewed-engine.log`, `n-reviewed-ui.log`); both typechecks passed in `n-reviewed-engine-types.log` and `n-reviewed-ui-types.log`.

Five required findings closed:
- The first eligible slice, not the whole list, supplies visible checks. Cumulative exported recipients plus the next slice cannot exceed the issue's saved allowance. State/fake behavioral REDs (`n-review-allowance-red`, `n-review-allowance-fake-red`) then GREEN 6/6 and 5/5; the actual owner Review export button is covered.
- Forget selects source notes, draft, source evidence and exact AI request text by names or handles even before any subscriber import. Linked opaque model payloads are erased and usage retained. Real and fake source-only regressions failed first (`n-review-notes-tags-red`, `n-review-notes-fake-red`), then passed. `privacy-text.ts` is the shared browser-safe selection helper.
- Sponsor and sender configuration refuse unresolved template syntax. Personalisation remains limited to subject, preview and body. The sponsor case failed before repair. Field-specific plain-word instructions remain localized, including the actual tool name.
- Owner price totals use Figure with a reachable receipt mark; editing any price/count hides the saved total until recalculated. Absent Figure failed first. A controlled temporary mutant restoring the stale total independently failed the dirty-input regression and was restored in finally.
- Fake AI and export use real refusal ordering for multi-invalid requests. Private/stale AI failed before repair; a controlled export-order mutant separately failed. `n-review-receipt-order-red` and `n-review-export-dirty-mutant` record these failures, with the latter exactly two failed and nine passed. Restored sources passed.

The root harness inventory exposed missing newsletter refusal-code declarations, then PRIVATE_NEEDS_LOCAL. Exact emitted codes were added as a narrow VENTURE_ERRORS hunk; targeted static harness passes 1/1 (`n-harness-errors-green.log`). This is declaration integration, no refusal behavior change.

Final price receipt phone recapture is pending a concurrent tender browser dependency repair: fake-tender-files -> tender export-core -> money/export -> runtime/contracts pulls node:crypto into Vite. Root owns that fix. Earlier valid screenshots remain reviewed; no failed page is claimed as a product capture. Whole-wave gates, cold visual review, final words and PR remain root-owned.

- Final newsletter housekeeping: the tender browser leaf was repaired by its owner. Fresh `n-{en,hi}-{light,dark}-prices-390.png` captures succeeded at390/390 (`n-price-shots.log`); author inspected Hindi dark, including the receipt mark beside INR 3,990.00. Vite and Chrome stopped; the three temporary newsletter review harness files were removed. N is frozen for integrator extraction.

Final integration follow-up: source and pending approval are checked again synchronously immediately before model transport. The review test changes order privacy inside model preparation and sees zero dispatch; actual RED observed one. Nearby newsletter/tender/translation29/29, separate seller_f2 spec/quality PASS. Evidence: results/w5-root-source-guard-{red,green,nearby-final}.txt. This package inherits the reviewed shared guard seam from the earliest J1 commit.
