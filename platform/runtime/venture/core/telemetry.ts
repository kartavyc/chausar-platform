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
