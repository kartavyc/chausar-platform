/** The plain-database read mapping, built from catalogue names only (never SQL text). */
import type { DbTable } from './contract.ts';

export const ENGINES = ['postgres', 'mysql', 'sqlite'] as const;
export type Engine = typeof ENGINES[number];
export const OPTIONAL = ['customerId', 'invoiceId', 'description'] as const;
export const DATE_FORMATS = ['ISO', 'ISO-DATETIME', 'YMD8', 'EPOCH-S-IST'] as const;
export type DateFormat = typeof DATE_FORMATS[number];
export type Measure = 'money' | 'count';
export type MoneyUnit = 'major' | 'minor';

/** "source word = kind" lines to a word map. A line without "=" is left out. */
export function wordLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const at = raw.indexOf('=');
    if (at < 0) continue;
    const word = raw.slice(0, at).trim(), meaning = raw.slice(at + 1).trim();
    if (meaning) out[word] = meaning;
  }
  return out;
}

export interface MappingForm {
  engine: Engine; table: DbTable; columns: Record<string, string>; measure: Measure; moneyUnit: MoneyUnit; currency: string; countUnit: string;
  constantKind: string; kindValues: string; statusValues: string; dateFormat: DateFormat; from: string; to: string;
}
/** The mapping exactly as `validateMapping` in platform/runtime/connectors-ext/plain-db/sql.ts takes it. Names only, never SQL. */
export function buildMapping(form: MappingForm): Record<string, unknown> | null {
  const c = form.columns;
  if (!c['id'] || !c['date']) return null;
  if (form.measure === 'money' && !c['amount']) return null;
  if (form.measure === 'count' && !c['quantity']) return null;
  const columns: Record<string, string> = { id: c['id'], date: c['date'] };
  if (form.measure === 'money') columns['amount'] = c['amount']!;
  else columns['quantity'] = c['quantity']!;
  if (form.measure === 'money' && c['currency']) columns['currency'] = c['currency'];
  if (c['kind']) columns['kind'] = c['kind'];
  if (c['status']) columns['status'] = c['status'];
  for (const role of OPTIONAL) if (c[role]) columns[role] = c[role]!;
  const mapping: Record<string, unknown> = {
    engine: form.engine,
    table: form.engine === 'postgres' && form.table.schema ? { schema: form.table.schema, name: form.table.name } : { name: form.table.name },
    columns, measure: form.measure, moneyUnit: form.measure === 'money' ? form.moneyUnit : 'minor', dateFormat: form.dateFormat,
  };
  if (form.measure === 'money' && !c['currency']) { if (!/^[A-Z]{3}$/.test(form.currency.trim())) return null; mapping['currency'] = form.currency.trim(); }
  if (form.measure === 'count' && form.countUnit.trim()) mapping['countUnit'] = form.countUnit.trim();
  if (c['kind']) mapping['kindValues'] = wordLines(form.kindValues);
  else { if (!form.constantKind.trim()) return null; mapping['constantKind'] = form.constantKind.trim(); }
  if (c['status']) mapping['statusValues'] = wordLines(form.statusValues);
  if (form.from || form.to) { if (!form.from || !form.to || form.from > form.to) return null; mapping['period'] = { from: form.from, to: form.to }; }
  return mapping;
}
