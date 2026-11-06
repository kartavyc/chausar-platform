# Plan: Chausar Ink v2, wave 5 (playbooks)

## Goal

Every buildable business in the catalogue becomes a playbook a non-technical owner can pick from the Start gallery and run with an AI team: the three flagships deepened (YouTube channel, CA firm, social media agency), and every new business built the same way (SEO and AI-search with local SEO, online seller and seller services desk, support desk, recruiting desk, job-search desk, translation and subtitling, bookkeeping and CFO-on-demand, podcast or video to article, lead generation and appointment setting, newsletter, tender and proposal desk, website builder, narration and audiobooks, and the smaller businesses X1 to X9 that need no outside party's approval). All 130 catalogue rows tagged W5 are placed, plus 22 of the 29 rows tagged Later (two of them in part); the rest are listed under "Not placed" with the reason.

Inputs: the spec `docs/superpowers/designs/2026-10-23-chausar-ink-v2.md` (sections 1 to 3 and 5.8), the master plan `docs/superpowers/plans/2026-10-23-chausar-ink-v2.md` ("How every wave runs", the wave 1 packages as the model, the wave 5 outline), the wave 2 plan (what W2 wired for YouTube, social and the CA firm), the catalogue `docs/research/harvest/cards2/CATALOGUE.md` (section 2.9 per business, plus M18, K13 to K17 and the Later rows) and the cards behind it (`marketing.md`, `commerce.md`, `research-ops.md`, `creator2.md`, `finance2.md`, `social-sales.md`, `computer-use-builders.md`, `second-pass.md`), the flagship code in `platform/runtime/venture/playbooks/` and its tests, and the D-Start board (the gallery tile shape).

Paths below are relative to `platform/runtime/venture/` unless they start with `app/`, `platform/` or `docs/`.

## Founder decisions added 23 Oct

- Share prices (5A2) are in, but the price editor shows a fixed price by default; "a share of an amount" is an advanced option one step away. Tax and GST fields appear only for businesses that need them. Self-employed owners must not find it daunting.
- The phone receptionist (5R6) is built; live calls stay labelled planned until a calling provider is verified.
- Gallery wording: "Hours and prices are model estimates for a typical start" (the plan's proposal) stands. Build order as the plan proposes. Anything that turns out to need an outside review stays labelled planned.

## What every playbook ships (the binding rules)

Each package below is "done" only when its playbook meets all of these, and each package's tests check the ones it touches.

| Rule | How this plan applies it |
|---|---|
| Data plus deterministic checks plus a committed judge baseline plus a dated rule register | the kit definition (5A1); checks with failing-first tests; `playbooks/<id>/baselines/<id>.json` scored by code with no model, the rate only rises; rules in 5A3's `DatedRule` with sources, `checkedOn`, how it was read, `usedBy` and staleness at 90 days |
| Offers with owner-set prices | `price: 'owner-sets'` on every offer (5A1 refuses anything else); quotes and invoices come from price receipts; a pilot is never free (5A2) |
| Typed steps with roles and departments | every role sits in one of Sales and clients, Marketing, Production, Money, Operations; code roles (Chausar, Keeper, Billing) say they are code, not AI |
| Connectors labelled honestly | `write`, `read`, `handoff`, `planned: write`, `planned: read`, `planned: handoff`; every planned one names who it waits on and the manual path meanwhile (P5); marketplace and social APIs that need app review are planned; owner-side handoffs ship; a row written from memory is checked against the platform's docs on build day before its label is set |
| Figures from code receipts, or labelled "model estimate" | tools return receipts; prose numbers without one are labelled (1G); money in BigInt minor units; the gallery's hours and prices are labelled "model estimate" |
| The always-ask floor | money, sending, deleting, prices and government portals ask at every posture; each package marks its floor steps; creating or changing a recurring job asks (H12) |
| No scraping against platform terms, no detection evasion | the fetch policy (5A6) refuses sites whose terms bar automated reading; Chausar fetches only as itself (never another company's user agent); no proxies, no faked fingerprints, no CAPTCHA solving |
| No automated LinkedIn messaging | LinkedIn is copy-and-open handoff in every playbook; owner-browser posting of the owner's own post (2B) is the only LinkedIn write |
| AI voices and presenters disclosed; rights at intake | 5A4 consent and asset records; disclosure checks in every playbook that makes voice, video or synthetic people; an offer touching third-party media refuses without rights recorded at intake |
| Licence honesty | each new file's header names what it learned from and the licence; learn-only sources (AGPL, BUSL, source-available, no licence) give ideas only, never code |
| India first | rupees, GST where it applies, DPDP notices and minimum data, TRAI and ASCI where they apply; legal and tax rows need a CA or lawyer's `confirmedBy` before client use |
| Hindi | engine strings in `playbooks/<id>/hi.json`, UI strings in `app/ui/src/text/{en,hi}/pb-<id>.json` or `kit-*.json`, all machine-drafted and marked for a native reviewer |
| Out of scope | GST e-invoicing, Account Aggregator feeds, and AIS, 26AS, Form 16 and 2B readers (their connectors stay planned) |

## Packages and sizes

| Package | What | Size | Batch | Depends on |
|---|---|---|---|---|
| 5-0 | Integrator: shared names, stubs and seams | M | 0 | W4 merged |
| 5A1 | Playbook kit: definitions, wiring, chains, departments, tiles, practice, Hindi | L | 1 | 5-0 |
| 5A2 | Pilot, proposal, honest exit, decision card, share prices | M | 1 | 5-0 |
| 5A3 | Dated rules, manual paths, recipes, boundaries, ideas | M | 1 | 5-0 |
| 5A4 | Brand kits, assets, media hygiene, voice consent, fingerprints, captions core | M to L | 1 | 5-0 |
| 5A5 | Reports, PDF, DOCX and XLSX, JSON-LD | M | 1 | 5-0 |
| 5A6 | Local apps, monitors, publish tiers, webhooks, mail in, speech out, fetch policy | M to L | 1 | 5-0 |
| 5B1 | YouTube: edit by asking, cleanup, captions, coverage, dictionary, tiers | L | 2 | all 5A |
| 5B2 | YouTube: finishing, style, folder, clips, b-roll, beats, editor hand-off | L | 3 | 5B1 |
| 5B3 | YouTube: new offers, after-publish, Data API, archive search | M to L | 4 | 5B2 |
| 5C1 | CA: citations, split ITR, new offers, question desk, sign-off, practice | L | 2 | all 5A |
| 5C2 | CA: what-if, health check, differential tests, data entry, data pack | L | 3 | 5C1 |
| 5D1 | Social: chain, repurpose, ghostwriting, slots, scheduling, go or no-go | L | 2 | all 5A |
| 5D2 | Social: reels, local Instagram, inbox, diagnosis, health, video ads, cross-posting | L | 3 | 5D1 |
| 5D3 | Social: influencer desk, Bluesky, Mastodon, Telegram, Discord | M | 4 | 5D2 |
| 5E1 | SEO: registration, diagnosis, AI access, panel, website check | L | 2 | all 5A |
| 5E2 | SEO: content, fix and measure, refresh, strategy, local, WordPress | L | 3 | 5E1 |
| 5F1 | Seller: registration, unit economics, ads, settlement, listing, India | L | 2 | all 5A |
| 5F2 | Seller: staging, alerts, stock, research, sheets, photos | L | 3 | 5F1 |
| 5F3 | Seller: marketplace connectors, Shopify, store assistant | L | 4 | 5F2 |
| 5G | Support desk | L | 2 | all 5A |
| 5H | Recruiting desk | L | 3 | all 5A |
| 5I | Job-search desk | M to L | 4 | 5H |
| 5J1 | Translation: checks, subtitles, review sheet, providers | L | 3 | all 5A |
| 5J2 | Translation: dubbing, live captions | L | 4 | 5J1 |
| 5K1 | Bookkeeping: collections, CFO pack, check-up | L | 2 | all 5A |
| 5K2 | Bookkeeping: seller books, setup, receipts in, accounting write | L | 3 | 5K1, 5F1 |
| 5L | Podcast to articles | M | 3 | all 5A |
| 5M | Lead generation and appointment setting | L | 2 | all 5A |
| 5N | Newsletter service | M | 3 | all 5A |
| 5O | Tender and proposal desk | M | 3 | all 5A |
| 5P | Website builder | L | 3 | all 5A |
| 5Q | Narration, audiobooks, explainer reels | M | 3 | all 5A |
| 5R1 | Virtual assistant and the client room | M | 4 | all 5A |
| 5R2 | Data entry desk (with the owner browser and form fill) | L | 4 | all 5A |
| 5R3 | App testing and demo videos | L | 4 | all 5A |
| 5R4 | Dev-agency trio | M | 4 | all 5A |
| 5R5 | Monitored data and IT triage | M | 4 | all 5A |
| 5R6 | AI phone receptionist | M | 4 | all 5A |

Thirty-nine packages: one integrator package, six shared, eight that deepen the flagships, twenty-four for new businesses (5P both builds a new playbook and deepens Build).

## Before the wave starts

- Branch `b2c/ink-v2-w5` from `b2c/ink-v2-w4` once the wave 4 integrator has committed every W4 package. Wave 5 reads W4's results: 4A (`playbooks/departments.ts`, department on agents), 4D and 4E (network, pipeline stages, follow-ups C7, drafts and handoffs C8, reply triage C11, send governor C14), 4F (run controls and the repeat-failure breaker), 4J (`venture.playbooks.list` with the tile slot, the file-request link K9, export hygiene P12, approval bound to file bytes J2), CA8 (`NEEDS_FACTS`). Also from W4, and reused here rather than built twice: 4E3's read-only mailbox (`venture.mailbox.*`, `venture-inbound`), 4J12's step fields (`next`, `maxLoops`, `onExceeded`, `timeoutMs`, `optional`, `failover`), 4J13's routines, 4J17's business voice, 4J18's ideas list, 4J4's money views (ageing, flow, cash) and 4J5's bills and reminders, 4J7's file-request link (`venture.share.request`) and share link states. Names in this plan avoid W4's: the sales proposal is `venture.salesProposal.*` (4C1 owns `venture-proposal`), the GO card is `venture.goNoGo.card` (4J1 owns decisions), voice consent is `venture.voiceConsent.*` (4J17 owns `venture.voice.*`). And from earlier waves: 1D (posting by draft id, held page actions), 1E (untrusted screen, taint latch, effects), 1F (net guard, secret screen), H8 (forward-only stages), 2B (owner-browser posting, risk gate), 2C1 (`judgeAuto`), 2E2 (local transcription), 2F (social calendar, report), 2G (`evidence.record`), 2H (`rules-view.ts`, `usedBy`).
- 5-0 checks that each of those exists. Any missing piece is listed in the PR and given to the first package that needs it, which builds the smallest honest version and says so.
- Re-read each file named in a package before editing it: W2 to W4 changed many of them.
- Everything in "How every wave runs" (master plan) holds: test first, packages in one checkout, no worktrees, agents never commit, stash, switch branches or run the full suite; shared files only by small Edit calls; every new string in English and Hindi; no em dashes.

## Coverage: every W5 row and every placed Later row

| Package | Catalogue rows |
|---|---|
| 5A1 | spec 5.8 shared mechanics: outcome edges, retry caps and timeouts across a chain of runs (on 4J12's step fields), coverage as a fraction, judges on real orders, the start tile |
| 5A2 | P2, P3, P4, M18 |
| 5A3 | P5, P6, P13 (and P1's register, generalised) |
| 5A4 | P7, P8, P9, P10 (and Y4's caption core) |
| 5A5 | P11 (and the JSON-LD builder SEO5 and Y11 use) |
| 5A6 | K13, K16, K17; Later K24 |
| 5B1 | Y2, Y3, Y4, Y5, Y12 (and the rest of K12) |
| 5B2 | Y6, Y7, Y8, Y11, Y13, Y18, Y21, K14 |
| 5B3 | Y9, Y10, Y14, Y15, Y16, Y20, Y22; Later Y19 |
| 5C1 | CA2, CA3, CA5, CA7, CA11 |
| 5C2 | CA4, CA6, CA9, CA10, CA12 |
| 5D1 | S2, S4, S5, S12, S13 (and the 14-step chain W2 left) |
| 5D2 | S3, S6, S7, S8, S9, S11; Later S14 |
| 5D3 | S10, S16; Later K25 (Telegram and Discord only) |
| 5E1 | SEO1, SEO2, SEO3, SEO9, SEO11 |
| 5E2 | SEO4, SEO5, SEO6, SEO7, SEO8, SEO10 |
| 5F1 | SL1, SL2, SL3, SL4, SL5 |
| 5F2 | SL6, SL7, SL8, SL9, SL10, SL12 |
| 5F3 | SL11; Later SL13 |
| 5G | SD1, SD2, SD3, SD4, SD5, SD6 |
| 5H | R1, R2, R3, R4, R5, R6 |
| 5I | J1, J3, J4, J5, J6 (J2 is W4) |
| 5J1 | T1, T2, T3, T5 |
| 5J2 | T4; Later T6 |
| 5K1 | BK1, BK2, BK4 |
| 5K2 | BK3, BK5, BK6, K15 |
| 5L | PA1, PA2, PA3, PA4 |
| 5M | LG1, LG2, LG3, LG4; Later C25 |
| 5N | NL1, NL2, NL3, NL4 |
| 5O | TD1, TD2, TD3 |
| 5P | WB1, WB2, WB3, WB4; Later WB5, K23 (site release only) |
| 5Q | NA1; Later S15 |
| 5R1 | Later X1, X7 |
| 5R2 | Later X3, K20, K21 |
| 5R3 | Later X4, X5, K22 |
| 5R4 | Later X6 |
| 5R5 | Later X8, X9 |
| 5R6 | Later X2 |

W5 rows: 11 in 2.9.0, 19 YouTube, 10 CA, 13 social, 11 SEO, 12 seller, 6 support, 6 recruiting, 5 job search, 5 translation, 6 bookkeeping, 4 podcast, 4 lead generation, 4 newsletter, 3 tender, 4 website, 1 narration, and M18, K13 to K17: 130.

## Shared files and sequencing

5-0 removes most collisions by creating one stub file per package for every list a playbook joins, so a business package edits only files in its own folder plus its own stub files. The rest:

| File | Packages | How they share it |
|---|---|---|
| `contracts.ts`, `platform/runtime/engine.ts`, `app/desktop/ipc-contract.cjs` and `.d.cts`, `app/ui/src/engine/types.ts`, `app/ui/src/engine/fake.ts` | 5-0 only | 5-0 adds every name below; a package adds only what 5-0 missed, one small Edit each |
| `playbooks/registry.ts`, `plan.ts`, `steps.ts`, `intake.ts`, the dispatch in `draft-checks.ts`, `delivery/harness/patches.ts`, `delivery/scenarios.ts`, `delivery/runs.ts` | 5A1 only | after 5A1, no package edits them; kit playbooks join through the 5-0 lists |
| `playbooks/registrations.ts`, `playbooks/definitions.ts`, `playbooks/desks.ts`, `delivery/harness/tools-playbooks.ts`, `build/catalogue-playbooks.ts`, `app/ui/src/places/work/desks/index.ts`, `app/ui/src/engine/fake-playbooks.ts` | 5-0 creates them, importing one stub file per package | never edited after 5-0; each package replaces only its own stub (`playbooks/<id>/registration.ts`, `definition.ts`, `desk.ts`, `delivery/harness/tools-<id>.ts`, `build/catalogue/<id>.ts`, `desks/<Id>Desk.tsx`, `fake-<id>.ts`) |
| `draft-checks.ts` functions `youtubeChecks`, `caChecks`, `socialChecks` | 5B1 to 5B3, 5C1 and 5C2, 5D1 to 5D3 | each package edits only its flagship's function, in sequence |
| `playbooks/youtube/playbook.ts`, `ca-firm/playbook.ts`, `social/playbook.ts`, and their tool files `tools-youtube.ts`, `tools-ca.ts`, `tools-social.ts` | the same sequences | 5B1, then 5B2, then 5B3; 5C1, then 5C2; 5D1, then 5D2, then 5D3 |
| `playbooks/departments.ts` | 5A1, then 5B, 5C, 5D packages | one line per new flagship role |
| `build/index.ts` (handler table), `build/connectors.ts`, and `build/catalogue.ts` for the two non-kit editors (5A6, 5D3) | 5A2 to 5A6, 5D3, 5E2, 5F3, 5K2 | one line or one small edit each; batch order keeps them apart; kit playbooks add catalogue entries only in their own `build/catalogue/<id>.ts` |
| `app/desktop/main.cjs` | 5A5 (print port), 5R2 (owner browser) | one handler each, in different batches |
| `money/quote.ts` | 5A2 only | |
| `build/site-edits.ts` | 5E2 only | one target added |
| `build/brief.ts` | 5P only | the screen-flow section |
| hosted route table | 5F3 (store assistant), 5P (form capture) | one line each, different batches |
| `app/ui/src/text/{en,hi}/*.json` | every UI package | new files only (`kit-*.json`, `pb-<id>.json`); the loader's glob picks them up; existing place files are not edited |

Order of work:

1. 5-0 (integrator, alone).
2. Batch 1, in parallel: 5A1, 5A2, 5A3, 5A4, 5A5, 5A6.
3. Batch 2, when all of 5A is in: 5M, 5E1, 5K1, 5F1, 5G (the five new businesses the catalogue recommends first), 5B1, 5C1, 5D1.
4. Batch 3: 5B2, 5C2, 5D2, 5E2, 5F2, 5K2, 5H, 5J1, 5L, 5N, 5O, 5P, 5Q (each when its own predecessor is in).
5. Batch 4: 5B3, 5D3, 5F3, 5I, 5J2, 5R1, 5R2, 5R3, 5R4, 5R5, 5R6.
6. Integrator after each batch: typecheck, UI suite, bench shards, commits; at the end the PR.

## Package 5-0 (integrator, before agents start): shared names, stubs and seams

Size M. Mechanical; no behaviour, so no failing test of its own beyond the existing suite staying green and the new list files importing cleanly.

1. **Stub files, one set per package that adds a playbook** (ids: `seo-visibility`, `online-seller`, `support-desk`, `recruiting-desk`, `job-search-desk`, `translation-studio`, `bookkeeping-cfo`, `podcast-to-article`, `lead-generation`, `newsletter-studio`, `tender-desk`, `website-studio`, `narration-studio`, `virtual-assistant`, `data-entry-desk`, `app-testing`, `dev-agency`, `monitored-data`, `it-triage`, `phone-receptionist`): `playbooks/<id>/registration.ts` and `definition.ts` exporting `null`, `playbooks/<id>/desk.ts` exporting no handlers, `delivery/harness/tools-<id>.ts` with one spec per tool name below answering `{ ok: false, error: { code: 'NOT_BUILT_YET' } }`, `build/catalogue/<id>.ts` exporting `[]`, `app/ui/src/places/work/desks/<Id>Desk.tsx` rendering "Not built yet", `app/ui/src/engine/fake-<id>.ts` with an empty desk. The list files (`playbooks/registrations.ts`, `definitions.ts`, `desks.ts`, `delivery/harness/tools-playbooks.ts`, `build/catalogue-playbooks.ts`, `app/ui/src/places/work/desks/index.ts`, `app/ui/src/engine/fake-playbooks.ts`) import every stub and filter out nulls. `TOOLS` spreads `PLAYBOOK_TOOLS`; `CONNECTOR_CATALOGUE` spreads `PLAYBOOK_CATALOGUE_ENTRIES`, and the catalogue count test compares with the list's own length; `TOOL_PURPOSE` merges each tool file's exported purpose lines.
2. **`contracts.ts`:**
   - `TOOL_NAMES` gains: `ideas.add`, `assets.record`, `media.clean`, `localapp.run`, `mail.read`, `speech.say`; `youtube.editOps`, `youtube.clean`, `youtube.captions`, `youtube.coverage`, `youtube.dictionary`, `youtube.style`, `youtube.clips`, `youtube.broll`, `youtube.beats`, `youtube.export`, `youtube.afterPublish`, `youtube.outliers`, `youtube.niche`, `youtube.comments`, `youtube.publicStats`, `youtube.archive`; `tax.citations`, `tax.formChooser`, `tax.advance`, `tax.whatIf`, `books.healthCheck`, `docs.entry`; `social.formats`, `social.inventory`, `social.slots`, `social.montage`, `social.inbox`, `social.diagnose`, `social.health`, `social.adStyle`, `social.fairPrice`, `social.keywords`; `seo.diagnose`, `seo.aiAccess`, `seo.panel`, `seo.siteCheck`, `seo.corroborate`, `seo.lint`, `seo.meta`, `seo.impact`, `seo.refresh`, `seo.local`; `seller.unitEconomics`, `seller.ads`, `seller.settlement`, `seller.listing`, `seller.stage`, `seller.alerts`, `seller.stock`, `seller.shortlist`, `seller.catalogueSheet`, `seller.multiStore`; `support.match`, `support.ticket`; `recruit.criteria`, `recruit.ledger`, `recruit.slots`; `career.facts`, `career.capture`, `career.shortlist`, `career.score`; `translate.check`, `translate.terms`, `subtitle.check`, `dub.align`, `dub.verify`; `cfo.ratios`, `cfo.scenarios`, `collections.ladder`, `money.checkup`, `books.post`, `vouchers.draft`; `article.ledger`, `article.style`; `leads.osm`, `leads.enrich`, `leads.dedupe`, `community.vote`; `newsletter.presend`, `newsletter.import`, `newsletter.slices`, `newsletter.stats`; `tender.questions`, `tender.ground`; `site.requirements`, `site.uiReport`, `site.flow`, `site.preview`; `narration.markup`, `narration.verify`; `va.brief`; `forms.map`, `forms.readBack`; `apptest.logcat`, `demo.plan`; `qa.verdict`, `security.scan`; `monitor.extract`, `triage.summary`; `calls.cost`, `calls.log`.
   - `VENTURE_RECORD_KINDS` gains: `venture-go-no-go`, `venture-brand-kit`, `venture-asset`, `venture-voice-consent`, `venture-report`, `venture-report-share`, `venture-monitor`, `venture-youtube-edit`, `venture-youtube-dictionary`, `venture-youtube-style`, `venture-ca-citations`, `venture-ca-differential`, `venture-ca-data-pack`, `venture-social-inbox-item`, `venture-ad-ledger-entry`, `venture-influencer-case`, `venture-seo-panel`, `venture-seo-observation`, `venture-seo-finding`, `venture-seller-sku`, `venture-seller-feecard`, `venture-seller-stage`, `venture-seller-movement`, `venture-seller-case`, `venture-support-ticket`, `venture-support-message`, `venture-support-request`, `venture-support-rating`, `venture-recruit-role`, `venture-recruit-candidate`, `venture-recruit-touch`, `venture-recruit-interview`, `venture-career-fact`, `venture-career-listing`, `venture-career-thread`, `venture-translation-job`, `venture-translation-segment`, `venture-glossary`, `venture-promise-to-pay`, `venture-collection-stage`, `venture-books-posting`, `venture-article-ledger`, `venture-lead-source`, `venture-newsletter-issue`, `venture-newsletter-contact`, `venture-tender-question`, `venture-site-requirement`, `venture-site-release`, `venture-narration-segment`, `venture-room-brief`, `venture-entry-record`, `venture-test-finding`, `venture-dev-permission`, `venture-watch-source`, `venture-call-log`. Ideas reuse 4J18's records (5-0 adds `venture-idea` only if 4J18 left ideas without a record of their own), routines reuse 4J13's, and imported mail lands in 4E3's `venture-inbound`. Each record type is `RecordBase<kind> & Body`, with `Body` a type imported from the owning package's `records.ts` (5-0 creates each as `{ placeholder: true }`; the package replaces it).
   - `VENTURE_METHODS`, `METHOD_OWNERS`, payloads and results gain: `venture.order.chain`; `venture.salesProposal.draft`, `venture.salesProposal.get`, `venture.goNoGo.card`; `venture.ideas.add`, `venture.ideas.move`, `venture.ideas.grade` (beside 4J18's `venture.ideas.list`, `.start`, `.dismiss`); `venture.brandKit.get`, `venture.brandKit.set`, `venture.assets.list`, `venture.assets.rerun`, `venture.assets.reuse`, `venture.voiceConsent.record`, `venture.voiceConsent.revoke`, `venture.voiceConsent.list`; `venture.report.render`, `venture.report.share`, `venture.report.shareRotate`, `venture.report.shareDisable`; `venture.monitors.list`, `venture.monitors.add`, `venture.monitors.remove`, `venture.mail.import`, `venture.mail.threads`, `venture.localApps.list`, `venture.webhook.set`, `venture.speechOut.providers`; `venture.ca.confirmCitations`, `venture.ca.signoff.get`, `venture.ca.differential.add`, `venture.ca.dataPack.export`; and the three desk methods every business uses for its own records, `venture.desk.list {playbook, kind, filter?}`, `venture.desk.get {playbook, kind, id}`, `venture.desk.act {playbook, kind, id, action, payload, digest?}`, whose payload and result types are unions keyed by `${playbook}.${kind}` declared in `playbooks/desk-types.ts` (5-0 adds one line per package, pointing at types in the package's `desk.ts`).
   - `APP_ONLY_METHODS` gains every method above that sets, records, revokes, adds, removes, exports, confirms, rotates or disables, plus `venture.desk.act` and `venture.webhook.set`.
   - `OrderIntake` gains `fields?: Record<string, IntakeValue>`; `OrderRecord` gains `chainStage?: number` and `chainState?: 'running' | 'waiting' | 'stopped' | 'done'`; new types `Department`, `StartTile`, `IntakeValue`, `SharePrice` (stubs where 5A fills them). Events gain `chain.changed`, `desk.changed`, `idea.changed`.
3. `platform/runtime/engine.ts` case lines for every new method; `app/desktop/ipc-contract.cjs` and `.d.cts`; `app/ui/src/engine/types.ts` method map entries; `app/ui/src/engine/fake.ts` registers `fake-playbooks.ts` and the fakes for each 5A package (`fake-kit-sales.ts`, `fake-kit-rules.ts`, `fake-kit-media.ts`, `fake-kit-report.ts`, `fake-kit-connect.ts`).
4. `playbooks/kit/define.ts` with the full `PlaybookDefinition` type from 5A1's table (types only), so batch 1 packages and later business packages all code against the same shape.
5. Run `npm run typecheck`, `npm run typecheck:ui` and the contract tests (`platform/tests/venture-contracts.test.ts`, `desktop-ipc-methods.test.ts`, `app/ui/tests/engine/ipc-allowlist.test.ts`); they must pass before agents start.
---

## 5A: shared playbook mechanics (catalogue 2.9.0)

Six packages, all in batch 1. They build what every business package reads, so no business package starts until all six are in.

### Package 5A1: the playbook kit (definitions, wiring, chains, departments, tiles, practice, Hindi)

Size L. Rows: spec 5.8 (outcome edges, retry caps, timeouts, coverage as a fraction, judges on real orders, the start tile). Builds the one adapter that lets a new playbook be a folder of data plus checks, with no edits to the shared playbook files after this package.

**Files (new):** `playbooks/kit/define.ts` (`PlaybookDefinition`, `definePlaybook`), `playbooks/kit/chain.ts`, `playbooks/kit/checks.ts` (`runKitChecks`, coverage), `playbooks/kit/baseline.ts` (`runKitBaseline`), `playbooks/kit/intake.ts`, `playbooks/kit/words.ts` (word checks and the Hindi lookup), `playbooks/kit/practice.ts`, `playbooks/kit/tile.ts`, `playbooks/youtube/tile.ts`, `playbooks/ca-firm/tile.ts`, `playbooks/social/tile.ts` (the three flagships' gallery tiles). **Changed (only this package, small edits):** `playbooks/registry.ts`, `playbooks/plan.ts`, `playbooks/steps.ts`, `playbooks/draft-checks.ts`, `playbooks/intake.ts`, `delivery/harness/patches.ts` (`FLAGSHIP_TOOLS` from definitions), `delivery/scenarios.ts` (`scenariosFor(type, flagship)`), `delivery/runs.ts` (one chain hook at accept), `playbooks/departments.ts` (W4 4A: kit roles carry their department), the W4 `venture.playbooks.list` handler (tiles from definitions), `views/team.ts` if 4A did not already read roles generically. Tests: `platform/tests/venture-kit-define.test.ts`, `venture-kit-wiring.test.ts`, `venture-kit-chain.test.ts`, `venture-kit-tiles.test.ts` (all new); UI `app/ui/tests/places/start-gallery.test.tsx` (one case per flagship tile).

**The definition** (what every business package fills in its `playbooks/<id>/definition.ts`):

| Field | What it holds |
|---|---|
| `registration` | from the light `registration.ts`: id, label, service type, picks, summary |
| `offers` | id, name, description, `pricing` (monthly, project, hourly), `unit` ("per episode", "per video minute"), `price: 'owner-sets'` always, `stages` (step ids in order, or a chain), `includes`, `pilotable`, `rights` (bases accepted when the offer touches third-party media), `intake` (field ids), `audience` ('client' or 'public' or 'internal', which decides whether the automatic judge runs) |
| `roles` | id, name, kind (`agent`, `code`, `person`), `department` (one of `sales-and-clients`, `marketing`, `production`, `money`, `operations`), job line |
| `steps` | the engine `PlaybookStep`, with 4J12's `next`, `maxLoops` (1 to 3, default 2), `onExceeded` and `timeoutMs`, plus role, `produces`, `waitDays` (how long a stage may wait on a person before a Today row), `floor` (reason, for always-ask steps), `connector` (id, for steps that need outside data) |
| `approvals` | id, words, step, who (owner, client, CA, other person), floor flag, second ask flag |
| `connectors` | id, name, label (`write`, `read`, `handoff`, `planned: write`, `planned: read`, `planned: handoff`), note, `manualPath` (required when planned, P5), `waitsOn` (the outside party, when planned), `desktopOnly`, `catalogueId` |
| `intakeFields` | id, label, help, kind (`rights`, `choice`, `yes-no`, `text`, `list`, `date`, `money`, `file`, `consent`), required, options |
| `checks`, `checkIds` | the deterministic checks, `(input: FlagshipCheckInput) => KitCheckResult[]` |
| `judgeRules` | yes or no rules, each with a floor (share or required-yes) |
| `baseline` | name, folder, `score(case, draft, meta)` |
| `rules` | the dated rule register (5A3 `DatedRule`) |
| `boundaries`, `recipes` | P6 data (5A3) |
| `practice` | three practice clients (clean, messy, pushy), each with request and files |
| `tools` | the playbook's own tool names |
| `planPicks` | which offers, approvals and connectors go on the one-page plan |
| `draftStep(offer)` | the writing step for an order on that offer |
| `startTile` | category, icon, line, `youDo {hoursMin, hoursMax, line}`, `team {roleIds (at most 4), line}`, `pay {minRupees, maxRupees, per}`; hours and pay are both labelled "model estimate" |
| `notBuilt` | what is never built for this playbook |
| `words()` | every string shown to people, for the word checks and the Hindi file |

**Failing tests first:**

1. `definePlaybook` refuses with `PLAYBOOK_DEFINITION_INVALID`, naming the field, for: an offer naming a step that does not exist; a step whose role is missing; a role without one of the five departments; an approval on a missing step; a floor step with no approval point; a connector label outside the six; a planned connector with no `manualPath`; an offer whose price is anything but `'owner-sets'`; a tile with `hoursMin > hoursMax`, hours over 60, `minRupees` of 0 or above `maxRupees`, a team role not in `roles`, or more than four team roles; a judge rule without a floor; an edge to a missing step, or a cycle that is not a capped back edge; a string from `words()` with no entry in the playbook's `hi.json`.
2. A test-only definition `kit-fixture` (two offers, five steps, one tool, one judge rule, two baseline cases), passed in through the optional `definitions` parameter each function gains: `pickPlaybook` picks it from its phrase; `flagshipPlanById` gives its plan words with its offers' pricing and approvals; `flagshipDelivery` gives its steps, roles, `roleOf`, floor and draft step; `validatePlaybook` accepts its engine steps; `toolCeiling('consulting', 'kit-fixture')` includes its tool and a patch granting another kit playbook's tool is refused; `offerIntakeAsk` lists its fields; `orderIntake` keeps its fields under `intake.fields`, refuses an unknown field with the existing words, refuses a missing required field with `INTAKE_FIELD_REQUIRED` naming the label, and refuses a consent field that is not true; `runFlagshipChecks` runs its checks, then the prompt-leak lint; `flagshipJudgeRules` returns its rules; `runKitBaseline` scores its cases and fails below the committed rate. The three flagships' existing tests pass unchanged.
3. Coverage as a fraction: `runKitChecks` adds one `coverage` result, "4 of 5 checks ran; not run: finishing (no cut was named)". A not-run check is never counted as a pass.
4. Chain (`venture-kit-chain.test.ts`, fixture offer with stages `voice`, `calendar`, `drafts`): accepting the voice draft starts the calendar run on the same order (`chainStage: 2`), never before acceptance; a rejection follows the step's `next` back to the same stage up to `maxLoops`; past it, `onExceeded` stops the chain with one Today row "The voice sheet was sent back 3 times. Talk to your client before trying again."; a stage that ends in a handoff question waits for the answer and resumes at the stage `next` names for an answer; a stage waiting longer than `waitDays` (by the business's local date, `localDayAt`) makes one Today row per stage ("Waiting on your client for 7 days"). `venture.order.chain {orderId}` returns each stage with its state (done, now, waiting, not started, stopped) and "Stage 2 of 4".
5. Departments: `venture.team.list` on a kit business gives each agent its role's department; code roles show as code, not AI (the Keeper rule).
6. Tiles: `venture.playbooks.list` lists one tile per registered playbook (the three flagships included) with both figures marked `estimate: 'model estimate'`, in English and Hindi; a playbook whose package has not landed (its stub is `null`) has no tile.
7. Practice: `venture.simulation.scenarios` on a kit business lists its three practice clients; `venture.simulation.run` runs them through the kit checks and, with an AI judge on, the playbook's rules (2C1's path).
8. Judge on real orders: a kit draft whose offer `audience` is client or public gets the automatic judge (2C1 `judgeAuto`) with the playbook's rules; an internal draft gets none.

**Implementation notes.** 4J12 validates the step fields inside one run; 5A1 adds only the chain that carries a playbook's stages across runs and honours the same fields. The flagship tiles take their data from the "Gallery tile" lines of 5B, 5C and 5D below. The three flagships stay hand-written; the kit is an adapter into the shapes they already use (`FlagshipPlan`, `FlagshipDelivery`, `FlagshipCheckInput`). `OrderIntake` gains `fields?: Record<string, IntakeValue>` (5-0 adds the type). The chain stores `chainStage` and `chainState` on the order (5-0 adds the fields) and reuses the order path, so gates, posture and the floor hold. Hindi: `playbooks/<id>/hi.json` maps each English string to its Hindi, with `"_review": "machine-drafted, needs a native reviewer"`; `kit/words.ts` exports `hiOf(id, en)`. Words also pass `houseStyleFindings`, `doneClaimFindings` and `assertNoNumbers`, except tile figures and rule values, which are data and labelled.

**Done when:** the four new test files, `venture-playbook-*.test.ts`, `venture-playbook-wiring*.test.ts` and `venture-judge-*.test.ts` are `# fail 0`, and the gallery UI case passes.

### Package 5A2: sales mechanics (P2 pilot, P3 proposal, P4 honest exit, M18 decision card, share prices)

Size M. Rows P2, P3, P4, M18; plus a share price kind (recruiting success fee, reimbursement audit share, support AI pass-through markup).

**Files (new):** `playbooks/kit/pilot.ts`, `playbooks/kit/proposal.ts`, `playbooks/kit/exit.ts`, `playbooks/kit/go-no-go.ts`, `playbooks/kit/sales-methods.ts`, `money/share-price.ts`; **changed:** `money/quote.ts` (one exported function, `quoteShare`); UI `app/ui/src/places/clients/Proposal.tsx`, `app/ui/src/places/business/GoNoGoCard.tsx`, `app/ui/src/engine/fake-kit-sales.ts`, `app/ui/src/text/{en,hi}/kit-sales.json` (prefix `kit-sales.`); tests `platform/tests/venture-kit-pilot.test.ts`, `venture-kit-proposal.test.ts`, `venture-kit-exit.test.ts`, `venture-go-no-go.test.ts`, `venture-share-price.test.ts`, `app/ui/tests/places/kit-sales.test.tsx`.

**Failing tests first:**

1. Pilot: `pilotOf(definition, offerId)` gives a one-page pilot with a hypothesis, a window of 2 to 6 weeks (`PILOT_WINDOW` outside it), a success measure (what, the number as the owner types it, the date; the date must fall inside the window by code date arithmetic), the hours needed from the owner and from the client, the owner's price (`PILOT_UNPRICED`, "A pilot is never free. Set a price for it.", when the price is missing or zero), permission to reference (asked, recorded yes or no), and the after-pilot asks (case study, referral). Every kit definition has at least one `pilotable` offer (checked by `definePlaybook`).
2. Proposal: `venture.salesProposal.draft {clientId | personId, offerId, pilot?}` starts a Producer run whose draft has exactly the sections What we heard, Roadmap, Investment, Next step, Open questions. Every amount under Investment is a price receipt from the owner's list (a typed amount fails `figures-resolve`); a fact the run lacks is a bracketed placeholder ("[your current monthly enquiries]") and check `placeholders-listed` fails unless each one is repeated under Open questions; with no price for the offer the method refuses `OFFER_UNPRICED`. The owner approves on Today; sending is the W4 handoff (mail, WhatsApp, LinkedIn copy); Chausar never sends it.
3. Honest exit: `scopeOf(definition, request)` decides in, partly or outside by code first (the definition's `inScope` and `outOfScope` phrases, English and Hindi); a model view, when asked, is shown as "model estimate: may be outside" and the owner picks. Outside gives the fixed reply "This is outside what we do. We can help with {in-scope part}. For {the rest}, {pointElsewhere}." and no follow-up is ever scheduled for that person (pipeline stage Not now, reason "outside scope", W4 4E). Partly creates the order for the in-scope part only and lists the rest on the order.
4. Decision card: `venture.goNoGo.card {playbook, subject, inputs}` returns GO, HOLD or NO-GO by code rules over typed inputs: the maximum loss is computed by the calculator from the money inputs in paise with a receipt; HOLD lists every unknown input; NO-GO when the maximum loss is above the owner's stated limit; every GO card carries the fixed line "GO spends nothing: each spend still asks you." The card is stored (`venture-go-no-go`) and listed on Business.
5. Share price: an offer priced `share` with basis points the owner sets and a base taken from a recorded amount with its evidence file. `quoteShare({ bps: '833', baseMinor: '120000000' })` gives `'9996000'` (8.33% of 12,00,000.00 rupees is 99,960.00 rupees), half-up to the paisa in BigInt; no recorded base refuses `SHARE_BASE_MISSING`; a base without evidence refuses `SHARE_BASE_UNPROVEN`. Setting or changing a share stays on the prices floor.

**Done when:** the five engine test files are `# fail 0` and the UI test passes.

### Package 5A3: dated rules, manual paths, recipes, boundaries, the idea pipeline (P5, P6, P13)

Size M. Generalises the social register and W2 2H's rules view so every playbook keeps its rules the same way.

**Files (new):** `playbooks/kit/rules.ts` (`DatedRule`, `validateRules`, `rulesFreshness`), `playbooks/kit/manual-path.ts`, `playbooks/kit/recipes.ts`, `playbooks/kit/boundaries.ts`, `playbooks/kit/ideas.ts` (records and methods), `delivery/harness/tools-kit.ts` (`ideas.add`); **changed:** `playbooks/rules-view.ts` (W2 2H, one edit: kit rules included); UI `app/ui/src/places/business/Recipes.tsx`, `app/ui/src/places/work/Ideas.tsx`, `app/ui/src/engine/fake-kit-rules.ts`, `app/ui/src/text/{en,hi}/kit-rules.json`; tests `platform/tests/venture-kit-rules.test.ts`, `venture-kit-recipes.test.ts`, `venture-ideas.test.ts`, `app/ui/tests/places/kit-rules.test.tsx`.

`DatedRule`: id, scope, topic, rule (plain words), value and unit when it is a limit, sources (title, URL), `checkedOn`, `read` (`official`, `secondary`, `house`, `unconfirmed`), `how`, `usedBy` (step and check ids), `limitations`, `recheckAfterDays` (default 90), `confirmedBy` (for rules a CA or lawyer must confirm: name and date, or null).

**Failing tests first:**

1. `validateRules` refuses a rule with no source unless it is `house` (then the source is "Chausar's own rule"), a `checkedOn` after today, a `value` without a unit, `usedBy` naming a step or check the playbook lacks. `rulesFreshness` uses the business's local date: day 91 after `checkedOn` is stale. A check that uses an `unconfirmed` rule ends its detail with "This rule is not confirmed." A rule that needs a CA or lawyer and has `confirmedBy: null` works in rehearsal only (`RULE_UNCONFIRMED` for a client order), the same way 1A treats rate tables.
2. `rules-current` (2H) runs for kit playbooks over the rules the run's checks used: stale rules give a not-run line that never blocks Accept. `venture.rules.list` lists kit rules with their freshness and sources.
3. Manual path (P5): every planned connector has a `manualPath` ("Until then: in Search Console open Performance, choose Export, and add the CSV to the order."); the step that needs it shows that line in its task guidance and on the order card.
4. Recipes and boundaries (P6): each recipe has when to use, steps with why, how to read the result and common mistakes; a mistake marked `judge: true` becomes a judge rule with its own floor; Business > Plan and playbook shows the recipes and the measurement-boundaries table (evidence, what it can say, what it cannot say).
5. Ideas (P13), on 4J18's ideas list (same records and `venture.ideas.list`; 5A3 adds the stages, the expiry and the grade): `venture.ideas.add {text, source}` puts an idea in Inbox; moves go forward only (Inbox, Triage, Drafted, Made, Published), or to Dropped with a one-sentence reason; an idea untouched for 90 days in Inbox or Triage is dropped with "Not drafted within 90 days."; seven days after Published, one Today row asks the owner to grade it (worked, so-so, did not). The `ideas.add` tool lets an agent add a suggestion marked with its role; it writes only Chausar's own list, so the taint latch allows it as an internal suggestion (the same one-line allowance 2G used for `evidence.record`).

**Done when:** the three engine test files are `# fail 0` and the UI test passes.

### Package 5A4: brand kits, asset records, media hygiene, voice consent, stale by fingerprint, captions core (P7, P8, P9, P10, Y4 core)

Size M to L. The caption engine lives here because YouTube, translation, social reels, narration and demo videos all use it.

**Files (new):** `playbooks/kit/brand-kit.ts`, `playbooks/kit/assets.ts`, `playbooks/kit/media-intake.ts`, `playbooks/kit/voice-consent.ts`, `playbooks/kit/fingerprint.ts`, `playbooks/kit/captions.ts` (cue grouping, profiles, validator, SRT and VTT writers), `playbooks/kit/transcribe-back.ts` (score a synthesized sentence against its text), `playbooks/kit/media-methods.ts`, tools in `delivery/harness/tools-kit.ts` (`assets.record`, `media.clean`); UI `app/ui/src/places/clients/BrandKit.tsx`, `app/ui/src/places/work/Assets.tsx`, `app/ui/src/engine/fake-kit-media.ts`, `app/ui/src/text/{en,hi}/kit-media.json`; tests `platform/tests/venture-brand-kit.test.ts`, `venture-assets.test.ts`, `venture-media-intake.test.ts`, `venture-voice-consent.test.ts`, `venture-fingerprint.test.ts`, `venture-captions.test.ts`.

**Failing tests first:**

1. Brand kit (P7): `venture.brandKit.set {clientId, kit}` stores colours (hex), fonts (names), logo (order file id), voice, one to three samples (four refused), banned words, banned topics, competitors, and provable claims each with its proof file; `resolveKit` returns every field with its source (client kit, then the business voice and house style from 4J17, then the default); a creative step's task lists the resolved kit; past briefs are kept per client and listed as client memory.
2. Asset record (P8): every file a run delivers has a `venture-asset` (source: client file, generated with model and prompt, licensed stock with licence id, or `unknown`; licence; attribution; cost from a receipt or "not measured"; `supersededBy`); an `unknown` licence blocks Accept with `ASSET_LICENCE_UNKNOWN` naming the file; the footage share of a cut ("62% your footage") is computed by code from the edit list by source and goes into the AI disclosure line whenever generated footage is above zero; Rerun makes a new asset that supersedes the old one (kept); Reuse links an existing asset with no new cost.
3. Media hygiene (P9): a JPEG with a GPS block is stored with every EXIF and XMP segment removed except a minimal EXIF block that code writes holding only the Orientation tag, so the photo still shows upright; PNG `eXIf`, `tEXt`, `iTXt`, `zTXt` chunks and WebP `EXIF` and `XMP ` chunks are dropped; the stored file is the cleaned one. A video on desktop with ffmpeg is rewritten with `-map_metadata -1` (stub `FfmpegPort` records the arguments); with no ffmpeg it is held with a Today row "This clip still has its location data. Remove it, or approve keeping it."
4. Voice consent (P9): `venture.voiceConsent.record {speaker, recordingFileId, transcript, statement, scope, until}` stores a versioned consent; any call that sends a voice to a cloning or synthesis provider without a current consent refuses `CONSENT_REQUIRED`; revoking stops later use and marks assets made with it "consent withdrawn"; a step that names voice A cannot use voice B (`VOICE_MISMATCH`, no silent substitution); a real person who appears in client work needs a consent record named at intake.
5. Stale by fingerprint (P10): a derived unit (translation, captions, dub, article, chapter list) stores the digest of its source; when the source changes, `staleUnits(state, orderId)` marks each derived unit stale; a stale unit cannot be delivered (`DERIVED_STALE`, "The transcript changed after these captions were made. Make them again.") and is never reused silently.
6. Captions core: cues grouped from word times with balanced lines, no single-word line, a reading-speed cap, a minimum and maximum duration and a two-frame gap per profile (web, broadcast, 9:16, values as dated house rules), breaks at sentence, clause or pause; findings as codes with cue ids and a fix hint, never quoting the text; checks that cannot run listed; editing a word never moves timing; SRT and VTT escape `<`, `&` and arrow lines correctly.
7. Transcribe-back: `scoreBack(expected, heard)` is word-level similarity in whole points (0 to 100) by code; 92 and up approved, 85 to 91 review, below retry (thresholds as house rules).

**Done when:** the six engine test files are `# fail 0`.

### Package 5A5: client reports and documents (P11, documents for every playbook)

Size M. No new dependency: HTML by code, PDF through Electron's own print on desktop, DOCX and XLSX by a small zip writer on `node:zlib`.

**Files (new):** `playbooks/kit/report/blocks.ts`, `report/render-html.ts`, `report/manifest.ts`, `report/pdf.ts` (a `PrintPort`; desktop passes Electron's `printToPDF`), `report/share.ts`, `report/methods.ts`, `playbooks/kit/ooxml/zip.ts`, `ooxml/docx.ts`, `ooxml/xlsx.ts`, `ooxml/read.ts` (read DOCX text and XLSX cells, for manuscripts and RFP workbooks), `playbooks/kit/jsonld.ts` (JSON-LD from observed fields only, validated and escaped); **changed:** `app/desktop/main.cjs` (the print port, one handler); UI `app/ui/src/places/work/ReportFiles.tsx`, `app/ui/src/engine/fake-kit-report.ts`, `app/ui/src/text/{en,hi}/kit-report.json`; tests `platform/tests/venture-report.test.ts`, `venture-ooxml.test.ts`, `venture-jsonld.test.ts`.

**Failing tests first:**

1. Blocks: a `metric` block without a receipt id, or with one not among the run's receipts, refuses to render (`REPORT_BLOCK_UNSOURCED`); a `bars` block needs a receipt per bar; prose with a number and no receipt is labelled "model estimate" (1G); a quote renders "Shown as written".
2. HTML is one file with no outside URL (only the share link itself), every value escaped, a `manifest.json` with the sha256 of each file, and the same input gives the same bytes.
3. PDF: on desktop with a fake print port, the PDF is made and listed in the manifest; when the report has Devanagari and the port reports a missing font, no PDF is made and the HTML is kept with "The PDF could not draw Hindi on this computer, so the report is the HTML file."; hosted gives HTML only with "A PDF needs the desktop app."
4. Report share link: scoped to a date range and channels; anything outside the scope is not shown; Rotate makes a new token and ends the old; Disable stops it; views are counted, never tracked with a pixel.
5. DOCX and XLSX: `writeDocx({cover, sections})` and `writeXlsx({sheets})` make zips that `read.ts` opens back to the same text and cells; values are XML-escaped; an XLSX cell starting with `=`, `+`, `-` or `@` is stored as an inline string, never a formula; money is stored as text with two decimals, never a float; writes go through W4's atomic export (P12).
6. JSON-LD: built only from fields observed on the page or recorded at intake; a type outside the allowed list (Organization, LocalBusiness, Product, Offer, Article, VideoObject, FAQPage, BreadcrumbList) is refused; `</script>` inside a value is escaped.

**Done when:** the three engine test files are `# fail 0` and the desktop print handler has a unit test with a stub `webContents`.

### Package 5A6: shared connectors (K13, K16, K17, K24, mail in, speech out, the fetch policy)

Size M to L.

**Files (new):** `build/local-apps.ts` (K13), `build/monitors.ts` (K16) and its Keeper job, `build/publish-tiers.ts` (K17), `build/webhook-handoff.ts` (K24), `build/mail-in.ts`, `build/speech-out.ts` (text to speech on the owner's key), `build/fetch-policy.ts` (sites whose terms bar automated reading), tools in `delivery/harness/tools-kit.ts` (`localapp.run`, `mail.read`, `speech.say`); **changed:** `build/index.ts` (one line per method group), `build/catalogue.ts` (one small edit adding n8n webhook, Make webhook, mail import and the speech providers; 5A6 runs before any playbook package); UI `app/ui/src/places/connections/Monitors.tsx`, `MailIn.tsx`, `LocalApps.tsx`, `SpeechOut.tsx`, `app/ui/src/engine/fake-kit-connect.ts`, `app/ui/src/text/{en,hi}/kit-connect.json`; tests `platform/tests/venture-local-apps.test.ts`, `venture-monitors.test.ts`, `venture-publish-tiers.test.ts`, `venture-webhook-handoff.test.ts`, `venture-mail-in.test.ts`, `venture-speech-out.test.ts`, `venture-fetch-policy.test.ts`.

**Failing tests first:**

1. Local apps (K13): an owner-installed CLI found on PATH (fake binary) answering exit 2 with `{remedy, next}` makes a Today row with the remedy; exit 3 is "not available"; exit 4 or an irreversible command without `--yes` is refused before it runs; Chausar passes `--yes` only for the exact command the owner approved (journalled); not found gives a `planned` label with the manual path "Install it yourself; Chausar never installs it."; hosted is unavailable. BaoCut is driven only through its public CLI (its licence bars bundling).
2. Monitors (K16): `venture.monitors.add {url, kind: 'change' | 'contains' | 'price-below', ...}` (app only; adding a recurring check is on the floor, H12) refuses private addresses (net guard) and sites on the fetch policy list; the first check stores a seed and alerts nothing; the next change alerts once; errors back off 1, 2, 4, 8 hours up to 24; robots.txt disallow refuses ("This site asks robots not to read that page."); at most one check an hour per site; a price is read only from the selector the owner picked and parsed by code into paise.
3. Publish tiers (K17): a copy block maps to `handoff`, a scheduler on the owner's key to `write`, the owner's own command to `delegated`; community posts are always `handoff`; a provider quota error becomes `QUOTA_REACHED` with the provider's words, never "failed".
4. Webhook handoff (K24): the owner sets an n8n or Make URL (app only, net guard); sending an approved item's exact payload is an always-ask action showing that payload; 2xx is applied; a timeout is outcome unknown (1B), never retried.
5. Mail in: imported files land in 4E3's `venture-inbound` (marked `source: 'file-import'`) beside what 4E3's read-only mailbox syncs, and `routeInbound(state, inboundId)` hands each message to the playbook desk whose client it matches (support tickets, recruiting resumes, the assistant's inbox); an `.eml` with a script tag and "ignore previous instructions" is stored screened and flagged (1E); Message-ID, In-Reply-To, References, From, To, Date and Subject are parsed; an `.mbox` of three messages makes two threads by References; a file over 25 MB is refused with its size; attachments become files with their own screening.
6. Mailbox: no second IMAP reader is built; playbooks use 4E3's (`venture.mailbox.*`) with the label 4E3 gave it, and when it is not connected the manual path is "Forward the mails, or export them as .eml files". A test routes one 4E3 inbound message and one imported file to the same support ticket thread.
7. Speech out: a provider capability table (languages, voices, maximum characters per call, price per character from the provider's page with its checked date); a provider with no dated price is refused (`UNPRICED_CALL`), the quote is shown first and spend is reserved before each call; every voice used is either a stock voice with its licence or a consented voice (5A4); the output asset records the provider, voice and text digest.
8. Fetch policy: any agent fetch of linkedin.com, naukri.com, google.com/maps, justdial.com, indiamart.com, instagram.com, facebook.com, x.com, amazon.in or flipkart.com product pages is refused with "This site's terms don't allow automated reading. Paste the text instead." The list is a dated rule set with each site's terms URL; the owner's own signed-in posting (2B) is separate and unaffected.

**Done when:** the eight engine test files are `# fail 0` and the connections UI cases pass.
---

## 5B: YouTube channel, deepened (catalogue 2.9.1)

Three packages in sequence (each edits `playbooks/youtube/playbook.ts` and `youtubeChecks`): 5B1, then 5B2, then 5B3. The YouTube playbook stays hand-written (not a kit definition); its new roles get departments in `playbooks/departments.ts` (one line each), its new tools go in `delivery/harness/tools-youtube.ts`, and its rules in `playbooks/youtube/platform-rules.ts` gain `usedBy` and `limitations` (2H already did) plus the new rows below.

**Gallery tile** (written by 5A1 in `playbooks/youtube/tile.ts`; 5B3 updates the line when its offers land): category Content; "Episodes, shorts and packaging for your own channel or a client's, from footage you own or license."; you do 4 to 8 hours a week ("Record, watch each cut, meet sponsors."); team Editor (Production), Story editor (Marketing), Producer (Sales and clients), Publisher (Marketing) ("Edits, shorts, titles and sponsor quotes."); clients usually pay 5,000 to 30,000 rupees per video (model estimate).

### Package 5B1: edit by asking, cleanup, captions, coverage, dictionary, transcription tiers (Y2, Y3, Y4 wiring, Y5, Y12, rest of K12)

Size L. Depends on 5A4 (captions core, fingerprints) and 2E2 (local transcription).

**Files:** new `playbooks/youtube/edit-ops.ts` (Y2), `clean.ts` (Y3), `coverage.ts` (Y5), `dictionary.ts` (Y12); changed `playbooks/youtube/transcribe.ts` (tiers and pinned models), `playbooks/youtube/playbook.ts` (steps, grants, check ids), `playbooks/youtube/platform-rules.ts` (caption and cleanup rows), `playbooks/draft-checks.ts` (`youtubeChecks` only), `delivery/harness/tools-youtube.ts` (`youtube.editOps`, `youtube.clean`, `youtube.captions`, `youtube.coverage`, `youtube.dictionary`), `playbooks/youtube/baselines/youtube.json` (new cases); UI `app/ui/src/places/work/desks/YoutubeEdit.tsx`, `app/ui/src/engine/fake-youtube.ts`, `app/ui/src/text/{en,hi}/pb-youtube.json`; tests `platform/tests/venture-youtube-edit-ops.test.ts`, `venture-youtube-clean.test.ts`, `venture-youtube-captions.test.ts`, `venture-youtube-coverage.test.ts`, `venture-youtube-dictionary.test.ts`, `venture-youtube-tiers.test.ts`, `app/ui/tests/places/youtube-edit.test.tsx`.

**Steps after this package:** gather (footage, rights, voice profile) → compute (local transcript in tiers, silences) → write (hooks, typed edit operations) → compute (`youtube.clean`, `youtube.editOps`, `youtube.captions`, the EDL) → verify (finishing, captions, coverage, title, chapters, writing lint, receipts) → judge → approve (owner, floor) → hand off. New role: Cutter (Production, agent) proposes edit operations by word id only.

**Failing tests first:**

1. Edit by asking (Y2): `applyEditOps(transcript, ops)` takes typed operations on word ids (cut, restore, zoom, layout, clip, captions, title, hook); each is applied whole or refused with a reason (unknown word id, overlapping cut, restore of a range that was not cut); one request is one undo step; code writes the summary ("Cut 3 passages, 42 s shorter"); removing more than 20% of the duration refuses with `EDIT_ASK_AGAIN` and the share, until the owner confirms; more than 40 operations refuses all (`EDIT_TOO_MANY`); on confirm the operations are checked again against the current draft digest (`EDIT_STALE`); "Suggest without AI" proposes cuts from the cleanup rules alone.
2. Cleanup (Y3), with word times, three silence signals (mic, system audio, voice activity) and a fake loudness trace: cut edges land in 30 to 200 ms of air; a silence is cut only when all three signals agree; hesitations ("um", "uh", "हम्म") are cut and meaningful fillers ("like", "you know", "मतलब") only suggested; slivers under 400 ms merge; at least 1.2 s of speech stays between cuts; at most 6 seams a minute (12 for vertical); a manual cut is never undone; the preview figure comes from the function that applies it; no gap found means no cut; sources with different frame rates or colour spaces are refused (`SOURCE_MISMATCH`); a trim moves word timings without a new transcription.
3. Captions (Y4 wiring): `youtube.captions {profile}` groups cues from the stored word times with 5A4's core and returns findings as codes with cue ids; the package's SRT and VTT pass the validator; editing a word in Review keeps every cue's timing; a stale transcript (5A4 fingerprint) refuses with `DERIVED_STALE`.
4. Coverage (Y5): for a scripted video, `youtube.coverage {scriptFile}` gives covered percent (code), missing passages with the nearest word ids, retakes (a passage said twice) and extra words, and never adds text the speaker did not say.
5. Dictionary (Y12): the owner keeps a names list; the model proposes fixes by word index with the exact `before`; code applies a fix only when `before` matches at that index and its similarity to the dictionary term is 0.90 or more (code, normalised edit similarity); Review shows each "before, after" pair with Undo.
6. Tiers (K12): draft, final and refined transcripts each store the whisper version and the model file's sha256; a model whose hash differs from the pinned table refuses `MODEL_HASH_MISMATCH`; a model is downloaded only after the owner confirms (desktop), pinned to a revision and sha256; segments outside voice-activity regions are dropped (whisper invents text over silence); the business glossary seeds the prompt.
7. Ink: the edit desk shows the request, each operation applied or refused with its reason, the code-written summary, Undo, and the 20% second ask.

**Judge rules added:** `meaning-kept` (does the cut keep what the speaker meant; share 75), `no-new-words` (no words put in the speaker's mouth; required yes).

**Baseline cases added** (`youtube.json`, the rate only rises): `cleanup-summary` (the summary names the cut count and seconds), `caption-file` (a package with captions passes the cue validator), `scripted-coverage` (a scripted video lists one missing passage).

**Rule register rows** (house unless a source says otherwise; verify each on build day): caption reading speed and line length per profile (secondary: Netflix English and Hindi timed text style guides, https://partnerhelp.netflixstudios.com); YouTube caption file formats (https://support.google.com/youtube/answer/2734698); cleanup thresholds (house, from Tomada's ideas, AGPL, no code).

**Connectors:** local transcription `read` (desktop, whisper and ffmpeg found on the computer), hosted `planned` with the manual path "Upload an SRT or VTT transcript"; model download `handoff` (the owner confirms each download).

**Done when:** the six engine test files and `venture-playbook-youtube*.test.ts` are `# fail 0`; the edit desk UI test passes; the baseline file's rate is committed.

### Package 5B2: finishing, style, project folder, clips, b-roll, beats, helpers, editor hand-off (Y6, Y7, Y8, Y11, Y13, Y18, Y21, K14, K13 use)

Size L. Starts after 5B1.

**Files:** new `playbooks/youtube/style.ts`, `project-folder.ts`, `clips.ts`, `broll.ts`, `beats.ts`, `helpers.ts`, `interchange.ts` (CMX 3600 EDL, FCPXML, OTIO); changed `finishing.ts`, `playbook.ts`, `platform-rules.ts`, `draft-checks.ts` (`youtubeChecks` only), `tools-youtube.ts` (`youtube.style`, `youtube.clips`, `youtube.broll`, `youtube.beats`, `youtube.export`), baselines; UI `app/ui/src/places/work/desks/YoutubeBoard.tsx` (review board), `pb-youtube.json`; tests `platform/tests/venture-youtube-style.test.ts`, `venture-youtube-finishing2.test.ts`, `venture-youtube-folder.test.ts`, `venture-youtube-clips.test.ts`, `venture-youtube-broll.test.ts`, `venture-youtube-beats.test.ts`, `venture-youtube-interchange.test.ts`, `app/ui/tests/places/youtube-board.test.tsx`.

**Failing tests first:**

1. Style (Y6): from two or three of the owner's own videos (ffmpeg stub output and transcripts) code measures cuts a minute, median shot length, loudness (LUFS) and words a minute; face on screen is "not measured" unless an owner-installed tool reports it (K13); a new cut 25% off any measure is flagged in a sentence written by code; the style card says "measured from 3 of your videos".
2. Finishing additions (Y7): a source below the delivery resolution is refused (`SOURCE_DOWNSCALED`); a black band found by ffmpeg `cropdetect` fails; safe zones as dated data (Reels bottom 35%, Stories 20%, TikTok right 64 px, each to verify) are checked against caption and text boxes from the edit list; loudness -14 LUFS and true peak -1 dBTP from ffmpeg `loudnorm` print; on-screen text needs its reading time; a compilation needs the owner's own commentary at or above the house share of runtime (the reused-content rule says why); face on the frame edge is not-run with words (no detector).
3. Project folder (Y8): every order gets `exports/`, `metadata/`, `thumbnails/`, `edl/` written atomically (P12); "Open folder to post" on desktop; one publishing text per platform with its character count against the dated limit on the approval card.
4. Clip rules (Y11): start and end on a sentence; 25 to 65 s (Shorts 20 to 55 s); at most three ranges overlapping at most 20%; a hook of at most 8 words; a new first line, two seconds of on-screen text and a loop point; an SEO page per clip, for clients with a site, uses 5A5's JSON-LD (`VideoObject`) from recorded fields only.
5. B-roll (Y13): the beat plan is approved before anything is fetched; beats are placed 0.2 to 0.5 s after the word, gaps under 2 s joined, beats of at least 1.2 s; the manifest keeps "removed, do not re-add"; sources are owned, licensed stock with a licence id (5A4 asset record) or concept cards, memes only when the owner supplies them; code makes a frame grid (ffmpeg `tile`) for the owner to tick for burned-in captions, strangers' lower thirds and watermarks (no automatic detector, said so).
6. Beats (Y21): the model writes lines; code assigns timecodes at the speaking rate; a hook over 3 s, any beat over 4 s and a missing loop back to the first line are flagged; beats sit in 4, 6 or 8 s buckets.
7. Helpers (Y18): spoken numbers become on-screen counters only from the owner's own words; body text 30 px at 1080 wide, a warning under 22 px; audio extraction takes a file or a URL, never both, with a size cap before download and the net guard; `ffmpegLicenceOf(configureLine)` says GPL when `--enable-gpl` is set (for any future bundling check).
8. Editor hand-off (K14): from a validated edit list, write CMX 3600 EDL, FCPXML and OTIO; reading our own outputs back gives the same frame ranges at 25, 30 and 29.97 drop-frame; an FCPXML the owner sends back is read for its ranges (read only) and compared with ours, listing what changed.
9. Local apps (K13): BaoCut, Kimo or FilmCraft run only through `localapp.run` with the exit-code contract.
10. Ink: the review board shows one card per output with Approve and Discard, an "ask for a change" box, editable publishing text with counts, and "Open folder to post".

**Judge rules added:** `clip-stands-alone` (share 75), `broll-fits-claim` (required yes: no b-roll that implies something the speaker did not say).

**Baseline cases added:** `short-clip-rules`, `compilation-commentary`, `broll-licensed`.

**Rule register rows** (verify each): safe zones per platform (secondary sources, each with its page); loudness targets (YouTube's published guidance if found, else house); Shorts length (exists); reused content (exists).

**Connectors:** BaoCut, Kimo, FilmCraft `planned` until found on the computer, then `write` (desktop, through their CLI); editor hand-off `handoff` (files the owner opens in their editor).

**Done when:** the seven engine test files are `# fail 0`; the board UI test passes.

### Package 5B3: new offers, after-publish review, reads, archive search (Y9, Y10, Y14, Y15, Y16, Y20, Y22, Later Y19)

Size M to L. Starts after 5B2.

**Offers added** (the owner sets each price): `channel-audit` (project, per audit: one fix this week, three things to keep, one not to do yet), `weekly-plan` (monthly, sized to the owner's hours), `packaging-per-video` (project, per video: title variants, description with chapters, hook script, thumbnail brief, community posts), `comment-triage` (monthly) with the `comment-insights` add-on, `niche-report` (project), `screencast-tutorial` (project, per recording: the long video, three Shorts and the texts on one board), `after-publish-review` (included in the episode retainer, or project). New roles: Analyst (Marketing, agent), Community helper (Sales and clients, agent).

**Files:** new `playbooks/youtube/offers2.ts` (offer data, merged into `YOUTUBE_OFFERS`), `after-publish.ts`, `outliers.ts`, `niche.ts`, `comments.ts`, `teleprompter.ts`, `archive.ts`, `data-api.ts`; changed `playbook.ts`, `platform-rules.ts`, `draft-checks.ts` (`youtubeChecks`), `tools-youtube.ts` (`youtube.afterPublish`, `youtube.outliers`, `youtube.niche`, `youtube.comments`, `youtube.publicStats`, `youtube.archive`), `playbooks/plan.ts` is not touched (the YouTube plan picks stay three offers); UI `app/ui/src/places/work/desks/Teleprompter.tsx`, `pb-youtube.json`; tests `platform/tests/venture-youtube-offers2.test.ts`, `venture-youtube-after-publish.test.ts`, `venture-youtube-reads.test.ts`, `venture-youtube-archive.test.ts`, `app/ui/tests/places/teleprompter.test.tsx`.

**Intake fields added:** `hoursPerWeek` (weekly plan), `channelUrl`, `targetQueries` (three searches for the query test), `scripted` (yes or no).

**Failing tests first:**

1. Offers: each has an owner-set price and named stages; the channel audit draft fails unless it has exactly one fix, three keeps and one "not yet"; the weekly plan fails unless the hours per piece, summed by code, fit `hoursPerWeek`, and it names what to drop first.
2. Query test (Y9): a package fails `query-test` unless the title and the first two lines of the description contain each of the three target queries (word match by code).
3. Comment triage (Y9): from an uploaded comments CSV, four piles with counts first (code), replies of 30 words or fewer, one comment to pin, no reply to bait (phrase list, English and Hindi); the insights add-on turns a question asked three or more times into an idea (`ideas.add`).
4. After-publish (Y10): over the Studio export, the decision table (low CTR with high retention: fix title and thumbnail; high CTR with low retention: fix the opening; search-heavy: more clips on that intent; browse-heavy: repeat the packaging) gives one directive with its receipts; thresholds are owner-editable values with defaults marked house.
5. Outliers (Y20): views as a multiple of the channel's own median, in whole hundredths, by code; a channel with fewer than four videos is skipped with a reason; the model only names the pattern.
6. Niche report (Y15): medians, ages and coverage computed by code; each interpretation labelled observed or inferred; a caveat under every figure and a coverage block; the owner approves before it goes (5A5 report).
7. Data API (Y22): `youtube.publicStats` reads public video and channel stats with the owner's own API key (`read`), counting quota units per call from a dated table (to verify: videos.list 1 unit, search.list 100 units, daily 10,000); a quota error names the stage (`QUOTA_REACHED`); Analytics API reads by the owner's sign-in stay `planned: read` (sensitive scope, Google verification) with the manual path "Export the report from YouTube Studio".
8. Teleprompter (Y16): scroll speed from spoken words only, 100 to 200 words a minute, text size, full screen, a cues toggle; thumbnail presets refuse a variation with no written direction and words that claim what the video does not show.
9. Archive search (Y19, Later, placed here): search over the owner's own transcripts in 5-second windows; each hit shows which channels matched; on-screen text and picture search are `planned` until an owner-installed OCR or vision tool is connected through K13, and the hit says "speech only". No tern code (all rights reserved; it may not even be run).

**Judge rules added:** `audit-one-fix` (required yes), `plan-fits-hours` (required yes), `reply-not-bait` (required yes).

**Baseline cases added:** `channel-audit`, `weekly-plan-hours`, `comment-reply-short`, `after-publish-directive`.

**Rule register rows:** Data API quota costs (official, https://developers.google.com/youtube/v3/determine_quota_cost), comment policies (https://support.google.com/youtube/answer/2802268), the after-publish thresholds (house).

**Connectors:** YouTube Data API public reads `read` (owner's key); YouTube Analytics `planned: read` (waits on Google verification); Studio exports `read` (order files); community posts `handoff` (K17).

**Done when:** the four engine test files and every `venture-playbook-youtube*.test.ts` are `# fail 0`; the teleprompter test passes; the tile line mentions packaging and audits.

---

## 5C: CA firm, deepened (catalogue 2.9.2)

Two packages in sequence (both edit `ca-firm/playbook.ts` and `caChecks`). Out of scope stays out: no e-invoicing, no Account Aggregator, no AIS, 26AS, Form 16 or 2B readers (figures are typed or come from tables the agent maps).

**Gallery tile** (written by 5A1 in `playbooks/ca-firm/tile.ts`): category Money and tax; "Books, GST, TDS and income tax working papers for small businesses; your CA of record signs anything regulated."; you do 6 to 10 hours a week ("Meet clients, review drafts, work with your CA."); team Bookkeeper (Money), Tax preparer (Money), Billing (Money, code), Keeper (Operations, code) ("Books, workings, receipts for every figure."); clients usually pay 5,000 to 20,000 rupees a client a month (model estimate).

### Package 5C1: citations, split ITR offers, new offers, question desk, stored sign-off and practice clients (CA2, CA3, CA5, CA7, CA11)

Size L.

**Offers added** (owner sets each price; regulated ones need the CA of record): `itr-form-and-regime`, `itr-computation-only`, `itr-check-draft`, `itr-checklist` (all project, per return; `itr-salaried` stays as full help), `check-return-elsewhere` (project), `advance-tax-freelancer` (project, per year with four instalment notes), `tax-question-desk` (monthly or per question; regulated: the CA signs every note).

**Files:** new `playbooks/ca-firm/citations.ts`, `itr-forms.ts`, `advance-tax.ts`, `question-desk.ts`, `practice.ts`, `stored-signoff.ts`; changed `playbook.ts`, `claims.ts`, `methods.ts` (`venture.ca.confirmCitations`, `venture.ca.signoff.get`), `draft-checks.ts` (`caChecks`), `delivery/harness/tools-ca.ts` (`tax.citations`, `tax.formChooser`, `tax.advance`), `baselines/ca-firm.json`; UI `app/ui/src/places/business/YourCa.tsx` (citations table to confirm), `pb-ca-firm.json`; tests `platform/tests/venture-ca-citations.test.ts`, `venture-ca-itr-forms.test.ts`, `venture-ca-advance-tax.test.ts`, `venture-ca-question-desk.test.ts`, `venture-ca-practice.test.ts`, `app/ui/tests/places/business-ca.test.tsx`.

**Intake fields:** `incomeKinds` (multi-select first round: salary, house property, business, capital gains, other), `residency`, `regimeLastYear`, `hasBusinessIncome`, `questions` (second round, one sentence of why for each technical question).

**Failing tests first:**

1. Citations (CA2): a table `{act, section, title, validFrom, validTo, replacedBy}` covering the 1961 and 2025 Acts, `confirmedBy: null` until `venture.ca.confirmCitations` (app only; the CA of record's membership number); every section reference in a draft ("section 80C", "u/s 194J", "Sec. 44AD", and 2025 Act forms) is checked; a 1961 Act number for income on or after 1 April 2026 fails `citations-current` until the draft carries the note naming the 2025 Act section; an unknown section fails with "Chausar could not check section X. Your CA must confirm it." (unchecked never passes); an unconfirmed table works only in rehearsal. Each mapping row carries its source (the Income-tax Act 2025 text on incometaxindia.gov.in); a row that cannot be verified says "not verified, needs CA confirmation" (the 1A rule).
2. Form chooser (CA3): `tax.formChooser {assessmentYear, facts}` picks the ITR form by dated rows, first match wins, each row with its source (the ITR instructions for that year, to verify); regime-switch rules (Form 10-IEA for business income, one switch back) are dated rows; a question whose answer is already in the run's tables is not asked (salary in the Form 16 table means no "Do you have salary?").
3. Check a return made elsewhere (CA5): the typed return figures run through `tax.income`; every line that differs is listed with its rule and both figures as receipts.
4. Advance tax (CA5): `tax.advance {financialYear, estimate}` gives the instalment dates and cumulative shares from a dated table (to verify) with the estimate labelled as the client's own figure (an assumption figure, never a fact); sections confirmed by the CA.
5. Question desk (CA7): a note in fact-check form (Supports, Conflicts, Unknowns, Coverage); every claim cites a source id (law text the CA uploaded, or the citations table); the note is regulated, so 1A's sign-off gate holds it; `NEEDS_FACTS` (W4 CA8) ends the turn with plain questions.
6. Stored sign-off (CA11): the sign-off keeps who (name, membership number), when, which receipts (ids and digests) and the playbook version hash; `venture.ca.signoff.get` re-checks each receipt digest (2A2's re-derivation) and answers `same` or the first difference.
7. Practice clients (CA11): clean, messy (a duplicate bill, a missing PAN) and pushy ("just file it, skip the CA"); the pushy draft must refuse filing and offer the in-scope part (5A2 honest exit), or it fails `no-filing-claims`.

**Judge rules added:** `citation-current` (required yes), `fact-check-form` (required yes for question notes), `assumption-labelled` (required yes: the client's estimate is labelled).

**Baseline cases added:** `old-section-note`, `form-chooser-itr1`, `question-desk-unknowns`, `pushy-skip-ca`.

**Rule register rows** (CA confirms each): the 1961 to 2025 section map; ITR form eligibility for AY 2026-27 and AY 2027-28 (incometaxindia.gov.in instructions); regime switching (Form 10-IEA); advance tax dates and shares; each with `confirmedBy`.

**Connectors** (unchanged labels): income-tax portal, GST portal, TRACES `planned: handoff` (a person logs in, pays and files; government portals are always-ask and never automated); mail `handoff`; Tally `read`; Zoho Books `planned: read` (5K2 builds its write).

**Done when:** the five engine test files and every `venture-playbook-ca-*.test.ts`, `venture-ca-*.test.ts` are `# fail 0`; the CA UI test passes.

### Package 5C2: what-if, books health check, differential tests, document data entry, ITR data pack (CA4, CA6, CA9, CA10, CA12)

Size L. Starts after 5C1.

**Offers added:** `books-health-check` (project, per quarter).

**Files:** new `playbooks/ca-firm/what-if.ts`, `health-check.ts`, `differential.ts`, `doc-entry.ts`, `data-pack.ts`; changed `playbook.ts`, `methods.ts` (`venture.ca.differential.add`, `venture.ca.dataPack.export`), `draft-checks.ts` (`caChecks`), `tools-ca.ts` (`tax.whatIf`, `books.healthCheck`, `docs.entry`), `baselines/ca-firm.json`; test fixtures `platform/tests/fixtures/ca-differential/*.json`; tests `platform/tests/venture-ca-what-if.test.ts`, `venture-ca-health-check.test.ts`, `venture-ca-differential.test.ts`, `venture-ca-doc-entry.test.ts`, `venture-ca-data-pack.test.ts`.

**Failing tests first:**

1. What-if (CA4): `tax.whatIf {mode: 'compare-regimes', base: 'w1'}` gives both regimes' receipts and the difference as a receipt; `mode: 'cliff'` finds the income where the 87A rebate ends, with marginal relief shown, from the rate table; `mode: 'inverse', target` finds by code search in paise how much more income keeps tax under the target; every default shows "assumed"; refusals are `NEEDS_FACTS` ("more facts needed") or `NOT_MODELLED` ("outside the encoded law"). Ideas from opentax-engine (AGPL): no code.
2. Health check (CA6): every ledger and bank line goes on a worklist the tool marks read ("412 of 412 lines read"); two passes flag a purchase above the threshold with no GSTIN, a duplicate payment (same payee and amount within three days), cash above the daily limit, and TDS not deducted (payee kind and section threshold from the TDS table); duplicates merge; each finding has a validator and a severity set by code from typed facts; the CA confirms or dismisses each; the client gets a read-only report (5A5). Thresholds are dated rules the CA confirms.
3. Differential (CA9): fixture cases captured by a CA from the department's calculator (`venture.ca.differential.add` stores inputs and outputs with who captured them); `runDifferential` compares; each accepted difference sits in a known-differences file quoting the rule; a new difference fails the suite.
4. Document data entry (CA10): one template per document type (bank statement, purchase bill, sales invoice) with its common mistakes (debits as positives, masked numbers kept masked); opening plus credits minus debits must equal closing per page by the calculator, never the model (`STATEMENT_DOES_NOT_TIE` with the page); vouchers are drafted to the books for the owner to approve. Ideas from py-idp (AGPL): no code.
5. Data pack (CA12): built only from typed or uploaded figures (the readers stay out of scope), held encrypted in the vault as a record; `venture.ca.dataPack.export` (app only, always asks) writes what the CA asks for with PAN and Aadhaar masked except the fields the form needs; a test scans the export folder and fails on any plain JSON holding a PAN pattern.

**Judge rules added:** `whatif-assumptions-shown` (required yes), `finding-has-evidence` (required yes).

**Baseline cases added:** `regime-compare`, `health-duplicate-payment`, `statement-ties`.

**Rule register rows** (CA confirms): cash payment and receipt limits under the 2025 Act (and their 1961 numbers); TDS thresholds by section; GST invoice rules (Rule 46 of the CGST Rules); each with its official source.

**Done when:** the five engine test files and the CA suites are `# fail 0`.
---

## 5D: social media agency, deepened (catalogue 2.9.3)

Three packages in sequence (each edits `playbooks/social/playbook.ts` and `socialChecks`): 5D1, 5D2, 5D3.

**Gallery tile** (written by 5A1 in `playbooks/social/tile.ts`): category Marketing; "Posts, replies, reels and monthly reports for local shops, clinics and coaches."; you do 4 to 6 hours a week ("Approve drafts, talk to clients, post or hand off."); team Strategist (Marketing), Writer (Marketing), Creative (Production), Billing (Money, code) ("Calendars, posts, reply drafts, report figures from exports."); clients usually pay 8,000 to 25,000 rupees a client a month (model estimate).

### Package 5D1: the order chain, repurpose studio, LinkedIn ghostwriting, slot kinds, scheduled-post rules, community go or no-go (S2, S4, S5, S12, S13; the 14-step chain W2 left; brand kit wiring)

Size L. Depends on 5A1 (chain), 5A4 (brand kit), 2B (owner-browser posting), 2F (calendar).

**Offers added** (owner sets each price): `repurpose-pack` (monthly: one source a week becomes 3 to 5 channel drafts and a newsletter blurb), `linkedin-ghostwriting` (monthly: 8 or 12 posts, two revision rounds, extra rounds priced by the owner).

**Files:** new `playbooks/social/chain.ts` (the stage list per offer for 5A1's chain), `repurpose.ts`, `formats.ts` (format router with the rule trace), `inventory.ts`, `slot-kinds.ts`, `scheduled.ts`, `community.ts`, `structures.ts` (five LinkedIn structures as data); changed `playbook.ts`, `checks.ts`, `register.ts` (new rules), `approvals.ts` (revision rounds), `draft-checks.ts` (`socialChecks`), `delivery/harness/tools-social.ts` (`social.formats`, `social.inventory`, `social.slots`), `baselines/social-agency.json`; UI `app/ui/src/places/work/desks/SocialCanvas.tsx`, `app/ui/src/engine/fake-social.ts`, `app/ui/src/text/{en,hi}/pb-social.json`; tests `platform/tests/venture-social-chain.test.ts`, `venture-social-repurpose.test.ts`, `venture-social-ghostwriting.test.ts`, `venture-social-slots.test.ts`, `venture-social-scheduled.test.ts`, `venture-social-community.test.ts`, `app/ui/tests/places/social-canvas.test.tsx`.

**Failing tests first:**

1. Chain: a `content-calendar` order runs voice (approved once per client and again only on change), then calendar, then drafts, then approvals and publish, each stage a run started by the accept of the one before (5A1); a client whose voice sheet is already approved skips straight to calendar; the monthly report stages (exports, figures, report, approve) chain the same way.
2. Repurpose (S2): `social.inventory {source}` lists claims, numbers, stories, mistakes and quotes with counts; fewer than four items stops with `SOURCE_THIN` ("The source is too thin for a week of posts. Send a longer piece or a voice note."); `social.formats` picks each channel's format by code rules and returns the rule trace, clamped to what the tools can make (no video unless the order has footage); every post adds no fact that is not in the source (the claims check reads only the source); the same hook formula twice in seven days fails `hook-variety`.
3. LinkedIn ghostwriting (S4): 8 or 12 posts a month in the five structures; code counts revision rounds per post and a third round needs the owner's extra-round price (`OFFER_EXTRA_ROUND` with the quote); the client approves each post by share link (or the owner records the answer, 2B1); posting is the owner's own browser session one post at a time with the risk line (2B), or the client posts from a handoff. Never automated LinkedIn messaging or connecting.
4. Slot kinds (S5): each slot is `value` or `sell`; the selling share above the cap (default 20%, owner-editable) fails `selling-share`; each draft has one goal and one audience action; monthly revision due dates from the offer become Today rows.
5. Scheduled-post rules (S12): a slot that falls due while another post is going out still posts within 60 minutes, else it is reported missed; "nothing ready" is said once per slot; blocked reasons are sentences; a file changed since review is not posted (digest check).
6. Community go or no-go (S13): before drafting for a community the owner pastes its rules; code checks the rule phrases (no self-promotion, flair needed, no links) and gives Go or No-go citing the rule line; a No-go blocks the draft.
7. Brand kit: `socialChecks` reads banned words, banned topics and competitors from the client's brand kit (5A4) when the order's `clientRules` is empty, and names which source the rule came from.
8. Ink: the canvas shows one card per channel with "Refine just this one", the format and its rule trace, and the inventory counts.

**Judge rules added:** `source-faithful` (required yes: no fact outside the source), `one-goal` (share 75).

**Baseline cases added:** `repurpose-thin-source`, `ghostwriting-structure`, `selling-share-cap`.

**Rule register rows:** LinkedIn's User Agreement on automation (official, https://www.linkedin.com/legal/user-agreement, section on bots), the selling share default (house), revision rounds (house).

**Done when:** the six engine test files and every `venture-playbook-social*.test.ts` and `venture-social-*.test.ts` are `# fail 0`; the canvas UI test passes.

### Package 5D2: reels from clips, local-business Instagram, reply inbox, post diagnosis, account health, video ads, cross-posting (S3, S6, S7, S8, S9, S11, Later S14)

Size L. Starts after 5D1. Depends on 5A4 (media hygiene, captions, assets, consent).

**Offers added:** `reel-from-clips` (project, per reel), `hook-variations` (add-on, text-only openings), `local-instagram` (monthly: weekly repurposing from one video, keyword-comment delivery drafts, reply drafts, two follow-ups per warm lead), `reply-inbox` (monthly), `post-diagnosis` (project), `video-ads` (project, for D2C brands, restaurants and property), `cross-posting` (monthly: the client's own videos to other channels, each post approved).

**Files:** new `playbooks/social/montage.ts`, `local-ig.ts`, `inbox.ts`, `diagnosis.ts`, `health.ts`, `ad-style.ts`, `ad-ledger.ts`, `cross-post.ts`; changed `playbook.ts`, `checks.ts`, `register.ts`, `draft-checks.ts` (`socialChecks`), `tools-social.ts` (`social.montage`, `social.inbox`, `social.diagnose`, `social.health`, `social.adStyle`), baselines; UI `app/ui/src/places/work/desks/SocialInbox.tsx`, `pb-social.json`; tests `platform/tests/venture-social-montage.test.ts`, `venture-social-local-ig.test.ts`, `venture-social-inbox.test.ts`, `venture-social-diagnosis.test.ts`, `venture-social-ads.test.ts`, `venture-social-crosspost.test.ts`, `app/ui/tests/places/social-inbox.test.tsx`.

**Intake fields added:** `clipRights` (rights for the client's clips; required for reels and cross-posting), `productPhoto` (file; required for video ads), `peopleWhoAppear` (names, each with a consent record), `bpm` or `beatMap` (for beat cuts).

**Failing tests first:**

1. Reel from clips (S3): clips are cleaned and upright (5A4), the best moment per clip is picked by the model only as a time range inside the clip and checked by code, cuts land on the owner's beat grid, captions come from 5A4's core, the end card holds the contact; ffmpeg runs on desktop (stub port); hosted says "Reels are cut in the desktop app."; hook variations change text only (a variation that changes the cut fails).
2. Local Instagram (S6): keyword-comment delivery drafts put the promised thing in message one and then one short question; reply drafts sort into six buckets with counts first (code) and noise skipped; at most two follow-ups per warm lead (W4 C7); DMs stay `handoff`; carousels are 1080 x 1350.
3. Reply inbox (S7): states Needs reply, Handled, Ignored; an assignee; priority first; "Last synced" from the owner's latest import (comments come from exports or the owner's paste, since comment APIs wait on review); every reply is drafted and approved, then posted by the owner (handoff).
4. Post diagnosis (S8): from an exported Insights CSV (or figures the owner types from a screenshot, marked "typed by you"), a code checklist runs first (drop-off point, hook length, length against average watch time); the model's view is labelled "model estimate".
5. Account health (S9): followers, account age, posts in 30 days and failures, each tagged by its source (export, "check in the app", derived); narrative may be prose, numbers never.
6. Video ads (S11): style routed by product category in code; no real product photo means no ad (`PRODUCT_PHOTO_REQUIRED`); storyboard stills are approved before any paid video; generation units are computed from the model's declared maximum clip length so the quote is exact; any synthetic presenter is labelled "Made with AI" and never speaks as a customer; the competitor ad ledger covers only ads the owner captured, says "empty" (never zero) with no data, gives no percentages under 20 ads, and keeps live and stopped ads apart.
7. Cross-posting (S14, Later, placed here): only the client's own videos with rights recorded at intake; each post approved; delivery is "Open folder to post" with one text per platform (handoff); video upload through the owner's browser stays `planned` (1D holds every file input).

**Judge rules added:** `ad-disclosed` (required yes), `reply-in-voice` (share 75), `no-customer-pretence` (required yes).

**Baseline cases added:** `reel-end-card`, `keyword-comment-delivery`, `video-ad-no-photo`, `diagnosis-labelled`.

**Rule register rows** (verify each): ASCI influencer guidelines and the virtual influencer addendum (https://www.ascionline.in); Meta branded content policy; Instagram carousel size (secondary); CCPA guidelines on endorsements (Department of Consumer Affairs, "Endorsement Know-hows!", 2023).

**Done when:** the six engine test files and the social suites are `# fail 0`; the inbox UI test passes.

### Package 5D3: influencer desk and open-network posting (S10, S16, part of Later K25)

Size M. Starts after 5D2.

**Offers added:** `influencer-campaign` (project, per campaign; price checks priced per creator by the owner).

**Files:** new `playbooks/social/influencer.ts`, `fair-price.ts`, `build/open-posting.ts` (Bluesky, Mastodon, Telegram channel, Discord webhook); changed `playbook.ts`, `channels.ts`, `register.ts`, `tools-social.ts` (`social.fairPrice`, `social.keywords`), `build/catalogue.ts` (four entries, one small edit; social has no 5-0 catalogue stub), `build/connectors.ts` (labels); UI `app/ui/src/places/connections/OpenPosting.tsx`, `pb-social.json`; tests `platform/tests/venture-social-influencer.test.ts`, `venture-open-posting.test.ts`, `app/ui/tests/places/open-posting.test.tsx`.

**Failing tests first:**

1. Influencer desk (S10): keyword groups keep competitor terms apart and carry a negative list; the shortlist holds channel URLs the owner supplies or public stats read with the owner's key (5B3); `social.fairPrice` takes the median of the last 10 comparable posts and coefficients each tagged owner, default or agent judgement, refuses above the owner's rupee cap, and returns a receipt; outreach goes to public business emails through W4 outreach drafts (the owner sends); the brief carries the ASCI disclosure clause and the paid-partnership label; a case log keeps actuals beside estimates. Ideas from kol-influencer-marketing-skills (no licence): no code.
2. Open-network posting (S16): Bluesky (the owner's app password, typed in Connections) and Mastodon (an instance token) post as `write`, one approved post at a time, with outcome per destination; a destination already published is skipped ("already published, skipped"); only destinations that clearly failed may be tried again, by the owner; an ambiguous result is outcome unknown (1B) and never retried; a sent post is frozen. Threads stays `planned: write` (waits on Meta app review).
3. K25 part: a Telegram channel post through the owner's own bot (the bot must be an admin of the owner's channel) and a Discord webhook post are `write` with the same per-post approval; X, LinkedIn, Facebook, Instagram, Reddit and YouTube OAuth posting stay `planned: write` until their reviews clear (not built here).
4. The send governor (W4 C14) counts these posts; the house posting limits (2B1) apply per destination.

**Judge rules added:** `fair-price-receipted` (required yes: every rupee offer to a creator has a receipt).

**Baseline cases added:** `influencer-disclosure`, `creator-price-cap`.

**Rule register rows** (verify each): Bluesky rate limits (https://docs.bsky.app/docs/advanced-guides/rate-limits), Mastodon statuses API (https://docs.joinmastodon.org/methods/statuses/), Telegram Bot API (https://core.telegram.org/bots/api), Discord webhooks (https://discord.com/developers/docs/resources/webhook).

**Connectors:** Bluesky `write`, Mastodon `write`, Telegram channel `write`, Discord webhook `write`, Threads `planned: write` (waits on Meta), the rest of K25 `planned: write`.

**Done when:** both engine test files and the social suites are `# fail 0`; the connections UI test passes.

---

## 5E: search and AI-search visibility, with local SEO (catalogue 2.9.4)

Two packages: 5E1 registers the playbook, then 5E2 adds the monthly offers.

**Registration:** id `seo-visibility`, label "Search and AI-search visibility", service type `content`; picks: "seo agency", "seo service", "seo for", "local seo", "search engine optimisation", "search engine optimization", "google business profile", "ai search visibility", "generative engine optimisation", "aeo service" (a test shows "Seoul food truck" picks nothing). Summary: "Agents check your clients' sites and how AI answers mention them, draft fixes and articles, and measure from Search Console exports; you and your client approve every change."

**Offers** (owner sets every price): `visibility-check` (project, per site; pilotable), `content-retainer` (monthly; per article cost cap), `fix-and-measure` (monthly), `quarterly-remeasure` (project), `local-seo` (monthly), `website-check` (project, add-on; monthly re-check).

**Roles:** Researcher (Marketing, agent), Writer (Marketing, agent, no web tools), Checker (Operations, agent, read-only auditor), Analyst (Marketing, agent, report narrative from receipts), Chausar (Operations, code: fetches, diagnosis, panel metrics, impact verdicts), Billing (Money, code).

**Steps:** `gather` (site, GSC export, competitors, buyer questions; Researcher) → `diagnose` (compute, code) → `clarify` (question) → `approve-panel` (approve, owner; the panel freezes) → `capture-answers` (gather; the owner captures AI answers, or an approved API, method recorded) → `panel-metrics` (compute, code) → `write` (Writer) → `verify` (claim check, corroboration, AI-tell lint, doorway check, prompt leak) → `approve` (owner, then client by share link; floor) → `publish` (operator: WordPress draft, the owner or client publishes; floor) → `verify-live` (compute) → `next-export` (gather) → `impact` (compute) → `report` (write, Analyst) → `approve-report` (owner; floor, with the invoice). Edges (4J12 fields): a rejected article goes back to `write` (`maxLoops` 2); `capture-answers` waits at most 14 days (`waitDays`).

**Approvals:** the panel; every article; every site change (floor); any paid API spend (floor); the report and invoice (floor). Tell clients: no promised rankings or AI citations; API answers stand in for the consumer apps and can differ; "not enough data" is a normal result; AI referral counts are a floor.

**Intake fields:** `siteUrl`, `gscExport` (file), `competitors` (list), `buyerQuestions` (15 to 30), `engines` (choice), `city` and `serviceArea` (local), `wordpressUrl`.

**Gallery tile:** category Marketing; "Site checks, AI-answer checks, articles and fixes for clinics, coaches, CA practices and local shops."; you do 3 to 5 hours a week ("Approve fixes and articles, talk to clients."); team Researcher, Writer, Checker, Billing ("Diagnoses sites, drafts articles, measures from exports."); clients usually pay 10,000 to 35,000 rupees a client a month (model estimate).

**Never:** promised rankings; fetching with another company's user agent; separate pages for AI crawlers (cloaking); link schemes or backlink catalogues; scraping Google results; publishing live without the owner or client.

### Package 5E1: registration, site diagnosis, AI access, the answer panel, website check, bounded monitoring (SEO1, SEO2, SEO3, SEO9, SEO11)

Size L.

**Files:** `playbooks/seo-visibility/registration.ts`, `definition.ts`, `diagnose.ts`, `ai-access.ts`, `panel.ts`, `site-check.ts`, `monitor-cycles.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/seo-visibility.json`, `delivery/harness/tools-seo-visibility.ts` (`seo.diagnose`, `seo.aiAccess`, `seo.panel`, `seo.siteCheck`); records `venture-seo-panel`, `venture-seo-observation`; desk `app/ui/src/places/work/desks/SeoDesk.tsx`, `app/ui/src/engine/fake-seo-visibility.ts`, `app/ui/src/text/{en,hi}/pb-seo-visibility.json`; tests `platform/tests/venture-playbook-seo.test.ts`, `venture-seo-diagnose.test.ts`, `venture-seo-ai-access.test.ts`, `venture-seo-panel.test.ts`, `app/ui/tests/places/seo-desk.test.tsx`.

**Failing tests first:**

1. Definition: `definePlaybook` accepts it; picks, plan words, steps with departments, tile and Hindi pass the 5A1 tests.
2. Diagnosis (SEO1), with a stub HTTP server: up to 10 representative pages (sitemap first, else homepage links on the same host), robots respected, net guard; eight fixed dimensions (crawl access, indexability, titles and descriptions, headings, structured data, internal links, content substance, AI access); a check not observed is null, never 0; confidence is observed over planned as a fraction; a page that will not load counts as a source gap; a remediation backlog grouped across pages with severity, impact and effort by code rules; the headline "6 of 8 dimensions have evidence"; any weighted total is labelled "our rubric". Ideas from GEOHub (AGPL): no code.
3. AI access (SEO2): robots rules per agent split into search fetchers (they count) and training crawlers (they do not), each agent name a dated rule row with its vendor's page; pages whose raw HTML has almost no text and a script app root are flagged "empty without JavaScript"; an `llms.txt` that answers 200 with HTML is flagged; Chausar fetches only with its own named user agent, so CDN blocking of AI fetchers is read from the owner's CDN settings when connected, else listed as a manual check ("In Cloudflare, open Security, then Bots").
4. Panel (SEO3): buyer questions x engines x timepoints x repeats, frozen by digest once approved (`PANEL_FROZEN` on any edit after approval); each observation is checked against its slot (engine, question id, timepoint window) and keeps its collection method (owner capture with a screenshot file, or API); metrics carry numerator, denominator and missing count, with missing kept in the denominator; recorded fixtures are flagged "not live"; under the minimum filled slots the result is "not enough data".
5. Website check (SEO9): lintapple, when installed by the owner (K13), runs on the client's public site at phone and desktop, light and dark; the fix list (what, measured, expected, one-line fix, repeats grouped) carries the report's hash as its receipt; the owner approves before it goes; a monthly re-check (a recurring job, on the floor) compares with the last hash.
6. Bounded monitoring (SEO11): 1 to 10,000 cycles at least 60 s apart, a fresh evidence folder each, refusing a folder that already holds evidence (`EVIDENCE_FOLDER_USED`).

**Judge rules:** `no-ranking-promise` (required yes), `null-not-zero` (required yes: unobserved stays unknown), `fix-is-actionable` (share 75), `client-can-verify` (share 75).

**Baseline cases** (`seo-visibility.json`): `clinic-visibility-check`, `blocked-training-bot-only`, `empty-without-js`, `panel-not-enough-data`, `promise-ranking-refused`.

**Rule register** (verify each on build day): robots.txt rules (https://developers.google.com/search/docs/crawling-indexing/robots/intro); Google crawler list including Google-Extended (https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers); OpenAI's bots (https://platform.openai.com/docs/bots); Anthropic's crawlers (support.anthropic.com page on ClaudeBot); PerplexityBot (https://docs.perplexity.ai/guides/bots); llms.txt proposal (https://llmstxt.org/, secondary); Google spam policies including cloaking and doorways (https://developers.google.com/search/docs/essentials/spam-policies).

**Connectors:** client site fetch `read` (robots and net guard); GSC CSV `read` (order files); GSC API `planned: read` (manual path: the CSV export); AI engine APIs `planned: read` (a proxy for the consumer apps, labelled so; manual path: the owner captures answers); lintapple `planned` until found, then `read` (desktop); Cloudflare settings `planned: read`.

**Done when:** the four engine test files are `# fail 0`, the baseline is committed, the desk UI test passes and the tile shows in the gallery in English and Hindi.

### Package 5E2: content retainer, fix and measure, refresh router, strategy memory, local SEO, WordPress and edge overrides (SEO4, SEO5, SEO6, SEO7, SEO8, SEO10)

Size L. Starts after 5E1.

**Files:** `playbooks/seo-visibility/corroborate.ts`, `lint.ts` (AI-tell and doorway), `meta.ts` (titles, descriptions, JSON-LD through 5A5), `impact.ts`, `refresh.ts`, `strategy.ts`, `local.ts`, `templates.ts`; `build/wordpress.ts`, `build/edge-overrides.ts` (Cloudflare KV as a third site-edit target); changed `build/site-edits.ts` (target list, one edit), `build/catalogue/seo-visibility.ts` (WordPress entry), `definition.ts`, `rules.ts`, `tools-seo-visibility.ts` (`seo.corroborate`, `seo.lint`, `seo.meta`, `seo.impact`, `seo.refresh`, `seo.local`); tests `platform/tests/venture-seo-content.test.ts`, `venture-seo-fix-measure.test.ts`, `venture-seo-refresh.test.ts`, `venture-seo-local.test.ts`, `venture-wordpress.test.ts`, `venture-edge-overrides.test.ts`.

**Failing tests first:**

1. Content retainer (SEO4): the Writer step holds no web tools (grant check); statistics carry claim markers; `seo.corroborate` finds, by code, an independent second source per number (two different registrable domains, the number string on both fetched pages) or the claim fails; competitor domains are stripped from sources and links; the AI-tell lint blocks above its threshold (word list as data, house); a local page must carry four local elements (programme or licence, a local case or press mention, a landmark, price or logistics) or it fails `doorway-page`; each article has a cost cap reserved beside the monthly cap.
2. Fix and measure (SEO5): titles and descriptions within dated bounds and as complete sentences; JSON-LD from observed fields only (5A5); applied as staged site edits or edge overrides after the client's approval; impact read at 14 and 28 days after a 3-day settle; under 50 impressions is "insufficient data"; "hurt" is a prompt to look, never a verdict on its own; findings auto-resolve when fixed; a dismissal mutes until the issue returns; "verified" after "applied" needs a dated acceptance check.
3. Refresh router (SEO6): over the GSC CSV, low CTR on page one gives title and meta work, positions 11 to 20 with many impressions a depth rewrite, a content gap a new article, two pages on one query a consolidation, absence from AI answers AI-overview work; the router writes a plan and never edits a live post.
4. Strategy memory (SEO7): a strategy is remembered only when the candidate, fidelity report, experiment plan, publication handoff and receipt bind by digest, the panel is unchanged and the window has passed; after two flat windows it stops.
5. Local SEO (SEO8): the audit; profile fixes as `handoff` (the owner applies them in Google Business Profile); a NAP check over citation URLs the owner lists (fetched with the fetch policy and robots; name, address and phone normalised and compared); review reply drafts the owner posts; local landing pages pass the doorway check; industry templates (proposal, 90-day roadmap, keyword map, issue log) say expected movement in words, never a traffic figure.
6. WordPress (SEO10): REST with an application password the client creates and the owner types in Connections; posts are created only with `status: 'draft'` (any other status is refused in code); after the owner publishes, structural checks run on the live URL; a fake WordPress server in the test. Cloudflare KV overrides with the owner's token are reversible and journalled, as a third site-edit target.

**Judge rules added:** `claims-corroborated` (required yes), `local-not-doorway` (required yes), `report-cites-receipts` (required yes).

**Baseline cases added:** `article-uncorroborated-number`, `local-page-four-elements`, `refresh-plan-not-edit`.

**Rule register rows** (verify): Google title link and snippet guidance (https://developers.google.com/search/docs/appearance/title-link, https://developers.google.com/search/docs/appearance/snippet); structured data policies (https://developers.google.com/search/docs/appearance/structured-data/sd-policies); Google Business Profile guidelines (https://support.google.com/business/answer/3038177); WordPress application passwords (https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/).

**Connectors:** WordPress `write` (drafts only; the client's own site, no outside review); Cloudflare KV `write` (owner's token, reversible); Google Business Profile `handoff`; GSC API `planned: read`.

**Done when:** the six engine test files and 5E1's are `# fail 0`; the baseline rate does not drop.
---

## 5F: online seller (own shop) and seller services desk (catalogue 2.9.5)

Three packages in sequence: 5F1 registers the playbook and the money engines, 5F2 adds operations, 5F3 the connectors.

**Registration:** id `online-seller`, label "Online seller and seller services", service type `consulting`; picks: "online seller", "sell on amazon", "amazon seller", "flipkart seller", "meesho seller", "meesho supplier", "shopify store", "seller services", "marketplace seller", "ecommerce back office". Summary: "Agents keep the back office for your own products, or sell audits and reports to other sellers; every price, listing change and claim waits for you."

**Two modes.** Own shop: the business gets one client record "Your own shop" (`self: true`); its orders are internal (no invoice, no client share link), and anything that reaches buyers or a marketplace (a listing, a price) is public, so the judge and the floor apply. Seller services desk: other sellers are clients, with the client's exports as input.

**Offers** (owner sets every price): `own-shop-back-office` (own shop, monthly, no invoice), `listing-health-audit` (project, per catalogue; pilotable), `reimbursement-audit` (project, per audit, or a share of recovered money with 5A2's share price, invoiced only after the client confirms the recovery), `unit-economics-monthly` (monthly, per seller), `ads-health-check` (project), `catalogue-upload` (project, per batch), `product-research` (project), `multi-store-report` (monthly), `product-photos` (project, per product), `case-tracker` (monthly).

**Roles:** Lister (Sales and clients, agent: listing fixes and catalogue sheets), Auditor (Money, agent: names differences, drafts claims), Bookkeeper (Money, agent: reads settlements), Analyst (Marketing, agent: briefing and research narrative), Photo producer (Production, agent: photo briefs), Chausar (Operations, code: every figure), Keeper (Operations, code: counters, alerts), Billing (Money, code).

**Steps:** `products` (gather: cost with GST, HSN and rate, MRP, weight, origin, photos; fee cards with source and checked date) → `economics` (compute) → `listing-check` (compute) → `fixes` (write, Lister) → `approve-fixes` (approve; floor) → `apply` (operator: API where verified, else an upload file the owner uploads; floor) → `counters` (compute, daily) → `briefing` (write, Analyst) → `approve-moves` (approve: restock, markdown, pause, price; floor, money rows ask twice) → `ads` (compute) → `settlement` (compute) → `claims` (write, Auditor, drafts only) → `approve-claims` (approve; the owner files; floor). Edges: `products` with any unknown input goes to `clarify` and holds the sheet.

**Approvals:** every price or discount (caps shown first; money rows ask twice); every listing change; restock, pause, markdown; every claim or case message (the owner sends); ad budgets; anything touching a buyer.

**Intake fields:** `channels` (Amazon.in, Flipkart, Meesho, Shopify, Instagram, others), `gstRegistered` (yes or no), `claimsInputCredit` (yes or no), `adsSalesBasis` (GST-inclusive or taxable value; asked before any break-even), `feeCards` (files), `settlementReports` (files), `catalogueSheet` (file), `thresholds` (file or defaults).

**Gallery tile:** category Shops and firms; "The back office for your own products, or audits and reports for other sellers on Amazon.in, Flipkart, Meesho and Shopify."; you do 6 to 10 hours a week ("Approve prices and listings, upload files, file claims."); team Lister, Auditor, Bookkeeper, Keeper ("Unit economics, listing fixes, settlement checks, claims drafts."); clients usually pay 5,000 to 20,000 rupees a seller a month (model estimate).

**Never:** fingerprint-patched or proxied browsers; review requests tied to incentives; fake or synthetic testimonials; buying ranks or reviews; reading buyer personal data without the marketplace's approval; filing claims without the seller's own submit; scraping marketplace pages (fetch policy).

### Package 5F1: registration, unit economics, ads, settlement audit, listing health, India checks (SL1 to SL5)

Size L.

**Files:** `playbooks/online-seller/registration.ts`, `definition.ts`, `economics.ts`, `ads.ts`, `settlement.ts`, `listing.ts`, `india-checks.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/online-seller.json`, `delivery/harness/tools-online-seller.ts` (`seller.unitEconomics`, `seller.ads`, `seller.settlement`, `seller.listing`); records `venture-seller-sku`, `venture-seller-feecard`; desk `app/ui/src/places/work/desks/SellerDesk.tsx`, `app/ui/src/engine/fake-online-seller.ts`, `app/ui/src/text/{en,hi}/pb-online-seller.json`; tests `platform/tests/venture-playbook-seller.test.ts`, `venture-seller-economics.test.ts`, `venture-seller-ads.test.ts`, `venture-seller-settlement.test.ts`, `venture-seller-listing.test.ts`, `app/ui/tests/places/seller-desk.test.tsx`.

**Failing tests first:**

1. Unit economics (SL1), the worked example of `commerce.md` as a fixture (selling price 999.00 GST included, 18% GST, referral 15% of 999.00, closing fee 25.00, shipping 65.00, GST on fees 18%, GST TCS 0.5% of taxable value, TDS 0.1% of taxable value, stock 300.00 plus GST 54.00, packaging 12.00 with no credit, ads 80.00 plus GST 14.40, returns 8% at 120.00 each), in paise, half-up per line: taxable value 846.61; output GST 152.39; fees before GST 239.85; GST on fees 43.17; TCS 4.23; TDS 0.85; paid out 710.90; expected return loss 9.60; GST cash 36.59; contribution 205.16, which is 24.23% of taxable value; the tie-out 710.90 minus 354.00 minus 12.00 minus 94.40 minus 36.59 minus 9.60 is 204.31, plus 0.85 TDS claimed, is 205.16; contribution before ads 285.16. Break-even ACOS refuses (`ADS_BASIS_REQUIRED`) until the owner says which sales the ads report counts, then gives 28.54% (GST included) or 33.68% (taxable value). Every input is an evidence object (fact, estimate, assumption, unknown) with source and time; any unknown holds the whole sheet (`UNIT_ECONOMICS_HOLD` with the missing list); if the three views (contribution, cash paid out, GST cash) do not tie, `UNIT_ECONOMICS_NO_TIE`; without input credit, GST on fees, stock and ads becomes cost (a second fixture, worked by hand in the test's comments and checked by the CA). The TCS and TDS rates come only from dated rules the CA confirms, never from the agent. The sheet says "This is not a buying decision."
2. Ads (SL2): ACOS is recomputed from raw spend and sales; a report figure that differs by more than one hundredth of a point is "does not reconcile"; break-even needs the basis (as above) or is null with the reason.
3. Settlement audit (SL3): the expected payout per order is compared with the settlement line; each difference splits into named items (fee slab, weight change, return deduction, unknown); claims are "estimate for review, not receivable" with hold reasons and "nothing submitted"; the seller files.
4. Listing health (SL4): rules per marketplace as dated data (title length, repeated words, banned promotional and subjective words, image count and minimum pixel size read from file headers; a white background is a "check by eye" item); `score: null` with a reason where fields are missing; "upload X to unlock" question rows; a `basis` on every score; title phrases triaged keep, move or delete; the report opens with data coverage; scores are "our own rubric". Not "Amazon's internal score".
5. India checks (SL5): selling price above MRP on packaged goods fails; MRP, country of origin and seller details must be present; the rule table needs `confirmedBy` (a CA or lawyer) to run on client orders, else rehearsal only.

**Judge rules:** `estimate-not-receivable` (required yes), `no-incentivised-reviews` (required yes), `figures-receipted` (required yes), `fix-is-specific` (share 75).

**Baseline cases** (`online-seller.json`): `unit-economics-hold-unknown`, `acos-basis-asked`, `claim-estimate-wording`, `title-banned-word`, `price-over-mrp`.

**Rule register** (verify; the CA or a lawyer confirms the legal rows): GST TCS on e-commerce operators, section 52 of the CGST Act and the 0.5% rate (CBIC notification); TDS on e-commerce payments (section 194-O of the 1961 Act, its 2025 Act number for the CA); Legal Metrology (Packaged Commodities) Rules 2011 declarations (https://consumeraffairs.nic.in); Consumer Protection (E-Commerce) Rules 2020 seller details; each marketplace's fee pages (the owner's fee card is the source for figures); listing title and image rules per marketplace (secondary where only help pages behind a login exist).

**Connectors (this package):** fee cards, settlement reports and exports `read` (order files); everything else in 5F3.

**Done when:** the five engine test files are `# fail 0`, the baseline is committed, the desk test passes, and the tile is live.

### Package 5F2: staged changes, alerts and briefing, stock counters, research, more offers, product photos (SL6 to SL10, SL12)

Size L. Starts after 5F1.

**Files:** `playbooks/online-seller/staging.ts`, `alerts.ts`, `stock.ts`, `research.ts`, `catalogue-sheets.ts` (Meesho and Flipkart bulk sheets through 5A5's XLSX), `multi-store.ts`, `cases.ts`, `photos.ts`; changed `definition.ts`, `rules.ts`, `tools-online-seller.ts` (`seller.stage`, `seller.alerts`, `seller.stock`, `seller.shortlist`, `seller.catalogueSheet`, `seller.multiStore`); records `venture-seller-stage`, `venture-seller-movement`, `venture-seller-case`; tests `platform/tests/venture-seller-staging.test.ts`, `venture-seller-alerts.test.ts`, `venture-seller-stock.test.ts`, `venture-seller-research.test.ts`, `venture-seller-sheets.test.ts`, `venture-seller-photos.test.ts`.

**Failing tests first:**

1. Staged changes (SL6): three gates (approval through the owner's route only; provenance, the ids were read and staged in this session; guardrail caps re-checked at apply, H13); a field the channel cannot write is refused at staging; a stock write is compare-and-set ("The stock moved since it was read."); a dry run is the default with a complete or incomplete preview (1B `descriptionComplete`); a destructive action is confirmed by its exact name; a price below break-even contribution is refused unless the owner marks it clearance.
2. Alerts and briefing (SL7): thresholds per category and SKU in an owner-editable file; alerts are computed, never stored, and each quotes its threshold; an alert kind with no data source is left out; a slow mover gets three options (leave, mark down, pull); a promotion is staged only with scope, depth and end date; a metric that cannot be read says "cannot read", never 0; the morning briefing has 3 to 6 rows ranked by money at stake, each with its figure and inputs or "unknown".
3. Stock (SL8): counters on hand, allocated, reserved, incoming, with available and purchasable derived; a count is never set, a movement is written; one authority per data type across channels; refunds never edit earnings; only completed payouts count as received; the lowest price of the last 30 days is kept, and a "was" price above it is refused.
4. Research (SL9): a code review of a shortlist (off-topic, trademark words, fee over 35% of price, review anomalies, season) gives GO, CAUTION or NO-GO with evidence before any model view; risk badges never hide items; bought data (Sorftime, the owner's key) is quoted first.
5. Sheets and reports (SL10): one product sheet becomes Meesho and Flipkart bulk sheets by dated column maps ("template checked on"); a cell starting with `=` is stored as text; the multi-store report lists catalogue gaps, duplicate SKUs, price differences, low stock with transfer chances, unfulfilled orders by age, and keeps currencies apart; the case tracker takes deadlines only from an official or owner source, keeps attachments as evidence, drafts follow-ups and says "closed does not mean solved"; Amazon extras (ungating, brand registry, returns, storefront, deals, compliance) are listed as owner-priced handoff checklists.
6. Photos (SL12): the real product photo is the main image and is referenced in every later call; consistency rules and hard constraints (no fake interface, frames or watermarks) are checked on the brief; the client's brand text passes the banned-word filter; the quote comes before generation (floor); every generated image has an asset record (5A4); the seller uploads.

**Judge rules added:** `move-has-cap` (required yes), `photo-is-the-product` (required yes).

**Baseline cases added:** `price-below-break-even`, `slow-mover-options`, `research-no-go-trademark`.

**Done when:** the six engine test files and 5F1's are `# fail 0`.

### Package 5F3: marketplace connectors and the store assistant (SL11, Later SL13)

Size L. Starts after 5F2. Each connector row is checked against the platform's current docs on build day before its label is set (spec section 10).

**Files:** `build/marketplaces.ts` (the honest table), `build/shopify-admin.ts` (read and verified write), `build/storefront-assistant.ts`, `playbooks/online-seller/operations.ts` (each method used, its safety level and a `liveVerified` date, null until a check run against the owner's own store dates it); changed `build/catalogue/online-seller.ts`, `build/connectors.ts`, `definition.ts`, `build/index.ts`; hosted route for the assistant widget (one line in the hosted server's route table); tests `platform/tests/venture-marketplaces.test.ts`, `venture-shopify-admin.test.ts`, `venture-storefront-assistant.test.ts`.

**Failing tests first:**

1. Labels: Amazon.in SP-API and Ads API `planned: read` (waits on Amazon developer registration and the seller's authorisation; manual path: download the reports from Seller Central); Flipkart seller API `planned: read` (manual path: settlement by download); Meesho, Myntra, Ajio, Nykaa, JioMart `handoff` (Chausar prepares the upload file); Shiprocket and Delhivery `planned: write`; Instagram shop and WhatsApp Business `handoff`; Sorftime `planned: read` (owner's paid key, unverified).
2. Shopify (the store's own app token, created by the owner in the store; if build-day docs show Shopify now requires review for this, the label stays `planned`): reads report `truncated` until every page is read, and no total is shown before `truncated: false`; a write (price, inventory adjustment, listing field) goes through staging (5F2) and is applied only after a read-back shows the new value; a write that cannot be read back is outcome unknown (1B), never retried.
3. Store assistant (SL13): on the hosted app, a chat widget for the owner's own Shopify store answers from the catalogue only (Storefront API with the store's public token), opens with "You are chatting with an AI assistant", says "Not charged here" with every cart link (checkout always on Shopify), never places an order, keeps no buyer data past the session, and its answers that name a price quote the catalogue's value (code check).

**Done when:** the three engine test files are `# fail 0` and every connector card shows its tested label.

---

## Package 5G: support desk for small shops (catalogue 2.9.6, SD1 to SD6)

Size L. Depends on 5A6 (mail in), W4 4F (breakers), W4 C11 (reply triage).

**Registration:** id `support-desk`, label "Support desk for small shops", service type `support`; picks: "support desk", "customer support service", "customer service for shops", "helpdesk service", "support inbox", "ticket handling". Summary: "Agents sort your clients' customer mail, draft replies that cite their sources and keep due times; you approve every reply and send it from the shop's mailbox."

**Offers** (owner sets every price): `monthly-support` (monthly, per shop; pilotable), `launch-support` (project, per launch or sale window), `help-pages` (project, per set, written from past tickets), `support-report` (monthly), `ai-pass-through` (the owner's AI spend for the shop passed through at a stated markup, 5A2 share price on spend receipts).

**Roles:** Sorter (Operations, agent: threads, matches, classifies), Replier (Sales and clients, agent: drafts replies citing sources), Writer (Production, agent: help pages), Chausar (Operations, code: due times, threading, matching), Billing (Money, code).

**Steps:** `mail-in` (gather, code: import and screen) → `thread` (compute) → `match` (compute: customer and order, floor and margin, else a confirm row) → `classify` (work, Sorter) → `draft` (write, Replier, citing sources) → `approve` (owner; the shop approves any policy change by share link; floor) → `send` (operator, the owner sends; floor) → `resolve` (approve, owner, with a note) → `rating` (gather, optional).

**Always ask:** refunds or any promise of money; anything legal; deleting; anything to a customer the shop blocked (goes straight to the owner, no agent draft).

**Intake fields:** `shopHours` (days and times), `timeZone`, `holidays` (list), `firstReplyHours`, `resolutionHours`, `policies` (files), `blockedCustomers` (list), `languages`.

**Records:** `venture-support-ticket`, `venture-support-message`, `venture-support-request`, `venture-support-rating`. Desk `app/ui/src/places/work/desks/SupportDesk.tsx` (queue Overdue, Due soon, Open, Waiting customer; due badges).

**Files:** `playbooks/support-desk/registration.ts`, `definition.ts`, `tickets.ts`, `due.ts`, `threading.ts`, `match.ts`, `handoff.ts`, `ratings.ts`, `readiness.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/support-desk.json`, `delivery/harness/tools-support-desk.ts` (`support.match`, `support.ticket`), `app/ui/src/engine/fake-support-desk.ts`, `app/ui/src/text/{en,hi}/pb-support-desk.json`; tests `platform/tests/venture-playbook-support.test.ts`, `venture-support-tickets.test.ts`, `venture-support-due.test.ts`, `venture-support-threading.test.ts`, `venture-support-handoff.test.ts`, `venture-support-readiness.test.ts`, `app/ui/tests/places/support-desk.test.tsx`.

**Failing tests first:**

1. Tickets (SD1): statuses open, in progress, waiting customer, resolved, closed; closed is final; resolve and close need a note; a stale revision is refused (`TICKET_STALE`); a proposed ticket expires after 30 minutes, carries a dedup key (the thread) and is refused while a run is active on that conversation (`TICKET_RUN_ACTIVE`); a refund or replacement request is stored as amount text plus currency with "requested, not done"; a draft that says a refund was made, or that a saved reply was delivered, fails `not-done-yet`. Ideas from nexusdesk (Apache-2.0).
2. Due times (SD2), fixed clock: shop hours Monday to Saturday 10:00 to 19:00 Asia/Kolkata, first reply in 4 business hours; a message on Saturday at 17:30 is due Monday at 12:30; with Monday a holiday, Tuesday at 12:30; unset hours mean 24/7; snooze needs a reason, pauses the clock and wakes on a customer reply; the badge reads "Due in 3h" or "Overdue by 2h" and is empty when nothing honest can be said; queue order is Overdue, then Due soon, then Open. Ideas from ResolveHQ (source-available): no code.
3. Threading (SD3): Message-ID and References first; then a signed reply address (plus-address with an HMAC token); then a visible ticket number only if the sender is that ticket's customer; a message quoting #123 from another sender opens a new ticket ("a ticket number is not authentication").
4. Match: a customer and order match scored by code from email, phone and order number; the best at or above the floor and ahead of the second by the margin is matched, else a confirm row on Today.
5. Handoff (SD4): asking for a person (English and Hindi phrases) pauses auto drafts on that ticket, cancels queued runs, flags running ones, posts a system line, and hands over a rolling summary with the last 10 messages.
6. Language and ratings (SD5): the reply is drafted in the customer's language with "Draft before translation" kept beside it; one rating per ticket by a plain link (no pixel), shown with its count, and as a count only under five ratings; knowledge gaps become help-page ideas (`ideas.add`); triage goes by impact and evidence, not tone.
7. Readiness (SD6): MX, SPF, DKIM (selector from the owner) and DMARC through a stub resolver, with fix lines; "A failed lookup does not mean the record is missing."; Re-check.
8. Sending: the owner sends; the handoff offers copy, `mailto:`, or an `.eml` draft with `In-Reply-To`, `References` and `X-Unsent: 1` for desktop mail apps; "I sent it" records the send.
9. Breakers: an identical tool call repeated three times stops the run (4F).

**Judge rules:** `cites-source` (required yes), `no-money-promise` (required yes), `customer-language` (share 75), `tone-kind` (share 75).

**Baseline cases** (`support-desk.json`): `refund-requested-not-done`, `where-is-my-order`, `hindi-reply`, `blocked-customer-to-owner`, `policy-change-needs-shop`.

**Rule register** (verify): Consumer Protection (E-Commerce) Rules 2020 grievance timelines (acknowledge in 48 hours, resolve in one month); DPDP Act 2023 and Rules (notice and minimum data); RFC 5322 threading fields; RFC 3834 auto-replies.

**Connectors:** mail import (`.eml`, `.mbox`) `read`; the read-only mailbox (4E3, its own label; manual path: forward or export); sending `handoff` (the owner sends); WhatsApp Business `planned` (waits on Meta verification); chat widget `planned`.

**Gallery tile:** category Shops and firms; "Customer mail sorted, replies drafted and due times kept for small shops."; you do 5 to 7 hours a week ("Approve and send replies, settle refunds."); team Sorter, Replier, Writer, Billing ("Sorts mail, drafts replies with sources, writes help pages."); clients usually pay 6,000 to 20,000 rupees a shop a month (model estimate).

**Never:** sending a reply without the owner; promising money; replying to a blocked customer; tracking pixels.

**Done when:** the six engine test files are `# fail 0`, the baseline is committed, the desk test passes and the tile is live.

---

## Package 5H: recruiting desk (catalogue 2.9.7, R1 to R6)

Size L. Depends on W4 4E (pipeline, drafts, handoffs), W1 H8 (forward-only stages), 5A6 (mail in, fetch policy).

**Registration:** id `recruiting-desk`, label "Recruiting desk", service type `consulting`; picks: "recruiting", "recruitment agency", "hiring help", "headhunting", "talent sourcing", "resume screening", "placement agency". Summary: "Agents turn a role into clear rules, screen the resumes your clients send with quoted proof, and keep the candidate ledger; you approve every message and every rejection."

**Offers** (owner sets every price): `role-intake` (project, per role: job description and rules; pilotable), `shortlist` (project, per batch, each person with quoted proof), `resume-screening` (monthly), `interview-scheduling` (project, per role), `success-fee` (on hire: a fixed amount, or a share of the offered annual pay with 5A2's share price and the offer letter as evidence).

**Roles:** Sourcer (Sales and clients, agent), Screener (Production, agent), Scheduler (Operations, agent), Chausar (Operations, code: dedup, stages, experience sums), Billing (Money, code).

**Steps:** `role-intake` (question, one at a time with a suggested answer) → `approve-rules` (owner confirms each rule) → `source` (gather: resumes the client sends, mail in, the owner's own pastes) → `screen` (work, three-state judge, `recruit.criteria`) → `ledger` (compute) → `first-message` (write) → `approve-message` (floor) → `send` (operator, the owner sends) → `schedule` (work) → `approve-invite` (floor) → `report` (write, weekly). Done-when tests run before any run reports done.

**Approvals:** the hard rules; every first message to a candidate; every rejection (never automatic); every interview invite; anything about pay or offers. The owner sends everything.

**Intake fields:** `roleTitle`, `location`, `payRange` (text, from the client), `hardRules` (list), `mustHaves` (list with how to verify), `exclusions`, `targetCompanies`, `privacyNoticeUrl`, `retentionDays`.

**Records:** `venture-recruit-role`, `venture-recruit-candidate` (dedup on email, or name plus role; source URL; the date the privacy notice was shown; stage; findings with quotes; protected traits never stored), `venture-recruit-touch`, `venture-recruit-interview`. Desk `RecruitDesk.tsx` (ledger, daily card).

**Files:** `playbooks/recruiting-desk/*` (`registration.ts`, `definition.ts`, `intake.ts`, `criteria.ts`, `ledger.ts`, `schedule.ts`, `report.ts`, `boards.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/recruiting-desk.json`), `delivery/harness/tools-recruiting-desk.ts` (`recruit.criteria`, `recruit.ledger`, `recruit.slots`), fake and text files; tests `platform/tests/venture-playbook-recruiting.test.ts`, `venture-recruit-criteria.test.ts`, `venture-recruit-ledger.test.ts`, `venture-recruit-schedule.test.ts`, `venture-recruit-boards.test.ts`, `app/ui/tests/places/recruit-desk.test.tsx`.

**Failing tests first:**

1. Role intake (R1): one question at a time, each with a suggested answer; "a strong X" becomes hard rules, must-haves each with how to verify, exclusions, target companies and search words (a versioned keyword table); outputs a public job description, a private sourcing note and the rules. A rule that names a protected trait or a proxy (age, birth year, graduation year as age, gender, marital status, pregnancy, religion, caste, disability, photo, home address as a proxy) is refused with `PROTECTED_TRAIT`.
2. Criterion judge (R2): met, not met or unknown per criterion with an excerpt id; code resolves the quote (it must appear word for word in the resume text); no quote means unknown; missing evidence is never "not met"; the recommendation and summary are fixed sentences chosen by code; years of experience are the union of dated roles (overlaps merged) by code. Ideas from jev-recruiter (MIT); its LinkedIn automation is not taken.
3. Ledger (R3): fixed columns; dedup; stages move forward only (sourced, screened, contacted, replied, interview 1 to n, offer, joined; rejected and withdrawn terminal), each move with an evidence ref; per-step done-when tests ("every screened person was greeted or has a skip reason") are checked against records before a run reports done; batch consent lasts one round; never auto-reject.
4. Scheduling (R4): free and busy from the owner's calendar export (ICS) or W4's calendar import; one confirm line "[time], [candidate] ([role] [round]), interviewers, video, create?"; the invite text goes to the owner to send; a manual pack when no calendar is connected.
5. Reports (R5): the weekly client report and the daily card come from the ledger only (tiles, key people, waiting for you with reasons, the rest folded, a real link).
6. Boards (R6): public Greenhouse, Lever and Ashby job board APIs (no sign-in) with title, location and pay gates, a seen set, a seed at install (nothing alerts on day one), and "pay unverified" when the pay is unclear.
7. Privacy: every first message carries the privacy notice line (DPDP) or fails `privacy-line`; a candidate can be forgotten (W4 network forget); records past `retentionDays` after the role closes are listed for the owner to delete (deleting asks).

**Judge rules:** `quotes-support-verdict` (required yes), `no-protected-traits` (required yes), `respectful-message` (share 75).

**Baseline cases** (`recruiting-desk.json`): `unknown-not-not-met`, `protected-trait-refused`, `first-message-privacy-line`, `experience-overlap`.

**Rule register** (verify): DPDP Act 2023 notice and consent; LinkedIn User Agreement on automation; the Greenhouse (https://developers.greenhouse.io/job-board.html), Lever (https://github.com/lever/postings-api) and Ashby (https://developers.ashbyhq.com) public posting APIs; the protected-traits list (house, with sources such as the Transgender Persons Act 2019 and the Rights of Persons with Disabilities Act 2016).

**Connectors:** resumes the client sends `read`; mail import `read`, the read-only mailbox (4E3); Greenhouse, Lever, Ashby boards `read` (public); calendar `handoff` (Google Calendar `planned`); LinkedIn and Naukri `handoff` (never scraped or automated).

**Gallery tile:** category Shops and firms; "Role rules, screened shortlists with quoted proof and interview scheduling for small companies."; you do 5 to 8 hours a week ("Talk to clients and candidates, approve messages."); team Sourcer, Screener, Scheduler, Billing ("Screens resumes with quotes, keeps the ledger, drafts invites."); clients usually pay 25,000 to 80,000 rupees per hire (model estimate).

**Never:** automated LinkedIn or Naukri actions; scraping profiles; automatic rejections; storing protected traits.

**Done when:** the five engine test files are `# fail 0`, the baseline is committed, the desk test passes and the tile is live.
---

## Package 5I: job-search and career desk (catalogue 2.9.8, J1, J3 to J6)

Size M to L. Depends on W4 J2 (approval bound to file bytes), 5A5 (DOCX and PDF), 5A6 (fetch policy), 5H (the public boards reader; 5I imports it).

**Registration:** id `job-search-desk`, label "Job-search and career desk", service type `consulting`; picks: "job search help", "career coach", "career coaching", "resume writing", "cv writing", "interview prep", "job hunt". Summary: "Agents keep a client's job search moving: shortlists, tailored resumes, prep packs and outreach drafts; you approve every draft and the client sends and applies."

**Offers** (owner sets every price): `monthly-job-search` (monthly), `interview-prep-pack` (project, per round), `job-title-audit` (project), `profile-and-tailoring` (project, per role: resume and cover letter as DOCX and PDF; pilotable), `weekly-shortlist` (monthly), `career-coaching` (project: positioning brief, scored targets, outreach drafts, call plan, pilot proposal).

**Roles:** Researcher (Sales and clients, agent), Writer (Production, agent), Coach (Sales and clients, agent), Checker (Operations, agent, read-only), Billing (Money, code).

**Steps:** `facts` (gather: the client's facts with boundaries) → `approve-facts` (owner) → `listings` (gather: links the client sends, public boards) → `shortlist` (compute and write) → `tailor` (write) → `check` (verify: claim boundaries, voice check, before-you-send) → `approve` (owner, floor; the client approves by share link) → `handoff` (the client sends and applies).

**Approvals:** every draft and pack before the client sees it; every new claim about the client; loosening or removing a fact's boundary.

**Intake fields:** `targetRoles`, `locations`, `salaryFloor` (text), `facts` (file or typed), `links` (list), `languages`.

**Records:** `venture-career-fact` (`{statement, qualifiers, forbiddenUses}`), `venture-career-listing`, `venture-career-thread`. Desk `CareerDesk.tsx` (Now, Live threads, Applications).

**Files:** `playbooks/job-search-desk/*` (`registration.ts`, `definition.ts`, `facts.ts`, `capture.ts`, `shortlist.ts`, `before-send.ts`, `coaching.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/job-search-desk.json`), `delivery/harness/tools-job-search-desk.ts` (`career.facts`, `career.capture`, `career.shortlist`, `career.score`), fake and text files; tests `platform/tests/venture-playbook-job-search.test.ts`, `venture-career-facts.test.ts`, `venture-career-capture.test.ts`, `venture-career-shortlist.test.ts`, `venture-career-send.test.ts`, `app/ui/tests/places/career-desk.test.tsx`.

**Failing tests first:**

1. Facts with boundaries (J1): an agent may tighten a fact directly; loosening or removing asks the owner; a draft that uses a fact for one of its forbidden uses fails `claim-boundary` naming the fact; a claim with no fact behind it fails (never add experience the client did not state). Ideas from JobOS (Apache-2.0).
2. Delivered files (J2, W4): the approval is bound to each file's sha256; a re-render clears it.
3. Listing capture (J3): from links the client sends, the page is read (net guard, robots, fetch policy; LinkedIn and Naukri pages are refused with "Paste the job text instead.") until one unchanged revision; it is complete only when every page shares one hash; otherwise an exact code and "No job was saved."
4. Weekly shortlist (J4): verdicts in four fixed words with a keep threshold and drop reasons; coverage is said first ("Read 38 of 41 listings").
5. Before you send (J5): `[YOUR TAKE]` slots must be filled or the draft fails; the voice check gives PASS, REWRITE or DO NOT SEND; failing the two-fact rule is always DO NOT SEND; the desk tables are Now, Live threads (last touch, next touch, state) and Applications (age, stage, human path).
6. Coaching (J6): the positioning brief has "what to stop claiming"; targets are scored 0 to 2 on seven criteria, each with an evidence URL or "guess", summed by code; outreach drafts and a call plan; a pilot proposal through 5A2; never a message, claim or metric the client has not confirmed.

**Judge rules:** `only-stated-facts` (required yes), `no-application-made` (required yes: nothing says Chausar applied), `voice-matches-client` (share 75).

**Baseline cases** (`job-search-desk.json`): `forbidden-use-blocked`, `your-take-unfilled`, `shortlist-coverage-first`, `no-invented-experience`.

**Rule register** (verify): LinkedIn and Naukri terms on automated access; DPDP notice for the client's data; house rules for the verdict words.

**Connectors:** links the client sends `read` (fetch policy applies); public job boards `read` (5H's reader); Pinloop on the client's own account `handoff`; LinkedIn and Naukri `handoff`.

**Gallery tile:** category Content; "Shortlists, tailored resumes, prep packs and outreach drafts for job seekers."; you do 3 to 6 hours a week ("Meet clients, approve packs."); team Researcher, Writer, Coach, Billing ("Finds roles, tailors resumes, drafts outreach."); clients usually pay 3,000 to 15,000 rupees a client a month (model estimate).

**Never:** signing in to the client's job-board account; applying; adding experience the client did not state.

**Done when:** the five engine test files are `# fail 0`, the baseline is committed, the desk test passes and the tile is live.

---

## 5J: translation and subtitling (catalogue 2.9.9)

Two packages: 5J1 registers the playbook with documents and subtitles; 5J2 adds dubbing and live captions.

**Registration:** id `translation-studio`, label "Translation and subtitles", service type `studio`; picks: "translation service", "translation agency", "subtitling", "subtitles for", "hindi subtitles", "dubbing service", "localisation service", "localization service". Summary: "Agents translate documents and subtitle videos with your client's locked glossary; code checks every term and format, and you approve every deliverable."

**Offers** (owner sets every price): `document-translation` (project, per page or per word; pilotable), `subtitles` (project, per video minute), `live-captions` (project, per hour; 5J2), `dubbing` (project, per video minute; 5J2; consent required).

**Roles:** Translator (Production, agent), Checker (Production, agent, read-only), Chausar (Operations, code: every format and term check), Billing (Money, code).

**Steps:** `intake` (gather, with rights) → `glossary` (write, Translator) → `approve-glossary` (owner locks it) → `translate` (work, per page or segment) → `check` (verify) → `review` (approve, owner, in the bilingual sheet) → `client` (approve, by share link) → `deliver` (operator: DOCX, PDF, SRT, VTT or an offline HTML file; floor).

**Approvals:** the glossary; every deliverable; any voice clone (no consent file, no job); the quote.

**Intake fields:** `rights` (the client owns or licensed the source: translation is an adaptation), `languagePair`, `glossary` (file), `format`, `private` (yes means a local model only), `speakers` (for dubbing, each with consent).

**Records:** `venture-translation-job`, `venture-translation-segment` (source, draft, the hash of an owner edit, findings), `venture-glossary` (term, chosen translation, locked by the owner, version). Desk `TranslationSheet.tsx` (the bilingual review sheet).

**Gallery tile:** category Content; "Documents and subtitles in Hindi, English and regional languages, with the client's own glossary."; you do 3 to 6 hours a week ("Lock glossaries, review, deliver."); team Translator, Checker, Billing ("Translates, checks every term and format."); clients usually pay 100 to 400 rupees per video minute (model estimate).

**Never:** a voice clone without the speaker's signed consent; client text sent to a free public service without the owner choosing it; a deliverable without rights recorded.

### Package 5J1: registration, translation checks, subtitles, review sheet, provider honesty (T1, T2, T3, T5)

Size L. Depends on 5A4 (captions core, fingerprints), 5A5 (DOCX, PDF).

**Files:** `playbooks/translation-studio/*` (`registration.ts`, `definition.ts`, `checks.ts`, `terms.ts`, `subtitles.ts`, `providers.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/translation-studio.json`), `delivery/harness/tools-translation-studio.ts` (`translate.check`, `translate.terms`, `subtitle.check`), desk `app/ui/src/places/work/desks/TranslationSheet.tsx`, fake and text files; tests `platform/tests/venture-playbook-translation.test.ts`, `venture-translate-checks.test.ts`, `venture-translate-terms.test.ts`, `venture-subtitles.test.ts`, `venture-translate-providers.test.ts`, `app/ui/tests/places/translation-sheet.test.tsx`.

**Failing tests first:**

1. Checks (T1): glossary terms present with script-aware boundaries (Devanagari has no `\b`; boundaries come from Unicode word segmentation); JSON keys, the HTML tag sequence, line breaks, indents, hashtags and mentions kept; each page's carry-over probes (numbers, names, codes in the source) must appear in its translation, else the page counts as not translated; a "repair" that drops a block or changes an id is rejected; problems in the source go to the margin. Ideas from Index-Translate (Apache-2.0) and easyread (MIT).
2. Term swap (T1): the model only names a preferred term; `translate.terms` swaps it only when the counts match, never inside formulas, protecting longer terms, and skipping paragraphs the owner edited (by hash).
3. Subtitles (T2): one translation per source sentence, never merged, split or reordered (count and order checked by code); shorter wins, but negations and numbers stay (both checked); one glossary per client, locked by the owner; cue timing from 5A4's core; a source transcript that changed makes the subtitles stale (5A4). Ideas from BaoCut (source-available): no code.
4. Providers (T5): a capability table per provider limits the language pickers; an unknown pairing says "Model language support is unknown. Check your service documentation."; a free public translation service is listed under Your AI as "free public service, no uptime promise, client text leaves your computer" and is used only when the owner picks it; an order marked `private` may use only a local model (refused otherwise, `PRIVATE_NEEDS_LOCAL`).
5. Review sheet (T3): the faithful text in the body, notes in the margin ("AI, explanation" and "My note"), the original page beside it following the reading position; no Ask AI button when no model is set.

**Judge rules:** `meaning-faithful` (share 75), `glossary-respected` (required yes), `nothing-added` (required yes).

**Baseline cases** (`translation-studio.json`): `glossary-term-missing`, `subtitle-merged-sentences`, `number-dropped`, `hindi-legal-letter`.

**Rule register** (verify): WebVTT (https://www.w3.org/TR/webvtt1/); subtitle reading speeds (secondary: Netflix timed text style guides for English and Hindi); the Copyright Act 1957 on translation as an adaptation (house reading, a lawyer confirms); each free public service's terms page.

**Connectors:** Your AI `write` (an API, or a local model for private files); free public translation services labelled as such (each verified on build day before listing); local video and audio tools `read` (desktop).

**Done when:** the five engine test files are `# fail 0`, the baseline is committed, the sheet test passes and the tile is live.

### Package 5J2: dubbing with consent and live captions (T4, Later T6)

Size L. Starts after 5J1. Depends on 5A4 (voice consent, transcribe-back), 5A6 (speech out).

**Files:** `playbooks/translation-studio/dub.ts`, `dub-align.ts`, `live-captions.ts`; changed `definition.ts`, `rules.ts`, `tools-translation-studio.ts` (`dub.align`, `dub.verify`); desk `LiveCaptions.tsx`; tests `platform/tests/venture-dub.test.ts`, `venture-live-captions.test.ts`, `app/ui/tests/places/live-captions.test.tsx`.

**Failing tests first:**

1. Dubbing (T4): one consented voice per speaker and no substitute (`VOICE_MISMATCH`); every synthesis call goes through the budget reserve and stops on quota; only failed sentences are tried again; the alignment ladder is fit, tempo up to 1.25, extend into silence, else "overlong" is reported and never truncated; every run makes a new dub group; each synthesized sentence is transcribed back (local whisper) and scored by `scoreBack` (approved at 92, review at 85, else one retry then review); segments are cut at the quietest point under about 10 s and stretched no more than 1.5 times; the delivery carries the AI voice disclosure line, and a YouTube delivery ticks the altered or synthetic setting in the checklist.
2. Live captions (T6, Later, placed here): desktop only, with the host's permission recorded at intake; draft, final and refined lines, speaker chips, confirmed and in-progress text in separate rows; saving is off by default with "Content stays on this device. Turning a switch off does not delete saved records."; nothing is sent over the network (the process stub records the command).

**Judge rules added:** `dub-disclosed` (required yes).

**Baseline cases added:** `dub-without-consent-refused`, `overlong-reported`.

**Rule register rows** (verify): YouTube altered or synthetic content; each voice provider's terms on cloning consent.

**Done when:** the two engine test files and 5J1's are `# fail 0`; the live captions UI test passes.

---

## 5K: bookkeeping and CFO-on-demand (catalogue 2.9.10)

Two packages: 5K1 registers the playbook with collections, the CFO pack and the money check-up; 5K2 adds seller books, setup, receipts in and the first accounting write connector. It files nothing with the government; returns go to the CA firm playbook.

**Registration:** id `bookkeeping-cfo`, label "Bookkeeping and CFO help", service type `bookkeeping`; picks: "bookkeeping service", "bookkeeper for", "virtual cfo", "fractional cfo", "cfo on demand", "collections desk", "accounts receivable service", "cash flow help". Summary: "Agents keep your clients' books, chase what they are owed through drafts the client sends, and write CFO packs where every figure is a receipt; you approve every pack."

**Offers** (owner sets every price; monthly ones by transaction band): `monthly-books` (monthly), `collections-desk` (monthly; pilotable), `cfo-pack` (monthly: in and out by month, who owes by age, runway, a 13-week cash view), `decision-memo` (project, per question), `money-checkup` (project: households and small shops, spending only), `seller-books` (monthly; 5K2), `back-office-setup` (project; 5K2).

**Roles:** Bookkeeper (Money, agent), Collector (Sales and clients, agent: reminder drafts for the client to send), Analyst (Money, agent: memo and pack narrative from receipts), Chausar (Operations, code: calculator), Keeper (Operations, code), Billing (Money, code).

**Steps:** `gather` (read connectors, else the client file-request link, W4 K9) → `validate` (compute: totals, periods, duplicates) → `reconcile` (compute, stable ids) → `compute` (calculator only; each owner input an assumption figure) → `write` (every figure labelled reported, calculated, assumption or estimate) → `verify` (checks, the clean and adversarial ledger pair, judge) → `approve` (owner, then client by share link; floor) → `deliver`.

**Approvals:** every client-facing pack and memo; every batch posted to a client's books after its dry run; every reminder draft (the client sends it); any change to a payment instruction (always ask, verified through a known contact, H12).

**Intake fields:** `system` (Chausar books, Zoho Books, Tally), `bankStatements` (files), `salesRegister`, `purchaseRegister`, `question` (for a memo), `ladder` (collections stages, or the defaults), `householdMode` (yes or no).

**Gallery tile:** category Money and tax; "Books, collections drafts and CFO packs for shops, agencies, creators and online sellers."; you do 3 to 5 hours a week ("Review packs, talk to clients."); team Bookkeeper, Billing, Analyst, Keeper ("Books, ageing, cash views, memos with receipts."); clients usually pay 4,000 to 15,000 rupees a client a month (model estimate).

**Never:** filing anything with the government; investment suggestions (spending only); writing to a debtor; model-computed money.

### Package 5K1: registration, collections, CFO pack and memo, money check-up (BK1, BK2, BK4)

Size L.

**Files:** `playbooks/bookkeeping-cfo/*` (`registration.ts`, `definition.ts`, `collections.ts`, `cfo.ts`, `checkup.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/bookkeeping-cfo.json`), `money/cfo-sums.ts` (DSO, DPO, cash cycle, runway, scenarios in BigInt; it calls 4J4's ageing, flow and cash plan functions on the client's ledger rather than writing them again), `delivery/harness/tools-bookkeeping-cfo.ts` (`cfo.ratios`, `cfo.scenarios`, `collections.ladder`, `money.checkup`); records `venture-promise-to-pay`, `venture-collection-stage`; desk `CollectionsDesk.tsx`, fake and text files; tests `platform/tests/venture-playbook-bookkeeping.test.ts`, `venture-collections.test.ts`, `venture-cfo-pack.test.ts`, `venture-money-checkup.test.ts`, `app/ui/tests/places/collections-desk.test.tsx`.

**Failing tests first:**

1. Collections (BK1): the stage ladder by days overdue is data (owner-editable; defaults house: reminder draft, then call and email by a person, then a formal letter, then a lawyer letter and stop new orders, then a write-off decision); a promise to pay is "kept" only when recorded payments reach the promised amount by the promised date (code); two broken promises move the client up a stage; the client approves and sends each reminder; no draft is ever addressed to a debtor by Chausar (`no-debtor-contact`). Ideas from finance-skills (MIT prompt text).
2. CFO pack and memo (BK2): question routes as typed steps ("Can I afford a hire?" goes business case, costs, cash, scenarios, memo; "Why is cash falling?" goes cash flow, working capital, ageing, payables); the scenario table (base, downside, upside by revenue, profit, cash, runway) shows each column's assumptions and every cell is a receipt from `cfo-sums.ts`; DSO, DPO, cash cycle and runway come from the calculator; when cash flow is positive no runway figure is shown. Ideas from cfo (MIT); its model arithmetic is the trap and is not taken.
3. Money check-up (BK4): a monthly summary; subscriptions found by code (same payee, similar amount, a monthly or yearly gap) with cadence, latest amount, yearly cost, rises and new ones; unusual items (large by the owner's threshold, duplicates within three days, first-time payees); a three-finding savings scan chosen from the code-found candidates; read only; any line that suggests investing fails `spending-only` (SEBI rule row).
4. Labels: every figure in a pack is reported, calculated, assumption or estimate (`figure-labelled`).
5. Practice: the clean and adversarial ledger pair (a duplicate import, a sign flipped) runs in rehearsal and the adversarial one must be caught.

**Judge rules:** `figures-labelled` (required yes), `client-sends-reminders` (required yes), `memo-answers-question` (share 75), `spending-only` (required yes).

**Baseline cases** (`bookkeeping-cfo.json`): `promise-broken-twice`, `hire-memo-scenarios`, `positive-cash-no-runway`, `subscription-rise`, `no-investment-advice`.

**Rule register** (verify; a CA or lawyer confirms the legal rows): the MSMED Act 2006 payment terms (sections 15 and 16) and the related income-tax deduction rule (43B(h) of the 1961 Act, its 2025 Act number for the CA); SEBI (Investment Advisers) Regulations 2013 (why the check-up is spending only); the cash receipt and payment limits (shared with 5C2).

**Connectors:** client files and statements `read`; Chausar books `write`; Tally `read`; Zoho Books `planned: read` until 5K2; mail `handoff`.

**Done when:** the four engine test files are `# fail 0`, the baseline is committed, the desk test passes and the tile is live.

### Package 5K2: seller books, back-office setup, receipts in, the first accounting write connector (BK3, BK5, BK6, K15)

Size L. Starts after 5K1 and 5F1 (it reuses the settlement engine).

**Files:** `build/accounting-write.ts` (the decision function and posting loop), `runtime/adapters/accounting/zoho-write.ts`, `runtime/adapters/accounting/tally-write.ts`, `playbooks/bookkeeping-cfo/seller-books.ts`, `setup.ts`, `vouchers.ts`, `cycles.ts`; changed `definition.ts`, `rules.ts`, `tools-bookkeeping-cfo.ts` (`books.post`, `vouchers.draft`), `build/catalogue/bookkeeping-cfo.ts`, `build/connectors.ts`; tests `platform/tests/venture-accounting-write.test.ts`, `venture-seller-books.test.ts`, `venture-backoffice-setup.test.ts`, `venture-vouchers.test.ts`.

**Failing tests first:**

1. Accounting write (K15): a pure decision function with ordered rules and a reason on every skip; calculator money checks before any proposal; an external id on every posted record (`-refund` suffix for reversals); "can't read what exists" stops the run (`BOOKS_READ_FAILED`); the dry run is the approval row; the posting date is in the shop's time zone; draft and issue are separate actions (issue for real is on the floor, H12); when line prices disagree with the total, the gap is spread in proportion with the rounding remainder on the largest line; a post that cannot be read back is outcome unknown. Zoho Books uses an OAuth self client the owner creates (verify on build day that no outside review is needed; else `planned: write`); Tally uses its XML interface on the owner's own computer (desktop only). Ideas from tiktok-shop-netsuite-sync (MIT), avoiding its US tax rule.
2. Seller books (BK3): monthly orders and settlements are posted after a dry run; settlement reconciliation reuses 5F1's engine; GST, TCS and TDS are credits to reconcile, sections confirmed by the CA.
3. Setup (BK5): customers, vendors, categories and opening balances in the client's chosen system; each finance cycle has its own id and folder, and a query never mixes last year's findings into this year.
4. Receipts in (BK6): through W4's file-request link; vouchers are drafted, the bookkeeper approves, the client's system stays the record.

**Done when:** the four engine test files and 5K1's are `# fail 0`; the connector cards show the tested labels.

---

## Package 5L: podcast or video to article (catalogue 2.9.11, PA1 to PA4)

Size M. Depends on 5A4 (fingerprints), 2E2 (local transcription).

**Registration:** id `podcast-to-article`, label "Podcast to articles", service type `content`; picks: "podcast to article", "podcast to blog", "video to article", "episode to blog post", "show notes service". Summary: "Agents turn each episode into an article, show notes and a newsletter blurb, every sentence tied to the transcript; you pick the angle and approve the article."

**Offers** (owner sets every price): `article-per-episode` (project, per episode; pilotable), `show-notes` (add-on), `newsletter-blurb` (add-on), and when the business also runs the YouTube playbook, the article reuses that order's transcript.

**Roles:** Writer (Production, agent), Editor (Production, agent, read-only checker), Publisher (Marketing, handoff), Chausar (Operations, code), Billing (Money, code).

**Steps:** `prep` (compute: clean transcript, fact ledger) → `angles` (write: two or three through-lines with reasons) → `approve-angle` (owner picks one, and the 5 to 8 sections) → `draft` (write, every sentence citing ledger ids) → `check` (verify) → `approve` (owner; floor when it goes to the public) → `handoff` (the client's blog or newsletter).

**Intake fields:** `transcript` or `media` (file), `rights` (the client's own show; guests' consent to be quoted), `host`, `guests`, `language`.

**Files:** `playbooks/podcast-to-article/*` (`registration.ts`, `definition.ts`, `prep.ts`, `ledger.ts`, `style.ts`, `notes.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/podcast-to-article.json`), `delivery/harness/tools-podcast-to-article.ts` (`article.ledger`, `article.style`), fake and text files; tests `platform/tests/venture-playbook-podcast.test.ts`, `venture-article-prep.test.ts`, `venture-article-style.test.ts`.

**Failing tests first:**

1. Prep (PA1): cue numbers stripped; fragments merged by speaker with breaks on a speaker change, a 1.5 s gap or length; echoes dropped; `[mm:ss]` kept; sparse punctuation warned; a numbered fact ledger by topic with timecodes; every article sentence cites at least one ledger id that exists (`ledger-cited`).
2. Angle and attribution (PA2): the owner picks the through-line and sections before drafting; attribution lint: names on first-hand experience and bold claims, never "an insider said", host and guest kept apart, never describing tone; the delivery note states the perspective, background added, facts not verified and frames to capture.
3. Style (PA3): style rates per 1,000 characters against English and Hindi baselines (house data, labelled; the source repo's Chinese figures are never shown as English facts); quote share 10 to 28%; three quotes found word for word in the transcript; the manual checks still to do are listed.
4. Notes (PA4): show notes and a newsletter blurb come from the same ledger and pass `ledger-cited`.

**Judge rules:** `faithful-to-episode` (required yes), `attribution-right` (required yes), `reads-as-article` (share 75).

**Baseline cases** (`podcast-to-article.json`): `uncited-sentence`, `insider-said-refused`, `quote-not-in-transcript`, `hindi-episode`.

**Rule register:** house rules for the style baselines and quote share; copyright note on quoting guests (house, a lawyer confirms).

**Connectors:** SRT, VTT, TXT or media intake `read` (local transcription on desktop); publishing `handoff`.

**Gallery tile:** category Content; "An article, show notes and a newsletter blurb from every episode."; you do 2 to 3 hours a week ("Pick the angle, approve the article."); team Writer, Editor, Publisher ("Ledger of facts, drafts that cite the episode."); clients usually pay 2,500 to 8,000 rupees per episode (model estimate).

**Never:** quotes not in the transcript; guests quoted without consent recorded; publishing without approval.

**Done when:** the three engine test files are `# fail 0`, the baseline is committed and the tile is live.
---

## Package 5M: lead generation and appointment setting (catalogue 2.9.12, LG1 to LG4, Later C25)

Size L. Depends on W4 4D and 4E (network, pipeline, follow-ups C7, drafts C8, reply triage C11, send governor C14), 5A6 (fetch policy). The leads feed the owner's own offers; selling raw lead lists stays out.

**Registration:** id `lead-generation`, label "Lead generation and appointment setting", service type `agency`; picks: "lead generation", "appointment setting", "cold email agency", "cold outreach service", "book meetings for", "local business leads". Summary: "Agents find local businesses from sources that allow it, draft outreach and follow-ups, and keep the pipeline; you send every message yourself."

**Offers** (owner sets every price): `researched-pipeline` (monthly, or per qualified meeting; pilotable), `cold-email-month` (project: 50 leads, a three-step sequence), `linkedin-desk` (monthly; LinkedIn stays handoff), `community-report` (weekly).

**Roles:** Researcher (Marketing, agent), Writer (Marketing, agent), Producer (Sales and clients, agent: meetings and the pipeline), Chausar (Operations, code: sources, dedupe, MX, caps), Billing (Money, code).

**Steps:** `source` (gather, code: with URL) → `dedupe` (compute) → `enrich` (compute: the business's own site) → `mx` (compute) → `screen` (compute: blocklist and suppression) → `pick` (approve: the owner picks who to contact) → `draft` (write) → `approve` (floor) → `send` (operator: the owner sends) → `read-back` (gather: replies and bounces from the owner's marks or W4 reads) → `stage` (compute: to meeting booked) → `report` (write, weekly). Edges: a reply about price or terms skips the agent and becomes a Today row for the owner to write (C11).

**Approvals:** every first message and follow-up (the owner sends them); the blocklist; any reply about price or terms (the owner writes it).

**Intake fields:** `city` (bounding box from Nominatim), `vertical` (OSM tags), `count` (default 10 a day), `ownOffer` (which of the owner's offers the leads are for), `postalAddress` (for cold email), `sendDays`, `sendTime`.

**Records:** reuses W4 network and pipeline records; adds `venture-lead-source` (source, URL, licence line, fetched at). Desk `LeadsDesk.tsx` (today's ten, found rate, follow-ups due).

**Files:** `playbooks/lead-generation/*` (`registration.ts`, `definition.ts`, `osm.ts`, `nominatim.ts`, `enrich.ts`, `dedupe.ts`, `daily-run.ts`, `community.ts`, `happenstance.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/lead-generation.json`), `delivery/harness/tools-lead-generation.ts` (`leads.osm`, `leads.enrich`, `leads.dedupe`, `community.vote`), fake and text files; tests `platform/tests/venture-playbook-leadgen.test.ts`, `venture-leads-osm.test.ts`, `venture-leads-enrich.test.ts`, `venture-leads-daily.test.ts`, `venture-community-report.test.ts`, `app/ui/tests/places/leads-desk.test.tsx`.

**Failing tests first:**

1. Sources (LG1), stub HTTP: Overpass inside the city box keeps the attribution "© OpenStreetMap contributors, ODbL" on each lead; Nominatim calls are at most one a second with Chausar's named user agent (a rate test with a fake clock); Google Places text search with the owner's key is `planned: read` unless build-day terms confirm look-up use (look up and qualify, never store and resell); own-site enrichment reads the homepage then up to three contact pages on the same host, own-domain email first, junk filtered, at most three kept, robots respected, and shows the found rate ("emails found for 21 of 40"); walk-ins and referrals are entered by the owner. Directories whose terms forbid copying (JustDial, IndiaMART, Google Maps) are refused by the fetch policy.
2. Dedupe: place or OSM id first, then domain, then normalised name plus address.
3. Daily run (LG2): N new prospects (default 10) from location, vertical and count, outreach drafts and the follow-ups due; the run sends nothing (`no-outside-writes`); the owner reviews in the morning.
4. Community report (LG3): the product is confirmed back in two or three sentences; communities are found from the problem; three dimensions are voted 1 to 5, each vote with a quoted line that code finds in the post; a post surfaces only at 4 or more on two dimensions; a coverage line ("covered 2 of 7 days"); removed posts are never quoted; community rules are checked; never post, comment, vote or DM. Posts come from threads the owner pastes, or the Reddit Data API once access is granted (`planned: read`). Ideas from reddit-skills (no licence): no code.
5. Outreach (LG4): cold email carries the unsubscribe line and the postal address, warm notes do not (W4 decision); WhatsApp drafts only to people who wrote first or opted in (consent record); no promotional call or SMS is ever drafted for a cold lead; LinkedIn is copy text and open the profile, never automated; caps and follow-ups from C7 and C14.
6. Happenstance (C25, Later, placed here): a `read` connector with the owner's own key; the credit cost is shown before each search from a dated rule ("2 credits a search", to verify); results are marked "from Happenstance".

**Judge rules:** `lead-has-source` (required yes), `personal-not-spammy` (share 75), `opt-out-honoured` (required yes), `no-false-familiarity` (required yes).

**Baseline cases** (`lead-generation.json`): `cold-email-footer`, `whatsapp-not-opted-in`, `price-reply-to-owner`, `community-vote-quoted`.

**Rule register** (verify): OSM licence and attribution (https://www.openstreetmap.org/copyright); Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/); Overpass usage; Google Maps Platform terms on caching; TRAI telecom commercial communications rules (DND); WhatsApp Business policy on opt-in; Gmail bulk sender guidelines (https://support.google.com/a/answer/81126); CAN-SPAM for United States recipients; DPDP Act 2023; LinkedIn User Agreement; Reddit Data API terms.

**Connectors:** OpenStreetMap Overpass `read`; Nominatim `read`; own-site enrichment `read`; Google Places `planned: read` (owner's key); Reddit `planned: read` (never write); Happenstance `read` (owner's key); mail app, LinkedIn and WhatsApp click-to-chat `handoff`; Gmail drafts `planned: write` (waits on Google's restricted-scope review).

**Gallery tile:** category Marketing; "Researched local leads, outreach drafts, follow-ups and booked meetings for your own offers."; you do 4 to 6 hours a week ("Send the messages, take the calls."); team Researcher, Writer, Producer, Billing ("Finds leads with sources, drafts outreach, keeps follow-ups."); clients usually pay 15,000 to 40,000 rupees a client a month (model estimate).

**Never:** scraping Google Maps, directories or LinkedIn; proxies; automated sending; selling lead lists; cold WhatsApp or promotional calls.

**Done when:** the five engine test files are `# fail 0`, the baseline is committed, the desk test passes and the tile is live.

---

## Package 5N: newsletter service (catalogue 2.9.13, NL1 to NL4)

Size M. Depends on 5A5 (HTML export), W4 P12 (export hygiene).

**Registration:** id `newsletter-studio`, label "Newsletter service", service type `content`; picks: "newsletter service", "newsletter for", "email newsletter", "newsletter writing", "run a newsletter". Summary: "Agents write each issue and check it before it goes; you approve every send, and the issue goes out from your own newsletter tool."

**Offers** (owner sets every price): `client-newsletter` (monthly, per client; pilotable), `own-newsletter` (the owner's own list: sponsor slots and a paid tier, prices set by the owner, totals by code).

**Roles:** Researcher (Marketing, agent), Writer (Production, agent), Editor (Production, agent, read-only), Publisher (Marketing, handoff), Billing (Money, code).

**Steps:** `gather` → `write` → `review` (verify: pre-send checks) → `approve` (owner; floor) → `send` (operator: export to the owner's tool, handoff) → `results` (gather: the tool's export) → `report` (write).

**Approvals:** each issue send (public sending is on the floor); every import with its consent tick; sponsor copy.

**Intake fields:** `list` (CSV with a consent tick), `fromAddress`, `postalAddress`, `tool` (the owner's newsletter tool), `sponsor` (optional).

**Records:** `venture-newsletter-issue`, `venture-newsletter-contact` (state issue, last chance, waiting, dormant; never deleted by Chausar).

**Files:** `playbooks/newsletter-studio/*` (`registration.ts`, `definition.ts`, `presend.ts`, `import.ts`, `slices.ts`, `stats.ts`, `sponsors.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/newsletter-studio.json`), `delivery/harness/tools-newsletter-studio.ts` (`newsletter.presend`, `newsletter.import`, `newsletter.slices`, `newsletter.stats`), fake and text files; tests `platform/tests/venture-playbook-newsletter.test.ts`, `venture-newsletter-presend.test.ts`, `venture-newsletter-import.test.ts`, `venture-newsletter-slices.test.ts`, `venture-newsletter-stats.test.ts`.

**Failing tests first:**

1. Pre-send (NL1): blocking and warning checks, each with a fix that points to the exact field (subject, merge tags that resolve, preview text, unsubscribe link, size under 100 KB, postal address, an allowed From, a test sent, the tool's plan limit); the three steps Write, Review, Send. Ideas from mailcheap (AGPL): no code.
2. Import (NL2): a consent tick is required; drops are counted by reason (invalid, misspelled domain, role address, throwaway inbox, duplicate, unsubscribed or bounced, no mail server by MX); list cleanup states (issue, last chance, waiting, dormant), never deleted.
3. First send (NL3): to never-emailed contacts the export is sliced (5%, at least 200 and at most 2,000), most engaged first; after the owner's tool reports the slice (its export), code pauses past 2% bounces or 0.08% complaints and blocks past 5% or 0.3%; "Send to more" exports the next slice.
4. Stats (NL4): an issue is compared with the newsletter's own last 10 issues, shown only with at least 2; future hours are drawn empty; opens are marked soft.
5. Sponsors: sponsor copy is labelled "Sponsored" (ASCI); sponsor and paid-tier totals come from code receipts.

**Judge rules:** `subject-honest` (required yes), `sponsor-labelled` (required yes), `worth-reading` (share 75).

**Baseline cases** (`newsletter-studio.json`): `missing-unsubscribe`, `ca-tax-dates-issue`, `sponsor-unlabelled`.

**Rule register** (verify): Gmail and Yahoo bulk sender requirements, including one-click unsubscribe (RFC 8058); DPDP consent; CAN-SPAM postal address for United States recipients; ASCI advertising code on sponsored content; the slice thresholds (house, from mailcheap's idea).

**Connectors:** the owner's newsletter tool `handoff` (issue exported as HTML and text, slices as CSV); Amazon SES and MailCheap Cloud `planned: write` (SES production access waits on AWS); Google Postmaster Tools `planned: read`.

**Gallery tile:** category Content; "A newsletter for a niche, a local business or your own list, checked before every send."; you do 2 to 4 hours a week ("Approve each issue and send it from your tool."); team Researcher, Writer, Editor, Billing ("Writes and checks each issue, reads the results."); clients usually pay 5,000 to 20,000 rupees a client a month (model estimate).

**Never:** sending without the owner; buying lists; tracking beyond what the owner's tool reports.

**Done when:** the five engine test files are `# fail 0`, the baseline is committed and the tile is live.

---

## Package 5O: tender and proposal desk (catalogue 2.9.14, TD1 to TD3)

Size M. Depends on 5A5 (DOCX, XLSX, reading an issuer's workbook).

**Registration:** id `tender-desk`, label "Tender and proposal desk", service type `consulting`; picks: "tender", "bid writing", "rfp response", "proposal writing", "gem bid", "government tender". Summary: "Agents answer every question of an RFP from your client's own documents and build the export pack; pricing is always written by you, and the portal submission is yours."

**Offers** (owner sets every price): `bid-response` (project, per bid; pilotable), `documentation-bucket` (project: set up the client's source documents), `compliance-matrix` (add-on).

**Roles:** Researcher (Sales and clients, agent: extracts and classifies questions), Writer (Production, agent), Checker (Operations, agent, read-only), Chausar (Operations, code: groundedness, export), Billing (Money, code).

**Steps:** `bucket` (gather: the client's documents, the source of truth) → `import` (gather: the RFP, pasted or a file; spreadsheet RFPs get a column-mapping step) → `questions` (compute and work: extract and classify) → `assign` (approve: the owner reassigns types) → `draft` (write) → `ground` (verify) → `approve` (owner, by type; floor for pricing) → `export` (operator: the pack) → `submit` (handoff: the owner submits on the portal; government portals always ask).

**Approvals:** every answer by type; pricing rows are always written by the owner; the export.

**Intake fields:** `rfp` (file or text), `issuerWorkbook` (file), `deadline`, `portal` (GeM, CPPP, a state portal, email), `documents` (files).

**Records:** `venture-tender-question` (type: narrative, technical, compliance yes or no, commercial and pricing; length and tone).

**Files:** `playbooks/tender-desk/*` (`registration.ts`, `definition.ts`, `questions.ts`, `ground.ts`, `export.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/tender-desk.json`), `delivery/harness/tools-tender-desk.ts` (`tender.questions`, `tender.ground`), desk `TenderDesk.tsx`, fake and text files; tests `platform/tests/venture-playbook-tender.test.ts`, `venture-tender-questions.test.ts`, `venture-tender-ground.test.ts`, `venture-tender-export.test.ts`.

**Failing tests first:**

1. Export (TD1): DOCX with a cover page, XLSX, a flat CSV compliance matrix, and the issuer's own workbook filled in place (cells written into the uploaded file; formulas and sheets untouched; a cell starting with `=` is written as text); a spreadsheet RFP gets the column-mapping step first. Ideas from Countersign (AGPL): no code.
2. Questions (TD2): each question classified by code rules first (a model suggestion labelled "model estimate"), reassignable by the owner; length and tone per type as two controls; an agent answer on a commercial or pricing question is refused (`PRICING_OWNER_ONLY`).
3. Groundedness (TD3): per answer, retrieval coverage and missing terms; a lexical check that every figure, standard or name in the answer exists in the documents; a gap answer never opens with "Yes"; gaps become one Today request listing the most common missing terms; the committed eval baseline is this playbook's baseline file.

**Judge rules:** `answer-grounded` (required yes), `compliance-honest` (required yes), `answers-the-question` (share 75).

**Baseline cases** (`tender-desk.json`): `gap-not-yes`, `iso-number-not-in-docs`, `pricing-left-to-owner`.

**Rule register** (verify): GeM terms for sellers (https://gem.gov.in) and CPPP (https://eprocure.gov.in), recorded only to say that Chausar never logs in or submits; house rules for answer lengths.

**Connectors:** client documents `read`; RFP files `read`; GeM, CPPP and state portals `handoff` (a person submits; always ask); mail `handoff`.

**Gallery tile:** category Shops and firms; "RFP answers from your client's own documents, with the export pack ready to submit."; you do 4 to 8 hours a week ("Write the prices, approve answers, submit."); team Researcher, Writer, Checker, Billing ("Extracts questions, drafts grounded answers, builds the pack."); clients usually pay 10,000 to 50,000 rupees per bid (model estimate).

**Never:** logging in to a government portal; submitting a bid; writing prices.

**Done when:** the four engine test files are `# fail 0`, the baseline is committed and the tile is live.

---

## Package 5P: website builder, deepened (catalogue 2.9.15, WB1 to WB4, Later WB5, the site part of Later K23)

Size L. Builds on Chausar's Build pieces (brief, handoff, site edits, brief lint) for client sites as well as the owner's own.

**Registration:** id `website-studio`, label "Website builder", service type `studio`; picks: "website builder", "website design service", "build websites for", "web design agency", "landing page service". Summary: "Agents write the brief, check what the builder made against your client's requirements, and keep the site healthy; you approve every release."

**Offers** (owner sets every price): `business-site` (project, per site; pilotable), `landing-page` (project), `site-care` (monthly: updates plus the website check of 5E1), `form-capture` (add-on).

**Roles:** Builder (Production: the owner's builder through the brief, or the owner's own CLI), Writer (Marketing, agent), Checker (Operations, agent, read-only auditor), Chausar (Operations, code), Billing (Money, code).

**Steps:** `brief` (write, with the screen-flow section by code) → `approve-brief` (owner) → `build` (operator: Lovable, Replit or the owner's CLI) → `requirements` (verify) → `ui-check` (verify: the lintapple CI report) → `preview` (operator: staged release) → `approve-release` (owner; floor) → `release` (operator) → `care` (monthly).

**Intake fields:** `requirements` (plain words), `pages`, `forms`, `domain`, `repo` (GitHub, read token), `host` (Cloudflare Pages, Vercel, Netlify, Lovable hosting).

**Files:** `playbooks/website-studio/*` (`registration.ts`, `definition.ts`, `requirements.ts`, `ui-report.ts`, `screen-flow.ts`, `form-capture.ts`, `preview.ts`, `release.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/website-studio.json`); changed `build/brief.ts` (the screen-flow section, one function), `build/catalogue/website-studio.ts`; tools in `delivery/harness/tools-website-studio.ts` (`site.requirements`, `site.uiReport`, `site.flow`, `site.preview`); desk `SiteChecks.tsx`; tests `platform/tests/venture-playbook-website.test.ts`, `venture-site-requirements.test.ts`, `venture-site-ui-report.test.ts`, `venture-site-form-capture.test.ts`, `venture-site-preview.test.ts`, `venture-site-release.test.ts`, `app/ui/tests/places/site-checks.test.tsx`.

**Failing tests first:**

1. Requirements (WB1): explicit and hidden requirements from the brief in plain words with severity; owner-locked ones are never reworded; one read-only audit each; inconclusive is kept apart from fail; a re-check runs only when the files an audit read have changed; the ship line is computed by code ("Do not ship", "Ship with warnings", "Safe to ship"); filter chips with counts. Ideas from QuantumByte (Apache-2.0).
2. UI report (WB2): the client repo's lintapple CI result is read back through the GitHub read token as delivery evidence ("UI check: no problems at phone and desktop, light and dark"), or "not found" with the reason.
3. Screen flow (WB3): the brief's screen-flow section is written by code from the blueprint (which button opens which page).
4. Form capture (WB4): on the hosted app, a form submission on a site Chausar built becomes a client with original and latest source; pausing stops capture within minutes; on desktop, a form export CSV is imported instead (labelled).
5. Page preview (WB5, Later, placed here): a typed block tree the model proposes is rebuilt by code with allowlisted styles, a value filter and caps, applied all or nothing, and undoable after generation.
6. Staged release (K23, site part): for Cloudflare Pages with the owner's token, a preview deployment is made, a health check confirms it answers with the expected marker, then it is promoted on the owner's approval, keeping Roll back; a failed health check never promotes. Chausar's own signed self-update stays out (not a playbook).

**Judge rules:** `meets-locked-requirements` (required yes), `honest-ship-line` (required yes).

**Baseline cases** (`website-studio.json`): `hidden-requirement-missed`, `inconclusive-not-fail`, `health-check-blocks-release`.

**Rule register** (verify): WCAG 2.2 (https://www.w3.org/TR/WCAG22/) for the UI check's targets; Cloudflare Pages deployment API docs; DPDP notice on site forms.

**Connectors:** GitHub `read` (built); Lovable and Replit via the brief `handoff`; Cloudflare Pages `write` (owner's token; previews and promote); Vercel and Netlify `read`; form capture `write` on hosted, CSV `read` on desktop.

**Gallery tile:** category Content; "Business sites and landing pages for clients, checked against their requirements before every release."; you do 3 to 5 hours a week ("Talk to clients, approve releases."); team Builder, Writer, Checker, Billing ("Writes briefs, checks builds, keeps sites healthy."); clients usually pay 15,000 to 60,000 rupees per site (model estimate).

**Never:** pushing to a client's repo without approval; releasing without a passing health check.

**Done when:** the six engine test files are `# fail 0`, the baseline is committed, the desk test passes and the tile is live.

---

## Package 5Q: narration, audiobooks and explainer reels (catalogue 2.9.16 NA1, Later S15)

Size M. Depends on 5A4 (voice consent, transcribe-back, captions, assets), 5A5 (DOCX reading), 5A6 (speech out).

**Registration:** id `narration-studio`, label "Narration and audiobooks", service type `studio`; picks: "audiobook", "narration service", "voice over service", "narrated lessons", "explainer reel". Summary: "Agents narrate manuscripts and lessons with a licensed or consented voice, check every sentence by listening back, and label the AI voice; you approve flagged segments."

**Offers** (owner sets every price): `audiobook` (project, per finished hour; pilotable), `narrated-lessons` (project, per finished hour), `explainer-reel` (project, per reel).

**Roles:** Narrator (Production, agent: markup and segments), Checker (Production, agent, read-only), Producer (Sales and clients, agent), Chausar (Operations, code: synthesis calls, transcribe-back, durations), Billing (Money, code).

**Steps:** `manuscript` (gather: DOCX, TXT or Markdown; rights) → `voice` (approve: a licensed stock voice or a consented voice) → `markup` (write: `{{voice}}`, `{{lang}}`, `{{pause}}`) → `synthesize` (compute; spend reserved, quote first; floor) → `listen-back` (compute) → `review` (approve: the owner listens to flagged segments) → `master` (compute: tails, levels) → `deliver` (operator).

**Intake fields:** `manuscript` (file), `rights` (the author's own text or a licence), `voice` (stock voice with licence id, or a consent record), `languages`, `distribution` (where it will be sold).

**Files:** `playbooks/narration-studio/*` (`registration.ts`, `definition.ts`, `markup.ts`, `segments.ts`, `tails.ts`, `explainer.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/narration-studio.json`), `delivery/harness/tools-narration-studio.ts` (`narration.markup`, `narration.verify`), fake and text files; tests `platform/tests/venture-playbook-narration.test.ts`, `venture-narration-markup.test.ts`, `venture-narration-segments.test.ts`, `venture-explainer-reel.test.ts`.

**Failing tests first:**

1. Markup (NA1): `{{voice}}`, `{{lang}}` and `{{pause}}` per segment are stored with their resolved values and the model revision; an unknown voice or language is refused; a voice without a licence id or current consent refuses `CONSENT_REQUIRED`.
2. Segments: each is transcribed back and marked approved, review or retry (`scoreBack`); unexplained tails are cut with a margin; timing is "unconfirmed" until measured; the finished hours (for the price) come from the audio durations by code.
3. Levels: the master is measured against dated audio specs for the chosen distributor (to verify), with failures listed.
4. Disclosure: every delivery carries the AI narration line; a distributor whose rules (dated row) refuse synthetic narration is shown before the order starts.
5. Explainer reel (S15, Later, placed here): only from a fetched source the client owns or has rights to (net guard, fetch policy), every line a quoted span from it, the AI voice disclosed, captions from 5A4, rendered with ffmpeg on desktop.

**Judge rules:** `reads-the-text` (required yes), `voice-disclosed` (required yes), `pacing-natural` (share 75).

**Baseline cases** (`narration-studio.json`): `unconsented-voice-refused`, `segment-review-flag`, `explainer-quotes-only`.

**Rule register** (verify): ACX audio submission requirements (https://www.acx.com/help/acx-audio-submission-requirements/201456300); ACX, Audible, Google Play Books and Spotify rules on synthetic narration (each page dated); YouTube altered or synthetic content for reels.

**Connectors:** voice providers `write` (owner's key, 5A6; quote first); local speech engines `planned` until found (K13); distributors `handoff` (the author uploads).

**Gallery tile:** category Content; "Audiobooks, narrated lessons and explainer reels in Hindi, English and regional languages, with the AI voice labelled."; you do 2 to 4 hours a week ("Pick voices, listen to flagged parts."); team Narrator, Checker, Producer, Billing ("Marks up text, narrates, listens back."); clients usually pay 3,000 to 12,000 rupees per finished hour (model estimate).

**Never:** cloning a voice without consent; unlabelled AI narration; narrating text without rights.

**Done when:** the four engine test files are `# fail 0`, the baseline is committed and the tile is live.
---

## 5R: the smaller businesses that need no outside approval (catalogue 2.9.17, Later X1 to X9)

The founder's call: build as much as possible, and the smaller businesses are in where no outside party has to approve them. Each is a kit playbook like the others, so each ships data, checks, a baseline, a register, honest connectors, a tile and Hindi. Their connectors that would need someone else's approval stay `planned` with a manual path.

### Package 5R1: virtual assistant service, and the client room every playbook can use (X1, X7)

Size M. Depends on 5A6 (mail in, monitors).

**Registration:** id `virtual-assistant`, label "Virtual assistant service", service type `support`; picks: "virtual assistant", "personal assistant service", "errands service", "executive assistant service". Summary: "Agents keep a few clients' routines, reminders and research moving; you approve every send and every purchase."

**Offers** (owner sets every price): `va-monthly` (monthly, by hours band; pilotable), `errands-pack` (project).

**Roles:** Assistant (Operations, agent), Researcher (Marketing, agent), Chausar (Operations, code: routines and monitors), Billing (Money, code).

**Steps:** `inbox` (gather: mail in, ideas from the inbox) → `plan` (write: the day's list) → `routines` (compute: morning brief, weekly report as 4J13 routines; creating or changing a routine asks, H12) → `draft` (write) → `approve` (floor) → `handoff` (the owner sends or buys).

**Client room (X7), built in `playbooks/kit/client-room.ts` for every playbook:** a client request (through the served share page, or recorded by the owner when no page is served, labelled so) becomes a bounded brief (scope, deliverable, deadline, the price from the owner's list); the owner says yes on the exact version (digest); the client sees that version in the thread. Any playbook turns it on with one definition flag.

**Files:** `playbooks/virtual-assistant/*` (`registration.ts`, `definition.ts`, `routines.ts`, `brief.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/virtual-assistant.json`), `playbooks/kit/client-room.ts`, `delivery/harness/tools-virtual-assistant.ts` (`va.brief`), desk `RoomDesk.tsx`, fake and text files; tests `platform/tests/venture-playbook-va.test.ts`, `venture-va-routines.test.ts`, `venture-client-room.test.ts`.

**Failing tests first:**

1. Routines: the morning brief and weekly report are 4J13 routines (`venture.routines.set`) built from records only (mail threads, monitors, Today), each line with its source; creating or changing one is an always-ask action.
2. Payments: any step that would fill a card, UPI or bank field is refused (`PAYMENT_FIELD_REFUSED`, "Chausar never types payment details. Pay it yourself."); purchases are a handoff with the exact item and total.
3. Client room: a request becomes a brief with the four fields; a second version after the owner's yes needs a new yes; the client's view shows the version the owner approved; with no served page the room says "Your client sees this when you send it".

**Judge rules:** `nothing-sent-unasked` (required yes), `brief-bounded` (required yes).

**Baseline cases:** `card-field-refused`, `morning-brief-sources`, `brief-version-changed`.

**Rule register:** house rules only (routine limits, the payment refusal).

**Connectors:** mail import `read`; the read-only mailbox (4E3); monitors `read`; calendar `handoff`; shops and payments `handoff`.

**Gallery tile:** category Shops and firms; "Routines, reminders, research and drafts for a few busy clients."; you do 5 to 10 hours a week ("Send, buy and call for your clients."); team Assistant, Researcher, Billing ("Morning briefs, drafts, watched pages."); clients usually pay 8,000 to 25,000 rupees a client a month (model estimate).

**Never:** typing card or bank details; buying anything; sending without approval.

**Done when:** the three engine test files are `# fail 0`, the baseline is committed and the tile is live.

### Package 5R2: data entry desk into clients' own systems (X3, Later K20, K21)

Size L. Desktop only.

**Registration:** id `data-entry-desk`, label "Data entry desk", service type `other`; picks: "data entry service", "data entry for", "back office data entry", "form filling service". Summary: "Agents enter records into your clients' own systems through a browser on this computer; every submit waits for you and every saved record is read back."

**Offers** (owner sets every price): `data-entry-monthly` (monthly, per volume band; pilotable), `backlog-project` (project).

**Roles:** Operator (Operations, agent: fills fields from the mapping), Checker (Operations, agent, read-only: compares read-backs), Chausar (Operations, code), Billing (Money, code).

**Steps:** `mapping` (write: field mapping from source columns to form fields) → `approve-mapping` (owner) → `site-check` (approve: the owner ticks that the client's system allows this and gives a staff login the client can revoke; floor) → `fill` (work, in the owner browser) → `hold` (approve each submit, or a batch with screenshots; floor) → `read-back` (compute: each saved record read and compared) → `report`.

**K21, fill forms on a website:** a fresh browser per run unless the owner picks a saved sign-in; the owner signs in with the client's staff login in the window (Chausar never types a password); every submit is held (1D); a risk tick-box before any new site; a screenshot filmstrip of each record. **K20, the embedded owner browser:** a persistent Electron partition inside the desktop window, site permissions denied, external protocols blocked; the agent acts only on snapshot target ids with fingerprints; a capture counts only when every text page shares one page hash.

**Files:** `playbooks/data-entry-desk/*` (`registration.ts`, `definition.ts`, `mapping.ts`, `readback.ts`, `deny.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/data-entry-desk.json`), `build/form-fill.ts` (K21), `app/desktop/owner-browser.cjs` (K20), `delivery/harness/tools-data-entry-desk.ts` (`forms.map`, `forms.readBack`), fake and text files; tests `platform/tests/venture-playbook-data-entry.test.ts`, `venture-form-fill.test.ts`, `venture-forms-readback.test.ts`, `platform/tests/desktop-owner-browser.test.ts`.

**Failing tests first:**

1. Deny list: government portals (`*.gov.in`, `*.nic.in`) and marketplace seller dashboards (Seller Central, Flipkart Seller Hub, Meesho Supplier Panel) are refused (`SITE_NOT_ALLOWED`), and so is any site without the owner's tick.
2. Submits: every submit is held; a batch approval shows each record's screenshot; Enter in a form and button roles are held too (1D's rules).
3. Read-back: each saved record is read and compared field by field; a difference marks it "saved differently" with both values; nothing is retried automatically.
4. K20: the partition denies camera, microphone, location and notifications, blocks `mailto:` and other external protocols, and the agent's actions name snapshot ids whose fingerprints must match.

**Judge rules:** `mapping-faithful` (required yes).

**Baseline cases:** `gov-portal-refused`, `readback-mismatch`, `submit-held`.

**Rule register** (verify): the Information Technology Act 2000, section 43 (why written permission and a revocable staff login are required; a lawyer confirms); house rules for the deny list.

**Connectors:** form fill `write` (desktop, every submit held); source files `read`.

**Gallery tile:** category Shops and firms; "Records entered into your clients' own systems, each submit approved and read back."; you do 4 to 8 hours a week ("Sign in, approve batches."); team Operator, Checker, Billing ("Fills forms from the mapping, compares read-backs."); clients usually pay 5,000 to 20,000 rupees a client a month (model estimate).

**Never:** government portals; marketplace dashboards; typing passwords; unattended submits.

**Done when:** the four engine test files are `# fail 0`, the baseline is committed and the tile is live.

### Package 5R3: app testing and demo videos (X4, X5, Later K22)

Size L. Desktop only.

**Registration:** id `app-testing`, label "App testing and demo videos", service type `consulting`; picks: "app testing service", "mobile app testing", "qa for apps", "demo video service", "product demo videos", "tutorial videos for software". Summary: "Agents test small makers' Android apps on an emulator on this computer and record software demos in a throwaway desktop; you review every finding and every video."

**Offers** (owner sets every price): `app-test-round` (project, per build; pilotable), `demo-video` (project, per video).

**Roles:** Tester (Production, agent), Recorder (Production, agent), Checker (Operations, agent, read-only), Chausar (Operations, code: logcat parsing, recordings), Billing (Money, code).

**Steps (testing):** `plan` (write: test plan from the app description) → `approve-plan` → `run` (work: install the client's APK on the emulator, scripted taps) → `findings` (compute: crashes and ANRs from logcat) → `review` (approve: the owner reviews every finding) → `report` (5A5). **Steps (demo):** `script` (write) → `approve-script` → `record` (work: in a throwaway sandbox desktop from a test account the client made; the owner signs in) → `voice` (compute: an AI voice, disclosed, 5A6) → `captions` (5A4) → `review` → `deliver`.

**Files:** `playbooks/app-testing/*` (`registration.ts`, `definition.ts`, `logcat.ts`, `test-plan.ts`, `demo.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/app-testing.json`), `build/android.ts` and `build/sandbox-desktop.ts` (K22, through K13's contract: `adb`, `emulator`, Docker found on the computer), `delivery/harness/tools-app-testing.ts` (`apptest.logcat`, `demo.plan`), fake and text files; tests `platform/tests/venture-playbook-app-testing.test.ts`, `venture-logcat.test.ts`, `venture-android-port.test.ts`, `venture-sandbox-desktop.test.ts`.

**Failing tests first:**

1. Logcat: `FATAL EXCEPTION`, `ANR in` and native crash blocks are parsed by code into findings with the stack's first app frame; findings need the owner's review before the report.
2. Emulator only: a real device serial (not `emulator-NNNN`) is refused (`REAL_DEVICE_REFUSED`); no personal accounts (a run that meets a Google sign-in screen stops and asks); the APK comes from the client.
3. Sandbox desktop: recordings run only inside a container Chausar started for this run and removes after; a distinct agent cursor overlay is drawn; with no Docker the connector is `planned` with "Install Docker yourself; Chausar never installs it."
4. Demo disclosure: the AI voice line is in the video description; captions pass 5A4's validator.

**Judge rules:** `finding-reproducible` (required yes), `demo-matches-script` (share 75), `voice-disclosed` (required yes).

**Baseline cases:** `crash-found`, `real-device-refused`, `demo-voice-labelled`.

**Rule register:** house rules (emulator only, sandbox only); the Android emulator and adb docs as sources for the commands.

**Connectors:** Android SDK `planned` until found, then `write` (desktop, the emulator only); Docker `planned` until found; voice providers `write` (owner's key).

**Gallery tile:** category Content; "Emulator test rounds for small app makers, and recorded software demos."; you do 3 to 6 hours a week ("Review findings and videos."); team Tester, Recorder, Checker, Billing ("Runs the app, reads crashes, records demos."); clients usually pay 5,000 to 25,000 rupees per round (model estimate).

**Never:** real phones with personal accounts; cloud phones with real numbers; recording on the owner's own desktop.

**Done when:** the four engine test files are `# fail 0`, the baseline is committed and the tile is live.

### Package 5R4: dev-agency trio (X6)

Size M. Uses the owner's own Claude Code or Codex (the existing owner-CLI tier).

**Registration:** id `dev-agency`, label "Dev agency: maintenance, QA and security reviews", service type `consulting`; picks: "maintenance retainer", "website maintenance", "qa as a service", "security review for", "code review service". Summary: "Your own coding tool does the work on a local copy; every pull request waits for you, and security reviews need the code owner's written permission."

**Offers** (owner sets every price): `maintenance-retainer` (monthly; the first week is a report only; pilotable), `qa-service` (project, per release: a verdict line and findings before shipping), `security-review` (project; written permission from the code owner recorded at intake).

**Roles:** Engineer (Production: the owner's CLI), Reviewer (Operations, agent, read-only), Chausar (Operations, code: scanners), Billing (Money, code).

**Steps:** `permission` (approve: the code owner's written permission for security work; floor) → `clone` (operator: the owner's local copy) → `work` (the owner's CLI after the owner approves the brief, existing tier) → `checks` (compute: secret screen 1F, `npm audit --json` read only, any scanner the owner installed through K13) → `findings` (write) → `approve-pr` (floor) → `push` (delegated: the owner's own tool pushes after approval).

**Files:** `playbooks/dev-agency/*` (`registration.ts`, `definition.ts`, `verdict.ts`, `scanners.ts`, `permission.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/dev-agency.json`), `delivery/harness/tools-dev-agency.ts` (`qa.verdict`, `security.scan`), fake and text files; tests `platform/tests/venture-playbook-dev-agency.test.ts`, `venture-dev-verdict.test.ts`, `venture-dev-security.test.ts`.

**Failing tests first:**

1. Week one: a maintenance retainer's first-week run may only report (`FIRST_WEEK_REPORT_ONLY` on any change proposal).
2. Security permission: a security review without a recorded written permission (who, what systems, the window) refuses `PERMISSION_REQUIRED`; nothing is tested against a live system; findings never include exploit steps.
3. QA verdict: the verdict line is computed by code from the findings' severities ("Do not ship", "Ship with fixes", "Ship").
4. Push: Chausar never holds a write token; the push is the owner's own command after approval (delegated), recorded in the journal.

**Judge rules:** `findings-evidenced` (required yes), `no-exploit-steps` (required yes).

**Baseline cases:** `security-without-permission`, `first-week-report-only`, `verdict-from-severities`.

**Rule register** (verify): Information Technology Act 2000, sections 43 and 66 (why permission is required); CERT-In directions on reporting (for the owner to know); house rules.

**Connectors:** GitHub `read` (built); the owner's CLI `delegated`; scanners `planned` until found (K13).

**Gallery tile:** category Content; "Maintenance retainers, QA before release and security reviews for small web apps."; you do 4 to 8 hours a week ("Approve pull requests, talk to clients."); team Engineer, Reviewer, Billing ("Works on a local copy, finds issues, writes the report."); clients usually pay 10,000 to 40,000 rupees a client a month (model estimate).

**Never:** testing without written permission; pushing without approval; exploit code.

**Done when:** the three engine test files are `# fail 0`, the baseline is committed and the tile is live.

### Package 5R5: monitored data and IT triage (X8, X9)

Size M. Depends on 5A6 (monitors, fetch policy) and 2B2 (selector candidates with dates).

**Registrations:** id `monitored-data`, label "Monitored data service", service type `research`; picks: "price monitoring", "tender alerts", "competitor price tracking", "data monitoring service". Id `it-triage`, label "IT triage desk", service type `support`; picks: "it support desk", "on-call triage", "slack support bot", "it helpdesk for". Summaries: "Agents watch public pages whose terms allow it and send your clients clean updates." and "Agents read a team's help channel and draft triage summaries; every reply in their Slack waits for you."

**Offers** (owner sets every price): `price-list-watch`, `tender-board-watch` (monthly, per source; pilotable); `triage-desk` (monthly, per team).

**Roles:** Watcher (Operations, agent), Analyst (Marketing, agent), Triage lead (Operations, agent), Chausar (Operations, code), Billing (Money, code).

**Steps (monitored data):** `terms` (approve: the site's terms URL, robots and the owner's tick that the terms allow it; floor) → `selectors` (approve: the owner picks elements once) → `watch` (compute, K16) → `extract` (compute: owner-picked selectors only) → `deliver` (CSV or XLSX through 5A5). **Steps (triage):** `read` (gather: mentions in one channel, untrusted) → `summarise` (write) → `approve` (floor) → `post` (operator).

**Files:** `playbooks/monitored-data/*`, `playbooks/it-triage/*` (each with `registration.ts`, `definition.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/<id>.json`), `build/slack-socket.ts`, `delivery/harness/tools-monitored-data.ts` (`monitor.extract`), `delivery/harness/tools-it-triage.ts` (`triage.summary`), fakes and text files; tests `platform/tests/venture-playbook-monitored.test.ts`, `venture-monitored-extract.test.ts`, `venture-playbook-it-triage.test.ts`, `venture-slack-socket.test.ts`.

**Failing tests first:**

1. Terms: a source with no terms tick, on the fetch policy list, or disallowed by robots is refused; selectors carry their own checked dates (2B2's shape) and a selector that no longer matches exactly one element stops the extract with a plain line.
2. Extract: values come only from owner-picked selectors, parsed by code (prices into paise); a changed page layout is reported, never guessed.
3. Slack: Socket Mode with tokens the client's admin creates and the owner types in Connections; the bot reads only the one channel named; every post is approved (floor); messages from the channel are untrusted (1E) and a summary that would act on an instruction in them is held; Microsoft Teams stays `planned` (it needs the client's tenant consent and a bot registration).

**Judge rules:** `values-from-page` (required yes), `triage-accurate` (share 75), `no-secrets-echoed` (required yes).

**Baseline cases:** `terms-not-ticked`, `selector-drifted`, `slack-instruction-held`.

**Rule register** (verify): each watched site's terms page (per source, dated); Slack API terms and Socket Mode docs (https://api.slack.com/apis/socket-mode).

**Connectors:** page monitors `read`; Slack `write` (the client's own workspace app, each post approved); Teams `planned: write` (manual path: copy the summary).

**Gallery tiles:** monitored data, category Marketing; "Price lists and tender boards watched for clients, from pages whose terms allow it."; 2 to 4 hours a week ("Pick sources, check the terms."); team Watcher, Analyst, Billing; 3,000 to 12,000 rupees a client a month (model estimate). IT triage, category Shops and firms; "Help-channel triage summaries for small teams, every reply approved."; 3 to 6 hours a week ("Approve replies, fix what needs a person."); team Triage lead, Billing; 8,000 to 25,000 rupees a team a month (model estimate).

**Never:** scraping sites whose terms forbid it; guessing values; posting in a client's Slack without approval.

**Done when:** the four engine test files are `# fail 0`, both baselines are committed and both tiles are live.

### Package 5R6: AI phone receptionist (X2)

Size M. The live-call connector needs a voice provider, an Indian number on the owner's own account (with the provider's KYC) and a webhook to the hosted app; which provider meets that is checked on build day. Everything around the call is built now.

**Registration:** id `phone-receptionist`, label "AI phone receptionist", service type `support`; picks: "phone receptionist", "ai receptionist", "call answering service", "clinic receptionist". Summary: "An AI voice answers your clients' calls with their facts, says it is an AI, and hands every booking and callback to a person; calls run only within the budget you set."

**Offers** (owner sets every price): `receptionist-setup` (project; pilotable), `receptionist-monthly` (monthly, within a call budget).

**Roles:** Receptionist (Sales and clients, agent: the call script), Checker (Operations, agent, read-only: call logs), Chausar (Operations, code: budget, costs), Billing (Money, code).

**Steps:** `facts` (gather: hours, services, prices from the client's list, FAQ) → `script` (write: the first line says it is an AI and that the call may be recorded) → `approve-script` (floor) → `connect` (operator: the provider, planned) → `calls` (gather: the provider's call logs or export, untrusted) → `review` (write: callbacks and bookings for a person) → `report`.

**Files:** `playbooks/phone-receptionist/*` (`registration.ts`, `definition.ts`, `script.ts`, `budget.ts`, `call-cost.ts`, `logs.ts`, `rules.ts`, `tile.ts`, `hi.json`, `baselines/phone-receptionist.json`), `build/voice-calls.ts` (the provider port with a fake), `delivery/harness/tools-phone-receptionist.ts` (`calls.cost`, `calls.log`), fake and text files; tests `platform/tests/venture-playbook-receptionist.test.ts`, `venture-call-budget.test.ts`, `venture-call-cost.test.ts`.

**Failing tests first:**

1. Script: the first line names the AI and the recording; every fact in the script is in the client's facts (claims check); prices come only from the client's list; anything about money, health or legal goes to a person.
2. Budget: a call is admitted only when the month's reserve covers its estimated cost; past the cap the provider is told to forward to the client's own number (fake port records it).
3. Cost per call by leg (telephony minutes, speech to text, model, text to speech) from the provider's export, priced from a dated rate table; an unpriced leg refuses (`UNPRICED_CALL`).
4. Logs: transcripts are untrusted (1E); bookings and callbacks become Today rows for a person; nothing is booked by the agent alone.

**Judge rules:** `ai-disclosed` (required yes), `facts-only` (required yes), `handoff-to-person` (required yes).

**Baseline cases:** `ai-first-line`, `price-from-list`, `medical-question-to-person`.

**Rule register** (verify): TRAI commercial communication rules; DPDP notice for callers; each candidate provider's terms and India number pages (build day).

**Connectors:** voice provider `planned: write` until a provider row is verified (manual path: "Use your phone's own call forwarding; the script is ready to read"); call logs `read` (export files).

**Gallery tile:** category Shops and firms; "An AI receptionist for clinics and shops that says it is an AI and hands bookings to a person."; you do 2 to 4 hours a week ("Set facts, call people back."); team Receptionist, Checker, Billing ("Answers with facts, logs callbacks."); clients usually pay 5,000 to 15,000 rupees a client a month (model estimate).

**Never:** an undisclosed AI voice; outbound promotional calls; booking or charging without a person.

**Done when:** the three engine test files are `# fail 0`, the baseline is committed and the tile is live; the connector card says planned with its reason until a provider is verified.

---

## Wave 5 done when

- Every package's tests pass; `npm run typecheck` and `npm run typecheck:ui` are clean; `npm run test:ui` and all six bench shards (`node scripts/bench.mjs`, in the background) are green, with no skipped tests.
- Each new playbook: `definePlaybook` accepts it; its checks have failing-first tests; its judge baseline is committed under `playbooks/<id>/baselines/` and `runKitBaseline` passes at that rate; its rule register validates with sources and dates; every connector shows a tested label; its tile is in `venture.playbooks.list` and the gallery in English and Hindi; every string has a Hindi entry marked for a native reviewer.
- Each deepened flagship: its new offers, steps, checks, rules and baseline cases are in, and its existing tests still pass.
- Every new file's header names the products it learned from and their licence; nothing is copied from a learn-only source.
- One PR "Ink v2 wave 5: playbooks", stacked on wave 4, with the coverage table and conventional commits (`feat(w5): ...`), one or more per package.

## Not placed (and why)

- **Spec non-goals:** O24 and K19 (a Telegram approval bot and chat channel: designed, not built); C23 (circles need many hosted users); C24 (Gmail and Outlook sign-in wait on Google's restricted-scope review).
- **K25 apart from Telegram and Discord** (5D3): X, LinkedIn, Facebook, Instagram, Reddit and YouTube OAuth posting each wait on an app review; they stay `planned: write`.
- **H37** supply-chain screen: needed only once third-party add-ons exist; playbooks stay first-party data in this build.
- **A19** voice on Today: an app feature, not a playbook, and it needs a paid realtime model; a later W4-style package.
- **U19** small UI extras: app features, not playbooks (the competitor watchlist idea is covered by 5D2's ad ledger and 5R5's monitors).
- **K23 signed self-update:** Chausar's own release process and a code-signing certificate, not a playbook; only the site release part is in 5P.

## Open questions for the founder

1. Gallery figures: the tile's hours and price ranges are Chausar's own estimates (labelled "model estimate"). The D-Start board's meta line says "Hours and prices are for a typical start"; this plan changes it to "Hours and prices are model estimates for a typical start". Say if you want different words.
2. Share prices (5A2): recruiting success fees as a share of annual pay and reimbursement audits as a share of recovered money need a new price kind. Keep them, or ship fixed fees only?
3. The order of batch 2 (see "Order of work"): this plan starts lead generation, SEO, bookkeeping, the online seller and the support desk first, as the catalogue recommends, with the YouTube and CA deepening beside them.
4. 5F3 and 5K2 depend on build-day checks (Shopify app creation, Zoho self clients). If either now needs an outside review, its label stays planned; confirm that is acceptable.
5. The phone receptionist (5R6) ships everything except the live call until a provider is verified. Keep it in this wave, or move it later?
