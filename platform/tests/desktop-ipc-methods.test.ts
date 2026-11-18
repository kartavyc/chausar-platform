import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { METHODS, validateRequest } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
test('desktop runtime and TypeScript declaration expose the same unique method tuple', async () => {
  const declaration = await readFile(new URL('../../app/desktop/ipc-contract.d.cts', import.meta.url), 'utf8');
  const tuple = declaration.match(/export const METHODS:\s*readonly\s*(\[[\s\S]*?\]);/);
  assert.ok(tuple, 'The declaration must retain its literal method tuple.');
  assert.deepEqual(JSON.parse(tuple[1]), METHODS);
  assert.equal(new Set(METHODS).size, METHODS.length);
});

test('desktop forwards the onboarding draft methods, right after venture.preview, in the contract order', async () => {
  const { DRAFT_METHODS } = await import('../runtime/venture/contracts.ts');
  const at = METHODS.indexOf('venture.preview');
  assert.deepEqual(METHODS.slice(at + 1, at + 1 + DRAFT_METHODS.length), [...DRAFT_METHODS]);
  const declared = await readFile(new URL('../../app/desktop/ipc-contract.d.cts', import.meta.url), 'utf8');
  const typed = JSON.parse(/METHODS: readonly (\[[^\]]+\])/.exec(declared)?.[1] ?? '[]');
  assert.deepEqual(typed, [...METHODS], 'the declaration file lists the same methods in the same order');
  for (const method of DRAFT_METHODS) assert.deepEqual(validateRequest({ method, payload: {} }), { method, payload: {} });
});

test('desktop forwards the two app preference methods, right after the custody methods (C3 added app.preferences)', async () => {
  const { APP_PREFERENCE_METHODS } = await import('../runtime/app-preferences.ts');
  const { CUSTODY_METHODS } = await import('../runtime/workspace-custody-contracts.ts');
  const at = METHODS.indexOf(CUSTODY_METHODS.at(-1)!);
  assert.deepEqual(METHODS.slice(at + 1, at + 1 + APP_PREFERENCE_METHODS.length), [...APP_PREFERENCE_METHODS]);
  assert.deepEqual(validateRequest({ method: 'app.preferences.set', payload: { motion: 'off' } }), { method: 'app.preferences.set', payload: { motion: 'off' } });
  const { BOOTSTRAP_ONLY_METHODS } = await import('../runtime/server.ts');
  assert.ok(BOOTSTRAP_ONLY_METHODS.includes('app.preferences.set'), 'only the computer owner changes the app');
  assert.ok(!BOOTSTRAP_ONLY_METHODS.includes('app.preferences.get'));
});

test('desktop forwards the custody methods, right after workspace.delete, in the contract order', async () => {
  const { CUSTODY_METHODS } = await import('../runtime/workspace-custody-contracts.ts');
  assert.equal(CUSTODY_METHODS.length, 16); // 4J6 added workspace.custody.neverContactReset; C4 added workspace.transfer.peek; C5 task 24 the three Drive methods; C6 added workspace.backups.inspect
  const at = METHODS.indexOf('workspace.delete');
  assert.deepEqual(METHODS.slice(at + 1, at + 1 + CUSTODY_METHODS.length), [...CUSTODY_METHODS]);
  const declared = await readFile(new URL('../../app/desktop/ipc-contract.d.cts', import.meta.url), 'utf8');
  const typed = JSON.parse(/METHODS: readonly (\[[^\]]+\])/.exec(declared)?.[1] ?? '[]');
  assert.deepEqual(typed, [...METHODS], 'the declaration file lists the same methods in the same order');
  for (const method of CUSTODY_METHODS) assert.deepEqual(validateRequest({ method, payload: {} }), { method, payload: {} });
});
