// Wave 6 package 6I1 (D45): push-to-talk opens the microphone through Electron's permission handler only for a session
// the engine just started (venture.talk.start), once, in the trusted main frame, audio only, after the engine confirms
// the session is still open (venture.talk.get). Hearing, a withdrawn notice or an expired lease close it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { captionPermission } = require('../../app/desktop/caption-permission.cjs');
const document = 'chausar://app/index.html';
const details = { isMainFrame: true, requestingUrl: document, mediaTypes: ['audio'] };

function gate(options: { now?: () => number; verifyTalk?: (sessionId: string) => Promise<boolean> } = {}) {
  const contents = { mainFrame: { url: document } };
  const checked: string[] = [];
  const permission = captionPermission({
    window: () => ({ webContents: contents }), isTrustedDocument: (url: string) => url === document,
    verify: async () => { throw new Error('a talk lease never asks the caption check'); }, now: options.now ?? (() => 1000),
    verifyTalk: options.verifyTalk ?? (async (sessionId: string) => { checked.push(sessionId); return true; }),
  });
  return { permission, contents, checked };
}
const start = { method: 'venture.talk.start', payload: {} };
const started = { sessionId: 'talk_1', expiresAt: '2026-11-01T10:01:00.000Z', seconds: 20, provider: 'whisper-local' };

test('a started talk session lets the microphone open once, audio only, after the engine confirms it', async () => {
  const { permission, contents, checked } = gate();
  assert.equal(await permission.request(contents, 'media', details), false, 'nothing before a start');
  permission.observe(start, started);
  assert.equal(permission.check(contents, 'media', document, details), false, 'never a reusable grant');
  assert.equal(await permission.request(contents, 'media', { ...details, mediaTypes: ['audio', 'video'] }), false, 'never the camera');
  assert.equal(await permission.request(contents, 'media', details), true);
  assert.deepEqual(checked, ['talk_1']);
  assert.equal(await permission.request(contents, 'media', details), false, 'one use');
});

test('a refused start, a hearing, a withdrawn notice, an expired lease or a closed session never open it', async () => {
  let now = 1000;
  let open = true;
  const { permission, contents } = gate({ now: () => now, verifyTalk: async () => open });
  permission.observe(start, { sessionId: 7 });
  assert.equal(await permission.request(contents, 'media', details), false, 'a reply without a session id grants nothing');
  permission.observe(start, started);
  permission.observe({ method: 'venture.talk.hear', payload: { sessionId: 'talk_1', audioBase64: 'x' } }, null);
  assert.equal(await permission.request(contents, 'media', details), false);
  permission.observe(start, started);
  permission.observe({ method: 'venture.talk.consent', payload: { withdraw: true } }, {});
  assert.equal(await permission.request(contents, 'media', details), false);
  permission.observe(start, started);
  now += 31_000;
  assert.equal(await permission.request(contents, 'media', details), false);
  now = 1000;
  permission.observe(start, started);
  open = false;
  assert.equal(await permission.request(contents, 'media', details), false);
});
