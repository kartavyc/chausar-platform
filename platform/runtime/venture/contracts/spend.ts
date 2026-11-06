// Venture spend contract. Types only; public imports use ../contracts.ts.
import type { IsoDate, IsoTime, MicroString, RecordBase } from './business.ts';
import type { WriteCapKind } from './views.ts';

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
  /** Exact provider model this token price covers; required for gateways and model overrides. */
  model?: string;
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
  agentUsage?: { provider: 'codex' | 'claude'; model: string; usage: import('../agent-runtime/driver-types.ts').AgentUsage };
  /** W6 6G5: the routine this call worked for, so its own monthly limit holds; absent outside a routine run. */
  routine?: string;
  /** SEO4: the delivery article whose atomic cost reservation this charge shares. */
  articleOrderId?: string;
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
  routineCaps?: { routine: string; capMicros: MicroString }[]; // W6 6G5: a routine's own monthly limit: past it only that routine pauses
  writeCaps?: Partial<Record<WriteCapKind, number>>; // the owner's daily caps on agent writes
  currencyLead?: CurrencyLead; // 4Z3: which currency leads spend; absent: 'auto'
};

/**
 * The owner's own rate for showing spend in rupees too: rupees per US dollar in ten-thousandths of a rupee (83.50 is
 * 835000), and the day the owner set it. Spend is still counted and capped in US dollars; rupees are shown, never kept.
 */
/** source (C5 task 15): where a rate came from when it is not the owner's own figure; setOn is then the figure's day. */
export type RupeeRate = { perUsd: string; setOn: IsoDate; source?: string };

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
  model?: string;
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
  /** C5 task 15: the offer of the reference rate shipped with this release; gone once it is in use. */
  reference?: { perUsd: string; on: IsoDate; line: Display; source: Display; url: string };
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
  /** W6 6G5 (D44): this month's spend of each agent and each routine, with the owner's cap on each. */
  meters?: SpendMetersView;
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

/**
 * W6 6G5 (D44): one agent's or one routine's spend this month (UTC, as the limits count it), worked out in code from the
 * charge records, with the sum receipt behind it. plan: runs on the owner's own Codex or Claude plan, counted, never
 * priced, and never in rupees. media: images and video Sunra quoted for this agent's runs this month, shown beside the
 * AI spend and not held against its cap (each already has its own approval card with its cost). cap: the owner's own
 * monthly limit, null when none; usedPermille null without one. paused: at or past it. line: where it stands in words.
 */
export interface SpendMeterRowView {
  scope: 'agent' | 'routine'; id: string; name: Display;
  used: Display; usedLead: SpendLead; receiptId: string;
  plan: Display | null; media?: Display;
  cap: Display | null; capUsd: string | null; capRupees?: Display; usedPermille: number | null; paused: boolean; line: Display;
}

export interface SpendMetersView { month: string; agents: SpendMeterRowView[]; routines: SpendMeterRowView[] }

/**
 * W6 6G5 (D44): what one run used, from its own records: the tool or model, the tier, the tokens the provider reported
 * (or that none were), and the cost when it is known. state: 'plan', on the owner's own Codex or Claude plan (cost says
 * so and carries no figure, never rupees); 'priced', code priced the reported use (receiptId behind it); 'estimate', held
 * at its estimate; 'unknown', not known yet; 'none', no AI was used. agent: who ran it, '(retired)' once off the team.
 * line: every part in one line, as the screen shows it.
 */
export interface ModelReceiptView {
  tool: Display; model: Display; tier: Display; usage: Display; cost: Display;
  state: 'plan' | 'priced' | 'estimate' | 'unknown' | 'none';
  receiptId?: string; costLead?: SpendLead; agent?: Display; line: Display;
}

/** 4F2 (M5): one agent's own monthly limit; past it only that agent is paused. */
export interface AgentCapView { agent: string; name: Display; capMicros: MicroString; capUsd: string; cap: Display; used: Display; paused: boolean; capRupees?: Display; usedRupees?: Display }

/** 4F2 (H32): one daily write cap: today's cap (raised once when the owner allowed more), what agents made today, in words. */
export interface WriteCapView { kind: WriteCapKind; configuredCap: number; cap: number; used: number; raised: boolean; line: Display }

/**
 * 4F2 (M6): one price on the rate card. confirmed: the owner's checked rate with its source and date; list: Chausar's
 * list price with the day it was checked. Prompt-cache reads and writes are lines of their own.
 */
export interface RateCardLine { item: string; label: Display; state: 'confirmed' | 'list'; price: Display; checked: Display; source: string; unconfirmed?: boolean }
