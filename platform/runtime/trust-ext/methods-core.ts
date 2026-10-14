import type { MethodSpec } from '../modules/types.ts';
import { onPurge, onTick } from './lifecycle.ts';
import { setPolicy } from './core-hooks.ts';
import { peekLane } from './lane-state.ts';
import type { CoreState } from './core-state.ts';
import { rulesView } from './core-rules.ts';
import { markingsView, setMarking, setSeatMarking } from './core-markings.ts';
import { sendLevels, setSend } from './core-send.ts';
import { confirmChange, expirePending, pendingView } from './core-dual.ts';
import { keepView, setKeep } from './core-keep.ts';
import { autonomyPreset } from './adapters.ts';
import { endSeats, endedMembers, invite, removeSeat, seats } from './core-seats.ts';

export { markingsForSources, seatSees } from './core-markings.ts';

/** trustx.*: rules, markings, send, keep, seats and dual control. What may run on its own is jobs-ext's (`jobsx.autonomy*`). */
export const trustCoreMethods: Record<string, MethodSpec> = {
  // The Do row shows the preset jobs-ext holds, or null when that lane does not answer.
  'trustx.rules': { permission: 'read', handler: async (ctx, _p, host) => ({ ...rulesView(host.store.read(), ctx), do: { preset: await autonomyPreset(host) } }) },
  'trustx.markings': { permission: 'read', handler: (_ctx, _p, host) => markingsView(host.store.read()) },
  'trustx.setMarking': { permission: 'admin', handler: setMarking },
  'trustx.setSeatMarking': { permission: 'admin', handler: setSeatMarking },
  'trustx.sendLevels': { permission: 'read', handler: (ctx, _p, host) => sendLevels(ctx, host) },
  'trustx.setSend': { permission: 'admin', handler: setSend },
  'trustx.pendingChanges': { permission: 'read', handler: (_ctx, _p, host) => pendingView(host.store.read()) },
  'trustx.confirmChange': { permission: 'admin', handler: confirmChange },
  /** Source access and autonomy: the same two-person rule as Send when there is a cofounder. */
  'trustx.setPolicy': { permission: 'admin', handler: setPolicy },
  'trustx.keep': { permission: 'read', handler: (_ctx, _p, host) => keepView(host) },
  'trustx.setKeep': { permission: 'admin', handler: setKeep },
  'trustx.seats': { permission: 'read', handler: (ctx, _p, host) => seats(ctx, host) },
  'trustx.invite': { permission: 'admin', handler: invite },
  'trustx.removeSeat': { permission: 'admin', handler: removeSeat },
};

// Deleted sources take their marks with them, and any waiting change that names them.
onPurge((state, reason) => {
  const core = peekLane(state)?.trust?.core as CoreState | undefined; if (!core) return 0;
  const sources = new Set(reason.sourceIds); const names = (value: unknown) => [...sources].some(id => JSON.stringify(value).includes(JSON.stringify(id)));
  const before = (core.marks?.length ?? 0) + (core.pending?.length ?? 0) + (core.autoOff?.length ?? 0);
  core.marks = (core.marks ?? []).filter(m => !sources.has(m.target.sourceId) && !(m.target.recordId && reason.removedIds.has(m.target.recordId)));
  core.pending = (core.pending ?? []).filter(p => !names(p.op));
  core.autoOff = (core.autoOff ?? []).filter(id => !sources.has(id));
  return before - core.marks.length - core.pending.length - core.autoOff.length;
});

// Dated seats end on their own, and changes that waited past seven days expire.
onTick(async (_ctx, host) => {
  const state = host.store.read(); const expired = state.extensions && (peekLane(state)?.trust?.core as CoreState | undefined)?.pending?.some(p => Date.parse(p.expiresAt) <= Date.now());
  if (!endedMembers(state).length && !expired) return [];
  const result = await host.store.update(current => ({ ended: endSeats(current), expired: expirePending(current) }));
  return [{ module: 'trustx.core', endedSeats: result.ended.length, expiredChanges: result.expired }];
});
