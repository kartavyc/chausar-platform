/**
 * B1 fix round 1 (quality findings 1 and 2): which refusals are written for the owner. Every error a transport sends
 * (the local server, the desktop engine worker, the hosted server, the fake engine) carries `owner: true` when its words
 * are Chausar's own and may be shown exactly as sent. The codes below are the few whose engine text is developer text
 * ("Unable to unlock vault. Check your credential or restore a valid backup.", "Nested vault operations are not
 * supported."): they travel without the flag, and the app says them in its own words (app/ui/src/engine/owner-errors.ts,
 * text/en/errors.json). No imports, so the app's copy reads this one.
 */
export const DEVELOPER_TEXT_CODES: readonly string[] = Object.freeze([
  'UNLOCK_FAILED', 'VAULT_CLOSED', 'VAULT_EXISTS', 'REENTRANT_TRANSACTION', 'CUSTODY_SNAPSHOT_REQUIRED', 'BOOTSTRAP_STATE_CHANGED', 'UI_NOT_BUILT',
]);

/** True when a refusal with this code is sent in words written for the owner. */
export function ownerWords(code: unknown): boolean {
  return typeof code === 'string' && !DEVELOPER_TEXT_CODES.includes(code);
}

/**
 * B1 fix round 2 (quality finding 2, spec finding 4): the vault, sync and storage internals throw InternalError
 * (owner: false, platform/runtime/portable.ts), never words for the owner. These are their codes an owner can meet in the
 * app (a wrong folder, a file already there, a business open in another window, a backup that is not one); the app says
 * each in its own words (text/en/errors.json). Any other internal refusal goes out as the general sentence.
 */
export const INTERNAL_LINE_CODES: readonly string[] = Object.freeze(['DATA_MIGRATION_FAILED', 'MIGRATION_PENDING', 
  'WEAK_PASSPHRASE', 'INVALID_NAME', 'UNSAFE_PATH', 'OUTPUT_EXISTS', 'REVISION_CONFLICT', 'VAULT_TOO_LARGE', 'VAULT_BUSY',
  'ARTIFACT_AUTHENTICATION_FAILED', 'ARTIFACT_NOT_FOUND', 'BACKUP_OTHER_BUSINESS', 'TRANSFER_CODE_WRONG', 'INVALID_BACKUP', 'SYNC_CORRUPT', 'SYNC_FAILED',
]);

/** Every code the app has its own line for (text/en/errors.json), said only for a refusal sent without the flag. */
export const TABLE_CODES: readonly string[] = Object.freeze([...DEVELOPER_TEXT_CODES, ...INTERNAL_LINE_CODES]);

/**
 * How a refusal travels, the one rule for every transport: 'owner' (flagged, its words shown as sent), 'unflagged' (sent
 * without the flag; the app says the code's line, or its general line), or 'internal' (its words are never sent: the
 * transport sends its general sentence, flagged). Only owner: false (InternalError) marks a refusal internal; any other
 * value of `owner` on the error is ignored, so a stray owner: true flags nothing.
 */
export function refusalTravel(code: unknown, message: unknown, owner?: unknown): 'owner' | 'unflagged' | 'internal' {
  if (typeof code !== 'string') return 'internal';
  if (DEVELOPER_TEXT_CODES.includes(code)) return 'unflagged';
  if (owner === false) return INTERNAL_LINE_CODES.includes(code) ? 'unflagged' : 'internal';
  return message === code || typeof message !== 'string' ? 'unflagged' : 'owner';
}

/**
 * Words an owner never needs to read. The app puts an unflagged error that carries one in its general line
 * (app/ui/src/engine/owner-errors.ts), and the owner-words tests ban them from every line a screen shows (the text
 * catalogue, and the words the engine and the fake engine put in their views).
 */
export const DEVELOPER_WORDS: readonly string[] = Object.freeze(['vault', 'credential', 'engine', 'fixture', 'digest', 'npm', 'snapshot', 'adapter', 'envelope', 'gateway', 'probe', 'manifest']);

/**
 * B1 fix round 2 (quality finding 5): the words of an inner error that a refusal may quote ("x.csv is not a readable
 * CSV: A quoted cell was cut short."): a Chausar refusal written for the owner (refusalTravel 'owner'), or a plain
 * one-line sentence with no code, path or developer word in it. Anything else gives null, and the refusal leaves it out.
 */
export function quotable(error: unknown): string | null {
  if (!(error instanceof Error) || typeof error.message !== 'string') return null;
  const message = error.message.trim(), raw = error as Error & { code?: unknown; owner?: unknown };
  if (raw.name === 'ChausarError' && typeof raw.code === 'string') return refusalTravel(raw.code, message, raw.owner) === 'owner' ? message : null;
  if (raw.code !== undefined || !message || message.length > 200 || /[\r\n\\/]/.test(message)) return null;
  return bannedIn(message).length === 0 ? message : null;
}

const DEVELOPER_PATTERN =new RegExp(`\\b(?:${DEVELOPER_WORDS.join('|')})s?\\b`, 'gi');

/**
 * B1 fix round 2 (quality finding 1): the developer words a line uses, each once, in lower case and singular; [] when it
 * has none. Whole words only ("engineer" and "Probe42" are not "engine" and "probe"). The one check for every place that
 * looks: the app's error edge, the catalogue test, and the scans of the engine's and the fake engine's screen words.
 */
export function bannedIn(text: string): string[] {
  return [...new Set([...String(text).matchAll(DEVELOPER_PATTERN)].map(match => match[0].toLowerCase().replace(/s$/, '')))];
}
