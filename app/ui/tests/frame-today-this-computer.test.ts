import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createFakeEngine, FAKE_PRE_VAULT, registerFakeMethods } from '../src/bridge/fake.ts';
import { importsFixture, SYNTHETIC_PDF_PASSWORD } from '../src/bridge/fixtures/imports.ts';
import {
  isDeviceChoices, isDiskCheckReply, isIdentityCheckReply, isRecoveryContactReply, isWorkspaceFoldersReply, TODAYX_REFUSALS,
} from '../src/bridge/todayx-contract.ts';
import {
  askLineKey, askRecoveryContact, diskLineKey, keyringLineKey, readDeviceChoices, readDiskCheck, readRecoveryContact, readWorkspaceFolders,
  saveDeviceChoices, saveRecoveryContact,
} from '../src/screens/first-run/this-computer.ts';
import { formatOf, PDF_REFUSALS, validatePdfPreview, validateReaderStatus } from '../src/screens/first-run/journey-contracts.ts';

const codeOf = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (error) { return (error as { code?: unknown }).code; } };
const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('the new methods are listed for the desktop and their refusals reach the screen', () => {
  const listed: string[] = json('../../desktop/module-methods/frame-today.json');
  for (const method of ['todayx.diskCheck', 'todayx.device.get', 'todayx.device.set', 'todayx.workspaces', 'todayx.recoveryContact.get', 'todayx.recoveryContact.set', 'todayx.recoveryContact.request']) assert.ok(listed.includes(method), method);
  for (const method of FAKE_PRE_VAULT) assert.ok(listed.includes(method), method);
  const preload = readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8');
  const line = preload.split('\n').find(text => text.includes('/* frame-today */')) ?? '';
  for (const code of TODAYX_REFUSALS) assert.ok(line.includes(`'${code}'`), code);
});

test('reply validators accept the engine shapes and refuse anything else', () => {
  assert.ok(isDiskCheckReply({ disk: 'encrypted', platform: 'macos', keyring: 'safe' }));
  assert.ok(!isDiskCheckReply({ disk: 'yes', platform: 'macos', keyring: 'safe' }));
  assert.ok(!isDiskCheckReply({ disk: 'unknown', platform: 'linux', keyring: 'none', path: '/home' }));
  assert.ok(isDeviceChoices({ language: null, view: null, saved: false }));
  assert.ok(isDeviceChoices({ language: 'hi', view: 'books', saved: true }));
  assert.ok(!isDeviceChoices({ language: 'hi', view: null, saved: true }));
  assert.ok(!isDeviceChoices({ language: 'en', view: 'books', saved: false }));
  assert.ok(isWorkspaceFoldersReply({ folders: [{ folder: 'main', main: true }, { folder: 'second', main: false }] }));
  assert.ok(!isWorkspaceFoldersReply({ folders: [{ folder: 'second', main: true }] }));
  assert.ok(!isWorkspaceFoldersReply({ folders: [{ folder: '../x', main: false }] }));
  assert.ok(!isWorkspaceFoldersReply({ folders: [{ folder: 'a', main: false }, { folder: 'a', main: false }] }));
  assert.ok(isRecoveryContactReply({ contact: null, confirmation: 'relay-required' }));
  assert.ok(isRecoveryContactReply({ contact: { name: 'Asha', reach: 'asha@example.invalid', savedAt: '2026-10-14T09:00:00.000Z' }, confirmation: 'relay-required' }));
  assert.ok(!isRecoveryContactReply({ contact: { name: 'A\nB', reach: 'x', savedAt: '2026-10-14T09:00:00.000Z' }, confirmation: 'relay-required' }));
  assert.ok(!isRecoveryContactReply({ contact: null, confirmation: 'sent' }));
});

test('the disk lines name the right tool and say when the passphrase is asked each time', () => {
  assert.equal(diskLineKey({ disk: 'encrypted', platform: 'windows', keyring: 'safe' }), 'FR-03.disk.encrypted');
  assert.equal(diskLineKey({ disk: 'not-encrypted', platform: 'windows', keyring: 'safe' }), 'FR-03.disk.off.windows');
  assert.equal(diskLineKey({ disk: 'not-encrypted', platform: 'macos', keyring: 'safe' }), 'FR-03.disk.off.macos');
  assert.equal(diskLineKey({ disk: 'not-encrypted', platform: 'linux', keyring: 'none' }), 'FR-03.disk.off.other');
  assert.equal(diskLineKey({ disk: 'unknown', platform: 'linux', keyring: 'unknown' }), 'FR-03.disk.unknown');
  assert.equal(keyringLineKey({ disk: 'unknown', platform: 'linux', keyring: 'none' }), 'FR-03.keyring.none');
  assert.equal(keyringLineKey({ disk: 'unknown', platform: 'linux', keyring: 'unknown' }), null);
  const en = json('../src/screens/first-run/text/en.json'), hi = json('../src/screens/first-run/text/hi.json'), shared = json('../src/text/en.json'), sharedHi = json('../src/text/hi.json');
  for (const key of ['FR-03.disk.encrypted', 'FR-03.disk.off.windows', 'FR-03.disk.off.macos', 'FR-03.disk.off.other', 'FR-03.disk.unknown', 'FR-03.keyring.none', 'FR-03.honest']) assert.ok(en[key] && hi[key], key);
  assert.equal(en['FR-03.honest'], 'A program running as you on this computer can read what you can read. The passphrase limits this; it does not remove it.');
  assert.equal(en['FR-03.disk.off.windows'], 'This disk is not encrypted. Chausar encrypts its own files. Turning on BitLocker protects the rest.');
  assert.equal(en['FR-03.keyring.none'], 'This computer has no safe place for a key. Chausar will ask for the passphrase each time.');
  for (const key of Object.keys(shared).filter(key => key.startsWith('SH-02.contact') || key.startsWith('SH-02.folder'))) {
    assert.ok(sharedHi[key], key);
    for (const text of [shared[key], sharedHi[key]]) { assert.ok(!/[—!]/.test(text), key); if (key.endsWith('.btn')) assert.ok([...text].length <= 22, key); }
  }
  for (const key of Object.keys(en).filter(key => /^FR-0[137]\.(disk|keyring|folders|password|pdf|reader)/.test(key))) {
    for (const text of [en[key], hi[key]]) { assert.ok(typeof text === 'string' && !/[—!]/.test(text), key); if (key.endsWith('.btn')) assert.ok([...text].length <= 22, key); }
  }
});

test('the fake serves the pre-vault methods while locked, and nothing else', async () => {
  const engine = createFakeEngine({ scenario: 'locked' });
  assert.equal(await codeOf(engine.request('todayx.shell', {})), 'VAULT_LOCKED');
  assert.equal(await codeOf(engine.request('todayx.recoveryContact.get', {})), 'VAULT_LOCKED');
  assert.ok(isIdentityCheckReply(await engine.request('todayx.identity.check', { fields: { pan: 'ABCDE1234F' } })));
  const disk = await readDiskCheck(engine);
  assert.equal(disk.kind, 'known');
  assert.deepEqual(await readWorkspaceFolders(engine), [{ folder: 'main', main: true }, { folder: 'second-shop', main: false }]);
  assert.equal(await readDeviceChoices(engine), null);
  assert.equal(await saveDeviceChoices(engine, 'hi', 'simple'), 'saved');
  assert.deepEqual(await readDeviceChoices(engine), { language: 'hi', view: 'simple' });
  assert.equal(await codeOf(engine.request('todayx.device.set', { language: 'fr', view: 'simple' })), 'INVALID_TODAYX_REQUEST');
  const asked = await askRecoveryContact(engine, 'main');
  assert.deepEqual(asked, { kind: 'refused', code: 'RECOVERY_CONTACT_RELAY_REQUIRED' });
  assert.equal(askLineKey(asked), 'SH-02.contact.relay');
  assert.equal(askLineKey({ kind: 'not-built' }), 'SH-02.contact.notBuilt');
  assert.equal(askLineKey({ kind: 'refused', code: 'REQUEST_FAILED' }), 'SH-02.contact.refused');
});

test('without the methods every helper says not built and nothing throws', async () => {
  const none = { request: async () => { throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); } };
  assert.deepEqual(await readDiskCheck(none), { kind: 'not-built' });
  assert.deepEqual(await readWorkspaceFolders(none), []);
  assert.equal(await readDeviceChoices(none), null);
  assert.equal(await saveDeviceChoices(none, 'en', 'guided'), 'not-built');
  assert.deepEqual(await askRecoveryContact(none, 'main'), { kind: 'not-built' });
  const lying = { request: async () => ({ disk: 'on', folders: 'x' }) };
  assert.deepEqual(await readDiskCheck(lying), { kind: 'refused', code: 'INVALID_REPLY' });
  assert.deepEqual(await readWorkspaceFolders(lying), []);
});

test('the recovery contact in the fake: an owner names them, a viewer cannot', async () => {
  const owner = createFakeEngine({ scenario: 'populated' });
  const empty = await readRecoveryContact(owner);
  assert.deepEqual(empty, { kind: 'known', value: { contact: null, confirmation: 'relay-required' } });
  const saved = await saveRecoveryContact(owner, { name: 'Asha Synthetic', reach: 'asha@example.invalid' });
  assert.equal(saved.kind === 'known' && saved.value.contact?.name, 'Asha Synthetic');
  assert.deepEqual(await saveRecoveryContact(owner, { name: '', reach: '' }), { kind: 'refused', code: 'RECOVERY_CONTACT_INVALID' });
  assert.deepEqual(await readRecoveryContact(createFakeEngine({ scenario: 'read-only' })), { kind: 'refused', code: 'FORBIDDEN' });
});

test('bank statement PDFs: the contract validators and the typed imports fixture', async () => {
  assert.deepEqual(validateReaderStatus({ state: 'not-installed', sizeBytes: 48_200_000 }), { state: 'not-installed', sizeBytes: 48_200_000 });
  assert.deepEqual(validateReaderStatus({ state: 'installed' }), { state: 'installed', sizeBytes: null });
  assert.throws(() => validateReaderStatus({ state: 'maybe' }));
  assert.deepEqual(validatePdfPreview({ lines: 3, openingMinor: '100', closingMinor: '-50', check: 'failed', extra: 'ignored' }), { lines: 3, openingMinor: '100', closingMinor: '-50', check: 'failed' });
  assert.deepEqual(validatePdfPreview({}), { lines: null, openingMinor: null, closingMinor: null, check: null });
  assert.throws(() => validatePdfPreview({ openingMinor: 12.5 }));
  assert.throws(() => validatePdfPreview({ check: 'ok' }));
  assert.equal(formatOf('statement.pdf'), null);
  assert.equal(formatOf('statement.pdf', true), 'pdf');
  assert.deepEqual([...PDF_REFUSALS].sort(), ['CUT_SHORT', 'DOES_NOT_ADD_UP', 'FILTERED', 'PASSWORD_REQUIRED', 'PICTURE_ONLY', 'READER_NOT_INSTALLED', 'WRONG_PASSWORD']);

  const engine = createFakeEngine();
  assert.equal(await codeOf(engine.request('imports.readerStatus', {})), 'UNKNOWN_METHOD');
  const remove = registerFakeMethods('imports', importsFixture({ reader: 'not-installed' }));
  try {
    const locked = { sourceId: 'file-statement', kind: 'pdf', bytesBase64: btoa('%PDF-1.7 LOCKED') };
    assert.equal(await codeOf(engine.request('imports.preview', locked)), 'READER_NOT_INSTALLED');
    assert.equal(validateReaderStatus(await engine.request('imports.installReader', {})).state, 'installed');
    assert.equal(await codeOf(engine.request('imports.preview', locked)), 'PASSWORD_REQUIRED');
    assert.equal(await codeOf(engine.request('imports.providePassword', { sourceId: 'file-statement', password: 'nope' })), 'WRONG_PASSWORD');
    assert.deepEqual(await engine.request('imports.providePassword', { sourceId: 'file-statement', password: SYNTHETIC_PDF_PASSWORD }), { ok: true });
    assert.equal(validatePdfPreview(await engine.request('imports.preview', locked)).check, 'passed');
    assert.equal(await codeOf(engine.request('imports.preview', { ...locked, sourceId: 'p', bytesBase64: btoa('%PDF PICTURE') })), 'PICTURE_ONLY');
  } finally { remove(); }
});
