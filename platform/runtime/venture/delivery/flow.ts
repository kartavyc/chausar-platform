// Chausar venture launcher, delivery (Ink v2 wave 4, package 4J12, catalogue H23): how a playbook's steps lead on to
// each other. A step may name an edge for each outcome (done, failed, blocked, timeout), a cap on how many times the
// run may come back to it and what happens past the cap, a timeout with an ordered list of steps to fail over to, and,
// on an approval step, a gate that ends the run with its default (blocked or failed, never approved) when the owner
// has not decided in time. The run may have a deadline. A step with no edge for its outcome keeps today's behaviour:
// done goes on to the next step in the list, anything else ends the run. validateFlow (called by validatePlaybook)
// refuses an edge to a missing step, a loop that no cap or approval step breaks (PLAYBOOK_CYCLE_UNCAPPED), and any path
// that reaches an outside step without the owner's approval: only an approval step's done counts as approved, an edge
// or fail-over into an outside step comes only from that done, and an approval step times out only through its gate.
// An optional step (skipped under budget pressure, 4F2) is never an approval, a check or an outside step, never breaks
// a loop, and its skip is walked as an edge too. advanceFlow and walkFlow work a run's path out from step
// outcomes, numbering each attempt. Shipped playbooks get edges in W5 (spec 5.8): no shipped step has one in W4.
// The shape follows Beeline's workflow contracts (docs/workflows/README.md, MIT); this is a rewrite, not a copy.
import { ChausarError, check } from '../../contracts.ts';
import type { HarnessLimits, PlaybookStep, StepEdge } from '../contracts.ts';

export const EDGE_OUTCOMES: readonly StepEdge['on'][] = ['done', 'failed', 'blocked', 'timeout'];
/** The most times a run may come back to one step. */
export const MAX_LOOPS = 5;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 7 * 24 * 3_600_000;
const MIN_DEADLINE_MS = 60_000;
const MAX_DEADLINE_MS = 30 * 24 * 3_600_000;
/** A flow never walks more steps than this, whatever the outcomes say (a guard, not a rule a playbook meets). */
const MAX_FLOW_ENTRIES = 400;

/** Why a gated approval step ended the run. */
export const GATE_TIMEOUT_LINE = 'You did not decide in time, so the run stopped here. Nothing was approved for you.';
/** Why a run past its deadline ended. */
export const DEADLINE_LINE = 'The run passed its deadline, so it stopped before the next step.';

const refuse = (message: string): never => { throw new ChausarError('INVALID_VENTURE_REQUEST', message); };
const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/**
 * Where a step may lead, by index: its edges, its fail-over list, and the next step in the list when done has no edge;
 * past an optional step too, since it may be skipped. approves: the move is an approval step's done, the only move
 * that counts as the owner's approval.
 */
function moves(steps: readonly PlaybookStep[], index: number): { to: number; approves: boolean }[] {
  const step = steps[index];
  const at = new Map(steps.map((item, place) => [item.id, place]));
  const approving = step.kind === 'approve';
  const out = [
    ...(step.next ?? []).map(edge => ({ to: at.get(edge.to)!, approves: approving && edge.on === 'done' })),
    ...(step.failover ?? []).map(to => ({ to: at.get(to)!, approves: false })),
  ];
  if (!(step.next ?? []).some(edge => edge.on === 'done') && index + 1 < steps.length) out.push({ to: index + 1, approves: approving });
  // A skipped optional step leads on to the step after it, as many as are optional in a row.
  for (let item = 0; item < out.length; item += 1) {
    const { to, approves } = out[item];
    if (steps[to].optional && to + 1 < steps.length && !out.some(move => move.to === to + 1 && move.approves === approves)) out.push({ to: to + 1, approves });
  }
  return out;
}

/**
 * A step that breaks a loop: one with a cap on coming back, or an approval step, where the owner decides each time. An
 * optional step never does: it may be skipped.
 */
const breaksLoop = (step: PlaybookStep): boolean => !step.optional && (step.maxLoops !== undefined || step.kind === 'approve');
/** Kinds that always run: the owner's approval, the checks, and the outside step. */
const NEVER_OPTIONAL: readonly PlaybookStep['kind'][] = ['approve', 'verify', 'operator'];

/**
 * Checks one step's edge fields; the step's other fields are validatePlaybook's. kinds: every step's kind by id, so an
 * edge or fail-over into an outside step is refused unless it is an approval step's done.
 */
function checkStepFields(step: PlaybookStep, kinds: ReadonlyMap<string, PlaybookStep['kind']>): void {
  const id = step.id;
  const ids = { has: (to: string) => kinds.has(to) };
  const outside = (to: string) => `The step ${to} acts outside Chausar, so only the done of a step you approve may lead to it; ${id} is not that.`;
  if (step.optional !== undefined) {
    check(typeof step.optional === 'boolean', 'INVALID_VENTURE_REQUEST', `The step ${id} is optional or not: say true or false.`);
    if (step.optional && NEVER_OPTIONAL.includes(step.kind)) refuse(`The step ${id} always runs: approvals, checks and outside steps are never skipped.`);
  }
  if (step.kind === 'approve' && (step.timeoutMs !== undefined || step.failover !== undefined || (Array.isArray(step.next) && step.next.some(edge => edge?.on === 'timeout')))) {
    refuse(`The step ${id} waits for you; its gate is the only way it times out, and that never approves.`);
  }
  if (step.next !== undefined) {
    check(Array.isArray(step.next) && step.next.length <= EDGE_OUTCOMES.length, 'INVALID_VENTURE_REQUEST', `The step ${id} has an unreadable list of edges.`);
    const seen = new Set<string>();
    for (const edge of step.next) {
      check(edge && typeof edge === 'object' && EDGE_OUTCOMES.includes(edge.on) && typeof edge.to === 'string', 'INVALID_VENTURE_REQUEST', `The step ${id} has an edge Chausar can't read.`);
      if (seen.has(edge.on)) refuse(`The step ${id} has two edges for ${edge.on}.`);
      seen.add(edge.on);
      check(ids.has(edge.to), 'STEP_NOT_FOUND', `The step ${id} leads to ${edge.to}, which is not in this playbook.`);
      if (kinds.get(edge.to) === 'operator' && !(step.kind === 'approve' && edge.on === 'done')) refuse(outside(edge.to));
    }
  }
  if (step.maxLoops !== undefined && !isInt(step.maxLoops, 1, MAX_LOOPS)) refuse(`The step ${id} may come back between 1 and ${MAX_LOOPS} times.`);
  if (step.onExceeded !== undefined) {
    if (step.maxLoops === undefined) refuse(`The step ${id} says what happens past its cap, but has no cap.`);
    if (step.onExceeded !== 'blocked' && step.onExceeded !== 'failed') refuse(`Past its cap, the step ${id} can end the run blocked or failed.`);
  }
  if (step.timeoutMs !== undefined && !isInt(step.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)) refuse(`The step ${id} needs a timeout between a second and seven days.`);
  if (step.failover !== undefined) {
    check(Array.isArray(step.failover) && step.failover.length >= 1 && step.failover.length <= 3, 'INVALID_VENTURE_REQUEST', `The step ${id} may fail over to one to three steps.`);
    if (step.timeoutMs === undefined) refuse(`The step ${id} fails over only when it runs out of time, so it needs a timeout.`);
    if (new Set(step.failover).size !== step.failover.length) refuse(`The step ${id} names one fail-over step twice.`);
    for (const to of step.failover) {
      check(typeof to === 'string', 'INVALID_VENTURE_REQUEST', `The step ${id} has a fail-over Chausar can't read.`);
      if (to === id) refuse(`The step ${id} can't fail over to itself.`);
      check(ids.has(to), 'STEP_NOT_FOUND', `The step ${id} fails over to ${to}, which is not in this playbook.`);
      if (kinds.get(to) === 'operator') refuse(outside(to));
    }
  }
  if (step.gate !== undefined) {
    if (step.kind !== 'approve') refuse(`Only a step you approve has a gate; ${id} is not one.`);
    check(step.gate && typeof step.gate === 'object' && isInt(step.gate.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS), 'INVALID_VENTURE_REQUEST', `The gate on ${id} needs a time between a second and seven days.`);
    if (step.gate.default !== 'blocked' && step.gate.default !== 'failed') refuse(`When time runs out, the gate on ${id} ends the run blocked or failed. It never approves for you.`);
  }
}

/** A loop among the steps that no cap or approval step breaks, as the ids in it, or null. */
function uncappedLoop(steps: readonly PlaybookStep[]): string[] | null {
  const open = steps.map(step => !breaksLoop(step));
  const colour = steps.map(() => 0); // 0 not seen, 1 on the path, 2 done
  const path: number[] = [];
  const visit = (at: number): string[] | null => {
    colour[at] = 1;
    path.push(at);
    for (const { to: next } of moves(steps, at)) {
      if (!open[next]) continue;
      if (colour[next] === 1) return path.slice(path.indexOf(next)).map(item => steps[item].id);
      if (colour[next] === 0) {
        const found = visit(next);
        if (found) return found;
      }
    }
    path.pop();
    colour[at] = 2;
    return null;
  };
  for (let at = 0; at < steps.length; at += 1) {
    if (!open[at] || colour[at] !== 0) continue;
    const found = visit(at);
    if (found) return found;
  }
  return null;
}

/**
 * An outside step a run can reach from its first step without the owner's approval, or null. The walk is over (step,
 * approved) pairs: only an approval step's done sets approved, and an approval step that fails, is skipped or goes
 * anywhere by another outcome does not. Leaving an outside step clears it, so a loop back to the outside step goes
 * through the approval again.
 */
function unapprovedOutside(steps: readonly PlaybookStep[]): string | null {
  const key = (at: number, approved: boolean) => at * 2 + (approved ? 1 : 0);
  const seen = new Set<number>([key(0, false)]);
  const queue: [number, boolean][] = [[0, false]];
  while (queue.length) {
    const [at, approved] = queue.shift()!;
    if (steps[at].kind === 'operator' && !approved) return steps[at].id;
    for (const move of moves(steps, at)) {
      // One approval covers one pass of the outside step: leaving it, the run needs the owner's approval again.
      const next: [number, boolean] = [move.to, move.approves || (approved && steps[at].kind !== 'operator')];
      if (!seen.has(key(...next))) { seen.add(key(...next)); queue.push(next); }
    }
  }
  return null;
}

/**
 * Checks a playbook's edges (validatePlaybook calls it after each step's own checks, with every id known): each step's
 * edge fields, then the graph. Refuses an edge or fail-over to a missing step (STEP_NOT_FOUND), a loop no cap or
 * approval step breaks (PLAYBOOK_CYCLE_UNCAPPED), a path to an outside step that skips the owner's approval, and a run
 * deadline out of range. A playbook with no edges passes unchanged: its steps run in their order, as before.
 */
export function validateFlow(steps: readonly PlaybookStep[], limits?: Pick<HarnessLimits, 'deadlineMs'>): void {
  const kinds = new Map(steps.map(step => [step.id, step.kind]));
  for (const step of steps) checkStepFields(step, kinds);
  if (limits?.deadlineMs !== undefined && !isInt(limits.deadlineMs, MIN_DEADLINE_MS, MAX_DEADLINE_MS)) refuse('A run deadline is between a minute and thirty days.');
  const loop = uncappedLoop(steps);
  if (loop) {
    throw new ChausarError('PLAYBOOK_CYCLE_UNCAPPED', `The steps ${loop.join(', ')} go round in a loop with no cap and no approval step. Give one of them a cap, or put a step you approve in the loop.`);
  }
  const outside = unapprovedOutside(steps);
  if (outside) refuse(`The step ${outside} acts outside Chausar, and an edge reaches it before you approve.`);
}

// ---------------------------------------------------------------------------
// Walking a run's path
// ---------------------------------------------------------------------------

/** What one attempt at a step came to. blocked always says why. */
export type StepOutcome = { outcome: 'done' } | { outcome: 'failed'; reason?: string } | { outcome: 'blocked'; reason: string } | { outcome: 'timeout' };
/** How a run's path ended: on which step, and why when it did not end done. */
export type FlowEnd = { state: 'done' | 'blocked' | 'failed'; reason: string | null; stepId: string | null };
/** One attempt at a step, numbered from 1 for each step; outcome is null while the attempt is going on. */
export type FlowEntry = { stepId: string; attempt: number; outcome: StepOutcome['outcome'] | null };
/** Where a run's path is: the step it is on, the attempts and timeouts so far, every attempt in order, and its end. */
export type FlowState = {
  stepId: string | null;
  attempts: Record<string, number>;
  timeouts: Record<string, number>;
  trail: FlowEntry[];
  startedAt: number;
  deadlineAt: number | null;
  end: FlowEnd | null;
};

/** A run's path at its start: on the first step, attempt 1. deadlineMs (the playbook's limits) sets the deadline. */
export function startFlow(steps: readonly PlaybookStep[], limits: Pick<HarnessLimits, 'deadlineMs'> | undefined, startedAt: number): FlowState {
  check(steps.length >= 1, 'INVALID_VENTURE_REQUEST', 'A playbook needs at least one step.');
  const first = steps[0].id;
  return {
    stepId: first, attempts: { [first]: 1 }, timeouts: {}, trail: [{ stepId: first, attempt: 1, outcome: null }], startedAt,
    deadlineAt: limits?.deadlineMs === undefined ? null : startedAt + limits.deadlineMs, end: null,
  };
}

const ended = (flow: FlowState, state: FlowEnd['state'], reason: string | null, stepId: string | null): FlowState => ({ ...flow, stepId: null, end: { state, reason, stepId } });

/**
 * The path after the current attempt's outcome, as a new state (the one given is not changed). The step's edge for
 * the outcome decides the next step; with none, done goes on down the list and anything else ends the run. A timeout
 * fails over to the step's next fail-over step in order, then takes its timeout edge, then ends the run failed; on a
 * gated approval step it ends the run with the gate's default. Coming back to a step past its cap ends the run with
 * its onExceeded (blocked unless it says failed); a run past its deadline ends blocked before the next step.
 */
export function advanceFlow(steps: readonly PlaybookStep[], flow: FlowState, result: StepOutcome, nowMs: number): FlowState {
  check(!flow.end && flow.stepId !== null, 'INVALID_VENTURE_REQUEST', 'This run has ended.');
  const at = steps.findIndex(item => item.id === flow.stepId);
  check(at >= 0, 'STEP_NOT_FOUND', 'That step was not found.');
  const step = steps[at];
  check(result && typeof result === 'object' && EDGE_OUTCOMES.includes(result.outcome), 'INVALID_VENTURE_REQUEST', 'A step ends done, failed, blocked or out of time.');
  const reason = 'reason' in result && typeof result.reason === 'string' ? result.reason.trim() : '';
  if (result.outcome === 'blocked') check(reason.length > 0 && reason.length <= 300, 'INVALID_VENTURE_REQUEST', 'A blocked step must say why, in up to 300 characters.');
  const trail = flow.trail.map((entry, index) => (index === flow.trail.length - 1 ? { ...entry, outcome: result.outcome } : entry));
  const timeouts = { ...flow.timeouts };
  const done: FlowState = { ...flow, trail, timeouts };
  const edge = (on: StepEdge['on']) => (step.next ?? []).find(item => item.on === on)?.to ?? null;
  let to: string | null;
  if (result.outcome === 'timeout') {
    if (step.gate) return ended(done, step.gate.default, GATE_TIMEOUT_LINE, step.id);
    const tried = timeouts[step.id] ?? 0;
    timeouts[step.id] = tried + 1;
    to = step.failover?.[tried] ?? edge('timeout');
    if (!to) return ended(done, 'failed', `The step ${step.id} ran out of time.`, step.id);
  } else {
    to = edge(result.outcome);
    if (!to) {
      if (result.outcome === 'done') {
        if (at + 1 >= steps.length) return ended(done, 'done', null, step.id);
        to = steps[at + 1].id;
      } else {
        return ended(done, result.outcome, reason || `The step ${step.id} failed.`, step.id);
      }
    }
  }
  if (done.deadlineAt !== null && nowMs > done.deadlineAt) return ended(done, 'blocked', DEADLINE_LINE, step.id);
  const target = steps.find(item => item.id === to);
  check(target, 'STEP_NOT_FOUND', `The step ${to} is not in this playbook.`);
  const before = done.attempts[target.id] ?? 0;
  if (before > 0 && target.maxLoops !== undefined && before > target.maxLoops) {
    return ended(done, target.onExceeded ?? 'blocked', `The run came back to ${target.id} ${target.maxLoops} ${target.maxLoops === 1 ? 'time' : 'times'}, its limit.`, step.id);
  }
  return { ...done, stepId: target.id, attempts: { ...done.attempts, [target.id]: before + 1 }, trail: [...trail, { stepId: target.id, attempt: before + 1, outcome: null }] };
}

/**
 * Walks a run's whole path from its start, asking decide for each attempt's outcome (a rehearsal, or a test). now:
 * the time each outcome is taken at, the start by default. Stops at the end, or at a guard on the number of attempts.
 */
export function walkFlow(steps: readonly PlaybookStep[], decide: (stepId: string, attempt: number) => StepOutcome, options: { startedAt: number; limits?: Pick<HarnessLimits, 'deadlineMs'>; now?: (entries: number) => number }): FlowState {
  let flow = startFlow(steps, options.limits, options.startedAt);
  while (!flow.end) {
    check(flow.trail.length <= MAX_FLOW_ENTRIES, 'INVALID_VENTURE_REQUEST', 'This run went round too many times.');
    const current = flow.trail[flow.trail.length - 1];
    flow = advanceFlow(steps, flow, decide(current.stepId, current.attempt), options.now ? options.now(flow.trail.length) : options.startedAt);
  }
  return flow;
}
