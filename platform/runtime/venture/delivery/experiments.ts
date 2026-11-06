// Chausar delivery (Ink v2 wave 4, package 4J16, catalogue Q16): each change an improvement run tries is recorded as
// an experiment, by code: one hypothesis, one change, a control (the old version rehearsed on the same practice cases,
// and the window of signals they came from), a budget cap, and the stop and roll-back rules the run keeps to. Only an
// experiment with a real control may say what the change did; without one (built-in templates write the same draft for
// both versions) the result reads "observed only". Candidates are reviewed at most N at a time, oldest first, and a
// change that was tried against a real control and did not help is not tried again until its retry spacing has passed
// (improve.ts reads both). Learning still never changes the playbook in use: a kept candidate waits for the owner to
// adopt it, and the owner can go back with one tap (improve.ts rollback).
// Ideas taken, code written here: sealeap-ecommerce-skills assets/experiment-template.md; odysseus
// docs/skills-lifecycle.md (review at most N candidates, oldest first, with retry spacing; idea only).
import type { State } from '../../contracts.ts';
import type { ExperimentControl, ExperimentLift, ExperimentRecord, GateResult, IsoTime, PlaybookPatch, SignalRecord } from '../contracts.ts';
import { liftOf } from './lift.ts';
import { formatMicros, listRecords } from '../records.ts';
import { rupeesBeside, type Rupees } from '../money/spend.ts';

export type { ExperimentControl, ExperimentRecord };

/** The most one improvement run may spend on model calls, in micro-dollars (USD 2.00); it stops when it gets there. */
export const EXPERIMENT_BUDGET_MICROS = '2000000';
/** At most this many signals are reviewed by one run, oldest first. */
export const EXPERIMENT_CANDIDATES = 20;
/** A change that was tried against a real control and did not help waits this long before it is tried again. */
export const RETRY_SPACING_DAYS = 7;
const DAY_MS = 86_400_000;

/** An amount in micro-dollars as the owner reads it: rupees at their rate, with the rate; USD only without one. */
export function budgetWords(micros: string, rupees: Rupees | null): string {
  return rupeesBeside(micros, rupees) ?? formatMicros(micros);
}

/** Whether what was spent reached the cap. */
export function budgetReached(spentMicros: string, capMicros: string = EXPERIMENT_BUDGET_MICROS): boolean {
  return BigInt(spentMicros) >= BigInt(capMicros);
}

/**
 * The result in words. With a control it says what the change did on the same practice cases, and that it made no
 * difference when no case was won or lost; without one it says only that something was observed, and nothing about
 * what the change did.
 */
export function experimentResult(control: Pick<ExperimentControl, 'kind' | 'cases'> | null, gate: Pick<GateResult, 'wins' | 'losses' | 'ties'> | null): ExperimentRecord['result'] {
  if (!control || !gate) return { kind: 'observed', line: 'Observed only: there was no control, so this cannot tell what the change did on its own.' };
  if (gate.wins === 0 && gate.losses === 0) return { kind: 'no-effect', line: `With the old version as the control, the change made no difference on the same ${control.cases} practice cases.` };
  return {
    kind: 'caused',
    line: `With the old version as the control on the same ${control.cases} practice cases, the change won ${gate.wins}, lost ${gate.losses} and tied ${gate.ties}.`,
  };
}

/** The window of the signals the run read: the oldest and the newest, or the run's start when there were none. */
export function signalWindow(signals: readonly Pick<SignalRecord, 'at'>[], startedAt: IsoTime): { from: IsoTime; to: IsoTime } {
  const times = signals.map(signal => signal.at).sort();
  return { from: times[0] ?? startedAt, to: times.at(-1) ?? startedAt };
}

/**
 * The experiment one gated round ran: its patch and hypothesis, the control (unless both versions wrote the same
 * drafts), the budget with what the run had spent by then, and the rules it keeps to.
 */
export function experimentOf(input: {
  patch: PlaybookPatch; change: string; parentHash: string; gate: GateResult | null; sameDrafts: boolean;
  window: { from: IsoTime; to: IsoTime }; spentMicros: string; maxRounds: number;
  /** This run's cap (the default unless the owner set a lower one) and the owner's rupee rate, when set. */
  capMicros?: string; rupees?: Rupees | null;
}): ExperimentRecord {
  const cap = input.capMicros ?? EXPERIMENT_BUDGET_MICROS;
  const rupees = input.rupees ?? null;
  const control: ExperimentControl | null = input.gate && !input.sameDrafts
    ? { kind: 'parent-on-same-cases', playbookHash: input.parentHash, cases: input.gate.cases.length, window: input.window }
    : null;
  return {
    hypothesis: input.patch.note.hypothesis, change: input.change, patchId: input.patch.id, control,
    budget: { capMicros: cap, capDisplay: budgetWords(cap, rupees), spentMicros: input.spentMicros, spentDisplay: budgetWords(input.spentMicros, rupees) },
    stopRules: [
      `Stop when the run has spent its budget of ${budgetWords(cap, rupees)}, between practice episodes.`,
      `Stop after ${input.maxRounds} ${input.maxRounds === 1 ? 'round' : 'rounds'}.`,
      'Keep the old version when the change makes any case newly fail or adds a critical error.',
    ],
    rollbackRule: 'A kept change waits for you to adopt it; after that you can go back to the version it was made from with one tap.',
    result: experimentResult(control, input.gate),
    lift: control && input.gate ? experimentLift(input.gate) : null,
  };
}

/**
 * 4J22a (4J15's lift, Q12): with and without the change on the gate's own paired cases, by the exact McNemar test in
 * code (lift.ts). A gate case's pass may rest on the judge's answers, so every case counts as a model's: estimate is
 * true, and the screen labels a conclusion model estimate (once: the line leaves the sentence out). The digest is the
 * lift receipt's, kept for the record.
 */
function experimentLift(gate: GateResult): ExperimentLift {
  const result = liftOf(gate.cases.map(item => ({ id: `${item.set}:${item.scenarioId}`, without: item.parent.passed, with: item.candidate.passed, by: 'model' as const })));
  // The screen labels it model estimate once (estimate), so the line drops lift.ts's own model estimate sentence.
  const line = result.line.replace(/ Model estimate: a model judged whether each practice case passed\.$/, '');
  return { cases: result.cases, reachable: result.reachable, direction: result.direction, estimate: result.estimate, line, digest: result.receipt.digest };
}

/**
 * At most max items, oldest first, leaving out any tried within the spacing. An item: its id, when it arrived, and
 * when it was last tried (null when never).
 */
export function reviewQueue<T extends { id: string; at: IsoTime; triedAt: IsoTime | null }>(items: readonly T[], options: { max: number; now: number; spacingDays: number }): T[] {
  const waits = (item: T) => item.triedAt !== null && options.now - Date.parse(item.triedAt) < options.spacingDays * DAY_MS;
  return [...items].filter(item => !waits(item)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(0, Math.max(0, options.max));
}

/**
 * The reasons a change was tried for against a real control in an earlier improvement run, and kept the old version,
 * within the retry spacing, each with when it was tried: they wait. Template runs had no real control, so they count
 * for nothing.
 */
export function recentlyTried(state: State, ventureId: string, now: number): Map<string, IsoTime> {
  const tried = new Map<string, IsoTime>();
  for (const run of listRecords(state, 'venture-improvement-run', ventureId)) {
    for (const round of run.rounds) {
      const reason = round.diagnosis.chosen?.reason;
      if (!reason || !round.experiment?.control || round.gate?.decision !== 'keep-parent') continue;
      if (now - Date.parse(run.at) >= RETRY_SPACING_DAYS * DAY_MS) continue;
      if (!tried.has(reason) || tried.get(reason)! < run.at) tried.set(reason, run.at);
    }
  }
  return tried;
}

/** The plain words for an improvement run that tried nothing because every change waits its spacing. */
export function spacingReason(tried: ReadonlyMap<string, IsoTime>): string {
  const next = [...tried.values()].sort()[0];
  const date = next ? new Date(Date.parse(next) + RETRY_SPACING_DAYS * DAY_MS).toISOString().slice(0, 10) : null;
  return `Every change Chausar could try here was tried in the last ${RETRY_SPACING_DAYS} days against the old version and did not help${date ? `; it is tried again from ${date}` : ''}.`;
}
