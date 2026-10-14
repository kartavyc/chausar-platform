/**
 * Small typed dictionary edits (EvoOntology's self-evolution step). An edit is data: one of the
 * registered kinds with typed arguments. It is applied to the current published draft to give a
 * candidate; whether the owner ever sees it is decided by the answer key, elsewhere.
 */
import { check, type Context, type State } from '../contracts.ts';
import { canonical } from '../actions.ts';
import type { Definition, Dictionary, DictionaryDraft, FieldType } from '../ontology.ts';
import { parseCsv } from '../ingest.ts';
import { visibleFacts } from '../trust.ts';
import { canSee } from './state.ts';
import { visibleDecisions } from './log.ts';
import { fieldNameFor, profileColumn, safeFieldName } from './dictionary-builder.ts';
import { EDIT_KINDS } from './vocabulary.ts';

export type EditKind = typeof EDIT_KINDS[number];
/** `edit` names the edit kind; for change-kind, `kind` is the record kind the definition counts. */
export type TypedEdit =
  | { edit: 'add-field'; name: string; type: FieldType }
  | { edit: 'add-definition'; definition: Definition }
  | { edit: 'remove-definition'; name: string }
  | { edit: 'change-meaning'; name: string; meaning: string }
  | { edit: 'change-nulls'; name: string; nulls: Definition['nulls'] }
  | { edit: 'change-label'; name: string; label: string }
  | { edit: 'change-sign'; name: string; sign: 1 | -1 }
  | { edit: 'change-kind'; name: string; kind: string };
/** Local evidence for an edit. Source headers stay on this machine and are never served or shared. */
export type EditEvidence = { origin: 'unmapped-field' | 'fact-kind' | 'correction' | 'model'; count: number; importIds: string[]; sourceIds: string[]; decisionIds: string[]; header?: string;
  /** For an edit a configured model route proposed through `learningx.editsAskRun`: the gateway's model receipt. */
  modelReceiptId?: string };

const FIELD_TYPES: FieldType[] = ['string', 'money', 'date', 'integer', 'boolean'];
const GENERATED = new Set(['revenue', 'net_sales', 'margin', 'aging', 'change', 'scenario']);
const RESERVED_FIELDS = new Set(['entityId', 'kind', 'validFrom', 'validTo', 'branch', 'constructor', 'prototype']);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const measureName = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value);
const text = (value: unknown, min: number, max: number): value is string => typeof value === 'string' && value.trim().length >= min && value.length <= max;

/** Validate a proposed edit as typed data. A model's edit is outside text: it is checked, never run. */
export function assertEdit(value: unknown): TypedEdit {
  check(plain(value) && typeof value.edit === 'string' && (EDIT_KINDS as readonly string[]).includes(value.edit), 'INVALID_EDIT', 'Choose a registered dictionary edit kind.');
  const fail = () => check(false, 'INVALID_EDIT', 'This dictionary edit does not have its declared typed arguments.');
  switch (value.edit) {
    case 'add-field':
      if (!(exact(value, ['edit', 'name', 'type']) && typeof value.name === 'string' && /^[a-z][a-zA-Z0-9]{0,63}$/.test(value.name) && !RESERVED_FIELDS.has(value.name) && FIELD_TYPES.includes(value.type as FieldType))) fail();
      break;
    case 'add-definition': {
      const d = value.definition;
      if (!(exact(value, ['edit', 'definition']) && plain(d) && exact(d, ['name', 'label', 'meaning', 'kind', 'field', 'currency', 'nulls'], ['sign'])
        && measureName(d.name) && !GENERATED.has(d.name) && text(d.label, 1, 120) && text(d.meaning, 11, 1000) && measureName(d.kind)
        && typeof d.field === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(d.field) && typeof d.currency === 'string' && /^[A-Z]{3}$/.test(d.currency)
        && ['reject', 'exclude'].includes(d.nulls as string) && (d.sign === undefined || d.sign === 1 || d.sign === -1))) fail();
      break;
    }
    case 'remove-definition': if (!(exact(value, ['edit', 'name']) && measureName(value.name))) fail(); break;
    case 'change-meaning': if (!(exact(value, ['edit', 'name', 'meaning']) && measureName(value.name) && text(value.meaning, 11, 1000))) fail(); break;
    case 'change-nulls': if (!(exact(value, ['edit', 'name', 'nulls']) && measureName(value.name) && ['reject', 'exclude'].includes(value.nulls as string))) fail(); break;
    case 'change-label': if (!(exact(value, ['edit', 'name', 'label']) && measureName(value.name) && text(value.label, 1, 120))) fail(); break;
    case 'change-sign': if (!(exact(value, ['edit', 'name', 'sign']) && measureName(value.name) && (value.sign === 1 || value.sign === -1))) fail(); break;
    case 'change-kind': if (!(exact(value, ['edit', 'name', 'kind']) && measureName(value.name) && measureName(value.kind))) fail(); break;
  }
  return JSON.parse(canonical(value)) as TypedEdit;
}

/** The editable part of a published dictionary. */
export function draftOf(dictionary: Dictionary): DictionaryDraft {
  const { pack, label, currency, gstMode, fields, definitions } = structuredClone(dictionary);
  return { pack, label, currency, gstMode, fields, definitions };
}

/** Apply one edit to a draft. It refuses edits that name nothing or change nothing. */
export function applyEdit(base: DictionaryDraft, edit: TypedEdit): DictionaryDraft {
  const draft = structuredClone(base);
  if (edit.edit === 'add-field') {
    check(!Object.hasOwn(draft.fields, edit.name), 'EDIT_NO_CHANGE', 'This field is already in the dictionary.');
    draft.fields[edit.name] = edit.type; return draft;
  }
  if (edit.edit === 'add-definition') {
    check(!draft.definitions.some(d => d.name === edit.definition.name), 'EDIT_NO_CHANGE', 'This definition is already in the dictionary.');
    draft.definitions.push(structuredClone(edit.definition)); return draft;
  }
  const index = draft.definitions.findIndex(d => d.name === edit.name);
  check(index >= 0, 'EDIT_TARGET_MISSING', 'This edit names a definition that is not published.');
  const d = draft.definitions[index];
  if (edit.edit === 'remove-definition') { draft.definitions.splice(index, 1); return draft; }
  const before = canonical(d);
  if (edit.edit === 'change-meaning') d.meaning = edit.meaning;
  if (edit.edit === 'change-nulls') d.nulls = edit.nulls;
  if (edit.edit === 'change-label') d.label = edit.label;
  if (edit.edit === 'change-sign') { if (edit.sign === 1) delete d.sign; else d.sign = -1; }
  if (edit.edit === 'change-kind') d.kind = edit.kind;
  check(canonical(d) !== before, 'EDIT_NO_CHANGE', 'This edit would not change the definition.');
  return draft;
}

/** Edits suggested by local evidence only: repeated unmapped columns, record kinds without a definition, and mapping corrections. */
export function evidenceEdits(state: State, ctx: Context, dictionary: Dictionary): { edit: TypedEdit; evidence: EditEvidence }[] {
  const proposals = new Map<string, { edit: TypedEdit; evidence: EditEvidence }>();
  // 1. Columns seen as unmapped in two or more accepted imports the caller may see.
  const unmapped = new Map<string, { imports: any[] }>();
  for (const record of state.imports) {
    if (!Array.isArray(record?.unmappedFields) || typeof record.sourceId !== 'string' || !canSee(state, ctx, [record.sourceId])) continue;
    for (const header of new Set<string>(record.unmappedFields.filter((item: unknown) => typeof item === 'string' && item.length <= 200)))
      (unmapped.get(header) ?? unmapped.set(header, { imports: [] }).get(header)!).imports.push(record);
  }
  for (const [header, { imports }] of unmapped) {
    if (imports.length < 2) continue;
    const latest = imports.at(-1), retained = latest?.retainedInput?.input;
    let cells: unknown[] = [];
    if (retained?.format === 'csv' && typeof retained.content === 'string') { try { cells = parseCsv(retained.content).map(row => row[header]); } catch { cells = []; } }
    const profile = profileColumn(header, cells), name = fieldNameFor(profile);
    if (!name || Object.hasOwn(dictionary.fields, name) || !/^[a-z][a-zA-Z0-9]{0,63}$/.test(name)) continue;
    proposals.set(`field:${name}`, { edit: { edit: 'add-field', name, type: profile.type }, evidence: { origin: 'unmapped-field', count: imports.length, importIds: [...new Set<string>(imports.map(item => item.id))].sort(), sourceIds: [...new Set<string>(imports.map(item => item.sourceId))].sort(), decisionIds: [], header } });
  }
  // 2. Record kinds present in memory that no definition counts.
  const defined = new Set(dictionary.definitions.map(d => d.kind)), names = new Set(dictionary.definitions.map(d => d.name)), kinds = new Map<string, Set<string>>();
  for (const fact of visibleFacts({ read: () => state, update: async () => { throw new Error('Read-only view.'); } }, ctx))
    if (!defined.has(fact.kind) && measureName(fact.kind) && Object.hasOwn(fact.fields, 'amountMinor')) (kinds.get(fact.kind) ?? kinds.set(fact.kind, new Set()).get(fact.kind)!).add(fact.sourceId);
  for (const [kind, sources] of kinds) {
    if (names.has(kind) || GENERATED.has(kind) || dictionary.fields.amountMinor !== 'money') continue;
    const definition: Definition = { name: kind, label: kind[0].toUpperCase() + kind.slice(1).replace(/_/g, ' '), kind, field: 'amountMinor', currency: dictionary.currency, nulls: 'reject',
      meaning: `Total of imported ${kind.replace(/_/g, ' ')} records excluding tax, by record date. Proposed because these records exist without a definition.` };
    proposals.set(`definition:${kind}`, { edit: { edit: 'add-definition', definition }, evidence: { origin: 'fact-kind', count: sources.size, importIds: [], sourceIds: [...sources].sort(), decisionIds: [] } });
  }
  // 3. Mapping corrections in the decision log that name a field the dictionary lacks.
  for (const decision of visibleDecisions(state, ctx)) {
    if (decision.event.kind !== 'mapping' || decision.event.choice !== 'corrected') continue;
    for (const [field, type] of decision.event.fields ?? []) {
      const fieldType: FieldType = type === 'decimal' ? 'money' : type;
      const name = fieldNameFor({ name: safeFieldName(field), type: fieldType });
      if (!name || Object.hasOwn(dictionary.fields, name)) continue;
      const prior = proposals.get(`field:${name}`);
      if (prior) { prior.evidence.decisionIds = [...new Set([...prior.evidence.decisionIds, decision.id])].sort(); continue; }
      proposals.set(`field:${name}`, { edit: { edit: 'add-field', name, type: fieldType }, evidence: { origin: 'correction', count: 1, importIds: [], sourceIds: [...decision.sourceIds], decisionIds: [decision.id] } });
    }
  }
  return [...proposals.values()];
}
