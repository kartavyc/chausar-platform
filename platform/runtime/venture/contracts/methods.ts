// Venture methods contract. Types only; public imports use ../contracts.ts.
import type { W4_METHODS, W5_METHODS, VENTURE_METHODS, VENTURE_ERRORS } from '../contract-values.ts';
import type { AccountantView } from '../money/accountant.ts';
import type { CaPackScheduleView } from '../money/ca-pack.ts';
import type { TelegramFound } from '../notify/telegram.ts';
import type { ClientAiDefaultView } from '../clients/ai-consent-core.ts';
import type { OnboardingPayloads, OnboardingResults } from '../onboarding-contracts.ts';
import type { BankAlertRuleInput } from '../build/bank.ts';
import type { FamilyId, NeedsList } from '../core/first-run-types.ts';
import type { LayoutPlace, LayoutRequest } from '../views/layout-core.ts';
import type { LayoutChangeResult, LayoutView } from '../views/layout.ts';
import type { FindRequest, FindView } from '../views/find-core.ts';
import type { IntakeValue } from '../playbooks/kit/define.ts';
import type { OrderChainView } from '../playbooks/kit/records-chain.ts';
import type { GoNoGoCardView, GoNoGoInputs, GoNoGoListView, SalesPilotTerms, SalesProposalView } from '../playbooks/kit/records-sales.ts';
import type { IdeaAddedView, IdeaGrade, IdeaGradedView, IdeaMovedView, IdeaStage } from '../playbooks/kit/records-rules.ts';
import type { AssetRerunView, AssetReuseView, AssetsView, BrandKitInput, BrandKitView, VoiceConsentsView, VoiceConsentView } from '../playbooks/kit/records-media.ts';
import type { ReportFormat, ReportListView, ReportShareView, ReportView } from '../playbooks/kit/records-report.ts';
import type { LocalAppsView, MailImportView, MailThreadsView, MonitorInput, MonitorsView, MonitorView, SpeechProvidersView, WebhookView, WebhookSendView } from '../build/records-connect.ts';
import type { CitationsConfirmView, DataPackExportView, DifferentialAddView, SignoffCheckView } from '../playbooks/ca-firm/records.ts';
import type { DeskActPayload, DeskActView, DeskGetPayload, DeskItemView, DeskListPayload, DeskListView } from '../playbooks/desk-types.ts';
import type { CountryCode, CountryProfile } from '../core/country-types.ts';
import type { TalkConsentInput, TalkHeard, TalkSaid, TalkSetupInput, TalkStarted, TalkView } from '../agents/talk-core.ts';
import type { FeedbackAnswerInput, FeedbackConsentInput, FeedbackCrashInput, FeedbackCrashKept, FeedbackView } from '../core/feedback-core.ts';
import type { BlueprintPatch, BlueprintView, InterviewAnswer, InterviewView, IsoDate, IsoTime, Json, MicroString, MinorString, PlanPreview, PricingModel, VentureView } from './business.ts';
import type { ModelCallRecord, ModelPreset, ModelPresetId, ModelPurpose, ModelStatusView, ModelTier } from './models.ts';
import type { BooksPeriodKey, BooksSummary, ClientAiConsentView, ClientRecord, InvoiceView, OrderIntake, OrderListRow, OrderRecord, PaymentMethod, PriceReceiptRecord } from './money.ts';
import type { CurrencyLead, Display, SpendLead, SpendPolicyView, SpendRateInput, SpendRow } from './spend.ts';
import type { AcrossMoneyView, AcrossRunsView, AgentExportFile, AgentHealth, AgentNoteChange, AgentNotesView, AgentProposalDecision, AgentProposalView, AgentRestored, AgentRetired, AgentSendResult, AgentThreadView, AgentVersionUndo, AgingView, AllowSessionView, AllowWritesView, AutoReadinessView, AwayView, BankAlertsView, BankApplyResult, BankLedgerView, BillResult, BillsView, CaDiffExplanation, CaFirmView, CaReceiptView, CaRequestView, CalendarFeedView, CapabilityPageView, CashView, ChatConsentView, ChiefFit, ChiefSendResult, ChiefSettleResult, ChiefThreadStateInput, ChiefThreadStateResult, ChiefThreadSummary, ChiefThreadView, ChiefThreadsView, CliStatusList, ClientListRow, ComplianceView, ConnectorChecksView, CreditNoteView, DecisionsView, DeliveryJudgePreview, DraftChangesView, DraftPostView, DrillRunView, DrillRunsView, FileRequestView, FlowView, FollowupsView, GoalSuggestion, GoalView, GuidanceView, IdeaStarted, IdeasView, InboundListView, InboundView, InvoiceListRow, JournalChainView, JudgeAutoView, KeeperView, KnowledgeSourceInput, KnowledgeSourceView, KnowledgeTestView, KnowledgeView, MailboxSync, MailboxView, MarginsView, MeetingDigestView, MiniAppCallResult, MiniAppCard, MiniAppView, MoneyExportFile, MoneyOverview, NetworkForgotten, NetworkImportResult, NetworkImportUndo, NetworkRecompute, NetworkSearchView, NetworkSourcesView, NotifyListView, NotifySettingsView, OrderContractView, OutreachHandoff, OutreachRestriction, OutreachSentResult, OutreachView, OwnerPostingLimitsView, OwnerView, PauseView, PeopleView, PersonResearch, PersonSplit, PersonSummary, PersonView, PersonaTestView, PersonaView, PhoneAccessView, PipelineCardResult, PipelineEvidenceInput, PipelineSettingsView, PipelineView, PlanSuggestionView, PostingLimitsView, PostingProposal, PostingStepsView, ProposalRaised, ProposalView, PushKeyView, PushStateView, PushSubscriptionInput, QueueSetPreview, QueueSetResult, QueueUndoResult, ReceiptVerifyView, RecurringInvoiceView, RecurringInvoicesView, RelayView, RerankView, RetireCheckView, RoleModelsView, RoutineInput, RoutineRunsView, RoutineSuggestionsView, RoutineView, RoutinesView, RuleLocksView, RulesListView, RunControlResult, SavedSearchView, SettingsDraftSaved, SettingsDraftsView, ShadowSummaryView, ShareAnswerView, ShareKind, ShareLinkView, SocialCalendarFile, StandingOrdersView, SumReceiptRecord, TaxWorkingView, TeamListView, TelegramView, TranscriptionSetupView, TriagePreview, TriageRuleView, VoiceInput, VoiceView, WaysView, WriteCapKind } from './views.ts';
import type { BankConsentView, BankImportResult, BriefFilePlan, BriefRecord, BuildFollowRecord, BuildStatus, BuilderId, ConnectorCard, ConnectorCategory, HandoffPlan, HandoffRecord, LeadView, OutreachDraftView, SiteEditRecord } from './build.ts';
import type { CapabilityStatus, DelegateRunRecord, DeliveryReason, DeliveryRunView, ImprovementRunRecord, ImprovementStatus, LaunchStatus, PlaybookRecord, Scenario, SimulationRunRecord, UploadView, WorkReceiptRecord } from './delivery.ts';
import type { AgentView, CoverageView, EvidenceItem, JournalEntry, Posture, QueueActionId, QueueDecision, QueueItemView, QueueList, RunDetail, RunSummary, VentureEventRecord, VentureRunEvent } from './queue.ts';
import type { BillLineInput, CardVote, InvoiceShareHow, LawfulBasis, LostReason, NetworkImportKind, OpportunityTrigger, OrderContract, OutreachChannel, OutreachKind, OutreachLane, OutreachLanguage, OutreachSentChannel, PersonaFields, PipelineStage, ReceiptSignature, RowFigureReceipt, ScoreRule, TieReceipt, TriageRule, TypedAmount } from './records.ts';

export type W4Method = typeof W4_METHODS[number];

export type W5Method = typeof W5_METHODS[number];

export type VentureMethod = typeof VENTURE_METHODS[number];

/**
 * Ink v2 wave 4 adds agents (4B, 4J13, 4J17, 4J18), chief (4C), network (4D, 4E) and notify (4G). Wave 5 adds playbooks
 * (playbooks/index.ts): the kit's methods, the CA firm's new ones and every business's desk.
 */
export type VenturePackageId = 'core' | 'models' | 'money' | 'build' | 'delivery' | 'views' | 'agents' | 'chief' | 'network' | 'notify' | 'playbooks';

/** The permission a method's handler authorizes at (records.ts authorize and ventureAction). */
export type MethodLevel = 'read' | 'prepare' | 'approve';

type Empty = Record<string, never>;

export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type VenturePayloads = {
  'venture.countries': Empty;
  'venture.preview': { idea: string; countryCode: CountryCode; pricingModel?: PricingModel };
  /** composeId and composedDigest are sent together or not at all; the engine holds the plan itself. */
  'venture.create': { idea: string; countryCode: CountryCode; workingName?: string; composeId?: string; composedDigest?: string; reuseAi?: true };
  'venture.get': Empty;
  'venture.events': { afterSeq?: number; limit?: number };
  'venture.interview.next': { useTemplate?: boolean };
  'venture.interview.answer': { questionId: string; answer: InterviewAnswer };
  /** shown (review of A1, row 3): the plan About you showed, kept on the first template draft; by is who wrote its words. */
  'venture.blueprint.draft': { useTemplate?: boolean; shown?: { name: string; by: 'model' | 'template'; callId?: string; offers: { name: string; line: string }[] } };
  'venture.blueprint.get': Empty;
  /** basedOn (4J8): refused APPROVAL_STALE unless the newest plan is still this one, as a suggestion read it. */
  'venture.blueprint.update': { patch: BlueprintPatch; basedOn?: { blueprintId: string; digest: string }; ownerSave?: true };
  'venture.blueprint.accept': { digest: string };
  'venture.models.presets': Empty;
  'venture.models.connect': { presetId: ModelPresetId; consentDigest: string; apiKey?: string; model?: string; tiers?: ModelTier[]; monthlyCapUsd?: string };
  'venture.models.disconnect': { connectionId: string };
  'venture.models.status': Empty;
  'venture.models.calls': { limit?: number; purpose?: ModelPurpose };
  'venture.price.quote': { offerId: string; quantity?: string };
  'venture.receipt.get': { id: string };
  'venture.client.add': { name: string; email?: string; countryCode?: CountryCode; taxId?: string; stateCode?: string; note?: string };
  'venture.client.aiConsent.get': { clientId: string };
  'venture.agentSettings.get': Empty;
  'venture.agentSettings.set': { settings: import('../agent-runtime/settings.ts').AiSettings; approveMcpConfiguration?: true };
  'venture.mcpCredential.set': { serverId: string; token: string | null };
  'venture.mcpRegistry.list': Record<string, never>;
  'venture.mcpOAuth.start': { serverId: string };
  'venture.packs.list': Record<string, never>;
  'venture.packs.add': { pack: unknown; digest?: string };
  'venture.packs.remove': { packId: string };
  'venture.client.aiConsent.agree': { clientId: string; disclosureDigest: string };
  'venture.client.aiConsent.withdraw': { clientId: string };
  'venture.billing.get': Empty;
  'venture.billing.set': Partial<Omit<import('../money/billing-types.ts').BillingSettings, 'razorpay' | 'bank' | 'dueInDays' | 'reminderDays'>> & { dueInDays?: number | string; reminderDays?: (number | string)[]; bank?: Pick<import('../money/billing-types.ts').BankDetails, 'accountName' | 'accountNumber'> & Partial<Omit<import('../money/billing-types.ts').BankDetails, 'accountName' | 'accountNumber'>> | null; razorpayKeys?: { keyId: string; keySecret: string } | null };
  'venture.invoice.pdf': { invoiceId: string };
  'venture.payment.receipt': { paymentId: string };
  'venture.invoice.payLink': { invoiceId: string; action: 'create'; digest: string } | { invoiceId: string; action: 'check' };
  'venture.client.list': Empty;
  /** intake: only for a flagship playbook's offer; an offer that cuts footage needs intake.rights (delivery/rights.ts). */
  'venture.order.create': {
    clientId?: string; offerId: string; quantity?: string; request: string;
    /** One-shot A1 (row 10): a client typed with the order, written with it or not at all; never with clientId. */
    newClient?: VenturePayloads['venture.client.add'];
    /** Wave 6: when the whole order is due (6D1); a client abroad's currency and the owner's price in it (6D4). */
    dueDate?: IsoDate; currency?: string; unitPrice?: string;
    intakeFiles?: Record<string, { name: string; contentBase64: string }>;
    intake?: { calendar?: { month: string; channels: string[]; postsPerChannel: number; weekdays: number[] }; clientRules?: Partial<NonNullable<OrderIntake['clientRules']>>; rights?: unknown; format?: 'long' | 'short'; aiVoice?: boolean; aiPresenter?: boolean; paidPromotion?: boolean; cutFile?: string; fields?: Record<string, IntakeValue>; moneyAmounts?: Record<string, string> };
    /** 4J5 (M15): the price includes the tax. */
    taxInclusive?: boolean;
  };
  'venture.order.list': Empty;
  'venture.order.deliver': { orderId: string; deliveredOn: IsoDate };
  'venture.invoice.prepare': { orderId: string; dueInDays?: number; issueDate?: IsoDate; reminderDays?: number[]; part?: { kind: 'advance' | 'milestone' | 'partial' | 'final'; label?: string; percent?: string; amount?: string } };
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
    /** C5 task 15: use the reference rate shipped with this release; not together with inrPerUsd. */
    useReference?: true;
    capUsd?: string | null; askFirstUsd?: string | null; cap?: MicroString | null; askFirst?: MicroString | null; rates?: SpendRateInput[]; inrPerUsd?: string | null;
    /** W6 6G5: each routine's own monthly limit in US dollars; the list replaces the one in force. */
    routineCaps?: { routine: string; capUsd: string }[];
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
  'venture.launch.advance': { to: 'practice' | 'live' };
  'venture.delivery.run': { orderId: string; useTemplate?: boolean };
  'venture.agentApproval.decide': { runId: string; digest: string; decision: 'approve' | 'deny'; content?: Record<string, unknown> };
  'venture.delivery.review': { runId: string; verdict: 'accepted' | 'edited' | 'rejected'; reason?: DeliveryReason; editedText?: string };
  'venture.delivery.list': Empty;
  'venture.capabilities': Empty;
  'venture.files.add': { orderId: string; name: string; contentBase64: string };
  'venture.files.list': { orderId?: string };
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
  'venture.rules.locks': Empty;
  'venture.rules.attest': { ruleId: string; attest: boolean; digest?: string };
  /** size: picked ranges to judge the verdicts by, kept nowhere. */
  'venture.compliance.get': { profession?: string; size?: { turnover?: string; headcount?: string } };
  /** size alone changes only the size answer (Business settings); with the side-work answer, left out keeps the saved one. */
  'venture.compliance.set': { profession: string; sideWork: 'no-day-job' | 'allowed' | 'not-allowed' | 'not-sure'; digest: string; size?: { turnover?: string; headcount?: string } } | { size: { turnover?: string; headcount?: string } };
  'venture.judge.auto.get': Empty;
  /** auto: true runs the judge on its own on every ready draft for a client or the public, and records the consent. */
  'venture.judge.auto.set': { auto: boolean };
  'venture.posting.limits.get': Empty;
  /** limits: owner-set numbers; a number left out uses Chausar's default. */
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
  'venture.pipeline.settings': { weekdays?: number[]; sendTime?: string; caps?: { newPerDay?: number; perWeek?: number; channels?: Partial<Record<OutreachLane, number>>; channelWeeks?: Partial<Record<OutreachLane, number | null>>; warmupPercent?: number[] }; scoreRules?: ScoreRule[] };
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
  /** C4 task 40: { clear: true } clears the days away now. */
  'venture.away.set': { from: IsoDate; to: IsoDate } | { clear: true };
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
  'venture.notify.telegram': { bot?: { token: string; chatId: string } | null; details?: boolean; test?: true };
  'venture.phone.access': { action?: 'link' | 'stop'; via?: 'wifi' | 'tailscale'; hours?: number };
  /** W6 6F3: {} reads; { provider, key, consentDigest } saves the owner's own search key; { provider: null } removes it. */
  'venture.web.search': { provider?: import('../web/search-types.ts').SearchProviderId | null; key?: string; consentDigest?: string };
  'venture.web.read': { url: string };
  /** W6 6G1: one chat's state; a snooze takes a preset or an exact future time. */
  'venture.chief.thread.state': ChiefThreadStateInput;
  /** W6 6G1: the quiet days before a chat settles on its own, 0 to 365 (0 is never). */
  'venture.chief.settle.set': { days: number };
  /** W6 6G2: the check before retiring; to is another AI agent's id or 'owner'; Bring back. */
  'venture.agents.retire.check': { agent: string };
  'venture.agents.retire': { agent: string; to: string; digest: string };
  'venture.agents.restore': { agent: string };
  'venture.apps.list': Empty; 'venture.apps.get': { app: string }; 'venture.apps.make': { ask: string; app?: string };
  'venture.apps.grant': { app: string; digest: string }; 'venture.apps.revoke': { app: string }; 'venture.apps.restore': { app: string; version: number };
  'venture.apps.pin': { app: string; pinned: boolean }; 'venture.apps.export': { app: string };
  'venture.apps.call': { app: string; tool: string; arguments: Record<string, Json>; sample?: true }; 'venture.apps.remove': { app: string };
  'venture.layout.get': { place: LayoutPlace };
  'venture.diagnostics.today': Empty;
  'venture.build.briefFile': { builder: BuilderId };
  'venture.accountant.pack.done': { month: string };
  'venture.accountant.schedule.set': { on: boolean };
  'venture.accountant.schedule.get': Empty;
  'venture.accountant.set': { email?: string | null; whatsapp?: string | null };
  'venture.accountant.get': Empty;
  'venture.notify.telegram.findChat': { token: string };
  'venture.client.aiDefault.set': { on: boolean; digest: string };
  'venture.client.aiDefault.get': Empty;
  'venture.away.preview': { from: IsoDate; to: IsoDate };
  'venture.team.introduced': { agentIds: string[] };
  'venture.layout.change': LayoutRequest;
  'venture.find': FindRequest;
  'venture.talk.get': Empty; 'venture.talk.consent': TalkConsentInput; 'venture.talk.setup': TalkSetupInput; 'venture.talk.start': Empty;
  'venture.talk.hear': { sessionId: string; audioBase64: string }; 'venture.talk.say': { threadId: string; messageId: string; quoted?: string; approvedRateDigest?: string };
  'venture.feedback.get': Empty; 'venture.feedback.consent': FeedbackConsentInput; 'venture.feedback.send': { digest: string };
  'venture.feedback.answer': FeedbackAnswerInput; 'venture.feedback.crash': FeedbackCrashInput; 'venture.feedback.delete': Empty;
  /** W6 6F8: {} reads; { service, key } saves the owner's own key; key null removes it. */
  'venture.people.services': { service?: 'happenstance' | 'probe42'; key?: string | null };
  /** W6 6F8: without digest, the exact lookup to approve; with it, the lookup once; searchId reads a Happenstance search. */
  'venture.people.lookup': { service: 'happenstance' | 'probe42'; query?: string; clientId?: string; digest?: string; searchId?: string };
  /** W6 6G3 (D44): one client's company, field history, timeline and list places; edits go through the evidence ledger. */
  'venture.crm.client': { clientId: string };
  'venture.crm.client.edit': { clientId: string; field: 'name' | 'email' | 'note' | 'phone'; value: string };
  'venture.crm.companies': Empty;
  'venture.crm.company': { companyId: string };
  /** Without companyId a new company (name needed); with it, the fields to change (null clears domain or note). */
  'venture.crm.company.save': { companyId?: string; name?: string; domain?: string | null; note?: string | null };
  /** companyId null takes the client or person out of its company. */
  'venture.crm.link': { companyId: string | null; member: string };
  'venture.crm.log': { clientId: string; kind: import('../crm/crm-data.ts').CrmEntryKind; on: IsoDate; text: string };
  'venture.crm.lists': Empty;
  'venture.crm.list': { listId: string };
  'venture.crm.list.save': { listId?: string; name: string; stages: string[] };
  /** stage null takes the member out of the list. */
  'venture.crm.list.place': { listId: string; member: string; stage: string | null };
  /** W6 6G4 (D44): dated facts. The app reads every fact; an AI caller reads only current facts an AI may see. */
  'venture.memory.list': { subject?: string };
  'venture.memory.add': { subject: string; topic: string; text: string; since?: IsoDate; visibility?: import('../memory/facts-data.ts').FactVisibility };
  'venture.memory.replace': { factId: string; text: string; since?: IsoDate };
  'venture.memory.visibility': { factId: string; visibility: import('../memory/facts-data.ts').FactVisibility };
  'venture.memory.forget': { factId: string };
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
  'venture.money.export': { month: string; format?: 'csv' | 'tally-xml' | 'gstr1-csv' };
  /** recurring: left out, a bill taking an expected one's place keeps its repeat; null says it does not repeat. */
  'venture.bills.add': { vendor: string; lines: BillLineInput[]; billDate: IsoDate; dueDate?: IsoDate; recurring?: 'monthly' | 'quarterly' | null };
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
  'venture.owner.set': { firstName?: string | null; excludedServices?: string[]; familyId?: FamilyId | null };
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
  'venture.goNoGo.remove': { cardId: string };
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
  'venture.webhook.set': { kind: 'n8n' | 'make'; url: string | null; secret?: string; test?: boolean };
  'venture.webhook.send': { kind: 'n8n' | 'make'; subject: string; payload: unknown; digest?: string };
  'venture.speechOut.providers': Empty;
  /** As venture.ca.confirmRates: the CA of record's membership number and the citations table version confirmed. */
  'venture.ca.confirmCitations': { version: number; membershipNo: string };
  'venture.ca.signoff.get': { id: string };
  'venture.ca.differential.add': { name: string; inputs: Json; outputs: Json; capturedBy: string };
  'venture.ca.dataPack.export': import('../playbooks/ca-firm/pack-core.ts').PackSelection & {approvalDigest:string};
  'venture.desk.list': DeskListPayload;
  'venture.desk.get': DeskGetPayload;
  'venture.desk.act': DeskActPayload;
  'venture.flows.list': Empty;
  'venture.flows.act': import('../flows/records.ts').FlowsActPayload;
  'venture.ai.options': OnboardingPayloads['venture.ai.options'];
  'venture.ai.connect': OnboardingPayloads['venture.ai.connect'];
  'venture.ai.disconnect': OnboardingPayloads['venture.ai.disconnect'];
  'venture.ai.status': OnboardingPayloads['venture.ai.status'];
  'venture.ai.calls': OnboardingPayloads['venture.ai.calls'];
  'venture.country.suggest': OnboardingPayloads['venture.country.suggest'];
  'venture.ai.tools': OnboardingPayloads['venture.ai.tools'];
  'venture.ai.login.start': OnboardingPayloads['venture.ai.login.start'];
  'venture.ai.login.cancel': OnboardingPayloads['venture.ai.login.cancel'];
  'venture.ai.setup.trust': { cli: 'codex'; sha256: string };
  'venture.ai.claude.install': Record<string, never>;
  'venture.ai.claude.progress': Record<string, never>;
  'venture.work.list': Record<string, never>;
  'venture.invoice.shared': { invoiceId: string; how: InvoiceShareHow };
  'venture.routines.suggestions': Empty;
  'venture.agents.hire.duties': { agent: string; duties: string[] };
  'venture.events.calKey.set': { key: string | null };
  'venture.events.relay.set': { address: string | null };
  'venture.events.get': Record<string, never>;
  'venture.agents.hire.cancel': { hireId: string };
  'venture.agents.hire.confirm': { hireId: string; digest: string };
  'venture.agents.hire.answer': { hireId: string; phase: string; edits?: Record<string, unknown> };
  'venture.agents.hire.start': { sentence: string };
  'venture.trackers.rows.undo': { rowId: string };
  'venture.trackers.rows.remove': { rowId: string };
  'venture.trackers.rows.edit': { rowId: string; cells: Record<string, unknown> };
  'venture.trackers.rows.add': { trackerId: string; cells: Record<string, unknown> };
  'venture.trackers.remove': { id: string };
  'venture.trackers.set': { tracker: { id?: string; name: string; columns: unknown[]; boardBy?: string | null; keptBy?: string[] } };
  'venture.trackers.get': { id: string };
  'venture.trackers.list': Record<string, never>;
  'venture.routines.backup.set': { on: boolean; order: ModelPresetId[]; digests?: string[] };
  'venture.routines.backup.get': Record<string, never>;
  'venture.models.plan': { fresh?: boolean };
  'venture.about.read': OnboardingPayloads['venture.about.read'];
  'venture.about.pick': OnboardingPayloads['venture.about.pick'];
  'venture.about.families': OnboardingPayloads['venture.about.families'];
  'venture.needs.list': Record<string, never>;
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
  'venture.client.aiConsent.get': ClientAiConsentView;
  'venture.agentSettings.get': import('../agent-runtime/settings.ts').AiSettingsView;
  'venture.agentSettings.set': import('../agent-runtime/settings.ts').AiSettingsView;
  'venture.mcpCredential.set': { serverId: string; saved: boolean };
  'venture.mcpRegistry.list': import('../agent-runtime/mcp-registry.ts').CuratedMcpView;
  'venture.mcpOAuth.start': { serverId: string; authorizationUrl: string };
  'venture.packs.list': { packs: import('../packs/pack-format.ts').PackView[] };
  'venture.packs.add': { added: boolean; digest: string; pack: import('../packs/pack-format.ts').PackView };
  'venture.packs.remove': { removed: boolean };
  'venture.client.aiConsent.agree': ClientAiConsentView;
  'venture.client.aiConsent.withdraw': ClientAiConsentView;
  'venture.billing.get': import('../money/billing-types.ts').BillingView;
  'venture.billing.set': import('../money/billing-types.ts').BillingView;
  'venture.invoice.pdf': import('../money/invoice-pdf.ts').InvoicePdfView;
  'venture.payment.receipt': import('../money/payment-receipt.ts').PaymentReceiptView;
  'venture.invoice.payLink': InvoiceView;
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
  'venture.spend.list': { rows: SpendRow[]; total: Display; totalRupees?: Display; totalLead?: SpendLead; needsRate?: boolean };
  'venture.spend.policy.get': SpendPolicyView;
  'venture.spend.policy.set': SpendPolicyView;
  'venture.build.brief': BriefRecord;
  'venture.build.handoff': HandoffPlan;
  'venture.build.handoffOpened': HandoffRecord;
  'venture.build.link': BuildFollowRecord;
  'venture.build.sync': BuildStatus;
  'venture.build.status': { follow: BuildFollowRecord | null; brief: BriefRecord | null; handoffs: HandoffRecord[]; tokenLink: string; linkFits: { lovable: boolean; replit: boolean } | null };
  'venture.connectors.list': ConnectorCard[];
  'venture.delivery.playbook': PlaybookRecord;
  'venture.simulation.scenarios': Scenario[];
  'venture.simulation.run': SimulationRunRecord;
  'venture.simulation.get': SimulationRunRecord;
  'venture.simulation.fromSignal': Scenario;
  'venture.launch.status': LaunchStatus;
  'venture.launch.advance': LaunchStatus;
  'venture.delivery.run': DeliveryRunView;
  'venture.agentApproval.decide': { runId: string; decision: 'approve' | 'deny' };
  'venture.delivery.review': DeliveryRunView;
  'venture.delivery.list': DeliveryRunView[];
  'venture.capabilities': CapabilityStatus[];
  'venture.files.add': UploadView;
  'venture.files.list': UploadView[];
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
  'venture.rules.locks': RuleLocksView;
  'venture.rules.attest': RuleLocksView;
  'venture.compliance.get': ComplianceView;
  'venture.compliance.set': ComplianceView;
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
  'venture.notify.telegram': TelegramView;
  'venture.phone.access': PhoneAccessView;
  'venture.web.search': import('../web/search-types.ts').WebSearchView;
  'venture.web.read': import('../web/search-types.ts').WebReadView;
  'venture.chief.thread.state': ChiefThreadStateResult;
  'venture.chief.settle.set': ChiefSettleResult;
  'venture.agents.retire.check': RetireCheckView;
  'venture.agents.retire': AgentRetired;
  'venture.agents.restore': AgentRestored;
  'venture.apps.list': { apps: MiniAppCard[]; ideas: { label: Display; preview: Display }[]; never: Display }; 'venture.apps.get': { app: MiniAppView };
  'venture.apps.make': { app: MiniAppView; line: Display }; 'venture.apps.grant': { app: MiniAppView; line: Display };
  'venture.apps.revoke': { app: MiniAppView; line: Display }; 'venture.apps.restore': { app: MiniAppView; undo: { version: number }; line: Display };
  'venture.apps.pin': { app: MiniAppView; undo: { pinned: boolean }; line: Display }; 'venture.apps.export': { fileName: string; document: string; mediaType: 'text/html' };
  'venture.apps.call': MiniAppCallResult; 'venture.apps.remove': { removed: true; line: Display };
  'venture.layout.get': LayoutView;
  'venture.diagnostics.today': import('../views/diagnostics-core.ts').DiagnosticsTodayView;
  'venture.build.briefFile': BriefFilePlan;
  'venture.accountant.pack.done': { done: boolean };
  'venture.accountant.schedule.set': CaPackScheduleView;
  'venture.accountant.schedule.get': CaPackScheduleView;
  'venture.accountant.set': AccountantView;
  'venture.accountant.get': AccountantView;
  'venture.notify.telegram.findChat': TelegramFound;
  'venture.client.aiDefault.set': ClientAiDefaultView;
  'venture.client.aiDefault.get': ClientAiDefaultView;
  'venture.away.preview': { from: IsoDate; to: IsoDate; items: AwayView['promises'] };
  'venture.team.introduced': { met: string[] };
  'venture.layout.change': LayoutChangeResult;
  'venture.find': FindView;
  'venture.talk.get': TalkView; 'venture.talk.consent': TalkView; 'venture.talk.setup': TalkView; 'venture.talk.start': TalkStarted;
  'venture.talk.hear': TalkHeard; 'venture.talk.say': TalkSaid;
  'venture.feedback.get': FeedbackView; 'venture.feedback.consent': FeedbackView; 'venture.feedback.send': FeedbackView;
  'venture.feedback.answer': FeedbackView; 'venture.feedback.crash': FeedbackCrashKept; 'venture.feedback.delete': FeedbackView;
  'venture.people.services': import('../people/people-types.ts').PeopleSearchView;
  'venture.people.lookup': import('../people/people-types.ts').PeopleLookupView;
  'venture.crm.client': import('../crm/crm-data.ts').ClientCrmView;
  'venture.crm.client.edit': import('../crm/crm-data.ts').ClientCrmView;
  'venture.crm.companies': import('../crm/crm-data.ts').CompanyRow[];
  'venture.crm.company': import('../crm/crm-data.ts').CompanyView;
  'venture.crm.company.save': import('../crm/crm-data.ts').CompanyView;
  'venture.crm.link': import('../crm/crm-data.ts').CrmMemberView;
  'venture.crm.log': import('../crm/crm-data.ts').ClientCrmView;
  'venture.crm.lists': import('../crm/crm-data.ts').CrmListRow[];
  'venture.crm.list': import('../crm/crm-data.ts').CrmListView;
  'venture.crm.list.save': import('../crm/crm-data.ts').CrmListView;
  'venture.crm.list.place': import('../crm/crm-data.ts').CrmListView;
  'venture.memory.list': import('../memory/facts-data.ts').MemoryView;
  'venture.memory.add': import('../memory/facts-data.ts').MemoryChange;
  'venture.memory.replace': import('../memory/facts-data.ts').MemoryChange;
  'venture.memory.visibility': import('../memory/facts-data.ts').MemoryChange;
  'venture.memory.forget': import('../memory/facts-data.ts').MemoryChange;
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
  'venture.goNoGo.remove': { removed: true; line: Display };
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
  'venture.webhook.send': WebhookSendView;
  'venture.speechOut.providers': SpeechProvidersView;
  'venture.ca.confirmCitations': CitationsConfirmView;
  'venture.ca.signoff.get': SignoffCheckView;
  'venture.ca.differential.add': DifferentialAddView;
  'venture.ca.dataPack.export': DataPackExportView;
  'venture.desk.list': DeskListView;
  'venture.desk.get': DeskItemView;
  'venture.desk.act': DeskActView;
  'venture.flows.list': import('../flows/records.ts').FlowsListView;
  'venture.flows.act': import('../flows/records.ts').FlowsActView;
  'venture.ai.options': OnboardingResults['venture.ai.options'];
  'venture.ai.connect': OnboardingResults['venture.ai.connect'];
  'venture.ai.disconnect': OnboardingResults['venture.ai.disconnect'];
  'venture.ai.status': OnboardingResults['venture.ai.status'];
  'venture.ai.calls': OnboardingResults['venture.ai.calls'];
  'venture.country.suggest': OnboardingResults['venture.country.suggest'];
  'venture.ai.tools': OnboardingResults['venture.ai.tools'];
  'venture.ai.login.start': OnboardingResults['venture.ai.login.start'];
  'venture.ai.login.cancel': OnboardingResults['venture.ai.login.cancel'];
  'venture.ai.setup.trust': { setup: import('../core/first-run-types.ts').CodexSetupView };
  'venture.ai.claude.install': import('../models/claude-code-install.ts').ClaudeInstallResult;
  'venture.ai.claude.progress': import('../models/claude-code-install.ts').ClaudeInstallView;
  'venture.work.list': { work: import('../../work-progress.ts').WorkJobView[] };
  'venture.invoice.shared': InvoiceView;
  'venture.routines.suggestions': RoutineSuggestionsView;
  'venture.agents.hire.duties': import('../agents/hire.ts').HireView;
  'venture.events.calKey.set': import('../build/event-triggers.ts').EventsView;
  'venture.events.relay.set': import('../build/event-triggers.ts').EventsView;
  'venture.events.get': import('../build/event-triggers.ts').EventsView;
  'venture.agents.hire.cancel': { cancelled: true };
  'venture.agents.hire.confirm': import('../agents/hire.ts').HireView;
  'venture.agents.hire.answer': import('../agents/hire.ts').HireView;
  'venture.agents.hire.start': import('../agents/hire.ts').HireView;
  'venture.trackers.rows.undo': { undone: true };
  'venture.trackers.rows.remove': { removed: true };
  'venture.trackers.rows.edit': { row: import('../trackers/trackers.ts').TrackerRowView };
  'venture.trackers.rows.add': { row: import('../trackers/trackers.ts').TrackerRowView };
  'venture.trackers.remove': { removed: true };
  'venture.trackers.set': { tracker: import('../trackers/trackers.ts').TrackerView };
  'venture.trackers.get': import('../trackers/trackers.ts').TrackerDetail;
  'venture.trackers.list': import('../trackers/trackers.ts').TrackersView;
  'venture.routines.backup.set': import('../agents/routine-backup.ts').BackupView;
  'venture.routines.backup.get': import('../agents/routine-backup.ts').BackupView;
  'venture.models.plan': import('../models/plan-view.ts').PlanView;
  'venture.about.read': OnboardingResults['venture.about.read'];
  'venture.about.pick': OnboardingResults['venture.about.pick'];
  'venture.about.families': OnboardingResults['venture.about.families'];
  'venture.needs.list': NeedsList;
  'venture.compose.decide': OnboardingResults['venture.compose.decide'];
  'venture.compose.fill': OnboardingResults['venture.compose.fill'];
  'venture.compose.get': OnboardingResults['venture.compose.get'];
  'venture.compose.update': OnboardingResults['venture.compose.update'];
};

export type VentureErrorCode = typeof VENTURE_ERRORS[number];
