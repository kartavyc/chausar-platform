/**
 * Small reply checks for the jobs-ext screens. Every engine reply is untrusted data: it is
 * checked here, field by field, before anything is drawn. A failed check throws
 * `InvalidReply` with a structural path only, never the rejected value.
 */

export class InvalidReply extends Error {
  readonly code = 'INVALID_REPLY';
  readonly path: string;
  constructor(path: string) { super('INVALID_REPLY'); this.name = 'InvalidReply'; this.path = path; }
}

export type Check<T> = (value: unknown, path: string) => T;

const fail = (path: string): never => { throw new InvalidReply(path); };
/** Control characters other than tab, line feed and carriage return. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(path);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return fail(path);
  return value as Record<string, unknown>;
}

/** Text from the engine. Shown as a text node, never as markup. */
export const text = (max = 4000): Check<string> => (value, path) =>
  typeof value === 'string' && value.length <= max && !CONTROL.test(value) ? value : fail(path);
/** An opaque engine id. */
export const id: Check<string> = (value, path) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(value) ? value : fail(path);
/** A procedure digest: 64 lowercase hex characters, sent back exactly as shown. */
export const digest: Check<string> = (value, path) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : fail(path);
/** Whole paise as an exact integer string. Never turned into a float. */
export const paise: Check<string> = (value, path) =>
  typeof value === 'string' && /^-?\d{1,30}$/.test(value) ? value : fail(path);
export const count: Check<number> = (value, path) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(path);
/** A finite number that is not money (a rule bound). */
export const finite: Check<number> = (value, path) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(path);
/** A confidence between 0 and 1. */
export const share: Check<number> = (value, path) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fail(path);
export const bool: Check<boolean> = (value, path) => typeof value === 'boolean' ? value : fail(path);
export const instant: Check<string> = (value, path) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : fail(path);

export function oneOf<const T extends string>(allowed: readonly T[]): Check<T> {
  return (value, path) => typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fail(path);
}
export function literal<const T extends string | number | boolean>(expected: T): Check<T> {
  return (value, path) => value === expected ? expected : fail(path);
}
export function list<T>(item: Check<T>, max = 2000): Check<readonly T[]> {
  return (value, path) => {
    if (!Array.isArray(value) || value.length > max) return fail(path);
    return Object.freeze(value.map((entry, i) => item(entry, `${path}[${i}]`)));
  };
}
export function nullable<T>(inner: Check<T>): Check<T | null> {
  return (value, path) => value === null ? null : inner(value, path);
}

type Shape = Record<string, Check<unknown>>;
type Out<S extends Shape> = { readonly [K in keyof S]: ReturnType<S[K]> };
type OptOut<S extends Shape> = { readonly [K in keyof S]?: ReturnType<S[K]> };

/**
 * An object with these required fields and these optional ones. Unknown fields are ignored
 * (the engine may add fields first); an optional field that is present must be valid.
 */
export function object<R extends Shape, O extends Shape = Record<never, never>>(required: R, optional?: O): Check<Out<R> & OptOut<O>> {
  return (value, path) => {
    const source = record(value, path);
    const out: Record<string, unknown> = {};
    for (const [key, check] of Object.entries(required)) {
      if (!Object.hasOwn(source, key)) return fail(`${path}.${key}`);
      out[key] = check(source[key], `${path}.${key}`);
    }
    for (const [key, check] of Object.entries(optional ?? {})) {
      if (Object.hasOwn(source, key) && source[key] !== undefined) out[key] = check(source[key], `${path}.${key}`);
    }
    return Object.freeze(out) as Out<R> & OptOut<O>;
  };
}

export function run<T>(check: Check<T>, value: unknown, path = 'reply'): T { return check(value, path); }
