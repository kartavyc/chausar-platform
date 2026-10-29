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

## 5K1 implementation and review closure

- Registers monthly books, collections, CFO packs, decision memos and spending-only checkups. Client debtor ledgers remain isolated from the service business; promises and owner-edited ladders use code, reminders stay with the client, all calculated money has receipts. Dynamic question workflows are pinned per run without changing the business playbook. English/Hindi collections screens and exact fake onboarding are included. Accounting posting and setup remain for 5K2.
- Earlier independent spec and quality PASS is recorded in the takeover checkpoint. The isolated commit reconstruction retains the five K1 source-executed baseline cases and their adversarial source tests. This staging validation does not claim a new whole-package, visual or batch acceptance.

## 5F1 implementation and review closure

- Registers the seller foundation with five own-shop and client audit offers. Source-backed unit economics, ads, listing/India checks and settlement differences use code receipts, explicit missing inputs and pending professional confirmation. Own-shop orders reuse one self client and cannot create customer invoices or client share links. English/Hindi owner audit screens and real/fake intake are included. Staged operations, photos and additional offers remain for 5F2; marketplace connectors remain for 5F3.
- Earlier independent spec and quality PASS is recorded in the takeover checkpoint. The isolated commit candidate retains the five F1 baseline cases and actual delivery/owner/fake regressions. Reconstruction validation is not a fresh package review, visual PASS or complete batch gate.

## 5G implementation and review closure

- Support desk includes shop-scoped source matching, screened mail routing, exact owner reply approval and unsent mail handoff, business-hour targets, takeover guards, optional rating links and Forget cleanup. Both languages and real/fake public desk paths are included. No email is sent automatically; professional rule confirmations remain null.
- Independent package review closure remains in the takeover checkpoint. This isolated reconstruction validates the support package at the batch-2 commit boundary; it is not a new visual PASS or broad batch gate.

## 5B1 implementation and review closure

- Measured word editing, cleanup, captions, script coverage, dictionary corrections and pinned local transcription extend the YouTube playbook with the Cutter step. Edit transactions retain exact source bindings, refusal reasons, undo and the second ask for large removals. English/Hindi edit desk and fake parity are included; later board/style/finishing/export features remain for 5B2.
- Independent spec and quality PASS and killed mutants are recorded in NOTES-5B1. This isolated commit reconstruction is not a fresh screenshot PASS or the full batch gate.

## 5C1 implementation and review closure

Seven CA offers, dated citations and ITR choice, advance tax, source-backed questions and stored sign-off are recorded in NOTES-5C1 with independent spec and quality PASS. This isolated commit includes their live/fake owner paths; C2 working desks, health checks and data packs remain separate. Candidate verification does not claim a fresh visual pass or full batch gates.


### 5D1 isolated commit checkpoint

Social writing, client review, revisions and source-bound scheduling are included. LinkedIn remains copy-and-open. Details and the readiness regression are in NOTES-5D1.md. Later social production is excluded.

## 5B2 implementation and review closure

- YouTube now measures owned references and finishing, reviews each output, records approved clip pages and b-roll plans, round-trips editor instructions, and saves approved project folders through a desktop handle. No finished render or automated posting is claimed.
- Separate spec and quality PASS, actual RED regressions, killed network mutant and screenshot evidence are recorded in NOTES-5B2. Isolated staging verification is not the full batch gate.

## 5C2 implementation and review closure

- CA working desk adds source-backed tax scenarios, document entry, health findings, named-CA decisions and exact masked return-pack export. Browser calculations reuse engine code; receipts remain code-derived. External filing and absent departmental calibration captures remain planned/manual.
- Independent spec and quality PASS and actual RED fixes are recorded in NOTES-5C2. Hindi focused walk passed after the shared selector correction. This isolated package reconstruction does not replace full batch gates.


### 5D2 isolated commit checkpoint

Adds the reviewed local social production and inbox package, including exact owner approvals and sticky opt-out/Forget repairs. Independent spec/quality PASS and limitations are in NOTES-5D2.md. D3 stays stubbed; provider and professional review stay planned/manual.

## 5E2 implementation and review closure

- SEO monthly work, source-grounded articles, exact WordPress draft writes, existing Cloudflare KV override reviews and source-bound strategy measurement are integrated. Provider access and pre-existing client configuration remain explicit.
- Independent spec and quality PASS, actual RED repairs and phone evidence are recorded in NOTES-5E2.md. Package checks do not replace stable batch gates.

## 5F2 isolated package closure

- Seller operations now provide exact source-bound staging, receipts, stock movement, research reports, catalogue sheets, multi-store reporting, case follow-ups and approved manual photo handoffs. Provider writes remain planned or owner handoffs.
- Independent spec/quality PASS and original failing regressions are in NOTES-5F2.md. Isolated checks do not replace stable batch gates.


### 5H isolated commit checkpoint

Adds the independently reviewed recruiting desk, professional evidence screening, exact approved manual contact/interview handoffs, role ledger/report, public job-board reads and source-linked Forget/expiry. Review evidence and remaining legal/manual boundaries are in NOTES-5H.md. Later article, tender and website hooks are excluded.


## Earlier package integration corrections

The isolated recruiting guide check exposed missing setup guides for the already committed M/E2 connectors: Overpass, Nominatim, own-site, Happenstance, WordPress drafts and Cloudflare KV. Their real and rehearsal guides now match, with EN/HI text. The Start gallery snapshot is recomputed from this exact committed engine so every implemented service and category count is visible. No future playbook data is copied.

## 5J1 isolated package closure

- Source-bound translation and subtitle review, glossary versions, exact AI previews and client review tokens are integrated. External client sharing waits for named rights review; private remote models remain refused. J2 stays stubbed.
- Independent spec/quality PASS and final dispatch-race repairs are recorded in NOTES-5J1.md. Includes the reviewed common synchronous ModelPort guard and its four no-send tests.

## 5K2 isolated package closure

- Client bookkeeping cycles, source-bound vouchers, monthly seller reconciliation and exact approved Zoho draft, settlement and setup writes are integrated. Issue asks separately. Tally writes remain planned with manual entry.
- Independent spec and quality PASS and provider limits are recorded in NOTES-5K2-REVIEW.md and its bounded review notes. No live-account qualification is claimed.

## 5L isolated package closure

- Source-bound podcast article preparation, approved direction, staged drafting and explicit manual publishing handoff are integrated. Local transcription needs owner-installed tools; legal confirmation stays pending.
- Independent spec and quality PASS, source mutation proofs, Forget and measured phone evidence are recorded in NOTES-5L.md.

## 5N isolated package closure

- Source-bound newsletter drafting, consent/suppression checks, manual send exports, measured slices and code receipts are integrated. No sends are automated and named legal confirmation stays pending.
- Independent spec/quality PASS, privacy and final dispatch-race evidence are recorded in NOTES-5N.md.

## 5O isolated package closure

- Tender question extraction, source-grounded responses, exact owner approvals, monetary evidence receipts and local export packs are integrated. Government submission remains a manual owner handoff.
- Independent spec/quality PASS, source races, privacy, Today and phone evidence are recorded in NOTES-5O.md and its UI/domain notes.


## Later package guide integration

The isolated tender gate exposed omitted setup guides for already committed podcast and newsletter connectors. The native guides, exact rehearsal guide rows and EN/HI text for those four connectors plus tender now ship together. The primary implementation already held these reviewed paths; extraction had missed their shared lines. No new provider capability is claimed.


### 5P isolated commit checkpoint

Adds the independently reviewed website service and Build deepening. Exact scope, RED/GREEN evidence, source distinction, manual asset uploads, planned legal form boundary and isolated preview CSP changes are recorded in NOTES-5P.md and NOTES-5P-MANIFEST.md. No provider measurement or production release is fabricated.


### 5Q isolated commit checkpoint

Narration, audiobook and explainer service: exact source-bound markup, owner-approved stock speech, measured audio, listening, mastering and manual distribution. Independent spec and quality PASS, actual-byte evidence, source/privacy/approval repairs and honest provider limits are recorded in NOTES-5Q.md. No live provider or distributor acceptance is claimed.


## Completed batch-two gate integration

All six fixed-inventory engine shards pass sequentially:1110,1106,1102,1190,1116,3 tests. The dedicated final shard is the complete independent activation test. UI2546/2546, both types and syntax1740 pass. Inventory SHA256:e43d2b3039ee56ce7e15a4441af6fccfb1fbfc1ceed51e075c1f6e783daa351b. Initial timeout/failure reports remain preserved. The remaining reviewed fixes now land: bounded code-owned offer identities with unchanged model cap3, exact current Story editor/Cutter expectations, real social chain setup, current connector mode assertions and required native-derived guide fixtures. No live provider qualification is claimed.


## Batch-three UI gate follow-up

The fixed-tree full UI run recorded 2696 passing, nine failing and two setup-blocked tests. Seven stale assertions in the gallery and Business were independently reviewed, repaired and passed all 66 focused tests. The unchanged dev-page and Today tests passed all 12 after the snapshot dependency link and an isolated retry, including both previously blocked tests. The onboarding word count remains 821 against 330 and is not silently raised; final measurement and every proposed rise belong in the founder PR. Both types and syntax2333 passed before this test-only follow-up. Both types and syntax2333 also passed on the reviewed follow-up snapshot before commit. Engine shards continue on the immutable committed snapshot; no final batch-three gate claim is made here.


### 5B3 isolated candidate checkpoint

Adds exact owner-selected YouTube services, source research and comment/script workflows with receipts, explicit public-read approvals and local quota attempts. Private analytics and publishing remain planned/manual. See NOTES-5B3.md for scope, reviewed fixes, evidence and precise limitations. Independent root Stage 1 spec PASS and Stage 2 quality PASS after refreshed-source and threshold repairs. Isolated validation and exact patch checks remain required before committing. Native project-folder regression now uses the default C: temporary folder after a genuine isolated ENOENT failure; all safety assertions remain intact.


### 5D3 isolated commit checkpoint

Source-bound influencer campaigns and exact approved open-network plain-text publishing. Independent spec and quality PASS, privacy/approval review repairs and actual phone captures are recorded in NOTES-5D3.md. External legal review remains explicit where required. No creator agreement, real publication or provider acceptance is inferred.


### 5F3 isolated commit checkpoint

Seller connectors and store assistant: exact-approved Shopify reads and writes with acknowledgement and read-back, owner-supplied marketplace template handoffs, and session-only catalogue-grounded buyer requests with per-question owner approval. Independent spec and quality PASS, genuine RED/GREEN and limitations are recorded in NOTES-5F3.md. Live merchant qualification is absent and buyer use waits for named lawyer confirmation.


### 5I isolated commit checkpoint

The job-search and career desk keeps approved fact qualifiers, complete listing revisions, four-verdict shortlists, coaching and six reachable service offers. Exact owner-approved DOCX/HTML-or-PDF packs bind current sources and actual client review links before delivery or export. Native and owner reviews, test-first evidence, manual platform paths, privacy erasure, and the generic Work parity repair are in NOTES-5I.md and NOTES-5I-UI.md. Live client work waits for a named lawyer privacy review.


### 5J2 isolated commit checkpoint

Consented stock-voice dubbing, actual audio checks and desktop local captions with saving off. Full independent spec and quality PASS, including exact microphone permissions, actual privacy.forgotten lifecycle repair and benign edit continuity. Isolated both types and syntax pass; inherited I fixture ordering was repaired without changing nonowned values, and native/UI reruns pass. An isolated removed Forget hook fails its public regression. Evidence and honest provider/legal limits are recorded in NOTES-5J2.md. Root owns the whole-wave gates.


### 5R1 isolated commit checkpoint

Virtual assistant orders have exact approved client-room briefs, source-only owner-approved morning and weekly routines, receipt-backed manual purchase handoffs and refusal of payment fields. Current brief revisions bind native and rehearsal delivery, with real Forget clearing saved and unsaved private copies. Independent native and owner reviews, test-first evidence, screenshots and capability limits are in NOTES-5R1.md and NOTES-5R1-UI.md. No live purchase, client hosting or model-provider qualification is claimed.


### 5R2 isolated commit checkpoint

Data-entry work has exact source rows, owner-only native browser mapping and submit approvals, source-bound agent proposals and code-rendered reports, actual saved-response comparison and acknowledged sign-in erasure. The desktop remains planned pending lawyer confirmation; native HTML forms only, with a manual path for dynamic or unsupported sites. Independent whole-package specification and quality reviews passed; isolated validation is recorded separately. Exact manifest, tests, screenshots and limitations are in NOTES-5R2.md.


### Landed kit browser rules integration

Fourteen previously landed kits returned no rule register through browser rehearsal. Fourteen genuine failing routing tests reproduced that gap. Native-generated data now preserves exact sources, review holds, recipes and boundaries, with fresh and stale parity checked at every recheck edge. Independent specification then quality review passed. Public fake routing also now uses the India business day and exact empty-payload validation, both caught by behavioral regressions. The generator discovers newly landed kits; this isolated commit includes only the fourteen native definitions already committed. R3 adds its own generated data when it lands. Evidence is under results/w5-integration-rules-* and rules-integration-frozen.


### 5R3 app testing and demos

The completed source-bound emulator testing and private demo desk, exact provider approvals, client cleanup, real reviewed exports and browser preparation paths are recorded in NOTES-5R3.md. It preserves explicit local-tool and named-lawyer gates. Separate full spec and quality review evidence and limits are in that note. Final isolated gates follow the frozen candidate bytes.


### 5R4 isolated final-base checkpoint

Developer agency source, owner CLI, exact metadata audit, reviewed reports and journalled manual command handoff passed independent specification and quality reviews. Metadata reclosure passed separately. Scope, evidence, limitations and ownership are in NOTES-5R4.md. The isolated candidate is based on committed R3 cf908956. Inherited accepted-offer declarations are preserved byte-for-byte; later accepted-plan and order-receipt integration changes are excluded. Frozen-byte checks are recorded in the candidate gate report.


### 5R5: monitored data and IT triage

Implemented the two registered playbooks with accepted-order source desks, measured static selectors, BigInt price receipts, approved recurring reads, Today changes, literal CSV/XLSX export, exact screened channel excerpts and an unsent approved handoff. Work and browser rehearsal bind current evidence and invalidate stale or forgotten copies. Slack and Teams remain planned pending qualification; no production Slack adapter is wired. The internal fixture-tested exact-post controller checks professional confirmation again at release.

Independent Stage 1 SPEC PASS and Stage 2 QUALITY PASS were closed by root, including a separate final professional-gate recheck10/10. Author focused native43/43 before the late gate, affected gate14/14, and owner/fake/text/source51/51 passed. Six actual owner captures fit phone/desktop widths with axe0; root inspected phone captures. Full boundaries, genuine RED evidence, limitations and later isolated validation are recorded in NOTES-5R5.md. No whole-wave gate or live provider qualification is claimed here.


### 5R6 isolated final-base checkpoint

Phone receptionist source, exact script, budgets, imported evidence, code receipts, manual human outcomes and owner/fake controls passed independent specification and quality review. Live calls remain planned pending provider and named legal qualification. See NOTES-5R6.md. The isolated candidate is based on committed R5 f7861b4d. It preserves inherited accepted-offer accessors verbatim and excludes the later accepted-plan, order-receipt, country and connector fixture integration changes. The phone connector JSON is pinned to the independently approved preflight bytes. Frozen-byte checks are recorded in the candidate gate report.

## 7. Batch 1 re-review checkpoint (Codex, 27 Oct 2026)

Separate reviewers re-read 5A2 to 5A6 against the original findings, then removed each original fix in memory with Node registerHooks. This leaves the shared checkout unchanged while demonstrating regression failures. Further findings were returned for test-first fixes and independent re-review.

- 5A1: both nits closed. definePlaybook defaults to the India calendar day with localDayAt. The midnight regression failed on RULE_INVALID before the fix, then passed. A test now loads every landed definition; it does not re-define frozen definitions because recipe judge rules are added on definition. Independent spec and quality review passed.
- 5A3: independent spec and quality review passed without more source changes. Focused engine 40/40 and UI 11/11 passed. Six in-memory mutants were killed: required rule confirmation fields, pre-preview rule gate, shown-word coverage, missing manual paths, Forget contact scrubbing, and the order-card manual-path component.
- 5A4: independent spec and quality re-review passed after a further fix round. JPEG parsing now strips metadata between scans as well as before the first scan and after the main EOI. Scan bytes, colour data and minimal Orientation are retained. Deleted consent recordings cannot be reused to create a new consent; a new upload is required. The fake checks live consent expiry and missing records. The delegated approval flow test now proves outputs become unknown assets and Accept holds them. Focused engine 49/49, delegated flow 1/1, fake parity 2/2 and media place UI 5/5 passed. Four further source mutants were killed, including the previously surviving delegated-output integration mutant.

Execution notes:

- Engine tests leave TMP and TEMP unchanged on C:.
- UI workers intermittently failed on sandbox C-temp cache paths with ENOENT. Giving UI-only commands a temp directory under results/ made the same focused tests pass. No engine temp setting was changed.
- Local git add failed: this session has read-only access to .git, so .git/index.lock cannot be created. No local commit has been made. The root package-lock.json remains untracked and excluded.
- The connected GitHub API is authenticated as kartavyc, but its create_commit wrapper has no author parameter. It cannot guarantee the founder's required author identity, so it has not been used to publish substitute commits.

### 5A6 re-review passed

- Original six fixes were checked independently with failing in-memory mutants. Further test-first fixes move monitor rupee parsing into the engine (`belowRupees`, with explicit legacy `belowMinor` compatibility and a refusal if both are present); check robots at every redirect in research, knowledge and monitors; use native-platform local-app fixtures; and prove To-only and Cc-only Forget behavior without matching words in the body.
- The exact robots product-token match and fake webhook fetch-policy nits are also closed. Webhooks still use their existing net guard; a page-reading terms policy is not applied to webhook delivery.
- Independent spec and quality review: PASS/PASS. Focused engine 44/44, connections UI 6/6 and fake parity 2/2 passed. Eighteen source mutants were killed, including the previously surviving Cc-parser mutant.
- Permitted nits remain: no webhook read view after remount; imported attachments still use base64 storage; PDF/XLSX attachment screening waits for readers.

### 5A2 re-review passed

- The original findings were independently re-reviewed, with seven original engine mutants killed. Further fake-engine parity fixes were made test-first: exact pilot terms validation (keys, types, dates, hours and limits), receipt totals with quantity and sample GST while keeping the unit figure unchanged, and proposal deletion after Forget or confirmed import Undo. Internal privacyFacts hooks carry exact person/client links to the fake sales desk; no user-facing API was added.
- Independent spec and quality review: PASS/PASS. Final nearby fake and sales-place suite 50/50, including 23 new sales regressions. Source, text and sales-place checks 49/49. Both typechecks passed.
- The existing non-sample GST limitation of the fake quote remains disclosed; this fix does not claim to implement a general tax engine in the UI.

### 5A5 re-review passed

- Further findings were fixed test-first: render the current owner edit instead of superseded model words; screen secrets in every block; keep the model-estimate label in the public title; enforce workbook-wide sheet, row and cell bounds before allocating; and mirror English/Hindi number classification and DOCX labels in the fake.
- Owner-edited reports are rendered as prose, with model-estimate labels where required. Old structured metrics are omitted because their binding to changed owner text cannot be proved. This is the conservative ambiguity decision for the PR.
- New regressions cover the report character cap, withdrawn CA sign-off on a live report link, and atomic desktop save's EXPORT_NOT_SAVED wording in Hindi. The new pure browser helper is `app/ui/src/engine/fake-report-numbers.ts`; it does not import server or filesystem code into the app.
- A real integration blocker was found in CA sign-off: `papersDigest` stopped reading editedText once a draft became accepted, while clientDraft still showed it. An accepted unsigned edit could therefore be shared under the original signature, and a legitimate signature on an edit was lost on Accept. The one-line `editOf` predicate in `playbooks/ca-firm/signoff-gate.ts` now covers edited and accepted. Both report-share regressions failed before that fix, passed after it, and independent revert mutants were killed. This is a documented small shared-file exception to 5A5's ownership.
- Independent spec and quality review: PASS/PASS. Focused non-filesystem A5 engine 36/36, new CA report regressions 2/2, existing CA gates/sign-off 14/14, fake and report-place UI 8/8 plus Hindi save 1/1 passed. Both typechecks passed before the final boolean-only CA fix.
- Filesystem-writing tests still encounter sandbox EPERM with default C temp unchanged. They have not been weakened or marked passing. Full batch gate results follow below when complete.

## 8. Resume integration checkpoint (27 Oct 2026, work still in progress)

- Read all handoff inputs again on b2c/ink-v2-w5. Preserved every batch 1 edit and the untracked root package-lock.json; no git state was changed.
- Batch 1's last integration changes passed independent spec and quality review. Network/business UI 76/76 with UI-only repo temp. Removing the empty-filter debounce guard in a Vite transform killed the new pagination regression without editing source. Logs: results/batch1-final-review/.
- Both typechecks and syntax/JSON validation (1,484 files) passed before batch 2 implementation started. The default-temp UI suite failed collection for 142 suites due to sandbox cache ENOENT (14 tests passed, not a green suite). A full local-temp retry was interrupted after making no test progress; focused local-temp suites run normally.
- A direct default C-temp filesystem probe created both plain and hidden files successfully but rename returned EPERM. This confirms the restriction behind vault/report atomic-write failures. Engine TMP and TEMP remain unchanged.
- The first two resumed shards saved 735/987 and 868/1,109 passes. They also saw transient invalid definitions as batch 2 files were being implemented, so these are diagnostic runs, not batch qualification. Their full failures remain in results/w5-resume-shard-{1,2}.json. The remaining run was interrupted; rerun all six after the batch is stable.
- Batch 2 implementers own 5M, 5E1, 5K1, 5F1, 5G and 5B1. 5C1 and 5D1 have not started. None is independently reviewed yet. 5M's shared kit intake form is being implemented by the integrator; it is not yet reviewed.
- Shared intake seams missed by 5-0: EngineMethods order.create now types fields, and the raw moneyRupees map is parsed in the engine to the existing whole-paise fields representation. This small kit/intake.ts exception avoids money arithmetic in the UI. Required fields and explicit no answers are kept in New order. Live consent is selected by speaker name. Current focused form/fake/onboarding UI 6/6 and engine money plus kit wiring 20/20 pass.
- A stale kit wiring test named the now-built SEO panel as an unbuilt operation. It now uses an unknown kind, keeping the refusal assertion meaningful as businesses land.
- Shared fake onboarding now adapts browser-safe metadata from each landed kit instead of giving it two generic offers. The support public-API regression failed before this fix and passed after it. Gallery fixtures will be regenerated from the engine after definitions stabilize, preserving the existing equality pin and Hindi.

## 9. Takeover checkpoint (27 Oct 2026, work remains in progress)

- The previous workers were gone; six new agents resumed package ownership and independent cross-reviews in the same checkout. No git mutation or commit has been made. The root lockfile remains excluded.
- Pairings: bookkeeping_finish and support_finish review each other; seller_review_leads and leads_review_seller review each other (seller author also reviews the root's shared intake); youtube_review_seo and seo_review_youtube review each other. No batch 2 package has PASS/PASS yet.
- Fresh UI typecheck passed before further review fixes. Engine typecheck found K1 judgeAudience input, support row/draft typing and one leadgen test inference error; authors have fixed those. A stable final typecheck is still required.
- Reviews now require actual runtime paths, not helpers alone. Open repairs include SEO bounded monitoring wired through owner-approved configuration and tick; support signed mail routing, scoped shop customers/orders and stopping waiting model previews; bookkeeping client debtor isolation, edited collection ladder, 13-week forecasts, monthly-books and deterministic source validation; seller own-shop internal orders/no invoice/no client share, owner declarations, evidenced break-even, audit details and rendered-text safety checks; YouTube source fingerprint binding, bounded cleanup intersections and nearby improvement integration regressions.
- Latest focused evidence is provisional: M 16 engine and 5 UI; SEO 18 engine and 6 UI before monitoring additions; G 32 engine and 5 UI before further review repairs; K1 26 engine and 5 UI before further review repairs; B1 27 engine and 5 UI before further review repairs. These are not full batch gates.
- Root started 5D1 using failing tests. New inventory.ts, repurpose.ts, formats.ts, slot-kinds.ts and community.ts have seven focused tests passing in venture-social-repurpose.test.ts and venture-social-w5-rules.test.ts. They are domain helpers only so far. Tools, desk, live run wiring, chain, scheduling, ghostwriting, baseline, Hindi and independent review remain to do.
- Current AGENTS says LinkedIn copy-and-open only, overriding the older plan's owner-browser posting option. Root added two failing engine regressions then blocked LinkedIn API/browser capabilities and proposals, including a final send guard; engine tests pass 2/2. Fake parity tests failed as expected and corresponding fake changes are written, awaiting rerun. Existing posting tests and UI wording need reconcile with the stronger founder rule. Official User Agreement checked 27 Oct: https://www.linkedin.com/legal/user-agreement (section 8.2); its Help page https://www.linkedin.com/help/linkedin/answer/a1341387 also prohibits automated site activity. No outside post occurred.
- C1 still has no source edits. leads_review_seller will implement it after completing seller review; SEO author is occupied with monitoring corrections. Batch 3 and 4 remain unstarted. Screenshots and full batch gates are still outstanding, and no PR exists.


### 27 October 2026: 5M review repairs and 5F1 independent review

- 5M author checkpoint (leads_review_seller): 21 focused engine tests and 10 UI tests pass after independent review repairs. Outreach checks cover title, headings, body and questions, with clause-local denials. The actual delivery ToolEnv resolves the accepted semantic cold-email offer, produces the 50-prospect three-touch plan, and refuses changes to the owner's chosen count before network I/O. Community inputs validate exact nested records and real dates; the tool reads only a same-business owner-confirmed source, never a model's permission boolean. The owner panel accepts plain fields and pasted posts, displays exact quoted scores and coverage, reopens saved reports, and physically forgets evidence. Network Forget also removes evidence naming that person. Fake tests cover referral dedupe, India-day quote dates, per-account paid-request identity and community erasure. New behavior was tested RED before implementation. Production professional confirmations remain null; all positive delivery tests restore temporary trusted fixture confirmation. No real HTTP, spend or messages occurred. Independent 5M re-review is pending; the author does not certify it.
- 5F1 independent Stage 1 spec PASS and Stage 2 code-quality PASS (leads_review_seller). Original and later findings closed: required packaged status, signed percent formatting, owner/tool economics-backed ads break-even with both source receipts, visible reconciliation and settlement holds, order-labelled receipt-backed split amounts, title triage, all displayed safety text, trusted current legal confirmation, canonical offers and intake/roles, own-shop self-client/internal orders with no sales facts, invoice or client share, and actual delivery plus Accept for all five offers without extra drafting runs. Focused evidence: 29 engine tests passed, then updated eight-test review file passed (30 unique engine cases total); seller desk seven plus own-shop two UI tests passed. Read-only mutants killed packaged-guard deletion, broken negative formatting and body-only safety. A Vite transform removing title triage killed exactly the corresponding UI regression (six pass, one fail), without changing application source. No remaining review findings. Root still owns full typechecks, shards, screenshot/visual gates and release decisions; no visual PASS is claimed.
- 5C1 prep was handed to youtube_review_seo after root reassigned implementation. No CA source edits were made by leads_review_seller.

### 27 October 2026: 5G review repair checkpoint

- Support review repairs now exercise actual order intake, mail import and delivery APIs. Signed reply addresses are attached to unsent drafts; imported signed/reference/same-customer number replies append screened evidence to the same ticket. Customer/order matches come from scoped CSV uploads and ambiguous matches require explicit owner confirmation. Forget also erases phone-linked support copies.
- Owner takeover voids unclaimed previews, uses the existing harness stop latch, and force-cuts harnessless work already dispatched so its returned draft is discarded by existing settlement. Blocked or paused support orders are held before model preview and again at approval/send. Production legal-rule confirmations remain null; positive delivery tests use restored test-local confirmation.
- Ticket targets inherit service-order opening hours, timezone, holidays and reply/resolution targets, with explicit action overrides. Scheduled snoozes stop pausing at their chosen time. Resolution deadlines remain visible after a first reply. Hindi opening-hour input is accepted. Completed refund claims in titles, headings, body and questions fail deterministic checks; honest pending/negative wording stays allowed.
- Focused aggregate: 68/68 engine tests across support, imported mail, existing run controls and money check-up. Support UI/fake 11/11 passed. The independent G reviewer is rechecking the latest repairs; the author does not claim an independent PASS or visual verification. Root owns global gates.
- K1 independent re-review by support_finish: original five findings closed; focused engine 30/30 and CollectionsDesk/fake 7/7 passed. A padded-header ledger validation bypass was reproduced and repaired with the shared source reader; its actual delivery regression 11/11 passed independently. The analogous XLSX branch is still with the author before final review disposition.

- Follow-up to the 5M checkpoint: independent reviewer seller_review_leads reports Stage 1 spec PASS and Stage 2 quality PASS, with fresh 22 engine and 11 UI tests. Final repairs add synchronous fake Forget using the existing desk hook, including evidence saved before a person was imported; source insertion order matches the real desk before due follow-ups; the community tool can discover up to 20 same-business owner-confirmed sources before selecting one. Three source-transform mutants were killed. Thirteen used M refusal codes were registered in VENTURE_ERRORS. Final affected M tests plus intake-word coverage pass 15/15. Visual gates remain unclaimed.
- Shared intake Hindi repair (leads_review_seller): KitIntakeFields translates labels, help and choice display words through a browser-safe lookup, preserving submitted option values. New English/Hindi catalogues cover 104 unique words across all five landed kit definitions and the additional social forms, including monthly-report. Existing kit Hindi was reused, new social Hindi is machine drafted, and hi-review additions were narrow. The Hindi form regression failed on the English label before the fix and now passes with all five intake UI tests; a Node coverage check guards all shipped labels/help/options and review registration. Independent seller reviewer checked this path.
- LinkedIn regression migration (leads_review_seller, root-assigned): the three connector-posting/posting-safety/browser-steps test files now preserve generic automation safety on X (explicit draft parts and a clock advance where posting limits apply), retain explicit LinkedIn copy-and-open denial, and check another channel's availability with an Instagram stub API. Today ambiguity/no-click tests use X's actual test-id then role candidate. Focused 53/53 tests pass. No live browser or network was used.

- Social fake onboarding/preflight parity (leads_review_seller, D1 slice): new browser-safe fake-social-plan.ts reads the six real offers and merged legacy/generic intake in stable plan order; fake.ts selects it using registry longest-phrase precedence. FakeWork normalizes social calendar/client lists/disclosures with generic answers and rejects invalid same-order file references. New fake-social-intake.ts gates drafts using actual uploaded transcript/CSV bytes, shared source inventory/format/community rules, and coded EngineError conversion. Six focused behavior tests were RED for the expected gaps, then GREEN; kit/intake/onboarding aggregate 18/18, plus a seventh direct real-engine intake oracle matrix (14 cases) passed. Type-only fixes followed UI checking; root retains global gates. No outside effect, fake-social.ts canvas edit, or visual PASS is claimed.
- D1 fake metadata graph follow-up: browser imports now read fixtures-social-plan.json, generated from six real offers, their intake, and the fourteen step titles/outputs. The engine oracle venture-social-fake-metadata.test.ts pins the exact snapshot (RED missing fixture/steps, then GREEN). Fake chain can use exported fakeSocialSteps without importing the server registry graph. Final focused fake social + kit intake + kit onboarding run passes 19/19; root owns fresh full type gates.

## 10. Astra takeover continuation, 28 October 2026

This is an implementation checkpoint, not a Wave 5 completion claim. The user asked for status during the turn; they were told that six batch-two packages passed independent code review, CA and social remain in progress, and no PR was opened or merged.

- Independent spec/quality PASS is recorded for 5B1, 5E1, 5F1, 5G, 5K1 and 5M. These verdicts do not claim screenshots or full batch gates. Review details and exact test counts appear in the preceding author/reviewer notes.
- Root independently read and ran the real-engine oracle for the fake kit plan fixes: longest phrase across the entire registry, registry tie order, actual plan offer order and omitted empty asks. The two engine oracle tests pass. The shared Hindi schema lookup now covers the landed kit and social words, with submitted choice values preserved.
- Root D1 source/format/community tools are real, source-bound and receipted. The delivery guard blocks missing/disallowed community rules and thin repurpose sources before a model preview. Current source file bytes and ownership are checked in the inventory tool; transcript timestamps do not become claims. Source-only final checks cover title, headings, body and questions. Community checks detect generated links and common promotion phrases; semantic judgment still matters.
- Root added six social offers/intakes through the actual plan path, retaining legacy calendar/client rules alongside generic fields. Community rules/promotion/links are now required at new intake. Monthly reports require reportMonth.
- Root added a real read-only canvas desk and browser-safe shared view, English/Hindi channel cards, counts, format traces and per-post refinement with an extra-round quote approval. Fake canvas matches current order files and client draft screening. Root's latest focused engine source/publish set is 11/11; canvas/fake UI was 4/4, with an additional paid-quote test running.
- Latest AGENTS LinkedIn copy-and-open rule is enforced in real and fake posting paths. Old automation fixtures are migrating to X while preserving generic safety coverage. Root's current brand-kit check at posting and judge bound-source evidence tests pass. A static brand-kit import caused a module cycle; fixed by extracting read-only brand-kit-read.ts. The source checks and posting safety now pass 21/21 together.
- Active D1 authors: support_finish owns the real/fake voice/calendar/draft chain and report prerequisites; bookkeeping_finish owns ghostwriting structures, per-post revision/approval/price handling; seller_review_leads owns live slot plans, seven-day approved hook history and revision due rows; seo_review_youtube owns scheduled posts and rule/baseline follow-up. Root owns canvas/source integration. leads_review_seller completed fake social intake/onboarding parity and independently reviews scheduling.
- S12 review reproduced real defects: a delayed post without an exact known account, fake slots never ticking, and Forget leaving copied personal text with pending authority. Author is repairing them test-first. Do not label S12 independently passed until reviewer closes these findings.
- C1 is still authored by youtube_review_seo and reviewed by bookkeeping_finish; reviewer found plural citation parsing and contradictory form fact gaps. C1 has no final PASS yet. The C1 author is also assigned the independent ghostwriting review when ready.
- Shared UI type checking exposed browser imports pulling the server module graph into strict UI checking. Social metadata now uses engine-pinned browser JSON; fake chain is switching to that step metadata. Root extracted channel IDs and revision quote types to leaf modules. Shared typecheck/check commands are still in progress, not a clean gate claim.
- No batch-three or batch-four completion, full engine shard run, full UI/build, screenshot walk, commit, push or PR is claimed. Preserve the default C-drive temp folder for engine tests and never stage root package-lock.json.

- D1 chain/report author checkpoint (support_finish): real content-calendar runs voice, calendar, then drafts through the existing owner Accept chain. The exact approved voice is reused only for the same client and matching resolved kit plus active business voice digest; the selected writing stages are pinned per order. Ghostwriting drafts use the selected 8/12 structured post headings, with a separate Post plan section. Monthly reports require an explicit reportMonth and one recognized CSV export per platform before the sole writing preview; real social.report receipts and its missing/excluded-source caveats reach that preview without invented model turns. The stage card shows exports, figures and owner approval in English/Hindi, including before a first run.
- D1 fake chain checkpoint: public delivery start/approve/review and Today read/Approve/Accept advance the same stage order. Read-only chain views do not pin an order; changed source bytes refuse the old preview. Demo drafts are explicitly labelled. Report figures use the shared exact report-core arithmetic with host-provided digests, not a second arithmetic implementation. Browser step words come from the engine-pinned social metadata snapshot.
- Latest author validation: 16/16 engine report/core/chain tests; 23/23 fake chain/intake and ManualPaths UI tests. Existing social-run tests pass 10/10 after real-chain and Post plan fixture migration. Calendar-export's live chain case passes; one older LinkedIn automated-post fixture still needs the separately owned copy-and-open migration. Independent chain/report review is assigned to seo_review_youtube and remains pending. No screenshots, global type gates, full suites, commit or PR are claimed here.
- S12 independent review (leads_review_seller): Stage 1 spec PASS and Stage 2 quality PASS after repairs. Fresh 39/39 engine tests (scheduler, Forget, posting safety) and final 13/13 UI/fake tests pass. Reviewer reproduced a post after Forget before the repair; scheduled copies now scrub and lose their posting authority, including partial-name and opaque/canonical LinkedIn URL fake matches. Nonempty slots bind a known account before review and fence it again; due execution consumes original approval only, restart loses authority, busy waits are bounded to sixty minutes, nothing-ready is emitted once, changed bytes block, stale UI review refuses, and claimed cancellation matches the real code. Root retains full type/build/screenshot gates; no visual PASS is claimed.

## 11. Astra integration checkpoint after connection recovery

- The brief environment disconnect ended; the Windows workspace and Chausar instructions are restored. Work remains on b2c/ink-v2-w5. No commit, push, PR or merge is claimed.
- Independent review now passed 5C1 as well as 5B1, 5E1, 5F1, 5G, 5K1 and 5M. CA author ran 135 engine tests and 5 UI tests; reviewer independently ran 85 CA tests and 5 UI tests. Detailed CA checkpoint is NOTES-5C1.md. These are code verdicts, not visual or full-wave gates.
- S12 scheduling independently passed spec and quality: 39 engine and 13 UI/fake tests. Findings closed include exact known account, due execution in fake, session restart invalidation, cancellation parity, and Forget scrubbing queued text/approval including partial names and LinkedIn URL-only identifiers.
- D1 remains under review. Chain/report repair includes mandatory real exports for template reports, copied voice erasure, current brand pin/reuse checks and a source snapshot fence across asynchronous preview. Ghostwriting review found channel omitted from per-post approval digests, old per-post answers outranking newer share answers, and owner edits lost on refinement. Authors are fixing these with public-path regressions. No overall D1 PASS yet.
- Root canvas now exposes validated post plan kind, goal, reader action and hook; exact Post plan rows map to actual post ordinals. Reminder links select the target order. Root added code receipt Figure for extra-round quotes; bookkeeping owns resolvable real/fake receipt generation and quote/charge binding. The quote still requires a separate exact approval. Error words now explain missing extra-round price and post-shape changes in English and Hindi.
- S5 author extracted shared actual-post selection after an alt-text-before-Drafts review regression. Real checks, canvas, calendar and posting now agree on IDs. Required metadata ordinals/schema labels no longer masquerade as source claims; factual goal/action numbers still face source-only checks. Focused 39 engine tests passed. Reviewer M and support are closing fake plan/history parity.
- Fake monthly reminders derive all readable businesses without exposing locked workspaces, use the India local day, and Open navigates without resolving the notice. Bookkeeping independently confirmed the public local-day/all-business/locked/Open regressions. Root extracted ventureView so internal fake desk reads share the public venture.get answer; currency regression remains with bookkeeping.
- Root central Hindi glossary/Latin corrections made text tests pass 22/22. Work's ready playbook tools now open one step away, retaining state after first opening and opening directly for a social reminder. This reduces default Work words without raising its baseline. Connections capability wording was shortened in real/fake posting descriptions and stale LinkedIn tests migrated to X, retaining LinkedIn refusal coverage. No word baseline raised.
- Broad UI diagnostic with vmThreads completed 2493 passed / 51 failed while edits and RED tests were changing. It is not a stable gate: some failures are fixed legacy LinkedIn expectations, some are current D1 repairs, and vmThreads itself failed native config/ReadableStream/location tests. Standard-pool trial got sandbox temp-file ENOENT on two suites while compiled-motion tests passed; root is retrying standard pool with UI-only repo temp. Engine TMP/TEMP remains untouched.
- Root independent brand resolver/current-word posting/source judge review passed with 32 nearby tests. Syntax/JSON check previously passed 1713 files; fresh engine/UI types need rerun after current repairs. Full build, six sequential engine shards, visual walk and final cold review remain outstanding.
- 5F2 is now assigned to seller_review_leads because its own 5F1 predecessor passed. It follows the plan's dependent-package rule; this does not declare batch two or batch three globally complete. Other batch-three/four packages remain outstanding.

- D1 chain/report independent close (seo_review_youtube): Stage 1 spec PASS and Stage 2 quality PASS, code-only. Reviewer ran 14/14 real tests (chain 10, report 4) and 9/9 fake chain tests. Closed boundaries: current explicit accepted voice pin after brand changes, template non-completion, real report receipts and caveats, copied voice/report/source/decision erasure, delayed preview commit fence, selected 8/12 ghostwriting packs, exact review reasons, shared Post plan/history validation, and name-boundary preservation in fake Forget. No screenshot or broad-gate claim.
- Final chain/report author checks: network Forget plus report/core 22/22; ManualPaths/kit-rules standard-pool 12/12; translated social refusal plus Work orders 26/26. SOCIAL_VOICE_CHANGED, SOCIAL_REPORT_MONTH_REQUIRED and SOCIAL_EXPORTS_REQUIRED now use EN/HI refusal words in Work start and Today approval; new Hindi keys remain machine-drafted for native review. Root owns global checks. Support author starts 5H recruiting after the completed 5A predecessor; this does not mark all D1 or batch-three work complete.
- S5 independent close (leads_review_seller): Stage 1 spec PASS and Stage 2 quality PASS, code-only. Reviewer checked exact Post plan rows, owner selling cap, code-dated calendar hook windows, current same-client accepted history, concurrent Accept and seven-day pruning, monthly due queue links, and shared real/fake analysis. Prior focused engine group passed 40/40; the final parser/revision rerun passed 26/26 engine and 22/22 UI/fake, including the corrected Hindi due-label expectation. Shared actual-post selection preserves nested Drafts headings and excludes companion sections before numbering.
- Additional D1 review findings closed: extra-round quotes now display resolvable code receipts, bind receipt IDs into exact quote approval, and retain approved historical proof after owner price changes. One-post revision landing now maps actual post line locations, preserving other posts, companions, title, metadata, prefixes, whitespace and CRLF. Reviewer reran both original multiline/companion failures with Alt text before and after Drafts; both pass. Full-wave type/build/shards and screenshots remain root-owned; no visual PASS is claimed.

## 12. Wave-five integration and social re-review, 28 October 2026

- A fresh independent batch-one inspection found the recorded fixes and both 5A1 nits closed. Fresh A1/A2/A3 engine tests passed 58/58 and A6 passed 44/44. Three A4/A5 atomic-save failures were environment restrictions: the same report and OOXML suites rerun with ordinary Windows file access and default C-drive temp passed 34/34. The original source-mutant evidence remains recorded in section 7 and its following package checkpoints. This is not a new full-batch gate.
- D1 independent final code review now reports Stage 1 spec PASS and Stage 2 quality PASS. The reviewer reproduced hidden extra posts inside one section, missing repurpose channels/newsletter, nested-heading fake mismatch, and missing professional confirmation metadata. Each received a failing regression before its repair. The final shadow-rehearsal fake regression also failed before its fix.
- New browser-safe social modules are `ghostwriting-core.ts`, `repurpose-coverage.ts` and `legal-confirmation.ts`. Ghostwriting counts actual post lines and uses each post's nearest heading while ignoring companion text. Repurpose delivery requires exactly the selected channels and a nonempty source-grounded newsletter blurb; the writing schema requests those only at the drafts stage. Real and fake final checks share these functions.
- Every social platform rule now declares `needs`. FTC, ASCI and the India synthetic-media legal rows require a lawyer and retain null confirmation. Paid or synthetic client work is held before preview and again at approval; ordinary drafts and shadow rehearsal remain usable. The gate uses the owner and known client jurisdictions and conservatively covers both supported jurisdictions if either is unknown. No legal confirmation is invented, and the refusal gives the manual path.
- Fresh social real regression group passed 19/19; the independent reviewer ran 35/35 nearby engine cases. The final fake social, Business and Collections UI group passed 63/63. Business's stale-rule expectation now correctly keeps rules current on day 90; the Collections Hindi expectation follows the established client glossary. No word baseline was raised.
- A broad diagnostic UI run during concurrent implementation completed 2552 passes and 6 failures across 178 files. These included the then-missing SEO monthly screen, seller operations still under construction, social regressions in their RED phase, and the two corrected expectations. It is not a stable batch gate. Engine shard 1 reached its ten-minute limit without a final summary and remains incomplete. Full type gates, stable UI/build/shards, screenshot walk, cold review, commits, push and PR are still outstanding.
- B2, E2 and F2 are being completed by separate implementers from the inherited working tree. H contains only initial domain helpers and remains unregistered. No completion is claimed for the rest of batches three and four. The root lockfile remains excluded and no PR has been merged.

## 13. Review integration, 28 October 2026

- Batch-one re-review fixes are committed separately: 5A1 `8036b96f`, 5A2 `0456edf`, 5A3 review record `5ec416e6`, 5A4 `f0ecaf0b`, 5A5 `275bd007`, 5A6 `674b6be5`. Package review details also live in NOTES-5A1.md through NOTES-5A6.md. No package has been merged or published as a PR.
- Fresh final targeted checks: A2 fake sales 23/23; A4 media, consent and delegated outputs 23/23; A5 report and OOXML 34/34; A6 connector engine 33/33 and fake 2/2. The A6 public monitor input now accepts only belowRupees, removing the temporary belowMinor compatibility path. Stored amounts remain paise. A separate reviewer passed this final delta.
- The broad UI diagnostic completed 2576 passing tests with three failing tests and one collection failure across 182 files. Failures were Connections word limits, the stale seller offer-list expectation, and a renamed SEO test import. The authors fixed them. Later D2 browser imports pulled server modules into UI typechecking and are being extracted into leaf modules. This is not a stable batch gate.
- Both B2 and F2 now have independent spec and quality PASS, including phone-width and dark screenshots. Detailed results are in NOTES-5B2.md and NOTES-5F2.md. E2 remains in its repair and final-review round. C2 and D2 remain under implementation.
- The incomplete engine shard reached 990 passing cases at its ten-minute deadline. Its final two files passed independently, 9/9 in about 34 seconds. With the inventory grown from 272 to more than 579 files, the runner now has a fifteen-minute bound and CI a twenty-five-minute job bound. Six shards, single-worker execution and all failure, skip, todo and truncation guards remain. Independent spec/quality review and the 14-test benchmark suite passed; committed as `c4eb0fe6`. All six final shards still need a stable run.
- Root started 5K2 with five RED-to-GREEN accounting-decision tests. `posting-core.ts` provides ordered skip reasons, code-computed line allocation, shop-time-zone dates, collision-resistant source/reversal identities and a complete dry run that refuses failed or ambiguous reads. This is only a domain foundation, not a completed accounting connector or owner flow.
- E2 final independent root review reports Stage 1 spec PASS and Stage 2 quality PASS. The reviewer reran WordPress, public publishing, content, strategy and edge tests, 15/15 passed (`results/w5-e2-root-final-review.log`), and viewed English light monthly and Hindi dark strategy captures at 390 px. Final repairs bind every numeric occurrence to its declared claim number, verify the exact approved article within the connected installation, exclude hidden descendants from evidence, retain refresh gaps and reject stale strategy learning. Implementation evidence and touched files are in NOTES-5E2.md. Connections setup stays inside More ways to connect, both word budgets pass unchanged, and no remote effect or measured success is invented by the fake. This is package review closure, not the outstanding stable whole-wave gate or cold screenshot review.
- K2 continued with real and fake cycle/setup/voucher owner paths, resolvable work receipts, stale-source approvals and Forget erasure. The owner screen sends rupee strings unchanged and reads code-formatted figures. The voucher harness tool now drafts from actual source rows and refuses unbound client cycles. Current focused checks: 19 engine domain/public/collections tests, 6 bookkeeping tool tests, and the new UI/fake owner flow pass. Details and the substantial unfinished adapter, posting, setup, seller-flow and review scope remain in NOTES-5K2.md. No K2 completion or connector capability is claimed.

- 5H recruiting desk is implemented and independently reviewed: Stage 1 spec PASS and Stage 2 quality PASS by batch1_verify. R1 to R6 cover source-bound screening, one-round exact manual contact/invite approvals, receipts and ledger-only reports, official public boards, and linked Forget/expiry cleanup. Hire/invite completion is evidence-specific. Live candidate processing stays held for lawyer review. Owner desk is ready with English/Hindi; independent390 px screens passed both themes. NOTES-5H.md records actual names, boundaries, all RED/GREEN and mutant evidence, targeted test counts and remaining global gates. No H commit or whole-wave completion is claimed here.

- 5L podcast-to-article is implemented and independently reviewed: Stage 1 spec PASS and Stage 2 quality PASS by batch1_verify. PA1 to PA4 now include actual transcript preparation, a source fact ledger, two structured agent stages with owner outline approval, source/style/attribution checks, show notes and newsletter text, and an exact unsent publishing handoff. Desktop local audio/video transcription uses the existing installed tools and copied source bytes; the demo never invents a completed transcription. Named professional confirmation remains null and is required for real client approval/handoff, even in rehearsal. Review repairs reject stale draft saves and erase linked AI request payloads on Forget while preserving spend records. Final author engine 34/34, reviewer pure18/public16/UI7, shared accessibility/budgets193/193 passed; EN/HI light/dark phone captures measured390/390. NOTES-5L.md records exact modules, RED/GREEN, owned shared hunks, integration failures and remaining global gates. No L commit, word-budget raise, or whole-wave completion is claimed here.

## 14. Integration and accounting continuation, 29 October 2026

- 5J1 translation has independent spec and quality PASS, with ownership and evidence in NOTES-5J1.md. Public-source AI preview and protected-term checks use actual source versions. Private work stays held for a qualified local model; client delivery requires the named legal confirmation and exact client share-link answer. Stale privacy, approval, licence and edited-source races were repaired. No invented professional confirmation or delivery success is claimed.
- K2 settlement source, provider and public loop have independent PASS/PASS. The independent review reproduced and closed a replaced-claim race, malformed remote identity confirmation and retained historical receipts on Forget. The owner screen and fake also passed after stale cycle data, changed source selection and refusal-order repairs; EN/HI dark captures measured390/390. Evidence is in NOTES-5K2.md and NOTES-5K2-SETTLEMENT.md.
- K2 setup now has separate exact approvals for mapped masters and opening balances, readback of actual provider identities, a session-only connection and a no-retry unknown outcome. Its independent increment review passed after stale receipt/connection refresh gates were repaired. NOTES-5K2-SETUP-UI.md records files, tests and screenshots. The final whole-package audit is still distinct from these increment verdicts.
- The whole K2 audit found the inherited finance baseline accepted canned prose without financial source data. Missing/corrupt source tests failed before repair. The baseline now runs nine cases through collections, CFO scenarios/ratios, spending checks, setup, voucher approval, seller reconciliation and posting decisions. Meaningful source changes with unchanged prose lower every case. Zoho capability text now names supported setup and received settlements; unsupported AR/AP, inventory, FX and location setup remains manual.
- Current integration checks are diagnostic while implementation continues. Syntax/JSON validation passed2112 files; a fresh engine typecheck passed before N source integration. Shard1 completed1128 tests:1114 pass,14 fail, no timeout or skipped cases. Failures identify old gallery/workflow expectations, the Electron test's missing local-project mock, a missing Hindi Cutter role and the known founder-local architecture-copy mismatch. Root and reviewer are repairing these; shard2 follows sequentially. The first full UI run hit broad timing failures under default worker parallelism and was stopped; a two-worker full run is in progress. None is a stable final batch gate.
- Shared connector catalogue links are now explicitly allowlisted for their static Visit site origins. Updated capability/count and share-answer tests passed18/18; the latter keeps the LinkedIn prohibition and uses X for its generic approved-post assertion. Gallery fixture and tests now cover landed kit tiles, keeping fixed sorting examples and no-write checks. Fresh gallery tests passed12/12 with normal C-drive atomic file access. The architecture table inventory test also passed, while the founder-local copied-document mismatch remains untouched.
- All batch-two and later package commits remain outstanding. N newsletter is being built; O/P/Q and batch four remain. The final full walk, cold screenshot review, measured word baseline settlement, ink.md update, push, PR and Ubuntu/Windows CI remain unfinished. No PR has been merged and the root lockfile remains excluded.

## Scoped integration repair review, 29 October 2026

- Independent Stage 1 spec PASS and Stage 2 quality PASS cover the no-country revision reminder guard, missing social and YouTube improvement-rule guidance, Cutter department expectation, current Business CA assertions, and test-local professional confirmation restored in finally. No production legal gate was relaxed. The reviewer ran 36 nearby engine cases and 47 Business UI cases successfully (`w5-root-integration-independent.txt`, `w5-root-business-independent.txt`).
- Review found that ad disclosure and customer-pretence corrections targeted the ordinary post step instead of the actual ad-writing step. A new regression first failed, then both mappings moved to creative-briefs; root separately reviewed that repair PASS. B-roll guidance similarly moved from package to the actual youtube.broll tool owner, edit, after a failing regression. Final stage-specific checks passed 2/2 (`w5-improve-stages-green.log`, `w5-root-broll-independent.txt`). These are bounded integration repairs, not whole-wave acceptance.

## Continuing package commits and diagnostics, 29 October 2026

- M is committed as a62ef807. Its isolated candidate passed both types, syntax validation for 1510 files, 26 engine tests and 23 UI tests. E1 is committed as 51f1c5d2 after isolated types, syntax validation for 1539 files, 44 engine tests, 53 UI checks and exact metadata parity. E1 also corrects M's Hindi review marker. Remaining later-package work stays uncommitted in the shared checkout; no root lockfile or results snapshot was included.
- K2 has final independent spec and quality PASS, documented in NOTES-5K2-REVIEW.md. N remains under implementation. O has reviewed question/state/source and ground/export domains, plus an initial real owner desk test; it remains unregistered with no completed AI or owner UI integration. P, Q and batch four remain.
- Sequential diagnostic shards 1 through 5 completed. Counts were 1114/1128, 1314/1348, 1339/1352, 1194/1196 and 1125/1135 respectively. Shard 6 is running. Many failures were stale role, catalogue, guide or posting fixtures; focused repairs preserve the LinkedIn refusal and owner approval checks. The known local architecture-copy mismatch is untouched. No diagnostic run is a stable final gate.
- The two-worker full UI run completed 2641/2646. Its five failures now pass targeted checks: current CA wording/version, stale accounting setup resources and newly added guide keys. Later newsletter copy checks passed 22/22 after quoting technical labels. Final full UI gates remain outstanding.
- Additional harness integration repairs register actual tool refusal codes and parse integer counts through a shared strict helper. Fractional support duration remains accepted through its own parser. Article quote receipts serialize exact hundredths. New regressions were RED first, then GREEN; affected tool regression checks and independent review are still pending. The desktop Visit site allowlist now matches the engine's explicit catalogue origins.

## Further package commits and review closure, 29 October 2026

- K1 committed cb46ddd8 after isolated types, 55 engine tests, 50 UI checks and syntax validation for 1565 files. F1 committed 579fe5c1 after 94 engine and 60 UI checks, both types and syntax for 1587 files. G committed 2d8c634c after 94 engine and 54 UI checks, both types and syntax for 1618 files. Only each package snapshot was staged; root package-lock.json and results artifacts remain excluded.
- Shared numeric harness repairs now have independent spec PASS and quality PASS. Root affected checks passed 33/33; independent checks passed 10/10, including exhaustive percentage hundredths and actual fractional support-hour deadlines. Connector guide repairs have independent spec PASS and quality PASS, 22 engine checks and an inspected Hindi phone capture; see NOTES-W5-GUIDES.md.
- N now has independent spec PASS and quality PASS after five findings were fixed: cumulative audience allowance, full source-note erasure, unresolved template fields, receipt-backed price display and exact fake refusal order. Author engine 37/37 and UI 35/35 passed, with both types and refreshed receipt captures. N remains uncommitted until its position in the package sequence. P implementation has begun.
- O is now registered with source-bound desk AI, source checks, exact type approvals, code money receipts, export, Today gaps and Forget. Its engine domains and public boundaries passed separate independent reviews after fixing multiline issuer-cell truncation. Its UI/fake and full package acceptance remain unfinished; NOTES-5O.md records the actual surface. Q and batch four remain.
- Diagnostic shard six completed 3/3. The complete six-shard diagnostic pass is recorded, but it predates later changes and does not qualify final batch or wave acceptance. Final stable batch gates and the full screenshot walk remain required.

- 5N newsletter service has independent Stage 1 spec PASS and Stage 2 quality PASS from seller_f2. Owner source-note AI, consent-bound import, staged manual exports, source-report stats, sponsor/tier code receipts, cleanup and Forget are real owner paths; no send is claimed. Review closed cumulative allowance/UI audience, personal source-only erasure, unresolved sponsor/config fields, receipt marks with dirty-input hiding and real/fake refusal ordering. Reviewer engine37/UI10 and author engine37/UI35 passed, with both author types clean. NOTES-5N.md records exact evidence, source boundaries and owned paths. Professional confirmation remains null; live list import/export stays held meanwhile. Final receipt screenshot awaits a concurrent tender browser-import repair, then temporary harness cleanup. Global gates remain outstanding.

- Final newsletter housekeeping: the tender browser leaf was repaired by its owner. Fresh `n-{en,hi}-{light,dark}-prices-390.png` captures succeeded at390/390 (`n-price-shots.log`); author inspected Hindi dark, including the receipt mark beside INR 3,990.00. Vite and Chrome stopped; the three temporary newsletter review harness files were removed. N is frozen for integrator extraction.

## Tender closure and ongoing integration, 29 October 2026

- B1 committed b893d5b1 after isolated types, syntax for 1643 files, 59 focused engine checks, 16 transcription checks and 53 UI checks. The first shared run hit a Windows temporary hard-link permission failure; the targeted transcription rerun passed with the normal C temporary directory. C1 then D1 are next in the commit sequence.
- O has final separate spec PASS and quality PASS. Independent engine64/64, UI58/58, final monetary parsing7/7 and public queue2/2 checks passed; counts overlap. Review fixed pre-import Forget, agent-written prices, complete currency/number parsing, dirty source controls, fake Today and source-bound final acceptance. Root Office extraction review passed31/31; phone/desktop and Hindi receipt screenshots were inspected. NOTES-5O.md and NOTES-5O-UI.md record exact scope and limits. UI typecheck passes in w5-o-typecheck-ui-final.log. The concurrent P language type error was reported to its author and fixed. O remains uncommitted until its package position.
- P continues its actual source, provider and hosted form work. Q narration has begun after O review closure. Batch four, stable batch gates and the final walk remain outstanding.

- Current mixed-worktree full UI diagnostic completed2672/2680 (results/w5-integration-ui-current.log). Six failures were the async Today Stop receipt loss and stale/missing gallery fixtures. Today now keeps the stopped row while queue data refreshes, independently reviewed PASS/PASS with16/16. Generated Start data now matches real listWays, including N/O, and gallery tests cover every registered pick:23/23 UI and12/12 engine. The YouTube board's remaining5second timeout passes isolated7/7; no product behavior changed for it. Onboarding's expanded word budget remains to settle after the final walk. This diagnostic is not a stable batch gate.
- Q bounded independent domain/provider review closed actual RED failures for nonfinite audio measurements and impossible room-tone duration, added measured bit-depth checks and corrected stale provider comments. Root13/13 passed; full Q lifecycle, owner screens and package review remain unfinished.

## Batch two commit boundary and research follow-up, 29 October 2026

- C1 committed as 0288cb2b with the actual-plan intake regression and correction. D1 committed as ba53a3c3 after engine187/187, UI126/126, both types and syntax1738 passed in its isolated snapshot. Full batch UI then exposed omitted social test migrations and Hindi notice wiring; the exact followup is being verified before amending that unpublished commit. The remaining engine shards are required, and no full batch PASS is claimed yet.
- B2 isolated preparation found an old house-rule source expectation and missing B2 tools in the public tool ceiling. Actual failing tests preceded the fixes; separate spec and quality review passed both repairs. B2 and C2 standalone candidate checks are still being finalized before their commits.
- Nexscope's anonymous shipped workspace was inspected with REA. Its video editor requires sign-in. Partial capture and cleanup limitations, observed navigation, unresolved capabilities and candidate catalogue rows NX1 to NX3 are recorded in cards2/nexscope-rea-2026-10-29.md. These are later research candidates, not unreviewed additions to wave five.
- P's guarded source/release/CI/form/privacy domains have bounded review PASS; its final owner flow, fake parity and browser checks continue. Q's source fetch and speech dispatch reviews reproduced authority/source changes before send, which are being closed with immediate dispatch guards. Both packages still require complete separate spec and quality acceptance.

- D1's omitted integration hunks passed 81 connection/rule checks and 272 accessibility/Hindi/interaction retries. Its final unpublished commit is 498e3031, superseding ba53a3c3. B2 is now committed as 660684fc: final isolated engine 42/42, UI 51/51, both types and syntax validation for 1774 files passed. C2's missing browser leaves and fake receipt lookup were included in its candidate and UI types now pass; its new-base final checks remain. Batch-two full UI is rerunning with two workers on the fixed 498e3031 snapshot, with no weakened assertions or time limits.

## C2 isolated commit acceptance, 29 October continuation

5C2 committed as af9bbde6 on reviewed B2 base660684fc. Final isolated engine142/142, CA desk/fake/text/source49/49, both typechecks and syntax1815files passed. The staging recipe first duplicated B2 receipt helpers; removing only redundant recipe insertion resolved that integration error. Actual implementation and independent PASS/PASS remain in NOTES-5C2. Stable batch-two UI is now2546/2546 with no skips; types/check/six shards continue on its immutable498e3031 snapshot. D2 is next for isolated commit.

Shared ModelPort final synchronous dispatch guard independently passes4/4 (w5-root-model-guard-final.txt). N/O/J1 integration regressions are being added; their final re-review is not yet complete. P full review has two should-fix items: translated release states and refusing redundant AI audits while observed file fingerprints remain current. Q remains in implementation. No final wave acceptance or PR claim.

## Final model-dispatch source fence

Root added a last synchronous source/approval check to the newsletter, tender and translation AI confirmations after independent verification of the shared ModelPort seam. Actual RED3/3 observed one send after source/privacy mutation during model preparation; GREEN3/3 observes zero. Full nearby run29/29 passes (results/w5-root-source-guard-nearby-final.txt). The first nearby run exposed three synthetic newsletter legal confirmations dated before the actual checkedOn date; those fixtures now use the rule's checkedOn, preserving production validation. Separate seller_f2 review: STAGE1 PASS, STAGE2 PASS. Tender captures its exact order/file snapshots before asynchronous decoding, then compares them without any await at dispatch.

Integration ownership: J1 is the earliest package among J1/N/O/P/Q needing the common ModelPort beforeDispatch seam. Its isolation candidate must include the reviewed narrow contracts/host/models-port hook and four venture-models dispatch-guard regressions if the committed base does not already contain them. N/O/P/Q then inherit it. The independent shared seam run is4/4 in results/w5-root-model-guard-final.txt. No broad model-port replacement or Q spend-rate seam belongs in J1.


### 5P completion checkpoint, 29 October 2026

Website service and Build deepening are implemented and independently passed spec then quality review. Source dossiers preserve owner locks, current audits reuse file fingerprints, and the typed preview is isolated with empty sandbox plus three reviewed CSP policies. Exact repository/CI evidence, manual asset prerequisites, separately approved Cloudflare preview/health/production/rollback, unknown-outcome journals, minimum form data and source-linked Forget are wired through real/fake/owner paths. Form capture/import remains planned until named lawyer confirmation; the owner manual path is visible. WebsiteStudioDesk.ready=true.

Final author evidence:53 new P engine tests passed; four additional pre-existing local website tests passed with normal C-temp file access. Final source extraction and nearby tests28/28, repaired preview3/3, text22/22; wider UI250/253 initially, with the two text failures fixed. Remaining shared onboarding word budget785 vs330 is root-owned and unchanged. Both engine and UI typechecks pass. Independent review23/23 new boundary,7/7 owner/fake,3/3 missing-preview plus earlier foundation/later reviews; exact source distinction in NOTES-5P.md. Captured EN/HI light/dark390 and1280, reviewed images and removed harness. Scope/shared hooks and isolated staging draft are recorded in NOTES-5P-MANIFEST.md. No git mutation or external client action by the author.

## Additional historical package review evidence

### 5J2 completed package and independent review

Source-bound stock-voice dubbing and desktop local live captions are implemented. Exact per-speaker consent and separately approved paid speech, measured segmentation/alignment without truncation, actual local transcript checks, listening and disclosed manual handoff are in the dubbing desk. Local microphone sessions require explicit native owner permission and host intake permission, save nothing by default, have no cloud fallback, and invalidate promptly on Stop, source changes and Forget. Voice cloning and unqualified external rights/provider capabilities stay planned.

Root independently issued Stage 1 SPEC PASS then Stage 2 QUALITY PASS after the source/audio, privacy and owner lifecycle review fixes. Independent settled owner/fake15/15 and final native12/12 passed, along with earlier bounded native and actual Electron permission evidence. Author native33/33 plus final11/11, owner/fake15/15, actual FakeEngine event5/5, Stop6/6, both types and source/accessibility/text207/207 passed. Exact source distinctions, RED evidence, boundaries and screenshot paths are in NOTES-5J2.md. Final wave walk still recaptures active captions with the editable speaker label. Package source frozen; no whole-wave or live-provider success is claimed.


### 5J2 parent privacy final closure

The parent translation editor now clears forgotten source and pending replies while preserving dirty edits on benign refresh. Genuine behavioral RED then author16/16 GREEN; independent parent plus R1 owner/fake19/19. Root narrow SPEC PASS then QUALITY PASS recloses full J2. Exact evidence and retained prior reviews are in NOTES-5J2.md.


### 5J2 actual Forget transport correction

The prior parent privacy tests used events the engine never emitted. Root introduced the actual content-free privacy.forgotten stream. J2 now uses it across parent, dubbing, caption and desktop microphone lifecycle guards. Actual public FakeEngine regressions were behavioral RED, then 18/18 owner/fake/event GREEN; ordinary desk refresh preserves dirty source. Shared readers also discard supplied run identity, with genuine RED and 7 native / 16 UI GREEN. Exact evidence and the distinction from the earlier synthetic fixtures are in NOTES-5J2.md. Root final re-review pending for this narrow reopening.


### 5J2 actual-event final review closure

Root reclosed full STAGE 1 SPEC PASS then STAGE 2 QUALITY PASS after actual-event integration. Independent evidence: privacy readers 12 native, parent/media/event 19 UI, final Dubbing continuity 7 UI. Unsaved consent/account buffers survive benign desk refresh and clear on actual Forget; key submission clears explicitly. Author UI types pass. Exact logs and evidence correction are recorded in NOTES-5J2.md. Candidate isolation waits for I; no further product changes pending.


### 5R4 completed package review, 29 Oct

Developer agency now registers all three owner-priced offers, with a real source review desk, approved copied-input owner CLI, approved read-only dependency audit, code verdict/report delivery and journalled exact owner-command handoff. No Git push or security certification is fabricated. Source/client freshness, first-week maintenance restrictions, legal-review limits and full copied-evidence Forget are enforced in native and rehearsal paths. Both test-backed baselines and EN/HI owner controls are present; gallery estimates match the plan.

Root independent STAGE 1 SPEC PASS, then STAGE 2 QUALITY PASS: native37/37, final source/CLI/audit9/9 and owner/fake11/11; source evidence, exact log names, files and visual paths are in NOTES-5R4.md. Six EN/HI desktop/phone captures report zero axe findings and no sideways scroll. Author shared UI/source/text52/52 and UI types pass. Current whole-checkout native type issues were outside R4 and remain separately tracked. Final isolated commit, batch gates and wave walk remain integrator-owned.


## Final shared integration checkpoint, 29 October 2026

All 39 package commits are present through R6 `da38c076`. The isolated R4, R5 and R6 receipts remain in their package notes; shared integration is separate and does not rewrite those package results.

- Accepted-plan browser state now retains the actual accepted offers/intake. Every new order has its own code-computed receipt and quantity; the venture country supplies currency. Later unpriced edits do not erase the accepted plan. Exact native intake/error comparisons run in native Node with serialized values to avoid the UI bundler importing the server graph.
- Existing owner and engine test fixtures now price and approve the exact returned plan and current queue digest before ordering. Original prices, intake fields and assertions remain intact. Separate reviewers accepted both fixture groups after genuine RED evidence; 83 engine cases, 29 plus 22 owner cases and 25 work-order cases pass. Scoped 15-second allowances cover the two large accessibility pages and the first full Stop/Resume roundtrip; no assertion, global timeout or retry rule was weakened. The Today reply-reader oracle still compares every original card/reply against the real native functions, now in a bounded native child process.
- Native owner posting limits cover LinkedIn, X, Bluesky, Mastodon, Telegram and Discord. The browser mirrors exact required fields, validation order, error words, numeric bounds and tighten-only settings. A positive-control test proves the same eligible API post sends with unchanged limits but makes no POST after the owner tightens its minimum gap during DNS. Native 37/37 and the four affected UI files 102/102 pass; independent root spec and quality review passed.
- Connector samples and summary selection now agree with the real native public catalogue. Missing website guides, narration cost guidance and open-network social rules were reconciled against their native sources. Static capability and connector explanations translate on an exact known-string match while client words and changed live evidence remain verbatim. Run again uses the existing action translations. Required finishing failures tell the owner to install ffmpeg and rerun the checks, with no bypass suggestion.
- The privacy boundary lives inside BootScreen's business generation and above the remounted Frame. Every Forget event clears page/sheet, Ask and focus buffers plus any named receipt. Only a fresh successful command reply may display its deletion receipt; a second reset invalidates an outstanding receipt, and navigation or changing businesses discards it. A late privacy event leaves only the existing translated Forgotten heading and Close action. Existing person/network tests and five event-order/boundary tests pass 43/43 after genuine failure reproduction; final independent review is recorded separately.
- The run-sheet scope wraps at phone width. Cold review and measured English/Hindi 390-pixel captures closed the clipping issue. The walk readiness predicate is unchanged but can wait up to 120 seconds rather than repeatedly interrupting a measured 44-second cold module load; its regression checks include a never-ready timeout.
- Word budgets are based on measured counts: Connections and Connections/AI 1822 each, rounded to 1830 from 870; onboarding 1148, rounded to 1150 from 330 (first allowance 340). firstTotal rises from 6260 to 8990. Every rise must be presented to the founder in the PR. All other allowances remain unchanged.

The failed diagnostic full UI and engine commands remain retained evidence. Focused successes do not replace them. Final integrated types, syntax, UI build/full suite and six sequential engine shards are running separately; screenshot walk/publish, cold closure, final docs, push, PR and both-OS CI are still required.


### Integrated UI gate and review closure

The first integrated UI run passed all 2948 tests in 295 files, with no skipped or todo cases, in 898.44 seconds (`results/w5-integrated-ui.txt` and its Vitest JSON). Both types, syntax2888 and UI build also passed. Six native shards continue sequentially; this UI result does not predeclare their outcome or the screenshot walk.

Separate privacy review closed both stages with independent5/5 boundary checks after root43/43. The residual audit restored151 existing Hindi review keys and the lead-generation review file, plus the exact native Zoho guide and three still-used error declarations; actual missing-checker/guide regressions failed before restoration and9/9 passed afterward, with root spec/quality acceptance. No completed native language review is claimed.

The CI UI job's former15minute total allowance was shorter than this measured test run plus installation, types and build. Its scoped allowance is now25minutes, matching the existing engine job budget. A new assertion in the existing CI-contract test failed before the edit; both relevant CI contracts pass2/2 afterward. Independent spec and quality review accepted this scheduling allowance. Both operating systems, all test files, skip/todo/failure rejection, typechecks and build remain mandatory; no test timeout or retry rule changed.


### Final visual and connector repairs

Full-App support and lead smoke captures exposed static English playbook labels in Hindi. The small playbookLabel helper translates only an exact registered ID plus exact English label, preserving custom, unknown and already-translated values. Work, business switcher and PlanView use it. All23 entries derive from existing native Hindi; three glossary terms and the duplicated VA label were aligned with their derived gallery samples. Actual App Hindi failed first, then UI/native-oracle/text27/27 and native ways1/1 passed. Root separate spec and quality review passed.

The first quiet native shard completed1315pass/8fail. Connector inventories and the phone expected-card assembly were stale;17 exact catalogue origins were absent from the native/desktop link allowlists, and Shopify/formfill/phone notes exceeded the existing200-character cap. Strict full inventories, actual architecture-table checks, exact truth-enriched phone metadata and concise qualified/manual notes now pass. Independent URL checks accepted the17 intended origins and refused68 bad scheme, credential, subdomain and port variants; no wildcard/validator relaxation. Native connector/end-to-end10/10, UI text27/27, phone native4/4 and words3/3 passed with separate spec/quality acceptance.

The shorter copy measures1796 words at rest in Connections and Connections/AI. Their proposed1830 budgets shrink to1800; first allowances match. Onboarding remains1148 measured and1150 allowed. firstTotal becomes8930. Every rise relative to wave4 remains listed in the PR draft. The2948/2948 full UI result preceded these final repairs, so a fresh full UI run and affected shard reruns remain required, as do final screenshots, publication and CI.

### Fresh visual review and repaired owner explanations

The supplemental full-App capture completed69/69 views across all23 desks, each in English desktop/light, English phone/dark and Hindi phone/light. Every capture checked the actual selected desk, accepted owner-priced plan, settled requests and source fingerprints; no horizontal overflow or axe violation was recorded. These are initial views with fictional data, not populated provider journeys. Two fresh reviewers independently inspected all69 views plus82 saved populated component images, preserving the older images' provenance and scope limits.

Their five concrete findings are repaired and independently closed in16 current focused images. CareerThreadTable now identifies each application by its exact same-client/same-order listing URL and each pack by known translated kind and recorded time. Unknown identity is explicit; source prose is never mined for an invented job title. BooksSettlement now shows the exact customer, invoice, account, date, payment method, source and receipted allocation before approval; missing per-payment proof locks approval and raw request bytes remain optional details. YoutubeResearchResult puts exact reply drafts in a separately headed section outside held comments. Each change has genuine RED evidence, focused GREEN checks and separate spec then quality acceptance.

RoomReceiptWords translates only known complete system labels and calculation templates, preserves numeric strings and retains original or unknown evidence without recomputing money. VA schedules use existing weekday translations and explain exact fixed routine prompts in Hindi while submitting the original prompt and schedule. Dev, phone and IT report reviews repeat their existing translated verdict or manual-action boundary beside the original text. Exported text and digest-bound approval bytes are unchanged. VA owner/accessibility/text36/36 and the three report owner files13/13 pass after genuine failures. Root spec and quality review passed; the fresh reviewer closed the Hindi and weekday findings in seven current phone captures.

The first complete integrated native run used one consistent test-file inventory across all six shards. Shards2,5,6 passed1315,1298,3 tests. Shard1's eight stale metadata/origin/copy failures are repaired; shard4's single old four-channel register test inventory now explicitly covers all eight channels and passes12/12. Shards1and4 still need full reruns. Shard3 passed1491/1492, with the documented founder-local architecture-copy mismatch left intact. Earlier failed commands remain failed evidence. The required main walk and final gates are now being run against the repaired source.


### Final main-walk cold findings and current release checkpoint, 29 October 2026

The quiet main walk completed 488/488 checks with no automated failures at `2026-10-29T12:28:07.066Z`. Its report and PNGs are preserved in `results/w5-main-walk-before-cold-fixes`; this is the successful pre-repair walk, not evidence for the final changed pixels. Cold review `results/w5-cold-main-walk.md` found four substantive clarity problems despite the automated pass.

The sample Editor claimed working YouTube publication although the native owner/client publishes in Studio. Producer price/send and Bookkeeper portal assignments had the same owner-only overclaim. The repair removes those four assignments from the sample team itself, not from a visibility filter. Native workflow and authority are unchanged. The actual native role oracle confirms owner publishing/filing has no AI role. Billing.issue remains an assigned working capability with its always-ask floor, English/Hindi owner controls and GATE_FLOOR refusal; Instagram remains planned. Connections headings now explicitly identify API, browser-session or manual posting, preserving each exact mode, capability state and reason. Genuine RED is retained in `results/w5-capability-heading-red.txt` and `results/w5-capability-heading-exact-red.txt`; all 121 focused checks pass in `results/w5-capability-heading-final.txt`. Root independently passed spec then quality. The 10-path packet is `results/w5-capability-heading-manifest.json`.

The other two cold findings concerned Hindi approval/spend scope and awkward receipt punctuation/wrapping in run sheets. Exact known native scope/rate templates now have translated presentation; unknown words remain original. Amount/date strings and receipt identities are unchanged, and the UI performs no money calculation. The wrapping change is scoped to the run-scope paragraph. Genuine failures preceded the repair, and 89/89 focused checks passed in `results/w5-run-scope-final-green.txt`; root independently passed spec then quality. Both groups still need current-pixel acceptance from the replacement full walk.

The previous cold desk findings remain closed by 16 focused current images. The earlier 69-view supplemental capture and 82 saved populated-image review retain their stated initial-view, synthetic-fixture and historical provenance limits. No real provider qualification is inferred from these screenshots.

The final heading copy measures 1804 words at rest in each Connections place, so each allowance is 1810 rather than the historical 1800/1830 checkpoints above. Onboarding remains 1148 measured/1150 allowed; firstTotal is 8950. Every rise from wave 4 is listed in the PR draft, and the complete current budget suite passed 28/28 in `results/w5-final-words-green.txt`. The baseline, ink.md and PR table agree. No other place allowance rises, and no completed native Hindi review is claimed.

Final frozen-source types, syntax, build/full UI, required native reruns, replacement walk/publish, integration commit, PR and Ubuntu/Windows CI are still outstanding. Prior six-shard results remain exactly as recorded in the preceding checkpoint: shards 2, 5 and 6 passed; shard 1 and4 retain repaired failures pending full reruns; shard 3 retains the founder-local architecture-copy mismatch. The prior 2948/2948 full UI pass also predates these last repairs. This entry supersedes earlier work-in-progress and word-count descriptions without changing their historical receipts.


### Current walk published and bounded cold review closed, 29 October 2026

The replacement main walk completed 488/488 checks with zero automated failures at `2026-10-29T13:03:35.424Z`. Publish-only copied the same 52 verified images to the local gallery, with no new capture or external publication. `results/w5-publish-current-description-final.txt` records the final publication. The previous successful pre-repair walk remains archived in `results/w5-main-walk-before-cold-fixes`.

The independent cold reviewer opened 21 affected current PNGs and closed all four main-walk findings; see `results/w5-cold-main-walk.md`. The review is bounded: phone Connections images end at the 9000-pixel capture limit before the lower cards. The revised browser-posting headings and YouTube card were independently confirmed on desktop, not in their uncaptured phone/Hindi region. The earlier desk findings remain closed in 16 focused images. No whole-app manual coverage, exact contrast ratio or live connector qualification is inferred.

The documentation generator now separates the current report from historical wave-three/four fixes and manual-review notes. It describes current measured allowances and the PR's listed rises. The 470 contrast nodes that axe could not decide are explicitly neither violations nor proof of compliance; no assertion remains that all were manually checked or meet a universal ratio. Root independently passed spec then quality for the generator and generated WALK. Counters, screenshots and product behavior are unchanged.

The initial final UI type gate exposed a declaration mismatch: WorkReceiptLite omitted required minor/currency strings already returned by the native and fake stored receipt. The declaration and typed test fixtures now match that actual contract. Existing settlement proof guards, computed values and approval behavior are unchanged. Root separate spec/quality PASS follows six compiler errors, fresh UI typecheck exit 0 and 26/26 focused checks. See `results/w5-work-figure-contract-review.md` and `results/w5-work-figure-contract-green.txt`. The original failed gate remains in `results/w5-final-before-type-repair-status.json` and `results/w5-final-before-type-repair-ui.txt`; this repair has no behavior or pixel effect.

The final pipeline restarted after that repair and is still running in `results/w5-final-gate-status.json`. Prior historical shard statuses remain unchanged, and no final full UI/engine suite or CI success is claimed. Keep the PR's FINAL_VALIDATION_PENDING placeholder until actual final receipts are available. Integration commit, push, PR creation and Ubuntu/Windows CI remain outstanding.


### Final local integration validation

29 October 2026, pre-PR local integration checkpoint. All 39 planned packages are implemented and committed through R6 `da38c076`, with independent spec and quality review. Batch-one findings and 5A1 nits are closed. The reviewed shared integration is ready for its commit. The older checkpoints above are historical.

Final native/UI typechecks, syntax for 2,892 source files and production UI build pass. The complete current UI suite passes 2977/2977 across 297 files, with no skips or todos. The final source fixes include required raw amount/currency fields in WorkReceiptLite and an exact three-step Editor test expectation; neither changes runtime behavior or verified pixels. Their original failed attempts are preserved, with independent acceptance and focused 26/26 and 31/31 checks.

All six engine shards ran sequentially with C-drive temp and one test-file inventory. Shards 1, 2, 4, 5 and 6 pass after full reruns of 1 and 4. Shard 3 is 1491/1492 with only the documented founder-local architecture-copy comparison; no assertion or external file was altered. Exact receipts are `results/w5-shard-N.json` and `results/w5-final-gate-status.json`. These local results are not a blanket all-six-green claim.

The final main walk passes 488/488 at `2026-10-29T13:03:35.424Z`; publish-only copies 52 images. Independent cold review closes the four main-walk findings in 21 current images and the earlier desk findings in 16 focused images, following 69 full-App entry captures and selected populated views. Phone Connections images stop at 9000 px before the lower cards, so those headings were visually confirmed on desktop only. The published report separates current and historical results and records 470 automatically undecided contrast nodes without claiming every node was manually checked. Detailed review receipts remain in `results/w5-cold-main-walk.md`, `results/w5-cold-final-first12.md` and `results/w5-cold-final-last11.md`.

Word budgets are measured 1804/allowed 1810 for each Connections place and 1148/1150 for onboarding; firstTotal 8950. All 28 budget checks pass. Every rise is listed in the PR for founder confirmation. Machine-drafted Hindi remains listed for native review.

The release PR is titled "Ink v2 wave 5: playbooks" with base `b2c/ink-v2-w4`; its live GitHub checks are the authority for Ubuntu/Windows CI status. This checkpoint records local validation before publication and does not claim CI completion. Root package-lock stays excluded. The founder alone merges #5, #6, #7 and #8 and then wave 5. Founder decisions, qualification limits and open questions below remain binding.

### Cross-platform CI fixture follow-up

PR #9 is open on b2c/ink-v2-w4. Its first checks found five native test-fixture failures: the desktop export test assumed the ignored results directory existed on a clean checkout, and four YouTube intake calls supplied Windows paths on Ubuntu. The four affected native test files now use the host's default temporary directory and native path join. Exact source persistence, hashes, approval digests, stale-output refusals, arbitrary-handle refusals and UNC rejection are unchanged. The existing injected editor command is still a deterministic test port, not a qualified external editor. Existing CI failures are preserved in results/ci-first-push-ubuntu-2, ci-first-pr-ubuntu-5 and ci-first-push-windows-2. Local default C-temp focused checks pass 13/13. Root separate spec then quality review passed.

The Ubuntu UI job found one oracle mismatch: the browser rehearsal explicitly models Windows paths, while its native comparison inherited the runner's platform. The isolated child oracle now selects Windows for that comparison after importing under the real host. A separate test checks both Windows and POSIX valid paths, relative paths, network-share refusals and bad extensions, retaining complete exact result/error equality. The actual localPathProblem selector and intake boundary were inspected; neither normalizes paths nor touches files. The original Ubuntu mismatch was reproduced before repair; all eight focused tests pass. Root separate spec then quality review passed. Only test code changed, so product behavior and the verified screenshots remain unchanged.

Eight initial PR jobs also failed before tests because npm returned 404 for the newly selected rolldown 1.2.16 archive. The same official URL subsequently returned HTTP 200. No dependency override, root lockfile or production workaround was added. The next pushed head receives complete Ubuntu and Windows CI; live results are on PR #9, and earlier failed attempts remain preserved.
