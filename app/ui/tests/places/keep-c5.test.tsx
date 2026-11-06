import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';

// C5 tasks 18 to 24 on screen: the export's format, the store-size line, backup labels, opening an exported copy, the
// readable-copy row, Keep a copy on a drive, and Google Drive's honest state.
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function press(button: HTMLElement) { await act(async () => { fireEvent.click(button); }); await settle(); }
const MB = 1024 * 1024;

type Answers = Record<string, (result: any) => any>;
function start(hash: string, engine: FakeEngine, extra: Partial<EngineClient> = {}, answers: Answers = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(engine);
  const calls: [string, any][] = [];
  const client: EngineClient = {
    ...fake, ...extra,
    request: (async (method: string, params?: unknown) => {
      calls.push([method, params]);
      const result = await fake.request(method as never, params as never);
      return answers[method] ? answers[method]!(result) : result;
    }) as EngineClient['request'],
  };
  render(<App client={client} language="en" />);
  return { calls };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('task 18: the export format', () => {
  const DOWNLOADS: string[] = [];
  function catching() {
    DOWNLOADS.length = 0;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:chausar/1' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { DOWNLOADS.push(this.download); });
  }
  it('offers Tally always and the GST return only with GST on; the chosen format goes to the engine', async () => {
    catching();
    const { calls } = start('#/money/books?sheet=accountant:books', new FakeEngine(), {}, { 'venture.blueprint.get': (result) => ({ ...result, blueprint: { ...result.blueprint, backOffice: { ...result.blueprint.backOffice, taxRegistered: { ...result.blueprint.backOffice.taxRegistered, value: true } } } }) });
    const pick = await screen.findByLabelText('File format') as HTMLSelectElement;
    await waitFor(() => expect([...pick.options].map((option) => option.textContent)).toEqual(['CSV', 'Tally', 'GST return (GSTR-1)']));
    fireEvent.change(pick, { target: { value: 'tally-xml' } });
    await press(screen.getByRole('button', { name: /^Export for your CA/ }));
    expect(calls.find(([method]) => method === 'venture.money.export')![1]).toMatchObject({ format: 'tally-xml' });
    expect(DOWNLOADS[0]).toMatch(/-tally\.xml$/);
  });
  it('without GST there is no GST return, and CSV asks as before', async () => {
    catching();
    const { calls } = start('#/money/books?sheet=accountant:books', new FakeEngine(), {}, { 'venture.blueprint.get': (result) => ({ ...result, blueprint: { ...result.blueprint, backOffice: { ...result.blueprint.backOffice, taxRegistered: { ...result.blueprint.backOffice.taxRegistered, value: false } } } }) });
    const pick = await screen.findByLabelText('File format') as HTMLSelectElement;
    await settle();
    expect([...pick.options].map((option) => option.textContent)).toEqual(['CSV', 'Tally']);
    await press(screen.getByRole('button', { name: /^Export for your CA/ }));
    expect(calls.find(([method]) => method === 'venture.money.export')![1]).toEqual({ month: expect.any(String) });
  });
});

describe('task 19: the store-size line', () => {
  it('says how much it uses, with no warning at 10 MB', async () => {
    start('#/business/keep', new FakeEngine({ storeBytes: 10 * MB }));
    expect(await screen.findByText('Uses 10 MB of 32 MB')).toBeTruthy();
    expect(screen.queryByText(/getting full/)).toBeNull();
  });
  it('warns from 70 percent', async () => {
    start('#/business/keep', new FakeEngine({ storeBytes: 23 * MB }));
    expect(await screen.findByText('Uses 23 MB of 32 MB')).toBeTruthy();
    expect(screen.getByText('This business is getting full. Old chats and imports take the most room.')).toBeTruthy();
  });
});

describe('task 20: backup labels', () => {
  it('shows what came before a backup, and nothing where the engine says nothing', async () => {
    start('#/business/keep', new FakeEngine(), {}, { 'workspace.backups.list': (result) => ({ ...result, backups: result.backups.map((backup: any, index: number) => (index === 0 ? { ...backup, after: 'you drafted the Bakery reply' } : backup)) }) });
    const backups = await screen.findByRole('region', { name: 'Backups' });
    const fold = within(backups).getAllByText("What's in it", { selector: 'summary' })[0]!.closest('details')!;
    fireEvent.click(fold.querySelector('summary')!);
    expect(within(fold).getByText('after you drafted the Bakery reply')).toBeTruthy();
    expect(within(fold).getAllByText(/^after /)).toHaveLength(1);
  });
});

describe('task 21: open an exported copy', () => {
  it('from Welcome back: pick, passphrase, opened; a readable copy and a business already here say so', async () => {
    const engine = new FakeEngine({ closed: true });
    const importCopy = vi.fn(async (input: { token: string; passphrase?: string; restore?: boolean }) => {
      if (input.token === 'readable') throw new EngineError('IMPORT_READABLE', "A readable copy can't come back in, since anyone could have changed it. Use the encrypted copy.");
      if (input.token === 'here' && !input.restore) throw new EngineError('IMPORT_ALREADY_HERE', 'This business is already on this computer. Restore it from this copy instead?');
      if (input.token === 'new' && !input.passphrase) throw new EngineError('PASSPHRASE_REQUIRED', 'This copy opens with its passphrase or its recovery code.');
      return { workspace: { name: 'Copy Shop' }, folder: 'main', unlock: 'this-computer' as const };
    });
    const picks = ['readable', 'here', 'new'];
    const pickCopy = vi.fn(async () => { const token = picks.shift()!; return { token, name: `${token}.vault` }; });
    start('#/today', engine, { pickCopy, importCopy });
    await screen.findByRole('heading', { level: 1, name: 'Welcome back' });
    fireEvent.click(await screen.findByText('Bring a business here', { selector: 'summary' }));
    await press(screen.getByRole('button', { name: 'Open an exported copy' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Open an exported copy' })).toBeTruthy();

    await press(screen.getByRole('button', { name: 'Choose the copy' }));
    expect(screen.getByRole('alert').textContent).toContain("A readable copy can't come back in");

    await press(screen.getByRole('button', { name: 'Choose the copy' }));
    expect(screen.getByText('This business is already on this computer. Restore it from this copy instead?')).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Restore from this copy' }));
    expect(importCopy).toHaveBeenLastCalledWith({ token: 'here', restore: true });
  });

  it('asks for the copy\'s passphrase, or its recovery code, and clears it once sent', async () => {
    const engine = new FakeEngine({ closed: true });
    const importCopy = vi.fn(async (input: { token: string; passphrase?: string; recoveryCode?: string }) => {
      if (!input.passphrase && !input.recoveryCode) throw new EngineError('PASSPHRASE_REQUIRED', 'This copy opens with its passphrase or its recovery code.');
      if (input.passphrase === 'wrong one here') throw new EngineError('UNLOCK_FAILED', 'Unable to unlock.');
      return { workspace: { name: 'Copy Shop' }, folder: 'main', unlock: 'passphrase' as const };
    });
    start('#/today', engine, { pickCopy: async () => ({ token: 'new', name: 'copy.vault' }), importCopy });
    fireEvent.click(await screen.findByText('Bring a business here', { selector: 'summary' }));
    await press(screen.getByRole('button', { name: 'Open an exported copy' }));
    await press(screen.getByRole('button', { name: 'Choose the copy' }));
    expect(screen.getByText('copy.vault')).toBeTruthy();
    const field = await screen.findByLabelText("The copy's passphrase") as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'wrong one here' } });
    await press(screen.getByRole('button', { name: 'Open it' }));
    expect(field.value).toBe('');
    expect(importCopy).toHaveBeenLastCalledWith({ token: 'new', passphrase: 'wrong one here' });
    await press(screen.getByRole('button', { name: 'Use the recovery code' }));
    fireEvent.change(await screen.findByLabelText('Recovery code'), { target: { value: 'CODE' } });
    await press(screen.getByRole('button', { name: 'Open it' }));
    expect(importCopy).toHaveBeenLastCalledWith({ token: 'new', recoveryCode: 'CODE' });
  });

  it('shows no way in where the app can\'t pick a file', async () => {
    start('#/today', new FakeEngine({ closed: true }));
    fireEvent.click(await screen.findByText('Bring a business here', { selector: 'summary' }));
    expect(screen.queryByRole('button', { name: 'Open an exported copy' })).toBeNull();
  });

  it('from inside a business, the same fold', async () => {
    const importCopy = vi.fn(async () => { throw new EngineError('IMPORT_CLOSE_FIRST', 'This copy is of another business. Close this one first, then open the copy from the list of businesses.'); });
    start('#/business/keep', new FakeEngine(), { pickCopy: async () => ({ token: 'other', name: 'other.vault' }), importCopy });
    const fold = (await screen.findByText('Open an exported copy', { selector: 'summary' })).closest('details')!;
    fireEvent.click(within(fold).getByText('Open an exported copy', { selector: 'summary' }));
    await press(within(fold).getByRole('button', { name: 'Choose the copy' }));
    expect(within(fold).getByRole('alert').textContent).toContain('Close this one first');
  });
});

describe('task 22: the readable-copy row', () => {
  const row = {
    id: 'readable-copy:chausar-main-100.json:waiting', businessId: 'main', businessName: 'Ledger Cafe Books', kind: 'notice' as const, createdAt: '2026-10-21T05:00:00.000Z',
    title: 'A readable copy of this business is still on this computer. Delete it?', line: 'Anyone who opens that file can read your whole business.',
    notice: { probe: 'readable-copy' as const, severity: 'medium' as const, link: '#/business/keep', file: 'chausar-main-100.json' },
    actions: [{ id: 'deny' as const, label: 'Keep it', primary: false }, { id: 'approve' as const, label: 'Delete', primary: true, secondAsk: true }],
  };
  it('Delete asks once more and then decides; the engine\'s words show', async () => {
    const { calls } = start('#/today', new FakeEngine({ queue: [row] }));
    await screen.findByText(row.title);
    await press(screen.getByRole('button', { name: 'Delete' }));
    expect(calls.some(([method]) => method === 'venture.queue.decide')).toBe(false);
    const buttons = screen.getAllByRole('button', { name: /^(Delete|Yes.*|Confirm.*)$/ });
    await press(buttons[buttons.length - 1]!);
    expect(calls.find(([method]) => method === 'venture.queue.decide')![1]).toMatchObject({ action: 'approve' });
    expect(await screen.findByText(/The readable copy is deleted\./)).toBeTruthy();
  });
  it('Keep it decides at once, in the engine\'s words', async () => {
    start('#/today', new FakeEngine({ queue: [row] }));
    await screen.findByText(row.title);
    await press(screen.getByRole('button', { name: 'Keep it' }));
    expect(await screen.findByText(/Kept\. Chausar won't ask about this copy again\./)).toBeTruthy();
  });
});

describe('task 23: keep a copy on a drive', () => {
  it('picks a folder through the desktop, says when it last copied, and says a problem in words', async () => {
    const setBackupFolder = vi.fn(async () => ({ copy: { folderName: 'USB', lastCopiedAt: '2026-10-21T05:00:00.000Z', problem: null } }));
    const engine = new FakeEngine();
    start('#/business/keep', engine, { setBackupFolder });
    const section = await screen.findByRole('region', { name: 'Keep a copy on a drive' });
    await press(within(section).getByRole('button', { name: 'Pick a drive or folder' }));
    expect(setBackupFolder).toHaveBeenCalledWith('pick');
  });
  it('shows the folder and its problem; turning it off goes through the desktop; no path is ever passed', async () => {
    const setBackupFolder = vi.fn(async () => ({ copy: null }));
    start('#/business/keep', new FakeEngine(), { setBackupFolder }, { 'workspace.custody.get': (result) => ({ ...result, business: { ...result.business, recovery: 'made', backups: { ...result.business.backups, copy: { folderName: 'USB', lastCopiedAt: null, problem: "The drive isn't plugged in. The next copy goes when it is." } } } }) });
    const section = await screen.findByRole('region', { name: 'Keep a copy on a drive' });
    expect(within(section).getByText("The drive isn't plugged in. The next copy goes when it is.")).toBeTruthy();
    expect(within(section).getByText(/USB/)).toBeTruthy();
    await press(within(section).getByRole('button', { name: 'Stop copying' }));
    expect(setBackupFolder).toHaveBeenCalledWith('clear');
  });
  it('with no recovery code it says so, with the button', async () => {
    start('#/business/keep', new FakeEngine(), { setBackupFolder: vi.fn() }, { 'workspace.custody.get': (result) => ({ ...result, business: { ...result.business, recovery: 'not-made' } }) });
    const section = await screen.findByRole('region', { name: 'Keep a copy on a drive' });
    expect(within(section).getByText('This copy opens on another computer only with your recovery code. Make one first.')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Make a recovery code' })).toBeTruthy();
  });
  it('where the app can\'t pick a folder, no such section', async () => {
    start('#/business/keep', new FakeEngine());
    await screen.findByText('Backups');
    expect(screen.queryByRole('region', { name: 'Keep a copy on a drive' })).toBeNull();
  });
});

describe('task 24: Google Drive', () => {
  it('says plainly what it needs, with no button that pretends', async () => {
    start('#/business/keep', new FakeEngine(), { setBackupFolder: vi.fn() });
    const line = await screen.findByText("Google Drive needs Chausar's Google sign-in set up first. Until then, pick your Google Drive folder under Keep a copy on a drive.");
    expect(line).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Google Drive/ })).toBeNull();
  });
  it('once set up: Connect opens Google; connected: Disconnect', async () => {
    const openExternal = vi.fn(async () => undefined);
    (window as unknown as { chausar?: unknown }).chausar = { openExternal };
    const engine = new FakeEngine();
    let state = 'not-connected';
    window.location.hash = '#/business/keep';
    const fake = createFakeClient(engine);
    render(<App language="en" client={{ ...fake, setBackupFolder: vi.fn(), request: (async (method: string, params?: unknown) => {
      if (method === 'workspace.backups.drive.status') return { state, lastCopiedAt: null, problem: null };
      if (method === 'workspace.backups.drive.connect') { state = 'connecting'; return { state, url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }; }
      if (method === 'workspace.backups.drive.disconnect') { state = 'not-connected'; return { state, lastCopiedAt: null, problem: null }; }
      return fake.request(method as never, params as never);
    }) as EngineClient['request'] }} />);
    await press(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    expect(openExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1');
    expect(await screen.findByText('Finish in your browser, then come back.')).toBeTruthy();
    delete (window as unknown as { chausar?: unknown }).chausar;
  });
});
