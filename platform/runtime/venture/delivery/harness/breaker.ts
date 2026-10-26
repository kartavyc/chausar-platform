// Chausar delivery harness (Ink v2 wave 4, package 4F2): the repeat-failure breaker (catalogue H22, spec 5.6). A run
// stops, in plain words, when the same error (tool, code and message) comes back three times, when the same step (tool
// and input) runs three times whatever its outcome (in a row or going round in a loop), or after five failed calls in a
// row. It never retries on its own: the rest of the turn is cancelled and the run waits for the owner's Resume or Run
// again. On Resume the next turn hears what was tried and failed, in Chausar's own words, so it does not repeat it; the
// breaker then counts only the calls after the stop. The thresholds are frozen constants: no playbook patch, limit or
// setting reaches them. Calls that never started (cancelled: skipped, held for the owner, stopped, past a write cap)
// count for nothing; a call refused when it was made (a tool it is not granted, an input that does not fit, the
// policy's no) counts as a failure, so an agent that keeps asking for what it may not have is stopped too.
// The rules follow loop-engineering's context manager, nexusdesk's agent runtime and Open Duet's sentinel; this is a
// rewrite, not a copy.
import type { AlreadyTried, BreakerTrip, HarnessState, IsoTime, Json, PlaybookStep, ToolCallRecord } from '../../contracts.ts';
import { digest } from '../../records.ts';
import { TOOL_PURPOSE } from './tool-purpose.ts';
import { fixOf } from '../failure-words.ts';
import { repairWords } from './repair.ts';
import { runCapMicros } from './loop.ts';
import { screenUntrusted } from '../../policy/untrusted.ts';

/** The breaker's thresholds. Frozen: nothing at run time changes them. */
export const BREAKER_LIMITS = Object.freeze({ sameError: 3, sameAction: 3, failuresInRow: 5 } as const);
/** The line on a call the breaker kept from starting. */
export const BREAKER_SKIPPED = 'Chausar stopped the run because it kept failing the same way, so this call did not run.';
/** Chausar's words to the agent beside what was tried, on the turns after a breaker stop. */
export const TRIED_LINE = "These were tried and failed. Don't repeat them.";
/** Chausar's words to the agent when the run or the day is near its spend limit (M5). */
export const BUDGET_LINE = "Budget nearly used: report what you have; don't start new work.";
/** What an optional step under budget pressure says instead of running (M5). */
export const SKIPPED_STEP_LINE = "Skipped polishing to stay within this month's limit";
/** The most entries alreadyTried keeps, newest last. */
const MAX_TRIED = 10;

const failed = (call: ToolCallRecord) => call.outcome === 'failed' || call.outcome === 'timedOut';
const errorOf = (call: ToolCallRecord) => (call.envelope.ok ? { code: '', message: '' } : { code: call.envelope.error.code, message: call.envelope.error.message });
const sentence = (text: string) => { const words = text.replace(/\s+/g, ' ').trim(); return /[.!?]$/.test(words) ? words : `${words}.`; };
const normal = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 300);

/** The error signature: tool, code and the message, normalised (spacing and case). */
function errorKey(call: ToolCallRecord): string {
  const error = errorOf(call);
  return `${call.tool}\u0000${error.code}\u0000${normal(error.message)}`;
}

/** The action: tool and its input, by digest (the parsed input when it parsed, else the text as given). */
function actionKey(call: ToolCallRecord): string {
  let input = call.inputDigest;
  if (call.input !== null) { try { input = digest(call.input); } catch { /* the text's digest stands */ } }
  return `${call.tool}\u0000${input}`;
}

/** The calls the breaker counts: those that ran, after the call of its last stop. */
function counted(state: Pick<HarnessState, 'toolCalls' | 'breaker'>): ToolCallRecord[] {
  const since = state.breaker ? state.toolCalls.findIndex(call => call.id === state.breaker!.callId) + 1 : 0;
  return state.toolCalls.slice(since).filter(call => call.outcome !== 'cancelled');
}

/** What a call tried, in purpose words, with the file or table it named. */
function triedWords(call: ToolCallRecord): string {
  const purpose = TOOL_PURPOSE[call.tool] ?? 'Used a tool';
  const input = call.input && typeof call.input === 'object' && !Array.isArray(call.input) ? call.input as Record<string, Json> : null;
  const named = input ? [input.target, input.table, input.bank, input.file].find(value => typeof value === 'string' && /^[ftw]\d{1,3}(?:\.s\d{1,2})?$/.test(value)) : undefined;
  return named ? `${purpose} on ${named as string}` : purpose;
}

/** Errors whose own text is the agent's doing: Today names them in fixed words. */
const FIXED_ERROR_WORDS: Readonly<Record<string, string>> = Object.freeze({
  TOOL_DENIED: 'the agent kept asking for a tool it is not allowed.',
  TOOL_INPUT_INVALID: "the agent's input to a tool did not fit.",
});
/** How much of any other error Today's title shows. */
const ERROR_CHARS = 160;
const HELD_ERROR = 'an error Chausar held back for you to check.';

/**
 * An error as Today's title and the run's line say it: fixed words for a refused tool and a bad input; any other text
 * passes the untrusted screen first (it can quote the client's files) and is cut to about 160 characters.
 */
export function breakerErrorWords(code: string, message: string): string {
  if (Object.hasOwn(FIXED_ERROR_WORDS, code)) return FIXED_ERROR_WORDS[code];
  const screened = screenUntrusted({ source: 'tool-output', text: message.slice(0, 2000) }, { mode: 'enforce' });
  if (screened.status === 'quarantined' || screened.text === null) return HELD_ERROR;
  const words = sentence(screened.text);
  if (words.length <= ERROR_CHARS) return words;
  const cut = words.slice(0, ERROR_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(' ') > ERROR_CHARS / 2 ? cut.lastIndexOf(' ') : ERROR_CHARS).replace(/[\s.,;:]+$/, '')}...`;
}

/** The trip, if the calls so far trip one of the three rules; checked after each call, so it is about the newest. */
function tripOf(calls: readonly ToolCallRecord[]): { trigger: BreakerTrip['trigger']; line: string; error: string; involved: ToolCallRecord[] } | null {
  const last = calls.at(-1);
  if (!last) return null;
  const said = (call: ToolCallRecord) => breakerErrorWords(errorOf(call).code, errorOf(call).message);
  if (failed(last)) {
    const key = errorKey(last);
    const same = calls.filter(call => failed(call) && errorKey(call) === key);
    if (same.length >= BREAKER_LIMITS.sameError) {
      const error = said(last);
      return { trigger: 'same-error', line: `Stopped: the same error came back three times: ${error}`, error, involved: same };
    }
  }
  // The same step three times among the counted calls, in a row or going round in a loop.
  const action = actionKey(last);
  const same = calls.filter(call => actionKey(call) === action);
  if (same.length >= BREAKER_LIMITS.sameAction) {
    const error = failed(last) ? said(last) : 'It ran three times with the same input.';
    return { trigger: 'same-action', line: `Stopped: the same step ran three times: ${sentence(TOOL_PURPOSE[last.tool] ?? 'Used a tool')}`, error, involved: same };
  }
  const tail = calls.slice(-BREAKER_LIMITS.failuresInRow);
  if (tail.length === BREAKER_LIMITS.failuresInRow && tail.every(failed)) {
    const error = said(last);
    return { trigger: 'failures-in-row', line: `Stopped: five calls in a row failed. The last one: ${error}`, error, involved: tail };
  }
  return null;
}

/**
 * After a call ran: when the calls so far trip the breaker, the run is stopped by Chausar, now, with the trigger's line
 * (state.control, which the run's commit turns into status stopped), the trip is kept (state.breaker), and what was
 * tried joins alreadyTried for the turn after Resume. Changes the state it is given; true when it tripped. A run that is
 * already stopping is left alone.
 */
export function tripBreaker(state: HarnessState, at: IsoTime, dateOrder: Parameters<typeof fixOf>[1]['dateOrder'] = 'day-month-year'): boolean {
  if (state.control?.stop) return false;
  const trip = tripOf(counted(state));
  if (!trip) return false;
  const last = trip.involved.at(-1)!;
  const fixed = trip.trigger === 'same-action' && !failed(last) ? null : fixOf(errorOf(last), { at, dateOrder });
  state.breaker = { trigger: trip.trigger, line: trip.line, error: trip.error, callId: last.id, at, fix: fixed?.fix ?? null, fixKind: fixed?.fixKind ?? null };
  state.control = { stop: { at, by: 'chausar', force: false }, stoppedAt: at, line: trip.line };
  const tried = [...(state.alreadyTried ?? [])];
  for (const call of trip.involved) {
    const entry: AlreadyTried = { tool: call.tool, tried: triedWords(call), error: failed(call) ? sentence(errorOf(call).message) : trip.error };
    if (!tried.some(item => item.tool === entry.tool && item.tried === entry.tried && item.error === entry.error)) tried.push(entry);
  }
  state.alreadyTried = tried.slice(-MAX_TRIED);
  return true;
}

/** True when the run's own stop is the breaker's (not the owner's, nor the round gate's). */
export function breakerStopped(state: Pick<HarnessState, 'breaker' | 'control'> | null | undefined): boolean {
  return !!state?.breaker && !!state.control?.stoppedAt && state.control.line === state.breaker.line;
}

/** The trigger in words for Today's row: the run's line without its "Stopped: " start. */
export function triggerWords(trip: Pick<BreakerTrip, 'line'>): string {
  return trip.line.replace(/^Stopped: /, '');
}

// ---------------------------------------------------------------------------
// Chausar's own words in the next act turn
// ---------------------------------------------------------------------------

/** What an act turn needs to know of the run's spend: true when the run, the day or the month is near its limit (M5). */
export type BudgetPressure = { nearlyUsed: boolean };
/** The run's own cap at 80 percent counts as nearly used, like the day's. */
const RUN_PRESSURE_PERMILLE = 800n;

function runNearCap(state: HarnessState): boolean {
  const cap = runCapMicros(state);
  return cap > 0n && BigInt(state.used.costMicros) * 1000n >= cap * RUN_PRESSURE_PERMILLE;
}

/**
 * The run's lessons in an act turn, in Chausar's trusted words, each only while it applies: what was tried and failed
 * before a breaker stop (alreadyTried); the one repair turn's words (repair.ts); and, near the run's or the day's limit,
 * "Budget nearly used" with the optional steps left out (each said as skipped). Nothing changes while none applies, so
 * the text the owner approves stays the same.
 */
export function withRunWords(instructions: string, state: HarnessState, input: Record<string, Json>, context: { budget?: BudgetPressure; steps?: readonly Pick<PlaybookStep, 'title' | 'optional'>[] } = {}): string {
  let words = instructions;
  if (state.alreadyTried?.length) {
    input.alreadyTried = state.alreadyTried.map(item => ({ ...item }));
    words = `${words} ${TRIED_LINE}`;
  }
  const repair = repairWords(state);
  if (repair) words = `${words} ${repair}`;
  if (context.budget?.nearlyUsed || runNearCap(state)) {
    input.budget = { ...(input.budget as Record<string, Json> | undefined ?? {}), note: BUDGET_LINE };
    words = `${words} ${BUDGET_LINE}`;
    const optional = new Set((context.steps ?? []).filter(step => step.optional).map(step => step.title));
    if (optional.size && Array.isArray(input.steps)) {
      input.steps = (input.steps as { step?: unknown }[]).filter(step => !optional.has(String(step.step))) as Json;
      input.skipped = [...optional].map(title => ({ step: title, line: SKIPPED_STEP_LINE }));
    }
  }
  return words;
}
