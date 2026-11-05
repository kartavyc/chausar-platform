// A1 final check: Chausar's own refusals, marked where they are thrown. A playbook check that throws a plain coded error
// (the shared "-core" helpers the fake engine reads too) brands it here, and refusals.ts turns only branded errors into a
// ChausarError. A library's error with a code of the same shape (Node's ECONNRESET "socket hang up", an SDK's ENOENT
// "not found: <path>") carries no brand, so it stays an engine fault: the owner sees the plain sentence and it is noted
// as a crash. No imports, so the browser copy of a core helper can use it.
export const REFUSAL_BRAND: unique symbol = Symbol.for('chausar.venture.refusal') as never;

type Coded = Error & { code: string };

/**
 * Brands a plain error as one of Chausar's refusals, with its code and any extra fields (like the missing inputs). B1 fix
 * round 1: it also says, as plain data that survives JSON, that its words are written for the owner (`owner: true`).
 */
export function refusalError<E extends Error>(error: E, fields: { code: string } & Record<string, unknown>): E & Coded {
  return Object.assign(error, fields, { owner: true }, { [REFUSAL_BRAND]: true });
}

/** The same for an error class that sets its own code (DevError, NewsletterError and the like), from its constructor. */
export function markRefusal<E extends Error>(error: E): E {
  Object.defineProperty(error, REFUSAL_BRAND, { value: true, enumerable: false });
  return Object.assign(error, { owner: true });
}

/** True only for an error branded where Chausar threw it. */
export function isRefusal(error: unknown): error is Coded {
  return error instanceof Error && (error as unknown as Record<symbol, unknown>)[REFUSAL_BRAND] === true && typeof (error as { code?: unknown }).code === 'string';
}
