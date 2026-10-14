import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import ipc from '../../app/desktop/ipc-contract.cjs';
import { createHostController } from '../../app/ui/src/host/controller.ts';
import type { HostRpcPort } from '../../app/ui/src/host/contracts.ts';

async function fixture(t: TestContext, uiPreview = false, legacyRenderer = false) {
  const scratch = resolve(tmpdir()); if (process.platform === 'win32') assert.match(scratch, /^C:\\/i);
  const directory = await mkdtemp(join(scratch, 'chausar-ui-host-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', gateway: {
    http: async () => { throw new Error('No model call is admitted by this host test.'); },
  } });
  const app = createLocalServer(engine, { uiPreview, legacyRenderer }); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(5000); const child = relative(scratch, directory); assert.ok(child && !child.startsWith('..') && !isAbsolute(child)); await rm(directory, { recursive: true, force: true }); });
  async function rpc(method: string, payload: Record<string, unknown> = {}) {
    const reply = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    const data = await reply.json() as {result?: any; error?: {code:string}};
    return { status: reply.status, ...data };
  }
  return { engine, origin, rpc };
}

test('public UI context is current, read-only, invalidates evidence changes and denies revoked identity', async t => {
  const { engine, rpc } = await fixture(t);
  assert.equal((await rpc('ui.context')).error?.code, 'VAULT_LOCKED');
  await rpc('workspace.create', { name: 'Synthetic UI host', folder: 'fixture', passphrase: 'synthetic-ui-passphrase' });
  const initial = (await rpc('ui.context')).result;
  assert.deepEqual(Object.keys(initial).sort(), ['contextKey', 'member', 'workspace']);
  assert.match(initial.contextKey, /^[a-f0-9]{64}$/); assert.equal(initial.member.role, 'owner');
  const revision = engine.vault!.read().revision;
  assert.deepEqual((await rpc('ui.context')).result, initial); assert.equal(engine.vault!.read().revision, revision);
  await rpc('dashboard.get', { period: { from: '2026-10-01', to: '2026-10-31' } });
  assert.equal((await rpc('ui.context')).result.contextKey, initial.contextKey, 'Receipt writes must not invalidate authority.');
  await engine.vault!.update(state => { state.routes.push({id:'synthetic-route',kind:'codex-cli',model:'synthetic',revision:1,enabled:true,costConsumedMinor:'0'}); });
  const configuredKey = (await rpc('ui.context')).result.contextKey;
  await engine.vault!.update(state => { state.routes[0].costConsumedMinor = '20'; });
  assert.equal((await rpc('ui.context')).result.contextKey, configuredKey, 'Dispatch accounting must not invalidate configured authority.');
  await engine.vault!.update(state => { state.routes[0].revision++; });
  assert.notEqual((await rpc('ui.context')).result.contextKey, configuredKey);
  await engine.vault!.update(state => { state.sourceRules.push({ sourceId: 'synthetic', allow: false }); });
  assert.notEqual((await rpc('ui.context')).result.contextKey, initial.contextKey);
  const ownerContext = engine.bootstrapContext();
  await engine.vault!.update(state => { state.members[0]!.epoch++; });
  await assert.rejects(engine.requestAs(ownerContext, 'ui.context'), (error: any) => error.code === 'ACCESS_REVOKED');
});

test('loopback serves the new UI by default and the legacy renderer only behind its explicit flag', async t => {
  const standard = await fixture(t);
  const home = await fetch(`${standard.origin}/`); assert.equal(home.status, 200);
  const homeText = await home.text(); assert.match(homeText, /\/ui\/shell\.js/); assert.doesNotMatch(homeText, /data-legacy/);
  const standardUi = await (await fetch(`${standard.origin}/ui/index.html`)).text();
  assert.match(standardUi, /\/ui\/shell\.js/); assert.doesNotMatch(standardUi, /data-legacy/);
  for (const path of ['/index.html', '/app.js', '/styles.css', '/assets/icon.svg']) assert.equal((await fetch(standard.origin + path)).status, 404);
  const legacy = await fixture(t, false, true);
  const legacyHome = await (await fetch(`${legacy.origin}/`)).text(); assert.doesNotMatch(legacyHome, /\/ui\/shell\.js/);
  assert.equal((await fetch(`${legacy.origin}/index.html`)).status, 200); assert.equal((await fetch(`${legacy.origin}/app.js`)).status, 200);
  assert.match(await (await fetch(`${legacy.origin}/ui/index.html`)).text(), /data-legacy="available"/);
  const preview = await fixture(t, true);
  assert.equal((await fetch(`${preview.origin}/index.html`)).status, 200);
  const reply = await fetch(`${preview.origin}/ui/index.html`);
  assert.equal(reply.status, 200); assert.equal(reply.headers.get('cache-control'), 'no-store');
  const policy = (reply.headers.get('content-security-policy') ?? '').split(';').map(value => value.trim());
  const fontPolicy = policy.find(value => value.startsWith('font-src '))
    ?? policy.find(value => value.startsWith('default-src '));
  assert.match(fontPolicy ?? '', /^(?:font-src|default-src) 'self'$/);
  assert.match(await reply.text(), /\/ui\/shell\.js/);
  for (const [path, mime, limit] of [['/ui/host.js','text/javascript; charset=utf-8',2000000], ['/ui/host.css','text/css; charset=utf-8',200000]] as const) {
    assert.equal((await fetch(standard.origin + path)).status, 200);
    const asset = await fetch(preview.origin + path); assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), mime); assert.equal(asset.headers.get('cache-control'), 'no-store');
    const bytes = await asset.arrayBuffer(); assert.ok(bytes.byteLength > 0 && bytes.byteLength <= limit);
  }
  const fontNames = ['InstrumentSans-400', 'InstrumentSans-500', 'InstrumentSans-600', 'DMMono-400', 'DMMono-500',
    'IBMPlexMono-500', 'NotoSansDevanagari-400', 'NotoSansDevanagari-500'];
  const stylesheet = await (await fetch(preview.origin + '/ui/host.css')).text();
  const fontUrls = [...stylesheet.matchAll(/url\(\s*["']?(\.\/[^\s"')]+\.woff2)["']?\s*\)/g)].map(match => match[1]!);
  assert.deepEqual(fontUrls.slice().sort(), fontNames.map(name => `./${name}.woff2`).sort());
  let totalFontBytes = 0;
  for (const name of fontNames) {
    const expected = await readFile(new URL(`../../app/ui/assets/fonts/${name}.woff2`, import.meta.url));
    assert.equal(expected.subarray(0, 4).toString('ascii'), 'wOF2'); totalFontBytes += expected.length;
    for (const path of [`/ui/${name}.woff2`, `/assets/fonts/${name}.woff2`]) {
      assert.equal((await fetch(standard.origin + path)).status, 200);
      const font = await fetch(preview.origin + path); assert.equal(font.status, 200);
      assert.equal(font.headers.get('content-type'), 'font/woff2'); assert.equal(font.headers.get('cache-control'), 'no-store');
      assert.equal(font.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await font.arrayBuffer()), expected);
    }
  }
  assert.equal(totalFontBytes, 300672); assert.ok(totalFontBytes <= 600000);
  for (const path of ['/ui/src/host/bootstrap.tsx', '/ui/host.js.map', '/assets/fonts/unknown.woff2', '/ui/unknown.woff2',
    '/assets/fonts/manifest.json', '/assets/fonts/InstrumentSans-OFL.txt', '/node_modules/react/package.json'])
    assert.equal((await fetch(preview.origin + path)).status, 404);
  const head = await fetch(`${preview.origin}/ui/index.html`, {method:'HEAD'}); assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('desktop trusts only the selected document and owned main frame while allowing hash navigation', () => {
  const contents = { mainFrame: { url: 'chausar://app/ui/index.html#/today/today' } };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.doesNotThrow(() => ipc.assertTrustedSender(event, contents, 'chausar://app/ui/index.html'));
  assert.throws(() => ipc.assertTrustedSender(event, contents), (error: any) => error.code === 'UNTRUSTED_SENDER');
  for (const url of ['chausar://app/ui/index.html?escape=1', 'chausar://evil/ui/index.html', 'chausar://app/ui/index.html/extra', 'https://app/ui/index.html']) {
    contents.mainFrame.url = url; assert.throws(() => ipc.assertTrustedSender(event, contents, 'chausar://app/ui/index.html'));
  }
  contents.mainFrame.url = 'chausar://app/ui/index.html';
  assert.throws(() => ipc.assertTrustedSender({sender:contents,senderFrame:{url:contents.mainFrame.url}}, contents, 'chausar://app/ui/index.html'));
});

test('actual synthetic Engine transport opens Today with fresh receipts and clears it on lock', async t => {
  const { rpc } = await fixture(t, true);
  assert.equal((await rpc('workspace.create', {name:'Synthetic joined Today',folder:'today',passphrase:'synthetic-today-passphrase',demo:true})).status, 200);
  const port: HostRpcPort = { async request(method, payload) {
    const response = await rpc(method, payload as Record<string, unknown>);
    if (response.error) throw Object.assign(new Error('Synthetic host request refused'), response.error);
    return response.result;
  } };
  const controller = createHostController(port, {now:()=>Date.parse('2026-10-03T12:00:00Z'),timeZone:'UTC',
    dashboard: { title: 'Today', date: '2026-10-03', request: { period: { from: '2026-10-01', to: '2026-10-31' } },
      selections: [{ operation: 'billed', figureKey: 'total' }, { operation: 'received', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }] } });
  t.after(()=>controller.dispose()); await controller.refresh();
  const state = controller.snapshot(); assert.equal(state.phase, 'ready', state.code);
  assert.equal(state.selectedRouteId, null); assert.equal(state.context?.workspace.demo, true);
  assert.ok(state.today); assert.equal(state.today.receipts.length, 4);
  const receipt = state.today.receipts[0]!;
  await controller.openReceipt(receipt.id, {place:'today',sub:'today',sheet:receipt.id});
  assert.equal(controller.snapshot().receipt?.kind, 'ready');
  await controller.lock(); assert.equal(controller.snapshot().phase, 'locked');
  assert.equal(controller.snapshot().today, null); assert.equal(controller.snapshot().receipt, null);
});

test('failed custody capture still closes the encrypted workspace and clears its authority', async t => {
  const { engine, rpc } = await fixture(t);
  await rpc('workspace.create', {name:'Synthetic close guard',folder:'close',passphrase:'synthetic-close-passphrase'});
  // Explicit invalid synthetic marker exercises the same fail-safe close path
  // as a bounded custody capture refusal; it is not native/storage proof.
  await engine.vault!.update(state => {state.tombstones.push({kind:'invoice-operation-no-resend-v1',identity:'invalid-synthetic-marker'});});
  assert.equal((await rpc('workspace.lock')).error?.code, 'INVOICE_CUSTODY_INVALID');
  assert.equal(engine.vault, null); assert.equal((await rpc('workspace.status')).result.open, false);
  assert.equal((await rpc('ui.context')).error?.code, 'VAULT_LOCKED');
});
