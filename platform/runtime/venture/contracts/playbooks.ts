// Venture playbooks contract. Types only; public imports use ../contracts.ts.
import type { CompositionRecord } from '../onboarding-contracts.ts';
import type { IntakeValue, StartTile } from '../playbooks/kit/define.ts';
import type { GoNoGoBody, SalesProposalBody, SharePrice } from '../playbooks/kit/records-sales.ts';
import type { AssetBody, BrandKitBody, VoiceConsentBody } from '../playbooks/kit/records-media.ts';
import type { ReportBody, ReportShareBody } from '../playbooks/kit/records-report.ts';
import type { LocalAppBody, MonitorBody } from '../build/records-connect.ts';
import type { YoutubeDictionaryBody, YoutubeEditBody, YoutubeStyleBody } from '../playbooks/youtube/records.ts';
import type { CaCitationsBody, CaDataPackBody, CaDifferentialBody } from '../playbooks/ca-firm/records.ts';
import type { AdLedgerEntryBody, InfluencerCaseBody, SocialInboxItemBody } from '../playbooks/social/records.ts';
import type { SocialScheduledBody } from '../playbooks/social/scheduled-core.ts';
import type { SeoFindingBody, SeoObservationBody, SeoPanelBody } from '../playbooks/seo-visibility/records.ts';
import type { SellerCaseBody, SellerFeecardBody, SellerMovementBody, SellerSkuBody, SellerStageBody } from '../playbooks/online-seller/records.ts';
import type { SupportMessageBody, SupportRatingBody, SupportRequestBody, SupportTicketBody } from '../playbooks/support-desk/records.ts';
import type { RecruitCandidateBody, RecruitInterviewBody, RecruitRoleBody, RecruitTouchBody } from '../playbooks/recruiting-desk/records.ts';
import type { CareerFactBody, CareerListingBody, CareerThreadBody } from '../playbooks/job-search-desk/records.ts';
import type { GlossaryBody, TranslationJobBody, TranslationSegmentBody } from '../playbooks/translation-studio/records.ts';
import type { BooksPostingBody, CollectionStageBody, PromiseToPayBody } from '../playbooks/bookkeeping-cfo/records.ts';
import type { ArticleLedgerBody } from '../playbooks/podcast-to-article/records.ts';
import type { LeadSourceBody } from '../playbooks/lead-generation/records.ts';
import type { NewsletterContactBody, NewsletterIssueBody } from '../playbooks/newsletter-studio/records.ts';
import type { TenderQuestionBody } from '../playbooks/tender-desk/records.ts';
import type { SiteReleaseBody, SiteRequirementBody } from '../playbooks/website-studio/records.ts';
import type { NarrationSegmentBody } from '../playbooks/narration-studio/records.ts';
import type { RoomBriefBody } from '../playbooks/virtual-assistant/records.ts';
import type { EntryRecordBody } from '../playbooks/data-entry-desk/records.ts';
import type { DemoProjectBody } from '../playbooks/app-testing/demo-records.ts';
import type { TestFindingBody } from '../playbooks/app-testing/records.ts';
import type { DevPermissionBody } from '../playbooks/dev-agency/records.ts';
import type { TriageChannelBody } from '../playbooks/it-triage/records.ts';
import type { WatchSourceBody } from '../playbooks/monitored-data/records.ts';
import type { DocumentBody } from '../playbooks/document-desk/records.ts';
import type { SignoffBody } from '../playbooks/signoff-desk/records.ts';
import type { TradeJournalBody } from '../playbooks/trading-journal/records.ts';
import type { CallLogBody } from '../playbooks/phone-receptionist/records.ts';
import type { LessonBatchRecordBody } from '../playbooks/lesson-desk/records.ts';
import type { BookingRecordBody, BookingSlotRecordBody } from '../playbooks/booking-desk/records.ts';
import type { AgentMessageRecord, AgentNoteChangeRecord, AgentNoteRecord, AgentProposalRecord, AgentRelayRecord, AwayRecord, BillRecord, CalendarFeedRecord, ChatConsentRecord, ChatSettleRecord, ChiefMessageRecord, ChiefThreadRecord, CliCheckRecord, ConnectorCheckRecord, CreditNoteRecord, DecisionRecord, DepartmentId, DraftEditRecord, DrillRunRecord, FileRequestRecord, ForgottenRecord, GoalRecord, HealthClearRecord, IdeaRecord, InboundRecord, InvoiceShareRecord, JournalChainRecord, KeeperRunRecord, KnowledgeRecord, LayoutGoRecord, LayoutRecord, MailboxRecord, NetworkImportRecord, NetworkSearchRecord, NotificationRecord, NotifyDigestRecord, NotifySettingsRecord, OpportunityRecord, OrderContractRecord, OutreachRecord, OwnerOfferRecord, OwnerProfileRecord, PauseRecord, PersonRecord, PersonaRecord, PipelineSettingsRecord, ProposalRecord, PushSubscriptionRecord, ReceiptSignatureRecord, RecurringInvoiceRecord, RoutineRecord, RoutineRunRecord, SettingsDraftRecord, SigningKeyRecord, TeamIntroRecord, TieRecord, TriageRuleRecord, VoiceRecord, WriteAllowanceRecord } from './records.ts';
import type { BlueprintRecord, InterviewRecord, IsoDate, IsoTime, RecordBase, TermRecord, VentureRecord, VentureRecordKind } from './business.ts';
import type { ModelCallRecord, ModelConnectionRecord } from './models.ts';
import type { ClientRecord, InvoiceRecord, OrderRecord, PaymentRecord, PriceReceiptRecord } from './money.ts';
import type { AccountantRecord, BankAccountRecord, BankImportRecord, BankMatchRecord, BriefRecord, BuildFollowRecord, CaPackOrderRecord, CaPackRecord, ChannelHoldRecord, ClientAiDefaultRecord, ConnectorPostRecord, GitHubReadRecord, HandoffRecord, JournalRecord, JudgeSettingRecord, LeadRecord, LeadSettingsRecord, OpenPostingAccountRecord, PostingStepsRecord, ScreenSettingRecord, SiteEditRecord, UntrustedReleaseRecord } from './build.ts';
import type { DelegateRunRecord, DeliveryRunRecord, ImprovementRunRecord, PlaybookRecord, SignalRecord, SimulationRunRecord, UploadRecord, WorkReceiptRecord, WorkTableRecord } from './delivery.ts';
import type { AgentPostureRecord, EvidenceRecord, QueueDecisionRecord, QueueViewMarkRecord, SpotCheckRecord, TeamGateRecord, VentureEventRecord } from './queue.ts';
import type { SpendPolicyRecord, SpendQuoteRecord, SpendRecord } from './spend.ts';
import type { AgentRetirementRecord, FeedbackItemRecord, FeedbackSettingRecord, MiniAppRecord, PostingLimitsRecord, ShareLinkStoredRecord, SumReceiptRecord, TalkHeardRecord, TalkSettingRecord, TranscriptionSetupRecord } from './views.ts';

// ---------------------------------------------------------------------------
// 9f. Ink v2 wave 5 (named by package 5-0). Each record is RecordBase<kind> & Body, Body from the owning package's
// records file (a placeholder there until the package lands). The new shared types: Department is wave 4's DepartmentId;
// StartTile and IntakeValue are 5A1's (playbooks/kit/define.ts); SharePrice is 5A2's (playbooks/kit/records-sales.ts).
// ---------------------------------------------------------------------------

export type Department = DepartmentId;

export type { IntakeValue, SharePrice, StartTile };

// The kit (5A2, 5A4, 5A5, 5A6)
export type GoNoGoRecord = RecordBase<'venture-go-no-go'> & GoNoGoBody & { /** C4 (T25): the owner took the card off the list. */ removedAt?: IsoTime };

/** 5A2: a sales proposal drafted for a client or a pipeline person (playbooks/kit/records-sales.ts SalesProposalBody). */
export type SalesProposalRecord = RecordBase<'venture-sales-proposal'> & SalesProposalBody;

export type BrandKitRecord = RecordBase<'venture-brand-kit'> & BrandKitBody;

export type AssetRecord = RecordBase<'venture-asset'> & AssetBody;

export type VoiceConsentRecord = RecordBase<'venture-voice-consent'> & VoiceConsentBody;

export type ReportRecord = RecordBase<'venture-report'> & ReportBody;

export type ReportShareRecord = RecordBase<'venture-report-share'> & ReportShareBody;

export type MonitorRecord = RecordBase<'venture-monitor'> & MonitorBody;

export type LocalAppRecord = RecordBase<'venture-local-app'> & LocalAppBody;

// The flagships (5B, 5C, 5D)
export type YoutubeEditRecord = RecordBase<'venture-youtube-edit'> & YoutubeEditBody;

export type YoutubeDictionaryRecord = RecordBase<'venture-youtube-dictionary'> & YoutubeDictionaryBody;

export type YoutubeStyleRecord = RecordBase<'venture-youtube-style'> & YoutubeStyleBody;

export type CaCitationsRecord = RecordBase<'venture-ca-citations'> & CaCitationsBody;

export type CaDifferentialRecord = RecordBase<'venture-ca-differential'> & CaDifferentialBody;

export type CaDataPackRecord = RecordBase<'venture-ca-data-pack'> & CaDataPackBody;

export type CaWorkingRecord = RecordBase<'venture-ca-working'> & import('../playbooks/ca-firm/work-core.ts').CaWorkingBody;

export type SocialScheduledRecord = RecordBase<'venture-social-scheduled'> & SocialScheduledBody;

export type SocialInboxItemRecord = RecordBase<'venture-social-inbox-item'> & SocialInboxItemBody;

export type AdLedgerEntryRecord = RecordBase<'venture-ad-ledger-entry'> & AdLedgerEntryBody;

export type InfluencerCaseRecord = RecordBase<'venture-influencer-case'> & InfluencerCaseBody;

// The new playbooks (5E to 5R)
export type SeoPanelRecord = RecordBase<'venture-seo-panel'> & SeoPanelBody;

export type SeoObservationRecord = RecordBase<'venture-seo-observation'> & SeoObservationBody;

export type SeoFindingRecord = RecordBase<'venture-seo-finding'> & SeoFindingBody;

export type SellerSkuRecord = RecordBase<'venture-seller-sku'> & SellerSkuBody;

export type SellerFeecardRecord = RecordBase<'venture-seller-feecard'> & SellerFeecardBody;

export type SellerStageRecord = RecordBase<'venture-seller-stage'> & SellerStageBody;

export type SellerMovementRecord = RecordBase<'venture-seller-movement'> & SellerMovementBody;

export type SellerCaseRecord = RecordBase<'venture-seller-case'> & SellerCaseBody;

export type SupportTicketRecord = RecordBase<'venture-support-ticket'> & SupportTicketBody;

export type SupportMessageRecord = RecordBase<'venture-support-message'> & SupportMessageBody;

export type SupportRequestRecord = RecordBase<'venture-support-request'> & SupportRequestBody;

export type SupportRatingRecord = RecordBase<'venture-support-rating'> & SupportRatingBody;

export type RecruitRoleRecord = RecordBase<'venture-recruit-role'> & RecruitRoleBody;

export type RecruitCandidateRecord = RecordBase<'venture-recruit-candidate'> & RecruitCandidateBody;

export type RecruitTouchRecord = RecordBase<'venture-recruit-touch'> & RecruitTouchBody;

export type RecruitInterviewRecord = RecordBase<'venture-recruit-interview'> & RecruitInterviewBody;

export type CareerFactRecord = RecordBase<'venture-career-fact'> & CareerFactBody;

export type CareerListingRecord = RecordBase<'venture-career-listing'> & CareerListingBody;

export type CareerThreadRecord = RecordBase<'venture-career-thread'> & CareerThreadBody;

export type TranslationJobRecord = RecordBase<'venture-translation-job'> & TranslationJobBody;

export type TranslationSegmentRecord = RecordBase<'venture-translation-segment'> & TranslationSegmentBody;

export type GlossaryRecord = RecordBase<'venture-glossary'> & GlossaryBody;

export type PromiseToPayRecord = RecordBase<'venture-promise-to-pay'> & PromiseToPayBody;

export type CollectionStageRecord = RecordBase<'venture-collection-stage'> & CollectionStageBody;

export type BooksPostingRecord = RecordBase<'venture-books-posting'> & BooksPostingBody;

export type ArticleLedgerRecord = RecordBase<'venture-article-ledger'> & ArticleLedgerBody;

export type LeadSourceRecord = RecordBase<'venture-lead-source'> & LeadSourceBody;

export type NewsletterIssueRecord = RecordBase<'venture-newsletter-issue'> & NewsletterIssueBody;

export type NewsletterContactRecord = RecordBase<'venture-newsletter-contact'> & NewsletterContactBody;

export type TenderQuestionRecord = RecordBase<'venture-tender-question'> & TenderQuestionBody;

export type SiteRequirementRecord = RecordBase<'venture-site-requirement'> & SiteRequirementBody;

export type SiteReleaseRecord = RecordBase<'venture-site-release'> & SiteReleaseBody;

export type NarrationSegmentRecord = RecordBase<'venture-narration-segment'> & NarrationSegmentBody;

export type RoomBriefRecord = RecordBase<'venture-room-brief'> & RoomBriefBody;

export type EntryRecordRecord = RecordBase<'venture-entry-record'> & EntryRecordBody;

export type DemoProjectRecord = RecordBase<'venture-demo-project'> & DemoProjectBody;

export type TestFindingRecord = RecordBase<'venture-test-finding'> & TestFindingBody;

export type DevPermissionRecord = RecordBase<'venture-dev-permission'> & DevPermissionBody;

export type TriageChannelRecord = RecordBase<'venture-triage-channel'> & TriageChannelBody;

export type WatchSourceRecord = RecordBase<'venture-watch-source'> & WatchSourceBody;

export type CallLogRecord = RecordBase<'venture-call-log'> & CallLogBody;

/** Wave 6 (6C5 / D20): the owner ticked "I am responsible for this in my business" for one locked rule, on a day. Withdrawn by setting withdrawnAt. */
export type RuleAttestationRecord = RecordBase<'venture-rule-attestation'> & {
  ruleId: string; playbookId: string; digest: string; attestedOn: IsoDate; memberId: string; withdrawnAt: string | null; withdrawnOn: IsoDate | null;
};

/** Wave 6 (6C6 / D5): the owner's profession, their answer to the side-work question, and what its regulator switches off. */
/** Wave 6 (6E4): one client document on the document desk (playbooks/document-desk/records.ts). */
export type DocumentRecord = RecordBase<'venture-document'> & DocumentBody;

/** Wave 6 (6E5): one sign-off desk entry (playbooks/signoff-desk/records.ts). */
export type SignoffRecord = RecordBase<'venture-signoff'> & SignoffBody;

/** Wave 6 (6E2): one lesson batch with its learners, classes, work and parent messages (playbooks/lesson-desk/records.ts). */
export type LessonBatchRecord = RecordBase<'venture-lesson-batch'> & LessonBatchRecordBody;

/** Wave 6 (6E3): an open slot and a booking on the booking desk (playbooks/booking-desk/records.ts). */
export type BookingSlotRecord = RecordBase<'venture-booking-slot'> & BookingSlotRecordBody;

export type BookingRecord = RecordBase<'venture-booking'> & BookingRecordBody;

/** Wave 6 (6G3, D44): one field change, a company, a company link, a logged timeline entry, a list and a list entry. */
export type CrmChangeRecord = RecordBase<'venture-crm-change'> & import('../crm/crm-data.ts').CrmChangeBody;

export type CompanyRecord = RecordBase<'venture-company'> & import('../crm/crm-data.ts').CompanyBody;

export type CrmLinkRecord = RecordBase<'venture-crm-link'> & import('../crm/crm-data.ts').CrmLinkBody;

export type CrmEntryRecord = RecordBase<'venture-crm-entry'> & import('../crm/crm-data.ts').CrmEntryBody;

export type CrmListRecord = RecordBase<'venture-crm-list'> & import('../crm/crm-data.ts').CrmListBody;

export type CrmListItemRecord = RecordBase<'venture-crm-list-item'> & import('../crm/crm-data.ts').CrmListItemBody;

/** Wave 6 (6G4, D44): one dated fact Chausar remembers (memory/facts-data.ts). */
export type MemoryFactRecord = RecordBase<'venture-memory-fact'> & import('../memory/facts-data.ts').MemoryFactBody;

/** Wave 6 (6E7): one trading journal entry (playbooks/trading-journal/records.ts). */
export type TradeJournalRecord = RecordBase<'venture-trade-journal'> & TradeJournalBody;

/** Wave 6 (6F2): an owner-added playbook pack (packs/packs.ts). */
export type PackRecord = RecordBase<'venture-pack'> & import('../packs/packs.ts').PackRecordBody;

/** Wave 6 (6F9): one Sunra generation, its code-computed rupee quote and rights record (media/sunra.ts). */
export type MediaGenerationRecord = RecordBase<'venture-media-generation'> & import('../media/sunra.ts').MediaGenerationBody;

export type ComplianceRecord = RecordBase<'venture-compliance'> & {
  professionId: string; sideWork: 'no-day-job' | 'allowed' | 'not-allowed' | 'not-sure'; acknowledgedOn: IsoDate; digest: string; switchedOff: string[]; memberId: string;
  /** W6 (3 November 2026): the owner's size ranges, by measure; null or left out (records before it) when none. */
  size?: import('../core/business-size.ts').SizeAnswers | null;
};

export type AnyVentureRecord =
  | VentureRecord | InterviewRecord | BlueprintRecord | TermRecord | ModelConnectionRecord | ModelCallRecord
  | PriceReceiptRecord | ClientRecord | OrderRecord | InvoiceRecord | PaymentRecord
  | BriefRecord | HandoffRecord | BuildFollowRecord | GitHubReadRecord
  | PlaybookRecord | SimulationRunRecord | DeliveryRunRecord | SignalRecord | VentureEventRecord
  | UploadRecord | WorkTableRecord | WorkReceiptRecord | ImprovementRunRecord | DelegateRunRecord | CompositionRecord
  | ConnectorPostRecord | SiteEditRecord
  | SpendRecord | SpendQuoteRecord | SpendPolicyRecord
  | QueueDecisionRecord | TeamGateRecord
  | EvidenceRecord
  | AgentPostureRecord | SpotCheckRecord
  | JournalRecord
  | CaFirmRecord
  | BankAccountRecord | BankImportRecord | LeadRecord | LeadSettingsRecord
  | SumReceiptRecord | ShareLinkStoredRecord
  | ChannelHoldRecord
  | ScreenSettingRecord | UntrustedReleaseRecord
  | PostingStepsRecord | BankMatchRecord | PostingLimitsRecord
  | JudgeSettingRecord | ClientAiDefaultRecord | AccountantRecord | CaPackOrderRecord | CaPackRecord
  | TranscriptionSetupRecord
  | TalkSettingRecord
  | TalkHeardRecord
  | FeedbackSettingRecord
  | FeedbackItemRecord
  // Ink v2 wave 4 (section 9e)
  | KeeperRunRecord | HealthClearRecord
  | AgentMessageRecord | AgentProposalRecord | ChatConsentRecord
  | AgentNoteRecord | AgentNoteChangeRecord
  | ChiefThreadRecord | ChiefMessageRecord | ProposalRecord
  | ChatSettleRecord
  | LayoutRecord | LayoutGoRecord | TeamIntroRecord
  | PersonRecord | NetworkImportRecord | ForgottenRecord
  | TieRecord | NetworkSearchRecord
  | OpportunityRecord | PipelineSettingsRecord
  | OutreachRecord
  | MailboxRecord | InboundRecord | CalendarFeedRecord
  | AwayRecord | PauseRecord
  | WriteAllowanceRecord
  | NotificationRecord | NotifySettingsRecord | NotifyDigestRecord
  | PushSubscriptionRecord
  | CliCheckRecord
  | GoalRecord
  | DecisionRecord
  | DraftEditRecord | TriageRuleRecord | SettingsDraftRecord | QueueViewMarkRecord
  | BillRecord | CreditNoteRecord | RecurringInvoiceRecord
  | ConnectorCheckRecord | FileRequestRecord
  | OwnerProfileRecord | OwnerOfferRecord
  | SigningKeyRecord | JournalChainRecord | ReceiptSignatureRecord
  | OrderContractRecord | AgentRelayRecord
  | RoutineRecord | RoutineRunRecord
  | DrillRunRecord
  | VoiceRecord | PersonaRecord
  | KnowledgeRecord | IdeaRecord
  // Ink v2 wave 5 (section 9f)
  | GoNoGoRecord | SalesProposalRecord | BrandKitRecord | AssetRecord | VoiceConsentRecord | ReportRecord | ReportShareRecord | MonitorRecord | LocalAppRecord
  | YoutubeEditRecord | YoutubeDictionaryRecord | YoutubeStyleRecord
  | CaCitationsRecord | CaDifferentialRecord | CaDataPackRecord | CaWorkingRecord
  | OpenPostingAccountRecord | SocialScheduledRecord | SocialInboxItemRecord | AdLedgerEntryRecord | InfluencerCaseRecord
  | SeoPanelRecord | SeoObservationRecord | SeoFindingRecord
  | SellerSkuRecord | SellerFeecardRecord | SellerStageRecord | SellerMovementRecord | SellerCaseRecord
  | SupportTicketRecord | SupportMessageRecord | SupportRequestRecord | SupportRatingRecord
  | RecruitRoleRecord | RecruitCandidateRecord | RecruitTouchRecord | RecruitInterviewRecord
  | CareerFactRecord | CareerListingRecord | CareerThreadRecord
  | TranslationJobRecord | TranslationSegmentRecord | GlossaryRecord
  | PromiseToPayRecord | CollectionStageRecord | BooksPostingRecord
  | ArticleLedgerRecord | LeadSourceRecord | NewsletterIssueRecord | NewsletterContactRecord | TenderQuestionRecord
  | SiteRequirementRecord | SiteReleaseRecord | NarrationSegmentRecord | RoomBriefRecord | EntryRecordRecord
  | TestFindingRecord | DemoProjectRecord | DevPermissionRecord | WatchSourceRecord | TriageChannelRecord | CallLogRecord
  | RuleAttestationRecord | ComplianceRecord | TradeJournalRecord
  | PackRecord | MediaGenerationRecord
  | DocumentRecord | SignoffRecord
  | LessonBatchRecord | BookingSlotRecord | BookingRecord
  | CrmChangeRecord | CompanyRecord | CrmLinkRecord | CrmEntryRecord | CrmListRecord | CrmListItemRecord | MemoryFactRecord
  | AgentRetirementRecord
  | MiniAppRecord
  | import('../flows/records.ts').FlowRecord | import('../flows/records.ts').FlowRunRecord
  | InvoiceShareRecord
  | import('../trackers/trackers.ts').TrackerRecord | import('../trackers/trackers.ts').TrackerRowRecord
  | import('../agents/hire-store.ts').HireRecord
  | import('../build/event-triggers.ts').RelayEventRecord;

export type RecordOf<K extends VentureRecordKind> = Extract<AnyVentureRecord, { kind: K }>;

/**
 * The AI-native CA firm playbook (P3-ca-firm, venture/playbooks/ca-firm/signoff.ts). Append-only entries: the CA of
 * record (the newest wins); regulated papers waiting for a CA sign-off; an item sent to the CA (a sign-off request id,
 * or 'rate:<table id>@<version>' for a rate table); the CA's recorded sign-off or return, with name, ICAI membership
 * number, the receipts and the playbook hash it covered; and the CA's confirmation of one rate-table version by hash.
 */
export type CaFirmRecord = RecordBase<'venture-ca-firm'> & (
  | { entry: 'ca-of-record'; name: string; membershipNumber: string; firmName: string | null; firmRegistrationNumber: string | null }
  | { entry: 'signoff-request'; subjectKind: 'gst-working' | 'tds-working' | 'itr-data-pack' | 'letter' | 'audit-papers'; title: string; clientName: string | null; workingDigest: string; receiptIds: string[]; playbookHash: string | null; /** The delivery run whose draft the papers are; absent on requests made outside a run. */ deliveryId?: string | null }
  | { entry: 'sent-to-ca'; itemKey: string; caName: string; membershipNumber: string; sentBy: string }
  | { entry: 'signoff'; receiptDigests?: { id: string; digest: string | null }[]; requestId: string; decision: 'signed' | 'returned'; caName: string; membershipNumber: string; workingDigest: string; receiptIds: string[]; playbookHash: string | null; note: string | null; recordedBy: string }
  | { entry: 'rate-confirmation'; tableId: string; tableVersion: number; tableHash: string; caName: string; membershipNumber: string; recordedBy: string }
  /** The CA of record's explanation of one portal difference on a stored portal-diff receipt (Ink v2 2A2); the newest per key wins. */
  | { entry: 'diff-explanation'; receiptId: string; key: string; note: string; caName: string; membershipNumber: string; recordedBy: string }
);
