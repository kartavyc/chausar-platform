// Chausar venture launcher, notify (Ink v2 wave 4): the notification centre, quiet hours and the digest (4G1); web push,
// the phone relay and the tray count, a count only (4G3). The host loads this file on first use of a method it owns.
// Package 4-0 registered every method with a NOT_BUILT_YET stub; each package replaces only its own lines.
import type { Context } from '../../contracts.ts';
import type { IsoTime, NotificationRecord, VentureDeps, VentureHandlerTable } from '../contracts.ts';
import { currentVenture, listRecords, ventureAction } from '../records.ts';
import { notifyListHandler, notifyReadHandler, notifyRefresh as refreshCentre, type NotifyRefreshResult } from './centre.ts';
import { countShown, currentNotifySettings, notifySettingsHandler } from './settings.ts';
import { deliverPush, endPushSessions, pushKeyHandler, pushSubscribeHandler, pushUnsubscribeHandler } from './push-methods.ts';
import { deliverRelay, relayHandler } from './relay.ts';

export { endPushSessions };

/** The work started outside the looks (4G3), per business store: deliveries, each with its own catch, until it ends. */
const outside = new Map<object, Set<Promise<void>>>();

/** Starts work after the centre's commit, never inside the look, so a slow push service holds no answer and no lock. */
function startOutside(store: object, work: () => Promise<unknown>): void {
  const running = work().then(() => undefined, () => undefined);
  const set = outside.get(store) ?? new Set<Promise<void>>();
  outside.set(store, set);
  set.add(running);
  void running.then(() => { set.delete(running); if (!set.size && outside.get(store) === set) outside.delete(store); });
}

/** The work under way outside the looks for one business: a promise that ends with all of it, or null when there is none. */
export function outsidePending(store: object): Promise<void> | null {
  const set = outside.get(store);
  if (!set?.size) return null;
  return (async () => { while (outside.get(store)?.size) await Promise.all([...outside.get(store)!]); })();
}

/** Waits for one business's work outside the looks to end, at most timeoutMs (closing, 12 s). Never throws. */
export async function settleOutside(store: object, timeoutMs = 12_000): Promise<void> {
  const work = outsidePending(store);
  if (!work) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

/** Resolves once everything started outside the looks so far, for every business, has ended (tests). */
export async function deliveriesSettled(): Promise<void> {
  while (outside.size) await Promise.all([...outside.values()].flatMap(set => [...set]));
}

/** When this look's alert went out: the newest moment any item was marked sent (the look that just committed). */
function alertMoment(records: readonly NotificationRecord[]): IsoTime | null {
  let newest: IsoTime | null = null;
  for (const record of records) if (record.alert === 'sent' && record.alertedAt && (!newest || record.alertedAt > newest)) newest = record.alertedAt;
  return newest;
}

/** An alert for the same items that could not go out at all is tried this many times, then left for the next new item. */
export const MAX_ALERT_TRIES = 3;

/**
 * Nothing could go out (the journal halted every try, or each failed before it left this computer): the items that
 * alert counted wait again, so a later look sends them. The moment stays in their tries, which count in the alert
 * history, so the pacing (10, 30, 60 minutes) holds; the third try for the same items gives up, and the settings say
 * so until an alert goes out again. Never throws.
 */
async function waitAgain(deps: VentureDeps, ctx: Context, at: IsoTime): Promise<void> {
  try {
    await ventureAction(deps, ctx, 'read', 'notify.alert.again', tx => {
      for (const record of tx.list('venture-notification')) {
        if (record.alert !== 'sent' || record.alertedAt !== at || record.endedAt) continue;
        const tries = [...(record.tries ?? []), at];
        if (tries.length >= MAX_ALERT_TRIES) tx.replace<NotificationRecord>({ ...record, tries, gaveUpAt: at });
        else tx.replace<NotificationRecord>({ ...record, tries, alert: null, alertedAt: null, urgent: false });
      }
    });
  } catch { /* The next look sees the items as they are. */ }
}

/**
 * The chokepoint the venture host calls after a commit that changed Today, and on the engine's tick (4G1). When the
 * centre says an alert is due, the count goes outside the app after the centre's commit, without holding the look
 * (4G3): web push to the owner's browsers on the hosted app, and the owner's relay on the desktop, both as the owner
 * inside the app whoever's request started the look; the desktop tray hears the centre's own notify.new. When nothing
 * could go out at all, the alert's items wait again. The bell lists everything anyway.
 */
export async function notifyRefresh(deps: VentureDeps, ctx: Context, options: { watchingAt?: IsoTime | null } = {}): Promise<NotifyRefreshResult> {
  const result = await refreshCentre(deps, ctx, options);
  const alert = result.alert;
  if (!alert) return result;
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return result;
  const at = alertMoment(listRecords(state, 'venture-notification', venture.id));
  // The tray showed the count from notify.new itself: that alert reached the owner whatever else happens.
  const trayShowed = deps.host !== 'hosted-web' && countShown(currentNotifySettings(state, venture.id), deps.host);
  startOutside(deps.store, async () => {
    const [push, relay] = await Promise.all([deliverPush(deps, ctx, alert.count), deliverRelay(deps, ctx, alert.count)]);
    // Written as the look was: the same context just committed the marks this undoes.
    if (at && !trayShowed && !push.reached && !relay.reached) await waitAgain(deps, ctx, at);
  });
  return result;
}

export const handlers: VentureHandlerTable = Object.freeze({
  // 4G1 the notification centre and its settings
  'venture.notify.list': notifyListHandler,
  'venture.notify.read': notifyReadHandler,
  'venture.notify.settings': notifySettingsHandler,
  // 4G3 web push and the relay
  'venture.notify.push.key': pushKeyHandler,
  'venture.notify.push.subscribe': pushSubscribeHandler,
  'venture.notify.push.unsubscribe': pushUnsubscribeHandler,
  'venture.notify.relay': relayHandler,
});
