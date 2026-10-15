import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPhoneWebPreviewServer } from '../../scripts/phone-web-preview.mjs';

async function withPreview(run: (port: number) => Promise<void>) {
  const server = createPhoneWebPreviewServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address() as AddressInfo;
    assert.equal(address.address, '127.0.0.1');
    await run(address.port);
  } finally { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); }
}
function get(port: number, path: string, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method, path, agent: false }, response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body }));
    });
    req.on('error', reject); req.end();
  });
}

test('phone preview serves a local synthetic entry page with restrictive response headers', async () => {
  await withPreview(async port => {
    const result = await get(port, '/');
    assert.equal(result.status, 200);
    assert.match(String(result.headers['content-type']), /^text\/html/);
    assert.match(result.body, /Developer preview/);
    assert.match(result.body, /\/app\/companion\/web\/app\.mjs/);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    assert.equal(result.headers['referrer-policy'], 'no-referrer');
    assert.equal(result.headers['cross-origin-resource-policy'], 'same-origin');
    assert.match(String(result.headers['content-security-policy']), /default-src 'none'/);
    assert.match(String(result.headers['content-security-policy']), /connect-src 'self'/);
    assert.match(String(result.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.doesNotMatch(String(result.headers['content-security-policy']), /unsafe-inline|unsafe-eval|https:/);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  });
});

test('preview serves external stylesheet and DOM app with correct MIME types', async () => {
  await withPreview(async port => {
    const css = await get(port, '/app/companion/web/styles.css');
    assert.equal(css.status, 200); assert.match(String(css.headers['content-type']), /^text\/css/);
    const script = await get(port, '/app/companion/web/app.mjs');
    assert.equal(script.status, 200); assert.match(String(script.headers['content-type']), /^application\/javascript/);
    assert.match(script.body, /createWebPreviewController/);
  });
});

test('portable TypeScript is stripped before browser delivery', async () => {
  await withPreview(async port => {
    const view = await get(port, '/app/companion/shared/view-contracts.ts');
    assert.equal(view.status, 200); assert.match(String(view.headers['content-type']), /^application\/javascript/);
    assert.match(view.body, /export const requestLabel/);
    assert.doesNotMatch(view.body, /import type|export interface|export type/);
    const contracts = await get(port, '/platform/runtime/phone/contracts.ts');
    assert.equal(contracts.status, 200); assert.match(contracts.body, /class PhoneError/);
    assert.doesNotMatch(contracts.body, /export type PhoneChannel|asserts condition/);
  });
});

test('closed asset allowlist hides the desktop engine, workspace files and arbitrary modules', async () => {
  await withPreview(async port => {
    for (const path of ['/api/session', '/api/rpc', '/mcp', '/package.json', '/.env', '/.git/config', '/platform/runtime/server.ts', '/platform/runtime/phone/approval.ts', '/app/renderer/app.js', '/app/companion/shared/not-an-asset.ts', '/favicon.ico']) {
      const result = await get(port, path);
      assert.equal(result.status, 404, path); assert.equal(result.body, 'Preview route not found.');
    }
  });
});

test('raw, encoded and backslash traversal routes never reach files', async () => {
  await withPreview(async port => {
    for (const path of ['/../package.json', '/app/companion/web/../shared/view-contracts.ts', '/app/companion/web/./app.mjs', '/%2e%2e/package.json', '/app%2fcompanion%2fweb%2fapp.mjs', '/app\\companion\\web\\app.mjs', '/%252e%252e/package.json']) {
      const result = await get(port, path);
      assert.equal(result.status, 400, path); assert.equal(result.body, 'Invalid preview route.');
    }
  });
});

test('all query strings are rejected and values are never echoed', async () => {
  await withPreview(async port => {
    const result = await get(port, '/?fixture=sensitive-fixture-never-echo');
    assert.equal(result.status, 400);
    assert.equal(result.body, 'Invalid preview route.');
    assert.doesNotMatch(result.body, /sensitive-fixture/);
  });
});

test('preview accepts GET only and has no mutation or engine transport endpoint', async () => {
  await withPreview(async port => {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
      const result = await get(port, '/', method); assert.equal(result.status, 405, method); assert.equal(result.headers.allow, 'GET');
    }
  });
});

test('every runtime browser import resolves within the closed portable module graph', async () => {
  await withPreview(async port => {
    const pending = ['/app/companion/web/app.mjs'];
    const seen = new Set<string>();
    while (pending.length) {
      const path = pending.shift()!; if (seen.has(path)) continue; seen.add(path);
      const result = await get(port, path);
      assert.equal(result.status, 200, `Missing browser module ${path}`);
      assert.match(String(result.headers['content-type']), /^application\/javascript/);
      // Strip removes type-only imports. This follows the real remaining runtime
      // graph, including the app's dynamic import, without launching a browser.
      const imports = [...result.body.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
      for (const specifier of imports) {
        assert.ok(specifier.startsWith('./') || specifier.startsWith('../'), `Nonportable browser import in ${path}`);
        pending.push(new URL(specifier, `http://127.0.0.1${path}`).pathname);
      }
    }
    assert.ok(seen.has('/app/companion/shared/web-runtime.ts'));
    assert.ok(seen.has('/platform/runtime/phone/client.ts'));
    assert.ok(seen.has('/platform/runtime/phone/cache.ts'));
    // Nine base modules plus the experimental phone page's shared model and web renderer.
    assert.ok(seen.has('/app/companion/shared/phone-page.ts') && seen.has('/app/companion/web/phone-page.mjs'));
    assert.ok(seen.size <= 11, 'Unexpectedly broadened browser module graph');
  });
});
