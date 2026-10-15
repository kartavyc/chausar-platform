import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { networkOnline } from '../runtime/gateway-auth/network.ts';

async function engineWith(t: TestContext, networkProbe?: unknown) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-gw-network-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', ...(networkProbe ? { modules: { 'core-gateway-auth': { networkProbe } } } : {}) });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  return engine;
}
const loopback = { lo: [{ address: '127.0.0.1', internal: true, family: 'IPv4' }, { address: '::1', internal: true, family: 'IPv6' }] };

test('network.online answers on the lock screen from injected interfaces, and after unlock', async t => {
  let answer: unknown = { ...loopback, eth0: [{ address: '192.0.2.10', internal: false, family: 'IPv4' }] };
  const engine = await engineWith(t, () => answer);
  const reply = await engine.request('network.online', {});
  assert.deepEqual(Object.keys(reply), ['online', 'basis', 'checkedAt']);
  assert.equal(reply.online, true); assert.equal(reply.basis, 'interfaces'); assert.ok(Number.isFinite(Date.parse(reply.checkedAt)));
  answer = loopback; assert.equal((await engine.request('network.online', {})).online, false);
  answer = { ...loopback, wlan0: [{ address: '169.254.3.4', internal: false }, { address: 'fe80::1', internal: false }] };
  assert.equal((await engine.request('network.online', {})).online, false, 'link-local only is no connection');
  answer = null; assert.equal((await engine.request('network.online', {})).online, null);
  answer = 'garbage'; assert.equal((await engine.request('network.online', {})).online, null);
  await engine.request('workspace.create', { name: 'Synthetic Network Co', passphrase: 'Synthetic gateway network passphrase' });
  answer = { eth0: [{ address: '2001:db8::5', internal: false }] };
  assert.equal((await engine.request('network.online', {})).online, true);
  await assert.rejects(engine.requestAs({ ...engine.bootstrapContext(), channel: 'phone' }, 'network.online', {}), { code: 'OPEN_DESKTOP' });
});

test('network.online uses the real interfaces when no probe is installed and a throwing probe cannot tell', async t => {
  const engine = await engineWith(t);
  const reply = await engine.request('network.online', {});
  assert.ok(reply.online === true || reply.online === false || reply.online === null); assert.equal(reply.basis, 'interfaces');
  assert.equal(networkOnline(() => { throw new Error('synthetic probe failure'); }).online, null);
});
