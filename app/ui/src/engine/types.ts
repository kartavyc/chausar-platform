/**
 * The engine contract the UI builds to. The first block is the shared contract from
 * docs/superpowers/plans/2026-10-21-chausar-frontend-ink.md ("Shared contract"), verbatim; the engine side lives in
 * platform/runtime/venture/contracts.ts. The UI does not import runtime files: those pull in Node code.
 * The second block mirrors the few existing engine shapes the shell and the fake engine need, trimmed to the
 * fields the UI reads.
 */

// ---------------------------------------------------------------------------------------------------------------
// Shared contract (verbatim)
// ---------------------------------------------------------------------------------------------------------------

export type Display = string; // engine-formatted text; the UI never computes it
export type QueueActionId = 'approve' | 'deny' | 'later' | 'watch' | 'read' | 'answer' | 'send-to-ca' | 'open' | 'connect' | 'set-prices' | 'keep' | 'issue' | 'run-again';
export interface QueueAction { id: QueueActionId; label: string; primary: boolean; secondAsk?: boolean; requiresView?: boolean }
export interface QueueChange { label?: string; before?: Display; after: Display; receiptId?: string; estimate?: boolean }
export type QueueKind = 'draft' | 'price' | 'quote' | 'plan' | 'invoice' | 'signoff' | 'question' | 'setup' | 'locked' | 'connector' | 'bank';
export interface QueueRow {
  id: string; businessId: string; businessName: string; agent?: string; kind: QueueKind;
  title: string; line?: string; change?: QueueChange; digest: string; createdAt: string;
  actions: QueueAction[]; // one or two; exactly one primary
  viewRef?: { kind: 'draft' | 'file' | 'run' | 'plan'; id: string };
  /** Only on rows that propose an outside action (W1 H21): false when part of what it will send is not shown. */
  descriptionComplete?: boolean;
}
export interface QueueList { rows: QueueRow[]; summary: Display; needsYou: number; businesses: number }
export interface QueueDecision { outcome: 'done' | 'stale' | 'refused'; line: Display; receiptId?: string; latest?: QueueRow; reason?: string }
export type RunState = 'active' | 'waiting' | 'done' | 'failed';
export interface RunStep {
  id: string; purpose: string; state: 'done' | 'current' | 'pending' | 'waiting' | 'failed'; elapsed?: Display;
  tools?: { name: string; line: string }[]; evidence?: { kind: string; id: string; label: string }[]; error?: string; audited?: boolean;
}
export interface RunSummary {
  runId: string; businessId: string; agent: string; purpose: string; state: RunState; startedAt: string; elapsed: Display;
  progress?: { done: number; total: number } | 'indeterminate'; result?: Display; receiptId?: string; estimate?: boolean;
}
/** screen: one engine line saying what the untrusted screen noted in the run's outside content, never the words. */
export interface RunDetail extends RunSummary { steps: RunStep[]; question?: { id: string; text: string; choices?: string[] }; error?: string; screen?: Display }
export type Posture = 'rehearsal' | 'shadow' | 'approve-each' | 'auto-spot-check';
export interface AgentView {
  id: string; name: string; role: string; now: Display; posture: Posture; spend: Display;
  last?: { line: Display; receiptId?: string; estimate?: boolean };
  steps: { id: string; purpose: string; gate: 'auto' | 'hold'; floor: boolean }[];
}
export type VentureRunEventType = 'run.started' | 'run.step' | 'run.waiting' | 'run.done' | 'run.failed' | 'queue.changed';
export interface VentureRunEvent { type: VentureRunEventType; businessId: string; runId?: string; at: string }
// phase 2 views
/**
 * `reason`: the engine's words for why a call was refused (no price, over the monthly limit, waiting for approval).
 * `reservedRupees`, `settledRupees`: the same figures in rupees at the owner's own rate, with that rate; absent without one.
 */
export interface SpendRow {
  id: string; agent?: string; connector?: string; label: string; reserved: Display; settled?: Display; kind: 'estimate' | 'billed' | 'refused'; receiptId?: string; reason?: Display;
  reservedRupees?: Display; settledRupees?: Display;
}
/**
 * venture.spend.policy.get/set. The Usd fields are figures in US dollars as the owner types them ('20.00', '0.000075');
 * the form shows those and sends what the owner typed, and the engine converts. The UI shows the Display fields.
 */
export type SpendRateUnit = 'per-million-tokens' | 'per-call' | 'per-run-cap';
export interface SpendRateLine {
  item: string; unit: SpendRateUnit; inputMicrosPerMillion: string | null; outputMicrosPerMillion: string | null; microsPerCall: string | null;
  inputUsdPerMillion: string | null; outputUsdPerMillion: string | null; usdPerCall: string | null;
  source: string; checkedOn: string; confirmed: boolean; by: 'list' | 'owner'; price: Display;
}
export interface SpendRateInput {
  item: string; unit: SpendRateUnit; inputUsdPerMillion?: string | null; outputUsdPerMillion?: string | null; usdPerCall?: string | null; source: string; checkedOn: string;
}
/**
 * `inrPerUsd`: the owner's own rupee rate as typed back ('83.50'); `rupeeRate`: that rate in words with the day it was
 * set; `capRupees`, `askFirstRupees`: the limits in rupees at that rate. All null or absent without a rate.
 */
export interface SpendPolicyView {
  capMicros: string | null; askFirstMicros: string | null; capUsd: string | null; askFirstUsd: string | null;
  cap: Display; askFirst: Display; rates: SpendRateLine[]; setAt: string | null;
  inrPerUsd: string | null; rupeeRate: Display | null; capRupees?: Display; askFirstRupees?: Display;
}
export interface JournalEntry { id: string; action: string; target: string; state: 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown'; at: string; line: Display; receiptId?: string }
/** `dismissed`: the owner said no to this suggestion (venture.evidence.dismiss); it stays in the ledger, off the screen. */
export interface EvidenceItem { id: string; subject: string; field: string; value: Display; type: string; strength: 'verified' | 'strong' | 'weak'; claim: 'observed' | 'inferred' | 'needs-your-data'; source: string; applied: boolean; dismissed?: boolean }

// ---------------------------------------------------------------------------------------------------------------
// Ink final pass: the views and actions the engine added for the last screens (engine-final, 21 Oct). Every figure is
// engine text (Display); amounts the owner types go to the engine as typed strings and come back formatted.
// ---------------------------------------------------------------------------------------------------------------

/** `venture.money.overview`: Money at a glance, three lines the engine adds up (owed, received, spent). */
/** `rupees`: the AI spend line in rupees at the owner's own rate, with that rate; absent without one. */
export interface MoneyOverviewLine { id: 'owed' | 'received' | 'spent'; label: Display; value: Display; receiptId?: string; estimate?: boolean; rupees?: Display }
export interface MoneyOverview { lines: MoneyOverviewLine[] }

/** `venture.tax.working`: the tax working for a period, worked by the calculator, each figure with its receipt. */
export interface TaxWorkingLine { label: Display; value: Display; receiptId?: string }
export interface TaxWorkingSection { id: string; title: Display; lines: TaxWorkingLine[]; note?: Display }
export interface TaxWorking { period: Display; sections: TaxWorkingSection[]; needsCaConfirmation: boolean }

/** `venture.ca.get` (the CA firm playbook): the CA of record, rate tables waiting for the CA, and sign-off requests. */
export interface CaOfRecord { name: string; membershipNo: string }
export interface CaPendingRate { tableId: string; title: Display; version: string; validFrom: string; validTo: string | null; citations: string[] }
export interface CaSignoffRequest { id: string; deliveryId: string; title: Display; state: 'sent' | 'signed' | 'returned'; at: string }
/** The newest regulated draft with the calculator's receipts (Ink v2 2A2); Your CA works each receipt again. */
export interface CaLatestPapers { deliveryId: string; title: Display; receiptIds: string[] }
export interface CaView { ca: CaOfRecord | null; pendingRates: CaPendingRate[]; requests: CaSignoffRequest[]; latestPapers?: CaLatestPapers | null }

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
export type SiteEditState = 'staged' | 'applying' | 'applied' | 'rolled-back' | 'rejected' | 'needs-inspection';
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
export interface ShareLink { id: string; url: string | null; reason?: Display; expiresAt: string; answer?: ShareAnswer; revoked?: true }

// ---------------------------------------------------------------------------------------------------------------
// Mirrors of existing engine shapes (trimmed). Source: platform/runtime/workspace-custody-contracts.ts and
// platform/runtime/venture/contracts.ts.
// ---------------------------------------------------------------------------------------------------------------

export type ServiceType = 'agency' | 'studio' | 'consulting' | 'bookkeeping' | 'research' | 'content' | 'support' | 'other';
export const SERVICE_TYPES: readonly ServiceType[] = ['agency', 'studio', 'consulting', 'bookkeeping', 'research', 'content', 'support', 'other'];

export interface BusinessOnComputer {
  folder: string; name: string | null; demo: boolean | null; unlock: 'this-computer' | 'passphrase';
  opens: 'with-this-computer' | 'needs-passphrase' | 'key-missing';
  recovery: 'made' | 'not-made' | 'unknown'; openedAt: string | null; listedFrom: 'card' | 'folder';
}
export interface BusinessList { businesses: BusinessOnComputer[]; complete: boolean }

/** `venture.get` (VentureView), only the fields the shell reads. */
export interface VentureViewLite {
  venture: { id: string; workingName: string; serviceType: ServiceType | null };
  done: number; total: number;
  /** The flagship playbook the idea picks, for example { id: 'youtube', label: 'YouTube channel' }; absent when the plain service type serves. */
  playbook?: PlaybookPick;
}
/** `PlaybookPick` in platform/runtime/venture/contracts.ts: worked out from the idea by the engine, never stored. */
export interface PlaybookPick { id: string; label: string }

/** `venture.events` record, trimmed. */
export interface VentureEventRecordLite { id: string; seq: number; name: string; at: string; data: unknown }
export interface VentureEventsResult { events: VentureEventRecordLite[]; lastSeq: number }

/** `venture.receipt.get` (PriceReceiptRecord), only what a receipt sheet shows. Figures arrive formatted. */
export interface PriceFigureLite { key: string; label: string; display: Display }
export interface ReceiptLite { id: string; at: string; figures: PriceFigureLite[]; explanation: string; stale: boolean }

/** `venture.books.summary` (BooksSummary), trimmed. */
export interface BooksFigureLite { operation: 'billed' | 'received' | 'earned'; label: string; receiptId: string; display: Display; stale: boolean }
export interface BooksSummaryLite {
  currency: string; period: { from: string; to: string };
  figures: BooksFigureLite[];
  openInvoices: { invoiceId: string; number: string; clientName: string; balanceDisplay: Display; dueDate: string }[];
  notes: string[];
  /** The engine always sends these three; optional only so older samples still type. */
  periodKey?: BooksPeriodKey | 'custom';
  periods?: { key: BooksPeriodKey; label: string; from: string; to: string }[];
  today?: string;
}
export type BooksPeriodKey = 'all' | 'this-month' | 'last-month' | 'this-year';

/**
 * `venture.connectors.list` (ConnectorCard). Posting is spec section 7.9 (P2-connectors): `postingOptions` holds every
 * posting mode in the order api, owner-browser-session, handoff, each with its status, risk, requirements and the reason
 * a planned one is planned; `posting` is the first available one, else the owner-browser-session one. Both are absent or
 * empty for a connector that does not post. The UI shows them as the engine says, word for word.
 */
export type ConnectorModeName = 'handoff' | 'read' | 'write';
export type PostingMode = 'api' | 'owner-browser-session' | 'handoff';
export type Qualification = 'built-in' | 'fixture-tested' | 'unqualified';
export interface PostingOptionLite {
  mode: PostingMode; status: 'available' | 'planned'; qualification: Qualification; what: string;
  risk: string | null; requires: string[]; reason: string | null;
  /** The browser mode of LinkedIn and X: the oldest day across the posting steps one of each step's candidates last worked, or null (2B2). */
  stepsCheckedOn?: string | null;
  /** The same mode: the oldest day the post box and the post button last worked, the steps a check can see (2B2). */
  boxAndButtonCheckedOn?: string | null;
}
export interface ConnectorCardLite {
  id: string; name: string; category: string; categoryLabel: string;
  modes: { mode: ConnectorModeName; status: 'available' | 'planned'; qualification: Qualification; what: string }[];
  chips: string[]; regions: ('global' | 'india')[]; regionNote: string | null; auth: string;
  note: string; vendorUrl: string | null; starter: boolean;
  posting?: PostingOptionLite;
  postingOptions: PostingOptionLite[];
}

/**
 * `venture.models.*` and the draft desk's `venture.ai.*` (ModelPreset, ModelStatusView, AiOptionsView), trimmed. A key is
 * sent once in `connect` and never comes back: the status says only whether one is loaded.
 */
export type ModelTier = 'fast' | 'main';
export type ModelAvailability = 'ready' | 'unverified' | 'needs-setup' | 'unavailable';
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
}
export interface ModelConnectParams { presetId: string; consentDigest: string; apiKey?: string; model?: string; tiers?: ModelTier[]; monthlyCapUsd?: string }
export interface AiOptionsLite { presets: ModelPresetLite[]; status: ModelStatusLite; unchecked: boolean }

/** `venture.blueprint.get` and `.update` (BlueprintView), trimmed. Prices arrive only as receipts. */
export type LineLabel = 'told-by-you' | 'assumption' | 'computed';
export interface LabelledLite<T> { value: T; label: LineLabel; by: 'owner' | 'model' | 'template' | 'engine'; estimate?: true }
export type PricingModel = 'monthly' | 'project' | 'hourly';
export interface OfferLite {
  id: string; name: LabelledLite<string>; description: LabelledLite<string>;
  /** The flagship playbook offer this is, for example 'licensed-clips'; absent on other plans. It decides the rights asked at intake. */
  playbookOffer?: string;
  /** unitPriceMinor is engine data the UI only tests for null ("Set your price"); it never formats it. */
  pricing: { model: PricingModel; quantityUnit: 'month' | 'project' | 'hour'; unitPriceMinor: string | null; unitPriceLabel: 'told-by-you' | 'not-set'; defaultQuantity: string };
}
export interface BlueprintStepLite { id: string; title: LabelledLite<string>; doneBy: 'agent' | 'you' | 'agent-then-you'; capability: 'drafts-now' | 'planned' | 'yours'; note: string }
/**
 * `PlanFlagshipStep`: one step a flagship playbook delivers with, and who does it. who is the agent's role ('Packager'),
 * the code's name ('Calculator'), or another person ('CA of record'). The plan lists these in place of deliverySteps.
 */
export interface FlagshipStepLite { id: string; title: LabelledLite<string>; doneBy: 'you' | 'agent' | 'code' | 'person'; who: string }
export interface BlueprintLite {
  id: string; at: string; version: number; status: 'draft' | 'accepted'; source: 'model' | 'template'; digest: string; serviceType: ServiceType;
  name: LabelledLite<string>; oneLiner: LabelledLite<string>; customer: LabelledLite<string>;
  offers: OfferLite[]; deliverySteps: BlueprintStepLite[]; approvals: LabelledLite<string>[];
  backOffice: {
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
export interface OfferIntakeLite { rights: RightsBasisLite[]; fields: ('format' | 'aiVoice' | 'aiPresenter' | 'paidPromotion' | 'cutFile' | 'calendar' | 'clientRules')[] }
/** `OrderIntake.calendar`: weekdays are ISO numbers, 1 Monday to 7 Sunday. The engine plans the dated slots from it. */
export interface CalendarIntakeLite { month: string; channels: string[]; postsPerChannel: number; weekdays: number[] }
/** `OrderIntake.clientRules`: the client's own word lists; a missing list is empty. */
export interface ClientRulesLite { bannedWords?: string[]; bannedTopics?: string[]; competitors?: string[]; protectedPhrases?: string[] }
/** intake: by offer id, worked out by the engine; absent when no offer asks anything at intake. */
export interface BlueprintViewLite { blueprint: BlueprintLite; offerReceipts: Record<string, ReceiptLite | null>; playbook?: PlaybookPick; intake?: Record<string, OfferIntakeLite> }
export interface BlueprintPatchLite {
  name?: string; oneLiner?: string; customer?: string;
  offers?: { id: string; name?: string; description?: string; unitPrice?: string | null; pricingModel?: PricingModel }[];
}

/** `venture.build.*` (BriefRecord, HandoffPlan, HandoffRecord, BuildFollowRecord, BuildStatus), trimmed. */
export type BuilderId = 'lovable' | 'replit' | 'bolt' | 'v0';
export interface BriefLite {
  id: string; at: string; briefId: string; version: number; markdown: string; chars: number; wordsBy: 'model' | 'template';
  lint: { ok: boolean; findings: { rule: string; line: number | null; message: string }[] }; estimate?: true;
}
export interface HandoffPlanLite {
  handoffId: string; builder: BuilderId; mode: 'link' | 'copy'; url: string; clipboardText: string | null;
  notes: string[]; label: 'handoff'; status: 'available' | 'planned';
}
export interface HandoffLite { id: string; at: string; builder: BuilderId; mode: 'link' | 'copy'; openedAt: string | null }
export type BuildStatusWord = 'waiting-for-repo' | 'repo-connected' | 'builder-making-changes' | 'quiet' | 'sync-conflict' | 'repo-not-readable';
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
export interface BuildStatusView { follow: BuildFollowLite | null; brief: BriefLite | null; handoffs: HandoffLite[]; tokenLink: string }

/**
 * `workspace.custody.*` and `workspace.backups.*` (platform/runtime/workspace-custody-contracts.ts), trimmed. A recovery
 * code arrives once, in the reply that made it; the UI shows it once and keeps no copy.
 */
export type UnlockMode = 'this-computer' | 'passphrase';
export interface CustodyViewLite {
  computer: { available: boolean; scheme: string | null; reason: string | null; checked: boolean; where: string; loss: string | null };
  business: {
    folder: string; unlock: UnlockMode; recovery: 'made' | 'not-made' | 'unknown'; storage: 'experimental-file' | 'postgres';
    backups: { auto: boolean; count: number; newestAt: string | null; nextDueAt: string | null; lastError: string | null };
  } | null;
}
export interface BackupLite { file: string; kind: 'auto' | 'manual' | 'safety'; at: string; revision: number; bytes: number; name: string | null; opensNow: boolean }
/** The vault's own record of a business, as workspace.open, .recover, .restore and the moves return it (trimmed). */
export interface WorkspaceLite { id?: string; name: string }
/**
 * `workspace.transfer.export`: the move file's text and its one-time code. Both arrive once; the UI saves the text only
 * when the owner asks and keeps neither after the screen that showed them.
 */
export interface MoveFile { fileName: string; text: string; transferCode: string; bytes: number }
/** `workspace.delete`: what the engine removed, and its words for the copies it cannot reach. */
export interface Deleted { deleted: true; copiesRemoved?: unknown; externalCopies: string }

/**
 * `venture.client.list` and `venture.client.add` (ClientRecord), trimmed. Client details are client data. `owed` is
 * what the client owes on open invoices, formatted by the engine, with the receipt behind it. Without it the row shows
 * nothing owed; the UI never adds up invoices itself.
 */
export interface ClientLite {
  id: string; at: string; name: string; email: string | null; countryCode: string | null; taxId: string | null; stateCode: string | null; note: string | null;
  owed?: { display: Display; receiptId: string };
}
export interface ClientAddParams { name: string; email?: string; countryCode?: string; taxId?: string; stateCode?: string; note?: string }
/** `venture.order.list` (OrderRecord), trimmed. `request` is what the client asked for, typed by the owner. */
export type OrderStatus = 'open' | 'invoiced' | 'delivered' | 'cancelled';
export interface OrderLite {
  id: string; at: string; clientId: string; offerId: string; quantity: string; request: string; status: OrderStatus;
  priceReceiptId: string; deliveredOn: string | null;
  /** OrderRecord.intake, trimmed (a flagship offer's intake). cutFile: the finished cut on this computer, desktop only. */
  intake?: { format?: 'long' | 'short'; cutFile?: string | null };
}
/** `venture.files.list` (UploadView), trimmed: a file a client sent, kept in the vault. */
export interface UploadLite {
  /** transcript: an SRT or VTT file of what was said, with timings. */
  id: string; at: string; name: string; format: 'csv' | 'xlsx' | 'pdf' | 'transcript'; bytes: number;
  scope: { kind: 'order'; orderId: string } | { kind: 'practice'; scenarioId: string }; clientData: boolean;
  /** Where it came from: absent or 'client', or a transcript made on this computer from the cut (venture.files.transcribe). */
  origin?: 'client' | 'local-transcription';
}
/** `venture.delivery.list` (DeliveryRunView), trimmed to what a client's sheet shows. */
export type DeliveryStatus = 'waiting-for-you' | 'needs-answer' | 'brief-waiting' | 'ready-for-review' | 'accepted' | 'edited' | 'rejected' | 'failed';
export interface DeliveryLite {
  id: string; at: string; orderId: string; status: DeliveryStatus; practice: boolean;
  deliverable: { title: string } | null; verdict: { choice: 'accepted' | 'edited' | 'rejected'; at: string } | null;
  /** DeliveryRunView: the run waits on the owner (it is on Today). The engine always sends it. */
  awaitingYou?: boolean;
  /**
   * Ink v2 wave 2 (2C2), from DeliveryRunView: the code checks and the judge's verdict ('rules-judge') in the engine's
   * words, a flagship playbook's own checks, whether the engine would take Accept now and why not, and the judge's
   * call on this draft. The engine always sends them; samples and older tests may leave them out.
   * servedBy 'template': an outline no AI wrote (the judge never reads one). practiceNow: a practice draft at today's
   * launch stage, which `practice` alone does not say (a model draft before approve each is practice too).
   */
  servedBy?: 'model' | 'template';
  practiceNow?: boolean;
  checks?: CheckLite[];
  playbookChecks?: PlaybookCheckLite[];
  canAccept?: boolean;
  acceptBlocked?: Display | null;
  judge?: DeliveryJudgeLite;
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
  preview: { digest: string; estimatedMaxCostDisplay: Display; expiresAt: string } | null;
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
}
/**
 * `venture.invoice.get`, `.prepare`, `.issue` and `venture.payment.record` (InvoiceView), trimmed. Amounts reach the UI
 * only as engine-formatted `figures`; the minor-unit fields of the engine records are left out on purpose, so no screen
 * can add them up. The price receipt covers subtotal, tax and total; each payment's books receipt covers that payment.
 */
export type PaymentMethod = 'bank-transfer' | 'upi' | 'card' | 'cash' | 'payment-link' | 'other';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['bank-transfer', 'upi', 'card', 'cash', 'payment-link', 'other'];
export interface PaymentLite { id: string; at: string; invoiceId: string; receivedOn: string; method: PaymentMethod; booksReceiptId: string | null; booksNote: string | null }
export interface InvoiceViewLite {
  invoice: InvoiceLite & {
    currency: string; dueInDays: number; digest: string; documentTitle: string;
    priceReceiptId: string; booksReceiptId: string | null; booksNote: string | null;
  };
  client: { id: string; name: string };
  receipt: { id: string; stale: boolean };
  payments: PaymentLite[];
  documentText: string;
  figures: PriceFigureLite[];
  notes: string[];
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
/** `workspace.status`. `hosted` comes only from the hosted web server: the account's businesses. */
export interface WorkspaceStatusLite {
  open: boolean; workspace?: { name: string } | undefined; unlock?: string | undefined; closedByOwner?: boolean | undefined;
  experimental?: boolean | undefined; hosted?: { businesses: { id: string; name: string }[] } | undefined;
}
/** `workspace.create`. On this computer `folder: null` lets the engine pick the folder; hosted takes no folder. */
export interface WorkspaceCreateParams { name: string; pack: 'services'; folder?: null; passphrase?: string }
/** `recoveryCode` is not null only with a passphrase or on hosted, and the engine sends it this once. */
export interface WorkspaceCreated { workspace: { name: string }; folder?: string; unlock?: 'this-computer' | 'passphrase'; recoveryCode: string | null; recoveryKit?: string | null; experimental?: boolean }
/** assumed: only { yes: false, assumed: true } on q_tax, when the owner left tax unanswered (the engine keeps it as an assumption). */
export type InterviewAnswer = { choiceId?: string; text?: string; amount?: string; yes?: boolean; rate?: string; skipped?: true; assumed?: true };
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
export interface QueueItemView {
  kind: 'draft' | 'file' | 'plan'; id: string; businessName: string; agent?: string;
  title: string; line?: Display;
  sections: { heading?: string; lines: Display[] }[];
}

// ---------------------------------------------------------------------------------------------------------------
// Ink v2 wave 2: the views of the newly wired engine pieces (contracts.ts section 9d), trimmed to what screens read.
// Every figure arrives as engine text; a file the engine built (the calendar CSV) is saved as it came.
// ---------------------------------------------------------------------------------------------------------------

/** `venture.delivery.judge`: the judge's call on a ready draft, waiting for "Send to the judge" with this digest. */
export interface JudgePreview { runId: string; digest: string; estimatedMaxCostDisplay: Display; expiresAt: string; containsClientData: true }
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
export interface TranscriptionSetupView { status: 'set-up' | 'not-set-up' | 'files-missing'; command: string | null; model: string | null; ffmpeg: boolean; line: Display }
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
export interface EpisodeLite { scenarioId: string; index: number; passed: boolean; firstFailure: string | null; checks: CheckLite[]; playbookChecks?: PlaybookCheckLite[] }
export interface SimulationRunLite {
  id: string; at: string; playbookId: string; scenarioIds: string[]; episodes: EpisodeLite[]; passed: boolean;
  summary: { scenarios: number; passed: number; failed: number }; costDisplay: Display; modelMode: 'model' | 'template' | 'mixed';
}
/** ImprovementReadiness: reason is the engine's words; 'planned' means the loop is not in this build. */
export interface ImprovementReadinessLite { judged: number; rejectedOrEdited: number; due: boolean; reason: Display; status: 'available' | 'planned' }
/** `venture.improve.run` (ImprovementRunRecord), trimmed. changes: one plain line per change the kept version makes. */
export interface ImprovementRunLite {
  id: string; at: string; status: 'kept-candidate' | 'kept-parent' | 'incomplete'; parentPlaybookId: string; candidatePlaybookId: string | null;
  changes: Display[]; costDisplay: Display; modelMode: 'model' | 'template' | 'mixed'; incompleteReason: Display | null; digest: string;
  rolledBack?: { at: string; by: string };
}
/**
 * `venture.improve.status` (ImprovementStatus): the readiness, the newest run, a kept version waiting to be used
 * (adopted by its run id and digest), and the version in use with what going back takes (rollback null when the engine
 * would refuse it now).
 */
export interface ImprovementStatusLite {
  readiness: ImprovementReadinessLite; activePlaybookId: string | null; latest: ImprovementRunLite | null;
  candidate: { runId: string; playbookId: string; digest: string; changes: Display[] } | null;
  inUse?: { playbookId: string; version: number; hash: string; origin: 'plan' | 'improvement'; rollback: { playbookId: string; version: number; digest: string } | null } | null;
}
/** `venture.improve.rollback` (PlaybookRecord), trimmed: the version now in use. */
export interface PlaybookLite { id: string; version: number; hash: string; origin?: 'plan' | 'improvement'; parentId?: string | null }
/** `venture.posting.propose`: the post waits on Today. `warnings` are the risk gate's, in the engine's words. */
export interface PostingProposal {
  postId: string; connectorId: string; draftId: string; part: number | null;
  state: 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown'; line: Display; warnings: Display[];
}
export type PostingStepId = 'textbox' | 'submit' | 'confirm';
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
/** The posting limits the owner may only tighten, in the owner's units: posts a day, minutes, days, percent, posts. */
export interface OwnerPostingLimits { capPer24h: number; minGapMinutes: number; warmUpDays: number; duplicatePercent: number; linkStreak: number }
/** `venture.posting.limits.*`: per channel, Chausar's own limits, the owner's stricter ones and those the gate uses. */
export interface PostingLimitsView {
  channels: { connectorId: string; name: string; house: OwnerPostingLimits; owner: Partial<OwnerPostingLimits>; inUse: OwnerPostingLimits }[];
  line: Display;
}
/**
 * `venture.social.calendar`: the CSV the engine built, the name to save it under, its row count, the posts it left out
 * (channel name, words, why), the posts whose cell got an apostrophe (defused), the posts written as threads, and the
 * gaps between the draft's posts and the plan's slots, in the engine's words.
 */
export interface SocialCalendarFile {
  csv: string; fileName: string; rows: number; blocked: { draftId: string; name: string; text: string; line: Display }[];
  defused: string[]; threads: string[]; gaps: Display[];
}
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
export type BankRowClass = 'own-transfer' | 'suggested-payment' | 'money-in' | 'money-out' | 'applied' | 'skipped';
/** dateDisplay: the engine's date for the owner's country. flag: the engine's words when the row needs a second look, else null. */
export interface BankLedgerRow {
  id: string; accountId: string; account: string; date: string; dateDisplay: Display; amount: Display; direction: 'in' | 'out';
  description: string | null; counterparty: string | null; classification: BankRowClass; flag: Display | null; pairedWith: string | null;
  suggestion: { invoiceId: string; number: string; line: Display } | null; decided: 'payment' | 'cost' | 'skip' | null;
}
/** consent: the account's bank access in the engine's words, null when never given; provider: why nothing reads the bank yet. */
export interface BankLedgerView {
  accounts: { id: string; label: string; currency: string; consent: BankConsentView['status'] | null }[]; rows: BankLedgerRow[]; line: Display; provider: Display;
}
export interface BankApplyResult { row: BankLedgerRow; line: Display; receiptId?: string }
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
/** `venture.rules.list`: the dated platform rules a flagship playbook's checks rest on. */
export interface PlatformRuleView {
  id: string; platform: string; rule: Display; checkedOn: string; stale: boolean; usedBy: string[]; limitations: string[];
  source: { title: string; url: string } | null; line: Display;
}
export interface RulesListView { playbook: { id: string; label: string; riskLevel: string; lastReviewed: string } | null; rules: PlatformRuleView[]; summary: Display }

// ---------------------------------------------------------------------------------------------------------------
// The methods the UI calls, with their params and results.
// ---------------------------------------------------------------------------------------------------------------

export interface EngineMethods {
  'venture.queue.list': { params: { scope?: 'current' | 'all' }; result: QueueList };
  'venture.queue.decide': { params: { id: string; digest: string; action: QueueActionId; answer?: string; viewed?: boolean }; result: QueueDecision };
  'venture.queue.view': { params: { kind: QueueItemView['kind']; id: string }; result: QueueItemView };
  'venture.runs.list': { params: { state?: 'active' | 'done' | 'all' }; result: { runs: RunSummary[] } };
  'venture.runs.get': { params: { runId: string }; result: RunDetail };
  'venture.team.list': { params: Record<string, never>; result: { agents: AgentView[] } };
  'venture.team.gate': { params: { agentId: string; stepId: string; gate: 'auto' | 'hold' }; result: { agent: AgentView } };
  'venture.spend.list': { params: Record<string, never>; result: { rows: SpendRow[]; total: Display; totalRupees?: Display } };
  'venture.spend.policy.get': { params: Record<string, never>; result: SpendPolicyView };
  'venture.spend.policy.set': { params: { capUsd?: string | null; askFirstUsd?: string | null; rates?: SpendRateInput[]; inrPerUsd?: string | null }; result: SpendPolicyView };
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
  'venture.share.create': { params: { deliveryId: string; expiresInHours?: number }; result: ShareLink };
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
  'venture.books.summary': { params: { period?: BooksPeriodKey }; result: BooksSummaryLite };
  'venture.invoice.get': { params: { invoiceId: string }; result: InvoiceViewLite };
  'venture.invoice.prepare': { params: { orderId: string; dueInDays?: number; issueDate?: string }; result: InvoiceViewLite };
  'venture.invoice.issue': { params: { invoiceId: string; digest: string }; result: InvoiceViewLite };
  'venture.payment.record': { params: { invoiceId: string; amount: string; receivedOn: string; method: PaymentMethod }; result: InvoiceViewLite };
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
  'venture.blueprint.update': { params: { patch: BlueprintPatchLite }; result: BlueprintViewLite };
  'venture.price.quote': { params: { offerId: string; quantity?: string }; result: ReceiptLite };
  'venture.build.brief': { params: { useTemplate?: boolean }; result: BriefLite };
  'venture.build.handoff': { params: { builder: BuilderId }; result: HandoffPlanLite };
  'venture.build.handoffOpened': { params: { handoffId: string }; result: HandoffLite };
  'venture.build.link': { params: { repo: string; token?: string }; result: BuildFollowLite };
  'venture.build.sync': { params: Record<string, never>; result: BuildStatusLite };
  'venture.build.status': { params: Record<string, never>; result: BuildStatusView };
  'workspace.custody.get': { params: Record<string, never>; result: CustodyViewLite };
  'workspace.custody.recoveryCode': { params: { passphrase?: string }; result: { custody: CustodyViewLite; recoveryCode: string } };
  'workspace.custody.passphraseOn': { params: { passphrase: string }; result: { custody: CustodyViewLite; recoveryCode: string | null } };
  'workspace.custody.passphraseOff': { params: { passphrase: string }; result: { custody: CustodyViewLite } };
  /** With a business open, its backups; with none open (Welcome back), every backup on this computer, newest first. */
  'workspace.backups.list': { params: Record<string, never>; result: { backups: BackupLite[]; more: boolean } };
  'workspace.backups.create': { params: Record<string, never>; result: BackupLite };
  /** The open business goes back to the backup. The engine writes a safety copy of how it is now first. */
  'workspace.backups.restore': { params: { file: string; confirmed: true }; result: { workspace: WorkspaceLite; restoredFrom: BackupLite; safety: BackupLite } };
  /** Needs the passphrase when the business is locked with one (PASSPHRASE_WRONG otherwise). */
  'workspace.transfer.export': { params: { passphrase?: string }; result: MoveFile };
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
  'workspace.export': { params: { confirmed: true; plaintext: boolean }; result: { path: string; encrypted: boolean } };
  /** `confirmation` is the business name exactly as the vault holds it (workspace.status). */
  'workspace.delete': { params: { confirmation: string }; result: Deleted };
  /**
   * The business's privacy rule (platform/runtime/trust.ts updatePolicy, a partial patch): `send` is what may leave
   * this computer for an AI, checked by the engine before every call. Ink changes only `send`; the reply is the policy.
   */
  'trust.update': { params: { send: ModelStatusLite['sendPolicy'] }; result: { send: ModelStatusLite['sendPolicy'] } };
  'venture.client.list': { params: Record<string, never>; result: ClientLite[] };
  'venture.client.add': { params: ClientAddParams; result: ClientLite };
  'venture.order.list': { params: Record<string, never>; result: OrderLite[] };
  'venture.files.list': { params: { orderId?: string }; result: UploadLite[] };
  'venture.delivery.list': { params: Record<string, never>; result: DeliveryLite[] };
  /**
   * intake: only for a flagship playbook's offer (OfferLite.playbookOffer). An offer that cuts footage is refused with
   * RIGHTS_REQUIRED until intake.rights says whose footage it is: { basis: 'own-footage' | 'licence' | 'creator-clip-programme', holder, reference? }.
   */
  'venture.order.create': {
    params: {
      clientId: string; offerId: string; quantity?: string; request: string;
      intake?: {
        rights?: { basis: string; holder: string; reference?: string; scope?: string; expiresOn?: string }; format?: 'long' | 'short'; aiVoice?: boolean; aiPresenter?: boolean; paidPromotion?: boolean; cutFile?: string;
        calendar?: CalendarIntakeLite; clientRules?: ClientRulesLite;
      };
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
  'workspace.lock': { params: Record<string, never>; result: { locked: true } };
  'workspace.create': { params: WorkspaceCreateParams; result: WorkspaceCreated };
  'venture.countries': { params: Record<string, never>; result: CountryLite[] };
  'venture.preview': { params: { idea: string; countryCode: string; pricingModel?: PricingModel }; result: PlanPreviewLite };
  'venture.create': { params: { idea: string; countryCode: string; workingName?: string }; result: VentureViewLite };
  'venture.interview.next': { params: { useTemplate?: boolean }; result: InterviewViewLite };
  'venture.interview.answer': { params: { questionId: string; answer: InterviewAnswer }; result: InterviewViewLite };
  'venture.blueprint.draft': { params: { useTemplate?: boolean }; result: BlueprintViewLite };
  // Ink v2 wave 2: the newly wired engine methods.
  'venture.delivery.judge': { params: { runId: string }; result: JudgePreview };
  'venture.delivery.judgeSend': { params: { runId: string; digest: string }; result: DeliveryLite };
  'venture.improve.rollback': { params: { playbookId: string; digest: string }; result: PlaybookLite };
  // Practice and improvement (2C2): the engine's existing methods, which Ink now calls.
  'venture.simulation.scenarios': { params: Record<string, never>; result: ScenarioLite[] };
  /** No scenarioIds: every template practice client. useTemplate: built-in templates, no AI and no judge. */
  'venture.simulation.run': { params: { scenarioIds?: string[]; episodes?: number; useTemplate?: boolean }; result: SimulationRunLite };
  'venture.improve.status': { params: Record<string, never>; result: ImprovementStatusLite };
  'venture.improve.run': { params: { maxRounds?: number; useTemplate?: boolean }; result: ImprovementRunLite };
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
  'venture.judge.auto.get': { params: Record<string, never>; result: JudgeAutoView };
  /** The owner's, inside the app. auto: true records the standing consent for the judge's calls. */
  'venture.judge.auto.set': { params: { auto: boolean }; result: JudgeAutoView };
  /** Per channel: Chausar's own posting limits, the owner's stricter ones and those in use (Ink v2 wave 2, 2B1). */
  'venture.posting.limits.get': { params: Record<string, never>; result: PostingLimitsView };
  /** The owner's, inside the app: only stricter numbers (POSTING_LIMIT_LOOSER otherwise); a number left out is Chausar's own. */
  'venture.posting.limits.set': { params: { connectorId: string; limits: Partial<OwnerPostingLimits> }; result: PostingLimitsView };
  /** The owner's whisper.cpp for transcripts made on this computer, with its honest status (Ink v2 wave 2, 2E2). */
  'venture.transcription.get': { params: Record<string, never>; result: TranscriptionSetupView };
  /** The owner's, inside the app, desktop only: full paths to whisper-cli and its model file, or { clear: true }. */
  'venture.transcription.set': { params: { command: string; model: string } | { clear: true }; result: TranscriptionSetupView };
}
export type MethodName = keyof EngineMethods;
export type ParamsOf<M extends MethodName> = EngineMethods[M]['params'];
export type ResultOf<M extends MethodName> = EngineMethods[M]['result'];

/** An engine refusal, with the engine's code and plain-words message. */
export class EngineError extends Error {
  readonly code: string;
  readonly reason?: string;
  constructor(code: string, message: string, reason?: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    if (reason !== undefined) this.reason = reason;
  }
}

/** What the status line shows. `ok` shows nothing. */
export type EngineStatus =
  | { state: 'ok' }
  | { state: 'starting' }
  | { state: 'offline' }
  | { state: 'unpaired' }
  | { state: 'session-ended' }
  | { state: 'error'; message: string };

export type Transport = 'desktop' | 'web' | 'hosted' | 'fake';

export interface EngineClient {
  readonly transport: Transport;
  request<M extends MethodName>(method: M, params?: ParamsOf<M>): Promise<ResultOf<M>>;
  /** Run and queue events. Falls back to polling `venture.events` every 5 s when pushes are not available. */
  subscribe(listener: (event: VentureRunEvent) => void): () => void;
  status(): EngineStatus;
  onStatus(listener: (status: EngineStatus) => void): () => void;
}
