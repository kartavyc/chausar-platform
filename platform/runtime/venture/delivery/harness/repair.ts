// Chausar delivery harness (Ink v2 wave 4, package 4F2): one repair turn (catalogue H35). When the AI answers an act
// turn in a shape Chausar cannot read, the run does not fail at once: it gets exactly one repair turn, which says what
// could not be read and asks for the same shape again. That turn is previewed and waits for the owner's approval like
// any other, and its cost is held against the run's spend cap like any call (the failed answer's cost counts too). A
// second bad shape for the same turn fails the run with that reason; there is no third try. The write step is not
// repaired: its answer is checked against the proven work, and a bad one fails as before.
// One repair turn for a malformed tool call, then stop, follows Qwen-CUA's protocol (demo/src/qwen_cua/protocol.py);
// this is a rewrite, not a copy.
import { check, type Context } from '../../../contracts.ts';
import {vaRunCurrent} from '../../playbooks/virtual-assistant/run-source.ts';
import { findRecord, ventureAction } from '../../records.ts';
import type { DeliveryRunRecord, DeliveryRunView, HarnessState, VentureDeps } from '../../contracts.ts';
import { carryControls, stampOwnerWords, stoppedNow, STOPPED_BY_YOU } from './controls.ts';

/** The repair turn's words to the agent, in Chausar's own words, with what could not be read. */
export const REPAIR_LINE = (reason: string): string => `Your last answer could not be read: ${reason} Answer again in the same shape.`;
/** Why a run fails when the repair turn came back in a bad shape too. */
export const REPAIRED_TWICE = (reason: string): string => `Your AI answered twice in a shape Chausar could not read: ${reason}`;

const sentence = (text: string) => { const words = text.replace(/\s+/g, ' ').trim().slice(0, 300); return /[.!?]$/.test(words) ? words : `${words}.`; };

/** The repair words the act turn carries: only the turn being repaired, once. */
export function repairWords(state: Pick<HarnessState, 'phase' | 'repairs' | 'used'>): string | null {
  if (state.phase !== 'act') return null;
  const open = (state.repairs ?? []).find(item => item.turn === state.used.turns + 1);
  return open ? REPAIR_LINE(open.reason) : null;
}

/** What a failed call cost, from its call record: the provider's usage when it reported one; '0' when none was kept. */
function callCost(deps: VentureDeps, callId: string): bigint {
  const call = deps.store.read().conversations.find((record: { id?: unknown } | null) => record?.id === callId) as { costMicros?: unknown } | undefined;
  return typeof call?.costMicros === 'string' && /^\d{1,18}$/.test(call.costMicros) ? BigInt(call.costMicros) : 0n;
}

/**
 * After an approved act turn's answer was refused for its shape (MODEL_OUTPUT_REJECTED): the call went out and came
 * back, so the journal says so (answered). The first time for this turn, the run gets its repair turn: previewed and
 * stored, waiting for the owner's approval; the view is returned. The second time, the run fails with that reason and
 * null is returned, so the caller throws the error as before. Any other error, or a write turn, returns null untouched.
 */
export async function repairTurn(deps: VentureDeps, ctx: Context, run: DeliveryRunRecord, harness: HarnessState, callId: string, error: unknown, answered?: () => void): Promise<DeliveryRunView | null> {
  const code = (error as { code?: unknown } | null)?.code;
  if (harness.phase !== 'act' || code !== 'MODEL_OUTPUT_REJECTED') return null;
  answered?.();
  const reason = sentence(error instanceof Error ? error.message : 'The answer was not in the expected shape.');
  const turn = harness.used.turns + 1;
  const cost = callCost(deps, callId);
  const spent = (state: HarnessState): HarnessState => ({ ...state, used: { ...state.used, costMicros: String(BigInt(state.used.costMicros) + cost) } });
  if ((harness.repairs ?? []).some(item => item.turn === turn)) {
    await ventureAction(deps, ctx, 'approve', 'delivery.failed', tx => {
      const current = tx.find('venture-delivery-run', run.id);
      if (!current || current.status !== 'waiting-for-you' || current.callId !== callId || !current.harness) return;
      // The run's error reads the repair's reason, not the call's: the call is settled on the journal.
      tx.replace({ ...current, status: 'failed', callId: null, preview: null, harness: { ...spent(current.harness), stopReason: REPAIRED_TWICE(reason) } });
      tx.emit('run.failed', { runId: run.id });
    }).catch(() => undefined);
    return null;
  }
  const { readAs } = await import('../shared.ts');
  const { previewNextTurn, runView } = await import('../runs.ts');
  const { state, venture } = readAs(deps, ctx, 'approve');
  const live = findRecord(state, 'venture-delivery-run', run.id);
  check(live && live.status === 'waiting-for-you' && live.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
  vaRunCurrent(state,venture.id,live);
  const repaired: HarnessState = { ...spent(harness), repairs: [...(harness.repairs ?? []), { turn, reason }] };
  const made = await previewNextTurn(deps, ctx, state, venture, live, repaired);
  return ventureAction(deps, ctx, 'approve', 'delivery.repair', tx => {
    const current = tx.find('venture-delivery-run', run.id);
    check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
    vaRunCurrent(tx.state,venture.id,current);
    // What the owner changed while the call was out (a stop, a note, the gate) joins the repaired state (4F1).
    const merged = carryControls(made.harness!, current.harness);
    const stopping = !!merged.control?.stop;
    const stored: DeliveryRunRecord = stopping
      ? { ...current, status: 'stopped', callId: null, preview: null, harness: stoppedNow(merged, tx.now, STOPPED_BY_YOU) }
      : { ...current, callId: made.preview.callId, preview: made.preview, harness: stampOwnerWords(merged, made.harness!, made.preview.callId) };
    tx.replace(stored);
    if (stopping) tx.emit('run.stopped', { runId: stored.id });
    else tx.emit('delivery-waiting', { runId: stored.id, orderId: stored.orderId, practice: stored.practice });
    tx.emit('run.step', { runId: stored.id });
    if (!stopping) tx.emit('run.waiting', { runId: stored.id });
    return runView(stored, tx.venture!, Date.parse(tx.now), tx.state);
  });
}
