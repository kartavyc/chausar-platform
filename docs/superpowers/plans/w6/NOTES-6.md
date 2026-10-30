# Wave 6 working notes

## Execution agreement

- Started 30 October 2026 from wave 5 commit `29c20321` on `b2c/ink-v2-w5`; working branch `b2c/ink-v2-w6`.
- The persistent chat goal covers all 57 packages through Batch 10 and the pull request. Stop after Batch 2 for the founder's review. Do not push until the founder authorizes it; never merge.
- The founder's chat instruction overrides PACKAGES.md's generic stop after each batch: report here and continue, except the Batch 2 review gate or an unfixable broken build/test batch.
- Only the integrator commits. Helpers investigate, implement assigned files, and review cold. Secrets stay outside the repository in `C:\Users\karta\.chausar\w6.env`, loaded only for live checks.

## Batch 0 / 6-0: complete

### Scope and review

- Read AGENTS.md, DECISIONS.md, PACKAGES.md, REVIEW.md, then all six reference HTML screens and their structural behavior. The hybrid About-you screen changes on Send, not typing. Bracketed examples are not product data.
- `IMPACT-MAP.md` inventories every package, current files/tests, and shared integration boundaries. D36 crosses several packages rather than having a dedicated package.
- Created the requested plan commit first, then amended that same local package commit with the baseline evidence. Identity: `kartavyc <263844514+kartavyc@users.noreply.github.com>`. No push.
- This package changes planning/evidence only. A new failing behavior test is not applicable. No product behavior has changed.
- Cold review found no content blocker in the plan or impact map. No secret-pattern or em-dash matches were found there. PROMPT.md contains public SSH material and VPS administration details; review privacy before publication in 6J3.
- Root package-lock.json remains untracked and must never be committed. Stage explicit evidence files; no browser profiles/cache.

### Baseline results

| Check | Current result | Evidence |
| --- | --- | --- |
| Engine typecheck | Passed | results/w6-baseline-typecheck.log |
| UI typecheck | Passed | results/w6-baseline-typecheck-ui.log |
| Syntax and JSON | 2,892 files passed | results/w6-baseline-check.log |
| UI build | Passed, existing non-fatal large-chunk warning | results/w6-baseline-build-ui.log |
| Full UI tests | 2,977 passed, one timeout, 2,978 total in 297 files | results/w6-baseline-ui-final.log; app/ui/results/w6-baseline-ui.vitest.json |
| UI timeout isolation | team-persona file: all 14 passed, no code or timeout change | results/w6-baseline-ui-team-persona-rerun.log |
| Engine shard 1 | Quiet rerun: 1,323 passed; no failures/cancellations/skips/todos | results/w6-baseline-engine-1-quiet.json |
| Engine shard 2 | 1,315 passed; no failures/cancellations/skips/todos | results/w6-baseline-engine-2.json |
| Engine shard 3 | Quiet rerun completed: 1,491 passed, one documented local document mismatch; no cancellations/skips/todos | results/w6-baseline-engine-3-quiet.json |
| Engine shard 4 | 1,452 passed; no failures/cancellations/skips/todos | results/w6-baseline-engine-4.json |
| Engine shard 5 | 1,298 passed; no failures/cancellations/skips/todos | results/w6-baseline-engine-5.json |
| Engine shard 6 | 3 passed; no failures/cancellations/skips/todos | results/w6-baseline-engine-6.json |
| Current-screen walk | 488 checks over 113 cases, zero reported problems | reference-ui/current/report.md; report.json; index.html |

- Engine tests keep the default C: temporary folder. The original restricted shard 1 encountered writer-lock hard-link EPERM and local fetch errors, then timed out. Retain its original report at results/w6-baseline-engine-1.json. Elevated shard 1 also reached the deadline while workspace-activation-public.test.ts exceeded its outer timeout. The quieter full rerun passed all 1,323 tests, including that activation file, without changing code or timeouts.
- Shard 3 reported the documented architecture.md copied-as-is mismatch against the founder's older external working file. It later timed out while still advancing through workspace-backup-activation.test.ts, with files remaining. The quiet rerun completed all 1,492 tests with only that existing mismatch. Both timeout reports remain available; no code or deadlines were changed to obtain the completed runs.
- Initial UI attempts stalled with zero collected tests under restricted temp. The UI-only diagnostic passed 11/11 using results/w6-ui-temp. The completed full UI run used that folder and one worker. Its one team-persona timeout occurred during simultaneous baseline work; the isolated rerun passed after screen capture finished. Engine temp settings were never changed to D:.
- The initial restricted screenshot launch failed. A four-worker elevated retry was stopped when physical memory fell below 0.5 GB; only its owned process tree was stopped. The completed retry used one worker, CDP 9481, profiles in results/w6-shot-profiles, and output in reference-ui/current/. Old generated profiles inside current/ were removed after verifying their absolute path and stopping their owned processes.
- Screen evidence contains 480 unique PNGs and eight focus checks, approximately 94 MB. All referenced images exist and no profile/cache directory remains. Cold review found zero reported axe violations, console errors, or accepted exceptions and inspected representative Today, onboarding, Money and run-sheet screens in both themes and desktop/phone sizes.
- Capture limits: 470 contrast nodes were undecided automatically, and 21 captures reached the 9,000 px height cap. This is a bounded visual baseline, not a claim of exhaustive manual contrast review or coverage below that cap.

### Early test-service setup

- The founder signed in to Hostinger, Sentry, PostHog and Telegram. An earlier browser-control turn was stopped because the tool could not verify the Windows browser URL. Browser control recovered in a fresh turn; the account work below subsequently completed.
- Sentry: created the Electron project in the founder's organization and saved SENTRY_DSN externally. The existing trial banner was already active; no paid plan, card, or billing change was accepted. The project dashboard is ready; SDK installation and error-event qualification remain for 6J2.
- PostHog: completed Product Analytics setup and explicitly selected the Free plan. Saved POSTHOG_PROJECT_KEY and POSTHOG_HOST externally. Disabled automatic interaction capture, heatmaps, web-vitals capture and session replay. No unrelated data sources or teammates were added. No SDK or product event is claimed yet.
- Telegram: created the new Chausar Wave 6 Test bot and saved TELEGRAM_BOT_TOKEN externally. An initial DOM copy accidentally included the adjacent word; getMe rejected it. Corrected the copy to the exact visible code element and getMe verified the new bot identity. No token value was printed or logged.
- Telegram's first /start was visible in the browser but absent from getUpdates. The founder explicitly approved one additional harmless setup message. getUpdates returned that one recognized message in one private chat; saved TELEGRAM_CHAT_ID externally. No further messages were sent.
- Secret transfers used private temporary files outside the repository, removed after saving into the specified env file. Values were never printed, logged, copied into the repository, or committed.
- VPS: the founder confirmed the exact four commands again at action time. Ran the requested bracketed-paste setting and all four commands in Hostinger's root terminal. Strict host-key SSH from this PC returned fable with exit code 0. Closed the root console. No other server settings or packages changed. The separate chausar-test user and Linux dependencies remain for 6J1.
- Razorpay is skipped by the founder's explicit instruction. Its integration will be fixture-tested unless that instruction changes.
- Setup screenshots are in ignored results/w6-sentry-ready.png, w6-posthog-ready.png, w6-telegram-ready.png and w6-vps-configured.png. Telegram proof excludes other chats and the token.
- Account setup does not qualify later service integration packages as live-tested. No founder input is pending for these completed setup steps.

### Read-only preparation

- 6A1 must remove desktop's production Postgres dependency in the worker, engine admission and desktop startup, not merely change labels. Keep the production calculator receipt verification. Existing vault crash coverage kills after a completed save; add a real mid-save termination test.
- 6A3 requires a validated model country output: the current decide schema has none, and Start uses template preview. Preserve explicit owner selection and never substitute a language setting or keyword guess for the agreed AI reading.
- 6A4 has independent absent-to-pending defaults in env parsing, direct hosts, the model port and CLI status. Pending must hide Claude offers and reject direct execution.
- 6A5 has silent enforcement clamps in posting, outreach and the write governor. Prove a raised setting is actually enforced, while keeping exact approvals and hard stops.
- Suggested Batch 1 partition: root 6A1; helpers 6A2, 6A4 and 6A5 as slots permit. Then 6A3 after 6A2; broad wording 6A6 after Claude/caps copy; 6A7 after English and wording rules. Integrator reserves shared contracts/types/central dispatch and budgets.
- Claude Code 2.1.286 is installed at the standard user-local executable path, confirmed by --version. Its Batch 2 driver therefore needs a live run; installation absence is not a fixture-only reason.
- Exact installed Codex 0.154.0 protocol is generated in ignored results/w6-codex-protocol. No model run or auth-file read occurred. Drivers must prove job-folder read confinement, route outside-effect app approvals to the owner, correlate approval items to exact arguments, and use ephemeral sessions plus Chausar-owned restart checkpoints rather than claim durable native resume with history disabled.

- Batch 2 protocol check: the installed schema gives input requests thread/turn/item IDs but no tool arguments. Correlate with the matching MCP item before an exact owner approval; unresolved identity must refuse. A server-suggested automatic answer timeout never authorizes an outside effect, and resolved/interrupted requests invalidate old approvals. Keep explicit requested models instead of opting into provider model fallback. Sources: installed generated types; [official app-server protocol](https://learn.chatgpt.com/docs/app-server) and [automatic approval review](https://learn.chatgpt.com/docs/sandboxing/auto-review). Automatic review needs an interactive approval policy and does not replace the permissions boundary.

### Batch 0 report

- Baseline coverage is complete: all six engine shard inventories ran to completion, 6,882 passed out of 6,883. The sole failure is the pre-existing local architecture-document comparison explicitly documented in AGENTS.md. No product code changed, so this is recorded as a baseline failure rather than a new regression. No tests were skipped or cancelled in these completed runs.
- UI: 2,977 of 2,978 passed in the full run; the one timed-out file then passed all 14 tests in isolation, without changes. Both typechecks, syntax validation and the UI build passed. Final pre-commit check logs use results/w6-0-final-*.log.
- Screens: 488 checks, zero reported problems; all 480 screenshots and the three reports are staged under current/. Cold review verified coverage, limitations, staging and secret-pattern checks. Historical Hindi screens remain as the requested pre-change reference.
- Live setup: Sentry, PostHog, Telegram and VPS are ready. Razorpay is skipped at the founder's request. No feature package is described as live-tested merely because its account now exists. There are no fixture-tested feature implementations in Batch 0.
- Plan adjustments: used a single screenshot worker and a separate UI temp folder to keep this machine stable. Engine tests always used C: temp. Preserved interrupted reports, then reran under lighter load. A helper capacity error required the integrator to finish the sequential engine runs.
- Founder input: none needed to begin Batch 1. Later founder-only items remain as listed in DECISIONS.md, including the OpenAI access form and any service account not covered by the completed setup.
- Next: Batch 1 foundations, with failing tests before implementation and separate reviewed package commits. The mandatory founder review remains after Batch 2. Nothing has been pushed or merged.

## Batch 1 work

### 6A1: desktop storage

- The desktop worker now selects encrypted file storage with demo mode off. Desktop startup no longer launches bundled PostgreSQL. Other hosts retain their existing storage requirements, and the hosted tier retains the practice label. Existing preview-install restrictions remain until the packaging work in Batch 10.
- Red first: the worker selected PostgreSQL; non-demo desktop creation refused file storage; desktop startup launched a database; the invoice and UI still showed practice/experimental labels. Evidence: results/w6-6A1-red.log, w6-6A1-desktop-red.log, w6-6A1-invoice-red.log, w6-6A1-ui-red.log and w6-6A1-notice-red.log. The existing atomic-save implementation already passed the new crash test and needed no production change.
- Storage evidence: a child process is killed after writing half of an actual encrypted temporary file, before rename. The committed authority remains byte-exact, reopens at its prior revision, and accepts a later save. Backup/restore preserves encrypted business data; recovery replaces the passphrase and rejects the old one. All engine scratch directories are on C:.
- Focused engine checks: 20 storage/startup tests, 21 money tests and 19 worker/server/harness tests passed, 60 total. Exact invoice approvals and code-computed receipts remain unchanged.
- Live check: installed Electron 44.4.5 ran the real worker on a disposable synthetic business with demo mode off. Creation, encrypted backup, restore and recovery-code opening passed without PostgreSQL. The harness stopped and the sample directory was removed. Evidence: results/w6-6A1-live.log. This qualifies the worker/storage path, not the later installer packaging.
- Cold review against REVIEW.md found no actionable issues. An isolated export of the staged package passed both typechecks, syntax/JSON validation for 2,893 source files, 41 storage/startup/money tests and all 53 nearest UI tests. It retained the pre-6A2 Hindi tests, so this commit is independently valid. Evidence: results/w6-6A1-index-*.log. The isolated run caught a misplaced selectively staged test block; its placement was corrected and the complete three-file UI run passed. The working-tree equivalent also passed 51 English-only UI tests.

### 6A2: English-only interface

- Removed Hindi interface catalogues, the language switch, Devanagari fonts and Hindi-only display tests. The translation lookup and English catalogue remain. Client text may still use other languages: sampled Hindi voice text stays intact, and 103 existing Hindi input phrases preserve shipped playbook scope checks independently of interface translations.
- Red first: the two English-only acceptance tests failed before implementation (recorded in the tool transcript). A separate voice regression failed before English system labels were corrected. The shipped bookkeeping scope regression failed twice before input-only phrases were restored. Evidence: results/w6-6A2-voice-red.log and w6-6A2-scope-input-red.log.
- Focused UI checks passed 59/59; voice engine tests passed 11/11; scope checks passed 18/18 and the restored English scope/count/receipt matrix passed 4/4. Final isolated engine validation passed all 129 affected tests. Both typechecks and syntax/JSON validation for 2,893 files passed against the staged package.
- Cold review restored English empty/error and translated-engine-word coverage that had been removed with adjacent Hindi cases. It also verified that Hindi client input cannot bypass the existing scope guard. The isolated UI run caught a copy-exclusion staging error in a chat assertion; an audit found one equivalent approval-card fixture error. Both were restored to their unchanged pre-wave wording.
- Eighteen word budgets were lowered to measured values after the desktop banners and Hindi interface were removed. Original first measurements and the total ceiling are unchanged. Later package wording must fit these smaller limits.
- Full isolated UI acceptance covered 292 files and 2,834 tests: 2,831 passed, with the one chat assertion error above and two posting-contract timeouts. The final staged chat and approval-card files passed all 86 tests in a fresh snapshot. The unchanged posting file passed all 19 tests after the heavier checks finished, without deadline changes. No failures remain unresolved. Evidence: results/w6-6A2-index-ui-full-final.log, w6-6A2-index-copy-corrections-final.log and w6-6A2-index-posting-rerun.log. No outside-service behavior is changed by this package.

### 6A4: Claude Code available by default

- An absent CHAUSAR_CLAUDE_CODE_TERMS now means accepted in environment parsing, direct hosts, the model port, onboarding and CLI status. Explicit pending hides Claude choices and refuses direct connection/execution. Removed obsolete pending-terms customer screens. The fake engine matches accepted but unverified availability.
- Three default-availability regressions failed before implementation. Cold review found no remaining default/pending bypass or package-staging issue. The isolated package passed 146/146 engine tests and 41/41 UI tests, both typechecks and syntax/JSON validation for 2,894 files. Its word-budget run found Connections nine words too long; two already-reviewed AI explanations were shortened by ten words without raising the limit. All 28 final word checks passed.
- Live detection checked the installed Claude Code 2.1.286 version, supported flags and its own sign-in status; explicit pending launched zero commands. That earlier status check reported signed in, while the later 6A3 production inference check reported signed out. No login files were read, no credentials handled, and no successful Claude model task is claimed. Evidence: results/w6-6A4-live.json and results/w6-6A3-live-route.json. The founder has been asked to sign in through Claude Code itself for later driver qualification.

### 6A5: owner-controlled sending limits

- Posting pace, channel outreach limits, warm-up percentages and the write governor accept owner settings above their old defaults. Existing numbers remain defaults. Settings retain exact app approval and natural input validation; a plain warning explains that platforms may ban accounts that send too fast. The view distinguishes the configured cap from a temporary effective cap.
- Regression tests failed before each implementation change, including raised-cap enforcement, direct lead-send calendar parity, preserved long send history and Forget cleanup. The posting log retains all recent entries and minimal first/last timestamps outside the recent window instead of silently truncating at 200 entries. Forget removes the matching client's entries, preserves other businesses and reports storage failures.
- Cold review of the final 41-file isolated package found no actionable issues, including fake-engine parity and selective staging. It passed 91/91 engine tests, 63/63 UI tests including all 28 word checks, both typechecks, and syntax/JSON validation for 2,897 files. Evidence: results/w6-6A5-index-*.log. The initial word check caught a two-word Spend overage; its existing currency explanation was shortened without changing meaning or raising a budget.
- Real local posting-log read/write/removal paths were exercised on disposable data. No external send was performed or claimed; this package changes limits, not the outside-service transports. Earlier wider checks are preserved in results, including one UI timeout whose unchanged isolated rerun passed.
- Follow-up source-rule coverage caught the count-entry form inside the Money directory. Moved it beside the existing posting-limit form and updated imports, with no behavior change. The original guard failed first; the final isolated 60/60 UI checks, both typechecks and syntax validation passed. Cold review confirmed the move is import-only. Evidence: results/w6-6A5-count-component-*.log.

### 6A6: plain words and client documents

- Renamed customer-facing jargon and removed founder-facing lock text across UI, fake responses and engine display words. Removed internal receipt identifiers from client invoice/report HTML, PDF, DOCX, spreadsheet, share and phone copies; private receipts remain available to the owner. Practice word budget shrank from 260 to 250; no budget rose.
- Regression tests failed first for jargon, founder text and client document identifiers. Cold review checked the isolated copy changes and document behavior; a misplaced country/model hunk was removed before qualification. The isolated package passed both typechecks, syntax/JSON checks for 2,899 files and 360/360 engine tests.
- UI qualification covered 589 tests in 29 files, including all word budgets. Ten outdated copy expectations in six files were corrected, including an amount-marker offset after its sentence changed. Those six files then passed all 79 tests; no assertion was removed and no timeout changed. Evidence: results/w6-6A6-index-*.log.
- Live check: installed Electron 44.4.5 printed a synthetic report through the actual print path, producing a 23,376-byte PDF. Its source contains no internal receipt identifiers; external requests were blocked by the print session. The disposable profile and owned process were cleaned up. Evidence: results/w6-6A6-live-print.json and w6-6A6-live-print-final.log. No external client message was sent.

- Full Batch 1 UI validation later found five additional old-wording expectations in shared controls, status words, spend and mailbox tests. These were corrected without changing behavior checks; their five suites passed all 110 tests. The full run covered 299 files and 2,877 tests, with 2,872 passing before these corrections and no other failures. Evidence: results/w6-batch1-ui-full.log and w6-6A6-full-suite-corrections*-green.log.

### 6A3 sequencing decision

- The existing first screen uses a template preview and does not call the AI. The founder chose to complete country suggestion in Batch 1: a small read-only suggestion using the connected AI when available, with owner confirmation before changing the country. Time-zone defaults and manual owner changes remain available. This avoids calling the feature done while deferring its AI-screen integration to Batch 3.
- The founder confirmed post-setup country behavior: preserve historical currencies, use the existing exact plan-edit/accept flow for a country change, and require new prices before new orders. This is recorded as D15a in DECISIONS.md. It brings a bounded part of 6D4 forward: historical country profiles and explicit per-currency calculator totals. No automatic conversion or repricing is allowed.
- Country inference has now passed three actual production Codex route checks on synthetic owner text, including pre-vault and current-vault routing and rejection of client-only locations. Qualification required the missing Windows argument and an explicit owner model override allowed by D11. The planned default remains unchanged, and there is no automatic fallback. The installed tool's model list supplied the explicit model used for the live checks. Evidence: results/w6-6A3-evidence.md and w6-6A3-codex-live-route.json. Post-setup qualification is recorded below.

### 6A3: country qualification

- Time-zone defaults, AI evidence and explicit owner selection are separate. The AI sees only the submitted owner sentence, uses a strict country/evidence schema, and cannot silently change the saved choice. Client-only locations do not select a country. Browser language is never used.
- An accepted country change keeps old orders, quotes, invoices, payments, bank accounts and delivery work in their original currency. New prices are required for new orders. Calculator summaries explicitly scope a currency; historical tax groups have separate receipts. No conversion or repricing occurs. Typed intake amounts use the order currency, including zero-decimal JPY.
- Test-first regressions covered country inference, exact plan acceptance, historical records, mixed-currency exclusions, receipt staleness, account thresholds, forecasts, JPY intake and country-loading errors. Cold review also checked the fake engine and isolated package assembly. Final isolated checks: 328/328 engine tests, 229/229 UI tests including word/source rules, both typechecks and syntax/JSON validation for 2,914 files. Type-only omissions found by compilation were fixed before the final run. Evidence: results/w6-6A3-index-*.log and the detailed inventory in w6-6A3-evidence.md.
- Live: installed Codex 0.154.0 passed three production-route sample checks using an explicitly selected available model, including pre-vault and current-vault calls. The default model was unavailable on this account; it remains the default and no silent fallback was added. Windows calls now include the required unelevated setting. After the founder signed in through the official CLI, installed Claude Code 2.1.286 with Sonnet 5.5 also passed all three production-route checks. The prior signed-out result is preserved; the successful rerun is in results/w6-6A3-live-route.json and w6-6A3-claude-live-signed-in.log. Disposable data was cleaned up. No auth files were read.
- Fake CA coverage preserves the original dedicated demo and handles the changed-country reset, return-to-INR and foreign-invoice exclusions. Full dynamic valid-GSTIN editing is not available through the current fake plan API and is not claimed; native GST calculations remain intact. The bounded historical-currency work brings part of 6D4 forward as documented above.

### 6A7: repository rules

- Added parsed-source guards for browser-language reads in UI code and complete provider-shaped key literals in fixtures, including template chunks. Diagnostics show only paths and provider names, never matched values. The scan stays inside repository source/test folders and ignores links.
- Red-first checks failed before implementation and before template-chunk coverage. Replaced 22 fixture literals with runtime string fragments across 15 files; cold review independently verified all 15 files have identical evaluated syntax after folding those fragments. No runtime fixture value changed.
- Final isolated validation passed 57/57 engine tests, including all four rule tests and the nearby model/secret suites, both typechecks, and syntax/JSON validation for 2,916 files. The first typecheck found a missing declaration for the JavaScript checker; its three exported signatures are now declared and reviewed. Evidence: results/w6-6A7-index-*.log. No outside service is used by this package.

### Batch 1 report

- All seven packages are implemented, cold-reviewed and committed separately. Every package has red-first evidence, passing nearby tests and required compile/syntax checks recorded above. The final country package passed 328 engine and 229 UI tests; final repository-rule checks passed 57 engine tests. Counts overlap and are not added into a misleading total.
- Full UI validation covered 299 files and 2,877 tests. It passed 2,872 initially and found five old-copy assertions; the corrected five suites passed all 110 tests without removed assertions or raised deadlines. No failure remains unresolved. Both final typechecks, syntax validation and the production UI build passed. Evidence: results/w6-batch1-ui-full.log, w6-batch1-ui-build.log and the five-suite correction logs.
- Live checks passed for encrypted desktop storage/backup/recovery/crash behavior, actual Electron report printing, installed CLI detection and country inference through both signed-in Codex and Claude Code. Harmless disposable data was used. No client message, payment or other external business effect was performed.
- Plan adjustment: D15a, now explicitly confirmed by the founder, requires preserving historical currencies and confirming new prices after a country change. Its necessary calculator/history work brings a bounded part of 6D4 forward. Fake valid-GSTIN editing remains outside its current reachable API, as described in 6A3; native GST is intact. No word budget increased.
- Founder input: no item blocks Batch 2. Claude is now signed in and live-qualified for the country route. Razorpay remains skipped by request; later founder-only inputs remain tracked in DECISIONS.md. Account setup alone does not qualify later service features.
- Continuing into Batch 2. The mandatory stop for founder review is after Batch 2, not here. Nothing has been pushed or merged.

### 6B2: installed Codex driver

- Added the app-server JSON-RPC transport and a scoped driver with streamed progress, interruption, serial continuation, guarded credential injection, usage reporting and cleanup. Shared driver contracts land here so both installed-tool adapters use the same boundary. Delivery activation follows in the Batch 2 integration commit.
- Test-first evidence includes missing-module failures, policy rejection, duplicate event handling, continuation usage and shutdown regressions. The final driver/RPC suite passed 15/15 before package isolation. Cold reviews found and fixed the duplicate completion issue, then passed.
- Real Codex 0.154.0 ran harmless synthetic work through Chausar's authenticated MCP bridge. It read only attached data, used calculator receipts and proposed a draft for approval. The available account model was explicitly set to gpt-6-astra; product defaults remain those in D11. No outside send or authentication-file read occurred. Evidence: results/w6-6B2-live.json and the later normal-route results/w6-6B8-final-live.json.
- This Windows version cannot enforce native restricted file reads in unelevated execution. The qualified boundary disables native file/shell/patch/image/browser tools and uses the scoped Chausar MCP surface. Actual installed-tool probes refused native commands, patches and outside skill-package reads; this is not claimed as OS filesystem isolation. Shell requests fail plainly. Eleven canonical tool names include reserved external proxy names implemented by the settings package. Evidence: results/w6-6B2-native-skill-denial.json.
- Key transport was exercised with the installed runtime against a synthetic local provider. A real billed OpenAI API key is missing, so that provider route is fixture-tested. No key value or login token is stored in these notes.

### 6B3: installed Claude Code driver

- Added the Claude Agent SDK 0.3.286 adapter using the owner's installed Claude Code 2.1.286 and its own login. The tool owns its loop; Chausar supplies the job boundary, scoped MCP server and exact outside-effect approval callback. Shell is unavailable, file tools remain confined to the disposable job directory, and project instructions cannot authorize outside actions.
- Meaningful failing regressions preceded permission, file/junction, continuation, usage and interruption fixes. The focused driver suite passed 14/14 before isolation. Cold review checked consent revalidation at dispatch, bounded file access, abort handling and cleanup. The later Batch 2 assembly activates this adapter through saved owner settings.
- The founder completed Claude's own sign-in. Real installed-tool checks passed four cases: native MCP work, file boundary, interruption and same-session continuation. No login file or token was read or copied. Evidence: results/w6-6B3-claude-live.json and helper evidence recorded in this batch. The API-key variant remains fixture-tested because no billed Anthropic API key is available.

### 6B1: scoped Chausar toolbox

- Added the run-scoped MCP service, authenticated local broker and stdio bridge, revocable job capability, nine engine-owned reading/calculation/drafting/proposal tools, and current client/order context projections. Tool responses are marked untrusted data. Other clients' files, stale capabilities, changed sources and unverified draft numbers are refused.
- A held or screened calculator result cannot authorize unseen draft text. Only successful screened results establish numeric and structural evidence. Scoped file metadata authorizes an attached filename, never the file's numerical contents or another client's file. Calculator receipt values remain code-owned and byte-exact through screening.
- Test-first evidence covers the missing toolbox, source and capability isolation, held calculator authority, unsupported amounts and attached versus foreign filenames. The isolated candidate's five focused suites passed 19/19 with a clean transitive type check before the integrator's full package checks. Cold reviews checked the tool and data boundaries.
- This commit introduces the toolbox and its host projection leaves. The native record adapter, Today cards, consent enforcement and session coordinator are connected together in 6B6 so no intermediate commit runs a partially assembled delivery path. Those integration hunks complete 6B1 rather than introduce separate scope. The actual installed Codex and Claude checks and final 6B8 normal-route run exercised the complete toolbox on harmless data, with exact local handoff approval and no outside send.

### 6B4: protected keys and reported usage

- Keys persist through Electron safeStorage in workspace-bound encrypted files, with a private worker relay and no renderer read API. Connect waits for persistence; disconnect removes the key; lock and failed-save paths roll back. Plaintext or unavailable Linux protection is refused. Actual Windows Electron encryption, restart reload, workspace isolation and deletion passed using a harmless synthetic value, followed by cleanup: results/w6-6B4-live.json.
- Added the OpenRouter Responses preset with an explicit model and owner-editable exact model/cache prices. RapidRouter remains planned pending the founder-only written company/retention confirmation. No actual billed OpenAI, Anthropic or OpenRouter key is available, so those routes are fixture-tested. The installed Codex API transport was tested against a synthetic local Responses provider.
- Native usage accounting uses provider-reported token counts, exact model rates and BigInt receipts. Key jobs reserve the remaining owner allowance atomically across monthly, daily and agent limits; plan jobs reserve nothing. Missing, mismatched or unpriced usage remains held and unknown. Provider calls may incur cost before reporting, so this is not represented as a provider-side hard ceiling. Every quality retry belongs to the same job and reuses its original charge.
- Test-first regressions cover protected storage, failed persistence, workspace separation, gateway/model binding, pricing, cache semantics, cumulative usage and late forgotten-call text. The extracted candidate qualified 49 native checks and two gateway/price-editor UI checks with clean focused engine/UI type graphs. Normal local access was required for the encrypted-file and localhost fixtures; no code workaround was added for restricted-environment failures.
- This commit supplies key storage, pricing and accounting independently. Driver selection and job/quality billing hooks are assembled in 6B6 and remain credited to 6B4. Client permission, AI settings, external MCP credentials and removal of old previews land in their own packages or the coordinated activation commit. No real key value is in code, notes or fixtures.
