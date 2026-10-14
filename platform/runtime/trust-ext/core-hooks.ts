/**
 * The lane's rules at the core trust boundary, registered once at import:
 * dual control on the core Send, Sharing and seat paths, CA end dates at authorization,
 * seat visibility of markings in every fact read, the canary check before anything leaves, and the numbers server's call record.
 */
import { check, newId, now, registerCoreHook } from '../contracts.ts';
import type { TrustPolicy } from '../contracts.ts';
import { registerOutboundCheck } from '../gateway.ts';
import { registerMcpCallHook } from '../mcp.ts';
import { markKinds, seatOf } from './core-state.ts';
import type { PendingRecord } from './core-state.ts';
import { applyingChange, secondNeeded } from './core-dual.ts';
import { seatHasEnded } from './core-seats.ts';
import { seatSees, sourceMarkKinds } from './core-markings.ts';
import { blockLeak } from './tools-network.ts';
import { tools } from './tools-common.ts';

const sendRank: Record<TrustPolicy['send'], number> = { nothing: 0, shape: 1, samples: 2 };

// A core change to Send, Sharing or seats that dual control would hold is refused: it goes through trustx.*,
// which keeps the waiting change. Sending less, sharing off and removing an assistant need one person.
registerCoreHook('change', (state, ctx, change) => {
  const member = state.members.find(m => m.id === ctx.memberId);
  if (!member?.active || !['owner', 'cofounder'].includes(member.role) || applyingChange(ctx)) return;
  let op: PendingRecord['op'] | undefined;
  if (change.kind === 'policy') {
    const { send, sharing } = change.patch;
    const loosens = (send !== undefined && sendRank[send] > sendRank[state.policy.send]) || (sharing === true && state.policy.sharing !== true);
    if (!loosens) return;
  } else if (change.kind === 'member-revoke') {
    const target = state.members.find(m => m.id === change.memberId);
    if (target && seatOf(state, target) === 'assistant') return;
    op = { type: 'remove-seat', memberId: change.memberId };
  }
  check(secondNeeded(state, ctx, op) === null, 'SECOND_PERSON_REQUIRED', 'This change needs the owner and the cofounder. Make it from Trust.');
});

// A CA seat past its end date is refused on every request, core or lane.
registerCoreHook('seatEnded', (state, memberId) => seatHasEnded(state, memberId));

// Data from a source marked with a kind this seat does not see is not visible to it. The owner sees everything.
registerCoreHook('sourceHidden', (state, member, sourceId) => {
  if (member.role === 'owner') return false;
  const sees = seatSees(state, seatOf(state, member));
  return !markKinds.every(kind => sees[kind]) && sourceMarkKinds(state, sourceId).some(kind => !sees[kind]);
});

// The planted value, or a GSTIN, mail address or phone number from the books, stops a model call before it leaves.
registerOutboundCheck((store, _ctx, outgoing) => blockLeak(store, outgoing));

// Each call to the numbers server, refused ones included, by structure only; the newest thousand are kept.
export const MCP_CALLS_KEPT = 1000;
registerMcpCallHook((store, record) => store.update(state => {
  const calls = (tools(state).mcpCalls ??= []) as unknown[]; calls.push({ id: newId('mcpcall'), at: now(), ...record });
  if (calls.length > MCP_CALLS_KEPT) calls.splice(0, calls.length - MCP_CALLS_KEPT);
}));
