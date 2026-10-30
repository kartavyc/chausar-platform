# 5P ownership and review manifest

Independent whole-package spec/quality PASS, subject to final author checks as recorded in NOTES-5P.md. This manifest separates P edits from other agents in the shared checkout. No git mutations by this author.

Owned implementation:
- `platform/runtime/venture/playbooks/website-studio/` all implementation, definition, metadata, rules, Hindi and baseline files, including new `preview-schema.ts`, `ui-contract.ts`, `intake-core.ts`, `release-evidence.ts` browser-safe leaves.
- `platform/runtime/venture/delivery/harness/tools-website-studio.ts`.
- `platform/runtime/venture/build/catalogue/website-studio.ts`.
- `app/ui/src/places/work/desks/WebsiteStudioDesk.tsx`, `WebsiteStudio.module.css`, `site-types.ts`, `SiteChecks.tsx`, `SiteSource.tsx`, `SitePagePreview.tsx`, `SitePreviewFrame.tsx`, `SiteForms.tsx`, `SiteRelease.tsx`.
- `app/ui/src/engine/fake-website-studio.ts`, `fake-website-ai.ts`, `fake-website-import.ts`, `website-metadata.ts`.
- `app/ui/src/text/{en,hi}/pb-website.json`.
- `platform/tests/venture-site-*.test.ts` except pre-existing `venture-site-edits` and other unrelated older tests; new own names are ai, baseline, catalogue, ci-transport, cloudflare, desk, form-capture, foundation-review (root authored), frame, preview, release, release-public, requirements, screen-flow, ui-report.
- `platform/tests/venture-playbook-website.test.ts`, `hosted-site-form.test.ts`.
- `app/ui/tests/engine/fake-website.test.ts`, `fake-website-public.test.ts`, `fake-site-brief.test.ts`; `app/ui/tests/places/site-checks.test.tsx`, `site-preview.test.tsx`, `site-owner-state.test.tsx`, `site-release.test.tsx`.

Narrow shared edits:
- `platform/runtime/venture/build/brief.ts`: current blueprint screen-flow text; explicit observed CI artifact contract.
- `platform/runtime/venture/build/connectors.ts`: only website-cloudflare available write and website-public-site available read.
- `platform/runtime/venture/build/playbook-guides.ts`: only those two guides.
- `platform/runtime/venture/contracts.ts`: site session credential prefix and exact SITE public refusal code inventory. Existing website record aliases remain the 5-0 hook.
- `platform/runtime/venture/delivery/runs.ts`: private website preflight and current dossier supplied to final source check.
- `platform/runtime/venture/playbooks/draft-checks.ts`: optional current site project in check context.
- `platform/runtime/venture/playbooks/index.ts`: lazy hosted form entry export.
- `platform/runtime/venture/network/forget.ts`: eraseSiteNaming hook with optional secrets.
- `platform/runtime/venture/host.ts`: trusted site-form public token dispatch.
- `platform/runtime/hosted/app.ts`: site-form token recognition, directory index/unindex on owner configuration, rate-limited trusted public entry.
- `platform/runtime/hosted/server.ts`: route for the scoped first-party form, plus CSP change below.
- `app/ui/src/engine/fake-w4.ts`: internal siteCaptureClient hook.
- `app/ui/src/engine/fake.ts`: minimum captured client plus network identity hook only.
- `app/ui/src/engine/fake-network.ts` and `fake-people.ts`: small internal captureSiteClient method; no relationship facts or messages invented.
- `app/ui/src/engine/fake-work.ts`: website private/legal preflight only.
- `app/ui/src/engine/fixtures-business.ts`: code-written default screen flow and observed CI artifact instruction in templateBrief.
- `app/ui/src/engine/fake-kit-plans.ts`: WEBSITE_META import/list entry.
- `app/ui/src/engine/fixtures-kit-plan-picks.json`, `fixtures-playbook-picks.json`, `fixtures-start.json`: generated website registry/plan/gallery entry from actual definition. Root refresh script used for Start.
- `app/ui/src/text/{en,hi}/pb-connector-guides.json`: only two website guide key groups. `hi-review.json`: only new P machine keys and engine Hindi paths.

Security-sensitive CSP changes, all need independent inspection:
1. `platform/runtime/hosted/server.ts`: style-src self data; frame-src self blob. Other directives unchanged.
2. `app/desktop/main.cjs`: style-src self data; explicit frame-src self blob. Other directives unchanged.
3. `app/ui/vite.config.ts`: same change in production meta CSP.
4. `preview.ts`, `preview-schema.ts`, `SitePreviewFrame.tsx`: complete validation, bounded encoded stylesheet, child default-none policy, inert links/buttons, empty iframe sandbox and document URL cleanup. No unsafe-inline, script, form, same-origin or navigation grants.

Review evidence and honest provider deviations live in NOTES-5P.md. Production screenshots and logs are under results and are ignored. Temporary `app/ui/site-review.html` and `app/ui/src/site-review.tsx` were temporary capture harnesses and have been removed. Root owns all whole-wave gates, the final walk, baseline decisions and PR.

Shared prerequisite: the synchronous ModelPort beforeDispatch option and four reviewed regressions may already land with J1. The P isolation draft detects inherited changes, otherwise includes only this reviewed seam.

Final browser leaf repair: `network/normal-email.ts` holds the exact unchanged normalEmail and HIDDEN/FORMULA constants formerly in extract-core.ts. `network/extract-core.ts` imports those and keeps its original normalEmail export. P form-capture imports the leaf so fake UI does not load the native contract graph. Existing network extractor and website source tests verify behavior; isolated builder includes this narrow move.
