// Mini apps (wave 6 package 6H1, D39): the desktop side of the locked frame. The Ink app's own policy is passed down to
// blob and srcdoc frames (Chromium inherits it), so a mini app's inline script could never run there; instead the
// frame loads the static sandbox proxy, which the desktop serves with the mini app policy as its header: inline script
// and style only, no network, no frames, no forms, sandboxed even when opened alone. Every other Ink file keeps the
// app's strict policy. A frame inside the window may only go to the proxy or to the app's own blob previews, so an app
// cannot navigate its frame elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MINI_FRAME_CSP } from '../runtime/venture/apps/frame.ts';

const require = createRequire(import.meta.url);
const mini = require('../../app/desktop/mini-frame.cjs');

test('6H1: the proxy is served with the mini app policy as its header, sandboxed; other files keep the app policy', () => {
  assert.equal(mini.MINI_FRAME_PATH, '/mini-frame.html');
  assert.equal(mini.MINI_FRAME_HEADER, `${MINI_FRAME_CSP}; sandbox allow-scripts`, 'the desktop sends the same policy the engine writes into the document');
  assert.match(mini.MINI_FRAME_HEADER, /connect-src 'none'/);
  assert.match(mini.MINI_FRAME_HEADER, /frame-src 'none'/);
  assert.match(mini.MINI_FRAME_HEADER, /form-action 'none'/);
  assert.doesNotMatch(mini.MINI_FRAME_HEADER, /allow-same-origin/);
  assert.equal(mini.policyFor('/mini-frame.html', 'APP'), mini.MINI_FRAME_HEADER);
  assert.equal(mini.policyFor('/index.html', 'APP'), 'APP');
  assert.equal(mini.policyFor('/mini-frame.html.js', 'APP'), 'APP');
});

test('6H1: a frame may only go to the proxy or to the app own blob previews', () => {
  assert.equal(mini.subframeAllowed('chausar://app/mini-frame.html'), true);
  assert.equal(mini.subframeAllowed('blob:chausar://app/1f0c3a40-0000-4000-8000-000000000000'), true);
  assert.equal(mini.subframeAllowed('about:blank'), true);
  assert.equal(mini.subframeAllowed('about:srcdoc'), true);
  assert.equal(mini.subframeAllowed('chausar://app/index.html'), false);
  assert.equal(mini.subframeAllowed('blob:null/1f0c3a40-0000-4000-8000-000000000000'), false, 'a blob an app made itself');
  assert.equal(mini.subframeAllowed('data:text/html,hi'), false);
  assert.equal(mini.subframeAllowed('https://example.com/'), false);
  assert.equal(mini.subframeAllowed('chausar://app/mini-frame.html?x=1'), false);
});

test('6H1: main serves the proxy through the policy and guards frame navigation; the proxy writes only what its parent sends', () => {
  const main = readFileSync('app/desktop/main.cjs', 'utf8');
  assert.match(main, /require\('\.\/mini-frame\.cjs'\)/);
  assert.match(main, /policyFor\(url\.pathname,/);
  assert.match(main, /will-frame-navigate/);
  assert.match(main, /subframeAllowed\(/);
  const proxy = readFileSync('app/ui/public/mini-frame.html', 'utf8');
  assert.ok(proxy.includes(`content="${MINI_FRAME_CSP}"`), 'the proxy carries the policy itself too (the dev server sends no header)');
  assert.match(proxy, /e\.source\s*!==\s*parent/);
  assert.match(proxy, /ui\/notifications\/sandbox-proxy-ready/);
  assert.match(proxy, /ui\/notifications\/sandbox-resource-ready/);
  assert.doesNotMatch(proxy, /https?:\/\//);
});
