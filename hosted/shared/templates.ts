/**
 * The fixed message catalogue. A message is a headline and a link: no amounts, counts, names or money dates.
 * The desktop keeps an identical copy in platform/runtime/hosted-link/templates.ts; a test compares them.
 * Nothing here may contain a digit, and the link origin is checked to be digit-free too.
 */
export const MESSAGE_EVENTS = ['week-ahead-ready', 'review-ready', 'document-received', 'due-date-near'] as const;
export type MessageEvent = typeof MESSAGE_EVENTS[number];
export const CHANNELS = ['whatsapp', 'telegram', 'mail'] as const;
export type Channel = typeof CHANNELS[number];
export const DESTINATIONS = ['briefs', 'approvals', 'uploads', 'calendar'] as const;
export type Destination = typeof DESTINATIONS[number];

export const HEADLINES: Readonly<Record<MessageEvent, string>> = Object.freeze({
  'week-ahead-ready': 'The week ahead is ready.',
  'review-ready': 'Something is ready for your review.',
  'document-received': 'A document was received.',
  'due-date-near': 'A due date is near.',
});
export const DESTINATION_OF: Readonly<Record<MessageEvent, Destination>> = Object.freeze({
  'week-ahead-ready': 'briefs', 'review-ready': 'approvals', 'document-received': 'uploads', 'due-date-near': 'calendar',
});
/** WhatsApp template names registered with Meta (lower case letters and underscores only). */
export const WHATSAPP_TEMPLATE: Readonly<Record<MessageEvent, string>> = Object.freeze({
  'week-ahead-ready': 'chausar_week_ahead_ready', 'review-ready': 'chausar_review_ready',
  'document-received': 'chausar_document_received', 'due-date-near': 'chausar_due_date_near',
});
export const BUTTONS = Object.freeze({ approve: 'Approve', notNow: 'Not now', open: 'Open the app', confirm: 'Confirm' });
export const REPLIES = Object.freeze({
  freeText: 'Open Chausar on your computer to see this. Reply HELP for a person, STOP to end messages.',
  help: 'A person from Chausar will reply to you here. Reply STOP to end messages.',
  stop: 'Chausar messages are stopped. Turn them on again in the app on your computer.',
  start: 'Chausar messages are on. Reply HELP for a person, STOP to end messages.',
  approved: 'Approved. Open Chausar on your computer to see the result.',
  notNow: 'Left for later. It is still waiting in the app.',
  buttonGone: 'This button no longer works. Open Chausar on your computer.',
  documentReceived: 'Document received.',
});
export const LINK_PAGE = Object.freeze({
  title: 'Chausar',
  open: 'Open Chausar on your computer to see this.',
  gone: 'This link no longer works.',
  confirmApprove: 'Approve this one small change?',
  confirmNotNow: 'Leave this for later?',
  done: 'Done. Open Chausar on your computer to see the result.',
  confirmAddress: 'Confirm this address for Chausar messages?',
  addressConfirmed: 'This address is confirmed. Chausar messages will come here.',
});
export const MAIL_FOOTER = 'Reply HELP for a person, STOP to end messages. Chausar never asks you to reply yes.';
/** Mail-only fixed texts: the one address confirmation (headline, link, note) and the subject of a fixed reply. */
export const MAIL_TEXT = Object.freeze({
  confirmHeadline: 'Confirm this address for Chausar messages.',
  confirmNote: 'Open the link and press Confirm. The link works once and stops working after a day. If you did not ask for this, ignore this mail.',
  replySubject: 'Chausar messages',
});
/** The exact confirmation mail body. */
export function confirmationBody(link: string): string {
  return [MAIL_TEXT.confirmHeadline, link, '', MAIL_TEXT.confirmNote].join('\n');
}
/** The opt-in wording the desktop shows; the relay stores its hash with the opt-in. */
export const OPT_IN_TEXT: Readonly<Record<Channel, string>> = Object.freeze({
  whatsapp: 'Send me Chausar messages on WhatsApp: a headline and a link, about thirty a month. I can reply STOP at any time.',
  telegram: 'Send me Chausar messages on Telegram: a headline and a link, about thirty a month. I can send STOP at any time.',
  mail: 'Send me Chausar messages by mail: a headline and a link, about thirty a month. I can reply STOP at any time.',
});
/** Any decimal digit in any script (Unicode Nd), not only ASCII. */
export const hasDigit = (text: string) => /\p{Nd}/u.test(text);
/** The exact body a person sees for one message. */
export function messageBody(event: MessageEvent, link: string, channel: Channel): string {
  const lines = [HEADLINES[event], link];
  if (channel === 'mail') lines.push('', MAIL_FOOTER);
  return lines.join('\n');
}
/**
 * Recovery through a contact (FR-13): the one fixed message to the contact, the fixed notice to the owner and the
 * words of the /r/ link page. No name, amount or digit. WhatsApp needs two more approved templates (a founder item):
 * `chausar_recovery_confirm` (the contact line, with a URL button whose suffix is the link token) and
 * `chausar_recovery_requested` (the owner line, no button).
 */
export const RECOVERY_TEXT = Object.freeze({
  contactSubject: 'Someone named you to confirm a Chausar recovery.',
  contactLine: 'Someone asked to recover their Chausar workspace and named you to confirm. Confirm only if they asked you directly.',
  contactNote: 'Open the link and choose Confirm or I did not ask. The link works once and stops working after a day.',
  ownerSubject: 'A recovery of your Chausar workspace was asked for.',
  ownerLine: 'A recovery of your Chausar workspace was asked for through your recovery contact. If this was not you, open Chausar on your computer and remove the recovery contact.',
  pageAsk: 'Did the person who named you ask you directly to confirm their Chausar recovery?',
  confirm: 'Confirm',
  decline: 'I did not ask',
  pageConfirmed: 'Confirmed. They can finish their recovery on their computer now.',
  pageDeclined: 'Thank you. The recovery was stopped.',
});
export const WHATSAPP_RECOVERY_TEMPLATE = Object.freeze({ contact: 'chausar_recovery_confirm', owner: 'chausar_recovery_requested' });
/** The exact mail body the contact gets. */
export function recoveryContactBody(link: string): string {
  return [RECOVERY_TEXT.contactLine, link, '', RECOVERY_TEXT.contactNote].join('\n');
}
