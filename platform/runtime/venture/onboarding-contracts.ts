// Chausar venture launcher: onboarding v2 contracts. Connect an AI first, one open box, a plan composed from a checked
// library of blocks and drawn through a fixed view registry. The AI picks and writes words; code checks and draws.
// Erasable TypeScript only (Node type stripping). Created first by P-engine; P-renderer and P-e2e-docs import it and
// never edit it. This file imports only types from contracts.ts, and contracts.ts imports only types from this file.
import type {
  BackOffice, BlueprintStep, ConnectorCard, CountryCode, CountryProfile, InterviewAnswer, InterviewQuestion, IsoTime,
  Labelled, MinorString, ModelCallRecord, ModelConnectionRecord, ModelPreset, ModelPresetId, ModelStatusView, ModelTier,
  Offer, PricingModel, RecordBase, SecretShelf, ServiceType,
} from './contracts.ts';

export const ONBOARDING_CONTRACT_VERSION = 'chausar.dev/venture-onboarding/v1alpha2' as const;

/** The nine new methods. All are answered before the vault check by the engine's draft desk. contracts.ts lists them
 *  again as DRAFT_METHODS (a test pins the two lists equal); they are not PRE_VAULT_METHODS. */
export const ONBOARDING_METHODS = [
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.ai.calls',
  'venture.compose.decide', 'venture.compose.fill', 'venture.compose.get', 'venture.compose.update',
] as const;
export type OnboardingMethod = typeof ONBOARDING_METHODS[number];

// ---------------------------------------------------------------------------
// 1. The open box
// ---------------------------------------------------------------------------

export const OPEN_BOX_KINDS = ['idea', 'skill', 'problem', 'not-a-service'] as const;
export type OpenBoxKind = typeof OPEN_BOX_KINDS[number];
export type PlanKind = Exclude<OpenBoxKind, 'not-a-service'>;
export const KIND_LABELS: Readonly<Record<PlanKind, string>> = Object.freeze({
  idea: 'Your idea, as a service', skill: 'Your skill, as a service', problem: 'A service that fixes this',
});
export const NOT_A_SERVICE_WORDS = 'Chausar plans services you sell to other people. Try saying what you could do for them.';
export const COMPOSE_REFUSED_WORDS = "The AI's answer failed Chausar's checks again. No plan was saved. Both tries are listed under What was sent.";
export const OPEN_BOX_TEXT = Object.freeze({ min: 10, max: 2000 } as const);

// ---------------------------------------------------------------------------
// 2. Block library ids (meanings, who does each step and fixed words live in core/blocks.ts)
// ---------------------------------------------------------------------------

export const BLOCK_KINDS = ['offer', 'step', 'approval', 'page', 'tool', 'question', 'note'] as const;
export type BlockKind = typeof BLOCK_KINDS[number];
export const OFFER_BLOCK_IDS = ['retainer', 'subscription', 'one-off-project', 'package', 'audit', 'setup', 'session', 'course', 'hourly-help', 'done-for-you'] as const;
export type OfferBlockId = typeof OFFER_BLOCK_IDS[number];
export const STEP_BLOCK_IDS = ['collect-inputs', 'book-time', 'meet-client', 'hands-on-work', 'in-person-work', 'draft-reply', 'send', 'deliver-files', 'follow-up', 'get-paid'] as const;
export type StepBlockId = typeof STEP_BLOCK_IDS[number];
export const APPROVAL_BLOCK_IDS = ['each-draft', 'prices-invoices', 'posts-in-your-name', 'client-files'] as const;
export type ApprovalBlockId = typeof APPROVAL_BLOCK_IDS[number];
export const PAGE_BLOCK_IDS = ['home', 'offers-prices', 'how-it-works', 'start-request', 'booking', 'about', 'faq', 'portfolio', 'client-area', 'privacy-terms'] as const;
export type PageBlockId = typeof PAGE_BLOCK_IDS[number];
/** Connector catalogue ids the composer may pick. Never a payments connector: the rail comes from the country. */
export const TOOL_BLOCK_IDS = [
  'mail-app', 'google-workspace', 'zoho-mail', 'cal-com', 'calendly', 'google-calendar', 'chausar-crm', 'hubspot', 'zoho-crm', 'attio',
  'whatsapp', 'telegram', 'slack', 'discord', 'notion', 'google-drive', 'linear', 'airtable', 'linkedin', 'x', 'instagram', 'buffer',
  'chausar-books', 'zoho-books', 'tally', 'xero', 'quickbooks-online', 'tally-forms', 'typeform',
] as const;
export type ToolBlockId = typeof TOOL_BLOCK_IDS[number];
export const QUESTION_BLOCK_IDS = ['customer', 'first-offer', 'channel', 'area', 'hours', 'experience', 'tools-you-use'] as const;
export type QuestionBlockId = typeof QUESTION_BLOCK_IDS[number];
export const NOTE_BLOCK_IDS = ['licence-may-apply', 'insurance', 'personal-data', 'children-or-care', 'regulated-advice', 'safety'] as const;
export type NoteBlockId = typeof NOTE_BLOCK_IDS[number];

export const OFFER_REFS = ['offer_1', 'offer_2', 'offer_3'] as const;
export type OfferRef = typeof OFFER_REFS[number];
export const STEP_REFS = ['step_1', 'step_2', 'step_3', 'step_4', 'step_5', 'step_6'] as const;
export type StepRef = typeof STEP_REFS[number];
export const PAGE_REFS = ['page_1', 'page_2', 'page_3', 'page_4', 'page_5', 'page_6'] as const;
export type PageRef = typeof PAGE_REFS[number];
export const QUESTION_REFS = ['q_1', 'q_2'] as const;
export type QuestionRef = typeof QUESTION_REFS[number];

/** Counts code enforces after the model answers; a schema here cannot carry counts. [min, max]. */
export const BLOCK_LIMITS = Object.freeze({
  offers: [1, 3], steps: [3, 6], approvals: [1, 4], pages: [4, 6], tools: [2, 6], questions: [0, 2], notes: [0, 3],
} as const);
/** Longest text, in characters, code accepts in each model field. */
export const WORD_LIMITS = Object.freeze({
  reading: 90, name: 60, oneLiner: 160, customer: 200, offerName: 60, offerDescription: 200, stepTitle: 80,
  pageTitle: 40, pagePurpose: 160, toolReason: 120, questionText: 160, choice: 60, who: 120, pain: 160,
} as const);
/**
 * Most words code accepts in each model field, counted like the renderer's words-at-rest test (split on spaces, count
 * pieces holding a letter or a digit). They keep every onboarding screen within 45 words at rest with the longest
 * answers allowed. A longer answer is MODEL_OUTPUT_REJECTED, so the repair path handles it.
 */
export const WORD_CAPS = Object.freeze({
  reading: 12, name: 4, oneLiner: 24, customer: 24, offerName: 4, offerDescription: 30, stepTitle: 4,
  pageTitle: 4, pagePurpose: 24, toolReason: 18, questionText: 20, choice: 5, who: 7, pain: 8,
} as const);

// ---------------------------------------------------------------------------
// 3. The view registry
// ---------------------------------------------------------------------------

export const VIEW_IDS = ['offers-first', 'steps-first', 'audience-first', 'pages', 'tools', 'questions', 'notes'] as const;
export type ViewId = typeof VIEW_IDS[number];
export type ViewShape = 'cards' | 'flow' | 'statement' | 'site' | 'chips' | 'asks' | 'lines';
export type ViewSpec = {
  id: ViewId;
  role: 'lead' | 'support';
  /** Fixed words shown above the view. */
  heading: string;
  /** What the decide model reads: what the view is for, and what it is not for. */
  pick: string;
  draws: 'offers' | 'steps' | 'audience' | 'pages' | 'tools' | 'questions' | 'notes';
  slot: 'lead-refs' | 'audience';
  /** How many items the model names as the view's lead items, [min, max], for a lead-refs slot; [0, 0] for audience.
   *  A lead view shows exactly these at rest; a support view shows them first when its fold opens. */
  lead: readonly [number, number];
  outline: { shape: ViewShape; rows: number };
};
export const VIEW_REGISTRY: readonly ViewSpec[] = Object.freeze([
  { id: 'offers-first', role: 'lead', heading: 'What you sell', draws: 'offers', slot: 'lead-refs', lead: [1, 2], outline: { shape: 'cards', rows: 2 },
    pick: 'Lead with the offers when the person already knows what they would sell. Not for a skill with no clear offer yet, and not for a problem.' },
  { id: 'steps-first', role: 'lead', heading: 'How the work gets done', draws: 'steps', slot: 'lead-refs', lead: [2, 3], outline: { shape: 'flow', rows: 3 },
    pick: 'Lead with the steps when the work itself is the point, such as a skill the person has. Not when the person described a problem.' },
  { id: 'audience-first', role: 'lead', heading: 'Who it helps', draws: 'audience', slot: 'audience', lead: [0, 0], outline: { shape: 'statement', rows: 2 },
    pick: 'Lead with who it helps and what goes wrong for them when the person described a problem. Not for a plain idea or skill.' },
  { id: 'pages', role: 'support', heading: 'Your website', draws: 'pages', slot: 'lead-refs', lead: [2, 3], outline: { shape: 'site', rows: 3 },
    pick: 'Show the website pages when clients will find, book or pay the business online.' },
  { id: 'tools', role: 'support', heading: 'Tools to connect', draws: 'tools', slot: 'lead-refs', lead: [1, 3], outline: { shape: 'chips', rows: 3 },
    pick: 'Show the tools when the work depends on a calendar, an inbox, a chat app or shared files.' },
  { id: 'questions', role: 'support', heading: 'Quick questions', draws: 'questions', slot: 'lead-refs', lead: [1, 2], outline: { shape: 'asks', rows: 2 },
    pick: 'Ask short questions only when an answer would change the plan, such as where the person works or who for. Not to ask about prices.' },
  { id: 'notes', role: 'support', heading: 'Check before you start', draws: 'notes', slot: 'lead-refs', lead: [1, 2], outline: { shape: 'lines', rows: 2 },
    pick: 'Show notes when the work may need a licence, insurance, care with personal details, checks for work with children, or safety rules.' },
]);
/** How many views decide may pick: one lead view first, then support views. */
export const VIEW_PICKS = Object.freeze({ min: 2, max: 4 } as const);

export type ViewSelection =
  | { id: Exclude<ViewId, 'audience-first'>; lead: string[] }
  | { id: 'audience-first'; who: Labelled<string>; pain: Labelled<string> };

// ---------------------------------------------------------------------------
// 4. What the model returns (words and enums only; no number anywhere, in digits or in words)
// ---------------------------------------------------------------------------

/** Purpose 'decide' (fast tier), schema 'venture-decide'. */
export type DecideModelOutput = { kind: OpenBoxKind; family: ServiceType; reading: string; views: ViewId[] };
export type ViewSlotOutput = { lead: string[] } | { who: string; pain: string };
/** Purpose 'compose' (main tier), schema 'venture-compose'. views has exactly the decided view ids as keys. */
export type ComposeModelOutput = {
  name: string;
  oneLiner: string;
  customer: string;
  offers: { block: OfferBlockId; name: string; description: string; pricingModel: PricingModel }[];
  steps: { block: StepBlockId; title: string }[];
  approvals: ApprovalBlockId[];
  pages: { block: PageBlockId; title: string; purpose: string }[];
  tools: { block: ToolBlockId; reason: string }[];
  questions: { block: QuestionBlockId; kind: 'choice' | 'text'; text: string; choices: string[] }[];
  notes: NoteBlockId[];
  views: Record<string, ViewSlotOutput>;
};
/** Put in task.input as "marker". Quote-free, so replay mustInclude matches HTTP bodies and CLI stdin alike. */
export const ONBOARDING_MARKERS = Object.freeze({
  decide: 'chausar-decide-v1', redecide: 'chausar-redecide-v1', compose: 'chausar-compose-v1', recompose: 'chausar-recompose-v1',
} as const);
export const ONBOARDING_SCHEMAS = Object.freeze({ decide: 'venture-decide', compose: 'venture-compose' } as const);
export const ONBOARDING_MAX_OUTPUT = Object.freeze({ decide: 512, compose: 4096 } as const);

// ---------------------------------------------------------------------------
// 5. The composed plan (engine-held before the vault; the renderer draws it, never sends it back)
// ---------------------------------------------------------------------------

export type WrittenBy = { presetId: ModelPresetId; model: string | null; replay: boolean };
/** allowedPricing is OFFER_BLOCKS[block].allowed, copied here for the renderer; after the vault it is derived from block. */
export type ComposedOffer = Offer & { block: OfferBlockId; allowedPricing: PricingModel[]; priceDisplay: string | null };
export type ComposedStep = BlueprintStep & { block: StepBlockId };
export type ComposedApproval = Labelled<string> & { block: ApprovalBlockId };
export type ComposedPage = { id: PageRef; block: PageBlockId; title: Labelled<string>; purpose: Labelled<string> };
export type ComposedTool = { block: ToolBlockId; reason: Labelled<string>; card: ConnectorCard };
export type ComposedQuestion = InterviewQuestion & { block: QuestionBlockId; answer: InterviewAnswer | null };
export type ComposedNote = { block: NoteBlockId; text: string };

export type ComposeDecision = {
  composeId: string;
  text: string;
  country: CountryProfile;
  kind: OpenBoxKind;
  family: Labelled<ServiceType> | null; // null for not-a-service
  reading: Labelled<string> | null; // null for not-a-service
  views: ViewId[]; // [] for not-a-service
  refusal: string | null; // NOT_A_SERVICE_WORDS for not-a-service
  callIds: string[]; // draft call ids, one or two
  writtenBy: WrittenBy;
  at: IsoTime;
};
export type ComposedPlan = {
  composeId: string;
  digest: string; // digest of the plan without composeId and digest; venture.create checks it
  text: string;
  country: CountryProfile;
  kind: PlanKind;
  kindLabel: string;
  family: Labelled<ServiceType>;
  familyLabel: string;
  reading: Labelled<string>;
  views: ViewSelection[];
  name: Labelled<string>;
  oneLiner: Labelled<string>;
  customer: Labelled<string>;
  offers: ComposedOffer[]; // 1 to 3, offer_1..
  steps: ComposedStep[]; // 3 to 6, step_1..
  approvals: ComposedApproval[];
  pages: ComposedPage[]; // 4 to 6
  tools: ComposedTool[]; // 2 to 6
  questions: ComposedQuestion[]; // 0 to 2, q_1..
  notes: ComposedNote[];
  backOffice: BackOffice;
  taxQuestion: InterviewQuestion; // the engine's tax question for the country
  taxRateQuestion: InterviewQuestion; // shown after a yes
  calls: { decide: string[]; compose: string[] };
  writtenBy: WrittenBy; // the main tier
  by: 'model';
  saved: false;
};
export type ComposeState = { decision: ComposeDecision; plan: ComposedPlan | null };
export type ComposePatch = {
  countryCode?: CountryCode;
  offers?: { id: OfferRef; unitPrice?: string | null; pricingModel?: PricingModel }[];
  taxRegistered?: boolean;
  taxRate?: string;
  answers?: { questionId: QuestionRef; answer: InterviewAnswer }[];
};

// ---------------------------------------------------------------------------
// 6. Connecting an AI before the vault
// ---------------------------------------------------------------------------

export const AI_OPTION_IDS = ['api-key', 'claude-code', 'codex', 'chatgpt-sign-in'] as const;
export type AiOptionId = typeof AI_OPTION_IDS[number];
export type AiOptionStatus = 'ready' | 'unverified' | 'needs-setup' | 'unavailable' | 'not-open';
/** Strongest first. A row's status is the weakest status among its presets. */
export const AI_STATUS_ORDER: readonly AiOptionStatus[] = Object.freeze(['ready', 'unverified', 'needs-setup', 'unavailable', 'not-open']);
/** The words a row shows at rest. Both connectable statuses say only what the code does: it can connect. */
export const AI_STATUS_CHIPS: Readonly<Record<AiOptionStatus, string>> = Object.freeze({
  ready: 'Can connect', unverified: 'Can connect', 'needs-setup': 'Needs setup', unavailable: 'Not here', 'not-open': 'Not open yet',
});
/** Shown once under the rows, at rest, when AiOptionsView.unchecked is true. */
export const AI_UNCHECKED_LINE = 'Not yet checked with a live account.';
/** Shown when the first call of the recommended pair connected and the second did not. */
export const AI_HALF_CONNECTED_WORDS = 'Connected for quick work only.';
/** Fixed words for the Connect rows. Every label matches what the code does; ChatGPT can never connect. */
export const AI_OPTION_WORDS: Readonly<Record<AiOptionId, { label: string; line: string; why: string }>> = Object.freeze({
  'api-key': {
    label: 'Paste an API key', line: 'You pay the AI company directly.',
    why: "Anthropic: one key runs Claude Haiku 5.5 for quick work and Sonnet 5.5 for plans. OpenAI: GPT-6 Luna. A Claude Max or Team plan's monthly API credits work through a key too.",
  },
  'claude-code': {
    label: 'Claude Code on this computer', line: 'Uses your Claude plan through Claude Code.',
    why: 'Sign in inside Claude Code first. Chausar never sees your login. Plans have limits made for one person, so heavy use can be cut off.',
  },
  codex: {
    label: 'Codex on this computer', line: 'Uses the sign-in you already have in Codex.',
    why: "OpenAI hasn't said yet that apps like Chausar may use a ChatGPT plan this way. It needs the reviewed Codex install on this computer.",
  },
  'chatgpt-sign-in': {
    label: 'Sign in with ChatGPT', line: 'Not open to Chausar yet.',
    why: "OpenAI lets only open-source tools, personal hobby projects and partners it picks use a ChatGPT plan. Chausar is a commercial app and hasn't been approved yet. Use an OpenAI key for now.",
  },
});
export type AiOption = {
  id: AiOptionId;
  label: string;
  line: string;
  why: string;
  status: AiOptionStatus; // the weakest of the row's presets, by AI_STATUS_ORDER
  canConnect: boolean; // always false for chatgpt-sign-in, and for claude-code while the terms gate is pending
  presetIds: ModelPresetId[]; // [] for chatgpt-sign-in
  recommended: { fast: ModelPresetId; main: ModelPresetId } | null; // api-key: Haiku fast, Sonnet main
};
export type AiStatusView = ModelStatusView & {
  scope: 'before-vault';
  /** When the draft AI is wiped if no draft request touches it; null when nothing is connected or the timer is paused. */
  idleUntil: IsoTime | null;
};
export type AiOptionsView = {
  options: AiOption[];
  presets: ModelPreset[]; // with live availability, including the Claude Code terms gate
  status: AiStatusView;
  /** True when any row that can connect holds a preset with verification 'not-live-verified'. */
  unchecked: boolean;
};
export const DRAFT_IDLE_MS = 3_600_000;

// ---------------------------------------------------------------------------
// 7. The composition record and the handover into the vault
// ---------------------------------------------------------------------------

export type CompositionRecord = RecordBase<'venture-composition'> & {
  composeId: string;
  text: string;
  textDigest: string;
  /** The open-box kind. Named planKind because `kind` is the record kind from RecordBase ('venture-composition'). */
  planKind: PlanKind;
  family: ServiceType;
  reading: string;
  views: ViewSelection[];
  output: ComposeModelOutput; // the validated, tidied model output
  pricing: { id: OfferRef; model: PricingModel; unitPriceMinor: MinorString | null }[]; // the owner's choices before the vault
  answers: { questionId: QuestionRef; answer: InterviewAnswer }[];
  decideCallIds: string[];
  composeCallIds: string[];
  writtenBy: WrittenBy;
  planDigest: string; // the ComposedPlan digest the owner kept
};

export type DraftAi = { connections: ModelConnectionRecord[]; calls: ModelCallRecord[] };
export type DraftCompose = { decision: ComposeDecision; decideOutput: DecideModelOutput; output: ComposeModelOutput; plan: ComposedPlan };
/** Trusted host composition (engine to venture host to deps), never from a payload. */
export interface DraftHandoverPort {
  /** Connected draft connections and every draft call, or null when nothing is connected and no call was made. */
  ai(): DraftAi | null;
  /** The held session when it has a plan and its id matches, else null. */
  compose(composeId: string): DraftCompose | null;
  /** Copies every model:<presetId> key to the vault's shelf. Call only after the vault write committed. */
  moveKeys(target: SecretShelf): void;
  /** Wipes the draft: keys, records and session. */
  settle(): void;
}

// ---------------------------------------------------------------------------
// 8. Payloads and results of the nine methods (contracts.ts copies them into VenturePayloads and VentureResults)
// ---------------------------------------------------------------------------

export type OnboardingPayloads = {
  'venture.ai.options': Record<string, never>;
  'venture.ai.connect': { presetId: ModelPresetId; consentDigest: string; apiKey?: string; model?: string; tiers?: ModelTier[]; monthlyCapUsd?: string };
  'venture.ai.disconnect': { connectionId: string };
  'venture.ai.status': Record<string, never>;
  'venture.ai.calls': { limit?: number };
  'venture.compose.decide': { text: string; countryCode: CountryCode };
  'venture.compose.fill': { composeId: string };
  'venture.compose.get': Record<string, never>;
  'venture.compose.update': { composeId: string; patch: ComposePatch };
};
export type OnboardingResults = {
  'venture.ai.options': AiOptionsView;
  'venture.ai.connect': AiStatusView;
  'venture.ai.disconnect': AiStatusView;
  'venture.ai.status': AiStatusView;
  'venture.ai.calls': ModelCallRecord[];
  'venture.compose.decide': ComposeDecision;
  'venture.compose.fill': ComposedPlan;
  'venture.compose.get': ComposeState | null;
  'venture.compose.update': ComposedPlan;
};
