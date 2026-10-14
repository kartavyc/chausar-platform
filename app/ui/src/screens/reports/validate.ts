/**
 * Reply checks for the Reports screens, built from the shared kit. Each function reads one
 * `reportsx.*` reply exactly as section 1.1 of docs/lanes/reports-tools-trust.md gives it
 * and throws `ShapeError` (the failed state, code INVALID_REPLY) on anything else.
 */
import type { FigureOrMissing } from '../../app/presentation.ts';
import { figure } from '../trust/kit/figure.ts';
import { ShapeError, bool, int, list, oneOf, optStr, rec, str, strings } from '../trust/kit/validate.ts';

export type PageState = 'ready-tested' | 'ready-untested' | 'not-started';
export type GstMode = 'regular' | 'composition' | 'none';
export type PackId = 'lender' | 'ca' | 'investor';
export type Marking = 'personal' | 'financial' | 'confidential';
export const PACK_IDS: readonly PackId[] = ['lender', 'ca', 'investor'];
export const GST_MODES: readonly GstMode[] = ['regular', 'composition', 'none'];
const PAGE_STATES: readonly PageState[] = ['ready-tested', 'ready-untested', 'not-started'];

export interface Pack { id: PackId; title: string; gstModes: GstMode[]; pages: { id: string; title: string; state: PageState; reason: string | null }[] }
export interface Packs { packs: Pack[]; checkedAt: string }
export interface PageLine { id: string; label: string; figure: FigureOrMissing; side: 'Dr' | 'Cr' | null }
export interface PageSection { id: string; title: string; projection: boolean; lines: PageLine[]; gaps: string[] }
export interface PageNote { id: string; text: string; source: { title: string; url: string; checkedOn: string } | null; notLegalAdvice: boolean }
export interface ReportPage {
  pack: string; page: string; title: string; language: 'en' | 'hi'; period: { from: string; to: string } | null; generatedAt: string;
  state: PageState; sections: PageSection[]; notes: PageNote[]; disclaimer: string | null; gaps: string[]; markings: Marking[];
  footer: { checkCode: string | null; at: string | null }; receiptIds: string[];
}
export interface ExportedFile { format: 'csv' | 'xlsx' | 'html'; name: string; path: string; bytes: number; sha256: string; encrypted: false; textCellsProtected: true }
export interface BriefItem { id: string; text: string; figure: FigureOrMissing | null; chart: { id: string; label: string; figure: FigureOrMissing }[] }
export interface WeekAhead {
  id: string; period: { from: string; to: string }; scheduledFor: string; builtAt: string; late: boolean;
  changed: BriefItem[]; decide: BriefItem[]; due: BriefItem[]; inbox: { id: string; text: string; reviewDate: string }[];
  missed: { id: string; what: string; at: string }[]; explanation: 'not-written'; receiptIds: string[];
}
export interface FridayReview {
  id: string; period: { from: string; to: string }; builtAt: string;
  decisions: { id: string; text: string; reviewDate: string; observed: string | null; receiptIds: string[] }[];
  lessons: { available: boolean; items: { id: string; title: string; evidence: number; change: string }[] };
}
export interface RhythmSettings {
  days: number[]; time: string; dailyClosing: boolean; financialYearStart: string; missedRule: 'run-late' | 'skip';
  mail: { on: boolean; address: string | null }; whatsapp: { on: boolean; phone: string | null };
}
export interface Rhythm extends RhythmSettings {
  mailVerified: boolean; whatsappVerified: boolean; whatsappTemplate: 'not-approved';
  previews: { mail: string; whatsapp: string }; testMode: boolean; relay: 'not-available' | 'available';
}
export interface DueProfile { kind: string; gstMode: GstMode; state: string }
export interface DueRow {
  id: string; what: string; dueOn: string; source: DueSource; lastChecked: string; checkOld: boolean;
  appliesTo: { kinds: string[]; gstModes: string[]; states: string[] };
}
/** `date` is the notification or circular date (null when none is stated); `confirmed` false means the page could not be checked. An older engine sends neither. */
export interface DueSource { title: string; url: string; date: string | null; confirmed: boolean }
export interface DueDates { caNote: string; table: { version: string; publishedAt: string }; profile: DueProfile | null; covered: boolean; coveredKinds: string[]; rows: DueRow[] }
export interface ExportRecord { id: string; at: string; locked: boolean; encrypted: boolean; folder: string; stores: { name: string; rows: number; checkNumber: string; file: string }[] }
export interface FileRef { name: string; path: string; bytes: number; sha256: string }

export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const STATE_CODE = /^[A-Z]{2}$/;
export const SHEET_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;

function id(value: unknown, path: string): string {
  const v = str(value, path, 200);
  if (v.length === 0) throw new ShapeError(path);
  return v;
}
export function isoDate(value: unknown, path: string): string {
  const v = str(value, path, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) !== v) throw new ShapeError(path);
  return v;
}
export function instant(value: unknown, path: string): string {
  const v = str(value, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) || !Number.isFinite(Date.parse(v))) throw new ShapeError(path);
  isoDate(v.slice(0, 10), path);
  return v;
}
function period(value: unknown, path: string): { from: string; to: string } {
  const p = rec(value, path);
  return { from: isoDate(p['from'], `${path}.from`), to: isoDate(p['to'], `${path}.to`) };
}
function whole(value: unknown, path: string): number {
  const n = int(value, path);
  if (n < 0) throw new ShapeError(path);
  return n;
}
function sha(value: unknown, path: string): string {
  const v = str(value, path, 128);
  if (!/^[0-9a-f]{16,128}$/i.test(v)) throw new ShapeError(path);
  return v;
}
function receiptIds(value: unknown, path: string): string[] { return list(value, path, id, 500); }

export function validatePacks(reply: unknown): Packs {
  const r = rec(reply);
  return {
    checkedAt: instant(r['checkedAt'], 'reply.checkedAt'),
    packs: list(r['packs'], 'reply.packs', (v, p) => {
      const k = rec(v, p);
      return {
        id: oneOf(k['id'], `${p}.id`, PACK_IDS), title: str(k['title'], `${p}.title`, 300),
        gstModes: list(k['gstModes'], `${p}.gstModes`, (m, q) => oneOf(m, q, GST_MODES), 3),
        pages: list(k['pages'], `${p}.pages`, (g, q) => {
          const x = rec(g, q);
          return { id: id(x['id'], `${q}.id`), title: str(x['title'], `${q}.title`, 300), state: oneOf(x['state'], `${q}.state`, PAGE_STATES), reason: optStr(x['reason'], `${q}.reason`, 1000) };
        }, 100),
      };
    }, 10),
  };
}

export function validatePage(reply: unknown): ReportPage {
  const r = rec(reply);
  const footer = rec(r['footer'], 'reply.footer');
  return {
    pack: id(r['pack'], 'reply.pack'), page: id(r['page'], 'reply.page'), title: str(r['title'], 'reply.title', 300),
    language: oneOf(r['language'], 'reply.language', ['en', 'hi'] as const),
    period: r['period'] === null ? null : period(r['period'], 'reply.period'),
    generatedAt: instant(r['generatedAt'], 'reply.generatedAt'), state: oneOf(r['state'], 'reply.state', PAGE_STATES),
    sections: list(r['sections'], 'reply.sections', (v, p) => {
      const s = rec(v, p);
      return {
        id: id(s['id'], `${p}.id`), title: str(s['title'], `${p}.title`, 300), projection: bool(s['projection'], `${p}.projection`),
        lines: list(s['lines'], `${p}.lines`, (l, q) => {
          const x = rec(l, q);
          const side = x['side'] === undefined || x['side'] === null ? null : oneOf(x['side'], `${q}.side`, ['Dr', 'Cr'] as const);
          return { id: id(x['id'], `${q}.id`), label: str(x['label'], `${q}.label`, 300), figure: figure(x['figure'], `${q}.figure`), side };
        }, 500),
        gaps: strings(s['gaps'], `${p}.gaps`, 50),
      };
    }, 100),
    notes: list(r['notes'], 'reply.notes', (v, p) => {
      const n = rec(v, p);
      const source = n['source'] === undefined || n['source'] === null ? null : rec(n['source'], `${p}.source`);
      return {
        id: id(n['id'], `${p}.id`), text: str(n['text'], `${p}.text`, 4000), notLegalAdvice: bool(n['notLegalAdvice'], `${p}.notLegalAdvice`),
        source: source === null ? null : { title: str(source['title'], `${p}.source.title`, 300), url: str(source['url'], `${p}.source.url`, 2000), checkedOn: isoDate(source['checkedOn'], `${p}.source.checkedOn`) },
      };
    }, 50),
    disclaimer: optStr(r['disclaimer'], 'reply.disclaimer', 1000), gaps: strings(r['gaps'], 'reply.gaps', 100),
    markings: list(r['markings'], 'reply.markings', (v, p) => oneOf(v, p, ['personal', 'financial', 'confidential'] as const), 3),
    footer: { checkCode: optStr(footer['checkCode'], 'reply.footer.checkCode', 200), at: footer['at'] === null || footer['at'] === undefined ? null : instant(footer['at'], 'reply.footer.at') },
    receiptIds: receiptIds(r['receiptIds'], 'reply.receiptIds'),
  };
}

export function validateExportedFile(reply: unknown): ExportedFile {
  const r = rec(reply);
  if (r['encrypted'] !== false || r['textCellsProtected'] !== true) throw new ShapeError('reply.encrypted');
  return {
    format: oneOf(r['format'], 'reply.format', ['csv', 'xlsx', 'html'] as const), name: str(r['name'], 'reply.name', 300),
    path: str(r['path'], 'reply.path', 2000), bytes: whole(r['bytes'], 'reply.bytes'), sha256: sha(r['sha256'], 'reply.sha256'),
    encrypted: false, textCellsProtected: true,
  };
}

function briefItems(value: unknown, path: string): BriefItem[] {
  return list(value, path, (v, p) => {
    const b = rec(v, p);
    return {
      id: id(b['id'], `${p}.id`), text: str(b['text'], `${p}.text`, 2000),
      figure: b['figure'] === undefined || b['figure'] === null ? null : figure(b['figure'], `${p}.figure`),
      chart: b['chart'] === undefined || b['chart'] === null ? [] : list(b['chart'], `${p}.chart`, (c, q) => {
        const x = rec(c, q);
        return { id: id(x['id'], `${q}.id`), label: str(x['label'], `${q}.label`, 60), figure: figure(x['figure'], `${q}.figure`) };
      }, 24),
    };
  }, 50);
}

export function validateWeekAhead(reply: unknown): WeekAhead {
  const r = rec(reply);
  return {
    id: id(r['id'], 'reply.id'), period: period(r['period'], 'reply.period'),
    scheduledFor: instant(r['scheduledFor'], 'reply.scheduledFor'), builtAt: instant(r['builtAt'], 'reply.builtAt'), late: bool(r['late'], 'reply.late'),
    changed: briefItems(r['changed'], 'reply.changed'), decide: briefItems(r['decide'], 'reply.decide'), due: briefItems(r['due'], 'reply.due'),
    inbox: list(r['inbox'], 'reply.inbox', (v, p) => {
      const x = rec(v, p);
      return { id: id(x['id'], `${p}.id`), text: str(x['text'], `${p}.text`, 2000), reviewDate: isoDate(x['reviewDate'], `${p}.reviewDate`) };
    }, 100),
    missed: list(r['missed'], 'reply.missed', (v, p) => {
      const x = rec(v, p);
      return { id: id(x['id'], `${p}.id`), what: str(x['what'], `${p}.what`, 1000), at: instant(x['at'], `${p}.at`) };
    }, 100),
    explanation: oneOf(r['explanation'], 'reply.explanation', ['not-written'] as const),
    receiptIds: receiptIds(r['receiptIds'], 'reply.receiptIds'),
  };
}

export function validateFriday(reply: unknown): FridayReview {
  const r = rec(reply);
  const lessons = rec(r['lessons'], 'reply.lessons');
  return {
    id: id(r['id'], 'reply.id'), period: period(r['period'], 'reply.period'), builtAt: instant(r['builtAt'], 'reply.builtAt'),
    decisions: list(r['decisions'], 'reply.decisions', (v, p) => {
      const x = rec(v, p);
      return { id: id(x['id'], `${p}.id`), text: str(x['text'], `${p}.text`, 2000), reviewDate: isoDate(x['reviewDate'], `${p}.reviewDate`), observed: optStr(x['observed'], `${p}.observed`, 2000), receiptIds: receiptIds(x['receiptIds'], `${p}.receiptIds`) };
    }, 100),
    lessons: {
      available: bool(lessons['available'], 'reply.lessons.available'),
      items: list(lessons['items'], 'reply.lessons.items', (v, p) => {
        const x = rec(v, p);
        return { id: id(x['id'], `${p}.id`), title: str(x['title'], `${p}.title`, 300), evidence: whole(x['evidence'], `${p}.evidence`), change: str(x['change'], `${p}.change`, 2000) };
      }, 50),
    },
  };
}

export function validateRhythm(reply: unknown): Rhythm {
  const r = rec(reply);
  const mail = rec(r['mail'], 'reply.mail'), whatsapp = rec(r['whatsapp'], 'reply.whatsapp'), previews = rec(r['previews'], 'reply.previews');
  const time = str(r['time'], 'reply.time', 5), fy = str(r['financialYearStart'], 'reply.financialYearStart', 5);
  if (!TIME.test(time)) throw new ShapeError('reply.time');
  if (!MONTH_DAY.test(fy)) throw new ShapeError('reply.financialYearStart');
  const days = list(r['days'], 'reply.days', (v, p) => { const d = int(v, p); if (d < 0 || d > 6) throw new ShapeError(p); return d; }, 7);
  if (new Set(days).size !== days.length) throw new ShapeError('reply.days');
  return {
    days, time, dailyClosing: bool(r['dailyClosing'], 'reply.dailyClosing'), financialYearStart: fy,
    missedRule: oneOf(r['missedRule'], 'reply.missedRule', ['run-late', 'skip'] as const),
    mail: { on: bool(mail['on'], 'reply.mail.on'), address: optStr(mail['address'], 'reply.mail.address', 320) },
    whatsapp: { on: bool(whatsapp['on'], 'reply.whatsapp.on'), phone: optStr(whatsapp['phone'], 'reply.whatsapp.phone', 32) },
    mailVerified: bool(r['mailVerified'], 'reply.mailVerified'), whatsappVerified: bool(r['whatsappVerified'], 'reply.whatsappVerified'),
    whatsappTemplate: oneOf(r['whatsappTemplate'], 'reply.whatsappTemplate', ['not-approved'] as const),
    previews: { mail: str(previews['mail'], 'reply.previews.mail', 4000), whatsapp: str(previews['whatsapp'], 'reply.previews.whatsapp', 4000) },
    testMode: bool(r['testMode'], 'reply.testMode'), relay: oneOf(r['relay'], 'reply.relay', ['not-available', 'available'] as const),
  };
}

export function validateVerify(reply: unknown): { channel: 'mail' | 'whatsapp'; verified: boolean } {
  const r = rec(reply);
  return { channel: oneOf(r['channel'], 'reply.channel', ['mail', 'whatsapp'] as const), verified: bool(r['verified'], 'reply.verified') };
}

export function validateDueProfile(reply: unknown, path = 'reply'): DueProfile {
  const r = rec(reply, path);
  const state = str(r['state'], `${path}.state`, 2);
  if (!STATE_CODE.test(state)) throw new ShapeError(`${path}.state`);
  return { kind: id(r['kind'], `${path}.kind`), gstMode: oneOf(r['gstMode'], `${path}.gstMode`, GST_MODES), state };
}

export function validateDue(reply: unknown): DueDates {
  const r = rec(reply);
  const table = rec(r['table'], 'reply.table');
  return {
    caNote: str(r['caNote'], 'reply.caNote', 500),
    table: { version: str(table['version'], 'reply.table.version', 100), publishedAt: isoDate(str(table['publishedAt'], 'reply.table.publishedAt', 40).slice(0, 10), 'reply.table.publishedAt') },
    profile: r['profile'] === null ? null : validateDueProfile(r['profile'], 'reply.profile'),
    covered: bool(r['covered'], 'reply.covered'), coveredKinds: strings(r['coveredKinds'], 'reply.coveredKinds', 100),
    rows: list(r['rows'], 'reply.rows', (v, p) => {
      const x = rec(v, p), source = rec(x['source'], `${p}.source`), applies = rec(x['appliesTo'], `${p}.appliesTo`);
      return {
        id: id(x['id'], `${p}.id`), what: str(x['what'], `${p}.what`, 500), dueOn: isoDate(x['dueOn'], `${p}.dueOn`),
        source: {
          title: str(source['title'], `${p}.source.title`, 300), url: str(source['url'], `${p}.source.url`, 2000),
          date: source['date'] === undefined || source['date'] === null ? null : isoDate(source['date'], `${p}.source.date`),
          confirmed: source['confirmed'] === undefined ? false : bool(source['confirmed'], `${p}.source.confirmed`),
        },
        lastChecked: isoDate(x['lastChecked'], `${p}.lastChecked`), checkOld: bool(x['checkOld'], `${p}.checkOld`),
        appliesTo: { kinds: strings(applies['kinds'], `${p}.appliesTo.kinds`, 100), gstModes: strings(applies['gstModes'], `${p}.appliesTo.gstModes`, 3), states: strings(applies['states'], `${p}.appliesTo.states`, 50) },
      };
    }, 1000),
  };
}

export function validateExportRecord(reply: unknown, path = 'reply'): ExportRecord {
  const r = rec(reply, path);
  return {
    id: id(r['id'], `${path}.id`), at: instant(r['at'], `${path}.at`), locked: bool(r['locked'], `${path}.locked`), encrypted: bool(r['encrypted'], `${path}.encrypted`),
    folder: str(r['folder'], `${path}.folder`, 2000),
    stores: list(r['stores'], `${path}.stores`, (v, p) => {
      const x = rec(v, p);
      return { name: str(x['name'], `${p}.name`, 200), rows: whole(x['rows'], `${p}.rows`), checkNumber: str(x['checkNumber'], `${p}.checkNumber`, 128), file: str(x['file'], `${p}.file`, 2000) };
    }, 200),
  };
}

export function validateExports(reply: unknown): { warning: string; items: ExportRecord[] } {
  const r = rec(reply);
  return { warning: str(r['warning'], 'reply.warning', 500), items: list(r['items'], 'reply.items', validateExportRecord, 500) };
}

export function validateAskPerson(reply: unknown): { file: FileRef; sent: false } {
  const r = rec(reply);
  if (r['sent'] !== false) throw new ShapeError('reply.sent');
  const f = rec(r['file'], 'reply.file');
  return { file: { name: str(f['name'], 'reply.file.name', 300), path: str(f['path'], 'reply.file.path', 2000), bytes: whole(f['bytes'], 'reply.file.bytes'), sha256: sha(f['sha256'], 'reply.file.sha256') }, sent: false };
}

/** A source link is drawn as a link only when it is an https address. */
export function httpsUrl(value: string): string | null {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
}

/** A pack page's sheet id, `<pack>.<page>`, or null when the address is not one. */
export function pageSheet(sheet: string | undefined): { pack: PackId; page: string } | null {
  if (sheet === undefined || !SHEET_ID.test(sheet)) return null;
  const dot = sheet.indexOf('.');
  const pack = sheet.slice(0, dot), page = sheet.slice(dot + 1);
  return dot > 0 && page.length > 0 && (PACK_IDS as readonly string[]).includes(pack) ? { pack: pack as PackId, page } : null;
}

