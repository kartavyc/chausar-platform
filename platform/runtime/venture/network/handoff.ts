// Chausar venture launcher, network (Ink v2 wave 4, package 4E2): the handoff that puts a draft in the owner's own app
// (catalogue C8). Chausar never sends: mail opens the owner's mail app with the address, subject and body filled in
// (mailto); LinkedIn hands back the profile address and the text, which the screen copies before it opens the profile
// in the owner's browser, where the owner clicks Connect or Message and pastes; WhatsApp opens click-to-chat (wa.me)
// with the text filled in, and the owner presses send. No LinkedIn page is read and nothing is automated there.
// An intro request's handoff carries the note and, below it, the blurb the connector can forward. A link longer than
// the desktop opens (30,000 characters, app/desktop/ipc-contract.cjs) becomes "copy the text", as LinkedIn always is.
// Opening records nothing: every handoff says that Chausar counts only the notes the owner marks as sent.
import { check } from '../../contracts.ts';
import type { OutreachChannel, OutreachHandoff, OutreachRecord } from '../contracts.ts';
import { BLURB_HEADING } from './outreach-templates.ts';
import { normalLinkedIn } from './text.ts';

const MAIL_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;
const E164 = /^\+[1-9]\d{6,14}$/;
/** The longest link the desktop opens (MAX_EXTERNAL_URL in app/desktop/ipc-contract.cjs). */
export const MAX_HANDOFF_URL = 30_000;
/** What every handoff says after what it does. */
export const COUNTED_LINE = 'Chausar sends nothing here, and counts only the notes you mark as sent.';
const APP: Readonly<Record<OutreachChannel, string>> = Object.freeze({ email: 'your mail app', linkedin: 'LinkedIn', whatsapp: 'WhatsApp' });

/**
 * The sheet's engine words for a draft (OutreachView.line): Chausar never sends, what the handoff does on its channel,
 * and that only the notes the owner marks as sent count.
 */
export function sendLine(channel: OutreachChannel): string {
  const does = channel === 'linkedin' ? 'It copies the text and opens the LinkedIn profile' : `It opens ${APP[channel]} with the text filled in`;
  return `Chausar never sends. ${does}, and counts only the notes you mark as sent.`;
}

/** The words a handoff carries: the note, and for an intro request the forwardable blurb below its heading. */
export function handoffText(record: Pick<OutreachRecord, 'outreachKind' | 'text' | 'blurb' | 'language'>): string {
  if (record.outreachKind !== 'intro-request' || !record.blurb) return record.text;
  return `${record.text}\n\n${BLURB_HEADING[record.language ?? 'en']}\n${record.blurb}`;
}

/** An address as a mailto link writes it: every character encoded but the @, so a % or a + in it stays itself. */
export const mailtoAddress = (to: string): string => encodeURIComponent(to).replace(/%40/g, '@');

/**
 * A mailto link with one address, the subject and the body; new lines go as CRLF, as mail apps read them. The same
 * spelling the desktop rebuilds before it opens one, so the link it opens is exactly this one.
 */
export function mailtoUrl(to: string, subject: string | null, body: string): string {
  check(MAIL_ADDRESS.test(to), 'INVALID_VENTURE_REQUEST', 'This draft has no email address Chausar can open.');
  const query = [...(subject ? [`subject=${encodeURIComponent(subject)}`] : []), `body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`].join('&');
  return `mailto:${mailtoAddress(to)}?${query}`;
}

/** WhatsApp click-to-chat: the phone in E.164 digits (no plus) and the text filled in. */
export function whatsappUrl(phone: string, text: string): string {
  check(E164.test(phone), 'OUTREACH_NO_PHONE', 'This draft has no phone number WhatsApp can open.');
  return new URL(`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`).href;
}

/** The fallback for a message too long for one link: the owner copies the text into their app. */
function copyInstead(channel: Exclude<OutreachChannel, 'linkedin'>, to: string, subject: string | null, text: string): OutreachHandoff {
  const where = channel === 'email' ? `Copy the text into a new email to ${to}.` : `Copy the text into a WhatsApp chat with ${to}.`;
  return { action: 'copy', to, subject, text, line: `This is too long to open in ${APP[channel]} in one link. ${where} ${COUNTED_LINE}` };
}

/** A mail handoff: the mailto link, or the text to copy when the link is longer than the desktop opens. */
export function mailHandoff(to: string, subject: string | null, text: string): OutreachHandoff {
  const url = mailtoUrl(to, subject, text);
  return url.length > MAX_HANDOFF_URL ? copyInstead('email', to, subject, text) : { action: 'mailto', url, line: `Opens your mail app with the text filled in. ${COUNTED_LINE}` };
}

/** The one handoff of a stored draft, from its own address, with its line. Sends nothing. */
export function handoffFor(record: OutreachRecord): OutreachHandoff {
  const text = handoffText(record);
  const to = record.to ?? '';
  if (record.channel === 'linkedin') {
    const profileUrl = normalLinkedIn(to);
    check(profileUrl, 'OUTREACH_NO_PROFILE', 'This draft has no LinkedIn page Chausar can open.');
    const what = record.outreachKind === 'connection-note' ? 'Copy the note, then open the profile and paste it into Connect.' : 'Copy the message, then open the profile and paste it into Message.';
    return { action: 'linkedin', profileUrl, text, line: `${what} ${COUNTED_LINE}` };
  }
  if (record.channel === 'email') return mailHandoff(to, record.subject, text);
  const url = whatsappUrl(to, text);
  return url.length > MAX_HANDOFF_URL ? copyInstead('whatsapp', to, null, text) : { action: 'whatsapp', url, line: `Opens WhatsApp with the text filled in. ${COUNTED_LINE}` };
}
