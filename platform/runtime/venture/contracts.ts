// Chausar venture launcher: shared contracts.
// Every type, record kind, RPC method name, payload and result shape used by the venture packages.
// Erasable TypeScript only (Node type stripping): no enum, no namespace, no parameter properties.
// Owned by package P0. Other packages import from here and never redefine these shapes.
import type { Context, StateStore } from '../contracts.ts';
import type {
  ApprovalBlockId, ComposedNote, ComposedPage, ComposeModelOutput, CompositionRecord, DecideModelOutput, DraftHandoverPort,
  OfferBlockId, OnboardingPayloads, OnboardingResults, PlanKind, StepBlockId, ToolBlockId, ViewSelection,
} from './onboarding-contracts.ts';
import type { FootageRights, RightsBasis } from './delivery/rights.ts';

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
export type ChecklistItem = { id: ChecklistItemId; label: string; done: boolean; place: LaunchPlace };
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
  name: Labelled<string>;
  description: Labelled<string>;
  pricing: {
    model: PricingModel;
    quantityUnit: 'month' | 'project' | 'hour';
    unitPriceMinor: MinorString | null; // owner-entered only; null shows "Set your price"
    unitPriceLabel: 'told-by-you' | 'not-set';
    defaultQuantity: string; // integer text, engine default '1'
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
export type OfferIntakeAsk = { rights: RightsBasis[]; fields: ('format' | 'aiVoice' | 'aiPresenter' | 'paidPromotion' | 'cutFile')[] };
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
  offers?: { id: string; name?: string; description?: string; unitPrice?: string | null; pricingModel?: PricingModel }[];
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
export const MODEL_PURPOSES = ['interview', 'blueprint', 'brief', 'delivery', 'client-sim', 'judge', 'agent-turn', 'improve', 'decide', 'compose'] as const;
export type ModelPurpose = typeof MODEL_PURPOSES[number];
export const PURPOSE_TIER: Readonly<Record<ModelPurpose, ModelTier>> = Object.freeze({
  interview: 'fast', 'client-sim': 'fast', judge: 'fast', blueprint: 'main', brief: 'main', delivery: 'main',
  'agent-turn': 'fast', improve: 'main', decide: 'fast', compose: 'main',
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
};

export type ModelCallRecord = RecordBase<'venture-model-call'> & {
  purpose: ModelPurpose;
  tier: ModelTier;
  presetId: ModelPresetId;
  connectionId: string | null;
  routeKind: ModelRouteKind; // `kind` is the record kind from RecordBase
  model: string | null;
  consent: 'standing' | 'approved-preview';
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
  error: { code: string; message: string } | null;
  replay: boolean; // true when served from a synthetic recording
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
};

export interface ModelPort {
  /** Never writes. Calls left 'dispatching' for more than ten minutes are reported as failed in this view only. */
  status(ctx: Context): ModelStatusView;
  /** The six presets with availability as of now (the CLI check and the Codex profile included). */
  presets(): ModelPreset[];
  /** Runs '<cli> --version' through the transport: no network, no cost. Throws CLI_UNAVAILABLE. */
  checkCli(presetId: ModelPresetId): Promise<void>;
  /** Standing-consent path. Refuses tasks with client data (CLIENT_DATA_NEEDS_APPROVAL), by flag and by content. */
  generate<T>(ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>>;
  /** Per-call path. Records the exact payload; sends nothing. Returns null when only templates serve the tier. */
  preview<T>(ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null>;
  /** Sends exactly the previewed payload once, after the owner approved its digest; claims the call before any await. */
  runPreview<T>(ctx: Context, callId: string, approvedDigest: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>>;
}

export type ModelHttpRequest = { url: string; method: 'POST'; headers: Record<string, string>; body: string; timeoutMs: number; purpose: ModelPurpose };
export type ModelHttpResponse = { status: number; body: string };
export type ModelProcessRequest = { command: string; args: string[]; env: Record<string, string>; stdin: string; timeoutMs: number; purpose: ModelPurpose | 'version-check' };
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
  key: 'unit' | 'subtotal' | 'discount' | 'taxable' | 'tax' | 'cgst' | 'sgst' | 'igst' | 'total' | 'paid' | 'balance';
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
  name: string; // one line
  email: string | null;
  countryCode: CountryCode | null;
  taxId: string | null; // the client's GSTIN or VAT number, when they gave one
  stateCode: string | null; // India only: the client's GST state code, for place of supply
  note: string | null;
};
export type OrderRecord = RecordBase<'venture-order'> & {
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
};
export type InvoiceLine = { description: string; quantity: string; unitMinor: MinorString; amountMinor: MinorString };
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
export type PaymentMethod = 'bank-transfer' | 'upi' | 'card' | 'cash' | 'payment-link' | 'other';
export type PaymentRecord = RecordBase<'venture-payment'> & {
  invoiceId: string;
  amountMinor: MinorString;
  currency: string;
  receivedOn: IsoDate;
  method: PaymentMethod;
  factId: string;
  booksReceiptId: string | null; // calculator receipt for 'received', kept only when its total equals this payment
  booksNote: string | null; // e.g. 'The books receipt covers more than this payment.'
};
export type InvoiceView = {
  invoice: InvoiceRecord;
  client: ClientRecord;
  receipt: PriceReceiptRecord;
  payments: PaymentRecord[];
  documentText: string; // plain-text invoice built by deterministic code
  figures: PriceFigure[]; // subtotal, tax lines, total, paid, balance
  notes: string[]; // e.g. what is missing for a tax invoice, why a books receipt is absent
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
};
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
/** The business's untrusted screen (policy/untrusted.ts): observe until the owner turns on enforce; the newest record wins. */
export type ScreenSettingRecord = RecordBase<'venture-screen-setting'> & { mode: 'observe' | 'enforce' };
/** Held content the owner let through, bound to that exact content's digest; changed content is held again. */
export type UntrustedReleaseRecord = RecordBase<'venture-untrusted-release'> & { digest: string };
/**
 * The action journal (P2-journal, venture/journal/). Every outside effect is one entry: described, then approved inside
 * the app, then applied, rejected or outcome_unknown. A connector post is its own journalled record with the same fields.
 */
export const JOURNAL_ACTION_IDS = ['invoice.issue', 'delivery.send', 'connector.post', 'site.apply', 'bank.alert', 'connector.write'] as const;
export type JournalActionId = typeof JOURNAL_ACTION_IDS[number];
export type JournalState = ConnectorPostState;
export type JournalStep = { state: JournalState; at: IsoTime; by: string; line: string };
/**
 * What an approval leaves behind. The token itself reaches only the code that applies it, never a record, a log or a
 * model. usedAt and key are set by the claim, in its own commit, before the effect starts: one token, one apply.
 */
export type ApprovalSeal = { tokenHash: string; approvedBy: string; at: IsoTime; expiresAt: IsoTime; usedAt: IsoTime | null; key: string | null };
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
};
export type BrowserProbe = { present: boolean; reason: string };
export type BrowserPostJob = { postId: string; connectorId: string; text: string; timeoutMs: number };
/** A security check or a platform block the browser saw on the site (W1 H19). The posting code keeps it as a channel hold. */
export type BrowserSiteHold = { kind: 'challenge' | 'blocked'; site: string };
/** 'not-sent': the platform was never reached, so nothing went out. 'unknown': it may have gone out; check before posting again. */
export type BrowserPostResult =
  | { outcome: 'posted'; line: string; url: string | null }
  | { outcome: 'not-sent'; line: string; hold?: BrowserSiteHold }
  | { outcome: 'unknown'; line: string; hold?: BrowserSiteHold };
/**
 * Drives the owner's own browser on this computer. The real one needs Playwright with Chromium already installed.
 * clearHold: the owner cleared a platform's security check; the hold kept beside the profile folders ends (W1 H19).
 */
export type BrowserPort = { probe(): Promise<BrowserProbe>; post(job: BrowserPostJob): Promise<BrowserPostResult>; clearHold?(connectorId: string): Promise<void> };
export type ApiPostPort = { post(job: BrowserPostJob): Promise<BrowserPostResult> };
export type ConnectorPorts = {
  browser?: BrowserPort;
  /** Connector ids whose API app review is recorded (the real host reads CHAUSAR_APP_REVIEWED). */
  appReviewed?: readonly string[];
  /** API posting clients by connector id. None ship in this build. */
  api?: Readonly<Record<string, ApiPostPort>>;
  postTimeoutMs?: number;
};
/** A staged edit to one website file: applied only with the exact plan digest the owner reviewed, verified, reversible. */
export type SiteEditState = 'staged' | 'applying' | 'applied' | 'rolled-back' | 'rejected' | 'needs-inspection';
export type SiteEditRecord = RecordBase<'venture-site-edit'> & {
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
export type BankAccountRecord = RecordBase<'venture-bank-account'> & { label: string; currency: string; consent: BankConsentData | null; polls: IsoTime[] };
/** amountMinor is signed: money in positive, money out negative. id is stable, so a second import never counts a row twice. */
export type BankTransactionData = {
  id: string; date: IsoDate; amountMinor: MinorString; currency: string; counterparty: string | null; description: string | null;
  reference: string | null; balanceAfterMinor: MinorString | null; source: 'statement-csv' | 'provider';
};
/** One statement import: only the transactions it added, with how many were already there and which lines were refused. */
export type BankImportRecord = RecordBase<'venture-bank-import'> & {
  accountId: string; fileDigest: string; transactions: BankTransactionData[]; duplicates: number; rejected: { line: number; reason: string }[]; line: string;
};
export type BankImportResult = {
  account: string; accountId: string; added: number; duplicates: number; rejected: { line: number; reason: string }[]; line: Display; transactions: number;
};
export type BankConsentView = {
  account: string; accountId: string; consent: BankConsentData;
  status: { state: 'active' | 'expiring' | 'expired' | 'revoked'; daysLeft: number; line: Display };
  provider: Display; // why nothing reads the bank yet
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
export type LeadSettingsRecord = RecordBase<'venture-lead-settings'> & { postalAddress: string | null; blockedEmails: string[]; blockedDomains: string[] };

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
  'https://www.youtube.com', 'https://studio.youtube.com',
  'https://tallysolutions.com', 'https://www.xero.com', 'https://quickbooks.intuit.com',
  'https://www.mca.gov.in', 'https://www.gst.gov.in', 'https://documenso.com', 'https://www.docusign.com', 'https://www.firstbase.io',
  'https://posthog.com', 'https://plausible.io', 'https://analytics.google.com', 'https://tally.so', 'https://www.typeform.com',
  'https://console.anthropic.com', 'https://platform.openai.com',
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
};
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
  origin?: 'plan' | 'improvement';
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
};
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
export type DeliveryRunStatus = 'waiting-for-you' | 'needs-answer' | 'brief-waiting' | 'ready-for-review' | 'accepted' | 'edited' | 'rejected' | 'failed';
export type DeliveryRunRecord = RecordBase<'venture-delivery-run'> & {
  orderId: string;
  playbookId: string;
  playbookHash: string;
  status: DeliveryRunStatus;
  servedBy: 'model' | 'template'; // 'template': an outline no AI wrote, that never read the client's request
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
};
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
};
export type SignalRecord = RecordBase<'venture-signal'> & {
  source: 'owner-rejected' | 'owner-edited' | 'check-failed';
  runId: string;
  reason: DeliveryReason | CheckId | null;
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
};
/** screen: what the untrusted screen found in a client's answer the owner relayed (policy/untrusted.ts); absent when nothing. */
export type HandoffRequest = { to: 'client' | 'owner'; question: string; turn: number; answer: string | null; answeredBy: 'owner' | 'practice-client' | null; screen?: ScreenNote };
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
};
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
export type UploadFormat = 'csv' | 'xlsx' | 'pdf' | 'transcript';
export type UploadRecord = RecordBase<'venture-upload'> & {
  name: string;
  format: UploadFormat;
  bytes: number;
  digest: string;
  contentBase64: string;
  scope: { kind: 'order'; orderId: string } | { kind: 'practice'; scenarioId: string };
  clientData: boolean;
};
export type UploadView = Omit<UploadRecord, 'contentBase64'>;

/** Which run a table or a work receipt belongs to. */
export type WorkRunRef =
  | { kind: 'delivery'; runId: string }
  | { kind: 'rehearsal'; scenarioId: string; episode: number }
  | { kind: 'improvement'; runId: string; scenarioId: string };
export type WorkTableRow = { id: string; cells: Record<string, string> };
/** A table a tool made: a sandbox program's output, or bills picked from PDFs. Tables read from files are not stored. */
export type WorkTableRecord = RecordBase<'venture-work-table'> & {
  name: string;
  columns: string[];
  rows: WorkTableRow[];
  source:
    | { kind: 'transform'; fromTableId: string; tier: ExecutionTier; driver: string; programDigest: string; moduleDigest: string | null }
    | { kind: 'picked'; uploadIds: string[] };
  runRef: WorkRunRef;
  digest: string;
};
/** 'total', 'opening', 'inflows', 'group-1' ... Each figure in a work receipt has a short key. */
export type WorkFigureKey = string;
export type WorkFigure = { key: WorkFigureKey; label: string; minor: MinorString; display: string; currency: string; unit: 'money' | 'count' };
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
export type WorkReceiptRecord = RecordBase<'venture-work-receipt'> & {
  operation: 'work.sum' | 'work.totals' | 'work.reconcile';
  runRef: WorkRunRef;
  currency: string;
  inputs: { tables: { id: string; name: string; digest: string }[]; columns: Record<string, string>; rowIds: string[] };
  steps: WorkStep[];
  figures: WorkFigure[];
  reconciliation: Reconciliation | null;
  allowedNumbers: string[];
  explanation: string; // built by code from the figures
  digest: string;
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
  proposedBy: 'model' | 'chausar';
  parentHash: string;
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
};
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
};
export type ImprovementStatus = {
  readiness: ImprovementReadiness;
  activePlaybookId: string | null;
  latest: ImprovementRunRecord | null;
  /** The newest kept candidate that is not adopted yet and still fits the current plan. */
  candidate: { runId: string; playbookId: string; digest: string; changes: string[] } | null;
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
};
/**
 * The owner's own rate for showing spend in rupees too: rupees per US dollar in ten-thousandths of a rupee (83.50 is
 * 835000), and the day the owner set it. Spend is still counted and capped in US dollars; rupees are shown, never kept.
 */
export type RupeeRate = { perUsd: string; setOn: IsoDate };
/**
 * reason: why a refused call was refused, in the engine's words (no price, the monthly limit, waiting for approval).
 * reservedRupees, settledRupees: the same figures in rupees at the owner's rate, with that rate; absent without one.
 */
export interface SpendRow {
  id: string; agent?: string; connector?: string; label: string; reserved: Display; settled?: Display; kind: 'estimate' | 'billed' | 'refused'; receiptId?: string; reason?: Display;
  reservedRupees?: Display; settledRupees?: Display;
}
/**
 * One rate card line as the owner types it (venture.spend.policy.set). Lines the owner sets are theirs and confirmed.
 * Each figure comes once: in US dollars as typed (up to six decimals; the engine converts) or in micro units.
 */
export type SpendRateInput = {
  item: string; unit: SpendRateUnit; inputMicrosPerMillion?: MicroString | null; outputMicrosPerMillion?: MicroString | null; microsPerCall?: MicroString | null;
  inputUsdPerMillion?: string | null; outputUsdPerMillion?: string | null; usdPerCall?: string | null;
  source: string; checkedOn: IsoDate;
};
/** A rate's figures in US dollars as the owner types them ('3.00', '0.000075'), for the edit form. */
export type SpendRateUsd = { inputUsdPerMillion: string | null; outputUsdPerMillion: string | null; usdPerCall: string | null };
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
}

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
  // Ink frontend (P1-A): what the desktop pushes over IPC and the web sends over /api/events (VentureRunEvent).
  'run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
] as const;
export type VentureEventName = typeof VENTURE_EVENTS[number];
export type VentureEventRecord = RecordBase<'venture-event'> & { seq: number; name: VentureEventName; data: Json };

// ---------------------------------------------------------------------------
// 9b. Views for the Ink frontend (P1-A). app/ui mirrors these in app/ui/src/engine/types.ts.
// Display and SpendRow, also in the shared contract, are declared in section 8c.
// ---------------------------------------------------------------------------

export type QueueActionId = 'approve' | 'deny' | 'later' | 'watch' | 'read' | 'answer' | 'send-to-ca' | 'open' | 'connect' | 'set-prices' | 'keep' | 'issue' | 'run-again';
export interface QueueAction { id: QueueActionId; label: string; primary: boolean; secondAsk?: boolean; requiresView?: boolean }
export interface QueueChange { label?: string; before?: Display; after: Display; receiptId?: string; estimate?: boolean }
export type QueueKind = 'draft' | 'price' | 'quote' | 'plan' | 'invoice' | 'signoff' | 'question' | 'setup' | 'locked' | 'connector';
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
/** screen: one line saying what the untrusted screen noted in the run's outside content, never the words (W1 H9). */
export interface RunDetail extends RunSummary { steps: RunStep[]; question?: { id: string; text: string; choices?: string[] }; error?: string; screen?: Display }
export type Posture = 'rehearsal' | 'shadow' | 'approve-each' | 'auto-spot-check';
export interface AgentView {
  id: string; name: string; role: string; now: Display; posture: Posture; spend: Display;
  last?: { line: Display; receiptId?: string; estimate?: boolean };
  steps: { id: string; purpose: string; gate: 'auto' | 'hold'; floor: boolean }[];
}
export type VentureRunEventType = 'run.started' | 'run.step' | 'run.waiting' | 'run.done' | 'run.failed' | 'queue.changed';
export interface VentureRunEvent { type: VentureRunEventType; businessId: string; runId?: string; at: string }
// phase 2 views (SpendRow is in section 8c)
export interface JournalEntry { id: string; action: string; target: string; state: 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown'; at: string; line: Display; receiptId?: string }
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
export const VENTURE_RUN_EVENT_TYPES: readonly VentureRunEventType[] = Object.freeze(['run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed'] as const);
export const QUEUE_ACTION_IDS: readonly QueueActionId[] = Object.freeze(['approve', 'deny', 'later', 'watch', 'read', 'answer', 'send-to-ca', 'open', 'connect', 'set-prices', 'keep', 'issue', 'run-again'] as const);

/** One owner decision on a Today row. Decide-once: a second decision on the same row id is refused. */
export type QueueDecisionRecord = RecordBase<'venture-queue-decision'> & {
  rowId: string;
  subject: string; // the thing the row stands for, the same across its versions
  digest: string; // the row digest the owner decided on
  action: QueueActionId;
  line: string;
  receiptId: string | null;
  decidedBy: string; // memberId of the person who decided
};
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
export interface MoneyOverviewLine { id: 'owed' | 'received' | 'spent'; label: Display; value: Display; receiptId?: string; estimate?: boolean; rupees?: Display }
export interface MoneyOverview { lines: MoneyOverviewLine[] }
/** venture.tax.working: the tax working for a period, every figure from code with its receipt. */
export interface TaxWorkingLine { label: Display; value: Display; receiptId?: string }
export interface TaxWorkingSection { id: string; title: Display; lines: TaxWorkingLine[]; note?: Display }
export interface TaxWorkingView { period: Display; sections: TaxWorkingSection[]; needsCaConfirmation: boolean }
/** venture.ca.get (the AI-native CA firm playbook): the CA of record, rate tables waiting for the CA, and sign-off requests. */
export interface CaPendingRate { tableId: string; title: Display; version: string; validFrom: string; validTo: string | null; citations: string[] }
export interface CaRequestView { id: string; deliveryId: string; title: Display; state: 'sent' | 'signed' | 'returned'; at: string }
export interface CaFirmView { ca: { name: string; membershipNo: string } | null; pendingRates: CaPendingRate[]; requests: CaRequestView[] }
/** venture.share.*: a read-only preview link for a client. url is null when no public address is set; reason says why. */
export interface ShareLinkView { id: string; url: string | null; reason?: Display; expiresAt: string }
/** venture.client.list rows: what the client owes on open invoices, summed in BigInt, with the sum's receipt. */
export type ClientListRow = ClientRecord & { owed?: { display: Display; receiptId: string } };
/** venture.invoice.list rows: the invoice total, formatted, and the price receipt behind it. */
export type InvoiceListRow = InvoiceRecord & { total?: Display; receiptId?: string };

/**
 * A receipt for a sum code made from venture records: what clients owe on open invoices, what came in this month, what
 * AI and tools cost this month. Each addend names its record; the steps are BigInt additions. venture.receipt.get serves
 * it beside price receipts. unit 'micros' is micro-USD (spend); 'minor' is the venture currency's minor unit.
 */
export type SumReceiptSubject =
  | { type: 'owed'; clientId: string | null }
  | { type: 'received'; from: IsoDate; to: IsoDate }
  | { type: 'spent'; month: string };
export type SumReceiptRecord = RecordBase<'venture-sum-receipt'> & {
  subject: SumReceiptSubject;
  operation: 'venture.sum';
  currency: string;
  unit: 'minor' | 'micros';
  addends: { recordId: string; label: string; amount: string; display: string }[];
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
  decisions: { draftId: string; decision: 'approved' | 'changes'; comment: string | null; at: IsoTime; digest: string; via: 'share-link' | 'owner-recorded'; recordedBy: string | null }[];
};

/** A business on this computer as the views see it. id is its workspace folder, the id workspace.list uses. */
export type VentureBusinessRef = { id: string; name: string | null; opens: 'with-this-computer' | 'needs-passphrase' | 'key-missing'; openedAt: string | null };
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
  | ScreenSettingRecord | UntrustedReleaseRecord;
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
  | { entry: 'signoff'; requestId: string; decision: 'signed' | 'returned'; caName: string; membershipNumber: string; workingDigest: string; receiptIds: string[]; playbookHash: string | null; note: string | null; recordedBy: string }
  | { entry: 'rate-confirmation'; tableId: string; tableVersion: number; tableHash: string; caName: string; membershipNumber: string; recordedBy: string }
);

// ---------------------------------------------------------------------------
// 10. RPC methods: names, owners, payloads, results
// ---------------------------------------------------------------------------

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
  // Onboarding v2: the draft desk, answered before the vault check (DRAFT_METHODS)
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.ai.calls',
  'venture.compose.decide', 'venture.compose.fill', 'venture.compose.get', 'venture.compose.update',
] as const;
export type VentureMethod = typeof VENTURE_METHODS[number];
/** Answered without a vault, a model or any write. The engine routes them before its vault check. */
export const PRE_VAULT_METHODS: readonly VentureMethod[] = Object.freeze(['venture.countries', 'venture.preview'] as const);
/**
 * Answered by the engine's draft desk before the vault check. They may call a model and write the in-memory draft
 * store, never the vault. The same nine as ONBOARDING_METHODS in onboarding-contracts.ts (a test pins them equal).
 */
export const DRAFT_METHODS: readonly VentureMethod[] = Object.freeze([
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.ai.calls',
  'venture.compose.decide', 'venture.compose.fill', 'venture.compose.get', 'venture.compose.update',
] as const);

export type VenturePackageId = 'core' | 'models' | 'money' | 'build' | 'delivery' | 'views';
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
] as const);
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
  'venture.blueprint.update': { patch: BlueprintPatch };
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
  };
  'venture.order.list': Empty;
  'venture.order.deliver': { orderId: string; deliveredOn: IsoDate };
  'venture.invoice.prepare': { orderId: string; dueInDays?: number; issueDate?: IsoDate };
  'venture.invoice.issue': { invoiceId: string; digest: string };
  'venture.invoice.get': { invoiceId: string };
  'venture.invoice.list': Empty;
  'venture.payment.record': { invoiceId: string; amount: string; receivedOn: IsoDate; method: PaymentMethod };
  'venture.books.summary': { period?: BooksPeriodKey; from?: IsoDate; to?: IsoDate };
  'venture.spend.list': Empty;
  'venture.spend.policy.get': Empty;
  'venture.spend.policy.set': { capUsd?: string | null; askFirstUsd?: string | null; cap?: MicroString | null; askFirst?: MicroString | null; rates?: SpendRateInput[]; inrPerUsd?: string | null };
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
  'venture.improve.run': { maxRounds?: number; useTemplate?: boolean };
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
  'venture.queue.view': { id: string; kind?: 'draft' | 'file' | 'run' | 'plan' };
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
  'venture.share.create': { deliveryId: string; expiresInHours?: number };
  'venture.share.list': { deliveryId?: string };
  'venture.share.revoke': { id: string };
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
  'venture.events': { events: VentureEventRecord[]; lastSeq: number };
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
  /** A price receipt, or a sum receipt (owed, received, spent) that code made from venture records. */
  'venture.receipt.get': PriceReceiptRecord | SumReceiptRecord;
  'venture.client.add': ClientRecord;
  'venture.client.list': ClientListRow[];
  'venture.order.create': OrderRecord;
  'venture.order.list': OrderRecord[];
  'venture.order.deliver': OrderRecord;
  'venture.invoice.prepare': InvoiceView;
  'venture.invoice.issue': InvoiceView;
  'venture.invoice.get': InvoiceView;
  'venture.invoice.list': InvoiceListRow[];
  'venture.payment.record': InvoiceView;
  'venture.books.summary': BooksSummary;
  'venture.spend.list': { rows: SpendRow[]; total: Display; totalRupees?: Display };
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
  'venture.work.get': WorkReceiptRecord;
  'venture.improve.status': ImprovementStatus;
  'venture.improve.run': ImprovementRunRecord;
  'venture.improve.get': ImprovementRunRecord;
  'venture.improve.adopt': PlaybookRecord;
  'venture.queue.list': QueueList;
  'venture.queue.decide': QueueDecision;
  'venture.runs.list': { runs: RunSummary[] };
  'venture.runs.get': RunDetail;
  'venture.team.list': { agents: AgentView[] };
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
  /** links is the contract's name; shares is the same list under the name app/ui read first. */
  'venture.share.list': { links: ShareLinkView[]; shares: ShareLinkView[] };
  'venture.share.revoke': ShareLinkView;
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
] as const;
export type VentureErrorCode = typeof VENTURE_ERRORS[number];

// ---------------------------------------------------------------------------
// 12. Handler tables and dependencies (implemented by packages, wired by P0 and P6)
// ---------------------------------------------------------------------------

export type SecretName = `model:${ModelPresetId}` | `github:${string}`;
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
  /** Called once with the events a venture action committed, after the commit. A listener's failure never undoes it. */
  publish?: (events: VentureEventRecord[]) => void;
  /**
   * The hosted web server's public origin (CHAUSAR_PUBLIC_URL, equal to the hosted origin), for client share links.
   * Trusted host composition, never a payload; only on the hosted web server. Absent: share links get no address.
   */
  publicUrl?: string;
};

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
  /** The hosted web server's public origin for client share links (CHAUSAR_PUBLIC_URL). Used only when host is 'hosted-web'. */
  publicUrl?: string;
};
