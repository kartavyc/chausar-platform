import test from 'node:test';
import assert from 'node:assert/strict';
import { caps, overview } from '../src/screens/writeback/contract.ts';
import { InvalidReply } from '../src/screens/work/kit/validate.ts';

const action = { action: 'smtp.send', title: 'Send a mail', kind: 'seen-outside', tier: 1, alwaysWaits: true, undoable: false, status: 'experimental', qualification: 'synthetic-tested',
  writeScore: '3/3', granted: false, grantable: true, sandboxVerified: false };
const connection = { id: 'connection-1', system: 'mail', label: 'Mail', environment: 'sandbox', account: { smtpHost: 'smtp.example.com' }, read: true, createdAt: '2026-10-10T10:00:00Z',
  link: null, credential: 'missing', credentialShape: 'pair', actions: [action], sandboxRuns: [] };
const reply = { demo: false, connections: [connection], linkable: [], systems: [{ system: 'mail', fields: [{ name: 'smtpHost', required: true, secret: false, example: 'smtp.example.com' }], credential: 'pair', linkable: [], actions: 1 }] };
const capsReply = { settings: { approvalHours: { 'inside-undoable': 168, 'seen-outside': 24, money: 24, 'cannot-undo': 24 }, reminderCapPerCustomer: 1, reminderCapPerDay: 20, stopWords: ['STOP'] },
  timeZone: 'Asia/Kolkata', today: '2026-10-15', now: '2026-10-15T02:00:00Z', counts: { preparedToday: 0, sentToday: 0, customersToday: 0 } };

test('a well-formed overview passes and is frozen', () => {
  const value = overview(reply, 'reply');
  assert.equal(value.connections[0]!.environment, 'sandbox');
  assert.ok(Object.isFrozen(value));
});

test('overview refuses unknown words, secret fields and nested account values', () => {
  const bad = (change: (r: any) => void) => { const copy = structuredClone(reply) as any; change(copy); assert.throws(() => overview(copy, 'reply'), InvalidReply); };
  bad(r => { r.connections[0].environment = 'production'; });
  bad(r => { r.connections[0].credential = 'shown'; });
  bad(r => { r.connections[0].system = 'quickbooks'; });
  bad(r => { r.connections[0].account = { token: { value: 'x' } }; });
  bad(r => { r.connections[0].actions[0].tier = 3; });
  bad(r => { r.systems[0].fields[0].secret = true; });
});

test('caps refuses hours outside 1..720 and a bad zone', () => {
  assert.equal(caps(capsReply, 'reply').timeZone, 'Asia/Kolkata');
  assert.throws(() => caps({ ...capsReply, settings: { ...capsReply.settings, approvalHours: { ...capsReply.settings.approvalHours, money: 0 } } }, 'reply'), InvalidReply);
  assert.throws(() => caps({ ...capsReply, timeZone: '<b>zone</b>' }, 'reply'), InvalidReply);
  assert.throws(() => caps({ ...capsReply, today: '15/10/2026' }, 'reply'), InvalidReply);
});
