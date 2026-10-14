/**
 * EXPERIMENTAL OCR for scanned bank-statement PDFs: pdf.extract first, pdf.ocr only for pages with no
 * text, a confidence floor per OCR page, and a clean refusal when the OCR reader is not installed.
 * The fake-helper cases need no Python; the real case runs only where tesseract, pypdfium2, Pillow and
 * pdfplumber are importable by the configured Python (CHAUSAR_PYTHON, else /usr/bin/python3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { RECIPES, runRegistered } from '../runtime/connectors-ext/recipes/index.ts';
import { extractBankPdf, extractBankPdfWithOcr, pdfTextToRows, OCR_NOTICE, type PdfHelper, type PdfPage } from '../runtime/connectors-ext/bank-pdf.ts';
import { AnalyticalHelper, type HelperSpawn } from '../runtime/helper.ts';

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/connectors/bank-statements/${name}`, import.meta.url), 'utf8');
const statementPages = (): PdfPage[] => JSON.parse(fixture('hdfc-like.pdf-pages.json')).pages;
const pdfBase64 = Buffer.from('%PDF-1.4 synthetic scanned statement').toString('base64');
const code = (expected: string, extra: (e: any) => boolean = () => true) => (error: any) => { assert.equal(error?.code, expected, `${error?.code}: ${error?.message}`); assert.ok(extra(error)); return true; };

type Call = { op: string; input: any };
/** A PdfHelper whose page 2 (by default) has no text layer, and whose OCR reads it with a given confidence. */
function fakeHelper(options: { blank?: number[]; ocrConfidence?: number; ocrText?: (page: PdfPage) => string; ocrError?: unknown; ocrPages?: unknown } = {}): PdfHelper & { calls: Call[] } {
  const blank = options.blank ?? [2];
  const calls: Call[] = [];
  return {
    calls,
    async run(op, input) {
      calls.push({ op, input });
      const pages = statementPages();
      if (op === 'pdf.extract') return { result: { pages: pages.map(p => blank.includes(p.page) ? { page: p.page, text: ' \n' } : p), sourceTainted: true }, receipt: { op } };
      if (options.ocrError) throw options.ocrError;
      const ocr = options.ocrPages ?? pages.map(p => ({ page: p.page, text: options.ocrText ? options.ocrText(p) : p.text, confidence: options.ocrConfidence ?? 93 }));
      return { result: { pages: ocr, sourceTainted: true, numericalStatus: 'unverified', requiresReview: true }, receipt: { op } };
    },
  };
}

test('OCR runs only for pages without text, and the OCR statement passes the running-balance check', async () => {
  const helper = fakeHelper();
  const read = await extractBankPdfWithOcr(helper, pdfBase64, { minConfidence: 80 });
  assert.deepEqual(helper.calls.map(c => c.op), ['pdf.extract', 'pdf.ocr']);
  assert.deepEqual(helper.calls[1].input, { pdfBase64, maxPages: 50, language: 'eng' });
  assert.deepEqual(read.ocrPages, [2]);
  assert.equal(read.notice, OCR_NOTICE); assert.match(read.notice!, /read by OCR \(experimental\)/i);
  assert.deepEqual(read.pages.map(p => [p.page, p.source, p.confidence]), [[1, 'text', undefined], [2, 'ocr', 93]]);
  assert.equal(read.pages[0].text, statementPages()[0].text, 'the text-layer page is kept, not replaced by OCR');
  assert.deepEqual(read.receipts, { extract: { op: 'pdf.extract' }, ocr: { op: 'pdf.ocr' } });
  const { rows, meta } = pdfTextToRows(read.pages);
  assert.deepEqual(meta.ocrPages, [2], 'the rows carry which pages came from OCR');
  const out = runRegistered('bank.pdf-text', { rows });
  assert.equal(out.status, 'accepted', JSON.stringify(out.refusal ?? out.abstention));
  assert.equal(out.observed.total, '1750000');
  assert.equal(out.checks.find(c => c.id === 'closing-balance')?.status, 'passed');
  assert.ok(RECIPES.get('bank.pdf-text'));
});

test('a PDF with a text layer on every page never asks for OCR', async () => {
  const helper = fakeHelper({ blank: [] });
  const read = await extractBankPdfWithOcr(helper, pdfBase64, { minConfidence: 80 });
  assert.deepEqual(helper.calls.map(c => c.op), ['pdf.extract']);
  assert.deepEqual(read.ocrPages, []); assert.equal(read.notice, null); assert.equal(read.receipts.ocr, null);
  assert.deepEqual(pdfTextToRows(read.pages).meta.ocrPages, []);
});

test('an OCR page below the confidence floor is refused, naming the page', async () => {
  await assert.rejects(extractBankPdfWithOcr(fakeHelper({ ocrConfidence: 61 }), pdfBase64, { minConfidence: 80 }),
    code('PDF_OCR_LOW_CONFIDENCE', e => e.page === 2 && e.line === null && !/\d/.test(e.message)));
  // The floor applies only to pages that needed OCR; page 1 kept its text layer whatever OCR made of it.
  const passing = await extractBankPdfWithOcr(fakeHelper({ ocrConfidence: 80 }), pdfBase64, { minConfidence: 80 });
  assert.deepEqual(passing.ocrPages, [2]);
  // A scanned page that OCR reads as nothing is refused the same way.
  await assert.rejects(extractBankPdfWithOcr(fakeHelper({ ocrText: () => '  ' }), pdfBase64, { minConfidence: 50 }), code('PDF_OCR_LOW_CONFIDENCE', e => e.page === 2));
  // Several scanned pages: the first one under the floor is named.
  await assert.rejects(extractBankPdfWithOcr(fakeHelper({ blank: [1, 2], ocrPages: [{ page: 1, text: 'x', confidence: 90 }, { page: 2, text: 'y', confidence: 40 }] }), pdfBase64, { minConfidence: 80 }),
    code('PDF_OCR_LOW_CONFIDENCE', e => e.page === 2));
  await assert.rejects(extractBankPdfWithOcr(fakeHelper(), pdfBase64, { minConfidence: 0 }), code('PDF_OCR_OPTIONS_INVALID'));
  await assert.rejects(extractBankPdfWithOcr(fakeHelper(), pdfBase64, { minConfidence: 80.5 }), code('PDF_OCR_OPTIONS_INVALID'));
});

test('a misread OCR amount is still caught by the statement\'s own balance checks', async () => {
  const misread = (p: PdfPage) => p.page === 2 ? p.text.replace('2,000.00 52,500.00', '2,800.00 52,500.00') : p.text;
  const read = await extractBankPdfWithOcr(fakeHelper({ ocrText: misread }), pdfBase64, { minConfidence: 80 });
  const out = runRegistered('bank.pdf-text', { rows: pdfTextToRows(read.pages).rows });
  assert.notEqual(out.status, 'accepted', 'a high-confidence misread does not pass as data');
});

test('OCR results in an unexpected shape are refused', async () => {
  await assert.rejects(extractBankPdfWithOcr(fakeHelper({ ocrPages: [{ page: 1, text: 'only one', confidence: 90 }] }), pdfBase64, {}), code('PDF_OCR_INVALID'));
  await assert.rejects(extractBankPdfWithOcr(fakeHelper({ ocrPages: [{ page: 1, text: 'a', confidence: 90 }, { page: 2, text: 'b', confidence: 90.5 }] }), pdfBase64, {}), code('PDF_OCR_INVALID'));
  await assert.rejects(extractBankPdfWithOcr(fakeHelper({ ocrPages: [{ page: 1, text: 'a', confidence: 90 }, { page: 3, text: 'b', confidence: 90 }] }), pdfBase64, {}), code('PDF_OCR_INVALID'));
  await assert.rejects(extractBankPdfWithOcr(fakeHelper({ ocrPages: [{ page: 1, text: 'a', confidence: 90 }, { page: 2, text: 'b', confidence: 101 }] }), pdfBase64, {}), code('PDF_OCR_INVALID'));
});

/** An injected helper process (no Python): answers each operation from a table. */
function processHelper(answers: Record<string, unknown>, seen: { op: string; input: any }[] = []): AnalyticalHelper {
  const spawnProcess: HelperSpawn = () => {
    const child: any = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const chunks: Buffer[] = [];
    child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
    child.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stdin.on('finish', () => queueMicrotask(() => {
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8')); seen.push({ op: request.operation, input: request.input });
      const response = answers[request.operation];
      child.stdout.write(JSON.stringify(response)); child.emit('close', (response as any)?.ok === false ? 1 : 0);
    }));
    return child;
  };
  return new AnalyticalHelper({ executable: process.execPath, spawnProcess });
}
const runtime = { python: '3.12.0', resourceLimits: true };
const extractAnswer = (blank: number[]) => ({ ok: true, operation: 'pdf.extract', result: { pages: statementPages().map(p => blank.includes(p.page) ? { page: p.page, text: '' } : p), sourceTainted: true }, runtime });

test('without the OCR reader installed: OCR_DEPENDENCY_UNAVAILABLE names the page; the plain path keeps PDF_SCANNED_PAGE', async () => {
  const seen: { op: string; input: any }[] = [];
  const helper = processHelper({ 'pdf.extract': extractAnswer([2]), 'pdf.ocr': { ok: false, operation: 'pdf.ocr', error: { code: 'OCR_DEPENDENCY_UNAVAILABLE' } } }, seen);
  await assert.rejects(extractBankPdfWithOcr(helper, pdfBase64, { minConfidence: 80 }),
    code('OCR_DEPENDENCY_UNAVAILABLE', e => e.page === 2 && /OCR/.test(e.message) && !/\d/.test(e.message)));
  assert.deepEqual(seen.map(s => s.op), ['pdf.extract', 'pdf.ocr']);
  assert.deepEqual(seen[1].input, { pdfBase64, maxPages: 50, language: 'eng' });
  const plain = await extractBankPdf(helper, pdfBase64);
  assert.throws(() => pdfTextToRows(plain.pages), code('PDF_SCANNED_PAGE', e => e.page === 2));
  // Other helper refusals pass through unchanged.
  const failing = processHelper({ 'pdf.extract': extractAnswer([1]), 'pdf.ocr': { ok: false, operation: 'pdf.ocr', error: { code: 'PDF_PAGE_LIMIT' } } });
  await assert.rejects(extractBankPdfWithOcr(failing, pdfBase64, {}), code('PDF_PAGE_LIMIT'));
});

test('helper: pdf.ocr is registered, tainted, and accepts only its own inputs', async () => {
  const seen: { op: string; input: any }[] = [];
  const ocrPages = statementPages().map(p => ({ page: p.page, text: p.text, confidence: 91 }));
  const helper = processHelper({ 'pdf.extract': extractAnswer([1, 2]), 'pdf.ocr': { ok: true, operation: 'pdf.ocr', result: { pages: ocrPages, sourceTainted: true, numericalStatus: 'unverified', requiresReview: true }, runtime } }, seen);
  const direct = await helper.run('pdf.ocr', { pdfBase64, maxPages: 2, language: 'eng' });
  assert.equal(direct.receipt.operation, 'pdf.ocr'); assert.equal(direct.receipt.sourceTainted, true); assert.equal(direct.receipt.engine, 'injected-process');
  await assert.rejects(helper.run('pdf.ocr', { pdfBase64, path: '/etc/passwd' }), code('INVALID_HELPER_INPUT'));
  await assert.rejects(helper.run('pdf.ocr', { pdfBase64, tesseractArgs: ['--oem', '0'] }), code('INVALID_HELPER_INPUT'));
  await assert.rejects(helper.run('pdf.extract', { pdfBase64, language: 'eng' }), code('INVALID_HELPER_INPUT'), 'pdf.extract keeps its own inputs');
  const read = await extractBankPdfWithOcr(helper, pdfBase64, { minConfidence: 90 });
  assert.deepEqual(read.ocrPages, [1, 2]);
  assert.equal((read.receipts.ocr as any).sourceTainted, true);
  assert.equal(runRegistered('bank.pdf-text', { rows: pdfTextToRows(read.pages).rows }).observed.total, '1750000');
});

// ---------------------------------------------------------------- the real OCR reader, where installed

const python = process.env.CHAUSAR_PYTHON ?? (existsSync('/usr/bin/python3') ? realpathSync('/usr/bin/python3') : '');
const PROBE = 'import os, shutil, subprocess, pypdfium2, PIL, pdfplumber\nt = shutil.which("tesseract", path=os.defpath)\nassert t\nassert "eng" in subprocess.run([t, "--list-langs"], capture_output=True, text=True).stdout.split()';
const probe = python ? spawnSync(python, ['-I', '-c', PROBE], { encoding: 'utf8', timeout: 20_000 }) : null;
const ocrSkip = !python ? 'no Python found (set CHAUSAR_PYTHON)' : probe?.status !== 0 ? 'OCR reader not installed: needs tesseract-ocr with eng, and pypdfium2, Pillow and pdfplumber for the configured Python' : false;

/** Renders page texts into images with Pillow and wraps them as an image-only PDF (no text layer). */
const RENDER = `
import base64, io, json, sys
from PIL import Image, ImageDraw, ImageFont
pages = json.loads(sys.stdin.read())
try:
    font = ImageFont.truetype("DejaVuSans.ttf", 30)
except OSError:
    font = ImageFont.load_default(size=30)
images = []
for text in pages:
    image = Image.new("L", (2480, 3508), 255)
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(text.split("\\n")):
        draw.text((120, 150 + index * 60), line, font=font, fill=0)
    images.append(image.convert("RGB"))
out = io.BytesIO()
images[0].save(out, "PDF", save_all=True, append_images=images[1:], resolution=300)
sys.stdout.write(base64.b64encode(out.getvalue()).decode())
`;

test('real OCR: a synthetic image-only statement PDF is read by tesseract and passes the running-balance check', { skip: ocrSkip, timeout: 60_000 }, async () => {
  const rendered = spawnSync(python, ['-I', '-c', RENDER], { input: JSON.stringify(statementPages().map(p => p.text)), encoding: 'utf8', timeout: 30_000 });
  assert.equal(rendered.status, 0, rendered.stderr);
  const scannedPdf = rendered.stdout.trim();
  const helper = new AnalyticalHelper({ executable: python, timeoutMs: 30_000 });
  const extracted = await helper.run('pdf.extract', { pdfBase64: scannedPdf, maxPages: 50 });
  assert.ok(extracted.result.pages.every((p: any) => p.text.trim() === ''), 'the PDF has no text layer');
  assert.throws(() => pdfTextToRows(extracted.result.pages), code('PDF_SCANNED_PAGE', e => e.page === 1));
  const read = await extractBankPdfWithOcr(helper, scannedPdf, { minConfidence: 80 });
  assert.deepEqual(read.ocrPages, [1, 2]);
  assert.ok(read.pages.every(p => p.source === 'ocr' && p.confidence! >= 80));
  const receipt = read.receipts.ocr as any;
  assert.equal(receipt.operation, 'pdf.ocr'); assert.equal(receipt.engine, 'python'); assert.equal(receipt.sourceTainted, true); assert.equal(receipt.resourceLimits, true);
  const { rows, meta } = pdfTextToRows(read.pages);
  assert.deepEqual(meta.ocrPages, [1, 2]);
  assert.equal(meta.transactions, 5);
  const out = runRegistered('bank.pdf-text', { rows });
  assert.equal(out.status, 'accepted', JSON.stringify(out.refusal ?? out.abstention));
  assert.equal(out.observed.total, '1750000');
  assert.equal(out.checks.find(c => c.id === 'closing-balance')?.status, 'passed');
  assert.deepEqual(out.records.map(r => (r.measure as any).amountMinor), ['1200000', '-750000', '-200000', '1800000', '-300000']);
  const direct = await helper.run('pdf.ocr', { pdfBase64: scannedPdf, maxPages: 2, language: 'eng' });
  assert.equal(direct.result.numericalStatus, 'unverified'); assert.equal(direct.result.requiresReview, true); assert.equal(direct.result.sourceTainted, true);
  assert.match(direct.result.coverage, /EXPERIMENTAL/);
  assert.equal(direct.result.engine, 'tesseract');
  await assert.rejects(helper.run('pdf.ocr', { pdfBase64: scannedPdf, maxPages: 1 }), code('PDF_PAGE_LIMIT'));
  await assert.rejects(helper.run('pdf.ocr', { pdfBase64: scannedPdf, language: 'deu' }), code('INVALID_HELPER_INPUT'));
  await assert.rejects(helper.run('pdf.ocr', { pdfBase64: Buffer.from('not a PDF').toString('base64') }), code('INVALID_PDF'));
});
