# 5P website builder working notes

29 October 2026, implementation by social_review. Registered with owner desk ready; final author checks and whole-package independent review remain pending. No Git mutations. Root owns broad gates. Earlier checkpoints below are historical and the latest checkpoint wins.

## Scope and source reading

Read 5P plan, binding rules, shared-file boundaries, BRIEF, REVIEW and current root NOTES. Catalogue WB1 to WB5 plus site-only K23 and their computer-use-builders/second-pass cards read. Current Build brief, lint, GitHub read transport, staged site edits, shared ZIP reader and E1 site report parser inspected. Upstream raw source retrieval succeeded for trycompai/crm release docs/tracking.md; QuantumByte harness, workspace68 AI/flow and cogsend release raw URLs returned cache miss, so do not claim freshly read upstream code for those. Their detailed catalogue cards describe the learned patterns; implementation is original.

Verified current official WCAG2.2 page, Cloudflare Pages create deployment API, branch controls and rollback docs. Key constraint: preview deployments are not production rollback targets. Git branch deploy uses current branch HEAD, while commit_hash is metadata. Safe intended release path is exact Direct Upload manifest of already-uploaded immutable assets: separately approved preview, observed expected-marker health check, then separately approved production deployment of the same manifest, keeping the previous production deployment for exact rollback. Asset uploading/preparing the manifest remains an explicit owner prerequisite. No invented preview promotion API, branch pin guarantee or signed self-update.

Sources:
- https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/create/
- https://developers.cloudflare.com/pages/configuration/branch-build-controls/
- https://developers.cloudflare.com/pages/configuration/rollbacks/
- https://www.w3.org/TR/WCAG22/
- https://raw.githubusercontent.com/trycompai/crm/release/docs/tracking.md

## Current foundation, not complete

- core.ts bounded browser-safe errors/inputs.
- requirements.ts preserves locked owner text, explicit/hidden rows, per-requirement audit evidence, current-file fingerprints, inconclusive separation, counts and computed ship line. Tests RED missing module then GREEN3/3.
- preview.ts rebuilds a bounded typed inert tree, exact field/style allowlists, HTTPS links, rejects whole invalid generations, escaped sandbox-frame HTML, one exact undo state. RED missing module then GREEN2/2 with requirements in p-domain-green.log5/5.
- screen-flow.ts produces actual blueprint page destinations and no invented absent target. RED missing module then GREEN1/1 (p-flow logs). Build brief integration is not yet wired.
- ui-report.ts reads the exact GitHub revision's completed UI lint Actions run and named lintapple-report artifact through an injected read/download port, uses shared bounded ZIP reader, checks four view/theme combinations and actual findings. Missing/incomplete/stale source is not found. RED missing module then GREEN2/2 (p-ui-report logs). Actual transport/UI wiring remains.

## Remaining required work

1. Owner project records and real/fake public desk, exact source/repo/client/privacy identities, actual model preview/confirm for derive/audit/page generation and no model-invented evidence.
2. GitHub actual CI binary-download transport and exact repo snapshot, Build screen-flow integration and parity.
3. Hosted form capture standing approval, current pause/notice/consent, minimum fields and original/latest source, desktop CSV path, Forget and suppression.
4. Exact journalled Cloudflare preview/health/release/rollback provider plus owner connection/intake.
5. Registration/definition/offers/tools/baselines/rules/catalogue, honest host read/handoff capabilities, SiteChecks UI/preview/filters, Hindi, ready and public test coverage.
6. Appropriate nearby tests/types/source/a11y/budgets, actual EN/HI light/dark phone images, separate spec then quality review and fixes. Root handles all commits and full wave gates.

## Owner-path checkpoint

The project desk is now implemented for prepare, exact requirement save/lock, inert preview save/undo and brief approval, plus actual model preview/confirm and immutable repository read. It is still unregistered and has no completed owner UI, so no completion claim. `p-desk-red` failed missing project handler; `p-desk-green`2/2. `p-public-ai-red` failed unsupported action; GREEN4/4 includes private refusal and exact single-use model approval. `p-repo-red` failed unsupported sync; GREEN5/5 reads the exact commit/files through existing GitHub read token and then one actual model-port audit. AI core2/2 in `p-ai-green`; source-excerpt test uses a new unlocked row because a locked row correctly ignores attempted model replacement.

Release safety core2/2 (`p-release-red/green`) now requires exact manifest marker and preview URL, preserves prior production, refuses missing/failed health, and binds the production approval to the whole tested release. Actual Cloudflare provider/journal/connection UI remains required.

Minimum form/source core3/3 (`p-form-green`). The first RED had an invalid multiline test literal, so it is not test-first behavioral evidence. Corrected fixture then a controlled temporary mutant removed consent/origin checks and overwrote original source: all three tests failed (`p-form-mutant`). Original source restored in finally. Hosted route, paused standing configuration, suppression/Forget and actual desktop CSV import remain required.

Official GitHub repository content, commit and artifact REST docs read on build day. Binary artifact download still needs its real bounded transport. `ui-types.ts` keeps browser records free of the Node ZIP reader dependency. No actual client network request or deployment was attempted in tests. Initial engine type checkpoint found one test payload unknown-vs-Json mismatch, repaired in the local test fixture; fresh type validation remains pending for later files.

## Independent bounded foundation review

Root reviewed the settled requirements, typed preview, source/repository/AI identity, CI parser, form domain/HTTP/legal gate and Cloudflare adapter only. Stage 1 PASS and Stage 2 PASS after two genuine reviewer regressions: final merged requirements including preserved locks could exceed 100, and generated font sizes could fall below 12px. Both fixed; independent original domain/host/provider19/19 and fresh requirements/preview/review7/7 in `p-root-foundation-existing.log` and `p-root-foundation-review-green.log`. Author matching7/7 in `p-foundation-review-green.log`. This is not whole-package approval. Release orchestration, later CSV/Forget/public CI changes, registration, fake and UI remain outside that review.

## Later owner-path work, awaiting review

- Hosted form endpoint and directory routing wired through existing trusted host entry. `p-hosted-route-red` reproduced404 before route, then4/4 including existing support rating; `p-capture-red/green` proved named legal review, exact owner setup, actual client/source creation and immediate pause. Provider legal confirmation stays null outside tests.
- Cloudflare adapter2/2 in `p-cloudflare-green`. Initial RED test had a fixture brace defect and is not behavioral evidence. Corrected tests then controlled mutant leaked a token onto the health request and accepted Git-triggered projects, failing both tests in `p-cloudflare-mutant`; restored afterward.
- Real staged release desk now journals a durable claim before each preview/production/rollback write. Explicit pending deployment and unknown outcome states do not claim health or retry writes. `p-release-public-red` missing factory before implementation, GREEN2/2. Additional adversarial review/tests still required.
- Build brief now includes code-generated current blueprint screen destinations. Behavioral `p-build-flow-red` lacked screen flow, then GREEN2/2.
- Actual bounded GitHub CI artifact transport implemented: token stays at fixed api.github.com, exact repo artifact path, explicit signed storage download with no credentials. `p-ci-transport-red` missing module, GREEN2/2. Public owner `ui-check` RED unsupported action then GREEN1/1 in `p-ci-public` logs with real pinned transport fixture, actual ZIP parser and saved source revision.
- Desktop form import RED unsupported action, then GREEN2/2 with hosted regression in `p-csv-public` logs. Exact CSV bytes and current project bind preview approval, every row needs consent, named rule gates import, imported sources retain provenance and minimum client rows. No message is sent.
- Website Forget hook RED retained named project and opaque AI payload, GREEN1/1 in `p-forget` logs. Explicit client/source/model/run/file links are followed; costs remain, preview payloads expire. An initial implementation used a deps reference unavailable inside shared removal callback, corrected before GREEN. Form-source erasure and release concurrency need extra review coverage.
- Engine typecheck `p-release-types.log` passed for the release/brief checkpoint. Later import/privacy additions still need fresh types; no blanket typecheck claim.

## Later independent bounded review and final implementation checkpoint

Root independently reviewed later release, CI and form/privacy paths: Stage 1 PASS and Stage 2 PASS, `p-root-later-boundary-final.log`20/20. The preceding root run independently reproduced both DNS-window write bugs (18/20); author `p-release-dns-red/green` closes both by checking current owner/project/approval/secret/hold synchronously at the pinned sender before any POST. Before-dispatch failure remains not-sent/rejected; after-dispatch uncertainty stays needs-inspection. Root also rechecked erasing order intake and opaque uploads before project preparation, linked model payloads, and session credential deletion. This bounded approval excludes final fake/UI/registration and newer changes below.

- Registered `website-studio` and its four owner-priced offers. Added `gather` before the source-only writer because writing steps do not hold tools, and `approve-preview` before the preview operator because every deployment asks. `form-capture` uses the kit project pricing kind for the add-on, with owner price. Intake adds explicit private-source choice. Definition/baseline RED then GREEN2/2; baseline invokes actual requirements/health guards with corrupt-source refusal.
- `site.requirements` returns the exact current report, checked against every rendered title, heading and body; edited or stale claims fail. `site.uiReport`, `site.flow` and `site.preview` expose saved evidence, never claim a release. Tool RED NOT_BUILT_YET then GREEN. Generic private website runs now refuse before model preview (`p-private-run-red/green`1/1).
- Actual public website care uses E1's guarded checker. Missing owner-installed checker is planned; there is no measured fake success. `p-care-red/green`1/1.
- Shared Build brief now requests the observed CI artifact envelope, exact run/site/viewports and findings, with no static success reports. `ui-contract.ts` is browser safe. The fake template includes the same screen-flow destinations and artifact instructions (`p-artifact-brief-red/green`2/2; fake RED recorded, final rerun pending).
- Real model dispatch uses the new shared synchronous ModelPort guard after its awaited claim/key/probe: current owner, project/client/intake/privacy, request identity/digest and expiry must still match immediately before transport. Public regression `p-model-guard-red` observed one dispatch after pending approval was removed; GREEN1/1 observes zero. Shared seam itself remains root/Q-owned for independent review.
- Fake project and public onboarding now enforce current client/intake, private and unconfirmed-rule refusals. Exact source/AI/edit/capture shapes share pure validators. CSV capacity is checked before creating any client, closing the actual partial-mutation RED. Captured contacts get minimum network identities without invented relationship evidence. Forget removes copied capture sources/records, and one-way identities block reimport across the fake website stores (`p-fake-client-forget-red/green`1/1). No site, CI run or successful health check is invented in demonstration mode.
- Owner UI covers new project, immutable repository reads, current requirements/filter counts, owner edits/locks, exact AI preview/confirmation, generated page preview/undo, form configuration/CSV preview/import, provenance and staged release controls. `WebsiteStudioDesk.ready=true`. State keys include project identity and digest. Editing one panel locks competing panels and project changes until save/discard; the new hosted form destination survives the post-save reload (`p-owner-state-red2`2 failures, then both new tests pass). One old screen test timed out during concurrent load and later passed in the focused fake run; final settled rerun pending.
- New catalogue entries: `website-cloudflare` actual scoped write; `website-public-site` actual public read; `website-form-capture` and `website-form-csv` planned pending a named lawyer. Existing generic hosting labels are unchanged. Two dedicated EN/HI guides added under playbook guides. Catalogue/public error inventory RED then GREEN2/2. All new UI keys and hosted fallback Hindi are native-review listed.

## Preview isolation and actual browser finding

The typed tree is wholly parsed before output. Supported block/style keys, value grammar, depth/node/tree caps, unique IDs, font floor12px and stylesheet limit64000 characters apply before any blob creation. Text is escaped. Links have no href and buttons are disabled. The document has its own `default-src 'none'; style-src data:; form-action 'none'; base-uri 'none'`. The iframe has empty `sandbox`, no allow permissions, no same-origin/scripts/forms/navigation grant and no referrer. Its one document URL is revoked on replacement and unmount.

Actual Chromium showed that an opaque sandbox could not load its parent-origin blob stylesheet: the page rendered in default Times. Replaced that approach with the exact `encodeURIComponent` of code-generated validated CSS in a data stylesheet. This is deliberate, not a relaxed inline-style policy. The parent policies permit data styles and blob frames, but no unsafe-inline or extra script source. Source regressions pin all three enforcement points:
1. `platform/runtime/hosted/server.ts` CSP header.
2. `app/desktop/main.cjs` custom protocol response CSP.
3. `app/ui/vite.config.ts` production HTML meta CSP.

`p-frame-data-red/green` pins exact stylesheet encoding, parser rejection and all policies; `p-frame-nav-red/green` proves links cannot navigate. UI URL lifetime and invalid-tree regressions passed for the first blob implementation; final data-style rerun pending. Production component harness built using the actual Vite configuration, then served under each exact hosted/desktop policy plus the built meta. EN/HI light/dark390 screenshots in `results/p-{hosted|desktop-policy}-{en|hi}-{light|dark}-preview-390.png`; width and scroll width390 in `p-shots-data.log`. Author inspected EN-light and HI-dark styled frames. Root inspected the same captures and gave bounded rendering/visual PASS. This is a real Chromium production-build check under exact policies, not a launched Electron shell; final wave walk remains required.

## Current remaining author work

Await the coordinated check window for settled nearby engine/UI, shared source/text/a11y/budgets and both typechecks. Review final fake exactness, resolve any failures, refresh wider screenshots after spacing edits, remove the temporary review harness, and hand full P to root for independent spec then quality review. Previous bounded reviews do not substitute for whole-package approval. No live client deployment, external model request or real form capture was performed.

## Real schema-gate repair

The final self-check exposed an actual capability defect missed by mocked preview tests: the preview task used an open block object, so shared `assertSchemaSafe` rejected it before model dispatch. `p-schema-red` proves the real schema rejection. `preview-schema.ts` now builds a closed bounded eight-level schema with every property required, optional values represented by null, and a whole-tree normalization followed by the existing safety parser. Unknown fields, bad values, depth/node/byte limits remain fail-closed. All three real website task schemas pass the actual gate; `p-schema-green`3/3. This new slice is outside the earlier bounded root approval and needs final review.

## Final review repairs and settled checks

Root full review found two required fixes. All nine release states now use EN/HI owner language instead of raw internal codes in `data-content`; `p-release-audit-ui-red.log` proves the old literal `prepared` display. Current-source audits now refuse `SITE_AUDIT_CURRENT` in the shared task builder used by real and fake paths, before any new model preview. Existing `siteNeedsAudit` fingerprints decide this, with no separate cache. Real regression `p-audit-current-red.log` failed for missing rejection; `p-audit-current-green.log` passes1/1 and proves an unrelated added file remains current while an observed file change permits a new request. Fake regression and owner button also showed genuine RED (`p-release-audit-ui-red`, `p-audit-button-red`).

Author privacy self-check found that `useResource` retains previous detail data on a failed refresh. After Forget, the removed project's brief and preview could remain visible. `p-owner-forget-red.log` observed the old brief; the desk now requires a current list identity and successful detail/list state, and hides its one-time form destination with the removed project. Fake Forget emits the matching desk refresh event. All three repaired UI/fake test files pass11/11 in `p-review-repairs-green.log`.

Settled engine selection in `p-engine-final.log` passed all53 new P tests. Its four extra pre-existing `venture-site-methods` tests had one restricted local C-temp write result (`needs-inspection`); the exact existing file passed4/4 with normal temporary-file access in `p-existing-methods-unrestricted.log`. This is recorded separately, not reported as a 57/57 initial run. The six public release cases include genuinely pending and unknown outcomes, no resend after uncertainty, and both DNS-time source/Forget races.

## Independent whole-package review

Root reviewer reports **Stage 1 spec PASS, Stage 2 quality PASS** after full current source review and closure of both final findings. Fresh independent boundary files pass23/23 in `results/p-root-final-new-boundaries.txt`; owner/fake UI passes7/7 in `results/p-root-final-ui.txt`. These supplement the earlier independently executed20/20 later-boundary and foundation checks. Reviewer re-read current-audit refusal, all nine localized states, stale Forget visibility, real model schema/dispatch guard and all three CSP enforcement points. No blocker or should-fix remains. This verdict is conditional on settled author checks and removal of temporary capture harness; broad wave gates and final walk remain root-owned.

## Final author evidence and housekeeping

The full nearby UI selection ran253 assertions:250 passed, with only two Hindi text assertions and the shared onboarding word budget failing (`p-ui-final.log`). P glossary/provider-label fixes then passed the complete text file22/22 (`p-text-final.log`). All P owner/fake files, source rules, a11y and dedicated connector guides passed. Shared onboarding measured785 words against330, a rise455; baseline is unchanged and this integration item is handed to root. Every other measured place passed.

Final production harness captures (`p-shots-final.log`) cover EN/HI, light/dark,390px under both hosted and exact desktop CSP, plus1280px previews. Author inspected the Hindi dark release/form region and English light1280 styled preview: no clipping or lateral overflow. All390 measurements are width390/scroll390. The Hindi inspection state reads owner language. Both temporary source harness files were removed; screenshot script stopped its local server and browser in finally. The capture tests policy behavior in Chromium, not an actual Electron launch.

Strict typing found a real undefined-tree initial render edge in SitePreviewFrame: `frame?.tree === undefined` could hold with no frame. `p-frame-missing-red.log` reproduces the null URL crash, and the explicit present-frame guard passes all3 preview tests in `p-frame-missing-green.log`. No unsafe tree reaches URL creation. Other local type repairs only annotate the no-write guard and recorded transport headers; no runtime behavior changes. Engine/UI type reruns await the concurrent D2 parity-test relocation and B3 archive narrowing; prior whole-graph UI errors must not be called P success.

Isolation draft: `results/prepare-5p-stage.py`, Python syntax checked, not yet executed against the future committed base. It copies P-owned files, selects only P fields/lines from mixed files, preserves future base content, includes the reviewed common ModelPort dispatch seam and its four regressions if absent, and fails on ambiguous shared anchors. Root must run and verify the isolated candidate before committing.

Final type-boundary closure: Q author traced the UI native graph through P form-capture importing network/extract-core. Moved the unchanged email-normalization function and its regex constants into network/normal-email.ts; extract-core retains its original export and uses those same constants. Root independently compared the move line for line and gave bounded spec/quality PASS. Existing network extraction plus website form, CI and public desk pass28/28 (`p-leaf-final.log`). Final UI typecheck is clean, exit0 (`p-ui-types-final.log`). Root independently reran missing-preview3/3 in `p-root-missing-preview-final.txt`, retaining full P PASS/PASS.

Settled final engine typecheck also passes, exit0 (`p-types-final.log`). Both types are now green after the leaf and recorded fixture narrowing. P implementation is frozen with independent spec/quality PASS. No harness source, started browser or server remains. The one shared onboarding budget rise is handed to root; no words baseline was changed.
