// Chausar venture launcher: shared contracts.
// Every type, record kind, RPC method name, payload and result shape used by the venture packages.
// Erasable TypeScript only (Node type stripping): no enum, no namespace, no parameter properties.
// Owned by package P0. Other packages import from here and never redefine these shapes.
import type { Context, StateStore } from '../contracts.ts';

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
export type Labelled<T> = { value: T; label: LineLabel; by: LineAuthor };

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
};

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
/** amount is the owner's typed decimal text in the venture currency; rate is percent text like '18' or '8.25'. */
export type InterviewAnswer = { choiceId?: string; text?: string; amount?: string; yes?: boolean; rate?: string; skipped?: true };
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
export type StepCapability = 'drafts-now' | 'planned';
export type BlueprintStep = {
  id: string;
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
  { id: 'step_1', doneBy: 'you', capability: 'planned', note: 'You gather what the client sends. An agent that reads files and inboxes is planned.' },
  { id: 'step_2', doneBy: 'you', capability: 'planned', note: 'You do the hands-on work. An agent with the tools for it is planned.' },
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
export const MODEL_PURPOSES = ['interview', 'blueprint', 'brief', 'delivery', 'client-sim', 'judge'] as const;
export type ModelPurpose = typeof MODEL_PURPOSES[number];
export const PURPOSE_TIER: Readonly<Record<ModelPurpose, ModelTier>> = Object.freeze({
  interview: 'fast', 'client-sim': 'fast', judge: 'fast', blueprint: 'main', brief: 'main', delivery: 'main',
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
export type ModelOutputs = {
  interview: InterviewModelOutput;
  blueprint: BlueprintModelOutput;
  brief: BriefModelOutput;
  delivery: DeliveryModelOutput;
  'client-sim': ClientSimModelOutput;
  judge: JudgeModelOutput;
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
};

/** https origins the app may open from a user click. Mirrored verbatim in app/desktop/ipc-contract.cjs and app/renderer/app.js. */
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
  'https://tallysolutions.com', 'https://www.xero.com', 'https://quickbooks.intuit.com',
  'https://www.mca.gov.in', 'https://www.gst.gov.in', 'https://documenso.com', 'https://www.docusign.com', 'https://www.firstbase.io',
  'https://posthog.com', 'https://plausible.io', 'https://analytics.google.com', 'https://tally.so', 'https://www.typeform.com',
  'https://console.anthropic.com', 'https://platform.openai.com',
] as const);

// ---------------------------------------------------------------------------
// 8. Delivery agents, rehearsal (simulation), launch ladder, signals (P5)
// ---------------------------------------------------------------------------

export type StepKind = 'gather' | 'question' | 'compute' | 'write' | 'verify' | 'approve' | 'operator';
export type ExecutionTier = 'code' | 'actor' | 'wasm-lite' | 'wasm' | 'container' | 'hosted';
export const CHECK_IDS = ['no-numeric-prose', 'figures-resolve', 'required-sections', 'no-outside-writes', 'house-style', 'length-bounds', 'turn-limit', 'questions-raised', 'no-done-claims'] as const;
export type CheckId = typeof CHECK_IDS[number];
export type PlaybookStep = {
  id: string;
  kind: StepKind;
  title: string;
  tier: ExecutionTier; // this build runs 'code' and 'actor' only
  model: ModelTier | null; // null for code steps
  doneBy: 'agent' | 'you' | 'agent-then-you';
  requiredSections: string[]; // write steps only
  checks: CheckId[];
};
export type PlaybookRecord = RecordBase<'venture-playbook'> & {
  version: number;
  hash: string; // digest of steps; recorded on every run
  blueprintDigest: string;
  serviceType: ServiceType;
  steps: PlaybookStep[];
  validated: true;
  tierCeiling: ExecutionTier; // 'actor' in this build
};

export type TextPart =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; receiptId: string; figureKey: PriceFigure['key'] }
  | { kind: 'date'; dateRef: DateRef; iso: IsoDate };
/** A draft reply. Never called a deliverable on screen: agents in this build only draft. */
export type Deliverable = {
  title: string;
  sections: { heading: string; parts: TextPart[] }[];
  questionsForClient: string[];
};
export type CheckResult = { check: CheckId; passed: boolean; detail: string };

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
};
export const JUDGE_QUESTIONS = ['goal-met', 'tone-fits', 'policy-followed', 'no-unbacked-claims'] as const;
export type JudgeQuestionId = typeof JUDGE_QUESTIONS[number];
export type JudgeAnswer = { question: JudgeQuestionId; answer: 'yes' | 'no' | 'unsure' | 'not-judged'; reason: string; callId: string | null };
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
export type DeliveryRunStatus = 'waiting-for-you' | 'ready-for-review' | 'accepted' | 'edited' | 'rejected' | 'failed';
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
  status: 'planned'; // the improvement loop itself is not in this build
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
// 9. Events (the venture actor's broadcast log)
// ---------------------------------------------------------------------------

export const VENTURE_EVENTS = [
  'venture-created', 'retention-changed', 'interview-updated', 'blueprint-drafted', 'blueprint-accepted',
  'model-connected', 'model-disconnected', 'send-policy-changed',
  'price-quoted', 'client-added', 'order-created', 'order-delivered', 'invoice-prepared', 'invoice-issued', 'payment-recorded',
  'brief-ready', 'handoff-prepared', 'handoff-opened', 'repo-linked', 'repo-synced',
  'playbook-ready', 'simulation-finished', 'launch-stage-changed', 'delivery-waiting', 'delivery-ready', 'delivery-reviewed', 'signal-recorded',
] as const;
export type VentureEventName = typeof VENTURE_EVENTS[number];
export type VentureEventRecord = RecordBase<'venture-event'> & { seq: number; name: VentureEventName; data: Json };

export type AnyVentureRecord =
  | VentureRecord | InterviewRecord | BlueprintRecord | TermRecord | ModelConnectionRecord | ModelCallRecord
  | PriceReceiptRecord | ClientRecord | OrderRecord | InvoiceRecord | PaymentRecord
  | BriefRecord | HandoffRecord | BuildFollowRecord | GitHubReadRecord
  | PlaybookRecord | SimulationRunRecord | DeliveryRunRecord | SignalRecord | VentureEventRecord;
export type RecordOf<K extends VentureRecordKind> = Extract<AnyVentureRecord, { kind: K }>;

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
  // P4 build and connectors
  'venture.build.brief', 'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.sync', 'venture.build.status',
  'venture.connectors.list',
  // P5 delivery, rehearsal, launch, capabilities
  'venture.delivery.playbook', 'venture.simulation.scenarios', 'venture.simulation.run', 'venture.simulation.get', 'venture.simulation.fromSignal',
  'venture.launch.status', 'venture.launch.advance',
  'venture.delivery.run', 'venture.delivery.approve', 'venture.delivery.review', 'venture.delivery.list',
  'venture.capabilities',
] as const;
export type VentureMethod = typeof VENTURE_METHODS[number];
/** Answered without a vault, a model or any write. The engine routes them before its vault check. */
export const PRE_VAULT_METHODS: readonly VentureMethod[] = Object.freeze(['venture.countries', 'venture.preview'] as const);

export type VenturePackageId = 'core' | 'models' | 'money' | 'build' | 'delivery';
export const METHOD_OWNERS: Readonly<Record<VentureMethod, VenturePackageId>> = Object.freeze({
  'venture.countries': 'core', 'venture.preview': 'core', 'venture.create': 'core', 'venture.get': 'core', 'venture.events': 'core',
  'venture.interview.next': 'core', 'venture.interview.answer': 'core',
  'venture.blueprint.draft': 'core', 'venture.blueprint.get': 'core', 'venture.blueprint.update': 'core', 'venture.blueprint.accept': 'core',
  'venture.models.presets': 'models', 'venture.models.connect': 'models', 'venture.models.disconnect': 'models', 'venture.models.status': 'models', 'venture.models.calls': 'models',
  'venture.price.quote': 'money', 'venture.receipt.get': 'money', 'venture.client.add': 'money', 'venture.client.list': 'money',
  'venture.order.create': 'money', 'venture.order.list': 'money', 'venture.order.deliver': 'money',
  'venture.invoice.prepare': 'money', 'venture.invoice.issue': 'money', 'venture.invoice.get': 'money', 'venture.invoice.list': 'money',
  'venture.payment.record': 'money', 'venture.books.summary': 'money',
  'venture.build.brief': 'build', 'venture.build.handoff': 'build', 'venture.build.handoffOpened': 'build', 'venture.build.link': 'build', 'venture.build.sync': 'build', 'venture.build.status': 'build',
  'venture.connectors.list': 'build',
  'venture.delivery.playbook': 'delivery', 'venture.simulation.scenarios': 'delivery', 'venture.simulation.run': 'delivery', 'venture.simulation.get': 'delivery', 'venture.simulation.fromSignal': 'delivery',
  'venture.launch.status': 'delivery', 'venture.launch.advance': 'delivery',
  'venture.delivery.run': 'delivery', 'venture.delivery.approve': 'delivery', 'venture.delivery.review': 'delivery', 'venture.delivery.list': 'delivery',
  'venture.capabilities': 'delivery',
});
/** Methods that need a deliberate owner click inside the app (ctx.channel 'desktop', not source-tainted). */
export const APP_ONLY_METHODS: readonly VentureMethod[] = Object.freeze([
  'venture.create', 'venture.blueprint.accept', 'venture.models.connect', 'venture.invoice.issue', 'venture.payment.record',
  'venture.build.handoffOpened', 'venture.build.link', 'venture.launch.advance', 'venture.delivery.approve', 'venture.delivery.review',
] as const);
/** Methods whose success changes what saved answers may cite; the renderer adds them to evidenceChanges. */
export const EVIDENCE_METHODS: readonly VentureMethod[] = Object.freeze([
  'venture.create', 'venture.invoice.issue', 'venture.payment.record', 'venture.order.deliver',
] as const);

type Empty = Record<string, never>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type VenturePayloads = {
  'venture.countries': Empty;
  'venture.preview': { idea: string; countryCode: CountryCode; pricingModel?: PricingModel };
  'venture.create': { idea: string; countryCode: CountryCode; workingName?: string };
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
  'venture.order.create': { clientId: string; offerId: string; quantity?: string; request: string };
  'venture.order.list': Empty;
  'venture.order.deliver': { orderId: string; deliveredOn: IsoDate };
  'venture.invoice.prepare': { orderId: string; dueInDays?: number; issueDate?: IsoDate };
  'venture.invoice.issue': { invoiceId: string; digest: string };
  'venture.invoice.get': { invoiceId: string };
  'venture.invoice.list': Empty;
  'venture.payment.record': { invoiceId: string; amount: string; receivedOn: IsoDate; method: PaymentMethod };
  'venture.books.summary': { period?: BooksPeriodKey; from?: IsoDate; to?: IsoDate };
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
  'venture.receipt.get': PriceReceiptRecord;
  'venture.client.add': ClientRecord;
  'venture.client.list': ClientRecord[];
  'venture.order.create': OrderRecord;
  'venture.order.list': OrderRecord[];
  'venture.order.deliver': OrderRecord;
  'venture.invoice.prepare': InvoiceView;
  'venture.invoice.issue': InvoiceView;
  'venture.invoice.get': InvoiceView;
  'venture.invoice.list': InvoiceRecord[];
  'venture.payment.record': InvoiceView;
  'venture.books.summary': BooksSummary;
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
};

export type VentureStorage = 'experimental-file' | 'postgres';
export type VentureDeps = {
  store: StateStore;
  clock: () => Date;
  models: ModelPort;
  services: VentureEngineServices;
  github: GitHubTransport;
  secrets: SecretShelf;
  host: 'desktop' | 'local-web' | 'test';
  demo: boolean;
  storage: VentureStorage; // 'experimental-file' means every money screen shows the experimental notice
};

export type VentureHandler<M extends VentureMethod> = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<VentureResults[M]>;
export type VentureHandlerTable = { [M in VentureMethod]?: VentureHandler<M> };

/** What P6's host passes to P2's createModelPort. */
export type ModelPortOptions = {
  store: StateStore;
  clock: () => Date;
  transport: ModelTransport;
  secrets: SecretShelf;
  host: 'desktop' | 'local-web' | 'test';
  demo: boolean;
  codexCli?: unknown; // { capabilities, mode } from the trusted Codex host profile, when present
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
  host?: 'desktop' | 'local-web' | 'test';
  codexCli?: unknown; // { capabilities, mode } from the trusted Codex host profile, when present
  hostProcess?: (request: any) => Promise<any>; // the trusted host's verified process port (the gateway's process), when present
};
