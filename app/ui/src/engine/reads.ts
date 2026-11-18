import { ownerError } from './owner-errors';
import { EngineError, type EngineClient, type MethodName, type ParamsOf, type VentureRunEvent } from './types';

/**
 * One-shot B3: one read store per engine client. Every useResource reads through it, so two places reading the same
 * method with the same params share one entry: one request, one answer, the same number on screen. An entry lives
 * while a place shows it and is dropped after the current task once nothing reads it, so a page opened later reads
 * afresh and no other business's answer can come back.
 */

/**
 * Every method a screen reads: the useResource methods, and the reads a place sends with request. useResource takes
 * only these, so a new screen that reads a write method does not compile.
 */
export const READS = [
  'venture.about.families', 'venture.accountant.get', 'venture.accountant.schedule.get', 'venture.agentSettings.get', 'venture.agents.capabilities', 'venture.agents.notes.list',
  'venture.agents.orders.list', 'venture.agents.retire.check', 'venture.agents.thread.list', 'venture.ai.options',
  'venture.ai.status', 'venture.ai.tools', 'venture.apps.get', 'venture.apps.list', 'venture.assets.list',
  'venture.away.get', 'venture.away.preview', 'venture.diagnostics.today', 'venture.bank.alerts.get', 'venture.bank.ledger', 'venture.billing.get', 'venture.bills.list',
  'venture.blueprint.get', 'venture.books.summary', 'venture.brandKit.get', 'venture.build.status', 'venture.ca.get',
  'venture.ca.receipt', 'venture.ca.signoff.get', 'venture.chief.thread.list', 'venture.chief.threads',
  'venture.client.aiConsent.get', 'venture.client.aiDefault.get', 'venture.client.list', 'venture.compliance.get', 'venture.connectors.list',
  'venture.countries', 'venture.crm.client', 'venture.crm.companies', 'venture.crm.company', 'venture.crm.list',
  'venture.crm.lists', 'venture.decisions.list', 'venture.delivery.changes', 'venture.delivery.list',
  'venture.desk.get', 'venture.desk.list', 'venture.drills.list', 'venture.earlier.list', 'venture.events', 'venture.evidence.list',
  'venture.feedback.get', 'venture.files.list', 'venture.find', 'venture.get', 'venture.goNoGo.list', 'venture.goals.get',
  'venture.ideas.list', 'venture.improve.status', 'venture.invoice.get', 'venture.invoice.list',
  'venture.invoice.recurringList', 'venture.journal.chain', 'venture.journal.list', 'venture.judge.auto.get',
  'venture.knowledge.list', 'venture.launch.status', 'venture.layout.get', 'venture.leads.find.tools', 'venture.leads.find.view', 'venture.leads.list',
  'venture.localApps.list', 'venture.mail.threads', 'venture.mcpRegistry.list', 'venture.memory.list',
  'venture.models.cli.status', 'venture.models.presets', 'venture.models.roles', 'venture.models.status',
  'venture.money.across', 'venture.money.aging', 'venture.money.cash', 'venture.money.flow', 'venture.money.margins',
  'venture.money.overview', 'venture.monitors.list', 'venture.needs.list', 'venture.network.people',
  'venture.network.person', 'venture.network.sources', 'venture.notify.list', 'venture.notify.push.key',
  'venture.notify.relay', 'venture.notify.settings', 'venture.notify.telegram', 'venture.order.chain',
  'venture.order.contract', 'venture.order.list', 'venture.owner.get', 'venture.packs.list', 'venture.payment.receipt',
  'venture.people.services', 'venture.persona.get', 'venture.phone.access', 'venture.pipeline.followups',
  'venture.pipeline.list', 'venture.pipeline.settings', 'venture.playbook.guidance', 'venture.playbooks.list',
  'venture.posting.limits.get', 'venture.queue.list', 'venture.queue.view', 'venture.receipt.get',
  'venture.report.list', 'venture.routines.list', 'venture.routines.suggestions', 'venture.routines.runs', 'venture.rules.list',
  'venture.rules.locks', 'venture.runs.get', 'venture.runs.list', 'venture.salesProposal.get',
  'venture.settings.drafts', 'venture.share.list', 'venture.simulation.scenarios', 'venture.social.calendar',
  'venture.speechOut.providers', 'venture.spend.list', 'venture.spend.policy.get', 'venture.talk.get',
  'venture.tax.working', 'venture.team.keeper', 'venture.team.list', 'venture.transcription.get',
  'venture.voice.get', 'venture.voiceConsent.list', 'venture.web.search', 'venture.work.get',
  'updates.status', 'workspace.backups.drive.status', 'workspace.backups.inspect', 'workspace.backups.list', 'workspace.custody.get', 'workspace.list', 'workspace.status',
  // One-shot C3: the app's own preference (animations), read at the top of the shell.
  'app.preferences.get',
  // One-shot C3 task 10: the live jobs, read by useWork when a page opens and on the poll's pace.
  'venture.work.list',
  'venture.models.plan',
  'venture.routines.backup.get',
  'whatsNew.get',
  'venture.trackers.list',
  'venture.trackers.get',
  'venture.events.get',
  'venture.chief.plan.get',
] as const satisfies readonly MethodName[];

export type ReadMethod = (typeof READS)[number];

const READ_SET: ReadonlySet<string> = new Set(READS);

/**
 * Calls that send nothing more when they answer: an autosave while the owner types (business/settingsDraft.tsx), and a
 * mini app's own tools (apps/MiniAppFrame.tsx). Two more are quiet by their params: the connection checks' last-result
 * look (`venture.connectors.check { last: true }`, connections/ChecksTile.tsx) and the payment link's polled check
 * (`venture.invoice.payLink { action: 'check' }`, money/InvoicePay.tsx; a payment it records is announced by the engine).
 */
const QUIET: ReadonlySet<string> = new Set(['venture.settings.draft', 'venture.apps.call', 'venture.team.introduced', 'updates.settings', 'app.preferences.set']);

/**
 * What a call is to the screens: a read sends nothing more, a quiet call sends nothing more, and every other method is
 * a write, after which every place on screen whose refreshOn accepts a queue change reads again.
 */
export function kindOf(method: string, params: unknown): 'read' | 'quiet' | 'write' {
  if (READ_SET.has(method)) return 'read';
  if (QUIET.has(method)) return 'quiet';
  const p = (params ?? {}) as Record<string, unknown>;
  if (method === 'venture.connectors.check' && p.last === true) return 'quiet';
  if (method === 'venture.invoice.payLink' && p.action === 'check') return 'quiet';
  return 'write';
}

export interface ReadState<T> { data: T | undefined; error: EngineError | undefined; loading: boolean }

type RefreshOn = { current: ((event: VentureRunEvent) => boolean) | undefined };
type Reader = { changed: () => void; refreshOn: RefreshOn };

type Entry = {
  method: MethodName;
  params: unknown;
  state: ReadState<unknown>;
  readers: Set<Reader>;
  /** The newest request asked for; a reply to an older one is dropped. */
  asked: number;
  /** A request is on its way. */
  busy: boolean;
  /** A reload was asked for while one was on its way: it runs once more after it. */
  again: boolean;
  dropped: boolean;
  /** Its answer was about a business that is gone (#forgetBusiness): the next reader to join reads it afresh. */
  forgotten?: boolean;
};

const LOADING: ReadState<never> = Object.freeze({ data: undefined, error: undefined, loading: true });
const IDLE: ReadState<never> = Object.freeze({ data: undefined, error: undefined, loading: false });

export const keyOf = (method: MethodName, params: unknown) => `${method} ${JSON.stringify(params ?? {})}`;

export class ReadStore {
  readonly #client: EngineClient;
  readonly #entries = new Map<string, Entry>();
  #off: (() => void) | null = null;
  /** The business the engine's events last named: a write's own signal names it too. */
  #business = '';
  /** How many holds are on (a business being left): while any is, no read is sent. */
  #holds = 0;
  /** The entries asked to load while held. */
  #heldBack = new Set<Entry>();

  constructor(client: EngineClient) {
    this.#client = client;
  }

  /** What a reader shows now: the entry's answer, or loading for an entry not read yet (idle when skipped). */
  snapshot<T>(key: string, skip = false): ReadState<T> {
    const entry = this.#entries.get(key);
    if (entry) return entry.state as ReadState<T>;
    return skip ? IDLE : LOADING;
  }

  /** A reader joins an entry; the first one makes the request. Returns the leave. */
  subscribe(method: MethodName, params: unknown, changed: () => void, refreshOn: RefreshOn): () => void {
    const key = keyOf(method, params);
    let entry = this.#entries.get(key);
    // Left by every reader and joined again before it was dropped. A read still on its way (StrictMode's second mount)
    // is shared; an answer already in is not: the place reads afresh, as a place opened again always has.
    if (entry && !entry.readers.size && !entry.busy) {
      entry.dropped = true;
      this.#entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      entry = { method, params, state: LOADING, readers: new Set(), asked: 0, busy: false, again: false, dropped: false };
      this.#entries.set(key, entry);
      this.#listen();
      this.#load(entry);
    }
    const reader: Reader = { changed, refreshOn };
    entry.readers.add(reader);
    // Shared with a reader from before a business was left: its answer was forgotten, so it is read now.
    if (entry.forgotten) this.#load(entry);
    const mine = entry;
    return () => {
      mine.readers.delete(reader);
      if (mine.readers.size) return;
      // After the current task: StrictMode's second mount and a remount in the same commit find the entry again.
      queueMicrotask(() => {
        if (mine.readers.size || this.#entries.get(key) !== mine) return;
        mine.dropped = true;
        this.#entries.delete(key);
        if (!this.#entries.size) this.#quiet();
      });
    };
  }

  /**
   * A business is being left (locked, switched away from, or closed for a new one): from now no read is sent, whatever
   * asks for one, so nothing arrives at the engine between its lock and its open (seen live on Windows, 15 Nov 2026:
   * the window's own reads in that gap made the open answer VAULT_BUSY). What the pages show stays as it is. `release`:
   * the business is still open after all, and every read that was asked for goes once. `drop`: it is gone, so those
   * reads are never sent; only an entry that never had an answer still loads, for whatever screen shows next.
   *
   * `drop` also forgets every answer about the business that is gone (#forgetBusiness). The app is drawn again on the
   * business opened next, and its first drawing read whatever the store still held: for a moment Today showed the
   * cards of the business just left, and each card asked the newly opened business for its own row (seen on Windows,
   * 15 Nov 2026: one venture.queue.view refused QUEUE_ITEM_NOT_FOUND at every switch).
   */
  hold(): { release(): void; drop(): void } {
    this.#holds += 1;
    let over = false;
    const end = (business: 'open' | 'gone') => {
      if (over) return;
      over = true;
      this.#holds -= 1;
      if (business === 'gone') this.#forgetBusiness();
      if (this.#holds > 0) return;
      const waiting = [...this.#heldBack];
      this.#heldBack.clear();
      for (const entry of waiting) if (business === 'open' || entry.asked === 0) this.#load(entry);
    };
    return { release: () => end('open'), drop: () => end('gone') };
  }

  /**
   * Every answer about a business (a `venture.` read that was asked at least once) is forgotten. A page still on
   * screen keeps showing what it showed (useResource holds its last answer) and asks nothing by this; a page drawn
   * after it finds no answer, and reads afresh as it joins. A reply still on its way for a forgotten answer is not
   * kept. Reads that are not about a business (the app's preferences, the list of businesses) stay as they are, and so
   * does the entry itself: an engine event reads it again as ever.
   */
  #forgetBusiness(): void {
    for (const entry of this.#entries.values()) {
      if (!entry.method.startsWith('venture.') || entry.asked === 0) continue;
      entry.state = LOADING;
      entry.forgotten = true;
      // A reply on its way was asked of the business that is gone: it is no longer the newest ask, so it is not kept.
      entry.asked += 1;
      this.#heldBack.delete(entry);
    }
  }

  /** Read one entry again (a place's reload). */
  reload(key: string): void {
    const entry = this.#entries.get(key);
    if (entry) this.#load(entry);
  }

  /**
   * A write answered (or timed out, so the engine may have done it): every entry whose readers accept a queue change for
   * the open business reads again, once. The signal is the store's own; no engine event listener hears it.
   */
  written(): void {
    this.refresh({ type: 'queue.changed', businessId: this.#business, at: new Date().toISOString() });
  }

  /** Read again every entry one of whose readers accepts the event (no refreshOn accepts every event). */
  refresh(event: VentureRunEvent): void {
    for (const entry of [...this.#entries.values()]) {
      if ([...entry.readers].some((reader) => !reader.refreshOn.current || reader.refreshOn.current(event))) this.#load(entry);
    }
  }

  #listen(): void {
    if (this.#off) return;
    // One-shot C3: a step of long work changes no read; useWork hears it itself.
    this.#off = this.#client.subscribe((event) => { if (event.type === 'work.step') return; if (event.businessId) this.#business = event.businessId; this.refresh(event); });
  }

  #quiet(): void {
    this.#off?.();
    this.#off = null;
  }

  #set(entry: Entry, state: ReadState<unknown>): void {
    if (entry.dropped) return;
    entry.state = state;
    for (const reader of [...entry.readers]) reader.changed();
  }

  #load(entry: Entry): void {
    if (entry.dropped) return;
    if (this.#holds > 0) { this.#heldBack.add(entry); return; }
    if (entry.busy) { entry.again = true; return; }
    entry.busy = true;
    entry.again = false;
    entry.forgotten = false;
    const mine = ++entry.asked;
    if (!entry.state.loading) this.#set(entry, { ...entry.state, loading: true });
    const settle = (next: (state: ReadState<unknown>) => ReadState<unknown>) => {
      entry.busy = false;
      // A reload asked for while this one was on its way may see a write this one started before: its reply wins.
      if (entry.again) { this.#load(entry); return; }
      if (mine === entry.asked) this.#set(entry, next(entry.state));
    };
    let request: Promise<unknown>;
    try {
      request = this.#client.request(entry.method, entry.params as ParamsOf<MethodName>) as Promise<unknown>;
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(
      (data) => settle(() => ({ data, error: undefined, loading: false })),
      (error: unknown) => {
        const e = error instanceof EngineError ? error : ownerError(new EngineError('REQUEST_FAILED', error instanceof Error ? error.message : String(error)));
        // An error keeps the last answer.
        settle((state) => ({ data: state.data, error: e, loading: false }));
      },
    );
  }
}

/**
 * 15 Nov 2026 (the first walk of the built Windows app): what the places ask about a business while the start-up check
 * is out (BootScreen). The app's frame is mounted, hidden, during the check, and each of its places asked at once: 18
 * requests refused VAULT_LOCKED at every start, before any business was open. While a hold is on, a `venture.` request
 * waits here and nothing else does (the check's own workspace requests, the app's preferences).
 */
export interface Hold {
  /** A business is open, or the check could not say: everything held goes to the engine now, in the order asked. */
  release(): void;
  /** No business is open: each held request is refused the way the engine would refuse it, and is never sent. */
  refuse(): void;
}
type Held = { send: () => void; refuse: () => void };
const HELD = (method: string) => method.startsWith('venture.');
/** The engine's own words and code for a business that is not open (platform/runtime/engine.ts). */
const closed = () => new EngineError('VAULT_LOCKED', 'This business is closed. Open it first.');

export interface Reads { store: ReadStore; client: EngineClient; hold: () => Hold }

const made = new WeakMap<EngineClient, Reads>();
/** The store of a client as a place holds it (useEngine's wrapped client), beside `made` for the raw one. */
const stores = new WeakMap<EngineClient, ReadStore>();

/** Holds every read of this client's store while a business is being left (ReadStore.hold). Either client will do. */
export function holdReads(client: EngineClient): { release(): void; drop(): void } {
  return (stores.get(client) ?? readsFor(client).store).hold();
}

const timedOut = (error: unknown) => (error as { code?: unknown } | null)?.code === 'REQUEST_TIMEOUT';

/**
 * The one read store for this engine client, and the client every place gets from useEngine: the same client, with its
 * request wrapped so a write refreshes what it changes. subscribe, status, the desktop helpers and the fake's engine
 * pass through. Made once per client, so places keep comparing and keying by it.
 */
export function readsFor(raw: EngineClient): Reads {
  let reads = made.get(raw);
  if (reads) return reads;
  // The hold (see Hold above): one at a time per client; a second ask while one is on joins it. Both the read store and
  // a place's own request go through it.
  let held: Held[] | null = null;
  const settleHeld = (how: keyof Held) => { const waiting = held ?? []; held = null; for (const one of waiting) one[how](); };
  const hold = (): Hold => { held ??= []; return { release: () => settleHeld('send'), refuse: () => settleHeld('refuse') }; };
  const ask = ((method: MethodName, params?: unknown) => {
    const waiting = held;
    if (!waiting || !HELD(method)) return raw.request(method, params as ParamsOf<MethodName>) as Promise<unknown>;
    return new Promise((resolve, reject) => {
      waiting.push({ send: () => { try { (raw.request(method, params as ParamsOf<MethodName>) as Promise<unknown>).then(resolve, reject); } catch (error) { reject(error); } }, refuse: () => reject(closed()) });
    });
  }) as EngineClient['request'];
  const store = new ReadStore(new Proxy(raw, {
    get: (target, property, receiver) => (property === 'request' ? ask : Reflect.get(target, property, receiver)),
  }));
  const request = ((method: MethodName, params?: unknown) => {
    const sent = ask(method, params as ParamsOf<MethodName>) as Promise<unknown>;
    if (kindOf(method, params) !== 'write') return sent;
    return sent.then(
      (answer) => { store.written(); return answer; },
      (error: unknown) => { if (timedOut(error)) store.written(); throw error; },
    );
  }) as EngineClient['request'];
  const client = new Proxy(raw, {
    get: (target, property, receiver) => (property === 'request' ? request : Reflect.get(target, property, receiver)),
  });
  reads = { store, client, hold };
  made.set(raw, reads);
  stores.set(client, store);
  return reads;
}
