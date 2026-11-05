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
 * Words an owner never needs to read. The app puts an unflagged error that carries one in its general line
 * (app/ui/src/engine/owner-errors.ts), and the owner-words tests ban them from every line a screen shows (the text
 * catalogue, and the words the engine and the fake engine put in their views).
 */
export const DEVELOPER_WORDS: readonly string[] = Object.freeze(['vault', 'credential', 'engine', 'fixture', 'digest', 'npm', 'snapshot', 'adapter', 'envelope', 'gateway', 'probe', 'manifest']);

const DEVELOPER_PATTERN = new RegExp(`\\b(?:${DEVELOPER_WORDS.join('|')})s?\\b`, 'gi');

/**
 * B1 fix round 2 (quality finding 1): the developer words a line uses, each once, in lower case and singular; [] when it
 * has none. Whole words only ("engineer" and "Probe42" are not "engine" and "probe"). The one check for every place that
 * looks: the app's error edge, the catalogue test, and the scans of the engine's and the fake engine's screen words.
 */
export function bannedIn(text: string): string[] {
  return [...new Set([...String(text).matchAll(DEVELOPER_PATTERN)].map(match => match[0].toLowerCase().replace(/s$/, '')))];
}
