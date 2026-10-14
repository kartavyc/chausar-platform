import { check } from '../contracts.ts';
import { parseExactJson } from '../adapters/accounting/common.ts';
import { cellsOf, gridFromRows, locateTable, parseDelimited, type Delimiter, type Grid } from './tabular.ts';
import type { Decoder, DecoderInput, SourceRecipe } from './recipe.ts';
import type { DecodedTable, RawRow } from './types.ts';

/** The header row is found from the recipe's own required headings, so title lines above it are skipped. */
export function headerGroups(recipe: SourceRecipe): readonly (readonly string[])[] {
  return recipe.header ?? Object.values(recipe.fields).filter(spec => spec.required).map(spec => spec.from);
}
export function tableFromGrid(grid: Grid, recipe: SourceRecipe, meta: Record<string, string> = {}): DecodedTable {
  const table = locateTable(grid, headerGroups(recipe));
  const rows: RawRow[] = table.body.map(row => ({ line: row.line, cells: cellsOf(table.headers, row.cells) }));
  return { headers: table.headers, rows, footers: [], declared: null, meta };
}
const delimited = (id: string, delimiter: Delimiter): Decoder => ({
  id, version: '1', accepts: 'text',
  decode(input, recipe) { check(typeof input.text === 'string', 'TEXT_REQUIRED', 'This recipe reads a text export.'); return tableFromGrid(parseDelimited(input.text!, delimiter), recipe, input.meta); },
});
/** Worksheets arrive through the existing values-only XLSX reader as rows of text. */
export const worksheetDecoder: Decoder = {
  id: 'worksheet', version: '1', accepts: 'rows',
  decode(input, recipe) { check(Array.isArray(input.rows), 'ROWS_REQUIRED', 'This recipe reads a worksheet.'); return tableFromGrid(gridFromRows(input.rows!), recipe, input.meta); },
};

/** Flatten one JSON object to dotted keys. Numbers keep their source spelling (parseExactJson). */
export function flatten(value: unknown, prefix = '', out: Record<string, string> = {}, depth = 0): Record<string, string> {
  check(depth <= 8, 'SOURCE_STRUCTURE_LIMIT', 'The source nests too deeply.');
  if (value === null || value === undefined) { if (prefix) out[prefix] = ''; return out; }
  if (Array.isArray(value)) { if (prefix) out[`${prefix}.length`] = String(value.length); value.slice(0, 50).forEach((item, i) => flatten(item, `${prefix}${prefix ? '.' : ''}${i}`, out, depth + 1)); return out; }
  if (typeof value === 'object') { for (const [key, item] of Object.entries(value as Record<string, unknown>)) flatten(item, `${prefix}${prefix ? '.' : ''}${key}`, out, depth + 1); return out; }
  out[prefix] = String(value); return out;
}
export function walk(value: unknown, path: readonly string[]): unknown[] {
  let current: unknown[] = [value];
  for (const step of path) {
    current = current.flatMap(item => step === '*' ? (Array.isArray(item) ? item : []) : item && typeof item === 'object' && !Array.isArray(item) && Object.hasOwn(item, step) ? [(item as any)[step]] : []);
  }
  return current.flatMap(item => Array.isArray(item) ? item : [item]);
}
export function tableFromRecords(records: readonly unknown[], meta: Record<string, string> = {}): DecodedTable {
  check(records.length <= 50_000, 'ROW_LIMIT', 'The source has more records than one import accepts.');
  const rows: RawRow[] = [], headers: string[] = [], seen = new Set<string>();
  records.forEach((record, index) => {
    check(record !== null && typeof record === 'object' && !Array.isArray(record), 'SOURCE_RECORD_INVALID', 'Each source record must be an object.');
    const cells = flatten(record);
    for (const key of Object.keys(cells)) if (!seen.has(key)) { seen.add(key); headers.push(key); }
    rows.push({ line: index + 1, cells });
  });
  return { headers, rows, footers: [], declared: null, meta };
}
export function parseJson(text: string): unknown {
  try { return parseExactJson(text); }
  catch (error) { const code = (error as any)?.code; check(code !== 'ACCOUNTING_JSON_INVALID', 'SOURCE_CUT_SHORT', 'The file is not complete JSON. It looks cut short.'); throw error; }
}
export const jsonRecordsDecoder: Decoder = {
  id: 'json-records', version: '1', accepts: 'text',
  decode(input, recipe) {
    check(typeof input.text === 'string' && input.text.length <= 20 * 1024 * 1024, 'TEXT_REQUIRED', 'This recipe reads a JSON export.');
    return tableFromRecords(walk(parseJson(input.text!), recipe.records ?? []), input.meta);
  },
};
/** Records already fetched by a read adapter. The adapter's declared totals arrive in meta. */
export const apiRecordsDecoder: Decoder = {
  id: 'api-records', version: '1', accepts: 'records',
  decode(input: DecoderInput) {
    check(Array.isArray(input.records), 'RECORDS_REQUIRED', 'This recipe reads records from a connected system.');
    const table = tableFromRecords(input.records!, input.meta);
    const meta = input.meta ?? {};
    if (meta.declaredRowCount !== undefined || meta.declaredAmount !== undefined)
      table.declared = { rowCount: meta.declaredRowCount ? Number(meta.declaredRowCount) : null, amount: meta.declaredAmount || null,
        amountUnit: meta.declaredAmountUnit === 'minor' ? 'minor' : 'major', reference: meta.declaredReference || 'source-declared' };
    return table;
  },
};
export const BUILT_IN_DECODERS: readonly Decoder[] = [
  delimited('csv', ','), delimited('semicolon', ';'), delimited('tsv', '\t'), delimited('pipe', '|'), delimited('caret', '^'),
  worksheetDecoder, jsonRecordsDecoder, apiRecordsDecoder,
];
