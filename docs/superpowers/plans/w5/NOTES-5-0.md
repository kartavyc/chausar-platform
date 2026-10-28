# NOTES-5-0: what package 5-0 built (Ink v2 wave 5)

Written by the 5-0 implementer on 27 Oct 2026, branch `b2c/ink-v2-w5`, nothing committed. This wins over the plan where they differ. Paths are relative to `platform/runtime/venture/` unless they start with `app/` or `platform/`.

Everything 5-0 added answers `NOT_BUILT_YET` ("This part of Chausar is not built yet.") on the engine and in the fake, or renders "Not built yet" (text key `kit-desk.notBuilt`). No behaviour was added.

## 0. The rules every package follows with these seams

- **Methods.** All 34 wave 5 methods are in `contracts.ts` `W5_METHODS` (spread into `VENTURE_METHODS` after `W4_METHODS`), with `W5_METHOD_LEVELS` (the level the handler authorizes at) and `METHOD_OWNERS`. Owner `playbooks` (a new `VenturePackageId`; handler table `playbooks/index.ts`, loader in `host.ts`) for all but 5A6's eight, owned by `build` (`build/index.ts`). Replace your own `notBuiltYet` line with your handler (one line each). Hints: `method-hints.ts` `W5_FLAGS` (one line per method; fix yours if wrong).
- **Payloads** are written inline in `contracts.ts` `VenturePayloads` from the plan's words; **results** and **record bodies** are placeholders `{ placeholder: true }` in the owning package's records file (list below). Replace them there; touch `contracts.ts` only for a payload line of your own (one small edit).
- **Records:** each new kind is `RecordBase<kind> & Body` in `contracts.ts` section 9f, joined to `AnyVentureRecord`, with an id prefix in `records.ts` `ID_PREFIX`.
- **Tools:** every new name has a stub `notBuiltTool(name, effect, words)` (`delivery/harness/tool-stub.ts`) in its file; `tools.ts` spreads `PLAYBOOK_TOOLS` (`delivery/harness/tools-playbooks.ts`, never edited after 5-0). Each tool also has one line, written by 5-0 in a per-package block, in four shared maps you correct for your own tools: `delivery/harness/tool-purpose.ts` `TOOL_PURPOSE` (past tense, the run sheet), `agents/capabilities.ts` `TOOL_WORDS` (the capability page), `delivery/harness/tool-groups.ts` `TOOL_GROUPS` (group = `kit`, the flagship's existing group, or the playbook id) and `policy/effects.ts` `TOOL_DECLARATIONS` (effects and integrity, from the plan's words). No tool is granted to any role yet: `patches.ts` `FLAGSHIP_TOOLS` is unchanged; 5A1 grants kit tools from definitions; a flagship package adds its own names to `FLAGSHIP_TOOLS`.
- **Flagship tools** live in a separate table at the end of `tools-youtube.ts` (`YOUTUBE_W5_TOOLS`), `tools-ca.ts` (`CA_W5_TOOLS`), `tools-social.ts` (`SOCIAL_W5_TOOLS`): move your tool into the main table (and its name into that table's `Extract` type), delete your stub line there.
- **Events:** `chain.changed` (5A1), `desk.changed` (every desk), `idea.changed` (5A3) are run events (ids only) in `VENTURE_EVENTS`, `VentureRunEventType`, `VENTURE_RUN_EVENT_TYPES`, the desktop's `ipc-contract.cjs`/`.d.cts`/`preload.cjs`, and the UI's `engine/types.ts` and `engine/events.ts`.
- **Load-order trap:** `build/catalogue/<id>.ts` and `delivery/harness/tools-<id>.ts` load while `catalogue.ts` / `tools.ts` are still being set up. Import only types from `catalogue.ts`; from `tools.ts` only function declarations (`fail`, `text`, `computedTable`, `fileOf`) are safe at load (hoisted); never read a `const` of theirs at module top level.
- `tool-purpose.ts` must stay a leaf module (no imports): `breaker.ts` reads it at load time.

## 1. Every name added, by package (exact spelling)

Shared (5-0 itself): `W5_METHODS`, `W5Method`, `W5_METHOD_LEVELS` (contracts.ts); `VenturePackageId` gains `'playbooks'`; `W5_FLAGS` (method-hints.ts); `Department` (= wave 4's `DepartmentId`: `'sales' | 'marketing' | 'production' | 'money' | 'operations'`); `OrderIntake.fields?: Record<string, IntakeValue>`; `OrderRecord.chainStage?: number`, `OrderRecord.chainState?: 'running' | 'waiting' | 'stopped' | 'done'`; `notBuiltTool`, `NOT_BUILT_TOOL` (tool-stub.ts); `PLAYBOOK_TOOLS`, `PLAYBOOK_REGISTRATIONS`, `PLAYBOOK_DEFINITIONS`, `PLAYBOOK_DESKS`, `deskHandler(playbook, kind)`, `PLAYBOOK_CATALOGUE_ENTRIES`; desk types in `playbooks/desk-types.ts`: `DeskKindTypes`, `DeskTypes`, `DeskPlaybook`, `DeskKey`, `DeskRow`, `DeskItem`, `DeskActResult`, `DeskListPayload`, `DeskGetPayload`, `DeskActPayload`, `DeskListView`, `DeskItemView`, `DeskActView`, `DeskHandler`, `DeskHandlers`; desk methods `venture.desk.list` (read), `venture.desk.get` (read), `venture.desk.act` (approve, app only). UI: `W5Placeholder` and every result alias below in `app/ui/src/engine/types.ts`, `DeskPlaybook` there too; `FakePlaybooksDesk`, `FakePlaybookDesk`, `FakeDeskKind` (fake-playbooks.ts); `DESKS` (places/work/desks/index.ts); text key `kit-desk.notBuilt` (`text/{en,hi}/kit-desk.json`, listed in `hi-review.json`).

### 5A1

- Methods: `venture.order.chain` {orderId} -> OrderChainView (read).
- Types in `playbooks/kit/define.ts` (types only): `PlaybookDefinition`, `KitOffer`, `OfferAudience`, `KitRole`, `KitStep`, `KitApproval`, `KitConnectorLabel`, `KitConnector`, `IntakeFieldKind`, `KitIntakeField`, `KitCheckResult`, `KitCheck`, `KitJudgeRule`, `KitBaselineCase`, `KitBaseline`, `RuleRead`, `DatedRule` (5A3 re-exports it from here), `KitRecipe`, `KitBoundary`, `KitPracticeClient`, `KitPlanPicks`, `StartTile`, `KitScope`, `IntakeValue`. `StartTile` and `IntakeValue` are re-exported by contracts.ts. `OrderChainView` in `playbooks/kit/records-chain.ts`. UI fake: `FakeKitChainDesk` (`app/ui/src/engine/fake-kit-chain.ts`).

### 5A2

- Methods: `venture.salesProposal.draft` ({clientId} | {personId}) & {offerId, pilot?: boolean} -> SalesProposalView (prepare); `venture.salesProposal.get` {id} -> SalesProposalView (read); `venture.goNoGo.card` {playbook, subject, inputs: GoNoGoInputs} -> GoNoGoCardView (prepare).
- Record kinds: `venture-go-no-go` (GoNoGoRecord, body GoNoGoBody in playbooks/kit/records-sales.ts).
- Types in `playbooks/kit/records-sales.ts`: `GoNoGoBody`, `GoNoGoInputs` (`Readonly<Record<string, string | null>>`), `GoNoGoCardView`, `SalesProposalView`, `SharePrice` (`{ kind: 'share'; bps: BpsString; baseMinor: MinorString | null; baseEvidenceFileId: string | null }`, re-exported by contracts.ts). UI fake `FakeKitSalesDesk` (fake-kit-sales.ts).

### 5A3

- Methods: `venture.ideas.add` {text, source} -> IdeaAddedView (prepare, app only); `venture.ideas.move` {id, stage: IdeaStage, reason?} -> IdeaMovedView (prepare); `venture.ideas.grade` {id, grade: IdeaGrade} -> IdeaGradedView (prepare).
- Tools: `ideas.add` (in `delivery/harness/tools-kit.ts (KIT_TOOLS)`).
- Types in `playbooks/kit/records-rules.ts`: `IdeaStage` (`'inbox' | 'triage' | 'drafted' | 'made' | 'published' | 'dropped'`), `IdeaGrade` (`'worked' | 'so-so' | 'did-not'`), `IdeaAddedView`, `IdeaMovedView`, `IdeaGradedView`. No new record kind: ideas stay 4J18's `venture-idea`. UI fake `FakeKitRulesDesk` (fake-kit-rules.ts).

### 5A4

- Methods: `venture.brandKit.get` {clientId} -> BrandKitView (read); `venture.brandKit.set` {clientId, kit: BrandKitInput} -> BrandKitView (approve, app only); `venture.assets.list` {orderId?, clientId?} -> AssetsView (read); `venture.assets.rerun` {id} -> AssetRerunView (prepare); `venture.assets.reuse` {id, orderId} -> AssetReuseView (prepare); `venture.voiceConsent.record` {speaker, recordingFileId, transcript, statement, scope, until: IsoDate | null} -> VoiceConsentView (approve, app only); `venture.voiceConsent.revoke` {id} -> VoiceConsentView (approve, app only); `venture.voiceConsent.list` {} -> VoiceConsentsView (read).
- Record kinds: `venture-brand-kit` (BrandKitRecord, BrandKitBody); `venture-asset` (AssetRecord, AssetBody); `venture-voice-consent` (VoiceConsentRecord, VoiceConsentBody), all in playbooks/kit/records-media.ts.
- Tools: `assets.record`, `media.clean` (in `delivery/harness/tools-kit.ts (KIT_TOOLS)`).
- Types in `playbooks/kit/records-media.ts`: `BrandKitBody`, `BrandKitInput`, `BrandKitView`, `AssetBody`, `AssetsView`, `AssetRerunView`, `AssetReuseView`, `VoiceConsentBody`, `VoiceConsentView`, `VoiceConsentsView`. UI fake `FakeKitMediaDesk` (fake-kit-media.ts).

### 5A5

- Methods: `venture.report.render` {runId, formats?: ReportFormat[]} -> ReportView (prepare); `venture.report.share` {reportId, from, to, channels?} -> ReportShareView (approve, app only); `venture.report.shareRotate` {shareId} -> ReportShareView (approve, app only); `venture.report.shareDisable` {shareId} -> ReportShareView (approve, app only).
- Record kinds: `venture-report` (ReportRecord, ReportBody); `venture-report-share` (ReportShareRecord, ReportShareBody), both in playbooks/kit/records-report.ts.
- Types in `playbooks/kit/records-report.ts`: `ReportFormat` (`'html' | 'pdf' | 'docx' | 'xlsx'`), `ReportBody`, `ReportShareBody`, `ReportView`, `ReportShareView`. UI fake `FakeKitReportDesk` (fake-kit-report.ts).

### 5A6

- Methods: `venture.monitors.list` {} -> MonitorsView (read); `venture.monitors.add` MonitorInput {url, kind: 'change'|'contains'|'price-below', text?, selector?, belowMinor?} -> MonitorView (approve, app only); `venture.monitors.remove` {id} -> MonitorView (approve, app only); `venture.mail.import` {uploadId} -> MailImportView (approve, app only); `venture.mail.threads` {clientId?} -> MailThreadsView (read); `venture.localApps.list` {} -> LocalAppsView (read); `venture.webhook.set` {kind: 'n8n'|'make', url: string|null} -> WebhookView (approve, app only); `venture.speechOut.providers` {} -> SpeechProvidersView (read).
- Record kinds: `venture-monitor` (MonitorRecord, MonitorBody in build/records-connect.ts).
- Tools: `localapp.run`, `mail.read`, `speech.say` (in `delivery/harness/tools-kit.ts (KIT_TOOLS)`).
- Types in `build/records-connect.ts`: `MonitorBody`, `MonitorInput`, `MonitorView`, `MonitorsView`, `MailImportView`, `MailThreadsView`, `LocalAppsView`, `WebhookView`, `SpeechProvidersView`. UI fake `FakeKitConnectDesk` (fake-kit-connect.ts).

### 5B1

- Record kinds: `venture-youtube-edit` (YoutubeEditRecord, YoutubeEditBody); `venture-youtube-dictionary` (YoutubeDictionaryRecord, YoutubeDictionaryBody), in playbooks/youtube/records.ts.
- Tools: `youtube.editOps`, `youtube.clean`, `youtube.captions`, `youtube.coverage`, `youtube.dictionary` (in `delivery/harness/tools-youtube.ts (YOUTUBE_W5_TOOLS)`).
- Desk: `playbooks/youtube/desk.ts` (`YOUTUBE_DESK`, `YoutubeDeskTypes`), UI `YoutubeDesk.tsx` (`YoutubeDesk`), fake `app/ui/src/engine/fake-youtube.ts` (`fakeYoutubeDesk`); 5B1, 5B2, 5B3 share them in sequence (the plan's `YoutubeEdit.tsx`, `YoutubeBoard.tsx`, `Teleprompter.tsx` are rendered from `YoutubeDesk.tsx`).

### 5B2

- Record kinds: `venture-youtube-style` (YoutubeStyleRecord, YoutubeStyleBody in playbooks/youtube/records.ts).
- Tools: `youtube.style`, `youtube.clips`, `youtube.broll`, `youtube.beats`, `youtube.export` (in `delivery/harness/tools-youtube.ts (YOUTUBE_W5_TOOLS)`).
- Body `YoutubeStyleBody` (and 5B1's `YoutubeEditBody`, `YoutubeDictionaryBody`) in `playbooks/youtube/records.ts`.

### 5B3

- Tools: `youtube.afterPublish`, `youtube.outliers`, `youtube.niche`, `youtube.comments`, `youtube.publicStats`, `youtube.archive` (in `delivery/harness/tools-youtube.ts (YOUTUBE_W5_TOOLS)`).

### 5C1

- Methods: `venture.ca.confirmCitations` {version, membershipNo} -> CitationsConfirmView (approve, app only); `venture.ca.signoff.get` {id} -> SignoffCheckView (read).
- Record kinds: `venture-ca-citations` (CaCitationsRecord, CaCitationsBody in playbooks/ca-firm/records.ts).
- Tools: `tax.citations`, `tax.formChooser`, `tax.advance` (in `delivery/harness/tools-ca.ts (CA_W5_TOOLS)`).
- Types in `playbooks/ca-firm/records.ts`: `CaCitationsBody`, `CaDifferentialBody`, `CaDataPackBody`, `CitationsConfirmView`, `SignoffCheckView`, `DifferentialAddView`, `DataPackExportView`. Desk `playbooks/ca-firm/desk.ts` (`CA_FIRM_DESK`, `CaFirmDeskTypes`), UI `CaFirmDesk.tsx`, fake `app/ui/src/engine/fake-ca-firm.ts` (`fakeCaFirmDesk`, which also answers the four new `venture.ca.*` methods with NOT_BUILT_YET in its `methods`).

### 5C2

- Methods: `venture.ca.differential.add` {name, inputs: Json, outputs: Json, capturedBy} -> DifferentialAddView (approve, app only); `venture.ca.dataPack.export` {clientId, fields: string[]} -> DataPackExportView (approve, app only).
- Record kinds: `venture-ca-differential` (CaDifferentialRecord, CaDifferentialBody); `venture-ca-data-pack` (CaDataPackRecord, CaDataPackBody), in playbooks/ca-firm/records.ts.
- Tools: `tax.whatIf`, `books.healthCheck`, `docs.entry` (in `delivery/harness/tools-ca.ts (CA_W5_TOOLS)`).

### 5D1

- Tools: `social.formats`, `social.inventory`, `social.slots` (in `delivery/harness/tools-social.ts (SOCIAL_W5_TOOLS)`).
- Desk: `playbooks/social/desk.ts` (`SOCIAL_AGENCY_DESK`, `SocialAgencyDeskTypes`; desk id `social-agency`), UI `SocialAgencyDesk.tsx`, fake `app/ui/src/engine/fake-social.ts` (`fakeSocialAgencyDesk`). Bodies `SocialInboxItemBody`, `AdLedgerEntryBody`, `InfluencerCaseBody` in `playbooks/social/records.ts`.

### 5D2

- Record kinds: `venture-social-inbox-item` (SocialInboxItemRecord, SocialInboxItemBody); `venture-ad-ledger-entry` (AdLedgerEntryRecord, AdLedgerEntryBody), in playbooks/social/records.ts.
- Tools: `social.montage`, `social.inbox`, `social.diagnose`, `social.health`, `social.adStyle` (in `delivery/harness/tools-social.ts (SOCIAL_W5_TOOLS)`).

### 5D3

- Record kinds: `venture-influencer-case` (InfluencerCaseRecord, InfluencerCaseBody in playbooks/social/records.ts).
- Tools: `social.fairPrice`, `social.keywords` (in `delivery/harness/tools-social.ts (SOCIAL_W5_TOOLS)`).

### 5E1

- Tools: `seo.diagnose`, `seo.aiAccess`, `seo.panel`, `seo.siteCheck` (in `delivery/harness/tools-seo-visibility.ts (SEO_VISIBILITY_TOOLS)`).
- Playbook `seo-visibility` ("Search and AI-search visibility"): `SEO_VISIBILITY_REGISTRATION`, `SEO_VISIBILITY_DEFINITION`, `SEO_VISIBILITY_DESK`, type `SeoVisibilityDeskTypes`, `SEO_VISIBILITY_TOOLS`, `SEO_VISIBILITY_CATALOGUE`; UI `SeoVisibilityDesk`, `fakeSeoVisibilityDesk`.
  Record kinds: `venture-seo-panel` (SeoPanelRecord, body `SeoPanelBody`); `venture-seo-observation` (SeoObservationRecord, body `SeoObservationBody`); `venture-seo-finding` (SeoFindingRecord, body `SeoFindingBody`) in `playbooks/seo-visibility/records.ts`.

### 5E2

- Tools: `seo.corroborate`, `seo.lint`, `seo.meta`, `seo.impact`, `seo.refresh`, `seo.local` (in `delivery/harness/tools-seo-visibility.ts (SEO_VISIBILITY_TOOLS)`).

### 5F1

- Tools: `seller.unitEconomics`, `seller.ads`, `seller.settlement`, `seller.listing` (in `delivery/harness/tools-online-seller.ts (ONLINE_SELLER_TOOLS)`).
- Playbook `online-seller` ("Online seller and seller services"): `ONLINE_SELLER_REGISTRATION`, `ONLINE_SELLER_DEFINITION`, `ONLINE_SELLER_DESK`, type `OnlineSellerDeskTypes`, `ONLINE_SELLER_TOOLS`, `ONLINE_SELLER_CATALOGUE`; UI `OnlineSellerDesk`, `fakeOnlineSellerDesk`.
  Record kinds: `venture-seller-sku` (SellerSkuRecord, body `SellerSkuBody`); `venture-seller-feecard` (SellerFeecardRecord, body `SellerFeecardBody`); `venture-seller-stage` (SellerStageRecord, body `SellerStageBody`); `venture-seller-movement` (SellerMovementRecord, body `SellerMovementBody`); `venture-seller-case` (SellerCaseRecord, body `SellerCaseBody`) in `playbooks/online-seller/records.ts`.

### 5F2

- Tools: `seller.stage`, `seller.alerts`, `seller.stock`, `seller.shortlist`, `seller.catalogueSheet`, `seller.multiStore` (in `delivery/harness/tools-online-seller.ts (ONLINE_SELLER_TOOLS)`).

### 5F3


### 5G

- Tools: `support.match`, `support.ticket` (in `delivery/harness/tools-support-desk.ts (SUPPORT_DESK_TOOLS)`).
- Playbook `support-desk` ("Support desk for small shops"): `SUPPORT_DESK_REGISTRATION`, `SUPPORT_DESK_DEFINITION`, `SUPPORT_DESK_DESK`, type `SupportDeskDeskTypes`, `SUPPORT_DESK_TOOLS`, `SUPPORT_DESK_CATALOGUE`; UI `SupportDeskDesk`, `fakeSupportDeskDesk`.
  Record kinds: `venture-support-ticket` (SupportTicketRecord, body `SupportTicketBody`); `venture-support-message` (SupportMessageRecord, body `SupportMessageBody`); `venture-support-request` (SupportRequestRecord, body `SupportRequestBody`); `venture-support-rating` (SupportRatingRecord, body `SupportRatingBody`) in `playbooks/support-desk/records.ts`.

### 5H

- Tools: `recruit.criteria`, `recruit.ledger`, `recruit.slots` (in `delivery/harness/tools-recruiting-desk.ts (RECRUITING_DESK_TOOLS)`).
- Playbook `recruiting-desk` ("Recruiting desk"): `RECRUITING_DESK_REGISTRATION`, `RECRUITING_DESK_DEFINITION`, `RECRUITING_DESK_DESK`, type `RecruitingDeskDeskTypes`, `RECRUITING_DESK_TOOLS`, `RECRUITING_DESK_CATALOGUE`; UI `RecruitingDeskDesk`, `fakeRecruitingDeskDesk`.
  Record kinds: `venture-recruit-role` (RecruitRoleRecord, body `RecruitRoleBody`); `venture-recruit-candidate` (RecruitCandidateRecord, body `RecruitCandidateBody`); `venture-recruit-touch` (RecruitTouchRecord, body `RecruitTouchBody`); `venture-recruit-interview` (RecruitInterviewRecord, body `RecruitInterviewBody`) in `playbooks/recruiting-desk/records.ts`.

### 5I

- Tools: `career.facts`, `career.capture`, `career.shortlist`, `career.score` (in `delivery/harness/tools-job-search-desk.ts (JOB_SEARCH_DESK_TOOLS)`).
- Playbook `job-search-desk` ("Job-search and career desk"): `JOB_SEARCH_DESK_REGISTRATION`, `JOB_SEARCH_DESK_DEFINITION`, `JOB_SEARCH_DESK_DESK`, type `JobSearchDeskDeskTypes`, `JOB_SEARCH_DESK_TOOLS`, `JOB_SEARCH_DESK_CATALOGUE`; UI `JobSearchDeskDesk`, `fakeJobSearchDeskDesk`.
  Record kinds: `venture-career-fact` (CareerFactRecord, body `CareerFactBody`); `venture-career-listing` (CareerListingRecord, body `CareerListingBody`); `venture-career-thread` (CareerThreadRecord, body `CareerThreadBody`) in `playbooks/job-search-desk/records.ts`.

### 5J1

- Tools: `translate.check`, `translate.terms`, `subtitle.check` (in `delivery/harness/tools-translation-studio.ts (TRANSLATION_STUDIO_TOOLS)`).
- Playbook `translation-studio` ("Translation and subtitles"): `TRANSLATION_STUDIO_REGISTRATION`, `TRANSLATION_STUDIO_DEFINITION`, `TRANSLATION_STUDIO_DESK`, type `TranslationStudioDeskTypes`, `TRANSLATION_STUDIO_TOOLS`, `TRANSLATION_STUDIO_CATALOGUE`; UI `TranslationStudioDesk`, `fakeTranslationStudioDesk`.
  Record kinds: `venture-translation-job` (TranslationJobRecord, body `TranslationJobBody`); `venture-translation-segment` (TranslationSegmentRecord, body `TranslationSegmentBody`); `venture-glossary` (GlossaryRecord, body `GlossaryBody`) in `playbooks/translation-studio/records.ts`.

### 5J2

- Tools: `dub.align`, `dub.verify` (in `delivery/harness/tools-translation-studio.ts (TRANSLATION_STUDIO_TOOLS)`).

### 5K1

- Tools: `cfo.ratios`, `cfo.scenarios`, `collections.ladder`, `money.checkup` (in `delivery/harness/tools-bookkeeping-cfo.ts (BOOKKEEPING_CFO_TOOLS)`).
- Playbook `bookkeeping-cfo` ("Bookkeeping and CFO help"): `BOOKKEEPING_CFO_REGISTRATION`, `BOOKKEEPING_CFO_DEFINITION`, `BOOKKEEPING_CFO_DESK`, type `BookkeepingCfoDeskTypes`, `BOOKKEEPING_CFO_TOOLS`, `BOOKKEEPING_CFO_CATALOGUE`; UI `BookkeepingCfoDesk`, `fakeBookkeepingCfoDesk`.
  Record kinds: `venture-promise-to-pay` (PromiseToPayRecord, body `PromiseToPayBody`); `venture-collection-stage` (CollectionStageRecord, body `CollectionStageBody`); `venture-books-posting` (BooksPostingRecord, body `BooksPostingBody`) in `playbooks/bookkeeping-cfo/records.ts`.

### 5K2

- Tools: `books.write`, `vouchers.draft` (in `delivery/harness/tools-bookkeeping-cfo.ts (BOOKKEEPING_CFO_TOOLS)`).

### 5L

- Tools: `article.ledger`, `article.style` (in `delivery/harness/tools-podcast-to-article.ts (PODCAST_TO_ARTICLE_TOOLS)`).
- Playbook `podcast-to-article` ("Podcast to articles"): `PODCAST_TO_ARTICLE_REGISTRATION`, `PODCAST_TO_ARTICLE_DEFINITION`, `PODCAST_TO_ARTICLE_DESK`, type `PodcastToArticleDeskTypes`, `PODCAST_TO_ARTICLE_TOOLS`, `PODCAST_TO_ARTICLE_CATALOGUE`; UI `PodcastToArticleDesk`, `fakePodcastToArticleDesk`.
  Record kinds: `venture-article-ledger` (ArticleLedgerRecord, body `ArticleLedgerBody`) in `playbooks/podcast-to-article/records.ts`.

### 5M

- Tools: `leads.osm`, `leads.enrich`, `leads.dedupe`, `community.vote` (in `delivery/harness/tools-lead-generation.ts (LEAD_GENERATION_TOOLS)`).
- Playbook `lead-generation` ("Lead generation and appointment setting"): `LEAD_GENERATION_REGISTRATION`, `LEAD_GENERATION_DEFINITION`, `LEAD_GENERATION_DESK`, type `LeadGenerationDeskTypes`, `LEAD_GENERATION_TOOLS`, `LEAD_GENERATION_CATALOGUE`; UI `LeadGenerationDesk`, `fakeLeadGenerationDesk`.
  Record kinds: `venture-lead-source` (LeadSourceRecord, body `LeadSourceBody`) in `playbooks/lead-generation/records.ts`.

### 5N

- Tools: `newsletter.presend`, `newsletter.import`, `newsletter.slices`, `newsletter.stats` (in `delivery/harness/tools-newsletter-studio.ts (NEWSLETTER_STUDIO_TOOLS)`).
- Playbook `newsletter-studio` ("Newsletter service"): `NEWSLETTER_STUDIO_REGISTRATION`, `NEWSLETTER_STUDIO_DEFINITION`, `NEWSLETTER_STUDIO_DESK`, type `NewsletterStudioDeskTypes`, `NEWSLETTER_STUDIO_TOOLS`, `NEWSLETTER_STUDIO_CATALOGUE`; UI `NewsletterStudioDesk`, `fakeNewsletterStudioDesk`.
  Record kinds: `venture-newsletter-issue` (NewsletterIssueRecord, body `NewsletterIssueBody`); `venture-newsletter-contact` (NewsletterContactRecord, body `NewsletterContactBody`) in `playbooks/newsletter-studio/records.ts`.

### 5O

- Tools: `tender.questions`, `tender.ground` (in `delivery/harness/tools-tender-desk.ts (TENDER_DESK_TOOLS)`).
- Playbook `tender-desk` ("Tender and proposal desk"): `TENDER_DESK_REGISTRATION`, `TENDER_DESK_DEFINITION`, `TENDER_DESK_DESK`, type `TenderDeskDeskTypes`, `TENDER_DESK_TOOLS`, `TENDER_DESK_CATALOGUE`; UI `TenderDeskDesk`, `fakeTenderDeskDesk`.
  Record kinds: `venture-tender-question` (TenderQuestionRecord, body `TenderQuestionBody`) in `playbooks/tender-desk/records.ts`.

### 5P

- Tools: `site.requirements`, `site.uiReport`, `site.flow`, `site.preview` (in `delivery/harness/tools-website-studio.ts (WEBSITE_STUDIO_TOOLS)`).
- Playbook `website-studio` ("Website builder"): `WEBSITE_STUDIO_REGISTRATION`, `WEBSITE_STUDIO_DEFINITION`, `WEBSITE_STUDIO_DESK`, type `WebsiteStudioDeskTypes`, `WEBSITE_STUDIO_TOOLS`, `WEBSITE_STUDIO_CATALOGUE`; UI `WebsiteStudioDesk`, `fakeWebsiteStudioDesk`.
  Record kinds: `venture-site-requirement` (SiteRequirementRecord, body `SiteRequirementBody`); `venture-site-release` (SiteReleaseRecord, body `SiteReleaseBody`) in `playbooks/website-studio/records.ts`.

### 5Q

- Tools: `narration.markup`, `narration.verify` (in `delivery/harness/tools-narration-studio.ts (NARRATION_STUDIO_TOOLS)`).
- Playbook `narration-studio` ("Narration and audiobooks"): `NARRATION_STUDIO_REGISTRATION`, `NARRATION_STUDIO_DEFINITION`, `NARRATION_STUDIO_DESK`, type `NarrationStudioDeskTypes`, `NARRATION_STUDIO_TOOLS`, `NARRATION_STUDIO_CATALOGUE`; UI `NarrationStudioDesk`, `fakeNarrationStudioDesk`.
  Record kinds: `venture-narration-segment` (NarrationSegmentRecord, body `NarrationSegmentBody`) in `playbooks/narration-studio/records.ts`.

### 5R1

- Tools: `va.brief` (in `delivery/harness/tools-virtual-assistant.ts (VIRTUAL_ASSISTANT_TOOLS)`).
- Playbook `virtual-assistant` ("Virtual assistant service"): `VIRTUAL_ASSISTANT_REGISTRATION`, `VIRTUAL_ASSISTANT_DEFINITION`, `VIRTUAL_ASSISTANT_DESK`, type `VirtualAssistantDeskTypes`, `VIRTUAL_ASSISTANT_TOOLS`, `VIRTUAL_ASSISTANT_CATALOGUE`; UI `VirtualAssistantDesk`, `fakeVirtualAssistantDesk`.
  Record kinds: `venture-room-brief` (RoomBriefRecord, body `RoomBriefBody`) in `playbooks/virtual-assistant/records.ts`.

### 5R2

- Tools: `forms.map`, `forms.readBack` (in `delivery/harness/tools-data-entry-desk.ts (DATA_ENTRY_DESK_TOOLS)`).
- Playbook `data-entry-desk` ("Data entry desk"): `DATA_ENTRY_DESK_REGISTRATION`, `DATA_ENTRY_DESK_DEFINITION`, `DATA_ENTRY_DESK_DESK`, type `DataEntryDeskDeskTypes`, `DATA_ENTRY_DESK_TOOLS`, `DATA_ENTRY_DESK_CATALOGUE`; UI `DataEntryDeskDesk`, `fakeDataEntryDeskDesk`.
  Record kinds: `venture-entry-record` (EntryRecordRecord, body `EntryRecordBody`) in `playbooks/data-entry-desk/records.ts`.

### 5R3

- Tools: `apptest.logcat`, `demo.plan` (in `delivery/harness/tools-app-testing.ts (APP_TESTING_TOOLS)`).
- Playbook `app-testing` ("App testing and demo videos"): `APP_TESTING_REGISTRATION`, `APP_TESTING_DEFINITION`, `APP_TESTING_DESK`, type `AppTestingDeskTypes`, `APP_TESTING_TOOLS`, `APP_TESTING_CATALOGUE`; UI `AppTestingDesk`, `fakeAppTestingDesk`.
  Record kinds: `venture-test-finding` (TestFindingRecord, body `TestFindingBody`) in `playbooks/app-testing/records.ts`.

### 5R4

- Tools: `qa.verdict`, `security.scan` (in `delivery/harness/tools-dev-agency.ts (DEV_AGENCY_TOOLS)`).
- Playbook `dev-agency` ("Dev agency: maintenance, QA and security reviews"): `DEV_AGENCY_REGISTRATION`, `DEV_AGENCY_DEFINITION`, `DEV_AGENCY_DESK`, type `DevAgencyDeskTypes`, `DEV_AGENCY_TOOLS`, `DEV_AGENCY_CATALOGUE`; UI `DevAgencyDesk`, `fakeDevAgencyDesk`.
  Record kinds: `venture-dev-permission` (DevPermissionRecord, body `DevPermissionBody`) in `playbooks/dev-agency/records.ts`.

### 5R5

- Tools: `monitor.extract`, `triage.summary` (in `delivery/harness/tools-it-triage.ts (IT_TRIAGE_TOOLS)`; `delivery/harness/tools-monitored-data.ts (MONITORED_DATA_TOOLS)`).
- Playbook `monitored-data` ("Monitored data service"): `MONITORED_DATA_REGISTRATION`, `MONITORED_DATA_DEFINITION`, `MONITORED_DATA_DESK`, type `MonitoredDataDeskTypes`, `MONITORED_DATA_TOOLS`, `MONITORED_DATA_CATALOGUE`; UI `MonitoredDataDesk`, `fakeMonitoredDataDesk`.
  Record kinds: `venture-watch-source` (WatchSourceRecord, body `WatchSourceBody`) in `playbooks/monitored-data/records.ts`.
- Playbook `it-triage` ("IT triage desk"): `IT_TRIAGE_REGISTRATION`, `IT_TRIAGE_DEFINITION`, `IT_TRIAGE_DESK`, type `ItTriageDeskTypes`, `IT_TRIAGE_TOOLS`, `IT_TRIAGE_CATALOGUE`; UI `ItTriageDesk`, `fakeItTriageDesk`.

### 5R6

- Tools: `calls.cost`, `calls.log` (in `delivery/harness/tools-phone-receptionist.ts (PHONE_RECEPTIONIST_TOOLS)`).
- Playbook `phone-receptionist` ("AI phone receptionist"): `PHONE_RECEPTIONIST_REGISTRATION`, `PHONE_RECEPTIONIST_DEFINITION`, `PHONE_RECEPTIONIST_DESK`, type `PhoneReceptionistDeskTypes`, `PHONE_RECEPTIONIST_TOOLS`, `PHONE_RECEPTIONIST_CATALOGUE`; UI `PhoneReceptionistDesk`, `fakePhoneReceptionistDesk`.
  Record kinds: `venture-call-log` (CallLogRecord, body `CallLogBody`) in `playbooks/phone-receptionist/records.ts`.

## 2. Stub files, by package

Every new playbook id has these seven files (replace yours; the list files that import them are never edited after 5-0):

- `playbooks/<id>/registration.ts` (`<ID>_REGISTRATION: PlaybookRegistration | null = null`), `playbooks/<id>/definition.ts` (`<ID>_DEFINITION: PlaybookDefinition | null = null`), `playbooks/<id>/desk.ts` (`<Id>DeskTypes = Record<never, never>`, `<ID>_DESK = {}`), `playbooks/<id>/records.ts` (bodies; none for `it-triage`), `delivery/harness/tools-<id>.ts`, `build/catalogue/<id>.ts` (`<ID>_CATALOGUE = []`), `app/ui/src/places/work/desks/<Id>Desk.tsx` (renders `kit-desk.notBuilt`), `app/ui/src/engine/fake-<id>.ts` (`fake<Id>Desk(host)` returning `{ playbook, kinds: {} }`).
- `<ID>` is the id upper-cased with underscores (`SEO_VISIBILITY`), `<Id>` the id in PascalCase (`SeoVisibility`).

| Package | Playbook ids (folders) |
|---|---|
| 5E1 | `seo-visibility` |
| 5F1 | `online-seller` |
| 5G | `support-desk` |
| 5H | `recruiting-desk` |
| 5I | `job-search-desk` |
| 5J1 | `translation-studio` |
| 5K1 | `bookkeeping-cfo` |
| 5L | `podcast-to-article` |
| 5M | `lead-generation` |
| 5N | `newsletter-studio` |
| 5O | `tender-desk` |
| 5P | `website-studio` |
| 5Q | `narration-studio` |
| 5R1 | `virtual-assistant` |
| 5R2 | `data-entry-desk` |
| 5R3 | `app-testing` |
| 5R4 | `dev-agency` |
| 5R5 | `monitored-data`, `it-triage` |
| 5R6 | `phone-receptionist` |

Later packages of the same playbook (5E2, 5F2, 5F3, 5J2, 5K2) edit the files their first package made. Kit and flagship stubs:

- 5A1: `playbooks/kit/define.ts`, `playbooks/kit/records-chain.ts`, `app/ui/src/engine/fake-kit-chain.ts`; the seams it wires: `playbooks/registrations.ts`, `playbooks/definitions.ts`, `playbooks/desks.ts` (and the three `venture.desk.*` lines in `playbooks/index.ts`).
- 5A2: `playbooks/kit/records-sales.ts`, `app/ui/src/engine/fake-kit-sales.ts`. 5A3: `playbooks/kit/records-rules.ts`, `fake-kit-rules.ts`, its line in `delivery/harness/tools-kit.ts`. 5A4: `playbooks/kit/records-media.ts`, `fake-kit-media.ts`, its two lines in `tools-kit.ts`. 5A5: `playbooks/kit/records-report.ts`, `fake-kit-report.ts`. 5A6: `build/records-connect.ts`, `fake-kit-connect.ts`, its three lines in `tools-kit.ts`, its eight lines in `build/index.ts`.
- YouTube (5B1 to 5B3): `playbooks/youtube/records.ts`, `playbooks/youtube/desk.ts`, `YOUTUBE_W5_TOOLS` in `tools-youtube.ts`, `YoutubeDesk.tsx`, `fake-youtube.ts`. CA (5C1, 5C2): `playbooks/ca-firm/records.ts`, `playbooks/ca-firm/desk.ts`, `CA_W5_TOOLS` in `tools-ca.ts`, `CaFirmDesk.tsx`, `fake-ca-firm.ts`, its four lines in `playbooks/index.ts`. Social (5D1 to 5D3): `playbooks/social/records.ts`, `playbooks/social/desk.ts`, `SOCIAL_W5_TOOLS` in `tools-social.ts`, `SocialAgencyDesk.tsx`, `fake-social.ts`.

## 3. Pinned counts now

| What | Before | Now | Where pinned |
|---|---|---|---|
| `VENTURE_METHODS` | 268 | **302** (+34 `W5_METHODS`) | venture-contracts.test.ts, venture-method-hints.test.ts |
| Reached through the host after create (engine reach) | 256 | **290** | venture-engine.test.ts |
| Hosted (`ACTOR_ACTIONS` venture methods) | 256 | **290** | venture-method-hints.test.ts |
| Desktop IPC `METHODS` | 473 | **507** (302 venture) | desktop-ipc-methods.test.ts (tuple equality) |
| `APP_ONLY_METHODS` | 133 | **148** | not pinned |
| `VENTURE_RECORD_KINDS` | 106 | **161** (+55) | not pinned |
| `TOOL_NAMES` | 26 | **133** (+107) | TOOL_WORDS, TOOL_GROUPS, TOOL_DECLARATIONS tests iterate it |
| `CONNECTOR_CATALOGUE` | 66 | **66** = 66 + `PLAYBOOK_CATALOGUE_ENTRIES.length` (0) | venture-connectors.test.ts now compares with the list's own length |
| `VENTURE_EVENTS` / run event types | 50 / 14 | **53 / 17** | venture-views-events.test.ts (`slice(-17)`) |
| build package handlers | 33 | **41** | venture-connectors.test.ts, venture-build.test.ts |
| `PACKAGE_LOADERS` | 10 | **11** (`playbooks`) | venture-host.test.ts, venture-exports.test.ts, venture-cli-status.test.ts |

A package that adds a catalogue entry changes nothing in the count test. A package that adds a method, tool, kind or event beyond these raises the pins above with a comment naming itself.

## 4. Wave 4 and earlier pieces: all found

Checked by reading the code on 27 Oct. None is missing; the gaps are seams 5-0 left to the package named.

| Piece | Where |
|---|---|
| 4A departments | `playbooks/departments.ts` (`DEPARTMENTS`, `ROLE_DEPARTMENTS`, `SHARED_NAME`), `DepartmentId`/`DEPARTMENT_IDS` in contracts.ts; ids `sales`, `marketing`, `production`, `money`, `operations` |
| 4D network | `network/` (`import.ts`, `people.ts`, `strength.ts`, `search.ts`, `forget.ts`); methods `venture.network.*` |
| 4E pipeline, C7 follow-ups, C8 drafts and handoffs, C11 reply triage, C14 send governor | `network/pipeline.ts`, `pipeline-methods.ts`; `network/followups.ts` (`followupPlan`, `nextAllowedDay`); `network/outreach.ts`, `network/handoff.ts`; `network/inbound.ts` (`triageMail`, `writeInbound`, `inboundList`); `network/governor.ts` (`laneLimits`, `openRefusal`) |
| 4E3 read-only mailbox | `network/mailbox.ts`, `network/imap.ts`; `venture.mailbox.connect/disconnect/sync`, `venture.inbound.list/confirm`; records `venture-mailbox`, `venture-inbound` |
| 4F run controls, breaker | `delivery/run-controls.ts` (`venture.runs.stop/resume/roundGate/steer`, `venture.business.pause`), `delivery/harness/breaker.ts` |
| 4J8 `venture.playbooks.list` and the tile slot | `playbooks/ways.ts` (`WayData`, `WAY_CATEGORIES`, `WAY_SOURCE`; "Wave 5 adds its own playbooks' ways here"), `core/ways.ts`; contracts `WayView`, `WaysView`, `WayCategory` |
| K9 file-request link (4J7) | `build/file-requests.ts` (`shareRequestHandler`, `fileRequestEntry`), `venture.share.request`, record `venture-file-request`; share link states in `build/share-links.ts` |
| P12 export hygiene | `money/export.ts` (`csvCell` formula guard), `app/desktop/money-export.cjs` (`writeAtomic`: temp file, flush, rename; staged `stage`/`commit` not exported). There is no engine-side atomic file writer: **5A5** builds the smallest honest one (or exports the desktop's staged commit) for its DOCX, XLSX and report folders |
| J2 approval bound to file bytes | `delivery/file-manifest.ts` (`acceptManifest`, `checkManifest`, `refuseChangedFiles`), used in `build/posting.ts` and `build/share-links.ts` |
| CA8 `NEEDS_FACTS` | `playbooks/ca-firm/needs-facts.ts` (`requireFacts`, `needsFactsHandoff`, `factsQuestion`) |
| 4J12 step fields | `PlaybookStep.next`, `maxLoops`, `onExceeded`, `timeoutMs`, `optional`, `failover`, `gate`, `needs` (contracts.ts) |
| 4J13 routines | `agents/routines.ts`, `agents/routine-runner.ts`; records `venture-routine`, `venture-routine-run` |
| 4J17 business voice | `agents/voice.ts`, `venture.voice.get/set/learn`; record `venture-voice` |
| 4J18 ideas | `agents/ideas.ts` (`ideasListHandler`, `ideasStartHandler`, `ideasDismissHandler`); record `venture-idea` exists, so 5-0 added none |
| 4J4 money views | `money/aging.ts` (`agingPlan`, `moneyAging`), `money/flow.ts` (`flowPlan`), `money/cash.ts` (`cashPlan`) |
| 4J5 bills and reminders | `money/bills.ts` (`billsAdd`, `billsPay`, `billsList`, `billsStop`), `money/reminders.ts` (`invoiceRemind`) |
| 1D posting by draft id, held page actions | `build/posting.ts`, `build/page-guard.ts`, `build/browser.ts` |
| 1E untrusted screen, taint latch, effects | `policy/untrusted.ts`, `policy/taint.ts` (`LATCHED_EFFECTS`), `policy/effects.ts` |
| 1F net guard, secret screen | `core/net-guard.ts` (`guardedFetch`, `checkUrl`, `resolvePublic`), `core/secrets.ts` (`redactPayload`, `screenReadback`) |
| H8 forward-only stages | lead stages (contracts.ts `LeadRecord` note; the stage error in `VENTURE_ERRORS`) |
| 2B owner-browser posting, risk gate | `build/posting.ts`, `build/browser.ts`, `playbooks/social/risk-gate.ts`, `build/posting-limits.ts` |
| 2C1 `judgeAuto` | `delivery/judge-run.ts` (`judgeAutoOf`, `autoJudge`, `judgeAudience`) |
| 2E2 local transcription | `playbooks/youtube/transcribe.ts`, `venture.transcription.get/set`, `venture.files.transcribe` |
| 2F social calendar and report | `playbooks/social/calendar.ts`, `calendar-export.ts`, `report.ts` |
| 2G `evidence.record` | `delivery/harness/tools-evidence.ts` |
| 2H rules view, `usedBy` | `playbooks/rules-view.ts`, `playbooks/rules-current.ts`, `usedBy` in `playbooks/social/register.ts` |

Seams 5-0 left unwired (no behaviour in 5-0), with the package that wires them:

- **5A1:** route `venture.desk.list/get/act` to `deskHandler(playbook, kind)` (playbooks/desks.ts) in `playbooks/index.ts`; the fake already does it this way (unknown playbook, kind or op answers NOT_BUILT_YET; otherwise the package handler gets the whole request and checks fields, level, app channel and digest itself), so match it. Join `PLAYBOOK_REGISTRATIONS` into `PLAYBOOK_REGISTRY` (registry.ts); read `PLAYBOOK_DEFINITIONS`; map `StartTile` onto `WayData` for ways.ts; grant kit tools from definitions.
- **5A1 or the first business package to show a desk:** render `DESKS[playbook]` (app/ui/src/places/work/desks/index.ts) on Work. Nothing renders it now; wiring it before a flagship desk is real would show "Not built yet" on YouTube, CA and social businesses, so render only when the desk has something (decide in that package).
- **5A5:** the engine-side atomic writer (P12 row above).

## 5. Named differently from the plan, and why

- `books.post` is **`books.write`** (5K2, K15): `venture-connector-truth.test.ts` refuses any agent tool name ending in `.post`, `.publish` or `.upload` (no agent tool posts). Purpose "Wrote entries to the books, as you approved".
- Departments are wave 4's ids: `sales` (Sales and clients), `marketing`, `production`, `money`, `operations`, not `sales-and-clients`. `Department` is an alias of `DepartmentId`.
- A new package id **`playbooks`** owns every wave 5 method but 5A6's eight (the plan named no owner; 4-0 added packages the same way).
- `TOOL_PURPOSE` does **not** merge tool files' exports: `tool-purpose.ts` must stay a leaf (breaker.ts reads it at load), so 5-0 wrote each tool's line there; the same for `TOOL_WORDS`, `TOOL_GROUPS`, `TOOL_DECLARATIONS`.
- Record bodies and result types live in **`records-*.ts`** files: `playbooks/kit/records-{chain,sales,rules,media,report}.ts`, `build/records-connect.ts`, `playbooks/{youtube,ca-firm,social}/records.ts`, `playbooks/<id>/records.ts`. `StartTile` and `IntakeValue` are in `playbooks/kit/define.ts`, `SharePrice` in `records-sales.ts`; contracts.ts re-exports all three.
- UI desks are **`<Id>Desk.tsx`**: `SeoVisibilityDesk.tsx` (plan: SeoDesk.tsx), `OnlineSellerDesk.tsx` (SellerDesk.tsx), `BookkeepingCfoDesk.tsx` (CollectionsDesk.tsx), `TenderDeskDesk.tsx` (TenderDesk.tsx), `SupportDeskDesk.tsx`, `RecruitingDeskDesk.tsx`, `JobSearchDeskDesk.tsx`, `DataEntryDeskDesk.tsx` (the doubled word comes from the id). Keep the file and its export name; put your screens in other files and render them from it.
- Flagship desks and fakes added (plan named none for the CA firm): `YoutubeDesk.tsx`, `CaFirmDesk.tsx`, `SocialAgencyDesk.tsx`; `fake-youtube.ts`, `fake-ca-firm.ts`, `fake-social.ts`; desk id for social is `social-agency` (its registration id), folder `playbooks/social/`.
- A sixth kit fake, **`fake-kit-chain.ts`** (`FakeKitChainDesk`), answers 5A1's `venture.order.chain`; the plan listed five.
- `APP_ONLY_METHODS` also has `venture.report.share` (as `venture.share.create` is) and `venture.mail.import` (as `venture.network.import` is), beyond the plan's verb list: the safer choice.
- Payload fields the plan did not spell out, chosen to mirror existing methods: `venture.ca.confirmCitations {version, membershipNo}` (as `confirmRates`), `venture.ca.differential.add {name, inputs, outputs, capturedBy}`, `venture.ca.dataPack.export {clientId, fields}`, `venture.report.render {runId, formats?}`, `venture.report.share {reportId, from, to, channels?}`, `venture.mail.import {uploadId}` (an .eml or .mbox added with `venture.files.add`), `venture.webhook.set {kind, url | null}`, `venture.assets.list {orderId?, clientId?}`, `venture.assets.reuse {id, orderId}`, `venture.salesProposal.draft` `pilot?: boolean`. Change your own line if the build shows a better shape.
- Tool declarations and spec effects are 5-0's reading of the plan (for example `seo.diagnose` egress and untrusted web-page; `mail.read` private-read, untrusted mail; `speech.say` egress and money; `localapp.run` write and egress). Correct yours when you build the tool.
- `W5_METHOD_LEVELS` and `W5_FLAGS` (hints) were added on the wave 4 pattern; `venture.desk.act` is marked reaching outside until desks say otherwise.

## 6. Traps hit

- The shell heredoc gotcha is real: `'\n'` inside a Python string in a bash heredoc collapsed to a raw newline and broke the script. Write generator scripts with the Write tool, or use `chr(10)`.
- `node --check` (check.mjs) fails a file whose first statement is a bare `type` alias; every new .ts file opens with an import or an `export type`. All 201 new or changed .ts/.cjs files pass `node --check`.
- Tests that list package ids by hand needed `playbooks`: venture-host.test.ts, venture-exports.test.ts, venture-cli-status.test.ts (TypeScript caught them, not the runtime).
- The desktop `.d.cts` method tuple must equal the `.cjs` list exactly: regenerate it from the `.cjs` (`JSON.stringify(METHODS)`) rather than editing by hand.
- `venture-docs.test.ts` "docs/venture/architecture.md is the architecture document, copied as is" fails on this machine before and after 5-0: it compares with the local `.b2c-work/ARCHITECTURE-B2C.md`, which differs. 5-0 changed no docs.
- The fake engine: wave 5 desks sit in `this.w5` in fake.ts and are tried after the wave 4 desks in both lookups (`request` and `answerNow`).
- Line endings: the working copy is LF; git warns it will write CRLF on commit. Expected, not a change.

## Tests run last (all `fail 0`)

Engine (`node --test platform/tests/<file>`): venture-contracts 21, desktop-ipc-methods 6, venture-engine 7, venture-playbook-wiring 10, venture-playbook-wiring-delivery 12, venture-capabilities 15 (TOOL_WORDS), venture-connectors 8 (catalogue count), venture-method-hints 6, venture-host 15, venture-exports 2, venture-build 23, venture-views-events 8, venture-connector-truth 9, venture-effects 17, venture-context-hygiene 9 (TOOL_GROUPS), venture-taint 13, venture-cli-status 33, hosted-runtime plus desktop-main 39. A wider batch of 29 files (harness, delivery, chief, ideas, ways, youtube and CA tools, breaker, runs, mocks, write caps, policy, docs): 370 tests, the only failure left the docs one above.

UI (`npx vitest run --config app/ui/vitest.config.ts`): app/ui/tests/engine (ipc-allowlist 2 included), text, source-rules, hindi-counts, dev-page: 21 files, 146 tests. Typechecks: `npx tsc --noEmit -p tsconfig.json` and `-p app/ui/tsconfig.json` both clean.

## From 5A1 (the playbook kit), 27 Oct (built, NOT yet reviewed)

- A business's desk shows on Work only when its package sets `<Id>Desk.ready = true` in its own `<Id>Desk.tsx`. Every business package must set it.
- Tests run a whole business on a definition through `installTestPlaybooks` (`playbooks/kit/installed.ts`). Shared functions read the definitions when they are called, never at load.
- Flagship tile teams show today's real roles: YouTube shows Story editor, Producer and Packager; the CA firm shows Reconciler and Tax preparer; social shows Strategist, Writer and Creative. 5B, 5C and 5D swap in the plan's roles (Editor, Publisher, Bookkeeper, Billing) when those roles land.
- The model estimate marks on tiles use the existing `hoursEstimate` and `clientsPay.estimate` flags.
- The chain moves only on Accept (or the owner's edited version); a rejection never starts a run by itself. Practice files must be CSV, SRT or VTT.
- Not done in 5A1:
  - improve.ts still rehearses kit businesses on the service type's practice clients;
  - signal cases still come from the service type's messy client;
  - there is no UI order form for kit intake fields yet (the first kit business package builds it);
  - chain Today titles are English only;
  - the waiting-on-client path is tested at the hook level only.
- Added beyond 5-0:
  - error codes PLAYBOOK_DEFINITION_INVALID and INTAKE_FIELD_REQUIRED;
  - `OfferIntakeAsk.kit`, `DeliveryRunRecord.chainStage` and `OrderRecord.chainSince`;
  - `flagshipDraft` takes a stage;
  - judgeAudience reads the kit offer's audience;
  - words.json onboarding is lowered from 340 to 330.

## From 5A5 (client reports and documents), 27 Oct (built, NOT yet reviewed)

- Reports live in the vault inside the report record, with their files stored as base64. Engine code is under `playbooks/kit/report/` and `kit/ooxml/` (DOCX and XLSX on node:zlib, no new dependency), plus `kit/jsonld.ts` and `kit/atomic-write.ts`, the engine-side P12 writer (all files or none).
- PDF comes from Electron's printToPDF through a `PrintPort`: `VentureDeps.print` and `VentureHostOptions.print` (never on the hosted tier), `app/desktop/report-print.cjs`, `printRelay` in engine-harness.cjs, and `processPrintPort` in worker.ts. With no Devanagari font, it answers 'font-missing'.
- Share links:
  - they last 30 days;
  - only an accepted draft, or one ready to accept, can be shared, behind the CA sign-off gate;
  - REPORT_STALE comes back if the draft changed;
  - a channel the report doesn't cover is refused;
  - temporary businesses share no reports (trialRefusal).
- `writeReportFolder` has no caller yet; a desktop "save folder" needs a save channel. The report file's own fixed words are English only.
- 5A1 review (27 Oct) found a blocker: launch, runs, persona and improve called scenariosFor(type) without the playbook, so a kit business could never open the shadow stage. Other findings: definePlaybook accepted other playbooks' tools; coverage was always 'pass'; a stopped chain could never resume. A fix round is running.
- The kit intake order form (UI for `intake.fields`) is built by the first kit business package: 5M, lead generation, batch 2. Until then, offers with required intake fields refuse with INTAKE_FIELD_REQUIRED.

## From 5A3 (rules, manual paths, recipes, boundaries, ideas), 27 Oct (built, NOT yet reviewed)

- `playbooks/kit/rules.ts` re-exports `DatedRule` and adds validateRules, ruleFreshness, rulesFreshness(At), noteUnconfirmed and requireConfirmedRules (RULE_UNCONFIRMED). There are also `manual-path.ts` (withManualPaths, manualPathFor), `recipes.ts` (validateRecipes, recipeJudgeRules), `boundaries.ts` and `ideas.ts`.
- Its wiring into 5A1's files (definePlaybook, runKitChecks, the draft-checks kit branch, step guidance and the chain view) was handed to 5A1's fix round.
- A rule needs a CA or lawyer when `confirmedBy` is null; when the field is left out, it needs no one. Rules and ideas go stale on day 91.
- Ideas:
  - pipeline ideas reuse 4J18's record with an optional `pipeline` part (no venture-idea kind);
  - a move may skip forward, and Published and Dropped are final;
  - a grade is refused before day 7 (IDEA_GRADE_EARLY) and a second time (ALREADY_DECIDED);
  - the Today grade card is a notice with probe 'idea', opening #/work?state=ideas;
  - Ideas sit behind a Work chip.
- `?kit-sample` is a dev-only fake flag that shows recipes before any kit playbook lands.
- Pinned method count: 303 now against 302 pinned (another 5A package added a method). The integrator settles it.

## From 5A4 (brand kits, assets, media hygiene, voice consent, fingerprints, captions), 27 Oct (built, NOT yet reviewed)

- Engine: `playbooks/kit/{brand-kit,assets,media-intake,voice-consent,fingerprint,captions,transcribe-back,media-methods}.ts` and `delivery/harness/tools-kit-media.ts`.
- Media:
  - photos are cleaned when added and stored in a new `media` upload scope, so no agent table tool reads them;
  - recordings are kept byte for byte, as evidence;
  - `media.clean` writes `<name>.clean.<ext>` beside the order's clip, never over it.
- Accept refuses:
  - ASSET_NOT_MADE (a file asked for again but not yet made);
  - MEDIA_NOT_CLEAN (a held clip);
  - CONSENT_WITHDRAWN.
  Reuse stays within the same client. Revoking consent withdraws every version.
- Owed by later packages:
  - speech.say (5A6) and dubbing (5J2) must call `voiceForCall` and `requireVoiceConsent`;
  - 5A1's kit intake must call `requirePeopleConsent`;
  - 5B packages use `footageShare` and `disclosureLine`.
- There is no "approve keeping a held clip" method yet; a held clip stays blocked until it is cleaned.
- Integrator check: an earlier source-rules run flagged hex colours in `app/ui/src/engine/fake-kit-media.ts`. Verify before committing.

## From 5A2 (pilot, proposal, honest exit, GO card, share prices), 27 Oct (built, NOT yet reviewed)

- Engine: `money/share-price.ts` and `playbooks/kit/{pilot,exit,go-no-go,proposal,sales-methods}.ts`. Added beyond 5-0:
  - method `venture.goNoGo.list` (read); the pins are now 303 methods, 291 hosted and 291 reach;
  - record kind `venture-sales-proposal` (prefix salesprop);
  - `salesProposal.get` also takes {clientId} or {personId}.
- The proposal:
  - The owner's AI, under the chat consent (purpose `outreach-draft`), writes only "What we heard" and "Roadmap".
  - Code writes the Investment section from the price receipt, the Next step and the Open questions.
  - A number in the AI's words falls back to the template, and the line says why.
  - It's a Today row with Read and with Approve that needs the view. Approval offers copies for mail, WhatsApp and LinkedIn; nothing is sent.
- Honest exit:
  - An ask wholly outside the business makes no proposal and parks the person's cards at Not now.
  - Order intake refuses with OUTSIDE_SCOPE.
  - Partly outside stores `outOfScope` on the order.
- GO card:
  - inputs are upfrontMinor, monthlyMinor, months and limitMinor;
  - an unknown input gives HOLD;
  - a loss equal to the limit is GO.
- Share prices: a share and a fixed price never stand together. Prices has one "Charge a share" fold. Invoicing a share offer is left to later packages; `shareQuote` is ready for them.
- Known pre-existing fake gap: a price-change row the fake makes has no receipt, so the pending change on Prices fails the Ink figure rule.
- 5A1 DONE: re-review passed, 27 Oct. Two nits left for whoever touches the kit next:
  (a) A broken landed definition fails on first use, and also fails flagship calls, because each kit function's default parameter calls kitDefinitions(). Add a test that loads every landed definition, or call kitDefinitions() once when the worker starts.
  (b) definePlaybook's `today` is the UTC day, so a rule whose checkedOn is the India date refuses between 00:00 and 05:30 IST. Use localDayAt, or allow one day of slack.
  Also watch: people consent is checked at intake and again at Accept, but not when the chain's next stage starts. If consent can be revoked mid-chain, check it at stage start as well (5A4's area).

## From 5A6 (shared connectors), 27 Oct (built, NOT yet reviewed)

- Engine: `build/{fetch-policy,monitors,publish-tiers,webhook-handoff,local-apps,mail-in,speech-out}.ts` and `delivery/harness/tools-kit-connect.ts`. Added beyond 5-0:
  - kind `venture-local-app`;
  - KeeperJobId `monitors`;
  - `VentureDeps.localApps`;
  - SecretName `webhook:*` and `speech:*`;
  - journal operations `webhook-send` and `local-app-run`.
  The catalogue pin is now 72.
- Mail import takes {name, contentBase64}, not {uploadId}. The engine refuses files over 25 MB; the UI turns away files over 1.4 MB, because of the desktop's 2 MB request limit. `MAIL_DESKS` maps support-desk to `ticket`, recruiting-desk to `resume` and virtual-assistant to `inbox`: 5G, 5H and 5R1 use these names.
- Local apps:
  - only --version and --help are read-only;
  - every other command runs only after approval, journalled;
  - there is no app method yet to approve and run a command: `runApprovedLocalApp()` waits for 5B2 to wire it through its desk.
- Webhooks:
  - the address is kept only while the app is open;
  - a 4xx means not sent;
  - a 5xx or a timeout means the outcome is unknown, and it is never resent;
  - `sendToWebhook()` is ready.
- Speech out: every provider is planned (no key method; no price read on build day). `speechSay` checks 5A4's voice consent. Storing audio is left to 5Q and 5J2.
- The fetch policy list is marked `unconfirmed`. It is also wired into Before you write and knowledge links.
- Words: connections and connections/ai raised from 860 to 870 for the "More ways to connect" fold, so the founder confirms it.

## Batch 1 review findings (27 Oct). Fix rounds were sent for 5A2, 5A3, 5A4 and 5A5; check each one landed, then re-review.

- 5A2:
  - BLOCKER: the AI lines in a proposal could carry a price as words, as Devanagari digits or inside brackets.
  - Should-fix:
    - quoted client amounts dead-end the proposal;
    - the GO card UI computed paise;
    - Forget missed proposals for the forgotten person's client and on import removal;
    - a share left mirror.price set, and a regenerated plan dropped the share;
    - pilot terms couldn't be recorded.
- 5A3:
  - Should-fix:
    - tax and legal rules fail open without confirmedBy;
    - RULE_UNCONFIRMED threw after the model call (lost spend; gate at intake or run start instead);
    - the manual path wasn't shown on the order card;
    - standardWords missed recipes, boundaries and rule words.
- 5A4:
  - BLOCKERS:
    - people consent wasn't rechecked at stage start or Accept;
    - JPEG data after EOI (MPF, motion-photo trailers) kept its EXIF and GPS while reported as removed.
  - Should-fix:
    - ffmpeg copied data streams (GPMF GPS);
    - the held-clip line promised actions that don't exist, and a clean never superseded the held asset;
    - delivered files without an asset record weren't checked;
    - assetBlock didn't read the current consent state;
    - caption grouping broke the line rules;
    - a revoke kept the voice sample's bytes (DPDP).
- 5A5:
  - BLOCKER: no venture.report.list, so live 30-day links couldn't be managed after leaving the order.
  - Should-fix:
    - about 16 MB of base64 per render stored in the vault;
    - no atomic save channel on desktop;
    - the fake didn't refuse like the engine;
    - a title or heading with a number was unlabelled, and Hindi number words were missed;
    - the XLSX reader was open to memory exhaustion;
    - unworded codes;
    - links kept serving after the draft changed or sign-off was withdrawn.
- 5A6: review running at the time of writing.
- 5A6 review (27 Oct). A fix round was sent for six items:
  1. a delivered webhook item was misread as not-sent;
  2. Forget missed imported mail where the person is in To or Cc;
  3. a local app that never started was recorded as unknown, and .cmd/.bat came from PATHEXT;
  4. research and knowledge links skipped robots.txt;
  5. the monitor sweep could stall the tick;
  6. a consent voice id was sent as a provider voice name.
  Left as nits for later:
  - exact robots token match (fetch-policy.ts:154);
  - the fake applies the fetch policy to webhook URLs;
  - no webhook read view (Webhooks.tsx can't show one that is set after remount);
  - mail attachments stored as base64 in venture-inbound (store as files);
  - PDF and XLSX mail attachments kept unscreened "until read" (no reader yet).
  Note for 5B2: `localapp.run` is outside-write, which steps can't grant. 5B2 must add an app method that runs runApprovedLocalApp after the owner approves.
- 5A4 fix round landed (27 Oct). It is NOT re-reviewed: Codex re-reviews it.
  - People consent is rechecked at every run start and at Accept.
  - JPEGs are cut at the main EOI, so trailers are dropped and listed.
  - ffmpeg uses -map 0:v -map 0:a? -dn.
  - A clean supersedes the held clip.
  - Handed-over files get an `unknown` asset; tables are exempt as Chausar's own work.
  - assetBlock reads the live consent.
  - Captions close a cue when the words can't fit.
  - A revoke deletes the voice sample's bytes.
  The implementer admits most of the new tests were written after their fix; a reviewer should confirm each one fails without the fix.
- 5A6 fix round landed (27 Oct). It is NOT re-reviewed; each fix has a test that failed first.
  - Webhook: an error after the send is `unknown` and never resent.
  - Forget erases imported mail threads that involve the person (importedMailOf).
  - Local apps: LOCAL_APP_NOT_FOUND for a run that never started; locateApp skips .bat, .cmd and relative PATH folders.
  - Research and knowledge links read robots.txt (ROBOTS_REFUSED).
  - Monitors: at most 5 pages per tick, with no new look after 45 s.
  - A consent voice is refused with VOICE_NOT_ALLOWED until a cloning call exists.
- 5A3 fix round landed (27 Oct). It is NOT re-reviewed.
  - `DatedRule.needs: 'ca' | 'lawyer' | null` is now REQUIRED on every rule; every later package must set it.
  - delivery/runs.ts calls requireConfirmedRules before any preview (stage ids plus checkIds).
  - The order focus has a "Done by hand for now" tile (work/ManualPaths.tsx).
  - standardWords covers rules, recipes and boundaries.
  - MANUAL_PATH_MISSING is now reachable.
  - Forget scrubs emails and phones from ideas.
- 5A2 fix round landed (27 Oct). It is NOT re-reviewed.
  - The AI's proposal lines are checked for digits in any script and for number and money words in English and Hindi.
  - Quoted client amounts are exempt only inside the quote.
  - GO card inputs (upfront, monthly, months, limit) are sent as rupee text and parsed by ownerPrice in the engine.
  - Forget deletes proposals for the person's client and ones that mention them, also on import undo.
  - A share clears the mirror price, and carryOver keeps shares.
  - The draft takes `pilot: true | SalesPilotTerms` (PILOT_WINDOW).
  - SharePrice carries the engine's `words`.
- 5A5 fix round landed (27 Oct). It is NOT re-reviewed.
  - New method `venture.report.list {orderId? | runId?}`; pins are 304 methods, 292 hosted, 292 reach and 509 IPC.
  - The vault keeps blocks and file digests only, capped at 200,000 characters per report.
  - Desktop save goes through the `report:save` channel (report-save.cjs), using W4's stage and commit writer, now exported from money-export.cjs.
  - The fake refuses like the engine.
  - Numbers in titles are labelled, with hindiNumberWords.
  - Workbook reads are capped (OOXML_UNREADABLE).
  - A served page re-checks sharable.
  - A chat app's GET link preview still counts as a view; the share.ts header says so.

## 5M implementation and review closure

- 5M author checkpoint (leads_review_seller): 21 focused engine tests and 10 UI tests pass after independent review repairs. Outreach checks cover title, headings, body and questions, with clause-local denials. The actual delivery ToolEnv resolves the accepted semantic cold-email offer, produces the 50-prospect three-touch plan, and refuses changes to the owner's chosen count before network I/O. Community inputs validate exact nested records and real dates; the tool reads only a same-business owner-confirmed source, never a model's permission boolean. The owner panel accepts plain fields and pasted posts, displays exact quoted scores and coverage, reopens saved reports, and physically forgets evidence. Network Forget also removes evidence naming that person. Fake tests cover referral dedupe, India-day quote dates, per-account paid-request identity and community erasure. New behavior was tested RED before implementation. Production professional confirmations remain null; all positive delivery tests restore temporary trusted fixture confirmation. No real HTTP, spend or messages occurred. Independent 5M re-review is pending; the author does not certify it.
- Follow-up to the 5M checkpoint: independent reviewer seller_review_leads reports Stage 1 spec PASS and Stage 2 quality PASS, with fresh 22 engine and 11 UI tests. Final repairs add synchronous fake Forget using the existing desk hook, including evidence saved before a person was imported; source insertion order matches the real desk before due follow-ups; the community tool can discover up to 20 same-business owner-confirmed sources before selecting one. Three source-transform mutants were killed. Thirteen used M refusal codes were registered in VENTURE_ERRORS. Final affected M tests plus intake-word coverage pass 15/15. Visual gates remain unclaimed.
- Shared kit intake now renders all field kinds, sends owner rupee text to engine arithmetic and attaches bounded files atomically to the new order. Its translated display dictionary preserves raw submitted option values. This first package includes the lead schema and the generic choice-control fixture words; subsequent package commits add their schemas. The existing Hindi regression and field-coverage check remain included.

## 5E1 implementation and review closure

- Registers seo-visibility with visibility-check, quarterly-remeasure and website-check offers, owner-set prices, report delivery, diagnosis, separate search/training crawler access, source-bound frozen answer panels, website report approval and bounded monitoring. Count receipts, missing-evidence denominators, honest installed-checker/manual paths and English/Hindi owner screens are included. Monthly article, publishing, strategy and local SEO work remain for 5E2.
- Prior independent spec and quality PASS was recorded in the takeover checkpoint. The isolated HEAD plus 5E1 reconstruction passes both typechecks and 26 focused engine tests. The commit candidate preserves only its five baseline cases, E1 metadata and shared intake words. This reconstruction is not a fresh whole-package review, visual PASS or batch gate.
