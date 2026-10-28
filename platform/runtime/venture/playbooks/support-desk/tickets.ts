// Ticket states and owner mail handoff. Ideas: nexusdesk (Apache-2.0), ResolveHQ (source-available, ideas only), RFC 5322. No copied code.
import { check } from '../../../contracts.ts';
import type { SupportTicketBody, SupportRequestBody, TicketStatus } from './records.ts';

export type TicketInput = { thread: string; customerEmail: string; subject: string; language: string; blocked: boolean };
export type TicketProposal = TicketInput & { dedupKey: string; expiresAt: string };
const NEXT: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['in-progress', 'closed'], 'in-progress': ['waiting-customer', 'resolved', 'closed'],
  'waiting-customer': ['in-progress', 'closed'], resolved: ['in-progress', 'closed'], closed: [],
};
/** A proposal creates nothing, expires after half an hour, and deduplicates by conversation. */
export function proposeTicket(input: TicketInput, now: string, existing: readonly Pick<SupportTicketBody, 'thread'>[] = []): TicketProposal {
  check(input && typeof input.thread === 'string' && input.thread.length > 0 && input.thread.length <= 120, 'INVALID_VENTURE_REQUEST', 'Choose a mail conversation.');
  check(typeof input.customerEmail === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.customerEmail), 'INVALID_VENTURE_REQUEST', 'The customer needs a valid email address.');
  check(typeof input.subject === 'string' && input.subject.trim().length > 0 && input.subject.length <= 200 && !/[\r\n]/.test(input.subject), 'INVALID_VENTURE_REQUEST', 'Keep the subject to a short line.');
  check(typeof input.language === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(input.language) && typeof input.blocked === 'boolean', 'INVALID_VENTURE_REQUEST', 'Choose the customer language and blocked state.');
  check(!existing.some(t => t.thread === input.thread), 'TICKET_DUPLICATE', 'This conversation already has a ticket.');
  check(Number.isFinite(Date.parse(now)), 'INVALID_VENTURE_REQUEST', 'The proposal needs a valid time.');
  return { ...input, customerEmail: input.customerEmail.toLowerCase(), subject: input.subject.trim(), dedupKey: input.thread, expiresAt: new Date(Date.parse(now) + 30 * 60000).toISOString() };
}
/** Confirms an unexpired proposal only once the conversation has no active run. */
export function confirmTicket(p: TicketProposal, now: string, active: boolean): SupportTicketBody {
  check(Date.parse(now) < Date.parse(p.expiresAt), 'TICKET_EXPIRED', 'This ticket proposal expired. Review a fresh proposal.');
  check(!active, 'TICKET_RUN_ACTIVE', 'Wait for this conversation run to stop before confirming the ticket.');
  return { thread: p.thread, customerEmail: p.customerEmail, subject: p.subject, language: p.language, blocked: p.blocked, status: 'open', revision: 1, note: '', autoDraftsPaused: p.blocked, dueAt: null, resolutionDueAt: null, snoozedAt: null, snoozeUntil: null, snoozeReason: null, draft: null, sentAt: null, messages: [], policyChangeApproved: false };
}
/** Owner status changes check the revision; closing is final and a resolution needs a note. */
export function moveTicket<T extends SupportTicketBody>(ticket: T, revision: number, status: TicketStatus, note: string): T {
  check(ticket.revision === revision, 'TICKET_STALE', 'This ticket changed. Open it again before deciding.');
  check(ticket.status !== 'closed', 'TICKET_CLOSED', 'A closed ticket stays closed. Start a new conversation.');
  check(NEXT[ticket.status].includes(status), 'TICKET_TRANSITION_REFUSED', 'That ticket move is not allowed.');
  check(typeof note === 'string' && note.length <= 2000, 'INVALID_VENTURE_REQUEST', 'Keep the note short.');
  check(!['resolved', 'closed'].includes(status) || note.trim().length > 0, 'TICKET_NOTE_REQUIRED', 'Add a note before resolving or closing this ticket.');
  return { ...ticket, status, note: note.trim(), revision: revision + 1 };
}
/** Requested money is text from the customer, never an executed refund or a computed figure. */
export function requestMoney(input: { kind: 'refund' | 'replacement'; amountText: string; currency: string }): { kind: 'refund' | 'replacement'; amountText: string; currency: string; state: 'requested, not done' } {
  check(['refund', 'replacement'].includes(input.kind) && typeof input.amountText === 'string' && /^\d{1,12}(?:\.\d{1,2})?$/.test(input.amountText) && /^[A-Z]{3}$/.test(input.currency), 'INVALID_VENTURE_REQUEST', 'A request needs its kind, amount text and currency.');
  return { ...input, state: 'requested, not done' };
}
/** A saved draft cannot imply a money action or delivery that has not happened. */
export function checkSupportDraft(text: string): { pass: boolean; why: string } {
  const honest=text.replace(/\b(?:not|never|haven't|hasn't|wasn't|weren't|isn't|aren't)\s+(?:(?:yet|been|being|already)\s+)*(?:refunded|reimbursed|processed|issued|sent|completed|credited|done|delivered)\b/gi,'pending');
  const done = /\b(?:refunded|reimbursed)\b|\b(?:processed|issued|sent|completed|credited)\b[^.!?\n]{0,40}\b(?:refund|payment|replacement)\b|\b(?:refund|payment|replacement)\b[^.!?\n]{0,55}\b(?:processed|issued|sent|completed|credited|done)\b|\b(?:reply|message|email)\b[^.!?\n]{0,40}\b(?:delivered|sent)\b|(?:रिफंड|भुगतान|वापसी)[^।\n]{0,40}(?:कर दिया|हो गया|भेज दिया)|\b(?:will|shall|guarantee)\b[^.!?\n]{0,35}\b(?:refund|pay|reimburse)\b/i.test(honest);
  return { pass: !done, why: done ? 'A request is not a completed money action, and saving is not sending.' : 'No unperformed money action or send is claimed.' };
}
export type MailDraft = { replyTo?:string; to: string; subject: string; text: string; messageId: string | null; references: readonly string[] };
/** An unsent RFC mail file and mailto link. Nothing here sends mail. */
export function sendHandoff(input: MailDraft): { eml: string; mailto: string; text: string; sent: false } {
  for (const value of [input.to, input.replyTo??'', input.subject, input.messageId ?? '', ...input.references]) check(!/[\r\n]/.test(value), 'SUPPORT_HEADER_REFUSED', 'A mail header cannot contain another line.');
  check(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to), 'SUPPORT_HEADER_REFUSED', 'Choose the customer email address.');
  for (const id of [...input.references, ...(input.messageId ? [input.messageId] : [])]) check(/^<[^\s<>]+@[^\s<>]+>$/.test(id), 'SUPPORT_HEADER_REFUSED', 'A threading id must be a mail Message-ID.');
  const refs = [...new Set([...input.references, ...(input.messageId ? [input.messageId] : [])])];
  if(input.replyTo)check(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.replyTo),'SUPPORT_HEADER_REFUSED','Choose a valid reply address.');
  const headers = [`To: ${input.to}`, ...(input.replyTo?[`Reply-To: ${input.replyTo}`]:[]), `Subject: ${input.subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'X-Unsent: 1', ...(input.messageId ? [`In-Reply-To: ${input.messageId}`] : []), ...(refs.length ? [`References: ${refs.join(' ')}`] : [])];
  return { eml: `${headers.join('\r\n')}\r\n\r\n${input.text.replace(/\r?\n/g, '\r\n')}`, mailto: `mailto:${encodeURIComponent(input.to)}?subject=${encodeURIComponent(input.subject)}&body=${encodeURIComponent(input.text)}`, text: input.text, sent: false };
}
