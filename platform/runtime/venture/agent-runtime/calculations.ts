import { check } from '../../contracts.ts';
import type { UploadRecord } from '../contracts.ts';
import type { JobCalculation } from './job-tools.ts';
import { tablesOfFile } from '../delivery/harness/files.ts';
import { sumRows, totalsBy, type WorkEnv } from '../delivery/harness/work.ts';

const text = { type: 'string', minLength: 1, maxLength: 200 };
const schema = (group: boolean) => ({ type: 'object', additionalProperties: false,
  properties: { fileId: text, sheetId: text, amountColumn: text, ...(group ? { groupColumn: text } : {}) },
  required: ['fileId', 'amountColumn', ...(group ? ['groupColumn'] : [])] });
export const JOB_CALCULATIONS: JobCalculation[] = [
  { name: 'order_price', description: 'The current code-computed order price. Arguments: {}.', inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] } },
  { name: 'sum_rows', description: 'Sum source amounts with BigInt. Arguments: fileId, amountColumn; sheetId when a workbook has more than one sheet.', inputSchema: schema(false) },
  { name: 'totals_by', description: 'Sum source amounts by a source label column. Arguments: fileId, amountColumn, groupColumn; sheetId for a workbook with more than one sheet.', inputSchema: schema(true) },
];
export function calculateSourceRows(operation: string, args: Record<string, unknown>, files: UploadRecord[], env: WorkEnv) {
  const file = files.find(item => item.id === args.fileId);
  check(file, 'JOB_FILE_FORBIDDEN', 'This file is not attached to this order.');
  check(file.format === 'csv' || file.format === 'xlsx', 'INVALID_JOB_FILE', 'Choose a spreadsheet or CSV attached to this order.');
  const tables = tablesOfFile(file);
  const table = args.sheetId ? tables.find(item => item.id === args.sheetId) : tables.length === 1 ? tables[0] : null;
  check(table, 'INVALID_JOB_FILE', 'Choose the exact sheet from this attached workbook.');
  check(operation === 'sum_rows' || operation === 'totals_by', 'UNKNOWN_CALCULATION', 'Choose an available calculation.');
  return operation === 'sum_rows' ? sumRows(env, table, args.amountColumn as string, null)
    : totalsBy(env, table, args.amountColumn as string, table, args.groupColumn as string);
}
