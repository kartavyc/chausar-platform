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
export type QueueActionId = 'approve' | 'deny' | 'later' | 'watch' | 'read' | 'answer' | 'send-to-ca' | 'open' | 'connect' | 'set-prices' | 'keep' | 'issue' | 'run-again'
  | 'sent' | 'continue' | 'stop' | 'resume'; // Ink v2 wave 4: "I sent it" (4E), the round gate and run controls (4F)
export interface QueueAction { id: QueueActionId; label: string; primary: boolean; secondAsk?: boolean; requiresView?: boolean }
export interface QueueChange { label?: string; before?: Display; after: Display; receiptId?: string; estimate?: boolean }
export type QueueKind = 'draft' | 'price' | 'quote' | 'plan' | 'invoice' | 'signoff' | 'question' | 'setup' | 'locked' | 'connector' | 'bank'
  // W4 4C2: a step Chausar proposed in Chats, raised to Today by the owner (chief/rows.ts).
  | 'proposal'
  // W4 4E4: a follow-up due by date (network/followup-rows.ts), a reply that waits on the owner (network/inbound-rows.ts),
  // and a notice (the "Add notes" after a call there; 4G2's needs-you probes, views/probes.ts).
  | 'followup' | 'reply' | 'notice';
export interface QueueRow {
  id: string; businessId: string; businessName: string; agent?: string; kind: QueueKind;
  title: string; line?: string; change?: QueueChange; digest: string; createdAt: string;
  actions: QueueAction[]; // one or two; exactly one primary
  viewRef?: { kind: 'draft' | 'file' | 'run' | 'plan'; id: string };
  /** Only on rows that propose an outside action (W1 H21): false when part of what it will send is not shown. */
  descriptionComplete?: boolean;
  // Ink v2 wave 4 (4J1 meta, 4J3 previews): each absent until the engine has something real to say.
  meta?: QueueRowMeta;
  sendsTo?: QueueSendsTo;
  attempt?: { n: number; lastError: Display | null };
  counts?: QueueCount[];
  price?: { display: Display; receiptId: string; line: Display; free?: Display };
  changeCount?: { line: Display; details: Display[]; coverage: Display };
  preview?: QueuePreview;
  /** 4J1: each amount the line, change, price or change details state, exactly as written there, with its proof. */
  amounts?: QueueAmount[];
  /** 4E1: a follow-up row's parts, for the screen's own words. */
  followup?: { cardId: string; name: string; company: string | null; due: string; daysLate: number; channel: 'email' | 'linkedin' | 'whatsapp' | null; draftId: string | null };
  /** 4E3: a reply row's parts (and a meeting-notes notice's): why it waits, who, the card, the topics, and for a handoff the address and subject. */
  reply?: {
    inboundId: string | null; reason: 'confirm' | 'talking' | 'owner-reply' | 'bot-question' | 'meeting-notes' | 'opt-out' | 'bounce-domain';
    name: string; company: string | null; opportunityId: string | null; eventId: string | null; topics: ('price' | 'contract' | 'meeting' | 'buying')[];
    from: string | null; subject: string | null; draft: string | null;
  };
  /** 4E3: what Approve needs as its answer: the day, for a next step drafted from notes that wrote none. */
  needs?: { answer: 'day'; line: Display };
  /**
   * 4G2: a needs-you probe's notice: which probe, how much it matters, the screen Open goes to (an address such as
   * #/connections), and each amount its line states, exactly as written there, with its receipt, in order.
   */
  notice?: { probe: 'post' | 'connection' | 'drafts' | 'calendar' | 'moved' | 'stalled' | 'idea'; severity: 'high' | 'medium' | 'low'; link: string; figures?: { text: Display; receiptId: string }[] };
}
/**
 * The row kinds Ink v2 wave 4 adds on the engine (4C1 proposal, 4E1 followup, 4E3 reply, 4G2 notice). W3's states.ts
 * keys a Record on QueueKind, so the U package that first shows a kind folds it into QueueKind together with its words
 * (4C2 folded 'proposal'; 4E4 and 4J19 the others).
 */
export type QueueKindW4 = 'proposal' | 'followup' | 'reply' | 'notice';
/** 4J1: where an approved row's action goes. */
export type QueueSendsTo = 'client' | 'public' | 'bank' | 'portal';
/** 4J1: client, business and time; expiresAt only from a real expiry; waitingLong after a day; staleDraft after 14 days. */
export interface QueueRowMeta { client: string | null; business: string; at: string; expiresAt?: string; waitingLong?: Display; staleDraft?: Display; quoteFixes?: Display[] }
export interface QueueCount { label: Display; count: number; limit: number }
/**
 * 4J1: one amount a row states, each occurrence its own: text is field.slice(start, start + length) in its field (the
 * line, change.before, change.after, the price, or changeCount.details[index]), in UTF-16 code units. Its proof is a
 * receipt (venture.receipt.get) or the model-estimate label, never both. Wrap exactly that span in a Figure.
 */
export type QueueAmount = { text: Display; where: 'line' | 'change.before' | 'change.after' | 'price' | 'details'; index?: number; start: number; length: number }
  & ({ receiptId: string; estimate?: never } | { estimate: true; receiptId?: never });
/**
 * 4J3: what a card shows before it is opened, from the owner's own records only (engine views/previews.ts). A field
 * without its source is left out; a preview never carries a made-up image, and drawing one never counts as viewed.
 * Every amount is a PreviewFigure with its receipt; words a model wrote are PreviewWords, shown with "model estimate"
 * when estimate is set. video.poster.src is a small JPEG data address from the cut; paper 'invoice' has no tax lines
 * for a business not registered for tax; a choice's estimate is only ever a model estimate.
 */
export type QueuePreview =
  | { kind: 'video'; title: PreviewWords; format: 'long' | 'short'; duration?: PreviewLength; chapters?: number; checks: { passed: number; run: number; notRun: number }; poster?: { uploadId: string; src: string } }
  | { kind: 'paper'; paper: 'invoice'; title: Display; from: Display; to: Display; lines: (PreviewFigure & { quantity: string; unit: Display })[]; subtotal: PreviewFigure; discount?: PreviewFigure; taxLines: PreviewFigure[]; total: PreviewFigure; due?: { days: number; date: string | null; display: Display } }
  | { kind: 'paper'; paper: 'working'; title: Display; client: Display | null; working: PreviewFigure[]; more: number; signer: { name: Display; state: 'to-send' | 'with-ca' } | null }
  | { kind: 'post'; connectorId: string; platform: Display; account: Display | null; mode: 'api' | 'owner-browser-session'; text: string; textEstimate?: true; counts: QueueCount[]; short?: { title: PreviewWords; length?: PreviewLength } }
  | { kind: 'choice'; question: PreviewWords; options: { label: Display; text: PreviewWords; estimate?: { label: Display; value: Display }; gains?: Display; costs?: Display; recommended?: boolean }[]; card?: QuestionCard };
/**
 * 4J3: an engine-formatted amount and the receipt it comes from. receiptKind names the method that opens it: price and
 * sum through venture.receipt.get, ca through venture.ca.receipt, work through venture.work.get. A post's textEstimate:
 * a model wrote it and it holds a number or an amount with no receipt; its text stays exact.
 */
export interface PreviewFigure { label: Display; value: Display; receiptId: string; receiptKind: PreviewReceiptKind }
export type PreviewReceiptKind = 'price' | 'sum' | 'ca' | 'work';
/** 4J3: words a preview shows; estimate: a model wrote a number in them that no receipt backs. */
export interface PreviewWords { text: Display; estimate?: true }
/** 4J3: a length worked out by code: whole seconds, "11 min 42 s", "11:42", and what it was measured from. */
export interface PreviewLength { seconds: number; display: Display; clock: Display; from: 'edit-list' | 'transcript' }
export interface QueueList { rows: QueueRow[]; summary: Display; needsYou: number; businesses: number }
export interface QueueDecision { outcome: 'done' | 'stale' | 'refused'; line: Display; receiptId?: string; latest?: QueueRow; reason?: string }
export type RunState = 'active' | 'waiting' | 'done' | 'failed';
export interface RunStep {
  id: string; purpose: string; state: 'done' | 'current' | 'pending' | 'waiting' | 'failed'; elapsed?: Display;
  tools?: RunToolLine[]; evidence?: { kind: string; id: string; label: string }[]; error?: string; audited?: boolean;
  /** 4J14 (Q6): on the read step, how much of the client's files code handed over (venture.runs.get only). */
  coverage?: CoverageView;
  /** 4J14 (Q6): on the check step, the checks that could not run: id (playbook:check) and the engine line. */
  notRun?: { id: string; line: Display }[];
}
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
  progress?: { done: number; total: number } | 'indeterminate'; result?: Display; receiptId?: string; estimate?: boolean;
  usually?: Display; stop?: { state: 'stopping' | 'stopped'; line: Display; trigger?: 'same-error' | 'same-action' | 'failures-in-row' };
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
  steps: RunStep[]; question?: { id: string; text: string; choices?: string[]; card?: QuestionCard }; error?: string; screen?: Display;
  scope?: RunScopeView; steer?: { text: Display; at: string; line: Display }[];
  gate?: { on: boolean; every: 1 | 2 | 3 | 5; waiting: { round: number; reason: 'finished' | 'limit' | 'needs-answer' | 'blocked' | 'failures'; line: Display } | null };
  live?: { callId: string; state: 'start' | 'done' | 'error' }[];
  /** 4F2 (O14): "How to fix it", only when the owner must act on a failed or breaker-stopped run. */
  fix?: Display;
  /** 4F2 (O14): the failure in the table's plain words, and codes for the screen's own words (English and Hindi). */
  failure?: { kind: 'allowance-spent' | 'not-signed-in' | 'offline' | 'too-long' | 'out-of-date' | 'unknown'; line: Display };
  fixKind?: 'raise-limit' | 'sign-in' | 'run-again-online' | 'split-work' | 'update-tool' | 'install-ffmpeg' | 'set-up-docker' | 'get-python-image' | 'set-up-cli';
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
export interface DeliveredView { line: Display; files: DeliveredFile[]; changed: DeliveredFile[]; changedLine: Display | null }
export interface DeliveredFile { id: string; name: Display; digest: string; at: string; source: 'table' | 'delegate' | 'order-file' | 'transcript' | 'poster'; line: Display }
/** 4F1. A run's scope: tools and outside actions in purpose words, the spend cap and the posture. */
export interface RunScopeView { tools: Display[]; actions: Display[]; cap: Display; posture: Posture; line: Display; /** 4F3: the cap's receipt. */ capReceiptId: string; /** 4F3: the cap in rupees at the owner's rate, and the rate. */ capRupees?: Display; capRate?: Display }
export type Posture = 'rehearsal' | 'shadow' | 'approve-each' | 'auto-spot-check';
export interface AgentView {
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
export type VentureRunEventType = 'run.started' | 'run.step' | 'run.waiting' | 'run.done' | 'run.failed' | 'queue.changed'
  | 'agent.message' | 'chief.message' | 'proposal.created' | 'notify.new' | 'pipeline.changed' | 'run.stopped' | 'run.call' | 'keeper.ran'
  | 'chain.changed' | 'desk.changed' | 'idea.changed' | 'privacy.forgotten';
/** seq: the event's place in the business's log, for replay after a reconnect (4G1); count: on notify.new only. */
export interface VentureRunEvent { type: VentureRunEventType; businessId: string; runId?: string; at: string; seq?: number; count?: number }
// phase 2 views
/**
 * `reason`: the engine's words for why a call was refused (no price, over the monthly limit, waiting for approval).
 * `reservedRupees`, `settledRupees`: the same figures in rupees at the owner's own rate, with that rate; absent without one.
 * `by`: who answered a model call, in words ('Claude Sonnet 5.5', or 'not reported'); absent for other spend and
 * before the call answered.
 */
export interface SpendRow {
  id: string; agent?: string; connector?: string; label: string; reserved: Display; settled?: Display; kind: 'estimate' | 'billed' | 'refused'; receiptId?: string; reason?: Display;
  reservedRupees?: Display; settledRupees?: Display; by?: Display;
  /** 4Z3: the reserved and settled figures as the owner's currency leads them. */
  reservedLead?: SpendLead; settledLead?: SpendLead;
  /** 4F2 (M6, M7): how the cost is known, the price it was worked at with its date, and who pays. Chausar charges nothing. */
  basis?: Display; priced?: Display; payer?: Display;
}
/**
 * 4Z3 (founder, 27 Oct): which currency leads spend, as the owner chose it. 'auto': rupees lead for a business in India
 * once a rupee rate is set; 'inr': rupees first whenever a rate is set; 'usd': dollars first. Without a rate, dollars lead.
 */
export type CurrencyLead = 'auto' | 'inr' | 'usd';
/**
 * 4Z3: a spend figure as the owner's currency leads it, from the engine (money/spend.ts spendLead): `figure` the lead
 * amount with the engine's words after it, never more than two decimals of dollars; `beside` the other currency at the
 * owner's rate, shown small beneath it; `other` that amount alone, for a page that says the rate once. The UI computes
 * nothing: it shows `figure` where the spend figure goes and `beside` beneath it.
 */
export interface SpendLead { currency: 'INR' | 'USD'; figure: Display; beside?: Display; other?: Display }
/**
 * venture.spend.policy.get/set. The Usd fields are figures in US dollars as the owner types them ('20.00', '0.000075');
 * the form shows those and sends what the owner typed, and the engine converts. The UI shows the Display fields.
 */
export type SpendRateUnit = 'per-million-tokens' | 'per-call' | 'per-run-cap';
export interface SpendRateLine {
  item: string; unit: SpendRateUnit; inputMicrosPerMillion: string | null; outputMicrosPerMillion: string | null; microsPerCall: string | null;
  inputUsdPerMillion: string | null; outputUsdPerMillion: string | null; usdPerCall: string | null;
  source: string; checkedOn: string; confirmed: boolean; by: 'list' | 'owner'; price: Display;
  /** 4F2 (M6): the prompt-cache prices, when the line has them. */
  cacheReadMicrosPerMillion?: string | null; cacheWriteMicrosPerMillion?: string | null; cacheReadUsdPerMillion?: string | null; cacheWriteUsdPerMillion?: string | null;
}
export interface SpendRateInput {
  item: string; unit: SpendRateUnit; inputUsdPerMillion?: string | null; outputUsdPerMillion?: string | null; usdPerCall?: string | null; source: string; checkedOn: string;
  /** 4F2 (M6): the prompt-cache prices in US dollars, each optional. */
  cacheReadUsdPerMillion?: string | null; cacheWriteUsdPerMillion?: string | null;
}
/**
 * `inrPerUsd`: the owner's own rupee rate as typed back ('83.50'); `rupeeRate`: that rate in words with the day it was
 * set; `capRupees`, `askFirstRupees`: the limits in rupees at that rate. All null or absent without a rate.
 */
export interface SpendPolicyView {
  capMicros: string | null; askFirstMicros: string | null; capUsd: string | null; askFirstUsd: string | null;
  cap: Display; askFirst: Display; rates: SpendRateLine[]; setAt: string | null;
  inrPerUsd: string | null; rupeeRate: Display | null; capRupees?: Display; askFirstRupees?: Display;
  // 4F2: the day's cap and the alert share (M4); the meter and the limit-reached options (M4, M3); each agent's own
  // limit (M5); the daily write caps (H32); the rate card with confirmed and list prices (M6).
  dailyCapMicros?: string | null; dailyCapUsd?: string | null; dailyCap?: Display; dailyCapRupees?: Display;
  alertPermille?: number; alert?: Display;
  meter?: SpendMeterView | null; limitReached?: LimitReachedView; keyLimits?: LimitReachedView[];
  agentCaps?: AgentCapView[]; writeCaps?: WriteCapView[]; card?: RateCardLine[];
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
export interface LimitReachedView { scope: 'business' | 'key'; presetId?: string; line: Display; options: { id: 'raise' | 'connect' | 'wait'; label: Display }[] }
/** 4F2 (M5): one agent's own monthly limit; past it only that agent is paused. */
export interface AgentCapView { agent: string; name: Display; capMicros: string; capUsd: string; cap: Display; used: Display; paused: boolean; capRupees?: Display; usedRupees?: Display }
/** 4F2 (H32): one daily write cap: today's cap, what agents made today, in words. */
export interface WriteCapView { kind: WriteCapKind; cap: number; used: number; raised: boolean; line: Display }
/** 4F2 (M6): one price on the rate card: the owner's checked rate, or Chausar's list price with its checked date. */
export interface RateCardLine { item: string; label: Display; state: 'confirmed' | 'list'; price: Display; checked: Display; source: string; unconfirmed?: boolean }
/** allowedBy (4J1): a step a saved rule let run without asking; Stop always allowing is venture.team.gate { agentId, stepId, gate: 'hold' }. */
export interface JournalEntry {
  id: string; action: string; target: string; state: 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown'; at: string; line: Display; receiptId?: string;
  allowedBy?: { rule: 'auto' | 'session'; agentId: string; stepId: string; ruleId: string | null };
  /** 4J10 (H27): how far it went after applied, and how each target ended. */
  endState?: 'accepted' | 'processed' | 'shown' | 'result' | 'verified';
  targets?: { id: string; outcome: 'applied' | 'rejected' | 'partial' | 'unknown' | 'throttled'; line: Display }[];
}
/** `dismissed`: the owner said no to this suggestion (venture.evidence.dismiss); it stays in the ledger, off the screen. */
export interface EvidenceItem { id: string; subject: string; field: string; value: Display; type: string; strength: 'verified' | 'strong' | 'weak'; claim: 'observed' | 'inferred' | 'needs-your-data'; source: string; applied: boolean; dismissed?: boolean }

// ---------------------------------------------------------------------------------------------------------------
// Ink final pass: the views and actions the engine added for the last screens (engine-final, 21 Oct). Every figure is
// engine text (Display); amounts the owner types go to the engine as typed strings and come back formatted.
// ---------------------------------------------------------------------------------------------------------------

/** `venture.money.overview`: Money at a glance, three lines the engine adds up (owed, received, spent). */
/** `rupees`: the AI spend line in rupees at the owner's own rate, with that rate; absent without one. */
/** kind, source, uses, basis (4J4): how the line's figure was made. */
export interface MoneyOverviewLine {
  id: 'owed' | 'received' | 'spent'; label: Display; value: Display; receiptId?: string; estimate?: boolean; rupees?: Display;
  /** 4Z3: the AI spend line as the owner's currency leads it (the 'spent' line). */
  lead?: SpendLead;
  kind?: FigureKind; source?: FigureSource; uses?: Display[]; basis?: TotalBasis;
}
export interface MoneyOverview { lines: MoneyOverviewLine[] }

/** `venture.tax.working`: the tax working for a period, worked by the calculator, each figure with its receipt. */
export interface TaxWorkingLine { label: Display; value: Display; receiptId?: string }
export interface TaxWorkingSection { id: string; title: Display; lines: TaxWorkingLine[]; note?: Display }
export interface TaxWorking { period: Display; sections: TaxWorkingSection[]; needsCaConfirmation: boolean }

/** `venture.ca.get` (the CA firm playbook): the CA of record, rate tables waiting for the CA, and sign-off requests. */
export interface CaOfRecord { name: string; membershipNo: string }
export interface CaPendingRate { tableId: string; title: Display; version: string; validFrom: string; validTo: string | null; citations: string[] }
export interface CaSignoffRequest { signoffId?: string | null; id: string; deliveryId: string; title: Display; state: 'sent' | 'signed' | 'returned'; at: string }
/** The newest regulated draft with the calculator's receipts (Ink v2 2A2); Your CA works each receipt again. */
export interface CaLatestPapers { deliveryId: string; title: Display; receiptIds: string[] }
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
  /** country (4J20): the business's country, its code and currency; null while it is still in its interview. */
  venture: { id: string; workingName: string; serviceType: ServiceType | null; country?: { code: string; currency: string } | null };
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
  figures: { key: string; label: string; display: Display; unit: 'money' | 'count' | 'percent' | 'post' }[];
  steps: { op: string; inputs: string[]; result: string; rule: string }[];
  coverage?: CoverageView;
}
/**
 * 4J1: the receipt behind a figure a Today row states (`fig:<kind>:...` ids), worked out again from its record on each
 * read. A ReceiptLite too, so the receipt sheet shows it as it is. Each figure's amount is in its own unit.
 */
export interface RowFigure { key: string; label: string; amount: string; unit: 'micros' | 'minor' | 'rate'; currency: string; display: Display }
export interface RowFigureReceipt {
  id: string; kind: 'row-figure'; ventureId: string; at: string; operation: 'venture.row-figure';
  // 4F3: 'scope-cap', a run's spend cap as its scope froze it when it started.
  subject: { type: 'call-cost' | 'judge-cost' | 'cap-room' | 'spend-quote' | 'plan-price' | 'month-spend' | 'week-total' | 'week-average' | 'scope-cap' | 'go-no-go'; recordId: string };
  figures: RowFigure[]; allowedNumbers: string[]; explanation: Display; digest: string; stale: boolean;
}

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
  /** 4J4: the month asked for, and the month before it (each figure with its receipt) when the period is one whole month. */
  month?: string;
  previous?: { month: string; label: Display; period: { from: string; to: string }; figures: BooksFigureLite[] } | null;
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
  /** 4J7 (K6): how far this posting mode is proven on this business. */
  ladder?: ConnectorLadder;
}
/** 4J7 (K6): the connector truth ladder (build/connector-truth.ts). */
export type ConnectorLadder = 'documented' | 'discovered' | 'read-verified' | 'write-verified' | 'unavailable';
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
  /** 4F2 (M7): on connect's answer only, when the new key took over work an earlier one did: who now pays, in words. */
  payerLine?: Display;
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
export interface BlueprintLite {
  id: string; at: string; version: number; status: 'draft' | 'accepted'; source: 'model' | 'template'; digest: string; serviceType: ServiceType;
  name: LabelledLite<string>; oneLiner: LabelledLite<string>; customer: LabelledLite<string>;
  offers: OfferLite[]; deliverySteps: BlueprintStepLite[]; approvals: LabelledLite<string>[];
  backOffice: {
    taxRateBps?:string;taxState?:string|null;lutConfirmed?:boolean;
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
export interface BlueprintViewLite { blueprint: BlueprintLite; offerReceipts: Record<string, ReceiptLite | null>; playbook?: PlaybookPick; intake?: Record<string, OfferIntakeLite> }
export interface BlueprintPatchLite {
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
  self?: true;
  id: string; at: string; name: string; email: string | null; countryCode: string | null; taxId: string | null; stateCode: string | null; note: string | null;
  owed?: { display: Display; receiptId: string };
}
export interface ClientAddParams { name: string; email?: string; countryCode?: string; taxId?: string; stateCode?: string; note?: string }
/** `venture.order.list` (OrderRecord), trimmed. `request` is what the client asked for, typed by the owner. */
export type OrderStatus = 'open' | 'invoiced' | 'delivered' | 'cancelled';
export interface OrderLite {
  narrationFetched?: {fileId:string;url:string;finalUrl:string;digest:string};
  internal?: true;
  id: string; at: string; clientId: string; offerId: string; quantity: string; request: string; status: OrderStatus;
  priceReceiptId: string; deliveredOn: string | null;
  /** OrderRecord.intake, trimmed (a flagship offer's intake). cutFile: the finished cut on this computer, desktop only. */
  intake?: { calendar?: CalendarIntakeLite; clientRules?: ClientRulesLite; rights?: { basis: RightsBasisLite; holder: string; reference: string | null; scope: string | null; expiresOn: string | null; recordedAt: string; recordedBy: string } | null; aiVoice?: boolean; aiPresenter?: boolean; paidPromotion?: boolean; format?: 'long' | 'short'; cutFile?: string | null; fields?: Record<string, string | boolean | readonly string[] | readonly { name: string; consentId: string | null }[] | null> };
  /** 4J3: the order's stage steps from the records, and what waits on the owner ("2 wait on you: ..."), or null. */
  stages?: OrderStageView[];
  waitsOnYou?: OrderWaitsOnYou | null;
}
/**
 * 4J3: one stage of an order (the engine's playbooks/order-stages.ts lists them per playbook). id and state are codes
 * the screen words for itself in English and Hindi; detail and line are the engine's English. waits is on the owner;
 * waitsOn names the CA or the client when it waits on them; due is the day a payment is due. reason is a code for the
 * detail, for the screen's own words; an engine-failed draft is 'failed', never 'stopped'.
 */
export type OrderStageId = 'agreed' | 'price' | 'episode' | 'publish' | 'files-in' | 'books' | 'gst' | 'calendar' | 'drafts' | 'client-ok' | 'posts' | 'report' | 'draft' | 'sent' | 'invoice' | 'paid';
export type OrderStageReason =
  | 'new-price' | 'ready' | 'question' | 'approval' | 'brief' | 'failed' | 'stopped' | 'rejected' | 'working' | 'practice'
  | 'send-unknown' | 'post-unknown' | 'issue-unknown' | 'ca-signed' | 'ca-returned' | 'with-ca' | 'send-to-ca' | 'no-ca'
  | 'client-approved' | 'client-changes' | 'with-client' | 'link-ended' | 'posts-waiting' | 'posting' | 'planned' | 'to-issue' | 'issued' | 'due' | 'part-paid';
export interface OrderStageView {
  id: OrderStageId; label: Display; state: 'done' | 'waits' | 'not-yet' | 'always-asks' | 'unknown'; detail: Display; line: Display;
  waitsOn?: 'you' | 'ca' | 'client'; due?: string; reason?: OrderStageReason;
}
export interface OrderWaitsOnYou { count: number; items: { stage: OrderStageId; what: Display }[]; line: Display }
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
  servedBy?: 'model' | 'template' | 'owner';
  practiceNow?: boolean;
  checks?: CheckLite[];
  playbookChecks?: PlaybookCheckLite[];
  canAccept?: boolean;
  acceptBlocked?: Display | null;
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
  /** 4J5: on venture.invoice.list rows, the invoice's one next step. */
  next?: InvoiceNext;
  /** 4J4: an open invoice past its due day ("71 days late"). */
  late?: { days: number; line: Display };
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
export type PaymentMethod = 'bank-transfer' | 'upi' | 'card' | 'cash' | 'payment-link' | 'other' | 'cheque';
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
  what: 'issued' | 'viewed' | 'paid' | 'cheque' | 'credited' | 'reminder' | 'reminded' | 'awaiting' | 'settled'; on: string; line: Display;
}
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
  /** 4J5: the next step, the timeline, the credit notes, and on a draft whose rate is no longer the plan's, the change. */
  next?: InvoiceNext;
  timeline?: InvoiceTimelineEntry[];
  credits?: CreditNoteView[];
  rateChange?: { charged: string; now: string; line: Display };
  /** 4J20: an open invoice past its due day. */
  late?: { days: number; line: Display };
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
  source: { title: string; url: string } | null;
  /** 5A3: every source; a house rule's is "Chausar's own rule" with no address (url ''). */
  sources: { title: string; url: string }[];
  line: Display;
}
/** 5A3 (P6): a recipe and one row of the measurement-boundaries table, as the engine words them. */
export interface RecipeView { id: string; name: Display; whenToUse: Display; steps: { do: Display; why: Display }[]; howToRead: Display; mistakes: Display[] }
export interface BoundaryView { evidence: Display; canSay: Display; cannotSay: Display }
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
export type AgentHealthStatus = 'healthy' | 'failing' | 'quarantined' | 'degraded';
export interface AgentHealth { status: AgentHealthStatus; reason: Display | null; digest: string }
/** sharePermille (4A2): the part's share of the month's whole spend, floored by the engine; 0 when nothing was spent. */
/** rate (4A2): the owner's rupee rate in words, the same words `rupees` and `held` end with, sent with them. */
export interface DepartmentSpend { display: Display; receiptId: string; rupees?: Display; rate?: Display; held?: Display; heldReceiptId?: string; sharePermille?: number; lead?: SpendLead }
export interface DepartmentView {
  id: DepartmentId; name: Display; counts: { working: number; waiting: number; stopped: number; idle: number };
  /** doneThisWeek.permille (4A2): this week's count scaled to the busiest department's, floored; 0 when none did a job. */
  doneThisWeek: { count: number; receiptId: string; permille?: number }; spendThisMonth: DepartmentSpend; series: { jobs: SeriesPoint[]; spend: SeriesPoint[] };
}
export type KeeperJobId = 'backups' | 'journal-sweep' | 'connection-checks' | 'rule-freshness' | 'rate-tables' | 'posting-steps' | 'network-strength' | 'probes' | 'calendar-feed'
  | 'monitors'; // 5A6: page monitors
export interface KeeperJobView { id: KeeperJobId; name: Display; lastRun: { at: string; outcome: 'ok' | 'warn' | 'failed'; line: Display } | null; note: Display | null }
export interface KeeperView { jobs: KeeperJobView[] }
export interface TeamListView {
  agents: AgentView[]; departments?: DepartmentView[]; shared?: DepartmentSpend | null;
  /** The team's totals, from the same partition as the departments; spendThisMonth is Money's own figure. */
  totals?: { doneThisWeek: { count: number; receiptId: string }; spendThisMonth: DepartmentSpend; held: MoneyFigure | null };
  /** A quarantine no single agent can claim; cleared with agentId 'team'. */
  teamHealth?: AgentHealth;
}

/** 4B1 and 4B2 agent chat, proposals, standing orders and notes. */
export type ChatPart = { kind: 'text'; text: string } | { kind: 'figure'; receiptId: string; key: string; display: Display } | { kind: 'estimate'; text: string };
export interface AgentSuggestion { kind: 'order'; offerId: string | null; request: string }
export interface ChatConsentView { state: 'needed' | 'given' | 'stale' | 'not-needed'; text: Display | null; digest: string | null; at: string | null }
export type AgentNoteScope = 'agent' | `client:${string}`;
export type AgentNoteLoad = 'always' | 'topic';
export interface DiffLine { op: 'same' | 'add' | 'remove'; text: string }
/** proposalId (4B3): on the reply to a request on the floor, the proposal it raised to Today (row subject proposal:<id>). */
export interface AgentMessageView { id: string; at: string; from: 'owner' | 'agent' | 'chausar'; parts: ChatPart[]; suggestion?: AgentSuggestion; answered?: { runId: string }; proposalId?: string }
export interface AgentProposalView {
  id: string; at: string; agent: string; kind: 'instruction' | 'note' | 'import'; status: 'drafted' | 'accepted' | 'rejected' | 'stale';
  quote: string; title: Display; appliesTo: Display | null; diff: DiffLine[]; fromVersion: number | null; toVersion: number | null;
  note: { text: string; scope: AgentNoteScope } | null; digest: string; line: Display | null;
}
export interface AgentRunItem { runId: string; at: string; purpose: Display; state: RunState; done: number; total: number; steps: RunStep[]; recalled: { id: string; text: string; forgotten?: boolean }[] }
export type AgentThreadItem = { type: 'message'; message: AgentMessageView } | { type: 'run'; run: AgentRunItem } | { type: 'proposal'; proposal: AgentProposalView };
export interface AgentThreadView {
  agent: { id: string; name: string; role: string }; items: AgentThreadItem[];
  waiting: { runId: string; rowId: string; question: Display } | null; more: boolean; consent: ChatConsentView;
}
export interface AgentSendResult { added: AgentThreadItem[]; line: Display | null }
export interface StandingOrderView { stepId: string; step: Display; text: string; since: number; quote: string; at: string }
export interface AgentNoteView { id: string; scope: AgentNoteScope; load: AgentNoteLoad; text: string; source: Display; captured: string; hash: string }
/** erases (4B3): undoing this change takes the note away, which erases its words like Forget. */
export interface NoteChangeView { id: string; noteId: string; at: string; who: 'owner' | 'proposal' | 'undo'; line: Display; undone: boolean; erases: boolean }
export interface AgentNotesView { notes: AgentNoteView[]; changes: NoteChangeView[]; usedChars: number; limitChars: number; forgetLine?: Display }
export interface AgentNoteChange { note: AgentNoteView | null; change: NoteChangeView }
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
export type StandingUndoView = { kind: 'back'; version: number } | { kind: 'rebuild' };
export interface StandingOrdersView { orders: StandingOrderView[]; playbook: StandingPlaybookView | null; rebuildDue: boolean; steps: StandingStepView[]; undo: StandingUndoView | null }

/** 4C1 Chats and proposals. */
export type ProposalKind = 'brief-agent' | 'start-run' | 'start-work' | 'draft-invoice' | 'draft-reminder' | 'quote' | 'outreach-draft' | 'next-step';
export type ProposalStatus = 'drafted' | 'raised' | 'approved' | 'dismissed' | 'refused';
/** what (4C2 review): the step's own line; line says where it stands. */
export interface ProposalView { id: string; at: string; kind: ProposalKind; status: ProposalStatus; title: Display; line: Display; what: Display; agent: string | null; rowId: string | null; digest: string; secondAsk: boolean }
/** 4C2 review: each receipted figure lastLine states, exactly as written there, at its offset in UTF-16 code units. */
export interface ChiefLineAmount { text: Display; start: number; length: number; receiptId: string }
export interface ChiefThreadSummary { id: string; title: string; pinned: boolean; lastAt: string; lastLine: Display; amounts: ChiefLineAmount[]; unread: number }
/** consent (4C2 review): the one chat consent as it stands; the screen shows this text and agrees by this digest. */
export interface ChiefThreadsView { groups: { key: 'pinned' | 'today' | 'this-week' | 'last-week' | 'earlier'; label: Display; threads: ChiefThreadSummary[] }[]; consent: ChatConsentView }
/** 4C2 review: the counts by code (4J14, Q21): each kind's records, and the new ones in each month (YYYY-MM), oldest first. */
export interface ChiefCounted { entities: { kind: string; count: number }[]; months: { month: string; count: number }[] }
export interface ChiefMessageView {
  id: string; at: string; from: 'owner' | 'chief'; parts: ChatPart[]; proposals: ProposalView[];
  routedTo: { agent: string; name: string } | null; worked: { label: Display; value: Display; receiptId: string }[]; dropped: Display[];
  counted: ChiefCounted | null;
}
export interface ChiefThreadView { thread: ChiefThreadSummary; messages: ChiefMessageView[]; more: boolean }
export interface ChiefSendResult { thread: ChiefThreadSummary; added: ChiefMessageView[]; ask: Display | null }
export interface ChiefFit { wayId: string; line: Display; estimate: true }

/** 4D1 to 4D3 the owner's network. */
export type NetworkImportKind = 'linkedin-connections' | 'linkedin-messages' | 'contacts-csv' | 'vcard' | 'calendar-ics' | 'mail-headers';
export type TieBand = 'close' | 'know-well' | 'know' | 'met-once' | 'cold';
export interface PersonSummary { id: string; name: string; initials: string; title: Display | null; company: string | null; band: TieBand | null; dots: number; hidden: boolean; degree: '1st' | '2nd' | null }
export interface WarmPathView { kind: 'direct' | 'same-company' | 'connector'; via: { id: string; name: string } | null; confirmed: boolean; strength: TieBand; line: Display }
/** 4D4: consent, the chat consent a search needs while it is needed (needed or stale, with its text and digest), else null. */
export interface PeopleView { people: PersonSummary[]; suggestions: { a: string; b: string; line: Display }[]; total: number; consent: ChatConsentView | null }
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
export type NetworkImportResult =
  | { mode: 'check'; kept: number; dropped: { what: string; count: number }[]; people: number; merged: number; samples: { name: string; line: Display }[]; line: Display }
  | { mode: 'import'; import: NetworkImportView; line: Display };
export interface SearchResultView {
  person: PersonSummary | null; url: string | null; fitBp: number; why: Display;
  checks: { trait: Display; check: 'yes' | 'partly' | 'not-supported'; quote: string | null; source: Display | null }[];
  path: WarmPathView | null; inPipeline: PipelineStage | null; cold: boolean;
  /** 4D4: the tie's receipt, and the LinkedIn address the files hold; null for a web result. */
  receiptId: string | null; linkedin: string | null;
}
/** 4D3: what a search's web part did, to branch on without matching words. */
export type SearchWebState = 'off' | 'not-set-up' | 'skipped' | 'failed' | 'none' | 'found';
export interface NetworkSearchView { id: string; text: string; traits: { id: string; label: Display }[]; results: SearchResultView[]; summary: Display; more: boolean; webLine: Display | null; web: SearchWebState }

/** 4E1 to 4E3 the pipeline, outreach and inbound mail. */
export type PipelineStage = 'found' | 'asked' | 'talking' | 'proposal' | 'won' | 'lost' | 'not-now';
export type LostReason = 'no-budget' | 'no-reply' | 'chose-someone-else' | 'not-a-fit' | 'timing' | 'other' | 'opted-out';
export type OutreachKind = 'intro-request' | 'double-opt-in' | 'connection-note' | 'follow-up' | 'reply' | 'cold-email' | 'reminder';
export type OutreachChannel = 'email' | 'linkedin' | 'whatsapp';
export type OutreachSentChannel = 'own-mailbox' | 'linkedin' | 'whatsapp' | 'phone';
/** 4E2: the languages Chausar drafts in, the lawful basis of a cold email, and the send governor's lanes. */
export type OutreachLanguage = 'en' | 'hi';
export type LawfulBasis = 'they-wrote-first' | 'existing-contact' | 'public-business-contact';
export type OutreachLane = 'linkedin-note' | 'linkedin-message' | 'whatsapp' | 'email';
export interface PipelineCaps { newPerDay: number; perWeek: number; channels?: Partial<Record<OutreachLane, number>> }
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
export interface PipelineSettingsView { weekdays: number[]; sendTime: string; caps: PipelineCaps; scoreRules: ScoreRule[]; line: Display }
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
export type OutreachHandoff =
  | { action: 'mailto'; url: string; line: Display }
  | { action: 'linkedin'; profileUrl: string; text: string; line: Display }
  | { action: 'whatsapp'; url: string; line: Display }
  | { action: 'copy'; to: string | null; subject: string | null; text: string; line: Display };
export type InboundTriage = 'opt-out' | 'auto-reply' | 'thanks' | 'bounce' | 'owner-reply' | 'bot-question' | 'talking' | 'unmatched';
/** 4E4: needsPassword, connected but the app password left the engine's shelf with a restart: type it again. */
export interface MailboxView { connected: boolean; host: string | null; user: string | null; lastSync: string | null; line: Display; needsPassword: boolean }
export interface InboundView { id: string; from: string; date: string; subject: string; triage: InboundTriage; matched: { opportunityId: string; name: string } | null; line: Display }
/** 4E4: nextRead, when the morning read comes next, while the address is on the engine's shelf; else null. */
export interface CalendarFeedView { set: boolean; host: string | null; lastRead: string | null; line: Display; nextRead: string | null }

/** 4F1 and 4F2 run controls, pause all, Away, write caps. */
export interface RunControlResult { run: RunDetail; line: Display; lost?: Display }
/** since: once the time away began, Today's rows made between the two days, for the "Since you left" filter (4F1). */
export interface AwayView { away: { from: string; to: string } | null; promises: { due: string; line: Display }[]; keepsRunning: Display[]; approvalsWaiting: number; autoReply: string | null; line: Display; since?: { from: string; to: string; rowIds: string[] } }
export type WriteCapKind = 'drafts' | 'books-lines' | 'messages';

/** 4G1 and 4G3 notifications and push. */
export interface NotificationView { id: string; rowId: string; kind: QueueKind | QueueKindW4; title: Display; at: string; read: boolean }
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
  lastTask: { at: string; outcome: 'succeeded' | 'failed' } | null; state: ModelAvailability; line: Display; fix: Display | null;
}
export interface RoleModelView { agent: string; name: string; tiers: { tier: ModelTier; presetId: string; model: string | null; price: Display; usable: boolean }[] }

/** 4I1 goals and the next best step. */
export interface NextBestStep { rowId: string; title: Display; agent: string | null; line: Display; figure: MoneyFigure | null; goalAfter: Display | null; goalAfterPercent: number | null }
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
}
/** typed: the amount as the owner would type it in the goal field ("150000.00"). */
export interface GoalSuggestion { amountMinor: string; display: Display; estimate: true; line: Display; typed: string }

/** 4J1 and 4J2 decisions, edits, set approval, the triage rule, settings drafts. */
/** by: the member who decided, null for a saved rule or a timeout; ruleId and rule: the saved rule that decided, if one did. */
export interface DecisionView {
  id: string; at: string; subject: string; action: string; who: 'owner' | 'saved-rule' | 'timeout'; rule: Display | null; ruleId: string | null;
  reason: Display; line: Display; by: string | null;
  /** 4J19: the agent whose step a saved rule or a gate is about (venture.team.gate takes it), else null. */
  agentId: string | null;
}
export type TriageField = 'due' | 'client' | 'kind' | 'money' | 'business';
export interface TriageRule { keys: { field: TriageField; order: 'asc' | 'desc' }[]; words: string }
export interface TriagePreview { rule: TriageRule | null; choices: TriageRule[]; rows: QueueRow[]; digest: string; by: 'model' | 'choices' }
export interface DraftChangeView { id: string; paragraph: number; before: string; after: string; by: 'owner' | 'agent'; status: 'open' | 'taken' | 'dropped' }
/** 4J2: line says how the revision was merged; replacement is offered when the owner's own version sits beside the agent's. */
export interface DraftChangesView {
  changes: DraftChangeView[]; line?: Display;
  replacement?: { id: 'replacement'; status: 'open' | 'confirmed' | 'kept'; review: Display; confirm: Display; confirmLine: Display; keep: Display };
}
export interface SettingsDraftView { form: string; values: unknown; at: string }
/** 4J2 review: a set as the engine works it out; queue.set takes its digest, and secondAsk: true when it asks twice. */
export interface QueueSetPreview {
  digest: string;
  items: { rowId: string; title: Display; kind: QueueRow['kind']; cost: Display }[];
  total: { display: Display; receiptId: string };
  secondAsk: boolean;
  refusals: { rowId: string; reason: string; line: Display }[];
}

/** 4J4 to 4J6 money views, bills and businesses side by side. */
/**
 * 4J4 (M13, M14): how a money figure was made: reported (a file and its row), calculated (its receipt), assumption (an
 * input taken as given, shown beside each result that uses it) or estimate (a model's). projected: a forecast, never
 * what happened. basis: what a total counted and what it left out.
 */
export type FigureKind = 'reported' | 'calculated' | 'assumption' | 'estimate';
export type FigureSource = { from: 'file'; recordId: string; row: string; line: Display } | { from: 'receipt'; receiptId: string } | { from: 'input'; line: Display } | { from: 'model' };
export interface TotalBasis { filters: Display[]; truncated: boolean; notCounted: { count: number; line: Display } | null }
export interface KindedFigure extends MoneyFigure { kind: FigureKind; source: FigureSource; uses?: Display[]; projected?: true; estimate?: true; basis?: TotalBasis }
export type AgingBucketId = 'not-due' | '1-30' | '31-60' | '61-90' | 'over-90';
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
export interface CashView {
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
export interface MarginsView { month: string; rows: { clientId: string; client: string; invoiced: KindedFigure; spend: KindedFigure | null; margin: KindedFigure | null; note: Display | null }[]; line: Display; basis: TotalBasis }
/** receipts (4J10): the business's signed receipts with the public halves of its keys, for the CA to check offline; saved as its own file. */
export interface MoneyExportFile { fileName: string; csv: string; rows: number; line: Display; receipts?: SignedReceiptsFile }
export interface SignedReceiptsFile { format: string; business: string; algorithm: string; publicKey: string | null; keys: { id: string; publicKey: string }[]; receipts: unknown[] }
/** 4J20: the amount as typed (amount) or in minor units (amountMinor), and the rate as typed (taxRate, a percentage) or in basis points; one of each. */
export type BillLineInput = { description: string; taxName: string }
  & ({ amount: string; amountMinor?: never } | { amountMinor: string; amount?: never })
  & ({ taxRate: string; taxRateBps?: never } | { taxRateBps: string; taxRate?: never });
export interface BillView { id: string; vendor: string; billDate: string; dueDate: string; total: Display; paid: Display; balance: Display; state: 'draft' | 'posted' | 'partial' | 'paid' | 'overdue'; recurring: 'monthly' | 'quarterly' | null; receiptId?: string }
export interface CreditNoteView { id: string; invoiceId: string; amount: Display; reason: string; state: 'waiting' | 'issued' | 'cancelled'; number: string | null; rowId: string | null; line: Display; receiptId?: string | null }
export interface RecurringInvoiceView { id: string; clientId: string; offerId: string; frequency: 'monthly' | 'quarterly'; startOn: string; end: string | null; nextOn: string | null; line: Display }
/** 4J6: what a row's line says (`AcrossLineKey` in the engine's contracts), so a screen can word it in Hindi. */
export type AcrossLineKey = 'open' | 'no-country' | 'as-of' | 'as-of-setting-up' | 'locked' | 'key-missing' | 'unreadable' | 'none';
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
export interface AcrossRunsView {
  businesses: (BusinessSnapshotView & { working: number | null; waiting: number | null; stopped: number | null; needsYou: number | null })[]; line: Display;
  totals: { working: number; waiting: number; stopped: number; needsYou: number; businesses: number }; notCounted: AcrossLeftOut[];
}

/** 4J7 to 4J10 connection checks, file requests, ways to earn, the owner, signatures and the journal chain. */
export interface ConnectorCheckRow { connectorId: string; name: string; outcome: 'answered' | 'failed' | 'skipped'; line: Display; account: string | null; expiresOn: string | null; fix: Display | null }
export interface ConnectorChecksView { at: string; rows: ConnectorCheckRow[]; health: { ready: number; warnings: number; blocking: number } }
export interface FileRequestView { id: string; orderId: string; url: string | null; reason?: Display; expiresAt: string; line: Display }
/**
 * `WayView` in platform/runtime/venture/contracts.ts (4J8): one way per playbook that runs today. Hours and pay are a
 * model estimate (clientsPay.source is their basis); team is the playbook's agents only; starter fills the one-sentence
 * box and never sends; yours is the open business when it is of this kind; hi is every shown word in Hindi.
 */
export type WayCategory = 'content' | 'marketing' | 'money-and-tax' | 'shops-and-firms';
/** needs: besides the owner's time (hours), the owner's own AI and the connections that work today, in plain words. */
export interface WayNeeds { ai: Display; connections: Display }
export interface WayWords {
  label: Display; line: Display; hours: Display; youDo: Display; team: Display[]; teamLine: Display;
  pay: Display; per: Display; source: Display; starter: Display; needs: WayNeeds;
}
export interface WayView {
  id: string; playbook: string; label: Display; category: WayCategory; department: DepartmentId; line: Display;
  hours: Display; minHours: number; maxHours: number; hoursEstimate: true; youDo: Display;
  team: { role: string; initials: string; department: DepartmentId }[]; teamLine: Display;
  clientsPay: { text: Display; per: Display; estimate: true; source: Display }; needs: WayNeeds; starter: Display;
  yours: { businessId: string; name: string }[]; hi: WayWords;
}
export interface WaysView {
  ways: WayView[];
  categories: { id: WayCategory; label: Display; hi: Display; count: number }[];
  upTo: { maxHours: number; label: Display; hi: Display; count: number };
}
/** `ComposeAttachmentNote` (onboarding-contracts.ts): a dropped file's name, whether it was used, and why not, never its text. */
export interface AttachmentNote { name: string; used: boolean; line: string | null; reason: 'injection' | 'hidden' | 'error' | null }
/** `PlanChangeView` (4J8): one change a plan suggestion makes; estimate is always false (its words hold no number). */
export interface PlanChangeView {
  field: 'oneLiner' | 'customer' | 'offer-name' | 'offer-description' | 'offer-added'; offerId: string | null;
  before: Display; after: Display; line: Display; estimate: boolean;
}
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
export interface OwnerView { firstName: string | null; excludedServices: string[]; businessName: string; kept?: Display[] }
/** reason (4J22a): only 'changed' and 'unsigned-since' are mismatches; the others are not confirmed. */
export interface ReceiptVerifyView { id: string; valid: boolean; label: 'reproduction_ready' | 'incomplete' | 'signature_only'; reason: 'signed' | 'changed' | 'unsigned-since' | 'unsigned-old' | 'no-key' | 'key-gone'; line: Display }
/** digest: what the owner saw, sent back to accept exactly that break (venture.journal.acceptBreak). */
export interface JournalChainView { state: 'ok' | 'corrupt'; entries: number; firstBadSeq: number | null; line: Display; digest: string }

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
  | { kind: 'calendar'; weekdays: number[]; time: string; timeZone: string };
export type RoutineRunState = 'queued' | 'running' | 'needs-input' | 'completed' | 'failed' | 'missed' | 'skipped' | 'interrupted';
/** prompt (4J22a): the routine's own words, sent back with venture.routines.set to turn it off, on or change it; only for
 * a role that may change routines. */
export interface RoutineView { recordReport?:'va-morning'|'va-weekly'; id: string; name: string; agent: string | null; prompt?: string; schedule: RoutineSchedule; when: Display; on: boolean; next: string | null; line: Display }
export interface RoutineInput { recordReport?:'va-morning'|'va-weekly'; id?: string; name: string; agent?: string | null; prompt: string; schedule: RoutineSchedule; on: boolean }
export interface RankedOptionView { id: string; label: Display; text: Display; score: number; estimate: Display | null; failed: boolean }
export interface DrillRunView { id: string; at: string; playbookHash: string; version: number | null; passed: boolean; results: { drill: Display; stopped: boolean; twinPassed: boolean; line: Display }[] }
export interface AutoReadinessView { agent: string; items: { id: string; label: Display; met: boolean; line: Display }[]; locked: true; line: Display }
export interface ShadowSummaryView { agent: string; wouldHaveGone: number | null; held: number | null; changed: number | null; offers: Display[]; line: Display }
export interface GuidanceLineView { stepId: string; text: string; check: string | null; state: 'measured' | 'dark' | 'unmeasured' }
/** 4J16: a part of the drafts the owner keeps correcting. It changes nothing; starter prefills the agent's chat and is never sent. */
export interface FixTheRuleView { field: string; stepId: string | null; agent: string | null; corrected: number; reviews: number; line: string; starter: string }
export interface VoiceSections { audience: string[]; howITalk: string[]; neverUse: string[]; wordsIUse: string[]; willNotClaim: string[]; format: string[] }
export interface VoiceInput { language: 'en' | 'hi'; channel?: string | null; on: boolean; sections: VoiceSections }
/**
 * 4J17 (A14): a question card: one question with answers to pick from, or a round of two to eight, each with the
 * agent's best guess; answers list the pick first with what each gains and costs; free text is always open, with escape.
 */
export interface QuestionOption { label: string; text: string; gains: string; costs: string; recommended: boolean }
export interface QuestionItem { number: number; text: string; guess: string; options: QuestionOption[] }
export interface QuestionCard { round: number; lead: string; items: QuestionItem[]; freeText: true; escape: string; example: string }
/** 4J17: version in use and undo (the voice to set to go back one version); draft: what learn worked out, unsaved. */
export interface VoiceView {
  voices: { language: 'en' | 'hi'; channel: string | null; on: boolean; sections: VoiceSections; validated: boolean; version?: number; undo?: VoiceInput | null }[];
  line: Display;
  draft?: { language: 'en' | 'hi'; channel: string | null; sections: VoiceSections; validated: boolean; learnedFrom: number; lines: string[]; line: Display } | null;
}
export interface PersonaFields { tone: string | null; replyLength: 'short' | 'medium' | 'long' | null; greeting: string | null; handOffLine: string | null; blockedTopics: string[]; signOff: string | null }
export interface PersonaView { agent: string; persona: PersonaFields; skills: { name: Display; line: Display; starter: string }[]; line: Display; version?: number; undo?: PersonaFields | null }
export type KnowledgeSourceInput = { kind: 'text'; title: string; text: string } | { kind: 'link'; url: string } | { kind: 'file'; uploadId: string } | { kind: 'past-work'; runId: string };
export interface KnowledgeSourceView { id: string; kind: 'text' | 'link' | 'file' | 'past-work'; title: string; at: string; line: Display }
export interface IdeaView { id: string; title: Display; reason: Display; evidence: { id: string; line: Display }[]; prompt: string }
/** 4J18: one line of the capability page, with what it is about (key) and its honest state, so the screen can word it in Hindi. */
export type CapabilityItemView = { list: 'see' | 'do' | 'off'; key: string; state: 'works' | 'reads' | 'records' | 'hands-off' | 'planned' | 'off'; line: Display };
export interface CapabilityPageView { agent: string; canSee: Display[]; canDo: Display[]; off: Display[]; items: CapabilityItemView[]; line: Display }

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
  | 'it-triage' | 'phone-receptionist';
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
  'venture.spend.list': { params: Record<string, never>; result: { rows: SpendRow[]; total: Display; totalRupees?: Display; totalLead?: SpendLead } };
  'venture.spend.policy.get': { params: Record<string, never>; result: SpendPolicyView };
  'venture.spend.policy.set': {
    params: {
      capUsd?: string | null; askFirstUsd?: string | null; rates?: SpendRateInput[]; inrPerUsd?: string | null;
      // 4F2: the day's cap, the alert share in permille, each agent's own monthly limit, and lower daily write caps.
      dailyCapUsd?: string | null; alertPermille?: number; agentCaps?: { agent: string; capUsd: string }[]; writeCaps?: Partial<Record<WriteCapKind, number>>;
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
  'venture.invoice.prepare': { params: { orderId: string; dueInDays?: number; issueDate?: string }; result: InvoiceViewLite };
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
  'venture.blueprint.update': { params: { patch: BlueprintPatchLite; basedOn?: { blueprintId: string; digest: string } }; result: BlueprintViewLite };
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
  /** 4J6: start a new never-contact list, only once the old one can no longer be checked; confirmation is the open business's name. */
  'workspace.custody.neverContactReset': { params: { confirmation: string }; result: { line: string } };
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
      clientId?: string; offerId: string; quantity?: string; request: string;
      intakeFiles?: Record<string, { name: string; contentBase64: string }>;
      intake?: {
        rights?: { basis: string; holder: string; reference?: string; scope?: string; expiresOn?: string }; format?: 'long' | 'short'; aiVoice?: boolean; aiPresenter?: boolean; paidPromotion?: boolean; cutFile?: string;
        calendar?: CalendarIntakeLite; clientRules?: ClientRulesLite;
        /** Kit answers; rupee inputs are parsed only by the engine. */
        fields?: Record<string, string | boolean | readonly string[] | readonly { name: string; consentId: string | null }[] | null>;
        moneyRupees?: Record<string, string>;
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
  'venture.pipeline.settings': { params: { weekdays?: number[]; sendTime?: string; caps?: { newPerDay?: number; perWeek?: number; channels?: Partial<Record<OutreachLane, number>> }; scoreRules?: ScoreRule[] }; result: PipelineSettingsView };
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
  'venture.away.set': { params: { from: string; to: string }; result: AwayView };
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
  'venture.money.export': { params: { month: string }; result: MoneyExportFile };
  'venture.bills.add': { params: { vendor: string; lines: BillLineInput[]; billDate: string; dueDate: string; recurring?: 'monthly' | 'quarterly' | null }; result: { bill: BillView; receiptId?: string } };
  'venture.bills.pay': { params: { billId: string; paidOn: string; method: PaymentMethod } & ({ amount: string; amountMinor?: never } | { amountMinor: string; amount?: never }); result: { bill: BillView; receiptId?: string } };
  'venture.bills.list': { params: Record<string, never>; result: { bills: BillView[]; owed?: MoneyFigure | null } };
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
  'venture.owner.set': { params: { firstName?: string | null; excludedServices?: string[] }; result: OwnerView };
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
  'venture.launch.status': { params: Record<string, never>; result: unknown };
  'venture.launch.advance': { params: { to: string }; result: unknown };
  'venture.delivery.approve': { params: { runId: string; digest: string }; result: DeliveryLite };
  'venture.delivery.review': { params: { runId: string; verdict: 'accepted' | 'edited' | 'rejected'; reason?: string; editedText?: string }; result: DeliveryLite };
  'venture.capabilities': { params: Record<string, never>; result: unknown[] };
  'venture.delivery.answer': { params: { runId: string; answer: string }; result: DeliveryLite };
  'venture.work.get': { params: { id: string }; result: WorkReceiptLite };
  'venture.improve.get': { params: { runId: string }; result: ImprovementRunLite };
  'venture.delivery.delegate': { params: { runId: string; digest: string; decision: 'approve' | 'decline' }; result: DeliveryLite };
  'venture.delegate.get': { params: { id: string }; result: unknown };
  'venture.ai.calls': { params: { limit?: number }; result: unknown[] };
  'venture.compose.decide': { params: { text: string; countryCode: string }; result: unknown };
  'venture.compose.fill': { params: { composeId: string }; result: unknown };
  'venture.compose.get': { params: Record<string, never>; result: unknown };
  'venture.compose.update': { params: { composeId: string; patch: unknown }; result: unknown };
  // 4J12 to 4J18 contracts, routines, options, drills, guidance, voice, persona, knowledge, ideas, capabilities.
  'venture.order.contract': { params: { orderId: string }; result: OrderContractView | null };
  'venture.order.contract.propose': { params: { orderId: string; contract: OrderContract }; result: OrderContractView };
  'venture.order.contract.sign': { params: { orderId: string; digest: string }; result: OrderContractView };
  'venture.routines.list': { params: Record<string, never>; result: { routines: RoutineView[] } };
  'venture.routines.runs': { params: { id: string }; result: { runs: { id: string; dueAt: string; state: RoutineRunState; line: Display }[] } };
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
  'venture.webhook.set': { params: { kind: 'n8n' | 'make'; url: string | null; test?: boolean }; result: WebhookView };
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
  /**
   * Desktop only (4D1, read by 4D4's import sheet): the owner picks one of their own network files and a desktop worker
   * reads it on this computer; `text` (only what Chausar keeps) goes to venture.network.import. ownerAddresses: the
   * addresses the owner sends from, needed for mail. Null when the owner cancelled. Absent on the web and the fake,
   * where the page reads the file itself.
   */
  pickNetworkFile?(kind: NetworkImportKind, options?: { ownerAddresses?: string[] }): Promise<PickedNetworkFile | null>;
  /**
   * Desktop only (4J4, read by 4J20's Export for your CA): the desktop asks the engine for one month's CSV
   * (venture.money.export) and saves it where the owner picks; the system dialog asks before it replaces a file. Null
   * when the owner cancelled; refusals (EXPORT_EXISTS, EXPORT_NOT_SAVED) as engine errors. Absent on the web, the
   * hosted app and the fake, where the page downloads the engine's CSV itself.
   */
  saveMoneyExport?(month: string): Promise<{ saved: true; name: string; receipts?: string; line: string } | null>;
  /**
   * Desktop only (5A5): the desktop makes a draft's client report (venture.report.render, the PDF included) and saves
   * every file and manifest.json in a new folder where the owner picks, atomically. Null when cancelled; EXPORT_EXISTS
   * when that folder is there already. Absent on the web, the hosted app and the fake, where the page downloads files.
   */
  saveReport?(runId: string): Promise<{ saved: true; folder: string; line: string } | null>;
  /** Desktop: save approved YouTube outputs and open the returned folder handle. */
  saveYoutubeProject?(editId: string, digest: string): Promise<{ saved: true; savedId: string; folder: string; line: string } | null>;
  openYoutubeProject?(savedId: string): Promise<{ opened: true }>;
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
