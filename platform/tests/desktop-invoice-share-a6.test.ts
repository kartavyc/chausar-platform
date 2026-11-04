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

// ---------------------------------------------------------------------------
// The .eml draft: the mail app opens it as a new email with the PDF attached (X-Unsent), and the owner presses send.
// ---------------------------------------------------------------------------
const { buildEml } = require('../../app/desktop/mail-draft.cjs');
const PDF = Buffer.from('%PDF-1.7 synthetic invoice for a test\n'.repeat(8));
const draft = (over: Record<string, unknown> = {}) => buildEml({ to: 'client@example.com', subject: SUBJECT, body: BODY, attachment: { name: 'INV-0001.pdf', mimeType: 'application/pdf', bytes: PDF }, ...over });
const split = (eml: string) => { const at = eml.indexOf('\r\n\r\n'); return { head: eml.slice(0, at).split('\r\n'), rest: eml.slice(at + 4) }; };

test('A6: the draft is a new email to the client with the PDF attached, built only from checked fields', () => {
  const eml = draft();
  assert.ok(!/(^|[^\r])\n/.test(eml), 'every line ends in CRLF');
  const { head, rest } = split(eml);
  const boundary = /^Content-Type: multipart\/mixed; boundary="(chausar-[0-9a-f]{24})"$/.exec(head.find(line => line.startsWith('Content-Type:'))!)![1]!;
  assert.deepEqual(head, ['To: client@example.com', `Subject: ${SUBJECT}`, 'X-Unsent: 1', 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`]);
  assert.ok(!head.some(line => /^from:/i.test(line)), 'the mail app fills in who it is from');
  const parts = rest.split(`--${boundary}`);
  assert.equal(parts.at(-1), '--\r\n', 'the last boundary closes the message');
  const [text, file] = [split(parts[1]!.slice(2)), split(parts[2]!.slice(2))];
  assert.deepEqual(text.head, ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64']);
  assert.equal(Buffer.from(text.rest.replace(/\r\n/g, ''), 'base64').toString('utf8'), BODY.replace(/\n/g, '\r\n'));
  assert.deepEqual(file.head, ['Content-Type: application/pdf; name="INV-0001.pdf"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="INV-0001.pdf"']);
  assert.ok(file.rest.split('\r\n').every(line => line.length <= 76), 'base64 lines of 76 at most');
  assert.deepEqual(Buffer.from(file.rest.replace(/\r\n/g, ''), 'base64'), PDF);
  assert.notEqual(/boundary="([^"]+)"/.exec(draft())![1], boundary, 'a new boundary each time');
});

test('A6: no address means no To line; a subject that is not plain ASCII is encoded and never splits a character', () => {
  assert.ok(!split(draft({ to: '' })).head.some(line => line.startsWith('To:')));
  const subject = `Invoice INV-0002 from ${'नमस्ते Studio '.repeat(6)}`.trim();
  const { head } = split(draft({ subject }));
  const start = head.findIndex(line => line.startsWith('Subject: '));
  const lines = [head[start]!.slice('Subject: '.length)];
  for (let at = start + 1; head[at]!.startsWith(' '); at++) lines.push(head[at]!.slice(1));
  assert.ok(lines.length > 1, 'a long subject is folded');
  const decoded = lines.map(word => { const match = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(word); assert.ok(match, word); return Buffer.from(match[1]!, 'base64'); });
  for (const piece of decoded) assert.equal(Buffer.from(piece.toString('utf8'), 'utf8').length, piece.length, 'each word is whole UTF-8');
  assert.equal(Buffer.concat(decoded).toString('utf8'), subject);
});

test('A6: header injection and odd files are refused, never written into the draft', () => {
  const refused = (over: Record<string, unknown>) => assert.throws(() => draft(over), (error: any) => error.code === 'MAIL_DRAFT_INVALID', JSON.stringify(over).slice(0, 80));
  for (const subject of ['Invoice\r\nBcc: other@example.com', 'Invoice\nX-Evil: 1', 'Invoice\u2028Bcc: x', 'a\u0000b', 'x'.repeat(1001), 42]) refused({ subject });
  for (const to of ['client@example.com\r\nBcc: other@example.com', 'a@example.com, b@example.com', 'Client <client@example.com>', 'client', null]) refused({ to });
  for (const name of ['../INV-0001.pdf', 'INV-0001.exe', 'INV 0001.pdf', 'INV-0001.pdf"\r\nX: 1', '', 'a'.repeat(81) + '.pdf']) refused({ attachment: { name, mimeType: 'application/pdf', bytes: PDF } });
  refused({ attachment: { name: 'INV-0001.pdf', mimeType: 'text/html', bytes: PDF } });
  refused({ attachment: { name: 'INV-0001.pdf', mimeType: 'application/pdf', bytes: Buffer.alloc(0) } });
  refused({ attachment: { name: 'INV-0001.pdf', mimeType: 'application/pdf', bytes: 'not bytes' } });
  refused({ body: 7 });
  const html = split(draft({ attachment: { name: 'INV-0001.html', mimeType: 'text/html', bytes: Buffer.from('<p>x</p>') } })).rest;
  assert.ok(html.includes('Content-Type: text/html; name="INV-0001.html"'));
});
