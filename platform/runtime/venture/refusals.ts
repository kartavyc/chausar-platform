// A1 re-review and final check: a playbook's own refusal, thrown as a plain coded error by a shared "-core" check the
// fake engine reads too, becomes a ChausarError at the boundary, so the owner sees its words. Only an error branded where
// Chausar threw it counts (refusal-brand.ts). A library's error of the same shape (Node's ECONNRESET "socket hang up",
// an SDK's ENOENT "not found: <path>", ABORT_ERR, EINVAL) carries no brand: it stays an engine fault, the owner sees the
// plain sentence (owner-error.ts) and it is noted as a crash.
import { ChausarError } from '../contracts.ts';
import { isRefusal } from './refusal-brand.ts';

/** The refusal a branded coded error stands for, or null when it is not one of Chausar's. */
export function asRefusal(error: unknown): ChausarError | null {
  if (error instanceof ChausarError || !isRefusal(error)) return null;
  const raw = error as Error & { code: string; reason?: unknown; details?: unknown; missing?: unknown; owner?: unknown };
  const extra = Object.fromEntries((['reason', 'details', 'missing', 'owner'] as const).filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
  return Object.assign(new ChausarError(raw.code, raw.message), extra);
}

/** What a venture method threw, as the owner and the crash log meet it: a refusal, or a fault noted as a crash. */
export function settleError(thrown: unknown): { error: unknown; crash: boolean } {
  const error = asRefusal(thrown) ?? thrown;
  return { error, crash: !(error instanceof ChausarError) };
}

/** Runs work, turning a branded coded refusal into a ChausarError. */
export async function refusals<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { throw asRefusal(error) ?? error; }
}
