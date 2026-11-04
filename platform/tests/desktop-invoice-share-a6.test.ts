// One-shot A6 (sharing): Email it and Share on WhatsApp from the invoice sheet on the desktop. The mail gate takes a
// link with no address (S7: the engine leaves it empty when the client has none); the .eml draft carries the PDF, with
// every header built from checked fields; the window names only the invoice and how; main writes into Chausar's own
// share folder and opens the owner's mail app or WhatsApp (the desktop app first, else the web page). Nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
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

// ---------------------------------------------------------------------------
// Sharing an invoice from the desktop: the window names only the invoice and how. Main asks the engine for the file,
// keeps it in Chausar's own share folder and opens the owner's mail app or WhatsApp. Stubs only: nothing opens here.
// ---------------------------------------------------------------------------
const share = require('../../app/desktop/invoice-share.cjs');

const WA_TEXT = 'Hello Test Client One,\n\nHere is invoice INV-0001 for INR 23,305.00. The PDF is attached.';
function engineFile(over: Record<string, any> = {}) {
  return {
    fileName: 'INV-0001.pdf', format: 'pdf', mimeType: 'application/pdf', contentBase64: PDF.toString('base64'), note: null,
    share: { text: WA_TEXT, subject: SUBJECT, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(WA_TEXT)}`, mailtoUrl: mailto('client@example.com') },
    ...over,
  };
}
async function shareDeps(t: any, options: { file?: any; openPath?: string; app?: boolean; openFails?: (url: string) => boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-share-a6-'));
  // A6 round 2: a file still held by another process (EBUSY) never fails the cleanup, so later hooks still run.
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined));
  const folder = join(root, 'share');
  const asked: any[] = [], opened: string[] = [], paths: string[] = [], shown: string[] = [];
  const deps = {
    window: { webContents: {} }, folder, assertTrustedSender: (event: any) => { if (event?.untrusted) throw Object.assign(new Error('Request sender is not trusted.'), { code: 'UNTRUSTED_SENDER' }); },
    publicError: (error: any) => ({ code: error.code, message: error.message }),
    engine: { request: async (method: string, payload: unknown) => { asked.push([method, payload]); return options.file === undefined ? engineFile() : options.file; } },
    shell: {
      openPath: async (path: string) => { paths.push(path); return options.openPath ?? ''; },
      openExternal: async (url: string) => { if (options.openFails?.(url)) throw new Error('No app for this link.'); opened.push(url); },
      showItemInFolder: (path: string) => { shown.push(path); },
    },
    whatsappApp: () => options.app ?? false,
  };
  return { deps, folder, asked, opened, paths, shown, root };
}

test('A6: Email it writes the PDF and an .eml draft in the share folder and opens the draft; the window names only the invoice', async t => {
  const s = await shareDeps(t);
  const reply = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, s.deps);
  assert.deepEqual(reply, { ok: true, result: { how: 'email', opened: 'draft', file: 'INV-0001.pdf', to: true, note: null } });
  assert.deepEqual(s.asked, [['venture.invoice.pdf', { invoiceId: 'inv-0001' }]], 'main asks the engine itself');
  assert.deepEqual(s.paths, [join(s.folder, 'INV-0001.eml')]);
  assert.deepEqual(s.opened, [], 'no link is opened when the draft opens');
  assert.deepEqual(await readFile(join(s.folder, 'INV-0001.pdf')), PDF);
  const eml = await readFile(join(s.folder, 'INV-0001.eml'), 'utf8');
  assert.match(eml, /^To: client@example\.com\r\nSubject: Invoice INV-0001 from Ledger Cafe Books\r\nX-Unsent: 1\r\n/);
  assert.ok(eml.includes('Content-Disposition: attachment; filename="INV-0001.pdf"'));
  assert.deepEqual((await readdir(s.folder)).sort(), ['INV-0001.eml', 'INV-0001.pdf'], 'no temporary file is left');

  for (const bad of [{ invoiceId: 'inv-0001' }, { invoiceId: 'inv-0001', how: 'gmail' }, { invoiceId: '../x', how: 'email' }, { invoiceId: 'inv-0001', how: 'email', path: 'C:/x.eml' },
    { invoiceId: 'inv-0001', how: 'whatsapp', text: 'other words' }, { invoiceId: 'inv-0001', how: 'whatsapp', url: 'whatsapp://send?text=x' }, null, 'inv-0001']) {
    const refused = await share.shareInvoice({}, bad, s.deps);
    assert.deepEqual([refused.ok, refused.error.code], [false, 'INVALID_REQUEST'], JSON.stringify(bad));
  }
  const untrusted = await share.shareInvoice({ untrusted: true }, { invoiceId: 'inv-0001', how: 'email' }, s.deps);
  assert.deepEqual([untrusted.ok, untrusted.error.code], [false, 'UNTRUSTED_SENDER']);
  assert.equal(s.asked.length, 1, 'a refused request never reaches the engine');
});

test('A6: a client with no email gets a draft with no To line; with no mail app for email files the mail link opens, else it says none opened', async t => {
  const none = await shareDeps(t, { file: engineFile({ share: { ...engineFile().share, mailtoUrl: mailto('') } }) });
  const reply = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, none.deps);
  assert.deepEqual(reply.result, { how: 'email', opened: 'draft', file: 'INV-0001.pdf', to: false, note: null });
  assert.ok(!(await readFile(join(none.folder, 'INV-0001.eml'), 'utf8')).includes('To:'));

  const link = await shareDeps(t, { openPath: 'There is no application associated with the given file name extension.' });
  assert.deepEqual((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, link.deps)).result, { how: 'email', opened: 'link', file: 'INV-0001.pdf', to: true, note: null });
  assert.deepEqual(link.opened, [mailto('client@example.com')], 'the checked mail link, as the gate rebuilds it');

  const nothing = await shareDeps(t, { openPath: 'No app.', openFails: () => true });
  assert.deepEqual((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, nothing.deps)).result, { how: 'email', opened: 'none', file: 'INV-0001.pdf', to: true, note: null });
  assert.deepEqual(await readFile(join(nothing.folder, 'INV-0001.pdf')), PDF, 'the PDF stays for the owner to attach');
});

test('A6: header injection in the client data never reaches a header, and an odd engine file is refused before anything is written', async t => {
  const injected = await shareDeps(t, { file: engineFile({ share: { ...engineFile().share, mailtoUrl: `mailto:client@example.com?subject=${encodeURIComponent('Invoice\r\nBcc: other@example.com')}&body=x` } }) });
  const reply = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, injected.deps);
  assert.deepEqual([reply.ok, reply.error.code], [false, 'REQUEST_FAILED']);
  assert.deepEqual([injected.paths, injected.opened], [[], []]);
  assert.deepEqual(await readdir(injected.folder).catch(() => []), [], 'nothing was written');
  for (const file of [engineFile({ fileName: '../INV-0001.pdf' }), engineFile({ fileName: 'INV-0001.exe' }), engineFile({ mimeType: 'text/html' }), engineFile({ contentBase64: '' }),
    engineFile({ contentBase64: 'not base64!' }), engineFile({ share: null }), engineFile({ share: { ...engineFile().share, whatsappUrl: 'https://evil.example/?text=x' } }), null]) {
    const s = await shareDeps(t, { file });
    const refused = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, s.deps);
    assert.deepEqual([refused.ok, refused.error.code], [false, 'REQUEST_FAILED'], JSON.stringify(file)?.slice(0, 60));
    assert.deepEqual(await readdir(s.folder).catch(() => []), []);
    assert.deepEqual(s.opened, []);
  }
});

test('A6: WhatsApp opens the desktop app first when this computer has one, else the web page, with the words filled in; the PDF waits in the share folder', async t => {
  const app = await shareDeps(t, { app: true });
  assert.deepEqual((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, app.deps)).result, { how: 'whatsapp', opened: 'app', file: 'INV-0001.pdf', note: null });
  assert.deepEqual(app.opened, [`whatsapp://send?text=${encodeURIComponent(WA_TEXT)}`]);
  assert.deepEqual(await readFile(join(app.folder, 'INV-0001.pdf')), PDF);
  assert.deepEqual(app.paths, [], 'no file is opened');

  const web = await shareDeps(t, { app: false });
  assert.deepEqual((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, web.deps)).result, { how: 'whatsapp', opened: 'web', file: 'INV-0001.pdf', note: null });
  assert.deepEqual(web.opened, [`https://wa.me/?text=${encodeURIComponent(WA_TEXT)}`]);

  // The app is listed but does not open: the web page instead.
  const broken = await shareDeps(t, { app: true, openFails: url => url.startsWith('whatsapp:') });
  assert.equal((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, broken.deps)).result.opened, 'web');
  assert.deepEqual(broken.opened, [`https://wa.me/?text=${encodeURIComponent(WA_TEXT)}`]);
});

test('A6: the WhatsApp app link is built only from a checked wa.me link', () => {
  assert.equal(share.whatsappAppUrl(`https://wa.me/?text=${encodeURIComponent('Hi & bye')}`), `whatsapp://send?text=${encodeURIComponent('Hi & bye')}`);
  assert.equal(share.whatsappAppUrl('https://wa.me/919876543210?text=Hello'), 'whatsapp://send?phone=919876543210&text=Hello');
  for (const bad of ['https://wa.me/abc?text=x', 'https://wa.me/?text=x&phone=1', 'https://wa.me/?x=1', 'https://evil.example/?text=x', 'http://wa.me/?text=x', 'https://user@wa.me/?text=x',
    'https://wa.me/919876543210/x?text=x', 'https://wa.me/?text=%E0%A4', 'whatsapp://send?text=x', 'https://wa.me/?text=a&text=b', 'https://wa.me/?text=x#y', 42]) assert.equal(share.whatsappAppUrl(bad), null, String(bad));
});

test('A6: files older than a day are taken out of the share folder; Show the PDF in its folder shows only a file there', async t => {
  const s = await shareDeps(t);
  await mkdir(s.folder, { recursive: true });
  const old = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  for (const name of ['INV-0007.pdf', 'INV-0007.eml', '.INV-0008.pdf.0a1b2c3d4e5f.tmp']) { await writeFile(join(s.folder, name), 'old'); await utimes(join(s.folder, name), old, old); }
  await writeFile(join(s.folder, 'INV-0009.pdf'), 'fresh');
  await writeFile(join(s.folder, 'notes.txt'), 'not ours'); await utimes(join(s.folder, 'notes.txt'), old, old);
  await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, s.deps);
  assert.deepEqual((await readdir(s.folder)).sort(), ['INV-0001.pdf', 'INV-0009.pdf', 'notes.txt']);

  assert.deepEqual(await share.showShared({}, { name: 'INV-0001.pdf' }, s.deps), { ok: true });
  assert.deepEqual(s.shown, [join(s.folder, 'INV-0001.pdf')]);
  for (const bad of ['../INV-0001.pdf', 'notes.txt', 'INV-0001.eml', String.raw`C:\Windows\notepad.exe`, '', 42, null]) {
    const reply = await share.showShared({}, { name: bad }, s.deps);
    assert.deepEqual([reply.ok, reply.error.code], [false, 'INVALID_REQUEST'], String(bad));
  }
  assert.equal((await share.showShared({}, { name: 'INV-0404.pdf' }, s.deps)).error.code, 'SHARE_FILE_GONE');
  assert.equal((await share.showShared({ untrusted: true }, { name: 'INV-0001.pdf' }, s.deps)).error.code, 'UNTRUSTED_SENDER');
  assert.equal(s.shown.length, 1);
  assert.ok((await stat(join(s.folder, 'INV-0001.pdf'))).isFile());
});

test('A6: the real preload forwards only the invoice and how, and only the file name to show', async () => {
  let bridge: any; const calls: any[] = [];
  runInNewContext(await readFile('app/desktop/preload.cjs', 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: any) => { bridge = value; } }, ipcRenderer: { invoke: async (channel: string, input: any) => { calls.push({ channel, input }); return { ok: true, result: { how: 'email', opened: 'draft', file: 'INV-0001.pdf', to: true, note: null } }; } } }) });
  assert.deepEqual(await bridge.shareInvoice('inv-0001', 'email', { path: 'C:/x' }), { how: 'email', opened: 'draft', file: 'INV-0001.pdf', to: true, note: null });
  await bridge.showShared('INV-0001.pdf');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { channel: 'chausar:invoice:share', input: { invoiceId: 'inv-0001', how: 'email' } },
    { channel: 'chausar:share:show', input: { name: 'INV-0001.pdf' } },
  ]);
});

test('A6: a message too long for one mail link still goes as a draft; with no mail app for it, the sheet hears that nothing opened', async t => {
  const long = 'Line of the invoice note. '.repeat(1500);
  const file = engineFile({ share: { ...engineFile().share, mailtoUrl: mailto('client@example.com', SUBJECT, long) } });
  const drafted = await shareDeps(t, { file });
  assert.deepEqual((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, drafted.deps)).result, { how: 'email', opened: 'draft', file: 'INV-0001.pdf', to: true, note: null });
  const noApp = await shareDeps(t, { file, openPath: 'No app.' });
  assert.deepEqual((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, noApp.deps)).result, { how: 'email', opened: 'none', file: 'INV-0001.pdf', to: true, note: null });
  assert.deepEqual(noApp.opened, [], 'a link the gate refuses is never opened');
});

// ---------------------------------------------------------------------------
// A6 fix round 1.
// ---------------------------------------------------------------------------
test('A6 round 1 (low 7): a mail link with no address needs at least a subject', () => {
  for (const bad of ['mailto:', 'mailto:?', 'mailto:?body=Hello', 'mailto:?subject=', 'mailto:?subject=&body=Hello']) {
    assert.throws(() => contract.validateExternalUrl(bad), (error: any) => error.code === 'INVALID_EXTERNAL_URL', bad);
    assert.equal(contract.mailtoParts(bad), null, bad);
  }
  assert.equal(contract.validateExternalUrl('mailto:?subject=Invoice'), 'mailto:?subject=Invoice');
  assert.equal(contract.validateExternalUrl('mailto:client@example.com'), 'mailto:client@example.com', 'with an address the subject may be left out, as before');
});

test('A6 round 1 (lows 4 and 5): every header line of the draft stays within 76; "=?" is encoded; hidden marks are taken out', () => {
  const headLines = (subject: string) => split(draft({ subject })).head;
  const decodeSubject = (head: string[]) => {
    const at = head.findIndex(line => line.startsWith('Subject: '));
    const words = [head[at]!.slice('Subject: '.length)];
    for (let next = at + 1; head[next]!.startsWith(' '); next++) words.push(head[next]!.slice(1));
    // A short plain subject goes as it is; anything else as encoded words.
    if (words.length === 1 && !words[0]!.startsWith('=?')) return words[0]!;
    return Buffer.concat(words.map(word => Buffer.from(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(word)![1]!, 'base64'))).toString('utf8');
  };
  for (const subject of [`Invoice INV-0002 from ${'नमस्ते Studio '.repeat(6)}`.trim(), '😀'.repeat(40) + ' क्ष', `Invoice INV-0003 from ${'Ledger Cafe Books and Sons '.repeat(4)}`.trim()]) {
    const head = headLines(subject);
    assert.ok(head.every(line => line.length <= 76), JSON.stringify(head.map(line => line.length)));
    assert.equal(decodeSubject(head), subject);
  }
  const tricky = 'Invoice =?UTF-8?B?SGk=?= from Ledger';
  const head = headLines(tricky);
  assert.ok(!head.includes(`Subject: ${tricky}`), 'never raw, so a mail app cannot read it as an encoded word');
  assert.equal(decodeSubject(head), tricky);
  // A6 round 2: hidden format marks are taken out of the subject (a name pasted with one still works), never refused.
  const mark = (code: number) => String.fromCodePoint(code);
  for (const code of [0x202E, 0xFEFF, 0x2066, 0x2069, 0x200B, 0x00AD, 0x200E, 0x200F]) assert.equal(decodeSubject(headLines(`Invoice ${mark(code)}from Chai${mark(code)}Point`)), 'Invoice from ChaiPoint', code.toString(16));
  assert.equal(decodeSubject(headLines(`Invoice  from   Chai ${mark(0x200B)} Point `)), 'Invoice from Chai Point', 'white space folds to one space, as the engine folds a name');
  const joined = 'Invoice from क्‌ष Studio';
  assert.equal(decodeSubject(headLines(joined)), joined, 'the joiners Indian scripts need are kept');
});

test('A6 round 1 (medium 2): a client email the engine keeps but a mail link cannot carry leaves the To line for the owner', async t => {
  for (const address of ["o'brien@example.com", 'a&b@example.com', 'anu@exämple.in']) {
    const file = engineFile({ share: { ...engineFile().share, mailtoUrl: mailto(address) } });
    const s = await shareDeps(t, { file });
    const reply = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, s.deps);
    assert.deepEqual(reply.result, { how: 'email', opened: 'draft', file: 'INV-0001.pdf', to: false, note: null }, address);
    const eml = await readFile(join(s.folder, 'INV-0001.eml'), 'utf8');
    assert.ok(!eml.includes('To:') && eml.includes(`Subject: ${SUBJECT}`), address);
    const link = await shareDeps(t, { file, openPath: 'No app.' });
    assert.equal((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, link.deps)).result.opened, 'link');
    assert.deepEqual(link.opened, [`mailto:?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(BODY)}`], 'the link carries no address either');
  }
  // A broken subject is still refused, address or not.
  const bad = await shareDeps(t, { file: engineFile({ share: { ...engineFile().share, mailtoUrl: `mailto:${encodeURIComponent("o'brien@example.com")}?subject=${encodeURIComponent('Hi\r\nBcc: x@example.com')}&body=x` } }) });
  assert.equal((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, bad.deps)).error.code, 'REQUEST_FAILED');
  assert.throws(() => contract.validateExternalUrl(mailto("o'brien@example.com")), (error: any) => error.code === 'INVALID_EXTERNAL_URL', 'links stay strict');
});

test('A6 round 1 (medium 1): three shares of one invoice at once all work, and the same file is kept, not rewritten', async t => {
  const s = await shareDeps(t, { app: true });
  const replies = await Promise.all([
    share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, s.deps), share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, s.deps),
    share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, s.deps)]);
  assert.deepEqual(replies.map(reply => [reply.ok, reply.result?.file]), [[true, 'INV-0001.pdf'], [true, 'INV-0001.pdf'], [true, 'INV-0001.pdf']]);
  assert.deepEqual(await readFile(join(s.folder, 'INV-0001.pdf')), PDF);
  assert.ok((await readdir(s.folder)).every(name => !name.endsWith('.tmp')), 'no temporary file is left');
});

test('A6 round 1 (medium 1): a file another app holds keeps its name; the share uses a fresh one, or says to close the file', async t => {
  // A stand-in for Windows: renaming over a file another app has open fails with EPERM.
  const held = new Set<string>();
  const s = await shareDeps(t);
  const fsHeld = { ...(await import('node:fs/promises')), rename: async (from: string, to: string) => { if (held.has(to)) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); return rename(from, to); } };
  (s.deps as any).fs = fsHeld;
  await mkdir(s.folder, { recursive: true });
  await writeFile(join(s.folder, 'INV-0001.pdf'), 'an older copy open in a PDF viewer');
  await writeFile(join(s.folder, 'INV-0001.eml'), 'a draft open in the mail app');
  held.add(join(s.folder, 'INV-0001.pdf')); held.add(join(s.folder, 'INV-0001.eml'));
  const reply = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, s.deps);
  assert.deepEqual(reply.result, { how: 'email', opened: 'draft', file: 'INV-0001-2.pdf', to: true, note: null });
  assert.deepEqual(s.paths, [join(s.folder, 'INV-0001-2.eml')]);
  assert.deepEqual(await readFile(join(s.folder, 'INV-0001-2.pdf')), PDF);
  assert.ok((await readFile(join(s.folder, 'INV-0001-2.eml'), 'utf8')).includes('filename="INV-0001.pdf"'), 'the client still gets INV-0001.pdf');
  assert.equal(await readFile(join(s.folder, 'INV-0001.pdf'), 'utf8'), 'an older copy open in a PDF viewer');

  // Every other name is a file there too, each open in another app (round 2: a held file is one that is there).
  for (let n = 2; n <= 9; n++) { held.add(join(s.folder, `INV-0001-${n}.pdf`)); await writeFile(join(s.folder, `INV-0001-${n}.pdf`), 'another copy'); }
  const busy = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, s.deps);
  assert.deepEqual([busy.ok, busy.error.code, busy.error.message], [false, 'SHARE_FILE_IN_USE', 'INV-0001.pdf is open in another app. Close it there and try again.']);
  assert.ok((await readdir(s.folder)).every(name => !name.endsWith('.tmp')));
});

/**
 * A6 round 2: holds a file open the way a PDF viewer does (read sharing only, no delete sharing) in a hidden PowerShell,
 * and answers the release. Waiting for it to start is time-limited, and the release always ends the process.
 */
async function holdOpen(path: string): Promise<() => Promise<void>> {
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$f=[System.IO.File]::Open('${path}', 'Open', 'Read', 'Read'); Write-Output held; [Console]::In.ReadLine() | Out-Null; $f.Close()`], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const exited = new Promise<void>(done => { if (holder.exitCode !== null) done(); else holder.once('exit', () => done()); });
  const release = async () => {
    holder.stdin.end();
    const late = setTimeout(() => holder.kill(), 3000);
    await Promise.race([exited, new Promise(done => setTimeout(done, 6000))]);
    clearTimeout(late);
    if (holder.exitCode === null && holder.signalCode === null) { holder.kill(); await Promise.race([exited, new Promise(done => setTimeout(done, 2000))]); }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      new Promise(done => holder.stdout.once('data', done)),
      new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('The file holder did not start.')), 10_000); }),
    ]);
  } catch (error) { await release(); throw error; } finally { clearTimeout(timer); }
  return release;
}

test('A6 round 1 (medium 1): on Windows, a PDF held open without delete sharing still lets the share go through', { skip: process.platform !== 'win32', timeout: 30_000 }, async t => {
  const s = await shareDeps(t, { app: true });
  await mkdir(s.folder, { recursive: true });
  const path = join(s.folder, 'INV-0001.pdf');
  await writeFile(path, 'an older copy');
  const release = await holdOpen(path);
  // A6 round 2: released in the test itself, before the folder is cleaned up, even when an assertion fails.
  try {
    const reply = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, s.deps);
    assert.deepEqual([reply.ok, reply.result?.file], [true, 'INV-0001-2.pdf']);
    assert.deepEqual(await readFile(join(s.folder, 'INV-0001-2.pdf')), PDF);
  } finally { await release(); }
});

test('A6 round 1 (low 8): an old folder, junction or link named like a share file is never taken out, nor what it points to', async t => {
  const s = await shareDeps(t);
  await mkdir(s.folder, { recursive: true });
  const outside = join(s.root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'INV-0005.pdf'), 'not in the share folder');
  const old = new Date(Date.now() - 3 * 24 * 60 * 60_000);
  await mkdir(join(s.folder, 'INV-0004.eml'));
  await utimes(join(s.folder, 'INV-0004.eml'), old, old);
  await symlink(outside, join(s.folder, 'INV-0006.pdf'), 'junction');
  let fileLink = true;
  try { await symlink(join(outside, 'INV-0005.pdf'), join(s.folder, 'INV-0005.pdf'), 'file'); } catch { fileLink = false; }
  await utimes(join(outside, 'INV-0005.pdf'), old, old);
  await utimes(outside, old, old);
  await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, s.deps);
  const left = (await readdir(s.folder)).sort();
  assert.deepEqual(left, ['INV-0001.pdf', 'INV-0004.eml', ...(fileLink ? ['INV-0005.pdf'] : []), 'INV-0006.pdf']);
  assert.equal(await readFile(join(outside, 'INV-0005.pdf'), 'utf8'), 'not in the share folder');
  for (const name of ['INV-0004.eml', 'INV-0006.pdf', ...(fileLink ? ['INV-0005.pdf'] : [])]) {
    const reply = await share.showShared({}, { name }, s.deps);
    assert.equal(reply.ok, false, name);
  }
});

test('A6 round 1 (medium 3): with no app known for email files, the draft is not opened (no Open with box); the mail link opens instead', async t => {
  const s = await shareDeps(t);
  (s.deps as any).emlApp = async () => false;
  assert.deepEqual((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, s.deps)).result, { how: 'email', opened: 'link', file: 'INV-0001.pdf', to: true, note: null });
  assert.deepEqual(s.paths, [], 'shell.openPath is never asked to open a file no app takes');
  assert.deepEqual(s.opened, [mailto('client@example.com')]);
  const known = await shareDeps(t);
  (known.deps as any).emlApp = async () => true;
  assert.equal((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, known.deps)).result.opened, 'draft');
  const broken = await shareDeps(t);
  (broken.deps as any).emlApp = async () => { throw new Error('reg failed'); };
  assert.equal((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, broken.deps)).result.opened, 'link', 'a check that fails counts as no app');
});

test('A6 rounds 1 and 2 (medium 3, lows 3 and 4): the app for email files is read quietly from the computer, per system, within one time limit', async () => {
  const runs: string[][] = [];
  const REG = join(process.env.SystemRoot ?? String.raw`C:\Windows`, 'System32', 'reg.exe');
  const answers = (table: Record<string, { code: number; stdout: string }>) => async (command: string, args: string[]) => {
    runs.push([command, ...args]);
    return table[[command === REG ? 'reg' : command, ...args].join(' ')] ?? { code: 1, stdout: '' };
  };
  const EXTS = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.eml`;
  // Classic Outlook, as on this computer: no user choice, the class default, and its shell verbs; reg.exe by its full path.
  assert.equal(await share.emlHandler({ platform: 'win32', run: answers({
    [String.raw`reg query HKCR\.eml /ve`]: { code: 0, stdout: 'HKEY_CLASSES_ROOT\\.eml\r\n    (Default)    REG_SZ    Outlook.File.eml.15\r\n' },
    [String.raw`reg query HKCR\Outlook.File.eml.15\shell`]: { code: 0, stdout: 'x' },
  }) }), true);
  assert.deepEqual(runs.map(run => run.slice(0, 3)), [[REG, 'query', `${EXTS}\\UserChoiceLatest\\ProgId`], [REG, 'query', `${EXTS}\\UserChoice`], [REG, 'query', String.raw`HKCR\.eml`], [REG, 'query', String.raw`HKCR\Outlook.File.eml.15\shell`]]);
  // Windows 11 24H2 keeps the owner's choice in UserChoiceLatest, which comes first; then UserChoice.
  assert.equal(await share.emlHandler({ platform: 'win32', run: answers({
    [`reg query ${EXTS}\\UserChoiceLatest\\ProgId /v ProgId`]: { code: 0, stdout: '    ProgId    REG_SZ    AppXlatest1\r\n' },
    [`reg query ${EXTS}\\UserChoice /v ProgId`]: { code: 0, stdout: '    ProgId    REG_SZ    Gone.Prog\r\n' },
    [String.raw`reg query HKCR\AppXlatest1\shell`]: { code: 0, stdout: 'x' },
  }) }), true);
  assert.equal(await share.emlHandler({ platform: 'win32', run: answers({
    [`reg query ${EXTS}\\UserChoice /v ProgId`]: { code: 0, stdout: `${EXTS}\\UserChoice\r\n    ProgId    REG_SZ    AppXabc123\r\n` },
    [String.raw`reg query HKCR\AppXabc123\shell`]: { code: 0, stdout: 'x' },
  }) }), true);
  // A German Windows names the default value "(Standard)": the first REG_SZ line is read, whatever its name.
  assert.equal(await share.emlHandler({ platform: 'win32', run: answers({
    [String.raw`reg query HKCR\.eml /ve`]: { code: 0, stdout: 'HKEY_CLASSES_ROOT\\.eml\r\n    (Standard)    REG_SZ    Outlook.File.eml.15\r\n' },
    [String.raw`reg query HKCR\Outlook.File.eml.15\shell`]: { code: 0, stdout: 'x' },
  }) }), true);
  for (const table of [{}, { [String.raw`reg query HKCR\.eml /ve`]: { code: 0, stdout: '    (Default)    REG_SZ    \r\n' } },
    { [String.raw`reg query HKCR\.eml /ve`]: { code: 0, stdout: '    (Default)    REG_SZ    Gone.Prog\r\n' } },
    { [String.raw`reg query HKCR\.eml /ve`]: { code: 0, stdout: '    (Default)    REG_SZ    a\\..\\b\r\n' } }]) {
    assert.equal(await share.emlHandler({ platform: 'win32', run: answers(table) }), false, JSON.stringify(table));
  }
  assert.equal(await share.emlHandler({ platform: 'linux', run: answers({ 'xdg-mime query default message/rfc822': { code: 0, stdout: 'thunderbird.desktop\n' } }) }), true);
  assert.equal(await share.emlHandler({ platform: 'linux', run: answers({}) }), false);
  assert.equal(await share.emlHandler({ platform: 'darwin', run: answers({}) }), true, 'Mail opens email files on every Mac');
  assert.equal(await share.emlHandler({ platform: 'win32', run: async () => { throw new Error('no reg'); } }), false);
  // One time limit for the whole check, however many queries it makes; each query gets only what is left of it.
  const limits: number[] = [];
  const started = Date.now();
  assert.equal(await share.emlHandler({ platform: 'win32', limitMs: 300, run: (_command: string, _args: string[], options: { timeoutMs: number }) => { limits.push(options.timeoutMs); return new Promise(() => {}); } }), false);
  assert.ok(Date.now() - started < 2000, 'a check that never answers ends at the limit');
  assert.ok(limits.length === 1 && limits[0]! <= 300, JSON.stringify(limits));
});

test('A6 round 2 (medium 2): a business name pasted with a hidden mark still gets its email (Chai{ZWSP,SHY,LRM}Point)', async t => {
  for (const code of [0x200B, 0x00AD, 0x200E]) {
    const subject = `Invoice INV-0001 from Chai${String.fromCodePoint(code)}Point`;
    const s = await shareDeps(t, { file: engineFile({ share: { ...engineFile().share, mailtoUrl: mailto('client@example.com', subject) } }) });
    const reply = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'email' }, s.deps);
    assert.equal(reply.result?.opened, 'draft', code.toString(16));
    assert.ok((await readFile(join(s.folder, 'INV-0001.eml'), 'utf8')).startsWith(['To: client@example.com', 'Subject: Invoice INV-0001 from ChaiPoint', ''].join('\r\n')), code.toString(16));
  }
  assert.throws(() => draft({ subject: ['Invoice', 'Bcc: other@example.com'].join('\r\n') }), (error: any) => error.code === 'MAIL_DRAFT_INVALID', 'line breaks are still refused');
});

test('A6 round 2 (low 5): a file used as it is gets a fresh time, so the next prune keeps a file the sheet still offers', async t => {
  const s = await shareDeps(t);
  await mkdir(s.folder, { recursive: true });
  const path = join(s.folder, 'INV-0001.pdf');
  await writeFile(path, PDF);
  const earlier = new Date(Date.now() - 20 * 60 * 60_000);
  await utimes(path, earlier, earlier);
  assert.equal((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, s.deps)).result.file, 'INV-0001.pdf');
  assert.ok(Date.now() - (await stat(path)).mtimeMs < 60_000, 'the reused file was touched');
});

test('A6 round 2 (low 6): only a file in use counts as open in another app; a plain refusal to write says so', async t => {
  const fsp = await import('node:fs/promises');
  const refusing = (code: string, options: { readOnly?: boolean } = {}) => ({ ...fsp,
    rename: async () => { throw Object.assign(new Error('refused'), { code }); },
    access: async (path: string, mode?: number) => { if (options.readOnly) throw Object.assign(new Error('read-only'), { code: 'EACCES' }); return fsp.access(path, mode); } });
  const NOT_ALLOWED = ['SHARE_NOT_ALLOWED', "Chausar isn't allowed to write in its share folder. Check that folder's permissions, then try again."];
  // No file there yet: a refusal to write is not "open in another app".
  for (const code of ['EPERM', 'EACCES']) {
    const s = await shareDeps(t);
    (s.deps as any).fs = refusing(code);
    const reply = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, s.deps);
    assert.deepEqual([reply.ok, reply.error.code, reply.error.message], [false, ...NOT_ALLOWED], code);
  }
  // A read-only file there: the same honest words.
  const readOnly = await shareDeps(t);
  await mkdir(readOnly.folder, { recursive: true });
  await writeFile(join(readOnly.folder, 'INV-0001.pdf'), 'an older copy');
  (readOnly.deps as any).fs = refusing('EPERM', { readOnly: true });
  assert.deepEqual((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, readOnly.deps)).error.code, NOT_ALLOWED[0]);
  // EBUSY is always a file in use: every name is tried, then the owner is asked to close it.
  const busy = await shareDeps(t);
  (busy.deps as any).fs = refusing('EBUSY');
  assert.equal((await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, busy.deps)).error.code, 'SHARE_FILE_IN_USE');
});
