import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {Engine} from '../runtime/engine.ts';
import {createLocalServer} from '../runtime/server.ts';
import {assertRetainedReceipts, assertSixUniqueReceiptIds, assertThreeReceipts, seed,
  type PublicRpc} from './fixtures/postgres-transfer-independent-goldens.ts';

// This is a public file-profile preflight of the independent fixture and oracle.
// It is never PostgreSQL transfer/native/recovery qualification. The native gate
// will use the same helper against an exact coordinator-frozen joined candidate.
test('independent September oracle works through public HTTP and a fresh file Engine', {timeout: 60_000}, async t => {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:\\/i);
  const directory = await realpath(await mkdtemp(join(parent, 'chausar-pg-golden-preflight-')));
  const passphrase = 'Synthetic independent PostgreSQL oracle preflight credential';
  let inferenceCalls = 0;
  const apps = new Set<ReturnType<typeof createLocalServer>>();
  const options = {directory, storage: 'experimental-file' as const, demo: true,
    gateway: {http: async () => {inferenceCalls++; throw Error('Live inference is forbidden in this independent fixture.');}}};
  const publicHost = async () => {
    const engine = new Engine(options), app = createLocalServer(engine);
    const {origin, token} = await app.listen(); apps.add(app);
    const rpc: PublicRpc = async (method, payload = {}) => {
      const response = await fetch(`${origin}/api/rpc`, {method: 'POST', headers: {
        'content-type': 'application/json', authorization: `Bearer ${token}`}, body: JSON.stringify({method, payload})});
      const result = await response.json() as {result?: unknown; error?: {code?: string; message?: string}};
      assert.equal(response.status, 200, `${method}: ${result.error?.code ?? 'unknown refusal'} ${result.error?.message ?? ''}`);
      return result.result;
    };
    return {engine, app, rpc};
  };
  t.after(async () => {
    for (const app of apps) await app.close();
    const actual = await realpath(directory), child = relative(parent, actual);
    assert.equal(dirname(actual), parent);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-pg-golden-preflight-'));
    await rm(actual, {recursive: true, force: true});
    assert.equal(inferenceCalls, 0);
  });
  const source = await publicHost();
  await source.rpc('workspace.create', {name: 'Independent synthetic September fixture', pack: 'retail', passphrase, demo: false});
  await seed(source.rpc);
  const first = await assertThreeReceipts(source.rpc);
  await source.app.close(); apps.delete(source.app);
  const reopened = await publicHost();
  await reopened.rpc('workspace.open', {passphrase});
  await assertRetainedReceipts(reopened.rpc, first);
  const second = await assertThreeReceipts(reopened.rpc);
  assertSixUniqueReceiptIds(first, second);
  await assertRetainedReceipts(reopened.rpc, first);
});
