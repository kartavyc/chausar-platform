import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Address, Language } from '../../app/ui/src/app/presentation';
import { mountHost, type MountedHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import { createFakeEngine, type FakeEngine, type FakeScenario } from '../../app/ui/src/bridge/fake';
import { createShellPort, type DesktopShellBridge, type PickKind } from '../../app/ui/src/bridge/shell';
import type { PlaceModule, PlaceRenderProps } from '../../app/ui/src/places/types';
import { BringFile, type PickedFile } from '../../app/ui/src/screens/first-run/BringFile';
import { Recover } from '../../app/ui/src/screens/first-run/Recover';
import type { JourneyPort } from '../../app/ui/src/screens/first-run/journey-contracts';
import { proposalCache } from '../../app/ui/src/screens/first-run/proposals';
import { FirstRunText, firstRunMessages } from '../../app/ui/src/screens/first-run/text';
import * as sharing from '../../app/ui/src/screens/trust/adapters/learning';
import { settle } from '../../app/ui/tests/first-run/fixture';

// Round 4, frame-today: imports.pickFile through the actual host and shell adapter (a synthetic
// preload bridge, nothing opens), BK-04's `bringFile` for a place, FR-13's backup, Excel proposed
// meanings and the fake engine's default learningx family. Synthetic data only, no network.
const SOURCES: Address = { place: 'books', sub: 'sources' };
const seen: { bringFile: PlaceRenderProps['bringFile'] | 'unset'; taken: number } = { bringFile: 'unset', taken: 0 };

vi.mock('../../app/ui/src/places/registry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../app/ui/src/places/registry')>();
  // A stand-in for Books · Sources (work-books): it draws the host's flow where it wants it.
  const sourcesPlace: PlaceModule = {
    id: 'synthetic-sources-place',
    handles: address => address.place === 'books' && address.sub === 'sources',
    render: props => {
      seen.bringFile = props.bringFile;
      return <div data-synthetic-sources="">{props.bringFile?.({ onTaken: () => { seen.taken++; } }) ?? <p>No bring-a-file here.</p>}</div>;
    },
  };
  return { ...actual, placeModuleFor: (address: Address, list?: readonly PlaceModule[]) => sourcesPlace.handles(address) ? sourcesPlace : actual.placeModuleFor(address, list) };
});

const flush = async () => { await act(async () => { await settle(); }); };
const cleanups: Array<() => void> = [];
beforeEach(() => {
  seen.bringFile = 'unset'; seen.taken = 0;
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in file fixtures'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const dispose of cleanups.splice(0)) dispose(); });
  cleanup();
  document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

function words(language: Language) {
  const messages = firstRunMessages(language);
  return (key: string, values: Record<string, string> = {}) => {
    const message = messages[key];
    if (message === undefined) throw Error(`Missing message ${key}`);
    return message.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
  };
}

const CSV = 'id,date,Invoice Value\ninv-1,2026-09-03,1000.00\ninv-2,2026-09-12,2000.00\n';
const accepted = { accepted: true, errors: [], unmappedFields: [], facts: [{}, {}], totalsMinor: '300000',
  coverage: { sourceRows: 2, importedRows: 2, rejectedRows: 0, expectedRows: 2, reconciled: true }, format: 'csv', qualification: 'experimental' };
const imported = { id: 'import_fake', coverage: { sourceRows: 2, importedRows: 2, rejectedRows: 0, expectedRows: 2, reconciled: true }, totalsMinor: '300000' };
const SHEET = [['id', 'date', 'Invoice Value', 'Customer, City'], ['inv-1', '2026-09-03', '1000.00', 'Asha Traders'], ['inv-2', '2026-09-12', '2000.00', 'Ravi & Co']];

/** The fake engine, with the file reads it does not serve itself answered as the engine would. */
function fileRpc(engine: FakeEngine, log: Array<{ method: string; payload: unknown }> = []): JourneyPort & { request(method: string, payload: unknown): Promise<unknown> } {
  return { request: async (method: string, payload: unknown) => {
    log.push({ method, payload });
    if (method === 'sources.preview' || method === 'sources.workbookPreview') return accepted;
    if (method === 'sources.import' || method === 'sources.workbookImport') return imported;
    if (method === 'sources.workbook') return { sheets: [{ name: 'Sales', rows: SHEET }], coverage: { format: 'xlsx', sheetCount: 1, selectedSheetCount: 1, nonEmptyCells: 12, allocatedCells: 12, formulaCells: 0, readOnly: true }, warnings: [] };
    return engine.request(method, payload);
  } } as never;
}

function pickBridge(replies: unknown[]) {
  const kinds: PickKind[] = [];
  const bridge: DesktopShellBridge = {
    async openExternal() { return 'refused'; }, async print() { return 'refused'; },
    async pickFile(kind) { kinds.push(kind); return replies.shift() ?? { outcome: 'cancelled' }; },
  };
  return { bridge, kinds };
}

async function mountOnFake(scenario: FakeScenario, bridge: DesktopShellBridge) {
  const engine = createFakeEngine({ scenario });
  const log: Array<{ method: string; payload: unknown }> = [];
  const controller = createHostController(fileRpc(engine, log), { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view: 'guided', shell: createShellPort(bridge, null) }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await act(async () => { window.location.hash = `#/${SOURCES.place}/${SOURCES.sub}`; });
  await waitFor(() => expect(document.querySelector('[data-synthetic-sources]')).not.toBeNull(), { timeout: 5000 });
  return { engine, log, user: userEvent.setup() };
}

test('BK-04: a place draws the same Bring-a-file flow through bringFile, over the host\'s desktop chooser', async () => {
  const w = words('en');
  const { bridge, kinds } = pickBridge([{ outcome: 'picked', name: 'September sales.csv', bytesBase64: Buffer.from(CSV).toString('base64') }]);
  const { engine, log, user } = await mountOnFake('populated', bridge);
  expect(typeof seen.bringFile).toBe('function');
  const flow = document.querySelector('[data-bring-file="place"]') as HTMLElement;
  expect(flow).not.toBeNull();
  // Inside a place: a plain heading, not the journey's "Step 4 of 6".
  expect(within(flow).getByRole('heading', { name: w('FR-07.title') })).toBeTruthy();
  expect(within(flow).queryByText(w('FR.step', { step: '4', of: '6' }))).toBeNull();
  await user.click(within(flow).getByRole('button', { name: w('FR-07.pick.btn') }));
  expect(kinds).toEqual(['statement']);
  expect(within(flow).getByText(w('FR-07.name', { name: 'September sales.csv' }))).toBeTruthy();
  await user.click(await within(flow).findByRole('button', { name: w('FR-07.take.btn') }));
  await within(flow).findByText(w('FR-07.group.taken', { count: '2' }));
  // The CSV went to the engine as text, from the bytes main read.
  expect(log.find(entry => entry.method === 'sources.import')?.payload).toMatchObject({ format: 'csv', content: CSV });
  // Proposed meanings come from the fake engine's default learningx, settled in Books · Meanings.
  await waitFor(() => expect(document.querySelector('[data-proposed-meanings]')?.getAttribute('data-proposed-meanings')).toBe('ready'));
  expect(within(flow).getByText(w('FR-07.proposals.settlePlace'))).toBeTruthy();
  expect(engine.calls).toContain('learningx.dictionaryBuild');
  await user.click(within(flow).getByRole('button', { name: w('FR.journey.continue.btn') }));
  expect(seen.taken).toBe(1);
});

test('BK-04: a viewer seat gets no bringFile, and the place draws no control', async () => {
  const { bridge } = pickBridge([]);
  await mountOnFake('read-only', bridge);
  expect(seen.bringFile).toBeUndefined();
  expect(screen.getByText('No bring-a-file here.')).toBeTruthy();
});

async function bring(rpc: JourneyPort, pickFile: () => Promise<PickedFile | null>, language: Language = 'en') {
  render(<FirstRunText language={language}><BringFile rpc={rpc} pickFile={pickFile} held={null} onHold={() => {}} meaningsAgreed company="Demo shop"
    onTaken={() => {}} onWaits={() => {}} propose={proposalCache(rpc)} /></FirstRunText>);
  await flush();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: words(language)('FR-07.pick.btn') }));
  await flush();
  return user;
}

test('FR-07: each chooser refusal says so in words, in English and Hindi', async () => {
  for (const language of ['en', 'hi'] as const) {
    for (const code of ['FILE_TOO_LARGE', 'FILE_KIND_REFUSED', 'FILE_UNREADABLE', 'PICKER_BUSY']) {
      const engine = createFakeEngine({ scenario: 'populated' });
      await bring(fileRpc(engine), async () => { throw Object.assign(Error('refused'), { code }); }, language);
      const line = document.querySelector(`[data-pick-refused="${code}"]`);
      expect(line?.textContent).toBe(words(language)(`FR-07.pick.${code}`));
      cleanup();
    }
  }
});

test('FR-07 Excel: the taken sheet\'s cells go to learning-ext as CSV text, and the "CSV only" note is gone', async () => {
  const w = words('en');
  const engine = createFakeEngine({ scenario: 'populated' });
  const log: Array<{ method: string; payload: unknown }> = [];
  const user = await bring(fileRpc(engine, log), async () => ({ name: 'September sales.xlsx', format: 'xlsx', bytesBase64: 'UEsDBAo=' }));
  await user.click(await screen.findByRole('button', { name: w('FR-07.take.btn') }));
  await waitFor(() => expect(document.querySelector('[data-proposed-meanings]')?.getAttribute('data-proposed-meanings')).toBe('ready'));
  const rows = [...document.querySelectorAll('[data-proposal-column]')].map(row => row.querySelector('span')?.textContent);
  expect(rows).toEqual(['Invoice Value', 'Customer, City']);
  expect(log.find(entry => entry.method === 'sources.workbook')?.payload).toEqual({ bytesBase64: 'UEsDBAo=' });
  expect(log.find(entry => entry.method === 'learningx.dictionaryBuild')?.payload).toEqual({ files: [{ content: 'id,date,Invoice Value,"Customer, City"\ninv-1,2026-09-03,1000.00,Asha Traders\ninv-2,2026-09-12,2000.00,Ravi & Co' }] });
  expect(screen.queryByText(/CSV sheets only/)).toBeNull();
});

test('FR-07 Excel: a workbook with more than one sheet gives no draft, by its code', async () => {
  const engine = createFakeEngine({ scenario: 'populated' });
  const rpc = fileRpc(engine);
  const two: JourneyPort = { request: (method, payload) => method === 'sources.workbook'
    ? Promise.resolve({ sheets: [{ name: 'A', rows: SHEET }, { name: 'B', rows: SHEET }] }) : rpc.request(method, payload) };
  const outcome = await proposalCache(two)({ name: 'book.xlsx', format: 'xlsx', bytesBase64: 'UEsDBAo=' });
  expect(outcome).toEqual({ kind: 'failed', failure: { kind: 'refused', code: 'SHEET_REQUIRED' } });
});

test('FR-13: a picked backup is shown by its managed name and its passphrase passes once to workspace.restore', async () => {
  const w = words('en');
  const engine = createFakeEngine({ scenario: 'locked' });
  const sent: unknown[] = [];
  const rpc: JourneyPort = { request: (method, payload) => {
    if (method === 'workspace.restore') { sent.push(payload); return Promise.resolve({ workspace: { id: 'workspace_restored', name: 'Restored shop' } }); }
    return engine.request(method, payload);
  } };
  const reopened = vi.fn();
  const picks: Array<string | Error> = [Object.assign(Error('refused'), { code: 'BACKUP_NOT_MANAGED' }), 'chausar-workspace_1-1760000000000.backup'];
  render(<FirstRunText language="en"><Recover rpc={rpc} pickBackup={async () => { const next = picks.shift()!; if (next instanceof Error) throw next; return next; }} onReopened={reopened} onBack={() => {}} /></FirstRunText>);
  await flush();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: w('FR-13.backup.btn') }));
  await screen.findByText(w('FR-13.backup.BACKUP_NOT_MANAGED'));
  await user.click(screen.getByRole('button', { name: w('FR-13.backup.btn') }));
  await screen.findByText(w('FR-13.backup.chosen', { name: 'chausar-workspace_1-1760000000000.backup' }));
  const field = screen.getByLabelText(w('FR-13.backup.passphrase')) as HTMLInputElement;
  // Nothing is sent without the passphrase.
  await user.click(screen.getByRole('button', { name: w('FR-13.backup.open.btn') }));
  await screen.findByText(w('FR-13.backup.passphraseNeeded'));
  expect(sent).toEqual([]);
  await user.type(field, 'Synthetic backup passphrase 2026');
  await user.click(screen.getByRole('button', { name: w('FR-13.backup.open.btn') }));
  await screen.findByText(w('FR-13.opened', { name: 'Restored shop' }));
  expect(sent).toEqual([{ folder: 'main', backupFile: 'chausar-workspace_1-1760000000000.backup', passphrase: 'Synthetic backup passphrase 2026' }]);
  expect(field.value).toBe('');
  expect(reopened).toHaveBeenCalledTimes(1);
  expect(document.body.textContent?.includes('Synthetic backup passphrase 2026')).toBe(false);
});

test('the fake engine serves learningx by default: proposals and FR-10 sharing in learning-ext\'s real shapes', async () => {
  const demo = createFakeEngine({ scenario: 'populated' });
  expect(demo.methods()).toEqual(expect.arrayContaining(['learningx.dictionaryProposals', 'learningx.dictionaryBuild', 'learningx.intakeStatus', 'learningx.preview', 'learningx.consent', 'learningx.submit', 'learning.sharing']));
  const status = sharing.intakeStatus(await demo.request('learningx.intakeStatus', {}));
  expect(status).toMatchObject({ open: true, mode: 'test-inbox', on: false });
  expect(status.boxes.filter(box => box.shown).map(box => box.box)).toEqual(['setup-shapes', 'corrections']);
  await expect(demo.request('learningx.preview', { boxes: ['account-words'] })).rejects.toMatchObject({ code: 'BOX_NOT_OPEN' });
  const preview = sharing.preview(await demo.request('learningx.preview', { boxes: ['setup-shapes', 'corrections'] }));
  expect(preview.count).toBe(3); expect(preview.blocked).toEqual([]); expect(preview.names).toBe(0); expect(preview.amounts).toBe(0);
  // Structure only: no digit in any event line, as learning-ext's scan requires.
  expect(preview.bytes.split('\n').slice(1, -1).some(line => /[0-9]/.test(line))).toBe(false);
  await expect(demo.request('learningx.consent', { previewId: preview.id, digest: preview.digest })).rejects.toMatchObject({ code: 'SHARING_DISABLED' });
  expect(sharing.switched(await demo.request('learning.sharing', { enabled: true }))).toEqual({ enabled: true });
  await expect(demo.request('learningx.consent', { previewId: preview.id, digest: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
  const consent = sharing.consent(await demo.request('learningx.consent', { previewId: preview.id, digest: preview.digest }));
  const batch = sharing.oneBatch(await demo.request('learningx.submit', { consentId: consent.id }));
  expect(batch).toMatchObject({ mode: 'test-inbox', status: 'sent', count: 3, digest: preview.digest, bytes: preview.bytes });
  await expect(demo.request('learningx.preview', {})).rejects.toMatchObject({ code: 'NOTHING_TO_SHARE' });
  // A real (not demo) workspace: sharing is not open yet, and nothing is sent.
  const created = createFakeEngine({ scenario: 'locked' });
  await created.request('workspace.create', { name: 'Synthetic shop', dictionaryMode: 'deferred' });
  expect(sharing.intakeStatus(await created.request('learningx.intakeStatus', {})).mode).toBe('closed');
  // A viewer seat cannot preview.
  await expect(createFakeEngine({ scenario: 'read-only' }).request('learningx.preview', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
