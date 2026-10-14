import type { EngineModule, MethodSpec } from './types.ts';
import { check } from '../contracts.ts';
import { reportsMethods } from '../reports-ext/methods.ts';
import { trustCoreMethods } from '../trust-ext/methods-core.ts';
import { trustToolsMethods } from '../trust-ext/methods-tools.ts';
import { endSeats, endedMembers } from '../trust-ext/core-seats.ts';
import { purgeLane, tickLane } from '../trust-ext/lifecycle.ts';

/** A CA seat past its end date ends before any request of this lane runs, whether or not
 *  the scheduler is on; a request from that seat is then refused. */
function seatsEnded(spec: MethodSpec): MethodSpec {
  return { ...spec, async handler(ctx, payload, host) {
    if (endedMembers(host.store.read()).length) await host.store.update(state => { endSeats(state); });
    check(!endedMembers(host.store.read()).includes(ctx.memberId) && host.store.read().members.find(m => m.id === ctx.memberId)?.active === true,
      'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.');
    return spec.handler(ctx, payload, host);
  } };
}
const methods = { ...reportsMethods, ...trustCoreMethods, ...trustToolsMethods };

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const reportsToolsTrustModule: EngineModule = {
  id: 'reports-tools-trust',
  methods: Object.fromEntries(Object.entries(methods).map(([name, spec]) => [name, seatsEnded(spec)])),
  purge: purgeLane,
  tick: tickLane,
};
