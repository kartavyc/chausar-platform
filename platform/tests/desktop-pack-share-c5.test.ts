// C5 task 16: Send to my CA. The window names only the month and how; main reads the remembered contact and the month's
// file from the engine, keeps the file in the share folder and opens a draft to the CA with it attached, or WhatsApp to
// the CA's number. No contact, or a bad one, refuses with words and writes nothing. Nothing is sent.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { sharePack } = require('../../app/desktop/pack-share.cjs');
const CSV = 'Section,Date\nInvoice,2026-10-05\n';

async function deps(t: TestContext, contact: Record<string, unknown>, over: Record<string, unknown> = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-pack-c5-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const opened: string[] = [], links: string[] = [];
  return {
    folder, opened, links,
    window: { webContents: {} }, assertTrustedSender() {}, publicError: (error: any) => ({ code: error.code, message: error.message }),
    engine: { request: async (method: string) => (method === 'venture.accountant.get' ? contact : { fileName: 'ledger-2026-10-for-ca.csv', csv: CSV }) },
    shell: { openPath: async (path: string) => { opened.push(path); return ''; }, openExternal: async (link: string) => { links.push(link); } },
    whatsappApp: () => false, emlApp: () => true, ...over,
  };
}

test('the draft is addressed to the remembered email with the CSV attached', async t => {
  const d = await deps(t, { email: 'ca@example.com', whatsapp: null });
  const reply = await sharePack({}, { month: '2026-10', how: 'email' }, d);
  assert.deepEqual(reply, { ok: true, result: { how: 'email', opened: 'draft', file: 'ledger-2026-10-for-ca.csv', to: 'ca@example.com' } });
  assert.equal(d.opened.length, 1);
  const eml = await readFile(d.opened[0]!, 'utf8');
  assert.match(eml, /^To: ca@example\.com\r\n/);
  assert.match(eml, /X-Unsent: 1/);
  assert.match(eml, /filename="ledger-2026-10-for-ca\.csv"/);
  assert.ok(eml.includes(Buffer.from(CSV).toString('base64')));
  assert.deepEqual((await readdir(d.folder)).sort(), ['ledger-2026-10-for-ca.csv', 'ledger-2026-10-for-ca.eml']);
});

test('WhatsApp opens the web page to the remembered number; the file waits in the folder', async t => {
  const d = await deps(t, { email: null, whatsapp: '919876543210' });
  const reply = await sharePack({}, { month: '2026-10', how: 'whatsapp' }, d);
  assert.equal(reply.ok, true);
  assert.equal(reply.result.opened, 'web');
  assert.match(d.links[0]!, /^https:\/\/wa\.me\/919876543210\?text=/);
  assert.deepEqual(await readdir(d.folder), ['ledger-2026-10-for-ca.csv']);
});

test('no contact and a bad address refuse with words and write nothing; a bad request is refused', async t => {
  const none = await deps(t, { email: null, whatsapp: null });
  assert.deepEqual(await sharePack({}, { month: '2026-10', how: 'email' }, none), { ok: false, error: { code: 'CA_CONTACT_MISSING', message: "Add your CA's email first." } });
  assert.deepEqual(await readdir(none.folder), []);
  const bad = await deps(t, { email: 'a b@example.com\r\nBcc: x@example.com', whatsapp: null });
  assert.equal((await sharePack({}, { month: '2026-10', how: 'email' }, bad)).error.code, 'CA_CONTACT_BAD');
  assert.equal(bad.opened.length, 0);
  assert.equal((await sharePack({}, { month: 'October', how: 'email' }, none)).error.code, 'INVALID_REQUEST');
  assert.equal((await sharePack({}, { month: '2026-10', how: 'email', path: 'C:/x' }, none)).error.code, 'INVALID_REQUEST');
});
