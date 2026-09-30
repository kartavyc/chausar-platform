import { inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';
import { check, ChausarError } from './contracts.ts';

const MAX_COMPRESSED = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED = 25 * 1024 * 1024;
const MAX_CELLS = 100000;
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
export function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
type XmlNode = { name: string; attributes: Record<string, string>; children: XmlNode[]; text: string };
const local = (name: string) => name.split(':').at(-1)!;
const child = (node: XmlNode, name: string) => node.children.find(n => local(n.name) === name);
const children = (node: XmlNode, name: string) => node.children.filter(n => local(n.name) === name);
const attr = (node: XmlNode, name: string) => node.attributes[name] ?? Object.entries(node.attributes).find(([key]) => local(key) === name)?.[1];
const text = (node: XmlNode): string => node.text + node.children.map(text).join('');
function xmlEntities(value: string): string {
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'INVALID_OPENXML', 'XML contains invalid control characters.');
  return value.replace(/&([^;]*);|&/g, (match, entity: string | undefined) => {
    check(entity !== undefined, 'INVALID_OPENXML', 'Invalid XML entity.');
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    check(/^#(?:[0-9]{1,7}|x[0-9a-fA-F]{1,6})$/.test(entity), 'UNSUPPORTED_XML_ENTITY', 'Only standard XML character entities are accepted.');
    const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    check(code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && (code >= 32 || [9, 10, 13].includes(code)), 'INVALID_OPENXML', 'Invalid XML character entity.'); return String.fromCodePoint(code);
  });
}
function parseXml(bytes: Uint8Array): XmlNode {
  let xml: string; try { xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); } catch { throw new ChausarError('INVALID_OPENXML', 'OpenXML must contain valid UTF-8 XML.'); }
  check(!/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml), 'UNSUPPORTED_XML_ENTITY', 'DTD, external entities and CDATA are refused.');
  check(!/<\?xml[^?]*encoding\s*=\s*['"](?!UTF-?8['"])[^'"]+/i.test(xml), 'INVALID_OPENXML', 'Only UTF-8 OpenXML is supported.');
  const root: XmlNode = { name: '#document', attributes: {}, children: [], text: '' }; const stack = [root]; let offset = 0; let nodes = 0;
  const tokens = /<!--[\s\S]*?-->|<\?xml\s[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g;
  for (const match of xml.matchAll(tokens)) {
    check(match.index === offset, 'INVALID_OPENXML', 'Malformed XML document.'); offset = match.index! + match[0].length; const token = match[0];
    if (token.startsWith('<!--')) { check(!token.slice(4, -3).includes('--'), 'INVALID_OPENXML', 'Malformed XML comment.'); continue; }
    if (token.startsWith('<?xml')) { check(stack.length === 1 && root.children.length === 0, 'INVALID_OPENXML', 'XML declaration must precede the root.'); continue; }
    if (!token.startsWith('<')) { check(stack.length > 1 || !token.trim(), 'INVALID_OPENXML', 'Text outside the XML root.'); stack.at(-1)!.text += xmlEntities(token); continue; }
    if (token.startsWith('</')) { const close = /^<\/([A-Za-z_][\w.:-]*)\s*>$/.exec(token); check(close && stack.length > 1 && stack.at(-1)!.name === close[1], 'INVALID_OPENXML', 'XML closing tags do not match.'); stack.pop(); continue; }
    check(!token.startsWith('<!') && !token.startsWith('<?'), 'INVALID_OPENXML', 'Unknown XML directives are refused.');
    const open = /^<([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)>$/.exec(token); check(open, 'INVALID_OPENXML', 'Malformed XML opening tag.');
    const node: XmlNode = { name: open[1], attributes: {}, children: [], text: '' }; const attributes = open[2]; let position = 0;
    const attrs = /\s+([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/g;
    for (const a of attributes.matchAll(attrs)) { check(a.index === position && !Object.hasOwn(node.attributes, a[1]) && !a[2].includes('<'), 'INVALID_OPENXML', 'Malformed or duplicated XML attribute.'); position = a.index! + a[0].length; node.attributes[a[1]] = xmlEntities(a[2].slice(1, -1)); }
    check(!attributes.slice(position).trim(), 'INVALID_OPENXML', 'Malformed XML attributes.'); nodes += 1;
    check(nodes <= 600000 && stack.length <= 32, 'WORKBOOK_LIMIT', 'The XML document exceeds its node or depth limit.'); stack.at(-1)!.children.push(node); if (!open[3]) stack.push(node);
  }
  check(offset === xml.length && stack.length === 1 && root.children.length === 1, 'INVALID_OPENXML', 'Truncated or multiple-root XML.'); return root.children[0];
}
function safePath(name: string) {
  check(name.length > 0 && name.length <= 240 && /^[A-Za-z0-9_.\-/\[\] ]+$/.test(name) && !name.startsWith('/') && !name.split('/').some(part => part === '..' || part === '.' || part === '') && !name.includes('\\'), 'UNSAFE_ZIP_PATH', 'ZIP traversal, absolute paths and ambiguous entry names are refused.');
  return name;
}
/** XLSX is read in memory. Nothing is extracted to the filesystem. */
function unzipWorkbook(input: Uint8Array): Map<string, Uint8Array> {
  check(input.byteLength <= MAX_COMPRESSED, 'WORKBOOK_LIMIT', 'Workbooks may be at most 2 MiB compressed.');
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  check(bytes.length >= 22 && bytes.readUInt32LE(0) === 0x04034b50, 'UNSUPPORTED_WORKBOOK', 'Only read-only XLSX ZIP workbooks are supported. Binary XLS, XLSB, encrypted Office documents and PDF/OCR are unavailable.');
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) if (bytes.readUInt32LE(index) === 0x06054b50 && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) { eocd = index; break; }
  check(eocd >= 0, 'INVALID_ZIP', 'The workbook ZIP directory is missing or truncated.');
  const entries = bytes.readUInt16LE(eocd + 10); const size = bytes.readUInt32LE(eocd + 12); const directoryOffset = bytes.readUInt32LE(eocd + 16);
  check(bytes.readUInt16LE(eocd + 4) === 0 && bytes.readUInt16LE(eocd + 6) === 0 && bytes.readUInt16LE(eocd + 8) === entries && entries !== 65535 && size !== 0xffffffff && directoryOffset !== 0xffffffff, 'UNSUPPORTED_ZIP', 'Multi-disk and ZIP64 archives are refused.');
  check(entries > 0 && entries <= 256 && directoryOffset + size === eocd, 'INVALID_ZIP', 'The workbook ZIP directory is invalid or too large.');
  const files = new Map<string, Uint8Array>(); const spans: [number, number][] = []; let position = directoryOffset; let total = 0;
  for (let entry = 0; entry < entries; entry++) {
    check(position + 46 <= eocd && bytes.readUInt32LE(position) === 0x02014b50, 'INVALID_ZIP', 'Invalid ZIP central directory entry.');
    const flags = bytes.readUInt16LE(position + 8); const method = bytes.readUInt16LE(position + 10); const crc = bytes.readUInt32LE(position + 16); const compressed = bytes.readUInt32LE(position + 20); const uncompressed = bytes.readUInt32LE(position + 24); const nameLength = bytes.readUInt16LE(position + 28); const extraLength = bytes.readUInt16LE(position + 30); const commentLength = bytes.readUInt16LE(position + 32); const offset = bytes.readUInt32LE(position + 42);
    check(!(flags & 1) && (flags & ~0x080e) === 0, 'ENCRYPTED_ZIP', 'Encrypted and unsupported ZIP flags are refused.'); check([0, 8].includes(method), 'UNSUPPORTED_ZIP', 'Only stored or deflated XLSX entries are supported.');
    check(bytes.readUInt16LE(position + 34) === 0 && offset !== 0xffffffff && compressed !== 0xffffffff && uncompressed !== 0xffffffff, 'UNSUPPORTED_ZIP', 'Multi-disk and ZIP64 entries are refused.');
    const mode = bytes.readUInt32LE(position + 38) >>> 16; check((mode & 0xf000) !== 0xa000, 'ZIP_LINK_REFUSED', 'Symbolic ZIP links are refused.');
    check(position + 46 + nameLength + extraLength + commentLength <= eocd && nameLength > 0 && nameLength <= 240, 'INVALID_ZIP', 'Truncated ZIP entry metadata.');
    let name: string; try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(position + 46, position + 46 + nameLength)); } catch { throw new ChausarError('INVALID_ZIP', 'ZIP names must use UTF-8.'); }
    const directory = name.endsWith('/'); safePath(directory ? name.slice(0, -1) : name); check(!files.has(name), 'INVALID_ZIP', 'Duplicate ZIP paths are refused.');
    check(!/(?:vbaproject|vbadata)\.(?:bin|xml)$|(?:^|\/)(?:macrosheets|activex|embeddings|externallinks|querytables)\/|(?:^|\/)connections\.xml$/i.test(name), 'MACRO_WORKBOOK_REFUSED', 'Macros, ActiveX, embedded files and external data connections are refused.');
    check(offset + 30 <= directoryOffset && bytes.readUInt32LE(offset) === 0x04034b50, 'INVALID_ZIP', 'Invalid ZIP local file entry.');
    const localNameLength = bytes.readUInt16LE(offset + 26); const localExtraLength = bytes.readUInt16LE(offset + 28); const dataOffset = offset + 30 + localNameLength + localExtraLength;
    check(dataOffset + compressed <= directoryOffset && bytes.readUInt16LE(offset + 6) === flags && bytes.readUInt16LE(offset + 8) === method && bytes.subarray(offset + 30, offset + 30 + localNameLength).equals(Buffer.from(name)), 'INVALID_ZIP', 'ZIP local metadata disagrees with its directory.');
    if (!(flags & 8)) check(bytes.readUInt32LE(offset + 14) === crc && bytes.readUInt32LE(offset + 18) === compressed && bytes.readUInt32LE(offset + 22) === uncompressed, 'INVALID_ZIP', 'ZIP CRC and sizes disagree with the local entry.');
    check(uncompressed <= MAX_UNCOMPRESSED && total + uncompressed <= MAX_UNCOMPRESSED && (uncompressed === 0 || compressed > 0) && (compressed === 0 || uncompressed <= compressed * 2000), 'ZIP_BOMB_REFUSED', 'Workbook expanded size or compression ratio exceeds its limit.'); total += uncompressed;
    const packed = bytes.subarray(dataOffset, dataOffset + compressed); let unpacked: Buffer;
    try { unpacked = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: Math.max(1, uncompressed) }); } catch { throw new ChausarError('INVALID_ZIP', 'A compressed workbook entry is corrupt or exceeds its declared size.'); }
    check(unpacked.length === uncompressed && crc32(unpacked) === crc, 'ZIP_CRC_MISMATCH', 'Workbook data failed ZIP CRC or size verification.');
    let end = dataOffset + compressed;
    if (flags & 8) {
      check(end + 12 <= directoryOffset, 'INVALID_ZIP', 'Truncated ZIP data descriptor.'); if (bytes.readUInt32LE(end) === 0x08074b50) end += 4;
      check(end + 12 <= directoryOffset && bytes.readUInt32LE(end) === crc && bytes.readUInt32LE(end + 4) === compressed && bytes.readUInt32LE(end + 8) === uncompressed, 'INVALID_ZIP', 'ZIP data descriptor disagrees with its directory.'); end += 12;
    }
    check(!spans.some(([start, previousEnd]) => offset < previousEnd && end > start), 'INVALID_ZIP', 'Overlapping ZIP entries are refused.'); spans.push([offset, end]);
    check(!directory || unpacked.length === 0, 'INVALID_ZIP', 'A ZIP directory cannot contain data.'); files.set(name, unpacked); position += 46 + nameLength + extraLength + commentLength;
  }
  check(position === eocd, 'INVALID_ZIP', 'ZIP directory size does not match its entries.');
  spans.sort(([a], [b]) => a - b); check(spans[0][0] === 0 && spans.at(-1)![1] === directoryOffset && spans.every(([start], index) => index === 0 || start === spans[index - 1][1]), 'INVALID_ZIP', 'Unindexed ZIP payloads or gaps are refused.'); return files;
}
function resolvePart(base: string, target: string) {
  check(typeof target === 'string' && target.length > 0 && !/[\\:%?#]/.test(target) && !target.startsWith('//'), 'EXTERNAL_LINK_REFUSED', 'Only relative or package-root internal OpenXML parts are accepted.');
  // A leading slash in an OpenXML relationship denotes this ZIP package, never the host filesystem.
  return safePath(target.startsWith('/') ? posix.normalize(target.slice(1)) : posix.normalize(posix.join(posix.dirname(base), target)));
}
function richText(node: XmlNode): string { return node.children.map(n => local(n.name) === 't' ? text(n) : local(n.name) === 'r' ? children(n, 't').map(text).join('') : '').join(''); }
function coordinates(reference: string): [number, number] {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference); check(match, 'INVALID_CELL', 'Every cell needs an explicit OpenXML address.');
  let column = 0; for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]); check(column <= 16384 && row <= 100000, 'WORKBOOK_LIMIT', 'Sparse sheet coordinates exceed the bounded import grid.'); return [row - 1, column - 1];
}

export type WorkbookResult = { sheets: { name: string; rows: string[][] }[]; coverage: { format: 'xlsx'; sheetCount: number; selectedSheetCount: number; nonEmptyCells: number; allocatedCells: number; formulaCells: 0; readOnly: true }; warnings: string[] };
export function readWorkbook(input: Uint8Array, options: { sheet?: string } = {}): WorkbookResult {
  check(input instanceof Uint8Array, 'INVALID_WORKBOOK', 'Provide the original XLSX bytes.'); check(options.sheet === undefined || (typeof options.sheet === 'string' && options.sheet.length <= 200), 'INVALID_SHEET', 'Select a sheet by its exact name.');
  const files = unzipWorkbook(input); const documents = new Map<string, XmlNode>();
  for (const [name, bytes] of files) if (/\.(?:xml|rels)$/i.test(name)) {
    const node = parseXml(bytes); documents.set(name, node);
    if (local(node.name) === 'worksheet') { const stack = [node]; while (stack.length) { const element = stack.pop()!; check(local(element.name) !== 'f', 'FORMULA_WORKBOOK_REFUSED', 'Formula cells are refused in every sheet. Export literal values before importing.'); stack.push(...element.children); } }
    if (name.endsWith('.rels')) for (const relationship of children(node, 'Relationship')) check((attr(relationship, 'TargetMode') ?? '').toLowerCase() !== 'external', 'EXTERNAL_LINK_REFUSED', 'External workbook, hyperlink and data connections are refused.');
    if (name === '[Content_Types].xml') for (const override of node.children) check(!/macroenabled|vba|activex|binary/i.test(attr(override, 'ContentType') ?? ''), 'MACRO_WORKBOOK_REFUSED', 'Macro and binary workbook content types are refused.');
  }
  const types = documents.get('[Content_Types].xml'); check(types && local(types.name) === 'Types', 'INVALID_OPENXML', 'The XLSX content type declaration is missing.');
  const packageRels = documents.get('_rels/.rels'); check(packageRels, 'INVALID_OPENXML', 'The XLSX package relationships are missing.');
  const workbookRel = children(packageRels, 'Relationship').find(r => (attr(r, 'Type') ?? '').endsWith('/officeDocument')); check(workbookRel, 'INVALID_OPENXML', 'The package has no workbook relationship.');
  const workbookPath = resolvePart('_root.xml', attr(workbookRel, 'Target') ?? ''); const workbook = documents.get(workbookPath); check(workbook && local(workbook.name) === 'workbook', 'INVALID_OPENXML', 'The workbook XML is missing.');
  const workbookType = children(types, 'Override').find(n => attr(n, 'PartName') === `/${workbookPath}`); check(workbookType && attr(workbookType, 'ContentType') === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'UNSUPPORTED_WORKBOOK', 'Only standard XLSX spreadsheet workbooks are supported.');
  const relationships = documents.get(posix.join(posix.dirname(workbookPath), '_rels', `${posix.basename(workbookPath)}.rels`)); check(relationships, 'INVALID_OPENXML', 'Workbook sheet relationships are missing.');
  const relationMap = new Map<string, XmlNode>(); for (const r of children(relationships, 'Relationship')) { const id = attr(r, 'Id'); check(id && !relationMap.has(id), 'INVALID_OPENXML', 'Workbook relationship IDs must be unique.'); relationMap.set(id, r); }
  const stringsRelation = children(relationships, 'Relationship').find(r => (attr(r, 'Type') ?? '').endsWith('/sharedStrings'));
  const sharedStrings: string[] = [];
  if (stringsRelation) { const part = documents.get(resolvePart(workbookPath, attr(stringsRelation, 'Target') ?? '')); check(part && local(part.name) === 'sst', 'INVALID_OPENXML', 'Shared strings are missing.'); for (const item of children(part, 'si')) { check(sharedStrings.length < MAX_CELLS, 'WORKBOOK_LIMIT', 'Too many shared strings.'); sharedStrings.push(richText(item)); } }
  const sheetList = child(workbook, 'sheets'); check(sheetList, 'INVALID_OPENXML', 'The workbook has no sheets.'); const definitions = children(sheetList, 'sheet'); check(definitions.length > 0 && definitions.length <= 64, 'WORKBOOK_LIMIT', 'A workbook must contain 1–64 sheets.');
  const names = new Set<string>(); let nonEmptyCells = 0; let allocatedCells = 0; const sheets: WorkbookResult['sheets'] = []; const warnings = new Set<string>(); let selected = false;
  for (const definition of definitions) {
    const name = attr(definition, 'name'); check(name && name.length <= 200 && !names.has(name), 'INVALID_SHEET', 'Workbook sheet names must be present and unique.'); names.add(name);
    if (options.sheet && options.sheet !== name) continue; selected = true;
    const relation = relationMap.get(attr(definition, 'id') ?? ''); check(relation && (attr(relation, 'Type') ?? '').endsWith('/worksheet'), 'UNSUPPORTED_SHEET', 'Only normal worksheet parts are supported.');
    const sheet = documents.get(resolvePart(workbookPath, attr(relation, 'Target') ?? '')); check(sheet && local(sheet.name) === 'worksheet', 'INVALID_OPENXML', 'Worksheet XML is missing.');
    const data = child(sheet, 'sheetData'); check(data, 'INVALID_OPENXML', 'Worksheet has no sheet data.'); const sparse: { row: number; col: number; value: string }[] = []; const seen = new Set<string>(); let maxRow = 0; let maxCol = 0;
    for (const row of children(data, 'row')) {
      const rowNumber = attr(row, 'r'); check(rowNumber && /^[1-9]\d{0,6}$/.test(rowNumber) && Number(rowNumber) <= 100000, 'INVALID_CELL', 'Worksheet rows need explicit bounded numbers.');
      for (const cell of children(row, 'c')) {
        check(!child(cell, 'f'), 'FORMULA_WORKBOOK_REFUSED', 'Formula cells are refused. Export literal values before importing; no formula or cached formula is evaluated.');
        const reference = attr(cell, 'r') ?? ''; const [r, col] = coordinates(reference); check(r + 1 === Number(rowNumber) && !seen.has(reference), 'INVALID_CELL', 'Cell addresses must match unique worksheet rows.'); seen.add(reference);
        nonEmptyCells += 1; check(nonEmptyCells <= MAX_CELLS, 'WORKBOOK_LIMIT', 'A workbook may contain at most 100,000 imported cells.');
        const valueNode = child(cell, 'v'); const raw = valueNode ? text(valueNode) : ''; const type = attr(cell, 't') ?? 'n'; let value = raw;
        if (type === 's') { check(/^(0|[1-9]\d*)$/.test(raw) && raw.length <= 6 && Number(raw) < sharedStrings.length, 'INVALID_CELL', 'Invalid shared string index.'); value = sharedStrings[Number(raw)]; }
        else if (type === 'inlineStr') { const inline = child(cell, 'is'); check(inline, 'INVALID_CELL', 'An inline string is missing.'); value = richText(inline); }
        else if (type === 'n') { check(raw === '' || /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw), 'INVALID_CELL', 'Numeric cells must contain their exact finite decimal text.'); if (attr(cell, 's')) warnings.add('Numeric formatting is not applied. Dates stored as serial numbers remain serial strings; choose explicit date columns.'); }
        else if (type === 'b') { check(raw === '0' || raw === '1', 'INVALID_CELL', 'Invalid boolean cell.'); value = raw === '1' ? 'true' : 'false'; }
        else if (type === 'e') throw new ChausarError('WORKBOOK_CELL_ERROR', 'Error cells cannot enter financial calculations. Fix the workbook first.');
        else check(type === 'str' || type === 'd', 'UNSUPPORTED_CELL_TYPE', 'Unsupported worksheet cell type.');
        check(value.length <= 100000, 'WORKBOOK_LIMIT', 'A single worksheet value is too large.'); sparse.push({ row: r, col, value }); maxRow = Math.max(maxRow, r + 1); maxCol = Math.max(maxCol, col + 1);
        check(maxRow * maxCol + allocatedCells <= MAX_CELLS, 'WORKBOOK_LIMIT', 'The populated sparse grid exceeds 100,000 allocated cells.');
      }
    }
    const rows = Array.from({ length: maxRow }, () => Array<string>(maxCol).fill('')); for (const cell of sparse) rows[cell.row][cell.col] = cell.value; allocatedCells += maxRow * maxCol; sheets.push({ name, rows });
    if (attr(definition, 'state') && attr(definition, 'state') !== 'visible') warnings.add(`Sheet ${name} is marked ${attr(definition, 'state')}; imported content is treated as data only.`);
  }
  check(selected, 'SHEET_NOT_FOUND', 'The selected worksheet does not exist.');
  return { sheets, coverage: { format: 'xlsx', sheetCount: definitions.length, selectedSheetCount: sheets.length, nonEmptyCells, allocatedCells, formulaCells: 0, readOnly: true }, warnings: [...warnings] };
}
export function workbookSheetToCSV(sheet: WorkbookResult['sheets'][number]): string {
  return sheet.rows.map(row => row.map(value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(',')).join('\n');
}
export class WorkbookReader { read(input: Uint8Array, options: { sheet?: string } = {}) { return readWorkbook(input, options); } }
