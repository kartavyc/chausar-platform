/** Rhythm, the Monday week-ahead brief and the Friday review. Built with no AI model; one brief per week. */
import { check, newId, type Context, type State } from '../contracts.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { ModuleHost } from '../modules/types.ts';
import { validDate } from '../memory.ts';
import { addDays, clock, closed, DAY_MS, IST_OFFSET_MS, indiaDate, isoAt, isoWeek, peekReports, record, reportsState, type EngineFigure, type Period } from './common.ts';
import { dueDates, type DueProfile } from './due-dates.ts';

export type RhythmSettings = { days: number[]; time: string; dailyClosing: boolean; financialYearStart: string; missedRule: 'run-late' | 'skip';
  mail: { on: boolean; address: string | null }; whatsapp: { on: boolean; phone: string | null } };
type BriefItem = { id: string; text: string; figure?: EngineFigure; chart?: { id: string; label: string; figure: EngineFigure }[] };
export type WeekAhead = { id: string; period: Period; scheduledFor: string; builtAt: string; late: boolean; changed: BriefItem[]; decide: BriefItem[]; due: BriefItem[];
  inbox: { id: string; text: string; reviewDate: string }[]; missed: { id: string; what: string; at: string }[]; explanation: 'not-written'; receiptIds: string[] };

export const defaultRhythm: RhythmSettings = { days: [1], time: '09:00', dailyClosing: false, financialYearStart: '04-01', missedRule: 'run-late',
  mail: { on: false, address: null }, whatsapp: { on: false, phone: null } };
/** The exact words sent: a fixed headline and a pointer back to the app, with no amounts, names, counts or digits. */
export const previews = { mail: 'The week ahead is ready. Open Chausar to see it.', whatsapp: 'The week ahead is ready. Open Chausar to see it.' };

export function rhythmSettings(state: State): RhythmSettings { return structuredClone({ ...defaultRhythm, ...(peekReports(state).rhythm ?? {}) }); }
export function rhythmView(state: State, host: ModuleHost) {
  const verified = peekReports(state).verified ?? {};
  return { ...rhythmSettings(state), mailVerified: verified.mail === true, whatsappVerified: verified.whatsapp === true, whatsappTemplate: 'not-approved' as const,
    previews: { ...previews }, testMode: host.demo, relay: 'not-available' as const };
}
const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE = /^\+[1-9]\d{7,14}$/;
export function mergeRhythm(current: RhythmSettings, payload: unknown): RhythmSettings {
  const input = closed(payload, ['days', 'time', 'dailyClosing', 'financialYearStart', 'missedRule', 'mail', 'whatsapp'], 'INVALID_RHYTHM');
  const next = structuredClone(current);
  if (input.days !== undefined) {
    check(Array.isArray(input.days) && input.days.length >= 1 && input.days.length <= 7 && input.days.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
      && new Set(input.days).size === input.days.length, 'INVALID_RHYTHM', 'Choose one or more different weekdays.');
    next.days = [...input.days].sort((a, b) => a - b);
  }
  if (input.time !== undefined) { check(typeof input.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time), 'INVALID_RHYTHM', 'Give a time as hours and minutes.'); next.time = input.time; }
  if (input.dailyClosing !== undefined) { check(typeof input.dailyClosing === 'boolean', 'INVALID_RHYTHM', 'Daily closing is on or off.'); next.dailyClosing = input.dailyClosing; }
  if (input.financialYearStart !== undefined) { check(typeof input.financialYearStart === 'string' && /^\d\d-\d\d$/.test(input.financialYearStart) && validDate(`2025-${input.financialYearStart}`), 'INVALID_RHYTHM', 'Give the financial year start as month and day.'); next.financialYearStart = input.financialYearStart; }
  if (input.missedRule !== undefined) { check(input.missedRule === 'run-late' || input.missedRule === 'skip', 'INVALID_RHYTHM', 'Choose to run a missed brief late or skip it.'); next.missedRule = input.missedRule; }
  if (input.mail !== undefined) {
    const mail = closed(input.mail, ['on', 'address'], 'INVALID_RHYTHM');
    check(mail.on === undefined || typeof mail.on === 'boolean', 'INVALID_RHYTHM', 'Mail delivery is on or off.');
    check(mail.address === undefined || mail.address === null || (typeof mail.address === 'string' && mail.address.length <= 254 && EMAIL.test(mail.address)), 'INVALID_RHYTHM', 'Give a mail address like name@example.com.');
    next.mail = { on: mail.on ?? next.mail.on, address: mail.address === undefined ? next.mail.address : mail.address };
  }
  if (input.whatsapp !== undefined) {
    const phone = closed(input.whatsapp, ['on', 'phone'], 'INVALID_RHYTHM');
    check(phone.on === undefined || typeof phone.on === 'boolean', 'INVALID_RHYTHM', 'WhatsApp delivery is on or off.');
    check(phone.phone === undefined || phone.phone === null || (typeof phone.phone === 'string' && PHONE.test(phone.phone)), 'INVALID_RHYTHM', 'Give a phone number with its country code, like +919876543210.');
    next.whatsapp = { on: phone.on ?? next.whatsapp.on, phone: phone.phone === undefined ? next.whatsapp.phone : phone.phone };
  }
  check(!next.mail.on || next.mail.address, 'INVALID_RHYTHM', 'Add a mail address before turning mail on.');
  check(!next.whatsapp.on || next.whatsapp.phone, 'INVALID_RHYTHM', 'Add a phone number before turning WhatsApp on.');
  return next;
}

/** The brief's scheduled instant: the first rhythm day inside the ISO week, at the rhythm time in India Standard Time. */
export function scheduledFor(rhythm: RhythmSettings, week: Period): string {
  const offsets = rhythm.days.map(day => (day + 6) % 7).sort((a, b) => a - b);
  const [hours, minutes] = rhythm.time.split(':').map(Number);
  return isoAt(Date.parse(`${addDays(week.from, offsets[0])}T00:00:00Z`) + (hours * 60 + minutes) * 60_000 - IST_OFFSET_MS);
}

function figure(receipt: CalculationReceipt): EngineFigure {
  return receipt.coverage.completeness === 'empty' ? { kind: 'missing', missing: 'absent' } : { kind: 'money', exact: receipt.totalMinor, receiptId: receipt.id, labels: receipt.stale ? ['stale'] : [], measure: { operation: receipt.operation, key: 'total' } };
}
const changes: { op: string; text: string }[] = [
  { op: 'net_sales', text: 'Net sales, this week against last week' },
  { op: 'received', text: 'Money received, this week against last week' },
  { op: 'billed', text: 'Invoices raised, this week against last week' },
];

/** Missed scheduled runs recorded by the job scheduler between the start of the previous week and now. */
function missedRuns(state: State, ctx: Context, since: string, until: string): WeekAhead['missed'] {
  const items: WeekAhead['missed'] = [];
  for (const job of Array.isArray(state.jobs) ? state.jobs : []) {
    if (!record(job) || (job.ownerId !== ctx.memberId && !['owner', 'cofounder'].includes(ctx.role))) continue;
    const what = typeof job.goal === 'string' ? job.goal : 'A scheduled job';
    for (const entry of Array.isArray(job.ledger) ? job.ledger : []) if (record(entry) && entry.event === 'catchup-skipped' && typeof entry.at === 'string') items.push({ id: `${job.id}:${entry.at}`, what, at: entry.at });
    for (const entry of Array.isArray(job.calendar?.records) ? job.calendar.records : []) if (record(entry) && ['skipped', 'missed'].includes(entry.status)) {
      const at = typeof entry.instant === 'string' ? entry.instant : entry.at; if (typeof at === 'string') items.push({ id: `${job.id}:${entry.id ?? at}`, what, at });
    }
  }
  return items.filter(item => item.at >= since && item.at <= until).sort((a, b) => b.at.localeCompare(a.at));
}

/** Receipts are private to one member, so each member keeps one brief per week. */
const briefKey = (ctx: Context, week: Period) => `${ctx.memberId}:${week.from}`;
/** Returns the stored brief for the week, or builds and stores the first one. */
export async function weekAhead(ctx: Context, host: ModuleHost, onDate: string): Promise<WeekAhead> {
  const week = isoWeek(onDate), key = briefKey(ctx, week); const existing = peekReports(host.store.read()).briefs?.[key];
  if (existing) return structuredClone(existing.brief);
  const s = host.services; const builtMs = clock(host); const builtAt = isoAt(builtMs);
  check(week.from <= indiaDate(builtMs), 'WEEK_NOT_STARTED', 'A brief can be built once its week has started.');
  const state = host.store.read(); const rhythm = rhythmSettings(state); const scheduled = scheduledFor(rhythm, week);
  const lastWeek = { from: addDays(week.from, -7), to: addDays(week.to, -7) };
  const receipts: CalculationReceipt[] = []; const changed: BriefItem[] = [];
  let catalog: Set<string>;
  try { catalog = new Set((s.calculator.catalog(ctx) as { id: string }[]).map(op => op.id)); } catch { catalog = new Set(); }
  for (const change of changes.filter(item => catalog.has(item.op))) {
    try {
      const before: CalculationReceipt = await s.calculator.calculate(ctx, { operation: change.op, period: lastWeek });
      const after: CalculationReceipt = await s.calculator.calculate(ctx, { operation: change.op, period: week });
      receipts.push(before, after);
      changed.push({ id: change.op, text: change.text, figure: figure(after), chart: [{ id: 'last-week', label: 'Last week', figure: figure(before) }, { id: 'this-week', label: 'This week', figure: figure(after) }] });
    } catch (error) { if ((error as { code?: string }).code === 'ACCESS_REVOKED') throw error; }
  }
  const decide: BriefItem[] = [
    ...state.actions.filter(action => record(action) && action.status === 'prepared').map(action => ({ id: String(action.id), text: 'A prepared action is waiting for your approval.' })),
    ...state.actions.filter(action => record(action) && action.status === 'unknown').map(action => ({ id: String(action.id), text: 'An action has an unknown result. Check it before anything is retried.' })),
    ...state.jobs.filter(job => record(job) && job.status === 'approval-blocked' && job.ownerId === ctx.memberId).map(job => ({ id: String(job.id), text: 'A scheduled job is waiting for your approval.' })),
  ];
  const profile: DueProfile | null = peekReports(state).dueProfile ?? null;
  const due = dueDates({ from: onDate, days: 14, profile }).rows.map(row => ({ id: row.id, text: `${row.what}: due ${row.dueOn}` }));
  const inbox = (s.reports.dueDecisions(ctx, { dueOn: week.to }) as { id: string; text: string; reviewDate: string }[]).map(item => ({ id: item.id, text: item.text, reviewDate: item.reviewDate }));
  const missed = missedRuns(state, ctx, `${lastWeek.from}T00:00:00.000Z`, builtAt);
  const brief: WeekAhead = { id: newId('brief'), period: week, scheduledFor: scheduled, builtAt, late: builtMs - Date.parse(scheduled) > 3_600_000,
    changed, decide, due, inbox, missed, explanation: 'not-written', receiptIds: receipts.map(receipt => receipt.id) };
  const sourceIds = [...new Set(receipts.flatMap(receipt => receipt.sourceIds))], rowIds = [...new Set(receipts.flatMap(receipt => receipt.rowIds))];
  return host.store.update(next => {
    const briefs = (reportsState(next).briefs ??= {});
    if (briefs[key]) return structuredClone(briefs[key].brief);
    briefs[key] = { brief: structuredClone(brief), sourceIds, rowIds, memberId: ctx.memberId };
    return structuredClone(brief);
  });
}

export async function friday(ctx: Context, host: ModuleHost, onDate: string) {
  const week = isoWeek(onDate);
  const decisions = (host.services.reports.dueDecisions(ctx, { dueOn: week.to }) as any[]).map(item => {
    const review = Array.isArray(item.reviews) ? item.reviews.at(-1) : undefined;
    const observed = record(review) ? typeof review.notes === 'string' && review.notes.trim() ? review.notes : typeof review.observation?.summary === 'string' ? review.observation.summary : null : null;
    return { id: String(item.id), text: String(item.text ?? item.title ?? ''), reviewDate: String(item.reviewDate), observed, receiptIds: Array.isArray(item.receiptIds) ? [...item.receiptIds] : [] };
  });
  let lessons: { available: boolean; items: { id: string; title: string; evidence: number; change: string }[] } = { available: false, items: [] };
  try {
    const reply = await host.call('memory.lessons', {});
    const views = Array.isArray(reply) ? reply : [];
    lessons = { available: true, items: views.filter(view => record(view?.candidate)).slice(0, 5).map(view => ({ id: String(view.candidate.id), title: String(view.candidate.title),
      evidence: Array.isArray(view.candidate.evidence) ? view.candidate.evidence.length : 0, change: String(view.candidate.change?.kind ?? 'unknown') })) };
  } catch { /* Lessons are not available here: the review says so. */ }
  return { id: newId('friday'), period: week, builtAt: isoAt(clock(host)), decisions, lessons };
}

/**
 * Scheduled work: once the owner has saved a rhythm, build this week's brief when its time has come.
 * A brief missed by more than an hour follows the missed rule. Until a rhythm is saved, briefs are built only on request.
 */
export async function tickBrief(ctx: Context, host: ModuleHost): Promise<unknown[]> {
  const ms = clock(host), today = indiaDate(ms), week = isoWeek(today), state = host.store.read();
  if (!peekReports(state).rhythm || peekReports(state).briefs?.[briefKey(ctx, week)]) return [];
  const rhythm = rhythmSettings(state), due = Date.parse(scheduledFor(rhythm, week));
  if (ms < due || (rhythm.missedRule === 'skip' && ms - due > 3_600_000)) return [];
  if (ms - due > 7 * DAY_MS) return [];
  const brief = await weekAhead(ctx, host, today);
  return [{ module: 'reports', brief: brief.id, period: brief.period, late: brief.late }];
}
