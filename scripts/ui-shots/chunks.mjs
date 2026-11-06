// Production-mode chunks on a local static server, with one delayed page and one refused asset.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { Browser, findChrome } from './browser.mjs';
import { runRoot } from '../../platform/runtime/run-root.mjs';
const dist = resolve(process.argv[2] ?? 'app/ui/dist');
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));
const pageFile = name => {
  const entry = manifest[`src/places/${name}/index.tsx`];
  assert.ok(entry?.file, `Missing ${name} in build manifest`);
  return '/' + entry.file;
};
const heldFile = pageFile('today'), refusedFile = pageFile('connections');
const out = runRoot('ui-chunks'); mkdirSync(out, { recursive: true });
const profiles = mkdtempSync(join(out, 'profiles-'));
const browser = new Browser({ chrome: findChrome(), port: 9498, profiles });
const requests = [];
let release, hold = true, refuse = true;
const held = new Promise(resolve => { release = resolve; });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  requests.push(path);
  if (path === heldFile && hold) await held;
  if (path === refusedFile && refuse) { response.writeHead(503, { 'Cache-Control': 'no-store' }); response.end('Unavailable'); return; }
  const file = resolve(dist, '.' + (path === '/' ? '/index.html' : path));
  if (relative(dist, file).startsWith('..')) { response.writeHead(404); response.end(); return; }
  try {
    const content = readFileSync(file);
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(404); response.end(); }
});
const wait = async (expression, label) => {
  for (let n = 0; n < 200; n++) {
    if (await browser.evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const state = await browser.evaluate('({ hash: location.hash, text: document.body.innerText, html: document.querySelector("main")?.outerHTML })');
  writeFileSync(join(out, 'chunks-browser-failure.json'), JSON.stringify({ label, state, requests }, null, 2));
  throw new Error(`Timed out: ${label}; ${JSON.stringify(requests)}; ${JSON.stringify({ hash: state.hash, text: state.text.slice(0, 700) })}`);
};
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await browser.start(); await browser.viewport(1280, 900);
  // Prefetch has its own scheduling tests. Hold it here so this is an unopened page's first failed fetch.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestIdleCallback = () => 1; window.cancelIdleCallback = () => {};' });
  await browser.send('Page.navigate', { url: origin + '/#/today' });
  await wait('!!document.querySelector("nav") && !!document.querySelector("[data-chunk-loading][aria-busy=true]")', 'shell and delayed placeholder');
  assert.equal(await browser.evaluate('!!document.querySelector("main h1")'), false);
  hold = false; release();
  await wait('!!document.querySelector("main h1") && !document.querySelector("[data-chunk-loading]")', 'Today after its chunk');
  await browser.evaluate('location.hash = "#/connections"');
  await wait('document.body.textContent.includes("This page didn\'t load.")', 'failed page owner words');
  assert.equal(await browser.evaluate('!!document.querySelector("nav")'), true);
  refuse = false;
  await browser.click('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Try again")', 'retry page');
  await wait('!!document.querySelector("main h1") && !document.body.textContent.includes("This page didn\'t load.")', 'Connections after retry');
  assert.ok(requests.filter(path => path === refusedFile).length >= 2, 'Retry must request the failed page again');
  await browser.evaluate('location.hash = "#/today?sheet=invoice:inv-0038"');
  await wait('!!Array.from(document.querySelectorAll("aside[data-sheet]")).find(sheet => sheet.textContent.includes("INV-0038"))', 'cross-place invoice sheet');
  writeFileSync(join(out, 'chunks-browser.json'), JSON.stringify({ passed: ['delayed place', 'failed chunk and retry', 'cross-place invoice sheet'], requests }, null, 2));
  console.log('Production chunk loading, retry and cross-place sheet passed.');
} finally {
  hold = false; release();
  await browser.stop();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  rmSync(profiles, { recursive: true, force: true });
}
