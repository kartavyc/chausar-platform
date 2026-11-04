/**
 * One-shot B1 (SCREENS P1, PLAN batch 12): one owner-words table for engine refusals. Most engine messages are already
 * written for the owner ("Set your price for Monthly visits first.") and stay as they are. A code listed in
 * text/en/errors.json says that line instead, and a message that still carries a developer word (vault, credential,
 * engine, fixture, digest, an npm command) says the general line, so raw engine text never reaches a screen. The
 * engine's own text stays on the error as `detail`. Real and fake clients both call this at their edge (client.ts,
 * fake.ts), so every place that shows an error's message gets the same words without changing.
 */

import { CATALOGUES } from '../text';
import { EngineError } from './types';

/** Words an owner never needs to read: the engine's own vocabulary and developer instructions. */
const DEVELOPER = /\b(?:vault|vaults|credentials?|engine|fixtures?|digest|npm|transaction|snapshot|adapter|envelope)\b/i;

function line(key: string): string | null {
  const message = CATALOGUES.en[key];
  return typeof message === 'string' ? message : null;
}

/** The refusal in the owner's words, as an EngineError with the same code and reason. */
export function ownerError(error: unknown): EngineError {
  const e = error as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : 'REQUEST_FAILED';
  const message = typeof e?.message === 'string' ? e.message : String(error);
  const reason = typeof e?.reason === 'string' ? e.reason : undefined;
  const words = line(`errors.${code}`) ?? (DEVELOPER.test(message) ? line('errors.general') : null);
  if (words === null || words === message) return error instanceof EngineError ? error : new EngineError(code, message, reason);
  const out = new EngineError(code, words, reason);
  out.detail = message;
  return out;
}
