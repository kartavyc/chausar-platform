/** TL-08 other assistants: the read-only verified-numbers server, paired per assistant. */
import { check, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { MCP_PROTOCOL_VERSION } from '../mcp.ts';
import { fields, newestFirst, tools } from './tools-common.ts';

/** Sessions issued by the auth service last at most one day; an assistant pairs again after that. */
type Paired = { id: string; name: string; pairedAt: string; sessionId: string };

function paired(state: State): Paired[] { return tools(state).assistants?.paired ?? []; }

export function assistantsView(state: State) {
  const list = paired(state); const ids = new Map(list.map(item => [item.id, item.name]));
  const receipts = new Map(state.receipts.map(receipt => [receipt.id, receipt]));
  // The MCP service audits no per-call record; a calculation it ran shows as calculation.completed under the assistant member.
  const calls = newestFirst(state.activity.flatMap(event => {
    if (event.event !== 'calculation.completed') return [];
    const receipt = receipts.get(event.details?.receiptId); const client = receipt && ids.get(receipt.memberId);
    return client ? [{ id: event.id, at: event.at, client, calculation: String(event.details.operation ?? receipt.operation), receiptId: receipt.id as string | null, removed: [] as string[], refused: false }] : [];
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
 * Pairing refuses until the engine can issue a session that works only on the numbers
 * server. A member session would also open every read request on /api/rpc, which is far
 * more than "list the calculations, run one, open a receipt". The checks run first so the
 * screen can say exactly what is missing.
 */
export async function pairAssistant(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { name } = fields(payload, ['name']);
  check(tools(host.store.read()).assistants?.on === true, 'ASSISTANTS_OFF', 'Turn on other assistants before pairing one.');
  check(typeof name === 'string' && name.trim().length > 0 && name.length <= 60, 'INVALID_ASSISTANT', 'Give the assistant a name of up to 60 characters.');
  check(ctx.role === 'owner', 'OWNER_REQUIRED', 'Only the owner can pair an assistant.');
  check(false, 'ASSISTANT_SCOPE_NOT_AVAILABLE', 'Pairing waits for a session that reaches only the numbers server.');
}

export async function revokeAssistant(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { id } = fields(payload, ['id']);
  const state = host.store.read();
  check(typeof id === 'string' && paired(state).some(item => item.id === id), 'NOT_FOUND', 'That assistant was not found.');
  if (state.members.find(m => m.id === id)?.active) await host.services.trust.revokeMember(ctx, id);
  return assistantsView(host.store.read());
}
