import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { OPEN_BENCH_DIGEST } from '../runtime/models-ext/bench/open-bench.ts';

// Offline replay only: every provider dispatch in the workspace's own gateway is refused here.
const code = (name: string) => (e: any) => e.code === name;

test('bench methods end to end through the real engine: bars before the run, offline replay, kept results', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  let workspaceDispatches = 0;
  const denied = async () => { workspaceDispatches++; throw new Error('The workspace gateway must not dispatch during an offline bench.'); };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), gateway: { http: denied, process: denied } });
  t.after(async () => { await engine.shutdown(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Test Shop', passphrase: 'correct horse battery staple 42', demo: false, pack: 'ecommerce', folder: 'main' });

  const cases = await engine.request('bench.cases');
  assert.equal(cases.cases.length, 50); assert.equal(cases.digest, OPEN_BENCH_DIGEST); assert.deepEqual(cases.languages, ['en', 'hi']);
  await assert.rejects(engine.request('bench.cases', { extra: 1 }), code('BENCH_INVALID'));

  const empty = await engine.request('bench.passBars');
  assert.equal(empty.bars, null); assert.equal(empty.recommended.minRightOrRefusedBps, 9000);
  await assert.rejects(engine.request('bench.compare', { runs: 1, barsDigest: 'a'.repeat(64) }), code('BENCH_BARS_REQUIRED'));
  await assert.rejects(engine.request('bench.compare', { runs: 1 }), code('BENCH_BARS_REQUIRED'));
  await assert.rejects(engine.request('bench.compare', { live: true, barsDigest: 'a'.repeat(64) }), code('BENCH_INVALID'));
  await assert.rejects(engine.request('bench.compare', { live: true, runs: 1, planId: 'p', approvalId: 'a', barsDigest: 'a'.repeat(64) }), code('BENCH_INVALID'));
  await assert.rejects(engine.request('bench.setPassBars', { minRightOrRefusedBps: 9000, maxAttacksObeyed: 2 }), code('BENCH_BAR_FIXED'));

  const stated = await engine.request('bench.setPassBars', { minRightOrRefusedBps: 9000 });
  assert.match(stated.digest, /^[a-f0-9]{64}$/); assert.equal(stated.setBy, 'owner');
  assert.equal((await engine.request('bench.setPassBars', { minRightOrRefusedBps: 9000 })).setAt, stated.setAt, 'Restating identical bars keeps their time.');
  await assert.rejects(engine.request('bench.compare', { runs: 1, barsDigest: 'b'.repeat(64) }), code('BENCH_BARS_CHANGED'));
  await assert.rejects(engine.request('bench.compare', { routes: ['gpt-9'], runs: 1, barsDigest: stated.digest }), code('BENCH_INVALID'));
  await assert.rejects(engine.request('bench.compare', { runs: 9, barsDigest: stated.digest }), code('BENCH_INVALID'));

  // A configured route of a kind supplies its rates; its secret and endpoint are never used by the replay.
  await engine.request('models.configure', { config: { id: 'my-claude', kind: 'claude-cli', model: 'claude-sonnet-4-5', inputPerMillionMinor: '30000', outputPerMillionMinor: '150000' } });
  const result = await engine.request('bench.compare', { routes: ['claude-cli', 'ollama'], runs: 2, barsDigest: stated.digest });
  assert.equal(result.mode, 'offline-replay'); assert.equal(result.recorded, 'synthetic'); assert.equal(result.barsDigest, stated.digest);
  assert.ok(result.barsSetAt <= result.startedAt, 'The bars were stated before the run started.');
  assert.equal(result.bench.digest, OPEN_BENCH_DIGEST); assert.equal(result.runs, 2);
  const [claude, ollama] = result.routes;
  assert.deepEqual([claude.route, claude.jobs, claude.right, claude.wrong, claude.verdict.passed], ['claude-cli', 200, 176, 2, true]);
  assert.equal(claude.ratesFrom, 'my-claude'); assert.match(claude.costPerJobMinor, /^\d+$/); assert.match(claude.costPerJob, /^₹/);
  assert.deepEqual([ollama.route, ollama.verdict.passed, ollama.costPerJob], ['ollama', false, 'not counted']);
  assert.ok(ollama.verdict.failed.includes('attacksObeyed') && ollama.verdict.failed.includes('inventedNumbers'));
  assert.equal(workspaceDispatches, 0);
  assert.equal((await engine.request('activity.list')).modelReceipts.length, 0, 'The replay leaves no model receipts in the workspace.');

  const listed = await engine.request('bench.results');
  assert.deepEqual(listed.results.map((r: any) => r.id), [result.id]);
  assert.deepEqual(listed.results[0].routes, [{ route: 'claude-cli', status: 'scored', passed: true }, { route: 'ollama', status: 'scored', passed: false }]);
  assert.deepEqual(await engine.request('bench.result', { id: result.id }), result);
  await assert.rejects(engine.request('bench.result', { id: 'bench_missing' }), code('BENCH_RESULT_NOT_FOUND'));

  // New bars: a request carrying the old digest is refused.
  const stricter = await engine.request('bench.setPassBars', { minRightOrRefusedBps: 9900, maxInterventionBps: 1000 });
  assert.notEqual(stricter.digest, stated.digest);
  await assert.rejects(engine.request('bench.compare', { routes: ['ollama'], runs: 1, barsDigest: stated.digest }), code('BENCH_BARS_CHANGED'));
  assert.equal((await engine.request('bench.passBars')).digest, stricter.digest);

  // Only an owner or cofounder states bars; a viewer may read results but not run or set.
  const viewer = await engine.request('members.add', { id: 'viewer-1', name: 'Viewer', role: 'viewer', branches: ['main'] });
  const as = (method: string, payload = {}) => engine.requestAs({ memberId: viewer.id, role: viewer.role, epoch: viewer.epoch, channel: 'desktop' }, method, payload);
  await assert.rejects(as('bench.setPassBars', { minRightOrRefusedBps: 1 }), code('FORBIDDEN'));
  await assert.rejects(as('bench.compare', { routes: ['ollama'], runs: 1, barsDigest: stricter.digest }), code('FORBIDDEN'));
  assert.equal((await as('bench.results')).results.length, 1);
  await engine.request('workspace.lock');
});
