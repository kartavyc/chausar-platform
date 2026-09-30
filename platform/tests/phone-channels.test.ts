import test from 'node:test';
import assert from 'node:assert/strict';
import { companionLink, messagingInbound, messagingNotification, validRelayEnvelope } from '../runtime/phone/channels.ts';
import type { MessagingOptIn, NotificationEvent, SealedRelayEnvelope } from '../runtime/phone/channels.ts';
const now = Date.parse('2026-10-01T00:00:00Z');
const optIn: MessagingOptIn = { channel: 'whatsapp', optedIn: true, recordedAt: new Date(now).toISOString() };

test('WhatsApp/email notifications require recorded opt-in and contain generic text and paired-page destinations only', () => {
  for (const channel of ['whatsapp', 'email'] as const) for (const event of ['brief-ready', 'approval-needed', 'document-received', 'due-date-reminder'] as NotificationEvent[]) {
    const notification = messagingNotification({ ...optIn, channel }, event);
    assert.deepEqual(Object.keys(notification).sort(), ['channel', 'destination', 'event', 'text']);
    assert.equal(companionLink('https://companion.example.test', notification.destination).includes('?'), false);
  }
  assert.throws(() => messagingNotification({ ...optIn, optedIn: false }, 'brief-ready'), { code: 'CHANNEL_FORBIDDEN' });
  assert.throws(() => messagingNotification(optIn, '__proto__' as any), { code: 'CHANNEL_FORBIDDEN' });
});
test('app links reject credentials, tokens, fragments and non-TLS origins', () => {
  for (const origin of ['http://example.test', 'https://secret@example.test', 'https://example.test/?token=secret', 'https://example.test/#secret', 'https://example.test/token/secret', 'invalid']) assert.throws(() => companionLink(origin, 'approvals'), { code: 'INVALID_REQUEST' });
  assert.equal(companionLink('https://companion.example.test', 'approvals'), 'https://companion.example.test/companion/approvals');
});
test('bare approvals and chat receive a fixed app reply; HELP and STOP have explicit behavior', () => {
  for (const text of ['yes', 'approve', 'send money', 'What is my customer balance?', 'secret-business-name']) {
    const reply = messagingInbound(optIn, text, now); assert.equal(reply.response, 'open-app'); assert.equal(reply.text.includes(text), false); assert.equal(reply.optIn.optedIn, true);
  }
  assert.equal(messagingInbound(optIn, ' help ', now).response, 'human-help');
  const stopped = messagingInbound(optIn, ' stop ', now); assert.equal(stopped.response, 'stopped'); assert.equal(stopped.optIn.optedIn, false);
  assert.throws(() => messagingNotification(stopped.optIn, 'brief-ready'), { code: 'CHANNEL_FORBIDDEN' }); assert.equal(optIn.optedIn, true);
});
test('sealed relay intent has bounded lifetime and cannot survive the approval expiry boundary', () => {
  const envelope: SealedRelayEnvelope = { envelopeId: 'envelope1', routeId: 'opaque-route1', format: 'chausar-companion-sealed-v1', purpose: 'approval-intent', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(), nonce: new Uint8Array(12), ciphertext: new Uint8Array(32) };
  assert.equal(validRelayEnvelope(envelope, now), true); assert.equal(validRelayEnvelope(envelope, now + 300000), false);
  assert.equal(validRelayEnvelope({ ...envelope, expiresAt: new Date(now + 300001).toISOString() }, now), false);
  assert.equal(validRelayEnvelope({ ...envelope, nonce: new Uint8Array(11) }, now), false);
  assert.equal(validRelayEnvelope({ ...envelope, createdAt: new Date(now + 1).toISOString() }, now), false);
});
