/** Rhythm, the Monday week-ahead brief and the Friday review. Built with no AI model; one brief per week. */
import { check, newId, type Context, type State } from '../contracts.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { ModuleHost } from '../modules/types.ts';
import { validDate } from '../memory.ts';
import { addDays, clock, closed, DAY_MS, IST_OFFSET_MS, indiaDate, isoAt, isoWeek, peekReports, record, reportsState, type EngineFigure, type Language, type Period, type Words } from './common.ts';
import { dueDates, dueWhat, type DueProfile } from './due-dates.ts';
import { hiddenKinds, markKinds, withheldFigure, withheldGap, withheldKinds, type MarkKind } from './withhold.ts';

export type RhythmSettings = { days: number[]; time: string; dailyClosing: boolean; financialYearStart: string; missedRule: 'run-late' | 'skip';
  mail: { on: boolean; address: string | null }; whatsapp: { on: boolean; phone: string | null } };
/**
 * `movement` says whether a number moved between the two weeks: `same` when both weeks have the same exact value,
 * `not-enough` when the earlier week has no records to compare with. `coverage` is `partial` when a receipt's coverage is partial.
 */
type BriefItem = { id: string; text: string; figure?: EngineFigure; chart?: { id: string; label: string; figure: EngineFigure }[];
  movement?: 'moved' | 'same' | 'not-enough'; coverage?: 'complete' | 'partial' };
export type WeekAhead = { id: string; period: Period; scheduledFor: string; builtAt: string; late: boolean; changed: BriefItem[]; decide: BriefItem[]; due: BriefItem[];
  inbox: { id: string; text: string; reviewDate: string }[]; missed: { id: string; what: string; at: string }[]; explanation: 'not-written'; receiptIds: string[];
  /** Words for what this brief cannot show the caller, such as figures withheld by a marking. */
  gaps: string[] };

export const defaultRhythm: RhythmSettings = { days: [1], time: '09:00', dailyClosing: false, financialYearStart: '04-01', missedRule: 'run-late',
  mail: { on: false, address: null }, whatsapp: { on: false, phone: null } };
/** The exact words sent: a fixed headline and a pointer back to the app, with no amounts, names, counts or digits. */
const ready: Words = { en: 'The week ahead is ready. Open Chausar to see it.', hi: 'आने वाले सप्ताह का सार तैयार है। देखने के लिए Chausar खोलें।' };
export const previews = (lang: Language = 'en') => ({ mail: ready[lang], whatsapp: ready[lang] });

export function rhythmSettings(state: State): RhythmSettings { return structuredClone({ ...defaultRhythm, ...(peekReports(state).rhythm ?? {}) }); }
export function rhythmView(state: State, host: ModuleHost, lang: Language = 'en') {
  const verified = peekReports(state).verified ?? {};
  return { ...rhythmSettings(state), mailVerified: verified.mail === true, whatsappVerified: verified.whatsapp === true, whatsappTemplate: 'not-approved' as const,
    previews: previews(lang), testMode: host.demo, relay: 'not-available' as const };
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
const changes: { op: string; text: Words }[] = [
  { op: 'net_sales', text: { en: 'Net sales', hi: 'शुद्ध बिक्री' } },
  { op: 'received', text: { en: 'Money received', hi: 'प्राप्त राशि' } },
  { op: 'billed', text: { en: 'Invoices raised', hi: 'जारी किए गए बिल' } },
];
const changedText = (text: Words, lastWeek: Period, weekBefore: Period, lang: Language) => lang === 'hi'
  ? `${text.hi}, ${lastWeek.from} से ${lastWeek.to} तक का सप्ताह, ${weekBefore.from} से ${weekBefore.to} तक के सप्ताह की तुलना में`
  : `${text.en}, the week ${lastWeek.from} to ${lastWeek.to} against the week ${weekBefore.from} to ${weekBefore.to}`;
const bars: Record<string, Words> = { 'week-before': { en: 'The week before', hi: 'उससे पहले का सप्ताह' }, 'last-week': { en: 'Last week', hi: 'पिछला सप्ताह' } };
/** The fixed sentences of "what needs a decision", by kind; a stored brief keeps the English one. */
const decideWords: Record<'prepared' | 'unknown' | 'job', Words> = {
  prepared: { en: 'A prepared action is waiting for your approval.', hi: 'एक तैयार काम आपकी मंज़ूरी का इंतज़ार कर रहा है।' },
  unknown: { en: 'An action has an unknown result. Check it before anything is retried.', hi: 'एक काम का नतीजा पता नहीं है। कुछ भी दोबारा करने से पहले इसे जाँचें।' },
  job: { en: 'A scheduled job is waiting for your approval.', hi: 'एक तय किया गया काम आपकी मंज़ूरी का इंतज़ार कर रहा है।' },
};
const someJob: Words = { en: 'A scheduled job', hi: 'एक तय किया गया काम' };
const dueText = (what: string, dueOn: string, lang: Language) => lang === 'hi' ? `${what}: देय ${dueOn}` : `${what}: due ${dueOn}`;
const partialWords = (text: Words, lang: Language) => lang === 'hi'
  ? `${text.hi}: कुछ रिकॉर्ड गिने नहीं जा सके, इसलिए यह आँकड़ा अधूरा है।` : `${text.en}: some records could not be counted, so this figure is partial.`;

/** Missed scheduled runs recorded by the job scheduler between the start of the previous week and now. */
function missedRuns(state: State, ctx: Context, since: string, until: string): WeekAhead['missed'] {
  const items: WeekAhead['missed'] = [];
  for (const job of Array.isArray(state.jobs) ? state.jobs : []) {
    if (!record(job) || (job.ownerId !== ctx.memberId && !['owner', 'cofounder'].includes(ctx.role))) continue;
    const what = typeof job.goal === 'string' ? job.goal : someJob.en;
    for (const entry of Array.isArray(job.ledger) ? job.ledger : []) if (record(entry) && entry.event === 'catchup-skipped' && typeof entry.at === 'string') items.push({ id: `${job.id}:${entry.at}`, what, at: entry.at });
    for (const entry of Array.isArray(job.calendar?.records) ? job.calendar.records : []) if (record(entry) && ['skipped', 'missed'].includes(entry.status)) {
      const at = typeof entry.instant === 'string' ? entry.instant : entry.at; if (typeof at === 'string') items.push({ id: `${job.id}:${entry.id ?? at}`, what, at });
    }
  }
  return items.filter(item => item.at >= since && item.at <= until).sort((a, b) => b.at.localeCompare(a.at));
}

/** Receipts are private to one member, so each member keeps one brief per week. */
const briefKey = (ctx: Context, week: Period) => `${ctx.memberId}:${week.from}`;
/** `hidden` is the marking kinds the member's seat did not see when the brief was built: the engine left that data out. */
type StoredBrief = { brief: WeekAhead; sourceIds: string[]; rowIds: string[]; memberId: string; itemSources?: Record<string, string[]>; receiptSources?: Record<string, string[]>; hidden?: string[] };
/** A stored brief stands only while the seat sees what it saw when the brief was built; otherwise it is built again in its place. */
const current = (state: State, ctx: Context, stored: StoredBrief) => (stored.hidden ?? []).join() === hiddenKinds(state, ctx).join();

/** Figures from data marked with a kind the caller's seat does not see are withheld, with a gap in words, each time the brief is read. */
function forCaller(state: State, ctx: Context, stored: StoredBrief, lang: Language): WeekAhead {
  const brief = inLanguage(structuredClone(stored.brief), lang); brief.gaps ??= [];
  const hidden = hiddenKinds(state, ctx); if (!hidden.length) return withCoverage(brief, lang);
  // The engine leaves data marked away from this seat out of its calculations, so a brief this seat built may show
  // such data as absent: when the workspace holds it, an absent figure is withheld and the brief says why.
  const hiddenHere = withheldKinds(state, [...new Set(state.facts.filter(fact => !fact.deletedAt).map(fact => fact.sourceId))], hidden);
  const absent = (figure?: EngineFigure) => figure?.kind === 'missing' && figure.missing === 'absent';
  const kinds = new Set<MarkKind>();
  const withheldReceipts = new Set(brief.receiptIds.filter(id => withheldKinds(state, stored.receiptSources?.[id] ?? stored.sourceIds, hidden).length));
  brief.changed = brief.changed.map(item => {
    const marked = withheldKinds(state, stored.itemSources?.[item.id] ?? stored.sourceIds, hidden);
    const found = marked.length ? marked : hiddenHere.length && (absent(item.figure) || item.chart?.some(bar => absent(bar.figure))) ? hiddenHere : [];
    if (!found.length) return item;
    for (const kind of found) kinds.add(kind);
    // Whether a withheld number moved, or how much of it was counted, is itself something the seat does not see.
    const { movement: _movement, coverage: _coverage, ...rest } = item;
    return { ...rest, ...(item.figure ? { figure: withheldFigure() } : {}), ...(item.chart ? { chart: item.chart.map(bar => ({ ...bar, figure: withheldFigure() })) } : {}) };
  });
  brief.receiptIds = brief.receiptIds.filter(id => !withheldReceipts.has(id));
  brief.gaps = [...new Set([...brief.gaps, ...markKinds.filter(kind => kinds.has(kind)).map(kind => withheldGap(kind, lang))])];
  return withCoverage(brief, lang);
}
/** A changed number whose receipt counted only part of the records says so in the brief's gaps. */
function withCoverage(brief: WeekAhead, lang: Language): WeekAhead {
  const partial = brief.changed.flatMap(item => { const change = changes.find(entry => entry.op === item.id); return item.coverage === 'partial' && change ? [partialWords(change.text, lang)] : []; });
  return { ...brief, gaps: [...new Set([...brief.gaps, ...partial])] };
}

/**
 * A stored brief keeps its English words; every engine-written word is written again in the language asked for, from the
 * item ids: a changed number by its calculation, a due date by its table row, a decision by its fixed sentence. Words a
 * person wrote (decisions in the inbox, job goals) stay as they were written.
 */
function inLanguage(brief: WeekAhead, lang: Language): WeekAhead {
  const lastWeek = { from: addDays(brief.period.from, -7), to: addDays(brief.period.to, -7) }, weekBefore = { from: addDays(brief.period.from, -14), to: addDays(brief.period.to, -14) };
  if (lang === 'en') return brief;
  const changed = brief.changed.map(item => {
    const change = changes.find(entry => entry.op === item.id);
    return { ...item, ...(change ? { text: changedText(change.text, lastWeek, weekBefore, lang) } : {}),
      ...(item.chart ? { chart: item.chart.map(bar => ({ ...bar, label: bars[bar.id]?.[lang] ?? bar.label })) } : {}) };
  });
  const decide = brief.decide.map(item => {
    const found = Object.values(decideWords).find(words => words.en === item.text);
    return found ? { ...item, text: found[lang] } : item;
  });
  const due = brief.due.map(item => {
    const [rowId, dueOn] = item.id.split(':'); const what = rowId && dueOn ? dueWhat(rowId, lang) : null;
    return what && dueOn ? { ...item, text: dueText(what, dueOn, lang) } : item;
  });
  const missed = brief.missed.map(item => item.what === someJob.en ? { ...item, what: someJob[lang] } : item);
  return { ...brief, changed, decide, due, missed };
}

/**
 * Returns the stored brief for the week, or builds and stores the first one. Briefs are kept for this week and last week only,
 * so a read cannot grow the store without bound. "What changed" compares the last completed week with the week before it.
 */
export async function weekAhead(ctx: Context, host: ModuleHost, onDate: string, lang: Language = 'en'): Promise<WeekAhead> {
  const week = isoWeek(onDate), key = briefKey(ctx, week);
  const s = host.services; const builtMs = clock(host); const builtAt = isoAt(builtMs), thisWeek = isoWeek(indiaDate(builtMs));
  check(week.from <= thisWeek.from, 'WEEK_NOT_STARTED', 'A brief can be built once its week has started.');
  check(week.from >= addDays(thisWeek.from, -7), 'WEEK_TOO_OLD', 'Briefs are kept for this week and last week.');
  const existing: StoredBrief | undefined = peekReports(host.store.read()).briefs?.[key];
  if (existing && current(host.store.read(), ctx, existing)) return forCaller(host.store.read(), ctx, existing, lang);
  const state = host.store.read(); const rhythm = rhythmSettings(state); const scheduled = scheduledFor(rhythm, week);
  const lastWeek = { from: addDays(week.from, -7), to: addDays(week.to, -7) }, weekBefore = { from: addDays(week.from, -14), to: addDays(week.to, -14) };
  const receipts: CalculationReceipt[] = []; const changed: BriefItem[] = []; const itemSources: Record<string, string[]> = {}, receiptSources: Record<string, string[]> = {};
  let catalog: Set<string>;
  try { catalog = new Set((s.calculator.catalog(ctx) as { id: string }[]).map(op => op.id)); } catch { catalog = new Set(); }
  for (const change of changes.filter(item => catalog.has(item.op))) {
    try {
      const before: CalculationReceipt = await s.calculator.calculate(ctx, { operation: change.op, period: weekBefore });
      const after: CalculationReceipt = await s.calculator.calculate(ctx, { operation: change.op, period: lastWeek });
      receipts.push(before, after);
      itemSources[change.op] = [...new Set([...before.sourceIds, ...after.sourceIds])];
      receiptSources[before.id] = [...before.sourceIds]; receiptSources[after.id] = [...after.sourceIds];
      // Comparing the two exact strings decides only whether to say "no change"; nothing is subtracted here.
      const movement = before.coverage.completeness === 'empty' ? 'not-enough' : after.coverage.completeness !== 'empty' && before.totalMinor === after.totalMinor ? 'same' : 'moved';
      const coverage = [before, after].some(receipt => receipt.coverage.completeness === 'partial') ? 'partial' : 'complete';
      changed.push({ id: change.op, text: changedText(change.text, lastWeek, weekBefore, 'en'), figure: figure(after),
        chart: [{ id: 'week-before', label: bars['week-before']!.en, figure: figure(before) }, { id: 'last-week', label: bars['last-week']!.en, figure: figure(after) }], movement, coverage });
    } catch (error) { if ((error as { code?: string }).code === 'ACCESS_REVOKED') throw error; }
  }
  const decide: BriefItem[] = [
    ...state.actions.filter(action => record(action) && action.status === 'prepared').map(action => ({ id: String(action.id), text: decideWords.prepared.en })),
    ...state.actions.filter(action => record(action) && action.status === 'unknown').map(action => ({ id: String(action.id), text: decideWords.unknown.en })),
    ...state.jobs.filter(job => record(job) && job.status === 'approval-blocked' && job.ownerId === ctx.memberId).map(job => ({ id: String(job.id), text: decideWords.job.en })),
  ];
  const profile: DueProfile | null = peekReports(state).dueProfile ?? null;
  const due = dueDates({ from: onDate, days: 14, profile }).rows.map(row => ({ id: row.id, text: dueText(row.what, row.dueOn, 'en') }));
  const inbox = (s.reports.dueDecisions(ctx, { dueOn: week.to }) as { id: string; text: string; reviewDate: string }[]).map(item => ({ id: item.id, text: item.text, reviewDate: item.reviewDate }));
  const missed = missedRuns(state, ctx, `${lastWeek.from}T00:00:00.000Z`, builtAt);
  const brief: WeekAhead = { id: newId('brief'), period: week, scheduledFor: scheduled, builtAt, late: builtMs - Date.parse(scheduled) > 3_600_000,
    changed, decide, due, inbox, missed, explanation: 'not-written', receiptIds: receipts.map(receipt => receipt.id), gaps: [] };
  const sourceIds = [...new Set(receipts.flatMap(receipt => receipt.sourceIds))], rowIds = [...new Set(receipts.flatMap(receipt => receipt.rowIds))];
  const stored = await host.store.update(next => {
    const briefs = (reportsState(next).briefs ??= {});
    const held = briefs[key] as StoredBrief | undefined;
    if (!held || !current(next, ctx, held)) briefs[key] = { brief: structuredClone(brief), sourceIds, rowIds, memberId: ctx.memberId, itemSources, receiptSources, hidden: hiddenKinds(next, ctx) };
    return structuredClone(briefs[key]) as StoredBrief;
  });
  return forCaller(host.store.read(), ctx, stored, lang);
}

/** What a proposed lesson would change, in words, by the kind of change. */
const changeWords: Record<string, Words> = {
  'personal-preference': { en: 'A preference of yours', hi: 'आपकी एक पसंद' },
  'reminder-timing': { en: 'When a reminder is sent', hi: 'याद दिलाने का समय' },
  'shortlist-order': { en: 'The order of a short list', hi: 'एक छोटी सूची का क्रम' },
  unknown: { en: 'Not known', hi: 'पता नहीं' },
};
export async function friday(ctx: Context, host: ModuleHost, onDate: string, lang: Language = 'en') {
  const week = isoWeek(onDate);
  const decisions = (host.services.reports.dueDecisions(ctx, { dueOn: week.to }) as any[]).map(item => {
    const review = Array.isArray(item.reviews) ? item.reviews.at(-1) : undefined;
    const observed = record(review) ? typeof review.notes === 'string' && review.notes.trim() ? review.notes : typeof review.observation?.summary === 'string' ? review.observation.summary : null : null;
    return { id: String(item.id), text: String(item.text ?? item.title ?? ''), reviewDate: String(item.reviewDate), observed, receiptIds: Array.isArray(item.receiptIds) ? [...item.receiptIds] : [] };
  });
  let lessons: { available: boolean; items: { id: string; title: string; evidence: number; change: string; changeText: string }[] } = { available: false, items: [] };
  try {
    const reply = await host.call('memory.lessons', {});
    const views = Array.isArray(reply) ? reply : [];
    lessons = { available: true, items: views.filter(view => record(view?.candidate)).slice(0, 5).map(view => ({ id: String(view.candidate.id), title: String(view.candidate.title),
      evidence: Array.isArray(view.candidate.evidence) ? view.candidate.evidence.length : 0, change: String(view.candidate.change?.kind ?? 'unknown') }))
      .map(item => ({ ...item, changeText: (changeWords[item.change] ?? changeWords.unknown!)[lang] })) };
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
