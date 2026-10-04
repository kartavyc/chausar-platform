import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { hashData, SemanticError, sha256Bytes, type DatasetManifest } from '../src/index.ts';
import { PREPARATION_LIMITS, type LocalArtifactPreparationHost, type LocalArtifactPreparationRequest } from '../src/local-artifact-preparation/contracts.ts';
import { prepareLocalArtifact, preparationEvidenceBinding, privacyReviewSubject, rightsReviewSubject } from '../src/local-artifact-preparation/preparation.ts';
import { createWorkbookInspector, createWorkbookMinimizer, proposeWorkbookMinimization, workbookMemberEvidencePath, workbookMemberName } from '../src/local-artifact-preparation/workbook-preparation.ts';
import { readWorkbookContainer } from '../src/local-artifact-preparation/workbook-container.ts';

// Every package below is authored in this test. No dataset, spreadsheet application,
// installed ZIP encoder or acquired workbook supplies fixture bytes or expected values.
type Part = { name: string; text: string | Uint8Array; method?: number; flags?: number; declaredLength?: number; localOffset?: number; extra?: Uint8Array; comment?: Uint8Array };
const encoder = new TextEncoder();
const bytes = (value: string | Uint8Array) => typeof value === 'string' ? encoder.encode(value) : value;
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(value: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(parts: Part[]): Uint8Array {
  const locals: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name), content = bytes(part.text), method = part.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(content) : Buffer.from(content);
    const flags = part.flags ?? 0, extra = Buffer.from(part.extra ?? []), comment = Buffer.from(part.comment ?? []);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(content), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(part.declaredLength ?? content.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(content), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(part.declaredLength ?? content.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(extra.length, 30); central.writeUInt16LE(comment.length, 32); central.writeUInt32LE(part.localOffset ?? offset, 42);
    locals.push(local, name, extra, compressed); directory.push(central, name, extra, comment);
    offset += local.length + name.length + extra.length + compressed.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
function singleRecord(part: Part) {
  const archive = Buffer.from(zip([part])), end = Buffer.from(archive.subarray(-22)), directoryOffset = end.readUInt32LE(16);
  return { local: Buffer.from(archive.subarray(0, directoryOffset)), central: Buffer.from(archive.subarray(directoryOffset, -22)), end };
}
function nestedRecordZip() {
  const inner = singleRecord({ name: 'second.xml', text: '<synthetic/>' });
  const outer = singleRecord({ name: 'first.xml', text: inner.local });
  // Both names and every size/CRC are valid. The second local record lies inside
  // the first member's stored payload, rather than aliasing a mismatched header.
  const nestedOffset = 30 + encoder.encode('first.xml').length;
  inner.central.writeUInt32LE(nestedOffset, 42);
  outer.end.writeUInt16LE(2, 8); outer.end.writeUInt16LE(2, 10);
  outer.end.writeUInt32LE(outer.central.length + inner.central.length, 12);
  return { archive: Buffer.concat([outer.local, outer.central, inner.central, outer.end]), outer, inner, nestedOffset };
}
function trailingDeflateZip() {
  const record = singleRecord({ name: 'trailing.xml', text: '<synthetic/>', method: 8 });
  const tail = Buffer.from([0xde, 0xad, 0xbe, 0xef]), local = Buffer.concat([record.local, tail]);
  local.writeUInt32LE(record.local.readUInt32LE(18) + tail.length, 18);
  record.central.writeUInt32LE(local.readUInt32LE(18), 20);
  record.end.writeUInt32LE(local.length, 16);
  // The compressed size includes the tail in both headers; the uncompressed
  // payload and independently authored CRC remain unchanged and correct.
  return Buffer.concat([local, record.central, record.end]);
}
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const xmlText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const inline = (address: string, value: string) => `<c r="${address}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
const numeric = (address: string, value: string, style = '') => `<c r="${address}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
const header = (labels: string[]) => `<row r="1">${labels.map((label, index) => inline(`${String.fromCharCode(65 + index)}1`, label)).join('')}</row>`;
const worksheet = (data: string) => `<worksheet xmlns="${MAIN}"><sheetData>${data}</sheetData></worksheet>`;
type SheetFixture = { name: string; rows: string; state?: 'visible' | 'hidden' | 'veryHidden' };
function packageParts(sheets: SheetFixture[], options: { shared?: string; styles?: string; date1904?: boolean; extraWorkbook?: string; extraRelationships?: string } = {}): Part[] {
  const optional = [
    ...(options.shared === undefined ? [] : [{ name: 'xl/sharedStrings.xml', text: `<sst xmlns="${MAIN}">${options.shared}</sst>`, suffix: 'sharedStrings', content: 'sharedStrings' }]),
    ...(options.styles === undefined ? [] : [{ name: 'xl/styles.xml', text: `<styleSheet xmlns="${MAIN}">${options.styles}</styleSheet>`, suffix: 'styles', content: 'styles' }]),
  ];
  return [
    { name: '[Content_Types].xml', text: `<Types xmlns="${TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${optional.map(part => `<Override PartName="/${part.name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${part.content}+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', text: `<Relationships xmlns="${PACKAGE}"><Relationship Id="root" Type="${OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `<workbook xmlns="${MAIN}" xmlns:r="${OFFICE}">${options.date1904 === undefined ? '' : `<workbookPr date1904="${options.date1904 ? '1' : '0'}"/>`}<sheets>${sheets.map((sheet, i) => `<sheet name="${xmlText(sheet.name)}" sheetId="${i + 1}" r:id="r${i + 1}"${sheet.state ? ` state="${sheet.state}"` : ''}/>`).join('')}</sheets>${options.extraWorkbook ?? ''}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<Relationships xmlns="${PACKAGE}">${sheets.map((_, i) => `<Relationship Id="r${i + 1}" Type="${OFFICE}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}${optional.map(part => `<Relationship Id="${part.suffix}" Type="${OFFICE}/${part.suffix}" Target="${part.suffix}.xml"/>`).join('')}${options.extraRelationships ?? ''}</Relationships>` },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: worksheet(sheet.rows) })),
    ...optional.map(({ name, text }) => ({ name, text })),
  ];
}
const simpleParts = () => packageParts([{ name: 'Authored Synthetic', rows: header(['InvoiceNo', 'Quantity']) + `<row r="2">${inline('A2', 'SYNTHETIC-0001')}${numeric('B2', '-02.000')}</row>` }]);
const inspect = (parts: Part[]) => createWorkbookInspector().inspect(zip(parts), PREPARATION_LIMITS);
function refuse(action: () => unknown, code?: string) {
  assert.throws(action, (error: unknown) => error instanceof SemanticError && (code === undefined || error.code === code));
}
function changePart(parts: Part[], name: string, transform: (value: string) => string) {
  return parts.map(part => part.name === name ? { ...part, text: transform(String(part.text)) } : part);
}

test('actual stored and deflated synthetic OOXML binds original bytes, parser identity and every member', () => {
  const parts = simpleParts(), parser = createWorkbookInspector(), stored = zip(parts), compressed = zip(parts.map(part => ({ ...part, method: 8 })));
  const a = parser.inspect(stored, PREPARATION_LIMITS), b = parser.inspect(compressed, PREPARATION_LIMITS);
  assert.equal(a.mediaType, 'workbook'); assert.equal(a.originalSha256, sha256Bytes(stored)); assert.equal(b.originalSha256, sha256Bytes(compressed));
  assert.notEqual(a.originalSha256, b.originalSha256); assert.equal(a.parserHash, hashData(parser.identity)); assert.equal(b.parserHash, a.parserHash);
  assert.deepEqual(a.parts, parts.map(part => ({ path: workbookMemberEvidencePath(part.name), sha256: sha256Bytes(bytes(part.text)), byteLength: bytes(part.text).length, inspected: true })));
  assert.deepEqual(b.parts, a.parts); assert.deepEqual(b.sheets, a.sheets); assert.deepEqual(b.cells, a.cells);
  assert.deepEqual(a.inspection, { allPartsInspected: true, encrypted: false, activeContent: false, externalLinks: [] });
  assert.deepEqual(a.sheets, [{ id: 'sheet-1', name: 'Authored Synthetic', partPath: workbookMemberEvidencePath('xl/worksheets/sheet1.xml'), visibility: 'visible', columns: [{ id: 'column-1', label: 'InvoiceNo', index: 1, types: ['text'] }, { id: 'column-2', label: 'Quantity', index: 2, types: ['number'] }], dataRows: [2] }]);
  assert.deepEqual(a.cells, [
    { sheetId: 'sheet-1', row: 2, columnId: 'column-1', type: 'text', lexeme: 'SYNTHETIC-0001', displayLexeme: null, numberFormat: null, formula: null, cachedLexeme: null },
    { sheetId: 'sheet-1', row: 2, columnId: 'column-2', type: 'number', lexeme: '-02.000', displayLexeme: null, numberFormat: null, formula: null, cachedLexeme: null },
  ]);
});

test('package evidence names are canonical and reversible without normalizing original member bytes', () => {
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/worksheets/sheet1.xml']) {
    const path = workbookMemberEvidencePath(name);
    assert.match(path, /^opc\/[0-9a-f]+\.part$/); assert.equal(workbookMemberName(path), name);
  }
  assert.notEqual(workbookMemberEvidencePath('xl/A.xml'), workbookMemberEvidencePath('xl/a.xml'));
  for (const path of ['opc/ABC.part', 'opc/1.part', 'opc/.part', 'opc/2e2e2f6576696c.part', '../opc/61.part', 'opc/61.part/extra']) refuse(() => workbookMemberName(path));
});

test('hidden and very-hidden sheets are fully inventoried with their literal cells and projection dispositions', () => {
  const observation = inspect(packageParts([
    { name: 'Visible', rows: header(['InvoiceNo']) + `<row r="2">${inline('A2', 'SYNTHETIC-VISIBLE')}</row>` },
    { name: 'Hidden Notes', state: 'hidden', rows: header(['Description', 'ResidualNote']) + `<row r="7">${inline('A7', 'SYNTHETIC PRIVATE DESCRIPTION')}${inline('B7', 'SYNTHETIC RESIDUAL')}</row>` },
    { name: 'Very Hidden', state: 'veryHidden', rows: header(['Country']) + `<row r="2">${inline('A2', 'SYNTHETIC COUNTRY')}</row>` },
  ]));
  assert.deepEqual(observation.sheets.map(sheet => [sheet.name, sheet.visibility, sheet.dataRows]), [['Visible', 'visible', [2]], ['Hidden Notes', 'hidden', [7]], ['Very Hidden', 'very-hidden', [2]]]);
  assert.deepEqual(observation.cells.map(cell => cell.lexeme), ['SYNTHETIC-VISIBLE', 'SYNTHETIC PRIVATE DESCRIPTION', 'SYNTHETIC RESIDUAL', 'SYNTHETIC COUNTRY']);
  const plan = proposeWorkbookMinimization(observation, 'explicit-synthetic-removal', '1'), output = createWorkbookMinimizer().project(observation, plan, PREPARATION_LIMITS);
  assert.deepEqual(plan.sheets, [{ sheetId: 'sheet-1', retainColumns: ['column-1'], removeColumns: [] }, { sheetId: 'sheet-2', retainColumns: ['column-2'], removeColumns: ['column-1'] }, { sheetId: 'sheet-3', retainColumns: [], removeColumns: ['column-1'] }]);
  assert.deepEqual(output.cells.map(cell => cell.lexeme), ['SYNTHETIC-VISIBLE', 'SYNTHETIC RESIDUAL']);
  assert.deepEqual(output.sheets.map(sheet => [sheet.id, sheet.visibility, sheet.columns.map(column => column.index)]), [['sheet-1', 'visible', [1]], ['sheet-2', 'hidden', [1]]]);
  assert.equal(output.cellReceipts.length, 4); assert.equal(output.cellReceipts[3].disposition, 'removed');
});

function mixedParts() {
  return packageParts([{ name: 'Synthetic Retail Syntax', rows: header(['InvoiceNo', 'Quantity', 'InvoiceDate', 'UnitPrice', ' CustomerID ', 'COUNTRY', 'description', 'Flag', 'ISODate', 'Spare']) +
    `<row r="2">${inline('A2', 'C-SYNTHETIC-0001')}${numeric('B2', '-90071992547409931234567890.000')}${numeric('C2', '40491.375', '1')}${numeric('D2', '001.2300')}${inline('E2', 'SYNTHETIC-CUSTOMER-1')}<c r="F2" t="s"><v>0</v></c>${inline('G2', 'SYNTHETIC PRIVATE DESCRIPTION')}<c r="H2" t="b"><v>1</v></c><c r="I2" t="d"><v>2010-12-01T08:26:00</v></c></row>` +
    `<row r="3"><c r="A3" t="s"><v>1</v></c>${numeric('B3', '-02.000')}${numeric('C3', '60.0000', '2')}${numeric('D3', '1E-03')}<c r="E3"/>${inline('F3', 'SYNTHETIC-COUNTRY')}<c r="H3" t="b"><v>0</v></c><c r="I3" t="d"><v>2020-02-29T00:00:00.000Z</v></c>${inline('J3', 'true')}</row>` }], {
    shared: '<si><t>SYNTHETIC-COUNTRY</t></si><si><t>000002</t></si>',
    styles: '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>', date1904: false,
  });
}

test('mixed literal cells preserve exact numbers, date serials, ISO dates, booleans and missing blanks', () => {
  const observation = inspect(mixedParts());
  assert.deepEqual(observation.cells.map(cell => [cell.row, cell.columnId, cell.type, cell.lexeme]), [
    [2, 'column-1', 'text', 'C-SYNTHETIC-0001'], [2, 'column-2', 'number', '-90071992547409931234567890.000'], [2, 'column-3', 'number', '40491.375'], [2, 'column-4', 'number', '001.2300'], [2, 'column-5', 'text', 'SYNTHETIC-CUSTOMER-1'], [2, 'column-6', 'text', 'SYNTHETIC-COUNTRY'], [2, 'column-7', 'text', 'SYNTHETIC PRIVATE DESCRIPTION'], [2, 'column-8', 'boolean', '1'], [2, 'column-9', 'date', '2010-12-01T08:26:00'], [2, 'column-10', 'blank', ''],
    [3, 'column-1', 'text', '000002'], [3, 'column-2', 'number', '-02.000'], [3, 'column-3', 'number', '60.0000'], [3, 'column-4', 'number', '1E-03'], [3, 'column-5', 'blank', ''], [3, 'column-6', 'text', 'SYNTHETIC-COUNTRY'], [3, 'column-7', 'blank', ''], [3, 'column-8', 'boolean', '0'], [3, 'column-9', 'date', '2020-02-29T00:00:00.000Z'], [3, 'column-10', 'text', 'true'],
  ]);
  assert.ok(observation.cells[2].numberFormat); assert.equal(observation.cells[12].numberFormat, 'yyyy-mm-dd hh:mm');
  for (const cell of observation.cells) { assert.equal(cell.displayLexeme, null); assert.equal(cell.formula, null); assert.equal(cell.cachedLexeme, null); }
  const plan = proposeWorkbookMinimization(observation, 'synthetic-column-minimization', '1'), minimizer = createWorkbookMinimizer(), output = minimizer.project(observation, plan, PREPARATION_LIMITS);
  assert.deepEqual(plan.sheets, [{ sheetId: 'sheet-1', retainColumns: ['column-1', 'column-2', 'column-3', 'column-4', 'column-8', 'column-9', 'column-10'], removeColumns: ['column-5', 'column-6', 'column-7'] }]);
  assert.equal(output.observationHash, hashData(observation)); assert.equal(output.projectionHash, hashData(plan)); assert.equal(hashData(plan.minimizer), hashData(minimizer.identity));
  assert.deepEqual(output.sheets[0].columns.map(column => [column.id, column.index]), [['column-1', 1], ['column-2', 2], ['column-3', 3], ['column-4', 4], ['column-8', 5], ['column-9', 6], ['column-10', 7]]);
  assert.deepEqual(output.cells.map(cell => [cell.row, cell.columnId, cell.type, cell.lexeme]), [
    [2, 'column-1', 'text', 'C-SYNTHETIC-0001'], [2, 'column-2', 'number', '-90071992547409931234567890.000'], [2, 'column-3', 'number', '40491.375'], [2, 'column-4', 'number', '001.2300'], [2, 'column-8', 'boolean', '1'], [2, 'column-9', 'date', '2010-12-01T08:26:00'], [2, 'column-10', 'blank', ''],
    [3, 'column-1', 'text', '000002'], [3, 'column-2', 'number', '-02.000'], [3, 'column-3', 'number', '60.0000'], [3, 'column-4', 'number', '1E-03'], [3, 'column-8', 'boolean', '0'], [3, 'column-9', 'date', '2020-02-29T00:00:00.000Z'], [3, 'column-10', 'text', 'true'],
  ]);
  assert.deepEqual(output.cellReceipts.map(receipt => [receipt.row, receipt.sourceColumnIndex, receipt.disposition, receipt.outputColumnIndex]), [
    [2, 1, 'retained', 1], [2, 2, 'retained', 2], [2, 3, 'retained', 3], [2, 4, 'retained', 4], [2, 5, 'removed', null], [2, 6, 'removed', null], [2, 7, 'removed', null], [2, 8, 'retained', 5], [2, 9, 'retained', 6], [2, 10, 'retained', 7],
    [3, 1, 'retained', 1], [3, 2, 'retained', 2], [3, 3, 'retained', 3], [3, 4, 'retained', 4], [3, 5, 'removed', null], [3, 6, 'removed', null], [3, 7, 'removed', null], [3, 8, 'retained', 5], [3, 9, 'retained', 6], [3, 10, 'retained', 7],
  ]);
  output.cellReceipts.forEach((receipt, index) => { assert.equal(receipt.sourceCellHash, hashData(observation.cells[index])); assert.equal(receipt.partPath, workbookMemberEvidencePath('xl/worksheets/sheet1.xml')); });
  assert.ok(output.limitations.length); assert.ok(observation.limitations.every(item => output.limitations.includes(item)));
});

test('header-only sheets remain represented without invented data or types', () => {
  const observation = inspect(packageParts([{ name: 'Synthetic Header Only', rows: header(['InvoiceNo', 'Country']) }]));
  assert.deepEqual(observation.sheets[0].dataRows, []); assert.deepEqual(observation.sheets[0].columns.map(column => column.types), [[], []]); assert.deepEqual(observation.cells, []);
  const output = createWorkbookMinimizer().project(observation, proposeWorkbookMinimization(observation, 'header-only-removal', '1'), PREPARATION_LIMITS);
  assert.equal(output.sheets.length, 1); assert.equal(output.sheets[0].columns[0].label, 'InvoiceNo'); assert.deepEqual(output.cells, []); assert.deepEqual(output.cellReceipts, []);
});

test('formulas refuse in visible, hidden, header and removed columns even with cached values', async t => {
  for (const [name, state, rows] of [
    ['visible formula', 'visible', header(['Amount']) + '<row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row>'],
    ['hidden formula', 'hidden', header(['Amount']) + '<row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row>'],
    ['header formula', 'visible', '<row r="1"><c r="A1" t="str"><f>"Description"</f><v>Description</v></c></row>'],
    ['removed formula', 'visible', header(['Description']) + '<row r="2"><c r="A2"><f>WEBSERVICE("https://invalid.example/")</f><v>cached-sensitive-value</v></c></row>'],
    ['formula without cache', 'veryHidden', header(['Country']) + '<row r="2"><c r="A2"><f>SUM(1,2)</f></c></row>'],
  ] as const) await t.test(name, () => refuse(() => inspect(packageParts([{ name, state, rows }]))));
});

test('external relationships and linked workbook declarations refuse without fetching targets', async t => {
  await t.test('external workbook relationship', () => refuse(() => inspect(packageParts([{ name: 'Synthetic', rows: header(['InvoiceNo']) }], { extraRelationships: `<Relationship Id="external" Type="${OFFICE}/externalLink" Target="https://invalid.example/never-fetch.xlsx" TargetMode="External"/>` }))));
  await t.test('external references declaration', () => refuse(() => inspect(packageParts([{ name: 'Synthetic', rows: header(['InvoiceNo']) }], { extraWorkbook: '<externalReferences><externalReference r:id="external"/></externalReferences>' }))));
  await t.test('external worksheet relationship', () => refuse(() => inspect(changePart(simpleParts(), 'xl/_rels/workbook.xml.rels', text => text.replace('Target="worksheets/sheet1.xml"', 'Target="https://invalid.example/never-fetch.xml" TargetMode="External"')))));
});

test('unsupported or ambiguous OOXML forms refuse rather than inventing values', async t => {
  const cases: Array<[string, Part[]]> = [
    ['error cell', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2" t="e"><v>#DIV/0!</v></c></row>' }])],
    ['cached string cell', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2" t="str"><v>cached</v></c></row>' }])],
    ['duplicate header', packageParts([{ name: 'Synthetic', rows: header(['Amount', 'amount']) }])],
    ['blank header', packageParts([{ name: 'Synthetic', rows: header(['Amount', ' ']) }])],
    ['header gap', packageParts([{ name: 'Synthetic', rows: `<row r="1">${inline('A1', 'Amount')}${inline('C1', 'Country')}</row>` }])],
    ['numeric header', packageParts([{ name: 'Synthetic', rows: `<row r="1">${numeric('A1', '12')}</row>` }])],
    ['duplicate cell', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + `<row r="2">${numeric('A2', '1')}${numeric('A2', '2')}</row>` }])],
    ['cell row mismatch', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + `<row r="2">${numeric('A3', '1')}</row>` }])],
    ['unordered rows', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + `<row r="3">${numeric('A3', '1')}</row><row r="2">${numeric('A2', '2')}</row>` }])],
    ['undeclared column', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + `<row r="2">${numeric('B2', '1')}</row>` }])],
    ['rich inline text', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2" t="inlineStr"><is><r><t>rich</t></r></is></c></row>' }])],
    ['shared string missing', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2" t="s"><v>0</v></c></row>' }])],
    ['shared string index outside table', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2" t="s"><v>1</v></c></row>' }], { shared: '<si><t>zero</t></si>' })],
    ['invalid numeric lexeme', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + `<row r="2">${numeric('A2', 'NaN')}</row>` }])],
    ['invalid boolean lexeme', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2" t="b"><v>true</v></c></row>' }])],
    ['invalid calendar date', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2" t="d"><v>2020-02-30</v></c></row>' }])],
    ['entity-encoded numeric lexeme', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2"><v>&#49;2.00</v></c></row>' }])],
    ['entity-encoded date lexeme', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2" t="d"><v>&#50;020-02-29</v></c></row>' }])],
    ['entity-encoded shared index', packageParts([{ name: 'Synthetic', rows: header(['Amount']) + '<row r="2"><c r="A2" t="s"><v>&#48;</v></c></row>' }], { shared: '<si><t>zero</t></si>' })],
    ['inconsistent dimension', changePart(simpleParts(), 'xl/worksheets/sheet1.xml', text => text.replace('<sheetData>', '<dimension ref="A1:C2"/><sheetData>'))],
    ['relationship namespace spoof', changePart(simpleParts(), 'xl/workbook.xml', text => text.replace(`xmlns:r="${OFFICE}"`, 'xmlns:r="urn:synthetic-hostile"'))],
    ['nested main namespace spoof', changePart(simpleParts(), 'xl/worksheets/sheet1.xml', text => text.replace('<row r="2">', '<row r="2" xmlns="urn:synthetic-hostile">'))],
    ['nested same namespace redeclaration', changePart(simpleParts(), 'xl/worksheets/sheet1.xml', text => text.replace('<row r="2">', `<row r="2" xmlns="${MAIN}">`))],
    ['prefixed namespace alias', changePart(simpleParts(), 'xl/workbook.xml', text => text.replace('<workbook ', `<s:workbook xmlns:s="${MAIN}" `).replace('</workbook>', '</s:workbook>'))],
    ['nested relationship prefix redeclaration', changePart(simpleParts(), 'xl/workbook.xml', text => text.replace('<sheets>', '<sheets xmlns:r="urn:synthetic-hostile">'))],
    ['known content override missing MIME', changePart(simpleParts(), '[Content_Types].xml', text => text.replace(' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"', ''))],
    ['unknown content override missing MIME', changePart(simpleParts(), '[Content_Types].xml', text => text.replace('</Types>', '<Override PartName="/unknown.xml"/></Types>'))],
    ['XML default omitted', changePart(simpleParts(), '[Content_Types].xml', text => text.replace('<Default Extension="xml" ContentType="application/xml"/>', ''))],
    ['unsupported worksheet feature', changePart(simpleParts(), 'xl/worksheets/sheet1.xml', text => text.replace('</worksheet>', '<mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>'))],
    ['unexpected embedded member', [...simpleParts(), { name: 'xl/embeddings/unknown.bin', text: 'SYNTHETIC unsupported embedded bytes' }]],
    ['strict OOXML namespace', changePart(simpleParts(), 'xl/workbook.xml', text => text.replace(MAIN, 'http://purl.oclc.org/ooxml/spreadsheetml/main'))],
  ];
  for (const [name, parts] of cases) await t.test(name, () => refuse(() => inspect(parts)));
});

test('ZIP containment refuses traversal, aliases, duplicates, overlaps, encryption and malformed members', async t => {
  for (const name of ['../evil.xml', '/evil.xml', 'C:/evil.xml', 'xl/../evil.xml', 'xl\\evil.xml', 'xl//evil.xml', 'xl/%2e%2e/evil.xml']) await t.test(`path ${name}`, () => refuse(() => inspect([...simpleParts(), { name, text: '<synthetic/>' }])));
  const cases: Array<[string, Part[]]> = [
    ['duplicate name', [...simpleParts(), simpleParts()[0]]],
    ['case duplicate', [...simpleParts(), { name: 'XL/WORKBOOK.XML', text: '<synthetic/>' }]],
    ['central offset aliases wrong local name', simpleParts().map((part, index) => index === 1 ? { ...part, localOffset: 0 } : part)],
    ['encrypted member', simpleParts().map((part, index) => index === 0 ? { ...part, flags: 1 } : part)],
    ['data descriptor', simpleParts().map((part, index) => index === 0 ? { ...part, flags: 8 } : part)],
    ['unsupported compression', simpleParts().map((part, index) => index === 0 ? { ...part, method: 12 } : part)],
    ['extra field', simpleParts().map((part, index) => index === 0 ? { ...part, extra: Uint8Array.from([0, 0, 0, 0]) } : part)],
    ['member comment', simpleParts().map((part, index) => index === 0 ? { ...part, comment: encoder.encode('comment') } : part)],
    ['length mismatch', simpleParts().map((part, index) => index === 0 ? { ...part, declaredLength: bytes(part.text).length + 1 } : part)],
  ];
  for (const [name, parts] of cases) await t.test(name, () => refuse(() => inspect(parts)));
  await t.test('truncated footer', () => { const original = zip(simpleParts()); refuse(() => createWorkbookInspector().inspect(original.slice(0, -1), PREPARATION_LIMITS)); });
  await t.test('tampered payload CRC', () => { const original = Uint8Array.from(zip(simpleParts())); original[30 + encoder.encode('[Content_Types].xml').length + 2] ^= 1; refuse(() => createWorkbookInspector().inspect(original, PREPARATION_LIMITS)); });
  await t.test('trailing bytes', () => refuse(() => createWorkbookInspector().inspect(Buffer.concat([zip(simpleParts()), Buffer.from('extra')]), PREPARATION_LIMITS)));
  await t.test('overlapping valid local-record spans', () => {
    const { archive, outer, inner, nestedOffset } = nestedRecordZip();
    assert.equal(archive.readUInt32LE(nestedOffset), 0x04034b50);
    assert.equal(outer.central.readUInt32LE(42), 0); assert.equal(inner.central.readUInt32LE(42), nestedOffset);
    assert.equal(outer.local.readUInt32LE(14), crc32(inner.local)); assert.equal(outer.central.readUInt32LE(16), crc32(inner.local));
    assert.equal(inner.local.readUInt32LE(14), crc32(encoder.encode('<synthetic/>'))); assert.equal(inner.central.readUInt32LE(16), inner.local.readUInt32LE(14));
    assert.equal(nestedOffset + inner.local.length, outer.local.length);
    assert.throws(() => readWorkbookContainer(archive), (error: unknown) => error instanceof SemanticError && error.code === 'INVALID_ZIP' && error.message === 'Overlapping entries, archive prefixes, unindexed payloads and gaps are refused.');
  });
  await t.test('deflate stream with declared trailing packed bytes', () => {
    assert.throws(() => readWorkbookContainer(trailingDeflateZip()), (error: unknown) => error instanceof SemanticError && error.code === 'INVALID_ZIP' && error.message === 'Deflate streams with trailing packed bytes are refused.');
  });
});

test('original, entry, inflated-byte, XML nesting, entity and grid bounds refuse', async t => {
  await t.test('original over fixed 16 MiB', () => refuse(() => createWorkbookInspector().inspect(new Uint8Array(PREPARATION_LIMITS.originalBytes + 1), PREPARATION_LIMITS), 'XLSX_LIMIT'));
  await t.test('more than 256 entries', () => refuse(() => inspect(Array.from({ length: PREPARATION_LIMITS.parts + 1 }, (_, i) => ({ name: `part${i}.xml`, text: '<synthetic/>' }))), 'WORKBOOK_LIMIT'));
  await t.test('actual deflated payload over 32 MiB', () => { const compressed = zip([{ name: 'oversized.xml', text: new Uint8Array(PREPARATION_LIMITS.expandedBytes + 1).fill(65), method: 8 }]); assert.ok(compressed.length < PREPARATION_LIMITS.originalBytes); refuse(() => createWorkbookInspector().inspect(compressed, PREPARATION_LIMITS), 'WORKBOOK_LIMIT'); });
  await t.test('aggregate inflated bytes over 32 MiB', () => { const content = new Uint8Array(PREPARATION_LIMITS.expandedBytes / 2 + 1).fill(65); refuse(() => inspect([{ name: 'first.xml', text: content, method: 8 }, { name: 'second.xml', text: content, method: 8 }]), 'WORKBOOK_LIMIT'); });
  await t.test('caller cannot raise original-byte limits', () => refuse(() => createWorkbookInspector().inspect(zip(simpleParts()), { ...PREPARATION_LIMITS, originalBytes: PREPARATION_LIMITS.originalBytes + 1 }), 'XLSX_LIMIT'));
  await t.test('dishonest expanded length', () => refuse(() => inspect(simpleParts().map((part, index) => index === 0 ? { ...part, method: 8, declaredLength: 1 } : part))));
  await t.test('XML nesting over 32', () => refuse(() => inspect(changePart(simpleParts(), 'xl/worksheets/sheet1.xml', () => `<worksheet xmlns="${MAIN}">${'<nested>'.repeat(33)}${'</nested>'.repeat(33)}</worksheet>`))));
  await t.test('DTD with declared entity', () => refuse(() => inspect(changePart(simpleParts(), 'xl/workbook.xml', text => `<!DOCTYPE workbook [<!ENTITY synthetic "expanded">]>${text}`))));
  await t.test('external entity declaration', () => refuse(() => inspect(changePart(simpleParts(), 'xl/workbook.xml', text => `<!DOCTYPE workbook SYSTEM "https://invalid.example/never-fetch.dtd">${text}`))));
  await t.test('undeclared entity reference', () => refuse(() => inspect(changePart(simpleParts(), 'xl/worksheets/sheet1.xml', text => text.replace('SYNTHETIC-0001', '&undeclared;')))));
  await t.test('more than 4000 complete cells', () => { const rows = header(['Amount', 'Other', 'Third']) + Array.from({ length: 1334 }, (_, i) => `<row r="${i + 2}">${numeric(`A${i + 2}`, '1')}</row>`).join(''); refuse(() => inspect(packageParts([{ name: 'Synthetic Grid Bound', rows }]).map(part => ({ ...part, method: 8 })))); });
  await t.test('more than 2000 data rows', () => { const rows = header(['Amount']) + Array.from({ length: PREPARATION_LIMITS.rowsPerSheet + 1 }, (_, i) => `<row r="${i + 2}">${numeric(`A${i + 2}`, '1')}</row>`).join(''); refuse(() => inspect(packageParts([{ name: 'Synthetic Row Bound', rows }]).map(part => ({ ...part, method: 8 })))); });
});

test('minimization requires the complete ordered explicit plan and refuses forbidden retention', async t => {
  const observation = inspect(mixedParts()), originalPlan = proposeWorkbookMinimization(observation, 'explicit', '1'), minimizer = createWorkbookMinimizer();
  const changes = [
    (plan: typeof originalPlan) => { plan.sheets = []; },
    (plan: typeof originalPlan) => { plan.sheets[0].retainColumns.reverse(); },
    (plan: typeof originalPlan) => { plan.sheets[0].removeColumns.pop(); },
    (plan: typeof originalPlan) => { plan.sheets[0].retainColumns.push('column-5'); plan.sheets[0].removeColumns.shift(); },
    (plan: typeof originalPlan) => { plan.sheets[0].removeColumns.push('column-1'); },
    (plan: typeof originalPlan) => { plan.minimizer.profileHash = hashData('different profile'); },
  ];
  for (const [index, change] of changes.entries()) await t.test(`invalid plan ${index}`, () => { const plan = structuredClone(originalPlan); change(plan); refuse(() => minimizer.project(observation, plan, PREPARATION_LIMITS)); });
  await t.test('caller cannot raise projection cell limits', () => refuse(() => minimizer.project(observation, originalPlan, { ...PREPARATION_LIMITS, cells: PREPARATION_LIMITS.cells + 1 }), 'XLSX_LIMIT'));
});

// Explicit synthetic fixture reviews model the existing preparation ports. They
// approve only these authored bytes, and establish no real rights or production host.
function preparationFixture() {
  const original = zip(mixedParts()), inspector = createWorkbookInspector(), minimizer = createWorkbookMinimizer();
  const observation = inspector.inspect(original, PREPARATION_LIMITS), projection = proposeWorkbookMinimization(observation, 'synthetic-reviewed-minimization', '1'), projected = minimizer.project(observation, projection, PREPARATION_LIMITS);
  const at = '2026-10-04T03:00:00.000Z', evidenceTime = '2026-10-04T02:00:00.000Z';
  const rightsHash = hashData('authored synthetic rights review'), privacyHash = hashData('authored synthetic all-parts privacy review'), sourceHash = hashData('authored synthetic source identity');
  const manifest: DatasetManifest = {
    contractVersion: 1, id: 'synthetic-xlsx-preparation', title: 'Authored synthetic OOXML fixture', origin: 'synthetic', category: 'synthetic-cases',
    source: { publisher: 'Synthetic fixture author', url: null, retrievedAt: evidenceTime, productVersion: 'authored-1' },
    rights: { status: 'allowed', license: 'Authored fixture only', evidence: 'Explicit fixture reviews; no actual corpus rights', permittedUses: ['qualification'], personalData: 'redacted', permissions: { acquisition: 'allowed', reuse: 'allowed', redistribution: 'unknown', training: 'unknown' } },
    artifacts: [{ path: 'synthetic/original.xlsx', sha256: sha256Bytes(original), role: 'source-rows' }, { path: 'synthetic/rights.json', sha256: rightsHash, role: 'authorization' }, { path: 'synthetic/privacy.json', sha256: privacyHash, role: 'authorization' }, { path: 'synthetic/source.json', sha256: sourceHash, role: 'schema-reference' }],
    limitations: ['Authored synthetic XLSX only; no actual UCI workbook, source admission or vendor qualification.'],
  };
  const custody = { captureId: 'synthetic-xlsx-capture', storageVersion: 'synthetic-immutable-1', attemptId: 'synthetic-xlsx-attempt', path: 'synthetic/original.xlsx', sha256: sha256Bytes(original), byteLength: original.length, capturedAt: evidenceTime, retainedUntil: '2026-10-06T03:00:00.000Z' };
  const request: LocalArtifactPreparationRequest = {
    contractVersion: 1, attemptId: custody.attemptId, at, expiresAt: '2026-10-05T03:00:00.000Z', manifest, custody, parser: structuredClone(inspector.identity), observation: structuredClone(observation), projection: structuredClone(projection), projected: structuredClone(projected),
    rightsReview: { id: 'explicit-synthetic-rights', reviewer: 'Synthetic rights reviewer', at: evidenceTime, evidenceHash: rightsHash, subjectHash: rightsReviewSubject(manifest, custody) },
    privacyReview: { id: 'explicit-synthetic-privacy', reviewer: 'Synthetic privacy reviewer', at: evidenceTime, evidenceHash: privacyHash, subjectHash: privacyReviewSubject(manifest, observation, projection, projected), personalData: 'redacted', allPartsReviewed: true, residualLimitations: ['Synthetic fixture review only.'] },
    sourceIdentity: { sourceId: 'synthetic-source', manifestId: manifest.id, origin: manifest.origin, sourceHash: hashData(manifest.source), families: { business: null, template: null, configuration: null }, evidenceHash: sourceHash },
  };
  const bindingHash = hashData(preparationEvidenceBinding(request)), audit = new Map<string, string>();
  let currentReviews = true;
  const host: LocalArtifactPreparationHost = {
    now: () => at, readOriginal: () => Uint8Array.from(original), inspector, minimizer,
    verifyEvidence: binding => currentReviews && hashData(binding) === bindingHash ? { bindingHash, verified: true } : null,
    retainAudit: receipt => { const prior = audit.get(receipt.attemptId); if (prior !== undefined && prior !== receipt.id) return null; audit.set(receipt.attemptId, receipt.id); return receipt.id; },
    retainedReceiptHash: attemptId => audit.get(attemptId) ?? null,
    verifyRetainedEvidence: (binding, receiptId) => currentReviews && hashData(binding) === bindingHash && audit.get(binding.attemptId) === receiptId && hashData(host.inspector.identity) === hashData(request.parser) && hashData(host.minimizer.identity) === hashData(request.projection.minimizer) ? { bindingHash, receiptId, checkedAt: at, verified: true } : null,
  };
  return { request, host, audit, original, withdrawReviews: () => { currentReviews = false; } };
}

test('real synthetic workbook parsing joins existing preparation custody and explicit reviews with UNQUALIFIED output', () => {
  const fixture = preparationFixture(), output = prepareLocalArtifact(fixture.request, fixture.host);
  assert.equal(output.receipt.qualification, 'UNQUALIFIED');
  for (const name of ['connectorAdmission', 'vendorAdmission', 'publicationAuthority', 'modelDisclosureAuthority', 'redistributionAuthority', 'trainingAuthority'] as const) assert.equal(output.receipt[name], false);
  assert.deepEqual(output.receipt.dependencies, preparationEvidenceBinding(fixture.request).dependencies); assert.equal(fixture.audit.get(fixture.request.attemptId), output.receipt.id);
  assert.equal(output.projected.cells.length, 14); assert.equal(output.projected.cellReceipts.length, 20); assert.ok(Object.isFrozen(output));
});

test('actual workbook preparation refuses tampered custody, fabricated observations and unresolved reviews', async t => {
  await t.test('tampered original bytes', () => { const fixture = preparationFixture(); fixture.host.readOriginal = () => { const changed = Uint8Array.from(fixture.original); changed[30] ^= 1; return changed; }; refuse(() => prepareLocalArtifact(fixture.request, fixture.host), 'CUSTODY_MISMATCH'); assert.equal(fixture.audit.size, 0); });
  await t.test('missing original bytes', () => { const fixture = preparationFixture(); fixture.host.readOriginal = () => null; refuse(() => prepareLocalArtifact(fixture.request, fixture.host), 'CUSTODY_UNVERIFIED'); assert.equal(fixture.audit.size, 0); });
  await t.test('unverified fabricated observation', () => { const fixture = preparationFixture(); fixture.request.observation.cells[0].lexeme = 'FABRICATED'; refuse(() => prepareLocalArtifact(fixture.request, fixture.host)); assert.equal(fixture.audit.size, 0); });
  await t.test('unknown reuse rights', () => { const fixture = preparationFixture(); fixture.request.manifest.rights.permissions.reuse = 'unknown'; refuse(() => prepareLocalArtifact(fixture.request, fixture.host), 'RIGHTS_UNRESOLVED'); assert.equal(fixture.audit.size, 0); });
  await t.test('unreviewed privacy', () => { const fixture = preparationFixture(); fixture.request.manifest.rights.personalData = 'unreviewed'; refuse(() => prepareLocalArtifact(fixture.request, fixture.host), 'PERSONAL_DATA_UNREVIEWED'); assert.equal(fixture.audit.size, 0); });
  await t.test('withdrawn current synthetic reviews', () => { const fixture = preparationFixture(); fixture.withdrawReviews(); refuse(() => prepareLocalArtifact(fixture.request, fixture.host), 'PREPARATION_EVIDENCE_UNVERIFIED'); assert.equal(fixture.audit.size, 0); });
});
