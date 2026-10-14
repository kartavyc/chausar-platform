/**
 * Reply checks for the Trust screens, one per `trustx.*` reply in section 1.2 of
 * docs/lanes/reports-tools-trust.md, plus the three core replies the screens read
 * (`sources.list`, `trust.get`, `sync.status`). Every reply is untrusted data.
 */
import { ShapeError, bool, int, list, oneOf, optStr, rec, str, strings, digits } from './kit/validate.ts';
import type { Rec } from './kit/validate.ts';

const ID = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function day(value: unknown, path: string): string {
  const s = str(value, path, 10);
  if (!DATE.test(s)) throw new ShapeError(path);
  return s;
}
function instant(value: unknown, path: string): string {
  const s = str(value, path, 40);
  if (!INSTANT.test(s)) throw new ShapeError(path);
  return s;
}
function optInstant(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : instant(value, path);
}
function optDay(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : day(value, path);
}
function id(value: unknown, path: string): string {
  const s = str(value, path, ID);
  if (s.length === 0) throw new ShapeError(path);
  return s;
}
function count(value: unknown, path: string): number {
  const n = int(value, path);
  if (n < 0) throw new ShapeError(path);
  return n;
}
function optCount(value: unknown, path: string): number | null {
  return value === null || value === undefined ? null : count(value, path);
}
function paise(value: unknown, path: string): string { return digits(value, path, false); }
function optPaise(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : paise(value, path);
}

export const SEND_LEVELS = ['nothing', 'shape', 'samples'] as const;
export type SendLevel = (typeof SEND_LEVELS)[number];
export const MARK_KINDS = ['personal', 'financial', 'confidential'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export const PRESETS = ['ask-everything', 'routine', 'all-but-waits', 'custom'] as const;
export type Preset = (typeof PRESETS)[number];
export const SEATS = ['owner', 'cofounder', 'accountant', 'ca', 'staff', 'viewer', 'assistant'] as const;
export type Seat = (typeof SEATS)[number];
export const NET_KINDS = ['model', 'connector', 'action', 'sharing', 'phone', 'sync', 'plugin'] as const;
export type NetKind = (typeof NET_KINDS)[number];
const CHANGE_WHAT = ['send', 'sharing', 'seats'] as const;
export type ChangeWhat = (typeof CHANGE_WHAT)[number];

// ---------- Rules (TR-01) ----------
export interface LeftItem { destination: string; kind: string; count: number; bytes: number | null; stopped: boolean }
export interface Rules {
  see: { allSources: boolean; allowed: number; refused: number };
  send: { level: SendLevel; localOnly: boolean };
  keep: { days: number | null };
  do: { preset: Preset };
  leftToday: { date: string; items: LeftItem[] };
  canChange: boolean;
  ownerOnly: ChangeWhat[];
}
export function validateRules(reply: unknown): Rules {
  const r = rec(reply);
  const see = rec(r['see'], 'reply.see'), send = rec(r['send'], 'reply.send'), keep = rec(r['keep'], 'reply.keep');
  const left = rec(r['leftToday'], 'reply.leftToday');
  return {
    see: { allSources: bool(see['allSources'], 'reply.see.allSources'), allowed: count(see['allowed'], 'reply.see.allowed'), refused: count(see['refused'], 'reply.see.refused') },
    send: { level: oneOf(send['level'], 'reply.send.level', SEND_LEVELS), localOnly: bool(send['localOnly'], 'reply.send.localOnly') },
    keep: { days: optCount(keep['days'], 'reply.keep.days') },
    do: { preset: oneOf(rec(r['do'], 'reply.do')['preset'], 'reply.do.preset', PRESETS) },
    leftToday: {
      date: day(left['date'], 'reply.leftToday.date'),
      items: list(left['items'], 'reply.leftToday.items', (v, p) => {
        const i = rec(v, p);
        const stopped = i['stopped'];
        return {
          destination: id(i['destination'], `${p}.destination`), kind: str(i['kind'], `${p}.kind`, ID),
          count: count(i['count'], `${p}.count`), bytes: optCount(i['bytes'], `${p}.bytes`),
          // A stopped flag, or a count of stopped calls.
          stopped: typeof stopped === 'number' ? count(stopped, `${p}.stopped`) > 0 : bool(stopped, `${p}.stopped`),
        };
      }, 50),
    },
    canChange: bool(r['canChange'], 'reply.canChange'),
    ownerOnly: list(r['ownerOnly'], 'reply.ownerOnly', (v, p) => oneOf(v, p, CHANGE_WHAT), 3),
  };
}

// ---------- Markings (TR-02) ----------
export interface MarkTarget { type: 'source' | 'record' | 'field'; sourceId: string; recordId?: string; field?: string }
export interface Mark { id: string; kind: MarkKind; target: MarkTarget; auto: boolean; by: string; at: string }
export interface SeatSees { seat: string; sees: Record<MarkKind, boolean> }
export interface Where { place: 'books'; sub: string }
export interface Markings { marks: Mark[]; seats: SeatSees[]; where: Record<'source' | 'record' | 'field', Where> }
function where(value: unknown, path: string): Where {
  const s = str(value, path, 100);
  const m = /^books\/([a-z][a-z0-9-]{0,63})$/.exec(s);
  if (!m || m[1] === undefined) throw new ShapeError(path);
  return { place: 'books', sub: m[1] };
}
export function validateMarkings(reply: unknown): Markings {
  const r = rec(reply);
  list(r['kinds'], 'reply.kinds', (v, p) => oneOf(v, p, MARK_KINDS), 3);
  const w = rec(r['where'], 'reply.where');
  return {
    marks: list(r['marks'], 'reply.marks', (v, p) => {
      const m = rec(v, p), t = rec(m['target'], `${p}.target`);
      const target: MarkTarget = { type: oneOf(t['type'], `${p}.target.type`, ['source', 'record', 'field'] as const), sourceId: id(t['sourceId'], `${p}.target.sourceId`) };
      const recordId = optStr(t['recordId'], `${p}.target.recordId`, ID), field = optStr(t['field'], `${p}.target.field`, ID);
      if (recordId !== null) target.recordId = recordId;
      if (field !== null) target.field = field;
      return { id: id(m['id'], `${p}.id`), kind: oneOf(m['kind'], `${p}.kind`, MARK_KINDS), target, auto: bool(m['auto'], `${p}.auto`), by: str(m['by'], `${p}.by`, ID), at: instant(m['at'], `${p}.at`) };
    }, 2000),
    seats: list(r['seats'], 'reply.seats', (v, p) => {
      const s = rec(v, p), sees = rec(s['sees'], `${p}.sees`);
      return { seat: id(s['seat'], `${p}.seat`), sees: { personal: bool(sees['personal'], `${p}.sees.personal`), financial: bool(sees['financial'], `${p}.sees.financial`), confidential: bool(sees['confidential'], `${p}.sees.confidential`) } };
    }, 20),
    where: { source: where(w['source'], 'reply.where.source'), record: where(w['record'], 'reply.where.record'), field: where(w['field'], 'reply.where.field') },
  };
}

// ---------- Send (TR-03) and dual control ----------
export interface PendingChange { id: string; what: ChangeWhat; summary: string; by: string; at: string; needs: 'owner' | 'cofounder' }
function pending(value: unknown, path: string): PendingChange {
  const c = rec(value, path);
  return { id: id(c['id'], `${path}.id`), what: oneOf(c['what'], `${path}.what`, CHANGE_WHAT), summary: str(c['summary'], `${path}.summary`, 500),
    by: str(c['by'], `${path}.by`, ID), at: instant(c['at'], `${path}.at`), needs: oneOf(c['needs'], `${path}.needs`, ['owner', 'cofounder'] as const) };
}
export interface ChangeResult { state: 'applied' | 'waiting-for-second'; change: PendingChange | null }
function changeOf(r: Rec): ChangeResult {
  const state = oneOf(r['state'], 'reply.state', ['applied', 'waiting-for-second'] as const);
  const change = r['change'] === undefined || r['change'] === null ? null : pending(r['change'], 'reply.change');
  return { state, change };
}
export function validateChange(reply: unknown): ChangeResult { return changeOf(rec(reply)); }
export function validatePending(reply: unknown): PendingChange[] {
  return list(rec(reply)['items'], 'reply.items', pending, 200);
}
export interface SendLevelRow { id: SendLevel; headings: string[]; rows: string[][]; memory: string; question: string }
export interface SendLevels { current: SendLevel; localOnly: boolean; financialRoutes: string[]; synthetic: boolean; levels: SendLevelRow[]; voice: { on: false; note: string } }
export function validateSendLevels(reply: unknown): SendLevels {
  const r = rec(reply), voice = rec(r['voice'], 'reply.voice');
  if (voice['on'] !== false) throw new ShapeError('reply.voice.on');
  return {
    current: oneOf(r['current'], 'reply.current', SEND_LEVELS), localOnly: bool(r['localOnly'], 'reply.localOnly'),
    financialRoutes: strings(r['financialRoutes'], 'reply.financialRoutes', 50), synthetic: bool(r['synthetic'], 'reply.synthetic'),
    levels: list(r['levels'], 'reply.levels', (v, p) => {
      const l = rec(v, p);
      return { id: oneOf(l['id'], `${p}.id`, SEND_LEVELS), headings: strings(l['headings'], `${p}.headings`, 12),
        rows: list(l['rows'], `${p}.rows`, (row, rp) => strings(row, rp, 12), 6), memory: str(l['memory'], `${p}.memory`, 500), question: str(l['question'], `${p}.question`, 500) };
    }, 3),
    voice: { on: false, note: str(voice['note'], 'reply.voice.note', 500) },
  };
}

// ---------- Keep (TR-04) ----------
export interface Keep { kinds: { kind: string; days: number | null; note: string }[]; inventory: { path: string; bytes: number | null; what: string }[] }
export function validateKeep(reply: unknown): Keep {
  const r = rec(reply);
  return {
    kinds: list(r['kinds'], 'reply.kinds', (v, p) => { const k = rec(v, p); return { kind: id(k['kind'], `${p}.kind`), days: optCount(k['days'], `${p}.days`), note: str(k['note'], `${p}.note`, 500) }; }, 100),
    inventory: list(r['inventory'], 'reply.inventory', (v, p) => { const i = rec(v, p); return { path: id(i['path'], `${p}.path`), bytes: optCount(i['bytes'], `${p}.bytes`), what: str(i['what'], `${p}.what`, 500) }; }, 500),
  };
}

// ---------- Do (TR-05) ----------
export interface KindRule { kind: string; on: boolean; maxPerDay: number; maxAmountMinorPerDay: string | null }
export interface Caps { remindersPerCustomerPerDay: number; remindersPerDay: number; activeJobs: number; monthlyAiCapMinor: string | null }
export interface Autonomy { preset: Preset; kinds: (KindRule & { agreement: { agreed: number; total: number } | null })[]; alwaysWaits: { id: string; words: string }[]; caps: Caps }
export function validateAutonomy(reply: unknown): Autonomy {
  const r = rec(reply), c = rec(r['caps'], 'reply.caps');
  return {
    preset: oneOf(r['preset'], 'reply.preset', PRESETS),
    kinds: list(r['kinds'], 'reply.kinds', (v, p) => {
      const k = rec(v, p);
      const a = k['agreement'] === null || k['agreement'] === undefined ? null : rec(k['agreement'], `${p}.agreement`);
      const agreement = a === null ? null : { agreed: count(a['agreed'], `${p}.agreement.agreed`), total: count(a['total'], `${p}.agreement.total`) };
      if (agreement !== null && agreement.agreed > agreement.total) throw new ShapeError(`${p}.agreement`);
      return { kind: id(k['kind'], `${p}.kind`), on: bool(k['on'], `${p}.on`), maxPerDay: count(k['maxPerDay'], `${p}.maxPerDay`), maxAmountMinorPerDay: optPaise(k['maxAmountMinorPerDay'], `${p}.maxAmountMinorPerDay`), agreement };
    }, 100),
    alwaysWaits: list(r['alwaysWaits'], 'reply.alwaysWaits', (v, p) => { const w = rec(v, p); return { id: id(w['id'], `${p}.id`), words: str(w['words'], `${p}.words`, 500) }; }, 50),
    caps: { remindersPerCustomerPerDay: count(c['remindersPerCustomerPerDay'], 'reply.caps.remindersPerCustomerPerDay'), remindersPerDay: count(c['remindersPerDay'], 'reply.caps.remindersPerDay'),
      activeJobs: count(c['activeJobs'], 'reply.caps.activeJobs'), monthlyAiCapMinor: optPaise(c['monthlyAiCapMinor'], 'reply.caps.monthlyAiCapMinor') },
  };
}

// ---------- People (TR-06) ----------
export interface SeatRow { memberId: string; name: string; seat: Seat; limits: string[]; endsOn: string | null; ended: boolean; removedOn: string | null; active: boolean; you: boolean }
export interface Seats { seats: SeatRow[]; templates: { seat: Seat; limits: string[] }[] }
export function validateSeats(reply: unknown): Seats {
  const r = rec(reply);
  return {
    seats: list(r['seats'], 'reply.seats', (v, p) => {
      const s = rec(v, p);
      return { memberId: id(s['memberId'], `${p}.memberId`), name: str(s['name'], `${p}.name`, 200), seat: oneOf(s['seat'], `${p}.seat`, SEATS), limits: strings(s['limits'], `${p}.limits`, 12),
        endsOn: optDay(s['endsOn'], `${p}.endsOn`), ended: bool(s['ended'], `${p}.ended`), removedOn: optDay(s['removedOn'], `${p}.removedOn`), active: bool(s['active'], `${p}.active`), you: bool(s['you'], `${p}.you`) };
    }, 500),
    templates: list(r['templates'], 'reply.templates', (v, p) => { const t = rec(v, p); return { seat: oneOf(t['seat'], `${p}.seat`, SEATS), limits: strings(t['limits'], `${p}.limits`, 12) }; }, 10),
  };
}
export interface InviteResult extends ChangeResult { invite: { id: string; token: string; expiresAt: string } | null; guide: { html: string } | null }
export function validateInvite(reply: unknown): InviteResult {
  const r = rec(reply);
  const i = r['invite'] === undefined || r['invite'] === null ? null : rec(r['invite'], 'reply.invite');
  const g = r['guide'] === undefined || r['guide'] === null ? null : rec(r['guide'], 'reply.guide');
  return { ...changeOf(r),
    invite: i === null ? null : { id: id(i['id'], 'reply.invite.id'), token: id(i['token'], 'reply.invite.token'), expiresAt: instant(i['expiresAt'], 'reply.invite.expiresAt') },
    guide: g === null ? null : { html: str(g['html'], 'reply.guide.html', 200000) } };
}

// ---------- Machines and the pen (TR-07, core sync.status) ----------
export interface SyncStatus { enabled: boolean; mode: string; writer: boolean | null; experimental: boolean }
export function validateSync(reply: unknown): SyncStatus {
  const r = rec(reply);
  const w = r['writerAdmission'] === undefined || r['writerAdmission'] === null ? null : rec(r['writerAdmission'], 'reply.writerAdmission');
  return { enabled: bool(r['enabled'], 'reply.enabled'), mode: str(r['mode'], 'reply.mode', 60), writer: w === null ? null : !bool(w['readonly'], 'reply.writerAdmission.readonly'),
    experimental: r['experimental'] === undefined ? false : bool(r['experimental'], 'reply.experimental') };
}

// ---------- Models (TR-08) ----------
export interface Terms { keeps: string; keepsFor: string; trains: boolean; country: string; termsUrl: string; readOn: string }
export interface Route { id: string; kind: string; label: string; health: string; order: number; terms: Terms | null; lastAnswerCostMinor: string | null }
export interface Models { routes: Route[]; spendThisMonthMinor: string; monthlyCapMinor: string | null; voice: { provider: string | null; minutesThisMonth: number } }
function url(value: unknown, path: string): string {
  const s = str(value, path, 2000);
  if (!/^https:\/\/[^\s]+$/.test(s)) throw new ShapeError(path);
  return s;
}
export function validateModels(reply: unknown): Models {
  const r = rec(reply), voice = rec(r['voice'], 'reply.voice');
  const routes = list(r['routes'], 'reply.routes', (v, p) => {
    const x = rec(v, p);
    const t = x['terms'] === null || x['terms'] === undefined ? null : rec(x['terms'], `${p}.terms`);
    return { id: id(x['id'], `${p}.id`), kind: str(x['kind'], `${p}.kind`, 60), label: str(x['label'], `${p}.label`, 200), health: str(x['health'], `${p}.health`, 60), order: count(x['order'], `${p}.order`),
      terms: t === null ? null : { keeps: str(t['keeps'], `${p}.terms.keeps`, 500), keepsFor: str(t['keepsFor'], `${p}.terms.keepsFor`, 200), trains: bool(t['trains'], `${p}.terms.trains`),
        country: str(t['country'], `${p}.terms.country`, 100), termsUrl: url(t['termsUrl'], `${p}.terms.termsUrl`), readOn: day(t['readOn'], `${p}.terms.readOn`) },
      lastAnswerCostMinor: optPaise(x['lastAnswerCostMinor'], `${p}.lastAnswerCostMinor`) };
  }, 50);
  return { routes: [...routes].sort((a, b) => a.order - b.order), spendThisMonthMinor: paise(r['spendThisMonthMinor'], 'reply.spendThisMonthMinor'),
    monthlyCapMinor: optPaise(r['monthlyCapMinor'], 'reply.monthlyCapMinor'),
    voice: { provider: optStr(voice['provider'], 'reply.voice.provider', 200), minutesThisMonth: count(voice['minutesThisMonth'], 'reply.voice.minutesThisMonth') } };
}

// ---------- Network (TR-09) ----------
export interface CanaryAlert { at: string; callId: string }
export interface NetItem { id: string; at: string; kind: NetKind; destination: string; why: string; bytes: number | null; outcome: 'allowed' | 'stopped' | 'waiting'; pluginId: string | null; waitingContent: string | null }
export interface Network { items: NetItem[]; canary: { planted: boolean; alert: CanaryAlert | null } }
function alert(value: unknown, path: string): CanaryAlert | null {
  if (value === null || value === undefined) return null;
  const a = rec(value, path);
  return { at: instant(a['at'], `${path}.at`), callId: id(a['callId'], `${path}.callId`) };
}
export function validateNetwork(reply: unknown): Network {
  const r = rec(reply), c = rec(r['canary'], 'reply.canary');
  return {
    items: list(r['items'], 'reply.items', (v, p) => {
      const i = rec(v, p);
      return { id: id(i['id'], `${p}.id`), at: instant(i['at'], `${p}.at`), kind: oneOf(i['kind'], `${p}.kind`, NET_KINDS), destination: str(i['destination'], `${p}.destination`, 300),
        why: str(i['why'], `${p}.why`, 500), bytes: optCount(i['bytes'], `${p}.bytes`), outcome: oneOf(i['outcome'], `${p}.outcome`, ['allowed', 'stopped', 'waiting'] as const),
        pluginId: optStr(i['pluginId'], `${p}.pluginId`, ID), waitingContent: optStr(i['waitingContent'], `${p}.waitingContent`, 200000) };
    }, 2000),
    canary: { planted: bool(c['planted'], 'reply.canary.planted'), alert: alert(c['alert'], 'reply.canary.alert') },
  };
}
export function validatePlanted(reply: unknown): { at: string } {
  const r = rec(reply);
  if (r['planted'] !== true) throw new ShapeError('reply.planted');
  return { at: instant(r['at'], 'reply.at') };
}

// ---------- Record (TR-10) ----------
export interface RecordItem { seq: number; at: string; who: string; what: string; rule: string; computer: string }
export interface RecordView { items: RecordItem[]; head: { hash: string; short: string; at: string | null; count: number }; limit: number | null }
export function validateRecord(reply: unknown): RecordView {
  const r = rec(reply), h = rec(r['head'], 'reply.head');
  const limit = r['limit'];
  return {
    items: list(r['items'], 'reply.items', (v, p) => {
      const i = rec(v, p);
      return { seq: count(i['seq'], `${p}.seq`), at: instant(i['at'], `${p}.at`), who: str(i['who'], `${p}.who`, 200), what: str(i['what'], `${p}.what`, 500), rule: str(i['rule'], `${p}.rule`, 500), computer: str(i['computer'], `${p}.computer`, 200) };
    }, 5000),
    head: { hash: str(h['hash'], 'reply.head.hash', 200), short: str(h['short'], 'reply.head.short', 40), at: optInstant(h['at'], 'reply.head.at'), count: count(h['count'], 'reply.head.count') },
    // The cut-off for the list, or the engine's own sentence about the limit (the screen keeps its own words).
    limit: typeof limit === 'number' ? count(limit, 'reply.limit') : (str(limit, 'reply.limit', 1000), null),
  };
}
export interface Verified { verified: boolean; brokenAt: number | null; head: string }
export function validateVerify(reply: unknown): Verified {
  const r = rec(reply);
  const head = r['head'];
  const headText = typeof head === 'string' ? str(head, 'reply.head', 200) : str(rec(head, 'reply.head')['short'], 'reply.head.short', 40);
  const verified = bool(r['verified'], 'reply.verified'), brokenAt = optCount(r['brokenAt'], 'reply.brokenAt');
  if (verified === (brokenAt !== null)) throw new ShapeError('reply.brokenAt');
  return { verified, brokenAt, head: headText };
}

// ---------- Sharing (TR-11), hosted (TR-14), agreements (TR-15) ----------
export interface Sharing { on: boolean; intakeOpen: false; preview: { digest: string; bytes: number; events: number } | null; batches: { id: string; at: string; bytes: number; events: number }[]; totals: { events: number }; withdrawnAt: string | null }
export function validateSharing(reply: unknown): Sharing {
  const r = rec(reply), intake = rec(r['intake'], 'reply.intake'), totals = rec(r['totals'], 'reply.totals');
  if (intake['open'] !== false) throw new ShapeError('reply.intake.open');
  str(intake['words'], 'reply.intake.words', 500);
  if (totals['names'] !== 0 || totals['amounts'] !== 0) throw new ShapeError('reply.totals');
  const pv = r['preview'] === null || r['preview'] === undefined ? null : rec(r['preview'], 'reply.preview');
  return {
    on: bool(r['on'], 'reply.on'), intakeOpen: false,
    preview: pv === null ? null : { digest: str(pv['digest'], 'reply.preview.digest', 200), bytes: count(pv['bytes'], 'reply.preview.bytes'), events: count(pv['events'], 'reply.preview.events') },
    batches: list(r['batches'], 'reply.batches', (v, p) => { const b = rec(v, p); return { id: id(b['id'], `${p}.id`), at: instant(b['at'], `${p}.at`), bytes: count(b['bytes'], `${p}.bytes`), events: count(b['events'], `${p}.events`) }; }, 1000),
    totals: { events: count(totals['events'], 'reply.totals.events') },
    withdrawnAt: optInstant(r['withdrawnAt'], 'reply.withdrawnAt'),
  };
}
export interface Cleaned { cleaned: string; hits: { line: number; kind: string }[] }
export function validateCleaned(reply: unknown): Cleaned {
  const r = rec(reply);
  if (r['uploaded'] !== false) throw new ShapeError('reply.uploaded');
  return { cleaned: str(r['cleaned'], 'reply.cleaned', 400000), hits: list(r['hits'], 'reply.hits', (v, p) => { const h = rec(v, p); return { line: count(h['line'], `${p}.line`), kind: str(h['kind'], `${p}.kind`, 60) }; }, 5000) };
}
export interface Hosted { blind: string; notBlind: string; jobs: { id: string; name: string }[]; keeps: string }
export function validateHosted(reply: unknown): Hosted {
  const r = rec(reply);
  if (r['plan'] !== 'planned-not-available') throw new ShapeError('reply.plan');
  return { blind: str(r['blind'], 'reply.blind', 1000), notBlind: str(r['notBlind'], 'reply.notBlind', 1000), keeps: str(r['keeps'], 'reply.keeps', 1000),
    jobs: list(r['jobs'], 'reply.jobs', (v, p) => { const j = rec(v, p); if (j['on'] !== false) throw new ShapeError(`${p}.on`); return { id: id(j['id'], `${p}.id`), name: str(j['name'], `${p}.name`, 200) }; }, 50) };
}
export interface Agreements { notice: { version: string; en: string; hi: string }; items: { id: string; person: string; purpose: string; at: string; withdrawnAt: string | null }[] }
export function validateAgreements(reply: unknown): Agreements {
  const r = rec(reply), n = rec(r['notice'], 'reply.notice');
  return {
    notice: { version: str(n['version'], 'reply.notice.version', 60), en: str(n['en'], 'reply.notice.en', 100000), hi: str(n['hi'], 'reply.notice.hi', 100000) },
    items: list(r['items'], 'reply.items', (v, p) => { const a = rec(v, p); return { id: id(a['id'], `${p}.id`), person: str(a['person'], `${p}.person`, 200), purpose: str(a['purpose'], `${p}.purpose`, 500), at: instant(a['at'], `${p}.at`), withdrawnAt: optInstant(a['withdrawnAt'], `${p}.withdrawnAt`) }; }, 500),
  };
}

// ---------- Vault (TR-12) and deletion (TR-13) ----------
export interface Backup { file: string; at: string; bytes: number | null; testRestore: 'passed' | 'failed' | 'not-tested'; testedAt: string | null }
export interface VaultView { backups: Backup[]; lock: { idleMinutes: number; deviceCheck: boolean }; disk: { freeBytes: number; totalBytes: number } | null; limit: string; recoveryContact: string | null; version: string }
export function validateBackup(value: unknown, path = 'reply'): Backup {
  const b = rec(value, path);
  return { file: id(b['file'], `${path}.file`), at: instant(b['at'], `${path}.at`), bytes: optCount(b['bytes'], `${path}.bytes`),
    testRestore: oneOf(b['testRestore'], `${path}.testRestore`, ['passed', 'failed', 'not-tested'] as const), testedAt: optInstant(b['testedAt'], `${path}.testedAt`) };
}
export function validateVault(reply: unknown): VaultView {
  const r = rec(reply), lock = rec(r['lock'], 'reply.lock'), rc = rec(r['recoveryContact'], 'reply.recoveryContact');
  if (rc['experimental'] !== true) throw new ShapeError('reply.recoveryContact.experimental');
  const d = r['disk'] === null || r['disk'] === undefined ? null : rec(r['disk'], 'reply.disk');
  return {
    backups: list(r['backups'], 'reply.backups', (v, p) => validateBackup(v, p), 500),
    lock: { idleMinutes: count(lock['idleMinutes'], 'reply.lock.idleMinutes'), deviceCheck: bool(lock['deviceCheck'], 'reply.lock.deviceCheck') },
    disk: d === null ? null : { freeBytes: count(d['freeBytes'], 'reply.disk.freeBytes'), totalBytes: count(d['totalBytes'], 'reply.disk.totalBytes') },
    limit: str(r['limit'], 'reply.limit', 1000), recoveryContact: optStr(rc['name'], 'reply.recoveryContact.name', 200), version: str(r['version'], 'reply.version', 60),
  };
}
export const DELETION_STATES = ['deleted', 'pending', 'not-possible', 'not-built'] as const;
export interface DeletionReport { id: string; at: string; sourceId: string; rows: { place: string; state: (typeof DELETION_STATES)[number]; reason: string }[] }
export function validateDeletion(value: unknown, path = 'reply'): DeletionReport {
  const d = rec(value, path);
  return { id: id(d['id'], `${path}.id`), at: instant(d['at'], `${path}.at`), sourceId: id(d['sourceId'], `${path}.sourceId`),
    rows: list(d['rows'], `${path}.rows`, (v, p) => { const x = rec(v, p); return { place: str(x['place'], `${p}.place`, 300), state: oneOf(x['state'], `${p}.state`, DELETION_STATES), reason: str(x['reason'], `${p}.reason`, 1000) }; }, 200) };
}
export function validateDeletions(reply: unknown): DeletionReport[] {
  return list(rec(reply)['items'], 'reply.items', (v, p) => validateDeletion(v, p), 500);
}
export interface FileRef { name: string; path: string; bytes: number | null; sha256: string }
export function validateFile(reply: unknown): FileRef {
  const r = rec(reply);
  return { name: id(r['name'], 'reply.name'), path: id(r['path'], 'reply.path'), bytes: optCount(r['bytes'], 'reply.bytes'), sha256: str(r['sha256'], 'reply.sha256', 128) };
}

// ---------- Core replies ----------
export interface Source { sourceId: string; name: string }
/** `sources.list`: the sources this person can see, one row per source id. */
export function validateSources(reply: unknown): Source[] {
  const seen = new Map<string, Source>();
  list(reply, 'reply', (v, p) => {
    const s = rec(v, p), sourceId = id(s['sourceId'], `${p}.sourceId`);
    const name = optStr(s['name'] ?? s['fileName'] ?? s['title'], `${p}.name`, 300);
    if (!seen.has(sourceId)) seen.set(sourceId, { sourceId, name: name ?? sourceId });
    return null;
  }, 5000);
  return [...seen.values()];
}
/** `trust.get`: only the source grant list is read here. */
export function validatePolicy(reply: unknown): { allowedSources: string[] } {
  return { allowedSources: strings(rec(reply)['allowedSources'], 'reply.allowedSources', 5000) };
}
export function validateAny(reply: unknown): unknown { return reply; }
