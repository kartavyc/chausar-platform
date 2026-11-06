// One-shot A4 (hands-on row 9): a resume PDF is read on this computer by code, so About you works where the Python
// helper is not installed (every beta). Text only: no OCR, no images, no forms; an encrypted file is refused plainly.
// Every PDF here is built at run time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { pdfText } from '../runtime/venture/core/pdf-text.ts';

/** A PDF from object bodies (1-based numbers), with a cross-reference table, as a writer would lay it out. */
function pdf(objects: (string | Buffer)[], trailer = '/Root 1 0 R'): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let at = parts[0]!.length;
  objects.forEach((body, index) => {
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), typeof body === 'string' ? Buffer.from(body, 'latin1') : body, Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push(at); parts.push(chunk); at += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}
const stream = (dict: string, data: Buffer) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
const flate = (text: string) => stream('/Filter /FlateDecode', deflateSync(Buffer.from(text, 'latin1')));

test('a plain PDF: its words, line by line, in page order', () => {
  const file = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    stream('', Buffer.from('BT /F1 12 Tf 72 720 Td (Asha Testwala) Tj 0 -16 Td (Freelance photographer, Pune) Tj ET', 'latin1')),
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    stream('', Buffer.from('BT /F1 12 Tf 72 720 Td (Birthday parties \\(kids\\) and shop products) Tj T* (Five years) Tj ET', 'latin1')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
  assert.equal(pdfText(file), 'Asha Testwala\nFreelance photographer, Pune\nBirthday parties (kids) and shop products\nFive years');
});

test('a compressed PDF with a ToUnicode map, TJ spacing and two-byte codes, as Word and Google Docs write them', () => {
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '2 beginbfchar <0001> <0050> <0002> <0068> endbfchar',
    '1 beginbfrange <0003> <0005> <006F> endbfrange',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  // <0001>=P <0002>=h <0003>=o <0004>=p <0005>=q ... "Photo" then a wide gap, then "hop".
  const content = 'BT /F2 11 Tf 1 0 0 1 72 700 Tm [<00010002>-20<0003>10<0004>] TJ [(x)] TJ ET';
  const file = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources 6 0 R /Contents [4 0 R 5 0 R] >>',
    flate(content),
    flate('BT /F2 11 Tf 1 0 0 1 72 680 Tm [<0002>-600<00030004>] TJ ET'),
    '<< /Font << /F2 7 0 R >> >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Calibri /Encoding /Identity-H /ToUnicode 8 0 R >>',
    flate(cmap),
  ]);
  assert.equal(pdfText(file), 'Phop\nh op');
});

test('objects kept inside an object stream are found too', () => {
  // Objects 5 (the page tree) and 6 (the page) live only inside the object stream, object 4.
  const inner = ['<< /Type /Pages /Kids [6 0 R] /Count 1 >>', '<< /Type /Page /Parent 5 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 2 0 R >>'];
  const header = `5 0 6 ${inner[0]!.length + 1} `;
  const body = `${header}${inner[0]} ${inner[1]}`;
  const objstm = stream(`/Type /ObjStm /N 2 /First ${header.length} /Filter /FlateDecode`, deflateSync(Buffer.from(body, 'latin1')));
  const file = pdf([
    '<< /Type /Catalog /Pages 5 0 R >>',
    flate('BT /F1 10 Tf 50 750 Td (Wedding and product shoots) Tj ET'),
    '<< /Type /Font /Subtype /TrueType /BaseFont /Arial >>',
    objstm,
  ]);
  assert.equal(pdfText(file), 'Wedding and product shoots');
});

test('an encrypted PDF is refused in plain words; a PDF with no text gives no text; at most the pages asked for', () => {
  const page = (n: number) => `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents ${n} 0 R >>`;
  const encrypted = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>', '<< /Filter /Standard /V 2 >>'], '/Root 1 0 R /Encrypt 3 0 R');
  assert.throws(() => pdfText(encrypted), (error: { code?: string; message?: string }) => error.code === 'PDF_ENCRYPTED' && /password/i.test(error.message ?? ''));
  const scanned = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>', stream('', Buffer.from('q 595 0 0 842 0 0 cm /Im1 Do Q', 'latin1'))]);
  assert.equal(pdfText(scanned), '');
  const many = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    page(5), stream('', Buffer.from('BT /F1 9 Tf (One) Tj ET', 'latin1')), page(7), stream('', Buffer.from('BT /F1 9 Tf (Two) Tj ET', 'latin1')), page(9), stream('', Buffer.from('BT /F1 9 Tf (Three) Tj ET', 'latin1')),
  ]);
  assert.equal(pdfText(many, { maxPages: 2 }), 'One\nTwo');
  assert.equal(pdfText(many, { maxChars: 5 }), 'One\nT');
  assert.throws(() => pdfText(new Uint8Array(Buffer.from('not a pdf'))), (error: { code?: string }) => error.code === 'PDF_UNREADABLE');
});

// A4 review (M3, L1, L2): one work budget per read, so no PDF can hold the engine: inflated bytes, map entries and
// objects are counted, a range is never walked code by code, and object streams are opened only when needed.
const cmapPdf = (cmap: string) => pdf([
  '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >>', stream('', Buffer.from('BT /F1 12 Tf <00030004> Tj ET', 'latin1')),
  stream('', Buffer.from(cmap, 'latin1')),
]);
const timed = <T>(work: () => T): { ms: number; value: T | Error } => { const at = Date.now(); let value: T | Error; try { value = work(); } catch (error) { value = error as Error; } return { ms: Date.now() - at, value }; };

test('A4 review: a thousand full-width ranges read in well under a second', () => {
  let cmap = 'begincodespacerange <0000> <FFFF> endcodespacerange 1000 beginbfrange ';
  for (let index = 0; index < 1000; index += 1) cmap += '<0000> <FFFF> <0041> ';
  const { ms, value } = timed(() => pdfText(cmapPdf(`${cmap}endbfrange`)));
  assert.ok(ms < 1000, `${ms} ms`);
  assert.equal(value, 'DE');
});

test('A4 review: object streams that inflate to 31 MB each are refused as too complex, in well under a second', () => {
  const plain = Buffer.alloc(31 * 1024 * 1024, 0x20); Buffer.from('100 0 ').copy(plain, 0);
  const packed = deflateSync(plain, { level: 9 });
  const objects: (string | Buffer)[] = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'];
  for (let index = 0; index < 32; index += 1) objects.push(stream('/Type /ObjStm /N 1 /First 6 /Filter /FlateDecode', packed));
  const { ms, value } = timed(() => pdfText(pdf(objects)));
  assert.ok(ms < 1000, `${ms} ms`);
  assert.ok(value instanceof Error && (value as Error & { code?: string }).code === 'PDF_TOO_COMPLEX', String(value));
  assert.equal((value as Error).message, 'This PDF is too complex to read. Paste the text instead.');
});

test('A4 review: a range to a surrogate pair or a ligature reads; /Encrypt<< with no space is refused', () => {
  const base = 'begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange ';
  assert.equal(pdfText(cmapPdf(`${base}<0003> <0004> <D83DDCF7> endbfrange`)), '\u{1F4F7}\u{1F4F8}');
  assert.equal(pdfText(cmapPdf(`${base}<0003> <0004> <00660069> endbfrange`)), 'fifj');
  const locked = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'], '/Root 1 0 R /Encrypt<</Filter/Standard/V 1>>');
  assert.throws(() => pdfText(locked), (error: { code?: string }) => error.code === 'PDF_ENCRYPTED');
});

// A4 review round 2 (M1): the parsed content counts toward the budget each time a page names it, a page stops once it
// holds maxChars, and a code finds its range by a search over the ranges, the first listed still winning.
test('A4 review round 2: a page naming one big content stream hundreds of times is refused in well under a second', () => {
  const content = flate(`BT /F1 12 Tf ${'(A) Tj '.repeat(100_000)}ET`);
  for (const count of [300, 2000]) {
    const refs = Array(count).fill('4 0 R').join(' ');
    const file = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R /Contents [${refs}] >>`, content]);
    const { ms, value } = timed(() => pdfText(file));
    assert.ok(ms < 1000, `${count} refs: ${ms} ms`);
    assert.ok(value instanceof Error && (value as Error & { code?: string }).code === 'PDF_TOO_COMPLEX', String(value));
  }
  const twice = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Contents [4 0 R 4 0 R] >>', flate('BT (Hello) Tj ET')]);
  assert.equal(pdfText(twice), 'Hello\nHello');
});

test('A4 review round 2: a page stops reading once it holds maxChars', () => {
  const file = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>', flate(`BT ${'(A) Tj '.repeat(1_000_000)}ET`)]);
  const { ms, value } = timed(() => pdfText(file));
  assert.ok(ms < 1000, `${ms} ms`);
  assert.equal(value, 'A'.repeat(20_000));
});

test('A4 review round 2: 40,000 ranges and 200,000 codes read in well under a second; the first range listed wins', () => {
  let cmap = 'begincodespacerange <0000> <FFFF> endcodespacerange beginbfrange ';
  for (let index = 0; index < 40_000; index += 1) cmap += '<FFFF> <FFFF> <0041> ';
  const file = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >>', flate(`BT /F1 12 Tf <${'0003'.repeat(200_000)}> Tj ET`), flate(`${cmap}endbfrange`),
  ]);
  const { ms, value } = timed(() => pdfText(file));
  assert.ok(ms < 1000, `${ms} ms`);
  assert.equal(value, '');
  const base = 'begincodespacerange <0000> <FFFF> endcodespacerange beginbfrange ';
  assert.equal(pdfText(cmapPdf(`${base}<0000> <FFFF> <0041> <0003> <0003> <0058> endbfrange`)), 'DE', 'the wide range listed first wins');
  assert.equal(pdfText(cmapPdf(`${base}<0003> <0003> <0058> <0000> <FFFF> <0041> endbfrange`)), 'XE', 'the narrow range listed first wins');
  assert.equal(pdfText(cmapPdf(`${base}<0002> <0004> [<0061> <0062> <0063>] <0004> <0009> <0070> endbfrange`)), 'bc', 'a list range, then the next');
  assert.equal(pdfText(cmapPdf(`${base}<03> <04> <0041> <0000> <0003> <0070> endbfrange`)), 's', 'a range of another width never holds a code');
});
