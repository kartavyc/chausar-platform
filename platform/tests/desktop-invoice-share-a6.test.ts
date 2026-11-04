// One-shot A6 (sharing): Email it and Share on WhatsApp from the invoice sheet on the desktop. The mail gate takes a
// link with no address (S7: the engine leaves it empty when the client has none); the .eml draft carries the PDF, with
// every header built from checked fields; the window names only the invoice and how; main writes into Chausar's own
// share folder and opens the owner's mail app or WhatsApp (the desktop app first, else the web page). Nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const contract = require('../../app/desktop/ipc-contract.cjs');

const SUBJECT = 'Invoice INV-0001 from Ledger Cafe Books';
const BODY = 'Hello Test Client One,\n\nHere is invoice INV-0001 for INR 23,305.00. The PDF is attached.\n\nThank you,\nLedger Cafe Books';
const mailto = (address: string, subject = SUBJECT, body = BODY) => `mailto:${encodeURIComponent(address).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

test('S7: the mail gate opens a link with no address, as the engine makes it for a client with no email', () => {
  assert.equal(contract.validateExternalUrl(mailto('')), `mailto:?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(BODY)}`);
  assert.equal(contract.validateExternalUrl(mailto('client@example.com')), mailto('client@example.com'));
  assert.deepEqual(contract.mailtoParts(mailto('')), { address: '', subject: SUBJECT, body: BODY });
  assert.deepEqual(contract.mailtoParts(mailto('client@example.com')), { address: 'client@example.com', subject: SUBJECT, body: BODY });
});

test('S7: an empty address opens nothing else: no header slipped in, no second address, no cc', () => {
  for (const bad of [
    mailto('', 'Invoice\r\nBcc: other@example.com'), mailto('', 'Invoice\nX'), mailto('client@example.com\r\nCc: x@example.com'),
    'mailto:a@example.com,b@example.com?subject=x', 'mailto:?cc=other@example.com&subject=x', 'mailto:?subject=x&subject=y', 'mailto:?subject=%E0%A4',
    'mailto:?subject=x#y', 'mailto:%0D%0A?subject=x',
  ]) {
    assert.throws(() => contract.validateExternalUrl(bad), (error: any) => error.code === 'INVALID_EXTERNAL_URL', bad);
    assert.equal(contract.mailtoParts(bad), null, bad);
  }
});
