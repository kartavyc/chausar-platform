/** TL-08 other assistants: the read-only verified-numbers server, paired per assistant. */
import { audit, check, newId, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { MCP_PROTOCOL_VERSION } from '../mcp.ts';
import { fields, newestFirst, tools } from './tools-common.ts';
import { coreState } from './core-state.ts';
import { applyByOne, onApplyChange } from './core-dual.ts';
import { onPurge } from './lifecycle.ts';
import { peekLane } from './lane-state.ts';

/** Sessions issued by the auth service last at most one day; an assistant pairs again after that. */
type Paired = { id: string; name: string; pairedAt: string; sessionId: string };

function paired(state: State): Paired[] { return tools(state).assistants?.paired ?? []; }

export function assistantsView(state: State) {
  const list = paired(state); const ids = new Map(list.map(item => [item.id, item.name]));
  const receipts = new Map(state.receipts.map(receipt => [receipt.id, receipt]));
  // The numbers server records each call by structure only (core-hooks.ts): the tool, the receipt and how it ended, refused requests included.
  // It has no disclosure step that removes fields from an answer, so `removed` is always empty.
  const calls = newestFirst(((tools(state).mcpCalls ?? []) as any[]).flatMap(d => {
    const client = ids.get(d.memberId);
    return client ? [{ id: d.id as string, at: d.at as string, client, calculation: typeof d.tool === 'string' ? d.tool : 'An unregistered request',
      receiptId: typeof d.receiptId === 'string' && receipts.has(d.receiptId) ? d.receiptId as string : null, removed: [] as string[], refused: d.outcome === 'refused',
      code: typeof d.code === 'string' ? d.code as string : null }] : [];
  }));
  return {
    on: tools(state).assistants?.on === true, server: { version: MCP_PROTOCOL_VERSION, scope: 'this-computer' as const },
    assistants: list.map(item => {
      const member = state.members.find(m => m.id === item.id);
      return { id: item.id, name: item.name, pairedAt: item.pairedAt, lastCall: calls.find(call => call.client === item.name)?.at ?? null, active: member?.active === true };
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
 * Sessions last at most one day. An assistant is not a seat under dual control, so the owner pairs alone.
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
  await host.services.trust.addMember(ctx, { id, name, role: 'viewer' });
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
