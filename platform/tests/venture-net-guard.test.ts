// The network guard (venture/core/net-guard.ts, catalogue H16): any address an agent opens or a client supplies is
// http(s) only, carries no user info, and never reaches a private, loopback, link-local, metadata or reserved address
// in any spelling, before or after DNS. Every redirect hop is checked again and the request goes to the checked
// address. DNS is stubbed everywhere; the one real socket is a loopback server the sender is pointed at by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import {
  NET_LIMITS, checkUrl, classifyAddress, guardedFetch, pinnedLookup, pinnedSend, resolvePublic, type NetAddress, type PinnedTarget,
} from '../runtime/venture/core/net-guard.ts';
import { setAlertWebhook, type BankSettings } from '../runtime/venture/build/bank.ts';
import type { Context } from '../runtime/contracts.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const v4 = (address: string): NetAddress => ({ address, family: 4 });
const PUBLIC = '93.184.216.34';

/** A DNS stub: a table of names, and a log of every name asked. */
function dns(table: Record<string, string[]>) {
  const asked: string[] = [];
  const resolve = async (hostname: string): Promise<NetAddress[]> => {
    asked.push(hostname);
    const found = table[hostname];
    if (!found) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return found.map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return { resolve, asked };
}

/** A sender stub: answers by URL, and records every target it was handed. */
function sender(answers: Record<string, { status: number; headers?: Record<string, string>; body?: string }>) {
  const seen: PinnedTarget[] = [];
  const send = async (target: PinnedTarget) => {
    seen.push(target);
    const answer = answers[target.url.href] ?? { status: 404 };
    return { status: answer.status, headers: answer.headers ?? {}, body: Buffer.from(answer.body ?? '') };
  };
  return { send, seen };
}

// ---------------------------------------------------------------------------
// 1. Addresses in every spelling
// ---------------------------------------------------------------------------

test('addresses: private, loopback, link-local, metadata and reserved IPv4 are refused; public ones pass', () => {
  const refused: Record<string, string> = {
    '127.0.0.1': 'loopback', '127.255.0.9': 'loopback', '10.1.2.3': 'private', '172.16.0.1': 'private', '172.31.255.254': 'private',
    '192.168.1.1': 'private', '169.254.169.254': 'metadata', '169.254.170.2': 'metadata', '169.254.1.1': 'link-local',
    '100.64.0.1': 'shared', '100.100.100.200': 'metadata', '0.0.0.0': 'unspecified', '0.1.2.3': 'unspecified', '224.0.0.1': 'multicast',
    '239.255.255.250': 'multicast', '255.255.255.255': 'reserved', '240.0.0.1': 'reserved', '192.0.2.10': 'documentation',
    '198.51.100.7': 'documentation', '203.0.113.5': 'documentation', '198.18.0.1': 'benchmark', '192.0.0.192': 'metadata',
  };
  for (const [address, reason] of Object.entries(refused)) assert.equal(classifyAddress(address), reason, address);
  for (const address of [PUBLIC, '8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '11.0.0.1']) assert.equal(classifyAddress(address), 'public', address);
});

test('addresses: decimal, octal, hex and short IPv4 spellings are read the way a socket reads them', () => {
  for (const spelling of ['2130706433', '0x7f000001', '0177.0.0.1', '0x7f.0.0.1', '127.1', '0x7f.1', '017700000001', '127.0.1']) {
    assert.equal(classifyAddress(spelling), 'loopback', spelling);
  }
  assert.equal(classifyAddress('2852039166'), 'metadata', '169.254.169.254 as one number');
  assert.equal(classifyAddress('0xa9.0xfe.0xa9.0xfe'), 'metadata');
  assert.equal(classifyAddress('012.0.0.1'), 'private', 'octal 012 is 10');
  assert.equal(classifyAddress('1572395042'), 'public', '93.184.216.34 as one number');
});

test('addresses: IPv6, IPv4-mapped, NAT64 and 6to4 forms are judged by what they reach', () => {
  const refused: Record<string, string> = {
    '::1': 'loopback', '::': 'unspecified', '0:0:0:0:0:0:0:1': 'loopback', 'fe80::1': 'link-local', 'fe80::1%eth0': 'link-local',
    'fc00::1': 'private', 'fd12:3456::1': 'private', 'fd00:ec2::254': 'metadata', 'ff02::1': 'multicast', 'fec0::1': 'private',
    '::ffff:127.0.0.1': 'loopback', '::ffff:7f00:1': 'loopback', '0:0:0:0:0:ffff:7f00:1': 'loopback', '::ffff:a9fe:a9fe': 'metadata',
    '::ffff:10.0.0.1': 'private', '64:ff9b::a9fe:a9fe': 'metadata', '64:ff9b::127.0.0.1': 'loopback', '2002:7f00:1::': 'loopback',
    '2002:c0a8:101::1': 'private', '2001:db8::1': 'documentation', '2001::1': 'reserved', '::127.0.0.1': 'reserved', '100::1': 'reserved',
    '[::1]': 'loopback',
  };
  for (const [address, reason] of Object.entries(refused)) assert.equal(classifyAddress(address), reason, address);
  for (const address of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:93.184.216.34', '64:ff9b::5db8:d822', '2002:5db8:d822::1']) {
    assert.equal(classifyAddress(address), 'public', address);
  }
  assert.equal(classifyAddress('not an address'), null);
});

// ---------------------------------------------------------------------------
// 2. The address itself: scheme, user info and names that only mean "this computer" or "this network"
// ---------------------------------------------------------------------------

test('checkUrl: http(s) only, no user info, and no internal address in any spelling the URL parser accepts', () => {
  for (const url of ['ftp://example.com/a', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://example.com/', 'data:text/plain,hi', 'ws://example.com/', 'not a url', '']) {
    assert.throws(() => checkUrl(url), code('NET_URL_REFUSED'), url);
  }
  for (const url of ['https://user:pass@example.com/', 'https://user@example.com/', 'http://:secret@example.com/']) assert.throws(() => checkUrl(url), code('NET_URL_REFUSED'), url);
  for (const url of [
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.1/', 'http://0x7f.1/', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://[0:0:0:0:0:ffff:7f00:1]/', 'http://169.254.169.254/latest/meta-data/', 'http://[fd00:ec2::254]/',
    'http://localhost:8080/', 'http://LOCALHOST./', 'http://api.localhost/', 'http://metadata.google.internal/', 'http://printer.local/',
    'http://router.home.arpa/', 'http://intranet/', 'http://10.0.0.1:3000/admin',
  ]) assert.throws(() => checkUrl(url), code('NET_ADDRESS_REFUSED'), url);
  const ok = checkUrl('https://example.com/a?b=1');
  assert.equal(ok.href, 'https://example.com/a?b=1');
  assert.equal(checkUrl(`http://${PUBLIC}:8080/x`).hostname, PUBLIC);
});

// ---------------------------------------------------------------------------
// 3. After DNS
// ---------------------------------------------------------------------------

test('resolvePublic: every address a name resolves to must be public; failures and empty answers refuse', async () => {
  const { resolve } = dns({
    'good.example': [PUBLIC, '2606:4700:4700::1111'], 'evil.example': ['10.0.0.5'], 'mixed.example': [PUBLIC, '127.0.0.1'],
    'mapped.example': ['::ffff:169.254.169.254'], 'empty.example': [],
  });
  assert.deepEqual(await resolvePublic('good.example', resolve), v4(PUBLIC));
  await assert.rejects(resolvePublic('evil.example', resolve), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(resolvePublic('mixed.example', resolve), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(resolvePublic('mapped.example', resolve), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(resolvePublic('empty.example', resolve), code('NET_LOOKUP_FAILED'));
  await assert.rejects(resolvePublic('missing.example', resolve), code('NET_LOOKUP_FAILED'));
  // A literal address is checked as it is, with no lookup.
  assert.deepEqual(await resolvePublic(PUBLIC, async () => { throw new Error('no lookup for a literal'); }), v4(PUBLIC));
  await assert.rejects(resolvePublic('127.0.0.1', resolve), code('NET_ADDRESS_REFUSED'));
});

// ---------------------------------------------------------------------------
// 4. The request: the checked address, every hop checked again
// ---------------------------------------------------------------------------

test('guardedFetch: the request goes to the address that was checked, under the name the URL gave', async () => {
  const { resolve, asked } = dns({ 'api.example.com': [PUBLIC] });
  const { send, seen } = sender({ 'https://api.example.com/v1/items?page=2': { status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } } });
  const response = await guardedFetch({ url: 'https://api.example.com/v1/items?page=2', headers: { accept: 'application/json' } }, { resolve, send });
  assert.equal(response.status, 200);
  assert.equal(response.body.toString('utf8'), '{"ok":true}');
  assert.equal(response.url, 'https://api.example.com/v1/items?page=2');
  assert.equal(response.address, PUBLIC);
  assert.deepEqual(asked, ['api.example.com']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].address, PUBLIC);
  assert.equal(seen[0].family, 4);
  assert.equal(seen[0].url.hostname, 'api.example.com');
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].headers.accept, 'application/json');
  assert.ok(seen[0].timeoutMs > 0 && seen[0].timeoutMs <= NET_LIMITS.timeoutMs);
  assert.equal(seen[0].maxBytes, NET_LIMITS.maxBytes);
});

test('guardedFetch: a name that resolves inside the network is refused before anything is sent', async () => {
  const { resolve } = dns({ 'rebind.example': ['192.168.0.10'] });
  const { send, seen } = sender({});
  await assert.rejects(guardedFetch({ url: 'http://rebind.example/' }, { resolve, send }), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(guardedFetch({ url: 'http://0x7f000001/' }, { resolve, send }), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(guardedFetch({ url: 'https://user:pw@api.example.com/' }, { resolve, send }), code('NET_URL_REFUSED'));
  assert.equal(seen.length, 0);
});

test('guardedFetch: every redirect hop is checked again, by its own lookup, and a hop inside the network stops the chain', async () => {
  const { resolve, asked } = dns({ 'a.example': [PUBLIC], 'b.example': ['8.8.8.8'], 'inside.example': ['10.0.0.7'] });
  const { send, seen } = sender({
    'https://a.example/start': { status: 302, headers: { location: 'https://b.example/next' } },
    'https://b.example/next': { status: 301, headers: { location: '/final' } },
    'https://b.example/final': { status: 200, body: 'done' },
    'https://a.example/to-metadata': { status: 307, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
    'https://a.example/to-inside': { status: 302, headers: { location: 'https://inside.example/admin' } },
    'https://a.example/to-file': { status: 302, headers: { location: 'file:///etc/passwd' } },
    'https://a.example/to-decimal': { status: 302, headers: { location: 'http://2130706433/' } },
  });
  const followed = await guardedFetch({ url: 'https://a.example/start' }, { resolve, send });
  assert.equal(followed.status, 200);
  assert.equal(followed.url, 'https://b.example/final');
  assert.deepEqual(followed.hops, ['https://a.example/start', 'https://b.example/next', 'https://b.example/final']);
  assert.deepEqual(seen.map(target => target.address), [PUBLIC, '8.8.8.8', '8.8.8.8']);
  assert.deepEqual(asked, ['a.example', 'b.example', 'b.example']);

  seen.length = 0;
  await assert.rejects(guardedFetch({ url: 'https://a.example/to-metadata' }, { resolve, send }), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(guardedFetch({ url: 'https://a.example/to-inside' }, { resolve, send }), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(guardedFetch({ url: 'https://a.example/to-file' }, { resolve, send }), code('NET_URL_REFUSED'));
  await assert.rejects(guardedFetch({ url: 'https://a.example/to-decimal' }, { resolve, send }), code('NET_ADDRESS_REFUSED'));
  assert.equal(seen.length, 4, 'only the first hop of each chain was sent');
  assert.ok(seen.every(target => target.url.hostname === 'a.example'));
});

test('guardedFetch: too many hops, a redirect after a write, and credentials across origins', async () => {
  const { resolve } = dns({ 'a.example': [PUBLIC], 'b.example': ['8.8.8.8'] });
  const loop = sender({ 'https://a.example/loop': { status: 302, headers: { location: 'https://a.example/loop' } } });
  await assert.rejects(guardedFetch({ url: 'https://a.example/loop' }, { resolve, send: loop.send }), code('NET_TOO_MANY_REDIRECTS'));
  assert.equal(loop.seen.length, NET_LIMITS.maxRedirects + 1);

  const post = sender({ 'https://a.example/form': { status: 303, headers: { location: 'https://b.example/thanks' } } });
  await assert.rejects(guardedFetch({ url: 'https://a.example/form', method: 'POST', body: 'x=1' }, { resolve, send: post.send }), code('NET_REDIRECT_REFUSED'));
  assert.equal(post.seen.length, 1);

  const away = sender({
    'https://a.example/go': { status: 302, headers: { location: 'https://b.example/landing' } },
    'https://b.example/landing': { status: 200, body: 'ok' },
  });
  // 4J11 (H31): a request that carries a sign-in never follows a redirect at all, so no credential goes anywhere else.
  await assert.rejects(guardedFetch({ url: 'https://a.example/go', headers: { authorization: 'Bearer abc', cookie: 'sid=1', accept: 'text/plain' } }, { resolve, send: away.send }), code('NET_REDIRECT_REFUSED'));
  assert.equal(away.seen[0].headers.authorization, 'Bearer abc');
  assert.equal(away.seen.length, 1, 'nothing went to another origin');

  const blank = sender({ 'https://a.example/nowhere': { status: 302 } });
  await assert.rejects(guardedFetch({ url: 'https://a.example/nowhere' }, { resolve, send: blank.send }), code('NET_REDIRECT_REFUSED'));
});

test('guardedFetch: one deadline for the whole chain, never reset by a hop', async () => {
  const { resolve } = dns({ 'a.example': [PUBLIC] });
  const budgets: number[] = [];
  let hop = 0;
  const send = async (target: PinnedTarget) => {
    budgets.push(target.timeoutMs);
    hop += 1;
    await new Promise(resolve => setTimeout(resolve, 30));
    const headers: Record<string, string> = hop < 3 ? { location: `https://a.example/${hop}` } : {};
    return { status: hop < 3 ? 302 : 200, headers, body: Buffer.from('') };
  };
  await guardedFetch({ url: 'https://a.example/0', timeoutMs: 1000 }, { resolve, send });
  assert.equal(budgets.length, 3);
  assert.ok(budgets[1] < budgets[0] && budgets[2] < budgets[1], budgets.join(','));
  const slow = async () => { await new Promise(resolve => setTimeout(resolve, 60)); return { status: 302, headers: { location: 'https://a.example/again' }, body: Buffer.from('') }; };
  await assert.rejects(guardedFetch({ url: 'https://a.example/0', timeoutMs: 100 }, { resolve, send: slow }), code('NET_TIMEOUT'));
});

// ---------------------------------------------------------------------------
// 5. The real sender: pinned to the checked address
// ---------------------------------------------------------------------------

test('pinnedLookup answers every lookup with the checked address, in both callback shapes', () => {
  const lookup = pinnedLookup(v4(PUBLIC));
  lookup('evil.example', {}, (error: unknown, address: unknown, family: unknown) => {
    assert.equal(error, null);
    assert.equal(address, PUBLIC);
    assert.equal(family, 4);
  });
  lookup('evil.example', { all: true }, (error: unknown, addresses: unknown) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: PUBLIC, family: 4 }]);
  });
});

test('pinnedSend connects to the pinned address, keeps the name in the Host header, caps the body and stops at the deadline', async () => {
  let lastHeaders: IncomingHttpHeaders = {};
  const server = createServer((request, response) => {
    lastHeaders = request.headers;
    if (request.url === '/big') { response.writeHead(200); response.end('x'.repeat(5000)); return; }
    if (request.url === '/slow') { setTimeout(() => { response.writeHead(200); response.end('late'); }, 500); return; }
    response.writeHead(200, { 'content-type': 'text/plain', 'x-extra': 'yes' });
    response.end(`hello ${request.method}`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  // The name does not exist anywhere; only the pinned address lets the socket connect.
  const target = (path: string, extra: Partial<PinnedTarget> = {}): PinnedTarget => ({
    url: new URL(`http://pinned-name.invalid:${port}${path}`), address: '127.0.0.1', family: 4, method: 'GET', headers: { accept: 'text/plain' },
    body: undefined, timeoutMs: 2000, maxBytes: 1024, ...extra,
  });
  try {
    const answer = await pinnedSend(target('/hello'));
    assert.equal(answer.status, 200);
    assert.equal(answer.body.toString('utf8'), 'hello GET');
    assert.equal(answer.headers['x-extra'], 'yes');
    assert.equal(lastHeaders.host, `pinned-name.invalid:${port}`);
    await assert.rejects(pinnedSend(target('/big')), code('NET_RESPONSE_TOO_LARGE'));
    await assert.rejects(pinnedSend(target('/slow', { timeoutMs: 100 })), code('NET_TIMEOUT'));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// 6. Where an owner names an address: the bank alert webhook
// ---------------------------------------------------------------------------

test('bank alerts: the address the owner sets cannot point inside the network', () => {
  const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  const settings: BankSettings = { consent: null, polls: [], rules: [], alertWebhook: null };
  const at = '2026-10-21T10:00:00.000Z';
  for (const url of ['https://169.254.169.254/hook', 'https://localhost/hook', 'https://[::1]/hook', 'https://2130706433/hook', 'https://10.0.0.1/hook', 'https://hooks.internal/a']) {
    assert.throws(() => setAlertWebhook(settings, url, owner, at), code('NET_ADDRESS_REFUSED'), url);
  }
  assert.throws(() => setAlertWebhook(settings, 'https://user:pw@hooks.example.test/a', owner, at), code('INVALID_VENTURE_REQUEST'));
  assert.equal(setAlertWebhook(settings, 'https://hooks.example.test/a', owner, at).alertWebhook?.url, 'https://hooks.example.test/a');
});

// ---------------------------------------------------------------------------
// 7. House rules
// ---------------------------------------------------------------------------

test('static: the guard throws only declared codes, keeps the house style and uses no global fetch', async () => {
  const source = await readFile(new URL('../runtime/venture/core/net-guard.ts', import.meta.url), 'utf8');
  for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]), match[1]);
  for (const needed of ['NET_URL_REFUSED', 'NET_ADDRESS_REFUSED', 'NET_LOOKUP_FAILED', 'NET_REDIRECT_REFUSED', 'NET_TOO_MANY_REDIRECTS', 'NET_RESPONSE_TOO_LARGE', 'NET_TIMEOUT', 'NET_FAILED']) {
    assert.ok((VENTURE_ERRORS as readonly string[]).includes(needed), needed);
  }
  assert.deepEqual(houseStyleFindings(source), []);
  assert.doesNotMatch(source, /\bfetch\(/, 'a global fetch would resolve the name again, after the check');
});
