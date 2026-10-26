// Chausar venture launcher, core (P1): venture.events, the venture actor's broadcast log, read in pages.
// Ink v2 wave 4 (4G1, W3's U20): the page also carries its run events as frames, shaped exactly as the desktop and
// /api/events pushed them (seq on each, count on notify.new alone), so a client that reconnects replays the gap.
import type { Context } from '../../contracts.ts';
import { exactPayload, listRecords, readVenture, smallInteger } from '../records.ts';
import { runEventFromActor } from '../views/events.ts';
import type { VentureDeps, VentureEventRecord, VentureRunEvent } from '../contracts.ts';

export const DEFAULT_EVENT_LIMIT = 50;
export const MAX_EVENT_LIMIT = 100;

/**
 * venture.events { afterSeq?, limit? } (read): events after afterSeq, oldest first, at most limit, and their run frames.
 * firstSeq is the oldest event the log keeps (it holds the newest 500): an afterSeq below firstSeq - 1 lost events.
 */
export async function ventureEvents(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ events: VentureEventRecord[]; lastSeq: number; firstSeq: number; frames: VentureRunEvent[] }> {
  const body = exactPayload(payload, ['afterSeq', 'limit']);
  const afterSeq = Object.hasOwn(body, 'afterSeq') ? smallInteger(body.afterSeq, 'afterSeq', 0, Number.MAX_SAFE_INTEGER) : 0;
  const limit = Object.hasOwn(body, 'limit') ? smallInteger(body.limit, 'limit', 1, MAX_EVENT_LIMIT) : DEFAULT_EVENT_LIMIT;
  const { state, venture } = readVenture(deps, ctx);
  const all = listRecords(state, 'venture-event', venture.id).slice().sort((a, b) => a.seq - b.seq);
  const events = all.filter(event => event.seq > afterSeq).slice(0, limit);
  // The business id the frames carry, as the venture host names it when it pushes them: the workspace folder.
  let businessId: string;
  try { businessId = deps.workspace?.current().id ?? state.workspace.id; } catch { businessId = state.workspace.id; }
  return {
    events,
    lastSeq: all.length ? all[all.length - 1].seq : 0,
    firstSeq: all.length ? all[0].seq : 0,
    frames: events.map(event => runEventFromActor(event, businessId)).filter((frame): frame is VentureRunEvent => frame !== null),
  };
}
