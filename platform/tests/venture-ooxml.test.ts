// Ink v2 wave 5, package 5A5 (P11): the small zip writer and reader on node:zlib, DOCX and XLSX made by code and read
// back, and the engine's atomic file writer (W4 P12 on the engine side). No new dependency; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzip, zip } from '../runtime/venture/playbooks/kit/ooxml/zip.ts';
import { writeDocx } from '../runtime/venture/playbooks/kit/ooxml/docx.ts';
import { writeXlsx } from '../runtime/venture/playbooks/kit/ooxml/xlsx.ts';
import { readDocx, readXlsx } from '../runtime/venture/playbooks/kit/ooxml/read.ts';
import { writeFilesAtomic } from '../runtime/venture/playbooks/kit/atomic-write.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

test('a zip round-trips, is the same bytes for the same files, and keeps UTF-8 names', () => {
  const files = [{ name: 'a.txt', bytes: Buffer.from('hello hello hello hello') }, { name: 'folder/हिंदी.txt', bytes: Buffer.from('नमस्ते') }, { name: 'empty.txt', bytes: new Uint8Array() }];
  const one = zip(files), two = zip(files);
  assert.deepEqual(Buffer.from(one), Buffer.from(two));
  assert.equal(text(one.subarray(0, 2)), 'PK');
  const back = unzip(one);
  assert.deepEqual(back.map(item => item.name), ['a.txt', 'folder/हिंदी.txt', 'empty.txt']);
  assert.equal(text(back[1].bytes), 'नमस्ते');
  assert.equal(back[2].bytes.length, 0);
});

test('the reader refuses what is not a zip, a damaged entry, an unsafe name and one too large', () => {
  assert.throws(() => unzip(Buffer.from('not a zip at all')), code('OOXML_UNREADABLE'));
  const good = Buffer.from(zip([{ name: 'a.txt', bytes: Buffer.from('abcdefgh'.repeat(20)) }]));
  const broken = Buffer.from(good); broken[40] ^= 0xff;
  assert.throws(() => unzip(broken), code('OOXML_UNREADABLE'));
  assert.throws(() => zip([{ name: '../evil.txt', bytes: Buffer.from('x') }]), code('OOXML_INVALID'));
  // A zip someone else made with a name that climbs out: the same bytes with '__' turned into '..' in both names.
  const climbing = Buffer.from(Buffer.from(zip([{ name: '__/evil.txt', bytes: Buffer.from('x') }])).toString('latin1').replaceAll('__/evil', '../evil'), 'latin1');
  assert.throws(() => unzip(climbing), code('OOXML_UNREADABLE'));
  assert.throws(() => unzip(zip([{ name: 'big.txt', bytes: Buffer.alloc(2_000_000) }]), { maxBytes: 1_000_000 }), code('OOXML_UNREADABLE'));
});

test('writeDocx makes a document read.ts opens back to the same words, escaped and in order', () => {
  const bytes = writeDocx({
    cover: { title: 'September report for Cafe <Aroma> & Co', lines: ['Prepared by Ledger Cafe Books', 'As of 30 Sep 2026'] },
    sections: [
      { heading: 'What we did', paragraphs: ['Closed the books. "All" bills matched.', 'Two lines\nin one paragraph'] },
      { heading: 'हिंदी में', paragraphs: ['ग्राहक के लिए रिपोर्ट', 'Control \u0007 character dropped'] },
    ],
  });
  const raw = text(unzip(bytes).find(item => item.name === 'word/document.xml')!.bytes);
  assert.ok(raw.includes('Cafe &lt;Aroma&gt; &amp; Co'), 'values are XML-escaped');
  assert.equal(raw.includes('\u0007'), false);
  assert.deepEqual(readDocx(bytes).paragraphs, [
    'September report for Cafe <Aroma> & Co', 'Prepared by Ledger Cafe Books', 'As of 30 Sep 2026',
    'What we did', 'Closed the books. "All" bills matched.', 'Two lines\nin one paragraph',
    'हिंदी में', 'ग्राहक के लिए रिपोर्ट', 'Control  character dropped',
  ]);
  assert.deepEqual(Buffer.from(bytes), Buffer.from(writeDocx({ cover: { title: 'September report for Cafe <Aroma> & Co', lines: ['Prepared by Ledger Cafe Books', 'As of 30 Sep 2026'] }, sections: [{ heading: 'What we did', paragraphs: ['Closed the books. "All" bills matched.', 'Two lines\nin one paragraph'] }, { heading: 'हिंदी में', paragraphs: ['ग्राहक के लिए रिपोर्ट', 'Control \u0007 character dropped'] }] })));
});

test('writeXlsx stores formulas-to-be as inline text, money as text with two decimals, and reads back', () => {
  const bytes = writeXlsx({ sheets: [{ name: 'Figures', rows: [
    ['Figure', 'Value'],
    ['=SUM(A1:A9)', { money: '123450' }],
    ['+91 98765 43210', { money: '-5' }],
    ['-2+3', '@cmd', { count: '12' }],
    ['Tom & "Jerry" <b>', { money: '100000000000000000001', digits: 2 }],
  ] }, { name: 'Notes', rows: [['Every figure has a receipt.']] }] });
  const parts = unzip(bytes);
  const sheet = text(parts.find(item => item.name === 'xl/worksheets/sheet1.xml')!.bytes);
  assert.equal(sheet.includes('<f>'), false, 'never a formula');
  assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">=SUM\(A1:A9\)<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="B2" t="inlineStr"><is><t xml:space="preserve">1234\.50<\/t><\/is><\/c>/, 'money is text, two decimals');
  assert.match(sheet, /<c r="C4"><v>12<\/v><\/c>/, 'a count is a whole number');
  assert.ok(sheet.includes('Tom &amp; &quot;Jerry&quot; &lt;b&gt;'));
  const read = readXlsx(bytes);
  assert.deepEqual(read.sheets.map(item => item.name), ['Figures', 'Notes']);
  assert.deepEqual(read.sheets[0].rows, [
    ['Figure', 'Value'], ['=SUM(A1:A9)', '1234.50'], ['+91 98765 43210', '-0.05'], ['-2+3', '@cmd', '12'], ['Tom & "Jerry" <b>', '1000000000000000000.01'],
  ]);
  assert.deepEqual(read.sheets[1].rows, [['Every figure has a receipt.']]);
});

test('writeXlsx refuses a bad sheet name, two sheets with one name, a money cell that is not whole minor units, and a fractional count', () => {
  assert.throws(() => writeXlsx({ sheets: [{ name: 'a/b', rows: [] }] }), code('OOXML_INVALID'));
  assert.throws(() => writeXlsx({ sheets: [{ name: 'x'.repeat(32), rows: [] }] }), code('OOXML_INVALID'));
  assert.throws(() => writeXlsx({ sheets: [{ name: 'One', rows: [] }, { name: 'one', rows: [] }] }), code('OOXML_INVALID'));
  assert.throws(() => writeXlsx({ sheets: [{ name: 'One', rows: [[{ money: '12.5' }]] }] }), code('OOXML_INVALID'));
  assert.throws(() => writeXlsx({ sheets: [{ name: 'One', rows: [[{ count: '1.5' }]] }] }), code('OOXML_INVALID'));
});

test("read.ts reads an issuer's workbook: shared strings, numbers, booleans and a formula's kept value", () => {
  const xml = (body: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const bytes = zip([
    { name: '[Content_Types].xml', bytes: xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: 'xl/workbook.xml', bytes: xml(`<workbook ${ns}><sheets><sheet name="RFP &amp; Q" sheetId="7" r:id="rId3"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="x" Target="/xl/worksheets/data.xml"/></Relationships>') },
    { name: 'xl/sharedStrings.xml', bytes: xml(`<sst ${ns}><si><t>Question</t></si><si><r><t>Rich </t></r><r><t>text</t></r></si></sst>`) },
    { name: 'xl/worksheets/data.xml', bytes: xml(`<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3"><v>42.5</v></c><c r="B3" t="b"><v>1</v></c><c r="D3"><f>A3*2</f><v>85</v></c><c r="E3" t="str"><f>"a"&amp;"b"</f><v>ab</v></c></row></sheetData></worksheet>`) },
  ]);
  const read = readXlsx(bytes);
  assert.deepEqual(read.sheets, [{ name: 'RFP & Q', rows: [['Question', '', 'Rich text'], [], ['42.5', 'TRUE', '', '85', 'ab']] }]);
});

test('writeFilesAtomic writes every file or none, never replaces unless asked, and refuses a path for a name', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-atomic-'));
  try {
    await writeFilesAtomic(folder, [{ name: 'a.docx', bytes: Buffer.from('one') }, { name: 'b.xlsx', bytes: Buffer.from('two') }]);
    assert.deepEqual((await readdir(folder)).sort(), ['a.docx', 'b.xlsx']);
    assert.equal(await readFile(join(folder, 'a.docx'), 'utf8'), 'one');
    await assert.rejects(writeFilesAtomic(folder, [{ name: 'c.txt', bytes: Buffer.from('3') }, { name: 'a.docx', bytes: Buffer.from('new') }]), code('EXPORT_EXISTS'));
    assert.deepEqual((await readdir(folder)).sort(), ['a.docx', 'b.xlsx'], 'the refused write left nothing behind');
    assert.equal(await readFile(join(folder, 'a.docx'), 'utf8'), 'one');
    await writeFilesAtomic(folder, [{ name: 'a.docx', bytes: Buffer.from('new') }], { replace: true });
    assert.equal(await readFile(join(folder, 'a.docx'), 'utf8'), 'new');
    await assert.rejects(writeFilesAtomic(folder, [{ name: '../x.txt', bytes: Buffer.from('x') }]), code('EXPORT_NOT_SAVED'));
    await assert.rejects(writeFilesAtomic(folder, [{ name: 'sub\\x.txt', bytes: Buffer.from('x') }]), code('EXPORT_NOT_SAVED'));
    // A rename that fails part way takes away what it staged and what it reserved: neither new file stays.
    let renames = 0;
    const failing = { ...fsp, rename: async (from: string, to: string) => { renames += 1; if (renames === 2) throw Object.assign(new Error('disk gone'), { code: 'ENOSPC' }); return fsp.rename(from, to); } };
    await assert.rejects(writeFilesAtomic(folder, [{ name: 'd.txt', bytes: Buffer.from('d') }, { name: 'e.txt', bytes: Buffer.from('e') }], { fs: failing as typeof fsp }),
      (error: any) => error.code === 'EXPORT_NOT_SAVED' && /not enough space/.test(error.message) && !error.message.includes(folder));
    assert.deepEqual((await readdir(folder)).sort(), ['a.docx', 'b.xlsx']);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('a small workbook with far-off cells is refused before it fills memory', () => {
  const xml = (body: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const book = (sheet: string) => zip([
    { name: 'xl/workbook.xml', bytes: xml(`<workbook ${ns}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', bytes: xml(`<worksheet ${ns}><sheetData>${sheet}</sheetData></worksheet>`) },
  ]);
  assert.throws(() => readXlsx(book('<row r="1048576"><c r="A1048576"><v>1</v></c></row>')), code('OOXML_UNREADABLE'), 'a row far down');
  assert.throws(() => readXlsx(book('<row r="1"><c r="XFD1"><v>1</v></c></row>')), code('OOXML_UNREADABLE'), 'a column far right');
  const many = Array.from({ length: 300 }, (_, row) => `<row r="${row + 1}"><c r="ALL${row + 1}"><v>1</v></c></row>`).join('');
  assert.throws(() => readXlsx(book(many)), code('OOXML_UNREADABLE'), 'rows times columns over the cap');
  assert.deepEqual(readXlsx(book('<row r="3"><c r="C3"><v>7</v></c></row>')).sheets[0].rows, [[], [], ['', '', '7']]);
});

test('an xlsx cell over Excel\'s 32,767 characters is refused, and the workbook carries the Normal cell style', () => {
  assert.throws(() => writeXlsx({ sheets: [{ name: 'One', rows: [['x'.repeat(32_768)]] }] }), code('OOXML_INVALID'));
  const ok = writeXlsx({ sheets: [{ name: 'One', rows: [['x'.repeat(32_767)]] }] });
  const styles = text(unzip(ok).find(item => item.name === 'xl/styles.xml')!.bytes);
  assert.match(styles, /<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"\/><\/cellStyles>/);
});

test('a replace that fails part way puts the old files back', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-atomic-replace-'));
  try {
    await writeFilesAtomic(folder, [{ name: 'a.txt', bytes: Buffer.from('old a') }, { name: 'b.txt', bytes: Buffer.from('old b') }]);
    let renames = 0;
    // Renames: a aside, a in place, b aside, then b in place fails.
    const failing = { ...fsp, rename: async (from: string, to: string) => { renames += 1; if (renames === 4) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return fsp.rename(from, to); } };
    await assert.rejects(writeFilesAtomic(folder, [{ name: 'a.txt', bytes: Buffer.from('new a') }, { name: 'b.txt', bytes: Buffer.from('new b') }], { replace: true, fs: failing as typeof fsp }), code('EXPORT_NOT_SAVED'));
    assert.deepEqual((await readdir(folder)).sort(), ['a.txt', 'b.txt']);
    assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'old a');
    assert.equal(await readFile(join(folder, 'b.txt'), 'utf8'), 'old b');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
