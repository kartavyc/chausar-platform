// Chausar venture launcher: shared contracts.
// Every type, record kind, RPC method name, payload and result shape used by the venture packages.
// Erasable TypeScript only (Node type stripping): no enum, no namespace, no parameter properties.
// Owned by package P0. Other packages import from here and never redefine these shapes.
import type { Context, StateStore } from '../contracts.ts';
import type {
  ApprovalBlockId, ComposeAttachmentNote, ComposedNote, ComposedPage, ComposeModelOutput, CompositionRecord, DecideModelOutput, DraftHandoverPort,
  OfferBlockId, OnboardingPayloads, OnboardingResults, PlanKind, StepBlockId, ToolBlockId, ViewSelection,
} from './onboarding-contracts.ts';
import type { FootageRights, RightsBasis } from './delivery/rights.ts';
import type { BankAlert, BankAlertRule, BankAlertRuleInput } from './build/bank.ts';
import type { NetResolver, PinnedSender } from './core/net-guard.ts';
import type { TlsConnector } from './network/imap.ts';
import type { SectionRef, TableStamp } from './playbooks/ca-firm/rates.ts';
import type { CaEngine, CaReceiptStep } from './playbooks/ca-firm/receipt.ts';
import type { SocialChannel } from './playbooks/social/channels.ts';
import type { ReportReceipt } from './playbooks/social/report.ts';
import type { FfmpegPort } from './playbooks/youtube/finishing.ts';
// Ink v2 wave 5 (package 5-0): each wave 5 record's body and each method's own shapes live in the owning package's
// records file, as placeholders until that package lands; the package replaces them there, not here.
import type { IntakeValue, KitIntakeField, StartTile } from './playbooks/kit/define.ts';
import type { OrderChainView } from './playbooks/kit/records-chain.ts';
import type { GoNoGoBody, GoNoGoCardView, GoNoGoInputs, GoNoGoListView, SalesPilotTerms, SalesProposalBody, SalesProposalView, SharePrice } from './playbooks/kit/records-sales.ts';
import type { IdeaAddedView, IdeaGrade, IdeaGradedView, IdeaMovedView, IdeaPipeline, IdeaStage, PipelineIdeaView } from './playbooks/kit/records-rules.ts';
import type {
  AssetBody, AssetRerunView, AssetReuseView, AssetsView, BrandKitBody, BrandKitInput, BrandKitView, VoiceConsentBody, VoiceConsentsView, VoiceConsentView,
} from './playbooks/kit/records-media.ts';
import type { PrintPort, ReportBody, ReportFormat, ReportListView, ReportShareBody, ReportShareView, ReportView } from './playbooks/kit/records-report.ts';
import type {
  LocalAppBody, LocalAppPort, LocalAppsView, MailAttachment, MailImportView, MailThreadsView, MonitorBody, MonitorInput, MonitorsView, MonitorView, SpeechProvidersView, WebhookKind, WebhookView,
} from './build/records-connect.ts';
import type { YoutubeDictionaryBody, YoutubeEditBody, YoutubeStyleBody } from './playbooks/youtube/records.ts';
import type {
  CaCitationsBody, CaDataPackBody, CaDifferentialBody, CitationsConfirmView, DataPackExportView, DifferentialAddView, SignoffCheckView,
} from './playbooks/ca-firm/records.ts';
import type { AdLedgerEntryBody, InfluencerCaseBody, SocialInboxItemBody } from './playbooks/social/records.ts';
import type { SeoFindingBody, SeoObservationBody, SeoPanelBody } from './playbooks/seo-visibility/records.ts';
import type { SellerCaseBody, SellerFeecardBody, SellerMovementBody, SellerSkuBody, SellerStageBody } from './playbooks/online-seller/records.ts';
import type { SupportMessageBody, SupportRatingBody, SupportRequestBody, SupportTicketBody } from './playbooks/support-desk/records.ts';
import type { RecruitCandidateBody, RecruitInterviewBody, RecruitRoleBody, RecruitTouchBody } from './playbooks/recruiting-desk/records.ts';
import type { CareerFactBody, CareerListingBody, CareerThreadBody } from './playbooks/job-search-desk/records.ts';
import type { GlossaryBody, TranslationJobBody, TranslationSegmentBody } from './playbooks/translation-studio/records.ts';
import type { BooksPostingBody, CollectionStageBody, PromiseToPayBody } from './playbooks/bookkeeping-cfo/records.ts';
import type { ArticleLedgerBody } from './playbooks/podcast-to-article/records.ts';
import type { LeadSourceBody } from './playbooks/lead-generation/records.ts';
import type { NewsletterContactBody, NewsletterIssueBody } from './playbooks/newsletter-studio/records.ts';
import type { TenderQuestionBody } from './playbooks/tender-desk/records.ts';
import type { SiteReleaseBody, SiteRequirementBody } from './playbooks/website-studio/records.ts';
import type { NarrationSegmentBody } from './playbooks/narration-studio/records.ts';
import type { RoomBriefBody } from './playbooks/virtual-assistant/records.ts';
import type { EntryRecordBody } from './playbooks/data-entry-desk/records.ts';
import type { TestFindingBody } from './playbooks/app-testing/records.ts';
import type { DevPermissionBody } from './playbooks/dev-agency/records.ts';
import type { WatchSourceBody } from './playbooks/monitored-data/records.ts';
import type { CallLogBody } from './playbooks/phone-receptionist/records.ts';
import type { DeskActPayload, DeskActView, DeskGetPayload, DeskItemView, DeskListPayload, DeskListView } from './playbooks/desk-types.ts';

export const VENTURE_CONTRACT_VERSION = 'chausar.dev/venture/v1alpha1' as const;

// ---------------------------------------------------------------------------
// 1. Primitives
// ---------------------------------------------------------------------------

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** Calendar date, 'YYYY-MM-DD'. */
export type IsoDate = string;
/** Instant, ISO 8601 with 'Z'. */
export type IsoTime = string;
/** Integer amount in the currency's minor unit, as decimal text. Never a JS number. */
export type MinorString = string;
/** Integer basis points as decimal text. '1800' is 18 percent. A CGST or SGST invoice line holds half the rate, so half of an odd rate reads 'n.5'. */
export type BpsString = string;
/** Integer millionths of a currency unit as decimal text. Used for model costs only. */
export type MicroString = string;

/** Who said a line, and how sure it is. Shown next to every blueprint line. */
export type LineLabel = 'told-by-you' | 'assumption' | 'computed';
export type LineAuthor = 'owner' | 'model' | 'template' | 'engine';
/** estimate: true when the model wrote a number in the line; shown as a model estimate, never with a receipt. */
export type Labelled<T> = { value: T; label: LineLabel; by: LineAuthor; estimate?: true };

// ---------------------------------------------------------------------------
// 2. Countries (data owned by P1, copied into the venture record at create)
// ---------------------------------------------------------------------------

export type CountryCode = string; // ISO 3166-1 alpha-2, upper case; 'XX' is "another country"
export type TaxMode = 'gst' | 'vat' | 'sales-tax' | 'none';
export type DateOrder = 'day-month-year' | 'month-day-year' | 'year-month-day';
export type CountryProfile = {
  code: CountryCode;
  name: string;
  currency: string; // ISO 4217
  minorDigits: number; // from currencyMinorDigits(currency)
  region: 'india' | 'global';
  tax: {
    mode: TaxMode;
    label: string; // 'GST', 'VAT', 'Sales tax', 'Consumption tax', 'Tax'
    standardRateBps: BpsString; // prefill for the owner's rate; '0' when it varies by place or is unknown
    registrationNote: string; // plain sentence, never advice
    idLabel: string; // 'GSTIN', 'VAT number', 'ABN' ...; '' when invoiceKind is 'invoice'
    idPattern: string | null; // RegExp source for the registration number; null for IN (GSTIN checksum) and when idLabel is ''
    invoiceKind: 'tax-invoice' | 'invoice'; // 'tax-invoice' for gst and vat countries
    checkedOn: IsoDate;
  };
  paymentRails: string[]; // connector ids, first is the default
  dateOrder: DateOrder;
  complianceNotes: string[];
};

/** India GST state codes (first two digits of a GSTIN) and their names. Used for place of supply. */
export const INDIA_STATES: Readonly<Record<string, string>> = Object.freeze({
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
});

// ---------------------------------------------------------------------------
// 3. Service types, the venture record, terms, checklist
// ---------------------------------------------------------------------------

export const SERVICE_TYPES = ['agency', 'studio', 'consulting', 'bookkeeping', 'research', 'content', 'support', 'other'] as const;
export type ServiceType = typeof SERVICE_TYPES[number];
/** Plain labels for each service type. P1 uses them in templates, P4 in brief line one, P7 on screens. */
export const SERVICE_TYPE_LABELS: Readonly<Record<ServiceType, string>> = Object.freeze({
  agency: 'Marketing agency', studio: 'Creative studio', consulting: 'Consulting practice', bookkeeping: 'Bookkeeping studio',
  research: 'Research desk', content: 'Content shop', support: 'Support team for hire', other: 'Service business',
});

export const LAUNCH_STAGES = ['rehearsal', 'shadow', 'approve-each', 'approve-sample', 'auto-spot-check'] as const;
export type LaunchStage = typeof LAUNCH_STAGES[number];

export type VentureStatus = 'interview' | 'blueprint' | 'build' | 'rehearsal' | 'live';

export const VENTURE_RECORD_KINDS = [
  'venture-record', 'venture-interview', 'venture-blueprint', 'venture-term',
  'venture-model-connection', 'venture-model-call',
  'venture-price-receipt', 'venture-client', 'venture-order', 'venture-invoice', 'venture-payment',
  'venture-brief', 'venture-handoff', 'venture-build-follow', 'venture-build-read',
  'venture-playbook', 'venture-simulation-run', 'venture-delivery-run', 'venture-signal',
  'venture-event',
  // Delivery harness (section 8b): client files, tables the agent's tools made, work receipts, improvement runs.
  'venture-upload', 'venture-work-table', 'venture-work-receipt', 'venture-improvement-run',
  // Heavy work: what the owner's own Claude Code or Codex left after an approved brief.
  'venture-delegate-run',
  // Onboarding v2: the plan the AI composed from checked blocks before the vault existed.
  'venture-composition',
  // Connectors (P2-connectors): one post the owner approves on its own; one staged website edit.
  'venture-connector-post', 'venture-site-edit',
  // Spend (P2-spend): a charge record per paid call, a quote waiting for the owner, and the owner's rate card and cap.
  'venture-spend', 'venture-spend-quote', 'venture-spend-policy',
  // Ink frontend (P1-A): the owner's decisions on Today's rows, and the auto or hold gate on each agent step.
  'venture-queue-decision', 'venture-team-gate',
  // Evidence ledger (P2-evidence): one claim about a client or business field, its strength and whether it is applied.
  'venture-evidence',
  // Action journal (P2-journal): one outside effect, described, approved with a bound token, then applied or not.
  'venture-journal-entry',
  // Posture (P2-posture): an agent's own posture (it only tightens the business one), and one spot-check decision per run.
  'venture-agent-posture', 'venture-spot-check',
  // AI-native CA firm playbook (P3-ca-firm): the CA of record, rate-table confirmations and recorded CA sign-offs.
  'venture-ca-firm',
  // Bank statements and leads as engine methods: an account with its consent, one record per statement import, one
  // record per lead, and the business's lead settings (postal address and blocklist).
  'venture-bank-account', 'venture-bank-import', 'venture-lead', 'venture-lead-settings',
  // Ink final pass: a receipt for a sum code made from venture records (owed, received, spent), and a client share link.
  'venture-sum-receipt', 'venture-share-link',
  // Posting safety (W1 H19): a security check or a platform block on one posting channel, until cleared or over.
  'venture-channel-hold',
  // The untrusted screen (W1 H9): the business's screen mode, and one record per held content the owner released.
  'venture-screen-setting', 'venture-untrusted-release',
  // Ink v2 wave 2: the day each browser posting step's candidates last matched, and the owner's decision on a bank row.
  'venture-posting-steps', 'venture-bank-match',
  // Ink v2 wave 2 (2B1): the owner's stricter posting limits for one channel; the newest per channel is in use.
  'venture-posting-limits',
  // Ink v2 wave 2 (2C1): whether the judge runs on its own on drafts for a client or the public, and its standing consent.
  'venture-judge-setting',
  // Ink v2 wave 2 (2E2): the owner's whisper.cpp for transcripts made on this computer; the newest is in use.
  'venture-transcription-setup',
  // Ink v2 wave 4 (named by package 4-0, section 9e; each package fills its own). Keeper's runs (4A1); agent threads,
  // proposals and the chat consent (4B1); notes and their changes (4B2); Chats and proposals (4C1); people, imports and
  // forgotten people (4D1); ties (4D2); searches (4D3); pipeline cards and settings (4E1); outreach drafts (4E2); the
  // read-only mailbox and inbound mail (4E3); Away and pause all (4F1); notifications and their settings (4G1); push
  // subscriptions (4G3); CLI checks (4H1); goals (4I1); decisions (4J1); draft edits, the triage rule and settings drafts
  // (4J2); bills, credit notes and recurring invoices (4J5); connection checks and file requests (4J7); the owner
  // profile (4J9); the signing key (4J10); order contracts (4J12); routines and their runs (4J13); drill runs (4J15);
  // voice and persona (4J17); what the AI knows and ideas (4J18). 4A1 added the owner clearing an agent's quarantine.
  'venture-keeper-run', 'venture-health-clear',
  'venture-agent-message', 'venture-agent-proposal', 'venture-chat-consent',
  'venture-agent-note', 'venture-agent-note-change',
  'venture-chief-thread', 'venture-chief-message', 'venture-proposal',
  'venture-person', 'venture-network-import', 'venture-forgotten',
  'venture-tie', 'venture-network-search',
  'venture-opportunity', 'venture-pipeline-settings',
  'venture-outreach',
  'venture-mailbox', 'venture-inbound',
  // 4E3: the private calendar address (its host only; the address is a secret) and the calls that ended lately.
  'venture-calendar-feed',
  'venture-away', 'venture-pause',
  // 4F2: the owner raising one write cap for one day (venture.runs.allowWrites).
  'venture-write-allowance',
  'venture-notification', 'venture-notify-settings', 'venture-notify-digest',
  'venture-push-subscription',
  'venture-cli-check',
  'venture-goal',
  'venture-decision',
  'venture-draft-edit', 'venture-triage-rule', 'venture-settings-draft', 'venture-queue-view',
  'venture-bill', 'venture-credit-note', 'venture-recurring-invoice',
  'venture-connector-check', 'venture-file-request',
  'venture-owner-profile',
  'venture-signing-key',
  // 4J10: the chained journal's links and breaks (one record per business), and one signature per signed receipt.
  'venture-journal-chain', 'venture-receipt-signature',
  'venture-order-contract',
  // 4J12 (H25): one message from one agent to another (or a report up to the owner), apart from the owner's chats.
  'venture-agent-relay',
  'venture-routine', 'venture-routine-run',
  'venture-drill-run',
  'venture-voice', 'venture-persona',
  'venture-knowledge', 'venture-idea',
  // 4J8: an offer the owner added to the plan ("Add this to {business}"), kept apart so every rewrite keeps it.
  'venture-owner-offer',
  // Ink v2 wave 5 (named by package 5-0; each body is a type in the owning package's records file, a placeholder until
  // that package lands). Ideas reuse 4J18's 'venture-idea', routines 4J13's, imported mail 4E3's 'venture-inbound'.
  // The kit: 5A2 the GO card (playbooks/kit/records-sales.ts); 5A4 brand kits, assets and voice consent
  // (records-media.ts); 5A5 reports and their share links (records-report.ts); 5A6 monitors (build/records-connect.ts).
  'venture-go-no-go', 'venture-sales-proposal', 'venture-brand-kit', 'venture-asset', 'venture-voice-consent', 'venture-report', 'venture-report-share',
  'venture-monitor',
  // 5A6 (K13): one owner-installed local app's last run and what it asked of the owner (build/records-connect.ts).
  'venture-local-app',
  // The flagships (playbooks/<id>/records.ts): YouTube 5B1 edits and the names dictionary, 5B2 the style card; the CA
  // firm 5C1 citations, 5C2 differential cases and the ITR data pack; social 5D2 inbox items and the ad ledger, 5D3
  // influencer cases.
  'venture-youtube-edit', 'venture-youtube-dictionary', 'venture-youtube-style',
  'venture-ca-citations', 'venture-ca-differential', 'venture-ca-data-pack',
  'venture-social-inbox-item', 'venture-ad-ledger-entry', 'venture-influencer-case',
  // The new playbooks (playbooks/<id>/records.ts): seo-visibility 5E1 and 5E2; online-seller 5F1 and 5F2; support-desk
  // 5G; recruiting-desk 5H; job-search-desk 5I; translation-studio 5J1; bookkeeping-cfo 5K1 and 5K2; podcast-to-article
  // 5L; lead-generation 5M; newsletter-studio 5N; tender-desk 5O; website-studio 5P; narration-studio 5Q;
  // virtual-assistant 5R1; data-entry-desk 5R2; app-testing 5R3; dev-agency 5R4; monitored-data 5R5; phone-receptionist 5R6.
  'venture-seo-panel', 'venture-seo-observation', 'venture-seo-finding',
  'venture-seller-sku', 'venture-seller-feecard', 'venture-seller-stage', 'venture-seller-movement', 'venture-seller-case',
  'venture-support-ticket', 'venture-support-message', 'venture-support-request', 'venture-support-rating',
  'venture-recruit-role', 'venture-recruit-candidate', 'venture-recruit-touch', 'venture-recruit-interview',
  'venture-career-fact', 'venture-career-listing', 'venture-career-thread',
  'venture-translation-job', 'venture-translation-segment', 'venture-glossary',
  'venture-promise-to-pay', 'venture-collection-stage', 'venture-books-posting',
  'venture-article-ledger',
  'venture-lead-source',
  'venture-newsletter-issue', 'venture-newsletter-contact',
  'venture-tender-question',
  'venture-site-requirement', 'venture-site-release',
  'venture-narration-segment',
  'venture-room-brief',
  'venture-entry-record',
  'venture-test-finding',
  'venture-dev-permission',
  'venture-watch-source',
  'venture-call-log',
] as const;
export type VentureRecordKind = typeof VENTURE_RECORD_KINDS[number];

/** Every venture record lives in State.conversations with one of the kinds above. */
export type RecordBase<K extends VentureRecordKind> = {
  id: string;
  kind: K;
  ventureId: string;
  memberId: string;
  epoch: number;
  at: IsoTime;
};

export type VentureRecord = RecordBase<'venture-record'> & {
  idea: string;
  ideaDigest: string;
  workingName: string;
  country: CountryProfile;
  serviceType: ServiceType | null;
  status: VentureStatus;
  launchStage: LaunchStage;
  blueprintId: string | null; // latest blueprint version
  acceptedBlueprintId: string | null;
  playbookId: string | null; // latest validated playbook
  invoiceSequence: number; // last issued invoice number
  updatedAt: IsoTime;
  /**
   * 4J10 (H26): the chained journal's newest link, pinned here too, so a chain cut short or deleted shows. mac: HMAC
   * with a key derived from the vault's own key (journal:head), so a forged pin shows; absent where no key is derived.
   */
  journalHead?: { seq: number; digest: string; mac?: string };
  /** 4J10 (H26): when this business first signed a receipt, HMAC'd like journalHead: an unsigned receipt made after it was changed. */
  signingSince?: { at: IsoTime; mac?: string };
};

export type TermLifecycle = 'proposed' | 'active' | 'retired';
export type TermRecord = RecordBase<'venture-term'> & {
  key: 'client' | 'offer' | 'order' | 'deliverable' | 'revision-round' | 'invoice' | 'payment' | 'retainer-period';
  name: string;
  meaning: string; // no digits
  lifecycle: TermLifecycle;
  evidence: { recordId: string; kind: VentureRecordKind; at: IsoTime }[];
};

export type ChecklistItemId =
  | 'idea' | 'ai' | 'questions' | 'plan' | 'prices' | 'brief' | 'builder' | 'repo'
  | 'rehearsal' | 'first-client' | 'first-invoice' | 'first-payment';
/** link (Ink v2 wave 4, 4J8): the app address where the item is done, such as #/business/prices. */
export type ChecklistItem = { id: ChecklistItemId; label: string; done: boolean; place: LaunchPlace; link: string };
export type LaunchPlace = 'today' | 'business' | 'build' | 'clients' | 'agents' | 'money' | 'connections';
export type NextStep = { item: ChecklistItemId; label: string; place: LaunchPlace } | null;

export type VentureView = {
  venture: VentureRecord;
  checklist: ChecklistItem[];
  done: number;
  total: number;
  next: NextStep;
  terms: TermRecord[];
  /** The flagship playbook the idea picks (venture/playbooks/registry.ts); absent when the plain service type serves. */
  playbook?: PlaybookPick;
  /** 4F3: while the owner has paused the business (Pause all), since when and the engine's line; absent otherwise. */
  paused?: { since: IsoTime; line: Display };
};
/** A flagship playbook as the screens show it, for example { id: 'youtube', label: 'YouTube channel' }. Worked out from the idea, never stored. */
export type PlaybookPick = { id: string; label: string };

// ---------------------------------------------------------------------------
// 4. Plan preview, interview and blueprint (P1)
// ---------------------------------------------------------------------------

export type InterviewQuestionKind = 'choice' | 'text' | 'money' | 'yesno' | 'rate';
export type InterviewField = 'customer' | 'first-offer' | 'channel' | 'pricing-model' | 'price' | 'tax-registered' | 'tax-rate' | 'other';
export type InterviewQuestion = {
  id: string;
  kind: InterviewQuestionKind;
  field: InterviewField;
  text: string; // no digits when written by a model or template
  choices: { id: string; label: string }[]; // empty unless kind is 'choice'
  by: 'model' | 'template' | 'engine';
  required: boolean;
  prefill: string | null; // engine answer text the owner may keep, e.g. '18' for q_tax_rate in India
};
/**
 * amount is the owner's typed decimal text in the venture currency; rate is percent text like '18' or '8.25'.
 * assumed: only as { yes: false, assumed: true } on q_tax, when the owner left tax unanswered and a screen filled the
 * default. The plan then labels it an assumption, not the owner's answer, until the owner confirms it.
 */
export type InterviewAnswer = { choiceId?: string; text?: string; amount?: string; yes?: boolean; rate?: string; skipped?: true; assumed?: true };
export type InterviewRecord = RecordBase<'venture-interview'> & {
  serviceType: Labelled<ServiceType>;
  questions: (InterviewQuestion & { answer: InterviewAnswer | null; answerMinor: MinorString | null; answerBps: BpsString | null; answeredAt: IsoTime | null })[];
  modelCallIds: string[];
  source: 'model' | 'template';
};
export type InterviewView = {
  interview: InterviewRecord;
  next: InterviewQuestion | null;
  done: boolean;
  asked: number;
  limit: number; // at most 6 questions in total
};

export type PricingModel = 'monthly' | 'project' | 'hourly';
export type Offer = {
  id: string; // 'offer_1' .. 'offer_3', stable across versions
  /** The library block a composed plan built this offer from; absent on template offers. Allowed pricing is OFFER_BLOCKS[block].allowed. */
  block?: OfferBlockId;
  /**
   * The flagship playbook offer this offer is (venture/playbooks/plan.ts), for example 'licensed-clips'. Set on plans
   * an idea's flagship playbook made; absent on every other plan. It decides the rights asked at intake and the step
   * that drafts an order's reply.
   */
  playbookOffer?: string;
  /**
   * Ink v2 wave 4 (4J8): an offer the owner added (a venture-owner-offer record holds it, so "Rewrite with AI" keeps it).
   * Its words are the owner's: Rewrite with AI never touches them, a suggestion may reword them only through a patch the
   * owner applies, and the owner may take it out again.
   */
  addedByOwner?: true;
  /**
   * Ink v2 wave 4 (4J12, H24): every order of this offer needs a contract the owner signed before a run starts
   * (money/order-contracts.ts). Fixtures only in W4: no shipped plan sets it.
   */
  contract?: 'required';
  name: Labelled<string>;
  description: Labelled<string>;
  pricing: {
    model: PricingModel;
    quantityUnit: 'month' | 'project' | 'hour';
    unitPriceMinor: MinorString | null; // owner-entered only; null shows "Set your price"
    unitPriceLabel: 'told-by-you' | 'not-set';
    defaultQuantity: string; // integer text, engine default '1'
    /**
     * Ink v2 wave 5 (5A2): the offer is priced as a share of an amount the client confirms later (money/share-price.ts),
     * in place of a fixed price; base and evidence stay null on the plan. Absent on every fixed-price offer.
     */
    share?: SharePrice;
  };
};
/**
 * One step a flagship playbook delivers with (venture/playbooks/steps.ts), as the plan lists it: its own title, fixed
 * engine words, and who does it. doneBy: you, an agent (who is its role, such as 'Packager'), code with no model (who
 * is its name, such as 'Calculator'), or another person (who is, for example, 'CA of record' or 'Your client'). A
 * flagship plan lists these in place of the four template steps, so the plan the owner accepts names the steps that run.
 */
export type PlanFlagshipStep = { id: string; title: Labelled<string>; doneBy: 'you' | 'agent' | 'code' | 'person'; who: string };
/**
 * What an order for one flagship offer asks at intake (venture/playbooks/intake.ts), worked out by code, never stored.
 * rights: the rights to the footage this offer accepts, in order; empty when it cuts no footage. fields: the other
 * intake fields its checks read; 'cutFile' never on the hosted server, which reads no file on the owner's computer.
 */
export type OfferIntakeAsk = {
  rights: RightsBasis[]; fields: ('format' | 'aiVoice' | 'aiPresenter' | 'paidPromotion' | 'cutFile' | 'calendar' | 'clientRules')[];
  /** Ink v2 wave 5 (5A1): a kit offer's own intake fields, in order (kept under OrderIntake.fields); absent on the flagships. */
  kit?: KitIntakeField[];
};
/** 'yours': work only the owner does, with no agent planned (composed plans only). */
export type StepCapability = 'drafts-now' | 'planned' | 'yours';
export type BlueprintStep = {
  id: string;
  /** The library block a composed plan built this step from; absent on template steps. */
  block?: StepBlockId;
  title: Labelled<string>;
  doneBy: 'agent' | 'you' | 'agent-then-you'; // who does it in this build
  capability: StepCapability; // code-computed from STEP_PLAN; 'planned' shows the chip 'planned: agent'
  note: string; // fixed engine words from STEP_PLAN
};
export type BackOffice = {
  currency: string;
  taxMode: TaxMode;
  taxLabel: string;
  taxRegistered: Labelled<boolean>;
  taxRateBps: BpsString; // '0' unless registered
  taxRateBy: 'country-table' | 'told-by-you' | 'not-registered';
  taxId: string | null; // GSTIN, VAT or GST number, owner-typed and checked
  taxState: string | null; // India only: two-digit state code; must equal the GSTIN's first two digits
  sacCode: string | null; // India only: six-digit SAC starting 99, owner-typed
  lutConfirmed: boolean; // India only: the owner confirms a Letter of Undertaking for zero-rated exports
  invoiceKind: 'tax-invoice' | 'invoice'; // from the country
  taxInvoiceReady: boolean; // every field a tax invoice needs is present (always false for kind 'invoice')
  taxInvoiceMissing: string[]; // plain words such as 'Your GSTIN'; [] when ready or not registered
  paymentRail: string; // connector id
  invoicePrefix: string; // 'INV'
};
export type BlueprintRecord = RecordBase<'venture-blueprint'> & {
  version: number;
  status: 'draft' | 'accepted';
  source: 'model' | 'template';
  structureHash: string; // hash of the code-made structure the model may only fill with words
  digest: string; // digest of the whole blueprint except id, at, digest and status; approved on accept
  modelCallIds: string[];
  serviceType: ServiceType;
  name: Labelled<string>;
  oneLiner: Labelled<string>;
  customer: Labelled<string>;
  offers: Offer[]; // 1 to 3
  deliverySteps: BlueprintStep[]; // 3 to 6
  approvals: Labelled<string>[]; // what the owner approves, 1 to 4
  backOffice: BackOffice;
  starterConnectorIds: string[]; // about six
  // Composed plans only (onboarding v2). Absent on template records, so their digests do not change.
  composition?: { id: string; composeId: string; kind: PlanKind; views: ViewSelection[] } | null;
  approvalBlocks?: ApprovalBlockId[];
  pages?: ComposedPage[];
  tools?: { block: ToolBlockId; reason: Labelled<string> }[];
  notes?: ComposedNote[];
  /**
   * Flagship playbook plans only (venture/playbooks/steps.ts): the steps that run, which the plan lists in place of
   * deliverySteps. Part of the digest the owner accepts. Absent on every other plan, so their digests do not change.
   */
  flagshipSteps?: PlanFlagshipStep[];
};

/** Owner edits. Every field optional; at least one required. Creates a new draft version. */
export type BlueprintPatch = {
  name?: string;
  oneLiner?: string;
  customer?: string;
  taxRegistered?: boolean;
  taxRate?: string; // percent text like '18' or '8.25'; percentBps turns it into basis points
  taxId?: string | null;
  taxState?: string | null;
  sacCode?: string | null;
  lutConfirmed?: boolean;
  /** share (5A2): a share of an amount the client confirms later, as percent text ('8.33'), in place of a fixed price; null takes it away. */
  offers?: { id: string; name?: string; description?: string; unitPrice?: string | null; pricingModel?: PricingModel; share?: { percent: string } | null }[];
  /** Ink v2 wave 4 (4J8): a new offer of the owner's, with no price yet (Set your prices then names it). */
  addOffer?: { name: string; description: string; pricingModel: PricingModel };
  /** Ink v2 wave 4 (4J8): takes out an offer the owner added. A playbook's or the plan's own offers stay. */
  removeOffer?: { id: string };
};

/** Blueprint plus the current (non-stale) price receipt per offer, looked up by subject and this version's digest. */
export type BlueprintView = {
  blueprint: BlueprintRecord;
  offerReceipts: Record<string, PriceReceiptRecord | null>;
  /** The flagship playbook the venture's idea picks; absent when none fits. Not part of the record or its digest. */
  playbook?: PlaybookPick;
  /** What an order for each offer asks at intake, by offer id; absent when no offer asks anything. Not part of the record. */
  intake?: Record<string, OfferIntakeAsk>;
};

/** venture.preview: the instant plan shown before any vault exists. Template words only; nothing is stored. */
export type PlanPreview = {
  idea: string;
  country: CountryProfile;
  serviceType: Labelled<ServiceType>;
  serviceLabel: string;
  oneLiner: Labelled<string>;
  customer: Labelled<string>;
  offers: Offer[]; // template words, unitPriceMinor null
  deliverySteps: BlueprintStep[];
  approvals: Labelled<string>[];
  backOffice: BackOffice; // taxRegistered is { value: false, label: 'assumption', by: 'engine' }
  questions: InterviewQuestion[]; // the template interview the screen fills inline (q_tax_rate shows when q_tax is yes)
  by: 'template';
  saved: false;
  /** The flagship playbook the idea picks; absent when none fits. */
  playbook?: PlaybookPick;
  /** The flagship playbook's delivery steps, listed in place of deliverySteps; absent when no playbook fits. */
  flagshipSteps?: PlanFlagshipStep[];
};

/**
 * Pinned template structure. P1 (offers, steps, interview), P5 (sections, scenarios) and the P6
 * fixtures all depend on these exact ids. Code makes the structure; a model only fills in words.
 */
export const OFFER_IDS = ['offer_1', 'offer_2'] as const;
export const STEP_IDS = ['step_1', 'step_2', 'step_3', 'step_4'] as const;
/**
 * Who does each step in this build. An agent can only draft from the client's message, so steps that need
 * files, inboxes, tools or sending are the owner's, with an agent planned. step_3 is always the drafting step.
 */
export const STEP_PLAN: readonly { id: string; doneBy: BlueprintStep['doneBy']; capability: StepCapability; note: string }[] = Object.freeze([
  { id: 'step_1', doneBy: 'you', capability: 'planned', note: 'You collect what the client sends and add the files to the order, where the agent reads them. Reading inboxes for you is planned.' },
  { id: 'step_2', doneBy: 'you', capability: 'planned', note: 'You do the hands-on work. For bookkeeping, an agent reconciles a month from the files you add, for you to check; other hands-on work is planned.' },
  { id: 'step_3', doneBy: 'agent-then-you', capability: 'drafts-now', note: "An agent drafts a reply from the client's message. You check it." },
  { id: 'step_4', doneBy: 'you', capability: 'planned', note: 'You send it to the client. Sending for you is planned.' },
] as const);
export const APPROVAL_COUNT = 2;
export const INTERVIEW_IDS = Object.freeze({ first: 'q_1', second: 'q_2', pricingModel: 'q_pricing_model', price: 'q_price', tax: 'q_tax', taxRate: 'q_tax_rate' } as const);
export const SECOND_OFFER_MODEL: Readonly<Record<ServiceType, PricingModel>> = Object.freeze({
  agency: 'project', studio: 'hourly', consulting: 'project', bookkeeping: 'project',
  research: 'hourly', content: 'project', support: 'hourly', other: 'project',
});
/** Headings promise work ahead, never work done: agents in this build only draft from the client's message. */
export const REQUIRED_SECTIONS: Readonly<Record<ServiceType, readonly string[]>> = Object.freeze({
  agency: ['Summary', 'Plan', 'Drafts', 'Next steps'],
  studio: ['Summary', 'What we will make', 'Questions on the brief', 'Next steps'],
  consulting: ['Summary', 'What we heard', 'Recommendations', 'Next steps'],
  bookkeeping: ['Summary', 'What we will do', 'What we need from you', 'Next steps'],
  research: ['Summary', 'Method', 'What we will look for', 'Sources to check'],
  content: ['Summary', 'Draft', 'Notes for review', 'Next steps'],
  support: ['Summary', 'Replies drafted', 'Escalations', 'Next steps'],
  other: ['Summary', 'What we will do', 'Questions', 'Next steps'],
});
export const SCENARIO_KINDS = ['clean', 'messy', 'pushback'] as const;
export type ScenarioKind = typeof SCENARIO_KINDS[number];
/** Starter connectors; '<payment-rail>' is replaced with country.paymentRails[0]. */
export const STARTER_CONNECTORS = Object.freeze(['lovable', 'github', '<payment-rail>', 'mail-app', 'cal-com', 'chausar-books'] as const);

// ---------------------------------------------------------------------------
// 5. Models (P2): presets, connections, calls, the model port
// ---------------------------------------------------------------------------

export const MODEL_PRESET_IDS = ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5', 'openai-gpt-6-luna', 'claude-code-cli', 'codex-cli', 'built-in-templates'] as const;
export type ModelPresetId = typeof MODEL_PRESET_IDS[number];
export type ModelRouteKind = 'anthropic-messages' | 'openai-responses' | 'claude-cli' | 'codex-cli' | 'template';
export type ModelTier = 'fast' | 'main';
/** 'agent-turn' is one tool-using turn of a delivery agent (cheap tier); 'improve' proposes one playbook patch. */
/** 'decide' reads the open box and picks views (cheap tier); 'compose' fills the plan from library blocks (main tier). */
/** 'agent-chat' (4B1) answers the owner in an agent's thread, or drafts a "from now on" patch, under the chat consent (main tier). */
/** 'goal-suggest' (4I1) suggests a monthly goal from the plan's offers and prices only, a model estimate (cheap tier). */
/** 'chief-chat' (4C1) answers in Chats from read tools under the chat consent (main tier, as agent chat); 'chief-fit' (4C1) judges which way to earn fits, from the ways and business kinds only (cheap tier). */
/** 'meeting-digest' (4E3) reads the owner's notes from a call for people, promised intros and next steps, under the chat consent (main tier, as agent chat). */
/** 'network-search' (4D3) turns the owner's question into traits and filters, then checks candidates' stored fields against them, under the chat consent (main tier, as agent chat). */
/** 'outreach-draft' (4E2) drafts one message the owner sends themselves, from the card's facts and the owner's words, under the chat consent (main tier, as agent chat). */
/** 'plan-suggest' (4J8) rewrites the open business's plan words to take in the owner's sentence: words only, never a price or a new offer (main tier). */
/** 'persona-test' (4J17) writes an agent's first reply to each practice client in an unsaved persona, for the owner to read; practice clients only, no client data (fast tier). */
/** 'triage-rule' (4J2, O18) maps the owner's own words for Today's order to fixed fields; the owner's words only, no client data (fast tier). */
export const MODEL_PURPOSES = ['interview', 'blueprint', 'brief', 'delivery', 'client-sim', 'judge', 'agent-turn', 'improve', 'decide', 'compose', 'agent-chat', 'goal-suggest', 'chief-chat', 'chief-fit', 'network-search', 'meeting-digest', 'outreach-draft', 'plan-suggest', 'persona-test', 'triage-rule'] as const;
export type ModelPurpose = typeof MODEL_PURPOSES[number];
export const PURPOSE_TIER: Readonly<Record<ModelPurpose, ModelTier>> = Object.freeze({
  interview: 'fast', 'client-sim': 'fast', judge: 'fast', blueprint: 'main', brief: 'main', delivery: 'main',
  'agent-turn': 'fast', improve: 'main', decide: 'fast', compose: 'main', 'agent-chat': 'main', 'goal-suggest': 'fast',
  'chief-chat': 'main', 'chief-fit': 'fast', 'network-search': 'main', 'meeting-digest': 'main', 'outreach-draft': 'main', 'plan-suggest': 'main',
  'persona-test': 'fast', 'triage-rule': 'fast',
});

export type ModelPriceTable = {
  currency: 'USD';
  inputMicrosPerMillion: MicroString; // micro-USD per million input tokens
  outputMicrosPerMillion: MicroString;
  source: string; // where the list price came from
  checkedOn: IsoDate;
  confirmed: boolean; // false: every cost from this table is shown as 'estimate, price unconfirmed'
};
export type ModelAvailability = 'ready' | 'unverified' | 'needs-setup' | 'unavailable';
export type ModelPreset = {
  id: ModelPresetId;
  label: string;
  kind: ModelRouteKind;
  model: string | null; // provider model id; null for templates
  modelEditable: boolean; // true only for GPT-6 Luna: the owner types the model id
  tiers: ModelTier[]; // which jobs it is suggested for
  needsKey: boolean;
  keyHint: string | null; // where to create a key, plain words
  runsOn: 'provider-api' | 'this-computer' | 'chausar-engine';
  priceTable: ModelPriceTable | null;
  consentText: string; // exactly what is sent and what is never sent
  consentDigest: string; // digest(consentText)
  verification: 'not-live-verified' | 'built-in';
  /**
   * Shown next to availability: 'Not yet checked with a live key.' (key presets) or 'Not yet checked on a real task.'
   * (command-line presets) for 'not-live-verified'; null for 'built-in'. Always set by the engine; optional only so
   * older fixtures still type.
   */
  verificationNote?: string | null;
  availability: ModelAvailability;
  availabilityReason: string;
};

export type ModelConnectionRecord = RecordBase<'venture-model-connection'> & {
  presetId: ModelPresetId;
  routeKind: ModelRouteKind; // `kind` is the record kind from RecordBase
  model: string | null;
  endpoint: string; // as in ModelCallRecord
  tiers: ModelTier[]; // tiers this connection serves; later connections win per tier
  consentDigest: string;
  consentedAt: IsoTime;
  monthlyCapMicros: MicroString; // in USD micros; '0' for templates
  status: 'connected' | 'disconnected';
};
/** The preset's verification, copied onto every status line so the screen can say it next to 'ready'. Always set by the engine. */
export type ModelVerificationView = { verification?: ModelPreset['verification']; verificationNote?: string | null };
export type ModelConnectionView = ModelConnectionRecord & ModelVerificationView & { keyLoaded: boolean; usable: boolean; reason: string };
export type ModelStatusView = {
  connections: ModelConnectionView[];
  tiers: Record<ModelTier, ModelVerificationView & { presetId: ModelPresetId; model: string | null; usable: boolean; reason: string }>;
  spentThisMonthMicros: MicroString;
  spentThisMonthDisplay: string; // e.g. 'USD 0.0042', or 'USD 0.0042 (estimate, price unconfirmed)'
  estimate: boolean; // true when any cost this month came from an unconfirmed price table
  sendPolicy: 'nothing' | 'shape' | 'samples'; // the workspace send setting; 'nothing' stops every venture model call
  replay: { active: boolean; label: 'synthetic recording' | null };
  /** Ink v2 wave 4 (4F2, M7): on connect's answer only, when the new key took over work an earlier one did: who now pays. */
  payerLine?: string;
};

export type ModelCallRecord = RecordBase<'venture-model-call'> & {
  purpose: ModelPurpose;
  tier: ModelTier;
  presetId: ModelPresetId;
  connectionId: string | null;
  routeKind: ModelRouteKind; // `kind` is the record kind from RecordBase
  model: string | null;
  /**
   * 'standing-judge': the rules judge's call sent on its own under the business's judgeAuto consent (delivery/judge-run.ts).
   * 'owner-file-drop' (4J8): a call that carried a file the owner dropped beside their own words (core/attachment.ts),
   * sent because they asked with it; no approval of the call is recorded, as nobody gave one (approvedBy stays null).
   */
  consent: 'standing' | 'approved-preview' | 'standing-judge' | 'owner-file-drop';
  endpoint: string; // 'https://api.anthropic.com/v1/messages', 'cli://claude', 'cli://codex'
  payloadText: string; // exact request body or stdin sent; never a key
  payloadDigest: string;
  payloadTruncated: boolean; // stored text capped at 65536 characters; digest covers the full text
  containsClientData: boolean;
  status: 'preview' | 'dispatching' | 'completed' | 'failed' | 'expired';
  approvedDigest: string | null;
  approvedAt: IsoTime | null;
  approvedBy: string | null; // memberId of the person who approved a client-data send
  estimatedMaxCostMicros: MicroString; // reserved against the monthly cap while dispatching
  priceConfirmed: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
  costMicros: MicroString | null;
  outputDigest: string | null;
  error: { code: string; message: string; cause?: string } | null; // cause (4F2): the transport's class, such as 'not-connected', when it said one
  replay: boolean; // true when served from a synthetic recording
  /** Ink v2 wave 4 (4H1, H36): the model the provider's answer named, else 'not reported'. Set when the call settles. */
  answeredBy?: string;
  /**
   * Ink v2 wave 4 (4B2): when a finished call's stored text was erased because it carried a note the owner forgot. The
   * digest, ids, costs and times stay; nothing checks a finished call's text against its digest.
   */
  erasedAt?: IsoTime;
};

/** One unit of model work. Built by P1, P4 and P5; executed by P2. */
export type ModelTask<T> = {
  purpose: ModelPurpose;
  instructions: string; // system text
  input: Json; // user content, serialized as JSON text
  schemaName: string; // [a-z][a-z0-9-]{0,40}
  schema: Json; // JSON Schema: objects closed, every property required, no number or integer types
  validate: (raw: unknown) => T; // local authority; throws MODEL_OUTPUT_REJECTED
  template?: () => T; // used only when no model serves this tier
  containsClientData: boolean; // true forces preview and owner approval
  maxOutputTokens: number; // 256 to 8192
  capLeftMicros?: MicroString; // what the run this call belongs to has left under its spend cap; a call that may cost more is refused
};
export type ModelOutcome<T> = {
  value: T;
  by: 'model' | 'template';
  callId: string | null; // ModelCallRecord id when by is 'model'
  presetId: ModelPresetId;
  model: string | null;
  costMicros: MicroString; // '0' for templates
  priceConfirmed: boolean; // false: costMicros came from an unconfirmed price table; show it as an estimate
  /** 4H1 (H36): the model the provider's answer named, or 'not reported'; absent for templates. */
  answeredBy?: string | null;
};
export type ModelPreview = {
  callId: string;
  payloadText: string;
  digest: string;
  presetId: ModelPresetId;
  model: string | null;
  endpoint: string;
  estimatedMaxCostMicros: MicroString;
  estimatedMaxCostDisplay: string; // adds '(estimate, price unconfirmed)' when the table is unconfirmed
  expiresAt: IsoTime; // 30 minutes
  /** Ink v2 wave 4 (4F2, M7): who pays for this call, in words ('Paid by your Anthropic key'); absent on older previews. */
  payer?: string;
};

export interface ModelPort {
  /** Never writes. Calls left 'dispatching' for more than ten minutes are reported as failed in this view only. */
  status(ctx: Context): ModelStatusView;
  /** The six presets with availability as of now (the CLI check and the Codex profile included). */
  presets(): ModelPreset[];
  /**
   * Before a command-line connection (4H1): one fresh look at the owner's Claude Code or Codex through the transport,
   * as inspectCli makes it but never reused: its --version, its help for the route's flags and, when its help lists
   * one, its own sign-in status command. Only the program the search path has is started (never a bare name), in an
   * empty folder made for the look: no network, no cost, no shell. Throws PRESET_UNAVAILABLE on the hosted app, while
   * the Claude Code terms are pending (nothing of it is run then) and without Codex's reviewed profile; CLI_UNAVAILABLE
   * when it is not found, does not answer its version check in the real tool's form, or says it is signed out;
   * CLI_FLAGS_UNSUPPORTED, naming the flags, when its help lacks a flag the route sends or a real call was refused for one.
   */
  checkCli(presetId: ModelPresetId): Promise<void>;
  /** Standing-consent path. Refuses tasks with client data (CLIENT_DATA_NEEDS_APPROVAL), by flag and by content. */
  generate<T>(ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>>;
  /** Per-call path. Records the exact payload; sends nothing. Returns null when only templates serve the tier. */
  preview<T>(ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null>;
  /**
   * Sends exactly the previewed payload once, after the owner approved its digest; claims the call before any await.
   * options.consent 'standing-judge': the rules judge's call going on its own under the business's standing consent,
   * recorded as that and never as the owner's approval of the call. 'owner-file-drop' (4J8): a call that carries a file
   * the owner dropped with their own words, recorded as that, again never as an approval.
   */
  runPreview<T>(ctx: Context, callId: string, approvedDigest: string, validate: (raw: unknown) => T, options?: { consent?: 'standing-judge' | 'owner-file-drop' }): Promise<ModelOutcome<T>>;
  /**
   * Ink v2 wave 4 (4H1): looks at the owner's Claude Code or Codex on this computer through the transport (version,
   * help and, when its help lists one, its own sign-in status command) and keeps what it found for availability. Never
   * reads a sign-in file or a key. One look runs at a time per tool (a second asker joins it) and a look is reused for a
   * minute, unless options.fresh ("Check again"), which never reuses one. Optional so older test ports still type; the
   * engine's port always has it.
   */
  inspectCli?(cli: DelegateCli, options?: { fresh?: boolean }): Promise<CliFinding>;
}

/**
 * 4H1. What one look at the owner's command-line AI found, from evidence only. path: where the search path has it.
 * answered: its --version answered in the real tool's own form ('x.y.z (Claude Code)', 'codex-cli x.y.z'; never while
 * the Claude Code terms are pending, when nothing of it is run). version: the version that line names. flags: whether
 * its help lists every flag the route sends (unknown when the help did not answer; a mismatch too once a real call was
 * refused for a route flag). signedIn: only from a status command its own help lists,
 * read for a fixed phrase and dropped. profile: Codex's reviewed host profile is present (always true for Claude Code).
 * replay: the look went to a synthetic recording, not a tool on this computer. via 'npm-shim': the search path had
 * npm's standard command script, so the look ran node with the script it names (models/npm-shim.ts), never a shell.
 */
export type CliFinding = {
  cli: DelegateCli; at: IsoTime; found: boolean; path: string | null; answered: boolean; version: string | null;
  flags: 'match' | 'mismatch' | 'unknown'; missingFlags: string[]; signedIn: 'yes' | 'no' | 'unknown'; statusCommand: boolean; profile: boolean; replay: boolean;
  via?: 'npm-shim';
  /** 4H2: the look started the tool on this computer (its version check at least); never for a located-only or replayed tool. */
  ran?: boolean;
};

export type ModelHttpRequest = { url: string; method: 'POST'; headers: Record<string, string>; body: string; timeoutMs: number; purpose: ModelPurpose };
export type ModelHttpResponse = { status: number; body: string };
/**
 * cwd (4H1, H39): an empty folder made for a command-line model call, or for one look's checks; absent only for a
 * synthetic recording, which starts nothing.
 */
export type ModelProcessRequest = { command: string; args: string[]; env: Record<string, string>; stdin: string; timeoutMs: number; purpose: ModelPurpose | 'version-check'; cwd?: string };
export type ModelProcessResponse = { exitCode: number; stdout: string; stderr?: string };
/** purpose is for replay selection only; real transports must not send it anywhere. */
export type ModelTransport = {
  http(request: ModelHttpRequest): Promise<ModelHttpResponse>;
  process(request: ModelProcessRequest): Promise<ModelProcessResponse>;
  replay: boolean;
};

/** Synthetic recordings for tests and the offline demo. Strict JSON on disk. */
export type ModelReplayFixture = {
  label: 'synthetic recording';
  note: string;
  responses: {
    purpose: ModelPurpose;
    kind: ModelRouteKind;
    model: string;
    status: number;
    body: Json; // provider-shaped response body, or CLI stdout object
    mustInclude: string[]; // substrings the request body must contain
  }[];
};

/**
 * What each model purpose must return (inside the provider's text block, as JSON).
 * Every string field is words only: no currency signs, percent or magnitude words, and no token with a digit
 * unless it also has a letter and was copied from the owner's own input (B2B, Web3).
 * Fixtures in platform/tests/fixtures/venture/** are written against these shapes.
 */
export type InterviewModelOutput = {
  serviceType: ServiceType;
  // 1 to 2 questions; choices has 2 to 4 labels when kind is 'choice', else []
  questions: { field: 'customer' | 'first-offer' | 'channel'; kind: 'choice' | 'text'; text: string; choices: string[] }[];
};
export type BlueprintModelOutput = {
  name: string; // at most 60 characters, one line
  oneLiner: string; // at most 160
  customer: string; // at most 200
  offers: { id: string; name: string; description: string }[]; // exactly OFFER_IDS, in order
  steps: { id: string; title: string }[]; // exactly STEP_IDS, in order
  approvals: string[]; // exactly APPROVAL_COUNT items
};
export type BriefModelOutput = {
  whatToBuild: string; // at most 600; the only multi-line field
  whoItIsFor: string; // at most 400
  pages: { title: string; purpose: string }[]; // 4 to 6
  lookAndFeel: string; // at most 300
  doneMeans: string[]; // 4 to 8, each at most 120
};
/** '<offerId>.<figureKey>' (for example 'offer_1.total') or 'order.<figureKey>'; only refs the engine offered. */
export type FigureRef = string;
/** 'today' or 'order.created'; only refs the engine offered. The engine fills and formats the date. */
export type DateRef = string;
export type DeliveryModelPart = { kind: 'text' | 'figure' | 'date'; text: string; ref: string }; // text is '' for figure and date parts; ref is '' for text parts
export type DeliveryModelOutput = {
  title: string;
  sections: { heading: string; parts: DeliveryModelPart[] }[]; // headings from REQUIRED_SECTIONS of the service type
  questionsForClient: string[]; // 0 to 3
};
export type ClientSimModelOutput = { message: string; asksForPerson: boolean };
export type JudgeModelOutput = { answers: { question: JudgeQuestionId; answer: 'yes' | 'no' | 'unsure'; reason: string }[] }; // one per JudgeQuestionId
/** One agent turn: a short note (words only), up to four tool calls (input is JSON text), and whether the work is done. */
export type AgentTurnModelOutput = { note: string; calls: { tool: string; input: string }[]; finished: boolean };
/** One proposed playbook patch at one level, with its change note. value is checked by code per op. */
export type ImproveModelOutput = {
  level: AttributionLevel;
  hypothesis: string;
  op: PlaybookPatchOp;
  stepId: string;
  value: string;
  expectedFixes: string[];
  likelyRegressions: string[];
};
export type ModelOutputs = {
  interview: InterviewModelOutput;
  blueprint: BlueprintModelOutput;
  brief: BriefModelOutput;
  delivery: DeliveryModelOutput;
  'client-sim': ClientSimModelOutput;
  judge: JudgeModelOutput;
  'agent-turn': AgentTurnModelOutput;
  improve: ImproveModelOutput;
  decide: DecideModelOutput;
  compose: ComposeModelOutput;
};

// ---------------------------------------------------------------------------
// 6. Money (P3): price receipts, clients, orders, invoices, payments, books
// ---------------------------------------------------------------------------

/** How tax is worked out on one receipt. 'cgst-sgst', 'igst' and 'zero-rated-lut' are India only. */
export type TaxTreatment = 'none' | 'single' | 'cgst-sgst' | 'igst' | 'zero-rated-lut';
export type PriceStep = {
  op: 'multiply' | 'discount' | 'tax' | 'tax-split' | 'add';
  inputs: string[]; // minor strings, quantities or bps exactly as used
  resultMinor: MinorString;
  rule: string; // e.g. 'unit price times quantity', 'rounded half up to the minor unit'
};
export type PriceFigure = {
  key: 'unit' | 'subtotal' | 'discount' | 'taxable' | 'tax' | 'cgst' | 'sgst' | 'igst' | 'total' | 'paid' | 'balance' | 'credited';
  label: string; // 'Total', 'CGST at 9%' ...
  minor: MinorString;
  display: string; // formatMinor(minor, currency)
  currency: string;
};
export type PriceReceiptRecord = RecordBase<'venture-price-receipt'> & {
  subject: { type: 'offer'; offerId: string } | { type: 'order'; orderId: string } | { type: 'invoice'; invoiceId: string };
  operation: 'venture.price';
  currency: string;
  minorDigits: number;
  inputs: {
    unitPriceMinor: MinorString;
    quantity: string;
    discountBps: BpsString;
    taxMode: TaxMode;
    taxRateBps: BpsString;
    taxTreatment: TaxTreatment;
    unitPriceBy: 'told-by-you';
    taxRateBy: 'country-table' | 'told-by-you' | 'not-registered';
    blueprintDigest: string; // digest of the blueprint version priced, draft or accepted
    /** 4J5 (M15): the unit price already includes the tax, so code splits it; absent on every other receipt. */
    taxInclusive?: true;
  };
  steps: PriceStep[];
  figures: PriceFigure[];
  totalMinor: MinorString;
  allowedNumbers: string[]; // every number a later sentence may cite
  explanation: string; // template sentence built from figures, never model text
  digest: string;
  stale: boolean; // true when the offer price or tax setting changed later
};

export type ClientRecord = RecordBase<'venture-client'> & {
  self?: true;
  name: string; // one line
  email: string | null;
  countryCode: CountryCode | null;
  taxId: string | null; // the client's GSTIN or VAT number, when they gave one
  stateCode: string | null; // India only: the client's GST state code, for place of supply
  note: string | null;
};
export type OrderRecord = RecordBase<'venture-order'> & {
  internal?: true;
  clientId: string;
  offerId: string;
  quantity: string;
  request: string; // what the client asked for, owner-typed; client data
  status: 'open' | 'invoiced' | 'delivered' | 'cancelled';
  priceReceiptId: string;
  deliveredOn: IsoDate | null;
  saleFactId: string | null;
  /** What a flagship playbook's offer asks at intake (venture/playbooks/intake.ts). Absent for every other offer. */
  intake?: OrderIntake;
  /** 4J5 (M15): the owner's price for this order includes the tax; its receipts split it. Absent: tax is added. */
  taxInclusive?: boolean;
  /**
   * Ink v2 wave 5 (named by 5-0, kept by 5A1's chain, playbooks/kit/chain.ts): the stage of a kit offer's stages this
   * order is at, counted from 1, and where the chain stands. Absent on an order that is not a chain.
   */
  chainStage?: number;
  chainState?: 'running' | 'waiting' | 'stopped' | 'done';
  /** 5A1: when the chain last moved (a stage, a wait on the client, a stop), for the waiting rows on Today. */
  chainSince?: IsoTime;
  /**
   * Ink v2 wave 5 (5A2, the honest exit, playbooks/kit/exit.ts): the order is for the in-scope part of the ask only;
   * rest lists what the playbook does not do, and reply the fixed words for the client. Absent when all of it is in scope.
   */
  outOfScope?: { rest: string[]; reply: string };
};
/**
 * A flagship offer's intake, checked by code when the order is made. rights: the rights to the footage, required for
 * an offer that cuts footage (delivery/rights.ts). cutFile: the finished cut on this computer, for the finishing check.
 */
export type OrderIntake = {
  rights: FootageRights | null;
  format: 'long' | 'short';
  aiVoice: boolean;
  aiPresenter: boolean;
  paidPromotion: boolean;
  cutFile: string | null;
  /**
   * A social content calendar order (Ink v2 wave 2): the month, the channels, posts per channel and the weekdays it
   * posts on (ISO numbers: 1 is Monday, 7 is Sunday). Code plans the slots and their dates (social/calendar.ts); a
   * model never picks a date.
   */
  calendar?: { month: string; channels: SocialChannel[]; postsPerChannel: number; weekdays: number[] };
  /** The client's own word lists the social checks read: banned words and topics, competitors, phrases never flagged. */
  clientRules?: { bannedWords: string[]; bannedTopics: string[]; competitors: string[]; protectedPhrases: string[] };
  /**
   * Ink v2 wave 5 (named by 5-0, checked by 5A1's playbooks/kit/intake.ts): a kit playbook's own intake fields, by field
   * id, as the definition's intakeFields name them.
   */
  fields?: Record<string, IntakeValue>;
};
/**
 * Ink v2 wave 4 (4J3): an order's stage steps on Work, from the playbook's stage list (playbooks/order-stages.ts) and
 * the records only (money/order-steps.ts). state: done; waits (on the owner: something waits for them on Today);
 * not-yet; always-asks (an outside step that never runs without the owner); unknown (an outside step whose last try
 * ended with its outcome unknown). waitsOn says who it waits on when that is not the owner (the CA, the client); due,
 * the day a payment is due. detail is the state in the engine's words; line is "<label>, <detail>". reason is a code
 * for the detail, so the screen can say it in its own words (English and Hindi); absent on a plain done, not yet or
 * always asks. An engine-failed draft is 'failed', never 'stopped' (stopping is the owner's or a breaker's).
 */
export type OrderStageId = 'agreed' | 'price' | 'episode' | 'publish' | 'files-in' | 'books' | 'gst' | 'calendar' | 'drafts' | 'client-ok' | 'posts' | 'report' | 'draft' | 'sent' | 'invoice' | 'paid';
export type OrderStageState = 'done' | 'waits' | 'not-yet' | 'always-asks' | 'unknown';
export type OrderStageReason =
  | 'new-price' | 'ready' | 'question' | 'approval' | 'brief' | 'failed' | 'stopped' | 'rejected' | 'working' | 'practice'
  | 'send-unknown' | 'post-unknown' | 'issue-unknown' | 'ca-signed' | 'ca-returned' | 'with-ca' | 'send-to-ca' | 'no-ca'
  | 'client-approved' | 'client-changes' | 'with-client' | 'link-ended' | 'posts-waiting' | 'posting' | 'planned' | 'to-issue' | 'issued' | 'due' | 'part-paid';
export interface OrderStageView { id: OrderStageId; label: Display; state: OrderStageState; detail: Display; line: Display; waitsOn?: 'you' | 'ca' | 'client'; due?: IsoDate; reason?: OrderStageReason }
/** What waits on the owner in one order (4J3): "2 wait on you: the new price and the episode draft." */
export interface OrderWaitsOnYou { count: number; items: { stage: OrderStageId; what: Display }[]; line: Display }
/** venture.order.list's row (4J3): the order as stored, with its stage steps and what waits on the owner, or null. */
export type OrderListRow = OrderRecord & { stages: OrderStageView[]; waitsOnYou: OrderWaitsOnYou | null };
/** taxRateBps (4J5, M15): the rate charged on this line when it was drafted; absent on invoices drafted before. */
export type InvoiceLine = { description: string; quantity: string; unitMinor: MinorString; amountMinor: MinorString; taxRateBps?: BpsString };
export type InvoiceRecord = RecordBase<'venture-invoice'> & {
  number: string | null; // 'INV-0001' when issued; null for drafts
  documentTitle: 'TAX INVOICE' | 'INVOICE' | 'INVOICE (not a tax invoice)';
  orderId: string;
  clientId: string;
  currency: string;
  issueDate: IsoDate | null;
  dueDate: IsoDate | null;
  dueInDays: number; // 0 to 90
  lines: InvoiceLine[];
  subtotalMinor: MinorString;
  discountMinor: MinorString;
  taxMinor: MinorString;
  totalMinor: MinorString;
  taxLabel: string;
  taxRateBps: BpsString;
  taxTreatment: TaxTreatment;
  taxLines: { label: string; rateBps: BpsString; minor: MinorString }[]; // one line, two for CGST and SGST, none when no tax
  supplierTaxId: string | null;
  clientTaxId: string | null;
  placeOfSupply: string | null; // India only, e.g. 'Maharashtra (27)' or 'Outside India (export of services)'
  sacCode: string | null;
  priceReceiptId: string;
  status: 'draft' | 'issued' | 'part-paid' | 'paid' | 'void';
  digest: string; // what the owner approves on issue
  issuedAt: IsoTime | null;
  factIds: string[];
  booksReceiptId: string | null; // calculator receipt for 'billed', kept only when its total equals the taxable amount
  booksNote: string | null; // why booksReceiptId is null, in words
  paidMinor: MinorString;
  balanceMinor: MinorString;
};
/** 'cheque' (4J5, M11): pending until the owner clears it or a bank row pays it. */
export type PaymentMethod = 'bank-transfer' | 'upi' | 'card' | 'cash' | 'payment-link' | 'other' | 'cheque';
export type PaymentRecord = RecordBase<'venture-payment'> & {
  invoiceId: string;
  amountMinor: MinorString; // the money that came in; TDS the client deducted is apart, in tds
  currency: string;
  receivedOn: IsoDate; // a cleared cheque: the day it cleared (the day it came is chequeOn)
  method: PaymentMethod;
  factId: string | null; // null only while a cheque is pending: the books count it once it clears
  booksReceiptId: string | null; // calculator receipt for 'received', kept only when its total equals this payment
  booksNote: string | null; // e.g. 'The books receipt covers more than this payment.'
  /** The bank statement row this payment was recorded from (venture.bank.apply); absent when the owner typed it. */
  bankTransactionId?: string;
  // Ink v2 wave 4 (4J5, M11, M15). state: absent on payments recorded before, which read as cleared.
  state?: 'pending' | 'cleared';
  chequeOn?: IsoDate;
  clearedBy?: string;
  clearedAt?: IsoTime;
  /** One payment split across invoices: each part is its own record; groupId and the whole amount are shared. */
  split?: { groupId: string; totalMinor: MinorString };
  /** TDS the client deducted (India): settles the invoice with the cash, pending the client's certificate. */
  tds?: { section: string; amountMinor: MinorString };
};
/** One next step for an invoice by its state, in the engine's words (4J5, M12). draftId: a reminder drafted, not sent yet. */
export type InvoiceNext = { action: 'issue' | 'wait' | 'remind' | 'clear' | 'none'; line: Display; draftId?: string };
/** One line of an invoice's short timeline (4J5, M12): events by date, then where it stands now. */
export type InvoiceTimelineEntry = {
  what: 'issued' | 'viewed' | 'paid' | 'cheque' | 'credited' | 'reminder' | 'reminded' | 'awaiting' | 'settled';
  on: IsoDate;
  line: Display;
};
export type InvoiceView = {
  invoice: InvoiceRecord;
  client: ClientRecord;
  receipt: PriceReceiptRecord;
  payments: PaymentRecord[];
  documentText: string; // plain-text invoice built by deterministic code
  figures: PriceFigure[]; // subtotal, tax lines, total, paid, balance
  notes: string[]; // e.g. what is missing for a tax invoice, why a books receipt is absent
  // Ink v2 wave 4 (4J5). rateChange: a draft whose rate is no longer the plan's; recalculating is the owner's choice.
  next?: InvoiceNext;
  timeline?: InvoiceTimelineEntry[];
  rateChange?: { charged: BpsString; now: BpsString; line: Display };
  credits?: CreditNoteView[];
  /** 4J20: an open invoice past its due day, as invoice.list rows say it; absent otherwise. */
  late?: { days: number; line: Display };
};
export type BooksFigure = { operation: 'billed' | 'received' | 'earned'; label: string; receiptId: string; minor: MinorString; display: string; stale: boolean };
/** A books period the Money place can choose; the engine works out its dates on the owner's local calendar. */
export type BooksPeriodKey = 'all' | 'this-month' | 'last-month' | 'this-year';
export type BooksPeriodChoice = { key: BooksPeriodKey; label: string; from: IsoDate; to: IsoDate };
export type BooksSummary = {
  period: { from: IsoDate; to: IsoDate };
  // The next four are always set by the engine; optional only so older fixtures still type.
  periodKey?: BooksPeriodKey | 'custom'; // 'custom' when the request gave from or to
  periods?: BooksPeriodChoice[]; // every choice with its dates, in the order to show them
  today?: IsoDate; // the owner's local day, in timeZone
  timeZone?: string; // IANA zone for the venture's country; 'UTC' for another country
  currency: string;
  figures: BooksFigure[];
  openInvoices: { invoiceId: string; number: string; clientName: string; balanceMinor: MinorString; balanceDisplay: string; dueDate: IsoDate }[];
  notes: string[]; // honest limits, e.g. about tax and aging; the first one is shown under the Money place
  /** 4J4: the month asked for as the period ('2026-09'), when one was. */
  month?: string;
  /** 4J4: the month before, each figure with its receipt, when the period is one whole calendar month; else null. */
  previous?: { month: string; label: Display; period: { from: IsoDate; to: IsoDate }; figures: BooksFigure[] } | null;
};

// ---------------------------------------------------------------------------
// 7. Build handoff and GitHub follow (P4)
// ---------------------------------------------------------------------------

export const BUILDER_IDS = ['lovable', 'replit', 'bolt', 'v0'] as const;
export type BuilderId = typeof BUILDER_IDS[number];

export type BriefLintRule = 'required-section' | 'required-text' | 'too-long' | 'em-dash' | 'banned-word' | 'contact-detail' | 'price-mismatch' | 'brief-id' | 'first-line';
export type BriefLint = { ok: boolean; findings: { rule: BriefLintRule; line: number | null; message: string }[] };
export type BriefRecord = RecordBase<'venture-brief'> & {
  briefId: string; // ^chb_[a-z0-9]{8}$
  version: number;
  markdown: string; // at most 9000 characters
  chars: number;
  digest: string;
  blueprintDigest: string;
  priceReceiptIds: string[];
  wordsBy: 'model' | 'template';
  modelCallId: string | null;
  lint: BriefLint;
  /** True when the model's words hold a number: a model estimate. Prices in the brief come only from receipts. */
  estimate?: true;
};
export type HandoffPlan = {
  handoffId: string; // the venture-handoff record; send it back with venture.build.handoffOpened
  builder: BuilderId;
  mode: 'link' | 'copy';
  url: string; // https only; bare site in copy mode
  clipboardText: string | null;
  promptChars: number;
  urlChars: number;
  notes: string[]; // fixed lines: privacy and how to turn on GitHub sync for this builder
  label: 'handoff';
  status: 'available' | 'planned';
};
export type HandoffRecord = RecordBase<'venture-handoff'> & {
  builder: BuilderId;
  mode: 'link' | 'copy';
  briefId: string;
  briefDigest: string;
  urlChars: number;
  urlDigest: string;
  openedAt: IsoTime | null; // set by venture.build.handoffOpened after the browser opened it or the copy worked
};
export type RepoRef = { owner: string; name: string };
export type BuildStatusWord = 'waiting-for-repo' | 'repo-connected' | 'builder-making-changes' | 'quiet' | 'sync-conflict' | 'repo-not-readable';
export type BuildStatus = {
  word: BuildStatusWord;
  asOf: IsoTime;
  readId: string | null;
  repo: { fullName: string; private: boolean | null; defaultBranch: string | null; htmlUrl: string | null };
  lastCommit: { sha: string; at: IsoTime; by: 'lovable' | 'replit' | 'you' | 'repo-account' | 'other'; message: string } | null; // message: one line, at most 200 characters
  briefMarker: 'found' | 'older' | 'missing' | 'not-checked';
  briefMarkerVersion: number | null; // the brief version whose id was found
  markerFile: string | null;
  uiWorkflow: 'found' | 'needs-fix' | 'missing' | 'not-checked'; // 'needs-fix': no 'contents: read', or uses pull_request_target
  checks: 'passed' | 'failed' | 'none-reported' | 'not-readable'; // only from the run named 'UI lint'
  deployment: { host: string | null; url: string; at: IsoTime } | null; // url is shown as text with a copy button, never a link
  syncConflictBranch: string | null;
  cannotSay: string[];
};
export type BuildFollowRecord = RecordBase<'venture-build-follow'> & {
  repo: RepoRef;
  tokenState: 'none' | 'in-memory';
  linkedAt: IsoTime;
  lastStatus: BuildStatus | null;
};
export type GitHubReadRecord = RecordBase<'venture-build-read'> & {
  repo: RepoRef;
  calls: { path: string; status: number; etag: string | null; bodyDigest: string; fetchedAt: IsoTime }[];
  transport: 'github-api' | 'fixture';
};
export type GitHubRequest = { path: string; accept: 'json' | 'raw'; etag: string | null; token: string | null };
export type GitHubResponse = { status: number; etag: string | null; body: string; rateRemaining: number | null };
export type GitHubTransport = { read(request: GitHubRequest): Promise<GitHubResponse>; kind: 'github-api' | 'fixture' };
/** Recorded GitHub API pages for tests. Keys are request paths. Strict JSON on disk.
 * String bodies may contain {{name}} placeholders filled by the fixture transport's vars callback. */
export type GitHubFixture = {
  label: 'synthetic recording';
  responses: Record<string, { status: number; etag: string | null; body: Json | string }>;
};

export const CONNECTOR_CATEGORIES = ['build', 'site-domain', 'payments', 'email', 'booking', 'customers', 'messaging', 'docs-ops', 'marketing', 'books-tax', 'legal-entity', 'analytics'] as const;
export type ConnectorCategory = typeof CONNECTOR_CATEGORIES[number];
export type ConnectorModeName = 'handoff' | 'read' | 'write';
export type ConnectorMode = {
  mode: ConnectorModeName;
  status: 'available' | 'planned';
  qualification: 'built-in' | 'fixture-tested' | 'unqualified';
  what: string; // one plain line: what this mode does
  /** 4J7 (K6): how far this mode is proven on this business (build/connector-truth.ts). Set on every card. */
  ladder?: ConnectorLadder;
};
/**
 * 4J7 (K6), the connector truth ladder, lowest to highest: 'documented' (the platform documents it; Chausar does not do
 * it), 'discovered' (Chausar's code does it, tested on a recording or built in, not yet seen working on this business),
 * 'read-verified' (a real read answered here), 'write-verified' (a real write here, read back). 'unavailable': it can't
 * run here at all.
 */
export type ConnectorLadder = 'documented' | 'discovered' | 'read-verified' | 'write-verified' | 'unavailable';
/** 4J7 (K6): one operation a connector really takes, with the only fields it accepts. */
export type ConnectorCapability = { operation: string; mode: ConnectorModeName | PostingModeName; fields: string[] };
/** 4J7 (K11): how to set a connector up with the least access, in Chausar's words (build/guides.ts). */
export type ConnectorGuide = {
  /** Numbered least-privilege steps, in order. */
  steps: string[];
  /** The step people skip. */
  skipped: string;
  /** What the platform charges, with the day Chausar's note was written; "No charge" for Chausar's own parts. */
  charges: { line: string; checkedOn: IsoDate | null };
  /** "Chausar checks access before marking it connected." */
  checks: string;
  /** What it sends, for example "Sends: nothing, so nothing here can change Zoho." */
  sends: string;
  /** What the agents can and can't do with it. */
  agentLimits: string;
  /** A half-configured connection's missing setting, by name; null when nothing is missing. */
  missing: string | null;
};
export type ConnectorCard = {
  id: string;
  name: string;
  category: ConnectorCategory;
  categoryLabel: string;
  modes: ConnectorMode[];
  chips: string[]; // e.g. ['handoff', 'planned: read'] or ['planned: handoff', 'planned: write']
  regions: ('global' | 'india')[];
  regionNote: string | null;
  auth: string;
  vendorUrl: string | null; // a plain 'Visit site' link, not a mode; origin must be in EXTERNAL_ORIGINS
  note: string; // shown on the card
  starter: boolean; // one of about six shown first for this venture
  /** How this connector posts today: the first available posting mode, else the owner-browser-session one. Absent when it does not post. */
  posting?: PostingOption;
  /** Every posting mode in the order api, owner-browser-session, handoff, each with its status, risk and requirements. Empty when it does not post. */
  postingOptions: PostingOption[];
  /** 4J7 (K11): the setup guide; every catalogue card has one. */
  guide?: ConnectorGuide;
  /** 4J7 (K6): the operations it really takes and their fields; empty when it takes none in this build. */
  capabilities?: ConnectorCapability[];
};

/**
 * 'api': the platform's own API, which needs its app review first. 'owner-browser-session': the owner's own signed-in
 * account in a browser on this computer, driven after the owner approves each post. 'handoff': the owner posts it there.
 * Never built: proxy or VPN rotation, fingerprint spoofing, or posting to accounts that are not the owner's.
 */
export type PostingModeName = 'api' | 'owner-browser-session' | 'handoff';
export type PostingOption = {
  mode: PostingModeName;
  status: 'available' | 'planned';
  /** 'unqualified' while available means the code runs but has not been checked against the live site. */
  qualification: 'built-in' | 'fixture-tested' | 'unqualified';
  what: string; // one plain line: what this mode does
  risk: string | null; // shown beside the mode, for example 'The platform may restrict this account.'
  requires: string[]; // what has to be true first, for example 'Meta app review'
  reason: string | null; // why a planned option is planned; null when available
  /**
   * The browser mode of a text platform only (Ink v2 wave 2, 2B2): the oldest day across the three posting steps on
   * which one of the step's candidates last matched exactly one visible element; null while any step has none.
   */
  stepsCheckedOn?: IsoDate | null;
  /** The same mode: the oldest day the text box and the post button last worked, the steps a check can see; null when not checked. */
  boxAndButtonCheckedOn?: IsoDate | null;
  /** 4J7 (K6): how far this posting mode is proven on this business (build/connector-truth.ts). Set on every card. */
  ladder?: ConnectorLadder;
};
/** Each post is its own journal entry: described, then approved, then applied, rejected or outcome_unknown. Never resent. */
export type ConnectorPostState = 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown';
export type ConnectorPostRecord = RecordBase<'venture-connector-post'> & {
  connectorId: string;
  mode: Exclude<PostingModeName, 'handoff'>;
  account: string | null; // the owner's own account, as the owner named it
  text: string; // the post, untrusted agent or owner words
  agent: string | null; // the agent that proposed it; null when the owner wrote it
  digest: string; // what the owner approves: id, connector, mode, account and text
  state: ConnectorPostState;
  describe: string; // one plain line for the approver
  risk: string | null;
  claimedAt: IsoTime | null; // set by the claim, in its own commit after the approval, before the browser or API is touched
  decidedBy: string | null;
  outcome: { line: string; url: string | null; by: 'platform' | 'owner' | 'engine' } | null;
  journal: { state: ConnectorPostState; at: IsoTime; by: string; line: string }[];
  /** The bound approval (P2-journal): the token's hash only, never the token. Absent on posts made before the journal. */
  approval?: ApprovalSeal | null;
  /** An agent proposal waits fifteen minutes (P2-journal). Absent on posts made before the journal. */
  expiresAt?: IsoTime | null;
  /** Whether describe and the view show everything this will send (W1 H21). Absent or false: the approver is told it is incomplete. */
  descriptionComplete?: boolean;
  /** The delivery draft the post comes from, and that draft's digest when proposed (W1 H6). A post is never free text. */
  draftId?: string | null;
  draftDigest?: string | null;
  /** Which of the draft's posts for this channel, from 1, when it holds several. */
  part?: number | null;
  /** The pre-post risk gate's warnings when it was proposed (Ink v2 wave 2, K5), each naming its rule; absent when none. */
  warnings?: string[];
} & JournalAfter;
/**
 * A security check or a platform block seen on one posting channel (W1 H19). 'challenge' (a check, verify or 403 page)
 * stops every automatic action on that channel until the owner clears it; 'blocked' freezes the channel, reads too,
 * until 'until' (72 hours) and is never cleared early. A session that ended is not a hold: the owner signs in again.
 */
export type ChannelHoldRecord = RecordBase<'venture-channel-hold'> & {
  connectorId: string;
  site: string; // the host the browser was on
  cause: 'challenge' | 'blocked';
  line: string;
  until: IsoTime | null; // blocked: when the freeze ends; challenge: null, until the owner clears it
  postId: string | null;
  clearedAt: IsoTime | null;
  clearedBy: string | null;
};
/** The three steps a browser post takes (build/browser.ts): fill the text box, press post, see the post confirmed. */
export type PostingStepId = 'textbox' | 'submit' | 'confirm';
/** One way to find a step's element, in Playwright's public locator terms. name: a role's accessible name; lang: the UI language it is for. */
export type PostingCandidate = { kind: 'test-id' | 'role' | 'aria-label' | 'xpath'; value: string; name?: string; lang?: string };
/**
 * One posting connector's browser steps as checked on this computer (venture.posting.checkSteps): the day each candidate
 * last matched exactly one visible element, by step and candidate key, and the candidates the owner picked by clicking
 * the element once in the window. Shipped candidates stay unchecked until a check run dates them.
 */
export type PostingStepsRecord = RecordBase<'venture-posting-steps'> & {
  connectorId: string;
  checked: { step: PostingStepId; key: string; checkedOn: IsoDate }[];
  added: { step: PostingStepId; key: string; candidate: PostingCandidate; addedOn: IsoDate }[];
};
/** The business's untrusted screen (policy/untrusted.ts): observe until the owner turns on enforce; the newest record wins. */
export type ScreenSettingRecord = RecordBase<'venture-screen-setting'> & { mode: 'observe' | 'enforce' };
/** Held content the owner let through, bound to that exact content's digest; changed content is held again. */
export type UntrustedReleaseRecord = RecordBase<'venture-untrusted-release'> & { digest: string };
/**
 * Whether the rules judge runs on its own on every ready draft that goes to a client or the public (judgeAuto), the
 * newest record wins and none means on. consent: the standing consent for those judge calls, which carry the client's
 * words to the owner's own AI, recorded once: when the owner turns it on ('set'), when the owner approves a write turn
 * whose approval showed the judge's notice and cost ('default', entryId that approved journal entry), or when the owner
 * sends a judge call that waited for want of it ('send', entryId that send's entry); null while off (delivery/judge-run.ts).
 */
export type JudgeSettingRecord = RecordBase<'venture-judge-setting'> & {
  auto: boolean;
  consent: { at: IsoTime; by: string; how: 'set' | 'default' | 'send'; entryId: string | null } | null;
};
/**
 * The action journal (P2-journal, venture/journal/). Every outside effect is one entry: described, then approved inside
 * the app, then applied, rejected or outcome_unknown. A connector post is its own journalled record with the same fields.
 */
export const JOURNAL_ACTION_IDS = ['invoice.issue', 'delivery.send', 'connector.post', 'site.apply', 'bank.alert', 'connector.write', 'notify.push', 'notify.relay', 'credit.issue'] as const;
export type JournalActionId = typeof JOURNAL_ACTION_IDS[number];
export type JournalState = ConnectorPostState;
export type JournalStep = { state: JournalState; at: IsoTime; by: string; line: string };
/**
 * What an approval leaves behind. The token itself reaches only the code that applies it, never a record, a log or a
 * model. usedAt and key are set by the claim, in its own commit, before the effect starts: one token, one apply.
 */
/** approvedBy: null when no person approved it: a send under a standing setting (the rules judge on its own). */
export type ApprovalSeal = { tokenHash: string; approvedBy: string | null; at: IsoTime; expiresAt: IsoTime; usedAt: IsoTime | null; key: string | null };
export type JournalRecord = RecordBase<'venture-journal-entry'> & {
  action: JournalActionId;
  subject: string; // the record it acts on, such as an invoice id, or a run and its call
  target: string; // who or what it touches, in plain words
  actionDigest: string; // exactly what the owner approves
  describe: string; // one plain line for the approver
  agent: string | null; // the agent that proposed it; null when the owner did
  shadow: boolean; // rehearsal: simulated for the agent, never approved or applied
  quote: { figure: string; payer: string } | null; // bound like a spend quote: the draft, the figure and the payer, for an hour
  state: JournalState;
  claimedAt: IsoTime | null; // committed before the effect starts
  decidedBy: string | null;
  outcome: { line: string; url: string | null; by: 'platform' | 'owner' | 'engine' } | null;
  receiptId: string | null;
  journal: JournalStep[];
  approval: ApprovalSeal | null;
  expiresAt: IsoTime;
  /** Whether describe shows everything this will send (W1 H21): false unless the proposer said true. Absent on older entries. */
  descriptionComplete?: boolean;
  /** 4J10 (H28): the account the owner approved this for; it never runs under another (ACCOUNT_FENCE). Absent: none named. */
  account?: string | null;
  /** 4J10 (H28): the connected service's operation a connector.write runs, one Chausar knows (send-deliverable). */
  operation?: string;
  /** 4J10 (H28): keys this action provides, and keys it waits for: it runs after their providers apply, and ends with a refusal. */
  provides?: string[];
  dependsOn?: string[];
  /** 4J10 (H27): a retry of an entry on several targets, and the failed targets it covers, never more. */
  retryOf?: string | null;
  covers?: string[];
} & JournalAfter;
/**
 * 4J10 (H27): what a provider reports after applied (accepted, processed, shown, result; verified needs a dated
 * acceptance check), and, for an action on several targets, how each target ended. On journal entries and posts.
 */
export type JournalEndState = 'accepted' | 'processed' | 'shown' | 'result' | 'verified';
export type JournalEndStep = { state: JournalEndState; at: IsoTime; by: 'platform' | 'engine' | 'owner'; line: string; check?: { id: string; checkedOn: IsoDate } };
export type JournalTargetOutcome = { id: string; outcome: 'applied' | 'rejected' | 'partial' | 'unknown' | 'throttled'; line: string };
export type JournalAfter = { ends?: JournalEndStep[]; targets?: JournalTargetOutcome[] } & ChainStamp;
/**
 * 4J10 (H26): the seq of a record's first link in the chained journal, stamped on the record when it is first linked, so
 * a vault holding stamped records with no chain record or no pin reads corrupt instead of as one from before the chain.
 */
export type ChainStamp = { chainSeq?: number };
export type BrowserProbe = { present: boolean; reason: string };
/** added: the candidates the owner picked for this platform on this computer (venture-posting-steps), tried first. */
/**
 * clickBy: milliseconds since 1970 after which the browser never presses the post button (the journal may already have
 * closed the post as unknown by then).
 */
export type BrowserPostJob = { postId: string; connectorId: string; text: string; timeoutMs: number; added?: PostingStepPick[]; clickBy?: number };
/** One candidate the owner picked for a step by clicking the element once in the window (Ink v2 wave 2, 2B2). */
export type PostingStepPick = { step: PostingStepId; candidate: PostingCandidate };
/** venture.posting.checkSteps asks the browser to find each step's candidates on the compose page, without typing or clicking. */
export type BrowserStepsJob = { connectorId: string; timeoutMs: number; added: PostingStepPick[] };
/**
 * 'checked': how many visible elements each candidate matched (only exactly one counts), and what the owner picked for
 * a step none matched. 'signed-out': the owner signs in first. 'not-run': the reason, a hold the page showed, or
 * refused when the script guard refused a page script. audit: the guard's lines, sha256 and counts only.
 */
export type BrowserStepsResult =
  | { outcome: 'checked'; steps: { step: PostingStepId; key: string; visible: number }[]; picked: PostingStepPick[]; audit: string[] }
  | { outcome: 'signed-out'; line: string; audit: string[] }
  | { outcome: 'not-run'; line: string; hold?: BrowserSiteHold; refused?: boolean; audit: string[] };
/** A security check or a platform block the browser saw on the site (W1 H19). The posting code keeps it as a channel hold. */
export type BrowserSiteHold = { kind: 'challenge' | 'blocked'; site: string };
/** 'not-sent': the platform was never reached, so nothing went out. 'unknown': it may have gone out; check before posting again. */
export type BrowserPostResult =
  | { outcome: 'posted'; line: string; url: string | null; checked?: { step: PostingStepId; key: string }[] }
  | { outcome: 'not-sent'; line: string; hold?: BrowserSiteHold }
  | { outcome: 'unknown'; line: string; hold?: BrowserSiteHold };
/**
 * Drives the owner's own browser on this computer. The real one needs Playwright with Chromium already installed.
 * clearHold: the owner cleared a platform's security check; the hold kept beside the profile folders ends (W1 H19).
 * signIn: opens the platform's own sign-in page in the Chausar profile and settles when the owner closes the window
 * (venture.posting.signIn does not wait for it, Ink v2 wave 2).
 */
export type BrowserPort = {
  probe(): Promise<BrowserProbe>; post(job: BrowserPostJob): Promise<BrowserPostResult>; clearHold?(connectorId: string): Promise<void>;
  /**
   * 4J10 (H28): the account signed in to this platform in the Chausar profile, as the platform names it; null when it
   * cannot tell. A post approved for a named account is refused unless this names the same one (ACCOUNT_FENCE).
   */
  signedInAccount?(connectorId: string): Promise<string | null>;
  signIn?(connectorId: string): Promise<BrowserProbe>;
  /** Finds each posting step's candidates on the compose page without typing or clicking (venture.posting.checkSteps). */
  checkSteps?(job: BrowserStepsJob): Promise<BrowserStepsResult>;
};
export type ApiPostPort = { post(job: BrowserPostJob): Promise<BrowserPostResult>; signedInAccount?(connectorId: string): Promise<string | null> };
/** A post's fingerprint (playbooks/social/risk-gate.ts postPrint): sha256 prefixes of its word groups and linked sites. */
export type PostPrint = { shingles: string[]; domains: string[] };
/** One post that went out, or may have, from any business on this computer: its fingerprint, never its words. */
export type PostLogEntry = { id: string; connectorId: string; at: IsoTime; print: PostPrint };
/**
 * One posting history per computer (build/post-log.ts), kept beside the browser profiles, so two businesses signed in
 * to the same account are counted together by the risk gate (Ink v2 wave 2, K5).
 */
export type PostLogPort = { read(connectorId: string): PostLogEntry[]; append(entry: PostLogEntry): void };
export type ConnectorPorts = {
  browser?: BrowserPort;
  /** Connector ids whose API app review is recorded (the real host reads CHAUSAR_APP_REVIEWED). */
  appReviewed?: readonly string[];
  /** API posting clients by connector id. None ship in this build. */
  api?: Readonly<Record<string, ApiPostPort>>;
  postTimeoutMs?: number;
  /** The per-computer post log; the real host leaves it out and gets the one on disk beside the browser profiles. */
  postLog?: PostLogPort;
};
/** A staged edit to one website file: applied only with the exact plan digest the owner reviewed, verified, reversible. */
export type SiteEditState = 'staged' | 'applying' | 'applied' | 'rolled-back' | 'rejected' | 'needs-inspection';
export type SiteEditRecord = RecordBase<'venture-site-edit'> & ChainStamp & {
  target: { kind: 'local-folder' | 'github'; identity: string };
  path: string;
  summary: string;
  before: string;
  after: string;
  beforeDigest: string;
  afterDigest: string;
  planDigest: string;
  state: SiteEditState;
  log: { at: IsoTime; by: string; step: 'staged' | 'applied' | 'verified' | 'rolled-back' | 'rejected' | 'needs-inspection'; line: string }[];
};

/**
 * A bank account the owner imports statements into (venture.bank.import, venture.bank.consent). label is the owner's
 * own name for it. consent is read-only access with an end date; no bank provider is wired, so provider stays null and
 * polls (unattended reads, four a day at most) stays empty until one is.
 */
export type BankConsentData = {
  id: string; provider: string | null; accountLabel: string; scope: 'read-only'; grantedAt: IsoTime; expiresAt: IsoTime; revokedAt: IsoTime | null;
};
/**
 * rules: the owner's alert rules for this account (build/bank.ts evaluateAlerts); alertAddress: where alerts go, set
 * by the owner inside the app only. Both absent until the owner sets them (venture.bank.alerts.set).
 */
export type BankAccountRecord = RecordBase<'venture-bank-account'> & {
  label: string; currency: string; consent: BankConsentData | null; polls: IsoTime[];
  rules?: BankAlertRule[]; alertAddress?: { url: string; setBy: string; setAt: IsoTime } | null;
};
/** amountMinor is signed: money in positive, money out negative. id is stable, so a second import never counts a row twice. */
export type BankTransactionData = {
  id: string; date: IsoDate; amountMinor: MinorString; currency: string; counterparty: string | null; description: string | null;
  reference: string | null; balanceAfterMinor: MinorString | null; source: 'statement-csv' | 'provider';
};
/**
 * One statement import: only the transactions it added, with how many were already there and which lines were refused.
 * alerts: what the owner's alert rules found in this import (2D), absent when none did; Today shows them in the app.
 */
export type BankImportRecord = RecordBase<'venture-bank-import'> & {
  accountId: string; fileDigest: string; transactions: BankTransactionData[]; duplicates: number; rejected: { line: number; reason: string }[]; line: string;
  alerts?: BankAlert[];
};
export type BankImportResult = {
  account: string; accountId: string; added: number; duplicates: number; rejected: { line: number; reason: string }[]; line: Display; transactions: number;
};
export type BankConsentView = {
  account: string; accountId: string; consent: BankConsentData;
  status: { state: 'active' | 'expiring' | 'expired' | 'revoked'; daysLeft: number; line: Display };
  provider: Display; // why nothing reads the bank yet
};
/**
 * The owner's decision on one bank statement row (venture.bank.apply): recorded as a payment of an invoice, written to
 * the books as a cost, or skipped. One per row; the payment, the books fact or neither is named. transactionId is the
 * ledger row id, '<account id>:<transaction id>', unique in the business even when two accounts hold the same file.
 */
export type BankMatchRecord = RecordBase<'venture-bank-match'> & {
  transactionId: string; accountId: string; as: 'payment' | 'cost' | 'skip';
  invoiceId: string | null; paymentId: string | null; factId: string | null;
};

/** Leads (customers/leads.ts): a lead needs its source page; an email counts once a mail server check found a server. */
export type LeadEmailCheck = { status: 'unverified' | 'verified' | 'failed'; at: IsoTime | null; line: string };
export type OutreachDraftView = {
  id: string; leadId: string; to: string; subject: string; text: string;
  footer: { businessName: string; postalAddress: string; unsubscribe: string }; sourceUrl: string; by: 'agent' | 'owner'; at: IsoTime; digest: string;
};
export type LeadSendView = { draftId: string; sentAt: IsoTime; recordedBy: string; recordedAt: IsoTime; channel: 'own-mailbox' };
/** A lead's stage moves forward only; won and lost are terminal; blocked (an opt-out) is never left. Each move keeps its evidence. */
export type LeadStageView = 'new' | 'drafted' | 'contacted' | 'replied' | 'won' | 'lost' | 'blocked';
export type LeadMoveView = { from: LeadStageView; to: LeadStageView; at: IsoTime; by: string; evidence: { kind: 'draft' | 'send' | 'reply' | 'outcome' | 'opt-out'; id: string } };
export type LeadView = {
  id: string; name: string; company: string | null; email: string | null; emailDomain: string | null; sourceUrl: string; emailCheck: LeadEmailCheck;
  status: LeadStageView; drafts: OutreachDraftView[]; sends: LeadSendView[]; moves: LeadMoveView[]; addedBy: string; addedAt: IsoTime;
};
export type LeadRecord = RecordBase<'venture-lead'> & Omit<LeadView, 'id'>;
/** The business's outreach settings: the postal address every draft carries (set by the owner only) and the blocklist. */
export type LeadSettingsRecord = RecordBase<'venture-lead-settings'> & {
  postalAddress: string | null; blockedEmails: string[]; blockedDomains: string[];
  /** 4E2: phones (E.164) and LinkedIn profile addresses, so a "stop" on WhatsApp or LinkedIn is honoured; absent is none. */
  blockedHandles?: string[];
};

/** https origins the app may open from a user click. Mirrored verbatim in app/desktop/ipc-contract.cjs. */
export const EXTERNAL_ORIGINS = Object.freeze([
  'https://lovable.dev', 'https://replit.com', 'https://bolt.new', 'https://v0.app', 'https://github.com',
  'https://vercel.com', 'https://www.netlify.com', 'https://www.cloudflare.com', 'https://porkbun.com', 'https://www.namecheap.com',
  'https://razorpay.com', 'https://www.cashfree.com', 'https://stripe.com', 'https://www.paypal.com', 'https://www.lemonsqueezy.com', 'https://www.paddle.com', 'https://dodopayments.com',
  'https://workspace.google.com', 'https://www.zoho.com', 'https://resend.com', 'https://postmarkapp.com',
  'https://cal.com', 'https://calendly.com', 'https://calendar.google.com',
  'https://www.hubspot.com', 'https://attio.com',
  'https://business.whatsapp.com', 'https://telegram.org', 'https://slack.com', 'https://discord.com',
  'https://www.notion.com', 'https://drive.google.com', 'https://linear.app', 'https://www.airtable.com',
  'https://www.linkedin.com', 'https://x.com', 'https://www.instagram.com', 'https://www.facebook.com', 'https://ads.google.com', 'https://buffer.com',
  // 4E2: WhatsApp click-to-chat, the handoff that opens a chat with the text filled in; the owner presses send.
  'https://wa.me',
  'https://www.youtube.com', 'https://studio.youtube.com',
  'https://tallysolutions.com', 'https://www.xero.com', 'https://quickbooks.intuit.com',
  'https://www.mca.gov.in', 'https://www.gst.gov.in', 'https://documenso.com', 'https://www.docusign.com', 'https://www.firstbase.io',
  'https://posthog.com', 'https://plausible.io', 'https://analytics.google.com', 'https://tally.so', 'https://www.typeform.com',
  'https://console.anthropic.com', 'https://platform.openai.com',
  // 5M catalogue links do not grant provider API access.
  'https://overpass-api.de', 'https://operations.osmfoundation.org', 'https://developers.google.com',
  'https://redditinc.com', 'https://developer.happenstance.ai',
] as const);

// ---------------------------------------------------------------------------
// 8. Delivery agents, rehearsal (simulation), launch ladder, signals (P5)
// ---------------------------------------------------------------------------

/** 'work' is hands-on work with tools (files, the sandbox, the calculator); it never writes to the client. */
export type StepKind = 'gather' | 'question' | 'work' | 'compute' | 'write' | 'verify' | 'approve' | 'operator';
/** 'owner-cli': the owner's own Claude Code or Codex on this computer, started only after the owner approves a brief. */
export type ExecutionTier = 'code' | 'actor' | 'wasm-lite' | 'wasm' | 'container' | 'owner-cli' | 'hosted';
/**
 * claims-grounded: every figure, date, name and certification in the draft's own words is in the client's message,
 * the answers, the files, the tool results or the receipts (no model). rules-judge: the judge's yes/no votes on the
 * draft rules, each citing evidence from the run, counted by code against each rule's floor; it runs in rehearsal only.
 * receipts: every number in the draft's words has a receipt or is labelled a model estimate (money, rates and tax fail
 * where the playbook allows no estimate), every file and link it names is in the run's evidence, and no number is one
 * the calculator refutes. prompt-leak: no words meant for the AI in a draft no flagship playbook checks (prompt-leak.ts).
 */
export const CHECK_IDS = ['no-numeric-prose', 'figures-resolve', 'required-sections', 'no-outside-writes', 'house-style', 'prompt-leak', 'length-bounds', 'turn-limit', 'questions-raised', 'no-done-claims', 'claims-grounded', 'receipts', 'rules-judge'] as const;
export type CheckId = typeof CHECK_IDS[number];
export type PlaybookStep = {
  id: string;
  kind: StepKind;
  title: string;
  tier: ExecutionTier; // the lowest tier that can do the step
  model: ModelTier | null; // null for code steps
  doneBy: 'agent' | 'you' | 'agent-then-you';
  requiredSections: string[]; // write steps only
  checks: CheckId[];
  /** Tools this step may call. Deny by default: a tool not named here is refused. Absent on older records. */
  tools?: ToolName[];
  /** Extra instructions for this step, words only. The improvement loop adds and removes these. */
  guidance?: string[];
  /**
   * Ink v2 wave 4 (4J12 validates them, 4F2 skips an optional step under budget pressure; no shipped step has them in
   * W4): skipped first under pressure; edges to the next step by outcome; a loop cap and what happens past it; a
   * timeout with an ordered list of steps to fail over to.
   */
  optional?: boolean;
  next?: StepEdge[];
  maxLoops?: number;
  onExceeded?: 'blocked' | 'failed';
  timeoutMs?: number;
  failover?: string[];
  /**
   * 4J12 (H23): an approval step's gate. When the owner has not decided within timeoutMs, the run ends with the
   * default: blocked or failed, never approved (a gate that times out never decides for the owner).
   */
  gate?: { timeoutMs: number; default: 'blocked' | 'failed' };
  /**
   * Ink v2 wave 4 (4F1, O21): the connector modes an agent step needs, by catalogue id. A run whose agent step needs a
   * mode that is only planned does not start (RUN_CAPABILITY_MISSING); nothing is put in its place.
   */
  needs?: { connector: string; mode: ConnectorModeName }[];
};
/** One edge from a step to the next by its outcome (4J12). */
export type StepEdge = { on: 'done' | 'failed' | 'blocked' | 'timeout'; to: string };
export type PlaybookRecord = RecordBase<'venture-playbook'> & {
  version: number;
  hash: string; // digest of steps (format 2: of steps, limits and aliases); recorded on every run
  blueprintDigest: string;
  serviceType: ServiceType;
  steps: PlaybookStep[];
  validated: true;
  tierCeiling: ExecutionTier;
  /** 2 for playbooks with agent tools. Older records have no format and are rebuilt on first use. */
  format?: 2;
  limits?: HarnessLimits;
  /** Extra words that find a dictionary entry, by entry id. Model-specific exposure, changed by the improvement loop. */
  aliases?: Record<string, string[]>;
  /** The patches applied on top of the plan's steps, oldest first. A rebuild for a changed plan applies them again. */
  patches?: PlaybookPatch[];
  parentId?: string | null; // the version this one was patched from
  /** 'owner': a version the owner's own words made from chat ("from now on", 4B1). */
  origin?: 'plan' | 'improvement' | 'owner';
  /**
   * The flagship playbook whose typed steps these are (venture/playbooks/steps.ts), for a plan that playbook made.
   * Its checks run on every draft (playbookChecks) and its roles are the team. Absent on the eight fixed steps.
   */
  flagship?: string;
};

export type TextPart =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; receiptId: string; figureKey: PriceFigure['key'] | WorkFigureKey }
  | { kind: 'date'; dateRef: DateRef; iso: IsoDate };
/** Work that code rendered from a work receipt and attached after the agent's words. */
export type DeliverableAttachment = { kind: 'reconciliation'; receiptId: string };
/** A draft reply. Never called a deliverable on screen: agents in this build only draft. */
export type Deliverable = {
  title: string;
  sections: { heading: string; parts: TextPart[] }[];
  questionsForClient: string[];
  attachments?: DeliverableAttachment[];
  /** True when the model's words hold a number: shown as a model estimate. Only figure parts carry receipts. */
  estimate?: true;
  /**
   * Ink v2 wave 4 (4J16, Q4): the quotes code moved to their time in the transcript before the checks (round 1 of the
   * quote check, playbooks/draft-checks.ts withQuoteFixes), one line each. Set by code only; absent when none moved.
   */
  quoteFixes?: string[];
};
/** notChecked: rules-judge only, when no rule was settled by a vote with checked evidence. It is not a pass, and not a failure either. */
export type CheckResult = { check: CheckId; passed: boolean; detail: string; notChecked?: true };
/**
 * One deterministic check of a flagship playbook on a draft (venture/playbooks/draft-checks.ts), run by code with no
 * model. 'not-run' says why it could not run (no cut, no transcript, ffmpeg not here); it is never a pass. A 'fail'
 * blocks Accept like a failed CheckResult.
 */
export type PlaybookCheckResult = { playbook: string; check: string; outcome: 'pass' | 'fail' | 'not-run'; detail: string };

export type Scenario = {
  id: string;
  serviceType: ServiceType;
  title: string;
  persona: string;
  brief: string;
  expectedOutcome: string;
  stoppingCriteria: ('deliverable-ready' | 'client-asks-for-person' | 'turn-limit')[];
  turnLimit: number; // 1 to 4
  episodes: number; // 1 to 3
  mocks: Record<string, 'record-only'>;
  checks: CheckId[];
  source: 'template' | 'signal';
  signalId: string | null;
  /** Practice files this made-up client sends; the agent loop works on them. Absent when there are none. */
  files?: string[];
  /**
   * Ink v2 wave 4 (4J16, Q15): on a case made from the owner's edit or send-back, what a practice draft must and must
   * not do, made by code from the review (delivery/corrections.ts). Absent on other cases.
   */
  expectations?: CorrectionExpectation[];
};
/** 4J16 (Q15): one typed expectation of a regression case. Its words come from fixed lists and headings, never the client's. */
export type CorrectionExpectation =
  | { kind: 'mentions'; text: string } | { kind: 'not-mentions'; text: string }
  | { kind: 'hands-off'; to: 'client' | 'owner' } | { kind: 'uses-tool'; tool: string } | { kind: 'cites'; what: 'figure' };
/** 4J16: an expectation checked on a practice draft; 'not-checked' for a template outline or a check that cannot run. */
export type ExpectationResult = { expectation: CorrectionExpectation; outcome: 'pass' | 'fail' | 'not-checked'; detail: string };
export const JUDGE_QUESTIONS = ['goal-met', 'tone-fits', 'policy-followed', 'no-unbacked-claims'] as const;
export type JudgeQuestionId = typeof JUDGE_QUESTIONS[number];
/** estimate: true when the judge's reason holds a number it wrote; never a receipt. */
export type JudgeAnswer = { question: JudgeQuestionId; answer: 'yes' | 'no' | 'unsure' | 'not-judged'; reason: string; callId: string | null; estimate?: true };
export type EpisodeTurn = { turn: number; by: 'client' | 'agent'; text: string; author: 'model' | 'template'; callId: string | null };
export type MockEffect = { connector: string; operation: string; payloadDigest: string; recordedAt: IsoTime };
export type Episode = {
  scenarioId: string;
  index: number;
  turns: EpisodeTurn[];
  deliverable: Deliverable | null;
  renderedText: string | null;
  mocks: MockEffect[];
  checks: CheckResult[];
  judge: JudgeAnswer[];
  passed: boolean;
  firstFailure: string | null;
  costMicros: MicroString;
  /** The agent's turns, tool calls and work when the practice client sent files. Absent or null otherwise. */
  harness?: HarnessState | null;
  /** A flagship playbook's own checks on this practice draft; a 'fail' fails the episode. Absent for other playbooks. */
  playbookChecks?: PlaybookCheckResult[];
  /** 4J16 (Q15): the case's expectations from the owner's corrections, checked on this draft; a 'fail' fails the episode. */
  expectations?: ExpectationResult[];
};
export type SimulationRunRecord = RecordBase<'venture-simulation-run'> & {
  playbookId: string;
  playbookHash: string;
  scenarioIds: string[];
  episodes: Episode[];
  passed: boolean;
  summary: { scenarios: number; passed: number; failed: number };
  costMicros: MicroString;
  costDisplay: string;
  startedAt: IsoTime;
  finishedAt: IsoTime;
  modelMode: 'model' | 'template' | 'mixed';
};

export const DELIVERY_REASONS = ['wrong-fact', 'missing-fact', 'missing-section', 'off-brief', 'tone', 'format', 'too-long', 'too-short', 'wrong-number', 'late', 'claims-work-not-done', 'other'] as const;
export type DeliveryReason = typeof DELIVERY_REASONS[number];
/**
 * 'needs-answer': the agent handed off with a question, and the run waits for the owner's answer. 'brief-waiting': the
 * agent asked for heavy work, and the run waits for the owner to approve or decline the exact brief.
 */
/** 'stopped': the owner stopped it, or a breaker did (Ink v2 wave 4, 4F1 and 4F2); finished steps are kept and Resume goes on. */
export type DeliveryRunStatus = 'waiting-for-you' | 'needs-answer' | 'brief-waiting' | 'ready-for-review' | 'accepted' | 'edited' | 'rejected' | 'failed' | 'stopped';
/** A run's immutable selected workflow, bound to its original base and intake. */
export type DeliveryWorkflow = {
  orderId: string; offerId: string; baseHash: string; intakeDigest: string; hash: string;
  steps: PlaybookStep[]; limits: HarnessLimits; aliases: Record<string, string[]>;
  dictionary: { id: string; kind: 'term' | 'offer' | 'step' | 'approval' | 'setting' | 'definition' | 'concept'; name: string; meaning: string; aliases: string[] }[];
};
export type DeliveryRunRecord = RecordBase<'venture-delivery-run'> & {
  workflow?: DeliveryWorkflow;
  orderId: string;
  /** Ink v2 wave 5 (5A1, playbooks/kit/chain.ts): the chain stage this run drafts, when the order is past its first; absent is stage 1. */
  chainStage?: number;
  playbookId: string;
  playbookHash: string;
  status: DeliveryRunStatus;
  servedBy: 'model' | 'template' | 'owner'; // 'template': an outline no AI wrote, that never read the client's request; 'owner': the owner's own copy (4J2)
  practice: boolean; // true for drafts made at the shadow stage: never copied, saved or accepted
  callId: string | null;
  preview: ModelPreview | null; // set while waiting for the owner to approve the send
  deliverable: Deliverable | null;
  renderedText: string | null;
  checks: CheckResult[];
  verdict: { choice: 'accepted' | 'edited' | 'rejected'; reason: DeliveryReason | null; at: IsoTime } | null;
  editedText: string | null;
  /** The agent loop, for an order with files. Each model turn waits for the owner's approval of its exact text. */
  harness?: HarnessState | null;
  uploadIds?: string[]; // the client files this run may read, fixed when the run starts
  /** A flagship playbook's own checks on the draft; a 'fail' blocks Accept. Absent for other playbooks. */
  playbookChecks?: PlaybookCheckResult[];
  /**
   * The rules judge on this real-order draft. Its call carries the client's words: it goes on its own only under the
   * business's standing consent (judgeAuto, auto: true), else it waits for the owner to send it (venture.delivery.judge,
   * then judgeSend). Its verdict is the rules-judge result in checks. Absent until the judge was asked.
   * draftDigest: the draft it read (judged once per draft); estimatedMaxCostDisplay: the most the call could cost, as
   * the model port wrote it; line: why it did not run or failed, in plain words, else null.
   */
  judge?: {
    status: 'waiting' | 'done' | 'failed'; callId: string | null; preview: ModelPreview | null; at: IsoTime;
    draftDigest?: string; auto?: boolean; estimatedMaxCostDisplay?: string | null; line?: string | null;
    /** 4J14 (Q7): each rule's result as code counted it when the judge answered (judge-run.ts); absent before 4J14. */
    rules?: JudgeRuleResult[];
    /**
     * 4J13 (H30): the automatic judge waits while the owner works on the desktop with a local or busy AI (status
     * 'waiting', no preview, line "Waiting: ..."); the cost bound its approval showed, kept so the sweep's retry goes
     * on its own only within it. Absent otherwise.
     */
    deferred?: { boundMicros: string | null; bound: string };
  };
  /**
   * Set by the commit that makes a draft ready when its write turn's approval showed the judge's notice: the judge is
   * due, so Accept waits until it was asked or until (delivery/runs.ts judgeReading). boundMicros: the most the judge's
   * check could cost as shown (bound is its words), null when no price was known; the judge goes on its own only within
   * it. Cleared once the judge was asked.
   */
  judgePending?: { boundMicros: string | null; bound: string; until: IsoTime } | null;
  /** Ink v2 wave 4 (4F1, O21): what this run may do, frozen when it started. Absent on runs made before. */
  scope?: RunScope;
  /** Ink v2 wave 4 (4F2, H32): when an AI-written draft was kept, stamped in that commit; the drafts cap counts these. */
  readyAt?: IsoTime;
  /**
   * Ink v2 wave 4 (4J1, J2): what the owner's Accept or edit covered, file by file (file id to sha256 of its bytes), set
   * when the draft hands over files; a share, post or send of them is FILE_CHANGED once any byte differs.
   */
  manifest?: FileManifest | null;
  /**
   * 4J1: the times a changed file cleared the owner's acceptance and sent the draft back for review, when the last one
   * was and which files had changed; Today's review row takes a new version from it. Absent until it first happens.
   */
  reopened?: { count: number; at: IsoTime; files: string[] };
  /** 4J13 (H34): the lease an approved call holds on its run while it is out; renewed while it runs; absent or null otherwise. */
  lease?: RunLease | null;
  /** 4J13 (H34): set when Chausar stopped while an approved call ran: the run went back to waiting and nothing was sent again. */
  interrupted?: RunInterruption;
  /** 4J13 (H30): what background jobs reported into this run, once each by message id (the delivery marker). */
  reports?: RunReport[];
  /** Ink v2 wave 4 (4J18): a one-step draft's sources from what the AI knows, by id, as its approved text carried them. */
  knowledge?: string[];
  /** 4J2 (O5): a send-back or fix waiting for its revision turn to land; null or absent otherwise (delivery/revise.ts). */
  revision?: DraftRevision | null;
  /** 4J2 (O6): the paragraph merge made when the last revision landed; editedText holds its result when it differs. */
  merge?: DraftMerge | null;
  /** 4J2: the last fix's checks run again on the revised draft, and the fix's status. */
  fix?: DraftFix | null;
  /** 4J2 review: the draft that went out which this owner draft was copied from (venture.delivery.copy). */
  copiedFrom?: string;
};
/**
 * 4J13 (H34): an approve call's lease on its run. holder: the engine process that took it; callId: the call it covers;
 * expiresAt: the dated recheck, renewed while the call runs; reason: why the run is held, in plain words.
 */
export type RunLease = { holder: string; token: string; callId: string; takenAt: IsoTime; expiresAt: IsoTime; reason: string };
/**
 * 4J13 (H34): every step state of an interrupted run: the stored calls of its earlier turns (done, error, or skipped when
 * cancelled), then the cut turn's from its run.call events (running: it never came back; done; error). The cut turn's
 * calls that had not started are not listed: the turn's plan reaches the vault only when the turn commits, so a call
 * still pending at the crash is not known to anyone. Steps of the playbook not reached show as pending on the run sheet.
 */
export type RunInterruption = { at: IsoTime; line: string; callId: string; steps: { callId: string; state: RunStepState }[] };
/** 4J13 (H34): one step's state, as it survives a restart. */
export type RunStepState = 'pending' | 'running' | 'done' | 'error' | 'skipped';
/** 4J13 (A12): how long a routine's parked run waits for the owner's approval before it counts as no. */
export const ROUTINE_ANSWER_MS = 24 * 60 * 60_000;
/** 4J13 (H30): one report a background job delivered into the run that asked; warning: set when it named no sources. */
export type RunReport = { messageId: string; from: 'heavy-work' | 'research'; at: IsoTime; line: string; sources: string[]; warning: string | null };
/** The files one Accept covered (4J1): file id to sha256 of its bytes, who accepted and when. */
export type FileManifest = { files: Record<string, string>; at: IsoTime; by: string };
/**
 * A run's scope (4F1): the tools granted, the ones that propose an outside action for the owner's approval, the spend
 * cap and the posture it works at, as they were when the run started.
 */
export type RunScope = { tools: ToolName[]; actions: ToolName[]; capMicros: MicroString; posture: Posture; frozenAt: IsoTime };
/**
 * A delivery run as the screens read it: the stored record plus what the engine would allow right now, at today's
 * launch stage. Never stored.
 */
export type DeliveryRunView = DeliveryRunRecord & {
  practiceNow: boolean; // a practice draft at today's stage: never accepted, copied or saved
  awaitingYou: boolean; // belongs on Today's list of things waiting for the owner
  canApprove: boolean; // waiting for the owner, and the engine would send it if approved now
  canAccept: boolean; // ready for review, and the engine would take Accept now
  acceptBlocked: string | null; // why Accept is refused, in plain words; null when canAccept or the run is not ready
  /**
   * On a waiting write turn when the judge would then read the draft on its own and no standing consent is recorded:
   * the setting's words and what the judge's check could cost, read before approving (delivery/judge-run.ts). Set by
   * the delivery methods and Today; absent or null otherwise.
   */
  judgeNotice?: string | null;
  /** 4H1 (U17): which engine wrote the draft ("Written by Claude Sonnet 5.5", or the template's words); null before an answer. */
  writtenBy?: Display | null;
};
export type SignalRecord = RecordBase<'venture-signal'> & {
  source: 'owner-rejected' | 'owner-edited' | 'check-failed';
  runId: string;
  /** Also the id of the first rule the rules judge failed a real draft on (a JudgeRule id, judge-run.ts). */
  reason: DeliveryReason | CheckId | (string & {}) | null;
  scenarioId: string | null; // set once turned into a rehearsal case
};
export type ImprovementReadiness = {
  judged: number;
  rejectedOrEdited: number;
  due: boolean; // at least 10 judged with at least 3 rejected or edited, or 14 days with any judged
  reason: string;
  status: 'available' | 'planned'; // 'available' since the gated improvement loop (venture.improve.*) landed
};
export type LaunchStatus = {
  stage: LaunchStage;
  stages: { stage: LaunchStage; allowed: boolean; reason: string; status: 'available' | 'planned' }[];
  /** Newest run per template scenario for the current playbook; judged means a model wrote and a judge answered. */
  rehearsal: { scenarioId: string; runId: string | null; passed: boolean | null; judged: boolean }[];
  lastRunId: string | null;
  lastRunPassed: boolean | null;
  acceptedDeliveries: number;
  improvement: ImprovementReadiness;
};

export type CapabilityState = 'available' | 'needs-setup' | 'unverified' | 'planned' | 'unavailable';
export type CapabilityStatus = { id: string; group: 'runtime' | 'storage' | 'sandbox' | 'models' | 'connectors'; label: string; state: CapabilityState; reason: string };

// ---------------------------------------------------------------------------
// 8b. Delivery harness: agent tools, the agent loop, sandboxes, client files, work receipts, improvement
// ---------------------------------------------------------------------------

/** Every tool a delivery agent can be granted. Names are 'collection.function', the agentOS host-function shape. */
export const TOOL_NAMES = [
  'files.list', 'files.read', 'dictionary.browse', 'dictionary.resolve',
  'calc.sum', 'calc.totals', 'books.reconcile', 'bills.pick',
  'sandbox.transform', 'sandbox.python',
  'handoff.client', 'handoff.owner', 'outbox.propose',
  'agent.delegate',
  // Ink v2 wave 2: a flagship playbook's own tools (delivery/harness/patches.ts FLAGSHIP_TOOLS): the CA firm's tax
  // engines, the YouTube pieces and the social report figures; and the note any agent makes of where a fact came from.
  'tax.income', 'tax.interest', 'tax.gst', 'tax.tds', 'tax.statements', 'tax.portal',
  'youtube.hooks', 'youtube.editList', 'youtube.chapters', 'youtube.retention',
  'social.report',
  'evidence.record',
  // Ink v2 wave 5 (named by package 5-0; each answers NOT_BUILT_YET until its package lands). The kit: 5A3 ideas.add;
  // 5A4 assets.record, media.clean; 5A6 localapp.run, mail.read, speech.say (delivery/harness/tools-kit.ts).
  'ideas.add', 'assets.record', 'media.clean', 'localapp.run', 'mail.read', 'speech.say',
  // YouTube (tools-youtube.ts): 5B1 editOps to dictionary; 5B2 style to export; 5B3 afterPublish to archive.
  'youtube.editOps', 'youtube.clean', 'youtube.captions', 'youtube.coverage', 'youtube.dictionary',
  'youtube.style', 'youtube.clips', 'youtube.broll', 'youtube.beats', 'youtube.export',
  'youtube.afterPublish', 'youtube.outliers', 'youtube.niche', 'youtube.comments', 'youtube.publicStats', 'youtube.archive',
  // The CA firm (tools-ca.ts): 5C1 citations, formChooser, advance; 5C2 whatIf, healthCheck, entry.
  'tax.citations', 'tax.formChooser', 'tax.advance', 'tax.whatIf', 'books.healthCheck', 'docs.entry',
  // Social (tools-social.ts): 5D1 formats, inventory, slots; 5D2 montage to adStyle; 5D3 fairPrice, keywords.
  'social.formats', 'social.inventory', 'social.slots', 'social.montage', 'social.inbox', 'social.diagnose', 'social.health',
  'social.adStyle', 'social.fairPrice', 'social.keywords',
  // The new playbooks, each in delivery/harness/tools-<playbook id>.ts: seo-visibility (5E1 diagnose to siteCheck, 5E2
  // the rest), online-seller (5F1 to listing, 5F2 the rest), support-desk (5G), recruiting-desk (5H), job-search-desk
  // (5I), translation-studio (5J1 to subtitle.check, 5J2 dub), bookkeeping-cfo (5K1 to money.checkup, 5K2 books.write and
  // vouchers.draft), podcast-to-article (5L), lead-generation (5M), newsletter-studio (5N), tender-desk (5O),
  // website-studio (5P), narration-studio (5Q), virtual-assistant (5R1), data-entry-desk (5R2), app-testing (5R3),
  // dev-agency (5R4), monitored-data and it-triage (5R5), phone-receptionist (5R6).
  'seo.diagnose', 'seo.aiAccess', 'seo.panel', 'seo.siteCheck', 'seo.corroborate', 'seo.lint', 'seo.meta', 'seo.impact', 'seo.refresh', 'seo.local',
  'seller.unitEconomics', 'seller.ads', 'seller.settlement', 'seller.listing', 'seller.stage', 'seller.alerts', 'seller.stock', 'seller.shortlist',
  'seller.catalogueSheet', 'seller.multiStore',
  'support.match', 'support.ticket',
  'recruit.criteria', 'recruit.ledger', 'recruit.slots',
  'career.facts', 'career.capture', 'career.shortlist', 'career.score',
  'translate.check', 'translate.terms', 'subtitle.check', 'dub.align', 'dub.verify',
  'cfo.ratios', 'cfo.scenarios', 'collections.ladder', 'money.checkup', 'books.write', 'vouchers.draft',
  'article.ledger', 'article.style',
  'leads.osm', 'leads.enrich', 'leads.dedupe', 'community.vote',
  'newsletter.presend', 'newsletter.import', 'newsletter.slices', 'newsletter.stats',
  'tender.questions', 'tender.ground',
  'site.requirements', 'site.uiReport', 'site.flow', 'site.preview',
  'narration.markup', 'narration.verify',
  'va.brief',
  'forms.map', 'forms.readBack',
  'apptest.logcat', 'demo.plan',
  'qa.verdict', 'security.scan',
  'monitor.extract', 'triage.summary',
  'calls.cost', 'calls.log',
] as const;
export type ToolName = typeof TOOL_NAMES[number];
/**
 * read: looks and changes nothing. compute: the calculator, which answers with receipts. sandbox: agent-written code
 * in a sandbox. handoff: asks a person and ends the turn. outside-write: only ever recorded for the owner's approval.
 * delegate: writes a brief for the owner's own command-line tool; nothing starts until the owner approves it.
 */
export type ToolEffect = 'read' | 'compute' | 'sandbox' | 'handoff' | 'outside-write' | 'delegate';
/** One execution outcome type, as agentOS has it. */
export type ExecutionOutcome = 'succeeded' | 'failed' | 'cancelled' | 'timedOut';
export type ToolError = { code: string; name: string; message: string; details?: Json };
/** What every tool returns to the agent: the agentOS host-function envelope. */
export type ToolEnvelope = { ok: true; result: Json } | { ok: false; error: ToolError };
export type ToolCallRecord = {
  id: string;
  turn: number;
  tool: string; // as the model asked, even when unknown or refused
  input: Json | null; // the parsed input; null when it did not parse
  inputDigest: string;
  envelope: ToolEnvelope;
  outcome: ExecutionOutcome;
  effect: ToolEffect | null; // null for an unknown tool
  tier: ExecutionTier | null;
  receiptIds: string[]; // work receipts this call made
  tableIds: string[]; // tables this call made
  /** When the call started and finished, for the step times the runs view shows. Absent on calls that never ran and on runs made before step times. */
  startedAt?: IsoTime;
  finishedAt?: IsoTime;
  /** The label on what the call returned (policy/taint.ts): untrusted when it carries outside content. Absent on calls that never ran. */
  integrity?: ResultIntegrity;
  /** What the untrusted screen found in the result (policy/untrusted.ts). Absent when it found nothing or did not run. */
  screen?: ScreenNote;
  /**
   * Ink v2 wave 4 (4J1, O17): the call ran without asking, allowed by a saved rule: the step's Auto setting ('auto') or
   * the owner's allow for this session ('session'). The decision record (journal/decisions.ts) reads it. Absent otherwise.
   */
  allowedBy?: { rule: 'auto' | 'session'; stepId: string | null };
};
/** Whether a result can be trusted: untrusted once it carries outside content (a client file, a tool's output). */
export type ResultIntegrity = 'trusted' | 'untrusted';
/** The screen's note on one result: its mode, what it decided, the digest a release binds to, and what it found where. */
export type ScreenNote = {
  mode: 'observe' | 'enforce';
  status: 'clean' | 'flagged' | 'quarantined' | 'released';
  digest: string;
  findings: { kind: string; what: string; at?: string }[];
};
/**
 * When outside content first entered a run (the taint latch). Once set it stays for the rest of the run. A real order
 * is latched from its first turn: the client's request and file names are outside content (client-request).
 */
export type TaintMark = {
  turn: number;
  source: 'client-request' | 'client-file' | 'mail' | 'post' | 'web-page' | 'tool-output' | 'client-answer';
  toolCallId: string | null;
  tool: string | null;
};
export type AgentTurnRecord = {
  turn: number;
  step: 'act' | 'write';
  note: string; // words only; never the model's private reasoning
  calls: { tool: string; input: string }[];
  finished: boolean;
  forced: boolean; // the last allowed step: tools off, say what was found and what is left
  by: 'model' | 'template';
  callId: string | null;
  costMicros: MicroString;
  /** Ink v2 wave 4 (4B2): the notes this turn's input carried, by id; absent when it recalled none. */
  recalled?: string[];
  /** Ink v2 wave 4 (4J18): the sources from what the AI knows this turn's input carried, by id; absent when none. */
  knowledge?: string[];
  /** Ink v2 wave 4: the playbook role whose step this turn worked on (4A1 departments, 4B1 threads). */
  role?: string;
};
/** screen: what the untrusted screen found in a client's answer the owner relayed (policy/untrusted.ts); absent when nothing. */
/**
 * 4J13 (A13): expiresAt, when the question stops being answerable (24 hours unless the playbook says otherwise); null:
 * it never expires (a NEEDS_FACTS hand-off, 4J16: the facts are needed however long they take); absent on older runs.
 * answeredBy 'timeout': nobody answered in time, so Chausar closed it and declined any held call. Never the owner's no.
 */
/** card (4J17, A14): the question card the agent asked, when it offered answers or asked a round of questions. */
export type HandoffRequest = { to: 'client' | 'owner'; question: string; turn: number; answer: string | null; answeredBy: 'owner' | 'practice-client' | 'timeout' | null; screen?: ScreenNote; choices?: HandoffChoice[]; expiresAt?: IsoTime | null; card?: QuestionCard };
/**
 * One choice an agent offers with its question to the owner (Ink v2 wave 4: 4J3 shows them on Today's card, 4J17's
 * questions fill them). label: a short name such as 'A'; text: the option in the agent's words; estimate: a figure the
 * model wrote about it ("Views in 30 days": "12,000 to 18,000"), which is only ever shown as a model estimate.
 * gains, costs, recommended (4J17): what the choice gains and costs, in the agent's words, and the agent's pick (first).
 */
export type HandoffChoice = { label: string; text: string; estimate?: { label: string; value: string }; gains?: string; costs?: string; recommended?: boolean };
/**
 * 4J17 (A14): questions done well. A card holds one question with answers to pick from, or a round of two to eight
 * related questions, each with the agent's best guess, so one short reply answers them all ("1 yes, 2 B"). Answers
 * list the agent's pick first, each with what it gains and costs; free text is always open, with an escape. Every word
 * passed the untrusted screen and the money check (agents/questions.ts) before it was stored.
 */
export type QuestionOption = { label: string; text: string; gains: string; costs: string; recommended: boolean };
export type QuestionItem = { number: number; text: string; guess: string; options: QuestionOption[] };
export type QuestionCard = { round: number; lead: string; items: QuestionItem[]; freeText: true; escape: string; example: string };
/** What a tool run proves. A draft may say work was done only when a proof of that kind exists. */
/** 'delegated': the owner's own tool ran on the order's files. It backs no claim of finished work on its own. */
export type ClaimProofKind = 'file-read' | 'transformed' | 'totals' | 'matched' | 'reconciled' | 'balanced' | 'delegated';
export type ClaimProof = { kind: ClaimProofKind; toolCallId: string; receiptId: string | null; tableId: string | null };
export type HarnessLimits = {
  maxTurns: number; // act turns before the forced last step
  maxToolCalls: number;
  maxCallsPerTurn: number;
  maxCostMicros: MicroString; // this run's model spend cap, on top of the monthly limit
  keepOutputs: number; // the newest tool results the model sees whole; older ones shrink to stubs
  stubChars: number;
  /** 4J12 (H23): the run's deadline, from its start. Past it the run ends blocked. Absent on every shipped playbook. */
  deadlineMs?: number;
};
export type HarnessState = {
  version: 1;
  phase: 'act' | 'write' | 'needs-answer' | 'brief' | 'done' | 'stopped'; // 'brief': a heavy-work brief waits for the owner
  limits: HarnessLimits;
  used: { turns: number; toolCalls: number; costMicros: MicroString };
  grant: ToolName[]; // fixed from the playbook when the run starts; every other tool is refused
  turns: AgentTurnRecord[];
  toolCalls: ToolCallRecord[];
  handoffs: HandoffRequest[];
  uploadIds: string[];
  tableIds: string[];
  workReceiptIds: string[];
  proofs: ClaimProof[];
  sections: 'reply' | 'report'; // 'report' once a tool run proved a work product
  stopReason: string | null; // plain words when the loop stopped early
  mocks: MockEffect[]; // outside writes the agent proposed: recorded, never carried out
  delegations?: DelegationRequest[]; // heavy-work briefs, in order; absent on runs made before heavy work
  rounds?: AuditRound[]; // the round ledger, one entry per act turn; absent on runs made before the auditor
  holds?: PolicyHold[]; // tool calls the policy held for the owner (P2-posture); absent until one is held
  taint?: TaintMark; // when outside content first entered the run; absent until then, never cleared (policy/taint.ts)
  capWindows?: CapWindow[]; // room the owner allowed past the run's spend cap, one per approval on Today; absent until one
  // Ink v2 wave 4 (run controls and breakers, 4F1 and 4F2); each absent until used.
  control?: RunControl; // a stop the owner asked for, read between calls so it works while a turn runs
  alreadyTried?: AlreadyTried[]; // what failed before a breaker stop, carried into the next turn on Resume
  steer?: SteerNote[]; // the owner's words for the next turn, each used once
  gate?: RoundGate; // the owner's gate after each round (or every few rounds)
  repairs?: RepairTurn[]; // the one repair turn a badly shaped answer gets
  workedMs?: number; // 4F1: the time the run's approved turns took to run, summed; time waiting on the owner is not counted
  breaker?: BreakerTrip; // 4F2: the newest time the repeat-failure breaker stopped the run; the breaker counts calls after it
};
/**
 * The repeat-failure breaker stopping a run (4F2, H22): which rule tripped, the run's line in plain words, the error
 * that kept coming back, the call it tripped on (the breaker counts only the calls after it from then on), and the
 * "How to fix it" words when the owner must act.
 */
export type BreakerTrip = { trigger: BreakerTrigger; line: string; error: string; callId: string; at: IsoTime; fix: string | null; fixKind?: FixKind | null };
/** 4F2: which rule of the repeat-failure breaker stopped a run. */
export type BreakerTrigger = 'same-error' | 'same-action' | 'failures-in-row';
/** 4F2 (O14): the kind of an AI call's failure, for the screen's own words (English and Hindi). */
export type RunFailureKind = 'allowance-spent' | 'not-signed-in' | 'offline' | 'too-long' | 'out-of-date' | 'unknown';
/** 4F2 (O14): what the owner does to fix a failure, as a code the screen words for itself. */
export type FixKind = 'raise-limit' | 'sign-in' | 'run-again-online' | 'split-work' | 'update-tool' | 'install-ffmpeg' | 'set-up-docker' | 'get-python-image' | 'set-up-cli';
/**
 * A stop the owner asked for (4F1). force: the step in progress is thrown away; else the call in progress finishes.
 * cutCallId: the model call a force stop cut while it was out, until its turn comes back and is settled (its cost
 * counted, nothing it made kept); Resume waits for it. Absent or null otherwise.
 */
export type RunControl = { stop: { at: IsoTime; by: string; force: boolean } | null; stoppedAt: IsoTime | null; line: string | null; cutCallId?: string | null };
/** One thing a run tried before a breaker stopped it, in purpose words, and the error it met (4F2). */
export type AlreadyTried = { tool: string; tried: string; error: string };
/**
 * The owner's words for the agent's next turn (4F1 steer): at most 500 characters, used once, with the turn that took it.
 * callId: the preview whose text carried it last; only the turn that runs that call takes it.
 */
export type SteerNote = { text: string; at: IsoTime; by: string; pickedUpTurn: number | null; callId?: string | null };
/**
 * Why the round gate stopped to ask (4F1). 'needs-answer' is never set by the gate itself: a round that ends with a
 * question already waits on the owner through its question row on Today.
 */
export type RoundGateReason = 'finished' | 'limit' | 'needs-answer' | 'blocked' | 'failures';
/** The owner's gate after each round (4F1): on, how often, the round waiting on the owner, words for the next turn, extra turns allowed. */
export type RoundGate = {
  on: boolean; every: 1 | 2 | 3 | 5;
  waiting: { round: number; reason: RoundGateReason; line: string } | null;
  ownerNote: string | null; extraTurns: number;
};
/** The one repair turn a turn the model answered in the wrong shape gets (4F2, H35). */
export type RepairTurn = { turn: number; reason: string };
/** One more window of spend for a run, allowed by the owner on Today when its next call would have crossed its cap. */
export type CapWindow = { micros: MicroString; at: IsoTime; by: string };
/**
 * One tool call the policy held for the owner (venture/policy): it did not run. The owner's answer to its hand-off
 * decides it; an approval lets exactly that tool with that input run once, in the next act turn, and never again.
 */
export type PolicyHold = {
  id: string;
  toolCallId: string;
  tool: string;
  stepId: string | null;
  inputDigest: string;
  code: string; // the policy's reason code: step_on_hold, posture, floor, tainted
  reason: string; // plain words
  turn: number; // the act turn that asked
  handoff: number; // index of its hand-off in handoffs
  status: 'waiting' | 'approved' | 'declined' | 'used';
  validTurn: number | null; // the one act turn an approval covers
};
/**
 * The auditor's check of one step (one tool call): read-only, against the step's real output (the run's receipts and
 * tables, the client's files). Only audited steps count as progress or back a claim of finished work. evidence: the
 * ids of what it read. A step that was refused, failed or cancelled is kept here as evidence, not progress.
 */
export type AuditStep = { toolCallId: string; tool: string; audited: boolean; reason: string; evidence: string[] };
/** One round of the agent loop: the manager's plan (the act turn's note), each executor step with its audit, and how many were audited. */
export type AuditRound = { round: number; plan: string; steps: AuditStep[]; progress: number };

/** A file a client sent, kept in the vault. Its content is client data, except Chausar's made-up practice files. */
/** transcript: an SRT or VTT file of what was said, with timings (venture/playbooks/youtube/transcript.ts). */
/** image: a still from an order's cut (Ink v2 wave 4, 4J3), a JPEG kept only as the order's poster. */
/** image and audio (5A4): a client's photo, cleaned at intake, and a recording kept as it came (playbooks/kit/media-intake.ts). */
export type UploadFormat = 'csv' | 'xlsx' | 'pdf' | 'transcript' | 'image' | 'audio';
export type UploadRecord = RecordBase<'venture-upload'> & {
  name: string;
  format: UploadFormat;
  bytes: number;
  digest: string;
  contentBase64: string;
  /**
   * poster (4J3): the order's one still from its cut (delivery/poster.ts). Its own scope, so no agent tool, run file
   * list or order file count ever reads it as a file the client sent. media (5A4): an order's photos and recordings, in
   * their own scope for the same reason.
   */
  scope: { kind: 'order'; orderId: string } | { kind: 'practice'; scenarioId: string } | { kind: 'poster'; orderId: string } | { kind: 'media'; orderId: string };
  clientData: boolean;
  /**
   * Where it came from: the client, a transcript made on this computer from the client's footage, or a still taken
   * from the cut on this computer (4J3). Absent means the client.
   */
  origin?: 'client' | 'local-transcription' | 'poster' | 'client-link';
  /**
   * 4J7 (K9): the file request link it came through, when the client uploaded it there. Such a file's name is Chausar's
   * own ('client-upload-1.csv'), so no word the client chose reaches an agent; clientName keeps the client's name for
   * the owner, screened as untrusted (null when the screen held it or Forget erased it).
   */
  fileRequestId?: string;
  clientName?: string | null;
};
export type UploadView = Omit<UploadRecord, 'contentBase64'>;

/** Which run a table or a work receipt belongs to. */
export type WorkRunRef =
  | { kind: 'delivery'; runId: string }
  | { kind: 'rehearsal'; scenarioId: string; episode: number }
  | { kind: 'improvement'; runId: string; scenarioId: string };
export type WorkTableRow = { id: string; cells: Record<string, string> };
/**
 * A table a tool made: a sandbox program's output, bills picked from PDFs, or a table code computed from the client's
 * files (a ranked list of hooks, an edit list; tools.ts computedTable). Tables read from files are not stored.
 */
export type WorkTableRecord = RecordBase<'venture-work-table'> & {
  name: string;
  columns: string[];
  rows: WorkTableRow[];
  source:
    | { kind: 'transform'; fromTableId: string; tier: ExecutionTier; driver: string; programDigest: string; moduleDigest: string | null }
    | { kind: 'picked'; uploadIds: string[] }
    | { kind: 'computed'; tool: ToolName; uploadIds: string[] };
  runRef: WorkRunRef;
  digest: string;
};
/** 'total', 'opening', 'inflows', 'group-1' ... Each figure in a work receipt has a short key. */
export type WorkFigureKey = string;
/** unit 'percent': minor holds hundredths of a percent ('1234' is 12.34%). unit 'post': minor is '0' and display is the post's id. */
export type WorkFigure = { key: WorkFigureKey; label: string; minor: MinorString; display: string; currency: string; unit: 'money' | 'count' | 'percent' | 'post' };
export type WorkStep = { op: 'add' | 'subtract' | 'count' | 'compare' | 'match'; inputs: string[]; result: string; rule: string };
export type ReconciliationLine = { rowId: string; date: IsoDate | null; text: string; amountMinor: MinorString; display: string };
export type Reconciliation = {
  balanced: boolean; // the computed closing balance equals the statement's closing balance
  statementClosing: boolean; // false when the statement had no balance column, so balanced could not be checked
  matched: { bankRowId: string; billRowId: string; amountMinor: MinorString; display: string; bankText: string; billText: string; rule: 'agent-key' | 'bill-number' | 'amount-and-name' | 'amount-only' }[];
  unmatchedBank: ReconciliationLine[]; // money out with no bill
  unmatchedBills: ReconciliationLine[]; // bills with no payment in the statement
  moneyIn: ReconciliationLine[];
};
/** The calculator's answer for agent work. Every money figure is BigInt arithmetic on amounts code read from the file. */
/**
 * 'ca.engine': one of the CA firm's tax engines worked it (delivery/harness/tools-ca.ts), and ca keeps its whole
 * receipt. 'social.report': the report figures from a platform's exports (tools-social.ts), each kept in report.
 */
export type WorkReceiptRecord = RecordBase<'venture-work-receipt'> & {
  operation: 'work.sum' | 'work.totals' | 'work.reconcile' | 'ca.engine' | 'social.report';
  runRef: WorkRunRef;
  currency: string;
  inputs: { tables: { id: string; name: string; digest: string }[]; columns: Record<string, string>; rowIds: string[] };
  steps: WorkStep[];
  figures: WorkFigure[];
  reconciliation: Reconciliation | null;
  allowedNumbers: string[];
  explanation: string; // built by code from the figures
  digest: string;
  /**
   * The CA engine's receipt, inputs included, so it can be worked again with the exact table versions it stamped
   * (venture.ca.receipt). caReceiptId is the engine's own receipt digest. Only on operation 'ca.engine'.
   */
  ca?: {
    engine: CaEngine | 'portal-diff'; inputs: Json; inputsDigest: string; caReceiptId: string;
    table: TableStamp | null; tables: TableStamp[]; sections: SectionRef[]; assumptions: string[]; openQuestions: string[]; working: Json;
    /** The engine's own steps (each figure with the section it rests on) and its explanation, so the stored receipt is whole. */
    steps?: CaReceiptStep[]; explanation?: string;
  };
  /** Each report figure's platform, month, formula and the export file, columns and rows it came from. Only on 'social.report'. */
  report?: Pick<ReportReceipt, 'platform' | 'month' | 'key' | 'formula' | 'inputs' | 'unit'>[];
};

/** Where a failure is fixed. A wrong number is never fixed in a prompt: it points at the calculator's inputs. */
export const ATTRIBUTION_LEVELS = ['harness', 'tools', 'dictionary', 'calculator'] as const;
export type AttributionLevel = typeof ATTRIBUTION_LEVELS[number];
export const PLAYBOOK_PATCH_OPS = ['guidance.add', 'guidance.remove', 'tools.grant', 'tools.revoke', 'checks.add', 'limits.turns', 'alias.add'] as const;
export type PlaybookPatchOp = typeof PLAYBOOK_PATCH_OPS[number];
export type PlaybookPatch = {
  id: string;
  level: AttributionLevel;
  op: PlaybookPatchOp;
  stepId: string;
  value: string;
  note: { hypothesis: string; expectedFixes: string[]; likelyRegressions: string[] };
  /** 'owner': a change the owner's own words asked for in chat (4B1), checked under the owner rules of applyPatch. */
  proposedBy: 'model' | 'chausar' | 'owner';
  parentHash: string;
  /** An owner patch only (4B1): the message it came from and the owner's words, quoted. */
  source?: { messageId: string; quote: string };
};
export type ImprovementCase = { scenarioId: string; set: 'pool' | 'reserve' | 'rehearsal'; signalId: string | null };
export type CaseScore = { passed: boolean; checksPassed: number; checksRun: number; judgeYes: number; critical: string | null; firstFailure: string | null };
/** pairwise: the judge's preference between the two drafts, asked only when the scores tie and the drafts differ. */
export type GatePreference = { winner: 'parent' | 'candidate' | null; detail: string };
export type GateCase = { scenarioId: string; set: 'reserve' | 'rehearsal'; parent: CaseScore; candidate: CaseScore; winner: 'parent' | 'candidate' | 'tie'; pairwise?: GatePreference };
export type GateResult = {
  cases: GateCase[];
  wins: number;
  losses: number;
  ties: number;
  candidateCritical: number;
  newBlockFailures: number;
  decision: 'keep-candidate' | 'keep-parent';
  reason: string;
};
export type Diagnosis = {
  clusters: { reason: string; step: string; level: AttributionLevel; count: number }[];
  chosen: { reason: string; step: string; level: AttributionLevel } | null;
};
export type ImprovementRound = {
  round: number;
  diagnosis: Diagnosis;
  patch: PlaybookPatch | null;
  refused: string | null; // why code refused the patch before any spend, or why the round stopped
  candidateHash: string | null;
  gate: GateResult | null;
  /** Ink v2 wave 4 (4J16, Q16): the change this round tried, as an experiment (delivery/experiments.ts). Absent on older runs. */
  experiment?: ExperimentRecord;
};
/** 4J16 (Q16): the control of an experiment: the old version rehearsed on the same practice cases, from this window of signals. */
export type ExperimentControl = { kind: 'parent-on-same-cases'; playbookHash: string; cases: number; window: { from: IsoTime; to: IsoTime } };
/**
 * 4J16 (Q16): one change tried as an experiment. control null: no real control, so the result is only observed;
 * 'no-effect': a control, and no case won or lost. Displays are in rupees at the owner's rate, else USD.
 */
export type ExperimentRecord = {
  hypothesis: string; change: string; patchId: string; control: ExperimentControl | null;
  budget: { capMicros: MicroString; capDisplay: string; spentMicros: MicroString; spentDisplay: string };
  stopRules: string[]; rollbackRule: string;
  result: { kind: 'caused' | 'no-effect' | 'observed'; line: string };
  /** 4J22a (4J15, Q12): the change's lift on the same paired cases; null without a control; absent on older runs. */
  lift?: ExperimentLift | null;
};
/** The lift of one experiment (delivery/lift.ts): its line says model estimate when it concludes; digest is its receipt's. */
export type ExperimentLift = { cases: number; reachable: boolean; direction: 'better' | 'worse' | 'none'; estimate: boolean; line: string; digest: string };
export type ImprovementRunRecord = RecordBase<'venture-improvement-run'> & {
  status: 'kept-candidate' | 'kept-parent' | 'incomplete';
  parentPlaybookId: string;
  parentHash: string;
  candidatePlaybookId: string | null; // a new playbook version; the parent is never overwritten
  frozen: { pool: ImprovementCase[]; reserve: ImprovementCase[]; rehearsal: ImprovementCase[]; digest: string };
  rounds: ImprovementRound[];
  maxRounds: number;
  costMicros: MicroString;
  costDisplay: string;
  modelMode: 'model' | 'template' | 'mixed';
  incompleteReason: string | null;
  changes: string[]; // plain words for each change the candidate makes
  digest: string; // what the owner approves to adopt the candidate
  /** When the run began; its record is written when it ends. Absent on runs made before the runs view listed them. */
  startedAt?: IsoTime;
  /** The owner went back from this run's adopted version (venture.improve.rollback); it is not offered again. */
  rolledBack?: { at: IsoTime; by: string };
};
export type ImprovementStatus = {
  readiness: ImprovementReadiness;
  activePlaybookId: string | null;
  latest: ImprovementRunRecord | null;
  /** The newest kept candidate that is not adopted yet and still fits the current plan. */
  candidate: { runId: string; playbookId: string; digest: string; changes: string[] } | null;
  /**
   * The version in use (Ink v2 wave 2). rollback: what venture.improve.rollback takes to go back to the version it was
   * made from, with that version's number; null unless it came from an improvement run and the older one still fits.
   */
  inUse?: {
    playbookId: string; version: number; hash: string; origin: 'plan' | 'improvement' | 'owner';
    rollback: { playbookId: string; version: number; digest: string } | null;
  } | null;
};

/** The container tier's process port: Docker only, injected by tests. Nothing else runs through it. */
export type SandboxProcessRequest = { command: 'docker'; args: string[]; stdin: string; timeoutMs: number; maxOutputBytes: number };
export type SandboxProcessResponse = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean };
export type SandboxPorts = { process?: (request: SandboxProcessRequest) => Promise<SandboxProcessResponse> };

/**
 * Heavy work: the owner's own Claude Code or Codex, already installed and signed in on this computer. Chausar only
 * launches it; it never reads the tool's login. Each run works in a fresh folder that holds only the order's files
 * and the brief the owner approved.
 */
export const DELEGATE_CLIS = ['claude-code', 'codex'] as const;
export type DelegateCli = typeof DELEGATE_CLIS[number];
export type DelegateProcessRequest = { command: string; args: string[]; cwd: string; env: Record<string, string>; stdin: string; timeoutMs: number; maxOutputBytes: number };
export type DelegateProcessResponse = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean };
/** Finds the installed tool and runs it. Tests inject a port that points at a fake command-line tool. */
export type DelegatePorts = {
  locate(cli: DelegateCli): Promise<string | null>;
  process(request: DelegateProcessRequest): Promise<DelegateProcessResponse>;
};
export type DelegateLimits = { minutes: number; maxTurns: number; budgetMicros: MicroString | null };
/**
 * One heavy-work request on a run. 'waiting' until the owner approves or declines the exact brief; 'running' while
 * the tool works; then 'declined' or 'finished'. The digest covers everything the owner approves.
 */
export type DelegationRequest = {
  toolCallId: string;
  turn: number;
  cli: DelegateCli;
  executable: string;
  version: string;
  briefText: string; // the exact text the tool gets, on standard input and as BRIEF.md
  uploadIds: string[]; // the files copied into the folder, nothing else
  limits: DelegateLimits;
  digest: string;
  status: 'waiting' | 'running' | 'declined' | 'finished';
  startedAt: IsoTime | null;
  delegateRunId: string | null;
};
/** What a heavy-work run left: files and a log, all untrusted. Money figures count only once the calculator recomputed them. */
export type DelegateOutput = { name: string; bytes: number; digest: string; text: string | null; note: string | null };
export type DelegateFigure = { label: string; claimed: string; receiptId: string | null; matches: boolean | null; note: string };
export type DelegateRunRecord = RecordBase<'venture-delegate-run'> & {
  runId: string;
  toolCallId: string;
  cli: DelegateCli;
  executable: string;
  version: string;
  approvedDigest: string;
  limits: DelegateLimits;
  outcome: ExecutionOutcome;
  exitCode: number | null;
  reason: string; // plain words, built by code
  outputs: DelegateOutput[];
  log: string; // the end of what the tool printed, untrusted
  reportedCost: string | null; // the cost the tool printed, as it printed it; untrusted; the spend ledger settles the run's reservation at it, labelled as the tool's own report
  figures: DelegateFigure[];
  uncheckedNumbers: number; // numbers in the summary the calculator did not recompute
  untrusted: true;
};

// ---------------------------------------------------------------------------
// 8c. Spend (P2-spend): reserve before a paid call, settle after; an unknown price is refused, never counted as free
// ---------------------------------------------------------------------------

/** Engine-formatted text; the UI never computes it. Shared with the Ink contract (plan, "Shared contract"). */
export type Display = string;
/**
 * One price on the rate card, in micro-USD. 'per-million-tokens' prices a model call by its usage; 'per-call' is a
 * fixed price per call; 'per-run-cap' holds a run's own spending limit and settles at what the tool reports.
 * 'list' rates come from Chausar's own tables; 'owner' rates were typed by the owner and override them.
 */
export type SpendRateUnit = 'per-million-tokens' | 'per-call' | 'per-run-cap';
export type SpendRate = {
  item: string; // 'model:<preset id>', 'delegate:<tool>' or 'connector:<id>'
  unit: SpendRateUnit;
  inputMicrosPerMillion: MicroString | null;
  outputMicrosPerMillion: MicroString | null;
  microsPerCall: MicroString | null; // the price per call, or the run's cap
  source: string;
  checkedOn: IsoDate;
  confirmed: boolean; // false: figures at this rate show as 'estimate, price unconfirmed'
  by: 'list' | 'owner';
  /** 4F2 (M6): the prompt-cache read and write prices per million tokens, each its own line on the card; absent: none known. */
  cacheReadMicrosPerMillion?: MicroString | null;
  cacheWriteMicrosPerMillion?: MicroString | null;
};
/** reserved: the charge record, written before the call. unknown: the answer never came, so it stays held. */
export type SpendPhase = 'reserved' | 'settled' | 'unknown' | 'released' | 'refused';
export type SpendRecord = RecordBase<'venture-spend'> & {
  key: string; // the idempotency key: one per thing asked for, so a retry never pays twice
  item: string;
  label: string;
  agent: string | null;
  connector: string | null;
  payer: string; // who is billed: 'connection:<id>', 'plan:<tool>' or 'connector:<id>'
  draftDigest: string; // exactly what is paid for
  rate: SpendRate | null; // the rate used; null when there was none
  reservedMicros: MicroString;
  settledMicros: MicroString | null;
  settledBy: 'usage' | 'tool-report' | 'bill' | 'reservation' | null; // 'reservation': no figure came back, so it settled at the estimate
  phase: SpendPhase;
  quoteId: string | null; // the approved quote this call spent
  ref: string | null; // the record the call belongs to, such as a model call id or a delivery run id
  refusal: { code: string; message: string } | null;
  settledAt: IsoTime | null;
};
/** A paid call above the owner's ask-first figure waits here. One approval buys one call, within the hour. */
export type SpendQuoteRecord = RecordBase<'venture-spend-quote'> & {
  key: string;
  item: string;
  label: string;
  payer: string;
  draftDigest: string;
  figureMicros: MicroString;
  figure: Display;
  status: 'open' | 'approved' | 'spent';
  decidedAt: IsoTime | null;
  decidedBy: string | null;
  spentBy: string | null; // the spend record that used the approval
};
export type SpendPolicyRecord = RecordBase<'venture-spend-policy'> & {
  capMicros: MicroString | null; // hard cap per calendar month (UTC) across every paid call; null: only each AI's own limit
  askAboveMicros: MicroString | null; // a call that may cost more than this waits for the owner to approve its quote
  rates: SpendRate[]; // the owner's rate card
  rupeeRate?: RupeeRate | null; // the owner's own rupee rate, for showing spend in rupees beside dollars; absent: dollars only
  // Ink v2 wave 4 (4F2); each absent until the owner sets it.
  dailyCapMicros?: MicroString | null; // a cap per day on the owner's calendar across every paid call
  alertPermille?: number; // Today tells the owner once a month at this share of the monthly limit; absent: 800
  agentCaps?: { agent: string; capMicros: MicroString }[]; // an agent's own monthly limit: past it only that agent pauses
  writeCaps?: Partial<Record<WriteCapKind, number>>; // the owner's lower daily caps on agent writes (never above the default)
  currencyLead?: CurrencyLead; // 4Z3: which currency leads spend; absent: 'auto'
};
/**
 * The owner's own rate for showing spend in rupees too: rupees per US dollar in ten-thousandths of a rupee (83.50 is
 * 835000), and the day the owner set it. Spend is still counted and capped in US dollars; rupees are shown, never kept.
 */
export type RupeeRate = { perUsd: string; setOn: IsoDate };
/**
 * 4Z3 (founder, 27 Oct): which currency leads a spend figure, as the owner chose it in the spend settings. 'auto' (the
 * default): rupees lead for a business in India once a rupee rate is set. 'inr': rupees lead whenever a rate is set.
 * 'usd': dollars always lead. Without a rate, dollars lead whatever the choice.
 */
export type CurrencyLead = 'auto' | 'inr' | 'usd';
/**
 * 4Z3: a spend figure as the owner's currency choice leads it, worked out in the engine so the screen computes nothing.
 * currency: which leads. figure: the lead amount with the engine's words after it (60.10 rupees with the rupee sign,
 * 'USD 0.72 this month'), never more than two decimals of dollars ('under USD 0.01' for a spend above zero that rounds
 * to nothing); the exact figure stays in the receipt. beside: the other currency at the owner's rate, shown small
 * beneath it ('USD 0.72 at' the rate in rupees 'per $1'); other: that amount alone ('USD 0.72'), for a page that says
 * the rate once. Both absent without a rate.
 */
export interface SpendLead { currency: 'INR' | 'USD'; figure: Display; beside?: Display; other?: Display }
/**
 * reason: why a refused call was refused, in the engine's words (no price, the monthly limit, waiting for approval).
 * reservedRupees, settledRupees: the same figures in rupees at the owner's rate, with that rate; absent without one.
 * by (4H1, H36): who answered a model call, from its call record: the model its answer named, in words, or 'not
 * reported'; absent for other spend and before the call answered.
 */
export interface SpendRow {
  id: string; agent?: string; connector?: string; label: string; reserved: Display; settled?: Display; kind: 'estimate' | 'billed' | 'refused'; receiptId?: string; reason?: Display;
  reservedRupees?: Display; settledRupees?: Display; by?: Display;
  /** 4Z3: the reserved and settled figures as the owner's currency leads them; absent where there is no figure. */
  reservedLead?: SpendLead; settledLead?: SpendLead;
  /**
   * 4F2 (M6, M7): basis, how the cost is known ('Estimate', 'Reported by the provider', 'Not known yet'); priced, the
   * rate it was priced at and that rate's date; payer, who pays ('Paid by your Anthropic key'). Chausar charges nothing.
   */
  basis?: Display; priced?: Display; payer?: Display;
}
/**
 * One rate card line as the owner types it (venture.spend.policy.set). Lines the owner sets are theirs and confirmed.
 * Each figure comes once: in US dollars as typed (up to six decimals; the engine converts) or in micro units.
 */
export type SpendRateInput = {
  item: string; unit: SpendRateUnit; inputMicrosPerMillion?: MicroString | null; outputMicrosPerMillion?: MicroString | null; microsPerCall?: MicroString | null;
  inputUsdPerMillion?: string | null; outputUsdPerMillion?: string | null; usdPerCall?: string | null;
  source: string; checkedOn: IsoDate;
  /** 4F2 (M6): the prompt-cache read and write prices, in US dollars or micro units, each optional. */
  cacheReadUsdPerMillion?: string | null; cacheWriteUsdPerMillion?: string | null;
  cacheReadMicrosPerMillion?: MicroString | null; cacheWriteMicrosPerMillion?: MicroString | null;
};
/** A rate's figures in US dollars as the owner types them ('3.00', '0.000075'), for the edit form. */
export type SpendRateUsd = {
  inputUsdPerMillion: string | null; outputUsdPerMillion: string | null; usdPerCall: string | null;
  /** 4F2 (M6): the prompt-cache prices, when the line has them. */
  cacheReadUsdPerMillion?: string | null; cacheWriteUsdPerMillion?: string | null;
};
/**
 * The owner's spend settings (venture.spend.policy.get/set). Every figure arrives formatted. The Usd fields are the
 * same figures in US dollars as the owner types them ('20.00'), which is what the app sends back; the micro figures stay.
 * inrPerUsd: the owner's rupee rate as typed back ('83.50'); rupeeRate: that rate in words with the day it was set;
 * capRupees and askFirstRupees: the limits in rupees at that rate. All null or absent without a rate.
 */
export interface SpendPolicyView {
  capMicros: MicroString | null; askFirstMicros: MicroString | null;
  capUsd: string | null; askFirstUsd: string | null;
  cap: Display; askFirst: Display;
  rates: (SpendRate & SpendRateUsd & { price: Display })[];
  setAt: IsoTime | null;
  inrPerUsd: string | null; rupeeRate: Display | null; capRupees?: Display; askFirstRupees?: Display;
  // Ink v2 wave 4 (4F2): the day's cap and the alert share (M4); the meter and the limit-reached options (M4, M3); each
  // agent's own limit (M5); the daily write caps (H32); the rate card with confirmed and list prices (M6).
  dailyCapMicros?: MicroString | null; dailyCapUsd?: string | null; dailyCap?: Display; dailyCapRupees?: Display;
  alertPermille?: number; alert?: Display;
  meter?: SpendMeterView | null; limitReached?: LimitReachedView; keyLimits?: LimitReachedView[];
  agentCaps?: AgentCapView[]; writeCaps?: WriteCapView[]; card?: RateCardLine[];
  /** 4Z3: the owner's choice of which currency leads spend, and the currency that leads now (dollars without a rate). */
  currencyLead?: CurrencyLead; leads?: 'INR' | 'USD';
  /** 4Z3: the monthly limit and the ask-first figure as the owner's currency leads them; absent with no limit. */
  capLead?: SpendLead; askFirstLead?: SpendLead;
}
/**
 * 4F2 (M4, M3): this month's spend against the monthly limit, worked out in code, with the sum receipt behind it. near:
 * at or past the alert share; over: at or past the limit. projection: how many more drafts fit at the dearest of the
 * last ten drafts' costs, labelled as a projection; absent with no limit or no finished draft yet.
 */
export interface SpendMeterView {
  usedPermille: number; line: Display; near: boolean; over: boolean; receiptId: string; resetOn: IsoDate; reset: Display;
  projection?: { line: Display; label: Display; runIds: string[]; left: Display; leftRupees?: Display };
}
/**
 * 4F2 (M3): what the owner can do once a monthly limit is reached. Never credits. business: the business's own limit
 * (raise it, or wait). key: one key's own limit, where connecting another key is a way on too.
 */
export interface LimitReachedView { scope: 'business' | 'key'; presetId?: string; line: Display; options: { id: 'raise' | 'connect' | 'wait'; label: Display }[] }
/** 4F2 (M5): one agent's own monthly limit; past it only that agent is paused. */
export interface AgentCapView { agent: string; name: Display; capMicros: MicroString; capUsd: string; cap: Display; used: Display; paused: boolean; capRupees?: Display; usedRupees?: Display }
/** 4F2 (H32): one daily write cap: today's cap (raised once when the owner allowed more), what agents made today, in words. */
export interface WriteCapView { kind: WriteCapKind; cap: number; used: number; raised: boolean; line: Display }
/**
 * 4F2 (M6): one price on the rate card. confirmed: the owner's checked rate with its source and date; list: Chausar's
 * list price with the day it was checked. Prompt-cache reads and writes are lines of their own.
 */
export interface RateCardLine { item: string; label: Display; state: 'confirmed' | 'list'; price: Display; checked: Display; source: string; unconfirmed?: boolean }

// ---------------------------------------------------------------------------
// 9. Events (the venture actor's broadcast log)
// ---------------------------------------------------------------------------

export const VENTURE_EVENTS = [
  'venture-created', 'retention-changed', 'interview-updated', 'blueprint-drafted', 'blueprint-accepted',
  'model-connected', 'model-disconnected', 'send-policy-changed',
  'price-quoted', 'client-added', 'order-created', 'order-delivered', 'invoice-prepared', 'invoice-issued', 'payment-recorded',
  'brief-ready', 'handoff-prepared', 'handoff-opened', 'repo-linked', 'repo-synced',
  'playbook-ready', 'simulation-finished', 'launch-stage-changed', 'delivery-waiting', 'delivery-ready', 'delivery-reviewed', 'signal-recorded',
  'upload-added', 'delivery-needs-answer', 'improvement-finished', 'playbook-adopted',
  'delivery-brief-waiting', 'delegate-finished',
  'plan-composed',
  // Ink v2 wave 2 (2B1): the sign-in window the owner asked for did not open or could not be used; the method never waits.
  'posting-sign-in-failed',
  // Ink v2 wave 2 (2B2): a check of the posting steps ran; its data holds counts and the guard's audit lines only.
  'posting-steps-checked',
  // Ink frontend (P1-A): what the desktop pushes over IPC and the web sends over /api/events (VentureRunEvent).
  'run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
  // Ink v2 wave 4: run events too, so they reach the window and /api/events. Their data holds ids only, and a frame
  // never carries words, names or figures; notify.new carries a count (4G1).
  'agent.message', 'chief.message', 'proposal.created', 'notify.new', 'pipeline.changed', 'run.stopped', 'run.call', 'keeper.ran',
  // Ink v2 wave 5 (named by 5-0, ids only): an order's chain moved (5A1), a playbook desk's records changed (each
  // business package), an idea moved or was graded (5A3).
  'chain.changed', 'desk.changed', 'idea.changed',
] as const;
export type VentureEventName = typeof VENTURE_EVENTS[number];
export type VentureEventRecord = RecordBase<'venture-event'> & { seq: number; name: VentureEventName; data: Json };

// ---------------------------------------------------------------------------
// 9b. Views for the Ink frontend (P1-A). app/ui mirrors these in app/ui/src/engine/types.ts.
// Display and SpendRow, also in the shared contract, are declared in section 8c.
// ---------------------------------------------------------------------------

/**
 * Ink v2 wave 4: 'sent' is the owner's "I sent it" after a handoff (4E1, 4E2); 'continue' and 'stop' answer the round
 * gate (4F1); 'resume' goes on with a stopped run (4F1).
 */
export type QueueActionId = 'approve' | 'deny' | 'later' | 'watch' | 'read' | 'answer' | 'send-to-ca' | 'open' | 'connect' | 'set-prices' | 'keep' | 'issue' | 'run-again'
  | 'sent' | 'continue' | 'stop' | 'resume';
export interface QueueAction { id: QueueActionId; label: string; primary: boolean; secondAsk?: boolean; requiresView?: boolean }
export interface QueueChange { label?: string; before?: Display; after: Display; receiptId?: string; estimate?: boolean }
/**
 * 'bank': a bank statement row to record as a payment, or a bank alert (Ink v2 wave 2). Ink v2 wave 4: 'proposal', a
 * proposal from Chats raised to Today (4C1); 'followup', a follow-up due by date (4E1); 'reply', inbound mail that needs
 * the owner (4E3); 'notice', a needs-you probe (4G2). Their decisions go to views/queue-w4.ts.
 */
export type QueueKind = 'draft' | 'price' | 'quote' | 'plan' | 'invoice' | 'signoff' | 'question' | 'setup' | 'locked' | 'connector' | 'bank'
  | 'proposal' | 'followup' | 'reply' | 'notice';
export interface QueueRow {
  id: string; businessId: string; businessName: string; agent?: string; kind: QueueKind;
  title: string; line?: string; change?: QueueChange; digest: string; createdAt: string;
  actions: QueueAction[]; // one or two; exactly one primary
  viewRef?: { kind: 'draft' | 'file' | 'run' | 'plan'; id: string };
  /** Only on rows that propose an outside action (W1 H21): false when part of what it will send is not shown. */
  descriptionComplete?: boolean;
  // Ink v2 wave 4: added after the row's digest by views/row-meta.ts (4J1) and views/previews.ts (4J3); each absent
  // until its package fills it and whenever there is nothing real to say.
  meta?: QueueRowMeta;
  sendsTo?: QueueSendsTo;
  attempt?: { n: number; lastError: Display | null };
  counts?: QueueCount[];
  price?: { display: Display; receiptId: string; line: Display; free?: Display };
  changeCount?: { line: Display; details: Display[]; coverage: Display };
  preview?: QueuePreview;
  /** 4J1: every amount the row's line, change or price states, each with its proof; added after the digest like meta. */
  amounts?: QueueAmount[];
  /** 4E1: a follow-up row's parts, so the screen can say it in its own words (and in Hindi). Part of the row's digest. */
  followup?: QueueFollowup;
  /** 4E3: a reply row's parts (and a meeting-notes notice's), for the screen's own words and Hindi. Part of the row's digest. */
  reply?: QueueReply;
  /** 4E3: what Approve needs from the owner as its answer: the day, for a next step drafted from notes that wrote none. */
  needs?: { answer: 'day'; line: Display };
  /** 4G2: a needs-you probe's notice parts. Part of the row's digest. */
  notice?: QueueNotice;
}
/**
 * The needs-you probes (4G2, O10): failed posts, a broken connection, drafts waiting, a calendar gap, a sharp move, a
 * stalled client. 'idea' (Ink v2 wave 5, 5A3): a published idea whose seven days are over, waiting for its grade.
 */
export type NoticeProbe = 'post' | 'connection' | 'drafts' | 'calendar' | 'moved' | 'stalled' | 'idea';
/**
 * A probe's notice (4G2): which probe made it, how much it matters, the screen Open goes to (an app address such as
 * #/connections), and each amount its line states, written exactly as there, with the receipt behind it, in the order
 * the line states them (any currency: the text is matched as written, not by a money pattern).
 */
export type QueueNotice = { probe: NoticeProbe; severity: 'high' | 'medium' | 'low'; link: string; figures?: { text: Display; receiptId: string }[] };
/**
 * A reply row's parts (4E3): which mail, why it waits on the owner (a match to confirm, a move to Talking, a reply to
 * write yourself, the fixed answer to "are you a bot", notes after a call), who, the card, what it asks about, and for a
 * handoff the address and the screened subject. draft: the fixed honest answer, only on a bot question.
 */
export type QueueReply = {
  inboundId: string | null; reason: 'confirm' | 'talking' | 'owner-reply' | 'bot-question' | 'meeting-notes' | 'opt-out' | 'bounce-domain';
  name: string; company: string | null; opportunityId: string | null; eventId: string | null; topics: InboundTopic[];
  from: string | null; subject: string | null; draft: string | null;
};
/** A follow-up row's parts (4E1): the card (a lead's id for a lead's card), who, the due day and lateness, the channel and the drafted nudge. */
export type QueueFollowup = { cardId: string; name: string; company: string | null; due: IsoDate; daysLate: number; channel: OutreachChannel | null; draftId: string | null };
/** Where an approved row's action goes, from the action's declared effect and its connector (4J1). */
export type QueueSendsTo = 'client' | 'public' | 'bank' | 'portal';
/**
 * One amount a Today row states (4J1), each occurrence its own: where names the field (the line, the change's before or
 * after, the price beside Approve, or one change count detail line, by index); text is field.slice(start, start + length),
 * counted in UTF-16 code units as JavaScript strings are. Its proof is a receipt venture.receipt.get serves, or estimate
 * when a model wrote it, never both.
 */
export type QueueAmount = { text: Display; where: 'line' | 'change.before' | 'change.after' | 'price' | 'details'; index?: number; start: number; length: number }
  & ({ receiptId: string; estimate?: never } | { estimate: true; receiptId?: never });
/**
 * The meta line of a row (4J1): the client, the business and the time; expiresAt only from a real expiry, never
 * invented; waitingLong after 24 hours; staleDraft on a draft older than 14 days.
 */
export interface QueueRowMeta {
  client: string | null; business: string; at: IsoTime; expiresAt?: IsoTime; waitingLong?: Display; staleDraft?: Display;
  /** 4J16 (Q4): the quotes code moved to their time in the transcript on this draft, one line each, shown beside Approve. */
  quoteFixes?: Display[];
}
/** One count against a platform limit, on a post row (4J1), for example 212 of 3,000 characters. */
export type QueueCount = { label: Display; count: number; limit: number };
/**
 * What a row's card shows before it is opened (4J3, views/previews.ts), from the owner's own records only. A field
 * without its source is left out; a preview never carries a made-up image, and drawing one never counts as viewed.
 * Every amount is a PreviewFigure with its receipt; words a model wrote are PreviewWords with their estimate flag.
 * video: a YouTube draft's package title, its length (from the run's edit list, else the transcript), the chapter
 * count only when the chapters check passed, the check counts, and the still from the cut when one is kept (a JPEG
 * data address, at most POSTER_MAX_BYTES). paper 'invoice': the invoice's lines, tax lines (none for a business not
 * registered for tax) and total, all with the price receipt; paper 'working': a CA paper's figures with their receipts
 * and who signs it. post: the exact text and its counts against the platform's limits. choice: a question's options;
 * a figure on an option is only ever a model estimate.
 */
export type QueuePreview =
  | { kind: 'video'; title: PreviewWords; format: 'long' | 'short'; duration?: PreviewLength; chapters?: number; checks: { passed: number; run: number; notRun: number }; poster?: { uploadId: string; src: string } }
  | { kind: 'paper'; paper: 'invoice'; title: Display; from: Display; to: Display; lines: (PreviewFigure & { quantity: string; unit: Display })[]; subtotal: PreviewFigure; discount?: PreviewFigure; taxLines: PreviewFigure[]; total: PreviewFigure; due?: { days: number; date: IsoDate | null; display: Display } }
  | { kind: 'paper'; paper: 'working'; title: Display; client: Display | null; working: PreviewFigure[]; more: number; signer: { name: Display; state: 'to-send' | 'with-ca' } | null }
  | { kind: 'post'; connectorId: string; platform: Display; account: Display | null; mode: 'api' | 'owner-browser-session'; text: string; textEstimate?: true; counts: QueueCount[]; short?: { title: PreviewWords; length?: PreviewLength } }
  | { kind: 'choice'; question: PreviewWords; options: { label: Display; text: PreviewWords; estimate?: { label: Display; value: Display }; gains?: Display; costs?: Display; recommended?: boolean }[]; card?: QuestionCard };
/**
 * An engine-formatted amount and the receipt it comes from (4J3): a preview shows no amount without one. receiptKind
 * names the method that opens the receipt: price and sum through venture.receipt.get, ca (a CA engine's receipt kept on
 * a work receipt) through venture.ca.receipt, work (any other work receipt) through venture.work.get.
 * A post's textEstimate: a model wrote the text and it holds a number or an amount no receipt backs; the text stays exact.
 */
export type PreviewFigure = { label: Display; value: Display; receiptId: string; receiptKind: PreviewReceiptKind };
export type PreviewReceiptKind = 'price' | 'sum' | 'ca' | 'work';
/** Words as a preview shows them. estimate: a model wrote a number in them that no receipt backs ("model estimate"). */
export type PreviewWords = { text: Display; estimate?: true };
/** A length worked out by code: whole seconds, "11 min 42 s", "11:42", and what it was measured from. */
export type PreviewLength = { seconds: number; display: Display; clock: Display; from: 'edit-list' | 'transcript' };
export interface QueueList { rows: QueueRow[]; summary: Display; needsYou: number; businesses: number }
export interface QueueDecision { outcome: 'done' | 'stale' | 'refused'; line: Display; receiptId?: string; latest?: QueueRow; reason?: string }
export type RunState = 'active' | 'waiting' | 'done' | 'failed';
export interface RunStep {
  id: string; purpose: string; state: 'done' | 'current' | 'pending' | 'waiting' | 'failed'; elapsed?: Display;
  tools?: RunToolLine[]; evidence?: { kind: string; id: string; label: string }[]; error?: string; audited?: boolean;
  /** 4J14 (Q6): on the read step, how much of the client's files code handed over; on the run's own sheet only. */
  coverage?: CoverageView;
  /** 4J14 (Q6): on the check step, the checks that could not run: id (playbook:check) and the engine's line ("Not run: ..."). */
  notRun?: { id: string; line: Display }[];
}
/**
 * Ink v2 wave 4 (4J14, Q6): coverage, fraction first ("1,204 of 1,210 lines matched"). done and total are counted by
 * code; null where nothing observed them, never 0. complete only when every counted item was seen.
 */
export type CoverageView = {
  done: number | null; total: number | null; unit: 'rows' | 'lines' | 'pages' | 'items' | 'bank-lines'; verb: 'read' | 'matched' | 'used';
  complete: boolean; line: Display;
  /** On an 'items' count only: the units it adds up (rows and lines), so the screen words it for itself. */
  units?: ('rows' | 'lines' | 'pages' | 'bank-lines')[];
};
/** 4J14 (Q7): one line of a run's report, its outcome from the one table (delivery/verdicts.ts); judgment for a judged rule. */
export type ReportItem = {
  id: string; outcome: 'pass' | 'fail' | 'not-run' | 'not-checked' | 'unknown'; line: Display;
  /** The line without its outcome word, for the screen's own words (Hindi). */
  detail: Display;
  /** A judged rule: its word, and why it was dropped below the keep line (delivery/verdicts.ts keepJudgment). */
  judgment?: 'strong' | 'fair' | 'weak' | 'no' | null; drop?: Display;
};
/** 4J14 (Q7): one judge rule's result as code counted it: its outcome, the checked yes votes and the votes cast. */
export type JudgeRuleResult = { rule: string; outcome: 'pass' | 'fail' | 'unverified'; yes: number; votes: number };
/**
 * 4J14 (Q7, Q8): a draft's report in three columns: measured by code, looked at by a model, and what needs a human.
 * findings: each failure by class. verdict: PASS, REWRITE or DO NOT SEND as a code, null while the review is incomplete
 * (review.line "Review incomplete: this is not a review."). result and coverage only where the run had client files: a
 * result is partial unless coverage is complete. generatedBy: what made it; stale once the draft changed after it.
 */
export interface DeliverableReport {
  measured: ReportItem[]; lookedAt: ReportItem[]; needsHuman: { code: string; line: Display }[];
  findings: { class: 'hard-error' | 'content' | 'creative'; id: string; line: Display }[];
  verdict: 'pass' | 'rewrite' | 'do-not-send' | null; verdictLine: Display;
  review: { complete: boolean; line: Display | null };
  result?: 'complete' | 'partial'; coverage?: CoverageView;
  generatedBy: ('code' | 'judge')[]; at: IsoTime; stale: boolean; staleLine: Display | null;
}
/**
 * One tool call on the run sheet. Ink v2 wave 4 (4F1, U7): state, on a call with measured times or one that never ran,
 * and ms, its measured time, only where both times were stamped.
 */
export type RunToolLine = { name: string; line: string; state?: 'done' | 'error' | 'cancelled'; ms?: number };
/**
 * Ink v2 wave 4 (4F1): usually, "Usually 3 to 5 min" from the last five finished runs of the same playbook steps, only
 * once three finished (U6); stop, a stop on its way (stopping) or done (stopped), in the engine's words (O1).
 * 4J3 (frames on run tiles): poster, on a YouTube delivery run only, the still kept from its order's cut (a small JPEG
 * data address, delivery/poster.ts), or null when none is kept; absent on every other run. venture.runs.list carries the
 * image (src) once per order, on its newest YouTube run, and src null on the others; venture.runs.get carries it whole.
 */
export interface RunSummary {
  runId: string; businessId: string; agent: string; purpose: string; state: RunState; startedAt: string; elapsed: Display;
  progress?: { done: number; total: number } | 'indeterminate'; result?: Display; receiptId?: string; estimate?: boolean;
  usually?: Display; stop?: { state: 'stopping' | 'stopped'; line: Display; trigger?: 'same-error' | 'same-action' | 'failures-in-row' };
  poster?: { uploadId: string; src: string | null } | null;
  /** 4H2 (U17): which engine wrote the run's draft, the line DeliveryRunView.writtenBy carries; absent before an answer. */
  writtenBy?: Display;
}
/**
 * screen: one line saying what the untrusted screen noted in the run's outside content, never the words (W1 H9).
 * Ink v2 wave 4 (4F1): scope, frozen when the run started (O21); steer, the owner's notes for the next turn (O3); gate,
 * the round gate (O2); live, the calls of the turn in flight, from the run.call events (U7).
 */
export interface RunDetail extends RunSummary {
  steps: RunStep[]; question?: { id: string; text: string; choices?: string[]; card?: QuestionCard }; error?: string; screen?: Display;
  scope?: RunScopeView; steer?: { text: Display; at: IsoTime; line: Display }[];
  gate?: { on: boolean; every: 1 | 2 | 3 | 5; waiting: { round: number; reason: RoundGateReason; line: Display } | null };
  live?: { callId: string; state: 'start' | 'done' | 'error' }[];
  /** 4F2 (O14): "How to fix it", only when the owner must act on a failed or breaker-stopped run. */
  fix?: Display;
  /** 4F2 (O14): the failure in the table's plain words, and codes for the screen's own words (English and Hindi). */
  failure?: { kind: RunFailureKind; line: Display }; fixKind?: FixKind;
  /** 4J3 (A17): the Delivered card, on an accepted or edited delivery run only (delivery/delivered.ts). */
  delivered?: DeliveredView;
  /**
   * 4J14 (Q8): on a run that acted outside, Success only when a code check of the real result passed, Not checked
   * without one, Failed when the agent gave up or the platform refused (delivery/outcomes.ts). Absent otherwise.
   */
  outcome?: { outcome: 'success' | 'not-checked' | 'failed'; line: Display };
  /** 4J14 (Q7, Q8): the draft's report, on a run with a draft, on its own sheet (venture.runs.get) only. */
  report?: DeliverableReport;
  /** 4J13 (H34): set when Chausar stopped while a step of this run was out; each step's state as it survived. */
  interrupted?: { at: IsoTime; line: Display; steps: { callId: string; state: RunStepState }[] };
  /** 4J13 (H30): what background jobs reported into this run, oldest first; warning when one named no sources. */
  reports?: { at: IsoTime; from: 'heavy-work' | 'research'; line: Display; sources: string[]; warning: Display | null }[];
}
/**
 * The Delivered card of an accepted run (4J3, A17). files: what the run handed over, made by its own tools (tables its
 * succeeded calls made, what the owner's own command-line tool left), each with its digest. changed: apart from those,
 * the files on the order that changed while the run went on, made by someone else; changedLine labels them "Changed
 * during this run, not proven to be the agent's." source is a code the screen words for itself (English and Hindi).
 */
export interface DeliveredView { line: Display; files: DeliveredFile[]; changed: DeliveredFile[]; changedLine: Display | null }
export interface DeliveredFile { id: string; name: Display; digest: string; at: IsoTime; source: 'table' | 'delegate' | 'order-file' | 'transcript' | 'poster'; line: Display }
/** A run's scope as the run sheet shows it (4F1): tools and outside actions in purpose words, the cap, the posture. */
/** 4F3: capReceiptId, the cap's receipt (views/row-receipts.ts); capRupees and capRate, the cap in rupees at the owner's own rate, only with a rate set. */
export interface RunScopeView { tools: Display[]; actions: Display[]; cap: Display; posture: Posture; line: Display; capReceiptId: string; capRupees?: Display; capRate?: Display }
export type Posture = 'rehearsal' | 'shadow' | 'approve-each' | 'auto-spot-check';
export interface AgentView {
  id: string; name: string; role: string; now: Display; posture: Posture; spend: Display;
  last?: { line: Display; receiptId?: string; estimate?: boolean };
  steps: { id: string; purpose: string; gate: 'auto' | 'hold'; floor: boolean }[];
  // Ink v2 wave 4 (4A1 unless named): the agent's department; 'code' for the code role and for Keeper; its state from
  // facts only; its health; the helper's parent (4J12); who set its posture (O16); whether it has a chat (4B1).
  department?: DepartmentId;
  kind?: 'agent' | 'code';
  state?: 'working' | 'waiting' | 'failed' | 'idle';
  health?: AgentHealth;
  parentId?: string | null;
  postureSetBy?: 'business' | 'agent';
  chat?: boolean;
}
export type VentureRunEventType = 'run.started' | 'run.step' | 'run.waiting' | 'run.done' | 'run.failed' | 'queue.changed'
  | 'agent.message' | 'chief.message' | 'proposal.created' | 'notify.new' | 'pipeline.changed' | 'run.stopped' | 'run.call' | 'keeper.ran'
  | 'chain.changed' | 'desk.changed' | 'idea.changed';
/** seq: the event's place in the business's log, so a client that reconnects replays the gap (4G1); count: on notify.new only. */
export interface VentureRunEvent { type: VentureRunEventType; businessId: string; runId?: string; at: string; seq?: number; count?: number }
// phase 2 views (SpendRow is in section 8c)
/**
 * Ink v2 wave 4 (4J1, O17): allowedBy, on an entry for a step that ran without asking: the saved rule, the agent and step
 * it is on (Stop always allowing is venture.team.gate { agentId, stepId, gate: 'hold' }), and the rule's record id.
 */
export interface JournalEntry {
  id: string; action: string; target: string; state: 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown'; at: string; line: Display; receiptId?: string;
  allowedBy?: { rule: 'auto' | 'session'; agentId: string; stepId: string; ruleId: string | null };
  /** 4J10 (H27): how far it went after applied, as the provider reported, and how each target ended. Absent when none. */
  endState?: 'accepted' | 'processed' | 'shown' | 'result' | 'verified';
  targets?: { id: string; outcome: 'applied' | 'rejected' | 'partial' | 'unknown' | 'throttled'; line: Display }[];
}
/** dismissed: the owner said no to this suggestion (venture.evidence.dismiss); it stays in the ledger and leaves Today. */
export interface EvidenceItem { id: string; subject: string; field: string; value: Display; type: string; strength: 'verified' | 'strong' | 'weak'; claim: 'observed' | 'inferred' | 'needs-your-data'; source: string; applied: boolean; dismissed?: boolean }
/**
 * One piece of evidence for one field (P2-evidence, venture/evidence/). subject is 'business' or 'client:<id>'. type is
 * what code accepted; claimedType what was claimed (a claim with no matching tool result in its run is downgraded to
 * model-inferred and flagged). Only verified evidence overwrites a stored value on its own; the rest waits as a suggestion.
 */
export type EvidenceRecord = RecordBase<'venture-evidence'> & {
  subject: string;
  field: string;
  value: string; // '' for needs-your-data: Chausar cannot see the value
  type: string;
  claimedType: string;
  strength: EvidenceItem['strength'];
  scoreBp: number; // combined fixed weights, in basis points
  claim: EvidenceItem['claim'];
  source: string; // plain words: where it came from, or why it was not checked
  by: 'owner' | 'agent' | 'engine';
  runId: string | null;
  toolCallId: string | null;
  flag: string | null; // why the claimed type was not accepted
  applied: boolean; // this value is the stored one for its field
  appliedAt: IsoTime | null;
  /** When the owner dismissed this suggestion; absent or null while it stands. A dismissed one never comes back to Today. */
  dismissedAt?: IsoTime | null;
};

/** The run event names inside VENTURE_EVENTS, in order. */
export const VENTURE_RUN_EVENT_TYPES: readonly VentureRunEventType[] = Object.freeze([
  'run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
  'agent.message', 'chief.message', 'proposal.created', 'notify.new', 'pipeline.changed', 'run.stopped', 'run.call', 'keeper.ran',
  'chain.changed', 'desk.changed', 'idea.changed',
] as const);
export const QUEUE_ACTION_IDS: readonly QueueActionId[] = Object.freeze([
  'approve', 'deny', 'later', 'watch', 'read', 'answer', 'send-to-ca', 'open', 'connect', 'set-prices', 'keep', 'issue', 'run-again',
  'sent', 'continue', 'stop', 'resume',
] as const);

/** One owner decision on a Today row. Decide-once: a second decision on the same row id is refused. */
export type QueueDecisionRecord = RecordBase<'venture-queue-decision'> & {
  rowId: string;
  subject: string; // the thing the row stands for, the same across its versions
  digest: string; // the row digest the owner decided on
  action: QueueActionId;
  line: string;
  receiptId: string | null;
  decidedBy: string; // memberId of the person who decided
  /** 4J2 review: set when the owner undid this decision; Today then shows the row again and it can be decided anew. */
  undoneAt?: IsoTime | null;
};
/** 4J2 review: the owner opened one exact version of a Today row inside the app (venture.queue.view); a set needs one for each item that must be read first. */
export type QueueViewMarkRecord = RecordBase<'venture-queue-view'> & { rowId: string; rowDigest: string };
/** The gate on one agent step. The newest record per agent and step wins; no record means the default. */
export type TeamGateRecord = RecordBase<'venture-team-gate'> & { agentId: string; stepId: string; gate: 'auto' | 'hold' };
/** An agent's own posture (P2-posture). The newest record per agent wins; it can only tighten the business posture. */
export type AgentPostureRecord = RecordBase<'venture-agent-posture'> & { agentId: string; posture: Posture };
/**
 * One spot-check decision for a run at auto with spot checks (P2-posture). Every such run gets one, sampled or not, so
 * the ordinal is a plain count. A sampled run waits on Today for the owner to look at it.
 */
export type SpotCheckRecord = RecordBase<'venture-spot-check'> & {
  runId: string;
  agentId: string;
  ordinal: number; // 1 for the agent's first run at this posture
  spendMicros: MicroString;
  rule: { everyNth: number; overMicros: MicroString };
  sampled: boolean;
  reason: 'every-nth' | 'over-spend' | null;
  line: string; // plain words: why it was or was not picked
  review: { verdict: 'looks-right' | 'needs-work'; by: string; at: IsoTime } | null;
};

// ---------------------------------------------------------------------------
// 9c. Ink final pass: the views and actions the last screens need. app/ui mirrors them in app/ui/src/engine/types.ts.
// ---------------------------------------------------------------------------

/**
 * venture.queue.view: what a Today row is about, in words the owner reads before deciding (a draft's text and files, an
 * invoice, the plan, a CA sign-off request, a post's exact text). Text only; every figure arrives formatted.
 */
export interface QueueItemView {
  kind: 'draft' | 'file' | 'plan'; id: string; businessName: string; agent?: string;
  title: string; line?: Display;
  sections: { heading?: string; lines: Display[] }[];
}
/**
 * venture.money.overview: three lines code adds up in BigInt, each with the receipt behind it. rupees: the AI spend line
 * in rupees at the owner's own rate, with that rate; absent without one.
 */
/** kind, source, uses and basis (4J4, M13 and M14): how the line's figure was made. */
export interface MoneyOverviewLine {
  id: 'owed' | 'received' | 'spent'; label: Display; value: Display; receiptId?: string; estimate?: boolean; rupees?: Display;
  /** 4Z3: the AI spend line as the owner's currency leads it (the 'spent' line only). */
  lead?: SpendLead;
  kind?: FigureKind; source?: FigureSource; uses?: Display[]; basis?: TotalBasis;
}
export interface MoneyOverview { lines: MoneyOverviewLine[] }
/** venture.tax.working: the tax working for a period, every figure from code with its receipt. */
export interface TaxWorkingLine { label: Display; value: Display; receiptId?: string }
export interface TaxWorkingSection { id: string; title: Display; lines: TaxWorkingLine[]; note?: Display }
export interface TaxWorkingView { period: Display; sections: TaxWorkingSection[]; needsCaConfirmation: boolean }
/** venture.ca.get (the AI-native CA firm playbook): the CA of record, rate tables waiting for the CA, and sign-off requests. */
export interface CaPendingRate { tableId: string; title: Display; version: string; validFrom: string; validTo: string | null; citations: string[] }
export interface CaRequestView { signoffId?: string | null; id: string; deliveryId: string; title: Display; state: 'sent' | 'signed' | 'returned'; at: string }
/** The newest regulated draft a run made with the calculator's receipts (Ink v2 2A2): its run, its title and those receipts. */
export interface CaLatestPapers { deliveryId: string; title: Display; receiptIds: string[] }
export interface CaFirmView { citations?: import('./playbooks/ca-firm/records.ts').CaCitationsView; ca: { name: string; membershipNo: string } | null; pendingRates: CaPendingRate[]; requests: CaRequestView[]; latestPapers: CaLatestPapers | null }
/**
 * venture.share.*: a read-only preview link for a client. url is null when no public address is set; reason says why.
 * answer: the client's answer on this link, given through it or recorded by the owner (Ink v2 wave 2); absent until one.
 * revoked: the owner took the link back; only then present. 4J7: shareKind (absent for a draft), viewedAt once the
 * page was opened through its token, and comments once the client left one; each only when present.
 */
export interface ShareLinkView {
  id: string; url: string | null; reason?: Display; expiresAt: string; answer?: ShareAnswerView; revoked?: true;
  shareKind?: Exclude<ShareKind, 'draft'>; viewedAt?: IsoTime; comments?: ShareComment[];
}
/** venture.client.list rows: what the client owes on open invoices, summed in BigInt, with the sum's receipt. */
export type ClientListRow = ClientRecord & { owed?: { display: Display; receiptId: string } };
/** venture.invoice.list rows: the invoice total, formatted, and the price receipt behind it. */
/** next (4J5, M12): the invoice's one next step by its state, the same as its view's. */
/** late (4J4, M9): on an open invoice past its due day, the days on the owner's calendar ("71 days late"). */
export type InvoiceListRow = InvoiceRecord & { total?: Display; receiptId?: string; next?: InvoiceNext; late?: { days: number; line: Display } };

/**
 * A receipt for a sum code made from venture records: what clients owe on open invoices, what came in this month, what
 * AI and tools cost this month. Each addend names its record; the steps are BigInt additions. venture.receipt.get serves
 * it beside price receipts. unit 'micros' is micro-USD (spend); 'minor' is the venture currency's minor unit.
 */
export type SumReceiptSubject =
  | { type: 'owed'; clientId: string | null }
  | { type: 'received'; from: IsoDate; to: IsoDate }
  | { type: 'spent'; month: string }
  // Ink v2 wave 4: each plan lives in its owner's file and money/sums.ts currentPlan calls it (package 4-0 named them).
  // AI and tool spend of one department, or 'shared' for spend no single role can claim, from one day to another (4A1).
  | { type: 'spent-department'; department: DepartmentId | 'shared'; from: IsoDate; to: IsoDate }
  // Invoices before tax this month: issued ones less issued credit notes, or drafts ready to issue (4I1).
  | { type: 'invoiced'; month: string; which: 'issued' | 'ready' }
  // How the month stands against its goal (4I1): day null, still to invoice or past the goal by; a day, today's pace on
  // that day, ahead or behind by (a new receipt each day). Both add up the goal in use, so a replaced goal reads stale.
  | { type: 'goal'; month: string; goalId: string; day: IsoDate | null }
  // Open balances in five buckets by days late (4J4).
  // late (4J20): the late ones alone, more than zero days past their due date.
  | { type: 'aging'; asOf: IsoDate; late?: true }
  // A month's money in and out, and what was left (4J4).
  | { type: 'flow'; month: string; part: 'in' | 'out' | 'left' }
  // One week of the 13-week cash forecast, if clients pay on time or if the late ones never pay (4J4).
  // scenario 'bank': the statements' closing balances alone, on asOf (week is asOf).
  | { type: 'cash'; asOf: IsoDate; week: IsoDate; scenario: 'on-time' | 'late-unpaid' | 'bank' }
  // One client's invoiced amount against the AI and tool spend of their orders (4J4).
  | { type: 'margin'; month: string; clientId: string; part: 'invoiced' | 'spend' | 'margin' }
  // A count, not money: people reaching each pipeline stage (4E1), ties in each band (4D2), jobs per department (4A1).
  // scope names what is counted (a stage, 'all', a department) over the days from and to.
  | { type: 'count'; what: 'funnel' | 'bands' | 'jobs'; scope: string; from: IsoDate; to: IsoDate }
  // What calls still running hold this UTC month (as the spend limit counts it), for one department, the shared part or
  // the whole team (4A1). Each is already inside the month's spend at its estimate; this says how much of it is held.
  | { type: 'held'; scope: DepartmentId | 'shared' | 'all'; month: string }
  // What is owed on open bills, those due on or before a day, or all of them when due is null (4J5).
  // billId (4J20): one bill, its lines and tax less what was paid (its balance).
  | { type: 'bills'; due: IsoDate | null; billId?: string }
  // One client's money for their statement (4J5, M17): paid so far, credit notes issued, or, with invoiceId, how one
  // invoice's balance is made (its total less what was paid and credited).
  | { type: 'statement'; clientId: string; part: 'paid' | 'credited' | 'balance'; invoiceId: string | null }
  // One figure across the businesses on this computer (4J6): with open, the open business's own sum as of now (its
  // records), then each other business's figure as its snapshot saved it, with when. month: the calendar month that
  // invoiced and received belong to, the UTC month for spend, null for owed. currency: all of them share it.
  | { type: 'across'; what: AcrossFigureId; month: string | null; currency: string; open: boolean; others: { businessId: string; name: string; asOf: IsoTime; amount: string }[] }
  // The total quote of a set the owner approved in one go (4J2, O9): each picked row in order, with what approving it
  // can cost in micro-dollars as code worked it out then (the subject holds it, so the receipt never drifts).
  | { type: 'set'; items: { rowId: string; label: string; micros: MicroString }[] };
/** 4J6. The figures a snapshot keeps and the across views show. */
export type AcrossFigureId = 'invoiced' | 'received' | 'owed' | 'spend';
export type SumReceiptRecord = RecordBase<'venture-sum-receipt'> & {
  subject: SumReceiptSubject;
  operation: 'venture.sum';
  currency: string;
  /** 'count': a count of records, not money (Ink v2 wave 4); totalMinor holds the count. */
  unit: 'minor' | 'micros' | 'count';
  /** rupeeRate (4J4): the rupees per US dollar an amount was converted at (ten-thousandths of a rupee), beside its record's id. */
  addends: { recordId: string; label: string; amount: string; display: string; rupeeRate?: string }[];
  steps: PriceStep[];
  figures: PriceFigure[];
  totalMinor: string;
  estimate: boolean; // true when any addend is an estimate (an unconfirmed price, a held reservation)
  allowedNumbers: string[]; // every number a later sentence may cite
  explanation: string;
  digest: string; // over the subject and the addends; a newer sum with other addends makes this one stale
  stale: boolean;
};

/**
 * A read-only preview link for one delivery draft (venture.share.*). The record keeps the token's sha256, never the token,
 * and a copy of the exact draft text the link shows. The client's answer goes through the social playbook's approvals
 * (playbooks/social/approvals.ts): decide-once, on the digest shown, before the link ends.
 */
export type ShareLinkStoredRecord = RecordBase<'venture-share-link'> & {
  deliveryId: string;
  clientId: string | null;
  tokenHash: string;
  title: string;
  text: string;
  draftDigest: string;
  expiresAt: IsoTime;
  state: 'open' | 'closed' | 'revoked';
  revokedAt: IsoTime | null;
  /** Whether a usable address was made at creation: false when no public address was set, so nobody can open it. */
  served: boolean;
  /** recordedFor (4J7, O20): the client the answer is recorded under; absent on answers recorded before. */
  decisions: { draftId: string; decision: 'approved' | 'changes'; comment: string | null; at: IsoTime; digest: string; via: 'share-link' | 'owner-recorded'; recordedBy: string | null; recordedFor?: string | null }[];
  /**
   * 4J7 (O20, M17, U11): what the link shows. Absent: 'draft'. 'order-status' shows a live order's steps (deliveryId
   * holds the order id), 'statement' a client's "What you owe us" (the client id), 'books' a month's figures for the
   * owner's accountant ('books:<month>'). Only a draft link can be answered.
   */
  shareKind?: ShareKind;
  /** 4J7 (O20): when the link's page was first opened through its token; the owner's own preview never counts. */
  viewedAt?: IsoTime | null;
  /** 4J7 (O20): the client's comments per item (per post), without an account; text only, screened before any prompt. */
  comments?: ShareComment[];
  /** 4J7 (M17): the open invoices a statement showed, so a client's view becomes each one's Viewed line. */
  invoiceIds?: string[];
  /** 4J7 (M17, U11): the sum receipts behind a statement's or a month's figures, sealed when the link was made. */
  receiptIds?: string[];
};
export type ShareKind ='draft' | 'order-status' | 'statement' | 'books';
/** One comment on one item of a shared draft: item is a post id ('<run>.post-<n>') or 'draft' for the whole. */
export type ShareComment = { item: string; text: string; at: IsoTime; recordedFor: string | null };

// ---------------------------------------------------------------------------
// 9d. Ink v2 wave 2: what the newly wired pieces answer. app/ui mirrors them in app/ui/src/engine/types.ts.
// ---------------------------------------------------------------------------

/**
 * venture.delivery.judge: the rules judge's call on one ready real-order draft, previewed and waiting for the owner to
 * send it (venture.delivery.judgeSend with this digest). It carries the client's words, so it never goes on its own.
 */
export interface DeliveryJudgePreview { runId: string; digest: string; estimatedMaxCostDisplay: Display; expiresAt: IsoTime; containsClientData: true }
/** venture.posting.propose: the post waits on Today for the owner's approval. line says so; warnings are the risk gate's. */
export interface PostingProposal { postId: string; connectorId: string; draftId: string; part: number | null; state: ConnectorPostState; line: Display; warnings: Display[] }
/**
 * venture.posting.checkSteps: each browser step's candidates with the day each last matched exactly one visible
 * element, and stepsCheckedOn, the oldest such day across the three steps (null while any step has none). The confirm
 * step also carries the platform's response rule, dated by a post the response confirmed. boxAndButtonCheckedOn: the
 * oldest day across the text box and the post button, the steps a check can see.
 */
export interface PostingStepsView {
  connectorId: string;
  steps: {
    step: PostingStepId;
    candidates: (PostingCandidate & { key: string; checkedOn: IsoDate | null; addedBy: 'chausar' | 'owner' })[];
    response?: { key: string; method: string; path: string; checkedOn: IsoDate | null };
  }[];
  stepsCheckedOn: IsoDate | null;
  boxAndButtonCheckedOn: IsoDate | null;
  line: Display;
}
/** A client's answer on a shared draft, given through the link or recorded by the owner (venture.share.recordAnswer). */
export interface ShareAnswerView { draftId: string; decision: 'approved' | 'changes'; comment: string | null; at: IsoTime; via: 'share-link' | 'owner-recorded' }
/**
 * One post a draft holds: a line "Channel: text", numbered from 1 in text order over every channel, as
 * '<delivery run id>.post-<n>' (playbooks/social/run-approvals.ts). connectorId is null for a channel with no posting
 * connector in this build.
 */
export interface DraftPostView { draftId: string; channel: string; name: string; connectorId: string | null; text: string }
/**
 * The posting limits the owner may tighten for one channel, in the owner's units (playbooks/social/post-limits.ts):
 * posts in 24 hours, minutes between posts, warm-up days, the near-duplicate threshold in whole percent, the link streak.
 */
export type OwnerPostingLimitsView = { capPer24h: number; minGapMinutes: number; warmUpDays: number; duplicatePercent: number; linkStreak: number };
/** The owner's stricter limits for one channel (venture.posting.limits.set). An empty set means Chausar's own limits. */
export type PostingLimitsRecord = RecordBase<'venture-posting-limits'> & { connectorId: string; limits: Partial<OwnerPostingLimitsView> };
/** venture.posting.limits.*: per channel, Chausar's own limits, the owner's stricter ones, and the ones the risk gate uses. */
export interface PostingLimitsView {
  channels: { connectorId: string; name: string; house: OwnerPostingLimitsView; owner: Partial<OwnerPostingLimitsView>; inUse: OwnerPostingLimitsView }[];
  line: Display;
}
/**
 * venture.social.calendar: the calendar file the engine built (UTF-8 with a byte order mark), the name to save it under
 * and its row count. blocked: each post it left out, with its channel's name, its words and why. defused: the posts
 * whose cell starts with a mark spreadsheets read as a formula, so the file put an apostrophe first. threads: the posts
 * written as the numbered thread parts code split them into, in one cell, to post by hand part by part. gaps: where the
 * draft's posts and the plan's slots do not match, one line per channel.
 */
export interface SocialCalendarFile {
  csv: string; fileName: string; rows: number; blocked: { draftId: string; name: string; text: string; line: Display }[];
  defused: string[]; threads: string[]; gaps: Display[];
}

/**
 * How a bank statement row reads against the books (venture.bank.ledger): a transfer between the owner's own accounts,
 * money in that looks like an invoice's payment, plain money in or out, or a row the owner already decided.
 */
export type BankRowClass = 'own-transfer' | 'suggested-payment' | 'money-in' | 'money-out' | 'applied' | 'skipped';
/**
 * dateDisplay: the row's date as the owner's country writes it. description and counterparty are null off the app
 * channel (phone, MCP, a tainted context). flag: the engine's words when something about the row needs the owner's eye
 * (already recorded as a typed payment, or recorded in the books but paired as an own transfer), else null.
 */
export interface BankLedgerRow {
  id: string; accountId: string; account: string; date: IsoDate; dateDisplay: Display; amount: Display; direction: 'in' | 'out';
  description: string | null; counterparty: string | null; classification: BankRowClass; flag: Display | null;
  /** The other own account's row an own transfer pairs with; null when unpaired. */
  pairedWith: string | null;
  /** The invoice a money-in row looks like it pays, with the engine's words ("pays it in full"); null when none matched. */
  suggestion: { invoiceId: string; number: string; line: Display } | null;
  /** What the owner decided on this row (venture.bank.apply), or null. */
  decided: BankMatchRecord['as'] | null;
}
/** consent: the account's read-only bank access in words (consentStatus), null when never given; provider: why nothing reads the bank yet. */
export interface BankLedgerView {
  accounts: { id: string; label: string; currency: string; consent: BankConsentView['status'] | null }[]; rows: BankLedgerRow[]; line: Display; provider: Display;
}
/** venture.bank.apply: the row as it reads now, the engine's line, and the books receipt when a payment or a cost was recorded. */
export interface BankApplyResult { row: BankLedgerRow; line: Display; receiptId?: string }
/** venture.bank.alerts.*: each account's alert rules, each rule in the engine's words, and where alerts go, in words; never the address itself. */
export interface BankAlertsView { accounts: { account: string; accountId: string; rules: BankAlertRule[]; ruleLines: Display[]; destination: Display }[] }

/** An explanation the CA of record recorded for one portal difference on a stored CA receipt (venture.ca.explainDiff). */
export interface CaDiffExplanation { receiptId: string; key: string; note: string; caName: string; membershipNo: string; at: IsoTime }
/**
 * venture.ca.receipt: a stored CA receipt as the CA reads it, worked again from its inputs with the exact table
 * versions it stamped. 'differs' names the first key that came out differently; 'table-gone' when a stamped version no
 * longer exists, which is never read as 'same'.
 */
export interface CaReceiptView {
  id: string; runId: string | null; engine: CaEngine | 'portal-diff';
  figures: { key: string; label: string; display: Display }[];
  steps: { key: string; label: string; display: Display; section: string | null }[];
  tables: TableStamp[]; assumptions: string[]; openQuestions: string[];
  rederived: 'same' | 'differs' | 'table-gone'; differs: { key: string; line: Display } | null;
  explanations: CaDiffExplanation[];
  /** On a portal diff only: each key that is not the same, both sides as figures, and the CA's explanation or null (Ink v2 2A2). */
  portalDifferences?: { key: string; label: string; state: 'differs' | 'missing-on-portal' | 'only-on-portal'; ours: Display | null; portal: Display | null; explanation: string | null }[];
}

/** One dated platform rule a flagship playbook's checks rest on (venture.rules.list), as the owner reads it. */
export interface PlatformRuleView {
  id: string; platform: string; rule: Display; checkedOn: IsoDate; stale: boolean;
  /** The step or check ids of the playbook that use this rule. */
  usedBy: string[];
  limitations: string[];
  source: { title: string; url: string } | null;
  /** Ink v2 wave 5 (5A3): every source it was read from; a house rule's is "Chausar's own rule" with no address (url ''). */
  sources: { title: string; url: string }[];
  line: Display;
}
/** 5A3 (P6): a recipe the owner can follow: when to use it, steps with why, how to read the result, common mistakes. */
export interface RecipeView { id: string; name: Display; whenToUse: Display; steps: { do: Display; why: Display }[]; howToRead: Display; mistakes: Display[] }
/** 5A3 (P6): one row of the measurement-boundaries table: what this evidence can say and what it cannot. */
export interface BoundaryView { evidence: Display; canSay: Display; cannotSay: Display }
/**
 * venture.rules.list: the playbook's rules with their freshness, its risk level and when it was last reviewed; for a kit
 * playbook (5A3) also its recipes and its measurement boundaries (empty for the flagships). Empty with no playbook.
 */
export interface RulesListView {
  playbook: { id: string; label: string; riskLevel: string; lastReviewed: IsoDate } | null;
  rules: PlatformRuleView[];
  summary: Display;
  recipes: RecipeView[];
  boundaries: BoundaryView[];
}

/**
 * venture.judge.auto.get and .set: whether the judge runs on its own on every ready draft for a client or the public,
 * when its standing consent was recorded (null until then, or while off), and the setting's sheet line in plain words.
 */
export interface JudgeAutoView { auto: boolean; consentAt: IsoTime | null; line: Display }

/**
 * The owner's whisper.cpp for transcripts made on this computer (venture.transcription.set): full paths to whisper-cli
 * and to its model file, both null once cleared. The newest is in use; the engine puts it in place when the workspace
 * opens (platform/runtime/speech.ts restoreLocal). Never on the hosted server.
 */
export type TranscriptionSetupRecord = RecordBase<'venture-transcription-setup'> & { command: string | null; model: string | null };
/**
 * venture.transcription.get and .set: the setup's honest status (set up, not set up, or its files are not where they
 * were set up, checked on disk each time), its paths, whether ffmpeg is on this computer too, and a plain line.
 */
export interface TranscriptionSetupView { status: 'set-up' | 'not-set-up' | 'files-missing'; command: string | null; model: string | null; ffmpeg: boolean; line: Display }

// ---------------------------------------------------------------------------
// 9e. Ink v2 wave 4: departments and Keeper, agent chat and notes, Chats with the chief of staff, the owner's network,
// the pipeline and outreach, run controls, notifications, the CLI status, goals and the 4J rows. Package 4-0 declared
// every name here with the fields its package text names; each package fills its own records and views. Field names
// that would clash with RecordBase.kind say what kind they are (proposalKind, importKind, outreachKind, sourceKind).
// app/ui mirrors the views in app/ui/src/engine/types.ts. Money is minor units as text, never a JS number.
// ---------------------------------------------------------------------------

/** The five departments every agent belongs to (4A1; playbooks/departments.ts holds their words and the role map). */
export const DEPARTMENT_IDS = ['sales', 'marketing', 'production', 'money', 'operations'] as const;
export type DepartmentId = typeof DEPARTMENT_IDS[number];

/** Keeper's jobs: the engine's own work, run as code, never AI (4A1). The probes (4G2) and the calendar feed (4E3) write runs too. */
export type KeeperJobId = 'backups' | 'journal-sweep' | 'connection-checks' | 'rule-freshness' | 'rate-tables' | 'posting-steps' | 'network-strength' | 'probes' | 'calendar-feed'
  | 'monitors'; // 5A6 (K16): the owner's page monitors
export type KeeperOutcome = 'ok' | 'warn' | 'failed';
/** The last run of one Keeper job: one record per job, replaced each run (4A1). */
export type KeeperRunRecord = RecordBase<'venture-keeper-run'> & { job: KeeperJobId; outcome: KeeperOutcome; line: string };
/**
 * The owner cleared an agent's quarantine (4A1, venture.team.clearQuarantine), with the health digest and reason they
 * saw. Health counts failed runs and undeclared outside actions only after the newest clear for that agent.
 */
export type HealthClearRecord = RecordBase<'venture-health-clear'> & { agentId: string; digest: string; reason: string };

/** Who wrote a line in an agent's thread: the owner, the agent, or Chausar passing on the chief's brief (4C1 brief-agent). */
export type AgentMessageFrom = 'owner' | 'agent' | 'chausar';
/**
 * A typed part of a chat answer (4B1, 4C1): words; a figure that a tool of this answer returned, with its receipt and
 * key; or a number the model wrote, shown as a model estimate. Code checks every figure part before it is stored.
 */
export type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; receiptId: string; key: string; display: Display }
  | { kind: 'estimate'; text: string };
/** What an agent's reply suggests the screen opens: a New order sheet prefilled with the owner's request. Nothing is created (4B1). */
export type AgentSuggestion = { kind: 'order'; offerId: string | null; request: string };
/** One message in an agent's thread (4B1). answered: it was recorded as the answer to that run's open question (A2). */
export type AgentMessageRecord = RecordBase<'venture-agent-message'> & {
  agent: string;
  from: AgentMessageFrom;
  text: string;
  parts: ChatPart[];
  author: LineAuthor;
  callId: string | null;
  runId: string | null;
  proposalId: string | null; // an instruction or note proposal (venture-agent-proposal), or a drafted proposal (venture-proposal)
  suggestion: AgentSuggestion | null;
  answered: { runId: string; handoff: number } | null;
};
/**
 * 'instruction': a "from now on" change to the agent's steps (4B1); 'note': a note from the owner's own words (4B2);
 * 'import': an agent file's standing orders and persona, never a direct change (4J17).
 */
export type AgentProposalKind = 'instruction' | 'note' | 'import';
export type AgentProposalStatus = 'drafted' | 'accepted' | 'rejected';
/** One line of a change to a step's guidance, with the lines around it. */
export type DiffLine = { op: 'same' | 'add' | 'remove'; text: string };
/** 'always': loaded into every act task of the agent, 2,000 characters in all; 'topic': recalled when it shares a word with the order (4B2). */
export type AgentNoteLoad = 'always' | 'topic';
export type AgentNoteScope = 'agent' | `client:${string}`;
/**
 * A change the owner's words asked for, waiting for Accept (4B1, 4B2). An instruction holds the typed patch (proposedBy
 * 'owner'), the versions, the hash of the playbook it was drafted against and the step's guidance as diff lines; a
 * note holds the note as it will be saved. quoteDigest: a rejected quote is never proposed again.
 */
export type AgentProposalRecord = RecordBase<'venture-agent-proposal'> & {
  agent: string;
  proposalKind: AgentProposalKind;
  quote: string;
  quoteDigest: string;
  messageId: string | null;
  patch: PlaybookPatch | null;
  fromVersion: number | null;
  toVersion: number | null;
  parentHash: string | null;
  diff: DiffLine[];
  appliesTo: string | null;
  note: { scope: AgentNoteScope; load: AgentNoteLoad; text: string } | null;
  label: string | null; // 'Drafted by Chausar from your words' when templates drafted it
  status: AgentProposalStatus;
  digest: string;
  decidedAt: IsoTime | null;
  decidedBy: string | null;
  /** 4J17 (A18), kind 'import': the owner patches an agent file adds, the persona it sets, and what was left out with why. */
  imported?: { patches: PlaybookPatch[]; persona: PersonaFields | null; skipped: string[] };
};
/**
 * One chat consent per business covers agent chat, Chats and network search, which send client or contact data to the
 * owner's AI (4B1). It names the connected AI; a change of AI connection makes it stale.
 */
export type ChatConsentRecord = RecordBase<'venture-chat-consent'> & {
  textDigest: string;
  presetId: ModelPresetId | null;
  connectionId: string | null;
  model: string | null;
  by: string;
};

/** A note an agent keeps (4B2), from the owner's own words only. scope 'client:<id>' when the words name a client. */
export type AgentNoteRecord = RecordBase<'venture-agent-note'> & {
  agent: string;
  scope: AgentNoteScope;
  load: AgentNoteLoad;
  text: string;
  source: { kind: 'owner-words' | 'owner-edit'; quote: string | null; messageId: string | null };
  captured: IsoDate;
  hash: string;
  forgotten: boolean;
};
export type NoteSnapshot = { text: string; hash: string; scope: AgentNoteScope; load: AgentNoteLoad };
/** Every change to a note, so it can be undone exactly (4B2): who made it, and the note before and after. */
export type AgentNoteChangeRecord = RecordBase<'venture-agent-note-change'> & {
  agent: string;
  noteId: string;
  who: 'owner' | 'proposal' | 'undo';
  before: NoteSnapshot | null;
  after: NoteSnapshot | null;
  undoOf: string | null;
};

/** A Chats thread with Chausar as chief of staff (4C1), in the open business's vault. routine: the routine that posts into it (4J13). */
export type ChiefThreadRecord = RecordBase<'venture-chief-thread'> & { title: string; pinned: boolean; routine: string | null; lastAt: IsoTime };
/** One message in a Chats thread (4C1): the owner's words, or the chief's typed answer with the receipts its tools returned. */
export type ChiefMessageRecord = RecordBase<'venture-chief-message'> & {
  threadId: string;
  from: 'owner' | 'chief';
  text: string;
  parts: ChatPart[];
  author: LineAuthor;
  callIds: string[];
  receiptIds: string[];
  proposalIds: string[];
  routedTo: string | null; // the agent a message beginning with its name went to (A15)
  read: boolean;
  /** 4C1: the receipted figures the answer quotes, for the "Worked by the calculator" table. */
  worked?: { label: string; value: string; receiptId: string }[];
  /** 4C1: the engine's lines for what the answer left out (a figure with no receipt, a proposal Chausar cannot make). */
  dropped?: string[];
  /** 4C2 review: the counts by code (4J14, Q21) when the AI's answer failed or there is no AI, for the screen to word. */
  counted?: ChiefCounted | null;
};
/** 4C2 review: what code counted from the vault: each kind's records, and the new ones in each month (oldest first). */
export type ChiefCounted = { entities: { kind: string; count: number }[]; months: { month: string; count: number }[] };
/**
 * What a proposal asks the engine to do once the owner approves it on Today (4C1): brief an agent (posted at once, no
 * Today card), start a run, start work on a floor step (4B1), draft an invoice or a reminder, quote, draft outreach, or
 * set a pipeline next step (4E3's meeting digest).
 */
export const PROPOSAL_KINDS = ['brief-agent', 'start-run', 'start-work', 'draft-invoice', 'draft-reminder', 'quote', 'outreach-draft', 'next-step'] as const;
export type ProposalKind = typeof PROPOSAL_KINDS[number];
export type ProposalStatus = 'drafted' | 'raised' | 'approved' | 'dismissed' | 'refused';
/** A proposal (4C1): drafted, raised to Today, then approved or dismissed. input: what the engine method for its kind takes. */
export type ProposalRecord = RecordBase<'venture-proposal'> & {
  proposalKind: ProposalKind;
  source: 'chief' | 'agent' | 'meeting' | 'idea';
  threadId: string | null;
  messageId: string | null;
  agent: string | null;
  title: string;
  line: string;
  input: Json;
  spends: boolean;
  sends: boolean;
  status: ProposalStatus;
  digest: string;
  raisedAt: IsoTime | null;
  decidedAt: IsoTime | null;
  decidedBy: string | null;
  outcome: string | null;
};

/** The owner's own files the network is read from (4D1): nothing is fetched. */
export const NETWORK_IMPORT_KINDS = ['linkedin-connections', 'linkedin-messages', 'contacts-csv', 'vcard', 'calendar-ics', 'mail-headers'] as const;
export type NetworkImportKind = typeof NETWORK_IMPORT_KINDS[number];
/** Where one fact about a person came from: an import's row, the owner's own words, or a public page (4D3). */
export type SourceRef = { connector: NetworkImportKind | 'owner' | 'web'; importId: string | null; row: number | null; url?: string };
/** 'link' (4D2): the owner said this person knows another (detail { personId, note }); a warm path's second leg on the owner's word. */
export type PersonFactKind = 'name' | 'email' | 'phone' | 'linkedin' | 'role' | 'meeting' | 'mail' | 'message' | 'connection' | 'contact' | 'client' | 'you-said' | 'web' | 'link';
/** One fact about a person with its source row. detail holds kind-specific fields (a meeting's attendee count, a mail's direction). */
export type PersonFact = { id: string; kind: PersonFactKind; value: string; date: IsoDate | null; detail: Json | null; source: SourceRef };
export type PersonRole = { title: string | null; company: string | null; asOf: IsoDate | null; source: SourceRef };
/** A person in the owner's network (4D1). roles keeps earlier roles a re-import replaced (4D3); history journals merges and splits. */
export type PersonRecord = RecordBase<'venture-person'> & {
  name: string;
  handles: { emails: string[]; phones: string[]; linkedinUrl: string | null };
  role: PersonRole | null;
  roles: PersonRole[];
  facts: PersonFact[];
  hidden: boolean;
  clientId: string | null;
  history: { op: 'import' | 'merge' | 'split' | 'hide' | 'show' | 'know' | 'link'; from: string[]; at: IsoTime; by: string }[];
};
/** One import of the owner's file (4D1): what it read, made, merged and dropped (message text, photos, notes). */
export type NetworkImportRecord = RecordBase<'venture-network-import'> & {
  importKind: NetworkImportKind;
  fileName: string;
  digest: string;
  rows: number;
  people: number;
  merged: number;
  dropped: { what: string; count: number }[];
  forgottenSkipped: number;
  undoneAt: IsoTime | null;
  /**
   * People already in the network that this import merged into another (into), as they were, and the records the merge
   * moved from them to into (cards, drafts, evidence rows, search entries by index, people whose split history now names
   * into), so Undo puts every one back exactly.
   */
  absorbed?: NetworkAbsorbed[];
  /** People already here this import changed: their client link and hidden flag before and after, for Undo. */
  before?: { id: string; clientId: string | null; hidden: boolean; clientIdAfter: string | null; hiddenAfter: boolean }[];
};
export type NetworkAbsorbed = {
  into: string;
  person: PersonRecord;
  /**
   * searches: each moved result by what it holds (fit, page, checks) and how many shown entries moved, so Undo finds them
   * by person even after other entries went. copies: older imports' Undo copies (by the person they hold) that pointed at
   * the person merged away and now point at into.
   */
  repointed: {
    cards: string[]; drafts: string[]; evidence: string[]; searches: { id: string; results: { fitBp: number; url: string | null; checks: string }[]; shown: number }[];
    splits: string[]; copies?: { importId: string; persons: string[] }[];
  };
};
/**
 * A person the owner asked Chausar to forget (4D1): a keyed one-way check of each handle (HMAC-SHA256 with the business's
 * network key, which lives on the engine's secret shelf, never in a record), so a later import skips them; names: the
 * same keyed check of each word of their name (three letters or more), so a later meeting title naming them reads
 * "Meeting". kept: what the law keeps. Empty lists: there was no key to make the checks with.
 */
export type ForgottenRecord = RecordBase<'venture-forgotten'> & {
  hashes: { kind: 'email' | 'phone' | 'linkedin'; hash: string }[]; names: string[]; kept: string[]; by: string; scheme: 'hmac-sha256';
};

/** Relationship bands, closest first (4D2); five dots to one. */
export const TIE_BANDS = ['close', 'know-well', 'know', 'met-once', 'cold'] as const;
export type TieBand = typeof TIE_BANDS[number];
export type TieSignalKind = 'mail-both' | 'mail-one' | 'meeting' | 'client' | 'contact' | 'linkedin-messages' | 'linkedin-connection' | 'you-said';
/**
 * One signal of a tie, in basis points, faded by its half-life from its last date (4D2). count: what the weight is
 * multiplied by (months, meetings) or 1; weightBp: after the cap, before fading. source: where it came from, in words
 * ('Mail headers, takeout.mbox'); line: what it is ('Mail both ways in 6 months, the last on 20 Oct 2026').
 */
export type TieSignal = { kind: TieSignalKind; count: number; last: IsoDate | null; weightBp: number; decayedBp: number; source: string; line: string };
/**
 * How well the owner knows one person, computed in code (4D2). digest: over what the tie rests on (each signal's kind,
 * count, last day, weight, source and line) and its band; a tie keeps its id while that stays the same.
 */
export type TieRecord = RecordBase<'venture-tie'> & { personId: string; signals: TieSignal[]; scoreBp: number; band: TieBand; computedAt: IsoTime; digest: string };
/** One step of a tie receipt, in whole numbers: a weight times its count, a cap, a fade, the sum, the band. */
export type TieStep = { op: 'multiply' | 'cap' | 'fade' | 'add' | 'band'; inputs: string[]; result: string; rule: string };
/**
 * A tie's receipt (4D2), served by venture.receipt.get beside price and sum receipts: one line per signal with its
 * source, and every step from the weights to the band, worked out by code from the stored tie, never by a model. stale:
 * what the tie rests on has changed since (venture.network.recompute works it out again).
 */
export type TieReceipt = {
  id: string; kind: 'venture-tie'; ventureId: string; at: IsoTime; personId: string; operation: 'venture.tie'; unit: 'bp';
  lines: Display[]; steps: TieStep[]; figures: PriceFigure[]; totalBp: string; band: TieBand; allowedNumbers: string[];
  explanation: Display; digest: string; stale: boolean;
};
/**
 * A receipt for a figure a Today row states (4J1), served by venture.receipt.get beside price, sum and tie receipts and
 * worked out again by code from the stored record it names on every read, never by a model: the most a call can cost
 * from the price table, the room a cap window adds, a spend quote, the prices a plan version sets, this month's spend
 * against its limit. Each figure's amount is in its own unit: 'micros' (micro-USD), 'minor' (the currency's minor unit)
 * or 'rate' (rupees per dollar in ten-thousandths). stale: the record no longer says this.
 */
export type RowFigure = { key: string; label: string; amount: string; unit: 'micros' | 'minor' | 'rate'; currency: string; display: Display };
export type RowFigureReceipt = {
  id: string; kind: 'row-figure'; ventureId: string; at: IsoTime; operation: 'venture.row-figure';
  // 4G2: 'week-total' and 'week-average', the two figures of a "moved sharply" notice (views/probe-figures.ts).
  // 4F3: 'scope-cap', a run's spend cap as its scope froze it when it started.
  // 5A2: 'go-no-go', a GO card's maximum loss against the owner's limit (playbooks/kit/go-no-go.ts).
  subject: { type: 'call-cost' | 'judge-cost' | 'cap-room' | 'spend-quote' | 'plan-price' | 'month-spend' | 'week-total' | 'week-average' | 'scope-cap' | 'go-no-go'; recordId: string };
  figures: RowFigure[]; allowedNumbers: string[]; explanation: Display; digest: string; stale: boolean;
};
/** One trait a plain-English search looks for (4D3). */
export type SearchTrait = { id: string; label: string };
/** One trait checked on one person: yes, partly or not supported, with the quote and the stored field it came from. */
export type TraitCheck = { traitId: string; check: 'yes' | 'partly' | 'not-supported'; quote: string | null; field: string | null };
/** The stored fields a plain-English search reads about a person (4D3). There is no location field: a place shows only in these words. */
export const SEARCH_FIELDS = ['title', 'company', 'earlier-role', 'note', 'meeting'] as const;
export type SearchField = typeof SEARCH_FIELDS[number];
/**
 * What code runs a search by (4D3), from the structured query the owner's AI made of their words: per trait, the stored
 * fields and the words to look for in them (to gather candidates, and to run a saved search again in code after an
 * import); clients, months without contact (calendar months, by date arithmetic) and the least band are exact filters
 * code checks.
 */
export type SearchFilters = {
  terms: { traitId: string; fields: SearchField[]; words: string[] }[];
  clients: 'any' | 'only' | 'none';
  quietMonths: number | null;
  knownAtLeast: Exclude<TieBand, 'cold'> | null;
};
/**
 * One person (or, for web: true, one public page) a search checked (4D3). by 'code': code alone checked the words (a
 * saved search's re-run after an import, added: that import's id); otherwise the owner's AI scored it in call callId and
 * code checked every quote. page: a web result's page as the web search showed it, screened; never a person's profile.
 */
export type NetworkSearchResult = {
  personId: string | null; url: string | null; fitBp: number; checks: TraitCheck[];
  by?: 'model' | 'code'; added?: string; callId?: string | null; page?: { title: string; text: string; host: string };
};
/**
 * One plain-English search (4D3): its traits, how many it read, what it found, who was shown, and its name once saved.
 * filters: what code runs it by (absent on records older than 4D3's code). traitsCallId: the call that made the traits;
 * batches: each scoring call and the people whose fields it carried, so Forget can erase those calls' text.
 */
export type NetworkSearchRecord = RecordBase<'venture-network-search'> & {
  text: string;
  traits: SearchTrait[];
  candidates: number;
  web: boolean;
  callIds: string[];
  results: NetworkSearchResult[];
  shown: string[];
  saved: { name: string; at: IsoTime } | null;
  filters?: SearchFilters;
  traitsCallId?: string | null;
  batches?: { callId: string; people: string[] }[];
};

/** The pipeline's stages (4E1). Forward only; won, lost and not-now are terminal. */
export const PIPELINE_STAGES = ['found', 'asked', 'talking', 'proposal', 'won', 'lost', 'not-now'] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];
export const LOST_REASONS = ['no-budget', 'no-reply', 'chose-someone-else', 'not-a-fit', 'timing', 'other', 'opted-out'] as const;
export type LostReason = typeof LOST_REASONS[number];
/** The owner's lawful basis for a cold email (4E2). */
export type LawfulBasis = 'they-wrote-first' | 'existing-contact' | 'public-business-contact';
/** What made a card (C13): an import row, a search, a saved search, the owner, or a lead's source page. */
export type OpportunityTrigger = { kind: 'import' | 'search' | 'saved-search' | 'owner' | 'lead'; ref: string | null; line: string };
/** One move between stages with the evidence it needs (4E1). */
export type StageMove = {
  from: PipelineStage | null; to: PipelineStage; at: IsoTime; by: string;
  evidence: { kind: 'send' | 'reply' | 'owner' | 'quote' | 'client' | 'reason' | 'lead'; id: string | null; line: string };
};
/** A follow-up sequence, copied onto the card when it starts so a later change to the settings never rewrites it (4E1). */
export type FollowupSequence = {
  kind: 'intro-request' | 'first-email' | 'message';
  steps: { afterDays: number; channel: OutreachChannel | null }[];
  weekdays: number[];
  sendTime: string;
  copiedAt: IsoTime;
};
/**
 * One send the owner recorded on a card, or one reply they got (4E1): what follow-ups count from. on: the owner's day
 * it happened; at: when it was recorded; kind: a send's place (the first note or a follow-up); ref: the draft, the
 * inbound message or the lead's draft it rests on. Chausar never sends.
 */
export type CardTouch = {
  what: 'sent' | 'reply'; on: IsoDate; at: IsoTime; kind: 'first' | 'nudge' | null; channel: OutreachSentChannel | null; ref: string | null; by: string;
};
/** One card on the pipeline (4E1). */
export type OpportunityRecord = RecordBase<'venture-opportunity'> & {
  personId: string; // a person in the network; for a lead that matches nobody there, the lead's own id
  stage: PipelineStage;
  trigger: OpportunityTrigger;
  history: StageMove[];
  next: { text: string; due: IsoDate } | null; // the owner's own next step; follow-ups come from sequence and touches
  sequence: FollowupSequence | null;
  nudges: number;
  leadId: string | null;
  clientId: string | null;
  linkedFrom: string | null; // the Not now card an "Ask again" card follows
  lostReason: LostReason | null;
  askAgainFrom: IsoDate | null;
  basis: LawfulBasis | null;
  touches?: CardTouch[]; // 4E1: absent on a card stored before it, read as none
  votes?: CardVote[]; // 4E1: per-factor votes for the lead score, absent when there are none
};
/** One owner rule for the lead score (C12): fields from a fixed list, protected traits refused. */
export type ScoreRule = { field: string; operator: 'is' | 'contains' | 'at-least' | 'at-most'; value: string; points: number };
/** One vote on one factor of a card's score (C12): the page that backs it, or the word "guess". */
export type CardVote = { factor: string; points: number; evidence: string };
/** The owner's pipeline settings (4E1): allowed weekdays (ISO, 1 is Monday), send time, daily and weekly caps, score rules. */
export type PipelineSettingsRecord = RecordBase<'venture-pipeline-settings'> & {
  weekdays: number[];
  sendTime: string;
  caps: PipelineCaps;
  scoreRules: ScoreRule[];
};
/** The send governor's lanes (4E2): LinkedIn notes and messages count apart; a call is not governed. */
export type OutreachLane = 'linkedin-note' | 'linkedin-message' | 'whatsapp' | 'email';
/** 4E1's people a day and a week; channels (4E2): the owner's lower daily caps per lane, never above Chausar's own. */
export type PipelineCaps = { newPerDay: number; perWeek: number; channels?: Partial<Record<OutreachLane, number>> };

/** What a drafted message is (4E2). 'reminder': 4J5's invoice reminder, handed off the same way. */
export const OUTREACH_KINDS = ['intro-request', 'double-opt-in', 'connection-note', 'follow-up', 'reply', 'cold-email', 'reminder'] as const;
export type OutreachKind = typeof OUTREACH_KINDS[number];
export type OutreachChannel = 'email' | 'linkedin' | 'whatsapp';
/** How the owner sent it, recorded by the owner's "I sent it" (4E2). Chausar never sends. */
export type OutreachSentChannel = 'own-mailbox' | 'linkedin' | 'whatsapp' | 'phone';
/** A message Chausar drafted for the owner to send from their own app (4E2). footer: only on cold email. */
export type OutreachRecord = RecordBase<'venture-outreach'> & {
  opportunityId: string | null;
  invoiceId: string | null;
  personId: string | null;
  outreachKind: OutreachKind;
  channel: OutreachChannel;
  to: string | null;
  subject: string | null;
  text: string;
  blurb: string | null;
  footer: { unsubscribe: string; postalAddress: string } | null;
  sourceUrl: string | null;
  basis: LawfulBasis | null;
  lints: { rule: string; line: string }[];
  by: 'agent' | 'owner';
  callId: string | null;
  digest: string;
  sent: { at: IsoTime; channel: OutreachSentChannel; recordedAt: IsoTime; recordedBy: string } | null;
  acceptedOn: IsoDate | null; // a connection note LinkedIn's export later shows accepted
  language?: OutreachLanguage; // 4E2: the language it was drafted in; absent is English
  noteLimit?: 200 | 300; // 4E2: a connection note's limit, the owner's free or Premium account
  /** 4E2: who else the draft names: the person a double opt-in introduces, the target of an intro request. Forget removes it. */
  aboutPersonId?: string | null;
  /** 4E2: the import whose LinkedIn export showed the connection note accepted; its Undo takes the acceptance back. */
  acceptedBy?: string | null;
};
/** The languages Chausar drafts in (4E2). */
export type OutreachLanguage = 'en' | 'hi';

/** The owner's read-only mailbox (4E3). The app password lives on the engine's secret shelf, never in a record. */
export type MailboxRecord = RecordBase<'venture-mailbox'> & {
  host: string;
  port: number;
  user: string;
  status: 'connected' | 'disconnected' | 'failed';
  uidValidity: string | null;
  cursor: string | null;
  lastSync: IsoTime | null;
  line: string;
};
/** What code decided about an inbound message before any model read it (4E3). */
export type InboundTriage = 'opt-out' | 'auto-reply' | 'thanks' | 'bounce' | 'owner-reply' | 'bot-question' | 'talking' | 'unmatched';
/** One inbound message from someone in the network or the pipeline (4E3). Chausar's own processed state, never the mailbox's. */
export type InboundRecord = RecordBase<'venture-inbound'> & {
  messageId: string;
  from: string;
  to: string[];
  date: IsoTime;
  subject: string;
  references: string[];
  matched: { opportunityId: string; confidenceBp: number } | null;
  triage: InboundTriage;
  line: string;
  processed: boolean;
  screen: ScreenNote | null;
  /** 4E3: who in the network it is from (by email, then LinkedIn address, then name and company), or null. */
  personId?: string | null;
  /** 4E3: the cards it may be about, by code's confidence, when none was clear enough to attach (the owner confirms). */
  candidates?: { opportunityId: string; confidenceBp: number }[];
  /** 4E3: what a reply the owner answers asks about, found in code. */
  topics?: InboundTopic[];
  /**
   * 4E3: what a delivery report said about each address Chausar wrote to in the last 30 days: bounced (5.x.x, blocked),
   * its domain gone (5.1.2, 5.4.4: the address blocked, the domain only if the owner says so), or held 90 days (4.x.x).
   */
  bounces?: { address: string; status: string; scope: 'address' | 'domain' | 'suppress'; until: IsoDate | null }[];
  /** 4E3: a domain a report says takes no mail, waiting for the owner to say whether to block all of it. */
  domainAsk?: string | null;
  /**
   * 4E3: an opt-out: the addresses blocked at once (always the one it came from), and what waits for the owner: the
   * open cards to close as Lost (when the receiving server could not prove the mail) and the person's own addresses to
   * block (when it was matched by name or LinkedIn, not by address).
   */
  optOut?: { blocked: string[]; close: string[]; block: string[] };
  /** 4E3: Hindi words in the reply, so the fixed answer to "are you a bot" is drafted in Hindi too. */
  hindi?: boolean;
  /** 4E3: what the owner decided on it: matched it to a card, said it was not about one, moved the card, or set it aside. */
  handled?: { how: 'confirmed' | 'not-them' | 'moved' | 'done'; at: IsoTime; by: string } | null;
  /**
   * 5A6 (mail in): 'file-import' for a message from an .eml or .mbox file the owner imported (build/mail-in.ts); absent
   * for 4E3's mailbox sync. Only an imported message keeps its new words (text, screened, at most 4,000 characters; null
   * when the screen held them) and its attachments (MailAttachment); the import it came in is importId.
   */
  source?: 'file-import';
  text?: string | null;
  attachments?: MailAttachment[];
  importId?: string;
};
/** What a reply asks about, so the owner answers it (4E3, C11). */
export type InboundTopic = 'price' | 'contract' | 'meeting' | 'buying';
/**
 * The owner's private calendar address (4E3): the host only, since the address itself reads the whole calendar and so
 * lives on the engine's secret shelf. events: calls with people in the network that ended lately or end today, kept
 * only so Today can ask for notes after each (no titles, no other attendees); notesAt: notes added or declined.
 */
export type CalendarFeedRecord = RecordBase<'venture-calendar-feed'> & {
  host: string;
  status: 'set' | 'removed' | 'failed';
  lastRead: IsoTime | null;
  /** 4J7 (K6): how the last read at lastRead ended, for the connector truth; absent on records written before. */
  lastOutcome?: 'answered' | 'failed';
  digest: string | null;
  line: string;
  events: { id: string; endAt: IsoTime; personIds: string[]; notesAt: IsoTime | null; declined: boolean }[];
};

/** The owner is away from one day to another (4F1). */
export type AwayRecord = RecordBase<'venture-away'> & { from: IsoDate; to: IsoDate; by: string; clearedAt: IsoTime | null };
/** Pause all (4F1): new runs are refused while paused; stopRunning also stopped the running ones. The newest record wins. */
export type PauseRecord = RecordBase<'venture-pause'> & { paused: boolean; stopRunning: boolean; by: string };
/**
 * The owner raised one write cap for one day on their calendar (4F2, venture.runs.allowWrites): that day the cap is
 * doubled, once. capThen: the cap as it stood when raised.
 */
export type WriteAllowanceRecord = RecordBase<'venture-write-allowance'> & { capKind: WriteCapKind; day: IsoDate; capThen: number; by: string };

/**
 * One needs-you item the owner was told about (4G1): one episode of its row's subject on Today, so it never notifies
 * twice while it stays. An episode ends when the row leaves Today, the owner decided that row, or its run waits on the
 * owner again; a later return is a new record. Once ended, the title is a kind word (no client or person name stays),
 * and the record is deleted 30 days later.
 */
export type NotificationRecord = RecordBase<'venture-notification'> & {
  subject: string;
  rowId: string;
  rowKind: QueueKind;
  title: string;
  readAt: IsoTime | null;
  alertedAt: IsoTime | null;
  digestOn: IsoDate | null;
  expiresAt: IsoTime | null;
  /**
   * How an alert outside the app settled this item (4G1, set with alertedAt): 'sent' an alert counted it; 'seen' the
   * owner was watching when it came; 'paused' it came during a pause; 'off' no outside channel was on. Null or absent
   * while it waits (quiet hours, or the wait between alerts). Only 'sent' items count as alerts; urgent: an item
   * expiring within 2 hours whose alert passed quiet hours and the wait.
   */
  alert?: NotificationAlert | null;
  urgent?: boolean;
  /** When this episode ended (see above); absent or null while it is on Today. */
  endedAt?: IsoTime | null;
  /**
   * 4G3: the moments an alert counting this item could not go out at all (nothing left this computer). They stay in the
   * alert history, so the pacing holds while the item waits again; gaveUpAt: the third such moment, after which it no
   * longer waits and the next new item brings the count.
   */
  tries?: IsoTime[];
  gaveUpAt?: IsoTime | null;
};
export type NotificationAlert = 'sent' | 'seen' | 'paused' | 'off';
/**
 * One day's digest (4G1), written by code at the owner's hour: the line, the notifications it listed for the first
 * time, how many earlier ones still wait, the runs that finished since the last digest, and the sum receipt behind
 * money ready to invoice. alertedAt: when its count went outside the app, else null.
 */
export type NotifyDigestRecord = RecordBase<'venture-notify-digest'> & {
  day: IsoDate;
  line: string;
  needYou: number;
  listed: string[];
  stillWaiting: number;
  runIds: string[];
  ready: { display: string; receiptId: string } | null;
  alertedAt: IsoTime | null;
};
/** The owner's notification settings (4G1, 4G3). relay: the owner's own https address alerts post a count to. The newest wins. */
export type NotifySettingsRecord = RecordBase<'venture-notify-settings'> & {
  pausedUntil: IsoTime | null;
  quietHours: { from: string; to: string } | null;
  digest: { hour: number } | null;
  push: boolean;
  tray: boolean;
  relay: string | null;
};
/**
 * One browser push subscription on a known push service (4G3), tied to the hosted session that made it: sessionHash is
 * a hash of that session's id (never the id). It ends when that session signs out or is revoked, not when it idles or
 * expires. A gone or ended one is deleted, not kept.
 */
export type PushSubscriptionRecord = RecordBase<'venture-push-subscription'> & {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  host: string;
  sessionHash: string | null;
  /** Deliveries in a row that failed after their one retry; the third removes the subscription. */
  failures: number;
  /** The last such failure (when, and the push service's answer; null when none came), cleared by the next success. */
  lastFailure?: { at: IsoTime; status: number | null } | null;
};
/**
 * The hosted app's web push key (VAPID, 4G3). Trusted host composition, never a payload: the private half stays in the
 * host, and sign answers the raw P-256 signature (r then s, 64 bytes) over data. publicKey: the uncompressed point as
 * base64url, the key a browser subscribes with. subject: the contact the push services see (mailto: or https:), or null.
 */
export type WebPushPort = { readonly publicKey: string; readonly subject: string | null; sign(data: Uint8Array): Uint8Array };

/** What a check of the owner's command-line AI found on this computer, from evidence only (4H1). */
export type CliCheckRecord = RecordBase<'venture-cli-check'> & {
  cli: DelegateCli;
  found: boolean;
  version: string | null;
  flags: 'match' | 'mismatch' | 'unknown';
  missingFlags: string[];
  signedIn: 'yes' | 'no' | 'unknown';
  lastTask: { at: IsoTime; outcome: 'succeeded' | 'failed' } | null;
};

/** The owner's goal for one month: money invoiced before tax (4I1). A newer goal for the same month is the one in use. */
export type GoalRecord = RecordBase<'venture-goal'> & { month: string; amountMinor: MinorString; currency: string; by: string };

/** Who decided one item, and on what rule (4J1, O17). */
export type DecisionRecord = RecordBase<'venture-decision'> & {
  subject: string;
  action: string;
  who: 'owner' | 'saved-rule' | 'timeout';
  ruleId: string | null;
  reason: string;
  rowId: string | null;
};

/** The owner's own edit of a draft (4J2), with the hash of the draft it replaced; a later agent revision never overwrites it. */
export type DraftEditRecord = RecordBase<'venture-draft-edit'> & {
  runId: string; rowId: string; text: string; replacedHash: string; by: string; undoneAt: IsoTime | null;
  /** The text the edit replaced (the merge base when an agent revision lands later) and the owner's edit before it, for Undo. */
  replaced?: string; prior?: string | null;
};
/**
 * 4J2 (O5): the owner sent a draft back with words, or asked the agent to fix failed checks. words: what the revision
 * turn is told, beginning "Revise this to: "; previous: the text the owner saw, which the agent revises (their edit,
 * else the agent's draft); base: the agent's own draft, the merge base when the revision lands; callId: the revision
 * turn's call; prior: the run's call and loop phase before, so Undo puts the draft back while the revision has not
 * started. checks: a fix's targets.
 */
export type DraftRevision = {
  by: 'send-back' | 'fix'; words: string; rowId: string | null; at: IsoTime; callId: string; base: string; previous?: string;
  prior: { callId: string | null; phase: HarnessState['phase'] | null }; checks?: string[];
};
/** 4J2 (O6): one part of a landed revision's paragraph merge: paragraphs alike in all three, or one changed stretch. */
export type DraftMergePart =
  | { kind: 'same'; text: string[] }
  | { kind: 'change'; id: string; owner: string[]; agent: string[]; by: 'agent' | 'both'; status: 'open' | 'taken' | 'dropped' };
/**
 * 4J2 (O6): the three-snapshot merge made when a revision landed: the base the owner and the agent started from, the
 * owner's version, and the parts. edited: the owner had their own version; replacement: their choice on it, if any.
 */
export type DraftMerge = { at: IsoTime; edited: boolean; owner: string; parts: DraftMergePart[]; replacement: 'confirmed' | 'kept' | null };
/** 4J2: a fix's checks run again after its revision landed, and what that made of the fix (delivery/verdicts.ts fixStatus). */
export type DraftFix = { checks: string[]; status: 'fixed' | 'partially-fixed' | 'not-fixed' | 'unverified'; at: IsoTime };
export type TriageField = 'due' | 'client' | 'kind' | 'money' | 'business';
/** How the owner wants Today ordered, from fixed fields (4J2). A rule never hides a row. */
export type TriageRule = { keys: { field: TriageField; order: 'asc' | 'desc' }[]; words: string };
export type TriageRuleRecord = RecordBase<'venture-triage-rule'> & { rule: TriageRule; digest: string; by: string };
/** Unsent edits of one settings form, kept in the vault, never browser storage (4J2, O22). */
export type SettingsDraftRecord = RecordBase<'venture-settings-draft'> & { form: string; values: Json; by: string; clearedAt?: IsoTime | null };

/** One line of a bill, with the tax name and rate at that time (4J5). */
export type BillLine = { description: string; amountMinor: MinorString; taxName: string; taxRateBps: BpsString };
/**
 * 4J20: a bill line as venture.bills.add takes it: the amount as the owner typed it (amount, read in the business's
 * currency) or in minor units, and the rate as typed (taxRate, a percentage) or in basis points; one of each.
 */
export type BillLineInput = { description: string; taxName: string }
  & ({ amount: string; amountMinor?: never } | { amountMinor: MinorString; amount?: never })
  & ({ taxRate: string; taxRateBps?: never } | { taxRateBps: BpsString; taxRate?: never });
/** 4J20: an amount as typed (amount, read in its currency) or in minor units (amountMinor), one of them. */
export type TypedAmount = { amount: string; amountMinor?: never } | { amountMinor: MinorString; amount?: never };
/** A bill the business owes (4J5). States partial, paid and overdue are derived. */
export type BillRecord = RecordBase<'venture-bill'> & {
  vendor: string;
  lines: BillLine[];
  currency: string;
  billDate: IsoDate;
  dueDate: IsoDate;
  recurring: 'monthly' | 'quarterly' | null;
  /** 'cancelled': an expected bill of a repeat the owner stopped; it is never shown or counted. */
  status: 'draft' | 'posted' | 'cancelled';
  totalMinor: MinorString;
  paidMinor: MinorString;
  payments: { id: string; amountMinor: MinorString; paidOn: IsoDate; method: PaymentMethod; factId: string | null }[];
  /** Whether its GST was left out of the costs as claimable, kept from its first payment so later ones agree. */
  taxClaimed?: boolean;
};
/** A credit note against one invoice (4J5): on the always-ask floor, so it waits on Today until issued. */
export type CreditNoteRecord = RecordBase<'venture-credit-note'> & {
  invoiceId: string;
  amountMinor: MinorString;
  currency: string;
  reason: string;
  number: string | null;
  status: 'waiting' | 'issued' | 'cancelled';
  digest: string;
  issuedAt: IsoTime | null;
  /** Who issued or cancelled it on Today (the owner's member id). */
  decidedBy?: string;
  /** Its share before tax, worked out when issued (the last of a full credit takes the rest, so the shares add up). */
  beforeTaxMinor?: MinorString;
};
/** A recurring invoice (4J5): each due date makes a draft on Today, never issued by itself. */
export type RecurringInvoiceRecord = RecordBase<'venture-recurring-invoice'> & {
  clientId: string;
  offerId: string;
  frequency: 'monthly' | 'quarterly';
  startOn: IsoDate;
  end: IsoDate | null;
  nextOn: IsoDate | null;
  stoppedAt: IsoTime | null;
  /** The days late a reminder is due on for this schedule's invoices; absent: 3, 10 and 30. */
  reminderDays?: number[];
  /** The owner's price includes the tax (M15). */
  taxInclusive?: boolean;
  /** The drafts this schedule made, one per due date. */
  made?: { on: IsoDate; orderId: string; invoiceId: string }[];
};

/** One run of the connection checks (4J7): a cheap real read per connected connector, never a secret. */
export type ConnectorCheckRecord = RecordBase<'venture-connector-check'> & {
  /** name and fix (4J7): the row's connection in words and its one-sentence fix, null when nothing needs fixing. */
  rows: { connectorId: string; outcome: 'answered' | 'failed' | 'skipped'; line: string; account: string | null; expiresOn: IsoDate | null; name?: string; fix?: string | null }[];
};
/** A single-use link a client uploads one file through (4J7): the token's hash only, valid 15 minutes. */
export type FileRequestRecord = RecordBase<'venture-file-request'> & {
  orderId: string;
  note: string | null;
  tokenHash: string;
  expiresAt: IsoTime;
  lockedAt: IsoTime | null;
  usedAt: IsoTime | null;
  uploadId: string | null;
};

/** The owner's profile (4J9): first name for the greeting, and services the business does not sell (C21). */
export type OwnerProfileRecord = RecordBase<'venture-owner-profile'> & { firstName: string | null; excludedServices: string[] };
/**
 * 4J8. An offer the owner added to the plan: its stable plan offer id (offer_own_1 upward, never reused), its words and
 * how it is charged, kept in step with the plan's words; removedAt once the owner took it out. Never a price: that is
 * on the plan's offer, set by the owner.
 */
export type OwnerOfferRecord = RecordBase<'venture-owner-offer'> & {
  offerId: string; name: string; description: string; pricingModel: PricingModel; removedAt: IsoTime | null;
};
/**
 * The public half of a receipt signing key (4J10), kept for good once a receipt is signed with it, so old signatures
 * can still be checked. The private half is never stored: it is derived from the vault's own key when the vault opens
 * (SecretName receipt:signing), so no export, backup or record carries it.
 */
export type SigningKeyRecord = RecordBase<'venture-signing-key'> & { algorithm: 'ed25519'; publicKey: string };
/**
 * The chained journal (4J10, H26), one record per business. Each link covers one item of the journal: a step of an
 * entry or a post, a website edit's log line, an end state, the outcome per target, a tool call a saved rule allowed.
 * seq counts on from 1; prevDigest is the link before it, or the break that started this chain; digest is sha256 over
 * the link's canonical JSON; body is sha256 over the item. An item is linked once, when a Chausar write first makes it.
 * breaks: each break the owner accepted (venture.journal.acceptBreak), newest last; the chain is checked from it on.
 */
export type JournalChainLink = { seq: number; prevDigest: string; digest: string; item: string; body: string };
export type JournalChainBreak = { at: IsoTime; by: string; fromSeq: number; startSeq: number; digest: string; line: string };
export type JournalChainRecord = RecordBase<'venture-journal-chain'> & { links: JournalChainLink[]; breaks: JournalChainBreak[] };
/** One stored receipt's Ed25519 signature (4J10) over its canonical JSON, by the business's key (keyId, its record). */
export type ReceiptSignatureRecord = RecordBase<'venture-receipt-signature'> & {
  receiptId: string; receiptKind: 'venture-price-receipt' | 'venture-sum-receipt' | 'venture-work-receipt' | 'venture-tie'; keyId: string; signature: string;
};
/**
 * What venture.receipt.get adds to a signed receipt: the signature, the public half (SPKI, base64) that checks it, and
 * signed, the exact stored receipt as canonical JSON, which is what was signed, whatever view the answer shows.
 */
export type ReceiptSignature = { algorithm: 'ed25519'; publicKey: string; signature: string; signedAt: IsoTime; signed: string };

/** What an order is for and how done is proved (4J12, H24). Protected items are enforced by code; checks have stable ids. */
export type OrderContract = {
  goal: string;
  scope: string[];
  constraints: string[];
  protected: { kind: 'phrase' | 'file'; value: string }[];
  deliverables: { id: string; what: string; stage: string; doneWhen: string }[];
  checks: { id: string; what: string }[];
};
/**
 * One mark on a deliverable or acceptance check of a signed contract (4J12): done with its evidence, skipped with its
 * reason, or reopened, which only the auditor does. Marks append; the newest mark of an item is its state.
 */
export type ContractMark = { itemId: string; state: 'done' | 'skipped' | 'reopened'; evidence: string | null; reason: string | null; by: 'agent' | 'owner' | 'auditor'; at: IsoTime };
/**
 * One revision of an order's contract (4J12); revisions append. marks: the item marks so far (a new revision carries
 * them for the items it keeps). files: when signed, the digests of the order's files that the contract protects, so a
 * draft whose run changed one fails its checks.
 */
export type OrderContractRecord = RecordBase<'venture-order-contract'> & {
  orderId: string;
  contract: OrderContract;
  revision: number;
  proposedBy: 'owner' | 'agent';
  digest: string;
  signedAt: IsoTime | null;
  signedBy: string | null;
  marks?: ContractMark[];
  files?: { name: string; digests: string[] }[];
};

/** How a report up the team ends (4J12, H25). Only failed and needs_decision, to the owner, reach Today. */
export type RelayReport = 'done' | 'blocked' | 'failed' | 'needs_decision';
/** order: work down to a helper; report: one step up; handover: work to a sibling, with a brief; message: anything else. */
export type RelayKind = 'order' | 'report' | 'handover' | 'message';
/**
 * One message between two agents of a team, or a report up to the owner (to 'owner'), 4J12 (agents/relay.ts). from
 * is set by code from the turn's role, never by the words. text and brief are as the untrusted screen left them (the
 * held words when it held them); brief, on orders and handovers, carries the return cap and the spend line code adds.
 * status: delivered when the receiver is working now and reads it at its next turn, queued while it is idle. depth:
 * how many messages led to this one in its root task, this one included.
 */
export type AgentRelayRecord = RecordBase<'venture-agent-relay'> & {
  from: string;
  to: string;
  relayKind: RelayKind;
  rootId: string;
  causeId: string | null;
  depth: number;
  text: string;
  brief: string | null;
  report: RelayReport | null;
  status: 'delivered' | 'queued';
  screen: ScreenNote | null;
};

/** When a routine runs (4J13): never cron text. */
export type RoutineSchedule =
  | { kind: 'once'; at: IsoTime }
  | { kind: 'interval'; everyMinutes: number; from: IsoTime }
  | { kind: 'calendar'; weekdays: number[]; time: string; timeZone: string };
/** A routine (4J13): a standalone prompt on a schedule, for an agent or the chief. It never approves anything. */
export type RoutineRecord = RecordBase<'venture-routine'> & {
  name: string;
  agent: string | null;
  setBy: 'owner' | 'agent' | 'chief';
  prompt: string;
  schedule: RoutineSchedule;
  on: boolean;
  removedAt: IsoTime | null;
};
export type RoutineRunState = 'queued' | 'running' | 'needs-input' | 'completed' | 'failed' | 'missed' | 'skipped' | 'interrupted';
/** One occurrence of a routine (4J13). missed: how many occurrences one missed run stands for. */
export type RoutineRunRecord = RecordBase<'venture-routine-run'> & {
  routineId: string;
  dueAt: IsoTime;
  state: RoutineRunState;
  line: string;
  missed: number;
  runId: string | null;
  threadId: string | null;
};

/** One run of the guardrail drills against the playbook hash (4J15). */
export type DrillRunRecord = RecordBase<'venture-drill-run'> & {
  playbookHash: string;
  results: { drill: string; stopped: boolean; twinPassed: boolean; line: string }[];
  passed: boolean;
};

/** The business voice in six typed sections (4J17). */
export type VoiceSections = { audience: string[]; howITalk: string[]; neverUse: string[]; wordsIUse: string[]; willNotClaim: string[]; format: string[] };
/** The business voice for one language and channel (4J17); validated only after a held-out sample passed. */
export type VoiceRecord = RecordBase<'venture-voice'> & {
  language: 'en' | 'hi';
  channel: string | null;
  on: boolean;
  sections: VoiceSections;
  validated: boolean;
  learnedFrom: number;
  /**
   * Each venture.voice.set is a new version for its language and channel, kept, so the owner can go back (append-only).
   * draft: a voice venture.voice.learn worked out, waiting unsaved until the owner sets it; never checked or used.
   * learned: the word counts and verbatim lines code kept from the owner's own texts, and the held-out check; null by hand.
   */
  version: number;
  draft: boolean;
  learned: { counts: { word: string; count: number }[]; lines: string[]; heldOut: { passed: boolean; line: string } } | null;
};
/** An agent's persona, after the fixed rules (4J17). It never asks for a tool, a number or a change to facts or safety. */
export type PersonaFields = {
  tone: string | null;
  replyLength: 'short' | 'medium' | 'long' | null;
  greeting: string | null;
  handOffLine: string | null;
  blockedTopics: string[];
  signOff: string | null;
};
/**
 * One version of an agent's persona (4J17): each venture.persona.set, or an accepted import, is a new version, kept, so
 * the owner can go back. source: who set it: the owner on the page, an agent file they accepted, or going back.
 */
export type PersonaRecord = RecordBase<'venture-persona'> & { agent: string; persona: PersonaFields; version: number; source: 'owner' | 'import' | 'undo' };

/** One source of what the AI knows (4J18): text, a screened link, a file, or a best past piece of work. */
export type KnowledgeRecord = RecordBase<'venture-knowledge'> & {
  sourceKind: 'text' | 'link' | 'file' | 'past-work';
  title: string;
  text: string;
  url: string | null;
  uploadId: string | null;
  runId: string | null;
  screen: ScreenNote | null;
  removedAt: IsoTime | null;
};
/** An idea code made from evidence (4J18): it retires when its evidence no longer holds; dismissals are remembered. */
export type IdeaRecord = RecordBase<'venture-idea'> & {
  title: string;
  reason: string;
  evidence: { kind: string; id: string; line: string }[];
  prompt: string;
  rule: string;
  status: 'open' | 'started' | 'dismissed' | 'retired';
  decidedAt: IsoTime | null;
  /** Ink v2 wave 5 (5A3): an idea in the pipeline (rule 'pipeline'), its stage, author, days and grade; absent on 4J18's ideas. */
  pipeline?: IdeaPipeline;
};

// --- Wave 4 views (what the methods answer). Every figure arrives formatted with its receipt. ---

/** A figure with the receipt behind it. */
export type MoneyFigureView = { display: Display; receiptId: string };
/** One point of a series the engine scaled in code: valuePermille of the largest point, null (never 0) where there is no data. */
export type SeriesPoint = {
  key: string; label: Display; value: Display | null; valuePermille: number | null; receiptId: string | null;
  /** A money point in rupees at the owner's rate, labelled with that rate (4A1); absent without a rate or a value. */
  rupees?: Display;
  /** 4Z3: a money point as the owner's currency leads it; absent where there is no value. */
  lead?: SpendLead;
};

/** 4A1. healthy, or failing (two failed runs in a row), quarantined, degraded, each with one plain reason and the digest Clear quarantine sends. */
export type AgentHealthStatus = 'healthy' | 'failing' | 'quarantined' | 'degraded';
export type AgentHealth = { status: AgentHealthStatus; reason: Display | null; digest: string };
/**
 * 4A1. Spend this UTC month (as the spend limit and Money count it) in dollars, rupees beside them at the owner's rate,
 * and how much of it calls still running hold, in words with its own receipt. Calls running count at their estimate.
 */
/** sharePermille (4A2): a department's or the shared part's share of the month's whole spend, floored; 0 when nothing was spent. */
/** rate (4A2): the owner's rupee rate in words, the same words `rupees` and `held` end with, sent with them. */
/** lead (4Z3): the spend as the owner's currency leads it. */
export type DepartmentSpend = { display: Display; receiptId: string; rupees?: Display; rate?: Display; held?: Display; heldReceiptId?: string; sharePermille?: number; lead?: SpendLead };
export type DepartmentView = {
  id: DepartmentId;
  name: Display;
  counts: { working: number; waiting: number; stopped: number; idle: number };
  /** permille (4A2): this week's count scaled to the busiest department's, floored; 0 when no department did a job. */
  doneThisWeek: { count: number; receiptId: string; permille?: number };
  spendThisMonth: DepartmentSpend;
  series: { jobs: SeriesPoint[]; spend: SeriesPoint[] };
};
/** 4A1. One Keeper job and its last run, from records only; note says "Not run yet" or "Not on the hosted app". */
export type KeeperJobView = { id: KeeperJobId; name: Display; lastRun: { at: IsoTime; outcome: KeeperOutcome; line: Display } | null; note: Display | null };
export interface KeeperView { jobs: KeeperJobView[] }
export interface TeamListView {
  agents: AgentView[];
  /** 4A1: the five departments; always sent once 4A1 lands. */
  departments?: DepartmentView[];
  /** 4A1: spend no single role can claim ("Shared by the team"), with its own receipt; null when none. */
  shared?: DepartmentSpend | null;
  /**
   * 4A1: the team's totals, from the same partition as the departments: jobs done this week, and this month's spend,
   * which is Money's own figure (the departments and the shared part add up to it), with what calls running hold.
   */
  totals?: { doneThisWeek: { count: number; receiptId: string }; spendThisMonth: DepartmentSpend; held: MoneyFigureView | null };
  /** 4A1: a quarantine no single agent can claim (one cause, one digest; Clear quarantine with agentId 'team'). */
  teamHealth?: AgentHealth;
}

/** 4B1. needed: the consent sheet shows text and digest; stale: the AI connection changed; not-needed: templates only. */
export type ChatConsentView = { state: 'needed' | 'given' | 'stale' | 'not-needed'; text: Display | null; digest: string | null; at: IsoTime | null };
/**
 * proposalId (4B3): on the agent's reply to a request on the floor, the drafted proposal it raised to Today (its row's
 * subject is proposal:<id>), so the thread can open that card.
 */
export type AgentMessageView = { id: string; at: IsoTime; from: AgentMessageFrom; parts: ChatPart[]; suggestion?: AgentSuggestion; answered?: { runId: string }; proposalId?: string };
/** 4B1, 4B2. status 'stale': drafted against an older version; line then says so in the engine's words. */
export type AgentProposalView = {
  id: string; at: IsoTime; agent: string; kind: AgentProposalKind; status: AgentProposalStatus | 'stale';
  quote: string; title: Display; appliesTo: Display | null; diff: DiffLine[];
  fromVersion: number | null; toVersion: number | null; note: { text: string; scope: AgentNoteScope } | null;
  digest: string; line: Display | null;
};
/**
 * 4B1. One run the agent owned a step in, folded in its thread; recalled: the notes its turns carried (4B2), a note the
 * owner forgot since marked forgotten, with no words of it.
 */
export type AgentRunItem = { runId: string; at: IsoTime; purpose: Display; state: RunState; done: number; total: number; steps: RunStep[]; recalled: { id: string; text: string; forgotten?: boolean }[] };
export type AgentThreadItem =
  | { type: 'message'; message: AgentMessageView }
  | { type: 'run'; run: AgentRunItem }
  | { type: 'proposal'; proposal: AgentProposalView };
/** 4B1. The agent's open question, kept in one fixed place above the thread. */
export type AgentWaiting = { runId: string; rowId: string; question: Display };
export interface AgentThreadView {
  agent: { id: string; name: string; role: string };
  items: AgentThreadItem[];
  waiting: AgentWaiting | null;
  more: boolean;
  consent: ChatConsentView;
}
export interface AgentSendResult { added: AgentThreadItem[]; line: Display | null }
export interface AgentProposalDecision { proposal: AgentProposalView; line: Display; playbook?: { id: string; version: number } }
export interface AgentVersionUndo { playbookId: string; version: number; line: Display }
/** 4B1. One standing order in use on the agent's steps: the step, the version it arrived in and the owner's quote. */
export type StandingOrderView = { stepId: string; step: Display; text: string; since: number; quote: string; at: IsoTime };
/**
 * 4B3: what the agent panel reads, without writing (currentPlaybook, never ensurePlaybook). playbook: the version in use
 * (its hash is the digest venture.agents.version.undo takes), or null before one is stored. rebuildDue: the plan changed
 * (or this build grants more tools) since, so the next run or change builds a new version first. steps: the agent's own
 * steps in that version, with their guidance and check ids. undo: what Undo would do now: point back at the version the
 * last change was made from, rebuild without it, or null when the agent has no change from the owner in use.
 */
export type StandingPlaybookView = { id: string; version: number; hash: string; origin: 'plan' | 'improvement' | 'owner'; at: IsoTime };
export type StandingStepView = { stepId: string; title: Display; guidance: string[]; checks: CheckId[] };
export type StandingUndoView = { kind: 'back'; version: number } | { kind: 'rebuild' };
export interface StandingOrdersView { orders: StandingOrderView[]; playbook: StandingPlaybookView | null; rebuildDue: boolean; steps: StandingStepView[]; undo: StandingUndoView | null }

/** 4B2. */
export type AgentNoteView = { id: string; scope: AgentNoteScope; load: AgentNoteLoad; text: string; source: Display; captured: IsoDate; hash: string };
/** erases (4B3): undoing this change takes the note away, which erases its words like Forget (the UI asks first). */
export type NoteChangeView = { id: string; noteId: string; at: IsoTime; who: 'owner' | 'proposal' | 'undo'; line: Display; undone: boolean; erases: boolean };
/** 4B2. forgetLine: what the owner reads before Forget, which erases the words and cannot be undone. */
export interface AgentNotesView { notes: AgentNoteView[]; changes: NoteChangeView[]; usedChars: number; limitChars: number; forgetLine?: Display }
export interface AgentNoteChange { note: AgentNoteView | null; change: NoteChangeView }

/**
 * 4C1. amounts (4C2 review): each receipted figure lastLine states, exactly as written there, at its offset in UTF-16 code
 * units, with its receipt, so the screen wraps exactly that span in a Figure. lastLine is never cut inside one.
 */
export type ChiefLineAmount = { text: Display; start: number; length: number; receiptId: string };
export type ChiefThreadSummary = { id: string; title: string; pinned: boolean; lastAt: IsoTime; lastLine: Display; amounts: ChiefLineAmount[]; unread: number };
export type ChiefThreadGroupKey = 'pinned' | 'today' | 'this-week' | 'last-week' | 'earlier';
/** 4C2 review: consent is the business's one chat consent now (agents/consent.ts), so the screen agrees to exactly that text and digest. */
export interface ChiefThreadsView { groups: { key: ChiefThreadGroupKey; label: Display; threads: ChiefThreadSummary[] }[]; consent: ChatConsentView }
/** 4C1. secondAsk: Approve asks once more because it spends or sends. what (4C2 review): the step's own line; line says where it stands. */
export type ProposalView = {
  id: string; at: IsoTime; kind: ProposalKind; status: ProposalStatus; title: Display; line: Display; what: Display;
  agent: string | null; rowId: string | null; digest: string; secondAsk: boolean;
};
/** 4C1. worked: the calculator's lines when the answer carries them; dropped: the engine's lines for figures it left out. */
export type ChiefMessageView = {
  id: string; at: IsoTime; from: 'owner' | 'chief'; parts: ChatPart[]; proposals: ProposalView[];
  routedTo: { agent: string; name: string } | null; worked: { label: Display; value: Display; receiptId: string }[]; dropped: Display[];
  /** 4C2 review: the counts by code, or null. */
  counted: ChiefCounted | null;
};
export interface ChiefThreadView { thread: ChiefThreadSummary; messages: ChiefMessageView[]; more: boolean }
/** 4C1. ask: the chief's question back ("Which agent: Editor or Researcher?"); it never guesses. */
export interface ChiefSendResult { thread: ChiefThreadSummary; added: ChiefMessageView[]; ask: Display | null }
/** 4C1. One way to earn that fits, labelled a model estimate. */
export type ChiefFit = { wayId: string; line: Display; estimate: true };
export interface ProposalRaised { proposal: ProposalView; rowId: string | null; line: Display }

/** 4D1. */
export type PersonSummary = {
  id: string; name: string; initials: string; title: Display | null; company: string | null;
  band: TieBand | null; dots: number; hidden: boolean; degree: '1st' | '2nd' | null;
};
export type MergeSuggestion = { a: string; b: string; line: Display };
/**
 * 4D4: consent, the chat consent a network search needs, when it is needed (state 'needed' or 'stale', with the text the
 * owner reads and its digest for venture.chats.consent); null when it holds or nothing is sent (templates only).
 */
export interface PeopleView { people: PersonSummary[]; suggestions: MergeSuggestion[]; total: number; consent: ChatConsentView | null }
/** 4D1. One field Chausar keeps about a person, with its source row: the DPDP "What Chausar keeps about this person". */
export type PersonFieldView = { field: string; value: Display; source: Display; sourceId: string };
/** 4D2. A warm path; a connector leg with no fact behind it is "possible path, not confirmed". */
export type WarmPathView = { kind: 'direct' | 'same-company' | 'connector'; via: { id: string; name: string } | null; confirmed: boolean; strength: TieBand; line: Display };
export interface PersonView {
  person: PersonSummary;
  fields: PersonFieldView[];
  how: { line: Display; receiptId: string | null }[];
  paths: WarmPathView[];
  card: PipelineCardView | null;
  drafts: OutreachView[];
  merged: boolean;
  web: { text: string; url: string }[];
  /** 4D4: the LinkedIn address the files hold, normalised, or null. */
  linkedin: string | null;
}
/** 4D1. stale: "Imported 3 months ago. Download a new copy to catch new connections." once older than 60 days. */
export type NetworkSourceCard = { kind: NetworkImportKind; fileName: string; at: IsoTime; kept: number; dropped: number; line: Display; stale: Display | null };
/**
 * 4D2. How many ties sit in each band, from one count receipt. 4D4: permille, each band's share of all the ties counted,
 * per mille, floored in code (0 when nothing is counted), so a screen draws the bars without dividing.
 */
export type NetworkBandCounts = { close: number; knowWell: number; know: number; metOnce: number; cold: number };
export type NetworkBands = NetworkBandCounts & { receiptId: string; permille: NetworkBandCounts };
/** 4D4: webSearch, whether a web search is set up here (the host composed one), so a screen says so in place of the web choice. */
/**
 * 4E4: mailbox and calendar, the read-only mailbox's and the calendar address's state as their own methods answer it
 * (never the app password or the address itself), so Connections reads them on load; null on the hosted app, which
 * reads neither.
 */
export interface NetworkSourcesView {
  sources: NetworkSourceCard[]; bands: NetworkBands | null; webSearch: 'set-up' | 'not-set-up';
  mailbox: MailboxView | null; calendar: CalendarFeedView | null;
}
export type NetworkImportView = {
  id: string; kind: NetworkImportKind; fileName: string; at: IsoTime; rows: number; people: number; merged: number;
  dropped: { what: string; count: number }[]; undone: boolean; line: Display;
};
/** 4D1. check: what an import would keep and drop, with three samples, storing nothing; import: what it did. */
export type NetworkImportResult =
  | { mode: 'check'; kept: number; dropped: { what: string; count: number }[]; people: number; merged: number; samples: { name: string; line: Display }[]; line: Display }
  | { mode: 'import'; import: NetworkImportView; line: Display };
/**
 * 4D1. removed: the people the import alone brought in, who go. goes: the owner-made work that goes with them, by person
 * ("Neha Shah: a pipeline card and 1 draft"). preview: true when nothing was changed and this only says what would go.
 */
export interface NetworkImportUndo { import: NetworkImportView; removed: number; goes: Display[]; preview: boolean; line: Display }
export interface PersonSplit { person: PersonView; split: PersonView }
export interface NetworkForgotten { line: Display; kept: Display[] }
export interface NetworkRecompute { ties: number; computedAt: IsoTime; line: Display }

/** 4D3. why: built by code from checked quotes and their sources, never model prose. */
export type SearchResultView = {
  person: PersonSummary | null; url: string | null; fitBp: number; why: Display;
  checks: { trait: Display; check: 'yes' | 'partly' | 'not-supported'; quote: string | null; source: Display | null }[];
  path: WarmPathView | null; inPipeline: PipelineStage | null; cold: boolean;
  /** 4D4: the tie's receipt (how well the owner knows them), and the LinkedIn address their files hold; null for a web result. */
  receiptId: string | null; linkedin: string | null;
};
/**
 * 4D3. What the web part of a search did, for the screens to branch on (never the words): off (not asked), not-set-up
 * (no web search here), skipped (asked, but the search is about people the owner knows, or the words held an id
 * number), failed (the web search did not answer), none (asked, nothing usable came back), found (cold results added).
 */
export type SearchWebState = 'off' | 'not-set-up' | 'skipped' | 'failed' | 'none' | 'found';
export interface NetworkSearchView {
  id: string; text: string; traits: { id: string; label: Display }[]; results: SearchResultView[];
  summary: Display; more: boolean; webLine: Display | null; web: SearchWebState;
}
export type SavedSearchView = { id: string; name: string; at: IsoTime };
/** 4D3. "Before you write": public pages only, each line with its URL. web: what the look-up did, for the screens to branch on. */
export interface PersonResearch { lines: { text: string; url: string }[]; line: Display; web: 'not-set-up' | 'failed' | 'none' | 'found' }

/** 4E1. */
export type PipelineCardView = {
  id: string; personId: string; name: string; initials: string; company: string | null; stage: PipelineStage;
  band: TieBand | null; dots: number; path: WarmPathView | null;
  next: { text: Display; due: IsoDate; line: Display; late: boolean } | null;
  draft: Display | null; business: string; trigger: Display;
  /** 4E4: the waiting draft the draft line names (the newest not sent), so the screens open it again after a reload. */
  draftId: string | null; draftChannel: OutreachChannel | null;
  /**
   * 4E4: for each kind and channel a draft may take here, whether it is cold outreach (customers/leads.ts coldOutreach,
   * read with the tie of whoever it goes to: an intro's connector, else the card's person) and whether it still needs
   * its lawful basis (cold, and no basis kept on the card for its own person). basis: the one kept on the card.
   */
  outreach: { kind: OutreachKind; channel: OutreachChannel; cold: boolean; needsBasis: boolean }[];
  basis: LawfulBasis | null;
  /** 4E4: on a Proposal card, the quote it rests on, with its price receipt; on a Won card, the client it made, in words. */
  quote: { value: Display; receiptId: string } | null;
  client: { name: string; line: Display } | null;
  score: { bucket: 'hot' | 'warm' | 'cold'; reasons: Display[] } | null;
  timeline: { what: 'sent' | 'scheduled' | 'projected' | 'reply' | 'accepted'; at: IsoDate; line: Display; estimated: boolean }[]; // accepted: 4E2
  // 4E1: blocked, the blocklist covers them (a flag, never a stage); thread, how long since they last wrote, once they have.
  blocked?: Display;
  thread?: { age: 'alive' | 'cooling' | 'presumed-dead'; days: number; line: Display };
};
export type PipelineColumnView ={ stage: PipelineStage; label: Display; sub: Display; count: number; folded: boolean; cards: PipelineCardView[] };
export type StatTileView = { id: string; label: Display; value: Display; line: Display | null; receiptId: string | null };
/** 4E1. forecast: from the last 90 days with its receipt, or the line "Not enough history yet". */
export interface PipelineView {
  columns: PipelineColumnView[];
  tiles: StatTileView[];
  /** 4E4: reachedPermille, the stage's count against the largest stage's, so a bar is drawn without dividing; share, movedOnPermille in words ("71%"). */
  funnel: { stage: PipelineStage; reached: number; movedOnPermille: number | null; receiptId: string; reachedPermille: number; share: Display | null }[];
  forecast: { value: Display; label: Display; receiptId: string } | { line: Display } | null;
  /**
   * 4E4: the quotes the business made (venture.price.quote receipts), newest first, at most QUOTE_PICKS, for a Proposal
   * move's evidence. A quote names no person, so the list is the business's, not one card's.
   */
  quotes: PipelineQuoteView[];
}
/** 4E4: one quote the board offers as Proposal evidence: its offer's name, quantity and amount before tax (or its total). */
export type PipelineQuoteView = { receiptId: string; offer: Display; quantity: string; value: Display; at: IsoTime };
export type FollowupView = { cardId: string; name: string; company: string | null; line: Display; due: IsoDate; late: boolean; channel: OutreachChannel | null; draftId: string | null };
export interface FollowupsView { due: FollowupView[]; later: FollowupView[] }
export interface PipelineCardResult { card: PipelineCardView; line: Display }
export interface PipelineSettingsView { weekdays: number[]; sendTime: string; caps: PipelineCaps; scoreRules: ScoreRule[]; line: Display }
/** 4E1. What a pipeline move rests on, as the owner gives it. */
export type PipelineEvidenceInput = { kind: 'reply' | 'quote' | 'note' | 'client'; id?: string; on?: IsoDate; text?: string };

/**
 * 4E2. counter: a connection note's characters against the owner's limit. author: written by the owner's AI, by
 * Chausar's own template, or (a lead list draft) by the owner. accepted: the day LinkedIn's export showed a connection
 * note accepted. 4E2's own views always carry author, language and accepted; they are optional so a view another
 * package builds (4J5's reminder) still types, and read there as a template, English, not accepted.
 */
export type OutreachView = {
  id: string; opportunityId: string | null; kind: OutreachKind; channel: OutreachChannel; to: Display | null;
  subject: string | null; text: string; blurb: string | null; footer: { unsubscribe: string; postalAddress: string } | null;
  lints: { rule: string; line: Display }[]; counter: { used: number; limit: number } | null;
  sent: { at: IsoTime; channel: OutreachSentChannel } | null; digest: string;
  author?: 'model' | 'template' | 'owner'; language?: OutreachLanguage; accepted?: { on: IsoDate; line: Display } | null;
  /** 4E2: the engine's words for the sheet: Chausar never sends, and counts only the notes the owner marks as sent. */
  line?: Display;
  /** 4E4: how many sentences the forwardable note has, counted by code; null with no note. */
  blurbSentences?: number | null;
};
/** 4E2. One handoff to the owner's own app; nothing is sent. */
export type OutreachHandoff =
  | { action: 'mailto'; url: string; line: Display }
  | { action: 'linkedin'; profileUrl: string; text: string; line: Display }
  | { action: 'whatsapp'; url: string; line: Display }
  /** A message too long for one link the desktop opens (30,000 characters): the owner copies the text instead. */
  | { action: 'copy'; to: string | null; subject: string | null; text: string; line: Display };
export interface OutreachSentResult { draft: OutreachView; card: PipelineCardView | null; line: Display }
export interface OutreachRestriction { channel: OutreachChannel; until: IsoTime; line: Display }

/** 4E3. */
/** 4E4: needsPassword, connected but the app password is no longer on the shelf (the app was opened again since). */
export interface MailboxView { connected: boolean; host: string | null; user: string | null; lastSync: IsoTime | null; line: Display; needsPassword: boolean }
export interface MailboxSync { mailbox: MailboxView; added: number; line: Display }
export type InboundView = { id: string; from: string; date: IsoTime; subject: string; triage: InboundTriage; matched: { opportunityId: string; name: string } | null; line: Display };
export interface InboundListView { items: InboundView[] }
/** 4E4: nextRead, when the morning read comes next (six on the owner's clock), while the address is on the shelf; else null. */
export interface CalendarFeedView { set: boolean; host: string | null; lastRead: IsoTime | null; line: Display; nextRead: IsoTime | null }
/**
 * 4E3. "After a call": people mentioned, and intros and next steps as drafted proposals. steps: every step and intro the
 * notes hold, each with its proposal, or with the engine's line saying why it has none (no date written in the notes, no
 * card for that person).
 */
export interface MeetingDigestView {
  people: { name: string; personId: string | null }[]; proposals: ProposalView[]; line: Display;
  steps: { text: Display; person: string | null; due: IsoDate | null; proposalId: string | null; line: Display }[];
}

/** 4F1. lost: what a force stop throws away, in the engine's words. */
export interface RunControlResult { run: RunDetail; line: Display; lost?: Display }
export interface PauseView { paused: boolean; stopped: number; line: Display }
/** 4F1. A code-built list for the owner's time away; autoReply is text for the owner to paste into their own mail app. */
export interface AwayView {
  away: { from: IsoDate; to: IsoDate } | null;
  promises: { due: IsoDate; line: Display }[];
  keepsRunning: Display[];
  approvalsWaiting: number;
  autoReply: string | null;
  line: Display;
  /** Once the time away began: Today's rows made between the two days, for the "Since you left" filter. */
  since?: { from: IsoDate; to: IsoDate; rowIds: string[] };
}
/** 4F2. The per-day write caps an agent can hit. */
export type WriteCapKind = 'drafts' | 'books-lines' | 'messages';
export interface AllowWritesView { kind: WriteCapKind; line: Display }

/** 4G1. title: the row's title, for the in-app centre only. */
export type NotificationView = { id: string; rowId: string; kind: QueueKind; title: Display; at: IsoTime; read: boolean };
/**
 * 4G1. digest: the newest daily digest, for the centre only: its line, the items it listed for the first time, how many
 * earlier ones still wait, and the sum receipts behind its money figures. Null before the first digest.
 */
export interface NotifyListView { items: NotificationView[]; unread: number; digest: NotifyDigestView | null }
export interface NotifyDigestView { id: string; day: IsoDate; at: IsoTime; line: Display; items: NotificationView[]; stillWaiting: number; receiptIds: string[] }
/** 4G1. keepsRunning: what keeps going while the app is closed, from records. */
export interface NotifySettingsView {
  pausedUntil: IsoTime | null; quietHours: { from: string; to: string } | null; digest: { hour: number } | null;
  push: boolean; tray: boolean; keepsRunning: Display[]; line: Display;
}
/** 4G3. A browser PushSubscription as JSON. */
export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: number | null };
export interface PushKeyView { publicKey: string }
export interface PushStateView { subscribed: boolean; line: Display }
export interface RelayView { relay: Display | null; line: Display }

/** 4H1. Never signedIn 'yes' without evidence; state stays 'unverified' until one real task succeeded. */
export type CliStatusView = {
  cli: DelegateCli; label: Display; found: boolean; path: string | null; version: string | null;
  flags: 'match' | 'mismatch' | 'unknown'; missingFlags: string[]; signedIn: 'yes' | 'no' | 'unknown';
  terms: 'accepted' | 'pending' | 'not-needed'; lastTask: { at: IsoTime; outcome: 'succeeded' | 'failed' } | null;
  state: ModelAvailability; line: Display; fix: Display | null;
};
export interface CliStatusList { clis: CliStatusView[]; line: Display }
/** 4H1. The tiers each agent's steps use and the preset that serves each; the team runs as one agent. */
export type RoleModelView = { agent: string; name: string; tiers: { tier: ModelTier; presetId: ModelPresetId; model: string | null; price: Display; usable: boolean }[] };
export interface RoleModelsView { roles: RoleModelView[]; line: Display }

/** 4I1. The waiting Today row with the most money at stake, then the nearest deadline; goalAfter is code ("Goal after: 92%"). */
export interface NextBestStep {
  rowId: string; title: Display; agent: string | null; line: Display; figure: MoneyFigureView | null; goalAfter: Display | null;
  /** 4I2: the goal's whole percent once this is done, for the screen to word; null with goalAfter. */
  goalAfterPercent: number | null;
}
/** 4I1. A sum on the goal card: receiptId null when nothing was added up (a zero with nothing to prove, and no receipt written). */
export type GoalFigureView = { display: Display; receiptId: string | null };
/**
 * 4I1. Money invoiced this month toward the goal, before tax. Permilles are BigInt floors; unset shows last month and no
 * suggestion. elapsedDays counts today as gone; lastDay is true on the month's last day (say "Last day", not "0 days left").
 */
export interface GoalView {
  month: string;
  state: 'set' | 'unset';
  goal: MoneyFigureView | null;
  invoiced: GoalFigureView;
  ready: GoalFigureView;
  stillToInvoice: MoneyFigureView | null;
  receivedSoFar: GoalFigureView;
  invoicedPermille: number | null;
  readyPermille: number | null;
  pacePermille: number;
  pace: 'ahead' | 'behind' | null;
  paceReceiptId: string | null;
  /** 4I2: whole percents for the screen to word (floored; invoicedPercent may pass 100, the bar's permille never does). */
  invoicedPercent: number | null;
  pacePercent: number;
  /** 4I2: past the goal (more invoiced than the goal), and by how much, with the goal's receipt; else false and null. */
  past: boolean;
  pastBy: MoneyFigureView | null;
  /** 4I2: how far ahead of or behind today's pace (see pace), with the pace receipt; null when there is no pace. */
  paceBy: MoneyFigureView | null;
  elapsedDays: number;
  monthDays: number;
  daysLeft: number;
  lastDay: boolean;
  lastMonth: GoalFigureView | null;
  line: Display;
  next: NextBestStep | null;
  briefing: { rowIds: string[]; more: number } | null;
}
/** 4I1. A goal the owner's AI suggested from the plan's offers and prices only: a model estimate. */
/** 4I2: typed is the amount as the owner would type it in the goal field ("150000.00"), read back by goals.set. */
export interface GoalSuggestion { amountMinor: MinorString; display: Display; estimate: true; line: Display; typed: string }

/** 4J1. */
/**
 * by: the member who decided (the owner or a cofounder), null for a saved rule or a timeout. ruleId: the saved rule's
 * record (a team gate, an allow for this session), with rule its words; both null when no rule decided.
 */
export type DecisionView = {
  id: string; at: IsoTime; subject: string; action: string; who: 'owner' | 'saved-rule' | 'timeout';
  rule: Display | null; ruleId: string | null; reason: Display; line: Display; by: string | null;
  /** 4J19: the agent whose step a saved rule or a gate is about (venture.team.gate takes it), else null. */
  agentId: string | null;
};
export interface DecisionsView { decisions: DecisionView[] }
export interface AllowSessionView { stepId: string; line: Display }

/** 4J2. */
export interface QueueSetResult { decisions: QueueDecision[]; line: Display; receiptId?: string }
/**
 * 4J2 review: a set as the server works it out before the owner approves it: the digest venture.queue.set takes, each
 * picked row with what approving it can cost, the total with its sum receipt, whether the set asks twice (any item
 * does), and why any item can't go in a set (the set is refused while any is listed).
 */
export interface QueueSetPreview {
  digest: string;
  items: { rowId: string; title: Display; kind: QueueKind; cost: Display }[];
  total: { display: Display; receiptId: string };
  secondAsk: boolean;
  refusals: { rowId: string; reason: string; line: Display }[];
}
export interface QueueUndoResult { restored: boolean; line: Display }
export interface TriagePreview { rule: TriageRule | null; choices: TriageRule[]; rows: QueueRow[]; digest: string; by: 'model' | 'choices' }
export interface TriageRuleView { rule: TriageRule; line: Display }
/** 4J2. One paragraph change between the accepted text and an agent's later edit. */
export type DraftChangeView = { id: string; paragraph: number; before: string; after: string; by: 'owner' | 'agent'; status: 'open' | 'taken' | 'dropped' };
/**
 * line: "You edited this. The agent's new version is beside yours." when the owner had their own version, else how the
 * agent's revision was merged; replacement: offered when the owner's version is stale beside the agent's new one.
 */
export interface DraftChangesView {
  changes: DraftChangeView[]; line?: Display;
  replacement?: { id: 'replacement'; status: 'open' | 'confirmed' | 'kept'; review: Display; confirm: Display; confirmLine: Display; keep: Display };
}
export type SettingsDraftView = { form: string; values: Json; at: IsoTime };
export interface SettingsDraftsView { drafts: SettingsDraftView[] }
export interface SettingsDraftSaved { form: string; at: IsoTime; line: Display }

/**
 * 4J4 (M13). How a money figure was made: reported (read from a file, with its row), calculated (code added it up, with
 * its receipt), assumption (an input taken as given, shown beside each result that uses it) or estimate (a model's,
 * always "model estimate" and never a receipt). source says where it came from in the same four ways.
 */
export type FigureKind = 'reported' | 'calculated' | 'assumption' | 'estimate';
export type FigureSource =
  | { from: 'file'; recordId: string; row: string; line: Display }
  | { from: 'receipt'; receiptId: string }
  | { from: 'input'; line: Display }
  | { from: 'model' };
/** 4J4 (M14). How a total was made: what it counted, whether it stopped short, and what it left out and why ("2 not counted: no rate"). */
export type TotalBasis = { filters: Display[]; truncated: boolean; notCounted: { count: number; line: Display } | null };
/**
 * 4J4. A money figure with its kind and source (M13) and the sum receipt that proves it. uses: the assumptions it rests
 * on, in words, to show beside it; projected: a forecast, never what happened; estimate: its receipt holds amounts not
 * known yet (calls still running at their estimate, or a forecast); basis: how a total was made (M14).
 */
export type KindedFigure = MoneyFigureView & { kind: FigureKind; source: FigureSource; uses?: Display[]; projected?: true; estimate?: true; basis?: TotalBasis };

/** 4J4. countLine: "1 invoice", "None". permille: of the total, floored, at least 1 for a bucket that holds anything. */
export type AgingBucketId = 'not-due' | '1-30' | '31-60' | '61-90' | 'over-90';
export type AgingBucketView = { id: AgingBucketId; label: Display; count: number; countLine: Display; amount: KindedFigure; permille: number };
/** One open invoice in the aging, oldest due first: late is null while it is not due yet. */
export type AgingInvoiceView = {
  invoiceId: string; number: string; client: string; dueDate: IsoDate; bucket: AgingBucketId; late: { days: number; line: Display } | null; balance: KindedFigure;
};
export interface AgingView {
  asOf: IsoDate;
  buckets: AgingBucketView[];
  total: KindedFigure;
  invoices: AgingInvoiceView[];
  line: Display;
  /** 4J20: what the late ones owe, with its own receipt (their aging sum); null when none is late. */
  late: KindedFigure | null;
}
/**
 * 4J4. A side with nothing recorded is null, never zero; left is null only when both are. receiptId: the left figure's.
 * note: "AI spend not counted: no rupee rate set" when the month had AI spend Chausar could not count in rupees.
 */
export type FlowMonthView = {
  month: string; label: Display; in: KindedFigure | null; out: KindedFigure | null; left: KindedFigure | null;
  inPermille: number | null; outPermille: number | null; receiptId: string | null; note: Display | null;
};
export interface FlowView { months: FlowMonthView[]; line: Display; basis: TotalBasis }
/** 4J4. Point 0 is today (what is in the bank now, actual); points 1 to 13 are the weeks ahead (projected). */
export type CashPointView = {
  week: IsoDate; label: Display; actual: KindedFigure | null; forecast: KindedFigure | null; actualPermille: number | null; forecastPermille: number | null;
};
/** 4J4. Money due in or out in the next three weeks, by date; the receipt is its week's, which names it. */
export type CashItemView = { on: IsoDate; line: Display; direction: 'in' | 'out'; amount: KindedFigure };
/** 4J20: a draft issued today: due on its terms from today, in that week, its total as priced. */
export type CashIssueView = { invoiceId: string; client: string; due: IsoDate; week: IsoDate; amount: KindedFigure };
export type CashLowest = KindedFigure & { week: IsoDate; line: Display };
export interface CashView {
  bank: (KindedFigure & { on: IsoDate }) | null;
  /** What is in the bank now: the statement's balance and what was recorded since it. */
  opening: KindedFigure | null;
  points: CashPointView[];
  /** 4Z2: each only when its lowest week falls below today's cash (opening); null when cash stays at or above it. */
  lowest: { onTime: CashLowest | null; ifLateNeverPay: CashLowest | null };
  /** The weekly usual costs the forecast takes as given (an assumption), with the receipt of the first week that uses it. */
  usualCosts: KindedFigure | null;
  assumptions: Display[];
  nextWeeks: CashItemView[];
  /** 4J20: each draft invoice issued today, the week its money is due in and its total, proved by its price receipt. */
  ifIssued: CashIssueView[];
  /** Level lines with their labels, per mille of the chart's scale (zero, when the scale goes below it). */
  ticks: { permille: number; label: Display }[];
  /** What the forecast counted and what it left out (another currency, no due date). */
  basis: TotalBasis;
  line: Display;
}
export type MarginRowView = { clientId: string; client: string; invoiced: KindedFigure; spend: KindedFigure | null; margin: KindedFigure | null; note: Display | null };
export interface MarginsView { month: string; rows: MarginRowView[]; line: Display; basis: TotalBasis }
/** 4J4. The month's CSV for the owner's CA; cells that could run as a formula are prefixed. */
export interface MoneyExportFile { fileName: string; csv: string; rows: number; line: Display; receipts?: SignedReceiptsFile }
/**
 * 4J10: the business's signed receipts with their signatures and the public halves of its keys, which the CA's export
 * carries and node scripts/verify-receipts.mjs checks offline. Never a private half.
 */
export type SignedReceiptsFile = {
  format: 'chausar-signed-receipts/1'; business: string; algorithm: 'ed25519'; publicKey: string | null; keys: { id: string; publicKey: string }[];
  receipts: { id: string; kind: ReceiptSignatureRecord['receiptKind']; receipt: unknown; signature: string; signedAt: IsoTime; publicKey: string }[];
};

/** 4J5. */
export type BillView = {
  id: string; vendor: string; billDate: IsoDate; dueDate: IsoDate; total: Display; paid: Display; balance: Display;
  state: 'draft' | 'posted' | 'partial' | 'paid' | 'overdue'; recurring: 'monthly' | 'quarterly' | null;
  /** 4J20 (bills.list): the receipt of this bill's balance (its lines and tax less what was paid). */
  receiptId?: string;
};
/** owed: what open bills add up to, with its receipt; null when nothing is owed. */
export interface BillsView { bills: BillView[]; owed?: MoneyFigureView | null }
export interface BillResult { bill: BillView; receiptId?: string }
export type CreditNoteView = { id: string; invoiceId: string; amount: Display; reason: string; state: 'waiting' | 'issued' | 'cancelled'; number: string | null; rowId: string | null; line: Display;
  /** 4J20: the receipt that names the note's amount (the invoice's balance with it), while waiting or issued; null once cancelled. */
  receiptId: string | null };
export type RecurringInvoiceView = { id: string; clientId: string; offerId: string; frequency: 'monthly' | 'quarterly'; startOn: IsoDate; end: IsoDate | null; nextOn: IsoDate | null; line: Display };
export interface RecurringInvoicesView { items: RecurringInvoiceView[] }

/** 4J6. A business that opens with a passphrase shows nothing until opened; others show their snapshot "as of" when last opened. */
export type BusinessSnapshotView = { businessId: string; name: string; open: boolean; locked: boolean; asOf: IsoTime | null; line: Display; lineKey: AcrossLineKey };
/**
 * 4J6. What a row's line says, so a screen can word it in Hindi: open now, no country yet, as of asOf (and still being
 * set up then), locked with a passphrase, the key missing on this computer, unreadable, or nothing saved yet.
 */
export type AcrossLineKey = 'open' | 'no-country' | 'as-of' | 'as-of-setting-up' | 'locked' | 'key-missing' | 'unreadable' | 'none';
/** 4J6. One business a total or count left out, and why (month: the month its summary was saved in, for other-month). */
export type AcrossLeftOut = { businessId: string; name: string; why: 'locked' | 'key-missing' | 'unreadable' | 'none' | 'setting-up' | 'other-month'; month: string | null };
/**
 * 4J6. receipts: a receipt in the open business for each figure shown (the open business's own sums; for another
 * business, a receipt that says what its snapshot saved and when). Its own receipts open only after switching to it.
 * total: what was invoiced in `month` before tax across the businesses it could count, only when they share one
 * currency (added in BigInt from the minor amounts); line says which were left out and why. lineKey, counted,
 * currencies and notCounted say the same in parts, so a screen can word it in Hindi.
 */
export interface AcrossMoneyView {
  /** spendRupees, spendRate (4J20): the spend in rupees at the owner's own rate, and that rate in words; absent without one. */
  businesses: (BusinessSnapshotView & { invoiced: Display | null; received: Display | null; owed: Display | null; late: number | null; spend: Display | null; spendRupees?: Display; spendRate?: Display; spendLead?: SpendLead; receipts?: Partial<Record<AcrossFigureId, string>> })[];
  total: MoneyFigureView | null;
  line: Display;
  lineKey: 'counted' | 'currencies' | 'nothing'; month: string; counted: number; currencies: string[]; notCounted: AcrossLeftOut[];
}
export interface AcrossRunsView {
  businesses: (BusinessSnapshotView & { working: number | null; waiting: number | null; stopped: number | null; needsYou: number | null })[];
  line: Display;
  /** The sums the line states, and the businesses it left out (4J6), so a screen can word it in Hindi. */
  totals: { working: number; waiting: number; stopped: number; needsYou: number; businesses: number }; notCounted: AcrossLeftOut[];
}

/** 4J7. */
export type ConnectorCheckRow = { connectorId: string; name: string; outcome: 'answered' | 'failed' | 'skipped'; line: Display; account: string | null; expiresOn: IsoDate | null; fix: Display | null };
export interface ConnectorChecksView { at: IsoTime; rows: ConnectorCheckRow[]; health: { ready: number; warnings: number; blocking: number } }
export interface FileRequestView { id: string; orderId: string; url: string | null; reason?: Display; expiresAt: IsoTime; line: Display }

/**
 * 4J8. One way to earn per registered playbook that runs today (playbooks/ways.ts). The hours and what clients usually
 * pay are a model's, so both are labelled a model estimate with their basis (clientsPay.source), never a receipt or a
 * promise. department: the playbook's own (its service type's, 4A1), for the icon tint. team: the playbook's agents
 * only (code is never shown as AI), with their departments. starter: a sentence a tile's Start puts in the one-sentence
 * box (never sent by itself); it picks this playbook. yours: the businesses of this kind the host named (the open one;
 * 4J6 adds the others), never from a payload. hi: the same words in Hindi, machine-drafted for a native reviewer.
 */
export type WayCategory = 'content' | 'marketing' | 'money-and-tax' | 'shops-and-firms';
/** needs: what the way needs in plain words, besides the owner's time (hours): the owner's own AI, and the connections that work today. */
export type WayNeeds = { ai: Display; connections: Display };
export type WayWords = {
  label: Display; line: Display; hours: Display; youDo: Display; team: Display[]; teamLine: Display;
  pay: Display; per: Display; source: Display; starter: Display; needs: WayNeeds;
};
export type WayView = {
  id: string; playbook: string; label: Display; category: WayCategory; department: DepartmentId; line: Display;
  hours: Display; minHours: number; maxHours: number; hoursEstimate: true; youDo: Display;
  team: { role: string; initials: string; department: DepartmentId }[]; teamLine: Display;
  clientsPay: { text: Display; per: Display; estimate: true; source: Display };
  needs: WayNeeds;
  starter: Display;
  yours: { businessId: string; name: string }[];
  hi: WayWords;
};
/** categories: only those with a way, with counts; upTo: the "Up to 5 h a week" filter (maxHours at most 5) and its count. */
export interface WaysView {
  ways: WayView[];
  categories: { id: WayCategory; label: Display; hi: Display; count: number }[];
  upTo: { maxHours: number; label: Display; hi: Display; count: number };
}
/**
 * 4J8. One change a plan suggestion makes, in plain words: before and after (empty before for an offer added).
 * estimate is always false: a suggestion's words never hold a number or a price, so nothing in them is an estimate.
 */
export type PlanChangeView = {
  field: 'oneLiner' | 'customer' | 'offer-name' | 'offer-description' | 'offer-added'; offerId: string | null;
  before: Display; after: Display; line: Display; estimate: boolean;
};
/**
 * 4J8. "Add this to {business}": the open business's own AI suggests how the plan's words change, and at most one new
 * offer, to take in the owner's sentence (and a dropped file, as background only). patch: exactly what
 * venture.blueprint.update takes, or null when nothing changes; the owner applies it there with basedOn (their own
 * action; a plan changed since is refused as stale), then accepts the plan as today. Never a price: a new offer starts
 * with none (left says so). Nothing is stored but the call's own record.
 */
export interface PlanSuggestionView {
  basedOn: { blueprintId: string; digest: string };
  patch: BlueprintPatch | null;
  changes: PlanChangeView[];
  attachment?: ComposeAttachmentNote;
  left: Display;
  line: Display;
  callId: string | null;
}

/** 4J9. kept: only on the answer that removed a stored name, Forget's backups line (earlier backups still hold it). */
export interface OwnerView { firstName: string | null; excludedServices: string[]; businessName: string; kept?: Display[] }

/** 4J10. reason (4J22a): only 'changed' and 'unsigned-since' are mismatches; the others are not confirmed. */
export type ReceiptVerifyReason = 'signed' | 'changed' | 'unsigned-since' | 'unsigned-old' | 'no-key' | 'key-gone';
export interface ReceiptVerifyView { id: string; valid: boolean; label: 'reproduction_ready' | 'incomplete' | 'signature_only'; reason: ReceiptVerifyReason; line: Display }
/** digest: what the owner saw (the first bad entry and the newest), sent back to accept exactly this break. */
export interface JournalChainView { state: 'ok' | 'corrupt'; entries: number; firstBadSeq: number | null; line: Display; digest: string }

/**
 * 4J12. The newest revision: proposedBy who wrote it (an agent may change only scope and checks), items each
 * deliverable's and check's state from its newest mark, with the evidence or reason.
 */
export interface OrderContractView {
  orderId: string; contract: OrderContract; revision: number; digest: string; signed: { at: IsoTime; by: string } | null; line: Display;
  proposedBy?: 'owner' | 'agent';
  items?: OrderContractItem[];
}
export type OrderContractItem = { id: string; kind: 'deliverable' | 'check'; state: 'open' | 'done' | 'skipped'; evidence: Display | null; reason: Display | null };

/** 4J13. when: the schedule in words with its time zone. prompt (4J22a): sent back to turn it off, on or change it; only
 * for a role that may change routines (owner, cofounder). */
export type RoutineView = { id: string; name: string; agent: string | null; prompt?: string; schedule: RoutineSchedule; when: Display; on: boolean; next: IsoTime | null; line: Display };
export interface RoutinesView { routines: RoutineView[] }
export type RoutineRunView = { id: string; dueAt: IsoTime; state: RoutineRunState; line: Display };
export interface RoutineRunsView { runs: RoutineRunView[] }
export type RoutineInput = { id?: string; name: string; agent?: string | null; prompt: string; schedule: RoutineSchedule; on: boolean };

/** 4J14. Options already scored, reordered by the owner's weights in code; a model figure is an estimate only. */
export type RankedOptionView = { id: string; label: Display; text: Display; score: number; estimate: Display | null; failed: boolean };
export interface RerankView { options: RankedOptionView[] }

/** 4J15. */
export type DrillRunView = { id: string; at: IsoTime; playbookHash: string; version: number | null; passed: boolean; results: { drill: Display; stopped: boolean; twinPassed: boolean; line: Display }[] };
export interface DrillRunsView { runs: DrillRunView[] }
/** 4J15. Even with every item met, auto with spot checks stays locked. */
export interface AutoReadinessView { agent: string; items: { id: string; label: Display; met: boolean; line: Display }[]; locked: true; line: Display }
/** 4J15. A dash where a figure is unknown (null). */
export interface ShadowSummaryView { agent: string; wouldHaveGone: number | null; held: number | null; changed: number | null; offers: Display[]; line: Display }

/** 4J16. Each guidance line with the check that can see it. */
export type GuidanceLineView = { stepId: string; text: string; check: string | null; state: 'measured' | 'dark' | 'unmeasured' };
/**
 * 4J16 (Q15): a part of the drafts the owner corrected in at least 60 percent of at least 3 reviews. It changes nothing:
 * the owner says the rule in that agent's chat (starter prefills it and is never sent), as a 4B1 proposal.
 */
export type FixTheRuleView = { field: string; stepId: string | null; agent: string | null; corrected: number; reviews: number; line: string; starter: string };
export interface GuidanceView { lines: GuidanceLineView[]; fixTheRule?: FixTheRuleView[] }

/**
 * 4J17. version: the one in use for that language and channel; undo: the voice to set to go back to the version before
 * (null at the first). draft: what venture.voice.learn worked out, unsaved until the owner sets it, with its check line.
 */
export type VoiceView = {
  voices: { language: 'en' | 'hi'; channel: string | null; on: boolean; sections: VoiceSections; validated: boolean; version?: number; undo?: VoiceInput | null }[];
  line: Display;
  draft?: { language: 'en' | 'hi'; channel: string | null; sections: VoiceSections; validated: boolean; learnedFrom: number; lines: string[]; line: Display } | null;
};
export type VoiceInput = { language: 'en' | 'hi'; channel?: string | null; on: boolean; sections: VoiceSections };
/** 4J17. An agent's skills with a "try this" starter that prefills and never sends. */
export type AgentSkillView = { name: Display; line: Display; starter: string };
/** 4J17. version: the persona in use (0 before any is set); undo: the persona to set to go back one version (null at the first). */
export interface PersonaView { agent: string; persona: PersonaFields; skills: AgentSkillView[]; line: Display; version?: number; undo?: PersonaFields | null }
export interface PersonaTestView { results: { scenario: Display; reply: string }[]; cost: Display; line: Display }
/** 4J17. An agent's steps, persona and standing orders, without notes. */
export interface AgentExportFile { fileName: string; text: string }

/** 4J18. */
export type KnowledgeSourceInput =
  | { kind: 'text'; title: string; text: string }
  | { kind: 'link'; url: string }
  | { kind: 'file'; uploadId: string }
  | { kind: 'past-work'; runId: string };
export type KnowledgeSourceView = { id: string; kind: KnowledgeRecord['sourceKind']; title: string; at: IsoTime; line: Display };
/**
 * requests: "To answer 6 questions from October 2026 well, add files about refunds and delivery times", one a month.
 * line: who reads the sources, in honest words: each act and writing turn carries the ones that share words with its
 * order, screened again as read (agents/knowledge-recall.ts).
 */
export interface KnowledgeView { sources: KnowledgeSourceView[]; requests: Display[]; line: Display }
export interface KnowledgeTestView { hits: { sourceId: string; title: string; line: Display }[]; line: Display }
export type IdeaView = { id: string; title: Display; reason: Display; evidence: { id: string; line: Display }[]; prompt: string };
/** 4J18. Who is waiting on the owner: real records only. */
export type WaitingOnYouView = { id: string; recordId: string; line: Display };
/** pipeline (Ink v2 wave 5, 5A3): the ideas the owner and the agents added, newest first, on the same records. */
export interface IdeasView { ideas: IdeaView[]; waiting: WaitingOnYouView[]; pipeline: PipelineIdeaView[] }
export interface IdeaStarted { proposal: ProposalView | null; suggestion: AgentSuggestion | null; line: Display }
/**
 * 4J18. One line of the capability page: its list, what it is about (key: tool:<name>, step:<id>, input:<kind>,
 * outbox:<connector>, model:provider, effect:<kind>, host:<name>, cli:<name>, or nothing), and its honest state, so a
 * screen can word it in Hindi. 'records': Chausar only records it for the owner (an outbox proposal).
 */
export type CapabilityItemView = { list: 'see' | 'do' | 'off'; key: string; state: 'works' | 'reads' | 'records' | 'hands-off' | 'planned' | 'off'; line: Display };
/**
 * 4J18. What an agent can see, can do, and "if it is off here, it can't do it"; an empty list never means everything.
 * canSee, canDo and off are the lines of items, list by list.
 */
export interface CapabilityPageView { agent: string; canSee: Display[]; canDo: Display[]; off: Display[]; items: CapabilityItemView[]; line: Display }

/** A business on this computer as the views see it. id is its workspace folder, the id workspace.list uses. */
export type VentureBusinessRef ={ id: string; name: string | null; opens: 'with-this-computer' | 'needs-passphrase' | 'key-missing'; openedAt: string | null };
/**
 * Trusted host composition, never from a payload: what the views may know about the businesses on this computer.
 * The engine passes it; tests inject a stub. Without it the queue covers the open business only.
 */
export type VentureWorkspacePort = {
  /** The open business. */
  current(): { id: string; name: string };
  /** Every business on this computer, the open one included. Empty on the hosted web server. */
  businesses(): Promise<VentureBusinessRef[]>;
  /** Whether the open business has a recovery code; null when this host keeps no such record. */
  recovery(): Promise<'made' | 'not-made' | 'unknown' | null>;
  /**
   * Ink v2 wave 4 (4A1, Keeper's backups job): whether automatic backups are on, and the automatic backups only (a copy
   * the owner made by hand or a safety copy is not Keeper's run): how many, the newest, when the next is due, and the
   * schedule's last error. null where this host keeps none (the hosted web server, a computer without custody).
   */
  backups?(): Promise<{ auto: boolean; count: number; newestAt: IsoTime | null; nextDueAt: IsoTime | null; lastError: string | null } | null>;
  /**
   * Ink v2 wave 4 (4J6): what Chausar saved about each other business on this computer when it was last open, the open
   * one left out. A business that opens with a passphrase (or whose key this computer lost) is never read: `locked`. A
   * saved file that is tampered with, from another computer, or for another vault is `unreadable`. Empty on hosted.
   */
  snapshots?(): Promise<BusinessSnapshotRead[]>;
  /**
   * 4J6 (C10): the never-contact list the businesses on this computer share, as keyed one-way checks only. has: whether
   * any of these addresses (an email, a phone in E.164, a LinkedIn profile address) is on it; it throws TIER_UNAVAILABLE
   * when the list holds checks and this computer's key does not answer. add: puts them on it for good. Absent on hosted.
   */
  neverContact?: { has(values: readonly string[]): Promise<boolean>; add(values: readonly string[]): Promise<void> };
};
/** 4J6. One figure a snapshot keeps: the amount in minor units (micro-dollars for AI spend), as shown, and its receipt in its own business. */
export type SnapshotFigure = { amount: string; unit: 'minor' | 'micros'; currency: string; display: Display; receiptId: string };
/**
 * 4J6. The minimum another business may know about one that is closed: its name, the playbook its idea picks, when this
 * was taken, money (this month's invoiced and received on its own calendar month `month`, owed and late as of then, AI
 * spend this UTC month) and counts of runs and of what needs the owner. Never a client's name, a title, a message or a
 * file. money is null for a business still in its interview (no country yet).
 */
export type BusinessSnapshot = {
  format: 'chausar.snapshot.v1'; businessId: string; vaultId: string; name: string; playbook: string | null; asOf: IsoTime;
  money: { month: string; currency: string; invoiced: SnapshotFigure; received: SnapshotFigure; owed: SnapshotFigure; late: number; spend: SnapshotFigure } | null;
  runs: { working: number; waiting: number; stopped: number }; needsYou: number;
};
/** 4J6. Another business as its snapshot reads: none saved yet, locked (never read), unreadable, or the snapshot. */
export type BusinessSnapshotRead = VentureBusinessRef & { read: 'saved' | 'none' | 'locked' | 'unreadable'; snapshot: BusinessSnapshot | null };

// ---------------------------------------------------------------------------
// 9f. Ink v2 wave 5 (named by package 5-0). Each record is RecordBase<kind> & Body, Body from the owning package's
// records file (a placeholder there until the package lands). The new shared types: Department is wave 4's DepartmentId;
// StartTile and IntakeValue are 5A1's (playbooks/kit/define.ts); SharePrice is 5A2's (playbooks/kit/records-sales.ts).
// ---------------------------------------------------------------------------

export type Department = DepartmentId;
export type { IntakeValue, SharePrice, StartTile };
// The kit (5A2, 5A4, 5A5, 5A6)
export type GoNoGoRecord = RecordBase<'venture-go-no-go'> & GoNoGoBody;
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
export type TestFindingRecord = RecordBase<'venture-test-finding'> & TestFindingBody;
export type DevPermissionRecord = RecordBase<'venture-dev-permission'> & DevPermissionBody;
export type WatchSourceRecord = RecordBase<'venture-watch-source'> & WatchSourceBody;
export type CallLogRecord = RecordBase<'venture-call-log'> & CallLogBody;

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
  | JudgeSettingRecord
  | TranscriptionSetupRecord
  // Ink v2 wave 4 (section 9e)
  | KeeperRunRecord | HealthClearRecord
  | AgentMessageRecord | AgentProposalRecord | ChatConsentRecord
  | AgentNoteRecord | AgentNoteChangeRecord
  | ChiefThreadRecord | ChiefMessageRecord | ProposalRecord
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
  | CaCitationsRecord | CaDifferentialRecord | CaDataPackRecord
  | SocialInboxItemRecord | AdLedgerEntryRecord | InfluencerCaseRecord
  | SeoPanelRecord | SeoObservationRecord | SeoFindingRecord
  | SellerSkuRecord | SellerFeecardRecord | SellerStageRecord | SellerMovementRecord | SellerCaseRecord
  | SupportTicketRecord | SupportMessageRecord | SupportRequestRecord | SupportRatingRecord
  | RecruitRoleRecord | RecruitCandidateRecord | RecruitTouchRecord | RecruitInterviewRecord
  | CareerFactRecord | CareerListingRecord | CareerThreadRecord
  | TranslationJobRecord | TranslationSegmentRecord | GlossaryRecord
  | PromiseToPayRecord | CollectionStageRecord | BooksPostingRecord
  | ArticleLedgerRecord | LeadSourceRecord | NewsletterIssueRecord | NewsletterContactRecord | TenderQuestionRecord
  | SiteRequirementRecord | SiteReleaseRecord | NarrationSegmentRecord | RoomBriefRecord | EntryRecordRecord
  | TestFindingRecord | DevPermissionRecord | WatchSourceRecord | CallLogRecord;
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

// ---------------------------------------------------------------------------
// 10. RPC methods: names, owners, payloads, results
// ---------------------------------------------------------------------------

/**
 * Ink v2 wave 4's methods, by package (named by package 4-0; each answers NOT_BUILT_YET until its package lands). They
 * are part of VENTURE_METHODS; listed apart so W4_METHOD_LEVELS can be typed complete.
 */
export const W4_METHODS = [
  // 4A1 departments, Keeper and agent health (views)
  'venture.team.keeper', 'venture.team.clearQuarantine',
  // 4B1 agent threads, "from now on" proposals, versions, standing orders and the chat consent (agents)
  'venture.agents.thread.list', 'venture.agents.thread.send', 'venture.agents.proposal.decide', 'venture.agents.version.undo',
  'venture.agents.orders.list', 'venture.chats.consent',
  // 4B2 notes (agents)
  'venture.agents.notes.list', 'venture.agents.notes.edit', 'venture.agents.notes.forget', 'venture.agents.notes.undo',
  // 4C1 Chats with Chausar as chief of staff, and proposals (chief)
  'venture.chief.threads', 'venture.chief.thread.list', 'venture.chief.thread.send', 'venture.chief.thread.pin', 'venture.chief.fit',
  'venture.proposals.raise', 'venture.proposals.dismiss',
  // 4D1 the owner's network: import, people, merge, privacy (network)
  'venture.network.import', 'venture.network.importUndo', 'venture.network.merge', 'venture.network.split', 'venture.network.forget',
  'venture.network.hide', 'venture.network.people', 'venture.network.person', 'venture.network.sources',
  // 4D2 strength and warm paths, 4D3 search (network)
  'venture.network.recompute', 'venture.network.know', 'venture.network.link',
  'venture.network.search', 'venture.network.searchMore', 'venture.network.saveSearch', 'venture.network.research',
  // 4E1 the pipeline and follow-ups, 4E2 drafts and handoffs (network)
  'venture.pipeline.list', 'venture.pipeline.followups', 'venture.pipeline.add', 'venture.pipeline.setNext', 'venture.pipeline.move', 'venture.pipeline.settings',
  'venture.outreach.draft', 'venture.outreach.open', 'venture.outreach.sent', 'venture.outreach.restricted',
  // 4E3 the read-only mailbox, inbound mail, the calendar address and "after a call" (network)
  'venture.mailbox.connect', 'venture.mailbox.disconnect', 'venture.mailbox.sync', 'venture.inbound.list', 'venture.inbound.confirm',
  'venture.network.calendar', 'venture.meeting.digest',
  // 4F1 run controls, pause all and Away; 4F2 the write caps (views)
  'venture.runs.stop', 'venture.runs.resume', 'venture.runs.roundGate', 'venture.runs.steer', 'venture.business.pause', 'venture.away.set', 'venture.away.get',
  'venture.runs.allowWrites',
  // 4G1 the notification centre, 4G3 web push and the relay (notify)
  'venture.notify.list', 'venture.notify.read', 'venture.notify.settings',
  'venture.notify.push.key', 'venture.notify.push.subscribe', 'venture.notify.push.unsubscribe', 'venture.notify.relay',
  // 4H1 the CLI status and per-role models (models)
  'venture.models.cli.status', 'venture.models.roles',
  // 4I1 goals (money)
  'venture.goals.get', 'venture.goals.set', 'venture.goals.suggest',
  // 4J1 decisions and allow-for-this-session (views)
  'venture.decisions.list', 'venture.policy.allowSession',
  // 4J2 send back, edit and undo, set approval, the triage rule (views); draft fixes and changes (delivery); settings drafts (core)
  'venture.queue.sendBack', 'venture.queue.edit', 'venture.queue.undo', 'venture.queue.set', 'venture.triage.set', 'venture.triage.preview',
  'venture.delivery.fix', 'venture.delivery.decideChange', 'venture.delivery.changes', 'venture.settings.draft', 'venture.settings.drafts',
  // 4J2 review: a set's server-made quote before it is approved (views), an owner draft copied from one that went out (delivery)
  'venture.queue.setPreview', 'venture.delivery.copy',
  // 4J3 a still from the cut (delivery)
  'venture.files.poster',
  // 4J4 aging, in and out, cash, margins, the export for the CA (money)
  'venture.money.aging', 'venture.money.flow', 'venture.money.cash', 'venture.money.margins', 'venture.money.export',
  // 4J5 bills, credit notes, recurring invoices, reminders, clearing a payment (money)
  'venture.bills.add', 'venture.bills.pay', 'venture.bills.list', 'venture.credit.issue', 'venture.invoice.recurring', 'venture.invoice.recurringList',
  'venture.invoice.remind', 'venture.payment.clear', 'venture.bills.stop',
  // 4J6 money (money) and runs (views) across the businesses on this computer
  'venture.money.across', 'venture.runs.across',
  // 4J7 connection checks and the client's file request (build)
  'venture.connectors.check', 'venture.share.request',
  // 4J8 the ways to earn (core), answered before any vault; the plan change for an open business (core)
  'venture.playbooks.list', 'venture.blueprint.suggest',
  // 4J9 the owner profile (core)
  'venture.owner.get', 'venture.owner.set',
  // 4J10 signed receipts (money) and the chained journal (views)
  'venture.receipt.verify', 'venture.journal.chain', 'venture.journal.acceptBreak',
  // 4J12 order contracts (money)
  'venture.order.contract', 'venture.order.contract.propose', 'venture.order.contract.sign',
  // 4J13 routines (agents)
  'venture.routines.list', 'venture.routines.runs', 'venture.routines.set', 'venture.routines.remove',
  // 4J14 reranking scored options (delivery)
  'venture.options.rerank',
  // 4J15 drills (delivery); auto readiness and the shadow summary (views)
  'venture.drills.run', 'venture.drills.list', 'venture.auto.readiness', 'venture.shadow.summary',
  // 4J16 the guidance report (delivery)
  'venture.playbook.guidance',
  // 4J17 the business voice, personas, export and import (agents)
  'venture.voice.get', 'venture.voice.set', 'venture.voice.learn', 'venture.persona.get', 'venture.persona.set', 'venture.persona.test',
  'venture.agents.export', 'venture.agents.import',
  // 4J18 what the AI knows, ideas and the capability page (agents)
  'venture.knowledge.list', 'venture.knowledge.add', 'venture.knowledge.remove', 'venture.knowledge.test',
  'venture.ideas.list', 'venture.ideas.start', 'venture.ideas.dismiss', 'venture.agents.capabilities',
] as const;
export type W4Method = typeof W4_METHODS[number];

/**
 * Ink v2 wave 5's methods, by package (named by package 5-0; each answers NOT_BUILT_YET until its package lands). They
 * are part of VENTURE_METHODS; listed apart so W5_METHOD_LEVELS can be typed complete. Every one is owned by the
 * playbooks package (playbooks/index.ts) but 5A6's, owned by build (build/index.ts).
 */
export const W5_METHODS = [
  // 5A1 the chain of an order's stages, from a kit offer's stages
  'venture.order.chain',
  // 5A2 the sales proposal and the GO, HOLD or NO-GO card (5A2 added goNoGo.list, so Business lists the stored cards)
  'venture.salesProposal.draft', 'venture.salesProposal.get', 'venture.goNoGo.card', 'venture.goNoGo.list',
  // 5A3 the idea pipeline, beside 4J18's venture.ideas.list, .start and .dismiss
  'venture.ideas.add', 'venture.ideas.move', 'venture.ideas.grade',
  // 5A4 brand kits, asset records and voice consent
  'venture.brandKit.get', 'venture.brandKit.set', 'venture.assets.list', 'venture.assets.rerun', 'venture.assets.reuse',
  'venture.voiceConsent.record', 'venture.voiceConsent.revoke', 'venture.voiceConsent.list',
  // 5A5 client reports and their share links
  'venture.report.render', 'venture.report.share', 'venture.report.shareRotate', 'venture.report.shareDisable',
  // 5A5 added report.list, so reports and their live links stay findable after the screen closes
  'venture.report.list',
  // 5A6 monitors, mail import, the owner's local apps, the webhook handoff and speech providers (build)
  'venture.monitors.list', 'venture.monitors.add', 'venture.monitors.remove', 'venture.mail.import', 'venture.mail.threads',
  'venture.localApps.list', 'venture.webhook.set', 'venture.speechOut.providers',
  // 5C1 the citations table and the stored sign-off; 5C2 differential cases and the ITR data pack
  'venture.ca.confirmCitations', 'venture.ca.signoff.get', 'venture.ca.differential.add', 'venture.ca.dataPack.export',
  // Every business's own records, through its desk (playbooks/desks.ts and desk-types.ts)
  'venture.desk.list', 'venture.desk.get', 'venture.desk.act',
] as const;
export type W5Method = typeof W5_METHODS[number];

export const VENTURE_METHODS = [
  // P1 core (venture.countries and venture.preview are answered before a vault is open)
  'venture.countries', 'venture.preview', 'venture.create', 'venture.get', 'venture.events',
  'venture.interview.next', 'venture.interview.answer',
  'venture.blueprint.draft', 'venture.blueprint.get', 'venture.blueprint.update', 'venture.blueprint.accept',
  // P2 models
  'venture.models.presets', 'venture.models.connect', 'venture.models.disconnect', 'venture.models.status', 'venture.models.calls',
  // P3 money
  'venture.price.quote', 'venture.receipt.get',
  'venture.client.add', 'venture.client.list',
  'venture.order.create', 'venture.order.list', 'venture.order.deliver',
  'venture.invoice.prepare', 'venture.invoice.issue', 'venture.invoice.get', 'venture.invoice.list',
  'venture.payment.record', 'venture.books.summary',
  // P2-spend: what each paid call reserved and settled; the owner's monthly limit, ask-first figure and rate card
  'venture.spend.list', 'venture.spend.policy.get', 'venture.spend.policy.set',
  // P4 build and connectors
  'venture.build.brief', 'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.sync', 'venture.build.status',
  'venture.connectors.list',
  // P5 delivery, rehearsal, launch, capabilities
  'venture.delivery.playbook', 'venture.simulation.scenarios', 'venture.simulation.run', 'venture.simulation.get', 'venture.simulation.fromSignal',
  'venture.launch.status', 'venture.launch.advance',
  'venture.delivery.run', 'venture.delivery.approve', 'venture.delivery.review', 'venture.delivery.list',
  'venture.capabilities',
  // P5 delivery harness: client files, hand-off answers, work receipts, the gated improvement loop
  'venture.files.add', 'venture.files.list', 'venture.delivery.answer', 'venture.work.get',
  'venture.improve.status', 'venture.improve.run', 'venture.improve.get', 'venture.improve.adopt',
  // Heavy work: the owner approves or declines a brief for their own Claude Code or Codex, then reads what it left
  'venture.delivery.delegate', 'venture.delegate.get',
  // Ink frontend views (P1-A): Today's queue, runs, the team and its gates
  'venture.queue.list', 'venture.queue.decide', 'venture.runs.list', 'venture.runs.get', 'venture.team.list', 'venture.team.gate',
  // Evidence ledger (P2-evidence): what backs each client and business field, and the owner applying a suggestion
  'venture.evidence.list', 'venture.evidence.apply',
  // Action journal (P2-journal): every outside effect and where it stands; the owner settles an unknown outcome (W1, H3)
  'venture.journal.list', 'venture.journal.resolve',
  // The untrusted screen (W1 H9): the business's screen mode, and the owner releasing one held content
  'venture.untrusted.mode', 'venture.untrusted.release',
  // Connectors made real: bank statement import and consent, staged website edits, and leads the owner contacts himself
  'venture.bank.import', 'venture.bank.consent', 'venture.site.stage', 'venture.site.apply', 'venture.site.revert',
  'venture.leads.add', 'venture.leads.list', 'venture.leads.draft', 'venture.leads.recordSend',
  // Ink final pass: what a Today row is about, an agent's own posture, dismissing a suggestion, Money at a glance and the
  // tax working, the CA firm's CA of record and sign-offs, the lead blocklist, and read-only preview links for clients
  'venture.queue.view', 'venture.team.posture', 'venture.evidence.dismiss', 'venture.money.overview', 'venture.tax.working',
  'venture.ca.get', 'venture.ca.setOfRecord', 'venture.ca.recordSignoff', 'venture.ca.confirmRates',
  'venture.leads.block', 'venture.share.create', 'venture.share.list', 'venture.share.revoke',
  // Ink v2 wave 2: the judge on real orders, going back a playbook version, a transcript made on this computer, posting
  // from a checked draft, the client's answer the owner records, the calendar file, bank statements into the books and
  // their alerts, stored CA receipts and portal differences, and the dated platform rules
  'venture.delivery.judge', 'venture.delivery.judgeSend', 'venture.improve.rollback', 'venture.files.transcribe',
  'venture.posting.propose', 'venture.posting.signIn', 'venture.posting.checkSteps', 'venture.share.recordAnswer', 'venture.social.calendar',
  'venture.bank.ledger', 'venture.bank.apply', 'venture.bank.alerts.get', 'venture.bank.alerts.set',
  'venture.ca.receipt', 'venture.ca.explainDiff', 'venture.rules.list',
  // Ink v2 wave 2 (2C1): whether the judge runs on its own on drafts for a client or the public (judgeAuto)
  'venture.judge.auto.get', 'venture.judge.auto.set',
  // Ink v2 wave 2 (2B1): the owner's stricter posting limits per channel, tighten only
  'venture.posting.limits.get', 'venture.posting.limits.set',
  // Ink v2 wave 2 (2E2): the owner's whisper.cpp for transcripts made on this computer
  'venture.transcription.get', 'venture.transcription.set',
  // Ink v2 wave 4 (W4_METHODS above)
  ...W4_METHODS,
  // Ink v2 wave 5 (W5_METHODS above)
  ...W5_METHODS,
  // Onboarding v2: the draft desk, answered before the vault check (DRAFT_METHODS)
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.ai.calls',
  'venture.compose.decide', 'venture.compose.fill', 'venture.compose.get', 'venture.compose.update',
] as const;
export type VentureMethod = typeof VENTURE_METHODS[number];
/**
 * Answered without a vault, a model or any write. The engine routes them before its vault check. venture.playbooks.list
 * (Ink v2 wave 4, 4J8) is the Start gallery's list of ways to earn.
 */
export const PRE_VAULT_METHODS: readonly VentureMethod[] = Object.freeze(['venture.countries', 'venture.preview', 'venture.playbooks.list'] as const);
/**
 * Answered by the engine's draft desk before the vault check. They may call a model and write the in-memory draft
 * store, never the vault. The same nine as ONBOARDING_METHODS in onboarding-contracts.ts (a test pins them equal).
 */
export const DRAFT_METHODS: readonly VentureMethod[] = Object.freeze([
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.ai.calls',
  'venture.compose.decide', 'venture.compose.fill', 'venture.compose.get', 'venture.compose.update',
] as const);

/**
 * Ink v2 wave 4 adds agents (4B, 4J13, 4J17, 4J18), chief (4C), network (4D, 4E) and notify (4G). Wave 5 adds playbooks
 * (playbooks/index.ts): the kit's methods, the CA firm's new ones and every business's desk.
 */
export type VenturePackageId = 'core' | 'models' | 'money' | 'build' | 'delivery' | 'views' | 'agents' | 'chief' | 'network' | 'notify' | 'playbooks';
export const METHOD_OWNERS: Readonly<Record<VentureMethod, VenturePackageId>> = Object.freeze({
  'venture.countries': 'core', 'venture.preview': 'core', 'venture.create': 'core', 'venture.get': 'core', 'venture.events': 'core',
  'venture.interview.next': 'core', 'venture.interview.answer': 'core',
  'venture.blueprint.draft': 'core', 'venture.blueprint.get': 'core', 'venture.blueprint.update': 'core', 'venture.blueprint.accept': 'core',
  'venture.models.presets': 'models', 'venture.models.connect': 'models', 'venture.models.disconnect': 'models', 'venture.models.status': 'models', 'venture.models.calls': 'models',
  'venture.price.quote': 'money', 'venture.receipt.get': 'money', 'venture.client.add': 'money', 'venture.client.list': 'money',
  'venture.order.create': 'money', 'venture.order.list': 'money', 'venture.order.deliver': 'money',
  'venture.invoice.prepare': 'money', 'venture.invoice.issue': 'money', 'venture.invoice.get': 'money', 'venture.invoice.list': 'money',
  'venture.payment.record': 'money', 'venture.books.summary': 'money',
  'venture.spend.list': 'money', 'venture.spend.policy.get': 'money', 'venture.spend.policy.set': 'money',
  'venture.build.brief': 'build', 'venture.build.handoff': 'build', 'venture.build.handoffOpened': 'build', 'venture.build.link': 'build', 'venture.build.sync': 'build', 'venture.build.status': 'build',
  'venture.connectors.list': 'build',
  'venture.delivery.playbook': 'delivery', 'venture.simulation.scenarios': 'delivery', 'venture.simulation.run': 'delivery', 'venture.simulation.get': 'delivery', 'venture.simulation.fromSignal': 'delivery',
  'venture.launch.status': 'delivery', 'venture.launch.advance': 'delivery',
  'venture.delivery.run': 'delivery', 'venture.delivery.approve': 'delivery', 'venture.delivery.review': 'delivery', 'venture.delivery.list': 'delivery',
  'venture.capabilities': 'delivery',
  'venture.files.add': 'delivery', 'venture.files.list': 'delivery', 'venture.delivery.answer': 'delivery', 'venture.work.get': 'delivery',
  'venture.improve.status': 'delivery', 'venture.improve.run': 'delivery', 'venture.improve.get': 'delivery', 'venture.improve.adopt': 'delivery',
  'venture.delivery.delegate': 'delivery', 'venture.delegate.get': 'delivery',
  'venture.queue.list': 'views', 'venture.queue.decide': 'views', 'venture.runs.list': 'views', 'venture.runs.get': 'views', 'venture.team.list': 'views', 'venture.team.gate': 'views',
  'venture.evidence.list': 'core', 'venture.evidence.apply': 'core',
  'venture.journal.list': 'views', 'venture.journal.resolve': 'views',
  'venture.untrusted.mode': 'views', 'venture.untrusted.release': 'views',
  'venture.bank.import': 'build', 'venture.bank.consent': 'build', 'venture.site.stage': 'build', 'venture.site.apply': 'build', 'venture.site.revert': 'build',
  'venture.leads.add': 'build', 'venture.leads.list': 'build', 'venture.leads.draft': 'build', 'venture.leads.recordSend': 'build',
  'venture.queue.view': 'views', 'venture.team.posture': 'views', 'venture.evidence.dismiss': 'core', 'venture.money.overview': 'money', 'venture.tax.working': 'money',
  'venture.ca.get': 'views', 'venture.ca.setOfRecord': 'views', 'venture.ca.recordSignoff': 'views', 'venture.ca.confirmRates': 'views',
  'venture.leads.block': 'build', 'venture.share.create': 'build', 'venture.share.list': 'build', 'venture.share.revoke': 'build',
  'venture.delivery.judge': 'delivery', 'venture.delivery.judgeSend': 'delivery', 'venture.improve.rollback': 'delivery', 'venture.files.transcribe': 'delivery',
  'venture.posting.propose': 'build', 'venture.posting.signIn': 'build', 'venture.posting.checkSteps': 'build', 'venture.share.recordAnswer': 'build', 'venture.social.calendar': 'build',
  'venture.bank.ledger': 'build', 'venture.bank.apply': 'build', 'venture.bank.alerts.get': 'build', 'venture.bank.alerts.set': 'build',
  'venture.ca.receipt': 'views', 'venture.ca.explainDiff': 'views', 'venture.rules.list': 'views',
  'venture.judge.auto.get': 'delivery', 'venture.judge.auto.set': 'delivery',
  'venture.posting.limits.get': 'build', 'venture.posting.limits.set': 'build',
  'venture.transcription.get': 'delivery', 'venture.transcription.set': 'delivery',
  // Ink v2 wave 4
  'venture.team.keeper': 'views', 'venture.team.clearQuarantine': 'views',
  'venture.agents.thread.list': 'agents', 'venture.agents.thread.send': 'agents', 'venture.agents.proposal.decide': 'agents', 'venture.agents.version.undo': 'agents',
  'venture.agents.orders.list': 'agents', 'venture.chats.consent': 'agents',
  'venture.agents.notes.list': 'agents', 'venture.agents.notes.edit': 'agents', 'venture.agents.notes.forget': 'agents', 'venture.agents.notes.undo': 'agents',
  'venture.chief.threads': 'chief', 'venture.chief.thread.list': 'chief', 'venture.chief.thread.send': 'chief', 'venture.chief.thread.pin': 'chief', 'venture.chief.fit': 'chief',
  'venture.proposals.raise': 'chief', 'venture.proposals.dismiss': 'chief',
  'venture.network.import': 'network', 'venture.network.importUndo': 'network', 'venture.network.merge': 'network', 'venture.network.split': 'network', 'venture.network.forget': 'network',
  'venture.network.hide': 'network', 'venture.network.people': 'network', 'venture.network.person': 'network', 'venture.network.sources': 'network',
  'venture.network.recompute': 'network', 'venture.network.know': 'network', 'venture.network.link': 'network',
  'venture.network.search': 'network', 'venture.network.searchMore': 'network', 'venture.network.saveSearch': 'network', 'venture.network.research': 'network',
  'venture.pipeline.list': 'network', 'venture.pipeline.followups': 'network', 'venture.pipeline.add': 'network', 'venture.pipeline.setNext': 'network', 'venture.pipeline.move': 'network', 'venture.pipeline.settings': 'network',
  'venture.outreach.draft': 'network', 'venture.outreach.open': 'network', 'venture.outreach.sent': 'network', 'venture.outreach.restricted': 'network',
  'venture.mailbox.connect': 'network', 'venture.mailbox.disconnect': 'network', 'venture.mailbox.sync': 'network', 'venture.inbound.list': 'network', 'venture.inbound.confirm': 'network',
  'venture.network.calendar': 'network', 'venture.meeting.digest': 'network',
  'venture.runs.stop': 'views', 'venture.runs.resume': 'views', 'venture.runs.roundGate': 'views', 'venture.runs.steer': 'views', 'venture.business.pause': 'views', 'venture.away.set': 'views', 'venture.away.get': 'views',
  'venture.runs.allowWrites': 'views',
  'venture.notify.list': 'notify', 'venture.notify.read': 'notify', 'venture.notify.settings': 'notify',
  'venture.notify.push.key': 'notify', 'venture.notify.push.subscribe': 'notify', 'venture.notify.push.unsubscribe': 'notify', 'venture.notify.relay': 'notify',
  'venture.models.cli.status': 'models', 'venture.models.roles': 'models',
  'venture.goals.get': 'money', 'venture.goals.set': 'money', 'venture.goals.suggest': 'money',
  'venture.decisions.list': 'views', 'venture.policy.allowSession': 'views',
  'venture.queue.sendBack': 'views', 'venture.queue.edit': 'views', 'venture.queue.undo': 'views', 'venture.queue.set': 'views', 'venture.triage.set': 'views', 'venture.triage.preview': 'views',
  'venture.delivery.fix': 'delivery', 'venture.delivery.decideChange': 'delivery', 'venture.delivery.changes': 'delivery', 'venture.settings.draft': 'core', 'venture.settings.drafts': 'core',
  'venture.queue.setPreview': 'views', 'venture.delivery.copy': 'delivery',
  'venture.files.poster': 'delivery',
  'venture.money.aging': 'money', 'venture.money.flow': 'money', 'venture.money.cash': 'money', 'venture.money.margins': 'money', 'venture.money.export': 'money',
  'venture.bills.add': 'money', 'venture.bills.pay': 'money', 'venture.bills.list': 'money', 'venture.credit.issue': 'money', 'venture.invoice.recurring': 'money', 'venture.invoice.recurringList': 'money',
  'venture.invoice.remind': 'money', 'venture.payment.clear': 'money', 'venture.bills.stop': 'money',
  'venture.money.across': 'money', 'venture.runs.across': 'views',
  'venture.connectors.check': 'build', 'venture.share.request': 'build',
  'venture.playbooks.list': 'core', 'venture.blueprint.suggest': 'core',
  'venture.owner.get': 'core', 'venture.owner.set': 'core',
  'venture.receipt.verify': 'money', 'venture.journal.chain': 'views', 'venture.journal.acceptBreak': 'views',
  'venture.order.contract': 'money', 'venture.order.contract.propose': 'money', 'venture.order.contract.sign': 'money',
  'venture.routines.list': 'agents', 'venture.routines.runs': 'agents', 'venture.routines.set': 'agents', 'venture.routines.remove': 'agents',
  'venture.options.rerank': 'delivery',
  'venture.drills.run': 'delivery', 'venture.drills.list': 'delivery', 'venture.auto.readiness': 'views', 'venture.shadow.summary': 'views',
  'venture.playbook.guidance': 'delivery',
  'venture.voice.get': 'agents', 'venture.voice.set': 'agents', 'venture.voice.learn': 'agents', 'venture.persona.get': 'agents', 'venture.persona.set': 'agents', 'venture.persona.test': 'agents',
  'venture.agents.export': 'agents', 'venture.agents.import': 'agents',
  'venture.knowledge.list': 'agents', 'venture.knowledge.add': 'agents', 'venture.knowledge.remove': 'agents', 'venture.knowledge.test': 'agents',
  'venture.ideas.list': 'agents', 'venture.ideas.start': 'agents', 'venture.ideas.dismiss': 'agents', 'venture.agents.capabilities': 'agents',
  // Ink v2 wave 5 (named by package 5-0)
  'venture.order.chain': 'playbooks',
  'venture.salesProposal.draft': 'playbooks', 'venture.salesProposal.get': 'playbooks', 'venture.goNoGo.card': 'playbooks', 'venture.goNoGo.list': 'playbooks',
  'venture.ideas.add': 'playbooks', 'venture.ideas.move': 'playbooks', 'venture.ideas.grade': 'playbooks',
  'venture.brandKit.get': 'playbooks', 'venture.brandKit.set': 'playbooks', 'venture.assets.list': 'playbooks', 'venture.assets.rerun': 'playbooks', 'venture.assets.reuse': 'playbooks',
  'venture.voiceConsent.record': 'playbooks', 'venture.voiceConsent.revoke': 'playbooks', 'venture.voiceConsent.list': 'playbooks',
  'venture.report.render': 'playbooks', 'venture.report.share': 'playbooks', 'venture.report.shareRotate': 'playbooks', 'venture.report.shareDisable': 'playbooks',
  'venture.report.list': 'playbooks',
  'venture.monitors.list': 'build', 'venture.monitors.add': 'build', 'venture.monitors.remove': 'build', 'venture.mail.import': 'build', 'venture.mail.threads': 'build',
  'venture.localApps.list': 'build', 'venture.webhook.set': 'build', 'venture.speechOut.providers': 'build',
  'venture.ca.confirmCitations': 'playbooks', 'venture.ca.signoff.get': 'playbooks', 'venture.ca.differential.add': 'playbooks', 'venture.ca.dataPack.export': 'playbooks',
  'venture.desk.list': 'playbooks', 'venture.desk.get': 'playbooks', 'venture.desk.act': 'playbooks',
  // Never routed through VentureHost: the engine's draft desk (draft/handlers.ts) answers them.
  'venture.ai.options': 'models', 'venture.ai.connect': 'models', 'venture.ai.disconnect': 'models', 'venture.ai.status': 'models', 'venture.ai.calls': 'models',
  'venture.compose.decide': 'core', 'venture.compose.fill': 'core', 'venture.compose.get': 'core', 'venture.compose.update': 'core',
});
/** Methods that need a deliberate owner click inside the app (ctx.channel 'desktop', not source-tainted). */
export const APP_ONLY_METHODS: readonly VentureMethod[] = Object.freeze([
  'venture.create', 'venture.blueprint.accept', 'venture.models.connect', 'venture.invoice.issue', 'venture.payment.record',
  'venture.build.handoffOpened', 'venture.build.link', 'venture.launch.advance', 'venture.delivery.approve', 'venture.delivery.review',
  'venture.files.add', 'venture.delivery.answer', 'venture.improve.adopt', 'venture.delivery.delegate',
  'venture.ai.connect', 'venture.compose.decide', 'venture.compose.fill',
  'venture.queue.decide', 'venture.team.gate',
  'venture.evidence.apply',
  'venture.bank.import', 'venture.bank.consent', 'venture.site.apply', 'venture.site.revert', 'venture.leads.recordSend',
  'venture.spend.policy.set',
  'venture.team.posture', 'venture.evidence.dismiss', 'venture.ca.setOfRecord', 'venture.ca.recordSignoff', 'venture.ca.confirmRates',
  'venture.leads.block', 'venture.share.create', 'venture.share.revoke',
  'venture.journal.resolve',
  'venture.untrusted.mode', 'venture.untrusted.release',
  'venture.delivery.judgeSend', 'venture.improve.rollback', 'venture.files.transcribe', 'venture.posting.signIn', 'venture.posting.checkSteps',
  'venture.share.recordAnswer', 'venture.bank.apply', 'venture.bank.alerts.set', 'venture.ca.explainDiff',
  'venture.judge.auto.set',
  'venture.posting.limits.set',
  'venture.transcription.set',
  // Ink v2 wave 4
  'venture.team.clearQuarantine',
  'venture.agents.thread.send', 'venture.agents.proposal.decide', 'venture.agents.version.undo', 'venture.chats.consent',
  'venture.agents.notes.edit', 'venture.agents.notes.forget', 'venture.agents.notes.undo',
  'venture.chief.thread.send', 'venture.chief.thread.pin', 'venture.proposals.raise', 'venture.proposals.dismiss',
  'venture.network.import', 'venture.network.importUndo', 'venture.network.merge', 'venture.network.split', 'venture.network.forget', 'venture.network.hide',
  'venture.network.know', 'venture.network.link',
  'venture.network.search', 'venture.network.searchMore', 'venture.network.saveSearch', 'venture.network.research',
  'venture.pipeline.add', 'venture.pipeline.setNext', 'venture.pipeline.move', 'venture.pipeline.settings',
  'venture.outreach.draft', 'venture.outreach.open', 'venture.outreach.sent', 'venture.outreach.restricted',
  'venture.mailbox.connect', 'venture.mailbox.disconnect', 'venture.inbound.confirm', 'venture.network.calendar', 'venture.meeting.digest',
  'venture.runs.stop', 'venture.runs.resume', 'venture.runs.roundGate', 'venture.runs.steer', 'venture.business.pause', 'venture.away.set',
  'venture.runs.allowWrites',
  'venture.notify.settings', 'venture.notify.push.subscribe', 'venture.notify.push.unsubscribe', 'venture.notify.relay',
  'venture.goals.set',
  'venture.policy.allowSession',
  'venture.queue.sendBack', 'venture.queue.edit', 'venture.queue.undo', 'venture.queue.set', 'venture.triage.set',
  'venture.delivery.fix', 'venture.delivery.decideChange',
  'venture.files.poster',
  'venture.money.export',
  'venture.bills.add', 'venture.bills.pay', 'venture.credit.issue', 'venture.invoice.recurring', 'venture.invoice.remind', 'venture.payment.clear', 'venture.bills.stop',
  'venture.share.request',
  'venture.blueprint.suggest',
  'venture.owner.set',
  'venture.journal.acceptBreak',
  'venture.order.contract.sign',
  'venture.routines.set', 'venture.routines.remove',
  'venture.drills.run',
  'venture.voice.set', 'venture.voice.learn', 'venture.persona.set', 'venture.persona.test', 'venture.agents.import',
  'venture.knowledge.add', 'venture.knowledge.remove', 'venture.knowledge.test', 'venture.ideas.start', 'venture.ideas.dismiss',
  // Ink v2 wave 5 (5-0): every method that sets, records, revokes, adds, removes, exports, confirms, rotates or disables,
  // the desk's act and the webhook; also the report's share link (as venture.share.create is) and the mail import (as
  // venture.network.import is).
  'venture.ideas.add', 'venture.brandKit.set', 'venture.voiceConsent.record', 'venture.voiceConsent.revoke',
  'venture.report.share', 'venture.report.shareRotate', 'venture.report.shareDisable',
  'venture.monitors.add', 'venture.monitors.remove', 'venture.mail.import', 'venture.webhook.set',
  'venture.ca.confirmCitations', 'venture.ca.differential.add', 'venture.ca.dataPack.export',
  'venture.desk.act',
] as const);
/** The permission a method's handler authorizes at (records.ts authorize and ventureAction). */
export type MethodLevel = 'read' | 'prepare' | 'approve';
/** Ink v2 wave 4: each wave 4 method's level, as its package text names it; its handler authorizes at this level. */
export const W4_METHOD_LEVELS: Readonly<Record<W4Method, MethodLevel>> = Object.freeze({
  'venture.team.keeper': 'read', 'venture.team.clearQuarantine': 'approve',
  'venture.agents.thread.list': 'read', 'venture.agents.thread.send': 'prepare', 'venture.agents.proposal.decide': 'approve', 'venture.agents.version.undo': 'approve',
  'venture.agents.orders.list': 'read', 'venture.chats.consent': 'approve',
  'venture.agents.notes.list': 'read', 'venture.agents.notes.edit': 'approve', 'venture.agents.notes.forget': 'approve', 'venture.agents.notes.undo': 'approve',
  'venture.chief.threads': 'read', 'venture.chief.thread.list': 'read', 'venture.chief.thread.send': 'prepare', 'venture.chief.thread.pin': 'prepare', 'venture.chief.fit': 'prepare',
  'venture.proposals.raise': 'prepare', 'venture.proposals.dismiss': 'prepare',
  'venture.network.import': 'approve', 'venture.network.importUndo': 'approve', 'venture.network.merge': 'approve', 'venture.network.split': 'approve', 'venture.network.forget': 'approve',
  'venture.network.hide': 'prepare', 'venture.network.people': 'read', 'venture.network.person': 'read', 'venture.network.sources': 'read',
  'venture.network.recompute': 'prepare', 'venture.network.know': 'prepare', 'venture.network.link': 'prepare',
  'venture.network.search': 'prepare', 'venture.network.searchMore': 'prepare', 'venture.network.saveSearch': 'prepare', 'venture.network.research': 'prepare',
  'venture.pipeline.list': 'read', 'venture.pipeline.followups': 'read', 'venture.pipeline.add': 'prepare', 'venture.pipeline.setNext': 'prepare', 'venture.pipeline.move': 'approve', 'venture.pipeline.settings': 'approve',
  'venture.outreach.draft': 'prepare', 'venture.outreach.open': 'read', 'venture.outreach.sent': 'approve', 'venture.outreach.restricted': 'approve',
  'venture.mailbox.connect': 'approve', 'venture.mailbox.disconnect': 'approve', 'venture.mailbox.sync': 'prepare', 'venture.inbound.list': 'read', 'venture.inbound.confirm': 'approve',
  'venture.network.calendar': 'approve', 'venture.meeting.digest': 'prepare',
  'venture.runs.stop': 'approve', 'venture.runs.resume': 'approve', 'venture.runs.roundGate': 'approve', 'venture.runs.steer': 'prepare', 'venture.business.pause': 'approve', 'venture.away.set': 'approve', 'venture.away.get': 'read',
  'venture.runs.allowWrites': 'approve',
  'venture.notify.list': 'read', 'venture.notify.read': 'prepare', 'venture.notify.settings': 'approve',
  'venture.notify.push.key': 'read', 'venture.notify.push.subscribe': 'approve', 'venture.notify.push.unsubscribe': 'approve', 'venture.notify.relay': 'approve',
  'venture.models.cli.status': 'read', 'venture.models.roles': 'read',
  'venture.goals.get': 'read', 'venture.goals.set': 'approve', 'venture.goals.suggest': 'prepare',
  'venture.decisions.list': 'read', 'venture.policy.allowSession': 'approve',
  'venture.queue.sendBack': 'approve', 'venture.queue.edit': 'approve', 'venture.queue.undo': 'approve', 'venture.queue.set': 'approve', 'venture.triage.set': 'approve', 'venture.triage.preview': 'prepare',
  'venture.delivery.fix': 'approve', 'venture.delivery.decideChange': 'approve', 'venture.delivery.changes': 'read', 'venture.settings.draft': 'prepare', 'venture.settings.drafts': 'read',
  'venture.queue.setPreview': 'read', 'venture.delivery.copy': 'prepare',
  'venture.files.poster': 'prepare',
  'venture.money.aging': 'read', 'venture.money.flow': 'read', 'venture.money.cash': 'read', 'venture.money.margins': 'read', 'venture.money.export': 'approve',
  'venture.bills.add': 'approve', 'venture.bills.pay': 'approve', 'venture.bills.list': 'read', 'venture.credit.issue': 'approve', 'venture.invoice.recurring': 'approve', 'venture.invoice.recurringList': 'read',
  'venture.invoice.remind': 'prepare', 'venture.payment.clear': 'approve', 'venture.bills.stop': 'approve',
  'venture.money.across': 'read', 'venture.runs.across': 'read',
  'venture.connectors.check': 'prepare', 'venture.share.request': 'approve',
  'venture.playbooks.list': 'read', 'venture.blueprint.suggest': 'prepare',
  'venture.owner.get': 'read', 'venture.owner.set': 'approve',
  'venture.receipt.verify': 'read', 'venture.journal.chain': 'read', 'venture.journal.acceptBreak': 'approve',
  'venture.order.contract': 'read', 'venture.order.contract.propose': 'prepare', 'venture.order.contract.sign': 'approve',
  'venture.routines.list': 'read', 'venture.routines.runs': 'read', 'venture.routines.set': 'approve', 'venture.routines.remove': 'approve',
  'venture.options.rerank': 'read',
  'venture.drills.run': 'prepare', 'venture.drills.list': 'read', 'venture.auto.readiness': 'read', 'venture.shadow.summary': 'read',
  'venture.playbook.guidance': 'read',
  'venture.voice.get': 'read', 'venture.voice.set': 'approve', 'venture.voice.learn': 'prepare', 'venture.persona.get': 'read', 'venture.persona.set': 'approve', 'venture.persona.test': 'prepare',
  'venture.agents.export': 'read', 'venture.agents.import': 'prepare',
  'venture.knowledge.list': 'read', 'venture.knowledge.add': 'prepare', 'venture.knowledge.remove': 'prepare', 'venture.knowledge.test': 'prepare',
  'venture.ideas.list': 'read', 'venture.ideas.start': 'prepare', 'venture.ideas.dismiss': 'prepare', 'venture.agents.capabilities': 'read',
});
/**
 * Ink v2 wave 5: each wave 5 method's level, as package 5-0 named it from the plan; its handler authorizes at this
 * level. A package that finds its level wrong changes its own line and says so.
 */
export const W5_METHOD_LEVELS: Readonly<Record<W5Method, MethodLevel>> = Object.freeze({
  'venture.order.chain': 'read',
  'venture.salesProposal.draft': 'prepare', 'venture.salesProposal.get': 'read', 'venture.goNoGo.card': 'prepare', 'venture.goNoGo.list': 'read',
  'venture.ideas.add': 'prepare', 'venture.ideas.move': 'prepare', 'venture.ideas.grade': 'prepare',
  'venture.brandKit.get': 'read', 'venture.brandKit.set': 'approve', 'venture.assets.list': 'read', 'venture.assets.rerun': 'prepare', 'venture.assets.reuse': 'prepare',
  'venture.voiceConsent.record': 'approve', 'venture.voiceConsent.revoke': 'approve', 'venture.voiceConsent.list': 'read',
  'venture.report.render': 'prepare', 'venture.report.share': 'approve', 'venture.report.shareRotate': 'approve', 'venture.report.shareDisable': 'approve',
  'venture.report.list': 'read',
  'venture.monitors.list': 'read', 'venture.monitors.add': 'approve', 'venture.monitors.remove': 'approve', 'venture.mail.import': 'approve', 'venture.mail.threads': 'read',
  'venture.localApps.list': 'read', 'venture.webhook.set': 'approve', 'venture.speechOut.providers': 'read',
  'venture.ca.confirmCitations': 'approve', 'venture.ca.signoff.get': 'read', 'venture.ca.differential.add': 'approve', 'venture.ca.dataPack.export': 'approve',
  'venture.desk.list': 'read', 'venture.desk.get': 'read', 'venture.desk.act': 'approve',
});
/** Methods whose success changes what saved answers may cite (the retired app/renderer cleared its cached answers on them). */
export const EVIDENCE_METHODS: readonly VentureMethod[] = Object.freeze([
  'venture.create', 'venture.invoice.issue', 'venture.payment.record', 'venture.order.deliver',
] as const);

type Empty = Record<string, never>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type VenturePayloads = {
  'venture.countries': Empty;
  'venture.preview': { idea: string; countryCode: CountryCode; pricingModel?: PricingModel };
  /** composeId and composedDigest are sent together or not at all; the engine holds the plan itself. */
  'venture.create': { idea: string; countryCode: CountryCode; workingName?: string; composeId?: string; composedDigest?: string };
  'venture.get': Empty;
  'venture.events': { afterSeq?: number; limit?: number };
  'venture.interview.next': { useTemplate?: boolean };
  'venture.interview.answer': { questionId: string; answer: InterviewAnswer };
  'venture.blueprint.draft': { useTemplate?: boolean };
  'venture.blueprint.get': Empty;
  /** basedOn (4J8): refused APPROVAL_STALE unless the newest plan is still this one, as a suggestion read it. */
  'venture.blueprint.update': { patch: BlueprintPatch; basedOn?: { blueprintId: string; digest: string } };
  'venture.blueprint.accept': { digest: string };
  'venture.models.presets': Empty;
  'venture.models.connect': { presetId: ModelPresetId; consentDigest: string; apiKey?: string; model?: string; tiers?: ModelTier[]; monthlyCapUsd?: string };
  'venture.models.disconnect': { connectionId: string };
  'venture.models.status': Empty;
  'venture.models.calls': { limit?: number; purpose?: ModelPurpose };
  'venture.price.quote': { offerId: string; quantity?: string };
  'venture.receipt.get': { id: string };
  'venture.client.add': { name: string; email?: string; countryCode?: CountryCode; taxId?: string; stateCode?: string; note?: string };
  'venture.client.list': Empty;
  /** intake: only for a flagship playbook's offer; an offer that cuts footage needs intake.rights (delivery/rights.ts). */
  'venture.order.create': {
    clientId: string; offerId: string; quantity?: string; request: string;
    intake?: { rights?: unknown; format?: 'long' | 'short'; aiVoice?: boolean; aiPresenter?: boolean; paidPromotion?: boolean; cutFile?: string };
    /** 4J5 (M15): the price includes the tax. */
    taxInclusive?: boolean;
  };
  'venture.order.list': Empty;
  'venture.order.deliver': { orderId: string; deliveredOn: IsoDate };
  'venture.invoice.prepare': { orderId: string; dueInDays?: number; issueDate?: IsoDate };
  'venture.invoice.issue': { invoiceId: string; digest: string };
  'venture.invoice.get': { invoiceId: string };
  'venture.invoice.list': Empty;
  /**
   * 4J5 (M11, M15): allocations splits one payment of amount across invoices, in place of invoiceId; tds is what the
   * client deducted (India only, one invoice), its amount typed like amount.
   */
  'venture.payment.record': {
    invoiceId?: string; amount: string; receivedOn: IsoDate; method: PaymentMethod;
    allocations?: { invoiceId: string; amount: string }[]; tds?: { section: string; amount: string };
  };
  /** period: one of the choices, or one month like '2026-09' (4J4). */
  'venture.books.summary': { period?: BooksPeriodKey | string; from?: IsoDate; to?: IsoDate };
  'venture.spend.list': Empty;
  'venture.spend.policy.get': Empty;
  'venture.spend.policy.set': {
    capUsd?: string | null; askFirstUsd?: string | null; cap?: MicroString | null; askFirst?: MicroString | null; rates?: SpendRateInput[]; inrPerUsd?: string | null;
    // 4F2: the day's cap, the alert share in permille, each agent's own monthly limit, and lower daily write caps.
    dailyCapUsd?: string | null; dailyCap?: MicroString | null; alertPermille?: number; agentCaps?: { agent: string; capUsd: string }[];
    writeCaps?: Partial<Record<WriteCapKind, number>>;
    // 4Z3: which currency leads spend: Auto (by where the business is), Rupees first or Dollars first.
    currencyLead?: CurrencyLead;
  };
  'venture.build.brief': { useTemplate?: boolean };
  'venture.build.handoff': { builder: BuilderId };
  'venture.build.handoffOpened': { handoffId: string };
  'venture.build.link': { repo: string; token?: string };
  'venture.build.sync': Empty;
  'venture.build.status': Empty;
  'venture.connectors.list': { category?: ConnectorCategory; starterOnly?: boolean };
  'venture.delivery.playbook': Empty;
  'venture.simulation.scenarios': Empty;
  'venture.simulation.run': { scenarioIds?: string[]; episodes?: number; useTemplate?: boolean };
  'venture.simulation.get': { runId: string };
  'venture.simulation.fromSignal': { signalId: string };
  'venture.launch.status': Empty;
  'venture.launch.advance': { to: LaunchStage };
  'venture.delivery.run': { orderId: string; useTemplate?: boolean };
  'venture.delivery.approve': { runId: string; digest: string };
  'venture.delivery.review': { runId: string; verdict: 'accepted' | 'edited' | 'rejected'; reason?: DeliveryReason; editedText?: string };
  'venture.delivery.list': Empty;
  'venture.capabilities': Empty;
  'venture.files.add': { orderId: string; name: string; contentBase64: string };
  'venture.files.list': { orderId?: string };
  'venture.delivery.answer': { runId: string; answer: string };
  'venture.delivery.delegate': { runId: string; digest: string; decision: 'approve' | 'decline' };
  'venture.delegate.get': { id: string };
  'venture.work.get': { id: string };
  'venture.improve.status': Empty;
  /** budgetMicros (4J16, Q16): a lower budget for this run, in micro-dollars, at most the default (EXPERIMENT_BUDGET_MICROS). */
  'venture.improve.run': { maxRounds?: number; useTemplate?: boolean; budgetMicros?: MicroString };
  'venture.improve.get': { runId: string };
  'venture.improve.adopt': { runId: string; digest: string };
  'venture.queue.list': { scope?: 'current' | 'all' };
  'venture.queue.decide': { id: string; digest: string; action: QueueActionId; answer?: string; viewed?: boolean };
  'venture.runs.list': { state?: 'active' | 'done' | 'all' };
  'venture.runs.get': { runId: string };
  'venture.team.list': Empty;
  'venture.team.gate': { agentId: string; stepId: string; gate: 'auto' | 'hold' };
  'venture.evidence.list': { subject?: string };
  'venture.evidence.apply': { id: string };
  'venture.journal.list': { limit?: number };
  'venture.journal.resolve': { entryId: string; outcome: 'sent' | 'not-sent'; note?: string };
  'venture.untrusted.mode': { mode: 'observe' | 'enforce' };
  'venture.untrusted.release': { digest: string };
  'venture.bank.import': { csv: string; account: string };
  'venture.bank.consent': { account: string; days?: number; revoke?: boolean };
  'venture.site.stage': { path: string; after: string; summary: string };
  'venture.site.apply': { editId: string; reviewedHash: string };
  'venture.site.revert': { editId: string; reviewedHash: string };
  'venture.leads.add': { name: string; company?: string; email?: string; sourceUrl: string };
  'venture.leads.list': Empty;
  'venture.leads.draft': { leadId: string; subject: string; body: string; postalAddress?: string };
  'venture.leads.recordSend': { leadId: string; draftId: string; sentAt: IsoTime };
  /** id: a Today row id, or the id in a row's viewRef with its kind. */
  'venture.queue.view': { id: string; kind?: 'draft' | 'file' | 'run' | 'plan'; opened?: true };
  'venture.team.posture': { agentId: string; posture: Posture };
  'venture.evidence.dismiss': { id: string };
  'venture.money.overview': Empty;
  /** period: 'YYYY-MM' for a month (GST and TDS), or 'AY 2026-27' / 'FY 2025-26' for a year; absent is the current month. */
  'venture.tax.working': { period?: string };
  'venture.ca.get': Empty;
  'venture.ca.setOfRecord': { name: string; membershipNo: string };
  'venture.ca.recordSignoff': { requestId: string; membershipNo: string; note?: string };
  'venture.ca.confirmRates': { tableIds: string[]; membershipNo: string };
  /** value: an email address or a domain. */
  'venture.leads.block': { value: string };
  // 4J7: kind 'draft' (the default) takes deliveryId; 'order-status' orderId; 'statement' clientId; 'books' month.
  'venture.share.create': { deliveryId?: string; kind?: ShareKind; orderId?: string; clientId?: string; month?: string; expiresInHours?: number };
  'venture.share.list': { deliveryId?: string };
  'venture.share.revoke': { id: string };
  'venture.delivery.judge': { runId: string };
  'venture.delivery.judgeSend': { runId: string; digest: string };
  /** playbookId: the parent of the version in use; digest: the hash of the version in use, as the owner saw it. */
  'venture.improve.rollback': { playbookId: string; digest: string };
  'venture.files.transcribe': { orderId: string };
  /** draftId: '<delivery run id>.post-<n>', one channel line of a social draft. The text always comes from the stored draft. */
  'venture.posting.propose': { draftId: string; account?: string };
  'venture.posting.signIn': { connectorId: string };
  'venture.posting.checkSteps': { connectorId: string };
  'venture.share.recordAnswer': { draftId: string; answer: 'approved' | 'changes'; comment?: string };
  'venture.social.calendar': { runId: string };
  /** account: the owner's label for one account, absent for all; month: 'YYYY-MM', absent for every month. */
  'venture.bank.ledger': { account?: string; month?: string };
  /** invoiceId: the invoice a payment pays; only with as 'payment'. */
  'venture.bank.apply': { transactionId: string; as: 'payment' | 'cost' | 'skip'; invoiceId?: string };
  'venture.bank.alerts.get': Empty;
  /**
   * alertAddress: where alerts go (checked by the network guard); null stops them; absent keeps the address set before.
   * A rule's money is minor units (minor) or the amount the owner typed (amount), which the engine reads exactly.
   */
  'venture.bank.alerts.set': { account: string; rules: BankAlertRuleInput[]; alertAddress?: string | null };
  'venture.ca.receipt': { id: string };
  'venture.ca.explainDiff': { receiptId: string; key: string; note: string; membershipNo: string };
  'venture.rules.list': Empty;
  'venture.judge.auto.get': Empty;
  /** auto: true runs the judge on its own on every ready draft for a client or the public, and records the consent. */
  'venture.judge.auto.set': { auto: boolean };
  'venture.posting.limits.get': Empty;
  /** limits: only stricter numbers than Chausar's own (POSTING_LIMIT_LOOSER otherwise); a number left out is Chausar's own. */
  'venture.posting.limits.set': { connectorId: string; limits: Partial<OwnerPostingLimitsView> };
  'venture.transcription.get': Empty;
  'venture.transcription.set': { command: string; model: string } | { clear: true };
  // Ink v2 wave 4 (section 9e; each package checks its own payload)
  'venture.team.keeper': Empty;
  /** digest: the health digest the owner saw (APPROVAL_STALE otherwise). */
  'venture.team.clearQuarantine': { agentId: string; digest: string };
  /** before: the id of the oldest item shown, for the page of 50 before it. */
  'venture.agents.thread.list': { agent: string; before?: string };
  'venture.agents.thread.send': { agent: string; text: string };
  'venture.agents.proposal.decide': { id: string; digest: string; decision: 'accept' | 'reject' };
  /** digest: the hash of the playbook version in use, as the owner saw it. */
  'venture.agents.version.undo': { agent: string; digest: string };
  'venture.agents.orders.list': { agent: string };
  'venture.chats.consent': { digest: string };
  'venture.agents.notes.list': { agent: string };
  /** noteId absent: a new note. basedOn: the stored note's hash the owner corrected (NOTE_CHANGED otherwise). */
  'venture.agents.notes.edit': { agent: string; noteId?: string; text: string; basedOn?: string };
  'venture.agents.notes.forget': { agent: string; noteId: string };
  'venture.agents.notes.undo': { agent: string; changeId: string };
  'venture.chief.threads': Empty;
  'venture.chief.thread.list': { threadId: string; before?: string };
  /** threadId absent: a new thread, titled by the first question. */
  'venture.chief.thread.send': { threadId?: string; text: string };
  'venture.chief.thread.pin': { threadId: string; pinned: boolean };
  'venture.chief.fit': Empty;
  'venture.proposals.raise': { id: string };
  'venture.proposals.dismiss': { id: string };
  /** check: true returns what it would keep and drop and stores nothing. */
  'venture.network.import': { kind: NetworkImportKind; name: string; text: string; check?: boolean };
  /** preview: true says what would go and changes nothing. */
  'venture.network.importUndo': { importId: string; preview?: boolean };
  'venture.network.merge': { a: string; b: string };
  'venture.network.split': { personId: string; sourceIds: string[] };
  'venture.network.forget': { id: string };
  'venture.network.hide': { personId: string; hidden: boolean };
  /** suggestions: true adds the "Same person?" suggestions (4D1). */
  'venture.network.people': { query?: string; hidden?: boolean; suggestions?: boolean; limit?: number };
  'venture.network.person': { id: string };
  'venture.network.sources': Empty;
  'venture.network.recompute': Empty;
  'venture.network.know': { personId: string; how: 'well' | 'met'; note?: string };
  'venture.network.link': { a: string; b: string; note: string };
  'venture.network.search': { text: string; web?: boolean };
  'venture.network.searchMore': { searchId: string };
  'venture.network.saveSearch': { searchId: string; name: string };
  'venture.network.research': { personId: string };
  'venture.pipeline.list': { filter?: 'due' | 'draft' };
  'venture.pipeline.followups': Empty;
  'venture.pipeline.add': { personId: string; trigger: { kind: OpportunityTrigger['kind']; ref?: string }; votes?: CardVote[] };
  'venture.pipeline.setNext': { id: string; text: string; due: IsoDate };
  'venture.pipeline.move': { id: string; stage: PipelineStage; reason?: LostReason; evidence?: PipelineEvidenceInput };
  'venture.pipeline.settings': { weekdays?: number[]; sendTime?: string; caps?: { newPerDay?: number; perWeek?: number; channels?: Partial<Record<OutreachLane, number>> }; scoreRules?: ScoreRule[] };
  /**
   * 4E2. basis: the lawful basis a cold email needs (kept on the card); limit: a connection note's 200 (free) or 300
   * (Premium); introduce: who a double opt-in introduces; about: the owner's own words; postalAddress: as leads.draft.
   */
  'venture.outreach.draft': {
    opportunityId: string; kind: OutreachKind; channel: OutreachChannel; basis?: LawfulBasis; limit?: 200 | 300; introduce?: string; about?: string;
    language?: OutreachLanguage; postalAddress?: string;
  };
  'venture.outreach.open': { draftId: string };
  'venture.outreach.sent': { draftId: string; at: IsoTime; channel: OutreachSentChannel };
  'venture.outreach.restricted': { channel: OutreachChannel };
  /** appPassword goes to the engine's secret shelf, never a record or a log. */
  'venture.mailbox.connect': { host: string; port: number; user: string; appPassword: string };
  'venture.mailbox.disconnect': Empty;
  'venture.mailbox.sync': Empty;
  'venture.inbound.list': Empty;
  'venture.inbound.confirm': { id: string; opportunityId: string };
  /** url: the owner's private ICS address. */
  'venture.network.calendar': { url: string };
  'venture.meeting.digest': { eventId?: string; notes: string };
  'venture.runs.stop': { runId: string; force?: boolean };
  'venture.runs.resume': { runId: string };
  'venture.runs.roundGate': { runId: string; on: boolean; every?: 1 | 2 | 3 | 5 };
  'venture.runs.steer': { runId: string; text: string };
  'venture.business.pause': { paused: boolean; stopRunning?: boolean };
  'venture.away.set': { from: IsoDate; to: IsoDate };
  'venture.away.get': Empty;
  'venture.runs.allowWrites': { kind: WriteCapKind };
  'venture.notify.list': Empty;
  'venture.notify.read': { ids?: string[]; all?: boolean };
  /** A field left out keeps its setting; {} answers the settings as they are. */
  'venture.notify.settings': { pausedUntil?: IsoTime | null; quietHours?: { from: string; to: string } | null; digest?: { hour: number } | null; push?: boolean; tray?: boolean };
  'venture.notify.push.key': Empty;
  'venture.notify.push.subscribe': { subscription: PushSubscriptionInput };
  'venture.notify.push.unsubscribe': { endpoint: string };
  /** url: the owner's own https address; null clears it. */
  'venture.notify.relay': { url: string | null };
  /** fresh: true looks at each tool again (Your AI's "Check again"); left out, a look from the last minute is reused. */
  'venture.models.cli.status': { fresh?: boolean };
  'venture.models.roles': Empty;
  /** month: 'YYYY-MM'; absent is this month on the owner's calendar. */
  'venture.goals.get': { month?: string };
  /** 4I2: amount is the owner's typed goal, read in the business's currency; amountMinor exact minor units. One of the two. */
  'venture.goals.set': { month: string; amount: string; amountMinor?: never } | { month: string; amountMinor: MinorString; amount?: never };
  'venture.goals.suggest': { month: string };
  'venture.decisions.list': Empty;
  'venture.policy.allowSession': { stepId: string };
  'venture.queue.sendBack': { rowId: string; digest: string; text: string };
  'venture.queue.edit': { rowId: string; digest: string; text: string };
  'venture.queue.undo': { rowId: string };
  /** digest: one digest over the ordered rows the owner picked and their total quote. */
  'venture.queue.set': { rowIds: string[]; digest: string; secondAsk?: true };
  'venture.queue.setPreview': { rowIds: string[] };
  'venture.delivery.copy': { runId: string };
  'venture.triage.set': { rule: TriageRule; digest: string };
  'venture.triage.preview': { text: string };
  'venture.delivery.fix': { runId: string; checks: 'all' | string[] };
  'venture.delivery.decideChange': { runId: string; changeId: string; accept: boolean };
  'venture.delivery.changes': { runId: string };
  'venture.settings.draft': { form: string; values: Json };
  'venture.settings.drafts': Empty;
  /** 4J3: the order whose cut (named at intake) the still is taken from; there is no video upload to name. */
  'venture.files.poster': { orderId: string };
  'venture.money.aging': { asOf?: IsoDate };
  'venture.money.flow': { months?: number };
  'venture.money.cash': Empty;
  'venture.money.margins': { month: string };
  'venture.money.export': { month: string };
  /** recurring: left out, a bill taking an expected one's place keeps its repeat; null says it does not repeat. */
  'venture.bills.add': { vendor: string; lines: BillLineInput[]; billDate: IsoDate; dueDate: IsoDate; recurring?: 'monthly' | 'quarterly' | null };
  'venture.bills.pay': { billId: string; paidOn: IsoDate; method: PaymentMethod } & TypedAmount;
  'venture.bills.list': Empty;
  'venture.credit.issue': { invoiceId: string; reason: string; digest: string } & TypedAmount;
  'venture.invoice.recurring': {
    clientId: string; offerId: string; frequency: 'monthly' | 'quarterly'; startOn: IsoDate; end?: IsoDate;
    reminderDays?: number[]; taxInclusive?: boolean;
  };
  'venture.invoice.recurringList': Empty;
  'venture.invoice.remind': { invoiceId: string };
  'venture.payment.clear': { paymentId: string };
  /** 4J5 (review): ends the repeat of a bill's vendor; an expected bill of it that waits is cancelled. */
  'venture.bills.stop': { billId: string };
  'venture.money.across': Empty;
  'venture.runs.across': Empty;
  'venture.connectors.check': { last?: true };
  'venture.share.request': { orderId: string; note?: string };
  'venture.playbooks.list': Empty;
  'venture.blueprint.suggest': { text: string; attachment?: { name: string; text: string } };
  'venture.owner.get': Empty;
  /** firstName null takes the owner's name back (minimum data). */
  'venture.owner.set': { firstName?: string | null; excludedServices?: string[] };
  'venture.receipt.verify': { id: string };
  'venture.journal.chain': Empty;
  /** digest: the recorded break the owner accepts; a new chain starts with a line that says so. */
  'venture.journal.acceptBreak': { digest: string };
  'venture.order.contract': { orderId: string };
  'venture.order.contract.propose': { orderId: string; contract: OrderContract };
  'venture.order.contract.sign': { orderId: string; digest: string };
  'venture.routines.list': Empty;
  'venture.routines.runs': { id: string };
  'venture.routines.set': { routine: RoutineInput };
  'venture.routines.remove': { id: string };
  /** weights: the owner's weight per scored criterion. */
  'venture.options.rerank': { questionId: string; weights: Record<string, number> };
  'venture.drills.run': Empty;
  'venture.drills.list': Empty;
  'venture.auto.readiness': { agent: string };
  'venture.shadow.summary': { agent: string };
  'venture.playbook.guidance': Empty;
  'venture.voice.get': Empty;
  'venture.voice.set': { voice: VoiceInput };
  /** samples: three to ten of the owner's own texts. */
  'venture.voice.learn': { samples: string[] };
  'venture.persona.get': { agent: string };
  'venture.persona.set': { agent: string; persona: PersonaFields };
  'venture.persona.test': { agent: string; persona: PersonaFields };
  'venture.agents.export': { agent: string };
  'venture.agents.import': { text: string };
  'venture.knowledge.list': Empty;
  'venture.knowledge.add': { source: KnowledgeSourceInput };
  'venture.knowledge.remove': { id: string };
  'venture.knowledge.test': { question: string };
  'venture.ideas.list': Empty;
  'venture.ideas.start': { id: string };
  'venture.ideas.dismiss': { id: string };
  'venture.agents.capabilities': { agent: string };
  // Ink v2 wave 5 (5-0, from the plan's words; the owning package may tighten its own lines)
  'venture.order.chain': { orderId: string };
  /** Exactly one of clientId and personId (a pipeline person, 4E). pilot: propose the offer's pilot, with the terms agreed so far (5A2 pilotOf). */
  'venture.salesProposal.draft': ({ clientId: string; personId?: never } | { personId: string; clientId?: never }) & { offerId: string; pilot?: boolean | SalesPilotTerms };
  /** 5A2: by its id, or the newest proposal for a client or a pipeline person (PROPOSAL_NOT_FOUND when there is none). */
  'venture.salesProposal.get': { id: string } | { clientId: string } | { personId: string };
  /** inputs: typed by the owner; money as rupee text the engine reads like a price (5A2 records-sales.ts GoNoGoInputs). */
  'venture.goNoGo.card': { playbook: string; subject: string; inputs: GoNoGoInputs };
  'venture.goNoGo.list': Empty;
  'venture.ideas.add': { text: string; source: string };
  /** reason: one sentence, required when the stage is 'dropped'. */
  'venture.ideas.move': { id: string; stage: IdeaStage; reason?: string };
  'venture.ideas.grade': { id: string; grade: IdeaGrade };
  'venture.brandKit.get': { clientId: string };
  'venture.brandKit.set': { clientId: string; kit: BrandKitInput };
  'venture.assets.list': { orderId?: string; clientId?: string };
  'venture.assets.rerun': { id: string };
  'venture.assets.reuse': { id: string; orderId: string };
  'venture.voiceConsent.record': { speaker: string; recordingFileId: string; transcript: string; statement: string; scope: string; until: IsoDate | null };
  'venture.voiceConsent.revoke': { id: string };
  'venture.voiceConsent.list': Empty;
  'venture.report.render': { runId: string; formats?: ReportFormat[] };
  'venture.report.share': { reportId: string; from: IsoDate; to: IsoDate; channels?: string[] };
  'venture.report.shareRotate': { shareId: string };
  'venture.report.shareDisable': { shareId: string };
  'venture.report.list': { orderId?: string; runId?: string };
  'venture.monitors.list': Empty;
  'venture.monitors.add': MonitorInput;
  'venture.monitors.remove': { id: string };
  /** uploadId: an .eml or .mbox file the owner added (venture.files.add). */
  /** 5A6: an .eml or .mbox file, as its bytes (venture.files.add takes only order files of up to 1.45 MB). */
  'venture.mail.import': { name: string; contentBase64: string };
  'venture.mail.threads': { clientId?: string };
  'venture.localApps.list': Empty;
  /** url null clears it. */
  /** 5A6: test: send the fixed test item (shown first) once, journalled, before the address is kept. */
  'venture.webhook.set': { kind: 'n8n' | 'make'; url: string | null; test?: boolean };
  'venture.speechOut.providers': Empty;
  /** As venture.ca.confirmRates: the CA of record's membership number and the citations table version confirmed. */
  'venture.ca.confirmCitations': { version: number; membershipNo: string };
  'venture.ca.signoff.get': { id: string };
  'venture.ca.differential.add': { name: string; inputs: Json; outputs: Json; capturedBy: string };
  'venture.ca.dataPack.export': { clientId: string; fields: string[] };
  'venture.desk.list': DeskListPayload;
  'venture.desk.get': DeskGetPayload;
  'venture.desk.act': DeskActPayload;
  'venture.ai.options': OnboardingPayloads['venture.ai.options'];
  'venture.ai.connect': OnboardingPayloads['venture.ai.connect'];
  'venture.ai.disconnect': OnboardingPayloads['venture.ai.disconnect'];
  'venture.ai.status': OnboardingPayloads['venture.ai.status'];
  'venture.ai.calls': OnboardingPayloads['venture.ai.calls'];
  'venture.compose.decide': OnboardingPayloads['venture.compose.decide'];
  'venture.compose.fill': OnboardingPayloads['venture.compose.fill'];
  'venture.compose.get': OnboardingPayloads['venture.compose.get'];
  'venture.compose.update': OnboardingPayloads['venture.compose.update'];
};
export type VentureResults = {
  'venture.countries': CountryProfile[];
  'venture.preview': PlanPreview;
  'venture.create': VentureView;
  'venture.get': VentureView | null;
  /**
   * frames (4G1): the run events among events, as the desktop and /api/events pushed them, so a client replays a gap.
   * firstSeq: the oldest event the log still keeps (0 when empty); an afterSeq below it means events were trimmed.
   */
  'venture.events': { events: VentureEventRecord[]; lastSeq: number; firstSeq: number; frames: VentureRunEvent[] };
  'venture.interview.next': InterviewView;
  'venture.interview.answer': InterviewView;
  'venture.blueprint.draft': BlueprintView;
  'venture.blueprint.get': BlueprintView | null;
  'venture.blueprint.update': BlueprintView;
  'venture.blueprint.accept': BlueprintView;
  'venture.models.presets': ModelPreset[];
  'venture.models.connect': ModelStatusView;
  'venture.models.disconnect': ModelStatusView;
  'venture.models.status': ModelStatusView;
  'venture.models.calls': ModelCallRecord[];
  'venture.price.quote': PriceReceiptRecord;
  /** A price receipt, a sum receipt (owed, received, spent) that code made from venture records, or a tie's receipt (4D2). */
  'venture.receipt.get': (PriceReceiptRecord | SumReceiptRecord | TieReceipt | RowFigureReceipt) & { signature?: ReceiptSignature };
  'venture.client.add': ClientRecord;
  'venture.client.list': ClientListRow[];
  'venture.order.create': OrderRecord;
  /** 4J3: each order with its stage steps and what waits on the owner (money/order-steps.ts). */
  'venture.order.list': OrderListRow[];
  'venture.order.deliver': OrderRecord;
  'venture.invoice.prepare': InvoiceView;
  'venture.invoice.issue': InvoiceView;
  'venture.invoice.get': InvoiceView;
  'venture.invoice.list': InvoiceListRow[];
  'venture.payment.record': InvoiceView;
  'venture.books.summary': BooksSummary;
  'venture.spend.list': { rows: SpendRow[]; total: Display; totalRupees?: Display; totalLead?: SpendLead };
  'venture.spend.policy.get': SpendPolicyView;
  'venture.spend.policy.set': SpendPolicyView;
  'venture.build.brief': BriefRecord;
  'venture.build.handoff': HandoffPlan;
  'venture.build.handoffOpened': HandoffRecord;
  'venture.build.link': BuildFollowRecord;
  'venture.build.sync': BuildStatus;
  'venture.build.status': { follow: BuildFollowRecord | null; brief: BriefRecord | null; handoffs: HandoffRecord[]; tokenLink: string };
  'venture.connectors.list': ConnectorCard[];
  'venture.delivery.playbook': PlaybookRecord;
  'venture.simulation.scenarios': Scenario[];
  'venture.simulation.run': SimulationRunRecord;
  'venture.simulation.get': SimulationRunRecord;
  'venture.simulation.fromSignal': Scenario;
  'venture.launch.status': LaunchStatus;
  'venture.launch.advance': LaunchStatus;
  'venture.delivery.run': DeliveryRunView;
  'venture.delivery.approve': DeliveryRunView;
  'venture.delivery.review': DeliveryRunView;
  'venture.delivery.list': DeliveryRunView[];
  'venture.capabilities': CapabilityStatus[];
  'venture.files.add': UploadView;
  'venture.files.list': UploadView[];
  'venture.delivery.answer': DeliveryRunView;
  'venture.delivery.delegate': DeliveryRunView;
  'venture.delegate.get': DelegateRunRecord;
  'venture.work.get': WorkReceiptRecord & { coverage?: CoverageView }; // 4J14 (Q6): fraction first where code counts it
  'venture.improve.status': ImprovementStatus;
  'venture.improve.run': ImprovementRunRecord;
  'venture.improve.get': ImprovementRunRecord;
  'venture.improve.adopt': PlaybookRecord;
  'venture.queue.list': QueueList;
  'venture.queue.decide': QueueDecision;
  'venture.runs.list': { runs: RunSummary[] };
  'venture.runs.get': RunDetail;
  'venture.team.list': TeamListView;
  'venture.team.gate': { agent: AgentView };
  'venture.evidence.list': { items: EvidenceItem[] };
  'venture.evidence.apply': { item: EvidenceItem };
  'venture.journal.list': { entries: JournalEntry[] };
  'venture.journal.resolve': { entry: JournalEntry };
  'venture.untrusted.mode': { mode: 'observe' | 'enforce' };
  'venture.untrusted.release': { digest: string; released: true };
  'venture.bank.import': BankImportResult;
  'venture.bank.consent': BankConsentView;
  'venture.site.stage': SiteEditRecord;
  'venture.site.apply': SiteEditRecord;
  'venture.site.revert': SiteEditRecord;
  'venture.leads.add': LeadView;
  'venture.leads.list': { leads: LeadView[] };
  'venture.leads.draft': { lead: LeadView; draft: OutreachDraftView };
  'venture.leads.recordSend': LeadView;
  'venture.queue.view': QueueItemView;
  'venture.team.posture': { agent: AgentView };
  'venture.evidence.dismiss': { item: EvidenceItem };
  'venture.money.overview': MoneyOverview;
  'venture.tax.working': TaxWorkingView;
  'venture.ca.get': CaFirmView;
  'venture.ca.setOfRecord': CaFirmView;
  'venture.ca.recordSignoff': { request: CaRequestView };
  'venture.ca.confirmRates': CaFirmView;
  'venture.leads.block': { blocked: string[] };
  'venture.share.create': ShareLinkView;
  /**
   * links is the contract's name; shares is the same list under the name app/ui read first. posts: with a deliveryId,
   * the posts that draft holds now, each with the id venture.posting.propose takes (Ink v2 wave 2), and clientApproval:
   * whether they go out only after the client approved the draft; answer: the client's answer the engine counts for the
   * draft as it is now, or null (the one posting reads and recordAnswer refuses over).
   */
  'venture.share.list': { links: ShareLinkView[]; shares: ShareLinkView[]; posts?: DraftPostView[]; clientApproval?: boolean; answer?: ShareAnswerView | null };
  'venture.share.revoke': ShareLinkView;
  'venture.delivery.judge': DeliveryJudgePreview;
  'venture.delivery.judgeSend': DeliveryRunView;
  'venture.improve.rollback': PlaybookRecord;
  'venture.files.transcribe': UploadView;
  'venture.posting.propose': PostingProposal;
  /** The browser window opened; the method does not wait for it to close. */
  'venture.posting.signIn': { opened: true; line: Display };
  'venture.posting.checkSteps': PostingStepsView;
  'venture.share.recordAnswer': { answer: ShareAnswerView };
  'venture.social.calendar': SocialCalendarFile;
  'venture.bank.ledger': BankLedgerView;
  'venture.bank.apply': BankApplyResult;
  'venture.bank.alerts.get': BankAlertsView;
  'venture.bank.alerts.set': BankAlertsView;
  'venture.ca.receipt': CaReceiptView;
  'venture.ca.explainDiff': { explanation: CaDiffExplanation };
  'venture.rules.list': RulesListView;
  'venture.judge.auto.get': JudgeAutoView;
  'venture.judge.auto.set': JudgeAutoView;
  'venture.posting.limits.get': PostingLimitsView;
  'venture.posting.limits.set': PostingLimitsView;
  'venture.transcription.get': TranscriptionSetupView;
  'venture.transcription.set': TranscriptionSetupView;
  // Ink v2 wave 4 (section 9e)
  'venture.team.keeper': KeeperView;
  // 4A1: agent is null when the team's own quarantine was cleared (agentId 'team'); teamHealth is the team's after it.
  'venture.team.clearQuarantine': { agent: AgentView | null; teamHealth: AgentHealth };
  'venture.agents.thread.list': AgentThreadView;
  'venture.agents.thread.send': AgentSendResult;
  'venture.agents.proposal.decide': AgentProposalDecision;
  'venture.agents.version.undo': AgentVersionUndo;
  'venture.agents.orders.list': StandingOrdersView;
  'venture.chats.consent': ChatConsentView;
  'venture.agents.notes.list': AgentNotesView;
  'venture.agents.notes.edit': AgentNoteChange;
  'venture.agents.notes.forget': AgentNoteChange;
  'venture.agents.notes.undo': AgentNoteChange;
  'venture.chief.threads': ChiefThreadsView;
  'venture.chief.thread.list': ChiefThreadView;
  'venture.chief.thread.send': ChiefSendResult;
  'venture.chief.thread.pin': { thread: ChiefThreadSummary };
  /** null with no AI. */
  'venture.chief.fit': ChiefFit | null;
  'venture.proposals.raise': ProposalRaised;
  'venture.proposals.dismiss': { proposal: ProposalView };
  'venture.network.import': NetworkImportResult;
  'venture.network.importUndo': NetworkImportUndo;
  'venture.network.merge': PersonView;
  'venture.network.split': PersonSplit;
  'venture.network.forget': NetworkForgotten;
  'venture.network.hide': { person: PersonSummary };
  'venture.network.people': PeopleView;
  'venture.network.person': PersonView;
  'venture.network.sources': NetworkSourcesView;
  'venture.network.recompute': NetworkRecompute;
  'venture.network.know': PersonView;
  'venture.network.link': { line: Display };
  'venture.network.search': NetworkSearchView;
  'venture.network.searchMore': NetworkSearchView;
  'venture.network.saveSearch': { search: SavedSearchView };
  'venture.network.research': PersonResearch;
  'venture.pipeline.list': PipelineView;
  'venture.pipeline.followups': FollowupsView;
  'venture.pipeline.add': PipelineCardResult;
  'venture.pipeline.setNext': PipelineCardResult;
  'venture.pipeline.move': PipelineCardResult;
  'venture.pipeline.settings': PipelineSettingsView;
  'venture.outreach.draft': { draft: OutreachView; line: Display };
  'venture.outreach.open': OutreachHandoff;
  'venture.outreach.sent': OutreachSentResult;
  'venture.outreach.restricted': OutreachRestriction;
  'venture.mailbox.connect': MailboxView;
  'venture.mailbox.disconnect': MailboxView;
  'venture.mailbox.sync': MailboxSync;
  'venture.inbound.list': InboundListView;
  'venture.inbound.confirm': { item: InboundView };
  'venture.network.calendar': CalendarFeedView;
  'venture.meeting.digest': MeetingDigestView;
  'venture.runs.stop': RunControlResult;
  'venture.runs.resume': RunControlResult;
  'venture.runs.roundGate': RunControlResult;
  'venture.runs.steer': RunControlResult;
  'venture.business.pause': PauseView;
  'venture.away.set': AwayView;
  'venture.away.get': AwayView;
  'venture.runs.allowWrites': AllowWritesView;
  'venture.notify.list': NotifyListView;
  'venture.notify.read': { unread: number };
  'venture.notify.settings': NotifySettingsView;
  'venture.notify.push.key': PushKeyView;
  'venture.notify.push.subscribe': PushStateView;
  'venture.notify.push.unsubscribe': PushStateView;
  'venture.notify.relay': RelayView;
  'venture.models.cli.status': CliStatusList;
  'venture.models.roles': RoleModelsView;
  'venture.goals.get': GoalView;
  'venture.goals.set': GoalView;
  /** null with no AI. */
  'venture.goals.suggest': GoalSuggestion | null;
  'venture.decisions.list': DecisionsView;
  'venture.policy.allowSession': AllowSessionView;
  'venture.queue.sendBack': QueueDecision;
  'venture.queue.edit': QueueDecision;
  'venture.queue.undo': QueueUndoResult;
  'venture.queue.set': QueueSetResult;
  'venture.queue.setPreview': QueueSetPreview;
  'venture.delivery.copy': DeliveryRunView;
  'venture.triage.set': TriageRuleView;
  'venture.triage.preview': TriagePreview;
  'venture.delivery.fix': DeliveryRunView;
  'venture.delivery.decideChange': DraftChangesView;
  'venture.delivery.changes': DraftChangesView;
  'venture.settings.draft': SettingsDraftSaved;
  'venture.settings.drafts': SettingsDraftsView;
  'venture.files.poster': UploadView;
  'venture.money.aging': AgingView;
  'venture.money.flow': FlowView;
  'venture.money.cash': CashView;
  'venture.money.margins': MarginsView;
  'venture.money.export': MoneyExportFile;
  'venture.bills.add': BillResult;
  'venture.bills.pay': BillResult;
  'venture.bills.list': BillsView;
  'venture.credit.issue': { creditNote: CreditNoteView };
  'venture.invoice.recurring': { recurring: RecurringInvoiceView };
  'venture.invoice.recurringList': RecurringInvoicesView;
  /** The reminder draft, handed off through venture.outreach.open and recorded with venture.outreach.sent (4E2). */
  'venture.invoice.remind': { draft: OutreachView; receiptId?: string };
  'venture.payment.clear': InvoiceView;
  'venture.bills.stop': BillsView;
  'venture.money.across': AcrossMoneyView;
  'venture.runs.across': AcrossRunsView;
  'venture.connectors.check': ConnectorChecksView | null;
  'venture.share.request': FileRequestView;
  'venture.playbooks.list': WaysView;
  'venture.blueprint.suggest': PlanSuggestionView;
  'venture.owner.get': OwnerView;
  'venture.owner.set': OwnerView;
  'venture.receipt.verify': ReceiptVerifyView;
  'venture.journal.chain': JournalChainView;
  'venture.journal.acceptBreak': JournalChainView;
  /** null when the order has no contract. */
  'venture.order.contract': OrderContractView | null;
  'venture.order.contract.propose': OrderContractView;
  'venture.order.contract.sign': OrderContractView;
  'venture.routines.list': RoutinesView;
  'venture.routines.runs': RoutineRunsView;
  'venture.routines.set': { routine: RoutineView };
  'venture.routines.remove': { removed: true; line: Display };
  'venture.options.rerank': RerankView;
  'venture.drills.run': { run: DrillRunView };
  'venture.drills.list': DrillRunsView;
  'venture.auto.readiness': AutoReadinessView;
  'venture.shadow.summary': ShadowSummaryView;
  'venture.playbook.guidance': GuidanceView;
  'venture.voice.get': VoiceView;
  'venture.voice.set': VoiceView;
  'venture.voice.learn': VoiceView;
  'venture.persona.get': PersonaView;
  'venture.persona.set': PersonaView;
  'venture.persona.test': PersonaTestView;
  'venture.agents.export': AgentExportFile;
  /** An import becomes an instruction proposal, never a direct change (4J17). */
  'venture.agents.import': { proposal: AgentProposalView };
  'venture.knowledge.list': KnowledgeView;
  'venture.knowledge.add': { source: KnowledgeSourceView };
  'venture.knowledge.remove': { removed: true; line: Display };
  'venture.knowledge.test': KnowledgeTestView;
  'venture.ideas.list': IdeasView;
  'venture.ideas.start': IdeaStarted;
  'venture.ideas.dismiss': { dismissed: true; line: Display };
  'venture.agents.capabilities': CapabilityPageView;
  // Ink v2 wave 5 (5-0): each result type is the owning package's, a placeholder until it lands
  'venture.order.chain': OrderChainView;
  'venture.salesProposal.draft': SalesProposalView;
  'venture.salesProposal.get': SalesProposalView;
  'venture.goNoGo.card': GoNoGoCardView;
  'venture.goNoGo.list': GoNoGoListView;
  'venture.ideas.add': IdeaAddedView;
  'venture.ideas.move': IdeaMovedView;
  'venture.ideas.grade': IdeaGradedView;
  'venture.brandKit.get': BrandKitView;
  'venture.brandKit.set': BrandKitView;
  'venture.assets.list': AssetsView;
  'venture.assets.rerun': AssetRerunView;
  'venture.assets.reuse': AssetReuseView;
  'venture.voiceConsent.record': VoiceConsentView;
  'venture.voiceConsent.revoke': VoiceConsentView;
  'venture.voiceConsent.list': VoiceConsentsView;
  'venture.report.render': ReportView;
  'venture.report.share': ReportShareView;
  'venture.report.shareRotate': ReportShareView;
  'venture.report.shareDisable': ReportShareView;
  'venture.report.list': ReportListView;
  'venture.monitors.list': MonitorsView;
  'venture.monitors.add': MonitorView;
  'venture.monitors.remove': MonitorView;
  'venture.mail.import': MailImportView;
  'venture.mail.threads': MailThreadsView;
  'venture.localApps.list': LocalAppsView;
  'venture.webhook.set': WebhookView;
  'venture.speechOut.providers': SpeechProvidersView;
  'venture.ca.confirmCitations': CitationsConfirmView;
  'venture.ca.signoff.get': SignoffCheckView;
  'venture.ca.differential.add': DifferentialAddView;
  'venture.ca.dataPack.export': DataPackExportView;
  'venture.desk.list': DeskListView;
  'venture.desk.get': DeskItemView;
  'venture.desk.act': DeskActView;
  'venture.ai.options': OnboardingResults['venture.ai.options'];
  'venture.ai.connect': OnboardingResults['venture.ai.connect'];
  'venture.ai.disconnect': OnboardingResults['venture.ai.disconnect'];
  'venture.ai.status': OnboardingResults['venture.ai.status'];
  'venture.ai.calls': OnboardingResults['venture.ai.calls'];
  'venture.compose.decide': OnboardingResults['venture.compose.decide'];
  'venture.compose.fill': OnboardingResults['venture.compose.fill'];
  'venture.compose.get': OnboardingResults['venture.compose.get'];
  'venture.compose.update': OnboardingResults['venture.compose.update'];
};

/** Compile-time guards: payload and result maps cover exactly the method list. */
export const PAYLOAD_MAP_COMPLETE: Same<keyof VenturePayloads, VentureMethod> = true;
export const RESULT_MAP_COMPLETE: Same<keyof VentureResults, VentureMethod> = true;
export const OWNER_MAP_COMPLETE: Same<keyof typeof METHOD_OWNERS, VentureMethod> = true;

// ---------------------------------------------------------------------------
// 11. Errors
// ---------------------------------------------------------------------------

/** Every error code the venture code introduces. All match ^[A-Z_]{1,64}$ so the desktop keeps them. */
export const VENTURE_ERRORS = [
  'EDIT_NOT_FOUND', 'SCRIPT_FILE_REQUIRED', 'WORD_TIMES_REQUIRED',
  'SUPPORT_THREAD_INVALID', 'SUPPORT_TICKET_NOT_FOUND',
  'INTERNAL_ORDER', 'SELLER_INPUT_INVALID',
  'CLIENT_BALANCE_REQUIRED', 'CLIENT_LEDGER_REQUIRED', 'PLAYBOOK_ROUTE_INVALID', 'PLAYBOOK_WORKFLOW_CHANGED',
  'PANEL_APPROVAL_REQUIRED', 'PANEL_NOT_FOUND', 'PANEL_ORDER_REQUIRED', 'SITE_CHECK_DESKTOP_ONLY', 'SITE_CHECK_INVALID',
  'INVALID_VENTURE_REQUEST', 'INVALID_AMOUNT', 'INVALID_TAX_RATE', 'INVALID_TAX_ID', 'VENTURE_NOT_FOUND', 'VENTURE_EXISTS', 'UNKNOWN_COUNTRY',
  'CURRENCY_CONFLICT', 'NOT_BUILT_YET', 'APP_APPROVAL_REQUIRED', 'APPROVAL_STALE', 'INTERVIEW_DONE', 'INTERVIEW_INCOMPLETE', 'QUESTION_NOT_FOUND',
  'BLUEPRINT_NOT_FOUND', 'BLUEPRINT_NOT_ACCEPTED',
  'NO_MODEL_CONNECTED', 'MODEL_CONSENT_REQUIRED', 'MODEL_KEY_MISSING', 'MODEL_OUTPUT_REJECTED', 'MODEL_REFUSAL', 'MODEL_INCOMPLETE',
  'MODEL_FAILED', 'MODEL_TIMEOUT', 'BUDGET_REACHED', 'CLIENT_DATA_NEEDS_APPROVAL', 'SEND_DISABLED', 'FIXTURE_MISSING', 'CLI_UNAVAILABLE', 'PRESET_UNAVAILABLE',
  'PRICE_REQUIRED', 'OFFER_NOT_FOUND', 'CLIENT_NOT_FOUND', 'ORDER_NOT_FOUND', 'INVOICE_NOT_FOUND', 'INVOICE_NOT_DRAFT', 'PAYMENT_TOO_LARGE',
  'RECEIPT_NOT_FOUND', 'BRIEF_NOT_FOUND', 'BRIEF_LINT_FAILED', 'HANDOFF_NOT_FOUND', 'REPO_NOT_LINKED', 'INVALID_REPO', 'TOKEN_NOT_FINE_GRAINED',
  'GITHUB_UNAUTHORIZED', 'GITHUB_NOT_FOUND', 'GITHUB_RATE_LIMITED', 'GITHUB_READ_FAILED',
  'PLAYBOOK_NOT_FOUND', 'SCENARIO_NOT_FOUND', 'SIMULATION_NOT_FOUND', 'SIGNAL_NOT_FOUND',
  'LAUNCH_STAGE_BLOCKED', 'STAGE_PLANNED', 'DELIVERY_NOT_FOUND', 'DELIVERY_NOT_WAITING', 'DELIVERY_NOT_READY', 'PRACTICE_DRAFT',
  'INVALID_EXTERNAL_URL', 'EXTERNAL_URL_NOT_ALLOWED',
  // The hosted web server's per-account rate limits (platform/runtime/hosted/limits.ts) reach model calls through the transport.
  'RATE_LIMITED',
  'UPLOAD_NOT_FOUND', 'UPLOAD_LIMIT', 'UNSUPPORTED_UPLOAD', 'WORK_RECEIPT_NOT_FOUND', 'DELIVERY_NOT_ASKING',
  'TOOL_DENIED', 'TOOL_INPUT_INVALID', 'TOOL_FAILED', 'TOOL_TIMEOUT', 'TOOL_SKIPPED', 'TIER_UNAVAILABLE', 'PROGRAM_INVALID', 'SANDBOX_FAILED', 'HARNESS_LIMIT',
  'IMPROVEMENT_NOT_FOUND', 'IMPROVEMENT_NOT_READY', 'CANDIDATE_STALE',
  'DELIVERY_NOT_BRIEFING', 'DELEGATE_DECLINED', 'DELEGATE_FAILED', 'DELEGATE_RUN_NOT_FOUND',
  // Onboarding v2: the composer before the vault
  'COMPOSE_NOT_FOUND', 'COMPOSE_REFUSED', 'COMPOSE_NOT_A_SERVICE',
  // Evidence ledger (P2-evidence): weaker evidence over a verified value, and an unknown item
  'EVIDENCE_WEAK', 'EVIDENCE_NOT_FOUND',
  // Spend (P2-spend): unpriced calls, the monthly cap, the charge record, and quotes bound to draft, figure and payer
  'SPEND_UNPRICED', 'SPEND_CAP', 'SPEND_ALREADY_CHARGED', 'QUOTE_WAITING', 'QUOTE_CHANGED', 'QUOTE_EXPIRED',
  // Connectors (P2-connectors): posts, staged website edits, the bank shape, leads and clip rights
  'POST_NOT_FOUND', 'POST_ALREADY_DECIDED',
  'SITE_EDIT_NOT_FOUND', 'SITE_EDIT_UNCHANGED', 'SITE_CHANGED_SINCE_REVIEW', 'SITE_WRITE_NOT_GRANTED', 'SITE_PATH_INVALID',
  'BANK_CONSENT_EXPIRED', 'BANK_POLL_LIMIT', 'BANK_STATEMENT_INVALID',
  // Bank statements into the books (Ink v2 wave 2, 2D): a row or account not found, decided once, transfers and directions
  'BANK_TRANSACTION_NOT_FOUND', 'BANK_ACCOUNT_NOT_FOUND', 'BANK_ALREADY_APPLIED', 'BANK_OWN_TRANSFER', 'BANK_NOT_MONEY_IN', 'BANK_NOT_MONEY_OUT',
  'LEADS_SOURCE_REQUIRED', 'LEADS_EMAIL_UNVERIFIED', 'LEADS_BLOCKED', 'LEADS_ADDRESS_MISSING',
  'RIGHTS_REQUIRED',
  // Ink frontend views (P1-A): runs, agents and the always-ask floor on agent gates
  'RUN_NOT_FOUND', 'AGENT_NOT_FOUND', 'STEP_NOT_FOUND', 'GATE_FLOOR',
  // Leads as engine methods: a lead id that is not in this business
  'LEADS_NOT_FOUND',
  // Lead stages (W1 H8): forward only, and won or lost stay as they are
  'LEADS_STAGE_BACKWARD', 'LEADS_STAGE_CLOSED',
  // Action journal (P2-journal): decide-once, expiry, bound single-use tokens, the idempotency key, shadow, unknown outcomes
  'JOURNAL_NOT_FOUND', 'JOURNAL_ALREADY_DECIDED', 'JOURNAL_EXPIRED', 'JOURNAL_TOKEN_INVALID', 'JOURNAL_TOKEN_USED', 'JOURNAL_KEY_REUSED',
  'JOURNAL_SHADOW', 'JOURNAL_OUTCOME_UNKNOWN',
  // Settling an unknown outcome (W1 H3), and a send to a model that broke part way, so it may have happened (W1 H15)
  'JOURNAL_NOT_UNKNOWN', 'MODEL_OUTCOME_UNKNOWN',
  // Posture (P2-posture): a policy that waits for the owner or blocks, and a spot check that is not there
  'POLICY_ASK', 'POLICY_DENIED', 'SPOT_CHECK_NOT_FOUND',
  // The untrusted screen (W1 H9): content held for the owner, a screen that could not check, a release of content not held
  'UNTRUSTED_HELD', 'SCREEN_FAILED', 'UNTRUSTED_NOT_HELD',
  // AI-native CA firm (P3-ca-firm): the CA of record, rate tables the CA confirms, cases not modelled, and tax inputs
  'CA_OF_RECORD_REQUIRED', 'CA_MEMBERSHIP_MISMATCH', 'SIGNOFF_NOT_FOUND', 'RATE_TABLE_MISSING', 'RATE_UNCONFIRMED', 'NOT_MODELLED', 'TAX_INPUT_INVALID',
  // CA gates (W1 H1, H7): regulated papers wait for the CA's sign-off; a date past every rate table's window is stale
  'CA_SIGNOFF_REQUIRED', 'RATE_TABLE_STALE',
  // Ink final pass: a Today row that is gone, an agent posture looser than the business stage, and client share links
  'QUEUE_ITEM_NOT_FOUND', 'POSTURE_ABOVE_STAGE', 'SHARE_NOT_FOUND', 'SHARE_LINK_REFUSED', 'SHARE_LINK_EXPIRED',
  // The network guard (W1 H16): a refused address or scheme, a failed lookup, redirects, size and time
  'NET_URL_REFUSED', 'NET_ADDRESS_REFUSED', 'NET_LOOKUP_FAILED', 'NET_REDIRECT_REFUSED', 'NET_TOO_MANY_REDIRECTS', 'NET_RESPONSE_TOO_LARGE',
  'NET_TIMEOUT', 'NET_FAILED',
  // The run's spend cap held before each call (W1 H4), and the gate again just before an approved action (W1 H13)
  'RUN_CAP_REACHED', 'RUN_CAP_NOT_REACHED', 'ORDER_NOT_ACTIVE', 'CLIENT_NOT_ACTIVE', 'RECHECK_FAILED',
  // Posting safety (W1 H6, H19): a post only from a checked, approved, unchanged draft; a channel held by a check or a block
  'POST_DRAFT_UNCHECKED', 'POST_CLIENT_NOT_APPROVED', 'POST_DRAFT_CHANGED', 'CHANNEL_CHALLENGED', 'CHANNEL_FROZEN',
  // The judge on real orders and going back a playbook version (Ink v2 wave 2, 2C1)
  'JUDGE_NOT_READY', 'JUDGE_NOT_WAITING', 'JUDGE_ALREADY_SENT', 'ROLLBACK_NOTHING', 'ROLLBACK_STALE',
  // Posting methods (Ink v2 wave 2, 2B1): a draft the owner has not approved, an id that names no post, a thread, the
  // house risk gate, a client's answer recorded twice, and an owner's posting limit looser than Chausar's own
  'POST_NOT_APPROVED', 'POST_NOT_A_POST', 'POST_THREAD_NOT_BUILT', 'POST_RISK_BLOCKED', 'ALREADY_DECIDED', 'POSTING_LIMIT_LOOSER',
  // A transcript made on this computer (Ink v2 wave 2, 2E2): ffmpeg or whisper.cpp missing, one already there, a failed run
  'TRANSCRIBE_NOT_AVAILABLE', 'TRANSCRIPT_EXISTS', 'SPEECH_FAILED', 'TRANSCRIBE_STOPPED',
  // Honest browser steps (Ink v2 wave 2, 2B2): signed out for a check, a check that could not run, a refused page script
  'POSTING_NOT_SIGNED_IN', 'POSTING_STEPS_NOT_CHECKED', 'PAGE_SCRIPT_REFUSED',
  // The calendar file (Ink v2 wave 2, 2F2): a draft that is not a social one, an order with no calendar to plan slots from
  'CALENDAR_NOT_A_SOCIAL_DRAFT', 'CALENDAR_NO_SLOTS',
  // Ink v2 wave 4 (named by package 4-0 from the package texts). Departments, Keeper and health (4A1)
  'DEPARTMENT_MISSING', 'AGENT_QUARANTINED', 'AGENT_IS_CODE',
  // Agent chat, "from now on" changes, versions and notes (4B1, 4B2)
  'CHAT_CONSENT_REQUIRED', 'CHAT_CONSENT_STALE', 'CHAT_KEY_REFUSED', 'PATCH_OWNER_OP', 'PATCH_NOT_YOUR_STEP',
  'PROPOSAL_STALE', 'PROPOSAL_DECIDED', 'UNDO_NOTHING', 'UNDO_CONFLICT', 'NOTE_CHANGED', 'NOTES_FULL',
  // Chats and proposals (4C1)
  'TOOL_NOT_ALLOWED', 'PROPOSAL_KIND_UNKNOWN', 'PROPOSAL_NOT_ALLOWED',
  // The owner's network, search, the pipeline and outreach (4D1 to 4E3)
  'NETWORK_FILE_TOO_LARGE', 'NETWORK_FILE_INVALID', 'NETWORK_ALREADY_IMPORTED', 'NETWORK_TRAIT_PROTECTED', 'RESEARCH_HOST_REFUSED',
  'PIPELINE_STAGE_BACKWARD', 'PIPELINE_STAGE_CLOSED', 'PIPELINE_EVIDENCE_REQUIRED', 'PIPELINE_BLOCKED', 'PIPELINE_TRIGGER_REQUIRED', 'PIPELINE_NOT_A_QUOTE',
  'OUTREACH_NO_CONFIRMED_PATH', 'OUTREACH_TOO_LONG', 'OUTREACH_BLOCKED', 'OUTREACH_BASIS_REQUIRED', 'OUTREACH_EXCLUDED_SERVICE', 'NEVER_CONTACT_LOST',
  'OUTREACH_NO_PHONE', 'OUTREACH_NO_PROFILE', 'OUTREACH_WHATSAPP_COLD', 'OUTREACH_DAILY_CAP', 'MAILBOX_OAUTH_ONLY',
  // 4E3: a mailbox that refused the app password, one not connected (or whose password is not loaded), one that failed
  'MAILBOX_LOGIN_FAILED', 'MAILBOX_NOT_CONNECTED', 'MAILBOX_FAILED',
  // Run controls, breakers, write caps and who pays (4F1, 4F2)
  'RUN_NOT_RUNNING', 'RUN_ALREADY_STOPPED', 'RUN_NOT_STOPPED', 'RUN_SUPERSEDED', 'BUSINESS_PAUSED', 'RUN_CAPABILITY_MISSING', 'WRITE_CAP_REACHED', 'PAYER_AMBIGUOUS',
  // Notifications and push (4G1, 4G3), the CLI status (4H1), goals (4I1)
  'NOTIFY_PAUSE_TOO_LONG', 'PUSH_ENDPOINT_REFUSED', 'PUSH_NOT_SUBSCRIBED', 'CLI_FLAGS_UNSUPPORTED', 'GOAL_INVALID', 'GOAL_MONTH_PAST',
  // Approvals, edits and set approval (4J1, 4J2)
  'ALLOW_SESSION_FLOOR', 'FILE_CHANGED', 'SEND_BACK_EMPTY', 'UNDO_TOO_LATE', 'UNDO_OUTSIDE_EFFECT', 'SET_KIND_REFUSED', 'SET_NEEDS_PICK',
  // Previews, money views, bills and credits (4J3 to 4J5)
  'POSTER_NOT_AVAILABLE', 'EXPORT_EXISTS', 'PAGING_LOOP', 'BILL_PAYMENT_TOO_LARGE', 'QUOTE_ALREADY_INVOICED', 'CREDIT_TOO_LARGE',
  // Connector truth, file requests and the owner profile (4J7, 4J9)
  'CONNECTOR_FIELD_UNSUPPORTED', 'ROUTINE_NEEDS_CHECK', 'SHARE_USED', 'SHARE_EXPIRED', 'OWNER_NAME_INVALID',
  // The chained journal and journalled-action extras (4J10), execution places (4J11), step edges and contracts (4J12)
  'JOURNAL_CORRUPT', 'ACCOUNT_FENCE', 'ACTION_DENYLISTED', 'DELEGATE_BUSY', 'PLAYBOOK_CYCLE_UNCAPPED', 'ORDER_CONTRACT_UNSIGNED', 'CONTRACT_FIELD_LOCKED',
  // 4J12 (H25): an agent-to-agent message past a cascade cap, or to someone an agent may not message or hand back to
  'AGENT_RELAY_CAPPED', 'AGENT_RELAY_REFUSED',
  // 4J10: an end state before applied, verified without a dated check, an action waiting for the one it depends on
  'JOURNAL_NOT_APPLIED', 'JOURNAL_CHECK_UNDATED', 'JOURNAL_WAITING',
  // 4J11 (H33): a mock provider or a typed mock tool asked for on a real run (they serve tests and practice only)
  'MOCK_REAL_RUN',
  // Routines (4J13), the locked auto gate (4J15), NEEDS_FACTS (4J16), personas and questions (4J17), the hosted trial (4J23)
  'ROUTINE_NOT_STANDALONE', 'ROUTINE_NOT_YOURS', 'AUTO_LOCKED', 'NEEDS_FACTS', 'PERSONA_FIELD_REFUSED', 'QUESTION_HAS_APPROVAL', 'TRIAL_LIMIT',
  // Ideas (4J18): an idea with no record behind it, and one whose records no longer hold it
  'IDEA_NO_EVIDENCE', 'IDEA_RETIRED',
  // Ink v2 wave 5, 5A3: a dated rule, manual path, recipe or boundary a playbook cannot rest on; a rule a CA or lawyer
  // has not confirmed, on a client's work; the idea pipeline's refusals (unknown idea, a move back, a drop without a
  // reason, a grade before it was published or before its seven days)
  'RULE_INVALID', 'RULE_UNCONFIRMED', 'MANUAL_PATH_MISSING', 'RECIPE_INVALID', 'BOUNDARY_INVALID',
  'IDEA_NOT_FOUND', 'IDEA_STAGE_BACKWARD', 'IDEA_DROP_REASON', 'IDEA_NOT_PUBLISHED', 'IDEA_GRADE_EARLY',
  // 4J2 review: a copy of a draft that has not gone out, a set item never read in this version, a set that asks twice
  // without its second answer, and a settings draft holding a key, card or account number
  'COPY_NOT_SENT', 'VIEW_FIRST', 'SET_NEEDS_SECOND_ASK', 'DRAFT_HOLDS_SECRET',
  // Ink v2 wave 5, 5A1: a kit definition that breaks a rule, and a kit order missing a required intake field
  'PLAYBOOK_DEFINITION_INVALID', 'INTAKE_FIELD_REQUIRED',
  // 5M: exact owner-approved research, source permissions, channel limits and paid lookup outcomes.
  'APPROVAL_CHANGED', 'CITY_NOT_FOUND', 'COLD_CHANNEL_REFUSED', 'COMMUNITY_OWNER_SOURCE_REQUIRED', 'COMMUNITY_QUOTE_MISSING', 'HAPPENSTANCE_SEARCH_UNCONFIRMED', 'KEY_REQUIRED', 'LEAD_HOST_CHANGED', 'LEAD_INTAKE_CHANGED', 'LEAD_RATE_STALE', 'LEAD_SOURCE_UNAVAILABLE', 'PRODUCT_CONFIRM_REQUIRED', 'WHATSAPP_CONSENT_REQUIRED',
  // Ink v2 wave 5, 5A2: share prices (no recorded base, a base without its file, a share outside 0.01% to 100%); the
  // pilot (a window outside 2 to 6 weeks, no price, an offer that is not a pilot); the sales proposal (an unpriced
  // offer, none found, a check that failed); an ask wholly outside what the business does
  'SHARE_BASE_MISSING', 'SHARE_BASE_UNPROVEN', 'INVALID_SHARE', 'PILOT_WINDOW', 'PILOT_UNPRICED', 'PILOT_NOT_OFFERED',
  'OFFER_UNPRICED', 'PROPOSAL_NOT_FOUND', 'PROPOSAL_CHECKS_FAILED', 'OUTSIDE_SCOPE',
  // Ink v2 wave 5, 5A6: the fetch policy and robots.txt; monitors; the owner's local apps; publish tiers' quota; the
  // webhook handoff; mail files; speech out (no dated price, quote first, a voice without a licence or consent)
  'FETCH_POLICY_REFUSED', 'FETCH_DISGUISE_REFUSED', 'ROBOTS_REFUSED', 'MONITOR_NOT_FOUND', 'MONITOR_LIMIT',
  'LOCAL_APP_NOT_FOUND', 'LOCAL_APP_UNAVAILABLE', 'LOCAL_APP_REFUSED', 'LOCAL_APP_FAILED', 'LOCAL_APP_NEEDS_YOU', 'QUOTA_REACHED',
  'WEBHOOK_NOT_SET', 'WEBHOOK_REFUSED', 'MAIL_FILE_TOO_LARGE', 'MAIL_FILE_UNREADABLE',
  'UNPRICED_CALL', 'QUOTE_FIRST', 'VOICE_NOT_ALLOWED', 'SPEECH_PLANNED', 'SPEECH_TOO_LONG',
  // Ink v2 wave 5, 5A4: asset records (an unknown licence, not found, not made yet, a rerun or reuse refused), a clip
  // still holding its location data, voice consent (none current, withdrawn, not found, another voice than the step
  // named), and a derived unit whose source changed
  'ASSET_LICENCE_UNKNOWN', 'ASSET_NOT_FOUND', 'ASSET_NOT_MADE', 'ASSET_REFUSED', 'MEDIA_NOT_CLEAN',
  'CONSENT_REQUIRED', 'CONSENT_WITHDRAWN', 'CONSENT_NOT_FOUND', 'VOICE_MISMATCH', 'DERIVED_STALE',
] as const;
export type VentureErrorCode = typeof VENTURE_ERRORS[number];

// ---------------------------------------------------------------------------
// 12. Handler tables and dependencies (implemented by packages, wired by P0 and P6)
// ---------------------------------------------------------------------------

/**
 * network:forget: the key of the forgotten list's one-way check (4D1), derived from the vault's own key when it opens.
 * mailbox:password: the owner's mailbox app password (4E3); network:calendar: their private calendar address (4E3).
 * Both are held only while the app is open, as the model keys are, and never in a record, an export or a log.
 * receipt:signing: the seed of the business's receipt signing key (4J10), derived from the vault's own key when it opens.
 * journal:head: the key of the HMAC on the journal's pinned head and the first signing time (4J10), derived the same way.
 */
export type SecretName = `model:${ModelPresetId}` | `github:${string}` | 'network:forget' | 'mailbox:password' | 'network:calendar' | 'receipt:signing' | 'journal:head'
  // 5A6: the owner's n8n or Make webhook address (it is a key in itself), and a speech provider's key, held the same way.
  | `webhook:${WebhookKind}` | `speech:${string}`;
/** Memory-only secrets. Never written to state, logs, payloads or the renderer. Cleared on lock. */
export interface SecretShelf {
  get(name: SecretName): string | null;
  set(name: SecretName, value: string): void;
  delete(name: SecretName): void;
  has(name: SecretName): boolean;
  clear(): void;
}

/** The narrow slices of existing engine services the venture packages may call. */
export type VentureEngineServices = {
  calculator: { calculate(ctx: Context, request: Record<string, unknown>): Promise<any>; receipt(ctx: Context, id: string): any };
  ontology: { current(ctx: Context): any; publish(ctx: Context, draft: any): Promise<any> };
  trust: { updatePolicy(ctx: Context, patch: Record<string, unknown>): Promise<any> };
  /** The trusted Python helper (platform/runtime/helper.ts). Delivery agents use only its PDF text extraction, never on the hosted web server. */
  helper?: { run(operation: 'pdf.extract', input: { pdfBase64: string; maxPages?: number }): Promise<{ result: any; receipt: any }> };
  /**
   * The speech service (platform/runtime/speech.ts): a transcript made on this computer by the owner's own whisper.cpp,
   * set up with full paths. It never installs, downloads a model or uploads. YouTube orders use it (Ink v2 wave 2, 2E2).
   */
  speech?: {
    localTranscriber(): { ready: true; providerId: string } | { ready: false; reason: string };
    localTranscriptionFiles?(ctx: Context): { providerId: string; command: string; model: string } | null;
    transcribeFile(ctx: Context, input: { path: string; prompt?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ srt: string; providerId: string }>;
    /** Puts in place (or removes, with null) the whisper.cpp the owner set up in the app (venture.transcription.set). */
    useLocal(setup: { command: string; model: string } | null): void;
  };
};

export type VentureStorage = 'experimental-file' | 'postgres';
/** Where the engine runs: the desktop window, local web mode, the experimental hosted web server, or a test. */
export type VentureHostKind = 'desktop' | 'local-web' | 'hosted-web' | 'test';
/**
 * Whether money screens say "practice": with file storage anywhere, and on the hosted web server with any storage until
 * a real deploy has been tested (docs/venture/hosted.md).
 */
export function experimentalStorage(deps: { storage: VentureStorage; host: VentureHostKind }): boolean {
  return deps.storage === 'experimental-file' || deps.host === 'hosted-web';
}
export type VentureDeps = {
  seoWebsiteChecker?: { run(url: string, signal?: AbortSignal): Promise<unknown> } | null;
  store: StateStore;
  clock: () => Date;
  models: ModelPort;
  services: VentureEngineServices;
  github: GitHubTransport;
  secrets: SecretShelf;
  host: VentureHostKind;
  demo: boolean;
  storage: VentureStorage; // 'experimental-file' means every money screen shows the experimental notice
  /** The container tier's Docker port. Absent means the real one, which spawns docker only when Docker is present, and never on the hosted web server. */
  sandbox?: SandboxPorts;
  /** Heavy work's port. Absent means the real one on the desktop and in local web mode, and none anywhere else. */
  delegate?: DelegatePorts;
  /** The engine's draft desk, so venture.create can adopt the AI and plan made before the vault. Absent on hosted. */
  draft?: DraftHandoverPort;
  /** Whether Chausar has accepted Anthropic's terms for running Claude Code. Absent means 'pending'. */
  claudeCodeTerms?: 'accepted' | 'pending';
  /** Posting ports. Absent means the real ones: a Playwright probe that installs nothing, and no API clients. */
  connectors?: ConnectorPorts;
  /** The businesses on this computer, for Today's queue across businesses. Trusted host composition; absent in most tests. */
  workspace?: VentureWorkspacePort;
  /** The website folder on this computer that staged edits apply to. Trusted host composition, never a payload; never on hosted. */
  siteFolder?: string;
  /** The mail server lookup for lead emails. Absent means node:dns; tests inject a table. */
  mx?: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  /** The ffmpeg that takes the sound out of a cut for a transcript made here. Absent means the one on PATH; never on hosted. */
  ffmpeg?: FfmpegPort;
  /** Trusted host composition: the engine stops long local work through it when the workspace closes (VentureClosingPort). */
  closing?: VentureClosingPort;
  /** The network guard's lookup and sender for requests the engine makes itself (bank alert counts). Absent means the real ones; tests inject stubs. */
  net?: { resolve?: NetResolver; send?: PinnedSender; tls?: TlsConnector };
  /** Called once with the events a venture action committed, after the commit. A listener's failure never undoes it. */
  publish?: (events: VentureEventRecord[]) => void;
  /**
   * The hosted web server's public origin (CHAUSAR_PUBLIC_URL, equal to the hosted origin), for client share links.
   * Trusted host composition, never a payload; only on the hosted web server. Absent: share links get no address.
   */
  publicUrl?: string;
  /**
   * Ink v2 wave 4 (4G1): when the owner last had Chausar open (the desktop window, or an owner's event stream); now
   * while one is. Alerts outside the app wait while the owner watches and for 2 minutes after. Absent or null: unknown.
   */
  watching?: () => IsoTime | null;
  /** Ink v2 wave 4 (4G3): the hosted app's web push key. Only on the hosted web server; absent, phone alerts say so. */
  push?: WebPushPort;
  /**
   * Ink v2 wave 4 (4G3): the owner's own context inside the app (the engine's base context, as its tick uses), for work
   * that runs under the owner's standing setting whoever's request started it: a phone alert. Trusted host composition.
   */
  ownerContext?: () => Context;
  /**
   * Ink v2 wave 4 (4G3): hashes of hosted sessions the account lists as signed out or revoked, whose browsers' records
   * may not be deleted yet; such a browser gets nothing. Trusted host composition, hosted only.
   */
  endedSessions?: () => readonly string[];
  /**
   * Ink v2 wave 4 (4D3): a public web search, for a network search's "Also look outside my network" and "Before you
   * write". Trusted host composition; no host composes one yet, so both say plainly that web search is not set up here.
   */
  webSearch?: WebSearchPort;
  /**
   * Ink v2 wave 4 (4J23): whether this business is temporary, started on the hosted app without an account and not yet
   * claimed. Asked at each write of a refused record: while true, ventureAction refuses an issued invoice, a payment,
   * an issued credit note, a paid bill, a client share link, a file request and an alert address (TRIAL_LIMIT). The
   * trial's size cap is held by the hosted vault store itself. Only on the hosted web server; absent: never temporary.
   */
  trial?: () => boolean;
  /** Ink v2 wave 5 (5A5): the desktop's printer for a report's PDF (Electron's printToPDF). Never on hosted; absent: no PDF. */
  print?: PrintPort;
  /** 5A6 (K13): the owner's own programs on PATH (build/local-apps.ts). Absent means the real one; never on hosted. */
  localApps?: LocalAppPort;
};

/**
 * 4D3. A public web search the host may give the engine: for one query, up to limit public pages, each with its
 * address, title and the search's own snippet. Chausar opens no page through it; "Before you write" reads a page only
 * through the network guard, and never a LinkedIn or other personal profile page. A host that composes one must first
 * show the owner a consent that names the search provider and what is sent to it (the owner's own words for a search;
 * a person's name and company for "Before you write"), and compose the port only once the owner agrees.
 */
export type WebSearchPort = { search(query: string, options: { limit: number }): Promise<{ url: string; title: string; snippet: string }[]> };

export type VentureHandler<M extends VentureMethod> = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<VentureResults[M]>;
export type VentureHandlerTable = { [M in VentureMethod]?: VentureHandler<M> };

/** What P6's host passes to P2's createModelPort. */
export type ModelPortOptions = {
  store: StateStore;
  clock: () => Date;
  transport: ModelTransport;
  secrets: SecretShelf;
  host: VentureHostKind;
  demo: boolean;
  codexCli?: unknown; // { capabilities, mode } from the trusted Codex host profile, when present
  /** The Claude Code terms gate; absent is 'pending'. */
  claudeCodeTerms?: 'accepted' | 'pending';
  /** 4H1: finds a command on this computer's search path (an absolute one where it says). Absent means the real search; tests inject one. */
  locateCli?: (command: string) => string | null;
};

/** Options the engine passes to the venture host. host-env.ts fills the plain fields; tests inject transports. */
export type VentureHostOptions = {
  modelTransport?: ModelTransport;
  /** A transport, or a factory the host calls once with its store (fixtures use it to fill {{briefId}}). */
  githubTransport?: GitHubTransport | ((store: StateStore) => GitHubTransport);
  /** Replay files; host-env.ts sets them only in demo mode with CHAUSAR_VENTURE_REPLAY=1 or --replay. host.ts reads them lazily. */
  modelReplayPath?: string;
  githubReplayPath?: string;
  clock?: () => Date;
  host?: VentureHostKind;
  codexCli?: unknown; // { capabilities, mode } from the trusted Codex host profile, when present
  hostProcess?: (request: any) => Promise<any>; // the trusted host's verified process port (the gateway's process), when present
  sandbox?: SandboxPorts; // tests inject a Docker port; the real one is used otherwise
  delegate?: DelegatePorts; // tests inject a port to a fake command-line tool
  /** Trusted host composition, never from a payload: the engine's draft desk handover. */
  draft?: DraftHandoverPort;
  /** From CHAUSAR_CLAUDE_CODE_TERMS ('accepted' opens it). Absent or anything else is 'pending': Claude Code needs setup. */
  claudeCodeTerms?: 'accepted' | 'pending';
  /** Trusted host composition, never from a payload: the businesses on this computer (VentureWorkspacePort). */
  workspace?: VentureWorkspacePort;
  /** From CHAUSAR_SITE_FOLDER on this computer (an absolute path): the website folder staged edits apply to. */
  siteFolder?: string;
  /** Trusted host composition: receives the run events each venture action committed, for the desktop push and /api/events. */
  notify?: (events: VentureRunEvent[]) => void;
  /** Trusted host composition (4G1): when the owner last had Chausar open, now while they do (VentureDeps.watching). */
  watching?: () => IsoTime | null;
  /** Trusted host composition (4G3): the hosted app's web push key. Used only when host is 'hosted-web'. */
  push?: WebPushPort;
  /** Trusted host composition (4G3): the owner's own context inside the app (VentureDeps.ownerContext). */
  ownerContext?: () => Context;
  /** Trusted host composition (4G3): hashes of sessions the account lists as ended (VentureDeps.endedSessions). Hosted only. */
  endedSessions?: () => readonly string[];
  /** The network guard's lookup and sender (VentureDeps.net); tests inject stubs, the real ones are used otherwise. */
  net?: VentureDeps['net'];
  /** The hosted web server's public origin for client share links (CHAUSAR_PUBLIC_URL). Used only when host is 'hosted-web'. */
  publicUrl?: string;
  /** Trusted host composition: the ffmpeg port for a transcript made here (tests inject a stand-in); never on hosted. */
  ffmpeg?: FfmpegPort;
  /** Trusted host composition from the engine: how a workspace closing stops long local work (VentureClosingPort). */
  closing?: VentureClosingPort;
  /** Trusted host composition (4J23): whether this hosted business is temporary (VentureDeps.trial). Hosted only. */
  trial?: () => boolean;
  /** Trusted host composition (5A5): the desktop's report printer over the worker's channel (VentureDeps.print). Never on hosted. */
  print?: PrintPort;
};

/**
 * How the engine stops long local work (a transcript being made) when the workspace locks, closes, switches or the
 * app quits. signal is aborted then; hold() says such work is running and returns its release, so the engine stops it
 * and waits (capped) instead of answering VAULT_BUSY.
 */
export type VentureClosingPort = { readonly signal: AbortSignal; hold(): () => void };
