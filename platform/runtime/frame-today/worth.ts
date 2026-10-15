/**
 * `todayx.worthALook` (TD-01), every kind: at most five rows, one per episode, each from a record
 * another method holds, read as the same caller. Nothing is computed into a figure here.
 *
 * - file refused: this caller's visible `source.import-refused` audit events.
 * - decision due: `decisions.journal.due` for the business day.
 * - missed while asleep: jobs-ext's `jobsx.missed` notes not yet seen (one row per job, its newest
 *   note), else the core job ledger's `catchup-skipped` entries when jobs-ext is not installed.
 * - approval expired: the work-books lane's `approvals.list` `expired` rows.
 * - update ready: the release lane's `release.status` with a verified candidate staged by a check.
 * - figure moved: a published business alert (`alerts.list`) with an open episode. An alert records
 *   that a threshold was crossed, never why, so each row is labelled "lead, not tested". The figure is
 *   the episode's latest observed value with its own receipt, exactly as recorded.
 * - due soon: the reports lane's `reportsx.due` for seven days, only once a due profile is saved
 *   (without one the table would list dates that may not apply to this business).
 * - brief late: the reports lane's `reportsx.weekAhead.late`, a read that builds nothing (see lateBrief).
 * - setup: first run not finished keeps the first place.
 */
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { moduleMethods } from '../modules/registry.ts';
import { auditEvents } from './activity.ts';
import { addDays, businessToday, firstRun } from './frame.ts';

export type WorthRowOut = {
  id: string; kind: string; subject: string | null; at: string | null; opens: string | null;
  figure?: { unit: 'paise' | 'count' | 'basis-points'; exact: string; receiptId: string };
  finding?: 'lead-not-tested' | 'tested';
};
type Rec = Record<string, any>;
export const WORTH_ROWS_MAX = 5;
const isIso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/.test(value) && !Number.isNaN(Date.parse(value));
const subjectOf = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value) ? value : null;
const receiptId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
async function quiet<T>(work: () => Promise<T> | T): Promise<T | null> { try { return await work(); } catch { return null; } }
const call = (host: ModuleHost, method: string, payload: Record<string, unknown> = {}) => quiet(() => host.call(method, payload) as Promise<any>);
const installed = (method: string) => moduleMethods.has(method);

async function missedRows(ctx: Context, host: ModuleHost): Promise<WorthRowOut[]> {
  if (installed('jobsx.missed')) {
    const notes: any = await call(host, 'jobsx.missed');
    const newest = new Map<string, Rec>();
    for (const note of Array.isArray(notes) ? notes : []) {
      if (!note || note.seen === true || typeof note.jobId !== 'string' || typeof note.id !== 'string' || !isIso(note.at)) continue;
      const held = newest.get(note.jobId);
      if (!held || note.at > held.at) newest.set(note.jobId, note);
    }
    return [...newest.values()].map(note => ({ id: `missed:${note.id}`, kind: 'missed-while-asleep', subject: null, at: note.at, opens: '#/work/jobs' }));
  }
  const jobs: any = await call(host, 'jobs.list');
  const rows: WorthRowOut[] = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const skipped = (Array.isArray(job?.ledger) ? job.ledger : []).map((entry: Rec, index: number) => ({ entry, index })).filter(({ entry }: Rec) => entry?.event === 'catchup-skipped');
    const last = skipped.at(-1);
    if (last && typeof job.id === 'string') rows.push({ id: `${job.id}:${last.index}`, kind: 'missed-while-asleep', subject: null, at: isIso(last.entry.at) ? last.entry.at : null, opens: '#/work/jobs' });
  }
  return rows;
}

async function movedRows(host: ModuleHost): Promise<WorthRowOut[]> {
  const alerts: any = await call(host, 'alerts.list');
  const rows: WorthRowOut[] = [];
  for (const alert of Array.isArray(alerts) ? alerts : []) {
    if (alert?.status !== 'published' || !Array.isArray(alert.episodes)) continue;
    for (const episode of alert.episodes) {
      if (episode?.status !== 'open' || typeof episode.id !== 'string') continue;
      const observations = (Array.isArray(alert.observations) ? alert.observations : []).filter((o: Rec) => Array.isArray(episode.observationIds) && episode.observationIds.includes(o?.id));
      const latest = observations.filter((o: Rec) => isIso(o.observedAt)).sort((a: Rec, b: Rec) => a.observedAt.localeCompare(b.observedAt)).at(-1);
      const unit = alert.definition?.unit?.kind === 'basis-points' ? 'basis-points' as const : alert.definition?.unit?.kind === 'money' && alert.definition.unit.currency === 'INR' ? 'paise' as const : null;
      const figure = latest && unit && typeof latest.valueMinor === 'string' && /^-?(0|[1-9][0-9]{0,30})$/.test(latest.valueMinor) && receiptId(latest.receipt?.receiptId)
        ? { unit, exact: latest.valueMinor, receiptId: latest.receipt.receiptId } : undefined;
      const at = isIso(episode.reopenedAt) ? episode.reopenedAt : isIso(episode.openedAt) ? episode.openedAt : null;
      // An alert holds no measured cause: a moved figure stays a lead.
      rows.push({ id: `moved:${episode.id}`, kind: 'moved', subject: subjectOf(alert.definition?.label), at, opens: null, ...(figure ? { figure } : {}), finding: 'lead-not-tested' });
    }
  }
  return rows;
}

async function dueRows(host: ModuleHost, today: string): Promise<WorthRowOut[]> {
  if (!installed('reportsx.due')) return [];
  const due: any = await call(host, 'reportsx.due', { from: today, days: 7 });
  if (!due || due.profile === null || due.profile === undefined || due.covered !== true || !Array.isArray(due.rows)) return [];
  return due.rows.filter((row: Rec) => typeof row?.id === 'string' && isIso(row.dueOn) && row.dueOn >= today && row.dueOn <= addDays(today, 7))
    .map((row: Rec) => ({ id: `due:${row.id}`, kind: 'due-soon', subject: subjectOf(row.what), at: row.dueOn, opens: '#/reports/duedates' }));
}

/**
 * A brief built late. `reportsx.weekAhead` builds this week's brief when none exists, and a brief built on
 * request is "late" against the rhythm's hour by construction, so reading it from Today would both build a
 * brief and report a lateness Today itself caused. The row is served only from a read that builds nothing:
 * `reportsx.weekAhead.late` {} → `{ briefId, builtAt, late } | null` (Round 4 contract asked of
 * reports-tools-trust). Until that lane registers it, no brief-late row is shown.
 */
async function lateBrief(host: ModuleHost): Promise<WorthRowOut[]> {
  if (!installed('reportsx.weekAhead.late')) return [];
  const brief: any = await call(host, 'reportsx.weekAhead.late');
  return brief?.late === true && typeof brief.briefId === 'string'
    ? [{ id: `brief:${brief.briefId}`, kind: 'brief-late', subject: null, at: isIso(brief.builtAt) ? brief.builtAt : null, opens: '#/reports/weekahead' }] : [];
}

async function expiredRows(host: ModuleHost): Promise<WorthRowOut[]> {
  if (!installed('approvals.list')) return [];
  const listed: any = await call(host, 'approvals.list');
  return (Array.isArray(listed?.expired) ? listed.expired : []).filter((row: Rec) => typeof row?.id === 'string')
    .map((row: Rec) => ({ id: `expired:${row.id}`, kind: 'approval-expired', subject: subjectOf(row.what?.name) ?? subjectOf(row.touches), at: isIso(row.expiresAt) ? row.expiresAt : null, opens: '#/work/approvals' }));
}

async function updateRows(host: ModuleHost): Promise<WorthRowOut[]> {
  if (!installed('release.status')) return [];
  const status: any = await call(host, 'release.status');
  const version = status?.configured === true && status.candidate && typeof status.candidate.version === 'string' ? subjectOf(status.candidate.version) : null;
  return version ? [{ id: `update:${version}`, kind: 'update-ready', subject: version, at: null, opens: '#/trust/vault' }] : [];
}

export async function worthALookAll(ctx: Context, host: ModuleHost) {
  const state = host.store.read(), today = businessToday(state);
  const sources: any = await call(host, 'sources.list');
  if (!Array.isArray(sources) || sources.length === 0) return { rows: [], state: 'not-loaded-yet' as const };
  const past: WorthRowOut[] = [];
  for (const event of auditEvents(host.store, ctx)) if (event.type === 'source.refused')
    past.push({ id: event.id, kind: 'file-refused', subject: event.values.source ?? null, at: event.at, opens: '#/books/sources' });
  const decisions: any = await call(host, 'decisions.journal.due', { dueOn: today });
  for (const decision of Array.isArray(decisions) ? decisions : []) if (typeof decision?.id === 'string')
    past.push({ id: decision.id, kind: 'decision-due', subject: typeof decision.text === 'string' && decision.text.length <= 200 ? decision.text : null,
      at: isIso(decision.reviewDate) ? decision.reviewDate : null, opens: '#/ask/decisions' });
  const [missed, moved, expired, late, update, due] = await Promise.all([missedRows(ctx, host), movedRows(host), expiredRows(host), lateBrief(host), updateRows(host), dueRows(host, today)]);
  past.push(...missed, ...moved, ...expired, ...late);
  past.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  const setup = await firstRun(ctx, host);
  // Order: setup first, then what is due soonest, then what changed, newest first, then an update.
  const rows = [
    ...(setup.firstMissing ? [{ id: `setup-${setup.firstMissing}`, kind: 'setup', subject: null, at: null, opens: '#/first-run' }] : []),
    ...due, ...past, ...update,
  ];
  // One row per episode: an id appears once.
  const seen = new Set<string>();
  const unique = rows.filter(row => !seen.has(row.id) && seen.add(row.id));
  return { rows: unique.slice(0, WORTH_ROWS_MAX), state: 'ready' as const };
}
