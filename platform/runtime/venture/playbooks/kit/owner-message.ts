// Chausar playbook kit (wave 6, 6E2 and 6E3): a message the owner sends from their own app. The lesson desk's parent
// updates and the booking desk's reminders are drafted here by fixed templates or typed by the owner; Chausar never
// sends them. After the owner approves the exact words (the action journal's owner.handoff, bound to the message
// digest), the handoff opens the owner's mail app (mailto) or WhatsApp click-to-chat (wa.me) with the words filled in,
// the same links network/handoff.ts builds for outreach. Portable: no Node built-ins, so the fake engine builds the same
// links and digests. Written for Chausar; nothing here is learned from an outside source.
import { check, digest } from '../../../portable.ts';

/** How the owner sends one message. */
export type OwnerChannel = 'email' | 'whatsapp';
export const OWNER_CHANNELS: readonly OwnerChannel[] = Object.freeze(['email', 'whatsapp']);

/** What a handoff gives the screen: a link to open, or the words to copy when the link would be too long. */
export type OwnerHandoff =
  | { action: 'mailto' | 'whatsapp'; url: string; text: string; line: string }
  | { action: 'copy'; url: null; text: string; line: string };

const MAIL_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;
const E164 = /^\+[1-9]\d{6,14}$/;
/** The longest link the desktop opens (MAX_EXTERNAL_URL in app/desktop/ipc-contract.cjs; network/handoff.ts). */
const MAX_URL = 30_000;
export const SENDS_NOTHING = 'Chausar sends nothing. You send it from your own app.';

/** A phone the owner typed for WhatsApp, in E.164 (+919812345678), or null when left out. */
export function ownerPhone(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  check(typeof value === 'string', 'INVALID_VENTURE_REQUEST', 'Type the phone as +91 and the number.');
  const phone = value.replace(/[\s()-]/g, '');
  check(E164.test(phone), 'INVALID_VENTURE_REQUEST', 'Type the phone as +91 and the number.');
  return phone;
}

/** The exact identity the owner approves: who it goes to, how, and every word. */
export function messageDigest(message: { channel: OwnerChannel; to: string | null; subject: string | null; text: string }): string {
  return digest({ channel: message.channel, to: message.to, subject: message.subject, text: message.text });
}

/**
 * The handoff for one approved message. Email needs the address; WhatsApp opens the chat with the phone when there is
 * one, or the share screen where the owner picks the chat. A link past the desktop's limit becomes words to copy.
 */
export function ownerHandoff(message: { channel: OwnerChannel; to: string | null; subject: string | null; text: string }): OwnerHandoff {
  if (message.channel === 'email') {
    check(message.to !== null && MAIL_ADDRESS.test(message.to), 'OWNER_MESSAGE_NO_ADDRESS', 'This client has no email address. Add one, or send it on WhatsApp.');
    const encoded = encodeURIComponent(message.to).replace(/%40/g, '@');
    const query = [...(message.subject ? [`subject=${encodeURIComponent(message.subject)}`] : []), `body=${encodeURIComponent(message.text.replace(/\r?\n/g, '\r\n'))}`].join('&');
    const url = `mailto:${encoded}?${query}`;
    return url.length > MAX_URL
      ? { action: 'copy', url: null, text: message.text, line: `Copy the words into a new email. ${SENDS_NOTHING}` }
      : { action: 'mailto', url, text: message.text, line: `Opens your mail app with the words filled in. ${SENDS_NOTHING}` };
  }
  check(message.to === null || E164.test(message.to), 'INVALID_VENTURE_REQUEST', 'Type the phone as +91 and the number.');
  const url = message.to ? `https://wa.me/${message.to.slice(1)}?text=${encodeURIComponent(message.text)}` : `https://wa.me/?text=${encodeURIComponent(message.text)}`;
  return url.length > MAX_URL
    ? { action: 'copy', url: null, text: message.text, line: `Copy the words into WhatsApp. ${SENDS_NOTHING}` }
    : { action: 'whatsapp', url, text: message.text, line: `Opens WhatsApp with the words filled in. ${SENDS_NOTHING}` };
}
