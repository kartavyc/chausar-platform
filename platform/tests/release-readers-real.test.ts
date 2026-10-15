import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnalyticalHelper } from '../runtime/helper.ts';
import { readerBundle, verifyReaderBundle } from '../runtime/native/reader-bundle.ts';

/**
 * Real run of the bundled PDF readers. Set CHAUSAR_TEST_READER_RUNTIME to a runtime staged with
 * `node scripts/release/stage-runtime.ts ... --readers-only` (the folder holding python/, tesseract/,
 * readers.json and manifest.json). The trusted helper (platform/runtime/helper.ts →
 * platform/helpers/analytics.py) runs on the staged interpreter, with its process limits, on a
 * synthetic text PDF and a synthetic scanned PDF. CHAUSAR_TEST_READER_DOCKER=1 also runs the helper
 * inside debian:bookworm-slim with only the runtime mounted, to show tesseract is self-contained.
 */
const runtime = process.env.CHAUSAR_TEST_READER_RUNTIME ? resolve(process.env.CHAUSAR_TEST_READER_RUNTIME) : '';
const python = runtime ? join(runtime, process.platform === 'win32' ? 'python/python.exe' : 'python/bin/python3') : '';
const skip = !runtime ? 'set CHAUSAR_TEST_READER_RUNTIME to a staged runtime with the PDF readers' : !existsSync(python) || !existsSync(join(runtime, 'readers.json')) ? 'the staged runtime has no PDF readers' : false;
const dockerSkip = skip || (process.env.CHAUSAR_TEST_READER_DOCKER !== '1' ? 'set CHAUSAR_TEST_READER_DOCKER=1 to run the helper in debian:bookworm-slim' : false);
const ANALYTICS = fileURLToPath(new URL('../helpers/analytics.py', import.meta.url));
const LINES = ['STATEMENT OF ACCOUNT', 'Opening balance 12,500.00', 'NEFT CREDIT RAVI AND CO 3,250.00', 'Closing balance 15,750.00'];

/** A one-page PDF with a real text layer (Helvetica), built byte by byte. */
export function textPdf(lines: string[]): Buffer {
  const escape = (text: string) => text.replace(/[()\\]/g, match => `\\${match}`);
  const stream = `BT /F1 14 Tf 18 TL 72 720 Td ${lines.map(line => `(${escape(line)}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
/** A one-page picture-only PDF: the lines drawn by the staged Pillow at 200 dpi, no text layer. */
function scannedPdf(lines: string[]): Buffer {
  const script = [
    'import io, json, sys', 'from PIL import Image, ImageDraw, ImageFont',
    'lines = json.loads(sys.argv[1])', 'image = Image.new("L", (1700, 2200), 255)', 'draw = ImageDraw.Draw(image)', 'font = ImageFont.load_default(size=44)',
    'for index, line in enumerate(lines):', '    draw.text((150, 200 + index * 90), line, fill=0, font=font)',
    'buffer = io.BytesIO()', 'image.save(buffer, format="PDF", resolution=200)', 'sys.stdout.buffer.write(buffer.getvalue())',
  ].join('\n');
  const result = spawnSync(python, ['-I', '-c', script, JSON.stringify(lines)], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
const words = (text: string) => text.replace(/\s+/g, ' ').trim();

async function resources(t: TestContext): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-reader-resources-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await symlink(runtime, join(folder, 'runtime-binaries'), 'dir');
  return folder;
}

test('the staged helper reports both readers installed, reads a text PDF and OCRs a scanned PDF', { skip, timeout: 120_000 }, async () => {
  const helper = new AnalyticalHelper({ executable: python, timeoutMs: 30_000 });
  const status = await helper.run('pdf.status', {});
  assert.deepEqual(status.result, { pdfText: true, pdfOcr: true, tesseract: true });
  assert.equal(status.receipt.engine, 'python'); assert.equal(status.receipt.resourceLimits, process.platform !== 'win32');

  const text = await helper.run('pdf.extract', { pdfBase64: textPdf(LINES).toString('base64') });
  assert.equal(text.result.pageCount, 1);
  assert.equal(words(text.result.pages[0].text), words(LINES.join(' ')));
  assert.match(text.result.parserVersion, /^0\.11\.10$/);
  assert.equal(text.receipt.sourceTainted, true);

  const scanned = scannedPdf(LINES);
  const empty = await helper.run('pdf.extract', { pdfBase64: scanned.toString('base64') });
  assert.equal(words(empty.result.pages[0].text), '', 'the scanned page has no text layer');
  const ocr = await helper.run('pdf.ocr', { pdfBase64: scanned.toString('base64') });
  assert.equal(ocr.result.engine, 'tesseract'); assert.equal(ocr.result.engineVersion, '5.5.3'); assert.equal(ocr.result.renderer, 'pypdfium2');
  const read = words(ocr.result.pages[0].text);
  for (const line of LINES) assert.ok(read.includes(line), `OCR read "${read}"`);
  assert.ok(ocr.result.pages[0].confidence >= 80, `confidence ${ocr.result.pages[0].confidence}`);
});

test('the bundle record matches the staged runtime and verifies without a download', { skip, timeout: 120_000 }, async t => {
  const resourcesPath = await resources(t);
  const pythonExecutable = join(resourcesPath, 'runtime-binaries', 'python', 'bin', 'python3');
  const bundle = await readerBundle({ resourcesPath, pythonExecutable });
  assert.equal(bundle.present, true, String(bundle.reason));
  assert.deepEqual(bundle.packages, { pdfplumber: '0.11.10', pypdfium2: '5.14.0', Pillow: '12.3.0' });
  assert.deepEqual(bundle.tesseract, { version: '5.5.3', languages: ['eng'] });
  assert.ok(bundle.sizeBytes! > 100_000_000);
  const install = await verifyReaderBundle({ resourcesPath, pythonExecutable });
  assert.equal(install.installed, true); assert.equal(install.downloaded, false); assert.ok(install.verifiedFiles > 500);
  assert.equal((await readerBundle({ resourcesPath, pythonExecutable: '/usr/bin/python3' })).reason, 'PYTHON_NOT_BUNDLED');
});

test('inside debian:bookworm-slim, with only the runtime mounted, the helper still OCRs', { skip: dockerSkip, timeout: 600_000 }, () => {
  const request = JSON.stringify({ operation: 'pdf.ocr', input: { pdfBase64: scannedPdf(LINES).toString('base64') } });
  const run = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '-v', `${runtime}:/opt/chausar/runtime-binaries:ro`, '-v', `${ANALYTICS}:/opt/chausar/analytics.py:ro`,
    'debian:bookworm-slim', '/opt/chausar/runtime-binaries/python/bin/python3', '-I', '-B', '/opt/chausar/analytics.py'], { input: request, maxBuffer: 4 * 1024 * 1024, timeout: 590_000 });
  assert.equal(run.status, 0, run.stderr?.toString());
  const response = JSON.parse(run.stdout.toString('utf8'));
  assert.equal(response.ok, true); assert.equal(response.result.engineVersion, '5.5.3'); assert.equal(response.runtime.resourceLimits, true);
  const read = words(response.result.pages[0].text);
  for (const line of LINES) assert.ok(read.includes(line), `OCR read "${read}"`);
});
