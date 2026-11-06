// Ink v2 wave 4, package 4J9: the hosted app's manifest. /app/manifest.webmanifest is the Ink build's own manifest with
// one change: its name is "Chausar: {business name}" for the business the signed-in owner has open, escaped and at most
// 45 characters, else "Chausar". The name comes from the session's own business list, never from a vault, and nothing
// about the owner (no email, no first name) is ever in it. The /app/ page asks for it with crossorigin="use-credentials",
// so the browser sends the session cookie. Real sockets on this computer only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostedApp } from '../runtime/hosted/app.ts';
import { HostedCustody, newBusinessId } from '../runtime/hosted/custody.ts';
import { FileDirectory } from '../runtime/hosted/directory.ts';
import { DEFAULT_LIMITS } from '../runtime/hosted/limits.ts';
import { DevOutbox } from '../runtime/hosted/mailer.ts';
import { createHostedServer } from '../runtime/hosted/server.ts';
import { createReplayTransport } from '../runtime/venture/models/index.ts';
import { listInkFiles } from '../runtime/ui-ink.ts';

const ORIGIN = 'http://localhost:4397';
const HOST = 'localhost:4397';
const PATH = '/app/manifest.webmanifest';
/** What W3's static manifest looks like (app/ui/public/manifest.webmanifest, copied into the build). */
const INK_MANIFEST = {
  name: 'Chausar', short_name: 'Chausar', start_url: './', scope: './', display: 'standalone',
  background_color: '#fbfbfa', theme_color: '#fbfbfa',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

type Reply = { status: number; headers: IncomingHttpHeaders; text: string };

/** The build's index.html with the given lines in its head. */
const indexWith = (head: string) => `<!doctype html>\n<html lang="en">\n<head>\n  <title>Chausar</title>\n${head}</head>\n<body></body>\n</html>\n`;

async function start(t: any, options: { manifest?: boolean; ink?: boolean; head?: string } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-hosted-manifest-'));
  const custody = HostedCustody.fromKey(randomBytes(32).toString('base64url'));
  const directory = await FileDirectory.open(folder, custody);
  const outbox = new DevOutbox();
  const app = new HostedApp({
    root: folder, rp: { id: 'localhost', name: 'Chausar', origin: ORIGIN }, directory, custody, mailer: outbox, limits: DEFAULT_LIMITS,
    version: '0.1.0-preview.1', modelTransport: createReplayTransport(JSON.parse(await readFile(new URL('./fixtures/venture/e2e/model-replay.json', import.meta.url), 'utf8'))),
    githubTransport: undefined,
  });
  // The manifest never opens a business: every vault the runtime is asked for is counted.
  let opened = 0;
  const get = app.runtime.get.bind(app.runtime);
  (app.runtime as { get: typeof get }).get = (...args: Parameters<typeof get>) => { opened += 1; return get(...args); };
  const inkFolder = join(folder, 'ink'); await mkdir(join(inkFolder, 'assets'), { recursive: true });
  await writeFile(join(inkFolder, 'index.html'), indexWith(options.head ?? ''));
  await writeFile(join(inkFolder, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  if (options.manifest !== false) await writeFile(join(inkFolder, 'manifest.webmanifest'), JSON.stringify(INK_MANIFEST, null, 2));
  const ink = { folder: inkFolder, files: await listInkFiles(inkFolder) };
  const http = createHostedServer(app, { origin: ORIGIN, tls: { kind: 'none' }, trustProxy: false, maxBodyBytes: DEFAULT_LIMITS.maxBodyBytes, ...(options.ink === false ? {} : { ink }) });
  const { port } = await http.listen('127.0.0.1', 0);
  t.after(async () => { await http.close(); await rm(folder, { recursive: true, force: true }); });

  const browser = () => {
    const jar = new Map<string, string>();
    const send = (method: string, path: string, body?: unknown): Promise<Reply> => new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Host: HOST };
      if (method === 'POST') { headers.Origin = ORIGIN; headers['Content-Type'] = 'application/json'; headers['Sec-Fetch-Site'] = 'same-origin'; }
      if (jar.size) headers.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, res => {
        for (const line of [res.headers['set-cookie'] ?? []].flat()) {
          const [pair] = line.split(';'); const at = pair.indexOf('=');
          jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
        }
        let text = ''; res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      });
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
    return { jar, send, get: (path: string) => send('GET', path), post: (path: string, body: unknown) => send('POST', path, body) };
  };

  /** A signed-in browser for this email; with a business name, that business is on the account and open. */
  const owner = async (email: string, business?: string) => {
    const page = browser();
    await page.get('/');
    assert.equal((await page.post('/api/auth/magic-link', { email })).status, 200);
    const token = new URL(outbox.latest(email)!.link).hash.replace('#signin=', '');
    assert.equal((await page.post('/api/auth/magic-link/verify', { token })).status, 200);
    if (business !== undefined) {
      const id = newBusinessId();
      // A directory entry only: its sealed key opens nothing, so a manifest that tried to open the vault would fail.
      await directory.update(state => {
        const user = state.users.find(item => item.email === email)!;
        user.businesses.push({ id, name: business, createdAt: new Date().toISOString(), sealedPassphrase: { v: 1, key: 'x', nonce: 'x', tag: 'x', data: 'x' }, workspaceId: null });
      });
      const selected = await page.post('/api/hosted/select', { businessId: id });
      assert.equal(selected.status, 200, selected.text);
    }
    return page;
  };
  return { port, app, directory, browser, owner, opened: () => opened };
}

const manifestOf = (reply: Reply) => { assert.equal(reply.status, 200, reply.text); return JSON.parse(reply.text) as Record<string, unknown>; };

test('without a session the manifest is Ink\'s own, named "Chausar", personal to nobody and never cached', async t => {
  const env = await start(t);
  const reply = await env.browser().get(PATH);
  assert.deepEqual(manifestOf(reply), INK_MANIFEST);
  assert.equal(reply.headers['content-type'], 'application/manifest+json; charset=utf-8');
  assert.equal(reply.headers['cache-control'], 'no-store');
  assert.match(String(reply.headers.vary ?? ''), /Cookie/);
  assert.match(String(reply.headers['content-security-policy'] ?? ''), /frame-ancestors 'none'/, 'the hosted policy still applies');
  const head = await env.browser().send('HEAD', PATH);
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(env.opened(), 0);
});

test('the signed-in owner\'s open business names the manifest; another owner sees only their own', async t => {
  const env = await start(t);
  const asha = await env.owner('asha@example.com', 'Lumen Studio');
  const ravi = await env.owner('ravi@example.com', 'Tea Stall');
  const named = manifestOf(await asha.get(PATH));
  assert.equal(named.name, 'Chausar: Lumen Studio');
  assert.deepEqual({ ...named, name: 'Chausar' }, INK_MANIFEST, 'only the name changes');
  assert.equal(manifestOf(await ravi.get(PATH)).name, 'Chausar: Tea Stall');
  const text = (await asha.get(PATH)).text;
  assert.equal(/asha|example\.com/i.test(text), false, 'no email or other personal data');
  // No business open, a closed session or a forged cookie: just Chausar.
  assert.equal(manifestOf(await (await env.owner('meera@example.com')).get(PATH)).name, 'Chausar');
  const forged = env.browser();
  forged.jar.set('chausar-session', 'A'.repeat(43));
  assert.equal(manifestOf(await forged.get(PATH)).name, 'Chausar');
  assert.equal(env.opened(), 0, 'no vault was opened for a manifest');
  // Signing out wakes the account's businesses to end that session's phone alerts (4G3): counted apart, before the next
  // manifest, which opens nothing either.
  await asha.post('/api/auth/sign-out', {});
  await env.app.pushSessionsEnding();
  const afterSignOut = env.opened();
  assert.equal(manifestOf(await asha.get(PATH)).name, 'Chausar');
  assert.equal(env.opened(), afterSignOut, 'no vault was opened for a manifest after signing out');
});

test('a session pointed at a business that is not on its account gets no name', async t => {
  const env = await start(t);
  const asha = await env.owner('asha@example.com', 'Lumen Studio');
  await env.owner('ravi@example.com', 'Tea Stall');
  await env.directory.update(state => {
    const ravi = state.users.find(user => user.email === 'ravi@example.com')!;
    const asha = state.users.find(user => user.email === 'asha@example.com')!;
    for (const session of state.sessions) if (session.userId === asha.id) session.businessId = ravi.businesses[0].id;
  });
  assert.equal(manifestOf(await asha.get(PATH)).name, 'Chausar');
});

test('the business name is escaped, cleaned of direction controls, and used only when the whole name fits 45 characters', async t => {
  const env = await start(t);
  const tricky = await env.owner('a@example.com', '<b>Tea & "Co"</b>');
  const reply = await tricky.get(PATH);
  assert.equal(/[<>&]/.test(reply.text), false, 'no raw angle brackets or ampersands in the body');
  assert.equal(manifestOf(reply).name, 'Chausar: <b>Tea & "Co"</b>');
  assert.equal(manifestOf(await (await env.owner('b@example.com', '\u202Eoidut\u202C Studio')).get(PATH)).name, 'Chausar: oidut Studio');
  const fits = 'S'.repeat(36), long = 'S'.repeat(37);
  assert.equal(manifestOf(await (await env.owner('c@example.com', fits)).get(PATH)).name, `Chausar: ${fits}`);
  assert.equal(manifestOf(await (await env.owner('d@example.com', long)).get(PATH)).name, 'Chausar');
  assert.equal(manifestOf(await (await env.owner('e@example.com', 'कार्तव्य स्टूडियो')).get(PATH)).name, 'Chausar: कार्तव्य स्टूडियो');
});

test('a build without a manifest gets a plain one; a server without the build has none', async t => {
  const plain = await start(t, { manifest: false });
  const built = manifestOf(await (await plain.owner('a@example.com', 'Lumen Studio')).get(PATH));
  assert.deepEqual(built, {
    name: 'Chausar: Lumen Studio', short_name: 'Chausar', start_url: './', scope: './', display: 'standalone',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
  const bare = await start(t, { ink: false });
  assert.equal((await bare.browser().get(PATH)).status, 404);
});

test('the hosted page asks for the manifest with the session cookie, once, whatever the build wrote', async t => {
  /** The manifest link tags of the page /app/ serves. */
  const manifestLinks = async (head: string) => {
    const env = await start(t, { head });
    const links: string[][] = [];
    for (const path of ['/app/', '/app/index.html']) {
      const page = await env.browser().get(path);
      assert.equal(page.status, 200);
      assert.match(page.text, /<meta name="chausar-mode" content="hosted">/);
      links.push([...page.text.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]));
    }
    assert.deepEqual(links[0], links[1]);
    return links[0];
  };
  // As 3H1 may write it: the attribute is added.
  assert.deepEqual(await manifestLinks('  <link rel="icon" href="./icon.svg">\n  <link rel="manifest" href="./manifest.webmanifest">\n'),
    ['<link rel="icon" href="./icon.svg">', '<link rel="manifest" href="./manifest.webmanifest" crossorigin="use-credentials">']);
  // Already there: not doubled.
  assert.deepEqual(await manifestLinks('  <link rel="manifest" href="./manifest.webmanifest" crossorigin="use-credentials">\n'),
    ['<link rel="manifest" href="./manifest.webmanifest" crossorigin="use-credentials">']);
  // Another setting, bare or quoted: replaced, so the cookie goes.
  assert.deepEqual(await manifestLinks('  <link crossorigin rel="manifest" href="./manifest.webmanifest" />\n'),
    ['<link rel="manifest" href="./manifest.webmanifest" crossorigin="use-credentials" />']);
  assert.deepEqual(await manifestLinks("  <link rel='manifest' crossorigin='anonymous' href='./manifest.webmanifest'>\n"),
    ["<link rel='manifest' href='./manifest.webmanifest' crossorigin=\"use-credentials\">"]);
  // No manifest link: nothing is added.
  assert.deepEqual(await manifestLinks('  <link rel="icon" href="./icon.svg">\n'), ['<link rel="icon" href="./icon.svg">']);
});
