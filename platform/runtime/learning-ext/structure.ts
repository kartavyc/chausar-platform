import { check } from '../contracts.ts';
import { canonical } from '../actions.ts';
import {
  BOXES, EVENT_LISTS, EVENT_VOCABULARY, FIELD_NAMES, FIELD_TYPES, LEARNING_SCHEMA,
  type Box, type FieldName, type FieldType, type StructuralBatch, type StructuralEvent,
} from './vocabulary.ts';

const scalarKeys = Object.keys(EVENT_VOCABULARY) as (keyof typeof EVENT_VOCABULARY)[];
const listKeys = Object.keys(EVENT_LISTS) as (keyof typeof EVENT_LISTS)[];
const eventKeys = new Set<string>([...scalarKeys, ...listKeys, 'fields']);

/** Canonical source words (camel case, snake case, spaced) to the shared field vocabulary. */
export function canonicalFieldName(name: unknown): FieldName | undefined {
  if (typeof name !== 'string' || name.length > 80) return undefined;
  const token = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase().replace(/-minor$/, '');
  const aliases: Record<string, FieldName> = { 'valid-from': 'date', 'entity-id': 'reference', 'amount-minor': 'amount', 'tax-minor': 'tax' };
  const value = aliases[token] ?? token;
  return (FIELD_NAMES as readonly string[]).includes(value) ? value as FieldName : undefined;
}
export function canonicalFieldType(type: unknown): FieldType | undefined {
  const value = type === 'money' ? 'decimal' : type;
  return (FIELD_TYPES as readonly unknown[]).includes(value) ? value as FieldType : undefined;
}

/**
 * Build one shared event from typed input. Scalar tokens must come from the vocabulary or the
 * event is refused; field names outside the vocabulary are dropped, because they are source words.
 */
export function structuralEvent(input: unknown): StructuralEvent {
  check(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_LEARNING_EVENT', 'A learning event is a typed record.');
  const record = input as Record<string, unknown>;
  check(Object.keys(record).every(key => eventKeys.has(key)), 'INVALID_LEARNING_EVENT', 'A learning event holds only registered structure.');
  const event: Record<string, unknown> = {};
  for (const key of scalarKeys) {
    if (record[key] === undefined) continue;
    check((EVENT_VOCABULARY[key] as readonly unknown[]).includes(record[key]), 'INVALID_LEARNING_EVENT', 'A learning event uses only registered words.');
    event[key] = record[key];
  }
  check(event.kind && event.choice, 'INVALID_LEARNING_EVENT', 'A learning event names its kind and the choice made.');
  for (const key of listKeys) {
    if (record[key] === undefined) continue;
    const list = record[key];
    check(Array.isArray(list) && list.length <= 50 && list.every(item => (EVENT_LISTS[key] as readonly unknown[]).includes(item)), 'INVALID_LEARNING_EVENT', 'A learning event uses only registered words.');
    // An empty list says nothing: it is left out, so one shape has exactly one form.
    if ((list as string[]).length) event[key] = [...new Set(list as string[])].sort();
  }
  if (record.fields !== undefined) {
    check(Array.isArray(record.fields) && record.fields.length <= 1000, 'INVALID_LEARNING_EVENT', 'Learning structures have at most 1,000 fields.');
    const pairs = new Map<string, [FieldName, FieldType]>();
    for (const item of record.fields) {
      const [name, type] = Array.isArray(item) ? item : [(item as any)?.name, (item as any)?.type];
      const field = canonicalFieldName(name), kind = canonicalFieldType(type);
      if (field && kind) pairs.set(`${field}:${kind}`, [field, kind]);
    }
    if (pairs.size) event.fields = [...pairs.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  }
  return event as StructuralEvent;
}

/** Patterns that must never appear in anything that leaves the machine. */
export const VALUE_PATTERNS: { code: string; pattern: RegExp }[] = [
  { code: 'GSTIN', pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i },
  { code: 'PAN', pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/i },
  { code: 'IFSC', pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/i },
  { code: 'UPI', pattern: /\b[\w.-]{2,}@(?:ok)?[a-z]{2,}\b/i },
  { code: 'MAIL', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
  { code: 'PHONE', pattern: /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/ },
  { code: 'DIGITS', pattern: /\d/ },
];

/** Scan text line by line; each hit names the line and the kind of value found, never the value. */
export function scanText(text: string, patterns = VALUE_PATTERNS): { line: number; code: string }[] {
  const hits: { line: number; code: string }[] = [];
  text.split(/\r?\n/).forEach((line, index) => { for (const { code, pattern } of patterns) if (pattern.test(line)) hits.push({ line: index + 1, code }); });
  return hits;
}

/** The exact bytes of a batch: canonical JSON, one event per line so a blocked line can be shown. */
export function batchBytes(batch: StructuralBatch): string {
  return [`{"schema":${JSON.stringify(batch.schema)},"boxes":${canonical(batch.boxes)},"events":[`,
    ...batch.events.map((event, index) => `${canonical(event)}${index < batch.events.length - 1 ? ',' : ''}`), ']}'].join('\n');
}

/** Re-validate a batch exactly as the receiving service does. */
export function assertStructuralBatch(value: unknown): StructuralBatch {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_BATCH', 'A batch is a typed record.');
  const batch = value as Record<string, unknown>;
  check(Object.keys(batch).sort().join(',') === 'boxes,events,schema' && batch.schema === LEARNING_SCHEMA, 'INVALID_BATCH', 'Use the structure-only batch schema.');
  check(Array.isArray(batch.boxes) && batch.boxes.length > 0 && batch.boxes.every(box => (BOXES as readonly unknown[]).includes(box)) && new Set(batch.boxes).size === batch.boxes.length, 'INVALID_BATCH', 'Name the sharing boxes.');
  check(Array.isArray(batch.events) && batch.events.length > 0 && batch.events.length <= 5000, 'INVALID_BATCH', 'A batch holds 1 to 5,000 events.');
  const events = batch.events.map(event => {
    const clean = structuralEvent(event);
    check(canonical(clean) === canonical(event), 'INVALID_BATCH', 'A batch event holds something outside the structure vocabulary.');
    return clean;
  });
  return { schema: LEARNING_SCHEMA, boxes: batch.boxes as Box[], events };
}
