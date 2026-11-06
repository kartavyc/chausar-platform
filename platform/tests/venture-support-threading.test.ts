// Threading trust tiers, inspired by ResolveHQ (source-available, ideas only) and RFC 5322.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signedReplyAddress, threadMessage } from '../runtime/venture/playbooks/support-desk/threading.ts';
const secret = 'local-test-thread-key';
const tickets = [{ id: 'ticket_a', number: '123', customerEmail: 'buyer@example.com', messageIds: ['<original@example.com>'] }, { id: 'ticket_b', number: '456', customerEmail: 'other@example.com', messageIds: ['<other@example.com>'] }];
test('Message-ID references win, then signed reply address, then a number bound to its sender', () => {
  const reply = signedReplyAddress('ticket_b', 'support@example.com', secret);
  assert.equal(threadMessage({ sender: 'buyer@example.com', messageId: '<reply@example.com>', references: ['<original@example.com>'], to: reply, subject: '#456' }, tickets, secret).ticketId, 'ticket_a');
  assert.equal(threadMessage({ sender: 'other@example.com', messageId: null, references: [], to: reply, subject: '' }, tickets, secret).ticketId, 'ticket_b');
  assert.equal(threadMessage({ sender: 'buyer@example.com', messageId: null, references: [], to: 'support@example.com', subject: 'Help #123' }, tickets, secret).ticketId, 'ticket_a');
  assert.equal(threadMessage({ sender: 'stranger@example.com', messageId: null, references: [], to: 'support@example.com', subject: 'Help #123' }, tickets, secret).ticketId, null);
  assert.equal(threadMessage({ sender: 'other@example.com', messageId: null, references: [], to: reply.replace(/\.[^.]+@/, '.tampered@'), subject: '' }, tickets, secret).ticketId, null);
});
