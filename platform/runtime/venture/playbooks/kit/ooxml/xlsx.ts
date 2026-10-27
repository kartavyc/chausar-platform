// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): an Excel workbook (.xlsx) made by code, for figures a client
// or an accountant opens in a spreadsheet. The rules that keep it honest and safe (W4 P12's export hygiene, here for
// XLSX): text is always an inline string, so a cell that starts with =, +, - or @ is shown as typed and never runs as a
// formula; money is text with its decimals written out from BigInt minor units (1234.50), never a float that Excel
// could round; a count is a whole number. Every value is XML-escaped. The same input gives the same bytes. Written for
// Chausar from the published Office Open XML format (ECMA-376); nothing here is learned from an outside source.
import { ChausarError } from '../../../../contracts.ts';
import { XML_HEAD, xmlText } from './xml.ts';
import { zip } from './zip.ts';

/**
 * One cell: text (always shown as typed), money in minor units (digits after the point, 2 unless given), or a count
 * (a whole number). null is an empty cell.
 */
export type XlsxCell = string | null | { money: string; digits?: number } | { count: string };
export type XlsxSheet = { name: string; rows: readonly (readonly XlsxCell[])[] };

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
/** Excel's own limits on a sheet's name, and the most rows and columns one sheet here takes. */
const SHEET_NAME = /^[^\[\]:*?/\\]{1,31}$/;
const MAX_ROWS = 100_000, MAX_COLUMNS = 200;

function invalid(message: string): never {
  throw new ChausarError('OOXML_INVALID', message);
}

/** The column letters of a zero-based column: 0 is A, 26 is AA. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Minor units as decimal text, by BigInt: '123450' with 2 digits is '1234.50', '-5' is '-0.05'. */
export function minorText(minor: string, digits = 2): string {
  if (!/^-?\d{1,30}$/.test(minor)) invalid('A money cell needs whole minor units, such as 123450 for 1234.50.');
  if (!Number.isInteger(digits) || digits < 0 || digits > 4) invalid('A money cell has between 0 and 4 digits after the point.');
  const value = BigInt(minor);
  const negative = value < 0n;
  const whole = (negative ? -value : value).toString().padStart(digits + 1, '0');
  const text = digits ? `${whole.slice(0, -digits)}.${whole.slice(-digits)}` : whole;
  return negative ? `-${text}` : text;
}

/** The most characters Excel keeps in one cell. */
const MAX_CELL_CHARS = 32_767;

function inline(ref: string, text: string): string {
  if (text.length > MAX_CELL_CHARS) invalid('A cell holds at most 32,767 characters, as Excel does.');
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function cell(ref: string, value: XlsxCell): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return inline(ref, value);
  if ('money' in value) return inline(ref, minorText(value.money, value.digits ?? 2));
  if ('count' in value && typeof value.count === 'string' && /^-?\d{1,15}$/.test(value.count)) return `<c r="${ref}"><v>${BigInt(value.count).toString()}</v></c>`;
  return invalid('A count is a whole number.');
}

function sheetXml(sheet: XlsxSheet): string {
  if (sheet.rows.length > MAX_ROWS) invalid('A sheet takes at most 100,000 rows.');
  const rows = sheet.rows.map((row, r) => {
    if (row.length > MAX_COLUMNS) invalid('A sheet takes at most 200 columns.');
    const cells = row.map((value, c) => cell(`${columnName(c)}${r + 1}`, value)).join('');
    return cells ? `<row r="${r + 1}">${cells}</row>` : '';
  }).join('');
  return `${XML_HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="${MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>`
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/**
 * The .xlsx bytes for these sheets, in order. Refuses (OOXML_INVALID) no sheet, a name Excel refuses (empty, over 31
 * characters, any of [ ] : * ? / \), two sheets whose names differ only in case, a money cell that is not whole minor
 * units, a count that is not a whole number, and a sheet over the size limits.
 */
export function writeXlsx(input: { sheets: readonly XlsxSheet[] }): Uint8Array {
  const sheets = input?.sheets ?? [];
  if (!sheets.length) invalid('A workbook needs at least one sheet.');
  const seen = new Set<string>();
  for (const sheet of sheets) {
    if (typeof sheet.name !== 'string' || !SHEET_NAME.test(sheet.name) || sheet.name.startsWith("'") || sheet.name.endsWith("'")) invalid('A sheet name has 1 to 31 characters and none of [ ] : * ? / \\.');
    const key = sheet.name.toLowerCase();
    if (seen.has(key)) invalid('Two sheets cannot have the same name.');
    seen.add(key);
  }
  const parts = sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, xml: sheetXml(sheet) }));
  const types = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + parts.map(part => `<Override PartName="/${part.name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>';
  const rels = `${XML_HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>`
    + sheets.map((sheet, index) => `<sheet name="${xmlText(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('') + '</sheets></workbook>';
  const workbookRels = `${XML_HEAD}<Relationships xmlns="${PKG_REL}">`
    + parts.map((part, index) => `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${parts.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`;
  const utf8 = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));
  return zip([
    { name: '[Content_Types].xml', bytes: utf8(types) },
    { name: '_rels/.rels', bytes: utf8(rels) },
    { name: 'xl/workbook.xml', bytes: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: utf8(workbookRels) },
    { name: 'xl/styles.xml', bytes: utf8(STYLES) },
    ...parts.map(part => ({ name: part.name, bytes: utf8(part.xml) })),
  ]);
}
