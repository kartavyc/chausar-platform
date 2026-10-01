import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import type { DesktopBridge } from '../../app/desktop/types.ts';
import type { Investigation } from '../runtime/investigations.ts';

function typed(bridge: DesktopBridge) {
  // @ts-expect-error A writer must identify the loaded revision.
  void bridge.request('investigations.advance', { id: 'fixture' });
  // @ts-expect-error Search must declare the supported method and complete-corpus bounds.
  void bridge.request('research.search', { query: 'August' });
}
void typed;

test('actual desktop worker persists an explicitly empty private investigation across lock/reopen', async t => {
  const root = resolve(tmpdir()), directory = await mkdtemp(join(root, 'chausar-investigation-worker-'));
  const harness = new EngineHarness({ workerPath: fileURLToPath(new URL('../runtime/worker.ts', import.meta.url)),
    environment: { CHAUSAR_DEMO: '1', CHAUSAR_VAULT_DIRECTORY: directory }, startupTimeoutMs: 15000, requestTimeoutMs: 15000 });
  t.after(async () => {
    await harness.stop(); const child = relative(root, resolve(directory));
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && directory.startsWith(join(root, 'chausar-investigation-worker-')));
    await rm(directory, { recursive: true, force: true });
  });
  await harness.start();
  const passphrase = 'Synthetic worker investigation fixture passphrase';
  await harness.request('workspace.create', { name: 'Synthetic empty investigation', pack: 'ecommerce', passphrase, demo: false });
  let saved = await harness.request('investigations.create', {
    objective: 'Keep the absence of imported evidence explicit.', branch: 'main', asOf: new Date().toISOString(), sourceIds: [],
    steps: [{ id: 'billed', label: 'Empty imported invoice population', request: { operation: 'billed', period: { from: '2026-08-01', to: '2026-08-31' } } }],
    hypotheses: [], budget: { maxSteps: 1, maxReceiptRows: 0, maxContextBytes: 16384 },
  }) as Investigation;
  saved = await harness.request('investigations.advance', { id: saved.id, expectedRevision: saved.revision }) as Investigation;
  assert.equal(saved.status, 'complete'); assert.equal(saved.steps[0].state, 'completed');
  await harness.request('workspace.lock', {});
  await harness.request('workspace.open', { passphrase });
  assert.deepEqual(await harness.request('investigations.get', { id: saved.id }), saved);
  const capsule: any = await harness.request('investigations.capsule', { id: saved.id });
  assert.equal(capsule.measurements[0].figures[0].minor, '0');
  assert.equal(capsule.measurements[0].coverage.completeness, 'empty'); assert.deepEqual(capsule.hypotheses, []);
  await assert.rejects(harness.request('investigations.cancel', { id: saved.id, expectedRevision: 1 }),
    (error: any) => error.code === 'INVESTIGATION_REVISION_CONFLICT');
  await assert.rejects(harness.request('research.search', { method: 'simple-token-conjunction-v1', query: 'August',
    bounds: { maxDocuments: 10, maxTextBytes: 16384, maxMatches: 10 } }), (error: any) => error.code === 'SEARCH_DATABASE_REQUIRED');
});
