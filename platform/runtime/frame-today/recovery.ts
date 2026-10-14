/**
 * The recovery contact (FR-13, SH-02, TR-12): a person the owner names, and how to reach them.
 * This is personal data about someone else, so it lives only in the encrypted workspace (the
 * frame module's namespace), is never echoed into an error, an audit entry or the fault report,
 * and is shown only to an admin.
 *
 * Asking the contact to confirm a recovery needs the hosted relay (hosted-link lane), which is
 * not deployed. Until it is, the request is refused with a typed code and nothing is sent.
 */
import { ChausarError, check } from '../contracts.ts';

export interface RecoveryContact { readonly name: string; readonly reach: string; readonly savedAt: string }

const plain = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);

/** `{ contact: { name, reach } }` to name someone, `{ contact: null }` to remove them. */
export function recoveryContactInput(payload: Record<string, unknown>, savedAt: string): RecoveryContact | null {
  check(Object.keys(payload).length === 1 && Object.hasOwn(payload, 'contact'), 'INVALID_TODAYX_REQUEST', 'Give the contact, or null to remove them.');
  const contact = payload.contact;
  if (contact === null) return null;
  check(contact !== null && typeof contact === 'object' && !Array.isArray(contact) && Object.keys(contact).sort().join(',') === 'name,reach',
    'RECOVERY_CONTACT_INVALID', 'Give the contact\'s name and how to reach them.');
  const { name, reach } = contact as Record<string, unknown>;
  check(plain(name, 100) && plain(reach, 200), 'RECOVERY_CONTACT_INVALID', 'A name up to 100 characters and a way to reach them up to 200, on one line.');
  return Object.freeze({ name: name.trim(), reach: reach.trim(), savedAt });
}

/** The reply for get and set: the contact, and that confirming through them needs the relay. */
export const recoveryContactReply = (contact: RecoveryContact | null) =>
  ({ contact: contact === null ? null : { ...contact }, confirmation: 'relay-required' as const });

/** Starting recovery through the contact: always refused until the hosted relay exists. */
export function requestRecoveryThroughContact(payload: Record<string, unknown>): never {
  check(Object.keys(payload).every(key => key === 'folder') && (payload.folder === undefined || (typeof payload.folder === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(payload.folder))),
    'INVALID_TODAYX_REQUEST', 'Name the workspace folder, or nothing.');
  throw new ChausarError('RECOVERY_CONTACT_RELAY_REQUIRED', 'A recovery contact confirms through the hosted relay, which is not available yet. Use your recovery kit.');
}
