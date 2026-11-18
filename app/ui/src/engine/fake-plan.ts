/**
 * The fake engine's standing plan: venture.chief.plan.get, .plan.move and .review.set, answered as the engine answers
 * them (platform/runtime/venture/chief/plan.ts, review.ts, own-use.ts). It decides with the engine's own plan-core.ts and says the engine's own words through
 * plan-view.ts, so nothing here is a copy that can drift: only the facts are the fake's (its plan, clients, invoices,
 * the kept way, Today's rows, the goals desk's ranked row). The daily review is a routine in the fake's Routines too.
 *
 * The fake has no model: a review it runs answers with one fixed line when an AI serves the main tier and the chat
 * consent holds, raises no cards and adds no moves. The sample (Lumen Studio) has its review on since the morning, with
 * a week the chief worded; every other business starts as the engine starts one, from the records, with the offer.
 */

import { computerZone } from '../../../../platform/runtime/owner-format';
import { COUNTRY_TIME_ZONES } from '../../../../platform/runtime/venture/local-day-data';
import { nextOccurrence } from '../../../../platform/runtime/venture/agents/routine-time';
import {
  PLAN_FIXED_WORDS, codeLine, nextStepOf, ownerMove, seedPlan, setupProgress, syncPlan, type PlanFacts, type PlanMove, type StandingPlan,
} from '../../../../platform/runtime/venture/chief/plan-core';
import {
  DAILY_REVIEW_TIME, OWN_USE_DEFAULT, OWN_USE_RUNS_MAX, OWN_USE_WORDS, REVIEW_OFFER_SUBJECT, REVIEW_OFFER_TITLE, REVIEW_WORDS, SETUP_KIND, STEP_WORDS, moveView, ownUseViewOf,
  reviewOfferLine, reviewWhen, stepView,
} from '../../../../platform/runtime/venture/chief/plan-view';
import {
  EngineError, type BlueprintViewLite, type ChatConsentView, type ChiefPlanView, type ChiefReviewView, type GoalView, type InvoiceLite, type ModelStatusLite, type OwnerView,
  type QueueRow, type VentureViewLite,
} from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_PLAN_METHODS: readonly string[] = ['venture.chief.plan.get', 'venture.chief.plan.move', 'venture.chief.review.set'];

/** The daily review as the fake's Routines desk keeps it (fake-4j22a.ts), which this desk reads and sets. */
export interface ReviewRoutines {
  /** A business's daily review, removed ones left out. */
  find(business: string): { id: string; on: boolean; time: string; timeZone: string } | null;
  /** Whether a business ever had one. */
  ever(business: string): boolean;
  /** Makes it, or changes the one there: on or off, at a time. */
  set(business: string, on: boolean, time: string): void;
}

interface Held {
  plan: StandingPlan | null;
  line: { text: string; estimate: boolean; by: 'ai' | 'records'; day: string } | null;
  /** waits: the AI was not asked only because the chat consent was missing (chief/review.ts aiGate). */
  reviewed: { at: string; line: string; by: 'ai' | 'records'; note: string | null; waits?: 'consent' } | null;
  ownUse: { day: string; runs: number };
  allowance: { runsPerDay: number; capMicros: string };
  /** The owner answered the offer (on, or not now), so it is not made again. */
  offerDecided: boolean;
}

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): void {
  if (Object.keys(p).some((key) => !allowed.includes(key)) || required.some((key) => !(key in p))) throw invalid('Send the required fields and nothing else.');
}

/** The sample's week, as the chief's reviews left it this morning. */
const SAMPLE_MOVES: readonly Omit<PlanMove, 'at'>[] = [
  { id: 'mv_sample_1', text: 'Record the next episode.', source: 'chief', state: 'done', by: 'owner' },
  { id: 'mv_sample_2', text: 'Reply to the sponsors who wrote back.', source: 'chief', state: 'waiting', by: 'records' },
  { id: 'mv_sample_3', text: 'Plan next month\'s episodes.', source: 'chief', state: 'planned', by: 'chief' },
];
const SAMPLE_LINE = 'Approvals are holding up the next episode, so start there.';
/** What the fake's AI says of a day when a review asks it. */
const FAKE_AI_LINE = 'Start with what waits for you on Today.';

export class FakePlan {
  private readonly host: W4DeskHost;
  private readonly routines: ReviewRoutines;
  private readonly held = new Map<string, Held>();

  constructor(host: W4DeskHost, routines: ReviewRoutines, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.routines = routines;
    if (!options.fresh) this.seedSample();
  }

  request(method: string, p: Record<string, unknown>): unknown {
    // As the engine's readVenture: no business open, nothing to read or set.
    if (!this.host.current() || !this.venture()) throw new EngineError('VENTURE_NOT_FOUND', 'Start a business first.');
    if (method === 'venture.chief.plan.get') { exact(p, []); return this.view(); }
    if (method === 'venture.chief.plan.move') return this.move(p);
    if (method === 'venture.chief.review.set') return this.setReview(p);
    throw new EngineError('METHOD_NOT_ALLOWED', 'The sample business can\'t do that yet.');
  }

  // ------------------------------------------------------------------------------------------------ the facts

  private venture() { return this.host.ask('venture.get', {}) as VentureViewLite | null; }

  private zone(): string { return COUNTRY_TIME_ZONES[this.venture()?.venture.country?.code ?? 'IN'] ?? 'UTC'; }

  /** Today on the owner's calendar, where the business is. */
  private today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.zone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.host.now()));
  }

  private state(): Held {
    const id = this.host.current();
    let held = this.held.get(id);
    if (!held) {
      held = { plan: null, line: null, reviewed: null, ownUse: { day: this.today(), runs: 0 }, allowance: { ...OWN_USE_DEFAULT }, offerDecided: false };
      this.held.set(id, held);
    }
    return held;
  }

  private seedSample(): void {
    const at = '2026-10-23T02:30:00.000Z';
    this.held.set('lumen', {
      plan: { weekOf: '2026-10-19', moves: SAMPLE_MOVES.map((move) => ({ ...move, at })), past: [] },
      line: { text: SAMPLE_LINE, estimate: false, by: 'ai', day: '2026-10-23' },
      reviewed: { at, line: REVIEW_WORDS.withAi(0), by: 'ai', note: null },
      ownUse: { day: '2026-10-23', runs: 1 }, allowance: { ...OWN_USE_DEFAULT }, offerDecided: true,
    });
    this.routines.set('lumen', true, DAILY_REVIEW_TIME);
  }

  private blueprint(): BlueprintViewLite | null {
    try { return this.host.ask('venture.blueprint.get', {}) as BlueprintViewLite | null; } catch { return null; }
  }

  private invoices(): InvoiceLite[] {
    try { return this.host.ask('venture.invoice.list', {}) as InvoiceLite[]; } catch { return []; }
  }

  /** As core/way-ready.ts offerReadiness: the plan first, then each offer that has no price, by name. */
  private readiness(): { accepted: boolean; ready: boolean; missing: string[] } {
    const plan = this.blueprint()?.blueprint ?? null;
    const accepted = plan?.status === 'accepted' || (this.host.acceptedOffers?.().length ?? 0) > 0;
    const unpriced = plan && plan.status === 'accepted' ? plan.offers.filter((offer) => offer.pricing.unitPriceMinor === null).map((offer) => `Set your price for ${offer.name.value}.`) : [];
    const missing = !accepted ? [PLAN_FIXED_WORDS.planFirst] : unpriced;
    return { accepted, ready: accepted && missing.length === 0, missing };
  }

  /** venture.get's done and total: how far what is sold is from ready, as the plan counts its setup. */
  setup(): { done: number; total: number } {
    return setupProgress(this.readiness());
  }

  /** What plan-core decides from, as the engine's planFacts reads it; the fake's own records stand in for the vault's. */
  private facts(): PlanFacts {
    const { accepted, ready, missing } = this.readiness();
    const invoices = this.invoices();
    let clients = 0;
    try { clients = (this.host.ask('venture.client.list', {}) as unknown[]).length; } catch { clients = 0; }
    let way: OwnerView['way'];
    try { way = (this.host.ask('venture.owner.get', {}) as OwnerView).way; } catch { way = undefined; }
    return {
      today: this.today(), accepted, ready, missing, clients,
      invoicesIssued: invoices.filter((invoice) => invoice.status === 'issued' || invoice.status === 'part-paid' || invoice.status === 'paid').length,
      payments: this.host.paymentFacts?.().length ?? invoices.filter((invoice) => invoice.status === 'paid' || invoice.status === 'part-paid').length,
      firstWeek: way?.firstWeek ?? [], proposals: {},
    };
  }

  /** The plan as it stands now: the kept one run through the records, or this week's from the records alone. */
  private now(): { plan: StandingPlan; facts: PlanFacts } {
    const held = this.state();
    const facts = this.facts();
    const plan = held.plan ? syncPlan(held.plan, facts, this.host.now()) : seedPlan(facts, this.host.now());
    return { plan, facts };
  }

  /**
   * Events move the plan: a write the plan is read from keeps it at once, as the engine's keepPlan does in the same
   * commit. The fake's desks say such a write with a queue change, so fake.ts calls this on each one.
   */
  keep(): void {
    if (!this.host.current() || !this.venture()) return;
    const held = this.state();
    const { plan } = this.now();
    if (plan !== held.plan) held.plan = plan;
  }

  private rows(): QueueRow[] {
    return (this.host.waiting?.() ?? this.host.rows()).filter((row) => row.businessId === this.host.current() && row.kind !== 'locked');
  }

  private mainPreset(): string | null {
    try {
      const tier = (this.host.ask('venture.models.status', {}) as ModelStatusLite).tiers.main;
      return tier && tier.presetId !== 'built-in-templates' ? tier.presetId : null;
    } catch { return null; }
  }

  /** As money/spend-meter.ts keyedPreset: the tools on this computer run on the owner's plan, every other AI on a key. */
  private keyed(): boolean {
    const preset = this.mainPreset();
    return preset !== null && preset !== 'codex-cli' && preset !== 'claude-code-cli';
  }

  // ------------------------------------------------------------------------------------------------ the view

  private reviewView(): ChiefReviewView {
    const held = this.state();
    const routine = this.routines.find(this.host.current());
    const time = routine?.time ?? DAILY_REVIEW_TIME;
    const timeZone = routine?.timeZone ?? this.zone();
    const on = routine?.on === true;
    const today = this.today();
    const schedule = { kind: 'calendar' as const, weekdays: [1, 2, 3, 4, 5, 6, 7], time, timeZone };
    const used = held.ownUse.day === today ? held.ownUse.runs : 0;
    const reviewedToday = held.reviewed && new Intl.DateTimeFormat('en-CA', { timeZone: this.zone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(held.reviewed.at)) === today;
    const offered = !this.routines.ever(this.host.current()) && !held.offerDecided;
    // As chief/plan.ts reviewView: the consent, and the line that asks for it, only while they are true.
    const missing = this.missingConsent();
    const asks = on && this.readiness().ready && !this.venture()?.paused;
    return {
      on, routineId: routine?.id ?? null, time, timeZone,
      offer: offered ? { title: REVIEW_OFFER_TITLE, line: reviewOfferLine(time, held.allowance.runsPerDay, this.mainPreset() !== null) } : null,
      when: reviewWhen(time, timeZone, this.host.hosted() ? null : computerZone()),
      next: routine && on ? nextOccurrence(schedule, Date.parse(this.host.now())) : null,
      last: held.reviewed ? { at: held.reviewed.at, line: held.reviewed.line, by: held.reviewed.by } : null,
      note: !on ? null : missing && asks ? REVIEW_WORDS.consent : held.reviewed && reviewedToday ? held.reviewed.note : null,
      consent: missing && (offered || asks) ? missing : null,
      ownUse: ownUseViewOf(held.allowance, used, this.keyed()),
      line: REVIEW_WORDS.line(on, time),
    };
  }

  /** As chief/plan.ts missingChatConsent: the chat consent while an AI is connected and it does not hold; else null. */
  private missingConsent(): ChatConsentView | null {
    if (!this.mainPreset()) return null;
    try {
      const view = (this.host.ask('venture.chief.threads', {}) as { consent: ChatConsentView }).consent;
      return view.state === 'needed' || view.state === 'stale' ? view : null;
    } catch { return null; }
  }

  /**
   * The chat consent was given just now (fake-agents.ts), as chief/review.ts reviewAfterConsent: the plan reads again,
   * and when the review is on and today's review was held for exactly that, one review runs now.
   */
  afterConsent(): void {
    if (!this.host.current() || !this.venture()) return;
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    const held = this.state();
    const day = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: this.zone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
    if (this.routines.find(this.host.current())?.on !== true || held.reviewed?.waits !== 'consent' || day(held.reviewed.at) !== this.today()) return;
    this.review();
  }

  /** The most overdue open invoice today, as chief/plan.ts mostOverdue reads it. */
  private overdue(): { invoiceId: string; number: string; days: number } | null {
    const today = Date.parse(`${this.today()}T00:00:00.000Z`);
    let worst: { invoiceId: string; number: string; days: number } | null = null;
    for (const invoice of this.invoices()) {
      if ((invoice.status !== 'issued' && invoice.status !== 'part-paid') || invoice.number === null || invoice.dueDate === null) continue;
      const days = Math.round((today - Date.parse(`${invoice.dueDate}T00:00:00.000Z`)) / 86_400_000);
      if (days > 0 && (!worst || days > worst.days)) worst = { invoiceId: invoice.id, number: invoice.number, days };
    }
    return worst;
  }

  private view(): ChiefPlanView {
    const held = this.state();
    const { plan, facts } = this.now();
    const rows = this.rows();
    const goal = this.host.ask('venture.goals.get', {}) as GoalView;
    const review = this.reviewView();
    const ranked = goal.next ? { rowId: goal.next.rowId, title: goal.next.title, agent: goal.next.agent, line: goal.next.line, figure: goal.next.figure, goalAfterPercent: goal.next.goalAfterPercent } : null;
    // As chief/plan.ts planView: the queue names a setup card only when no other row waits, and the step ranks it last.
    const rankedKind = ranked ? rows.find((row) => row.id === ranked.rowId)?.kind : undefined;
    const core = nextStepOf({
      facts, row: ranked ? { rowId: ranked.rowId, title: ranked.title, setup: rankedKind === SETUP_KIND, notice: rankedKind === 'notice' } : null,
      planRowId: rows.find((row) => row.kind === 'plan')?.id ?? null,
      overdue: this.overdue(), moves: plan.moves,
    });
    const said = held.line && held.line.day === facts.today ? held.line : null;
    return {
      weekOf: plan.weekOf,
      goal: { month: goal.month, state: goal.state, line: goal.line, percent: goal.invoicedPercent, figure: goal.goal },
      line: said ? { text: said.text, estimate: said.estimate, by: said.by } : { text: codeLine(facts, plan.moves), estimate: false, by: 'records' },
      next: stepView(core, { rows, ranked: core.kind === 'row' && ranked?.rowId === core.rowId ? ranked : null, moves: plan.moves, reviewOn: review.on }),
      moves: plan.moves.map((move) => moveView(move, null)),
      review,
    };
  }

  // ------------------------------------------------------------------------------------------------ the owner's tick

  private appOnly(): void {
    if (this.host.hosted()) throw new EngineError('APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
  }

  private move(p: Record<string, unknown>): ChiefPlanView {
    this.appOnly();
    exact(p, ['id', 'to'], ['id', 'to']);
    if (typeof p.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(p.id)) throw invalid('Move must be a known identifier.');
    if (p.to !== 'done' && p.to !== 'dropped' && p.to !== 'planned') throw invalid(STEP_WORDS.moveTo);
    const { plan, facts } = this.now();
    const moved = ownerMove(plan, p.id, p.to, facts, this.host.now());
    if (!moved) throw invalid(STEP_WORDS.moveRefused);
    this.state().plan = moved;
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    return this.view();
  }

  // ------------------------------------------------------------------------------------------------ the daily review

  /**
   * One review, as chief/review.ts runs it: the code part always, the AI only when one serves the main tier, the chat
   * consent holds, what is sold is ready and the day's allowance is not used. The fake's AI says one fixed line.
   */
  private review(): void {
    const held = this.state();
    const { plan, facts } = this.now();
    const today = facts.today;
    const used = held.ownUse.day === today ? held.ownUse.runs : 0;
    let note: string | null = null;
    let ask = false;
    let waits = false;
    let consent: ChatConsentView['state'] = 'needed';
    try { consent = (this.host.ask('venture.chief.threads', {}) as { consent: ChatConsentView }).consent.state; } catch { consent = 'needed'; }
    const paused = Boolean(this.venture()?.paused);
    if (this.mainPreset() && facts.ready && !paused) {
      // Held only for the consent: no note is kept (the view says it while it is true), only the mark.
      if (consent !== 'given') waits = true;
      else if (held.allowance.runsPerDay === 0) note = REVIEW_WORDS.held(OWN_USE_WORDS.never);
      else if (used >= held.allowance.runsPerDay) note = REVIEW_WORDS.held(OWN_USE_WORDS.runs(used));
      else ask = true;
    }
    held.plan = plan;
    held.ownUse = { day: today, runs: used + (ask ? 1 : 0) };
    held.line = ask ? { text: FAKE_AI_LINE, estimate: false, by: 'ai', day: today } : null;
    held.reviewed = { at: this.host.now(), line: ask ? REVIEW_WORDS.withAi(0) : note ?? REVIEW_WORDS.fromRecords, by: ask ? 'ai' : 'records', note, ...(waits ? { waits: 'consent' as const } : {}) };
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
  }

  private setReview(p: Record<string, unknown>): ChiefPlanView {
    this.appOnly();
    exact(p, ['on', 'time', 'runsPerDay', 'cap'], ['on']);
    if (typeof p.on !== 'boolean') throw invalid('on must be true or false.');
    if (p.time !== undefined && (typeof p.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.time))) throw invalid(REVIEW_WORDS.time);
    const held = this.state();
    const allowance = { ...held.allowance };
    if (p.runsPerDay !== undefined) {
      if (!Number.isInteger(p.runsPerDay) || (p.runsPerDay as number) < 0 || (p.runsPerDay as number) > OWN_USE_RUNS_MAX) throw invalid(OWN_USE_WORDS.runsRange);
      allowance.runsPerDay = p.runsPerDay as number;
    }
    if (p.cap !== undefined) {
      // As models/cost.ts usdToMicros with two decimals.
      const match = typeof p.cap === 'string' ? /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(p.cap.trim()) : null;
      if (!match) throw new EngineError('INVALID_AMOUNT', 'The daily limit must be an amount in US dollars with at most two decimals, like 20 or 12.50.');
      allowance.capMicros = String(BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0')));
    }
    const business = this.host.current();
    const before = this.routines.find(business);
    const time = p.time ?? before?.time ?? DAILY_REVIEW_TIME;
    const started = p.on && !before?.on;
    if (before || p.on) this.routines.set(business, p.on, time);
    held.allowance = allowance;
    // The owner's answer to the offer, on or not now, is their decision on the record: the offer is made once.
    held.offerDecided = true;
    this.host.noteDecision?.(REVIEW_OFFER_SUBJECT, p.on ? 'approve' : 'deny', REVIEW_WORDS.approved(p.on && this.routines.find(business) !== null, reviewWhen(time, this.routines.find(business)?.timeZone ?? this.zone(), this.host.hosted() ? null : computerZone())));
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    // Switching it on starts the first review at once, as the engine does.
    if (started) this.review();
    return this.view();
  }
}
