import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { ALL_METHODS, CORE_METHODS, DRAFT_DESK_METHODS, RENDERER_METHODS } from '../runtime/method-registry.ts';
import { CUSTODY_METHODS } from '../runtime/workspace-custody-contracts.ts';

const { METHODS } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
test('method registry contains unique names and preserves every current engine entry point', () => {
  assert.equal(new Set(ALL_METHODS).size, ALL_METHODS.length);
  for (const name of ALL_METHODS) assert.match(name, /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/);
  for (const name of METHODS) assert.ok(ALL_METHODS.includes(name), name);
  for (const name of CUSTODY_METHODS) assert.ok(CORE_METHODS.some(row => row.name === name), name);
});
test('registry agrees with engine dispatch, including the main-only custody operations', async () => {
  const source = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  const dispatch = new Set([...source.matchAll(/(?:case\s+|method\s*===\s*)'([^']+)'/g)].map(row => row[1]!));
  for (const name of ALL_METHODS) assert.ok(dispatch.has(name), `No engine dispatcher for ${name}`);
  for (const name of dispatch) if (name.includes('.')) assert.ok(ALL_METHODS.includes(name), `Unregistered dispatcher: ${name}`);
  assert.ok(ALL_METHODS.includes('workspace.import'));
  assert.ok(ALL_METHODS.includes('workspace.backups.copyTo'));
});
test('renderer registry grants exactly the UI declared methods', async () => {
  const source = await readFile(new URL('../../app/ui/src/engine/types.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export interface EngineMethods'));
  const names = [...body.matchAll(/^\s*'([^']+)':\s*\{/gm)].map(row => row[1]!);
  assert.deepEqual([...RENDERER_METHODS].sort(), names.sort());
  assert.equal(DRAFT_DESK_METHODS.length, 15);
});

test('desktop refuses the engine-only surface that the UI never declares', () => {
  assert.deepEqual([...METHODS].sort(), [...RENDERER_METHODS].sort());
});

test('main-only file operations pass host validation and remain unavailable to the renderer', () => {
  const { validateRequest, validateHostRequest } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
  for (const input of [
    { method: 'workspace.import', payload: { file: 'sample-copy.json' } },
    { method: 'workspace.backups.copyTo', payload: { folder: 'sample-backups', confirmed: true } },
    { method: 'workspace.export', payload: { path: 'sample-copy.json', confirmed: true } },
  ]) {
    assert.throws(() => validateRequest(input), { code: 'INVALID_REQUEST' });
    assert.deepEqual(validateHostRequest(input), input);
  }
  assert.throws(() => validateRequest({ method: 'workspace.status', payload: {}, host: true }), { code: 'INVALID_REQUEST' });
});
