// Support ticket behavior, learned from nexusdesk (Apache-2.0); independently written for Chausar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeTicket, confirmTicket, moveTicket, requestMoney, checkSupportDraft, sendHandoff } from '../runtime/venture/playbooks/support-desk/tickets.ts';
const at = '2026-10-27T10:00:00.000Z';
const input = { thread: 'thread_a', customerEmail: 'buyer@example.com', subject: 'Parcel late', language: 'en', blocked: false };
const code = (code: string) => (error: any) => error?.code === code;
test('ticket proposals expire, deduplicate by thread, and cannot confirm while a conversation is active', () => {
  const p = proposeTicket(input, at);
  assert.equal(p.dedupKey, 'thread_a');
  assert.equal(p.expiresAt, '2026-10-27T10:30:00.000Z');
  assert.throws(() => confirmTicket(p, '2026-10-27T10:30:00.000Z', false), code('TICKET_EXPIRED'));
  assert.throws(() => confirmTicket(p, at, true), code('TICKET_RUN_ACTIVE'));
  const ticket = confirmTicket(p, at, false);
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.revision, 1);
  assert.throws(() => proposeTicket(input, at, [ticket]), code('TICKET_DUPLICATE'));
});
test('status transitions check the revision and notes, and closed is final', () => {
  const t = confirmTicket(proposeTicket(input, at), at, false);
  assert.throws(() => moveTicket(t, 0, 'in-progress', ''), code('TICKET_STALE'));
  assert.throws(() => moveTicket(t, 1, 'resolved', ''), code('TICKET_TRANSITION_REFUSED'));
  const working = moveTicket(t, 1, 'in-progress', 'Looking at tracking');
  assert.throws(() => moveTicket(working, 2, 'resolved', ''), code('TICKET_NOTE_REQUIRED'));
  const resolved = moveTicket(working, 2, 'resolved', 'Customer has parcel');
  const closed = moveTicket(resolved, 3, 'closed', 'Customer confirmed');
  assert.throws(() => moveTicket(closed, 4, 'in-progress', 'Reopen'), code('TICKET_CLOSED'));
});
test('refunds remain requested and saved replies never claim delivery', () => {
  assert.deepEqual(requestMoney({ kind: 'refund', amountText: '499.00', currency: 'INR' }), { kind: 'refund', amountText: '499.00', currency: 'INR', state: 'requested, not done' });
  assert.equal(checkSupportDraft('Your refund was processed.').pass, false);
  assert.equal(checkSupportDraft('Your reply has been delivered.').pass, false);
  assert.equal(checkSupportDraft('आपका रिफंड कर दिया गया है।').pass, false);
  assert.equal(checkSupportDraft('Your refund request is waiting for the shop owner.').pass, true);
  const handoff = sendHandoff({ to: 'buyer@example.com', subject: 'Parcel', text: 'Please check the tracking page.', messageId: '<a@example.com>', references: ['<first@example.com>'] });
  assert.match(handoff.eml, /X-Unsent: 1\r\n/);
  assert.match(handoff.eml, /In-Reply-To: <a@example.com>/);
  assert.match(handoff.eml, /References: <first@example.com> <a@example.com>/);
  assert.equal(handoff.sent, false);
  assert.throws(() => sendHandoff({ to: 'buyer@example.com\r\nBcc: leak@example.com', subject: 'Parcel', text: '', messageId: null, references: [] }), code('SUPPORT_HEADER_REFUSED'));
});

test('completed refund claims are refused in either word order while negative and requested states stay honest',()=>{
 for(const words of ['We have refunded your payment.','We reimbursed you.','We sent your refund.','Your refund has been issued.','Your payment was not refunded but we sent your replacement.'])assert.equal(checkSupportDraft(words).pass,false,words);
 for(const words of ['Your refund request is waiting for the owner.','We have not refunded your payment.','Your refund has not been issued.','We have not yet sent your refund.','Your refund is requested, not done.'])assert.equal(checkSupportDraft(words).pass,true,words);
});
