/**
 * The fake engine for `npm run dev:ui` and for tests. It answers the same methods with the same shapes and keeps the
 * same rules the real engine keeps: decide once, refuse a stale digest and hand back the new version, refuse an
 * approval before the draft was viewed (VIEW_FIRST), refuse loosening an always-ask step (GATE_FLOOR), refuse
 * opening a passphrase business without it. Figures are fixed sample text; nothing is computed for display.
 */

import { AGENTS, BOOKS, BUSINESSES, CLIENTS, CONNECTORS, EVIDENCE, JOURNAL, QUEUE, RECEIPTS, RUNS, SPEND } from './fixtures';
import { COUNTRIES, NEW_BUSINESS_ROWS, SAMPLE_RECOVERY_CODE, SERVICE_KEYWORDS, SERVICE_LABELS, type FakeBusiness } from './fixtures';
import type { BlueprintViewLite, InterviewAnswer, InterviewQuestionLite, ServiceType, WorkspaceCreated } from './types';
import { createStatusStore } from './client';
import { QUEUE_VIEWS } from './fixtures';
import { FakeBusinessDesk } from './fake-business';
import { FakeWorkDesk } from './fake-work';
import { FakeMoney } from './fake-money';
import { FakeExtrasDesk } from './fake-extras';
import type { OrderLite } from './types';
import { EngineError, type AgentView, type ClientLite, type EngineClient, type EvidenceItem, type MethodName, type ParamsOf, type Posture, type QueueAction, type QueueDecision, type QueueRow, type ResultOf, type RunDetail, type VentureRunEvent } from './types';

const clone = <T>(value: T): T => structuredClone(value);

/** FNV-1a over canonical JSON: enough for a fake digest. The real engine uses sha256. */
export function digestOf(value: unknown): string {
  const text = JSON.stringify(value, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

const DONE_LINES: Partial<Record<QueueAction['id'], string>> = {
  approve: 'Approved', deny: 'Denied', later: 'Moved to later', answer: 'Answered', 'send-to-ca': 'Sent to your CA',
  issue: 'Issued', connect: 'Opened Connections', 'set-prices': 'Opened prices', keep: 'Kept on this computer', 'run-again': 'Started again',
};
const RECEIPTED = new Set(['price', 'quote', 'invoice']);

export interface FakeOptions {
  latencyMs?: number; now?: () => string;
  /** A computer with no business yet and no vault open: the first run. */
  fresh?: boolean;
  /** false: this computer has no protected storage, so a new vault needs a passphrase (DEVICE_KEYS_UNAVAILABLE). */
  deviceKeys?: boolean;
  /** Answer as the hosted web server does: server custody, no folder, the recovery code always shown once. */
  hosted?: boolean;
  /** The queue to start with, in place of the sample QUEUE (for example [] for "Nothing needs you."). */
  queue?: Omit<QueueRow, 'digest'>[];
  /** The businesses on this computer start closed: none is open (Welcome back). `?closed` in the dev page's address. */
  closed?: boolean;
  /** Keep only these sample businesses on this computer, by id (for example ['lumen']). */
  only?: string[];
}

/** A business on this computer, as the fake keeps it. */
interface HeldBusiness extends FakeBusiness { recovery: 'made' | 'not-made' }
interface HeldVenture { workingName: string; serviceType: ServiceType | null; idea: string; countryCode: string; done: number }
/** Answered with no vault open, as the engine answers them before its vault check. */
const BEFORE_VAULT = new Set(['workspace.status', 'workspace.list', 'workspace.open', 'workspace.create', 'workspace.lock', 'venture.countries', 'venture.preview']);
const NOT_ONBOARDING = Symbol('not onboarding');
/** A flag in the dev page's address, such as ?fresh. Never true in tests, which have no query. */
function devAsks(flag: string): boolean {
  try { return typeof location !== 'undefined' && new URLSearchParams(location.search).has(flag); } catch { return false; }
}

function classify(idea: string): ServiceType {
  const text = idea.toLowerCase();
  let best: ServiceType = 'other';
  let hits = 0;
  for (const [type, words] of Object.entries(SERVICE_KEYWORDS) as [Exclude<ServiceType, 'other'>, readonly string[]][]) {
    const found = words.filter((word) => text.includes(word)).length;
    if (found > hits) { best = type; hits = found; }
  }
  return best;
}

/**
 * The queue in the engine's order (views/queue.ts): the plan, price and setup rows lead, plan first, whatever their
 * times; then every other row oldest first; locked businesses last.
 */
const LEAD_RANK: Partial<Record<QueueRow['kind'], number>> = { plan: 0, price: 0, setup: 1 };
const queueGroup = (row: QueueRow) => (row.kind === 'locked' ? 2 : row.kind in LEAD_RANK ? 0 : 1);
export const queueOrder = (a: QueueRow, b: QueueRow) => queueGroup(a) - queueGroup(b)
  || (queueGroup(a) === 0 ? (LEAD_RANK[a.kind] ?? 0) - (LEAD_RANK[b.kind] ?? 0) : 0)
  || (a.kind === 'locked' ? 0 : a.createdAt.localeCompare(b.createdAt));

export class FakeEngine {
  private rows: QueueRow[];
  private decided = new Set<string>();
  private runs: RunDetail[];
  private agents: Record<string, AgentView[]>;
  private clients: Record<string, ClientLite[]>;
  private evidence: EvidenceItem[];
  private clientSeq = 1;
  private current = 'lumen';
  private receiptSeq = 421;
  private seq = 40;
  private listeners = new Set<(event: VentureRunEvent) => void>();
  private readonly latencyMs: number;
  private readonly now: () => string;
  // Onboarding: the businesses on this computer, whether a vault is open, and each new business's interview.
  private businesses: HeldBusiness[];
  private ventures = new Map<string, HeldVenture>();
  private interviews = new Map<string, InterviewQuestionLite[]>();
  private open = true;
  private closedByOwner = false;
  private readonly deviceKeys: boolean;
  private readonly hosted: boolean;
  /** Your AI, plan and prices, website build: fake-business.ts. */
  private readonly desk: FakeBusinessDesk;
  /** Orders, delivery runs, invoices and client files: fake-work.ts. */
  private readonly work: FakeWorkDesk;
  /** Invoices and payments, the books' open invoices: fake-money.ts. Public so a test can change a draft (money.touch). */
  readonly money: FakeMoney;
  /** Money at a glance, tax working, spend settings, the CA page, leads, bank imports, site edits, links: fake-extras.ts. */
  private readonly extras: FakeExtrasDesk;

  constructor(options: FakeOptions = {}) {
    // `npm run dev:ui` can show the first run: add ?fresh to the address (and ?no-keys for a computer without
    // protected storage). Tests pass the options instead.
    const fresh = options.fresh ?? devAsks('fresh');
    this.rows = (options.queue ?? QUEUE).map((seed) => ({ ...clone(seed), digest: digestOf(seed) }));
    this.runs = clone(RUNS);
    this.agents = clone(AGENTS);
    this.clients = clone(CLIENTS);
    this.evidence = clone(EVIDENCE);
    this.latencyMs = options.latencyMs ?? 0;
    this.now = options.now ?? (() => new Date().toISOString());
    this.businesses = BUSINESSES.filter((b) => !options.only || options.only.includes(b.id)).map((b): HeldBusiness => ({ ...clone(b), recovery: 'made' }));
    for (const b of BUSINESSES) this.ventures.set(b.id, { workingName: b.name, serviceType: b.serviceType, idea: '', countryCode: 'IN', done: 6 });
    this.deviceKeys = options.deviceKeys ?? !devAsks('no-keys');
    this.hosted = options.hosted ?? false;
    this.desk = new FakeBusinessDesk({
      current: () => this.current, now: () => this.now(), receiptId: () => `R-0${this.receiptSeq++}`,
      businessName: (id) => this.businesses.find((b) => b.id === id)?.name ?? id,
      rows: () => this.rows, setRows: (rows) => { this.rows = rows; }, digest: digestOf,
      settle: (id) => { this.decided.add(id); }, emit: (event) => this.emit(event),
      business: (id) => this.businesses.find((b) => b.id === id) ?? null, deviceKeys: () => this.deviceKeys && !this.hosted,
    }, { fresh });
    this.work = new FakeWorkDesk({
      current: () => this.current, now: () => this.now(), clients: () => this.clients[this.current] ?? [],
      plan: () => this.desk.request('venture.blueprint.get', {}) as BlueprintViewLite | null,
      runs: () => this.runs, agentName: () => this.agents[this.current]?.[0]?.name ?? 'Agent', emit: (event) => this.emit(event),
    }, { fresh });
    this.money = new FakeMoney({
      now: () => this.now(), business: () => this.current, clients: () => this.clients[this.current] ?? [],
      orders: () => this.work.request('venture.order.list', {}) as OrderLite[],
      changed: () => this.emit({ type: 'queue.changed', businessId: this.current, at: this.now() }),
    });
    this.extras = new FakeExtrasDesk({
      current: () => this.current, now: () => this.now(), businessName: (id) => this.businesses.find((b) => b.id === id)?.name ?? id,
      playbook: (id) => this.desk.playbook(id), owed: () => this.money.owed(), hosted: () => this.hosted, emit: (event) => this.emit(event),
    }, { fresh });
    if (fresh) {
      this.rows = []; this.runs = []; this.agents = {}; this.clients = {}; this.evidence = [];
      this.businesses = []; this.ventures.clear(); this.open = false; this.current = '';
    } else if (options.closed ?? devAsks('closed')) {
      this.open = false; this.current = '';
    }
  }

  subscribe(listener: (event: VentureRunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(event: VentureRunEvent): void {
    this.seq += 1;
    for (const listener of [...this.listeners]) listener(event);
  }

  /** Test and demo helper: the row changes after the owner opened it, so its digest changes too. */
  touch(id: string): QueueRow {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new EngineError('NOT_FOUND', 'No such row.');
    const { digest: _old, ...rest } = row;
    const seed = { ...rest, line: `${rest.line ?? ''} Updated after the client replied.`.trim(), change: rest.change ? { ...rest.change, after: `${rest.change.after} (revised)` } : undefined };
    if (!seed.change) delete seed.change;
    const next = { ...seed, digest: digestOf(seed) } as QueueRow;
    this.rows = this.rows.map((r) => (r.id === id ? next : r));
    this.emit({ type: 'queue.changed', businessId: row.businessId, at: this.now() });
    return clone(next);
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    const p = (params ?? {}) as Record<string, unknown>;
    if (!this.open && !BEFORE_VAULT.has(method) && !method.startsWith('venture.ai.') && !method.startsWith('venture.compose.')) throw new EngineError('VAULT_LOCKED', 'Open your workspace first.');
    const started = this.onboarding(method, p);
    if (started !== NOT_ONBOARDING) return started;
    // Invoices and payments answer from one desk.
    if (FakeMoney.answers(method)) return this.money.request(method, p);
    switch (method) {
      case 'venture.queue.list': return this.queueList(p.scope === 'current' ? 'current' : 'all');
      case 'venture.queue.decide': return this.decide(p as ParamsOf<'venture.queue.decide'>);
      case 'venture.queue.view': {
        const view = QUEUE_VIEWS.find((v) => v.kind === p.kind && v.id === p.id);
        if (!view) throw new EngineError('VIEW_NOT_FOUND', 'This is not on this computer any more.');
        return clone(view);
      }
      case 'venture.runs.list': {
        const state = p.state ?? 'all';
        const runs = this.runs.filter((r) => state === 'all' || (state === 'active' ? r.state === 'active' || r.state === 'waiting' : r.state === 'done' || r.state === 'failed'));
        return { runs: runs.map(({ steps: _s, question: _q, error: _e, ...summary }) => clone(summary)) };
      }
      case 'venture.runs.get': {
        const run = this.runs.find((r) => r.runId === p.runId);
        if (!run) throw new EngineError('RUN_NOT_FOUND', 'This run is not on this computer.');
        return clone(run);
      }
      case 'venture.team.list': return { agents: clone(this.agents[this.current] ?? []) };
      case 'venture.team.gate': return this.gate(p as ParamsOf<'venture.team.gate'>);
      case 'venture.team.posture': return this.posture(p as ParamsOf<'venture.team.posture'>);
      case 'venture.spend.list': return { rows: clone(SPEND), total: '₹60.10 this month (includes estimates)' };
      case 'venture.journal.list': return { entries: clone(JOURNAL).slice(0, typeof p.limit === 'number' ? p.limit : undefined) };
      case 'venture.evidence.list': return { items: clone(this.evidence).filter((e) => typeof p.subject !== 'string' || e.subject === p.subject) };
      case 'venture.evidence.apply': return this.applyEvidence(String(p.id ?? ''));
      case 'venture.evidence.dismiss': return this.dismissEvidence(String(p.id ?? ''));
      case 'venture.client.list': return clone(this.clients[this.current] ?? []);
      case 'venture.client.add': return this.addClient(p);
      case 'venture.events': return { events: [], lastSeq: this.seq };
      case 'venture.get': {
        const venture = this.ventures.get(this.current);
        const playbook = this.desk.playbook(this.current);
        return venture ? { venture: { id: this.current, workingName: venture.workingName, serviceType: venture.serviceType }, done: venture.done, total: 12, ...(playbook ? { playbook } : {}) } : null;
      }
      case 'venture.receipt.get': {
        const receipt = RECEIPTS.find((r) => r.id === p.id) ?? this.desk.receipt(String(p.id)) ?? this.money.receipt(String(p.id));
        if (!receipt) throw new EngineError('RECEIPT_NOT_FOUND', 'This receipt is not on this computer.');
        return clone(receipt);
      }
      case 'venture.books.summary': return this.money.books(clone(BOOKS[this.current] ?? BOOKS.lumen!), p.period);
      case 'venture.connectors.list': return clone(CONNECTORS);
      case 'workspace.list': return {
        complete: true,
        businesses: this.businesses.map((b) => ({ folder: b.id, name: b.name, demo: true, unlock: b.opens === 'needs-passphrase' ? 'passphrase' : 'this-computer', opens: b.opens, recovery: b.recovery, openedAt: b.id === this.current ? this.now() : null, listedFrom: 'card' })),
      };
      case 'workspace.open': {
        // On this computer a business opens by its folder; the hosted server opens one by its id on the account.
        const business = this.businesses.find((b) => b.id === (this.hosted ? p.businessId : p.folder));
        if (!business) throw new EngineError('WORKSPACE_NOT_FOUND', 'No business in that folder.');
        if (business.opens === 'needs-passphrase' && typeof p.passphrase !== 'string') throw new EngineError('PASSPHRASE_REQUIRED', 'This business opens with its passphrase.');
        this.current = business.id;
        this.open = true;
        this.closedByOwner = false;
        this.emit({ type: 'queue.changed', businessId: business.id, at: this.now() });
        return { workspace: { id: business.id, name: business.name } };
      }
      default:
        if (this.desk.handles(method)) return this.desk.request(method, p);
        if (this.work.handles(method)) return this.work.request(method, p);
        if (this.extras.handles(method)) return this.extras.request(method, p);
        throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  private queueList(scope: 'current' | 'all') {
    const rows = this.rows.filter((r) => !this.decided.has(r.id) && (scope === 'all' || r.businessId === this.current)).sort(queueOrder);
    const businesses = new Set(rows.map((r) => r.businessId)).size;
    const count = String(rows.length);
    const summary = rows.length === 0 ? 'Nothing needs you.' : `${count} ${rows.length === 1 ? 'needs' : 'need'} you, across ${businesses} ${businesses === 1 ? 'business' : 'businesses'}`;
    return { rows: clone(rows), summary, needsYou: rows.length, businesses };
  }

  private decide(p: ParamsOf<'venture.queue.decide'>): QueueDecision {
    const row = this.rows.find((r) => r.id === p.id);
    if (!row) return { outcome: 'refused', line: 'This is no longer here.', reason: 'RESOLVED_ELSEWHERE' };
    if (this.decided.has(row.id)) return { outcome: 'refused', line: 'You decided this already.', reason: 'ALREADY_DECIDED' };
    if (p.digest !== row.digest) return { outcome: 'stale', line: 'This changed since you opened it.', latest: clone(row) };
    const action = row.actions.find((a) => a.id === p.action);
    if (!action) return { outcome: 'refused', line: 'That is not a choice for this row.', reason: 'INVALID_ACTION' };
    if (action.requiresView && p.viewed !== true) return { outcome: 'refused', line: 'Open it and read it first.', reason: 'VIEW_FIRST' };
    if (row.kind === 'locked') return { outcome: 'refused', line: 'This business opens with its passphrase.', reason: 'PASSPHRASE_REQUIRED' };
    if (action.id === 'answer' && !(p.answer ?? '').trim()) return { outcome: 'refused', line: 'Write an answer first.', reason: 'ANSWER_REQUIRED' };
    this.decided.add(row.id);
    if (action.id === 'approve' && row.viewRef?.kind === 'plan') this.desk.accept(row.businessId, row.viewRef.id);
    const receiptId = RECEIPTED.has(row.kind) && (action.id === 'approve' || action.id === 'issue') ? `R-0${this.receiptSeq++}` : undefined;
    if (action.id === 'run-again' && row.viewRef?.kind === 'run') this.restart(row.viewRef.id);
    if (action.id === 'send-to-ca' && row.viewRef?.kind === 'file') this.extras.sentToCa(row.viewRef.id);
    this.emit({ type: 'queue.changed', businessId: row.businessId, at: this.now() });
    const said = DONE_LINES[action.id] ?? 'Done';
    return receiptId ? { outcome: 'done', line: `${said} · ${receiptId}`, receiptId } : { outcome: 'done', line: said };
  }

  private restart(runId: string) {
    const run = this.runs.find((r) => r.runId === runId);
    if (!run) return;
    run.state = 'active';
    delete run.error;
    run.steps = run.steps.map((s) => (s.state === 'failed' ? { id: s.id, purpose: s.purpose, state: 'current', elapsed: 'now' } : s));
    this.emit({ type: 'run.started', businessId: run.businessId, runId, at: this.now() });
  }

  private gate(p: ParamsOf<'venture.team.gate'>) {
    const agent = (this.agents[this.current] ?? []).find((a) => a.id === p.agentId);
    if (!agent) throw new EngineError('AGENT_NOT_FOUND', 'No such agent in this business.');
    const step = agent.steps.find((s) => s.id === p.stepId);
    if (!step) throw new EngineError('STEP_NOT_FOUND', 'No such step for this agent.');
    if (step.floor && p.gate === 'auto') throw new EngineError('GATE_FLOOR', 'This step always asks you.');
    step.gate = p.gate;
    return { agent: clone(agent) };
  }

  /**
   * venture.team.posture with the engine's ladder: rehearsal, shadow, approve each, auto with spot checks. A sample
   * business has not delivered enough approved work for the top step, so it is refused (POSTURE_ABOVE_STAGE).
   */
  private posture(p: ParamsOf<'venture.team.posture'>) {
    const agent = (this.agents[this.current] ?? []).find((a) => a.id === p.agentId);
    if (!agent) throw new EngineError('AGENT_NOT_FOUND', 'That agent was not found.');
    const ladder: readonly Posture[] = ['rehearsal', 'shadow', 'approve-each', 'auto-spot-check'];
    if (!ladder.includes(p.posture)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose rehearsal, shadow, approve each or auto with spot checks.');
    if (p.posture === 'auto-spot-check') throw new EngineError('POSTURE_ABOVE_STAGE', 'Auto with spot checks opens once this business has delivered work you approved for a few weeks. It is too early for that.');
    agent.posture = p.posture;
    this.emit({ type: 'queue.changed', businessId: this.current, at: this.now() });
    return { agent: clone(agent) };
  }

  /** venture.client.add with the engine's checks; each field the owner typed becomes verified, applied evidence. */
  private addClient(p: Record<string, unknown>): ClientLite {
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const name = text(p.name);
    if (!name || name.length < 2 || name.length > 120 || /[\n\r\t]/.test(name)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Client name must be between 2 and 120 characters.');
    const email = text(p.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Use an email address like name@example.com.');
    const taxId = text(p.taxId)?.toUpperCase().replace(/\s+/g, '') ?? null;
    if (taxId && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(taxId)) throw new EngineError('INVALID_TAX_ID', "Check the client's GSTIN.");
    const note = text(p.note);
    if (note && note.length > 500) throw new EngineError('INVALID_VENTURE_REQUEST', 'Note must be between 1 and 500 characters.');
    const client: ClientLite = {
      id: `c-new-${this.clientSeq++}`, at: this.now(), name, email, countryCode: text(p.countryCode), taxId,
      stateCode: taxId ? taxId.slice(0, 2) : text(p.stateCode), note,
    };
    this.clients[this.current] = [client, ...(this.clients[this.current] ?? [])];
    const fields = { name: client.name, email: client.email, countryCode: client.countryCode, taxId: client.taxId, stateCode: client.stateCode, note: client.note };
    for (const [field, value] of Object.entries(fields)) {
      if (value === null) continue;
      this.evidence.unshift({ id: `ev-${client.id}-${field}`, subject: `client:${client.id}`, field, value, type: 'owner-entered', strength: 'verified', claim: 'observed', source: 'You entered this.', applied: true });
    }
    return clone(client);
  }

  /**
   * venture.evidence.apply with the engine's rules: a needs-your-data item has no value to apply, and weaker
   * evidence never replaces a verified stored value (EVIDENCE_WEAK). Applying settles the field's other items and
   * writes name, email and note through to the client.
   */
  private applyEvidence(id: string) {
    const item = this.evidence.find((e) => e.id === id);
    if (!item) throw new EngineError('EVIDENCE_NOT_FOUND', 'This evidence is not in this business.');
    if (item.applied) return { item: clone(item) };
    if (item.claim === 'needs-your-data') throw new EngineError('INVALID_VENTURE_REQUEST', "There's no value to apply: this asks for your data.");
    const peers = this.evidence.filter((e) => e.subject === item.subject && e.field === item.field);
    const stored = peers.find((e) => e.applied);
    if (stored && stored.strength === 'verified' && item.strength !== 'verified') throw new EngineError('EVIDENCE_WEAK', "A checked value is stored for this. Weaker evidence can't replace it.");
    for (const peer of peers) peer.applied = peer.id === item.id;
    if (item.subject.startsWith('client:') && (item.field === 'name' || item.field === 'email' || item.field === 'note')) {
      const clientId = item.subject.slice('client:'.length);
      for (const list of Object.values(this.clients)) {
        const client = list.find((c) => c.id === clientId);
        if (client) client[item.field] = item.value;
      }
    }
    return { item: clone(item) };
  }
  /** venture.evidence.dismiss: the owner said no to a suggestion. A value in use stays; apply another one instead. */
  private dismissEvidence(id: string) {
    const item = this.evidence.find((e) => e.id === id);
    if (!item) throw new EngineError('EVIDENCE_NOT_FOUND', 'This evidence is not in this business.');
    if (item.applied) throw new EngineError('EVIDENCE_APPLIED', 'This value is in use. Apply a different one to replace it.');
    item.dismissed = true;
    return { item: clone(item) };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Onboarding, in the engine's order: countries and the template preview before any vault; workspace.create makes
  // the vault (it refuses while one is open); then venture.create, the template interview and the plan inside it.
  // A new business gets the queue view's rows: the plan first, then Connect your AI, Set your prices and, when this
  // computer keeps the key and no recovery code exists yet, Keep this business.
  // -------------------------------------------------------------------------------------------------------------

  private onboarding(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'workspace.status': {
        const business = this.open ? this.businesses.find((b) => b.id === this.current) : undefined;
        return {
          open: this.open, workspace: business ? { name: business.name } : undefined,
          unlock: business ? (business.opens === 'needs-passphrase' ? 'typed' : 'this-computer') : undefined,
          closedByOwner: this.closedByOwner, experimental: true,
          ...(this.hosted ? { hosted: { businesses: this.businesses.map((b) => ({ id: b.id, name: b.name })) } } : {}),
        };
      }
      case 'workspace.lock': {
        this.open = false;
        this.closedByOwner = true;
        return { locked: true };
      }
      case 'workspace.create': return this.createWorkspace(p);
      case 'venture.countries': return clone(COUNTRIES);
      case 'venture.preview': {
        const idea = this.idea(p.idea);
        const type = classify(idea);
        const label = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
        return {
          idea, country: clone(this.country(p.countryCode)), serviceType: label(type), serviceLabel: SERVICE_LABELS[type],
          oneLiner: label(`A built-in ${SERVICE_LABELS[type].toLowerCase()} plan, not fitted to what you wrote.`), by: 'template', saved: false,
        };
      }
      case 'venture.create': {
        if (this.ventures.has(this.current)) throw new EngineError('VENTURE_EXISTS', 'This workspace already has a business. Chausar keeps one business per workspace.');
        const idea = this.idea(p.idea);
        const country = this.country(p.countryCode);
        const named = typeof p.workingName === 'string' ? p.workingName.trim() : null;
        if (p.workingName !== undefined && (named === null || named.length < 2 || named.length > 80)) throw new EngineError('INVALID_VENTURE_REQUEST', 'The working name must be between 2 and 80 characters.');
        const venture: HeldVenture = { workingName: named ?? 'My service business', serviceType: null, idea, countryCode: country.code, done: 1 };
        this.ventures.set(this.current, venture);
        this.interviews.set(this.current, this.templateInterview(country.code));
        return { venture: { id: this.current, workingName: venture.workingName, serviceType: null }, done: venture.done, total: 12 };
      }
      case 'venture.interview.next': {
        const questions = this.interviews.get(this.current);
        if (!questions) return NOT_ONBOARDING;
        return { interview: { questions: clone(questions) }, done: questions.every((q) => q.answer !== null) };
      }
      case 'venture.interview.answer': {
        const questions = this.interviews.get(this.current);
        if (!questions) return NOT_ONBOARDING;
        return this.answer(questions, p);
      }
      case 'venture.blueprint.draft': {
        const questions = this.interviews.get(this.current);
        if (!questions) return NOT_ONBOARDING;
        return this.draftPlan(questions);
      }
      default: return NOT_ONBOARDING;
    }
  }

  private idea(value: unknown): string {
    const idea = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
    if (idea.length < 10 || idea.length > 2000) throw new EngineError('INVALID_VENTURE_REQUEST', 'Your idea must be between 10 and 2000 characters.');
    return idea;
  }

  private country(code: unknown) {
    const country = COUNTRIES.find((c) => c.code === code);
    if (!country) throw new EngineError('UNKNOWN_COUNTRY', 'Choose a country from the list.');
    return country;
  }

  private createWorkspace(p: Record<string, unknown>): WorkspaceCreated {
    if (this.open) throw new EngineError('VAULT_OPEN', 'Lock the current workspace before creating another.');
    if (this.hosted && Object.keys(p).some((key) => key !== 'name' && key !== 'pack')) throw new EngineError('INVALID_REQUEST', 'Send only the name and the pack.');
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (name.length < 2 || name.length > 100) throw new EngineError('INVALID_NAME', 'Give your business a name.');
    if (p.pack !== undefined && p.pack !== 'services') throw new EngineError('UNKNOWN_PACK', 'Choose an available business starter pack.');
    const typed = typeof p.passphrase === 'string';
    if (!this.hosted && !typed && !this.deviceKeys) throw new EngineError('DEVICE_KEYS_UNAVAILABLE', 'This computer has no keyring Chausar can use, so Chausar asks for a passphrase.');
    if (typed && ((p.passphrase as string).length < 12 || (p.passphrase as string).length > 1024)) throw new EngineError('WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'business';
    let id = slug;
    for (let n = 2; this.businesses.some((b) => b.id === id); n++) id = `${slug}-${n}`;
    const shown = typed || this.hosted;
    this.businesses.push({ id, name, serviceType: 'other', opens: typed ? 'needs-passphrase' : 'with-this-computer', recovery: shown ? 'made' : 'not-made' });
    this.current = id;
    this.open = true;
    this.closedByOwner = false;
    const code = shown ? SAMPLE_RECOVERY_CODE : null;
    return { workspace: { name }, folder: id, unlock: typed ? 'passphrase' : 'this-computer', recoveryKit: code, recoveryCode: code, experimental: true };
  }

  private templateInterview(countryCode: string): InterviewQuestionLite[] {
    const india = countryCode === 'IN';
    return [
      { id: 'q_1', kind: 'choice', text: 'Who will your first clients be?', choices: [{ id: 'c_1', label: 'Small shops' }, { id: 'c_2', label: 'Cafes and restaurants' }], required: false, prefill: null, answer: null },
      { id: 'q_pricing_model', kind: 'choice', text: 'How will you charge?', choices: [{ id: 'monthly', label: 'Per month' }, { id: 'project', label: 'Per project' }, { id: 'hourly', label: 'Per hour' }], required: true, prefill: null, answer: null },
      { id: 'q_price', kind: 'money', text: 'What will you charge per month?', choices: [], required: false, prefill: null, answer: null },
      { id: 'q_tax', kind: 'yesno', text: india ? 'Are you registered for GST, so you charge it on your invoices?' : 'Do you charge any tax on your invoices?', choices: [], required: true, prefill: null, answer: null },
    ];
  }

  private answer(questions: InterviewQuestionLite[], p: Record<string, unknown>) {
    const question = questions.find((q) => q.id === p.questionId);
    if (!question) throw new EngineError('INVALID_VENTURE_REQUEST', 'There is no such question.');
    const answer = (p.answer ?? {}) as InterviewAnswer;
    if (answer.skipped === true) {
      if (question.required) throw new EngineError('INVALID_VENTURE_REQUEST', 'This question needs an answer.');
    } else if (question.kind === 'choice' && !question.choices.some((c) => c.id === answer.choiceId)) {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose one of the choices.');
    } else if (question.kind === 'yesno' && typeof answer.yes !== 'boolean') {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'Answer yes or no.');
    }
    question.answer = clone(answer);
    if (question.id === 'q_tax') {
      const at = questions.findIndex((q) => q.id === 'q_tax_rate');
      if (answer.yes === true && at < 0) questions.push({ id: 'q_tax_rate', kind: 'rate', text: 'What GST rate do you charge, in percent?', choices: [], required: true, prefill: '18', answer: null });
      if (answer.yes !== true && at >= 0) questions.splice(at, 1);
    }
    return { interview: { questions: clone(questions) }, done: questions.every((q) => q.answer !== null) };
  }

  /**
   * The prices row in the engine's words (views/queue.ts): both offers start with no price, and tax counts as set only
   * when the owner answered it; left unanswered, Chausar assumed it and asks the owner to confirm.
   */
  private pricesRow(questions: InterviewQuestionLite[]): Pick<QueueRow, 'title' | 'line' | 'actions'> {
    const assumed = questions.find((q) => q.id === 'q_tax')?.answer?.assumed === true;
    const taxLabel = this.ventures.get(this.current)?.countryCode === 'IN' ? 'GST' : 'Tax';
    const noPrice = 'Monthly plan and One-off project have no price yet';
    const words = assumed ? NEW_BUSINESS_ROWS.prices.both : NEW_BUSINESS_ROWS.prices.set;
    const line = assumed ? `${noPrice}, and Chausar assumed you do not charge ${taxLabel}.` : `${noPrice}.`;
    return { title: words.title, line, actions: [{ id: 'set-prices', label: words.action, primary: true }] };
  }

  private draftPlan(questions: InterviewQuestionLite[]): BlueprintViewLite {
    if (!questions.every((q) => q.answer !== null)) throw new EngineError('INTERVIEW_INCOMPLETE', 'Answer the questions about your price and tax first.');
    const venture = this.ventures.get(this.current)!;
    const business = this.businesses.find((b) => b.id === this.current)!;
    const type = classify(venture.idea);
    venture.serviceType = type;
    venture.done = 2;
    const at = this.now();
    const planId = `plan-${business.id}-1`;
    const label = <T,>(value: T) => ({ value, label: 'assumption' as const, by: 'template' as const });
    const oneLiner = `A built-in ${SERVICE_LABELS[type].toLowerCase()} plan, not fitted to what you wrote.`;
    if (!this.rows.some((r) => r.id === `q-plan-${business.id}`)) {
      const base = { businessId: business.id, businessName: business.name, createdAt: at };
      const seeds: Omit<QueueRow, 'digest'>[] = [
        { ...base, id: `q-plan-${business.id}`, kind: 'plan', title: NEW_BUSINESS_ROWS.plan.title, line: oneLiner, viewRef: { kind: 'plan', id: planId },
          actions: [{ id: 'read', label: NEW_BUSINESS_ROWS.plan.read, primary: false }, { id: 'approve', label: NEW_BUSINESS_ROWS.plan.accept, primary: true, requiresView: true }] },
        { ...base, id: `q-setup-ai-${business.id}`, kind: 'setup', title: NEW_BUSINESS_ROWS.ai.title, line: NEW_BUSINESS_ROWS.ai.line, actions: [{ id: 'connect', label: NEW_BUSINESS_ROWS.ai.action, primary: true }] },
        { ...base, id: `q-setup-prices-${business.id}`, kind: 'setup', ...this.pricesRow(questions), },
      ];
      if (business.recovery === 'not-made') {
        seeds.push({ ...base, id: `q-setup-keep-${business.id}`, kind: 'setup', title: NEW_BUSINESS_ROWS.keep.title, line: NEW_BUSINESS_ROWS.keep.line, actions: [{ id: 'keep', label: NEW_BUSINESS_ROWS.keep.action, primary: true }] });
      }
      this.rows.push(...seeds.map((seed) => ({ ...seed, digest: digestOf(seed) })));
      this.emit({ type: 'queue.changed', businessId: business.id, at });
    }
    const country = this.country(venture.countryCode);
    const india = country.code === 'IN';
    const offer = (id: string, name: string, model: 'monthly' | 'project', unit: 'month' | 'project') => ({
      id, name: label(name), description: label(`${name}, written from the built-in template.`),
      pricing: { model, quantityUnit: unit, unitPriceMinor: null, unitPriceLabel: 'not-set' as const, defaultQuantity: '1' },
    });
    const blueprint = {
      id: planId, at, version: 1, status: 'draft' as const, source: 'template' as const, digest: digestOf({ planId, at }), serviceType: type,
      name: label(venture.workingName), oneLiner: label(oneLiner), customer: label('Small businesses that want this done for them.'),
      offers: [offer('offer_1', 'Monthly plan', 'monthly', 'month'), offer('offer_2', 'One-off project', 'project', 'project')],
      deliverySteps: [
        { id: 'step_1', title: label('Collect what the client sends'), doneBy: 'you' as const, capability: 'planned' as const, note: 'You collect what the client sends and add the files to the order.' },
        { id: 'step_2', title: label('Do the work'), doneBy: 'you' as const, capability: 'planned' as const, note: 'You do the hands-on work.' },
        { id: 'step_3', title: label('Draft the reply'), doneBy: 'agent-then-you' as const, capability: 'drafts-now' as const, note: "An agent drafts a reply from the client's message. You check it." },
        { id: 'step_4', title: label('Send it'), doneBy: 'you' as const, capability: 'planned' as const, note: 'You send it to the client. Sending for you is planned.' },
      ],
      approvals: [label('Each draft before it goes to a client'), label('Prices and invoices')],
      backOffice: {
        currency: country.currency, taxLabel: india ? 'GST' : 'Tax',
        taxRegistered: questions.find((q) => q.id === 'q_tax')?.answer?.assumed === true
          ? { value: false, label: 'assumption' as const, by: 'template' as const }
          : { value: false, label: 'told-by-you' as const, by: 'owner' as const },
        invoiceKind: india ? 'tax-invoice' as const : 'invoice' as const, taxInvoiceReady: false, taxInvoiceMissing: [], paymentRail: india ? 'razorpay' : 'paypal',
      },
      starterConnectorIds: [],
    };
    const view = { blueprint, offerReceipts: { offer_1: null, offer_2: null } };
    this.desk.putBlueprint(business.id, view);
    return view;
  }
}

/** An EngineClient over the fake engine. Its status line says the data is a sample. */
export function createFakeClient(engine: FakeEngine = new FakeEngine()): EngineClient & { engine: FakeEngine } {
  const status = createStatusStore({ state: 'ok' });
  return {
    engine,
    transport: 'fake',
    request<M extends MethodName>(method: M, params?: ParamsOf<M>) { return engine.request(method, params) as Promise<ResultOf<M>>; },
    subscribe: (listener) => engine.subscribe(listener),
    status: () => status.get(),
    onStatus: (listener) => status.subscribe(listener),
  };
}
