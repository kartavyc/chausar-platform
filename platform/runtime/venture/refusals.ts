// A1 re-review: a playbook's own refusal, thrown as a plain error with a code (seoNeed, sellerRefuse and the other
// shared "-core" checks the fake engine reads too), becomes a ChausarError at the boundary, so the owner sees its words.
// Only an engine-shaped code counts: capital letters and underscores, never a library's (ERR_..., UND_ERR_...), and
// never an error from a system call. Anything else stays what it is, and the owner sees the plain sentence
// (owner-error.ts).
import { ChausarError } from '../contracts.ts';

const LIBRARY = /^(?:ERR_|UND_ERR_)/;

/** The refusal a coded plain error stands for, or null when it is not one of Chausar's. */
export function asRefusal(error: unknown): ChausarError | null {
  if (error instanceof ChausarError || !(error instanceof Error)) return null;
  const raw = error as Error & { code?: unknown; syscall?: unknown; errno?: unknown; reason?: unknown; details?: unknown; missing?: unknown };
  if (typeof raw.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(raw.code) || LIBRARY.test(raw.code) || raw.syscall !== undefined || raw.errno !== undefined) return null;
  const extra = Object.fromEntries((['reason', 'details', 'missing'] as const).filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
  return Object.assign(new ChausarError(raw.code, raw.message), extra);
}

/** Runs work, turning a coded plain refusal into a ChausarError. */
export async function refusals<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { throw asRefusal(error) ?? error; }
}
