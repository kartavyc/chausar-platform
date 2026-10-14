/**
 * Batch validation for the learning intake service.
 *
 * A self-contained re-implementation of the desktop's batch check: the service imports nothing
 * from the desktop platform. A batch is accepted only when every event is built from vocabulary
 * tokens, and only after a scan of the raw request text of its events finds no value at all.
 */
import {
  BOXES, EVENT_LISTS, EVENT_VOCABULARY, FIELD_NAMES, FIELD_TYPES, LEARNING_SCHEMA, OPEN_BOXES,
  type Box, type StructuralBatch, type StructuralEvent,
} from './vocabulary.ts';

export class IntakeError extends Error {
  readonly code: string;
  readonly hits?: ValueHit[];
  constructor(code: string, hits?: ValueHit[]) { super(code); this.code = code; if (hits) this.hits = hits; }
}
export function check(condition: unknown, code: string): asserts condition { if (!condition) throw new IntakeError(code); }

export type ValueHit = { line: number; code: string };

/** Canonical JSON: sorted keys, no whitespace. The body digest is taken over this form. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isFinite(value), 'INVALID_BATCH'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  check(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_BATCH');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/** Patterns that must never arrive. The same list the desktop scans with before sending. */
export const VALUE_PATTERNS: { code: string; pattern: RegExp }[] = [
  { code: 'GSTIN', pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i },
  { code: 'PAN', pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/i },
  { code: 'IFSC', pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/i },
  { code: 'UPI', pattern: /\b[\w.-]{2,}@(?:ok)?[a-z]{2,}\b/i },
  { code: 'MAIL', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
  { code: 'PHONE', pattern: /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/ },
  { code: 'DIGITS', pattern: /\d/ },
];

/**
 * Find, in raw JSON text that already parsed, the offsets of the top-level `batch` object and of
 * its `events` array (start at the bracket, end just after the closing bracket).
 */
export function eventSpan(text: string): { batchStart: number; start: number; end: number } | undefined {
  const stack: { type: '{' | '['; key: string | null }[] = [];
  let key: string | null = null, batchStart = -1, start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      let k = j + 1;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      if (text[k] === ':') { try { key = JSON.parse(text.slice(i, j + 1)) as string; } catch { key = null; } }
      i = j;
    } else if (char === '{' || char === '[') {
      const parent = stack[stack.length - 1];
      const under = parent?.type === '{' ? key : null;
      if (stack.length === 1 && char === '{' && under === 'batch') batchStart = i;
      if (stack.length === 2 && char === '[' && under === 'events' && stack[1].key === 'batch' && stack[1].type === '{') start = i;
      stack.push({ type: char, key: under });
      key = null;
    } else if (char === '}' || char === ']') {
      stack.pop();
      if (start >= 0 && stack.length === 2 && char === ']') return { batchStart, start, end: i + 1 };
    }
  }
  return undefined;
}

/**
 * Scan the raw text of the events. Line numbers count from the first line of the batch, so for a
 * body that embeds the desktop's batch bytes they name the same lines the desktop shows. A hit
 * names the line and the kind of value, never the value.
 */
export function scanEvents(text: string): ValueHit[] {
  const span = eventSpan(text);
  check(span && span.batchStart >= 0, 'INVALID_BATCH');
  const firstLine = lineAt(text, span.batchStart);
  const hits: ValueHit[] = [];
  let offset = 0;
  text.split('\n').forEach((raw, index) => {
    const lineStart = offset, lineEnd = offset + raw.length;
    offset = lineEnd + 1;
    const from = Math.max(lineStart, span.start + 1), to = Math.min(lineEnd, span.end - 1);
    if (from >= to) return;
    const part = text.slice(from, to).replace(/\r$/, '');
    for (const { code, pattern } of VALUE_PATTERNS) if (pattern.test(part)) hits.push({ line: index + 1 - firstLine + 1, code });
  });
  return hits;
}
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

const scalarKeys = Object.keys(EVENT_VOCABULARY) as (keyof typeof EVENT_VOCABULARY)[];
const listKeys = Object.keys(EVENT_LISTS) as (keyof typeof EVENT_LISTS)[];
const eventKeys = new Set<string>([...scalarKeys, ...listKeys, 'fields']);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const within = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value);

/** One event: only vocabulary keys and tokens; lists and fields sorted and unique, as the desktop builds them. */
export function validateEvent(value: unknown): StructuralEvent {
  check(isRecord(value) && Object.keys(value).every(key => eventKeys.has(key)), 'INVALID_BATCH');
  for (const key of scalarKeys) if (value[key] !== undefined) check(within(EVENT_VOCABULARY[key], value[key]), 'INVALID_BATCH');
  check(value.kind !== undefined && value.choice !== undefined, 'INVALID_BATCH');
  for (const key of listKeys) {
    const list = value[key];
    if (list === undefined) continue;
    check(Array.isArray(list) && list.length <= 50 && list.every(item => within(EVENT_LISTS[key], item)), 'INVALID_BATCH');
    check(list.every((item, index) => index === 0 || (list[index - 1] as string) < (item as string)), 'INVALID_BATCH');
  }
  const fields = value.fields;
  if (fields !== undefined) {
    check(Array.isArray(fields) && fields.length <= 1000, 'INVALID_BATCH');
    check(fields.every(pair => Array.isArray(pair) && pair.length === 2 && within(FIELD_NAMES, pair[0]) && within(FIELD_TYPES, pair[1])), 'INVALID_BATCH');
    const pairs = fields as [string, string][];
    check(pairs.every((pair, index) => index === 0 || (pairs[index - 1][0].localeCompare(pair[0]) || pairs[index - 1][1].localeCompare(pair[1])) < 0), 'INVALID_BATCH');
  }
  return value as StructuralEvent;
}

/** The exact batch schema. Boxes outside the open set are refused with BOX_NOT_OPEN. */
export function validateBatch(value: unknown): StructuralBatch {
  check(isRecord(value) && Object.keys(value).sort().join(',') === 'boxes,events,schema' && value.schema === LEARNING_SCHEMA, 'INVALID_BATCH');
  const { boxes, events } = value;
  check(Array.isArray(boxes) && boxes.length > 0 && boxes.every(box => within(BOXES, box)) && new Set(boxes).size === boxes.length, 'INVALID_BATCH');
  check(boxes.every(box => within(OPEN_BOXES, box)), 'BOX_NOT_OPEN');
  check(Array.isArray(events) && events.length > 0 && events.length <= 5000, 'INVALID_BATCH');
  return { schema: LEARNING_SCHEMA, boxes: boxes as Box[], events: events.map(validateEvent) };
}

/** Public names: 2 to 40 letters, spaces, `.`, `-` or `'`; never a digit or `@`. */
export function validatePublicName(value: unknown): string | null {
  if (value === null) return null;
  // The same rule as the desktop: ASCII letters, spaces and simple punctuation, so a name cannot carry digits, marks or other scripts.
  check(typeof value === 'string' && /^[A-Za-z][A-Za-z .'-]{0,38}[A-Za-z.]$/.test(value), 'INVALID_BATCH');
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * The whole request body: `{ batch, contributor: { publicName } }`. The raw text of the events is
 * scanned before the vocabulary check, so a value is always reported by line as VALUE_FOUND.
 */
export function validateRequest(text: string): { batch: StructuralBatch; publicName: string | null } {
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new IntakeError('INVALID_BATCH'); }
  check(isRecord(body) && Object.keys(body).sort().join(',') === 'batch,contributor', 'INVALID_BATCH');
  check(isRecord(body.contributor) && Object.keys(body.contributor).join(',') === 'publicName', 'INVALID_BATCH');
  const hits = scanEvents(text);
  if (hits.length) throw new IntakeError('VALUE_FOUND', hits);
  const batch = validateBatch(body.batch);
  return { batch, publicName: validatePublicName(body.contributor.publicName) };
}
