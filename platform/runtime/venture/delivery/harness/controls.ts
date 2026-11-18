// Chausar delivery harness (Ink v2 wave 4, package 4F1): the run controls on the loop's state. A stop the owner asked
// for is read from the vault between calls, so it works while a turn runs: the call in progress finishes and the rest
// of the turn is cancelled. The round gate decides after each round whether the run waits for the owner (every round,
// or every few, and at once on a limit, refused calls or failures in a row); three rounds that end the same way stop
// the run. The owner's words for the next turn (a steer note, or what they typed with Continue) go into that turn's
// input and are taken by the turn that runs with them, once. Whatever the owner changed while a turn ran (a stop, a
// note, the gate) is carried onto the state that turn made, so nothing the owner asked for is lost.
// Catalogue O1 to O3; the rules follow LongHorizon's gate (src/lh_harness/dashboard/gate.py) and pi-plans' review
// budget; this is a rewrite, not a copy.
import { findRecord, ventureAction } from '../../records.ts';
import type { Context } from '../../../contracts.ts';
import type { HarnessState, IsoTime, Json, RoundGate, RoundGateReason, VentureDeps } from '../../contracts.ts';
import { TURN_CHOICES } from './patches.ts';
import { STOP_LINES } from '../run-machine.ts';

/** The line on a call the owner's stop kept from starting. */
export const STOPPED_CALL = 'You stopped the run, so this call did not run.';
/** The run's line once the owner's stop took effect (the machine's own words, run-machine.ts STOP_LINES). */
export const STOPPED_BY_YOU = STOP_LINES.owner;
/** A2: what a run says when the idle-run watchdog stopped a quiet AI job (agent-runtime/runner.ts). */
export const QUIET_LINE = STOP_LINES.quiet;
/** A2 second review: what a run says when an AI job ran past the watchdog's time limit (agent-runtime/runner.ts). */
export const TIME_LINE = STOP_LINES.overtime;
/** Why the gate stopped a run that kept ending the same way. */
export const SAME_WAY_LINE = 'Stopped: three rounds ended the same way.';
/** Chausar's words to the agent when the owner's notes ride along. The notes themselves are the owner's words. */
export const OWNER_NOTES_LINE = "The owner's notes for this step are in ownerNotes, in the owner's own words. Follow them where the rules above allow.";
/** How often the round gate may ask: after every round, or every 2, 3 or 5 rounds. */
export const GATE_EVERY: readonly RoundGate['every'][] = Object.freeze([1, 2, 3, 5] as const);
/** The most turns a run may have, the largest of the playbook's turn choices: "Allow 2 more turns" never goes past it. */
const MAX_TURNS = Math.max(...TURN_CHOICES.map(Number));
/** Refusals before a call ran: a round made only of these is blocked, not failing. */
const REFUSED = new Set(['TOOL_DENIED', 'POLICY_DENIED', 'TIER_UNAVAILABLE']);

// ---------------------------------------------------------------------------
// The owner's words for the next turn
// ---------------------------------------------------------------------------

/** The owner's words waiting for the next turn: steer notes no turn has taken yet, then the gate's Continue words. */
export function ownerWords(state: Pick<HarnessState, 'steer' | 'gate'>): string[] {
  const notes = (state.steer ?? []).filter(note => note.pickedUpTurn === null).map(note => note.text);
  return state.gate?.ownerNote ? [...notes, state.gate.ownerNote] : notes;
}

/**
 * Puts the owner's waiting words into a turn's input and says so in Chausar's instructions. Nothing changes while
 * none wait, so the text the owner approves stays the same.
 */
export function withOwnerWords(instructions: string, state: HarnessState, input: Record<string, Json>): string {
  const words = ownerWords(state);
  if (!words.length) return instructions;
  input.ownerNotes = words;
  return `${instructions} ${OWNER_NOTES_LINE}`;
}

/**
 * The turn that ran took the owner's words its text carried: each note stamped with that turn's call says it was picked
 * up by it, and Continue's words (in every text while they wait) are used. A note no text of that call carried, such as
 * one sent while the turn was out or beside another note, stays waiting for the next turn.
 */
export function takeOwnerWords(state: HarnessState, turn: number, callId: string | null): void {
  for (const note of state.steer ?? []) if (note.pickedUpTurn === null && callId !== null && note.callId === callId) note.pickedUpTurn = turn;
  if (state.gate?.ownerNote) state.gate = { ...state.gate, ownerNote: null };
}

const noteKey = (note: { at: string; text: string }) => `${note.at}\u0000${note.text}`;

// ---------------------------------------------------------------------------
// The round gate
// ---------------------------------------------------------------------------

/** The error codes of one round's calls that ran and failed, sorted and joined; '' when none failed. */
function roundErrors(state: HarnessState, round: number): string {
  const codes = state.toolCalls.filter(call => call.turn === round && call.outcome !== 'cancelled' && !call.envelope.ok)
    .map(call => (call.envelope.ok ? '' : call.envelope.error.code));
  return [...new Set(codes)].sort().join(',');
}

/** Failed calls in a row at the end of the run; calls that never ran are passed over. */
function failuresInRow(state: HarnessState): number {
  let count = 0;
  for (const call of [...state.toolCalls].reverse()) {
    if (call.outcome === 'cancelled') continue;
    if (call.outcome === 'succeeded') break;
    count += 1;
  }
  return count;
}

const calls = (n: number) => (n === 1 ? '1 tool call' : `${n} tool calls`);

/**
 * After an act round, with the owner's gate on: the run waits for the owner when the round is one the gate asks after
 * (every round, or every few), and at once when a limit was reached, every call was refused, or the round ended in
 * failures in a row. Three rounds that end with the same failures stop the run instead. The run's stopReason is set by
 * settle before this, so a limit reads from it. Changes and returns the state it is given, as settle does.
 */
export function gateAfterRound(state: HarnessState, at: IsoTime): HarnessState {
  const gate = state.gate;
  if (!gate?.on) return state;
  const round = state.used.turns;
  if (round >= 3) {
    const ends = [round - 2, round - 1, round].map(item => roundErrors(state, item));
    if (ends[0] && ends.every(end => end === ends[0])) {
      state.control = { stop: { at, by: 'chausar', force: false }, stoppedAt: at, line: SAME_WAY_LINE };
      state.gate = { ...gate, waiting: null };
      return state;
    }
  }
  const ran = state.toolCalls.filter(call => call.turn === round && call.outcome !== 'cancelled');
  const failed = ran.filter(call => call.outcome !== 'succeeded').length;
  const inRow = failuresInRow(state);
  const reason: RoundGateReason = state.stopReason !== null ? 'limit'
    : ran.length > 0 && ran.every(call => !call.envelope.ok && REFUSED.has(call.envelope.error.code)) ? 'blocked'
      : failed > 0 && failed === ran.length && inRow >= 2 ? 'failures'
        : 'finished';
  if (reason === 'finished' && round % gate.every !== 0) return state;
  const line = reason === 'limit' ? state.stopReason!
    : reason === 'blocked' ? `Every call in round ${round} was refused: ${calls(ran.length)}.`
      : reason === 'failures' ? `Round ${round} ended with ${inRow} failures in a row: ${calls(ran.length)}, ${failed} failed.`
        : `Round ${round} is done: ${calls(ran.length)}, ${failed} failed.`;
  state.gate = { ...gate, waiting: { round, reason, line } };
  return state;
}

/** The cap the run is held to now: the playbook's limit plus the windows the owner allowed. */
function capMicros(state: HarnessState): bigint {
  return (state.capWindows ?? []).reduce((total, window) => total + BigInt(window.micros), BigInt(state.limits.maxCostMicros));
}

// ---------------------------------------------------------------------------
// The hooks a real order's tool environment carries (delivery/harness/env.ts)
// ---------------------------------------------------------------------------

/**
 * stopRequested: read from the vault between calls, true once the run is stopped, or the run
 * no longer waits on this turn's call (turnCallId): a turn the run moved on from never runs another tool.
 * callProgress: one run.call event per call as it starts and ends, with ids only (the run, the tool call and the turn's
 * model call) and its state; it never fails a call.
 */
export function runControlHooks(deps: VentureDeps, ctx: Context, ventureId: string, runId: string, turnCallId: string | null): {
  stopRequested: () => boolean; callProgress: (callId: string, state: 'start' | 'done' | 'error') => Promise<void>;
} {
  return {
    stopRequested: () => {
      const run = findRecord(deps.store.read(), 'venture-delivery-run', runId);
      if (!run || run.ventureId !== ventureId) return true;
      return run.status === 'stopped' || (turnCallId !== null && run.callId !== turnCallId);
    },
    callProgress: async (callId, state) => {
      const data = { runId, callId, state, ...(turnCallId ? { modelCallId: turnCallId } : {}) };
      await ventureAction(deps, ctx, 'prepare', 'run.call', tx => { tx.emit('run.call', data); }).catch(() => undefined);
    },
  };
}
