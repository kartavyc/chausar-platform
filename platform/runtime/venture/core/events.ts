// Chausar venture launcher, core (P1): venture.events, the venture actor's broadcast log, read in pages.
import type { Context } from '../../contracts.ts';
import { exactPayload, listRecords, readVenture, smallInteger } from '../records.ts';
import type { VentureDeps, VentureEventRecord } from '../contracts.ts';

export const DEFAULT_EVENT_LIMIT = 50;
export const MAX_EVENT_LIMIT = 100;

/** venture.events { afterSeq?, limit? } (read): events after afterSeq, oldest first, at most limit. */
export async function ventureEvents(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ events: VentureEventRecord[]; lastSeq: number }> {
  const body = exactPayload(payload, ['afterSeq', 'limit']);
  const afterSeq = Object.hasOwn(body, 'afterSeq') ? smallInteger(body.afterSeq, 'afterSeq', 0, Number.MAX_SAFE_INTEGER) : 0;
  const limit = Object.hasOwn(body, 'limit') ? smallInteger(body.limit, 'limit', 1, MAX_EVENT_LIMIT) : DEFAULT_EVENT_LIMIT;
  const { state, venture } = readVenture(deps, ctx);
  const all = listRecords(state, 'venture-event', venture.id).slice().sort((a, b) => a.seq - b.seq);
  return {
    events: all.filter(event => event.seq > afterSeq).slice(0, limit),
    lastSeq: all.length ? all[all.length - 1].seq : 0,
  };
}
