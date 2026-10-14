/**
 * The `todayx.*` family: what the frame, first run and Today need beyond `today.*` and
 * `ui.context`. The engine module `platform/runtime/modules/lane-frame-today.ts` serves these
 * shapes; `bridge/fake.ts` serves the same shapes from synthetic data; every screen validates
 * a reply with the functions below before drawing it.
 *
 * Replies carry codes, ids, exact digits and ISO dates only. No reply carries prose: the
 * screen turns every code into words from its own catalogue. Counts are whole-number digit
 * strings or null (not known); money is whole paise as a digit string.
 */

export type Missing = 'absent' | 'null' | 'unknown' | 'withheld' | 'not-applicable' | 'not-loaded-yet' | 'not-counted';
export const MISSING_STATES: readonly Missing[] = ['absent', 'null', 'unknown', 'withheld', 'not-applicable', 'not-loaded-yet', 'not-counted'];

/* ---------------------------------------------------------------- todayx.shell */

export type ShellBannerKind = 'driving' | 'demo-clock' | 'read-only' | 'sending-closed' | 'jobs-paused' | 'update-needed' | 'no-connection';
export const SHELL_BANNER_ORDER: readonly ShellBannerKind[] = ['driving', 'demo-clock', 'read-only', 'sending-closed', 'jobs-paused', 'update-needed', 'no-connection'];

export type ShellBanner =
  | { readonly kind: 'driving'; readonly program: string }
  | { readonly kind: 'demo-clock'; readonly date: string }
  | { readonly kind: 'read-only'; readonly holder: string }
  | { readonly kind: 'sending-closed'; readonly restoredFrom: string; readonly unchecked: string }
  | { readonly kind: 'jobs-paused' }
  | { readonly kind: 'update-needed'; readonly reason: 'expired' | 'withdrawn'; readonly date: string | null }
  | { readonly kind: 'no-connection' };

/** `todayx.shell` {} → the whole-app conditions, in the fixed banner order. */
export interface ShellReply {
  readonly workspace: { readonly demo: boolean };
  /** The demo clock. `real` workspaces can never set it. */
  readonly clock: { readonly mode: 'real' } | { readonly mode: 'demo'; readonly date: string };
  readonly banners: readonly ShellBanner[];
  /** Minutes of no use before the app locks itself. */
  readonly autoLockMinutes: number;
}

/** `todayx.clock.set` { date } (demo only, once) and `todayx.clock.advance` { by: 'day' | 'week' }. The clock never goes back. Reply: ShellReply. */
export type ClockAdvance = 'day' | 'week';
/** `todayx.jobsPaused.dismiss` {} → ShellReply. */

/* --------------------------------------------------------------- todayx.status */

/** `todayx.status` {} → the three facts of the status line. */
export interface StatusReply {
  readonly sources:
    | { readonly state: 'none' }
    | { readonly state: 'fresh' | 'stale'; readonly count: string; readonly oldestReadAt: string; readonly newestReadAt: string };
  readonly model:
    | { readonly state: 'none' }
    | { readonly state: 'ready'; readonly routeLabel: string; readonly sendLevel: 'nothing' | 'shape' | 'samples' };
  /** What left this computer today, or the unusual fact that replaces it. */
  readonly third:
    | { readonly kind: 'left-today'; readonly calls: string }
    | { readonly kind: 'nothing-left' }
    | { readonly kind: 'holds-pen'; readonly holder: string }
    | { readonly kind: 'unknown' };
}

/* --------------------------------------------------------- todayx.capabilities */

export type CapabilityState = 'live' | 'partial' | 'missing';
/** `todayx.capabilities` {} → per method family, whether it is live, with the day it arrives. */
export interface CapabilitiesReply {
  readonly groups: readonly { readonly group: string; readonly state: CapabilityState; readonly day: number | null; readonly methods: string }[];
}

/* -------------------------------------------------------- todayx.worthALook */

export type WorthKind = 'moved' | 'due-soon' | 'decision-due' | 'file-refused' | 'brief-late' | 'missed-while-asleep' | 'approval-expired' | 'update-ready' | 'setup';
export interface WorthRow {
  readonly id: string;
  readonly kind: WorthKind;
  /** Text from the books or a name, shown as written, never translated. */
  readonly subject: string | null;
  readonly at: string | null;
  /** A figure, with the receipt it opens. Absent when the row has none. */
  readonly figure?: { readonly unit: 'paise' | 'count' | 'basis-points'; readonly exact: string; readonly receiptId: string };
  /** Only for kind `moved`: a finding is a lead until a cause is measured. */
  readonly finding?: 'lead-not-tested' | 'tested';
  /** Where the row opens: a place address in hash form, e.g. "#/books/sources". */
  readonly opens: string | null;
}
/** `todayx.worthALook` {} → at most five rows. */
export interface WorthReply { readonly rows: readonly WorthRow[]; readonly state: 'ready' | 'not-loaded-yet' }

/* ----------------------------------------------------------- todayx.activity */

export type ActivityState = 'done' | 'waiting-for-you' | 'waiting-for-network' | 'unsure' | 'stopped-by-rule';
export const ACTIVITY_STATES: readonly ActivityState[] = ['done', 'waiting-for-you', 'waiting-for-network', 'unsure', 'stopped-by-rule'];
/** A typed event. The screen builds the sentence from `type` and `values` (format/sentences.ts). */
export interface ActivityEvent {
  readonly id: string;
  readonly at: string;
  readonly type: string;
  readonly state: ActivityState;
  readonly actor: { readonly kind: 'chausar' | 'you' | 'person' | 'job'; readonly name: string | null };
  /** Plain values for the sentence: ids, names as written, digits. Never prose. */
  readonly values: Readonly<Record<string, string>>;
  readonly costPaise: string | null;
  readonly route: string | null;
  /** The run read text from outside (a file cell, a web page, a message). */
  readonly tainted: boolean;
  /** What opens: a receipt id, an action id or a model request id. */
  readonly proof: { readonly kind: 'receipt' | 'action' | 'model-request' | 'none'; readonly id: string | null };
}
/** `todayx.activity` { cursor?, state?, actor?, day? } → newest first, one page. */
export interface ActivityReply { readonly events: readonly ActivityEvent[]; readonly nextCursor: string | null; readonly total: string | null }

/* ----------------------------------------------------------- first run */

export type FirstRunStep = 'you' | 'vault' | 'model' | 'books' | 'meanings' | 'answer';
export const FIRST_RUN_STEPS: readonly FirstRunStep[] = ['you', 'vault', 'model', 'books', 'meanings', 'answer'];
/** `todayx.firstRun.status` {} → which of the six steps are done, from engine state. */
export interface FirstRunStatusReply {
  readonly steps: Readonly<Record<FirstRunStep, 'done' | 'not-done'>>;
  /** onboarding.blocked: what the next step waits for, as a code. */
  readonly blocked: 'nothing' | 'no-vault' | 'no-source' | 'meanings-unpublished' | 'no-answer';
  /** trust.leftToday: whether anything has left this computer. */
  readonly leftThisComputer: 'nothing' | 'something' | 'unknown';
}

export type IdentityField = 'pan' | 'gstin' | 'udyam' | 'cin' | 'fssai' | 'iec';
export const IDENTITY_FIELDS: readonly IdentityField[] = ['pan', 'gstin', 'udyam', 'cin', 'fssai', 'iec'];
/** The format problems a field can have, as codes. */
export type IdentityProblem = 'length' | 'characters' | 'checksum' | 'state-code' | 'pan-mismatch';
/** `todayx.identity.check` { fields } → per field, ok or the problem. Format checks only; nothing is looked up online. */
export interface IdentityCheckReply { readonly fields: Readonly<Partial<Record<IdentityField, { readonly ok: true } | { readonly ok: false; readonly problem: IdentityProblem; readonly expectedLength: number | null }>>> }
/** `todayx.identity.save` { fields, gstMode } (prepare) → the saved card. `todayx.identity.get` {} → the card or null. */
export interface IdentityCard { readonly fields: Readonly<Partial<Record<IdentityField, string>>>; readonly gstMode: 'regular' | 'composition' | 'not-registered' | null; readonly savedAt: string }

/** `todayx.setupChecklist` {} → FR-12 rows from a dated rule table, never from a model. */
export interface ChecklistRow { readonly id: 'entity' | 'registration' | 'bank' | 'gst' | 'udyam' | 'licences'; readonly ruleId: string; readonly source: string; readonly checkedOn: string; readonly state: 'done' | 'not-done' | 'not-applicable' }
export interface ChecklistReply { readonly rows: readonly ChecklistRow[] }

/* ----------------------------------------------------------- help, fault, phone */

/** `todayx.help` {} → SH-12: what works with no internet and what waits, as codes. */
export interface HelpReply { readonly offline: { readonly works: readonly string[]; readonly waits: readonly string[] } }

/** `todayx.faultReport` {} → SH-11: the whole report as structured fields, shown before anything goes anywhere. No names, amounts, file names, cell values or questions. */
export interface FaultReport {
  readonly appVersion: string;
  readonly os: string;
  readonly eventKinds: readonly string[];
  readonly routeHealth: readonly { readonly kind: string; readonly state: string }[];
  readonly errorCodes: readonly string[];
  readonly createdAt: string;
}

/** `todayx.phoneMessages` {} → PH-01..PH-03: the four fixed messages and their counts this month. Bodies are catalogue keys, never digits. */
export type PhoneMessageKind = 'week-ahead' | 'review' | 'document' | 'due-date';
export interface PhoneMessagesReply {
  readonly channels: readonly { readonly channel: 'whatsapp' | 'telegram' | 'mail'; readonly state: 'on' | 'off' | 'not-built' }[];
  readonly kinds: readonly PhoneMessageKind[];
  readonly sentThisMonth: string | null;
  readonly monthlyBudget: string;
}

/* ----------------------------------------------------------- validators */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isDigits = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,30})$/.test(v);
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/.test(v) && !Number.isNaN(Date.parse(v));
const oneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const isDigitsOrNull = (v: unknown) => v === null || isDigits(v);

function banner(v: unknown): v is ShellBanner {
  if (!isRec(v) || !oneOf(SHELL_BANNER_ORDER)(v['kind'])) return false;
  switch (v['kind']) {
    case 'driving': return isStr(v['program']);
    case 'demo-clock': return isIsoDate(v['date']);
    case 'read-only': return isStr(v['holder']);
    case 'sending-closed': return isIsoDate(v['restoredFrom']) && isDigits(v['unchecked']);
    case 'update-needed': return oneOf(['expired', 'withdrawn'] as const)(v['reason']) && (v['date'] === null || isIsoDate(v['date']));
    default: return true;
  }
}

export function isShellReply(v: unknown): v is ShellReply {
  if (!isRec(v) || !isRec(v['workspace']) || typeof v['workspace']['demo'] !== 'boolean') return false;
  const clock = v['clock'];
  if (!isRec(clock) || !(clock['mode'] === 'real' || (clock['mode'] === 'demo' && isIsoDate(clock['date'])))) return false;
  if (clock['mode'] === 'demo' && v['workspace']['demo'] !== true) return false;
  const banners = v['banners'];
  if (!Array.isArray(banners) || !banners.every(banner)) return false;
  const order = banners.map(b => SHELL_BANNER_ORDER.indexOf((b as ShellBanner).kind));
  if (order.some((n, i) => i > 0 && n <= order[i - 1]!)) return false;
  if (banners.some(b => (b as ShellBanner).kind === 'demo-clock') && v['workspace']['demo'] !== true) return false;
  return typeof v['autoLockMinutes'] === 'number' && Number.isInteger(v['autoLockMinutes']) && v['autoLockMinutes'] > 0;
}

export function isStatusReply(v: unknown): v is StatusReply {
  if (!isRec(v)) return false;
  const s = v['sources'], m = v['model'], t = v['third'];
  if (!isRec(s) || !(s['state'] === 'none' || (oneOf(['fresh', 'stale'] as const)(s['state']) && isDigits(s['count']) && isIsoDate(s['oldestReadAt']) && isIsoDate(s['newestReadAt'])))) return false;
  if (!isRec(m) || !(m['state'] === 'none' || (m['state'] === 'ready' && isStr(m['routeLabel']) && oneOf(['nothing', 'shape', 'samples'] as const)(m['sendLevel'])))) return false;
  if (!isRec(t)) return false;
  switch (t['kind']) {
    case 'left-today': return isDigits(t['calls']);
    case 'holds-pen': return isStr(t['holder']);
    case 'nothing-left': case 'unknown': return true;
    default: return false;
  }
}

export function isCapabilitiesReply(v: unknown): v is CapabilitiesReply {
  return isRec(v) && Array.isArray(v['groups']) && v['groups'].every(g => isRec(g) && isStr(g['group']) && oneOf(['live', 'partial', 'missing'] as const)(g['state'])
    && (g['day'] === null || (Number.isInteger(g['day']) && (g['day'] as number) >= 1 && (g['day'] as number) <= 10)) && isStr(g['methods']));
}

const WORTH_KINDS: readonly WorthKind[] = ['moved', 'due-soon', 'decision-due', 'file-refused', 'brief-late', 'missed-while-asleep', 'approval-expired', 'update-ready', 'setup'];
export function isWorthReply(v: unknown): v is WorthReply {
  if (!isRec(v) || !oneOf(['ready', 'not-loaded-yet'] as const)(v['state']) || !Array.isArray(v['rows']) || v['rows'].length > 5) return false;
  return v['rows'].every(r => {
    if (!isRec(r) || !isStr(r['id']) || !oneOf(WORTH_KINDS)(r['kind']) || !(r['subject'] === null || isStr(r['subject'])) || !(r['at'] === null || isIsoDate(r['at']))) return false;
    if (!(r['opens'] === null || (isStr(r['opens']) && r['opens'].startsWith('#/')))) return false;
    if ('figure' in r) {
      const f = r['figure'];
      if (!isRec(f) || !oneOf(['paise', 'count', 'basis-points'] as const)(f['unit']) || !(isStr(f['exact']) && /^-?(0|[1-9][0-9]{0,30})$/.test(f['exact'])) || !isStr(f['receiptId']) || f['receiptId'].length === 0) return false;
    }
    if ('finding' in r && !(r['kind'] === 'moved' && oneOf(['lead-not-tested', 'tested'] as const)(r['finding']))) return false;
    return true;
  });
}

export function isActivityReply(v: unknown): v is ActivityReply {
  if (!isRec(v) || !Array.isArray(v['events']) || !(v['nextCursor'] === null || isStr(v['nextCursor'])) || !isDigitsOrNull(v['total'])) return false;
  return v['events'].every(e => {
    if (!isRec(e) || !isStr(e['id']) || !isIsoDate(e['at']) || !isStr(e['type']) || !/^[a-z][a-z0-9.-]{0,63}$/.test(e['type']) || !oneOf(ACTIVITY_STATES)(e['state'])) return false;
    const a = e['actor'], p = e['proof'], values = e['values'];
    if (!isRec(a) || !oneOf(['chausar', 'you', 'person', 'job'] as const)(a['kind']) || !(a['name'] === null || isStr(a['name']))) return false;
    if (!isRec(values) || !Object.values(values).every(isStr)) return false;
    if (!isDigitsOrNull(e['costPaise']) || !(e['route'] === null || isStr(e['route'])) || typeof e['tainted'] !== 'boolean') return false;
    return isRec(p) && oneOf(['receipt', 'action', 'model-request', 'none'] as const)(p['kind']) && (p['kind'] === 'none' ? p['id'] === null : isStr(p['id']));
  });
}

export function isFirstRunStatusReply(v: unknown): v is FirstRunStatusReply {
  if (!isRec(v) || !isRec(v['steps'])) return false;
  const steps = v['steps'];
  return FIRST_RUN_STEPS.every(s => steps[s] === 'done' || steps[s] === 'not-done') && Object.keys(steps).length === FIRST_RUN_STEPS.length
    && oneOf(['nothing', 'no-vault', 'no-source', 'meanings-unpublished', 'no-answer'] as const)(v['blocked'])
    && oneOf(['nothing', 'something', 'unknown'] as const)(v['leftThisComputer']);
}

export function isIdentityCheckReply(v: unknown): v is IdentityCheckReply {
  if (!isRec(v) || !isRec(v['fields'])) return false;
  return Object.entries(v['fields']).every(([k, r]) => oneOf(IDENTITY_FIELDS)(k) && isRec(r) && (r['ok'] === true
    || (r['ok'] === false && oneOf(['length', 'characters', 'checksum', 'state-code', 'pan-mismatch'] as const)(r['problem']) && (r['expectedLength'] === null || Number.isInteger(r['expectedLength'])))));
}

export function isIdentityCard(v: unknown): v is IdentityCard {
  return isRec(v) && isRec(v['fields']) && Object.entries(v['fields']).every(([k, x]) => oneOf(IDENTITY_FIELDS)(k) && isStr(x))
    && (v['gstMode'] === null || oneOf(['regular', 'composition', 'not-registered'] as const)(v['gstMode'])) && isIsoDate(v['savedAt']);
}

export function isChecklistReply(v: unknown): v is ChecklistReply {
  return isRec(v) && Array.isArray(v['rows']) && v['rows'].every(r => isRec(r) && oneOf(['entity', 'registration', 'bank', 'gst', 'udyam', 'licences'] as const)(r['id'])
    && isStr(r['ruleId']) && isStr(r['source']) && isIsoDate(r['checkedOn']) && oneOf(['done', 'not-done', 'not-applicable'] as const)(r['state']));
}

export function isHelpReply(v: unknown): v is HelpReply {
  return isRec(v) && isRec(v['offline']) && Array.isArray(v['offline']['works']) && v['offline']['works'].every(isStr) && Array.isArray(v['offline']['waits']) && v['offline']['waits'].every(isStr);
}

export function isFaultReport(v: unknown): v is FaultReport {
  return isRec(v) && isStr(v['appVersion']) && isStr(v['os']) && Array.isArray(v['eventKinds']) && v['eventKinds'].every(isStr)
    && Array.isArray(v['routeHealth']) && v['routeHealth'].every(r => isRec(r) && isStr(r['kind']) && isStr(r['state']))
    && Array.isArray(v['errorCodes']) && v['errorCodes'].every(c => isStr(c) && /^[A-Z][A-Z0-9_]{1,63}$/.test(c)) && isIsoDate(v['createdAt']);
}

export function isPhoneMessagesReply(v: unknown): v is PhoneMessagesReply {
  return isRec(v) && Array.isArray(v['channels']) && v['channels'].every(c => isRec(c) && oneOf(['whatsapp', 'telegram', 'mail'] as const)(c['channel']) && oneOf(['on', 'off', 'not-built'] as const)(c['state']))
    && Array.isArray(v['kinds']) && v['kinds'].every(oneOf(['week-ahead', 'review', 'document', 'due-date'] as const)) && isDigitsOrNull(v['sentThisMonth']) && isDigits(v['monthlyBudget']);
}

/** The refusal codes the frame-today engine module uses. */
export const TODAYX_REFUSALS = ['DEMO_CLOCK_REAL_WORKSPACE', 'DEMO_CLOCK_ALREADY_SET', 'DEMO_CLOCK_NOT_SET', 'IDENTITY_INVALID', 'FAULT_REPORT_UNAVAILABLE', 'INVALID_TODAYX_REQUEST'] as const;
export type TodayxRefusal = (typeof TODAYX_REFUSALS)[number];

/** Codes that mean "this method does not exist yet": the screen shows "not built yet". */
export const NOT_BUILT_CODES: readonly string[] = ['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE'];
export function notBuilt(error: unknown): boolean {
  return isRec(error) && typeof error['code'] === 'string' && NOT_BUILT_CODES.includes(error['code']);
}

/* ------------------------------------------------- round 2: receipt detail, closing, voice */

export type ReceiptDetailWayIn = 'interface' | 'exported-file' | 'computer-export';
export type ReceiptAllowedByKind = 'read-access' | 'send-approved';
/**
 * `todayx.receiptDetail` { receiptId } → the receipt's small print, composed by the engine from
 * records it already keeps. Every field but `receiptId` and `allowedBy` is absent when no record
 * supports it; nothing is filled in. Names are shown as written; `version` and counts are digits.
 */
export interface ReceiptDetailReply {
  readonly receiptId: string;
  readonly question?: string;
  readonly sources?: { readonly names: readonly string[]; readonly wayIn?: ReceiptDetailWayIn; readonly readAt?: string };
  readonly recipe?: { readonly recipeId: string; readonly state: 'seed' | 'tested' | 'not-yet-tested' | 'failed'; readonly acceptedBy: string; readonly grade: 'model' | 'owner' | 'accountant' | 'ca' | 'reconciled' };
  readonly meaning?: { readonly version: string; readonly publishedBy: string; readonly reviewedBy?: string; readonly cosignedBy?: string };
  readonly rate?: { readonly numerator: string; readonly denominator: string; readonly from: string; readonly to: string };
  readonly numberGuard?: { readonly passed: boolean; readonly matched: string; readonly of: string };
  readonly allowedBy: { readonly kind: ReceiptAllowedByKind; readonly ruleId?: string; readonly step?: 1 | 2 | 3 | 4 | 5; readonly person?: string; readonly device?: string; readonly at?: string };
  readonly route?: { readonly kind: string; readonly sendLevel: 'nothing' | 'shape' | 'samples'; readonly costPaise: string | null };
}

const isName = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
const onlyKeys = (v: Rec, required: readonly string[], optional: readonly string[] = []) =>
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));

export function isReceiptDetailReply(v: unknown): v is ReceiptDetailReply {
  if (!isRec(v) || !onlyKeys(v, ['receiptId', 'allowedBy'], ['question', 'sources', 'recipe', 'meaning', 'rate', 'numberGuard', 'route'])) return false;
  if (!isName(v['receiptId']) || !/^[A-Za-z0-9_.:-]{1,200}$/.test(v['receiptId'])) return false;
  if ('question' in v && !isName(v['question'], 8000)) return false;
  const s = v['sources'];
  if (s !== undefined && !(isRec(s) && onlyKeys(s, ['names'], ['wayIn', 'readAt']) && Array.isArray(s['names']) && s['names'].length > 0 && s['names'].length <= 64 && s['names'].every(n => isName(n))
    && (s['wayIn'] === undefined || oneOf(['interface', 'exported-file', 'computer-export'] as const)(s['wayIn'])) && (s['readAt'] === undefined || isIsoDate(s['readAt'])))) return false;
  const r = v['recipe'];
  if (r !== undefined && !(isRec(r) && onlyKeys(r, ['recipeId', 'state', 'acceptedBy', 'grade']) && isName(r['recipeId']) && isName(r['acceptedBy'])
    && oneOf(['seed', 'tested', 'not-yet-tested', 'failed'] as const)(r['state']) && oneOf(['model', 'owner', 'accountant', 'ca', 'reconciled'] as const)(r['grade']))) return false;
  const m = v['meaning'];
  if (m !== undefined && !(isRec(m) && onlyKeys(m, ['version', 'publishedBy'], ['reviewedBy', 'cosignedBy']) && isDigits(m['version']) && isName(m['publishedBy'])
    && (m['reviewedBy'] === undefined || isName(m['reviewedBy'])) && (m['cosignedBy'] === undefined || isName(m['cosignedBy'])))) return false;
  const rate = v['rate'];
  if (rate !== undefined && !(isRec(rate) && onlyKeys(rate, ['numerator', 'denominator', 'from', 'to']) && isDigits(rate['numerator']) && isDigits(rate['denominator']) && rate['denominator'] !== '0'
    && isName(rate['from'], 8) && isName(rate['to'], 8))) return false;
  const g = v['numberGuard'];
  if (g !== undefined && !(isRec(g) && onlyKeys(g, ['passed', 'matched', 'of']) && typeof g['passed'] === 'boolean' && isDigits(g['matched']) && isDigits(g['of'])
    && BigInt(g['matched']) <= BigInt(g['of']) && (g['passed'] !== true || g['matched'] === g['of']))) return false;
  const a = v['allowedBy'];
  if (!isRec(a) || !onlyKeys(a, ['kind'], ['ruleId', 'step', 'person', 'device', 'at']) || !oneOf(['read-access', 'send-approved'] as const)(a['kind'])
    || (a['ruleId'] !== undefined && !isName(a['ruleId'])) || (a['step'] !== undefined && !(Number.isInteger(a['step']) && (a['step'] as number) >= 1 && (a['step'] as number) <= 5))
    || (a['person'] !== undefined && !isName(a['person'])) || (a['device'] !== undefined && !isName(a['device'])) || (a['at'] !== undefined && !isIsoDate(a['at']))) return false;
  const route = v['route'];
  if (route !== undefined && !(isRec(route) && onlyKeys(route, ['kind', 'sendLevel', 'costPaise']) && isName(route['kind'], 40)
    && oneOf(['nothing', 'shape', 'samples'] as const)(route['sendLevel']) && isDigitsOrNull(route['costPaise']))) return false;
  return true;
}

export type ClosingPartState = 'done' | 'not-done' | 'not-loaded-yet';
export const CLOSING_PARTS = ['cash', 'bank', 'entries'] as const;
export type ClosingPart = (typeof CLOSING_PARTS)[number];
/** `todayx.closing` {} and `todayx.closing.set` { on } (admin) → whether daily closing is on, and today's three parts. */
export interface ClosingReply {
  readonly on: boolean;
  readonly day: string;
  readonly parts: Readonly<Record<ClosingPart, ClosingPartState>>;
}
export function isClosingReply(v: unknown): v is ClosingReply {
  if (!isRec(v) || !onlyKeys(v, ['on', 'day', 'parts']) || typeof v['on'] !== 'boolean' || !(isStr(v['day']) && /^\d{4}-\d{2}-\d{2}$/.test(v['day']) && isIsoDate(v['day']))) return false;
  const parts = v['parts'];
  return isRec(parts) && onlyKeys(parts, CLOSING_PARTS) && CLOSING_PARTS.every(p => oneOf(['done', 'not-done', 'not-loaded-yet'] as const)(parts[p]));
}

/**
 * The models-ext lane's speech reading (platform/runtime/speech-understood.ts, served by
 * `modelsx.speechInterpret` { text } and `modelsx.speechConfirm` { text, digest }). Only text
 * crosses: no audio is sent or kept. The reading is deterministic (no model) and always asks for
 * a person's confirmation. Only the fields a screen uses are typed; every declared key is checked.
 */
export interface SpeechNumber {
  readonly text: string;
  /** Whole rupees or other whole units as digits; null when the number has a fraction. */
  readonly integer: string | null;
  readonly unit: 'rupees' | 'paise' | null;
  /** Whole paise, when the words named rupees or paise. */
  readonly paise: string | null;
  readonly display: string;
}
export interface SpeechInterpretReply {
  readonly version: 1;
  readonly understood: string;
  readonly numbers: readonly SpeechNumber[];
  readonly negations: readonly unknown[];
  readonly ambiguities: readonly unknown[];
  readonly unclear: readonly unknown[];
  readonly flipsMeaning: boolean;
  readonly requiresConfirmation: true;
  readonly digest: string;
  readonly receiptId: string | null;
}
const SPEECH_KEYS = ['version', 'normalised', 'understood', 'language', 'segments', 'negations', 'numbers', 'ambiguities', 'unclear', 'flipsMeaning', 'requiresConfirmation', 'digest', 'receiptId'];
const speechText = (v: unknown): v is string => typeof v === 'string' && v.length <= 10000 && !/[\u0000-\u001f]/.test(v);
export function isSpeechInterpretReply(v: unknown): v is SpeechInterpretReply {
  if (!isRec(v) || !onlyKeys(v, SPEECH_KEYS) || v['version'] !== 1 || v['requiresConfirmation'] !== true || typeof v['flipsMeaning'] !== 'boolean') return false;
  if (!speechText(v['normalised']) || !speechText(v['understood']) || !isStr(v['language']) || !(isStr(v['digest']) && /^[a-f0-9]{64}$/.test(v['digest']))) return false;
  if (!(v['receiptId'] === null || isName(v['receiptId']))) return false;
  for (const list of ['segments', 'negations', 'ambiguities', 'unclear'] as const) if (!Array.isArray(v[list]) || !v[list].every(isRec)) return false;
  const numbers = v['numbers'];
  return Array.isArray(numbers) && numbers.every(n => isRec(n) && speechText(n['text']) && isStr(n['display'])
    && (n['integer'] === null || isDigits(n['integer'])) && (n['paise'] === null || isDigits(n['paise'])) && (n['unit'] === null || n['unit'] === 'rupees' || n['unit'] === 'paise'));
}
/** `modelsx.speechConfirm` { text, digest } → the recorded confirmation of the exact reading. */
export interface SpeechConfirmReply { readonly confirmationId: string; readonly digest: string; readonly understood: string; readonly receiptId: string | null; readonly confirmedAt: string }
export function isSpeechConfirmReply(v: unknown): v is SpeechConfirmReply {
  return isRec(v) && onlyKeys(v, ['confirmationId', 'digest', 'understood', 'receiptId', 'confirmedAt']) && isName(v['confirmationId'])
    && isStr(v['digest']) && /^[a-f0-9]{64}$/.test(v['digest']) && speechText(v['understood']) && (v['receiptId'] === null || isName(v['receiptId'])) && isIsoDate(v['confirmedAt']);
}
