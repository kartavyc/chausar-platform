import { createHash } from 'node:crypto';
import { ChausarError, type State } from './contracts.ts';
import type { CalculationReceipt } from './calculator.ts';
import { assertRetainedOntology } from './ontology.ts';
import {
  COLLECTION_STORES, SINGLETON_STORES, RETAINED_ARTIFACT_CATEGORIES, INTERCHANGE_FORMAT, STATE_PROFILE,
  RETAINED_INTERCHANGE_FORMAT, RETAINED_STATE_PROFILE, RETAINED_NAMESPACE_STORES, RETAINED_ONTOLOGY_NAMESPACES,
  type ArtifactCapture, type ArtifactManifest, type Generation, type StoreProfile, type StoreManifest,
  type WorkspaceCapture, type WorkspaceInterchange, type WorkspaceInventory, type RetainedOntologyNamespace,
} from './workspace-interchange-contracts.ts';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACTS = 4096;
const MAX_NODES = 1_000_000;
const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9_.:-]{1,200}$/;
const coreProfile: StoreProfile = {
  id: STATE_PROFILE,
  stores: [
    ...COLLECTION_STORES.map(name => ({ name, kind: 'collection' as const })),
    ...SINGLETON_STORES.map(name => ({ name, kind: 'singleton' as const })),
  ].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  artifactCategories: [...RETAINED_ARTIFACT_CATEGORIES].sort(),
};

function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ChausarError(code, message);
}
function profileWithRetainedNamespaces(retained: ReadonlyArray<StoreProfile['stores'][number]>, ontologyNamespaces: ReadonlyArray<RetainedOntologyNamespace> = []): StoreProfile {
  return retained.length === 0 && ontologyNamespaces.length === 0 ? coreProfile : {
    ...coreProfile, id: RETAINED_STATE_PROFILE,
    stores: [...coreProfile.stores, ...retained].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    ...(ontologyNamespaces.length ? { ontologyNamespaces: [...ontologyNamespaces] } : {}),
  };
}
function ontologyNamespacePresence(ontology: unknown): RetainedOntologyNamespace[] {
  return RETAINED_ONTOLOGY_NAMESPACES.filter(name => record(ontology) && Object.hasOwn(ontology, name));
}
/** Without a State, enumerate every supported namespace for a fresh target.
 * With a State, retain the exact optional namespace presence of that saved cut. */
export function workspaceStateProfile(state?: Partial<Pick<State, 'scenarioRecords' | 'lessonState' | 'ontology'>>): StoreProfile {
  const retained = RETAINED_NAMESPACE_STORES.filter(store => state === undefined || Object.hasOwn(state, store.name));
  const ontologyNamespaces = state === undefined ? [...RETAINED_ONTOLOGY_NAMESPACES] : ontologyNamespacePresence(state.ontology);
  return structuredClone(profileWithRetainedNamespaces(retained, ontologyNamespaces));
}
/** Canonical persisted JSON. Undefined object properties follow Vault JSON semantics. */
export function canonicalInterchangeJson(value: unknown): string {
  let nodes = 0;
  const active = new Set<object>();
  function encode(item: unknown, depth: number): string {
    requireValue(++nodes <= MAX_NODES && depth <= 64, 'INTERCHANGE_LIMIT', 'JSON exceeds the bounded node or depth limit.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      requireValue(Number.isFinite(item), 'INTERCHANGE_JSON', 'Only finite JSON numbers can be retained.');
      return JSON.stringify(item);
    }
    requireValue(typeof item === 'object', 'INTERCHANGE_JSON', 'Only persisted JSON data can be retained.');
    const object = item as object;
    requireValue(!active.has(object), 'INTERCHANGE_JSON', 'Cyclic objects cannot be retained.');
    requireValue(Object.getOwnPropertySymbols(object).length === 0, 'INTERCHANGE_JSON', 'Symbol properties cannot be retained.');
    active.add(object);
    try {
      if (Array.isArray(object)) {
        const descriptors = Object.getOwnPropertyDescriptors(object);
        requireValue(Object.keys(descriptors).length === object.length + 1, 'INTERCHANGE_JSON', 'Arrays must be dense JSON arrays.');
        return `[${Array.from({ length: object.length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          requireValue(descriptor && 'value' in descriptor, 'INTERCHANGE_JSON', 'Array accessors are refused.');
          return encode(descriptor.value, depth + 1);
        }).join(',')}]`;
      }
      requireValue(Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null,
        'INTERCHANGE_JSON', 'Class instances cannot be retained as inert JSON.');
      const descriptors = Object.getOwnPropertyDescriptors(object);
      const parts: string[] = [];
      for (const key of Object.keys(descriptors).sort()) {
        const descriptor = descriptors[key];
        requireValue('value' in descriptor && descriptor.enumerable, 'INTERCHANGE_JSON', 'Accessors and hidden properties are refused.');
        if (descriptor.value !== undefined) parts.push(`${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`);
      }
      return `{${parts.join(',')}}`;
    } finally { active.delete(object); }
  }
  const text = encode(value, 0);
  requireValue(Buffer.byteLength(text, 'utf8') <= MAX_BYTES, 'INTERCHANGE_LIMIT', 'JSON exceeds sixty-four megabytes.');
  return text;
}
export function interchangeDigest(value: unknown): string { return sha(canonicalInterchangeJson(value)); }
// Existing semantic hashes use JSON.stringify insertion order. Sorting persisted
// object keys would silently invalidate dictionary/compiler/recipe bindings.
function persistedJson(value: unknown): string {
  canonicalInterchangeJson(value);
  const text = JSON.stringify(value);
  requireValue(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_BYTES, 'INTERCHANGE_LIMIT', 'Persisted JSON exceeds its byte bound.');
  return text;
}
function sha(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: unknown, keys: string[], code = 'INTERCHANGE_SHAPE'): asserts value is Record<string, any> {
  requireValue(record(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'), code, 'The declared fields must be present exactly once.');
}
function safeCount(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function identifier(value: unknown): value is string { return typeof value === 'string' && identifierPattern.test(value); }
function same(left: unknown, right: unknown): boolean { return canonicalInterchangeJson(left) === canonicalInterchangeJson(right); }
function generation(value: unknown): asserts value is Generation {
  exact(value, ['workspaceId', 'revision', 'captureId']);
  requireValue(identifier(value.workspaceId) && identifier(value.captureId) && safeCount(value.revision), 'INTERCHANGE_GENERATION', 'A complete immutable capture identity is required.');
}
function assertProfile(profile: unknown): asserts profile is StoreProfile {
  if (same(profile, coreProfile)) return;
  requireValue(record(profile) && profile.id === RETAINED_STATE_PROFILE && Array.isArray(profile.stores),
    'INTERCHANGE_PROFILE', 'This codec requires an explicitly supported versioned persisted-state profile.');
  const retained = RETAINED_NAMESPACE_STORES.filter(store => profile.stores.some((item: any) => item?.name === store.name));
  const ontologyNamespaces = RETAINED_ONTOLOGY_NAMESPACES.filter(name => Array.isArray(profile.ontologyNamespaces) && profile.ontologyNamespaces.includes(name));
  requireValue((retained.length > 0 || ontologyNamespaces.length > 0) && same(profile, profileWithRetainedNamespaces(retained, ontologyNamespaces)),
    'INTERCHANGE_PROFILE', 'Only exact declared scenario, lesson and ontology namespaces may extend the legacy profile.');
}
function assertState(state: unknown, profile: StoreProfile): asserts state is State {
  exact(state, profile.stores.map(store => store.name), 'INTERCHANGE_STORES');
  for (const store of profile.stores) if (store.kind === 'collection') {
    requireValue(Array.isArray(state[store.name]), 'INTERCHANGE_STORES', 'Every persisted collection must be an explicit array, including empty collections.');
  }
  requireValue(state.schemaVersion === 1 && safeCount(state.revision), 'INTERCHANGE_SCHEMA', 'Unsupported State schema or revision.');
  requireValue(record(state.workspace) && identifier(state.workspace.id) && typeof state.workspace.name === 'string' &&
    typeof state.workspace.currency === 'string' && typeof state.workspace.demo === 'boolean' && typeof state.workspace.createdAt === 'string',
  'INTERCHANGE_STATE', 'The workspace identity is incomplete.');
  requireValue(record(state.policy) && (state.ontology === null || record(state.ontology)), 'INTERCHANGE_STATE', 'Policy and readable ontology must be retained.');
  const ontologyNamespaces = ontologyNamespacePresence(state.ontology);
  requireValue(same(profile.ontologyNamespaces ?? [], ontologyNamespaces), 'INTERCHANGE_PROFILE',
    'Ontology namespace presence must match the exact retained profile.');
  if (ontologyNamespaces.length) assertRetainedOntology(state as State);
  if (Object.hasOwn(state, 'lessonState')) {
    exact(state.lessonState, ['workspaceId', 'episodes', 'lessons'], 'INTERCHANGE_STORES');
    requireValue(state.lessonState.workspaceId === state.workspace.id && Array.isArray(state.lessonState.episodes)
      && Array.isArray(state.lessonState.lessons), 'INTERCHANGE_STATE', 'The lesson namespace must retain its exact workspace, episodes and lessons.');
  }
}
function readable(state: State, artifacts: WorkspaceInterchange['artifacts']): WorkspaceInterchange['readable'] {
  const pretty = (value: unknown) => JSON.stringify(JSON.parse(canonicalInterchangeJson(value)), null, 2);
  return {
    definitions: pretty(state.ontology),
    recipes: pretty({ imports: state.imports, retainedRecipes: artifacts.filter(item => item.manifest.category === 'mapping-recipes')
      .map(item => ({ id: item.manifest.id, representation: item.manifest.representation, text: item.text })) }),
  };
}
function assertRetainedImportBodies(state: State, artifacts: WorkspaceInterchange['artifacts']) {
  assertRetainedStateImportBodies(state, artifacts);
  // Older scenario cuts may require originals/recipes absent from today's
  // top-level imports. Recovery requires those exact bodies as well.
  for (const scenario of state.scenarioRecords ?? []) {
    requireValue(record(scenario) && Array.isArray(scenario.evidence), 'INTERCHANGE_STATE', 'Retained scenarios need their complete evidence cuts.');
    for (const evidence of scenario.evidence) {
      requireValue(record(evidence) && record(evidence.state), 'INTERCHANGE_STATE', 'Retained scenario evidence must contain its complete input State.');
      requireValue(!Object.hasOwn(evidence.state, 'scenarioRecords') && !Object.hasOwn(evidence.state, 'lessonState'),
        'INTERCHANGE_STATE', 'Scenario evidence cannot recursively retain private namespaces.');
      assertState(evidence.state, workspaceStateProfile(evidence.state));
      assertRetainedStateImportBodies(evidence.state, artifacts);
    }
  }
}
function assertRetainedStateImportBodies(state: State, artifacts: WorkspaceInterchange['artifacts']) {
  const recipePins = new Map<string, { legacy: string; canonical: string }>();
  for (const item of artifacts.filter(artifact => artifact.manifest.category === 'mapping-recipes')) {
    requireValue(item.manifest.representation === 'literal-utf8' && item.manifest.mediaType === 'application/json',
      'INTERCHANGE_RECIPE_BODY', 'Mapping recipes require readable inert UTF-8 JSON bodies.');
    let recipe: unknown;
    try { recipe = JSON.parse(item.text); } catch { throw new ChausarError('INTERCHANGE_RECIPE_BODY', 'A retained recipe body is not readable JSON.'); }
    requireValue(record(recipe) && recipe.version === 1 && identifier(recipe.id) && typeof recipe.system === 'string' &&
      typeof recipe.edition === 'string' && record(recipe.scope) && typeof recipe.scope.company === 'string' &&
      Array.isArray(recipe.scope.branches) && recipe.scope.branches.length > 0 && recipe.scope.branches.every((branch: unknown) => typeof branch === 'string') &&
      Array.isArray(recipe.bindings) && recipe.bindings.length > 0 && recipe.bindings.every((binding: unknown) =>
        record(binding) && typeof binding.target === 'string' && ['string', 'money', 'date', 'integer', 'boolean'].includes(binding.type) &&
        ['reject', 'omit', 'zero'].includes(binding.nulls) && ((typeof binding.source === 'string') !== (binding.constant !== undefined))) &&
      Array.isArray(recipe.allowedKinds) && recipe.allowedKinds.length > 0 && recipe.allowedKinds.every((kind: unknown) => typeof kind === 'string') &&
      Array.isArray(recipe.allowedStatuses) && recipe.allowedStatuses.every((status: unknown) => typeof status === 'string') &&
      ['report', 'reject'].includes(recipe.onUnmapped), 'INTERCHANGE_RECIPE_BODY', 'The retained body must describe a version-one typed MappingRecipe.');
    assertUniqueRecipeKeys(item.text);
    // Artifact bytes may be a faithful pretty JSON file. Legacy semantic pins
    // hash JSON.stringify(recipe), while connector mappings hash sorted JSON.
    recipePins.set(item.manifest.id, { legacy: sha(persistedJson(recipe)), canonical: interchangeDigest(recipe) });
  }
  for (const imported of state.imports) {
    requireValue(record(imported), 'INTERCHANGE_IMPORT_MATERIAL', 'Persisted import evidence must be an inert data record.');
    if (typeof imported.format === 'string') {
      requireValue(typeof imported.recipeHash === 'string' && typeof imported.contentHash === 'string',
        'INTERCHANGE_IMPORT_MATERIAL', 'Legacy source imports must retain their recipe and original content pins.');
    }
    if (['connector-mapping-review-v1', 'connector-capture-v1'].includes(imported.type)) {
      requireValue(typeof imported.recipeHash === 'string', 'INTERCHANGE_IMPORT_MATERIAL', 'Connector mappings/captures must retain their recipe pin.');
    }
    for (const [field, category] of [['recipeHash', 'mapping-recipes'], ['contentHash', 'source-originals']] as const) {
      if (imported[field] === undefined) continue;
      requireValue(typeof imported[field] === 'string' && digestPattern.test(imported[field]),
        'INTERCHANGE_IMPORT_MATERIAL', 'Retained import body hashes must be SHA-256 pins.');
      const connectorRecipe = ['connector-mapping-review-v1', 'connector-capture-v1'].includes(imported.type);
      requireValue(artifacts.some(item => item.manifest.category === category && (field === 'recipeHash'
        ? recipePins.get(item.manifest.id)?.[connectorRecipe ? 'canonical' : 'legacy'] === imported[field]
        : item.manifest.sha256 === imported[field])),
        'INTERCHANGE_IMPORT_MATERIAL', 'Complete interchange requires the exact retained source and recipe bodies, not only their hashes.');
    }
  }
}
/** JSON.parse already established syntax; this pass refuses ambiguous embedded recipe keys. */
function assertUniqueRecipeKeys(text: string) {
  let cursor = 0;
  const white = () => { while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++; };
  function string(): string {
    const start = cursor++;
    while (cursor < text.length) {
      if (text[cursor] === '\\') { cursor += 2; continue; }
      if (text[cursor++] === '"') break;
    }
    return JSON.parse(text.slice(start, cursor));
  }
  function value() {
    white();
    if (text[cursor] === '"') { string(); return; }
    if (text[cursor] === '{') {
      cursor++; white(); const keys = new Set<string>();
      if (text[cursor] === '}') { cursor++; return; }
      while (cursor < text.length) {
        white(); const key = string();
        requireValue(!keys.has(key), 'INTERCHANGE_RECIPE_BODY', 'Duplicate retained recipe keys are refused.'); keys.add(key);
        white(); cursor++; value(); white();
        if (text[cursor++] === '}') return;
      }
    } else if (text[cursor] === '[') {
      cursor++; white(); if (text[cursor] === ']') { cursor++; return; }
      while (cursor < text.length) { value(); white(); if (text[cursor++] === ']') return; }
    } else { while (cursor < text.length && !/[\s,}\]]/.test(text[cursor])) cursor++; }
  }
  // Bound the already parsed recipe before the recursive lexical pass.
  canonicalInterchangeJson(JSON.parse(text)); value();
}
function storeManifest(name: string, kind: StoreManifest['kind'], value: unknown, capture: Generation): StoreManifest {
  const text = persistedJson(value);
  return { name, kind, records: kind === 'collection' ? (value as unknown[]).length : 1,
    bytes: Buffer.byteLength(text, 'utf8'), sha256: sha(text), generation: structuredClone(capture) };
}
function categoryCounts(artifacts: ArtifactManifest[]): WorkspaceInventory['categoryCounts'] {
  return coreProfile.artifactCategories.map(category => ({ category, count: artifacts.filter(item => item.category === category).length }));
}
function packageDigest(value: unknown): string { return interchangeDigest(value); }

/** Root must capture State and ALL retained artifact bytes under the same snapshot fence. */
export function captureWorkspaceInterchange(stateInput: State, artifactCapture: ArtifactCapture): WorkspaceCapture {
  const stateText = persistedJson(stateInput);
  requireValue(record(stateInput), 'INTERCHANGE_STORES', 'Persisted State must contain the exact supported stores.');
  const profile = workspaceStateProfile(stateInput);
  assertState(stateInput, profile);
  const state = JSON.parse(stateText) as State;
  assertState(state, profile);
  exact(artifactCapture, ['complete', 'enumerationId', 'generation', 'categories', 'artifacts']);
  generation(artifactCapture.generation);
  requireValue(artifactCapture.complete === true && identifier(artifactCapture.enumerationId) &&
    same(artifactCapture.categories, coreProfile.artifactCategories), 'INTERCHANGE_INVENTORY', 'Root must attest every retained artifact category, including empty categories.');
  requireValue(state.workspace.id === artifactCapture.generation.workspaceId && state.revision === artifactCapture.generation.revision,
    'INTERCHANGE_GENERATION', 'State and retained artifacts must belong to the same captured generation.');
  requireValue(Array.isArray(artifactCapture.artifacts) && artifactCapture.artifacts.length <= MAX_ARTIFACTS, 'INTERCHANGE_LIMIT', 'Artifact inventory exceeds its bound.');
  const ids = new Set<string>(); let retainedBytes = 0;
  const artifacts: WorkspaceInterchange['artifacts'] = artifactCapture.artifacts.map(item => {
    exact(item, ['id', 'category', 'mediaType', 'bytes', 'generation']);
    requireValue(identifier(item.id) && !ids.has(item.id), 'INTERCHANGE_ARTIFACT', 'Artifact identities must be unique plain identifiers.'); ids.add(item.id);
    requireValue(coreProfile.artifactCategories.includes(item.category) && typeof item.mediaType === 'string' &&
      /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(item.mediaType), 'INTERCHANGE_ARTIFACT', 'Declare a retained category and inert media type.');
    generation(item.generation);
    requireValue(same(item.generation, artifactCapture.generation), 'INTERCHANGE_GENERATION', 'Mixed artifact generations are refused.');
    requireValue(item.bytes instanceof Uint8Array, 'INTERCHANGE_ARTIFACT', 'Root must supply retained bytes; paths and executable callbacks are refused.');
    retainedBytes += item.bytes.byteLength;
    requireValue(retainedBytes <= MAX_BYTES, 'INTERCHANGE_LIMIT', 'Retained artifact bytes exceed their bound.');
    const bytes = Buffer.from(item.bytes); const utf8 = bytes.toString('utf8');
    const literal = Buffer.from(utf8, 'utf8').equals(bytes);
    return { manifest: { id: item.id, category: item.category, mediaType: item.mediaType, bytes: bytes.length,
      sha256: sha(bytes), generation: structuredClone(item.generation), representation: literal ? 'literal-utf8' as const : 'base64' as const },
    text: literal ? utf8 : bytes.toString('base64') };
  }).sort((a, b) => a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0);
  assertRetainedImportBodies(state, artifacts);
  const stores = profile.stores.map(item => ({ manifest: storeManifest(item.name, item.kind, state[item.name as keyof State], artifactCapture.generation),
    text: persistedJson(state[item.name as keyof State]) }));
  const inventory: WorkspaceInventory = { format: 'chausar.workspace-inventory.v1', profile,
    generation: structuredClone(artifactCapture.generation), enumerationId: artifactCapture.enumerationId,
    accessDigest: interchangeDigest({ members: state.members, policy: state.policy }), stateDigest: interchangeDigest(state),
    stores: stores.map(item => item.manifest), artifacts: artifacts.map(item => item.manifest), categoryCounts: categoryCounts(artifacts.map(item => item.manifest)) };
  const unsigned = { format: profile.id === STATE_PROFILE ? INTERCHANGE_FORMAT : RETAINED_INTERCHANGE_FORMAT, inventory, stores, artifacts, readable: readable(state, artifacts) };
  const result: WorkspaceInterchange = { ...unsigned, digest: packageDigest(unsigned) };
  // Apply the wire-size bound before returning an apparently usable capture.
  canonicalInterchangeJson(result);
  return structuredClone({ inventory, package: result });
}
export function encodeWorkspaceInterchange(value: WorkspaceInterchange): string {
  const text = canonicalInterchangeJson(value); inspectWorkspaceInterchange(text); return text;
}
function parseCanonical(text: string): any {
  requireValue(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_BYTES, 'INTERCHANGE_LIMIT', 'The interchange wire must be bounded UTF-8 JSON.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ChausarError('INTERCHANGE_JSON', 'The interchange wire is not complete JSON.'); }
  requireValue(canonicalInterchangeJson(value) === text, 'INTERCHANGE_CANONICAL', 'Only canonical JSON is accepted; duplicate keys and alternate encodings are refused.');
  return value;
}
function parsePersistedJson(text: string): any {
  requireValue(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_BYTES, 'INTERCHANGE_LIMIT', 'Persisted store text must be bounded JSON.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ChausarError('INTERCHANGE_JSON', 'The persisted store is not complete JSON.'); }
  requireValue(persistedJson(value) === text, 'INTERCHANGE_CANONICAL', 'Persisted store text must be compact lossless JSON; duplicate keys and alternate encodings are refused.');
  return value;
}
/** Structural/checksum inspection alone provides NO provenance or authority. */
export function inspectWorkspaceInterchange(text: string): WorkspaceInterchange {
  const value = parseCanonical(text);
  exact(value, ['format', 'inventory', 'stores', 'artifacts', 'readable', 'digest']);
  requireValue(value.format === INTERCHANGE_FORMAT || value.format === RETAINED_INTERCHANGE_FORMAT,
    'INTERCHANGE_FORMAT', 'Unsupported workspace interchange version.');
  exact(value.inventory, ['format', 'profile', 'generation', 'enumerationId', 'accessDigest', 'stateDigest', 'stores', 'artifacts', 'categoryCounts']);
  const inventory = value.inventory;
  requireValue(inventory.format === 'chausar.workspace-inventory.v1', 'INTERCHANGE_FORMAT', 'Unsupported inventory version.');
  assertProfile(inventory.profile); generation(inventory.generation);
  const profile = inventory.profile as StoreProfile;
  requireValue(value.format === (profile.id === STATE_PROFILE ? INTERCHANGE_FORMAT : RETAINED_INTERCHANGE_FORMAT),
    'INTERCHANGE_FORMAT', 'The wire version must match its explicit persisted-state profile.');
  requireValue(identifier(inventory.enumerationId) && digestPattern.test(inventory.accessDigest) && digestPattern.test(inventory.stateDigest),
    'INTERCHANGE_INVENTORY', 'A complete trusted inventory pin is required.');
  requireValue(Array.isArray(value.stores) && value.stores.length === profile.stores.length, 'INTERCHANGE_STORES', 'Omitted and extra stores are refused.');
  const state: Record<string, unknown> = Object.create(null);
  for (let index = 0; index < profile.stores.length; index++) {
    const item = value.stores[index]; exact(item, ['manifest', 'text']);
    exact(item.manifest, ['name', 'kind', 'records', 'bytes', 'sha256', 'generation']);
    const expected = profile.stores[index]; const stored = parsePersistedJson(item.text);
    if (expected.kind === 'collection') requireValue(Array.isArray(stored), 'INTERCHANGE_STORES', 'A collection payload must be a complete explicit JSON array.');
    requireValue(item.manifest.name === expected.name && same(item.manifest, storeManifest(expected.name, expected.kind, stored, inventory.generation)),
      'INTERCHANGE_CHECKSUM', 'Store name, generation, count or checksum differs from its complete payload.');
    state[expected.name] = stored;
  }
  assertState(state, profile);
  requireValue(state.workspace.id === inventory.generation.workspaceId && state.revision === inventory.generation.revision,
    'INTERCHANGE_GENERATION', 'The declared generation does not match historical State.');
  requireValue(Array.isArray(value.artifacts) && value.artifacts.length <= MAX_ARTIFACTS, 'INTERCHANGE_ARTIFACT', 'Retained artifacts must be exhaustively listed.');
  let previousId = ''; let retainedBytes = 0;
  for (const item of value.artifacts) {
    exact(item, ['manifest', 'text']); exact(item.manifest, ['id', 'category', 'mediaType', 'bytes', 'sha256', 'generation', 'representation']);
    const manifest = item.manifest;
    requireValue(identifier(manifest.id) && manifest.id > previousId && coreProfile.artifactCategories.includes(manifest.category) &&
      typeof manifest.mediaType === 'string' && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(manifest.mediaType) &&
      safeCount(manifest.bytes) && typeof item.text === 'string', 'INTERCHANGE_ARTIFACT', 'Artifact inventory fields, order or identities are invalid.');
    previousId = manifest.id;
    requireValue(same(manifest.generation, inventory.generation), 'INTERCHANGE_GENERATION', 'Mixed artifact generations are refused.');
    const bytes = retainedArtifactBytes({ manifest: manifest as ArtifactManifest, text: item.text });
    retainedBytes += bytes.length;
    requireValue(retainedBytes <= MAX_BYTES, 'INTERCHANGE_LIMIT', 'Artifact bytes exceed their bound.');
    requireValue(bytes.length === manifest.bytes && sha(bytes) === manifest.sha256, 'INTERCHANGE_CHECKSUM', 'Artifact byte count or checksum changed.');
  }
  requireValue(same(inventory.stores, value.stores.map((item: any) => item.manifest)) &&
    same(inventory.artifacts, value.artifacts.map((item: any) => item.manifest)) &&
    same(inventory.categoryCounts, categoryCounts(inventory.artifacts)) &&
    inventory.stateDigest === interchangeDigest(state) && inventory.accessDigest === interchangeDigest({ members: state.members, policy: state.policy }),
  'INTERCHANGE_INVENTORY', 'The inventory must exhaustively describe this exact historical State and every retained artifact.');
  requireValue(same(value.readable, readable(state, value.artifacts)), 'INTERCHANGE_READABLE', 'Readable definitions or recipes are missing or changed.');
  assertRetainedImportBodies(state, value.artifacts);
  const { digest, ...unsigned } = value;
  requireValue(typeof digest === 'string' && digestPattern.test(digest) && packageDigest(unsigned) === digest,
    'INTERCHANGE_CHECKSUM', 'The complete package checksum changed.');
  return value as WorkspaceInterchange;
}
/** Expected inventory MUST come from independent trusted root custody, not this wire. */
export function validateWorkspaceInterchange(text: string, expected: WorkspaceInventory): WorkspaceInterchange {
  const value = inspectWorkspaceInterchange(text);
  requireValue(same(value.inventory, expected), 'INTERCHANGE_AUTHORITY_CHANGED', 'The package differs from the independently pinned complete source inventory or access.');
  return value;
}
export function retainedArtifactBytes(item: WorkspaceInterchange['artifacts'][number]): Buffer {
  requireValue(typeof item.text === 'string', 'INTERCHANGE_ARTIFACT', 'Retained content must be inert text.');
  if (item.manifest.representation === 'literal-utf8') return Buffer.from(item.text, 'utf8');
  requireValue(item.manifest.representation === 'base64', 'INTERCHANGE_ARTIFACT', 'Unsupported retained byte representation.');
  const bytes = Buffer.from(item.text, 'base64');
  requireValue(bytes.toString('base64') === item.text, 'INTERCHANGE_ARTIFACT', 'Only canonical base64 retained bytes are accepted.');
  return bytes;
}
/** Historical data only; never mount this State as active job/action/route authority. */
export function readHistoricalWorkspaceState(value: WorkspaceInterchange): State {
  const checked = inspectWorkspaceInterchange(canonicalInterchangeJson(value));
  const state: Record<string, unknown> = Object.create(null);
  for (const item of checked.stores) state[item.manifest.name] = JSON.parse(item.text);
  return JSON.parse(persistedJson(state)) as State;
}
/** Same saved request/asOf and access: only the new receipt id and creation time may vary. */
export function compareRecalculatedReceipt(original: CalculationReceipt, recalculated: CalculationReceipt) {
  const normalize = (receipt: CalculationReceipt) => {
    const { id: _id, createdAt: _createdAt, ...semantic } = receipt;
    return JSON.parse(canonicalInterchangeJson(semantic));
  };
  const baseline = normalize(original); const current = normalize(recalculated);
  const changedFields = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()
    .filter(key => !same(baseline[key] ?? null, current[key] ?? null) || ((key in baseline) !== (key in current)));
  return { equivalent: changedFields.length === 0, changedFields, ignoredFields: ['id', 'createdAt'] as const,
    baselineDigest: interchangeDigest(baseline), recalculatedDigest: interchangeDigest(current) };
}
