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
export const BUTTONS = Object.freeze({ approve: 'Approve', notNow: 'Not now', open: 'Open the app' });
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
});
export const MAIL_FOOTER = 'To stop these messages, turn mail off in Chausar on your computer. Chausar never asks you to reply yes.';
/** The opt-in wording the desktop shows; the relay stores its hash with the opt-in. */
export const OPT_IN_TEXT: Readonly<Record<Channel, string>> = Object.freeze({
  whatsapp: 'Send me Chausar messages on WhatsApp: a headline and a link, about thirty a month. I can reply STOP at any time.',
  telegram: 'Send me Chausar messages on Telegram: a headline and a link, about thirty a month. I can send STOP at any time.',
  mail: 'Send me Chausar messages by mail: a headline and a link, about thirty a month. I can reply STOP at any time.',
});
export const hasDigit = (text: string) => /[0-9٠-٩۰-۹०-९]/.test(text);
/** The exact body a person sees for one message. */
export function messageBody(event: MessageEvent, link: string, channel: Channel): string {
  const lines = [HEADLINES[event], link];
  if (channel === 'mail') lines.push('', MAIL_FOOTER);
  return lines.join('\n');
}
