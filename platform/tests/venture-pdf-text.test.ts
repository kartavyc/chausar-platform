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
