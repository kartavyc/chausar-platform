// Chausar delivery harness: the gate again, just before an approved action applies (W1 H13). Between the owner's
// approval and the moment an action runs, things can change: the order is cancelled, the client is gone, the business
// moves down a stage, the text changes, or the run or the month runs out of room. So just before it applies, the facts
// are read again from the vault, never taken from the approval, and checked once more. A deny cancels the action and
// says why: a send's reason lands in the action journal, a tool call's in the run's own record of its calls.
// The re-check before an approved call follows eve (Apache-2.0, packages/eve/src/harness/approval-recheck.ts), and
// caps re-read when a change applies follow the guardrail gate of Shopify's claude-for-commerce-examples (Apache-2.0,
// merchant/api/staging.py). This is a rewrite, not a copy.
import { ChausarError, type State } from '../../../contracts.ts';
import { findRecord, formatMicros } from '../../records.ts';
import type { DeliveryRunRecord, LaunchStage, MicroString, OrderRecord, VentureDeps } from '../../contracts.ts';
import { monthSpendNow } from '../../money/spend.ts';
import { agentStage } from '../runs.ts';
import { currentPlaybook, playbookLimits } from '../playbook.ts';
import { runCapMicros } from './loop.ts';

/** Why the gate said no this time, in plain words, with a stable code. */
export type Denial = { code: string; reason: string };

/** What the gate reads again, as the vault says it now. */
export type ApplyFacts = {
  /** The digest the owner approved, and the digest of what would run now (null: it no longer waits). Null approved: no digest binds it. */
  approvedDigest: string | null;
  currentDigest: string | null;
  /** The order the run works for (null: gone), and whether its client is still on file. */
  order: Pick<OrderRecord, 'status'> | null;
  clientOnFile: boolean;
  stage: LaunchStage;
  /** The run's own cap: what it spent so far and its cap with every window the owner allowed. Null: not an agent run. */
  run: { usedMicros: MicroString; capMicros: MicroString } | null;
  /** The monthly limit as set now (null: none) and what this month spent or holds. */
  month: { capMicros: MicroString | null; spentMicros: MicroString };
  /** The most the action can cost; '0' for one that costs nothing. */
  callMicros: MicroString;
};

const RECHECK_FAILED = 'The check before this ran could not finish, so it was stopped. Nothing was sent.';

/** The gate again, on facts read now. Null lets the action apply; a denial cancels it with its reason. */
export function recheckBeforeApply(facts: ApplyFacts): Denial | null {
  if (facts.approvedDigest !== null && facts.currentDigest !== facts.approvedDigest) {
    return { code: 'APPROVAL_STALE', reason: 'This changed after you approved it, so it was stopped. Read it again.' };
  }
  if (!facts.order || facts.order.status === 'cancelled') return { code: 'ORDER_NOT_ACTIVE', reason: 'The order was cancelled after you approved this, so it was stopped.' };
  if (!facts.clientOnFile) return { code: 'CLIENT_NOT_ACTIVE', reason: 'The client for this order is no longer on file, so it was stopped.' };
  // The stage may have moved either way: down to rehearsal, or up past where an agent waits for each approval.
  if (!agentStage(facts.stage)) return { code: 'LAUNCH_STAGE_BLOCKED', reason: "The business's launch stage changed after you approved this, so it was stopped." };
  const call = BigInt(facts.callMicros);
  if (facts.run && BigInt(facts.run.usedMicros) + call > BigInt(facts.run.capMicros)) {
    return { code: 'RUN_CAP_REACHED', reason: `This would take the run past its spend cap of ${formatMicros(facts.run.capMicros)}, so it was stopped. Allow more spend for this run on Today to go on.` };
  }
  if (call > 0n && facts.month.capMicros !== null && BigInt(facts.month.spentMicros) + call > BigInt(facts.month.capMicros)) {
    return { code: 'SPEND_CAP', reason: `This could take this month's spend past your limit of ${formatMicros(facts.month.capMicros)}, so it was stopped. Raise the limit or wait for next month.` };
  }
  return null;
}

/**
 * The run's cap as set now: the smaller of the run's own snapshot and the limit of the playbook in force, so a limit
 * the owner lowered since the run started counts, plus every window the owner allowed on Today.
 */
function capNow(state: State, ventureId: string, run: DeliveryRunRecord): MicroString {
  const harness = run.harness!;
  const venture = findRecord(state, 'venture-record', ventureId);
  const playbook = venture ? currentPlaybook(state, venture) : null;
  const snapshot = BigInt(harness.limits.maxCostMicros);
  const now = playbook ? BigInt(playbookLimits(playbook).maxCostMicros) : snapshot;
  return String(runCapMicros({ limits: { ...harness.limits, maxCostMicros: String(now < snapshot ? now : snapshot) }, capWindows: harness.capWindows }));
}

/** The facts for an action of one delivery run, read from a state snapshot taken now. */
function runFacts(state: State, ventureId: string, run: DeliveryRunRecord | undefined, action: Pick<ApplyFacts, 'approvedDigest' | 'currentDigest' | 'callMicros'>, nowIso: string): ApplyFacts {
  const mine = run && run.ventureId === ventureId ? run : undefined;
  const order = mine ? findRecord(state, 'venture-order', mine.orderId) : undefined;
  const live = order && order.ventureId === ventureId ? order : undefined;
  const client = live ? findRecord(state, 'venture-client', live.clientId) : undefined;
  const venture = findRecord(state, 'venture-record', ventureId);
  return {
    ...action, order: live ? { status: live.status } : null, clientOnFile: !!client && client.ventureId === ventureId, stage: venture?.launchStage ?? 'rehearsal',
    run: mine?.harness ? { usedMicros: mine.harness.used.costMicros, capMicros: capNow(state, ventureId, mine) } : null,
    month: monthSpendNow(state, ventureId, nowIso),
  };
}

/**
 * Just before an approved send to the owner's AI: the run must still wait on that same call with the text the owner
 * approved, and the order, the client, the stage, the run's cap and the monthly limit are read again. Throws the deny,
 * so the journal entry for the send is closed as rejected with its reason and nothing is sent. A check that cannot
 * finish is a refusal too (RECHECK_FAILED), never a send whose outcome is unknown.
 */
export function recheckSend(deps: VentureDeps, ventureId: string, runId: string, callId: string, approvedDigest: string): void {
  let denial: Denial | null;
  try {
    const state = deps.store.read();
    const run = findRecord(state, 'venture-delivery-run', runId);
    const waiting = run && run.status === 'waiting-for-you' && run.callId === callId ? run.preview : null;
    denial = recheckBeforeApply(runFacts(state, ventureId, run, { approvedDigest, currentDigest: waiting?.digest ?? null, callMicros: waiting?.estimatedMaxCostMicros ?? '0' }, deps.clock().toISOString()));
  } catch {
    denial = { code: 'RECHECK_FAILED', reason: RECHECK_FAILED };
  }
  if (denial) throw new ChausarError(denial.code, denial.reason);
}

/**
 * Just before a tool call an approval let through, or a heavy-work start: the order, the client, the stage and the
 * run's cap, read again. The call itself costs nothing here, so only a run already past its cap is stopped by it.
 */
export function recheckRun(deps: VentureDeps, ventureId: string, runId: string): Denial | null {
  const state = deps.store.read();
  return recheckBeforeApply(runFacts(state, ventureId, findRecord(state, 'venture-delivery-run', runId), { approvedDigest: null, currentDigest: null, callMicros: '0' }, deps.clock().toISOString()));
}
