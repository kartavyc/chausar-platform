import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameDocument, readInbound, shares, type Known } from '../src/screens/tools/frame/bridge.ts';
import { formOf, payloadFits, payloadFrom, payloadSchema, rupeesToPaise, type PayloadSchema } from '../src/screens/tools/frame/schema.ts';
import { pending, remotePreview, wrapPreview } from '../src/screens/tools/adapters/remote.ts';
import { counts, relayCode, verified } from '../src/screens/tools/adapters/phone.ts';

// Synthetic values only. TL tools, round 4: the small-app frame's message checks, the action form, and the new reply checks.
const CH = 'a'.repeat(32), DIG = 'b'.repeat(64);
const SCHEMA = payloadSchema({ type: 'object', properties: {
  invoiceId: { type: 'string', minLength: 1, maxLength: 10 }, amount: { type: 'string', format: 'paise' }, count: { type: 'integer', minimum: 1, maximum: 9 },
  urgent: { type: 'boolean' }, tone: { type: 'string', enum: ['soft', 'firm'] },
}, required: ['invoiceId'] }, 'schema');
const FORM = formOf(SCHEMA)!;
const KNOWN: Known = { receipts: new Set(['rc-1']), records: new Set(['card-d']), actions: new Map([['card-c', { schema: SCHEMA, form: FORM }]]) };

test('only exact messages on the frame channel naming what the host sent are accepted', () => {
  assert.deepEqual(readInbound({ channel: CH, type: 'ready' }, CH, KNOWN), { type: 'ready' });
  assert.deepEqual(readInbound({ channel: CH, type: 'receipt', receiptId: 'rc-1' }, CH, KNOWN), { type: 'receipt', receiptId: 'rc-1' });
  assert.deepEqual(readInbound({ channel: CH, type: 'size', height: 300 }, CH, KNOWN), { type: 'size', height: 300 });
  assert.deepEqual(readInbound({ channel: CH, type: 'book', cardId: 'card-d' }, CH, KNOWN), { type: 'book', cardId: 'card-d' });
  assert.deepEqual(readInbound({ channel: CH, type: 'press', cardId: 'card-c', fields: { invoiceId: 'I-1', urgent: true } }, CH, KNOWN), { type: 'press', cardId: 'card-c', fields: { invoiceId: 'I-1', urgent: true } });
  for (const bad of [
    null, 'ready', [], { channel: 'c'.repeat(32), type: 'ready' }, { channel: CH, type: 'navigate', to: 'x' }, { channel: CH, type: 'ready', extra: 1 },
    { channel: CH, type: 'receipt', receiptId: 'rc-2' }, { channel: CH, type: 'size', height: -1 }, { channel: CH, type: 'size', height: 1.5 },
    { channel: CH, type: 'book', cardId: 'card-c' }, { channel: CH, type: 'press', cardId: 'card-x', fields: {} },
    { channel: CH, type: 'press', cardId: 'card-c', fields: { unknown: 'x' } }, { channel: CH, type: 'press', cardId: 'card-c', fields: { urgent: 'yes' } },
    { channel: CH, type: 'press', cardId: 'card-c', fields: { invoiceId: 1 } }, { channel: CH, type: 'press', cardId: 'card-c', fields: [] },
    Object.assign(Object.create({ polluted: true }), { channel: CH, type: 'ready' }),
  ]) assert.equal(readInbound(bad, CH, KNOWN), null, JSON.stringify(bad));
});

test('the action form turns typed values into exactly the declared payload, by text, and checks it', () => {
  assert.deepEqual(FORM.map((f) => [f.name, f.kind, f.required]), [['invoiceId', 'text', true], ['amount', 'rupees', false], ['count', 'whole', false], ['urgent', 'yesno', false], ['tone', 'choice', false]]);
  assert.deepEqual(payloadFrom(SCHEMA, FORM, { invoiceId: 'I-1', amount: '1,00,000.5', count: '3', urgent: false, tone: '' }), { ok: true, payload: { invoiceId: 'I-1', amount: '10000050', count: 3, urgent: false } });
  assert.deepEqual(payloadFrom(SCHEMA, FORM, { amount: '1' }), { ok: false, field: 'invoiceId' });
  assert.deepEqual(payloadFrom(SCHEMA, FORM, { invoiceId: 'I-1', count: '10' }), { ok: false, field: 'count' });
  assert.deepEqual(payloadFrom(SCHEMA, FORM, { invoiceId: 'I-1', tone: 'rude' }), { ok: false, field: 'tone' });
  assert.deepEqual(payloadFrom(SCHEMA, FORM, { invoiceId: 'much too long here' }), { ok: false, field: 'invoiceId' });
  assert.deepEqual(['0', '0.5', '12.34', '₹ 1,250', '007'].map(rupeesToPaise), ['0', '50', '1234', '125000', '700']);
  assert.deepEqual(['1.234', '-1', '1e3', '', 'abc'].map(rupeesToPaise), [null, null, null, null, null]);
  const nested: PayloadSchema = payloadSchema({ type: 'object', properties: { lines: { type: 'array', items: { type: 'string' } } }, required: [] }, 's');
  assert.equal(formOf(nested), null);
  assert.equal(payloadFits(SCHEMA, { invoiceId: 'I', extra: 1 }), false);
  assert.throws(() => payloadSchema({ type: 'object', properties: { a: { type: 'number' } } }, 's'), /INVALID_REPLY/);
  assert.throws(() => payloadSchema({ type: 'string', pattern: '.*' }, 's'), /INVALID_REPLY/);
});

test('bar lengths come from exact figures by whole-number division and never from display text', () => {
  const v = (exact: string) => ({ kind: 'figures' as const, receiptId: 'r', partial: false, gaps: [], items: [{ key: 'k', label: 'l', figure: { kind: 'money' as const, exact, display: 'x', receiptId: 'r', labels: [] } }] });
  assert.deepEqual(shares([v('300000'), v('100000'), v('-5'), { kind: 'missing', figure: { kind: 'missing', missing: 'absent' }, receiptId: null }]), [1000, 333, 0, 0]);
  assert.deepEqual(shares([v('0')]), [0]);
});

test('the frame document holds no data and loads only the renderer and stylesheet from the app origin', () => {
  const doc = frameDocument(CH, 'en', 'Cash <b>', 'chausar://app');
  assert.match(doc, /data-channel="a{32}"/);
  assert.match(doc, /script-src chausar:\/\/app\/ui\/smallapp-frame\.js;/);
  assert.match(doc, /<script src="chausar:\/\/app\/ui\/smallapp-frame\.js"><\/script>/);
  assert.ok(doc.includes('Cash &lt;b&gt;'));
  assert.throws(() => frameDocument('xyz', 'en', 't', 'chausar://app'));
  assert.throws(() => frameDocument(CH, 'en', 't', 'javascript:alert(1)'));
});

const W = { en: 'e', hi: 'h' };
test('network door, request and wrap replies are checked; outside text stays text', () => {
  const preview = { previewId: 'xremote_1', digest: DIG, pluginId: 'p', tool: 't', status: 'prepared', createdBy: 'm', createdAt: '2026-10-01T09:00:00Z', expiresAt: '2026-10-01T09:15:00Z',
    requests: [{ site: 'a.example', method: 'GET', url: { kind: 'untrusted-text', text: 'https://a.example/x' }, body: null, bodyDigest: null, bodyBytes: 0, credential: false }],
    approveWith: { method: 'smallapps.pluginApproveRemote', previewId: 'xremote_1', digest: DIG }, words: W };
  assert.equal(remotePreview(preview, 'hi').words, 'h');
  assert.throws(() => remotePreview({ ...preview, approveWith: { ...preview.approveWith, digest: 'c'.repeat(64) } }, 'en'));
  assert.throws(() => remotePreview({ ...preview, status: 'executed' }, 'en'));
  assert.throws(() => remotePreview({ ...preview, requests: [{ ...preview.requests[0], url: { kind: 'html', text: 'x' } }] }, 'en'));
  const req = { id: 'r', kind: 'plugin-network', pluginId: 'p', plugin: 'p', tool: 't', question: 'q', receives: [], preparedBy: 'm', preparedAt: '2026-10-01T09:00:00Z', expiresAt: null, approveWith: { method: 'trustx.setSend', previewId: 'x', digest: DIG } };
  assert.equal(pending({ requests: [req] })[0]!.approveWith.allowed, false);
  assert.equal(pending({ requests: [{ ...req, approveWith: { ...req.approveWith, method: 'smallapps.pluginApproveRemote' } }] })[0]!.approveWith.allowed, true);
  assert.throws(() => pending({ requests: [{ ...req, kind: 'shell' }] }));
  assert.throws(() => wrapPreview({ document: {}, digest: DIG, review: { digest: 'c'.repeat(64) } }, 'en'));
});

test('phone: verify replies, relay refusals and optional per-channel costs', () => {
  assert.deepEqual(verified({ verified: true }), { verified: true });
  assert.throws(() => verified({ verified: true, address: 'x' }));
  assert.equal(relayCode('HOSTED_NOT_PAIRED'), 'RELAY_NOT_AVAILABLE');
  assert.equal(relayCode('OTP_INVALID'), 'OTP_INVALID');
  const base = { month: '2026-10', sent: 3, budget: 30, costPaise: null, costState: 'unknown', byChannel: { whatsapp: 2, mail: 1 } };
  assert.deepEqual(counts(base).byChannel, [{ id: 'whatsapp', sent: 2 }, { id: 'mail', sent: 1 }]);
  assert.deepEqual(counts({ ...base, costByChannel: { whatsapp: '240' } }).byChannel, [{ id: 'whatsapp', sent: 2, costPaise: '240' }, { id: 'mail', sent: 1, costPaise: null }]);
  assert.throws(() => counts({ ...base, costByChannel: { whatsapp: 2.4 } }));
  assert.throws(() => counts({ ...base, perMessagePaise: { sms: '1' } }));
});
