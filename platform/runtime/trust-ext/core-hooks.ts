/**
 * The lane's rules at the core trust boundary, registered once at import:
 * dual control on the core Send, Sharing, seat, allowed-source and autonomy paths (in the app only), CA end dates at authorization,
 * seat visibility of markings in every fact read, the canary check before anything leaves, and the numbers server's call record.
 */
import { check, newId, now, registerCoreHook } from '../contracts.ts';
import type { Context, TrustPolicy } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { registerOutboundCheck } from '../gateway.ts';
import { registerMcpCallHook } from '../mcp.ts';
import { markKinds, seatOf } from './core-state.ts';
import type { PendingRecord } from './core-state.ts';
import { applyingChange, onApplyChange, requestChange, requireApp, secondNeeded } from './core-dual.ts';
import { seatHasEnded } from './core-seats.ts';
import { seatSees, sourceMarkKinds } from './core-markings.ts';
import { blockLeak } from './tools-network.ts';
import { fields, tools } from './tools-common.ts';
import { mcpRemoved } from './tools-assistants.ts';

const sendRank: Record<TrustPolicy['send'], number> = { nothing: 0, shape: 1, samples: 2 };

// A core change to Send, Sharing or seats that dual control would hold is refused: it goes through trustx.*, which keeps
// the waiting change. Loosening and seat-adding changes are made by a person in the app, never from outside text or another channel.
// Sending less, sharing off, autonomy off and removing an assistant need one person.
registerCoreHook('change', (state, ctx, change) => {
  const member = state.members.find(m => m.id === ctx.memberId);
  if (!member?.active || !['owner', 'cofounder'].includes(member.role)) return;
  // Taking access away is done by one admin at once: a compromised seat is cut off without waiting.
  if (change.kind === 'member-revoke') return;
  let twoPeople = true;
  if (change.kind === 'policy') {
    const { send, sharing, autonomy, allowedSources } = change.patch;
    // The design puts Send, Sharing and seats under two people; which sources are read (See) and autonomy are one admin's.
    twoPeople = (send !== undefined && sendRank[send] > sendRank[state.policy.send]) || (sharing === true && state.policy.sharing !== true);
    const widens = twoPeople || (autonomy === true && state.policy.autonomy !== true)
      || (Array.isArray(allowedSources) && !state.policy.allowedSources.includes('*') && (allowedSources.includes('*') || allowedSources.some(id => !state.policy.allowedSources.includes(id))));
    if (!widens) return;
  }
  // Every widening change is made by a person in the app, never from outside text or another channel.
  requireApp(ctx);
  if (!twoPeople || applyingChange(ctx)) return;
  check(secondNeeded(state, ctx) === null, 'SECOND_PERSON_REQUIRED', 'This change needs the owner and the cofounder. Make it from Trust.');
});

// The allowed sources and autonomy through Trust (one admin, made in the app).
export async function setPolicy(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { allowedSources, autonomy } = fields(payload, ['allowedSources', 'autonomy']); const patch: Partial<TrustPolicy> = {}; const parts: string[] = [];
  if (allowedSources !== undefined) {
    check(Array.isArray(allowedSources) && allowedSources.length <= 200 && allowedSources.every((s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 200), 'INVALID_POLICY', 'Source grants must be named.');
    patch.allowedSources = [...new Set(allowedSources as string[])]; parts.push(patch.allowedSources.includes('*') ? 'allow every source' : `allow ${patch.allowedSources.length} named sources`);
  }
  if (autonomy !== undefined) { check(typeof autonomy === 'boolean', 'INVALID_POLICY', 'Privacy switches must be boolean.'); patch.autonomy = autonomy; parts.push(`autonomy ${autonomy ? 'on' : 'off'}`); }
  check(parts.length > 0, 'INVALID_POLICY', 'Say what to change.');
  return requestChange(ctx, host, 'policy', `Change ${parts.join(', ')}.`, { type: 'policy', patch });
}
onApplyChange('policy', async (ctx, host, op) => ({ policy: await host.services.trust.updatePolicy(ctx, op.patch as Partial<TrustPolicy>) }));

// A CA seat past its end date is refused on every request, core or lane.
registerCoreHook('seatEnded', (state, memberId) => seatHasEnded(state, memberId));

// Data from a source marked with a kind this seat does not see is not visible to it. The owner, and any seat that sees
// every kind, returns before any work on the source; the kinds hidden from the seat are worked out once per call.
registerCoreHook('sourceHidden', (state, member, sourceId) => {
  if (member.role === 'owner') return false;
  const sees = seatSees(state, seatOf(state, member)); const hidden = markKinds.filter(kind => !sees[kind]);
  if (!hidden.length) return false;
  return sourceMarkKinds(state, sourceId).some(kind => hidden.includes(kind));
});

// The planted value, or a GSTIN, mail address or phone number from the books, stops a model call before it leaves.
registerOutboundCheck((store, _ctx, outgoing) => blockLeak(store, outgoing));

// Each call to the numbers server, refused ones included, by structure only; the newest thousand are kept.
// What the disclosure check removed is kept when the core's record carries it (core-data's `removed`), checked by `mcpRemoved`.
export const MCP_CALLS_KEPT = 1000;
registerMcpCallHook((store, record) => store.update(state => {
  const { memberId, method, tool, receiptId, outcome, code } = record; const removed = mcpRemoved((record as { removed?: unknown }).removed);
  const calls = (tools(state).mcpCalls ??= []) as unknown[];
  calls.push({ id: newId('mcpcall'), at: now(), memberId, method, tool, receiptId, outcome, code, ...(removed ? { removed } : {}) });
  if (calls.length > MCP_CALLS_KEPT) calls.splice(0, calls.length - MCP_CALLS_KEPT);
}));
