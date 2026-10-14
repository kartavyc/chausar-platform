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
import {
  formatOf, PDF_REFUSALS, validateFr07, validatePasswordHeld, validatePdfCommit, validatePdfPreview, validateReaderStatus,
} from '../src/screens/first-run/journey-contracts.ts';

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

/** The `fr07` result exactly as connectors-ext's `fr07Result` builds it. */
const fr07 = (over: Record<string, unknown> = {}) => ({
  envelopeId: 'envelope_1', sourceId: 'file-statement', kind: 'bank-statement', state: 'checked', reason: null, code: null, line: null, totals: null,
  linesRead: 42, openingMinor: '12500000', closingMinor: '14830050', checkPassed: true, readByOcr: false,
  kept: { file: 'not-kept', record: 'books-sources-history' }, imported: null, ...over,
});

test('bank statement PDFs: the contract validators take the real shapes and refuse anything else', () => {
  // imports.readerStatus
  assert.deepEqual(validateReaderStatus({ status: 'installed', pdfText: true, pdfOcr: false, reason: null, sizeBytes: null }), { status: 'installed', pdfText: true, pdfOcr: false, reason: null });
  assert.deepEqual(validateReaderStatus({ status: 'not-installed', pdfText: false, pdfOcr: false, reason: 'PYTHON_NOT_CONFIGURED', sizeBytes: null }).reason, 'PYTHON_NOT_CONFIGURED');
  assert.equal(validateReaderStatus({ status: 'not-installed', pdfText: false, pdfOcr: false, reason: 'HELPER_EXECUTION_FAILED', sizeBytes: null }).reason, 'HELPER_EXECUTION_FAILED');
  assert.throws(() => validateReaderStatus({ state: 'installed' }), 'the assumed shape is gone');
  assert.throws(() => validateReaderStatus({ status: 'not-installed', pdfText: false, pdfOcr: false, reason: 'PYTHON_NOT_CONFIGURED', sizeBytes: 48_200_000 }), 'no size in this build');
  assert.throws(() => validateReaderStatus({ status: 'installed', pdfText: true, pdfOcr: true, reason: 'PDF_LIBRARY_MISSING', sizeBytes: null }));
  assert.throws(() => validateReaderStatus({ status: 'not-installed', pdfText: false, pdfOcr: false, reason: 'The helper is missing.', sizeBytes: null }), 'prose is not a code');
  assert.throws(() => validateReaderStatus({ status: 'not-installed', pdfText: 'no', pdfOcr: false, reason: 'PDF_LIBRARY_MISSING', sizeBytes: null }));

  // imports.providePassword
  validatePasswordHeld({ held: true, sourceId: 'file-statement', expiresInSeconds: 600, usedOnce: true }, 'file-statement');
  assert.throws(() => validatePasswordHeld({ ok: true }, 'file-statement'));
  assert.throws(() => validatePasswordHeld({ held: true, sourceId: 'other', expiresInSeconds: 600, usedOnce: true }, 'file-statement'));
  assert.throws(() => validatePasswordHeld({ held: true, sourceId: 'file-statement', expiresInSeconds: 600, usedOnce: true, password: 'x' }, 'file-statement'));

  // imports.preview: the envelope's id and status and its fr07
  const shown = validatePdfPreview({ id: 'envelope_1', status: 'accepted', checks: [], notices: ['ignored prose'], fr07: fr07() }, 'file-statement');
  assert.equal(shown.envelopeId, 'envelope_1');
  assert.equal(shown.fr07.linesRead, 42);
  assert.equal(shown.fr07.checkPassed, true);
  assert.throws(() => validatePdfPreview({ lines: 3, openingMinor: '100', closingMinor: '-50', check: 'failed' }), 'the assumed shape is gone');
  assert.throws(() => validatePdfPreview({ id: 'envelope_2', status: 'accepted', fr07: fr07() }), 'the fr07 belongs to its envelope');
  assert.throws(() => validatePdfPreview({ id: 'envelope_1', status: 'accepted', fr07: fr07() }, 'file-other'), 'and to the file sent');
  assert.throws(() => validatePdfPreview({ id: 'envelope_1', status: 'refused', fr07: fr07() }), 'a refused envelope is not checked');
  assert.throws(() => validatePdfPreview({ id: 'envelope_1', status: 'accepted', fr07: fr07({ openingMinor: 12.5 }) }));
  assert.throws(() => validatePdfPreview({ id: 'envelope_1', status: 'accepted', fr07: fr07({ openingMinor: '₹1,25,000' }) }), 'money is digits');
  assert.throws(() => validatePdfPreview({ id: 'envelope_1', status: 'accepted', fr07: fr07({ linesRead: '42' }) }));
  assert.throws(() => validatePdfPreview({ id: 'envelope_1', status: 'accepted', fr07: fr07({ kept: { file: 'kept', record: 'books-sources-history' } }) }));
  assert.throws(() => validatePdfPreview({ id: 'envelope_1', status: 'accepted', fr07: fr07({ code: 'It broke here.' }) }), 'prose is not a code');
  // Content refusals.
  const filtered = validateFr07(fr07({ state: 'refused', reason: 'FILTERED', code: 'SOURCE_TOTAL_MISMATCH', totals: { expected: '14830050', observed: '14700050' }, checkPassed: false }));
  assert.deepEqual(filtered.totals, { expected: { kind: 'money', minor: '14830050' }, observed: { kind: 'money', minor: '14700050' } });
  assert.deepEqual(validateFr07(fr07({ state: 'refused', reason: 'FILTERED', code: 'SOURCE_ROW_MISMATCH', totals: { expected: 40, observed: 42 }, checkPassed: false })).totals?.expected, { kind: 'lines', count: 40 });
  assert.throws(() => validateFr07(fr07({ state: 'refused', reason: 'FILTERED', totals: { expected: '1', observed: 2 }, checkPassed: false })), 'one kind of total');
  assert.throws(() => validateFr07(fr07({ state: 'refused', reason: 'CUT_SHORT', totals: { expected: '1', observed: '2' }, checkPassed: false })), 'totals are for FILTERED only');
  assert.equal(validateFr07(fr07({ state: 'refused', reason: 'DOES_NOT_ADD_UP', code: 'BALANCE_BROKEN', line: 17, checkPassed: false })).line, 17);
  assert.throws(() => validateFr07(fr07({ state: 'refused', reason: 'PICTURE_ONLY' })), 'not a content reason');
  assert.throws(() => validateFr07(fr07({ reason: 'CUT_SHORT' })), 'a reason means refused');
  assert.equal(validatePdfPreview({ id: 'envelope_1', status: 'failed', fr07: fr07({ state: 'refused', code: 'PDF_EXTRACT_FAILED', checkPassed: false }) }).fr07.code, 'PDF_EXTRACT_FAILED');
  assert.equal(validatePdfPreview({ id: 'envelope_1', status: 'abstained', fr07: fr07({ state: 'question', checkPassed: false }) }).fr07.state, 'question');

  // imports.commit
  const done = validatePdfCommit(fr07({ state: 'imported', imported: { importId: 'import_1', rows: 42, duplicate: false } }), 'envelope_1', 'file-statement');
  assert.deepEqual(done.imported, { importId: 'import_1', rows: 42, duplicate: false });
  assert.throws(() => validatePdfCommit(fr07(), 'envelope_1', 'file-statement'), 'not imported');
  assert.throws(() => validatePdfCommit(fr07({ state: 'imported', imported: { importId: 'import_1', rows: '42', duplicate: false } }), 'envelope_1', 'file-statement'));
  assert.throws(() => validatePdfCommit(fr07({ state: 'imported', imported: { importId: 'import_1', rows: 42, duplicate: false } }), 'envelope_9', 'file-statement'));
  assert.throws(() => validatePdfCommit({ id: 'import_1', sourceId: 'file-statement' }, 'envelope_1', 'file-statement'), 'the assumed shape is gone');

  assert.equal(formatOf('statement.pdf'), null);
  assert.equal(formatOf('statement.pdf', true), 'pdf');
  assert.deepEqual([...PDF_REFUSALS].sort(), ['CUT_SHORT', 'DOES_NOT_ADD_UP', 'FILTERED', 'INVALID_PDF', 'PASSWORD_REQUIRED', 'PDF_LINE_UNREADABLE', 'PDF_PAGE_LIMIT', 'PICTURE_ONLY', 'READER_NOT_INSTALLED', 'WRONG_PASSWORD']);
  // Every code has its words in both languages.
  const en = json('../src/screens/first-run/text/en.json'), hi = json('../src/screens/first-run/text/hi.json');
  const keys = [
    ...['PICTURE_ONLY', 'INVALID_PDF', 'PDF_LINE_UNREADABLE', 'PDF_PAGE_LIMIT', 'CUT_SHORT', 'FILTERED', 'DOES_NOT_ADD_UP'].map(code => `FR-07.pdf.whole.${code}`),
    ...['IMPORT_NOT_ACCEPTED', 'ENVELOPE_NOT_FOUND', 'ENVELOPE_EXPIRED'].map(code => `FR-07.pdf.commit.${code}`),
    ...['PYTHON_NOT_CONFIGURED', 'PDF_LIBRARY_MISSING', 'other'].map(code => `FR-07.reader.reason.${code}`),
    'FR-07.reader.install.READER_INSTALL_UNAVAILABLE', 'FR-07.reader.install.DEMO_EXTERNAL_DISABLED', 'FR-07.pdf.kept', 'FR-07.pdf.ocr', 'FR-07.password.invalid', 'FR-07.pdf.openDesktop',
  ];
  for (const key of keys) assert.ok(en[key] && hi[key], key);
  assert.equal(en['FR-07.reader.install.READER_INSTALL_UNAVAILABLE'], 'The reader cannot be installed from here in this build. It comes with the app installer.');
  assert.equal(en['FR-07.password.wrong'], 'That password did not open the file.');
});

test('bank statement PDFs: the typed imports fixture serves the real shapes', async () => {
  const engine = createFakeEngine();
  assert.equal(await codeOf(engine.request('imports.readerStatus', {})), 'UNKNOWN_METHOD');
  const missing = registerFakeMethods('imports', importsFixture({ reader: 'not-installed' }));
  try {
    assert.deepEqual(validateReaderStatus(await engine.request('imports.readerStatus', {})), { status: 'not-installed', pdfText: false, pdfOcr: false, reason: 'PYTHON_NOT_CONFIGURED' });
    assert.equal(await codeOf(engine.request('imports.installReader', {})), 'READER_INSTALL_UNAVAILABLE');
    assert.equal(await codeOf(engine.request('imports.preview', { sourceId: 'file-s', kind: 'pdf', bytesBase64: btoa('%PDF') })), 'READER_NOT_INSTALLED');
  } finally { missing(); }
  const demo = registerFakeMethods('imports', importsFixture({ reader: 'library-missing', demo: true }));
  try {
    assert.equal(validateReaderStatus(await engine.request('imports.readerStatus', {})).reason, 'PDF_LIBRARY_MISSING');
    assert.equal(await codeOf(engine.request('imports.installReader', {})), 'DEMO_EXTERNAL_DISABLED');
  } finally { demo(); }

  const remove = registerFakeMethods('imports', importsFixture());
  try {
    assert.equal(validateReaderStatus(await engine.request('imports.readerStatus', {})).status, 'installed');
    const locked = { sourceId: 'file-statement', kind: 'pdf', bytesBase64: btoa('%PDF-1.7 LOCKED') };
    assert.equal(await codeOf(engine.request('imports.preview', locked)), 'PASSWORD_REQUIRED');
    validatePasswordHeld(await engine.request('imports.providePassword', { sourceId: 'file-statement', password: 'nope' }), 'file-statement');
    assert.equal(await codeOf(engine.request('imports.preview', locked)), 'WRONG_PASSWORD');
    // Used once: the wrong one is gone, so the next read asks again.
    assert.equal(await codeOf(engine.request('imports.preview', locked)), 'PASSWORD_REQUIRED');
    assert.equal(await codeOf(engine.request('imports.providePassword', { sourceId: 'file-statement', password: '' })), 'PASSWORD_INVALID');
    validatePasswordHeld(await engine.request('imports.providePassword', { sourceId: 'file-statement', password: SYNTHETIC_PDF_PASSWORD }), 'file-statement');
    const read = validatePdfPreview(await engine.request('imports.preview', locked), 'file-statement');
    assert.equal(read.fr07.state, 'checked');
    const taken = validatePdfCommit(await engine.request('imports.commit', { sourceId: 'file-statement', envelopeId: read.envelopeId }), read.envelopeId, 'file-statement');
    assert.deepEqual(taken.imported, { importId: `import_${read.envelopeId}`, rows: 42, duplicate: false });

    const preview = async (body: string) => validatePdfPreview(await engine.request('imports.preview', { sourceId: 'file-p', kind: 'pdf', bytesBase64: btoa(body) }), 'file-p');
    for (const [marker, code] of [['PICTURE', 'PICTURE_ONLY'], ['NOTAPDF', 'INVALID_PDF'], ['BADLINE', 'PDF_LINE_UNREADABLE'], ['TOOLONG', 'PDF_PAGE_LIMIT']]) {
      assert.equal(await codeOf(engine.request('imports.preview', { sourceId: 'file-p', kind: 'pdf', bytesBase64: btoa(`%PDF ${marker}`) })), code);
    }
    assert.equal((await preview('%PDF CUTSHORT')).fr07.reason, 'CUT_SHORT');
    assert.deepEqual((await preview('%PDF FILTERED')).fr07.totals, { expected: { kind: 'money', minor: '14830050' }, observed: { kind: 'money', minor: '14700050' } });
    const broken = await preview('%PDF NOTADDING');
    assert.deepEqual([broken.status, broken.fr07.reason, broken.fr07.line], ['refused', 'DOES_NOT_ADD_UP', 17]);
    assert.equal(await codeOf(engine.request('imports.commit', { sourceId: 'file-p', envelopeId: broken.envelopeId })), 'IMPORT_NOT_ACCEPTED');
    assert.equal((await preview('%PDF SCANNED')).fr07.readByOcr, true);
    assert.equal((await preview('%PDF QUESTION')).fr07.state, 'question');
    const expired = await preview('%PDF EXPIRED');
    assert.equal(await codeOf(engine.request('imports.commit', { sourceId: 'file-p', envelopeId: expired.envelopeId })), 'ENVELOPE_EXPIRED');
    assert.equal(await codeOf(engine.request('imports.commit', { sourceId: 'file-p', envelopeId: 'envelope_none' })), 'ENVELOPE_NOT_FOUND');
    // The same statement taken twice is a duplicate.
    const first = await preview('%PDF plain');
    validatePdfCommit(await engine.request('imports.commit', { sourceId: 'file-p', envelopeId: first.envelopeId }), first.envelopeId, 'file-p');
    const second = await preview('%PDF plain');
    assert.equal(validatePdfCommit(await engine.request('imports.commit', { sourceId: 'file-p', envelopeId: second.envelopeId }), second.envelopeId, 'file-p').imported?.duplicate, true);
  } finally { remove(); }
});
