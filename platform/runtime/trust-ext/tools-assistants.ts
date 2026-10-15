/** TL-08 other assistants: the read-only verified-numbers server, paired per assistant. */
import { audit, check, newId, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import * as mcpModule from '../mcp.ts';
import { MCP_PROTOCOL_VERSION } from '../mcp.ts';
import { fields, newestFirst, tools } from './tools-common.ts';
import { coreState } from './core-state.ts';
import { applyByOne, onApplyChange } from './core-dual.ts';
import { onPurge, onTick } from './lifecycle.ts';
import { peekLane } from './lane-state.ts';

/** TL-08: one kind of thing the numbers server's disclosure check removed from an answer: the field, why, and how many. Never a value. */
export type McpRemoved = { field: string; why: typeof removedWhy[number]; count: number };
const removedWhy = ['personal', 'financial', 'confidential', 'withheld', 'send-level', 'own-entries'] as const;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/**
 * The `removed` list core-data's MCP replies carry (`{ field, why, count }[]`), checked before it is kept or shown: at most fifty
 * entries, a plain field name, a known reason and a whole count. Anything else is not kept (`undefined`), so the list then
 * reads "not recorded" rather than a guess. No outside text: field names are the workspace's own field identifiers.
 */
export function mcpRemoved(value: unknown): McpRemoved[] | undefined {
  if (!Array.isArray(value) || value.length > 50) return undefined;
  const out: McpRemoved[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || typeof item.field !== 'string' || !FIELD.test(item.field) || !removedWhy.includes(item.why)
      || !Number.isSafeInteger(item.count) || item.count < 1 || item.count > 1_000_000) return undefined;
    out.push({ field: item.field, why: item.why, count: item.count });
  }
  return out;
}
/** True once the core's numbers server has a disclosure step (core-data's `discloseRows`); before it, an answer never had anything removed. */
const disclosure = typeof (mcpModule as Record<string, unknown>).discloseRows === 'function';

/** Sessions issued by the auth service last at most one day; an assistant pairs again after that. */
type Paired = { id: string; name: string; pairedAt: string; sessionId: string };

function paired(state: State): Paired[] { return tools(state).assistants?.paired ?? []; }
const sessionMs = 86400000;
/** True once an assistant's one-day session is over: the member is then revoked (lazily, on the view and the lane tick). */
const expired = (item: Paired, at = Date.now()) => Date.parse(item.pairedAt) + sessionMs <= at;
/** Active members of assistants whose day is over, or (with a name) every active member paired under that name. */
function stale(state: State, name?: string): string[] {
  const active = (id: string) => state.members.some(m => m.id === id && m.active);
  return paired(state).filter(item => active(item.id) && (name === undefined ? expired(item) : item.name.toLowerCase() === name.toLowerCase())).map(item => item.id);
}
/** Revokes them inside a store update as `members.revoke` would: an assistant is not a seat under dual control. */
function revokeStale(state: State, ids: string[]) {
  for (const id of ids) {
    const member = state.members.find(m => m.id === id && m.active); if (!member) continue;
    member.active = false; member.epoch++; state.sessions = state.sessions.filter(s => s.memberId !== id);
    audit(state, 'trust.member.revoked', { memberId: id, reason: 'assistant-session-ended' });
  }
  return ids.length;
}
/** `trustx.assistants`: revokes assistants whose day is over, then shows the list. */
export async function assistants(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, []);
  if (stale(host.store.read()).length) await host.store.update(state => revokeStale(state, stale(state)));
  return assistantsView(host.store.read());
}

export function assistantsView(state: State) {
  const list = paired(state); const ids = new Map(list.map(item => [item.id, item.name]));
  const receipts = new Map(state.receipts.map(receipt => [receipt.id, receipt]));
  // The numbers server records each call by structure only (core-hooks.ts): the tool, the receipt and how it ended, refused requests included,
  // and what its disclosure check removed when the core's record carries that. A call that was not answered gave nothing, so nothing was removed.
  const calls = newestFirst(((tools(state).mcpCalls ?? []) as any[]).flatMap(d => {
    const client = ids.get(d.memberId);
    const removed: McpRemoved[] | 'not-recorded' = d.outcome !== 'answered' ? [] : mcpRemoved(d.removed) ?? (disclosure ? 'not-recorded' : []);
    return client ? [{ id: d.id as string, at: d.at as string, client, calculation: typeof d.tool === 'string' ? d.tool : 'An unregistered request',
      receiptId: typeof d.receiptId === 'string' && receipts.has(d.receiptId) ? d.receiptId as string : null, removed, refused: d.outcome === 'refused',
      code: typeof d.code === 'string' ? d.code as string : null }] : [];
  }));
  return {
    on: tools(state).assistants?.on === true, server: { version: MCP_PROTOCOL_VERSION, scope: 'this-computer' as const },
    assistants: list.map(item => {
      const member = state.members.find(m => m.id === item.id);
      return { id: item.id, name: item.name, pairedAt: item.pairedAt, lastCall: calls.find(call => call.client === item.name)?.at ?? null, active: member?.active === true && !expired(item) };
    }),
    calls,
  };
}

async function revokeAll(ctx: Context, host: ModuleHost) {
  const state = host.store.read();
  for (const item of paired(state)) if (state.members.find(m => m.id === item.id)?.active) await host.services.trust.revokeMember(ctx, item.id);
}

export async function setAssistants(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { on } = fields(payload, ['on']);
  check(typeof on === 'boolean', 'INVALID_ASSISTANT', 'Turn other assistants on or off.');
  if (!on) await revokeAll(ctx, host);
  await host.store.update(state => { (tools(state).assistants ??= { paired: [] }).on = on; });
  return assistantsView(host.store.read());
}

/**
 * Pairing makes a read-only member in the assistant seat and gives it a session that only the numbers
 * server (`/mcp`) accepts: list the calculations, run one, open a receipt. `/api/rpc` refuses it.
 * Sessions last at most one day. An assistant is not a seat under dual control, so the owner pairs alone; the member carries
 * the numbers-only mark (`scope: 'mcp'`), so no session that `/api/rpc` accepts can ever be issued for it.
 */
export async function pairAssistant(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { name } = fields(payload, ['name']);
  check(tools(host.store.read()).assistants?.on === true, 'ASSISTANTS_OFF', 'Turn on other assistants before pairing one.');
  check(typeof name === 'string' && name.trim().length > 0 && name.length <= 60, 'INVALID_ASSISTANT', 'Give the assistant a name of up to 60 characters.');
  check(ctx.role === 'owner', 'OWNER_REQUIRED', 'Only the owner can pair an assistant.');
  return applyByOne(ctx, host, { type: 'pair-assistant', name: name.trim() });
}

onApplyChange('pair-assistant', async (ctx, host, op) => {
  const id = newId('assistant'); const name = op.name as string;
  // Pairing a name again replaces the assistant paired under it before.
  for (const previous of stale(host.store.read(), name)) await host.services.trust.revokeMember(ctx, previous);
  await host.services.trust.addMember(ctx, { id, name, role: 'viewer', scope: 'mcp' });
  try {
    await host.store.update(state => { coreState(state).memberSeats[id] = 'assistant'; });
    const session = await host.services.auth.issueSession(ctx, id, 86400000, { scope: 'mcp' });
    const pairedAt = now();
    await host.store.update(state => {
      const assistants = (tools(state).assistants ??= { paired: [] }); (assistants.paired ??= []).push({ id, name, pairedAt, sessionId: session.sessionId });
      audit(state, 'trustx.assistant.paired', { memberId: id, by: ctx.memberId });
    });
    return { id, name, token: session.token as string, expiresAt: session.expiresAt as string };
  } catch (error) { await host.services.trust.revokeMember(ctx, id); throw error; }
});

export async function revokeAssistant(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { id } = fields(payload, ['id']);
  const state = host.store.read();
  check(typeof id === 'string' && paired(state).some(item => item.id === id), 'NOT_FOUND', 'That assistant was not found.');
  if (state.members.find(m => m.id === id)?.active) await host.services.trust.revokeMember(ctx, id);
  return assistantsView(host.store.read());
}

// A call record keeps no receipt id once that receipt is purged with its source.
onPurge((state, reason) => {
  let removed = 0;
  for (const call of (peekLane(state)?.tools?.mcpCalls ?? []) as { receiptId: string | null }[]) if (call.receiptId && reason.removedIds.has(call.receiptId)) { call.receiptId = null; removed++; }
  return removed;
});

// An assistant whose one-day session is over is revoked.
onTick(async (_ctx, host) => {
  if (!stale(host.store.read()).length) return [];
  return [{ part: 'trust-assistants', revoked: await host.store.update(state => revokeStale(state, stale(state))) }];
});
