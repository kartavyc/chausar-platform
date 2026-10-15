import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { imports, PASSWORD_TTL_MS } from '../runtime/connectors-ext/fr07.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

/**
 * FR-07 "Bring a file" over the real trusted helper. Synthetic statement PDFs are written in the
 * test with reportlab, and an encrypted copy with pypdf. Skipped, with the reason, when the
 * configured Python lacks pdfplumber, pypdf or reportlab.
 */
const python = process.env.CHAUSAR_PYTHON ?? (existsSync('/usr/bin/python3') ? realpathSync('/usr/bin/python3') : '');
const probe = python ? spawnSync(python, ['-c', 'import pdfplumber, pypdf, reportlab'], { encoding: 'utf8' }) : null;
const skip = !python ? 'no Python found (set CHAUSAR_PYTHON)' : probe?.status !== 0 ? 'PDF helper libraries not installed: needs pdfplumber, plus pypdf and reportlab to build test PDFs' : false;
const PASSWORD = 'Synthetic-Statement-Pass-7731';
const owner = { memberId: 'owner', role: 'owner' as const, epoch: 1, channel: 'desktop' as const };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const pages = JSON.parse(readFileSync(new URL('../../fixtures/connectors/bank-statements/hdfc-like.pdf-pages.json', import.meta.url), 'utf8')).pages as { text: string }[];

/** Write a text PDF (one page per fixture page), optionally encrypted, and return base64. */
async function pdf(dir: string, name: string, texts: string[], password?: string): Promise<string> {
  const script = join(dir, `${name}.py`), out = join(dir, `${name}.pdf`);
  await writeFile(script, `
import json, sys
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
texts = json.loads(sys.argv[1]); plain = sys.argv[2] + '.plain'
c = canvas.Canvas(plain)
for text in texts:
    y = 800
    for line in text.split('\\n'):
        c.drawString(40, y, line); y -= 14
    c.showPage()
c.save()
writer = PdfWriter(); writer.append(PdfReader(plain))
if len(sys.argv) > 3: writer.encrypt(sys.argv[3])
writer.write(sys.argv[2])
`);
  const run = spawnSync(python, [script, JSON.stringify(texts), out, ...(password ? [password] : [])], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return readFileSync(out).toString('base64');
}
async function open(t: any, options: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-fr07-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', ...(python ? { pythonExecutable: python } : {}), ...options } as any);
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Traders', passphrase: 'Synthetic connector passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  return { engine, directory };
}
const hostOf = (engine: Engine): ModuleHost => { const e = engine as any; return { get store() { return e.store(); }, services: e.services, demo: false, directory: e.options.directory, options: {}, call: (m: string, p: Record<string, unknown>) => engine.request(m, p) }; };
function filesContaining(root: string, needle: string): string[] {
  const hits: string[] = [];
  for (const name of readdirSync(root)) { const path = join(root, name); const info = statSync(path); if (info.isDirectory()) hits.push(...filesContaining(path, needle)); else if (readFileSync(path).includes(needle)) hits.push(path); }
  return hits;
}

test('FR-07: a password-protected statement is read once with a held password, checked and imported', { skip, timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-fr07-pdf-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { engine, directory } = await open(t);
  const locked = await pdf(dir, 'locked', pages.map(p => p.text), PASSWORD);
  const request = { sourceId: 'statement-sep', kind: 'pdf', bytesBase64: locked };
  await assert.rejects(engine.request('imports.preview', request), code('PASSWORD_REQUIRED'));
  await engine.request('imports.providePassword', { sourceId: 'statement-sep', password: 'not-the-password' });
  await assert.rejects(engine.request('imports.preview', request), code('WRONG_PASSWORD'));
  const heldReply = await engine.request('imports.providePassword', { sourceId: 'statement-sep', password: PASSWORD });
  assert.equal(JSON.stringify(heldReply).includes(PASSWORD), false, 'the password is never echoed');
  const preview = await engine.request('imports.preview', request);
  assert.equal(preview.status, 'accepted', JSON.stringify(preview.refusal));
  assert.equal(preview.fr07.state, 'checked'); assert.equal(preview.fr07.checkPassed, true);
  assert.ok(preview.fr07.linesRead > 0); assert.equal(preview.fr07.openingMinor, '5000000');
  assert.equal(preview.fr07.closingMinor, preview.sourceTotals.total);
  await assert.rejects(engine.request('imports.preview', request), code('PASSWORD_REQUIRED'), 'the password is used once, then wiped');
  const done = await engine.request('imports.commit', { sourceId: 'statement-sep', envelopeId: preview.id });
  assert.equal(done.state, 'imported'); assert.ok(done.imported.rows > 0);
  assert.deepEqual(await engine.request('imports.result', { envelopeId: preview.id }), done);
  // The password appears nowhere: workspace state, activity, receipts, or any file the engine wrote.
  const state = JSON.stringify((engine as any).store().read());
  assert.equal(state.includes(PASSWORD), false);
  assert.equal(JSON.stringify((engine as any).store().read().activity).includes(PASSWORD), false);
  assert.equal(JSON.stringify((engine as any).store().read().receipts).includes(PASSWORD), false);
  assert.deepEqual(filesContaining(directory, PASSWORD), []);
});

test('FR-07: refused statements carry the fixed reasons; a picture and a missing reader are named', { skip, timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-fr07-pdf-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { engine } = await open(t);
  const broken = pages.map(p => p.text.replace(/\n03\/09\/2026 NEFT DR-RAVI AND CO-INV 22 03\/09\/2026 7,500.00 54,500.00/, ''));
  const out = await engine.request('imports.preview', { sourceId: 'statement-broken', kind: 'pdf', bytesBase64: await pdf(dir, 'broken', broken) });
  assert.equal(out.status, 'refused'); assert.equal(out.fr07.reason, 'DOES_NOT_ADD_UP'); assert.ok(out.fr07.line > 0);
  assert.deepEqual(out.fr07.kept, { file: 'not-kept', record: 'books-sources-history' });
  const cut = [pages[0].text];
  const short = await engine.request('imports.preview', { sourceId: 'statement-cut', kind: 'pdf', bytesBase64: await pdf(dir, 'cut', cut) });
  assert.equal(short.fr07.reason, 'CUT_SHORT');
  const blank = await pdf(dir, 'blank', ['']);
  await assert.rejects(engine.request('imports.preview', { sourceId: 'statement-picture', kind: 'pdf', bytesBase64: blank }), code('PICTURE_ONLY'));
  const status = await engine.request('imports.readerStatus', {});
  assert.equal(status.status, 'installed'); assert.equal(status.pdfText, true);
  // Without a bundled reader the install refuses (the release lane installs one when the bundle exists).
  await assert.rejects(async () => (imports.installReader as any)(owner, {}, hostOf(engine)), code('READER_INSTALL_UNAVAILABLE'));
  await assert.rejects(engine.request('imports.installReader', {}), code('DEMO_EXTERNAL_DISABLED'));
});

test('FR-07: a held password expires, is cleared on lock, and is bound to the member who gave it', { skip, timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-fr07-pdf-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { engine } = await open(t);
  const locked = await pdf(dir, 'locked', pages.map(p => p.text), PASSWORD);
  const request = { sourceId: 'statement-sep', kind: 'pdf', bytesBase64: locked };
  await engine.request('imports.providePassword', { sourceId: 'statement-sep', password: PASSWORD });
  const realNow = Date.now; Date.now = () => realNow() + PASSWORD_TTL_MS + 1000;
  try { await assert.rejects(engine.request('imports.preview', request), code('PASSWORD_REQUIRED')); } finally { Date.now = realNow; }
  await engine.request('imports.providePassword', { sourceId: 'statement-sep', password: PASSWORD });
  await engine.request('workspace.lock', {});
  await engine.request('workspace.open', { passphrase: 'Synthetic connector passphrase 2026', folder: 'main' });
  await assert.rejects(engine.request('imports.preview', request), code('PASSWORD_REQUIRED'), 'locking drops every held password');
  const host = hostOf(engine);
  await imports.providePassword(owner, { sourceId: 'statement-sep', password: PASSWORD }, host);
  await assert.rejects(imports.preview({ ...owner, memberId: 'someone-else' }, request, host));
  assert.throws(() => imports.providePassword({ ...owner, channel: 'phone' as any }, { sourceId: 'x', password: 'y' }, host), code('OPEN_DESKTOP'));
});

test('FR-07: without the trusted helper the reader is reported missing and previews say so', async t => {
  const { engine } = await open(t, { pythonExecutable: undefined });
  assert.equal((await engine.request('imports.readerStatus', {})).status, 'not-installed');
  await assert.rejects(engine.request('imports.preview', { sourceId: 'statement', kind: 'pdf', bytesBase64: Buffer.from('%PDF-1.4 synthetic').toString('base64') }), code('READER_NOT_INSTALLED'));
  await assert.rejects(engine.request('imports.preview', { sourceId: 'statement', kind: 'doc', bytesBase64: 'AAAA' }), code('CONNECTOR_REQUEST_INVALID'));
  const csv = await engine.request('imports.preview', { sourceId: 'sheet', kind: 'csv', content: 'id,kind,date,amount,currency\na,invoice,2026-09-01,10.00,INR\n' });
  assert.equal(csv.sourceId, 'sheet', 'csv delegates to the core sources.preview');
});
