// Chausar venture launcher, core: telemetry rules (catalogue H18). Telemetry and traces never carry screen text,
// client data or prompts. Chausar sends no usage counters today; if it ever does, they go through sendUsage, which
// keeps only the allowlisted fields below, each a count, a flag or a fixed word, and showWhatWouldBeSent returns
// exactly what would go out. A field whose audience is not known to be public counts as private and is never sent.
// The tools Chausar launches on the owner's computer get their telemetry switches turned off (TELEMETRY_OFF_ENV).
// The allowlist with a "show what would be sent" mode follows superCMO-skills telemetry.py and the unknown-audience
// rule follows eve's channel audience policy, both surveyed in the 2026-10-21 harvest; this is a rewrite, not a copy.

/**
 * Environment switches that turn telemetry off for each tool Chausar starts. For Claude Code, the one switch below
 * stands for turning off telemetry, error reporting, the bug command and the updater together. Codex documents no
 * switch of its own, so it gets the two general ones (do-not-track and the OpenTelemetry off switch).
 */
export const TELEMETRY_OFF_ENV = Object.freeze({
  'claude-code': Object.freeze({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }),
  codex: Object.freeze({ DO_NOT_TRACK: '1', OTEL_SDK_DISABLED: 'true' }),
});

export type Audience = 'public' | 'private';

/** Only what is known to be public is public. Anything else, unknown included, is private. */
export function audienceOf(value: unknown): Audience {
  return value === 'public' ? 'public' : 'private';
}

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const flag = (value: unknown) => typeof value === 'boolean';
const oneOf = (words: readonly string[]) => (value: unknown) => typeof value === 'string' && words.includes(value);

/** Every field a usage counter may carry, with its shape. Nothing here can hold words a person wrote. */
export const USAGE_FIELDS: Readonly<Record<string, { audience: Audience; valid: (value: unknown) => boolean }>> = Object.freeze({
  appVersion: { audience: 'public', valid: value => typeof value === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) },
  host: { audience: 'public', valid: oneOf(['desktop', 'hosted-web']) },
  runsStarted: { audience: 'public', valid: count },
  runsFinished: { audience: 'public', valid: count },
  runsFailed: { audience: 'public', valid: count },
  approvalsDecided: { audience: 'public', valid: count },
  draftsAccepted: { audience: 'public', valid: count },
  invoicesIssued: { audience: 'public', valid: count },
  aiConnected: { audience: 'public', valid: flag },
});

/** Exactly what a usage counter would send for these numbers: the allowlisted, public, well-shaped fields only. */
export function showWhatWouldBeSent(raw: Readonly<Record<string, unknown>>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [field, spec] of Object.entries(USAGE_FIELDS)) {
    if (!Object.hasOwn(raw, field) || audienceOf(spec.audience) !== 'public' || !spec.valid(raw[field])) continue;
    out[field] = raw[field] as string | number | boolean;
  }
  return out;
}

/** Sends a usage counter through `send`: the body is always showWhatWouldBeSent(raw), and that body is returned. */
export async function sendUsage(raw: Readonly<Record<string, unknown>>, send: (body: Record<string, string | number | boolean>) => Promise<void>): Promise<Record<string, string | number | boolean>> {
  const body = showWhatWouldBeSent(raw);
  await send(structuredClone(body));
  return body;
}

// ---------------------------------------------------------------------------
// Wave 6 package 6J2 (D47): the fields an opt-in report may carry, per PostHog event. The same rule as usage counters:
// each field is a count, a flag, a fixed word or a range word; nothing here can hold words a person wrote, a name, an
// amount, a file name or an id that points at a person. The one id a report carries is its random report id, sent as
// PostHog's distinct_id, never as a property. core/feedback-core.ts builds the events and passes every one through here.
// ---------------------------------------------------------------------------

/** The steps a business reaches, in the order an owner usually reaches them (drop-off is read from where they stop). */
export const REPORT_MILESTONES = Object.freeze(['business_started', 'plan_accepted', 'ai_connected', 'first_client', 'first_order', 'first_job_done', 'first_invoice', 'first_payment'] as const);
export type ReportMilestone = typeof REPORT_MILESTONES[number];
/** Earnings only as one of these ranges, in whole units of the business's currency (code buckets minor units). */
export const EARNING_RANGES = Object.freeze(['none', 'under-1k', '1k-10k', '10k-50k', '50k-200k', '200k-plus'] as const);
export type EarningRange = typeof EARNING_RANGES[number];
/** The answers a short question after a milestone takes. Never free text. */
export const REPORT_ANSWERS = Object.freeze(['easy', 'okay', 'hard'] as const);
export type ReportAnswer = typeof REPORT_ANSWERS[number];

const always = (value: unknown) => value === true;
const channel = oneOf(['desktop', 'hosted-web', 'local-web', 'test']);
const milestone = oneOf(REPORT_MILESTONES);
const range = oneOf(EARNING_RANGES);
const COMMON = { channel, $geoip_disable: always } as const;

/** Every PostHog event a report may send, and the fields each may carry with their shape. */
export const REPORT_EVENTS: Readonly<Record<string, Readonly<Record<string, (value: unknown) => boolean>>>> = Object.freeze({
  chausar_report: Object.freeze({
    ...COMMON,
    appVersion: USAGE_FIELDS.appVersion!.valid,
    os: oneOf(['windows', 'linux', 'mac', 'other']),
    furthestMilestone: oneOf(['none', ...REPORT_MILESTONES]),
    weeksSinceStart: count,
    aiRoute: oneOf(['codex', 'claude-code', 'api-key', 'none']),
    runsStarted30d: count, runsFinished30d: count, runsFailed30d: count, runsStopped30d: count,
    aiCallsDone30d: count, aiCallsFailed30d: count,
    draftsAccepted30d: count, draftsEdited30d: count, draftsRejected30d: count, cardsDenied30d: count,
    invoicedThisMonth: range, receivedThisMonth: range,
    currency: (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value),
  }),
  chausar_milestone: Object.freeze({ ...COMMON, milestone }),
  chausar_answer: Object.freeze({ ...COMMON, question: milestone, answer: oneOf(REPORT_ANSWERS) }),
  chausar_deletion_requested: Object.freeze({ ...COMMON }),
});

/** Exactly the properties a report event would send: the allowlisted, well-shaped fields only; an unknown event, none. */
export function reportProperties(event: string, raw: Readonly<Record<string, unknown>>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const fields = Object.hasOwn(REPORT_EVENTS, event) ? REPORT_EVENTS[event]! : null;
  if (!fields || raw === null || typeof raw !== 'object') return out;
  for (const [field, valid] of Object.entries(fields)) {
    if (!Object.hasOwn(raw, field) || !valid(raw[field])) continue;
    out[field] = raw[field] as string | number | boolean;
  }
  return out;
}
