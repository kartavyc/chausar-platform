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
export type QueueKind = 'draft' | 'price' | 'quote' | 'plan' | 'invoice' | 'signoff' | 'question' | 'setup' | 'locked' | 'connector';
export interface QueueRow {
  id: string; businessId: string; businessName: string; agent?: string; kind: QueueKind;
  title: string; line?: string; change?: QueueChange; digest: string; createdAt: string;
  actions: QueueAction[]; // one or two; exactly one primary
  viewRef?: { kind: 'draft' | 'file' | 'run' | 'plan'; id: string };
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
export interface RunDetail extends RunSummary { steps: RunStep[]; question?: { id: string; text: string; choices?: string[] }; error?: string }
export type Posture = 'rehearsal' | 'shadow' | 'approve-each' | 'auto-spot-check';
export interface AgentView {
  id: string; name: string; role: string; now: Display; posture: Posture; spend: Display;
  last?: { line: Display; receiptId?: string; estimate?: boolean };
  steps: { id: string; purpose: string; gate: 'auto' | 'hold'; floor: boolean }[];
}
export type VentureRunEventType = 'run.started' | 'run.step' | 'run.waiting' | 'run.done' | 'run.failed' | 'queue.changed';
export interface VentureRunEvent { type: VentureRunEventType; businessId: string; runId?: string; at: string }
// phase 2 views
/** `reason`: the engine's words for why a call was refused (no price, over the monthly limit, waiting for approval). */
export interface SpendRow { id: string; agent?: string; connector?: string; label: string; reserved: Display; settled?: Display; kind: 'estimate' | 'billed' | 'refused'; receiptId?: string; reason?: Display }
/** venture.spend.policy.get/set. Micro figures are whole micro-USD strings, sent back as they came; the UI shows the Display fields. */
export type SpendRateUnit = 'per-million-tokens' | 'per-call' | 'per-run-cap';
export interface SpendRateLine {
  item: string; unit: SpendRateUnit; inputMicrosPerMillion: string | null; outputMicrosPerMillion: string | null; microsPerCall: string | null;
  source: string; checkedOn: string; confirmed: boolean; by: 'list' | 'owner'; price: Display;
}
export interface SpendRateInput {
  item: string; unit: SpendRateUnit; inputMicrosPerMillion?: string | null; outputMicrosPerMillion?: string | null; microsPerCall?: string | null; source: string; checkedOn: string;
}
export interface SpendPolicyView { capMicros: string | null; askFirstMicros: string | null; cap: Display; askFirst: Display; rates: SpendRateLine[]; setAt: string | null }
export interface JournalEntry { id: string; action: string; target: string; state: 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown'; at: string; line: Display; receiptId?: string }
/** `dismissed`: the owner said no to this suggestion (venture.evidence.dismiss); it stays in the ledger, off the screen. */
export interface EvidenceItem { id: string; subject: string; field: string; value: Display; type: string; strength: 'verified' | 'strong' | 'weak'; claim: 'observed' | 'inferred' | 'needs-your-data'; source: string; applied: boolean; dismissed?: boolean }

// ---------------------------------------------------------------------------------------------------------------
// Ink final pass: the views and actions the engine added for the last screens (engine-final, 21 Oct). Every figure is
// engine text (Display); amounts the owner types go to the engine as typed strings and come back formatted.
// ---------------------------------------------------------------------------------------------------------------

/** `venture.money.overview`: Money at a glance, three lines the engine adds up (owed, received, spent). */
export interface MoneyOverviewLine { id: 'owed' | 'received' | 'spent'; label: Display; value: Display; receiptId?: string; estimate?: boolean }
export interface MoneyOverview { lines: MoneyOverviewLine[] }

/** `venture.tax.working`: the tax working for a period, worked by the calculator, each figure with its receipt. */
export interface TaxWorkingLine { label: Display; value: Display; receiptId?: string }
export interface TaxWorkingSection { id: string; title: Display; lines: TaxWorkingLine[]; note?: Display }
export interface TaxWorking { period: Display; sections: TaxWorkingSection[]; needsCaConfirmation: boolean }

/** `venture.ca.get` (the CA firm playbook): the CA of record, rate tables waiting for the CA, and sign-off requests. */
export interface CaOfRecord { name: string; membershipNo: string }
export interface CaPendingRate { tableId: string; title: Display; version: string; validFrom: string; validTo: string | null; citations: string[] }
export interface CaSignoffRequest { id: string; deliveryId: string; title: Display; state: 'sent' | 'signed' | 'returned'; at: string }
export interface CaView { ca: CaOfRecord | null; pendingRates: CaPendingRate[]; requests: CaSignoffRequest[] }

/** Leads (platform/runtime/venture/contracts.ts LeadView): agents draft, the owner sends from his own mailbox. */
export interface LeadEmailCheck { status: 'unverified' | 'verified' | 'failed'; at: string | null; line: string }
export interface OutreachDraftView {
  id: string; leadId: string; to: string; subject: string; text: string;
  footer: { businessName: string; postalAddress: string; unsubscribe: string }; sourceUrl: string; by: 'agent' | 'owner'; at: string; digest: string;
}
export interface LeadSendView { draftId: string; sentAt: string; recordedBy: string; recordedAt: string; channel: 'own-mailbox' }
export interface LeadView {
  id: string; name: string; company: string | null; email: string | null; emailDomain: string | null; sourceUrl: string; emailCheck: LeadEmailCheck;
  status: 'new' | 'drafted' | 'contacted' | 'replied' | 'lost' | 'blocked'; drafts: OutreachDraftView[]; sends: LeadSendView[]; addedBy: string; addedAt: string;
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

/** A preview link for a client (venture.share.*). `url` is null when there is no public address; `reason` says why. */
export interface ShareLink { id: string; url: string | null; reason?: Display; expiresAt: string }

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
/** `OfferIntakeAsk`: what an order for a flagship offer asks. rights: the bases it accepts (empty: no footage is cut). */
export interface OfferIntakeLite { rights: RightsBasisLite[]; fields: ('format' | 'aiVoice' | 'aiPresenter' | 'paidPromotion' | 'cutFile')[] }
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
}
/** `venture.files.list` (UploadView), trimmed: a file a client sent, kept in the vault. */
export interface UploadLite {
  /** transcript: an SRT or VTT file of what was said, with timings. */
  id: string; at: string; name: string; format: 'csv' | 'xlsx' | 'pdf' | 'transcript'; bytes: number;
  scope: { kind: 'order'; orderId: string } | { kind: 'practice'; scenarioId: string }; clientData: boolean;
}
/** `venture.delivery.list` (DeliveryRunView), trimmed to what a client's sheet shows. */
export type DeliveryStatus = 'waiting-for-you' | 'needs-answer' | 'brief-waiting' | 'ready-for-review' | 'accepted' | 'edited' | 'rejected' | 'failed';
export interface DeliveryLite {
  id: string; at: string; orderId: string; status: DeliveryStatus; practice: boolean;
  deliverable: { title: string } | null; verdict: { choice: 'accepted' | 'edited' | 'rejected'; at: string } | null;
  /** DeliveryRunView: the run waits on the owner (it is on Today). The engine always sends it. */
  awaitingYou?: boolean;
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
  'venture.spend.list': { params: Record<string, never>; result: { rows: SpendRow[]; total: Display } };
  'venture.spend.policy.get': { params: Record<string, never>; result: SpendPolicyView };
  'venture.spend.policy.set': { params: { cap?: string | null; askFirst?: string | null; rates?: SpendRateInput[] }; result: SpendPolicyView };
  'venture.journal.list': { params: { limit?: number }; result: { entries: JournalEntry[] } };
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
  /** `links` is the contract's name; the engine sends the same list as `shares` too. */
  'venture.share.list': { params: { deliveryId?: string }; result: { links?: ShareLink[]; shares?: ShareLink[] } };
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
      intake?: { rights?: { basis: string; holder: string; reference?: string; scope?: string; expiresOn?: string }; format?: 'long' | 'short'; aiVoice?: boolean; aiPresenter?: boolean; paidPromotion?: boolean; cutFile?: string };
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
