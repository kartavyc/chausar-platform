import { readFileSync } from 'node:fs';
import { PREPARATION_LIMITS } from './contracts.ts';
import type {
  ArtifactObservation, CellType, ImplementationIdentity, LocalArtifactInspector, LocalArtifactMinimizer,
  ObservedCell, ObservedSheet, ProjectedArtifact, ProjectionPlan,
} from './contracts.ts';
import { calendarDate, dataOnly, exactKeys, freezeData, hashData, requireThat, sha256Bytes, text } from '../validation.ts';
import { assertWorkbookMemberName, parseWorkbookXml, readWorkbookContainer, WORKBOOK_CONTAINER_PROFILE } from './workbook-container.ts';
import type { XmlNode } from './workbook-container.ts';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MIME = {
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  worksheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  sharedStrings: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  styles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
};
const REMOVED_LABELS = ['customerid', 'country', 'description'];
const BUILTIN_FORMATS = new Map<number, string>([[0, 'General'], [1, '0'], [2, '0.00'], [14, 'mm-dd-yy'], [22, 'm/d/yy h:mm']]);
const LIMITATIONS = [
  'Bounded transitional OOXML literal profile only; unsupported package parts and spreadsheet features refuse.',
  'Row 1 is the explicit header convention; all sheets including hidden sheets are inspected. Headers are schema, not projected data rows.',
  'Evidence paths are reversible opc/ASCII-hex.part member identities, not extraction paths; decode with workbookMemberName.',
  'Numeric date serials remain number cells with their exact format; no display rendering, date conversion or formula/cache evaluation occurs.',
  'CustomerID, Country and Description removal is not declassification; original parts, headers and cell hashes require explicit privacy review.',
  'Tax, units, settlement, refund meaning, business controls, parser containment qualification and vendor admission remain unknown/unqualified.',
];

export const WORKBOOK_PREPARATION_PROFILE = freezeData({
  version: '1', namespaces: { MAIN, REL, OFFICE_REL, TYPES }, limits: PREPARATION_LIMITS,
  container: WORKBOOK_CONTAINER_PROFILE, aggregateXmlNodes: 100000, lexicalCharacters: 1000,
  headerRow: 1, removedLabels: REMOVED_LABELS, builtInFormats: [...BUILTIN_FORMATS],
  runtime: { node: process.versions.node, zlib: process.versions.zlib },
});

function check(value: unknown, code: string, message: string): asserts value { requireThat(value, `XLSX_${code}`, message); }
/** Contract-compatible, reversible identity for an actual ZIP member. Never a filesystem path. */
export function workbookMemberEvidencePath(name: string): string {
  assertWorkbookMemberName(name); return `opc/${Buffer.from(name, 'ascii').toString('hex')}.part`;
}
export function workbookMemberName(path: string): string {
  check(typeof path === 'string' && /^opc\/(?:[0-9a-f]{2}){1,240}\.part$/.test(path), 'PATH', 'A canonical member evidence identity is required.');
  const bytes = Buffer.from(path.slice(4, -5), 'hex');
  check(bytes.every(value => value < 128), 'PATH', 'Only ASCII package member names are supported.');
  const name = bytes.toString('ascii'); assertWorkbookMemberName(name);
  check(workbookMemberEvidencePath(name) === path, 'PATH', 'Member identities must round trip exactly.'); return name;
}

// Identity is measured from installed local source, not selected by workbook content or a caller build claim.
function implementationIdentity(id: string): ImplementationIdentity {
  const sources = ['./workbook-preparation.ts', './workbook-container.ts', '../validation.ts'].map(file => ({
    file, sha256: sha256Bytes(readFileSync(new URL(file, import.meta.url))),
  }));
  return freezeData({ id, version: '1', buildHash: hashData(sources), profileHash: hashData(WORKBOOK_PREPARATION_PROFILE) });
}
function fixedLimits(limits: typeof PREPARATION_LIMITS) {
  dataOnly(limits); check(hashData(limits) === hashData(PREPARATION_LIMITS), 'LIMIT', 'Version-one resource limits cannot be raised or replaced.');
}
function element(node: XmlNode, name: string, attributes: string[], children: string[], scalar = false) {
  check(node.name === name && Object.keys(node.attributes).every(key => attributes.includes(key)) && node.children.every(child => children.includes(child.name)),
    'FORM_REFUSED', `Unsupported or ambiguous ${name} element/attribute in the literal profile.`);
  check(scalar || node.text.trim() === '', 'XML', 'Container elements cannot contain mixed text.');
}
function required(node: XmlNode, name: string): XmlNode {
  const matches = node.children.filter(child => child.name === name);
  check(matches.length === 1, 'XML', `Exactly one ${name} element is required.`); return matches[0];
}
function optional(node: XmlNode, name: string): XmlNode | undefined {
  const matches = node.children.filter(child => child.name === name);
  check(matches.length <= 1, 'XML', `Duplicate ${name} elements are refused.`); return matches[0];
}
function integer(value: string | undefined, max: number, min = 0): number {
  check(value !== undefined && /^(?:0|[1-9]\d*)$/.test(value) && value.length <= 10, 'XML', 'A canonical bounded integer attribute is required.');
  const number = Number(value); check(Number.isSafeInteger(number) && number >= min && number <= max, 'LIMIT', 'An integer exceeds the profile bounds.'); return number;
}
function lexical(value: string) { check(value.length <= 1000, 'LIMIT', 'Cell/header/format text exceeds the existing contract lexical limit.'); return value; }
function scalar(node: XmlNode, name: string) {
  element(node, name, name === 't' ? ['xml:space'] : [], [], true);
  check(node.attributes['xml:space'] === undefined || ['preserve', 'default'].includes(node.attributes['xml:space']), 'XML', 'Unsupported XML whitespace directive.');
  return lexical(node.text);
}
function plainText(node: XmlNode, name: 'is' | 'si') { element(node, name, [], ['t']); return scalar(required(node, 't'), 't'); }
function coordinate(value: string | undefined) {
  const match = typeof value === 'string' ? /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value) : null;
  check(match, 'CELL', 'Every cell needs a canonical explicit address.');
  let column = 0; for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]); check(column <= PREPARATION_LIMITS.columnsPerSheet && row <= 1048576, 'LIMIT', 'Cell coordinates exceed the profile.'); return { row, column };
}
function namespace(root: XmlNode, expected: string): number {
  check(root.attributes.xmlns === expected && (root.attributes['xmlns:r'] === undefined || root.attributes['xmlns:r'] === OFFICE_REL),
    'NAMESPACE', 'Only the exact supported default namespace and relationship prefix are accepted.');
  let nodes = 0; const stack = [root];
  while (stack.length) {
    const node = stack.pop()!; nodes++;
    check(!node.name.includes(':'), 'NAMESPACE', 'Prefixed or aliased element names are unsupported.');
    if (node !== root) check(!Object.keys(node.attributes).some(key => key === 'xmlns' || key.startsWith('xmlns:')), 'NAMESPACE', 'Nested namespace redeclarations are refused.');
    check(node.name !== 'f', 'FORMULA_REFUSED', 'Formulas and their cached values are refused in every header, sheet and removed column.');
    for (const child of node.children) stack.push(child);
  }
  return nodes;
}
type Relationship = { id: string; type: string; target: string };
function relationships(root: XmlNode, base: '' | 'xl/'): Relationship[] {
  element(root, 'Relationships', ['xmlns'], ['Relationship']);
  const seen = new Set<string>();
  return root.children.map(node => {
    element(node, 'Relationship', ['Id', 'Type', 'Target', 'TargetMode'], []);
    check(node.attributes.TargetMode === undefined || node.attributes.TargetMode === 'Internal', 'EXTERNAL_LINK_REFUSED', 'External relationships are refused and never retrieved.');
    const { Id: id, Type: type, Target: target } = node.attributes;
    check(id && /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(id) && !seen.has(id) && type?.startsWith(`${OFFICE_REL}/`) && target, 'RELATIONSHIP', 'Relationship identity/type/target is missing or duplicated.'); seen.add(id);
    const member = target.startsWith('/') ? target.slice(1) : base + target;
    assertWorkbookMemberName(member); check(!/[\\:%?#]/.test(target), 'EXTERNAL_LINK_REFUSED', 'Only canonical internal package targets are supported.');
    return { id, type: type.slice(OFFICE_REL.length + 1), target: member };
  });
}
function styles(root: XmlNode): string[] {
  element(root, 'styleSheet', ['xmlns', 'xmlns:r'], ['numFmts', 'cellXfs']);
  const formats = new Map(BUILTIN_FORMATS), declared = new Set<number>();
  const numFmts = optional(root, 'numFmts');
  if (numFmts) {
    element(numFmts, 'numFmts', ['count'], ['numFmt']);
    if (numFmts.attributes.count !== undefined) check(integer(numFmts.attributes.count, 200) === numFmts.children.length, 'STYLE', 'Format count disagrees with inventory.');
    check(numFmts.children.length <= 200, 'LIMIT', 'Too many custom formats.');
    for (const node of numFmts.children) {
      element(node, 'numFmt', ['numFmtId', 'formatCode'], []);
      const id = integer(node.attributes.numFmtId, 65535, 164); check(!declared.has(id) && node.attributes.formatCode !== undefined, 'STYLE', 'Duplicate/missing custom number formats refuse.');
      const format = lexical(node.attributes.formatCode); check(format.length > 0, 'STYLE', 'An explicit format code is required.'); declared.add(id); formats.set(id, format);
    }
  }
  const xfs = required(root, 'cellXfs'); element(xfs, 'cellXfs', ['count'], ['xf']);
  check(xfs.children.length > 0 && xfs.children.length <= 200, 'LIMIT', 'A bounded explicit cell style table is required.');
  if (xfs.attributes.count !== undefined) check(integer(xfs.attributes.count, 200) === xfs.children.length, 'STYLE', 'Style count disagrees with inventory.');
  return xfs.children.map(node => {
    element(node, 'xf', ['numFmtId'], []);
    const id = integer(node.attributes.numFmtId, 65535); check(formats.has(id), 'STYLE_REFUSED', 'Locale-dependent or unsupported built-in formats refuse; no rendering is guessed.'); return formats.get(id)!;
  });
}
function literalCell(node: XmlNode, shared: string[], formats: string[]): Pick<ObservedCell, 'type' | 'lexeme' | 'numberFormat'> {
  element(node, 'c', ['r', 't', 's'], ['v', 'is']);
  let numberFormat: string | null = null;
  if (node.attributes.s !== undefined) numberFormat = formats[integer(node.attributes.s, formats.length - 1)];
  const type = node.attributes.t ?? 'n', value = optional(node, 'v'), inline = optional(node, 'is');
  check(!(value && inline), 'CELL', 'A cell cannot carry conflicting value representations.');
  if (type === 'inlineStr') { check(inline && !value, 'CELL', 'An inline literal text cell needs one plain string.'); return { type: 'text', lexeme: plainText(inline, 'is'), numberFormat }; }
  check(!inline && ['n', 's', 'b', 'd'].includes(type), 'CELL_REFUSED', 'Errors, formula-cache strings and unknown cell types refuse.');
  if (!value) { check(type === 'n', 'CELL', 'Only an untyped/numeric empty cell is a blank.'); return { type: 'blank', lexeme: '', numberFormat }; }
  const raw = scalar(value, 'v');
  // Numeric/date lexemes retain original XML scalar spelling; encoded scalar values are unsupported.
  check(value.rawText === raw, 'LEXEME_REFUSED', 'Entity-encoded numeric/date/index values are outside the exact lexical profile.');
  if (type === 'n' && raw === '') return { type: 'blank', lexeme: '', numberFormat };
  if (type === 's') {
    const index = integer(raw, shared.length - 1); return { type: 'text', lexeme: shared[index], numberFormat };
  }
  if (type === 'b') { check(['0', '1'].includes(raw), 'CELL', 'Boolean literals must be 0 or 1.'); return { type: 'boolean', lexeme: raw, numberFormat }; }
  if (type === 'd') {
    check(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?Z?)?$/.test(raw) && calendarDate(raw.slice(0, 10)), 'DATE_REFUSED', 'Only explicit ISO calendar/date-time literals are supported; no date conversion is inferred.');
    return { type: 'date', lexeme: raw, numberFormat };
  }
  check(/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?$/.test(raw), 'CELL', 'Numbers require literal decimal/exponent syntax, without floating-point conversion.');
  return { type: 'number', lexeme: raw, numberFormat };
}

function inspectWorkbook(input: Uint8Array, identity: ImplementationIdentity): ArtifactObservation {
  check(input instanceof Uint8Array && input.buffer instanceof ArrayBuffer && input.byteLength > 0 && input.byteLength <= PREPARATION_LIMITS.originalBytes,
    'LIMIT', 'Provide bounded non-shared original bytes.');
  input = Uint8Array.from(input);
  const files = readWorkbookContainer(input), documents = new Map<string, XmlNode>(); let nodes = 0;
  for (const [name, bytes] of files) {
    check(name === '[Content_Types].xml' || /\.(?:xml|rels)$/.test(name), 'PART_REFUSED', 'Only the declared literal XML package profile is supported.');
    check(!/(?:^|\/)(?:externalLinks|embeddings|activeX|macrosheets|queryTables)\/|(?:^|\/)connections\.xml$|vba/i.test(name), 'PART_REFUSED', 'Active, embedded and external-data parts are refused.');
    const root = parseWorkbookXml(bytes); documents.set(name, root);
    nodes += namespace(root, name === '[Content_Types].xml' ? TYPES : name.endsWith('.rels') ? REL : MAIN);
    check(nodes <= WORKBOOK_PREPARATION_PROFILE.aggregateXmlNodes, 'LIMIT', 'Aggregate XML nodes exceed the profile.');
    if (name.endsWith('.rels')) relationships(root, name === '_rels/.rels' ? '' : 'xl/');
  }
  const document = (path: string) => { const value = documents.get(path); check(value, 'PACKAGE', `Required package part ${path} is absent.`); return value; };
  const rootRels = relationships(document('_rels/.rels'), '');
  check(rootRels.length === 1 && rootRels[0].type === 'officeDocument' && rootRels[0].target === 'xl/workbook.xml', 'PACKAGE_REFUSED', 'Exactly one conventional XLSX workbook relationship is supported.');
  const wb = document('xl/workbook.xml'); element(wb, 'workbook', ['xmlns', 'xmlns:r'], ['workbookPr', 'sheets']);
  const properties = optional(wb, 'workbookPr'); let date1904 = false;
  if (properties) {
    element(properties, 'workbookPr', ['date1904'], []);
    check(properties.attributes.date1904 === undefined || ['0', '1', 'true', 'false'].includes(properties.attributes.date1904), 'XML', 'The date basis needs an explicit OOXML boolean.'); date1904 = ['1', 'true'].includes(properties.attributes.date1904);
  }
  const relationshipsList = relationships(document('xl/_rels/workbook.xml.rels'), 'xl/');
  const sharedRel = relationshipsList.filter(item => item.type === 'sharedStrings'), stylesRel = relationshipsList.filter(item => item.type === 'styles');
  check(sharedRel.length <= 1 && stylesRel.length <= 1 && relationshipsList.every(item => ['worksheet', 'sharedStrings', 'styles'].includes(item.type)), 'RELATIONSHIP_REFUSED', 'Unknown or repeated workbook relationship types refuse.');
  check(sharedRel.every(item => item.target === 'xl/sharedStrings.xml') && stylesRel.every(item => item.target === 'xl/styles.xml'), 'PACKAGE_REFUSED', 'Only conventional shared-string/style locations are supported.');
  const shared: string[] = [];
  if (sharedRel.length) {
    const sst = document('xl/sharedStrings.xml'); element(sst, 'sst', ['xmlns', 'xmlns:r', 'count', 'uniqueCount'], ['si']);
    check(sst.children.length <= PREPARATION_LIMITS.cells, 'LIMIT', 'Shared string inventory exceeds the cell budget.');
    if (sst.attributes.uniqueCount !== undefined) check(integer(sst.attributes.uniqueCount, PREPARATION_LIMITS.cells) === sst.children.length, 'STRING', 'Shared string inventory count disagrees.');
    if (sst.attributes.count !== undefined) integer(sst.attributes.count, PREPARATION_LIMITS.cells);
    for (const item of sst.children) shared.push(plainText(item, 'si'));
  }
  const formats = stylesRel.length ? styles(document('xl/styles.xml')) : [];
  const definitions = required(wb, 'sheets'); element(definitions, 'sheets', [], ['sheet']);
  check(definitions.children.length > 0 && definitions.children.length <= PREPARATION_LIMITS.sheets, 'LIMIT', 'A workbook requires a bounded nonempty sheet inventory.');
  const expectedParts = new Map<string, string>([['xl/workbook.xml', MIME.workbook]]);
  if (sharedRel.length) expectedParts.set('xl/sharedStrings.xml', MIME.sharedStrings);
  if (stylesRel.length) expectedParts.set('xl/styles.xml', MIME.styles);
  const usedRelationships = new Set<string>([...sharedRel, ...stylesRel].map(item => item.id)), sheetNames = new Set<string>(), sheetIds = new Set<number>();
  const sheets: ObservedSheet[] = [], cells: ObservedCell[] = []; let actualCells = 0, completeCells = 0;
  for (const definition of definitions.children) {
    element(definition, 'sheet', ['name', 'sheetId', 'r:id', 'state'], []);
    check(wb.attributes['xmlns:r'] === OFFICE_REL, 'NAMESPACE', 'Sheet relationship IDs require the exact declared relationship namespace.');
    const name = definition.attributes.name, numericId = integer(definition.attributes.sheetId, 2147483647, 1), rel = relationshipsList.find(item => item.id === definition.attributes['r:id']);
    check(name && name.length <= 200 && !sheetNames.has(name.toLowerCase()) && !sheetIds.has(numericId) && rel?.type === 'worksheet' && !usedRelationships.has(rel.id), 'SHEET', 'Sheet names, IDs and relationships must be explicit and distinct.');
    check(/^xl\/worksheets\/[A-Za-z0-9_-]+\.xml$/.test(rel.target) && !expectedParts.has(rel.target), 'SHEET_REFUSED', 'Only distinct conventional worksheet parts are supported.');
    sheetNames.add(name.toLowerCase()); sheetIds.add(numericId); usedRelationships.add(rel.id); expectedParts.set(rel.target, MIME.worksheet);
    const state = definition.attributes.state ?? 'visible'; check(['visible', 'hidden', 'veryHidden'].includes(state), 'SHEET', 'Unknown sheet visibility refuses.');
    const sheetId = `sheet-${numericId}`, sheet = document(rel.target); element(sheet, 'worksheet', ['xmlns', 'xmlns:r'], ['dimension', 'sheetData']);
    const dimension = optional(sheet, 'dimension');
    if (dimension) { element(dimension, 'dimension', ['ref'], []); check(dimension.attributes.ref, 'CELL', 'A dimension reference must be explicit.'); for (const ref of dimension.attributes.ref.split(':')) coordinate(ref); check(dimension.attributes.ref.split(':').length <= 2, 'CELL', 'Malformed worksheet dimension.'); }
    const data = required(sheet, 'sheetData'); element(data, 'sheetData', [], ['row']);
    check(data.children.length > 0 && data.children.length <= PREPARATION_LIMITS.rowsPerSheet + 1, 'LIMIT', 'A literal header and bounded data rows are required.');
    const parsedRows: Array<{ row: number; values: Map<number, ReturnType<typeof literalCell>> }> = []; let previousRow = 0;
    for (const row of data.children) {
      element(row, 'row', ['r'], ['c']); const number = integer(row.attributes.r, 1048576, 1);
      check(number > previousRow, 'CELL', 'Worksheet row coordinates must be unique and ordered.'); previousRow = number;
      const values = new Map<number, ReturnType<typeof literalCell>>(); let previousColumn = 0;
      for (const cell of row.children) {
        const point = coordinate(cell.attributes.r); check(point.row === number && point.column > previousColumn, 'CELL', 'Cell addresses must match unique ordered source columns/rows.'); previousColumn = point.column;
        check(++actualCells <= PREPARATION_LIMITS.cells, 'LIMIT', 'Literal cells including headers exceed the cell budget.');
        values.set(point.column, literalCell(cell, shared, formats));
      }
      parsedRows.push({ row: number, values });
    }
    const header = parsedRows[0]; check(header.row === 1 && header.values.size > 0 && header.values.size <= PREPARATION_LIMITS.columnsPerSheet, 'HEADER_REFUSED', 'Row 1 must explicitly contain a nonempty bounded header.');
    if (dimension) {
      const ends = dimension.attributes.ref.split(':').map(coordinate), first = ends[0], last = ends.at(-1)!;
      check(first.row === 1 && first.column === 1 && last.row === parsedRows.at(-1)!.row && last.column === header.values.size,
        'CELL', 'Declared dimensions must agree with the complete explicit header/data grid.');
    }
    const labels = new Set<string>(), columns: ObservedSheet['columns'] = [];
    for (let index = 1; index <= header.values.size; index++) {
      const value = header.values.get(index); check(value?.type === 'text' && value.lexeme.trim() && !labels.has(value.lexeme.trim().toLowerCase()), 'HEADER_REFUSED', 'Headers must be contiguous, nonblank, unique literal text; no labels are guessed.');
      labels.add(value.lexeme.trim().toLowerCase()); columns.push({ id: `column-${index}`, label: value.lexeme, index, types: [] });
    }
    const dataRows = parsedRows.slice(1); completeCells += dataRows.length * columns.length;
    check(completeCells <= PREPARATION_LIMITS.cells, 'LIMIT', 'Complete grids including missing cells exceed the cell budget.');
    for (const row of dataRows) {
      check([...row.values.keys()].every(index => index <= columns.length), 'HEADER_REFUSED', 'A data column without an explicit header refuses.');
      for (const column of columns) {
        const value = row.values.get(column.index) ?? { type: 'blank' as CellType, lexeme: '', numberFormat: null };
        if (!column.types.includes(value.type)) column.types.push(value.type);
        cells.push({ sheetId, row: row.row, columnId: column.id, ...value, displayLexeme: null, formula: null, cachedLexeme: null });
      }
    }
    sheets.push({ id: sheetId, name, partPath: workbookMemberEvidencePath(rel.target), visibility: state === 'veryHidden' ? 'very-hidden' : state as 'visible' | 'hidden', columns, dataRows: dataRows.map(row => row.row) });
  }
  check(usedRelationships.size === relationshipsList.length, 'RELATIONSHIP_REFUSED', 'Unreferenced worksheet relationships refuse.');
  const types = document('[Content_Types].xml'); element(types, 'Types', ['xmlns'], ['Default', 'Override']);
  const defaults = new Map<string, string>(), overrides = new Map<string, string>();
  for (const node of types.children) {
    if (node.name === 'Default') {
      element(node, 'Default', ['Extension', 'ContentType'], []); const { Extension: extension, ContentType: mime } = node.attributes;
      check(['xml', 'rels'].includes(extension) && mime === (extension === 'xml' ? 'application/xml' : 'application/vnd.openxmlformats-package.relationships+xml') && !defaults.has(extension), 'CONTENT_TYPE_REFUSED', 'Unsupported or repeated default content types refuse.'); defaults.set(extension, mime);
    } else {
      element(node, 'Override', ['PartName', 'ContentType'], []); const { PartName: name, ContentType: mime } = node.attributes;
      check(name?.startsWith('/') && expectedParts.has(name.slice(1)) && expectedParts.get(name.slice(1)) === mime && !overrides.has(name.slice(1)), 'CONTENT_TYPE_REFUSED', 'Unknown, duplicate or mismatched part types refuse.'); overrides.set(name.slice(1), mime);
    }
  }
  check(defaults.has('xml') && defaults.has('rels') && overrides.size === expectedParts.size, 'CONTENT_TYPE_REFUSED', 'Complete exact package content types are required.');
  const accepted = new Set(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', ...expectedParts.keys()]);
  check(files.size === accepted.size && [...files.keys()].every(name => accepted.has(name)), 'PART_REFUSED', 'Unrecognized or orphaned parts refuse rather than silently escaping inspection.');
  return freezeData({
    contractVersion: 1, originalSha256: sha256Bytes(input), parserHash: hashData(identity), mediaType: 'workbook',
    parts: [...files].map(([name, bytes]) => ({ path: workbookMemberEvidencePath(name), sha256: sha256Bytes(bytes), byteLength: bytes.byteLength, inspected: true as const })),
    sheets, cells, inspection: { allPartsInspected: true, encrypted: false, activeContent: false, externalLinks: [] },
    limitations: [...LIMITATIONS, `Workbook date basis: ${date1904 ? '1904' : '1900'}; numeric serials, including serial 60, are not converted to calendar/business dates.`],
  });
}

export function createWorkbookInspector(): LocalArtifactInspector {
  const identity = implementationIdentity('bounded-ooxml-literal-inspector');
  return Object.freeze({ identity, inspect(original: Uint8Array, limits: typeof PREPARATION_LIMITS) { fixedLimits(limits); return inspectWorkbook(original, identity); } });
}
function removed(label: string) { return REMOVED_LABELS.includes(label.trim().toLowerCase()); }
/** A review candidate only. This does not supply rights, privacy, source evidence or an admission. */
export function proposeWorkbookMinimization(observation: ArtifactObservation, id: string, version: string): ProjectionPlan {
  dataOnly(observation); text(id, 'projection ID'); text(version, 'projection version');
  return freezeData({ contractVersion: 1, id, version, minimizer: implementationIdentity('bounded-ooxml-column-minimizer'), sheets: observation.sheets.map(sheet => ({
    sheetId: sheet.id, retainColumns: sheet.columns.filter(column => !removed(column.label)).map(column => column.id),
    removeColumns: sheet.columns.filter(column => removed(column.label)).map(column => column.id),
  })) });
}
export function createWorkbookMinimizer(): LocalArtifactMinimizer {
  const identity = implementationIdentity('bounded-ooxml-column-minimizer');
  return Object.freeze({ identity, project(observation: ArtifactObservation, plan: ProjectionPlan, limits: typeof PREPARATION_LIMITS): ProjectedArtifact {
    fixedLimits(limits); dataOnly(observation); dataOnly(plan);
    exactKeys(plan, ['contractVersion', 'id', 'version', 'minimizer', 'sheets']); text(plan.id, 'projection ID'); text(plan.version, 'projection version');
    check(plan.contractVersion === 1 && hashData(plan.minimizer) === hashData(identity) && plan.sheets.length === observation.sheets.length, 'PROJECTION', 'The complete versioned plan must bind this installed minimizer.');
    const plans = new Map<string, ProjectionPlan['sheets'][number]>();
    for (const item of plan.sheets) {
      exactKeys(item, ['sheetId', 'retainColumns', 'removeColumns']); const sheet = observation.sheets.find(sheet => sheet.id === item.sheetId);
      check(sheet && !plans.has(sheet.id) && Array.isArray(item.retainColumns) && Array.isArray(item.removeColumns), 'PROJECTION', 'Every sheet needs one explicit disposition.');
      const ids = sheet.columns.map(column => column.id), all = [...item.retainColumns, ...item.removeColumns];
      check(all.length === ids.length && new Set(all).size === ids.length && all.every(id => ids.includes(id)) &&
        hashData(ids.filter(id => item.retainColumns.includes(id))) === hashData(item.retainColumns) &&
        hashData(ids.filter(id => item.removeColumns.includes(id))) === hashData(item.removeColumns), 'PROJECTION', 'Each column needs one ordered retain/remove disposition.');
      check(sheet.columns.every(column => !removed(column.label) || item.removeColumns.includes(column.id)), 'MINIMIZATION', 'CustomerID, Country and Description must be removed in every sheet.'); plans.set(sheet.id, item);
    }
    return freezeData({
      contractVersion: 1, observationHash: hashData(observation), projectionHash: hashData(plan),
      sheets: observation.sheets.filter(sheet => plans.get(sheet.id)!.retainColumns.length).map(sheet => ({ ...sheet, columns: sheet.columns.filter(column => plans.get(sheet.id)!.retainColumns.includes(column.id)).map((column, index) => ({ ...column, index: index + 1 })) })),
      cells: observation.cells.filter(cell => plans.get(cell.sheetId)!.retainColumns.includes(cell.columnId)),
      cellReceipts: observation.cells.map(cell => {
        const sheet = observation.sheets.find(sheet => sheet.id === cell.sheetId)!, column = sheet.columns.find(column => column.id === cell.columnId)!, index = plans.get(sheet.id)!.retainColumns.indexOf(cell.columnId);
        return { partPath: sheet.partPath, sheetId: sheet.id, row: cell.row, columnId: cell.columnId, sourceColumnIndex: column.index, sourceCellHash: hashData(cell), disposition: index < 0 ? 'removed' as const : 'retained' as const, outputColumnIndex: index < 0 ? null : index + 1 };
      }), limitations: [...observation.limitations],
    });
  } });
}
