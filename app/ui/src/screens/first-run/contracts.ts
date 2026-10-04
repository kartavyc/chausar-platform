/**
 * First run, step four and five (FR-06 "Pick a starter pack", FR-08 "Agree what your
 * words mean"): the checked data boundary.
 *
 * Only the four actual Engine methods are named here. There is no `packs.list`,
 * `packs.choose`, `dictionary.proposals` or `dictionary.decide` in the Engine at this
 * HEAD (platform/runtime/engine.ts, `ontology.*`), so this slice does not pretend they
 * exist:
 *
 * - `ui.context`      payload {}        → trusted workspace/member/contextKey (host/contracts.ts)
 * - `ontology.packs`  payload {}        → DictionaryDraft[] in Engine order
 * - `ontology.get`    payload {}        → { current: Dictionary | null, history: Dictionary[] }
 * - `ontology.publish` payload { draft } → Dictionary (compiled, hashed)
 *
 * Every reply is validated structurally before it is trusted: plain objects only, own
 * enumerable data properties only, exact key sets, bounded sizes, no undefined, no
 * accessor or inherited data. Nothing unknown is cast into a trusted type. Validated
 * values are deep-cloned and frozen with their key order preserved, because the
 * review digest and the Engine hash are both `SHA256(JSON.stringify(...))` over exact
 * insertion order (platform/runtime/contracts.ts `hash`).
 *
 * Two pack identities are kept apart. The selectable starters are exactly the six the
 * frozen Engine ships, in its order. A published or historical dictionary may carry a
 * custom identity (the Engine's `compileDictionary` never checks `pack`, and the frozen
 * Engine test suite publishes `Custom Acme workspace`), so current/history accept a
 * bounded single-line text there and are never offered as a starter.
 */

import { ReplyValidationError, assertISOInstant } from '../../bridge/validate.ts';
import type { UiContext } from '../../host/contracts.ts';

export const FIELD_TYPES = ['string', 'money', 'date', 'integer', 'boolean'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const GST_MODES = ['regular', 'composition', 'unregistered'] as const;
export type GstMode = (typeof GST_MODES)[number];
export type NullRule = 'exclude' | 'reject';
export type DefinitionSign = 1 | -1;

/** The exact six starter packs of the frozen Engine (platform/runtime/ontology.ts `packLabels`), in its order. */
export const STARTER_PACK_IDS = Object.freeze(['ecommerce', 'retail', 'services', 'distributor', 'manufacturing', 'saas'] as const);
export type StarterPackId = (typeof STARTER_PACK_IDS)[number];

/** One business meaning, data only, exactly as platform/runtime/ontology.ts declares it. */
export interface Definition {
  readonly name: string;
  readonly label: string;
  readonly meaning: string;
  readonly kind: string;
  readonly field: string;
  readonly currency: string;
  readonly nulls: NullRule;
  readonly sign?: DefinitionSign;
}

export interface DictionaryDraft {
  readonly pack: string;
  readonly label: string;
  readonly currency: string;
  readonly gstMode: GstMode;
  readonly fields: Readonly<Record<string, FieldType>>;
  readonly definitions: readonly Definition[];
}

export type OperationType = 'sum' | 'margin' | 'aging' | 'change' | 'scenario';

export interface Operation {
  readonly id: string;
  readonly label: string;
  readonly type: OperationType;
  readonly definitions: readonly string[];
  readonly parameters: readonly string[];
}

/** The closed compiled-sum contract (platform/runtime/compiled-calculation.ts). */
export interface CompiledSum {
  readonly contractVersion: 1;
  readonly compilerVersion: 'chausar-single-sum/1';
  readonly type: 'single-definition-sum';
  readonly operationId: string;
  readonly definitionName: string;
  readonly recordKind: string;
  readonly moneyField: string;
  readonly currency: string;
  readonly sign: DefinitionSign;
  readonly nullPolicy: NullRule;
  readonly dictionaryVersion: number;
  readonly definitionHash: string;
  readonly digest: string;
}

export interface PublishedDictionary extends DictionaryDraft {
  readonly version: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
  /** The Engine hash: SHA-256 over the whole compiled content without this key. */
  readonly hash: string;
  readonly operations: readonly Operation[];
  readonly compiledSums?: readonly CompiledSum[];
  readonly schema: Readonly<Record<string, FieldType>>;
  readonly checks: {
    readonly required: readonly string[];
    readonly currency: string;
    readonly nullRules: Readonly<Record<string, NullRule>>;
  };
}

export interface OntologyReadback {
  readonly current: PublishedDictionary | null;
  readonly history: readonly PublishedDictionary[];
}

export interface FirstRunRpcPayloads {
  'ui.context': Record<string, never>;
  'ontology.packs': Record<string, never>;
  'ontology.get': Record<string, never>;
  'ontology.publish': { readonly draft: DictionaryDraft };
}
export type FirstRunMethod = keyof FirstRunRpcPayloads;
export const FIRST_RUN_METHODS: readonly FirstRunMethod[] = Object.freeze(['ui.context', 'ontology.packs', 'ontology.get', 'ontology.publish']);

/**
 * The narrow raw port this slice needs. It is deliberately not the host's generic
 * `guardedRequest`: that seam insists the contextKey is equal after every call, and a
 * successful `ontology.publish` changes the contextKey on purpose (engine.ts: the key
 * covers the whole ontology). The controller in this folder does its own before/after
 * `ui.context` fencing with an identity rule instead. The parent must bind this port to
 * the trusted transport restricted to exactly these four methods.
 */
export interface FirstRunPort {
  request<M extends FirstRunMethod>(method: M, payload: FirstRunRpcPayloads[M]): Promise<unknown>;
}

export const DRAFT_KEYS = ['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions'] as const;
export const DEFINITION_KEYS = ['name', 'label', 'meaning', 'kind', 'field', 'currency', 'nulls'] as const;
const PUBLISHED_KEYS = ['version', 'publishedAt', 'publishedBy', 'hash', 'operations', 'schema', 'checks'] as const;
const COMPILED_SUM_KEYS = ['contractVersion', 'compilerVersion', 'type', 'operationId', 'definitionName', 'recordKind', 'moneyField', 'currency', 'sign', 'nullPolicy', 'dictionaryVersion', 'definitionHash', 'digest'] as const;
const OPERATION_TYPES: readonly string[] = ['sum', 'margin', 'aging', 'change', 'scenario'];
const NULL_RULES: readonly string[] = ['exclude', 'reject'];

export const MAX_FIELDS = 200;
export const MAX_DEFINITIONS = 100;
export const MAX_OPERATIONS = 200;
export const MAX_HISTORY = 500;
export const MAX_MEANING_LENGTH = 4000;
/** A published dictionary's identity is bounded text; the Engine itself never checks it. */
export const MAX_PACK_IDENTITY_LENGTH = 100;
/** The Engine's own rule: `meaning.trim().length > 10`. */
export const MIN_MEANING_TRIMMED_LENGTH = 11;

const MEASURE_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const CURRENCY = /^[A-Z]{3}$/;
export const HEX_64 = /^[a-f0-9]{64}$/;
/** Control characters other than newline and tab are never part of a meaning or label. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Which pack identities a draft may carry: a selectable starter, or any bounded published identity. */
type PackRule = 'starter' | 'identity';

function invalid(path: string): never { throw new ReplyValidationError(path); }

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) invalid(path);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) invalid(path);
  }
  return value as Record<string, unknown>;
}
function exact(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const obj = record(value, path);
  const keys = Object.keys(obj);
  if (required.some(key => !Object.hasOwn(obj, key)) || keys.some(key => !required.includes(key) && !optional.includes(key))) invalid(path);
  return obj;
}
function list(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) invalid(path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) invalid(path);
  for (let i = 0; i < value.length; i++) {
    const descriptor = descriptors[String(i)];
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) invalid(path);
  }
  return value;
}
function text(value: unknown, path: string, maximum: number, multiline = false): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum || CONTROL.test(value)) invalid(path);
  if (!multiline && /[\n\r]/.test(value)) invalid(path);
  return value;
}
function pattern(value: unknown, path: string, expression: RegExp): string {
  if (typeof value !== 'string' || !expression.test(value)) invalid(path);
  return value;
}
function choice<T extends string>(value: unknown, path: string, allowed: readonly string[]): T {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid(path);
  return value as T;
}
function wholeNumber(value: unknown, path: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid(path);
  return value;
}
function fieldMap(value: unknown, path: string): Readonly<Record<string, FieldType>> {
  const obj = record(value, path);
  const entries = Object.entries(obj);
  if (entries.length === 0 || entries.length > MAX_FIELDS) invalid(path);
  for (const [name, type] of entries) {
    pattern(name, `${path}.${name}`, FIELD_NAME);
    choice(type, `${path}.${name}`, FIELD_TYPES);
  }
  return obj as Readonly<Record<string, FieldType>>;
}

/** A meaning a person may type or the Engine may supply: exact text, bounded, no control characters. */
export function meaningText(value: unknown, path = 'meaning'): string {
  const meaning = text(value, path, MAX_MEANING_LENGTH, true);
  if (meaning.trim().length < MIN_MEANING_TRIMMED_LENGTH) invalid(path);
  return meaning;
}

export function isStarterPackId(value: string): value is StarterPackId {
  return (STARTER_PACK_IDS as readonly string[]).includes(value);
}

function packIdentity(value: unknown, path: string, rule: PackRule): string {
  const identity = text(value, path, MAX_PACK_IDENTITY_LENGTH);
  if (rule === 'starter' && !isStarterPackId(identity)) invalid(path);
  return identity;
}

function definition(value: unknown, path: string, draftCurrency: string, fields: Readonly<Record<string, FieldType>>): void {
  const obj = exact(value, path, DEFINITION_KEYS, ['sign']);
  pattern(obj.name, `${path}.name`, MEASURE_NAME);
  text(obj.label, `${path}.label`, 200);
  meaningText(obj.meaning, `${path}.meaning`);
  pattern(obj.kind, `${path}.kind`, MEASURE_NAME);
  const field = pattern(obj.field, `${path}.field`, FIELD_NAME);
  if (fields[field] !== 'money') invalid(`${path}.field`);
  if (pattern(obj.currency, `${path}.currency`, CURRENCY) !== draftCurrency) invalid(`${path}.currency`);
  choice(obj.nulls, `${path}.nulls`, NULL_RULES);
  if (Object.hasOwn(obj, 'sign') && obj.sign !== 1 && obj.sign !== -1) invalid(`${path}.sign`);
}

/** Checks the six draft properties of an already shape-checked record; it does not clone. */
function draftFields(obj: Record<string, unknown>, path: string, rule: PackRule): void {
  packIdentity(obj.pack, `${path}.pack`, rule);
  text(obj.label, `${path}.label`, 100);
  const currency = pattern(obj.currency, `${path}.currency`, CURRENCY);
  choice(obj.gstMode, `${path}.gstMode`, GST_MODES);
  const fields = fieldMap(obj.fields, `${path}.fields`);
  const definitions = list(obj.definitions, `${path}.definitions`, MAX_DEFINITIONS);
  if (definitions.length === 0) invalid(`${path}.definitions`);
  const names = new Set<string>();
  definitions.forEach((item, index) => {
    definition(item, `${path}.definitions[${index}]`, currency, fields);
    const name = (item as { name: string }).name;
    if (names.has(name)) invalid(`${path}.definitions[${index}].name`);
    names.add(name);
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}
/** A detached, frozen copy with the original key order. */
export function frozenClone<T>(value: T): T { return deepFreeze(structuredClone(value)); }

/** A draft this slice may review and send: a starter identity unless the caller is checking a published identity. */
export function validateDraft(value: unknown, path = 'draft', rule: PackRule = 'starter'): DictionaryDraft {
  const obj = exact(value, path, DRAFT_KEYS);
  draftFields(obj, path, rule);
  return frozenClone(obj as unknown as DictionaryDraft);
}

/** `ontology.packs`: exactly the six Engine starter packs, in the Engine's order, every one a complete draft. */
export function validatePacks(value: unknown): readonly DictionaryDraft[] {
  const items = list(value, 'ontology.packs', STARTER_PACK_IDS.length);
  if (items.length !== STARTER_PACK_IDS.length) invalid('ontology.packs');
  const packs = items.map((item, index) => validateDraft(item, `ontology.packs[${index}]`, 'starter'));
  if (packs.some((pack, index) => pack.pack !== STARTER_PACK_IDS[index])) invalid('ontology.packs');
  return Object.freeze(packs);
}

function operation(value: unknown, path: string, names: ReadonlySet<string>): Operation {
  const obj = exact(value, path, ['id', 'label', 'type', 'definitions', 'parameters']);
  pattern(obj.id, `${path}.id`, MEASURE_NAME);
  text(obj.label, `${path}.label`, 200);
  choice(obj.type, `${path}.type`, OPERATION_TYPES);
  const definitions = list(obj.definitions, `${path}.definitions`, 20);
  if (definitions.length === 0) invalid(`${path}.definitions`);
  definitions.forEach((name, index) => { if (!names.has(pattern(name, `${path}.definitions[${index}]`, MEASURE_NAME))) invalid(`${path}.definitions[${index}]`); });
  list(obj.parameters, `${path}.parameters`, 20).forEach((name, index) => pattern(name, `${path}.parameters[${index}]`, FIELD_NAME));
  return obj as unknown as Operation;
}

/**
 * One compiled sum against the dictionary it arrived in. The Engine compiles a sum only
 * for an operation of type `sum` over exactly one definition whose id is that definition's
 * name or the declared `revenue` alias of `earned`, and copies that definition's kind,
 * money field, currency, sign and null rule into the artifact (compiled-calculation.ts
 * `compileSingleSum`). A shape that is internally valid but names a different binding is
 * refused here; the two hashes it carries are verified separately and asynchronously by
 * `digest.ts`. None of this is business arithmetic and none of it is authentication.
 */
function compiledSum(value: unknown, path: string, definitions: readonly Definition[], operations: readonly Operation[], version: number): CompiledSum {
  const obj = exact(value, path, COMPILED_SUM_KEYS);
  if (obj.contractVersion !== 1 || obj.compilerVersion !== 'chausar-single-sum/1' || obj.type !== 'single-definition-sum') invalid(path);
  const operationId = pattern(obj.operationId, `${path}.operationId`, MEASURE_NAME);
  const definitionName = pattern(obj.definitionName, `${path}.definitionName`, MEASURE_NAME);
  const bound = definitions.find(item => item.name === definitionName);
  if (bound === undefined) invalid(`${path}.definitionName`);
  const named = operations.find(item => item.id === operationId);
  if (named === undefined || named.type !== 'sum' || named.definitions.length !== 1 || named.definitions[0] !== definitionName) invalid(`${path}.operationId`);
  if (!(operationId === definitionName || (operationId === 'revenue' && definitionName === 'earned'))) invalid(`${path}.operationId`);
  if (pattern(obj.recordKind, `${path}.recordKind`, MEASURE_NAME) !== bound.kind) invalid(`${path}.recordKind`);
  if (pattern(obj.moneyField, `${path}.moneyField`, FIELD_NAME) !== bound.field) invalid(`${path}.moneyField`);
  if (pattern(obj.currency, `${path}.currency`, CURRENCY) !== bound.currency) invalid(`${path}.currency`);
  if (obj.sign !== (bound.sign ?? 1)) invalid(`${path}.sign`);
  if (choice(obj.nullPolicy, `${path}.nullPolicy`, NULL_RULES) !== bound.nulls) invalid(`${path}.nullPolicy`);
  if (obj.dictionaryVersion !== version) invalid(`${path}.dictionaryVersion`);
  pattern(obj.definitionHash, `${path}.definitionHash`, HEX_64);
  pattern(obj.digest, `${path}.digest`, HEX_64);
  return obj as unknown as CompiledSum;
}

/** A compiled, published dictionary as `ontology.publish` returns it and `ontology.get` reads it back. */
export function validatePublished(value: unknown, path = 'dictionary'): PublishedDictionary {
  const obj = exact(value, path, [...DRAFT_KEYS, ...PUBLISHED_KEYS], ['compiledSums']);
  draftFields(obj, path, 'identity');
  const definitions = obj.definitions as readonly Definition[];
  const names = new Set(definitions.map(item => item.name));
  const version = wholeNumber(obj.version, `${path}.version`, 1);
  assertISOInstant(obj.publishedAt, `${path}.publishedAt`);
  text(obj.publishedBy, `${path}.publishedBy`, 200);
  pattern(obj.hash, `${path}.hash`, HEX_64);
  const operations = list(obj.operations, `${path}.operations`, MAX_OPERATIONS).map((item, index) => operation(item, `${path}.operations[${index}]`, names));
  if (new Set(operations.map(item => item.id)).size !== operations.length) invalid(`${path}.operations`);
  const schema = fieldMap(obj.schema, `${path}.schema`);
  const fields = obj.fields as Readonly<Record<string, FieldType>>;
  const schemaEntries = Object.entries(schema);
  if (schemaEntries.length !== Object.keys(fields).length || schemaEntries.some(([name, type]) => fields[name] !== type)) invalid(`${path}.schema`);
  const checks = exact(obj.checks, `${path}.checks`, ['required', 'currency', 'nullRules']);
  list(checks.required, `${path}.checks.required`, 20).forEach((item, index) => pattern(item, `${path}.checks.required[${index}]`, FIELD_NAME));
  if (checks.currency !== obj.currency) invalid(`${path}.checks.currency`);
  // The Engine derives nullRules from the definitions exactly: one entry per definition, the definition's own rule.
  const nullRules = record(checks.nullRules, `${path}.checks.nullRules`);
  if (Object.keys(nullRules).length !== definitions.length) invalid(`${path}.checks.nullRules`);
  for (const item of definitions) {
    if (!Object.hasOwn(nullRules, item.name) || nullRules[item.name] !== item.nulls) invalid(`${path}.checks.nullRules.${item.name}`);
  }
  if (Object.hasOwn(obj, 'compiledSums')) {
    const sums = list(obj.compiledSums, `${path}.compiledSums`, MAX_OPERATIONS).map((item, index) => compiledSum(item, `${path}.compiledSums[${index}]`, definitions, operations, version));
    // The Engine compiles every single-definition sum operation and nothing else; the two sets must agree.
    const expected = operations.filter(item => item.type === 'sum' && item.definitions.length === 1).map(item => item.id).sort();
    const found = sums.map(item => item.operationId).sort();
    if (expected.length !== found.length || expected.some((id, index) => id !== found[index])) invalid(`${path}.compiledSums`);
  }
  return frozenClone(obj as unknown as PublishedDictionary);
}

/** `ontology.get` at this HEAD returns the `{ current, history }` envelope (engine.ts:1444). */
export function validateOntologyReadback(value: unknown): OntologyReadback {
  const obj = exact(value, 'ontology.get', ['current', 'history']);
  const current = obj.current === null ? null : validatePublished(obj.current, 'ontology.get.current');
  const history = Object.freeze(list(obj.history, 'ontology.get.history', MAX_HISTORY).map((item, index) => validatePublished(item, `ontology.get.history[${index}]`)));
  return Object.freeze({ current, history });
}

/** The draft part of a published dictionary, in the key order the dictionary carries it. */
export function draftOf(dictionary: PublishedDictionary): DictionaryDraft {
  const picked: Record<string, unknown> = {};
  const source = dictionary as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) if ((DRAFT_KEYS as readonly string[]).includes(key)) picked[key] = source[key];
  return frozenClone(picked as unknown as DictionaryDraft);
}

/** The exact JSON the Engine hashed: the received object without its `hash`, same key order. */
export function publishedContentJson(dictionary: PublishedDictionary): string {
  const content: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(dictionary)) if (key !== 'hash') content[key] = item;
  return JSON.stringify(content);
}

/** The compiler's own content field order (compiled-calculation.ts `compileSingleSum`): the artifact's digest is over this order, not the wire order. */
export const COMPILED_SUM_CONTENT_KEYS = Object.freeze(COMPILED_SUM_KEYS.filter(key => key !== 'digest'));

/**
 * The exact JSON the Engine digested for one compiled sum. The Engine does not hash the
 * artifact as received: `assertCompiledSingleSum` rebuilds the content from the published
 * operation, definition and revision in the compiler's fixed field order and compares
 * every field. The received values are therefore laid out in that fixed order here, so a
 * reordered artifact whose digest was taken over its wire order is refused exactly as the
 * Engine refuses it (`COMPILED_SUM_MISMATCH`). The whole dictionary hash, the draft and
 * each definition stay over their authored order; only this nested compiler artifact has
 * a fixed order of its own.
 */
export function compiledSumContentJson(sum: CompiledSum): string {
  const source = sum as unknown as Record<string, unknown>;
  const content: Record<string, unknown> = {};
  for (const key of COMPILED_SUM_CONTENT_KEYS) content[key] = source[key];
  return JSON.stringify(content);
}

/** A plain-language change to one meaning. Every other property of every definition stays exactly as proposed. */
export function withMeaning(draft: DictionaryDraft, name: string, meaning: string): DictionaryDraft {
  if (!draft.definitions.some(item => item.name === name)) throw new ReplyValidationError('draft.definitions');
  const checked = meaningText(meaning);
  return frozenClone({ ...draft, definitions: draft.definitions.map(item => (item.name === name ? { ...item, meaning: checked } : item)) });
}

/* ---------- Authority ---------- */

export type MemberRole = UiContext['member']['role'];
/** The Engine's `publish` requires `authorize(..., 'admin')`: owner or cofounder. */
export function canPublish(context: UiContext): boolean {
  return context.member.role === 'owner' || context.member.role === 'cofounder';
}
/** The same seat in the same workspace: workspace, member, role and epoch. The contextKey is compared separately. */
export function sameAuthority(a: UiContext, b: UiContext): boolean {
  return a.workspace.id === b.workspace.id && a.member.id === b.member.id && a.member.role === b.member.role && a.member.epoch === b.member.epoch;
}
export function sameContext(a: UiContext, b: UiContext): boolean {
  return sameAuthority(a, b) && a.contextKey === b.contextKey;
}

/* ---------- Failures ---------- */

export type FirstRunCode =
  | 'INVALID_REPLY' | 'READ_INVALIDATED' | 'ACCESS_DENIED' | 'VAULT_LOCKED' | 'UNAUTHENTICATED' | 'REQUEST_FAILED'
  /** Same seat, but the Engine state the review was read against moved on (the contextKey changed). */
  | 'CONTEXT_CHANGED'
  | 'NO_AUTHORITY' | 'ROLE_FORBIDDEN' | 'IN_FLIGHT' | 'SELECTION_INVALID' | 'PACK_UNKNOWN' | 'MEANING_INVALID'
  | 'NOT_REVIEWED' | 'DIGEST_STALE' | 'DIGEST_UNAVAILABLE'
  | 'PUBLISH_REFUSED' | 'PUBLISH_MISMATCH' | 'READBACK_MISMATCH' | 'PUBLISH_UNKNOWN' | 'REVIEW_NOT_CURRENT'
  /** An earlier issued publish has settled without a verified outcome; nothing else may start until it is read back. */
  | 'PUBLISH_UNRESOLVED'
  /** Read back: the Engine state is exactly what it was before the attempt, so the attempt published nothing. */
  | 'PUBLISH_NOT_COMMITTED'
  /** Read back: the reviewed dictionary was already current before the attempt, so the attempt published nothing new. */
  | 'ALREADY_CURRENT'
  /** Read back: the reviewed dictionary is current as a new revision, but its version or author is not what this attempt would have produced. */
  | 'PUBLISH_UNATTRIBUTED';

/** The Engine's own dictionary refusals (ontology.ts, compiled-calculation.ts). Each is thrown before any state is assigned. */
export const ENGINE_DICTIONARY_REFUSALS = Object.freeze(['INVALID_DICTIONARY', 'INVALID_CURRENCY', 'INVALID_GST_MODE', 'INVALID_FIELD', 'INVALID_DEFINITION', 'RESERVED_MEASURE', 'UNKNOWN_PACK', 'COMPILED_SUM_INVALID'] as const);
export type EngineDictionaryRefusal = (typeof ENGINE_DICTIONARY_REFUSALS)[number];

export interface FirstRunFailure { readonly code: FirstRunCode; readonly engineCode?: EngineDictionaryRefusal }

function errorCode(error: unknown): unknown {
  try {
    const descriptor = error !== null && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}

/** A fixed code, never the raw error or its message. */
export function firstRunFailure(error: unknown): FirstRunFailure {
  if (error instanceof ReplyValidationError) return { code: 'INVALID_REPLY' };
  const code = errorCode(error);
  if (typeof code !== 'string') return { code: 'REQUEST_FAILED' };
  const refusal = ENGINE_DICTIONARY_REFUSALS.find(item => item === code);
  if (refusal !== undefined) return { code: 'PUBLISH_REFUSED', engineCode: refusal };
  if (code === 'VAULT_LOCKED') return { code: 'VAULT_LOCKED' };
  if (code === 'UNAUTHENTICATED' || code === 'authentication_required') return { code: 'UNAUTHENTICATED' };
  if (['ACCESS_DENIED', 'ACCESS_REVOKED', 'FORBIDDEN', 'BRANCH_FORBIDDEN', 'authority_denied'].includes(code)) return { code: 'ACCESS_DENIED' };
  if (code === 'READ_INVALIDATED') return { code: 'READ_INVALIDATED' };
  if (code === 'INVALID_REPLY') return { code: 'INVALID_REPLY' };
  if (code === 'DIGEST_UNAVAILABLE') return { code: 'DIGEST_UNAVAILABLE' };
  return { code: 'REQUEST_FAILED' };
}
