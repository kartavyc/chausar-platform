import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { Language, View } from '../../app/ui/src/app/presentation';
import { TextProvider } from '../../app/ui/src/app/text';
import { createFakeEngine, registerFakeMethods } from '../../app/ui/src/bridge/fake';
import type { FakeEngine, FakeScenario } from '../../app/ui/src/bridge/fake';
import { importsFixture, SYNTHETIC_PDF_PASSWORD } from '../../app/ui/src/bridge/fixtures/imports';
import { createHostController } from '../../app/ui/src/host/controller';
import type { HostController } from '../../app/ui/src/host/controller';
import { BringFile, encryptedOfficeFile, type PickedFile } from '../../app/ui/src/screens/first-run/BringFile';
import { FirstRunJourney } from '../../app/ui/src/screens/first-run/FirstRunJourney';
import { AskRecoveryContact, LockFolderChoice, RecoveryContactSettings } from '../../app/ui/src/screens/first-run/ThisComputer';
import { FirstRunText, firstRunMessages } from '../../app/ui/src/screens/first-run/text';
import sharedEn from '../../app/ui/src/text/en.json';

// Round 2 of first run on the fake engine: everything synthetic, no network, no native host.
const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in first-run fixtures'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(() => {
  cleanup();
  for (const done of cleanups.splice(0)) done();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const w = (key: string, values: Record<string, string> = {}) => {
  const message = firstRunMessages('en')[key];
  if (message === undefined) throw Error(`Missing message ${key}`);
  return message.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
};
const shared = (key: string) => (sharedEn as Record<string, string>)[key]!;

/** Records every request with its payload, over the fake engine. */
function recording(engine: FakeEngine) {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  return { calls, port: { request: (method: string, payload: Record<string, unknown> = {}) => { calls.push({ method, payload: structuredClone(payload) }); return engine.request(method, payload); } } };
}

async function hostOn(scenario: FakeScenario) {
  const engine = createFakeEngine({ scenario });
  const recorded = recording(engine);
  const controller = createHostController(recorded.port as never, { todayProducer: await engine.todayProducer() });
  await act(async () => { await controller.refresh(); });
  cleanups.push(() => controller.dispose());
  return { engine, controller, calls: recorded.calls };
}

function Journey({ controller, onOpenFolder }: { controller: HostController; onOpenFolder?: (folder: string) => void }) {
  const [language, setLanguage] = useState<Language>('en');
  const [view, setView] = useState<View>('guided');
  return <FirstRunJourney host={controller} rpc={controller.places} language={language} onLanguage={setLanguage} view={view} onView={setView} onDone={() => {}} onOpenFolder={onOpenFolder} />;
}

test('first run: folders first, formats checked before the vault, the disk check and honest line, and the device choices kept only once the vault exists', { timeout: 20000 }, async () => {
  const { controller, calls } = await hostOn('locked');
  const opened = vi.fn();
  render(<Journey controller={controller} onOpenFolder={opened} />);
  const user = userEvent.setup();

  // FR-01: the folders on this computer come first, by name only.
  await screen.findByRole('button', { name: w('FR-01.open.btn', { name: 'main' }) });
  await user.click(screen.getByRole('button', { name: w('FR-01.open.btn', { name: 'second-shop' }) }));
  expect(opened).toHaveBeenCalledWith('second-shop');
  await user.click(screen.getByRole('radio', { name: /^Books/ }));

  // FR-02: the format check answers before any vault exists.
  await user.click(screen.getByRole('button', { name: w('FR-01.business.btn') }));
  await user.type(await screen.findByLabelText(w('FR-02.field.gstin')), '27AAAAA0000A1Z');
  await user.click(screen.getByRole('button', { name: w('FR.journey.continue.btn') }));
  await screen.findByText(w('FR-02.problem.length', { field: w('FR-02.field.gstin'), length: '15' }));
  expect(screen.queryByText(w('FR-02.checkNotBuilt'))).toBeNull();
  await user.clear(screen.getByLabelText(w('FR-02.field.gstin')));
  await user.click(screen.getByRole('button', { name: w('FR.journey.continue.btn') }));

  // FR-03: the disk check result and the honest line under it.
  await screen.findByRole('heading', { name: w('FR-03.title') });
  await screen.findByText(w('FR-03.disk.off.windows'));
  expect(screen.getByText(w('FR-03.honest'))).toBeTruthy();
  expect(document.querySelector('[data-disk-check="not-encrypted"]')).not.toBeNull();
  // Nothing about the language or view was stored before the vault.
  expect(calls.some(call => call.method === 'todayx.device.set')).toBe(false);

  await user.type(screen.getByLabelText(w('FR-03.name')), 'Synthetic second shop');
  await user.type(screen.getByLabelText(w('FR-03.passphrase')), 'Synthetic round two passphrase');
  await user.type(screen.getByLabelText(w('FR-03.repeat')), 'Synthetic round two passphrase');
  await user.click(screen.getByRole('button', { name: w('FR-03.create.btn') }));
  await user.click(await screen.findByRole('checkbox', { name: w('FR-04.kept') }));
  await user.click(screen.getByRole('button', { name: w('FR.journey.continue.btn') }));
  await screen.findByRole('heading', { name: w('FR-05.title') });
  await waitFor(() => expect(calls.find(call => call.method === 'todayx.device.set')?.payload).toEqual({ language: 'en', view: 'books' }));
  expect(calls.filter(call => call.method === 'todayx.device.set')).toHaveLength(1);
});

test('the lock screen pieces: pick the folder when there are several, and asking the recovery contact says the relay is needed', async () => {
  const engine = createFakeEngine({ scenario: 'locked' });
  function Lock() {
    const [folder, setFolder] = useState('main');
    return <TextProvider language="en"><LockFolderChoice rpc={engine} folder={folder} onFolder={setFolder} /><p data-chosen="">{folder}</p><AskRecoveryContact rpc={engine} folder={folder} /></TextProvider>;
  }
  render(<Lock />);
  const user = userEvent.setup();
  const group = await screen.findByRole('group', { name: shared('SH-02.folder') });
  await user.click(within(group).getByRole('radio', { name: 'second-shop' }));
  expect(document.querySelector('[data-chosen]')?.textContent).toBe('second-shop');
  await user.click(screen.getByRole('button', { name: shared('SH-02.contact.btn') }));
  await screen.findByText(shared('SH-02.contact.relay'));
  expect(document.querySelector('[data-recovery-contact-answer]')?.getAttribute('data-recovery-contact-answer')).toBe('RECOVERY_CONTACT_RELAY_REQUIRED');
});

test('one folder that is not main is chosen without asking; none draws nothing', async () => {
  const only = { request: async () => ({ folders: [{ folder: 'shop-2', main: false }] }) };
  const chosen = vi.fn();
  render(<TextProvider language="en"><LockFolderChoice rpc={only} folder="main" onFolder={chosen} /></TextProvider>);
  await waitFor(() => expect(chosen).toHaveBeenCalledWith('shop-2'));
  expect(document.querySelector('[data-lock-folders]')).toBeNull();
});

test('Trust · Vault: the owner names a recovery contact, kept in the vault; a viewer is told only an owner can', async () => {
  const engine = createFakeEngine({ scenario: 'populated' });
  render(<TextProvider language="en"><RecoveryContactSettings rpc={engine} /></TextProvider>);
  const user = userEvent.setup();
  await screen.findByText(shared('SH-02.contact.none'));
  expect(screen.getByText(shared('SH-02.contact.relayNote'))).toBeTruthy();
  await user.click(screen.getByRole('button', { name: shared('SH-02.contact.save.btn') }));
  await screen.findByText(shared('SH-02.contact.need'));
  await user.type(screen.getByLabelText(shared('SH-02.contact.name')), 'Asha Synthetic');
  await user.type(screen.getByLabelText(shared('SH-02.contact.reach')), 'asha@example.invalid');
  await user.click(screen.getByRole('button', { name: shared('SH-02.contact.save.btn') }));
  await screen.findByText('Now: Asha Synthetic, reached by asha@example.invalid.');
  await user.click(screen.getByRole('button', { name: shared('SH-02.contact.remove.btn') }));
  await screen.findByText(shared('SH-02.contact.none'));
  cleanup();
  render(<TextProvider language="en"><RecoveryContactSettings rpc={createFakeEngine({ scenario: 'read-only' })} /></TextProvider>);
  await screen.findByText(shared('SH-02.contact.owner'));
  cleanup();
  render(<TextProvider language="en"><RecoveryContactSettings rpc={{ request: async () => { throw Object.assign(Error('x'), { code: 'UNKNOWN_METHOD' }); } }} /></TextProvider>);
  await screen.findByText(shared('SH-02.contact.settings.notBuilt'));
});

const pdf = (name: string, body: string): PickedFile => ({ name, format: 'pdf', bytesBase64: btoa(body) });
type Port = { request: (method: string, payload?: Record<string, unknown>) => Promise<unknown> };
function fileStep(engine: Port, picked: PickedFile, taken = vi.fn()) {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const port = { request: (method: string, payload: Record<string, unknown> = {}) => { calls.push({ method, payload: structuredClone(payload) }); return engine.request(method, payload); } };
  render(<FirstRunText language="en"><BringFile rpc={port as never} pickFile={async () => picked} held={null} onHold={() => {}} meaningsAgreed company="Demo shop" onTaken={taken} onWaits={() => {}} /></FirstRunText>);
  return calls;
}
async function pickPdf(engine: Port, picked: PickedFile, taken = vi.fn()) {
  const calls = fileStep(engine, picked, taken);
  const user = userEvent.setup();
  await waitFor(() => expect(calls.some(call => call.method === 'imports.readerStatus')).toBe(true));
  await user.click(screen.getByRole('button', { name: w('FR-07.pick.btn') }));
  return { calls, user };
}

test('FR-07: a password-protected statement asks once, the field is emptied at once, the password is never kept, and the envelope read is the one taken', { timeout: 20000 }, async () => {
  const engine = createFakeEngine();
  cleanups.push(registerFakeMethods('imports', importsFixture()));
  const taken = vi.fn();
  const { calls, user } = await pickPdf(engine, pdf('September statement.pdf', '%PDF-1.7 LOCKED'), taken);
  await screen.findByRole('heading', { name: w('FR-07.password.title') });
  expect(screen.getByText(w('FR-07.password.note'))).toBeTruthy();
  const field = screen.getByLabelText(w('FR-07.password')) as HTMLInputElement;
  await user.type(field, 'not-it');
  await user.click(screen.getByRole('button', { name: w('FR-07.password.send.btn') }));
  expect(field.value).toBe('');
  // The engine holds it for one preview, which says it did not open the file.
  await screen.findByText(w('FR-07.password.wrong'));
  const again = screen.getByLabelText(w('FR-07.password')) as HTMLInputElement;
  await user.type(again, SYNTHETIC_PDF_PASSWORD);
  await user.click(screen.getByRole('button', { name: w('FR-07.password.send.btn') }));
  await screen.findByText(w('FR-07.pdf.lines', { count: '42' }));
  expect(screen.getByText(w('FR-07.pdf.check.passed'))).toBeTruthy();
  expect(screen.getByText(w('FR-07.pdf.opening', { amount: '₹1,25,000' }))).toBeTruthy();
  expect(screen.getByText(w('FR-07.pdf.closing', { amount: '₹1,48,300.50' }))).toBeTruthy();
  expect(document.querySelector('[data-pdf-ocr]')).toBeNull();
  // The password went once each time, to the engine, and is nowhere on the page.
  expect(calls.filter(call => call.method === 'imports.providePassword').map(call => call.payload['password'])).toEqual(['not-it', SYNTHETIC_PDF_PASSWORD]);
  expect(document.body.innerHTML).not.toContain(SYNTHETIC_PDF_PASSWORD);
  expect(calls.filter(call => call.method !== 'imports.providePassword').some(call => JSON.stringify(call.payload).includes(SYNTHETIC_PDF_PASSWORD))).toBe(false);
  await user.click(screen.getByRole('button', { name: w('FR-07.pdf.take.btn') }));
  await screen.findByText(w('FR-07.pdf.taken'));
  expect(screen.getByText(w('FR-07.pdf.rows', { count: '42' }))).toBeTruthy();
  const commit = calls.find(call => call.method === 'imports.commit');
  expect(commit?.payload).toEqual({ sourceId: 'file-September-statement', envelopeId: expect.stringMatching(/^envelope_/) });
  await user.click(screen.getByRole('button', { name: w('FR.journey.continue.btn') }));
  expect(taken).toHaveBeenCalledTimes(1);
});

test('FR-07: the reader not installed shows the text reader, OCR and the reason in words; installing says it comes with the installer', { timeout: 20000 }, async () => {
  const engine = createFakeEngine();
  cleanups.push(registerFakeMethods('imports', importsFixture({ reader: 'not-installed' })));
  const { calls, user } = await pickPdf(engine, pdf('Statement.pdf', '%PDF'));
  await screen.findByText(w('FR-07.reader.missing'));
  expect(screen.getByText(w('FR-07.reader.text.no'))).toBeTruthy();
  expect(screen.getByText(w('FR-07.reader.ocr.no'))).toBeTruthy();
  expect(screen.getByText(w('FR-07.reader.reason.PYTHON_NOT_CONFIGURED'))).toBeTruthy();
  await user.click(screen.getByRole('button', { name: w('FR-07.reader.install.btn') }));
  await screen.findByText(w('FR-07.reader.install.READER_INSTALL_UNAVAILABLE'));
  expect(document.body.textContent).not.toMatch(/MB|[Dd]ownload/);
  expect(calls.filter(call => call.method === 'imports.installReader')).toHaveLength(1);
  // Read again asks the engine again; it still is not installed.
  await user.click(screen.getByRole('button', { name: w('FR-07.pdf.again.btn') }));
  await waitFor(() => expect(calls.filter(call => call.method === 'imports.preview')).toHaveLength(2));
  await screen.findByText(w('FR-07.reader.missing'));
  cleanup();

  cleanups.push(registerFakeMethods('imports', importsFixture({ reader: 'library-missing', demo: true })));
  const demo = await pickPdf(engine, pdf('Statement.pdf', '%PDF'));
  await screen.findByText(w('FR-07.reader.reason.PDF_LIBRARY_MISSING'));
  await demo.user.click(screen.getByRole('button', { name: w('FR-07.reader.install.btn') }));
  await screen.findByText(w('FR-07.reader.install.DEMO_EXTERNAL_DISABLED'));
});

test('FR-07: refused whole, thrown or by content, with the reason, both totals as money, the line, and where the file is kept', { timeout: 20000 }, async () => {
  const engine = createFakeEngine();
  cleanups.push(registerFakeMethods('imports', importsFixture()));
  await pickPdf(engine, pdf('Scan.pdf', '%PDF PICTURE'));
  await screen.findByText(w('FR-07.pdf.whole.PICTURE_ONLY'));
  expect(document.querySelector('[data-whole-reason="PICTURE_ONLY"]')).not.toBeNull();
  cleanup();

  for (const [marker, code] of [['NOTAPDF', 'INVALID_PDF'], ['BADLINE', 'PDF_LINE_UNREADABLE'], ['TOOLONG', 'PDF_PAGE_LIMIT']]) {
    await pickPdf(engine, pdf('Odd.pdf', `%PDF ${marker}`));
    await screen.findByText(w(`FR-07.pdf.whole.${code}`));
    expect(screen.getByText(w('FR-07.whole'))).toBeTruthy();
    cleanup();
  }

  await pickPdf(engine, pdf('Filtered.pdf', '%PDF FILTERED'));
  await screen.findByText(w('FR-07.pdf.whole.FILTERED'));
  expect(screen.getByText(w('FR-07.pdf.totals', { expected: '₹1,48,300.50', observed: '₹1,47,000.50' }))).toBeTruthy();
  expect(screen.getByText(w('FR-07.pdf.kept'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: w('FR-07.pdf.take.btn') })).toBeNull();
  cleanup();

  await pickPdf(engine, pdf('Broken.pdf', '%PDF NOTADDING'));
  await screen.findByText(w('FR-07.pdf.whole.DOES_NOT_ADD_UP'));
  expect(screen.getByText(w('FR-07.pdf.atLine', { line: '17' }))).toBeTruthy();
  expect(screen.getByText(w('FR-07.pdf.kept'))).toBeTruthy();
  cleanup();

  await pickPdf(engine, pdf('Short.pdf', '%PDF CUTSHORT'));
  await screen.findByText(w('FR-07.pdf.whole.CUT_SHORT'));
  expect(document.querySelector('[data-whole-reason="CUT_SHORT"]')).not.toBeNull();
  expect(screen.getByText(w('FR-07.pdf.kept'))).toBeTruthy();
});

test('FR-07: a scanned statement is labelled experimental, a second take says it was taken before, and an expired read asks to read again', { timeout: 20000 }, async () => {
  const engine = createFakeEngine();
  cleanups.push(registerFakeMethods('imports', importsFixture()));
  let step = await pickPdf(engine, pdf('Scanned.pdf', '%PDF SCANNED'));
  await screen.findByText(w('FR-07.pdf.ocr'));
  await step.user.click(screen.getByRole('button', { name: w('FR-07.pdf.take.btn') }));
  await screen.findByText(w('FR-07.pdf.rows', { count: '42' }));
  cleanup();
  step = await pickPdf(engine, pdf('Scanned.pdf', '%PDF SCANNED'));
  await step.user.click(await screen.findByRole('button', { name: w('FR-07.pdf.take.btn') }));
  await screen.findByText(w('FR-07.pdf.duplicate'));
  expect(screen.queryByText(w('FR-07.pdf.rows', { count: '42' }))).toBeNull();
  cleanup();

  step = await pickPdf(engine, pdf('Late.pdf', '%PDF EXPIRED'));
  await step.user.click(await screen.findByRole('button', { name: w('FR-07.pdf.take.btn') }));
  await screen.findByText(w('FR-07.pdf.commit.ENVELOPE_EXPIRED'));
  await step.user.click(screen.getByRole('button', { name: w('FR-07.pdf.again.btn') }));
  await screen.findByRole('button', { name: w('FR-07.pdf.take.btn') });
  expect(step.calls.filter(call => call.method === 'imports.preview')).toHaveLength(2);
  cleanup();

  step = await pickPdf(engine, pdf('Unsure.pdf', '%PDF QUESTION'));
  await screen.findByText(w('FR-07.pdf.question'));
  expect(screen.queryByRole('button', { name: w('FR-07.pdf.take.btn') })).toBeNull();
});

test('FR-07: an unexpected reply is a failure with INVALID_REPLY, never drawn', { timeout: 20000 }, async () => {
  const engine = createFakeEngine();
  cleanups.push(registerFakeMethods('imports', importsFixture()));
  const old = { request: (method: string, payload: Record<string, unknown> = {}) => method === 'imports.preview'
    ? Promise.resolve({ lines: 42, openingMinor: '12500000', closingMinor: '14830050', check: 'passed' })
    : engine.request(method, payload) };
  await pickPdf(old, pdf('Statement.pdf', '%PDF'));
  await screen.findByText(w('FR-07.refused', { code: 'INVALID_REPLY' }));
  expect(screen.queryByText(w('FR-07.pdf.lines', { count: '42' }))).toBeNull();
  cleanup();

  const prose = { request: (method: string, payload: Record<string, unknown> = {}) => method === 'imports.commit'
    ? Promise.resolve({ ok: true, message: 'Imported 42 rows.' })
    : engine.request(method, payload) };
  const step = await pickPdf(prose, pdf('Statement.pdf', '%PDF'));
  await step.user.click(await screen.findByRole('button', { name: w('FR-07.pdf.take.btn') }));
  await screen.findByText(w('FR-07.refused', { code: 'INVALID_REPLY' }));
  expect(document.body.textContent).not.toContain('Imported 42 rows.');
});

test('FR-07: without the imports family PDF stays out of the picker, and an encrypted workbook says password needed with no field', { timeout: 20000 }, async () => {
  const engine = createFakeEngine();
  const calls = fileStep(engine, pdf('statement.pdf', '%PDF-1.7'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: w('FR-07.pick.btn') }));
  await screen.findByText(w('FR-07.notSupported'));
  expect(calls.some(call => call.method === 'imports.preview')).toBe(false);
  cleanup();

  // An encrypted Office file is an OLE file, not a ZIP: nothing is sent and no password is asked for.
  const ole = btoa(String.fromCharCode(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0));
  expect(encryptedOfficeFile(ole)).toBe(true);
  expect(encryptedOfficeFile(btoa('PK\u0003\u0004rest'))).toBe(false);
  const sheet = fileStep(engine, { name: 'Locked.xlsx', format: 'xlsx', bytesBase64: ole });
  await user.click(await screen.findByRole('button', { name: w('FR-07.pick.btn') }));
  await screen.findByText(w('FR-07.password.notBuilt'));
  expect(screen.getByText(w('FR-07.password.copy'))).toBeTruthy();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(sheet.some(call => call.method === 'sources.workbookPreview')).toBe(false);
});
