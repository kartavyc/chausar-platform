// Chausar venture launcher, delivery (Ink v2 wave 4, package 4F2): failures in plain words (catalogue O14). A fixed
// table by kind gives each failure one sentence and, only when the owner must act, one fix: the month's AI limit used
// up, the AI not signed in, the computer offline, work too long for the AI in one go, a tool out of date. Only offline
// is transient: nothing was sent, so doing it again as it is is safe; Chausar never does it again on its own. Offline
// is known by the transport's own class (the call never connected), never by the words of a message. A connector's
// error carries what happens next (a duplicate is looked up and used, already done counts as done, past its deadline
// goes to a person, a missing permission keeps the action as a flagged draft, never a silent drop). An error Chausar
// does not know is never echoed: the owner reads Chausar's own sentence, not the service's text. Each kind and each fix
// also has a code, so the screen can say it in its own words, Hindi included.
// Fixed failure sentences by kind follow Beeline's turn-silence table and cogsend's human errors; this is a rewrite.
import type { State } from '../../contracts.ts';
import type { DateOrder, DeliveryRunRecord, Display, FixKind, IsoDate, RunFailureKind } from '../contracts.ts';

export type FailureKind = RunFailureKind;
/**
 * One failure as the owner reads it: what went wrong, how to fix it (null when there is nothing to do) with its code,
 * and whether it is transient.
 */
export type FailureWords = { kind: FailureKind; line: Display; fix: Display | null; fixKind: FixKind | null; transient: boolean };
/** An error as the engine keeps it: its code, Chausar's words, and the transport's class when it named one. */
export type KeptError = { code: string; message: string; cause?: string };

type Row = Readonly<{ line: string; fix: string | null; fixKind: FixKind | null; transient: boolean }>;
/** The fixed table. {reset} is the day the month's limit starts again; {tool}, the tool's name. */
export const FAILURE_TABLE: Readonly<Record<FailureKind, Row>> = Object.freeze({
  'allowance-spent': Object.freeze({ line: "This month's AI limit is used up.", fix: 'Raise it in Money, or wait until {reset}.', fixKind: 'raise-limit', transient: false }),
  'not-signed-in': Object.freeze({ line: 'Your AI is not signed in.', fix: 'Sign in again under Connections, Your AI, then run it again.', fixKind: 'sign-in', transient: false }),
  offline: Object.freeze({ line: 'Your computer seems offline, so nothing was sent.', fix: 'Run it again once you are back online.', fixKind: 'run-again-online', transient: true }),
  'too-long': Object.freeze({ line: 'This was too long for your AI in one go.', fix: 'Split it into smaller orders, or pick a model that reads more at once, then run it again.', fixKind: 'split-work', transient: false }),
  'out-of-date': Object.freeze({ line: '{tool} is out of date for Chausar.', fix: 'Update it, then check it again under Connections, Your AI.', fixKind: 'update-tool', transient: false }),
  unknown: Object.freeze({ line: "The AI service answered with an error Chausar doesn't know. Nothing was retried.", fix: null, fixKind: null, transient: false }),
} satisfies Record<FailureKind, Row>);

/** Engine codes that place an AI call's failure in the table. Codes not here keep their own words. */
const MODEL_CODES = new Set(['MODEL_FAILED', 'MODEL_INCOMPLETE', 'MODEL_KEY_MISSING', 'CLI_UNAVAILABLE', 'CLI_FLAGS_UNSUPPORTED', 'BUDGET_REACHED', 'SPEND_CAP']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The first day of the month after the given time's month (months in UTC, as spend counts them). */
export function resetDay(nowIso: string): IsoDate {
  const year = parseInt(nowIso.slice(0, 4), 10);
  const month = parseInt(nowIso.slice(5, 7), 10);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** '1 Nov' (or 'Nov 1'): a reset day as the owner writes dates, short. */
export function shortDay(iso: IsoDate, order: DateOrder): Display {
  const day = parseInt(iso.slice(8, 10), 10);
  const month = MONTHS[parseInt(iso.slice(5, 7), 10) - 1];
  return order === 'month-day-year' ? `${month} ${day}` : order === 'day-month-year' ? `${day} ${month}` : iso;
}

/**
 * The kind of an AI call's failure, from its code and the transport's class; null when it is not one of the table's.
 * The model port words each failure itself (models/anthropic.ts, cli.ts), so its own fixed sentences place the rest.
 */
export function failureKind(error: KeptError): FailureKind | null {
  const { code } = error;
  if (!MODEL_CODES.has(code)) return null;
  if (code === 'BUDGET_REACHED' || code === 'SPEND_CAP') return 'allowance-spent';
  if (error.cause === 'not-connected') return 'offline';
  const words = error.message.toLowerCase();
  if (code === 'MODEL_KEY_MISSING' || (code === 'CLI_UNAVAILABLE' && words.includes('not signed in')) || words.includes('refused your key')) return 'not-signed-in';
  if (code === 'CLI_FLAGS_UNSUPPORTED') return 'out-of-date';
  if (code === 'MODEL_INCOMPLETE' && words.includes('ran out of room')) return 'too-long';
  if (code === 'MODEL_FAILED') return 'unknown';
  return null;
}

/**
 * An AI call's failure in the table's words, or null when it is not one of the table's (its own words stand). at: when
 * it failed, for the day the limit starts again; tool: the command-line tool's name for out of date.
 */
export function failureWords(error: KeptError, context: { at: string; dateOrder: DateOrder; tool?: string }): FailureWords | null {
  const kind = failureKind(error);
  if (!kind) return null;
  const row = FAILURE_TABLE[kind];
  const fill = (text: string) => text.replace('{reset}', shortDay(resetDay(context.at), context.dateOrder)).replace('{tool}', context.tool ?? 'Your command-line tool');
  return { kind, line: fill(row.line), fix: row.fix === null ? null : fill(row.fix), fixKind: row.fixKind, transient: row.transient };
}

/** Errors a tool met that only the owner can clear, and how. Anything else needs nothing from the owner: no fix. */
const TOOL_FIXES: readonly { match: RegExp; fix: string; fixKind: FixKind }[] = Object.freeze([
  { match: /\bffmpeg\b.*\bnot found\b/i, fix: 'Install ffmpeg, or turn off the finishing check, then run again.', fixKind: 'install-ffmpeg' },
  { match: /^Needs Docker Desktop\.|Docker Desktop is installed but not running/, fix: 'Set up Docker Desktop and start it, then run again.', fixKind: 'set-up-docker' },
  { match: /is not on this computer\. Chausar never downloads it/, fix: 'Get the Python image once, as the message says, then run again.', fixKind: 'get-python-image' },
  { match: /Neither Claude Code nor Codex is set up|is not set up on this computer/, fix: 'Set up Claude Code or Codex under Connections, Your AI, then run again.', fixKind: 'set-up-cli' },
]);

/** "How to fix it" for one error, with its code, when the owner must act: the table's fix for an AI failure, else a known tool fix. */
export function fixOf(error: KeptError, context: { at: string; dateOrder: DateOrder }): { fix: Display; fixKind: FixKind } | null {
  const words = failureWords(error, context);
  if (words) return words.fix && words.fixKind ? { fix: words.fix, fixKind: words.fixKind } : null;
  const known = TOOL_FIXES.find(item => item.match.test(error.message));
  return known ? { fix: known.fix, fixKind: known.fixKind } : null;
}

/** "How to fix it" for one error, when the owner must act; null when there is nothing to do. */
export function fixFor(error: KeptError, context: { at: string; dateOrder: DateOrder }): Display | null {
  return fixOf(error, context)?.fix ?? null;
}

/** What the run sheet says of a run's failure or breaker stop: the plain sentence and its kind, the fix and its code. */
export type RunFailureView = { failure?: { kind: FailureKind; line: Display }; fix?: Display; fixKind?: FixKind };

/**
 * A run the breaker stopped gives the fix for the error that kept coming back; a failed run gives its AI call's
 * failure in the table's words, and the fix when the owner must act. Empty when there is nothing to say.
 */
export function runFailure(state: State, run: Pick<DeliveryRunRecord, 'status' | 'callId' | 'harness' | 'at'>, dateOrder: DateOrder = 'day-month-year'): RunFailureView {
  const harness = run.harness;
  if (run.status === 'stopped' && harness?.breaker && harness.control?.line === harness.breaker.line) {
    const trip = harness.breaker;
    return trip.fix ? { fix: trip.fix, ...(trip.fixKind ? { fixKind: trip.fixKind } : {}) } : {};
  }
  if (run.status !== 'failed' || !run.callId) return {};
  const call = state.conversations.find((record: { id?: unknown } | null) => record?.id === run.callId) as { at?: unknown; error?: { code?: unknown; message?: unknown; cause?: unknown } | null } | undefined;
  const error = call?.error;
  if (!error || typeof error.code !== 'string' || typeof error.message !== 'string') return {};
  const kept: KeptError = { code: error.code, message: error.message, ...(typeof error.cause === 'string' ? { cause: error.cause } : {}) };
  const context = { at: typeof call.at === 'string' ? call.at : run.at, dateOrder };
  const words = failureWords(kept, context);
  const fixed = fixOf(kept, context);
  return { ...(words ? { failure: { kind: words.kind, line: words.line } } : {}), ...(fixed ? { fix: fixed.fix, fixKind: fixed.fixKind } : {}) };
}

/** "How to fix it" on a run (RunDetail.fix), from runFailure; undefined when the owner has nothing to do. */
export function runFix(state: State, run: Pick<DeliveryRunRecord, 'status' | 'callId' | 'harness' | 'at'>, dateOrder?: DateOrder): Display | undefined {
  return runFailure(state, run, dateOrder).fix;
}

// ---------------------------------------------------------------------------
// Connector errors: what happens next
// ---------------------------------------------------------------------------

/**
 * What a connector error means for the action. adopt: a copy already exists there, so it is looked up and used, never
 * made twice. success: it was already done, which counts as done. person: past its deadline, so a person decides.
 * flagged-draft: a missing permission; the action is kept as a draft flagged for the owner, never dropped. fail: an
 * error Chausar does not know, said in Chausar's own words. Nothing here is ever retried on its own. No connector
 * calls this yet in this build (docs/venture/ink.md, known limits): it is the table their wiring will read.
 */
export type ConnectorAction = {
  action: 'adopt' | 'success' | 'person' | 'flagged-draft' | 'fail';
  line: Display; fix: Display | null;
  /** On a missing permission: the action's own words, kept as a draft, and the flag the owner sees on it. */
  draft?: { text: string; flag: Display };
};

const CONNECTOR_UNKNOWN = "The service answered with an error Chausar doesn't know. Nothing was retried.";

/**
 * A connector's error, placed: by its HTTP status or its code. text: what the action would have sent, kept whole as a
 * flagged draft when permission is missing. The service's own message is never shown.
 */
export function connectorAction(error: { status?: number | null; code?: string | null }, text: string, connector: string): ConnectorAction {
  const code = (error.code ?? '').toUpperCase();
  const status = error.status ?? null;
  if (status === 401 || status === 403 || /PERMISSION|FORBIDDEN|SCOPE|UNAUTHORI[SZ]ED/.test(code)) {
    return {
      action: 'flagged-draft', line: `Chausar is missing permission to do this on ${connector}, so it was kept as a draft for you.`,
      fix: `Give ${connector} that permission, then send the draft.`, draft: { text, flag: `Needs permission on ${connector}` },
    };
  }
  if (status === 409 || /DUPLICATE|ALREADY_EXISTS/.test(code)) {
    return { action: 'adopt', line: `It already exists on ${connector}, so Chausar looks it up and uses that one instead of making another.`, fix: null };
  }
  if (/ALREADY_DONE|ALREADY_APPLIED|ALREADY_SENT/.test(code)) return { action: 'success', line: `It was already done on ${connector}, so it counts as done.`, fix: null };
  if (status === 410 || /DEADLINE|EXPIRED/.test(code)) {
    return { action: 'person', line: 'It is past its deadline, so a person has to decide what happens. It waits for you on Today.', fix: null };
  }
  return { action: 'fail', line: CONNECTOR_UNKNOWN, fix: null };
}
