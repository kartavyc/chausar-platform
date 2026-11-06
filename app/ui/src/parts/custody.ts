/**
 * Small helpers the custody screens share: Keep this business inside the app, and Welcome back before one is open.
 * They hold no secret: a passphrase, a recovery code or a move code lives only in the field or the screen that shows
 * it, and nothing here is kept in browser storage.
 */

import { EngineError } from '../engine/types';
import type { T } from '../text';
import { formatMoment } from '../../../../platform/runtime/owner-format';

/** TRANSFER.maxTextChars in platform/runtime/workspace-custody-contracts.ts: a bigger move file is refused before it is sent. */
export const TRANSFER_MAX_CHARS = 1_900_000;
/** PASSPHRASE_MIN in onboarding/flow.ts, the engine's floor for a new passphrase. */
export const NEW_PASSPHRASE_MIN = 12;

/**
 * Engine refusals Ink says in this screen's own words. Every other refusal arrives in the owner's words already and is
 * shown as it came; a wrong passphrase (UNLOCK_FAILED) is worded once, in text/en/errors.json (engine/owner-errors.ts).
 */
const PLAIN = new Set([
  // B1 fix round 2: not VAULT_LOCKED. The engine says it in owner words, some of them specific ("Choose one of your
  // businesses first."), so its own line is shown.
  'VAULT_OPEN', 'WEAK_PASSPHRASE', 'WORKSPACE_NOT_FOUND', 'INVALID_PATH',
  // W4 4F3: the run controls' refusals, in the screen's words (English and Hindi).
  'RUN_NOT_RUNNING', 'RUN_ALREADY_STOPPED', 'RUN_NOT_STOPPED', 'RUN_SUPERSEDED', 'BUSINESS_PAUSED',
]);

/** The refusal in plain words: Ink's own for the codes above, the engine's for the rest. */
export function refusalWords(error: unknown, t: T): string {
  if(error instanceof EngineError&&['SOCIAL_VOICE_CHANGED','SOCIAL_REPORT_MONTH_REQUIRED','SOCIAL_EXPORTS_REQUIRED'].includes(error.code))return t('pb-social.error.'+error.code);
  if (error instanceof EngineError && PLAIN.has(error.code)) return t(`custody.refused.${error.code}`);
  return error instanceof Error ? error.message : String(error);
}

/** The engine code of a refusal, or null. */
export const codeOf = (error: unknown): string | null => (error instanceof EngineError ? error.code : null);

/** A code in groups of four for reading. Joined, the groups are the engine's string exactly. */
export function groupsOf(code: string): string[] {
  return code.match(/.{1,4}/g) ?? [];
}

/** A moment in the owner's zone (`useOwnerZone`): "21 Oct 2026, 11:30 am". Dates only; no figure is formatted here. */
export function momentOf(at: string, zone: string): string {
  return formatMoment(at, zone);
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
