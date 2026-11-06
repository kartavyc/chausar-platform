import type { QueueRow, QueueRowMeta, QueueCount, QueueItemView, QueuePreview, QueueSetPreview, QuestionCard, QuestionItem, QuestionOption, PreviewFigure, PreviewLength, PreviewWords, NextBestStep, PlanChangeView, RowFigure, RowFigureReceipt, KindedFigure, RankedOptionView, DiffLine } from './contract.gen';
export type { QueueRow, QueueRowMeta, QueueCount, QueueItemView, QueuePreview, QueueSetPreview, QuestionCard, QuestionItem, QuestionOption, PreviewFigure, PreviewLength, PreviewWords, NextBestStep, PlanChangeView, RowFigure, RowFigureReceipt, KindedFigure, RankedOptionView, DiffLine } from './contract.gen';
import type { AcrossLineKey, AcrossRunsView, AgentHealthStatus, AgentNoteChange, AgentNoteLoad, AgentNoteScope, AgentNotesView, AgentSendResult, AgentSuggestion, AgentThreadItem, AgingBucketId, AutoReadinessView, BankApplyResult, BankLedgerView, BankRowClass, BooksPeriodKey, BoundaryView, BuildStatusWord, CaLatestPapers, CaPendingRate, CapabilityItemView, CapabilityPageView, ChatPart, ChiefSendResult, ChiefSettleResult, ChiefSnoozePreset, ChiefThreadState, ChiefThreadStateResult, ChiefThreadView, ConnectorLadder, ConnectorModeName, CurrencyLead, DecisionOpens, DeliveredView, Display, DraftChangesView, EvidenceItem, FigureKind, FigureSource, InboundTriage, InterviewAnswer, JournalChainView, JournalEntry, KeeperJobId, KeeperView, KnowledgeSourceInput, LawfulBasis, LimitReachedView, LineLabel, ModelAvailability, ModelReceiptView, ModelTier, MoneyOverviewLine, NetworkImportResult, NetworkSearchView, OrderStageId, OrderStageReason, OrderWaitsOnYou, OutreachChannel, OutreachHandoff, OutreachLane, OutreachLanguage, OutreachSentChannel, PaymentMethod, PipelineSettingsView, PostingStepId, Posture, PreviewReceiptKind, PricingModel, ProposalStatus, QueueAction, QueueActionId, QueueAmount, QueueChange, QueueDecision, QueueKind, QueueList, QueueSendsTo, RateCardLine, RecipeView, RetireCheckView, RoutineRunState, RunControlResult, RunScopeView, RunState, RunStep, SearchWebState, ShadowSummaryView, SiteEditState, SocialCalendarFile, SpendLead, SpendMeterRowView, SpendMetersView, SpendRateUnit, SpendRow, StandingOrdersView, StandingUndoView, TaxWorkingLine, TaxWorkingSection, TelegramView, TranscriptionSetupView, TriageField, TriagePreview, VentureRunEventType, WayCategory, WriteCapKind, WriteCapView } from './contract.gen';
export type { AcrossLineKey, AcrossRunsView, AgentHealthStatus, AgentNoteChange, AgentNoteLoad, AgentNoteScope, AgentNotesView, AgentSendResult, AgentSuggestion, AgentThreadItem, AgingBucketId, AutoReadinessView, BankApplyResult, BankLedgerView, BankRowClass, BooksPeriodKey, BoundaryView, BuildStatusWord, CaLatestPapers, CaPendingRate, CapabilityItemView, CapabilityPageView, ChatPart, ChiefSendResult, ChiefSettleResult, ChiefSnoozePreset, ChiefThreadState, ChiefThreadStateResult, ChiefThreadView, ConnectorLadder, ConnectorModeName, CurrencyLead, DecisionOpens, DeliveredView, Display, DraftChangesView, EvidenceItem, FigureKind, FigureSource, InboundTriage, InterviewAnswer, JournalChainView, JournalEntry, KeeperJobId, KeeperView, KnowledgeSourceInput, LawfulBasis, LimitReachedView, LineLabel, ModelAvailability, ModelReceiptView, ModelTier, MoneyOverviewLine, NetworkImportResult, NetworkSearchView, OrderStageId, OrderStageReason, OrderWaitsOnYou, OutreachChannel, OutreachHandoff, OutreachLane, OutreachLanguage, OutreachSentChannel, PaymentMethod, PipelineSettingsView, PostingStepId, Posture, PreviewReceiptKind, PricingModel, ProposalStatus, QueueAction, QueueActionId, QueueAmount, QueueChange, QueueDecision, QueueKind, QueueList, QueueSendsTo, RateCardLine, RecipeView, RetireCheckView, RoutineRunState, RunControlResult, RunScopeView, RunState, RunStep, SearchWebState, ShadowSummaryView, SiteEditState, SocialCalendarFile, SpendLead, SpendMeterRowView, SpendMetersView, SpendRateUnit, SpendRow, StandingOrdersView, StandingUndoView, TaxWorkingLine, TaxWorkingSection, TelegramView, TranscriptionSetupView, TriageField, TriagePreview, VentureRunEventType, WayCategory, WriteCapKind, WriteCapView } from './contract.gen';
import type { RendererMethod } from './methods.gen';
/**
 * The engine contract the UI builds to. The first block is the shared contract from
 * chausar-private/docs/superpowers/plans/2026-10-21-chausar-frontend-ink.md ("Shared contract"), verbatim; the engine side lives in
 * platform/runtime/venture/contracts.ts. The UI imports engine types from the generated contract and pure helpers.
 * The second block mirrors the few existing engine shapes the shell and the fake engine need, trimmed to the
 * fields the UI reads.
 */

// ---------------------------------------------------------------------------------------------------------------
// Shared contract (verbatim)
// ---------------------------------------------------------------------------------------------------------------

 // engine-formatted text; the UI never computes it
 // Ink v2 wave 4: "I sent it" (4E), the round gate and run controls (4F)




/**
 * The row kinds Ink v2 wave 4 adds on the engine (4C1 proposal, 4E1 followup, 4E3 reply, 4G2 notice). W3's states.ts
 * keys a Record on QueueKind, so the U package that first shows a kind folds it into QueueKind together with its words
 * (4C2 folded 'proposal'; 4E4 and 4J19 the others).
 */
export type QueueKindW4 = 'proposal' | 'followup' | 'reply' | 'notice';
/** 4J1: where an approved row's action goes. */

/** 4J1: client, business and time; expiresAt only from a real expiry; waitingLong after a day; staleDraft after 14 days. */


/**
 * 4J1: one amount a row states, each occurrence its own: text is field.slice(start, start + length) in its field (the
 * line, change.before, change.after, the price, or changeCount.details[index]), in UTF-16 code units. Its proof is a
 * receipt (venture.receipt.get) or the model-estimate label, never both. Wrap exactly that span in a Figure.
 */

/**
 * 4J3: what a card shows before it is opened, from the owner's own records only (engine views/previews.ts). A field
 * without its source is left out; a preview never carries a made-up image, and drawing one never counts as viewed.
 * Every amount is a PreviewFigure with its receipt; words a model wrote are PreviewWords, shown with "model estimate"
 * when estimate is set. video.poster.src is a small JPEG data address from the cut; paper 'invoice' has no tax lines
 * for a business not registered for tax; a choice's estimate is only ever a model estimate.
 */

/**
 * 4J3: an engine-formatted amount and the receipt it comes from. receiptKind names the method that opens it: price and
 * sum through venture.receipt.get, ca through venture.ca.receipt, work through venture.work.get. A post's textEstimate:
 * a model wrote it and it holds a number or an amount with no receipt; its text stays exact.
 */


/** 4J3: words a preview shows; estimate: a model wrote a number in them that no receipt backs. */

/** 4J3: a length worked out by code: whole seconds, "11 min 42 s", "11:42", and what it was measured from. */





/** 4J14 (Q6): coverage, fraction first. done and total counted by code; null where nothing observed them, never 0. */
export interface CoverageView {
  done: number | null; total: number | null; unit: 'rows' | 'lines' | 'pages' | 'items' | 'bank-lines'; verb: 'read' | 'matched' | 'used';
  complete: boolean; line: Display;
  /** On an 'items' count only: the units it adds up, so the screen words "{done} of {total} ..." in its own language. */
  units?: ('rows' | 'lines' | 'pages' | 'bank-lines')[];
}
/** 4J14 (Q7): one report line; outcome from the engine's one table (delivery/verdicts.ts). */
export interface ReportItem {
  id: string; outcome: 'pass' | 'fail' | 'not-run' | 'not-checked' | 'unknown'; line: Display;
  /** The line without its outcome word, so the screen puts its own word (English or Hindi) in front. */
  detail: Display;
  /** A judged rule: its word, and the engine's line on why it was dropped below the keep line. */
  judgment?: 'strong' | 'fair' | 'weak' | 'no' | null; drop?: Display;
}
/**
 * 4J14 (Q7, Q8): measured by code, looked at by a model, needs a human; findings by class; the draft verdict as a code
 * (null while the review is incomplete); result and coverage only where the run had client files; stale once the draft
 * changed after it.
 */
export interface DeliverableReport {
  measured: ReportItem[]; lookedAt: ReportItem[]; needsHuman: { code: string; line: Display }[];
  findings: { class: 'hard-error' | 'content' | 'creative'; id: string; line: Display }[];
  verdict: 'pass' | 'rewrite' | 'do-not-send' | null; verdictLine: Display;
  review: { complete: boolean; line: Display | null };
  result?: 'complete' | 'partial'; coverage?: CoverageView;
  generatedBy: ('code' | 'judge')[]; at: string; stale: boolean; staleLine: Display | null;
}
/** One tool call on the run sheet. 4F1 (U7): its state and its measured time in ms, where the engine measured them. */
export interface RunToolLine { name: string; line: string; state?: 'done' | 'error' | 'cancelled'; ms?: number }
/** 4F1: usually, "Usually 3 to 5 min" once three runs finished (U6); stop, a stop on its way or done, in engine words (O1). */
export interface RunSummary {
  runId: string; businessId: string; agent: string; purpose: string; state: RunState; startedAt: string; elapsed: Display;
  finishedAt?: string;
  practice?: true;
  progress?: { done: number; total: number } | 'indeterminate'; result?: Display; receiptId?: string; estimate?: boolean;
  usually?: Display; stop?: { state: 'stopping' | 'stopped'; line: Display; trigger?: 'same-error' | 'same-action' | 'failures-in-row' };
  /** C4 task 12: elapsed is the time it worked; waited is its waits on the owner, when its events show any; waitingSince is when the current wait began. */
  waited?: Display;
  waitingSince?: string;
  /** C4 task 12: the client a delivery run worked for, for a link to the client sheet. */
  client?: { id: string; name: string };
  /** C4 task 17: on an improvement run, its kept version still waits to be adopted. */
  adoptReady?: true;
  /**
   * 4J3: on a YouTube run only, the still kept from its order's cut (a small JPEG data address), or null when none is.
   * The run list carries src once per order, on its newest run, and src null on the others; venture.runs.get carries it.
   */
  poster?: { uploadId: string; src: string | null } | null;
  /** 4H2 (U17): which engine wrote the run's draft, in the engine's words ("Written by Claude Sonnet 5.5"); absent before an answer. */
  writtenBy?: Display;
}
/**
 * screen: one engine line saying what the untrusted screen noted in the run's outside content, never the words.
 * 4F1: scope frozen when the run started (O21); the owner's notes for the next turn (O3); the round gate (O2); the calls
 * of the turn in flight (U7).
 */
export interface RunDetail extends RunSummary {
  /** Actual driver updates. These words have not passed the delivery number guard. */
  agentProgress?: {messages:{id:string;text:string;label:'model-estimate'}[];tools:{id:string;name:string;status:'running'|'done'|'failed'}[];model?:string;unavailableSites?:string[];canResume?:boolean;cost?:{display:string;state:'priced'|'unknown';spendId:string;receiptId?:string};pendingApproval?:{request:AgentApprovalRequest;digest:string}};
  steps: RunStep[]; question?: { id: string; text: string; choices?: string[]; card?: QuestionCard }; error?: string; screen?: Display;
  scope?: RunScopeView; steer?: { text: Display; at: string; line: Display }[];
  gate?: { on: boolean; every: 1 | 2 | 3 | 5; waiting: { round: number; reason: 'finished' | 'limit' | 'needs-answer' | 'blocked' | 'failures'; line: Display } | null };
  live?: { callId: string; state: 'start' | 'done' | 'error' }[];
  /** W6 6G5 (D44): the run's model receipt (venture.runs.get on a delivery run). */
  modelReceipt?: ModelReceiptView;
  /** 4F2 (O14): "How to fix it", only when the owner must act on a failed or breaker-stopped run. */
  fix?: Display;
  /** 4F2 (O14): the failure in the table's plain words, and codes for the screen's own words (English and Hindi). */
  failure?: { kind: 'allowance-spent' | 'not-signed-in' | 'offline' | 'too-long' | 'out-of-date' | 'unknown' | 'plan-used-up' | 'rate-limited' | 'step-limit' | 'connection-dropped' | 'model-missing'; line: Display };
  fixKind?: 'raise-limit' | 'sign-in' | 'run-again-online' | 'split-work' | 'update-tool' | 'install-ffmpeg' | 'set-up-docker' | 'get-python-image' | 'set-up-cli' | 'wait-for-plan' | 'run-again' | 'choose-model' | 'wait-a-minute';
  /** 4J3 (A17): the Delivered card, on an accepted or edited delivery run only. */
  delivered?: DeliveredView;
  /** 4J14 (Q8): on a run that acted outside: Success only when a code check of the real result passed. Absent otherwise. */
  outcome?: { outcome: 'success' | 'not-checked' | 'failed'; line: Display };
  /** 4J14 (Q7, Q8): the draft's three-column report, on venture.runs.get only. */
  report?: DeliverableReport;
  /** 4J13 (H34), mirrored by 4F3: set when Chausar stopped while a step of this run was out; never "Stopped by you". */
  interrupted?: { at: string; line: Display; steps: { callId: string; state: string }[] };
}
/**
 * 4J3 (A17): what an accepted run handed over (files its own tools made, with digests) and, apart, the files on the order
 * that changed while it went on, labelled by changedLine ("Changed during this run, not proven to be the agent's.").
 * source is a code the screen words for itself.
 */

export interface DeliveredFile { id: string; name: Display; digest: string; at: string; source: 'table' | 'delegate' | 'order-file' | 'transcript' | 'poster'; line: Display }
/** 4F1. A run's scope: tools and outside actions in purpose words, the spend cap and the posture. */


export interface AgentView {
  /** C7: an agent the owner hired: the day, its duties and what it reads. */
  hired?: { line: Display; duties: string[]; reads: { read: string; why: string }[] };
  id: string; name: string; role: string; now: Display; posture: Posture; spend: Display;
  last?: { line: Display; receiptId?: string; estimate?: boolean };
  steps: { id: string; purpose: string; gate: 'auto' | 'hold'; floor: boolean }[];
  // Ink v2 wave 4 (4A1 unless named): department; 'code' for the code role and Keeper; state from facts; health; the
  // helper's parent (4J12); who set the posture; whether it has a chat (4B1).
  department?: DepartmentId;
  kind?: 'agent' | 'code';
  state?: 'working' | 'waiting' | 'failed' | 'idle';
  health?: AgentHealth;
  parentId?: string | null;
  postureSetBy?: 'business' | 'agent';
  chat?: boolean;
}

/** seq: the event's place in the business's log, for replay after a reconnect (4G1); count: on notify.new only. */
export interface VentureRunEvent {
  type: VentureRunEventType | 'work.step'; businessId: string; runId?: string; at: string; seq?: number; count?: number;
  /** One-shot C3 task 10: on a `work.step` frame alone (no seq, never in the log): which job, which step, how it stands. */
  workId?: string; kind?: WorkKindLite; step?: string; state?: WorkStepStateLite; passed?: boolean;
}
/** Which long work (platform/runtime/venture/views/work-steps.ts). */
export type WorkKindLite = 'about' | 'ai-tools' | 'rehearse' | 'improve' | 'brief' | 'goal-suggest' | 'drills' | 'restore' | 'move-in' | 'import';
export type WorkStepStateLite = 'waiting' | 'current' | 'done' | 'failed';
/** A live job (platform/runtime/work-progress.ts WorkJobView). */
export interface WorkJobLite { workId: string; kind: WorkKindLite; startedAt: string; steps: { id: string; state: WorkStepStateLite; passed?: boolean }[] }
// phase 2 views
/**
 * `reason`: the engine's words for why a call was refused (no price, over the monthly limit, waiting for approval).
 * `reservedRupees`, `settledRupees`: the same figures in rupees at the owner's own rate, with that rate; absent without one.
 * `by`: who answered a model call, in words ('Claude Sonnet 5.5', or 'not reported'); absent for other spend and
 * before the call answered.
 */

/**
 * 4Z3 (founder, 27 Oct): which currency leads spend, as the owner chose it. 'auto': rupees lead for a business in India
 * once a rupee rate is set; 'inr': rupees first whenever a rate is set; 'usd': dollars first. Without a rate, dollars lead.
 */

/**
 * 4Z3: a spend figure as the owner's currency leads it, from the engine (money/spend.ts spendLead): `figure` the lead
 * amount with the engine's words after it, never more than two decimals of dollars; `beside` the other currency at the
 * owner's rate, shown small beneath it; `other` that amount alone, for a page that says the rate once. The UI computes
 * nothing: it shows `figure` where the spend figure goes and `beside` beneath it.
 */

/**
 * venture.spend.policy.get/set. The Usd fields are figures in US dollars as the owner types them ('20.00', '0.000075');
 * the form shows those and sends what the owner typed, and the engine converts. The UI shows the Display fields.
 */

export interface SpendRateLine {
  model?: string;
  item: string; unit: SpendRateUnit; inputMicrosPerMillion: string | null; outputMicrosPerMillion: string | null; microsPerCall: string | null;
  inputUsdPerMillion: string | null; outputUsdPerMillion: string | null; usdPerCall: string | null;
  source: string; checkedOn: string; confirmed: boolean; by: 'list' | 'owner'; price: Display;
  /** 4F2 (M6): the prompt-cache prices, when the line has them. */
  cacheReadMicrosPerMillion?: string | null; cacheWriteMicrosPerMillion?: string | null; cacheReadUsdPerMillion?: string | null; cacheWriteUsdPerMillion?: string | null;
}
export interface SpendRateInput {
  model?: string;
  item: string; unit: SpendRateUnit; inputUsdPerMillion?: string | null; outputUsdPerMillion?: string | null; usdPerCall?: string | null; source: string; checkedOn: string;
  /** 4F2 (M6): the prompt-cache prices in US dollars, each optional. */
  cacheReadUsdPerMillion?: string | null; cacheWriteUsdPerMillion?: string | null;
}
/**
 * `inrPerUsd`: the owner's own rupee rate as typed back ('83.50'); `rupeeRate`: that rate in words with the day it was
 * set; `capRupees`, `askFirstRupees`: the limits in rupees at that rate. All null or absent without a rate.
 */
export interface SpendPolicyView {
  /** C5 task 15: the offer of the reference rate shipped with this release; gone once it is in use. */
  reference?: { perUsd: string; on: string; line: Display; source: Display; url: string };
  capMicros: string | null; askFirstMicros: string | null; capUsd: string | null; askFirstUsd: string | null;
  cap: Display; askFirst: Display; rates: SpendRateLine[]; setAt: string | null;
  inrPerUsd: string | null; rupeeRate: Display | null; capRupees?: Display; askFirstRupees?: Display;
  // 4F2: the day's cap and the alert share (M4); the meter and the limit-reached options (M4, M3); each agent's own
  // limit (M5); the daily write caps (H32); the rate card with confirmed and list prices (M6).
  dailyCapMicros?: string | null; dailyCapUsd?: string | null; dailyCap?: Display; dailyCapRupees?: Display;
  alertPermille?: number; alert?: Display;
  meter?: SpendMeterView | null; limitReached?: LimitReachedView; keyLimits?: LimitReachedView[];
  agentCaps?: AgentCapView[]; writeCaps?: WriteCapView[]; card?: RateCardLine[];
  /** W6 6G5 (D44): this month's spend of each agent and each routine, with the owner's cap on each. */
  meters?: SpendMetersView;
  /** 4Z3: the owner's choice of which currency leads spend, and the currency that leads now. */
  currencyLead?: CurrencyLead; leads?: 'INR' | 'USD';
  /** 4Z3: the monthly limit and the ask-first figure as the owner's currency leads them; absent with no limit. */
  capLead?: SpendLead; askFirstLead?: SpendLead;
}
/** 4F2 (M4, M3): this month's spend against its limit, with the sum receipt; a projection labelled as one. */
export interface SpendMeterView {
  usedPermille: number; line: Display; near: boolean; over: boolean; receiptId: string; resetOn: string; reset: Display;
  projection?: { line: Display; label: Display; runIds: string[]; left: Display; leftRupees?: Display };
}
/** 4F2 (M3): what the owner can do once the monthly limit is reached. Never credits. */

/** 4F2 (M5): one agent's own monthly limit; past it only that agent is paused. */
/**
 * W6 6G5 (D44), as platform/runtime/venture/contracts.ts: one agent's or routine's spend this month with its sum
 * receipt; plan, runs on the owner's plan (never priced, never rupees); media, Sunra quotes beside it, not capped; the
 * owner's cap, usedPermille and paused; line, where it stands in the engine's words.
 */


/** W6 6G5 (D44): what one run used: tool, model, tier, tokens, cost ('On your plan' with no figure on a plan). */

export interface AgentCapView { agent: string; name: Display; capMicros: string; capUsd: string; cap: Display; used: Display; paused: boolean; capRupees?: Display; usedRupees?: Display }
/** 4F2 (H32): one daily write cap: today's cap, what agents made today, in words. */

/** 4F2 (M6): one price on the rate card: the owner's checked rate, or Chausar's list price with its checked date. */

/** allowedBy (4J1): a step a saved rule let run without asking; Stop always allowing is venture.team.gate { agentId, stepId, gate: 'hold' }. */

/** `dismissed`: the owner said no to this suggestion (venture.evidence.dismiss); it stays in the ledger, off the screen. */


// ---------------------------------------------------------------------------------------------------------------
// Ink final pass: the views and actions the engine added for the last screens (engine-final, 21 Oct). Every figure is
// engine text (Display); amounts the owner types go to the engine as typed strings and come back formatted.
// ---------------------------------------------------------------------------------------------------------------

/** `venture.money.overview`: Money at a glance, three lines the engine adds up (owed, received, spent). */
/** `rupees`: the AI spend line in rupees at the owner's own rate, with that rate; absent without one. */
/** kind, source, uses, basis (4J4): how the line's figure was made. */

export interface MoneyOverview { lines: MoneyOverviewLine[]; /** One-shot C6: this month's invoices all paid. */ paidInFull?: { line: Display; receiptId: string } | null }

/** `venture.tax.working`: the tax working for a period, worked by the calculator, each figure with its receipt. */


export interface TaxWorking { period: Display; sections: TaxWorkingSection[]; needsCaConfirmation: boolean }

/** `venture.ca.get` (the CA firm playbook): the CA of record, rate tables waiting for the CA, and sign-off requests. */
export interface CaOfRecord { name: string; membershipNo: string }

export interface CaSignoffRequest { signoffId?: string | null; id: string; deliveryId: string; title: Display; state: 'sent' | 'signed' | 'returned'; at: string }
/** The newest regulated draft with the calculator's receipts (Ink v2 2A2); Your CA works each receipt again. */

export interface CaView { citations?: CaCitationsView; ca: CaOfRecord | null; pendingRates: CaPendingRate[]; requests: CaSignoffRequest[]; latestPapers?: CaLatestPapers | null }

/** Leads (platform/runtime/venture/contracts.ts LeadView): agents draft, the owner sends from his own mailbox. */
export interface LeadEmailCheck { status: 'unverified' | 'verified' | 'failed'; at: string | null; line: string }
export interface OutreachDraftView {
  id: string; leadId: string; to: string; subject: string; text: string;
  footer: { businessName: string; postalAddress: string; unsubscribe: string }; sourceUrl: string; by: 'agent' | 'owner'; at: string; digest: string;
}
export interface LeadSendView { draftId: string; sentAt: string; recordedBy: string; recordedAt: string; channel: 'own-mailbox' }
export type LeadStage = 'new' | 'drafted' | 'contacted' | 'replied' | 'won' | 'lost' | 'blocked';
/** One stage move with what it rests on: the draft, the owner's send, the reply, the outcome or the opt-out. */
export interface LeadMoveView { from: LeadStage; to: LeadStage; at: string; by: string; evidence: { kind: 'draft' | 'send' | 'reply' | 'outcome' | 'opt-out'; id: string } }
export interface LeadView {
  id: string; name: string; company: string | null; email: string | null; emailDomain: string | null; sourceUrl: string; emailCheck: LeadEmailCheck;
  /** Forward only: new, drafted, contacted, replied, then won or lost; blocked is never left. */
  status: LeadStage; drafts: OutreachDraftView[]; sends: LeadSendView[]; moves: LeadMoveView[]; addedBy: string; addedAt: string;
}

/** Bank statements (contracts.ts BankImportResult, BankConsentView). No bank provider is wired: imports are CSV files. */
export interface BankImportResult { account: string; accountId: string; added: number; duplicates: number; rejected: { line: number; reason: string }[]; line: Display; transactions: number }
export interface BankConsentLite { id: string; provider: string | null; accountLabel: string; scope: 'read-only'; grantedAt: string; expiresAt: string; revokedAt: string | null }
export interface BankConsentView {
  account: string; accountId: string; consent: BankConsentLite;
  status: { state: 'active' | 'expiring' | 'expired' | 'revoked'; daysLeft: number; line: Display };
  provider: Display;
}

/** A staged website edit (contracts.ts SiteEditRecord), trimmed. Apply and revert send planDigest as the reviewed hash. */

export interface SiteEditLite {
  id: string; at: string; target: { kind: 'local-folder' | 'github'; identity: string }; path: string; summary: string;
  before: string; after: string; beforeDigest: string; afterDigest: string; planDigest: string; state: SiteEditState;
  log: { at: string; by: string; step: 'staged' | 'applied' | 'verified' | 'rolled-back' | 'rejected' | 'needs-inspection'; line: string }[];
}

/**
 * A preview link for a client (venture.share.*). `url` is null when there is no public address; `reason` says why.
 * `answer`: the client's answer on this link, given through it or recorded by the owner (Ink v2 wave 2). `revoked`: the
 * owner took the link back; only an answer on the newest link not taken back counts.
 */
export interface ShareLink {
  id: string; url: string | null; reason?: Display; expiresAt: string; answer?: ShareAnswer; revoked?: true;
  /** 4J7 (O20): the kind when not a draft, the first view through the token (never the owner's own), the client's comments. */
  shareKind?: 'order-status' | 'statement' | 'books'; viewedAt?: string; comments?: ShareCommentLite[];
}
/** 4J7 (O20): a client's comment on one post ('<run>.post-<n>') or on the whole draft ('draft'). */
export interface ShareCommentLite { item: string; text: string; at: string; recordedFor: string | null }

// ---------------------------------------------------------------------------------------------------------------
// Mirrors of existing engine shapes (trimmed). Source: platform/runtime/workspace-custody-contracts.ts and
// platform/runtime/venture/contracts.ts.
// ---------------------------------------------------------------------------------------------------------------

export type ServiceType = 'agency' | 'studio' | 'consulting' | 'bookkeeping' | 'research' | 'content' | 'support' | 'teaching' | 'local-services' | 'licensed' | 'other';
export const SERVICE_TYPES: readonly ServiceType[] = ['agency', 'studio', 'consulting', 'bookkeeping', 'research', 'content', 'support', 'teaching', 'local-services', 'licensed', 'other'];

export interface BusinessOnComputer {
  folder: string; name: string | null; demo: boolean | null; unlock: 'this-computer' | 'passphrase';
  opens: 'with-this-computer' | 'needs-passphrase' | 'key-missing';
  recovery: 'made' | 'not-made' | 'unknown'; openedAt: string | null; listedFrom: 'card' | 'folder';
}
export interface BusinessList { businesses: BusinessOnComputer[]; complete: boolean }

/** `venture.get` (VentureView), only the fields the shell reads. */
export interface VentureViewLite {
  /** country (4J20): the business's country, its code and currency; null while it is still in its interview. */
  venture: { id: string; workingName: string; serviceType: ServiceType | null; originalCountry?: CountryLite; country?: { code: string; currency: string } | null };
  done: number; total: number;
  /** The flagship playbook the idea picks, for example { id: 'youtube', label: 'YouTube channel' }; absent when the plain service type serves. */
  playbook?: PlaybookPick;
  /** The setup checklist item by item (4J8): its name, whether it is done, and the app address where it is done. */
  checklist?: ChecklistItemLite[];
  /** 4F3: while the owner has paused the business (Pause all), since when and the engine's line; absent otherwise. */
  paused?: { since: string; line: Display };
}
/** `ChecklistItem` in platform/runtime/venture/contracts.ts, trimmed; link is an address such as #/business/prices. */
export interface ChecklistItemLite { id: string; label: string; done: boolean; link: string }
/** `PlaybookPick` in platform/runtime/venture/contracts.ts: worked out from the idea by the engine, never stored. */
export interface PlaybookPick { id: string; label: string }

/** `venture.events` record, trimmed. */
export interface VentureEventRecordLite { id: string; seq: number; name: string; at: string; data: unknown }
/**
 * Ink v2 wave 4 (4G1): frames, the page's run events as they were pushed (seq on each, count on notify.new), for replay
 * after a gap; firstSeq, the oldest event the log keeps, so an afterSeq below it means events were trimmed.
 */
export interface VentureEventsResult { events: VentureEventRecordLite[]; lastSeq: number; firstSeq: number; frames: VentureRunEvent[] }

/** `venture.receipt.get` (PriceReceiptRecord), only what a receipt sheet shows. Figures arrive formatted. */
export interface PriceFigureLite { key: string; label: string; display: Display }
export interface ReceiptLite {
  id: string; at: string; figures: PriceFigureLite[]; explanation: string; stale: boolean;
  /** C4 (T27): what a money sum counted and over which dates ("Counted: payments dated 1 to 30 Nov 2026"). */
  basis?: Display;
  /** Raw code-computed total on a price receipt; absent on other receipt kinds. */
  totalMinor?: string;
  /** 4J10 (mirrored by 4J22a): a stored receipt's signature and the public half that checks it; absent when unsigned. */
  signature?: ReceiptSignatureLite;
}
/** 4J10: the business's Ed25519 signature over a receipt's canonical JSON (signed), as getReceipt sends it. */
export interface ReceiptSignatureLite { algorithm: 'ed25519'; publicKey: string; signature: string; signedAt: string; signed: string }
/**
 * `venture.work.get` (WorkReceiptRecord), trimmed (4J19): a receipt the engine's work tools made (a sum, totals, a
 * reconciliation), with its figures as the engine formatted them, the steps code took, its explanation, and its
 * coverage where code counts it (4J14).
 */
export interface WorkReceiptLite {
  id: string; at: string; operation: string; currency: string; explanation: string;
  /** WorkFigure's exact source amount and denomination are required, even when only display is shown. */
  figures: { key: string; label: string; minor: string; display: Display; currency: string; unit: 'money' | 'count' | 'percent' | 'post' }[];
  steps: { op: string; inputs: string[]; result: string; rule: string }[];
  coverage?: CoverageView;
}
/**
 * 4J1: the receipt behind a figure a Today row states (`fig:<kind>:...` ids), worked out again from its record on each
 * read. A ReceiptLite too, so the receipt sheet shows it as it is. Each figure's amount is in its own unit.
 */



/** `venture.books.summary` (BooksSummary), trimmed. */
export interface BooksFigureLite { operation: 'billed' | 'received' | 'earned'; label: string; receiptId: string; display: Display; stale: boolean; zero?: true }
export interface BooksSummaryLite {
  currency: string; period: { from: string; to: string };
  figures: BooksFigureLite[];
  openInvoices: { invoiceId: string; number: string; clientName: string; balanceDisplay: Display; dueDate: string }[];
  notes: string[];
  /** The engine always sends these three; optional only so older samples still type. */
  periodKey?: BooksPeriodKey | 'custom';
  periods?: { key: BooksPeriodKey; label: string; from: string; to: string }[];
  today?: string;
  /** 4J4: the month asked for, and the month before it (each figure with its receipt) when the period is one whole month. */
  month?: string;
  previous?: { month: string; label: Display; period: { from: string; to: string }; figures: BooksFigureLite[] } | null;
}


/**
 * `venture.connectors.list` (ConnectorCard). Posting is spec section 7.9 (P2-connectors): `postingOptions` holds every
 * posting mode in the order api, owner-browser-session, handoff, each with its status, risk, requirements and the reason
 * a planned one is planned; `posting` is the first available one, else the owner-browser-session one. Both are absent or
 * empty for a connector that does not post. The UI shows them as the engine says, word for word.
 */

export type PostingMode = 'api' | 'owner-browser-session' | 'handoff';
export type Qualification = 'built-in' | 'fixture-tested' | 'unqualified';
export interface PostingOptionLite {
  mode: PostingMode; status: 'available' | 'planned'; qualification: Qualification; what: string;
  risk: string | null; requires: string[]; reason: string | null;
  /** The browser mode of LinkedIn and X: the oldest day across the posting steps one of each step's candidates last worked, or null (2B2). */
  stepsCheckedOn?: string | null;
  /** The same mode: the oldest day the post box and the post button last worked, the steps a check can see (2B2). */
  boxAndButtonCheckedOn?: string | null;
  /** 4J7 (K6): how far this posting mode is proven on this business. */
  ladder?: ConnectorLadder;
}
/** 4J7 (K6): the connector truth ladder (build/connector-truth.ts). */

/** 4J7 (K11): a connector's setup guide, in the engine's words (build/guides.ts). */
export interface ConnectorGuideLite {
  steps: string[]; skipped: string; charges: { line: string; checkedOn: string | null }; checks: string; sends: string; agentLimits: string; missing: string | null;
}
export interface ConnectorCardLite {
  id: string; name: string; category: string; categoryLabel: string;
  modes: { mode: ConnectorModeName; status: 'available' | 'planned'; qualification: Qualification; what: string; ladder?: ConnectorLadder }[];
  chips: string[]; regions: ('global' | 'india')[]; regionNote: string | null; auth: string;
  note: string; vendorUrl: string | null; starter: boolean;
  posting?: PostingOptionLite;
  postingOptions: PostingOptionLite[];
  /** 4J7 (K11, K6): the setup guide, and the operations it really takes with their fields. */
  guide?: ConnectorGuideLite;
  capabilities?: { operation: string; mode: ConnectorModeName | PostingMode; fields: string[] }[];
}

/**
 * `venture.models.*` and the draft desk's `venture.ai.*` (ModelPreset, ModelStatusView, AiOptionsView), trimmed. A key is
 * sent once in `connect` and never comes back: the status says only whether one is loaded.
 */


export interface ModelPresetLite {
  id: string; label: string; kind: string; model: string | null; modelEditable: boolean; tiers: ModelTier[];
  needsKey: boolean; keyHint: string | null; runsOn: 'provider-api' | 'this-computer' | 'chausar-engine';
  consentText: string; consentDigest: string; verification: 'not-live-verified' | 'built-in'; verificationNote?: string | null;
  availability: ModelAvailability; availabilityReason: string;
}
export interface ModelConnectionLite {
  id: string; presetId: string; model: string | null; tiers: ModelTier[]; status: 'connected' | 'disconnected'; consentedAt: string;
  keyLoaded: boolean; usable: boolean; reason: string; verificationNote?: string | null;
}
export interface ModelTierLite { presetId: string; model: string | null; usable: boolean; reason: string; verificationNote?: string | null }
export interface ModelStatusLite {
  connections: ModelConnectionLite[]; tiers: Record<ModelTier, ModelTierLite>;
  /** Engine-formatted, for example 'USD 0.0042 (estimate, price unconfirmed)'. */
  spentThisMonthDisplay: Display; estimate: boolean;
  sendPolicy: 'nothing' | 'shape' | 'samples'; replay: { active: boolean; label: 'synthetic recording' | null };
  /** 4F2 (M7): on connect's answer only, when the new key took over work an earlier one did: who now pays, in words. */
  payerLine?: Display;
}
export interface ModelConnectParams { presetId: string; consentDigest: string; apiKey?: string; model?: string; tiers?: ModelTier[]; monthlyCapUsd?: string }
export interface AiOptionsLite { presets: ModelPresetLite[]; status: ModelStatusLite; unchecked: boolean }

/** `venture.blueprint.get` and `.update` (BlueprintView), trimmed. Prices arrive only as receipts. */

export interface LabelledLite<T> { value: T; label: LineLabel; by: 'owner' | 'model' | 'template' | 'engine'; estimate?: true }

export interface OfferLite {
  id: string; name: LabelledLite<string>; description: LabelledLite<string>;
  /** The flagship playbook offer this is, for example 'licensed-clips'; absent on other plans. It decides the rights asked at intake. */
  playbookOffer?: string;
  /** 4J8: an offer the owner added; its words are the owner's and the owner may take it out (patch.removeOffer). */
  addedByOwner?: true;
  /** unitPriceMinor is engine data the UI only tests for null ("Set your price"); it never formats it. */
  pricing: {
    model: PricingModel; quantityUnit: 'month' | 'project' | 'hour'; unitPriceMinor: string | null; unitPriceLabel: 'told-by-you' | 'not-set'; defaultQuantity: string;
    /** 5A2: priced as a share of an amount the client confirms later, in place of a fixed price; absent otherwise. */
    share?: SharePrice;
  };
}
export interface BlueprintStepLite { id: string; title: LabelledLite<string>; doneBy: 'agent' | 'you' | 'agent-then-you'; capability: 'drafts-now' | 'planned' | 'yours'; note: string }
/**
 * `PlanFlagshipStep`: one step a flagship playbook delivers with, and who does it. who is the agent's role ('Packager'),
 * the code's name ('Calculator'), or another person ('CA of record'). The plan lists these in place of deliverySteps.
 */
export interface FlagshipStepLite { id: string; title: LabelledLite<string>; doneBy: 'you' | 'agent' | 'code' | 'person'; who: string }
/** The plan About you showed: its name, its offers and who wrote them (the AI's reading, or the keywords or a tile). */
export interface KeptShownLite { name: string; by: 'model' | 'template'; callId?: string; offers: { name: string; line: string }[] }
export interface BlueprintLite {
  country?: CountryLite;
  id: string; at: string; version: number; status: 'draft' | 'accepted'; source: 'model' | 'template' | 'owner'; digest: string; serviceType: ServiceType;
  name: LabelledLite<string>; oneLiner: LabelledLite<string>; customer: LabelledLite<string>;
  offers: OfferLite[]; deliverySteps: BlueprintStepLite[]; approvals: LabelledLite<string>[];
  backOffice: {
    taxRateBps?:string;taxState?:string|null;lutConfirmed?:boolean;
    /** C5 task 13. */
    taxRateBy?:string;taxId?:string|null;
    currency: string; taxLabel: string; taxRegistered: LabelledLite<boolean>; invoiceKind: 'tax-invoice' | 'invoice';
    taxInvoiceReady: boolean; taxInvoiceMissing: string[]; paymentRail: string;
  };
  starterConnectorIds: string[];
  /** A flagship playbook's plan only: the steps that run, shown in place of deliverySteps. */
  flagshipSteps?: FlagshipStepLite[];
}
/** `RightsBasis` in platform/runtime/venture/delivery/rights.ts. */
export type RightsBasisLite = 'own-footage' | 'licence' | 'creator-clip-programme';
/**
 * `OfferIntakeAsk`: what an order for a flagship offer asks. rights: the bases it accepts (empty: no footage is cut).
 * calendar: a social content calendar's month, channels, posts per channel and weekdays; clientRules: the client's word lists.
 */
export interface OfferIntakeLite {
  rights: RightsBasisLite[]; fields: ('format' | 'aiVoice' | 'aiPresenter' | 'paidPromotion' | 'cutFile' | 'calendar' | 'clientRules')[];
  /** 5A1: a kit offer's own intake fields (kept under the order's intake.fields); absent on the flagships. */
  kit?: { id: string; label: string; help: string; kind: 'rights' | 'choice' | 'yes-no' | 'text' | 'list' | 'date' | 'money' | 'file' | 'consent' | 'people'; required: boolean; options?: string[] }[];
}
/** `OrderIntake.calendar`: weekdays are ISO numbers, 1 Monday to 7 Sunday. The engine plans the dated slots from it. */
export interface CalendarIntakeLite { month: string; channels: string[]; postsPerChannel: number; weekdays: number[] }
/** `OrderIntake.clientRules`: the client's own word lists; a missing list is empty. */
export interface ClientRulesLite { bannedWords?: string[]; bannedTopics?: string[]; competitors?: string[]; protectedPhrases?: string[] }
/** intake: by offer id, worked out by the engine; absent when no offer asks anything at intake. */
export interface BlueprintViewLite { blueprint: BlueprintLite; offerReceipts: Record<string, ReceiptLite | null>; playbook?: PlaybookPick; intake?: Record<string, OfferIntakeLite>; /** W6 6C3: the profession's sourced ranges, information only. */ priceGuide?: PriceGuideView; /** C4 task 33: the owner's own price applied on Save, with its Undo row. */ decided?: { line: string; undoRowId: string } }
export interface BlueprintPatchLite {
  countryCode?: string;
  /** C5 task 13: I charge GST, on Prices (core/blueprint.ts applyTaxPatch). */
  taxRegistered?: boolean; taxRate?: string; taxId?: string | null; taxState?: string | null; sacCode?: string | null;
  name?: string; oneLiner?: string; customer?: string;
  /** share (5A2): a share of an amount the client confirms later, as percent text ('8.33'), in place of a fixed price; null takes it away. */
  offers?: { id: string; name?: string; description?: string; unitPrice?: string | null; pricingModel?: PricingModel; share?: { percent: string } | null }[];
  /** 4J8: a new offer of the owner's, with no price yet; and taking out an offer the owner added. */
  addOffer?: { name: string; description: string; pricingModel: PricingModel } | {youtubeService:string};
  removeOffer?: { id: string };
}

/** `venture.build.*` (BriefRecord, HandoffPlan, HandoffRecord, BuildFollowRecord, BuildStatus), trimmed. */
export type BuilderId = 'lovable' | 'replit' | 'bolt' | 'v0';
export interface BriefLite {
  id: string; at: string; briefId: string; version: number; markdown: string; chars: number; wordsBy: 'model' | 'template' | 'mixed';
  lint: { ok: boolean; findings: { rule: string; line: number | null; message: string }[] }; estimate?: true;
}
export interface HandoffPlanLite {
  handoffId: string; builder: BuilderId; mode: 'link' | 'copy'; url: string; clipboardText: string | null;
  notes: string[]; label: 'handoff'; status: 'available' | 'planned';
}
export interface HandoffLite { id: string; at: string; builder: BuilderId; mode: 'link' | 'copy' | 'file'; openedAt: string | null }
/** C5 task 35: only Lovable and Replit take the brief as a file. */
export type FileBuilderId = 'lovable' | 'replit';
export interface BriefFilePlanLite { handoffId: string; builder: BuilderId; files: { name: string; text: string }[] }

export interface BuildStatusLite {
  word: BuildStatusWord; asOf: string;
  repo: { fullName: string; private: boolean | null; defaultBranch: string | null; htmlUrl: string | null };
  lastCommit: { sha: string; at: string; by: 'lovable' | 'replit' | 'you' | 'repo-account' | 'other'; message: string } | null;
  briefMarker: 'found' | 'older' | 'missing' | 'not-checked'; briefMarkerVersion: number | null;
  uiWorkflow: 'found' | 'needs-fix' | 'missing' | 'not-checked'; checks: 'passed' | 'failed' | 'none-reported' | 'not-readable';
  /** The address is shown as text, never as a link. */
  deployment: { host: string | null; url: string; at: string } | null;
  syncConflictBranch: string | null; cannotSay: string[];
}
export interface BuildFollowLite { id: string; repo: { owner: string; name: string }; tokenState: 'none' | 'in-memory'; linkedAt: string; lastStatus: BuildStatusLite | null }
export interface BuildStatusView { follow: BuildFollowLite | null; brief: BriefLite | null; handoffs: HandoffLite[]; tokenLink: string; linkFits?: { lovable: boolean; replit: boolean } | null }

/**
 * `workspace.custody.*` and `workspace.backups.*` (platform/runtime/workspace-custody-contracts.ts), trimmed. A recovery
 * code arrives once, in the reply that made it; the UI shows it once and keeps no copy.
 */
export type UnlockMode = 'this-computer' | 'passphrase';
/** One-shot C3: animations follow this computer's reduce-motion setting ('system') or are off for the whole app. */
export type MotionPreferenceLite = 'system' | 'off';
/** The app's preferences on this computer (platform/runtime/app-preferences.ts AppPreferences). */
export type AppLanguageLite = 'en' | 'hi';
export interface AppPreferencesLite { motion: MotionPreferenceLite; language: AppLanguageLite }

export interface CustodyViewLite {
  computer: { available: boolean; scheme: string | null; reason: string | null; checked: boolean; where: string; loss: string | null };
  business: {
    folder: string; unlock: UnlockMode; recovery: 'made' | 'not-made' | 'unknown'; storage: 'experimental-file' | 'postgres';
    backups: { auto: boolean; count: number; newestAt: string | null; nextDueAt: string | null; lastError: string | null; copy: BackupCopyLite | null };
    /** C4 task 36: the name the save dialog offers for an export. */
    exportName?: string;
    /** C4 task 37: the exports in Chausar's own folder, which Delete keeps. */
    exportsHere?: number;
    /** C4 task 38: when a move file was made, until the owner dismisses the line. */
    moveMadeAt?: string | null;
    /** C5 task 19: how big the business is, and the most it can be. */
    storeBytes: number; storeLimit: number;
  } | null;
}
export type RecoveryLite = 'made' | 'not-made' | 'unknown';
/** C5 task 23: the drive or folder backups are copied to: its last name only, never a path. problem: the engine's words. */
export interface BackupCopyLite { folderName: string; lastCopiedAt: string | null; problem: string | null }
/** C5 task 24. */
export interface DriveStatusLite { state: 'not-connected' | 'connecting' | 'connected'; lastCopiedAt: string | null; problem: string | null }
/** C5 task 21: the pick's token and what the engine asked for; never a path. */
export interface CopyImportInput { token: string; passphrase?: string; recoveryCode?: string; restore?: true }
export interface CopyImportResult { workspace: WorkspaceLite; folder: string; unlock: UnlockMode; restored?: boolean }
/** after (C5 task 20): what came just before it, while the business is open. */
export interface BackupLite { /** D12: saved by a newer Chausar than this one. */ needsNewer?: true; file: string; kind: 'auto' | 'manual' | 'safety' | 'migration' | 'rollback-kept'; at: string; revision: number; bytes: number; name: string | null; opensNow: boolean; after?: string }
/** One-shot C6: what a backup of the open business holds and what changed since (restoring takes these back). */
export interface BackupInspectLite {
  file: string; at: string;
  counts: { kind: string; words: string; count: number }[];
  since: { kind: string; words: string; added: number; changed: number; removed: number }[];
}
/** The vault's own record of a business, as workspace.open, .recover, .restore and the moves return it (trimmed). */
export interface WorkspaceLite { id?: string; name: string }
/**
 * `workspace.transfer.export`: the move file's text and its one-time code. Both arrive once; the UI saves the text only
 * when the owner asks and keeps neither after the screen that showed them.
 */
export interface MoveFile { fileName: string; text: string; transferCode: string; bytes: number }
/** `workspace.delete`: what the engine removed, and its words for the copies it cannot reach. */
/** exportsKept (one-shot A1, row 1): the copies the owner exported, which Delete leaves where they are. */
export interface Deleted { deleted: true; copiesRemoved?: unknown; exportsKept?: string[]; externalCopies: string; /** C4 task 37 */ name?: string; backupsRemoved?: number }

/**
 * `venture.client.list` and `venture.client.add` (ClientRecord), trimmed. Client details are client data. `owed` is
 * what the client owes on open invoices, formatted by the engine, with the receipt behind it. Without it the row shows
 * nothing owed; the UI never adds up invoices itself.
 */
export interface ClientLite {
  aiConsent?: ClientAiConsent;
  self?: true;
  id: string; at: string; name: string; email: string | null; countryCode: string | null; taxId: string | null; stateCode: string | null; note: string | null;
  /** One-shot C6: the phone or WhatsApp number as typed, and its WhatsApp digits (only ever used to open WhatsApp). */
  phone?: string | null; whatsapp?: string | null;
  owed?: { display: Display; receiptId: string };
}
export interface ClientAddParams { name: string; email?: string; countryCode?: string; taxId?: string; stateCode?: string; note?: string; phone?: string }
export type { ClientAiConsent, ClientAiConsentView, ClientAiDefaultView } from '../../../../platform/runtime/venture/clients/ai-consent-core';
import type { SearchProviderId, WebSearchView, WebReadView } from '../../../../platform/runtime/venture/web/search-types';
import type { PeopleLookupView, PeopleSearchView } from '../../../../platform/runtime/venture/people/people-types';
import type { FlowsActPayload, FlowsActView, FlowsListView } from '../../../../platform/runtime/venture/flows/flow-types';
import type { FindRequest, FindView } from '../../../../platform/runtime/venture/views/find-core';
export type { FindGroup, FindHit, FindItem, FindKind, FindRequest, FindSnippet, FindView } from '../../../../platform/runtime/venture/views/find-core';
export type { FlowsActPayload, FlowsActView, FlowsListView, FlowVersionView, FlowRunView } from '../../../../platform/runtime/venture/flows/flow-types';
export type { SearchProviderId, WebSearchView, WebReadView, PeopleLookupView, PeopleSearchView };
// W6 6G3 (D44) the CRM, and 6G4 dated memory: the engine's own view types (crm/crm-data.ts, memory/facts-data.ts).
import type { ClientCrmView, CompanyRow, CompanyView, CrmEntryKind, CrmListRow, CrmListView, CrmMemberView, FieldChangeView, TimelineEntryView } from '../../../../platform/runtime/venture/crm/crm-data';
import type { FactView, FactVisibility, MemoryChange, MemoryView } from '../../../../platform/runtime/venture/memory/facts-data';
// W6 6I1 push-to-talk: the engine's own shapes (agents/talk-core.ts is browser-safe).
export type { TalkConsentInput, TalkHeard, TalkSaid, TalkSetupInput, TalkStarted, TalkView } from '../../../../platform/runtime/venture/agents/talk-core';
import type { TalkConsentInput, TalkHeard, TalkSaid, TalkSetupInput, TalkStarted, TalkView } from '../../../../platform/runtime/venture/agents/talk-core';
// W6 6J2 feedback: the engine's own shapes (core/feedback-core.ts is browser-safe).
export type { FeedbackAnswerInput, FeedbackConsentInput, FeedbackCrashInput, FeedbackCrashKept, FeedbackPreview, FeedbackView } from '../../../../platform/runtime/venture/core/feedback-core';
import type { FeedbackAnswerInput, FeedbackConsentInput, FeedbackCrashInput, FeedbackCrashKept, FeedbackView } from '../../../../platform/runtime/venture/core/feedback-core';
// W6 6H1 (D39): mini apps. The permission names and bridge tools live in the browser-safe apps/frame.ts.
import type { AppPermission } from '../../../../platform/runtime/venture/apps/frame';
export type { AppPermission };
export interface MiniAppMessage { at: string; from: 'owner' | 'chausar'; text: Display; version: number | null }
/** An app on the Apps place: reads are the chips that say what it reads or uses; allowed: it may run now. */
export interface MiniAppCard { id: string; name: string; version: number; summary: Display; reads: Display[]; pinned: boolean; madeAt: string; allowed: boolean }
/** One app, opened (apps/apps.ts appView): its frame document, versions, permission screen (ask) and the tools that answer now. */
export interface MiniAppView extends MiniAppCard {
  uri: string; document: string;
  /** C4 task 29: the app reads the business, and every read it may make has nothing to show now. */
  empty: boolean;
  versions: { version: number; at: string; summary: Display; current: boolean }[];
  permissions: { id: AppPermission; verb: 'Read' | 'Keep' | 'Use' | 'Propose'; line: Display }[];
  grant: { permissions: AppPermission[]; at: string } | null;
  ask: { digest: string; added: AppPermission[]; first: boolean } | null;
  tools: string[];
  messages: MiniAppMessage[];
  never: Display;
}
/** What the bridge answers for one tools/call, in the MCP CallToolResult shape. */
export interface MiniAppCallResult { content: { type: 'text'; text: string }[]; structuredContent: unknown; isError: false }
export type { ClientCrmView, CompanyRow, CompanyView, CrmEntryKind, CrmListRow, CrmListView, CrmMemberView, FieldChangeView, TimelineEntryView, FactView, FactVisibility, MemoryChange, MemoryView };
import type { ClientAiConsent, ClientAiConsentView, ClientAiDefaultView } from '../../../../platform/runtime/venture/clients/ai-consent-core';
import type { AiSettings, AiSettingsView } from '../../../../platform/runtime/venture/agent-runtime/settings';
import type { AgentApprovalRequest } from '../../../../platform/runtime/venture/agent-runtime/driver-types';
/** `venture.order.list` (OrderRecord), trimmed. `request` is what the client asked for, typed by the owner. */
export type OrderStatus = 'open' | 'invoiced' | 'delivered' | 'cancelled';
export interface OrderLite {
  narrationFetched?: {fileId:string;url:string;finalUrl:string;digest:string};
  internal?: true;
  id: string; at: string; clientId: string; offerId: string; quantity: string; request: string; status: OrderStatus;
  priceReceiptId: string; deliveredOn: string | null;
  /** Wave 6 (6D1): when the whole order is due; (6D4) the owner's own price in a client's currency. */
  dueDate?: string;
  foreignPrice?: { currency: string; unitPriceMinor: string };
  /** OrderRecord.intake, trimmed (a flagship offer's intake). cutFile: the finished cut on this computer, desktop only. */
  intake?: { calendar?: CalendarIntakeLite; clientRules?: ClientRulesLite; rights?: { basis: RightsBasisLite; holder: string; reference: string | null; scope: string | null; expiresOn: string | null; recordedAt: string; recordedBy: string } | null; aiVoice?: boolean; aiPresenter?: boolean; paidPromotion?: boolean; format?: 'long' | 'short'; cutFile?: string | null; fields?: Record<string, string | boolean | readonly string[] | readonly { name: string; consentId: string | null }[] | null> };
  /** 4J3: the order's stage steps from the records, and what waits on the owner ("2 wait on you: ..."), or null. */
  stages?: OrderStageView[];
  waitsOnYou?: OrderWaitsOnYou | null;
  /** C4 task 11: the order's price as its receipt's Total figure says it, with the receipt id; null without a receipt. */
  price?: { display: string; receiptId: string } | null;
}
/**
 * 4J3: one stage of an order (the engine's playbooks/order-stages.ts lists them per playbook). id and state are codes
 * the screen words for itself in English and Hindi; detail and line are the engine's English. waits is on the owner;
 * waitsOn names the CA or the client when it waits on them; due is the day a payment is due. reason is a code for the
 * detail, for the screen's own words; an engine-failed draft is 'failed', never 'stopped'.
 */


export interface OrderStageView {
  id: OrderStageId; label: Display; state: 'done' | 'waits' | 'not-yet' | 'always-asks' | 'unknown'; detail: Display; line: Display;
  waitsOn?: 'you' | 'ca' | 'client'; due?: string; reason?: OrderStageReason;
}

/** `venture.files.list` (UploadView), trimmed: a file a client sent, kept in the vault. */
export interface UploadLite {
  /** transcript: an SRT or VTT file of what was said, with timings. image: an order's poster, a still from its cut (4J3). */
  id: string; at: string; name: string; format: 'docx' | 'csv' | 'xlsx' | 'pdf' | 'transcript' | 'image' | 'audio'; bytes: number;
  /** media (5A4): an order's photos (cleaned of location data when added) and recordings, apart from the files agents read. */
  scope: { kind: 'order'; orderId: string } | { kind: 'practice'; scenarioId: string } | { kind: 'poster'; orderId: string } | { kind: 'media'; orderId: string }; clientData: boolean;
  /**
   * Where it came from: absent or 'client', a transcript made on this computer from the cut (venture.files.transcribe),
   * or a still from the cut (venture.files.poster, 4J3; never listed by venture.files.list).
   */
  origin?: 'client' | 'local-transcription' | 'poster';
}
/** `venture.delivery.list` (DeliveryRunView), trimmed to what a client's sheet shows. */
export type DeliveryStatus = 'waiting-for-you' | 'needs-answer' | 'brief-waiting' | 'ready-for-review' | 'accepted' | 'edited' | 'rejected' | 'failed'
  | DeliveryStatusW4; // 4F3 folds in 'stopped': the owner's (or Chausar's) stop, waiting for Resume
export interface DeliveryLite {
  id: string; at: string; orderId: string; status: DeliveryStatus; practice: boolean;
  deliverable: { title: string } | null; verdict: { choice: 'accepted' | 'edited' | 'rejected'; reason?: string | null; at: string } | null;
  /** DeliveryRunView: the run waits on the owner (it is on Today). The engine always sends it. */
  awaitingYou?: boolean;
  /**
   * Ink v2 wave 2 (2C2), from DeliveryRunView: the code checks and the judge's verdict ('rules-judge') in the engine's
   * words, a flagship playbook's own checks, whether the engine would take Accept now and why not, and the judge's
   * call on this draft. The engine always sends them; samples and older tests may leave them out.
   * servedBy 'template': an outline no AI wrote (the judge never reads one). practiceNow: a practice draft at today's
   * launch stage, which `practice` alone does not say (a model draft before approve each is practice too).
   */
  servedBy?: 'model' | 'template' | 'owner';
  practiceNow?: boolean;
  checks?: CheckLite[];
  playbookChecks?: PlaybookCheckLite[];
  canAccept?: boolean;
  acceptBlocked?: Display | null;
  /** One-shot A3 (S2): the owner may edit this draft on Today, also when its only block is a failed check. */
  canEdit?: boolean;
  judge?: DeliveryJudgeLite;
  /** Ink v2 wave 4 (4H1, U17): which engine wrote the draft, in the engine's words ("Written by Claude Sonnet 5.5"); null before an answer. */
  writtenBy?: Display | null;
  /** 4J2: the draft that went out which this owner draft was copied from (venture.delivery.copy). */
  copiedFrom?: string;
  /** 4J19: DeliveryRunRecord's text, which DeliveryRunView carries: the agent's draft, and the owner's own version once edited. */
  renderedText?: string | null;
  editedText?: string | null;
}
/** CheckResult: notChecked (rules-judge only) is neither a pass nor a failure: no rule was settled with checked evidence. */
export interface CheckLite { check: string; passed: boolean; detail: Display; notChecked?: true }
/** PlaybookCheckResult: 'not-run' says why a check could not run; it is never a pass, and blocks nothing. */
export interface PlaybookCheckLite { playbook: string; check: string; outcome: 'pass' | 'fail' | 'not-run'; detail: Display }
/**
 * DeliveryRunRecord.judge, trimmed: the judge's call on this draft. 'waiting' holds the preview "Send to the judge"
 * sends (by its digest); auto: it went, or waits, under the business's judge setting; line: why it did not run or
 * failed, in the engine's words. The verdict itself is the rules-judge result in `checks`.
 */
export interface DeliveryJudgeLite {
  status: 'waiting' | 'done' | 'failed';
  preview: { digest: string; estimatedMaxCostDisplay: Display } | null;
  auto?: boolean; estimatedMaxCostDisplay?: Display | null; line?: Display | null; draftDigest?: string;
}
/**
 * `venture.invoice.list` (InvoiceRecord), trimmed to what an order's state needs. `number` is null until issued.
 * `total` and `receiptId` (the price receipt) come with each row of the list, so a list needs no invoice.get per row.
 */
export interface InvoiceLite {
  id: string; at: string; orderId: string; clientId: string; number: string | null;
  status: 'draft' | 'issued' | 'part-paid' | 'paid' | 'void'; issueDate: string | null; dueDate: string | null;
  total?: Display; receiptId?: string;
  /** 4J5: on venture.invoice.list rows, the invoice's one next step. */
  next?: InvoiceNext;
  /** 4J4: an open invoice past its due day ("71 days late"). */
  late?: { days: number; line: Display };
  /** Wave 6 (6D1): the part of its order a list row bills, when it bills a part. */
  part?: { kind: 'advance' | 'milestone' | 'partial' | 'final'; label: string };
  /** One-shot C4 (T20): true only once the owner marked it sent; opening their own app with it is not sending. */
  sent?: boolean;
}
/**
 * `venture.invoice.get`, `.prepare`, `.issue` and `venture.payment.record` (InvoiceView), trimmed. Amounts reach the UI
 * only as engine-formatted `figures`; the minor-unit fields of the engine records are left out on purpose, so no screen
 * can add them up. The price receipt covers subtotal, tax and total; each payment's books receipt covers that payment.
 */
/**
 * 'cheque' (4J5): pending until the owner clears it (venture.payment.clear) or a bank row pays it. PAYMENT_METHODS is
 * the payment sheet's list; cheque joins it with its text key when the Money screens fold it in (4J20).
 */

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['bank-transfer', 'upi', 'card', 'cash', 'payment-link', 'other'];
/** state (4J5): absent on payments recorded before, which read as cleared; chequeOn: the day a cleared cheque came. */
export interface PaymentLite {
  id: string; at: string; invoiceId: string; receivedOn: string; method: PaymentMethod; booksReceiptId: string | null; booksNote: string | null;
  state?: 'pending' | 'cleared'; chequeOn?: string; split?: { groupId: string }; tds?: { section: string };
}
/** 4J5 (M12): an invoice's one next step by its state, in the engine's words. draftId: a reminder drafted, not sent yet. */
export interface InvoiceNext { action: 'issue' | 'wait' | 'remind' | 'clear' | 'none'; line: Display; draftId?: string }
/** 4J5 (M12): one line of an invoice's short timeline, events by date, then where it stands now. */
export interface InvoiceTimelineEntry {
  what: 'issued' | 'viewed' | 'paid' | 'cheque' | 'credited' | 'reminder' | 'reminded' | 'awaiting' | 'settled' | 'shared' | 'marked'; on: string; line: Display;
  /** One-shot C4 (T20): on a 'shared' line, how the owner shared it. */
  how?: 'whatsapp' | 'email' | 'file';
}
export interface InvoiceViewLite {
  country?: CountryLite;
  /** C5 task 12: the method a new payment starts from (money/invoices.ts paymentDefaultsOf). */
  paymentDefaults?: { method: PaymentMethod };
  invoice: InvoiceLite & {
    currency: string; dueInDays: number; digest: string; documentTitle: string;
    priceReceiptId: string; booksReceiptId: string | null; booksNote: string | null;
    /** Wave 6 (6D1): the part of its order this invoice bills, its terms line and its own reminder days. */
    part?: { kind: 'advance' | 'milestone' | 'partial' | 'final'; label: string };
    terms?: string;
    reminderDays?: number[];
  };
  client: { id: string; name: string };
  receipt: { id: string; stale: boolean };
  payments: PaymentLite[];
  documentText: string;
  figures: PriceFigureLite[];
  notes: string[];
  /** 4J5: the next step, the timeline, the credit notes, and on a draft whose rate is no longer the plan's, the change. */
  next?: InvoiceNext;
  timeline?: InvoiceTimelineEntry[];
  credits?: CreditNoteView[];
  rateChange?: { charged: string; now: string; line: Display };
  /** 4J20: an open invoice past its due day. */
  late?: { days: number; line: Display };
  /** Wave 6 (6D1): how much of a part-billed order is billed and left, as engine text. */
  billed?: { orderTotal: Display; billed: Display; left: Display; invoices: number };
  /** Wave 6 (6D2, 6D3): how the client pays, built by the engine from the balance. */
  howToPay?: HowToPayLite;
  /** One-shot C4 (T20): true only once the owner marked it sent. */
  sent?: boolean;
  /** One-shot C6: an issued invoice with nothing left to pay. */
  paidInFull?: boolean;
}

/** Wave 6 (6D2, 6D3): an invoice's ways to pay, as text and a QR code the engine drew; no amount the UI could add up. */
export interface HowToPayLite {
  upi: { id: string; payeeName: string; link: string; qr: { version: number; size: number; rows: string[] }; amount: Display; reference: string; receiptId: string } | null;
  bank: { accountName: string; accountNumber: string; ifsc: string | null; swift: string | null; bankName: string | null } | null;
  upiNote: Display | null;
  payLink: { id: string; shortUrl: string; status: 'created' | 'partially_paid' | 'expired' | 'cancelled' | 'paid'; checkedAt: string | null; label: 'fixture-tested' } | null;
  payLinkOffer: { amount: Display; currency: string; digest: string; label: 'fixture-tested' } | null;
}
/** Wave 6 (6D1, 6D2, 6D3): the owner's billing settings (money/billing.ts). */
export interface BillingSettingsLite {
  dueInDays: number; terms: string | null; reminderDays: number[]; upiId: string | null; payeeName: string | null;
  bank: { accountName: string; accountNumber: string; ifsc: string | null; swift: string | null; bankName: string | null } | null;
  razorpay: { mode: 'test' | 'live'; keyHint: string; savedAt: string } | null;
}
export interface BillingView { settings: BillingSettingsLite; defaults: { dueInDays: number; reminderDays: number[] }; razorpayLabel: 'fixture-tested' }
export type BillingPatch = Partial<Omit<BillingSettingsLite, 'razorpay' | 'bank' | 'dueInDays' | 'reminderDays'>> & {
  /** Days as typed text or whole numbers; the engine reads and checks them. */
  dueInDays?: number | string; reminderDays?: (number | string)[];
  bank?: { accountName: string; accountNumber: string; ifsc?: string | null; swift?: string | null; bankName?: string | null } | null;
  razorpayKeys?: { keyId: string; keySecret: string } | null;
};
/** Wave 6 (6D2): an issued invoice's file and the links that open the owner's own WhatsApp or mail app. */
/**
 * One-shot A6: what the desktop opened for Email it or Share on WhatsApp (app/desktop/invoice-share.cjs). email: 'draft'
 * is an .eml with the file attached in the mail app, 'link' the mail link without the file, 'none' nothing opened;
 * to says whether the client's email is filled in; attached is the name the client gets, while file is the copy kept
 * on disk (maybe INV-0001-2.pdf), for Show the PDF in its folder. whatsapp: the desktop app or the web page, never
 * with the file.
 */
/** One-shot C6: what the desktop did with a payment's receipt: kept it, and opened WhatsApp when asked. */
export type ReceiptShareResult = { how: 'whatsapp'; opened: 'app' | 'web'; file: string; note: string | null } | { how: 'save'; opened: 'none'; file: string; note: string | null };
export type InvoiceShareResult =
  | { how: 'email'; opened: 'draft' | 'link' | 'none'; file: string; attached: string; to: boolean; note: string | null }
  | { how: 'whatsapp'; opened: 'app' | 'web'; file: string; note: string | null };

export interface InvoicePdfView {
  fileName: string; format: 'pdf' | 'html'; mimeType: 'application/pdf' | 'text/html'; contentBase64: string; note: Display | null;
  share: { text: string; subject: string; whatsappUrl: string; mailtoUrl: string };
}

/**
 * Onboarding (spec section 4, Onboarding): the shapes the one-sentence start reads. `venture.countries` and
 * `venture.preview` are answered before any vault exists; `workspace.create` makes the vault; then `venture.create`, the
 * template interview and `venture.blueprint.draft` run inside it. Source: platform/runtime/venture/contracts.ts
 * (CountryProfile, PlanPreview, InterviewView) and platform/runtime/engine.ts (workspace.status, workspace.create).
 */
export interface CountryLite { code: string; name: string; currency: string }
export interface PlanPreviewLite {
  idea: string; country: CountryLite; serviceType: LabelledLite<ServiceType>; serviceLabel: string; oneLiner: LabelledLite<string>;
  by: 'template'; saved: false;
  playbook?: PlaybookPick;
}
/**
 * A business started on the hosted app without an account (Ink v2 wave 4, 4J23; platform/runtime/hosted/trial.ts): the
 * one line to show, when it is deleted unless the owner adds their email, and the warning in its last day.
 */
export interface HostedTrialView { temporary: true; line: string; expiresAt: string; endsSoon: boolean; warning: string | null }
/** `workspace.status`. `hosted` comes only from the hosted web server: the account's businesses, and `trial` while temporary. */
export interface WorkspaceStatusLite {
  open: boolean; workspace?: { name: string } | undefined; unlock?: string | undefined; closedByOwner?: boolean | undefined;
  experimental?: boolean | undefined; hosted?: { businesses: { id: string; name: string }[]; trial?: HostedTrialView | null | undefined } | undefined;
}
/** `workspace.create`. On this computer `folder: null` lets the engine pick the folder; hosted takes no folder. */
export interface WorkspaceCreateParams { name: string; pack: 'services'; folder?: null; passphrase?: string }
/** `recoveryCode` is not null only with a passphrase or on hosted, and the engine sends it this once. */
export interface WorkspaceCreated { workspace: { name: string }; folder?: string; unlock?: 'this-computer' | 'passphrase'; recoveryCode: string | null; recoveryKit?: string | null; experimental?: boolean }
/** assumed: only { yes: false, assumed: true } on q_tax, when the owner left tax unanswered (the engine keeps it as an assumption). */

export interface InterviewQuestionLite {
  id: string; kind: 'choice' | 'text' | 'money' | 'yesno' | 'rate'; text: string; choices: { id: string; label: string }[];
  required: boolean; prefill: string | null; answer: InterviewAnswer | null;
}
export interface InterviewViewLite { interview: { questions: InterviewQuestionLite[] }; done: boolean }

/**
 * `venture.queue.view`: what a queue row's viewRef points at (a draft, a file, a plan), in words the owner reads before
 * approving. Not an engine method yet: P3-wire answers it from venture.delivery.list (draft), venture.invoice.get
 * (file) and venture.blueprint.get (plan). Text only; figures arrive formatted.
 */
/** C4 task 16: an amount in a draft's words, as the engine matched it. */
export type DraftAmount = { display: Display; receiptId?: string; receiptKind?: 'work'; estimate?: true };


// ---------------------------------------------------------------------------------------------------------------
// Ink v2 wave 2: the views of the newly wired engine pieces (contracts.ts section 9d), trimmed to what screens read.
// Every figure arrives as engine text; a file the engine built (the calendar CSV) is saved as it came.
// ---------------------------------------------------------------------------------------------------------------

/** `venture.delivery.judge`: the judge's call on a ready draft, waiting for "Send to the judge" with this digest. */
export interface JudgePreview { runId: string; digest: string; estimatedMaxCostDisplay: Display; containsClientData: true }
/**
 * `venture.judge.auto.get` and `.set`: whether the judge runs on its own on every ready draft for a client or the
 * public (on by default), when its standing consent was recorded (null until then, or while off), and the engine's
 * line for the setting's sheet, which says the client's words go to the owner's AI.
 */
export interface JudgeAutoView { auto: boolean; consentAt: string | null; line: Display }
/**
 * `venture.transcription.get` and `.set`: the owner's whisper.cpp (full paths to whisper-cli and its model file, null
 * when not set up), its status checked on disk by the engine, whether ffmpeg is here too, and the engine's plain line.
 */

/**
 * `venture.simulation.scenarios` (Scenario), trimmed: a made-up practice client. Its words hold no client data.
 * source 'signal': a case made from a draft the owner rejected or edited, or one that failed a check.
 */
export interface ScenarioLite { id: string; serviceType: ServiceType; title: string; persona: string; source: 'template' | 'signal'; files?: string[] }
/**
 * `venture.simulation.run` (SimulationRunRecord), trimmed: one rehearsal. firstFailure is what failed first, as the
 * engine names it (a check id, a judge question or a sentence); the checks hold each check's own words.
 * costDisplay is the engine's text, marked when it is an estimate.
 */
export interface EpisodeLite { scenarioId: string; index: number; passed: boolean; firstFailure: string | null; checks: CheckLite[]; playbookChecks?: PlaybookCheckLite[]; /** C4 task 17: the practice draft's text, as the engine's Episode keeps it. */ renderedText?: string | null }
export interface SimulationRunLite {
  id: string; at: string; playbookId: string; scenarioIds: string[]; episodes: EpisodeLite[]; passed: boolean;
  summary: { scenarios: number; passed: number; failed: number }; costDisplay: Display; modelMode: 'model' | 'template' | 'mixed';
}
/** ImprovementReadiness: reason is the engine's words; 'planned' means the loop is not in this build. */
export interface ImprovementReadinessLite { judged: number; rejectedOrEdited: number; due: boolean; reason: Display; status: 'available' | 'planned' }
/** `venture.launch.status` (wave 6, 6C4): the two stages the owner sees; reason is the engine's words for each. */
export interface LaunchStatusView {
  stage: 'practice' | 'live';
  liveSince: string | null;
  stages: { stage: 'practice' | 'live'; allowed: boolean; reason: Display; current: boolean }[];
  acceptedDeliveries: number;
  improvement: ImprovementReadinessLite;
}
/** `venture.improve.run` (ImprovementRunRecord), trimmed. changes: one plain line per change the kept version makes. */
export interface ImprovementRunLite {
  id: string; at: string; status: 'kept-candidate' | 'kept-parent' | 'incomplete'; parentPlaybookId: string; candidatePlaybookId: string | null;
  changes: Display[]; costDisplay: Display; modelMode: 'model' | 'template' | 'mixed'; incompleteReason: Display | null; digest: string;
  rolledBack?: { at: string; by: string };
  /** 4J16 (Q16, mirrored by 4J22a): the rounds the engine sends on the newest run, each change tried as an experiment. */
  rounds?: { round: number; experiment?: ExperimentLite }[];
}
/**
 * 4J16 (Q16): one change tried as an experiment. control null: no real control, so the result is only observed. The
 * budget displays carry no receipt, so the screen does not show them.
 */
export interface ExperimentLite {
  hypothesis: string; change: string; patchId: string;
  control: { kind: 'parent-on-same-cases'; playbookHash: string; cases: number; window: { from: string; to: string } } | null;
  budget: { capMicros: string; capDisplay: Display; spentMicros: string; spentDisplay: Display };
  stopRules: Display[]; rollbackRule: Display;
  result: { kind: 'caused' | 'no-effect' | 'observed'; line: Display };
  /** 4J22a (4J15's lift): on the same paired cases, by code; its line says model estimate when it concludes. */
  lift?: { cases: number; reachable: boolean; direction: 'better' | 'worse' | 'none'; estimate: boolean; line: Display; digest: string } | null;
}
/**
 * `venture.improve.status` (ImprovementStatus): the readiness, the newest run, a kept version waiting to be used
 * (adopted by its run id and digest), and the version in use with what going back takes (rollback null when the engine
 * would refuse it now).
 */
export interface ImprovementStatusLite {
  readiness: ImprovementReadinessLite; activePlaybookId: string | null; latest: ImprovementRunLite | null;
  candidate: { runId: string; playbookId: string; digest: string; changes: Display[] } | null;
  inUse?: { playbookId: string; version: number; hash: string; origin: PlaybookOrigin; rollback: { playbookId: string; version: number; digest: string } | null } | null;
}
/** `venture.improve.rollback` (PlaybookRecord), trimmed: the version now in use. */
/** Who made a playbook version: the engine's own list (platform/runtime/venture/playbook-origins.ts), not a copy. */
import type { PlaybookOrigin } from '../../../../platform/runtime/venture/playbook-origins';
export { PLAYBOOK_ORIGINS, type PlaybookOrigin } from '../../../../platform/runtime/venture/playbook-origins';
export interface PlaybookLite { id: string; version: number; hash: string; origin?: PlaybookOrigin; parentId?: string | null }
/** `venture.posting.propose`: the post waits on Today. `warnings` are the risk gate's, in the engine's words. */
export interface PostingProposal {
  postId: string; connectorId: string; draftId: string; part: number | null;
  state: 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown'; line: Display; warnings: Display[];
}

export interface PostingCandidateLite {
  key: string; kind: 'test-id' | 'role' | 'aria-label' | 'xpath'; value: string; name?: string; lang?: string;
  checkedOn: string | null; addedBy: 'chausar' | 'owner';
}
/** `venture.posting.checkSteps`: `stepsCheckedOn` is the oldest day across the three steps, or null while any has none. */
export interface PostingStepsView {
  connectorId: string;
  steps: { step: PostingStepId; candidates: PostingCandidateLite[]; response?: { key: string; method: string; path: string; checkedOn: string | null } }[];
  stepsCheckedOn: string | null;
  /** The oldest day across the post box and the post button: what a check can date before the first post. */
  boxAndButtonCheckedOn: string | null;
  line: Display;
}
/** `venture.share.recordAnswer`: the client's answer, as the owner recorded it or the client gave it through the link. */
export interface ShareAnswer { draftId: string; decision: 'approved' | 'changes'; comment: string | null; at: string; via: 'share-link' | 'owner-recorded' }
/**
 * `venture.share.list` with a draft's id: one post the draft holds, with the id `venture.posting.propose` takes
 * ('<run id>.post-<n>'). `connectorId` is null when this build has no posting connector for the channel.
 */
export interface DraftPostLite { draftId: string; channel: string; name: string; connectorId: string | null; text: string }
/** The posting limits the owner may set, in the owner's units: posts a day, minutes, days, percent, posts. */
export interface OwnerPostingLimits { capPer24h: number; minGapMinutes: number; warmUpDays: number; duplicatePercent: number; linkStreak: number }
/** `venture.posting.limits.*`: per channel, Chausar's own limits, the owner's settings and those the gate uses. */
export interface PostingLimitsView {
  channels: { connectorId: string; name: string; house: OwnerPostingLimits; owner: Partial<OwnerPostingLimits>; inUse: OwnerPostingLimits }[];
  line: Display;
}
/**
 * `venture.social.calendar`: the CSV the engine built, the name to save it under, its row count, the posts it left out
 * (channel name, words, why), the posts whose cell got an apostrophe (defused), the posts written as threads, and the
 * gaps between the draft's posts and the plan's slots, in the engine's words.
 */

/** `BankAlertRule` in platform/runtime/venture/build/bank.ts. Amounts are minor units as the engine keeps them, as text. */
export type BankAlertRuleLite =
  | { kind: 'balance-below'; minor: string }
  | { kind: 'large-debit'; minor: string }
  | { kind: 'credit-matching'; text: string }
  | { kind: 'credit-missing-by'; text: string; minor: string; by: string };
/**
 * `BankAlertRuleInput`: a rule as Ink sends it. A new rule carries the amount the owner typed (amount), which the engine
 * reads exactly; a kept rule goes back with the engine's own minor units. Ink never turns one into the other.
 */
export type BankAlertRuleInputLite =
  | { kind: 'balance-below' | 'large-debit'; minor?: string; amount?: string }
  | { kind: 'credit-matching'; text: string }
  | { kind: 'credit-missing-by'; text: string; minor?: string; amount?: string; by: string };

/** dateDisplay: the engine's date for the owner's country. flag: the engine's words when the row needs a second look, else null. */
export interface BankLedgerRow {
  id: string; accountId: string; account: string; date: string; dateDisplay: Display; amount: Display; direction: 'in' | 'out';
  description: string | null; counterparty: string | null; classification: BankRowClass; flag: Display | null; pairedWith: string | null;
  suggestion: { invoiceId: string; number: string; line: Display } | null; decided: 'payment' | 'cost' | 'skip' | null;
}
/** consent: the account's bank access in the engine's words, null when never given; provider: why nothing reads the bank yet. */


/** `venture.bank.alerts.*`: each rule in the engine's words, and where alerts go in words only ("Alerts go to the address you set"), never the address. */
export interface BankAlertsView { accounts: { account: string; accountId: string; rules: BankAlertRuleLite[]; ruleLines: Display[]; destination: Display }[] }
/** `venture.ca.receipt`, trimmed: the stored CA receipt worked again from its inputs. */
export interface CaDiffExplanation { receiptId: string; key: string; note: string; caName: string; membershipNo: string; at: string }
export interface CaReceiptView {
  id: string; runId: string | null; engine: string;
  figures: { key: string; label: string; display: Display }[];
  steps: { key: string; label: string; display: Display; section: string | null }[];
  tables: { id: string; version: number; title: string; validFrom: string; validTo: string | null; confirmed: boolean; confirmedBy: string | null }[];
  assumptions: string[]; openQuestions: string[];
  rederived: 'same' | 'differs' | 'table-gone'; differs: { key: string; line: Display } | null;
  explanations: CaDiffExplanation[];
  /** On a portal diff only: each key that is not the same, both sides as the engine wrote them, and the CA's explanation or null. */
  portalDifferences?: { key: string; label: string; state: 'differs' | 'missing-on-portal' | 'only-on-portal'; ours: Display | null; portal: Display | null; explanation: string | null }[];
}
/** W6 6C5: one locked rule as its attestation screen shows it (`venture.rules.locks`). */
export interface LockedRuleLite { id: string; playbook: string; topic: Display; rule: Display; limitations: Display; needs: 'lawyer' | 'ca'; sources: { title: string; url: string }[]; digest: string; attestable: boolean; attestedOn: string | null; line: Display }
/** W6 6C5: `venture.rules.locks` and `venture.rules.attest`: the locked rules, the words the owner ticks, and the hard stops. */
export interface RuleLocksLite { playbook: { id: string; label: string } | null; rules: LockedRuleLite[]; words: Display; line: Display; hardStops: { id: string; line: Display }[] }
/** W6 6C6: `venture.compliance.get` and `.set`: the side-work question, the profession's rules and regulator switches. */
export interface ComplianceLite {
  profession: { id: string; label: Display; family: string | null }; question: Display; responsibility: Display;
  /** One-shot C4 task 3: the engine's line for an owner with no day job. */
  noDayJob: Display;
  /** verdict (W6, 3 November 2026): the engine's line at the owner's size for a statute with a size threshold, else null. */
  rules: { id: string; title: Display; line: Display; checked: boolean; source: { url: string; publisher: string; title: string } | null; checkedOn: string | null; checkedDay: Display | null; size: Display | null; verdict: Display | null }[]; switchedOff: { tool: string; line: Display }[];
  hardStops: { id: string; line: Display }[]; digest: string;
  recorded: { professionId: string; sideWork: 'no-day-job' | 'allowed' | 'not-allowed' | 'not-sure'; acknowledgedOn: string } | null;
  /** W6 (3 November 2026): the size question, asked only when a rule counts size (core/business-size.ts), else null. */
  size: SizeAskLite | null;
}
/** The measures a size question asks, by measure: a range id each. */
export type SizeAnswersLite = { turnover?: string; headcount?: string };
/** W6 (3 November 2026): the size question: its ranges in the engine's words and the saved range id per measure. */
export interface SizeAskLite {
  measures: ('turnover' | 'headcount')[]; line: Display;
  questions: { measure: 'turnover' | 'headcount'; question: Display; choices: { id: string; label: Display }[]; answer: string | null }[];
}
/** `venture.rules.list`: the dated platform rules a flagship playbook's checks rest on. */
export interface PlatformRuleView {
  id: string; platform: string; rule: Display; checkedOn: string; stale: boolean; usedBy: string[]; limitations: string[];
  source: { title: string; url: string } | null;
  /** 5A3: every source; a house rule's is "Chausar's own rule" with no address (url ''). */
  sources: { title: string; url: string }[];
  line: Display;
}
/** 5A3 (P6): a recipe and one row of the measurement-boundaries table, as the engine words them. */


export interface RulesListView {
  playbook: { id: string; label: string; riskLevel: string; lastReviewed: string } | null; rules: PlatformRuleView[]; summary: Display;
  /** 5A3: a kit playbook's recipes and measurement boundaries; empty for the flagships. */
  recipes: RecipeView[]; boundaries: BoundaryView[];
}

// ---------------------------------------------------------------------------------------------------------------
// Ink v2 wave 4: the views the new engine methods answer (contracts.ts section 9e), named by package 4-0. Every figure
// arrives as engine text with its receipt; a model number is labelled an estimate. Times and days are ISO text.
// ---------------------------------------------------------------------------------------------------------------

/** `DeliveryRunStatus` 'stopped' (4F1): not in DeliveryStatus yet, for the same reason as QueueKindW4 (4F3 folds it in). */
export type DeliveryStatusW4 = 'stopped';
export type DepartmentId = 'sales' | 'marketing' | 'production' | 'money' | 'operations';
export interface MoneyFigure { display: Display; receiptId: string }
/** A point the engine scaled: valuePermille of the largest, null (never 0) where there is no data. */
/** lead (4Z3): a money point as the owner's currency leads it. */
export interface SeriesPoint { key: string; label: Display; value: Display | null; valuePermille: number | null; receiptId: string | null; rupees?: Display; lead?: SpendLead }

/** 4A1 departments, Keeper and health. */

export interface AgentHealth { status: AgentHealthStatus; reason: Display | null; digest: string }
/** sharePermille (4A2): the part's share of the month's whole spend, floored by the engine; 0 when nothing was spent. */
/** rate (4A2): the owner's rupee rate in words, the same words `rupees` and `held` end with, sent with them. */
export interface DepartmentSpend { display: Display; receiptId: string; rupees?: Display; rate?: Display; held?: Display; heldReceiptId?: string; sharePermille?: number; lead?: SpendLead }
export interface DepartmentView {
  id: DepartmentId; name: Display; counts: { working: number; waiting: number; stopped: number; idle: number };
  /** doneThisWeek.permille (4A2): this week's count scaled to the busiest department's, floored; 0 when none did a job. */
  doneThisWeek: { count: number; receiptId: string; permille?: number }; spendThisMonth: DepartmentSpend; series: { jobs: SeriesPoint[]; spend: SeriesPoint[] };
}
 // 5A6: page monitors
export interface KeeperJobView { id: KeeperJobId; name: Display; lastRun: { at: string; outcome: 'ok' | 'warn' | 'failed'; line: Display } | null; note: Display | null }

export interface TeamListView {
  /** C5 task 1: the agents this member has not met yet, each with its one code-written line. */
  introduce?: { agentId: string; line: string }[];
  agents: AgentView[]; departments?: DepartmentView[]; shared?: DepartmentSpend | null;
  /** The team's totals, from the same partition as the departments; spendThisMonth is Money's own figure. */
  totals?: { doneThisWeek: { count: number; receiptId: string }; spendThisMonth: DepartmentSpend; held: MoneyFigure | null };
  /** A quarantine no single agent can claim; cleared with agentId 'team'. */
  teamHealth?: AgentHealth;
  /** W6 6G2: the Retired shelf, oldest first; sent only when an agent is retired. */
  retired?: RetiredAgentView[];
}
/** W6 6G2 (D43). One agent on the Retired shelf; to is null when the owner took over its work. */
export interface RetiredAgentView { id: string; name: string; role: Display; department?: DepartmentId; at: string; to: { id: string; name: string } | null; line: Display }
export interface RetireInFlight { id: string; kind: 'run' | 'question' | 'proposal' | 'today'; line: Display }
/** W6 6G2. The check before retiring: what it holds, what is in flight, routines that switch off, who can take over. */


/** 4B1 and 4B2 agent chat, proposals, standing orders and notes. */


export interface ChatConsentView { state: 'needed' | 'given' | 'stale' | 'not-needed'; text: Display | null; digest: string | null; at: string | null }



/** proposalId (4B3): on the reply to a request on the floor, the proposal it raised to Today (row subject proposal:<id>). */
export interface AgentMessageView { id: string; at: string; from: 'owner' | 'agent' | 'chausar'; parts: ChatPart[]; suggestion?: AgentSuggestion; answered?: { runId: string }; proposalId?: string }
export interface AgentProposalView {
  id: string; at: string; agent: string; kind: 'instruction' | 'note' | 'import'; status: 'drafted' | 'accepted' | 'rejected' | 'stale';
  quote: string; title: Display; appliesTo: Display | null; diff: DiffLine[]; fromVersion: number | null; toVersion: number | null;
  note: { text: string; scope: AgentNoteScope } | null; digest: string; line: Display | null;
  /** C7: an offer the agent made after an edited sign-off, with who offered it and after which approval. */
  offered?: Display;
}
export interface AgentRunItem { runId: string; at: string; purpose: Display; state: RunState; done: number; total: number; steps: RunStep[]; recalled: { id: string; text: string; forgotten?: boolean }[] }

export interface AgentThreadView {
  agent: { id: string; name: string; role: string }; items: AgentThreadItem[];
  waiting: { runId: string; rowId: string; question: Display } | null; more: boolean; consent: ChatConsentView;
  /** W6 6G2: set while the agent is retired; the thread is read only. */
  retired?: { at: string; line: Display };
}

export interface StandingOrderView { stepId: string; step: Display; text: string; since: number; quote: string; at: string }
export interface AgentNoteView { id: string; scope: AgentNoteScope; load: AgentNoteLoad; text: string; source: Display; captured: string; hash: string }
/** erases (4B3): undoing this change takes the note away, which erases its words like Forget. */
export interface NoteChangeView { id: string; noteId: string; at: string; who: 'owner' | 'cofounder' | 'proposal' | 'undo'; line: Display; undone: boolean; erases: boolean }


/** 4B3: the check ids a step's work must pass (contracts.ts CHECK_IDS), worded by the UI. */
export type PlaybookCheckId = 'no-numeric-prose' | 'figures-resolve' | 'required-sections' | 'no-outside-writes' | 'house-style' | 'prompt-leak'
  | 'length-bounds' | 'turn-limit' | 'questions-raised' | 'no-done-claims' | 'claims-grounded' | 'receipts' | 'rules-judge';
/**
 * 4B3: venture.agents.orders.list also answers what the agent panel shows, read without writing: the version in use (its
 * hash is the digest venture.agents.version.undo takes) or null; rebuildDue when the next run or change builds a new
 * version first; the agent's own steps with their guidance and check ids; and what Undo would do now, or null.
 */
export interface StandingPlaybookView { id: string; version: number; hash: string; origin: 'plan' | 'improvement' | 'owner'; at: string }
export interface StandingStepView { stepId: string; title: Display; guidance: string[]; checks: PlaybookCheckId[] }



/** 4C1 Chats and proposals. */
export type ProposalKind = 'brief-agent' | 'start-run' | 'start-work' | 'draft-invoice' | 'draft-reminder' | 'quote' | 'outreach-draft' | 'next-step';

/** what (4C2 review): the step's own line; line says where it stands. */
export interface ProposalView { id: string; at: string; kind: ProposalKind; status: ProposalStatus; title: Display; line: Display; what: Display; agent: string | null; rowId: string | null; digest: string; secondAsk: boolean }
/** 4C2 review: each receipted figure lastLine states, exactly as written there, at its offset in UTF-16 code units. */
export interface ChiefLineAmount { text: Display; start: number; length: number; receiptId: string }
/**
 * W6 6G1 (D42): state is the chat's one state; snoozedUntil while snoozed; settled says when and whether the owner or
 * the quiet days settled it; waiting: a step or the chief's question waits for the owner, so it is never hidden.
 */
export interface ChiefThreadSummary {
  id: string; title: string; pinned: boolean; lastAt: string; lastLine: Display; amounts: ChiefLineAmount[]; unread: number;
  state: ChiefThreadState; snoozedUntil: string | null; settled: { at: string; by: 'owner' | 'auto' } | null; waiting: boolean;
}
/** W6 6G1. */


export interface ChiefSnoozeOption { id: ChiefSnoozePreset; until: string }
export interface ChiefThreadStateInput { threadId: string; state: ChiefThreadState; preset?: ChiefSnoozePreset; until?: string }
/** W6 6G1: undo is the request that puts the chat back exactly; line is the engine's words. */


/**
 * W6 6H3 (D40): a place's layout as data (platform/runtime/venture/views/layout-core.ts and layout.ts). Blocks come in
 * the order the page draws them; `keep` blocks (approvals, questions, stops, money totals) always show, keep their slot
 * and their name. `ai` lists the AI's changes since the owner's own last one, with one Undo; `go` is the AI's latest
 * offer of a place, shown as a link the owner opens (never opened by itself).
 */
export type LayoutPlace = 'today' | 'money';
export type LayoutKeep = 'approval' | 'question' | 'hard-stop' | 'money';
export type LayoutChange =
  | { op: 'hide' | 'show'; block: string }
  | { op: 'move'; block: string; to: number }
  | { op: 'rename'; block: string; name: string | null }
  | { op: 'save-view'; name: string }
  | { op: 'use-view' | 'delete-view'; view: string }
  | { op: 'reset' } | { op: 'restore'; to: string } | { op: 'keep' };
export interface LayoutRequest { place: LayoutPlace; change: LayoutChange }
export interface LayoutBlockView {
  id: string; name: string; defaultName: string; shown: boolean; keep: LayoutKeep | null; why: string | null;
  movable: boolean; rename: 'free' | 'aliases' | 'fixed'; aliases: string[];
}
export interface LayoutView {
  place: LayoutPlace; title: string; href: string; blocks: LayoutBlockView[]; views: { id: string; name: string }[]; custom: boolean;
  ai: { count: number; lines: string[]; undo: LayoutRequest } | null;
  go: { id: string; href: string; title: string; at: string } | null;
}
export interface LayoutChangeResult { layout: LayoutView; undo: LayoutRequest; line: Display }
/**
 * consent (4C2 review): the one chat consent as it stands; the screen shows this text and agrees by this digest.
 * settled (W6 6G1): the archive, latest settled first; settleAfterDays: the owner's quiet days (0 is never).
 */
export interface ChiefThreadsView {
  groups: { key: 'pinned' | 'today' | 'this-week' | 'last-week' | 'earlier' | 'snoozed'; label: Display; threads: ChiefThreadSummary[] }[]; consent: ChatConsentView;
  settled: ChiefThreadSummary[]; settleAfterDays: number;
}
/** 4C2 review: the counts by code (4J14, Q21): each kind's records, and the new ones in each month (YYYY-MM), oldest first. */
export interface ChiefCounted { entities: { kind: string; count: number }[]; months: { month: string; count: number }[] }
export interface ChiefMessageView {
  id: string; at: string; from: 'owner' | 'chief'; parts: ChatPart[]; proposals: ProposalView[];
  routedTo: { agent: string; name: string } | null; worked: { label: Display; value: Display; receiptId: string }[]; dropped: Display[];
  counted: ChiefCounted | null;
  /** C5 task 5: Connect your AI, under an answer written with no AI. */
  suggestion?: { kind: 'connect-ai' };
}
/** snooze (W6 6G1): the snooze choices now, none while the chat waits for the owner. */


export interface ChiefFit { wayId: string; line: Display; estimate: true }

/** 4D1 to 4D3 the owner's network. */
export type NetworkImportKind = 'linkedin-connections' | 'linkedin-messages' | 'contacts-csv' | 'vcard' | 'calendar-ics' | 'mail-headers';
export type TieBand = 'close' | 'know-well' | 'know' | 'met-once' | 'cold';
export interface PersonSummary { id: string; name: string; initials: string; title: Display | null; company: string | null; band: TieBand | null; dots: number; hidden: boolean; degree: '1st' | '2nd' | null }
export interface WarmPathView { kind: 'direct' | 'same-company' | 'connector'; via: { id: string; name: string } | null; confirmed: boolean; strength: TieBand; line: Display }
/** 4D4: consent, the chat consent a search needs while it is needed (needed or stale, with its text and digest), else null. */
export interface PeopleView { people: PersonSummary[]; suggestions: { a: string; b: string; line: Display }[]; total: number; consent: ChatConsentView | null; chips?: string[] }
export interface PersonView {
  person: PersonSummary; fields: { field: string; value: Display; source: Display; sourceId: string }[]; how: { line: Display; receiptId: string | null }[];
  paths: WarmPathView[]; card: PipelineCardView | null; drafts: OutreachView[]; merged: boolean; web: { text: string; url: string }[];
  /** 4D4: the LinkedIn address the files hold, or null. */
  linkedin: string | null;
}
export interface NetworkBandCounts { close: number; knowWell: number; know: number; metOnce: number; cold: number }
export interface NetworkSourcesView {
  sources: { kind: NetworkImportKind; fileName: string; at: string; kept: number; dropped: number; line: Display; stale: Display | null }[];
  /** permille (4D4): each band's share of the ties counted, floored by the engine, so the bars are drawn without dividing. */
  bands: NetworkBandCounts & { receiptId: string; permille: NetworkBandCounts } | null;
  /** 4D4: whether a web search is set up here; when not, screens say so in place of the web choice. */
  webSearch: 'set-up' | 'not-set-up';
  /** 4E4: the read-only mailbox's and the calendar address's state (never the password or the address); null on the hosted app. */
  mailbox: MailboxView | null; calendar: CalendarFeedView | null;
}
export interface NetworkImportView { id: string; kind: NetworkImportKind; fileName: string; at: string; rows: number; people: number; merged: number; dropped: { what: string; count: number }[]; undone: boolean; line: Display }

export interface SearchResultView {
  person: PersonSummary | null; url: string | null; fitBp: number; why: Display;
  checks: { trait: Display; check: 'yes' | 'partly' | 'not-supported'; quote: string | null; source: Display | null }[];
  path: WarmPathView | null; inPipeline: PipelineStage | null; cold: boolean;
  /** 4D4: the tie's receipt, and the LinkedIn address the files hold; null for a web result. */
  receiptId: string | null; linkedin: string | null;
}
/** 4D3: what a search's web part did, to branch on without matching words. */



/** 4E1 to 4E3 the pipeline, outreach and inbound mail. */
export type PipelineStage = 'found' | 'asked' | 'talking' | 'proposal' | 'won' | 'lost' | 'not-now';
export type LostReason = 'no-budget' | 'no-reply' | 'chose-someone-else' | 'not-a-fit' | 'timing' | 'other' | 'opted-out';
export type OutreachKind = 'intro-request' | 'double-opt-in' | 'connection-note' | 'follow-up' | 'reply' | 'cold-email' | 'reminder';


/** 4E2: the languages Chausar drafts in, the lawful basis of a cold email, and the send governor's lanes. */



export interface PipelineCaps { newPerDay: number; perWeek: number; channels?: Partial<Record<OutreachLane, number>>; channelWeeks?: Partial<Record<OutreachLane, number | null>>; warmupPercent?: number[] }
export interface ScoreRule { field: string; operator: 'is' | 'contains' | 'at-least' | 'at-most'; value: string; points: number }
export interface PipelineCardView {
  id: string; personId: string; name: string; initials: string; company: string | null; stage: PipelineStage; band: TieBand | null; dots: number;
  path: WarmPathView | null; next: { text: Display; due: string; line: Display; late: boolean } | null; draft: Display | null; business: string; trigger: Display;
  /** 4E4: the waiting draft the draft line names (the newest not sent), so the screens open it again after a reload. */
  draftId: string | null; draftChannel: OutreachChannel | null;
  /** 4E4: per kind and channel, whether a draft is cold and still needs its lawful basis; basis, the one kept on the card. */
  outreach: { kind: OutreachKind; channel: OutreachChannel; cold: boolean; needsBasis: boolean }[];
  basis: LawfulBasis | null;
  /** 4E4: a Proposal card's quote with its price receipt; a Won card's client, in words. */
  quote: { value: Display; receiptId: string } | null;
  client: { name: string; line: Display } | null;
  score: { bucket: 'hot' | 'warm' | 'cold'; reasons: Display[] } | null;
  timeline: { what: 'sent' | 'scheduled' | 'projected' | 'reply' | 'accepted'; at: string; line: Display; estimated: boolean }[];
  blocked?: Display; thread?: { age: 'alive' | 'cooling' | 'presumed-dead'; days: number; line: Display };
}
export interface StatTileView { id: string; label: Display; value: Display; line: Display | null; receiptId: string | null }
export interface PipelineView {
  columns: { stage: PipelineStage; label: Display; sub: Display; count: number; folded: boolean; cards: PipelineCardView[] }[];
  /** 4E4: reachedPermille, the stage's count against the largest (the bar); share, movedOnPermille in the engine's words. */
  tiles: StatTileView[]; funnel: { stage: PipelineStage; reached: number; movedOnPermille: number | null; receiptId: string; reachedPermille: number; share: Display | null }[];
  forecast: { value: Display; label: Display; receiptId: string } | { line: Display } | null;
  /** 4E4: the business's quotes, newest first, for a Proposal move's evidence (a quote names no person). */
  quotes: PipelineQuoteView[];
}
/** 4E4: one quote a Proposal move can rest on: its offer's name, quantity and amount before tax (or its total). */
export interface PipelineQuoteView { receiptId: string; offer: Display; quantity: string; value: Display; at: string }
export interface FollowupView { cardId: string; name: string; company: string | null; line: Display; due: string; late: boolean; channel: OutreachChannel | null; draftId: string | null }

export interface OutreachView {
  id: string; opportunityId: string | null; kind: OutreachKind; channel: OutreachChannel; to: Display | null; subject: string | null; text: string; blurb: string | null;
  footer: { unsubscribe: string; postalAddress: string } | null; lints: { rule: string; line: Display }[]; counter: { used: number; limit: number } | null;
  sent: { at: string; channel: OutreachSentChannel } | null; digest: string;
  /** 4E2: absent on a view another package built (4J5's reminder): read as a template, English, not accepted. */
  author?: 'model' | 'template' | 'owner'; language?: OutreachLanguage; accepted?: { on: string; line: Display } | null;
  /** 4E2: the engine's words for the sheet: Chausar never sends, and counts only the notes you mark as sent. */
  line?: Display;
  /** 4E4: the forwardable note's sentences, counted by the engine; null with no note. */
  blurbSentences?: number | null;
}
/** 4E2: one handoff to the owner's own app, with its line. Chausar never sends. copy: too long for one link, so the owner copies the text. */


/** 4E4: needsPassword, connected but the app password left the engine's shelf with a restart: type it again. */
export interface MailboxView { connected: boolean; host: string | null; user: string | null; lastSync: string | null; line: Display; needsPassword: boolean }
export interface InboundView { id: string; from: string; date: string; subject: string; triage: InboundTriage; matched: { opportunityId: string; name: string } | null; line: Display }
/** 4E4: nextRead, when the morning read comes next, while the address is on the engine's shelf; else null. */
export interface CalendarFeedView { set: boolean; host: string | null; lastRead: string | null; line: Display; nextRead: string | null }

/** 4F1 and 4F2 run controls, pause all, Away, write caps. */

/** since: once the time away began, Today's rows made between the two days, for the "Since you left" filter (4F1). */
export interface AwayView { away: { from: string; to: string } | null; promises: { due: string; line: Display }[]; keepsRunning: Display[]; approvalsWaiting: number; autoReply: string | null; line: Display; since?: { from: string; to: string; rowIds: string[] } }


/** 4G1 and 4G3 notifications and push. */
/** ended (one-shot C4 task 7): the item no longer waits on the owner. */
export interface NotificationView { id: string; rowId: string; kind: QueueKind | QueueKindW4; title: Display; at: string; read: boolean; ended?: true }
/** W6 6F6 (notify/telegram.ts). said: what a test alert did, only on a test. */

/** W6 6F7 (notify/phone.ts): the phone listener's state; a one-time pairing link and its QR code when one was asked for. */
export interface PhoneAccessView {
  on: boolean; addresses: { via: 'wifi' | 'tailscale'; address: string }[]; phones: number;
  link: string | null; expiresAt: string | null; line: Display; qr: { size: number; rows: string[] } | null;
}
/** 4G1: the newest daily digest, for the centre only; receiptIds back its money figures. */
export interface NotifyDigestView { id: string; day: string; at: string; line: Display; items: NotificationView[]; stillWaiting: number; receiptIds: string[] }
export interface NotifySettingsView {
  pausedUntil: string | null; quietHours: { from: string; to: string } | null; digest: { hour: number } | null; push: boolean; tray: boolean; keepsRunning: Display[]; line: Display;
}
export interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: number | null }

/** 4H1 the CLI status and per-role models. */
export interface CliStatusView {
  cli: 'claude-code' | 'codex'; label: Display; found: boolean; path: string | null; version: string | null;
  flags: 'match' | 'mismatch' | 'unknown'; missingFlags: string[]; signedIn: 'yes' | 'no' | 'unknown'; terms: 'accepted' | 'pending' | 'not-needed';
  lastTask: { at: string; outcome: 'succeeded' | 'failed'; named?: Display } | null; state: ModelAvailability; line: Display; fix: Display | null;
  /** A2: Codex only, when the engine keeps a Codex trust (platform/runtime/codex-trust.ts). */
  setup?: CodexSetupLite;
  /** A2: after a failed last task, the provider's own status page when it says the provider has problems. */
  provider?: ProviderTroubleLite;
  /** D4 task 6: a look kept between starts, and when it was really taken; the fresh look follows within seconds. */
  kept?: true; checkedAt?: string;
}
/** C7: event triggers (venture.events.*): the relay's host, the recent events and each event's blanks. */
export interface RelayEventLite { id: string; source: 'razorpay' | 'cal-com'; kind: 'payment' | 'booking' | 'booking-cancelled'; receivedAt: string; state: 'new' | 'confirmed' | 'refused' | 'drafted' | 'missed'; line: Display }
export interface EventsViewLite { relay: string | null; calKey: boolean; line: Display; label: Display; missed: number; events: RelayEventLite[]; blanks: Readonly<Record<string, readonly string[]>> }
/** C7: hiring one more agent, one phase at a time (venture.agents.hire.*). */
export interface HireReadLite { read: string; why: string }
export interface HireVoiceLite { tone: string | null; replyLength: 'short' | 'medium' | 'long' | null; greeting: string | null; handOffLine: string | null; blockedTopics: string[]; signOff: string | null }
export interface HireViewLite {
  id: string; status: 'drafting' | 'hired' | 'cancelled'; phase: 'role' | 'reads' | 'voice' | 'review'; sentence: string;
  role: { name: string; job: string; duties: string[] } | null; reads: HireReadLite[]; voice: HireVoiceLite | null; department: string;
  choices: readonly string[]; departments: readonly string[]; card: { does: string[]; reads: HireReadLite[]; never: string[]; asks: Display } | null; digest: string;
}
/** C7: owner-made trackers (venture.trackers.*). A receipt cell shows the receipt's figure; an estimate cell always carries its label. */
export interface TrackerColumnLite { id: string; name: string; kind: 'text' | 'date' | 'choice' | 'count' | 'check' | 'person' | 'receipt' | 'estimate'; options?: string[] }
export interface TrackerCellLite { column: string; value: string | number | boolean | null; display: Display; receiptId?: string; label?: 'model estimate' }
export interface TrackerLite { id: string; name: string; columns: TrackerColumnLite[]; boardBy: string | null; keptBy: string[]; rows: number }
export interface TrackerRowLite { id: string; at: string; cells: TrackerCellLite[]; addedBy: string; addedByName: string | null; canUndo: boolean }
export interface TrackerStarterLite { id: 'content-calendar' | 'gst-due-dates'; name: string; columns: TrackerColumnLite[]; boardBy: string | null }
export interface TrackersLite { trackers: TrackerLite[]; starters: TrackerStarterLite[] }
export interface TrackerDetailLite { tracker: TrackerLite; rows: TrackerRowLite[] }
/** C7: the backup AI for routines (venture.routines.backup.get and .set): each choice with the consent text it is sent under. */
export interface BackupChoiceLite { presetId: string; label: Display; text: Display; digest: string }
export interface BackupViewLite { on: boolean; order: string[]; choices: BackupChoiceLite[]; main: Display | null }
/** C7: the plan meter (venture.models.plan): only what each tool reported, with its source and time. */
export type PlanStateLite = 'ok' | 'near' | 'used-up' | 'unknown';
export interface PlanWindowLite { kind: 'five-hour' | 'week'; usedPercent: number | null; resetsAt: string | null; state: PlanStateLite; line: Display }
export interface PlanToolLite { cli: 'claude-code' | 'codex'; label: Display; state: PlanStateLite; windows: PlanWindowLite[]; readAt: string | null; source: Display; canCheck: boolean }
export interface PlanViewLite { tools: PlanToolLite[] }
/** A2: the AI provider's status page, in the engine's words, with where and when it was read. */
export interface ProviderTroubleLite { line: string; source: string; readAt: string }
/** A2: a Codex setup as the engine shows it: in use, found and waiting for the owner's yes, not usable, or none. */
export interface CodexSetupLite {
  state: 'trusted' | 'review' | 'refused' | 'none'; origin: 'operator' | 'bundled' | 'owner' | null;
  path: string | null; version: string | null; sha256: string | null; line: string;
}
export interface RoleModelView { agent: string; name: string; tiers: { tier: ModelTier; presetId: string; model: string | null; price: Display; usable: boolean }[] }

/** 4I1 goals and the next best step. */

/** A sum on the goal card: receiptId null when nothing was added up (a zero, no receipt). */
export interface GoalFigure { display: Display; receiptId: string | null }
/** elapsedDays counts today as gone; lastDay: say "Last day", not "0 days left". */
export interface GoalView {
  month: string; state: 'set' | 'unset'; goal: MoneyFigure | null; invoiced: GoalFigure; ready: GoalFigure; stillToInvoice: MoneyFigure | null; receivedSoFar: GoalFigure;
  invoicedPermille: number | null; readyPermille: number | null; pacePermille: number; pace: 'ahead' | 'behind' | null; paceReceiptId: string | null;
  /** 4I2: whole percents to word (invoicedPercent may pass 100); past the goal and by how much; ahead or behind pace by how much. */
  invoicedPercent: number | null; pacePercent: number; past: boolean; pastBy: MoneyFigure | null; paceBy: MoneyFigure | null;
  elapsedDays: number; monthDays: number; daysLeft: number; lastDay: boolean;
  lastMonth: GoalFigure | null; line: Display; next: NextBestStep | null; briefing: { rowIds: string[]; more: number } | null;
  /** One-shot C6: every invoice issued in the month is paid ("All November invoices paid"), with its receipt; else null. */
  paidInFull?: { line: Display; receiptId: string } | null;
}
/** typed: the amount as the owner would type it in the goal field ("150000.00"). */
export interface GoalSuggestion { amountMinor: string; display: Display; estimate: true; line: Display; typed: string }

/** 4J1 and 4J2 decisions, edits, set approval, the triage rule, settings drafts. */
/** by: the member who decided, null for a saved rule or a timeout; ruleId and rule: the saved rule that decided, if one did. */
export interface DecisionView {
  id: string; at: string; subject: string; action: string; who: 'owner' | 'cofounder' | 'accountant' | 'saved-rule' | 'timeout' | 'chausar'; rule: Display | null; ruleId: string | null;
  reason: Display; line: Display; by: string | null;
  /** A4 review (L5): the reader's own decision (the engine words its line with You). */
  mine: boolean;
  /** 4J19: the agent whose step a saved rule or a gate is about (venture.team.gate takes it), else null. */
  agentId: string | null;
  /** C4 (T26): what the decision was about, for the screen to open; null when that thing is gone or cannot be opened. */
  opens?: DecisionOpens;
}


export interface TriageRule { keys: { field: TriageField; order: 'asc' | 'desc' }[]; words: string }

export interface DraftChangeView { id: string; paragraph: number; before: string; after: string; by: 'owner' | 'agent'; status: 'open' | 'taken' | 'dropped' }
/** 4J2: line says how the revision was merged; replacement is offered when the owner's own version sits beside the agent's. */

export interface SettingsDraftView { form: string; values: unknown; at: string }
/** 4J2 review: a set as the engine works it out; queue.set takes its digest, and secondAsk: true when it asks twice. */


/** 4J4 to 4J6 money views, bills and businesses side by side. */
/**
 * 4J4 (M13, M14): how a money figure was made: reported (a file and its row), calculated (its receipt), assumption (an
 * input taken as given, shown beside each result that uses it) or estimate (a model's). projected: a forecast, never
 * what happened. basis: what a total counted and what it left out.
 */


export interface TotalBasis { filters: Display[]; truncated: boolean; notCounted: { count: number; line: Display } | null }


export interface AgingView {
  asOf: string; buckets: { id: AgingBucketId; label: Display; count: number; countLine: Display; amount: KindedFigure; permille: number }[]; total: KindedFigure;
  invoices: { invoiceId: string; number: string; client: string; dueDate: string; bucket: AgingBucketId; late: { days: number; line: Display } | null; balance: KindedFigure }[];
  line: Display;
  /** 4J20: what the late ones owe, with its own receipt; null when none is late. */
  late?: KindedFigure | null;
}
export interface FlowView {
  months: { month: string; label: Display; in: KindedFigure | null; out: KindedFigure | null; left: KindedFigure | null; inPermille: number | null; outPermille: number | null; receiptId: string | null; note: Display | null }[];
  line: Display; basis: TotalBasis;
}
/** C4 (T28): flat, why the line stays flat when nothing is due in or out in the window. */
export interface CashView {
  flat?: Display;
  bank: (KindedFigure & { on: string }) | null; opening: KindedFigure | null;
  points: { week: string; label: Display; actual: KindedFigure | null; forecast: KindedFigure | null; actualPermille: number | null; forecastPermille: number | null }[];
  /** 4Z2: each only when its lowest week falls below today's cash (opening); null when cash stays at or above it. */
  lowest: { onTime: (KindedFigure & { week: string; line: Display }) | null; ifLateNeverPay: (KindedFigure & { week: string; line: Display }) | null };
  usualCosts: KindedFigure | null; assumptions: Display[]; nextWeeks: { on: string; line: Display; direction: 'in' | 'out'; amount: KindedFigure }[];
  /** 4J20: each draft issued today, the week its money falls due and its total, proved by its price receipt. */
  ifIssued?: CashIssueView[];
  ticks: { permille: number; label: Display }[]; basis: TotalBasis; line: Display;
}
/** 4J20: a draft issued today: due on its terms from today, in that week, its total as priced. */
export interface CashIssueView { invoiceId: string; client: string; due: string; week: string; amount: KindedFigure }
export interface MarginsView { month: string; rows: { clientId: string; client: string; invoiced: KindedFigure; spend: KindedFigure | null; margin: KindedFigure | null; note: Display | null }[]; line: Display; basis: TotalBasis; /** C4 (T23): the spend is left out only for want of a rupee rate. */ needsRate?: boolean }
/** receipts (4J10): the business's signed receipts with the public halves of its keys, for the CA to check offline; saved as its own file. */
/** Desktop only (C4 T24): what the save answered. folder is the folder's own name; id is for showSavedExport. Never a path. */
export interface MoneyExportSaved { saved: true; name: string; receipts?: string; readme?: string; count?: number; folder?: string; id?: string; line: string }
export interface MoneyExportFile { fileName: string; csv: string; rows: number; line: Display; receipts?: SignedReceiptsFile; /** C4 (T24): the name in owner words, and the business and the month for the read-me. */ ownerFileName?: string; business?: Display; period?: Display; format?: MoneyExportFormat }
export type MoneyExportFormat = 'csv' | 'tally-xml' | 'gstr1-csv';
export interface SignedReceiptsFile { format: string; business: string; algorithm: string; publicKey: string | null; keys: { id: string; publicKey: string }[]; receipts: unknown[] }
/** 4J20: the amount as typed (amount) or in minor units (amountMinor), and the rate as typed (taxRate, a percentage) or in basis points; one of each. */
export type BillLineInput = { description: string; taxName: string }
  & ({ amount: string; amountMinor?: never } | { amountMinor: string; amount?: never })
  & ({ taxRate: string; taxRateBps?: never } | { taxRateBps: string; taxRate?: never });
/** C4 (T22): dueToday, a posted bill with money left due on the owner's day today; purpose, what it is for (from its lines). */
export interface BillView { id: string; vendor: string; billDate: string; dueDate: string; total: Display; paid: Display; balance: Display; state: 'draft' | 'posted' | 'partial' | 'paid' | 'overdue'; recurring: 'monthly' | 'quarterly' | null; receiptId?: string; dueToday?: boolean; purpose?: string | null }
export interface CreditNoteView { id: string; invoiceId: string; amount: Display; reason: string; state: 'waiting' | 'issued' | 'cancelled'; number: string | null; rowId: string | null; line: Display; receiptId?: string | null }
export interface RecurringInvoiceView { id: string; clientId: string; offerId: string; frequency: 'monthly' | 'quarterly'; startOn: string; end: string | null; nextOn: string | null; line: Display }
/** 4J6: what a row's line says (`AcrossLineKey` in the engine's contracts), so a screen can word it in Hindi. */

/** 4J6: one business a total or count left out, and why (month: the month its summary was saved in, for other-month). */
export interface AcrossLeftOut { businessId: string; name: string; why: 'locked' | 'key-missing' | 'unreadable' | 'none' | 'setting-up' | 'other-month'; month: string | null }
export interface BusinessSnapshotView { businessId: string; name: string; open: boolean; locked: boolean; asOf: string | null; line: Display; lineKey: AcrossLineKey }
/**
 * 4J6: receipts holds a receipt id in the open business for each figure shown (for another business, a receipt of what
 * its summary saved and when; its own receipts open only after switching). total: invoiced in `month` in one currency.
 * lineKey, counted, currencies and notCounted say what line says, in parts.
 */
export interface AcrossMoneyView {
  /** spendRupees, spendRate (4J20): the spend in rupees at the owner's own rate, and that rate in words; absent without one. */
  businesses: (BusinessSnapshotView & { invoiced: Display | null; received: Display | null; owed: Display | null; late: number | null; spend: Display | null; spendRupees?: Display; spendRate?: Display; spendLead?: SpendLead; receipts?: Partial<Record<'invoiced' | 'received' | 'owed' | 'spend', string>> })[];
  total: MoneyFigure | null; line: Display;
  lineKey: 'counted' | 'currencies' | 'nothing'; month: string; counted: number; currencies: string[]; notCounted: AcrossLeftOut[];
}


/** 4J7 to 4J10 connection checks, file requests, ways to earn, the owner, signatures and the journal chain. */
export interface ConnectorCheckRow { connectorId: string; name: string; outcome: 'answered' | 'failed' | 'skipped'; line: Display; account: string | null; expiresOn: string | null; fix: Display | null }
export interface ConnectorChecksView { at: string; rows: ConnectorCheckRow[]; health: { ready: number; warnings: number; blocking: number } }
export interface FileRequestView { id: string; orderId: string; url: string | null; reason?: Display; expiresAt: string; line: Display }
/**
 * `WayView` in platform/runtime/venture/contracts.ts (4J8): one way per playbook that runs today. Hours and pay are a
 * model estimate (clientsPay.source is their basis); team is the playbook's agents only; starter fills the one-sentence
 * box and never sends; yours is the open business when it is of this kind.
 */

/** needs: besides the owner's time (hours), the owner's own AI and the connections that work today, in plain words. */
export interface WayNeeds { ai: Display; connections: Display }
export interface WayView {
  id: string; playbook: string; label: Display; category: WayCategory; department: DepartmentId; line: Display;
  hours: Display; minHours: number; maxHours: number; hoursEstimate: true; youDo: Display;
  team: { role: string; initials: string; department: DepartmentId }[]; teamLine: Display;
  /** W6 6C3: estimate is false where a sourced range for the way's own service replaced the model estimate; guide: the profession's sources or "No reliable data". */
  clientsPay?: { text: Display; per: Display; estimate: boolean; source: Display; guide?: PriceGuideView; rangeId?: string };
  /** W6 F4: a desk for the owner's own use: what it saves them (a model estimate), in place of clientsPay. */
  saves?: { text: Display; line: Display; estimate: true; source: Display };
  needs: WayNeeds; starter: Display;
  yours: { businessId: string; name: string }[];
  /** W6 6E6 (D2): the profession families this way serves, in the families' order. */
  families: string[];
}
/**
 * W6 6C3 (D17), `PriceGuideView` in platform/runtime/venture/contracts.ts (core/price-ranges.ts): a profession's price
 * ranges from credible sources with the date checked, or status no-reliable-data with line "No reliable data". Every
 * amount's words (text) are the engine's; the UI shows them, never computes them, and a guide never sets a price.
 */
export interface PriceSourceView { url: string; publisher: string; title: string; published: string | null }
export interface PriceRangeView {
  id: string; label: string; currency: string; lowMinor: string; highMinor: string; kind: 'range' | 'minimums' | 'cap';
  text: Display; per: Display; city: string | null; sources: PriceSourceView[]; checkedOn: string; checked: Display; note: Display;
}
export interface PriceGuideView {
  profession: string; label: Display; family: string; status: 'sourced' | 'no-reliable-data';
  ranges: PriceRangeView[]; line: Display | null; reason: Display | null; checkedOn: string; checked: Display;
}
export interface WaysView {
  ways: WayView[];
  categories: { id: WayCategory; label: Display; count: number }[];
  upTo: { maxHours: number; label: Display; count: number };
  /** W6 6E6 (D2): the families that have a way, each with its count of ways. */
  families: { id: string; label: Display; count: number }[];
}
/** `ComposeAttachmentNote` (onboarding-contracts.ts): a dropped file's name, whether it was used, and why not, never its text. */
export interface AttachmentNote { name: string; used: boolean; line: string | null; reason: 'injection' | 'hidden' | 'error' | null }
/** `PlanChangeView` (4J8): one change a plan suggestion makes; estimate is always false (its words hold no number). */

/**
 * `PlanSuggestionView` (4J8, "Add this to {business}"): patch is exactly what venture.blueprint.update takes, or null when
 * nothing changes; the owner applies it there with basedOn, then accepts. Words and at most one new offer, never a price.
 */
export interface PlanSuggestionView {
  basedOn: { blueprintId: string; digest: string };
  patch: BlueprintPatchLite | null; changes: PlanChangeView[]; attachment?: AttachmentNote;
  left: Display; line: Display; callId: string | null;
}
/** kept: only on the answer that removed a stored name, the backups line Forget also shows. */
export interface OwnerView { firstName: string | null; excludedServices: string[]; businessName: string; kept?: Display[]; familyId?: string }
/**
 * Wave 6 (6C1): each tool found on this computer, its own sign-in state (from its own status command) and any login in
 * flight: the device code and link the tool printed (platform/runtime/venture/models/login.ts).
 */
export type ToolLoginState = 'idle' | 'starting' | 'waiting' | 'signed-in' | 'failed' | 'cancelled';
/** D5: how far Install Claude Code has come (venture.ai.claude.progress). */
export interface ClaudeInstallViewLite { step: 'idle' | 'downloading' | 'installing' | 'checking' | 'done' | 'failed'; receivedBytes: number; totalBytes: number | null; line: string | null }
export interface ToolLite {
  cli: 'codex' | 'claude-code'; label: string; found: boolean; signedIn: 'yes' | 'no' | 'unknown';
  login: { state: ToolLoginState; code: string | null; link: string | null; line: string | null };
  /** A2: Codex only, when the engine keeps a Codex trust. */
  setup?: CodexSetupLite;
  /** A2: the tiny test call that earns "Signed in"; problem holds its failure in the engine's owner words. */
  tested?: 'passed' | 'failed';
  problem?: string;
  provider?: ProviderTroubleLite;
}
export interface ToolsLite { tools: ToolLite[]; line: string }
/**
 * One-shot A5: start at login and keep running on this computer (app/desktop/background.cjs state()). registered: the
 * computer starts Chausar at sign-in now; systemOff: its login item is there but the computer's own startup settings
 * switched it off. startAtLogin is the saved answer (unasked, the suggestion onboarding ticks).
 */
export interface BackgroundStateLite { supported: boolean; asked: boolean; startAtLogin: boolean; keepRunning: boolean; registered: boolean; systemOff: boolean }
/** Wave 6 (6C2): About you, as core/about.ts answers. Offers never carry an amount. */
/** A field tile; venture.about.families lists its professions too (one-shot A5), venture.about.read and .pick do not. */
export interface FamilyLite { id: string; label: string; line: string }
export interface FamilyTileLite extends FamilyLite { professions: { id: string; label: string }[] }
export interface AboutReadLite {
  family: FamilyLite | null;
  /** One-shot A5: the owner's exact profession as the AI picked it (a catalogue profession of that field), else null. */
  profession: { id: string; label: string } | null;
  offers: { name: string; line: string }[];
  country: CountryLite | null;
  evidence: string | null;
  idea: string | null;
  source: 'ai' | 'keywords' | 'tile';
  /** A1 final check: the AI read's own call id, carried by the kept card. */
  callId?: string;
  file?: { name: string; included: boolean; line: string | null };
  /** C5 task 6: your AI's first reply after About you, when it gave one (at most two sentences, no digits). */
  reply?: string;
}
/** Wave 6 (6C7): what the business needs from outside, as core/needs.ts answers. */
export interface NeedLite {
  id: string; name: string; why: string; label: 'write' | 'read' | 'handoff' | 'planned';
  connect: { kind: 'sign-in' | 'key' | 'guide' | 'none'; connectorId: string | null; place: 'connections' | 'connections/ai' | null };
  waitsOn: string | null; meanwhile: string | null; required: false;
}
export interface NeedsListLite { family: { id: string; label: string } | null; needs: NeedLite[] }
/** reason (4J22a): only 'changed' and 'unsigned-since' are mismatches; the others are not confirmed. */
export interface ReceiptVerifyView { id: string; valid: boolean; label: 'reproduction_ready' | 'incomplete' | 'signature_only'; reason: 'signed' | 'changed' | 'unsigned-since' | 'unsigned-old' | 'no-key' | 'key-gone'; line: Display }
/** digest: what the owner saw, sent back to accept exactly that break (venture.journal.acceptBreak). */


/** 4J12 to 4J18 contracts, routines, options, drills, guidance, voice and persona, knowledge and ideas. */
export interface OrderContract {
  goal: string; scope: string[]; constraints: string[]; protected: { kind: 'phrase' | 'file'; value: string }[];
  deliverables: { id: string; what: string; stage: string; doneWhen: string }[]; checks: { id: string; what: string }[];
}
/** proposedBy: an agent's revision changes only scope and checks; items: each deliverable's and check's state (4J12). */
export interface OrderContractView {
  orderId: string; contract: OrderContract; revision: number; digest: string; signed: { at: string; by: string } | null; line: Display;
  proposedBy?: 'owner' | 'agent';
  items?: { id: string; kind: 'deliverable' | 'check'; state: 'open' | 'done' | 'skipped'; evidence: Display | null; reason: Display | null }[];
}
export type RoutineSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; everyMinutes: number; from: string }
  | { kind: 'calendar'; weekdays: number[]; time: string; timeZone: string }
  /** C4 task 32: one day of the month (1 to 28) at a time in a named zone. */
  | { kind: 'monthly'; day: number; time: string; timeZone: string }
  /** C7: a trigger: it starts on a confirmed event and only drafts. */
  | { kind: 'event'; source: 'razorpay' | 'cal-com'; event: 'payment' | 'booking' | 'booking-cancelled' };

/** prompt (4J22a): the routine's own words, sent back with venture.routines.set to turn it off, on or change it; only for
 * a role that may change routines. */
export interface RoutineView { /** C7: a trigger's facts: what each event sends, in words. */ facts?: Display[]; recordReport?:'va-morning'|'va-weekly'; id: string; name: string; agent: string | null; prompt?: string; schedule: RoutineSchedule; when: Display; on: boolean; next: string | null; line: Display }
/** C4 task 32: a ready routine from the plan (agents/routines.ts routineSuggestions). */
export interface RoutineSuggestion { name: string; agent: string | null; prompt: string; schedule: RoutineSchedule; when: Display; step: string }
export interface RoutineInput { recordReport?:'va-morning'|'va-weekly'; id?: string; name: string; agent?: string | null; prompt: string; schedule: RoutineSchedule; on: boolean }

export interface DrillRunView { id: string; at: string; playbookHash: string; version: number | null; passed: boolean; results: { drill: Display; stopped: boolean; twinPassed: boolean; line: Display }[] }


export interface GuidanceLineView { stepId: string; text: string; check: string | null; state: 'measured' | 'dark' | 'unmeasured' }
/** 4J16: a part of the drafts the owner keeps correcting. It changes nothing; starter prefills the agent's chat and is never sent. */
export interface FixTheRuleView { field: string; stepId: string | null; agent: string | null; corrected: number; reviews: number; line: string; starter: string }
export interface VoiceSections { audience: string[]; howITalk: string[]; neverUse: string[]; wordsIUse: string[]; willNotClaim: string[]; format: string[] }
export interface VoiceInput { language: 'en' | 'hi'; channel?: string | null; on: boolean; sections: VoiceSections }
/**
 * 4J17 (A14): a question card: one question with answers to pick from, or a round of two to eight, each with the
 * agent's best guess; answers list the pick first with what each gains and costs; free text is always open, with escape.
 */



/** 4J17: version in use and undo (the voice to set to go back one version); draft: what learn worked out, unsaved. */
export interface VoiceView {
  voices: { language: 'en' | 'hi'; channel: string | null; on: boolean; sections: VoiceSections; validated: boolean; version?: number; undo?: VoiceInput | null }[];
  line: Display;
  draft?: { language: 'en' | 'hi'; channel: string | null; sections: VoiceSections; validated: boolean; learnedFrom: number; lines: string[]; line: Display } | null;
}
export interface PersonaFields { tone: string | null; replyLength: 'short' | 'medium' | 'long' | null; greeting: string | null; handOffLine: string | null; blockedTopics: string[]; signOff: string | null }
export interface PersonaView { agent: string; persona: PersonaFields; skills: { name: Display; line: Display; starter: string }[]; line: Display; version?: number; undo?: PersonaFields | null }

export interface KnowledgeSourceView { id: string; kind: 'text' | 'link' | 'file' | 'past-work'; title: string; at: string; line: Display }
export interface IdeaView { id: string; title: Display; reason: Display; evidence: { id: string; line: Display }[]; prompt: string }
/** 4J18: one line of the capability page, with what it is about (key) and its honest state, so the screen can word it in Hindi. */



/**
 * Ink v2 wave 5 (package 5-0): the wave 5 methods' shapes as the engine names them (platform/runtime/venture/contracts.ts
 * W5_METHODS, and each owning package's records file). A result still marked W5Placeholder is one its package has not
 * built; the package replaces its own line here with the fields the screen reads.
 */
export interface W5Placeholder { placeholder: true }
/**
 * 5A1: `OrderChainView` (platform/runtime/venture/playbooks/kit/records-chain.ts): a kit order's stages, each with its
 * state, the stage it is at and the line "Stage 2 of 4", where the chain stands and a note when it waits or stopped.
 */
export interface OrderChainView {
  orderId: string; playbook: string; offerKey: string; stage: number; of: number; line: string;
  state: 'running' | 'waiting' | 'stopped' | 'done'; since: string | null;
  stages: {
    n: number; stepId: string; title: string; produces: string; state: 'done' | 'now' | 'waiting' | 'not-started' | 'stopped';
    /** 5A3: what a person does by hand while the stage's connector is only planned, or null. */
    manualPath: { step: string; connector: string; waitsOn: string; line: string } | null;
  }[];
  note: string | null;
  prerequisites?: {stepId:string;title:string;state:'done'|'now'|'waiting'|'not-started'|'stopped'}[];
  approval?: {stepId:string;title:string;state:'done'|'now'|'waiting'|'not-started'|'stopped'};
}
/** 5A2: inputs by name, money as the owner typed it in rupees, null for an input the owner does not know. */
export type GoNoGoInputs = Readonly<Record<string, string | null>>;
/** 5A2: what the GO card reads, in its order. */
export type GoNoGoInputName = 'upfront' | 'monthly' | 'months' | 'limit';
export type GoNoGoVerdict = 'GO' | 'HOLD' | 'NO-GO';
/** 5A2: one GO, HOLD or NO-GO card; maxLoss opens its receipt (venture.receipt.get with the card's id). */
export interface GoNoGoCardView {
  id: string; at: string; playbook: string; subject: string; verdict: GoNoGoVerdict; line: Display;
  unknown: { input: GoNoGoInputName; label: Display }[];
  maxLoss: { minor: string; display: Display; receiptId: string } | null;
  limit: { minor: string; display: Display } | null;
  spendsNothing: Display | null;
  /** C4 (T25): how the most the owner could lose was reached ("₹5,000 to start + 6 months × ₹1,000"), from the receipt's steps. */
  working?: Display | null;
  /** C5 task 14: on NO-GO, what would make it a go, worked out by code. */
  toGo?: { line: Display; months: number | null; monthly: { minor: string; display: Display } | null };
}
export interface GoNoGoListView { cards: GoNoGoCardView[] }
/** 5A2: a price that is a share of an amount the client confirms later (basis points the owner set). */
export interface SharePrice { kind: 'share'; bps: string; baseMinor: string | null; baseEvidenceFileId: string | null; words: Display }
/** 5A2: a pilot's terms agreed so far; left out, a fact is a placeholder. ownerHours: from the business; clientHours: from the client. */
export interface SalesPilotTerms {
  startsOn?: string; weeks?: number; hypothesis?: string; measure?: { what?: string; target?: string; by?: string };
  ownerHours?: number; clientHours?: number; reference?: boolean;
}
export type SalesProposalSectionId = 'heard' | 'roadmap' | 'investment' | 'next' | 'questions';
export interface SalesProposalSection { id: SalesProposalSectionId; title: string; lines: string[] }
export type SalesProposalInvestment =
  | { kind: 'price'; offerId: string; offerName: string; receiptId: string; totalMinor: string; display: Display; per: string }
  | { kind: 'share'; offerId: string; offerName: string; bps: string; words: Display };
export interface SalesProposalCheck { id: 'required-sections' | 'figures-resolve' | 'placeholders-listed'; passed: boolean; detail: Display }
/** 5A2: a sales proposal; id null when the ask was wholly outside what the business does (exit says so). */
export interface SalesProposalView {
  id: string | null; at: string | null; to: string; offerId: string; offerName: string; pilot: boolean;
  status: 'waiting' | 'approved' | 'outside';
  sections: SalesProposalSection[]; investment: SalesProposalInvestment[]; placeholders: string[]; checks: SalesProposalCheck[];
  author: 'template' | 'model'; line: Display;
  exit: { verdict: 'partly' | 'outside'; reply: Display; rest: string[] } | null;
  digest: string | null;
  handoffs: OutreachHandoff[] | null;
}
/** 5A3: on 4J18's ideas; forward only, or dropped with a reason. */
export type IdeaStage = 'inbox' | 'triage' | 'drafted' | 'made' | 'published' | 'dropped';
export type IdeaGrade = 'worked' | 'so-so' | 'did-not';
/** 5A3: one idea of the pipeline (platform/runtime/venture/playbooks/kit/records-rules.ts PipelineIdeaView). */
export interface PipelineIdeaView {
  id: string; text: Display; source: Display; by: 'owner' | 'agent'; role: string | null; stage: IdeaStage; addedOn: string; movedOn: string;
  next: IdeaStage[]; dropReason: Display | null; expired: boolean; dropsOn: string | null; publishedOn: string | null; gradeFrom: string | null;
  gradeDue: boolean; grade: IdeaGrade | null;
}
export interface IdeaAddedView { idea: PipelineIdeaView; line: Display }
export interface IdeaMovedView { idea: PipelineIdeaView; line: Display }
export interface IdeaGradedView { idea: PipelineIdeaView; line: Display }
/** 5A4 (platform/runtime/venture/playbooks/kit/records-media.ts): brand kits, asset records, voice consent. */
export interface KitClaim { claim: string; proofFileId: string }
export interface BrandKitFields {
  colours: string[]; fonts: string[]; logoFileId: string | null; voice: string[]; samples: string[];
  bannedWords: string[]; bannedTopics: string[]; competitors: string[]; claims: KitClaim[];
}
export type BrandKitField = keyof BrandKitFields;
export type BrandKitInput = Partial<BrandKitFields>;
export type KitSource = 'client-kit' | 'business-voice' | 'house-style' | 'default';
export type ResolvedKit = { [K in BrandKitField]: { value: BrandKitFields[K]; source: KitSource } };
export interface BrandKitView {
  clientId: string; kit: BrandKitFields | null; version: number | null; resolved: ResolvedKit; undo: BrandKitInput | null;
  memory: { orderId: string; at: string; request: Display }[]; line: Display;
}
export type AssetSource =
  | { kind: 'client-file'; uploadId: string | null } | { kind: 'generated'; model: string; prompt: string }
  | { kind: 'licensed-stock'; provider: string; licenceId: string } | { kind: 'unknown' };
export type AssetCost = { kind: 'receipt'; receiptId: string } | { kind: 'not-measured' } | { kind: 'reused'; assetId: string };
export type DerivedUnit = 'narration' | 'captions' | 'translation' | 'dub' | 'article' | 'chapters';
export type AssetSourceRef = { kind: 'upload'; id: string } | { kind: 'asset'; id: string } | { kind: 'transcript'; orderId: string };
export interface AssetView {
  id: string; at: string; orderId: string; clientId: string; runId: string | null; toolCallId: string | null; name: string; fileDigest: string | null;
  source: AssetSource; licence: string | null; attribution: string | null; cost: AssetCost; consentId: string | null;
  state: 'ready' | 'requested' | 'consent-withdrawn'; hygiene: { state: 'clean' | 'held' | 'not-media'; removed: string[] };
  derived: { unit: DerivedUnit; source: AssetSourceRef; sourceDigest: string } | null;
  supersededBy: string | null; supersedes: string | null; reusedFrom: string | null;
  stale: boolean; blocked: { code: string; line: Display } | null; sourceLine: Display; costLine: Display;
}
export interface AssetsView { assets: AssetView[]; line: Display }
export interface AssetRerunView { asset: AssetView; superseded: AssetView; line: Display }
export interface AssetReuseView { asset: AssetView; line: Display }
export type VoiceConsentState = 'current' | 'expired' | 'revoked' | 'replaced';
export interface VoiceConsentItem {
  id: string; at: string; speaker: string; recordingFileId: string; recordingDigest: string; transcript: string; statement: string; scope: string;
  until: string | null; version: number; revokedAt: string | null; state: VoiceConsentState; assetsMade: number;
}
export interface VoiceConsentView { consent: VoiceConsentItem; line: Display }
export interface VoiceConsentsView { consents: VoiceConsentItem[]; line: Display }
/** 5A5 */
export type ReportFormat = 'html' | 'pdf' | 'docx' | 'xlsx';
/** One file of a report: its name, format, size, sha256 and bytes (base64), for the screen to offer as a download. */
export interface ReportFileView { name: string; format: ReportFormat; bytes: number; sha256: string; contentBase64: string }
/** venture.report.render: the files made (HTML always), manifest.json, why a PDF was not made, and what the report covers. */
export interface ReportView {
  id: string; runId: string; title: string; formats: ReportFormat[]; files: ReportFileView[];
  manifest: { name: 'manifest.json'; bytes: number; sha256: string; contentBase64: string };
  notes: Display[]; channels: string[]; period: { from: string; to: string } | null; estimates: number;
}
/** venture.report.list: each report without bytes (save makes it again), with every link's state, views and end. */
export interface ReportListItem {
  id: string; runId: string; orderId: string; title: string; at: string; formats: ReportFormat[]; files: Omit<ReportFileView, 'contentBase64'>[];
  manifest: { name: 'manifest.json'; bytes: number; sha256: string }; notes: Display[]; channels: string[];
  period: { from: string; to: string } | null; estimates: number; links: ReportShareView[];
}
export interface ReportListView { reports: ReportListItem[] }
/** venture.report.share, .shareRotate, .shareDisable: url only in the answer that made or rotated it; reason otherwise. */
export interface ReportShareView {
  id: string; reportId: string; url: string | null; reason?: Display; from: string; to: string; channels: string[];
  state: 'open' | 'disabled' | 'ended'; expiresAt: string; views: number; viewedAt: string | null;
}
/** 5A6 */
export type MonitorKind = 'change' | 'contains' | 'price-below';
export interface MonitorInput { url: string; kind: MonitorKind; text?: string; selector?: string; belowRupees?: string }
/** platform/runtime/venture/build/records-connect.ts, the same shapes. */
export interface MonitorView {
  id: string; url: string; host: string; kind: MonitorKind; line: Display; lastCheckedAt: string | null; nextCheckAt: string | null;
  alert: { at: string; line: Display } | null; failing: boolean; removed: boolean;
}
export interface MonitorsView { monitors: MonitorView[]; line: Display; hosted: boolean }
export interface MailImportView { added: number; repeats: number; skipped: number; held: number; threads: number; line: Display }
export interface MailThreadView {
  id: string; subject: Display; from: string; count: number; lastAt: string; sources: ('mailbox' | 'file-import')[]; clientId: string | null;
  desk: { playbook: string; kind: string } | null; held: boolean;
}
export interface MailThreadsView { threads: MailThreadView[]; mailbox: { connected: boolean; label: 'read'; line: Display; manualPath: Display } }
export type LocalAppId = 'baocut' | 'kimo' | 'filmcraft';
export interface LocalAppView {
  id: LocalAppId; name: string; label: 'write' | 'planned: write'; found: boolean; note: Display; licence: Display; manualPath: Display | null;
  needs: { remedy: Display; next: Display | null; at: string; command: string } | null;
}
export interface LocalAppsView { apps: LocalAppView[]; hosted: boolean; line: Display }
export type WebhookKind = 'n8n' | 'make';
export interface WebhookView { kind: WebhookKind; set: boolean; host: string | null; line: Display; test: 'answered' | 'unknown' | null }
/** W6 6F4: venture.webhook.send's preview (no digest) or receipt (with the digest the owner saw). */
export interface WebhookSendView {
  kind: WebhookKind; host: string; text: string; digest: string; state: 'preview' | 'applied' | 'refused' | 'unknown';
  status: number | null; deliveryId: string | null; attempts: number; entryId: string | null; line: Display;
}
export interface SpeechProviderView {
  id: string; name: string; label: 'write' | 'planned: write'; languages: string[]; voices: { id: string; name: string; language: string; licence: Display }[];
  maxChars: number; price: { microsPerMillionChars: string; checkedOn: string; source: string } | null; waitsOn: Display | null; manualPath: Display | null; note: Display;
}
export interface SpeechProvidersView { providers: SpeechProviderView[]; line: Display }
/** 5C1, 5C2 */
export type CitationConfirmation = { name: string; membershipNumber: string; at: string };
export type CaCitationsView = { version: number; tableHash: string; confirmedBy: CitationConfirmation | null; rows: {id:string;act:string;section:string;title:string;validFrom:string;validTo:string;replacedBy:string|null;source:string;verification:string}[]; rules:{id:string;title:string;assessmentYear:string;validFrom:string;validTo:string;verification:string;source:string}[] };
export type CitationsConfirmView = { version: number; tableHash: string; confirmedBy: CitationConfirmation };
export type SignoffCheckView = { id:string;ca:{name:string;membershipNumber:string};at:string;decision:'signed'|'returned';playbookHash:string|null;workingDigest:string;receipts:{id:string;digest:string|null}[];rederived:'same'|'differs';differs:{key:string;line:string}|null };
export type DifferentialAddView = W5Placeholder;
export type DataPackExportView={name:string;mime:string;contentBase64:string;digest:string;approvalDigest:string};
/**
 * Every business's desk (playbooks/desk-types.ts): one playbook id, one of its record kinds. rows, item and result are
 * the owning package's shapes; a desk package narrows them where it reads them.
 */
export type DeskPlaybook =
  | 'youtube' | 'ca-firm' | 'social-agency' | 'seo-visibility' | 'online-seller' | 'support-desk' | 'recruiting-desk' | 'job-search-desk'
  | 'translation-studio' | 'bookkeeping-cfo' | 'podcast-to-article' | 'lead-generation' | 'newsletter-studio' | 'tender-desk'
  | 'website-studio' | 'narration-studio' | 'virtual-assistant' | 'data-entry-desk' | 'app-testing' | 'dev-agency' | 'monitored-data'
  | 'it-triage' | 'phone-receptionist'
  // W6 6E2, 6E3
  | 'lesson-desk' | 'booking-desk'
  // W6 6E4, 6E5
  | 'document-desk' | 'signoff-desk'
  // W6 6E7
  | 'trading-journal';
export interface DeskListView { playbook: DeskPlaybook; kind: string; rows: unknown[]; line: Display }
export interface DeskItemView { playbook: DeskPlaybook; kind: string; item: unknown; digest: string }
export interface DeskActView { playbook: DeskPlaybook; kind: string; id: string; result: unknown; line: Display }

// ---------------------------------------------------------------------------------------------------------------
// The methods the UI calls, with their params and results.
// ---------------------------------------------------------------------------------------------------------------

export interface EngineMethods {
  'venture.queue.list': { params: { scope?: 'current' | 'all' }; result: QueueList };
  'venture.queue.decide': { params: { id: string; digest: string; action: QueueActionId; answer?: string; viewed?: boolean }; result: QueueDecision };
  // 4J19: opened only when the owner explicitly opened the item; a card drawing its preview sends none (no view mark).
  'venture.queue.view': { params: { kind: QueueItemView['kind']; id: string; opened?: true }; result: QueueItemView };
  'venture.runs.list': { params: { state?: 'active' | 'done' | 'all' }; result: { runs: RunSummary[] } };
  'venture.runs.get': { params: { runId: string }; result: RunDetail };
  'venture.team.list': { params: Record<string, never>; result: TeamListView };
  'venture.team.gate': { params: { agentId: string; stepId: string; gate: 'auto' | 'hold' }; result: { agent: AgentView } };
  'venture.spend.list': { params: Record<string, never>; result: { rows: SpendRow[]; total: Display; totalRupees?: Display; totalLead?: SpendLead; needsRate?: boolean } };
  'venture.spend.policy.get': { params: Record<string, never>; result: SpendPolicyView };
  'venture.spend.policy.set': {
    params: {
      /** C5 task 15: use the reference rate shipped with this release; not together with inrPerUsd. */
      useReference?: true;
      capUsd?: string | null; askFirstUsd?: string | null; rates?: SpendRateInput[]; inrPerUsd?: string | null;
      // 4F2: the day's cap, the alert share in permille, each agent's own monthly limit, and lower daily write caps.
      dailyCapUsd?: string | null; alertPermille?: number; agentCaps?: { agent: string; capUsd: string }[]; writeCaps?: Partial<Record<WriteCapKind, number>>;
      /** W6 6G5: each routine's own monthly limit in US dollars; the list replaces the one in force. */
      routineCaps?: { routine: string; capUsd: string }[];
      // 4Z3: which currency leads spend.
      currencyLead?: CurrencyLead;
    };
    result: SpendPolicyView;
  };
  'venture.journal.list': { params: { limit?: number }; result: { entries: JournalEntry[] } };
  'venture.journal.resolve': { params: { entryId: string; outcome: 'sent' | 'not-sent'; note?: string }; result: { entry: JournalEntry } };
  'venture.untrusted.mode': { params: { mode: 'observe' | 'enforce' }; result: { mode: 'observe' | 'enforce' } };
  'venture.untrusted.release': { params: { digest: string }; result: { digest: string; released: true } };
  'venture.evidence.list': { params: { subject?: string }; result: { items: EvidenceItem[] } };
  'venture.evidence.apply': { params: { id: string }; result: { item: EvidenceItem } };
  'venture.evidence.dismiss': { params: { id: string }; result: { item: EvidenceItem } };
  'venture.money.overview': { params: Record<string, never>; result: MoneyOverview };
  'venture.tax.working': { params: { period?: string }; result: TaxWorking };
  /** Refused with POSTURE_ABOVE_STAGE when the business is not far enough along for that posture. */
  'venture.team.posture': { params: { agentId: string; posture: Posture }; result: { agent: AgentView } };
  'venture.ca.get': { params: Record<string, never>; result: CaView };
  /** After each CA write the page reads venture.ca.get again, so it shows what the engine holds. */
  'venture.ca.setOfRecord': { params: { name: string; membershipNo: string }; result: CaView };
  'venture.ca.recordSignoff': { params: { requestId: string; membershipNo: string; note?: string }; result: { request: CaSignoffRequest } };
  'venture.ca.confirmRates': { params: { tableIds: string[]; membershipNo: string }; result: CaView };
  'venture.leads.add': { params: { name: string; company?: string; email?: string; sourceUrl: string }; result: LeadView };
  'venture.leads.list': { params: Record<string, never>; result: { leads: LeadView[] } };
  'venture.leads.draft': { params: { leadId: string; subject: string; body: string; postalAddress?: string }; result: { lead: LeadView; draft: OutreachDraftView } };
  'venture.leads.recordSend': { params: { leadId: string; draftId: string; sentAt: string }; result: LeadView };
  'venture.leads.block': { params: { value: string }; result: { blocked: string[] } };
  'venture.bank.import': { params: { csv: string; account: string }; result: BankImportResult };
  'venture.bank.consent': { params: { account: string; days?: number; revoke?: boolean }; result: BankConsentView };
  'venture.site.stage': { params: { path: string; after: string; summary: string }; result: SiteEditLite };
  'venture.site.apply': { params: { editId: string; reviewedHash: string }; result: SiteEditLite };
  'venture.site.revert': { params: { editId: string; reviewedHash: string }; result: SiteEditLite };
  // 4J7: kind 'draft' (the default) takes deliveryId; 'order-status' orderId; 'statement' clientId; 'books' month.
  'venture.share.create': { params: { deliveryId?: string; kind?: 'draft' | 'order-status' | 'statement' | 'books'; orderId?: string; clientId?: string; month?: string; expiresInHours?: number }; result: ShareLink };
  /**
   * `links` is the contract's name; the engine sends the same list as `shares` too. `posts`: with a deliveryId, its posts;
   * `clientApproval`: whether they go out only after the client approved the draft; `answer`: the client's answer the
   * engine counts for the draft as it is now, or null (what Post and the record control read).
   */
  'venture.share.list': { params: { deliveryId?: string }; result: { links?: ShareLink[]; shares?: ShareLink[]; posts?: DraftPostLite[]; clientApproval?: boolean; answer?: ShareAnswer | null } };
  'venture.share.revoke': { params: { id: string }; result: ShareLink };
  'venture.events': { params: { afterSeq?: number; limit?: number }; result: VentureEventsResult };
  'venture.get': { params: Record<string, never>; result: VentureViewLite | null };
  'venture.receipt.get': { params: { id: string }; result: ReceiptLite };
  'venture.books.summary': { params: { period?: BooksPeriodKey | string }; result: BooksSummaryLite };
  'venture.invoice.get': { params: { invoiceId: string }; result: InvoiceViewLite };
  'venture.invoice.prepare': { params: { orderId: string; dueInDays?: number; issueDate?: string; reminderDays?: number[]; part?: { kind: 'advance' | 'milestone' | 'partial' | 'final'; label?: string; percent?: string; amount?: string } }; result: InvoiceViewLite };
  'venture.invoice.issue': { params: { invoiceId: string; digest: string }; result: InvoiceViewLite };
  /** 4J5: allocations splits one payment of amount across invoices, in place of invoiceId; tds: what the client deducted (India). */
  'venture.payment.record': {
    params: { invoiceId?: string; amount: string; receivedOn: string; method: PaymentMethod; allocations?: { invoiceId: string; amount: string }[]; tds?: { section: string; amount: string } };
    result: InvoiceViewLite;
  };
  'venture.connectors.list': { params: { category?: string; starterOnly?: boolean }; result: ConnectorCardLite[] };
  'venture.models.presets': { params: Record<string, never>; result: ModelPresetLite[] };
  'venture.models.status': { params: Record<string, never>; result: ModelStatusLite };
  'venture.models.connect': { params: ModelConnectParams; result: ModelStatusLite };
  'venture.models.disconnect': { params: { connectionId: string }; result: ModelStatusLite };
  'venture.ai.options': { params: Record<string, never>; result: AiOptionsLite };
  'venture.ai.status': { params: Record<string, never>; result: ModelStatusLite };
  'venture.ai.connect': { params: ModelConnectParams; result: ModelStatusLite };
  'venture.ai.disconnect': { params: { connectionId: string }; result: ModelStatusLite };
  'venture.blueprint.get': { params: Record<string, never>; result: BlueprintViewLite | null };
  /** basedOn (4J8): a suggestion's plan; refused APPROVAL_STALE when the plan changed since. */
  'venture.blueprint.update': { params: { patch: BlueprintPatchLite; basedOn?: { blueprintId: string; digest: string }; ownerSave?: true }; result: BlueprintViewLite };
  'venture.price.quote': { params: { offerId: string; quantity?: string }; result: ReceiptLite };
  'venture.build.brief': { params: { useTemplate?: boolean }; result: BriefLite };
  'venture.build.handoff': { params: { builder: BuilderId }; result: HandoffPlanLite };
  'venture.build.handoffOpened': { params: { handoffId: string }; result: HandoffLite };
  'venture.build.link': { params: { repo: string; token?: string }; result: BuildFollowLite };
  'venture.build.sync': { params: Record<string, never>; result: BuildStatusLite };
  'venture.build.status': { params: Record<string, never>; result: BuildStatusView };
  /** C5 task 36: the owner's language on this computer, before any vault is open. */
  'workspace.custody.get': { params: Record<string, never>; result: CustodyViewLite };
  // One-shot C3: the app's own preferences on this computer (platform/runtime/app-preferences.ts), before any business.
  'app.preferences.get': { params: Record<string, never>; result: AppPreferencesLite };
  'venture.work.list': { params: Record<string, never>; result: { work: WorkJobLite[] } };
  'app.preferences.set': { params: Partial<AppPreferencesLite>; result: AppPreferencesLite };
  // C5 tasks 31, 33: answered with no business open (platform/runtime/update-service.ts).
  'updates.status': { params: Record<string, never>; result: UpdatesView };
  'updates.settings': { params: { daily?: boolean; channel?: 'beta' | 'stable' }; result: UpdatesView };
  'updates.check': { params: Record<string, never>; result: UpdatesView };
  'workspace.custody.recoveryCode': { params: { passphrase?: string }; result: { custody: CustodyViewLite; recoveryCode: string } };
  'workspace.custody.passphraseOn': { params: { passphrase: string }; result: { custody: CustodyViewLite; recoveryCode: string | null } };
  'workspace.custody.passphraseOff': { params: { passphrase: string }; result: { custody: CustodyViewLite } };
  /** 4J6: start a new never-contact list, only once the old one can no longer be checked; confirmation is the open business's name. */
  'workspace.custody.neverContactReset': { params: { confirmation: string }; result: { line: string } };
  /** With a business open, its backups; with none open (Welcome back), every backup on this computer, newest first. */
  'workspace.backups.list': { params: Record<string, never>; result: { backups: BackupLite[]; more: boolean } };
  'workspace.backups.create': { params: Record<string, never>; result: BackupLite };
  /** C5 task 24: DRIVE_NOT_SET_UP until the build has its Google client. */
  'workspace.backups.drive.status': { params: Record<string, never>; result: DriveStatusLite };
  'workspace.backups.drive.connect': { params: Record<string, never>; result: { state: 'connecting'; url: string } };
  'workspace.backups.drive.disconnect': { params: Record<string, never>; result: DriveStatusLite };
  /** The open business goes back to the backup. The engine writes a safety copy of how it is now first. */
  'workspace.backups.restore': { params: { file: string; confirmed: true }; result: { workspace: WorkspaceLite; restoredFrom: BackupLite; safety: BackupLite } };
  /** One-shot C6: reads the backup in memory (never restores or writes); the open business's own backups only. */
  'workspace.backups.inspect': { params: { file: string }; result: BackupInspectLite };
  /** Needs the passphrase when the business is locked with one (PASSPHRASE_WRONG otherwise). */
  /** dismiss (C4 task 38): takes the "Move file made" line away. */
  'workspace.transfer.export': { params: { passphrase?: string } | { dismiss: true }; result: MoveFile | { dismissed: true } };
  /** C4 task 38: the business name and the time inside a move file, read with its code; nothing is written. */
  'workspace.transfer.peek': { params: { fileText: string; transferCode: string }; result: { name: string; movedOutAt: string | null } };
  /** With no business open: the move file's text and its code. A new passphrase only after DEVICE_KEYS_UNAVAILABLE. */
  'workspace.transfer.import': { params: { fileText: string; transferCode: string; passphrase?: string }; result: { workspace: WorkspaceLite; folder: string; unlock: UnlockMode } };
  /** With no business open: the recovery code opens it. A new passphrase only after DEVICE_KEYS_UNAVAILABLE. */
  'workspace.recover': { params: { folder: string; recoveryCode: string; passphrase?: string }; result: { workspace: WorkspaceLite } };
  /**
   * With no business open: a backup by its name in the backups folder (never a path), opened as a new business beside
   * the original (folder null lets the engine choose). PASSPHRASE_REQUIRED asks for the passphrase; DEVICE_KEY_FAILED
   * asks for the recovery code.
   */
  'workspace.restore': { params: { backupFile: string; folder?: string | null; passphrase?: string; recoveryCode?: string }; result: { workspace: WorkspaceLite; folder?: string } };
  /** A copy in Chausar's exports folder. `confirmed` is sent only after the owner chose; plaintext only after a second ask. */
  'workspace.export': { params: { confirmed: true; plaintext: boolean }; result: { path: string; name?: string; encrypted: boolean } };
  /** `confirmation` is the business name exactly as the vault holds it (workspace.status). */
  'workspace.delete': { params: { confirmation: string }; result: Deleted };
  /**
   * The business's privacy rule (platform/runtime/trust.ts updatePolicy, a partial patch): `send` is what may leave
   * this computer for an AI, checked by the engine before every call. Ink changes only `send`; the reply is the policy.
   */
  'trust.update': { params: { send: ModelStatusLite['sendPolicy'] }; result: { send: ModelStatusLite['sendPolicy'] } };
  'venture.client.list': { params: Record<string, never>; result: ClientLite[] };
  'venture.client.add': { params: ClientAddParams; result: ClientLite };
  'venture.client.aiConsent.get': { params: {clientId:string}; result: ClientAiConsentView };
  'venture.client.aiConsent.agree': { params: {clientId:string;disclosureDigest:string}; result: ClientAiConsentView };
  'venture.client.aiConsent.withdraw': { params: {clientId:string}; result: ClientAiConsentView };
  // Wave 6 money (6D1 to 6D4)
  'venture.billing.get': { params: Record<string, never>; result: BillingView };
  'venture.billing.set': { params: BillingPatch; result: BillingView };
  'venture.invoice.pdf': { params: { invoiceId: string }; result: InvoicePdfView };
  /** One-shot C6: a payment's thank-you receipt: its words, its WhatsApp link and its file, made by code. Nothing is sent. */
  'venture.payment.receipt': { params: { paymentId: string }; result: InvoicePdfView };
  'venture.invoice.payLink': { params: { invoiceId: string; action: 'create'; digest: string } | { invoiceId: string; action: 'check' }; result: InvoiceViewLite };
  'venture.agentSettings.get': { params: Record<string,never>; result: AiSettingsView };
  'venture.agentSettings.set': { params: {settings:AiSettings; approveMcpConfiguration?:true}; result: AiSettingsView };
  'venture.mcpCredential.set': { params:{serverId:string;token:string|null};result:{serverId:string;saved:boolean} };
  // W6 6F1, 6F2: the curated MCP list, OAuth sign-in, playbook packs; a server question's answer rides on the approval.
  'venture.mcpRegistry.list': { params: Record<string, never>; result: import('../../../../platform/runtime/venture/agent-runtime/mcp-registry').CuratedMcpView };
  'venture.mcpOAuth.start': { params: {serverId:string}; result: {serverId:string;authorizationUrl:string} };
  'venture.packs.list': { params: Record<string, never>; result: {packs:import('../../../../platform/runtime/venture/packs/pack-format').PackView[]} };
  'venture.packs.add': { params: {pack:unknown;digest?:string}; result: {added:boolean;digest:string;pack:import('../../../../platform/runtime/venture/packs/pack-format').PackView} };
  'venture.packs.remove': { params: {packId:string}; result: {removed:boolean} };
  'venture.agentApproval.decide': { params: {runId:string;digest:string;decision:'approve'|'deny';content?:Record<string,unknown>}; result: {runId:string;decision:'approve'|'deny'} };
  'venture.order.list': { params: Record<string, never>; result: OrderLite[] };
  'venture.files.list': { params: { orderId?: string }; result: UploadLite[] };
  'venture.delivery.list': { params: Record<string, never>; result: DeliveryLite[] };
  /**
   * intake: only for a flagship playbook's offer (OfferLite.playbookOffer). An offer that cuts footage is refused with
   * RIGHTS_REQUIRED until intake.rights says whose footage it is: { basis: 'own-footage' | 'licence' | 'creator-clip-programme', holder, reference? }.
   */
  'venture.order.create': {
    params: {
      clientId?: string; offerId: string; quantity?: string; request: string;
      /** One-shot A1 (row 10): a client typed with the order, added with it or not at all; never with clientId. */
      newClient?: ClientAddParams;
      /** Wave 6: when the whole order is due (6D1); a client abroad's currency and the owner's price in it (6D4). */
      dueDate?: string; currency?: string; unitPrice?: string;
      intakeFiles?: Record<string, { name: string; contentBase64: string }>;
      intake?: {
        rights?: { basis: string; holder: string; reference?: string; scope?: string; expiresOn?: string }; format?: 'long' | 'short'; aiVoice?: boolean; aiPresenter?: boolean; paidPromotion?: boolean; cutFile?: string;
        calendar?: CalendarIntakeLite; clientRules?: ClientRulesLite;
        /** Kit answers; rupee inputs are parsed only by the engine. */
        fields?: Record<string, string | boolean | readonly string[] | readonly { name: string; consentId: string | null }[] | null>;
        moneyAmounts?: Record<string, string>;
      };
      /** 4J5 (M15): the price includes the tax. */
      taxInclusive?: boolean;
    };
    result: OrderLite;
  };
  'venture.order.deliver': { params: { orderId: string; deliveredOn: string }; result: OrderLite };
  'venture.delivery.run': { params: { orderId: string; useTemplate?: boolean }; result: DeliveryLite };
  'venture.invoice.list': { params: Record<string, never>; result: InvoiceLite[] };
  'venture.files.add': { params: { orderId: string; name: string; contentBase64: string }; result: UploadLite };
  'workspace.list': { params: Record<string, never>; result: BusinessList };
  /** On this computer a business opens by its folder; on hosted, by its id on the account (platform/runtime/hosted/app.ts). */
  'workspace.open': { params: { folder?: string; passphrase?: string; businessId?: string }; result: unknown };
  // Onboarding, in the engine's order.
  'workspace.status': { params: Record<string, never>; result: WorkspaceStatusLite };
  // C7: What's new, once per version on this computer.
  'whatsNew.get': { params: Record<string, never>; result: { version: string; seen: boolean } };
  'whatsNew.seen': { params: { version: string }; result: { version: string; seen: boolean } };
  'workspace.lock': { params: Record<string, never>; result: { locked: true } };
  'workspace.create': { params: WorkspaceCreateParams; result: WorkspaceCreated };
  'venture.countries': { params: Record<string, never>; result: CountryLite[] };
  'venture.preview': { params: { idea: string; countryCode: string; pricingModel?: PricingModel }; result: PlanPreviewLite };
  'venture.create': { params: { idea: string; countryCode: string; workingName?: string; reuseAi?: true }; result: VentureViewLite };
  'venture.interview.next': { params: { useTemplate?: boolean }; result: InterviewViewLite };
  'venture.interview.answer': { params: { questionId: string; answer: InterviewAnswer }; result: InterviewViewLite };
  /** shown (review of A1, row 3): the plan About you showed, kept on the first template draft; by is who wrote its words. */
  'venture.blueprint.draft': { params: { useTemplate?: boolean; shown?: KeptShownLite }; result: BlueprintViewLite };
  // Ink v2 wave 2: the newly wired engine methods.
  'venture.delivery.judge': { params: { runId: string }; result: JudgePreview };
  'venture.delivery.judgeSend': { params: { runId: string; digest: string }; result: DeliveryLite };
  'venture.improve.rollback': { params: { playbookId: string; digest: string }; result: PlaybookLite };
  // Practice and improvement (2C2): the engine's existing methods, which Ink now calls.
  'venture.simulation.scenarios': { params: Record<string, never>; result: ScenarioLite[] };
  /** No scenarioIds: every template practice client. useTemplate: built-in templates, no AI and no judge. */
  'venture.simulation.run': { params: { scenarioIds?: string[]; episodes?: number; useTemplate?: boolean }; result: SimulationRunLite };
  'venture.improve.status': { params: Record<string, never>; result: ImprovementStatusLite };
  'venture.improve.run': { params: { maxRounds?: number; useTemplate?: boolean; budgetMicros?: string }; result: ImprovementRunLite };
  /** The owner's, inside the app: the kept version by its run and the digest the owner read (CANDIDATE_STALE otherwise). */
  'venture.improve.adopt': { params: { runId: string; digest: string }; result: PlaybookLite };
  /** Desktop only: a transcript made on this computer from the order's cut, listed then as an order file. */
  'venture.files.transcribe': { params: { orderId: string }; result: UploadLite };
  /** draftId: '<delivery run id>.post-<n>'. The text comes from the stored draft, never from the screen. */
  'venture.posting.propose': { params: { draftId: string; account?: string }; result: PostingProposal };
  'venture.posting.signIn': { params: { connectorId: string }; result: { opened: true; line: Display } };
  'venture.posting.checkSteps': { params: { connectorId: string }; result: PostingStepsView };
  'venture.share.recordAnswer': { params: { draftId: string; answer: 'approved' | 'changes'; comment?: string }; result: { answer: ShareAnswer } };
  'venture.social.calendar': { params: { runId: string }; result: SocialCalendarFile };
  'venture.bank.ledger': { params: { account?: string; month?: string }; result: BankLedgerView };
  'venture.bank.apply': { params: { transactionId: string; as: 'payment' | 'cost' | 'skip'; invoiceId?: string }; result: BankApplyResult };
  'venture.bank.alerts.get': { params: Record<string, never>; result: BankAlertsView };
  'venture.bank.alerts.set': { params: { account: string; rules: BankAlertRuleInputLite[]; alertAddress?: string | null }; result: BankAlertsView };
  'venture.ca.receipt': { params: { id: string }; result: CaReceiptView };
  'venture.ca.explainDiff': { params: { receiptId: string; key: string; note: string; membershipNo: string }; result: { explanation: CaDiffExplanation } };
  'venture.rules.list': { params: Record<string, never>; result: RulesListView };
  'venture.rules.locks': { params: Record<string, never>; result: RuleLocksLite };
  'venture.rules.attest': { params: { ruleId: string; attest: boolean; digest?: string }; result: RuleLocksLite };
  'venture.compliance.get': { params: { profession?: string; size?: SizeAnswersLite }; result: ComplianceLite };
  'venture.compliance.set': { params: { profession: string; sideWork: 'no-day-job' | 'allowed' | 'not-allowed' | 'not-sure'; digest: string; size?: SizeAnswersLite } | { size: SizeAnswersLite }; result: ComplianceLite };
  'venture.judge.auto.get': { params: Record<string, never>; result: JudgeAutoView };
  /** The owner's, inside the app. auto: true records the standing consent for the judge's calls. */
  'venture.judge.auto.set': { params: { auto: boolean }; result: JudgeAutoView };
  /** Per channel: Chausar's own posting limits, the owner's settings and those in use (Ink v2 wave 2, 2B1). */
  'venture.posting.limits.get': { params: Record<string, never>; result: PostingLimitsView };
  /** The owner's, inside the app: only stricter numbers (POSTING_LIMIT_LOOSER otherwise); a number left out is Chausar's own. */
  'venture.posting.limits.set': { params: { connectorId: string; limits: Partial<OwnerPostingLimits> }; result: PostingLimitsView };
  /** The owner's whisper.cpp for transcripts made on this computer, with its honest status (Ink v2 wave 2, 2E2). */
  'venture.transcription.get': { params: Record<string, never>; result: TranscriptionSetupView };
  /** The owner's, inside the app, desktop only: full paths to whisper-cli and its model file, or { clear: true }. */
  'venture.transcription.set': { params: { command: string; model: string } | { clear: true }; result: TranscriptionSetupView };
  // Ink v2 wave 4 (package 4-0 named them; each answers NOT_BUILT_YET until its package lands, and the fake refuses it).
  // 4A1 Keeper and health.
  'venture.team.keeper': { params: Record<string, never>; result: KeeperView };
  'venture.team.clearQuarantine': { params: { agentId: string; digest: string }; result: { agent: AgentView | null; teamHealth: AgentHealth } };
  // 4B1 agent chat, proposals, versions, standing orders, the chat consent; 4B2 notes.
  'venture.agents.thread.list': { params: { agent: string; before?: string }; result: AgentThreadView };
  'venture.agents.thread.send': { params: { agent: string; text: string }; result: AgentSendResult };
  'venture.agents.proposal.decide': { params: { id: string; digest: string; decision: 'accept' | 'reject' }; result: { proposal: AgentProposalView; line: Display; playbook?: { id: string; version: number } } };
  'venture.agents.version.undo': { params: { agent: string; digest: string }; result: { playbookId: string; version: number; line: Display } };
  'venture.agents.orders.list': { params: { agent: string }; result: StandingOrdersView };
  'venture.chats.consent': { params: { digest: string }; result: ChatConsentView };
  'venture.agents.notes.list': { params: { agent: string }; result: AgentNotesView };
  'venture.agents.notes.edit': { params: { agent: string; noteId?: string; text: string; basedOn?: string }; result: AgentNoteChange };
  'venture.agents.notes.forget': { params: { agent: string; noteId: string }; result: AgentNoteChange };
  'venture.agents.notes.undo': { params: { agent: string; changeId: string }; result: AgentNoteChange };
  // 4C1 Chats and proposals.
  'venture.chief.threads': { params: Record<string, never>; result: ChiefThreadsView };
  'venture.chief.thread.list': { params: { threadId: string; before?: string }; result: ChiefThreadView };
  'venture.chief.thread.send': { params: { threadId?: string; text: string }; result: ChiefSendResult };
  'venture.chief.thread.pin': { params: { threadId: string; pinned: boolean }; result: { thread: ChiefThreadSummary } };
  // W6 6G1 (D42): a chat's state with its exact Undo, and the quiet days before one settles (0 is never).
  'venture.chief.thread.state': { params: ChiefThreadStateInput; result: ChiefThreadStateResult };
  'venture.chief.settle.set': { params: { days: number }; result: ChiefSettleResult };
  // W6 6G2 (D43): the check before retiring an agent, retiring it (to: another agent's id or 'owner'), and Bring back.
  'venture.agents.retire.check': { params: { agent: string }; result: RetireCheckView };
  'venture.agents.retire': { params: { agent: string; to: string; digest: string }; result: { retired: RetiredAgentView; line: Display } };
  'venture.agents.restore': { params: { agent: string }; result: { agent: AgentView; routines: number; line: Display } };
  // W6 6H1 (D39): mini apps, their permission screen, versions with undo, pin, export, delete and the MCP Apps bridge.
  'venture.apps.list': { params: Record<string, never>; result: { apps: MiniAppCard[]; ideas: { label: Display; preview: Display }[]; never: Display } };
  'venture.apps.get': { params: { app: string }; result: { app: MiniAppView } };
  'venture.apps.make': { params: { ask: string; app?: string }; result: { app: MiniAppView; line: Display } };
  'venture.apps.grant': { params: { app: string; digest: string }; result: { app: MiniAppView; line: Display } };
  'venture.apps.revoke': { params: { app: string }; result: { app: MiniAppView; line: Display } };
  'venture.apps.restore': { params: { app: string; version: number }; result: { app: MiniAppView; undo: { version: number }; line: Display } };
  'venture.apps.pin': { params: { app: string; pinned: boolean }; result: { app: MiniAppView; undo: { pinned: boolean }; line: Display } };
  'venture.apps.export': { params: { app: string }; result: { fileName: string; document: string; mediaType: 'text/html' } };
  'venture.apps.call': { params: { app: string; tool: string; arguments: Record<string, unknown>; sample?: true }; result: MiniAppCallResult };
  'venture.apps.remove': { params: { app: string }; result: { removed: true; line: Display } };
  // W6 6H3 (D40): a place's layout, read and changed by the owner (the AI changes it through Chausar's MCP tools).
  'venture.layout.get': { params: { place: LayoutPlace }; result: LayoutView };
  'venture.layout.change': { params: LayoutRequest; result: LayoutChangeResult };
  // C2: the command bar's find across the open business's clients, invoices, orders, runs and chats (read).
  'venture.find': { params: FindRequest; result: FindView };
  'venture.diagnostics.today': { params: Record<string, never>; result: DiagnosticsTodayView };
  'venture.build.briefFile': { params: { builder: FileBuilderId }; result: BriefFilePlanLite };
  'venture.accountant.pack.done': { params: { month: string }; result: { done: boolean } };
  'venture.accountant.schedule.set': { params: { on: boolean }; result: { on: boolean; at: string | null; next: string | null } };
  'venture.accountant.schedule.get': { params: Record<string, never>; result: { on: boolean; at: string | null; next: string | null } };
  'venture.accountant.set': { params: { email?: string | null; whatsapp?: string | null }; result: { email: string | null; whatsapp: string | null; at: string | null } };
  'venture.accountant.get': { params: Record<string, never>; result: { email: string | null; whatsapp: string | null; at: string | null } };
  'venture.notify.telegram.findChat': { params: { token: string }; result: { found: { chatId: string; name: string } | null; line: Display } };
  'venture.client.aiDefault.set': { params: { on: boolean; digest: string }; result: ClientAiDefaultView };
  'venture.client.aiDefault.get': { params: Record<string, never>; result: ClientAiDefaultView };
  'venture.away.preview': { params: { from: string; to: string }; result: { from: string; to: string; items: AwayView['promises'] } };
  'venture.team.introduced': { params: { agentIds: string[] }; result: { met: string[] } };
  // Wave 6 (6H2, D41): recorded flows, recorded once in the desktop's window and run with no AI.
  'venture.flows.list': { params: Record<string, never>; result: FlowsListView };
  'venture.flows.act': { params: FlowsActPayload; result: FlowsActView };
  // W6 6I1: push-to-talk (agents/talk.ts)
  'venture.talk.get': { params: Record<string, never>; result: TalkView };
  'venture.talk.consent': { params: TalkConsentInput; result: TalkView };
  'venture.talk.setup': { params: TalkSetupInput; result: TalkView };
  'venture.talk.start': { params: Record<string, never>; result: TalkStarted };
  'venture.talk.hear': { params: { sessionId: string; audioBase64: string }; result: TalkHeard };
  'venture.talk.say': { params: { threadId: string; messageId: string; quoted?: string; approvedRateDigest?: string }; result: TalkSaid };
  // W6 6J2: feedback, an opt-in Send report with its preview, short questions, crash notes and Delete my reports.
  'venture.feedback.get': { params: Record<string, never>; result: FeedbackView };
  'venture.feedback.consent': { params: FeedbackConsentInput; result: FeedbackView };
  'venture.feedback.send': { params: { digest: string }; result: FeedbackView };
  'venture.feedback.answer': { params: FeedbackAnswerInput; result: FeedbackView };
  'venture.feedback.crash': { params: FeedbackCrashInput; result: FeedbackCrashKept };
  'venture.feedback.delete': { params: Record<string, never>; result: FeedbackView };
  'venture.chief.fit': { params: Record<string, never>; result: ChiefFit | null };
  'venture.proposals.raise': { params: { id: string }; result: { proposal: ProposalView; rowId: string | null; line: Display } };
  'venture.proposals.dismiss': { params: { id: string }; result: { proposal: ProposalView } };
  // 4D1 to 4D3 the owner's network.
  'venture.network.import': { params: { kind: NetworkImportKind; name: string; text: string; check?: boolean }; result: NetworkImportResult };
  'venture.network.importUndo': { params: { importId: string; preview?: boolean }; result: { import: NetworkImportView; removed: number; goes: Display[]; preview: boolean; line: Display } };
  'venture.network.merge': { params: { a: string; b: string }; result: PersonView };
  'venture.network.split': { params: { personId: string; sourceIds: string[] }; result: { person: PersonView; split: PersonView } };
  'venture.network.forget': { params: { id: string }; result: { line: Display; kept: Display[] } };
  'venture.network.hide': { params: { personId: string; hidden: boolean }; result: { person: PersonSummary } };
  'venture.network.people': { params: { query?: string; hidden?: boolean; suggestions?: boolean; limit?: number }; result: PeopleView };
  'venture.network.person': { params: { id: string }; result: PersonView };
  'venture.network.sources': { params: Record<string, never>; result: NetworkSourcesView };
  'venture.network.recompute': { params: Record<string, never>; result: { ties: number; computedAt: string; line: Display } };
  'venture.network.know': { params: { personId: string; how: 'well' | 'met'; note?: string }; result: PersonView };
  'venture.network.link': { params: { a: string; b: string; note: string }; result: { line: Display } };
  'venture.network.search': { params: { text: string; web?: boolean }; result: NetworkSearchView };
  'venture.network.searchMore': { params: { searchId: string }; result: NetworkSearchView };
  'venture.network.saveSearch': { params: { searchId: string; name: string }; result: { search: { id: string; name: string; at: string } } };
  'venture.network.research': { params: { personId: string }; result: { lines: { text: string; url: string }[]; line: Display; web: 'not-set-up' | 'failed' | 'none' | 'found' } };
  // 4E1 to 4E3 the pipeline, outreach, the mailbox and inbound mail.
  'venture.pipeline.list': { params: { filter?: 'due' | 'draft' }; result: PipelineView };
  'venture.pipeline.followups': { params: Record<string, never>; result: { due: FollowupView[]; later: FollowupView[] } };
  'venture.pipeline.add': { params: { personId: string; trigger: { kind: 'import' | 'search' | 'saved-search' | 'owner' | 'lead'; ref?: string }; votes?: { factor: string; points: number; evidence: string }[] }; result: { card: PipelineCardView; line: Display } };
  'venture.pipeline.setNext': { params: { id: string; text: string; due: string }; result: { card: PipelineCardView; line: Display } };
  'venture.pipeline.move': { params: { id: string; stage: PipelineStage; reason?: LostReason; evidence?: { kind: 'reply' | 'quote' | 'note' | 'client'; id?: string; on?: string; text?: string } }; result: { card: PipelineCardView; line: Display } };
  'venture.pipeline.settings': { params: { weekdays?: number[]; sendTime?: string; caps?: { newPerDay?: number; perWeek?: number; channels?: Partial<Record<OutreachLane, number>>; channelWeeks?: Partial<Record<OutreachLane, number | null>>; warmupPercent?: number[] }; scoreRules?: ScoreRule[] }; result: PipelineSettingsView };
  'venture.outreach.draft': {
    params: {
      opportunityId: string; kind: OutreachKind; channel: OutreachChannel; basis?: LawfulBasis; limit?: 200 | 300; introduce?: string; about?: string;
      language?: OutreachLanguage; postalAddress?: string;
    };
    result: { draft: OutreachView; line: Display };
  };
  'venture.outreach.open': { params: { draftId: string }; result: OutreachHandoff };
  'venture.outreach.sent': { params: { draftId: string; at: string; channel: OutreachSentChannel }; result: { draft: OutreachView; card: PipelineCardView | null; line: Display } };
  'venture.outreach.restricted': { params: { channel: OutreachChannel }; result: { channel: OutreachChannel; until: string; line: Display } };
  'venture.mailbox.connect': { params: { host: string; port: number; user: string; appPassword: string }; result: MailboxView };
  'venture.mailbox.disconnect': { params: Record<string, never>; result: MailboxView };
  'venture.mailbox.sync': { params: Record<string, never>; result: { mailbox: MailboxView; added: number; line: Display } };
  'venture.inbound.list': { params: Record<string, never>; result: { items: InboundView[] } };
  'venture.inbound.confirm': { params: { id: string; opportunityId: string }; result: { item: InboundView } };
  'venture.network.calendar': { params: { url: string }; result: CalendarFeedView };
  'venture.meeting.digest': { params: { eventId?: string; notes: string }; result: { people: { name: string; personId: string | null }[]; proposals: ProposalView[]; line: Display; steps: { text: Display; person: string | null; due: string | null; proposalId: string | null; line: Display }[] } };
  // 4F1 and 4F2 run controls, pause all, Away, write caps.
  'venture.runs.stop': { params: { runId: string; force?: boolean }; result: RunControlResult };
  'venture.runs.resume': { params: { runId: string }; result: RunControlResult };
  'venture.runs.roundGate': { params: { runId: string; on: boolean; every?: 1 | 2 | 3 | 5 }; result: RunControlResult };
  'venture.runs.steer': { params: { runId: string; text: string }; result: RunControlResult };
  'venture.business.pause': { params: { paused: boolean; stopRunning?: boolean }; result: { paused: boolean; stopped: number; line: Display } };
  'venture.away.set': { params: { from: string; to: string } | { clear: true }; result: AwayView };
  'venture.away.get': { params: Record<string, never>; result: AwayView };
  'venture.runs.allowWrites': { params: { kind: WriteCapKind }; result: { kind: WriteCapKind; line: Display } };
  // 4G1 and 4G3 notifications and push.
  'venture.notify.list': { params: Record<string, never>; result: { items: NotificationView[]; unread: number; digest: NotifyDigestView | null } };
  'venture.notify.read': { params: { ids?: string[]; all?: boolean }; result: { unread: number } };
  'venture.notify.settings': { params: { pausedUntil?: string | null; quietHours?: { from: string; to: string } | null; digest?: { hour: number } | null; push?: boolean; tray?: boolean }; result: NotifySettingsView };
  'venture.notify.push.key': { params: Record<string, never>; result: { publicKey: string } };
  'venture.notify.push.subscribe': { params: { subscription: PushSubscriptionInput }; result: { subscribed: boolean; line: Display } };
  'venture.notify.push.unsubscribe': { params: { endpoint: string }; result: { subscribed: boolean; line: Display } };
  /** {} reads the relay (4G3); url null clears it. */
  'venture.notify.relay': { params: { url?: string | null }; result: { relay: Display | null; line: Display } };
  // W6 6F6 Telegram alerts from the owner's own bot; 6F7 phone access on this Wi-Fi or Tailscale.
  'venture.notify.telegram': { params: { bot?: { token: string; chatId: string } | null; details?: boolean; test?: true }; result: TelegramView };
  'venture.phone.access': { params: { action?: 'link' | 'stop'; via?: 'wifi' | 'tailscale'; hours?: number }; result: PhoneAccessView };
  // W6 6F3 web search (the AI tool's own first; the owner's own Brave, Exa or Tavily key for Chausar's lookups) and the polite reader.
  'venture.web.search': { params: { provider?: SearchProviderId | null; key?: string; consentDigest?: string }; result: WebSearchView };
  'venture.web.read': { params: { url: string }; result: WebReadView };
  // W6 6F8 people search on the owner's own keys: Happenstance (own network), Probe42 (MCA company records).
  'venture.people.services': { params: { service?: 'happenstance' | 'probe42'; key?: string | null }; result: PeopleSearchView };
  'venture.people.lookup': { params: { service: 'happenstance' | 'probe42'; query?: string; clientId?: string; digest?: string; searchId?: string }; result: PeopleLookupView };
  // W6 6G3 the CRM: field history, companies with two-way links, client timelines and lists (pipelines with their own stages).
  'venture.crm.client': { params: { clientId: string }; result: ClientCrmView };
  'venture.crm.client.edit': { params: { clientId: string; field: 'name' | 'email' | 'note' | 'phone'; value: string }; result: ClientCrmView };
  'venture.crm.companies': { params: Record<string, never>; result: CompanyRow[] };
  'venture.crm.company': { params: { companyId: string }; result: CompanyView };
  'venture.crm.company.save': { params: { companyId?: string; name?: string; domain?: string | null; note?: string | null }; result: CompanyView };
  'venture.crm.link': { params: { companyId: string | null; member: string }; result: CrmMemberView };
  'venture.crm.log': { params: { clientId: string; kind: CrmEntryKind; on: string; text: string }; result: ClientCrmView };
  'venture.crm.lists': { params: Record<string, never>; result: CrmListRow[] };
  'venture.crm.list': { params: { listId: string }; result: CrmListView };
  'venture.crm.list.save': { params: { listId?: string; name: string; stages: string[] }; result: CrmListView };
  'venture.crm.list.place': { params: { listId: string; member: string; stage: string | null }; result: CrmListView };
  // W6 6G4 dated memory: facts with since when, what they replaced, their source and who may see them.
  'venture.memory.list': { params: { subject?: string }; result: MemoryView };
  'venture.memory.add': { params: { subject: string; topic: string; text: string; since?: string; visibility?: FactVisibility }; result: MemoryChange };
  'venture.memory.replace': { params: { factId: string; text: string; since?: string }; result: MemoryChange };
  'venture.memory.visibility': { params: { factId: string; visibility: FactVisibility }; result: MemoryChange };
  'venture.memory.forget': { params: { factId: string }; result: MemoryChange };
  // 4H1 the CLI status and per-role models.
  /** `fresh: true` for "Check again": the engine looks at each tool again; left out, it may answer from a look in the last minute. */
  'venture.models.cli.status': { params: { fresh?: boolean }; result: { clis: CliStatusView[]; line: Display } };
  'venture.models.roles': { params: Record<string, never>; result: { roles: RoleModelView[]; line: Display } };
  // 4I1 goals.
  'venture.goals.get': { params: { month?: string }; result: GoalView };
  /** 4I2: amount is the owner's typed goal, which the engine reads in the business's currency; or exact amountMinor. */
  'venture.goals.set': { params: { month: string; amount: string; amountMinor?: never } | { month: string; amountMinor: string; amount?: never }; result: GoalView };
  'venture.goals.suggest': { params: { month: string }; result: GoalSuggestion | null };
  // 4J1 and 4J2 decisions, allow for this session, send back, edit, undo, set approval, triage, fixes, settings drafts.
  'venture.decisions.list': { params: Record<string, never>; result: { decisions: DecisionView[] } };
  'venture.policy.allowSession': { params: { stepId: string }; result: { stepId: string; line: Display } };
  'venture.queue.sendBack': { params: { rowId: string; digest: string; text: string }; result: QueueDecision };
  'venture.queue.edit': { params: { rowId: string; digest: string; text: string }; result: QueueDecision };
  'venture.queue.undo': { params: { rowId: string }; result: { restored: boolean; line: Display } };
  'venture.queue.set': { params: { rowIds: string[]; digest: string; secondAsk?: true }; result: { decisions: QueueDecision[]; line: Display; receiptId?: string } };
  'venture.triage.set': { params: { rule: TriageRule; digest: string }; result: { rule: TriageRule; line: Display } };
  'venture.triage.preview': { params: { text: string }; result: TriagePreview };
  'venture.delivery.fix': { params: { runId: string; checks: 'all' | string[] }; result: DeliveryLite };
  'venture.delivery.decideChange': { params: { runId: string; changeId: string; accept: boolean }; result: DraftChangesView };
  'venture.delivery.changes': { params: { runId: string }; result: DraftChangesView };
  'venture.settings.draft': { params: { form: string; values: unknown }; result: { form: string; at: string; line: Display } };
  'venture.settings.drafts': { params: Record<string, never>; result: { drafts: SettingsDraftView[] } };
  // 4J2 review: a set's server-made quote (digest, items, total with its receipt, second ask, refusals); a copy of a draft that went out.
  'venture.queue.setPreview': { params: { rowIds: string[] }; result: QueueSetPreview };
  'venture.delivery.copy': { params: { runId: string }; result: DeliveryLite };
  // 4J3 a still from the cut named at the order's intake (desktop, app only).
  'venture.files.poster': { params: { orderId: string }; result: UploadLite };
  // 4J4 to 4J6 money views, bills, credit notes, recurring invoices, reminders, money and runs across businesses.
  'venture.money.aging': { params: { asOf?: string }; result: AgingView };
  'venture.money.flow': { params: { months?: number }; result: FlowView };
  'venture.money.cash': { params: Record<string, never>; result: CashView };
  'venture.money.margins': { params: { month: string }; result: MarginsView };
  'venture.money.export': { params: { month: string; format?: MoneyExportFormat }; result: MoneyExportFile };
  // C4 (T22): with no dueDate the engine takes the vendor's last terms, else defaultDueDays after the bill date.
  'venture.bills.add': { params: { vendor: string; lines: BillLineInput[]; billDate: string; dueDate?: string; recurring?: 'monthly' | 'quarterly' | null }; result: { bill: BillView; receiptId?: string } };
  'venture.bills.pay': { params: { billId: string; paidOn: string; method: PaymentMethod } & ({ amount: string; amountMinor?: never } | { amountMinor: string; amount?: never }); result: { bill: BillView; receiptId?: string } };
  'venture.bills.list': { params: Record<string, never>; result: { bills: BillView[]; owed?: MoneyFigure | null; terms?: { vendor: string; days: number }[]; defaultDueDays?: number } };
  'venture.credit.issue': { params: { invoiceId: string; reason: string; digest: string } & ({ amount: string; amountMinor?: never } | { amountMinor: string; amount?: never }); result: { creditNote: CreditNoteView } };
  'venture.invoice.recurring': {
    params: { clientId: string; offerId: string; frequency: 'monthly' | 'quarterly'; startOn: string; end?: string; reminderDays?: number[]; taxInclusive?: boolean };
    result: { recurring: RecurringInvoiceView };
  };
  'venture.invoice.recurringList': { params: Record<string, never>; result: { items: RecurringInvoiceView[] } };
  'venture.invoice.remind': { params: { invoiceId: string }; result: { draft: OutreachView; receiptId?: string } };
  'venture.payment.clear': { params: { paymentId: string }; result: InvoiceViewLite };
  /** 4J5 (review): ends a bill's repeat; an expected bill of it that waits is cancelled. Answers the bills list. */
  'venture.bills.stop': { params: { billId: string }; result: { bills: BillView[]; owed?: MoneyFigure | null } };
  'venture.money.across': { params: Record<string, never>; result: AcrossMoneyView };
  'venture.runs.across': { params: Record<string, never>; result: AcrossRunsView };
  // 4J7 to 4J10 connection checks, file requests, ways to earn, the owner, signatures and the journal chain.
  // 4J21: { last: true } reads the newest check (null before any) with no new read.
  'venture.connectors.check': { params: { last?: true }; result: ConnectorChecksView | null };
  'venture.share.request': { params: { orderId: string; note?: string }; result: FileRequestView };
  /** Answered before any vault, like venture.countries. */
  'venture.playbooks.list': { params: Record<string, never>; result: WaysView };
  /** App only, with a business open: a suggested change to its plan's words, never applied here. */
  'venture.blueprint.suggest': { params: { text: string; attachment?: { name: string; text: string } }; result: PlanSuggestionView };
  'venture.owner.get': { params: Record<string, never>; result: OwnerView };
  /** firstName null takes the owner's name back. */
  'venture.owner.set': { params: { firstName?: string | null; excludedServices?: string[]; familyId?: string | null }; result: OwnerView };
  'venture.receipt.verify': { params: { id: string }; result: ReceiptVerifyView };
  'venture.journal.chain': { params: Record<string, never>; result: JournalChainView };
  'venture.journal.acceptBreak': { params: { digest: string }; result: JournalChainView };
  // 4J10 (H38): engine methods Ink does not call today, listed so every surface has every method (the parity test in
  // platform/tests/venture-method-hints.test.ts). Results Ink has no view type for are unknown until a screen needs them.
  'venture.blueprint.accept': { params: { digest: string }; result: BlueprintViewLite };
  'venture.models.calls': { params: { limit?: number; purpose?: string }; result: unknown[] };
  'venture.delivery.playbook': { params: Record<string, never>; result: unknown };
  'venture.simulation.get': { params: { runId: string }; result: SimulationRunLite };
  'venture.simulation.fromSignal': { params: { signalId: string }; result: ScenarioLite };
  'venture.launch.status': { params: Record<string, never>; result: LaunchStatusView };
  'venture.launch.advance': { params: { to: 'practice' | 'live' }; result: LaunchStatusView };
  'venture.delivery.review': { params: { runId: string; verdict: 'accepted' | 'edited' | 'rejected'; reason?: string; editedText?: string }; result: DeliveryLite };
  'venture.capabilities': { params: Record<string, never>; result: unknown[] };
  'venture.work.get': { params: { id: string }; result: WorkReceiptLite };
  'venture.improve.get': { params: { runId: string }; result: ImprovementRunLite };
  'venture.delegate.get': { params: { id: string }; result: unknown };
  'venture.ai.calls': { params: { limit?: number }; result: unknown[] };
  'venture.country.suggest': { params: { text: string }; result: { country: CountryLite | null; evidence: string | null; source: 'ai' | 'not-connected' } };
  // Wave 6 (6C1, 6C2): the tools' own sign-in and About you, before the vault; (6C7) what the business needs.
  'venture.ai.tools': { params: { cli?: ToolLite['cli'] | undefined }; result: ToolsLite };
  'venture.ai.login.start': { params: { cli: 'codex' | 'claude-code' }; result: ToolLite };
  'venture.ai.login.cancel': { params: { cli: 'codex' | 'claude-code' }; result: ToolLite };
  // A2: the owner's yes to the Codex found on this computer, with or without a business.
  'venture.ai.setup.trust': { params: { cli: 'codex'; sha256: string }; result: { setup: CodexSetupLite } };
  'venture.ai.claude.install': { params: Record<string, never>; result: { outcome: 'already-installed' | 'installed' | 'not-found-after'; path: string | null; installerUrl: string | null; installerSha256: string | null; words: string } };
  'venture.ai.claude.progress': { params: Record<string, never>; result: ClaudeInstallViewLite };
  // One-shot C4 (T20): a share the owner made, or their "Mark as sent", recorded on the invoice.
  'venture.invoice.shared': { params: { invoiceId: string; how: 'whatsapp' | 'email' | 'file' | 'marked' }; result: InvoiceViewLite };
  'venture.models.plan': { params: { fresh?: boolean }; result: PlanViewLite };
  'venture.routines.backup.get': { params: Record<string, never>; result: BackupViewLite };
  'venture.routines.backup.set': { params: { on: boolean; order: string[]; digests?: string[] }; result: BackupViewLite };
  'venture.trackers.list': { params: Record<string, never>; result: TrackersLite };
  'venture.trackers.get': { params: { id: string }; result: TrackerDetailLite };
  'venture.trackers.set': { params: { tracker: { id?: string; name: string; columns: TrackerColumnLite[]; boardBy?: string | null; keptBy?: string[] } }; result: { tracker: TrackerLite } };
  'venture.trackers.remove': { params: { id: string }; result: { removed: true } };
  'venture.trackers.rows.add': { params: { trackerId: string; cells: Record<string, unknown> }; result: { row: TrackerRowLite } };
  'venture.trackers.rows.edit': { params: { rowId: string; cells: Record<string, unknown> }; result: { row: TrackerRowLite } };
  'venture.trackers.rows.remove': { params: { rowId: string }; result: { removed: true } };
  'venture.trackers.rows.undo': { params: { rowId: string }; result: { undone: true } };
  'venture.agents.hire.start': { params: { sentence: string }; result: HireViewLite };
  'venture.agents.hire.answer': { params: { hireId: string; phase: string; edits?: Record<string, unknown> }; result: HireViewLite };
  'venture.agents.hire.confirm': { params: { hireId: string; digest: string }; result: HireViewLite };
  'venture.agents.hire.cancel': { params: { hireId: string }; result: { cancelled: true } };
  'venture.events.get': { params: Record<string, never>; result: EventsViewLite };
  'venture.events.relay.set': { params: { address: string | null }; result: EventsViewLite };
  'venture.events.calKey.set': { params: { key: string | null }; result: EventsViewLite };
  'venture.agents.hire.duties': { params: { agent: string; duties: string[] }; result: HireViewLite };
  'venture.about.read': { params: { text?: string; attachment?: { name: string; kind: 'resume-pdf' | 'linkedin-zip'; contentBase64: string } }; result: AboutReadLite };
  'venture.about.pick': { params: { familyId: string; text?: string }; result: AboutReadLite };
  'venture.about.families': { params: Record<string, never>; result: { families: FamilyTileLite[] } };
  'venture.needs.list': { params: Record<string, never>; result: NeedsListLite };
  'venture.compose.decide': { params: { text: string; countryCode: string }; result: unknown };
  'venture.compose.fill': { params: { composeId: string }; result: unknown };
  'venture.compose.get': { params: Record<string, never>; result: unknown };
  'venture.compose.update': { params: { composeId: string; patch: unknown }; result: unknown };
  // 4J12 to 4J18 contracts, routines, options, drills, guidance, voice, persona, knowledge, ideas, capabilities.
  'venture.order.contract': { params: { orderId: string }; result: OrderContractView | null };
  'venture.order.contract.propose': { params: { orderId: string; contract: OrderContract }; result: OrderContractView };
  'venture.order.contract.sign': { params: { orderId: string; digest: string }; result: OrderContractView };
  'venture.routines.list': { params: Record<string, never>; result: { routines: RoutineView[] } };
  /** C4 task 32: at most two ready routines the plan already names; nothing stored. */
  'venture.routines.suggestions': { params: Record<string, never>; result: { suggestions: RoutineSuggestion[] } };
  'venture.routines.runs': { params: { id: string }; result: { runs: { id: string; dueAt: string; state: RoutineRunState; line: Display; receipt?: ModelReceiptView; ranOn?: Display }[] } };
  'venture.routines.set': { params: { routine: RoutineInput }; result: { routine: RoutineView } };
  'venture.routines.remove': { params: { id: string }; result: { removed: true; line: Display } };
  'venture.options.rerank': { params: { questionId: string; weights: Record<string, number> }; result: { options: RankedOptionView[] } };
  'venture.drills.run': { params: Record<string, never>; result: { run: DrillRunView } };
  'venture.drills.list': { params: Record<string, never>; result: { runs: DrillRunView[] } };
  'venture.auto.readiness': { params: { agent: string }; result: AutoReadinessView };
  'venture.shadow.summary': { params: { agent: string }; result: ShadowSummaryView };
  'venture.playbook.guidance': { params: Record<string, never>; result: { lines: GuidanceLineView[]; fixTheRule?: FixTheRuleView[] } };
  'venture.voice.get': { params: Record<string, never>; result: VoiceView };
  'venture.voice.set': { params: { voice: VoiceInput }; result: VoiceView };
  'venture.voice.learn': { params: { samples: string[] }; result: VoiceView };
  'venture.persona.get': { params: { agent: string }; result: PersonaView };
  'venture.persona.set': { params: { agent: string; persona: PersonaFields }; result: PersonaView };
  'venture.persona.test': { params: { agent: string; persona: PersonaFields }; result: { results: { scenario: Display; reply: string }[]; cost: Display; line: Display } };
  'venture.agents.export': { params: { agent: string }; result: { fileName: string; text: string } };
  'venture.agents.import': { params: { text: string }; result: { proposal: AgentProposalView } };
  'venture.knowledge.list': { params: Record<string, never>; result: { sources: KnowledgeSourceView[]; requests: Display[]; line: Display } };
  'venture.knowledge.add': { params: { source: KnowledgeSourceInput }; result: { source: KnowledgeSourceView } };
  'venture.knowledge.remove': { params: { id: string }; result: { removed: true; line: Display } };
  'venture.knowledge.test': { params: { question: string }; result: { hits: { sourceId: string; title: string; line: Display }[]; line: Display } };
  'venture.ideas.list': { params: Record<string, never>; result: { ideas: IdeaView[]; waiting: { id: string; recordId: string; line: Display }[]; pipeline: PipelineIdeaView[] } };
  'venture.ideas.start': { params: { id: string }; result: { proposal: ProposalView | null; suggestion: AgentSuggestion | null; line: Display } };
  'venture.ideas.dismiss': { params: { id: string }; result: { dismissed: true; line: Display } };
  'venture.agents.capabilities': { params: { agent: string }; result: CapabilityPageView };
  // Ink v2 wave 5 (package 5-0; W5_METHODS in the engine, each answering NOT_BUILT_YET until its package lands)
  'venture.order.chain': { params: { orderId: string }; result: OrderChainView };
  'venture.salesProposal.draft': { params: ({ clientId: string; personId?: never } | { personId: string; clientId?: never }) & { offerId: string; pilot?: boolean | SalesPilotTerms }; result: SalesProposalView };
  'venture.salesProposal.get': { params: { id: string } | { clientId: string } | { personId: string }; result: SalesProposalView };
  'venture.goNoGo.card': { params: { playbook: string; subject: string; inputs: GoNoGoInputs }; result: GoNoGoCardView };
  'venture.goNoGo.list': { params: Record<string, never>; result: GoNoGoListView };
  'venture.goNoGo.remove': { params: { cardId: string }; result: { removed: true; line: Display } };
  'venture.ideas.add': { params: { text: string; source: string }; result: IdeaAddedView };
  'venture.ideas.move': { params: { id: string; stage: IdeaStage; reason?: string }; result: IdeaMovedView };
  'venture.ideas.grade': { params: { id: string; grade: IdeaGrade }; result: IdeaGradedView };
  'venture.brandKit.get': { params: { clientId: string }; result: BrandKitView };
  'venture.brandKit.set': { params: { clientId: string; kit: BrandKitInput }; result: BrandKitView };
  'venture.assets.list': { params: { orderId?: string; clientId?: string }; result: AssetsView };
  'venture.assets.rerun': { params: { id: string }; result: AssetRerunView };
  'venture.assets.reuse': { params: { id: string; orderId: string }; result: AssetReuseView };
  'venture.voiceConsent.record': { params: { speaker: string; recordingFileId: string; transcript: string; statement: string; scope: string; until: string | null }; result: VoiceConsentView };
  'venture.voiceConsent.revoke': { params: { id: string }; result: VoiceConsentView };
  'venture.voiceConsent.list': { params: Record<string, never>; result: VoiceConsentsView };
  'venture.report.render': { params: { runId: string; formats?: ReportFormat[] }; result: ReportView };
  'venture.report.share': { params: { reportId: string; from: string; to: string; channels?: string[] }; result: ReportShareView };
  'venture.report.shareRotate': { params: { shareId: string }; result: ReportShareView };
  'venture.report.shareDisable': { params: { shareId: string }; result: ReportShareView };
  'venture.report.list': { params: { orderId?: string; runId?: string }; result: ReportListView };
  'venture.monitors.list': { params: Record<string, never>; result: MonitorsView };
  'venture.monitors.add': { params: MonitorInput; result: MonitorView };
  'venture.monitors.remove': { params: { id: string }; result: MonitorView };
  'venture.mail.import': { params: { name: string; contentBase64: string }; result: MailImportView };
  'venture.mail.threads': { params: { clientId?: string }; result: MailThreadsView };
  'venture.localApps.list': { params: Record<string, never>; result: LocalAppsView };
  'venture.webhook.set': { params: { kind: 'n8n' | 'make'; url: string | null; secret?: string; test?: boolean }; result: WebhookView };
  'venture.webhook.send': { params: { kind: 'n8n' | 'make'; subject: string; payload: unknown; digest?: string }; result: WebhookSendView };
  'venture.speechOut.providers': { params: Record<string, never>; result: SpeechProvidersView };
  'venture.ca.confirmCitations': { params: { version: number; membershipNo: string }; result: CitationsConfirmView };
  'venture.ca.signoff.get': { params: { id: string }; result: SignoffCheckView };
  'venture.ca.differential.add': { params: { name: string; inputs: unknown; outputs: unknown; capturedBy: string }; result: DifferentialAddView };
  'venture.ca.dataPack.export': { params: {packId:string;digest:string;fields:string[];unmask:string[];requestedBy:string;purpose:string;approvalDigest:string}; result: DataPackExportView };
  'venture.desk.list': { params: { playbook: DeskPlaybook; kind: string; filter?: unknown }; result: DeskListView };
  'venture.desk.get': { params: { playbook: DeskPlaybook; kind: string; id: string }; result: DeskItemView };
  'venture.desk.act': { params: { playbook: DeskPlaybook; kind: string; id: string; action: string; payload: unknown; digest?: string }; result: DeskActView };
}
export type MethodName = keyof EngineMethods;
export type ParamsOf<M extends MethodName> = EngineMethods[M]['params'];
export type ResultOf<M extends MethodName> = EngineMethods[M]['result'];

/** An engine refusal, with the engine's code and plain-words message. */
export class EngineError extends Error {
  readonly code: string;
  readonly reason?: string;
  /** B1 fix round 1: the words are written for the owner and are shown exactly as they are (engine/owner-errors.ts). */
  readonly owner?: true;
  constructor(code: string, message: string, reason?: string, owner?: boolean) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    if (reason !== undefined) this.reason = reason;
    if (owner === true) this.owner = true;
  }
}

/** What the status line shows. `ok` shows nothing. */
export type { UpdatesView } from '../../../../platform/runtime/update-service-core';
export type { DiagnosticsTodayView } from '../../../../platform/runtime/venture/views/diagnostics-core';
/** C5 task 27: the files and crash files going in, how many crash files are here, how many didn't fit, and the exact text. */
export type DiagnosticsPreview = { id: string; files: { name: string; bytes: number }[]; dumps: { name: string; bytes: number }[]; dumpsThere: number; leftOut: number; text: string; bytes: number };

export type EngineStatus =
  | { state: 'ok' }
  /** D4 task 5: how far the desktop's start has come; the line changes only when a real phase arrives. */
  | { state: 'starting'; phase?: 'window-shown' | 'engine-forked' | 'loaded' }
  | { state: 'reconnecting' }
  | { state: 'offline' }
  | { state: 'unpaired' }
  | { state: 'session-ended' }
  | { state: 'error'; message: string };

import type { DiagnosticsTodayView } from '../../../../platform/runtime/venture/views/diagnostics-core';
import type { UpdatesView } from '../../../../platform/runtime/update-service-core';

export type Transport = 'desktop' | 'web' | 'hosted' | 'fake';

/** C5 task 16: what the desktop opened for Send to my CA. */
export interface PackShareResult { how: 'email' | 'whatsapp'; opened: 'draft' | 'none' | 'app' | 'web'; file: string; to: string }
export interface EngineClient {
  readonly transport: Transport;
  request<M extends MethodName>(method: M, params?: ParamsOf<M>): Promise<ResultOf<M>>;
  /** Run and queue events. Falls back to polling `venture.events` every 5 s when pushes are not available. */
  subscribe(listener: (event: VentureRunEvent) => void): () => void;
  status(): EngineStatus;
  onStatus(listener: (status: EngineStatus) => void): () => void;
  /**
   * Desktop only (4D1, read by 4D4's import sheet): the owner picks one of their own network files and a desktop worker
   * reads it on this computer; `text` (only what Chausar keeps) goes to venture.network.import. ownerAddresses: the
   * addresses the owner sends from, needed for mail. Null when the owner cancelled. Absent on the web and the fake,
   * where the page reads the file itself.
   */
  /** Desktop only: the owner chooses a transcription path; nothing runs until separately saved. */
  pickTranscriptionFile?(kind: 'command' | 'model'): Promise<string | null>;
  pickNetworkFile?(kind: NetworkImportKind, options?: { ownerAddresses?: string[] }): Promise<PickedNetworkFile | null>;
  /**
   * Desktop only (4J4, read by 4J20's Export for your CA): the desktop asks the engine for one month's CSV
   * (venture.money.export) and saves it where the owner picks; the system dialog asks before it replaces a file. Null
   * when the owner cancelled; refusals (EXPORT_EXISTS, EXPORT_NOT_SAVED) as engine errors. Absent on the web, the
   * hosted app and the fake, where the page downloads the engine's CSV itself.
   */
  saveMoneyExport?(month: string, format?: MoneyExportFormat): Promise<MoneyExportSaved | null>;
  /** C5 task 35: the desktop saves the brief where the owner picks; null when cancelled. */
  saveBriefFile?(builder: FileBuilderId): Promise<{ saved: true; name: string; companion: string } | null>;
  /** C5 task 32, desktop only: shows the downloaded installer, checked again first. UPDATE_NOT_VERIFIED when it changed. */
  showUpdateInstaller?(kind: 'staged'): Promise<void>;
  /** D12 task 10: the kept release the desktop can go back to, checked now, and going back, which main asks about itself. */
  goBackOffer?(): Promise<{ version: string } | null>;
  goBack?(): Promise<{ state: string }>;
  /** C5 task 27, desktop only: what Export diagnostics would save, read first; then that preview saved, by its id. Null when cancelled. */
  previewDiagnostics?(dumps: boolean): Promise<DiagnosticsPreview>;
  saveDiagnostics?(id: string): Promise<{ saved: true; name: string; line: string } | null>;
  /** C5 task 21, desktop only: main shows the file dialog; the window gets a token and the file's name. Null when cancelled. */
  pickCopy?(): Promise<{ token: string; name: string } | null>;
  importCopy?(input: CopyImportInput): Promise<CopyImportResult>;
  /** C5 task 23, desktop only: main shows the folder dialog, or clears the setting. Null when cancelled. */
  setBackupFolder?(action: 'pick' | 'clear'): Promise<{ copy: BackupCopyLite | null } | null>;
  /**
   * Desktop only (review of A1, row 1): shows one export Delete kept in the file manager, by its file name (the desktop
   * shows only a file of Chausar's exports folder). EXPORT_NOT_FOUND when it is gone. Absent on the web and the fake.
   */
  showExport?(name: string): Promise<void>;
  /**
   * Desktop only (one-shot C4 task 36): saves a copy of the whole business where the owner picks in the desktop's own
   * save dialog (Documents first, named with the business and the day). The window gets the file's name and an id for
   * Show in folder, never the path. Null when the owner cancelled (nothing written). Absent on the web and the fake.
   */
  saveBusinessExport?(plaintext: boolean): Promise<{ name: string; encrypted: boolean; id: string } | null>;
  showSavedExport?(id: string): Promise<void>;
  /**
   * Desktop only (one-shot A6): Email it or Share on WhatsApp on an issued invoice. The desktop asks the engine for the
   * file (venture.invoice.pdf), keeps it in Chausar's share folder and opens the owner's own app; it answers what opened.
   * Nothing is sent. Absent on the web, the hosted app and the fake, where the sheet opens the engine's share links.
   */
  /** C5 task 16: Send to my CA: a draft or WhatsApp with the month's file; desktop only. */
  sharePack?(month: string, how: 'email' | 'whatsapp'): Promise<PackShareResult>;
  shareInvoice?(invoiceId: string, how: 'email' | 'whatsapp'): Promise<InvoiceShareResult>;
  /**
   * Desktop only (one-shot C6): a payment's thank-you receipt. The desktop asks the engine for it (venture.payment.receipt),
   * keeps the file in Chausar's share folder and, for whatsapp, opens the owner's WhatsApp with the words. Nothing is sent.
   */
  shareReceipt?(paymentId: string, how: 'whatsapp' | 'save'): Promise<ReceiptShareResult>;
  /** Desktop only (A6): shows the invoice file the desktop kept for sharing in the file manager. SHARE_FILE_GONE when it is gone. */
  showShared?(name: string): Promise<void>;
  /**
   * Desktop only (one-shot A5): start at login and keep running, as the desktop's background.cjs answers: the saved
   * answer, whether it was asked, and the login item read back from this computer. Absent on the web, the hosted app
   * and the fake (tests spread fake-background.ts onto it). A preview answers supported false and refuses a change.
   */
  getBackground?(): Promise<BackgroundStateLite>;
  setBackground?(update: { startAtLogin?: boolean; keepRunning?: boolean }): Promise<BackgroundStateLite>;
  /**
   * Desktop only (A5 fix round 3): the local day (YYYY-MM-DD) the owner put Today's start-at-login question aside with
   * Not now, kept by the desktop beside the answer; null when never. Keeping it changes nothing else.
   */
  getAskLater?(): Promise<string | null>;
  setAskLater?(day: string): Promise<void>;
  /**
   * Desktop only (5A5): the desktop makes a draft's client report (venture.report.render, the PDF included) and saves
   * every file and manifest.json in a new folder where the owner picks, atomically. Null when cancelled; EXPORT_EXISTS
   * when that folder is there already. Absent on the web, the hosted app and the fake, where the page downloads files.
   */
  saveReport?(runId: string): Promise<{ saved: true; folder: string; line: string } | null>;
  /** Desktop 5B2: save only approved outputs; open only an opaque handle from this session. */
  saveYoutubeProject?(editId: string, digest: string): Promise<{ saved: true; savedId: string; folder: string; line: string } | null>;
  openYoutubeProject?(savedId: string): Promise<{ opened: true }>;
  /** Desktop-only native picker, import and source inspection. No page-supplied path and no installation. */
  pickAppTestApk?(orderId: string, fromClient: true, digest?: string): Promise<{ imported: true; orderId: string } | null>;
  saveSocialProject?(orderId: string, digest: string): Promise<{ saved: true; savedId: string; folder: string; line: string } | null>;
  openSocialProject?(savedId: string): Promise<{ opened: true }>;
  /**
   * Hosted only (W4 4J21, from 4J23): what the hosted server says about the signed-in person, read with the session
   * (GET /api/hosted/session's `me`): whether this server lets people start without an account, and the temporary
   * business's line, end and last-day warning. Read again on each call. Null when the server sent none. Absent on the
   * desktop and the local web.
   */
  hostedMe?(): Promise<HostedMeLite | null>;
}

/** The hosted session's `me` (platform/runtime/hosted/app.ts me()), only what the Ink app reads (4J21). */
export interface HostedMeLite { trials: boolean; trial: HostedTrialView | null }

/** What the desktop's network file pick hands back (app/desktop/network-files.cjs). */
export interface PickedNetworkFile { kind: string; name: string; text: string; rows: number; people: number; dropped: [string, number][]; line: string }

/** The renderer cannot acquire an undeclared engine method. */
type SameMethods<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type AssertMethods<T extends true> = T;
export type RendererContractMatches = AssertMethods<SameMethods<keyof EngineMethods, RendererMethod>>;
