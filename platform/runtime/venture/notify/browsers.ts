// Chausar venture launcher, notify (Ink v2 wave 4, package 4G3; spec 5.7, catalogue O13): the owner's browsers that get
// phone alerts. Each push subscription is tied to the hosted session that made it (a hash of its id) and lasts until
// that session signs out or is revoked (the hosted server says so, endPushSessions), or its push service says the
// browser is gone; an idle or expired session keeps its browser. A browser whose session the account already lists as
// ended (VentureDeps.endedSessions) gets nothing even before its record is deleted. On the hosted app, push is on only
// while such a browser exists: the switch alone never sends anything, so it never reads as on with nowhere to go.
import type { State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import type { PushSubscriptionRecord, VentureDeps, VentureHostKind } from '../contracts.ts';

/** The hashes of sessions the account lists as ended; none without a host that keeps them. */
export function endedSessions(deps: Pick<VentureDeps, 'endedSessions'>): ReadonlySet<string> {
  try { return new Set(deps.endedSessions?.() ?? []); } catch { return new Set(); }
}

/** The business's browsers for phone alerts, leaving out those whose session ended. */
export function pushBrowsers(state: State, ventureId: string, ended: ReadonlySet<string> = new Set()): PushSubscriptionRecord[] {
  return listRecords(state, 'venture-push-subscription', ventureId).filter(record => record.sessionHash === null || !ended.has(record.sessionHash));
}

/** Whether push really is on: on the hosted app, the switch and at least one browser; elsewhere the switch as set. */
export function pushOn(stored: boolean, host: VentureHostKind, browsers: number): boolean {
  return host === 'hosted-web' ? stored && browsers > 0 : stored;
}
