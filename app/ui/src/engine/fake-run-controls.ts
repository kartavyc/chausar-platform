/**
 * The fake engine's run controls for Ink v2 wave 4 package 4F3: Stop, Force stop, Resume, the round gate, the owner's
 * notes for the next step, Pause all and Stop all, and Away, answered with the engine's rules and words
 * (platform/runtime/venture/delivery/run-controls.ts, run-control-rows.ts, away.ts, harness/controls.ts).
 *
 * The engine's rules it keeps: Stop on a run with nothing out stops it at once and keeps every finished step; on a run
 * whose turn is out (the fake's 'active' runs) the stop is recorded, the run reads "Stopping" and stops once the step in
 * progress comes back (here a moment later); Force stop stops it at once and says what is lost. A stopped run waits for
 * Resume and never reads as done; Today gets a row with Resume (primary) and Run again. Refusals keep the engine's codes:
 * RUN_NOT_FOUND, RUN_NOT_RUNNING, RUN_ALREADY_STOPPED, RUN_NOT_STOPPED and RUN_SUPERSEDED (a run Run again replaced).
 * The hosted web app is the owner's app channel, so it is answered there too; only a chat channel is refused, and the
 * fake has none. Run again starts a new run id, as the engine does. Away is a list built from records; Chausar sends nothing.
 */

import { EngineError, type AwayView, type InvoiceLite, type ClientLite, type QueueAction, type QueueRow, type RowFigureReceipt, type RunDetail } from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_4F3_METHODS: readonly string[] = [
  'venture.runs.stop', 'venture.runs.resume', 'venture.runs.roundGate', 'venture.runs.steer', 'venture.business.pause', 'venture.away.set', 'venture.away.get',
];

/** The engine's words (delivery/harness/controls.ts, delivery/run-controls.ts, views/runs.ts, delivery/away.ts). */
export const STOPPED_BY_YOU = 'Stopped by you. Finished steps are kept.';
const FORCE_STOPPED = 'Stopped by you. The step in progress was thrown away.';
const STOPPING = 'Stopping: the step in progress finishes first.';
const RECEIVED = 'Stop received. The step in progress finishes, then the run stops.';
const NOT_RUNNING = 'This run is not running, so there is nothing to stop or steer.';
const ALREADY = 'This run is already stopped. Resume it or run it again.';
const NOT_STOPPED = 'This run is not stopped, so there is nothing to resume.';
const RESUMED = 'Resumed. Approve the next step when you are ready.';
const RESUMED_ANSWER = 'Resumed. Answer the question to go on.';
const STEER_SENT = 'Sent. Waiting for the agent to pick it up.';
const SUPERSEDED = 'A newer run of this order replaced this one, so it cannot be resumed. Open the newer run instead.';
const PAUSED_VIEW = 'Paused by you. No new work starts until you unpause.';
const NOT_AWAY = 'You are not away. Set the days you will be away and Chausar lists what falls due.';
const MAX_NOTE_CHARS = 500;
const MAX_WAITING_NOTES = 5;
const MAX_AWAY_DAYS = 90;
const DAY_MS = 86_400_000;
/** The sample run's spend cap in micro-dollars, the amount behind its "$0.40". */
const SAMPLE_CAP_MICROS = '400000';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** How long the fake's step in progress takes to come back after a Stop, in ms. */
export const FAKE_STOP_SETTLES_MS = 600;

/** The sample's scope and usual time on the Editor's run, as the engine freezes them when a run starts (O21, U6). */
const SAMPLE_CONTROLS: Record<string, Partial<RunDetail>> = {
  31: {
    usually: 'Usually 3 to 5 min',
    scope: {
      tools: ['Read the files you gave it', 'Cut video with ffmpeg', 'Checked the frames'], actions: ['Post to YouTube, for your approval'],
      cap: '$0.40', posture: 'approve-each', capReceiptId: 'fig:scope:31',
      line: 'Set when it started: 3 tools, 1 outside action it may propose for your approval, a spend cap of $0.40, approve each step.',
    },
  },
};

type Held = { question?: RunDetail['question'] };

const clone = <T>(value: T): T => structuredClone(value);
/** Micro-dollars in rupees at a typed rate ('83.50'), rounded to the paisa, as the engine's rupeeFigure writes them. */
function rupeesOf(micros: string, perUsd: string): string {
  const [whole = '0', part = ''] = perUsd.split('.');
  const rate = BigInt(whole) * 10_000n + BigInt(part.padEnd(4, '0').slice(0, 4));
  const paise = (BigInt(micros) * rate + 50_000_000n) / 100_000_000n;
  return `₹${(paise / 100n).toLocaleString('en-IN')}.${String(paise % 100n).padStart(2, '0')}`;
}
const day = (iso: string) => iso.slice(0, 10);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** '2026-10-01' as '01 Oct 2026', the engine's day-month-year order (records.ts formatVentureDate). */
const say = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(0, 4)}`;
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

export class FakeRunControls {
  private readonly host: W4DeskHost;
  private readonly held = new Map<string, Held>();
  private readonly stops = new Map<string, number>();
  /** Stopped runs a newer run of the same work replaced (Run again): they cannot be resumed. */
  private readonly replaced = new Set<string>();
  /** Since when each business is paused (Pause all), by id; absent while it is not. */
  private readonly pausedSince = new Map<string, string>();
  private away: { from: string; to: string } | null = null;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    if (options.fresh) return;
    for (const run of this.runs()) Object.assign(run, clone(SAMPLE_CONTROLS[run.runId] ?? {}));
  }

  private runs(): RunDetail[] {
    return this.host.runs?.() ?? [];
  }

  /** venture.get's paused field, as the engine's core/venture.ts builds it from the newest Pause all. */
  pausedField(): { paused?: { since: string; line: string } } {
    const since = this.pausedSince.get(this.host.current());
    return since ? { paused: { since, line: PAUSED_VIEW } } : {};
  }

  /**
   * A run as venture.runs.get sends it: its scope's cap also in rupees at the owner's own rate, when one is set (the
   * engine's views/runs.ts scopeRupees), read from the spend policy now.
   */
  view(run: RunDetail): RunDetail {
    const rate = this.rate();
    if (!run.scope || !rate) return run;
    return { ...run, scope: { ...run.scope, capRupees: rupeesOf(SAMPLE_CAP_MICROS, rate.perUsd), capRate: rate.words } };
  }

  /** The owner's rupee rate as the spend policy holds it ('83.50' and its words), or null. */
  private rate(): { perUsd: string; words: string } | null {
    try {
      const policy = this.host.ask('venture.spend.policy.get', {}) as { inrPerUsd?: string | null; rupeeRate?: string | null } | null;
      return policy?.inrPerUsd && policy.rupeeRate ? { perUsd: policy.inrPerUsd, words: policy.rupeeRate } : null;
    } catch { return null; }
  }

  /** The receipt of a run's spend cap as its scope froze it (the engine's views/row-receipts.ts scopeCap). */
  receipt(id: string): RowFigureReceipt | undefined {
    const run = id.startsWith('fig:scope:') ? this.runs().find((r) => r.runId === id.slice('fig:scope:'.length)) : undefined;
    if (!run?.scope) return undefined;
    const rate = this.rate();
    const rupees = rate ? rupeesOf(SAMPLE_CAP_MICROS, rate.perUsd) : null;
    const figures: RowFigureReceipt['figures'] = [{ key: 'cap', label: "This run's spend cap", amount: SAMPLE_CAP_MICROS, unit: 'micros', currency: 'USD', display: run.scope.cap }];
    if (rate && rupees) {
      figures.push({ key: 'cap-inr', label: 'The same in rupees', amount: SAMPLE_CAP_MICROS, unit: 'micros', currency: 'INR', display: rupees });
      figures.push({ key: 'rate', label: 'Your rate', amount: rate.perUsd, unit: 'rate', currency: 'INR', display: rate.words });
    }
    return {
      id, kind: 'row-figure', ventureId: run.businessId, at: run.startedAt, operation: 'venture.row-figure', subject: { type: 'scope-cap', recordId: run.runId },
      figures, allowedNumbers: figures.map((f) => f.display), digest: `scope-cap-${run.runId}`, stale: false,
      explanation: `Set when the run started, from the business's spend cap for one run: ${run.scope.cap}.${rate && rupees ? ` In rupees at ${rate.words}: ${rupees}.` : ''} It does not change while the run goes on.`,
    };
  }

  handles(method: string): boolean {
    return FAKE_4F3_METHODS.includes(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.runs.stop': return this.stop(p);
      case 'venture.runs.resume': return this.resumeMethod(p);
      case 'venture.runs.roundGate': return this.roundGate(p);
      case 'venture.runs.steer': return this.steer(p);
      case 'venture.business.pause': return this.pause(p);
      case 'venture.away.set': return this.awaySet(p);
      case 'venture.away.get': return this.awayView();
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /** A decision on one of this desk's Today rows (ids start `runctl:`): Resume, Run again, and the gate's Continue and Stop. */
  decide(row: QueueRow, action: QueueAction['id'], answer?: string): string | null {
    if (!row.id.startsWith('runctl:')) return null;
    const runId = row.id.split(':')[1]!;
    const run = this.runs().find((r) => r.runId === runId);
    if (!run) return null;
    if (action === 'resume') return this.resume(run);
    if (action === 'run-again') {
      // The engine starts a new run of the same order from its files (a fresh run id); the stopped one stays stopped,
      // replaced, and can no longer be resumed.
      const again = `${runId}-${this.runs().filter((r) => r.runId === runId || r.runId.startsWith(`${runId}-`)).length + 1}`;
      const { stop: _s, result: _r, question: _q, steer: _n, gate: _g, live: _l, ...rest } = run;
      this.runs().push({
        ...structuredClone(rest), runId: again, state: 'active', startedAt: this.host.now(), elapsed: '0s',
        ...(run.progress && run.progress !== 'indeterminate' ? { progress: { done: 0, total: run.progress.total } } : {}),
        steps: run.steps.map((s, i) => ({ id: s.id, purpose: s.purpose, state: i === 0 ? 'current' : 'pending' })),
      });
      this.replaced.add(runId);
      this.dropRows(runId);
      this.host.emit({ type: 'run.started', businessId: run.businessId, runId: again, at: this.host.now() });
      return 'Started again with the same files.';
    }
    if (action === 'stop') { this.stopNow(run, false); return STOPPED_BY_YOU; }
    if (action === 'continue') {
      if (run.gate) run.gate = { ...run.gate, waiting: null };
      if (answer?.trim()) this.note(run, answer.trim());
      this.dropRows(runId);
      this.host.emit({ type: 'run.step', businessId: run.businessId, runId, at: this.host.now() });
      return 'The run goes on. Approve the next step when you are ready.';
    }
    return null;
  }

  // --- the methods ---

  private runOf(p: Record<string, unknown>): RunDetail {
    const runId = typeof p.runId === 'string' ? p.runId : '';
    const run = this.runs().find((r) => r.runId === runId && r.businessId === this.host.current());
    if (!run) throw new EngineError('RUN_NOT_FOUND', 'That run was not found.');
    return run;
  }

  private stop(p: Record<string, unknown>) {
    const run = this.runOf(p);
    if (run.stop?.state === 'stopped') throw new EngineError('RUN_ALREADY_STOPPED', ALREADY);
    if (run.state !== 'active' && run.state !== 'waiting') throw new EngineError('RUN_NOT_RUNNING', NOT_RUNNING);
    const force = p.force === true;
    if (run.stop?.state === 'stopping' && !force) return { run: clone(run), line: RECEIVED };
    // The step in progress, named before the stop, for what a force stop loses.
    const step = run.steps.find((s) => s.state === 'current' || s.state === 'waiting')?.purpose ?? 'the step in progress';
    if (run.state === 'active' && !force) {
      // A turn is out: the stop is recorded, the step in progress finishes, then the run stops.
      run.stop = { state: 'stopping', line: STOPPING };
      this.host.emit({ type: 'run.step', businessId: run.businessId, runId: run.runId, at: this.host.now() });
      setTimeout(() => { if (run.stop?.state === 'stopping') this.stopNow(run, false); }, FAKE_STOP_SETTLES_MS);
      return { run: clone(run), line: RECEIVED };
    }
    const cut = run.state === 'active';
    this.stopNow(run, cut);
    return cut
      ? { run: clone(run), line: 'Stopped by you.', lost: `The step in progress is thrown away: ${step}. Anything already sent stays sent.` }
      : { run: clone(run), line: STOPPED_BY_YOU };
  }

  /** The run stops: it waits at the step it stopped on for Resume, its question kept for then, and Today gets its row. */
  private stopNow(run: RunDetail, cut: boolean): void {
    const line = cut ? FORCE_STOPPED : STOPPED_BY_YOU;
    if (run.question) this.held.set(run.runId, { question: run.question });
    delete run.question;
    run.state = 'waiting';
    run.stop = { state: 'stopped', line };
    run.result = line;
    if (run.gate) run.gate = { ...run.gate, waiting: null };
    run.steps = run.steps.map((s) => (s.state === 'current' ? { ...s, state: 'waiting' } : s));
    const n = (this.stops.get(run.runId) ?? 0) + 1;
    this.stops.set(run.runId, n);
    this.dropRows(run.runId);
    const seed = {
      id: `runctl:${run.runId}:stopped-${n}`, businessId: run.businessId, businessName: this.businessName(run.businessId), agent: run.agent,
      kind: 'draft' as const, createdAt: this.host.now(), title: `${run.purpose} is stopped`, line, viewRef: { kind: 'run' as const, id: run.runId },
      actions: [{ id: 'run-again' as const, label: 'Run again', primary: false }, { id: 'resume' as const, label: 'Resume', primary: true }],
    };
    this.host.setRows([...this.host.rows(), { ...seed, digest: this.host.digest(seed) }]);
    this.host.emit({ type: 'run.stopped', businessId: run.businessId, runId: run.runId, at: this.host.now() });
    this.host.emit({ type: 'queue.changed', businessId: run.businessId, at: this.host.now() });
  }

  private resumeMethod(p: Record<string, unknown>) {
    const run = this.runOf(p);
    if (run.stop?.state !== 'stopped') throw new EngineError('RUN_NOT_STOPPED', NOT_STOPPED);
    if (this.replaced.has(run.runId)) throw new EngineError('RUN_SUPERSEDED', SUPERSEDED);
    if (this.pausedSince.has(this.host.current())) throw new EngineError('BUSINESS_PAUSED', 'This business is paused, so no new work starts. Unpause it from the business menu.');
    const line = this.resume(run);
    return { run: clone(run), line };
  }

  private resume(run: RunDetail): string {
    const held = this.held.get(run.runId);
    this.held.delete(run.runId);
    delete run.stop; delete run.result;
    if (held?.question) run.question = held.question;
    this.dropRows(run.runId);
    this.host.emit({ type: 'run.step', businessId: run.businessId, runId: run.runId, at: this.host.now() });
    this.host.emit({ type: 'run.waiting', businessId: run.businessId, runId: run.runId, at: this.host.now() });
    return held?.question ? RESUMED_ANSWER : RESUMED;
  }

  private steer(p: Record<string, unknown>) {
    const raw = typeof p.text === 'string' ? p.text.replace(/\r\n/g, '\n').trim() : null;
    if (raw === null) throw new EngineError('INVALID_VENTURE_REQUEST', 'Your note must be text.');
    if (raw.length < 1 || raw.length > MAX_NOTE_CHARS) throw new EngineError('INVALID_VENTURE_REQUEST', `Your note must be between 1 and ${MAX_NOTE_CHARS} characters.`);
    const run = this.runOf(p);
    if (run.state !== 'active' && run.state !== 'waiting') throw new EngineError('RUN_NOT_RUNNING', NOT_RUNNING);
    if ((run.steer ?? []).filter((note) => note.line === STEER_SENT).length >= MAX_WAITING_NOTES) {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'Five notes already wait for the next step. Send more once the agent picks them up.');
    }
    this.note(run, raw);
    this.host.emit({ type: 'run.step', businessId: run.businessId, runId: run.runId, at: this.host.now() });
    return { run: clone(run), line: STEER_SENT };
  }

  private note(run: RunDetail, text: string): void {
    run.steer = [...(run.steer ?? []), { text, at: this.host.now(), line: STEER_SENT }];
  }

  private roundGate(p: Record<string, unknown>) {
    if (typeof p.on !== 'boolean') throw new EngineError('INVALID_VENTURE_REQUEST', 'on must be true or false.');
    if (p.every !== undefined && ![1, 2, 3, 5].includes(p.every as number)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose every 1, 2, 3 or 5 rounds.');
    const run = this.runOf(p);
    if (run.state !== 'active' && run.state !== 'waiting') throw new EngineError('RUN_NOT_RUNNING', 'This run is not running, so it has no next round.');
    const every = (p.every ?? 1) as 1 | 2 | 3 | 5;
    run.gate = { on: p.on, every, waiting: p.on ? run.gate?.waiting ?? null : null };
    this.host.emit({ type: 'run.step', businessId: run.businessId, runId: run.runId, at: this.host.now() });
    const line = !p.on ? 'The round gate is off.' : every === 1 ? 'The run waits for you after every round.' : `The run waits for you after every ${every} rounds.`;
    return { run: clone(run), line };
  }

  private pause(p: Record<string, unknown>) {
    if (typeof p.paused !== 'boolean') throw new EngineError('INVALID_VENTURE_REQUEST', 'paused must be true or false.');
    if (p.stopRunning !== undefined && typeof p.stopRunning !== 'boolean') throw new EngineError('INVALID_VENTURE_REQUEST', 'stopRunning must be true or false.');
    if (!p.paused && p.stopRunning) throw new EngineError('INVALID_VENTURE_REQUEST', 'Stop all goes with pausing.');
    if (!p.paused) this.pausedSince.delete(this.host.current());
    else if (!this.pausedSince.has(this.host.current())) this.pausedSince.set(this.host.current(), this.host.now());
    let stopped = 0;
    if (p.stopRunning) {
      for (const run of this.runs()) {
        if (run.businessId !== this.host.current() || (run.state !== 'active' && run.state !== 'waiting') || run.stop) continue;
        if (run.state === 'active') {
          run.stop = { state: 'stopping', line: STOPPING };
          setTimeout(() => { if (run.stop?.state === 'stopping') this.stopNow(run, false); }, FAKE_STOP_SETTLES_MS);
        } else {
          this.stopNow(run, false);
        }
        stopped += 1;
      }
    }
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    const line = !p.paused ? 'Unpaused. Stopped runs stay stopped until you resume them.'
      : !p.stopRunning ? 'Paused. No new work starts until you unpause.'
        : `Paused. ${stopped === 1 ? '1 run is' : `${stopped} runs are`} stopping or stopped. No new work starts until you unpause.`;
    return { paused: p.paused, stopped, line };
  }

  private awaySet(p: Record<string, unknown>): AwayView {
    if (Object.keys(p).some((key) => key !== 'from' && key !== 'to')) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    if (!isDay(p.from)) throw new EngineError('INVALID_VENTURE_REQUEST', 'The first day away must be a date like 2026-10-15.');
    if (!isDay(p.to)) throw new EngineError('INVALID_VENTURE_REQUEST', 'The last day away must be a date like 2026-10-15.');
    if (p.from > p.to) throw new EngineError('INVALID_VENTURE_REQUEST', 'The first day away comes before the last.');
    if (p.to < day(this.host.now())) throw new EngineError('INVALID_VENTURE_REQUEST', 'The last day away is already past.');
    if (Date.parse(`${p.to}T00:00:00.000Z`) - Date.parse(`${p.from}T00:00:00.000Z`) >= MAX_AWAY_DAYS * DAY_MS) {
      throw new EngineError('INVALID_VENTURE_REQUEST', `Chausar plans for at most ${MAX_AWAY_DAYS} days away at a time.`);
    }
    this.away = { from: p.from, to: p.to };
    return this.awayView();
  }

  /** The list, built from the fake's records the way the engine builds it from its own. */
  private awayView(): AwayView {
    const waiting = this.host.rows().filter((row) => row.businessId === this.host.current()).length;
    const keepsRunning = ['Backups of this business', 'Connection checks'];
    const today = day(this.host.now());
    const live = this.away && addDays(this.away.to, 7) >= today ? this.away : null;
    if (!live) return { away: null, promises: [], keepsRunning, approvalsWaiting: waiting, autoReply: null, line: NOT_AWAY };
    const back = addDays(live.to, 1);
    const name = this.businessName(this.host.current());
    const autoReply = `Thank you for your message. I am away from ${say(live.from)} to ${say(live.to)} and back on ${say(back)}. I will reply after I am back.\n\n${name}`;
    const waits = `${waiting} ${waiting === 1 ? 'thing waits' : 'things wait'} for you.`;
    const started = today >= live.from;
    const line = today > live.to ? `You were away from ${say(live.from)} to ${say(live.to)}.`
      : started ? `You are away until ${say(live.to)}. ${waits}` : `Away from ${say(live.from)} to ${say(live.to)}. ${waits}`;
    return {
      away: { ...live }, promises: this.promises(live.from, live.to), keepsRunning, approvalsWaiting: waiting, autoReply, line,
      // 4J19: the rows made while away, by their day, as the engine's delivery/away.ts lists them for "Since you left".
      ...(started ? { since: { from: live.from, to: live.to, rowIds: this.host.rows().filter((row) => row.createdAt.slice(0, 10) >= live.from && row.createdAt.slice(0, 10) <= live.to).map((row) => row.id) } } : {}),
    };
  }

  /** Client payments due on issued invoices between the two days, as the engine lists them. */
  private promises(from: string, to: string): AwayView['promises'] {
    const read = <T>(method: string): T[] => { try { return (this.host.ask(method, {}) as T[]) ?? []; } catch { return []; } };
    const clients = new Map(read<ClientLite>('venture.client.list').map((client) => [client.id, client.name]));
    return read<InvoiceLite>('venture.invoice.list')
      .filter((invoice) => (invoice.status === 'issued' || invoice.status === 'part-paid') && invoice.dueDate && invoice.dueDate >= from && invoice.dueDate <= to)
      .map((invoice) => ({ due: invoice.dueDate!, line: `${clients.get(invoice.clientId) ?? 'A client'}'s payment for ${invoice.number ?? 'an invoice'} is due.` }))
      .sort((a, b) => a.due.localeCompare(b.due) || a.line.localeCompare(b.line));
  }

  private businessName(id: string): string {
    return this.host.businesses?.().find((b) => b.id === id)?.name ?? id;
  }

  private dropRows(runId: string): void {
    this.host.setRows(this.host.rows().filter((row) => !row.id.startsWith(`runctl:${runId}:`)));
  }
}
