// One-shot A1 (row 0): what a failed request says to the owner. Only Chausar's own refusals keep their words: a
// ChausarError, or (review of A1) a plain error that carries one of the engine's own codes, from an explicit list. An
// upper-case code alone is not enough: a network library's (undici's UND_ERR_CONNECT_TIMEOUT) carries a host and port in
// its message. Anything else (a TypeError, a Node file error with a path in it) becomes one plain sentence, so engine
// source text, stack lines, hosts and paths never reach a screen. The local server and the desktop engine worker answer
// this way.
import { ChausarError } from './contracts.ts';
import { VENTURE_ERRORS } from './venture/contracts.ts';
import { CUSTODY_ERRORS } from './workspace-custody-contracts.ts';
import type { PhoneErrorCode } from './phone/contracts.ts';

export const UNEXPECTED_CODE = 'REQUEST_FAILED';
export const UNEXPECTED_WORDS = 'Something went wrong in Chausar, so this did not finish. Nothing was sent. Try again, and if it keeps happening, send feedback from Settings.';

/** The engine's own codes that it also puts on plain errors (Object.assign(new Error(words), { code })). */
const ENGINE_PLAIN_CODES = ['UNAUTHENTICATED', 'PAIRING_FORBIDDEN', 'SOCIAL_INPUT_INVALID', 'SOCIAL_SOURCE_INVALID', 'UNIT_ECONOMICS_HOLD', 'MONITOR_INVALID', 'COMMUNITY_RULES_REQUIRED', 'COMMUNITY_NO_GO'] as const;
/** The phone protocol's own refusals (phone/contracts.ts PhoneError, whose words are its code). */
const PHONE_CODES = ['OFFLINE', 'VALIDATION_REQUIRED', 'ACCESS_REVOKED', 'SESSION_EXPIRED', 'UNPAIRED', 'INVALID_RESPONSE', 'INVALID_REQUEST', 'CHANNEL_FORBIDDEN', 'CAPABILITY_FORBIDDEN', 'APPROVAL_EXPIRED', 'APPROVAL_USED', 'PREVIEW_CHANGED', 'OPEN_DESKTOP', 'REQUEST_EXISTS', 'TRANSPORT_UNKNOWN', 'CACHE_INVALID'] as const satisfies readonly PhoneErrorCode[];
const OWN_CODES: ReadonlySet<string> = new Set<string>([...VENTURE_ERRORS, ...CUSTODY_ERRORS, ...ENGINE_PLAIN_CODES, ...PHONE_CODES]);
/** The engine's own error classes that carry their own code and owner words (playbook desks and the phone protocol). */
const OWN_CLASSES: ReadonlySet<string> = new Set(['PhoneError', 'DevError', 'NewsletterError', 'ArticleError', 'RecruitError']);

export type OwnerError = { code: string; message: string; reason?: string };

/** True for an error whose words are Chausar's own. */
export function knownError(error: unknown): boolean {
  if (error instanceof ChausarError) return true;
  const raw = error as { code?: unknown; syscall?: unknown; errno?: unknown; message?: unknown; name?: unknown } | null;
  return typeof raw?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(raw.code) && (OWN_CODES.has(raw.code) || (typeof raw.name === 'string' && OWN_CLASSES.has(raw.name)))
    && raw.syscall === undefined && raw.errno === undefined && typeof raw.message === 'string';
}

/** The code, words and (when it is a short plain tag) reason a reply may carry. */
export function ownerError(error: unknown): OwnerError {
  if (!knownError(error)) return { code: UNEXPECTED_CODE, message: UNEXPECTED_WORDS };
  const e = error as { code: string; message: string; reason?: unknown };
  return { code: e.code, message: e.message, ...(typeof e.reason === 'string' && /^[a-z-]{1,32}$/.test(e.reason) ? { reason: e.reason } : {}) };
}
