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
function fileStep(engine: FakeEngine, picked: PickedFile, taken = vi.fn()) {
  const recorded = recording(engine);
  render(<FirstRunText language="en"><BringFile rpc={recorded.port as never} pickFile={async () => picked} held={null} onHold={() => {}} meaningsAgreed company="Demo shop" onTaken={taken} onWaits={() => {}} /></FirstRunText>);
  return recorded.calls;
}

test('FR-07: a password-protected statement asks once, the field is emptied at once, and the password is never kept', { timeout: 20000 }, async () => {
  const engine = createFakeEngine();
  cleanups.push(registerFakeMethods('imports', importsFixture()));
  const taken = vi.fn();
  const calls = fileStep(engine, pdf('September statement.pdf', '%PDF-1.7 LOCKED'), taken);
  const user = userEvent.setup();
  await waitFor(() => expect(calls.some(call => call.method === 'imports.readerStatus')).toBe(true));
  await user.click(screen.getByRole('button', { name: w('FR-07.pick.btn') }));
  await screen.findByRole('heading', { name: w('FR-07.password.title') });
  expect(screen.getByText(w('FR-07.password.note'))).toBeTruthy();
  const field = screen.getByLabelText(w('FR-07.password')) as HTMLInputElement;
  await user.type(field, 'not-it');
  await user.click(screen.getByRole('button', { name: w('FR-07.password.send.btn') }));
  expect(field.value).toBe('');
  await screen.findByText(w('FR-07.password.wrong'));
  const again = screen.getByLabelText(w('FR-07.password')) as HTMLInputElement;
  await user.type(again, SYNTHETIC_PDF_PASSWORD);
  await user.click(screen.getByRole('button', { name: w('FR-07.password.send.btn') }));
  await screen.findByText(w('FR-07.pdf.lines', { count: '42' }));
  expect(screen.getByText(w('FR-07.pdf.check.passed'))).toBeTruthy();
  expect(screen.getByText(w('FR-07.pdf.opening', { amount: '₹1,25,000' }))).toBeTruthy();
  // The password went once, to the engine, and is nowhere on the page.
  expect(calls.filter(call => call.method === 'imports.providePassword').map(call => call.payload['password'])).toEqual(['not-it', SYNTHETIC_PDF_PASSWORD]);
  expect(document.body.innerHTML).not.toContain(SYNTHETIC_PDF_PASSWORD);
  expect(calls.filter(call => call.method !== 'imports.providePassword').some(call => JSON.stringify(call.payload).includes(SYNTHETIC_PDF_PASSWORD))).toBe(false);
  await user.click(screen.getByRole('button', { name: w('FR-07.pdf.take.btn') }));
  await screen.findByText(w('FR-07.pdf.taken'));
  await user.click(screen.getByRole('button', { name: w('FR.journey.continue.btn') }));
  expect(taken).toHaveBeenCalledTimes(1);
});

test('FR-07: the reader not installed shows its size and installs; a picture-only statement is refused whole', { timeout: 20000 }, async () => {
  const engine = createFakeEngine();
  cleanups.push(registerFakeMethods('imports', importsFixture({ reader: 'not-installed' })));
  fileStep(engine, pdf('Scan.pdf', '%PDF PICTURE'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: w('FR-07.pick.btn') }));
  await screen.findByText(w('FR-07.reader.missing', { size: '48.2' }));
  await user.click(screen.getByRole('button', { name: w('FR-07.reader.install.btn') }));
  await screen.findByText(w('FR-07.pdf.whole.PICTURE_ONLY'));
  expect(document.querySelector('[data-whole-reason="PICTURE_ONLY"]')).not.toBeNull();
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
