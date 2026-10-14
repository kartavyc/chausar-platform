import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildRegistry, engineModules, moduleMethods } from '../runtime/modules/registry.ts';
import { moduleState, peekModuleState } from '../runtime/modules/types.ts';
import { initialState } from '../runtime/contracts.ts';

const { METHODS, MODULE_METHODS } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
const handler = async () => null;

test('each engine module declares exactly its desktop allowlist file', async () => {
  const directory = new URL('../../app/desktop/module-methods/', import.meta.url);
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  assert.deepEqual(files, engineModules.map(module => `${module.id}.json`).sort(), 'One desktop allowlist file per engine module.');
  for (const module of engineModules) {
    const listed = JSON.parse(await readFile(new URL(`${module.id}.json`, directory), 'utf8'));
    assert.deepEqual([...listed].sort(), Object.keys(module.methods).sort(), `${module.id}: desktop allowlist must match its registered methods.`);
  }
  assert.deepEqual([...MODULE_METHODS].sort(), [...moduleMethods.keys()].sort());
});

test('module methods never shadow a core engine method', () => {
  for (const name of moduleMethods.keys()) assert.equal(METHODS.includes(name), false, `${name} collides with a core method`);
  assert.doesNotThrow(() => buildRegistry(engineModules, new Set(METHODS)));
});

test('the registry refuses invalid, duplicate and reserved names', () => {
  const spec = { permission: 'read' as const, handler };
  assert.throws(() => buildRegistry([{ id: 'a-module', methods: { 'Bad.name': spec } }]), /Invalid module method/);
  assert.throws(() => buildRegistry([{ id: 'a-module', methods: { 'a.one': spec } }, { id: 'b-module', methods: { 'a.one': spec } }]), /collides/);
  assert.throws(() => buildRegistry([{ id: 'a-module', methods: {} }, { id: 'a-module', methods: {} }]), /duplicate engine module id/);
  assert.throws(() => buildRegistry([{ id: 'a-module', methods: { 'workspace.status': spec } }], new Set(['workspace.status'])), /collides/);
  assert.throws(() => buildRegistry([{ id: 'a-module', methods: { 'a.one': { permission: 'root' as any, handler } } }]), /Invalid method spec/);
  const built = buildRegistry([{ id: 'a-module', methods: { 'a.one': spec } }]);
  assert.equal(built.get('a.one')?.module, 'a-module');
});

test('module state lives in its own namespace and is created on first use', () => {
  const state = initialState('Fixture');
  assert.equal(peekModuleState(state, 'a-module'), undefined);
  const value = moduleState(state, 'a-module', () => ({ items: [] as string[] }));
  value.items.push('x');
  assert.deepEqual(peekModuleState(state, 'a-module'), { items: ['x'] });
  assert.equal(moduleState(state, 'a-module', () => ({ items: [] as string[] })), value);
});
