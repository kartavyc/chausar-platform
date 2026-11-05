/**
 * One-shot B1 (SCREENS P1, PLAN batch 12), B1 fix round 1: one owner-words table for engine refusals. Every transport
 * (the local server, the desktop worker through main and the preload, the hosted server, the fake engine) marks a
 * refusal written for the owner with `owner: true` (platform/runtime/owner-flag.ts), and such a refusal is shown exactly
 * as sent: "Type your email address to delete your account.", "Set your price for Digest Ltd first." Only an unflagged
 * error is put in the owner's words here: a code whose engine text is developer text (DEVELOPER_TEXT_CODES) says its
 * line from text/en/errors.json, and any other unflagged message that still carries a developer word says the general
 * line. Real and fake clients both call this at their edge (client.ts, fake.ts).
 */

import { DEVELOPER_TEXT_CODES, DEVELOPER_WORDS, bannedIn } from '../../../../platform/runtime/owner-flag';
import { CATALOGUES } from '../text';
import { EngineError } from './types';

export { DEVELOPER_WORDS };

// DEVELOPER_WORDS are looked for (bannedIn, the same helper every owner-words test uses) only on an error no transport
// marked as the owner's: a desktop or network failure, a fault in this page.

/** A code sent in place of words (the phone protocol's PhoneError says only its code). */
const BARE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** A line from text/en/errors.json. */
export function errorLine(key: string): string {
  const message = CATALOGUES.en[`errors.${key}`];
  if (typeof message !== 'string') throw new Error(`errors.${key} is not in the catalogue`);
  return message;
}

/** The refusal in the owner's words, as an EngineError with the same code and reason, marked as the owner's. */
export function ownerError(error: unknown): EngineError {
  const e = error as { code?: unknown; message?: unknown; reason?: unknown; owner?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : 'REQUEST_FAILED';
  const message = typeof e?.message === 'string' ? e.message : String(error);
  const reason = typeof e?.reason === 'string' ? e.reason : undefined;
  if (e?.owner === true) return error instanceof EngineError ? error : new EngineError(code, message, reason, true);
  const words = DEVELOPER_TEXT_CODES.includes(code) ? errorLine(code) : bannedIn(message).length > 0 || BARE_CODE.test(message) ? errorLine('general') : null;
  if (words === null) return error instanceof EngineError ? error : new EngineError(code, message, reason);
  return new EngineError(code, words, reason, true);
}
