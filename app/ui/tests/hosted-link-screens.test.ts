import assert from 'node:assert/strict';
import test from 'node:test';
import { railPlaces, resolveAddress } from '../src/app/places.ts';
import { laneSubPlaces } from '../src/places/subplaces/index.ts';
import { laneWords } from '../src/text/lanes/index.ts';
import {
  collected, discarded, documentList, documentPreview, messageChecked, messageLog, partlyCollected, previewPayload, readLines, routesFor,
} from '../src/screens/hosted-link/contract.ts';

// Every reply here is a synthetic fixture.
const AT = '2026-10-14T09:00:00.000Z';
const DOC = { documentId: 'phonedoc_' + 'a'.repeat(32), name: 'Document from WhatsApp', channel: 'whatsapp', mediaType: 'application/pdf',
  sizeBytes: 2048, receivedAt: AT, collectedAt: AT, status: 'awaiting-review', outside: true };
const LIST = { experimental: true, label: 'Outside data from your phone.', keyRegistered: true, documents: [DOC] };
const PREVIEW = { documentId: DOC.documentId, route: 'bill', untrusted: true, preview: { supplier: { value: 'Sharma Traders' }, totalMinor: '123400' },
  confirm: { method: 'books.billConfirm', input: { readId: 'billread_1', digest: 'd', fields: {} } } };
const ENTRY = { id: 'msg_1', event: 'review-ready', channel: 'whatsapp', status: 'unknown', at: AT, buttons: 'open-only', errorCode: null, checkedAt: null };

test('the hosted-link sub-places are Tools sub-places, named in both languages, after Phone on the desktop rail', () => {
  assert.deepEqual(laneSubPlaces['hosted-link'], [{ place: 'tools', id: 'phonedocs' }, { place: 'tools', id: 'phonelog' }]);
  for (const id of ['phonedocs', 'phonelog']) {
    const key = `SH-01.sub.tools.${id}`;
    assert.ok(laneWords['hosted-link']!.en[key] && laneWords['hosted-link']!.hi[key], key);
    assert.deepEqual(resolveAddress({ kind: 'desktop', view: 'guided' }, { place: 'tools', sub: id }), { place: 'tools', sub: id });
  }
  const tools = railPlaces({ kind: 'desktop', view: 'guided' }).find((p) => p.id === 'tools')!;
  const ids = tools.subs.map((sub) => sub.id);
  assert.ok(ids.indexOf('phone') < ids.indexOf('phonedocs') && ids.indexOf('phonedocs') < ids.indexOf('phonelog'), ids.join(','));
});

test('every hosted-link word has Hindi, and no message headline or status carries a digit', () => {
  const { en, hi } = laneWords['hosted-link']!;
  assert.deepEqual(Object.keys(hi).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en).filter((k) => k.startsWith('HL.log.event.') || k.startsWith('HL.log.status.'))) {
    assert.doesNotMatch(en[key]!, /\d/, key);
    assert.doesNotMatch(hi[key]!, /[\d०-९]/, key);
  }
  assert.equal(en['HL.log.status.unknown'], 'No reply from the relay — it may or may not have been sent');
});

test('the document list is read as the runtime writes it, and wrong shapes are refused', () => {
  const v = documentList(LIST);
  assert.equal(v.documents[0]!.sizeBytes, '2048');
  assert.equal(v.keyRegistered, true);
  assert.equal(documentList({ documents: [] }).keyRegistered, true);
  assert.equal(documentList({ ...LIST, keyRegistered: false }).keyRegistered, false);
  assert.throws(() => documentList({}), { code: 'INVALID_REPLY' });
  assert.throws(() => documentList({ documents: [{ ...DOC, channel: 'mail' }] }));
  assert.throws(() => documentList({ documents: [{ ...DOC, mediaType: 'text/html' }] }));
  assert.throws(() => documentList({ documents: [{ ...DOC, sizeBytes: -1 }] }));
  assert.throws(() => documentList({ documents: [{ ...DOC, sizeBytes: '2048' }] }));
  assert.throws(() => documentList({ documents: [{ ...DOC, receivedAt: 'yesterday' }] }));
  assert.throws(() => documentList({ documents: [{ ...DOC, documentId: '../etc' }] }));
  assert.throws(() => documentList({ ...LIST, keyRegistered: 'yes' }));
});

test('how a document may be read: a CSV as rows with no choice, a PDF as statement or bill, a photo as a bill', () => {
  assert.deepEqual(routesFor('text/csv'), ['csv']);
  assert.deepEqual(routesFor('application/pdf'), ['statement', 'bill']);
  assert.deepEqual(routesFor('image/jpeg'), ['bill']);
  assert.deepEqual(routesFor('image/png'), ['bill']);
  assert.deepEqual(previewPayload('d1', 'csv'), { documentId: 'd1' });
  assert.deepEqual(previewPayload('d1', 'statement'), { documentId: 'd1', as: 'statement' });
});

test('a preview must be marked untrusted, be for the document and route asked, and confirm only through a known method', () => {
  const v = documentPreview(PREVIEW, { documentId: DOC.documentId, route: 'bill' });
  assert.equal(v.confirm!.method, 'books.billConfirm');
  assert.equal(documentPreview({ ...PREVIEW, confirm: null }).confirm, null);
  assert.equal(documentPreview({ ...PREVIEW, route: 'csv', confirm: { method: 'sources.import', input: {} } }).route, 'csv');
  assert.throws(() => documentPreview({ ...PREVIEW, untrusted: false }), { code: 'INVALID_REPLY' });
  assert.throws(() => documentPreview({ ...PREVIEW, untrusted: undefined }));
  assert.throws(() => documentPreview(PREVIEW, { documentId: DOC.documentId, route: 'statement' }));
  assert.throws(() => documentPreview(PREVIEW, { documentId: 'other', route: 'bill' }));
  assert.throws(() => documentPreview({ ...PREVIEW, route: 'photo' }));
  assert.throws(() => documentPreview({ ...PREVIEW, confirm: { method: 'workspace.delete', input: {} } }));
  assert.throws(() => documentPreview({ ...PREVIEW, confirm: { method: 'sources.import', input: 'x' } }));
  assert.throws(() => documentPreview({ ...PREVIEW, confirm: undefined }));
  assert.throws(() => documentPreview({ ...PREVIEW, preview: null }));
});

test('collect, discard and the reading lines', () => {
  assert.equal(partlyCollected(collected({ collected: [{ documentId: 'x', outcome: 'held', localId: 'l' }] })), false);
  assert.equal(partlyCollected(collected({ collected: [{ documentId: 'x', outcome: 'not-collected', reason: 'HOSTED_UNREACHABLE' }] })), true);
  assert.throws(() => collected({ collected: [{ documentId: 'x', outcome: 'imported' }] }));
  assert.deepEqual(discarded({ documentId: 'phonedoc_1', discarded: true }), { documentId: 'phonedoc_1' });
  assert.throws(() => discarded({ documentId: 'phonedoc_1', discarded: false }));
  const { lines, more } = readLines({ supplier: { value: 'Sharma' }, totalMinor: '123400', sure: false, skip: null }, 3);
  assert.deepEqual(lines.map((l) => [l.path.join('.'), l.kind]), [['supplier.value', 'text'], ['totalMinor', 'money'], ['sure', 'no']]);
  assert.equal(more, false);
  assert.equal(readLines({ a: '1', b: '2', c: '3' }, 2).more, true);
});

test('the message log and a checked entry are read strictly', () => {
  const log = messageLog({ messages: [ENTRY, { ...ENTRY, id: 'msg_2', status: 'delivered', checkedAt: AT }], lost: 1 });
  assert.equal(log.anyLost, true);
  assert.equal(log.truncated, false);
  assert.equal(messageLog({ messages: [], lost: 0 }).anyLost, false);
  assert.equal(messageLog({ messages: [], lost: false }).anyLost, false);
  assert.throws(() => messageLog({ messages: [] }), { code: 'INVALID_REPLY' });
  assert.throws(() => messageLog({ messages: [{ ...ENTRY, event: 'four-bank-matches' }], lost: 1 }));
  assert.throws(() => messageLog({ messages: [{ ...ENTRY, status: 'lost' }], lost: 1 }));
  assert.throws(() => messageLog({ messages: [{ ...ENTRY, channel: 'sms' }], lost: 1 }));
  assert.throws(() => messageLog({ messages: [{ ...ENTRY, errorCode: 'not a code' }], lost: 1 }));
  assert.throws(() => messageLog({ messages: [{ ...ENTRY, buttons: 'approve' }], lost: 1 }));
  assert.throws(() => messageLog({ messages: [ENTRY], lost: -1 }));
  assert.equal(messageChecked({ ...ENTRY, status: 'sent', checkedAt: AT }).status, 'sent');
  assert.equal(messageChecked({ message: { ...ENTRY, status: 'failed', errorCode: 'CHANNEL_OFF' } }).errorCode, 'CHANNEL_OFF');
  assert.throws(() => messageChecked({ ok: true }));
});
