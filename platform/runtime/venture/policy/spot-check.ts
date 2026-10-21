// Chausar venture launcher, policy (P2-posture): spot checks at auto with spot checks.
// A fixed rule picks which runs the owner looks at: every Nth run of the agent at this posture, plus every run that
// spent more than a line. No chance is involved, so the same runs give the same picks. Every run at this posture gets
// one decision record, picked or not, so the count is plain; a picked run waits on Today until the owner reviews it.
import { check, type Context, type State } from '../../contracts.ts';
import { formatMicros, isAppChannel, listRecords, ventureAction, type VentureTx } from '../records.ts';
import type { MicroString, SpotCheckRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { AGENT_ID } from '../views/shared.ts';
import { effectivePosture } from './context.ts';

export type SpotCheckRule = { everyNth: number; overMicros: MicroString };
/** One run in five, and any run that spent more than USD 0.20 of model calls. */
export const SPOT_CHECK_RULE: Readonly<SpotCheckRule> = Object.freeze({ everyNth: 5, overMicros: '200000' });
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const inWords = (count: number) => NUMBER_WORDS[count - 1] ?? String(count);

export type SpotSample = { sampled: boolean; reason: SpotCheckRecord['reason']; line: string };

/** Whether the run with this ordinal and this spend is picked. The spend line wins when both pick it. */
export function sampleRun(ordinal: number, spendMicros: MicroString, rule: SpotCheckRule = SPOT_CHECK_RULE): SpotSample {
  check(Number.isInteger(ordinal) && ordinal >= 1, 'INVALID_VENTURE_REQUEST', 'A run count starts at one.');
  check(Number.isInteger(rule.everyNth) && rule.everyNth >= 1 && rule.everyNth <= 1000, 'INVALID_VENTURE_REQUEST', 'Check one run in at least one.');
  check(/^\d{1,30}$/.test(spendMicros) && /^\d{1,30}$/.test(rule.overMicros), 'INVALID_AMOUNT', 'Spend must be whole micro units.');
  const nth = inWords(rule.everyNth);
  if (BigInt(spendMicros) > BigInt(rule.overMicros)) {
    return { sampled: true, reason: 'over-spend', line: `This run spent ${formatMicros(spendMicros)}, more than ${formatMicros(rule.overMicros)}.` };
  }
  if (ordinal % rule.everyNth === 0) return { sampled: true, reason: 'every-nth', line: `One run in ${nth} is checked, and this is one.` };
  return { sampled: false, reason: null, line: `Not picked: not one run in ${nth}, and it spent no more than ${formatMicros(rule.overMicros)}.` };
}

/**
 * Records the spot-check decision for one run, inside the caller's write. Once per run: a second call returns the first
 * decision. Only at auto with spot checks; below it the owner approves each run anyway.
 */
export function recordSpotCheck(tx: VentureTx, input: { runId: string; spendMicros: MicroString; agentId?: string; rule?: SpotCheckRule }): SpotCheckRecord {
  const agentId = input.agentId ?? AGENT_ID;
  const existing = tx.list('venture-spot-check').find(record => record.runId === input.runId);
  if (existing) return existing;
  check(effectivePosture(tx.state, tx.venture!, agentId) === 'auto-spot-check', 'INVALID_VENTURE_REQUEST', 'Spot checks happen only at auto with spot checks.');
  const rule = { ...(input.rule ?? SPOT_CHECK_RULE) };
  const ordinal = tx.list('venture-spot-check').filter(record => record.agentId === agentId).length + 1;
  const sample = sampleRun(ordinal, input.spendMicros, rule);
  const record = tx.put<SpotCheckRecord>({
    ...tx.base('venture-spot-check'), runId: input.runId, agentId, ordinal, spendMicros: input.spendMicros, rule, ...sample, review: null,
  });
  if (record.sampled) tx.emit('queue.changed', { spotCheckId: record.id, runId: record.runId });
  return record;
}

/** Picked runs the owner has not reviewed, oldest first. Today shows each as a row. */
export function pendingSpotChecks(state: State, venture: VentureRecord): SpotCheckRecord[] {
  return listRecords(state, 'venture-spot-check', venture.id).filter(record => record.sampled && record.review === null);
}

/** The owner's review of a picked run (approve, inside the app). Once per run. */
export async function reviewSpotCheck(deps: VentureDeps, ctx: Context, id: string, verdict: 'looks-right' | 'needs-work'): Promise<SpotCheckRecord> {
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
  check(verdict === 'looks-right' || verdict === 'needs-work', 'INVALID_VENTURE_REQUEST', 'Choose looks right or needs work.');
  return ventureAction(deps, ctx, 'approve', 'spot.review', tx => {
    const record = tx.find('venture-spot-check', id);
    check(record && record.sampled && record.review === null, 'SPOT_CHECK_NOT_FOUND', 'That spot check is not waiting for you.');
    const reviewed = tx.replace<SpotCheckRecord>({ ...record, review: { verdict, by: ctx.memberId, at: tx.now } });
    tx.emit('queue.changed', { spotCheckId: id });
    return reviewed;
  });
}
