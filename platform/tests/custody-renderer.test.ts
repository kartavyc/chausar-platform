// Keeping the business safe on this computer, the renderer half (KEYCHAIN-SPEC 7 and 13.2): the "Lock with a
// passphrase" switch in Trust & access, the recovery code, the automatic backups and their restore, moving to another
// computer, Today's quiet line and the workspace menu. Runs the real launch.js and app.js through the shared harness
// (fake DOM, real preload, real IPC validator); the fake engine answers from fixtures/venture/renderer/custody.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTODY_WORDS } from '../runtime/workspace-custody-contracts.ts';
import * as K from './fixtures/venture/renderer/custody.ts';
import { Element, button, buttons, click, descendants, find, flush, hasClass, launchSource, openDialog, place, text, tick, type, visibleText } from './launch-renderer-harness.ts';
import type { EngineOptions } from './launch-renderer-harness.ts';

const TRUST = { 'trust.get': () => ({ policy: { send: 'shape', allowedSources: ['*'], retentionDays: 90, autonomy: false, sharing: false } }), 'members.list': () => [] };
async function trust(engine: EngineOptions = {}) {
  const p = await place('trust', { ...engine, overrides: { ...TRUST, ...(engine.overrides ?? {}) } });
  const panel = find(p.content, node => hasClass(node, 'launch-custody'), 'Expected the custody panel on Trust & access.');
  return { ...p, panel };
}
const switchOf = (host: Element) => find(host, node => node.attributes.role === 'switch');
const callsOf = (h: { calls: { method: string; payload: any }[] }, method: string) => h.calls.filter(call => call.method === method);
const passwords = (host: Element) => descendants(host).filter(node => node.tagName === 'input' && node.attributes.type === 'password');

test('the switch: off opens with this computer, on asks for the passphrase, and on and disabled says why when this computer has no protected storage', async () => {
  const off = await trust();
  assert.equal(off.panel.attributes['data-part'], 'custody');
  assert.equal(find(off.panel, node => node.tagName === 'h1').textContent, 'Keeping your business safe');
  assert.ok(visibleText(off.panel).includes('Encrypted on this computer.'));
  assert.ok(visibleText(off.panel).includes(CUSTODY_WORDS.where['windows-dpapi']), "the engine's words for where the key lives");
  assert.equal(switchOf(off.panel).attributes['aria-checked'], 'false');
  assert.ok(text(switchOf(off.panel)).includes('Lock with a passphrase'));
  assert.ok(visibleText(off.panel).includes("It opens when you're signed in to this computer."));

  const on = await trust({ custody: { view: K.custodyView({ unlock: 'passphrase' }) } });
  assert.equal(switchOf(on.panel).attributes['aria-checked'], 'true');
  assert.ok(visibleText(on.panel).includes('It asks for your passphrase each time it opens.'));

  const stuck = await trust({ custody: { view: K.custodyView({ unlock: 'passphrase', computer: K.computerUnavailable('blocked') }) } });
  assert.equal(switchOf(stuck.panel).attributes['aria-checked'], 'true');
  assert.equal(switchOf(stuck.panel).disabled, true);
  assert.ok(visibleText(stuck.panel).includes(CUSTODY_WORDS.unavailable.blocked), "the engine's reason, word for word");
});

test('turning it on sends the typed passphrase, shows the recovery code once, and clears the fields', async () => {
  const h = await trust({ custody: { view: K.custodyView({ recovery: 'not-made' }) } });
  await click(switchOf(h.panel));
  const sheet = openDialog(h.body);
  assert.equal(sheet.attributes['aria-label'], 'Lock with a passphrase');
  const [first, again] = passwords(sheet);
  await type(first, 'a long enough passphrase');
  await type(again, 'a long enough passphrase');
  await click(button(sheet, 'Lock with this passphrase')); await flush();
  assert.deepEqual(callsOf(h, 'workspace.custody.passphraseOn').map(call => call.payload), [{ passphrase: 'a long enough passphrase' }]);
  assert.equal(first.value, '', 'cleared after the send');
  assert.equal(again.value, '');
  const code = find(h.app, node => hasClass(node, 'ob-code'));
  assert.equal(descendants(code).filter(node => hasClass(node, 'ob-chunk')).map(node => node.textContent).join(''), K.RECOVERY_CODE, 'the chunks rejoin to the exact code');
  await tick(find(h.app, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(h.app, 'Continue')); await flush();
  assert.equal(h.renderer.state.page, 'trust', 'back to Trust & access');
  const panel = find(h.app, node => hasClass(node, 'launch-custody'));
  assert.equal(switchOf(panel).attributes['aria-checked'], 'true');
  assert.equal(text(h.app).includes(K.RECOVERY_CODE), false, 'the code is shown once and kept nowhere');

  // A short passphrase is refused before anything is sent.
  const short = await trust();
  await click(switchOf(short.panel));
  const shortSheet = openDialog(short.body);
  await type(passwords(shortSheet)[0], 'short');
  await click(button(shortSheet, 'Lock with this passphrase'));
  assert.equal(callsOf(short, 'workspace.custody.passphraseOn').length, 0);
});

test('turning it off needs the current passphrase, sends it once, and clears the field', async () => {
  const h = await trust({ custody: { view: K.custodyView({ unlock: 'passphrase' }) } });
  await click(switchOf(h.panel));
  const sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('Type your passphrase to stop asking for it.'));
  const [current] = passwords(sheet);
  await type(current, 'a long enough passphrase');
  await click(button(sheet, 'Stop asking')); await flush();
  assert.deepEqual(callsOf(h, 'workspace.custody.passphraseOff').map(call => call.payload), [{ passphrase: 'a long enough passphrase' }]);
  assert.equal(current.value, '');
  const panel = find(h.app, node => hasClass(node, 'launch-custody'));
  assert.equal(switchOf(panel).attributes['aria-checked'], 'false', "the engine's new state");
});

test('the recovery code: made here without a passphrase; in passphrase mode it asks first; a new one says the old stops working', async () => {
  const none = await trust({ custody: { view: K.custodyView({ recovery: 'not-made' }) } });
  assert.ok(visibleText(none.panel).includes('Recovery code: not made yet'));
  await click(button(none.panel, 'Make a recovery code'));
  const sheet = openDialog(none.body);
  assert.equal(passwords(sheet).length, 0, 'this computer opens it, so no passphrase is asked');
  await click(button(sheet, 'Make the code')); await flush();
  assert.deepEqual(callsOf(none, 'workspace.custody.recoveryCode').map(call => call.payload), [{}]);
  assert.equal(find(none.app, node => hasClass(node, 'ob-code')).textContent, K.RECOVERY_CODE);

  const locked = await trust({ custody: { view: K.custodyView({ unlock: 'passphrase', recovery: 'made' }) } });
  assert.ok(visibleText(locked.panel).includes('Recovery code: made'));
  await click(button(locked.panel, 'Make a new one'));
  const again = openDialog(locked.body);
  assert.ok(text(again).includes('Your old code stops working.'));
  await click(button(again, 'Make a new code'));
  assert.equal(callsOf(locked, 'workspace.custody.recoveryCode').length, 0, 'nothing is sent without the passphrase');
  await type(passwords(again)[0], 'a long enough passphrase');
  await click(button(again, 'Make a new code')); await flush();
  assert.deepEqual(callsOf(locked, 'workspace.custody.recoveryCode').map(call => call.payload), [{ passphrase: 'a long enough passphrase' }]);
});

test('backups: automatic and on this computer, the last one, Back up now, and a restore that is confirmed first', async () => {
  const h = await trust();
  assert.ok(visibleText(h.panel).includes('Backups: automatic, kept on this computer.'));
  assert.ok(visibleText(h.panel).some(line => line.startsWith('Last backup: ')));
  await click(button(h.panel, 'Back up now')); await flush();
  assert.deepEqual(callsOf(h, 'workspace.backups.create').map(call => call.payload), [{}]);
  const panel = find(h.app, node => hasClass(node, 'launch-custody'));
  const all = find(panel, node => node.tagName === 'details' && node.children[0]?.textContent.startsWith('All backups'));
  assert.ok(text(all).includes('Automatic. Opens the way your business opens now.'));
  assert.ok(text(all).includes('You made it. Opens with an older passphrase or code.'));
  await click(buttons(all, 'Restore')[0]);
  const sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('Your business goes back to how it was then. Chausar saves a copy of how it is now first.'));
  assert.equal(callsOf(h, 'workspace.backups.restore').length, 0, 'nothing happens before the confirm');
  await click(button(sheet, 'Restore this copy')); await flush();
  assert.deepEqual(callsOf(h, 'workspace.backups.restore').map(call => call.payload), [{ file: K.backups[0].file, confirmed: true }]);

  const failing = await trust({ custody: { view: K.custodyView({ lastError: 'Back up private files with the encrypted archive first.' }) } });
  assert.ok(text(failing.panel).includes('Back up private files with the encrypted archive first.'), "the engine's words for a failed automatic backup");
});

test('moving: the code in chunks of four that rejoin to the engine string, Save the file passes its text unchanged, and the two warnings', async () => {
  const h = await trust();
  await click(button(h.panel, 'Move to another computer'));
  const sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('Chausar makes one file and one code. On the other computer, choose Move from another computer, then give it both.'));
  await click(button(sheet, 'Make the file')); await flush();
  assert.deepEqual(callsOf(h, 'workspace.transfer.export').map(call => call.payload), [{}]);
  const chunks = descendants(sheet).filter(node => hasClass(node, 'ob-chunk')).map(node => node.textContent);
  assert.equal(chunks.join(''), K.MOVE_CODE);
  assert.ok(chunks.slice(0, -1).every(chunk => chunk.length === 4));
  await click(button(sheet, 'Save the file'));
  assert.deepEqual(h.saved(), [{ filename: 'chausar-move-2026-10-18.backup', type: 'application/json', text: K.MOVE_TEXT }]);
  await click(button(sheet, 'Copy'));
  assert.deepEqual(h.clipboard, [K.MOVE_CODE]);
  assert.ok(text(sheet).includes("Anyone with this file and this code can open your business. Keep them apart, and delete the file once you've moved."));
  assert.ok(text(sheet).includes("The business stays on this computer too. Changes on one computer don't reach the other."));

  const locked = await trust({ custody: { view: K.custodyView({ unlock: 'passphrase' }) } });
  await click(button(locked.panel, 'Move to another computer'));
  const ask = openDialog(locked.body);
  await type(passwords(ask)[0], 'a long enough passphrase');
  await click(button(ask, 'Make the file')); await flush();
  assert.deepEqual(callsOf(locked, 'workspace.transfer.export').map(call => call.payload), [{ passphrase: 'a long enough passphrase' }]);
});

test('Today shows one quiet line only while there is no recovery code, and the workspace menu says Close this business here', async () => {
  const none = await place('today', { custody: { view: K.custodyView({ recovery: 'not-made' }) } });
  const nudge = find(none.content, node => hasClass(node, 'launch-nudge'));
  assert.equal(text(nudge), "Make a recovery code, so you can get back in if this computer's key is lost.");
  await click(button(nudge, 'Make a recovery code'));
  assert.equal(none.renderer.state.page, 'trust');

  const made = await place('today');
  assert.equal(descendants(made.content).some(node => hasClass(node, 'launch-nudge')), false);

  await made.renderer.showWorkspace(); await flush();
  const menu = openDialog(made.body);
  assert.equal(buttons(menu, 'Lock vault').length, 0);
  assert.ok(text(menu).includes('Close this business'));
  assert.ok(text(menu).includes('It opens again without a passphrase on this computer.'));
  assert.ok(text(menu).includes('Backups and lock'));
  const locked = await place('today', { custody: { view: K.custodyView({ unlock: 'passphrase' }) } });
  await locked.renderer.showWorkspace(); await flush();
  assert.ok(text(openDialog(locked.body)).includes('Lock vault'), 'a passphrase business keeps the old words');
});

test("the renderer's copies of the custody words equal the contract, and no secret is kept in the page", async () => {
  const h = await place('today');
  const copies = h.renderer.launch.copies;
  assert.deepEqual(JSON.parse(JSON.stringify(copies.CUSTODY_COPY.unavailable)), { ...CUSTODY_WORDS.unavailable });
  assert.deepEqual(JSON.parse(JSON.stringify(copies.CUSTODY_COPY.errors)), { ...CUSTODY_WORDS.errors });
  assert.equal(copies.CUSTODY_COPY.maxTextChars, 1_900_000);
  for (const storage of ['localStorage', 'sessionStorage', 'indexedDB']) assert.equal(launchSource.includes(storage), false);
  // The recovery code, the move code and passphrases never reach a saved file except the one the owner asked for.
  const panel = await trust({ custody: { view: K.custodyView({ recovery: 'not-made' }) } });
  await click(button(panel.panel, 'Make a recovery code'));
  await click(button(openDialog(panel.body), 'Make the code')); await flush();
  assert.equal(panel.saved().length, 0, 'nothing is saved until the owner asks');
});
