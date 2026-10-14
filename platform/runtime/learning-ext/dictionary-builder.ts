/**
 * The builder agent: profile imported columns and propose a first dictionary. It chooses a
 * starter pack by header evidence, adds fields inferred from the columns (safe names and types,
 * never values) and keeps per-field evidence locally. Outside text never becomes code: a
 * model-proposed draft is accepted only as data that compiles.
 */
import { check } from '../contracts.ts';
import { canonical } from '../actions.ts';
import { parseCsv } from '../ingest.ts';
import { validDate } from '../memory.ts';
import { compileDictionary, starterPacks, type DictionaryDraft, type FieldType } from '../ontology.ts';
import type { Confidence } from './vocabulary.ts';

export type ColumnProfile = { header: string; name: string | null; type: FieldType; dateFormat?: 'ISO' | 'DMY' | 'YMD8'; rows: number; filled: number; confidence: Confidence; reasons: string[] };
export type FieldEvidence = { name: string; type: FieldType; header: string; files: number[]; filled: number; rows: number; confidence: Confidence; reasons: string[]; existing: boolean };
export type PackChoice = { pack: string; confidence: Confidence; scores: Record<string, number>; matched: string[] };

const PROFILE_ROWS = 5000;
/** Columns that bind the record identity, kind, date and branch rather than a dictionary field. */
const CORE_HEADERS: Record<string, string> = { id: 'entityId', entityId: 'entityId', kind: 'kind', type: 'kind', date: 'validFrom', validFrom: 'validFrom', branch: 'branch' };
const RESERVED = new Set(['entityId', 'kind', 'validFrom', 'validTo', 'branch', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);
const AMOUNT_WORDS = /(amount|amt|price|total|value|cost|fee|tax|paid|revenue|sales|mrp|discount|shipping|freight|balance|debit|credit|charge|net|gross|subtotal|refund|payout|commission|inr|rupee)/i;
const DATE_WORDS = /(date|day|on|at|period|month|from|to|start|end|due)$/i;
/** Header keywords that point at a starter pack. They are product vocabulary, compared locally only. */
const PACK_WORDS: Record<string, string[]> = {
  ecommerce: ['sku', 'marketplace', 'asin', 'fsn', 'listing', 'awb', 'courier', 'platformfee', 'storefront'],
  services: ['project', 'milestone', 'timesheet', 'hours', 'engagement', 'retainer', 'contract'],
  saas: ['subscription', 'seat', 'plan', 'renewal', 'mrr', 'arr', 'licence', 'license', 'tenant'],
  manufacturing: ['batch', 'rawmaterial', 'bom', 'wip', 'finished', 'scrap', 'waste', 'production', 'workorder'],
  retail: ['outlet', 'store', 'pos', 'counter', 'till', 'cashier', 'shift'],
  distributor: ['distributor', 'territory', 'dealer', 'beat', 'creditdays', 'retailer', 'route', 'salesman'],
};

/** A source header as a safe camelCase identifier, or null when nothing safe is left. */
export function safeFieldName(header: string): string | null {
  const words = header.normalize('NFKD').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return null;
  let name = words.map((word, index) => index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()).join('');
  if (!/^[a-z]/.test(name)) name = `field${name[0].toUpperCase()}${name.slice(1)}`;
  name = name.slice(0, 60);
  return /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(name) ? name : null;
}
const token = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

const calendarDate = (value: string): boolean => validDate(value);
function dateFormatOf(value: string): 'ISO' | 'DMY' | 'YMD8' | undefined {
  if (calendarDate(value)) return 'ISO';
  const dmy = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(value);
  if (dmy && validDate(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`)) return 'DMY';
  if (/^\d{8}$/.test(value) && validDate(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`)) return 'YMD8';
  return undefined;
}

/** Infer a column's type from its non-empty cells. Values are read here and never kept. */
export function profileColumn(header: string, cells: readonly unknown[]): ColumnProfile {
  const values = cells.slice(0, PROFILE_ROWS).map(cell => typeof cell === 'string' ? cell.trim() : '').filter(Boolean);
  const base = { header, name: safeFieldName(header), rows: Math.min(cells.length, PROFILE_ROWS), filled: values.length };
  const share = values.length / Math.max(1, base.rows);
  const sure = (strong: boolean): Confidence => strong && share >= 0.5 ? 'high' : strong ? 'medium' : 'low';
  if (!values.length) return { ...base, type: 'string', confidence: 'low', reasons: ['empty-column'] };
  if (values.every(value => /^(true|false)$/i.test(value))) return { ...base, type: 'boolean', confidence: sure(true), reasons: ['true-false-values'] };
  const formats = new Set(values.map(dateFormatOf));
  if (formats.size === 1 && !formats.has(undefined)) {
    const format = [...formats][0]!;
    if (format !== 'YMD8' || DATE_WORDS.test(header)) return { ...base, type: 'date', dateFormat: format, confidence: sure(true), reasons: [`date-${format.toLowerCase()}`] };
  }
  const amountHeader = AMOUNT_WORDS.test(header);
  const decimal = values.every(value => /^-?(?:₹\s?)?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?$/.test(value));
  if (decimal && amountHeader) return { ...base, type: 'money', confidence: sure(true), reasons: ['decimal-amounts', 'amount-header'] };
  if (values.every(value => /^-?\d{1,15}$/.test(value))) return { ...base, type: 'integer', confidence: sure(!/id$|code$|number$|no$/i.test(header)), reasons: ['whole-numbers'] };
  if (decimal) return { ...base, type: 'string', confidence: 'low', reasons: ['decimal-without-amount-header'] };
  return { ...base, type: 'string', confidence: sure(true), reasons: ['text-values'] };
}

/** Choose a starter pack from header evidence. No evidence keeps the default pack, labelled low confidence. */
export function choosePack(headers: readonly string[]): PackChoice {
  // Short keywords must be a whole header word; longer ones may sit inside a joined header.
  const tokens = headers.map(token), words = headers.map(header => (safeFieldName(header) ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' '));
  const scores: Record<string, number> = {}, matched = new Set<string>();
  for (const [pack, list] of Object.entries(PACK_WORDS)) {
    scores[pack] = 0;
    for (const word of list) if (word.length >= 5 ? tokens.some(item => item.includes(word)) : words.some(item => item.includes(word) || item.includes(`${word}s`))) { scores[pack]++; matched.add(word); }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, runnerUp] = ranked;
  if (!best || best[1] === 0) return { pack: 'ecommerce', confidence: 'low', scores, matched: [] };
  const confidence: Confidence = best[1] >= 2 && best[1] > (runnerUp?.[1] ?? 0) ? 'high' : best[1] > (runnerUp?.[1] ?? 0) ? 'medium' : 'low';
  return { pack: best[0], confidence, scores, matched: [...matched].filter(word => PACK_WORDS[best[0]].includes(word)).sort() };
}

/** Header and column cells of one CSV file, bounded for profiling. */
export function columnsOf(content: string): { headers: string[]; columns: Map<string, unknown[]> } {
  check(typeof content === 'string' && content.length > 0 && Buffer.byteLength(content, 'utf8') <= 5 * 1024 * 1024, 'FILE_LIMIT', 'Profile CSV files of at most five megabytes.');
  const rows = parseCsv(content);
  check(rows.length > 0, 'EMPTY_FILE', 'Each file needs a header row and at least one data row.');
  const headers = Object.keys(rows[0]);
  return { headers, columns: new Map(headers.map(header => [header, rows.slice(0, PROFILE_ROWS).map(row => row[header])])) };
}

/** Field name for a profiled column: money fields carry the minor-unit suffix used across the dictionary. */
export function fieldNameFor(profile: Pick<ColumnProfile, 'name' | 'type'>): string | null {
  if (!profile.name) return null;
  const name = profile.type === 'money' && !/Minor$/.test(profile.name) ? `${profile.name}Minor`.slice(0, 64) : profile.name;
  return RESERVED.has(name) ? null : name;
}

export type BuildResult = { draft: DictionaryDraft; pack: PackChoice; evidence: FieldEvidence[]; skipped: { header: string; reason: string }[] };

/** Profile files and propose a starter pack plus inferred fields. The draft is compiled as a dry run. */
export function buildDraft(files: readonly { content: string }[], label?: string): BuildResult {
  const profiled = files.map(file => columnsOf(file.content));
  const pack = choosePack(profiled.flatMap(file => file.headers));
  const starter = starterPacks.find(item => item.pack === pack.pack)!;
  const draft: DictionaryDraft = structuredClone(starter);
  if (label !== undefined) draft.label = label;
  const evidence = new Map<string, FieldEvidence>(), skipped: { header: string; reason: string }[] = [];
  profiled.forEach((file, index) => {
    for (const header of file.headers) {
      if (Object.hasOwn(CORE_HEADERS, safeFieldName(header) ?? '')) { skipped.push({ header, reason: 'record-identity-column' }); continue; }
      const profile = profileColumn(header, file.columns.get(header) ?? []);
      const name = fieldNameFor(profile);
      if (!name) { skipped.push({ header, reason: 'no-safe-name' }); continue; }
      // An existing pack field keeps its published type; a disagreement lowers confidence.
      const existing = Object.hasOwn(starter.fields, name) || Object.hasOwn(starter.fields, profile.name!);
      const fieldName = Object.hasOwn(starter.fields, profile.name!) ? profile.name! : name;
      const type: FieldType = existing ? starter.fields[fieldName] : profile.type;
      const reasons = [...profile.reasons, ...(existing ? [type === profile.type ? 'matches-pack-field' : 'type-differs-from-pack'] : [])];
      const confidence: Confidence = existing && type !== profile.type ? 'low' : profile.confidence;
      const prior = evidence.get(fieldName);
      if (prior) { prior.files.push(index); prior.filled += profile.filled; prior.rows += profile.rows; if (prior.type !== type) { prior.confidence = 'low'; prior.reasons = [...new Set([...prior.reasons, 'type-differs-between-files'])]; } continue; }
      evidence.set(fieldName, { name: fieldName, type, header, files: [index], filled: profile.filled, rows: profile.rows, confidence, reasons, existing });
    }
  });
  if (evidence.size > 200) check(false, 'TOO_MANY_FIELDS', 'Propose at most 200 new fields at once.');
  for (const item of evidence.values()) if (!item.existing) draft.fields[item.name] = item.type;
  compileDictionary(draft);
  return { draft, pack, evidence: [...evidence.values()].sort((a, b) => a.name.localeCompare(b.name)), skipped };
}

/** Accept a model-proposed draft only as plain data that compiles. */
export function candidateDraft(value: unknown): DictionaryDraft {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_DICTIONARY', 'A proposed dictionary is a typed record.');
  const text = canonical(value);
  check(text.length <= 256 * 1024, 'INVALID_DICTIONARY', 'A proposed dictionary is at most 256 kilobytes.');
  const draft = JSON.parse(text) as DictionaryDraft;
  compileDictionary(draft);
  return draft;
}
