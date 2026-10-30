// Chausar venture launcher, notify (Ink v2 wave 4, package 4G1; spec 5.7, catalogue O12): the owner's notification
// settings. A pause of 30 days at most (nothing is replayed after it ends), quiet hours and the digest hour in the
// business's own time zone, and the switches for the channels outside the app: push on the hosted app, the tray on this
// computer. The newest record wins; a change keeps every field it does not name, the relay (4G3) included. The answer
// also says what keeps running while the app is closed: the Keeper jobs that have run here and the routines that are
// on, read from records, never assumed.
// 4G3: on the hosted app push reads as on only while a browser has subscribed (browsers.ts), and is refused without
// one (PUSH_NOT_SUBSCRIBED); the line says that phone alerts come while the business is awake, and how many browsers
// are not being reached.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { exactPayload, formatVentureDate, listRecords, requireAppChannel, requireVenture, ventureAction } from '../records.ts';
import { localDayAt, localTimeAt } from '../local-day.ts';
import type {
  CountryProfile, IsoTime, KeeperJobId, NotifySettingsRecord, NotifySettingsView, VentureDeps, VentureHostKind, VentureRecord,
} from '../contracts.ts';
import { endedSessions, pushBrowsers, pushOn } from './browsers.ts';

/** The settings fields a record holds; relay is 4G3's and only carried forward here. */
export type NotifySettings = Pick<NotifySettingsRecord, 'pausedUntil' | 'quietHours' | 'digest' | 'push' | 'tray' | 'relay'>;

/** Before the owner chooses: quiet at night, a morning digest, the tray on, push off until the browser allows it. */
export const DEFAULT_NOTIFY_SETTINGS: Readonly<NotifySettings> = Object.freeze({
  pausedUntil: null, quietHours: { from: '22:00', to: '07:00' }, digest: { hour: 8 }, push: false, tray: true, relay: null,
});
/** The longest pause: 30 days. */
export const MAX_PAUSE_MS = 30 * 24 * 3_600_000;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Keeper's job names, as views/keeper.ts shows them on Team (4A1); the order Keeper lists them in. */
const KEEPER_JOBS: readonly [KeeperJobId, string][] = [
  ['backups', 'Backups'], ['journal-sweep', 'Journal sweep'], ['connection-checks', 'Connection checks'], ['rule-freshness', 'Platform rule dates'],
  ['rate-tables', 'Tax rate tables'], ['posting-steps', 'Posting steps'], ['network-strength', 'Network strength'], ['probes', 'Needs-you checks'],
  ['calendar-feed', 'Calendar feed'], ['monitors', 'Page monitors'],
];

/** The settings in use: the newest record's, else the defaults. */
export function currentNotifySettings(state: State, ventureId: string): NotifySettings {
  const latest = listRecords(state, 'venture-notify-settings', ventureId).at(-1);
  const from = latest ?? DEFAULT_NOTIFY_SETTINGS;
  return structuredClone({ pausedUntil: from.pausedUntil, quietHours: from.quietHours, digest: from.digest, push: from.push, tray: from.tray, relay: from.relay });
}

/** The owner's clock at an instant, 'HH:MM', in the business's time zone. */
export function localClock(instant: IsoTime, country: Pick<CountryProfile, 'code'>): string {
  return localTimeAt(instant, country).slice(11, 16);
}

/** Whether an instant falls in the quiet hours, which may run past midnight (22:00 to 07:00). */
export function inQuietHours(quietHours: NotifySettings['quietHours'], instant: IsoTime, country: Pick<CountryProfile, 'code'>): boolean {
  if (!quietHours) return false;
  const time = localClock(instant, country);
  return quietHours.from < quietHours.to ? time >= quietHours.from && time < quietHours.to : time >= quietHours.from || time < quietHours.to;
}

/** Whether alerts outside the app are paused at this moment. */
export function pausedAt(settings: Pick<NotifySettings, 'pausedUntil'>, nowMs: number): boolean {
  return settings.pausedUntil !== null && Date.parse(settings.pausedUntil) > nowMs;
}

/** Whether any channel outside the app is on here: push on the hosted app, the tray elsewhere, or the owner's relay. */
export function channelsOn(settings: NotifySettings, host: VentureHostKind): boolean {
  return settings.relay !== null || (host === 'hosted-web' ? settings.push : settings.tray);
}

/** Whether an alert's count may ride on notify.new (4G3): only to a channel that shows it, the tray here or push on hosted. */
export function countShown(settings: NotifySettings, host: VentureHostKind): boolean {
  return host === 'hosted-web' ? settings.push : settings.tray;
}

/**
 * What keeps running while the app is closed: each Keeper job with a run on record here, then each routine that is on.
 * The hosted app sleeps while nobody has it open, so there it is nothing.
 */
export function keepsRunning(state: State, venture: VentureRecord, host: VentureHostKind): string[] {
  if (host === 'hosted-web') return [];
  const ran = new Set(listRecords(state, 'venture-keeper-run', venture.id).map(record => record.job));
  const jobs = KEEPER_JOBS.filter(([id]) => ran.has(id)).map(([, name]) => `${name}, by Keeper`);
  const routines = listRecords(state, 'venture-routine', venture.id).filter(routine => routine.on && routine.removedAt === null).map(routine => `Routine: ${routine.name}`);
  return [...jobs, ...routines];
}

const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** The owner's browsers for phone alerts (4G3): how many are live, and how many of those are not being reached. */
export type BrowserCounts = { live: number; failing: number };
const NO_BROWSERS: BrowserCounts = Object.freeze({ live: 0, failing: 0 });

/** The browser counts of a business, from its records, leaving out browsers whose session ended. */
export function browserCounts(state: State, ventureId: string, ended: ReadonlySet<string> = new Set()): BrowserCounts {
  const browsers = pushBrowsers(state, ventureId, ended);
  return { live: browsers.length, failing: browsers.filter(record => record.failures > 0).length };
}

/**
 * 4G3: whether the newest alert outside the app gave up (it could not go out three times for the same items) and no
 * alert has gone out since.
 */
function alertsGaveUp(state: State, ventureId: string): boolean {
  const records = listRecords(state, 'venture-notification', ventureId);
  let gaveUp: IsoTime | null = null;
  for (const record of records) if (record.gaveUpAt && !record.endedAt && (!gaveUp || record.gaveUpAt > gaveUp)) gaveUp = record.gaveUpAt;
  return gaveUp !== null && !records.some(record => record.alert === 'sent' && !record.gaveUpAt && record.alertedAt && record.alertedAt > gaveUp!);
}

/** One plain line on the settings: the pause or the channel, then quiet hours, then the digest. */
function settingsLine(settings: NotifySettings, venture: VentureRecord, host: VentureHostKind, nowMs: number, browsers: BrowserCounts, gaveUp = false): string {
  const parts: string[] = [];
  if (pausedAt(settings, nowMs)) {
    const until = settings.pausedUntil!;
    parts.push(`Alerts outside the app are paused until ${formatVentureDate(localDayAt(until, venture.country), venture.country.dateOrder)}, ${localClock(until, venture.country)}. The bell still lists everything.`);
  } else if (host === 'hosted-web') {
    parts.push(settings.push ? 'Phone alerts are on, with a count only, and come while Chausar is awake for this business.' : 'Phone alerts are off. The bell still lists everything.');
    if (settings.push && browsers.failing > 0) parts.push(`Not reaching ${browsers.failing} ${browsers.failing === 1 ? 'browser' : 'browsers'}.`);
  } else {
    parts.push(settings.tray ? 'The tray shows how many things need you.' : 'The tray count is off. The bell still lists everything.');
  }
  if (gaveUp && !pausedAt(settings, nowMs)) parts.push("Phone alerts couldn't be sent: Chausar will try with the next new item.");
  parts.push(settings.quietHours ? `Quiet hours: ${settings.quietHours.from} to ${settings.quietHours.to}.` : 'No quiet hours.');
  parts.push(settings.digest ? `Daily digest at ${hourText(settings.digest.hour)}.` : 'No daily digest.');
  return parts.join(' ');
}

/** The settings as the app shows them. A pause that has ended reads as none; push is on only as browsers.ts says. */
export function settingsView(state: State, venture: VentureRecord, stored: NotifySettings, host: VentureHostKind, nowMs: number, browsers: BrowserCounts = NO_BROWSERS): NotifySettingsView {
  const settings: NotifySettings = { ...stored, push: pushOn(stored.push, host, browsers.live) };
  return {
    pausedUntil: pausedAt(settings, nowMs) ? settings.pausedUntil : null,
    quietHours: settings.quietHours ? { ...settings.quietHours } : null,
    digest: settings.digest ? { hour: settings.digest.hour } : null,
    push: settings.push, tray: settings.tray,
    keepsRunning: keepsRunning(state, venture, host),
    line: settingsLine(settings, venture, host, nowMs, browsers, alertsGaveUp(state, venture.id)),
  };
}

function pauseUntil(value: unknown, nowMs: number): string | null {
  if (value === null) return null;
  check(typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value)), 'INVALID_VENTURE_REQUEST', 'Send the end of the pause as a time like 2026-10-30T09:00:00.000Z, or null to end it.');
  const until = Date.parse(value);
  check(until > nowMs, 'INVALID_VENTURE_REQUEST', 'Choose an end for the pause that is still ahead, or null to end it.');
  check(until - nowMs <= MAX_PAUSE_MS, 'NOTIFY_PAUSE_TOO_LONG', 'Pause alerts for 30 days at most.');
  return new Date(until).toISOString();
}

function quietHoursOf(value: unknown): NotifySettings['quietHours'] {
  if (value === null) return null;
  const body = exactPayload(value, ['from', 'to'], ['from', 'to']);
  check(typeof body.from === 'string' && CLOCK.test(body.from) && typeof body.to === 'string' && CLOCK.test(body.to), 'INVALID_VENTURE_REQUEST', 'Give quiet hours as two times like 22:00 and 07:00.');
  check(body.from !== body.to, 'INVALID_VENTURE_REQUEST', 'Quiet hours need a start and an end that differ.');
  return { from: body.from as string, to: body.to as string };
}

function digestOf(value: unknown): NotifySettings['digest'] {
  if (value === null) return null;
  const body = exactPayload(value, ['hour'], ['hour']);
  check(Number.isInteger(body.hour) && (body.hour as number) >= 0 && (body.hour as number) <= 23, 'INVALID_VENTURE_REQUEST', 'Choose the digest hour from 0 to 23.');
  return { hour: body.hour as number };
}

function switchOf(value: unknown, field: 'push' | 'tray'): boolean {
  check(typeof value === 'boolean', 'INVALID_VENTURE_REQUEST', `${field === 'push' ? 'Push' : 'Tray'} must be on or off.`);
  return value;
}

/**
 * venture.notify.settings { pausedUntil?, quietHours?, digest?, push?, tray? } (approve, app only). Each field named is
 * changed and the rest kept; an empty request reads the settings and writes nothing.
 */
export async function notifySettingsHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<NotifySettingsView> {
  requireAppChannel(ctx, 'venture.notify.settings');
  const body = exactPayload(payload, ['pausedUntil', 'quietHours', 'digest', 'push', 'tray']);
  const nowMs = deps.clock().getTime();
  const change: Partial<NotifySettings> = {};
  if (Object.hasOwn(body, 'pausedUntil')) change.pausedUntil = pauseUntil(body.pausedUntil, nowMs);
  if (Object.hasOwn(body, 'quietHours')) change.quietHours = quietHoursOf(body.quietHours);
  if (Object.hasOwn(body, 'digest')) change.digest = digestOf(body.digest);
  if (Object.hasOwn(body, 'push')) change.push = switchOf(body.push, 'push');
  if (Object.hasOwn(body, 'tray')) change.tray = switchOf(body.tray, 'tray');
  if (!Object.keys(change).length) {
    authorize(deps.store, ctx, 'approve');
    const state = deps.store.read();
    const venture = requireVenture(state);
    return settingsView(state, venture, currentNotifySettings(state, venture.id), deps.host, nowMs, browserCounts(state, venture.id, endedSessions(deps)));
  }
  return ventureAction(deps, ctx, 'approve', 'notify.settings', tx => {
    const venture = tx.venture!;
    const browsers = browserCounts(tx.state, venture.id, endedSessions(deps));
    // 4G3: push on the hosted app goes to the browsers that allowed it; the switch alone would send nowhere.
    check(change.push !== true || deps.host !== 'hosted-web' || browsers.live > 0, 'PUSH_NOT_SUBSCRIBED',
      'Allow phone alerts in this browser first. Chausar turns them on when the browser says yes.');
    const next: NotifySettings = { ...currentNotifySettings(tx.state, venture.id), ...change };
    tx.put<NotifySettingsRecord>({ ...tx.base('venture-notify-settings'), ...next });
    return settingsView(tx.state, venture, next, deps.host, Date.parse(tx.now), browsers);
  });
}
