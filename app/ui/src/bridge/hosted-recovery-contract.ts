/**
 * Recovery through a contact (FR-13, SH-02, TR-12), as hosted-link serves it (`docs/lanes/hosted-link.md`,
 * "Round 4 contract: recovery through a contact"). All three are `preVault`, desktop only, and refused
 * `DEMO_EXTERNAL_DISABLED` in demo mode.
 *
 * - `hosted.recovery.request` `{ folder? }` → `{ requestId, status: 'waiting', expiresAt, contactChannel }`.
 * - `hosted.recovery.check` `{ requestId, folder? }` → `{ requestId, status, expiresAt?, failure? }`, polled about
 *   once a second. `VAULT_BUSY` while the vault transition runs means "still recovering".
 * - `hosted.recovery.complete` `{ requestId, newPassphrase, folder? }` → `{ requestId, status: 'recovering' }`
 *   (or `'recovered'` when asked again after it finished). The passphrase is 12 to 1024 characters.
 *
 * When `hosted.recovery.request` is absent (`notBuilt`), the lock screen keeps frame-today's own
 * `todayx.recoveryContact.request` and its refusal words.
 */

export const HOSTED_RECOVERY = Object.freeze({
  request: 'hosted.recovery.request',
  check: 'hosted.recovery.check',
  complete: 'hosted.recovery.complete',
});

export type RecoveryChannel = 'mail' | 'whatsapp';
export type RecoveryStatus = 'waiting' | 'confirmed' | 'declined' | 'expired' | 'failed' | 'released' | 'recovering' | 'recovered';
export const RECOVERY_STATUSES: readonly RecoveryStatus[] = ['waiting', 'confirmed', 'declined', 'expired', 'failed', 'released', 'recovering', 'recovered'];

export interface RecoveryRequestReply { readonly requestId: string; readonly status: 'waiting'; readonly expiresAt: string; readonly contactChannel: RecoveryChannel }
export interface RecoveryCheckReply { readonly requestId: string; readonly status: RecoveryStatus; readonly expiresAt?: string; readonly failure?: string }
export interface RecoveryCompleteReply { readonly requestId: string; readonly status: 'recovering' | 'recovered' }

/** The refusals the lock screen names in its own words (on frame-today's `laneRefusals` line too). */
export const HOSTED_RECOVERY_REFUSALS = [
  'DEMO_EXTERNAL_DISABLED', 'OPEN_DESKTOP', 'HOSTED_NOT_CONFIGURED', 'HOSTED_UNREACHABLE', 'RECOVERY_NOT_ENROLLED', 'RECOVERY_REQUEST_LIMITED',
  'RECOVERY_CREDENTIAL_INVALID', 'RECOVERY_FILE_INVALID', 'RECOVERY_KEY_RELEASED', 'RECOVERY_DECLINED', 'RECOVERY_EXPIRED', 'RECOVERY_NOT_CONFIRMED',
  'RECOVERY_IN_PROGRESS', 'RECOVERY_REQUEST_NOT_FOUND', 'RECOVERY_CODE_REJECTED', 'WEAK_PASSPHRASE', 'VAULT_OPEN', 'VAULT_BUSY',
] as const;

/** The new passphrase's length, as the engine checks it (UTF-16 units). */
export const PASSPHRASE_MIN = 12, PASSPHRASE_MAX = 1024;

const REQUEST_ID = /^rcr_[0-9a-f-]{36}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value: Rec, required: readonly string[], optional: readonly string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const instant = (value: unknown): value is string => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value));

export const isRecoveryRequestId = (value: unknown): value is string => typeof value === 'string' && REQUEST_ID.test(value);

export function isRecoveryRequestReply(value: unknown): value is RecoveryRequestReply {
  return isRec(value) && only(value, ['requestId', 'status', 'expiresAt', 'contactChannel']) && isRecoveryRequestId(value['requestId'])
    && value['status'] === 'waiting' && instant(value['expiresAt']) && (value['contactChannel'] === 'mail' || value['contactChannel'] === 'whatsapp');
}

/** A check reply for this request: its id must match. */
export function isRecoveryCheckReply(value: unknown, requestId: string): value is RecoveryCheckReply {
  return isRec(value) && only(value, ['requestId', 'status'], ['expiresAt', 'failure']) && value['requestId'] === requestId
    && RECOVERY_STATUSES.includes(value['status'] as RecoveryStatus)
    && (value['expiresAt'] === undefined || instant(value['expiresAt']))
    && (value['failure'] === undefined || (typeof value['failure'] === 'string' && CODE.test(value['failure'])));
}

export function isRecoveryCompleteReply(value: unknown, requestId: string): value is RecoveryCompleteReply {
  return isRec(value) && only(value, ['requestId', 'status']) && value['requestId'] === requestId && (value['status'] === 'recovering' || value['status'] === 'recovered');
}

/** Statuses the screen keeps polling through. */
export const pollingStatus = (status: RecoveryStatus): boolean => status === 'waiting' || status === 'recovering';
/** Statuses that ask for the new passphrase. */
export const passphraseStatus = (status: RecoveryStatus): boolean => status === 'confirmed' || status === 'released';
