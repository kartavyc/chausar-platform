// Wave 6 package 6F7 (D35): phone access on the same Wi-Fi by a one-time pairing link, or away from home through
// Tailscale. It extends the owner's local server (server.ts) and its member sessions rather than adding a second
// pairing: the phone listener accepts only private-network peers, never the desktop bootstrap token, exchanges a
// one-time code from the pairing link for a member session it issued, and gives every request the channel 'phone', so
// whatever the app already keeps to itself (app-only methods, bootstrap-only methods) stays refused on the phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { createPhoneAccess, phoneAddresses, privatePeer } from '../runtime/phone-access.ts';
import { phoneAccessHandler } from '../runtime/venture/notify/phone.ts';
import type { PhoneAccessPort, VentureDeps } from '../runtime/venture/contracts.ts';
import { code, owner, phone, setup } from './venture-views-env.ts';

test('phone addresses: home network ranges are Wi-Fi, 100.64.0.0/10 is Tailscale; loopback, public and IPv6 are left out', () => {
  const found = phoneAddresses({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as any],
    wifi: [{ address: '192.168.1.20', family: 'IPv4', internal: false } as any, { address: 'fe80::1', family: 'IPv6', internal: false } as any],
    office: [{ address: '10.4.0.9', family: 'IPv4', internal: false } as any, { address: '172.20.1.2', family: 'IPv4', internal: false } as any],
    tailscale: [{ address: '100.101.102.103', family: 'IPv4', internal: false } as any],
    wan: [{ address: '203.0.113.7', family: 'IPv4', internal: false } as any, { address: '172.32.0.1', family: 'IPv4', internal: false } as any],
  });
  assert.deepEqual(found, [
    { via: 'wifi', address: '192.168.1.20' }, { via: 'wifi', address: '10.4.0.9' }, { via: 'wifi', address: '172.20.1.2' },
    { via: 'tailscale', address: '100.101.102.103' },
  ]);
  for (const peer of ['192.168.1.30', '::ffff:10.0.0.4', '172.16.0.1', '100.64.0.1', '127.0.0.1', '::1']) assert.equal(privatePeer(peer), true, peer);
  for (const peer of ['8.8.8.8', '::ffff:8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:db8::1', undefined]) assert.equal(privatePeer(peer), false, String(peer));
});

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-phone-wifi-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  const desk = createLocalServer(engine); const { origin, token } = await desk.listen();
  const created = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method: 'workspace.create', payload: { name: 'Phone test', passphrase: 'long-enough-passphrase', demo: false } }) });
  assert.equal(created.status, 200);
  // The test machine's loopback stands in for the Wi-Fi address.
  const access = createPhoneAccess(() => engine, { bind: '127.0.0.1', addresses: () => [{ via: 'wifi', address: '127.0.0.1' }] });
  t.after(async () => { await access.close(); await desk.close(); await rm(directory, { recursive: true, force: true }); });
  return { engine, access, token, origin };
}
async function post(base: string, path: string, body: unknown, bearer?: string) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, ...(await response.json() as any) };
}

test('a pairing link works once, gives a phone session, and the phone keeps the channel phone everywhere', async t => {
  const { access, token: bootstrap } = await fixture(t);
  assert.equal(access.status().on, false);
  const made = await access.link({ via: 'wifi', hours: 12, minutes: 10 });
  const url = new URL(made.link);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  const pairCode = new URLSearchParams(url.hash.slice(1)).get('pair')!;
  assert.match(pairCode, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.search, '', 'the code is in the fragment, which never reaches a server log');
  assert.equal(access.status().on, true);
  const base = url.origin;

  // The desktop's bootstrap token is never accepted on the phone listener, and neither is the desktop's own session route.
  assert.equal((await post(base, '/api/rpc', { method: 'venture.get', payload: {} }, bootstrap)).status, 401);
  assert.equal((await fetch(`${base}/api/session`, { headers: { authorization: `Bearer ${bootstrap}` } })).status, 404);
  assert.equal((await post(base, '/mcp', {}, bootstrap)).status, 404);

  const paired = await post(base, '/api/phone/pair', { code: pairCode });
  assert.equal(paired.status, 200);
  assert.match(paired.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await post(base, '/api/phone/pair', { code: pairCode })).status, 403, 'a pairing code works once');
  assert.equal(access.status().phones, 1);

  // Ordinary reads work; app-only and bootstrap-only methods stay refused, as the code already refuses a phone.
  assert.equal((await post(base, '/api/rpc', { method: 'workspace.status', payload: {} }, paired.token)).status, 200);
  const connect = await post(base, '/api/rpc', { method: 'venture.ai.connect', payload: {} }, paired.token);
  assert.equal(connect.status, 403);
  for (const method of ['venture.compose.decide', 'venture.compose.fill']) assert.equal((await post(base, '/api/rpc', { method, payload: {} }, paired.token)).status, 403, method);
  assert.equal((await post(base, '/api/rpc', { method: 'auth.session', payload: {} }, paired.token)).status, 403, 'a phone cannot mint more sessions');
  for (const method of ['workspace.lock', 'trust.update', 'members.revoke', 'phone.invite']) assert.equal((await post(base, '/api/rpc', { method, payload: {} }, paired.token)).status, 403, method);
  assert.equal((await post(base, '/api/rpc', { method: 'venture.notify.telegram', payload: {} }, paired.token)).error.code, 'APP_APPROVAL_REQUIRED');

  // Stop ends phone access and every phone session.
  await access.stop();
  assert.equal(access.status().on, false);
  assert.equal(access.status().phones, 0);
  await assert.rejects(fetch(`${base}/api/rpc`, { method: 'POST' }));
});

test('an expired or wrong code is refused, and ten wrong codes end every open link', async t => {
  const { access } = await fixture(t);
  const made = await access.link({ via: 'wifi', hours: 1, minutes: 10 });
  const base = new URL(made.link).origin;
  const good = new URLSearchParams(new URL(made.link).hash.slice(1)).get('pair')!;
  for (let i = 0; i < 10; i += 1) assert.equal((await post(base, '/api/phone/pair', { code: 'x'.repeat(43) })).status, 403);
  assert.equal((await post(base, '/api/phone/pair', { code: good })).status, 403, 'the good link ended too');
  assert.equal((await post(base, '/api/phone/pair', { code: 42 })).status, 400);
});

function fakePort(on = false): PhoneAccessPort & { links: unknown[]; stopped: number } {
  const port = {
    links: [] as unknown[], stopped: 0, on,
    status: () => ({ on: port.on, addresses: [{ via: 'wifi' as const, address: '192.168.1.20' }], phones: port.on ? 1 : 0 }),
    link: async (input: unknown) => { port.links.push(input); port.on = true; return { link: 'http://192.168.1.20:43117/#pair=' + 'a'.repeat(43), expiresAt: '2026-10-15T10:10:00.000Z' }; },
    stop: async () => { port.stopped += 1; port.on = false; },
  };
  return port;
}

test('venture.phone.access (app only): read, a one-time link of 10 minutes for 12 hours unless the owner chooses, stop', async () => {
  const env = await setup();
  const port = fakePort();
  const deps: VentureDeps = { ...env.deps, host: 'desktop', phoneAccess: port };
  const call = (payload: unknown, ctx = owner) => phoneAccessHandler(deps, ctx, payload);
  await assert.rejects(call({ action: 'link' }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.deepEqual(await call({}), { on: false, addresses: [{ via: 'wifi', address: '192.168.1.20' }], phones: 0, link: null, expiresAt: null, line: 'Phone access is off. Make a pairing link to open Chausar on your phone.', qr: null });
  const made = await call({ action: 'link' });
  assert.deepEqual(port.links, [{ via: 'wifi', hours: 12, minutes: 10 }]);
  assert.equal(made.line, 'Open this link on your phone within 10 minutes. It works once.');
  assert.match(made.link!, /#pair=/);
  assert.ok(made.qr && made.qr.rows.length === made.qr.size && made.qr.size >= 21, 'the link as a QR code for the phone camera');
  await call({ action: 'link', hours: 3 });
  assert.deepEqual(port.links.at(-1), { via: 'wifi', hours: 3, minutes: 10 });
  for (const bad of [{ action: 'link', hours: 0 }, { action: 'link', hours: 25 }, { action: 'link', via: 'cable' }, { via: 'wifi' }, { action: 'open' }]) {
    await assert.rejects(call(bad), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));
  }
  await assert.rejects(call({ action: 'link', via: 'tailscale' }), code('PHONE_NO_NETWORK'));
  assert.equal((await call({})).line, 'Phone access is on. 1 phone is paired. Some approvals still need this computer.');
  const stopped = await call({ action: 'stop' });
  assert.equal(port.stopped, 1);
  assert.equal(stopped.on, false);
  await assert.rejects(phoneAccessHandler({ ...env.deps, host: 'desktop' }, owner, {}), code('PHONE_ACCESS_UNAVAILABLE'));
  await assert.rejects(phoneAccessHandler({ ...env.deps, host: 'hosted-web', phoneAccess: port }, { ...owner, channel: 'web' }, {}), code('TIER_UNAVAILABLE'));
});
