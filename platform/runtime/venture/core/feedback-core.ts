// Chausar venture launcher, core (wave 6, package 6J2, D47): feedback, the parts that are the same in the engine and in
// the fake engine. A browser-safe leaf: only portable.ts and telemetry.ts. The engine's handlers are in feedback.ts.
//
// The rules, held by code here and in feedback.ts:
// - Off by default. The owner opts in by the notice's digest, usage reports and crash reports each on their own.
// - Nothing leaves on its own: the owner sees the exact events in a preview and presses Send report with its digest.
// - PostHog events carry only telemetry.ts's allowlisted fields (counts, flags, fixed words, ranges). Crash reports
//   carry the error's kind and its text and stack scrubbed here: no paths, file names, emails, numbers, quoted words,
//   capitalised words (names), ids or keys.
// - The one id is a random report id, so the Chausar team can find and delete a person's reports when asked.
// Written for Chausar; the allowlist follows telemetry.ts (H18), nothing here is copied from an outside source.
import { digest, hash } from '../../portable.ts';
import { REPORT_ANSWERS, reportProperties, type EarningRange, type ReportAnswer, type ReportMilestone } from './telemetry.ts';

/** The privacy notice shown before reports can be turned on; agreeing sends its digest, so a changed notice asks again. */
export const FEEDBACK_NOTICE_TEXT = 'Reports help the Chausar team fix crashes and see where people get stuck. They stay off until you turn them on, and nothing leaves until you press Send report and see exactly what goes. A report holds counts, steps reached, crash details with names, paths and numbers removed, and earnings only as a range. It never holds names, client details, message text, file names, amounts or keys. Reports carry a random id, not your name. PostHog keeps the counts and Sentry keeps the crashes. Delete my reports asks the Chausar team to delete them.';
export const FEEDBACK_NOTICE_DIGEST = digest(FEEDBACK_NOTICE_TEXT);

/** The milestones a short question follows, in the order they are asked. */
export const QUESTION_MILESTONES = Object.freeze(['ai_connected', 'first_job_done', 'first_invoice', 'first_payment'] as const satisfies readonly ReportMilestone[]);
export type QuestionMilestone = typeof QUESTION_MILESTONES[number];
export const QUESTION_TEXT: Readonly<Record<QuestionMilestone, string>> = Object.freeze({
  ai_connected: 'How easy was connecting your AI?',
  first_job_done: 'How easy was your first finished job?',
  first_invoice: 'How easy was your first invoice?',
  first_payment: 'How easy was recording your first payment?',
});
export const ANSWER_LABELS: Readonly<Record<ReportAnswer, string>> = Object.freeze({ easy: 'Easy', okay: 'Okay', hard: 'Hard' });
/** Where a crash came from: the app window, the engine, or the desktop shell. */
export const CRASH_SOURCES = Object.freeze(['window', 'engine', 'desktop'] as const);
export type CrashSource = typeof CRASH_SOURCES[number];
/** At most this many crash reports wait for Send report; more are not kept. */
export const CRASH_QUEUE_LIMIT = 20;

export const FEEDBACK_WORDS = Object.freeze({
  notSetUp: 'Reports are not set up in this build, so nothing can be sent.',
  setUp: 'Reports go to the Chausar team\'s PostHog and Sentry projects.',
  off: 'Reports are off. Nothing leaves this computer.',
  on: 'Nothing leaves until you press Send report.',
  offRequired: 'Turn reports on first.',
  stale: 'The privacy notice changed. Read it again before turning reports on.',
  previewStale: 'The report changed since you looked. Check the new preview, then send.',
  pickOne: 'Turn on usage reports, crash reports or both.',
  noQuestion: 'This question is not open.',
  crashFull: 'Twenty crash reports are waiting. Send or delete them first.',
  nothingLeft: 'Nothing had left this computer. Reports are off and what was waiting is gone.',
  deleteFailed: 'Couldn\'t reach PostHog to ask for deletion. Nothing changed. Try again.',
});

// ---------------------------------------------------------------------------
// Shapes (re-exported by venture/contracts.ts; the app's engine/types.ts reads them from here)
// ---------------------------------------------------------------------------

export type ReportEvent = { event: string; distinct_id: string; properties: Record<string, string | number | boolean> };
export type CrashFrame = { function: string; filename: string; lineno: number; colno: number; in_app: true };
export type SentryEvent = {
  event_id: string; platform: 'node'; level: 'error'; release: string; environment: string;
  tags: Record<string, string>; user: { id: string };
  exception: { values: { type: string; value: string; stacktrace: { frames: CrashFrame[] } }[] };
};
/** Exactly what Send report sends: PostHog's events and Sentry's events; only the services' own keys are added on the way. */
export type FeedbackPreview = { digest: string; posthog: { to: string; events: ReportEvent[] } | null; sentry: { to: string; events: SentryEvent[] } | null };
export type FeedbackSend = { at: string; posthog: number | null; sentry: number | null; accepted: boolean; line: string };
/** W6 6J2: venture.feedback.get's answer (and every feedback method's but crash). */
export type FeedbackView = {
  host: string;
  notice: { text: string; digest: string };
  consent: { given: boolean; stale: boolean; usage: boolean; crashes: boolean; at: string | null };
  setUp: { posthog: boolean; sentry: boolean; line: string };
  reportId: string | null;
  preview: FeedbackPreview | null;
  question: { id: QuestionMilestone; text: string; choices: { id: ReportAnswer; label: string }[] } | null;
  lastSend: FeedbackSend | null;
  deletion: { at: string; reportId: string; line: string } | null;
  line: string;
};
export type FeedbackCrashKept = { kept: boolean; line: string };
export type FeedbackConsentInput = { digest: string; usage: boolean; crashes: boolean } | { withdraw: true };
export type FeedbackCrashInput = { source: CrashSource; name: string; message: string; stack?: string };
export type FeedbackAnswerInput = { questionId: QuestionMilestone; answer: ReportAnswer | 'skip' };
/** A crash as kept until it is sent: already scrubbed. */
export type KeptCrash = { source: CrashSource; type: string; value: string; frames: CrashFrame[]; method: string | null };

// ---------------------------------------------------------------------------
// Ranges and scrubbing
// ---------------------------------------------------------------------------

/** A money figure in minor units as a range word, in whole units of its currency (digits: its minor-unit digits). */
export function earningRange(minor: bigint, digits: number): EarningRange {
  if (minor <= 0n) return 'none';
  const thousand = 1000n * 10n ** BigInt(digits);
  if (minor < thousand) return 'under-1k';
  if (minor < 10n * thousand) return '1k-10k';
  if (minor < 50n * thousand) return '10k-50k';
  if (minor < 200n * thousand) return '50k-200k';
  return '200k-plus';
}

const PLACEHOLDER = /^<(?:text|path|url|email|number|id|word)>$/;
/** Capitalised words common in error text that are kept; every other capitalised word could be a name and is not. */
const ERROR_WORDS = new Set([
  'A', 'An', 'The', 'This', 'That', 'It', 'Is', 'No', 'Not', 'Only', 'Too', 'Out', 'Can', 'Could', 'Cannot', 'Must', 'Should',
  'Unexpected', 'Invalid', 'Failed', 'Unknown', 'Missing', 'Expected', 'Maximum', 'Minimum', 'Reached', 'Unhandled', 'Uncaught',
  'Error', 'Assertion', 'Permission', 'Access', 'Denied', 'Abort', 'Aborted', 'Timeout', 'Request', 'Response', 'Network', 'Internal',
  'Value', 'Property', 'Object', 'Array', 'String', 'Number', 'Function', 'Promise', 'Module', 'Import', 'Export', 'Reading',
  'JSON', 'URL', 'HTTP', 'HTTPS', 'IPC', 'SQL', 'NaN', 'Type', 'Range', 'Reference', 'Syntax',
  'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AbortError', 'TimeoutError',
  'Chausar', 'Codex', 'Claude', 'PostHog', 'Sentry', 'Electron', 'Node', 'React', 'Ink', 'Windows', 'Linux',
]);

/**
 * Crash text with anything that could point at a person taken out: quoted words, addresses, emails, paths (any word
 * with a slash or backslash), phone numbers and runs of four or more digits, words mixing letters and digits (ids and
 * keys), and every capitalised or non-English word that is not a common error word (names). At most `max` characters.
 */
export function scrubCrashText(raw: string, max = 300): string {
  let text = String(raw ?? '').slice(0, 4000).replace(/\s+/g, ' ').trim();
  text = text.replace(/(["'`‘’“”])(?:(?!\1).){0,400}?\1/g, '<text>');
  text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>');
  text = text.replace(/[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/gi, '<email>');
  text = text.replace(/[^\s<>]*[\\/][^\s<>]*/g, '<path>');
  text = text.replace(/\+?\d[\d ().-]{6,}\d/g, '<number>');
  text = text.replace(/\d{4,}/g, '<number>');
  text = text.replace(/[A-Za-z0-9_-]*(?:\d[A-Za-z0-9_-]*[A-Za-z]|[A-Za-z][A-Za-z0-9_-]*\d)[A-Za-z0-9_-]*/g, match => (match.length >= 6 ? '<id>' : match));
  text = text.replace(/[^\s]+/g, word => {
    const core = word.replace(/^[(]+/, '').replace(/[.,;:!?()]+$/, '');
    if (PLACEHOLDER.test(core) || ERROR_WORDS.has(core)) return word;
    if (/[A-Z]/.test(word) || /[^\x00-\x7f]/.test(word)) return `<word>${word.match(/[.,;:!?)]+$/)?.[0] ?? ''}`;
    return word;
  });
  return text.length > max ? text.slice(0, max) : text;
}

/** A crash kind (TypeError, RangeError): a code word, else plain Error. */
export function crashType(name: unknown): string {
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) ? name : 'Error';
}

const CODE_FILE = /^[A-Za-z0-9._-]{1,80}\.(?:ts|tsx|js|jsx|cjs|mjs)$/;
const FUNCTION_NAME = /^[A-Za-z_$][\w$.<>[\] ]{0,80}$/;

/** A V8 stack's frames, newest first: a code function name, a code file's own name (no folder), line and column. Others are left out. */
export function scrubStack(stack: unknown): CrashFrame[] {
  if (typeof stack !== 'string') return [];
  const frames: CrashFrame[] = [];
  for (const line of stack.slice(0, 20000).split(/\r?\n/)) {
    const at = /^\s*at\s+(.+)$/.exec(line);
    if (!at) continue;
    let body = at[1]!.trim().replace(/^(?:async|new)\s+/, '');
    let name = '?';
    const wrapped = /^(.*?)\s+\((.*)\)$/.exec(body);
    if (wrapped) { name = wrapped[1]!; body = wrapped[2]!; }
    const place = /^(.*):(\d+):(\d+)$/.exec(body);
    if (!place) continue;
    const file = place[1]!.split(/[\\/]/).pop() ?? '';
    if (!CODE_FILE.test(file)) continue;
    frames.push({ function: FUNCTION_NAME.test(name) ? name : '?', filename: file, lineno: Number(place[2]), colno: Number(place[3]), in_app: true });
    if (frames.length >= 30) break;
  }
  return frames;
}

/** One crash as kept: scrubbed once, when it is noted. */
export function keptCrash(source: CrashSource, name: unknown, message: unknown, stack: unknown, method: string | null): KeptCrash {
  return { source, type: crashType(name), value: scrubCrashText(typeof message === 'string' ? message : ''), frames: scrubStack(stack), method };
}

// ---------------------------------------------------------------------------
// The events
// ---------------------------------------------------------------------------

export type ReportFacts = {
  reportId: string; channel: string;
  report: Record<string, string | number | boolean> | null;
  milestones: ReportMilestone[];
  answers: { question: string; answer: string }[];
  crashes: { id: string; crash: KeptCrash }[];
  appVersion: string; os: string;
  to: { posthog: string; sentry: string };
};

const event = (name: string, reportId: string, raw: Record<string, unknown>): ReportEvent => ({ event: name, distinct_id: reportId, properties: reportProperties(name, raw) });

/** Exactly what Send report would send, from the facts code worked out. Usage parts are null without usage reports. */
export function feedbackPreview(facts: ReportFacts): FeedbackPreview {
  const common = { channel: facts.channel, $geoip_disable: true };
  const posthog = facts.report === null ? null : {
    to: facts.to.posthog,
    events: [
      event('chausar_report', facts.reportId, { ...facts.report, ...common }),
      ...facts.milestones.map(milestone => event('chausar_milestone', facts.reportId, { milestone, ...common })),
      ...facts.answers.filter(answer => (REPORT_ANSWERS as readonly string[]).includes(answer.answer)).map(answer => event('chausar_answer', facts.reportId, { ...answer, ...common })),
    ],
  };
  const sentry = facts.crashes.length === 0 ? null : {
    to: facts.to.sentry,
    events: facts.crashes.map(({ id, crash }): SentryEvent => ({
      event_id: hash(`chausar-crash:${id}`).slice(0, 32), platform: 'node', level: 'error',
      release: `chausar@${/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(facts.appVersion) ? facts.appVersion : '0.0.0'}`, environment: facts.channel,
      tags: { source: crash.source, os: facts.os, ...(crash.method ? { method: crash.method } : {}) },
      user: { id: facts.reportId },
      exception: { values: [{ type: crash.type, value: crash.value, stacktrace: { frames: [...crash.frames].reverse() } }] },
    })),
  };
  return { digest: digest({ posthog, sentry }), posthog, sentry };
}

/** The deletion request: one PostHog event under the report id, so the team can find and delete that id's reports. */
export function deletionEvent(reportId: string, channel: string): ReportEvent {
  return event('chausar_deletion_requested', reportId, { channel, $geoip_disable: true });
}

/** The words for a send, from what each service answered (null: it could not be reached; absent: nothing to send it). */
export function sendLine(posthog: number | null | undefined, sentry: number | null | undefined): { accepted: boolean; line: string } {
  const ok = (status: number | null | undefined) => status === undefined || (typeof status === 'number' && status >= 200 && status < 300);
  const parts: string[] = [];
  if (posthog !== undefined) parts.push(ok(posthog) ? 'PostHog accepted the report.' : `PostHog did not accept it (${posthog ?? 'no answer'}); the counts go again next time.`);
  if (sentry !== undefined) parts.push(ok(sentry) ? 'Sentry accepted the crash reports.' : `Sentry did not accept them (${sentry ?? 'no answer'}); the crash reports wait for the next send.`);
  const accepted = ok(posthog) && ok(sentry);
  return { accepted, line: `${accepted ? 'Sent. ' : ''}${parts.join(' ')}`.trim() };
}

/** The deletion request's words, honest about who deletes. */
export function deletionLine(reportId: string, reached: boolean): string {
  return reached
    ? `Asked the Chausar team to delete reports sent under ${reportId}. In PostHog and Sentry only the project owner can delete, so the team does it by hand. Until then they stay, under this random id and no name. Reports are off.`
    : `This build cannot reach the Chausar team. To ask for deletion, send them your report id, ${reportId}. In PostHog and Sentry only the project owner can delete. Reports are off.`;
}
