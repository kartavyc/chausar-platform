import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { xlsxBook } from '../runtime/reports-ext/xlsx.ts';
import {
  PDF_COMMIT_REFUSALS, READER_INSTALL_REFUSALS, failureOf, sourceIdFor, validateFr07, validatePasswordHeld, validatePdfCommit, validatePdfPreview, validateReaderStatus,
  type JourneyPort,
} from '../../app/ui/src/screens/first-run/journey-contracts.ts';
import { proposalsFor, sheetToCsv, validateWorkbookSheet } from '../../app/ui/src/screens/first-run/proposals.ts';

/**
 * Round 4, frame-today: FR-07 "Bring a file" driven the way the screen drives it, against a real
 * demo Engine with the connectors-ext module (no fake). The PDF statement goes
 * readerStatus → preview → providePassword → preview → commit → result, and every reply passes
 * the screen's own validators (`screens/first-run/journey-contracts.ts`).
 *
 * The full PDF path needs the trusted Python helper with pdfplumber, plus pypdf and reportlab to
 * write the synthetic statement (CHAUSAR_PYTHON, else /usr/bin/python3). Without them the test of
 * that path is skipped with its reason, and the READER_NOT_INSTALLED path still runs end to end.
 */
const python = process.env.CHAUSAR_PYTHON ?? (existsSync('/usr/bin/python3') ? realpathSync('/usr/bin/python3') : '');
const probe = python ? spawnSync(python, ['-c', 'import pdfplumber, pypdf, reportlab'], { encoding: 'utf8' }) : null;
const skip = !python ? 'no Python found (set CHAUSAR_PYTHON)' : probe?.status !== 0 ? 'PDF helper libraries not installed: needs pdfplumber, plus pypdf and reportlab to build test PDFs' : false;
const PASSWORD = 'Synthetic-Statement-Pass-4410';
const pages = JSON.parse(readFileSync(new URL('../../fixtures/connectors/bank-statements/hdfc-like.pdf-pages.json', import.meta.url), 'utf8')).pages as { text: string }[];

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
  const directory = await mkdtemp(join(tmpdir(), 'chausar-fr07-r4-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', ...(python ? { pythonExecutable: python } : {}), ...options } as any);
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Traders', passphrase: 'Synthetic connector passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  const calls: string[] = [];
  const rpc: JourneyPort = { request: (method, payload) => { calls.push(method); return engine.request(method, payload as Record<string, unknown>); } };
  return { engine, rpc, calls };
}

/** The refusal code the screen reads from a thrown engine error (`failureOf`). */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { const failure = failureOf(error); return failure.kind === 'refused' ? failure.code : 'NOT_BUILT'; }
  return 'ANSWERED';
}

test('FR-07 PDF from the screen\'s request sequence against the real engine: password once, preview, commit, result', { skip, timeout: 90_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-fr07-r4-pdf-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { rpc, calls } = await open(t);
  const file = { name: 'September statement.pdf', bytesBase64: await pdf(dir, 'locked', pages.map(p => p.text), PASSWORD) };
  const sourceId = sourceIdFor(file.name);
  // BringFile offers PDF only when the reader answers.
  const reader = validateReaderStatus(await rpc.request('imports.readerStatus', {}));
  assert.deepEqual({ status: reader.status, pdfText: reader.pdfText, reason: reader.reason }, { status: 'installed', pdfText: true, reason: null });
  // PdfStatement: the first preview asks for the password.
  const request = { sourceId, kind: 'pdf' as const, bytesBase64: file.bytesBase64 };
  assert.equal(await refusal(rpc.request('imports.preview', request)), 'PASSWORD_REQUIRED');
  // A wrong password is held, then the next preview says so without a count.
  validatePasswordHeld(await rpc.request('imports.providePassword', { sourceId, password: 'not-the-password' }), sourceId);
  assert.equal(await refusal(rpc.request('imports.preview', request)), 'WRONG_PASSWORD');
  const held = await rpc.request('imports.providePassword', { sourceId, password: PASSWORD });
  validatePasswordHeld(held, sourceId);
  assert.equal(JSON.stringify(held).includes(PASSWORD), false);
  const preview = validatePdfPreview(await rpc.request('imports.preview', request), sourceId);
  assert.equal(preview.status, 'accepted');
  assert.equal(preview.fr07.state, 'checked'); assert.equal(preview.fr07.checkPassed, true);
  assert.ok(preview.fr07.linesRead > 0); assert.equal(preview.fr07.openingMinor, '5000000'); assert.equal(preview.fr07.readByOcr, false);
  // The password was used once.
  assert.equal(await refusal(rpc.request('imports.preview', request)), 'PASSWORD_REQUIRED');
  const taken = validatePdfCommit(await rpc.request('imports.commit', { sourceId, envelopeId: preview.envelopeId }), preview.envelopeId, sourceId);
  assert.equal(taken.state, 'imported'); assert.ok(taken.imported !== null && taken.imported.rows > 0 && !taken.imported.duplicate);
  const result = validateFr07(await (rpc as { request(method: string, payload: unknown): Promise<unknown> }).request('imports.result', { envelopeId: preview.envelopeId }));
  assert.deepEqual(result, taken);
  // Taking the same read again never takes it twice: the screen reads either the same import or a refusal it has words for.
  try {
    const twice = validatePdfCommit(await rpc.request('imports.commit', { sourceId, envelopeId: preview.envelopeId }), preview.envelopeId, sourceId);
    assert.equal(twice.imported?.importId, taken.imported.importId);
  } catch (error) {
    const failure = failureOf(error);
    assert.ok(failure.kind === 'refused' && PDF_COMMIT_REFUSALS.has(failure.code), JSON.stringify(failure));
  }
  assert.deepEqual(calls.slice(0, 9), ['imports.readerStatus', 'imports.preview', 'imports.providePassword', 'imports.preview', 'imports.providePassword', 'imports.preview', 'imports.preview', 'imports.commit', 'imports.result']);
});

test('FR-07 PDF refused by content: the screen\'s validators read the reason and the line from the real envelope', { skip, timeout: 90_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-fr07-r4-pdf-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { rpc } = await open(t);
  const broken = pages.map(p => p.text.replace(/\n03\/09\/2026 NEFT DR-RAVI AND CO-INV 22 03\/09\/2026 7,500.00 54,500.00/, ''));
  const sourceId = sourceIdFor('Broken statement.pdf');
  const refused = validatePdfPreview(await rpc.request('imports.preview', { sourceId, kind: 'pdf', bytesBase64: await pdf(dir, 'broken', broken) }), sourceId);
  assert.equal(refused.status, 'refused'); assert.equal(refused.fr07.state, 'refused');
  assert.equal(refused.fr07.reason, 'DOES_NOT_ADD_UP'); assert.ok(refused.fr07.line !== null && refused.fr07.line > 0);
  assert.equal(await refusal(rpc.request('imports.commit', { sourceId, envelopeId: refused.envelopeId })), 'IMPORT_NOT_ACCEPTED');
});

test('FR-07 PDF without the reader, end to end: READER_NOT_INSTALLED, the status in words, and install refused', async t => {
  const { rpc } = await open(t, { pythonExecutable: undefined });
  const sourceId = sourceIdFor('September statement.pdf');
  // BringFile still offers PDF: the reader answered, saying it is not installed.
  const reader = validateReaderStatus(await rpc.request('imports.readerStatus', {}));
  assert.equal(reader.status, 'not-installed'); assert.equal(reader.pdfText, false);
  assert.equal(reader.reason, 'PYTHON_NOT_CONFIGURED');
  // PdfStatement: the preview refuses READER_NOT_INSTALLED, so the screen reads the status again and offers Install.
  assert.equal(await refusal(rpc.request('imports.preview', { sourceId, kind: 'pdf', bytesBase64: Buffer.from('%PDF-1.4 synthetic').toString('base64') })), 'READER_NOT_INSTALLED');
  const again = validateReaderStatus(await rpc.request('imports.readerStatus', {}));
  assert.deepEqual(again, reader);
  // Install always refuses in this build; this demo launch refuses it as an external call. Both have words on the screen.
  const install = await refusal(rpc.request('imports.installReader', {}));
  assert.ok(READER_INSTALL_REFUSALS.has(install), install);
});

test('FR-07 Excel proposed meanings: the engine\'s own sheet cells become CSV text for learning-ext, as CSV does', async t => {
  const { rpc, calls } = await open(t, { pythonExecutable: undefined });
  const rows = [['id', 'date', 'Invoice Value', 'Customer, City'], ['inv-1', '2026-09-03', '1000.00', 'Asha "A" Traders'], ['inv-2', '2026-09-12', '2000.00', 'Ravi & Co']];
  const bytesBase64 = xlsxBook('Sales', rows).toString('base64');
  // `sources.workbook` is the engine's reading of the cells; the CSV form is the engine's own quoting.
  const cells = validateWorkbookSheet(await rpc.request('sources.workbook', { bytesBase64 }));
  assert.deepEqual(cells, rows);
  const content = sheetToCsv(cells);
  assert.equal(content, 'id,date,Invoice Value,"Customer, City"\ninv-1,2026-09-03,1000.00,"Asha ""A"" Traders"\ninv-2,2026-09-12,2000.00,Ravi & Co');
  const outcome = await proposalsFor(rpc, { name: 'September sales.xlsx', format: 'xlsx', bytesBase64 });
  assert.equal(outcome.kind, 'ready', JSON.stringify(outcome));
  if (outcome.kind !== 'ready') return;
  assert.deepEqual(outcome.proposal.columns.map(column => column.header).sort(), ['Customer, City', 'Invoice Value']);
  assert.equal(outcome.proposal.status, 'proposed');
  assert.deepEqual(calls.filter(call => call.startsWith('learningx.') || call === 'sources.workbook'),
    ['sources.workbook', 'sources.workbook', 'learningx.dictionaryProposals', 'learningx.dictionaryBuild']);
  // The same sheet's draft is found again by the hash of its CSV text, not built twice.
  const again = await proposalsFor(rpc, { name: 'September sales.xlsx', format: 'xlsx', bytesBase64 });
  assert.equal(again.kind === 'ready' && again.proposal.id, outcome.proposal.id);
  assert.equal(calls.filter(call => call === 'learningx.dictionaryBuild').length, 1);
  // A PDF has no sheet.
  assert.equal((await proposalsFor(rpc, { name: 'statement.pdf', format: 'pdf', bytesBase64: 'AAAA' })).kind, 'sheets-only');
});
