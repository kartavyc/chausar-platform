// Chausar venture launcher, views for the Ink frontend (P1-A): small read helpers the view files share.
// Views only read. Every write goes through ventureAction in records.ts, or through the engine method that owns it.
import type { State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import { serviceTypeOf } from '../delivery/shared.ts';
import type { ServiceType, VentureDeps, VentureRecord } from '../contracts.ts';

/** This build has one agent per business: the delivery agent its playbook describes. Its id is stable. */
export const AGENT_ID = 'delivery';
/** The model purposes the delivery agent spends on. Rehearsal clients, judges and plan writing are not its spend. */
export const AGENT_PURPOSES: readonly string[] = Object.freeze(['delivery', 'agent-turn']);
const AGENT_NAMES: Readonly<Record<ServiceType, string>> = Object.freeze({
  agency: 'Marketing agent', studio: 'Studio agent', consulting: 'Consulting agent', bookkeeping: 'Bookkeeping agent',
  research: 'Research agent', content: 'Content agent', support: 'Support agent', other: 'Delivery agent',
});

/** The delivery agent's name, from the plan's service type. */
export function agentName(state: State, venture: VentureRecord): string {
  return AGENT_NAMES[serviceTypeOf(state, venture)] ?? AGENT_NAMES.other;
}

/** The open business: its workspace folder and name when the host says, else the vault's own workspace. */
export function businessOf(deps: VentureDeps, state: State): { id: string; name: string } {
  const current = deps.workspace?.current();
  if (current && current.id) return { id: current.id, name: current.name || state.workspace.name };
  return { id: state.workspace.id, name: state.workspace.name };
}

/** A client's name for an order, or plain words when the order or client is gone. */
export function clientNameFor(state: State, ventureId: string, orderId: string): string {
  const order = listRecords(state, 'venture-order', ventureId).find(item => item.id === orderId);
  const client = order ? listRecords(state, 'venture-client', ventureId).find(item => item.id === order.clientId) : undefined;
  return client?.name ?? 'a client';
}

/** The newest event time per run id, from the venture event log. Older events may have been trimmed. */
export function lastEventAt(state: State, ventureId: string): Map<string, string> {
  const times = new Map<string, string>();
  for (const event of listRecords(state, 'venture-event', ventureId)) {
    const data = event.data;
    const runId = data && typeof data === 'object' && !Array.isArray(data) ? data.runId : undefined;
    if (typeof runId !== 'string') continue;
    const known = times.get(runId);
    if (!known || event.at > known) times.set(runId, event.at);
  }
  return times;
}

/** Elapsed time as the screens show it: '45s', '4m', '1h 5m', '2d 3h'. Whole units only, never negative. */
export function elapsedText(fromIso: string, toIso: string): string {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  if (!Number.isFinite(ms)) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

/** Plain JSON: drops keys whose value is undefined, so canonical digests never see them. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Shortens a line for a row without cutting a word in half. */
export function short(text: string, max = 160): string {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= max) return single;
  const cut = single.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
