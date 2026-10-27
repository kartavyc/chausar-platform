// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): reading the text of a Word document and the cells of an
// Excel workbook, for a manuscript to narrate (5Q), an issuer's RFP workbook (5O) or a CV (5I). Text only: no macro,
// formula, link or picture is followed or run; a formula cell gives the value Excel kept with it. The zip reader's
// limits hold (zip.ts), and a part that is missing or not what the format says refuses as OOXML_UNREADABLE. What a file
// says is the client's words: callers screen it as untrusted before an agent reads it. Written for Chausar from the
// published Office Open XML format (ECMA-376); nothing here is learned from an outside source.
import { ChausarError } from '../../../../contracts.ts';
import { xmlUnescape } from './xml.ts';
import { unzip, type ZipEntry } from './zip.ts';

/** The most a sheet is read to: rows, columns, and cells counted as laid out (empty ones before a filled one count). */
const MAX_ROWS = 100_000, MAX_COLUMNS = 1_000, MAX_CELLS = 200_000;
const UNREADABLE = 'Chausar could not read this file as a Word or Excel document. Save it again from Word or Excel and add it once more.';

function unreadable(): never {
  throw new ChausarError('OOXML_UNREADABLE', UNREADABLE);
}

function part(entries: readonly ZipEntry[], name: string, required = true): string | null {
  const found = entries.find(entry => entry.name === name);
  if (!found) return required ? unreadable() : null;
  return Buffer.from(found.bytes).toString('utf8');
}

/** An attribute's value on one start tag, unescaped, or null. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag);
  return match ? xmlUnescape(match[1]) : null;
}

/**
 * The paragraphs of a .docx, in order, as text: a break or a tab inside a paragraph is a new line or a tab. Tables'
 * paragraphs come in reading order with the rest. Headers, footers, comments and pictures are not read.
 */
export function readDocx(bytes: Uint8Array): { paragraphs: string[] } {
  const document = part(unzip(bytes), 'word/document.xml')!;
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(document);
  if (!body) unreadable();
  const paragraphs: string[] = [];
  for (const match of body[1].matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    let text = '';
    for (const piece of (match[1] ?? '').matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\b[^>]*\/>|<w:(br|cr)\b[^>]*\/>|<w:tab\b[^>]*\/>/g)) {
      if (piece[1] !== undefined) text += xmlUnescape(piece[1]);
      else if (piece[2]) text += '\n';
      else if (piece[0].startsWith('<w:tab')) text += '\t';
    }
    paragraphs.push(text);
  }
  return { paragraphs };
}

/** The zero-based column of a cell reference ('C3' is 2), or null. */
function columnOf(ref: string | null): number | null {
  const match = ref ? /^([A-Z]{1,3})\d+$/.exec(ref) : null;
  if (!match) return null;
  return [...match[1]].reduce((sum, ch) => sum * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

/** The text of a shared string or an inline string: every t inside it, rich runs joined. */
function stringText(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => xmlUnescape(match[1])).join('');
}

/** The target part of a relationship, as a path inside the zip. */
function targetPath(target: string, base: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

/**
 * Every sheet of an .xlsx, in the workbook's order, as rows of text: shared and inline strings as written, numbers
 * as Excel stored them, TRUE or FALSE, a formula's kept value (never the formula), '' for an empty cell. Row and
 * column gaps are kept, so a cell is where Excel shows it; trailing empty cells are left off.
 */
export function readXlsx(bytes: Uint8Array): { sheets: { name: string; rows: string[][] }[] } {
  const entries = unzip(bytes);
  const workbook = part(entries, 'xl/workbook.xml')!;
  const rels = part(entries, 'xl/_rels/workbook.xml.rels')!;
  const shared = part(entries, 'xl/sharedStrings.xml', false);
  const strings = shared ? [...shared.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => stringText(match[1])) : [];
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attribute(match[0], 'Id'), target = attribute(match[0], 'Target');
    if (id && target) targets.set(id, targetPath(target, 'xl'));
  }
  const sheets: { name: string; rows: string[][] }[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attribute(match[0], 'name'), id = attribute(match[0], 'r:id');
    const path = id ? targets.get(id) : undefined;
    if (name === null || !path) unreadable();
    const xml = part(entries, path)!;
    const rows: string[][] = [];
    let cellsLaidOut = 0;
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const number = Number(attribute(row[0], 'r') ?? rows.length + 1);
      if (!Number.isInteger(number) || number < 1 || number > MAX_ROWS) unreadable();
      while (rows.length < number - 1) rows.push([]);
      const cells: string[] = [];
      for (const found of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${found[1]}>`;
        const column = columnOf(attribute(tag, 'r')) ?? cells.length;
        if (column >= MAX_COLUMNS) unreadable();
        const type = attribute(tag, 't');
        const inner = found[2] ?? '';
        const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let text = '';
        if (type === 'inlineStr') text = stringText(inner);
        else if (type === 's') text = value !== undefined ? strings[Number(value)] ?? '' : '';
        else if (type === 'b') text = value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : '';
        else if (value !== undefined) text = xmlUnescape(value);
        while (cells.length < column) cells.push('');
        cells[column] = text;
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      cellsLaidOut += cells.length + Math.max(0, number - rows.length);
      if (cellsLaidOut > MAX_CELLS) unreadable();
      rows[number - 1] = cells;
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) unreadable();
  return { sheets };
}
