import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const files = require('../../app/desktop/transcription-files.cjs');
const contract = require('../../app/desktop/ipc-contract.cjs');
const contents = { mainFrame: { url: 'chausar://app/index.html' } };
const event = { sender: contents, senderFrame: contents.mainFrame };
function picker(reply: unknown, after?: () => void) {
  const calls: unknown[] = [];
  const deps = { window: { webContents: contents }, assertTrustedSender: contract.assertTrustedSender, publicError: contract.publicError,
    dialog: { showOpenDialog: async (owner: unknown, options: unknown) => { calls.push({ owner, options }); after?.(); return reply; } } };
  return { calls, pick: (kind: unknown, sender: unknown = event) => files.pickTranscriptionFile(sender, kind, deps) };
}
test('the owner picks one transcription path; the dialog never reads or runs it', async () => {
  const { pick, calls } = picker({ canceled: false, filePaths: ['/owner/whisper-cli'] });
  assert.deepEqual(await pick('command'), { ok: true, result: '/owner/whisper-cli' });
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { options: { properties: string[] } }).options.properties, ['openFile']);
});
test('cancel returns no path and invalid kinds never open a dialog', async () => {
  const { pick, calls } = picker({ canceled: true, filePaths: [] });
  assert.deepEqual(await pick('model'), { ok: true, result: null });
  for (const kind of ['other', { kind: 'model', path: '/injected' }, null]) {
    assert.equal((await pick(kind)).error.code, 'INVALID_REQUEST');
  }
  assert.equal(calls.length, 1);
});
test('foreign frames are refused before opening and a navigated frame receives no selected path', async () => {
  const foreign = picker({ canceled: false, filePaths: ['/private/model.bin'] });
  assert.equal((await foreign.pick('model', { sender: {}, senderFrame: {} })).ok, false);
  assert.equal(foreign.calls.length, 0);
  const navigated = picker({ canceled: false, filePaths: ['/private/model.bin'] }, () => { contents.mainFrame.url = 'https://elsewhere.example/'; });
  try { const result = await navigated.pick('model'); assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes('/private')); }
  finally { contents.mainFrame.url = 'chausar://app/index.html'; }
});
