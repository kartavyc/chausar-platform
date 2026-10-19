// P6: every venture package exports what the host loads, and together their handler tables cover every method.
// Written in Phase B against the contracts; it passes once all five packages have landed (Phase C).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_METHODS, METHOD_OWNERS, PRE_VAULT_METHODS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type { VentureMethod, VenturePackageId } from '../runtime/venture/contracts.ts';
import { missingHandlers, PACKAGE_LOADERS, type VenturePackageModule } from '../runtime/venture/host.ts';

const REQUIRED_EXPORTS: Record<VenturePackageId, string[]> = {
  core: ['handlers', 'listCountries', 'previewPlan'],
  models: ['handlers', 'createModelPort', 'defaultModelTransport', 'createReplayTransport'],
  money: ['handlers'],
  build: ['handlers', 'defaultGitHubTransport', 'createFixtureGitHubTransport'],
  delivery: ['handlers'],
};

async function loadAll(): Promise<Record<VenturePackageId, VenturePackageModule>> {
  const ids = Object.keys(PACKAGE_LOADERS) as VenturePackageId[];
  return Object.fromEntries(await Promise.all(ids.map(async id => [id, await PACKAGE_LOADERS[id]()] as const))) as Record<VenturePackageId, VenturePackageModule>;
}

test('each venture package exports what the host loads', async () => {
  const modules = await loadAll();
  for (const [id, names] of Object.entries(REQUIRED_EXPORTS) as [VenturePackageId, string[]][]) {
    const module = modules[id];
    assert.equal(typeof module.handlers, 'object', `${id} exports a handler table`);
    assert.notEqual(module.handlers, null, `${id} exports a handler table`);
    for (const name of names.filter(name => name !== 'handlers')) assert.equal(typeof module[name], 'function', `${id} exports ${name}`);
  }
});

test('the five handler tables cover every venture method, each in its owner package only', async () => {
  const modules = await loadAll();
  const tables = Object.fromEntries(Object.entries(modules).map(([id, module]) => [id, module.handlers])) as Record<VenturePackageId, VenturePackageModule['handlers']>;
  assert.deepEqual(missingHandlers(tables), []);
  for (const [id, table] of Object.entries(tables) as [VenturePackageId, Record<string, unknown>][]) {
    for (const method of Object.keys(table)) {
      assert.ok((VENTURE_METHODS as readonly string[]).includes(method), `${id} registers ${method}, which is not a venture method`);
      assert.equal(METHOD_OWNERS[method as VentureMethod], id, `${id} registers ${method}, which belongs to ${METHOD_OWNERS[method as VentureMethod]}`);
      assert.equal(PRE_VAULT_METHODS.includes(method as VentureMethod), false, `${method} is answered before any vault, outside the tables`);
      assert.equal(DRAFT_METHODS.includes(method as VentureMethod), false, `${method} is answered by the engine's draft desk, outside the tables`);
      assert.equal(typeof table[method], 'function', `${id} ${method} is a function`);
    }
  }
});
