# 5K2 owner setup integration

Provider setup adapter and pinned transport scope were independently reviewed by root (see NOTES-5K2-ZOHO-SETUP.md). This increment connects the actual owner desk, exact source mappings, durable writes and readback, bilingual screens, and honest demo refusal. Full wave/package acceptance remains with root.

## Behavior and limits

The existing setup CSV and finance receipt stay authoritative. Every source customer, vendor and category receives an exact owner mapping with fixed source ID/name and explicit stable provider number/code, INR currency ID, account classification or customer/vendor GST treatment/state. Zero contact opening balance is the supported profile. The provider proves absence before creation; matching existing masters are shown as existing and reread before adoption. No automatic category, tax or contact identity is invented.

Master creation and organization-wide opening balances require separate exact approvals. Opening lines use the actual read-back category IDs and original source paise; the owner chooses the migration date. Existing organization migration balances are never overwritten or repeated each cycle. Reconnecting after completed masters allows a fresh opening proposal only after all masters are reread and match their recorded identities. Approved provider requests contain no token. Source, live consent, client/cycle/company, session and claim digests are checked before physical transport. Every outside effect has a durable stable organization/identity journal subject. Saves compare the expected record; interrupted or unknown work offers no resend. Recovery only projects settled journal outcomes, never writes remotely.

Unsupported Tally installations, AR/AP allocations, inventory, FX, nonzero contact openings or unsupported setup profiles use the manual bookkeeper handoff. No real provider capture or live-account qualification is claimed. Demo uses the same source/mapping validation and returns BOOKS_READ_FAILED at its first remote evidence boundary, without a fabricated proposal or successful write.

Existing generic finance Forget removes the setup record, nested mappings/prepared requests, original source upload, code receipt and session secret. Setup does not introduce separate mapping uploads or new receipt records.

## Test evidence

- Test-first missing module RED: results/w5-k2-setup-flow-red.txt.
- Public route NOT_BUILT_YET RED: results/w5-k2-setup-public-red.txt.
- UI missing component and demo NOT_BUILT_YET RED: results/w5-k2-setup-ui-red.txt.
- Extra adversarial opening readback RED: results/w5-k2-setup-readback-red.txt. A claimed digest with wrong date/empty lines previously completed; exact field and account-amount comparison now refuses it.
- Final engine setup flow6 + public1 + provider11 + transport4 = 22/22: results/w5-k2-setup-engine-final.txt.
- Focused setup UI3 + fake1, nearby finance/posting, text, source rules, accessibility and budgets: 244/244, results/w5-k2-setup-ui-final.txt. No word baseline raises.
- Engine typecheck exit0 in results/w5-k2-setup-types-engine.txt. UI final check recorded separately after unknown-ID type correction.
- Screens inspected: results/w5-k2-setup-shots/setup-1280-light-en.png, setup-390-dark-en.png, setup-390-light-hi.png. All width checks match viewport, no missing setup keys, axe WCAG2A/AA violations0. These are explicitly synthetic owner-view fixtures, not evidence of live provider access. An earlier unreachable-preview capture was rejected and overwritten after the actual UI loaded.

## Ownership manifest

New engine integration: platform/runtime/venture/build/accounting-setup.ts, accounting-setup-state.ts; playbooks/bookkeeping-cfo/setup-posting-core.ts, setup-posting-types.ts, setup-desk.ts. New browser-safe provider extraction: adapters/accounting/zoho-setup-validation.ts; zoho-setup.ts only moves unchanged validateMaster logic to this import for demo parity.

New UI: BooksSetupPosting.tsx, BooksSetupConnection.tsx, BooksSetupMappings.tsx; engine/fake-books-setup.ts; text/en/pb-books-setup.json, text/hi/pb-books-setup.json. Tests: platform/tests/venture-books-setup-flow.test.ts, venture-books-setup-public.test.ts, fixtures/venture/zoho-setup.ts; app/ui/tests/places/books-setup-posting.test.tsx, engine/fake-books-setup.test.ts.

Narrow shared hunks: bookkeeping-cfo/records.ts optional setup.entry.posting type; desk.ts SETUP_DESK import/type intersection/spread; journal/action-extras.ts operation strings books-setup-master and books-setup-opening. BooksFinance.tsx import and selected-setup child only. fake-books-posting.ts requireConnection method only (root owns requireMapping change); fake-books-finance.ts setup import and returned kind hook; fake-bookkeeping-cfo.ts setup kind; hi-review.json own pb-books-setup keys. Existing root settlement imports/hooks are preserved.

Additional root-requested connector guide correction: new build/zoho-books-guide.ts and venture-books-connector-guide.test.ts; guides.ts import and HAND zoho-books entry. RED w5-k2-guide-red.txt then GREEN w5-k2-guide-green.txt. Localized current-connector UI guide is being completed separately and is not yet part of this settled setup review.

Independent spec and quality review pending. No git mutations performed.

Review closure: batch1_verify independently reports STAGE 1 SPEC PASS and STAGE 2 QUALITY PASS for the bounded setup integration. Closed its stale-resource UI finding test-first: a previously loaded receipt or connection refresh error left an old approval enabled; results/w5-k2-setup-stale-review-red.txt reproduces both. Approval now checks loading/errors for all evidence, selected row identity and exact receipt identity, and the handler independently refuses locked stage/apply actions. Recovery retains its local journal-only path. Independent engine flow/public7/7 (k2-setup-independent-engine.txt), UI/fake6/6 (k2-setup-independent-ui.txt), and a public Forget reproduction (k2-setup-independent-forget.ts/.txt) confirmed staged setup, upload, receipt and session deletion with zero writes. Reviewer inspected dark and Hindi phone screenshots without finding a layout defect. This is increment acceptance, not full K2 acceptance.

UI final typecheck before the guide addition: exit0, results/w5-k2-setup-types-ui-final.txt. Both temporary preview files were removed and the owned preview server/Chrome stopped.

Guide localization manifest: app/ui/src/places/connections/BooksGuide.ts (new helper), Guide.tsx (optional connectorId and localized copy), index.tsx (pass current card ID), text/en/pb-books-guide.json and hi/pb-books-guide.json plus own hi-review keys. Original guide missing-setting and checkedOn evidence remain unchanged. New app/ui/tests/places/books-connector-guide.test.tsx observes Hindi, preserves the live missing setting, and excludes original English provider guide prose. Correct RED in w5-k2-guide-ui-red.txt. Engine guide copy matches its English localization. Guide checks truthfully say fixture-tested, separate exact approvals, session credentials, no agent direct send, no automatic retry, and manual unsupported profiles.

Final guide and review-fix verification: setup UI, Hindi owner guide, existing connection guides and text37/37 in results/w5-k2-setup-review-ui-final.txt; UI typecheck exit0 in results/w5-k2-guide-ui-types.txt. Root will run the final shared engine/build/batch gates. All owned implementation is frozen pending full K2 audit findings.
