/**
 * The dictionary served to agents in three read-only layers (EvoOntology layering):
 * 1. schema: published fields, definitions and checks;
 * 2. sample content, governed by the trust panel's send level;
 * 3. allowed operations: the published calculation menu, and nothing else.
 * The same layers are engine methods (`dictionary.mcp.*`) and MCP read tools on the existing server.
 */
import { authorize, check, type Context, type Fact, type StateStore } from '../contracts.ts';
import { OntologyService, type Dictionary } from '../ontology.ts';
import type { RegisteredReadTool } from '../mcp.ts';
import { visibleFacts } from '../trust.ts';
import { VALUE_PATTERNS } from './structure.ts';

export const READ_ONLY_STATEMENT = 'This server is read-only. It exposes no writes, no approvals and no arbitrary expressions; numbers come only from the registered calculations, each with its receipt.';
const SAMPLE_LIMIT = 5;
const MASKED = VALUE_PATTERNS.filter(item => ['GSTIN', 'PAN', 'IFSC', 'UPI', 'MAIL', 'PHONE'].includes(item.code));
const CORE_FIELDS: Record<string, string> = { entityId: 'string', kind: 'string', validFrom: 'date', branch: 'string' };

type Absent = { state: 'absent'; reason: string };
const absent = (): Absent => ({ state: 'absent', reason: 'No dictionary is published yet.' });
const published = (store: StateStore, ctx: Context): Dictionary | null => new OntologyService(store).current(ctx);

/** Letters become A or a, digits 9; other characters stay. Long masks are cut, never the value itself. */
export function maskOf(value: string): string {
  const mask = value.replace(/\p{Lu}/gu, 'A').replace(/\p{Ll}|\p{Lo}|\p{Lt}|\p{Lm}/gu, 'a').replace(/\p{Nd}/gu, '9');
  return mask.length > 32 ? `${mask.slice(0, 32)}…` : mask;
}
export function lengthBucket(length: number): string {
  return length <= 4 ? '1-4' : length <= 8 ? '5-8' : length <= 16 ? '9-16' : length <= 32 ? '17-32' : '33+';
}
/** The kind of identifying value a text looks like, if any (GSTIN, PAN, phone, mail and similar). */
export function sensitiveKind(value: string): string | undefined {
  return MASKED.find(item => item.pattern.test(value))?.code;
}

export function schemaLayer(store: StateStore, ctx: Context) {
  authorize(store, ctx);
  const dictionary = published(store, ctx);
  if (!dictionary) return absent();
  return {
    state: 'published' as const, layer: 'schema' as const, version: dictionary.version, hash: dictionary.hash, pack: dictionary.pack, label: dictionary.label,
    currency: dictionary.currency, gstMode: dictionary.gstMode,
    fields: Object.entries(dictionary.fields).map(([name, type]) => ({ name, type })).sort((a, b) => a.name.localeCompare(b.name)),
    definitions: dictionary.definitions.map(d => ({ name: d.name, label: d.label, meaning: d.meaning, kind: d.kind, field: d.field, currency: d.currency, nulls: d.nulls, sign: d.sign ?? 1 })),
    checks: structuredClone(dictionary.checks),
  };
}

function rawValues(fact: Fact, field: string): unknown {
  if (Object.hasOwn(CORE_FIELDS, field)) return (fact as Record<string, unknown>)[field];
  return Object.hasOwn(fact.fields, field) ? fact.fields[field] : undefined;
}

/** Layer 2. 'nothing' withholds every field; 'shape' gives masks only; 'samples' gives a few visible values. */
export function samplesLayer(store: StateStore, ctx: Context, payload: Record<string, unknown> = {}) {
  authorize(store, ctx);
  check(payload.fields === undefined || Array.isArray(payload.fields) && payload.fields.length <= 200 && payload.fields.every(item => typeof item === 'string' && item.length <= 64),
    'INVALID_REQUEST', 'Name at most 200 dictionary fields.');
  const dictionary = published(store, ctx);
  if (!dictionary) return absent();
  const send = store.read().policy.send;
  const names = payload.fields === undefined ? Object.keys(dictionary.fields).sort() : [...new Set(payload.fields as string[])];
  const fields: Record<string, unknown> = {};
  if (send === 'nothing') {
    for (const name of names) fields[name] = Object.hasOwn(dictionary.fields, name) ? { state: 'withheld' } : { state: 'absent' };
    return { state: 'published' as const, layer: 'samples' as const, send, version: dictionary.version, hash: dictionary.hash, fields };
  }
  const facts = visibleFacts(store, ctx);
  for (const name of names) {
    if (!Object.hasOwn(dictionary.fields, name)) { fields[name] = { state: 'absent' }; continue; }
    const type = dictionary.fields[name];
    if (!facts.length) { fields[name] = { state: 'not loaded yet', type }; continue; }
    const seen = new Set<string>(), shapes = new Map<string, { mask: string; length: string }>(), values: unknown[] = [];
    for (const fact of facts) {
      const value = rawValues(fact, name);
      if (value === undefined || value === null || value === '') continue;
      const text = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
      if (text === undefined || seen.has(text)) continue;
      seen.add(text);
      const kind = sensitiveKind(text);
      // Amounts are numbers: they leave only through `calculate` with a receipt, so money fields show shapes at every send level.
      const numeric = type === 'money' || /^[-+]?[\d,]+(?:\.\d+)?$/.test(text.trim());
      if (send === 'shape' || numeric) { const mask = maskOf(text); if (!shapes.has(mask) && shapes.size < SAMPLE_LIMIT) shapes.set(mask, { mask, length: lengthBucket(text.length) }); }
      else if (values.length < SAMPLE_LIMIT) values.push(kind ? { masked: kind, mask: maskOf(text) } : text);
      if ((send === 'shape' || numeric ? shapes.size : values.length) >= SAMPLE_LIMIT) break;
    }
    if (!seen.size) { fields[name] = { state: 'absent', type }; continue; }
    fields[name] = send === 'shape' ? { state: 'shape', type, shapes: [...shapes.values()] }
      : values.length === 0 ? { state: 'shape', type, shapes: [...shapes.values()], reason: 'Numbers come only from a calculation with its receipt.' }
      : { state: 'samples', type, values, ...(shapes.size ? { shapes: [...shapes.values()] } : {}) };
  }
  return { state: 'published' as const, layer: 'samples' as const, send, version: dictionary.version, hash: dictionary.hash, fields };
}

export function operationsLayer(store: StateStore, ctx: Context) {
  authorize(store, ctx);
  const dictionary = published(store, ctx);
  if (!dictionary) return { ...absent(), readOnly: READ_ONLY_STATEMENT };
  return {
    state: 'published' as const, layer: 'operations' as const, version: dictionary.version, hash: dictionary.hash,
    operations: dictionary.operations.map(o => ({ id: o.id, label: o.label, type: o.type, definitions: [...o.definitions], parameters: [...o.parameters] })),
    readOnly: READ_ONLY_STATEMENT,
  };
}

export function infoLayer(store: StateStore, ctx: Context) {
  authorize(store, ctx);
  const dictionary = published(store, ctx);
  return {
    name: 'Chausar dictionary', readOnly: true, statement: READ_ONLY_STATEMENT, send: store.read().policy.send,
    layers: ['schema', 'samples', 'operations'], tools: DICTIONARY_TOOL_NAMES,
    dictionary: dictionary ? { state: 'published', version: dictionary.version, hash: dictionary.hash, pack: dictionary.pack } : absent(),
  };
}

export const DICTIONARY_TOOL_NAMES = ['dictionary_schema', 'dictionary_samples', 'dictionary_operations'];
const closed = (properties: Record<string, unknown> = {}) => ({ type: 'object', additionalProperties: false, properties });

/** The three layers as read tools on the existing MCP server. The store is read at call time. */
export function dictionaryMcpTools(store: StateStore): RegisteredReadTool[] {
  return [
    { name: 'dictionary_schema', description: 'Read the published business dictionary: fields with types, definitions and checks. Read-only.', inputSchema: closed(), read: (_args, ctx) => schemaLayer(store, ctx) },
    { name: 'dictionary_samples', description: 'Read sample content for dictionary fields as the trust panel allows: withheld, shapes only, or a few visible values with identifiers masked. Read-only.',
      inputSchema: closed({ fields: { type: 'array', maxItems: 200 } }), read: (args, ctx) => samplesLayer(store, ctx, args) },
    { name: 'dictionary_operations', description: 'Read the allowed operations: the published calculation menu. Read-only; no writes, approvals or expressions.', inputSchema: closed(), read: (_args, ctx) => operationsLayer(store, ctx) },
  ];
}
