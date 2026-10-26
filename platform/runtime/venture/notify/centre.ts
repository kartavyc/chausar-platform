// Chausar venture launcher, notify (Ink v2 wave 4, package 4G1; spec 5.7, catalogue O12): the notification centre.
//
// One chokepoint, notifyRefresh: the venture host calls it, one look at a time, after a commit that changed Today's
// queue and on the engine's tick. It reads Today's rows as the owner would (views/queue.ts) and plans, in code and on a
// read snapshot, what the centre should become (planRefresh); when nothing would change it writes nothing at all.
//
// Each needs-you row (any kind but 'locked') is one episode of its subject: one venture-notification, never a second
// while it stays on Today, whatever versions the row goes through (the newest row id is kept for the link). An episode
// ends when the row leaves Today, when the owner decided that row and a new one stands in its place, or when its run
// waits on the owner again; a return is a new episode and is news again. An ended item reads as read, keeps only a kind
// word for its title (no client or person name stays in the centre), and is deleted 30 days later (DPDP: the minimum).
//
// The daily digest is written when its hour has come (digest.ts). Whether an alert goes outside the app is planAlert's
// call. Then one notify.new: with { count } when an alert is due, the number of things that need the owner and nothing
// else; with no fields when only the centre changed, so the bell reads it again.
//
// Alerts outside the app (push, the tray, the OS, the relay; 4G3 delivers them): only needs-you items, each once; what
// came while the owner had Chausar open was on screen and is never alerted, and what came in the 2 minutes after waits
// them out; nothing during a pause, and nothing replayed after it; quiet hours hold alerts and send one count when they
// end; an item expiring within 2 hours passes quiet hours and the wait, at most 6 a day; and 10, then 30, then 60
// minutes between alerts while the owner stays away. The in-app centre lists everything whatever the rules hold back.
// 4G3: on the hosted app push counts as on only while a browser has subscribed (browsers.ts), and notify.new carries
// the count only when a channel that shows it is on (the tray here, push on the hosted app), so a tray switched off
// stays quiet; the owner's relay reads the result's alert instead.
import { check, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, listRecords, readVenture, ventureAction } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { queueRowsWithSubjects } from '../views/queue.ts';
import { planDisplay, sumReceipt } from '../money/sums.ts';
import type {
  CountryProfile, IsoTime, NotificationAlert, NotificationRecord, NotifyDigestRecord, NotifyListView, QueueKind, QueueRow, RecordBase,
  VentureDeps, VentureHostKind, VentureRecord,
} from '../contracts.ts';
import { browserCounts, channelsOn, countShown, currentNotifySettings, DEFAULT_NOTIFY_SETTINGS, inQuietHours, pausedAt, type NotifySettings } from './settings.ts';
import { endedSessions, pushOn } from './browsers.ts';
import {
  digestDueDay, digestKind, digestLine, digestSince, digestView, finishedRuns, latestDigest, notificationView, readyToInvoicePlan,
} from './digest.ts';

export { DEFAULT_NOTIFY_SETTINGS };

const MIN = 60_000;
const HOUR = 60 * MIN;
/** The pacing numbers (a founder choice the plan lists: "notification pacing (4G1)"), and how long ended items stay. */
export const NOTIFY_PACING = Object.freeze({
  watchingMs: 2 * MIN,
  ladderMs: Object.freeze([10 * MIN, 30 * MIN, 60 * MIN]),
  urgentWithinMs: 2 * HOUR,
  urgentPerDay: 6,
  historyMs: 24 * HOUR,
  listMax: 200,
  keepEndedMs: 30 * 24 * HOUR,
});
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;

/** What an ended item says instead of its row's title: the kind of thing it was, never whose. */
export const KIND_WORDS: Readonly<Record<QueueKind, string>> = Object.freeze({
  plan: 'Your plan', price: 'A price change', quote: 'A cost to approve', draft: 'A draft', invoice: 'An invoice', signoff: 'A sign-off',
  question: 'A question', setup: 'A setup step', locked: 'A locked business', connector: 'A connection', bank: 'A bank line',
  proposal: 'A proposal', followup: 'A follow-up', reply: 'A reply', notice: 'A notice',
});

export type AlertInput = {
  now: IsoTime;
  country: Pick<CountryProfile, 'code'>;
  host: VentureHostKind;
  settings: NotifySettings;
  records: readonly NotificationRecord[];
  digests: readonly NotifyDigestRecord[];
  /** The subjects on Today now. */
  open: ReadonlySet<string>;
  /** When the owner last had Chausar open; now while they do. */
  watchingAt: IsoTime | null;
  /** A digest is being written now. */
  digestDue: boolean;
};
export type AlertMark = { id: string; alert: NotificationAlert; urgent: boolean };
export type AlertPlan = { marks: AlertMark[]; alert: { count: number; urgent: boolean } | null; digestAlert: boolean };

/** The alerts that went outside the app, oldest first: each moment 'sent' items or a digest's count went out. */
function alertHistory(records: readonly NotificationRecord[], digests: readonly NotifyDigestRecord[]): { at: IsoTime; urgent: boolean }[] {
  const moments = new Map<IsoTime, boolean>();
  for (const record of records) if (record.alert === 'sent' && record.alertedAt) moments.set(record.alertedAt, (moments.get(record.alertedAt) ?? false) || record.urgent === true);
  for (const digest of digests) if (digest.alertedAt && !moments.has(digest.alertedAt)) moments.set(digest.alertedAt, false);
  // 4G3: an alert that could not go out still counts, so the pacing holds while its items wait again.
  for (const record of records) for (const at of record.tries ?? []) if (!moments.has(at)) moments.set(at, false);
  return [...moments].map(([at, urgent]) => ({ at, urgent })).sort((a, b) => a.at.localeCompare(b.at));
}

/** 10, then 30, then 60 minutes between alerts, counted since the owner last had Chausar open (one day at most). */
function ladderOpen(history: readonly { at: IsoTime }[], nowMs: number, watchingAt: IsoTime | null): boolean {
  const since = Math.max(watchingAt ? Date.parse(watchingAt) : -Infinity, nowMs - NOTIFY_PACING.historyMs);
  const recent = history.filter(item => Date.parse(item.at) > since && Date.parse(item.at) <= nowMs);
  if (!recent.length) return true;
  const wait = NOTIFY_PACING.ladderMs[Math.min(recent.length - 1, NOTIFY_PACING.ladderMs.length - 1)];
  return nowMs - Date.parse(recent[recent.length - 1].at) >= wait;
}

/**
 * Whether an alert goes outside the app now, and how each waiting item settles. Code only; the caller writes the marks.
 * The count is everything on Today that needs the owner; it is the only thing an alert carries.
 */
export function planAlert(input: AlertInput): AlertPlan {
  const nowMs = Date.parse(input.now);
  const count = input.open.size;
  const pending = input.records.filter(record => (record.alert ?? null) === null && !record.endedAt && input.open.has(record.subject));
  const wantsDigest = input.digestDue && count > 0;
  const none: AlertPlan = { marks: [], alert: null, digestAlert: false };
  if (!pending.length && !wantsDigest) return none;
  const settle = (alert: NotificationAlert, records: readonly NotificationRecord[] = pending): AlertPlan =>
    ({ marks: records.map(record => ({ id: record.id, alert, urgent: false })), alert: null, digestAlert: false });
  if (input.watchingAt !== null && nowMs - Date.parse(input.watchingAt) < NOTIFY_PACING.watchingMs) {
    // What came while the owner was looking was on screen; what came after waits out the 2 minutes, then alerts.
    const watchedMs = Date.parse(input.watchingAt);
    return settle('seen', pending.filter(record => Date.parse(record.at) <= watchedMs));
  }
  if (pausedAt(input.settings, nowMs)) return settle('paused');
  if (!channelsOn(input.settings, input.host)) return settle('off');

  const history = alertHistory(input.records, input.digests);
  const today = localDayAt(input.now, input.country);
  const urgentToday = history.filter(item => item.urgent && localDayAt(item.at, input.country) === today).length;
  const urgent = pending.filter(record => {
    const ends = record.expiresAt ? Date.parse(record.expiresAt) : NaN;
    return ends > nowMs && ends - nowMs <= NOTIFY_PACING.urgentWithinMs;
  });
  const urgentGoes = urgent.length > 0 && urgentToday < NOTIFY_PACING.urgentPerDay;
  if (inQuietHours(input.settings.quietHours, input.now, input.country)) {
    // Quiet: only what expires soon goes out; the rest waits for one count when the quiet ends. A digest stays inside.
    if (!urgentGoes) return none;
    return { marks: urgent.map(record => ({ id: record.id, alert: 'sent', urgent: true })), alert: { count, urgent: true }, digestAlert: false };
  }
  const all = (isUrgent: boolean): AlertPlan => ({
    marks: pending.map(record => ({ id: record.id, alert: 'sent' as const, urgent: isUrgent && urgent.includes(record) })),
    alert: { count, urgent: isUrgent }, digestAlert: wantsDigest,
  });
  if (urgentGoes) return all(true);
  // The digest's hour is the owner's own choice: its count goes out whatever the wait.
  if (wantsDigest) return all(false);
  return pending.length && ladderOpen(history, nowMs, input.watchingAt) ? all(false) : none;
}

export type RefreshInput = {
  venture: VentureRecord;
  /** Today's rows, as the owner would see them, and when they were read. */
  rows: readonly { subject: string; row: QueueRow }[];
  rowsAt: IsoTime;
  now: IsoTime;
  host: VentureHostKind;
  watchingAt: IsoTime | null;
  /** Money ready to invoice for a digest, from its sum receipt; null when none. */
  ready: NotifyDigestRecord['ready'];
  /** 4G3: how many browsers the owner has for phone alerts; absent is none. */
  pushLive?: number;
};
type DigestDraft = Omit<NotifyDigestRecord, keyof RecordBase<'venture-notify-digest'>>;
/**
 * What the centre should become. fresh: new episodes, with ids 'new:<n>' until they are written; changed: stored items as
 * they should become; pruned: ids of ended items and old digests to delete; write: whether anything changes at all.
 */
export type RefreshPlan = {
  fresh: NotificationRecord[]; changed: NotificationRecord[]; pruned: string[]; digest: DigestDraft | null;
  alert: { count: number } | null; write: boolean;
  /** 4G3: whether the alert's count may ride on notify.new: a channel that shows it (the tray here, push on hosted) is on. */
  shown: boolean;
};

/** The newest run.waiting per run subject ('run:<id>'): a run that waits on the owner again starts a new episode. */
function lastWaits(state: State, ventureId: string): Map<string, IsoTime> {
  const waits = new Map<string, IsoTime>();
  for (const event of listRecords(state, 'venture-event', ventureId)) {
    if (event.name !== 'run.waiting' || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) continue;
    const runId = (event.data as { runId?: unknown }).runId;
    if (typeof runId !== 'string') continue;
    const subject = `run:${runId}`;
    if ((waits.get(subject) ?? '') < event.at) waits.set(subject, event.at);
  }
  return waits;
}

/** The centre's plan for one look at Today: code only, nothing written (see the header). */
export function planRefresh(state: State, input: RefreshInput): RefreshPlan {
  const { venture } = input;
  const nowMs = Date.parse(input.now);
  const chosen = currentNotifySettings(state, venture.id);
  const settings: NotifySettings = { ...chosen, push: pushOn(chosen.push, input.host, input.pushLive ?? 0) };
  const stored = listRecords(state, 'venture-notification', venture.id);
  const digests = listRecords(state, 'venture-notify-digest', venture.id);
  const decided = new Set(listRecords(state, 'venture-queue-decision', venture.id).filter(record => !record.undoneAt).map(record => record.rowId)); // 4J2: undone ones no longer count
  const waits = lastWaits(state, venture.id);
  const work = new Map(stored.map(record => [record.id, structuredClone(record)]));
  const latest = new Map<string, string>();
  for (const record of stored) latest.set(record.subject, record.id);
  const open = new Map<string, QueueRow>();
  for (const { subject, row } of input.rows) open.set(subject, row);
  const end = (record: NotificationRecord) => { record.endedAt = input.now; record.readAt ??= input.now; record.title = KIND_WORDS[record.rowKind] ?? 'An item'; };

  const fresh: NotificationRecord[] = [];
  for (const [subject, row] of open) {
    const current = work.get(latest.get(subject) ?? '');
    const expiresAt = row.meta?.expiresAt ?? null;
    const over = !current || !!current.endedAt
      || (current.rowId !== row.id && decided.has(current.rowId))
      || (waits.get(subject) ?? '') > current.at;
    if (!over) {
      // A new version of the same thing: the link follows it; it is not news.
      if (current.rowId !== row.id || current.title !== row.title || current.rowKind !== row.kind || current.expiresAt !== expiresAt) {
        Object.assign(current, { rowId: row.id, title: row.title, rowKind: row.kind, expiresAt });
      }
      continue;
    }
    if (current && !current.endedAt) end(current);
    const record: NotificationRecord = {
      id: `new:${fresh.length}`, kind: 'venture-notification', ventureId: venture.id, memberId: '', epoch: 0, at: input.now,
      subject, rowId: row.id, rowKind: row.kind, title: row.title, readAt: null, alertedAt: null, digestOn: null, expiresAt, alert: null,
    };
    work.set(record.id, record);
    latest.set(subject, record.id);
    fresh.push(record);
  }
  // A row that left Today: its episode ends. Only items this look could have seen, so a newer look's item is left alone.
  for (const record of work.values()) if (!record.endedAt && !open.has(record.subject) && record.at <= input.rowsAt) end(record);

  // Kept no longer than needed: ended items 30 days after they ended; digests after 30 days, the newest always kept.
  const cutoff = nowMs - NOTIFY_PACING.keepEndedMs;
  const pruned: string[] = [];
  for (const record of stored) if (record.endedAt && Date.parse(record.endedAt) < cutoff) { pruned.push(record.id); work.delete(record.id); }
  const newestDigest = latestDigest(digests);
  for (const digest of digests) if (digest !== newestDigest && Date.parse(digest.at) < cutoff) pruned.push(digest.id);

  const day = digestDueDay(settings, input.now, venture.country, venture.at, digests);
  const plan = planAlert({
    now: input.now, country: venture.country, host: input.host, settings, records: [...work.values()],
    digests: digests.filter(digest => !pruned.includes(digest.id)), open: new Set(open.keys()), watchingAt: input.watchingAt, digestDue: day !== null,
  });
  for (const mark of plan.marks) Object.assign(work.get(mark.id)!, { alert: mark.alert, alertedAt: input.now, ...(mark.urgent ? { urgent: true } : {}) });

  let digest: DigestDraft | null = null;
  if (day) {
    const waiting = [...work.values()].filter(record => !record.endedAt && open.has(record.subject));
    const listed = waiting.filter(record => record.digestOn === null);
    const runIds = finishedRuns(state, venture.id, digestSince(newestDigest, input.now), input.now);
    digest = {
      day, needYou: open.size, listed: listed.map(record => record.id), stillWaiting: waiting.length - listed.length, runIds, ready: input.ready,
      line: digestLine({ kinds: [...open.values()].map(digestKind), stillWaiting: waiting.length - listed.length, runsFinished: runIds.length, ready: input.ready?.display ?? null }),
      alertedAt: plan.digestAlert ? input.now : null,
    };
    for (const record of listed) record.digestOn = day;
  }

  const changed = stored.filter(record => work.has(record.id) && JSON.stringify(work.get(record.id)) !== JSON.stringify(record)).map(record => work.get(record.id)!);
  const alert = plan.alert ? { count: plan.alert.count } : null;
  return { fresh, changed, pruned, digest, alert, write: !!alert || fresh.length > 0 || changed.length > 0 || pruned.length > 0 || digest !== null, shown: countShown(settings, input.host) };
}

export type NotifyRefreshResult = { added: number; alert: { count: number } | null; digest: string | null };

/**
 * The chokepoint (see the header). Never asks a model. watchingAt: when the owner last had Chausar open; absent, the
 * host's deps.watching answers. Level read: any member whose request changed Today may run it. Plans on a snapshot
 * first: a look with nothing to change commits nothing, and a digest's sum receipt is written only once it is due.
 */
export async function notifyRefresh(deps: VentureDeps, ctx: Context, options: { watchingAt?: IsoTime | null } = {}): Promise<NotifyRefreshResult> {
  const idle: NotifyRefreshResult = { added: 0, alert: null, digest: null };
  const venture = currentVenture(deps.store.read());
  if (!venture) return idle;
  const rowsAt = deps.clock().toISOString();
  const rows = (await queueRowsWithSubjects(deps, ctx)).filter(item => item.row.kind !== 'locked');
  const watchingAt = () => options.watchingAt !== undefined ? options.watchingAt : (deps.watching?.() ?? null);
  const snapshot = deps.store.read();
  const now = deps.clock().toISOString();
  const look = planRefresh(snapshot, { venture, rows, rowsAt, now, host: deps.host, watchingAt: watchingAt(), ready: null, pushLive: browserCounts(snapshot, venture.id, endedSessions(deps)).live });
  if (!look.write) return idle;
  // Money for the digest that is due: its sum receipt is written first, in its own commit.
  let ready: NotifyDigestRecord['ready'] = null;
  if (look.digest) {
    const plan = readyToInvoicePlan(snapshot, venture, localDayAt(now, venture.country).slice(0, 7));
    if (plan) {
      try { ready = { display: planDisplay(plan), receiptId: (await sumReceipt(deps, ctx, venture.id, plan)).id }; }
      catch { ready = null; }
    }
  }
  return ventureAction(deps, ctx, 'read', 'notify.refresh', tx => {
    const plan = planRefresh(tx.state, { venture: tx.venture!, rows, rowsAt, now: tx.now, host: deps.host, watchingAt: watchingAt(), ready, pushLive: browserCounts(tx.state, tx.venture!.id, endedSessions(deps)).live });
    if (!plan.write) return idle;
    const ids = new Map<string, string>();
    for (const record of plan.fresh) {
      const { id: temporary, kind: _kind, ventureId: _venture, memberId: _member, epoch: _epoch, at: _at, ...fields } = record;
      ids.set(temporary, tx.put<NotificationRecord>({ ...tx.base('venture-notification'), ...fields }).id);
    }
    for (const record of plan.changed) tx.replace(record);
    if (plan.pruned.length) {
      const gone = new Set(plan.pruned);
      const conversations = tx.state.conversations;
      for (let index = conversations.length - 1; index >= 0; index -= 1) if (gone.has(conversations[index]?.id)) conversations.splice(index, 1);
    }
    const digest = plan.digest
      ? tx.put<NotifyDigestRecord>({ ...tx.base('venture-notify-digest'), ...plan.digest, listed: plan.digest.listed.map(id => ids.get(id) ?? id) }).id
      : null;
    tx.emit('notify.new', plan.alert && plan.shown ? { count: plan.alert.count } : {});
    return { added: plan.fresh.length, alert: plan.alert, digest };
  });
}

/** venture.notify.list {} (read): the centre, newest first, how many are unread, and the newest digest. */
export async function notifyListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<NotifyListView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const records = listRecords(state, 'venture-notification', venture.id);
  const newestFirst = records.map((record, index) => ({ record, index })).sort((a, b) => b.record.at.localeCompare(a.record.at) || b.index - a.index);
  const digest = latestDigest(listRecords(state, 'venture-notify-digest', venture.id));
  return {
    items: newestFirst.slice(0, NOTIFY_PACING.listMax).map(item => notificationView(item.record)),
    unread: records.filter(record => record.readAt === null).length,
    digest: digest ? digestView(digest, records) : null,
  };
}

/** venture.notify.read { ids } or { all: true } (prepare): marks items read; answers how many are still unread. */
export async function notifyReadHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ unread: number }> {
  const body = exactPayload(payload, ['ids', 'all']);
  const all = Object.hasOwn(body, 'all');
  check(all !== Object.hasOwn(body, 'ids'), 'INVALID_VENTURE_REQUEST', 'Send the ids to mark as read, or all: true.');
  check(!all || body.all === true, 'INVALID_VENTURE_REQUEST', 'Send all: true to mark everything as read.');
  const ids = all ? [] : body.ids;
  check(Array.isArray(ids) && (all || (ids.length >= 1 && ids.length <= NOTIFY_PACING.listMax)) && ids.every(id => typeof id === 'string' && ID.test(id)),
    'INVALID_VENTURE_REQUEST', 'Send between 1 and 200 notification ids.');
  return ventureAction(deps, ctx, 'prepare', 'notify.read', tx => {
    const records = tx.list('venture-notification');
    const byId = new Map(records.map(record => [record.id, record]));
    for (const id of ids as string[]) check(byId.has(id), 'INVALID_VENTURE_REQUEST', 'This notification does not exist.');
    const chosen = all ? records : [...new Set(ids as string[])].map(id => byId.get(id)!);
    for (const record of chosen) if (record.readAt === null) tx.replace({ ...record, readAt: tx.now });
    return { unread: tx.list('venture-notification').filter(record => record.readAt === null).length };
  });
}
