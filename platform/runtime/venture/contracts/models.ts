// Venture models contract. Types only; public imports use ../contracts.ts.
import type { MODEL_PRESET_IDS, MODEL_PURPOSES } from '../contract-values.ts';
import type { Context } from '../../contracts.ts';
import type { ComposeModelOutput, DecideModelOutput } from '../onboarding-contracts.ts';
import type { IsoDate, IsoTime, Json, MicroString, RecordBase, ServiceType } from './business.ts';
import type { AttributionLevel, DelegateCli, JudgeQuestionId, PlaybookPatchOp } from './delivery.ts';

export type ModelPresetId = typeof MODEL_PRESET_IDS[number];

export type ModelRouteKind = 'anthropic-messages' | 'openai-responses' | 'claude-cli' | 'codex-cli' | 'template';

export type ModelTier = 'fast' | 'main';

export type ModelPurpose = typeof MODEL_PURPOSES[number];

export type ModelPriceTable = {
  currency: 'USD';
  inputMicrosPerMillion: MicroString; // micro-USD per million input tokens
  outputMicrosPerMillion: MicroString;
  /** D2: prompt cache prices, when saved; a reported cache read or write with no price here leaves the call's cost held. */
  cacheReadMicrosPerMillion?: MicroString;
  cacheWriteMicrosPerMillion?: MicroString;
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
  modelEditable: boolean; // OpenAI key and Codex options let the owner type an available model id
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
  agentId?: string; // trusted task role for owner-set spending limits
  agentJobId?: string; // exact native job receiving this quality charge
  /** W6 6G5: the routine and the routine run this call was made for (agents/routine-scope.ts); absent outside a routine. */
  routineId?: string; routineRunId?: string;
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
  consent: 'standing' | 'approved-preview' | 'standing-judge' | 'owner-file-drop' | 'client-ai';
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
  /** D2: inputTokens is the uncached input; the cache counts appear only when the provider reported more than zero. */
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number } | null;
  costMicros: MicroString | null; // null: failed before a price, or held (a reported cache kind has no saved price)
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
  /** A2: what the task chose to keep of its checked answer (ModelTask.keep), such as the offers About you answered. */
  kept?: Json;
};

/** One unit of model work. Built by P1, P4 and P5; executed by P2. */
export type ModelTask<T> = {
  purpose: ModelPurpose;
  agentId?: string; // set by trusted job composition, never model input
  agentJobId?: string; // stable job identity across repeated quality checks
  instructions: string; // system text
  input: Json; // user content, serialized as JSON text
  schemaName: string; // [a-z][a-z0-9-]{0,40}
  schema: Json; // JSON Schema: objects closed, every property required, no number or integer types
  validate: (raw: unknown) => T; // local authority; throws MODEL_OUTPUT_REJECTED
  /** A2: a small plain part of the checked answer kept on the call record (About you keeps its offers), at most 4096 characters as JSON. */
  keep?(value: T): Json;
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
  /** Trusted client permission captured when a scoped desk request is prepared. */
  clientAi?: import('../clients/ai-consent-core.ts').ClientAiContextBinding;
  callId: string;
  payloadText: string;
  digest: string;
  presetId: ModelPresetId;
  model: string | null;
  endpoint: string;
  estimatedMaxCostMicros: MicroString;
  estimatedMaxCostDisplay: string; // adds '(estimate, price unconfirmed)' when the table is unconfirmed
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
  runPreview<T>(ctx: Context, callId: string, approvedDigest: string, validate: (raw: unknown) => T, options?: { consent?: 'standing-judge' | 'owner-file-drop' | 'client-ai'; clientAi?: { clientId: string; consentId: string; consentRevision: number }; beforeDispatch?: () => void }): Promise<ModelOutcome<T>>;
  /**
   * Ink v2 wave 4 (4H1): looks at the owner's Claude Code or Codex on this computer through the transport (version,
   * help and, when its help lists one, its own sign-in status command) and keeps what it found for availability. Never
   * reads a sign-in file or a key. One look runs at a time per tool (a second asker joins it) and a look is reused for a
   * minute, unless options.fresh ("Check again"), which never reuses one. Optional so older test ports still type; the
   * engine's port always has it.
   */
  inspectCli?(cli: DelegateCli, options?: { fresh?: boolean }): Promise<CliFinding>;
  /** A2: the Codex setup in use, or a review of the Codex found on this computer; null without a Codex trust. */
  codexSetup?(): Promise<import('../core/first-run-types.ts').CodexSetupView | null>;
  /** A2: the native Codex program the setup in use names, for the agent route; null without one. */
  codexProgram?(): string | null;
  /** A2 review: the same program after its digest is checked again against the setup; refuses with no setup in use. */
  codexVerifiedProgram?(): Promise<string>;
  /** A2 review: what a tool printed on a failed call this session, screened; kept in memory only. */
  toolSaid?(callId: string): string | null;
  /** A2: the models Codex offers this account (codex debug models), and the ones Chausar uses; the fixed ids when unread. */
  codexModels?(): Promise<import('../models/codex-models.ts').CodexModels>;
  /** C7: Codex's own answer to the account's rate-limit read (a short app-server start, no thread, no turn); null when it could not be read. */
  codexPlan?(): Promise<unknown>;
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
  /** D4 task 6: answered from the file kept between starts: `at` is when it was really looked at, and the real look follows. */
  kept?: true;
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

export type DeliveryModelPart = { kind: 'text' | 'figure' | 'date'; text: string; ref: string };

// text is '' for figure and date parts; ref is '' for text parts
export type DeliveryModelOutput = {
  title: string;
  sections: { heading: string; parts: DeliveryModelPart[] }[]; // headings from REQUIRED_SECTIONS of the service type
  questionsForClient: string[]; // 0 to 3
};

export type ClientSimModelOutput = { message: string; asksForPerson: boolean };

export type JudgeModelOutput = { answers: { question: JudgeQuestionId; answer: 'yes' | 'no' | 'unsure'; reason: string }[] };

// one per JudgeQuestionId
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
