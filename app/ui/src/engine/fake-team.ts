/**
 * The fake engine's team desk for Ink v2 wave 4 package 4A2: venture.team.list as the engine sends it once 4A1 is in
 * (each agent's department, kind, state from its runs, health and who set its posture; Keeper last; the five
 * departments with their counts, jobs this week, spend this month and six-week series; the team's totals and its own
 * health), venture.team.keeper (Keeper's jobs and their last runs) and venture.team.clearQuarantine (the owner clears a
 * quarantined agent with the health digest they saw).
 *
 * The engine's rules (platform/runtime/venture/views/team.ts, team-series.ts, keeper.ts, health.ts): state comes from
 * facts only (working when a run of the agent is at work, waiting when it waits on the owner, failed when its latest run
 * failed, idle otherwise); Keeper is code in Operations with no steps, chat or posture to set, and its jobs say only
 * what a record shows; a week with no data has no value and no scale (null, never 0); the totals' spend is Money's own
 * figure and receipt, which the departments and the shared part add up to. Words are the engine's.
 *
 * Spend is in the engine's own shape: US dollars to four places with " (includes estimates)", the rupees beside at the
 * sample owner's rate, and the held words. The month's whole is Money's AI and tools figure (R-0431 on the sample
 * business, ₹60.10 at that rate), split the way the engine splits it; the receipts this desk makes are served by `receipt`.
 */

import { EngineError, type AgentHealth, type AgentView, type DepartmentId, type DepartmentSpend, type DepartmentView, type KeeperJobView, type ModelStatusLite, type ReceiptLite, type RunSummary, type SeriesPoint, type TeamListView } from './types';
import type { W4DeskHost } from './fake-w4';
// 4Z3: which currency leads spend, as the engine's money/spend.ts.
import { dollarsLead, rupeeAmount, rupeesAt, rupeesLead, spendLead, spendSettings, type SampleRate } from './fake-lead';

export const FAKE_4A2_METHODS: readonly string[] = ['venture.team.keeper', 'venture.team.clearQuarantine'];

/** The engine's ids and words (views/keeper.ts, views/health.ts, playbooks/departments.ts). */
export const KEEPER_ID = 'keeper';
const TEAM_ID = 'team';
const DEPARTMENTS: readonly { id: DepartmentId; name: string }[] = [
  { id: 'sales', name: 'Sales and clients' },
  { id: 'marketing', name: 'Marketing' },
  { id: 'production', name: 'Production' },
  { id: 'money', name: 'Money' },
  { id: 'operations', name: 'Operations' },
];
const KEEPER_ROLE = 'Runs the engine\'s own jobs as code, not AI: backups, the journal sweep, connection checks, rule and rate dates, posting steps and network strength.';
const KEEPER_IS_CODE = 'Keeper is code, not AI. It has no steps or posture to change; its jobs are on Team.';
const CLEAR_STALE = "This agent's health changed since you looked, or it is not quarantined now. Look again before clearing it.";
const UNDECLARED = 'It proposed an outside action that none of its steps allows. Look at its runs before you clear it.';
const WEEKS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const WEEK_LABELS = ['Week of 14 Sep 2026', 'Week of 21 Sep 2026', 'Week of 28 Sep 2026', 'Week of 05 Oct 2026', 'Week of 12 Oct 2026', 'Week of 19 Oct 2026'];

/**
 * One department's sample: jobs per week (this week last), spend per week and this month in micro-dollars (the engine
 * counts spend in US dollars, what providers bill, and shows rupees beside at the owner's rate), whether a running call
 * counts at its estimate, and what running calls hold.
 */
interface DeptSample { jobs: (number | null)[]; spend: (number | null)[]; month: number; estimate?: boolean; held?: number }
interface Sample {
  departments: Partial<Record<DepartmentId, DeptSample>>;
  /** Money's own figure for the month (its receipt is the overview's), in micro-dollars, and what running calls hold. */
  total: { receiptId: string; micros: number; estimate?: boolean; held?: number };
  /** Spend no single role's steps can claim, in micro-dollars, or null when there is none. */
  shared: number | null;
  /** Agents the sample has quarantined, with why (the engine's words). */
  quarantined: Record<string, string>;
  keeper: KeeperJobView[];
}

const none = (): (number | null)[] => [null, null, null, null, null, null];

const SAMPLES: Record<string, Sample> = {
  lumen: {
    departments: {
      production: { jobs: [3, 4, 5, 4, 6, 4], spend: [37400, 34300, 52800, 43700, 62600, 45500], month: 455100 },
      marketing: { jobs: [2, null, 3, 2, 4, 3], spend: [10800, null, 15000, 7200, 21600, 215600], month: 215600, estimate: true, held: 215600 },
      sales: { jobs: [1, 1, null, 2, 1, 1], spend: none(), month: 0 },
    },
    total: { receiptId: 'R-0431', micros: 719800, estimate: true, held: 215600 },
    shared: 49100,
    quarantined: {},
    keeper: [
      { id: 'backups', name: 'Backups', lastRun: { at: '2026-10-21T02:00:00.000Z', outcome: 'ok', line: '2 automatic backups kept on this computer. The newest is from 21 Oct 2026.' }, note: null },
      { id: 'journal-sweep', name: 'Journal sweep', lastRun: { at: '2026-10-21T09:00:00.000Z', outcome: 'ok', line: 'Nothing was left half done.' }, note: null },
      { id: 'connection-checks', name: 'Connection checks', lastRun: null, note: 'Not run yet.' },
      { id: 'rule-freshness', name: 'Platform rule dates', lastRun: { at: '2026-10-21T09:00:00.000Z', outcome: 'warn', line: 'Platform rules: 1 of 3 is past its review date.' }, note: null },
      { id: 'rate-tables', name: 'Tax rate tables', lastRun: null, note: 'Not needed for this business.' },
      { id: 'posting-steps', name: 'Posting steps', lastRun: null, note: 'Not needed for this business.' },
      { id: 'network-strength', name: 'Network strength', lastRun: null, note: 'Not run yet.' },
    ],
  },
  ledgerline: {
    departments: {
      money: { jobs: [5, 6, 4, 7, 6, 5], spend: [35700, 37200, 32800, 40100, 36200, 14900], month: 401200 },
    },
    total: { receiptId: 'R-0412', micros: 401200 },
    shared: null,
    quarantined: { billing: UNDECLARED },
    keeper: [
      { id: 'backups', name: 'Backups', lastRun: null, note: 'Automatic backups are off.' },
      { id: 'journal-sweep', name: 'Journal sweep', lastRun: { at: '2026-10-21T09:00:00.000Z', outcome: 'ok', line: '1 approval or proposal ran out and was closed.' }, note: null },
      { id: 'connection-checks', name: 'Connection checks', lastRun: null, note: 'Not run yet.' },
      { id: 'rule-freshness', name: 'Platform rule dates', lastRun: null, note: 'Not needed for this business.' },
      { id: 'rate-tables', name: 'Tax rate tables', lastRun: { at: '2026-10-21T09:00:00.000Z', outcome: 'warn', line: '1 tax rate table waits for your CA to confirm it.' }, note: null },
      { id: 'posting-steps', name: 'Posting steps', lastRun: null, note: 'Not needed for this business.' },
      { id: 'network-strength', name: 'Network strength', lastRun: null, note: 'Not run yet.' },
    ],
  },
};

/** A business the samples do not know (one made in the fake's own onboarding): every job not run yet, no spend. */
const EMPTY: Sample = {
  departments: {},
  total: { receiptId: '', micros: 0 },
  shared: null,
  quarantined: {},
  keeper: (['backups', 'journal-sweep', 'connection-checks', 'rule-freshness', 'rate-tables', 'posting-steps', 'network-strength'] as const)
    .map((id) => ({ id, name: ({ backups: 'Backups', 'journal-sweep': 'Journal sweep', 'connection-checks': 'Connection checks', 'rule-freshness': 'Platform rule dates', 'rate-tables': 'Tax rate tables', 'posting-steps': 'Posting steps', 'network-strength': 'Network strength' })[id], lastRun: null, note: 'Not run yet.' })),
};

/** The engine's share (views/team-series.ts sharePermille): of the whole, floored; 0 when the whole is 0. */
const share = (part: number, whole: number) => (whole > 0 ? Math.floor((part * 1000) / whole) : 0);

/** The engine's words for spend (records.ts formatMicros, money/spend.ts): US dollars to four places, the estimate words. */
const usd = (micros: number) => `USD ${Math.floor(micros / 1_000_000)}.${String(Math.floor((micros % 1_000_000) / 100)).padStart(4, '0')}`;
const ESTIMATES = ' (includes estimates)';
/**
 * money/department-spend.ts heldWords: the currency the owner's choice leads with first, dollars to two decimals, and
 * with a rate the other currency after it at that rate.
 */
const heldWords = (micros: number, rate: SampleRate | null, leads: boolean) => {
  const dollars = dollarsLead(micros);
  if (!rate) return `including ${dollars} held for running work`;
  const inr = rupeeAmount(micros, rate.perUsd);
  return leads ? `including ${inr} held for running work: ${dollars} at ${rate.words}` : `including ${dollars} held for running work: ${inr} at ${rate.words}`;
};

export class FakeTeamDesk {
  private readonly host: W4DeskHost;
  private readonly receipts = new Map<string, ReceiptLite>();
  /** Quarantines the owner cleared, by business and agent. */
  private readonly cleared = new Set<string>();
  private readonly made = new Map<string, string>();
  private readonly last = new Map<string, { agents: AgentView[]; runs: readonly RunSummary[] }>();
  private seq = 700;

  constructor(host: W4DeskHost) {
    this.host = host;
  }

  receipt(id: string): ReceiptLite | undefined {
    return this.receipts.get(id);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    if (method === 'venture.team.keeper') return { jobs: structuredClone(this.sample().keeper) };
    if (method === 'venture.team.clearQuarantine') return this.clear(p);
    throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
  }

  /** venture.team.list: the fake's agents (fake.ts) as the engine lists them, with the departments and totals. */
  list(agents: AgentView[], all: readonly RunSummary[]): TeamListView {
    this.last.set(this.host.current(), { agents, runs: all });
    if (agents.length === 0) return { agents: [] };
    const sample = this.sample();
    const runs = all.filter((run) => run.businessId === this.host.current());
    const team = [...agents.map((agent) => this.agentOf(agent, runs)), this.keeper()];
    const whole = sample.total.micros;
    const departments = DEPARTMENTS.map(({ id, name }) => this.department(id, name, team, sample.departments[id], whole));
    // Each department's jobs this week against the busiest department's, as the engine scales them (team-series.ts).
    const busiest = Math.max(0, ...departments.map((d) => d.doneThisWeek.count));
    for (const d of departments) d.doneThisWeek.permille = share(d.doneThisWeek.count, busiest);
    const jobs = departments.reduce((sum, d) => sum + d.doneThisWeek.count, 0);
    const held = sample.total.held;
    const heldId = held ? this.make('Held for running work this month: the estimates of calls still running.', usd(held)) : null;
    const totalDisplay = `${usd(whole)}${sample.total.estimate ? ESTIMATES : ''}`;
    return {
      agents: team,
      departments,
      shared: sample.shared === null ? null : {
        display: usd(sample.shared),
        receiptId: this.make("Shared by the team: calls no single role's steps could make, this month.", usd(sample.shared)),
        sharePermille: share(sample.shared, whole),
        ...this.spendWords(sample.shared, false),
      },
      totals: {
        doneThisWeek: { count: jobs, receiptId: this.make('Jobs done this week by the whole team: runs that reached review, and practice runs that finished.', String(jobs)) },
        spendThisMonth: {
          display: totalDisplay,
          receiptId: sample.total.receiptId || this.make('AI and tool calls this month.', totalDisplay),
          ...this.spendWords(whole, Boolean(sample.total.estimate)),
          ...(held && heldId ? { held: this.held(held), heldReceiptId: heldId } : {}),
        },
        held: held && heldId ? { display: usd(held), receiptId: heldId } : null,
      },
      teamHealth: this.health(TEAM_ID, null),
    };
  }

  /**
   * 4Z3: the owner's rupee rate and currency choice, read from the spend settings each time, as the engine reads them.
   */
  private settings() {
    return spendSettings(() => this.host.ask('venture.spend.policy.get', {}));
  }

  private held(micros: number): string {
    const { rate, choice } = this.settings();
    return heldWords(micros, rate, rupeesLead(choice));
  }

  /** The rupees at the owner's rate (none without one), that rate in words, and the figure as it leads (team-series.ts). */
  private spendWords(micros: number, estimate: boolean): Pick<DepartmentSpend, 'rupees' | 'rate' | 'lead'> {
    const { rate, choice } = this.settings();
    return {
      ...(rate ? { rupees: rupeesAt(micros, rate), rate: rate.words } : {}),
      lead: spendLead(micros, rate?.perUsd ?? null, rupeesLead(choice), estimate ? ESTIMATES : ''),
    };
  }

  /** One agent as the engine lists it: its department (the fixture's), kind, state from its runs, health and posture's setter. */
  private agentOf(agent: AgentView, runs: readonly RunSummary[]): AgentView {
    const reason = this.cleared.has(`${this.host.current()}:${agent.id}`) ? null : this.sample().quarantined[agent.id] ?? null;
    const state = stateOf(agent.name, runs);
    return {
      ...agent,
      // 4H2: an idle agent that needs an AI says "Connect your AI" while none can run (views/team.ts, models/roles.ts aiWaitLine).
      ...(state === 'idle' && (agent.kind ?? 'agent') === 'agent' && agent.now === 'Idle' && !this.aiCanRun() ? { now: 'Connect your AI' } : {}),
      department: agent.department ?? 'production',
      kind: agent.kind ?? 'agent',
      state,
      health: this.health(agent.id, reason),
      postureSetBy: agent.postureSetBy ?? 'business',
      chat: (agent.kind ?? 'agent') === 'agent',
    };
  }

  /** Whether a connected AI, not the templates, serves a tier and can run now (models/roles.ts usableTier). */
  private aiCanRun(): boolean {
    try {
      const status = this.host.ask('venture.models.status', {}) as ModelStatusLite;
      return (['fast', 'main'] as const).some((tier) => status.tiers[tier].usable && status.tiers[tier].presetId !== 'built-in-templates');
    } catch {
      return true;
    }
  }

  private keeper(): AgentView {
    const failed = this.sample().keeper.some((job) => job.lastRun?.outcome === 'failed');
    return {
      id: KEEPER_ID, name: 'Keeper', role: KEEPER_ROLE, now: 'Idle', posture: 'approve-each', spend: '$0.00', steps: [],
      department: 'operations', kind: 'code', state: failed ? 'failed' : 'idle', chat: false,
    };
  }

  private health(id: string, reason: string | null): AgentHealth {
    const status = reason ? 'quarantined' : 'healthy';
    return { status, reason, digest: this.host.digest({ agentId: id, status, reason }) };
  }

  private department(id: DepartmentId, name: string, team: readonly AgentView[], sample: DeptSample | undefined, whole: number): DepartmentView {
    const members = team.filter((agent) => agent.department === id);
    const of = (state: AgentView['state']) => members.filter((agent) => agent.state === state).length;
    const jobs = sample?.jobs ?? none();
    const spend = sample?.spend ?? none();
    const done = jobs[jobs.length - 1] ?? 0;
    const micros = sample?.month ?? 0;
    const spent: DepartmentSpend = {
      display: `${usd(micros)}${sample?.estimate ? ESTIMATES : ''}`,
      receiptId: this.make(`${name}: AI and tool calls this month that only its agents' steps could make.`, usd(micros)),
      sharePermille: share(micros, whole),
      ...this.spendWords(micros, Boolean(sample?.estimate)),
    };
    if (sample?.held) Object.assign(spent, { held: this.held(sample.held), heldReceiptId: this.make(`${name}: held for running work this month.`, usd(sample.held)) });
    return {
      id, name,
      counts: { working: of('working'), waiting: of('waiting'), stopped: of('failed'), idle: members.length - of('working') - of('waiting') - of('failed') },
      doneThisWeek: { count: done, receiptId: this.make(`${name}: jobs done this week.`, String(done)) },
      spendThisMonth: spent,
      series: {
        jobs: this.series(name, jobs, String),
        spend: this.series(name, spend, usd, true),
      },
    };
  }

  /** A series scaled to its largest week in integer per mille; a week with nothing is null, never 0. */
  private series(name: string, values: readonly (number | null)[], words: (value: number) => string, money = false): SeriesPoint[] {
    const largest = Math.max(0, ...values.map((value) => value ?? 0));
    const { rate, choice } = this.settings();
    return values.map((value, at) => (value === null || value === 0 || largest === 0
      ? { key: WEEKS[at]!, label: WEEK_LABELS[at]!, value: null, valuePermille: null, receiptId: null }
      : {
        key: WEEKS[at]!, label: WEEK_LABELS[at]!, value: words(value), valuePermille: Math.floor((value * 1000) / largest), receiptId: this.make(`${name}: ${WEEK_LABELS[at]}.`, words(value)),
        // A money week in rupees too at the owner's rate, and 4Z3: as the owner's currency leads it (team-series.ts).
        ...(money && rate ? { rupees: rupeesAt(value, rate) } : {}),
        ...(money ? { lead: spendLead(value, rate?.perUsd ?? null, rupeesLead(choice)) } : {}),
      }));
  }

  private clear(p: Record<string, unknown>) {
    const agentId = typeof p.agentId === 'string' ? p.agentId : '';
    if (agentId === KEEPER_ID) throw new EngineError('AGENT_IS_CODE', KEEPER_IS_CODE);
    const view = this.again();
    const agent = view.agents.find((one) => one.id === agentId);
    const health = agentId === TEAM_ID ? view.teamHealth : agent?.health;
    if (!health) throw new EngineError('AGENT_NOT_FOUND', 'That agent was not found.');
    if (health.status !== 'quarantined' || health.digest !== p.digest) throw new EngineError('APPROVAL_STALE', CLEAR_STALE);
    this.cleared.add(`${this.host.current()}:${agentId}`);
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    const after = this.again();
    return { agent: agentId === TEAM_ID ? null : after.agents.find((one) => one.id === agentId) ?? null, teamHealth: after.teamHealth! };
  }

  /** The team as last listed for this business, read again (fake.ts gives this desk its agents and runs on each list). */
  private again(): TeamListView {
    const last = this.last.get(this.host.current());
    return last ? this.list(last.agents, last.runs) : { agents: [] };
  }

  private sample(): Sample {
    return SAMPLES[this.host.current()] ?? EMPTY;
  }



  /** A sum receipt for a figure this desk shows: the same sum keeps its receipt from read to read, as the engine's do. */
  private make(explanation: string, display: string): string {
    const key = `${this.host.current()}|${explanation}|${display}`;
    const known = this.made.get(key);
    if (known) return known;
    const id = `R-0${this.seq++}`;
    this.made.set(key, id);
    this.receipts.set(id, { id, at: this.host.now(), explanation, stale: false, figures: [{ key: 'total', label: 'Total', display }] });
    return id;
  }
}

/** The engine's state from facts: waiting on the owner, then at work, then failed when the latest run failed, else idle. */
function stateOf(name: string, runs: readonly RunSummary[]): NonNullable<AgentView['state']> {
  const mine = runs.filter((run) => run.agent === name);
  if (mine.some((run) => run.state === 'waiting')) return 'waiting';
  if (mine.some((run) => run.state === 'active')) return 'working';
  const latest = [...mine].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
  return latest?.state === 'failed' ? 'failed' : 'idle';
}
