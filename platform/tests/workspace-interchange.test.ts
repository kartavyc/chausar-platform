import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initialState, hash, type State } from '../runtime/contracts.ts';
import {
  canonicalInterchangeJson, captureWorkspaceInterchange, encodeWorkspaceInterchange, interchangeDigest,
  inspectWorkspaceInterchange, readHistoricalWorkspaceState, retainedArtifactBytes, validateWorkspaceInterchange, workspaceStateProfile,
} from '../runtime/workspace-interchange.ts';
import { COLLECTION_STORES, SINGLETON_STORES } from '../runtime/workspace-interchange-contracts.ts';
import { artifactsFor, deterministicShopState, inertLiterals } from './fixtures/workspace-interchange-fixture.ts';

const code = (expected: string) => (error: any) => error?.code === expected;
function fixture() {
  const state = deterministicShopState();
  for (const store of COLLECTION_STORES) {
    if (['members', 'facts', 'imports'].includes(store)) continue;
    state[store].push({ id: `historical_${store}`, text: inertLiterals, history: [{ at: '2026-09-01', state: 'historical' }],
      credentialLabel: 'synthetic-fixture-only', amountMinor: '-900719925474099391', opaque: { retained: true } });
  }
  return { state, ...captureWorkspaceInterchange(state, artifactsFor(state)) };
}
function reseal(value: any): string {
  const { digest: _oldDigest, ...unsigned } = value;
  value.digest = interchangeDigest(unsigned); return canonicalInterchangeJson(value);
}

test('reviewed profile exhaustively matches every actual persisted State key', () => {
  const actual = Object.keys(initialState('synthetic profile fixture', true)).sort();
  assert.deepEqual(workspaceStateProfile(initialState('synthetic profile fixture', true)).stores.map(store => store.name), actual);
  assert.equal(COLLECTION_STORES.length, 21); assert.equal(SINGLETON_STORES.length, 5);
  const profile = workspaceStateProfile(); profile.stores.pop(); assert.equal(workspaceStateProfile().stores.length, 28);
});

test('codec deterministically preserves every store, literal, readable meaning and retained byte', () => {
  const { state, inventory, package: packed } = fixture();
  const wire = encodeWorkspaceInterchange(packed);
  const accepted = validateWorkspaceInterchange(wire, inventory);
  assert.equal(encodeWorkspaceInterchange(accepted), wire);
  assert.deepEqual(readHistoricalWorkspaceState(accepted), JSON.parse(JSON.stringify(state)));
  assert.deepEqual(accepted.inventory, inventory);
  assert.deepEqual(JSON.parse(accepted.readable.definitions), state.ontology);
  assert.equal(JSON.parse(accepted.readable.recipes).retainedRecipes.length, 1);
  const recipe = accepted.artifacts.find(item => item.manifest.id === 'recipe_demo')!;
  assert.equal(recipe.manifest.sha256, state.imports[0].recipeHash);
  const binary = accepted.artifacts.find(item => item.manifest.id === 'binary_fixture')!;
  assert.equal(binary.manifest.representation, 'base64');
  assert.deepEqual(retainedArtifactBytes(binary), Buffer.from([0, 255, 192, 0, 128]));
  const literal = accepted.artifacts.find(item => item.manifest.id === 'literal_fixture')!;
  assert.equal(literal.manifest.representation, 'literal-utf8');
  assert.equal(retainedArtifactBytes(literal).toString(), inertLiterals.join('\r\n'));
  const reordered = JSON.parse(JSON.stringify(state)) as State;
  const reversed = Object.fromEntries(Object.entries(reordered).reverse()) as State;
  assert.equal(encodeWorkspaceInterchange(captureWorkspaceInterchange(reversed, artifactsFor(reversed)).package), wire);
});

for (const name of [...COLLECTION_STORES, ...SINGLETON_STORES]) {
  test(`refuses omitted persisted State store ${name}`, () => {
    const { state } = fixture(); const artifacts = artifactsFor(state); delete (state as any)[name];
    assert.throws(() => captureWorkspaceInterchange(state, artifacts), code('INTERCHANGE_STORES'));
  });
  test(`refuses missing wire and inventory store ${name} even after package resealing`, () => {
    const { inventory, package: value } = fixture();
    value.stores = value.stores.filter(item => item.manifest.name !== name);
    value.inventory.stores = value.inventory.stores.filter(item => item.name !== name);
    assert.throws(() => validateWorkspaceInterchange(reseal(value), inventory), code('INTERCHANGE_STORES'));
  });
}

test('refuses newly introduced unreviewed stores and noncollection payloads', () => {
  const { state } = fixture();
  assert.throws(() => captureWorkspaceInterchange({ ...state, hiddenVectorStore: [] } as State, artifactsFor(state)), code('INTERCHANGE_STORES'));
  (state as any).sessions = {};
  assert.throws(() => captureWorkspaceInterchange(state, artifactsFor(state)), code('INTERCHANGE_STORES'));
});

test('refuses corrupt bytes/counts/digests, duplicate stores, partial inventories and unreadable definitions', () => {
  const mutations: [string, (value: any) => void][] = [
    ['INTERCHANGE_CHECKSUM', value => { value.stores[0].text += ' '; }],
    ['INTERCHANGE_CHECKSUM', value => { value.stores[0].manifest.records++; }],
    ['INTERCHANGE_CHECKSUM', value => { value.stores[0].manifest.bytes++; }],
    ['INTERCHANGE_CHECKSUM', value => { value.stores[0].manifest.sha256 = '0'.repeat(64); }],
    ['INTERCHANGE_CHECKSUM', value => { value.stores[1] = structuredClone(value.stores[0]); }],
    ['INTERCHANGE_INVENTORY', value => { value.inventory.stores.pop(); }],
    ['INTERCHANGE_INVENTORY', value => { value.inventory.artifacts.pop(); }],
    ['INTERCHANGE_INVENTORY', value => { value.inventory.categoryCounts.pop(); }],
    ['INTERCHANGE_CHECKSUM', value => { value.artifacts.find((item: any) => item.manifest.representation === 'literal-utf8').text += 'tampered'; }],
    ['INTERCHANGE_CHECKSUM', value => { value.artifacts[0].manifest.bytes++; }],
    ['INTERCHANGE_READABLE', value => { value.readable.definitions = '{}'; }],
    ['INTERCHANGE_READABLE', value => { value.readable.recipes = '{}'; }],
  ];
  for (const [expected, mutate] of mutations) {
    const { package: packed } = fixture(); mutate(packed);
    assert.throws(() => inspectWorkspaceInterchange(reseal(packed)), (error: any) => {
      // Noncanonical store text fails before a corrupted-byte check.
      return error.code === expected || (expected === 'INTERCHANGE_CHECKSUM' && error.code === 'INTERCHANGE_CANONICAL');
    }, expected);
  }
});

test('independent root inventory refuses a consistently rewritten complete package', () => {
  const { state, inventory } = fixture();
  state.policy.sharing = true; state.workspace.name = 'mutated complete export';
  const different = captureWorkspaceInterchange(state, artifactsFor(state));
  assert.doesNotThrow(() => inspectWorkspaceInterchange(encodeWorkspaceInterchange(different.package)));
  assert.throws(() => validateWorkspaceInterchange(encodeWorkspaceInterchange(different.package), inventory), code('INTERCHANGE_AUTHORITY_CHANGED'));
});

test('refuses mixed State/artifact generations, omitted category attestations and duplicate/path-like artifacts', () => {
  const { state } = fixture();
  const cases: [string, (capture: ReturnType<typeof artifactsFor>) => void][] = [
    ['INTERCHANGE_GENERATION', capture => { capture.generation.revision++; }],
    ['INTERCHANGE_GENERATION', capture => { capture.artifacts[0].generation = { ...capture.generation, captureId: 'different_capture' }; }],
    ['INTERCHANGE_INVENTORY', capture => { capture.categories.pop(); }],
    ['INTERCHANGE_INVENTORY', capture => { capture.complete = false as any; }],
    ['INTERCHANGE_ARTIFACT', capture => { capture.artifacts[1].id = capture.artifacts[0].id; }],
    ['INTERCHANGE_ARTIFACT', capture => { capture.artifacts[0].id = '../../outside'; }],
    ['INTERCHANGE_ARTIFACT', capture => { capture.artifacts[0].id = 'C:\\outside'; }],
    ['INTERCHANGE_ARTIFACT', capture => { capture.artifacts[0].mediaType = 'text/html;execute=1'; }],
  ];
  for (const [expected, mutate] of cases) {
    const capture = artifactsFor(state); mutate(capture);
    assert.throws(() => captureWorkspaceInterchange(state, capture), code(expected));
  }
  const { package: packed } = fixture(); packed.stores[0].manifest.generation.captureId = 'mixed_generation';
  assert.throws(() => inspectWorkspaceInterchange(reseal(packed)), code('INTERCHANGE_CHECKSUM'));
});

test('complete export refuses legacy hash-only recipe and source bodies', () => {
  const state = deterministicShopState();
  for (const id of ['recipe_demo', 'source_demo']) {
    const capture = artifactsFor(state); capture.artifacts = capture.artifacts.filter(item => item.id !== id);
    assert.throws(() => captureWorkspaceInterchange(state, capture), code('INTERCHANGE_IMPORT_MATERIAL'));
  }
  state.imports[0].recipeHash = hash('absent exact recipe');
  assert.throws(() => captureWorkspaceInterchange(state, artifactsFor(state)), code('INTERCHANGE_IMPORT_MATERIAL'));
});

test('readable recipe claims refuse hash-matched binary/nonrecipe bodies and missing import pins', () => {
  for (const bytes of [Buffer.from([255, 0, 1]), Buffer.from('literal rather than recipe'), Buffer.from('{}'), Buffer.from('{"version":1,"id":"incomplete"}')]) {
    const state = deterministicShopState(); const capture = artifactsFor(state);
    const recipe = capture.artifacts.find(item => item.id === 'recipe_demo')!;
    recipe.bytes = bytes; state.imports[0].recipeHash = createHash('sha256').update(bytes).digest('hex');
    assert.throws(() => captureWorkspaceInterchange(state, capture), code('INTERCHANGE_RECIPE_BODY'));
  }
  for (const field of ['recipeHash', 'contentHash']) {
    const state = deterministicShopState(); delete state.imports[0][field];
    assert.throws(() => captureWorkspaceInterchange(state, artifactsFor(state)), code('INTERCHANGE_IMPORT_MATERIAL'));
  }
  const state = deterministicShopState(); state.imports.push(null);
  assert.throws(() => captureWorkspaceInterchange(state, artifactsFor(state)), code('INTERCHANGE_IMPORT_MATERIAL'));
});

test('recipe semantic pins accept faithful pretty JSON while independently checking retained byte checksums', () => {
  const state = deterministicShopState(); const artifacts = artifactsFor(state);
  const item = artifacts.artifacts.find(artifact => artifact.id === 'recipe_demo')!;
  const recipe = JSON.parse(Buffer.from(item.bytes).toString('utf8'));
  item.bytes = Buffer.from(JSON.stringify(recipe, null, 4));
  const capture = captureWorkspaceInterchange(state, artifacts);
  const accepted = validateWorkspaceInterchange(encodeWorkspaceInterchange(capture.package), capture.inventory);
  const retained = accepted.artifacts.find(artifact => artifact.manifest.id === 'recipe_demo')!;
  assert.notEqual(retained.manifest.sha256, state.imports[0].recipeHash);
  assert.deepEqual(retainedArtifactBytes(retained), Buffer.from(item.bytes));
  const connector = structuredClone(state); connector.imports = [{ type: 'connector-mapping-review-v1', id: 'mapping_fixture', recipeHash: interchangeDigest(recipe) }];
  assert.doesNotThrow(() => captureWorkspaceInterchange(connector, artifactsFor(connector)));
  const duplicateBody = Buffer.from(JSON.stringify(recipe).replace('{', '{"id":"first-hidden-duplicate",'));
  item.bytes = duplicateBody;
  assert.throws(() => captureWorkspaceInterchange(state, artifacts), code('INTERCHANGE_RECIPE_BODY'));
});

test('wire refuses unsupported schema/format, duplicate keys, truncation and forged binary encodings', () => {
  const { package: packed } = fixture(); const wire = encodeWorkspaceInterchange(packed);
  assert.throws(() => inspectWorkspaceInterchange(wire.slice(0, -1)), code('INTERCHANGE_JSON'));
  assert.throws(() => inspectWorkspaceInterchange('{"digest":"duplicate",' + wire.slice(1)), code('INTERCHANGE_CANONICAL'));
  const schema = deterministicShopState(); schema.schemaVersion = 2;
  assert.throws(() => captureWorkspaceInterchange(schema, artifactsFor(schema)), code('INTERCHANGE_SCHEMA'));
  const unsupported = structuredClone(packed); (unsupported as any).format = 'chausar.workspace-interchange.v99';
  assert.throws(() => inspectWorkspaceInterchange(reseal(unsupported)), code('INTERCHANGE_FORMAT'));
  const unknownProfile = structuredClone(packed); unknownProfile.inventory.profile.stores.push({ name: 'extra', kind: 'collection' });
  assert.throws(() => inspectWorkspaceInterchange(reseal(unknownProfile)), code('INTERCHANGE_PROFILE'));
  const binary = packed.artifacts.find(item => item.manifest.id === 'binary_fixture')!; binary.text += '\n';
  assert.throws(() => inspectWorkspaceInterchange(reseal(packed)), code('INTERCHANGE_ARTIFACT'));
});

test('persisted JSON is bounded and refuses callbacks/accessors/cycles/classes/sparse arrays', () => {
  assert.equal(canonicalInterchangeJson({ omitted: undefined, literal: '=1+1' }), '{"literal":"=1+1"}');
  let accessorRuns = 0; const accessor = Object.defineProperty({}, 'text', { enumerable: true, get: () => { accessorRuns++; return 'bad'; } });
  const cycle: any = {}; cycle.self = cycle;
  for (const value of [accessor, cycle, { run: () => 1 }, new Date(), [undefined], Array(2), { value: NaN }, { value: 1n }]) {
    assert.throws(() => canonicalInterchangeJson(value), code('INTERCHANGE_JSON'));
  }
  assert.equal(accessorRuns, 0);
  let deep: any = {}; for (let index = 0; index < 66; index++) deep = { inner: deep };
  assert.throws(() => canonicalInterchangeJson(deep), code('INTERCHANGE_LIMIT'));
});

test('resource bounds refuse oversized artifact inventories and excessive JSON nodes', () => {
  const state = deterministicShopState(); const capture = artifactsFor(state);
  capture.artifacts = Array.from({ length: 4097 }, (_, index) => ({ ...capture.artifacts[0], id: `overbound_${index}` }));
  assert.throws(() => captureWorkspaceInterchange(state, capture), code('INTERCHANGE_LIMIT'));
  assert.throws(() => canonicalInterchangeJson(Array.from({ length: 1_000_001 }, () => null)), code('INTERCHANGE_LIMIT'));
});
