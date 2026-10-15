import assert from 'node:assert/strict';
import test from 'node:test';
import { railPlaces, resolveAddress } from '../src/app/places.ts';
import { laneSubPlaces } from '../src/places/subplaces/index.ts';
import { laneWords } from '../src/text/lanes/index.ts';
import {
  billConfirmPayload, billFormOf, collected, discarded, documentList, documentPreview, messageChecked, messageLog, paiseText, partlyCollected,
  previewPayload, readLines, routesFor, rupeesText, wholeQuantity,
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

test('a check result the runtime writes as not-sent is read, with sendAgain; a wrong sendAgain is refused', () => {
  assert.equal(messageLog({ messages: [{ ...ENTRY, status: 'not-sent', checkedAt: AT }], lost: 0 }).messages[0]!.status, 'not-sent');
  const checked = messageChecked({ ...ENTRY, status: 'not-sent', checkedAt: AT, sendAgain: true });
  assert.equal(checked.status, 'not-sent');
  assert.equal(checked.sendAgain, true);
  assert.equal(messageChecked({ ...ENTRY, status: 'delivered', sendAgain: false }).sendAgain, false);
  assert.equal(messageChecked({ ...ENTRY, status: 'delivered' }).sendAgain, false);
  assert.equal(messageChecked({ message: { ...ENTRY, status: 'not-sent' }, sendAgain: true }).sendAgain, true);
  assert.throws(() => messageChecked({ ...ENTRY, status: 'not-sent', sendAgain: 'yes' }), { code: 'INVALID_REPLY' });
  const { en, hi } = laneWords['hosted-link']!;
  assert.equal(en['HL.log.status.not-sent'], 'Not received by the relay. Nothing was sent; you may send it again.');
  assert.ok(hi['HL.log.status.not-sent']);
  assert.equal(en['HL.refusal.MESSAGE_CHECK_TOO_SOON'], 'Checked too soon after the last attempt. Try again in a few minutes.');
});

// A `books.billRead` reply as work-books writes it (books-bill.ts, books-bill-parse.ts), synthetic.
const f = (value: string | null, certainty = 'sure') => ({ value, certainty, region: value === null ? null : { page: 1, line: 2, of: 20 } });
const BILL_READ = {
  readId: 'billread_1', digest: 'd'.repeat(64), mime: 'image/jpeg', stored: false, expiresAt: AT, untrusted: true,
  reader: { engine: 'tesseract', version: '5', pages: 1, confidence: 90 },
  supplier: f('Sharma Traders'), billNumber: f('INV-7'), date: f('2026-10-01'),
  lines: [{ description: f('Rice'), quantity: f('2'), amount: f('100000') }, { description: f('Oil', 'check-this'), quantity: f('1', 'check-this'), amount: f(null, 'could-not-read') }],
  tax: [{ name: f('GST'), amount: f('5000') }], total: f('123400'),
  sums: { linesPlusTax: { missing: 'unknown' }, total: { minor: '123400' }, equal: null },
  routes: { zohoBooks: { available: false, connections: [] }, tallyPreview: { available: true } },
};
const BILL_PREVIEW = { documentId: DOC.documentId, route: 'bill', untrusted: true, outside: true, imported: false, preview: BILL_READ,
  confirm: { method: 'books.billConfirm', input: { readId: 'billread_1', digest: 'd'.repeat(64) }, add: ['fields'] } };

test('a bill preview whose confirm adds fields carries the reading to check, strictly', () => {
  const v = documentPreview(BILL_PREVIEW, { documentId: DOC.documentId, route: 'bill' });
  assert.equal(v.bill!.readId, 'billread_1');
  assert.equal(v.bill!.reading.lines[1]!.amount.certainty, 'could-not-read');
  assert.deepEqual(billFormOf(v.bill!.reading), {
    supplier: 'Sharma Traders', billNumber: 'INV-7', date: '2026-10-01', total: '1234.00',
    lines: [{ description: 'Rice', quantity: '2', amount: '1000.00' }, { description: 'Oil', quantity: '1', amount: '' }], tax: [{ name: 'GST', amount: '50.00' }],
  });
  assert.equal(documentPreview(PREVIEW).bill, null);
  // The runtime's confirm also names optional inputs (zoho), and the reply carries confirmReason.
  const withOptional = { ...BILL_PREVIEW, confirmReason: null, confirm: { ...BILL_PREVIEW.confirm, optional: ['zoho'] } };
  assert.equal(documentPreview(withOptional).bill!.digest, 'd'.repeat(64));
  assert.throws(() => documentPreview({ ...withOptional, confirm: { ...withOptional.confirm, optional: ['anything'] } }), { code: 'INVALID_REPLY' });
  assert.equal(documentPreview({ ...PREVIEW, route: 'statement', confirm: null, confirmReason: 'statement-imported' }).confirmReason, 'statement-imported');
  assert.equal(documentPreview({ ...PREVIEW, confirm: null }).confirmReason, null);
  assert.throws(() => documentPreview({ ...PREVIEW, confirm: null, confirmReason: 'because' }), { code: 'INVALID_REPLY' });
  assert.throws(() => documentPreview({ ...BILL_PREVIEW, preview: { ...BILL_READ, supplier: { value: 'x', certainty: 'certain' } } }), { code: 'INVALID_REPLY' });
  assert.throws(() => documentPreview({ ...BILL_PREVIEW, preview: { ...BILL_READ, lines: 'none' } }));
  assert.throws(() => documentPreview({ ...BILL_PREVIEW, preview: { ...BILL_READ, readId: 'billread_other' } }));
  assert.throws(() => documentPreview({ ...BILL_PREVIEW, confirm: { ...BILL_PREVIEW.confirm, input: { readId: 'billread_1' } } }));
  assert.throws(() => documentPreview({ ...BILL_PREVIEW, route: 'csv', confirm: { method: 'sources.import', input: {}, add: ['fields'] } }));
});

test('rupees typed become whole paise by hand, never through a float', () => {
  assert.equal(paiseText('1234'), '123400');
  assert.equal(paiseText('1234.5'), '123450');
  assert.equal(paiseText(' 1,23,456.78 '), '12345678');
  assert.equal(paiseText('0.10'), '10');
  assert.equal(paiseText('0.29'), '29'); // 0.29 * 100 is 28.999... as a float
  assert.equal(paiseText('123,456.7'), '12345670');
  assert.equal(paiseText('1,84.5'), null);
  assert.equal(paiseText('1,,234'), null);
  assert.equal(paiseText('1.005'), null);
  assert.equal(paiseText('12.'), null);
  assert.equal(paiseText('-5'), null);
  assert.equal(paiseText('1e3'), null);
  assert.equal(paiseText(''), null);
  assert.equal(paiseText('99999999999999.99'), '9999999999999999');
  assert.equal(paiseText('999999999999999'), null);
  assert.equal(rupeesText('5'), '0.05');
  assert.equal(rupeesText('73160'), '731.60');
  assert.equal(rupeesText(null), '');
  assert.equal(rupeesText('12.5'), '');
  assert.equal(wholeQuantity('3'), '3');
  assert.equal(wholeQuantity('0'), null);
  assert.equal(wholeQuantity('1.5'), null);
});

test('the bill confirm is exactly { readId, digest, fields } in the shape the engine validates, and nothing is summed', () => {
  const check = documentPreview(BILL_PREVIEW).bill!;
  const form = { ...billFormOf(check.reading), lines: [{ description: ' Rice ', quantity: '2', amount: '1000' }, { description: 'Oil', quantity: '1', amount: '184' }] };
  assert.deepEqual(billConfirmPayload(check, form), {
    readId: 'billread_1', digest: 'd'.repeat(64),
    fields: { supplier: 'Sharma Traders', billNumber: 'INV-7', date: '2026-10-01',
      lines: [{ description: 'Rice', quantity: '2', amountMinor: '100000' }, { description: 'Oil', quantity: '1', amountMinor: '18400' }],
      tax: [{ name: 'GST', amountMinor: '5000' }], totalMinor: '123400' },
  });
  // Lines plus tax that do not make the total are still sent: the engine decides (BILL_TOTAL_MISMATCH).
  assert.equal((billConfirmPayload(check, { ...form, total: '1' })!['fields'] as { totalMinor: string }).totalMinor, '100');
  assert.equal(billConfirmPayload(check, billFormOf(check.reading)), null, 'an unread amount cannot be sent');
  assert.equal(billConfirmPayload(check, { ...form, date: '1 Oct' }), null);
  assert.equal(billConfirmPayload(check, { ...form, lines: [{ description: 'Rice', quantity: '2.5', amount: '1' }] }), null);
});
