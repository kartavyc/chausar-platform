import { check } from '../contracts.ts';

/** A delimited or worksheet file as positioned cells. Line numbers are the source's own (1-based). */
export type GridLine = { line: number; cells: string[] };
export type Grid = GridLine[];
export type Delimiter = ',' | ';' | '\t' | '|' | '^';

export const FILE_LIMIT_BYTES = 20 * 1024 * 1024;
export const ROW_LIMIT = 50_000;
/** Header comparison ignores case, width forms and repeated spaces; it never fuzzes spelling. */
export const norm = (value: string): string => value.normalize('NFKC').replace(/[ \s]+/g, ' ').trim().toLowerCase();

/** RFC 4180 style parser with positions. A quote left open at the end means the file was cut short. */
export function parseDelimited(input: string, delimiter: Delimiter): Grid {
  check(typeof input === 'string' && input.length <= FILE_LIMIT_BYTES, 'FILE_LIMIT', 'Import a file smaller than twenty megabytes.');
  const text = input.replace(/^﻿/, '');
  const grid: Grid = []; let cells: string[] = [], cell = '', quoted = false, afterQuote = false, line = 1, start = 1;
  const endCell = () => { cells.push(cell); cell = ''; afterQuote = false; };
  const endLine = () => {
    endCell();
    if (cells.some(value => value.trim().length > 0)) { grid.push({ line: start, cells }); check(grid.length <= ROW_LIMIT, 'ROW_LIMIT', 'The file has more rows than one import accepts.'); }
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; afterQuote = true; } }
      else { if (c === '\n') line++; cell += c; }
      continue;
    }
    if (afterQuote && c !== delimiter && c !== '\n' && c !== '\r') {
      check(c === ' ' || c === '\t', 'INVALID_DELIMITED_FILE', 'Unexpected text after a quoted cell.');
      continue;
    }
    if (c === '"' && cell.trim().length === 0) { cell = ''; quoted = true; }
    else if (c === delimiter) endCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endLine(); line++; start = line; }
    else cell += c;
  }
  check(!quoted, 'SOURCE_CUT_SHORT', 'A quoted cell was left open at the end of the file. The file looks cut short.');
  if (cell.length || cells.length || afterQuote) endLine();
  return grid;
}

/** Worksheet rows from the existing values-only XLSX reader. */
export function gridFromRows(rows: readonly (readonly string[])[]): Grid {
  check(Array.isArray(rows) && rows.length <= ROW_LIMIT, 'ROW_LIMIT', 'The sheet has more rows than one import accepts.');
  return rows.map((cells, index) => ({ line: index + 1, cells: cells.map((value: string) => String(value ?? '')) })).filter(row => row.cells.some((value: string) => value.trim().length > 0));
}

export type LocatedTable = { headerLine: number; headers: string[]; body: GridLine[]; before: GridLine[] };
/**
 * Find the header row. With `requires`, the first line holding one alias from every group is the
 * header, so bank and marketplace exports with title lines above the table still parse.
 */
export function locateTable(grid: Grid, requires: readonly (readonly string[])[] = []): LocatedTable {
  check(grid.length > 0, 'EMPTY_FILE', 'The file has no rows.');
  let index = 0;
  if (requires.length) {
    const wanted = requires.map(group => group.map(norm));
    index = grid.findIndex(row => { const cells = new Set(row.cells.map(norm)); return wanted.every(group => group.some(alias => cells.has(alias))); });
    check(index >= 0 && index < 200, 'HEADER_NOT_FOUND', 'The column headings this recipe expects were not found. The export may be from another report or layout.');
  }
  const header = grid[index];
  let width = header.cells.length;
  while (width > 0 && header.cells[width - 1].trim() === '') width--;
  const headers = header.cells.slice(0, width).map(value => value.normalize('NFKC').replace(/[ \s]+/g, ' ').trim());
  check(headers.length > 0 && headers.every(name => name.length > 0 && name.length <= 200 && !['__proto__', 'prototype', 'constructor'].includes(name)), 'INVALID_HEADERS', 'Column headings must be nonempty data names.');
  check(new Set(headers.map(norm)).size === headers.length, 'DUPLICATE_HEADERS', 'Two columns have the same heading. Rename one in the export before importing.');
  const body = grid.slice(index + 1).map(row => {
    check(row.cells.slice(width).every(value => value.trim() === ''), 'ROW_WIDTH', 'A row has more cells than the header.');
    return { line: row.line, cells: Array.from({ length: width }, (_, i) => row.cells[i] ?? '') };
  });
  return { headerLine: header.line, headers, body, before: grid.slice(0, index) };
}

export const cellsOf = (headers: readonly string[], cells: readonly string[]): Record<string, string> =>
  Object.fromEntries(headers.map((header, i) => [header, (cells[i] ?? '').trim()]));
