import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevSample } from '../../scripts/dev-ui-engine.mjs';

test('the UI dev sample uses real authenticated loopback RPC with a sample business and no outside ports', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ui-engine-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sample = await createDevSample({ directory, port: 0 });
  try {
    assert.equal(new URL(sample.origin).hostname, '127.0.0.1');
    assert.equal(sample.engine.options.demo, true);
    assert.equal(sample.engine.options.venture.modelTransport.replay, true);
    await assert.rejects(sample.engine.options.venture.hostProcess({}), /sample/i);
    await assert.rejects(sample.engine.options.venture.net.send({}), /sample/i);
    const call = async (authorization?: string) => fetch(`${sample.origin}/api/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify({ method: 'venture.queue.list', payload: { scope: 'current' } }) });
    assert.equal((await call()).status, 401);
    const answer = await call(`Bearer ${sample.token}`);
    assert.equal(answer.status, 200);
    const body = await answer.json();
    assert.ok(body.result.rows.length > 0);
    assert.ok(JSON.stringify(body.result).includes('Sample Ledger Books'));
  } finally { await sample.close(); }
  await assert.rejects(fetch(`${sample.origin}/api/health`));
});
