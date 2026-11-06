// Chausar venture launcher, delivery package (Ink v2 wave 4, package 4J15, catalogue Q12): with and without a change.
// The same practice cases are rehearsed with and without a change (a playbook patch, a new version), each case passing
// or failing on both sides. Code pairs them, counts the cases only one side passed, and runs the exact McNemar test:
// a two-sided binomial test on those discordant cases, worked out in BigInt as a fraction, never a float. Below the
// significance the cases can reach at all (n discordant cases can give no p below 2 / 2^n), it says "Not enough
// practice cases to tell yet." and draws no conclusion. When a model judged the cases, the line says model estimate.
// Every answer carries its receipt: the rule, every case, the counts, the fraction and a digest over all of it.
// The exact test follows SkillEvaluator's tier3_report.py _mcnemar_exact_probability (Apache-2.0); a rewrite in
// TypeScript with BigInt, not a copy.
import { check } from '../../contracts.ts';
import { digest } from '../records.ts';
import type { Episode, SimulationRunRecord } from '../contracts.ts';

/** One practice case run without and with the change. by: who decided pass or fail ('model' when a judge answered). */
export type PairedCase = { id: string; without: boolean; with: boolean; by: 'code' | 'model' };
export type LiftReceipt = {
  rule: string;
  inputs: PairedCase[];
  steps: string[];
  result: { onlyWith: number; onlyWithout: number; pNumerator: string; pDenominator: string; alpha: string; significant: boolean };
  digest: string;
};
export type LiftResult = {
  cases: number; bothPassed: number; bothFailed: number; onlyWith: number; onlyWithout: number;
  /** Whether this many discordant cases could reach the significance at all. */
  reachable: boolean;
  significant: boolean;
  direction: 'better' | 'worse' | 'none';
  /** p rounded to three places, or null when it could not count. */
  pDisplay: string | null;
  estimate: boolean;
  line: string;
  receipt: LiftReceipt;
};

/** The significance: p at or below five in a hundred, compared as whole numbers. */
export const LIFT_ALPHA = Object.freeze({ numerator: 5n, denominator: 100n });
export const LIFT_NOT_ENOUGH = 'Not enough practice cases to tell yet.';
const RULE = 'Exact McNemar test, two-sided, on the paired cases where only one side passed.';
const MAX_CASES = 2000;

function whole(value: number, what: string): bigint {
  check(Number.isInteger(value) && value >= 0 && value <= MAX_CASES, 'INVALID_VENTURE_REQUEST', `${what} must be a whole number from 0 to ${MAX_CASES}.`);
  return BigInt(value);
}

/**
 * The exact two-sided McNemar p for b cases only the change passed and c only the old way passed:
 * min(1, 2 x the sum of C(n, i) for i from 0 to min(b, c), over 2^n), with n = b + c. A fraction in lowest form is not
 * promised; numerator and denominator are exact. With no discordant case p is one.
 */
export function mcnemarExact(onlyWith: number, onlyWithout: number): { numerator: bigint; denominator: bigint } {
  const b = whole(onlyWith, 'The cases only the change passed'), c = whole(onlyWithout, 'The cases only the old way passed');
  const n = b + c;
  if (n === 0n) return { numerator: 1n, denominator: 1n };
  const k = b < c ? b : c;
  let term = 1n, sum = 1n; // C(n, 0)
  for (let i = 1n; i <= k; i += 1n) {
    term = (term * (n - i + 1n)) / i;
    sum += term;
  }
  const numerator = 2n * sum, denominator = 1n << n;
  return numerator >= denominator ? { numerator: 1n, denominator: 1n } : { numerator, denominator };
}

/** Whether a p fraction is at or below the significance. */
function atOrBelowAlpha(p: { numerator: bigint; denominator: bigint }): boolean {
  return p.numerator * LIFT_ALPHA.denominator <= LIFT_ALPHA.numerator * p.denominator;
}

/** p to three places, half up, in whole-number arithmetic. */
function threePlaces(p: { numerator: bigint; denominator: bigint }): string {
  const thousandths = (p.numerator * 2000n + p.denominator) / (2n * p.denominator);
  return `${thousandths / 1000n}.${String(thousandths % 1000n).padStart(3, '0')}`;
}

const casesWord = (count: number) => `${count} practice ${count === 1 ? 'case' : 'cases'}`;

/**
 * The lift of a change on paired practice cases, worked out by code. Each case id counts once. Reachable only when
 * the discordant cases could give a p at or below the significance (2 / 2^n at best).
 */
export function liftOf(cases: readonly PairedCase[]): LiftResult {
  check(Array.isArray(cases) && cases.length <= MAX_CASES, 'INVALID_VENTURE_REQUEST', `Compare at most ${MAX_CASES} practice cases.`);
  const seen = new Set<string>();
  for (const item of cases) {
    check(typeof item?.id === 'string' && item.id.length >= 1 && item.id.length <= 120 && typeof item.without === 'boolean' && typeof item.with === 'boolean'
      && (item.by === 'code' || item.by === 'model'), 'INVALID_VENTURE_REQUEST', 'Each practice case needs an id, a pass or fail on each side, and who judged it.');
    check(!seen.has(item.id), 'INVALID_VENTURE_REQUEST', `The practice case ${item.id} is listed twice.`);
    seen.add(item.id);
  }
  const inputs = cases.map(item => ({ id: item.id, without: item.without, with: item.with, by: item.by }));
  const onlyWith = inputs.filter(item => item.with && !item.without).length;
  const onlyWithout = inputs.filter(item => item.without && !item.with).length;
  const bothPassed = inputs.filter(item => item.with && item.without).length;
  const bothFailed = inputs.length - onlyWith - onlyWithout - bothPassed;
  const n = onlyWith + onlyWithout;
  const p = mcnemarExact(onlyWith, onlyWithout);
  const best = n === 0 ? { numerator: 1n, denominator: 1n } : { numerator: 2n, denominator: 1n << BigInt(n) };
  const reachable = atOrBelowAlpha(best);
  const significant = reachable && atOrBelowAlpha(p);
  const direction = !significant ? 'none' : onlyWith > onlyWithout ? 'better' : 'worse';
  const pDisplay = reachable ? threePlaces(p) : null;
  const estimate = inputs.some(item => item.by === 'model');
  const counts = `${casesWord(onlyWith)} passed that failed without it, and ${onlyWithout} failed that passed without it (p about ${pDisplay})`;
  let line = !reachable ? LIFT_NOT_ENOUGH
    : direction === 'better' ? `With the change, ${counts}. The change likely helps.`
      : direction === 'worse' ? `With the change, ${counts}. The change likely makes it worse.`
        : `With the change, ${counts}. The change made no clear difference.`;
  if (estimate && reachable) line = `${line} Model estimate: a model judged whether each practice case passed.`;
  const steps = [
    `Paired ${inputs.length} practice cases by id.`,
    `Only with the change: ${onlyWith}. Only without it: ${onlyWithout}. Both passed: ${bothPassed}. Both failed: ${bothFailed}.`,
    n === 0 ? 'No case passed on one side only, so p is one.' : `p = min(1, 2 x the sum of C(${n}, i) for i from 0 to ${Math.min(onlyWith, onlyWithout)}, over 2^${n}) = ${p.numerator}/${p.denominator}.`,
    reachable ? `Compared with ${LIFT_ALPHA.numerator}/${LIFT_ALPHA.denominator}.` : `${n} discordant cases can give no p below 2/2^${n}, which is above ${LIFT_ALPHA.numerator}/${LIFT_ALPHA.denominator}.`,
  ];
  const body: Omit<LiftReceipt, 'digest'> = {
    rule: RULE, inputs, steps,
    result: { onlyWith, onlyWithout, pNumerator: String(p.numerator), pDenominator: String(p.denominator), alpha: `${LIFT_ALPHA.numerator}/${LIFT_ALPHA.denominator}`, significant },
  };
  return { cases: inputs.length, bothPassed, bothFailed, onlyWith, onlyWithout, reachable, significant, direction, pDisplay, estimate, line, receipt: { ...body, digest: digest(body) } };
}

/** Whether a judge answered on this episode (any answer but not-judged): then a model decided its pass or fail. */
function judgedByModel(episode: Pick<Episode, 'judge'>): boolean {
  return (episode.judge ?? []).some(answer => answer.answer !== 'not-judged');
}

/**
 * The practice cases two rehearsals share, paired by practice client and episode number, in the order of the run
 * with the change. A case either side lacks is left out. A case is the model's when a judge answered on either side.
 */
export function pairedCases(without: Pick<SimulationRunRecord, 'episodes'>, withChange: Pick<SimulationRunRecord, 'episodes'>): PairedCase[] {
  const key = (episode: Pick<Episode, 'scenarioId' | 'index'>) => `${episode.scenarioId}#${episode.index}`;
  const before = new Map(without.episodes.map(episode => [key(episode), episode]));
  const paired: PairedCase[] = [];
  for (const episode of withChange.episodes) {
    const old = before.get(key(episode));
    if (!old || paired.some(item => item.id === key(episode))) continue;
    paired.push({ id: key(episode), without: old.passed === true, with: episode.passed === true, by: judgedByModel(old) || judgedByModel(episode) ? 'model' : 'code' });
  }
  return paired;
}
