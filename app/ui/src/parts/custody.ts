/**
 * Small helpers the custody screens share: Keep this business inside the app, and Welcome back before one is open.
 * They hold no secret: a passphrase, a recovery code or a move code lives only in the field or the screen that shows
 * it, and nothing here is kept in browser storage.
 */

import { EngineError } from '../engine/types';
import type { T } from '../text';

/** TRANSFER.maxTextChars in platform/runtime/workspace-custody-contracts.ts: a bigger move file is refused before it is sent. */
export const TRANSFER_MAX_CHARS = 1_900_000;
/** PASSPHRASE_MIN in onboarding/flow.ts, the engine's floor for a new passphrase. */
export const NEW_PASSPHRASE_MIN = 12;

/**
 * Engine refusals whose own words name the vault or a credential: Ink says them in plain words instead. Every other
 * refusal (the custody ones above all) arrives in the engine's plain words already and is shown as it came.
 */
const PLAIN = new Set([
  'UNLOCK_FAILED', 'VAULT_OPEN', 'VAULT_LOCKED', 'WEAK_PASSPHRASE', 'WORKSPACE_NOT_FOUND', 'INVALID_PATH',
  // W4 4F3: the run controls' refusals, in the screen's words (English and Hindi).
  'RUN_NOT_RUNNING', 'RUN_ALREADY_STOPPED', 'RUN_NOT_STOPPED', 'RUN_SUPERSEDED', 'BUSINESS_PAUSED',
]);

/** The refusal in plain words: Ink's own for the codes above, the engine's for the rest. */
export function refusalWords(error: unknown, t: T): string {
  if (error instanceof EngineError && PLAIN.has(error.code)) return t(`custody.refused.${error.code}`);
  return error instanceof Error ? error.message : String(error);
}

/** The engine code of a refusal, or null. */
export const codeOf = (error: unknown): string | null => (error instanceof EngineError ? error.code : null);

/** A code in groups of four for reading. Joined, the groups are the engine's string exactly. */
export function groupsOf(code: string): string[] {
  return code.match(/.{1,4}/g) ?? [];
}

/** A moment as the reader's calendar writes it: "21 Oct 2026, 11:30 am". Dates only; no figure is formatted here. */
export function momentOf(at: string, language: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/**
 * Hand the owner a file to keep, by the name the engine gave it and with its text unchanged. Only ever called from the
 * owner's own click. Returns false where the page cannot make a file (the owner can copy instead).
 */
export function saveTextFile(fileName: string, text: string, type: string): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  try { link.click(); } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return true;
}

/** A new passphrase typed twice: the problem's text key, or null when it may be sent. */
export function newPassphraseProblem(first: string, again: string): 'custody.short' | 'custody.mismatch' | null {
  if (first.length < NEW_PASSPHRASE_MIN) return 'custody.short';
  if (first !== again) return 'custody.mismatch';
  return null;
}
