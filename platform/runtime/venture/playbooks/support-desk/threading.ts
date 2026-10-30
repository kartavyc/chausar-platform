// Signed reply addresses and reference threading. ResolveHQ (source-available) ideas only, RFC 5322; original code.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { check } from '../../../contracts.ts';
export type ThreadTicket = { id: string; number: string; customerEmail: string; messageIds: readonly string[] };
export type InboundThread = { sender: string; messageId: string | null; references: readonly string[]; to: string; subject: string };
function token(id: string, secret: string): string { return createHmac('sha256', secret).update(`support-reply:${id}`).digest('hex').slice(0,32); }
/** A local reply address authenticated with a server-held HMAC key, never a visible ticket number. */
export function signedReplyAddress(id: string, mailbox: string, secret: string): string {
  check(/^[A-Za-z0-9_-]{1,80}$/.test(id) && /^[^\s@+]+@[^\s@]+$/.test(mailbox) && secret.length >= 16, 'SUPPORT_THREAD_INVALID', 'A reply address needs a ticket, mailbox and local signing key.');
  const at = mailbox.lastIndexOf('@');
  check(at+35<=64,'SUPPORT_THREAD_INVALID','Use a shorter shop mailbox name for signed reply addresses.');
  return `${mailbox.slice(0,at)}+s.${token(id,secret)}${mailbox.slice(at)}`;
}
/** Reference ids take priority; a plain number can only identify this sender's own ticket. */
export function threadMessage(mail: InboundThread, tickets: readonly ThreadTicket[], secret: string): { ticketId: string | null; via: 'reference' | 'signed-address' | 'customer-number' | 'new' } {
  for (const ref of [...mail.references].reverse()) {
    const ticket=tickets.find(t=>t.messageIds.includes(ref));
    if(ticket)return {ticketId:ticket.id,via:'reference'};
  }
  if (mail.messageId) { const duplicate=tickets.find(t=>t.messageIds.includes(mail.messageId!)); if(duplicate)return {ticketId:duplicate.id,via:'reference'}; }
  const match=/\+s\.([a-f0-9]{32})@/i.exec(mail.to);
  if(match&&secret.length>=16){const given=Buffer.from(match[1]!.toLowerCase());for(const ticket of tickets){const expected=Buffer.from(token(ticket.id,secret));if(expected.length===given.length&&timingSafeEqual(expected,given))return {ticketId:ticket.id,via:'signed-address'};}}
  for(const number of mail.subject.matchAll(/(?:^|\s)#(\d{1,12})(?=\s|$|[.,:!?])/g)){
    const ticket=tickets.find(t=>t.number===number[1]&&t.customerEmail.toLowerCase()===mail.sender.toLowerCase());
    if(ticket)return {ticketId:ticket.id,via:'customer-number'};
  }
  return {ticketId:null,via:'new'};
}
