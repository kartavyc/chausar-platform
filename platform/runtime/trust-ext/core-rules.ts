/** TR-01 Rules: See, Send, Keep and Do in a few words, and what left this computer today. */
import type { Context, State } from '../contracts.ts';
import { sourceAllowed } from '../trust.ts';
import { knownSources, peekCore, today } from './core-state.ts';

const outbound = new Set(['dispatching', 'dispatched', 'completed', 'failed']);
const stoppedStates = new Set(['refused', 'blocked', 'stopped']);
/** A stored instant falls on this India date. */
const onDay = (at: unknown, day: string) => typeof at === 'string' && !Number.isNaN(Date.parse(at)) && today(Date.parse(at)) === day;
const bytesOf = (value: unknown) => typeof value === 'string' ? Buffer.byteLength(value) : 0;

/** Outbound model calls and connector reads made today, by destination. */
export function leftToday(state: State, day = today()) {
  const rows = new Map<string, { destination: string; kind: string; count: number; bytes: number; stopped: number }>();
  const add = (destination: string, kind: string, bytes: number, stopped: boolean) => {
    const key = `${kind}\u0000${destination}`; const row = rows.get(key) ?? { destination, kind, count: 0, bytes: 0, stopped: 0 };
    if (stopped) row.stopped++; else { row.count++; row.bytes += bytes; } rows.set(key, row);
  };
  for (const r of state.modelReceipts) {
    const at = r?.dispatchedAt ?? r?.createdAt ?? r?.at; if (!onDay(at, day)) continue;
    // A call the gateway blocked before it left is stopped, not sent.
    const isStopped = stoppedStates.has(r.status) || r.errorCode === 'CANARY_BLOCKED', isOut = outbound.has(r.status) && !isStopped; if (!isOut && !isStopped) continue;
    add(String(r.endpoint ?? r.kind ?? 'model'), 'model', bytesOf(r.payload), isStopped);
  }
  for (const i of state.imports) {
    if (typeof i?.type !== 'string' || !i.type.startsWith('connector-')) continue;
    const at = i.createdAt ?? i.at ?? i.reviewedAt; if (!onDay(at, day)) continue;
    add(String(i.operationKey ?? i.sourceId ?? i.type), 'connector', Number.isSafeInteger(i.totalBytes) ? i.totalBytes : 0, stoppedStates.has(i.status));
  }
  return { date: day, items: [...rows.values()].sort((a, b) => b.count + b.stopped - (a.count + a.stopped) || a.destination.localeCompare(b.destination)) };
}

export function rulesView(state: State, ctx: Context) {
  const sources = knownSources(state); const allowed = sources.filter(id => sourceAllowed(state, ctx, id)).length; const core = peekCore(state);
  return { see: { allSources: state.policy.allowedSources.includes('*'), allowed, refused: sources.length - allowed },
    send: { level: state.policy.send, localOnly: core.send.localOnly }, keep: { days: state.policy.retentionDays },
    do: { preset: core.autonomy?.preset ?? 'ask-everything' }, leftToday: leftToday(state),
    canChange: ['owner', 'cofounder'].includes(ctx.role), ownerOnly: ['send', 'sharing', 'seats'] as const };
}
