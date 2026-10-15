/**
 * Reply checks for the write connections place (WK-06) and the limits screen (WK-12), over
 * writeback.overview and writeback.caps (docs/lanes/writeback.md). Every reply is untrusted:
 * it is checked field by field with the Work kit's checks before anything is drawn. A secret
 * never arrives here; the check refuses any account field that is not a short text.
 */
import { InvalidReply, bool, count, id, instant, isoDate, list, literal, nullable, object, oneOf, record, text, type Check } from '../work/kit/validate.ts';

const short = text(300);

export const SYSTEMS = ['tally', 'zoho-books', 'razorpay', 'shopify', 'google-workspace', 'whatsapp', 'mail', 'gst-portal'] as const;
export type SystemId = typeof SYSTEMS[number];
export const ENVIRONMENTS = ['live', 'sandbox', 'practice'] as const;
export type Environment = typeof ENVIRONMENTS[number];
export const CREDENTIALS = ['practice', 'not-needed', 'linked', 'link-paused', 'stored', 'missing', 'unreadable'] as const;
export const SHAPES = ['none', 'token', 'pair'] as const;
export const KINDS = ['inside-undoable', 'seen-outside', 'money', 'cannot-undo'] as const;
export type Kind = typeof KINDS[number];
export const STATUSES = ['live', 'experimental', 'prepare-only', 'not-yet'] as const;
export const QUALIFICATIONS = ['unqualified', 'synthetic-tested', 'sandbox-verified'] as const;

const system = oneOf(SYSTEMS);
const fieldName: Check<string> = (value, path) => {
  if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(value)) return value;
  throw new InvalidReply(path);
};

/** Account identifiers: a short map of named texts, never a secret. */
export const account: Check<Readonly<Record<string, string>>> = (value, path) => {
  const source = record(value, path);
  const entries = Object.entries(source);
  if (entries.length > 30) throw new InvalidReply(path);
  const out: Record<string, string> = {};
  for (const [key, v] of entries) out[fieldName(key, `${path}.key`)] = short(v, `${path}.${key}`);
  return Object.freeze(out);
};

const tier: Check<1 | 2 | 'prepare-only'> = (value, path) => {
  if (value === 1 || value === 2 || value === 'prepare-only') return value;
  throw new InvalidReply(path);
};

export const connectionAction = object({
  action: text(120), title: short, kind: oneOf(KINDS), tier, alwaysWaits: bool, undoable: bool,
  status: oneOf(STATUSES), qualification: oneOf(QUALIFICATIONS), writeScore: nullable(text(20)),
  granted: bool, grantable: bool, sandboxVerified: bool,
});
export type ConnectionAction = ReturnType<typeof connectionAction>;

export const connection = object({
  id, system, label: short, environment: oneOf(ENVIRONMENTS), account, read: bool, createdAt: instant,
  link: nullable(object({ connectionId: id, group: text(80), label: nullable(short), active: bool })),
  credential: oneOf(CREDENTIALS), credentialShape: oneOf(SHAPES),
  actions: list(connectionAction, 60),
  sandboxRuns: list(object({ action: text(120), score: text(20), at: instant }), 200),
});
export type Connection = ReturnType<typeof connection>;

export const overview = object({
  demo: bool,
  connections: list(connection, 200),
  linkable: list(object({ id, system, group: text(80), label: short, branch: text(120) }), 200),
  systems: list(object({
    system,
    fields: list(object({ name: fieldName, required: bool, secret: literal(false), example: short }), 30),
    credential: oneOf(SHAPES), linkable: list(text(80), 30), actions: count,
  }), 20),
});
export type Overview = ReturnType<typeof overview>;

/** The reply of connect, grant and disconnect: the stored connection. Only its id is used. */
export const changed = object({ id });

export const credentialStored = object({ connectionId: id });

export const qualification = object({
  level: text(40), connectionId: id,
  rows: list(object({ action: text(120), checks: list(object({ name: text(80), passed: bool }), 10), score: text(20) }), 20),
});
export type Qualification = ReturnType<typeof qualification>;

const hours: Check<number> = (value, path) => {
  const n = count(value, path);
  if (n < 1 || n > 720) throw new InvalidReply(path);
  return n;
};
export const settings = object({
  approvalHours: object({ 'inside-undoable': hours, 'seen-outside': hours, money: hours, 'cannot-undo': hours }),
  reminderCapPerCustomer: count, reminderCapPerDay: count, stopWords: list(text(40), 20),
});
export type Settings = ReturnType<typeof settings>;

const zone: Check<string> = (value, path) => {
  if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value)) return value;
  throw new InvalidReply(path);
};
export const caps = object({
  settings, timeZone: zone, today: isoDate, now: instant,
  counts: object({ preparedToday: count, sentToday: count, customersToday: count }),
});
export type Caps = ReturnType<typeof caps>;
