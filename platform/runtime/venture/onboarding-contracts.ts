// Chausar venture launcher: onboarding v2 contracts. Connect an AI first, before any vault. The ids and shapes of a
// plan composed from the block library stay here for vaults that already hold one; nothing composes a new one.
// Erasable TypeScript only (Node type stripping). Created first by P-engine; P-renderer and P-e2e-docs import it and
// never edit it. This file imports only types from contracts.ts, and contracts.ts imports only types from this file.
import type {
  CountryProfile, InterviewAnswer, IsoTime,
  Labelled, MinorString, ModelCallRecord, ModelConnectionRecord, ModelPreset, ModelPresetId, ModelStatusView, ModelTier,
  PricingModel, RecordBase, SecretShelf, ServiceType,
} from './contracts.ts';

import type { AboutBeforePayload, AboutRead, FamilyId, FamilyTile, ToolView, ToolsView } from './core/first-run-types.ts';

/** The onboarding methods. All are answered before the vault check by the engine's draft desk. contracts.ts lists them
 *  again as DRAFT_METHODS (a test pins the two lists equal); they are not PRE_VAULT_METHODS. */
export const ONBOARDING_METHODS = [
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status',
  'venture.country.suggest',
  'venture.ai.tools', 'venture.ai.login.start', 'venture.ai.login.cancel',
  'venture.about.read', 'venture.about.pick', 'venture.about.families',
  'venture.ai.reuse',
] as const;

// ---------------------------------------------------------------------------
// 1. The open box
// ---------------------------------------------------------------------------

/** The kind of sentence a composed plan was made from. */
export type PlanKind = 'idea' | 'skill' | 'problem';
export const OPEN_BOX_TEXT = Object.freeze({ min: 10, max: 2000 } as const);

// ---------------------------------------------------------------------------
// 2. Block library ids (who does each step, the approval words and the allowed pricing live in core/blocks.ts)
// ---------------------------------------------------------------------------

export const OFFER_BLOCK_IDS = ['retainer', 'subscription', 'one-off-project', 'package', 'audit', 'setup', 'session', 'course', 'hourly-help', 'done-for-you'] as const;
export type OfferBlockId = typeof OFFER_BLOCK_IDS[number];
export const STEP_BLOCK_IDS = ['collect-inputs', 'book-time', 'meet-client', 'hands-on-work', 'in-person-work', 'draft-reply', 'send', 'deliver-files', 'follow-up', 'get-paid'] as const;
export type StepBlockId = typeof STEP_BLOCK_IDS[number];
export const APPROVAL_BLOCK_IDS = ['each-draft', 'prices-invoices', 'posts-in-your-name', 'client-files'] as const;
export type ApprovalBlockId = typeof APPROVAL_BLOCK_IDS[number];
export const PAGE_BLOCK_IDS = ['home', 'offers-prices', 'how-it-works', 'start-request', 'booking', 'about', 'faq', 'portfolio', 'client-area', 'privacy-terms'] as const;
export type PageBlockId = typeof PAGE_BLOCK_IDS[number];
/** Connector catalogue ids a composed plan may hold as tools. Never a payments connector: the rail comes from the country. */
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

/** Code-owned identities for the largest registered flagship offer set. Owner-added offers have their own cap. */
export const OFFER_REFS = ['offer_1', 'offer_2', 'offer_3', 'offer_4', 'offer_5', 'offer_6', 'offer_7', 'offer_8', 'offer_9', 'offer_10', 'offer_11', 'offer_12', 'offer_13', 'offer_14'] as const;
export type OfferRef = typeof OFFER_REFS[number];
export const PAGE_REFS = ['page_1', 'page_2', 'page_3', 'page_4', 'page_5', 'page_6'] as const;
export type PageRef = typeof PAGE_REFS[number];
export const QUESTION_REFS = ['q_1', 'q_2'] as const;
export type QuestionRef = typeof QUESTION_REFS[number];

/**
 * Most words code accepts in each model field of a composed plan, counted like the renderer's words-at-rest test
 * (split on spaces, count pieces holding a letter or a digit). A longer answer is MODEL_OUTPUT_REJECTED.
 */
export const WORD_CAPS = Object.freeze({
  name: 4, oneLiner: 24, customer: 24, offerName: 4, offerDescription: 30, stepTitle: 4,
} as const);

// ---------------------------------------------------------------------------
// 3. The views of a composed plan
// ---------------------------------------------------------------------------

export const VIEW_IDS = ['offers-first', 'steps-first', 'audience-first', 'pages', 'tools', 'questions', 'notes'] as const;
export type ViewId = typeof VIEW_IDS[number];
export type ViewSelection =
  | { id: Exclude<ViewId, 'audience-first'>; lead: string[] }
  | { id: 'audience-first'; who: Labelled<string>; pain: Labelled<string> };

// ---------------------------------------------------------------------------
// 4. What the model returned for a composed plan (words and enums only), as a stored composition keeps it
// ---------------------------------------------------------------------------

export type ViewSlotOutput = { lead: string[] } | { who: string; pain: string };
/** What the 'compose' call answered. views has exactly the decided view ids as keys. */
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

// ---------------------------------------------------------------------------
// 5. The parts of a composed plan a stored blueprint carries, and the note about a dropped file
// ---------------------------------------------------------------------------

export type WrittenBy = { presetId: ModelPresetId; model: string | null; replay: boolean };
export type ComposedPage = { id: PageRef; block: PageBlockId; title: Labelled<string>; purpose: Labelled<string> };
export type ComposedNote = { block: NoteBlockId; text: string };

/**
 * The file the owner dropped with a sentence: its name, whether it went with the model calls (as background only),
 * and, when it was left out, the plain line that says why and its reason, so a screen can say it in its own words
 * (Hindi too): words aimed at the AI, hidden characters, or a file the screen could not check.
 */
export type ComposeAttachmentNote = { name: string; used: boolean; line: string | null; reason: 'injection' | 'hidden' | 'error' | null };

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
    why: "OpenAI lets only open-source tools, personal projects that run locally and apps it picks use a ChatGPT plan. Chausar is a commercial app and hasn't been picked yet. Use an OpenAI key for now.",
  },
});
export type AiOption = {
  id: AiOptionId;
  label: string;
  line: string;
  why: string;
  status: AiOptionStatus; // the weakest of the row's presets, by AI_STATUS_ORDER
  canConnect: boolean; // always false for chatgpt-sign-in; disabled Claude Code is omitted from the options
  presetIds: ModelPresetId[]; // [] for chatgpt-sign-in
  recommended: { fast: ModelPresetId; main: ModelPresetId } | null; // api-key: Haiku fast, Sonnet main
};
export type AiStatusView = ModelStatusView & {
  scope: 'before-vault';
  /** When the draft AI is wiped if no draft request touches it; null when nothing is connected or the timer is paused. */
  idleUntil: IsoTime | null;
};
/**
 * venture.ai.reuse {}: the status of a new draft after the AI the owner already connected in another business on this
 * computer was connected in it (Codex or Claude Code only; a key never leaves its vault). reused names that business,
 * or is null when nothing carried over: no such setup, a gate that connect runs failed, or the words agreed to changed.
 */
export type AiReuseView = AiStatusView & { reused: { from: string } | null };
export type AiOptionsView = {
  options: AiOption[];
  presets: ModelPreset[]; // with live availability; an explicit pending override omits Claude Code
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
  planDigest: string; // the digest of the plan the owner kept
};

/**
 * reused: the setup venture.ai.reuse connected in this draft (models/ai-setup.ts AiSetupNote), while one of its
 * connections is still connected: the new business takes the agents' models from it and notes where its AI came from.
 */
export type DraftAi = { connections: ModelConnectionRecord[]; calls: ModelCallRecord[]; reused?: import('./models/ai-setup.ts').AiSetupNote };
/** Trusted host composition (engine to venture host to deps), never from a payload. */
export interface DraftHandoverPort {
  /** Connected draft connections and every draft call, or null when nothing is connected and no call was made. */
  ai(): DraftAi | null;
  /** Copies every model:<presetId> key to the vault's shelf. Call only after the vault write committed. */
  moveKeys(target: SecretShelf): void;
  /** Wipes the draft: keys and records. */
  settle(): void;
}

// ---------------------------------------------------------------------------
// 8. Payloads and results of the draft methods (contracts.ts copies them into VenturePayloads and VentureResults)
// ---------------------------------------------------------------------------

export type CountrySuggestion = { country: Pick<CountryProfile, 'code' | 'name' | 'currency'> | null; evidence: string | null; source: 'ai' | 'not-connected' };

export type OnboardingPayloads = {
  'venture.country.suggest': { text: string };
  'venture.ai.options': Record<string, never>;
  'venture.ai.connect': { presetId: ModelPresetId; consentDigest: string; apiKey?: string; model?: string; tiers?: ModelTier[]; monthlyCapUsd?: string };
  'venture.ai.disconnect': { connectionId: string };
  'venture.ai.status': Record<string, never>;
  'venture.ai.tools': Record<string, never>;
  'venture.ai.login.start': { cli: 'codex' | 'claude-code' };
  'venture.ai.login.cancel': { cli: 'codex' | 'claude-code' };
  'venture.about.read': { text?: string; attachment?: { name: string; kind: 'resume-pdf' | 'linkedin-zip'; contentBase64: string }; before?: AboutBeforePayload };
  'venture.about.pick': { familyId: FamilyId; text?: string };
  'venture.about.families': Record<string, never>;
  'venture.ai.reuse': Record<string, never>;
};
export type OnboardingResults = {
  'venture.country.suggest': CountrySuggestion;
  'venture.ai.options': AiOptionsView;
  'venture.ai.connect': AiStatusView;
  'venture.ai.disconnect': AiStatusView;
  'venture.ai.status': AiStatusView;
  'venture.ai.tools': ToolsView;
  'venture.ai.login.start': ToolView;
  'venture.ai.login.cancel': ToolView;
  'venture.about.read': AboutRead;
  'venture.about.pick': AboutRead;
  'venture.about.families': { families: FamilyTile[] };
  'venture.ai.reuse': AiReuseView;
};
